/* Шофьор: what every screen after the sign-in shares (port of design/pages-shofyor/_driver.js without the sample data
   and the panel "Само в прототипа"). Built on the phone frame (src/modules/staff/frame.ts, module "driver"):
   - mountDriver(opts): the frame + the open shift (no shift -> /shofyor/vhod/), the line "Шофьор 1 · Автомобил 1",
     "Търси" (only his deliveries, /api/driver/search), the sheet "Смяна" (car · смени, since, start km, "Приключи
     смяната"), the badge of "Доставки", real time (driver.course, driver.ask, order.status, order.new: one onChange),
     the steps kept on the phone with no connection ("queue": the strip "2 статуса чакат и тръгват сами", "Виж") and
     sent in their order when it is back, the car sheet, the screen "Колата е в движение" (GPS speed in this browser
     only, never sent: decision 17.11.2026, no position is collected in v1);
   - the small pieces of the screens: the status chips, the deadline, the money, the address, the navigation link. */
import "sc-icons:storefront,shopping-bag,car,check-circle,warning,door-open,map-pin-line,map-pin,x,money,credit-card,ticket,path,phone,caret-right,caret-left,caret-up,caret-down,timer,clock,info,tag,note,lock,image,check,sign-in,sign-out,eye,moped,wallet,chat-circle-dots,sparkle,arrow-clockwise,magnifying-glass,gas-pump,arrow-counter-clockwise,user";
import { mountStaff, type Staff, type Sheet, type ShiftInfo, type SearchProvider } from "../staff/frame.ts";
import { driverApi, ApiError, type Delivery, type DriverState, type CarView } from "../../client/api-driver.ts";
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural } from "../../lib/format.ts";
import { RESTAURANT } from "../../lib/consts.ts";
import { murl } from "../routes.ts";
import { makeOutbox, flushOutbox, stepWord, stepNos, isStatus, applyLocal, type DAction, type DQueued } from "./outbox.ts";

export { ic, esc, fmt, plural, murl, driverApi, ApiError };
export type { Delivery, DAction, DQueued, Staff, Sheet };

/* ---------- words ---------- */
export const ST_ICON: Record<string, string> = { wait: "storefront", picked: "shopping-bag", road: "car", done: "check-circle", prob: "warning", cancelled: "x" };
export const PAY: Record<string, [string, string]> = { cash: ["В брой", "money"], card: ["Карта при получаване", "credit-card"], voucher: ["Ваучер", "ticket"] };
export const NAVAPP: Record<string, string> = { google: "Google Maps", waze: "Waze" };
export const RT = RESTAURANT.phone, RT_TEL = "tel:" + RESTAURANT.phone.replace(/\s/g, "");
/** "48 250" */
export const kmText = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, " ");
export const MISS = (t: string) => '<span class="missing">' + esc(t) + "</span>";
const pad2 = (n: number) => String(n).padStart(2, "0");
/** "19:42" in Sofia */
export function clock(ms: number): string {
  try { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)).split(":"); return pad2(+p[0] % 24) + ":" + p[1]; }
  catch { const d = new Date(ms); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); }
}
const msOf = (i: string | null | undefined) => { const t = i ? Date.parse(i) : NaN; return isNaN(t) ? null : t; };
export const at = (i: string | null | undefined) => { const t = msOf(i); return t == null ? "" : clock(t); };
export const stt = (k: string, word: string, icon: string) => '<span class="stt ' + esc(k) + '">' + ic(icon, 18) + "<span>" + esc(word) + "</span></span>";

/* ---------- a delivery on the screen ---------- */
/** the address as the prototype shows it: bold "Дружба 2, бл. 311, вх. Б" and under it "ет. 4, ап. 12" ("ж.к." does not
    repeat the quarter; the zone is added when the address does not say it) */
