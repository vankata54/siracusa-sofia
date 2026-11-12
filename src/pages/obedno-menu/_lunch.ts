/* Lunch menu (/obedno-menu/): the HTML pieces that depend on the hour, shared by the server (index.astro frontmatter)
   and the browser (its script). Port of design/pages/lunch.html (design/PAGES.md "lunch.html", decision 19,
   design/BRIEF.md 8 "lunchIsToday").
   SIZE: this module goes to the browser, so it must NOT import the menu (lib/data.ts), lib/render.ts or lib/pricing.ts.
   What it needs about the menu comes in `Meta` (the server reads it from the data, the browser from data-* attributes
   on [data-lunch]); the dishes themselves are drawn on the server (_lunch-server.ts) and only updated in place. */
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural, MONTHS, MON, DAYS } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import { RESTAURANT, ORDER_RULES } from "../../lib/consts.ts";
import type { Eta } from "../../lib/status.ts";
import { stateBox, loadingText, callBtn, hourNote, hourTitle, hourLine, offlineKeep } from "../../lib/ui.ts";
import "sc-icons:arrow-clockwise,clock,globe,warning-circle"; /* the icons of the shared components it draws (lib/ui.ts) */

/** before 10:00 | 10:00-15:00 delivery or pickup | 15:00-22:30 pickup only -30% | after 22:30 */
export type Phase = "before" | "lunch" | "discount" | "after";
export interface LState { m: number; lunch: boolean; lunchDiscount: boolean }
export function phaseOf(s: LState): Phase { return s.m < 600 ? "before" : s.lunch ? "lunch" : s.lunchDiscount ? "discount" : "after"; }
export const canOrderIn = (p: Phase | null): boolean => p === "lunch" || p === "discount";

/** The lunch menu in the data: its date "YYYY-MM-DD", the number of dishes and the lowest price. */
export interface Meta { date: string; dayName?: string; count: number; minP: number }

/** What the browser knows; the server renders with serverView() (no hour, not "today"). */
export interface View {
  meta: Meta;
  phase: Phase | null;   // null = server (hour unknown)
  isToday: boolean;      // the menu in the data is for today's date in Sofia (BRIEF 8)
  orderable: boolean;    // "+" and the action bar (phase allows it and the menu is for today, or preview)
  mode: "delivery" | "pickup";
  eta?: Eta;
  clock?: string;        // "12:30"
  reduce?: boolean;
  m?: number;
}
export const serverView = (meta: Meta): View => ({ meta, phase: null, isToday: false, orderable: true, mode: "delivery" });

/** Today's date in Sofia as "YYYY-MM-DD" (same as sofiaDate() in lib/data.ts, without loading the menu). */
export function sofiaToday(d: Date = new Date()): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}

const R = RESTAURANT;
/* zone names as in the prototype ("Дружба 1 и 2"), same zones as ZONES in lib/consts.ts */
export const FREE_TXT = "Дружба 1 и 2, НПЗ Искър и Бусманци";
export const PAID_TXT = "Горубляне и Гара Искър";
export const DISC_PCT = Math.round(ORDER_RULES.lunchPickupDiscount * 100);
/** -30% price, rounded the same way as lib/pricing.ts (discount = round(p * 30) / 100). */
export const cut = (p: number): number => Math.round((p - Math.round(p * DISC_PCT) / 100) * 100) / 100;

/* ---------- the date of the menu in the data ---------- */
export const menuDate = (M: Meta): Date => new Date(M.date + "T12:00:00");
export function dateText(M: Meta): string {
  const d = menuDate(M), dn = M.dayName || DAYS[d.getDay()].charAt(0).toUpperCase() + DAYS[d.getDay()].slice(1);
  return dn + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
}

const pad = (n: number): string => (n < 10 ? "0" : "") + n;
function left(min: number): string {
  const h = Math.floor(min / 60), mm = min % 60;
  return (h ? h + " ч" : "") + (h && mm ? " " : "") + (mm ? mm + " мин" : "");
}
export const clockText = (h: number, m: number): string => pad(h) + ":" + pad(m);

