// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 打开容器(路径 Sheet) —— gui/app.js 的 openPathSheet 平移。 */

import { _t } from "../../i18n";
import { api } from "../../api";
import { openSheet, closeSheet, fieldRow, pathRow, browsePick } from "../../ui/sheet";
import { ASTBOX_FT } from "./ft";

export function openPathSheet(): void {
  const sheet = openSheet(
    "<h2>" + _t("shOpen") + "</h2>" +
    '<p class="sheet-sub">' + _t("shOpenSub") + '</p>' +
    fieldRow(_t("lblFilePath"), pathRow("pOpenPath", "C:\\path\\to\\file.astbox",
                                 "pOpenBrowse")) +
    '<div class="sheet-actions">' +
    '<button class="btn btn-glass" id="pCancel">' + _t("btnCancel") + '</button>' +
    '<button class="btn btn-primary" id="pOk">' + _t("btnOpen") + '</button></div>');
  sheet.querySelector("#pOpenBrowse")!.addEventListener("click", async () => {
    const paths = await browsePick("file",
      { title: _t("dlgOpenFile"), filetypes: ASTBOX_FT(),
        initial: (sheet.querySelector("#pOpenPath") as HTMLInputElement).value.trim() });
    if (paths && paths.length) (sheet.querySelector("#pOpenPath") as HTMLInputElement).value = paths[0];
  });
  const go = async () => {
    const p = (sheet.querySelector("#pOpenPath") as HTMLInputElement).value.trim();
    if (!p) return;
    try { await api("/api/open", { path: p }); closeSheet(); }
    catch { /* ignore */ }
  };
  sheet.querySelector("#pOk")!.addEventListener("click", go);
  sheet.querySelector("#pCancel")!.addEventListener("click", closeSheet);
  (sheet.querySelector("#pOpenPath") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
    e.stopPropagation();
  });
}
