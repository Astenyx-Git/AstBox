// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 启动与事件绑定 —— gui/app.js 的 bind()/启动段 1:1 平移。
   差异(锁定决策内):
   - fetch → invoke(api.ts 桥)
   - 浏览器 DnD → Tauri drag-drop 事件(路径直读,无上传)
   - <input type=file> → dialog 插件 */

import { getCurrentWebview } from "@tauri-apps/api/webview";

import { $, el } from "./dom";
import { _t, bootLang, registerI18nRefresh, storeItem } from "./i18n";
import {
  busyCount, selection, themeMode,
  setThemeMode, getSort, setSort, getOtpDigits, getState,
} from "./state";
import { api, registerStateApplier, registerBusyApplier } from "./api";
import { applyTheme } from "./theme";
import { toast } from "./ui/toast";
import { closeMenu, menuOpen } from "./ui/menu";
import { closeSheet, isSheetDismissable } from "./ui/sheet";
import { otpFocus, maybeAutoUnlock } from "./ui/otp";
import { applyState, renderAll, renderNavButtons } from "./views/render";
import { sortedItems, paintSelection, renderRows } from "./views/list";
import {
  nav, extractFiles, refreshState, doVerify, doSelftest, doLock, makeDemo,
} from "./views/actions";
import {
  openRowMenu, openMoreMenu, openChoose, openByDialog, langMenuToggle,
} from "./views/menus";
import { openPackSheet } from "./views/sheets/pack";
import { openAddSheet } from "./views/sheets/add";

export function applyBusy(): void {
  ($("#progress") as HTMLElement).hidden = busyCount === 0;
  document.querySelectorAll(".toolbar .btn-icon, .toolbar .btn")
    .forEach((b) => {
      if (!(b as HTMLElement).dataset.keepEnabled) {
        (b as HTMLButtonElement).disabled = busyCount > 0;
      }
    });
  renderNavButtons();
}

/* 红点退出: 先应答, 再关窗口(app.exit 兜底) */
let quitting = false;
async function doQuitApp(): Promise<void> {
  if (quitting) return;
  quitting = true;
  try { await api("/api/shutdown", {}, { silent: true }); } catch { /* ignore */ }
  // 留 350ms 给应答，然后关窗口
  setTimeout(() => {
    window.close();
    setTimeout(showQuitVeil, 500);
  }, 350);
}

function showQuitVeil(): void {
  if (document.querySelector(".quit-veil")) return;
  document.body.appendChild(el("div", "quit-veil",
    "<strong>" + _t("quitTitle") + "</strong>" +
    "<span>" + _t("quitSub") + "</span>"));
}

