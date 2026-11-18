/* Siracusa · "Управител": what the four screens share (design/pages-upravitel/_mgr.js, the parts that are not the frame).
   The frame is src/modules/boss/frame.ts (mountBoss); here only the content helpers of the screens:
   - the words and icons of the prototype (TST, CH, the status line), the timers from the timestamps (data-since);
   - screen(): the first load, the polite error, "Опитай пак", real time (boss.onLive), a quiet refresh every 30 s, the
     focus and the scroll kept over a redraw (as MG.refresh);
   - act(): an action of the manager; without a connection it is kept on the phone (localStorage) and sent by itself
     when the connection is back ("… Записано на телефона, тръгва само, щом има връзка.");
   - the sheets the screens share: "Обади се на клиента" (the whole number: bossApi.callCustomer writes the log),
     "Кой отива?" (the waiters on shift), "Натоварено" (the confirmation and what the customer sees).
   MONEY: nothing here adds sums; a screen shows only the sum of ONE order, ONE table and a driver's cash (core/shift.ts). */
import "sc-icons:hand-waving,receipt,qr-code,chef-hat,hourglass,users,calendar-check,check-circle,user,briefcase,phone,check,info,moped,storefront,chair,warning,warning-circle,cooking-pot,fire,pizza,bowl-food";
import { bossApi, ApiError, type MgrNow, type MgrKitchen } from "../../client/api-boss.ts";
import { ic, esc, plural, type Boss } from "../boss/frame.ts";
import { dateLong } from "../../admin/a.ts";
import { aurl } from "../../admin/routes.ts";
import { prettyPhone } from "../../lib/format.ts";
import { murl } from "../routes.ts";

export { ic, esc, plural, prettyPhone };
export const NB = " ";
/** "2 души" with a non-breaking space */
export const ppl = (n: number) => plural(n, "човек", "души").replace(" ", NB);
export const mmss = (sec: number) => { const s = Math.max(0, Math.floor(sec)), m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; };
export const secSince = (iso: string | number) => (Date.now() - (typeof iso === "number" ? iso : Date.parse(iso))) / 1000;
/** "19:41" in Sofia for a timestamp */
export function hmOf(t: string | number | Date): string {
  const d = t instanceof Date ? t : new Date(t);
  try { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":"); return String(+p[0] % 24).padStart(2, "0") + ":" + p[1]; }
  catch { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
}
/** "преди 6 мин" */
export function agoMin(t: string | number): string {
  const m = Math.max(0, Math.round(secSince(t) / 60));
  return m < 1 ? "току-що" : m < 60 ? "преди " + m + NB + "мин" : "преди " + Math.floor(m / 60) + " ч." + (m % 60 ? " " + (m % 60) + NB + "мин" : "");
}
/** "47 мин" / "6 ч 47 мин" (the same words as core/shift.ts lateText) */
export function lateText(m: number): string { const h = Math.floor(m / 60), r = m % 60; return h ? h + "\u00a0ч" + (r ? "\u00a0" + r + "\u00a0мин" : "") : m + "\u00a0мин"; }
export const toMin = (hm: string) => +hm.slice(0, 2) * 60 + +hm.slice(3, 5);
/** "ср, 18 ноември" from "2026-11-18" */
export const dayOf = (ymd: string, short = false) => { const [y, m, d] = ymd.split("-").map(Number); return dateLong(new Date(y, m - 1, d, 12), short); };

/* ---------- the words and icons of the prototype ---------- */
/** the states of a table: word and icon (MG.TST) */
export const TST: Record<string, [string, string]> = { call: ["Вика", "hand-waving"], bill: ["Сметка", "receipt"], qr: ["QR поръчка", "qr-code"], ready: ["Готово", "chef-hat"], wait: ["Чака поръчка", "hourglass"], busy: ["Заета", "users"], res: ["Резервирана", "calendar-check"], free: ["Свободна", "check-circle"] };
/** the colour of a state tag (the legend, the sheet, the search) */
export const tagCls = (st: string) => (st === "call" || st === "bill" ? "red" : st === "ready" ? "ember" : st === "free" ? "ok" : st === "wait" ? "warn" : "line");
/** a channel's icon by its name from the core ("Доставка", "Вземане", "Маса", "Офис") */
export const CH_IC: Record<string, string> = { "Доставка": "moped", "Вземане": "storefront", "Маса": "chair", "Офис": "briefcase", "Телефон": "phone" };
export const ZONE: Record<string, string> = { salon: "Салон", garden: "Градина" };

