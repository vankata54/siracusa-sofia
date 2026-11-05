/* Lunch menu (/obedno-menu/): HTML pieces shared by the server (index.astro frontmatter) and the browser (its script).
   Port of design/pages/lunch.html (design/PAGES.md "lunch.html", decision 19, design/BRIEF.md 8 "lunchIsToday").
   Pure string renderers, no DOM. Everything that depends on the hour takes a Phase; the server draws without one
   (neutral, never "днес") and the browser fills in the real hour, the date check and the cart. */
import { lunch, isOut, menu, RESTAURANT, type Dish } from "../../lib/data.ts";
import { pic, plusBtn } from "../../lib/render.ts";
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural, DAYS, MONTHS } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import { LUNCH_PICKUP_DISCOUNT } from "../../lib/pricing.ts";
import type { Eta } from "../../lib/status.ts";
/* icons this module draws (registered for SC.ic in the browser; the server has them all) */
import "../../lib/icons/fork-knife.ts";
import "../../lib/icons/storefront.ts";
import "../../lib/icons/moped.ts";
import "../../lib/icons/warning.ts";
import "../../lib/icons/calendar-blank.ts";
import "../../lib/icons/calendar-dots.ts";
import "../../lib/icons/arrow-right.ts";
import "../../lib/icons/bowl-food.ts";
import "../../lib/icons/leaf.ts";
import "../../lib/icons/fire.ts";
import "../../lib/icons/cooking-pot.ts";
import "../../lib/icons/cake.ts";
import "../../lib/icons/info.ts";
import "../../lib/icons/clock.ts";
import "../../lib/icons/warning-circle.ts";
import "../../lib/icons/phone.ts";
import "../../lib/icons/briefcase.ts";
import "../../lib/icons/users-three.ts";
import "../../lib/icons/caret-down.ts";
import "../../lib/icons/eye.ts";

/** before 10:00 | 10:00-15:00 delivery or pickup | 15:00-22:30 pickup only -30% | after 22:30 */
export type Phase = "before" | "lunch" | "discount" | "after";
export interface LState { m: number; lunch: boolean; lunchDiscount: boolean }
export function phaseOf(s: LState): Phase { return s.m < 600 ? "before" : s.lunch ? "lunch" : s.lunchDiscount ? "discount" : "after"; }
export const canOrderIn = (p: Phase | null): boolean => p === "lunch" || p === "discount";

/** What the browser knows; the server renders with view() (no hour, not "today"). */
export interface View {
  phase: Phase | null;   // null = server (hour unknown)
  isToday: boolean;      // SC.lunchIsToday(): the menu in the data is for today's date
  orderable: boolean;    // "+" and the action bar (phase allows it and the menu is for today, or preview)
  mode: "delivery" | "pickup";
  eta?: Eta;
  clock?: string;        // "12:30"
  reduce?: boolean;
  m?: number;
}
export const serverView = (): View => ({ phase: null, isToday: false, orderable: true, mode: "delivery" });

const R = RESTAURANT;
/* zone names as in the prototype ("Дружба 1 и 2"), same zones as ZONES in lib/consts.ts */
const FREE_TXT = "Дружба 1 и 2, НПЗ Искър и Бусманци";
const PAID_TXT = "Горубляне и Гара Искър";
const DISC_PCT = Math.round(LUNCH_PICKUP_DISCOUNT * 100);
/** -30% price, rounded the same way as lib/pricing.ts (discount = round(p * 30) / 100). */
export const cut = (p: number): number => Math.round((p - Math.round(p * DISC_PCT) / 100) * 100) / 100;

const GROUP_ICON: Record<string, string> = { "Супи": "bowl-food", "Салати": "leaf", "Скара на дървени въглища": "fire", "Основни": "cooking-pot", "Десерти": "cake" };
const GROUP_ID: Record<string, string> = { "Супи": "supi", "Салати": "salati", "Скара на дървени въглища": "skara", "Основни": "osnovni", "Десерти": "deserti" };
const gid = (n: string): string => GROUP_ID[n] || n.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-");

