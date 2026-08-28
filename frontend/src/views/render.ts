// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 状态应用与渲染 —— gui/app.js 的 1:1 平移。 */

import { $, el } from "../dom";
import { _t, lang } from "../i18n";
import { getState, setState } from "../state";
import { toast } from "../ui/toast";
import { otpFocus, syncOtpDigits } from "../ui/otp";
import { nav } from "./actions";
import { renderRows } from "./list";
import { busyCount } from "../state";

export function applyState(s: any): void {
  const prevPhase = getState().phase;
  setState(s);
  const outDir = $("#outDir") as HTMLInputElement;
  if (!s.out_dir && !outDir.value) {
    outDir.value = s.home ? s.home + "\\Desktop\\astbox-out" : "";
  } else if (s.out_dir) {
    outDir.value = s.out_dir;
  }
  renderAll();
  if (s.phase !== prevPhase) {
    if (s.phase === "unlocked") toast(_t("tUnlocked"), "ok");
    if (s.phase === "locked" && prevPhase === "unlocked") toast(_t("tLocked"));
    if (s.phase === "locked") setTimeout(() => otpFocus(), 260);
  }
}

export function renderAll(): void {
  renderNavButtons();
  renderAddress();
  renderContainerCard();
  renderUnlockCard();
  renderRows();
  renderStatus();
  const state = getState();
  const locked = state.phase === "locked";
  ($("#btnUnlockTop") as HTMLElement).hidden = !locked;
  ($("#btnAdd") as HTMLButtonElement).disabled = state.phase !== "unlocked";
  ($("#btnExtractSel") as HTMLButtonElement).disabled = state.phase !== "unlocked";
  ($("#btnVerify") as HTMLButtonElement).disabled = state.phase !== "unlocked";
}

export function renderNavButtons(): void {
  ($("#btnBack") as HTMLButtonElement).disabled = busyCount > 0 || !getState().can_back;
  ($("#btnFwd") as HTMLButtonElement).disabled = busyCount > 0 || !getState().can_forward;
  ($("#btnUp") as HTMLButtonElement).disabled = busyCount > 0 || !getState().can_up;
}

export function renderStatus(): void {
  const map: Record<string, string> = { empty: _t("sEmpty"), locked: _t("sLocked"), unlocked: _t("sUnlocked") };
  ($("#stLeft") as HTMLElement).textContent = map[getState().phase] || _t("sEmpty");
}

export function renderAddress(): void {
  const state = getState();
  const bar = $("#addressBar") as HTMLElement;
  bar.innerHTML = "";
  if (state.phase === "empty") {
    bar.appendChild(el("span", "crumbs",
      '<button class="crumb" disabled>ASTBOX</button>'));
    return;
  }
  const crumbs = el("div", "crumbs");
  const segs = state.path.split("/").filter(Boolean);
  const mk = (label: string, path: string, current: boolean) => {
    const b = el("button", "crumb" + (current ? " current" : ""), label);
    b.addEventListener("click", () => nav({ path }));
    return b;
  };
  const rootBtn = mk("/", "/", segs.length === 0);
  crumbs.appendChild(rootBtn);
  let acc = "";
  segs.forEach((seg, i) => {
    acc += "/" + seg;
    const sep = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    sep.setAttribute("class", "crumb-sep");
    sep.innerHTML = '<use href="#i-chev-right"/>';
    crumbs.appendChild(sep);
    crumbs.appendChild(mk(seg, acc, i === segs.length - 1));
  });
  crumbs.appendChild(el("span", "crumb-spacer"));
  const hint = el("span", "addr-hint", _t("addrEdit"));
  crumbs.appendChild(hint);
  bar.appendChild(crumbs);

  bar.ondblclick = () => {
    const input = el("input", "addr-edit") as HTMLInputElement;
    input.value = state.path;
    input.spellcheck = false;
    bar.innerHTML = "";
    bar.appendChild(input);
    input.focus();
    input.select();
    const done = (commit: boolean) => {
      if (commit && input.value.trim() && input.value !== state.path) {
        nav({ path: input.value.trim() });
      } else { renderAddress(); }
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
      e.stopPropagation();
    });
    input.addEventListener("blur", () => done(false));
  };
}

export function renderContainerCard(): void {
  const state = getState();
  const info = state.info;
  ($("#ccEmpty") as HTMLElement).hidden = !!info;
  ($("#ccBody") as HTMLElement).hidden = !info;
  if (!info) return;
  ($("#ccName") as HTMLElement).textContent = info.name;
  ($("#ccName") as HTMLElement).title = info.path || info.name;
  ($("#ccVault") as HTMLElement).textContent = "VaultID " + info.vault_id.slice(0, 16) + "…";
  ($("#ccGen") as HTMLElement).textContent = String(info.generation);
  ($("#ccFiles") as HTMLElement).textContent = info.files === null ? "—" : String(info.files);
  ($("#ccSlots") as HTMLElement).textContent = info.slots_digits.length
    ? info.slots_digits.map((d) => "TOTP-" + d + (lang === "zh" ? _t("digitsShort") : "")).join(", ") : "TOTP";
  const badge = $("#ccStatus") as HTMLElement;
  badge.textContent = info.status;
  badge.className = "badge " + (state.phase === "unlocked" ? "ok" : "warn");
  const dot = $("#phaseDot") as HTMLElement;
  dot.className = "phase-dot " +
    (state.phase === "unlocked" ? "ok" : state.phase === "locked" ? "warn" : "");
}

export function renderUnlockCard(): void {
  const show = getState().phase === "locked";
  ($("#unlockCard") as HTMLElement).hidden = !show;
  if (!show) return;
  syncOtpDigits();
}