/** the restaurant's status by the hour (the admin's words, A.status of the prototype) */
export function statusOf(min: number): [string, string] {
  if (min < 600) return ["closed", "Затворено · отваряме в 10:00"];
  if (min >= 1380) return ["closed", "Затворено · отваряме утре в 10:00"];
  if (min < 1260) return ["", "Отворено до 23:00 · Доставка до 21:00"];
  if (min < 1350) return ["warn", "Доставката приключи за днес · Вземане до 22:30"];
  return ["warn", "Кухнята затвори · Отворено до 23:00"];
}
/** an hour never alone on a line: "до 21:00", "в 10:00" */
export const nbsp = (t: string) => t.replace(/(до|в|от) (\d)/g, "$1" + NB + "$2");
/** "ср, 18 ноември · 19:42  ● Отворено до 23:00 · Доставка до 21:00" */
export function statusLine(date: string, now: string): string {
  const s = statusOf(toMin(now));
  return '<p class="mg-day"><b>' + esc(dayOf(date)) + " · " + esc(now) + '</b><span class="st"><span class="mg-dot' + (s[0] ? " " + s[0] : "") + '" aria-hidden="true"></span><span>' + nbsp(esc(s[1])) + "</span></span></p>";
}

/* ---------- the addresses (never written by hand) ---------- */
export const go = {
  now: (h?: string) => murl.upravitel("", h), hall: (h?: string) => murl.upravitel("zalata", h), team: (h?: string) => murl.upravitel("ekipat", h), more: () => murl.upravitel("oshte"),
  kitchen: () => murl.kuhnya("obsht-izgled"),
  order: (no: string) => aurl.section("orders", "n=" + encodeURIComponent(no)),
  inWork: () => aurl.section("orders", "s=work"),
  /* the admin's orders open the form "Нова поръчка по телефон" with #phone=1 (src/admin/orders.ts) */
  phoneOrder: () => aurl.section("orders", "phone=1"),
  newRes: () => aurl.section("reservations", "new=1"),
  resDay: (d: string) => aurl.section("reservations", "d=" + d),
  plan: (z?: string) => aurl.section("hall", "v=plan" + (z ? "&z=" + z : "")),
  qr: () => aurl.section("qr"),
  dish: (id: string) => aurl.section("menu", "d=" + encodeURIComponent(id)),
  notes: (role: string) => aurl.section("notes", "src=" + role),
};

/* ---------- the timers: from the timestamps, every second ---------- */
export function tick(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-since]").forEach((el) => { el.textContent = mmss(secSince(el.dataset.since!)); });
}
let ticking = false;
export function startTicks(): void { if (ticking) return; ticking = true; setInterval(() => tick(), 1000); }
/** a live timer "6:10" */
export const timer = (iso: string) => '<b class="tnum" data-since="' + esc(iso) + '">' + mmss(secSince(iso)) + "</b>";

