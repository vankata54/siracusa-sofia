/* Event page (/sabitia/<slug>/): HTML pieces shared by the server ([slug]/index.astro frontmatter) and the browser (its script).
   Port of design/pages/event.html (design/PAGES.md "event.html", hand-off 6.8). Pure string renderers: no DOM, no menu.
   The date of a recurring evening ("всяка последна събота") is NOT known at build time: the server draws an honest
   "Последна събота от месеца" ticket without a date, the browser computes the date from today and redraws the ticket,
   the next evening, the title and the action bar. The Event JSON-LD is in ../_ld.ts (the same for /sabitia/). */
import { RESTAURANT as R } from "../../../lib/consts.ts";
import { ic } from "../../../lib/icons.ts";
import { esc, fmt, plural, MON, MONTHS, DAYS_SHORT, dateLong } from "../../../lib/format.ts";
import { callBtn, stateBox, loadingText, previewPanel, PV, missText } from "../../../lib/ui.ts";
import { url } from "../../../lib/routes.ts";
import type { SiteEvent } from "../../../lib/events.ts";
import { sofiaOffset } from "../_ld.ts";
import "sc-icons:arrow-clockwise,arrow-right,arrow-up-right,calendar-blank,calendar-check,calendar-dots,chat-circle-dots,clock,copy,eye,facebook-logo,globe,info,list-checks,map-pin,phone,sliders-horizontal,ticket,users-three,warning-circle"; /* the icons of this module in one group (scripts/icon-groups.mjs) */

export const TEL = "tel:" + R.phoneIntl;

/* ---------- dates ---------- */
export const mid = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const pad = (n: number): string => (n < 10 ? "0" : "") + n;
export const ymd = (d: Date): string => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export function toMin(t: string): number { const a = String(t || "19:00").split(":"); return (+a[0]) * 60 + (+a[1] || 0); }
function lastSat(y: number, m: number): Date { const d = new Date(y, m + 1, 0); while (d.getDay() !== 6) d.setDate(d.getDate() - 1); return d; }
export function nextLastSat(d: Date): Date { let m = d.getMonth() + 1, y = d.getFullYear(); if (m > 11) { m = 0; y++; } return lastSat(y, m); }
/* ---------- model: the event + everything that depends on the day and the clock ---------- */
export type Phase = "soon" | "tomorrow" | "today" | "live" | "over";
export interface EvModel extends SiteEvent { start: number; days: number; minsLeft: number; phase: Phase; offline: boolean; full: boolean; iso: string; next: Date; lockH: number }
/** demo: "" | dnes | sega | prikljuchi | mesta | pulno | bez-internet (preview only) */
export function model(ev: SiteEvent, today: Date, m: number, online: boolean, demo = ""): EvModel {
  let t = mid(today), mm = m, seats = ev.seatsLeft;
  if (demo === "dnes") { t = mid(ev.date); mm = 16 * 60 + 30; }
  if (demo === "sega") { t = mid(ev.date); mm = 20 * 60 + 15; }
  if (demo === "prikljuchi") { t = mid(ev.date); mm = 23 * 60 + 20; }
  if (demo === "mesta") seats = 6;
  if (demo === "pulno") seats = 0;
  const start = toMin(ev.time), days = Math.round((mid(ev.date).getTime() - t.getTime()) / 864e5);
  const phase: Phase = days > 1 ? "soon" : days === 1 ? "tomorrow" : mm < start ? "today" : mm < toMin(R.close) ? "live" : "over";
  return {
    ...ev, seatsLeft: seats, start, days, minsLeft: start - mm, phase,
    offline: demo === "bez-internet" || !online, full: seats === 0, iso: ymd(ev.date), next: nextLastSat(ev.date),
    lockH: start >= 17 * 60 ? 2 : 1, /* change / cancel: 2 h before in the evening, 1 h during the day (hand-off 6.7) */
  };
}

