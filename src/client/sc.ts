/* Browser runtime loaded by Base.astro on every page (port of design/ds/sc.js).
   The chrome is already rendered by the server; this file wires it up and exposes window.SC with the SAME API as
   the prototype, so page scripts can be ported with minimal changes:
     - SC.mount(opts) returns the already rendered <main> (does not draw again),
     - links: "dish.html#id" -> SC.url.dish(id) (or SC.fromProto("dish.html#id")),
     - the document scrolls (not SC.scroller): use window.scrollY / window.scrollTo and IntersectionObserver root:null.
       SC.scroller keeps scrollTop / scrollTo / scrollBy / scroll listeners / getBoundingClientRect working as a shim. */
import * as L from "../lib/index.ts";
import { cartLib } from "../lib/index.ts";
import { configureRoutes, url, fromProto } from "../lib/routes.ts";
import { setClock, parseTime } from "../lib/time.ts";
import type { Cart, CartLine, Mode } from "../lib/cart.ts";

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
  const t = qs.get("t");
  if (t && parseTime(t)) setClock(t);
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
  add: (id: string, q = 1, opts: { mods?: string[]; extra?: number } = {}) => saveCart(cartLib.addLine(cart, id, q, opts)),
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
  document.querySelectorAll("[data-cartnav]").forEach((b) => b.setAttribute("aria-label", n ? "Количка, " + L.plural(n, "ястие", "ястия") + ", " + L.fmt(s) : "Количка, празна"));
}

/* ---------- motion helpers ---------- */
function fly(fromEl: Element | null, id: string) {
  if (reduce || !fromEl) return;
  const to = document.querySelector("[data-cartnav]");
  if (!to) return;
  const a = fromEl.getBoundingClientRect(), b = to.getBoundingClientRect(), el = document.createElement("div");
  el.className = "fly"; el.innerHTML = L.art(id);
  const x0 = a.left + a.width / 2 - 20, y0 = a.top + a.height / 2 - 20, dx = b.left + b.width / 2 - 20 - x0, dy = b.top + b.height / 2 - 20 - y0;
  el.style.left = x0 + "px"; el.style.top = y0 + "px"; ov.appendChild(el);
  el.animate([{ transform: "translate(0,0) scale(1) rotate(0)" }, { transform: "translate(" + dx * .5 + "px," + (dy * .5 - 40) + "px) scale(.9) rotate(120deg)", offset: .5 }, { transform: "translate(" + dx + "px," + dy + "px) scale(.35) rotate(240deg)", opacity: .7 }], { duration: 400, easing: "cubic-bezier(.32,.72,0,1)" }).onfinish = () => el.remove();
}
function haptic() { try { navigator.vibrate && navigator.vibrate(12); } catch { /* not supported */ } }
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(text: string, undo?: () => void) {
  let t = ov.querySelector<HTMLElement>(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); ov.appendChild(t); }
  t.innerHTML = "<span>" + L.esc(text) + "</span>" + (undo ? '<button type="button">Отмени</button>' : "");
  if (undo) t.querySelector("button")!.onclick = () => { undo(); t!.classList.remove("on"); };
  requestAnimationFrame(() => t!.classList.add("on"));
  clearTimeout(toastT); toastT = setTimeout(() => t!.classList.remove("on"), undo ? 5000 : 2400);
}
function flash(btn: HTMLElement, html: string, ms?: number) {
  const old = btn.innerHTML; btn.classList.add("done"); btn.innerHTML = html;
  setTimeout(() => { if (btn.isConnected) { btn.classList.remove("done"); btn.innerHTML = old; } }, ms || 1200);
}
/* generic bottom sheet: returns {el, close} */
function sheet(opts: { title?: string; html?: string; onClose?: () => void }) {
  const w = document.createElement("div"), id = "sh" + Math.random().toString(36).slice(2, 7), back = document.activeElement as HTMLElement | null;
  w.className = "sheetwrap";
  w.innerHTML = L.sheetHTML(id, opts.title || "", opts.html || "");
  ov.appendChild(w); de.classList.add("sheet-open");
  const close = () => {
    w.classList.remove("on");
    setTimeout(() => { w.remove(); if (!ov.querySelector(".sheetwrap")) de.classList.remove("sheet-open"); }, 340);
    opts.onClose && opts.onClose();
    back && back.isConnected && back.focus({ preventScroll: true });
  };
  (w.querySelector(".scrim") as HTMLElement).onclick = close;
  (w.querySelector("[data-close]") as HTMLElement).onclick = close;
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
  const st = L.status(), box = document.querySelector<HTMLElement>("[data-status]");
  if (box) { const html = L.statusHTML(); if (box.innerHTML !== html) box.innerHTML = html; }
  document.dispatchEvent(new CustomEvent("sc:tick", { detail: { state: L.state(), status: st } }));
}
tick();
setInterval(tick, 60_000);

