/* Home page: the parts that depend on the hour, the date or the visitor. Pure string renderers (no DOM, no menu),
   used by index.astro on the server (first paint, SEO) and by its client script (redrawn with the real Sofia time).
   The "_" prefix keeps this file out of the routes. Port of the time logic in design/pages/home.html. */
import { ic } from "../lib/icons.ts";
import { esc, plural, MON, MONTHS, DAYS } from "../lib/format.ts";
import { url } from "../lib/routes.ts";
import { ZONES, RESTAURANT, type Zone } from "../lib/consts.ts";
import type { State, Eta } from "../lib/status.ts";
import type { SiteEvent } from "../lib/events.ts";

/* ---------- hero: "Поръчай" ---------- */
export function goHTML(st: State): string {
  let o: { t: string; s: string; pickup?: boolean };
  if (st.delivery) o = { t: "Поръчай", s: "Доставка или вземане от място" };
  else if (st.kitchen) o = { t: "Поръчай за вземане", s: "Вземане от място до 22:30", pickup: true };
  else o = { t: "Поръчай за утре", s: st.m < 600 ? "Отваряме в 10:00" : "Кухнята приема поръчки до 22:30" };
  return '<a class="pill pill-red go" data-go href="' + url.menu() + '"' + (o.pickup ? " data-pickup" : "") + '><span class="gol"><span>' + o.t + "</span><small>" + o.s + '</small></span><span class="knob">' + ic("arrow-right", 22) + "</span></a>";
}

/* ---------- hero: the lunch tile text ---------- */
export function lunchTileText(st: State, lunchToday: boolean): string {
  let sub: string;
  if (st.lunch) sub = lunchToday ? "<small>До 15:00 · с доставка</small>" : "<small>Качва се всяка сутрин</small>";
  else if (st.lunchDiscount) sub = '<small class="hot"><span>-30%</span>при вземане</small>';
  else sub = "<small>От 10:00 до 15:00</small>";
  return "<b>" + (lunchToday && st.open ? "Обедно меню днес" : "Обедно меню") + "</b>" + sub;
}

/* ---------- hero: "Доставка сега: около 35 мин" ---------- */
export function etaInner(st: State, eta: Eta): string {
  let dot: string, html: string;
  if (st.delivery && !eta.busy) { dot = "ok"; html = "<b>Доставка сега: " + eta.text + "</b>"; }
  else if (st.delivery) { dot = "warn"; html = "<b>Възможни са закъснения</b><span>Доставка сега: около " + eta.min + " мин</span>"; }
  else if (st.kitchen) { dot = "warn"; html = "<b>Доставката приключи</b><span>Вземане от място до 22:30</span>"; }
  else if (st.open) { dot = ""; html = "<b>Кухнята затвори</b><span>Доставка утре от 10:00</span>"; }
  else { dot = ""; html = "<b>Затворено</b><span>Доставка " + (st.m < 600 ? "днес" : "утре") + " от 10:00</span>"; }
  return '<span class="dot ' + dot + '"></span>' + ic("moped", 22) + '<span class="tx">' + html + "</span>" + ic("caret-right", 18);
}

/* ---------- promo banner ---------- */
export interface OfferLike { id: string; t: string; p: string; go: string; href: string }
const OFF_META: Record<string, [string, string]> = {
  lunch: ["До 15:00", "bowl-food"], lunchToday: ["Днес до 15:00", "bowl-food"], lunch30: ["След 15:00", "storefront"], tomorrow: ["Утре от 10:00", "clock"],
  greek: ["Събитие", "calendar-check"], birthday: ["Празник", "cake"], signup: ["За нов профил", "gift"],
};
/** One slide. `key` picks the eyebrow ("lunchToday" for the lunch slide when the lunch menu is for today). */
export function slideHTML(o: OfferLike, key: string = o.id): string {
  const m = OFF_META[key] || OFF_META[o.id] || ["Оферта", "seal-percent"];
  return '<article class="slide" data-oid="' + o.id + '" role="group" aria-roledescription="слайд">' +
    '<span class="sl-ic">' + ic(m[1], 180) + '</span><span class="sl-ey">' + m[0] + "</span><h2>" + esc(o.t) + '</h2><p data-op>' + esc(o.p) + "</p>" +
    '<a class="pill" href="' + o.href + '">' + esc(o.go) + ic("arrow-right", 20) + "</a></article>";
}
export function dotHTML(title: string, i: number): string {
  return '<button type="button" data-dot="' + i + '" aria-label="Оферта ' + (i + 1) + ": " + esc(title) + '"><span class="d"><i></i></span></button>';
}
/** Which first slide fits the hour: lunch (today / another day), -30% after 15:00, or "for tomorrow". */
export function firstOfferKey(st: State, lunchToday: boolean): string {
  return st.lunch ? (lunchToday ? "lunchToday" : "lunch") : st.lunchDiscount ? "lunch30" : "tomorrow";
}
/** "След 24 дни" / "Днес": the start of the Greek night text (the rest comes from offers()). */
export function greekLead(days: number): string { return days === 0 ? "Днес" : "След " + plural(days, "ден", "дни"); }

