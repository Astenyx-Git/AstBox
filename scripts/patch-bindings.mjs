// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* tauri-specta 2.0.0-rc 生成物修补(幂等, 每次导出后运行):
   1) 占位 `export type TAURI_CHANNEL<TSend> = null` 与无条件导入
      `Channel as TAURI_CHANNEL` 同名冲突(TS2440)。
   2) 占位类型把 Channel 参数错标为 null —— 修正为真实
      Channel<TSend>, 使 readFileProgress(path, onChunk) 可用。
   只动生成文件的两行; 重新导出后需再跑(已并入 build-frontend.mjs)。 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const path = "frontend/src/bindings.ts";
if (!existsSync(path)) {
  console.log("bindings.ts not found, skip patch");
  process.exit(0);
}
let t = readFileSync(path, "utf8");
const before = t;

t = t.replace("Channel as TAURI_CHANNEL,", "Channel as TAURI_CHANNEL_VALUE,");
t = t.replace(
  "export type TAURI_CHANNEL<TSend> = null",
  'export type TAURI_CHANNEL<TSend> = import("@tauri-apps/api/core").Channel<TSend>',
);

if (t !== before) {
  writeFileSync(path, t, "utf8");
  console.log("bindings.ts patched (specta rc Channel collision)");
} else {
  console.log("bindings.ts already patched");
}
