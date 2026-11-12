/* Browser runtime loaded by Base.astro on every page (port of design/ds/sc.js).
   The chrome is already rendered by the server; this file wires it up and exposes window.SC with the SAME API as
   the prototype, so page scripts can be ported with minimal changes:
     - SC.mount(opts) returns the already rendered <main> (does not draw again),
     - links: "dish.html#id" -> SC.url.dish(id) (or SC.fromProto("dish.html#id")),
     - the document scrolls (not SC.scroller): use window.scrollY / window.scrollTo and IntersectionObserver root:null.
       SC.scroller keeps scrollTop / scrollTo / scrollBy / scroll listeners / getBoundingClientRect working as a shim. */
/* SIZE BUDGET: this file is on every page. It must NOT import the menu (lib/data.ts), the illustrations (art.ts) or
   the full icon set. Pages that need menu data import "./sc-menu.ts" (same SC object, with SC.items, SC.dishCard ...). */
import * as F from "../lib/format.ts";
import * as T from "../lib/status.ts";
import * as C from "../lib/consts.ts";
import * as cartLib from "../lib/cart.ts";
import { events, EVENT_SLUGS } from "../lib/events.ts";
import { ic, loadAllIcons, statusHTML, sheetHTML } from "../lib/chrome-core.ts";
import type { CookiePrefs } from "../lib/chrome-sheets.ts";
import { configureRoutes, url, fromProto } from "../lib/routes.ts";
import { setClock, setPreview, parseTime, now, minutes } from "../lib/time.ts";
import { resolveDish } from "../lib/registry.ts";
import { lunchIsToday } from "../lib/lunch.ts";
import type { Cart, CartLine, Mode } from "../lib/cart.ts";
import type { AiKind } from "../lib/assistant.ts";

const de = document.documentElement;
const DEMO = de.dataset.demo === "1";
configureRoutes({ demo: DEMO, root: de.dataset.root || "/" });

const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- storage (per-viewer convenience) ---------- */
function load<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
function store(k: string, v: unknown): void { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }

interface Prefs { theme: "system" | "light" | "dark"; view?: string; time?: string; preview?: boolean }
const prefs = load<Prefs>("sc-prefs", { theme: "system", time: "now" });

/* ---------- clock override: ONLY in the demo build or a preview frame (?preview=1 or sc-prefs.preview) ----------
   Sources: ?t=21:30 in the address, else sc-prefs.time. Real pages always use the Sofia clock. */
const qs = new URLSearchParams(location.search);
const previewMode = DEMO || prefs.preview === true || qs.has("preview");
if (previewMode) {
  setPreview(true);
  const t = qs.get("t");
  /* ?t= is remembered for the next pages of the review (demo / preview only); ?t=now goes back to the real clock */
  if (t === "now") { prefs.time = "now"; store("sc-prefs", prefs); }
  else if (t && parseTime(t)) { setClock(t); prefs.time = t; store("sc-prefs", prefs); }
  else if (prefs.time && prefs.time !== "now") setClock(prefs.time);
}

/* ---------- elements rendered by Base.astro ---------- */
const device = document.querySelector<HTMLElement>(".device")!;
const scroller = document.querySelector<HTMLElement>("[data-scroller]")!;
const ov = document.querySelector<HTMLElement>("[data-ov]")!;
const main = document.querySelector<HTMLElement>("[data-main]")!;

/* SC.scroller shim: the prototype scrolled an inner div; the code scrolls the document. */
(function shim(el: HTMLElement) {
  const se = () => document.scrollingElement || de;
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => window.scrollY, set: (v: number) => window.scrollTo(0, v) });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => window.innerHeight });
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => se().scrollHeight });
  el.scrollTo = ((a: ScrollToOptions | number, b?: number) => (typeof a === "number" ? window.scrollTo(a, b || 0) : window.scrollTo(a))) as typeof el.scrollTo;
  el.scrollBy = ((a: ScrollToOptions | number, b?: number) => (typeof a === "number" ? window.scrollBy(a, b || 0) : window.scrollBy(a))) as typeof el.scrollBy;
  el.getBoundingClientRect = () => new DOMRect(0, 0, window.innerWidth, window.innerHeight);
  const add = el.addEventListener.bind(el), rem = el.removeEventListener.bind(el);
  el.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: boolean | AddEventListenerOptions) => (type === "scroll" ? window.addEventListener(type, fn, o) : add(type, fn, o))) as typeof el.addEventListener;
  el.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: boolean | EventListenerOptions) => (type === "scroll" ? window.removeEventListener(type, fn, o) : rem(type, fn, o))) as typeof el.removeEventListener;
})(scroller);