/* ---------- hero ---------- */
/** The label and the date are two lines on screen; the hidden ": " keeps them apart for screen readers and search. */
export function h1HTML(v: View): string {
  const dt = dateText(v.meta);
  return '<span class="eb">' + ic("fork-knife", 18) + "Обедно меню" + (v.isToday ? " · днес" : "") + '</span><span class="vh">: </span><span class="dt">' +
    (v.isToday ? dt : "Меню за " + dt.charAt(0).toLowerCase() + dt.slice(1)) + "</span>";
}
export function leadHTML(v: View, bare = false): string {
  const tail = canOrderIn(v.phase) && v.orderable ? " При вземане от място е готово веднага." : "";
  return (bare ? "" : plural(v.meta.count, "ястие", "ястия") + ", от " + fmt(v.meta.minP) + ". ") + "Ново меню всеки ден." + tail;
}
/** BRIEF 8: the menu is for the date in the data; on another day never call it "today". */
export function uploadNoteHTML(v: View, preview: boolean): string {
  if (v.isToday) return "";
  return '<div class="lnote upl">' + ic("calendar-dots", 22) + "<span><b>Обедното меню се качва всяка сутрин</b>Отгоре е последното качено меню. " +
    (preview ? "В прегледа ястията остават за поръчка като пример." : "Поръчки приемаме, щом качим менюто за деня.") + "</span></div>";
}
/** The ember -30% banner: only when the lunch menu can really be ordered (not while we wait for the menu of the day). */
export function dealHTML(v: View): string {
  if (v.phase !== "discount" || !v.orderable) return "";
  return '<div class="deal ember-card" role="note"><div class="top2"><span class="big">-' + DISC_PCT + '%</span><span class="ill">' + ic("storefront", 28) + "</span></div><b>при вземане от място</b>" +
    "<p>След 15:00 обедното меню е само за вземане от място. Отстъпката се смята сама в количката.</p></div>";
}

