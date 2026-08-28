// Copyright 2026 Astenyx-Git
// SPDX-License-Identifier: MPL-2.0 OR AGPL-3.0-only
/* 通用菜单 —— gui/app.js 的 1:1 平移(具体菜单项在 views/menus.ts)。 */

import { el } from "../dom";

export type MenuItem =
  | "sep"
  | { label: string; icon?: string; key?: string; danger?: boolean; disabled?: boolean; action: () => void };

let menuEl: HTMLElement | null = null;

export function closeMenu(): void {
  if (menuEl) { menuEl.remove(); menuEl = null; }
}

export function menuOpen(): boolean {
  return menuEl !== null;
}

export function openMenu(items: MenuItem[], x: number, y: number): void {
  closeMenu();
  menuEl = el("div", "menu glass glass--regular");
  menuEl.setAttribute("role", "menu");
  items.forEach((it) => {
    if (it === "sep") { menuEl!.appendChild(el("div", "menu-sep")); return; }
    const b = el("button", "menu-item" + (it.danger ? " menu-danger" : ""));
    if (it.icon) {
      const ic = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      ic.setAttribute("class", "ic");
      ic.innerHTML = '<use href="#' + it.icon + '"/>';
      b.appendChild(ic);
    }
    b.appendChild(el("span", null, it.label));
    if (it.key) b.appendChild(el("span", "mi-key", it.key));
    (b as HTMLButtonElement).disabled = !!it.disabled;
    b.addEventListener("click", () => { closeMenu(); it.action(); });
    menuEl!.appendChild(b);
  });
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.min(x, innerWidth - r.width - 8) + "px";
  menuEl.style.top = Math.min(y, innerHeight - r.height - 8) + "px";
}
