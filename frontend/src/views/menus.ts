// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 菜单项组装 —— gui/app.js 的 openRowMenu/openMoreMenu/openChoose/
   openLangMenu 平移(通用菜单在 ui/menu)。 */

import { $ } from "../dom";
import { _t, setLang, lang, LANGS, LANG_MENU } from "../i18n";
import { getState, selection } from "../state";
import { closeMenu, menuOpen, openMenu } from "../ui/menu";
import { toast } from "../ui/toast";
import { extractFiles, refreshState, doVerify, doSelftest, doLock, doExportPassbox, makeDemo, nav } from "./actions";
import { openAddSheet } from "./sheets/add";
import { openPackSheet } from "./sheets/pack";
import { showAbout } from "./sheets/demo";
import { openPathSheet } from "./sheets/open";

export function openRowMenu(x: number, y: number): void {
  const n = selection.size;
  openMenu([
    { label: _t("mExtractSel").replace("(%d)", "(" + n + ")"), icon: "i-download",
      action: () => extractFiles([...selection]) },
    { label: _t("mExtractAll"), icon: "i-arrow-upto",
      action: () => extractFiles(null) },
    "sep",
    { label: _t("mOpenFolder"), icon: "i-folder", disabled: n !== 1,
      action: () => {
        const item = getState().items.find((i) => i.id === [...selection][0]);
        if (item && item.is_dir) nav({ dir: item.id });
        else toast(_t("notFolder"), "err");
      } },
    "sep",
    { label: _t("mRefresh"), icon: "i-check", key: "F5", action: refreshState },
  ], x, y);
}

export function openMoreMenu(x: number, y: number): void {
  const unlocked = getState().phase === "unlocked";
  openMenu([
    { label: _t("shOpen") + "…", icon: "i-box-open", key: "Ctrl+O",
      action: openChoose },
    { label: _t("shPack") + "…", icon: "i-wand", action: openPackSheet },
    { label: _t("shGen") + "…", icon: "i-sparkle", action: makeDemo },
    "sep",
    { label: _t("shAddFile") + "…", icon: "i-plus", disabled: !unlocked,
      action: () => openAddSheet(false) },
    { label: _t("shAddFolder") + "…", icon: "i-folder-plus",
      disabled: !unlocked, action: () => openAddSheet(true) },
    { label: _t("mExtractAll"), icon: "i-arrow-upto", disabled: !unlocked,
      action: () => extractFiles(null) },
    { label: _t("shVerify"), icon: "i-shield", disabled: !unlocked,
      action: doVerify },
    { label: _t("mExportPack") + "…", icon: "i-box-open",
      disabled: !unlocked, action: doExportPassbox },
    "sep",
    { label: _t("shSelftest"), icon: "i-gear", action: doSelftest },
    { label: getState().phase === "unlocked" ? _t("mLock") : _t("mAbout"),
      icon: getState().phase === "unlocked" ? "i-lock" : "i-box-open",
      danger: getState().phase === "unlocked",
      action: getState().phase === "unlocked" ? doLock : showAbout },
  ], x, y);
}

/* 打开容器：选择方式菜单 */
export function openChoose(x?: number, y?: number): void {
  const r = ($("#btnOpen") as HTMLElement).getBoundingClientRect();
  openMenu([
    { label: _t("openBrowse"), icon: "i-box-open",
      action: () => openByDialog() },
    { label: _t("openPath"), icon: "i-copy", action: openPathSheet },
  ], x !== undefined ? x : r.left, y !== undefined ? y : r.bottom + 6);
}

/* Tauri 下浏览器 file input 换成 dialog 插件(路径直读,无上传) */
export async function openByDialog(): Promise<void> {
  const { browsePick, closeSheet } = await import("../ui/sheet");
  const { api } = await import("../api");
  const paths = await browsePick("file",
    { title: _t("dlgOpenFile"), filetypes: [[_t("ftAstbox"), "*.astbox"], [_t("ftAll"), "*.*"]] });
  if (!paths || !paths.length) return;
  try {
    await api("/api/open", { path: paths[0] });
    toast(_t("parsedUnlock"));
    closeSheet();
  } catch { /* toast 已提示 */ }
}

/* 语言下拉菜单: 按钮下方弹出, 各项以自身语言显示;
   当前项 ✓ 标记 —— 再次点击仅关闭菜单(不重选) */
export function openLangMenu(): void {
  const b = $("#btnLang") as HTMLElement;
  const r = b.getBoundingClientRect();
  openMenu(LANGS.map((l) => ({
    label: (l === lang ? "✓ " : "") + (LANG_MENU as Record<string, string>)[l],
    action: () => { if (l === lang) { closeMenu(); return; } setLang(l); },
  })), r.left, r.bottom + 6);
}

export function langMenuToggle(): void {
  if (menuOpen()) { closeMenu(); return; }   // 菜单已开 -> 按钮即关闭开关
  openLangMenu();
}