function timeline(v: View): string {
  const show = canOrderIn(v.phase), m = v.m ?? 0, x = Math.max(0, Math.min(1, (m - 600) / 750));
  return '<div class="tl' + (show ? (v.reduce ? "" : " anim") : " off") + '" style="--x:' + (show ? x.toFixed(4) : 0) + '">' +
    '<div class="tl-bar" aria-hidden="true"><span class="a"></span><span class="b"></span>' + (show ? '<span class="tl-past"></span><i class="tl-now"></i>' : "") + "</div>" +
    '<div class="tl-l" aria-hidden="true"><span>10:00</span><span>15:00</span><span>22:30</span></div>' +
    '<div class="tl-k"><span><i class="ka"></i>10:00 - 15:00 доставка и вземане</span><span><i class="kb"></i>15:00 - 22:30 само вземане, -' + DISC_PCT + "%</span></div></div>";
}
export function modeInfoHTML(v: View): string {
  if (v.phase !== "lunch" || v.mode === "pickup") return '<div class="modeinfo">' + ic("storefront", 22) + "<span><b>Готово веднага след поръчката</b><span class=\"muted\">Вземате от ресторанта: " + esc(R.address) + "</span></span></div>";
  const e = v.eta || { min: 35, busy: false };
  return '<div class="modeinfo' + (e.busy ? " busy" : "") + '">' + ic(e.busy ? "warning" : "moped", 22) + "<span><b>" + (e.busy ? "Възможни са закъснения · около " + e.min + " мин" : "Доставка за около " + e.min + " мин") + "</b>" +
    '<span class="muted">Безплатна в ' + FREE_TXT + '. <a href="' + url.page("delivery") + '">Зони за доставка</a></span></span></div>';
}
const toMenu = '<a class="pill pill-line pill-block" href="' + url.menu() + '" style="margin-top:12px">Към основното меню' + ic("arrow-right", 20) + "</a>";
/** The next lunch menu while the kitchen is closed: before 10:00 it is the menu of the day, after 22:30 tomorrow's. */
function nextMenu(v: View): string {
  const [title, body] = v.phase === "before"
    ? (v.isToday ? ["Днешното обедно меню", "Вече е качено. Поръчки от 10:00."] : ["Менюто за деня", "Качваме го всяка сутрин. Поръчки от 10:00."])
    : ["Утрешното обедно меню", '<span class="missing">[ЛИПСВА: утрешното меню от седмичния график]</span>'];
  return '<div class="tmrw"><span class="ill">' + ic("calendar-blank", 24) + "</span><span><b>" + title + "</b>" + (body.charAt(0) === "<" ? body : '<span class="muted">' + body + "</span>") + "</span></div>";
}
export function todayCardHTML(v: View): string {
  const p = v.phase, open = canOrderIn(p), can = open && v.orderable, waiting = open && !v.orderable;
  let head: string;
  if (p === null) head = '<span class="dot"></span><span><b>Обедното меню е от 10:00 до 15:00</b><span class="sub">До 15:00 с доставка или за вземане. След това само за вземане, с -' + DISC_PCT + "%.</span></span>";
  /* the menu in the data is for another date (real site): no "Поръчайте", no delivery time, the same message as the note above */
  else if (waiting) head = '<span class="dot"></span><span><b>Чакаме менюто за деня</b><span class="sub">Междувременно можете да поръчате от основното меню.</span></span>';
  else if (p === "lunch") head = '<span class="dot ok"></span><span><b>Сега: доставка и вземане</b><span class="sub">Поръчайте до 15:00 · остават ' + left(900 - (v.m ?? 0)) + "</span></span>";
  else if (p === "discount") head = '<span class="dot warn"></span><span><b>Сега: само вземане от място</b><span class="sub">До 22:30 · остават ' + left(1350 - (v.m ?? 0)) + "</span></span>";
  else head = '<span class="dot"></span><span><b>Обедното меню е от 10:00 до 15:00</b><span class="sub">' + (p === "before" ? "Отваряме в 10:00. Тогава можете да поръчате." : hourTitle(hs(v)) + ". " + hourLine(hs(v)) + ".") + "</span></span>";
  const seg = p === "lunch" && can
    ? '<div class="seg" role="group" aria-label="Как да получите обеда"><button type="button" data-mode="delivery" aria-pressed="' + (v.mode !== "pickup") + '">' + ic("moped", 20) + 'Доставка</button><button type="button" data-mode="pickup" aria-pressed="' + (v.mode === "pickup") + '">' + ic("storefront", 20) + "Вземи от място</button></div>"
    : "";
  const tail = p === null ? "" : can ? seg + "<div data-modeinfo>" + modeInfoHTML(v) + "</div>" : waiting ? toMenu : nextMenu(v) + toMenu;
  return '<div class="core"><div class="now-h">' + head + (can && v.clock ? '<span class="clock" title="Часът сега">' + v.clock + "</span>" : "") + "</div>" + timeline(v) + tail + "</div>";
}

/* ---------- one dish row: price, "Изчерпано днес", "+" (the server draws the rows, the browser updates them) ---------- */
export function metaHTML(p: number, discount: boolean, out: boolean): string {
  return (discount && !out ? '<span class="old"><span class="vh">вместо </span>' + fmt(p) + '</span><span class="price">' + fmt(cut(p)) + "</span>" : '<span class="price">' + fmt(p) + "</span>") +
    (out ? '<span class="badge out">' + ic("clock", 16) + "Изчерпано днес</span>" : "");
}
/** Same markup as plusBtn() in lib/render.ts (the runtime's [data-add] click adds it with data-p, without the menu). */
export function plusHTML(id: string, p: number, n: string): string {
  return '<button class="plus" type="button" data-add="' + esc(id) + '" data-p="' + p + '" aria-label="Добави ' + esc(n) + ' в количката">' + ic("plus", 22) + "</button>";
}
export const SLOT = '<span class="slot" aria-hidden="true"></span>';

