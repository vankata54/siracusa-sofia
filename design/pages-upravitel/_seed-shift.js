/* Siracusa · Управител: смяната на живо (ключ sa-shift) и общите правила за нея (A.sh).
   Зарежда се след ../pages-admin/_admin.js, _seed-orders.js, _res-lib.js, _seed-res.js. Не вика A.mount.
   - A.seed.shift(opts) попълва sa-shift само ако липсва или ако се смени денят, часът на прототипа, поръчките (sa-orders.at) или профилът.
   - Профили (само в прототипа, „Само в прототипа“ → състоянието): "normal" (данните на админа както са), "rush" (вечерен пик: добавя
     примерни поръчки и номерира деня наново по час, повиквания над 5 мин, QR без потвърждение, таблет без връзка, адрес извън зоните,
     изчерпано в приета поръчка), "calm" (нищо не чака: приетите са в кухнята, закъснелите са доставени, резервациите са потвърдени).
     Смяната на профила пресъздава sa-orders и sa-reservations (както смяната на часа в админа), така че админът вижда същите числа.
   - sa-shift: {v, date, time, profile, ordersAt, open,
       waiters:[{id, name:"Сервитьор 1", tables:[номера], since:ISO, avgSec}],   // масите на всеки (решение 15.11: управителят ги сменя)
       walkins:{"8":{since:ISO, guests}},                                          // седнали без резервация, още без поръчка
       calls:[{id, n, why:"call"|"bill", at:ISO, taken:null|{by, at, assigned}}],  // повикванията (над 5 мин отиват при управителя)
       qr:[{id, n, at:ISO, lines:[{id, q}]}],                                       // QR поръчки, които още никой не е потвърдил
       kitchen:{topla:{online, seen:ISO}, skara:…, pesht:…, studeni:…},            // таблетите на секциите
       drivers:[{id, name:"Шофьор 1", since:ISO}], asks:[{id, type:"outzone", driver, no, at}], ack:{ключ:{at, by}}}
   Поръчките „Готви се“, „Готова“ и „На път“ в смяната са същите номера като в sa-orders: смяната не пази поръчки, а ги чете. */
