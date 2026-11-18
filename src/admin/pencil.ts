/* The pencil ("Молив"): a note "what to change" or a recommendation on an element of the screen. Port 1:1 of
   design/pages-admin/_pencil.js (and the module button of _pen-mount.js), decisions 15.11.2026.
   - Everything is in Shadow DOM with the prefix sa-pen- (<sa-pen-ui>, <sa-pen-layer>): it never breaks the page's styles.
     The colours are the page's tokens (CSS variables pass through the shadow root).
   - Two layers: the interface (round button or the button in the module's slot, the ember bar, the sheet, the toast) in
     the window that mounts it; the outline (2px --red frame and a label) in the document that is pointed at (the same
     window, or the frame of the preview from the same origin: o.doc).
   - Mouse: the pointer outlines, a click picks. Touch: the first tap outlines, the second (or "Бележка за това") picks;
     scrolling works. Keyboard: Tab outlines the focused element, Enter picks, ↑ / ↓ widen and narrow, Esc turns it off.
   - The note has exactly the fields of NoteInput (src/core/notes.ts); the server adds author, source, status and time.
     A field gives its label, never its value (src/admin/pen-core.ts).
   - No import of the site runtime (src/client/sc.ts): the admin and the staff modules load only this file and pen-core.ts.
   Use (the admin frame and the staff modules, with a dynamic import):
     const { mountPencil } = await import("../admin/pencil.ts");
     const pen = mountPencil({ module: "admin", who: "Поли (Главен админ)", sectionNotes: true, notesHref: "/admin/belezhki/",
       onSave: (n) => adminApi.createNote(n).then(() => {}) });
   The frame of the preview: doc: () => frame.contentDocument, url / viewport of the device; pen.retarget() after a load. */
import type { NoteInput } from "../core/notes.ts";
import { clean, describe, elementText, kindOf, resolve, selectorFor } from "./pen-core.ts";

export { selectorFor, elementText, describe, kindOf, labelOf, resolve } from "./pen-core.ts";

export interface PencilOptions {
  /** site | masa | waiter | watch | kitchen | driver | admin | owner | manager (the prototype's servitor / kuhnya / shofyor are accepted) */
  module: string;
  /** writes the note (POST /api/admin/notes: adminApi.createNote); a rejected promise keeps the sheet open with its message */
  onSave(note: NoteInput): Promise<void>;
  /** who writes ("Поли (Главен админ)"); the server takes the author from the session, this is for the screen only */
  who: string;
  /** the role has the section "Бележки": notes; without it: recommendations (they change nothing) */
  sectionNotes: boolean;
  /** the module's own place for the button (icon and word, in the flow); without it: the round floating button */
  slot?: HTMLElement;
  /** recommendations of this person with a new status (the badge on the button) */
  badge?: number;
  /** the link in the toast: "Виж бележките" / "Моите препоръки" */
  notesHref?: string;
  /** the document that is pointed at (the frame of the preview, same origin); default: this document */
  doc?: Document | (() => Document | null | undefined);
  /** the address saved with the note (default: path + # of the pointed document) */
  url?: () => string;
  /** the size of the screen saved with the note (default: the pointed window; the preview: the device) */
  viewport?: () => { w: number; h: number };
  /** the name of the screen on the sheet (default: the title of the pointed document before "|") */
  page?: () => string;
  /** false: no round button (the caller has its own and calls toggle()) */
  fab?: boolean;
  /** the staff modules speak on "ти" (decision 16.11): "Докосни", "Избери", "Опитай пак" */
  ti?: boolean;
  /** the ember bar from the top: [phone, wide] px (default 8, 10) */
  barTop?: [number, number];
  /** the round button from the bottom: [phone, wide] px (default 96 above the bottom bar, 24) */
  fabBottom?: [number, number];
  /** the toast from the bottom on the phone (default 96) */
  toastBottom?: number;
  /** the toast on a wide screen at the top (default: with a slot), and its top offset (default 16) */
  toastWideTop?: boolean | (() => boolean);
  toastTop?: number;
  onToggle?(on: boolean): void;
}
export interface Pencil {
  toggle(): void;
  /** is it on */
  on(): boolean;
  off(): void;
  setBadge(n: number): void;
  /** the pointed document changed (the frame of the preview loaded again) */
  retarget(doc?: Document): void;
  destroy(): void;
  /** <sa-pen-ui>: the caller sets data-up (a "Запази" bar is shown), data-toast (its own toast), data-sheet (its own sheet) */
  host: HTMLElement;
  /** the button in the slot, or null */
  button: HTMLButtonElement | null;
}

const ZTOP = 2147483000;
/* the modules by name, also outside the admin */
const MOD_NAMES: Record<string, string> = { site: "Клиентски сайт", masa: "QR маса", waiter: "Сервитьор", watch: "Часовник", kitchen: "Кухня", driver: "Шофьор", admin: "Админ", owner: "Собственик", manager: "Управител" };
/* the folders of the prototype -> the modules of the core (src/core/notes.ts MODULES) */
const ALIAS: Record<string, string> = { servitor: "waiter", kuhnya: "kitchen", shofyor: "driver" };

/* Phosphor 2.1.1 (MIT), the same paths as src/lib/icons/<name>.ts; inline so the pencil needs no icon registry */
const ICON: Record<string, string> = {
  "pencil-simple": "M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z",
  x: "M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z",
  "caret-up": "M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z",
  "caret-down": "M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z",
  "squares-four": "M104,40H56A16,16,0,0,0,40,56v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,104,40Zm0,64H56V56h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,64H152V56h48v48Zm-96,32H56a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,104,136Zm0,64H56V152h48v48Zm96-64H152a16,16,0,0,0-16,16v48a16,16,0,0,0,16,16h48a16,16,0,0,0,16-16V152A16,16,0,0,0,200,136Zm0,64H152V152h48v48Z",
  check: "M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z",
  "check-circle": "M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z",
};
const svg = (n: string, s = 20) => '<svg viewBox="0 0 256 256" width="' + s + '" height="' + s + '" fill="currentColor" aria-hidden="true"><path d="' + ICON[n] + '"/></svg>';
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

