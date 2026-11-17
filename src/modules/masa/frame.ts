/* QR маса: the frame of the five screens (port of design/pages-masa/_masa.js, on the real core).
   ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
   mountMasa({screen, title, render, tick?, allowClosed?}) reads the table's code (murl.masaCode: the path on the server,
   #k= in the demo), opens the sitting of this phone (masaApi.open; the welcome screen of a NEW scan passes fresh = true, so
   a closed sitting is followed by a new one), follows it in real time (masaApi.on → masaApi.get) and calls render(M)
   after every change. The handle M (type Masa) has the view, the language of this phone, the helpers that the screens
   share (names, avatars, statuses, times, banners, toasts, sheets) and M.act(): one action of the core with the same
   handling of every error (offline, 404 code gone, 403 not in the sitting, 409 closed / sold out / call locked, 422, 429).
   Gates: the invalid code (no table in the top bar, no nav), the closed sitting ("Благодарим, че бяхте при нас!",
   except on the bill), a full table, no connection before the first view, a server error.
   Nothing of this is in the shared runtime: the page imports this file (and ./dishes.ts with the menu). */
import "sc-icons:fork-knife,bell-ringing,shopping-bag,user,map-pin,globe,hourglass,check,fire,check-circle,warning-circle,arrow-clockwise,clock,qr-code,phone,smiley,house,sign-in,sign-out,x,info,lock";
import { SC } from "../../client/sc.ts";
import "../../client/sc-sheet.ts"; /* SC.sheet(): the profile and the screens' sheets */
import { api, ApiError } from "../../client/api.ts";
import { masaApi, type GuestView } from "../../client/api-floor.ts";
import { murl } from "../routes.ts";
import { clockOverride, sofiaNow } from "../../lib/time.ts";
import { NAV, SCREEN_PATH, STATUS, type MasaPage } from "./words.ts";

export type { GuestView };
export type Lang = "bg" | "en";
type View = GuestView;
type Why = "load" | "act" | "remote" | "lang" | "tick" | "offline";
export interface ScreenOpts {
  screen: MasaPage;
  /** the H1 / <title> in both languages */
  title: [string, string];
  /** the bill shows a closed sitting itself ("Сметката е платена", the rating) */
  allowClosed?: boolean;
  render: (M: Masa, why: Why) => void;
  /** every second (live timers) */
  tick?: (M: Masa) => void;
  /** after a change from another phone: the cart lines that are new or have more (flash them) */
  added?: (M: Masa, keys: string[]) => void;
}

const ic = SC.ic, esc = SC.esc, fmt = SC.fmt;
const de = document.documentElement;
const LKEY = "sc-masa-lang";
let lang: Lang = (() => { try { return localStorage.getItem(LKEY) === "en" ? "en" : "bg"; } catch { return "bg"; } })();
const L = (bg: string, en?: string | null): string => (lang === "en" && en != null ? en : bg);
const p2 = (n: number) => String(n).padStart(2, "0");

/* ---------- the handle ---------- */
export interface Masa {
  code: string; screen: MasaPage; view: View; offline: boolean; lost: boolean;
  lang: () => Lang; L: typeof L; ic: typeof ic; esc: typeof esc; fmt: typeof fmt;
  main: HTMLElement;
  plural(n: number, one: [string, string], many: [string, string]): string;
  dishes(n: number): string;
  me(): number;
  name(phone: number | null, who?: string): string;
  av(phone: number | null, sm?: boolean): string;
  whoTag(phone: number | null, who?: string): string;
  stp(st: string): string;
  clock(iso: string | number | null | undefined): string;
  mmss(sec: number): string;
  /** seconds since an ISO time of the core (the core's clock) */
  since(iso: string): number;
  /** seconds until an ISO time of the core */
  until(iso: string): number;
  href(screen: MasaPage, hash?: string): string;
  tableLabel(): string;
  zone(): string;
  banners(o?: { kitchen?: boolean; callLink?: boolean }): string;
  toast(text: string, undo?: () => void): void;
  openSheet(o: { title: string; html: string; onClose?: () => void }): { el: HTMLDivElement; close: () => void };
  act<T>(fn: () => Promise<T>, o?: { busy?: HTMLElement | null }): Promise<T | null>;
  refresh(): Promise<void>;
  rerender(why?: Why): void;
}

