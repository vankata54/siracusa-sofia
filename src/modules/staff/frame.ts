/* Siracusa · the shared phone frame of the staff apps "Сервитьор" and "Шофьор" (stage D).
   Port of the frame part of design/pages-servitor/_staff.js (ST.mount) and design/pages-shofyor/_driver.js (DR.mount):
   top bar (Търси · Молив · Смяна), bottom nav with 4 tabs and badges, action bar, sheets, toast with "Отмени", the strip
   and the full screen "Няма връзка", theme (Авто / Светла / Тъмна / По часа), mm:ss timers, real-time events, the sheet
   "Смяна", the shell of the search. No customer cart, footer, assistant, cookie banner or marketing.
   The page is src/modules/staff/Staff.astro (head, theme without a flash, the waiting skeleton); the styles staff.css.

   ------------------------------------------------------------------------------------------------------------------
   API (the screen authors code against this)

   const st = await mountStaff(opts);  if (!st) return;      // null: no session / wrong role -> already redirected
   mountStaff(opts: StaffOpts): Promise<Staff | null>
     module: "waiter" | "driver"          the app (tabs, words, the rights check)
     screen: string                       data-page of the app ("tables", "calls", "delivery" ...)
     tab?: string | null                  the active tab ("tables" | "calls" | "ready" | "order"; "list" | "route" | "fuel" |
                                          "shift"); null: no bottom nav (a screen with "Назад" and its own action bar)
     title: string, sub?: string          top bar (sub by default: the name of the signed-in person)
     back?: { href, label }               "Назад" on the left ("Маси", "Доставки")
     bar?: boolean | "stack"              an action bar above the bottom nav: st.bar (fill its innerHTML with .pill buttons)
     tall?: boolean                       more room under the content (the stacked bar of "Нова поръчка")
     search?: SearchProvider | () => Promise<SearchProvider>     what "Търси" searches in (find.ts is loaded on first open);
                                          without it there is no "Търси" and no field
     find?: boolean                       "Търси" in the top bar (default: a tab, no "Назад", no homeFind)
     homeFind?: { text, label }           the first screen: the search field is in the page (the frame draws it)
     shift?: () => ShiftInfo | Promise<ShiftInfo>               the rows of the sheet "Смяна" (shift start, tables, car ...)
     offline?: "stale" | "queue"          no connection: "stale" (waiter: timers frozen, badges grey, actions off with the
                                          reason), "queue" (driver: the actions are kept on the phone and go by themselves)
     offlineFull?: boolean                no connection takes the whole screen (the waiter's "Залата") with the steps,
                                          "Опитай пак" and "Виж последните данни"
     netText?: () => string               the words on the strip after "Няма връзка. " (default: the prototype's)
     queue?: () => void                   the driver: "Виж" on the strip (the sheet with the waiting records)
     staleNote?: string                   the second sentence of "Последни данни от 19:42."
     bare?: boolean                       sign-in screens: "Siracusa · Персонал", no tools, no nav, NO session check
     tabs?: StaffTab[]                    other tabs than the module's four

   Staff (what mountStaff returns; also window.SCStaff for the console and the e2e tests)
     me: Me | null                        the session (user.name, user.role, sections); null on a bare screen
     boss: boolean                        the main admin, the owner or the manager looks at the module
     app, top, main, nav, bar, ov         the elements: main is the mount point of the screen (starts with the skeleton)
     setTop({ title?, sub?, back?, find? })   change the top bar (a title that depends on the data: "Маса 12")
     setBadge(tab, n, grey?)              the badge of a tab: 0 hides it; grey: the number may be old
     sheet({ title, html?, foot?, focus?, onClose? }): Sheet     { el, body, foot, close() }; focus stays inside, Esc closes
     confirm({ title, text?, ok?, no?, danger?, icon? }, onOk): Sheet
     toast(text, { undo?, undoLabel?, ms? })                     one at a time, under the top bar; "Отмени" for 5 s
     openSearch(provider?, q?)            the full-screen search (default provider: opts.search)
     setSearch(provider | null)           give (or take away) what "Търси" searches in after the mount
     timer(since, cls?): string           '<span class="tnum" data-since="…">2:15</span>', ticks once a second;
                                          an ancestor with data-lvl (or data-lvl="120,300") gets .warn / .late
     tick(), secs(since), mmss(s), clock(ms) ("19:42" in Sofia), setLevels(warn, late), serverNow(ms)
     onLive(types, fn): () => void        real-time events (api.on); the frame says "Свързваме се отново …" by itself
     onReload(fn): () => void             the connection is back (stream.back, "Опитай пак"): load the data again
     synced(at?)                          the data on the screen are fresh (enables "Виж последните данни")
     fail(e): "offline" | "auth" | "error"   an error of a load: no connection -> the strip / the full screen; 401 ->
                                          sign-in; anything else -> "Не успяхме да заредим данните" with "Опитай пак" in main
     offline: boolean, stale: boolean     no connection now; the screen shows old data (timers frozen)
     onNet(fn(offline)): () => void       the connection changed: draw the screen again
     offAttr(why?): string                ' aria-disabled="true" data-off="…"' while stale, else "": a touch says why
     netRefresh()                         the words on the strip changed (the driver's waiting records)
     skeleton(n?), empty({ icon?, title, text?, action? }), error(text?): string     the states of a screen (HTML)
     loading()                            main shows the skeleton again
     stt(kind, word, icon, extra?): string   a status chip (icon + word + colour)
     theme(), setTheme(t), navApp()       "system" | "light" | "dark" | "hour"; "google" | "waze"
     onPrefs(fn): () => void              theme or navigation app changed
     haptic(pattern?), logout()
     beforeLogout(fn): () => void          a question before "Изход" (the waiter's unsent orders): fn resolves false = stay

   Reserved data-act values (the frame handles the click anywhere on the page): find, menu, retry, queue, cached, reload,
   theme, navapp, logout. Any element with data-off shows the reason in a toast instead of acting.
   No connection (decision 18.11.2026): the screen does not change. The tabs and every link to another page of the site are
   off (aria-disabled on the tabs) and a touch says "Няма връзка: остани на този екран, действията се пазят тук."; a link
   inside the same page (#), a phone number and an app outside (target="_blank": the navigation) still work.
   ------------------------------------------------------------------------------------------------------------------ */