export interface Group { n: string; items: Dish[] }
/** Groups in data order; sold out stay visible, always last in their group (decision 2). */
export function groups(): Group[] {
  const gs: Group[] = [];
  for (const x of lunch) {
    let g = gs.find((z) => z.n === x.group);
    if (!g) { g = { n: x.group || "Обедно меню", items: [] }; gs.push(g); }
    g.items.push(x);
  }
  gs.forEach((g) => g.items.sort((a, b) => Number(isOut(a)) - Number(isOut(b))));
  return gs;
}

/* ---------- the date of the menu in the data ---------- */
export const menuDate = (): Date => new Date(menu.lunch.date + "T12:00:00");
export function dateText(): string {
  const d = menuDate(), dn = (menu.lunch as { dayName?: string }).dayName || DAYS[d.getDay()].charAt(0).toUpperCase() + DAYS[d.getDay()].slice(1);
  return dn + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
}
export const minP = (): number => Math.min(...lunch.map((x) => x.p));

const pad = (n: number): string => (n < 10 ? "0" : "") + n;
function left(min: number): string {
  const h = Math.floor(min / 60), mm = min % 60;
  return (h ? h + " ч" : "") + (h && mm ? " " : "") + (mm ? mm + " мин" : "");
}
export const clockText = (h: number, m: number): string => pad(h) + ":" + pad(m);

/* ---------- hero ---------- */
export function h1HTML(v: View): string {
  const dt = dateText();
  return '<span class="eb">' + ic("fork-knife", 18) + "Обедно меню" + (v.isToday ? " · днес" : "") + '</span><span class="dt">' +
    (v.isToday ? dt : "Меню за " + dt.charAt(0).toLowerCase() + dt.slice(1)) + "</span>";
}
export function leadHTML(v: View, bare = false): string {
  const tail = canOrderIn(v.phase) && v.orderable ? " При вземане от място е готово веднага." : "";
  return (bare ? "" : plural(lunch.length, "ястие", "ястия") + ", от " + fmt(minP()) + ". ") + "Ново меню всеки ден." + tail;
}
/** BRIEF 8: the menu is for the date in the data; on another day never call it "today". */
export function uploadNoteHTML(v: View, preview: boolean): string {
  if (v.isToday) return "";
  return '<div class="lnote upl">' + ic("calendar-dots", 22) + "<span><b>Обедното меню се качва всяка сутрин</b>Отгоре е последното качено меню. " +
    (preview ? "В прегледа ястията остават за поръчка като пример." : "Поръчки приемаме, щом качим менюто за деня.") + "</span></div>";
}
export function dealHTML(v: View): string {
  if (v.phase !== "discount") return "";
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
  return '<div class="modeinfo' + (e.busy ? " busy" : "") + '">' + ic(e.busy ? "warning" : "moped", 22) + "<span><b>" + (e.busy ? "Възможни са закъснения · около " + e.min + " мин" : "Доставка за около " + e.min + " мин") + "</b>" +
    '<span class="muted">Безплатна в ' + FREE_TXT + '. <a href="' + url.page("delivery") + '">Зони за доставка</a></span></span></div>';
}
export function todayCardHTML(v: View): string {
  const p = v.phase, can = canOrderIn(p) && v.orderable;
  let head: string;
  if (p === null) head = '<span class="dot"></span><span><b>Обедното меню е от 10:00 до 15:00</b><span class="sub">До 15:00 с доставка или за вземане. След това само за вземане, с -' + DISC_PCT + "%.</span></span>";
  else if (p === "lunch") head = '<span class="dot ok"></span><span><b>Сега: доставка и вземане</b><span class="sub">Поръчайте до 15:00 · остават ' + left(900 - (v.m ?? 0)) + "</span></span>";
  else if (p === "discount") head = '<span class="dot warn"></span><span><b>Сега: само вземане от място</b><span class="sub">До 22:30 · остават ' + left(1350 - (v.m ?? 0)) + "</span></span>";
  else head = '<span class="dot"></span><span><b>Обедното меню е от 10:00 до 15:00</b><span class="sub">' + (p === "before" ? "Отваряме в 10:00. Тогава можете да поръчате." : "Кухнята затвори за днес. Утре сме тук от 10:00.") + "</span></span>";
  const seg = p === "lunch" && can
    ? '<div class="seg" role="group" aria-label="Как да получите обеда"><button type="button" data-mode="delivery" aria-pressed="' + (v.mode !== "pickup") + '">' + ic("moped", 20) + 'Доставка</button><button type="button" data-mode="pickup" aria-pressed="' + (v.mode === "pickup") + '">' + ic("storefront", 20) + "Вземи от място</button></div>"
    : "";
  const tail = p === null ? ""
    : canOrderIn(p) ? seg + "<div data-modeinfo>" + modeInfoHTML(v) + "</div>"
    : '<div class="tmrw"><span class="ill">' + ic("calendar-blank", 24) + '</span><span><b>Утрешното обедно меню</b><span class="missing">[ЛИПСВА: утрешното меню от седмичния график]</span></span></div><a class="pill pill-line pill-block" href="' + url.menu() + '" style="margin-top:12px">Към основното меню' + ic("arrow-right", 20) + "</a>";
  return '<div class="core"><div class="now-h">' + head + (canOrderIn(p) && v.clock ? '<span class="clock" title="Часът сега">' + v.clock + "</span>" : "") + "</div>" + timeline(v) + tail + "</div>";
}

