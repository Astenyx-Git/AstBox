// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 封装向导 + 结果 —— gui/app.js 的 openPackSheet/showPackResult/qrSvg 平移。 */

import { _t } from "../../i18n";
import { getState } from "../../state";
import { api } from "../../api";
import { toast, copyText } from "../../ui/toast";
import { openSheet, closeSheet, fieldRow, pathRow, browsePick } from "../../ui/sheet";
import { ASTBOX_FT } from "./ft";

export function openPackSheet(): void {
  const sheet = openSheet(
    "<h2>" + _t("shPack") + "</h2>" +
    '<p class="sheet-sub">' + _t("shPackSub") + '</p>' +
    fieldRow(_t("lblSource"),
      pathRow("pSrc", "C:\\path\\to\\folder", "pSrcBrowse")) +
    fieldRow(_t("lblTarget"),
      pathRow("pDst", "C:\\path\\to\\output.astbox", "pDstBrowse")) +
    fieldRow(_t("lblDigits"),
      '<div class="seg" id="pDigits"><button data-v="6" class="on">6 ' + _t("digitsShort") + '</button>' +
      '<button data-v="8">8 ' + _t("digitsShort") + '</button></div>' +
      '<div class="field-note" id="digitsNote">' + _t("digitsNote6") + "</div>") +
    fieldRow(_t("lblB32"),
      '<input class="text-input mono" id="pB32" type="text" spellcheck="false" ' +
      'placeholder="' + _t("lblB32Hint") + '">') +
    fieldRow(_t("lblKdf"),
      '<div class="seg" id="pProfile"><button data-v="high" class="on">' + _t("lblKdfHigh") + '</button>' +
      '<button data-v="constrained">' + _t("lblKdfLow") + '</button></div>',
      _t("lblKdfNote")) +
    '<div class="sheet-actions">' +
    '<button class="btn btn-glass" id="pCancel">' + _t("btnCancel") + '</button>' +
    '<button class="btn btn-primary" id="pOk">' + _t("btnStart") + '</button></div>');

  sheet.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (e: any) => {
      const b = e.target.closest("button");
      if (!b) return;
      seg.querySelectorAll("button").forEach((x: any) => x.classList.remove("on"));
      b.classList.add("on");
      if (seg.id === "pDigits") {
        const eight = +b.dataset.v === 8;
        const note = sheet.querySelector("#digitsNote") as HTMLElement;
        note.textContent = eight ? _t("digitsNote8") : _t("digitsNote6");
        note.classList.toggle("field-warn", eight);
      }
    });
  });
  const digitsSel = () => +(sheet.querySelector("#pDigits .on") as HTMLElement).dataset.v!;
  sheet.querySelector("#pSrcBrowse")!.addEventListener("click", async () => {
    const paths = await browsePick("dir",
      { title: _t("dlgPackDir"),
        initial: (sheet.querySelector("#pSrc") as HTMLInputElement).value.trim() });
    if (paths && paths.length) {
      (sheet.querySelector("#pSrc") as HTMLInputElement).value = paths[0];
      (sheet.querySelector("#pSrc") as HTMLInputElement).dispatchEvent(new Event("change"));
    }
  });
  sheet.querySelector("#pDstBrowse")!.addEventListener("click", async () => {
    const cur = (sheet.querySelector("#pDst") as HTMLInputElement).value.trim();
    const paths = await browsePick("save",
      { title: _t("dlgSaveAs"), filetypes: ASTBOX_FT(), defaultext: ".astbox",
        initial: cur });
    if (paths && paths.length) {
      let p = paths[0];
      if (!/\.astbox$/i.test(p)) p += ".astbox";
      (sheet.querySelector("#pDst") as HTMLInputElement).value = p;
    }
  });
  (sheet.querySelector("#pSrc") as HTMLInputElement).addEventListener("change", () => {
    const src = (sheet.querySelector("#pSrc") as HTMLInputElement).value.trim();
    if (src && !(sheet.querySelector("#pDst") as HTMLInputElement).value.trim()) {
      (sheet.querySelector("#pDst") as HTMLInputElement).value =
        src.replace(/[\\/]+$/, "") + ".astbox";
    }
  });
  sheet.querySelector("#pCancel")!.addEventListener("click", closeSheet);
  sheet.querySelector("#pOk")!.addEventListener("click", async () => {
    const body = {
      src: (sheet.querySelector("#pSrc") as HTMLInputElement).value.trim(),
      dst: (sheet.querySelector("#pDst") as HTMLInputElement).value.trim(),
      digits: digitsSel(),
      b32: (sheet.querySelector("#pB32") as HTMLInputElement).value.trim(),
      profile: (sheet.querySelector("#pProfile .on") as HTMLElement).dataset.v,
    };
    if (!body.dst) { toast(_t("errSpecify"), "err"); return; }
    if (!body.src && getState().phase !== "unlocked") {
      toast(_t("openOrSpecify"), "err");
      return;
    }
    const btn = sheet.querySelector("#pOk") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = _t("packing");
    try {
      const r = await api("/api/pack", body, { silent: true });
      showPackResult(r.pack);
    } catch (err: any) {
      toast(err.message, "err");
      btn.disabled = false;
      btn.textContent = _t("btnStart");
    }
  });
}