import "sc-icons:magnifying-glass,user,caret-left,wifi-slash,arrow-clockwise,clock,sign-out,squares-four,bell-ringing,chef-hat,plus,moped,path,gas-pump,wallet,pencil-simple,warning,check-circle,x";
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";
import { api, http, pick, demoTok, ApiError, DEMO } from "../../client/api.ts";
import type { Me } from "../../client/api-admin.ts";
import { murl } from "../routes.ts";
import { aurl } from "../../admin/routes.ts";
import type { SearchProvider } from "./find.ts";
export type { SearchProvider };
export type { Me };

export type StaffModule = "waiter" | "driver";
export type Theme = "system" | "light" | "dark" | "hour";
export type NavApp = "google" | "waze";
export interface StaffTab {
  key: string; href: string; icon: string; word: string;
  /** the accessible name when it is longer than the word ("Нова поръчка") */
  label?: string;
  /** the tab has a badge: red (waiting for me) or ember (ready) */
  badge?: "red" | "ember";
  /** the unit after the number in the accessible name ("активни") */
  unit?: string;
}
export interface Sheet { el: HTMLElement; body: HTMLElement; foot: HTMLElement | null; close(): void }
export interface ShiftRow { label: string; /** text */ value?: string; /** HTML in place of value (a link "Автомобил 1 · смени") */ html?: string; /** a small line under the row */ note?: string; tnum?: boolean }
export interface ShiftInfo {
  /** rows after the name: "На смяна от", "Моите маси", "Автомобил" ... */
  rows?: ShiftRow[];
  /** HTML after the theme (notifications, the watch, the location) */
  extra?: string;
  /** HTML in the foot above "Изход" (the link "Приключи смяната") */
  foot?: string;
  /** the sheet is drawn: bind the author's own buttons */
  bind?(s: Sheet): void;
}
export interface StaffOpts {
  module: StaffModule; screen: string; tab?: string | null; title: string; sub?: string;
  back?: { href: string; label: string };
  bar?: boolean | "stack"; tall?: boolean; find?: boolean;
  homeFind?: { text: string; label: string };
  search?: SearchProvider | (() => Promise<SearchProvider>);
  shift?: () => ShiftInfo | Promise<ShiftInfo>;
  offline?: "stale" | "queue"; offlineFull?: boolean;
  netText?: () => string; queue?: () => void; staleNote?: string;
  bare?: boolean; tabs?: StaffTab[];
}
export interface Staff {
  module: StaffModule; me: Me | null; boss: boolean;
  app: HTMLElement; top: HTMLElement; main: HTMLElement; nav: HTMLElement | null; bar: HTMLElement | null; ov: HTMLElement;
  setTop(o: { title?: string; sub?: string; back?: { href: string; label: string } | null; find?: boolean }): void;
  setBadge(tab: string, n: number, grey?: boolean): void;
  sheet(o: SheetOpts): Sheet;
  confirm(o: { title: string; text?: string; ok?: string; no?: string; danger?: boolean; icon?: string }, onOk?: () => void): Sheet;
  toast(text: string, o?: { undo?: () => void; undoLabel?: string; ms?: number }): void;
  openSearch(provider?: SearchProvider | (() => Promise<SearchProvider>), q?: string): void;
  setSearch(provider: SearchProvider | (() => Promise<SearchProvider>) | null): void;
  timer(since: number, cls?: string): string;
  tick(): void; secs(since: number): number; mmss(s: number): string; clock(ms: number): string;
  setLevels(warn: number, late: number): void; serverNow(ms: number): void;
  onLive(types: string | string[], fn: (data: unknown, type: string) => void): () => void;
  onReload(fn: () => void): () => void;
  synced(at?: number): void;
  fail(e: unknown): "offline" | "auth" | "error";
  readonly offline: boolean; readonly stale: boolean;
  onNet(fn: (offline: boolean) => void): () => void;
  offAttr(why?: string): string;
  netRefresh(): void;
  skeleton(n?: number): string;
  empty(o: { icon?: string; title: string; text?: string; action?: string }): string;
  error(text?: string): string;
  loading(): void;
  stt(kind: string, word: string, icon: string, extra?: string): string;
  theme(): Theme; setTheme(t: Theme): void; navApp(): NavApp;
  onPrefs(fn: () => void): () => void;
  haptic(pattern?: number | number[]): void;
  logout(): void;
  beforeLogout(fn: () => boolean | Promise<boolean>): () => void;
}
export interface SheetOpts { title: string; html?: string; foot?: string; /** a selector inside the sheet (default: "Затвори") */ focus?: string; onClose?: () => void }

/* ---------- words of the two apps ---------- */
const ROLE_N: Record<string, string> = { admin: "Главен админ", owner: "Собственик", manager: "Управител", waiter: "Сервитьор", kitchen: "Кухня", driver: "Шофьор", marketing: "Маркетинг" };
const STAFF_ROLES = ["waiter", "kitchen", "driver"];
/** the sign-in of the app (the waiter's own screen) or the admin's */
const signInUrl = (m: StaffModule, next?: string) => { const f = MOD[m].login; return f ? f(next) : aurl.login(next); };
const MOD: Record<StaffModule, { n: string; suffix: string; nav: string; find: string; net: string; tabs: () => StaffTab[]; login?: (next?: string) => string }> = {
  waiter: {
    /* the waiter signs in on the app's own screen (the PIN on a known phone, else the password): /servitor/vhod/ */
    login: (next) => murl.servitor("vhod", next ? "next=" + encodeURIComponent(next) : undefined),
    n: "Сервитьор", suffix: "Персонал", nav: "Приложение на сервитьора", find: "Търси: маси, поръчки, изчерпано, резервации, ястия", net: "Поръчките се пазят тук.",
    tabs: () => [
      { key: "tables", href: murl.servitor(), icon: "squares-four", word: "Маси" },
      { key: "calls", href: murl.servitor("povikvania"), icon: "bell-ringing", word: "Повиквания", badge: "red" },
      { key: "ready", href: murl.servitor("gotovi"), icon: "chef-hat", word: "Готови", badge: "ember" },
      { key: "order", href: murl.servitor("porachka"), icon: "plus", word: "Поръчка", label: "Нова поръчка" },
    ],
  },
  driver: {
    n: "Шофьор", suffix: "Шофьор", nav: "Приложение на шофьора", find: "Търси в моите доставки: номер, адрес", net: "Записите се пазят тук.",
    tabs: () => [
      { key: "list", href: murl.shofyor(), icon: "moped", word: "Доставки", badge: "red", unit: "активни" },
      { key: "route", href: murl.shofyor("marshrut"), icon: "path", word: "Маршрут" },
      { key: "fuel", href: murl.shofyor("gorivo"), icon: "gas-pump", word: "Гориво" },
      { key: "shift", href: murl.shofyor("smyana"), icon: "wallet", word: "Смяна" },
    ],
  },
};
const OFF_WHY = "Без връзка колегите няма да видят. Опитай, щом връзката се върне.";
const OFF_NAV = "Няма връзка: остани на този екран, действията се пазят тук.";
/** a link that would load another page (without a connection the browser shows an empty page) */
function leavesPage(a: HTMLAnchorElement): boolean {
  if (a.target === "_blank" || a.hasAttribute("download")) return false;
  let u: URL; try { u = new URL(a.href, location.href); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.origin !== location.origin) return false;
  return u.pathname !== location.pathname || u.search !== location.search;
}
const CONN_WORD = { on: "свързано", re: "свързваме се отново", off: "няма връзка" };

