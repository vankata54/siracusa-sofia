/* Обща поръчка за офиса: the browser part (port of the script in design/pages/office.html).
   Views in the address hash:
     ""            create form (the rest of the start view is drawn on the server)
     #share        link for colleagues (organizer)
     #list         shared list, timer, bill, send (organizer)
     #mine         the organizer's own lunch
     #join-<код>   invited colleague: name + lunch menu, no profile
     #sent         sent to the restaurant
   The order lives in the core (api.office.*: server, or localStorage core in the demo). localStorage "sc-office" keeps
   only per-viewer conveniences: the form draft, which order this browser organizes, the phone, a colleague's draft.
   The organizer is the first participant of the order (the core has no organizer field).
   OPEN-QUESTIONS 17 defaults: automatic send at the deadline, colleagues without a profile, one payment. */
import { SC } from "../../client/sc-menu.ts";
import { api, ApiError } from "../../client/api.ts";
import { zoneOfAddress, zoneByName, zoneMin, type AddressResult } from "../../lib/zones.ts";
import { normPhone, hhmm, dateLong } from "../../lib/format.ts";
import { sofiaDate } from "../../lib/data.ts";
import { clockOverride } from "../../lib/time.ts";
import type { Zone } from "../../lib/consts.ts";
import type { Dish } from "../../data/menu.ts";
import type { OfficeOrder, OrderLine, Order } from "../../core/types.ts";
import { TEAM } from "./_views.ts";
/* icons this script draws (sc.ts: x, check, caret-right, phone, question; render.ts: plus, clock ...) */
import "../../lib/icons/arrow-left.ts";
import "../../lib/icons/arrow-right.ts";
import "../../lib/icons/arrow-up-right.ts";
import "../../lib/icons/check-circle.ts";
import "../../lib/icons/info.ts";
import "../../lib/icons/truck.ts";
import "../../lib/icons/storefront.ts";
import "../../lib/icons/wallet.ts";
import "../../lib/icons/users-three.ts";
import "../../lib/icons/eye.ts";
import "../../lib/icons/copy.ts";
import "../../lib/icons/chat-circle-dots.ts";
import "../../lib/icons/share-network.ts";
import "../../lib/icons/pencil-simple.ts";
import "../../lib/icons/minus.ts";
import "../../lib/icons/lock.ts";
import "../../lib/icons/timer.ts";
import "../../lib/icons/hand-waving.ts";
import "../../lib/icons/warning-circle.ts";
import "../../lib/icons/money.ts";
import "../../lib/icons/credit-card.ts";
import "../../lib/icons/sliders-horizontal.ts";
import "../../lib/icons/trash.ts";
import "../../lib/icons/users.ts";

type Picks = Record<string, number>;
type Mode = "delivery" | "pickup";
type Day = "today" | "tomorrow";
interface Draft { office: string; name: string; addr: string; mode: Mode; deadline: number | null; day: Day | null; pays: "one" | "each" }
interface Guest { name: string; picks: Picks; done: boolean; as: string }
interface Sent { code: string; no: string; at: string; total: number; count: number; people: number; owe: [string, number][]; pays: "one" | "each"; mode: Mode; office: string }
interface Local {
  draft: Draft; code: string; me: string; phone: string; pay: "cash" | "card"; mine: Picks;
  days: Record<string, string>; guests: Record<string, Guest>; sent: Sent | null;
}
interface Person { n: string; picks: Picks; me?: boolean; guest?: boolean; cls?: string }

