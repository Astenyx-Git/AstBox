// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 版本汇点一致性审计 —— 吸收 C# 线 40320cb 的防漂移思路并强化:
   单一版本源是 installer/VERSION;其余汇点(gui/index.html 标题、
   gui/app.js 标题映射、frontend/src/i18n/index.ts 标题映射、NOTICE、
   tauri.conf.json)不得出现任何偏离该源的 V\d+.\d+.\d+ 字样。
   bump 后漏改任何汇点,此处即 fail(历史上手工 bump 曾漏过
   gui/index.html —— 被本审计首跑抓出)。文档/spec 中的历史版本
   记录不属于汇点,不在审计范围。 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (p: string): string => readFileSync(ROOT + p, "utf8");

const version = (() => {
  const m = read("installer/VERSION").match(/V(\d+\.\d+\.\d+)/);
  if (!m) throw new Error("installer/VERSION: no V\\d+.\\d+.\\d+ found");
  return m[1]; // semver, no leading V
})();
const vt = `V${version}`;

/** Collect every V\d+.\d+.\d+ literal with its 1-based line number. */
function vstrings(text: string): { line: number; v: string }[] {
  const out: { line: number; v: string }[] = [];
  text.split("\n").forEach((l, i) => {
    for (const m of l.matchAll(/V\d+\.\d+\.\d+/g)) out.push({ line: i + 1, v: m[0] });
  });
  return out;
}

describe("版本汇点一致性(installer/VERSION 为单一版本源)", () => {
  it("tauri.conf.json version 与 VERSION 一致", () => {
    const conf = JSON.parse(read("rust/crates/astbox-gui/tauri.conf.json"));
    expect(conf.version).toBe(version);
  });

  it("gui/index.html 标题横幅与 VERSION 一致", () => {
    const hits = vstrings(read("gui/index.html"));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(`${h.line}:${h.v}`).toBe(`${h.line}:${vt}`);
  });

  it("gui/app.js 标题映射与 VERSION 一致", () => {
    const hits = vstrings(read("gui/app.js"));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(`${h.line}:${h.v}`).toBe(`${h.line}:${vt}`);
  });

  it("frontend/src/i18n/index.ts 标题映射与 VERSION 一致", () => {
    const hits = vstrings(read("frontend/src/i18n/index.ts"));
    // 九语言 + fallback = 10 处
    expect(hits.length).toBe(10);
    for (const h of hits) expect(`${h.line}:${h.v}`).toBe(`${h.line}:${vt}`);
  });

  it("NOTICE 标注与 VERSION 一致", () => {
    const hits = vstrings(read("NOTICE"));
    expect(hits.length).toBeGreaterThan(0);
    for (const h of hits) expect(`${h.line}:${h.v}`).toBe(`${h.line}:${vt}`);
  });
});
