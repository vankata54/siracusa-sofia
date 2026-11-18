/* Siracusa · the waiter's screens (stage D): what "Залата", "Повиквания" and "Готови" share (and the other waiter screens
   may import read-only): the words and icons of the table states and the calls, the live hall (floorApi.hall() + the
   real-time events, ONE queue number for the counter, the badge and "За мен"), the sheet "Смяна", painting a screen
   without throwing away the focus, and the search provider (find.ts, loaded on the first open).
   The rules are in the core (src/core/floor*.ts); the minutes come from hall.settings, never from here. */
import "sc-icons:receipt,qr-code,chef-hat,hourglass,users,chair,fork-knife,drop,chat-circle-dots,bell-ringing,check,check-circle,warning,user,caret-right,caret-down,sign-out";
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";
import { floorApi, ApiError, type HallLive, type HallTile, type HallCall, type HallQr, type CallKind, type TableStateKey } from "../../client/api-floor.ts";
import { murl } from "../routes.ts";
import type { Staff, ShiftInfo, SearchProvider } from "../staff/frame.ts";

export type { HallLive, HallTile, HallCall, HallQr, CallKind, TableStateKey };
export { esc, ic, murl };

/* ---------- words (the prototype's) ---------- */
export const ZONE: Record<"salon" | "garden", string> = { salon: "Салон", garden: "Градина" };
/** the reason of a call: the short word and its icon */
export const REASON: Record<CallKind, [string, string]> = { order: ["Поръчка", "fork-knife"], bill: ["Сметка", "receipt"], water: ["Вода / прибори", "drop"], other: ["Друго", "chat-circle-dots"] };
/** the word on a tile and in the search (a call says its reason instead) */
export const SHORT: Record<TableStateKey, string> = { call: "Вика", bill: "Сметка", qr: "QR поръчка", ready: "Готово", wait: "Чака поръчка", busy: "Заета", free: "Свободна" };
export const STATE_ICON: Record<TableStateKey, string> = { call: "bell-ringing", bill: "receipt", qr: "qr-code", ready: "chef-hat", wait: "hourglass", busy: "users", free: "chair" };
/** the legend: the long words */
export const LEGEND: [TableStateKey, string][] = [["call", "Вика (с причината)"], ["bill", "Чака сметка"], ["qr", "QR поръчка"], ["ready", "Готово за сервиране"], ["wait", "Чака поръчка"], ["busy", "Заета"], ["free", "Свободна"]];

export const tableUrl = (n: number | string) => murl.servitor("masa", String(n));
export const plural = (n: number, one: string, many: string) => n + " " + (n === 1 ? one : many);
export const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Date.now());
const DAY = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
/** "YYYY-MM-DD" of Sofia (offset in days from today) */
export function sofiaDay(offset = 0): string {
  const d = new Date(Date.now() + offset * 864e5);
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}
/** the minutes of the day in Sofia */
export function sofiaMin(): number {
  try { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":"); return (+p[0] % 24) * 60 + +p[1]; }
  catch { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
}
/** "ср, 18 ноември" */
export function dayText(ymd: string): string { const p = ymd.split("-").map(Number), d = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); return DAY[d.getUTCDay()] + ", " + p[2] + " " + MONTHS[p[1] - 1]; }
export const hm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

/** the levels of a timer that waits: warn after warnMin, late after the manager's minutes (data-lvl of the frame) */
export const lvl = (h: HallLive, lateMin?: number) => ' data-lvl="' + h.settings.warnMin * 60 + "," + (lateMin || h.settings.callManager) * 60 + '"';
/** whose table it is, in words */
export function whose(h: HallLive, n: number): string {
  const t = h.tables.find((x) => x.n === n);
  if (!t) return "";
  if (t.mine) return "моя маса";
  return t.owner ? "на " + t.owner.name : "без сервитьор";
}
export const isMine = (h: HallLive, n: number) => !!h.tables.find((x) => x.n === n && x.mine);

/* ---------- the queue: calls nobody took or I took + QR orders for me (the core's forMe); ONE number: counters.queue ---------- */
export type QItem = { kind: "call"; c: HallCall; n: number; since: number } | { kind: "qr"; q: HallQr; n: number; since: number };
export function queue(h: HallLive, all = false): QItem[] {
  return [...h.calls.filter((c) => all || c.forMe).map((c): QItem => ({ kind: "call", c, n: c.table.n, since: ms(c.at) })),
    ...h.qr.filter((q) => all || q.forMe).map((q): QItem => ({ kind: "qr", q, n: q.table.n, since: ms(q.at) }))];
}
/** is it with the manager now (counted on the phone, so it moves up without a new load) */
export function isLate(st: Staff, h: HallLive, it: QItem): boolean {
  if (it.kind === "call") return !it.c.taken && st.secs(it.since) >= h.settings.callManager * 60;
  return st.secs(it.since) >= h.settings.qrManager * 60;
}
/** "Чакат сега": the late ones first, then my tables, then by time */
export function sortNow(st: Staff, h: HallLive, list: QItem[]): QItem[] {
  return list.slice().sort((a, b) => Number(isLate(st, h, b)) - Number(isLate(st, h, a)) || Number(isMine(h, b.n)) - Number(isMine(h, a.n)) || a.since - b.since);
}