/* ---------- the one main action, by situation ---------- */
export interface Cta { t: string; bar: string; href: string; ic: string; barIc: string }
export function cta(e: EvModel | null): Cta {
  if (!e) return { t: "Запази място", bar: "Запази място", href: url.reservation(), ic: "arrow-right", barIc: "calendar-check" };
  const res = url.reservation(e.iso);
  if (e.phase === "over") return { t: "Виж следващите събития", bar: "Виж следващите събития", href: url.events(), ic: "arrow-right", barIc: "calendar-dots" };
  if (e.offline || e.phase === "live") return { t: "Обади се · " + R.phone, bar: "Обади се · " + R.phone, href: TEL, ic: "phone", barIc: "phone" };
  if (e.full) return { t: "Запиши ме в чакащите", bar: "Запиши ме в списъка на чакащите", href: res, ic: "list-checks", barIc: "list-checks" };
  if (e.phase === "today") return { t: "Запази място за днес", bar: "Запази място за днес · " + e.time, href: res, ic: "arrow-right", barIc: "calendar-check" };
  return { t: "Запази място", bar: "Запази място · " + dateLong(e.date), href: res, ic: "arrow-right", barIc: "calendar-check" };
}
export const barHTML = (c: Cta): string => '<a class="pill pill-red" href="' + c.href + '">' + ic(c.barIc, 20) + esc(c.bar) + "</a>";

/* ---------- pieces ---------- */
/** Greek key band, drawn in currentColor; h = height of the band, one row centred in it. */
export function meander(id: string, h: number): string {
  const H = h, off = (H - 30) / 2;
  return '<svg aria-hidden="true" focusable="false" width="100%" height="' + h + '"><defs><pattern id="' + id + '" width="20" height="' + H + '" patternUnits="userSpaceOnUse">' +
    '<path transform="translate(0 ' + off + ')" d="M0 2.5H20M0 25.5H20M4 25.5V7H17.5V19.5H9V12.5H13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></pattern></defs>' +
    '<rect width="100%" height="100%" fill="url(#' + id + ')"/></svg>';
}
/** Calendar leaf. Without a date (server): "Последна / сб / на месеца". */
export function cal(d: Date | null, small?: boolean): string {
  if (!d) return '<span class="cal nodate" aria-hidden="true"><span class="m">Последна</span><span class="d">сб</span><span class="w">от месеца</span></span>';
  return '<span class="cal" aria-hidden="true"><span class="m">' + MON[d.getMonth()] + '</span><span class="d">' + d.getDate() + '</span><span class="w">' + DAYS_SHORT[d.getDay()] + "</span></span>";
}
export function whenHTML(ev: SiteEvent, e: EvModel | null): string {
  let k: string, v: string, s: string, extra = "";
  if (!e) { k = "Всяка последна събота от месеца"; v = ev.time; s = "Начало в " + ev.time + ", работим до " + R.close; }
  else if (e.phase === "soon") { k = "До вечерта остават"; v = plural(e.days, "ден", "дни"); s = "Начало в " + e.time; }
  else if (e.phase === "tomorrow") { k = "Вечерта е"; v = "Утре"; s = "Начало в " + e.time; }
  else if (e.phase === "today") {
    const h = Math.floor(e.minsLeft / 60), mm = e.minsLeft % 60;
    k = "Започва след " + (h ? h + "&nbsp;ч" : "") + (h && mm ? " " : "") + (mm ? mm + "&nbsp;мин" : ""); v = "Днес"; s = "Начало в " + e.time;
  } else if (e.phase === "live") { k = "В момента"; v = '<span class="live" aria-hidden="true"></span>Тече'; s = "Работим до " + R.close; }
  else { k = "Тази вечер"; v = "Приключи"; s = "Следващата: " + dateLong(e.next).replace(/ (\S+)$/, "&nbsp;$1"); }
  if (e && e.seatsLeft != null && e.phase !== "over") extra = '<span class="seats">' + ic("users-three", 18) + (e.seatsLeft > 0 ? "Остават " + plural(e.seatsLeft, "място", "места") : "Местата свършиха") + "</span>";
  return '<div class="when" role="group" aria-label="Кога"><span class="k">' + k + '</span><span class="v">' + v + '</span><span class="s">' + s + "</span>" + extra + "</div>";
}
export function priceHTML(ev: SiteEvent): string {
  if (ev.free) return "Вход свободен";
  if (ev.price) return '<span class="price">' + fmt(ev.price) + "</span>";
  return '<span class="missing">' + missText("price") + "</span>";
}

