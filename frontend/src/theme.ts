// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 主题 —— gui/app.js 的 1:1 平移。 */

import { $ } from "./dom";
import { _t, _fmt } from "./i18n";
import { themeMode } from "./state";

export function applyTheme(): void {
  document.documentElement.dataset.theme = themeMode;
  const dark = themeMode === "dark" ||
    (themeMode === "auto" &&
     matchMedia("(prefers-color-scheme: dark)").matches);
  ($("#themeIcon") as HTMLElement).firstElementChild!
    .setAttribute("href", dark ? "#i-sun" : "#i-moon");
  ($("#btnTheme") as HTMLElement).title =
    _fmt(_t("themeToggle"),
      ({ auto: _t("themeAuto"), light: _t("themeLight"), dark: _t("themeDark") } as any)[themeMode]);
}
