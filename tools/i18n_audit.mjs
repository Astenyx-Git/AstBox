// i18n 审计：解析 app.js 中真实的 _I18N 对象，交叉核对全部引用键
// 用法: node tools/i18n_audit.mjs   （退出码 0=干净 1=存在悬空键）
// 检查面：index.html 的 data-i18n* 属性键 + app.js 全部 _t("…") 调用点，
//         对 zh/en 双字典逐键核对；另报告动态路径（字典区外）的字符串字面量残留中文。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUI = path.join(HERE, "..", "gui");
const jsSrc = fs.readFileSync(path.join(GUI, "app.js"), "utf8");
const htmlSrc = fs.readFileSync(path.join(GUI, "index.html"), "utf8");

function extractObject(src, anchor) {
  const start = src.indexOf(anchor);
  if (start < 0) throw new Error("anchor not found: " + anchor);
  const ob = src.indexOf("{", start);
  let depth = 0, inStr = null, esc = false;
  for (let i = ob; i < src.length; i++) {
    const c = src[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (inStr) { if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 1; continue; }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return src.slice(ob, i + 1); }
  }
  throw new Error("unbalanced braces");
}

const objText = extractObject(jsSrc, "const _I18N");
const DICT = new Function("return (" + objText + ");")();
const LANGS = ["zh", "en", "ja"];
const missing = { zh: {}, en: {}, ja: {} };
const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

function ref(site, key) {
  for (const lang of LANGS) if (!has(DICT[lang], key)) (missing[lang][key] ??= []).push(site);
}

let htmlKeys = 0;
for (const m of htmlSrc.matchAll(/data-i18n(?:-html|-ph|-title|-aria)?="([^"]+)"/g)) {
  htmlKeys++; ref(`html:${m[1]}`, m[1]);
}
let jsCalls = 0;
for (const m of jsSrc.matchAll(/\b_t\(\s*"([^"]+)"\s*\)/g)) {
  jsCalls++; ref(`app.js:${jsSrc.slice(0, m.index).split("\n").length}`, m[1]);
}

console.log(`refs: html=${htmlKeys}  js-calls=${jsCalls}`);
console.log(`dict: ${LANGS.map(l => `${l}=${Object.keys(DICT[l]).length}`).join("  ")} keys`);
let bad = false;
for (const lang of LANGS) {
  const ks = Object.keys(missing[lang]).sort();
  if (ks.length) {
    bad = true;
    console.log(`\n[FAIL] ${lang} dangling keys (${ks.length}):`);
    for (const k of ks) console.log(`  ${k}  <-  ${missing[lang][k][0]}${missing[lang][k].length > 1 ? ` (+${missing[lang][k].length - 1})` : ""}`);
  } else console.log(`[OK]   ${lang}: no dangling keys`);
}

/* ---- 动态路径字符串字面量中的 CJK（字典区外、剥除注释后） ----
   豁免区：_SRV_EXACT/_SRV_PAT 服务器消息映射表 —— 中文原文即查表键，属有意保留 */
const dictAnchor = jsSrc.indexOf("const _I18N");
const dictClose = jsSrc.indexOf("\n};", dictAnchor);
const tailLines = jsSrc.slice(dictClose).split("\n");
// 允许清单：语言内建展示(document.title 映射)等有意为之的多语文本
const ALLOW = [/ASTBOX 容器管理器 · V3\.0\.0/];
const srvStart = jsSrc.indexOf("/* ---------------- 服务器错误消息本地化");
let srvEnd = -1;
if (srvStart >= 0) {
  const fnAt = jsSrc.indexOf("function _srv", srvStart);
  if (fnAt >= 0) { const close = jsSrc.indexOf("\n}", fnAt); srvEnd = close + 2; }
}
const hits = [];
let lineAbs = dictClose + 1;
tailLines.forEach((line, i) => {
  const abs = lineAbs;
  lineAbs += line.length + 1;
  if (srvStart >= 0 && abs >= srvStart && abs <= srvEnd) return;
  let l = line;
  l = l.replace(/\/\*[\s\S]*?\*\//g, "");
  const li = l.indexOf("//");
  if (li >= 0) l = l.slice(0, li);
  l = l.trim();
  if (!l) return;
  // 收集代码区字符串字面量内容
  for (const m of l.matchAll(/"([^"]*)"|'([^']*)'/g)) {
    const s = m[1] ?? m[2];
    if (/[\u4e00-\u9fff]/.test(s) && !ALLOW.some(rx => rx.test(s))) {
      hits.push(`app.js:${abs} (rel ~tail ${i + 2}): "${s.slice(0, 60)}"`);
    }
  }
});
if (hits.length) { console.log(`\n[CJK] Chinese string literals outside dictionary (${hits.length}):`); for (const h of hits) console.log("  " + h); }
else console.log("[OK]   dynamic-path CJK literals: none");

process.exit(bad ? 1 : 0);
