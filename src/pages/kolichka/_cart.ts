/* Cart and checkout (/kolichka/): port of design/pages/cart.html (design/PAGES.md "cart.html", decisions 18-22, 31).
   3 steps in the address hash: #kolichka -> #adres -> #danni. Everything depends on the visitor's cart (localStorage) and the
   hour, so the server draws only a skeleton and this script draws the views. The order sum always comes from the current
   menu prices (lib/pricing.ts, the same function the core uses on the server). The order is created with api.orders.create
   (server or demo core) and on success the visitor goes to url.tracking(order) (number + secret key).
   The core checks everything again (prices, zone, hours, slot, discount code) and answers with the same error codes
   on the server and in the demo; each code is shown here as text for a person, on the step where it can be fixed. */
import { SC } from "../../client/sc-menu.ts";
import { api, ApiError } from "../../client/api.ts";
import { price, pickupSlots, pickupToday, slotBusy, type Priced, type PricedRow } from "../../lib/pricing.ts";
import { findAddress, zoneOfAddress, zoneByName, zoneMin, SAMPLE_ADDRESSES, hasStreet } from "../../lib/zones.ts";
import type { Dish } from "../../lib/data.ts";
import type { State } from "../../lib/status.ts";
import { sofiaYmd, addDaysYmd } from "../../lib/time.ts";
import { LUNCH_DATE } from "../../lib/lunch.ts";
import { normPhone, prettyPhone } from "../../lib/format.ts";
import { ORDER_RULES } from "../../lib/consts.ts";
import { PAY_METHODS } from "../../lib/pay.ts";
import { callBtn, miss, previewPanel, pvToggle, PV, BACK, OFFLINE, MKT_TITLE, MKT_SUB } from "../../lib/ui.ts";

/* icons this script draws (render.ts brings plus, fire, sparkle, leaf, pepper, clock; sc.ts x, check, caret-right, phone) */
import "sc-icons:arrow-left,arrow-right,bowl-food,calendar-blank,caret-down,check-circle,credit-card,fork-knife,hourglass,info,map-pin,map-trifold,minus,money,moped,path,receipt,seal-percent,shopping-bag,sliders-horizontal,storefront,ticket,timer,trash,user,warning-circle"; /* the icons of this module in one group (scripts/icon-groups.mjs) */

type Zk = "" | "free" | "paid" | "out";
type Sched = "" | "днес" | "утре";
type Pay = "cash" | "card" | "voucher";
/* sched + schedFor: "утре" chosen on 12.11 means 13.11 (Sofia date), so a draft kept overnight never orders a day too late.
   code + codePct: the discount code from the rating, checked by the core (api.codes.check) before it is shown as applied. */
interface Draft { addr: string; zone: string; zk: Zk; addrMore: string; slot: string; name: string; phone: string; email: string; note: string; pay: Pay; sched: Sched; schedFor: string; code: string; codePct: number; consent: boolean }
interface Flash { step: number; kind: "bad" | "warn" | "info"; title: string; text?: string; acts?: string }
interface Slot { t: number; v: string; busy: boolean }
interface Info extends Priced {
  /** lunch lines from a day without a lunch menu: shown as "Не се брои", never priced, never sent */
  stale: PricedRow[]; profilePct: number;
  s: State; m: number; sched: Sched; today: boolean; delivOK: boolean; dMin: number; slots: Slot[]; ok1: boolean; ok2: boolean;
}
interface AddrOpt { a: string; z: string; hint?: string }