/* ---------- errors and the outbox ---------- */
export const isOff = (e: unknown) => e instanceof ApiError && e.code === "offline";
export const msgOf = (e: unknown) => (e instanceof ApiError ? e.message : "Нещо се обърка. Опитай пак.");
const OFF = " Записано на телефона, тръгва само, щом има връзка.";
const BOX = "up-outbox";
/** the actions that may wait on the phone (no "Отмени" for them: the server has not seen them yet) */
type Op = "accept" | "resConfirm" | "busy" | "backIn" | "ack" | "callGo" | "answer" | "walkin" | "setWaiter" | "setTables" | "block" | "qrConfirm" | "callAssign" | "qrAssign";
interface Queued { op: Op; args: unknown[]; label: string; at: number }
const readBox0 = (): Queued[] => { try { const v = JSON.parse(localStorage.getItem(BOX) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeBox = (l: Queued[]) => { try { if (l.length) localStorage.setItem(BOX, JSON.stringify(l)); else localStorage.removeItem(BOX); } catch { /* private mode */ } };
/** is this action already kept on the phone (the row says "Записано на телефона", its button is off) */
export const queued = (op: Op, key: string): boolean => readBox0().some((q) => q.op === op && String(q.args[0]) === key);
/** an action of the manager. ok: what happens on success (the toast with "Отмени"). Without a connection it waits on the
    phone (when `op` is given) and the toast says so; another error: its text for people. Returns the result or null. */
export async function act<T>(boss: Boss, o: { op?: Op; args?: unknown[]; label: string; run: () => Promise<T>; ok: (r: T) => void; fail?: (e: unknown) => boolean }): Promise<T | null> {
  const keep = () => {
    if (!o.op) { boss.toast("Няма връзка. Опитай пак, щом се върне."); return null; }
    writeBox([...readBox0(), { op: o.op, args: o.args || [], label: o.label, at: Date.now() }]);
    boss.toast(o.label + OFF);
    document.dispatchEvent(new CustomEvent("up:kept"));
    return null;
  };
  if (boss.offline()) return keep();
  try { const r = await o.run(); o.ok(r); return r; }
  catch (e) {
    if (isOff(e)) return keep();
    if (o.fail && o.fail(e)) return null;
    boss.toast(msgOf(e));
    return null;
  }
}
/** the connection is back: what waited on the phone goes now, in order (a refusal is said, the rest goes on) */
export async function flush(boss: Boss): Promise<void> {
  const l = readBox0(); if (!l.length) return;
  writeBox([]);
  const api = bossApi as unknown as Record<Op, (...a: unknown[]) => Promise<unknown>>;
  let sent = 0;
  for (const q of l) {
    try { await api[q.op](...q.args); sent++; }
    catch (e) { if (isOff(e)) { writeBox([...readBox0(), q]); continue; } boss.toast(q.label + ": " + msgOf(e)); }
  }
  if (sent) boss.toast(sent === 1 ? "Записаното на телефона е изпратено." : "Изпратихме " + sent + " записани действия.");
}

/* ---------- one screen: load, draw, live, refresh ---------- */
/** the events of the core a screen of the manager hears (docs/MODULES-BRIEF.md, section 4; src/core) */
export const LIVE = ["order.created", "order.new", "order.status", "order.changed", "order.line", "reservation.created", "reservation.status", "note.created", "note.status",
  "settings", "menu.soldout", "kitchen.busy", "kitchen.config", "floor.session", "floor.call", "floor.qr", "driver.course", "driver.ask", "shift.update"];
export interface Screen<T> { reload(quiet?: boolean): Promise<void>; data(): T | null; redraw(): void }
export function screen<T>(boss: Boss, o: { load: () => Promise<T>; draw: (d: T) => string; after?: (d: T) => void; err: string; every?: number }): Screen<T> {
  let d: T | null = null, seq = 0, t: ReturnType<typeof setTimeout> | undefined, lastBlock = "";
  const body = boss.body;
  /* the block of the last touch: when its button is gone after the redraw, the focus goes to the block's first action */
  body.addEventListener("click", (e) => { const b = (e.target as Element).closest("button, a"); const blk = b && b.closest<HTMLElement>(".mg-blk[id]"); if (blk) lastBlock = blk.id; }, true);
  const sheetOpen = () => !!document.querySelector(".bs-sheetwrap:not(.closing), .bs-find");
  function redraw() {
    if (!d) return;
    const ae = document.activeElement as HTMLElement | null, inBody = !!ae && body.contains(ae), y = window.scrollY;
    const keep = ae && ae.closest && ae.closest<HTMLElement>("[data-keep]"), kk = keep ? keep.dataset.keep : "";
    body.innerHTML = o.draw(d); tick(body);
    if (o.after) o.after(d);
    window.scrollTo(0, y);
    if (kk) { const nf = body.querySelector<HTMLElement>('[data-keep="' + kk + '"]'); if (nf) nf.focus({ preventScroll: true }); }
    else if ((inBody || document.activeElement === document.body) && lastBlock && !sheetOpen()) {
      const blk = document.getElementById(lastBlock);
      if (blk && !blk.contains(document.activeElement)) {
        const f = blk.querySelector<HTMLElement>(".mg-prob button, .mg-wrow button, .mg-orow button, .mg-rrow button, .mg-person button") || blk.querySelector<HTMLElement>("h2");
        if (f) { if (f.tagName === "H2") f.setAttribute("tabindex", "-1"); f.focus({ preventScroll: true }); }
      }
    }
  }
  async function reload(quiet = true) {
    const my = ++seq;
    try {
      const r = await o.load();
      if (my !== seq) return;
      d = r; boss.loaded(); redraw();
    } catch (e) {
      if (my !== seq) return;
      if (isOff(e)) { if (!d) body.innerHTML = boss.error("Няма връзка със сървъра. Щом се върне, зареждаме сами.", "Няма връзка"); return; }
      if (e instanceof ApiError && e.status === 403) { body.innerHTML = boss.noRights(boss.tab === "team" ? "staff" : boss.tab === "hall" ? "hall" : "orders"); return; }
      if (!d || !quiet) body.innerHTML = boss.error(o.err);
    }
  }
  const soon = () => { clearTimeout(t); t = setTimeout(() => { void reload(); }, 250); };
  boss.onLive(soon, LIVE);
  boss.onRetry(() => { void flush(boss).then(() => reload(false)); });
  /* an action kept on the phone: its row says so at once */
  document.addEventListener("up:kept", () => redraw());
  /* the minutes of a late order and the tablets change with the time: a quiet look every 30 s (not while the search is typed in) */
  setInterval(() => { if (document.visibilityState === "visible" && !(document.activeElement && document.activeElement.id === "bs-q")) void reload(); }, o.every || 30_000);
  startTicks();
  void flush(boss).then(() => reload(false));
  return { reload, data: () => d, redraw };
}

/** the badge of "Сега" on the other tabs: the same number as on "Сега" (each thing once: problems + "Чака те") */
export function nowBadge(boss: Boss): void {
  /* no badge until the module's own number is known (never the dashboard's number first) */
  boss.badge("now", 0);
  let t: ReturnType<typeof setTimeout> | undefined;
  const load = () => { bossApi.now().then((n: MgrNow) => boss.badge("now", n.counts.now), () => { /* the frame's own number stays */ }); };
  boss.onLive(() => { clearTimeout(t); t = setTimeout(load, 400); }, LIVE);
  setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
  load();
}

/** the hash of the page as a map ("#t=12&z=garden") */
export function hashMap(): Record<string, string> {
  const o: Record<string, string> = {};
  location.hash.slice(1).split("&").forEach((p) => { if (!p) return; const i = p.indexOf("="); try { o[decodeURIComponent(i < 0 ? p : p.slice(0, i))] = i < 0 ? "" : decodeURIComponent(p.slice(i + 1)); } catch { /* broken */ } });
  return o;
}
/** #go=<id>: the block or the card into view */
export function goTo(id: string): void { const el = document.getElementById(id); if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 60); }

/* ---------- the shared sheets ---------- */
export interface Waiter { username: string; name: string; tables: number }
/** the waiters on shift (the sheet of a table has them; "Екипът" as a second way) */
export async function waitersFor(n: number | null): Promise<{ list: Waiter[]; of: { username: string; name: string } | null }> {
  if (n != null) { try { const t = await bossApi.table(n); return { list: t.waiters, of: t.waiter }; } catch (e) { if (isOff(e)) throw e; } }
  const tm = await bossApi.team();
  return { list: tm.waiters.map((w) => ({ username: w.username, name: w.name, tables: w.tables.length })), of: null };
}
/** "Маса 3: кой отива?": the waiters on shift and "Отивам аз"; cb(username | "me", name) */
export async function pickWaiter(boss: Boss, title: string, n: number | null, cb: (who: string, name: string) => void): Promise<void> {
  let w: Awaited<ReturnType<typeof waitersFor>>;
  try { w = await waitersFor(n); } catch (e) { boss.toast(isOff(e) ? "Няма връзка. Опитай пак, щом се върне." : msgOf(e)); return; }
  const silent = w.of;
  const sh = boss.sheet({ title, html: (silent ? "<p>" + esc(silent.name) + " е на масата и не е отговорил. Избери кой да отиде.</p>" : w.list.length ? "" : "<p>Никой сервитьор не е на смяна.</p>") +
    '<div class="mg-pick" role="group" aria-label="Сервитьор">' + w.list.map((x) => '<button type="button" data-w="' + esc(x.username) + '">' + ic("user", 22) + esc(x.name) + "<small>" + (silent && silent.username === x.username ? "не е отговорил" : plural(x.tables, "маса", "маси")) + "</small></button>").join("") +
    '<button type="button" data-w="me">' + ic("briefcase", 22) + "Отивам аз<small>" + esc(boss.me.user.name) + "</small></button></div>" });
  sh.body.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-w]"); if (!b) return;
    sh.close();
    const x = w.list.find((y) => y.username === b.dataset.w);
    cb(b.dataset.w === "me" ? "me" : b.dataset.w!, x ? x.name : boss.me.user.name);
  });
}

