/* Pickup page (/vzemi-ot-myasto/): the HTML pieces shared by the server (Astro, SEO) and the browser (the hour,
   the cart, the kitchen switch). Port of design/pages/pickup.html. Every hour and rule comes from src/lib:
   the hours from RESTAURANT (consts), the phases from state(), the 20 minutes from price().earliest, the slots
   (every 15 min, up to 3 hours ahead, not after the kitchen closes) from pickupSlots(), the -30% from pricing. */
import { RESTAURANT as R } from "../../lib/consts.ts";
import { byId, items, lunch, isOut, type Dish } from "../../lib/data.ts";
import { fmt, esc, hhmm, DAYS } from "../../lib/format.ts";
import { ic } from "../../lib/icons.ts";
import { url } from "../../lib/routes.ts";
import { pic, plusBtn } from "../../lib/render.ts";
import { price, pickupSlots, pickupToday, LUNCH_PICKUP_DISCOUNT, round2 } from "../../lib/pricing.ts";
import type { State } from "../../lib/status.ts";
import { hourNote, stateBox, loadingText } from "../../lib/ui.ts";
import "sc-icons:arrow-clockwise,clock,globe,warning-circle"; /* the icons of the shared components it draws (lib/ui.ts) */
import type { Cart } from "../../lib/cart.ts";

/* ---------- hours and rules (from src/lib) ---------- */
const toMin = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
export const OPEN = toMin(R.open), CLOSE = toMin(R.close), KITCHEN_END = toMin(R.kitchen), DELIVERY_END = toMin(R.delivery), LUNCH_END = toMin(R.lunchUntil);
export const PCT = Math.round(LUNCH_PICKUP_DISCOUNT * 100);
/* a sample cart per kind, priced by the lib: the earliest time is "now + the kitchen lead" */
const LUNCH_ID = (lunch[0] || ({} as Dish)).id, TRAD_ID = (items.find((x) => !isOut(x)) || ({} as Dish)).id;
export type Kind = "lunch" | "menu" | "both";
function sample(kind: Kind): Cart {
  const ids = kind === "lunch" ? [LUNCH_ID] : kind === "menu" ? [TRAD_ID] : [LUNCH_ID, TRAD_ID];
  return { mode: "pickup", lines: ids.filter(Boolean).map((id) => ({ key: id, id, q: 1, mods: [], extra: 0 })) };
}
const leadOf = (kind: Kind) => Math.max(0, price(sample(kind), { clock: OPEN }).earliest - OPEN);
export const LEAD = leadOf("menu");
const probe = pickupSlots({ earliest: OPEN, mode: "pickup" }, OPEN);
export const STEP = probe.length > 1 ? probe[1] - probe[0] : 15;
export const AHEAD = probe.length ? probe[probe.length - 1] - OPEN : 180;
const K = R.kitchen, L = R.lunchUntil, D = R.delivery;

export const hm = (t: number) => hhmm(((t % 1440) + 1440) % 1440);
export function dur(min: number): string { const h = Math.floor(min / 60), m = min % 60; return (h ? h + " ч" : "") + (h && m ? " " : "") + (m ? m + " мин" : ""); }
/** Lunch price after 15:00 for pickup (same rounding as price()). */
export const off = (p: number) => round2(p - Math.round(p * PCT) / 100);
const aheadText = () => (AHEAD % 60 ? dur(AHEAD) : AHEAD / 60 + " часа");
/** Tomorrow's weekday in Sofia ("сряда"). */
export function tomorrowName(d: Date = new Date()): string {
  let ymd: string;
  try { ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d); } catch { ymd = d.toISOString().slice(0, 10); }
  const [y, m, dd] = ymd.split("-").map(Number);
  return DAYS[(new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 1) % 7];
}

/* ---------- the live plan ("Кога ще е готово?") ---------- */
export type Sim = "normal" | "loading" | "busy" | "offline" | "error";
export interface Slot { t: number; full: boolean }
export interface Plan { kind: Kind; day: "today" | "tomorrow"; asap: number; now: boolean; slots: Slot[]; closedToday: boolean; early: boolean; busy: boolean }

