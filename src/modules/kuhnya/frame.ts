/* Кухня: the frame of every screen of the module (port of K.mount of design/pages-kuhnya/_kitchen.js + README, without the
   panel "Само в прототипа" and without sample data). The screens are built on it:

   THE API (two more authors build "Изчерпано", "Натоварено", "Изпълнени" and "Общ изглед" on it)
   kitchenGuard(): Promise<KGuard | null>
       the session, the rights and the kitchen's settings: {me, cfg, boss}. null = already on the way elsewhere (no session
       -> the sign-in with #next=; a role without "Кухня" -> its own home) or the error screen is drawn.
   mountKitchen({page, title?}): Promise<KFrame | null>
       guard + the frame (top bar, the row of the counters, "Търси" and "Молив", the toast, the ticker, real time, no
       connection, the heartbeat). page: "queue" | "izcherpano" | "natovareno" | "izpalneni" | "obsht-izgled". null = left
       the page (no session -> toSignIn(): the PIN on a known device, else the password; no rights; no section chosen on
       this tablet -> /kuhnya/vhod/; "all" on the queue -> "Общ изглед", except queue#s=<section>: the head chef looks at
       the queue of that section, the heartbeat stays "all").
   KFrame:
     me, cfg, boss, sec ("topla" … | "all"), all, secName   who, the settings (cfg.sections, cfg.soon, cfg.undoSec …), the tablet's section
     main                                 <main class="kmain">: the screen draws here (a skeleton is there until it does)
     href(page | "vhod", hash?)           the address of a screen of the module (murl.kuhnya)
     now() / hm(ms) / sync(serverNow)     the server's clock (epoch ms), "19:42" in Sofia, set the clock from an answer's `now`
     onTick(fn(now)) -> off               the one ticker: once a second while the page is visible (and once when it shows again)
     on(type, fn(data)) -> off            real time (api.on): "order.new", "order.line", "order.status", "kitchen.busy", "menu.soldout" …
     call(fn)                             run an API call: the frame learns "no connection" / "connection back" from it, 401 -> the sign-in
     send(action) -> result | null        an action that changes something ({k:"start"|"line"|"done"|"back"|"out"|"busy", …}): sent now
                                          with its time; with no connection it is kept on the tablet and sent later (null)
     online() / onNet(fn(online)) -> off  the connection; after it is back the kept actions are sent first, then onNet(true)
     queue / queueErr / onQueue(fn) / refresh()   the last queue of the section from the server (the frame loads it on every
                                          screen: the numbers in the tabs, "Натоварено"), again after every event
     onNew(fn(ticket)) -> off             an order entered the section's queue just now (the sound has already rung)
     strip(render?)                       the row under the bar: render() -> {counts, pills} (inner HTML of .kcount; the buttons
                                          on the right). strip(fn) sets it and draws; strip() draws again. The frame adds the
                                          bar "Няма връзка" itself and never redraws under a finger.
     stripEl                              the row (bind clicks by delegation; give focusable things data-fk="name")
     pills.sound() / pills.busy() / pills.back(page, text)   ready buttons for the row: "Звук", "Натоварено", "Към опашката"
     toast(html, {undo?, secs?}) -> {close}   ONE notice in the place of the counters (52 px, one line), "Върни · 10"
     setTab("queue" | "izcherpano", n)    the number in a tab (the frame sets both from the queue; a screen may correct its own)
     loading(label?) / fail(e, retry) / empty({icon?, title, text?})   the states of the screen in `main`
     modal(el) -> close()                 a panel over everything: the frame is inert, the focus stays inside, Esc calls onEsc
     soundOn() / audioReady() / onSound(fn) / beep()   "Звук" (remembered on the tablet; the browser plays only after a touch)
     afterTouch(fn)                       run now, or when the touch in progress is over (never redraw a button under a finger)
     openFind() / goTo                    "Търси"; the queue screen sets goTo(no) (scroll to the card and frame it)
   Helpers: load(key, default) / store(key, value) (localStorage "sk-<key>", per tablet), theme() / setTheme("dark" | "light"),
   trapFocus(box, onEsc), secIcon(name), ic, esc.

   CSS (kitchen.css): .kpage .kh1 .klead .kcard .kgrid .kseg .kb(.ink .ok .red .line .hold) .kpill(.on .ask) .tag .miss
   .kempty .kskel .num; in the row: .kcount > span, .sep, .late. Widths only with @container app (899 / 1099 / 1400).

   CAREFUL: the layout of the staff modules loads the shared runtime of the site (src/client/sc.ts runs on every page) and it
   listens for clicks on every button and link with data-more, data-ai, data-aiq, data-aiadd, data-add, data-share,
   data-suggest, data-lang, data-cookie, data-cookie-settings: never give a button of the kitchen one of these names
   (a button with data-more opens the site's sheet "Още" and makes the whole screen inert).

   On the tablet (localStorage, try/catch): sk-sec, sk-theme, sk-sound, sk-device, sk-outbox, sk-secs (vhod.ts: the names of
   the sections for the PIN step before the sign-in), sk-who (vhod.ts: who signed in with the PIN last). Nothing else is kept. */