const ssGet = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const ssSet = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };

/** A new scan of the table's QR code (only the welcome screen is its address): this tab never opened this table, or the
    page was opened straight (typed or scanned: no link of this site before it, not a reload or "Назад"). A new scan after
    a closed sitting starts the next one (masaApi.open fresh). */
function newScan(code: string, screen: MasaPage): boolean {
  if (screen !== "welcome") return false;
  if (!ssGet("sc-masa-seen-" + code)) return true;
  let type = "navigate";
  try { const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined; if (n) type = n.type; } catch { /* old browser */ }
  let fromSite = false;
  try { fromSite = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch { /* no referrer */ }
  return type === "navigate" && !fromSite;
}

export function mountMasa(o: ScreenOpts): Masa {
  const main = SC.main, code = murl.masaCode();
  let skew = 0, gated: "" | "invalid" | "closed" | "full" | "offline" | "error" = "";
  let timer: ReturnType<typeof setTimeout> | undefined, reading = false, again = false;
  const state = { view: null as unknown as View, offline: false, lost: false };

  const M: Masa = {
    code, screen: o.screen, main,
    get view() { return state.view; },
    get offline() { return state.offline; },
    get lost() { return state.lost; },
    lang: () => lang, L, ic, esc, fmt,
    plural: (n, one, many) => SC.plural(n, L(one[0], one[1]), L(many[0], many[1])),
    dishes: (n) => SC.plural(n, L("ястие", "dish"), L("ястия", "dishes")),
    me: () => (state.view && state.view.me ? state.view.me.phone : 0),
    name(phone, who) {
      if (phone == null || !phone) return who === "Сервитьор" ? L("Сервитьор", "Waiter") : /^Гост \d+$/.test(who || "") ? L(who!, "Guest " + who!.slice(5)) : who || L("Сервитьор", "Waiter");
      return phone === M.me() ? L("Вие", "You") : L("Телефон ", "Phone ") + phone;
    },
    av(phone, sm) {
      if (!phone) return "";
      return '<span class="av p' + Math.min(7, phone) + (phone === M.me() ? " me" : "") + (sm ? " sm" : "") + '" aria-hidden="true">' + (phone === M.me() ? L("В", "Y") : phone) + "</span>";
    },
    whoTag: (phone, who) => '<span class="who">' + M.av(phone, true) + esc(M.name(phone, who)) + "</span>",
    stp(st) { const d = STATUS[st] || STATUS.accepted; return '<span class="stp ' + st + '">' + ic(d[2], 16) + L(d[0], d[1]) + "</span>"; },
    clock(iso) {
      if (!iso) return "";
      const ts = typeof iso === "number" ? iso : Date.parse(iso);
      const ov = clockOverride();
      /* the preview clock (?preview=1&t=…): the times follow the hour of the preview, as the status does */
      if (ov) { let m = ov.h * 60 + ov.m + Math.round((ts - (Date.now() + skew)) / 60000); m = ((m % 1440) + 1440) % 1440; return p2(Math.floor(m / 60)) + ":" + p2(m % 60); }
      const c = sofiaNow(new Date(ts));
      return p2(c.h) + ":" + p2(c.m);
    },
    mmss: (sec) => { const s = Math.max(0, Math.round(sec)); return Math.floor(s / 60) + ":" + p2(s % 60); },
    since: (iso) => (Date.now() + skew - Date.parse(iso)) / 1000,
    until: (iso) => (Date.parse(iso) - (Date.now() + skew)) / 1000,
    href: (screen, hash) => murl.masa(code, SCREEN_PATH[screen], hash),
    zone: () => (state.view.table.zone === "garden" ? L("Градина", "Garden") : L("Салон", "Hall")),
    tableLabel: () => L("Маса ", "Table ") + state.view.table.n + " · " + M.zone(),
    banners(b = {}) {
      const v = state.view;
      let h = "";
      if (state.offline) h += '<div class="mnote bad" role="alert">' + ic("warning-circle", 24) + "<div><b>" + L("Няма връзка", "No connection") + "</b><p>" + L("Поръчката ви е запазена - опитайте пак. Ако е спешно, махнете на сервитьора.", "Your order is saved - try again. If it is urgent, wave to the waiter.") + '</p><div class="acts"><button class="pill pill-ink" type="button" data-mretry>' + ic("arrow-clockwise", 20) + L("Опитай пак", "Try again") + "</button></div></div></div>";
      else if (state.lost) h += '<div class="mnote" role="status">' + ic("arrow-clockwise", 24) + "<div><b>" + L("Свързваме се отново", "Reconnecting") + "</b><p>" + L("Показваме последното, което знаем. Обновява се само.", "We show the last we know. It updates by itself.") + "</p></div></div>";
      if (b.kitchen !== false && v && !v.kitchen.open && v.status === "open") {
        h += '<div class="mnote warn" role="status">' + ic("clock", 24) + "<div><b>" + (v.kitchen.before ? L("Кухнята отваря в 10:00", "The kitchen opens at 10:00") : L("Кухнята приема поръчки до 22:30", "The kitchen takes orders until 22:30")) + "</b><p>" +
          L("Менюто е за разглеждане, поръчка от телефона не може. За сметката или нещо друго повикайте сервитьор.", "You can browse the menu, but not order from the phone. For the bill or anything else, call a waiter.") + "</p>" +
          (b.callLink === false ? "" : '<div class="acts"><a class="pill pill-line" href="' + M.href("call") + '">' + ic("bell-ringing", 20) + L("Повикай сервитьор", "Call a waiter") + "</a></div>") + "</div></div>";
      }
      return h;
    },
    toast,
    openSheet(so) {
      const s = SC.sheet(so);
      const b = s.el.querySelector(".sheet-h [data-close]");
      if (b) b.innerHTML = ic("x", 20) + L("Затвори", "Close");
      const sc = s.el.querySelector(".scrim");
      if (sc) sc.setAttribute("aria-label", L("Затвори", "Close"));
      return s;
    },
    act,
    refresh,
    rerender: (why = "lang") => draw(why),
  } as Masa;

  /* ---------- the toast with "Отмени" in the language of the phone ---------- */
  let toastT: ReturnType<typeof setTimeout> | undefined;
  function toast(text: string, undo?: () => void) {
    const t = SC.ov.querySelector<HTMLElement>(".toast")!;
    t.innerHTML = "<span>" + esc(text) + "</span>" + (undo ? '<button type="button">' + L("Отмени", "Undo") + "</button>" : "");
    if (undo) t.querySelector("button")!.onclick = () => { undo(); t.classList.remove("on"); };
    requestAnimationFrame(() => t.classList.add("on"));
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), undo ? 5000 : 2600);
  }

  /* ---------- the chrome: addresses, the table, the counter, the words of the language ---------- */
  const top = document.querySelector<HTMLElement>("[data-mtop]")!;
  function links() {
    document.querySelectorAll<HTMLAnchorElement>("a[data-mgo]").forEach((a) => {
      const s = (Object.keys(SCREEN_PATH) as MasaPage[]).find((k) => SCREEN_PATH[k] === a.dataset.mgo) || "welcome";
      if (code) a.href = M.href(s);
    });
  }
  function chrome() {
    de.lang = lang;
    if (lang === "en") de.dataset.mlang = "en"; else delete de.dataset.mlang;
    document.title = L(o.title[0], o.title[1]) + " | Siracusa Bar & Grill";
    NAV.forEach((n) => document.querySelectorAll("[data-mw=" + n.id + "]").forEach((s) => { s.textContent = L(n.bg, n.en); }));
    document.querySelectorAll("[data-mnav]").forEach((n) => n.setAttribute("aria-label", L("Основна навигация", "Main navigation")));
    document.querySelectorAll("[data-mdnav]").forEach((n) => n.setAttribute("aria-label", L("Раздели", "Sections")));
    const lb = top.querySelector<HTMLElement>("[data-mlang]")!;
    lb.dataset.mlang = lang === "en" ? "bg" : "en";
    lb.querySelector("[data-mlt]")!.textContent = lang === "en" ? "BG" : "EN";
    const lv = lb.querySelector<HTMLElement>("[data-mlv]")!;
    lv.textContent = lang === "en" ? ", превключи на български" : ", switch to English"; lv.lang = lang === "en" ? "bg" : "en";
    const tab = top.querySelector<HTMLElement>("[data-mtab]")!;
    const v = state.view;
    if (v) {
      tab.querySelector("[data-mtabt]")!.textContent = M.tableLabel();
      tab.setAttribute("aria-label", M.tableLabel() + L(", начало", ", start"));
      const n = v.status === "open" ? v.cart.n : 0, s = v.cart.sum;
      document.querySelectorAll<HTMLElement>("[data-mcnt]").forEach((el) => { el.textContent = String(n); el.hidden = n === 0; });
      document.querySelectorAll('[data-mgo="kolichka"]').forEach((a) => { const d = a.querySelector("[data-mcntl]"); if (d) d.textContent = n ? ", " + M.dishes(n) + " · " + fmt(s) : L(", празна", ", empty"); });
    }
    tab.hidden = gated === "invalid" || gated === "full";
    const navOff = !!gated && gated !== "offline" && gated !== "error";
    document.querySelectorAll<HTMLElement>("[data-mnav], [data-mdnav]").forEach((n) => { n.hidden = navOff; });
  }

  /* ---------- gates ---------- */
  function gate(kind: typeof gated, msg = "") {
    gated = kind;
    const R = SC.RESTAURANT, v = state.view;
    let h = "";
    if (kind === "invalid" || kind === "full") {
      h = '<div class="gate bad" role="alert"><span class="ill">' + ic(kind === "full" ? "users-three" : "qr-code", 52) + '</span><p class="eyebrow">' + L("QR кодът", "The QR code") + '</p><h1 class="h2">' +
        (kind === "full" ? L("Масата е пълна", "The table is full") : L("Този код вече не работи", "This code no longer works")) + "</h1><p>" +
        (kind === "full" ? esc(lang === "en" ? "There are already 7 phones at the table. Order from one of them or ask the waiter." : msg) : L("Може да е от маса, която вече не се ползва. Попитайте сервитьора: той ще ви помогне за секунди.", "It may be from a table that is no longer in use. Ask the waiter: they will help you in seconds.")) + "</p>" +
        '<div class="btns"><a class="pill pill-line pill-lg" href="' + SC.url.menu() + '">' + ic("fork-knife", 20) + L("Разгледай менюто", "Browse the menu") + '</a><a class="pill pill-soft pill-lg" href="tel:' + R.phoneIntl + '">' + ic("phone", 20) + R.phone + "</a></div></div>";
    } else if (kind === "closed") {
      h = '<div class="gate ok" role="status"><span class="ill">' + ic("check", 52) + '</span><p class="eyebrow">' + esc(M.tableLabel()) + '</p><h1 class="h2">' + L("Благодарим, че бяхте при нас!", "Thank you for coming!") + "</h1><p>" +
        L("Сметката е платена и масата е затворена. Нова поръчка от този телефон не може. Ако останете още, сканирайте кода на масата отново.", "The bill is paid and the table is closed. You cannot order from this phone any more. If you stay longer, scan the table code again.") + '</p><div class="btns">' +
        (v.canRate && !v.rating ? '<a class="pill pill-red pill-lg" href="' + M.href("bill", "rate") + '">' + ic("smiley", 20) + L("Кажете ни как беше", "Tell us how it was") + "</a>" : "") +
        '<a class="pill pill-line pill-lg" href="' + SC.url.home() + '">' + ic("house", 20) + L("Към сайта на Siracusa", "Go to the Siracusa website") + "</a></div></div>";
    } else if (kind === "offline" || kind === "error") {
      h = '<div class="gate bad" role="alert"><span class="ill">' + ic("warning-circle", 52) + '</span><h1 class="h2">' + (kind === "offline" ? L("Няма връзка", "No connection") : L("Нещо се обърка", "Something went wrong")) + "</h1><p>" +
        (kind === "offline" ? L("Проверете интернета и опитайте пак. Ако е спешно, махнете на сервитьора.", "Check the internet and try again. If it is urgent, wave to the waiter.") : esc(msg || L("Опитайте пак след малко.", "Please try again in a moment."))) +
        '</p><div class="btns"><button class="pill pill-ink pill-lg" type="button" data-mretry>' + ic("arrow-clockwise", 20) + L("Опитай пак", "Try again") + "</button></div></div>";
    }
    main.innerHTML = '<div class="mpage">' + h + "</div>";
    chrome();
  }

  /* ---------- the view ---------- */
  let shown = false;
  function draw(why: Why) {
    const v = state.view;
    if (!v) { if (gated) gate(gated); chrome(); return; }
    if (v.status === "closed" && !o.allowClosed) { gate("closed"); return; }
    gated = "";
    chrome();
    o.render(M, why);
    if (!shown) { shown = true; main.removeAttribute("aria-busy"); }
  }
  function setView(v: View, why: Why) {
    const prev = state.view;
    skew = Date.parse(v.now) - Date.now();
    state.view = v;
    ssSet("sc-masa-seen-" + code, v.session);
    let added: string[] = [];
    if (prev && why === "remote" && prev.session === v.session) {
      const was = new Map(prev.cart.lines.map((l) => [l.key, l.q]));
      added = v.cart.lines.filter((l) => !l.mine && (was.get(l.key) || 0) < l.q).map((l) => l.key);
      const first = v.cart.lines.find((l) => l.key === added[0]);
      if (first) toast(M.name(first.phone) + L(" добави ", " added ") + first.name);
      else if (prev.pending && !v.pending && v.orders.length > prev.orders.length) toast(L("Сервитьорът потвърди поръчката", "The waiter confirmed your order"));
    }
    draw(why);
    if (added.length && o.added) o.added(M, added);
    /* the stream connects after the first view: what changed before it was open is read once more */
    if (why === "load") { setTimeout(later, 1500); setTimeout(later, 5000); }
  }

  /** the view again (after an event, "Опитай пак", every minute); a read that comes while one runs is done once after it */
  async function refresh(): Promise<void> {
    if (!code) return;
    if (reading) { again = true; return; }
    reading = true;
    try {
      const v = state.view ? await masaApi.get(code) : await masaApi.open(code, newScan(code, o.screen));
      const back = state.offline;
      state.offline = false;
      setView(v, state.view ? "remote" : "load");
      if (back) toast(L("Връзката се върна", "You are back online"));
    } catch (e) { fail(e, true); }
    finally { reading = false; if (again) { again = false; void refresh(); } }
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(() => { void refresh(); }, 120); };

  /* ---------- errors: the same handling for every action ---------- */
  const EN: Record<string, string> = {
    call_active: "Already called. The waiter sees your table and how long you have waited.",
    call_cooldown: "The waiter has just been here. The same call works again in a moment.",
    sold_out: "This dish is sold out today.",
    removed: "This dish is no longer on the menu.",
    breakfast_closed: "Breakfast is served until 11:30.",
    lunch_table: "The lunch menu cannot be ordered from the table.",
    bill_nothing: "Everything has already been asked for.",
    session_closed: "The table is closed. If you stay longer, scan the table code again.",
    throttled: "Too many requests in a short time. Wait a little or call a waiter.",
    picked: "Another phone pays for this dish.",
    pick_gone: "This dish has already been paid or asked for.",
    bill_asked: "You have already asked for the bill. Tell the waiter if you want a change.",
  };
  function fail(e: unknown, reading = false) {
    const err = e instanceof ApiError ? e : new ApiError("server", L("Нещо се обърка. Опитайте пак.", "Something went wrong. Try again."), 500);
    if (!(e instanceof ApiError)) console.error(e);
    if (err.code === "offline") {
      if (!state.view) { gate("offline"); return; }
      const was = state.offline;
      state.offline = true; draw("offline");
      if (!was || !reading) toast(L("Няма връзка. Поръчката ви е запазена - опитайте пак.", "No connection. Your order is saved - try again."));
      return;
    }
    if (err.status === 404 && /Този код/.test(err.message)) { state.view = null as unknown as View; gate("invalid"); return; }
    if (err.code === "table_full") { gate("full", err.message); return; }
    if (err.code === "guest") { state.view = null as unknown as View; void refresh(); return; } /* not in the sitting (any more): open it again */
    if (!state.view) { gate("error", err.message); return; }
    let text = lang === "en" ? EN[err.code] || (err.code === "closed" ? (state.view.kitchen.before ? "The kitchen opens at 10:00." : "The kitchen takes orders until 22:30.") : err.message) : err.message;
    if (err.retryIn) text += " " + L("Пак след ", "Again in ") + M.mmss(err.retryIn) + ".";
    toast(text);
    if (err.status === 409 || err.status === 404) void refresh();
  }
  async function act<T>(fn: () => Promise<T>, ao: { busy?: HTMLElement | null } = {}): Promise<T | null> {
    const b = ao.busy;
    if (b) { if (b.getAttribute("aria-busy") === "true") return null; b.setAttribute("aria-busy", "true"); }
    try {
      const r = await fn();
      const v = (r && typeof r === "object" && "view" in (r as object) ? (r as unknown as { view: View }).view : r) as View;
      state.offline = false;
      if (v && typeof v === "object" && "session" in v) setView(v, "act");
      return r;
    } catch (e) { fail(e); return null; }
    finally { if (b) b.removeAttribute("aria-busy"); }
  }

  /* ---------- the profile sheet ---------- */
  async function profile() {
    const v = state.view;
    if (!v) return;
    /* the dish pictures: the menu chunk (already on the screens with dishes) */
    const MD = await import("../../client/sc-menu.ts").then((m) => m.SC).catch(() => null);
    const mine: { name: string; id: string; q: number; sum: number | null; st: string }[] = [];
    if (v.pending) v.pending.lines.filter((l) => l.mine).forEach((l) => mine.push({ name: l.name, id: l.id, q: l.q, sum: l.sum, st: "wait" }));
    v.orders.forEach((r) => r.lines.filter((l) => l.mine).forEach((l) => mine.push({ name: l.name, id: l.id, q: l.q, sum: l.sum, st: l.out ? "out" : l.st })));
    const rows = mine.length ? mine.map((z) => '<div class="pline">' + (MD && MD.byId[z.id] ? MD.pic(z.id) : '<span class="pic"></span>') + "<span><b>" + esc(z.name) + "</b><small>" + z.q + L(" бр. · ", " pcs · ") + (z.sum == null ? "" : fmt(z.sum)) + "</small></span>" + M.stp(z.st) + "</div>").join("")
      : "<p>" + L("Още не сте поръчали от този телефон.", "You have not ordered from this phone yet.") + "</p>";
    const th = SC.prefs.theme || "system";
    const s = M.openSheet({ title: L("Профил", "Profile"), html:
      '<div class="psec"><h3>' + L("Език", "Language") + '</h3><div class="seg" role="group" aria-label="' + L("Език", "Language") + '"><button type="button" data-mlang="bg" aria-pressed="' + (lang === "bg") + '" lang="bg">Български</button><button type="button" data-mlang="en" aria-pressed="' + (lang === "en") + '" lang="en">English</button></div></div>' +
      '<div class="psec"><h3>' + L("Моите поръчки на тази маса", "My orders at this table") + "</h3>" + rows + "</div>" +
      '<div class="psec" data-login></div>' +
      '<div class="psec"><h3>' + L("Тема", "Theme") + '</h3><div class="seg" role="group" aria-label="' + L("Тема", "Theme") + '">' + ([["system", "Авто", "Auto"], ["light", "Светла", "Light"], ["dark", "Тъмна", "Dark"]] as const).map((t) => '<button type="button" data-mtheme="' + t[0] + '" aria-pressed="' + (th === t[0]) + '">' + L(t[1], t[2]) + "</button>").join("") + "</div></div>" +
      '<div class="psec"><p class="small" style="margin:0">' + esc(M.tableLabel()) + " · " + L("отворена в ", "opened at ") + M.clock(v.openedAt) + " · " + v.phones.length + " " + (v.phones.length === 1 ? L("телефон на масата", "phone at the table") : L("телефона на масата", "phones at the table")) + "</p></div>" });
    s.el.classList.add("mprof");
    login(s.el.querySelector<HTMLElement>("[data-login]")!);
  }
  /* sign-in by choice: the site's SMS sign-in through the customers' API (the code is shown while there is no SMS provider) */
  function login(box: HTMLElement, step: "phone" | "code" = "phone", phone = "", demo = "", err = "") {
    const u = SC.user() as { name?: string; phone?: string } | null;
    const head = "<h3>" + L("Вход по желание", "Sign in if you like") + "</h3>";
    if (u) {
      box.innerHTML = head + "<p>" + L("Влезли сте", "You are signed in") + (u.name ? ": <b>" + esc(u.name) + "</b>" : ".") + " " + L("Кодовете за отстъпка и поръчките ви се пазят в профила.", "Discount codes and orders stay in your profile.") + '</p><button class="pill pill-line pill-block" type="button" data-mout>' + ic("sign-out", 20) + L("Изход", "Sign out") + "</button>";
      box.querySelector<HTMLElement>("[data-mout]")!.onclick = async () => { try { await api.auth.logout(); } catch { /* signed out here anyway */ } toast(L("Излязохте", "You are signed out")); login(box); };
      return;
    }
    const lead = "<p>" + L("Не е нужен, за да поръчате. С телефон и SMS код кодовете за отстъпка и поръчките ви се пазят в профила. С профил вземате -10% от следващата поръчка.", "Not needed to order. With your phone and an SMS code, discount codes and orders stay in your profile. With a profile you get 10% off your next order.") + "</p>";
    const errH = err ? '<p class="err" id="ml-err" role="alert">' + esc(err) + "</p>" : "";
    if (step === "phone") {
      box.innerHTML = head + lead + '<form class="mlog" novalidate><div class="field"><label for="ml-ph">' + L("Телефон", "Phone") + '</label><input class="input" id="ml-ph" type="tel" inputmode="tel" autocomplete="tel" placeholder="0888 123 456" value="' + esc(phone) + '"' + (err ? ' aria-invalid="true" aria-describedby="ml-err"' : "") + ">" + errH + "</div>" +
        '<button class="pill pill-line pill-block" type="submit">' + ic("sign-in", 20) + L("Изпрати код", "Send a code") + "</button></form>";
    } else {
      box.innerHTML = head + '<form class="mlog" novalidate><p>' + L("Изпратихме код на ", "We sent a code to ") + "<b>" + esc(phone) + "</b>.</p>" +
        (demo ? '<p class="democode">' + ic("info", 20) + "<span>" + L("Демо: SMS още не се изпраща. Вашият код: ", "Demo: no SMS is sent yet. Your code: ") + "<b data-mdemo>" + esc(demo) + "</b></span></p>" : "") +
        '<div class="field"><label for="ml-code">' + L("Код от SMS", "SMS code") + '</label><input class="input" id="ml-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"' + (err ? ' aria-invalid="true" aria-describedby="ml-err"' : "") + ">" + errH + "</div>" +
        '<button class="pill pill-red pill-block" type="submit">' + ic("sign-in", 20) + L("Влез", "Sign in") + '</button><button class="link" type="button" data-mback>' + L("Друг номер", "Another number") + "</button></form>";
      box.querySelector<HTMLElement>("[data-mback]")!.onclick = () => login(box, "phone", phone);
    }
    const f = box.querySelector<HTMLFormElement>("form")!;
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = f.querySelector<HTMLButtonElement>("[type=submit]")!;
      if (btn.getAttribute("aria-busy") === "true") return;
      btn.setAttribute("aria-busy", "true");
      try {
        if (step === "phone") {
          const ph = f.querySelector<HTMLInputElement>("#ml-ph")!.value.trim();
          const r = await api.auth.smsRequest(ph);
          login(box, "code", ph, r.demoCode || "");
        } else {
          await api.auth.smsVerify(phone, f.querySelector<HTMLInputElement>("#ml-code")!.value.trim());
          toast(L("Влязохте. Кодовете и поръчките ви се пазят в профила.", "You are signed in. Codes and orders stay in your profile."));
          login(box);
        }
      } catch (x) {
        const a = x instanceof ApiError ? x : null;
        let m = a ? (a.fields && (a.fields.phone || a.fields.code)) || a.message : L("Нещо се обърка. Опитайте пак.", "Something went wrong. Try again.");
        if (a && a.retryIn) m += " " + L("Пак след ", "Again in ") + M.mmss(a.retryIn) + ".";
        login(box, step, phone || f.querySelector<HTMLInputElement>("#ml-ph")?.value || "", demo, m);
      }
      box.querySelector<HTMLInputElement>("input")?.focus();
    });
  }

  /* ---------- delegation ---------- */
  document.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("button, a");
    if (!t) return;
    if (t.hasAttribute("data-mprofile")) { void profile(); return; }
    if (t.dataset.mlang) {
      const l = t.dataset.mlang as Lang;
      if (l === lang) return;
      lang = l;
      try { localStorage.setItem(LKEY, l); } catch { /* this page only */ }
      const sh = t.closest(".mprof");
      draw("lang");
      if (sh) { (sh.closest(".sheetwrap")?.querySelector("[data-close]") as HTMLElement | null)?.click(); setTimeout(() => void profile(), 0); }
      return;
    }
    if (t.dataset.mtheme) {
      const v = t.dataset.mtheme as "system" | "light" | "dark";
      SC.prefs.theme = v; SC.store("sc-prefs", SC.prefs);
      if (v === "system") delete de.dataset.theme; else de.dataset.theme = v;
      t.parentElement!.querySelectorAll("[data-mtheme]").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
      return;
    }
    if (t.hasAttribute("data-mretry")) { t.setAttribute("aria-busy", "true"); if (!state.view) gated = ""; void refresh(); return; }
  });

  /* ---------- start ---------- */
  links(); chrome();
  if (!code) gate("invalid");
  else {
    main.setAttribute("aria-busy", "true");
    void refresh();
    masaApi.on(() => later());
    api.on("stream.lost", () => { if (!state.lost) { state.lost = true; if (state.view) draw("remote"); } });
    api.on("stream.back", () => { state.lost = false; void refresh(); });
    addEventListener("offline", () => { if (state.view && !state.offline) { state.offline = true; draw("offline"); } });
    addEventListener("online", () => { void refresh(); });
    /* the kitchen hours, the cooldowns that ended: the view again every minute */
    document.addEventListener("sc:tick", () => { if (state.view && !state.offline) void refresh(); });
    setInterval(() => { if (state.view && !gated && o.tick) o.tick(M); }, 1000);
  }
  return M;
}