export function addrParts(d: Delivery): { main: string; sub: string } {
  const a = (d.addr || "").trim().replace(/^(?:ж\.?\s?к\.?|кв\.|с\.)\s*/i, ""), z = (d.zone || "").trim();
  const m = /,\s*(?=(?:ет\.|етаж|ап\.|апартамент))/i.exec(a);
  let main = m ? a.slice(0, m.index) : a;
  const sub = m ? a.slice(m.index).replace(/^,\s*/, "") : "";
  if (z && !d.outzone && !main.toLowerCase().includes(z.toLowerCase())) main = z + ", " + main;
  /* "вх. Б", "бл. 311", "ет. 4", "№ 12" never break apart */
  const keep = (t: string) => t.replace(/(^|[\s,])(вх\.|бл\.|ет\.|ап\.|№)\s+/g, "$1$2\u00a0");
  return { main: keep(main), sub: keep(sub) };
}
/** the address in one line (the search, the labels) */
export function addrLine(d: Delivery): string { const p = addrParts(d); return p.main + (p.sub ? ", " + p.sub : ""); }
export const zoneName = (d: Delivery) => (d.outzone || !d.zone ? "Извън зоните" : d.zone);
/** what to take at the door: "24,47 €", "22,37 € + такса", "уточни с ресторанта" */
export function money(d: Delivery): string {
  if (d.outzone) return "уточни с ресторанта";
  return fmt(d.total) + (d.feeKnown ? "" : " + такса");
}
export const payWord = (d: Delivery) => '<span class="payw">' + ic(PAY[d.pay][1], 18) + esc(PAY[d.pay][0]) + "</span>";
/** the open problem (not solved) */
export const openProb = (d: Delivery) => d.st === "prob" && !!d.problem && !d.problem.solved;
export const live = (d: Delivery) => d.st === "wait" || d.st === "picked" || d.st === "road";
export function dStt(d: Delivery): string {
  if (d.st === "prob") return d.problem && d.problem.solved === "returned" ? stt("prob", "Върната", "storefront") : stt("prob", "Проблем · " + (d.problem ? d.problem.label : ""), "warning");
  if (d.st === "cancelled") return stt("prob", "Отказана", "x");
  return stt(d.st, d.stLabel, ST_ICON[d.st]);
}
/** the deadline: "Срок 22:25", "Остават 3 мин", "Закъснява 13 мин", "Срок 22:28 · ще закъснее ~4 мин" (only when the
    core gives it), "Доставена 21:06" */
export function dueStt(d: Delivery, now = Date.now()): string {
  if (d.st === "done") return stt("done", "Доставена " + at(d.deliveredAt), "check-circle");
  if (d.st === "prob") return d.problem && d.problem.solved === "returned" ? stt("prob", "Върната " + at(d.problem.solvedAt), "storefront") : stt("prob", d.problem ? d.problem.label : "Проблем", "warning");
  if (d.st === "cancelled") return stt("prob", "Отказана", "x");
  if (d.due == null || !d.dueAt) return "";
  const left = Math.round((d.due - now) / 60000);
  if (now > d.due) return stt("late", "Закъснява " + Math.max(1, Math.ceil((now - d.due) / 60000)) + "\u00a0мин", "timer");
  if (left < 5) return stt("soon", "Остават " + Math.max(1, left) + "\u00a0мин", "timer");
  if (d.etaLate > 0) return stt("soon", "Срок " + d.dueAt + " · ще закъснее ~" + d.etaLate + "\u00a0мин", "timer");
  return stt("picked", "Срок " + d.dueAt, "clock");
}
export const isLate = (d: Delivery, now = Date.now()) => live(d) && d.due != null && now > d.due;
export const etaStt = (d: Delivery) => (d.etaAt && live(d) ? stt("picked", "Пристигане около " + d.etaAt, "car") : "");
/** the address in Google Maps or Waze (free links, no key) */
export function navUrl(d: Delivery, app: string): string {
  const a = (d.addr || "").trim(), z = (d.zone || "").trim();
  const q = encodeURIComponent((d.outzone || !z || a.toLowerCase().includes(z.toLowerCase()) ? a : "ж.к. " + z + ", " + a) + ", София");
  return app === "waze" ? "https://waze.com/ul?q=" + q + "&navigate=yes" : "https://www.google.com/maps/dir/?api=1&destination=" + q + "&travelmode=driving";
}
/** what is left to know about an order outside the zones (the manager's answer) */
export function askLine(d: Delivery): string {
  const a = d.ask;
  if (!a) return "";
  if (a.status === "open") return "Чакаш отговор от управителя от " + a.atClock + ".";
  return "Управителят: " + (a.answerLabel || "") + ".";
}
/** may the driver press "Взех" for it: ready, nobody took it, and the address is in a zone or the manager said "Да я достави" */
export const pickable = (d: Delivery) => d.st === "wait" && (!d.outzone || (!!d.ask && d.ask.answer === "deliver"));

