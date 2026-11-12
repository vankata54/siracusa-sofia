/* Delivery page (/dostavka/): HTML pieces shared by the server (index.astro frontmatter) and the browser (its script).
   Port of design/pages/delivery.html (design/PAGES.md "delivery.html", decisions 18-21, BRIEF 8).
   Pure string renderers, no DOM, no menu. Zones, times and fees only from ZONES (lib/consts.ts) and lib/zones.ts:
   the fees for Горубляне and Гара Искър are null there, so they are drawn as [ЛИПСВА]. Everything that depends on the
   hour, "Натоварено" or the cart takes a View: the server draws a neutral view (delivery open, no "now" marker),
   the browser redraws with SC.state(), SC.eta() and the cart. */
import { payAnswer, payAnswerText } from "../../lib/pay.ts";
import { ZONES, RESTAURANT, type Zone } from "../../lib/consts.ts";
import type { State } from "../../lib/status.ts";
import type { AddressResult } from "../../lib/zones.ts";
import { zoneMin } from "../../lib/zones.ts";
import { ic, ICONS } from "../../lib/icons.ts";
import { esc, fmt } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
/* icons this module draws (registered for SC.ic in the browser; the server has them all) */
import "sc-icons:moped,map-pin,map-pin-line,map-trifold,magnifying-glass,check,check-circle,receipt,money,credit-card,ticket,gift,info,phone,caret-down,storefront,arrow-right,tag,question,warning-circle,clock,moon,fork-knife,x"; /* the icons of this page in one module (scripts/icon-groups.mjs) */

const R = RESTAURANT;
export const MISS_FEE = "[ЛИПСВА: такса в €]";
export const MISS_MIN = "[ЛИПСВА: минимална поръчка]";
const TEL = "tel:" + R.phoneIntl;

export interface View {
  S: State;
  /** "Натоварено" (the manual switch in the kitchen, SC.eta().busy) */
  busy: boolean;
  /** minutes added to every zone while busy (lib/status.ts busyExtra(), default 20) */
  extra: number;
  /** items in the cart (count, subtotal) or null */
  cart: { n: number; sub: number } | null;
  /** the server does not know the hour: no "Сега" marker, no sentence about now */
  server?: boolean;
}

/* ---------- zones: data from ZONES, shapes are a stylised schematic (not to scale, no streets) ---------- */
interface Shape { d: string; lx: number; ly: number; two?: [string, string] }
const SHAPES: Record<string, Shape> = {
  "gara-iskar": { d: "M24 92 L112 100 L124 156 L110 214 L44 206 L16 150 Z", lx: 66, ly: 146, two: ["Гара", "Искър"] },
  "npz-iskar": { d: "M114 34 L212 26 L236 66 L226 110 L156 114 L112 100 Z", lx: 172, ly: 76 },
  "druzhba-1": { d: "M112 100 L156 114 L226 110 L236 166 L214 214 L110 214 L124 156 Z", lx: 172, ly: 168 },
  "druzhba-2": { d: "M236 66 L304 72 L330 116 L314 206 L214 214 L236 166 L226 110 Z", lx: 274, ly: 116 },
  "busmantsi": { d: "M330 116 L398 132 L404 196 L362 232 L314 206 Z", lx: 360, ly: 180 },
  "gorublyane": { d: "M150 236 L304 226 L330 266 L290 294 L176 294 L140 266 Z", lx: 236, ly: 268 },
};
/** Siracusa: Дружба 2, срещу бл. 311 (the position on the schematic is approximate) */
export const PIN = { x: 272, y: 168 };
export const BY_SLUG: Record<string, Zone> = {};
ZONES.forEach((z) => { BY_SLUG[z.slug] = z; });
/** free zones first, then the paid ones */
export const ORDER: Zone[] = ZONES.filter((z) => z.free).concat(ZONES.filter((z) => !z.free));
const FREE_NAMES = ZONES.filter((z) => z.free).map((z) => z.n);
const PAID_NAMES = ZONES.filter((z) => !z.free).map((z) => z.n);
const and = (a: string[]) => (a.length > 1 ? a.slice(0, -1).join(", ") + " и " + a[a.length - 1] : a.join(""));