/* ---------- list ---------- */
function priceHTML(x: Dish, v: View): string {
  if (v.phase === "discount" && !isOut(x)) return '<span class="old"><span class="vh">вместо </span>' + fmt(x.p) + '</span><span class="price">' + fmt(cut(x.p)) + "</span>";
  return '<span class="price">' + fmt(x.p) + "</span>";
}
function row(x: Dish, v: View): string {
  const out = isOut(x), can = (v.phase === null || canOrderIn(v.phase)) && v.orderable;
  const right = out || !can ? '<span class="slot" aria-hidden="true"></span>' : plusBtn(x);
  return '<li class="lrow' + (out ? " out" : "") + (!can ? " locked" : "") + '">' + pic(x) + '<span class="lt"><span class="nm">' + esc(x.n) + '</span><span class="meta">' + priceHTML(x, v) +
    (out ? '<span class="badge out">' + ic("clock", 16) + "Изчерпано днес</span>" : "") + "</span></span>" + right + "</li>";
}
function groupHTML(g: Group, i: number, v: View): string {
  return '<section class="grp rv" id="g-' + gid(g.n) + '" aria-labelledby="gh' + i + '"><div class="grp-h"><span class="gi">' + ic(GROUP_ICON[g.n] || "fork-knife", 22) + '</span><h2 class="h3" id="gh' + i + '">' + esc(g.n) + "</h2>" +
    '<span class="n">' + plural(g.items.length, "ястие", "ястия") + '</span></div><div class="shell"><div class="core"><ul class="lrows">' + g.items.map((x) => row(x, v)).join("") + "</ul></div></div></section>";
}
function jumpChips(gs: Group[]): string {
  return '<div class="chips jump" role="navigation" aria-label="Групи в обедното меню">' + gs.map((g) =>
    '<button class="chip" type="button" data-jump="g-' + gid(g.n) + '">' + ic(GROUP_ICON[g.n] || "fork-knife", 18) + esc(g.n === "Скара на дървени въглища" ? "Скара" : g.n) + ' <span class="n">' + g.items.length + "</span></button>").join("") + "</div>";
}
function allergenNote(): string {
  return '<div class="lnote">' + ic("info", 22) + '<span><b>Алергени и грамаж</b>Съставът на обедните ястия още не е въведен. Ако имате алергия, попитайте ни на <a class="tel" href="tel:' + R.phoneIntl + '">' + R.phone + '</a> преди да поръчате. <span class="missing">[ЛИПСВА: грамаж, състав и алергени от кухнята]</span></span></div>';
}
function lockedNote(v: View): string {
  const p = v.phase;
  if (p === null) return "";
  if (!canOrderIn(p)) {
    return '<div class="lnote" style="margin:0 0 20px">' + ic("clock", 22) + "<span><b>" + (p === "before" ? (v.isToday ? "Днешното меню, поръчки от 10:00" : "Поръчки от 10:00") : (v.isToday ? "Днешното меню приключи" : "Поръчките за днес приключиха")) + "</b>" +
      (p === "before" ? "Разгледайте го сега. Бутоните за поръчка се появяват в 10:00." : "Оставяме го за справка. Поръчки отново утре от 10:00.") + "</span></div>";
  }
  return "";
}
function offlineNote(): string {
  return '<div class="lnote warn" role="status" style="margin:0 0 20px">' + ic("warning", 22) + "<span><b>Няма връзка</b>Показваме менюто, което заредихме последно. Количката ви е запазена, поръчайте, щом връзката се върне.</span></div>";
}
export function listHTML(v: View, offline = false): string {
  const gs = groups();
  return (offline ? offlineNote() : "") + lockedNote(v) + jumpChips(gs) +
    '<div class="grps">' + gs.map((g, i) => groupHTML(g, i, v)).join("") + "</div>" + allergenNote();
}