export function start(): void {
  const { esc, fmt, ic } = SC;
  const R = { ...SC.RESTAURANT, phone: SC.RESTAURANT.phone.replace(/ /g, " ") }; /* keep the number on one line */
  const TEL = "tel:" + SC.RESTAURANT.phoneIntl;
  const main = SC.mount();
  const bar = document.querySelector<HTMLElement>("[data-ckbar]")!;
  const hdrBack = document.querySelector<HTMLAnchorElement>(".top.back > a.hb");
  const hdrTitle = document.querySelector<HTMLElement>(".top.back .ttl");
  const smooth = (): ScrollBehavior => (SC.reduce ? "auto" : "smooth");

  /* ---------- draft (per-viewer convenience: "Назад" never loses what was typed) ---------- */
  const DKEY = "sc-checkout";
  const D: Draft = Object.assign({ addr: "", zone: "", zk: "", addrMore: "", slot: "", name: "", phone: "", email: "", note: "", pay: "cash", sched: "", schedFor: "", code: "", codePct: 0 }, SC.load<Partial<Draft>>(DKEY, {})) as Draft;
  D.consent = false; /* marketing consent is never pre-ticked and never restored */
  if (!["cash", "card", "voucher"].includes(D.pay)) D.pay = "cash";
  if (!["", "днес", "утре"].includes(D.sched)) D.sched = "";
  if (typeof D.code !== "string" || !(D.codePct > 0)) { D.code = ""; D.codePct = 0; }
  const U = SC.user() as { name?: string; phone?: string; consent?: { marketing?: boolean } } | null; /* signed-in client */
  if (U) { if (!D.name && U.name) D.name = U.name; if (!D.phone && U.phone) D.phone = String(U.phone); }
  (function () { /* time chosen on the pickup page: sc-pickup {day, t}; t = "16:45" (or minutes), null = as soon as possible */
    const pk = SC.load<Record<string, unknown> | null>("sc-pickup", null);
    if (!pk || typeof pk !== "object") return;
    if (pk.day && pk.day !== "today") return;
    const t = pk.t !== undefined ? pk.t : pk.slot !== undefined ? pk.slot : pk.asap ? null : undefined;
    if (t === undefined) return;
    D.slot = t == null ? "asap" : typeof t === "number" ? t2(t) : /^\d{1,2}:\d{2}$/.test(String(t)) ? (String(t).length === 4 ? "0" + t : String(t)) : "";
    SC.store("sc-pickup", null);
  })();
  function save() { const c: Partial<Draft> = { ...D }; delete c.consent; SC.store(DKEY, c); }

  /* page-only UI state */
  const P = { offline: false, loading: false, sending: false, err: "" as "" | "form" | "offline" | "server" | "throttled", errMsg: "", placing: false, allSlots: false, checking: false, errs: {} as Record<string, string | undefined>,
    /* a message from the core shown on the step where it can be fixed (cleared on the next move) */
    flash: null as Flash | null,
    /* the code field: what is typed, and the check in progress */
    codeTxt: "", codeBusy: false,
    /* the signed-in customer's -10% profile bonus (api.auth.me().profileBonus); it counts only with the profile's phone */
    me: null as null | { bonus: boolean; phone: string },
    /* an address with the quarter only: the zone it would be, while we ask for the street or block */
    needStreet: "" };

  /* ---------- helpers ---------- */
  function t2(m: number) { m = ((Math.round(m) % 1440) + 1440) % 1440; return SC.hhmm(m); }
  const round5 = (m: number) => Math.ceil(m / 5) * 5;
  /* dates by the Sofia calendar (not the device clock): "пт, 13 ноември" */
  const ymdDate = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d, 12); };
  const targetYmd = (sched: Sched) => (sched === "утре" ? addDaysYmd(sofiaYmd(), 1) : sofiaYmd());
  function tomorrowLabel() { return SC.dateLong(ymdDate(addDaysYmd(sofiaYmd(), 1))); }
  function setSched(v: Sched) { D.sched = v; D.schedFor = v ? targetYmd(v) : ""; D.slot = ""; save(); }
  const dishWord = (n: number) => SC.plural(n, "ястие", "ястия");
  const lineHref = (x: Dish) => SC.url.dish(x);

  /* ---------- the whole order, computed from the menu and SC.state() each time ---------- */
  function info(): Info {
    const s = SC.state();
    /* a pre-order kept from another day, or "днес" after 10:00 (the kitchen is open now): back to an order for now */
    if (D.sched && (D.schedFor !== targetYmd(D.sched) || (D.sched === "днес" && s.m >= 600))) setSched("");
    const sched = D.sched;
    /* kitchen closed (before 10:00 / after 22:30) and no day chosen yet: the order can only be for later, so step 1 already
       shows it like step 2 does ("по избран час", delivery and pickup both possible), never a time tonight */
    const closed = !sched && !s.kitchen, today = !sched && !closed;
    const zone = D.zk === "free" || D.zk === "paid" ? zoneByName(D.zone) : null;
    const cart = SC.cart.get(), staleLines = lunchStale() ? cart.lines.filter((l) => SC.byId[l.id] && SC.byId[l.id].lunch) : [];
    const profilePct = profileOn() ? 10 : 0;
    const p = price(staleLines.length ? { ...cart, lines: cart.lines.filter((l) => staleLines.indexOf(l) < 0) } : cart, { zone, scheduled: !!sched || closed, codePct: D.code ? D.codePct : 0, profilePct });
    const stale = staleLines.length ? price({ ...cart, lines: staleLines }, { scheduled: true }).rows.map((r) => ({ ...r, out: true, disc: 0 })) : [];
    const I = { ...p, stale, profilePct, closed, s, m: s.m, sched, today, delivOK: p.deliveryOk, dMin: p.etaMin, slots: [] as Slot[], ok1: false, ok2: false } as Info;
    I.slots = slotList(I);
    I.ok1 = I.n > 0 && !I.conflict && !I.closed && !tooBig(I);
    I.ok2 = I.ok1 && (I.mode === "delivery" ? (D.zk === "free" || D.zk === "paid") && !!D.addr && (today || validSlot(I)) : validSlot(I));
    return I;
  }

  /* the lunch menu in the data is for one date; on another day its dishes are not sold (the core says lunch_stale).
     In preview and in the demo the core counts the menu as today's, so the page does the same. */
  function lunchStale() { return !SC.lunchIsToday(); } /* preview / demo: today (lib/lunch.ts) */
  const lunchDay = () => SC.dateLong(ymdDate(LUNCH_DATE));
  /* over the limits of a web order (the core says too_big): known before the 3 steps */
  const tooBig = (I: Priced) => I.n > ORDER_RULES.maxPortions || I.sub > ORDER_RULES.maxTotal;
  /* the profile bonus: only with the profile's phone (the core checks the same and gives it once per phone) */
  function profileOn() {
    if (!P.me || !P.me.bonus) return false;
    const ph = normPhone(D.phone || "");
    return !ph || ph === P.me.phone;
  }

  /* pickup slots: every 15 min, up to 3 hours ahead, not after 22:30. Pre-orders: the whole day.
     "заето": while the kitchen has switched on "Натоварено", the next hour is full. In preview one slot is always full (to show the state). */
  function slotList(I: Info): Slot[] {
    return pickupSlots(I, undefined, !!I.sched).map((t, k) => ({ t, v: t2(t), busy: (I.today && slotBusy(t, I.m, !!I.busy)) || (SC.preview && k === 4) }));
  }
  function validSlot(I: Info) {
    if (!D.slot) return false;
    if (D.slot === "asap") return I.today && pickupToday(I).asap; /* the one pickup rule with the core */
    return I.slots.some((s) => s.v === D.slot && !s.busy);
  }

  function etaText(I: Info): { big: string; small: string } {
    if (!I.n) return { big: "", small: "" };
    if (I.conflict === "delivery") return { big: "Само за вземане от място", small: "Обедното меню след 15:00 не се доставя" };
    if (I.closed) return { big: I.m < 600 ? "Днес, от 10:30" : "Утре, от 10:30", small: "Изберете час в следващата стъпка" };
    if (I.sched) {
      if (D.slot && D.slot !== "asap") return { big: (I.sched === "утре" ? "Утре" : "Днес") + " в " + D.slot, small: I.mode === "delivery" ? "Доставка в този час" : "Готова за вземане" };
      return { big: "Изберете час", small: "В следващата стъпка" };
    }
    if (I.mode === "delivery") return { big: "Пристига около " + t2(I.m + I.dMin), small: "около " + I.dMin + " мин" + (I.busy ? ", възможни са закъснения" : "") };
    if (D.slot && D.slot !== "asap") return { big: "Готова в " + D.slot, small: "Вземане от ресторанта" };
    return I.hasTrad ? { big: "Готова около " + t2(round5(I.earliest)), small: "След около 20 мин" } : { big: "Готова веднага", small: "Обедното меню е приготвено" };
  }

  /* ---------- small building blocks ---------- */
  const STEPS: [string, string][] = [["kolichka", "Количка"], ["adres", "Къде и кога"], ["danni", "Данни"]];
  function stepper(n: number, grow?: boolean) {
    return '<nav class="stepper steps" aria-label="Стъпки на поръчката"><div class="t"><b>Стъпка ' + n + " от 3</b><span>" + (n < 3 ? "Следва: " + STEPS[n][1] : "Последна стъпка") + "</span></div>" +
      '<div class="bar" style="--n:3">' + [1, 2, 3].map((k) => '<span class="' + (k <= n ? "on" : "") + (k === n && grow ? " grow" : "") + '"></span>').join("") + "</div>" +
      "<ol>" + STEPS.map((s, i) => { const k = i + 1; return '<li class="' + (k === n ? "cur" : "") + '"' + (k === n ? ' aria-current="step"' : "") + ">" + (k < n ? '<button class="sl" type="button" data-act="go" data-n="' + k + '">' + ic("check", 16) + s[1] + '<span class="vh"> (готово, върнете се)</span></button>' : '<span class="sl">' + s[1] + "</span>") + "</li>"; }).join("") + "</ol></nav>";
  }
  /** the title of a send error: focusable, so the focus lands on it (not on <body>) after the step is drawn again */
  const errH = (t: string) => '<span tabindex="-1" data-errh>' + t + "</span>";
  function focusErr() { const h = main.querySelector<HTMLElement>("#topnotes [data-errh]"); if (h) { scrollToEl(h); h.focus({ preventScroll: true }); } }
  function note(kind: string, icon: string, title: string, text?: string, acts?: string) {
    return '<div class="note ' + kind + '" role="' + (kind === "bad" ? "alert" : "status") + '">' + ic(icon, 24) + "<div><b>" + title + "</b>" + (text ? "<p>" + text + "</p>" : "") + "</div>" + (acts ? '<div class="acts">' + acts + "</div>" : "") + "</div>";
  }

  function topNotes(I: Info, step: number) {
    let h = "";
    if (P.flash && P.flash.step === step) h += note(P.flash.kind, "warning-circle", P.flash.title, P.flash.text, P.flash.acts);
    if (P.offline && !(step === 3 && P.err === "offline")) h += note("warn", "warning-circle", OFFLINE, "Количката е запазена на това устройство. Опитайте пак, когато връзката се върне.");
    if (I.closed) h += I.m < 600
      ? note("info", "clock", "Кухнята отваря в 10:00", "Можете да поръчате още сега за днес. Изберете час и ще я приготвим точно тогава.")
      : note("info", "clock", "Кухнята приема поръчки до 22:30", "Поръчайте за утре: изберете час и ще я приготвим точно тогава.");
    else if (I.sched) h += note("info", "calendar-blank", "Поръчвате за " + (I.sched === "утре" ? "утре, " + tomorrowLabel() : "днес"), "Ще я приготвим за часа, който изберете.");
    if (I.conflict === "delivery") h += note("warn", "warning-circle", "Обедното меню след 15:00 е само за вземане от място (-30%)", "Вземете я от ресторанта и отстъпката се смята сама. Или махнете обедните ястия и я доставяме.",
      '<button class="pill pill-line" type="button" data-act="rmlunch">' + ic("trash", 20) + "Махни обедните ястия</button>");
    if (I.conflict === "sched") h += note("warn", "warning-circle", "Обедното меню не се поръчва предварително", "Поръчва се в деня, от 10:00 до 15:00. Махнете обедните ястия, за да поръчате за " + (I.m < 600 ? "по-късно" : "утре") + ". Другото остава в количката.");
    if (step === 1 && tooBig(I)) h += note("bad", "warning-circle", "Голяма поръчка: обадете ни се",
      "През сайта се поръчват до " + ORDER_RULES.maxPortions + " порции и до " + fmt(ORDER_RULES.maxTotal) + " за ястията. За по-голяма поръчка се обадете на " + R.phone + ": ще я приготвим навреме.",
      callBtn("pill pill-ink"));
    if (step === 1 && I.stale.length) h += note("warn", "warning-circle", "Обедното меню за днес още не е качено",
      "Обедните ястия в количката са от менюто за " + lunchDay() + " и не се броят в поръчката. Махнете ги, а другото остава.",
      '<button class="pill pill-line" type="button" data-act="rmlunch">' + ic("trash", 20) + "Махни обедните ястия</button>");
    if (step === 1 && I.n === 0 && I.outN) h += note("warn", "warning-circle", "Всичко в количката е изчерпано днес", "Сменете ястията с подобни или изберете нещо друго от менюто.");
    return h;
  }

  function similar(x: Dish): Dish | null {
    return SC.items.filter((y) => y.cat === x.cat && y.id !== x.id && !SC.isOut(y)).sort((a, b) => Math.abs(a.p - x.p) - Math.abs(b.p - x.p))[0] || null;
  }

  function lineHTML(r: PricedRow, stale = false) {
    const x = r.x, out = r.out, extra = Math.round((r.unit - x.p) * 100) / 100;
    const mods = (r.mods || []).map((md) => { const add = /^\+/.test(md); let txt = add ? md.replace(/^\+\s*/, "") : md; txt = txt.charAt(0).toUpperCase() + txt.slice(1); return '<span class="tag' + (add ? " add" : "") + '">' + (add ? ic("plus", 14) : "") + esc(txt) + "</span>"; }).join("");
    const tags = (x.lunch && !stale ? '<span class="tag lunch">' + ic("bowl-food", 16) + "Обедно меню</span>" : "") + (r.disc ? '<span class="tag promo">-30% след 15:00</span>' : "") + mods;
    const sub = fmt(r.unit) + (r.q > 1 ? " за брой" : "") + (x.g ? " · " + esc(x.g) : "") + (extra ? " · с добавки" : "");
    const pr = out ? '<span class="muted small">Не се брои</span>' : r.disc ? '<span class="old">' + fmt(r.tot) + '</span><span class="price">' + fmt(r.tot - r.disc) + "</span>" : '<span class="price">' + fmt(r.tot) + "</span>";
    const k = esc(r.key);
    const counter = '<div class="counter" role="group" aria-label="Брой: ' + esc(x.n) + '"><button type="button" data-act="dec" data-key="' + k + '" data-fk="dec-' + k + '" aria-label="' + (r.q === 1 ? "Махни " : "Едно по-малко: ") + esc(x.n) + '">' + ic("minus", 20) + '</button><output aria-live="polite">' + r.q + '</output><button type="button" data-act="inc" data-key="' + k + '" data-fk="inc-' + k + '" aria-label="Още едно: ' + esc(x.n) + '"' + (out ? " disabled" : "") + ">" + ic("plus", 20) + "</button></div>";
    const sim = out && !stale ? similar(x) : null;
    return '<li class="ln' + (out ? " out" : "") + '">' +
      '<a class="ln-pic" href="' + lineHref(x) + '" tabindex="-1" aria-hidden="true">' + SC.pic(x) + "</a>" +
      '<div class="ln-info"><a class="ln-name" href="' + lineHref(x) + '">' + esc(x.n) + '</a><span class="ln-sub">' + sub + "</span>" + (tags ? '<div class="ln-tags">' + tags + "</div>" : "") + "</div>" +
      '<div class="ln-act">' + (out ? "" : counter) + '<button class="ln-rm" type="button" data-act="rm" data-key="' + k + '" data-fk="rm-' + k + '">' + ic("trash", 18) + 'Махни<span class="vh"> ' + esc(x.n) + '</span></button><span class="ln-tot">' + pr + "</span></div>" +
      (stale ? '<div class="ln-outmsg">' + ic("clock", 18) + "<span><b>Не се брои.</b> Менюто е от " + lunchDay() + ", днес не го предлагаме.</span></div>" : "") +
      (out && !stale ? '<div class="ln-outmsg">' + ic("clock", 18) + "<span><b>Изчерпано днес.</b> Няма да го включим в поръчката." + (sim ? " Подобно: " + esc(sim.n) + ', <span class="price">' + fmt(sim.p) + "</span>." : "") + "</span>" + (sim ? '<button class="pill pill-ink" type="button" data-act="swap" data-key="' + k + '" data-id="' + sim.id + '">' + ic("arrow-right", 18) + "Смени с " + esc(sim.n) + "</button>" : "") + "</div>" : "") +
      "</li>";
  }

  function allergensHTML(I: Info) {
    const items = I.rows.filter((r) => !r.out);
    return '<details class="allerg"><summary>' + ic("info", 20) + "Алергени в поръчката" + ic("caret-down", 18) + "</summary><ul>" + items.map((r) => {
      const x = r.x;
      return "<li><span>" + esc(x.n) + "</span><span>" + (x.comp ? (x.al.length ? x.al.map(SC.allergenName).join(", ") : "Без основните 14 алергена") : "Няма данни, попитайте ни") + "</span></li>";
    }).join("") + '</ul><p class="note-auto">' + ic("info", 18) + "<span>Алергените са предварителни, от състава. Кухнята ги потвърждава. Попитайте ни на " + R.phone + ".</span></p></details>";
  }

  function suggestions(I: Info) {
    const ids = SC.cart.lines().map((l) => l.id), seenC: Record<string, 1> = {}, seenI: Record<string, 1> = {}, out: { c: string; id: string }[] = [];
    I.rows.filter((r) => !r.out).sort((a, b) => (a.x.lunch ? 1 : 0) - (b.x.lunch ? 1 : 0)).forEach((r) => {
      SC.suggest(r.x.id, ids).forEach((s) => { if (out.length < 2 && !seenC[s.c] && !seenI[s.id] && ids.indexOf(s.id) < 0 && SC.byId[s.id]) { seenC[s.c] = 1; seenI[s.id] = 1; out.push(s); } });
    });
    return out;
  }

  function ffHTML(I: Info, step: number) {
    const s = I.s, e = SC.eta();
    const dSmall = !I.delivOK ? "до 21:00" : I.today ? (I.hasLunch && !s.lunch ? "без обедното меню" : "около " + I.dMin + " мин") : "по избран час";
    const pSmall = !I.n ? "от ресторанта" : I.today ? (I.hasTrad ? "готова след 20 мин" : "готова веднага") : "по избран час";
    let h = '<div class="seg ff" role="group" aria-label="Как да получите поръчката">' +
      '<button type="button" data-act="mode" data-v="delivery" aria-pressed="' + (I.mode === "delivery") + '"' + (I.delivOK ? "" : " disabled") + ">" + ic("moped", 26) + "<b>Доставка</b><small>" + dSmall + "</small></button>" +
      '<button type="button" data-act="mode" data-v="pickup" aria-pressed="' + (I.mode === "pickup") + '">' + ic("storefront", 26) + "<b>Вземи от място</b><small>" + pSmall + "</small></button></div>";
    if (P.flash && P.flash.step === step) { /* the message from the core above already says it */ }
    else if (!I.delivOK) h += '<div class="ff-note">' + note("info", "info", "Доставката е до 21:00", "Поръчки за вземане до 22:30, готови най-късно в 23:00.") + "</div>";
    else if (step === 1 && I.mode === "delivery" && I.today && e.busy) h += '<div class="ff-note">' + note("info", "clock", esc(e.text), "Кухнята е натоварена. Ако бързате, вземете я от място.") + "</div>";
    else if (I.mode === "pickup" && I.today && s.lunchDiscount && I.hasLunch) h += '<div class="ff-note">' + note("promo", "seal-percent", "-30% на обедното меню", "След 15:00 при вземане от място. Отстъпката вече е сметната.") + "</div>";
    return h;
  }

  function ctaLabel(I: Info, step: number) {
    if (step === 1) { if (I.closed) return I.m < 600 ? "Поръчай за днес" : "Поръчай за утре"; return I.mode === "delivery" ? "Към адреса" : "Избери час"; }
    if (step === 2) return "Към данните";
    return P.err === "offline" || P.err === "server" ? "Опитай пак" : "Поръчай";
  }
  /* what the order costs if it is picked up (the lunch -30% after 15:00): the button says the action and the price */
  function pickupTotal(I: Info) { return price({ ...SC.cart.get(), mode: "pickup" }, { scheduled: !!I.sched || I.closed, codePct: D.code ? D.codePct : 0 }).total; }
  function ctaBtn(I: Info, step: number, block: boolean) {
    const lbl = ctaLabel(I, step) + " · " + fmt(I.total) + (I.feeUnknown && block ? " + доставка" : "");
    const cls = "pill pill-red pill-lg js-next" + (block ? " pill-block" : "");
    if (step === 3 && P.sending) return '<button class="pill pill-red pill-lg' + (block ? " pill-block" : "") + '" type="button" aria-busy="true" aria-disabled="true">' + esc(lbl) + '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="vh">Изпращаме поръчката</span></button>';
    if (step === 1 && I.conflict === "delivery") return '<button class="' + cls + '" type="button" data-act="mode" data-v="pickup">' + ic("storefront", 20) + "Смени на вземане · " + fmt(pickupTotal(I)) + "</button>";
    if (step === 2 && I.mode === "delivery" && D.zk === "out") return '<button class="' + cls + '" type="button" data-act="mode" data-v="pickup">Вземи от място · ' + fmt(I.total) + "</button>";
    if (step === 1 && tooBig(I)) return '<a class="' + cls.replace(" js-next", "") + ' js-next" href="' + TEL + '">' + ic("phone", 20) + "Обади се · " + R.phone + "</a>";
    /* too many orders from this phone / place: trying again is refused too, so the main action is the call (as in the reservation) */
    if (step === 3 && P.err === "throttled") return callBtn(cls.replace(" js-next", "") + " js-next");
    if (step === 1 && !I.n && I.stale.length) return '<button class="' + cls + '" type="button" data-act="rmlunch">' + ic("trash", 20) + "Махни обедните ястия</button>";
    if (step === 1 && I.conflict === "sched") return '<button class="' + cls + '" type="button" data-act="rmlunch">' + ic("trash", 20) + "Махни обедните ястия</button>";
    return '<button class="' + cls + '" type="button" data-act="next" data-n="' + step + '">' + esc(lbl) + "</button>";
  }

  function summaryHTML(I: Info, step: number) {
    const e = etaText(I), zoneName = D.zone || "";
    const del = I.mode === "pickup" ? ["Вземане от място", "<small>Дружба 2, срещу бл. 311</small>", "Без такса"]
      : D.zk === "free" ? ["Доставка", "<small>" + esc(zoneName) + ", в зоната ни</small>", "Безплатна"]
        : D.zk === "paid" ? ["Доставка", "<small>" + esc(zoneName) + ", по тарифа</small>", miss("fee")]
          : ["Доставка", "<small>Безплатна в Дружба 1 и 2, НПЗ Искър и Бусманци. Горубляне и Гара Искър по тарифа.</small>", '<span class="muted">Според адреса</span>'];
    const list = step > 1 ? "<details><summary>" + ic("receipt", 20) + "Виж ястията (" + I.n + ")" + ic("caret-down", 18) + "</summary><ul>" + I.rows.filter((r) => !r.out).map((r) => "<li><span>" + r.q + " × " + esc(r.x.n) + '</span><span class="price">' + fmt(r.tot - r.disc) + "</span></li>").join("") + "</ul></details>" : "";
    return '<section class="sum shell" aria-labelledby="sumh"><div class="core"><h2 class="h3" id="sumh">Вашата поръчка</h2>' + list +
      '<div class="kv"><span>Ястия · ' + I.n + '</span><span class="price">' + fmt(I.sub) + "</span></div>" +
      (I.discKind === "lunch" ? '<div class="kv"><span><span class="disc-b">-30%</span>Отстъпка след 15:00<small>Обедното меню при вземане</small></span><span class="price">-' + fmt(I.disc) + "</span></div>" : "") +
      (I.discKind === "profile" ? '<div class="kv"><span><span class="disc-b">-' + I.profilePct + '%</span>Отстъпка с профил<small>Бонусът за профила ви,&nbsp;веднъж</small></span><span class="price">-' + fmt(I.disc) + "</span></div>" : "") +
      (I.discKind === "code" ? '<div class="kv"><span><span class="disc-b">-' + D.codePct + '%</span>Отстъпка с код<small>' + esc(D.code) + ", на ястията</small></span><span class=\"price\">-" + fmt(I.disc) + "</span></div>" : "") +
      '<div class="kv"><span>' + del[0] + del[1] + "</span><span>" + del[2] + "</span></div>" +
      '<div class="kv tot"><span>Общо</span><span><span class="price" data-total>' + fmt(I.total) + "</span>" + (I.feeUnknown ? "<small>+ таксата за доставка</small>" : "") + "</span></div>" +
      /* over the online limits the order cannot go through the site: no promise of a time */
      (e.big && !tooBig(I) ? '<div class="eta-row">' + ic(I.conflict === "delivery" ? "storefront" : I.mode === "delivery" ? "moped" : "clock", 24) + "<span><b>" + esc(e.big) + "</b><span>" + esc(e.small) + "</span></span></div>" : "") +
      '<p class="fine">Плащане при получаване: ' + PAY_METHODS.join(" · ") + ". Минимална поръчка: " + miss("minOrder") + ". Опаковка: " + miss("packaging") + "</p>" +
      '<div class="sum-cta">' + ctaBtn(I, step, true) + (step > 1 ? '<button class="link flow-back" type="button" data-act="go" data-n="' + (step - 1) + '" aria-label="' + BACK + ": " + STEPS[step - 2][1] + '">' + ic("arrow-left", 18) + BACK + "</button>" : "") + "</div>" +
      "</div></section>";
  }

  /* the prototype panel: only in preview (?preview=1, the admin frames, the demo) */
  function protoHTML(view: string) {
    if (!SC.preview) return "";
    let h = '<button class="chip" type="button" data-act="demo">' + ic("shopping-bag", 18) + "Напълни примерна количка</button>";
    if (view !== "empty") h += '<button class="chip" type="button" data-act="clear">' + ic("trash", 18) + "Изпразни количката</button>" +
      '<button class="chip" type="button" data-act="addout">' + ic("clock", 18) + "Добави изчерпано ястие</button>" +
      '<button class="chip" type="button" data-act="loading">' + ic("hourglass", 18) + PV.loading + "</button>";
    h += pvToggle(PV.offline, P.offline, 'data-act="offline"');
    return previewPanel(h, { id: "ck-pv", cls: "ck-pv", bare: true, text: "Примерна количка и състояния. Тези бутони ги няма на истинския сайт." });
  }

  /* ---------- views ---------- */
  function viewEmpty() {
    const s = SC.state();
    const picks = SC.items.filter((x) => x.t.indexOf("hit") > -1 || x.t.indexOf("new") > -1).concat(SC.items.filter((x) => x.id === "pitsa-margarita"));
    return '<div class="ck emp enter"><div class="empty"><div class="ill">' + ic("shopping-bag", 56) + "</div>" +
      '<h1 class="h1 ck-title" tabindex="-1">Количката е празна</h1><p class="lead">Какво ви се хапва?</p>' +
      '<div class="btns"><a class="pill pill-red pill-lg pill-block" href="' + SC.url.menu() + '">' + ic("fork-knife", 22) + "Към менюто</a>" +
      (s.lunch || s.lunchDiscount ? '<a class="pill pill-line pill-lg pill-block" href="' + SC.url.lunch() + '">' + ic("bowl-food", 22) + (SC.lunchIsToday() ? "Обедно меню днес" : "Обедно меню") + (s.lunchDiscount ? " · -30% при вземане" : "") + "</a>" : "") +
      (SC.preview ? '<button class="pill pill-lg pill-block proto-pill" type="button" data-act="demo">' + ic("sparkle", 20) + 'Напълни примерна количка<span class="vh"> (само в прегледа)</span></button>' : "") + "</div></div>" +
      '<section class="blk" style="margin-top:44px" aria-labelledby="hh"><div class="blk-h"><h2 class="h3 emp-h" id="hh">Хитове и новости</h2><a class="link" href="' + SC.url.menu() + '">Цялото меню' + ic("caret-right", 18) + "</a></div>" +
      '<div class="rail">' + picks.map((x) => SC.dishCard(x)).join("") + "</div></section>" + protoHTML("empty") + "</div>";
  }

  function viewLoading() {
    const sk = (w: string, h: number) => '<span class="skel" style="display:block;width:' + w + ";height:" + h + 'px"></span>';
    return '<div class="ck" aria-busy="true"><div class="ck-grid"><div class="ck-main">' + stepper(1) + '<h1 class="h1 ck-title" tabindex="-1">Количка</h1><p class="lead ck-lead">Проверяваме цените и наличността…</p>' +
      '<div class="shell" style="margin-top:22px"><div class="core" style="padding:2px 18px">' + [1, 2, 3].map(() => '<div class="sk-line">' + sk("72px", 72) + "<div>" + sk("70%", 18) + sk("40%", 14) + sk("55%", 36) + "</div></div>").join("") + "</div></div></div>" +
      '<div class="ck-side"><div class="shell"><div class="core pad" style="display:grid;gap:14px">' + sk("40%", 22) + sk("100%", 16) + sk("100%", 16) + sk("60%", 28) + "</div></div></div></div></div>";
  }

  function viewStep1(I: Info) {
    const sg = suggestions(I);
    const left = stepper(1, true) + '<h1 class="h1 ck-title" tabindex="-1">Количка</h1><p class="lead ck-lead">' + dishWord(I.n) + " · " + fmt(I.total) + "</p>" +
      '<div style="margin-top:22px">' + topNotes(I, 1) + "</div>" +
      '<section class="blk" aria-label="Ястия в количката"><div class="shell"><div class="core"><ul class="lines">' + I.rows.map((r) => lineHTML(r)).join("") + I.stale.map((r) => lineHTML(r, true)).join("") + "</ul></div></div>" + (I.n ? allergensHTML(I) : "") + "</section>" +
      (sg.length ? '<section class="blk sugg" aria-labelledby="sgh"><div class="blk-h"><h2 class="h3" id="sgh">Да добавим ли?</h2><p class="muted small">Допълва менюто</p></div><div class="shell"><div class="core">' +
        sg.map((s) => { const x = SC.byId[s.id]; return '<div class="drow"><a class="open" href="' + SC.url.dish(x) + '">' + SC.pic(x) + "<span><small>" + (SC.COURSE_NAME as Record<string, string>)[s.c] + '</small><span class="nm">' + esc(x.n) + '</span><span class="meta"><span class="price">' + fmt(x.p) + '</span><span class="muted small">' + esc(x.per100 ? "за 100 гр." : x.g || "") + "</span></span></span></a>" + SC.plusBtn(x) + "</div>"; }).join("") + "</div></div></section>" : "") +
      '<section class="blk" aria-labelledby="ffh"><div class="blk-h"><h2 class="h3" id="ffh">Как да я получите?</h2></div>' + ffHTML(I, 1) + "</section>";
    return '<div class="ck"><div class="ck-grid"><div class="ck-main">' + left + '</div><div class="ck-side">' + summaryHTML(I, 1) + "</div></div>" + protoHTML("cart") + "</div>";
  }

  const streetNote = () => note("info", "map-pin", "Добавете улица или блок", esc(P.needStreet) + " е в зоната ни. Допишете улица и номер или блок, например „Дружба 2, бл. 311“, за да ви намери шофьорът.");
  function addrResult(I: Info) {
    if (P.checking) return '<div class="skel" aria-label="Проверяваме адреса"></div>';
    if (P.needStreet && !D.zk) return streetNote();
    if (!D.addr || !D.zk) return "";
    const z = zoneByName(D.zone);
    if (D.zk === "out" || !z) return note("bad", "warning-circle", "Извън зоната ни", "Не доставяме до този адрес. Можете да я вземете от ресторанта.", '<button class="pill pill-ink" type="button" data-act="mode" data-v="pickup">' + ic("storefront", 20) + 'Вземи от място</button><a class="pill pill-line" href="' + SC.url.page("delivery") + '">' + ic("map-trifold", 20) + "Виж зоните</a>");
    const mins = zoneMin(z) + (I.busy ? 20 : 0), when = I.today ? "\u00a0· около\u00a0" + mins + "\u00a0мин" : "";
    if (D.zk === "free") return note("ok", "check-circle", "Безплатна доставка" + when, esc(D.zone) + " е в нашата зона." + (I.busy && I.today ? " Кухнята е натоварена, затова времето е по-дълго." : ""));
    return note("info", "moped", "Доставка " + miss("fee") + when, esc(D.zone) + " е в зоната по тарифа. Таксата ще се вижда тук, преди да поръчате.");
  }

  function slotsHTML(I: Info, title: string) {
    const sl = I.slots, lim = I.sched && !P.allSlots ? 12 : 99, any = sl.some((s) => s.busy);
    if (!sl.length) return '<p class="slots-h">' + title + "</p>" + note("info", "clock", "Няма свободни часове днес", "Кухнята приема до 22:30. Поръчайте за утре или се обадете на " + R.phone + ".");
    return '<p class="slots-h" id="slh">' + title + '</p><div class="slots" role="group" aria-labelledby="slh">' + sl.slice(0, lim).map((s) =>
      '<button class="slot" type="button" data-act="slot" data-v="' + s.v + '" data-fk="slot-' + s.v + '" aria-pressed="' + (D.slot === s.v) + '"' + (s.busy ? ' disabled aria-label="' + s.v + ' заето: пълна кухня"' : "") + ">" + (D.slot === s.v ? '<span class="row" style="gap:5px">' + ic("check", 16) + s.v + "</span>" : s.v) + (s.busy ? " <small>заето</small>" : "") + "</button>").join("") + "</div>" +
      (sl.length > lim ? '<button class="pill pill-soft pill-block more-slots" type="button" data-act="allslots">' + ic("caret-down", 20) + "Покажи часовете до " + sl[sl.length - 1].v + "</button>" : "") +
      (any ? '<p class="slot-why">Зачеркнатите часове са заети: кухнята е пълна. Изберете друг.</p>' : "");
  }

  function viewStep2(I: Info) {
    let h: string;
    if (I.mode === "delivery") {
      h = '<h1 class="h1 ck-title" tabindex="-1">Къде да я доставим?</h1><p class="lead ck-lead">Проверяваме адреса веднага: зона, такса и време.</p>' +
        '<div style="margin-top:22px">' + topNotes(I, 2) + "</div>" +
        '<section class="blk">' + ffHTML(I, 2) + "</section>" +
        '<section class="blk"><div class="field"><label for="addr">Адрес за доставка</label>' +
        '<div class="combo">' + ic("map-pin", 22) + '<input id="addr" class="input" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="addr-list" autocomplete="street-address" placeholder="Например: Дружба 2, бл. 311" value="' + esc(D.addr) + '" data-fk="addr" aria-describedby="addr-help">' +
        (D.addr ? '<button class="combo-x" type="button" data-act="addr-clear" aria-label="Изчисти адреса">' + ic("x", 20) + "</button>" : "") + "</div>" +
        '<ul class="combo-list" id="addr-list" role="listbox" aria-label="Предложени адреси" hidden></ul>' +
        '<p class="help" id="addr-help">Квартал и улица или блок, например: Дружба 2, бл. 311. Пише се и на латиница.</p>' +
        (SC.preview ? '<div class="try" role="group" aria-label="Пробни адреси (само в прегледа)"><span>Пробни адреси:</span>' + ([[0, "Дружба 2"], [6, "Горубляне"], [8, "Младост 1"]] as [number, string][]).map((a) => '<button class="chip" type="button" data-act="addr-sample" data-i="' + a[0] + '">' + a[1] + "</button>").join("") + "</div>" : "") +
        '</div><div class="res" id="addr-res" aria-live="polite">' + addrResult(I) + "</div></section>" +
        (D.zk === "free" || D.zk === "paid"
          ? '<section class="blk"><div class="field"><label for="more">Вход, етаж, апартамент <span class="opt-tag">по желание</span></label><input id="more" class="input" type="text" data-f="addrMore" data-fk="more" value="' + esc(D.addrMore) + '" placeholder="Вх. Б, ет. 4, ап. 12" autocomplete="address-line2"><p class="help">За да ви намери шофьорът по-бързо.</p></div></section>' +
            (I.today ? '<section class="blk"><div class="blk-h"><h2 class="h3">Кога?</h2></div><div class="card when">' + ic("clock", 26) + "<span><b>Възможно най-скоро</b><span>Пристига около " + t2(I.m + I.dMin) + " · около " + I.dMin + " мин</span></span></div></section>"
              : '<section class="blk">' + slotsHTML(I, "Кога да я доставим " + (I.sched === "утре" ? "утре" : "днес") + "?") + "</section>")
          : "");
    } else {
      h = '<h1 class="h1 ck-title" tabindex="-1">Кога ще я вземете?</h1><p class="lead ck-lead">' + (I.today ? (I.hasTrad ? "Приготвяме я за около 20 минути." : "Обедното меню е готово веднага.") : "Изберете час за " + (I.sched === "утре" ? "утре" : "днес") + ".") + "</p>" +
        '<div style="margin-top:22px">' + topNotes(I, 2) + "</div>" +
        '<section class="blk">' + ffHTML(I, 2) + "</section>" +
        '<section class="blk">' + (I.today && pickupToday({ ...I, mode: "pickup" }).asap ? '<div class="opts"><label class="opt"><input type="radio" name="asap" data-act-r="asap"' + (D.slot === "asap" ? " checked" : "") + ' data-fk="asap">' + ic("timer", 24) + "<span><b>Възможно най-скоро</b><small>" + (I.hasTrad ? "Готова около " + t2(round5(I.earliest)) : "Готова веднага, елате когато ви е удобно") + "</small></span></label></div>" : "") +
        slotsHTML(I, I.today ? "Или изберете час" : "Изберете час") + "</section>" +
        '<section class="blk"><div class="card place">' + ic("map-pin", 24) + "<div><b>Siracusa Bar &amp; Grill</b><p>" + esc(SC.RESTAURANT.address) + '</p><p class="small" style="margin-top:4px">Паркиране: <span class="missing">[ЛИПСВА: къде]</span></p></div><a class="link" href="' + R.maps + '" target="_blank" rel="noopener">' + ic("path", 18) + "Маршрут в Google Maps</a></div></section>";
    }
    return '<div class="ck"><div class="ck-grid"><div class="ck-main">' + stepper(2, true) + h + '</div><div class="ck-side">' + summaryHTML(I, 2) + "</div></div>" + protoHTML("cart") + "</div>";
  }

  function fieldHTML(id: "name" | "phone" | "email" | "note", label: string, type: string, extra: string, help: string, optional: boolean) {
    const e = P.errs[id], desc = (help ? "h-" + id + " " : "") + "e-" + id; /* only ids that exist */
    return '<div class="field"><label for="f-' + id + '">' + label + (optional ? ' <span class="opt-tag">по желание</span>' : "") + "</label>" +
      (type === "textarea" ? '<textarea id="f-' + id + '" class="input" data-f="' + id + '" data-fk="f-' + id + '" ' + extra + (e ? ' aria-invalid="true"' : "") + ' aria-describedby="' + desc + '">' + esc(D[id]) + "</textarea>"
        : '<input id="f-' + id + '" class="input" type="' + type + '" data-f="' + id + '" data-fk="f-' + id + '" value="' + esc(D[id]) + '" ' + extra + (e ? ' aria-invalid="true"' : "") + ' aria-describedby="' + desc + '">') +
      '<p class="err" id="e-' + id + '"' + (e ? "" : " hidden") + ">" + (e ? ic("warning-circle", 18) + esc(e) : "") + "</p>" + (help ? '<p class="help" id="h-' + id + '">' + help + "</p>" : "") + "</div>";
  }

  /* the discount code from the internal rating (decision 12.11): optional, checked by the core, -10% on the dishes only,
     never together with the lunch -30% (the better one for the customer wins, the code then stays for the next order) */
  function codeHTML(I: Info) {
    const e = P.errs.code;
    let body: string;
    if (D.code) {
      const why = I.discKind === "code"
        ? note("ok", "check-circle", "Кодът е приложен: -" + fmt(I.disc), esc(D.code) + " · -" + D.codePct + "% на ястията" + (I.mode === "delivery" ? ", без таксата за доставка." : "."))
        : note("info", "info", I.discKind === "lunch" ? "Обедната отстъпка -30% е по-изгодна" : "Отстъпката с профил вече е сметната", "Отстъпките не се събират. Кодът " + esc(D.code) + " остава за следващата поръчка.");
      body = why + '<button class="link code-rm" type="button" data-act="code-rm">' + ic("x", 18) + "Махни кода</button>";
    } else {
      body = '<div class="field"><label for="f-code">Код за отстъпка <span class="opt-tag">по желание</span></label>' +
        '<div class="code-row"><input id="f-code" class="input" type="text" data-fk="f-code" value="' + esc(P.codeTxt) + '" placeholder="SC10-4829163057" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" aria-describedby="h-code e-code"' + (e ? ' aria-invalid="true"' : "") + ">" +
        '<button class="pill pill-ink" type="button" data-act="code-apply"' + (P.codeBusy ? ' aria-busy="true" aria-disabled="true"' : "") + ">" + (P.codeBusy ? "Проверяваме..." : "Приложи") + "</button></div>" +
        '<p class="err" id="e-code"' + (e ? "" : " hidden") + ">" + (e ? ic("warning-circle", 18) + esc(e) : "") + "</p>" +
        '<p class="help" id="h-code">Кодът от оценката след поръчка: -10% на ястията. Не се събира с други отстъпки.</p></div>';
    }
    return '<section class="blk code-blk" aria-label="Код за отстъпка">' + body + "</section>";
  }

  function bonusNote() {
    return P.me && P.me.bonus && !profileOn() ? '<div class="bonus-note">' + note("info", "info", "Бонусът -10% с профил важи с телефона на профила", "С " + prettyPhone(P.me.phone) + " се прилага сам. С друг телефон поръчката е без него.") + "</div>" : "";
  }
  function viewStep3(I: Info) {
    const deliv = I.mode === "delivery", e = etaText(I);
    const where = deliv ? "<span><small>Доставка до</small><b>" + esc(D.addr) + (D.addrMore ? ", " + esc(D.addrMore) : "") + '</b><span class="muted small">' + esc(e.big) + "</span></span>"
      : "<span><small>Вземане от ресторанта</small><b>" + (D.slot === "asap" ? esc(e.big) : I.sched ? esc(e.big) : "В " + esc(D.slot)) + '</b><span class="muted small">Siracusa, Дружба 2, срещу бл. 311</span></span>';
    const pays: [Pay, string, string, string][] = [["cash", "money", "В брой", deliv ? "На шофьора" : "В ресторанта"], ["card", "credit-card", "Карта при получаване", "Visa или Mastercard"], ["voucher", "ticket", "Ваучер", "Или подаръчна карта"]]; /* no brand names: which vouchers is [ЛИПСВА] */
    const h = stepper(3, true) + '<h1 class="h1 ck-title" tabindex="-1">Вашите данни</h1><p class="lead ck-lead">' + (U ? "Попълнихме ги от профила ви. Проверете ги." : "Без регистрация. Обаждаме се само ако нещо не е ясно.") + "</p>" +
      '<div style="margin-top:22px" id="topnotes">' + topNotes(I, 3) +
      /* the title gets the focus after a failed send (tabindex=-1, as in the reservation); one text, no toast on top */
      (P.err === "offline" ? note("bad", "warning-circle", errH(OFFLINE), "Поръчката ви е запазена: нищо не е изпратено и нищо не е изгубено. Опитайте пак или ни се обадете.", callBtn("pill pill-line")) : "") +
      (P.err === "server" ? note("bad", "warning-circle", errH("Поръчката не е изпратена"), esc(P.errMsg) + (/обадете/i.test(P.errMsg) ? "" : " Опитайте пак или ни се обадете."), callBtn("pill pill-line")) : "") +
      (P.err === "throttled" ? note("bad", "warning-circle", errH("Поръчката не е изпратена"), esc(P.errMsg)) : "") +
      (P.err === "form" ? '<div id="form-note">' + note("bad", "warning-circle", "Попълнете отбелязаните полета", "Името и телефонът са задължителни.") + "</div>" : "") + "</div>" +
      '<section class="blk"><div class="card recap"><div class="kv">' + where + '<button class="link" type="button" data-act="go" data-n="2">Промени</button></div>' +
      '<div class="kv"><span><small>Поръчка</small><b>' + dishWord(I.n) + " · " + fmt(I.total) + (I.feeUnknown ? " + доставка" : "") + '</b></span><button class="link" type="button" data-act="go" data-n="1">Промени</button></div></div></section>' +
      '<section class="blk" aria-labelledby="dh"><div class="blk-h"><h2 class="h3" id="dh">За връзка</h2></div><div class="form">' +
      fieldHTML("name", "Име", "text", 'autocomplete="name" placeholder="Например: Мария"', "", false) +
      fieldHTML("phone", "Телефон", "tel", 'autocomplete="tel" inputmode="tel" placeholder="0888 12 34 56"', "Само за тази поръчка: ще ви пратим SMS, когато " + (deliv ? "тръгне към вас." : "е готова."), false) +
      fieldHTML("email", "Имейл", "email", 'autocomplete="email" inputmode="email" placeholder="ime@primer.bg"', "За касовата бележка.", true) +
      fieldHTML("note", "Бележка към кухнята или шофьора", "textarea", 'rows="3" placeholder="Например: без прибори, звънецът не работи"', "", true) +
      '</div><div id="bonus-slot">' + bonusNote() + "</div></section>" +
      codeHTML(I) +
      '<section class="blk" aria-labelledby="ph"><div class="blk-h"><h2 class="h3" id="ph">Как ще платите?</h2><p class="muted small">При получаване</p></div><div class="opts" role="radiogroup" aria-labelledby="ph">' +
      pays.map((p) => '<label class="opt"><input type="radio" name="pay" value="' + p[0] + '" data-f="pay" data-fk="pay-' + p[0] + '"' + (D.pay === p[0] ? " checked" : "") + ">" + ic(p[1], 24) + "<span><b>" + p[2] + "</b><small>" + p[3] + "</small></span></label>").join("") +
      '</div><p class="legal">Не въвеждате карта онлайн. Плащате, когато получите поръчката.</p></section>' +
      '<section class="blk">' + (U && U.consent && U.consent.marketing
        ? '<div class="card consent"><p class="row" style="min-height:56px;margin:0">' + ic("check-circle", 22) + '<span>Вече получавате нашите оферти. Променя се от <a href="' + SC.url.profile() + '">профила</a>.</span></p></div>'
        : '<div class="card consent"><label class="check"><input type="checkbox" data-f="consent" data-fk="consent"' + (D.consent ? " checked" : "") + "><span><b>" + MKT_TITLE + "</b><span>" + MKT_SUB + "</span></span></label></div>") +
      '<p class="legal">С натискане на „Поръчай“ приемате <a href="' + SC.url.page("terms") + '">Общите условия</a>.</p></section>';
    return '<div class="ck"><div class="ck-grid"><div class="ck-main">' + h + '</div><div class="ck-side">' + summaryHTML(I, 3) + "</div></div>" + protoHTML("cart") + "</div>";
  }

  /* ---------- render ---------- */
  const STEP_OF: Record<string, number> = { "": 1, kolichka: 1, adres: 2, danni: 3 };
  let lastView = "", lastStep = 0;
  const hashStep = () => STEP_OF[location.hash.slice(1)] || 1;
  function replaceHash(h: string) { try { history.replaceState(history.state, "", location.href.split("#")[0] + (h ? "#" + h : "")); } catch { /* ignore */ } }
  function setHeader(view: string, step: number) {
    if (!hdrBack) return;
    /* steps 2 and 3: "Назад" is ONE button, in the bar next to the main one (as in every flow); the top bar keeps only the title.
       Step 1: "Меню" back to the menu. */
    const inFlow = view === "cart" && step > 1;
    hdrBack.style.display = inFlow ? "none" : "";
    hdrBack.innerHTML = ic("arrow-left", 20) + "Меню";
    hdrBack.setAttribute("href", SC.url.menu());
    hdrBack.dataset.back = "";
    if (hdrTitle) hdrTitle.textContent = "Количка"; /* one title on every step (site.review-consistency Д10) */
  }

  function render(opts: { keepScroll?: boolean } = {}) {
    if (P.placing) return;
    const ae = document.activeElement as HTMLElement | null;
    const fk = ae && ae.dataset ? ae.dataset.fk : undefined;
    let st = hashStep(), view: string, html: string;
    const I = info();
    if (P.loading) { view = "loading"; html = viewLoading(); }
    else if (!I.rows.length && !I.stale.length) { view = "empty"; html = viewEmpty(); if (location.hash) replaceHash(""); st = 1; }
    else {
      if (st >= 2 && !I.ok1) { st = 1; replaceHash(""); }
      if (st === 3 && !I.ok2) { st = 2; replaceHash("adres"); }
      if (st === 2 && I.mode === "pickup" && !D.slot && I.today && pickupToday(I).asap) D.slot = "asap";
      if (P.flash && P.flash.step !== st) P.flash = null;
      view = "cart"; html = st === 1 ? viewStep1(I) : st === 2 ? viewStep2(I) : viewStep3(I);
    }
    const changed = view + st !== lastView + lastStep;
    const top = window.scrollY;
    main.innerHTML = html;
    if (changed && view === "cart" && lastView === "cart") { const mn = main.querySelector(".ck-main"); if (mn) { mn.classList.add("enter"); if (st < lastStep) mn.classList.add("back"); } }
    if (!changed || opts.keepScroll) window.scrollTo(0, top); else window.scrollTo(0, 0);
    if (!changed) main.querySelectorAll(".bar .grow").forEach((b) => b.classList.remove("grow"));
    renderBar(view, st, I);
    setHeader(view, st);
    if (changed && lastView) { const h1 = main.querySelector<HTMLElement>(".ck-title"); h1 && h1.focus({ preventScroll: true }); }
    else if (fk) { const el = document.querySelector<HTMLElement>('[data-fk="' + fk.replace(/"/g, '\\"') + '"]'); el && el.focus({ preventScroll: true }); }
    lastView = view; lastStep = st;
    if (view === "cart" && st === 2) wireAddr();
  }
  function renderBar(view: string, st: number, I: Info) {
    if (view !== "cart") { bar.hidden = true; bar.innerHTML = ""; return; }
    bar.hidden = false;
    bar.innerHTML = (st > 1 ? '<button class="pill pill-soft back" type="button" data-act="go" data-n="' + (st - 1) + '">' + ic("arrow-left", 20) + "Назад</button>" : "") + ctaBtn(I, st, false);
  }
  /* refresh only the summary and the bar (keeps the caret in text fields) */
  function refreshSide() {
    const I = info(), st = hashStep(), side = main.querySelector(".ck-side");
    if (side && lastView === "cart") side.innerHTML = summaryHTML(I, st);
    renderBar(lastView, st, I);
  }

  /* forward steps push a history entry; going back pops it, so the phone's own "back" and our "Назад" agree */
  let pushed: number[] = [];
  function go(n: number) {
    const h = STEPS[n - 1][0], cur = hashStep();
    if (location.hash.slice(1) === h || (n === 1 && !location.hash)) { render(); return; }
    if (n < cur && pushed.length && pushed[pushed.length - 1] === cur && (pushed.length < 2 ? n === 1 : pushed[pushed.length - 2] === n)) { pushed.pop(); history.back(); return; }
    if (n > cur) pushed.push(n); else pushed = [];
    location.hash = h;
  }

  /* ---------- step 2: address combobox (sample addresses + the quarter parser for any typed address) ---------- */
  let aIdx = -1, aOpts: AddrOpt[] = [];
  function zoneSmall(n: string) { const z = n ? zoneByName(n) : null; return z ? (z.free ? "Безплатна доставка" : "Доставка по тарифа") : "Извън зоната ни"; }
  function addrOptions(q: string): { opts: AddrOpt[]; none: string } {
    const typed = q.trim(), r = zoneOfAddress(typed), opts: AddrOpt[] = [];
    if (r.type === "zone") opts.push({ a: typed, z: r.zone.n, hint: r.zone.n });
    else if (r.type === "ask") r.opts.forEach((z) => opts.push({ a: typed, z: z.n, hint: z.n }));
    else if (r.type === "out") opts.push({ a: typed, z: "" });
    findAddress(q).forEach((s) => { const a = s.a + ", София"; if (!opts.some((o) => o.a === a)) opts.push({ a, z: s.z }); });
    const none = r.type === "street" ? "Добавете и квартала, например „Дружба 2, бл. 311“, за да проверим зоната."
      : "Не намираме такъв адрес. Опитайте с квартал и блок, например „Дружба 2, бл. 311“.";
    return { opts: opts.slice(0, 6), none };
  }
  function wireAddr() {
    const inp = main.querySelector<HTMLInputElement>("#addr"), list = main.querySelector<HTMLElement>("#addr-list");
    if (!inp || !list) return;
    const paint = () => {
      const q = inp.value;
      if (q.trim().length < 2 || D.zk) { list.hidden = true; inp.setAttribute("aria-expanded", "false"); return; }
      const r = addrOptions(q); aOpts = r.opts;
      list.innerHTML = aOpts.length ? aOpts.map((a, k) => '<li role="option" id="ao-' + k + '" data-i="' + k + '" aria-selected="' + (k === aIdx) + '">' + ic("map-pin", 20) + "<span>" + esc(a.a) + (a.hint && a.a.toLowerCase().indexOf(a.hint.toLowerCase()) < 0 ? " · " + esc(a.hint) : "") + "<small>" + (a.z && !hasStreet(a.a) ? "Добавете улица или блок" : zoneSmall(a.z)) + "</small></span></li>").join("")
        : '<li class="none" role="option" aria-disabled="true">' + r.none + "</li>";
      list.hidden = false; inp.setAttribute("aria-expanded", "true");
      if (aIdx > -1 && aOpts.length) inp.setAttribute("aria-activedescendant", "ao-" + aIdx); else inp.removeAttribute("aria-activedescendant");
    };
    inp.addEventListener("input", () => { D.addr = inp.value; D.zone = ""; D.zk = ""; aIdx = -1; if (P.needStreet && hasStreet(inp.value)) P.needStreet = ""; save(); const res = main.querySelector("#addr-res"); if (res) res.innerHTML = P.needStreet ? streetNote() : ""; paint(); refreshSide(); });
    inp.addEventListener("keydown", (e) => {
      const n = list.querySelectorAll("li[data-i]").length;
      if (e.key === "ArrowDown" && n) { e.preventDefault(); aIdx = (aIdx + 1) % n; paint(); }
      else if (e.key === "ArrowUp" && n) { e.preventDefault(); aIdx = aIdx <= 0 ? n - 1 : aIdx - 1; paint(); }
      else if (e.key === "Enter") { e.preventDefault(); const pick = aIdx > -1 ? aOpts[aIdx] : n === 1 ? aOpts[0] : null; if (pick) pickAddr(pick); else autoResolve(); }
      else if (e.key === "Escape") { list.hidden = true; inp.setAttribute("aria-expanded", "false"); }
    });
    list.addEventListener("mousedown", (e) => { const li = (e.target as Element).closest<HTMLElement>("li[data-i]"); if (li) { e.preventDefault(); pickAddr(aOpts[+li.dataset.i!]); } });
    if (D.addr && !D.zk && !P.needStreet) paint(); /* right after "НПЗ Искър" was picked the list waits for the street */
  }
  function pickAddr(o: AddrOpt | undefined, then?: () => void) {
    if (!o) return;
    /* the quarter alone ("НПЗ Искър", "кв. Бусманци"): the core refuses it, so ask for the street or block right here */
    if (o.z && !hasStreet(o.a)) {
      D.addr = o.a.replace(/,?\s*София\s*$/i, "").replace(/[,\s]+$/, "") + ", "; D.zone = ""; D.zk = ""; P.needStreet = o.z; aIdx = -1; save();
      render({ keepScroll: true });
      const inp = main.querySelector<HTMLInputElement>("#addr");
      if (inp) { inp.focus({ preventScroll: true }); inp.setSelectionRange(inp.value.length, inp.value.length); }
      main.querySelector("#addr-res")?.scrollIntoView({ block: "nearest", behavior: smooth() });
      return;
    }
    P.needStreet = "";
    D.addr = o.a; D.zone = o.z; const z = o.z ? zoneByName(o.z) : null; D.zk = z ? (z.free ? "free" : "paid") : "out"; aIdx = -1; save();
    (document.activeElement as HTMLElement | null)?.blur();
    P.checking = true; render({ keepScroll: true });
    setTimeout(() => { P.checking = false; render({ keepScroll: true }); const r = main.querySelector("#addr-res"); r && r.scrollIntoView({ block: "nearest", behavior: smooth() }); if (then) then(); }, SC.reduce ? 0 : 450);
  }
  /* "Към данните" with a typed address that was never picked: resolve it when the parser is sure */
  function autoResolve(then?: () => void): boolean {
    if (!D.addr || D.zk) return false;
    const r = zoneOfAddress(D.addr);
    if (r.type === "zone") { pickAddr({ a: D.addr.trim(), z: r.zone.n }, then); return true; }
    if (r.type === "out") { pickAddr({ a: D.addr.trim(), z: "" }); return true; }
    return false;
  }

  /* ---------- step 3: validation ---------- */
  function validate() {
    const e: Record<string, string | undefined> = {}, ph = String(D.phone || "").replace(/[\s\-()/]/g, "");
    if (!String(D.name || "").trim()) e.name = "Напишете име, за да знаем кого да търсим.";
    if (!ph) e.phone = "Напишете телефон, за да ви се обадим при нужда.";
    else if (!/^(0\d{9}|\+359\d{9})$/.test(ph)) e.phone = "Проверете номера: 10 цифри, започва с 0. Например: 0888 12 34 56.";
    if (D.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(D.email).trim())) e.email = "Проверете имейла. Например: ime@primer.bg.";
    return e;
  }
  function showErr(id: string) {
    const e = P.errs[id], inp = main.querySelector("#f-" + id), p = main.querySelector<HTMLElement>("#e-" + id);
    if (!inp || !p) return;
    if (e) { inp.setAttribute("aria-invalid", "true"); p.hidden = false; p.innerHTML = ic("warning-circle", 18) + esc(e); }
    else { inp.removeAttribute("aria-invalid"); p.hidden = true; p.innerHTML = ""; }
  }
  /* the top "Попълнете отбелязаните полета" goes with the same check that clears the messages under the fields */
  function formNoteGone() {
    if (P.err !== "form" || ["name", "phone", "email"].some((k) => P.errs[k])) return;
    P.err = ""; main.querySelector("#form-note")?.remove();
  }
  const scrollToEl = (el: Element | null) => el && el.scrollIntoView({ block: "center", behavior: smooth() });

  /* ---------- the discount code ---------- */
  async function applyCode(): Promise<boolean> {
    const v = P.codeTxt.trim();
    if (P.codeBusy) return false;
    if (!v) { P.errs.code = "Напишете кода, например SC10-4829163057."; render({ keepScroll: true }); main.querySelector<HTMLElement>("#f-code")?.focus({ preventScroll: true }); return false; }
    P.codeBusy = true; P.errs.code = undefined; render({ keepScroll: true });
    try {
      const r = await api.codes.check(v);
      D.code = r.code; D.codePct = r.pct; P.codeTxt = ""; save();
      return true;
    } catch (e) {
      P.errs.code = e instanceof ApiError ? (e.fields && e.fields.code) || e.message : "Не успяхме да проверим кода. Опитайте пак.";
      return false;
    } finally {
      P.codeBusy = false; render({ keepScroll: true });
      if (P.errs.code) main.querySelector<HTMLElement>("#f-code")?.focus({ preventScroll: true });
    }
  }

  /* the order can no longer be for now (22:30 passed / before 10:00): an order for later, the time is chosen again */
  function toLater(I: Info, msg: string) {
    setSched(I.m < 600 ? "днес" : "утре");
    P.flash = { step: 2, kind: "info", title: esc(msg), text: "Количката и данните ви са запазени. Изберете час за " + (D.sched === "утре" ? "утре, " + tomorrowLabel() : "днес") + "." };
    go(2);
  }
  /* delivery was chosen, but it is after 21:00 now: never switch to pickup silently */
  function deliveryClosed() {
    P.flash = { step: 1, kind: "bad", title: "Доставката приключи за днес в 21:00", text: "Поръчки за вземане до 22:30, готови най-късно в 23:00. Нищо не е изпратено.",
      acts: '<button class="pill pill-ink" type="button" data-act="mode" data-v="pickup">' + ic("storefront", 20) + "Вземи от място</button>" };
    go(1);
  }

  async function submit() {
    if (P.sending) return;
    const I0 = info();
    /* the hour may have changed while the person typed (step 3 is not redrawn under the fingers) */
    if (I0.today && SC.cart.get().mode === "delivery" && I0.mode !== "delivery") { deliveryClosed(); return; }
    if (I0.closed) { toLater(I0, I0.m < 600 ? "Кухнята отваря в 10:00" : "Кухнята вече не приема поръчки за днес"); return; }
    P.errs = { ...validate(), code: P.errs.code };
    const bad = ["name", "phone", "email"].filter((k) => P.errs[k]);
    if (!bad.length && P.err === "form") P.err = ""; /* name and phone are fine now: the old "Попълнете…" note goes */
    if (bad.length) { P.err = "form"; render({ keepScroll: true }); const f = main.querySelector<HTMLElement>("#f-" + bad[0]); if (f) { f.focus({ preventScroll: true }); scrollToEl(f); } return; }
    if (P.offline || (!api.demo && navigator.onLine === false)) { P.err = "offline"; render({ keepScroll: true }); focusErr(); return; }
    /* a code typed but not applied: check it first, show the new sum, and let the person press again */
    if (!D.code && P.codeTxt.trim()) {
      const ok = await applyCode();
      if (ok) { const I1 = info(); SC.toast(I1.discKind === "code" ? "Кодът е приложен: -" + fmt(I1.disc) + ". Натиснете „Поръчай“ отново." : "Обедната отстъпка е по-изгодна. Кодът остава за следващата поръчка."); }
      else scrollToEl(main.querySelector("#f-code"));
      return;
    }
    P.err = ""; P.sending = true; render({ keepScroll: true });
    const I = info(), deliv = I.mode === "delivery";
    try {
      const o = await api.orders.create({
        /* sold-out lines are shown as "Не се брои" and are not sent (the core refuses them with sold_out) */
        cart: { ...SC.cart.get(), lines: SC.cart.lines().filter((l) => { const x = SC.byId[l.id]; return !x || !(SC.isOut(x) || (x.lunch && I.stale.length)); }), mode: I.mode },
        zone: deliv ? D.zone : undefined,
        addr: deliv ? D.addr + (D.addrMore ? ", " + D.addrMore : "") : undefined,
        pay: D.pay, name: String(D.name).trim(), phone: D.phone,
        email: D.email ? String(D.email).trim() : undefined, note: D.note ? String(D.note).trim() : undefined,
        marketing: D.consent === true, sched: D.sched, slot: D.slot || "asap",
        /* only when the code is what makes the price (with the lunch -30% the code stays for the next order) */
        code: D.code && I.discKind === "code" ? D.code : undefined,
      });
      P.placing = true;
      SC.store("sc-order", o); /* the tracking page can show it at once, before it asks the API */
      SC.cart.clear(); D.slot = ""; D.sched = ""; D.schedFor = ""; D.note = ""; if (o.discKind === "code") { D.code = ""; D.codePct = 0; } save();
      location.href = SC.url.tracking(o);
    } catch (e) {
      P.sending = false;
      if (e instanceof ApiError) { if (onApiError(e)) return; P.err = "server"; P.errMsg = e.message; }
      else { P.err = "server"; P.errMsg = "Нещо се обърка. Опитайте пак."; }
      render({ keepScroll: true }); focusErr();
    }
  }

  /* every error code of the core, as text for a person, on the step where it can be fixed. true = handled */
  function onApiError(e: ApiError): boolean {
    const I = info();
    switch (e.code) {
      case "offline": P.err = "offline"; render({ keepScroll: true }); focusErr(); return true;
      case "invalid": {
        const f = e.fields || {};
        if (f.code) { D.code = ""; D.codePct = 0; save(); }
        P.errs = { ...P.errs, name: f.name, phone: f.phone, email: f.email, code: f.code };
        if (f.addr) { D.zk = ""; save(); P.err = ""; P.flash = { step: 2, kind: "bad", title: "Проверете адреса", text: esc(f.addr) }; go(2); return true; }
        if (f.slot) { D.slot = ""; save(); P.err = ""; P.flash = { step: 2, kind: "bad", title: "Изберете час отново", text: esc(f.slot) + " Свободните часове вече са други." }; go(2);
          setTimeout(() => { const t = main.querySelector<HTMLElement>(".opts input, .slots .slot:not([disabled])"); if (t) { scrollToEl(t); t.focus({ preventScroll: true }); } }, 60); return true; }
        const first = ["name", "phone", "email", "code"].find((k) => f[k]);
        if (!first) return false;
        P.err = f.name || f.phone || f.email ? "form" : ""; render({ keepScroll: true });
        const el = main.querySelector<HTMLElement>("#f-" + first); if (el) { el.focus({ preventScroll: true }); scrollToEl(el); }
        if (first === "code") SC.toast(f.code!);
        return true;
      }
      case "delivery_closed": P.err = ""; deliveryClosed(); return true;
      case "closed": P.err = ""; toLater(I, e.message.replace(/ Поръчайте .*$/, "")); return true;
      case "bad_sched": P.err = ""; setSched(""); P.flash = { step: 1, kind: "info", title: "Кухнята вече работи", text: "Поръчката може да е за сега. Изберете отново как да я получите." }; go(1); return true;
      case "lunch_stale": case "lunch_delivery": case "lunch_sched":
        P.err = ""; P.flash = { step: 1, kind: "warn", title: esc(e.message), acts: '<button class="pill pill-line" type="button" data-act="rmlunch">' + ic("trash", 20) + "Махни обедните ястия</button>" }; go(1); return true;
      case "too_big":
        P.err = ""; go(1); return true; /* step 1 shows the limit with the phone (the cart itself is over it) */
      case "throttled":
        P.err = "throttled"; P.errMsg = e.message; render({ keepScroll: true }); focusErr(); return true;
      case "sold_out": case "unknown_item": case "bad_qty": case "bad_mod": case "too_many": case "empty":
        P.err = ""; P.flash = { step: 1, kind: "warn", title: "Проверете количката", text: esc(e.message) }; SC.toast(e.message); go(1); return true;
    }
    return false;
  }

  /* ---------- preview: sample cart from the real menu ---------- */
  function fillDemo() {
    SC.cart.clear();
    SC.cart.add("pitsa-dyavolo", 1, { mods: ["без лук", "+ Кашкавал"], extra: SC.byId["kashkaval"] ? SC.byId["kashkaval"].p : 0 });
    SC.cart.add("svinski-rebra", 1);
    if (SC.byId["l-lazanya-boloneze"]) SC.cart.add("l-lazanya-boloneze", 2);
    SC.cart.add("parzheni-kartofi", 1);
  }

  function removeLine(key: string) {
    const idx = SC.cart.lines().findIndex((l) => l.key === key);
    const gone = SC.cart.remove(key);
    if (!gone) return;
    const x = SC.byId[gone.id];
    SC.toast(x && x.n.length <= 22 ? "Махнахте: " + x.n : "Махнахте ястието", () => {
      const c = SC.cart.get(); c.lines = c.lines.slice(); c.lines.splice(Math.min(idx, c.lines.length), 0, gone); SC.cart.mode(c.mode);
    });
  }

  /* ---------- events ---------- */
  document.addEventListener("click", (e) => {
    const tg = e.target as Element;
    const b = tg.closest<HTMLElement>("[data-act]");
    if (!b) { const hb = tg.closest<HTMLElement>(".top.back > a.hb"); if (hb && hb.dataset.back) { e.preventDefault(); go(+hb.dataset.back); } return; }
    if (!main.contains(b) && !bar.contains(b)) return;
    const a = b.dataset.act, key = b.dataset.key || "";
    if (a === "go" || a === "next" || a === "mode" || a === "rmlunch") P.flash = null;
    if (a === "go") { go(+b.dataset.n!); return; }
    if (a === "next") {
      const I = info(), n = +b.dataset.n!;
      /* the person goes on with what the screen shows (after 21:00 that is pickup): keep the cart's mode the same */
      if ((n === 1 || n === 2) && !I.closed && SC.cart.get().mode !== I.mode) SC.cart.mode(I.mode);
      if (n === 1) {
        if (I.closed) { setSched(I.m < 600 ? "днес" : "утре"); go(2); return; }
        if (!I.ok1) { const w = main.querySelector(".note.warn"); if (w) { scrollToEl(w); w.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }); } SC.toast(I.n ? "Първо изберете как да я получите" : "Добавете ястие от менюто"); return; }
        go(2); return;
      }
      if (n === 2) {
        /* a typed address the parser is sure of: check it and go on in the same press (one press, not two) */
        if (!I.ok2 && autoResolve(() => { if (info().ok2) go(3); })) return;
        if (!I.ok2) {
          SC.toast(I.mode === "delivery" ? (D.zk === "out" ? "Този адрес е извън зоната ни" : P.needStreet ? "Добавете улица или блок" : "Изберете адрес от списъка") : "Изберете час за вземане");
          const t = main.querySelector<HTMLElement>(I.mode === "delivery" ? (D.zk && D.zk !== "out" ? ".slots" : "#addr") : ".opts input, .slots .slot:not([disabled])");
          if (t) { scrollToEl(t); t.focus({ preventScroll: true }); }
          return;
        }
        go(3); return;
      }
      if (n === 3) { submit(); return; }
      return;
    }
    if (a === "mode") { SC.cart.mode(b.dataset.v === "pickup" ? "pickup" : "delivery"); return; }
    if (a === "inc") { const l = SC.cart.lines().find((z) => z.key === key); if (l) SC.cart.setQty(key, l.q + 1); return; }
    if (a === "dec") { const l = SC.cart.lines().find((z) => z.key === key); if (!l) return; if (l.q > 1) SC.cart.setQty(key, l.q - 1); else removeLine(key); return; }
    if (a === "rm") { removeLine(key); return; }
    if (a === "swap") { const l = SC.cart.lines().find((z) => z.key === key), nx = SC.byId[b.dataset.id || ""]; if (!l || !nx) return; SC.cart.remove(key); SC.cart.add(nx.id, l.q); SC.toast("Готово, сменихме го"); return; }
    if (a === "rmlunch") {
      const before = SC.cart.lines().slice(), c = SC.cart.get();
      c.lines = c.lines.filter((z) => { const x = SC.byId[z.id]; return !(x && x.lunch); }); SC.cart.mode(c.mode);
      SC.toast("Махнахме обедните ястия", () => { SC.cart.get().lines = before; SC.cart.mode(SC.cart.get().mode); });
      return;
    }
    if (a === "slot") { D.slot = b.dataset.v || ""; save(); render({ keepScroll: true }); return; }
    if (a === "code-apply") { applyCode(); return; }
    if (a === "code-rm") { D.code = ""; D.codePct = 0; P.errs.code = undefined; save(); render({ keepScroll: true }); main.querySelector<HTMLElement>("#f-code")?.focus({ preventScroll: true }); return; }
    if (a === "allslots") { P.allSlots = true; render({ keepScroll: true }); return; }
    if (a === "addr-sample") { const s = SAMPLE_ADDRESSES[+b.dataset.i!]; if (s) pickAddr({ a: s[0] + ", София", z: s[1] }); return; }
    if (a === "addr-clear") { P.needStreet = ""; D.addr = ""; D.zone = ""; D.zk = ""; save(); render({ keepScroll: true }); main.querySelector<HTMLElement>("#addr")?.focus(); return; }
    /* preview switches */
    if (a === "demo") { fillDemo(); if (location.hash) location.hash = "kolichka"; SC.toast("Готово: примерна количка"); return; }
    if (a === "clear") { SC.cart.clear(); return; }
    if (a === "addout") { SC.cart.add("pleskavitsa", 1); SC.toast("Добавено: изчерпано ястие"); if (hashStep() !== 1) go(1); setTimeout(() => scrollToEl(main.querySelector(".ln.out")), 60); return; }
    if (a === "loading") { P.loading = true; render(); setTimeout(() => { P.loading = false; lastView = ""; render(); }, 1600); return; }
    if (a === "offline") { P.offline = !P.offline; if (!P.offline && P.err === "offline") P.err = ""; render({ keepScroll: true }); return; }
  });
  main.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.actR === "asap") { D.slot = "asap"; save(); render({ keepScroll: true }); return; }
    const f = t.dataset.f;
    if (!f) return;
    if (f === "consent") { D.consent = t.checked; return; }
    if (f === "pay") { D.pay = t.value as Pay; save(); return; }
  });
  main.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement, f = t.dataset.f as keyof Draft | undefined;
    if (t.id === "f-code") { P.codeTxt = t.value; if (P.errs.code) { P.errs.code = undefined; showErr("code"); } return; }
    if (!f || f === "consent" || f === "pay") return;
    (D as unknown as Record<string, string>)[f] = t.value; save();
    if (P.errs[f]) { const v = validate(); P.errs[f] = v[f]; showErr(f); formNoteGone(); }
    if (f === "phone" && P.me && P.me.bonus) { refreshSide(); const b = main.querySelector("#bonus-slot"); if (b) b.innerHTML = bonusNote(); }
  });
  main.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).id === "f-code" && e.key === "Enter") { e.preventDefault(); applyCode(); }
  });
  main.addEventListener("focusout", (e) => {
    const t = e.target as HTMLInputElement, f = t.dataset && t.dataset.f;
    if (!f || !/^(name|phone|email)$/.test(f)) return;
    if (!String(t.value).trim() && f !== "email") return; /* do not scold an empty field the person only passed through */
    const v = validate(); P.errs[f] = v[f]; showErr(f); formNoteGone();
  });

  SC.cart.on(() => render());
  window.addEventListener("hashchange", () => render());
  window.addEventListener("online", () => { P.offline = false; if (P.err === "offline") P.err = ""; render({ keepScroll: true }); });
  window.addEventListener("offline", () => { P.offline = true; render({ keepScroll: true }); });
  /* the hour changes the rules (21:00 delivery, 15:00 lunch, 22:30 kitchen): redraw, but never under the fingers in a form */
  document.addEventListener("sc:tick", () => {
    if (lastView && hashStep() !== 3 && !P.sending) { render({ keepScroll: true }); return; }
    /* step 3: the form is not redrawn, except when the order itself can no longer be what the person chose */
    const I = info();
    if (lastView === "cart" && hashStep() === 3 && !P.sending) {
      if (I.today && SC.cart.get().mode === "delivery" && I.mode !== "delivery") { deliveryClosed(); return; }
      if (I.closed) { toLater(I, I.m < 600 ? "Кухнята отваря в 10:00" : "Кухнята вече не приема поръчки за днес"); return; }
    }
    refreshSide();
  });
  if (navigator.onLine === false) P.offline = true;
  /* the profile bonus: at once from what this browser knows, then from the API (the core is the judge) */
  if (U) {
    const u0 = U as { profileBonus?: boolean; phone?: string };
    if (u0.profileBonus && u0.phone) P.me = { bonus: true, phone: normPhone(String(u0.phone)) || String(u0.phone) };
    api.auth.me().then((me) => {
      const nx = me && me.profileBonus ? { bonus: true, phone: normPhone(String(me.phone)) || String(me.phone) } : null;
      if (JSON.stringify(nx) !== JSON.stringify(P.me)) { P.me = nx; if (hashStep() === 3) { refreshSide(); const b = main.querySelector("#bonus-slot"); if (b) b.innerHTML = bonusNote(); } else render({ keepScroll: true }); }
    }).catch(() => { /* offline: keep what we know, the core decides at the order */ });
  }
  render();
}