/* ---------- times: one rule with the cart (the quarter's minutes, + busyExtra() while "Натоварено") ---------- */
export const etaMin = (z: Zone, v: View): number => zoneMin(z) + (v.busy ? v.extra : 0);
const NB = " ";
export function etaRange(v: View): string { const a = ZONES.map((z) => etaMin(z, v)); return Math.min(...a) + " - " + Math.max(...a) + NB + "мин"; }
function etaRangeBase(): string { const a = ZONES.map(zoneMin); return Math.min(...a) + " до " + Math.max(...a) + " минути"; }
export const etaText = (z: Zone, v: View): string => "около " + etaMin(z, v) + NB + "мин";
const feeText = (z: Zone): string => (z.free ? "Безплатно" : z.fee != null ? fmt(z.fee) : MISS_FEE);
/** every paid zone has its fee in the data: only then can the cart show it (otherwise [ЛИПСВА]) */
const FEES_KNOWN = ZONES.every((z) => z.free || z.fee != null);

/* ---------- what can be done right now ---------- */
interface Action { label: string; href: string; mode: "delivery" | "pickup"; note?: string }
export function action(z: Zone | null, v: View): Action {
  const S = v.S;
  if (S.delivery) {
    if (v.cart && v.cart.n) return { label: "Към количката · " + fmt(v.cart.sub), href: url.cart(), mode: "delivery" };
    return { label: z ? (z.free ? "Поръчай с безплатна доставка" : "Поръчай с доставка") : "Поръчай с доставка", href: url.menu(), mode: "delivery" };
  }
  if (S.kitchen) return { label: "Вземи от място до 22:30", href: url.page("pickup"), mode: "pickup", note: "Доставката приключи за днес. Утре доставяме от 10:00." };
  if (S.m < 600) return { label: "Разгледай менюто", href: url.menu(), mode: "delivery", note: "Доставката започва в 10:00. Можете да изберете отсега." };
  return { label: "Поръчай за утре", href: url.menu(), mode: "delivery", note: "Кухнята приема поръчки до 22:30. Утре доставяме от 10:00." };
}
const ctaHTML = (a: Action): string =>
  '<a class="pill pill-red pill-lg pill-block" href="' + a.href + '" data-mode="' + a.mode + '">' + esc(a.label) + ic("arrow-right", 20) + "</a>";

/* ---------- hero: live line ---------- */
export function liveHTML(v: View): string {
  const S = v.S;
  if (S.delivery) return v.busy
    ? '<span class="dot warn"></span><span><b>Натоварено</b> · ' + etaRange(v) + "</span>"
    : '<span class="dot ok"></span><span><b>Доставка сега</b> · ' + etaRange(v) + "</span>";
  if (S.kitchen) return '<span class="dot warn"></span><span><b>Утре доставяме от 10:00</b> · днес вземане до 22:30</span>';
  return '<span class="dot"></span><span><b>Сега не доставяме</b> · ' + (S.m < 600 ? "днес" : "утре") + " от 10:00</span>";
}

export const LEAD = "Безплатно до Дружба 1 и 2, НПЗ Искър и Бусманци. До Горубляне и Гара Искър по тарифа. Всеки ден от 10:00 до 21:00.";

export function checkHTML(): string {
  return '<div class="chk shell" id="proverka"><div class="core">' +
    '<h2 id="chkT">Доставяте ли до мен?</h2><p class="sub">Напишете квартала си. Отговаряме веднага: време, такса и минимална поръчка.</p>' +
    '<form data-chk novalidate><div class="field"><label for="adr">Вашият квартал</label>' +
    '<div class="inwrap">' + ic("map-pin", 22) + '<input class="input" id="adr" name="adr" type="text" autocomplete="street-address" placeholder="Например: Дружба 2" aria-describedby="adrHelp adrErr"><button class="clr" type="button" data-clear aria-label="Изчисти адреса" hidden>' + ic("x", 20) + "</button></div>" +
    '<span class="help" id="adrHelp">Достатъчно е да напишете квартала. Може и на латиница.</span><span class="err" id="adrErr" role="alert"></span></div>' +
    '<button class="pill pill-ink pill-lg" type="submit">' + ic("magnifying-glass", 20) + "Провери адреса</button></form>" +
    '<div class="res" data-res aria-live="polite"></div>' +
    "</div></div>";
}

