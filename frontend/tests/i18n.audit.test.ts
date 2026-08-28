// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* i18n 完整性审计 —— 复用 C# 版 audit 思路(plan P4 验收项)。
   纯数据 + 纯函数, 无 DOM, vitest(node)直测。 */

import { describe, it, expect } from "vitest";
import { I18N, SRV_EXACT, SRV_PAT, LANGS, LANG_CODES, LANG_MENU } from "../src/i18n/dict";
import { _t, _fmt, _srv, setLang, lang } from "../src/i18n/index";

describe("i18n 字典完整性", () => {
  it("三种语言各 184 键(179 平移 + 5 导入)", () => {
    expect(LANGS).toEqual(["zh", "en", "ja"]);
    for (const l of LANGS) {
      expect(Object.keys(I18N[l]).length).toBe(184);
    }
  });

  it("三语键集完全一致(缺失/多余都算漂移)", () => {
    const zh = new Set(Object.keys(I18N.zh));
    for (const l of ["en", "ja"]) {
      const keys = new Set(Object.keys(I18N[l]));
      const missing = [...zh].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !zh.has(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
    }
  });

  it("值均为非空字符串", () => {
    for (const l of LANGS) {
      for (const [k, v] of Object.entries(I18N[l])) {
        expect(typeof v).toBe("string");
        expect((v as string).length).toBeGreaterThan(0);
        expect(k.length).toBeGreaterThan(0);
      }
    }
  });

  it("_t 回退链: 当前语言 → zh → 键名", () => {
    const saved = lang;
    setLang("zh");
    expect(_t("sEmpty")).toBe(I18N.zh.sEmpty);
    expect(_t("__no_such_key__")).toBe("__no_such_key__");
    setLang(saved);
  });

  it("_fmt 替换 %d/%s", () => {
    expect(_fmt("已提取 %d 个文件 → %s", 3, "C:\\out")).toBe("已提取 3 个文件 → C:\\out");
    expect(_fmt("第%d位验证码", 7)).toBe("第7位验证码");
  });

  it("语言按钮代码/菜单为各语言自称(不走翻译)", () => {
    expect(LANG_CODES).toEqual({ zh: "中", en: "EN", ja: "あ" });
    expect(LANG_MENU.ja).toBe("日本語");
  });
});

describe("服务器消息 ja 映射", () => {
  it("exact 表命中", () => {
    expect(_srv("尚未打开容器")).toBe("コンテナが開かれていません");
    expect(_srv("请先解锁容器")).toBe("先にコンテナをロック解除してください");
  });

  it("pattern 表命中并保留捕获组", () => {
    expect(_srv("文件不存在: C:\\a.astbox"))
      .toBe("ファイルが存在しません: C:\\a.astbox");
  });

  it("未命中一律原样透传", () => {
    expect(_srv("ASTBOX_E_AUTHENTICATION_FAILED: unlock failed: x")).toBe(
      "ASTBOX_E_AUTHENTICATION_FAILED: unlock failed: x");
  });
});
