/* Order tracking (/porachka/<номер>/, demo: porachka/index.html#<номер>): port of design/pages/tracking.html
   (design/PAGES.md "tracking.html"). The browser part: the order is read with api.orders.get(no) and follows
   api.on("order.status") live (SSE on the server, BroadcastChannel in the demo). Status comes from the order,
   the minutes from its promised time (eta + ts). The prototype panel (simulated states) lives only behind SC.preview. */
import { SC } from "../../client/sc-menu.ts";
import { api, ApiError } from "../../client/api.ts";
import type { Order, OrderLine, OrderStatus } from "../../core/types.ts";
import "../../lib/icons/receipt.ts";
import "../../lib/icons/chef-hat.ts";
import "../../lib/icons/shopping-bag.ts";
import "../../lib/icons/moped.ts";
import "../../lib/icons/house.ts";
import "../../lib/icons/storefront.ts";
import "../../lib/icons/share-network.ts";
import "../../lib/icons/map-pin.ts";
import "../../lib/icons/warning-circle.ts";
import "../../lib/icons/bell-ringing.ts";
import "../../lib/icons/bell.ts";
import "../../lib/icons/check-circle.ts";
import "../../lib/icons/copy.ts";
import "../../lib/icons/google-logo.ts";
import "../../lib/icons/arrow-up-right.ts";
import "../../lib/icons/thumbs-up.ts";
import "../../lib/icons/thumbs-down.ts";
import "../../lib/icons/paper-plane-right.ts";
import "../../lib/icons/seal-percent.ts";
import "../../lib/icons/info.ts";
import "../../lib/icons/clock.ts";
import "../../lib/icons/fork-knife.ts";
import "../../lib/icons/hourglass.ts";
import "../../lib/icons/sliders-horizontal.ts";
import "../../lib/icons/arrow-right.ts";
import "../../lib/icons/arrow-left.ts";
import "../../lib/icons/calendar-check.ts";
import "../../lib/icons/pencil-simple.ts";
import "../../lib/icons/arrow-clockwise.ts";

type View = "loading" | "order" | "notfound" | "none" | "error";
type Stage = { id: "acc" | "cook" | "ready" | "way" | "done"; nm: string; ic: string };
type Rated = { happy: boolean; code: string; google: string | null; fbSent?: boolean };

const R = SC.RESTAURANT;
const TEL = "tel:" + R.phoneIntl;
const ic = (n: string, s?: number) => SC.ic(n, s);
const esc = SC.esc;
const clock = (min: number) => SC.hhmm((((Math.round(min) % 1440) + 1440) % 1440));
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? +m[1] * 60 + +m[2] : null; };

