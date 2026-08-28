// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* OTP 分格输入 —— gui/app.js 的 1:1 平移。 */

import { $, el } from "../dom";
import { _t, _fmt } from "../i18n";
import { getState, getOtpDigits, setOtpDigits } from "../state";
import { api } from "../api";
import { toast } from "./toast";

export function buildOtpBoxes(): void {
  const wrap = $("#otpBoxes") as HTMLElement;
  const digits = getOtpDigits();
  const single = digits > 6;   // 超过 6 位：改用单个大输入框
  if (wrap.dataset.mode === String(digits)) return;
  wrap.dataset.mode = String(digits);
  wrap.classList.toggle("otp--single", single);
  wrap.innerHTML = "";
  if (single) {
    const inp = el("input") as HTMLInputElement;
    inp.type = "text";
    inp.inputMode = "numeric";
    inp.maxLength = digits;
    inp.autocomplete = "one-time-code";
    inp.setAttribute("aria-label", _t("otpDigitsLbl").replace("%d", String(digits)));
    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/\D/g, "").slice(0, digits);
      maybeAutoUnlock();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doUnlock();
      e.stopPropagation();
    });
    wrap.appendChild(inp);
    return;
  }
  for (let i = 0; i < digits; i++) {
    const inp = el("input") as HTMLInputElement;
    inp.type = "text";
    inp.inputMode = "numeric";
    inp.maxLength = 1;
    inp.autocomplete = "one-time-code";
    inp.setAttribute("aria-label", _t("otpDigit").replace("%d", String(i + 1)));
    inp.addEventListener("input", () => {
      inp.value = inp.value.replace(/\D/g, "").slice(-1);
      inp.classList.toggle("filled", !!inp.value);
      if (inp.value && i < digits - 1) (wrap.children[i + 1] as HTMLInputElement).focus();
      maybeAutoUnlock();
    });
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !inp.value && i > 0) {
        (wrap.children[i - 1] as HTMLInputElement).focus();
      }
      if (e.key === "Enter") doUnlock();
      if (e.key === "v" && (e.metaKey || e.ctrlKey)) return; // 放行粘贴
      e.stopPropagation();
    });
    inp.addEventListener("paste", (e: ClipboardEvent) => {
      e.preventDefault();
      const text = (e.clipboardData!.getData("text") || "")
        .replace(/\D/g, "");
      if (!text) return;
      for (let k = 0; k < digits; k++) {
        const box = wrap.children[k] as HTMLInputElement;
        box.value = text[k] || "";
        box.classList.toggle("filled", !!box.value);
      }
      (wrap.children[Math.min(text.length, digits) - 1] as HTMLInputElement).focus();
      maybeAutoUnlock();
    });
    wrap.appendChild(inp);
  }
}

export function otpValue(): string {
  const wrap = $("#otpBoxes") as HTMLElement;
  return Array.from(wrap.children).map((b: any) => b.value).join("");
}

export function otpFocus(): void {
  const first = ($("#otpBoxes") as HTMLElement).children[0] as HTMLInputElement | undefined;
  if (first && !($("#unlockCard") as HTMLElement).hidden) first.focus();
}

let autoUnlockTimer: ReturnType<typeof setTimeout> | null = null;
export function maybeAutoUnlock(): void {
  if (autoUnlockTimer) clearTimeout(autoUnlockTimer);
  if (otpValue().length === getOtpDigits()) {
    autoUnlockTimer = setTimeout(doUnlock, 160);
  }
}

export async function doUnlock(): Promise<void> {
  const code = otpValue();
  const digits = getOtpDigits();
  if (code.length !== digits) {
    toast(_fmt(_t("otpEnter"), digits), "err");
    return;
  }
  try {
    await api("/api/unlock", { totp: code });
    ($("#otpBoxes") as HTMLElement).querySelectorAll("input")
      .forEach((b) => { (b as HTMLInputElement).value = ""; (b as HTMLInputElement).classList.remove("filled"); });
  } catch { /* toast 已提示 */ }
}

/** 解锁卡片可见时同步位数并重建分格(renderUnlockCard 调用) */
export function syncOtpDigits(): void {
  const info = getState().info;
  setOtpDigits((info && info.slots_digits[0]) || 6);
  buildOtpBoxes();
}