/* ---------- styles ---------- */
const T = (n: string, d: string) => "var(--t-" + n + ", " + d + ") var(--ease, ease)";
const UI_CSS = ":host{all:initial; position:fixed; inset:0; pointer-events:none; z-index:" + ZTOP + "; container-type:inline-size; container-name:pen; font-family:var(--font, system-ui, sans-serif); color:var(--ink); -webkit-text-size-adjust:100%}" +
  "*{box-sizing:border-box} svg{flex:none; display:block}" +
  "button{font:inherit; color:inherit; cursor:pointer}" +
  ":focus-visible{outline:3px solid var(--red); outline-offset:2px}" +
  ".fab{position:absolute; right:16px; bottom:var(--fab-b, 24px); pointer-events:auto; display:grid; place-items:center; width:56px; height:56px; padding:0; border:0; border-radius:50%; background:var(--ink); color:var(--bg); box-shadow:var(--shadow-lg); transition:transform " + T("fast", "120ms") + ", background-color " + T("base", "200ms") + ", bottom " + T("slow", "320ms") + "}" +
  /* the tip: on hover and on focus (a round button without text, decision 15.11) */
  ".tip{position:absolute; right:84px; bottom:calc(var(--fab-b, 24px) + 10px); padding:8px 12px; border-radius:12px; background:var(--ink); color:var(--bg); font-weight:700; font-size:14px; white-space:nowrap; box-shadow:var(--shadow); opacity:0; transform:translateX(6px); pointer-events:none; transition:opacity " + T("fast", "120ms") + ", transform " + T("fast", "120ms") + "}" +
  ".fab:hover + .tip, .fab:focus-visible + .tip{opacity:1; transform:none}" +
  ".fab svg{color:var(--ember)} .fab:active{transform:scale(.96)}" +
  '.fab[aria-pressed="true"]{background:var(--ember); color:var(--on-ember)} .fab[aria-pressed="true"] svg{color:var(--on-ember)}' +
  /* recommendations with a new status (the module of the staff member) */
  '.n{position:absolute; top:-4px; right:-4px; min-width:22px; height:22px; padding:0 6px; border-radius:11px; background:var(--ember); color:var(--on-ember); font:800 14px/22px var(--font, system-ui, sans-serif); text-align:center; box-shadow:0 0 0 2px var(--bg)} .fab[aria-pressed="true"] .n{display:none}' +
  "@container pen (max-width:699px){ .fab{right:12px; bottom:var(--fab-bp, 96px)} .tip{right:80px; bottom:calc(var(--fab-bp, 96px) + 10px)}" +
  " :host([data-up]) .fab{bottom:calc(var(--fab-bp, 96px) + 72px)} :host([data-up]) .tip{bottom:calc(var(--fab-bp, 96px) + 82px)}" +
  " :host([data-toast]) .fab, :host([data-toast]) .tip, :host([data-pen-toast]) .fab, :host([data-pen-toast]) .tip{opacity:0; transform:scale(.8); pointer-events:none} }" +
  ":host([data-sheet]) .fab, :host([data-sheet]) .tip, :host([data-pen-sheet]) .fab, :host([data-pen-sheet]) .tip{display:none}" + /* a sheet is open (the caller's: data-sheet; its own: data-pen-sheet): the round button must not cover its buttons */
  ".bar{position:absolute; top:var(--bar-t, 10px); left:50%; transform:translate(-50%,-140%); opacity:0; pointer-events:none; display:flex; align-items:center; gap:8px; max-width:calc(100% - 24px); min-height:60px; padding:6px 6px 6px 20px; border-radius:999px; background:var(--ember); color:var(--on-ember); box-shadow:var(--shadow-lg); transition:transform " + T("slow", "320ms") + ", opacity " + T("slow", "320ms") + "; font-size:16px; line-height:1.3}" +
  ".bar.on{transform:translate(-50%,0); opacity:1; pointer-events:auto}" +
  ".bar .t{min-width:0} .bar .t b{font-weight:800} .bar .t span{font-weight:600}" +
  ".bar .acts{display:flex; gap:6px; flex:none}" +
  ".bb{display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:48px; padding:0 16px; border:0; border-radius:999px; background:color-mix(in srgb, var(--on-ember) 12%, transparent); color:var(--on-ember); font-weight:800; font-size:16px; white-space:nowrap}" +
  ".bb.main{background:var(--on-ember); color:var(--ember)}" +
  ".bb[hidden]{display:none}" +
  "@container pen (max-width:899px){ .bar{top:var(--bar-tp, 8px); left:8px; right:8px; max-width:none; transform:translateY(-140%); border-radius:26px; flex-wrap:wrap; padding:10px 8px 8px 16px} .bar.on{transform:none} .bar .t{flex:1 1 100%; padding-right:8px} .bar .acts{flex:1 1 100%; flex-wrap:wrap} .bar .acts .bb{flex:1 1 auto} }" +
  ".sw{position:absolute; inset:0; pointer-events:none}" +
  ".sw .scrim{position:absolute; inset:0; width:100%; border:0; background:var(--scrim); opacity:0; transition:opacity " + T("slow", "320ms") + "}" +
  ".sw.on{pointer-events:auto} .sw.on .scrim{opacity:1}" +
  ".sheet{position:absolute; left:6px; right:6px; bottom:6px; max-height:88%; display:flex; flex-direction:column; background:var(--surface); color:var(--ink); border-radius:32px; padding:10px 18px 16px; transform:translateY(110%); transition:transform " + T("slow", "320ms") + "; box-shadow:var(--shadow-lg); font-size:16px; line-height:1.5}" +
  ".sw.on .sheet{transform:none}" +
  "@container pen (min-width:700px){ .sheet{left:auto; right:20px; top:20px; bottom:20px; width:460px; max-height:none; transform:translateX(112%)} }" +
  ".handle{width:42px; height:5px; border-radius:3px; background:var(--line-strong); margin:4px auto 10px; flex:none}" +
  ".sh{display:flex; align-items:center; justify-content:space-between; gap:8px; flex:none; margin-bottom:6px}" +
  ".sh h2{margin:0; font-size:24px; line-height:1.15; letter-spacing:-.03em; font-weight:800}" +
  ".x{display:inline-flex; align-items:center; gap:6px; min-height:48px; padding:0 12px; border:0; border-radius:999px; background:transparent; font-weight:700; font-size:16px}" +
  ".x:hover{background:var(--surface-2)}" +
  ".body{flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:2px 2px 6px}" +
  ".meta{display:flex; flex-wrap:wrap; gap:6px; margin:4px 0 14px}" +
  ".tag{display:inline-flex; align-items:center; gap:6px; min-height:30px; padding:0 11px; border-radius:999px; background:var(--surface-2); font-size:14px; font-weight:700; color:var(--ink); white-space:nowrap}" +
  ".tag svg{color:var(--red)}" +
  ".quote{margin:0 0 16px; padding:14px 16px; border-radius:20px; background:var(--surface-2); box-shadow:inset 3px 0 0 var(--red)}" +
  ".quote small{display:block; font-size:14px; font-weight:700; color:var(--muted); margin-bottom:4px}" +
  ".quote p{margin:0; font-size:16px; font-weight:600; overflow-wrap:anywhere}" +
  ".quote p.none{color:var(--muted); font-weight:600; font-style:italic}" +
  "label{display:block; font-weight:700; font-size:15px; margin:0 0 6px}" +
  "textarea{display:block; width:100%; min-height:132px; padding:14px 16px; border:0; border-radius:16px; background:var(--surface); color:var(--ink); box-shadow:inset 0 0 0 1.5px var(--line-strong); font:inherit; font-size:16px; line-height:1.45; resize:vertical; outline:none}" +
  'textarea:focus{box-shadow:inset 0 0 0 2px var(--red)} textarea:focus-visible{outline:none} textarea[aria-invalid="true"]{box-shadow:inset 0 0 0 2px var(--danger)} textarea::placeholder{color:var(--muted)}' +
  ".err{margin:6px 0 0; font-size:14px; font-weight:700; color:var(--danger)}" +
  ".help{margin:6px 0 0; font-size:14px; color:var(--muted)}" +
  "details{margin-top:16px; border-radius:16px; background:var(--surface-2); padding:0 14px}" +
  "summary{min-height:48px; display:flex; align-items:center; font-weight:700; font-size:15px; cursor:pointer; list-style:none} summary::-webkit-details-marker{display:none}" +
  'summary::after{content:"+"; margin-left:auto; font-weight:800; color:var(--muted)} details[open] summary::after{content:"-"}' +
  "dl{margin:0 0 12px; display:grid; gap:8px} dt{font-size:14px; font-weight:700; color:var(--muted)} dd{margin:0; font-size:15px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap:anywhere}" +
  ".foot{display:flex; gap:8px; flex:none; padding-top:12px; margin-top:6px; border-top:1px solid var(--line)}" +
  ".pill{flex:1; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:56px; padding:0 18px; border:0; border-radius:999px; font-weight:800; font-size:17px; white-space:nowrap; transition:transform " + T("fast", "120ms") + "}" +
  ".pill:active{transform:scale(.97)} .pill.red{background:var(--red); color:var(--on-red); flex:1.6} .pill.line{background:transparent; color:var(--ink); box-shadow:inset 0 0 0 1.5px var(--line-strong)}" +
  ".pill{min-width:0} .pill[disabled]{opacity:.7; cursor:progress}" +
  "@container pen (max-width:439px){ .foot{flex-direction:column-reverse; gap:6px} .foot .pill{flex:none; width:100%; min-height:52px} }" +
  ".toast{position:absolute; left:50%; bottom:28px; transform:translate(-50%,160%); opacity:0; pointer-events:none; display:flex; align-items:center; gap:10px; min-height:56px; padding:6px 6px 6px 20px; border-radius:999px; background:var(--ink); color:var(--bg); font-weight:700; font-size:16px; box-shadow:var(--shadow-lg); max-width:calc(100% - 24px); width:max-content; transition:transform " + T("slow", "320ms") + ", opacity " + T("slow", "320ms") + "}" +
  ".toast.on{transform:translate(-50%,0); opacity:1; pointer-events:auto}" +
  ".toast svg{color:var(--ok)}" +
  ".toast a{flex:none; min-height:44px; padding:0 16px; border-radius:999px; background:color-mix(in srgb, var(--bg) 18%, transparent); color:inherit; font-weight:800; text-decoration:none; display:inline-flex; align-items:center}" +
  "@container pen (max-width:699px){ .toast{bottom:var(--toast-bp, 96px)} }" +
  "@container pen (min-width:700px){ :host([data-toast-top]) .toast{bottom:auto; top:var(--toast-t, 16px); transform:translate(-50%,-160%)} :host([data-toast-top]) .toast.on{transform:translate(-50%,0)} }" +
  "@media (prefers-reduced-motion: reduce){ *{transition-duration:1ms !important} }";