/** "Обади се на клиента": the whole number (the core writes the call in the log), "Обади се" and "Готово, обадих се" */
export async function callSheet(boss: Boss, no: string, why: string, onDone: (() => void) | null): Promise<void> {
  let c: Awaited<ReturnType<typeof bossApi.callCustomer>>;
  try { c = await bossApi.callCustomer(no); } catch (e) { boss.toast(isOff(e) ? "Няма връзка: номерът се показва само с връзка (обаждането се записва в дневника)." : msgOf(e)); return; }
  const tel = String(c.phone || "").replace(/[^\d+]/g, "");
  const s = boss.sheet({ title: "Обади се на клиента", html: "<p><b>№" + NB + esc(c.no) + " · " + esc(c.channelName) + "</b><br>" + esc(why) + "</p>" +
    '<div class="mg-kv"><span>Клиент</span><b>' + esc(c.name || "") + '</b></div><div class="mg-kv"><span>Телефон</span><b class="tnum" data-tel-n>' + esc(prettyPhone(c.phone)) + "</b></div>" + (c.addr ? '<div class="mg-kv"><span>Адрес</span><b>' + esc(c.addr) + "</b></div>" : "") +
    '<p class="mg-note">' + ic("info", 16) + "<span>Обаждането се записва в дневника.</span></p>",
    foot: (onDone ? '<button class="pill pill-line pill-lg" type="button" data-ok>' + ic("check", 22) + "Готово, обадих се</button>" : "") + '<a class="pill pill-red pill-lg" href="tel:' + esc(tel) + '" data-tel>' + ic("phone", 22) + "Обади се</a>" });
  const ok = s.foot && s.foot.querySelector<HTMLButtonElement>("[data-ok]");
  if (ok && onDone) ok.onclick = () => { s.close(); onDone(); };
}

