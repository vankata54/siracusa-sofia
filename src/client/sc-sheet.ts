/* SC.sheet(): the bottom sheet and its focus trap. The same code, DOM and behaviour as before 16.11.2026, when it was a
   part of src/client/sc.ts; it left the shared runtime, because most pages never open a sheet (the runtime budget).
   WHO LOADS IT:
     - a script that opens a sheet itself imports this file (a static import, so SC.sheet() answers at once, as before):
         import "../../client/sc-sheet.ts";
     - the runtime's own sheets ("Още", "Бисквитки", the assistant, "Предложи подобрение") get it with their on-demand
       chunks (sc-ui.ts, suggest.ts), which start loading already on pointerdown / focus of the button.
   tests/unit/runtime.test.ts checks that every file that calls .sheet( imports this file. */
import { SC, visible, type SheetOpts, type Sheet } from "./sc.ts";
import { esc } from "../lib/format.ts";

const de = document.documentElement, ov = SC.ov, main = SC.main;

/* the frame of the sheet (the "x" icon is one of the runtime's own) */
const sheetHTML = (id: string, title: string, body: string): string =>
  '<button class="scrim" type="button" tabindex="-1" aria-label="Затвори"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle"></div><div class="sheet-h"><h2 id="' + id + '">' + esc(title) + '</h2><button class="hb" type="button" data-close>' + SC.ic("x", 20) + 'Затвори</button></div><div class="body">' + body + "</div></div>";

/* generic bottom sheet: returns {el, close}. While it is open everything else on the page is inert (also "Към
   съдържанието" and the cookie layer); Tab and Shift+Tab go round the sheet's own stops (tabIndex >= 0, visible, one stop
   per radio group); Escape closes it and the focus goes back to the button that opened it, or, when that button is gone
   or hidden, to opts.returnTo, a visible "Настройки на бисквитките" / "Промени избора", the page's h1, <main>. */
const inertMarks = new WeakSet<Element>();
function setInert(top: HTMLElement | null) {
  const behind = [...Array.from(document.body.children).filter((el) => el !== ov && el.tagName !== "SCRIPT"), ...Array.from(ov.children)].filter((el) => el !== top) as HTMLElement[];
  behind.forEach((el) => {
    if (top) { if (!el.inert) { el.inert = true; inertMarks.add(el); } }
    else if (inertMarks.has(el)) { el.inert = false; inertMarks.delete(el); }
  });
  if (top) { top.inert = false; inertMarks.delete(top); }
}
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';
/** the Tab stops of a container in order: tabIndex >= 0, enabled, visible; a radio group counts once (the checked radio) */
function tabStops(root: Element): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.tabIndex >= 0 && !(el as HTMLButtonElement).disabled && visible(el));
  const seen = new Set<string>();
  return all.filter((el) => {
    if (!(el instanceof HTMLInputElement) || el.type !== "radio" || !el.name) return true;
    const group = all.filter((x) => x instanceof HTMLInputElement && x.type === "radio" && x.name === el.name) as HTMLInputElement[];
    const rep = group.find((x) => x.checked) || group[0];
    if (seen.has(el.name) || rep !== el) return false;
    seen.add(el.name); return true;
  });
}
/** A way to find the opener again when the page redraws it while the sheet is open (a new element, same attributes):
    its id, or its tag + data-* attributes, + its place among the matches. */
function locatorOf(el: HTMLElement | null): { sel: string; i: number } | null {
  if (!el || el === document.body || el === de) return null;
  const esc = (v: string) => (window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/["\\]/g, "\\$&"));
  let sel = "";
  if (el.id) sel = "#" + esc(el.id);
  else {
    const data = Array.from(el.attributes).filter((a) => a.name.startsWith("data-")).map((a) => "[" + a.name + (a.value ? '="' + a.value.replace(/["\\]/g, "\\$&") + '"' : "") + "]").join("");
    if (!data) return null;
    sel = el.tagName.toLowerCase() + data;
  }
  try { return { sel, i: Array.from(document.querySelectorAll(sel)).indexOf(el) }; } catch { return null; }
}
const inView = (el: Element) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; };
/* never a jump: every focus here is without scrolling; an opener that is gone is found again by its locator (the one
   nearest to the screen); then opts.returnTo; then the page's <main> (focus only, the view stays where it is) */
function focusBack(back: HTMLElement | null, loc: { sel: string; i: number } | null, returnTo?: Element | null) {
  const focus = (el: HTMLElement) => { if (el.tabIndex < 0 && !el.matches(FOCUSABLE)) el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true }); };
  /* the page said where the focus belongs (e.g. the new item): that first */
  if (visible(returnTo)) return focus(returnTo);
  if (visible(back)) return focus(back);
  if (loc) {
    let all: HTMLElement[] = [];
    try { all = Array.from(document.querySelectorAll<HTMLElement>(loc.sel)).filter((x) => visible(x)); } catch { /* bad selector */ }
    const best = all.find((x) => inView(x)) || all[Math.min(loc.i, all.length - 1)];
    if (best) return focus(best);
  }
  focus(main);
}
export function sheet(opts: SheetOpts): Sheet {
  const w = document.createElement("div"), id = "sh" + Math.random().toString(36).slice(2, 7), back = document.activeElement as HTMLElement | null;
  const loc = locatorOf(back);
  w.className = "sheetwrap";
  w.innerHTML = sheetHTML(id, opts.title || "", opts.html || "");
  ov.appendChild(w); de.classList.add("sheet-open");
  setInert(w);
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    w.classList.remove("on");
    w.inert = true;
    const open = Array.from(ov.querySelectorAll<HTMLElement>(".sheetwrap")).filter((x) => x !== w);
    setInert(null);
    if (open.length) setInert(open[open.length - 1]);
    setTimeout(() => { w.remove(); if (!ov.querySelector(".sheetwrap")) de.classList.remove("sheet-open"); }, 340);
    opts.onClose && opts.onClose();
    /* the page may have put the focus somewhere itself (onClose, e.g. on a new item): keep it */
    const now = document.activeElement as HTMLElement | null;
    const pageMoved = !!now && now !== document.body && now !== main && !w.contains(now) && visible(now);
    if (!open.length && !pageMoved) focusBack(back && back !== document.body ? back : null, loc, opts.returnTo && opts.returnTo());
  };
  (w.querySelector(".scrim") as HTMLElement).onclick = close;
  (w.querySelector("[data-close]") as HTMLElement).onclick = close;
  w.addEventListener("keydown", (e) => {
    if (e.key !== "Tab" || e.defaultPrevented) return;
    const sh = w.querySelector(".sheet") || w, f = tabStops(sh);
    if (!f.length) return;
    e.preventDefault();
    const a = document.activeElement as HTMLElement | null;
    let i = a ? f.indexOf(a) : -1;
    if (i < 0 && a instanceof HTMLInputElement && a.type === "radio") i = f.findIndex((x) => x instanceof HTMLInputElement && x.type === "radio" && x.name === a.name);
    const n = f.length, j = i < 0 ? (e.shiftKey ? n - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + n) % n;
    f[j].focus();
  });
  requestAnimationFrame(() => { w.classList.add("on"); const f = w.querySelector<HTMLElement>("[data-close]"); f && f.focus({ preventScroll: true }); });
  return { el: w, close };
}

SC.sheet = sheet;

/* Escape closes the sheet on top */
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const w = ov.querySelectorAll(".sheetwrap.on");
  if (w.length) (w[w.length - 1].querySelector("[data-close]") as HTMLElement | null)?.click();
});