/* ---------- the search: only his deliveries of the shift (the server checks it) ---------- */
function frow(d: Delivery): string {
  return '<a class="frow" href="' + esc(murl.shofyor("dostavka", d.no)) + '"><span class="fi">' + ic(ST_ICON[d.st] || "moped", 22) + "</span><span><b>№ " + esc(d.no) + " · " + esc(zoneName(d)) + "</b><small>" + esc(d.addr) + "</small></span>" +
    '<span class="fr"><span class="price">' + esc(money(d)) + "</span><small>" + esc(d.st === "prob" && d.problem ? d.problem.label : d.stLabel) + "</small></span></a>";
}
function searchProvider(examples: () => string[]): SearchProvider {
  return {
    label: "Търси доставка по номер или адрес", placeholder: "№ или адрес…", wait: 180,
    start: () => {
      const ex = examples().slice(0, 3).map((n) => [n, "№ " + n]).concat([["Дружба", "Дружба"], ["доставени", "Доставени днес"]]);
      return '<p class="fscope">Търсиш само в своите доставки за смяната: номер, адрес, квартал.</p><div class="fchips">' + ex.map((e) => '<button class="chip" type="button" data-ex="' + esc(e[0]) + '">' + esc(e[1]) + "</button>").join("") + "</div>";
    },
    results: async (q) => {
      const r = await driverApi.search(q);
      let h = "";
      if (r.act.length) h += '<section class="fgrp"><h3>За доставяне<span class="muted">' + r.act.length + "</span></h3>" + r.act.map(frow).join("") + "</section>";
      if (r.done.length) h += '<section class="fgrp"><h3>Доставени днес<span class="muted">' + r.done.length + "</span></h3>" + r.done.map(frow).join("") + "</section>";
      return h || '<div class="fempty"><div class="ill">' + ic("magnifying-glass", 40) + "</div><h3>Няма „" + esc(q) + "“</h3><p>Търсиш само в своите доставки за смяната: номер (1042), адрес (бл. 311) или квартал (Дружба 1).</p></div>";
    },
  };
}

/** a selector that finds the same control after the screen is drawn again */
function focusKey(el: HTMLElement): string | null {
  if (el.id) return "#" + CSS.escape(el.id);
  for (const at of Array.from(el.attributes)) if (at.name.startsWith("data-") && at.name !== "data-offnav") return at.value ? "[" + at.name + '="' + CSS.escape(at.value) + '"]' : "[" + at.name + "]";
  const h = el.getAttribute("href");
  return h ? 'a[href="' + CSS.escape(h) + '"]' : null;
}
/* ---------- the frame of a screen ---------- */
export interface DriverOpts { screen: string; tab: "list" | "route" | "fuel" | "shift" | null; title: string; back?: { href: string; label: string }; bar?: boolean; homeFind?: boolean }
export interface Drv {
  st: Staff; state: DriverState;
  /** a step: sent now, or kept on the phone with no connection (queued) */
  act(a: DAction): Promise<{ res?: unknown; queued?: DQueued }>;
  /** "Отмени" of a kept step (it never left the phone) */
  unqueue(q: DQueued): void;
  /** the kept steps (the screen draws the deliveries as they leave them) */
  queued(): DQueued[];
  /** the deliveries as the kept steps leave them */
  local<T extends Delivery>(list: T[]): T[];
  /** something changed (real time, the connection is back and the kept steps went, the navigation app) */
  onChange(fn: () => void): void;
  /** draw the screen again keeping the focus on the same control (or, when it is gone, on the main button of the bar) */
  paint(draw: () => void): void;
  /** after a step: the focus on the new main button of the bar when the old one is gone (never <body>) */
  focusBar(): void;
  /** the number on "Доставки" */
  badge(n: number): void;
  /** the toast after a step: "Записано на телефона: …" with no connection; "Отмени" through the core (or the queue) */
  stepToast(text: string, r: { res?: unknown; queued?: DQueued }, after?: () => void): void;
  /** an error of a step: the core's words */
  oops(e: unknown): void;
  carSheet(onDone?: () => void): Promise<void>;
  /** the data of a screen; with no connection the last copy kept on the phone */
  cached<T>(key: string, fn: () => Promise<T>): Promise<T>;
  navApp(): string;
  /** the numbers for the examples of the search */
  setExamples(nos: string[]): void;
}
/** a fuel entry kept on the phone and refused by the core when it was sent: "Гориво" shows it again with the errors */
export const FUEL_DRAFT = "dr-fuel-draft:";
export const LS = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string | null) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* blocked */ } } };
const isOff = (e: unknown) => e instanceof ApiError && e.code === "offline";