/* ---------- header scroll state + assistant pill/mini ---------- */
const sent = scroller.querySelector("[data-sent]");
if (sent && "IntersectionObserver" in window) new IntersectionObserver((es) => {
  const sc = !es[0].isIntersecting;
  scroller.classList.toggle("scrolled", sc);
  const f = ov.querySelector<HTMLElement & { _t?: ReturnType<typeof setTimeout> }>(".aifab");
  if (f) { f.classList.toggle("away", !sc); clearTimeout(f._t); f.classList.remove("mini"); if (sc) f._t = setTimeout(() => f.classList.add("mini"), 2600); }
}, { rootMargin: "40px 0px 0px 0px" }).observe(sent);

/* ---------- assistant ---------- */
function aiAsk(text: string, kind: L.AiKind) {
  const box = ov.querySelector<HTMLElement>("[data-aimsgs]");
  if (!box) return;
  box.insertAdjacentHTML("beforeend", '<div class="msg me">' + L.esc(text) + '</div><div class="msg bot typing" data-typing><span></span><span></span><span></span></div>');
  box.scrollTop = box.scrollHeight;
  setTimeout(() => { const t = box.querySelector("[data-typing]"); if (t) { t.outerHTML = '<div class="msg bot">' + L.aiReply(kind) + "</div>"; box.scrollTop = box.scrollHeight; } }, reduce ? 50 : 700);
}
function openAI() {
  const s = sheet({ title: "Асистент", html: L.aiPanelHTML() });
  s.el.classList.add("aisheetwrap");
  setTimeout(() => { const i = s.el.querySelector<HTMLInputElement>("#aiq"); i && i.focus({ preventScroll: true }); }, 60);
}

/* ---------- cookie banner ---------- */
function cookieChoice(v: string) {
  store("sc-cookie", v); de.dataset.ck = "1";
  if (v === "set") sheet({ title: "Бисквитки", html: L.cookieSettings() });
}

/* ---------- share ---------- */
async function share() {
  const data = { title: document.title, url: location.href };
  try { if ("share" in navigator) { await navigator.share(data); return; } } catch { return; }
  try { await (navigator as Navigator).clipboard.writeText(location.href); } catch { /* ignore */ }
  toast("Връзката е копирана");
}