(function(){
"use strict";
var A = window.A; if (!A || !A.data || !window.SC) return;
var MIN = 60000, SEC = 1000;
var SH = A.sh = {};
function now(){ return A.now(); }
function mins(d){ var s = A.sofia(d || now()); return s.h * 60 + s.m; }
function iso(ms){ return new Date(ms).toISOString(); }
var ZONE = {}; SC.ZONES.forEach(function(z){ ZONE[z.n] = z; });
SH.ZONE = ZONE;

/* ---------- секциите на кухнята (както в ../pages-kuhnya/_kitchen.js, K.SECTIONS; картата категория → секция е условна) ---------- */
SH.SECTIONS = [
  {id:"topla", n:"Топла кухня", ic:"cooking-pot", cats:["supi","topli-predyastia","osnovni-yastia","pasta-i-rizoto","burgeri","garnituri","zakuski","obedno"]},
  {id:"skara", n:"Скара Bertha", ic:"fire", cats:["skara-bertha"]},
  {id:"pesht", n:"Пещ за пици", ic:"pizza", cats:["pitsi","hlebcheta"]},
  {id:"studeni", n:"Салати и студени", ic:"bowl-food", cats:["salati","studeni-predyastia","sosove","deserti"]}
];
var SEC_OF = {}; SH.SECTIONS.forEach(function(s){ s.cats.forEach(function(c){ SEC_OF[c] = s.id; }); });
SH.secOf = function(id){ var x = SC.byId[id]; return x ? SEC_OF[x.cat] || "topla" : null; };

/* ---------- поръчките: същите правила като ../pages-admin/orders.html ---------- */
SH.FIN = ["delivered","picked_up","served"];
SH.LABEL = {accepted:"Приета", cooking:"Готви се", ready:"Готова", on_way:"На път", delivered:"Доставена", picked_up:"Взета", served:"Сервирана", cancelled:"Отказана"};
SH.CH = {delivery:["Доставка","moped"], pickup:["Вземане","storefront"], table:["Маса","chair"], office:["Офис","briefcase"], phone:["Телефон","phone"]};
SH.fin = function(o){ return SH.FIN.indexOf(o.status) > -1; };
SH.ageMin = function(o){ return (now().getTime() - o.ts) / MIN; };
/* „Закъснява“: доставка след времето на квартала, вземане и маса след 20 мин, ако още не е готова (като в админа) */
SH.late = function(o){ if (SH.fin(o) || o.status === "cancelled") return false; var m = SH.ageMin(o);
  if (o.mode === "delivery"){ var z = ZONE[o.zone]; return m > (z ? z.etaMin : 35); } return o.status !== "ready" && m > 20; };
SH.lateMin = function(o){ var m = SH.ageMin(o); if (o.mode === "delivery"){ var z = ZONE[o.zone]; return Math.max(1, Math.round(m - (z ? z.etaMin : 35))); } return Math.max(1, Math.round(m - 20)); };
SH.total = function(o){ if (typeof o.total === "number") return o.total; return A.seed && A.seed.sums ? A.seed.sums(o).total : 0; };
SH.items = function(o){ return o.lines.reduce(function(a, l){ return a + (l.q || 1); }, 0); };
SH.chName = function(o){ var c = SH.CH[o.channel] || SH.CH.delivery; return c[0]; };

/* ---------- кой седи на масата сега: поръчки на масата (несервирани или сервирани до 45 мин), седнали без поръчка, QR ---------- */
SH.tableOrders = function(n, since){ return A.orders().filter(function(o){ return o.channel === "table" && String(o.table) === String(n) && o.status !== "cancelled" && (!since || o.ts >= since - 60000); }); };
SH.seated = function(shift){ var out = {}, t = now().getTime();
  A.orders().forEach(function(o){ if (o.channel !== "table" || o.status === "cancelled") return; var n = +o.table, keep = o.status !== "served";
    if (!keep && o.times && o.times.served) keep = t - new Date(o.times.served).getTime() < 45 * MIN;
    if (keep && (!out[n] || o.ts < out[n].since)) out[n] = {since:o.ts, src:"order"}; });
  var w = (shift && shift.walkins) || {}; Object.keys(w).forEach(function(n){ if (!out[n]) out[n] = {since:new Date(w[n].since).getTime(), guests:w[n].guests, src:"walkin"}; });
  return out; };

/* ---------- генераторът ---------- */
function pickFree(seated, prefer, k, avoid){ var act = A.activeTables().filter(function(x){ return x.walkin !== false; }).map(function(x){ return x.n; }), out = [];
  prefer.concat(act).forEach(function(n){ if (out.length < k && act.indexOf(n) > -1 && !seated[n] && out.indexOf(n) < 0 && (avoid || []).indexOf(n) < 0) out.push(n); }); return out; }
var W1 = [1,2,4,6,7,8,10,12,13,14], W2 = [3,5,9,11,15,16,17,18,19,20];

/* вечерен пик: още поръчки, по-стари и в работа (относително спрямо часа на прототипа), после номерата наново по час */
function rushOrders(d){ var t = now().getTime(), m = mins(), extra = [];
  if (m < 660 || m >= 1350) return d; /* извън работата на кухнята пикът няма смисъл */
  function L(id, q){ return {id:id, q:q || 1, mods:[]}; }
  function O(ago, ch, st, lines, x){ var ts = t - Math.round(ago * MIN), o = {no:"", ts:ts, placedAt:A.hm(new Date(ts)), channel:ch, mode:ch === "pickup" || ch === "table" ? "pickup" : "delivery", lines:lines, pay:(x && x.pay) || "cash", times:{accepted:iso(ts)}, status:st, sample:true, rush:true};
    var steps = {cooking:7, ready:22, on_way:28}; ["cooking","ready","on_way"].forEach(function(s){ var f = (A.seed.FLOW[ch === "table" ? "table" : o.mode === "pickup" ? "pickup" : "delivery"]); if (f.indexOf(s) > -1 && f.indexOf(s) <= f.indexOf(st)) o.times[s] = iso(ts + Math.min(steps[s], ago - 1) * MIN); });
    Object.keys(x || {}).forEach(function(k){ o[k] = x[k]; }); return o; }
  var k0 = d.list.length + 40;
  function cl(k){ return {name:"Клиент " + k, phone:"0888 00 00 " + String(k).padStart(2, "0")}; }
  var dzones = function(z, addr, k, drv){ var c = cl(k); return {zone:z, addr:addr, name:c.name, phone:c.phone, driver:drv}; };
  /* маси: две закъсняват в кухнята, една е готова, една готви */
  extra.push(O(34, "table", "cooking", [L("svinski-vrat"), L("shopska-salata", 2)], {table:"10", name:"Маса 10", phone:"", waiter:"Сервитьор 1"}));
  extra.push(O(27, "table", "cooking", [L("pitsa-kaprichoza"), L("pitsa-margarita"), L("gratska-salata")], {table:"17", name:"Маса 17", phone:"", waiter:"Сервитьор 2"}));
  extra.push(O(24, "table", "ready", [L("kebapcheta", 3), L("parzheni-kartofi")], {table:"12", name:"Маса 12", phone:"", waiter:"Сервитьор 1"}));
  extra.push(O(15, "table", "cooking", [L("rizoto-s-gorski-gabi-i-tryufel-pasta"), L("tiramisu", 2)], {table:"5", name:"Маса 5", phone:"", waiter:"Сервитьор 2"}));
  extra.push(O(48, "table", "served", [L("svinski-medalyoni-s-gorski-gabi-i-kartofeno-pyur", 2)], {table:"19", name:"Маса 19", phone:"", waiter:"Сервитьор 2"}));
  /* доставки: две на път с Шофьор 1 (закъсняват), една на път извън зоните с Шофьор 2, една чака шофьор, една готви */
  extra.push(O(52, "delivery", "on_way", [L("pitsa-s-burata-i-proshuto-krudo"), L("tiramisu")], dzones("Дружба 1", "Дружба 1, бл. 61, вх. Б", k0 + 1, "Шофьор 1")));
  extra.push(O(44, "delivery", "on_way", [L("teleshki-buzi-s-kartofeno-pyure"), L("tarator")], dzones("НПЗ Искър", "НПЗ Искър, ул. Примерна 12", k0 + 2, "Шофьор 1")));
  extra.push(O(38, "delivery", "on_way", [L("spageti-boloneze", 2)], dzones("", "кв. Примерен, ул. Примерна 5 (извън зоните)", k0 + 3, "Шофьор 2")));
  extra.push(O(31, "delivery", "ready", [L("pitsa-vegetariana"), L("kyunefe")], dzones("Бусманци", "Бусманци, ул. Примерна 30", k0 + 4)));
  extra.push(O(29, "delivery", "cooking", [L("svinski-rebra"), L("kapreze-s-burata-i-avokado")], dzones("Дружба 2", "Дружба 2, бл. 301, вх. А", k0 + 5)));
  /* вземане: едно закъснява в кухнята; едно е прието с изчерпано ястие (обажда се управителят, OPEN-QUESTIONS 19) */
  extra.push(O(26, "pickup", "cooking", [L("chiyzburger-s-teleshko-kyufte-blek-angas-s-parzh", 2)], cl(k0 + 6)));
  extra.push(O(6, "pickup", "accepted", [L("pleskavitsa", 2), L("shopska-salata")], cl(k0 + 7)));
  /* нова онлайн поръчка, още не приета */
  extra.push(O(2, "delivery", "accepted", [L("pitsa-margarita", 2), L("gratska-salata")], dzones("Дружба 2", "Дружба 2, бл. 40, вх. В", k0 + 8)));
  extra.forEach(function(o){ if (o.status === "on_way") o.times.on_way = iso(o.ts + 26 * MIN); Object.assign(o, A.seed.sums(o)); });
  /* фиксираните маси на примерния ден не се дублират: пиковите маси заменят по-старите на същата маса */
  var busyT = extra.filter(function(o){ return o.channel === "table"; }).map(function(o){ return o.table; });
  var list = d.list.filter(function(o){ return !(o.channel === "table" && busyT.indexOf(o.table) > -1 && !SH.fin(o)); }).concat(extra);
  list.sort(function(a, b){ return a.ts - b.ts; }); list.forEach(function(o, i){ o.no = String(1042 + i); });
  d.list = list; return d; }

/* нищо не чака: приетите са в кухнята, закъснелите са готови или доставени */
function calmOrders(d){ var t = now().getTime();
  d.list.forEach(function(o){ if (o.status === "cancelled" || SH.fin(o)) return;
    if (o.status === "accepted"){ o.status = "cooking"; o.times.cooking = iso(Math.min(t, o.ts + 2 * MIN)); }
    if (SH.late(o)){ if (o.status === "on_way"){ o.status = "delivered"; o.times.delivered = iso(t - 2 * MIN); } else if (o.status !== "ready"){ o.status = "ready"; o.times.ready = iso(t - 2 * MIN); } } });
  return d; }

SH.PROFILES = ["normal","rush","calm"];
A.seed = A.seed || {};
/* opts: {profile, force} */
A.seed.shift = function(opts){ opts = opts || {};
  var cur = A.data.get("shift", null), want = SH.PROFILES.indexOf(opts.profile) > -1 ? opts.profile : (cur && cur.profile) || "normal";
  var ord = A.data.get("orders", null), day = A.todayKey();
  var fresh = !cur || opts.force || cur.v !== 1 || cur.date !== day || cur.time !== A.protoTime || cur.profile !== want || !ord || !ord.list || ord.at !== cur.ordersAt;
  if (!fresh) return cur;
  var profileChanged = cur && cur.profile !== want;
  /* смяна на профила: поръчките и резервациите се пресъздават (като смяната на часа в админа), после профилът ги променя */
  if (profileChanged || (want !== "normal" && (!cur || !ord || ord.at !== cur.ordersAt))){
    var d = A.seed.makeOrders(); if (want === "rush") d = rushOrders(d); if (want === "calm") d = calmOrders(d); A.data.set("orders", d);
    if (A.seed.reservations) A.seed.reservations(true);
    if (want === "calm"){ var rs = A.data.get("reservations", []); rs.forEach(function(r){ if (r.date === day && r.status === "new") r.status = "confirmed"; }); A.data.set("reservations", rs);
      var bl = A.data.get("blocks", {}) || {}; Object.keys(bl).forEach(function(k){ if (bl[k] && bl[k].status === "pending") delete bl[k]; }); A.data.set("blocks", bl); } }
  ord = A.data.get("orders", null) || A.seed.orders();
  var t = now().getTime(), m = mins(), open = m >= 600 && m < 1380, kitchen = m >= 600 && m < 1350;
  var start = m < 960 ? 600 : 960; /* обедна смяна от 10:00, вечерна от 16:00 */
  var since = iso(t - (m - start) * MIN);
  var S = {v:1, date:day, time:A.protoTime, profile:want, ordersAt:ord.at, open:open, at:iso(t),
    waiters:m >= 600 ? [{id:"w1", name:"Сервитьор 1", tables:W1.slice(), since:since, avgSec:want === "rush" ? 164 : 92},
                    {id:"w2", name:"Сервитьор 2", tables:W2.slice(), since:since, avgSec:want === "rush" ? 211 : 128}] : [],
    walkins:{}, calls:[], qr:[], asks:[], ack:{},
    kitchen:{}, drivers:m >= 600 ? [{id:"d1", name:"Шофьор 1", since:since}, {id:"d2", name:"Шофьор 2", since:since}] : []};
  SH.SECTIONS.forEach(function(s){ S.kitchen[s.id] = {online:true, seen:iso(t - 20 * SEC)}; });
  if (kitchen){
    var seated = SH.seated(S), wk = pickFree(seated, want === "rush" ? [8, 14, 2, 15, 16] : [8, 14], want === "rush" ? 5 : 2, []);
    wk.forEach(function(n, i){ S.walkins[n] = {since:iso(t - (want === "rush" ? [4, 9, 13, 3, 7][i] : [9, 4][i]) * MIN), guests:[3, 2, 4, 2, 5][i]}; });
    seated = SH.seated(S);
    var byOrder = Object.keys(seated).filter(function(n){ return seated[n].src === "order"; }).sort(function(a, b){ return seated[a].since - seated[b].since; }).map(Number);
    function call(n, why, sec){ if (n) S.calls.push({id:"c" + (S.calls.length + 1), n:n, why:why, at:iso(t - sec * SEC), taken:null}); }
    if (want === "normal"){ call(byOrder[0], "call", 370); call(wk[1], "call", 80);
      if (wk[0]) S.qr.push({id:"q1", n:wk[0], at:iso(t - 100 * SEC), lines:[{id:"pitsa-retro-s-chubritsa", q:1}, {id:"gratska-salata", q:1}, {id:"tarator", q:2}]}); }
    if (want === "rush"){ call(byOrder[0], "bill", 520); call(byOrder[1] || wk[2], "call", 365); call(wk[3] || byOrder[2], "call", 130); call(byOrder[2] || wk[4], "bill", 40);
      if (wk[0]) S.qr.push({id:"q1", n:wk[0], at:iso(t - 270 * SEC), lines:[{id:"pitsa-s-proshuto-koto-i-tryufel", q:1}, {id:"salata-tsezar-s-pileshki-prachki", q:1}]});
      if (wk[4]) S.qr.push({id:"q2", n:wk[4], at:iso(t - 50 * SEC), lines:[{id:"kebapcheta", q:4}, {id:"shopska-salata", q:2}]});
      S.kitchen.pesht = {online:false, seen:iso(t - 4 * MIN - 12 * SEC)};
      var oz = ord.list.filter(function(o){ return o.status === "on_way" && !o.zone; })[0];
      if (oz) S.asks.push({id:"a1", type:"outzone", driver:oz.driver || "Шофьор 2", no:oz.no, at:iso(t - 3 * MIN - 20 * SEC)}); } }
  A.data.set("shift", S); return S; };

/* профилът от адреса (#st=rush / calm / normal); другите състояния (offline, loading …) не пипат данните */
SH.ensure = function(st){ return A.seed.shift(SH.PROFILES.indexOf(st) > -1 ? {profile:st} : {}); };
})();