/* ---------- cart store (localStorage "sc-cart", same format as the prototype) ---------- */
let cart: Cart = cartLib.sanitize(load("sc-cart", null));
const listeners: ((c: Cart) => void)[] = [];
function saveCart(c: Cart) { cart = c; store("sc-cart", cart); listeners.forEach((f) => f(cart)); updateCartUI(true); }
window.addEventListener("storage", (e) => { if (e.key === "sc-cart") { cart = cartLib.sanitize(load("sc-cart", null)); listeners.forEach((f) => f(cart)); updateCartUI(false); } });

const cartApi = {
  get: () => cart,
  lines: () => cart.lines,
  count: () => cartLib.count(cart),
  subtotal: () => cartLib.subtotal(cart),
  /** opts.p / opts.n: price and name when the menu is not loaded on this page (the "+" buttons carry data-p) */
  add: (id: string, q = 1, opts: { mods?: string[]; extra?: number; p?: number; n?: string } = {}) => {
    saveCart(cartLib.addLine(cart, id, q, opts));
    if (!resolveDish(id) && opts.p == null) import("../lib/data.ts").then(() => saveCart(cartLib.sanitize({ ...cart, lines: cart.lines.map((l) => (l.id === id && l.p == null ? { ...l, p: resolveDish(id)?.p, n: resolveDish(id)?.n } : l)) })));
  },
  setQty: (key: string, q: number) => saveCart(cartLib.setQty(cart, key, q)),
  remove: (key: string): CartLine | undefined => { const r = cartLib.removeLine(cart, key); saveCart(r.cart); return r.gone; },
  restore: (line: CartLine) => saveCart({ ...cart, lines: [...cart.lines, line] }),
  clear: () => saveCart({ ...cart, lines: [] }),
  mode: (m?: Mode): Mode => { if (m) saveCart({ ...cart, mode: m }); return cart.mode; },
  on: (f: (c: Cart) => void) => { listeners.push(f); },
};

function updateCartUI(bump: boolean) {
  const n = cartApi.count(), s = cartApi.subtotal();
  document.querySelectorAll<HTMLElement>("[data-cnt]").forEach((el) => {
    el.textContent = String(n); el.hidden = n === 0;
    if (bump && !reduce) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
  });
  document.querySelectorAll("[data-cartnav]").forEach((b) => b.setAttribute("aria-label", n ? "Количка, " + F.plural(n, "ястие", "ястия") + ", " + F.fmt(s) : "Количка, празна"));
}