/* preview-only states (?preview=1#loading | #empty | #error) */
export function skeletonHTML(): string {
  const g = '<div class="shell"><div class="core"><div class="lrows">' + [0, 1, 2, 3].map(() => '<div class="sk-row"><span class="skel p"></span><span><span class="skel l1"></span><span class="skel l2"></span></span></div>').join("") + "</div></div></div>";
  const h = (w: number, top = 0) => '<div class="grp-h"' + (top ? ' style="margin-top:' + top + 'px"' : "") + '><span class="skel" style="width:44px;height:44px;border-radius:50%"></span><span class="skel" style="height:22px;width:' + w + 'px"></span></div>';
  return '<div aria-busy="true" aria-live="polite"><span class="vh">Зареждаме обедното меню</span>' + h(120) + g + h(160, 32) + g + "</div>";
}
export function emptyHTML(): string {
  return '<div class="shell"><div class="core empty"><span class="ill">' + ic("bowl-food", 44) + '</span><h2 class="h3">Обедното меню още не е качено</h2><p class="muted" style="margin:0;max-width:34ch">Проверете пак след малко или поръчайте от основното меню.</p>' +
    '<a class="pill pill-red pill-lg" href="' + url.menu() + '">Към основното меню' + ic("arrow-right", 20) + '</a><a class="pill pill-line" href="tel:' + R.phoneIntl + '">' + ic("phone", 20) + "Обади се</a></div></div>";
}
export function errorHTML(): string {
  return '<div class="shell"><div class="core empty" role="alert"><span class="ill">' + ic("warning-circle", 44) + '</span><h2 class="h3">Не успяхме да заредим обедното меню</h2><p class="muted" style="margin:0;max-width:34ch">Проверете връзката и опитайте пак. Или ни се обадете и ще ви кажем какво има в менюто.</p>' +
    '<button class="pill pill-red pill-lg" type="button" data-demo="">Опитай пак</button><a class="pill pill-line" href="tel:' + R.phoneIntl + '">' + ic("phone", 20) + "Обади се · " + R.phone + "</a></div></div>";
}

/* ---------- week (preview only: the menu's day is filled, the other days are [ЛИПСВА]) ---------- */
export function weekHTML(v: View): string {
  const dd = menuDate(), dow = (dd.getDay() + 6) % 7, mon = new Date(dd);
  mon.setDate(dd.getDate() - dow);
  const ABBR = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"], FULL = ["понеделник", "вторник", "сряда", "четвъртък", "петък", "събота", "неделя"];
  return '<div class="week" role="list">' + ABBR.map((a, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const me = i === dow, past = i < dow;
    const body = me ? '<span class="tag">' + (v.isToday ? "Днес" : "Качено") + '</span><span class="cnt2">' + plural(lunch.length, "ястие", "ястия") + '</span><span class="from">от ' + fmt(minP()) + "</span>"
      : '<span class="missing">[ЛИПСВА: меню за ' + FULL[i] + "]</span>" + ic("calendar-dots", 22);
    return '<div class="day' + (me ? (v.isToday ? " is-today" : " has-menu") : " empty-day") + (past && v.isToday ? " past" : "") + '" role="listitem" aria-label="' + FULL[i] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + '"><span class="dn"><b>' + a + "</b><span>" + d.getDate() + "." + pad(d.getMonth() + 1) + "</span></span>" + body + "</div>";
  }).join("") + "</div>";
}

