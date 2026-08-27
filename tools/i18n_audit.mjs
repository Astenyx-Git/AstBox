// i18n 审计：解析 app.js 中真实的 _I18N 对象，交叉核对全部引用键
// 用法: node tools/i18n_audit.mjs   （退出码 0=干净 1=存在缺陷）
// 检查面：
//   1) index.html 的 data-i18n* 属性键
//   2) app.js 全部 _t("…") 调用点
//      —— 对字典内全部语言逐键核对（语言列表由字典自身推导）
//   3) 语言间键集合必须完全相等（防止单语漂移产生悬空）
//   4) 动态路径（字典区外）残留中文字符串；
//      _SRV 服务器消息映射表区按设计含中文源串 → 自动豁免。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUI = path.join(HERE, "..", "astbox-decoder", "gui");
const jsSrc = fs.readFileSync(path.join(GUI, "app.js"), "utf8");
const htmlSrc = fs.readFileSync(path.join(GUI, "index.html"), "utf8");

/* ---- 从锚点提取花括号配平的对象字面量文本 ---- */
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

const DICT = new Function(
  "return (" + extractObject(jsSrc, "const _I18N") + ");")();
const LANGS = Object.keys(DICT);
const missing = Object.fromEntries(LANGS.map(L => [L, {}]));
const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

function ref(site, key) {
  for (const L of LANGS)
    if (!has(DICT[L], key)) (missing[L][key] ??= []).push(site);
}

/* ---- 引用面收集 ---- */
let htmlKeys = 0;
for (const m of htmlSrc.matchAll(/data-i18n(?:-html|-ph|-title|-aria)?="([^"]+)"/g)) {
  htmlKeys++; ref(`html:${m[1]}`, m[1]);
}
let jsCalls = 0;
for (const m of jsSrc.matchAll(/\b_t\(\s*"([^"]+)"\s*\)/g)) {
  jsCalls++; ref(`app.js:${jsSrc.slice(0, m.index).split("\n").length}`, m[1]);
}

console.log(`refs: html=${htmlKeys}  js-calls=${jsCalls}`);
console.log(`dict: ${LANGS.map(L => `${L}=${Object.keys(DICT[L]).length}`).join("  ")} keys`);
let bad = false;

/* ---- 语言键集合全等校验 ---- */
const canonKeys = JSON.stringify(Object.keys(DICT[LANGS[0]]).sort());
for (const L of LANGS.slice(1)) {
  if (JSON.stringify(Object.keys(DICT[L]).sort()) !== canonKeys) {
    bad = true;
    const onlyA = Object.keys(DICT[LANGS[0]]).filter(k => !has(DICT[L], k));
    const onlyB = Object.keys(DICT[L]).filter(k => !has(DICT[LANGS[0]], k));
    console.log(`[FAIL] keyset ${LANGS[0]} != ${L}  only-${LANGS[0]}=[${onlyA.join(",")}]  only-${L}=[${onlyB.join(",")}]`);
  } else {
    console.log(`[OK]   keyset ${LANGS[0]} == ${L}`);
  }
}

/* ---- 悬空键报告 ---- */
for (const L of LANGS) {
  const ks = Object.keys(missing[L]).sort();
  if (ks.length) {
    bad = true;
    console.log(`\n[FAIL] ${L} dangling keys (${ks.length}):`);
    for (const k of ks)
      console.log(`  ${k}  <-  ${missing[L][k][0]}${missing[L][k].length > 1 ? ` (+${missing[L][k].length - 1})` : ""}`);
  } else {
    console.log(`[OK]   ${L}: no dangling keys`);
  }
}

/* ---- 动态路径残留中文扫描（字典区外；_SRV 映射表区豁免） ---- */
const dictClose = jsSrc.indexOf("\n};", jsSrc.indexOf("const _I18N"));
const srvStart = jsSrc.indexOf("服务器错误消息本地化");
const srvFn = jsSrc.indexOf("function _srv(s)");
const srvEnd = srvFn >= 0 ? jsSrc.indexOf("\n}", srvFn) : -1;   // 函数收尾的行首 }

// 允许清单：文档标题等有意为之的多语文本
const ALLOW = [/ASTBOX 容器管理器 · V3\.0\.0/];

const prefixLines = jsSrc.slice(0, dictClose).split("\n").length;
const tail = jsSrc.slice(dictClose + 1);
let charOff = dictClose + 1;
const hits = [];

tail.split("\n").forEach((line, i) => {
  const absLo = charOff, absHi = charOff + line.length;
  charOff = absHi + 1;                       // +1 为换行符

  // _SRV 表区：注释头起至函数收尾，中文源串属设计内
  if (srvStart >= 0 && srvEnd > srvStart &&
      absHi >= srvStart && absLo <= srvEnd + 1) return;

  let l = line.replace(/\/\*[\s\S]*?\*\//g, "");   // 行内块注释
  const li = l.indexOf("//");
  if (li >= 0) l = l.slice(0, li);                 // 行注释
  l = l.trim();
  if (!l) return;

  for (const m of l.matchAll(/"([^"]*)"|'([^']*)'/g)) {
    const s = m[1] ?? m[2];
    if (/[\u4e00-\u9fff]/.test(s) && !ALLOW.some(rx => rx.test(s))) {
      hits.push(`app.js:${prefixLines + i}: "${s.slice(0, 60)}"`);
    }
  }
});

if (hits.length) {
  console.log(`\n[CJK] Chinese string literals outside dictionary (${hits.length}):`);
  for (const h of hits) console.log("  " + h);
} else {
  console.log("[OK]   dynamic-path CJK literals: none (_SRV table exempted)");
}

process.exit(bad ? 1 : 0);