/* ---------- events ---------- */
function daysText(n: number): string { return n === 0 ? "Днес" : n === 1 ? "Утре" : "След " + n + " дни"; }
export function eventsHTML(evs: SiteEvent[], days: number): string {
  const list = evs.length
    ? evs.slice(0, 2).map((e) => {
      const d = e.date;
      return '<article class="card ev rv"><div class="cal" aria-hidden="true"><span class="m">' + MON[d.getMonth()] + "</span><b>" + d.getDate() + '</b><span class="wd">' + DAYS[d.getDay()].slice(0, 3) + "</span></div>" +
        '<div><span class="badge">' + ic("calendar-check", 16) + esc(e.cat) + '</span><h3 class="h3">' + esc(e.n) + "</h3>" +
        '<p class="when"><span>' + DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + " · " + e.time + '</span><span class="cd">' + ic("hourglass", 16) + daysText(days) + "</span></p>" +
        '<p class="txt">' + esc(e.text) + '</p><span class="missing">' + esc(e.note) + "</span>" +
        '<a class="pill pill-ink" href="' + url.event(e.id) + '">Запази място' + ic("arrow-right", 20) + "</a></div></article>";
    }).join("")
    : '<div class="empty card"><div class="ill">' + ic("calendar-blank", 40) + '</div><b>Скоро обявяваме следващото събитие.</b><a class="pill pill-line" href="' + url.events() + '">Уведоми ме</a></div>';
  return list +
    '<article class="card ev cel rv"><div class="ci" aria-hidden="true">' + ic("confetti", 36) + '</div><div><span class="tag-ember">' + ic("seal-percent", 16) + '-5% при ранна резервация</span><h3 class="h3">Празник при нас</h3>' +
    '<p class="txt">Рожден ден, кръщене, юбилей или фирмено парти. Изберете повод, брой гости и меню, а управителят ви изпраща оферта.</p>' +
    '<a class="pill pill-line" href="' + url.page("celebration") + '">Планирай празник' + ic("arrow-right", 20) + "</a></div></article>";
}

/* ---------- delivery: note when delivery is over ---------- */
export function deliveryNote(st: State): string {
  if (st.delivery) return "";
  return '<span class="dot"></span>' + (st.kitchen ? "Днес доставката приключи. Можете да вземете поръчката до 22:30." : "Доставяме отново " + (st.m < 600 ? "днес" : "утре") + " от 10:00");
}