/** busy = the kitchen switch "Натоварено" (SC.eta().busy) or "Пълна кухня" in the preview panel. */
export function plan(kind: Kind, s: State, busy: boolean): Plan {
  const m = s.m, lead = leadOf(kind);
  let day: Plan["day"] = "today", base: number;
  if (m < OPEN) base = OPEN;
  /* the one pickup rule (lib/pricing.ts pickupToday, decision 12.11.2026): orders until 22:30, ready at the latest at 23:00 */
  else if (pickupToday({ earliest: m + lead, mode: "pickup" }, m).ok) base = m;
  else { day = "tomorrow"; base = OPEN; }
  const start = base + lead, asap = lead ? Math.ceil(start / 5) * 5 : start, b = busy && day === "today";
  const slots = pickupSlots({ earliest: asap, mode: "pickup" }, base).map((t) => ({ t, full: b && t < m + 60 }));
  return { kind, day, asap, now: lead === 0 && day === "today" && m >= OPEN, slots, closedToday: day === "tomorrow", early: m < OPEN, busy: b };
}

/* ---------- CTA (one main action; the script sets SC.cart.mode("pickup") on click) ---------- */
export interface CtaView { n: number; total: number; kind: Kind; later: boolean }
export function cta(v: CtaView | null): { href: string; label: string } {
  /* after the kitchen closes the alert above says "Поръчайте за утре": the button says the same, also with a full cart */
  if (v && v.n) return { href: url.cart(), label: (v.later ? "Поръчай за утре · " : "Вземи от място · ") + fmt(v.total) };
  return { href: v && v.kind === "lunch" ? url.lunch() : url.menu(), label: v && v.later ? "Поръчай за утре" : "Поръчай за вземане" };
}
export function ctaHTML(cls: string, v: CtaView | null): string {
  const c = cta(v), go = cls.indexOf("go") > -1;
  return '<a class="pill pill-red ' + cls + '" href="' + c.href + '" data-pickup-go><span>' + c.label + "</span>" + (go ? '<span class="knob">' + ic("arrow-right", 22) + "</span>" : ic("arrow-right", 20)) + "</a>";
}

/* ---------- hero alert (browser only: it needs the hour) ---------- */
export function alertHTML(s: State): string {
  const m = s.m;
  /* the one hour note of the site (lib/ui.ts) */
  if (m < OPEN) return hourNote(s, { more: "Можете да изберете час за днес още сега." });
  if (!s.kitchen) return hourNote(s, { more: "Можете да поръчате сега за утре." });
  if (!s.delivery) return hourNote(s, { more: "-" + PCT + "% на обедното меню още важи." });
  if (s.lunchDiscount) return '<div class="pk-alert ember">' + ic("seal-percent", 22) + "<span><b>Сега: -" + PCT + "% на обедното меню</b> при вземане, до " + K + '. <a href="#deal">Как става</a></span></div>';
  return "";
}

/* ---------- live card ---------- */
export interface LiveView { kind: Kind; s: State | null; sim: Sim; busy: boolean; chosen: number | null; fromCart: boolean; tomorrow: string }

