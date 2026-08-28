// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 文件类型过滤器 —— gui/app.js 的 ASTBOX_FT 平移。 */

import { _t } from "../../i18n";

export const ASTBOX_FT = (): [string, string][] =>
  [[_t("ftAstbox"), "*.astbox"], [_t("ftAll"), "*.*"]];
