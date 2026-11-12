/* Contacts (/kontakti/): everything on the page that depends on the hour or the day, as HTML strings.
   Used by the server (neutral first paint, m = null) and by the browser (Sofia clock; ?preview=1&t=21:30 in preview / demo).
   No menu import: the browser script uses this file (keeps the page JS small). Hours come only from RESTAURANT. */
import { RESTAURANT as R } from "../../lib/consts.ts";
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";

const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
export const OPEN = toMin(R.open), CLOSE = toMin(R.close), KITCHEN = toMin(R.kitchen), DELIVERY = toMin(R.delivery), LUNCH = toMin(R.lunchUntil);
export const HOURS = R.open + " - " + R.close;

/** "+359894365577" from "0894 36 55 77" (RESTAURANT has phoneIntl only for the first number). */
export const intl = (ph: string) => "+359" + ph.replace(/\D/g, "").replace(/^0/, "");
export const TEL1 = R.phoneIntl, TEL2 = intl(R.phone2);

export const DAYS = ["Понеделник", "Вторник", "Сряда", "Четвъртък", "Петък", "Събота", "Неделя"];
/** Today in Sofia, Monday = 0 (the preview clock changes only the time, not the date). */
export function dayIdx(d: Date = new Date()): number {
  try {
    const w = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", weekday: "short" }).format(d);
    return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(w);
  } catch { return (d.getDay() + 6) % 7; }
}
export function dur(min: number): string {
  const h = Math.floor(min / 60), m = min % 60;
  return (h ? h + " ч" : "") + (h && m ? " " : "") + (m ? m + " мин" : "");
}
const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const closedAt = (m: number) => m < OPEN || m >= CLOSE;

/* ---------- hero: the main action follows the hour (after closing "Пишете ни" leads, "Обади се" is second) ---------- */
function callB(main: boolean): string {
  return '<a class="pill ' + (main ? "pill-red pill-lg pill-block" : "pill-line") + '" href="tel:' + TEL1 + '">' + ic("phone", main ? 22 : 20) +
    "<span>Обади се" + (main ? ' · <span class="num">' + R.phone + "</span>" : "") + "</span></a>";
}
function writeB(main: boolean): string {
  return '<a class="pill ' + (main ? "pill-red pill-lg pill-block" : "pill-line") + '" href="#pishete" data-jump="pishete">' + ic("chat-circle-dots", main ? 22 : 20) + "Пишете ни</a>";
}
const routeB = () => '<a class="pill pill-line" href="' + R.maps + '" target="_blank" rel="noopener">' + ic("map-trifold", 20) + "Маршрут</a>";

/** m = null: the server's first paint (the open-hours version). */
export function ctaHTML(m: number | null): string {
  return m != null && closedAt(m)
    ? writeB(true) + '<div class="duo">' + callB(false) + routeB() + "</div>"
    : callB(true) + '<div class="duo">' + routeB() + writeB(false) + "</div>";
}
export function heroNoteHTML(m: number | null): string {
  if (m == null) return "";
  if (closedAt(m)) return '<p class="ct-note">' + ic("clock", 20) + "<span><b>Сега сме затворени.</b> Обадете се " + (m < OPEN ? "днес" : "утре") + " след " + R.open + " или ни пишете.</span></p>";
  if (m >= KITCHEN) return '<p class="ct-note">' + ic("clock", 20) + "<span><b>Кухнята затвори за днес.</b> Поръчки приемаме утре от " + R.open + ".</span></p>";
  return "";
}

/* ---------- "Днес": live status + the 4 tracks ---------- */
interface Track { n: string; a: number; b: number }
export const TRACKS: Track[] = [
  { n: "Ресторант", a: OPEN, b: CLOSE },
  { n: "Кухня", a: OPEN, b: KITCHEN },
  { n: "Доставка", a: OPEN, b: DELIVERY },
  { n: "Обедно меню", a: OPEN, b: LUNCH },
];
const pct = (x: number) => ((x - OPEN) / (CLOSE - OPEN) * 100).toFixed(3) + "%";
function bar(t: Track, m: number | null): string {
  let h = "";
  if (m != null && m > t.a) { const e = Math.min(t.b, m); h += '<i class="ct-seg past" style="left:' + pct(t.a) + ";width:calc(" + pct(e) + " - " + pct(t.a) + ')"></i>'; }
  if (m == null || m < t.b) { const st = m == null ? t.a : Math.max(t.a, m); h += '<i class="ct-seg ok" style="left:' + pct(st) + ";width:calc(" + pct(t.b) + " - " + pct(st) + ')"></i>'; }
  if (m != null && !closedAt(m)) h += '<i class="ct-tick" style="left:' + pct(m) + '"></i>';
  return '<div class="ct-bar" aria-hidden="true">' + h + "</div>";
}
function srState(t: Track, m: number | null): string {
  if (m == null) return "всеки ден";
  if (m < t.a) return "започва в " + R.open;
  if (m >= t.b) return "приключи за днес";
  return "още " + dur(t.b - m);
}