/* ---------- motion helpers ---------- */
function fly(fromEl: Element | null, id: string) {
  if (reduce || !fromEl) return;
  const to = document.querySelector("[data-cartnav]");
  if (!to) return;
  const a = fromEl.getBoundingClientRect(), b = to.getBoundingClientRect(), el = document.createElement("div");
  /* the illustration is cloned from the page (no art.ts in the runtime); without one, a plain dot */
  const src = (fromEl.closest(".dcard, .drow, .prow, [data-dish-card]") || document).querySelector('svg[data-dish="' + id + '"]') || document.querySelector('svg[data-dish="' + id + '"]');
  el.className = "fly"; el.innerHTML = src ? src.outerHTML : '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="16" fill="var(--red)"/></svg>';
  const x0 = a.left + a.width / 2 - 20, y0 = a.top + a.height / 2 - 20, dx = b.left + b.width / 2 - 20 - x0, dy = b.top + b.height / 2 - 20 - y0;
  el.style.left = x0 + "px"; el.style.top = y0 + "px"; ov.appendChild(el);
  el.animate([{ transform: "translate(0,0) scale(1) rotate(0)" }, { transform: "translate(" + dx * .5 + "px," + (dy * .5 - 40) + "px) scale(.9) rotate(120deg)", offset: .5 }, { transform: "translate(" + dx + "px," + dy + "px) scale(.35) rotate(240deg)", opacity: .7 }], { duration: 400, easing: "cubic-bezier(.32,.72,0,1)" }).onfinish = () => el.remove();
}
function haptic() { try { navigator.vibrate && navigator.vibrate(12); } catch { /* not supported */ } }
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(text: string, undo?: () => void) {
  let t = ov.querySelector<HTMLElement>(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); ov.appendChild(t); }
  /* the empty role="status" region is in the HTML from the start (Base.astro), so the first message is announced too */
  t.innerHTML = "<span>" + F.esc(text) + "</span>" + (undo ? '<button type="button">Отмени</button>' : "");
  if (undo) t.querySelector("button")!.onclick = () => { undo(); t!.classList.remove("on"); };
  requestAnimationFrame(() => t!.classList.add("on"));
  clearTimeout(toastT); toastT = setTimeout(() => t!.classList.remove("on"), undo ? 5000 : 2400);
}
function flash(btn: HTMLElement, html: string, ms?: number) {
  const old = btn.innerHTML; btn.classList.add("done"); btn.innerHTML = html;
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove("done"); btn.innerHTML = old; } }, ms || 1200);
}
/* generic bottom sheet: returns {el, close}. While it is open everything behind it is inert (Tab stays in the sheet,
   screen readers do not leave it); Escape closes it and the focus goes back to the button that opened it. */
const inertMarks = new WeakSet<Element>();
function setInert(top: HTMLElement | null) {
  const behind = [device, ...Array.from(document.querySelectorAll("[data-ov-ck]")), ...Array.from(ov.children)].filter((el) => el !== top) as HTMLElement[];
  behind.forEach((el) => {
    if (top) { if (!el.inert) { el.inert = true; inertMarks.add(el); } }
    else if (inertMarks.has(el)) { el.inert = false; inertMarks.delete(el); }
  });
  if (top) { top.inert = false; inertMarks.delete(top); }
}
function sheet(opts: { title?: string; html?: string; onClose?: () => void }) {
  const w = document.createElement("div"), id = "sh" + Math.random().toString(36).slice(2, 7), back = document.activeElement as HTMLElement | null;
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
    back && back.isConnected && back.focus({ preventScroll: true });
  };
  (w.querySelector(".scrim") as HTMLElement).onclick = close;
  (w.querySelector("[data-close]") as HTMLElement).onclick = close;
  /* Tab cycles inside the sheet (inert already keeps it there; this also covers the browser UI edge) */
  w.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const f = Array.from(w.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  requestAnimationFrame(() => { w.classList.add("on"); const f = w.querySelector<HTMLElement>("[data-close]"); f && f.focus({ preventScroll: true }); });
  return { el: w, close };
}
function reveal(root?: Element) {
  root = root || scroller;
  if (reduce || !("IntersectionObserver" in window)) return;
  const items = root.querySelectorAll(".rv:not(.in)");
  if (!items.length) return;
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: .12 });
  scroller.classList.add("rv-on"); items.forEach((el) => io.observe(el));
}

/* ---------- live status (every minute) ---------- */
function tick() {
  const st = T.status(), box = document.querySelector<HTMLElement>("[data-status]");
  if (box) { const html = statusHTML(); if (box.innerHTML !== html) box.innerHTML = html; }
  document.dispatchEvent(new CustomEvent("sc:tick", { detail: { state: T.state(), status: st } }));
}
/* "Натоварено" and the minutes: one source, the kitchen settings in the core (server: GET /api/status; demo: the local
   core store). Read once per page (cached 60 s for the next page) and again every 5 minutes. */
