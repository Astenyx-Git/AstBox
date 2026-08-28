// Find duplicate i18n keys in the original gui/app.js _I18N literal.
// JS 对象字面量重复键:后值覆盖前值 —— 运行时行为 = 仅保留最后一次出现。
import { readFileSync } from "node:fs";
const t = readFileSync("gui/app.js", "utf8");
const m = /const _I18N\s*=/.exec(t);
const start = t.indexOf("{", m.index);
let depth = 0, inStr = null;
let i = start;
for (; i < t.length; i++) {
  const c = t[i];
  if (inStr) {
    if (c === "\\") { i++; continue; }
    if (c === inStr) inStr = null;
    continue;
  }
  if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
  if (c === "{") depth++;
  else if (c === "}") { depth--; if (!depth) break; }
}
const lit = t.slice(start, i + 1);
for (const langName of ["zh", "en", "ja"]) {
  const bm = new RegExp(langName + ": \\{([\\s\\S]*?)\\n  \\}").exec(lit);
  const keys = [...bm[1].matchAll(/^ {4}([A-Za-z0-9_]+):/gm)].map((x) => x[1]);
  const seen = {}, dups = [];
  for (const k of keys) { if (seen[k]) dups.push(k); seen[k] = 1; }
  console.log(langName, "keys:", keys.length, "dups:", JSON.stringify(dups));
  for (const d of dups) {
    // show both values (first vs last)
    const rv = new RegExp("^ {4}" + d + ": \"([^\"]*)\",?$", "gm");
    const vals = [...bm[1].matchAll(rv)].map((x) => x[1]);
    console.log("   ", d, "=>", JSON.stringify(vals));
  }
}