export interface TodayView { st: string; sub: string; dot: "" | "ok" | "warn" }
export function todayView(m: number, d: number): TodayView {
  const tm = (d + 1) % 7;
  if (m < OPEN) return { dot: "", st: "Затворено сега", sub: "Отваряме днес в " + R.open + ", след <b>" + dur(OPEN - m) + "</b>." };
  if (m < DELIVERY) return { dot: "ok", st: "Отворено сега", sub: "Доставяме още <b>" + dur(DELIVERY - m) + "</b>, до " + R.delivery + ". Кухнята приема поръчки до " + R.kitchen + "." };
  if (m < KITCHEN) return { dot: "warn", st: "Отворено сега", sub: "Доставката приключи за днес. Вземане от място и салон до " + R.kitchen + ", още <b>" + dur(KITCHEN - m) + "</b>." };
  if (m < CLOSE) return { dot: "warn", st: "Кухнята затвори", sub: "Отворено до " + R.close + ". Поръчки приемаме утре от " + R.open + "." };
  return { dot: "", st: "Затворено сега", sub: "Отваряме утре, <b>" + DAYS[tm].toLowerCase() + "</b>, в " + R.open + "." };
}

/** m/d = null: the server paint (every day, no "now"); the browser redraws it at once with the hour and the day. */
export function todayHTML(m: number | null, d: number | null): string {
  const v: TodayView = m == null || d == null
    ? { dot: "", st: "Всеки ден " + HOURS, sub: "Кухнята приема поръчки до " + R.kitchen + ", доставка до " + R.delivery + "." }
    : todayView(m, d);
  const open = m != null && !closedAt(m), x = m == null ? "0" : ((m - OPEN) / (CLOSE - OPEN) * 100).toFixed(2);
  return '<div class="day">' + (d == null ? "Работно време" : "Днес, " + DAYS[d].toLowerCase()) + "</div>" +
    '<div class="st"><span class="ct-dot ' + v.dot + '" aria-hidden="true"></span><h3 class="h3">' + v.st + "</h3></div>" +
    '<p class="sub">' + v.sub + "</p>" +
    '<div class="ct-chart">' +
      (open ? '<div class="nowrow" aria-hidden="true"><span class="nowchip" style="left:clamp(52px, ' + x + "%, calc(100% - 52px))\">Сега · " + hhmm(m!) + "</span></div>" : "") +
      TRACKS.map((t) => '<div class="ct-trk"><div class="top"><span class="nm">' + t.n + '</span><span class="rg">' + hhmm(t.a) + " - " + hhmm(t.b) + "</span></div>" + bar(t, m) + '<span class="vh">, ' + srState(t, m) + ".</span></div>").join("") +
    "</div>" +
    '<ul class="ct-legend" aria-hidden="true">' +
      (m == null || m < CLOSE ? '<li><i class="ok"></i>' + (m == null ? "Отворено" : "Остава днес") + "</li>" : "") + (m != null && m > OPEN ? '<li><i class="past"></i>Мина</li>' : "") +
    '</ul><p class="ct-lunchnote">След ' + R.lunchUntil + " обедното меню е само за вземане от място, с -30%.</p>";
}

/** The week table: today highlighted (and "Утре" after closing). d = null on the server (it does not know the date). */
export function weekHTML(m: number | null, d: number | null): string {
  const tm = d == null ? -1 : (d + 1) % 7;
  return "<table><caption class=\"vh\">Работно време по дни</caption><tbody>" +
    DAYS.map((n, i) => {
      const today = i === d, tomorrow = i === tm && m != null && m >= CLOSE;
      return "<tr" + (today ? ' class="today" aria-current="date"' : "") + '><th scope="row">' + n +
        (today ? '<span class="chip-s">Днес</span>' : "") + (tomorrow ? '<span class="chip-s">Утре</span>' : "") + "</th><td>" + HOURS + "</td></tr>";
    }).join("") +
    "</tbody></table>" +
    '<div class="foot-n"><span>Кухнята приема до ' + R.kitchen + ", доставка до " + R.delivery + '.</span><span class="missing">[ЛИПСВА: работно време в празнични дни]</span></div>';
}

/* ---------- feedback: success card ---------- */
export interface Sent { topic: string; name: string; mode: "phone" | "email"; contact: string; msg: string }
export function okHTML(s: Sent, m: number): string {
  const closed = closedAt(m), isPhone = s.mode !== "email", first = (s.name || "").trim().split(/\s+/)[0];
  return '<div class="ct-ok" data-ok role="status">' +
    '<span class="badge-ok" aria-hidden="true">' + ic("check", 34) + "</span>" +
    '<h3 class="h3" tabindex="-1">Благодарим' + (first ? ", " + esc(first) : "") + "!</h3>" +
    "<p>Получихме съобщението ви. " + (isPhone ? "Ще ви се обадим на " : "Ще ви отговорим на ") + "<b>" + esc(s.contact) + "</b>.</p>" +
    (closed ? '<p class="muted">Сега сме затворени, затова ще го прочетем ' + (m < OPEN ? "днес" : "утре") + " след " + R.open + ".</p>" : "") +
    '<div class="quote"><small>' + (s.topic ? esc(s.topic) : "Вашето съобщение") + "</small><p>" + esc(s.msg) + "</p></div>" +
    '<p class="muted">Спешно ли е? Обадете се, по-бързо е.</p>' +
    '<div class="acts"><a class="pill pill-line" href="tel:' + TEL1 + '">' + ic("phone", 20) + "Обади се · " + R.phone + "</a>" +
    '<button class="pill pill-soft" type="button" data-again>' + ic("pencil-simple", 20) + "Напиши ново съобщение</button></div>" +
  "</div>";
}