export async function mountDriver(o: DriverOpts): Promise<Drv | null> {
  let examples: string[] = [];
  /* the steps and the copies on the phone are per person: another driver on the same phone never sends them */
  let user = "";
  const boxKey = () => "dr-outbox:" + user;
  const box = makeOutbox({ get: () => LS.get(boxKey()), set: (v) => LS.set(boxKey(), v) });
  let state: DriverState | null = null;
  let carSheetRef: ((onDone?: () => void) => Promise<void>) | null = null;
  let startMoving: () => void = () => { /* set after the mount */ };
  const st0 = await mountStaff({
    module: "driver", screen: o.screen, tab: o.tab, title: o.title, back: o.back, bar: o.bar,
    homeFind: o.homeFind ? { text: "Търси № или адрес…", label: "Търси № или адрес в моите доставки" } : undefined,
    search: searchProvider(() => examples), offline: "queue",
    netText: () => netText(box.list()), queue: () => queueSheet(),
    shift: async () => shiftInfo(await driverApi.state().catch(() => state!)),
  });
  if (!st0) return null;
  const st = st0;
  user = st.me ? st.me.user.username : "";
  /* the frame's sheet (not SC.sheet of the site: tests/unit/runtime.test.ts looks for ".sheet(" calls) */
  const openSheet = (o: Parameters<Staff["sheet"]>[0]) => { st.ov.querySelector(".st-toast")?.classList.remove("on"); return st.sheet(o); };
  try { state = await cachedCall("state", () => driverApi.state()); }
  catch (e) { st.fail(e); return null; }
  if (!state.shift) { location.replace(murl.shofyor("vhod")); return null; }
  st.setTop({ sub: state.user.name + " · " + state.shift.car.n });

  /* ----- the shift sheet ----- */
  function shiftInfo(s: DriverState): ShiftInfo {
    if (s && s !== state) { state = s; }
    const sh = s.shift!;
    return {
      rows: [
        { label: "Автомобил", html: '<button class="link" type="button" data-carsheet>' + esc(sh.car.n) + " · смени</button>" },
        { label: "На смяна от", value: sh.sinceAt, tnum: true },
        { label: "Начален километраж", value: kmText(sh.kmStart) + " км", tnum: true },
        { label: "Местоположение", html: geoHTML(), note: "За „Колата е в движение“. " + GEO_NOTE },
      ],
      foot: '<a class="pill pill-line pill-lg pill-block" href="' + esc(murl.shofyor("smyana")) + '">' + ic("sign-out", 22) + "Приключи смяната</a>",
      bind: (sheet: Sheet) => {
        const b = sheet.el.querySelector<HTMLElement>("[data-carsheet]"); if (b) b.onclick = () => { sheet.close(); void carSheetRef!(() => location.reload()); };
        bindGeo(sheet.el, () => { const g = sheet.el.querySelector<HTMLElement>("[data-geobox]"); if (g) g.outerHTML = geoHTML(); bindGeo(sheet.el, () => {}); if (geoOn()) startMoving(); });
      },
    };
  }

  /* ----- the queue of steps kept on the phone ----- */
  function netText(l: DQueued[]): string {
    if (!l.length) return "Записите се пазят тук.";
    const go = l.length === 1 ? " и тръгва сам." : " и тръгват сами.";
    return (l.every((q) => isStatus(q.a)) ? plural(l.length, "статус чака", "статуса чакат") : plural(l.length, "запис чака", "записа чакат")) + go;
  }
  function queueSheet() {
    const l = box.list();
    openSheet({
      title: "Чакат връзка",
      html: (l.length ? '<p class="muted" style="margin:0 0 6px">Записани са на телефона и тръгват сами към ресторанта, щом има връзка. Не ги натискай пак.</p><div class="hist">' +
        l.map((q) => { const n = stepNos(q.a); return '<div class="h"><b>' + (n.length ? esc(n.map((x) => "№ " + x).join(", ")) + " · " : "") + esc(stepWord(q.a)) + '</b><span class="tnum">' + clock(q.at) + "</span></div>"; }).join("") + "</div>"
        : '<p class="muted" style="margin:0">Нищо не чака. Всичко е изпратено.</p>') +
        '<div class="notice" style="margin-top:12px">' + ic("phone", 22) + '<span>Ако е спешно (отказ, грешен адрес), обади се в ресторанта: <a class="link" href="' + RT_TEL + '" style="min-height:0;display:inline">' + RT + "</a>.</span></div>",
      foot: '<button class="pill pill-red pill-lg pill-block" type="button" data-act="retry">' + ic("arrow-clockwise", 22) + "Опитай пак сега</button>",
    });
  }
  /** a step; a kept one goes with the moment it was made on the phone (the core checks it and keeps its times) */
  async function run(q: DQueued): Promise<unknown> {
    const a = q.a, o = q.id ? { at: q.at } : {};
    switch (a.k) {
      case "take": return driverApi.take(a.nos, o);
      case "go": return driverApi.go(a.nos, o);
      case "arrive": return driverApi.arrive(a.no, o);
      case "deliver": return driverApi.deliver(a.no, { ...o, ...(a.sum != null ? { sum: a.sum } : {}) });
      case "problem": return driverApi.problem(a.no, a.kind, a.note, o);
      case "returned": return driverApi.returned(a.no, o);
      case "fuel": return driverApi.fuelAdd({ ...a.input, ...o });
    }
  }
  const subs = new Set<() => void>();
  let changeT: ReturnType<typeof setTimeout> | undefined;
  const changed = (ms = 0) => { clearTimeout(changeT); changeT = setTimeout(() => subs.forEach((f) => f()), ms); };
  let flushing: Promise<void> | null = null;
  function flush(): Promise<void> {
    if (flushing) return flushing;
    if (!box.size()) return Promise.resolve();
    flushing = (async () => {
      const words: string[] = [];
      const r = await flushOutbox(box, run, isOff, (q, e) => {
        const er = e instanceof ApiError ? e : null;
        if (q.a.k === "fuel") {
          LS.set(FUEL_DRAFT + user, JSON.stringify({ at: q.at, input: q.a.input, fields: (er && er.fields) || {} }));
          const f = er && er.fields ? Object.values(er.fields)[0] : er ? er.message : "";
          words.push("Зареждането от " + clock(q.at) + " не се записа: " + (f || "провери го в „Гориво“.") + (/[.!]$/.test(f || "") ? "" : ".") + " Поправи го в „Гориво“.");
        } else words.push(er && er.message ? er.message : "Записът не мина.");
      });
      st.netRefresh();
      if (r.sent || words.length) st.toast(words.length ? words.join(" ") : "Записаното на телефона е изпратено: " + plural(r.sent, "запис", "записа") + ".", words.length ? { ms: 8000 } : {});
    })().finally(() => { flushing = null; });
    return flushing;
  }
  st.onReload(() => { void flush().then(() => changed()); });
  st.onNet((off) => { if (!off) void flush().then(() => changed()); });
  if (box.size() && !st.offline) await flush().catch(() => { /* stays on the phone */ });

  /* ----- real time: one redraw for a burst of events ----- */
  st.onLive(["driver.course", "driver.ask", "order.status", "order.new"], (d, type) => {
    const x = (d || {}) as { status?: string; mode?: string };
    if (type === "order.new" && x.mode && x.mode !== "delivery") return;
    if (type === "order.status" && (x.status === "accepted" || x.status === "cooking" || x.status === "picked_up")) return;
    if (type === "order.status" && x.status === "ready") st.haptic([20, 40, 20]);
    changed(250);
  });
  st.onPrefs(() => { changed(); if (state && state.shift && state.shift.nav !== st.navApp()) driverApi.prefs({ nav: st.navApp() as "google" | "waze" }).catch(() => { /* the phone remembers it */ }); });
  /* the minutes left move once a minute */
  setInterval(() => { if (!document.hidden && !(document.activeElement instanceof HTMLInputElement)) changed(); }, 60_000);

  /* ----- the car sheet: "С коя кола караш?" (Гориво, Смяна, Край на смяната) ----- */
  async function carSheet(onDone?: () => void): Promise<void> {
    let s0: DriverState;
    try { s0 = await driverApi.state(); } catch (e) { oops(e); return; }
    const cur = s0.shift!.car.id, curN = s0.shift!.car.n, lastKm = s0.shift!.lastKm;
    let pick = cur, errs: Record<string, string> = {}, vEnd = "", vStart = "";
    const car = (id: string) => s0.cars.find((c) => c.id === id) as CarView;
    const plate = (c: CarView) => (c.plate ? "рег. № " + esc(c.plate) : "рег. № " + MISS("[ЛИПСВА]"));
    const err = (k: string) => (errs[k] ? '<span class="err" id="e-' + k + '">' + esc(errs[k]) + "</span>" : "");
    const inv = (k: string) => (errs[k] ? ' aria-invalid="true" aria-describedby="e-' + k + '"' : "");
    function body(): string {
      const p = car(pick);
      return '<div class="cars" role="group" aria-label="Автомобил">' + s0.cars.map((c) => '<button class="car" type="button" data-c="' + esc(c.id) + '" aria-pressed="' + (pick === c.id) + '"' + (c.busyBy && c.id !== cur ? " disabled" : "") + '><span class="ii">' + ic("car", 24) + "</span><span><b>" + esc(c.n) + "</b><span>" +
        (c.id === cur ? "Караш я сега · " : c.busyBy ? "В смяната на " + esc(c.busyBy) + " · " : "") + plate(c) + "</span></span></button>").join("") + "</div>" + err("car") +
        (pick !== cur ? '<p class="muted" style="margin:14px 0 8px">Смяната продължава. Записваме края на ' + esc(curN) + " и началото на " + esc(p.n) + '.</p><div class="fgrid">' +
          '<div class="field bigf"><label for="cke">Краен км на ' + esc(curN) + '</label><div class="wrapi"><input class="input" id="cke" inputmode="numeric" autocomplete="off" placeholder="0" value="' + esc(vEnd) + '"' + inv("kmEnd") + '><span class="u">км</span></div>' + (err("kmEnd") || '<span class="help">Последно записан: ' + kmText(lastKm) + " км.</span>") + "</div>" +
          '<div class="field bigf"><label for="cks">Начален км на ' + esc(p.n) + '</label><div class="wrapi"><input class="input" id="cks" inputmode="numeric" autocomplete="off" placeholder="0" value="' + esc(vStart) + '"' + inv("kmStart") + '><span class="u">км</span></div>' + (err("kmStart") || (p.lastKm != null ? '<span class="help">Последно записан: ' + kmText(p.lastKm) + " км.</span>" : "")) + "</div></div>" : "");
    }
    const s = openSheet({ title: "С коя кола караш?", html: '<div id="carb">' + body() + "</div>", foot: '<button class="pill pill-red pill-lg pill-block" type="button" data-csave>Готово</button>' });
    const b = s.el.querySelector<HTMLElement>("#carb")!;
    const keep = () => { vEnd = s.el.querySelector<HTMLInputElement>("#cke")?.value ?? vEnd; vStart = s.el.querySelector<HTMLInputElement>("#cks")?.value ?? vStart; };
    let busy = false;
    s.el.addEventListener("click", async (e) => {
      const t = (e.target as Element).closest<HTMLButtonElement>("button"); if (!t || busy) return;
      if (t.dataset.c) { keep(); pick = t.dataset.c; errs = {}; b.innerHTML = body(); b.querySelector<HTMLElement>('[data-c="' + pick + '"]')?.focus(); return; }
      if (!t.hasAttribute("data-csave")) return;
      if (pick === cur) { s.close(); return; }
      keep(); busy = true; t.disabled = true;
      try {
        state = await driverApi.changeCar({ car: pick, kmEnd: vEnd, kmStart: vStart });
        s.close(); st.setTop({ sub: state.user.name + " · " + state.shift!.car.n });
        st.toast("Караш " + state.shift!.car.n + ". Километрите се пазят поотделно за всяка кола.");
        if (onDone) onDone();
      } catch (er) {
        if (er instanceof ApiError && er.fields) { errs = er.fields; b.innerHTML = body(); s.el.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }
        else oops(er);
      } finally { busy = false; t.disabled = false; }
    });
  }
  carSheetRef = carSheet;
  document.addEventListener("click", (e) => { if ((e.target as Element).closest?.("[data-carsheet]") && !(e.target as Element).closest(".st-sheetwrap")) void carSheet(() => location.reload()); });

  function oops(e: unknown) {
    if (e instanceof ApiError && e.status === 401) { st.fail(e); return; }
    st.toast(e instanceof ApiError && e.message ? e.message : "Не успяхме. Опитай пак.");
  }
  async function cachedCall<T>(key: string, fn: () => Promise<T>): Promise<T> {
    try { const v = await fn(); LS.set("dr-cache-" + user + "-" + key, JSON.stringify({ at: Date.now(), v })); return v; }
    catch (e) {
      if (!isOff(e)) throw e;
      const c = LS.get("dr-cache-" + user + "-" + key);
      if (!c) throw e;
      try { const x = JSON.parse(c) as { at: number; v: T }; st.synced(x.at); return x.v; } catch { throw e; }
    }
  }

  const drv: Drv = {
    st, get state() { return state!; },
    async act(a) {
      if (st.offline) { const q = box.add(a); st.netRefresh(); changed(); return { queued: q }; }
      try { return { res: await run({ id: "", at: Date.now(), a }) }; }
      catch (e) { if (!isOff(e)) throw e; const q = box.add(a); st.netRefresh(); changed(); return { queued: q }; }
    },
    unqueue(q) { box.remove(q.id); st.netRefresh(); },
    queued: () => box.list(),
    local(list) { const q = box.list(); for (const d of list) for (const x of q) applyLocal(d, x.a, x.at); return list; },
    onChange(fn) { subs.add(fn); },
    badge(n) { st.setBadge("list", n); },
    stepToast(text, r, after) {
      if (r.queued) {
        const q = r.queued, told = /\s*Клиент[^.]*\./.test(text);
        st.toast("Записано на телефона: " + text.replace(/\s*Клиент[^.]*\./g, "") + (told ? " Клиентът ще го види, щом има връзка." : ""), { undo: () => { drv.unqueue(q); changed(); focusBar(); } });
        return;
      }
      const u = (r.res as { undo?: { id: string } } | undefined)?.undo;
      st.toast(text, u ? { ms: Math.max(3000, Math.min(10_000, drv.state.undoMs || 10_000)), undo: async () => {
        try { await driverApi.undo(u.id); st.toast("Отменено."); } catch (e) { oops(e); }
        changed(); if (after) after(); focusBar();
      } } : {});
    },
    paint(draw) {
      const a = document.activeElement as HTMLElement | null, inside = !!a && a !== document.body && (st.main.contains(a) || (!!st.bar && st.bar.contains(a)));
      const key = inside ? focusKey(a!) : null;
      draw();
      if (!inside || (a && a.isConnected && document.activeElement === a)) return;
      /* the same selector, and among several (the address and "Отвори" go to the same delivery) the one with the same words */
      const text = (a!.textContent || "").trim(), all = key ? [...st.main.querySelectorAll<HTMLElement>(key), ...(st.bar ? st.bar.querySelectorAll<HTMLElement>(key) : [])] : [];
      const again = all.find((x) => (x.textContent || "").trim() === text) || all[0] || null;
      if (again && !(again as HTMLButtonElement).disabled) again.focus({ preventScroll: true }); else focusBar();
    },
    focusBar: () => focusBar(),
    oops, carSheet, cached: cachedCall,
    navApp: () => st.navApp(),
    setExamples(nos) { examples = nos; },
  };
  /** the main button of the bar (after a step its button is gone), else the screen */
  function focusBar() {
    requestAnimationFrame(() => {
      const a = document.activeElement;
      if (a && a !== document.body && a.isConnected && !st.ov.querySelector(".st-toast")?.contains(a)) return;
      const b = st.bar && st.bar.querySelector<HTMLElement>("button:not([disabled]), a[href]");
      (b || st.main).focus({ preventScroll: true });
    });
  }
  /* "Изход" with steps still on the phone: they would be lost (the next driver never sends them); the copies go too */
  st.beforeLogout(() => new Promise<boolean>((done) => {
    const clean = () => { try { Object.keys(localStorage).filter((k) => k === boxKey() || k.startsWith("dr-cache-" + user + "-")).forEach((k) => localStorage.removeItem(k)); } catch { /* blocked */ } };
    const n = box.size();
    if (!n) { clean(); done(true); return; }
    let ok = false;
    const sh = openSheet({ title: "Записите не са изпратени",
      html: '<p style="margin:0">' + plural(n, "запис още чака", "записа още чакат") + " връзка. Изходът ги изтрива от телефона и ресторантът няма да ги види.</p>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-no>Остани</button><button class="pill pill-red pill-lg" type="button" data-yes>Изтрий и излез</button>',
      onClose: () => done(ok) });
    sh.foot!.classList.add("two");
    sh.foot!.querySelector<HTMLButtonElement>("[data-no]")!.onclick = () => sh.close();
    sh.foot!.querySelector<HTMLButtonElement>("[data-yes]")!.onclick = () => { ok = true; clean(); sh.close(); };
  }));
  /* the badge of "Доставки" and the examples of the search on the other screens ("Моите доставки" counts what it draws),
     as the steps kept on the phone leave the deliveries */
  if (o.screen !== "list") {
    const badge = () => {
      cachedCall("list", () => driverApi.list()).then((l) => {
        const all = drv.local([...l.active, ...l.waiting].map((d) => ({ ...d }))).filter((d) => d.st === "wait" || d.st === "picked" || d.st === "road");
        drv.badge(all.length); examples = all.map((d) => d.no);
      }).catch(() => { /* stays as it is */ });
    };
    badge(); subs.add(badge);
  }
  startMoving = () => watchMoving(drv);
  if (geoOn()) startMoving();
  return drv;
}

