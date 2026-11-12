/* Reservation (/rezervatsia/): port of design/pages/reservation.html (design/PAGES.md "reservation.html", OPEN-QUESTIONS 18).
   3 steps: 1) day (calendar, ember dot on event days), time 11:00-21:30 every 30 min, people; 2) table on the floor plan
   (Салон / Градина from TABLES, a mock layout, not a capacity) or "Предпочитам списък"; 3) details with unticked consent.
   Taken tables and the booking itself go through api.reservations.taken / create (server or demo core).
   The date can come from the address: #2026-11-28 (from "Запази място" on an event). #manage opens the last booking
   made in this browser, #r-<id>-<key> (the link in the SMS) opens any booking through api.reservations.get; change and
   cancel go through api.reservations.cancel (locked under 2 h in the evening / 1 h during the day).
   The hero and "Добре е да знаете" are drawn on the server (SEO); the flow depends on the day and hour, so it is drawn here. */
import { SC } from "../../client/sc.ts";
import { api, ApiError } from "../../client/api.ts";
import { normPhone, prettyPhone } from "../../lib/format.ts";
import type { Table } from "../../lib/consts.ts";
import { TABLES } from "../../lib/tables.ts";
import type { Reservation } from "../../client/api-types.ts";
import { callBtn, stepperHTML, pvChip, pvToggle, previewPanel, PV, MKT_TITLE, MKT_SUB } from "../../lib/ui.ts";
/* the icons this script draws in one module (sc.ts has x, check, caret-right, phone, question; scripts/icon-groups.mjs) */
import "sc-icons:arrow-left,arrow-right,arrow-up-right,baby,bell,briefcase,cake,calendar-blank,calendar-check,caret-down,caret-left,chair,chat-circle-dots,clock,confetti,fork-knife,gift,heart,image,info,list-bullets,lock,map-pin,map-trifold,mask-happy,minus,pencil-simple,plus,sliders-horizontal,sun,thermometer,timer,tree,users,users-three,wallet,warning,warning-circle,wheelchair";

type Zone = "salon" | "garden";
type View = "flow" | "done" | "manage";
interface Period { id: string; n: string; from: number; to: number }
interface Booking { id?: string; key?: string; status?: string; table?: string | null; dur?: number; date: Date; slot: number; n: number; selLabel: string; name?: string; phone: string; occ?: string; note?: string; changed?: boolean; fake?: number }
interface SelInfo { joined: boolean; zone: Zone; label: string; short: string; seats: number; t?: Table }
interface Draft { name: string; phone: string; email: string; occ: string; note: string; consent: boolean }

