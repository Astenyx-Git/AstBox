// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* .passbox 导入 Sheet —— exp.md §1.1 双击语义的前端承接。
   启动参数/第二实例挂起的路径经 take_pending_import 取走;
   解包 → 打开容器(locked)→ TOTP 解锁即用(免重录)。 */

import { _t } from "../../i18n";
import { api } from "../../api";
import { openSheet, closeSheet, fieldRow } from "../../ui/sheet";
import { toast } from "../../ui/toast";
import { otpFocus } from "../../ui/otp";

/** 启动流程调用:有挂起路径则弹导入 Sheet, 否则忽略。 */
export async function maybeShowImportSheet(): Promise<void> {
  let path = "";
  try {
    const r = await api("/api/pending_import", {});
    path = r.path || "";
  } catch { return; }
  if (!path) return;

  const sheet = openSheet(
    "<h2>" + _t("importTitle") + "</h2>" +
    '<p class="sheet-sub">' + _t("importSub") + '</p>' +
    '<div class="result-kv"><b>' + _t("lblFilePath") + '</b><span></span></div>' +
    fieldRow(_t("packPassLabel"),
      '<input class="text-input" id="pPass" type="password" placeholder="' +
      _t("packPassHint") + '">') +
    '<div class="sheet-actions">' +
    '<button class="btn btn-glass" id="pCancel">' + _t("btnCancel") + '</button>' +
    '<button class="btn btn-primary" id="pOk">' + _t("btnImport") + '</button></div>');
  (sheet.querySelector(".result-kv span") as HTMLElement).textContent = path;
  const go = async () => {
    const pass = (sheet.querySelector("#pPass") as HTMLInputElement).value;
    try {
      await api("/api/import_passbox", { path, passphrase: pass });
      toast(_t("importOk"), "ok");
      closeSheet();
      setTimeout(otpFocus, 260);
    } catch { /* toast 已提示;口令错误时可重试 */ }
  };
  sheet.querySelector("#pOk")!.addEventListener("click", go);
  sheet.querySelector("#pCancel")!.addEventListener("click", closeSheet);
  (sheet.querySelector("#pPass") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
    e.stopPropagation();
  });
}