function nowLine(s: State | null): string {
  if (!s) return '<span class="pk-now" data-now></span>';
  const cls = s.kitchen ? (s.delivery ? "" : "warn") : "off";
  return '<span class="pk-now" data-now><span class="dot ' + cls + '"></span>Сега ' + hm(s.m) + "</span>";
}
function segHTML(kind: Kind): string {
  const o: [Kind, string, string][] = [["lunch", "Обедно меню", "веднага"], ["menu", "Меню", LEAD + " мин"], ["both", "И двете", LEAD + " мин"]];
  return '<div class="seg pk-seg" role="group" aria-label="Какво ще поръчате?">' + o.map((x) => '<button type="button" data-kind="' + x[0] + '" aria-pressed="' + (kind === x[0]) + '">' + x[1] + "<small>" + x[2] + "</small></button>").join("") + "</div>";
}
function resultHTML(p: Plan, s: State, chosen: number | null, tomorrow: string): string {
  let big: string, sub: string;
  const dayWord = p.day === "tomorrow" ? "утре " : "";
  if (chosen != null) big = "<small>" + (p.day === "tomorrow" ? "утре в" : "в") + "</small>" + hm(chosen);
  else if (p.now) big = "веднага";
  else if (p.kind === "lunch") big = "<small>" + (dayWord || "днес ") + "в</small>" + hm(p.asap);
  else big = "<small>" + dayWord + "около</small>" + hm(p.asap);
  if (p.closedToday && s.m >= OPEN && s.kitchen && p.kind !== "lunch") sub = "За днес не стигаме: ястията от менюто са готови най-рано след " + LEAD + " минути, а кухнята приема до " + K + ". Изберете час за утре, " + tomorrow + ".";
  else if (p.closedToday) sub = "Кухнята приема поръчки до " + K + ". Изберете час за утре, " + tomorrow + ".";
  else if (p.early) sub = "Отваряме в " + R.open + ". " + (p.kind === "lunch" ? "Обедното меню е готово от отварянето." : "Ястията от менюто са готови най-рано в " + hm(OPEN + LEAD) + ".");
  else if (p.kind === "lunch") sub = "Обедното меню е готово веднага. <b>Минете, когато ви е удобно</b>, до " + K + ".";
  else if (p.kind === "both") sub = "Поръчката е готова, когато е готово и последното ястие: <b>най-рано след " + LEAD + "&nbsp;минути</b>.";
  else sub = "Ястията от менюто се приготвят на момента: <b>най-рано след " + LEAD + "&nbsp;минути</b>.";
  const tag = p.kind !== "menu" && s.lunchDiscount && p.day === "today" ? '<span class="pk-tag">' + ic("seal-percent", 16) + "-" + PCT + "% на обедното, смята се само</span>" : "";
  const busy = p.busy ? '<div class="pk-busy">' + ic("warning", 20) + "<span>Кухнята е натоварена. Най-близките часове са заети.</span></div>" : "";
  return '<div class="pk-res" aria-live="polite"><span class="lbl">Готово</span><span class="pk-big" data-big>' + big + "</span><p>" + sub + "</p>" + tag + busy + "</div>";
}
/* error / no connection: the shared box (lib/ui.ts), same title words and buttons as on every page */
function errHTML(type: "wifi" | "err", text: string): string {
  return stateBox({ kind: type === "wifi" ? "offline" : "error", what: "свободните часове", text, h: "h3" });
}
const skeletonHTML = () => '<div class="pk-pick">Или изберете час<span>Проверяваме кухнята</span></div><div class="pk-asap skel" style="box-shadow:none" aria-hidden="true"></div><div class="pk-slots" aria-busy="true">' + '<span class="skel"></span>'.repeat(8) + '</div><span class="vh" role="status">' + loadingText("свободните часове") + "</span>";
function slotsHTML(p: Plan, chosen: number | null, tomorrow: string): string {
  const asapLabel = p.now ? "Веднага" : p.kind === "lunch" ? (p.day === "tomorrow" ? "Утре в " : "В ") + hm(p.asap) : p.day === "tomorrow" ? "Утре, най-рано" : "Възможно най-скоро";
  const asapRight = p.now || p.kind === "lunch" ? "" : "около " + hm(p.asap);
  return '<div class="pk-pick">Или изберете час<span>' + (p.day === "tomorrow" ? "утре, " + tomorrow : "днес") + "</span></div>" +
    '<button class="pk-asap" type="button" data-slot="asap" aria-pressed="' + (chosen == null) + '"><span>' + asapLabel + '</span><span class="price">' + asapRight + "</span></button>" +
    (p.slots.length ? '<div class="pk-slots" role="group" aria-label="Часове за вземане">' + p.slots.map((x) => x.full
      ? '<button class="pk-slot" type="button" disabled aria-label="' + hm(x.t) + ', зает час: пълна кухня">' + hm(x.t) + "<small>заето</small></button>"
      : '<button class="pk-slot" type="button" data-slot="' + x.t + '" aria-pressed="' + (chosen === x.t) + '">' + hm(x.t) + "</button>").join("") + "</div>" +
      (p.slots.some((x) => x.full) ? '<div class="pk-legend"><span><i></i>Свободен час</span><span><i class="full"></i>Заето: пълна кухня</span></div>' : "") : "") +
    (chosen != null ? '<p class="pk-chosen">' + ic("check-circle", 20) + "Запазихме " + hm(chosen) + ". Ще го видите в количката.</p>" : "");
}
/** The inside of the live card. Without a state (server) it is the "loading" skeleton. */
export function liveHTML(v: LiveView): string {
  const s = v.s, sim = s ? v.sim : "loading", p = s ? plan(v.kind, s, v.busy) : null;
  const res = p && s && sim !== "offline" && sim !== "error" ? resultHTML(p, s, v.chosen, v.tomorrow) : "";
  const body = sim === "loading" || !p ? skeletonHTML()
    : sim === "offline" ? errHTML("wifi", "")
    : sim === "error" ? errHTML("err", "")
    : slotsHTML(p, v.chosen, v.tomorrow);
  return '<div class="pk-lh"><h2 class="h3" id="pk-live-h">Кога ще е готово?</h2>' + nowLine(s) + "</div>" +
    '<p class="pk-q">Какво ще поръчате?</p>' + segHTML(v.kind) +
    (v.fromCart ? '<p class="pk-fromcart">' + ic("shopping-bag", 18) + "Избрахме според количката ви</p>" : "") +
    '<div class="pk-perf" aria-hidden="true"></div>' + res + body;
}