/* ---------- office + FAQ ---------- */
export const FAQ: [string, string, string?][] = [
  ["До колко часа доставяте обедното меню?", "До 15:00. След 15:00 обедното меню е само за вземане от място, с -" + DISC_PCT + "% от цената."],
  ["Колко бързо е готово, ако го взема от ресторанта?", "Обедните ястия са готови веднага след поръчката. Ако добавите и от основното меню, поръчката е готова най-рано след 20 минути."],
  ["Къде доставяте безплатно?", "В " + FREE_TXT + ". До " + PAID_TXT + " доставяме по тарифа.", ' <span class="missing">[ЛИПСВА: такса в €]</span>'],
  ["Менюто различно ли е всеки ден?", "Да. Менюто се сменя всеки ден и едно и също меню не се повтаря два поредни дни."],
  ["Как ще разбера какви алергени има?", "Съставът на обедните ястия още не е въведен на сайта. Обадете ни се на " + R.phone + " и ще ви кажем преди да поръчате."],
];
export function bottomHTML(v: View): string {
  return '<section class="sec" aria-labelledby="wk"><div class="sec-h"><h2 class="h2" id="wk">Цялата седмица</h2></div><p class="muted" style="margin:-4px 0 16px">Само за преглед. Всеки ден поръчвате от менюто за деня.</p><div data-week>' + weekHTML(v) + "</div></section>" +
    '<section class="sec"><div class="duo">' +
    '<div class="shell office"><div class="core"><span class="ill">' + ic("briefcase", 28) + '</span><h2 class="h3">Обща поръчка за офиса</h2><p class="muted">Без събиране на поръчки по телефона.</p>' +
    "<ol><li><span>Един колега отваря поръчка и праща връзка в чата.</span></li><li><span>Всеки добавя своето от обедното меню до 11:30.</span></li><li><span>Всичко пристига заедно, с обща сметка или поотделно.</span></li></ol>" +
    '<a class="pill pill-line" href="' + url.page("office") + '">' + ic("users-three", 20) + "Започни обща поръчка</a></div></div>" +
    '<div class="faq"><h2 class="h3" style="margin:0 4px 12px">Често питани</h2><div class="shell"><div class="core">' + FAQ.map((q) => "<details><summary>" + q[0] + ic("caret-down", 20) + "</summary><p>" + esc(q[1]) + (q[2] || "") + "</p></details>").join("") + "</div></div></div>" +
    "</div></section>";
}

/* ---------- SEO: Menu > MenuSection > MenuItem, BreadcrumbList, FAQPage ---------- */
export function lunchLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  const page = abs(url.lunch());
  const menuLd = {
    "@context": "https://schema.org", "@type": "Menu", "@id": page + "#menu", name: "Обедно меню · " + dateText(), url: page, inLanguage: "bg",
    description: "Обедното меню на " + R.name + " в Дружба 2: до 15:00 с доставка или за вземане, след 15:00 само за вземане от място с -" + DISC_PCT + "%.",
    hasMenuSection: groups().map((g) => ({
      "@type": "MenuSection", name: g.n,
      hasMenuItem: g.items.map((x) => ({
        "@type": "MenuItem", name: x.n,
        offers: { "@type": "Offer", price: x.p.toFixed(2), priceCurrency: "EUR", availability: isOut(x) ? "https://schema.org/SoldOut" : "https://schema.org/InStock" },
      })),
    })),
  };
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name: "Обедно меню", item: page }],
  };
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: FAQ.map((q) => ({ "@type": "Question", name: q[0], acceptedAnswer: { "@type": "Answer", text: q[1] } })),
  };
  return [menuLd, crumbs, faq];
}
