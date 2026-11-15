/* Siracusa · Админ: примерните поръчки и запитвания (автор 2). Един източник за таблото, лентата и „Поръчки“.
   Зарежда се след _admin.js на всички страници. Попълва ключа само ако липсва, по часа на прототипа A.now().
   - sa-orders: {at:"HH:MM" на прототипа, list:[поръчка]}; поръчка: {no:"1042", ts, placedAt:"19:12", channel:"delivery|pickup|table|office", mode:"delivery|pickup",
     status:"accepted|cooking|ready|on_way|delivered|picked_up|served|cancelled", lines:[{id,q,mods}], sub, disc, fee (null = [ЛИПСВА]), total,
     zone, addr, table, pay:"cash|card|voucher", name, phone, note, code, driver, reason, times:{статус: ISO}}. Подробно: README-2.md.
   - sa-feedback-iq: запитванията за ваучер и рожден ден.
   Един и същ примерен ден (38 поръчки, № 1042 - 1079), видян в часа на прототипа: има всички, приети дотогава; от 10:00, доставка до 21:00, офис 10:00 - 15:00, вземане и маса до 22:30; статусът е по изминалите минути.
   Ястията и цените са истинските; хората, адресите и телефоните са примерни. Броевете (A.orders, A.ordersInWork, значките) смята рамката. */
