// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* i18n 引擎 —— gui/app.js 的 1:1 平移(_t/_fmt/_applyStatic/_refreshI18n/
   _srv 与语言切换入口)。字典在 ./dict(逐字提取,禁改)。
   DOM 访问全部经 hasDom 守卫:引擎在 vitest(node)下可测。 */

import { I18N, SRV_EXACT, SRV_PAT, LANGS, LANG_CODES, LANG_MENU } from "./dict";

const hasDom = typeof document !== "undefined";
const _LANG_KEY = "astbox_lang";

function storeGet(key: string): string | null {
  return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
}
function storeSet(key: string, value: string): void {
  if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
}

export let lang: string = storeGet(_LANG_KEY) || "zh";
if (hasDom) document.documentElement.lang = lang;

const DICT: Record<string, Record<string, string>> = I18N;

export function _t(key: string): string {
  const dict = DICT[lang] || DICT.zh;
  return dict[key] !== undefined ? dict[key] : DICT.zh[key] || key;
}

/* 动态替换字符串中的 %s / %d 占位符 */
export function _fmt(str: string, ...args: any[]): string {
  if (args.length === 1 && typeof args[0] === "number") args = [args[0]];
  let i = 0;
  return str.replace(/%[sd]/g, () => String(args[i++]));
}

export function _applyStatic(): void {
  if (!hasDom) return;
  document.querySelectorAll("[data-i18n]").forEach((n) => {
    const el = n as HTMLElement;
    el.textContent = _t((el.dataset as any).i18n);
  });
  document.querySelectorAll("[data-i18n-html]").forEach((n) => {
    const el = n as HTMLElement;
    el.innerHTML = _t((el.dataset as any).i18nHtml);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach((n) => {
    const el = n as HTMLInputElement;
    el.placeholder = _t((el.dataset as any).i18nPh);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((n) => {
    const el = n as HTMLElement;
    const s = _t((el.dataset as any).i18nTitle);
    el.title = s; el.setAttribute("aria-label", s);
  });
  document.querySelectorAll("[data-i18n-aria]").forEach((n) => {
    const el = n as HTMLElement;
    el.setAttribute("aria-label", _t((el.dataset as any).i18nAria));
  });
  document.title = ({ zh: "ASTBOX 容器管理器 · V3.1.1",
                      en: "ASTBOX Container Manager · V3.1.1",
                      ja: "ASTBOX コンテナマネージャー · V3.1.1",
                      de: "ASTBOX Container-Manager · V3.1.1",
                      fr: "ASTBOX Gestionnaire de conteneurs · V3.1.1" } as any)[lang]
                   || "ASTBOX 容器管理器 · V3.1.1";
  const lc = document.getElementById("langCode");
  if (lc) lc.textContent = (LANG_CODES as Record<string, string>)[lang] || lang;
}

/* 动态已渲染片段刷新(语言切换时)—— 循环依赖经由注入回调断开 */
const refreshHooks: (() => void)[] = [];
export function registerI18nRefresh(hook: () => void): void {
  refreshHooks.push(hook);
}
export function _refreshI18n(): void {
  _applyStatic();
  if (!hasDom) return;
  const hintEl = document.querySelector<HTMLElement>(".addr-hint");
  if (hintEl) hintEl.textContent = _t("addrEdit");
  for (const hook of refreshHooks) hook();
}

/* 语言切换入口(下拉菜单选择) */
export { LANGS, LANG_CODES, LANG_MENU };
export function setLang(l: string): void {
  if (!LANGS.includes(l) || l === lang) return;
  lang = l;
  storeSet(_LANG_KEY, lang);
  if (hasDom) document.documentElement.lang = lang;
  _refreshI18n();
}
export function switchLang(): void {
  setLang(LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length] || "zh");
}

/* ---------------- 服务器错误消息本地化(ja) ----------------
   服务器侧消息保持中文原样(双轨契约), 前端按 exact/pattern 两级查表映射。
   未命中一律原样透传 —— 永不因新增服务器文案而裸崩。仅 ja 生效,
   zh/en 维持既有透传行为。 */
export function _srv(s: string): string {
  if (typeof s !== "string" || s.length > 400) return s;   // 超长(如 dump)不处理
  if ((SRV_EXACT as any)[s] !== undefined) return (SRV_EXACT as any)[s];
  for (const [rx, rep] of SRV_PAT as [RegExp, string][])
    if (rx.test(s)) return s.replace(rx, rep);
  return s;
}

/** 语言存取(主题等持久化共用) */
export function storedItem(key: string): string | null {
  return storeGet(key);
}
export function storeItem(key: string, value: string): void {
  storeSet(key, value);
}

/** 首次静态渲染(main.ts 启动时调用) */
export function bootLang(): void {
  _applyStatic();
}