function applyKitchen(k: Partial<T.KitchenSettings> | null | undefined) {
  if (!k) return;
  const before = T.eta().text;
  T.setKitchen(k);
  if (T.eta().text !== before) tick();
}
function loadKitchen() {
  try {
    if (DEMO) { const db = JSON.parse(localStorage.getItem("sc-db-settings") || "{}"); applyKitchen(db.main && db.main.kitchen); return; }
    const c = JSON.parse(sessionStorage.getItem("sc-kitchen") || "null");
    if (c && Date.now() - c.at < 60_000) { applyKitchen(c.k); return; }
  } catch { /* storage blocked */ }
  if (DEMO || typeof fetch !== "function") return;
  fetch("/api/status", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
    if (!j || !j.kitchen) return;
    try { sessionStorage.setItem("sc-kitchen", JSON.stringify({ at: Date.now(), k: j.kitchen })); } catch { /* ignore */ }
    applyKitchen(j.kitchen);
  }).catch(() => { /* offline: keep the default */ });
}
tick();
setInterval(tick, 60_000);
const idle = (f: () => void) => ("requestIdleCallback" in window ? (window as Window & { requestIdleCallback: (f: () => void) => void }).requestIdleCallback(f) : setTimeout(f, 200));
idle(loadKitchen);
setInterval(() => { try { sessionStorage.removeItem("sc-kitchen"); } catch { /* ignore */ } loadKitchen(); }, 5 * 60_000);
window.addEventListener("storage", (e) => { if (e.key === "sc-db-settings") loadKitchen(); });

/* ---------- header scroll state + assistant pill/mini ---------- */
const sent = scroller.querySelector("[data-sent]");
if (sent && "IntersectionObserver" in window) new IntersectionObserver((es) => {
  const sc = !es[0].isIntersecting;
  scroller.classList.toggle("scrolled", sc);
  const f = ov.querySelector<HTMLElement & { _t?: ReturnType<typeof setTimeout> }>(".aifab");
  if (f) { f.classList.toggle("away", !sc); clearTimeout(f._t); f.classList.remove("mini"); if (sc) f._t = setTimeout(() => f.classList.add("mini"), 2600); }
}, { rootMargin: "40px 0px 0px 0px" }).observe(sent);

/* ---------- on-demand UI: "Още", cookie settings, assistant, share (src/client/sc-ui.ts) ---------- */
const ui = () => import("./sc-ui.ts");
const aiAsk = (text: string, kind: AiKind) => { ui().then((m) => m.aiAsk(text, kind)); };
const openAI = () => ui().then((m) => m.openAI());
/* start loading it as soon as a finger / the keyboard is on such a button: no wait on the tap */
const UI_SEL = "[data-more], [data-ai], [data-cookie], [data-share], [data-aiq], [data-cookie-settings]";
const warm = (e: Event) => { if ((e.target as Element | null)?.closest?.(UI_SEL)) { ui(); document.removeEventListener("pointerdown", warm, true); document.removeEventListener("focusin", warm, true); } };
document.addEventListener("pointerdown", warm, true);
document.addEventListener("focusin", warm, true);

/* ---------- cookie banner ---------- */
/* "sc-cookie": the answer to the banner (all | min | set); "sc-cookie-prefs": {analytics, marketing}. The site has no
   analytics or marketing tools today; these flags are what such tools must read (SC.cookies()). */
const cookiePrefs = (): CookiePrefs => { const p = load<Partial<CookiePrefs>>("sc-cookie-prefs", {}); return { analytics: p.analytics === true, marketing: p.marketing === true }; };
function cookieChoice(v: string) {
  store("sc-cookie", v); de.dataset.ck = "1";
  if (v !== "set") store("sc-cookie-prefs", { analytics: v === "all", marketing: v === "all" });
  else ui().then((m) => m.cookieSettingsSheet(cookiePrefs()));
}