/* ---------- global delegation (same attributes as the prototype) ---------- */
document.addEventListener("click", (e) => {
  const t = (e.target as Element).closest<HTMLElement>("button, a");
  if (!t) return;
  if (t.matches("a[data-noop]")) { e.preventDefault(); toast("Правната страница се прави отделно."); return; }
  if (t.dataset.add) { e.preventDefault(); cartApi.add(t.dataset.add, 1); fly(t, t.dataset.add); haptic(); flash(t, L.ic("check", 22)); toast("Добавено ✓"); return; }
  if (t.hasAttribute("data-ai")) { openAI(); return; }
  if (t.dataset.aiq) { aiAsk(t.textContent || "", t.dataset.aiq as L.AiKind); return; }
  if (t.dataset.aiadd) { t.dataset.aiadd.split(",").forEach((k, i) => { cartApi.add(k, 1); setTimeout(() => fly(t, k), i * 120); }); flash(t, L.ic("check", 22) + "Добавено в количката", 1600); return; }
  if (t.hasAttribute("data-more")) { sheet({ title: "Още", html: L.morePanel() }); return; }
  if (t.hasAttribute("data-lang")) { toast("Английската версия идва след българската."); return; }
  if (t.hasAttribute("data-share")) { share(); return; }
  if (t.dataset.cookie) { cookieChoice(t.dataset.cookie); return; }
  if (t.hasAttribute("data-cookie-settings")) { e.preventDefault(); try { localStorage.removeItem("sc-cookie"); } catch { /* ignore */ } delete de.dataset.ck; return; }
});
document.addEventListener("submit", (e) => {
  const af = (e.target as Element).closest("[data-aiform]");
  if (!af) return;
  e.preventDefault();
  const inp = af.querySelector("input")!, v = inp.value.trim();
  if (!v) return;
  inp.value = "";
  aiAsk(v, L.aiClassify(v));
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const w = ov.querySelectorAll(".sheetwrap.on");
  if (w.length) (w[w.length - 1].querySelector("[data-close]") as HTMLElement | null)?.click();
});

updateCartUI(false);

/* ---------- window.SC: the prototype API ---------- */
type MountOpts = { title?: string; docTitle?: string; [k: string]: unknown };
const manualPairs: L.ManualPairs = {};
export const SC = {
  reduce, demo: DEMO, preview: previewMode, load, store, prefs,
  /* format */
  fmt: L.fmt, esc: L.esc, ic: L.ic, plural: L.plural, dateLong: L.dateLong, dateShort: L.dateShort, hhmm: L.hhmm,
  /* data */
  menu: L.menu, items: L.items, byId: L.byId, lunch: L.lunch, lunchIsToday: () => L.lunchIsToday(), cats: L.cats, catById: L.catById,
  inCat: L.inCat, isOut: L.isOut, RESTAURANT: L.RESTAURANT, ZONES: L.ZONES, TAGS: L.TAGS, ALLERGENS: L.ALLERGENS, allergenName: L.allergenName,
  FILTERS: L.FILTERS, TABLES: L.TABLES, EVENT_CATS: L.EVENT_CATS, COURSE_NAME: L.COURSE_NAME, MON: L.MON, MONTHS: L.MONTHS, DAYS: L.DAYS,
  /* time */
  now: () => L.now(), minutes: () => L.minutes(), state: () => L.state(), status: () => L.status(), eta: () => L.eta(), lastSaturday: () => L.lastSaturday(),
  events: () => L.events(), offers: () => L.offers(),
  MANUAL_PAIRS: manualPairs, suggest: (id: string, inCart?: string[]) => L.suggest(id, inCart, manualPairs),
  /* render */
  kind: L.kind, art: L.art, pic: L.pic, badges: L.badges, plusBtn: L.plusBtn, dishCard: L.dishCard, footer: () => L.footer(),
  /** compat with SC.href("dish", id) from the prototype */
  href: (page: string, id?: string) => fromProto(page + ".html" + (id ? "#" + id : "")),
  url, fromProto, PAGES: L.MORE_PAGES,
  /* cart & user */
  cart: cartApi, updateCartUI, user: () => load<Record<string, unknown> | null>("sc-user", null),
  /* ui */
  fly, haptic, toast, flash, sheet, reveal, aiAsk, openAI,
  device, scroller, ov, main,
  /** Already rendered by Base.astro: returns <main>. Only docTitle/title update document.title if given. */
  mount: (o: MountOpts = {}) => { if (o.docTitle) document.title = o.docTitle + " | Siracusa Bar & Grill"; return main; },
};
export type SCType = typeof SC;
declare global { interface Window { SC: SCType } }
window.SC = SC;
export default SC;