/* ---------- painting without losing the focus ---------- */
/** Paints the screen in st.main, keeping the focus on the same control (data-fk) and the timers ticking. Never paints over
    something that is not the screen's (the frame's own states are the skeleton and the error, which the screen replaces). */
export function paint(st: Staff, html: string): boolean {
  const m = st.main, first = m.firstElementChild;
  if (first && !first.matches("[data-sv], .st-skel, .st-empty.err")) return false;
  const a = document.activeElement as HTMLElement | null, fk = a && m.contains(a) ? a.dataset.fk : undefined;
  m.innerHTML = '<div data-sv>' + html + "</div>";
  if (fk) { const b = m.querySelector<HTMLElement>('[data-fk="' + CSS.escape(fk) + '"]'); if (b) b.focus({ preventScroll: true }); }
  st.tick();
  return true;
}

/* ---------- the live hall ---------- */
export const LIVE = ["floor.session", "floor.call", "floor.qr", "order.new", "order.line", "order.status", "shift.update"];
export interface HallStore { get(): HallLive | null; load(): Promise<HallLive | null>; set(h: HallLive): void; on(fn: (h: HallLive) => void): void }
/** floorApi.hall() now and after every event (several events in a row = one load); the badges of the bottom nav; a phone
    vibration for a new call for me (2 long) and a new ready dish (3 short); "Управителят ти даде Маса 7". */
export function hallStore(st: Staff): HallStore {
  let h: HallLive | null = null, t: ReturnType<typeof setTimeout> | undefined, running: Promise<HallLive | null> | null = null, again = false;
  const subs: ((h: HallLive) => void)[] = [];
  function set(x: HallLive) {
    const old = h; h = x;
    st.serverNow(Date.parse(x.now)); st.synced(); st.setLevels(x.settings.warnMin * 60, x.settings.callManager * 60);
    st.setBadge("calls", x.counters.queue); st.setBadge("ready", x.counters.ready);
    if (old) {
      const was = new Set(old.calls.filter((c) => c.forMe).map((c) => c.id));
      /* the manager's "Възложи на…": a call or a QR order is now mine, with the call's vibration and a notice */
      const gotC = x.calls.filter((c) => c.taken && c.taken.mine && c.taken.assigned && !old.calls.some((o) => o.id === c.id && o.taken && o.taken.mine)).map((c) => "Маса " + c.table.n);
      const gotQ = x.qr.filter((q) => q.to && q.forMe && !old.qr.some((o) => o.session === q.session && o.to && o.forMe)).map((q) => "QR поръчката на Маса " + q.table.n);
      if (gotC.length || gotQ.length) { st.haptic([400, 150, 400]); st.toast("Управителят ти възложи " + [...gotC, ...gotQ].join(" и ") + "."); }
      else if (x.calls.some((c) => c.forMe && !c.taken && !was.has(c.id))) st.haptic([400, 150, 400]);
      else if (x.counters.ready > old.counters.ready) st.haptic([90, 70, 90, 70, 90]);
    }
    if (old && old.me.onShift && x.me.onShift) {
      const add = x.me.tables.filter((n) => !old.me.tables.includes(n)), gone = old.me.tables.filter((n) => !x.me.tables.includes(n));
      const say = (l: number[]) => (l.length === 1 ? "Маса " + l[0] : "Маси " + l.slice(0, -1).join(", ") + " и " + l[l.length - 1]);
      if (add.length || gone.length) st.toast((add.length ? "Управителят ти даде " + say(add) : "") + (add.length && gone.length ? ". " : "") + (gone.length ? (add.length ? "Взе " : "Управителят взе ") + say(gone) : "") + ".");
    }
    subs.forEach((f) => f(x));
  }
  async function load(): Promise<HallLive | null> {
    if (running) { again = true; return running; }
    running = (async () => {
      try { const x = await floorApi.hall(); set(x); return x; }
      catch (e) { if (!h || (e instanceof ApiError && (e.code === "offline" || e.status === 401))) st.fail(e); return h; }
      finally { running = null; if (again) { again = false; schedule(); } }
    })();
    return running;
  }
  function schedule() { clearTimeout(t); t = setTimeout(load, 120); }
  st.onLive(LIVE, schedule);
  st.onReload(() => { load(); });
  /* a session closed on another phone ("Предай масите и излез") or a change missed by the stream: a quiet look every minute */
  setInterval(() => { if (!document.hidden && !st.offline && h) load(); }, 60_000);
  return { get: () => h, load, set, on: (fn) => { subs.push(fn); } };
}
/** an action of the core failed: what to say */
export function why(e: unknown): string {
  if (e instanceof ApiError) return e.code === "offline" ? "Няма връзка. Опитай пак, щом се върне." : e.message || "Не стана. Опитай пак.";
  return "Не стана. Опитай пак.";
}