import "sc-icons:list-checks,x,check-circle,squares-four,hourglass,caret-down,magnifying-glass,bell,bell-ringing,warning,speaker-high,speaker-slash,wifi-slash,warning-circle,arrow-clockwise,arrow-counter-clockwise,arrow-left,arrow-right,calendar-check,flame,fire,cooking-pot,pizza,bowl-food,chef-hat,fork-knife,moped,storefront,minus,plus,note,check,sign-in,sign-out,sun,moon,info";
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";
import { session, mountPen, ROLES } from "../../admin/a.ts";
import { aurl } from "../../admin/routes.ts";
import { murl, type KuhnyaScreen } from "../routes.ts";
import { api, DEMO, ApiError } from "../../client/api.ts";
import { kitchenApi, type KConfigView, type KQueue, type KTicket } from "../../client/api-kitchen.ts";
import type { Me } from "../../client/api-admin.ts";
import { makeOutbox, flushOutbox, type KAction, type Queued } from "./outbox.ts";

export { ic, esc };
export type { KAction };
export type KPage = "queue" | "izcherpano" | "natovareno" | "izpalneni" | "obsht-izgled";
const SCREEN: Record<KPage | "vhod", KuhnyaScreen> = { queue: "", izcherpano: "izcherpano", natovareno: "natovareno", izpalneni: "izpalneni", "obsht-izgled": "obsht-izgled", vhod: "vhod" };
const TABS: [KPage, string, string][] = [["queue", "Опашка", "list-checks"], ["izcherpano", "Изчерпано", "x"], ["izpalneni", "Изпълнени", "check-circle"], ["obsht-izgled", "Общ изглед", "squares-four"]];
const TABS_ALL: [KPage, string, string][] = [["obsht-izgled", "Общ изглед", "squares-four"], ["izcherpano", "Изчерпано", "x"], ["natovareno", "Натоварено", "hourglass"]];
/** the head chef's view of every section */
export const K_ALL = "all";

/* ---------- per tablet (try/catch: the storage may be blocked) ---------- */
export function load<T>(k: string, d: T): T { try { const v = localStorage.getItem("sk-" + k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } }
export function store(k: string, v: unknown): void { try { if (v == null) localStorage.removeItem("sk-" + k); else localStorage.setItem("sk-" + k, JSON.stringify(v)); } catch { /* private mode */ } }
/** dark by default (less glare in the kitchen), light by choice, per tablet */
export const theme = (): "dark" | "light" => (load<string>("theme", "dark") === "light" ? "light" : "dark");
export function setTheme(t: "dark" | "light"): void { store("theme", t); document.documentElement.dataset.theme = t; }
/* the icons of the sections (imported above); a local list, not lib/icons.ts hasIcon: a new import from the shared
   runtime makes the export live and the site's runtime bigger on every page (CODE-GUIDE 3а) */
const SEC_ICONS = new Set(["flame", "fire", "cooking-pot", "pizza", "bowl-food", "chef-hat", "fork-knife"]);
export const secIcon = (n: string | undefined): string => (n && SEC_ICONS.has(n) ? n : "cooking-pot");

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
const reduce = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export { reduce as reduceMotion };

let HM: Intl.DateTimeFormat | null = null;
/** "19:42" in Sofia */
export function hm(ms: number): string {
  try { HM = HM || new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); return HM.format(new Date(ms)); }
  catch { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
}
const isOffline = (e: unknown): boolean => e instanceof ApiError && e.code === "offline";

/** The focus stays inside `box` (Tab / Shift+Tab go round), Esc calls onEsc. Returns the function that lets go. */
export function trapFocus(box: HTMLElement, onEsc: () => void): () => void {
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onEsc(); return; }
    if (e.key !== "Tab") return;
    const f = $$<HTMLElement>('button:not([hidden]):not([disabled]), a[href], input:not([disabled]), [tabindex="0"]', box).filter((el) => el.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const a = f[0], z = f[f.length - 1], cur = document.activeElement;
    if (!box.contains(cur)) { e.preventDefault(); a.focus(); }
    else if (e.shiftKey && (cur === a || cur === box)) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && cur === z) { e.preventDefault(); a.focus(); }
  };
  document.addEventListener("keydown", key, true);
  return () => document.removeEventListener("keydown", key, true);
}

/* ---------- the guard ---------- */
/** no session (or it expired): on a known device the kitchen signs in with the PIN (/kuhnya/vhod/, vhod.ts), on any
    other device with the user name and the password (/admin/vhod/); both come back here (#next=) */