/* ---------- map SVG ---------- */
export function mapSVG(): string {
  let dots = "";
  for (let y = 14; y < 300; y += 22) for (let x = 12; x < 420; x += 22) dots += '<circle class="grid-dot" cx="' + x + '" cy="' + y + '" r="1.3"/>';
  const zones = ZONES.map((z) => {
    const s = SHAPES[z.slug];
    const label = s.two ? '<text class="zl" x="' + s.lx + '" y="' + (s.ly - 4) + '">' + s.two[0] + '</text><text class="zl" x="' + s.lx + '" y="' + (s.ly + 16) + '">' + s.two[1] + "</text>"
      : '<text class="zl" x="' + s.lx + '" y="' + (s.ly + 6) + '">' + esc(z.n) + "</text>";
    return '<g class="z ' + (z.free ? "free" : "paid") + '" data-zone="' + z.slug + '"><path class="f" d="' + s.d + '"/>' + (z.free ? "" : '<path class="h" d="' + s.d + '"/>') + '<path class="sel" d="' + s.d + '"/>' + label + "</g>";
  }).join("");
  return '<svg class="map" viewBox="0 0 420 304" role="img" aria-labelledby="mapT mapD">' +
    '<title id="mapT">Схема на зоните за доставка</title><desc id="mapD">Безплатна доставка: ' + and(FREE_NAMES) + ". По тарифа: " + and(PAID_NAMES) + ". Ресторантът е в Дружба 2, мястото на схемата е приблизително. Същото е описано в таблицата под картата.</desc>" +
    '<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.2" height="7" style="fill:var(--z-hatch)"/></pattern></defs>' +
    dots +
    '<g class="air" aria-hidden="true"><path d="M246 6 L414 6 L414 112 L344 110 L314 60 L248 52 Z"/><text x="352" y="44">Летище</text><text x="352" y="62">София</text></g>' +
    '<path class="edge" d="M10 86 L108 26 L240 18 L310 64 L340 106 L410 124 L414 202 L366 244 L336 270 L296 302 L170 302 L132 270 L144 228 L104 222 L38 214 L8 150 Z"/>' +
    zones +
    '<path class="route" data-route d=""/>' +
    '<g class="rider" data-rider aria-hidden="true" style="transform:translate(' + PIN.x + "px," + PIN.y + 'px)"><g transform="translate(-15,-15)"><circle cx="15" cy="15" r="15"/><svg class="rico" x="5" y="5" width="20" height="20" viewBox="0 0 256 256" fill="currentColor">' + (ICONS["moped"] || "") + "</svg></g></g>" +
    '<g class="pin" aria-hidden="true"><circle class="ring" cx="' + PIN.x + '" cy="' + PIN.y + '" r="16"/><circle class="dotp" cx="' + PIN.x + '" cy="' + PIN.y + '" r="9"/>' +
    '<g class="tag"><rect x="' + (PIN.x - 40) + '" y="' + (PIN.y + 16) + '" width="80" height="26" rx="13"/><text x="' + PIN.x + '" y="' + (PIN.y + 33.5) + '">Siracusa</text></g></g>' +
    "</svg>";
}
/** where the rider stops for a zone (above its label) */
export function riderTarget(z: Zone): { x: number; y: number } {
  const s = SHAPES[z.slug];
  if (z.slug === "druzhba-2") return { x: s.lx, y: s.ly - 30 };
  return { x: s.lx, y: s.ly + (s.two ? -38 : -26) };
}

