/* Обща поръчка за офиса: the browser part (port of the script in design/pages/office.html).
   Views in the address hash:
     ""                   create form (the rest of the start view is drawn on the server)
     #share               link for colleagues + the organizer's own link (organizer)
     #list                shared list, timer, bill, send (organizer)
     #list-<код>-<ключ>   the organizer's link: continue on another device (the key is kept, the address becomes #list)
     #mine                the organizer's own lunch
     #join-<код>          invited colleague: name + lunch menu, no profile
     #sent                sent to the restaurant
   The order lives in the core (api.office.*: server, or localStorage core in the demo). The core sends the order at the
   deadline by itself when the organizer gave a name and a phone at create (else `autoFailed` and the organizer sends it).
   localStorage "sc-office" keeps only per-viewer conveniences: the form draft, which order this browser organizes,
   the phone, a colleague's draft. The organizer is the first participant of the order.
   Speed: no menu runtime (sc-menu.ts); the lunch menu comes as JSON in the HTML (#o-data, drawn by index.astro). */
import { SC } from "../../client/sc.ts";
import { api, ApiError } from "../../client/api.ts";
import { zoneOfAddress, zoneByName, zoneMin, type AddressResult } from "../../lib/zones.ts";
import { normPhone, hhmm, dateLong } from "../../lib/format.ts";
import { clockOverride, sofiaYmd } from "../../lib/time.ts";
import { artSvg } from "../../lib/art.ts";
import { busyExtra } from "../../lib/status.ts";
import { ORDER_RULES, type Zone } from "../../lib/consts.ts";
import { stepperHTML, callBtn, loadingText, previewPanel, pvToggle, stateBox, PV, BACK, OFFLINE, RETRY } from "../../lib/ui.ts";
import type { Dish } from "../../data/menu.ts";
import { PAY_LABEL, type OrderLine, type Order, type PayMethod } from "../../core/types.ts";
import type { PublicOffice } from "../../core/office.ts";
/* icons this script draws (sc.ts: x, check, caret-right, phone, question); stateBox: warning-circle, globe, arrow-clockwise */
import "sc-icons:arrow-clockwise,arrow-left,arrow-right,arrow-up-right,calendar-dots,chat-circle-dots,check-circle,clock,copy,credit-card,eye,globe,hand-waving,info,lock,minus,money,pencil-simple,plus,share-network,sliders-horizontal,storefront,ticket,timer,trash,truck,users,users-three,wallet,warning-circle"; /* the icons of this module in one group (scripts/icon-groups.mjs) */

/** What index.astro puts in #o-data: the lunch menu of the data (its date) and the prototype's sample colleagues. */
export interface OfficeData { date: string; dayName: string; items: Dish[]; team: { n: string; picks: Record<string, number> }[] }
type OfficeOrder = PublicOffice & { isOrg?: boolean };

type Picks = Record<string, number>;
type Mode = "delivery" | "pickup";
type Day = "today" | "tomorrow";
interface Draft { office: string; name: string; addr: string; mode: Mode; deadline: number | null; day: Day | null; pays: "one" | "each" }
interface Guest { name: string; picks: Picks; done: boolean; as: string }
interface Sent { code: string; no: string; key?: string; at: string; total: number; count: number; people: number; owe: [string, number][]; pays: "one" | "each"; mode: Mode; office: string }
interface Local {
  draft: Draft; code: string; me: string; phone: string; pay: PayMethod; mine: Picks;
  /** days: the lunch day of each order (from the core); auto: the organizer gave a phone at create (the core sends at the deadline) */
  days: Record<string, string>; auto: Record<string, boolean>; guests: Record<string, Guest>; sent: Sent | null;
}
interface Person { n: string; picks: Picks; me?: boolean; guest?: boolean; cls?: string }

const KEY = "sc-office";
const DEF: Local = {
  draft: { office: "", name: "", addr: "", mode: "delivery", deadline: null, day: null, pays: "one" },
  code: "", me: "", phone: "", pay: "cash", mine: {}, days: {}, auto: {}, guests: {}, sent: null,
};