/* ---------- global delegation (same attributes as the prototype) ---------- */
document.addEventListener("click", (e) => {
  const t = (e.target as Element).closest<HTMLElement>("button, a");
  if (!t) return;
  if (t.matches("a[data-noop]")) { e.preventDefault(); toast("Правната страница се прави отделно."); return; }
  if (t.dataset.add) { e.preventDefault(); cartApi.add(t.dataset.add, 1, t.dataset.p ? { p: +t.dataset.p } : {}); fly(t, t.dataset.add); haptic(); flash(t, ic("check", 22)); toast("Добавено ✓"); return; }
  if (t.hasAttribute("data-ai")) { openAI(); return; }
  if (t.dataset.aiq) { aiAsk(t.textContent || "", t.dataset.aiq as AiKind); return; }
  if (t.dataset.aiadd) { t.dataset.aiadd.split(",").forEach((k, i) => { cartApi.add(k, 1); setTimeout(() => fly(t, k), i * 120); }); flash(t, ic("check", 22) + "Добавено в количката", 1600); return; }
  if (t.hasAttribute("data-more")) { ui().then((m) => m.openMore()); return; }
  if (t.hasAttribute("data-lang")) { toast("Английската версия идва след българската."); return; }
  if (t.hasAttribute("data-share")) { ui().then((m) => m.share()); return; }
  if (t.dataset.cookie) { cookieChoice(t.dataset.cookie); return; }
  if (t.hasAttribute("data-cookie-settings")) {
    e.preventDefault(); try { localStorage.removeItem("sc-cookie"); } catch { /* ignore */ } delete de.dataset.ck;
    requestAnimationFrame(() => document.querySelector<HTMLElement>(".cookie button")?.focus({ preventScroll: true }));
    return;
  }
});
document.addEventListener("submit", (e) => {
  const af = (e.target as Element).closest("[data-aiform]");
  if (!af) return;
  e.preventDefault();
  const inp = af.querySelector("input")!, v = inp.value.trim();
  if (!v) return;
  inp.value = "";
  ui().then((m) => m.aiAskText(v));
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const w = ov.querySelectorAll(".sheetwrap.on");
  if (w.length) (w[w.length - 1].querySelector("[data-close]") as HTMLElement | null)?.click();
});

updateCartUI(false);

/* ---------- window.SC: the prototype API ---------- */
type MountOpts = { title?: string; docTitle?: string; [k: string]: unknown };
export const SC = {
  reduce, demo: DEMO, preview: previewMode, load, store, prefs,
  /* format */
  fmt: F.fmt, esc: F.esc, ic, plural: F.plural, dateLong: F.dateLong, dateShort: F.dateShort, hhmm: F.hhmm, MON: F.MON, MONTHS: F.MONTHS, DAYS: F.DAYS,
  /** load the full icon set (lazy chunk); SC.ic works synchronously afterwards for every icon */
  icons: loadAllIcons,
  /* constants (no menu) */
  RESTAURANT: C.RESTAURANT, ZONES: C.ZONES, TAGS: C.TAGS, ALLERGENS: C.ALLERGENS, allergenName: C.allergenName, FILTERS: C.FILTERS,
  TABLES: C.TABLES, EVENT_CATS: C.EVENT_CATS, COURSE_NAME: C.COURSE_NAME, EVENT_SLUGS,
  /* time */
  /** the lunch menu is for today (without the menu: the date is generated at build) */
  lunchIsToday: () => lunchIsToday(),
  now: () => now(), minutes: () => minutes(), state: () => T.state(), status: () => T.status(), eta: () => T.eta(), lastSaturday: () => T.lastSaturday(),
  events: () => events(),
  /** compat with SC.href("dish", id) from the prototype */
  href: (page: string, id?: string) => fromProto(page + ".html" + (id ? "#" + id : "")),
  url, fromProto,
  /* cart & user */
  cart: cartApi, updateCartUI, user: () => load<Record<string, unknown> | null>("sc-user", null),
  /** the cookie choice: necessary always; analytics / marketing only when the visitor allowed them */
  cookies: () => ({ answered: !!load<string | null>("sc-cookie", null), necessary: true, ...cookiePrefs() }),
  /* ui */
  fly, haptic, toast, flash, sheet, reveal, aiAsk, openAI,
  device, scroller, ov, main,
  /** Already rendered by Base.astro: returns <main>. Only docTitle updates document.title if given. */
  mount: (o: MountOpts = {}) => { if (o.docTitle) document.title = o.docTitle + " | Siracusa Bar & Grill"; return main; },
};
export type SCType = typeof SC;
declare global { interface Window { SC: SCType } }
window.SC = SC;
export default SC;