/* ---------- -30% card ---------- */
export const DEAL_IDS = ["l-pile-chetiri-sirena-s-kartofeno-pyure", "l-lazanya-boloneze", "l-svezha-s-pile-i-parmezan"];
export interface DealView { s: State | null; isToday: boolean; orderable: boolean }
export function dealHTML(v: DealView): string {
  const s = v.s, m = s ? s.m : -1;
  let when: string;
  if (!s) when = "Всеки ден от " + L + " до " + K;
  else if (s.lunchDiscount) when = "Важи сега · до " + K;
  else if (s.kitchen && m < LUNCH_END) when = "Започва в " + L + " · след " + dur(LUNCH_END - m);
  else if (m < OPEN) when = "Днес от " + L + " до " + K;
  else when = "Утре от " + L + " до " + K;
  const active = !!s && s.lunchDiscount;
  const ex = DEAL_IDS.map((id) => byId[id]).filter(Boolean);
  const rows = ex.map((x) => {
    const pr = active
      ? '<span class="price">' + fmt(off(x.p)) + '</span><span class="old price">' + fmt(x.p) + "</span>"
      : '<span class="price">' + fmt(x.p) + '</span><span class="after">след ' + L + ': <span class="price">' + fmt(off(x.p)) + "</span></span>";
    return '<div class="pk-ex" role="listitem">' + pic(x) + '<span><span class="nm">' + esc(x.n) + '</span><span class="pr">' + pr + "</span></span>" + (v.orderable ? plusBtn(x) : "<span></span>") + "</div>";
  }).join("");
  const first = ex[0];
  return '<div class="ember-card pk-deal"><span class="pk-when">' + ic("clock", 16) + when + "</span>" +
    '<div><span class="pct" aria-hidden="true">-' + PCT + '%</span><h2 class="h2" id="pk-deal-h">на обедното меню след ' + L + '</h2><p style="margin-top:10px">Само при вземане от място. След ' + L + " обедното меню не се доставя.</p></div>" +
    (v.isToday ? "" : '<p class="pk-sample">' + ic("info", 20) + "<span>Обедното меню се качва всяка сутрин. Пример за цените:</span></p>") +
    '<div class="core" role="list" aria-label="' + (v.isToday ? "Примери от днешното обедно меню" : "Примери от обедното меню") + '">' + rows + "</div>" +
    (first ? '<p class="foot-note">' + ic("info", 20) + "<span>Отстъпката се смята сама в количката, без код. Например: „Отстъпка след " + L + ": -" + fmt(round2(first.p - off(first.p))) + "“.</span></p>" : "") +
    '<a class="pill pill-ink" href="' + url.lunch() + '">' + ic("bowl-food", 20) + "Виж цялото обедно меню</a></div>";
}

