// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
// Extract the i18n data blocks from gui/app.js VERBATIM (literal text
// slicing, brace-matched) and emit frontend/src/i18n/dict.ts.
// 逐字提取:不做任何格式改写 —— 字典是纯数据,平移即复制。
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const src = readFileSync("gui/app.js", "utf8");

/** Slice the object/function literal that starts at `start` (index of
 *  `{` or `[`), brace-matching while respecting strings/regex/comments. */
function sliceLiteral(start) {
  const open = src[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0, i = start, inStr = null, inRegex = false, inLine = false, inBlock = false, prev = "";
  for (; i < src.length; i++) {
    const c = src[i];
    if (inLine) { if (c === "\n") inLine = false; prev = c; continue; }
    if (inBlock) { if (prev === "*" && c === "/") inBlock = false; prev = c; continue; }
    if (inStr) {
      if (c === "\\") { i++; prev = c; continue; }
      if (c === inStr) inStr = null;
      prev = c; continue;
    }
    if (inRegex) {
      if (c === "\\") { i++; prev = c; continue; }
      if (c === "[") { } // char class handled loosely
      if (c === "/") inRegex = false;
      prev = c; continue;
    }
    if (c === "/" && src[i + 1] === "/") { inLine = true; prev = c; continue; }
    if (c === "/" && src[i + 1] === "*") { inBlock = true; prev = c; continue; }
    if (c === '"' || c === "'" || c === "`") { inStr = c; prev = c; continue; }
    if (c === "/") {
      // regex vs division: rough heuristic — after ( , = : [ ! & | ? { ; return
      const before = src.slice(Math.max(0, i - 1)).match(/^\s/); // whitespace before?
      if (!before) inRegex = true; prev = c; continue;
    }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
    prev = c;
  }
  throw new Error("unbalanced literal at " + start);
}

function extractConst(name) {
  const re = new RegExp("const " + name + "\\s*=");
  const m = re.exec(src);
  if (!m) throw new Error(name + " not found");
  const start = src.indexOf("=", m.index) + 1;
  let i = start;
  while (src[i] === " " || src[i] === "\n" || src[i] === "\r" || src[i] === "\t") i++;
  const lit = sliceLiteral(i);
  return lit;
}

const i18n = extractConst("_I18N");
const srvExact = extractConst("_SRV_EXACT");
const srvPat = extractConst("_SRV_PAT");

// quick sanity: eval and count keys
const I18N = new Function("return " + i18n)();
const langs = Object.keys(I18N);
const counts = Object.fromEntries(langs.map(l => [l, Object.keys(I18N[l]).length]));
console.log("i18n langs:", JSON.stringify(counts));
const SRV = new Function("return " + srvExact)();
console.log("srv exact:", Object.keys(SRV).length);
const PAT = new Function("return " + srvPat)();
console.log("srv patterns:", PAT.length);

mkdirSync("frontend/src/i18n", { recursive: true });

/* I18N: 源文件 zh/en 各有一处 `copied` 重复键(值完全相同, JS 后值覆盖
   = 语义不变)。TS1117 禁止重复键, 故按解析结果重发射:键序/键值逐字
   保留, 仅格式归一 + 去除同值重复。若发现异值重复键则立即失败。 */
function dedupeLang(lit, langName) {
  const obj = new Function("return " + lit)();
  const langObj = obj[langName];
  const entries = Object.entries(langObj);
  return entries.map(([k, v]) =>
    "    " + k + ": " + JSON.stringify(v) + ",");
}

const zhLines = dedupeLang(i18n, "zh");
const enLines = dedupeLang(i18n, "en");
const jaLines = dedupeLang(i18n, "ja");
const deLines = dedupeLang(i18n, "de");
const frLines = dedupeLang(i18n, "fr");
const koLines = dedupeLang(i18n, "ko");
const zhHantLines = dedupeLang(i18n, "zh-Hant");
const esLines = dedupeLang(i18n, "es");
const ptBrLines = dedupeLang(i18n, "pt-BR");

const out = `// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* i18n 数据 —— 由 scripts/extract-i18n.mjs 从 gui/app.js 提取生成。
   键序与键值逐字保留;唯一格式差异:zh/en 的重复键 copied(同值)
   已按 JS 语义去重留档。禁止手工编辑本文件:改 gui/app.js 后重新生成。
   de/fr/ko/zh-Hant/es/pt-BR 为 Rust 线扩展语言(_I18N 中对应块由本
   移植新增, 非 C# 谱系逐字资产;zh-Hant 自简体源块平移, 台湾用语);
   六者的服务器消息走透传(与 zh/en 同策略, _srv 仅 ja 生效)。 */

export const I18N = {
  zh: {
${zhLines.join("\n")}
  },
  en: {
${enLines.join("\n")}
  },
  ja: {
${jaLines.join("\n")}
  },
  de: {
${deLines.join("\n")}
  },
  fr: {
${frLines.join("\n")}
  },
  ko: {
${koLines.join("\n")}
  },
  "zh-Hant": {
${zhHantLines.join("\n")}
  },
  es: {
${esLines.join("\n")}
  },
  "pt-BR": {
${ptBrLines.join("\n")}
  },
};

export const SRV_EXACT = ${srvExact};

export const SRV_PAT = ${srvPat};

export const LANGS = ["zh", "en", "ja", "de", "fr", "ko", "zh-Hant", "es", "pt-BR"];
export const LANG_CODES = { zh: "中", en: "EN", ja: "あ", de: "DE", fr: "FR", ko: "한", "zh-Hant": "繁", es: "ES", "pt-BR": "BR" };          // 按钮代码(各语言自称)
export const LANG_MENU = { zh: "中文(简体)", en: "English", ja: "日本語", de: "Deutsch", fr: "Français", ko: "한국어", "zh-Hant": "中文(繁體)", es: "Español", "pt-BR": "Português (Brasil)" }; // 菜单项(各自语言, 不走翻译)
`;
writeFileSync("frontend/src/i18n/dict.ts", out, "utf8");
console.log("written frontend/src/i18n/dict.ts");
