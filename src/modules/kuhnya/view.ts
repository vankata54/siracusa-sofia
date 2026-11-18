/* Кухня: the pure part of the screens (no DOM, no storage: it runs in Node for the unit tests). Port of the ticket of
   design/pages-kuhnya/_kitchen.js (K.ticket, K.lineHTML, K.timerHTML) over the views of the core (KTicket …):
   - the timers are computed from timestamps (`due` and the server's clock), the screen only ticks;
   - the same three states everywhere: чака / готви се / готово, each with an icon (the colour is never alone);
   - what the tablet shows at once, before the server answers (and while there is no connection): tick(), begin(), finish(). */
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";
import type { KTicket, KLineView, KLater, KState, KTimer, KKind, KSrc } from "../../client/api-types-kitchen.ts";

export const SRC_IC: Record<KKind, string> = { table: "fork-knife", delivery: "moped", pickup: "storefront" };
export const ST_IC: Record<KState, string> = { ready: "check", cook: "flame", wait: "hourglass" };
/** the class of a state in "Други секции" (the prototype's names) */
export const ST_CLS: Record<KState, string> = { ready: "done", cook: "cook", wait: "wait" };
export const ST_TEXT: Record<KState, string> = { wait: "чака", cook: "готви се", ready: "готово" };

const p2 = (n: number) => String(n).padStart(2, "0");
/** "04:01" (minutes may pass 59: "75:10") */
export const mmss = (sec: number): string => { const s = Math.abs(Math.trunc(sec)); return p2(Math.floor(s / 60)) + ":" + p2(s % 60); };
export interface Tm { timer: KTimer; left: number }
/** the state of a deadline at `now` (epoch ms); `soonMin` = the minutes of "наближава" (config().soon) */
export function timerAt(due: number, now: number, soonMin: number): Tm {
  const left = Math.floor((due - now) / 1000);
  return { timer: left < 0 ? "late" : left <= soonMin * 60 ? "soon" : "ok", left };
}
/** the word is always there: "остават" / "наближава" / "закъснява" (+ an icon) */
export function timerHTML(tm: Tm): string {
  const lbl = tm.timer === "late" ? ic("warning", 18) + "закъснява" : tm.timer === "soon" ? ic("hourglass", 18) + "наближава" : "остават";
  return "<small>" + lbl + "</small><b>" + (tm.timer === "late" ? "+" : "") + mmss(tm.left) + "</b>";
}
export const TIMER_WORD: Record<KTimer, string> = { ok: "остават", soon: "наближава", late: "закъснява" };

/** "2 × Кебапчета" as plain text */
export const lineText = (l: { q: number; name: string }): string => l.q + " × " + l.name;

function modsHTML(l: KLineView): string {
  let h = "";
  for (const t of l.no) h += '<span class="md no">' + ic("minus", 18) + "без " + esc(t) + "</span> ";
  /* a sold-out add-on is red with ✕, like the sold-out dish (review 1, small 5) */
  for (const a of l.add) h += a.out ? '<span class="md addout">' + ic("x", 18) + '<span class="vh">+ </span>' + esc(a.n) + " · изчерпано днес</span> "
    : '<span class="md add">' + ic("plus", 18) + '<span class="vh">+ </span>' + esc(a.n) + "</span> ";
  if (l.note) h += '<span class="md nt">' + ic("note", 18) + esc(l.note) + "</span> ";
  if (l.out) h += '<span class="md out">' + ic("x", 18) + "Изчерпано днес</span>";
  return h ? '<span class="mds">' + h + "</span>" : "";
}
/** a line of the section: one touch = ready (the whole row is the button). Its name is what is seen, in the same order
    (the spaces between the parts are for the name: the parts are grid items), then what a touch does. */
export function lineHTML(l: KLineView): string {
  const done = l.ks === "ready";
  return '<button class="ln' + (done ? " done" : "") + '" type="button" data-ln="' + l.i + '" aria-pressed="' + done + '">' +
    '<span class="q">' + l.q + '&thinsp;×</span> <span class="nm">' + esc(l.name) + (l.weight ? " <small>" + esc(l.weight) + "</small>" : "") + '</span> <span class="ck">' + ic("check", 24) + "</span>" + modsHTML(l) +
    '<span class="vh">' + (done ? ", готово" : ", натисни за готово") + "</span></button>";
}