function toggleFullscreen(): void {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function bind(): void {
  ($("#tlClose") as HTMLElement).addEventListener("click", doQuitApp);
  ($("#tlZoom") as HTMLElement).addEventListener("click", toggleFullscreen);
  ($("#btnBack") as HTMLButtonElement).addEventListener("click", () => api("/api/back", {}));
  ($("#btnFwd") as HTMLButtonElement).addEventListener("click", () => api("/api/forward", {}));
  ($("#btnUp") as HTMLButtonElement).addEventListener("click", () => api("/api/up", {}));

  ($("#btnLang") as HTMLElement).addEventListener("click", langMenuToggle);

  ($("#btnOpen") as HTMLElement).addEventListener("click", (e) => openChoose(e.clientX, e.clientY));
  ($("#btnPack") as HTMLElement).addEventListener("click", openPackSheet);
  ($("#btnAdd") as HTMLButtonElement).addEventListener("click", () => openAddSheet(false));
  ($("#btnExtractSel") as HTMLButtonElement).addEventListener("click", () => {
    if (!selection.size) { toast(_t("errNoSel"), "err"); return; }
    extractFiles([...selection].filter((id) => {
      const it = getState().items.find((x) => x.id === id);
      return it && !it.is_dir;
    }));
  });
  ($("#btnVerify") as HTMLElement).addEventListener("click", doVerify);
  ($("#btnMore") as HTMLElement).addEventListener("click", (e) =>
    openMoreMenu(e.clientX, e.clientY));
  ($("#btnTheme") as HTMLElement).addEventListener("click", () => {
    const next = ({ auto: "light", light: "dark", dark: "auto" } as any)[themeMode];
    setThemeMode(next);
    storeItem("astbox-theme", next);
    applyTheme();
  });
  ($("#btnUnlockTop") as HTMLElement).addEventListener("click", () => {
    ($("#unlockCard") as HTMLElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
    otpFocus();
  });

  ($("#btnUnlockSide") as HTMLElement).addEventListener("click", () => import("./ui/otp").then((m) => m.doUnlock()));
  ($("#btnLock") as HTMLElement).addEventListener("click", doLock);
  ($("#btnCalcTotp") as HTMLElement).addEventListener("click", async () => {
    if (getState().phase !== "locked") return;
    const b32 = prompt(_t("b32Prompt"));
    if (!b32) return;
    try {
      const r = await api("/api/totp", { b32: b32.trim(), digits: getOtpDigits() });
      const digits = getOtpDigits();
      if (digits > 6) {
        const box = ($("#otpBoxes input") as HTMLInputElement);
        box.value = r.code;
        box.dispatchEvent(new Event("input"));
      } else {
        const boxes = ($("#otpBoxes") as HTMLElement).children;
        [...r.code].forEach((ch, i) => {
          const box = boxes[i] as HTMLInputElement;
          if (box) { box.value = ch; box.classList.add("filled"); }
        });
      }
      toast(_t("totpComputed").replace("%d", String(digits)).replace("%s", r.code));
      maybeAutoUnlock();
    } catch { /* ignore */ }
  });

  ($("#opOpen") as HTMLElement).addEventListener("click", () => openChoose());
  ($("#opPack") as HTMLElement).addEventListener("click", openPackSheet);
  ($("#opDemo") as HTMLElement).addEventListener("click", makeDemo);
  ($("#opAddFiles") as HTMLElement).addEventListener("click", () => openAddSheet(false));
  ($("#opAddFolder") as HTMLElement).addEventListener("click", () => openAddSheet(true));
  ($("#opExtractAll") as HTMLElement).addEventListener("click", () => extractFiles(null));
  ($("#opVerify") as HTMLElement).addEventListener("click", doVerify);
  ($("#opSelftest") as HTMLElement).addEventListener("click", doSelftest);
  ($("#qRoot") as HTMLElement).addEventListener("click", () => nav({ dir: "root" }));

  let outTimer: ReturnType<typeof setTimeout> | null = null;
  ($("#outDir") as HTMLInputElement).addEventListener("change", () => {
    if (outTimer) clearTimeout(outTimer);
    outTimer = setTimeout(() =>
      api("/api/outdir", { path: ($("#outDir") as HTMLInputElement).value.trim() }, { silent: true })
        .catch(() => {}), 250);
  });
  ($("#outBrowse") as HTMLElement).addEventListener("click", async () => {
    const { browsePick } = await import("./ui/sheet");
    const paths = await browsePick("dir",
      { title: _t("dlgPickOutDir"), initial: ($("#outDir") as HTMLInputElement).value.trim() });
    if (paths && paths.length) {
      ($("#outDir") as HTMLInputElement).value = paths[0];
      ($("#outDir") as HTMLInputElement).dispatchEvent(new Event("change"));
    }
  });

  ($("#heroOpen") as HTMLElement).addEventListener("click", () => openByDialog());
  ($("#heroDemo") as HTMLElement).addEventListener("click", makeDemo);

  ($("#listHead") as HTMLElement).addEventListener("click", (e: any) => {
    const h = e.target.closest(".sortable");
    if (!h) return;
    const key = h.dataset.sort;
    const cur = getSort();
    if (cur.key === key) setSort(cur.key!, (cur.dir * -1) as 1 | -1);
    else { setSort(key, 1); }
    renderRows();
  });

  /* 全局键盘 */
  document.addEventListener("keydown", (e) => {
    const inField = /^(INPUT|TEXTAREA)$/.test(document.activeElement!.tagName);
    if (e.key === "Escape") { closeMenu(); closeSheet(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      openChoose();
      return;
    }
    if (e.key === "F5") { e.preventDefault(); refreshState(); return; }
    if (inField) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = sortedItems();
      if (!items.length) return;
      const ids = items.map((x) => x.id);
      let idx = selection.size ? ids.indexOf([...selection].pop()!) : -1;
      idx = e.key === "ArrowDown" ? Math.min(idx + 1, ids.length - 1)
                                  : Math.max(idx - 1, 0);
      selection.clear();
      selection.add(ids[idx]);
      paintSelection();
      const row = document.querySelector('.row[data-id="' + ids[idx] + '"]');
      if (row) row.scrollIntoView({ block: "nearest" });
    }
    if (e.key === "Enter" && selection.size) {
      const item = getState().items.find((i) => i.id === [...selection][0]);
      if (item) item.is_dir ? nav({ dir: item.id }) : extractFiles([item.id]);
    }
  });

  /* 点击空白关闭菜单 */
  document.addEventListener("pointerdown", (e: any) => {
    if (menuOpen() && !menuElContains(e.target) &&
        !e.target.closest("#btnMore,#btnLang")) closeMenu();
  });
  ($("#scrim") as HTMLElement).addEventListener("pointerdown", (e: any) => {
    if (e.target === $("#scrim") && isSheetDismissable()) closeSheet();
  });

  /* 拖放打开 —— Tauri drag-drop 事件(路径直读,无上传) */
  const veil = $("#dropVeil") as HTMLElement;
  getCurrentWebview().onDragDropEvent((event) => {
    if (event.payload.type === "enter" || event.payload.type === "over") {
      veil.hidden = false;
    } else if (event.payload.type === "drop") {
      veil.hidden = true;
      const path = event.payload.paths && event.payload.paths[0];
      if (path) openByPath(path);
    } else {
      veil.hidden = true;
    }
  });

  /* 系统主题变化时刷新 auto 模式图标 */
  matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", applyTheme);
}

function menuElContains(target: EventTarget): boolean {
  const menu = document.querySelector(".menu");
  return menu ? menu.contains(target as Node) : false;
}

async function openByPath(path: string): Promise<void> {
  try {
    await api("/api/open", { path });
    toast(_t("parsedUnlock"));
  } catch { /* toast 已提示 */ }
}

/* 应用窗口锁定(浏览器 --app 通道遗留;Tauri 下无查询参数,自然跳过) */
function applyKioskLockdown(): void {
  if (new URLSearchParams(location.search).get("ui") !== "app") return;
  document.addEventListener("contextmenu", (e) => e.preventDefault());
  window.addEventListener("keydown", (e) => {
    if (e.key === "F12") { e.preventDefault(); e.stopPropagation(); return; }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey
        && ["I", "J", "C", "i", "j", "c"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}

/* ---------------- 启动 ---------------- */
bootLang();
applyTheme();
applyKioskLockdown();
registerStateApplier(applyState);
registerBusyApplier(applyBusy);
registerI18nRefresh(() => { applyTheme(); renderAll(); });
bind();
refreshState();
import("./views/sheets/import").then((m) => m.maybeShowImportSheet());
getCurrentWebview().listen<{ pending: boolean }>("pending-import", () => {
  import("./views/sheets/import").then((m) => m.maybeShowImportSheet());
});