/** The ticket. e = null on the server (no date yet). */
export function ticketHTML(ev: SiteEvent, e: EvModel | null): string {
  const c = cta(e);
  const note = !e ? "" : e.offline ? '<div class="ev-note" role="status">' + ic("warning-circle", 20) + "<span>Няма връзка с интернет. Обадете ни се на <b>" + R.phone + "</b> и ще ви запазим място.</span></div>"
    : e.phase === "live" ? '<div class="ev-note">' + ic("info", 20) + "<span>Вечерта тече. Обадете се и ще ви кажем дали има свободна маса.</span></div>"
    : e.full ? '<div class="ev-note">' + ic("info", 20) + "<span>Всички места са заети. Запишете се и ще ви се обадим, ако се освободи маса.</span></div>" : "";
  const cal2 = e && (e.phase === "over" || e.phase === "live" || e.offline) ? "" : '<button class="pill pill-line pill-block" type="button" data-cal>' + ic("calendar-check", 20) + "Добави в календара</button>";
  return '<div class="shell ticket"><div class="core">' +
    '<span class="tk-band">' + meander("mk-band", 34) + "</span>" +
    '<div class="tk-main">' + cal(e ? e.date : null) + whenHTML(ev, e) + "</div>" +
    '<div class="tk-perf" aria-hidden="true"><i></i><i></i></div>' +
    '<div class="tk-stub">' +
    '<a class="pill pill-red go" href="' + c.href + '" data-hero-cta>' + c.t + '<span class="knob">' + ic(c.ic, 22) + "</span></a>" + note + cal2 +
    "</div></div></div>";
}

export function factsHTML(ev: SiteEvent, e: EvModel | null): string {
  const rows: [string, string, string][] = [
    ["clock", "Начало", ev.time + ' <span class="muted">· работим до ' + R.close + "</span>"],
    ["ticket", "Вход", priceHTML(ev)]];
  const seats = e ? e.seatsLeft : ev.seatsLeft;
  if (seats != null) rows.push(["users-three", "Свободни места", seats > 0 ? plural(seats, "място", "места") : "Няма, само списък на чакащите"]);
  rows.push(["map-pin", "Място", R.name + '<br><span class="muted">' + R.address + '</span><br><a class="link" href="' + R.maps + '" target="_blank" rel="noopener">Маршрут в Google Maps' + ic("arrow-up-right", 18) + "</a>"]);
  /* dl > div > dt + dd (the icon is inside dt, hidden from screen readers): "Начало: 19:00" is read as a pair */
  return '<h2 class="vh">Подробности</h2><div class="shell"><div class="core"><dl class="facts">' + rows.map((r) =>
    '<div class="fact"><dt><span class="fi">' + ic(r[0], 22) + "</span>" + r[1] + "</dt><dd>" + r[2] + "</dd></div>").join("") + "</dl></div></div>";
}

export function rulesHTML(ev: SiteEvent): string {
  const lockH = toMin(ev.time) >= 17 * 60 ? 2 : 1;
  const rows = [
    ["check-circle", "ok", "Без депозит", "Запазването на място е безплатно. Потвърждаваме по SMS или Viber."],
    ["bell", "", "Напомняме ви", "Ден преди вечерта и 3 часа преди часа на резервацията."],
    ["pencil-simple", "", "Промяна или отказ", "До " + lockH + " часа преди часа на резервацията, от връзката в SMS-а. След това се обадете."]];
  return '<section class="sec rv"><div class="sec-h"><h2 class="h2">Добре е да знаете</h2></div><div class="shell"><div class="core rules">' +
    rows.map((r) => '<div class="rule"><span class="ri ' + r[1] + '">' + ic(r[0], 22) + "</span><div><h3>" + r[2] + "</h3><p>" + r[3] + "</p></div></div>").join("") +
    '</div></div><div class="ev-call"><span>Или по телефона</span>' + callBtn("pill pill-ink") + "</div></section>";
}

/** "Следващата тематична вечер" inner: e = null on the server. */
export function nextInner(e: EvModel | null): string {
  const n = e ? e.next : null;
  return cal(n, true) + "<div><b>" + (n ? dateLong(n) : "Последната събота на следващия месец") + '</b><span class="missing">[ЛИПСВА: коя кухня]</span></div>' +
    '<a class="pill pill-line nx-go" href="' + url.events() + '">' + ic("calendar-dots", 20) + "Всички събития</a>";
}