let leaving = false;
export async function toSignIn(): Promise<void> {
  if (leaving) return; leaving = true;
  let known = false;
  try { const { pinApi } = await import("../../client/api-floor.ts"); known = (await pinApi.people("kitchen")).known; } catch { /* the password form */ }
  location.replace(known ? murl.kuhnya("vhod", "next=" + encodeURIComponent(murl.here())) : aurl.login(murl.here()));
}
export interface KGuard { me: Me; cfg: KConfigView; /** the main admin, the owner, the manager: they come from the admin */ boss: boolean }
const STAFF_APPS = ["waiter", "kitchen", "driver"];
function bootFail(e: unknown): void {
  const off = isOffline(e);
  const b = $("[data-kboot]") || document.body.appendChild(document.createElement("div"));
  b.removeAttribute("aria-hidden"); b.className = "kd"; b.setAttribute("data-kboot", "");
  b.innerHTML = '<div class="kempty" style="grid-row:1 / -1"><div><div class="ill bad">' + ic(off ? "wifi-slash" : "warning", 64) + "</div><h2>" + (off ? "Няма връзка" : "Не успяхме да отворим кухнята") + "</h2>" +
    "<p>" + (off ? "Провери Wi-Fi на таблета и опитай пак." : esc(e instanceof ApiError && e.message ? e.message : "Опитай пак след малко. Ако не стане, кажи на управителя.")) + "</p>" +
    '<button class="kb line" type="button" data-again>' + ic("arrow-clockwise", 22) + "Опитай пак</button></div></div>";
  $<HTMLButtonElement>("[data-again]", b)!.onclick = () => location.reload();
}
export async function kitchenGuard(): Promise<KGuard | null> {
  document.documentElement.dataset.theme = theme();
  let me: Me | null = null;
  try { me = await session(); } catch (e) { bootFail(e); return null; }
  if (!me) { void toSignIn(); return null; }
  const role = me.user.role, boss = ["admin", "owner", "manager"].includes(role);
  const home = () => { location.replace(ROLES[role] && STAFF_APPS.includes(role) && role !== "kitchen" ? aurl.app(role) : aurl.home()); };
  if (!(boss || role === "kitchen" || me.sections.includes("kitchen"))) { home(); return null; }
  let cfg: KConfigView;
  try { cfg = await kitchenApi.config(); }
  catch (e) {
    if (e instanceof ApiError && e.status === 401) { void toSignIn(); return null; }
    if (e instanceof ApiError && e.status === 403) { home(); return null; }
    bootFail(e); return null;
  }
  return { me, cfg, boss };
}
/** the section this tablet was set to ("" = not chosen yet, or a section that no longer exists) */
export function tabletSec(cfg: KConfigView): string {
  const s = load<string>("sec", "");
  return s === K_ALL || cfg.sections.some((x) => x.id === s) ? s : "";
}

/* ---------- the frame ---------- */
export interface KToast { close(): void; /** "Върни" (null: a plain notice) */ button: HTMLButtonElement | null }
export interface KStrip { counts: string; pills?: string }
export interface KFrame {
  me: Me; cfg: KConfigView; boss: boolean; sec: string; all: boolean; secName: string; page: KPage;
  /** the tablet's own section (differs from sec when the head chef looks at a section's queue: queue#s=…) */
  tablet: string;
  root: HTMLElement; main: HTMLElement; stripEl: HTMLElement;
  href(page: KPage | "vhod", hash?: string): string;
  now(): number; hm(ms: number): string; sync(serverNow: number): void;
  onTick(fn: (now: number) => void): () => void;
  on(type: string, fn: (data: any) => void): () => void;
  call<T>(fn: () => Promise<T>): Promise<T>;
  send<T = unknown>(a: KAction): Promise<T | null>;
  online(): boolean; onNet(fn: (online: boolean) => void): () => void;
  queue: KQueue | null; queueErr: unknown; onQueue(fn: (q: KQueue | null) => void): () => void; refresh(): Promise<void>;
  onNew(fn: (t: KTicket) => void): () => void;
  strip(render?: () => KStrip): void;
  pills: { sound(): string; busy(): string; back(page: KPage, text: string): string };
  toast(html: string, o?: { undo?: () => void; secs?: number; focus?: boolean; after?: () => HTMLElement | null }): KToast;
  setTab(tab: "queue" | "izcherpano", n: number): void;
  loading(label?: string): void; fail(e: unknown, retry: () => void): void; empty(o: { icon?: string; title: string; text?: string }): void;
  modal(el: HTMLElement, onEsc: () => void): () => void;
  soundOn(): boolean; audioReady(): boolean; onSound(fn: () => void): () => void; beep(): void;
  afterTouch(fn: () => void): void;
  openFind(): void; goTo: ((no: string) => boolean) | null;
}
export interface KMountOpts { page: KPage; /** "Опашка" (the section's name is added by the frame) */ title?: string }

const OFF_TEXT = (page: KPage, at: string): string => {
  const from = at ? 'Данните са от <b class="num">' + at + "</b>." : "Още няма заредени данни.";
  if (page === "queue") return from + " Таймерите вървят по часовника на таблета. „Готово“ се запазва и се изпраща, щом връзката се върне.";
  if (page === "obsht-izgled") return at ? 'Данните за секциите са от <b class="num">' + at + "</b> и не се обновяват." : from;
  return from + " Промените се запазват и се изпращат, щом връзката се върне.";
};