export function showPackResult(pack: any): void {
  const qr = getState().qr_ok && pack.matrix ? qrSvg(pack.matrix) : "";
  const digitsWarn = pack.digits === 8
    ? '<div class="warnline"><svg class="ic" style="margin-top:2px"><use href="#i-warning"/></svg>' +
      "<span>" + _t("digitsNote8") + "</span></div>"
    : "";
  const sheet = openSheet(
    '<div class="success-ring"><svg viewBox="0 0 16 16">' +
    '<path d="m3 8.6 3.2 3.2L13 4.6" fill="none" stroke="#fff" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>' +
    "</svg></div>" +
    "<h2>" + _t("packComplete") + "</h2>" +
    '<p class="sheet-sub">' + _t("packCompleteSub") + '</p>' +
    (qr ? '<div class="qr-wrap">' + qr + "</div>" : "") +
    '<div class="result-kv"><b>' + _t("file") + '</b><span></span></div>' +
    '<div class="result-kv"><b>VaultID</b><span>' + pack.vault_id + "</span></div>" +
    '<div class="result-kv"><b>Generation</b><span>' + pack.generation + "</span></div>" +
    '<div class="result-kv"><b>' + _t("lblEntries") + '</b><span>' + pack.entries + "</span></div>" +
    '<div class="copy-line"><span></span>' +
    '<button class="btn btn-ghost" id="pCopyKey" style="height:28px">' + _t("lblCopyKey") + '</button></div>' +
    digitsWarn +
    '<div class="warnline"><svg class="ic" style="margin-top:2px"><use href="#i-warning"/></svg>' +
    "<span>" + _t("lblWarn") + "</span></div>" +
    '<div class="sheet-actions"><button class="btn btn-primary" id="pDone">' + _t("btnDone") + '</button></div>');
  (sheet.querySelector(".result-kv span") as HTMLElement).textContent = pack.dst;
  (sheet.querySelector(".copy-line span") as HTMLElement).textContent = pack.b32;
  sheet.querySelector("#pCopyKey")!.addEventListener("click", () =>
    copyText(pack.b32, _t("tCopied")));
  sheet.querySelector("#pDone")!.addEventListener("click", closeSheet);
}

export function qrSvg(matrix: number[][]): string {
  const n = matrix.length;
  let d = "";
  for (let y = 0; y < n; y++) {
    const row = matrix[y];
    let x = 0;
    while (x < n) {
      if (row[x]) {
        const x0 = x;
        while (x < n && row[x]) x++;
        d += "M" + x0 + " " + y + "h" + (x - x0) + "v1h-" + (x - x0) + "z";
      } else x++;
    }
  }
  return '<svg viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges">' +
         '<path d="' + d + '" fill="#111"/></svg>';
}