export function startTracking(main: HTMLElement) {
  /* ---------- the number: /porachka/1042/ on the server, porachka/index.html#1042 in the demo ---------- */
  const tok: Record<string, boolean> = {};
  let hashNo: string | null = null;
  location.hash.slice(1).split("-").forEach((t) => { if (/^\d{1,9}$/.test(t)) hashNo = t; else if (t) tok[decodeURIComponent(t)] = true; });
  const pathNo = (/\/porachka\/([^/]+)\/?$/.exec(location.pathname) || [])[1];
  const fromPath = pathNo && pathNo !== "index.html" ? decodeURIComponent(pathNo) : null;
  /* preview tokens (#delivered, #late ...) only in preview / the demo, like the prototype */
  const P = SC.preview ? tok : {};

  const saved = SC.load<Order | null>("sc-order", null);
  const S = {
    no: (fromPath || hashNo || (saved && saved.no ? String(saved.no) : "")) as string,
    view: "loading" as View,
    o: null as Order | null,
    offline: navigator.onLine === false,
    updated: SC.minutes(),
    rating: null as Rated | null, choice: null as "yes" | "no" | null, fb: "", fbErr: "", sending: false,
    notify: null as string | null, ch: "push",
    first: true,
    sim: { k: null as number | null, late: !!P.late, sched: !!P.tomorrow, sample: false },
  };
  if (P.offline) S.offline = true;

  /* ---------- per-order memory in this browser (rating answer and chosen notifications) ---------- */
  const memKey = () => "sc-track-" + S.no;
  function loadMem() { const m = SC.load<{ rating?: Rated; notify?: string | null }>(memKey(), {}); S.rating = m.rating || null; S.choice = S.rating ? (S.rating.happy ? "yes" : "no") : null; S.notify = m.notify || null; }
  function saveMem() { SC.store(memKey(), { rating: S.rating, notify: S.notify }); }

  /* ---------- the order model ---------- */
  const o = () => S.o as Order;
  const isD = () => o().mode === "delivery";
  function stages(): Stage[] {
    const a: Stage[] = [{ id: "acc", nm: "Приета", ic: "receipt" }];
    if (!o().lunchOnly) a.push({ id: "cook", nm: "Готви се", ic: "chef-hat" });
    if (isD()) a.push({ id: "ready", nm: "Готова", ic: "shopping-bag" }, { id: "way", nm: "На път", ic: "moped" }, { id: "done", nm: "Доставена", ic: "house" });
    else a.push({ id: "ready", nm: "Готова за вземане", ic: "storefront" });
    return a;
  }
  const STAGE_OF: Record<OrderStatus, Stage["id"] | "fin" | "x"> = { accepted: "acc", cooking: "cook", ready: "ready", on_way: "way", delivered: "done", picked_up: "fin", cancelled: "x" };
  /** index of the current stage; for pickup "picked_up" = stages().length (all done) */
  function k(): number {
    if (S.sim.k != null) return S.sim.k;
    const a = stages(), id = STAGE_OF[o().status];
    if (id === "fin") return a.length;
    if (id === "x") return 0;
    const i = a.findIndex((s) => s.id === id);
    return i < 0 ? 0 : i; /* "cooking" on a lunch-only order stays on "Приета" */
  }
  function finished() { const n = stages().length; return isD() ? k() >= n - 1 : k() >= n; }
  const cur = () => { const a = stages(); return a[Math.min(k(), a.length - 1)]; };
  const cancelled = () => o().status === "cancelled" && S.sim.k == null;

  /* time: minutes since the order (real ms since ts), the promised minutes, the start on the shop clock */
  function elapsed() { const e = (Date.now() - (o().ts || Date.now())) / 60000; return Math.max(0, e); }
  function placed() { const p = toMin(o().placedAt); return p != null ? p : SC.minutes() - elapsed(); }
  /** a pre-order ("утре" / later "днес"): the date and minute it is for, and the minutes left until then */
  function schedInfo() {
    const x = o();
    if (!(x.sched || S.sim.sched)) return null;
    const at = toMin(x.at) ?? (S.sim.sched ? 19 * 60 : null);
    if (at == null) return null;
    const d = new Date(x.ts || Date.now());
    if (x.sched === "утре" || (S.sim.sched && !x.sched)) d.setDate(d.getDate() + 1);
    d.setHours(Math.floor(at / 60), at % 60, 0, 0);
    const left = (d.getTime() - Date.now()) / 60000;
    return { at, date: d, left, tomorrow: d.toDateString() !== new Date().toDateString() };
  }
  /** promised minutes from the order start (eta), or from the chosen hour of a pre-order */
  function total(): number { const sc = schedInfo(); if (sc) return Math.max(0, elapsed() + sc.left); return Math.max(0, o().eta ?? 35); }
  /* when each step started, minutes after the order (spread over the promised time, as in the prototype) */
  function offs(): Record<string, number> {
    const T = total(), L = o().lunchOnly;
    return isD() ? { acc: 0, cook: 1, ready: Math.round(T * (L ? 0.3 : 0.55)), way: Math.round(T * (L ? 0.4 : 0.65)), done: T }
      : { acc: 0, cook: Math.max(1, T - 18), ready: T };
  }
  const stepAt = (id: string) => placed() + Math.min(offs()[id] ?? 0, elapsed());
  /** minutes left and how late we are (0 = on time) */
  function remaining(): { m: number; late: number } {
    const add = S.sim.late ? 10 : 0;
    const left = total() - elapsed();
    if (S.sim.late) return { m: Math.max(1, Math.round(left)) + add, late: add };
    if (left >= 1) return { m: Math.round(left), late: 0 };
    if ((o().eta ?? 1) === 0) return { m: 5, late: 0 }; /* pickup "веднага" */
    return { m: 5, late: Math.max(5, Math.ceil(-left / 5) * 5) };
  }
  const mainDish = () => {
    const ls = o().lines.map((l) => SC.byId[l.id]).filter(Boolean);
    return ls.find((x) => x.cat === "pitsi") || ls.find((x) => x.course === "main") || ls[0];
  };
  function cookSay() { const m = mainDish(); if (m && m.cat === "pitsi") return "Пицата е в пещта"; if (m && m.cat === "skara-bertha") return "Месото е във фурната Bertha"; return "Готвим поръчката ви"; }
  const lineSum = (l: OrderLine) => { const x = SC.byId[l.id]; const unit = l.unit ?? (x ? x.p + (l.extra || 0) : 0); return Math.round(unit * l.q * 100) / 100; };

  /* ---------- ring around the plate: one arc per step, starting and ending at the badge ---------- */
  function ringSVG() {
    const a = stages(), n = a.length, gap = n > 3 ? 15 : 13, step = 360 / n, done = finished(), r = 92, K = k();
    const pt = (deg: number) => { const t = ((deg - 90) * Math.PI) / 180; return (100 + r * Math.cos(t)).toFixed(2) + " " + (100 + r * Math.sin(t)).toFixed(2); };
    let out = "";
    for (let i = 0; i < n; i++) {
      const s = 180 + i * step + gap / 2, e = 180 + (i + 1) * step - gap / 2;
      const cls = done || i < K ? "on" : i === K ? "now" : "off";
      out += '<path class="' + cls + '" d="M' + pt(s) + " A" + r + " " + r + " 0 " + (e - s > 180 ? 1 : 0) + " 1 " + pt(e) + '"/>';
    }
    return '<svg class="ring" viewBox="0 0 200 200" aria-hidden="true">' + out + "</svg>";
  }

  /* ---------- blocks ---------- */
  function timelineHTML() {
    const a = stages(), done = finished(), K = k(), sc = schedInfo();
    return '<div class="tlw"><span class="track" aria-hidden="true"><span class="fill" data-fill></span></span><ol class="tl n' + a.length + '" aria-label="Етапи на поръчката">' +
      a.map((s, i) => {
        const st = done || i < K ? "done" : i === K ? "now" : "next";
        const tm = st === "done" ? clock(s.id === "acc" ? placed() : stepAt(s.id)) : st === "now" ? (sc && s.id === "acc" ? clock(placed()) : "Сега") : "";
        return '<li class="' + st + '"' + (st === "now" ? ' aria-current="step"' : "") + '><span class="dot">' + (st === "done" ? ic("check", 16) : "") + '</span><span class="nm">' + s.nm + '</span><span class="tm">' + (tm || "&nbsp;") + '</span><span class="vh">' + (st === "done" ? "готово" : st === "now" ? "сега" : "предстои") + "</span></li>";
      }).join("") + "</ol></div>";
  }
  function heroHTML() {
    const D = isD(), done = finished(), c = cur(), sc = schedInfo(), BUSY = SC.eta().busy;
    let label: string, big: string, say: string, sub: string, note = "", late = 0;
    const badgeIc = done ? "check" : sc && c.id === "acc" ? "calendar-check" : c.ic;
    if (done) {
      const doneAt = S.sim.k != null ? SC.minutes() : toMin(SC.hhmm(new Date(o().updatedAt))) ?? SC.minutes();
      label = D ? "Доставена в" : "Взехте я в";
      big = '<span class="enum clock"><b>' + clock(doneAt) + "</b></span>";
      say = "Добър апетит!"; sub = "Благодарим, че поръчахте от нас.";
    } else if (sc && c.id === "acc" && sc.left > 45) {
      /* pre-order: "Приета за <ден, час>" (docs/OPEN-QUESTIONS.md) */
      label = "Приета за " + (sc.tomorrow ? "утре, " : "днес, ") + SC.dateLong(sc.date);
      big = '<span class="enum clock"><b>' + clock(sc.at) + "</b></span>";
      say = D ? "Ще я доставим за този час" : "Ще е готова за този час";
      sub = sc.left > 60 ? "Можете да я промените до " + clock(sc.at - 60) + " (1 час преди часа)." : "Вече я подготвяме. За промяна се обадете на " + esc(R.phone) + ".";
    } else if (!D && c.id === "ready") {
      label = "Готова от"; big = '<span class="enum clock"><b>' + clock(stepAt("ready")) + "</b></span>";
      say = "Поръчката ви е готова"; sub = "Чакаме ви в ресторанта. Вземане до " + R.kitchen + ".";
    } else {
      const r = remaining(), arrive = clock(SC.minutes() + r.m);
      late = r.late;
      label = D ? "Пристига след" : "Готова след";
      big = '<span class="enum"><span class="ab">около</span><b>' + r.m + '</b><span class="u">мин</span></span>';
      say = c.id === "acc" ? "Получихме поръчката ви" : c.id === "cook" ? cookSay() : c.id === "ready" ? "Поръчката е готова" : "Шофьорът е на път към вас";
      if (late) sub = "Съжаляваме, кухнята е натоварена. Новото време е около " + arrive + ".";
      else if (c.id === "way") sub = "Пристига около " + arrive + '. Плащате при получаване: <span class="price">' + SC.fmt(o().total) + "</span>.";
      else if (c.id === "ready") sub = "Тръгва към вас до минута. Пристига около " + arrive + ".";
      else sub = D ? "Очакваме да пристигне около " + arrive + "." : "Ще е готова около " + arrive + ".";
      if (o().lunchOnly && (c.id === "acc" || c.id === "ready")) note = '<p class="hnote">' + ic("info", 18) + "<span>Обедното меню е приготвено предварително, затова пропуска етапа „Готви се“.</span></p>";
      else if (BUSY && !late && (c.id === "acc" || c.id === "cook")) note = '<p class="hnote">' + ic("info", 18) + "<span>Кухнята е натоварена в момента, затова времето е малко по-дълго.</span></p>";
    }
    const dish = mainDish();
    const cls = "shell hero" + (c.id === "cook" && !done ? " is-cook" : "") + (done ? " is-done" : "") + (late && !done ? " is-late" : "") + (S.offline ? " is-off" : "") + (S.first ? " enter" : "");
    const modeChip = D ? '<span class="mode">' + ic("moped", 20) + "Доставка</span>" : '<span class="mode">' + ic("storefront", 20) + "Вземане от място</span>";
    return '<div class="' + cls + '" data-hero>' +
      '<div class="core"><div class="hrow">' + modeChip + '<button class="hb" type="button" data-share>' + ic("share-network", 20) + "Сподели</button></div>" +
      '<div class="hgrid"><div class="viz">' + ringSVG() + (dish ? SC.pic(dish, "plate") : "") + '<span class="vb" aria-hidden="true">' + ic(badgeIc, 26) + "</span></div>" +
      '<div class="etxt" aria-live="polite">' + (late && !done ? '<span class="latechip">' + ic("clock", 18) + "Закъснява с около " + late + " мин</span>" : "") +
      '<span class="elab">' + label + "</span>" + big + '<h2 class="say">' + say + '</h2><p class="sub">' + sub + "</p></div></div>" +
      "</div>" + timelineHTML() + note + "</div>";
  }
  function actsHTML() {
    const sc = schedInfo(), canChange = !!sc && k() === 0 && sc.left > 60;
    const change = canChange ? '<button class="pill pill-line pill-lg pill-block" type="button" data-change>' + ic("pencil-simple", 20) + "Промени</button>" : "";
    const route = !isD() ? '<a class="pill pill-line pill-lg pill-block" href="' + R.maps + '" target="_blank" rel="noopener">' + ic("map-pin", 20) + "Маршрут до ресторанта</a>" : "";
    return '<div class="acts">' + change + '<a class="pill pill-line pill-lg pill-block" href="' + TEL + '" aria-label="Обади се в ресторанта на ' + R.phone + '">' + ic("phone", 20) + "Обади се в ресторанта</a>" + route + "</div>";
  }
  function offlineHTML() {
    if (!S.offline) return "";
    return '<div class="banner" role="alert">' + ic("warning-circle", 24) + "<div><b>Няма връзка с интернет</b><p>Показваме последното, което знаем (от " + clock(S.updated) + '). Поръчката ви си върви и ще обновим сами, щом връзката се върне.</p><button class="pill pill-ink" type="button" data-retry>' + ic("arrow-clockwise", 18) + "Опитай пак</button></div></div>";
  }
  function notifyHTML() {
    const D = isD();
    if (finished() || (!D && cur().id === "ready")) return "";
    const title = D ? "Да ви кажем, когато е близо?" : "Да ви кажем, когато е готова?";
    const text = D ? "Ще получите съобщение, когато поръчката тръгне и когато е на 10 мин от вас." : "Ще получите съобщение, щом поръчката е готова за вземане.";
    if (S.notify) {
      const where = S.notify === "push" ? "Ще получите известие на този телефон." : S.notify === "sms" ? "Ще ви пишем по SMS на номера от поръчката." : "Ще ви пишем във Viber на номера от поръчката.";
      const miss = S.notify === "push" ? "" : '<span class="missing small">[ЛИПСВА: доставчик на ' + (S.notify === "sms" ? "SMS" : "Viber") + " съобщения]</span>";
      return '<div class="shell"><div class="core cpad cgap"><div class="okline">' + ic("check-circle", 26) + "<div><b>Известията са включени</b><span>" + where + "</span>" + miss + '</div></div><button class="link change" type="button" data-notify-off>Изключи известията</button></div></div>';
    }
    const btn = S.ch === "push" ? "Включи известията" : S.ch === "sms" ? "Пиши ми по SMS" : "Пиши ми във Viber";
    return '<div class="shell"><div class="core cpad cgap">' +
      '<div class="card-h"><span class="nic">' + ic("bell-ringing", 24) + "</span><div><h2>" + title + "</h2><p>" + text + "</p></div></div>" +
      '<div class="seg" role="group" aria-label="Как да ви пишем">' + [["push", "Известие"], ["sms", "SMS"], ["viber", "Viber"]].map((x) => '<button type="button" data-ch="' + x[0] + '" aria-pressed="' + (S.ch === x[0]) + '">' + x[1] + "</button>").join("") + "</div>" +
      '<button class="pill pill-red pill-lg pill-block" type="button" data-notify>' + ic("bell", 20) + btn + "</button>" +
      (S.ch === "push" ? '<p class="small muted" style="margin:0">На iPhone известията работят, ако сайтът е добавен на началния екран.</p>' : "") +
      "</div></div>";
  }
  function codeHTML() {
    const code = S.rating ? S.rating.code : "";
    return '<div class="code ember-card"><span class="k">Вашият код за -10% от следващата поръчка</span><div class="row"><span class="v">' + esc(code) + '</span><button class="pill pill-ink" type="button" data-copy>' + ic("copy", 18) + "Копирай кода</button></div><p>Въведете го в количката при следващата поръчка. Един код на телефонен номер.</p></div>";
  }
  function googleHref() { return (S.rating && S.rating.google) || R.googleReview || ""; }
  function googleMiss() { return googleHref() ? "" : '<span class="missing small">[ЛИПСВА: линк към профила в Google]</span>'; }
  function gAttrs() { const h = googleHref(); return h ? 'href="' + esc(h) + '" target="_blank" rel="noopener"' : 'href="#" data-google'; }
  function rateHTML() {
    if (!finished()) return "";
    const r = S.choice;
    let ans = "";
    if (S.sending) ans = '<div class="ans"><p class="muted">' + ic("hourglass", 18) + " Записваме отговора...</p></div>";
    else if (r === "yes" && S.rating) ans = '<div class="ans"><h3 tabindex="-1" data-focus>Благодарим! Радваме се, че ви хареса.</h3>' + codeHTML() +
      '<div class="gq"><p><b>Ще ни помогнете ли с отзив в Google?</b><br><span class="muted">Така и съседите ви ще ни намерят <span style="white-space:nowrap">по-лесно</span>.</span></p><a class="pill pill-line pill-lg pill-block" ' + gAttrs() + ">" + ic("google-logo", 20) + "Напиши отзив в Google" + ic("arrow-up-right", 18) + "</a>" + googleMiss() + "</div>" +
      '<button class="link change" type="button" data-rate-reset>Промени отговора</button></div>';
    else if (r === "no" && S.rating) ans = '<div class="ans"><h3 tabindex="-1" data-focus>Съжаляваме. Благодарим, че ни казвате.</h3>' +
      (S.rating.fbSent ? '<div class="fbsent">' + ic("check-circle", 22) + '<span><b>Изпратихме го на управителя.</b><br><span class="muted">Ще го прочете лично.</span></span></div>'
        : '<div class="field"><label for="fb">Споделете с нас как бихме могли да подобрим вашето преживяване</label><textarea class="input" id="fb" rows="4" maxlength="2000" aria-describedby="fbh' + (S.fbErr ? " fbe" : "") + '"' + (S.fbErr ? ' aria-invalid="true"' : "") + ">" + esc(S.fb) + '</textarea><span class="help" id="fbh">Стига само до управителя.</span>' + (S.fbErr ? '<span class="err" id="fbe">' + esc(S.fbErr) + "</span>" : "") + "</div>" +
          '<button class="pill pill-red pill-lg pill-block" type="button" data-fb>' + ic("paper-plane-right", 20) + "Изпрати на управителя</button>") +
      codeHTML() +
      '<p class="muted">Ако желаете, можете да оставите и отзив в Google.</p><div><a class="link" ' + gAttrs() + ">" + ic("google-logo", 20) + "Отзив в Google" + ic("arrow-up-right", 16) + "</a><br>" + googleMiss() + "</div>" +
      '<button class="link change" type="button" data-rate-reset>Промени отговора</button></div>';
    return '<div class="shell rate" data-rate><div class="core cpad"><span class="offer">' + ic("seal-percent", 18) + '-10% за оценката</span><h2 id="rate-h">Останахте ли доволни?</h2><p class="lead">От храната и ' + (isD() ? "доставката" : "обслужването") + ". За отговора ви даваме -10% от следващата поръчка, каквото и да изберете.</p>" +
      '<div class="yn" role="group" aria-labelledby="rate-h"><button type="button" data-rate="yes" aria-pressed="' + (r === "yes") + '">' + ic("thumbs-up", 26) + 'Да</button><button type="button" data-rate="no" aria-pressed="' + (r === "no") + '">' + ic("thumbs-down", 26) + "Не</button></div>" + ans + "</div></div>";
  }
  function modsHTML(l: OrderLine) {
    if (!l.mods || !l.mods.length) return "";
    return '<span class="mods">' + l.mods.map((md) => { const add = /^\+/.test(md); let t = md.replace(/^\+\s*/, ""); t = t.charAt(0).toUpperCase() + t.slice(1); return '<span class="mod' + (add ? " add" : "") + '">' + (add ? ic("plus", 14) : "") + esc(t) + "</span>"; }).join("") + "</span>";
  }
  function orderHTML() {
    const x = o(), D = isD();
    const rows = x.lines.map((l) => {
      const d = SC.byId[l.id];
      return '<div class="oline">' + (d ? SC.pic(d) : '<span class="pic"></span>') + '<span><span class="nm">' + esc(d ? d.n : l.name || "") + '</span><span class="q">' + l.q + " бр." + (d && d.g ? " · " + esc(d.g) : "") + "</span>" + modsHTML(l) + '</span><span class="price">' + SC.fmt(lineSum(l)) + "</span></div>";
    }).join("");
    const fee = x.fee === 0 ? "безплатна" : x.fee == null ? 'по тарифа <span class="missing">[ЛИПСВА: такса]</span>' : SC.fmt(x.fee);
    const kv = (D ? '<div class="kv"><span>Доставка до</span><span>' + esc(x.zone || "") + " · " + fee + "</span></div>"
      : '<div class="kv"><span>Вземане от</span><span>Siracusa, Дружба 2</span></div>') +
      (x.disc ? '<div class="kv disc"><span>Отстъпка след 15:00</span><span class="price">-' + SC.fmt(x.disc) + "</span></div>" : "") +
      '<div class="kv"><span>Плащане</span><span>' + esc(x.payLabel || "В брой") + "</span></div>" +
      '<div class="kv tot"><span>Общо</span><span class="price">' + SC.fmt(x.total) + "</span></div>";
    const sub = x.lines.reduce((a, l) => a + lineSum(l), 0);
    const again = finished() ? '<button class="pill pill-line pill-lg pill-block" type="button" data-again style="margin-top:12px">' + ic("plus", 20) + "Поръчай същото · " + SC.fmt(sub) + "</button>" : "";
    return '<div class="shell"><div class="core cpad"><div class="sec-h" style="margin-bottom:4px"><h2 class="h3">Вашата поръчка</h2><span class="muted small">' + SC.plural(x.lines.reduce((a, l) => a + l.q, 0), "ястие", "ястия") + "</span></div>" + rows +
      '<div class="okv" style="margin-top:6px;border-top:1px solid var(--line);padding-top:6px">' + kv + "</div>" + again + "</div></div>";
  }
  function protoHTML() {
    if (!SC.preview) return "";
    const has = S.view === "order" && S.o, D = has && isD();
    return '<section class="proto" aria-label="Само в прототипа"><p class="ptag">' + ic("sliders-horizontal", 18) + "Само в прототипа</p>" +
      '<div class="pbtns">' +
      (has ? '<button class="pill pill-soft" type="button" data-sim="next"' + (finished() ? " disabled" : "") + ">" + ic("arrow-right", 18) + "Следващ етап</button>" +
        '<button class="pill pill-ink" type="button" data-sim="done">' + ic("check", 18) + "Симулирай: " + (D ? "доставена" : "взета") + "</button>" +
        '<button class="pill pill-soft" type="button" data-sim="late" aria-pressed="' + S.sim.late + '">' + ic("clock", 18) + (S.sim.late ? "Без закъснение" : "Закъснение") + "</button>" +
        '<button class="pill pill-soft" type="button" data-sim="sched" aria-pressed="' + S.sim.sched + '">' + ic("calendar-check", 18) + (S.sim.sched ? "Не е за утре" : "За утре") + "</button>" +
        '<button class="pill pill-soft" type="button" data-sim="offline">' + ic("warning-circle", 18) + (S.offline ? "Върни връзката" : "Без интернет") + "</button>" : "") +
      '<button class="pill pill-soft" type="button" data-sim="sample">' + ic("receipt", 18) + "Примерна поръчка</button>" +
      '<button class="pill pill-soft" type="button" data-sim="loading">' + ic("hourglass", 18) + "Зареждане</button>" +
      '<button class="pill pill-soft" type="button" data-sim="notfound">' + ic("question", 18) + "Грешен номер</button>" +
      '<button class="pill pill-soft" type="button" data-sim="none">' + ic("receipt", 18) + "Без поръчка</button>" +
      '<button class="pill pill-soft" type="button" data-sim="reset">' + ic("arrow-left", 18) + "Отначало</button>" +
      '</div><p class="help">Етапите тук се сменят само на този екран. В истинския сайт ги сменят кухнята и шофьорът, а въпросът „Останахте ли доволни?“ идва и като известие 40 мин след доставката.</p></section>';
  }
  const titleHTML = () => '<div class="trk-title"><h1>Поръчка <span class="no">№ ' + esc(S.no) + "</span></h1></div>";

  /* the live state sits in the shared status row (next to the cart) */
  const row2 = document.querySelector(".row2"), liveBox = document.createElement("div");
  liveBox.className = "status trk-live"; liveBox.setAttribute("role", "status"); liveBox.hidden = true;
  if (row2) row2.insertBefore(liveBox, row2.firstChild);
  function liveUpdate() {
    liveBox.hidden = S.view !== "order" || !S.o;
    if (liveBox.hidden) return;
    liveBox.innerHTML = S.offline ? '<span class="live off"><i></i></span><span><b>Без връзка</b> · последно в ' + clock(S.updated) + "</span>"
      : cancelled() ? '<span class="live off"><i></i></span><span><b>Отказана</b> · поръчка № ' + esc(S.no) + "</span>"
      : finished() ? '<span class="live"><i class="still"></i></span><span><b>' + (isD() ? "Доставена" : "Взета") + "</b> · поръчка № " + esc(S.no) + "</span>"
      : '<span class="live"><i></i></span><span><b>На живо</b> · обновено в ' + clock(S.updated) + "</span>";
  }

  /* ---------- other views ---------- */
  function skeletonHTML() {
    return '<div class="trk-title"><h1 class="vh">Проследяване на поръчка</h1><span class="skel" style="width:220px;height:32px"></span></div><div class="trk" aria-busy="true" aria-label="Зареждаме поръчката"><div class="trk-l"><div class="shell"><div class="core sk">' +
      '<span class="skel" style="width:100%;height:40px;border-radius:999px"></span><span class="skel" style="width:196px;height:196px;border-radius:50%"></span><span class="skel" style="width:52%;height:18px"></span><span class="skel" style="width:46%;height:64px"></span><span class="skel" style="width:70%;height:24px"></span></div>' +
      '<div class="skrow">' + [1, 2, 3, 4, 5].map(() => '<span class="skel" style="width:28px;height:28px;border-radius:50%"></span>').join("") + '</div></div><span class="skel" style="height:56px;border-radius:999px"></span></div>' +
      '<div class="trk-r"><div class="shell"><div class="core cpad cgap"><span class="skel" style="width:60%;height:24px"></span><span class="skel" style="height:56px"></span><span class="skel" style="height:56px"></span></div></div></div></div>';
  }
  function stateHTML(kind: View) {
    const call = '<a class="pill pill-red pill-lg pill-block" href="' + TEL + '">' + ic("phone", 20) + "Обади се в ресторанта</a>";
    if (kind === "notfound") return '<div class="shell"><div class="core empty state err"><span class="ill">' + ic("warning-circle", 44) + '</span><h1 class="h2">Не намираме поръчка № ' + esc(S.no) + "</h1><p>Може връзката да е непълна. Обадете ни се и ще ви кажем докъде е поръчката.</p>" +
      '<div class="acts">' + call + '<button class="pill pill-line pill-lg pill-block" type="button" data-retry>' + ic("arrow-clockwise", 20) + "Опитай пак</button></div></div></div>";
    if (kind === "error") return '<div class="shell"><div class="core empty state err"><span class="ill">' + ic("warning-circle", 44) + '</span><h1 class="h2">Не успяхме да заредим поръчка № ' + esc(S.no) + "</h1><p>" + (S.offline ? "Няма връзка с интернет. Ще опитаме сами, щом връзката се върне." : "Опитайте пак след малко или ни се обадете.") + "</p>" +
      '<div class="acts"><button class="pill pill-red pill-lg pill-block" type="button" data-retry>' + ic("arrow-clockwise", 20) + 'Опитай пак</button><a class="pill pill-line pill-lg pill-block" href="' + TEL + '">' + ic("phone", 20) + "Обади се в ресторанта</a></div></div></div>";
    const closed = !SC.state().kitchen;
    return '<div class="shell"><div class="core empty state"><span class="ill">' + ic("receipt", 44) + '</span><h1 class="h2">Нямате поръчка в момента</h1>' +
      "<p>" + (closed ? "Кухнята приема поръчки до 22:30. Поръчай за утре?" : "Щом поръчате, тук ще виждате на кой етап е поръчката и кога пристига.") + "</p>" +
      '<div class="acts"><a class="pill pill-red pill-lg pill-block" href="' + SC.url.menu() + '">' + ic("fork-knife", 20) + (closed ? "Поръчай за утре" : "Към менюто") + "</a></div></div></div>";
  }
  function cancelledHTML() {
    return '<div class="shell"><div class="core empty state err"><span class="ill">' + ic("warning-circle", 44) + '</span><h2 class="h2">Поръчката е отказана</h2><p>Съжаляваме. Обадете ни се и ще ви кажем какво се е случило.</p><div class="acts"><a class="pill pill-red pill-lg pill-block" href="' + TEL + '">' + ic("phone", 20) + "Обади се в ресторанта</a></div></div></div>";
  }

  /* ---------- render ---------- */
  let lastFill = 0;
  function render() {
    let html: string;
    if (S.view === "loading") html = skeletonHTML() + protoHTML();
    else if (S.view !== "order" || !S.o) html = '<div class="trk"><div class="trk-l">' + stateHTML(S.view) + '</div><div class="trk-r">' + protoHTML() + "</div></div>";
    else if (cancelled()) html = titleHTML() + '<div class="trk"><div class="trk-l">' + cancelledHTML() + '</div><div class="trk-r">' + orderHTML() + protoHTML() + "</div></div>";
    else html = titleHTML() + '<div class="trk"><div class="trk-l">' + offlineHTML() + heroHTML() + actsHTML() + '</div><div class="trk-r">' + rateHTML() + notifyHTML() + orderHTML() + protoHTML() + "</div></div>";
    main.innerHTML = '<section class="sec trk-s">' + html + "</section>";
    if (S.view === "order" && S.o) S.first = false;
    liveUpdate();
    placeTrack();
  }
  /* the track runs from the first dot to the last; the fill grows to the current dot (transform only) */
  function placeTrack() {
    const tl = main.querySelector<HTMLElement>(".tlw"); if (!tl) return;
    const dots = tl.querySelectorAll(".tl .dot"), tr = tl.querySelector<HTMLElement>(".track")!, fill = tl.querySelector<HTMLElement>("[data-fill]")!;
    if (dots.length < 2) return;
    const b = tl.getBoundingClientRect(), f = dots[0].getBoundingClientRect(), l = dots[dots.length - 1].getBoundingClientRect();
    const x0 = f.left + f.width / 2 - b.left, x1 = l.left + l.width / 2 - b.left;
    tr.style.left = x0 + "px"; tr.style.right = b.width - x1 + "px";
    const idx = Math.min(k(), dots.length - 1), d = dots[idx].getBoundingClientRect(), p = (d.left + d.width / 2 - b.left - x0) / (x1 - x0 || 1);
    fill.style.transition = "none"; fill.style.transform = "scaleX(" + lastFill + ")"; void fill.offsetWidth; fill.style.transition = "";
    requestAnimationFrame(() => { fill.style.transform = "scaleX(" + p + ")"; });
    lastFill = p;
  }
  if ("ResizeObserver" in window) new ResizeObserver(() => { const fl = main.querySelector<HTMLElement>("[data-fill]"); if (fl) { fl.style.transition = "none"; placeTrack(); } }).observe(document.querySelector(".device") || document.body);

  function stepText() {
    const c = cur(), D = isD();
    if (finished()) return D ? "Поръчката е доставена" : "Добър апетит!";
    return c.id === "cook" ? cookSay() : c.id === "ready" ? (D ? "Поръчката е готова" : "Поръчката ви е готова") : c.id === "way" ? "Поръчката тръгна към вас" : "Получихме поръчката ви";
  }
  function focusRate() {
    const h = main.querySelector<HTMLElement>("[data-focus]"); if (h) h.focus({ preventScroll: true });
    const r = main.querySelector("[data-rate]"); if (r) r.scrollIntoView({ block: "start", behavior: SC.reduce ? "auto" : "smooth" });
  }
  /* a step changed: toast, and a system notification if the visitor switched them on and is looking elsewhere */
  function announce() {
    const t = stepText();
    SC.toast(t);
    if (S.notify === "push" && document.hidden && "Notification" in window && Notification.permission === "granted") {
      try { new Notification("Поръчка № " + S.no + " · Siracusa", { body: t, tag: "sc-order-" + S.no }); } catch { /* not allowed here */ }
    }
    if (finished()) setTimeout(focusRate, 450);
  }

  /* ---------- data ---------- */
  function sample(): Order {
    const st = SC.state(), D = st.delivery, m = SC.minutes();
    const pz = SC.inCat("pitsi").filter((x) => !SC.isOut(x)), pick = pz.find((x) => x.t.includes("hit")) || pz[0];
    const sal = SC.inCat("salati").filter((x) => !SC.isOut(x))[0];
    const lines: OrderLine[] = [pick && { id: pick.id, q: 2, mods: [], extra: 0, name: pick.n, unit: pick.p }, sal && { id: sal.id, q: 1, mods: [], extra: 0, name: sal.n, unit: sal.p }].filter(Boolean) as OrderLine[];
    const sub = Math.round(lines.reduce((a, l) => a + (l.unit || 0) * l.q, 0) * 100) / 100;
    const now = new Date().toISOString();
    return { id: S.no || "1042", no: S.no || "1042", mode: D ? "delivery" : "pickup", channel: "web", lines, lunchOnly: false, zone: D ? SC.ZONES[1].n : "", addr: "", pay: "cash", payLabel: "В брой",
      sub, disc: 0, fee: D ? 0 : null, total: sub, eta: D ? 35 : 20, at: clock(m + (D ? 32 : 17)), sched: "", placedAt: clock(m - 3), ts: Date.now() - 3 * 60000, status: "cooking",
      name: "", phone: "", marketing: false, createdAt: now, updatedAt: now };
  }
  function fromSaved(): Order | null {
    return saved && String(saved.no) === S.no && Array.isArray(saved.lines) ? saved : null;
  }
  let loading = false;
  async function load(opts: { quiet?: boolean } = {}) {
    if (!S.no) { S.view = "none"; render(); return; }
    if (S.sim.sample) return;
    if (loading) return;
    loading = true;
    const before = S.o ? k() : -1, wasFinished = S.o ? finished() : false;
    try {
      const x = (await api.orders.get(S.no)) as Order | null;
      if (!x) throw new ApiError("not_found", "Няма такава поръчка.", 404);
      S.o = Object.assign({}, S.o || fromSaved() || {}, x) as Order;
      if (saved && String(saved.no) === S.no) SC.store("sc-order", Object.assign({}, saved, x));
      S.offline = !!P.offline; S.updated = SC.minutes(); S.view = "order";
      render();
      if (opts.quiet && before > -1 && (k() !== before || finished() !== wasFinished)) announce();
    } catch (e) {
      const err = e as ApiError;
      if (err && err.code === "not_found") { S.o = null; S.view = "notfound"; }
      else if (S.o) S.offline = true;
      else { S.offline = err?.code === "offline" || navigator.onLine === false; S.view = "error"; }
      render();
    } finally { loading = false; }
  }

  /* ---------- interactions ---------- */
  main.addEventListener("click", async (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button, a"); if (!t) return;
    const ds = t.dataset;
    if (t.hasAttribute("data-share")) {
      const link = new URL(SC.url.tracking(S.no), location.href).href;
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      if (nav.share) nav.share({ title: "Поръчка № " + S.no + " от Siracusa", url: link }).catch(() => {});
      else { try { navigator.clipboard.writeText(link).catch(() => {}); } catch { /* no clipboard */ } SC.toast("Връзката е копирана"); }
      return;
    }
    if (ds.sim) {
      const kk = ds.sim;
      if (kk === "next" && S.o) { const n = stages().length; S.sim.k = Math.min(k() + 1, isD() ? n - 1 : n); S.updated = SC.minutes(); render(); announce(); return; }
      if (kk === "done" && S.o) { const n = stages().length; S.sim.k = isD() ? n - 1 : n; render(); announce(); return; }
      if (kk === "late") { S.sim.late = !S.sim.late; if (finished()) S.sim.k = 1; render(); return; }
      if (kk === "sched") { S.sim.sched = !S.sim.sched; S.sim.k = 0; lastFill = 0; render(); return; }
      if (kk === "offline") { S.offline = !S.offline; if (!S.offline) { S.updated = SC.minutes(); SC.toast("Връзката се върна"); } render(); return; }
      if (kk === "sample") { S.sim.sample = true; if (!S.no) S.no = "1042"; S.o = sample(); S.sim.k = null; S.view = "order"; S.first = true; lastFill = 0; loadMem(); render(); return; }
      if (kk === "loading") { const v = S.view; S.view = "loading"; render(); setTimeout(() => { S.view = v === "loading" ? "order" : v; S.first = true; render(); }, 1600); return; }
      if (kk === "notfound" || kk === "none") { S.view = kk; render(); window.scrollTo(0, 0); return; }
      if (kk === "reset") { S.sim = { k: null, late: false, sched: false, sample: false }; S.offline = false; S.first = true; lastFill = 0; S.view = "loading"; render(); window.scrollTo(0, 0); load(); return; }
    }
    if (t.hasAttribute("data-retry")) {
      if (navigator.onLine === false && !P.offline) { SC.toast("Още няма връзка"); return; }
      const wasOff = S.offline; S.offline = false;
      if (S.view === "order" && S.o && P.offline) { S.updated = SC.minutes(); render(); SC.toast("Връзката се върна"); return; }
      S.view = S.o ? "order" : "loading"; render(); await load(); if (wasOff && !S.offline) SC.toast("Връзката се върна"); return;
    }
    if (t.hasAttribute("data-change")) {
      const sc = schedInfo(); if (!sc) return;
      SC.sheet({ title: "Промяна на поръчката", html:
        '<div style="display:grid;gap:14px"><p style="margin:0">Час, ястия или адрес: промени приемаме по телефона до <b>' + clock(sc.at - 60) + "</b>, 1 час преди часа на поръчката.</p>" +
        '<a class="pill pill-red pill-lg pill-block" href="' + TEL + '">' + ic("phone", 20) + "Обади се на " + esc(R.phone) + "</a>" +
        '<p class="small muted" style="margin:0">Кажете номера на поръчката: № ' + esc(S.no) + ".</p></div>" });
      return;
    }
    if (ds.ch) { S.ch = ds.ch; render(); const b = main.querySelector<HTMLElement>('[data-ch="' + S.ch + '"]'); b && b.focus({ preventScroll: true }); return; }
    if (t.hasAttribute("data-notify")) {
      const btn = t as HTMLButtonElement; btn.disabled = true; btn.innerHTML = ic("hourglass", 20) + "Включваме...";
      if (S.ch === "push") {
        if (!("Notification" in window)) { btn.disabled = false; render(); SC.toast("Този браузър не показва известия"); return; }
        let perm: NotificationPermission = Notification.permission;
        try { if (perm === "default") perm = await Notification.requestPermission(); } catch { /* old API */ }
        if (perm !== "granted") { render(); SC.toast("Известията са спрени в браузъра"); return; }
      }
      S.notify = S.ch; saveMem(); render(); SC.toast("Известията са включени"); return;
    }
    if (t.hasAttribute("data-notify-off")) { S.notify = null; saveMem(); render(); return; }
    if (ds.rate) {
      const happy = ds.rate === "yes";
      S.choice = happy ? "yes" : "no";
      if (S.rating && S.rating.happy === happy) { render(); main.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true }); return; }
      S.sending = true; render();
      try {
        const r = (await api.ratings.submit({ orderNo: S.no, happy })) as { code: string; google: string | null };
        /* one code per order in this browser: a changed answer keeps the first code */
        S.rating = { happy, code: S.rating ? S.rating.code : r.code, google: r.google, fbSent: false };
        saveMem();
      } catch (err) {
        S.choice = S.rating ? (S.rating.happy ? "yes" : "no") : null;
        SC.toast(err instanceof ApiError ? err.message : "Не успяхме да запишем отговора. Опитайте пак.");
      }
      S.sending = false; render();
      main.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true });
      return;
    }
    if (t.hasAttribute("data-rate-reset")) { S.choice = null; S.fbErr = ""; render(); main.querySelector<HTMLElement>('[data-rate="yes"]')?.focus({ preventScroll: true }); return; }
    if (t.hasAttribute("data-fb")) {
      const ta = main.querySelector<HTMLTextAreaElement>("#fb"); S.fb = ta ? ta.value : S.fb;
      if (S.fb.trim().length < 3) { S.fbErr = "Напишете няколко думи, за да го изпратим."; render(); main.querySelector<HTMLElement>("#fb")?.focus(); return; }
      S.fbErr = ""; (t as HTMLButtonElement).disabled = true;
      try {
        await api.ratings.submit({ orderNo: S.no, happy: false, text: S.fb.trim() });
        if (S.rating) S.rating.fbSent = true; saveMem(); S.fb = ""; render(); SC.toast("Изпратихме го на управителя");
      } catch (err) { (t as HTMLButtonElement).disabled = false; SC.toast(err instanceof ApiError ? err.message : "Не успяхме да го изпратим. Опитайте пак."); }
      return;
    }
    if (t.hasAttribute("data-copy")) { try { navigator.clipboard.writeText(S.rating ? S.rating.code : "").catch(() => {}); } catch { /* no clipboard */ } SC.flash(t, ic("check", 18) + "Копирано", 1400); return; }
    if (t.hasAttribute("data-google")) { e.preventDefault(); SC.toast("Линкът към профила в Google още липсва"); return; }
    if (t.hasAttribute("data-again") && S.o) {
      o().lines.forEach((l, i) => {
        const d = SC.byId[l.id]; if (!d || SC.isOut(d)) return;
        SC.cart.add(l.id, l.q, { mods: l.mods, extra: l.extra, p: l.unit ?? d.p + (l.extra || 0), n: d.n });
        setTimeout(() => SC.fly(t, l.id), i * 120);
      });
      SC.flash(t, ic("check", 20) + "Добавено в количката", 1600);
      return;
    }
  });
  main.addEventListener("input", (e) => {
    const ta = e.target as HTMLTextAreaElement;
    if (ta.id === "fb") { S.fb = ta.value; if (S.fbErr && S.fb.trim().length >= 3) { S.fbErr = ""; ta.removeAttribute("aria-invalid"); main.querySelector("#fbe")?.remove(); } }
  });
  window.addEventListener("offline", () => { S.offline = true; if (S.view === "order") render(); });
  window.addEventListener("online", () => { if (S.offline) { S.offline = false; load({ quiet: true }).then(() => { if (!S.offline) SC.toast("Връзката се върна"); }); } });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && S.view === "order" && !S.sim.sample) load({ quiet: true }); });
  /* the minutes count down with the clock */
  document.addEventListener("sc:tick", () => { if (S.view === "order" && S.o && !S.offline) { S.updated = SC.minutes(); render(); } });
  /* live: the kitchen / driver changed the status */
  api.on("order.status", (d) => {
    const x = d as { no: string | number; status: OrderStatus };
    if (!S.o || String(x.no) !== S.no || S.sim.sample) return;
    S.sim.k = null; load({ quiet: true });
  });

  /* ---------- start ---------- */
  /* demo: keep the number in the address so "Сподели" and a reload work */
  if (!fromPath && !hashNo && S.no && SC.demo) history.replaceState(null, "", SC.url.tracking(S.no));
  else if (!fromPath && !hashNo && S.no && !SC.demo) history.replaceState(null, "", SC.url.tracking(S.no) + location.search);
  loadMem();
  if (P.notfound) { S.view = "notfound"; render(); return; }
  if (P.none) { S.view = "none"; render(); return; }
  if (P.sample) { S.sim.sample = true; if (!S.no) S.no = "1042"; S.o = sample(); S.view = "order"; }
  else { const s = fromSaved(); if (s) { S.o = s; S.view = "order"; } }
  if (S.o) {
    if (P.pickup) S.o.mode = "pickup";
    if (P.delivery) S.o.mode = "delivery";
    if (P.delivered || P.done) { const n = stages().length; S.sim.k = isD() ? n - 1 : n; }
    if (P.way && isD()) S.sim.k = stages().length - 2;
  }
  if (P.loading) { render(); setTimeout(() => { S.view = S.o ? "order" : "none"; render(); }, 1600); return; }
  render();
  if (!S.sim.sample) load({ quiet: !!S.o });
}
