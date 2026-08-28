// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* Toast / 剪贴板 —— gui/app.js 的 1:1 平移。 */

import { _t } from "../i18n";
import { el } from "../dom";

export function toast(msg: string, type: string = ""): void {
  const t = el("div", "toast " + type);
  const icon = type === "err" ? "i-warning" : type === "ok" ? "i-check" : "i-box-open";
  t.innerHTML = '<svg class="ic"><use href="#' + icon + '"/></svg><span></span>';
  t.querySelector("span")!.textContent = msg;
  document.getElementById("toasts")!.appendChild(t);
  setTimeout(() => {
    t.classList.add("leaving");
    setTimeout(() => t.remove(), 260);
  }, 3400);
}

export function copyText(text: string, okMsg?: string): void {
  navigator.clipboard.writeText(text)
    .then(() => toast(okMsg || _t("copied"), "ok"))
    .catch(() => {
      const ta = el("textarea") as HTMLTextAreaElement;
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      toast(okMsg || _t("copied"), "ok");
    });
}