/* ---------- small helpers ---------- */
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
function lsGet<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } }
function lsSet(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
const pad2 = (n: number) => String(n).padStart(2, "0");
/** "19:42" in Sofia */
const clock = (ms: number) => {
  const d = new Date(ms);
  try { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":"); return pad2(+p[0] % 24) + ":" + p[1]; }
  catch { return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
};
/** the hour in Sofia (the theme "По часа" is dark 18:00-07:00 there, wherever the phone thinks it is) */
function sofiaHour(): number {
  try { return +new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", hour12: false }).format(new Date()) % 24; } catch { return new Date().getHours(); }
}

/* ---------- the preferences of this device: localStorage "st-prefs" {theme, nav} (the same key in both apps) ---------- */
const prefs: { theme: Theme; nav: NavApp } = { theme: "system", nav: "google", ...lsGet<Partial<{ theme: Theme; nav: NavApp }>>("st-prefs", {}) };
if (!["system", "light", "dark", "hour"].includes(prefs.theme)) prefs.theme = "system";
if (prefs.nav !== "waze") prefs.nav = "google";
const savePrefs = () => lsSet("st-prefs", { theme: prefs.theme, nav: prefs.nav });
const isDarkHour = () => { const h = sofiaHour(); return h >= 18 || h < 7; };
let themeNow = "";
function applyTheme() {
  const de = document.documentElement, t = prefs.theme === "hour" ? (isDarkHour() ? "dark" : "light") : prefs.theme;
  if (t === themeNow) return; themeNow = t;
  if (t === "system") delete de.dataset.theme; else de.dataset.theme = t;
  /* the colour of the browser bar follows a chosen theme (with "Авто" the two media variants of the page stay) */
  const bg = t === "system" ? "" : getComputedStyle(de).getPropertyValue("--bg").trim();
  $$<HTMLMetaElement>('meta[name="theme-color"]').forEach((m) => { if (!m.dataset.c) m.dataset.c = m.content; m.content = bg || m.dataset.c!; });
}

/* the session: the same call as staffApi.me() (src/client/api-admin.ts), kept here so the phone does not load the whole
   runtime of the admin before the first paint (a.ts comes later, for the pencil and "Изход") */
const readMe = pick(async (c): Promise<Me | null> => { const s = await c.staff.bySession(demoTok("staff")); return s ? { ...s, home: "" } : null; },
  () => http<Me | null>("GET", "auth/me"));
const adminRuntime = () => import("../../admin/a.ts");

/** the frame of a screen; null when the page is leaving (no session: the sign-in; a role without the module: its home) */
export async function mountStaff(o: StaffOpts): Promise<Staff | null> {
  const M = MOD[o.module], de = document.documentElement;
  de.dataset.staff = o.module;
  document.body.classList.add("st");
  applyTheme();
  document.title = o.title + " | Siracusa · " + M.suffix;

  /* ----- the guard ----- */
  let me: Me | null = null;
  if (!o.bare) {
    try { me = await readMe(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) me = null;
      else { bootFail(o, e); return null; }
    }
    if (!me) { location.replace(signInUrl(o.module, murl.here())); return null; }
    const role = me.user.role;
    /* the same rule as the stub of stage C: the main admin, the role of the module, or a role with the module's section */
    if (!(role === "admin" || role === o.module || me.sections.includes(o.module))) { location.replace(STAFF_ROLES.includes(role) ? aurl.app(role) : aurl.home()); return null; }
  }
  const boss = !!me && !STAFF_ROLES.includes(me.user.role);
  const tabs = o.tabs || M.tabs();
  const hasNav = !o.bare && o.tab !== null && o.tab !== undefined;
  const mode = o.offline || (o.module === "driver" ? "queue" : "stale");

  /* ----- the DOM ----- */
  const app = document.createElement("div");
  app.className = "st-app" + (hasNav ? "" : " nonav") + (o.bar ? " withbar" : "") + (o.tall ? " tall" : "");
  app.dataset.page = o.screen; app.dataset.mod = o.module;
  /* "Търси" in the top bar: a screen with tabs and without "Назад"; on the first screen the field is in the page. Never
     without something to search in (opts.search) */
  let findWanted = o.find !== undefined ? o.find : hasNav && !o.homeFind && !o.back;
  const findOn = !!o.search && findWanted;
  const top = o.bare
    ? '<header class="st-top"><div class="tt"><b class="st-word">Siracusa</b><span>' + esc(M.suffix) + '</span></div><h1 class="vh">' + esc(o.title) + "</h1></header>"
    : '<header class="st-top' + (o.back ? " back" : "") + '">' + backHTML(o.back) +
      '<div class="tt"><h1>' + esc(o.title) + "</h1><span data-sub>" + esc(o.sub || (me ? me.user.name : "")) + "</span></div>" +
      '<div class="st-tools"><button class="st-tb" type="button" data-act="find" aria-label="' + esc(M.find) + '"' + (findOn ? "" : " hidden") + ">" + ic("magnifying-glass", 22) + "<span>Търси</span></button>" +
      '<span class="st-penslot" data-penslot></span>' +
      '<button class="st-tb st-me" type="button" data-act="menu" aria-label="Смяна и настройки, свързано"><span class="tbi">' + ic("user", 22) + '<span class="dot"></span></span><span>Смяна</span></button></div></header>';
  app.innerHTML = top + '<div class="st-net" role="status" hidden></div><div data-pre></div>' +
    (o.homeFind ? '<div class="st-findslot" data-findslot' + (o.search ? "" : " hidden") + '><button class="st-findfield" type="button" data-act="find" aria-label="' + esc(o.homeFind.label) + '">' + ic("magnifying-glass", 22) + "<span>" + esc(o.homeFind.text) + "</span></button></div>" : "") +
    '<main id="main" tabindex="-1" data-edit-id="' + o.module + "." + esc(o.screen) + '">' + skeleton() + '</main><div class="offline" data-offscreen hidden></div>';
  const ov = document.createElement("div"); ov.className = "st-ov";
  ov.innerHTML = (o.bar ? '<div class="st-bar' + (hasNav ? "" : " nonav") + (o.bar === "stack" ? " stack" : "") + '"></div>' : "") + (hasNav ? navHTML(tabs, o.tab!, M.nav) : "") +
    '<div class="st-toast" role="status" aria-live="polite"></div>';
  $$("[data-boot]").forEach((el) => el.remove());
  document.body.append(app, ov);
  const main = $("main", app)!, topEl = $(".st-top", app)!, netEl = $(".st-net", app)!, preEl = $("[data-pre]", app)!, offEl = $("[data-offscreen]", app)!;
  const navEl = $(".st-nav", ov), barEl = $(".st-bar", ov), toastEl = $(".st-toast", ov)!, findSlot = $("[data-findslot]", app);
  const background = () => [app, navEl, barEl].filter(Boolean) as HTMLElement[];

  /* ----- top bar ----- */
  function setTop(t: { title?: string; sub?: string; back?: { href: string; label: string } | null; find?: boolean }) {
    if (o.bare) return;
    if (t.title !== undefined) { o.title = t.title; $("h1", topEl)!.textContent = t.title; document.title = t.title + " | Siracusa · " + M.suffix; }
    if (t.sub !== undefined) $("[data-sub]", topEl)!.textContent = t.sub;
    if (t.back !== undefined) { $(".st-back", topEl)?.remove(); topEl.classList.toggle("back", !!t.back); if (t.back) topEl.insertAdjacentHTML("afterbegin", backHTML(t.back)); }
    if (t.find !== undefined) { findWanted = t.find; syncFind(); }
  }
  /* "Търси" and the field of the first screen are shown only while there is something to search in */
  function syncFind() {
    const b = $<HTMLElement>('[data-act="find"]', topEl); if (b) b.hidden = !(findWanted && o.search);
    if (findSlot) findSlot.hidden = offFull() || !o.search;
  }
  function setSearch(p: SearchProvider | (() => Promise<SearchProvider>) | null) { o.search = p || undefined; syncFind(); }

  /* ----- badges ----- */
  function setBadge(key: string, n: number, grey = false) {
    const el = navEl && $<HTMLElement>('[data-cnt="' + key + '"]', navEl); if (!el) return;
    /* the number is read with the name of the tab ("Повиквания, 4"; "Доставки, 4 активни"): the comma and the unit are
       there only for the screen reader */
    $("[data-n]", el)!.textContent = String(n); el.hidden = !n; el.classList.toggle("grey", grey);
  }

  /* ----- sheets (focus stays inside, the background is inert, Esc closes the top one) ----- */
  const openSheets: (() => void)[] = [];
  function sheet(s: SheetOpts): Sheet {
    const w = document.createElement("div"), id = "sh" + Math.random().toString(36).slice(2, 7); w.className = "st-sheetwrap";
    w.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="st-sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle"></div><div class="sh"><h2 id="' + id + '">' + esc(s.title) + '</h2><button class="iconbtn" type="button" data-close aria-label="Затвори">' + ic("x", 22) + '</button></div><div class="body">' + (s.html || "") + "</div>" + (s.foot ? '<div class="sfoot">' + s.foot + "</div>" : "") + "</div>";
    ov.insertBefore(w, toastEl);
    const prev = document.activeElement as HTMLElement | null, bg = background();
    bg.forEach((el) => { el.inert = true; });
    w.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const f = $$<HTMLElement>(".st-sheet button:not([disabled]), .st-sheet a[href], .st-sheet input:not([disabled]), .st-sheet textarea, .st-sheet select, .st-sheet [tabindex='0']", w).filter((el) => el.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const a = f[0], z = f[f.length - 1], act = document.activeElement;
      if (e.shiftKey && (act === a || !w.contains(act))) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && (act === z || !w.contains(act))) { e.preventDefault(); a.focus(); }
    });
    let closed = false;
    function close() {
      if (closed) return; closed = true;
      const i = openSheets.indexOf(close); if (i > -1) openSheets.splice(i, 1);
      if (!openSheets.length && !$(".st-find", ov)) bg.forEach((el) => { el.inert = false; });
      w.classList.remove("on"); setTimeout(() => w.remove(), 340);
      if (s.onClose) s.onClose();
      if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
    }
    openSheets.push(close);
    $<HTMLButtonElement>(".scrim", w)!.onclick = close; $<HTMLButtonElement>("[data-close]", w)!.onclick = close;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      w.classList.add("on");
      const f = (s.focus && $<HTMLElement>(s.focus, w)) || $<HTMLElement>("[data-close]", w);
      if (f) f.focus({ preventScroll: true });
    }));
    return { el: w, body: $(".body", w)!, foot: $(".sfoot", w), close };
  }
  function confirm(c: { title: string; text?: string; ok?: string; no?: string; danger?: boolean; icon?: string }, onOk?: () => void): Sheet {
    const s = sheet({ title: c.title, html: c.text ? '<p style="margin:0 0 8px">' + esc(c.text) + "</p>" : "",
      foot: '<button class="pill pill-line pill-lg" type="button" data-no>' + esc(c.no || "Откажи") + '</button><button class="pill ' + (c.danger ? "pill-red" : "pill-ink") + ' pill-lg" type="button" data-yes>' + (c.icon ? ic(c.icon, 22) : "") + esc(c.ok || "Да") + "</button>" });
    s.foot!.classList.add("two");
    $<HTMLButtonElement>("[data-no]", s.foot!)!.onclick = s.close;
    $<HTMLButtonElement>("[data-yes]", s.foot!)!.onclick = () => { s.close(); if (onOk) onOk(); };
    return s;
  }

  /* ----- toast: one at a time (the new one replaces the old), under the top bar; under the strip when it is shown ----- */
  let toastT: ReturnType<typeof setTimeout> | undefined;
  function toast(text: string, t: { undo?: () => void; undoLabel?: string; ms?: number } = {}) {
    toastEl.innerHTML = "<span>" + esc(text) + "</span>" + (t.undo ? '<button type="button">' + esc(t.undoLabel || "Отмени") + "</button>" : "");
    toastEl.classList.toggle("solo", !t.undo);
    placeToast();
    const b = $<HTMLButtonElement>("button", toastEl); if (b) b.onclick = () => { toastEl.classList.remove("on"); clearTimeout(toastT); t.undo!(); };
    requestAnimationFrame(() => toastEl.classList.add("on"));
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove("on"), t.ms || (t.undo ? 5000 : 2600));
  }

  /* ----- the search: the shell is a separate file, loaded on the first open ----- */
  let findMod: Promise<typeof import("./find.ts")> | null = null;
  function openSearch(p?: SearchProvider | (() => Promise<SearchProvider>), q?: string) {
    const src = p || o.search; if (!src) return;
    if ($(".st-find", ov)) return;
    (findMod || (findMod = import("./find.ts")))
      .then(async (m) => m.openFind({ ov, before: toastEl, background, sheetsOpen: () => openSheets.length > 0 }, typeof src === "function" ? await src() : src, q))
      .catch(() => { findMod = null; toast("Търсенето не се зареди. Опитай пак."); });
  }

  /* ----- timers: one ticker for the page, from timestamps; stopped while the page is hidden or the data are old ----- */
  let skew = 0, frozenAt = 0, tickId: ReturnType<typeof setInterval> | undefined, ticks = 0;
  const levels = { warn: 120, late: 300 };
  const secs = (since: number) => Math.max(0, Math.floor(((frozenAt || Date.now() + skew) - since) / 1000));
  const mmss = (s: number) => Math.floor(s / 60) + ":" + pad2(s % 60);
  const timer = (since: number, cls?: string) => '<span class="tnum' + (cls ? " " + esc(cls) : "") + '" data-since="' + Math.round(since) + '">' + mmss(secs(since)) + "</span>";
  function paint() {
    $$("[data-since]").forEach((el) => {
      const s = secs(+el.dataset.since!), t = mmss(s); if (el.textContent !== t) el.textContent = t;
      const host = el.closest<HTMLElement>("[data-lvl]");
      if (host) { const p = (host.dataset.lvl || "").split(",").map(Number), w = p[0] || levels.warn, l = p[1] || levels.late; host.classList.toggle("warn", s >= w && s < l); host.classList.toggle("late", s >= l); }
    });
  }
  function onTick() { paint(); if (prefs.theme === "hour" && ++ticks % 20 === 0) applyTheme(); }
  function startTicker() { clearInterval(tickId); tickId = undefined; if (!document.hidden) tickId = setInterval(onTick, 1000); }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { onTick(); applyTheme(); } startTicker(); });
  startTicker();

  /* ----- the connection: "on", "re" (the stream is connecting again), "off" (no connection) ----- */
  let conn: "on" | "re" | "off" = "on", streamLost = false, showCached = false, lastSync = 0, probeT: ReturnType<typeof setInterval> | undefined, lostT: ReturnType<typeof setTimeout> | undefined, reT: ReturnType<typeof setTimeout> | undefined;
  const netSubs = new Set<(off: boolean) => void>(), reloadSubs = new Set<() => void>(), prefSubs = new Set<() => void>();
  const isStale = () => conn === "off" && mode === "stale";
  const offFull = () => conn === "off" && !!o.offlineFull && !showCached;
  function setConn(next: "on" | "re" | "off") {
    if (next === conn) return;
    const was = conn; conn = next;
    if (next === "off") { if (mode === "stale") frozenAt = Date.now() + skew; clearInterval(probeT); probeT = setInterval(() => { if (!document.hidden) probe(); }, 10_000); }
    else { clearInterval(probeT); probeT = undefined; }
    if (next !== "off") { frozenAt = 0; showCached = false; }
    /* "connecting again" heals by itself: the browser retries the stream every few seconds, and a stream that was opened
       anew (a screen subscribed to one more event) does not say "back" */
    clearTimeout(reT);
    if (next === "re") reT = setTimeout(() => { if (conn === "re") { streamLost = false; probe(); } }, 9000);
    drawNet();
    if ((next === "off") !== (was === "off")) netSubs.forEach((f) => f(next === "off"));
    if (next === "on" && was !== "on") { paint(); reloadSubs.forEach((f) => f()); }
  }
  /** is the restaurant reachable now */
  async function probe(): Promise<boolean> {
    if (navigator.onLine === false) { setConn("off"); return false; }
    if (!DEMO) {
      try { const r = await fetch("/api/health", { cache: "no-store" }); if (!r.ok) throw new Error("health"); }
      catch { setConn("off"); return false; }
    }
    setConn(streamLost ? "re" : "on"); return true;
  }
  /** the toast sits under the top bar, or under the strip "Няма връзка" while it is shown */
  function placeToast() {
    const low = !netEl.hidden; toastEl.classList.toggle("low", low);
    toastEl.style.top = low ? Math.max(136, Math.round(68 + netEl.offsetHeight + 4)) + "px" : "";
  }
  function drawNet() {
    const off = conn === "off";
    const meBtn = $(".st-me", topEl);
    if (meBtn) { meBtn.classList.toggle("off", conn !== "on"); meBtn.setAttribute("aria-label", "Смяна и настройки, " + CONN_WORD[conn]); }
    app.classList.toggle("is-off", off);
    if (navEl) { navEl.classList.toggle("stale", off && mode === "stale"); $$("a", navEl).forEach((x) => { if (off) x.setAttribute("aria-disabled", "true"); else x.removeAttribute("aria-disabled"); }); }
    if (conn === "on") { netEl.hidden = true; netEl.innerHTML = ""; }
    else {
      const queue = off && mode === "queue" && !!o.queue;
      netEl.innerHTML = ic(off ? "wifi-slash" : "arrow-clockwise", 22) + "<span>" + (off ? "Няма връзка. " + esc(o.netText ? o.netText() : M.net) : "Свързваме се отново …") + "</span>" +
        (off ? '<button type="button" data-act="' + (queue ? "queue" : "retry") + '">' + (queue ? "Виж" : "Опитай пак") + "</button>" : "");
      netEl.hidden = false;
    }
    /* what sticks under the top bar starts below the strip */
    app.style.setProperty("--st-stick", 68 + (netEl.hidden ? 0 : netEl.offsetHeight) + "px");
    /* a toast already shown moves with the strip (it never covers it) */
    if (toastEl.classList.contains("on")) placeToast();
    /* the whole screen (the waiter's "Залата"), or the old data with a note */
    const full = offFull();
    main.hidden = full; if (findSlot) findSlot.hidden = full || !o.search;
    offEl.hidden = !full; offEl.innerHTML = full ? offlineHTML(o.module, lastSync > 0) : "";
    preEl.innerHTML = off && mode === "stale" && !full && lastSync > 0
      ? '<section class="st-sec" data-stale><div class="notice warn">' + ic("clock", 22) + "<span><b>Последни данни от " + clock(lastSync) + ".</b> " + esc(o.staleNote || "Таймерите са спрени, а „Отивам“ ще може, щом има връзка.") + "</span></div></section>" : "";
  }
  window.addEventListener("offline", () => setConn("off"));
  window.addEventListener("online", () => { probe(); });
  if (!o.bare) {
    /* the stream drops and the browser connects again by itself; a short drop is not shown */
    api.on("stream.lost", () => { streamLost = true; clearTimeout(lostT); lostT = setTimeout(() => { if (streamLost && conn === "on") probe(); }, 1200); });
    api.on("stream.back", () => { streamLost = false; clearTimeout(lostT); if (conn !== "on") probe(); else reloadSubs.forEach((f) => f()); });
  }
  function fail(e: unknown): "offline" | "auth" | "error" {
    if (e instanceof ApiError && e.code === "offline") { probe().then((ok) => { if (ok && main.querySelector(".st-skel")) main.innerHTML = errorHTML(); }); return "offline"; }
    if (e instanceof ApiError && e.status === 401) { location.replace(signInUrl(o.module, murl.here())); return "auth"; }
    main.innerHTML = errorHTML(e instanceof ApiError && e.message ? e.message : undefined); return "error";
  }

  /* ----- the sheet "Смяна": who, the connection, the navigation app (driver), the theme, "Изход" ----- */
  const seg = (act: string, label: string, cur: string, list: [string, string][]) => '<div class="st-seg" role="group" aria-label="' + label + '">' + list.map((x) => '<button type="button" data-act="' + act + '" data-v="' + x[0] + '" aria-pressed="' + (cur === x[0]) + '">' + x[1] + "</button>").join("") + "</div>";
  const kv = (r: ShiftRow) => '<div class="kv"><span class="muted">' + esc(r.label) + "</span>" + (r.html !== undefined ? r.html : "<b" + (r.tnum ? ' class="tnum"' : "") + ">" + esc(r.value || "") + "</b>") + "</div>" + (r.note ? '<p class="small muted" style="margin:6px 0 0">' + esc(r.note) + "</p>" : "");
  let shiftOpen: Sheet | null = null;
  function shiftBody(info: ShiftInfo): string {
    return '<div class="kvs">' + kv({ label: ROLE_N[me!.user.role] || M.n, value: me!.user.name }) + (info.rows || []).map(kv).join("") +
      '<div class="kv"><span class="muted">Връзка</span><b data-conn>' + (conn === "on" ? "Свързано" : conn === "re" ? "Свързваме се отново" : "Няма връзка") + "</b></div></div>" +
      (o.module === "driver" ? '<p class="st-cap" style="margin-top:18px">Навигация с</p>' + seg("navapp", "Приложение за навигация", prefs.nav, [["google", "Google Maps"], ["waze", "Waze"]]) + '<p class="small muted" style="margin:8px 0 0">Бутонът „Навигация“ отваря адреса направо в избраното приложение.</p>' : "") +
      '<p class="st-cap" style="margin-top:18px">Тема</p>' + seg("theme", "Тема", prefs.theme, [["system", "Авто"], ["light", "Светла"], ["dark", "Тъмна"], ["hour", "По часа"]]) +
      '<p class="small muted" style="margin:8px 0 0">„По часа“ е тъмна от 18:00 до 07:00' + (o.module === "waiter" ? ", защото вечер салонът е тъмен" : "") + ".</p>" + (info.extra || "");
  }
  function openShift() {
    if (!me || shiftOpen) return;
    let info: ShiftInfo = {}, wait: Promise<ShiftInfo> | null = null;
    try { const r = o.shift ? o.shift() : {}; if (r && typeof (r as Promise<ShiftInfo>).then === "function") wait = r as Promise<ShiftInfo>; else info = r as ShiftInfo; } catch { /* the sheet works without the shift data */ }
    const foot = (i: ShiftInfo) => (i.foot || "") + (boss ? '<a class="pill pill-line pill-lg pill-block" href="' + esc(aurl.home()) + '">' + ic("squares-four", 22) + "Към таблото</a>" : "") +
      '<button class="pill pill-line pill-lg pill-block" type="button" data-act="logout">' + ic("sign-out", 22) + "Изход</button>";
    const s = sheet({ title: "Смяна", html: shiftBody(info), foot: foot(info), onClose: () => { shiftOpen = null; } });
    shiftOpen = s; if (info.bind) info.bind(s);
    if (wait) wait.then((i) => { if (shiftOpen !== s || !i) return; s.body.innerHTML = shiftBody(i); if (s.foot) s.foot.innerHTML = foot(i); if (i.bind) i.bind(s); }).catch(() => { /* keeps the rows it has */ });
  }
  function setTheme(t: Theme) { prefs.theme = t; savePrefs(); applyTheme(); $$('[data-act="theme"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === t))); prefSubs.forEach((f) => f()); }
  let leaving = false;
  const guards = new Set<() => boolean | Promise<boolean>>();
  async function logout() {
    if (leaving) return;
    for (const g of guards) { try { if (!(await g())) return; } catch { return; } }
    leaving = true;
    const back = MOD[o.module].login;
    (back ? import("../../client/api-admin.ts").then(async ({ staffApi }) => { try { await staffApi.logout(); } catch { /* the cookie goes anyway on the next sign-in */ } location.href = back(); })
      : adminRuntime().then((a) => a.logout())).catch(() => { leaving = false; toast("Няма връзка. Изходът ще стане, щом се върне."); });
  }

  /* ----- clicks the frame handles anywhere on the page ----- */
  document.addEventListener("click", (e) => {
    const el = e.target as Element | null; if (!el || !el.closest) return;
    /* while the pencil is on, a touch points at an element for a recommendation: the frame does not act on it */
    if ($('.st-top .sa-pen-btn[aria-pressed="true"]')) return;
    const link = el.closest<HTMLAnchorElement>("a[href]");
    if (link && conn === "off" && leavesPage(link)) { e.preventDefault(); e.stopPropagation(); toast(OFF_NAV); return; }
    const offBtn = el.closest<HTMLElement>("[data-off]");
    if (offBtn) { e.preventDefault(); e.stopPropagation(); toast(offBtn.dataset.off || OFF_WHY); return; }
    const t = el.closest<HTMLElement>("[data-act]"); if (!t) return;
    const a = t.dataset.act;
    if (a === "menu") openShift();
    else if (a === "find") openSearch();
    else if (a === "queue") { if (o.queue) o.queue(); }
    else if (a === "cached") { showCached = true; drawNet(); main.focus({ preventScroll: true }); }
    else if (a === "reload") { main.innerHTML = skeleton(); if (reloadSubs.size) reloadSubs.forEach((f) => f()); else location.reload(); }
    else if (a === "theme") setTheme(t.dataset.v as Theme);
    else if (a === "navapp") { prefs.nav = t.dataset.v === "waze" ? "waze" : "google"; savePrefs(); $$('[data-act="navapp"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === prefs.nav))); prefSubs.forEach((f) => f()); }
    else if (a === "logout") logout();
    else if (a === "retry") {
      const b = t as HTMLButtonElement, old = b.innerHTML; b.disabled = true; b.textContent = "Проверяваме…";
      const t0 = Date.now();
      probe().then((ok) => setTimeout(() => { if (b.isConnected) { b.disabled = false; b.innerHTML = old; } if (!ok) toast("Още няма връзка. Опитваме сами на всеки 10 сек."); }, Math.max(0, 600 - (Date.now() - t0))));
    }
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && openSheets.length && !$(".st-find", ov)) { e.preventDefault(); openSheets[openSheets.length - 1](); } });

  /* ----- the pencil for recommendations (decision 15.11): in the top bar, in the flow, only for a signed-in person ----- */
  if (me && !o.bare) mountPencil(me, o.module, $("[data-penslot]", topEl)!, barEl);

  const st: Staff = {
    module: o.module, me, boss, app, top: topEl, main, nav: navEl, bar: barEl, ov,
    setTop, setBadge, sheet, confirm, toast, openSearch, setSearch,
    timer, tick: paint, secs, mmss, clock,
    setLevels(w, l) { levels.warn = w; levels.late = l; paint(); },
    serverNow(ms) { skew = ms - Date.now(); },
    onLive(types, fn) { const offs = (Array.isArray(types) ? types : [types]).map((t) => api.on(t, (d, ty) => { fn(d, ty); })); return () => offs.forEach((f) => f()); },
    onReload(fn) { reloadSubs.add(fn); return () => { reloadSubs.delete(fn); }; },
    synced(at) { lastSync = at || Date.now(); },
    fail,
    get offline() { return conn === "off"; },
    get stale() { return isStale(); },
    onNet(fn) { netSubs.add(fn); return () => { netSubs.delete(fn); }; },
    offAttr(why) { return isStale() ? ' aria-disabled="true" data-off="' + esc(why || OFF_WHY) + '"' : ""; },
    netRefresh: drawNet,
    skeleton, empty: emptyHTML, error: errorHTML,
    loading() { main.innerHTML = skeleton(); },
    stt: (k, word, icon, extra) => '<span class="stt ' + esc(k) + '">' + ic(icon, 18) + "<span>" + esc(word) + "</span>" + (extra || "") + "</span>",
    theme: () => prefs.theme, setTheme, navApp: () => prefs.nav,
    onPrefs(fn) { prefSubs.add(fn); return () => { prefSubs.delete(fn); }; },
    haptic(p) { try { const ua = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation; if (ua && !ua.hasBeenActive) return; if (navigator.vibrate) navigator.vibrate(p || 12); } catch { /* no vibration */ } },
    logout,
    beforeLogout(fn) { guards.add(fn); return () => { guards.delete(fn); }; },
  };
  (window as unknown as { SCStaff?: Staff }).SCStaff = st;
  if (navigator.onLine === false) setConn("off");
  return st;
}

/* ---------- pieces of HTML ---------- */
const backHTML = (b?: { href: string; label: string } | null) => (b ? '<a class="st-back" href="' + esc(b.href) + '">' + ic("caret-left", 22) + esc(b.label) + "</a>" : "");
function navHTML(tabs: StaffTab[], cur: string, label: string): string {
  return '<nav class="st-nav" aria-label="' + esc(label) + '">' + tabs.map((t) =>
    '<a href="' + esc(t.href) + '" data-tab="' + esc(t.key) + '"' + (t.label ? ' aria-label="' + esc(t.label) + '"' : "") + (cur === t.key ? ' aria-current="page"' : "") + ">" + ic(t.icon, 26) + '<span class="lb">' + esc(t.word) + "</span>" +
    (t.badge ? '<span class="cnt' + (t.badge === "ember" ? " ember" : "") + '" data-cnt="' + esc(t.key) + '" hidden><span class="vh">, </span><span data-n>0</span>' + (t.unit ? '<span class="vh"> ' + esc(t.unit) + "</span>" : "") + "</span>" : "") + "</a>").join("") + "</nav>";
}
/** the loading state of a screen: the shapes are hidden from the screen reader, which hears "Зареждаме …" */
export function skeleton(n = 4): string {
  let h = '<div class="st-skel" aria-hidden="true"><div class="skel s"></div>';
  for (let i = 0; i < n; i++) h += '<div class="skel"></div>';
  return h + '</div><span class="vh" role="status">Зареждаме …</span>';
}
function emptyHTML(e: { icon?: string; title: string; text?: string; action?: string }): string {
  return '<div class="st-empty"><div class="ill">' + ic(e.icon || "check-circle", 52) + "</div><h2>" + esc(e.title) + "</h2>" + (e.text ? "<p>" + esc(e.text) + "</p>" : "") + (e.action || "") + "</div>";
}
function errorHTML(text?: string): string {
  return '<div class="st-empty err" role="alert"><div class="ill">' + ic("warning", 48) + "</div><h2>Не успяхме да заредим данните</h2><p>" + esc(text || "Опитай пак след малко. Ако не стане, кажи на управителя.") + "</p>" +
    '<button class="pill pill-red pill-lg" type="button" data-act="reload">' + ic("arrow-clockwise", 22) + "Опитай пак</button></div>";
}
/* the whole screen "Няма връзка": what does not arrive, what is kept on the phone, what to do step by step */
function offlineHTML(module: StaffModule, cached: boolean): string {
  const lead = module === "waiter"
    ? "Повикванията от масите и „Готово“ от кухнята не стигат до мен. Новите поръчки се пазят на телефона и тръгват сами, щом връзката се върне."
    : "Новите доставки не стигат до мен. Отбелязаното се пази на телефона и тръгва само, щом връзката се върне.";
  const steps = module === "waiter"
    ? ['Провери дали телефонът е в мрежата на ресторанта <span class="missing">[ЛИПСВА: име на Wi-Fi мрежата]</span>.', "Изключи и включи Wi-Fi. Ако мрежата не работи, ползвай мобилни данни.", "Докато няма връзка, обиколи залата и питай кухнята за готовите ястия.", "Ако до 2 минути не стане, кажи на управителя."]
    : ["Провери дали мобилните данни са включени.", "Изключи и включи самолетния режим.", "Ако до 2 минути не стане, обади се в ресторанта."];
  return '<div class="ill">' + ic("wifi-slash", 44) + '</div><h2 class="h2">Няма връзка с ресторанта</h2><p class="lead">' + lead + "</p>" +
    "<ol>" + steps.map((s) => "<li><span>" + s + "</span></li>").join("") + "</ol>" +
    '<button class="pill pill-red pill-lg pill-block" type="button" data-act="retry">' + ic("arrow-clockwise", 22) + "Опитай пак</button>" +
    (cached ? '<button class="pill pill-line pill-lg pill-block" type="button" data-act="cached">Виж последните данни</button>' : "");
}
/** the session could not be read (no connection, the server is down): the bare frame with "Няма връзка" and "Опитай пак" */
function bootFail(o: StaffOpts, e: unknown) {
  const M = MOD[o.module], off = e instanceof ApiError && e.code === "offline";
  $$("[data-boot]").forEach((el) => el.remove());
  const app = document.createElement("div"); app.className = "st-app nonav"; app.dataset.page = o.screen;
  app.innerHTML = '<header class="st-top"><div class="tt"><b class="st-word">Siracusa</b><span>' + esc(M.suffix) + "</span></div></header>" +
    '<main id="main" tabindex="-1">' + (off
      ? '<div class="offline"><div class="ill">' + ic("wifi-slash", 44) + '</div><h1 class="h2">Няма връзка с ресторанта</h1><p class="lead">Не успяхме да отворим приложението. Провери връзката и опитай пак.</p><button class="pill pill-red pill-lg pill-block" type="button" data-boot-retry>' + ic("arrow-clockwise", 22) + "Опитай пак</button></div>"
      : '<div class="st-empty err" role="alert"><div class="ill">' + ic("warning", 48) + '</div><h1 class="h2">Не успяхме да отворим приложението</h1><p>Опитай пак след малко. Ако не стане, кажи на управителя.</p><button class="pill pill-red pill-lg" type="button" data-boot-retry>' + ic("arrow-clockwise", 22) + "Опитай пак</button></div>") + "</main>";
  document.body.appendChild(app);
  $<HTMLButtonElement>("[data-boot-retry]", app)!.onclick = () => location.reload();
  window.addEventListener("online", () => location.reload(), { once: true });
}

/* the pencil: mountPen(module, slot) of src/admin/a.ts, loaded after the first paint. Until it arrives the slot holds a
   button of the same size (nothing moves under the finger); a touch on it is remembered and turns the pencil on. */
function mountPencil(me: Me, module: StaffModule, slot: HTMLElement, bar: HTMLElement | null) {
  /* inside a frame of "Модулите на живо" the pencil of the preview points here: no second one */
  try { if (window.frameElement && window.frameElement.closest(".pv-dev")) return; } catch { /* another origin */ }
  slot.innerHTML = '<button class="st-tb" type="button" data-pen-wait aria-label="Молив">' + ic("pencil-simple", 22) + "<span>Молив</span></button>";
  const ph = $<HTMLButtonElement>("[data-pen-wait]", slot)!;
  let want = false;
  ph.onclick = () => { want = true; ph.setAttribute("aria-busy", "true"); };
  const obs = new MutationObserver(() => {
    const real = $<HTMLButtonElement>(".sa-pen-btn", slot); if (!real) return;
    obs.disconnect();
    const focused = document.activeElement === ph; ph.remove();
    if (focused) real.focus({ preventScroll: true });
    /* the toast of the pencil stays above the action bar */
    const host = $("sa-pen-ui"); if (host && bar) host.style.setProperty("--toast-bp", "176px");
    if (want) real.click();
  });
  obs.observe(slot, { childList: true });
  const load = () => adminRuntime().then((a) => { a.A.me = me; a.mountPen(module, slot); }).catch(() => { obs.disconnect(); ph.remove(); });
  const idle = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (idle) idle(() => { load(); }, { timeout: 1500 }); else setTimeout(load, 200);
}