/* ---------- hours timeline (pickup / lunch / delivery) with the "now" marker ---------- */
const pct = (t: number) => (((t - OPEN) / (CLOSE - OPEN)) * 100).toFixed(2) + "%";
export function hoursHTML(s: State | null): string {
  const m = s ? s.m : -1, inDay = !!s && m >= OPEN && m < CLOSE;
  const nowCls = m - OPEN < 90 ? "l" : CLOSE - m < 120 ? "r" : "", mark = inDay ? '<span class="pk-mark" style="left:' + pct(m) + '" aria-hidden="true"></span>' : "";
  return '<div class="pk-sh"><span class="pk-kicker">' + ic("clock", 18) + 'Всеки ден</span><h2 class="h2" id="pk-hours">Часове за вземане</h2><p class="lead">Ресторантът е отворен ' + R.open + " - " + R.close + ". За вземане приемаме поръчки до " + K + ".</p></div>" +
    '<div class="shell"><div class="core" aria-labelledby="pk-hours">' +
      '<div class="pk-tl">' +
        (inDay ? '<span class="pk-flag ' + nowCls + '" style="left:' + pct(m) + '" aria-hidden="true">Сега ' + hm(m) + "</span>" : "") +
        '<div class="pk-lane"><div class="t">Вземане от място<span>' + R.open + " - " + K + '</span></div><div class="pk-track"><span class="pk-fill ink" style="width:' + pct(KITCHEN_END) + '"></span>' + mark + "</div></div>" +
        '<div class="pk-lane"><div class="t">Обедно меню<span>' + R.open + " - " + L + '</span></div><div class="pk-track"><span class="pk-fill soft" style="width:' + pct(LUNCH_END) + '"></span><span class="pk-fill emb" style="left:' + pct(LUNCH_END) + ";width:calc(" + pct(KITCHEN_END) + " - " + pct(LUNCH_END) + ')"></span>' + mark + "</div>" +
          '<div class="pk-key"><span><i class="soft"></i>' + R.open + " - " + L + ': доставка или вземане</span><span><i class="emb"></i>после до ' + K + ": само вземане, -" + PCT + "%</span></div></div>" +
        '<div class="pk-lane"><div class="t">Доставка<span>' + R.open + " - " + D + '</span></div><div class="pk-track"><span class="pk-fill dim" style="width:' + pct(DELIVERY_END) + '"></span>' + mark + "</div></div>" +
        '<div class="pk-axis" aria-hidden="true"><span>' + R.open + "</span><span>" + R.close + "</span></div>" +
      "</div>" +
      '<div class="pk-facts">' +
        '<div class="kv"><span>Обедно меню</span><b>готово веднага</b></div>' +
        '<div class="kv"><span>Ястия от менюто</span><b>след ' + LEAD + " мин</b></div>" +
        '<div class="kv"><span>Час по избор</span><b>през ' + STEP + " мин</b></div>" +
        '<div class="kv"><span>Поръчка за по-късно</span><b>до ' + aheadText() + " напред</b></div>" +
        '<div class="kv"><span>Последна поръчка</span><b>' + K + "</b></div>" +
      "</div>" +
    "</div></div>";
}

/* ---------- FAQ (server HTML + FAQPage JSON-LD; no [ЛИПСВА] in the answers) ---------- */
export const FAQ: [string, string][] = [
  ["Колко време ще чакам?", "Обедното меню е готово веднага. Ястията от менюто са готови най-рано след " + LEAD + " минути. Ако поръчате и от двете, най-ранният час е след " + LEAD + " минути."],
  ["Мога ли да избера по-късен час?", "Да. Часовете са през " + STEP + " минути, до " + aheadText() + " напред, но не след " + K + ". Ако кухнята е пълна в даден час, той е неактивен и виждате това преди да поръчате."],
  ["Как се смята -" + PCT + "% на обедното меню?", "След " + L + " отстъпката се прилага сама в количката, без код. Важи само за ястията от обедното меню и само при вземане от място."],
  ["Трябва ли ми профил?", "Не. Достатъчни са име и телефон. С профил получавате -10% от следващата поръчка."],
  ["Доставката приключи. Мога ли още да поръчам?", "Да. Доставката е до " + D + ", а за вземане приемаме поръчки до " + K + "."],
];
export const faqHTML = () => FAQ.map((f) => "<details><summary>" + f[0] + '<span class="cv">' + ic("caret-down", 20) + "</span></summary><p>" + f[1] + "</p></details>").join("");

export const STEPS_TEXT = { step2: "Възможно най-скоро или точен час, през " + STEP + " минути, до " + aheadText() + " напред." };
export const DESCRIPTION = "Поръчайте онлайн и вземете от Siracusa в Дружба 2. Обедното меню е готово веднага, ястията от менюто след " + LEAD + " минути. След " + L + " обедното меню е с -" + PCT + "%.";
export const LEAD_TEXT = "Поръчайте онлайн и минете да вземете поръчката си. Обедното меню е готово веднага, ястията от менюто - най-рано след " + LEAD + " минути.";

/** JSON-LD: BreadcrumbList + FAQPage. */
export function pickupLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  return [
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) },
      { "@type": "ListItem", position: 2, name: "Вземи от място", item: abs(url.page("pickup")) },
    ] },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((q) => ({ "@type": "Question", name: q[0], acceptedAnswer: { "@type": "Answer", text: q[1] } })) },
  ];
}