/* ---------- fees table (also the list alternative to the map) ---------- */
export function feesHTML(v: View): string {
  return '<table class="fees"><caption>Такси и време по квартали</caption><thead><tr><th scope="col">Квартал</th><th scope="col">Доставка</th></tr></thead><tbody>' +
    ORDER.map((z) => '<tr data-row="' + z.slug + '"><th scope="row"><button class="zbtn" type="button" data-pick="' + z.slug + '" aria-pressed="false"><span class="sw ' + (z.free ? "free" : "paid") + '"></span><b>' + esc(z.n) + '</b><small data-eta="' + z.slug + '">' + etaText(z, v) + "</small></button></th>" +
      "<td" + (z.free || z.fee != null ? "" : ' class="missing"') + ">" + (z.free ? '<span class="okt">' + ic("check-circle", 20) + "Безплатно</span>" : feeText(z)) + "</td></tr>").join("") +
    '<tr class="outrow"><th scope="row"><span class="row"><span class="sw out"></span><b>Извън зоните</b></span></th><td>Не доставяме</td></tr>' +
    "</tbody></table>" +
    '<div class="minline">' + ic("receipt", 20) + '<span>Минимална поръчка: <span class="missing">' + MISS_MIN + "</span></span></div>";
}

/* ---------- selected zone card ---------- */
export function zoneCardHTML(z: Zone | null, v: View): string {
  const S = v.S;
  if (!z) return '<div class="zt"><h3 class="h3">Извън зоните</h3><span class="ztag out">' + ic("x", 16) + "Не доставяме</span></div>" +
    '<p class="note" style="margin-top:8px">Не доставяме до този адрес. Можете да я вземете от ресторанта.</p>' +
    '<div class="zbtns"><a class="pill pill-red pill-lg pill-block" href="' + url.page("pickup") + '" data-mode="pickup">' + ic("storefront", 20) + 'Вземи от място</a><a class="pill pill-line pill-block" href="' + TEL + '">' + ic("phone", 20) + "Наблизо сте? Обадете се</a></div>";
  const a = action(z, v), mins = etaMin(z, v);
  const time = !S.delivery ? '<span class="busy idle">около ' + mins + NB + 'мин<small class="muted">' + (S.m < 600 ? "днес от 10:00" : "утре от 10:00") + "</small></span>"
    : v.busy ? '<span class="busy">около ' + mins + NB + "мин<small>натоварено сега</small></span>" : "около " + mins + NB + "мин";
  return '<div class="zswap"><div class="zt"><h3 class="h3">' + esc(z.n) + "</h3>" + (z.free ? '<span class="ztag free">' + ic("check", 16) + "Безплатна доставка</span>" : '<span class="ztag paid">' + ic("tag", 16) + "По тарифа</span>") + "</div>" +
    (z.slug === "druzhba-2" ? '<p class="here">' + ic("map-pin", 18) + "Тук сме: срещу бл. 311</p>" : "") +
    "<dl>" +
    '<div class="kv"><dt>Време до вас</dt><dd>' + time + "</dd></div>" +
    '<div class="kv"><dt>Такса</dt><dd' + (z.free || z.fee != null ? "" : ' class="missing"') + ">" + feeText(z) + "</dd></div>" +
    '<div class="kv"><dt>Минимална поръчка</dt><dd class="missing">[ЛИПСВА: сума в €]</dd></div>' +
    '<div class="kv"><dt>Днес</dt><dd>' + (S.delivery ? "до 21:00" : S.m < 600 ? "от 10:00 до 21:00" : "не доставяме") + "</dd></div>" +
    "</dl>" + ctaHTML(a) + (a.note ? '<p class="note">' + a.note + "</p>" : "") + "</div>";
}

