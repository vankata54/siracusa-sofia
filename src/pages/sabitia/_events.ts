/* Events page (/sabitia/): HTML pieces shared by the server (index.astro frontmatter) and the browser (its script).
   Port of design/pages/events.html (design/PAGES.md "events.html", decision 28: -5% only for a celebration).
   Pure string renderers, no DOM, no menu (the menu is only needed for the "Празник при нас" art, see _party.ts).
   Everything that depends on the date takes `today`: the server draws with the build date, the browser redraws
   with the date in Sofia. Real events come from events() / api.events(); the rest are honest "Скоро" cards. */
import { EVENT_CATS, RESTAURANT } from "../../lib/consts.ts";
import type { SiteEvent } from "../../lib/events.ts";
import { ic } from "../../lib/icons.ts";
import { esc, plural, MON, MONTHS, DAYS, DAYS_SHORT } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
/* icons this module draws (registered for SC.ic in the browser; the server has them all) */
import "../../lib/icons/music-notes.ts";
import "../../lib/icons/globe.ts";
import "../../lib/icons/confetti.ts";
import "../../lib/icons/cake.ts";
import "../../lib/icons/baby.ts";
import "../../lib/icons/heart.ts";
import "../../lib/icons/briefcase.ts";
import "../../lib/icons/star.ts";
import "../../lib/icons/balloon.ts";
import "../../lib/icons/users-three.ts";
import "../../lib/icons/calendar-blank.ts";
import "../../lib/icons/calendar-check.ts";
import "../../lib/icons/clock.ts";
import "../../lib/icons/ticket.ts";
import "../../lib/icons/users.ts";
import "../../lib/icons/caret-right.ts";
import "../../lib/icons/image.ts";
import "../../lib/icons/images.ts";
import "../../lib/icons/hourglass.ts";
import "../../lib/icons/bell.ts";
import "../../lib/icons/seal-percent.ts";
import "../../lib/icons/arrow-right.ts";
import "../../lib/icons/warning-circle.ts";
import "../../lib/icons/warning.ts";
import "../../lib/icons/phone.ts";
import "../../lib/icons/chat-circle-dots.ts";
import "../../lib/icons/info.ts";
import "../../lib/icons/check.ts";
import "../../lib/icons/pencil-simple.ts";
import "../../lib/icons/eye.ts";

/* ---------- categories ---------- */
export const PUBLIC = ["Жива музика", "Тематични вечери", "Празници"];
export const CATI: Record<string, string> = {
  "Жива музика": "music-notes", "Тематични вечери": "globe", "Празници": "confetti", "Рождени дни": "cake", "Кръщенета": "baby", "Юбилеи": "heart",
  "Фирмени партита": "briefcase", "Абитуриентски": "star", "Детски": "balloon", "Частни партита": "users-three",
};
export const SLUG: Record<string, string> = {
  "Жива музика": "zhiva-muzika", "Тематични вечери": "tematichni-vecheri", "Празници": "praznitsi", "Рождени дни": "rozhdeni-dni", "Кръщенета": "krashteneta",
  "Юбилеи": "yubilei", "Фирмени партита": "firmeni-partita", "Абитуриентски": "abiturientski", "Детски": "detski", "Частни партита": "chastni-partita",
};
export const BYSLUG: Record<string, string> = Object.fromEntries(Object.entries(SLUG).map(([k, v]) => [v, k]));
/* private categories open the celebration calculator with the type preselected (/praznik/#<type>) */
export const OCC: Record<string, [string, string, string]> = {
  "Рождени дни": ["Рожден ден при нас", "Планирай рожден ден", "rozhden-den"], "Кръщенета": ["Кръщене при нас", "Планирай кръщене", "krashtene"],
  "Юбилеи": ["Юбилей при нас", "Планирай юбилей", "yubiley"], "Фирмени партита": ["Фирмено парти при нас", "Планирай фирмено парти", "firmeno-parti"],
  "Абитуриентски": ["Абитуриентска вечер при нас", "Планирай абитуриентска вечер", "abiturientski"], "Детски": ["Детски празник при нас", "Планирай детски празник", "detski"],
  "Частни партита": ["Частно парти при нас", "Планирай частно парти", "drugo"],
};
export const CATS = EVENT_CATS.filter((c) => PUBLIC.includes(c)).concat(EVENT_CATS.filter((c) => !PUBLIC.includes(c)));
export const TYPES: [string, string, string][] = [["Рожден ден", "cake", "rozhden-den"], ["Кръщене", "baby", "krashtene"], ["Юбилей", "heart", "yubiley"], ["Фирмено парти", "briefcase", "firmeno-parti"], ["Абитуриентски", "star", "abiturientski"], ["Детски празник", "balloon", "detski"]];