export function start(): void {
  const main = SC.mount();
  const { ic, esc, fmt } = SC;
  const R = SC.RESTAURANT;
  const startEl = main.querySelector<HTMLElement>("[data-start]")!;
  const viewEl = main.querySelector<HTMLElement>("[data-view]")!;
  const protoEl = main.querySelector<HTMLElement>("[data-proto]")!;
  const createEl = main.querySelector<HTMLElement>("[data-create]")!;

  const raw = SC.load<Partial<Local>>(KEY, {});
  const L: Local = { ...DEF, ...raw, draft: { ...DEF.draft, ...(raw.draft || {}) }, days: raw.days || {}, auto: raw.auto || {}, guests: raw.guests || {}, mine: raw.mine || {} };
  if (!PAY_LABEL[L.pay]) L.pay = "cash";
  const save = () => SC.store(KEY, L);

  /* simulated states: only in the preview panel (?preview=1) */
  const sim = { closed: false, offline: false, loading: false };
  const t0 = Date.now();

  /* the lunch menu (JSON in the HTML), grouped; sold out stays visible, last in its group (decision 2) */
  let DATA: OfficeData = { date: "", dayName: "", items: [], team: [] };
  try { DATA = { ...DATA, ...JSON.parse(document.getElementById("o-data")?.textContent || "{}") }; } catch { /* keep empty */ }
  const byId: Record<string, Dish> = Object.fromEntries(DATA.items.map((x) => [x.id, x]));
  const isOut = (x: Dish) => (x.t || []).indexOf("out") > -1;
  const pic = (x: Dish) => '<div class="pic' + (isOut(x) ? " out" : "") + '" role="img" aria-label="' + esc(x.n) + ' (илюстрация до новата фотосесия)">' + artSvg(x) + "</div>";
  /** BRIEF 8: the lunch menu in the data is for one date; dishes are ordered only on that day (in the preview always, as an example) */
  const lunchIsToday = () => SC.lunchIsToday(); /* preview / demo: today (one helper for every page) */
  /** the day of the order on the visible picker ("today" | "tomorrow" ...), set by pickerHTML */
  let pickDay = "today";
  /** dishes can be chosen only from the lunch menu of the order's day (in the preview always, as an example) */
  const canOrder = () => SC.preview || (pickDay === "today" ? lunchIsToday() : pickDay === "tomorrow" && DATA.date === addDays(today(), 1));
  /** at most 10 portions per person: the sum of the counts (the core: too_many) */
  const MAX_PORTIONS = ORDER_RULES.officePortionsPerPerson;
  const GROUPS: { n: string; id: string; items: Dish[] }[] = [];
  DATA.items.forEach((x) => {
    let g = GROUPS.find((z) => z.n === x.group);
    if (!g) { g = { n: x.group || "", id: "g" + GROUPS.length, items: [] }; GROUPS.push(g); }
    g.items.push(x);
  });
  GROUPS.forEach((g) => g.items.sort((a, b) => Number(isOut(a)) - Number(isOut(b))));

  /* ---------- remote order ---------- */
  let O: OfficeOrder | null = null, Ocode = "", loadErr: ApiError | null = null, loading = false;

  /* ---------- helpers ---------- */
  const pad = (n: number) => (n < 10 ? "0" : "") + n;
  const clock = (m: number) => hhmm(((m % 1440) + 1440) % 1440);
  const toMin = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const sum = (p: Picks) => Math.round(Object.keys(p || {}).reduce((s, k) => s + (byId[k] ? byId[k].p * p[k] : 0), 0) * 100) / 100;
  const cnt = (p: Picks) => Object.values(p || {}).reduce((s, q) => s + q, 0);
  const dishes = (n: number) => n + " " + (n === 1 ? "ястие" : "ястия");
  const souls = (n: number) => n + " " + (n === 1 ? "човек" : "души");
  const initial = (n: string) => esc((n || "?").trim().charAt(0).toUpperCase());
  const picksOf = (lines: OrderLine[]) => { const p: Picks = {}; (lines || []).forEach((l) => { if (byId[l.id]) p[l.id] = (p[l.id] || 0) + l.q; }); return p; };
  const linesOf = (p: Picks): OrderLine[] => Object.keys(p).filter((k) => p[k] > 0).map((k) => ({ id: k, q: p[k], mods: [], extra: 0, name: byId[k]?.n, unit: byId[k]?.p }));
  const today = () => sofiaYmd(new Date());
  const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dateOf = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd, 12); };
  /** seconds since midnight on the shop clock (in preview the fixed clock moves on from page load) */
  const nowSec = () => SC.minutes() * 60 + (clockOverride() ? Math.floor((Date.now() - t0) / 1000) : new Date().getSeconds());
  const busy = () => SC.eta().busy;
  function copy(text: string) { try { navigator.clipboard?.writeText(text).catch(() => undefined); } catch { /* not allowed */ } }
  function scrollToEl(el: Element | null) { if (!el) return; const y = el.getBoundingClientRect().top + window.scrollY - 150; window.scrollTo({ top: Math.max(0, y), behavior: SC.reduce ? "auto" : "smooth" }); }
  /** focus at once (the screen reader reads the field with its error first); scrollToEl does the scrolling */
  function focusLater(el: HTMLElement | null) { if (el) el.focus({ preventScroll: true }); }
  /** the title of the new state gets the focus and comes into view, never <body> (tabindex=-1, as in the cart) */
  function focusTitle(el: HTMLElement | null) {
    if (!el) return;
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    el.classList.add("o-ttl");
    /* a title near the top of the page: the page from the top (the card with its icon is seen whole) */
    const y = el.getBoundingClientRect().top + window.scrollY;
    if (y < window.innerHeight * 0.6) window.scrollTo({ top: 0, behavior: SC.reduce ? "auto" : "smooth" });
    else el.scrollIntoView({ block: "center", behavior: SC.reduce ? "auto" : "smooth" }); /* clear of the sticky header and the toast */
    el.focus({ preventScroll: true });
  }
  /** the payment words of the whole site (PAY_LABEL in the core): "В брой · Карта при получаване · Ваучер" */
  const PAYS_TEXT = (Object.keys(PAY_LABEL) as PayMethod[]).map((k) => PAY_LABEL[k]).join(" · ");

  /* ---------- the plan for a new order: deadline slots every 30 min, 10:30-14:00 (lunch is delivered until 15:00) ---------- */
  function plan() {
    const m = SC.minutes(), first = Math.ceil(Math.max(m + 30, 630) / 30) * 30, tom = first > 840, slots: { t: number; off: boolean }[] = [];
    for (let t = 630; t <= 840; t += 30) slots.push({ t, off: !tom && t < first });
    return { tomorrow: tom, slots, def: tom || 690 >= first ? 690 : first };
  }
  function syncPlan() {
    const p = plan(), day: Day = p.tomorrow ? "tomorrow" : "today", d = L.draft;
    const ok = d.deadline && d.day === day && p.slots.some((s) => s.t === d.deadline && !s.off);
    if (!ok) { d.deadline = p.def; d.day = day; }
    return p;
  }
  function etaMin(z: Zone | null, mode: Mode, day: string) {
    if (mode === "pickup") return 0;
    return (z ? zoneMin(z) : 35) + (day === "today" && busy() ? busyExtra() : 0); /* the core's rule (pricing): "Натоварено" adds the minutes from the settings */
  }
  function zr(): AddressResult { return zoneOfAddress(L.draft.addr || ""); }
  function draftCtx() {
    const d = L.draft, r = zr(), z = r.type === "zone" ? r.zone : null, day = d.day || "today", dl = d.deadline || 690;
    return { day, dl, z, eta: dl + etaMin(z, d.mode, day), dayWord: day === "today" ? "днес" : "утре" };
  }

  /* ---------- an existing order: its day, deadline, time left ---------- */
  /** the lunch day: the core's `date` (the same for the organizer and every colleague); older orders: the create time */
  function targetDate(o: OfficeOrder): string {
    if (o.date) return o.date;
    if (L.days[o.code]) return L.days[o.code];
    const c = new Date(o.createdAt), cd = sofiaYmd(c);
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(c).split(":");
    const cm = (+f[0] % 24) * 60 + +f[1];
    return cm + 30 > toMin(o.deadline) ? addDays(cd, 1) : cd;
  }
  function ctx(o: OfficeOrder) {
    const td = targetDate(o), t = today(), dl = toMin(o.deadline), s = nowSec();
    const day = td === t ? "today" : td === addDays(t, 1) ? "tomorrow" : td < t ? "past" : "later";
    const remain = day === "today" ? dl * 60 - s : day === "tomorrow" ? 86400 - s + dl * 60 : day === "later" ? 86400 * 2 : -1;
    const z = o.zone ? zoneByName(o.zone) : null;
    return {
      day, dl, remain, z, mode: o.mode as Mode, sent: o.status !== "open",
      closed: sim.closed || remain <= 0 || o.status !== "open",
      /* the core's rule (orders.ts): after 15:00 the lunch menu is not delivered; pickup until 22:30, with -30% */
      late: o.status === "open" && ((day === "today" && SC.minutes() >= (o.mode === "pickup" ? ORDER_RULES.pickupUntil : 900)) || day === "past"),
      lunchOff: o.status === "open" && o.mode === "pickup" && day === "today" && SC.state().lunchDiscount,
      early: day === "today" && SC.minutes() < 600,
      eta: dl + etaMin(z, o.mode as Mode, day),
      dayWord: day === "today" ? "днес" : day === "tomorrow" ? "утре" : dateLong(dateOf(td)),
    };
  }
  type Ctx = ReturnType<typeof ctx>;
  const left = (sec: number) => { sec = Math.max(0, sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h >= 1 ? h + "<small>\u00a0ч </small>" + m + "<small>\u00a0мин</small>" : pad(m) + ":" + pad(s); };
  /** the same rounding as the timer (down), no breaks inside "17 ч 7 мин" */
  const leftWords = (sec: number) => { const m = Math.max(0, Math.floor(sec / 60)); if (m >= 90) { const h = Math.floor(m / 60), r = m % 60; return h + "\u00a0ч" + (r ? "\u00a0" + r + "\u00a0мин" : ""); } return m + "\u00a0мин"; };
  const whereText = (o: { mode: string; zone: string; addr: string }) => (o.mode === "pickup" ? "Вземане от ресторанта" : o.zone || o.addr || "ж.к. Дружба 2");
  const feeText = (c: Ctx) => (c.mode === "pickup" ? "Без доставка" : !c.z || c.z.free ? "Безплатна" : '<span class="missing">[ЛИПСВА: такса в €]</span>');
  const orgOf = (o: OfficeOrder) => (o.participants[0] && o.participants[0].name) || "Колегата";
  /** this browser organizes the order: the core says so (isOrg: it holds the organizer key) */
  const isMine = (o: OfficeOrder | null) => !!o && (o.isOrg != null ? o.isOrg : o.code === L.code);

  function people(o: OfficeOrder, guestView = false): Person[] {
    const g = L.guests[o.code];
    return o.participants.map((p, i) => ({
      n: p.name, picks: picksOf(p.lines), me: i === 0, guest: !!g && g.as === p.name && i > 0, cls: "a" + (((i - 1) % 3) + 1),
    })).filter((p) => p.me || cnt(p.picks) > 0 || (guestView && p.guest));
  }
  const eaters = (o: OfficeOrder) => people(o).filter((p) => cnt(p.picks) > 0);
  /** pickup after 15:00: the lunch -30% as the core counts it (lib/pricing.ts: per dish line, the discount rounded to cents) */
  const r2 = (v: number) => Math.round(v * 100) / 100;
  function lunchPrice(p: Picks) {
    let sub = 0, disc = 0;
    Object.keys(p).forEach((k) => { if (!byId[k] || !(p[k] > 0)) return; const tot = r2(byId[k].p * p[k]); sub += tot; disc += Math.round(tot * Math.round(ORDER_RULES.lunchPickupDiscount * 100)) / 100; });
    return { sub: r2(sub), disc: r2(disc), total: r2(sub - disc) };
  }
  const allPicks = (o: OfficeOrder) => { const a: Picks = {}; eaters(o).forEach((x) => Object.keys(x.picks).forEach((k) => { a[k] = (a[k] || 0) + x.picks[k]; })); return a; };
  const total = (o: OfficeOrder) => Math.round(eaters(o).reduce((s, p) => s + sum(p.picks), 0) * 100) / 100;
  const totalCount = (o: OfficeOrder) => eaters(o).reduce((s, p) => s + cnt(p.picks), 0);

  /* ---------- links ---------- */
  const joinHref = (code: string) => SC.url.page("office", "join-" + code);
  const joinURL = (code: string) => new URL(joinHref(code), location.href).href;
  const shortURL = (code: string) => joinURL(code).replace(/^https?:\/\//, "");
  /** the organizer's own link (continue on another device): never for the colleagues */
  const orgURL = (code: string) => { const k = api.office.orgKey(code); return k ? new URL(SC.url.page("office", "list-" + code + "-" + k), location.href).href : ""; };
  /** one line: the start of the address shrinks with "…", the code stays whole (the copy button gives the whole link) */
  function linkHTML(u: string) { const i = u.indexOf("#"); return '<span class="o-lh">' + esc(u.slice(0, i)) + '</span><span class="nw">' + esc(u.slice(i)) + "</span>"; }
  function chatMsg(o: OfficeOrder, c: Ctx) { return "Поръчваме обяд от Siracusa. Изберете си от обедното меню до " + clock(c.dl) + (c.day === "tomorrow" ? " утре" : "") + ": " + joinURL(o.code); }

  /* ---------- small templates ---------- */
  function stepper(n: number) {
    const names = ["Създайте", "Споделете", "Изпратете"];
    return '<div class="o-step">' + stepperHTML(n, 3, names[n]) +
      '<ol class="o-step-l">' + names.map((t, i) => { const st = i + 1 < n ? "done" : i + 1 === n ? "cur" : "";
        return '<li class="' + st + '"' + (st === "cur" ? ' aria-current="step"' : "") + ">" + (st === "done" ? ic("check", 16) + '<span class="vh">Готово: </span>' : "") + t + "</li>"; }).join("") + "</ol></div>";
  }
  /* "Назад": the same word in every flow (site.review-consistency В5); where it goes is in the aria-label */
  const back = (href: string, label: string) => '<a class="link o-back" href="' + href + '" aria-label="' + esc(BACK + ": " + label) + '">' + ic("arrow-left", 20) + BACK + "</a>";
  function person(p: Person, o: { edit?: boolean; closed?: boolean; guestView?: boolean; fresh?: boolean; off?: boolean } = {}) {
    const n = cnt(p.picks);
    const items = Object.keys(p.picks).map((k) => '<li><span class="q">' + p.picks[k] + " ×</span><span>" + esc(byId[k].n) + "</span></li>").join("");
    const tag = p.me ? '<span class="o-tag">' + (o.guestView ? "организатор" : "вие, организатор") + "</span>" : p.guest ? '<span class="o-tag">вие</span>' : "";
    let acts = "";
    if (o.edit && p.me && !o.closed) acts = '<div class="acts"><a class="link" href="#mine">' + ic(n ? "pencil-simple" : "plus", 18) + (n ? "Промени моя избор" : "Избери своето") + "</a></div>";
    else if (o.edit && !p.me && !o.closed) acts = '<div class="acts"><button class="link mutedl" type="button" data-act="drop" data-who="' + esc(p.n) + '" aria-label="Махни ' + esc(p.n) + ' от поръчката">' + ic("x", 18) + "Махни</button></div>";
    return '<div class="o-person' + (o.fresh ? " new" : "") + '"><span class="o-ava ' + (p.me ? "me" : p.cls || "a3") + '" aria-hidden="true">' + initial(p.n) + "</span>" +
      '<div><div class="nm">' + esc(p.n) + tag + "</div>" + (n ? "<ul>" + items + "</ul>" : '<p class="muted" style="margin:4px 0 0;font-size:15px">' + (p.me && !o.guestView ? "Още не сте избрали" : "Още избира") + "</p>") + acts + "</div>" +
      '<div class="sum">' + (n ? '<span class="price">' + fmt(o.off ? lunchPrice(p.picks).total : sum(p.picks)) + "</span>" : "") + "</div></div>";
  }
  const note = (cls: string, icon: string, html: string, role = "status") => '<div class="o-note ' + cls + '" role="' + role + '">' + ic(icon, 22) + "<div>" + html + "</div></div>";
  /** an error after an action (create, send, add): a title that gets the focus, one sentence, the actions (decision 12.11, as in the cart) */
  const errNote = (title: string, text: string, acts = "") => '<div class="o-note bad o-err" role="alert">' + ic("warning-circle", 22) + '<div><b class="o-errh" tabindex="-1" data-errh>' + esc(title) + "</b><p>" + text + "</p>" + (acts ? '<div class="o-acts">' + acts + "</div>" : "") + "</div></div>";
  const skel = (h: number, extra = "") => '<div class="skel" style="height:' + h + "px;" + extra + '"></div>';

  /* ======================= view: create form ======================= */
  function formHTML() {
    const p = syncPlan(), d = L.draft; save();
    const tomNote = p.tomorrow ? note("warn", "info", "<p>За днес е късно: обедното меню се доставя до 15:00. Отворете поръчката за <b>утре, " + esc(dateLong(dateOf(addDays(today(), 1)))) + "</b>.</p>" +
      (SC.state().lunchDiscount ? '<a class="link" href="' + SC.url.lunch() + '">Днес вземете от място с -30%' + ic("caret-right", 18) + "</a>" : "")) : "";
    const open = L.code && !L.sent ? note("", "users-three", "<p>Вече имате отворена обща поръчка. Ако отворите нова, колегите ще трябва да получат новата връзка.</p>" +
      '<a class="link" href="#list">Към общия списък' + ic("caret-right", 18) + "</a>") : "";
    const slots = p.slots.map((s) => '<button class="o-slot" type="button" data-slot="' + s.t + '" aria-pressed="' + (s.t === d.deadline) + '"' + (s.off ? " disabled" : "") + ">" + clock(s.t) + (s.off ? '<span class="vh"> (мина)</span>' : "") + "</button>").join("");
    const anyOff = p.slots.some((s) => s.off);
    return '<div class="o-lay"><div class="o-col">' +
      '<div><h2 class="h2" id="o-create-h" style="margin-bottom:14px">Отворете поръчка</h2>' + stepper(1) + "</div>" +
      open + tomNote +
      '<form class="o-form" data-form novalidate>' +
        '<div class="field"><label for="o-office">Име на офиса <span class="muted" style="font-weight:600">(по желание)</span></label><input class="input" id="o-office" name="office" autocomplete="organization" placeholder="Например: Счетоводство, 3-ти етаж" value="' + esc(d.office) + '" aria-describedby="o-office-h o-office-e"><span class="help" id="o-office-h">Колегите ще го видят в поканата.</span><span class="err" id="o-office-e" data-err="office" hidden></span></div>' +
        '<div class="field"><label for="o-name">Вашето име</label><input class="input" id="o-name" name="name" autocomplete="given-name" placeholder="Например: Мария" value="' + esc(d.name) + '" aria-describedby="o-name-e"><span class="err" id="o-name-e" data-err="name" hidden></span></div>' +
        '<div class="field"><label for="o-cphone">Вашият телефон <span class="muted" style="font-weight:600">(по желание)</span></label><input class="input" id="o-cphone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0888 12 34 56" value="' + esc(L.phone) + '" aria-describedby="o-cphone-h o-cphone-e"><span class="help" id="o-cphone-h">С телефона поръчката тръгва към ресторанта сама в крайния час, а шофьорът може да ви се обади. Без него я изпращате с бутон.</span><span class="err" id="o-cphone-e" data-err="cphone" hidden></span></div>' +
        '<div class="field" data-addrbox>' + addrHTML() + "</div>" +
        '<div class="field"><span class="label" id="o-slots-l">Колегите избират до</span><div class="o-slots" id="o-slots" role="group" aria-labelledby="o-slots-l" aria-describedby="o-slots-e">' + slots + "</div>" +
          (anyOff ? '<span class="help">Зачертаните часове за днес минаха.</span>' : "") + '<span class="err" id="o-slots-e" data-err="deadline" hidden></span>' +
          '<div class="o-res" data-eta aria-live="polite"></div></div>' +
        '<fieldset class="o-choice"><legend class="label">Кой плаща</legend>' +
          '<label class="o-opt"><input type="radio" name="pays" value="one"' + (d.pays === "one" ? " checked" : "") + '><span class="o-fi">' + ic("wallet", 22) + '</span><span><b>Плащам аз за всички</b><span class="muted">Виждате кой колко ви дължи.</span></span><span class="o-radio">' + ic("check", 16) + "</span></label>" +
          '<label class="o-opt"><input type="radio" name="pays" value="each"' + (d.pays === "each" ? " checked" : "") + '><span class="o-fi">' + ic("users-three", 22) + '</span><span><b>Всеки плаща своето</b><span class="muted">Сметката е разделена по имена.</span></span><span class="o-radio">' + ic("check", 16) + "</span></label>" +
        "</fieldset>" +
        '<div data-formerr></div>' +
        '<div class="o-actions"><button class="pill pill-red pill-lg pill-block" type="submit" data-create-btn>Създай връзка за колегите' + ic("arrow-right", 20) + "</button>" +
        '<p class="o-fine">' + ic("info", 18) + "<span>Плащане при получаване: " + PAYS_TEXT + ". Ако сте дали телефон, в крайния час поръчката тръгва към ресторанта сама. Можете да я изпратите и по-рано.</span></p></div>" +
      "</form></div>" +
      '<aside class="o-aside o-onlydesk" aria-label="Преглед на поканата"><div class="o-preview shell"><div class="core"><span class="label">' + ic("eye", 18) + 'Така ще я видят колегите</span><div data-preview></div></div></div></aside>' +
    "</div>";
  }
  function addrHTML() {
    const d = L.draft;
    if (d.mode === "pickup") return '<span class="label">Доставка</span>' + note("", "storefront", '<div class="o-pickup"><b>Ще я вземете от ресторанта</b><span class="muted" style="font-weight:600">' + esc(R.address) + '. Обедното меню е готово веднага.</span><button class="link" type="button" data-act="delivery" style="justify-self:start;min-height:48px">' + ic("truck", 18) + "Искам доставка до офиса</button></div>");
    const r = zr(), len = d.addr.trim().length;
    let res = "";
    if (r.type === "zone") res = r.zone.free ? note("ok", "check-circle", "<p>Безплатна доставка · " + esc(r.zone.n) + " · " + esc(r.zone.eta) + "</p>")
      : note("warn", "truck", "<p>Доставка по тарифа · " + esc(r.zone.n) + ' · <span class="missing">[ЛИПСВА: такса в €]</span></p>');
    else if (r.type === "ask") res = note("", "info", "<p>" + esc(r.q) + " Допишете, за да изчислим времето.</p>");
    else if (r.type === "out") res = note("bad", "warning-circle", '<p>Не доставяме до този адрес. Можете да я вземете от ресторанта.</p><button class="pill pill-line" type="button" data-act="pickup">' + ic("storefront", 20) + "Ще я вземем от ресторанта</button>");
    else if ((r.type === "street" && len >= 3) || (r.type === "unknown" && len >= 8)) res = note("", "question", "<p>Не разпознаваме квартала. Допишете го, например „Дружба 2, бл. 12“, или изберете отдолу.</p>");
    const quick = SC.ZONES.map((z) => '<button class="chip" type="button" data-zone="' + esc(z.n) + '">' + esc(z.n) + "</button>").join("");
    return '<label for="o-addr">Адрес на офиса</label><input class="input" id="o-addr" name="addr" autocomplete="street-address" placeholder="Например: Дружба 2, бл. 311" value="' + esc(d.addr) + '" aria-describedby="o-addr-e o-addr-r"><span class="err" id="o-addr-e" data-err="addr" hidden></span>' +
      '<div id="o-addr-r" data-zoneres aria-live="polite">' + res + "</div>" +
      '<p class="o-quick-l">Доставяме до:</p><div class="o-quick">' + quick + "</div>";
  }
  function updAddr(keepFocus: boolean) {
    const box = main.querySelector("[data-addrbox]"); if (!box) return;
    if (keepFocus) { const r = box.querySelector("[data-zoneres]"), tmp = document.createElement("div"); tmp.innerHTML = addrHTML(); if (r) r.innerHTML = tmp.querySelector("[data-zoneres]")?.innerHTML || ""; }
    else box.innerHTML = addrHTML();
    updEta();
  }
  function updEta() {
    const c = draftCtx(), d = L.draft, el = main.querySelector("[data-eta]");
    if (el) el.innerHTML = ic(d.mode === "pickup" ? "storefront" : "truck", 20) + "<span>" + (d.mode === "pickup" ? "Готово за вземане " + c.dayWord + " в " + clock(c.dl) : "Доставка " + c.dayWord + " около " + clock(c.eta)) + "</span>";
    const pv = main.querySelector("[data-preview]"); if (pv) pv.innerHTML = previewHTML();
  }
  /** the name the colleagues see: the office name, or "Офисът на Мария" (what the core gets when it is empty) */
  const officeName = (d: Draft) => d.office.trim() || (d.name.trim() ? "Офисът на " + d.name.trim() : "");
  function previewHTML() {
    const c = draftCtx(), d = L.draft, nm = d.name.trim() || "Вие", r = zr(), offName = officeName(d);
    const where = d.mode === "pickup" ? "Вземане от ресторанта" : r.type === "zone" ? r.zone.n : d.addr.trim() || "ж.к. Дружба 2";
    return '<div class="o-bubble"><span class="who">' + esc(nm) + "</span>Поръчваме обяд от Siracusa. Изберете си до " + clock(c.dl) + (c.day === "tomorrow" ? " утре" : "") + '.<br><span class="o-linkchip">' + ic("arrow-up-right", 16) + '<span class="o-lw">' + linkHTML(shortURL("") + "······") /* the dots stay dots (not %C2%B7 from URL) */ + "</span></span></div>" +
      '<div class="o-kv">' +
      (offName ? '<div class="kv"><span>Офис</span><b>' + esc(offName) + "</b></div>" : "") +
      '<div class="kv"><span>' + (d.mode === "pickup" ? "Вземане" : "Доставка до") + "</span><b>" + esc(where) + "</b></div>" +
      '<div class="kv"><span>Избор до</span><b>' + c.dayWord + ", " + clock(c.dl) + "</b></div>" +
      '<div class="kv"><span>' + (d.mode === "pickup" ? "Готово" : "Пристига около") + "</span><b>" + clock(c.eta) + "</b></div>" +
      '<div class="kv"><span>Плащане</span><b>' + (d.pays === "one" ? (d.name.trim() ? esc(nm) + ", за всички" : "вие, за всички") : "всеки своето") + "</b></div></div>";
  }

  /* ======================= view: link for colleagues ======================= */
  /** the organizer's link: the same order on another phone or computer (with the organizer key) */
  function orgLinkHTML(o: OfficeOrder) {
    const u = orgURL(o.code);
    if (!u) return "";
    return '<div class="shell"><div class="core o-card o-orglink"><h2 class="o-h3">' + ic("lock", 20) + 'Връзка само за вас</h2>' +
      '<p class="muted" style="margin:6px 0 10px">С нея довършвате поръчката от друг телефон или компютър: виждате списъка и я изпращате. Не я пращайте на колегите.</p>' +
      '<div class="o-link">' + ic("lock", 20) + '<output aria-label="Връзка само за вас">' + linkHTML(u.replace(/^https?:\/\//, "").replace(/-[^-]+$/, "-…")) + "</output></div>" +
      '<button class="pill pill-line pill-block" type="button" data-act="copyorg" style="margin-top:10px">' + ic("copy", 20) + "Копирай връзката за вас</button></div></div>";
  }
  function viewShare(o: OfficeOrder) {
    const c = ctx(o), msg = chatMsg(o, c), me = orgOf(o);
    return '<section class="sec o-top"><div class="o-lay"><div class="o-col">' +
      "<div>" + back(SC.url.page("office", "o-create"), "Назад: данните на поръчката") + stepper(2) + "</div>" +
      '<div class="shell"><div class="core o-card">' +
        '<span class="o-done-ic">' + ic("check", 32) + "</span>" +
        '<h1 class="h2">Поръчката е отворена</h1>' +
        '<p class="lead o-sub">Пратете връзката в чата на офиса. Колегите избират до <b style="color:var(--ink)">' + clock(c.dl) + "</b> " + c.dayWord + ".</p>" +
        '<div class="o-linkwrap"><span class="label" id="o-link-l">Връзка за колегите</span>' +
        '<div class="o-link" title="' + esc(joinURL(o.code)) + '">' + ic("arrow-up-right", 20) + '<output aria-labelledby="o-link-l" data-link>' + linkHTML(shortURL(o.code)) + "</output></div>" +
        '<button class="pill pill-red pill-lg pill-block" type="button" data-act="copylink">' + ic("copy", 22) + "Копирай връзката</button>" +
        '<div class="o-two"><a class="pill pill-line" href="viber://forward?text=' + encodeURIComponent(msg) + '" data-act="viber">' + ic("chat-circle-dots", 20) + 'Във Viber</a><button class="pill pill-line" type="button" data-act="sharenative">' + ic("share-network", 20) + "Друг начин</button></div></div>" +
      (api.demo ? note("warn", "info", "<p><b>Това е демо.</b> Поръчката се пази само в този браузър, затова поканата работи само тук (в нов раздел). На истинския сайт колегите отварят връзката от всеки телефон или компютър.</p>") : "") +
      "</div></div>" +
      '<div><h2 class="o-h3" style="margin-bottom:12px">Готово съобщение за чата</h2><div class="o-bubble"><span class="who">' + esc(me) + "</span>" + esc(msg.replace(joinURL(o.code), "")).trim() + '<br><span class="o-linkchip">' + ic("arrow-up-right", 16) + '<span class="o-lw">' + linkHTML(shortURL(o.code)) + "</span></span></div>" +
        '<button class="link" type="button" data-act="copymsg" style="min-height:48px">' + ic("copy", 18) + "Копирай цялото съобщение</button></div>" +
      orgLinkHTML(o) +
    "</div>" +
    '<aside class="o-aside o-col">' +
      '<div class="shell"><div class="core o-card"><h2 class="o-h3" style="margin-bottom:4px">Вашата поръчка</h2>' +
      '<div class="o-kv">' +
        '<div class="kv"><span>Офис</span><b>' + esc(o.office) + "</b></div>" +
        '<div class="kv"><span>' + (o.mode === "pickup" ? "Вземане" : "Доставка до") + "</span><b>" + esc(whereText(o)) + "</b></div>" +
        '<div class="kv"><span>Избор до</span><b>' + c.dayWord + ", " + clock(c.dl) + "</b></div>" +
        '<div class="kv"><span>' + (o.mode === "pickup" ? "Готово" : "Пристига около") + "</span><b>" + clock(c.eta) + "</b></div>" +
        '<div class="kv"><span>Плащане</span><b>' + (o.payer === "one" ? "вие, за всички" : "всеки своето") + "</b></div></div></div></div>" +
      '<div class="o-actions"><a class="pill pill-ink pill-lg pill-block" href="#list">Към общия списък' + ic("arrow-right", 20) + "</a>" +
      '<a class="pill pill-line pill-block" href="#mine">' + ic("plus", 20) + "Добавете и своето ястие</a>" +
      '<a class="link" href="#join-' + esc(o.code) + '" style="justify-self:center;min-height:48px">' + ic("eye", 18) + "Вижте какво виждат колегите</a></div>" +
    "</aside></div></section>";
  }

  /* ======================= view: shared list ======================= */
  function timerHTML(o: OfficeOrder, c: Ctx) {
    if (c.late) return note("warn", "clock", "<p>" + (c.mode === "pickup" ? "Кухнята вече не приема поръчки за днес (до 22:30)." : "Обедното меню вече не се доставя днес (до 15:00).") + ' Отворете нова поръчка за утре.</p><button class="pill pill-line" type="button" data-act="restart">Нова поръчка за утре</button>');
    if (c.closed) return '<div class="o-closed"><span class="o-fi">' + ic("lock", 22) + "</span><div><b>Изборът приключи в " + clock(c.dl) + "</b><span>" + closedText(o) + "</span></div></div>" + autoFailedHTML(o) +
      (c.lunchOff ? '<div style="margin-top:12px">' + note("", "storefront", "<p>След 15:00 обедното меню е само за вземане от място, с -30%. Сумата в бутона е с отстъпката.</p>") + "</div>" : "");
    return '<div class="o-timer"><div><span class="lbl">Остават за избор</span><span class="o-time" data-left>' + left(c.remain) + '</span></div><div class="o-until"><span class="o-live"><i></i>На живо</span><br>до ' + clock(c.dl) + " " + c.dayWord + "</div></div>" +
      '<div class="o-track" aria-hidden="true"><span data-track style="transform:scaleX(' + trackScale(c) + ')"></span></div>';
  }
  /** after the deadline: what happens with the order (the core sends it when the organizer gave a phone at create) */
  function closedText(o: OfficeOrder) {
    if (o.status !== "open") return "Поръчката е изпратена" + (o.orderNo ? " (№ " + esc(o.orderNo) + ")." : ".");
    if (!eaters(o).length) return "Никой не избра ястие.";
    if (o.autoFailed) return "Списъкът е затворен.";
    return "Списъкът е затворен. " + ((o.hasContact ?? L.auto[o.code]) ? "Поръчката тръгва към ресторанта до минута." : "Напишете телефона си и изпратете поръчката.");
  }
  /** o.autoFailed: why the core did not send it at the deadline; the organizer sends it with the button */
  function autoFailedHTML(o: OfficeOrder) {
    const why = o.status === "open" ? o.autoFailed : "";
    if (!why) return "";
    const btn = ctx(o).lunchOff ? "Поръчай за вземане" : "Изпрати на ресторанта";
    const txt = why === "no_contact" ? "<b>Поръчката не тръгна сама:</b> при създаването не беше даден телефон. Напишете го отдолу и натиснете „" + btn + "“."
      : why === "empty" ? "<b>Поръчката не тръгна:</b> никой не избра ястие. Добавете ястие или отворете нова поръчка."
      : why === "lunch_stale" ? "<b>Поръчката не тръгна сама:</b> обедното меню за днес още не е качено. Обадете ни се на " + esc(R.phone) + "."
      : "<b>Поръчката не тръгна сама.</b> Изпратете я с бутона „" + btn + "“ или ни се обадете на " + esc(R.phone) + ".";
    return '<div style="margin-top:12px">' + note("bad", "warning-circle", "<p>" + txt + "</p>", "alert") + "</div>";
  }
  const trackScale = (c: Ctx) => Math.min(1, Math.max(0, c.remain / (c.day === "today" ? 7200 : 86400))).toFixed(4);
  function peopleHTML(o: OfficeOrder, c: Ctx, fresh: Set<string>) {
    const all = people(o);
    if (all.length <= 1 && !cnt(all[0] ? all[0].picks : {})) {
      return (all[0] ? person(all[0], { edit: true, closed: c.closed }) : "") +
        '<div class="o-state" style="padding:20px 8px 8px"><div class="ill">' + ic("users-three", 36) + '</div><b style="font-size:18px">Още никой не е избрал</b><p class="muted">Пратете връзката в чата на офиса. Тук ще виждате всеки, който добави ястие.</p>' +
        (c.closed ? "" : '<div class="o-actions"><button class="pill pill-red pill-block" type="button" data-act="copylink">' + ic("copy", 20) + "Копирай връзката</button></div>") + "</div>";
    }
    return all.map((p) => person(p, { edit: true, closed: c.closed, fresh: fresh.has(p.n), off: c.lunchOff })).join("");
  }
  function payBoxHTML(o: OfficeOrder) {
    const list = eaters(o), off = ctx(o).lunchOff, T = off ? lunchPrice(allPicks(o)).total : total(o);
    const ps = (p: Person) => (off ? lunchPrice(p.picks).total : sum(p.picks));
    if (!list.length) return "";
    if (o.payer === "each") return '<div class="shell"><div class="core o-card"><h2 class="o-h3">Кой колко плаща</h2><p class="muted" style="margin:6px 0 4px">Всеки плаща своето при получаване: ' + PAYS_TEXT + ".</p>" +
      '<div class="o-owe">' + list.map((p) => '<div class="kv"><span>' + esc(p.n) + '</span><span class="price">' + fmt(ps(p)) + "</span></div>").join("") + "</div></div></div>";
    const others = list.filter((p) => !p.me);
    return '<div class="shell"><div class="core o-card"><h2 class="o-h3">Плащате вие за всички</h2><p class="muted" style="margin:6px 0 4px">' + fmt(T) + (others.length ? " при получаване. Колегите ви дължат:" : " при получаване.") + "</p>" +
      (others.length ? '<div class="o-owe">' + others.map((p) => '<div class="kv"><span>' + esc(p.n) + '</span><span class="price">' + fmt(ps(p)) + "</span></div>").join("") + "</div>" +
        '<button class="link" type="button" data-act="copyowe" style="min-height:48px">' + ic("copy", 18) + "Копирай кой колко дължи</button>" : '<p class="small muted" style="margin:8px 0 0">Още никой от колегите не е избрал.</p>') + "</div></div>";
  }
  function billHTML(o: OfficeOrder, c: Ctx) {
    const T = total(o), N = totalCount(o), L30 = c.lunchOff ? lunchPrice(allPicks(o)) : null;
    return '<div class="shell"><div class="core o-card"><h2 class="o-h3" style="margin-bottom:4px">Сметка</h2><div class="o-kv">' +
      '<div class="kv"><span>' + dishes(N) + '</span><span class="price">' + fmt(T) + "</span></div>" +
      (L30 && L30.disc ? '<div class="kv"><span>Обедно меню -30% (вземане след 15:00)</span><span class="price">-' + fmt(L30.disc) + "</span></div>" : "") +
      '<div class="kv"><span>' + (o.mode === "pickup" ? "Вземане" : "Доставка") + "</span><b>" + feeText(c) + "</b></div></div>" +
      '<div class="o-tot"><b>Общо</b><span class="price">' + fmt(L30 ? L30.total : T) + "</span></div></div></div>";
  }
  function sendState(o: OfficeOrder, c: Ctx) {
    const T = total(o);
    if (c.sent) return { ok: false, lbl: "Поръчката е изпратена" };
    if (c.late) return { ok: false, lbl: "Обедното меню за днес приключи" };
    if (!T) return { ok: false, lbl: "Добавете поне едно ястие" };
    if (c.day === "tomorrow" || c.day === "later") return { ok: false, lbl: "Изпраща се " + c.dayWord + " в " + clock(c.dl) };
    if (c.early) return { ok: false, lbl: "Изпращане след 10:00" };
    /* after 15:00 only pickup, with -30% (decision 12.11: the button is "Поръчай за вземане") */
    if (c.lunchOff) return { ok: true, lbl: "Поръчай за вземане · " + fmt(lunchPrice(allPicks(o)).total) };
    return { ok: true, lbl: "Изпрати на ресторанта · " + fmt(T) };
  }
  /** after 429 or "too_big" trying again is refused too: the main action is the call (decision 12.11) */
  let sendBlock = "";
  function sendBtn(o: OfficeOrder, c: Ctx, cls: string) {
    const s = sendState(o, c);
    if (sendBlock && s.ok) return callBtn("pill pill-red " + cls, "data-callsend");
    return '<button class="pill pill-red ' + cls + '" type="button" data-act="send"' + (s.ok ? "" : " disabled") + ">" + s.lbl + "</button>";
  }
  /** the truth about the deadline: the core sends by itself only with the phone given at create (L.auto; unknown on another device) */
  function sendNote(o: OfficeOrder, c: Ctx) {
    if (c.closed || c.late) return "";
    const when = (c.day === "tomorrow" ? "Утре в " : c.day === "later" ? "На " + esc(c.dayWord) + " в " : "В ") + clock(c.dl);
    const auto = o.hasContact != null ? o.hasContact : L.auto[o.code];
    const first = auto === true ? when + " поръчката тръгва към ресторанта сама."
      : auto === false ? when + " списъкът се затваря. Поръчката не тръгва сама (при създаването нямаше телефон): изпратете я с бутона."
      : when + " списъкът се затваря. Ако при създаването сте дали телефон, поръчката тръгва сама; иначе я изпратете с бутона.";
    const tail = c.day === "tomorrow" || c.day === "later" ? " Дотогава колегите могат да избират." : auto === true ? " Можете да я изпратите и по-рано: тогава списъкът се затваря." : " Можете да я изпратите и по-рано.";
    return '<p class="o-fine">' + ic("info", 18) + "<span>" + first + tail + "</span></p>";
  }
  /** what api.office.update answered (under the way of paying, or under the phone when everyone pays their own) */
  const CONTACT_NOTE = '<span class="help o-saved" data-contactnote role="status"></span>';
  /** "Как плащате": the three ways of the site with the same words as the cart (PAY_LABEL; the core takes all three) */
  function payHTML(o: OfficeOrder) {
    const pays: [PayMethod, string, string][] = [["cash", "money", o.mode === "pickup" ? "В ресторанта" : "На шофьора"], ["card", "credit-card", "Visa или Mastercard"], ["voucher", "ticket", "Или подаръчна карта"]];
    return '<div class="field"><fieldset class="o-choice"><legend class="label">Как плащате</legend>' +
      pays.map((p) => '<label class="o-opt"><input type="radio" name="opay" value="' + p[0] + '"' + (L.pay === p[0] ? " checked" : "") + '><span class="o-fi">' + ic(p[1], 22) + "</span><span><b>" + PAY_LABEL[p[0]] + '</b><span class="muted">' + p[2] + '</span></span><span class="o-radio">' + ic("check", 16) + "</span></label>").join("") +
      '<span class="help">При получаване. Без онлайн плащане.</span></fieldset>' + CONTACT_NOTE + "</div>";
  }
  function viewList(o: OfficeOrder) {
    const c = ctx(o), list = eaters(o), N = totalCount(o);
    const payFields = '<div class="shell"><div class="core o-card" style="display:grid;gap:18px"><h2 class="o-h3">За шофьора</h2>' +
      '<div class="field"><label for="o-phone">Вашият телефон' + (o.hasContact ? ' <span class="muted" style="font-weight:600">(по желание)</span>' : "") + '</label><input class="input" id="o-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0888 12 34 56" value="' + esc(L.phone) + '" aria-describedby="o-phone-h o-phone-e"><span class="help" id="o-phone-h"' + (o.hasContact && L.phone.trim() ? " hidden" : "") + ">" + (o.hasContact ? "Телефонът от създаването е при нас. Напишете друг само ако искате да ви търсим на него." : "Обаждаме се само ако има въпрос по поръчката.") + '</span><span class="err" id="o-phone-e" data-err="phone" hidden></span>' + (o.payer === "one" ? "" : CONTACT_NOTE) + "</div>" +
      (o.payer === "one" ? payHTML(o) : "") +
      "<div data-senderr></div>" +
      '<div class="o-onlydesk o-sendinline" data-sendinline>' + sendBtn(o, c, "pill-lg pill-block") + "</div>" +
      '<div data-sendnote>' + sendNote(o, c) + "</div>" +
      (orgURL(o.code) && !c.sent ? '<button class="link" type="button" data-act="copyorg" style="min-height:48px">' + ic("lock", 18) + "Копирай връзката за вас</button>" : "") +
    "</div></div>";
    const html = '<section class="sec o-top">' + back("#share", "Назад: връзката за колегите") + stepper(3) +
      '<div class="o-lay"><div class="o-col">' +
        '<div><h1 class="h1" style="font-size:clamp(30px,8cqi,44px)">' + esc(o.office) + '</h1><p class="lead o-sub">' + (o.mode === "pickup" ? "Вземане от ресторанта · готово в " : "Доставка до " + esc(whereText(o)) + " · около ") + clock(c.eta) + "</p></div>" +
        '<div class="shell"><div class="core o-card" data-timer>' + timerHTML(o, c) + "</div></div>" +
        '<div class="shell"><div class="core o-card" style="padding-bottom:6px"><div class="row" style="justify-content:space-between;flex-wrap:wrap;row-gap:2px"><h2 class="o-h3" id="o-people-h" tabindex="-1">Кой какво поръча</h2><span class="muted small" style="font-weight:700" data-count>' + (N ? souls(list.length) + " · " + dishes(N) : "") + '</span></div><div class="o-people" data-people aria-live="polite">' + peopleHTML(o, c, new Set()) + "</div></div></div>" +
      '</div><aside class="o-aside o-col">' +
        '<div data-bill>' + billHTML(o, c) + "</div>" +
        '<div data-paybox>' + payBoxHTML(o) + "</div>" +
        payFields +
      "</aside></div></section>";
    bar(sendBtn(o, c, ""));
    return html;
  }
  /** live update of the list without touching the phone field */
  function updList(o: OfficeOrder, fresh: Set<string>) {
    const c = ctx(o), N = totalCount(o), list = eaters(o);
    const set = (sel: string, html: string) => { const el = main.querySelector(sel); if (el && el.innerHTML !== html) el.innerHTML = html; };
    set("[data-people]", peopleHTML(o, c, fresh));
    set("[data-count]", N ? souls(list.length) + " · " + dishes(N) : "");
    set("[data-bill]", billHTML(o, c));
    set("[data-paybox]", payBoxHTML(o));
    set("[data-timer]", timerHTML(o, c));
    set("[data-sendinline]", sendBtn(o, c, "pill-lg pill-block"));
    set("[data-sendnote]", sendNote(o, c));
    bar(sendBtn(o, c, ""));
  }

  /* ======================= picker (organizer and colleague) ======================= */
  function pickerHTML(picks: Picks, day: string) {
    const lunchDay = lunchIsToday() ? esc(DATA.dayName) + ", " + dateLong(dateOf(DATA.date)).split(", ")[1] : "Меню за " + esc(dateLong(dateOf(DATA.date)));
    pickDay = day;
    const stale = canOrder() ? "" : day === "tomorrow"
      ? note("warn", "calendar-dots", '<p><b>Обедното меню за утре още не е качено.</b> <span class="missing">[ЛИПСВА: обедното меню за утре]</span> Отдолу е последното меню, за справка. Отворете връзката утре сутрин.</p>')
      : note("warn", "calendar-dots", "<p><b>Обедното меню за днес още не е качено.</b> Отдолу е последното меню, за справка. Поръчки приемаме, щом качим менюто за деня.</p>");
    return '<section class="o-menu" aria-labelledby="o-menu-h"><div class="o-menu-h"><h2 class="h2" id="o-menu-h">Обедно меню</h2><p class="muted" style="margin:-6px 0 0;font-weight:600">' + lunchDay + "</p>" + stale +
      (day === "tomorrow" && canOrder() ? '<p class="missing small" style="margin:0">[ЛИПСВА: обедното меню за утре] Показваме последното качено.</p>' : "") +
      '<div class="chips" role="list">' + GROUPS.map((g) => '<button class="chip" type="button" role="listitem" data-jump="' + g.id + '">' + esc(g.n) + '<span class="n">' + g.items.length + "</span></button>").join("") + "</div></div>" +
      GROUPS.map((g) => '<div class="o-grp" id="' + g.id + '"><h3 class="h3">' + esc(g.n) + '</h3><div class="o-items">' + g.items.map((x) => itemHTML(x, picks[x.id] || 0, cnt(picks) >= MAX_PORTIONS)).join("") + "</div></div>").join("") + "</section>";
  }
  /** full: the person has MAX_PORTIONS already, so every "+" is aria-disabled (the click still says why, in a toast) */
  function itemHTML(x: Dish, q: number, full = false) {
    const out = isOut(x), dis = full ? ' aria-disabled="true"' : "";
    const ctrl = out || !canOrder() ? '<span class="o-slotempty" aria-hidden="true"></span>'
      : q ? '<span class="counter"><button type="button" data-q="-1" data-id="' + x.id + '" aria-label="Едно по-малко: ' + esc(x.n) + '">' + ic("minus", 20) + '</button><output aria-live="polite">' + q + '</output><button type="button" data-q="1" data-id="' + x.id + '"' + dis + ' aria-label="Още едно: ' + esc(x.n) + '">' + ic("plus", 20) + "</button></span>"
      : '<button class="plus" type="button" data-q="1" data-id="' + x.id + '"' + dis + ' aria-label="Избери ' + esc(x.n) + '">' + ic("plus", 22) + "</button>";
    return '<div class="o-item' + (out ? " out" : "") + (q ? " on" : "") + '" data-row="' + x.id + '">' + pic(x) + '<span><span class="nm">' + esc(x.n) + '</span><span class="meta"><span class="price">' + fmt(x.p) + "</span>" + (out ? '<span class="badge out">' + ic("clock", 16) + "Изчерпано днес</span>" : "") + "</span></span>" + ctrl + "</div>";
  }
  function minePicks(picks: Picks) {
    const ks = Object.keys(picks);
    if (!ks.length) return '<p class="muted" style="margin:6px 0 0">' + (canOrder() ? "Още нищо. Натиснете „+“ до ястие." : "Ще изберете, щом качим менюто за деня.") + "</p>";
    return '<div class="o-mine">' + ks.map((k) => '<div class="kv"><span>' + picks[k] + " × " + esc(byId[k].n) + '</span><span class="price">' + fmt(byId[k].p * picks[k]) + "</span></div>").join("") + "</div>";
  }
  const saveLbl = (p: Picks, verb: string) => (!canOrder() ? (pickDay === "tomorrow" ? "Менюто за утре още не е качено" : "Менюто за днес още не е качено") : sum(p) ? verb + " · " + fmt(sum(p)) : "Изберете ястие от менюто");
  const saveDis = (p: Picks) => (sum(p) && canOrder() ? "" : ' aria-disabled="true"');

  /* ======================= view: the organizer's own lunch ======================= */
  function viewMine(o: OfficeOrder) {
    const p = L.mine, c = ctx(o);
    if (c.closed || c.late) return viewList(o);
    const html = '<section class="sec o-top">' + back("#list", "Назад: общият списък") +
      '<div class="o-lay"><div class="o-col"><div><h1 class="h1" style="font-size:clamp(30px,8cqi,44px)">Вашият обяд</h1><p class="lead o-sub">Изберете какво искате и вие. Колегите го виждат в общия списък.</p></div>' + pickerHTML(p, c.day) + "</div>" +
      '<aside class="o-aside o-col o-onlydesk"><div class="shell"><div class="core o-card"><h2 class="o-h3">Вашият избор</h2><div data-mine>' + minePicks(p) + "</div>" +
      '<button class="pill pill-red pill-lg pill-block" type="button" data-act="savemine" style="margin-top:16px" data-savebtn' + saveDis(p) + ">" + saveLbl(p, "Запази моя избор") + "</button></div></div></aside></div></section>";
    bar('<button class="pill pill-red" type="button" data-act="savemine" data-savebtn' + saveDis(p) + ">" + saveLbl(p, "Запази моя избор") + "</button>");
    return html;
  }

  /* ======================= view: invited colleague ======================= */
  /** after 429 or "full" adding again is refused too: the main action is the call (decision 12.11) */
  let guestBlock = "";
  function guestOf(code: string): Guest { return (L.guests[code] = L.guests[code] || { name: "", picks: {}, done: false, as: "" }); }
  function viewInvalid() {
    return '<section class="sec o-top"><div class="shell" style="max-width:560px;margin:0 auto"><div class="core o-state"><div class="ill warn">' + ic("warning-circle", 40) + '</div><h1 class="h2">Тази връзка не работи</h1><p class="muted">Може поръчката вече да е изпратена или връзката да е непълна. Помолете колегата за нова връзка или поръчайте сами.</p>' +
      (api.demo ? '<p class="muted">В демото поръчката се пази само в браузъра, в който е отворена, затова връзката работи само там.</p>' : "") +
      '<div class="o-actions"><a class="pill pill-red pill-lg pill-block" href="' + SC.url.lunch() + '">Към обедното меню</a><a class="pill pill-line pill-block" href="' + SC.url.page("office", "o-create") + '" data-act="toform">Започни обща поръчка</a></div></div></div></section>';
  }
  function viewJoin(o: OfficeOrder) {
    const c = ctx(o), org = orgOf(o), g = guestOf(o.code), gp = g.picks, s = sum(gp);
    if (c.closed || c.late) {
      return '<section class="sec o-top"><div class="shell" style="max-width:560px;margin:0 auto"><div class="core o-state"><div class="ill' + (c.sent ? " ok" : "") + '">' + ic(c.sent ? "check" : "clock", 40) + '</div><h1 class="h2">' + (c.sent ? "Поръчката е изпратена" : "Изборът приключи в " + clock(c.dl)) + "</h1>" +
        '<p class="muted">' + (c.sent ? esc(org) + " я изпрати на ресторанта." + (o.orderAt ? " " + (o.mode === "pickup" ? "Готова в " : "Пристига около ") + esc(o.orderAt) + "." : "") : esc(org) + " вече изпраща поръчката на ресторанта.") + (g.done && cnt(gp) ? " Вашият избор е вътре." : " Ако не сте успели, обадете се на " + esc(org) + " или поръчайте сами.") + "</p>" +
        (g.done && cnt(gp) ? '<div style="width:100%;text-align:left;margin-top:8px">' + minePicks(gp) + '<div class="o-tot"><b>' + (o.payer === "one" ? "Дължите на " + esc(org) : "Плащате при получаване") + '</b><span class="price">' + fmt(s) + "</span></div></div>" : "") +
        '<div class="o-actions"><a class="pill pill-red pill-lg pill-block" href="' + SC.url.lunch() + '">Поръчай си сам</a>' + callBtn("pill pill-line pill-block") + "</div></div></div></section>";
    }
    if (g.done) {
      return '<section class="sec o-top"><div class="o-lay"><div class="o-col">' +
        '<div class="shell"><div class="core o-state" style="padding-top:30px"><div class="ill ok">' + ic("check", 40) + '</div><h1 class="h2">Готово, ' + esc(g.as || g.name.trim()) + '!</h1><p class="muted">Вашият избор е в общата поръчка. Може да го промените до ' + clock(c.dl) + ".</p>" +
        '<div style="width:100%;text-align:left;margin-top:8px">' + minePicks(gp) + '<div class="o-tot"><b>' + (o.payer === "one" ? "Дължите на " + esc(org) : "Плащате при получаване") + '</b><span class="price">' + fmt(s) + "</span></div></div>" +
        '<div class="o-actions"><button class="pill pill-line pill-lg pill-block" type="button" data-act="guestedit">' + ic("pencil-simple", 20) + "Промени избора</button></div></div></div>" +
        '</div><aside class="o-aside o-col"><div class="shell"><div class="core o-card" style="padding-bottom:6px"><h2 class="o-h3">Кой какво поръча</h2><div class="o-people" data-people aria-live="polite">' +
          people(o, true).map((p) => person(p, { guestView: true })).join("") + "</div></div></div></aside></div></section>";
    }
    const invite = '<div class="o-invite shell"><div class="core"><span class="o-eyebrow" style="margin-bottom:16px">' + ic("hand-waving", 18) + "Покана за обяд</span>" +
      '<div class="o-invite-h"><span class="o-ava me" style="width:52px;height:52px;font-size:20px">' + initial(org) + '</span><div><h1 class="h2">' + esc(org) + " поръчва обяд за офиса</h1></div></div>" +
      '<div class="o-kv" style="margin-top:12px">' +
        '<div class="kv"><span>Офис</span><b>' + esc(o.office) + "</b></div>" +
        '<div class="kv"><span>' + (o.mode === "pickup" ? "Вземане" : "Доставка до") + "</span><b>" + esc(whereText(o)) + "</b></div>" +
        '<div class="kv"><span>Плаща</span><b>' + (o.payer === "one" ? esc(org) + " за всички" : "всеки своето") + "</b></div></div>" +
      '<div style="margin-top:16px"><span class="o-pill-time">' + ic("timer", 18) + "<span>" + (c.day === "tomorrow" ? "Утре до " : c.day === "today" ? "До " : esc(c.dayWord) + " до ") + clock(c.dl) + ' <span class="muted">· остават <span data-leftw>' + leftWords(c.remain) + "</span></span></span></span></div>" +
    "</div></div>";
    const html = '<section class="sec o-top"><div class="o-lay"><div class="o-col">' + invite +
      '<div class="field"><label for="o-gname">Вашето име</label><input class="input" id="o-gname" autocomplete="given-name" placeholder="Например: Николай" value="' + esc(g.name) + '" aria-describedby="o-gname-h o-gname-e"><span class="help" id="o-gname-h">Така ' + esc(org) + ' ще знае чие е ястието. Без профил.</span><span class="err" id="o-gname-e" data-err="gname" hidden></span></div>' +
      '<div data-joinerr></div>' +
      pickerHTML(gp, c.day) + "</div>" +
      '<aside class="o-aside o-col o-onlydesk"><div class="shell"><div class="core o-card"><h2 class="o-h3">Вашият избор</h2><div data-mine>' + minePicks(gp) + "</div>" +
        (guestBlock ? '<div style="margin-top:16px">' + callBtn("pill pill-red pill-lg pill-block") + "</div>" : '<button class="pill pill-red pill-lg pill-block" type="button" data-act="guestsave" data-savebtn' + saveDis(gp) + ' style="margin-top:16px">' + saveLbl(gp, "Добави към поръчката") + "</button>") +
        '<p class="o-fine" style="margin-top:12px">' + ic("info", 18) + "<span>" + (o.payer === "one" ? esc(org) + " плаща за всички. После си уреждате сметката." : "Плащате своето при получаване: " + PAYS_TEXT + ".") + "</span></p></div></div></aside></div></section>";
    bar(guestBlock ? callBtn("pill pill-red") : '<button class="pill pill-red" type="button" data-act="guestsave" data-savebtn' + saveDis(gp) + ">" + saveLbl(gp, "Добави към поръчката") + "</button>");
    return html;
  }

  /* ======================= view: sent ======================= */
  /** sent by the core at the deadline (or from another device): the screen is built from the order itself */
  function ensureSent(o: OfficeOrder) {
    if (L.sent && L.sent.code === o.code) {
      /* one time and one total on every device: the order's own (the core keeps them in the office order) */
      if ((o.orderAt && L.sent.at !== o.orderAt) || (o.orderTotal != null && L.sent.total !== o.orderTotal)) { L.sent.at = o.orderAt || L.sent.at; L.sent.total = o.orderTotal ?? L.sent.total; save(); }
      return;
    }
    const list = eaters(o);
    L.sent = { code: o.code, no: o.orderNo || "", at: o.orderAt || clock(ctx(o).eta), total: o.orderTotal ?? total(o), count: totalCount(o), people: list.length,
      owe: list.filter((p) => !p.me).map((p) => [p.n, sum(p.picks)] as [string, number]), pays: o.payer, mode: o.mode as Mode, office: o.office };
    save();
  }
  function viewSent() {
    const S = L.sent;
    if (!S) return viewInvalid();
    return '<section class="sec o-top"><div class="shell" style="max-width:620px;margin:0 auto"><div class="core o-state">' +
      '<div class="ill ok">' + ic("check", 44) + '</div><h1 class="h2">Поръчката е изпратена</h1>' +
      '<p class="muted">Ресторантът я получи. Ще ви известим, когато тръгне към вас.</p>' +
      '<div class="o-sentmeta"><div><span>Поръчка</span><b>№ ' + esc(S.no) + "</b></div><div><span>" + (S.mode === "pickup" ? "Готова" : "Пристига около") + "</span><b>" + esc(S.at) + "</b></div><div><span>Ястия</span><b>" + S.count + " за " + souls(S.people) + '</b></div><div><span>Общо</span><b class="price">' + fmt(S.total) + "</b></div></div>" +
      (S.pays === "one" && S.owe.length ? '<div style="width:100%;max-width:420px;text-align:left"><h2 class="o-h3" style="font-size:17px;margin:12px 0 2px">Колегите ви дължат</h2><div class="o-owe">' + S.owe.map(([n, v]) => '<div class="kv"><span>' + esc(n) + '</span><span class="price">' + fmt(v) + "</span></div>").join("") + "</div></div>" : "") +
      '<div class="o-actions"><a class="pill pill-red pill-lg pill-block" href="' + SC.url.tracking({ no: S.no, key: S.key }) + '">Следи поръчката' + ic("arrow-right", 20) + "</a>" +
      '<button class="pill pill-line pill-block" type="button" data-act="copydone">' + ic("copy", 20) + "Копирай съобщение за чата</button></div>" +
      '<p class="muted small" style="max-width:420px;margin-top:6px">Обяд за офиса всеки ден с абонамент идва скоро. Интересува ли ви? <a class="link" href="tel:' + R.phoneIntl + '">' + esc(R.phone) + "</a></p>" +
      '<a class="link" href="' + SC.url.page("office", "o-create") + '" data-act="restart" style="min-height:48px">Започни нова обща поръчка</a>' +
    "</div></div></section>";
  }

  /* ======================= loading / error ======================= */
  function viewLoading(v: string) {
    if (v === "join") return '<section class="sec o-top" aria-busy="true"><div class="o-lay"><div class="o-col">' + skel(190, "border-radius:28px") + skel(52, "width:60%") +
      [0, 1, 2, 3].map(() => '<div class="row" style="gap:14px"><div class="skel" style="width:64px;height:64px;border-radius:18px;flex:none"></div><div style="flex:1;display:grid;gap:8px">' + skel(18) + skel(18, "width:40%") + "</div></div>").join("") +
      '</div><div class="o-col o-onlydesk">' + skel(260, "border-radius:28px") + '</div></div><span class="vh" role="status">' + loadingText("поръчката") + "</span></section>";
    return '<section class="sec o-top" aria-busy="true">' + stepper(v === "share" ? 2 : 3) + '<div class="o-lay"><div class="o-col">' + skel(150, "border-radius:28px") + skel(72) + skel(72) + skel(72) + '</div><div class="o-col">' + skel(220, "border-radius:28px") + '</div></div><span class="vh" role="status">' + loadingText("поръчката") + "</span></section>";
  }
  /** "Няма връзка с интернет" only offline; 5xx "Не успяхме да заредим поръчката" (stateBox, lib/ui.ts); 429: the call is the main action */
  function viewError() {
    const e = loadErr, code = e ? e.code : "server", other4xx = !!e && code !== "offline" && code !== "server" && e.status >= 400 && e.status < 500;
    const box = code === "throttled"
      ? '<div class="empty sc-state" role="alert"><span class="ill">' + ic("warning-circle", 44) + '</span><h1 class="h3">Твърде много опити</h1><p class="muted">Опитайте след 10 минути или ни се обадете.</p><div class="acts">' + callBtn("pill pill-red") + "</div></div>"
      : stateBox({ kind: code === "offline" ? "offline" : "error", what: "поръчката", h: "h1", retry: 'data-act="retry"', ...(other4xx ? { text: esc(e!.message) } : {}) });
    return '<section class="sec o-top"><div class="o-errview">' + box + "</div></section>";
  }
  /** this browser opened the list without the organizer key (the core: isOrg false): the core's words, no send button */
  function viewNotOrg(o: OfficeOrder) {
    return '<section class="sec o-top"><div class="shell" style="max-width:560px;margin:0 auto"><div class="core o-state"><div class="ill warn">' + ic("lock", 40) + '</div><h1 class="h2">Отворете връзката за организатора</h1>' +
      '<p class="muted">Тази връзка не е на организатора на поръчката. Отворете „Връзка само за вас“ на устройството, на което създадохте поръчката: оттам виждате списъка и я изпращате.</p>' +
      '<div class="o-actions"><a class="pill pill-red pill-lg pill-block" href="#join-' + esc(o.code) + '">Вижте поканата</a>' + callBtn("pill pill-line pill-block") + "</div></div></div></section>";
  }

  /* ======================= prototype panel (only ?preview=1) ======================= */
  function protoPanel(v: string) {
    if (!SC.preview) return "";
    const code = L.code || "000000";
    const views = [["", "1. Създаване", "start"], ["share", "2. Връзка", "share"], ["list", "3. Общ списък", "list"], ["join-" + code, "Поканен колега", "join"], ["sent", "Изпратена", "sent"]];
    const states: [keyof typeof sim, string][] = [["closed", "Крайният час мина"], ["offline", PV.offline], ["loading", PV.loading]];
    return previewPanel('<h3>Изгледи</h3>' + views.map((x) => '<a class="chip" href="#' + x[0] + '"' + (v === x[2] ? ' aria-current="true"' : "") + ">" + x[1] + "</a>").join("") +
      "<h3>Колеги</h3><button class=\"chip\" type=\"button\" data-act=\"team\"" + (L.code ? "" : " disabled") + ">" + ic("users", 18) + "Добави 3 примерни колеги</button>" +
      "<h3>Състояния</h3>" + states.map((x) => pvToggle(x[1], sim[x[0]], 'data-sim="' + x[0] + '"')).join("") +
      '<a class="chip" href="#join-000000">Грешна връзка</a><button class="chip" type="button" data-act="reset">' + ic("trash", 18) + "Изчисти данните</button>",
      { id: "o-proto-h", text: "Изгледи на групата и състояния. Часът се сменя с ?t=12:30 в адреса. Тези бутони ги няма на истинския сайт." });
  }

  /* ---------- floating action bar (in the .ov layer) ---------- */
  function bar(inner: string | null) {
    SC.ov.querySelector(".o-bar")?.remove();
    const fab = SC.ov.querySelector(".aifab");
    if (!inner) { fab?.classList.remove("up"); return; }
    SC.ov.insertAdjacentHTML("beforeend", '<div class="abar o-bar">' + inner + "</div>"); fab?.classList.add("up");
  }

  /* ======================= routing and render ======================= */
  type Route = { v: "start" | "share" | "list" | "mine" | "join" | "sent" | "org"; code?: string; key?: string };
  function route(): Route {
    const h = decodeURIComponent(location.hash.slice(1));
    const m = /^join-?([A-Za-z0-9]*)/.exec(h);
    if (m) return { v: "join", code: m[1] };
    const g = /^list-(\d+)-([A-Za-z0-9]+)$/.exec(h);
    if (g) return { v: "org", code: g[1], key: g[2] };
    if (h === "share" || h === "list" || h === "mine" || h === "sent") return { v: h };
    return { v: "start" };
  }
  const codeFor = (rt: Route) => (rt.v === "join" || rt.v === "org" ? rt.code || "" : rt.v === "share" || rt.v === "list" || rt.v === "mine" ? L.code : "");

  let lastV: string | null = null, tick: ReturnType<typeof setInterval> | undefined, poll: ReturnType<typeof setInterval> | undefined;
  /** the title of the new view gets the focus once it is drawn (after the loading skeleton, if there is one) */
  let focusNext = false;
  function render(keepScroll = false, focus = false) {
    const rt = route();
    const changed = lastV !== null && lastV !== rt.v;
    if (changed) { sendBlock = ""; guestBlock = ""; }
    if (changed || focus) focusNext = true;
    clearInterval(tick); bar(null);
    const isStart = rt.v === "start";
    startEl.hidden = !isStart; viewEl.hidden = isStart;
    if (isStart) {
      createEl.innerHTML = formHTML(); updEta();
      viewEl.innerHTML = "";
    } else {
      const code = codeFor(rt);
      let html: string;
      if (rt.v === "sent") html = viewSent();
      else if (sim.loading || loading) html = viewLoading(rt.v);
      else if (loadErr && Ocode !== code) html = viewError();
      else if (loadErr && !O) html = viewError();
      else if (!O || O.code !== code) html = viewInvalid();
      else if (rt.v === "join") html = viewJoin(O);
      else if (O.status !== "open" && isMine(O)) { ensureSent(O); html = viewSent(); }
      else if (!isMine(O)) html = viewNotOrg(O);
      else if (rt.v === "share") html = viewShare(O);
      else if (rt.v === "mine") html = viewMine(O);
      else html = viewList(O);
      viewEl.innerHTML = html;
    }
    protoEl.innerHTML = protoPanel(rt.v);
    if (!keepScroll && changed) window.scrollTo(0, 0);
    lastV = rt.v;
    if (focusNext && !(sim.loading || loading)) { focusNext = false; focusTitle(isStart ? createEl.querySelector<HTMLElement>("#o-create-h") : viewEl.querySelector<HTMLElement>("h1")); }
    if (rt.v === "list" || rt.v === "join" || rt.v === "share") tick = setInterval(liveTick, 1000);
    SC.reveal();
  }
  /** route change: load the order the view needs, then draw */
  async function go(keepScroll = false) {
    const rt = route();
    if (rt.v === "org") { await openOrgLink(rt.code || "", rt.key || ""); return; }
    const code = codeFor(rt);
    if ((rt.v === "share" || rt.v === "list" || rt.v === "mine") && !L.code) { if (L.sent) { location.hash = "sent"; return; } location.hash = ""; return; }
    if (rt.v === "mine" && O && O.code === L.code) L.mine = picksOf(O.participants[0]?.lines || []);
    if (code && (Ocode !== code || loadErr)) {
      loading = true; render(keepScroll);
      await fetchO(code);
      loading = false;
      if (rt.v === "mine" && O) L.mine = picksOf(O.participants[0]?.lines || []);
    }
    render(keepScroll);
  }
  /** the organizer's link on another device: the core checks the key (isOrg), this browser keeps it and becomes the organizer */
  async function openOrgLink(code: string, key: string) {
    loading = true; render();
    let r: OfficeOrder | null = null, err: ApiError | null = null;
    try { r = (await api.office.get(code, key)) as OfficeOrder | null; } catch (e) { err = e instanceof ApiError ? e : new ApiError("server", "Нещо се обърка. Опитайте пак."); }
    loading = false;
    if (r && r.isOrg) {
      O = r; Ocode = code; loadErr = null;
      if (L.code !== code) { L.code = code; L.me = orgOf(r); L.mine = picksOf(r.participants[0]?.lines || []); L.sent = null; }
      if (r.date) L.days[code] = r.date;
      save();
      history.replaceState(null, "", location.pathname + location.search + "#list"); /* the key leaves the address bar */
      go(); return;
    }
    O = null; Ocode = code; loadErr = err && err.code !== "not_found" ? err : null;
    render();
  }
  async function fetchO(code: string, quiet = false): Promise<boolean> {
    try { O = (await api.office.get(code)) as OfficeOrder | null; Ocode = code; loadErr = null; return true; }
    catch (e) {
      if (e instanceof ApiError && e.code === "not_found") { O = null; Ocode = code; loadErr = null; return true; }
      if (!quiet) { loadErr = e instanceof ApiError ? e : new ApiError("server", "Нещо се обърка. Опитайте пак."); Ocode = code; O = null; } return false; }
  }
  /** a colleague joined (SSE on the server, BroadcastChannel in the demo) or the poll: refresh the visible order */
  let refreshing = false;
  async function refresh() {
    if (!Ocode || refreshing) return;
    refreshing = true;
    const before = O ? new Map(people(O).map((p) => [p.n, JSON.stringify(p.picks)])) : new Map<string, string>(), was = O?.status;
    const ok = await fetchO(Ocode, true);
    refreshing = false;
    if (!ok || !O) return;
    const fresh = new Set(people(O).filter((p) => before.get(p.n) !== JSON.stringify(p.picks)).map((p) => p.n));
    const v = route().v;
    if (O.status !== was) { render(true); return; }
    if (v === "list" && isMine(O)) updList(O, fresh);
    else if (v === "join" && guestOf(O.code).done) { const el = main.querySelector("[data-people]"); if (el) el.innerHTML = people(O, true).map((p) => person(p, { guestView: true })).join(""); }
  }
  api.on("office.updated", (d) => { const x = d as { code?: string }; if (x && x.code === Ocode) refresh(); });
  poll = setInterval(() => { const v = route().v; if (!document.hidden && (v === "list" || v === "share" || v === "join")) refresh(); }, 15000);
  void poll;

  function liveTick() {
    if (!O) return;
    const c = ctx(O), v = route().v;
    if (c.remain <= 0 && !sim.closed && O.status === "open" && !main.querySelector("[data-timer] .o-closed, .o-state")) {
      if (v === "list") updList(O, new Set()); else render(true);
      /* the core sends it now (server: within a minute; demo: on the next call): read the order again */
      setTimeout(refresh, 4000); setTimeout(refresh, 65000);
      return;
    }
    const el = main.querySelector("[data-left]"), w = main.querySelector("[data-leftw]"), tr = main.querySelector<HTMLElement>("[data-track]");
    if (el) el.innerHTML = left(c.remain);
    if (w) w.textContent = leftWords(c.remain);
    if (tr) tr.style.transform = "scaleX(" + trackScale(c) + ")";
  }

  /* ======================= interactions ======================= */
  /** the error under a field of the visible view (the hidden create form stays in the page) */
  function setErr(key: string, msg?: string) {
    const root = route().v === "start" ? createEl : viewEl;
    const e = root.querySelector<HTMLElement>('[data-err="' + key + '"]'); if (!e) return;
    const inp = root.querySelector<HTMLElement>("#" + e.id.replace(/-e$/, ""));
    e.hidden = !msg; e.textContent = msg || "";
    if (inp) inp.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function pickTarget(): Picks { const rt = route(); return rt.v === "mine" ? L.mine : guestOf(rt.code || "").picks; }
  function updPicker(id: string) {
    const picks = pickTarget(), row = main.querySelector('[data-row="' + id + '"]');
    let nr: Element | null = null;
    const full = cnt(picks) >= MAX_PORTIONS;
    if (row) { const tmp = document.createElement("div"); tmp.innerHTML = itemHTML(byId[id], picks[id] || 0, full); nr = tmp.firstElementChild; if (nr) row.replaceWith(nr); }
    /* every other "+" follows the per-person limit too */
    main.querySelectorAll<HTMLElement>('.o-items [data-q="1"]').forEach((b) => { if (full) b.setAttribute("aria-disabled", "true"); else b.removeAttribute("aria-disabled"); });
    const m = main.querySelector("[data-mine]"); if (m) m.innerHTML = minePicks(picks);
    const verb = route().v === "mine" ? "Запази моя избор" : "Добави към поръчката";
    document.querySelectorAll("[data-savebtn]").forEach((b) => { b.innerHTML = saveLbl(picks, verb); if (sum(picks)) b.removeAttribute("aria-disabled"); else b.setAttribute("aria-disabled", "true"); });
    return nr;
  }
  function busyBtns(sel: string, on: boolean, label?: string) {
    document.querySelectorAll<HTMLElement>(sel).forEach((b) => {
      if (on) { b.dataset.label = b.innerHTML; b.setAttribute("data-busy", ""); b.innerHTML = (label || b.innerHTML) + '<span class="o-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="vh" role="status">Изпращаме</span>'; }
      else if (b.dataset.label != null) { b.removeAttribute("data-busy"); b.innerHTML = b.dataset.label; delete b.dataset.label; }
    });
  }
  /** the core's errors in words for people (the core's own text, a few made clearer for this page) */
  function errText(err: unknown): string {
    if (!(err instanceof ApiError)) return "Не успяхме. Опитайте пак.";
    switch (err.code) {
      case "deadline": return "Крайният час мина и списъкът е затворен. Обадете се на организатора.";
      case "not_lunch": return "В общата поръчка са само ястия от обедното меню.";
      case "lunch_stale": return "Обедното меню за днес още не е качено. Поръчки приемаме, щом го качим.";
      case "too_early": return "Поръчката е за друг ден. Изпраща се в деня на обяда.";
      case "offline": return OFFLINE + ". Проверете връзката и опитайте пак.";
      case "too_many": return "До " + MAX_PORTIONS + " порции на човек. Махнете някое ястие и опитайте пак.";
      case "full": return "Поръчката е пълна: до " + ORDER_RULES.officeMaxPeople + " души. Поръчайте си сами или се обадете на " + R.phone + ".";
      case "too_big": return "Общата поръчка надхвърля " + fmt(ORDER_RULES.maxTotal) + ". За по-голяма поръчка се обадете на " + R.phone + ": ще я приготвим навреме.";
      case "throttled": return err.message || "Твърде много опити. Опитайте след 10 минути.";
      default: return err.message || "Не успяхме. Опитайте пак.";
    }
  }
  const offlineErr = () => new ApiError("offline", OFFLINE + ". Проверете връзката и опитайте пак.", 0);
  /** the error note of an action (decision 12.11, the cart): "Няма връзка с интернет" only offline, "Не успяхме да …" on 5xx,
      the call as the main action on 429, "full" and "too_big"; "запазен" only where nothing is lost (offline, 5xx) */
  function actErr(err: unknown, what: "create" | "send" | "add"): string {
    const e = err instanceof ApiError ? err : null, code = e ? e.code : "server";
    const retry = what === "create" ? '<button class="pill pill-red" type="submit">' + ic("arrow-clockwise", 20) + RETRY + "</button>"
      : '<button class="pill pill-red" type="button" data-act="' + (what === "send" ? "send" : "guestsave") + '">' + ic("arrow-clockwise", 20) + RETRY + "</button>";
    const kept = what === "send" ? "Списъкът е запазен, нищо не е изпратено." : what === "add" ? "Изборът ви е запазен в този браузър." : "Данните във формата са запазени.";
    const verb = what === "send" ? "изпратим поръчката" : what === "add" ? "добавим избора ви" : "отворим поръчката";
    if (code === "offline") return errNote(OFFLINE, kept + " Проверете връзката и опитайте пак.", retry + callBtn("pill pill-line"));
    if (code === "throttled") return errNote("Твърде много опити", "Опитайте след 10 минути или ни се обадете.", callBtn("pill pill-red"));
    if (code === "full") return errNote("Поръчката е пълна", "В една обща поръчка са до " + ORDER_RULES.officeMaxPeople + " души. Поръчайте си сами или ни се обадете.", callBtn("pill pill-red") + '<a class="pill pill-line" href="' + SC.url.lunch() + '">Поръчай си сам</a>');
    if (code === "too_big") return errNote("Голяма поръчка: обадете ни се", "Общата поръчка надхвърля " + fmt(ORDER_RULES.maxTotal) + ". За по-голяма поръчка се обадете: ще я приготвим навреме.", callBtn("pill pill-red"));
    if (!e || code === "server" || e.status >= 500) return errNote("Не успяхме да " + verb, kept + " Опитайте пак след малко или ни се обадете.", retry + callBtn("pill pill-line"));
    return errNote(what === "send" ? "Поръчката не е изпратена" : what === "add" ? "Изборът не е добавен" : "Поръчката не е отворена", esc(errText(e)), callBtn("pill pill-line"));
  }
  /** the error in its box: the title gets the focus and comes into view */
  function showErr(box: Element | null, html: string) { if (!box) return false; box.innerHTML = html; focusTitle(box.querySelector<HTMLElement>("[data-errh]")); return true; }

  /* ---------- the organizer's phone and way of paying, chosen later: to the core (api.office.update), for the automatic send ---------- */
  let contactSeq = 0;
  const contactNote = (txt: string) => { const el = main.querySelector("[data-contactnote]"); if (el) el.textContent = txt; };
  async function saveContact(what: "phone" | "pay") {
    if (!O || !isMine(O) || O.status !== "open") return;
    const raw = L.phone.trim(), phone = raw ? normPhone(raw) : "";
    if (what === "phone") {
      if (!raw) return; /* empty: the phone from the creation stays with the core */
      if (!phone) { setErr("phone", "Проверете номера: 10 цифри, например 0888 12 34 56."); return; }
    }
    /* the core keeps the way of paying only with a phone (contact); without one it goes with the send */
    if (!phone && !O.hasContact) { contactNote(""); return; }
    const code = O.code, seq = ++contactSeq, pay: PayMethod = O.payer === "one" ? L.pay : "cash";
    try {
      if (sim.offline) throw offlineErr();
      const r = (await api.office.update(code, null, { name: orgOf(O), pay, ...(phone ? { phone } : {}) })) as OfficeOrder;
      if (seq !== contactSeq || !O || O.code !== code) return;
      O = r; L.auto[code] = !!r.hasContact; save();
      const c = ctx(O);
      contactNote(what === "pay" ? "Запазено: " + PAY_LABEL[pay] + "." : c.closed ? "Запазено. Поръчката тръгва към ресторанта до минута." : "Запазено. В крайния час поръчката тръгва сама с този телефон.");
      updList(O, new Set());
      if (c.closed) setTimeout(refresh, 4000);
    } catch (err) {
      if (seq !== contactSeq) return;
      const e = err instanceof ApiError ? err : null;
      if (e && e.fields && e.fields.phone) { setErr("phone", e.fields.phone); return; }
      if (e && e.code === "closed") { contactNote(e.message); await fetchO(code, true); render(true); return; }
      contactNote(e && e.code === "offline" ? OFFLINE + ". Запазихме го в този браузър. Изпратете поръчката с бутона, когато връзката се върне."
        : e && e.code === "forbidden" ? e.message : "Не успяхме да го запазим. Изпратете поръчката с бутона.");
    }
  }

  main.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement, d = L.draft;
    if (t.id === "o-office") { d.office = t.value; save(); setErr("office"); updEta(); }
    else if (t.id === "o-name") { d.name = t.value; save(); setErr("name"); updEta(); }
    else if (t.id === "o-addr") { d.addr = t.value; save(); setErr("addr"); updAddr(true); }
    else if (t.id === "o-phone") { L.phone = t.value; save(); setErr("phone"); if (O && O.hasContact) { const h = document.getElementById("o-phone-h"); if (h) h.hidden = !!t.value.trim(); } }
    else if (t.id === "o-cphone") { L.phone = t.value; save(); setErr("cphone"); }
    else if (t.id === "o-gname") { const rt = route(); guestOf(rt.code || "").name = t.value; save(); setErr("gname"); }
  });
  main.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === "pays") { L.draft.pays = t.value === "each" ? "each" : "one"; save(); updEta(); }
    else if (t.name === "opay") { L.pay = PAY_LABEL[t.value as PayMethod] ? (t.value as PayMethod) : "cash"; save(); void saveContact("pay"); }
    else if (t.id === "o-phone") void saveContact("phone");
  });

  main.addEventListener("submit", async (e) => {
    const f = e.target as HTMLElement;
    if (!f.matches("[data-form]")) return;
    e.preventDefault();
    const d = L.draft, name = d.name.trim();
    let bad: string | null = null;
    if (!name) { setErr("name", "Напишете името си, за да знаят колегите от кого е поканата."); bad = bad || "o-name"; }
    if (d.mode !== "pickup") {
      const r = zr();
      if (!d.addr.trim()) { setErr("addr", "Напишете адреса на офиса или изберете квартала отдолу."); bad = bad || "o-addr"; }
      else if (r.type === "out") { setErr("addr", "До този адрес не доставяме. Изберете „Ще я вземем от ресторанта“."); bad = bad || "o-addr"; }
      else if (r.type !== "zone") { setErr("addr", "Допишете квартала, за да проверим дали доставяме, например „Дружба 2“."); bad = bad || "o-addr"; }
    }
    const phoneRaw = L.phone.trim(), phone = phoneRaw ? normPhone(phoneRaw) : "";
    if (phoneRaw && !phone) { setErr("cphone", "Проверете номера: 10 цифри, например 0888 12 34 56. Или го оставете празен."); bad = bad || "o-cphone"; }
    if (bad) { const el = document.getElementById(bad); scrollToEl(el); focusLater(el); return; }
    const box = main.querySelector("[data-formerr]"); if (box) box.innerHTML = "";
    busyBtns("[data-create-btn]", true);
    try {
      if (sim.offline) throw offlineErr();
      syncPlan();
      /* the organizer's name and phone go to the core: with them the order leaves at the deadline by itself */
      const o = (await api.office.create({
        office: officeName(d), addr: d.mode === "pickup" ? "" : d.addr.trim(), deadline: hhmm(d.deadline || 690), payer: d.pays, mode: d.mode,
        name, ...(phone ? { phone, pay: L.pay } : {}),
      })) as unknown as OfficeOrder;
      await api.office.join(o.code, { name, lines: [] });
      L.code = o.code; L.me = name; L.mine = {}; L.sent = null;
      L.days[o.code] = o.date || (d.day === "tomorrow" ? addDays(today(), 1) : today());
      L.auto[o.code] = !!phone;
      save();
      Ocode = ""; location.hash = "share";
    } catch (err) {
      busyBtns("[data-create-btn]", false);
      if (err instanceof ApiError && err.fields) {
        /* core field -> the field on this form */
        const map: Record<string, string> = { office: "office", name: "name", addr: "addr", phone: "cphone", deadline: "deadline" };
        const ids: Record<string, string> = { office: "o-office", name: "o-name", addr: "o-addr", cphone: "o-cphone", deadline: "o-slots" };
        let first = "";
        Object.entries(err.fields).forEach(([k, v]) => { const key = map[k]; if (key) { setErr(key, v); first = first || ids[key]; } });
        if (first) { const el = document.getElementById(first); scrollToEl(el); focusLater((el && el.matches("[role=group]") ? el.querySelector<HTMLElement>("button:not([disabled])") : el) || el); return; }
      }
      /* one message: under the button (a toast would cover it on a phone), its title gets the focus */
      if (!showErr(box, actErr(err, "create"))) SC.toast(err instanceof ApiError ? err.message : "Нещо се обърка. Опитайте пак.");
    }
  });

  async function onClick(e: Event) {
    const t = (e.target as Element).closest<HTMLElement>("button, a");
    if (!t) return;
    const act = t.dataset.act;
    if (t.dataset.slot) { L.draft.deadline = +t.dataset.slot; save(); main.querySelectorAll("[data-slot]").forEach((b) => b.setAttribute("aria-pressed", String(b === t))); updEta(); return; }
    if (t.dataset.zone) { const n = t.dataset.zone; L.draft.addr = (/Дружба/.test(n) ? "ж.к. " : "") + n + ", "; save(); setErr("addr"); updAddr(false); const inp = document.getElementById("o-addr") as HTMLInputElement | null; if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } return; }
    if (t.dataset.jump) { scrollToEl(document.getElementById(t.dataset.jump)); return; }
    if (t.dataset.q && t.dataset.id) {
      const id = t.dataset.id, picks = pickTarget(), q = (picks[id] || 0) + +t.dataset.q;
      if (+t.dataset.q > 0 && cnt(picks) >= MAX_PORTIONS) { SC.toast("До " + MAX_PORTIONS + " порции на човек."); return; }
      if (q <= 0) delete picks[id]; else picks[id] = q;
      save(); SC.haptic();
      const nr = updPicker(id), f = nr && (nr.querySelector<HTMLElement>('[data-q="' + t.dataset.q + '"]') || nr.querySelector<HTMLElement>(".plus") || nr.querySelector<HTMLElement>('[data-q="1"]'));
      f?.focus({ preventScroll: true });
      return;
    }
    if (t.dataset.sim) { const k = t.dataset.sim as keyof typeof sim; sim[k] = !sim[k]; SC.toast((t.textContent || "").replace(/: (вкл|изкл)\.$/, "") + ": " + (sim[k] ? "вкл." : "изкл.")); render(true); return; }
    switch (act) {
      case "toform": {
        if (route().v !== "start") return; /* the href goes to the form */
        e.preventDefault(); scrollToEl(document.getElementById("o-create")); setTimeout(() => (document.getElementById("o-office") as HTMLElement | null)?.focus({ preventScroll: true }), SC.reduce ? 0 : 450); return;
      }
      case "pickup": L.draft.mode = "pickup"; save(); setErr("addr"); updAddr(false); return;
      case "delivery": L.draft.mode = "delivery"; save(); updAddr(false); return;
      case "copylink": if (O) { copy(joinURL(O.code)); SC.flash(t, ic("check", 22) + "Копирано", 1600); SC.toast("Връзката е копирана. Поставете я в чата."); } return;
      case "copyorg": if (O) { const u = orgURL(O.code); if (u) { copy(u); SC.flash(t, ic("check", 20) + "Копирано", 1600); SC.toast("Връзката за вас е копирана. Отворете я на другото устройство."); } } return;
      case "copymsg": if (O) { copy(chatMsg(O, ctx(O))); SC.toast("Съобщението е копирано"); } return;
      case "viber": if (O && !/Android|iPhone|iPad/i.test(navigator.userAgent)) { e.preventDefault(); copy(chatMsg(O, ctx(O))); SC.toast("Съобщението е копирано. Поставете го във Viber."); } return;
      case "sharenative": if (O) { const m = chatMsg(O, ctx(O)); if (navigator.share) navigator.share({ title: "Обяд от Siracusa", text: m }).catch(() => undefined); else { copy(m); SC.toast("Съобщението е копирано. Поставете го в чата."); } } return;
      case "copyowe": if (O) { copy("Обяд от Siracusa: " + eaters(O).filter((p) => !p.me).map((p) => p.n + " " + fmt(sum(p.picks))).join(", ")); SC.toast("Копирано. Поставете го в чата."); } return;
      case "copydone": if (L.sent) { copy("Обядът е поръчан, " + (L.sent.mode === "pickup" ? "готов е около " : "пристига около ") + L.sent.at + ". Благодаря!"); SC.toast("Съобщението е копирано"); } return;
      case "drop": {
        if (!O) return;
        const who = t.dataset.who || "", p = O.participants.find((x) => x.name === who);
        if (!p) return;
        const old = p.lines, code = O.code;
        try {
          O = (await api.office.join(code, { name: who, lines: [] })) as OfficeOrder; updList(O, new Set());
          focusTitle(main.querySelector<HTMLElement>("#o-people-h")); /* the button is gone: the focus never falls to <body> */
          SC.toast(who + " е махнат(а) от поръчката", async () => { try { O = (await api.office.join(code, { name: who, lines: old })) as OfficeOrder; updList(O, new Set([who])); focusTitle(main.querySelector<HTMLElement>("#o-people-h")); } catch (err) { SC.toast(err instanceof ApiError ? err.message : "Не успяхме. Опитайте пак."); } });
        } catch (err) { SC.toast(err instanceof ApiError ? err.message : "Не успяхме. Опитайте пак."); }
        return;
      }
      case "savemine": {
        if (!O) return;
        if (!canOrder()) { SC.toast(pickDay === "tomorrow" ? "Обедното меню за утре още не е качено." : "Обедното меню за днес още не е качено."); return; }
        if (!sum(L.mine)) { SC.toast("Изберете поне едно ястие"); return; }
        if (t.hasAttribute("data-busy")) return;
        busyBtns("[data-savebtn]", true);
        try {
          if (sim.offline) throw offlineErr();
          O = (await api.office.join(O.code, { name: orgOf(O), lines: linesOf(L.mine) })) as OfficeOrder; save();
          SC.toast("Изборът ви е в общия списък ✓"); location.hash = "list";
        } catch (err) { busyBtns("[data-savebtn]", false); SC.toast(errText(err)); if (err instanceof ApiError && (err.code === "closed" || err.code === "deadline")) { await fetchO(O.code, true); render(true); } }
        return;
      }
      case "guestsave": {
        if (!O) return;
        const g = guestOf(O.code), name = g.name.trim().replace(/\s+/g, " "), org = orgOf(O);
        if (!name) { setErr("gname", "Напишете името си, за да знае " + org + " чие е ястието."); const gi = document.getElementById("o-gname"); scrollToEl(gi); focusLater(gi); return; }
        const taken = O.participants.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.name !== g.as);
        if (taken) { setErr("gname", "„" + name + "“ вече е в поръчката. Добавете първата буква от фамилията, например „" + name + " П.“"); const gi = document.getElementById("o-gname"); scrollToEl(gi); focusLater(gi); return; }
        if (!canOrder()) { SC.toast(pickDay === "tomorrow" ? "Обедното меню за утре още не е качено." : "Обедното меню за днес още не е качено."); return; }
        if (!sum(g.picks)) { SC.toast("Изберете поне едно ястие"); return; }
        if (t.hasAttribute("data-busy")) return;
        const box = main.querySelector("[data-joinerr]"); if (box) box.innerHTML = "";
        busyBtns("[data-savebtn]", true);
        try {
          if (sim.offline) throw offlineErr();
          /* a colleague renames their own entry by its pid (the core); the organizer's browser writes by name: clear the old one */
          if (g.as && g.as !== name && api.office.orgKey(O.code)) await api.office.join(O.code, { name: g.as, lines: [] });
          O = (await api.office.join(O.code, { name, lines: linesOf(g.picks) })) as OfficeOrder;
          g.as = name; g.name = name; g.done = true; save(); render(false, true);
        } catch (err) {
          busyBtns("[data-savebtn]", false);
          if (err instanceof ApiError && (err.code === "closed" || err.code === "not_found" || err.code === "deadline")) { SC.toast(errText(err)); await fetchO(O.code, true); render(true); return; }
          if (err instanceof ApiError && err.code === "name_taken") { setErr("gname", (err.fields && err.fields.name) || err.message); const gi = document.getElementById("o-gname"); scrollToEl(gi); focusLater(gi); return; }
          if (err instanceof ApiError && (err.code === "throttled" || err.code === "full")) {
            guestBlock = err.code;
            document.querySelectorAll<HTMLElement>('[data-act="guestsave"][data-savebtn]').forEach((b) => { b.outerHTML = callBtn(b.className); });
          }
          if (!showErr(box, actErr(err, "add"))) SC.toast(errText(err));
        }
        return;
      }
      case "guestedit": if (O) { guestOf(O.code).done = false; save(); render(false, true); } return;
      case "restart": e.preventDefault(); L.code = ""; L.me = ""; L.mine = {}; L.sent = null; O = null; Ocode = ""; save(); sim.closed = false; if (location.hash && location.hash !== "#o-create") location.hash = "o-create"; else go(); return;
      case "retry": loadErr = null; Ocode = ""; go(true); return;
      case "team": {
        if (!L.code) return;
        try { for (const tm of DATA.team) await api.office.join(L.code, { name: tm.n, lines: linesOf(tm.picks) }); await refresh(); if (route().v !== "list") location.hash = "list"; else render(true); SC.toast("Добавени: Иван, Петя, Георги"); }
        catch (err) { SC.toast(err instanceof ApiError ? err.message : "Не успяхме."); }
        return;
      }
      case "reset": {
        Object.assign(L, JSON.parse(JSON.stringify(DEF))); save(); sim.closed = sim.offline = sim.loading = false; O = null; Ocode = "";
        SC.toast("Данните от прегледа са изчистени"); if (location.hash) location.hash = ""; else render(); return;
      }
      case "send": if (!t.hasAttribute("data-busy")) send(t); return;
    }
  }
  main.addEventListener("click", onClick);
  SC.ov.addEventListener("click", (e) => { if ((e.target as Element).closest(".o-bar")) onClick(e); });

  /* ---------- send to the restaurant: api.office.submit -> an order (channel "office") ---------- */
  async function send(btn: HTMLElement | null) {
    if (!O) return;
    const phone = normPhone(L.phone), errBox = main.querySelector("[data-senderr]");
    if (errBox) errBox.innerHTML = "";
    const hasContact = !!O.hasContact;
    if (!phone && !(hasContact && !L.phone.trim())) {
      setErr("phone", L.phone.trim() ? "Проверете номера: 10 цифри, например 0888 12 34 56." : "Напишете телефон, за да ви се обадим, ако има въпрос.");
      const p = document.getElementById("o-phone"); scrollToEl(p); focusLater(p); return;
    }
    const o = O, me = orgOf(o), list = eaters(o);
    contactSeq++; /* the phone goes with the send: a late answer of api.office.update does not matter any more */
    busyBtns('[data-act="send"]', true);
    const lines = list.map((p) => p.n + ": " + Object.keys(p.picks).map((k) => p.picks[k] + " × " + byId[k].n).join(", ") + " (" + fmt(sum(p.picks)) + ")").join("; ");
    const noteText = "Обща поръчка за офиса „" + o.office + "“, " + souls(list.length) + ". " + (o.payer === "each" ? "Всеки плаща своето. " : "Плаща " + me + " за всички. ") + lines;
    try {
      if (sim.offline) throw offlineErr();
      /* the core sends once: a second call (two tabs, the deadline) is refused with "closed" */
      /* without a phone here the core takes the one given at create (hasContact) */
      const r = (await api.office.submit(o.code, { name: me, ...(phone ? { phone } : {}), pay: o.payer === "one" ? L.pay : "cash", note: noteText } as Parameters<typeof api.office.submit>[1])) as unknown as { office: OfficeOrder; order: Order };
      O = r.office;
      const owe = list.filter((p) => !p.me).map((p) => [p.n, sum(p.picks)] as [string, number]);
      /* "Пристига около" and "Общо": the order's own (the same on every device) */
      L.sent = { code: o.code, no: r.order.no, key: r.order.key, at: r.office.orderAt || r.order.at, total: r.office.orderTotal ?? r.order.total, count: totalCount(o), people: list.length, owe, pays: o.payer, mode: o.mode as Mode, office: o.office };
      save();
      SC.store("sc-order", r.order); /* the tracking page can show it at once */
      location.hash = "sent";
    } catch (err) {
      busyBtns('[data-act="send"]', false);
      const e = err instanceof ApiError ? err : null;
      if (e && e.fields && e.fields.phone) { setErr("phone", e.fields.phone); const p = document.getElementById("o-phone"); scrollToEl(p); focusLater(p); return; }
      if (e && e.code === "closed") { SC.toast(e.message); await fetchO(o.code, true); render(true); return; } /* already sent: the sent screen */
      if (e && (e.code === "throttled" || e.code === "too_big")) { sendBlock = e.code; if (O) updList(O, new Set()); } /* the send buttons become the call */
      if (!showErr(main.querySelector("[data-senderr]"), actErr(err, "send"))) SC.toast(errText(err));
    }
    void btn;
  }

  /* ---------- start ---------- */
  const lunchLink = main.querySelector("[data-lunchlink]");
  if (lunchLink) lunchLink.innerHTML = (lunchIsToday() ? "Виж днешното обедно меню" : "Виж обедното меню") + ic("caret-right", 18);
  window.addEventListener("hashchange", () => { if (location.hash === "#o-create" && route().v === "start" && lastV === "start") return; go(); });
  go().then(() => { if (location.hash === "#o-create") scrollToEl(document.getElementById("o-create")); });
}