/** the sections of the kitchen and their tablets (also on "Екипът") */
export function sectionsHTML(k: MgrKitchen): string {
  return '<div class="mg-card mg-list mg-secs">' + k.sections.map((s) => '<div class="mg-sec' + (s.tablet.online ? "" : " offl") + '"><span class="si">' + ic(s.icon, 22) + '</span><div class="sn"><b>' + esc(s.n) + "</b>" +
    (s.tablet.online ? '<small><span class="mg-dot" aria-hidden="true"></span>Таблетът работи</small>' : s.tablet.today ? "" : '<small><span class="mg-dot idle" aria-hidden="true"></span>Таблетът още не е влизал\u00a0днес</small>') + "</div>" +
    '<div class="sc"><span><b>' + s.wait + "</b>" + (s.wait === 1 ? "чака" : "чакат") + "</span>" + (s.late ? '<span class="late">' + ic("warning", 14) + "<b>" + s.late + "</b>" + (s.late === 1 ? "закъснява" : "закъсняват") + "</span>" : "") + "</div>" +
    /* a tablet that has not signed in today is calm; the ember tag only for one that was online and dropped */
    (s.tablet.online ? "" : s.tablet.today ? '<span class="mg-offtag">' + ic("warning-circle", 18) + "Таблетът е без връзка от " + esc(s.tablet.lastHm) + "</span>" : "") + "</div>").join("") + "</div>";
}
