// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 添加文件/文件夹 Sheet —— gui/app.js 的 openAddSheet 平移。 */

import { _t } from "../../i18n";
import { getState } from "../../state";
import { api } from "../../api";
import { toast } from "../../ui/toast";
import { openSheet, closeSheet, fieldRow, browsePick } from "../../ui/sheet";

export function openAddSheet(foldersOnly: boolean): void {
  if (getState().phase !== "unlocked") { toast(_t("errUnlock"), "err"); return; }
  const sheet = openSheet(
    "<h2>" + (foldersOnly ? _t("addFolderTitle") : _t("addFilesTitle")) + "</h2>" +
    '<p class="sheet-sub">' + _t("addFilesSub") + (foldersOnly ? _t("recurseNote") : "") + '</p>' +
    '<div class="add-tools">' +
    '<button class="btn btn-glass btn-mini" id="pBrowseFiles">' + _t("browseFiles") + '</button>' +
    '<button class="btn btn-glass btn-mini" id="pBrowseFolders">' + _t("browseFolders") + '</button>' +
    "</div>" +
    fieldRow(_t("pathList"), '<textarea id="pPaths" rows="5" spellcheck="false" ' +
      'placeholder="C:\\path\\a.txt&#10;C:\\path\\folder"></textarea>') +
    '<div class="field-note">' + _t("pathListNote") + '</div>' +
    '<div class="sheet-actions">' +
    '<button class="btn btn-glass" id="pCancel">' + _t("btnCancel") + '</button>' +
    '<button class="btn btn-primary" id="pOk">' + _t("btnAdd") + '</button></div>');
  const ta = sheet.querySelector("#pPaths") as HTMLTextAreaElement;
  const appendLines = (paths: string[] | null) => {
    if (!paths || !paths.length) return;
    const cur = ta.value.trim();
    ta.value = (cur ? cur + "\n" : "") + paths.join("\n");
  };
  sheet.querySelector("#pBrowseFiles")!.addEventListener("click", async () => {
    appendLines(await browsePick("files",
      { title: _t("dlgAddFiles2") }));
  });
  sheet.querySelector("#pBrowseFolders")!.addEventListener("click", async () => {
    appendLines(await browsePick("dir",
      { title: _t("dlgAddFolder2") }));
  });
  sheet.querySelector("#pCancel")!.addEventListener("click", closeSheet);
  sheet.querySelector("#pOk")!.addEventListener("click", async () => {
    const paths = ta.value.split("\n").map((s) => s.trim()).filter(Boolean);
    if (!paths.length) { toast(_t("atLeastOnePath"), "err"); return; }
    try {
      const r = await api("/api/add", { paths });
      toast(_fmt2(_t("addedFiles"), r.count, getState().info!.generation), "ok");
      closeSheet();
    } catch { /* ignore */ }
  });
}

/* _fmt 的双参数形态(%d %d)——与 gui/app.js _fmt 行为一致 */
function _fmt2(str: string, ...args: any[]): string {
  let i = 0;
  return str.replace(/%[sd]/g, () => String(args[i++]));
}
