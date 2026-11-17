/* Siracusa · Собственик: историята (минали дни). Един генератор с ../pages-admin/reports.html: същото rng, същите семена
   ("pop" + id, "day" + ден), същият ред на извикванията, затова един и същи период дава едно и също число тук и в „Отчети“ на админа.
   Зарежда се след ../pages-admin/_admin.js, _seed-orders.js, _res-lib.js, _seed-res.js.
   - Днес: от sa-orders (A.orders(), без отказаните) и sa-reservations, като в отчетите; сумата е цените от менюто + добавките - кода -10%.
   - Резервациите за последните 30 дни: от sa-reservations; по-старите дни са примерни.
   - Допълненията (плащане, нови клиенти, времена, оферти, гориво) са с отделни семена, за да не мърдат числата на отчетите.
   Всичко минало е „Примерни данни“: истинските ястия и цени, примерни бройки.
   H.day(k), H.agg(a, b), H.range(per, cust), H.prevRange(a, b, per), H.yearRange(a, b), H.cutAt(o, h, m), H.usual(k, n), H.extra(k), H.fuel(k) */
(function(){
"use strict";
var A = window.A; if (!A || !A.rl) return;
var H = window.H = {};
var TODAY = A.rl.today();
H.TODAY = TODAY;
function parse(k){ var p = k.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 10)); }
function ymd(d){ return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0"); }
function addD(k, n){ var d = parse(k); d.setUTCDate(d.getUTCDate() + n); return ymd(d); }
function span(a, b){ return Math.round((parse(b) - parse(a)) / 864e5) + 1; }
H.parse = parse; H.ymd = ymd; H.addD = addD; H.span = span;
H.dow = function(k){ return parse(k).getUTCDay(); };
H.fd = function(k, short){ return A.fmtDate(parse(k), short); };

/* ---------- генераторът от reports.html (без промени в реда на rng) ---------- */
function rng(seed){ var s = 0; for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0; return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
H.rng = rng;
var POOL = SC.items.filter(function(x){ return ["dobavki","sosove","hlebcheta"].indexOf(x.cat) < 0 && !x.per100; });
var POP = POOL.map(function(x, i){ var r = rng("pop" + x.id)(); return Math.pow(r, 3) + (x.t.indexOf("hit") > -1 ? .6 : 0); }), POPS = POP.reduce(function(a, b){ return a + b; }, 0);
function pick(r){ var t = r() * POPS; for (var i = 0; i < POOL.length; i++){ t -= POP[i]; if (t <= 0) return POOL[i]; } return POOL[0]; }
/* каналите на отчетите: [име, икона, дял] (ядрото ги смята като Сайт / Телефон / Маса / Офис; Сайт = Доставка + Вземане) */
var CH = [["Доставка","truck",.42],["Вземане","storefront",.23],["Маса","chair",.30],["Офис","briefcase",.05]];
H.CH = CH;
var cache = {};
var ADD = {}; SC.inCat("dobavki").forEach(function(x){ ADD["+ " + x.n] = x.p; });
var CHI = {delivery:0, pickup:1, table:2, office:3};
var RES = A.data.get("reservations", null);
function orderSum(o){ var sub = (o.lines || []).reduce(function(s, l){ var x = SC.byId[l.id]; return s + (x ? (x.p + (l.mods || []).reduce(function(m, k){ return m + (ADD[k] || 0); }, 0)) * (l.q || 1) : 0); }, 0);
  return sub - (o.code ? Math.round(sub * 10) / 100 : 0); }
H.orderSum = orderSum;
function resOf(d, k){ if (!RES || k < A.rl.addDays(TODAY, -30)) return false; var L = RES.filter(function(r){ return r.date === k; });
  d.res = L.filter(function(r){ return ["cancelled","waitlist"].indexOf(r.status) < 0; }).length; d.ns = L.filter(function(r){ return r.status === "no_show"; }).length; return true; }
/* днешните поръчки; H.todayFilter (само в прототипа, състояние „Отклонение“) може да скрие част от тях */
H.todayFilter = null;
H.todayOrders = function(){ var O = A.orders ? A.orders() : []; return H.todayFilter ? O.filter(H.todayFilter) : O; };
function liveToday(d){ var O = H.todayOrders(); d.cancelled = 0;
  O.forEach(function(o){ if (o.status === "cancelled"){ d.cancelled++; return; } var tot = orderSum(o), c = CHI[o.channel] != null ? CHI[o.channel] : 1, hh = A.sofia(new Date(o.ts)).h;
    d.orders++; d.rev += tot; d.ch[c].o++; d.ch[c].rev += tot; d.hour[hh] = (d.hour[hh] || 0) + 1; d.hrev[hh] = (d.hrev[hh] || 0) + tot;
    var ids = [];
    (o.lines || []).forEach(function(l){ if (SC.byId[l.id]){ d.dish[l.id] = (d.dish[l.id] || 0) + (l.q || 1); ids.push(l.id); } });
    d.baskets.push(ids); });
  if (!resOf(d, TODAY)){ d.res = 0; d.ns = 0; } d.live = true; }
function dayData(k){ if (cache[k]) return cache[k]; var r = rng("day" + k), dow = parse(k).getUTCDay(), n = Math.round((dow === 5 || dow === 6 ? 44 : dow === 0 ? 38 : 32) * (.85 + r() * .3));
  var d = {k:k, orders:0, rev:0, ch:CH.map(function(){ return {o:0, rev:0}; }), hour:{}, hrev:{}, dish:{}, res:0, ns:0, baskets:[]};
  if (k > TODAY){ cache[k] = d; return d; }
  if (k === TODAY){ liveToday(d); cache[k] = d; return d; }
  for (var i = 0; i < n; i++){ var x = r(), c = x < .42 ? 0 : x < .65 ? 1 : x < .95 ? 2 : 3, hh = r() < .45 ? 11 + Math.floor(r() * 4) : r() < .14 ? 15 + Math.floor(r() * 2) : 17 + Math.floor(r() * (c === 0 ? 4 : 6));
    var lines = 1 + Math.floor(r() * (c === 2 ? 5 : 3)), tot = 0, ids = [];
    for (var j = 0; j < lines; j++){ var it = pick(r), q = r() < .2 ? 2 : 1; tot += it.p * q; d.dish[it.id] = (d.dish[it.id] || 0) + q; ids.push(it.id); }
    d.orders++; d.rev += tot; d.ch[c].o++; d.ch[c].rev += tot; d.hour[hh] = (d.hour[hh] || 0) + 1; d.hrev[hh] = (d.hrev[hh] || 0) + tot; d.baskets.push(ids); }
  if (!resOf(d, k)){ d.res = Math.round((dow === 5 || dow === 6 ? 11 : 6) * (.8 + r() * .4)); d.ns = d.res && r() < .35 ? 1 : 0; }
  cache[k] = d; return d; }
H.day = dayData;
H.reset = function(){ cache = {}; };
/* „нов ресторант, без история“ (#st=empty): миналите дни са празни, днес остава от поръчките */
H.empty = false;
function agg(a, b){ var o = {a:a, b:b, orders:0, rev:0, ch:CH.map(function(){ return {o:0, rev:0}; }), hour:{}, hrev:{}, dish:{}, res:0, ns:0, days:[], cancelled:0, baskets:[]};
  for (var k = a; k <= b; k = addD(k, 1)){ var d = H.empty && k !== TODAY ? {k:k, orders:0, rev:0, ch:CH.map(function(){ return {o:0, rev:0}; }), hour:{}, hrev:{}, dish:{}, res:0, ns:0, baskets:[]} : dayData(k);
    o.days.push(d); o.orders += d.orders; o.rev += d.rev; o.res += d.res; o.ns += d.ns; o.cancelled += d.cancelled || 0;
    d.ch.forEach(function(c, i){ o.ch[i].o += c.o; o.ch[i].rev += c.rev; }); Object.keys(d.hour).forEach(function(h){ o.hour[h] = (o.hour[h] || 0) + d.hour[h]; o.hrev[h] = (o.hrev[h] || 0) + (d.hrev[h] || 0); }); Object.keys(d.dish).forEach(function(id){ o.dish[id] = (o.dish[id] || 0) + d.dish[id]; });
    o.baskets = o.baskets.concat(d.baskets || []); }
  return o; }
H.agg = agg;

/* ---------- периоди (като в отчетите) ---------- */
H.PERIODS = [["today","Днес"],["yday","Вчера"],["7","7 дни"],["30","30 дни"],["month","Месец"],["custom","Избери дати"]];
H.range = function(per, cust){ if (per === "today") return [TODAY, TODAY]; if (per === "yday") return [addD(TODAY, -1), addD(TODAY, -1)]; if (per === "7") return [addD(TODAY, -6), TODAY]; if (per === "30") return [addD(TODAY, -29), TODAY];
  if (per === "month") return [TODAY.slice(0, 8) + "01", TODAY]; return [cust.a, cust.b]; };
H.prevRange = function(a, b, per){ var n = span(a, b); if (per === "month"){ var d = parse(a); d.setUTCMonth(d.getUTCMonth() - 1); var pa = ymd(d); return [pa, addD(pa, n - 1)]; } return [addD(a, -n), addD(a, -1)]; };
/* същият период миналата година */
H.yearRange = function(a, b){ return [addD(a, -364), addD(b, -364)]; }; /* същият ден от седмицата (364 дни назад), както GA4 „по ден от седмицата“ */
/* „Днес“ се сравнява до същия час: часовете до h (целият час h, както в отчетите); с m: само изминалата част от час h */
H.cutAt = function(o, h, m){ var tot = 0, part = 0, rv = 0; Object.keys(o.hour).forEach(function(k){ tot += o.hour[k]; var f = +k < h ? 1 : +k === h ? (m == null ? 1 : m / 60) : 0; part += o.hour[k] * f; rv += (o.hrev[k] || 0) * f; });
  var f = tot ? part / tot : 0, x = JSON.parse(JSON.stringify(o)); x.orders = m == null ? part : Math.round(part * 10) / 10; x.rev = rv; x.ch.forEach(function(c){ c.o = Math.round(c.o * f); c.rev = c.rev * f; }); return x; };
H.hours = function(o){ var out = []; for (var h = 10; h <= 22; h++) out.push([String(h).padStart(2, "0"), o.hour[h] || 0]); return out; };
/* обичайното за този ден от седмицата: средно от последните n същи дни (по подразбиране 4) */
H.usual = function(k, n){ n = n || 4; var days = []; for (var i = 1; i <= n; i++) days.push(dayData(addD(k, -7 * i)));
  var o = {orders:0, rev:0, hour:{}, hrev:{}, ch:CH.map(function(){ return {o:0, rev:0}; }), days:days};
  days.forEach(function(d){ o.orders += d.orders / n; o.rev += d.rev / n; d.ch.forEach(function(c, i){ o.ch[i].o += c.o / n; o.ch[i].rev += c.rev / n; });
    Object.keys(d.hour).forEach(function(h){ o.hour[h] = (o.hour[h] || 0) + d.hour[h] / n; o.hrev[h] = (o.hrev[h] || 0) + (d.hrev[h] || 0) / n; }); });
  return o; };

/* ---------- допълнения (отделни семена; не мърдат числата на отчетите) ---------- */
/* плащане: онлайн (доставка, вземане, офис) В брой / Карта при получаване / Ваучер; на маса В брой / С карта.
   нови и връщащи се клиенти; средни времена; ефектът на офертите (-30% след 15:00, кодът -10% от оценката) */
H.extra = function(k){ var d = dayData(k), r = rng("ow-x" + k), online = d.ch[0].rev + d.ch[1].rev + d.ch[3].rev, table = d.ch[2].rev, onlineN = d.ch[0].o + d.ch[1].o + d.ch[3].o;
  var e = {pay:{cash:0, card:0, voucher:0, tcash:0, tcard:0}, newC:0, retC:0, prep:0, deliv:0, call:0, lunch30:0, code:0, n:d.orders};
  if (d.live){ H.todayOrders().forEach(function(o){ if (o.status === "cancelled") return; var v = orderSum(o);
      if (o.channel === "table"){ if (o.pay === "card") e.pay.tcard += v; else e.pay.tcash += v; } else e.pay[o.pay === "card" ? "card" : o.pay === "voucher" ? "voucher" : "cash"] += v;
      if (o.code) e.code++; });
    var pr = [], dl = []; H.todayOrders().forEach(function(o){ var t = o.times || {}; if (t.ready && t.accepted) pr.push((new Date(t.ready) - new Date(t.accepted)) / 60000); if (t.delivered && t.accepted) dl.push((new Date(t.delivered) - new Date(t.accepted)) / 60000); });
    e.prep = pr.length ? pr.reduce(function(a, b){ return a + b; }, 0) / pr.length : 0; e.deliv = dl.length ? dl.reduce(function(a, b){ return a + b; }, 0) / dl.length : 0; e.call = 95 + r() * 60;
    var ret = Math.round(onlineN * (.55 + r() * .15)); e.retC = ret; e.newC = Math.max(0, onlineN - ret); e.lunch30 = 0; return e; }
  var c1 = .5 + r() * .12, c3 = .03 + r() * .03; e.pay.cash = online * c1; e.pay.voucher = online * c3; e.pay.card = online - e.pay.cash - e.pay.voucher;
  var t1 = .45 + r() * .15; e.pay.tcash = table * t1; e.pay.tcard = table - e.pay.tcash;
  e.retC = Math.round(onlineN * (.55 + r() * .15)); e.newC = Math.max(0, onlineN - e.retC);
  e.prep = 17 + r() * 8; e.deliv = 33 + r() * 12; e.call = 80 + r() * 90;
  var dow = parse(k).getUTCDay(); e.lunch30 = dow === 0 || dow === 6 ? 0 : Math.round(r() * 5); e.code = r() < .5 ? Math.round(r() * 3) : 0;
  return e; };
/* горивото: 2 шофьора, 2 автомобила (като в модула на шофьора); км по броя на доставките, литри и € са примерни */
H.DRIVERS = ["Шофьор 1","Шофьор 2"]; H.CARS = ["Автомобил 1","Автомобил 2"];
/* днес: доставките по шофьор са от sa-orders (тръгналите: „На път“ и „Доставена“), същите като парите в брой; км на доставка са примерни */
H.TODAY_RUN = ["on_way","delivered"];
H.fuel = function(k){ var d = dayData(k), r = rng("ow-f" + k), deliv = d.ch[0].o + d.ch[3].o, out = {km:0, l:0, eur:0, deliv:deliv, by:[{km:0, l:0, eur:0, n:0}, {km:0, l:0, eur:0, n:0}], car:[{km:0, l:0, eur:0}, {km:0, l:0, eur:0}], saved:0, routes:0, shorter:0};
  if (d.live){ var perKm0 = [7.6 + r() * .6, 8.8 + r() * .7], price0 = 1.33 + r() * .06; out.deliv = 0;
    H.todayOrders().forEach(function(o){ var i = H.DRIVERS.indexOf(o.driver); if (i < 0 || o.mode !== "delivery" || H.TODAY_RUN.indexOf(o.status) < 0) return; var rr = rng("ow-k" + o.no), km = 4.2 + rr() * 2.4, l = km * perKm0[i] / 100, eur = l * price0;
      out.deliv++; out.by[i].n++; out.by[i].km += km; out.by[i].l += l; out.by[i].eur += eur; out.car[i].km += km; out.car[i].l += l; out.car[i].eur += eur; out.km += km; out.l += l; out.eur += eur; });
    out.routes = out.deliv ? Math.max(1, Math.round(out.deliv / 3)) : 0; out.shorter = Math.round(out.routes * .4); out.saved = out.shorter * 1.6 * perKm0[0] / 100 * price0; return out; }
  if (!deliv) return out;
  var share = .5 + r() * .2, perKm = [7.6 + r() * .6, 8.8 + r() * .7], price = 1.33 + r() * .06;
  [0, 1].forEach(function(i){ var n = i === 0 ? Math.round(deliv * share) : deliv - Math.round(deliv * share), km = n * (4.2 + r() * 2.4), l = km * perKm[i] / 100, eur = l * price;
    out.by[i] = {km:km, l:l, eur:eur, n:n}; out.car[i] = {km:km, l:l, eur:eur}; out.km += km; out.l += l; out.eur += eur; });
  out.routes = Math.max(1, Math.round(deliv / 3)); out.shorter = Math.round(out.routes * (.3 + r() * .3)); out.saved = out.shorter * (1.1 + r() * 1.4) * perKm[0] / 100 * price;
  return out; };
})();
