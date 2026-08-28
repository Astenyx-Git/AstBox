// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 语言切换 DOM 级复现/回归测试(happy-dom)—— 驱动真实菜单链:
   openLangMenu → 菜单项 click → setLang → _refreshI18n/_applyStatic。
   背景:用户报告"点击语言后未能实质切换,锁定中文"。 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { openLangMenu } from "../src/views/menus";
import { closeMenu, installOutsideClose, menuOpen } from "../src/ui/menu";
import { lang, setLang, bootLang, storedItem, storeItem } from "../src/i18n";

installOutsideClose();   // 真实的点外关闭处理器(main.ts bind() 同款)

function items(): HTMLElement[] {
  return [...document.querySelectorAll(".menu-item")] as HTMLElement[];
}

describe("语言切换(happy-dom 全链路)", () => {
  beforeEach(() => {
    closeMenu();
    if (lang !== "zh") setLang("zh");
    localStorage.removeItem("astbox_lang");
    document.body.innerHTML =
      '<button class="btn-icon" id="btnLang" title="切换语言"><span id="langCode">中</span></button>' +
      '<button id="btnOpen"><span data-i18n="openBrowse">浏览文件…</span></button>' +
      '<div class="addr-hint"></div>';
    bootLang();
  });

  it("菜单含全部九语且当前项带 ✓", () => {
    openLangMenu();
    expect(menuOpen()).toBe(true);
    const labels = items().map((n) => n.textContent || "").join("|");
    expect(items().length).toBe(9);
    expect(labels).toContain("Deutsch");
    expect(labels).toContain("Español");
    expect(labels).toContain("✓ 中文(简体)");
  });

  it("点击 Deutsch 实质切换 UI 与 langCode,并持久化", () => {
    openLangMenu();
    const de = items().find((n) => (n.textContent || "").includes("Deutsch"))!;
    expect(de).toBeTruthy();
    de.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(lang).toBe("de");
    expect(menuOpen()).toBe(false);                      // 点击后菜单关闭
    expect(document.documentElement.lang).toBe("de");
    expect(document.getElementById("langCode")!.textContent).toBe("DE");
    expect(document.querySelector('[data-i18n="openBrowse"]')!.textContent)
      .toBe("Datei von diesem Gerät hochladen");   // de 字典实际值
    expect(storedItem("astbox_lang")).toBe("de");
  });

  it("重开菜单时 ✓ 跟随新语言;点击当前项仅关闭", () => {
    setLang("en");
    openLangMenu();
    const en = items().find((n) => (n.textContent || "").startsWith("✓ English"))!;
    expect(en).toBeTruthy();
    en.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(lang).toBe("en");                             // 仍为 en,未跳变
    expect(menuOpen()).toBe(false);
  });

  it("回归: 菜单项上的 pointerdown 不触发点外关闭(宿主页 #ctxMenu 诱饵)", () => {
    openLangMenu();
    // 宿主页诱饵元素必须先于动态菜单排位(复现碰撞条件)
    const decoy = document.createElement("div");
    decoy.className = "menu";
    document.body.prepend(decoy);
    const item = items()[1];
    item.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(menuOpen()).toBe(true);                       // 修复前:此处被误关
    // 菜单外 pointerdown 正常关闭
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    expect(menuOpen()).toBe(false);
  });
});