/* ---------- the permission for "Колата е в движение" ----------
   The browser asks for the location only after "Разреши" under the explanation (the sign-in, step 3, and the sheet
   "Смяна"); "Не сега" and a refusal of the browser are remembered on the phone ("dr-geo": "yes" | "no"). */
export const GEO_NOTE = "Телефонът разбира по GPS, че колата се движи, и спира приложението, докато караш. Местоположението не се изпраща никъде.";
const geoGet = (): string => { try { return localStorage.getItem("dr-geo") || ""; } catch { return ""; } };
const geoSet = (v: string) => { try { localStorage.setItem("dr-geo", v); } catch { /* the choice lives for the page */ } };
let geoPerm: string = "";
if (typeof navigator !== "undefined" && navigator.permissions && navigator.permissions.query) {
  navigator.permissions.query({ name: "geolocation" as PermissionName }).then((r) => { geoPerm = r.state; r.onchange = () => { geoPerm = r.state; }; }).catch(() => { /* old browser */ });
}
/** may the phone watch the speed: the browser said yes (or this phone allowed it before, where the browser cannot tell) */
export const geoOn = (): boolean => typeof navigator !== "undefined" && "geolocation" in navigator && (geoPerm === "granted" || (geoPerm === "" && geoGet() === "yes"));
/** "Разреши" / "Не сега", or the state in words */
export function geoHTML(): string {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) return '<b data-geobox>Телефонът няма GPS</b>';
  if (geoOn()) return '<b data-geobox>Разрешено</b>';
  if (geoPerm === "denied" || geoGet() === "no") return '<span data-geobox><b>Изключено</b><button class="link" type="button" data-geo="yes">Разреши</button></span>';
  return '<span class="geoacts" data-geobox><button class="pill pill-line" type="button" data-geo="yes">Разреши</button><button class="pill pill-soft" type="button" data-geo="no">Не сега</button></span>';
}
/** the buttons of geoHTML(); done() after the choice */
export function bindGeo(root: HTMLElement, done: () => void): void {
  root.querySelectorAll<HTMLButtonElement>("[data-geo]").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.geo === "no") { geoSet("no"); done(); return; }
      b.disabled = true;
      navigator.geolocation.getCurrentPosition(() => { geoSet("yes"); geoPerm = geoPerm === "prompt" || geoPerm === "" ? "granted" : geoPerm; done(); },
        (e) => { if (e.code === 1) { geoSet("no"); geoPerm = "denied"; } done(); }, { maximumAge: 60_000, timeout: 15_000 });
    };
  });
}