export async function mountKitchen(opts: KMountOpts): Promise<KFrame | null> {
  const g = await kitchenGuard();
  if (!g) return null;
  const { me, cfg, boss } = g, page = opts.page;
  const tab = tabletSec(cfg);
  if (!tab) { location.replace(murl.kuhnya("vhod")); return null; }
  /* the head chef looks at the queue of one section from "Общ изглед" (queue#s=skara, as the prototype); the heartbeat
     stays the tablet's own ("all") */
  const peek = tab === K_ALL && page === "queue" ? murl.hash().get("s") || "" : "";
  const sec = peek && cfg.sections.some((x) => x.id === peek) ? peek : tab;
  const all = sec === K_ALL;
  /* the head chef has no queue of his own: "Общ изглед" (as queue.html#s=all in the prototype) */
  if (all && (page === "queue" || page === "izpalneni")) { location.replace(murl.kuhnya("obsht-izgled")); return null; }
  const def = cfg.sections.find((x) => x.id === sec), secName = all ? cfg.all.who : def!.n;
  const href = (p: KPage | "vhod", hash?: string) => murl.kuhnya(SCREEN[p], hash);
  document.title = (opts.title ? opts.title + (all || page === "natovareno" || page === "obsht-izgled" ? "" : " · " + secName) : "Кухня") + " | Кухня · Siracusa";

  /* ---------- the DOM ---------- */
  const tabs = all ? TABS_ALL : TABS;
  const root = document.createElement("div"); root.className = "kd";
  root.innerHTML =
    '<header class="kbar">' +
      '<a class="ksec" href="' + href("vhod") + '"><span class="si">' + ic(all ? secIcon(cfg.all.icon) : secIcon(def!.icon), 26) + "</span><span><b>" + esc(secName) + ic("caret-down", 18) + "</b><small>Смени секцията</small></span></a>" +
      '<nav class="ktabs" aria-label="Екрани на кухнята">' + tabs.map((t) =>
        '<a href="' + href(t[0]) + '"' + (page === t[0] ? ' aria-current="page"' : "") + ">" + ic(t[2], 22) + t[1] + " " +
        (t[0] === "queue" ? '<span class="n" data-qn hidden></span>' : t[0] === "izcherpano" ? '<span class="n warn" data-outn hidden></span>' : "") + "</a>").join("") + "</nav>" +
      '<div class="kclock"><span class="net" role="status"><i></i><span>Онлайн</span></span><b data-clock></b></div>' +
      (boss ? '<a class="kboss" href="' + aurl.home() + '" title="Към таблото">' + ic("squares-four", 22) + "Табло</a>" : "") +
    '</header><div class="kstripw"><div class="kstrip" data-strip></div>' +
    '<div class="ktools"><button class="kpill" type="button" data-kfind aria-label="Търси в чакащите поръчки: номер, маса, ястие">' + ic("magnifying-glass", 22) + 'Търси</button><span class="kpenslot" data-penslot></span></div>' +
    '<div class="ktoasts" aria-live="polite"></div></div><main class="kmain" id="main" tabindex="-1"></main>';
  $("[data-kboot]")?.remove();
  document.body.appendChild(root);
  const main = $("main", root)!, stripEl = $("[data-strip]", root)!, stripw = $(".kstripw", root)!, tools = $(".ktools", root)!, toasts = $(".ktoasts", root)!;
  const clock = $("[data-clock]", root)!, net = $(".net", root)!;

  /* ---------- the clock: the server's, corrected at every answer ---------- */
  let offset = 0, lastOk = 0;
  const now = () => Date.now() + offset;
  const sync = (serverNow: number) => { if (Number.isFinite(serverNow) && serverNow > 0) offset = serverNow - Date.now(); };

  /* ---------- a touch in progress: nothing is redrawn under a finger (the click must land on the same button) ---------- */
  let touching = false, touchT: ReturnType<typeof setTimeout> | undefined, waiters: (() => void)[] = [];
  const endTouch = (ms: number) => { clearTimeout(touchT); touchT = setTimeout(() => { touching = false; const l = waiters; waiters = []; l.forEach((f) => f()); }, ms); };
  const beginTouch = () => { touching = true; endTouch(5000); };
  addEventListener("pointerdown", beginTouch, true); addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") beginTouch(); }, true);
  /* after a touch the click comes a moment later; without a click (a slide) the wait ends by itself */
  addEventListener("pointerup", () => endTouch(350), true); addEventListener("pointercancel", () => endTouch(0), true);
  addEventListener("click", () => endTouch(0), true); addEventListener("keyup", () => { if (touching) endTouch(0); }, true);
  /** run now, or as soon as the touch in progress is over */
  const afterTouch = (fn: () => void) => { if (touching) waiters.push(fn); else fn(); };

  /* ---------- the one ticker (once a second from timestamps; it sleeps while the page is hidden) ---------- */
  const ticks = new Set<(now: number) => void>();
  let iv: ReturnType<typeof setInterval> | undefined;
  const tickAll = () => { const n = now(); ticks.forEach((f) => { try { f(n); } catch (e) { console.error(e); } }); };
  const wake = () => { if (iv == null) iv = setInterval(tickAll, 1000); };
  const sleep = () => { clearInterval(iv); iv = undefined; };
  const onTick = (fn: (now: number) => void) => { ticks.add(fn); return () => { ticks.delete(fn); }; };

  /* ---------- the connection ---------- */
  let off = false, retryAt = 0, probing = false;
  const netSubs = new Set<(online: boolean) => void>();
  const box = makeOutbox({ get: () => { try { return localStorage.getItem("sk-outbox"); } catch { return null; } }, set: (v) => { try { if (v == null) localStorage.removeItem("sk-outbox"); else localStorage.setItem("sk-outbox", v); } catch { /* blocked */ } } });
  const run = (q: { sec: string; at: number; a: KAction }): Promise<unknown> => {
    const a = q.a, o = { at: q.at, saw: "saw" in a ? a.saw : undefined };
    switch (a.k) {
      case "start": return kitchenApi.start(a.no, q.sec, o);
      case "line": return kitchenApi.line(a.no, a.i, a.ready, { sec: q.sec, ...o });
      case "done": return kitchenApi.done(a.no, q.sec, o);
      case "back": return kitchenApi.back(a.no, q.sec, { lines: a.lines, ...o });
      case "out": return kitchenApi.setOut(a.id, a.out, { sec: q.sec, at: q.at });
      case "busy": return kitchenApi.setBusy(a.on, { sec: q.sec, at: q.at });
    }
  };
  function paintNet() {
    root.classList.toggle("offline", off);
    net.classList.toggle("off", off);
    net.lastElementChild!.textContent = off ? "Няма връзка" : "Онлайн";
  }
  function lost() {
    if (off) return;
    off = true; retryAt = 0; paintNet(); drawStrip();
    netSubs.forEach((f) => f(false));
  }
  let flushing: Promise<void> | null = null;
  const tries = new Map<string, number>();
  /** the connection is back: first the kept actions (in order, with their time), then the screens load again. `flushing`
      is cleared in .finally (never inside the body: with nothing kept the body ends before the promise is stored, and a
      stored, finished promise would keep the tablet "Няма връзка" for good; review 2, blocking 1) */
  function back(): Promise<void> {
    if (flushing) return flushing;
    const p = (async () => {
      const had = box.size();
      let auth = false, cur = "";
      /* nothing is thrown away because of the connection, an expired session or a server that is starting (three tries);
         only what the core refuses (the order was closed meanwhile, an action of another day) is dropped, and said */
      const wait = (e: unknown): boolean => {
        if (isOffline(e)) return true;
        if (!(e instanceof ApiError)) return false;
        if (e.status === 401) { auth = true; return true; }
        if (e.status >= 500 || e.status === 429) { const n = (tries.get(cur) || 0) + 1; tries.set(cur, n); return n < 3; }
        return false;
      };
      const r = { sent: 0, dropped: [] as string[], stopped: false };
      /* a touch made while the kept actions are on their way joins the box: another round, until it is empty */
      for (let round = 0; box.size() && round < 6 && !auth; round++) {
        const x = await flushOutbox(box, (q: Queued) => { cur = q.id; return run(q); }, wait);
        r.sent += x.sent; r.dropped.push(...x.dropped);
        if (x.stopped) { r.stopped = true; break; }
      }
      if (auth) { void toSignIn(); return; }
      if (r.stopped) { lost(); return; }
      const was = off; off = false; lastOk = now(); paintNet(); drawStrip();
      if (r.dropped.length) toast("<b>" + (r.dropped.length === 1 ? "Едно действие не се записа" : r.dropped.length + " действия не се записаха") + "</b><small>" + esc(r.dropped[0]) + "</small>", { secs: 8 });
      else if (r.sent) toast("<b>Връзката се върна</b><small>" + (r.sent === 1 ? "Изпратихме запазеното действие." : "Изпратихме запазените действия: " + r.sent + ".") + "</small>", { secs: 6 });
      await refresh();
      if (was || had) netSubs.forEach((f) => f(true));
    })().catch(() => { /* the next probe tries again */ }).finally(() => { flushing = null; });
    flushing = p;
    return p;
  }
  /** the heartbeat, at most 8 s: a half-open connection (a change of Wi-Fi) must not keep "Опитай пак" busy for good */
  const beatOnce = async (): Promise<boolean> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, rej) => { t = setTimeout(() => rej(new ApiError("offline", "Няма връзка.", 0)), 8000); });
    try { const r = await Promise.race([kitchenApi.beat(tab, { device }), late]); sync(r.now); return true; }
    catch (e) { if (e instanceof ApiError && e.status === 401) { void toSignIn(); return false; } if (isOffline(e)) lost(); return false; }
    finally { clearTimeout(t); }
  };
  /** is the server there again */
  async function probe(): Promise<boolean> {
    if (probing) return false; probing = true;
    try { const ok = await beatOnce(); if (ok) await back(); return ok; } finally { probing = false; }
  }
  async function call<T>(fn: () => Promise<T>): Promise<T> {
    try { const r = await fn(); lastOk = now(); if (off && !flushing) void back(); return r; }
    catch (e) {
      if (isOffline(e)) lost();
      else if (e instanceof ApiError && e.status === 401) void toSignIn();
      throw e;
    }
  }
  let pending = 0, want = false;
  async function send<T = unknown>(a: KAction): Promise<T | null> {
    const at = now();
    if (off) { box.add(sec, at, a); return null; }
    pending++;
    try { return (await call(() => run({ sec, at, a }))) as T; }
    catch (e) { if (isOffline(e)) { box.add(sec, at, a); return null; } throw e; }
    finally { pending--; if (!pending && want) { want = false; refreshSoon(); } }
  }

  /* ---------- the queue of the section: the numbers in the tabs, "Натоварено", new orders (every screen) ---------- */
  const qSubs = new Set<(q: KQueue | null) => void>(), newSubs = new Set<(t: KTicket) => void>();
  const known = new Set<string>();
  let seq = 0, first = true, rt: ReturnType<typeof setTimeout> | undefined, lastLoad = 0;
  const k = {} as KFrame;
  async function refresh(): Promise<void> {
    clearTimeout(rt);
    /* never over an action that is still on its way: the answer of the action is newer than this list */
    if (pending || (flushing && off)) { want = true; return; }
    const my = ++seq;
    try {
      const q = await call(() => kitchenApi.queue(sec));
      if (my !== seq) return;
      sync(q.now); lastLoad = now();
      const fresh = q.tickets.filter((t) => !known.has(t.no));
      q.tickets.forEach((t) => known.add(t.no));
      k.queue = q; k.queueErr = null;
      setTab("queue", q.tickets.length); setTab("izcherpano", q.counts.out);
      /* an order entered the queue just now: the screen hears which one before it draws the list, then the double tone */
      const came = !first && fresh.length > 0;
      if (came) fresh.forEach((t) => newSubs.forEach((f) => f(t)));
      qSubs.forEach((f) => f(q));
      if (came) beep();
      first = false;
      drawStrip();
    } catch (e) {
      if (my !== seq) return;
      k.queueErr = e;
      qSubs.forEach((f) => f(k.queue));
    }
  }
  const refreshSoon = () => { clearTimeout(rt); rt = setTimeout(() => { void refresh(); }, 150); };
  function setTab(tab: "queue" | "izcherpano", n: number) {
    const el = $(tab === "queue" ? "[data-qn]" : "[data-outn]", root); if (!el) return;
    el.textContent = String(n); el.hidden = tab === "izcherpano" && !n;
  }

  /* ---------- "Звук": remembered on the tablet; the browser plays only after the first touch of this load ---------- */
  let ready = false, AC: AudioContext | null = null, downTarget: EventTarget | null = null;
  const soundSubs = new Set<() => void>();
  const soundOn = () => load<boolean>("sound", true) !== false;
  function unlock(e?: Event) {
    if (e) downTarget = e.target;
    try { const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; AC = AC || new C(); if (AC.resume) void AC.resume(); } catch { /* no audio */ }
    if (ready) return;
    ready = true;
    /* the touch is on "Звук: докоснете" itself: its click only confirms "вкл." */
    const sb = downTarget instanceof Element ? downTarget.closest("[data-unlock]") : null;
    if (sb) sb.setAttribute("data-juston", "");
    /* the row is redrawn only when this touch is over: a button must never move away from under the finger */
    touching = true; endTouch(5000);
    waiters.push(() => { drawStrip(); soundSubs.forEach((f) => f()); });
  }
  document.addEventListener("pointerdown", unlock, { capture: true }); document.addEventListener("keydown", unlock, { capture: true });
  /** the double tone of a new order (design: K.beep) */
  function beep() {
    if (!soundOn() || !ready || !AC) return;
    try {
      const c = AC;
      [0, 0.22].forEach((d) => {
        const o = c.createOscillator(), gn = c.createGain(); o.frequency.value = 880; o.connect(gn); gn.connect(c.destination);
        gn.gain.setValueAtTime(0.0001, c.currentTime + d); gn.gain.exponentialRampToValueAtTime(0.25, c.currentTime + d + 0.02); gn.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d + 0.18);
        o.start(c.currentTime + d); o.stop(c.currentTime + d + 0.2);
      });
    } catch { /* no audio */ }
  }
  const pills = {
    sound: (): string => !soundOn() ? '<button class="kpill" type="button" data-sound data-fk="sound" aria-pressed="false">' + ic("speaker-slash", 22) + "Звук изкл.</button>"
      : ready ? '<button class="kpill" type="button" data-sound data-fk="sound" aria-pressed="true">' + ic("speaker-high", 22) + "Звук вкл.</button>"
      : '<button class="kpill ask" type="button" data-sound data-fk="sound" data-unlock title="Браузърът пуска звук едва след докосване на екрана">' + ic("speaker-slash", 22) + "Звук: докоснете</button>",
    /** the key shows the state of the whole kitchen and leads to the screen "Натоварено" */
    busy: (): string => { const b = k.queue && k.queue.busy; if (!b) return "";
      /* on for 60 min or more: the reminder is on the key itself, where the cooks look (red frame, "· 60+ мин") */
      return '<a class="kpill' + (b.on ? " on" : "") + (b.remind ? " remind" : "") + '" data-fk="busy" href="' + href("natovareno") + '">' + ic(b.remind ? "warning" : "hourglass", 22) + (b.on ? "Натоварено +" + b.extra + " мин" + (b.remind ? ' <span class="sub">· 60+ мин</span>' : b.atHm ? ' <span class="sub">от ' + esc(b.atHm) + "</span>" : "") : "Натоварено: изкл.") + "</a>"; },
    back: (p: KPage, text: string): string => '<a class="kpill" data-fk="back" href="' + href(p) + '">' + ic("arrow-left", 22) + esc(text) + "</a>",
  };

  /* ---------- the row under the bar ---------- */
  let render: (() => KStrip) | null = null, lastStrip: string | null = null, dirty = false;
  function offlineHTML(): string {
    return '<div class="koff" role="alert">' + ic("wifi-slash", 32) + "<div><b>Няма връзка." + (page === "obsht-izgled" ? "" : " Новите поръчки не идват.") + "</b>" +
      "<p>" + OFF_TEXT(page, lastOk ? hm(lastOk) : "") + "</p>" +
      '<ol><li>Провери Wi-Fi на таблета.</li><li>Ако до 2 мин няма връзка, кажи на управителя. <span class="miss">[ЛИПСВА: резервен интернет и ред при срив]</span></li></ol>' +
      (retryAt ? '<p class="still" role="status">Още няма връзка (проверено в ' + hm(retryAt) + ").</p>" : "") + "</div>" +
      '<button class="kb line" type="button" data-retry data-fk="retry"' + (probing ? " disabled" : "") + ">" + ic("arrow-clockwise", 22) + "Опитай пак</button></div>";
  }
  function place() {
    const kc = $(".kcount", stripEl), wr = stripw.getBoundingClientRect();
    const tw = tools.offsetWidth + 20; stripw.style.setProperty("--toolsw", tw + "px");
    if (!kc) { tools.style.top = "36px"; return; }
    const r = kc.getBoundingClientRect(), mid = r.top - wr.top + r.height / 2;
    tools.style.top = mid + "px";
    /* the notice takes the place of the counters (they are not buttons); the buttons, "Нова" and "Няма връзка" stay open */
    toasts.style.left = (r.left - wr.left) + "px"; toasts.style.top = mid + "px"; toasts.style.width = Math.max(r.width - tw, 280) + "px";
  }
  function drawStrip() {
    if (touching) { if (!dirty) { dirty = true; waiters.push(() => { dirty = false; drawStrip(); }); } return; }
    const s = render ? render() : { counts: "", pills: "" };
    const html = (off ? offlineHTML() : "") + '<div class="kcount">' + (s.counts || "") + "</div>" + (s.pills || "");
    if (html === lastStrip) return;
    const cur = document.activeElement, fk = cur instanceof HTMLElement && stripEl.contains(cur) ? cur.getAttribute("data-fk") : null;
    lastStrip = html; stripEl.innerHTML = html;
    if (fk) $<HTMLElement>('[data-fk="' + fk + '"]', stripEl)?.focus({ preventScroll: true });
    place();
  }
  function strip(fn?: () => KStrip) { if (fn) render = fn; drawStrip(); }
  stripEl.addEventListener("click", (e) => {
    const t = e.target as Element;
    const sb = t.closest<HTMLElement>("[data-sound]");
    if (sb) {
      /* the button does what it says: "Звук: докоснете" -> вкл., "Звук изкл." -> вкл., "Звук вкл." -> изкл. */
      if (sb.hasAttribute("data-unlock") || sb.hasAttribute("data-juston")) { sb.removeAttribute("data-juston"); unlock(); beep(); }
      else { store("sound", !soundOn()); if (soundOn()) { unlock(); beep(); } }
      drawStrip(); afterTouch(() => soundSubs.forEach((f) => f()));
      return;
    }
    if (t.closest("[data-retry]")) {
      void (async () => { const p = probe(); drawStrip(); const ok = await p; if (!ok) { retryAt = now(); drawStrip(); } })();
    }
  });
  try { new MutationObserver(place).observe($("[data-penslot]", root)!, { childList: true, subtree: true }); } catch { /* old browser */ }
  addEventListener("resize", place);
  if (document.fonts && document.fonts.ready) void document.fonts.ready.then(place);

  /* ---------- the notice with "Върни" (one at a time: the new one takes the place of the old) ---------- */
  let cur: KToast | null = null;
  /** o.focus: the keyboard pressed the action: the focus goes to "Върни" (one key away, review 2 important 5); when the
      notice goes with the focus in it, the focus goes to o.after() (or the screen) instead of falling on <body> */
  function toast(html: string, o: { undo?: () => void; secs?: number; focus?: boolean; after?: () => HTMLElement | null } = {}): KToast {
    const secs = o.secs || cfg.undoSec || 10, until = Date.now() + secs * 1000;
    /* one live region (.ktoasts, polite); the seconds are not read aloud ("10 … 9 …"): the button's name is "Върни" */
    const el = document.createElement("div"); el.className = "kt" + (o.undo ? "" : " plain");
    /* read aloud as two sentences (the title and the detail sit side by side with no space between them) */
    el.innerHTML = ic("check-circle", 28) + "<span>" + html.replace("</b><small>", '</b><span class="vh">. </span><small>') + "</span>" + (o.undo ? '<button type="button">' + ic("arrow-counter-clockwise", 20) + 'Върни<span aria-hidden="true"> · <b class="num">' + secs + "</b></span></button>" : "") + '<i style="animation-duration:' + secs + 's"></i>';
    if (cur) cur.close();
    toasts.appendChild(el); place();
    const b = $("button b", el), btn = $<HTMLButtonElement>("button", el);
    const offTick = onTick(() => { if (b) b.textContent = String(Math.max(0, Math.ceil((until - Date.now()) / 1000))); });
    const t = setTimeout(close, secs * 1000);
    function close() {
      clearTimeout(t); offTick();
      const had = el.contains(document.activeElement);
      el.remove(); if (cur === me2) cur = null;
      if (had) ((o.after && o.after()) || main).focus({ preventScroll: true });
    }
    if (o.undo) btn!.addEventListener("click", () => { close(); o.undo!(); });
    const me2: KToast = { close, button: btn };
    cur = me2;
    if (o.focus && btn) btn.focus({ preventScroll: true });
    return me2;
  }

  /* ---------- the states of a screen ---------- */
  function loading(label = "Зареждаме …") {
    main.innerHTML = '<div class="kpage" aria-hidden="true"><div class="kskel"></div><div class="kskel"></div><div class="kskel"></div></div><span class="vh" role="status">' + esc(label) + "</span>";
  }
  function fail(e: unknown, retry: () => void) {
    const offl = isOffline(e);
    main.innerHTML = '<div class="kempty"><div><div class="ill bad">' + ic(offl ? "wifi-slash" : "warning", 64) + "</div><h2>" + (offl ? "Няма връзка" : "Не успяхме да заредим данните") + "</h2><p>" +
      (offl ? "Щом връзката се върне, екранът се зарежда сам." : esc(e instanceof ApiError && e.message ? e.message : "Опитай пак след малко.")) + '</p><button class="kb line" type="button" data-again>' + ic("arrow-clockwise", 22) + "Опитай пак</button></div></div>";
    $<HTMLButtonElement>("[data-again]", main)!.onclick = retry;
  }
  function empty(o: { icon?: string; title: string; text?: string }) {
    main.innerHTML = '<div class="kempty"><div><div class="ill">' + ic(o.icon || "check-circle", 64) + "</div><h2>" + esc(o.title) + "</h2>" + (o.text ? "<p>" + esc(o.text) + "</p>" : "") + "</div></div>";
  }
  function modal(el: HTMLElement, onEsc: () => void): () => void {
    const prev = document.activeElement as HTMLElement | null;
    root.inert = true;
    const let_go = trapFocus(el, onEsc);
    return () => { root.inert = false; let_go(); if (prev && prev.focus) prev.focus({ preventScroll: true }); };
  }

  /* ---------- real time ---------- */
  const on = (type: string, fn: (data: any) => void) => api.on(type, (d) => fn(d));
  for (const type of ["order.new", "order.line", "order.status", "kitchen.busy", "menu.soldout"]) api.on(type, refreshSoon);
  api.on("stream.lost", () => { if (!DEMO) lost(); });
  api.on("stream.back", () => { void back(); });
  if (!DEMO) { addEventListener("offline", lost); addEventListener("online", () => { void probe(); }); }

  /* ---------- the heartbeat of the tablet, the clock, what the ticker watches ---------- */
  let device = load<string>("device", "");
  if (!device) { device = "t" + Math.random().toString(36).slice(2, 12); store("device", device); }
  let beatAt = 0, probeAt = 0, enterAt = 0;
  const beatMs = Math.max(10, cfg.beatSec || 30) * 1000;
  onTick((n) => {
    clock.textContent = hm(n);
    const real = Date.now();
    if (off) { if (real - probeAt >= 5000) { probeAt = real; void probe(); } return; }
    if (real - beatAt >= beatMs) { beatAt = real; void beatOnce(); }
    /* an order for an hour enters the queue (the hour - cfg.enterBefore): ask the server once it is time */
    const q = k.queue;
    if (q && real - enterAt >= 5000 && q.later.some((l) => l.enter <= n)) { enterAt = real; void refresh(); }
    /* a quiet safety net: events can be lost on the way */
    else if (lastLoad && n - lastLoad >= 60_000 && real - enterAt >= 5000) { enterAt = real; void refresh(); }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { sleep(); return; }
    wake(); tickAll();
    if (!off) { beatAt = Date.now(); void beatOnce(); void refresh(); }
  });

  /* ---------- "Търси" (loaded at the first touch) and the pencil (in the row, never floating) ---------- */
  function openFind() { import("./find.ts").then((m) => m.openFind(k)).catch(() => toast("<b>Търсачката не се зареди</b><small>Провери връзката и опитай пак.</small>", { secs: 5 })); }
  $<HTMLButtonElement>("[data-kfind]", root)!.addEventListener("click", openFind);
  mountPen("kuhnya", $<HTMLElement>("[data-penslot]", root)!);

  Object.assign(k, {
    me, cfg, boss, sec, all, secName, page, tablet: tab, root, main, stripEl, href, now, hm, sync, onTick, on, call, send,
    online: () => !off, onNet: (fn: (online: boolean) => void) => { netSubs.add(fn); return () => { netSubs.delete(fn); }; },
    queue: null, queueErr: null, onQueue: (fn: (q: KQueue | null) => void) => { qSubs.add(fn); return () => { qSubs.delete(fn); }; }, refresh,
    onNew: (fn: (t: KTicket) => void) => { newSubs.add(fn); return () => { newSubs.delete(fn); }; },
    strip, pills, toast, setTab, loading, fail, empty, modal,
    soundOn, audioReady: () => ready, onSound: (fn: () => void) => { soundSubs.add(fn); return () => { soundSubs.delete(fn); }; }, beep,
    afterTouch, openFind, goTo: null,
  } satisfies KFrame);

  loading();
  clock.textContent = hm(now());
  strip();
  wake();
  /* first the actions kept from before (a reload while there was no connection), then the queue */
  beatAt = Date.now();
  void (async () => { await beatOnce(); if (box.size() && !off) await back(); else await refresh(); })();
  return k;
}