/** the card of an order in the queue (K.ticket). `tm`: the timer at this moment (timerAt). */
export function ticketHTML(t: KTicket, tm: Tm, stateText: Record<KState, string> = ST_TEXT): string {
  const src = t.src, started = t.startedAt != null, allDone = t.lines.every((l) => l.ks === "ready");
  let meta = t.sched
    ? '<span class="tag sched">' + ic("calendar-check", 16) + (t.tomorrow ? "утре " : "за ") + esc(t.forHm) + "</span> <span>приета <b>" + esc(t.arrivedHm) + "</b></span>"
    : "<span>пристигна <b>" + esc(t.arrivedHm) + "</b></span> <span>срок <b>" + esc(t.dueHm) + "</b></span>";
  /* "шофьор 19:50" only when it says something more than the deadline (review 1, small 2) */
  if (t.driverHm && t.driverHm !== t.dueHm) meta += " <span>шофьор <b>" + esc(t.driverHm) + "</b></span>";
  if (t.isNew) meta = '<span class="tag new">' + ic("bell-ringing", 16) + "Нова" + (t.web ? " · от сайта" : "") + "</span> " + meta;
  if (started) meta += ' <span class="tag cook">' + ic("flame", 16) + "готви се от " + esc(t.startedHm) + "</span>";
  if (t.busyMin > 0) meta += ' <span class="tag busy">+' + t.busyMin + " мин</span>";
  let h = '<article class="tk ' + tm.timer + (t.isNew ? " isnew" : "") + '" data-no="' + esc(t.no) + '" aria-label="' + esc(src.text) + '">' +
    '<header class="tk-h"><div class="tk-k' + (t.kind === "pickup" ? " pick" : "") + '">' + ic(SRC_IC[t.kind] || "fork-knife", 20) + "<span>" + esc(src.k) + "</span></div>" +
    '<div class="tmr" data-tmr>' + timerHTML(tm) + '</div><div class="tk-t">' + esc(src.t) + '</div><div class="tk-m">' + meta + "</div></header>" +
    '<div class="tk-b">' + (t.note ? '<div class="tk-note">' + ic("warning-circle", 22) + "<span>" + esc(t.note) + "</span></div>" : "") +
    t.lines.map(lineHTML).join("");
  if (t.others.length) h += '<div class="tk-o"><h4>Други секции</h4>' + t.others.map((o) =>
    '<div><span class="num">' + o.q + "&thinsp;×</span> <span>" + esc(o.name) + (o.out ? ' <b class="oout">' + ic("x", 14) + "изчерпано</b>" : "") + '</span> <span class="os ' + ST_CLS[o.state] + '">' + ic(ST_IC[o.state], 15) + esc(o.short) + " · " + esc(stateText[o.state] || ST_TEXT[o.state]) + "</span></div>").join("") + "</div>";
  h += '</div><footer class="tk-f' + (started || allDone ? " one" : "") + '">' +
    (started || allDone ? "" : '<button class="kb ink" type="button" data-start>' + ic("flame", 22) + "Започни</button> ") +
    '<button class="kb ok hold" type="button" data-done><span class="lbl"><span>' + ic("check-circle", 24) + ' Готово</span> <small>задръж 1 сек.</small></span><span class="vh">: ' + esc(src.text) + "</span></button></footer></article>";
  return h;
}
/** the same card without the running timer: when this text is the same, the card on the screen is not touched */
export const ticketSig = (t: KTicket, stateText?: Record<KState, string>): string => ticketHTML(t, { timer: "ok", left: 0 }, stateText);

/** "Чакат 8 · Закъсняват 1 · Наближават 2" (the inside of .kcount) */
export function countsHTML(c: { n: number; late: number; soon: number }): string {
  return "<span>Чакат <b>" + c.n + "</b></span>" + (c.late ? '<span class="sep"></span><span class="late">' + ic("warning", 20) + " Закъсняват <b>" + c.late + "</b></span>" : "") +
    (c.soon ? '<span class="sep"></span><span>Наближават <b>' + c.soon + "</b></span>" : "");
}
export function countsAt(list: KTicket[], now: number, soonMin: number): { n: number; late: number; soon: number } {
  let late = 0, soon = 0;
  for (const t of list) { const s = timerAt(t.due, now, soonMin).timer; if (s === "late") late++; else if (s === "soon") soon++; }
  return { n: list.length, late, soon };
}

/** a row of "По-късно": for when, when it enters the queue */
export function laterRowHTML(o: KLater): string {
  return '<div class="lrow2">' + ic(SRC_IC[o.kind] || "storefront", 22) + "<span><b>" + esc(o.src.text) + "</b><small>" + o.lines.map((l) => esc(lineText(l))).join(", ") + "</small></span>" +
    '<span class="when">' + (o.tomorrow ? "утре " : "за ") + esc(o.forHm) + "<small>влиза " + (o.tomorrow ? "утре " : "в ") + esc(o.enterHm) + "</small></span></div>";
}

/* ---------- what the tablet shows at once (and keeps while there is no connection) ---------- */
const copy = (t: KTicket): KTicket => ({ ...t, lines: t.lines.map((l) => ({ ...l })) });
/** is there still a line of this view to cook */
export const active = (t: KTicket): boolean => t.lines.some((l) => l.ks !== "ready");
/** a line ready / not ready after all; the ticket is no longer "Нова" */
export function tick(t: KTicket, i: number, ready: boolean): KTicket {
  const n = copy(t);
  for (const l of n.lines) if (l.i === i) l.ks = ready ? "ready" : n.startedAt != null ? "cook" : "wait";
  n.isNew = false;
  return n;
}
/** "Започни": the waiting lines are being cooked, "готви се от" now */
export function begin(t: KTicket, now: number, hm: string): KTicket {
  const n = copy(t);
  for (const l of n.lines) if (l.ks === "wait") l.ks = "cook";
  if (n.startedAt == null) { n.startedAt = now; n.startedHm = hm; }
  n.isNew = false;
  return n;
}
/** "Готово": every line of the view is ready; returns the lines it changed (for an exact "Върни") */
export function finish(t: KTicket): { t: KTicket; changed: number[] } {
  const n = copy(t), changed: number[] = [];
  for (const l of n.lines) if (l.ks !== "ready") { l.ks = "ready"; changed.push(l.i); }
  n.isNew = false;
  return { t: n, changed };
}
/** the order as the queue keeps it (FIFO by the moment of entering, then by number) */
export const fifo = (a: KTicket, b: KTicket): number => a.key - b.key || +a.no - +b.no;
/** "сервитьора" / "шофьора" / "клиента" */
export const whoOf = (s: KSrc): string => s.who;