/* ---------- "Колата е в движение": the speed from the GPS of this browser, only while the app is open ----------
   Never sent anywhere (decision 17.11.2026). "Аз съм пътник" holds for the shift, "Паркирах" until the car is seen
   stopped and then moving again. A denied permission shows nothing. */
const MOVE = 4.2, STOP = 1.4; /* m/s: 15 km/h and 5 km/h */
function watchMoving(drv: Drv) {
  const sh = drv.state.shift!;
  if (sh.parked === "passenger" || !("geolocation" in navigator)) return;
  let armed = sh.parked !== "parked", last: { lat: number; lon: number; t: number } | null = null, shown: HTMLElement | null = null, id = -1;
  const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
    const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  function show() {
    const st = drv.st, o = document.createElement("div");
    o.className = "moving"; o.setAttribute("role", "alertdialog"); o.setAttribute("aria-modal", "true"); o.setAttribute("aria-labelledby", "mvh"); o.setAttribute("aria-describedby", "mvp");
    o.innerHTML = '<div class="ill">' + ic("car", 52) + '</div><h1 id="mvh">Колата е в движение</h1><p id="mvp">За твоя безопасност приложението се ползва само в паркирано положение. Навигацията в ' + esc(NAVAPP[drv.navApp()] || "Google Maps") + " продължава.</p>" +
      '<button class="pill pill-red pill-lg" type="button" data-park="parked">' + ic("check", 22) + 'Паркирах</button><button class="pill pill-line pill-lg" type="button" data-park="passenger">Аз съм пътник</button>' +
      '<p class="small" style="max-width:34ch">„Аз съм пътник“ важи до края на смяната. „Паркирах“ важи, докато колата не тръгне отново.</p>';
    const bg = [st.app, st.ov]; bg.forEach((el) => { el.inert = true; });
    document.body.appendChild(o); shown = o;
    o.querySelector<HTMLElement>("[data-park]")!.focus();
    o.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const f = Array.from(o.querySelectorAll<HTMLElement>("button")), a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    });
    o.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-park]"); if (!b) return;
      const v = b.dataset.park as "parked" | "passenger";
      o.remove(); shown = null; bg.forEach((el) => { el.inert = false; }); armed = false;
      if (v === "passenger" && id > -1) navigator.geolocation.clearWatch(id);
      driverApi.prefs({ parked: v }).catch(() => { /* remembered on the screen for this page */ });
    });
  }
  try {
    id = navigator.geolocation.watchPosition((p) => {
      const c = p.coords, now = p.timestamp || Date.now();
      let v: number | null = c.speed != null && !isNaN(c.speed) ? c.speed : null;
      if (v == null && last && c.accuracy <= 60) { const dt = (now - last.t) / 1000; if (dt >= 1) v = dist(last, { lat: c.latitude, lon: c.longitude }) / dt; }
      if (c.accuracy <= 60) last = { lat: c.latitude, lon: c.longitude, t: now };
      if (v == null) return;
      if (v < STOP) armed = true;
      else if (v >= MOVE && armed && !shown) show();
    }, (e) => { if (e.code === 1 && id > -1) navigator.geolocation.clearWatch(id); }, { enableHighAccuracy: true, maximumAge: 5000 });
  } catch { /* no geolocation */ }
}
