/* Icon registry. ic(name) returns inline SVG for any registered icon (unknown -> "question").
   - Server (Astro): Base.astro imports icons-all.ts, so every icon is embedded in the HTML.
   - Browser: only registered icons are in the bundle. A page script registers what it draws itself:
       import "../lib/icons/map-pin.ts";        (one module per icon)
     or loads everything lazily: await SC.icons(). */
import "./icons/question.ts";

/* function declarations (hoisted) + a global store: the icon modules import this file back, so no const in TDZ */
function store(): Record<string, string> { const g = globalThis as { __SC_ICONS__?: Record<string, string> }; return g.__SC_ICONS__ || (g.__SC_ICONS__ = {}); }
export const ICONS: Record<string, string> = store();

export function registerIcons(map: Record<string, string>): void { Object.assign(store(), map); }
export function hasIcon(n: string): boolean { return n in store(); }

/** Phosphor icon as inline SVG. */
export function ic(n: string, s = 22): string {
  return '<svg class="ic" viewBox="0 0 256 256" width="' + s + '" height="' + s + '" fill="currentColor" aria-hidden="true">' + (store()[n] || store()["question"] || "") + "</svg>";
}

/** Load the full set (browser, lazy chunk). */
export function loadAllIcons(): Promise<void> { return import("./icons-all.ts").then(() => undefined); }