/* ---------- hours timeline ---------- */
export function timelineHTML(v: View): string {
  const S = v.S, span = 780, pc = (min: number) => (min - 600) / span * 100;
  const rows: [string, string, string, number][] = [["Доставка", "10:00 - 21:00", "dlv", 1260], ["Обедно меню с доставка", "10:00 - 15:00", "lun", 900], ["Вземане от място", "10:00 - 22:30", "pk", 1350]];
  const m = S.m, inDay = !v.server && m >= 600 && m < 1380;
  const hh = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const pos = pc(m), side = pos < 12 ? " l" : pos > 88 ? " r" : "";
  let say: [string, string, string];
  if (S.delivery && S.lunch) say = ["ok", "check-circle", "Сега доставяме, включително обедното меню до 15:00."];
  else if (S.delivery) say = ["ok", "check-circle", "Сега доставяме до 21:00. Обедното меню след 15:00 е само за вземане от място (-30%)."];
  else if (S.kitchen) say = ["warn", "clock", "Доставката приключи за днес · Вземане до 22:30."];
  else if (m < 600) say = ["", "moon", "Сега сме затворени. Доставката започва в 10:00."];
  else say = ["", "moon", "Кухнята приема поръчки до 22:30. Утре доставяме от 10:00."];
  return '<div class="tl-body' + (inDay ? "" : " closed") + '">' + (inDay ? '<div class="now' + side + '" style="left:' + pos.toFixed(2) + '%" aria-hidden="true"><b>Сега ' + hh + "</b></div>" : "") +
    rows.map((r) => '<div class="tl-row"><div class="lab">' + r[0] + "<span>" + r[1] + '</span></div><div class="track" aria-hidden="true"><i class="' + r[2] + '" style="width:' + pc(r[3]).toFixed(2) + '%"></i>' + (inDay ? '<b class="tick" style="left:' + pos.toFixed(2) + '%"></b>' : "") + "</div></div>").join("") +
    '</div><div class="axis" aria-hidden="true"><span style="left:0">10:00</span><span style="left:' + pc(900).toFixed(2) + '%">15:00</span><span style="left:' + pc(1260).toFixed(2) + '%">21:00</span></div>' +
    (v.server ? "" : '<p class="tl-say ' + say[0] + '">' + ic(say[1], 20) + "<span>" + say[2] + "</span></p>");
}

/* ---------- payment ---------- */
export function payHTML(): string {
  return '<div class="pay rv">' +
    '<div class="card"><span class="pi">' + ic("money", 26) + "</span><div><h3>В брой</h3><p>Плащате на шофьора, когато получите поръчката.</p></div></div>" +
    '<div class="card"><span class="pi">' + ic("credit-card", 26) + '</span><div><h3>Карта при получаване</h3><p>Visa или Mastercard. <span class="missing">[ЛИПСВА: потвърждение, че шофьорът приема карти]</span></p></div></div>' +
    '<div class="card"><span class="pi">' + ic("ticket", 26) + '</span><div><h3>Ваучер</h3><p>Ваучери за храна. <span class="missing">[ЛИПСВА: името на ваучерите]</span></p></div></div>' +
    '<div class="card"><span class="pi">' + ic("gift", 26) + '</span><div><h3>Подаръчна карта</h3><p><span class="missing">[ЛИПСВА: приема ли се при доставка]</span></p></div></div>' +
    "</div>" +
    '<p class="paynote">' + ic("info", 20) + "<span>Онлайн плащане засега няма. Никой няма да ви поиска данни за карта предварително.</span></p>";
}

/* ---------- the one answer about payment (decision 12.11): src/lib/pay.ts ---------- */
export { payAnswer };
const plain = (h: string) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

