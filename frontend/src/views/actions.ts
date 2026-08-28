// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 用户动作 —— gui/app.js 的 1:1 平移(导航/提取/验证/自检/锁定/传播包)。 */

import { $ } from "../dom";
import { _t, _fmt } from "../i18n";
import { getState, selection } from "../state";
import { api } from "../api";
import { toast } from "../ui/toast";
import { openSheet, closeSheet, fieldRow, pathRow, browsePick } from "../ui/sheet";
import { showGenerateResult } from "./sheets/demo";
import { ASTBOX_FT } from "./sheets/ft";

export type NavTarget = { dir?: string; path?: string };

export async function nav(target: NavTarget): Promise<void> {
  try { await api("/api/nav", target); } catch { /* ignore */ }
}

export function ensureOutDir(): string | null {
  const out = ($("#outDir") as HTMLInputElement).value.trim();
  if (!out) {
    toast(_t("errOutput"), "err");
    ($("#outDir") as HTMLInputElement).focus();
    return null;
  }
  return out;
}

export async function extractFiles(ids: string[] | null): Promise<any | null> {
  const out = ensureOutDir();
  if (!out) return null;
  try {
    const r = await api("/api/extract", { ids, out });
    toast(_fmt(_t("tExtracted"), r.count, out), "ok");
    return r;
  } catch { return null; }
}

/* 生成 .passbox 传播包: 内嵌容器+密钥, 可在其它设备双击导入 */
export async function doExportPassbox(): Promise<void> {
  const state = getState();
  const name = (state.info && state.info.name) || "container.astbox";
  const stem = name.replace(/\.astbox$/i, "");
  const paths = await browsePick("save", {
    title: _t("mExportPack"),
    filetypes: [[_t("ftPassbox"), "*.passbox"]],
    defaultext: "passbox",
    initial: stem + ".passbox",
  });
  if (!paths || !paths[0]) return;
  let out = paths[0];
  if (!/\.passbox$/i.test(out)) out += ".passbox";
  const pw = prompt(_t("packPassHint"), "");
  if (pw === null) return;
  try {
    const r = await api("/api/export_passbox", { out, passphrase: pw });
    toast(_t("passGenOk").replace("%s", r.out || out), "ok");
  } catch { /* toast 已提示 */ }
}

export async function doVerify(): Promise<void> {
  try {
    const r = await api("/api/verify", {});
    toast(r.message || _t("shVerify"), "ok");
  } catch { /* ignore */ }
}

export async function doSelftest(): Promise<void> {
  try {
    const r = await api("/api/selftest");
    const sheet = openSheet(
      "<h2>" + _t("shSelftest") + "</h2>" +
      '<p class="sheet-sub">' + _t("selftestBody") + '</p>' +
      r.lines.map(() =>
        '<div class="result-kv"><svg class="ic" style="color:var(--green);flex:none">' +
        '<use href="#i-check"/></svg><span style="font-family:var(--font-ui)"></span></div>')
        .join("") +
      '<div class="sheet-actions"><button class="btn btn-primary" id="pDone">' + _t("btnOk") + '</button></div>');
    sheet.querySelectorAll(".result-kv span")
      .forEach((spn, i) => { spn.textContent = r.lines[i] || ""; });
    sheet.querySelector("#pDone")!.addEventListener("click", closeSheet);
    toast(_t("selftestPass"), "ok");
  } catch { /* ignore */ }
}

export async function doLock(): Promise<void> {
  try { await api("/api/lock", {}); } catch { /* ignore */ }
}

/* 生成 .astbox 容器（内置示例内容，自选保存位置） */
export async function makeDemo(): Promise<void> {
  const home = getState().home || "";
  const sheet = openSheet(
    "<h2>" + _t("shGen") + "</h2>" +
    '<p class="sheet-sub">' + _t("shGenSub") + '</p>' +
    fieldRow(_t("lblSave"),
      pathRow("pDst", "C:\\path\\to\\astbox-demo.astbox", "pDstBrowse")) +
    fieldRow(_t("lblDigits"),
      '<div class="seg" id="gDigits"><button data-v="6" class="on">6 ' + _t("digitsShort") + '</button>' +
      '<button data-v="8">8 ' + _t("digitsShort") + '</button></div>' +
      '<div class="field-note" id="gDigitsNote">' + _t("digitsNote6") + "</div>") +
    fieldRow(_t("lblKdf"),
      '<div class="seg" id="gProfile"><button data-v="high" class="on">' + _t("lblKdfHigh") + '</button>' +
      '<button data-v="constrained">' + _t("lblKdfLow") + '</button></div>') +
    '<div class="sheet-actions">' +
    '<button class="btn btn-glass" id="pCancel">' + _t("btnCancel") + '</button>' +
    '<button class="btn btn-primary" id="pOk">' + _t("btnGen") + '</button></div>');
  sheet.querySelector("#gDigits")!.addEventListener("click", (e: any) => {
    const b = e.target.closest("button");
    if (!b) return;
    sheet.querySelectorAll("#gDigits button").forEach((x: any) => x.classList.remove("on"));
    b.classList.add("on");
    const note = sheet.querySelector("#gDigitsNote") as HTMLElement;
    note.textContent = +b.dataset.v === 8 ? _t("digitsNote8") : _t("digitsNote6");
    note.classList.toggle("field-warn", +b.dataset.v === 8);
  });
  sheet.querySelector("#gProfile")!.addEventListener("click", (e: any) => {
    const b = e.target.closest("button");
    if (!b) return;
    sheet.querySelectorAll("#gProfile button").forEach((x: any) => x.classList.remove("on"));
    b.classList.add("on");
  });
  (sheet.querySelector("#pDst") as HTMLInputElement).value =
    (home ? home + "\\Desktop\\" : "") + "astbox-demo.astbox";
  sheet.querySelector("#pDstBrowse")!.addEventListener("click", async () => {
    const paths = await browsePick("save",
      { title: _t("shGen") + " - " + _t("lblSave"), filetypes: ASTBOX_FT(),
        defaultext: ".astbox",
        initial: (sheet.querySelector("#pDst") as HTMLInputElement).value.trim() });
    if (paths && paths.length) {
      let p = paths[0];
      if (!/\.astbox$/i.test(p)) p += ".astbox";
      (sheet.querySelector("#pDst") as HTMLInputElement).value = p;
    }
  });
  sheet.querySelector("#pCancel")!.addEventListener("click", closeSheet);
  const go = async () => {
    const dst = (sheet.querySelector("#pDst") as HTMLInputElement).value.trim();
    if (!dst) { toast(_t("specifySave"), "err"); return; }
    const btn = sheet.querySelector("#pOk") as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = _t("generating");
    try {
      const r = await api("/api/demo", {
        dst,
        digits: +(sheet.querySelector("#gDigits .on") as HTMLElement).dataset.v!,
        profile: (sheet.querySelector("#gProfile .on") as HTMLElement).dataset.v,
      }, { silent: true });
      showGenerateResult(r.demo);
    } catch (err: any) {
      toast(err.message, "err");
      btn.disabled = false;
      btn.textContent = _t("generateShort");
    }
  };
  sheet.querySelector("#pOk")!.addEventListener("click", go);
  (sheet.querySelector("#pDst") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter") go();
    e.stopPropagation();
  });
}
/* 刷新 */
export async function refreshState(): Promise<void> {
  try { await api("/api/state"); } catch { /* ignore */ }
}
