// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 前端会话状态 + busy 计数 —— gui/app.js 的 1:1 平移。
   类型来自生成的 bindings(Snapshot/Item/Info)。 */

import type { Item, Snapshot } from "./bindings";

export type { Item, Snapshot, Info } from "./bindings";

export let state: Snapshot = {
  phase: "empty",
  info: null,
  path: "/",
  can_back: false,
  can_forward: false,
  can_up: false,
  items: [],
  out_dir: "",
  home: "",
  qr_ok: true,
};

export let busyCount = 0;
export const selection: Set<string> = new Set();
export let sortKey: string | null = null;   // null = 服务器默认(文件夹优先)
export let sortDir: 1 | -1 = 1;
export let themeMode: string = localStorage.getItem("astbox-theme") || "auto";
export let otpDigits = 6;
/** 与服务器 MAX_UPLOAD 一致(历史约束;Tauri 下路径直读不再受限) */
export const MAX_UPLOAD = 4 * 1024 * 1024 * 1024;

export function getState(): Snapshot {
  return state;
}

export function setState(s: Snapshot): void {
  state = s;
}

export function setBusyDelta(on: boolean): void {
  busyCount = Math.max(0, busyCount + (on ? 1 : -1));
}

export function getBusyCount(): number {
  return busyCount;
}

export function setSort(key: string, dir: 1 | -1): void {
  sortKey = key; sortDir = dir;
}

export function getSort(): { key: string | null; dir: 1 | -1 } {
  return { key: sortKey, dir: sortDir };
}

export function setThemeMode(mode: string): void {
  themeMode = mode;
}

export function setOtpDigits(n: number): void {
  otpDigits = n;
}

export function getOtpDigits(): number {
  return otpDigits;
}