/* ---------- FAQ (also FAQPage JSON-LD; ld = the answer for structured data, without [ЛИПСВА], null = left out) ---------- */
interface Faq { q: string; a: string; ld: string | null }
export const FAQ: Faq[] = [
  { q: "Колко струва доставката?",
    a: "До " + and(FREE_NAMES) + " доставката е безплатна. До " + and(PAID_NAMES) + " е по тарифа" +
      (FEES_KNOWN ? ": " + ZONES.filter((z) => !z.free).map((z) => esc(z.n) + " " + fmt(z.fee as number)).join(", ") + ". Таксата се вижда в количката, преди да поръчате." : ': <span class="missing">' + MISS_FEE + "</span>."),
    /* the cart can show the fee only once it is in the data; until then no promise about it */
    ld: "До " + and(FREE_NAMES) + " доставката е безплатна. До " + and(PAID_NAMES) + " е по тарифа." + (FEES_KNOWN ? " Таксата се вижда в количката, преди да поръчате." : "") },
  { q: "Има ли минимална поръчка?", a: '<span class="missing">' + MISS_MIN + "</span>", ld: null },
  { q: "До колко часа доставяте?", a: "Всеки ден от 10:00 до 21:00. След 21:00 можете да вземете поръчката от ресторанта до 22:30.", ld: "" },
  { q: "Доставяте ли обедното меню?", a: 'Да, до 15:00. След 15:00 обедното меню е само за вземане от място, с -30%. Вижте как работи <a class="link" href="' + url.page("pickup") + '">Вземи от място</a>.', ld: "" },
  { q: "Колко бързо пристига поръчката?", a: "Обикновено за " + etaRangeBase() + ", според квартала. Времето за всеки квартал е в таблицата по-горе. Когато кухнята е натоварена, виждате честното време в количката, още преди да поръчате.", ld: "" },
  { q: "Как ще разбера кога идва шофьорът?", a: "Следите поръчката на живо: приета, готви се, готова, на път. 10 минути преди пристигане ви пращаме известие по SMS, Viber или в браузъра, както изберете.", ld: "" },
  { q: "Как мога да платя?", a: payAnswer(), ld: payAnswerText() },
  { q: "Адресът ми не е в зоните. Какво да направя?", a: "Можете да вземете поръчката от ресторанта: " + esc(R.address) + '. Ако сте наблизо, обадете се на <a class="link" href="' + TEL + '">' + R.phone + "</a> и ще проверим.", ld: "" },
];
export function faqHTML(): string {
  return '<div class="faq-grid"><div class="faq-side"><h2 class="h2" id="faqH">Често задавани въпроси</h2><p class="lead">Не намерихте отговор? Обадете ни се, ще ви кажем.</p><a class="pill pill-line pill-lg" href="' + TEL + '">' + ic("phone", 20) + "Обади се · " + R.phone + "</a></div>" +
    '<div class="faq">' + FAQ.map((f, i) => '<details class="rv"' + (i === 0 ? " open" : "") + "><summary>" + f.q + '<span class="cv">' + ic("caret-down", 20) + '</span></summary><div class="ans"><p>' + f.a + "</p></div></details>").join("") + "</div></div>";
}

/* ---------- closing CTA ---------- */
export function endHTML(v: View): string {
  const S = v.S, a = action(null, v);
  const title = S.delivery ? "Доставяме днес до 21:00." : S.kitchen ? "Доставката приключи за днес." : S.m < 600 ? "Доставяме днес от 10:00." : "Утре доставяме от 10:00.";
  const lead = S.delivery ? "Изберете от менюто. Адресът, зоната и времето се виждат в количката, преди да поръчате."
    : S.kitchen ? "Утре доставяме от 10:00. Днес можете да вземете поръчката си от ресторанта до 22:30."
      : S.m < 600 ? "Разгледайте менюто отсега. Кухнята приема поръчки до 22:30." : "Кухнята приема поръчки до 22:30. Можете да изберете отсега.";
  return '<div><h2 class="h2">' + title + '</h2><p class="lead" style="margin-top:10px">' + lead + "</p></div>" +
    '<div class="btns"><a class="pill pill-red go" href="' + a.href + '" data-mode="' + a.mode + '">' + esc(a.label) + '<span class="knob">' + ic("arrow-right", 22) + "</span></a>" +
    (a.mode === "pickup" ? '<a class="pill pill-line pill-lg" href="' + url.menu() + '">' + ic("fork-knife", 20) + "Разгледай менюто</a>"
      : S.delivery ? '<a class="pill pill-line pill-lg" href="' + url.page("pickup") + '" data-mode="pickup">' + ic("storefront", 20) + "Вземи от място</a>" : "") + "</div>";
}