/* ---------- page states (preview: loading / error) ---------- */
export function errorHTML(): string {
  return '<section class="sec ev-state">' + stateBox({ kind: "error", what: "събитието", h: "h1" }) + "</section>";
}
export function loadingHTML(): string {
  return '<section class="sec ev-hero" aria-busy="true"><span class="vh" role="status">' + loadingText("събитието") + "</span>" +
    '<div class="ev-head"><div class="skel" style="width:150px;height:36px;border-radius:18px;margin-bottom:18px"></div><div class="skel" style="width:78%;height:46px;border-radius:14px"></div><div class="skel sk-line" style="width:92%;margin-top:16px"></div><div class="skel sk-line" style="width:64%;margin-top:10px"></div></div>' +
    '<div class="ev-ticket"><div class="shell"><div class="core"><div class="skel" style="height:30px;border-radius:0"></div><div class="tk-main"><div class="skel" style="width:104px;height:122px;border-radius:20px"></div><div><div class="skel sk-line" style="width:70%"></div><div class="skel" style="width:80%;height:40px;margin-top:10px;border-radius:12px"></div><div class="skel sk-line" style="width:60%;margin-top:10px"></div></div></div><div class="tk-stub" style="padding-top:16px"><div class="skel" style="height:60px;border-radius:30px"></div><div class="skel" style="height:48px;border-radius:24px"></div></div></div></div></div>' +
    '<div class="ev-facts"><div class="shell"><div class="core" style="padding:18px"><div class="skel sk-line" style="width:55%"></div><div class="skel sk-line" style="width:75%;margin-top:22px"></div><div class="skel sk-line" style="width:65%;margin-top:22px"></div></div></div></div></section>';
}

/** "Само в прегледа" (preview / demo only), last block of the page: the same panel and words as on every page. */
export const DEMO_STATES: [string, string][] = [["", PV.normal], ["dnes", "Днес, преди началото"], ["sega", "Тече в момента"], ["prikljuchi", "Приключи"], ["mesta", "Остават 6 места"], ["pulno", "Няма свободни места"], ["bez-internet", PV.offline], ["zarezhdane", PV.loading], ["greshka", PV.error]];
export function protoHTML(cur: string, invalidHref: string): string {
  const list: [string, string, boolean][] = DEMO_STATES.map((d) => ["#" + d[0], d[1], cur === d[0]] as [string, string, boolean]);
  list.push([invalidHref, "Невалидно събитие", false]);
  return previewPanel(list.map((l) => '<a class="chip" href="' + l[0] + '"' + (l[2] ? ' aria-current="true"' : "") + ">" + esc(l[1]) + "</a>").join(""), { id: "ev1-pv" }).replace("<section ", "<section data-proto ");
}

/* ---------- calendar file (.ics) and Google Calendar link ---------- */
export function stamp(d: Date, mins: number): string { return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "T" + pad(Math.floor(mins / 60)) + pad(mins % 60) + "00"; }
export function utcStamp(d: Date, mins: number): string {
  const off = parseInt(sofiaOffset(d), 10), x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0, mins - off * 60));
  return x.getUTCFullYear() + pad(x.getUTCMonth() + 1) + pad(x.getUTCDate()) + "T" + pad(x.getUTCHours()) + pad(x.getUTCMinutes()) + "00Z";
}
const icsEsc = (s: string): string => String(s).replace(/\\/g, "\\\\").replace(/([,;])/g, "\\$1").replace(/\n/g, "\\n");
export const calTitle = (e: SiteEvent): string => e.n + " в Siracusa";
export const calWhere = (): string => R.name + ", " + R.address;
export function googleCalUrl(e: EvModel): string {
  return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent(calTitle(e)) + "&dates=" + stamp(e.date, e.start) + "/" + stamp(e.date, toMin(R.close)) +
    "&ctz=Europe/Sofia&location=" + encodeURIComponent(calWhere()) + "&details=" + encodeURIComponent(e.text + "\nРезервации: " + R.phone);
}
export function icsText(e: EvModel, nowD: Date = new Date()): string {
  const end = toMin(R.close);
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Siracusa Bar & Grill//BG", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
    "UID:" + e.id + "-" + e.iso + "@siracusa-sofia.com", "DTSTAMP:" + nowD.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z",
    "DTSTART:" + utcStamp(e.date, e.start), "DTEND:" + utcStamp(e.date, end),
    "SUMMARY:" + icsEsc(calTitle(e)), "LOCATION:" + icsEsc(calWhere()), "DESCRIPTION:" + icsEsc(e.text + "\nРезервации: " + R.phone),
    "BEGIN:VALARM", "TRIGGER:-PT3H", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(calTitle(e)), "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