/* ---------- the sheet "Смяна" (the frame's shift hook) ---------- */
export function shiftInfo(st: Staff, store: HallStore): () => Promise<ShiftInfo> {
  return async () => {
    const h = store.get() || (await store.load());
    const extra = '<p class="st-cap gap">Известия</p><div class="kvs"><div class="kv"><span>Вибрация за повикване</span><b>2 дълги</b></div><div class="kv"><span>Вибрация за готово ястие</span><b>3 кратки</b></div>' +
      '<div class="kv"><span>Смарт часовник</span><a class="link" href="' + esc(murl.servitor("chasovnik")) + '">Виж екрана' + ic("caret-right", 18) + "</a></div></div>";
    /* the main admin, the owner or the manager looking at the app: no shift of their own to start */
    if ((!h || !h.me.onShift) && st.boss) return { extra };
    if (!h || !h.me.onShift) {
      return { rows: [{ label: "На смяна", value: "Не" }], extra,
        foot: '<a class="pill pill-red pill-lg pill-block" href="' + esc(murl.servitor("vhod", "shift")) + '">Започни смяната</a>' };
    }
    return {
      rows: [{ label: "На смяна от", value: st.clock(ms(h.me.since)), tnum: true }, { label: "Моите маси", value: h.me.tables.join(", ") || "Няма", note: "Избрах ги при вход. Управителят може да ги промени." }],
      extra,
      foot: '<a class="pill pill-line pill-lg pill-block" href="' + esc(murl.servitor("vhod", "end")) + '">' + ic("sign-out", 22) + "Приключи смяната</a>",
    };
  };
}
/** the top bar: "Сервитьор 1 · от 15:17" while on shift */
export function subOf(st: Staff, h: HallLive): string { return h.me.name + (h.me.onShift && h.me.since ? " · от " + st.clock(ms(h.me.since)) : ""); }

/** the search of the waiter (find.ts, loaded with the menu on the first open) */
export function searchOf(store: HallStore): () => Promise<SearchProvider> {
  return () => import("./find.ts").then((m) => m.provider(store.get));
}

/* ---------- the focus after an action that takes its own button away ---------- */
/** the focus fell to the page (its control was drawn again or removed): put it on the first of these that exists in main
    (a control, or a heading made focusable); nothing changes while the focus is on something real */
export function refocus(st: Staff, sels: string[]): void {
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && a.isConnected && !(a.closest(".st-toast") && !a.closest(".st-toast.on"))) return;
  for (const s of sels) {
    const el = s ? st.main.querySelector<HTMLElement>(s) : null;
    if (!el) continue;
    if (!el.matches("a[href], button, input, select, textarea, [tabindex]")) el.tabIndex = -1;
    el.focus({ preventScroll: true }); el.scrollIntoView({ block: "nearest" });
    return;
  }
}
/** the control after (else before) this one among the actions of the screen: where the focus goes when it disappears */
export function neighbour(st: Staff, fk: string, sel = "[data-take], [data-done], [data-serve]"): string {
  const list = Array.from(st.main.querySelectorAll<HTMLElement>(sel)), i = list.findIndex((el) => el.dataset.fk === fk);
  const n = i < 0 ? null : list[i + 1] || list[i - 1] || null;
  return n && n.dataset.fk ? '[data-fk="' + CSS.escape(n.dataset.fk) + '"]' : "";
}

/* ---------- "Отивам" / "Обслужено" (+ "Отмени" 5 s): the same in "Залата" and "Повиквания" ---------- */
export function callActions(st: Staff, store: HallStore) {
  const busy = new Set<string>();
  const find = (id: string) => { const h = store.get(); return h ? h.calls.find((x) => x.id === id) || null : null; };
  const fk = (p: string, id: string) => '[data-fk="' + CSS.escape(p + id) + '"]';
  return {
    /** the focus moves from "Отивам" to "Обслужено" of the same call */
    async take(id: string) {
      const c = find(id); if (!c || busy.has(id)) return;
      busy.add(id);
      try { store.set(await floorApi.callTake(id)); refocus(st, [fk("d", id), "h2"]); st.haptic(); st.toast("Маса " + c.table.n + ": отивам. Колегите виждат, че масата е поета."); }
      catch (e) { st.toast(why(e)); store.load(); }
      finally { busy.delete(id); }
    },
    /** the call goes away: the focus goes to the next call's button (else the previous one, else the heading) */
    async done(id: string) {
      const c = find(id); if (!c || busy.has(id)) return;
      busy.add(id);
      const next = neighbour(st, "d" + id);
      try {
        store.set(await floorApi.callDone(id));
        refocus(st, [next, "h2"]);
        st.toast("Маса " + c.table.n + ": обслужено", { undo: async () => { try { store.set(await floorApi.callUndo(id)); refocus(st, [fk("d", id), fk("g", id), "h2"]); } catch (e) { st.toast(why(e)); store.load(); } } });
      } catch (e) { st.toast(why(e)); store.load(); }
      finally { busy.delete(id); }
    },
  };
}