/* ---------- dates ---------- */
const pad = (n: number) => (n < 10 ? "0" : "") + n;
export const iso = (d: Date) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export function lastSat(y: number, mo: number): Date { const d = new Date(y, mo + 1, 0); while (d.getDay() !== 6) d.setDate(d.getDate() - 1); return d; }
export const daysTo = (d: Date, today: Date) => Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - today.getTime()) / 864e5);
export const inDays = (n: number) => (n === 0 ? "Днес" : n === 1 ? "Утре" : "След " + plural(n, "ден", "дни"));
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const longDate = (d: Date) => DAYS_SHORT[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
/** Today in Sofia as a local midnight Date (the build machine or the browser may be in another time zone). */
export function sofiaToday(now: Date = new Date()): Date {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit" }).format(now).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
/** "+02:00" / "+03:00" for an evening in Sofia (JSON-LD startDate). */
export function sofiaOffset(d: Date): string {
  const s = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Sofia", timeZoneName: "longOffset" }).formatToParts(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12)).find((x) => x.type === "timeZoneName")?.value || "GMT+02:00";
  return s.replace("GMT", "") || "+00:00";
}

/* ---------- the list: real events + "Скоро" placeholders ---------- */
export interface Item { key: string; kind: "real" | "soon"; cat: string; date: Date | null; e?: SiteEvent; n?: string; text?: string; miss?: string }

/** api.events() returns Date objects in the demo and ISO strings from the server: normalise to a local midnight. */
export function normEvent(e: SiteEvent | (Omit<SiteEvent, "date"> & { date: string })): SiteEvent {
  const raw = e.date as Date | string;
  let d: Date;
  if (raw instanceof Date) d = new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  else d = sofiaToday(new Date(raw));
  return { ...(e as SiteEvent), date: d };
}

export function buildItems(evs: SiteEvent[]): Item[] {
  const real: Item[] = evs.map((e) => ({ key: e.id, kind: "real", cat: e.cat, date: e.date, e }));
  const soon: Item[] = [];
  /* themed nights repeat every last Saturday of the month; the next dates are computed, the cuisine is not known yet */
  real.filter((x) => x.cat === "Тематични вечери").slice(0, 1).forEach((x) => {
    for (let k = 1; k <= 2; k++) {
      const d = lastSat(x.date!.getFullYear(), x.date!.getMonth() + k);
      soon.push({ key: "tema-" + iso(d), kind: "soon", cat: "Тематични вечери", date: d, n: "Тематична вечер",
        text: "Последната събота на " + MONTHS[d.getMonth()] + ". Коя кухня ще бъде, обявяваме скоро.", miss: "[ЛИПСВА: кухня, програма и цена]" });
    }
  });
  soon.push({ key: "muzika", kind: "soon", cat: "Жива музика", date: null, n: "Жива музика", text: "", miss: "[ЛИПСВА: дата, изпълнител и програма]" });
  soon.push({ key: "praznik", kind: "soon", cat: "Празници", date: null, n: "Празнични вечери", text: "", miss: "[ЛИПСВА: Коледа и Нова година, дати и меню]" });
  return real.concat(soon);
}
const byDate = (a: Item, b: Item) => (!a.date ? 1 : !b.date ? -1 : a.date.getTime() - b.date.getTime());
export function upcoming(all: Item[], today: Date): Item[] { return all.filter((x) => !x.date || daysTo(x.date, today) >= 0).sort(byDate); }

/* ---------- pieces ---------- */
const MEANDER = '<svg class="tex" aria-hidden="true"><defs><pattern id="meander" width="28" height="28" patternUnits="userSpaceOnUse"><path d="M0 25H28M25 25V3H6V19H19V9H12" fill="none" stroke="currentColor" stroke-width="3"/></pattern></defs><rect width="100%" height="100%" fill="url(#meander)"/></svg>';
function ctile(d: Date) { return '<span class="ctile" aria-hidden="true"><span class="m">' + MON[d.getMonth()].toUpperCase() + '</span><span class="d">' + d.getDate() + '</span><span class="w">' + DAYS[d.getDay()] + "</span></span>"; }

export function realCard(x: Item, today: Date, feat?: boolean): string {
  const e = x.e!, d = x.date!, n = daysTo(d, today);
  const price = e.price != null ? '<span class="price">' + e.price.toFixed(2).replace(".", ",") + " €</span>" : e.free ? "Вход свободен" : '<span class="missing">[ЛИПСВА: цена или вход свободен]</span>';
  const media = '<div class="slot ev-media" role="img" aria-label="Място за снимка от ' + esc(e.n) + '">' + (x.cat === "Тематични вечери" ? MEANDER : "") + ctile(d) +
    '<span class="flag">' + ic("clock", 16) + inDays(n) + '</span><span class="big">' + ic(CATI[x.cat] || "calendar-blank", 36) + '</span><span class="cap">' + ic("image", 16) + '<span class="missing">[ЛИПСВА: снимка от ' + esc(e.n) + "]</span></span></div>";
  return '<article class="ev shell' + (feat ? " feat" : "") + '" id="ev-' + x.key + '" aria-labelledby="t-' + x.key + '"><div class="core">' + media +
    '<div class="ev-body"><span class="ev-cat">' + ic(CATI[x.cat], 18) + esc(x.cat) + "</span>" +
    '<h3 class="ev-ttl ' + (feat ? "h1" : "h2") + '" id="t-' + x.key + '"><a href="' + url.event(x.key) + '">' + esc(e.n) + "</a></h3>" +
    '<p class="ev-txt' + (feat ? " lead" : "") + '">' + esc(e.text) + "</p>" +
    '<ul class="ev-facts"><li>' + ic("calendar-blank", 20) + "<span>" + longDate(d) + "</span></li><li>" + ic("clock", 20) + "<span>" + esc(e.time) + "</span></li><li>" + ic("ticket", 20) + "<span>" + price + "</span></li>" +
    (e.seatsLeft != null ? '<li class="seats">' + ic("users", 20) + "Остават " + plural(e.seatsLeft, "място", "места") + "</li>" : "") + "</ul>" +
    '<div class="ev-act"><a class="pill pill-red pill-lg" href="' + url.reservation(iso(d)) + '">' + ic("calendar-check", 22) + 'Запази място</a><a class="link" href="' + url.event(x.key) + '">Подробности за вечерта' + ic("caret-right", 18) + "</a></div>" +
    "</div></div></article>";
}

export function soonCard(x: Item): string {
  const label = x.date ? x.n + ", " + longDate(x.date) : x.n!;
  const media = '<div class="ev-head" aria-label="' + esc(label) + '" role="img">' + (x.date ? ctile(x.date) : '<span class="cic">' + ic(CATI[x.cat], 30) + "</span>") + '<span class="flag soft">' + ic("hourglass", 16) + "Скоро</span></div>";
  return '<article class="ev soon shell" id="ev-' + x.key + '" aria-labelledby="t-' + x.key + '"><div class="core">' + media +
    '<div class="ev-body"><span class="ev-cat">' + ic(CATI[x.cat], 18) + esc(x.cat) + '</span><h3 class="ev-ttl h3" id="t-' + x.key + '">' + esc(x.n) + "</h3>" +
    (x.text ? '<p class="ev-txt">' + esc(x.text) + "</p>" : "") + '<p class="ev-txt missing">' + esc(x.miss) + "</p>" +
    '<div class="ev-act"><button class="pill pill-line" type="button" data-notify="' + esc(x.cat) + '">' + ic("bell", 20) + "Уведоми ме</button></div></div></div></article>";
}

function occPanel(cat: string): string {
  const o = OCC[cat];
  return '<div class="occ shell"><div class="core"><span class="ic-c">' + ic(CATI[cat], 32) + '</span><h3 class="h2">' + o[0] + "</h3>" +
    '<p class="lead">Това е ваш празник и датата я избирате вие. Изберете меню от нашите ястия, торта и място, а ние ще ви изпратим оферта.</p>' +
    '<span class="offer">' + ic("seal-percent", 18) + "-5% при ранна резервация</span>" +
    '<a class="pill pill-red pill-lg go" href="' + url.page("celebration", o[2]) + '">' + o[1] + '<span class="knob">' + ic("arrow-right", 22) + "</span></a></div></div>";
}

function emptyBox(icon: string, title: string, text: string, btns: string, warn?: boolean): string {
  return '<div class="ev-empty empty"><span class="ill' + (warn ? " warn" : "") + '">' + ic(icon, 44) + '</span><h3 class="h3">' + title + '</h3><p class="muted">' + text + '</p><div class="row">' + btns + "</div></div>";
}

export function skeletonHTML(): string {
  const big = '<div class="ev shell feat" aria-hidden="true"><div class="core"><div class="skel sk-media"></div><div class="ev-body"><div class="skel sk-l" style="width:40%"></div><div class="skel" style="height:36px;width:70%;border-radius:12px"></div><div class="skel sk-l" style="width:92%"></div><div class="skel sk-l" style="width:60%"></div><div class="skel" style="height:56px;border-radius:999px;margin-top:8px"></div></div></div></div>';
  const sm = '<div class="ev shell soon" aria-hidden="true"><div class="core"><div class="ev-head"><div class="skel" style="width:66px;height:84px;border-radius:18px"></div></div><div class="ev-body"><div class="skel sk-l" style="width:50%"></div><div class="skel sk-l" style="width:80%"></div><div class="skel" style="height:48px;border-radius:999px;margin-top:8px"></div></div></div></div>';
  return '<p class="vh" role="status">Зареждаме събитията</p>' + big + '<div class="ev-grid rl" style="margin-top:6px">' + sm + sm + "</div>";
}

/* past events: gallery and internal reviews are not available yet ([ЛИПСВА]) */
const GAL = [{ cat: "Тематични вечери", ar: "3/4" }, { cat: "Жива музика", ar: "1/1" }, { cat: "Празници", ar: "1/1" }, { cat: "Рождени дни", ar: "4/5" }, { cat: "Тематични вечери", ar: "1/1" }, { cat: "Фирмени партита", ar: "3/4" }];
const REVS = [{ cat: "Тематични вечери", n: "Тематична вечер" }, { cat: "Празници", n: "Празнична вечер" }, { cat: "Рождени дни", n: "Рожден ден" }];

export type Mode = "ok" | "loading" | "none" | "error";
export interface ListState { tab: "up" | "past"; cat: string | null; mode: Mode }

/** The list and the count line for a state. `all` = buildItems(...) (ignored unless mode is "ok"). */
export function listHTML(st: ListState, all: Item[], today: Date): { html: string; count: string } {
  let html = "", count = "";
  if (st.mode === "loading") { html = skeletonHTML(); count = "Зареждаме..."; }
  else if (st.mode === "error") {
    html = emptyBox("warning-circle", "Не успяхме да заредим събитията", "Проверете връзката с интернет и опитайте пак. Можете и да ни се обадите на " + RESTAURANT.phone + ".",
      '<button class="pill pill-red pill-lg" type="button" data-retry>Опитай пак</button><a class="pill pill-line pill-lg" href="tel:' + RESTAURANT.phoneIntl + '">' + ic("phone", 20) + "Обади се</a>", true);
  } else if (st.tab === "up") {
    if (st.cat && OCC[st.cat]) { html = occPanel(st.cat); count = "Празник по ваш избор: вие избирате датата"; }
    else {
      const L = (st.mode === "ok" ? upcoming(all, today) : []).filter((x) => !st.cat || x.cat === st.cat);
      if (!L.length) {
        html = st.mode === "none"
          ? emptyBox("calendar-blank", "Засега няма обявени събития", "Следващата вечер обявяваме скоро. Искате ли да ви пишем, когато я обявим?",
            '<button class="pill pill-red pill-lg" type="button" data-notify="">' + ic("bell", 20) + 'Уведоми ме</button><a class="pill pill-line pill-lg" href="#praznik" data-jump="praznik">' + ic("confetti", 20) + "Празник при нас</a>")
          : emptyBox(CATI[st.cat!] || "calendar-blank", "Още няма обявени събития тук", "Ще ви пишем, щом обявим нещо в „" + esc(st.cat) + "“.",
            '<button class="pill pill-red pill-lg" type="button" data-notify="' + esc(st.cat) + '">' + ic("bell", 20) + 'Уведоми ме</button><button class="pill pill-line pill-lg" type="button" data-cat="">Всички събития</button>');
        count = st.mode === "none" ? "Няма обявени събития" : "Нищо в тази категория";
      } else {
        const real = L.filter((x) => x.kind === "real"), rest = L.filter((x) => x !== real[0]);
        html = (real[0] ? realCard(real[0], today, true) : "") + (rest.length ? (real[0] ? '<h3 class="h3 soon-h">' + ic("hourglass", 20) + "Скоро обявяваме</h3>" : "") + '<div class="ev-grid rl">' + rest.map((x) => (x.kind === "real" ? realCard(x, today) : soonCard(x))).join("") + "</div>" : "");
        const nr = real.length, ns = L.length - nr;
        count = (nr ? "<b>" + plural(nr, "обявено събитие", "обявени събития") + "</b>" : "") + (nr && ns ? " · " : "") + (ns ? ns + " скоро" : "");
      }
    }
  } else {
    const G = GAL.filter((g) => !st.cat || g.cat === st.cat), V = REVS.filter((r) => !st.cat || r.cat === st.cat);
    if (!G.length && !V.length) {
      html = emptyBox(CATI[st.cat!] || "images", "Още няма снимки и оценки оттук", "Ще ги покажем след първите вечери с новата фотосесия.",
        '<button class="pill pill-line pill-lg" type="button" data-cat="">Всички минали</button>' + (OCC[st.cat!] ? '<a class="pill pill-red pill-lg" href="' + url.page("celebration", OCC[st.cat!][2]) + '">' + OCC[st.cat!][1] + "</a>" : ""));
      count = "Нищо в тази категория";
    } else {
      html = (G.length ? '<div class="past-h"><h3 class="h2">Снимки от минали вечери</h3><a class="link" href="' + url.page("gallery") + '">Галерия' + ic("caret-right", 18) + '</a></div><div class="gal">' +
          G.map((g) => '<div class="gtile slot" style="aspect-ratio:' + g.ar + '" role="img" aria-label="Място за снимка: ' + esc(g.cat) + '"><span class="gl">' + esc(g.cat) + '</span><span class="big">' + ic("image", 26) + '</span><span class="cap"><span class="missing">[ЛИПСВА: снимка]</span></span></div>').join("") + "</div>" : "") +
        (V.length ? '<div class="past-h" style="margin-top:28px"><h3 class="h2">Какво казаха гостите</h3></div><div class="revs">' +
          V.map((r) => '<figure class="rev card" style="margin:0"><span class="stars missing">' + ic("chat-circle-dots", 20) + '[ЛИПСВА: оценка]</span><blockquote style="margin:0"><p class="missing">[ЛИПСВА: отзив от гост след вечерта, име и дата]</p></blockquote><figcaption class="who">' + ic(CATI[r.cat], 16) + esc(r.n) + "</figcaption></figure>").join("") +
          '</div><p class="rev-note">' + ic("info", 20) + "<span>Оценките са от кратката ни анкета след вечерта, не от Google. Показваме ги без подбор.</span></p>" : "");
      count = 'Минали вечери: <span class="missing">[ЛИПСВА: архив]</span>';
    }
  }
  return { html, count };
}

/* ---------- controls ---------- */
export function chipsHTML(cat: string | null): string {
  return '<button class="chip" type="button" data-cat="" aria-pressed="' + !cat + '">Всички</button>' +
    CATS.map((c) => (c === CATS[PUBLIC.length] ? '<span class="cdiv" aria-hidden="true"></span>' : "") + '<button class="chip" type="button" data-cat="' + SLUG[c] + '" aria-pressed="' + (cat === c) + '">' + ic(CATI[c], 18) + esc(c) + "</button>").join("");
}

/* ---------- calendar ---------- */
export function calHTML(all: Item[], today: Date, calM: number, mode: Mode): string {
  const base = new Date(today.getFullYear(), today.getMonth() + calM, 1), y = base.getFullYear(), mo = base.getMonth();
  const ev = (mode === "ok" ? upcoming(all, today) : []).filter((x) => x.date && x.date.getFullYear() === y && x.date.getMonth() === mo);
  const seg = '<div class="seg" role="group" aria-label="Месец">' + [0, 1, 2].map((k) => {
    const m = new Date(today.getFullYear(), today.getMonth() + k, 1);
    return '<button type="button" data-calm="' + k + '" aria-pressed="' + (k === calM) + '">' + cap(MONTHS[m.getMonth()]) + "</button>";
  }).join("") + "</div>";
  const first = (base.getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate();
  let cells = "";
  for (let i = 0; i < first; i++) cells += '<span aria-hidden="true"></span>';
  for (let d = 1; d <= dim; d++) {
    const dt = new Date(y, mo, d), e = ev.filter((x) => x.date!.getDate() === d)[0], isT = dt.getTime() === today.getTime();
    const cls = "cd" + (dt < today ? " past" : "") + (isT ? " today" : ""), lbl = d + " " + MONTHS[mo];
    if (e && e.kind === "real") cells += '<a class="' + cls + ' ev" href="' + url.event(e.key) + '" aria-label="' + lbl + ": " + esc(e.e!.n) + ", " + esc(e.e!.time) + '">' + d + "</a>";
    else if (e) cells += '<button class="' + cls + ' soon" type="button" data-goto="' + e.key + '" aria-label="' + lbl + ": " + esc(e.n) + ', скоро обявяваме">' + d + "</button>";
    else cells += '<span class="' + cls + '"' + (isT ? ' aria-label="Днес, ' + lbl + '"' : "") + ">" + d + "</span>";
  }
  const list = ev.length ? '<ul class="cal-list">' + ev.map((x) => {
    const dd = '<span class="dd"><b>' + x.date!.getDate() + "</b><small>" + DAYS_SHORT[x.date!.getDay()] + "</small></span>";
    return x.kind === "real"
      ? '<li><a href="' + url.event(x.key) + '">' + dd + '<span class="tt"><b>' + esc(x.e!.n) + "</b><small>" + esc(x.e!.time) + " · " + inDays(daysTo(x.date!, today)) + "</small></span>" + ic("caret-right", 20) + "</a></li>"
      : '<li><button type="button" data-goto="' + x.key + '">' + dd + '<span class="tt"><b>' + esc(x.n) + "</b><small>Скоро обявяваме</small></span>" + ic("caret-right", 20) + "</button></li>";
  }).join("") + "</ul>"
    : '<p class="cal-none">Няма обявени събития през ' + MONTHS[mo] + ".</p>";
  return '<div class="shell calbox"><div class="core">' + seg + '<p class="cal-y">' + cap(MONTHS[mo]) + " " + y + "</p>" +
    '<div class="cal-wd" aria-hidden="true"><span>пн</span><span>вт</span><span>ср</span><span>чт</span><span>пт</span><span>сб</span><span>нд</span></div><div class="cal-days">' + cells + "</div>" + list +
    '<div class="cal-leg" aria-hidden="true"><span><i class="l-ev"></i>Събитие</span><span><i class="l-soon"></i>Скоро обявяваме</span><span><i class="l-today"></i>Днес</span></div></div></div>';
}

/* ---------- subscribe ---------- */
export const WANT = ["Тематични вечери", "Жива музика", "Празници"];
export function subFormHTML(want: string[], draft: string): string {
  return '<form novalidate data-subform>' +
    '<fieldset><legend class="label">Какво ви интересува?</legend><div class="wrapchips">' + WANT.map((c) => '<button class="chip" type="button" data-want="' + esc(c) + '" aria-pressed="' + want.includes(c) + '">' + ic(CATI[c], 18) + esc(c) + "</button>").join("") + '</div><p class="help small muted" style="margin:0">Ако не изберете нищо, ще ви пишем за всички събития.</p></fieldset>' +
    '<div class="field"><label for="sub-email">Имейл</label><input class="input" id="sub-email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="например ime@primer.bg" aria-describedby="sub-email-err" value="' + esc(draft) + '"><p class="err" id="sub-email-err" hidden></p></div>' +
    '<div><label class="check"><input type="checkbox" id="sub-ok" name="consent" aria-describedby="sub-ok-err"><span>Искам да получавам имейли от Siracusa за нови събития. <span class="muted">Отписвате се с едно натискане от всеки имейл.</span></span></label><p class="err small" id="sub-ok-err" style="margin:0" hidden></p></div>' +
    '<div class="neterr" role="alert" data-neterr hidden>' + ic("warning", 22) + "<p><b>Няма връзка с интернет.</b> Имейлът ви е запазен тук. Проверете връзката и натиснете бутона пак.</p></div>" +
    '<button class="pill pill-red pill-lg pill-block" type="submit">' + ic("bell", 20) + "Пишете ми за събитията</button>" +
    "</form>";
}
export function subOkHTML(email: string, want: string[]): string {
  return '<div class="sub-ok" role="status"><span class="ic-c">' + ic("check", 32) + '</span><h3 class="h2">Готово, ще ви пишем</h3><p class="lead">Ще получите имейл на <b>' + esc(email) + "</b>, когато обявим " + (want.length ? "ново събитие в: " + want.map(esc).join(", ") : "ново събитие") + '.</p><button class="pill pill-line" type="button" data-subreset>' + ic("pencil-simple", 20) + "Смени имейла</button></div>";
}

/* ---------- JSON-LD ---------- */
export function eventsLd(site: URL | undefined, evs: SiteEvent[]): object[] {
  const abs = (p: string) => new URL(p, site).href;
  const addr = { "@type": "PostalAddress", streetAddress: "ж.к. Дружба 2, срещу бл. 311", addressLocality: "София", postalCode: "1582", addressCountry: "BG" };
  const ev = evs.map((e) => ({
    "@context": "https://schema.org", "@type": "Event", name: e.n, description: e.text, url: abs(url.event(e.id)),
    startDate: iso(e.date) + "T" + e.time + ":00" + sofiaOffset(e.date),
    eventStatus: "https://schema.org/EventScheduled", eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode", inLanguage: "bg",
    location: { "@type": "Restaurant", name: RESTAURANT.name, address: addr, telephone: RESTAURANT.phoneIntl, url: abs(url.home()) },
    organizer: { "@type": "Organization", name: RESTAURANT.name, url: abs(url.home()) },
    /* no "offers": the price is [ЛИПСВА] and is never invented */
  }));
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name: "Събития и поводи", item: abs(url.events()) }],
  };
  return [...ev, crumbs];
}
