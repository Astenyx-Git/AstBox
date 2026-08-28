// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 文件列表 —— gui/app.js 的 1:1 平移。 */

import { $, el } from "../dom";
import { _t, _fmt, lang } from "../i18n";
import { getState, getSort, setSort, selection } from "../state";
import { nav, extractFiles, refreshState } from "./actions";
import { openRowMenu } from "./menus";
import type { Item } from "../bindings";

const EXT_COLORS = ["#5e6ad2", "#0a84ff", "#34c759", "#ff9f0a", "#ff375f",
                    "#bf5af2", "#64d2ff", "#ff6482", "#8e8e93", "#6c6c70"];
function extColor(name: string): { ext: string; color: string } | null {
  const m = name.match(/\.([a-z0-9]{1,5})$/i);
  if (!m) return null;
  const ext = m[1].toLowerCase();
  let h = 0;
  for (const ch of ext) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { ext, color: EXT_COLORS[h % EXT_COLORS.length] };
}

export function sortedItems(): Item[] {
  const items = [...getState().items];
  const { key: sortKey, dir: sortDir } = getSort();
  if (!sortKey) return items;                    // 文件夹优先(服务器已排序)
  items.sort((a, b) => {
    if (sortKey === "name") {
      if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
      return a.name.localeCompare(b.name, "zh-Hans-CN") * sortDir;
    }
    return (((a as any)[sortKey] || 0) - ((b as any)[sortKey] || 0)) * sortDir;
  });
  return items;
}

export function renderRows(): void {
  const ul = $("#rows") as HTMLElement;
  ul.innerHTML = "";
  selection.clear();

  const items = sortedItems();
  const state = getState();
  const hasContainer = state.phase !== "empty";
  ($("#listHead") as HTMLElement).hidden = !hasContainer;
  ($("#heroEmpty") as HTMLElement).hidden = state.phase !== "empty";
  ($("#heroLocked") as HTMLElement).hidden = state.phase !== "locked";
  ($("#heroFolderEmpty") as HTMLElement).hidden =
    !(state.phase === "unlocked" && items.length === 0);
  ($("#listHead") as HTMLElement).querySelectorAll(".sortable")
    .forEach((h) => {
      const { key: sortKey, dir: sortDir } = getSort();
      h.classList.toggle("asc", sortKey === (h as HTMLElement).dataset.sort && sortDir === 1);
      h.classList.toggle("desc", sortKey === (h as HTMLElement).dataset.sort && sortDir === -1);
    });

  items.forEach((item, i) => {
    const li = el("li", "row");
    li.style.setProperty("--i", String(i));
    li.dataset.id = item.id;

    const ec = item.is_dir ? null : extColor(item.name);
    const icon = item.is_dir
      ? '<svg class="fileic"><use href="#i-folder"/></svg>'
      : '<svg class="fileic"><use href="#i-doc"/></svg>';
    const chip = ec ? '<span class="ext-chip" style="background:' +
                      ec.color + '">' + ec.ext.toUpperCase() + "</span>" : "";
    const kind = item.is_dir ? _t("colKindDir") : (ec ? ec.ext.toUpperCase() + " " + _t("colKindFile") : _t("colKindFile"));

    li.innerHTML =
      '<div class="cell-name">' + icon +
      '<span class="fname"></span>' + chip + "</div>" +
      '<div class="cell-size">' + (item.is_dir ? "—" : item.size_h) + "</div>" +
      '<div class="cell-date">' + item.modified_h + "</div>" +
      '<div class="cell-kind">' + kind + "</div>";
    li.querySelector(".fname")!.textContent = item.name;

    li.addEventListener("click", (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        selection.has(item.id) ? selection.delete(item.id)
                               : selection.add(item.id);
      } else if (e.shiftKey && selection.size) {
        const ids = items.map((x) => x.id);
        const last = ids.indexOf([...selection].pop()!);
        const cur = ids.indexOf(item.id);
        ids.slice(Math.min(last, cur), Math.max(last, cur) + 1)
          .forEach((id) => selection.add(id));
      } else {
        selection.clear();
        selection.add(item.id);
      }
      paintSelection();
    });
    li.addEventListener("dblclick", () => {
      if (item.is_dir) nav({ dir: item.id });
      else extractFiles([item.id]);
    });
    li.addEventListener("contextmenu", (e: MouseEvent) => {
      e.preventDefault();
      if (!selection.has(item.id)) {
        selection.clear();
        selection.add(item.id);
        paintSelection();
      }
      openRowMenu(e.clientX, e.clientY);
    });
    ul.appendChild(li);
  });

  ($("#stCount") as HTMLElement).textContent =
    hasContainer ? _fmt(_t("items"), items.length) : "";
}

export function paintSelection(): void {
  document.querySelectorAll(".row").forEach((li) =>
    li.classList.toggle("selected", selection.has((li as HTMLElement).dataset.id!)));
}

/* 保留引用避免未用告警(lang 用于 chip 渲染语境与原版一致) */
void lang;