const LAYER_CSS = ":host{all:initial; position:fixed; inset:0; pointer-events:none; z-index:" + (ZTOP - 1) + "}" +
  ".box{position:absolute; left:0; top:0; width:0; height:0; border:2px solid var(--red); border-radius:8px; background:color-mix(in srgb, var(--red) 7%, transparent); box-shadow:0 0 0 4px color-mix(in srgb, var(--red) 16%, transparent); opacity:0; transition:opacity 120ms ease}" +
  ".box.on{opacity:1} .box.picked{border-width:3px; box-shadow:0 0 0 6px color-mix(in srgb, var(--red) 24%, transparent)}" +
  ".box.mark{border-color:var(--red); animation:pulse 1.6s cubic-bezier(.32,.72,0,1) 3}" +
  "@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--red) 45%, transparent)} 100%{box-shadow:0 0 0 18px transparent}}" +
  ".lab{position:absolute; left:0; top:0; max-width:calc(100vw - 16px); padding:6px 11px; border-radius:999px; background:var(--red); color:var(--on-red); font:700 14px/1.2 var(--font, system-ui, sans-serif); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-shadow:0 6px 16px -6px color-mix(in srgb, var(--ink) 50%, transparent); opacity:0}" +
  ".lab.on{opacity:1}" +
  "@media (prefers-reduced-motion: reduce){ .box.mark{animation:none} }";