export function start(): void {
  const { ic, esc } = SC;
  const R = SC.RESTAURANT;
  const TEL = "tel:" + R.phoneIntl;
  const MONTHS = SC.MONTHS, MON = SC.MON, DAYS = SC.DAYS;
  const main = SC.mount();
  const flowEl = document.querySelector<HTMLElement>("[data-flow]")!;
  const viewEl = document.querySelector<HTMLElement>("[data-rview]")!;
  const heroEl = document.querySelector<HTMLElement>("[data-rhero]")!;
  const infoEl = document.querySelector<HTMLElement>("[data-rinfo]")!;
  const protoEl = document.querySelector<HTMLElement>("[data-rproto]")!;
  const bar = document.querySelector<HTMLElement>("[data-rbar]")!;
  const smooth = (): ScrollBehavior => (SC.reduce ? "auto" : "smooth");

  /* ---------- dates & slots ---------- */
  const DS = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"], WD = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];
  const TODAY = sofiaToday();
  /* the same rule as the core: from today up to 92 days ahead (RES_DAYS_AHEAD in src/core/reservations.ts) */
  const LAST_DAY = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate() + 92);
  const MIN_M = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), MAX_M = new Date(LAST_DAY.getFullYear(), LAST_DAY.getMonth(), 1);
  /* reservation hours: 11:00 - 21:30 every 30 min (OPEN-QUESTIONS 18, default until the owner decides) */
  const PERIODS: Period[] = [{ id: "lunch", n: "Обед", from: 660, to: 870 }, { id: "aft", n: "Следобед", from: 900, to: 1050 }, { id: "eve", n: "Вечер", from: 1080, to: 1290 }];
  const SLOTS: number[] = []; for (let m0 = 660; m0 <= 1290; m0 += 30) SLOTS.push(m0);
  const EVENING = 1020; /* from 17:00: change or cancel up to 2 h before, during the day up to 1 h */
  const EV = SC.events()[0];

  function sofiaToday(): Date {
    try {
      const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).split("-");
      return new Date(+p[0], +p[1] - 1, +p[2]);
    } catch { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
  }
  const pad = (n: number) => (n < 10 ? "0" : "") + n;
  const hm = (m: number) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
  const ymd = (d: Date) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  function parseYmd(s: string): Date | null { const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); if (!x) return null; const d = new Date(+x[1], +x[2] - 1, +x[3]); return d.getMonth() === +x[2] - 1 ? d : null; }
  const same = (a: Date | null, b: Date | null) => !!a && !!b && a.getTime() === b.getTime();
  const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const fLong = (d: Date) => DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
  const fShort = (d: Date) => DS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()];
  const fTiny = (d: Date) => DS[d.getDay()] + ", " + d.getDate() + " " + MON[d.getMonth()];
  const fWhen = (d: Date) => { const w = DAYS[d.getDay()]; return (/^[вф]/.test(w) ? "във " : "в ") + w + ", " + d.getDate() + " " + MONTHS[d.getMonth()]; };
  const ppl = (n: number) => (n === 1 ? "1 човек" : n + " души");
  function lastSat(y: number, mo: number): Date { const d = new Date(y, mo + 1, 0); while (d.getDay() !== 6) d.setDate(d.getDate() - 1); return d; }
  const isEvent = (d: Date | null) => !!d && same(d, lastSat(d.getFullYear(), d.getMonth()));
  const slotOpen = (d: Date, m: number) => !same(d, TODAY) || m >= SC.minutes() + 30;
  const openSlots = (d: Date) => SLOTS.filter((m) => slotOpen(d, m));
  const bookable = (d: Date) => d >= TODAY && d <= LAST_DAY && openSlots(d).length > 0;
  const periodOf = (m: number) => PERIODS.filter((p) => m >= p.from && m <= p.to)[0];

  /* ---------- occupancy from the API (cached per day + time) ---------- */
  const taken = new Map<string, Set<string>>();
  const loading = new Set<string>();
  let takenErr = false;
  /** a change: the guest's own booking, left out by the core (except + key), so its own table does not look taken */
  const exc = (): string => { const o = st.changing; return o && o.id && o.status !== "cancelled" ? o.id : ""; };
  const key = (d: Date, m: number) => ymd(d) + "|" + hm(m) + "|" + exc();
  function loadTaken(d: Date, list: number[], fresh = false): Promise<void> {
    const need = list.filter((m) => (fresh || !taken.has(key(d, m))) && !loading.has(key(d, m)));
    if (!need.length) return Promise.resolve();
    need.forEach((m) => loading.add(key(d, m)));
    return Promise.all(need.map((m) => api.reservations.taken(ymd(d), hm(m), exc() || undefined)
      .then((ids) => { taken.set(key(d, m), new Set(ids)); takenErr = false; })
      .catch(() => { takenErr = true; })
      .finally(() => loading.delete(key(d, m))))).then(() => undefined);
  }
  /** fetch what the current view needs, then draw again */
  function want(): void {
    if (st.view !== "flow" || !st.date || takenErr) return; /* after a failure only "Опитай пак" asks again */
    const d = st.date;
    let list: number[] = [];
    if (st.step === 1) { const per = PERIODS.filter((p) => p.id === st.period)[0] || PERIODS[2]; list = SLOTS.filter((m) => m >= per.from && m <= per.to && slotOpen(d, m)); }
    if (st.slot != null) list.push(st.slot);
    const missing = list.filter((m) => !taken.has(key(d, m)) && !loading.has(key(d, m)));
    if (!missing.length) return; /* in flight: its own .then() draws again */
    loadTaken(d, missing).then(() => { if (st.date && same(st.date, d)) render(); });
  }
  const known = (d: Date, m: number) => taken.has(key(d, m));
  function isTaken(t: Table, d: Date, m: number): boolean {
    if (SC.preview && st.proto.eventFull && isEvent(d) && m >= 1140 && m <= 1230) return true; /* preview panel only: the event night fully booked 19:00 - 20:30 */
    return !!taken.get(key(d, m))?.has(t.id);
  }
  const suits = (t: Table, n: number) => n <= 6 && t.seats >= n && t.seats <= n + 2;
  const zoneTables = (z: Zone) => TABLES.filter((t) => t.zone === z);
  const freeSeats = (z: Zone, d: Date, m: number) => zoneTables(z).filter((t) => !isTaken(t, d, m)).reduce((a, t) => a + t.seats, 0);
  const freeTables = (z: Zone, d: Date, m: number, n: number) => zoneTables(z).filter((t) => !isTaken(t, d, m) && suits(t, n));
  function slotFull(d: Date, m: number, n: number): boolean {
    if (!known(d, m) && !(SC.preview && st.proto.eventFull)) return false; /* unknown yet: not full */
    if (n > 6) return freeSeats("salon", d, m) < n + 2 && freeSeats("garden", d, m) < n + 2;
    return !freeTables("salon", d, m, n).length && !freeTables("garden", d, m, n).length;
  }
  const sizesFor = (n: number) => [2, 4, 6].filter((s) => s >= n && s <= n + 2);

  /* ---------- state ---------- */
  const st = {
    view: "flow" as View, step: 1, date: null as Date | null, month: MIN_M, slot: null as number | null, period: "eve", n: 2, zone: "salon" as Zone,
    sel: null as string | null, hold: 0, expired: false, list: false, need: {} as Record<string, boolean>,
    f: { name: "", phone: "", email: "", occ: "", note: "", consent: false } as Draft, err: {} as Record<string, string>,
    busy: false, fail: null as null | "offline" | "error", failText: null as string | null, failCall: false, blocked: false, msg: null as string | null, released: null as string | null,
    anim: true, changing: null as Booking | null, booking: null as Booking | null,
    manage: null as null | { b: Booking; late: boolean; cancelled: boolean; was?: boolean; past?: boolean; busy?: boolean; err?: string }, confirmCancel: false, mload: false,
    proto: { offline: false, fail: false, eventFull: false }, protoOpen: false,
  };
  /* a known guest (profile) or the last booking in this browser fills name and phone */
  try {
    const u = SC.user() as { name?: string; phone?: string } | null;
    const last = SC.load<{ name?: string; phone?: string } | null>("sc-res-last", null);
    const src = (u && u.phone) ? u : last;
    if (src) { st.f.name = String(src.name || ""); st.f.phone = src.phone ? prettyPhone(String(src.phone)) : ""; }
  } catch { /* ignore */ }

  function pickDefaultPeriod(): void {
    if (!st.date) return;
    if (st.slot != null) { st.period = periodOf(st.slot).id; return; }
    const open = openSlots(st.date);
    if (open.some((m) => m >= PERIODS[2].from)) { st.period = "eve"; return; }
    st.period = open.length ? periodOf(open[0]).id : "eve";
  }
  function setDate(d: Date, quiet = false): void {
    if (st.date && same(d, st.date)) return;
    releaseIfNeeded(); st.date = d; st.month = new Date(d.getFullYear(), d.getMonth(), 1);
    if (st.slot != null && !slotOpen(d, st.slot)) st.slot = null;
    pickDefaultPeriod();
    if (!quiet) { try { history.replaceState(null, "", "#" + ymd(d)); } catch { /* ignore */ } }
  }
  function fromHash(): boolean {
    const h = decodeURIComponent((location.hash || "").slice(1));
    if (h === "manage") { openManage(false); return true; }
    if (h === "manage-late" && SC.preview) { openManage(true); return true; }
    const link = /^r-([0-9a-f]+)-([0-9a-f]+)$/i.exec(h); /* the link in the SMS: #r-<id>-<key> */
    if (link) { openLink(link[1], link[2]); return true; }
    if (/^r-[0-9a-f]+-?$/i.test(h)) { st.msg = "Връзката е непълна: липсва краят ѝ. Отворете цялата връзка от SMS-а или се обадете на " + R.phone + "."; return false; }
    const d = parseYmd(h); if (!h) return false;
    if (!d) { st.msg = "Не разпознахме датата в адреса. Изберете ден от календара."; return false; }
    if (d < TODAY) { st.msg = "Датата " + d.getDate() + " " + MONTHS[d.getMonth()] + (d.getFullYear() !== TODAY.getFullYear() ? " " + d.getFullYear() : "") + " вече мина. Изберете друг ден."; return false; }
    if (d > LAST_DAY) { st.msg = "Онлайн приемаме резервации до " + LAST_DAY.getDate() + " " + MONTHS[LAST_DAY.getMonth()] + ". За по-късна дата се обадете на " + R.phone + "."; return false; }
    if (!bookable(d)) { st.msg = "За днес часовете за резервация свършиха. Изберете друг ден."; return false; }
    st.view = "flow"; st.step = 1; st.msg = null; setDate(d, true);
    if (isEvent(d)) { const evm = 1140; /* from "Запази място": the event starts at 19:00 */ if (slotOpen(d, evm)) { st.slot = evm; st.period = "eve"; } }
    return true;
  }

  /* ---------- selection & hold (10 min, on this page) ---------- */
  const tById = (id: string) => TABLES.filter((t) => t.id === id)[0];
  function selInfo(): SelInfo | null {
    if (!st.sel) return null;
    if (st.sel.indexOf("J-") === 0) { const z = st.sel.slice(2) as Zone; return { joined: true, zone: z, label: "Съединени маси", short: "Съединени маси", seats: st.n }; }
    const t = tById(st.sel); return { joined: false, t, zone: t.zone, label: "Маса " + t.n, short: "Маса " + t.n, seats: t.seats };
  }
  const zoneName = (z: Zone, form?: string) => (z === "salon" ? (form === "in" ? "в салона" : "Салон") : (form === "in" ? "в градината" : "Градина"));
  function feats(t: Table) {
    const f: { i: string; n: string }[] = [];
    f.push(t.zone === "garden" ? { i: "tree", n: "В отоплявана градина" } : { i: "chair", n: "В салона" });
    if (t.window) f.push({ i: "sun", n: "До прозореца" });
    if (t.stroller) f.push({ i: "baby", n: "Място за детска количка" });
    if (t.access) f.push({ i: "wheelchair", n: "Достъпна с инвалидна количка" });
    return f;
  }
  function featShort(t: Table): string[] { const f: string[] = []; if (t.window) f.push("до прозореца"); if (t.stroller) f.push("детска количка"); if (t.access) f.push("достъпна"); return f; }
  function pick(id: string): void {
    st.sel = id; st.hold = Date.now() + 600000; st.expired = false; st.released = null;
    const s = selInfo()!; SC.haptic(); SC.toast(s.label + " е задържана за вас за 10 минути"); render();
  }
  function releaseIfNeeded(): void {
    if (st.sel) { const s = selInfo()!; st.released = s.label + " е освободена, защото сменихте " + (st.step === 1 ? "деня, часа или броя хора" : "избора") + "."; st.sel = null; st.hold = 0; st.expired = false; }
  }
  const holdLeft = () => Math.max(0, Math.ceil((st.hold - Date.now()) / 1000));
  const holdTxt = () => { const s = holdLeft(); return Math.floor(s / 60) + ":" + pad(s % 60); };
  function holdChip(): string {
    if (!st.sel || st.expired) return "";
    return '<p class="hold' + (holdLeft() < 60 ? " urgent" : "") + '" data-holdchip>' + ic("timer", 20) + '<span>Масата е задържана за <b data-hold>' + holdTxt() + "</b> мин</span></p>";
  }
  setInterval(() => {
    if (!st.sel || st.expired || st.view !== "flow") return;
    if (holdLeft() <= 0) { st.expired = true; render(); return; }
    const t = holdTxt();
    document.querySelectorAll("[data-hold]").forEach((el) => { el.textContent = t; });
    document.querySelectorAll("[data-holdchip]").forEach((el) => el.classList.toggle("urgent", holdLeft() < 60));
  }, 1000);

  /* ---------- validation ---------- */
  function validate(): Record<string, string> {
    const f = st.f, e: Record<string, string> = {};
    if (!f.name.trim()) e.name = "Напишете името си, за да знаем на кого е масата.";
    if (!f.phone.trim()) e.phone = "Напишете телефон. На него идва потвърждението.";
    else if (!normPhone(f.phone)) e.phone = "Проверете номера. Например: 0888 12 34 56";
    if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.trim())) e.email = "Проверете имейла. Например: ime@primer.bg";
    return e;
  }
  const fmtPhone = (p: string) => (normPhone(p) ? prettyPhone(p) : (p || "").trim());

  /* ---------- pieces ---------- */
  const STEP_N = ["Кога и колко", "Маса", "Данни"];
  function stepper(): string {
    /* the shared stepper (lib/ui.ts): "Стъпка 2 от 3" + "Следва: Данни" / "Последна стъпка", as in every flow */
    return stepperHTML(st.step, 3, STEP_N[st.step], { cls: "rstep", label: "Стъпки на резервацията", now: st.anim });
  }

  /* step 1: calendar */
  function cal(): string {
    const y = st.month.getFullYear(), mo = st.month.getMonth(), first = new Date(y, mo, 1), off = (first.getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate();
    const pm = new Date(y, mo - 1, 1), nm = new Date(y, mo + 1, 1), canP = st.month > MIN_M, canN = st.month < MAX_M;
    let h = '<div class="card cal"><div class="cal-h"><h3 class="cal-m" id="calm" aria-live="polite">' + cap(MONTHS[mo]) + " " + y + '</h3><div class="cal-nav">' +
      '<button class="pill pill-soft mbtn" type="button" data-mon="-1" data-fk="mp"' + (canP ? "" : " disabled") + ' aria-label="' + MON[pm.getMonth()] + ', предишен месец: ' + MONTHS[pm.getMonth()] + '">' + ic("caret-left", 18) + MON[pm.getMonth()] + "</button>" +
      '<button class="pill pill-soft mbtn nx" type="button" data-mon="1" data-fk="mn"' + (canN ? "" : " disabled") + ' aria-label="' + MON[nm.getMonth()] + ', следващ месец: ' + MONTHS[nm.getMonth()] + '">' + MON[nm.getMonth()] + ic("caret-right", 18) + "</button></div></div>";
    h += '<div class="cal-g" role="group" aria-labelledby="calm">' + WD.map((w) => '<span class="wd" aria-hidden="true">' + w + "</span>").join("");
    for (let i = 0; i < off; i++) h += "<span></span>";
    for (let dd = 1; dd <= dim; dd++) {
      const d = new Date(y, mo, dd), ok = bookable(d), ev = isEvent(d), td = same(d, TODAY), on = same(d, st.date);
      const lab = fLong(d) + (td ? ", днес" : "") + (ev ? ", " + EV.n : "") + (!ok && d >= TODAY && d <= LAST_DAY ? ", няма свободни часове" : "");
      h += '<button type="button" class="day' + (td ? " today" : "") + '" data-day="' + ymd(d) + '" data-fk="d' + ymd(d) + '" aria-pressed="' + on + '" aria-label="' + lab + '"' + (ok ? "" : " disabled") + "><span>" + dd + "</span>" + (ev ? '<i class="ev" aria-hidden="true"></i>' : "") + "</button>";
    }
    h += '</div><div class="cal-lg" aria-hidden="true">' + (same(st.month, MIN_M) ? '<span><i class="o"></i>днес</span>' : "") + '<span><i class="e"></i>' + EV.n + " (събитие)</span></div></div>";
    if (same(st.month, MIN_M) && !bookable(TODAY)) h += '<p class="note">' + ic("info", 20) + "<span>За днес часовете за резервация свършиха. Изберете друг ден.</span></p>";
    if (isEvent(st.date)) h += '<div class="evnote" role="note"><span class="evic">' + ic("mask-happy", 22) + "</span><div><b>" + EV.n + " · от " + EV.time + "</b><p>" + esc(EV.text) + '</p><p class="missing small">' + esc(EV.note) + '</p><a class="link" href="' + SC.url.event(EV.id) + '">За събитието' + ic("caret-right", 18) + "</a></div></div>";
    return h;
  }

  /* step 1: time */
  function times(): string {
    if (!st.date) return '<p class="muted">Първо изберете ден.</p>';
    const d = st.date;
    const per = PERIODS.filter((p) => p.id === st.period)[0] || PERIODS[2];
    let h = '<div class="seg" role="group" aria-label="Част от деня">' + PERIODS.map((p) => {
      const any = SLOTS.some((m) => m >= p.from && m <= p.to && slotOpen(d, m));
      return '<button type="button" data-period="' + p.id + '" data-fk="p' + p.id + '" aria-pressed="' + (p.id === per.id) + '"' + (any ? "" : " disabled") + ">" + p.n + "</button>";
    }).join("") + "</div>";
    const list = SLOTS.filter((m) => m >= per.from && m <= per.to && slotOpen(d, m));
    if (!list.length) return h + '<p class="note">' + ic("clock", 20) + "<span>За днес часовете за " + per.n.toLowerCase() + " минаха. Изберете по-късна част от деня или друг ден.</span></p>";
    let anyFull = false;
    h += '<div class="slots" role="group" aria-label="Часове, ' + per.n.toLowerCase() + '">' + list.map((m) => {
      const full = slotFull(d, m, st.n); if (full) anyFull = true;
      if (full) return '<button type="button" class="slot full" data-full="' + m + '" data-fk="s' + m + '" aria-label="' + hm(m) + ', няма свободни маси. Запиши ме в списъка на чакащите"><span>' + hm(m) + "</span><small>пълно</small></button>";
      return '<button type="button" class="slot" data-slot="' + m + '" data-fk="s' + m + '" aria-pressed="' + (st.slot === m) + '">' + hm(m) + "</button>";
    }).join("") + "</div>";
    if (anyFull) h += '<p class="hint">Пълно? Докоснете часа и ще ви запишем в списъка на чакащите.</p>';
    if (takenErr) h += '<p class="hint">Не успяхме да проверим заетите маси. Ще ги проверим пак на следващата стъпка.</p>';
    return h;
  }

  /* step 1: people */
  function people(): string {
    return '<div class="card ppl"><div><h3 class="qh" id="pplh">Колко души?</h3><p>Масите са за 2, 4 и 6. За повече съединяваме маси.</p></div>' +
      '<div class="counter" role="group" aria-labelledby="pplh"><button type="button" data-ppl="-1" data-fk="pm" aria-label="Един човек по-малко"' + (st.n <= 1 ? " disabled" : "") + ">" + ic("minus", 20) + '</button><output aria-live="polite" aria-label="' + ppl(st.n) + '">' + st.n + '</output><button type="button" data-ppl="1" data-fk="pp" aria-label="Още един човек"' + (st.n >= 12 ? " disabled" : "") + ">" + ic("plus", 20) + "</button></div></div>" +
      (st.n >= 12 ? '<p class="ppl-more">Повече от 12 души? Направете празник при нас.<br><a class="link" href="' + SC.url.page("celebration") + '">Празник при нас' + ic("caret-right", 18) + "</a></p>" : "");
  }

  /* an error under a step-1 question (own check or fields.date / time / people from the core) */
  const qErr = (k: string) => (st.err[k] ? '<p class="err qerr" role="alert" id="e-' + k + '">' + esc(st.err[k]) + "</p>" : "");
  function step1(): string {
    return '<div class="s1"><div class="q" id="q-day"><h2 class="qh" tabindex="-1" data-h>Кой ден?</h2>' + (st.msg ? '<p class="note" role="alert" style="margin:0 0 12px">' + ic("info", 20) + "<span>" + esc(st.msg) + "</span></p>" : "") + cal() + qErr("date") + "</div>" +
      '<div class="qcol"><div class="q" id="q-time"><h2 class="qh">В колко часа?</h2>' + times() + qErr("slot") + '</div><div class="q" id="q-ppl">' + people() + qErr("people") + "</div></div></div>";
  }

  /* step 2: floor plan (SVG) from TABLES: a mock layout, 4 columns */
  const needOk = (t: Table) => { const n = st.need; return (!n.access || t.access) && (!n.stroller || t.stroller) && (!n.window || t.window); };
  function tState(t: Table): string { if (st.sel === t.id) return "sel"; if (isTaken(t, st.date!, st.slot!)) return "taken"; if (!suits(t, st.n) || !needOk(t)) return "unfit"; return "free"; }
  const tLabel = (t: Table, s: string) => (s === "taken" ? "заета" : s === "sel" ? "избрана" : t.seats + " места");
  const tAria = (t: Table, s: string) => "Маса " + t.n + ", " + t.seats + " места, " + (s === "free" ? "свободна" : s === "sel" ? "избрана" : s === "taken" ? "заета" : "не е подходяща за " + ppl(st.n)) + (featShort(t).length ? ", " + featShort(t).join(", ") : "");
  function shape(t: Table, cx: number, cy: number): string {
    let s = "";
    if (t.shape === "round") s += '<rect class="ch" x="' + (cx - 40) + '" y="' + (cy - 11) + '" width="10" height="22" rx="4"/><rect class="ch" x="' + (cx + 30) + '" y="' + (cy - 11) + '" width="10" height="22" rx="4"/><circle class="top" cx="' + cx + '" cy="' + cy + '" r="25"/>';
    else if (t.shape === "square") s += '<rect class="ch" x="' + (cx - 12) + '" y="' + (cy - 38) + '" width="24" height="9" rx="4"/><rect class="ch" x="' + (cx - 12) + '" y="' + (cy + 29) + '" width="24" height="9" rx="4"/><rect class="ch" x="' + (cx - 38) + '" y="' + (cy - 12) + '" width="9" height="24" rx="4"/><rect class="ch" x="' + (cx + 29) + '" y="' + (cy - 12) + '" width="9" height="24" rx="4"/><rect class="top" x="' + (cx - 25) + '" y="' + (cy - 25) + '" width="50" height="50" rx="11"/>';
    else { for (let i = 0; i < 3; i++) { const x = cx - 28 + i * 20; s += '<rect class="ch" x="' + x + '" y="' + (cy - 35) + '" width="16" height="9" rx="4"/><rect class="ch" x="' + x + '" y="' + (cy + 26) + '" width="16" height="9" rx="4"/>'; } s += '<rect class="top" x="' + (cx - 35) + '" y="' + (cy - 22) + '" width="70" height="44" rx="11"/>'; }
    return s;
  }
  function hatch(t: Table, cx: number, cy: number): string {
    const f = 'fill="url(#hatch-' + t.zone + ')"';
    if (t.shape === "round") return '<circle cx="' + cx + '" cy="' + cy + '" r="25" ' + f + "/>";
    if (t.shape === "square") return '<rect x="' + (cx - 25) + '" y="' + (cy - 25) + '" width="50" height="50" rx="11" ' + f + "/>";
    return '<rect x="' + (cx - 35) + '" y="' + (cy - 22) + '" width="70" height="44" rx="11" ' + f + "/>";
  }
  function plan(z: Zone): string {
    const T = zoneTables(z), rows = z === "salon" ? 3 : 2, RH = 104, top = 34, W = 360;
    const wallB = top + (rows - 1) * RH + 38 + 72, H = wallB + 32;
    let h = '<svg class="fp" viewBox="0 0 ' + W + " " + H + '" role="group" aria-label="Карта: ' + (z === "salon" ? "салон" : "градина") + '. Свободните маси са с червен контур.">';
    h += '<defs><pattern id="hatch-' + z + '" class="hatch" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="7"/></pattern></defs>';
    h += '<rect class="floor" x="6" y="6" width="' + (W - 12) + '" height="' + (wallB - 6) + '" rx="20"/>';
    if (z === "garden") { h += '<rect class="lawn" x="6" y="6" width="' + (W - 12) + '" height="' + (wallB - 6) + '" rx="20"/>'; for (let b = 0; b < 14; b++) h += '<circle class="bush" cx="' + (24 + b * 24) + '" cy="17" r="' + (b % 2 ? 5 : 6.5) + '"/>'; }
    h += '<rect class="wall" x="6" y="6" width="' + (W - 12) + '" height="' + (wallB - 6) + '" rx="20"/>';
    if (z === "salon") {
      for (let c = 0; c < 4; c++) { const wx = 60 + c * 80; h += '<rect class="win" x="' + (wx - 26) + '" y="2" width="52" height="8" rx="2"/>'; }
      h += '<line class="gap" x1="34" y1="' + wallB + '" x2="96" y2="' + wallB + '"/><line class="gap" x1="266" y1="' + wallB + '" x2="326" y2="' + wallB + '"/>' +
        '<text class="lbl" x="65" y="' + (wallB + 25) + '" text-anchor="middle">Вход</text><text class="lbl" x="296" y="' + (wallB + 24) + '" text-anchor="middle">Градина</text>';
    } else h += '<line class="gap" x1="34" y1="' + wallB + '" x2="96" y2="' + wallB + '"/><text class="lbl" x="65" y="' + (wallB + 24) + '" text-anchor="middle">Салон</text>';
    T.forEach((t) => {
      const cx = 60 + t.x * 80, cy = top + 38 + t.y * RH, s = tState(t);
      h += '<g class="tbl ' + s + '" data-t="' + t.id + '" data-fk="t' + t.id + '" role="button" tabindex="0" aria-pressed="' + (s === "sel") + '" aria-label="' + tAria(t, s) + '">' +
        '<rect class="hit" x="' + (cx - 40) + '" y="' + (cy - 46) + '" width="80" height="104" rx="16"/><rect class="ring" x="' + (cx - 38) + '" y="' + (cy - 44) + '" width="76" height="100" rx="16"/>' +
        '<g class="shp">' + shape(t, cx, cy) + (s === "taken" ? hatch(t, cx, cy) : "") + '<text class="no" x="' + cx + '" y="' + (cy + 8) + '">' + t.n + "</text></g>" +
        '<text class="lb" x="' + cx + '" y="' + (cy + 61) + '">' + tLabel(t, s) + "</text></g>";
    });
    return h + "</svg>";
  }
  function tList(z: Zone): string {
    const T = zoneTables(z).map((t) => ({ t, s: tState(t) }));
    const free = T.filter((x) => x.s === "free" || x.s === "sel"), rest = T.filter((x) => x.s === "taken" || x.s === "unfit");
    const row = (x: { t: Table; s: string }) => {
      const t = x.t, s = x.s, fs = featShort(t);
      const right = s === "free" ? '<button class="pill pill-line" type="button" data-pick="' + t.id + '" data-fk="l' + t.id + '" aria-label="Избери маса ' + t.n + '">Избери</button>'
        : s === "sel" ? '<span class="st sel">' + ic("check", 18) + "Избрана</span>"
          : '<span class="st">' + (s === "taken" ? "Заета в " + hm(st.slot!) : "Не е за " + ppl(st.n)) + "</span>";
      return '<li class="trow ' + s + '"><span class="tno' + (s === "sel" ? " on" : "") + '" aria-hidden="true">' + t.n + "</span><span><b>Маса " + t.n + " · " + t.seats + ' места</b><span class="ft">' + (fs.length ? cap(fs.join(" · ")) : "Без особености") + "</span></span>" + right + "</li>";
    };
    return '<div class="tlist">' + (free.length ? "<h3>Свободни за " + ppl(st.n) + '</h3><ul class="tlist">' + free.map(row).join("") + "</ul>" : "") + (rest.length ? '<h3>Заети или неподходящи</h3><ul class="tlist">' + rest.map(row).join("") + "</ul>" : "") + "</div>";
  }

  const nb = (x: string) => x.replace(/ /g, "&nbsp;");
  const recap = () => '<div class="recap"><span>' + nb(fShort(st.date!)) + " · " + nb(hm(st.slot!) + " · " + ppl(st.n)) + '</span><button class="pill pill-soft" type="button" data-go="1" data-fk="rc1">Промени</button></div>';
  function selCard(): string {
    const s = selInfo(); if (!s) return "";
    let body = '<div class="selrow"><span class="tno on" aria-hidden="true">' + (s.joined ? ic("users-three", 24) : s.t!.n) + "</span><div><b>" + s.label + " · " + s.seats + " места · " + zoneName(s.zone) + "</b><p>" + (s.joined ? "Ще подредим масите преди да дойдете." : (featShort(s.t!).length ? cap(featShort(s.t!).join(" · ")) : "Друга маса? Докоснете я на картата.")) + "</p></div></div>";
    if (st.expired) body += '<div class="alert warn" role="alert">' + ic("timer", 22) + "<div><b>Задържането изтече</b><p>" + s.label + ' още е свободна. Задръжте я пак, за да не я вземе друг.</p><div class="acts"><button class="pill pill-red" type="button" data-rehold data-fk="rh">' + ic("timer", 20) + "Задръж я пак за 10 мин</button></div></div></div>";
    else body += holdChip();
    return '<div class="shell selc" aria-live="polite"><div class="core">' + body + "</div></div>";
  }

  function step2(): string {
    const d = st.date!, m = st.slot!, n = st.n;
    if (!known(d, m) && !takenErr) return recap() + '<h2 class="vh" tabindex="-1" data-h>' + (n > 6 ? "Изберете зона" : "Изберете маса") + '</h2><div class="skel" style="height:64px;border-radius:22px"></div><div class="skel skmap" style="margin-top:16px"></div><p class="muted center" style="margin-top:12px">Проверяваме свободните маси за ' + hm(m) + "...</p>";
    let h = recap();
    if (!known(d, m)) h += '<div class="alert bad" role="alert" style="margin-bottom:14px">' + ic("warning-circle", 22) + '<div><b>Не успяхме да проверим заетите маси</b><p>Изберете маса. Ако вече е заета, ще ви кажем при запазването.</p><div class="acts"><button class="pill pill-line" type="button" data-retake data-fk="rt">Опитай пак</button></div></div></div>';
    if (st.released) h += '<p class="note" role="status" style="margin:0 0 14px">' + ic("info", 20) + "<span>" + esc(st.released) + "</span></p>";
    if (n > 6) { /* large group: tables are joined, the guest picks a zone */
      h += '<div class="shell grp"><div class="core"><div class="row" style="align-items:flex-start;gap:14px"><span class="gic">' + ic("users-three", 26) + '</span><div><h2 class="h3" tabindex="-1" data-h>За ' + n + ' души ще съединим маси</h2><p>Изберете къде предпочитате. Ние ще подредим масите преди да дойдете.</p></div></div><div class="opts">' +
        (["salon", "garden"] as Zone[]).map((z) => {
          const ok = freeSeats(z, d, m) >= n + 2, on = st.sel === "J-" + z;
          return '<div class="gopt' + (on ? " on" : "") + '"><span><b>' + zoneName(z) + "</b><small>" + (z === "garden" ? "Затворена и отоплявана" : "Масите до прозорците") + "</small></span>" +
            (on ? '<span class="st sel" style="color:var(--red);font-weight:800;display:inline-flex;gap:4px;align-items:center;padding-right:10px">' + ic("check", 18) + "Избрано</span>"
              : ok ? '<button class="pill pill-red" type="button" data-pick="J-' + z + '" data-fk="j' + z + '">Избери ' + zoneName(z, "in").replace("в ", "") + "</button>"
                : '<span class="small muted" style="padding-right:10px;text-align:right">Няма място в ' + hm(m) + "</span>") + "</div>";
        }).join("") + "</div></div></div>";
      return h + selCard();
    }
    const cnt: Record<Zone, number> = { salon: freeTables("salon", d, m, n).length, garden: freeTables("garden", d, m, n).length };
    h += '<h2 class="vh" tabindex="-1" data-h>Изберете маса</h2><div class="seg zseg" role="group" aria-label="Зона">' + (["salon", "garden"] as Zone[]).map((z) =>
      '<button type="button" data-zone="' + z + '" data-fk="z' + z + '" aria-pressed="' + (st.zone === z) + '">' + ic(z === "salon" ? "chair" : "tree", 22) + "<span>" + zoneName(z) + "<small>" + (cnt[z] ? SC.plural(cnt[z], "свободна", "свободни") : "няма свободни") + "</small></span></button>").join("") + "</div>";
    if (st.zone === "garden") h += '<p class="znote">' + ic("thermometer", 20) + "Затворена и отоплявана, работи целогодишно.</p>";
    const other: Zone = st.zone === "salon" ? "garden" : "salon";
    if (!cnt[st.zone]) h += '<div class="alert zempty" style="margin-top:14px">' + ic("info", 22) + "<div><b>" + cap(zoneName(st.zone, "in")) + " няма свободна маса за " + ppl(n) + " в " + hm(m) + '.</b><div class="acts">' +
      (cnt[other] ? '<button class="pill pill-red" type="button" data-zone="' + other + '" data-fk="zo">Виж ' + (other === "garden" ? "градината" : "салона") + " · " + cnt[other] + " " + (cnt[other] === 1 ? "свободна" : "свободни") + "</button>" : "") +
      '<button class="pill pill-line" type="button" data-waitlist="' + m + '" data-fk="wl">Запиши ме в списъка на чакащите</button><button class="pill pill-line" type="button" data-go="1" data-fk="oh">Друг час</button></div></div></div>';
    const legend = '<ul class="lgd" aria-label="Легенда"><li><i class="sw free"></i>Свободна</li><li><i class="sw sel"></i>Избрана</li><li><i class="sw taken"></i>Заета</li><li><i class="sw unfit"></i>Не е за ' + ppl(n) + "</li>" + (st.zone === "salon" ? '<li><i class="sw win"></i>Прозорец</li>' : "") + "</ul>";
    const needs = '<div class="needs"><span class="label">Нужно ви е:</span><div class="chips">' +
      ([["access", "wheelchair", "Достъпна маса"], ["stroller", "baby", "Място за количка"]].concat(st.zone === "salon" ? [["window", "sun", "До прозореца"]] : [])).map((x) =>
        '<button class="chip" type="button" data-need="' + x[0] + '" data-fk="n' + x[0] + '" aria-pressed="' + !!st.need[x[0]] + '">' + ic(x[1], 20) + x[2] + "</button>").join("") + '</div><p class="more" data-morehint hidden>Плъзнете настрани за още' + ic("caret-right", 18) + "</p></div>";
    const view = st.list ? tList(st.zone) : '<div class="shell mapbox"><div class="core">' + plan(st.zone) + "</div></div>";
    const toggle = '<div class="below"><button class="link" type="button" data-list data-fk="lv">' + ic(st.list ? "map-trifold" : "list-bullets", 20) + (st.list ? "Предпочитам картата" : "Предпочитам списък") + "</button>" + (st.list ? "" : '<span class="small muted">Докоснете маса за подробности</span>') + "</div>";
    h += '<div class="s2" style="margin-top:4px"><div>' + (st.list ? "" : legend) + view + toggle + '</div><div class="side">' + needs + "</div></div>";
    return h + selCard();
  }

  /* step 3: details */
  function field(id: string, label: string, opt: boolean, input: string, help?: string): string {
    const e = st.err[id];
    return '<div class="field"><label for="f-' + id + '">' + label + (opt ? ' <span class="opt">(по желание)</span>' : "") + "</label>" + input + (help && !e ? '<span class="help" id="h-' + id + '">' + help + "</span>" : "") + (e ? '<span class="err" id="e-' + id + '" role="alert">' + e + "</span>" : "") + "</div>";
  }
  function inp(id: keyof Draft, type: string, attrs = ""): string {
    const e = st.err[id];
    return '<input class="input" id="f-' + id + '" name="' + id + '" type="' + type + '" value="' + esc(st.f[id]) + '" data-f="' + id + '" data-fk="f' + id + '" ' + attrs + (e ? ' aria-invalid="true" aria-describedby="e-' + id + '"' : ' aria-describedby="h-' + id + '"') + ">";
  }
  const OCC = ["Рожден ден", "Имен ден", "Годишнина", "Делова среща", "Друго"];
  const occIc = (o: string) => (o === "Рожден ден" ? "cake" : o === "Годишнина" ? "heart" : o === "Делова среща" ? "briefcase" : o === "Имен ден" ? "gift" : "confetti");
  function step3(): string {
    const s = selInfo()!;
    let h = '<div class="rc"><div class="shell"><div class="core"><span class="li">' + ic("calendar-blank", 20) + fShort(st.date!) + " · " + hm(st.slot!) + '</span><span class="li">' + ic("users", 20) + ppl(st.n) + '</span><span class="li">' + ic("chair", 20) + s.label + " · " + zoneName(s.zone) + "</span>" +
      (st.expired ? "" : holdChip()) + '<div class="acts"><button class="link" type="button" data-go="1" data-fk="rc1">Промени часа</button><button class="link" type="button" data-go="2" data-fk="rc2">Смени масата</button></div></div></div></div>';
    if (st.expired) h += '<div class="alert warn" role="alert" style="margin-top:14px">' + ic("timer", 22) + "<div><b>Задържането изтече</b><p>" + s.label + ' още е свободна. Задръжте я пак и довършете резервацията.</p><div class="acts"><button class="pill pill-red" type="button" data-rehold data-fk="rh">' + ic("timer", 20) + "Задръж я пак за 10 мин</button></div></div></div>";
    if (st.blocked) return h + '<div class="alert" role="alert" data-blocked style="margin-top:20px">' + ic("phone", 22) + '<div><b tabindex="-1" data-h>Тази резервация ще уредим по телефона</b><p>За номера ' + esc(st.f.phone) + " не можем да потвърдим резервация онлайн. Обадете ни се на " + R.phone + ' и ще намерим маса заедно.</p><div class="acts"><button class="pill pill-line" type="button" data-unblock data-fk="ub">' + ic("pencil-simple", 20) + "Поправи номера</button></div></div></div>";
    h += '<h2 class="h2" style="margin-top:26px" tabindex="-1" data-h>Вашите данни</h2><form class="form" novalidate data-form>';
    h += '<div class="two">' + field("name", "Име", false, inp("name", "text", 'autocomplete="name" autocapitalize="words"'), "На това име е масата.") +
      field("phone", "Телефон", false, inp("phone", "tel", 'autocomplete="tel" inputmode="tel" placeholder="0888 12 34 56"'), "Тук идва потвърждението по SMS или Viber.") + "</div>";
    h += field("email", "Имейл", true, inp("email", "email", 'autocomplete="email" inputmode="email" placeholder="ime@primer.bg"'), "Ще ви пратим и покана за календара.");
    h += '<div class="field occ"><span class="label" id="occl">Повод <span class="opt">(по желание)</span></span><div class="chips" role="group" aria-labelledby="occl">' + OCC.map((o) => '<button class="chip" type="button" data-occ="' + o + '" data-fk="o' + o + '" aria-pressed="' + (st.f.occ === o) + '">' + ic(occIc(o), 20) + o + "</button>").join("") + "</div>" +
      (st.f.occ === "Рожден ден" || st.f.occ === "Имен ден" ? '<span class="help">Искате торта или украса?</span><a class="link" href="' + SC.url.page("celebration") + '">Празник при нас' + ic("caret-right", 18) + "</a>" : "") + "</div>";
    h += '<div class="field"><label for="f-note">Бележка <span class="opt">(по желание)</span></label><textarea class="input" id="f-note" data-f="note" data-fk="fnote" rows="3" placeholder="Например: идваме с бебе в количка">' + esc(st.f.note) + "</textarea></div>";
    h += '<div class="consent"><label class="check"><input type="checkbox" data-consent data-fk="cs"' + (st.f.consent ? " checked" : "") + '><span><b>' + MKT_TITLE + '</b><span class="muted">' + MKT_SUB + "</span></span></label></div>";
    if (st.fail) h += '<div class="alert bad" role="alert">' + ic(st.fail === "offline" ? "warning-circle" : "warning", 22) + '<div><b tabindex="-1" data-failh>' + (st.fail === "offline" ? "Няма връзка с интернет" : "Не успяхме да запазим резервацията") + "</b><p>" + (st.fail === "offline" ? "Данните ви са запазени тук и масата остава задържана. Проверете интернета и опитайте пак." : (st.failText ? esc(st.failText) : "Масата остава задържана за вас. Опитайте пак след малко или ни се обадете на " + R.phone + ".")) + '</p><div class="acts">' +
      /* too many tries (429): another try is refused too, so the action is the phone */
      (st.failCall ? callBtn("pill pill-red") : '<button class="pill pill-red" type="button" data-act="next" data-fk="retry">' + ic("arrow-clockwise", 20) + "Опитай пак</button>") + "</div></div></div>";
    h += '<p class="rules">' + ic("info", 20) + "<span>Без депозит. Промяна или отказ от връзката в SMS-а: до 2 часа преди резервация след 17:00 и до 1 час преди през деня.</span></p>";
    h += '<button type="submit" class="vh" tabindex="-1">Резервирай</button></form>';
    return h;
  }

  /* ---------- CTA (phone bar + desktop summary) ---------- */
  function cta(): { t: string; s: string; rehold?: boolean; tel?: boolean } {
    const s = selInfo();
    if (st.step === 1) {
      if (!st.date) return { t: "Избери ден", s: "Докоснете ден" };
      if (st.slot == null) return { t: "Избери час", s: fTiny(st.date) + " · " + ppl(st.n) };
      return { t: "Избери маса", s: fTiny(st.date) + " · " + hm(st.slot) + " · " + ppl(st.n) };
    }
    if (st.step === 2) {
      if (!s) return { t: st.n > 6 ? "Избери зона" : "Избери маса", s: st.n > 6 ? "Салон или градина" : "Докоснете маса" };
      if (st.expired) return { t: "Задръж " + s.label.toLowerCase() + " пак", s: "Задържането изтече", rehold: true };
      return { t: "Попълни данните", s: s.short + ' · <span data-hold>' + holdTxt() + "</span> мин" };
    }
    if (st.blocked) return { t: "Обади се", s: R.phone, tel: true };
    if (st.expired && s) return { t: "Задръж " + s.label.toLowerCase() + " пак", s: "Задържането изтече", rehold: true };
    return { t: "Резервирай маса за " + (st.n === 1 ? "един" : st.n), s: fTiny(st.date!) + " · " + hm(st.slot!) };
  }
  function ctaBtn(cls = ""): string {
    const c = cta(), solo = st.step === 1;
    if (c.tel) return '<a class="pill pill-red cta ' + cls + '" href="' + TEL + '"><span class="ct"><b>' + ic("phone", 20).replace('class="ic"', 'class="ic" style="display:inline;vertical-align:-4px;margin-right:6px"') + c.t + "</b><small>" + c.s + "</small></span></a>";
    return '<button class="pill pill-red cta ' + cls + (solo ? " solo" : "") + '" type="button" data-act="' + (c.rehold ? "rehold" : "next") + '"' + (st.busy ? ' aria-busy="true"' : "") + '><span class="ct"><b>' + c.t + "</b><small>" + (st.busy ? "Запазваме масата..." : c.s) + "</small></span>" + (st.busy ? '<span class="spin" aria-hidden="true"></span>' : (solo || cls === "wide" ? '<span class="knob">' + ic("arrow-right", 22) + "</span>" : "")) + "</button>";
  }
  function renderBar(): void {
    if (st.view !== "flow") { bar.hidden = true; SC.ov.classList.remove("rfocus"); return; }
    bar.hidden = false; const focus = st.step > 1; bar.classList.toggle("nonav", focus); SC.ov.classList.toggle("rfocus", focus);
    bar.innerHTML = (st.step > 1 ? '<button class="pill pill-soft back" type="button" data-act="back">' + ic("arrow-left", 20) + "Назад</button>" : "") + ctaBtn();
  }
  function summary(): string {
    const s = selInfo();
    const kv = (k: string, v: string | null | false | undefined) => '<div class="kv"><span>' + k + "</span>" + (v ? "<b>" + v + "</b>" : '<b class="no">избирате</b>') + "</div>";
    return '<aside class="aside" aria-label="Вашата резервация"><div class="shell sum"><div class="core"><h2>Вашата резервация</h2>' +
      kv("Ден", st.date && fShort(st.date)) + kv("Час", st.slot != null && hm(st.slot)) + kv("Хора", ppl(st.n)) + kv("Маса", s && (s.label + " · " + zoneName(s.zone))) +
      (st.sel && !st.expired ? holdChip() : "") + ctaBtn("wide") + (st.step > 1 ? '<button class="link back flow-back" type="button" data-act="back">' + ic("arrow-left", 18) + "Назад</button>" : "") +
      '</div></div><ul class="trust"><li>' + ic("wallet", 20) + "Без депозит</li><li>" + ic("chat-circle-dots", 20) + "Потвърждение по SMS или Viber</li><li>" + ic("phone", 20) + '<a class="link" href="tel:' + R.phoneIntl + '">Обади се · <span class="nw">' + R.phone + "</span></a></li></ul></aside>";
  }

  /* ---------- success, manage ---------- */
  function kvRows(b: Booking): string {
    return '<div class="kv"><span>Кога</span><b>' + cap(fLong(b.date)) + ", " + hm(b.slot) + '</b></div><div class="kv"><span>Колко души</span><b>' + ppl(b.n) + '</b></div><div class="kv"><span>Маса</span><b>' + esc(b.selLabel) + "</b></div>" +
      (b.name ? '<div class="kv"><span>На името на</span><b>' + esc(b.name) + "</b></div>" : "") + (b.phone ? '<div class="kv"><span>Телефон</span><b>' + esc(b.phone) + "</b></div>" : "") +
      (b.occ ? '<div class="kv"><span>Повод</span><b>' + esc(b.occ) + "</b></div>" : "") + (b.note ? '<div class="kv"><span>Бележка</span><b>' + esc(b.note) + "</b></div>" : "");
  }
  function calTimes(b: Booking) {
    const d = ymd(b.date).replace(/-/g, ""), e2 = b.slot + 120;
    return { s: d + "T" + pad(Math.floor(b.slot / 60)) + pad(b.slot % 60) + "00", e: d + "T" + pad(Math.floor(e2 / 60) % 24) + pad(e2 % 60) + "00" };
  }
  function gcalUrl(b: Booking): string {
    const t = calTimes(b);
    return "https://calendar.google.com/calendar/render?action=TEMPLATE&text=" + encodeURIComponent("Маса в " + R.name) + "&dates=" + t.s + "/" + t.e + "&ctz=Europe/Sofia&location=" + encodeURIComponent(R.address) + "&details=" + encodeURIComponent(b.selLabel + ", " + ppl(b.n) + ". Телефон: " + R.phone);
  }
  function icsFile(b: Booking): void {
    const t = calTimes(b), now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const txt = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Siracusa Bar & Grill//BG", "BEGIN:VEVENT", "UID:" + (b.id || t.s + "-" + Math.random().toString(36).slice(2)) + "@siracusa-sofia.com", "DTSTAMP:" + now,
      "DTSTART;TZID=Europe/Sofia:" + t.s, "DTEND;TZID=Europe/Sofia:" + t.e, "SUMMARY:Маса в Siracusa Bar & Grill", "LOCATION:" + R.address.replace(/,/g, "\\,"), "DESCRIPTION:" + (b.selLabel + " · " + ppl(b.n) + ". Телефон: " + R.phone).replace(/,/g, "\\,"),
      "BEGIN:VALARM", "TRIGGER:-PT3H", "ACTION:DISPLAY", "DESCRIPTION:Резервация в Siracusa", "END:VALARM", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([txt], { type: "text/calendar" })); a.download = "siracusa-rezervatsia.ics"; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function done(): string {
    const b = st.booking!, ev = isEvent(b.date);
    return '<section class="sec rdone"><div class="done-in"><div class="dhero"><div class="okm" aria-hidden="true">' + ic("check", 48) + '</div><h1 class="h1" tabindex="-1" data-h>' + (b.changed ? "Резервацията е променена" : "Масата е запазена") + '</h1><p class="lead">Очакваме ви ' + fWhen(b.date) + ", в&nbsp;" + hm(b.slot) + ".</p></div>" +
      '<div class="dgrid"><div class="shell dcard"><div class="core">' + kvRows(b) + '</div></div><div class="dside"><p class="sms">' + ic("chat-circle-dots", 22) + "<span>Потвърждението идва по SMS или Viber на " + esc(b.phone) + ".</span></p>" +
      '<button class="pill pill-red pill-lg pill-block" type="button" data-ics data-fk="ics">' + ic("calendar-check", 22) + 'Добави в календара</button><a class="link gcal" href="' + gcalUrl(b) + '" target="_blank" rel="noopener">или в Google Календар' + ic("arrow-up-right", 18) + "</a>" +
      '<div class="two"><a class="pill pill-line" href="' + R.maps + '" target="_blank" rel="noopener">' + ic("map-pin", 20) + 'Маршрут</a>' + callBtn("pill pill-line") + "</div></div></div>" +
      (ev ? '<div class="evnote" style="margin-top:16px"><span class="evic">' + ic("mask-happy", 22) + "</span><div><b>Този ден е " + EV.n + "</b><p>Започва в " + EV.time + ". " + esc(EV.text) + '</p><a class="link" href="' + SC.url.event(EV.id) + '">За събитието' + ic("caret-right", 18) + "</a></div></div>" : "") +
      '<h2 class="h3" style="margin-top:36px">Какво следва</h2><ol class="nexts">' +
      '<li><span class="ni">' + ic("bell", 22) + "</span><span><b>Напомняме ви ден преди и 3 часа преди</b><p>По SMS или Viber, на същия номер.</p></span></li>" +
      '<li><span class="ni">' + ic("pencil-simple", 22) + "</span><span><b>Промяна или отказ от връзката в SMS-а</b><p>Или от „Промени или откажи“ по-долу. До 2 часа преди резервация след 17:00 и до 1 час преди през деня. По-късно: на " + R.phone + ".</p></span></li>" +
      '<li><span class="ni">' + ic("wallet", 22) + "</span><span><b>Без депозит</b><p>Плащате само това, което поръчате.</p></span></li></ol>" +
      '<div class="row" style="flex-wrap:wrap;gap:8px 20px;margin-top:20px"><button class="link" type="button" data-manage="ok" data-fk="mg">' + ic("pencil-simple", 20) + 'Промени или откажи</button><a class="link" href="' + SC.url.menu() + '">' + ic("fork-knife", 20) + 'Разгледай менюто</a><button class="link" type="button" data-new data-fk="nw">' + ic("plus", 20) + "Нова резервация</button></div></div></section>";
  }
  /* the last booking made in this browser (per-viewer convenience; the real record is in the core) */
  function saveLast(b: Booking): void { SC.store("sc-res-last", { ...b, date: ymd(b.date) }); }
  function loadLast(): Booking | null {
    const x = SC.load<(Omit<Booking, "date"> & { date: string }) | null>("sc-res-last", null);
    const d = x && parseYmd(x.date);
    return x && d ? { ...x, date: d } : null;
  }
  const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
  /** the core's record -> what the manage screen shows */
  function fromRes(r: Reservation, key?: string): Booking | null {
    const d = parseYmd(r.date); if (!d) return null;
    const t = r.table ? tById(r.table) : null;
    const label = t ? "Маса " + t.n + " · " + zoneName(t.zone) : r.status === "waitlist" ? "Списък на чакащите" : "Съединени маси" + (r.zone ? " · " + zoneName(r.zone) : "");
    return { id: r.id, key: r.key || key, status: r.status, table: r.table, dur: r.dur, date: d, slot: toMin(r.time), n: r.people, selLabel: label, name: r.name, phone: fmtPhone(r.phone), occ: r.occasion, note: r.note };
  }
  const minsLeft = (b: Booking) => b.fake || (same(b.date, TODAY) ? b.slot - SC.minutes() : b.date < TODAY ? -1 : 99999);
  function setManage(b: Booking): void {
    const lim = b.slot >= EVENING ? 120 : 60, left = minsLeft(b);
    const past = !b.fake && (left < 0 || b.status === "seated" || b.status === "no_show");
    const was = b.status === "cancelled";
    st.manage = { b, late: !past && left < lim, past, cancelled: was, was }; st.view = "manage"; st.confirmCancel = false; st.anim = true;
  }
  /** the stored copy can be old (the staff may have cancelled it): ask the core when there is an id */
  function refresh(b: Booking): void {
    if (!b.id) return;
    api.reservations.get(b.id, b.key).then((r) => {
      const fresh = fromRes(r, b.key); const M = st.manage;
      if (!fresh || !M || M.b.id !== b.id || st.view !== "manage" || M.busy || st.confirmCancel) return;
      if (fresh.status !== b.status || fresh.slot !== b.slot || ymd(fresh.date) !== ymd(b.date) || fresh.n !== b.n) { setManage({ ...b, ...fresh }); st.anim = false; render(); }
    }).catch(() => { /* keep the stored copy */ });
  }
  function openManage(late: boolean): void {
    let b = st.booking || loadLast();
    if (late) { /* preview only: a booking that starts soon */
      const base = b || { date: TODAY, slot: 1170, n: 4, selLabel: "Маса 5 · Салон", phone: "0888 12 34 56" };
      const nowM = SC.minutes(), m = Math.ceil((nowM + 40) / 10) * 10;
      b = m <= 1290 ? { ...base, id: undefined, status: undefined, date: TODAY, slot: m } : { ...base, id: undefined, status: undefined, date: TODAY, slot: 1170, fake: 80 };
    }
    if (!b) { st.msg = "Не намерихме ваша резервация в този браузър. Отворете връзката от SMS-а, направете нова или се обадете на " + R.phone + "."; st.view = "flow"; return; }
    setManage(b);
    if (!late) refresh(b);
  }
  /** #r-<id>-<key>: the link in the SMS, from any device */
  function openLink(id: string, k: string): void {
    st.view = "manage"; st.manage = null; st.mload = true; st.confirmCancel = false;
    api.reservations.get(id, k).then((r) => {
      st.mload = false;
      const b = fromRes(r, k);
      if (!b) throw new Error("bad date");
      setManage(b); render(); toTop(true);
    }).catch((e) => {
      st.mload = false; st.view = "flow"; st.step = 1;
      st.msg = e instanceof ApiError && e.code === "not_found" ? "Не намерихме тази резервация. Проверете връзката в SMS-а или се обадете на " + R.phone + "."
        : "Не успяхме да заредим резервацията. Проверете интернета и опитайте пак или се обадете на " + R.phone + ".";
      if (!st.date) setDate(bookable(TODAY) ? TODAY : addDays(TODAY, 1), true);
      st.anim = true; render(); toTop();
    });
  }
  function manage(): string {
    if (!st.manage) return '<section class="sec rdone"><div class="done-in" style="max-width:640px" aria-busy="true"><p class="small muted" style="margin:0 0 6px;font-weight:700">Промяна или отказ</p><h1 class="h1" tabindex="-1" data-h>Вашата резервация</h1>' +
      '<div class="skel" style="height:220px;border-radius:22px;margin-top:20px"></div><p class="muted center" style="margin-top:12px" role="status">Зареждаме резервацията...</p></div></section>';
    const M = st.manage, b = M.b, lim = b.slot >= EVENING ? 120 : 60;
    const left = minsLeft(b);
    if (M.cancelled) return '<section class="sec rdone"><div class="done-in"><div class="dhero"><div class="okm off" aria-hidden="true">' + ic("calendar-blank", 44) + '</div><h1 class="h1" tabindex="-1" data-h>Резервацията е отказана</h1><p class="lead">' +
      (M.was ? "Резервацията за " + fShort(b.date) + ", " + hm(b.slot) + " вече е отказана. Ако искате да дойдете, запазете нова маса." : "Благодарим, че ни казахте навреме. Така масата ще стигне до други гости.") + "</p>" +
      '<button class="pill pill-red pill-lg" type="button" data-new data-fk="nw" style="margin-top:12px">' + ic("calendar-blank", 22) + "Резервирай нова маса</button></div></div></section>";
    let h = '<section class="sec rdone"><div class="done-in" style="max-width:640px"><p class="small muted" style="margin:0 0 6px;font-weight:700">Промяна или отказ</p><h1 class="h1" tabindex="-1" data-h>Вашата резервация</h1>' +
      '<div class="shell dcard" style="margin-top:20px"><div class="core">' + kvRows(b) + '</div></div><div style="margin-top:16px">';
    const rule = lim === 120 ? "2 часа преди резервация след 17:00" : "1 час преди резервация през деня";
    const callBtnR = (cls: string) => callBtn("pill pill-red " + cls);
    if (M.past) h += '<div class="alert">' + ic("calendar-blank", 22) + "<div><b>Тази резервация вече мина</b><p>Промяна и отказ вече не са нужни. Ако искате да дойдете пак, запазете нова маса.</p>" +
      '<div class="acts"><button class="pill pill-red" type="button" data-new data-fk="nw">' + ic("calendar-blank", 20) + "Резервирай нова маса</button></div></div></div>";
    else if (M.late) h += '<div class="alert warn">' + ic("lock", 22) + "<div><b>Онлайн промяна вече не е възможна</b>" + (b.fake ? '<p class="small">(Преглед: представете си, че сега е 18:10.)</p>' : "") + "<p>До резервацията остават " + (left >= 60 ? Math.floor(left / 60) + " ч" + (left % 60 ? " " + (left % 60) + " мин" : "") : left + " мин") + ". Онлайн промяна и отказ има до " + rule + ', за да успеем да подготвим масата или да я предложим на други гости.</p><p style="color:var(--ink);font-weight:700">Обадете ни се и ще помогнем.</p><div class="acts">' + callBtnR("") + "</div></div></div>";
    else if (!b.id && !SC.preview) h += '<div class="mng"><p class="rules">' + ic("info", 20) + "<span>Тази резервация не намираме онлайн. Промяна и отказ: по телефона, до " + rule + ".</span></p>" + callBtnR("pill-lg pill-block") + "</div>";
    else if (st.confirmCancel) h += '<div class="confirm" role="alertdialog" aria-labelledby="cfh"><h2 id="cfh" class="cfh" tabindex="-1" data-fk="cfh">Да откажем ли резервацията за ' + fShort(b.date) + ", " + hm(b.slot) + "?</h2><p>" + (b.status === "waitlist" ? "Ще ви махнем от списъка на чакащите." : "Масата ще се освободи за други гости.") + "</p>" + (M.err ? '<p class="err" role="alert">' + esc(M.err) + "</p>" : "") + '<div class="acts"><button class="pill pill-line pill-lg" type="button" data-cancel="yes" data-fk="cy"' + (M.busy ? ' aria-busy="true" disabled' : "") + ">" + ic("x", 20) + 'Да, откажи резервацията</button><button class="pill pill-red pill-lg" type="button" data-cancel="no" data-fk="cn">Не, запази я</button></div></div>';
    else h += '<div class="mng"><button class="pill pill-red pill-lg pill-block" type="button" data-change data-fk="ch">' + ic("pencil-simple", 22) + '<span>Промени деня, часа или масата</span></button><button class="pill pill-line pill-lg pill-block" type="button" data-cancel="ask" data-fk="ca">' + ic("x", 22) + "<span>Откажи резервацията</span></button>" +
      '<p class="rules">' + ic("info", 20) + "<span>Можете да промените или откажете тук или от връзката в SMS-а до " + (lim === 120 ? "2 часа преди (резервация след 17:00)" : "1 час преди (резервация през деня)") + ". По-късно: на " + R.phone + ".</span></p></div>";
    return h + "</div></div></section>";
  }

  /* ---------- preview panel (?preview=1 only) ---------- */
  function proto(): string {
    if (!SC.preview) return "";
    const p = st.proto;
    const b = (k: string, t: string) => '<button class="chip" type="button" data-proto="' + k + '" data-fk="x' + k + '">' + t + "</button>";
    const a = (k: string) => 'data-proto="' + k + '" data-fk="x' + k + '"';
    /* the shared panel (lib/ui.ts): the same title, sentence and switch words as on every page */
    return previewPanel(pvToggle(PV.offline, p.offline, a("offline")) + pvToggle(PV.error + " при запазване", p.fail, a("fail")) + pvToggle(EV.n + ": пълно 19:00 - 20:30", p.eventFull, a("event")) +
      b("group", "Голяма група: 8 души") + b("expire", "Задържането изтича след 5 сек.") + b("blocked", "Блокиран номер 0888 00 00 00") + b("manage", "Промяна или отказ: навреме") + b("late", "Промяна или отказ: по-малко от 2 ч / 1 ч"), { id: "r-pv" });
  }

  /* ---------- render ---------- */
  function render(): void {
    const a = document.activeElement as HTMLInputElement | null, fk = a && a.getAttribute && a.getAttribute("data-fk"), selS = a && "selectionStart" in a ? a.selectionStart : null;
    /* the step's heading had the focus (after a step change): a redraw (fresh occupancy) puts it on the new heading */
    const onHead = !!(a && a.hasAttribute && a.hasAttribute("data-h") && !fk);
    const flow = st.view === "flow";
    heroEl.hidden = !flow; flowEl.hidden = !flow; infoEl.hidden = !flow; viewEl.hidden = flow;
    if (flow) {
      const body = st.step === 1 ? step1() : st.step === 2 ? step2() : step3();
      flowEl.removeAttribute("aria-busy");
      flowEl.innerHTML = '<div class="fgrid"><div class="fmain">' + stepper() + '<div class="' + (st.anim ? "enter" : "") + '">' + body + "</div></div>" + summary() + "</div>";
      viewEl.innerHTML = "";
    } else viewEl.innerHTML = st.view === "done" ? done() : manage();
    protoEl.innerHTML = proto();
    renderBar(); st.anim = false; moreChips();
    if (onHead) focusHead();
    if (fk) { const el = document.querySelector<HTMLInputElement>('[data-fk="' + fk + '"]'); if (el) { try { el.focus({ preventScroll: true }); if (selS != null && el.setSelectionRange) el.setSelectionRange(selS, selS); } catch { /* ignore */ } } }
    want();
  }
  /* the "Нужно ви е" row slides on a phone: fade the edge and say so while chips are hidden on the right */
  function moreChips(): void {
    document.querySelectorAll<HTMLElement>(".needs .chips").forEach((c) => {
      const more = c.scrollWidth - c.clientWidth - c.scrollLeft > 4;
      c.toggleAttribute("data-more", more);
      const hint = c.parentElement?.querySelector<HTMLElement>("[data-morehint]");
      if (hint) hint.hidden = !(c.scrollWidth - c.clientWidth > 4) || c.scrollLeft > 4;
    });
  }
  document.addEventListener("scroll", (e) => { const el = e.target as HTMLElement; if (el && el.matches && el.matches(".needs .chips")) moreChips(); }, true);
  window.addEventListener("resize", moreChips);
  const wide = () => SC.device.clientWidth >= 900;
  function focusHead(): void { const hd = main.querySelector<HTMLElement>("[data-h]:not([hidden] *)"); if (hd) hd.focus({ preventScroll: true }); }
  function toTop(head = false): void {
    const tgt = st.view === "flow" ? flowEl : viewEl;
    const y = tgt.getBoundingClientRect().top + window.scrollY - (wide() ? 170 : 140);
    window.scrollTo({ top: Math.max(0, st.view === "flow" && !wide() ? y : 0), behavior: "auto" });
    if (head) focusHead();
  }
  function scrollToEl(el: Element | null): void {
    if (!el) return;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 150, behavior: smooth() });
  }

  function go(n: number): void {
    if (n === st.step) return;
    st.step = n; st.anim = true; st.err = {}; st.fail = null;
    if (n === 2 && st.date && st.slot != null) { takenErr = false; taken.delete(key(st.date, st.slot)); loadTaken(st.date, [st.slot], true).then(() => render()); }
    render(); toTop(true);
  }
  function next(): void {
    if (st.busy) return;
    if (st.step === 1) {
      if (!st.date) { scrollToEl(document.getElementById("q-day")); return; }
      if (st.slot == null) { st.err.slot = "Изберете час, за да видим свободните маси."; render(); scrollToEl(document.getElementById("q-time")); return; }
      if (known(st.date, st.slot)) st.zone = freeTables(st.zone, st.date, st.slot, st.n).length || st.n > 6 ? st.zone : (st.zone === "salon" ? "garden" : "salon");
      go(2); return;
    }
    if (st.step === 2) {
      if (!st.sel) { SC.toast(st.n > 6 ? "Изберете салон или градина" : "Докоснете свободна маса на картата"); scrollToEl(main.querySelector(".mapbox, .tlist, .grp")); return; }
      if (st.expired) { rehold(); return; }
      go(3); return;
    }
    if (st.expired) { rehold(); return; }
    st.err = validate();
    if (Object.keys(st.err).length) { st.fail = null; render(); const first = main.querySelector<HTMLElement>('[aria-invalid="true"]'); if (first) { scrollToEl(first); first.focus({ preventScroll: true }); } return; }
    submit();
  }
  async function submit(): Promise<void> {
    st.busy = true; st.fail = null; st.failText = null; st.failCall = false; render();
    const s = selInfo()!, f = st.f, d = st.date!, m = st.slot!;
    /* the error: in sight, the focus on its title (never on <body>), and no toast over it */
    const done1 = (fail: "offline" | "error") => {
      st.busy = false; st.fail = fail; render(); SC.ov.querySelector(".toast")?.classList.remove("on");
      scrollToEl(main.querySelector(".alert.bad")); main.querySelector<HTMLElement>("[data-failh]")?.focus({ preventScroll: true });
    };
    if (SC.preview && (st.proto.offline || st.proto.fail)) { await new Promise((r) => setTimeout(r, 700)); done1(st.proto.offline ? "offline" : "error"); return; }
    if (navigator.onLine === false) { done1("offline"); return; }
    const old = st.changing;
    try {
      /* a change: the core cancels the old booking in the same step, so its table is not counted as taken */
      const r = await api.reservations.create({
        date: ymd(d), time: hm(m), people: st.n, table: s.joined ? null : s.t!.id, name: f.name.trim(), phone: f.phone,
        email: f.email.trim() || undefined, occasion: f.occ || undefined, note: [s.joined ? "Съединени маси, " + zoneName(s.zone) : "", f.note.trim()].filter(Boolean).join(". ") || undefined, marketing: f.consent === true,
        replaces: old && old.id ? { id: old.id, key: old.key || "" } : undefined,
      });
      st.busy = false;
      st.booking = { id: r.id, key: r.key, table: s.joined ? null : s.t!.id, dur: r.dur, date: d, slot: m, n: st.n, selLabel: s.label + " · " + zoneName(s.zone), name: f.name.trim(), phone: fmtPhone(f.phone), occ: f.occ, note: f.note.trim(), changed: !!old };
      saveLast(st.booking);
      st.view = "done"; st.changing = null; st.sel = null; st.anim = true;
      try { history.replaceState(null, "", location.pathname + location.search); } catch { /* ignore */ }
      render(); toTop(true);
    } catch (e) {
      st.busy = false;
      if (e instanceof ApiError) {
        if (e.code === "blocked") { st.blocked = true; render(); const bc = main.querySelector("[data-blocked]"); scrollToEl(bc); bc?.querySelector<HTMLElement>("[data-h]")?.focus({ preventScroll: true }); return; }
        if (e.code === "taken") { /* someone else was faster: back to the plan with fresh data */
          st.released = (s.label) + " току-що беше заета от друг гост. Изберете друга маса."; st.sel = null; st.hold = 0; st.step = 2; st.anim = true;
          taken.delete(key(d, m)); takenErr = false; loadTaken(d, [m], true).then(() => render()); render(); toTop(true); return;
        }
        if (e.code === "invalid" && e.fields && (e.fields.date || e.fields.time || e.fields.people || e.fields.table)) {
          /* the day, hour or party size no longer works (the core checks them too): back to step 1, the message under the question */
          const fe: Record<string, string> = {};
          if (e.fields.date) fe.date = e.fields.date;
          if (e.fields.time) fe.slot = e.fields.time;
          if (e.fields.people || e.fields.table) fe.people = e.fields.people || e.fields.table;
          releaseIfNeeded(); st.released = null; st.step = 1; st.anim = true; st.err = fe; render();
          const first = main.querySelector<HTMLElement>(".qerr"); if (first) { scrollToEl(first.closest(".q")); }
          return;
        }
        if (e.code === "invalid" && e.fields) {
          const map: Record<string, string> = { name: "name", phone: "phone", email: "email" };
          const fe: Record<string, string> = {};
          Object.keys(e.fields).forEach((k) => { if (map[k]) fe[map[k]] = e.fields![k]; });
          if (Object.keys(fe).length) { st.err = fe; render(); const first = main.querySelector<HTMLElement>('[aria-invalid="true"]'); if (first) { scrollToEl(first); first.focus({ preventScroll: true }); } return; }
        }
        if (e.code === "too_late" || e.code === "throttled") { st.failText = e.message; st.failCall = e.code === "throttled"; done1("error"); return; }
        done1(e.code === "offline" ? "offline" : "error"); return;
      }
      done1("error");
    }
  }
  function rehold(): void { st.hold = Date.now() + 600000; st.expired = false; SC.toast(selInfo()!.label + " е задържана пак за 10 минути"); render(); }
  function back(): void { if (st.step > 1) go(st.step - 1); }

  /* a complete, valid selection for the preview shortcuts */
  async function ready(withData: boolean): Promise<void> {
    if (!st.date || !bookable(st.date)) setDate(bookable(TODAY) ? TODAY : addDays(TODAY, 1));
    await loadTaken(st.date!, openSlots(st.date!));
    if (st.slot == null || slotFull(st.date!, st.slot, st.n)) { const o = openSlots(st.date!).filter((m) => !slotFull(st.date!, m, st.n)); st.slot = o.filter((m) => m >= 1140)[0] ?? o[0]; st.period = periodOf(st.slot).id; }
    if (!st.sel) { const t = freeTables("salon", st.date!, st.slot!, st.n)[0] || freeTables("garden", st.date!, st.slot!, st.n)[0]; if (t) { st.sel = t.id; st.zone = t.zone; st.hold = Date.now() + 600000; st.expired = false; } }
    if (withData) { if (!st.f.name) st.f.name = "Примерен гост"; if (!st.f.phone) st.f.phone = "0888 12 34 56"; }
  }

  /* ---------- sheets ---------- */
  let cur: { close: () => void } | null = null;
  function tableSheet(t: Table): void {
    cur = SC.sheet({
      title: "Маса " + t.n, html: '<div class="ts"><div class="ts-top"><span class="tno on" aria-hidden="true">' + t.n + "</span><div><b>" + t.seats + " места · " + zoneName(t.zone) + "</b><p>Свободна в " + hm(st.slot!) + ", " + fShort(st.date!) + "</p></div></div>" +
        '<ul class="feats">' + feats(t).map((f) => "<li>" + ic(f.i, 22) + f.n + "</li>").join("") + "</ul>" +
        '<div class="phs">' + ic("image", 24) + '<span class="missing small">[ЛИПСВА: снимка на мястото от новата фотосесия]</span></div>' +
        '<button class="pill pill-red pill-lg pill-block" type="button" data-pick="' + t.id + '">' + ic("check", 22) + 'Избери тази маса</button><p class="muted small center" style="margin:0">Задържаме я за вас 10 минути, докато попълните данните.</p></div>',
    });
  }
  /** the 4 free hours closest to m (a tie goes to the earlier hour), from the whole day's occupancy */
  const nearSlots = (d: Date, m: number) => openSlots(d).filter((x) => x !== m && known(d, x) && !slotFull(d, x, st.n))
    .sort((a, b) => Math.abs(a - m) - Math.abs(b - m) || a - b).slice(0, 4).sort((a, b) => a - b);
  const nearHtml = (list: number[]) => (list.length ? '<p class="label" style="margin-top:4px">Или изберете свободен час:</p><div class="chips">' + list.map((x) => '<button class="chip" type="button" data-wlslot="' + x + '">' + hm(x) + "</button>").join("") + "</div>" : "");
  function waitSheet(m: number): void {
    const d = st.date!, all = openSlots(d);
    const whole = all.every((x) => known(d, x));
    const html = '<div class="wl" data-wl><p>В ' + hm(m) + " на " + fShort(d) + " няма свободна маса за " + ppl(st.n) + ". Запишете се и ще ви пишем по SMS или Viber, ако се освободи.</p>" +
      '<div class="field"><label for="wl-name">Име</label><input class="input" id="wl-name" autocomplete="name" value="' + esc(st.f.name) + '"><span class="err" data-wlnerr hidden></span></div>' +
      '<div class="field"><label for="wl-phone">Телефон</label><input class="input" id="wl-phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0888 12 34 56" value="' + esc(st.f.phone) + '"><span class="err" data-wlerr hidden></span></div>' +
      '<button class="pill pill-red pill-lg pill-block" type="button" data-wlgo="' + m + '">' + ic("bell", 22) + "Запиши ме в списъка на чакащите</button>" +
      '<div data-wlnear>' + (whole ? nearHtml(nearSlots(d, m)) : "") + "</div></div>";
    cur = SC.sheet({ title: "Пълно в " + hm(m), html });
    /* the closest free hours need the whole day (only the visible part of the day is loaded) */
    if (!whole) loadTaken(d, all).then(() => {
      const box = document.querySelector<HTMLElement>("[data-wl] [data-wlnear]"); if (!box) return;
      box.innerHTML = nearHtml(nearSlots(d, m));
    });
  }
  async function joinWaitlist(btn: HTMLElement, m: number): Promise<void> {
    const box = btn.closest<HTMLElement>("[data-wl]")!;
    const nIn = box.querySelector<HTMLInputElement>("#wl-name")!, pIn = box.querySelector<HTMLInputElement>("#wl-phone")!;
    const nErr = box.querySelector<HTMLElement>("[data-wlnerr]")!, pErr = box.querySelector<HTMLElement>("[data-wlerr]")!;
    const nm = nIn.value.trim(), ph = pIn.value.trim();
    nErr.hidden = !!nm; nErr.textContent = nm ? "" : "Напишете името си, за да знаем кого търсим."; nm ? nIn.removeAttribute("aria-invalid") : nIn.setAttribute("aria-invalid", "true");
    const phOk = !!normPhone(ph);
    pErr.hidden = phOk; pErr.textContent = phOk ? "" : ph ? "Проверете номера. Например: 0888 12 34 56" : "Напишете телефон, за да ви пишем, щом се освободи маса.";
    phOk ? pIn.removeAttribute("aria-invalid") : pIn.setAttribute("aria-invalid", "true");
    if (!nm) { nIn.focus(); return; }
    if (!phOk) { pIn.focus(); return; }
    st.f.name = nm; st.f.phone = ph;
    btn.setAttribute("aria-busy", "true"); (btn as HTMLButtonElement).disabled = true;
    try {
      await api.reservations.create({ date: ymd(st.date!), time: hm(m), people: st.n, table: null, name: nm, phone: ph, waitlist: true });
      box.innerHTML = '<div class="okm" aria-hidden="true">' + ic("check", 36) + '</div><p class="center" style="font-size:20px;font-weight:800;letter-spacing:-.02em" tabindex="-1" data-wlok>Записахме ви в списъка на чакащите</p><p class="center muted">Ако се освободи маса за ' + ppl(st.n) + " в " + hm(m) + " на " + fShort(st.date!) + ", ще ви пишем на " + esc(fmtPhone(ph)) + ". Не е нужно да правите нищо друго.</p>";
      box.querySelector<HTMLElement>("[data-wlok]")?.focus({ preventScroll: true });
    } catch (e) {
      btn.removeAttribute("aria-busy"); (btn as HTMLButtonElement).disabled = false;
      if (e instanceof ApiError && e.code === "blocked") {
        box.innerHTML = '<div class="alert" role="alert">' + ic("phone", 22) + '<div><b>Ще ви помогнем по телефона</b><p>За този номер не можем да запишем онлайн. Обадете ни се и ще намерим решение.</p><div class="acts">' + callBtn("pill pill-red") + "</div></div></div>";
        return;
      }
      pErr.hidden = false; pErr.textContent = e instanceof ApiError && e.code === "offline" ? "Няма връзка. Проверете интернета и опитайте пак." : e instanceof ApiError && e.code === "throttled" ? e.message : "Не успяхме да ви запишем. Опитайте пак или се обадете на " + R.phone + ".";
    }
  }

  /* ---------- events ---------- */
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-day],[data-mon],[data-period],[data-slot],[data-full],[data-ppl],[data-go],[data-act],[data-zone],[data-t],[data-pick],[data-need],[data-list],[data-rehold],[data-occ],[data-unblock],[data-ics],[data-new],[data-manage],[data-change],[data-cancel],[data-proto],[data-waitlist],[data-wlgo],[data-wlslot],[data-retake]");
    if (!t) return;
    const ds = t.dataset;
    if (ds.day) { setDate(parseYmd(ds.day)!); st.msg = null; delete st.err.date; delete st.err.slot; render(); return; }
    if (ds.mon) {
      st.month = new Date(st.month.getFullYear(), st.month.getMonth() + (+ds.mon), 1); render();
      const f = document.querySelector<HTMLButtonElement>('[data-fk="' + (ds.mon === "1" ? "mn" : "mp") + '"]');
      if (f && f.disabled) { const c = document.getElementById("calm")!; c.setAttribute("tabindex", "-1"); c.focus({ preventScroll: true }); }
      return;
    }
    if (ds.period) { st.period = ds.period; render(); return; }
    if (ds.slot) { const m = +ds.slot; if (st.slot !== m) { releaseIfNeeded(); st.slot = m; } delete st.err.slot; render(); return; }
    if (ds.full) { waitSheet(+ds.full); return; }
    if (ds.waitlist) { waitSheet(+ds.waitlist); return; }
    if (ds.ppl) {
      const n = Math.max(1, Math.min(12, st.n + (+ds.ppl)));
      if (n !== st.n) { releaseIfNeeded(); st.n = n; delete st.err.people; if (st.slot != null && st.date && slotFull(st.date, st.slot, n)) st.slot = null; }
      render(); return;
    }
    if (ds.go) { const g = +ds.go; if (g < st.step) go(g); else if (g === 2 && st.step === 3) go(2); return; }
    if (ds.act) { if (ds.act === "next") next(); else if (ds.act === "back") back(); else if (ds.act === "rehold") rehold(); return; }
    if (ds.zone) { st.zone = ds.zone as Zone; render(); return; }
    if (ds.t) {
      const tb = tById(ds.t), s = tState(tb);
      if (s === "free") tableSheet(tb);
      else if (s === "sel") SC.toast("Маса " + tb.n + " вече е ваша. Задържана за " + holdTxt() + " мин");
      else if (s === "taken") SC.toast("Маса " + tb.n + " е заета в " + hm(st.slot!) + ". Изберете маса с червен контур.");
      else if (!suits(tb, st.n)) SC.toast("Маса " + tb.n + " е за " + tb.seats + ". За " + ppl(st.n) + " изберете маса с " + sizesFor(st.n).join(" или ") + " места.");
      else SC.toast("Маса " + tb.n + " не отговаря на избраното в „Нужно ви е“.");
      return;
    }
    if (ds.pick) { if (cur) { cur.close(); cur = null; } pick(ds.pick); return; }
    if (ds.need) { st.need[ds.need] = !st.need[ds.need]; render(); return; }
    if (t.hasAttribute("data-list")) { st.list = !st.list; render(); return; }
    if (t.hasAttribute("data-retake")) { if (st.date && st.slot != null) { takenErr = false; render(); loadTaken(st.date, [st.slot], true).then(() => render()); } return; }
    if (t.hasAttribute("data-rehold")) { rehold(); return; }
    if (ds.occ) { st.f.occ = st.f.occ === ds.occ ? "" : ds.occ; render(); return; }
    if (t.hasAttribute("data-unblock")) { st.blocked = false; st.f.phone = ""; st.err = {}; render(); const pi = document.getElementById("f-phone"); if (pi) { scrollToEl(pi); pi.focus({ preventScroll: true }); } return; }
    if (t.hasAttribute("data-ics")) { icsFile(st.booking!); SC.toast("Файлът за календара е изтеглен"); return; }
    if (t.hasAttribute("data-new")) { if (/^#(r-|manage)/.test(location.hash)) { try { history.replaceState(null, "", location.pathname + location.search); } catch { /* ignore */ } } st.view = "flow"; st.step = 1; st.sel = null; st.slot = null; st.booking = null; st.blocked = false; st.f.occ = ""; st.f.note = ""; st.released = null; st.msg = null; st.anim = true; if (!st.date || !bookable(st.date)) { st.date = null; setDate(bookable(TODAY) ? TODAY : addDays(TODAY, 1), true); } pickDefaultPeriod(); render(); toTop(true); return; }
    if (ds.manage) { openManage(false); render(); toTop(true); return; }
    if (t.hasAttribute("data-change")) {
      const b = st.manage!.b; st.view = "flow"; st.step = 1; st.changing = b; st.n = b.n; st.slot = null; st.sel = null; st.date = null;
      setDate(bookable(b.date) ? b.date : addDays(TODAY, 1)); if (slotOpen(st.date!, b.slot)) st.slot = b.slot; pickDefaultPeriod();
      if (b.name) st.f.name = b.name; if (b.phone) st.f.phone = b.phone;
      st.msg = null; st.anim = true; render(); toTop(true); SC.toast("Изберете новия ден, час или маса"); return;
    }
    if (ds.cancel) {
      const M = st.manage!;
      if (ds.cancel === "ask") { st.confirmCancel = true; M.err = undefined; render(); main.querySelector<HTMLElement>("#cfh")?.focus({ preventScroll: true }); return; }
      if (ds.cancel === "no") { st.confirmCancel = false; render(); toTop(true); return; }
      if (!M.b.id) { if (SC.preview) { M.cancelled = true; render(); toTop(true); } return; } /* preview sample: no record */
      M.busy = true; render();
      api.reservations.cancel(M.b.id, M.b.key).then(() => { M.busy = false; M.cancelled = true; st.booking = null; SC.store("sc-res-last", null); render(); toTop(true); })
        .catch((er) => { M.busy = false; M.err = er instanceof ApiError && er.code !== "offline" && er.code !== "error" ? er.message : "Не успяхме да откажем резервацията. Проверете интернета и опитайте пак или се обадете на " + R.phone + "."; render(); });
      return;
    }
    if (ds.wlslot) { if (cur) { cur.close(); cur = null; } releaseIfNeeded(); st.slot = +ds.wlslot; st.period = periodOf(st.slot).id; render(); SC.toast("Избрахте " + hm(st.slot)); return; }
    if (ds.wlgo) { joinWaitlist(t, +ds.wlgo); return; }
    if (ds.proto && SC.preview) { runProto(ds.proto); return; }
  });
  async function runProto(k: string): Promise<void> {
    st.protoOpen = true;
    if (k === "offline") { st.proto.offline = !st.proto.offline; render(); SC.toast(st.proto.offline ? "Симулация: няма интернет" : "Връзката е възстановена"); return; }
    if (k === "fail") { st.proto.fail = !st.proto.fail; render(); SC.toast(st.proto.fail ? "Следващото запазване ще даде грешка" : "Запазването работи нормално"); return; }
    if (k === "event") {
      st.proto.eventFull = !st.proto.eventFull; st.view = "flow"; st.step = 1; releaseIfNeeded();
      let ls = lastSat(TODAY.getFullYear(), TODAY.getMonth()); if (ls < TODAY || !bookable(ls)) ls = lastSat(TODAY.getFullYear(), TODAY.getMonth() + 1);
      st.date = null; setDate(ls); st.slot = null; st.period = "eve"; st.n = 4; st.released = null; st.anim = true; render(); toTop();
      SC.toast(st.proto.eventFull ? "Симулация: вечерта е пълна 19:00 - 20:30" : "Вечерта отново има свободни маси"); return;
    }
    if (k === "group") { st.view = "flow"; releaseIfNeeded(); st.released = null; st.n = 8; st.step = 1; await ready(false); st.sel = null; st.hold = 0; go(2); return; }
    if (k === "expire") { st.view = "flow"; await ready(false); if (st.step < 2) st.step = 2; st.hold = Date.now() + 5000; st.expired = false; st.anim = true; render(); toTop(); SC.toast("Задържането ще изтече след 5 секунди"); return; }
    if (k === "blocked") { st.view = "flow"; await ready(true); st.f.phone = "0888 00 00 00"; st.blocked = false; st.err = {}; st.step = 3; st.anim = true; render(); toTop(); SC.toast("Натиснете „Резервирай“, за да видите съобщението"); return; }
    if (k === "manage" || k === "late") { openManage(k === "late"); if (k === "manage" && st.view !== "manage") { const b0: Booking = { date: addDays(TODAY, 1), slot: 1170, n: 4, selLabel: "Маса 5 · Салон", phone: "0888 12 34 56" }; st.manage = { b: b0, late: false, cancelled: false }; st.view = "manage"; } render(); toTop(); return; }
  }
  document.addEventListener("keydown", (e) => {
    const t = (e.target as HTMLElement).closest && (e.target as HTMLElement).closest("[data-t]");
    if (t && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); t.dispatchEvent(new MouseEvent("click", { bubbles: true })); }
  });
  document.addEventListener("input", (e) => {
    const el = e.target as HTMLInputElement, k = el.dataset && (el.dataset.f as keyof Draft | undefined);
    if (!k || k === "consent") return;
    (st.f as unknown as Record<string, string>)[k] = el.value;
    if (st.err[k]) { const test = validate(); if (!test[k]) { delete st.err[k]; el.parentNode?.querySelector(".err")?.remove(); el.removeAttribute("aria-invalid"); } }
  });
  document.addEventListener("change", (e) => { const el = e.target as HTMLInputElement; if (el.hasAttribute && el.hasAttribute("data-consent")) st.f.consent = el.checked; });
  document.addEventListener("submit", (e) => { if ((e.target as HTMLElement).closest("[data-form]")) { e.preventDefault(); next(); } });
  document.addEventListener("toggle", (e) => { const el = e.target as HTMLDetailsElement; if (el.matches && el.matches("[data-protod]")) st.protoOpen = el.open; }, true);
  window.addEventListener("offline", () => SC.toast("Няма връзка. Данните ви са запазени тук."));
  /* a new #date / #r-... on an open page: draw it, and a wrong or past date shows its message on step 1 */
  window.addEventListener("hashchange", () => {
    st.msg = null;
    if (fromHash()) { st.anim = true; render(); toTop(); return; }
    if (st.msg) { if (st.view !== "flow") { st.view = "flow"; } st.step = 1; st.anim = true; render(); toTop(); }
  });
  /* the hour passes: today's slots close (step 1 only, so nothing typed is lost) */
  document.addEventListener("sc:tick", () => { if (st.view === "flow" && st.step === 1 && st.date && same(st.date, TODAY)) { if (!bookable(TODAY)) { st.date = null; setDate(addDays(TODAY, 1), true); } else if (st.slot != null && !slotOpen(st.date, st.slot)) st.slot = null; render(); } });
  /* a booking made in another tab or by the staff frees / takes a table: refresh what is shown */
  api.on("reservation.created", (d) => { const x = d as { date?: string; time?: string }; if (x && x.date && x.time) { const k = x.date + "|" + x.time; if (taken.has(k)) { taken.delete(k); if (st.view === "flow" && st.step < 3) render(); } } });

  /* ---------- start ---------- */
  if (!fromHash() && st.view === "flow") setDate(bookable(TODAY) ? TODAY : addDays(TODAY, 1), true);
  render();
  SC.reveal();
}