(function(){
"use strict";
if (!window.A || !window.SC) return;
A.seed = A.seed || {};
var MIN = 60000;
function now(){ return A.now ? A.now() : new Date(); }
function mins(d){ var s = A.sofia(d); return s.h * 60 + s.m; }
var ZONE = {}; SC.ZONES.forEach(function(z){ ZONE[z.n] = z; });

/* Един примерен ден (час на приемане, канал, квартал или маса, ястия, допълнително). Денят е един и същ, видян в различен час:
   в часа на прототипа има всички поръчки, приети дотогава, със състоянието за този час; номерата не се сменят. */
var DAY = [
  ["10:24", "pickup", "", [["pitsa-margarita"],["tiramisu"]], {}],
  ["10:52", "delivery", "Дружба 2", [["glazirani-pileshki-kascheta-s-kartofeno-pyure"],["tarator"]], {addr:"Дружба 2, бл. 40, вх. Г"}],
  ["11:15", "table", "4", [["pitsa-retro-s-chubritsa"],["gratska-salata"]], {waiter:"Сервитьор 1"}],
  ["11:38", "office", "Дружба 2", [["spageti-boloneze",4],["salata-tsezar-s-pileshki-prachki",4]], {addr:"Дружба 2, офис сграда, ет. 3", note:"Обща поръчка за офиса, 4 души."}],
  ["11:55", "delivery", "Дружба 1", [["shnitsel-po-vienski-s-parzheni-kartofi"],["kartofeno-pyure"]], {addr:"Дружба 1, бл. 12, вх. А"}],
  ["12:03", "delivery", "Горубляне", [["spageti-karbonara"],["kapreze-s-burata-i-avokado"]], {addr:"Горубляне, ул. Примерна 18"}],
  ["12:08", "office", "Дружба 2", [["pitsa-margarita",3],["pitsa-vegetariana",2],["tarator",5]], {addr:"Дружба 2, офис сграда, ет. 5", note:"Обща поръчка за офиса, 5 души."}],
  ["12:14", "table", "12", [["pitsa-kaprichoza",1,["+ Гъби"]],["shopska-salata",2],["svinski-vrat"]], {qr:true}],
  ["12:19", "delivery", "НПЗ Искър", [["teleshki-buzi-s-kartofeno-pyure"],["pileshka-supa"]], {addr:"НПЗ Искър, ул. Примерна 2", note:"Звънецът не работи, обадете се."}],
  ["12:24", "pickup", "", [["chiyzburger-s-teleshko-kyufte-blek-angas-s-parzh"],["hrupkav-pileshki-burger-s-parzheni-kartofi"]], {code:"SC10-4829163057"}],
  ["12:27", "table", "7", [["topeni-sirentsa-s-kornfleyks-i-domashno-sladko-o"],["kebapcheta",3]], {waiter:"Сервитьор 1"}],
  ["13:10", "delivery", "Бусманци", [["salata-tsezar-s-pileshki-prachki"]], {addr:"Бусманци, ул. Примерна 4", cancel:"Клиентът се отказа по телефона."}],
  ["13:40", "pickup", "", [["kebapcheta",2],["parzheni-kartofi"]], {pay:"card"}],
  ["14:25", "table", "5", [["svinski-vrat"],["gratska-salata"]], {waiter:"Сервитьор 2"}],
  ["15:30", "pickup", "", [["pitsa-vegetariana"],["kyunefe"]], {}],
  ["16:45", "delivery", "Дружба 2", [["pitsa-s-burata-i-proshuto-krudo"],["tiramisu"]], {addr:"Дружба 2, бл. 205, вх. Б", pay:"card"}],
  ["17:30", "table", "9", [["svinski-medalyoni-s-gorski-gabi-i-kartofeno-pyur"],["kapreze-s-burata-i-avokado"]], {waiter:"Сервитьор 2"}],
  ["18:05", "delivery", "Гара Искър", [["teleshki-sudzhuk"],["pitsa-vegetariana"]], {addr:"Гара Искър, ул. Примерна 7"}],
  ["18:40", "pickup", "", [["pitsa-margarita",2]], {}],
  ["18:58", "delivery", "Дружба 1", [["pitsa-s-burata-i-proshuto-krudo"],["svinski-rebra"],["tiramisu",2]], {addr:"Дружба 1, бл. 12, вх. А, ет. 4", pay:"card"}],
  ["19:05", "table", "3", [["rizoto-s-gorski-gabi-i-tryufel-pasta"],["salata-tsezar-s-pileshki-prachki"]], {waiter:"Сервитьор 2"}],
  ["19:12", "delivery", "Дружба 2", [["pitsa-margarita",2],["gratska-salata"]], {addr:"Дружба 2, бл. 118, вх. В"}],
  ["19:20", "pickup", "", [["pitsa-s-proshuto-koto-i-tryufel"],["kyunefe"]], {pay:"card"}],
  ["19:26", "delivery", "Горубляне", [["spageti-karbonara"],["kapreze-s-burata-i-avokado"]], {addr:"Горубляне, ул. Примерна 21"}],
  ["19:31", "table", "6", [["pitsa-kaprichoza"],["shopska-salata",2]], {qr:true}],
  ["19:35", "delivery", "НПЗ Искър", [["teleshki-buzi-s-kartofeno-pyure"],["pileshka-supa"]], {addr:"НПЗ Искър, ул. Примерна 9"}],
  ["19:39", "pickup", "", [["chiyzburger-s-teleshko-kyufte-blek-angas-s-parzh"],["parzheni-kartofi"]], {}],
  ["20:05", "delivery", "Дружба 1", [["kebapcheta",2]], {addr:"Дружба 1, бл. 30, вх. Б", cancel:"Адресът е извън зоната."}],
  ["20:15", "delivery", "Дружба 1", [["shnitsel-po-vienski-s-parzheni-kartofi"],["tarator"]], {addr:"Дружба 1, бл. 51, вх. А"}],
  ["20:40", "table", "8", [["svinski-medalyoni-s-gorski-gabi-i-kartofeno-pyur"],["tiramisu"]], {waiter:"Сервитьор 1"}],
  ["20:52", "delivery", "Дружба 2", [["pitsa-vegetariana"],["gratska-salata"]], {addr:"Дружба 2, бл. 207, вх. А"}],
  ["21:05", "pickup", "", [["pitsa-margarita"],["kyunefe"]], {}],
  ["21:18", "table", "11", [["kebapcheta",3],["shopska-salata"]], {waiter:"Сервитьор 2"}],
  ["21:24", "pickup", "", [["pitsa-s-proshuto-koto-i-tryufel"]], {pay:"card"}],
  ["21:27", "table", "2", [["topeni-sirentsa-s-kornfleyks-i-domashno-sladko-o"],["svinski-vrat"]], {qr:true}],
  ["21:50", "pickup", "", [["pitsa-kaprichoza"],["tiramisu"]], {}],
  ["22:20", "table", "10", [["rizoto-s-gorski-gabi-i-tryufel-pasta"]], {waiter:"Сервитьор 1"}],
  ["22:25", "pickup", "", [["chiyzburger-s-teleshko-kyufte-blek-angas-s-parzh"]], {}]
];
/* кога може да е приета: от 10:00; доставка до 21:00, офис само в обедните часове; вземане и маса до 22:30 */
function allowed(ch, placed){ if (placed < 600) return false; if (ch === "office") return placed < 900; if (ch === "delivery") return placed < 1260; return placed < 1350; }
/* моментите на статусите (минути след приемане): Готви се след 7, Готова след 22, На път след 28, Доставена около времето на квартала; Взета след 40, Сервирана след 30 */
function plan(ch, zone){ var p = {accepted:0, cooking:7, ready:22};
  if (ch === "pickup") p.picked_up = 40; else if (ch === "table") p.served = 30;
  else { p.on_way = 28; p.delivered = 28 + Math.max(10, ((ZONE[zone] && ZONE[zone].etaMin) || 35) - 15); }
  return p; }
A.seed.FLOW = {delivery:["accepted","cooking","ready","on_way","delivered"], pickup:["accepted","cooking","ready","picked_up"], table:["accepted","cooking","ready","served"]};

function hhmm(t){ var p = t.split(":"); return +p[0] * 60 + +p[1]; }
/* сумите (цените от менюто, добавките от „Добавки“, -10% с код, таксата на платения квартал е [ЛИПСВА] = null) */
var ADD = {}; SC.inCat("dobavki").forEach(function(a){ ADD["+ " + a.n] = a.p; });
A.seed.sums = function(o){ var sub = o.lines.reduce(function(s, l){ var x = SC.byId[l.id]; return s + (x ? (x.p + (l.mods || []).reduce(function(a, m){ return a + (ADD[m] || 0); }, 0)) * l.q : 0); }, 0);
  var disc = o.code ? Math.round(sub * 10) / 100 : 0, z = o.mode === "delivery" ? ZONE[o.zone] : null, fee = o.mode !== "delivery" ? 0 : z && z.free ? 0 : null;
  return {sub:Math.round(sub * 100) / 100, disc:disc, fee:fee, total:Math.round((sub - disc + (fee || 0)) * 100) / 100}; };
A.seed.makeOrders = function(){ var t = now(), s0 = A.sofia(t), m = s0.h * 60 + s0.m + t.getSeconds() / 60, out = [];
  DAY.forEach(function(s, i){ var placed = hhmm(s[0]), ch = s[1]; if (!allowed(ch, placed) || placed > m || !SC.byId[s[3][0][0]]) return;
    var ago = m - placed, x = s[4] || {}, ts = t.getTime() - Math.round(ago * MIN), o = {no:String(1042 + i), ts:ts, placedAt:s[0], channel:ch, mode:ch === "pickup" || ch === "table" ? "pickup" : "delivery", lines:s[3].map(function(l){ return {id:l[0], q:l[1] || 1, mods:l[2] || []}; }), pay:x.pay || "cash", times:{}};
    if (ch === "table"){ o.table = s[2]; o.name = "Маса " + s[2]; o.phone = ""; if (x.qr) o.qr = true; if (x.waiter) o.waiter = x.waiter; }
    else { var k = i + 1; o.name = ch === "office" ? "Офис на Клиент " + k : "Клиент " + k; o.phone = "0888 00 00 " + String(k).padStart(2, "0"); if (o.mode === "delivery"){ o.zone = s[2]; o.addr = x.addr; } }
    if (x.note) o.note = x.note; if (x.code) o.code = x.code;
    o.times.accepted = new Date(ts).toISOString(); o.status = "accepted";
    if (x.cancel && ago >= 6){ o.status = "cancelled"; o.reason = x.cancel; o.times.cancelled = new Date(ts + 6 * MIN).toISOString(); }
    else if (!x.cancel){ var p = plan(ch, s[2]), f = ch === "table" ? A.seed.FLOW.table : o.mode === "pickup" ? A.seed.FLOW.pickup : A.seed.FLOW.delivery;
      f.forEach(function(k){ if (p[k] <= ago){ o.status = k; o.times[k] = new Date(ts + p[k] * MIN).toISOString(); } });
      if (o.status === "on_way" || o.status === "delivered") o.driver = o.zone === "Дружба 1" || o.zone === "НПЗ Искър" ? "Шофьор 1" : "Шофьор 2"; }
    Object.assign(o, A.seed.sums(o));
    out.push(o); });
  return {at:String(s0.h).padStart(2, "0") + ":" + String(s0.m).padStart(2, "0"), list:out}; };

A.seed.orders = function(force){ var d = A.data.get("orders", null); if (d && d.list && !force) return d; d = A.seed.makeOrders(); A.data.set("orders", d); return d; };

A.seed.inquiries = function(force){ var q = A.data.get("feedback-iq", null); if (q && !force) return q; var t = now().getTime(), H = 3600e3;
  q = [{id:"q1", topic:"voucher", sum:50, name:"Клиент 21", tel:"0888 00 00 21", note:"За рождения ден на колега.", at:new Date(t - 2 * H).toISOString(), st:"new"},
    {id:"q2", topic:"birthday", name:"Клиент 22", tel:"0888 00 00 22", note:"Рожден ден на 3 декември, за 8 души. Искаме малка торта.", at:new Date(t - 5 * H).toISOString(), st:"new"},
    {id:"q3", topic:"voucher", sum:30, name:"Клиент 23", tel:"0888 00 00 23", note:"", at:new Date(t - 28 * H).toISOString(), st:"call"},
    {id:"q4", topic:"voucher", sum:100, name:"Клиент 24", tel:"0888 00 00 24", note:"Коледен подарък.", at:new Date(t - 76 * H).toISOString(), st:"done"}];
  A.data.set("feedback-iq", q); return q; };

A.seed.orders(); A.seed.inquiries();
})();