/* the button in the module's slot (light DOM, in the module's flow): icon and word, 48 px, tokens only */
const SLOT_CSS = ".sa-pen-btn{position:relative; display:inline-flex; align-items:center; gap:8px; min-height:48px; min-width:48px; padding:0 16px 0 14px; border:0; border-radius:999px; background:var(--glass); color:var(--ink); -webkit-backdrop-filter:blur(16px); backdrop-filter:blur(16px); box-shadow:inset 0 0 0 1px var(--line-strong); font:800 15px/1 var(--font, system-ui, sans-serif); cursor:pointer; -webkit-tap-highlight-color:transparent}" +
  ".sa-pen-btn:active{transform:scale(.96)} .sa-pen-btn:focus-visible{outline:3px solid var(--red); outline-offset:2px}" +
  '.sa-pen-btn svg{flex:none; display:block; color:var(--red)} .sa-pen-btn[aria-pressed="true"]{background:var(--ember); color:var(--on-ember)} .sa-pen-btn[aria-pressed="true"] svg{color:inherit}' +
  ".sa-pen-n{position:absolute; top:-4px; right:-4px; min-width:22px; height:22px; padding:0 6px; border-radius:11px; background:var(--ember); color:var(--on-ember); font:800 14px/22px var(--font, system-ui, sans-serif); text-align:center}" +
  '.sa-pen-btn[aria-pressed="true"] .sa-pen-n{display:none}' +
  "@media (min-width:700px){ .sa-pen-btn{min-height:52px; padding:0 20px 0 16px; font-size:16px} }";

/* ---------- the outline layer (one per pointed window) ---------- */
interface Layer { host: HTMLElement; box: HTMLElement; lab: HTMLElement; el: Element | null; avoidY: number; draw(el: Element | null, label: string | null, cls?: string): void; clear(): void; off(): void }
const layers = new WeakMap<Window, Layer>();
function layerOf(win: Window): Layer {
  const have = layers.get(win);
  if (have && have.host.isConnected) return have;
  const doc = win.document, host = doc.createElement("sa-pen-layer");
  host.setAttribute("aria-hidden", "true");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = "<style>" + LAYER_CSS + '</style><div class="box"></div><div class="lab"></div>';
  (doc.documentElement || doc.body).appendChild(host);
  let raf = 0;
  const L: Layer = {
    host, box: root.querySelector(".box") as HTMLElement, lab: root.querySelector(".lab") as HTMLElement, el: null, avoidY: 0,
    draw(el, label, cls) {
      L.el = el;
      if (!el || !el.isConnected) { L.box.classList.remove("on"); L.lab.classList.remove("on"); return; }
      const r = el.getBoundingClientRect(), pad = 3, x = r.left - pad, y = r.top - pad, w = r.width + pad * 2, h = r.height + pad * 2;
      L.box.style.width = w + "px"; L.box.style.height = h + "px"; L.box.style.transform = "translate(" + x + "px," + y + "px)";
      L.box.className = "box on" + (cls ? " " + cls : "");
      if (label != null) L.lab.textContent = label;
      const top0 = Math.max(4, L.avoidY || 0), lw = Math.min(L.lab.offsetWidth || 160, win.innerWidth - 16);
      let ly = y - 34 < top0 ? Math.min(y + h + 6, win.innerHeight - 34) : y - 34, lx = Math.max(8, Math.min(x, win.innerWidth - lw - 8));
      if (y - 34 < top0 && y + h + 40 > win.innerHeight) { ly = Math.max(4, y + 6); lx = Math.max(8, Math.min(x + 6, win.innerWidth - lw - 8)); }
      L.lab.style.transform = "translate(" + lx + "px," + ly + "px)"; L.lab.classList.add("on");
    },
    clear() { L.el = null; L.box.className = "box"; L.lab.classList.remove("on"); },
    off() { win.removeEventListener("scroll", re, true); win.removeEventListener("resize", re); host.remove(); layers.delete(win); },
  };
  function re() { if (raf) return; raf = win.requestAnimationFrame(() => { raf = 0; if (L.el) L.draw(L.el, null, L.box.className.replace(/^box ?(on)? ?/, "")); }); }
  win.addEventListener("scroll", re, true); win.addEventListener("resize", re);
  layers.set(win, L);
  return L;
}

