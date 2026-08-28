// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* Sheet 容器 —— gui/app.js 的 1:1 平移(具体 Sheet 在 views/sheets/*)。 */

import { $ } from "../dom";
import { _t } from "../i18n";
import { api } from "../api";
import { toast } from "./toast";

let sheetDismissable = true;

export function openSheet(html: string, opts: { dismissable?: boolean } = {}): HTMLElement {
  sheetDismissable = opts.dismissable !== false;
  const sheet = $("#sheet") as HTMLElement;
  sheet.innerHTML = html;
  ($("#scrim") as HTMLElement).hidden = false;
  requestAnimationFrame(() => {
    const focusable = sheet.querySelector("input, textarea") as HTMLInputElement | null;
    if (focusable && !focusable.disabled) focusable.focus();
  });
  return sheet;
}

export function closeSheet(): void {
  const sheet = $("#sheet") as HTMLElement;
  if (($("#scrim") as HTMLElement).hidden) return;
  sheet.classList.add("out");
  setTimeout(() => {
    ($("#scrim") as HTMLElement).hidden = true;
    sheet.classList.remove("out");
    sheet.innerHTML = "";
  }, 200);
}

export function isSheetDismissable(): boolean {
  return sheetDismissable;
}

export function fieldRow(labelText: string, inputHtml: string, note?: string): string {
  return '<div class="field"><label>' + labelText + "</label>" + inputHtml +
         (note ? '<div class="field-note">' + note + "</div>" : "") + "</div>";
}

/* 路径输入行：输入框 + 浏览按钮 */
export function pathRow(id: string, placeholder: string, btnId: string): string {
  return '<div class="path-row">' +
    '<input class="text-input mono" id="' + id + '" type="text" ' +
    'spellcheck="false" placeholder="' + placeholder + '">' +
    '<button type="button" class="btn btn-glass btn-mini" id="' + btnId +
    '">' + _t("btnBrowse") + '</button></div>';
}

/* 原生"浏览…"对话框:Tauri dialog 插件(路径语义,无上传) */
export async function browsePick(mode: string, opts: {
  title?: string; filetypes?: [string, string][]; initial?: string; defaultext?: string;
} = {}): Promise<string[] | null> {
  try {
    const r = await api("/api/browse", {
      mode, title: opts.title || "",
      filetypes: opts.filetypes || [],
      initial: opts.initial || "",
      defaultext: opts.defaultext || "",
    }, { silent: true });
    return r.paths || [];
  } catch (e: any) {
    toast(e.message || _t("errBrowse"), "err");
    return null;   // 失败时前端回退为手动编辑
  }
}
