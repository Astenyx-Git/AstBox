// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
// esbuild 前端打包:frontend/src/main.ts → dist-web/app.js(IIFE),
// 并把 gui/ 的静态资产(index.html/app.css/icon)复制进 dist-web。
import { build } from "esbuild";
import { mkdirSync, copyFileSync } from "node:fs";

mkdirSync("dist-web", { recursive: true });

/* 先修补 specta 生成物(Channel 同名冲突), 再打包 */
await import("./patch-bindings.mjs");

await build({
  entryPoints: ["frontend/src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2022",
  outfile: "dist-web/app.js",
  charset: "utf8",
  legalComments: "inline",
  logLevel: "info",
});

copyFileSync("gui/index.html", "dist-web/index.html");
copyFileSync("gui/app.css", "dist-web/app.css");
copyFileSync("gui/icon.png", "dist-web/icon.png");
console.log("dist-web ready");
