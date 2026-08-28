// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 生成结果 / 关于 —— gui/app.js 的 showGenerateResult/showAbout 平移。 */

import { _t } from "../../i18n";
import { getState } from "../../state";
import { copyText } from "../../ui/toast";
import { openSheet, closeSheet } from "../../ui/sheet";
import { qrSvg } from "./pack";
import { otpFocus } from "../../ui/otp";

export function showGenerateResult(d: any): void {
  const qr = getState().qr_ok && d.matrix ? qrSvg(d.matrix) : "";
  const digitsWarn = d.digits === 8
    ? '<div class="warnline"><svg class="ic" style="margin-top:2px"><use href="#i-warning"/></svg>' +
      "<span>" + _t("digitsNote8") + "</span></div>"
    : "";
  const sheet = openSheet(
    '<div class="success-ring"><svg viewBox="0 0 16 16">' +
    '<path d="m3 8.6 3.2 3.2L13 4.6" fill="none" stroke="#fff" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg></div>" +
    "<h2>" + _t("genCreated") + "</h2>" +
    '<p class="sheet-sub">' + _t("genCreatedSub") + '</p>' +
    (qr ? '<div class="qr-wrap">' + qr + "</div>" : "") +
    '<div class="result-kv"><b>' + _t("file") + '</b><span></span></div>' +
    '<div class="copy-line"><span></span>' +
    '<button class="btn btn-ghost" id="dCopy" style="height:28px">' + _t("lblCopyKey") + '</button></div>' +
    digitsWarn +
    '<div class="warnline"><svg class="ic" style="margin-top:2px"><use href="#i-warning"/></svg>' +
    "<span>" + _t("lblWarn") + "</span></div>" +
    '<div class="sheet-actions">' +
    '<button class="btn btn-primary" id="pDone">' + _t("btnUnlock") + '</button></div>');
  (sheet.querySelector(".result-kv span") as HTMLElement).textContent = d.dst;
  (sheet.querySelector(".copy-line span") as HTMLElement).textContent = d.b32;
  sheet.querySelector("#dCopy")!.addEventListener("click", () =>
    copyText(d.b32, _t("tCopied")));
  sheet.querySelector("#pDone")!.addEventListener("click", () => {
    closeSheet();
    setTimeout(otpFocus, 260);
  });
}

export function showAbout(): void {
  const sheet = openSheet(
    '<div class="success-ring" style="background:linear-gradient(180deg,#3d93ff,#065fe4)">' +
    '<svg viewBox="0 0 64 64"><rect x="10" y="20" width="44" height="32" rx="9" fill="#fff" opacity=".95"/>' +
    '<path d="M18 22 L26 10 h12 l8 12 z" fill="#fff" opacity=".7"/></svg></div>' +
    "<h2>" + _t("shAbout") + "</h2>" +
    '<p class="sheet-sub" style="text-align:center"><b>V3.0.0</b><br>' +
    _t("aboutBody") + '</p>' +
    '<div class="sheet-actions"><button class="btn btn-primary" id="pDone">' + _t("btnOk") + '</button></div>');
  sheet.querySelector("#pDone")!.addEventListener("click", closeSheet);
}