/** "Покажи на страницата": outline a stored note in a document (the preview frame). false when the element is not there. */
export function showNote(doc: Document, selector: string, text: string): boolean {
  const win = doc.defaultView;
  if (!win) return false;
  const L = layerOf(win);
  let el: Element | null = null;
  try { el = doc.querySelector(selector); } catch { /* bad selector */ }
  if (!el) { L.clear(); return false; }
  try { el.scrollIntoView({ block: "center", inline: "nearest" }); } catch { el.scrollIntoView(); }
  const found = el;
  setTimeout(() => L.draw(found, "Бележка: " + clean(text).slice(0, 60), "mark picked"), 260);
  return true;
}
export function hideNote(doc: Document): void { const w = doc.defaultView; if (w) layers.get(w)?.clear(); }

/* ---------- mount ---------- */
export function mountPencil(o: PencilOptions): Pencil {
  const REC = !o.sectionNotes, ui = window, udoc = document;
  const mod = ALIAS[o.module] || o.module;
  let closeSheet: (() => void) | null = null;
  let on = false, sheetOpen = false, lastType = "mouse", cand: Element | null = null, stack: Element[] = [], saved = 0, tw: Window | null = null, backTo: Element | null = null, badgeN = 0, gone = false;
  const getDoc = (): Document => { const d = typeof o.doc === "function" ? o.doc() : o.doc; return d || udoc; };
  const host = udoc.createElement("sa-pen-ui"), root = host.attachShadow({ mode: "open" });
  const slot = o.slot || null, roundFab = !slot && o.fab !== false;
  if (o.barTop) { host.style.setProperty("--bar-tp", o.barTop[0] + "px"); host.style.setProperty("--bar-t", o.barTop[1] + "px"); }
  if (o.fabBottom) { host.style.setProperty("--fab-bp", o.fabBottom[0] + "px"); host.style.setProperty("--fab-b", o.fabBottom[1] + "px"); }
  if (o.toastBottom != null) host.style.setProperty("--toast-bp", o.toastBottom + "px");
  if (o.toastTop != null) host.style.setProperty("--toast-t", o.toastTop + "px");
  const TIP = REC ? "Молив: препоръка" : "Молив: бележка за промяна";
  root.innerHTML = "<style>" + UI_CSS + "</style>" +
    (roundFab ? '<button class="fab" type="button" aria-pressed="false" aria-label="Молив" data-fab>' + svg("pencil-simple", 26) + '</button><span class="tip" aria-hidden="true">' + TIP + "</span>" : "") +
    '<div class="bar" role="status" aria-live="polite"><div class="t"></div><div class="acts"><button class="bb main" type="button" data-pick hidden>Бележка за това</button><button class="bb" type="button" data-up hidden>' + svg("caret-up", 18) + 'Разшири</button><button class="bb" type="button" data-down hidden>' + svg("caret-down", 18) + 'Стесни</button><button class="bb" type="button" data-offb>' + svg("x", 18) + "Изключи</button></div></div>" +
    '<div class="sw"></div><div class="toast" role="status" aria-live="polite"></div>';
  udoc.body.appendChild(host);
  const $ = <E extends Element>(s: string) => root.querySelector(s) as E;
  const fab = roundFab ? $<HTMLButtonElement>("[data-fab]") : null, bar = $<HTMLElement>(".bar"), sw = $<HTMLElement>(".sw"), toastEl = $<HTMLElement>(".toast");
  /* the bar is only see-through while the pencil is off: its buttons must not be reached with Tab then (kuhnya.review-2) */
  bar.inert = true; toastEl.inert = true;

  /* the module's button in its slot: icon and word ("Молив" / "Изключи") */
  let btn: HTMLButtonElement | null = null;
  if (slot) {
    if (!udoc.getElementById("sa-pen-btn-css")) { const st = udoc.createElement("style"); st.id = "sa-pen-btn-css"; st.textContent = SLOT_CSS; udoc.head.appendChild(st); }
    btn = udoc.createElement("button"); btn.type = "button"; btn.className = "sa-pen-btn"; btn.setAttribute("aria-pressed", "false");
    slot.appendChild(btn);
    btn.addEventListener("click", () => setOn(!on));
  }
  const tdoc = () => (tw ? tw.document : null);

  function barText() {
    const touch = lastType === "touch";
    let t: string;
    if (cand && touch) t = "<b>Оградено:</b> <span>" + esc(describe(cand)) + ". " + (o.ti ? "Докосни" : "Докоснете") + " пак или „Бележка за това“.</span>";
    else if (touch) t = "<b>" + (REC ? "Препоръка" : "Моливът е включен") + "</b> <span>· " + (o.ti ? "Докосни" : "Докоснете") + " елемент</span>";
    else t = "<b>" + (REC ? "Препоръка" : "Моливът е включен") + "</b> <span>· " + (o.ti ? "Избери" : "Изберете") + " елемент · Esc за изход</span>";
    if (saved) t += " <span>· Записани: " + saved + "</span>";
    $<HTMLElement>(".bar .t").innerHTML = t;
    const d = tdoc();
    $<HTMLElement>("[data-pick]").hidden = !(cand && (touch || lastType === "key"));
    $<HTMLElement>("[data-up]").hidden = !cand || !cand.parentElement || cand.parentElement === (d && d.body);
    $<HTMLElement>("[data-down]").hidden = !cand || !stack.length;
  }
  function label(el: Element) { const ed = el.closest("[data-edit-id]"); return describe(el) + (ed ? " · " + ed.getAttribute("data-edit-id") : ""); }
  function setCand(el: Element | null, keepStack?: boolean) {
    cand = el; if (!keepStack) stack = [];
    if (!tw) return;
    const L = layerOf(tw);
    /* the label must not go under the ember bar (same window only; in the frame the bar is outside) */
    L.avoidY = tw === ui && on ? bar.getBoundingClientRect().bottom + 4 : 0;
    if (!el) { L.clear(); barText(); return; }
    L.draw(el, label(el), lastType === "touch" || lastType === "key" ? "picked" : "");
    barText();
    if (lastType === "touch" || lastType === "key") requestAnimationFrame(clearOfBar);
  }
  /* the bar is drawn over the top of the screen: scroll the outlined element just under it */
  function clearOfBar() {
    if (!cand || !cand.isConnected || !tw) return;
    const w = tw, br = bar.getBoundingClientRect(), r = cand.getBoundingClientRect();
    let sc = 1, top = r.top;
    if (w !== ui) { try { const fr = (w.frameElement as HTMLElement).getBoundingClientRect(); sc = fr.width / (w.innerWidth || fr.width) || 1; top = fr.top + r.top * sc; } catch { return; } }
    const need = (br.bottom + 12 - top) / sc;
    if (need <= 0) return;
    let p = cand.parentElement;
    while (p && p !== w.document.body && p !== w.document.documentElement) {
      const cs = w.getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight) { p.scrollTop -= need; break; }
      p = p.parentElement;
    }
    if (!p || p === w.document.body || p === w.document.documentElement) w.scrollBy(0, -need);
    setTimeout(() => { if (cand && tw) layerOf(tw).draw(cand, null, "picked"); }, 30);
  }
  function ours(e: Event) {
    const p = e.composedPath ? e.composedPath() : [];
    for (const x of p) { if (x === host || x === btn || (x instanceof Element && /^SA-PEN-/i.test(x.tagName))) return true; }
    return false;
  }

  /* --- events on the pointed window (capture phase: the page never sees them while the pencil is on) --- */
  type PE = PointerEvent & MouseEvent;
  const stop = (e: Event) => { e.stopPropagation(); };
  const block = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  const H: Record<string, (e: Event) => void> = {
    pointermove(e) { const p = e as PE; if (!on || sheetOpen || ours(e) || p.pointerType === "touch") return; lastType = p.pointerType || "mouse"; const el = resolve(e.target, tw!); if (el !== cand) setCand(el); },
    pointerdown(e) { const p = e as PE; if (!on || ours(e)) return; lastType = p.pointerType || "mouse"; e.stopPropagation(); if (lastType !== "touch") e.preventDefault(); },
    mousedown(e) { if (!on || ours(e)) return; block(e); },
    pointerup(e) { if (!on || ours(e)) return; stop(e); },
    mouseup(e) { if (!on || ours(e)) return; stop(e); },
    touchstart(e) { if (!on || ours(e)) return; lastType = "touch"; stop(e); },
    touchend(e) { if (!on || ours(e)) return; stop(e); },
    dblclick(e) { if (!on || ours(e)) return; block(e); },
    auxclick(e) { if (!on || ours(e)) return; block(e); },
    submit(e) { if (!on || ours(e)) return; block(e); },
    click(e) {
      if (!on || ours(e)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (sheetOpen) return;
      const el = resolve(e.target, tw!);
      if (!el) return;
      if (lastType === "touch") { if (cand && (cand === el || cand.contains(el))) openSheet(); else setCand(el); return; }
      if (el !== cand) setCand(el);
      openSheet();
    },
    pointerleave(e) { if (!on || sheetOpen || lastType === "touch") return; const d = tdoc(); if (d && (e.target === d || e.target === d.documentElement)) setCand(null); },
    focusin(e) { if (!on || sheetOpen || ours(e) || lastType !== "key") return; const el = resolve(e.target, tw!); if (el) setCand(el); },
    keydown(e) { if (!on || ours(e)) return; key(e as KeyboardEvent); },
  };
  const PASSIVE = ["touchstart", "touchend", "pointermove"];
  const bound = new Map<Window, Record<string, (e: Event) => void>>();
  function key(e: KeyboardEvent) {
    /* the sheet has its own keys; Esc outside it (the focus still in the page) closes it too */
    if (sheetOpen) { if (e.key === "Escape" && closeSheet) { e.preventDefault(); e.stopPropagation(); closeSheet(); } return; }
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); off(); return; }
    if (e.key === "Tab") { lastType = "key"; return; }
    if (!cand) return;
    if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); widen(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); narrow(); }
    else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); openSheet(); }
  }
  function widen() { const d = tdoc(); if (!cand || !cand.parentElement || (d && cand.parentElement === d.body)) return; stack.push(cand); setCand(cand.parentElement, true); }
  function narrow() { const x = stack.pop(); if (x) setCand(x, true); }
  function attach(win: Window | null) {
    if (!win || !win.document) return;
    tw = win;
    if (bound.has(win)) return;
    const fns: Record<string, (e: Event) => void> = {};
    for (const k of Object.keys(H)) { fns[k] = (e) => { if (win === tw) H[k](e); }; win.addEventListener(k, fns[k], { capture: true, passive: PASSIVE.includes(k) }); }
    bound.set(win, fns);
  }
  function detachAll() {
    bound.forEach((fns, win) => { for (const k of Object.keys(fns)) { try { win.removeEventListener(k, fns[k], { capture: true }); } catch { /* the frame is gone */ } } });
    bound.clear();
  }
  /* Esc in this window too (the frame of the preview may not have the focus) */
  const uiKey = (e: KeyboardEvent) => { if (!on || tw === ui || ours(e)) return; key(e); };
  ui.addEventListener("keydown", uiKey, true);

  /* --- the sheet --- */
  function openSheet() {
    if (!cand || !tw) return;
    const el = cand, w = tw;
    sheetOpen = true; backTo = udoc.activeElement;
    host.setAttribute("data-pen-sheet", "");
    layerOf(w).draw(el, describe(el), "picked");
    const url = o.url ? o.url() : w.location.pathname + w.location.hash;
    const vp = o.viewport ? o.viewport() : { w: w.innerWidth, h: w.innerHeight };
    const etxt = elementText(el), edit = el.closest("[data-edit-id]"), sel = selectorFor(el), mname = MOD_NAMES[mod] || mod;
    const page = (o.page && o.page()) || clean((w.document.title || "").split("|")[0]) || url.split("/").filter(Boolean).pop() || url;
    sw.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pen-h">' +
      '<div class="handle"></div><div class="sh"><h2 id="pen-h">' + (REC ? "Какво да подобрим?" : "Какво да се промени?") + '</h2><button class="x" type="button" data-x>' + svg("x", 20) + "Затвори</button></div>" +
      '<div class="body"><div class="meta"><span class="tag">' + svg("squares-four", 16) + esc(mname) + '</span><span class="tag">' + esc(page) + '</span><span class="tag">' + Math.round(vp.w) + " × " + Math.round(vp.h) + "</span></div>" +
      '<figure class="quote"><small>' + esc(kindOf(el)) + "</small>" + (etxt ? "<p>„" + esc(etxt.length > 280 ? etxt.slice(0, 278) + " …" : etxt) + "“</p>" : '<p class="none">Елемент без текст</p>') + "</figure>" +
      (REC ? '<p class="help" style="margin:0 0 12px">Препоръката отива при главния админ. Тя не променя нищо, докато той не я одобри.</p>' : "") +
      '<label for="pen-t">' + (REC ? "Препоръка" : "Бележка") + '</label><textarea id="pen-t" placeholder="Например: по-голям текст, друга дума, ' + (o.ti ? "махни" : "махнете") + ' това" aria-describedby="pen-help"></textarea><p class="err" id="pen-err" hidden>Напишете какво да се промени.</p><p class="help" id="pen-help">Записва се с адреса, елемента и размера на екрана.' + (matchMedia("(pointer: fine)").matches ? " Ctrl + Enter записва." : "") + '</p>' +
      "<details><summary>Технически данни</summary><dl><dt>Адрес</dt><dd>" + esc(url) + "</dd><dt>CSS селектор</dt><dd>" + esc(sel) + "</dd><dt>data-edit-id</dt><dd>" + (edit ? esc(edit.getAttribute("data-edit-id")) : "няма") + "</dd></dl></details></div>" +
      '<div class="foot"><button class="pill line" type="button" data-x>Откажи</button><button class="pill red" type="button" data-save>' + svg("check", 22) + (REC ? "Изпрати препоръката" : "Запази бележката") + "</button></div></div>";
    const ta = sw.querySelector("textarea") as HTMLTextAreaElement, err = sw.querySelector(".err") as HTMLElement, saveBtn = sw.querySelector("[data-save]") as HTMLButtonElement;
    let busy = false;
    function close() {
      closeSheet = null; sheetOpen = false; sw.classList.remove("on"); host.removeAttribute("data-pen-sheet");
      setTimeout(() => { if (!sheetOpen) sw.innerHTML = ""; }, 340);
      if (cand && on) setCand(cand, true);
      try {
        if (tw && tw !== ui) (tw.frameElement as HTMLElement | null)?.focus();
        const el2 = cand as HTMLElement | null;
        if (el2 && el2.isConnected && (el2.tabIndex >= 0 || /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el2.tagName))) el2.focus({ preventScroll: true });
        else if (fab && fab.offsetParent) fab.focus({ preventScroll: true });
        else if (btn && btn.isConnected) btn.focus({ preventScroll: true });
        else if (backTo && (backTo as HTMLElement).focus) (backTo as HTMLElement).focus({ preventScroll: true });
      } catch { /* the frame is gone */ }
    }
    function fail(msg: string) { err.textContent = msg; err.hidden = false; ta.setAttribute("aria-invalid", "true"); ta.setAttribute("aria-describedby", "pen-err pen-help"); ta.focus(); }
    async function save() {
      if (busy) return;
      const text = ta.value.trim();
      if (!text) { fail("Напишете какво да се промени."); return; }
      const note: NoteInput = { module: mod, url, selector: sel, editId: edit ? edit.getAttribute("data-edit-id") : null, text: text.slice(0, 4000), elementText: etxt.slice(0, 500), viewport: { w: Math.round(vp.w), h: Math.round(vp.h) }, screenshot: null };
      busy = true; saveBtn.disabled = true; saveBtn.setAttribute("aria-busy", "true");
      try { await o.onSave(note); }
      catch (e) { busy = false; saveBtn.disabled = false; saveBtn.removeAttribute("aria-busy"); fail((e instanceof Error && e.message) || (o.ti ? "Не се записа. Опитай пак." : "Не се записа. Опитайте пак.")); return; }
      if (gone) return;
      saved++; close();
      toast(REC ? "Препоръката е изпратена" : "Бележката е записана", o.notesHref ? { label: REC ? "Моите препоръки" : "Виж бележките", href: o.notesHref } : null);
      barText();
    }
    closeSheet = close;
    sw.querySelectorAll<HTMLElement>("[data-x]").forEach((b) => { b.onclick = close; });
    (sw.querySelector(".scrim") as HTMLElement).onclick = close;
    saveBtn.onclick = () => { void save(); };
    ta.addEventListener("input", () => { if (ta.value.trim()) { err.hidden = true; ta.removeAttribute("aria-invalid"); ta.setAttribute("aria-describedby", "pen-help"); } });
    sw.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); return; }
      if (e.key === "Tab") {
        const f = Array.from(sw.querySelectorAll<HTMLElement>("button:not([tabindex]), textarea, summary")), a = f[0], z = f[f.length - 1], act = root.activeElement;
        if (e.shiftKey && act === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && act === z) { e.preventDefault(); a.focus(); }
      }
    });
    /* a quick Esc (or "Затвори") before these two frames must not open it again */
    requestAnimationFrame(() => requestAnimationFrame(() => { if (closeSheet !== close) return; sw.classList.add("on"); ta.focus({ preventScroll: true }); }));
  }

  let tt: ReturnType<typeof setTimeout> | undefined;
  function toast(text: string, link: { label: string; href: string } | null) {
    const top = typeof o.toastWideTop === "function" ? o.toastWideTop() : o.toastWideTop ?? !!slot;
    if (top) host.setAttribute("data-toast-top", ""); else host.removeAttribute("data-toast-top");
    toastEl.innerHTML = svg("check-circle", 22) + "<span>" + esc(text) + "</span>" + (link ? '<a href="' + esc(link.href) + '">' + esc(link.label) + "</a>" : "");
    /* the round button steps aside on the phone while its toast is up (the "Виж" link is never under it) */
    host.setAttribute("data-pen-toast", "");
    toastEl.inert = false;
    requestAnimationFrame(() => toastEl.classList.add("on"));
    clearTimeout(tt);
    tt = setTimeout(() => { toastEl.classList.remove("on"); toastEl.inert = true; host.removeAttribute("data-pen-toast"); }, 5200);
  }

  /* --- the buttons --- */
  function paint() {
    const nb = badgeN > 0 ? badgeN + (badgeN === 1 ? " препоръка с нов статус" : " препоръки с нов статус") : "";
    const name = on ? "Изключи молива" : "Молив" + (nb ? ", " + nb : "");
    const badge = (c: string) => (badgeN > 0 && !on ? '<span class="' + c + '" aria-hidden="true">' + badgeN + "</span>" : "");
    if (fab) {
      fab.setAttribute("aria-pressed", String(on)); fab.setAttribute("aria-label", name);
      fab.innerHTML = svg(on ? "x" : "pencil-simple", 26) + badge("n");
      const tp = root.querySelector(".tip"); if (tp) tp.textContent = on ? "Изключи молива" : TIP + (nb ? " · " + nb : "");
    }
    if (btn) {
      btn.setAttribute("aria-pressed", String(on)); btn.setAttribute("aria-label", name);
      btn.innerHTML = svg(on ? "x" : "pencil-simple", 22) + "<span>" + (on ? "Изключи" : "Молив") + "</span>" + badge("sa-pen-n");
      btn.title = on ? "Изключи молива" : nb ? nb + ": „Моите препоръки“" : REC ? "Молив: препоръка" : "Молив: бележка";
    }
  }
  function setOn(v: boolean) {
    on = !!v;
    /* the phone: no "Esc за изход" */
    if (on && lastType === "mouse" && ui.matchMedia && ui.matchMedia("(hover: none)").matches) lastType = "touch";
    paint();
    bar.classList.toggle("on", on);
    bar.inert = !on;
    /* the page under the bar may make room for it (the staff apps move their "Няма връзка" strip below it):
       html[data-pen-on] + --pen-bar-b, the bottom edge of the bar in px */
    const de = udoc.documentElement;
    if (on) { de.setAttribute("data-pen-on", ""); requestAnimationFrame(() => {
      /* the final place of the bar, not where its slide-in is now: the parent's top + the bar's own top and height (no transform) */
      if (!on) return;
      const top = bar.offsetParent ? (bar.offsetParent as HTMLElement).getBoundingClientRect().top : 0;
      de.style.setProperty("--pen-bar-b", Math.round(top + bar.offsetTop + bar.offsetHeight) + "px");
    }); }
    else { de.removeAttribute("data-pen-on"); de.style.removeProperty("--pen-bar-b"); }
    if (on) { attach(getDoc().defaultView); barText(); }
    else { cand = null; stack = []; if (tw) layers.get(tw)?.clear(); }
    o.onToggle && o.onToggle(on);
  }
  function off() { if (on) setOn(false); }
  root.addEventListener("keydown", (e) => { const k = e as KeyboardEvent; if (k.key === "Escape" && on && !sheetOpen) { e.preventDefault(); e.stopPropagation(); off(); if (fab && fab.offsetParent) fab.focus(); } });
  btn?.addEventListener("keydown", (e) => { if (e.key === "Escape" && on && !sheetOpen) { e.preventDefault(); e.stopPropagation(); off(); } });
  root.addEventListener("pointerdown", (e) => { const p = e as PointerEvent; if (p.pointerType) lastType = p.pointerType; }, true);
  fab?.addEventListener("click", () => setOn(!on));
  $<HTMLElement>("[data-offb]").onclick = off;
  $<HTMLElement>("[data-pick]").onclick = () => openSheet();
  $<HTMLElement>("[data-up]").onclick = widen;
  $<HTMLElement>("[data-down]").onclick = narrow;
  badgeN = Math.max(0, Math.floor(o.badge || 0));
  paint();

  return {
    toggle: () => setOn(!on),
    on: () => on,
    off,
    setBadge(n: number) { badgeN = Math.max(0, Math.floor(+n || 0)); paint(); },
    retarget(doc?: Document) {
      cand = null; stack = [];
      const w = (doc || getDoc()).defaultView;
      if (on) { attach(w); barText(); } else tw = w;
    },
    destroy() {
      gone = true; off(); clearTimeout(tt);
      detachAll(); ui.removeEventListener("keydown", uiKey, true);
      if (tw) layers.get(tw)?.off();
      host.remove(); btn?.remove();
      if (!udoc.querySelector(".sa-pen-btn")) udoc.getElementById("sa-pen-btn-css")?.remove();
    },
    host, button: btn,
  };
}