/* ---------- address check result ---------- */
export type CheckResult = AddressResult | { type: "offline" } | { type: "error" };
export function resultHTML(r: CheckResult, v: View): string {
  const S = v.S;
  if (r.type === "zone") {
    const z = r.zone, a = action(z, v), mins = etaMin(z, v);
    return '<div class="rcard ' + (z.free ? "free" : "paid") + '"><div class="rh"><span class="ri">' + ic(z.free ? "check" : "tag", 24) + "</span><div><h3>" + (z.free ? "Доставяме безплатно до " + esc(z.n) : "Доставяме до " + esc(z.n) + " по тарифа") + "</h3>" +
      (S.delivery ? "" : '<p class="muted">' + esc(a.note || "") + "</p>") + "</div></div>" +
      '<div class="rfacts">' + (S.delivery ? '<span class="fact">' + ic("clock", 18) + "около " + mins + NB + "мин" + (v.busy ? " · натоварено" : "") + "</span>" : "") +
      (z.free ? '<span class="fact">' + ic("moped", 18) + "Без такса</span>" : z.fee != null ? '<span class="fact">' + ic("moped", 18) + fmt(z.fee) + "</span>" : '<span class="fact missing">' + ic("moped", 18) + MISS_FEE + "</span>") +
      '<span class="fact missing">' + ic("receipt", 18) + MISS_MIN + "</span></div>" +
      ctaHTML(a) + '<a class="link" href="#karta" data-tomap>' + ic("map-trifold", 20) + "Виж " + esc(z.n) + " на картата</a></div>";
  }
  if (r.type === "ask") return '<div class="rcard"><div class="rh"><span class="ri">' + ic("question", 24) + "</span><div><h3>" + esc(r.q) + '</h3><p class="muted">Изберете, за да ви кажем точното време.</p></div></div>' +
    '<div class="ropts">' + r.opts.map((z) => '<button class="pill pill-line" type="button" data-ans="' + z.slug + '">' + esc(z.n) + "</button>").join("") + "</div></div>";
  if (r.type === "unknown" || r.type === "street") return '<div class="rcard"><div class="rh"><span class="ri">' + ic("map-pin-line", 24) + '</span><div><h3>Напишете квартала, например Дружба 2</h3><p class="muted">' + (r.type === "street" ? "По улица и блок още не можем да проверим. " : "") + "Или изберете квартала си:</p></div></div>" +
    '<div class="ropts">' + ORDER.map((z) => '<button class="pill pill-line" type="button" data-ans="' + z.slug + '">' + esc(z.n) + "</button>").join("") + '<button class="pill pill-line" type="button" data-ans="none">Моят квартал го няма</button></div></div>';
  if (r.type === "out") return '<div class="rcard out"><div class="rh"><span class="ri">' + ic("storefront", 24) + "</span><div><h3>Не доставяме до този адрес.</h3><p>Можете да я вземете от ресторанта: " + esc(R.address) + ".</p></div></div>" +
    '<a class="pill pill-red pill-lg pill-block" href="' + url.page("pickup") + '" data-mode="pickup">' + ic("storefront", 20) + "Вземи от място</a>" +
    '<p class="rnote">' + ic("phone", 18) + '<span>Наблизо сте? Обадете се на <a class="link tel" href="' + TEL + '">' + R.phone + "</a> и ще проверим.</span></p></div>";
  if (r.type === "offline") return '<div class="rcard err"><div class="rh"><span class="ri">' + ic("warning-circle", 24) + "</span><div><h3>Няма връзка.</h3><p>Адресът ви е запазен - опитайте пак.</p></div></div>" +
    '<button class="pill pill-ink pill-block" type="button" data-retry>' + ic("arrow-right", 20) + "Опитай пак</button></div>";
  if (r.type === "error") return '<div class="rcard err"><div class="rh"><span class="ri">' + ic("warning-circle", 24) + "</span><div><h3>Не успяхме да проверим адреса.</h3><p>Опитайте пак след малко или ни се обадете на " + R.phone + ".</p></div></div>" +
    '<button class="pill pill-ink pill-block" type="button" data-retry>' + ic("arrow-right", 20) + "Опитай пак</button></div>";
  return "";
}
export const LOADING_HTML = '<div class="skl" aria-label="Проверяваме адреса"><span class="skel" style="width:70%"></span><span class="skel" style="width:45%"></span><span class="skel" style="height:52px;border-radius:999px"></span></div>';

/* ---------- SEO: BreadcrumbList, FAQPage ---------- */
export function deliveryLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name: "Доставка", item: abs(url.page("delivery")) }],
  };
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: FAQ.filter((f) => f.ld !== null).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.ld || plain(f.a) } })),
  };
  return [crumbs, faq];
}