/* ---------- notes above the list (browser only: they depend on the hour) ---------- */
/** the hour state for the one hour note of the site (lib/ui.ts): the lunch page is locked only before 10:00 and after 22:30 */
const hs = (v: View) => ({ open: false, kitchen: false, delivery: false, m: v.m ?? 0 });
export function lockedNote(v: View): string {
  const p = v.phase;
  if (p === null || canOrderIn(p)) return "";
  return hourNote(hs(v), { cls: "lnote-h", more: p === "before" ? "Разгледайте менюто сега. Бутоните за поръчка се появяват в 10:00" : "Оставяме менюто за справка" });
}
export function offlineNote(): string {
  return offlineKeep({ cls: "lnote-off" }); /* the one note (lib/ui.ts) */
}

/* preview-only states (?preview=1#loading | #empty | #error) */
export function skeletonHTML(): string {
  const g = '<div class="shell"><div class="core"><div class="lrows">' + [0, 1, 2, 3].map(() => '<div class="sk-row"><span class="skel p"></span><span><span class="skel l1"></span><span class="skel l2"></span></span></div>').join("") + "</div></div></div>";
  const h = (w: number, top = 0) => '<div class="grp-h"' + (top ? ' style="margin-top:' + top + 'px"' : "") + '><span class="skel" style="width:44px;height:44px;border-radius:50%"></span><span class="skel" style="height:22px;width:' + w + 'px"></span></div>';
  return '<div aria-busy="true" aria-live="polite"><span class="vh">' + loadingText("обедното меню") + "</span>" + h(120) + g + h(160, 32) + g + "</div>";
}
export function emptyHTML(): string {
  return '<div class="shell"><div class="core empty"><span class="ill">' + ic("bowl-food", 44) + '</span><h2 class="h3">Обедното меню още не е качено</h2><p class="muted" style="margin:0;max-width:34ch">Проверете пак след малко или поръчайте от основното меню.</p>' +
    '<a class="pill pill-red pill-lg" href="' + url.menu() + '">Към основното меню' + ic("arrow-right", 20) + '</a>' + callBtn("pill pill-line") + "</div></div>";
}
export function errorHTML(): string {
  return stateBox({ kind: "error", what: "обедното меню", retry: 'data-demo=""' });
}

/* ---------- week (the menu's day is filled, the other days are [ЛИПСВА]); short dates "2 ное" as on the site ---------- */
export function weekHTML(v: View): string {
  const M = v.meta, dd = menuDate(M), dow = (dd.getDay() + 6) % 7, mon = new Date(dd);
  mon.setDate(dd.getDate() - dow);
  const ABBR = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"], FULL = ["понеделник", "вторник", "сряда", "четвъртък", "петък", "събота", "неделя"];
  return '<div class="week" role="list" tabindex="0" aria-label="Обедното меню по дни от седмицата">' + ABBR.map((a, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const me = i === dow, past = i < dow;
    const body = me ? '<span class="tag">' + (v.isToday ? "Днес" : "Качено") + '</span><span class="cnt2">' + plural(M.count, "ястие", "ястия") + '</span><span class="from">от ' + fmt(M.minP) + "</span>"
      : '<span class="missing">[ЛИПСВА: меню за ' + FULL[i] + "]</span>" + ic("calendar-dots", 22);
    return '<div class="day' + (me ? (v.isToday ? " is-today" : " has-menu") : " empty-day") + (past && v.isToday ? " past" : "") + '" role="listitem" aria-label="' + FULL[i] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + '"><span class="dn"><b>' + a + "</b><span>" + d.getDate() + " " + MON[d.getMonth()] + "</span></span>" + body + "</div>";
  }).join("") + "</div>";
}