const KEY = "sc-office";
const DEF: Local = {
  draft: { office: "", name: "", addr: "", mode: "delivery", deadline: null, day: null, pays: "one" },
  code: "", me: "", phone: "", pay: "cash", mine: {}, days: {}, guests: {}, sent: null,
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
  const L: Local = { ...DEF, ...raw, draft: { ...DEF.draft, ...(raw.draft || {}) }, days: raw.days || {}, guests: raw.guests || {}, mine: raw.mine || {} };
  const save = () => SC.store(KEY, L);

  /* simulated states: only in the preview panel (?preview=1) */
  const sim = { closed: false, offline: false, loading: false };
  const t0 = Date.now();

  /* the lunch menu, grouped; sold out stays visible, last in its group (decision 2) */
  const GROUPS: { n: string; id: string; items: Dish[] }[] = [];
  SC.lunch.forEach((x) => {
    let g = GROUPS.find((z) => z.n === x.group);
    if (!g) { g = { n: x.group || "", id: "g" + GROUPS.length, items: [] }; GROUPS.push(g); }
    g.items.push(x);
  });
  GROUPS.forEach((g) => g.items.sort((a, b) => Number(SC.isOut(a)) - Number(SC.isOut(b))));

  /* ---------- remote order ---------- */
  let O: OfficeOrder | null = null, Ocode = "", loadErr: ApiError | null = null, loading = false, autoTried = "";

  /* ---------- helpers ---------- */
  const pad = (n: number) => (n < 10 ? "0" : "") + n;
  const clock = (m: number) => hhmm(((m % 1440) + 1440) % 1440);
  const toMin = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3, 5);
  const sum = (p: Picks) => Math.round(Object.keys(p || {}).reduce((s, k) => s + (SC.byId[k] ? SC.byId[k].p * p[k] : 0), 0) * 100) / 100;
  const cnt = (p: Picks) => Object.values(p || {}).reduce((s, q) => s + q, 0);
  const dishes = (n: number) => n + " " + (n === 1 ? "ястие" : "ястия");
  const souls = (n: number) => n + " " + (n === 1 ? "човек" : "души");
  const initial = (n: string) => esc((n || "?").trim().charAt(0).toUpperCase());
  const picksOf = (lines: OrderLine[]) => { const p: Picks = {}; (lines || []).forEach((l) => { if (SC.byId[l.id]) p[l.id] = (p[l.id] || 0) + l.q; }); return p; };
  const linesOf = (p: Picks): OrderLine[] => Object.keys(p).filter((k) => p[k] > 0).map((k) => ({ id: k, q: p[k], mods: [], extra: 0, name: SC.byId[k]?.n, unit: SC.byId[k]?.p }));
  const today = () => sofiaDate(new Date());
  const addDays = (d: string, n: number) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const dateOf = (d: string) => { const [y, m, dd] = d.split("-").map(Number); return new Date(y, m - 1, dd, 12); };
  /** seconds since midnight on the shop clock (in preview the fixed clock moves on from page load) */
  const nowSec = () => SC.minutes() * 60 + (clockOverride() ? Math.floor((Date.now() - t0) / 1000) : new Date().getSeconds());
  const busy = () => SC.eta().busy;
  function copy(text: string) { try { navigator.clipboard?.writeText(text).catch(() => undefined); } catch { /* not allowed */ } }
  function scrollToEl(el: Element | null) { if (!el) return; const y = el.getBoundingClientRect().top + window.scrollY - 150; window.scrollTo({ top: Math.max(0, y), behavior: SC.reduce ? "auto" : "smooth" }); }
  function focusLater(el: HTMLElement | null, ms = 350) { if (el) setTimeout(() => el.focus({ preventScroll: true }), SC.reduce ? 0 : ms); }

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
    return (z ? zoneMin(z) : 35) + (day === "today" && busy() ? 20 : 0); /* same rule as the cart: "Натоварено" adds 20 min */
  }
  function zr(): AddressResult { return zoneOfAddress(L.draft.addr || ""); }
  function draftCtx() {
    const d = L.draft, r = zr(), z = r.type === "zone" ? r.zone : null, day = d.day || "today", dl = d.deadline || 690;
    return { day, dl, z, eta: dl + etaMin(z, d.mode, day), dayWord: day === "today" ? "днес" : "утре" };
  }

  /* ---------- an existing order: its day, deadline, time left ---------- */
  function targetDate(o: OfficeOrder): string {
    if (L.days[o.code]) return L.days[o.code];
    /* another browser: the day follows the create time (after the last slot it was opened for the next day) */
    const c = new Date(o.createdAt), cd = sofiaDate(c);
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
      late: o.status === "open" && ((day === "today" && SC.minutes() >= 900) || day === "past"),
      early: day === "today" && SC.minutes() < 600,
      eta: dl + etaMin(z, o.mode as Mode, day),
      dayWord: day === "today" ? "днес" : day === "tomorrow" ? "утре" : dateLong(dateOf(td)),
    };
  }
  type Ctx = ReturnType<typeof ctx>;
  const left = (sec: number) => { sec = Math.max(0, sec); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return h >= 1 ? h + "<small> ч </small>" + pad(m) + "<small> мин</small>" : pad(m) + ":" + pad(s); };
  const leftWords = (sec: number) => { const m = Math.max(0, Math.ceil(sec / 60)); if (m >= 90) { const h = Math.floor(m / 60), r = m % 60; return h + " ч" + (r ? " и " + r + " мин" : ""); } return m + " мин"; };
  const whereText = (o: { mode: string; zone: string; addr: string }) => (o.mode === "pickup" ? "Вземане от ресторанта" : o.zone || o.addr || "ж.к. Дружба 2");
  const feeText = (c: Ctx) => (c.mode === "pickup" ? "Без доставка" : !c.z || c.z.free ? "Безплатна" : '<span class="missing">[ЛИПСВА: такса в €]</span>');
  const orgOf = (o: OfficeOrder) => (o.participants[0] && o.participants[0].name) || "Колегата";
  const isMine = (o: OfficeOrder | null) => !!o && o.code === L.code;

  function people(o: OfficeOrder, guestView = false): Person[] {
    const g = L.guests[o.code];
    return o.participants.map((p, i) => ({
      n: p.name, picks: picksOf(p.lines), me: i === 0, guest: !!g && g.as === p.name && i > 0, cls: "a" + (((i - 1) % 3) + 1),
    })).filter((p) => p.me || cnt(p.picks) > 0 || (guestView && p.guest));
  }
  const eaters = (o: OfficeOrder) => people(o).filter((p) => cnt(p.picks) > 0);
  const total = (o: OfficeOrder) => Math.round(eaters(o).reduce((s, p) => s + sum(p.picks), 0) * 100) / 100;
  const totalCount = (o: OfficeOrder) => eaters(o).reduce((s, p) => s + cnt(p.picks), 0);

  /* ---------- links ---------- */
  const joinHref = (code: string) => SC.url.page("office", "join-" + code);
  const joinURL = (code: string) => new URL(joinHref(code), location.href).href;
  const shortURL = (code: string) => joinURL(code).replace(/^https?:\/\//, "");
  function linkHTML(code: string) { const u = shortURL(code), i = u.indexOf("#"); return "<span>" + esc(u.slice(0, i)) + "</span><wbr><span class=\"nw\">" + esc(u.slice(i)) + "</span>"; }
  function chatMsg(o: OfficeOrder, c: Ctx) { return "Поръчваме обяд от Siracusa. Изберете си от обедното меню до " + clock(c.dl) + (c.day === "tomorrow" ? " утре" : "") + ": " + joinURL(o.code); }

  /* ---------- small templates ---------- */
  function stepper(n: number) {
    const names = ["Създайте", "Споделете", "Изпратете"];
    return '<div class="o-step"><div class="stepper" style="--n:3"><div class="t"><b>Стъпка ' + n + " от 3</b><span>" + (n < 3 ? "Следва: " + names[n] : "Последна стъпка") + '</span></div><div class="bar">' +
      names.map((_, i) => "<span" + (i < n ? ' class="on"' : "") + "></span>").join("") + "</div></div>" +
      '<ol class="o-step-l">' + names.map((t, i) => { const st = i + 1 < n ? "done" : i + 1 === n ? "cur" : "";
        return '<li class="' + st + '"' + (st === "cur" ? ' aria-current="step"' : "") + ">" + (st === "done" ? ic("check", 16) + '<span class="vh">Готово: </span>' : "") + t + "</li>"; }).join("") + "</ol></div>";
  }
  const back = (href: string, label: string) => '<a class="link o-back" href="' + href + '">' + ic("arrow-left", 20) + esc(label) + "</a>";
  function person(p: Person, o: { edit?: boolean; closed?: boolean; guestView?: boolean; fresh?: boolean } = {}) {
    const n = cnt(p.picks);
    const items = Object.keys(p.picks).map((k) => '<li><span class="q">' + p.picks[k] + " ×</span><span>" + esc(SC.byId[k].n) + "</span></li>").join("");
    const tag = p.me ? '<span class="o-tag">' + (o.guestView ? "организатор" : "вие, организатор") + "</span>" : p.guest ? '<span class="o-tag">вие</span>' : "";
    let acts = "";
    if (o.edit && p.me && !o.closed) acts = '<div class="acts"><a class="link" href="#mine">' + ic(n ? "pencil-simple" : "plus", 18) + (n ? "Промени моя избор" : "Избери своето") + "</a></div>";
    else if (o.edit && !p.me && !o.closed) acts = '<div class="acts"><button class="link mutedl" type="button" data-act="drop" data-who="' + esc(p.n) + '" aria-label="Махни ' + esc(p.n) + ' от поръчката">' + ic("x", 18) + "Махни</button></div>";
    return '<div class="o-person' + (o.fresh ? " new" : "") + '"><span class="o-ava ' + (p.me ? "me" : p.cls || "a3") + '" aria-hidden="true">' + initial(p.n) + "</span>" +
      '<div><div class="nm">' + esc(p.n) + tag + "</div>" + (n ? "<ul>" + items + "</ul>" : '<p class="muted" style="margin:4px 0 0;font-size:15px">' + (p.me && !o.guestView ? "Още не сте избрали" : "Още избира") + "</p>") + acts + "</div>" +
      '<div class="sum">' + (n ? '<span class="price">' + fmt(sum(p.picks)) + "</span>" : "") + "</div></div>";
  }
  const note = (cls: string, icon: string, html: string, role = "status") => '<div class="o-note ' + cls + '" role="' + role + '">' + ic(icon, 22) + "<div>" + html + "</div></div>";
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
        '<div class="field" data-addrbox>' + addrHTML() + "</div>" +
        '<div class="field"><span class="label" id="o-slots-l">Колегите избират до</span><div class="o-slots" role="group" aria-labelledby="o-slots-l">' + slots + "</div>" +
          (anyOff ? '<span class="help">Зачертаните часове за днес минаха.</span>' : "") +
          '<div class="o-res" data-eta aria-live="polite"></div></div>' +
        '<fieldset class="o-choice"><legend class="label">Кой плаща</legend>' +
          '<label class="o-opt"><input type="radio" name="pays" value="one"' + (d.pays === "one" ? " checked" : "") + '><span class="o-fi">' + ic("wallet", 22) + '</span><span><b>Плащам аз за всички</b><span class="muted">Виждате кой колко ви дължи.</span></span><span class="o-radio">' + ic("check", 16) + "</span></label>" +
          '<label class="o-opt"><input type="radio" name="pays" value="each"' + (d.pays === "each" ? " checked" : "") + '><span class="o-fi">' + ic("users-three", 22) + '</span><span><b>Всеки плаща своето</b><span class="muted">Сметката е разделена по имена.</span></span><span class="o-radio">' + ic("check", 16) + "</span></label>" +
        "</fieldset>" +
        '<div data-formerr></div>' +
        '<div class="o-actions"><button class="pill pill-red pill-lg pill-block" type="submit" data-create-btn>Създай връзка за колегите' + ic("arrow-right", 20) + "</button>" +
        '<p class="o-fine">' + ic("info", 18) + "<span>Плащане в брой или с карта при получаване. В крайния час поръчката тръгва към ресторанта сама, или я изпращате по-рано.</span></p></div>" +
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
    return '<label for="o-addr">Адрес на офиса</label><input class="input" id="o-addr" name="addr" autocomplete="street-address" placeholder="Квартал, блок или улица, етаж" value="' + esc(d.addr) + '" aria-describedby="o-addr-e o-addr-r"><span class="err" id="o-addr-e" data-err="addr" hidden></span>' +
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
  function previewHTML() {
    const c = draftCtx(), d = L.draft, nm = d.name.trim() || "Вие", r = zr();
    const where = d.mode === "pickup" ? "Вземане от ресторанта" : r.type === "zone" ? r.zone.n : d.addr.trim() || "ж.к. Дружба 2";
    return '<div class="o-bubble"><span class="who">' + esc(nm) + "</span>Поръчваме обяд от Siracusa. Изберете си до " + clock(c.dl) + (c.day === "tomorrow" ? " утре" : "") + '.<br><span class="o-linkchip">' + ic("arrow-up-right", 16) + "<span>" + esc(shortURL("······")) + "</span></span></div>" +
      '<div class="o-kv">' +
      '<div class="kv"><span>Офис</span><b>' + esc(d.office.trim() || (d.name.trim() ? "Офисът на " + d.name.trim() : "Без име")) + "</b></div>" +
      '<div class="kv"><span>' + (d.mode === "pickup" ? "Вземане" : "Доставка до") + "</span><b>" + esc(where) + "</b></div>" +
      '<div class="kv"><span>Избор до</span><b>' + c.dayWord + ", " + clock(c.dl) + "</b></div>" +
      '<div class="kv"><span>' + (d.mode === "pickup" ? "Готово" : "Пристига около") + "</span><b>" + clock(c.eta) + "</b></div>" +
      '<div class="kv"><span>Плаща</span><b>' + (d.pays === "one" ? (d.name.trim() ? esc(nm) + " за всички" : "вие, за всички") : "всеки своето") + "</b></div></div>";
  }

  /* ======================= view: link for colleagues ======================= */
  function viewShare(o: OfficeOrder) {
    const c = ctx(o), msg = chatMsg(o, c), me = orgOf(o);
    return '<section class="sec o-top"><div class="o-lay"><div class="o-col">' +
      "<div>" + back(SC.url.page("office", "o-create"), "Назад: данните на поръчката") + stepper(2) + "</div>" +
      '<div class="shell"><div class="core o-card">' +
        '<span class="o-done-ic">' + ic("check", 32) + "</span>" +
        '<h1 class="h2">Поръчката е отворена</h1>' +
        '<p class="lead o-sub">Пратете връзката в чата на офиса. Колегите избират до <b style="color:var(--ink)">' + clock(c.dl) + "</b> " + c.dayWord + ".</p>" +
        '<div class="o-linkwrap"><span class="label" id="o-link-l">Връзка за колегите</span>' +
        '<div class="o-link">' + ic("arrow-up-right", 20) + '<output aria-labelledby="o-link-l" data-link>' + linkHTML(o.code) + "</output></div>" +
        '<button class="pill pill-red pill-lg pill-block" type="button" data-act="copylink">' + ic("copy", 22) + "Копирай връзката</button>" +
        '<div class="o-two"><a class="pill pill-line" href="viber://forward?text=' + encodeURIComponent(msg) + '" data-act="viber">' + ic("chat-circle-dots", 20) + 'Във Viber</a><button class="pill pill-line" type="button" data-act="sharenative">' + ic("share-network", 20) + "Друг начин</button></div></div>" +
      "</div></div>" +
      '<div><h2 class="o-h3" style="margin-bottom:12px">Готово съобщение за чата</h2><div class="o-bubble"><span class="who">' + esc(me) + "</span>" + esc(msg.replace(joinURL(o.code), "")).trim() + '<br><span class="o-linkchip">' + ic("arrow-up-right", 16) + "<span>" + esc(shortURL(o.code)) + "</span></span></div>" +
        '<button class="link" type="button" data-act="copymsg" style="min-height:48px">' + ic("copy", 18) + "Копирай цялото съобщение</button></div>" +
    "</div>" +
    '<aside class="o-aside o-col">' +
      '<div class="shell"><div class="core o-card"><h2 class="o-h3" style="margin-bottom:4px">Вашата поръчка</h2>' +
      '<div class="o-kv">' +
        '<div class="kv"><span>Офис</span><b>' + esc(o.office) + "</b></div>" +
        '<div class="kv"><span>' + (o.mode === "pickup" ? "Вземане" : "Доставка до") + "</span><b>" + esc(whereText(o)) + "</b></div>" +
        '<div class="kv"><span>Избор до</span><b>' + c.dayWord + ", " + clock(c.dl) + "</b></div>" +
        '<div class="kv"><span>' + (o.mode === "pickup" ? "Готово" : "Пристига около") + "</span><b>" + clock(c.eta) + "</b></div>" +
        '<div class="kv"><span>Плаща</span><b>' + (o.payer === "one" ? "вие, за всички" : "всеки своето") + "</b></div></div></div></div>" +
      '<div class="o-actions"><a class="pill pill-ink pill-lg pill-block" href="#list">Към общия списък' + ic("arrow-right", 20) + "</a>" +
      '<a class="pill pill-line pill-block" href="#mine">' + ic("plus", 20) + "Добавете и своето ястие</a>" +
      '<a class="link" href="#join-' + esc(o.code) + '" style="justify-self:center;min-height:48px">' + ic("eye", 18) + "Вижте какво виждат колегите</a></div>" +
    "</aside></div></section>";
  }

  /* ======================= view: shared list ======================= */
  function timerHTML(o: OfficeOrder, c: Ctx) {
    if (c.late) return note("warn", "clock", '<p>Обедното меню вече не се доставя днес (до 15:00). Отворете нова поръчка за утре.</p><button class="pill pill-line" type="button" data-act="restart">Нова поръчка за утре</button>');
    if (c.closed) return '<div class="o-closed"><span class="o-fi">' + ic("lock", 22) + "</span><div><b>Изборът приключи в " + clock(c.dl) + "</b><span>" + (eaters(o).length ? "Списъкът е затворен. " + (normPhone(L.phone) ? "Изпращаме поръчката на ресторанта." : "Напишете телефона си и изпратете поръчката.") : "Никой не избра ястие.") + "</span></div></div>";
    return '<div class="o-timer"><div><span class="lbl">Остават за избор</span><span class="o-time" data-left>' + left(c.remain) + '</span></div><div class="o-until"><span class="o-live"><i></i>На живо</span><br>до ' + clock(c.dl) + " " + c.dayWord + "</div></div>" +
      '<div class="o-track" aria-hidden="true"><span data-track style="transform:scaleX(' + trackScale(c) + ')"></span></div>';
  }
  const trackScale = (c: Ctx) => Math.min(1, Math.max(0, c.remain / (c.day === "today" ? 7200 : 86400))).toFixed(4);
  function peopleHTML(o: OfficeOrder, c: Ctx, fresh: Set<string>) {
    const all = people(o);
    if (all.length <= 1 && !cnt(all[0] ? all[0].picks : {})) {
      return (all[0] ? person(all[0], { edit: true, closed: c.closed }) : "") +
        '<div class="o-state" style="padding:20px 8px 8px"><div class="ill">' + ic("users-three", 36) + '</div><b style="font-size:18px">Още никой не е избрал</b><p class="muted">Пратете връзката в чата на офиса. Тук ще виждате всеки, който добави ястие.</p>' +
        (c.closed ? "" : '<div class="o-actions"><button class="pill pill-red pill-block" type="button" data-act="copylink">' + ic("copy", 20) + "Копирай връзката</button></div>") + "</div>";
    }
    return all.map((p) => person(p, { edit: true, closed: c.closed, fresh: fresh.has(p.n) })).join("");
  }
  function payBoxHTML(o: OfficeOrder) {
    const list = eaters(o), T = total(o);
    if (!list.length) return "";
    if (o.payer === "each") return '<div class="shell"><div class="core o-card"><h2 class="o-h3">Кой колко плаща</h2><p class="muted" style="margin:6px 0 4px">Всеки плаща своето при получаване, в брой или с карта.</p>' +
      '<div class="o-owe">' + list.map((p) => '<div class="kv"><span>' + esc(p.n) + '</span><span class="price">' + fmt(sum(p.picks)) + "</span></div>").join("") + "</div></div></div>";
    const others = list.filter((p) => !p.me);
    return '<div class="shell"><div class="core o-card"><h2 class="o-h3">Плащате вие за всички</h2><p class="muted" style="margin:6px 0 4px">' + fmt(T) + (others.length ? " при получаване. Колегите ви дължат:" : " при получаване.") + "</p>" +
      (others.length ? '<div class="o-owe">' + others.map((p) => '<div class="kv"><span>' + esc(p.n) + '</span><span class="price">' + fmt(sum(p.picks)) + "</span></div>").join("") + "</div>" +
        '<button class="link" type="button" data-act="copyowe" style="min-height:48px">' + ic("copy", 18) + "Копирай кой колко дължи</button>" : '<p class="small muted" style="margin:8px 0 0">Още никой от колегите не е избрал.</p>') + "</div></div>";
  }
  function billHTML(o: OfficeOrder, c: Ctx) {
    const T = total(o), N = totalCount(o);
    return '<div class="shell"><div class="core o-card"><h2 class="o-h3" style="margin-bottom:4px">Сметка</h2><div class="o-kv">' +
      '<div class="kv"><span>' + dishes(N) + '</span><span class="price">' + fmt(T) + "</span></div>" +
      '<div class="kv"><span>' + (o.mode === "pickup" ? "Вземане" : "Доставка") + "</span><b>" + feeText(c) + "</b></div></div>" +
      '<div class="o-tot"><b>Общо</b><span class="price">' + fmt(T) + "</span></div></div></div>";
  }
  function sendState(o: OfficeOrder, c: Ctx) {
    const T = total(o);
    if (c.sent) return { ok: false, lbl: "Поръчката е изпратена" };
    if (c.late) return { ok: false, lbl: "Обедното меню за днес приключи" };
    if (!T) return { ok: false, lbl: "Добавете поне едно ястие" };
    if (c.day === "tomorrow" || c.day === "later") return { ok: false, lbl: "Изпраща се " + c.dayWord + " в " + clock(c.dl) };
    if (c.early) return { ok: false, lbl: "Изпращане след 10:00" };
    return { ok: true, lbl: "Изпрати на ресторанта · " + fmt(T) };
  }
  function sendBtn(o: OfficeOrder, c: Ctx, cls: string) {
    const s = sendState(o, c);
    return '<button class="pill pill-red ' + cls + '" type="button" data-act="send"' + (s.ok ? "" : " disabled") + ">" + s.lbl + "</button>";
  }
  function sendNote(o: OfficeOrder, c: Ctx) {
    if (c.closed || c.late) return "";
    if (c.day === "tomorrow" || c.day === "later") return '<p class="o-fine">' + ic("info", 18) + "<span>" + (c.day === "tomorrow" ? "Утре" : "На " + esc(c.dayWord)) + " в " + clock(c.dl) + " поръчката тръгва към ресторанта сама. Дотогава колегите могат да избират.</span></p>";
    return '<p class="o-fine">' + ic("info", 18) + "<span>В " + clock(c.dl) + " поръчката тръгва към ресторанта сама. Можете да я изпратите и по-рано: тогава списъкът се затваря.</span></p>";
  }
  function viewList(o: OfficeOrder) {
    const c = ctx(o), list = eaters(o), N = totalCount(o);
    const payFields = '<div class="shell"><div class="core o-card" style="display:grid;gap:18px"><h2 class="o-h3">За шофьора</h2>' +
      '<div class="field"><label for="o-phone">Вашият телефон</label><input class="input" id="o-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0888 12 34 56" value="' + esc(L.phone) + '" aria-describedby="o-phone-h o-phone-e"><span class="help" id="o-phone-h">Обаждаме се само ако има въпрос по поръчката.</span><span class="err" id="o-phone-e" data-err="phone" hidden></span></div>' +
      (o.payer === "one" ? '<div class="field"><span class="label" id="o-pay-l">Как плащате</span><div class="seg" role="group" aria-labelledby="o-pay-l"><button type="button" data-pay="cash" aria-pressed="' + (L.pay === "cash") + '">' + ic("money", 20) + 'В брой</button><button type="button" data-pay="card" aria-pressed="' + (L.pay === "card") + '">' + ic("credit-card", 20) + 'С карта</button></div><span class="help">При получаване. Без онлайн плащане.</span></div>' : "") +
      "<div data-senderr></div>" +
      '<div class="o-onlydesk o-sendinline" data-sendinline>' + sendBtn(o, c, "pill-lg pill-block") + "</div>" +
      '<div data-sendnote>' + sendNote(o, c) + "</div>" +
    "</div></div>";
    const html = '<section class="sec o-top">' + back("#share", "Назад: връзката за колегите") + stepper(3) +
      '<div class="o-lay"><div class="o-col">' +
        '<div><h1 class="h1" style="font-size:clamp(30px,8cqi,44px)">' + esc(o.office) + '</h1><p class="lead o-sub">' + (o.mode === "pickup" ? "Вземане от ресторанта · готово в " : "Доставка до " + esc(whereText(o)) + " · около ") + clock(c.eta) + "</p></div>" +
        '<div class="shell"><div class="core o-card" data-timer>' + timerHTML(o, c) + "</div></div>" +
        '<div class="shell"><div class="core o-card" style="padding-bottom:6px"><div class="row" style="justify-content:space-between;flex-wrap:wrap;row-gap:2px"><h2 class="o-h3">Кой какво поръча</h2><span class="muted small" style="font-weight:700" data-count>' + (N ? souls(list.length) + " · " + dishes(N) : "") + '</span></div><div class="o-people" data-people aria-live="polite">' + peopleHTML(o, c, new Set()) + "</div></div></div>" +
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
    const lunchDay = SC.lunchIsToday() ? esc(SC.menu.lunch.dayName) + ", " + dateLong(dateOf(SC.menu.lunch.date)).split(", ")[1] : "Обедното меню се качва всяка сутрин.";
    return '<section class="o-menu" aria-labelledby="o-menu-h"><div class="o-menu-h"><h2 class="h2" id="o-menu-h">Обедно меню</h2><p class="muted" style="margin:-6px 0 0;font-weight:600">' + lunchDay + "</p>" +
      (day === "tomorrow" ? '<p class="missing small" style="margin:0">[ЛИПСВА: обедното меню за утре] Показваме последното качено.</p>' : "") +
      '<div class="chips" role="list">' + GROUPS.map((g) => '<button class="chip" type="button" role="listitem" data-jump="' + g.id + '">' + esc(g.n) + '<span class="n">' + g.items.length + "</span></button>").join("") + "</div></div>" +
      GROUPS.map((g) => '<div class="o-grp" id="' + g.id + '"><h3 class="h3">' + esc(g.n) + '</h3><div class="o-items">' + g.items.map((x) => itemHTML(x, picks[x.id] || 0)).join("") + "</div></div>").join("") + "</section>";
  }
  function itemHTML(x: Dish, q: number) {
    const out = SC.isOut(x);
    const ctrl = out ? '<span class="o-slotempty" aria-hidden="true"></span>'
      : q ? '<span class="counter"><button type="button" data-q="-1" data-id="' + x.id + '" aria-label="Едно по-малко: ' + esc(x.n) + '">' + ic("minus", 20) + '</button><output aria-live="polite">' + q + '</output><button type="button" data-q="1" data-id="' + x.id + '" aria-label="Още едно: ' + esc(x.n) + '">' + ic("plus", 20) + "</button></span>"
      : '<button class="plus" type="button" data-q="1" data-id="' + x.id + '" aria-label="Избери ' + esc(x.n) + '">' + ic("plus", 22) + "</button>";
    return '<div class="o-item' + (out ? " out" : "") + (q ? " on" : "") + '" data-row="' + x.id + '">' + SC.pic(x) + '<span><span class="nm">' + esc(x.n) + '</span><span class="meta"><span class="price">' + fmt(x.p) + "</span>" + (out ? '<span class="badge out">' + ic("clock", 16) + "Изчерпано днес</span>" : "") + "</span></span>" + ctrl + "</div>";
  }
  function minePicks(picks: Picks) {
    const ks = Object.keys(picks);
    if (!ks.length) return '<p class="muted" style="margin:6px 0 0">Още нищо. Натиснете „+“ до ястие.</p>';
    return '<div class="o-mine">' + ks.map((k) => '<div class="kv"><span>' + picks[k] + " × " + esc(SC.byId[k].n) + '</span><span class="price">' + fmt(SC.byId[k].p * picks[k]) + "</span></div>").join("") + "</div>";
  }
  const saveLbl = (p: Picks, verb: string) => (sum(p) ? verb + " · " + fmt(sum(p)) : "Изберете ястие от менюто");
  const saveDis = (p: Picks) => (sum(p) ? "" : ' aria-disabled="true"');

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
  function guestOf(code: string): Guest { return (L.guests[code] = L.guests[code] || { name: "", picks: {}, done: false, as: "" }); }
  function viewInvalid() {
    return '<section class="sec o-top"><div class="shell" style="max-width:560px;margin:0 auto"><div class="core o-state"><div class="ill warn">' + ic("warning-circle", 40) + '</div><h1 class="h2">Тази връзка не работи</h1><p class="muted">Може поръчката вече да е изпратена или връзката да е непълна. Помолете колегата за нова връзка или поръчайте сами.</p>' +
      '<div class="o-actions"><a class="pill pill-red pill-lg pill-block" href="' + SC.url.lunch() + '">Към обедното меню</a><a class="pill pill-line pill-block" href="' + SC.url.page("office", "o-create") + '" data-act="toform">Започни обща поръчка</a></div></div></div></section>';
  }
  function viewJoin(o: OfficeOrder) {
    const c = ctx(o), org = orgOf(o), g = guestOf(o.code), gp = g.picks, s = sum(gp);
    if (c.closed || c.late) {
      return '<section class="sec o-top"><div class="shell" style="max-width:560px;margin:0 auto"><div class="core o-state"><div class="ill">' + ic("clock", 40) + '</div><h1 class="h2">' + (c.sent ? "Поръчката е изпратена" : "Изборът приключи в " + clock(c.dl)) + "</h1>" +
        '<p class="muted">' + (c.sent ? esc(org) + " я изпрати на ресторанта." : esc(org) + " вече изпраща поръчката на ресторанта.") + (g.done && cnt(gp) ? " Вашият избор е вътре." : " Ако не сте успели, обадете се на " + esc(org) + " или поръчайте сами.") + "</p>" +
        '<div class="o-actions"><a class="pill pill-red pill-lg pill-block" href="' + SC.url.lunch() + '">Поръчай си сам</a><a class="pill pill-line pill-block" href="tel:' + R.phoneIntl + '">' + ic("phone", 20) + "Обади се на ресторанта</a></div></div></div></section>";
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
        '<button class="pill pill-red pill-lg pill-block" type="button" data-act="guestsave" data-savebtn' + saveDis(gp) + ' style="margin-top:16px">' + saveLbl(gp, "Добави към поръчката") + "</button>" +
        '<p class="o-fine" style="margin-top:12px">' + ic("info", 18) + "<span>" + (o.payer === "one" ? esc(org) + " плаща за всички. После си уреждате сметката." : "Плащате своето при получаване, в брой или с карта.") + "</span></p></div></div></aside></div></section>";
    bar('<button class="pill pill-red" type="button" data-act="guestsave" data-savebtn' + saveDis(gp) + ">" + saveLbl(gp, "Добави към поръчката") + "</button>");
    return html;
  }

  /* ======================= view: sent ======================= */
  function viewSent() {
    const S = L.sent;
    if (!S) return viewInvalid();
    return '<section class="sec o-top"><div class="shell" style="max-width:620px;margin:0 auto"><div class="core o-state">' +
      '<div class="ill ok">' + ic("check", 44) + '</div><h1 class="h2">Поръчката е изпратена</h1>' +
      '<p class="muted">Ресторантът я получи. Ще ви известим, когато тръгне към вас.</p>' +
      '<div class="o-sentmeta"><div><span>Поръчка</span><b>№ ' + esc(S.no) + "</b></div><div><span>" + (S.mode === "pickup" ? "Готова" : "Пристига около") + "</span><b>" + esc(S.at) + "</b></div><div><span>Ястия</span><b>" + S.count + " за " + souls(S.people) + '</b></div><div><span>Общо</span><b class="price">' + fmt(S.total) + "</b></div></div>" +
      (S.pays === "one" && S.owe.length ? '<div style="width:100%;max-width:420px;text-align:left"><h2 class="o-h3" style="font-size:17px;margin:12px 0 2px">Колегите ви дължат</h2><div class="o-owe">' + S.owe.map(([n, v]) => '<div class="kv"><span>' + esc(n) + '</span><span class="price">' + fmt(v) + "</span></div>").join("") + "</div></div>" : "") +
      '<div class="o-actions"><a class="pill pill-red pill-lg pill-block" href="' + SC.url.tracking(S.no) + '">Следи поръчката' + ic("arrow-right", 20) + "</a>" +
      '<button class="pill pill-line pill-block" type="button" data-act="copydone">' + ic("copy", 20) + "Копирай съобщение за чата</button></div>" +
      '<p class="muted small" style="max-width:420px;margin-top:6px">Обяд за офиса всеки ден с абонамент идва скоро. Интересува ли ви? <a class="link" href="tel:' + R.phoneIntl + '">' + esc(R.phone) + "</a></p>" +
      '<a class="link" href="' + SC.url.page("office", "o-create") + '" data-act="restart" style="min-height:48px">Започни нова обща поръчка</a>' +
    "</div></div></section>";
  }

  /* ======================= loading / error ======================= */
  function viewLoading(v: string) {
    if (v === "join") return '<section class="sec o-top" aria-busy="true"><div class="o-lay"><div class="o-col">' + skel(190, "border-radius:28px") + skel(52, "width:60%") +
      [0, 1, 2, 3].map(() => '<div class="row" style="gap:14px"><div class="skel" style="width:64px;height:64px;border-radius:18px;flex:none"></div><div style="flex:1;display:grid;gap:8px">' + skel(18) + skel(18, "width:40%") + "</div></div>").join("") +
      '</div><div class="o-col o-onlydesk">' + skel(260, "border-radius:28px") + '</div></div><span class="vh" role="status">Зареждаме поръчката</span></section>';
    return '<section class="sec o-top" aria-busy="true">' + stepper(v === "share" ? 2 : 3) + '<div class="o-lay"><div class="o-col">' + skel(150, "border-radius:28px") + skel(72) + skel(72) + skel(72) + '</div><div class="o-col">' + skel(220, "border-radius:28px") + '</div></div><span class="vh" role="status">Зареждаме поръчката</span></section>';
  }
  function viewError() {
    return '<section class="sec o-top"><div class="shell" style="max-width:560px;margin:0 auto"><div class="core o-state"><div class="ill warn">' + ic("warning-circle", 40) + '</div><h1 class="h2">Няма връзка</h1><p class="muted">' + esc(loadErr ? loadErr.message : "Нещо се обърка. Опитайте пак.") + "</p>" +
      '<div class="o-actions"><button class="pill pill-red pill-lg pill-block" type="button" data-act="retry">Опитай пак</button><a class="pill pill-line pill-block" href="tel:' + R.phoneIntl + '">' + ic("phone", 20) + "Обади се на ресторанта</a></div></div></div></section>";
  }

  /* ======================= prototype panel (only ?preview=1) ======================= */
  function protoPanel(v: string) {
    if (!SC.preview) return "";
    const code = L.code || "000000";
    const views = [["", "1. Създаване", "start"], ["share", "2. Връзка", "share"], ["list", "3. Общ списък", "list"], ["join-" + code, "Поканен колега", "join"], ["sent", "Изпратена", "sent"]];
    const states: [keyof typeof sim, string][] = [["closed", "Крайният час мина"], ["offline", "Без интернет"], ["loading", "Зареждане"]];
    return '<section class="sec" aria-labelledby="o-proto-h"><div class="o-proto"><h2 id="o-proto-h">' + ic("sliders-horizontal", 20) + "Само в прототипа</h2><p>Изгледи на групата и състояния. Часът се сменя с ?t=12:30 в адреса.</p>" +
      '<h3>Изгледи</h3><div class="o-quick">' + views.map((x) => '<a class="chip" href="#' + x[0] + '"' + (v === x[2] ? ' aria-current="true"' : "") + ">" + x[1] + "</a>").join("") + "</div>" +
      "<h3>Колеги</h3><div class=\"o-quick\"><button class=\"chip\" type=\"button\" data-act=\"team\"" + (L.code ? "" : " disabled") + ">" + ic("users", 18) + "Добави 3 примерни колеги</button></div>" +
      '<h3>Състояния</h3><div class="o-quick">' + states.map((x) => '<button class="chip" type="button" data-sim="' + x[0] + '" aria-pressed="' + sim[x[0]] + '">' + x[1] + "</button>").join("") +
      '<a class="chip" href="#join-000000">Грешна връзка</a><button class="chip" type="button" data-act="reset">' + ic("trash", 18) + "Изчисти данните</button></div></div></section>";
  }

  /* ---------- floating action bar (in the .ov layer) ---------- */
  function bar(inner: string | null) {
    SC.ov.querySelector(".o-bar")?.remove();
    const fab = SC.ov.querySelector(".aifab");
    if (!inner) { fab?.classList.remove("up"); return; }
    SC.ov.insertAdjacentHTML("beforeend", '<div class="abar o-bar">' + inner + "</div>"); fab?.classList.add("up");
  }

  /* ======================= routing and render ======================= */
  type Route = { v: "start" | "share" | "list" | "mine" | "join" | "sent"; code?: string };
  function route(): Route {
    const h = decodeURIComponent(location.hash.slice(1));
    const m = /^join-?([A-Za-z0-9]*)/.exec(h);
    if (m) return { v: "join", code: m[1] };
    if (h === "share" || h === "list" || h === "mine" || h === "sent") return { v: h };
    return { v: "start" };
  }
  const codeFor = (rt: Route) => (rt.v === "join" ? rt.code || "" : rt.v === "share" || rt.v === "list" || rt.v === "mine" ? L.code : "");

  let lastV: string | null = null, tick: ReturnType<typeof setInterval> | undefined, poll: ReturnType<typeof setInterval> | undefined;
  function render(keepScroll = false) {
    const rt = route();
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
      else if (O.status !== "open" && L.sent && L.sent.code === O.code) html = viewSent();
      else if (rt.v === "share") html = viewShare(O);
      else if (rt.v === "mine") html = viewMine(O);
      else html = viewList(O);
      viewEl.innerHTML = html;
    }
    protoEl.innerHTML = protoPanel(rt.v);
    if (!keepScroll && lastV !== null && lastV !== rt.v) window.scrollTo(0, 0);
    lastV = rt.v;
    if (rt.v === "list" || rt.v === "join" || rt.v === "share") tick = setInterval(liveTick, 1000);
    SC.reveal();
  }
  /** route change: load the order the view needs, then draw */
  async function go(keepScroll = false) {
    const rt = route(), code = codeFor(rt);
    if ((rt.v === "share" || rt.v === "list" || rt.v === "mine") && !L.code) { if (L.sent) { location.hash = "sent"; return; } location.hash = ""; return; }
    if (rt.v === "mine" && O && O.code === L.code) L.mine = picksOf(O.participants[0]?.lines || []);
    if (code && (Ocode !== code || loadErr)) {
      loading = true; render(keepScroll);
      await fetchO(code);
      loading = false;
      if (rt.v === "mine" && O) L.mine = picksOf(O.participants[0]?.lines || []);
    }
    render(keepScroll);
    autoSend();
  }
  async function fetchO(code: string, quiet = false): Promise<boolean> {
    try { O = (await api.office.get(code)) as OfficeOrder | null; Ocode = code; loadErr = null; return true; }
    catch (e) { if (!quiet) { loadErr = e instanceof ApiError ? e : new ApiError("server", "Нещо се обърка. Опитайте пак."); Ocode = code; O = null; } return false; }
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
      autoSend();
      return;
    }
    const el = main.querySelector("[data-left]"), w = main.querySelector("[data-leftw]"), tr = main.querySelector<HTMLElement>("[data-track]");
    if (el) el.innerHTML = left(c.remain);
    if (w) w.textContent = leftWords(c.remain);
    if (tr) tr.style.transform = "scaleX(" + trackScale(c) + ")";
  }

  /* ---------- automatic send at the deadline (OPEN-QUESTIONS 17): from the organizer's open page ---------- */
  function autoSend() {
    if (!O || !isMine(O) || O.status !== "open" || autoTried === O.code) return;
    const c = ctx(O), v = route().v;
    if (sim.closed || c.remain > 0 || c.late || c.early || !eaters(O).length || !normPhone(L.phone)) return;
    if (v !== "list" && v !== "share") return;
    autoTried = O.code;
    if (v !== "list") { location.hash = "list"; setTimeout(() => send(null, true), 50); return; }
    send(null, true);
  }

  /* ======================= interactions ======================= */
  function setErr(key: string, msg?: string) {
    const e = main.querySelector<HTMLElement>('[data-err="' + key + '"]'); if (!e) return;
    const inp = document.getElementById(e.id.replace(/-e$/, ""));
    e.hidden = !msg; e.textContent = msg || "";
    if (inp) inp.setAttribute("aria-invalid", msg ? "true" : "false");
  }
  function pickTarget(): Picks { const rt = route(); return rt.v === "mine" ? L.mine : guestOf(rt.code || "").picks; }
  function updPicker(id: string) {
    const picks = pickTarget(), row = main.querySelector('[data-row="' + id + '"]');
    let nr: Element | null = null;
    if (row) { const tmp = document.createElement("div"); tmp.innerHTML = itemHTML(SC.byId[id], picks[id] || 0); nr = tmp.firstElementChild; if (nr) row.replaceWith(nr); }
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
  const offlineErr = () => new ApiError("offline", "Няма връзка. Проверете интернета и опитайте пак.", 0);

  main.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement, d = L.draft;
    if (t.id === "o-office") { d.office = t.value; save(); setErr("office"); updEta(); }
    else if (t.id === "o-name") { d.name = t.value; save(); setErr("name"); updEta(); }
    else if (t.id === "o-addr") { d.addr = t.value; save(); setErr("addr"); updAddr(true); }
    else if (t.id === "o-phone") { L.phone = t.value; save(); setErr("phone"); }
    else if (t.id === "o-gname") { const rt = route(); guestOf(rt.code || "").name = t.value; save(); setErr("gname"); }
  });
  main.addEventListener("change", (e) => { const t = e.target as HTMLInputElement; if (t.name === "pays") { L.draft.pays = t.value === "each" ? "each" : "one"; save(); updEta(); } });

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
    if (bad) { const el = document.getElementById(bad); scrollToEl(el); focusLater(el); return; }
    const box = main.querySelector("[data-formerr]"); if (box) box.innerHTML = "";
    busyBtns("[data-create-btn]", true);
    try {
      if (sim.offline) throw offlineErr();
      syncPlan();
      const o = (await api.office.create({ office: d.office.trim() || "Офисът на " + name, addr: d.mode === "pickup" ? "" : d.addr.trim(), deadline: hhmm(d.deadline || 690), payer: d.pays, mode: d.mode })) as OfficeOrder;
      await api.office.join(o.code, { name, lines: [] });
      L.code = o.code; L.me = name; L.mine = {}; L.sent = null; autoTried = "";
      L.days[o.code] = d.day === "tomorrow" ? addDays(today(), 1) : today();
      save();
      Ocode = ""; location.hash = "share";
    } catch (err) {
      busyBtns("[data-create-btn]", false);
      if (err instanceof ApiError && err.fields) { Object.entries(err.fields).forEach(([k, v]) => setErr(k, v)); const k = Object.keys(err.fields)[0]; const el = document.getElementById("o-" + k); scrollToEl(el); focusLater(el); return; }
      const msg = err instanceof ApiError ? err.message : "Нещо се обърка. Опитайте пак.";
      if (box) box.innerHTML = note("bad", "warning-circle", "<p>" + esc(msg) + "</p>", "alert");
      SC.toast(msg);
    }
  });

  async function onClick(e: Event) {
    const t = (e.target as Element).closest<HTMLElement>("button, a");
    if (!t) return;
    const act = t.dataset.act;
    if (t.dataset.slot) { L.draft.deadline = +t.dataset.slot; save(); main.querySelectorAll("[data-slot]").forEach((b) => b.setAttribute("aria-pressed", String(b === t))); updEta(); return; }
    if (t.dataset.zone) { const n = t.dataset.zone; L.draft.addr = (/Дружба/.test(n) ? "ж.к. " : "") + n + ", "; save(); setErr("addr"); updAddr(false); const inp = document.getElementById("o-addr") as HTMLInputElement | null; if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } return; }
    if (t.dataset.pay) { L.pay = t.dataset.pay === "card" ? "card" : "cash"; save(); main.querySelectorAll("[data-pay]").forEach((b) => b.setAttribute("aria-pressed", String(b === t))); return; }
    if (t.dataset.jump) { scrollToEl(document.getElementById(t.dataset.jump)); return; }
    if (t.dataset.q && t.dataset.id) {
      const id = t.dataset.id, picks = pickTarget(), q = (picks[id] || 0) + +t.dataset.q;
      if (q <= 0) delete picks[id]; else picks[id] = Math.min(q, 9);
      save(); SC.haptic();
      const nr = updPicker(id), f = nr && (nr.querySelector<HTMLElement>('[data-q="' + t.dataset.q + '"]') || nr.querySelector<HTMLElement>(".plus") || nr.querySelector<HTMLElement>('[data-q="1"]'));
      f?.focus({ preventScroll: true });
      return;
    }
    if (t.dataset.sim) { const k = t.dataset.sim as keyof typeof sim; sim[k] = !sim[k]; SC.toast((sim[k] ? "Включено: " : "Изключено: ") + (t.textContent || "")); render(true); return; }
    switch (act) {
      case "toform": {
        if (route().v !== "start") return; /* the href goes to the form */
        e.preventDefault(); scrollToEl(document.getElementById("o-create")); setTimeout(() => (document.getElementById("o-office") as HTMLElement | null)?.focus({ preventScroll: true }), SC.reduce ? 0 : 450); return;
      }
      case "pickup": L.draft.mode = "pickup"; save(); setErr("addr"); updAddr(false); return;
      case "delivery": L.draft.mode = "delivery"; save(); updAddr(false); return;
      case "copylink": if (O) { copy(joinURL(O.code)); SC.flash(t, ic("check", 22) + "Копирано", 1600); SC.toast("Връзката е копирана. Поставете я в чата."); } return;
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
          SC.toast(who + " е махнат(а) от поръчката", async () => { try { O = (await api.office.join(code, { name: who, lines: old })) as OfficeOrder; updList(O, new Set([who])); } catch (err) { SC.toast(err instanceof ApiError ? err.message : "Не успяхме. Опитайте пак."); } });
        } catch (err) { SC.toast(err instanceof ApiError ? err.message : "Не успяхме. Опитайте пак."); }
        return;
      }
      case "savemine": {
        if (!O) return;
        if (!sum(L.mine)) { SC.toast("Изберете поне едно ястие"); return; }
        if (t.hasAttribute("data-busy")) return;
        busyBtns("[data-savebtn]", true);
        try {
          if (sim.offline) throw offlineErr();
          O = (await api.office.join(O.code, { name: orgOf(O), lines: linesOf(L.mine) })) as OfficeOrder; save();
          SC.toast("Изборът ви е в общия списък ✓"); location.hash = "list";
        } catch (err) { busyBtns("[data-savebtn]", false); SC.toast(err instanceof ApiError ? err.message : "Не успяхме. Опитайте пак."); if (err instanceof ApiError && err.code === "closed") { await fetchO(O.code, true); render(true); } }
        return;
      }
      case "guestsave": {
        if (!O) return;
        const g = guestOf(O.code), name = g.name.trim().replace(/\s+/g, " "), org = orgOf(O);
        if (!name) { setErr("gname", "Напишете името си, за да знае " + org + " чие е ястието."); const gi = document.getElementById("o-gname"); scrollToEl(gi); focusLater(gi); return; }
        const taken = O.participants.some((p) => p.name.toLowerCase() === name.toLowerCase() && p.name !== g.as);
        if (taken) { setErr("gname", "„" + name + "“ вече е в поръчката. Добавете първата буква от фамилията, например „" + name + " П.“"); const gi = document.getElementById("o-gname"); scrollToEl(gi); focusLater(gi); return; }
        if (!sum(g.picks)) { SC.toast("Изберете поне едно ястие"); return; }
        if (t.hasAttribute("data-busy")) return;
        const box = main.querySelector("[data-joinerr]"); if (box) box.innerHTML = "";
        busyBtns("[data-savebtn]", true);
        try {
          if (sim.offline) throw offlineErr();
          if (g.as && g.as !== name) await api.office.join(O.code, { name: g.as, lines: [] });
          O = (await api.office.join(O.code, { name, lines: linesOf(g.picks) })) as OfficeOrder;
          g.as = name; g.name = name; g.done = true; save(); render();
        } catch (err) {
          busyBtns("[data-savebtn]", false);
          if (err instanceof ApiError && (err.code === "closed" || err.code === "not_found")) { await fetchO(O.code, true); render(true); return; }
          const msg = err instanceof ApiError ? err.message : "Не успяхме. Опитайте пак.";
          if (box) { box.innerHTML = note("bad", "warning-circle", "<p>" + esc(msg) + " Изборът ви е запазен.</p>", "alert"); scrollToEl(box); }
          SC.toast(msg);
        }
        return;
      }
      case "guestedit": if (O) { guestOf(O.code).done = false; save(); render(); } return;
      case "restart": e.preventDefault(); L.code = ""; L.me = ""; L.mine = {}; L.sent = null; O = null; Ocode = ""; save(); sim.closed = false; if (location.hash && location.hash !== "#o-create") location.hash = "o-create"; else go(); return;
      case "retry": loadErr = null; Ocode = ""; go(true); return;
      case "team": {
        if (!L.code) return;
        try { for (const tm of TEAM) await api.office.join(L.code, { name: tm.n, lines: linesOf(tm.picks) }); await refresh(); if (route().v !== "list") location.hash = "list"; else render(true); SC.toast("Добавени: Иван, Петя, Георги"); }
        catch (err) { SC.toast(err instanceof ApiError ? err.message : "Не успяхме."); }
        return;
      }
      case "reset": {
        Object.assign(L, JSON.parse(JSON.stringify(DEF))); save(); sim.closed = sim.offline = sim.loading = false; O = null; Ocode = "";
        SC.toast("Данните на прототипа са изчистени"); if (location.hash) location.hash = ""; else render(); return;
      }
      case "send": if (!t.hasAttribute("data-busy")) send(t, false); return;
    }
  }
  main.addEventListener("click", onClick);
  SC.ov.addEventListener("click", (e) => { if ((e.target as Element).closest(".o-bar")) onClick(e); });

  /* ---------- send to the restaurant: api.office.submit -> an order (channel "office") ---------- */
  async function send(btn: HTMLElement | null, auto: boolean) {
    if (!O) return;
    const phone = normPhone(L.phone), errBox = main.querySelector("[data-senderr]");
    if (errBox) errBox.innerHTML = "";
    if (!phone) {
      setErr("phone", L.phone.trim() ? "Проверете номера: 10 цифри, например 0888 12 34 56." : "Напишете телефон, за да ви се обадим, ако има въпрос.");
      const p = document.getElementById("o-phone"); scrollToEl(p); focusLater(p); return;
    }
    const o = O, me = orgOf(o), list = eaters(o);
    busyBtns('[data-act="send"]', true);
    const lines = list.map((p) => p.n + ": " + Object.keys(p.picks).map((k) => p.picks[k] + " × " + SC.byId[k].n).join(", ") + " (" + fmt(sum(p.picks)) + ")").join("; ");
    const noteText = "Обща поръчка за офиса „" + o.office + "“, " + souls(list.length) + ". " + (o.payer === "each" ? "Всеки плаща своето. " : "Плаща " + me + " за всички. ") + lines;
    try {
      if (sim.offline) throw offlineErr();
      const fresh = (await api.office.get(o.code)) as OfficeOrder | null;   /* never send twice */
      if (fresh && fresh.status !== "open") { O = fresh; render(true); return; }
      const r = (await api.office.submit(o.code, { name: me, phone, pay: o.payer === "one" ? L.pay : "cash", note: noteText })) as { office: OfficeOrder; order: Order };
      O = r.office;
      const owe = list.filter((p) => !p.me).map((p) => [p.n, sum(p.picks)] as [string, number]);
      L.sent = { code: o.code, no: r.order.no, at: r.order.at, total: r.order.total, count: totalCount(o), people: list.length, owe, pays: o.payer, mode: o.mode as Mode, office: o.office };
      save();
      SC.store("sc-order", r.order); /* the tracking page can show it at once */
      if (auto) SC.toast("Крайният час дойде: поръчката е изпратена");
      location.hash = "sent";
    } catch (err) {
      busyBtns('[data-act="send"]', false);
      const e = err instanceof ApiError ? err : null;
      if (e && e.fields && e.fields.phone) { setErr("phone", e.fields.phone); return; }
      const msg = e ? (e.code === "offline" ? "Няма връзка. Поръчката ви е запазена - опитайте пак." : e.message) : "Нещо се обърка. Опитайте пак.";
      const box = main.querySelector("[data-senderr]");
      if (box) { box.innerHTML = note("bad", "warning-circle", "<p>" + esc(msg) + '</p><button class="pill pill-line" type="button" data-act="send">Опитай пак</button>', "alert"); scrollToEl(box); }
      SC.toast(e && e.code === "offline" ? "Няма връзка. Опитайте пак." : msg);
    }
    void btn;
  }

  /* ---------- start ---------- */
  const lunchLink = main.querySelector("[data-lunchlink]");
  if (lunchLink) lunchLink.innerHTML = (SC.lunchIsToday() ? "Виж днешното обедно меню" : "Виж обедното меню") + ic("caret-right", 18);
  window.addEventListener("hashchange", () => { if (location.hash === "#o-create" && route().v === "start" && lastV === "start") return; go(); });
  go().then(() => { if (location.hash === "#o-create") scrollToEl(document.getElementById("o-create")); });
}
