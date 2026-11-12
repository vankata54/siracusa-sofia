/* Offers (/oferti/): HTML of design/pages/offers.html, shared by the server (Astro, neutral view `live = null`) and the
   browser (live view by the hour, the lunch date and the signed-in customer). No menu import here: the lunch examples
   come from the server as plain data (OfData), so the page JS stays without the menu chunk.
   Rules (docs/DECISIONS.md, design/BRIEF.md 8): -30% lunch after 15:00 only for pickup and only with today's lunch menu;
   -5% early booking only for a celebration ([ЛИПСВА] how early); birthday -10% or cake with a separate unchecked consent;
   -10% with a profile "от следващата поръчка"; -10% for the internal rating (code in the cart, never for a Google review);
   discounts never combine (with lunch -30% the better one wins); loyalty rule and reward [ЛИПСВА]; voucher: inquiry,
   pay on site, validity [ЛИПСВА]. */
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural, MON, MONTHS, DAYS, DAYS_SHORT } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import type { State } from "../../lib/status.ts";
import { stateBox, missText, OFFLINE, offlineKeep } from "../../lib/ui.ts";
import "sc-icons:arrow-clockwise,globe,warning-circle"; /* the icons of the shared components it draws (lib/ui.ts) */

/* ---------- data from the server (real lunch dishes, prices from pricing.ts) ---------- */
export interface OfEx { n: string; p: number; now: number; disc: number }
export interface OfData { ex: OfEx | null; teaser: { n: string; p: number }[]; lunchDate: string }

/* ---------- the live view (browser) ---------- */
export interface OfUser { name: string; birthday: boolean; bday: string }
export interface OfLive {
  s: State;
  /** the lunch menu in the data is for today (Sofia) */
  isToday: boolean;
  /** -30% may be shown as active: today's lunch menu (in preview / demo the data counts as today's) */
  lunchLive: boolean;
  ls: { d: Date; days: number };
  ev: { id: string; n: string; time: string; text: string };
  user: OfUser | null;
}