/* ---------- address check (districts by name, Latin too) ---------- */
const LAT: [RegExp, string][] = [[/druzh?ba|drujba/g, "дружба"], [/busmant?s?i|busmanci/g, "бусманци"], [/gorubl[yji]?a?ne|gorubliane/g, "горубляне"], [/is[ku][ae]?r|iskyr/g, "искър"], [/\bnpz\b/g, "нпз"], [/\bgara\b/g, "гара"], [/mladost/g, "младост"], [/lyulin|ljulin/g, "люлин"]];
const OUT = /младост|люлин|център|лозенец|надежда|овча купел|студентски|обеля|слатина|гео милев|изток|изгрев|редута|сухата река|красно село|банишора|борово|витоша|бояна|дианабад|подуяне|левски|сердика|връбница|кремиковци|ботунец|казичене|кривина|мусагеница|павлово|хаджи димитър|кръстова вада|симеоново|полигона|яворов|стрелбище|манастирски|зона б|света троица|илинден|разсадника|западен парк|орландовци|малашевци|бенковски|требич|филиповци|гевгелийски|хиподрума|княжево|горна баня|бъкстон|драгалевци|бистрица|панчарево|герман|лозен|кладница/;
const zone = (slug: string) => ZONES.find((z) => z.slug === slug)!;
export function zoneOf(v: string): Zone | { n: string; free: true; eta: string } | "out" | null {
  v = " " + v.toLowerCase() + " ";
  LAT.forEach((r) => { v = v.replace(r[0], r[1]); });
  if (/гара\s*искър/.test(v)) return zone("gara-iskar");
  if (/нпз|искър/.test(v)) return zone("npz-iskar");
  if (/дружба\s*(1|i)\b/.test(v)) return zone("druzhba-1");
  if (/дружба\s*(2|ii)\b/.test(v)) return zone("druzhba-2");
  if (/дружба/.test(v)) return { n: "Дружба 1 и 2", free: true, eta: "около 25 - 30 мин" };
  if (/бусманци/.test(v)) return zone("busmantsi");
  if (/горубляне/.test(v)) return zone("gorublyane");
  if (OUT.test(v)) return "out";
  return null;
}
export interface CheckResult { c: "ok" | "paid" | "no" | "q"; html: string }
export function checkAddress(v: string, st: State, eta: Eta): CheckResult {
  const z = zoneOf(v);
  const when = st.delivery
    ? (eta.busy ? "Възможни са закъснения · около " + eta.min + " мин" : z && z !== "out" && z.eta ? z.eta[0].toUpperCase() + z.eta.slice(1) : "")
    : (st.kitchen ? "Днес доставката приключи. Утре доставяме от 10:00." : "Доставяме от 10:00 до 21:00.");
  const order = '<a class="pill pill-red" href="' + url.menu() + '">Поръчай' + ic("arrow-right", 20) + "</a>";
  const pickup = '<a class="pill pill-line" href="' + url.page("pickup") + '">' + ic("storefront", 20) + "Вземи от място</a>";
  let h: { c: CheckResult["c"]; i: string; t: string; p: string; a: string };
  if (z === "out") h = { c: "no", i: "warning-circle", t: "Не доставяме до този адрес.", p: "Можете да вземете поръчката от ресторанта в Дружба 2.", a: pickup };
  else if (!z) h = { c: "q", i: "question", t: "Не разпознахме квартала.", p: "Напишете го към адреса, например „Дружба 1, бл. 12“. Безплатно доставяме в Дружба 1 и 2, НПЗ Искър и Бусманци.", a: "" };
  else if (z.free) h = { c: "ok", i: "check-circle", t: z.n + ": безплатна доставка", p: when, a: st.delivery ? order : pickup };
  else h = { c: "paid", i: "map-pin", t: z.n + ": доставка по тарифа", p: 'Таксата се вижда в количката. <span class="missing">[ЛИПСВА: такса в €]</span>' + (when ? "<br>" + when : ""), a: st.delivery ? order : "" };
  return { c: h.c, html: ic(h.i, 24) + "<div><b>" + h.t + "</b>" + (h.p ? "<p>" + h.p + "</p>" : "") + h.a + "</div>" };
}

/* ---------- JSON-LD (only facts from RESTAURANT; rating and reviews are [ЛИПСВА]) ---------- */
export function restaurantLd(site: URL | undefined): Record<string, unknown> {
  const R = RESTAURANT, abs = (p: string) => new URL(p, site).href;
  const m = /^(.*),\s*(\d{4})\s+(.+)$/.exec(R.address); /* "ж.к. Дружба 2, срещу бл. 311, 1582 София" */
  const DAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return {
    "@context": "https://schema.org", "@type": "Restaurant", "@id": abs("/") + "#restaurant",
    name: R.name, url: abs("/"), telephone: R.phoneIntl, email: R.email,
    address: { "@type": "PostalAddress", streetAddress: m ? m[1] : R.address, postalCode: m ? m[2] : undefined, addressLocality: m ? m[3] : "София", addressCountry: "BG" },
    hasMenu: abs(url.menu()), acceptsReservations: true,
    openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: DAYS_EN, opens: R.open, closes: R.close }],
    sameAs: [R.social.facebook, R.social.instagram].filter(Boolean),
  };
}