const L = "15:00", K = "22:30";
export const miss = (t: string) => '<span class="missing">[ЛИПСВА: ' + esc(t) + "]</span>";
export function dur(n: number): string { const h = Math.floor(n / 60), m = n % 60; return h ? h + " ч" + (m ? " " + m + " мин" : "") : m + " мин"; }
/* the date as everywhere on the site: "сб, 28 ноември" */
const longDate = (d: Date) => DAYS_SHORT[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
function ymdDate(s: string): Date | null { const p = (s || "").split("-"); return p.length < 3 ? null : new Date(+p[0], +p[1] - 1, +p[2]); }
/** "Например" with today's menu; otherwise from which day the example is (never "днес" with another date) */
export function exLabel(d: OfData, isToday: boolean): string {
  const day = ymdDate(d.lunchDate);
  return isToday || !day ? "Например" : "Например, от менюто на " + DAYS_SHORT[day.getDay()] + ", " + day.getDate() + " " + MONTHS[day.getMonth()];
}
export function exBox(cls: string, d: OfData, isToday: boolean): string {
  const x = d.ex;
  if (!x) return "";
  return '<div class="' + cls + '"><span class="nm">' + esc(exLabel(d, isToday)) + ": " + esc(x.n) + '</span><span class="was">' + fmt(x.p) + '</span><span class="price now">' + fmt(x.now) + '</span><span class="vh">след отстъпката</span></div>';
}

/* ---------- coupons ---------- */
export interface Coupon {
  id: string; on: boolean; icon?: string; when: string; num: string; sub: string; title: string; text: string; terms: string[];
  ex?: boolean; cta: { t: string; href?: string; sheet?: string; pickup?: boolean };
}
export function coupons(live: OfLive | null): Coupon[] {
  const s = live ? live.s : null, m = s ? s.m : -1;
  /* lunch -30%: active only after 15:00 and only with today's lunch menu */
  const lunchOn = !!live && !!s && s.lunchDiscount && live.lunchLive;
  const lunchWhen = !s ? "Всеки ден от " + L + " до " + K
    : lunchOn ? "Важи сега · до " + K
    : m < 900 ? "Днес от " + L + " · след " + dur(900 - m)
    : s.lunchDiscount ? "От " + L + " до " + K + ", с менюто за деня"
    : "Утре от " + L + " до " + K;
  let greek: Coupon;
  if (live) {
    const d = live.ls.d, ev = live.ev;
    greek = { id: "greek", on: true, icon: "calendar-blank",
      when: live.ls.days === 0 ? "Днес от " + ev.time : DAYS_SHORT[d.getDay()] + ", " + d.getDate() + " " + MON[d.getMonth()] + " · след " + plural(live.ls.days, "ден", "дни"),
      num: String(d.getDate()), sub: MONTHS[d.getMonth()] + " · " + DAYS_SHORT[d.getDay()] + ", " + ev.time, title: ev.n, text: ev.text,
      terms: [esc(longDate(d)) + " · " + ev.time, "Последната събота от всеки месец", '<span class="missing">' + missText("greek") + "</span>"],
      cta: { t: "Запази място", href: url.event(ev.id) } };
  } else {
    greek = { id: "greek", on: true, icon: "calendar-blank", when: "Последната събота от месеца", num: "19:00", sub: "последната събота от месеца", title: "Гръцка вечер",
      text: "Всяка последна събота от месеца кухнята сменя посоката. Този път: Гърция.",
      terms: ["Последната събота от всеки месец, от 19:00", '<span class="missing">' + missText("greek") + "</span>"],
      cta: { t: "Запази място", href: url.event("gratska-vecher") } };
  }
  const u = live ? live.user : null, bdayOn = !!(u && u.birthday), bd = bdayOn && u!.bday ? u!.bday.split("-") : null;
  const bdayWhen = bd && MONTHS[+bd[0] - 1] ? "Включено · " + +bd[1] + " " + MONTHS[+bd[0] - 1] : bdayOn ? "Включено · изберете деня" : "Около рождения ви ден";
  let list: Coupon[] = [
    { id: "lunch", on: lunchOn, when: lunchWhen, num: "-30%", sub: "при вземане след " + L, title: "Обедното меню след " + L,
      text: "Вземете обедното меню от ресторанта след " + L + " и платете 30% по-малко. Отстъпката се смята сама в количката.",
      terms: ["Само за ястията от обедното меню", "Само при вземане от място: след " + L + " обедното меню не се доставя", "От " + L + " до " + K + ", готово е веднага"],
      ex: true, cta: lunchOn ? { t: "Вземи от място", href: url.lunch(), pickup: true } : { t: "Виж обедното меню", href: url.lunch() } },
    greek,
    { id: "signup", on: true, when: "Важи сега", num: "-10%", sub: "от следващата поръчка", title: "Направете профил",
      text: "Профилът се прави с телефонния номер и код по SMS, без парола. Вземате -10% от следващата поръчка.",
      terms: ["Прилага се сам на следващата ви поръчка", "Веднъж, когато направите профил", "В профила са и картата с печати, любимите ястия и адресите ви"],
      cta: { t: "Направи профил", href: url.login() } },
    { id: "rating", on: true, icon: "chat-circle-dots", when: "След всяка поръчка", num: "-10%", sub: "за кратка оценка", title: "Кажете ни как беше",
      text: "След поръчката ви питаме „Останахте ли доволни?“. Отговорете и вземете код за -10% на ястията.",
      terms: ["Еднакво при „Да“ и при „Не“", "Питаме 40 мин след доставката или когато поискате сметката в ресторанта",
        "Кодът е еднократен: въведете го в количката, в полето „Код за отстъпка“", "Отзивът в Google е по желание и не е свързан с отстъпката"],
      cta: { t: "Към менюто", href: url.menu() } },
    { id: "birthday", on: false, icon: "cake", when: bdayWhen, num: "-10%", sub: "или малка торта за рожденика", title: "Рожден ден при нас",
      text: "Празнувайте при нас и изберете: -10% от сметката или малка торта. Пишем ви седмица по-рано.",
      terms: ["Само с отделно съгласие „Искам подарък за рождения си ден“", "Пазим само деня и месеца, без годината", "Поздрав и за имения ден"],
      cta: bdayOn ? { t: "Промени в профила", href: url.profile("saglasia") } : { t: "Искам подарък за рождения си ден", sheet: "birthday" } },
    { id: "celebration", on: true, icon: "confetti", when: "Важи сега", num: "-5%", sub: "от крайната цена", title: "Празник при нас",
      text: "Рожден ден, кръщене, юбилей или фирмено парти: резервирайте рано и вземете -5% от крайната цена.",
      terms: ["Колко рано: " + '<span class="missing">' + missText("earlyDays") + "</span>", "Салон, отоплявана градина или цялото място", "Собствено меню: свържете се с нас за оферта"],
      cta: { t: "Изчисли празника", href: url.page("celebration") } },
  ];
  /* active first, the rest keep their order */
  list = list.filter((o) => o.on).concat(list.filter((o) => !o.on));
  return list;
}

export function couponHTML(o: Coupon, d: OfData, isToday: boolean): string {
  const whenIc = o.icon || (o.on ? "check-circle" : "clock");
  const cta = o.cta.sheet
    ? '<button class="pill pill-line" type="button" data-sheet="' + o.cta.sheet + '">' + esc(o.cta.t) + ic("caret-right", 20) + "</button>"
    : '<a class="pill pill-line" href="' + o.cta.href + '"' + (o.cta.pickup ? " data-pickup" : "") + ">" + esc(o.cta.t) + ic("arrow-right", 20) + "</a>";
  return '<article class="cp shell' + (o.on ? "" : " off") + '" id="' + o.id + '" aria-labelledby="t-' + o.id + '" data-on="' + (o.on ? 1 : 0) + '"><div class="core">' +
    '<div class="cp-top"><span class="cp-when">' + ic(whenIc, 18) + "<span>" + esc(o.when) + "</span></span>" +
      '<div class="cp-big"><span class="cp-num">' + o.num + '</span><span class="cp-sub">' + esc(o.sub) + "</span></div></div>" +
    '<div class="cp-cut" aria-hidden="true"><i></i></div>' +
    '<div class="cp-body"><h3 class="h3" id="t-' + o.id + '">' + esc(o.title) + "</h3><p>" + esc(o.text) + "</p>" +
      (o.ex ? exBox("cp-ex", d, isToday) : "") +
      '<ul class="terms" aria-label="Условия">' + o.terms.map((t) => "<li>" + ic("check", 18) + "<span>" + t + "</span></li>").join("") + "</ul>" +
      '<div class="cp-act">' + cta + "</div></div>" +
    "</div></article>";
}
export const gridHTML = (live: OfLive | null, d: OfData) => coupons(live).map((o) => couponHTML(o, d, !!live && live.isToday)).join("");

/** "Сега важат 6 от 8 оферти": the coupons + the loyalty card and the voucher (always available) */
export function nowHTML(live: OfLive): string {
  const l = coupons(live), on = l.filter((o) => o.on).length + 2, all = l.length + 2;
  return '<span class="dot" aria-hidden="true"></span><span>Сега важат <b>' + on + " от " + all + "</b> оферти</span>";
}
export function sumHTML(live: OfLive | null): string {
  const off = coupons(live).some((o) => !o.on);
  return '<span><i aria-hidden="true"></i>Важи сега</span>' + (off ? '<span><i class="g" aria-hidden="true"></i>По-късно</span>' : "");
}

/* ---------- hero: the lead offer by the hour (same order as the home banner, src/lib/offers.ts) ---------- */
interface Hero { live: string; kick?: string; num?: string; big?: boolean; title: string; text: string; extra?: string; go: string; href: string; pickup?: boolean }
export function heroHTML(live: OfLive | null, d: OfData): string {
  let o: Hero;
  const soon = (t: string) => '<p class="feat-soon">' + ic("clock", 20) + "<span>" + t + "</span></p>";
  if (!live) {
    /* server (no hour): the rule itself, true at any time */
    o = { live: "Всеки ден от " + L + " до " + K, num: "-30%", title: "на обедното меню при вземане от място",
      text: "След " + L + " обедното меню е само за вземане. Отстъпката се смята сама в количката.", extra: exBox("feat-ex", d, false), go: "Виж обедното меню", href: url.lunch() };
  } else {
    const s = live.s, m = s.m;
    if (s.lunch && live.isToday) {
      const day = ymdDate(d.lunchDate);
      o = { live: "Сега · до " + L, kick: day ? longDate(day) : undefined, big: true, title: "Обедно меню днес", text: "Поръчайте до " + L + " с доставка или вземане от място.",
        extra: (d.teaser.length ? '<ul class="feat-list" aria-label="Примери от днешното обедно меню">' + d.teaser.map((x) => '<li><span class="nm">' + esc(x.n) + '</span><span class="price">' + fmt(x.p) + "</span></li>").join("") + "</ul>" : "") +
          soon("От " + L + ": -30% при вземане от място · след " + dur(900 - m)), go: "Виж обедното меню", href: url.lunch() };
    } else if (s.lunch) {
      o = { live: "Сега · до " + L, big: true, title: "Обедно меню", text: "Обедното меню се качва всяка сутрин. Поръчайте до " + L + " с доставка или вземане от място.",
        extra: soon("От " + L + ": -30% при вземане от място · след " + dur(900 - m)), go: "Виж обедното меню", href: url.lunch() };
    } else if (s.lunchDiscount && live.lunchLive) {
      o = { live: "Важи сега · до " + K, num: "-30%", title: "на обедното меню при вземане от място",
        text: "След " + L + " обедното меню е само за вземане. Отстъпката се смята сама в количката.", extra: exBox("feat-ex", d, live.isToday), go: "Вземи от място", href: url.lunch(), pickup: true };
    } else {
      const g = live.ls.d, ev = live.ev;
      const note = s.lunchDiscount ? "Обедното меню се качва всяка сутрин. -30% при вземане от " + L + " до " + K + "."
        : "Приемаме поръчки " + (m < 600 ? "днес" : "утре") + " от 10:00. -30% на обедното меню: " + (m < 600 ? "днес" : "утре") + " от " + L + ".";
      o = { live: live.ls.days === 0 ? "Днес от " + ev.time : DAYS_SHORT[g.getDay()] + ", " + g.getDate() + " " + MONTHS[g.getMonth()] + " · " + ev.time,
        kick: "Последната събота от месеца", big: true, title: ev.n, text: ev.text, go: "Запази място", href: url.event(ev.id), extra: soon(note) };
    }
  }
  return '<div class="shell"><div class="core ember-card feat">' +
    '<span class="bgic" aria-hidden="true">' + ic("seal-percent", 280) + "</span>" +
    '<span class="feat-live"><span class="d"></span>' + esc(o.live) + "</span>" +
    (o.kick ? '<p class="feat-kick">' + esc(o.kick) + "</p>" : "") +
    '<h2 class="feat-t' + (o.big ? " big" : "") + '">' + (o.num ? '<span class="feat-num">' + o.num + "</span> " : "") + esc(o.title) + "</h2>" +
    '<p class="feat-p">' + esc(o.text) + "</p>" + (o.extra || "") +
    '<a class="pill go dark" href="' + o.href + '"' + (o.pickup ? " data-pickup" : "") + ">" + esc(o.go) + '<span class="knob">' + ic("arrow-right", 22) + "</span></a>" +
    "</div></div>";
}
export const heroSkel = () => '<div class="shell" aria-hidden="true"><div class="core pad" style="display:grid;gap:14px"><span class="skel" style="height:34px;width:46%;border-radius:999px"></span><span class="skel" style="height:96px;width:58%"></span><span class="skel sk-line" style="width:90%"></span><span class="skel sk-line" style="width:70%"></span><span class="skel" style="height:60px;border-radius:999px"></span></div></div>';
export const couponSkel = () => '<div class="shell" aria-hidden="true"><div class="core"><div class="skel sk-top"></div><div class="pad" style="display:grid;gap:12px"><span class="skel" style="height:24px;width:62%"></span><span class="skel sk-line"></span><span class="skel sk-line" style="width:84%"></span><span class="skel sk-line" style="width:70%"></span><span class="skel" style="height:48px;border-radius:999px;margin-top:8px"></span></div></div></div>';
/* the shared box (lib/ui.ts): same title words and buttons as on every page */
export function errorHTML(_phone?: string, _phoneIntl?: string): string {
  return stateBox({ kind: "error", what: "офертите", h: "h3" });
}
export const netHTML = () => offlineKeep({ cls: "of-net" });
