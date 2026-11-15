/* Siracusa · Админ: примерните поръчки и запитвания (автор 2). Един източник за таблото, лентата и „Поръчки“.
   Зарежда се след _admin.js на всички страници. Попълва ключа само ако липсва, по часа на прототипа A.now().
   - sa-orders: {at:"HH:MM" на прототипа, list:[поръчка]}; поръчка: {no:"1042", ts, channel:"delivery|pickup|table|office", mode:"delivery|pickup",
     status:"accepted|cooking|ready|on_way|delivered|picked_up|served|cancelled", lines:[{id,q,mods}], zone, addr, table, pay, name, phone, note, code, driver, reason, times:{статус: ISO}}
   - sa-feedback-iq: запитванията за ваучер и рожден ден.
   Правила на примерите: от 10:00, доставка приета до 21:00, офис само 10:00 - 15:00, вземане и маса до 22:30; статусът е по изминалите минути.
   Ястията и цените са истинските; хората, адресите и телефоните са примерни. Броевете (A.orders, A.ordersInWork, значките) смята рамката. */
(function(){
"use strict";
if (!window.A || !window.SC) return;
A.seed = A.seed || {};
var MIN = 60000;
function now(){ return A.now ? A.now() : new Date(); }
function mins(d){ var s = A.sofia(d); return s.h * 60 + s.m; }
var ZONE = {}; SC.ZONES.forEach(function(z){ ZONE[z.n] = z; });

/* [минути преди, канал, квартал или маса, ястия, допълнително] */
var SPECS = [
  [3, "pickup", "", [["pitsa-s-proshuto-koto-i-tryufel"],["kyunefe"]], {pay:"card"}],
  [6, "table", "7", [["topeni-sirentsa-s-kornfleyks-i-domashno-sladko-o"],["kebapcheta",3]], {waiter:"Сервитьор 1"}],
  [9, "delivery", "НПЗ Искър", [["teleshki-buzi-s-kartofeno-pyure"],["pileshka-supa"]], {addr:"НПЗ Искър, ул. Примерна 2", note:"Звънецът не работи, обадете се."}],
  [14, "delivery", "Дружба 2", [["pitsa-margarita",2],["gratska-salata"]], {addr:"Дружба 2, бл. 205, вх. Б"}],
  [19, "table", "12", [["pitsa-kaprichoza",1,["+ Гъби"]],["shopska-salata",2],["svinski-vrat"]], {qr:true}],
  [24, "office", "Дружба 2", [["pitsa-margarita",3],["pitsa-vegetariana",2],["tarator",5]], {addr:"Дружба 2, офис сграда, ет. 3", note:"Обща поръчка за офиса, 5 души."}],
  [27, "delivery", "Горубляне", [["spageti-karbonara"],["kapreze-s-burata-i-avokado"]], {addr:"Горубляне, ул. Примерна 18"}],
  [33, "pickup", "", [["chiyzburger-s-teleshko-kyufte-blek-angas-s-parzh"],["hrupkav-pileshki-burger-s-parzheni-kartofi"]], {code:"SC10-4829163057"}],
  [41, "delivery", "Дружба 1", [["pitsa-s-burata-i-proshuto-krudo"],["svinski-rebra"],["tiramisu",2]], {addr:"Дружба 1, бл. 12, вх. А, ет. 4", pay:"card"}],
  [48, "table", "3", [["rizoto-s-gorski-gabi-i-tryufel-pasta"],["salata-tsezar-s-pileshki-prachki"]], {waiter:"Сервитьор 2"}],
  [58, "delivery", "Бусманци", [["salata-tsezar-s-pileshki-prachki"]], {addr:"Бусманци, ул. Примерна 4", cancel:"Клиентът се отказа по телефона."}],
  [66, "pickup", "", [["kebapcheta",2],["parzheni-kartofi"]], {pay:"card"}],
  [80, "delivery", "Дружба 2", [["shnitsel-po-vienski-s-parzheni-kartofi"],["kartofeno-pyure"]], {addr:"Дружба 2, бл. 118, вх. В"}],
  [105, "table", "5", [["pitsa-retro-s-chubritsa"],["gratska-salata"]], {waiter:"Сервитьор 1"}],
  [140, "delivery", "Гара Искър", [["teleshki-sudzhuk"],["pitsa-vegetariana"]], {addr:"Гара Искър, ул. Примерна 7"}],
  [175, "pickup", "", [["pitsa-margarita"],["tiramisu"]], {}],
  [230, "delivery", "Дружба 1", [["glazirani-pileshki-kascheta-s-kartofeno-pyure"],["tarator"]], {addr:"Дружба 1, бл. 40, вх. Г"}],
  [300, "table", "9", [["svinski-medalyoni-s-gorski-gabi-i-kartofeno-pyur"],["kapreze-s-burata-i-avokado"]], {waiter:"Сервитьор 2"}],
  [420, "office", "Дружба 2", [["spageti-boloneze",4],["salata-tsezar-s-pileshki-prachki",4]], {addr:"Дружба 2, офис сграда, ет. 3", note:"Обща поръчка за офиса, 4 души."}]
];
/* кога може да е приета: от 10:00; доставка и офис до 21:00, офис само в обедните часове; вземане и маса до 22:30 */
function allowed(ch, placed){ if (placed < 600) return false; if (ch === "office") return placed < 900; if (ch === "delivery") return placed < 1260; return placed < 1350; }
/* моментите на статусите (минути след приемане) */
function plan(ch, zone){ var p = {accepted:0, cooking:7, ready:22};
  if (ch === "pickup") p.picked_up = 40; else if (ch === "table") p.served = 30;
  else { p.on_way = 28; p.delivered = 28 + Math.max(10, ((ZONE[zone] && ZONE[zone].etaMin) || 35) - 15); }
  return p; }
A.seed.FLOW = {delivery:["accepted","cooking","ready","on_way","delivered"], pickup:["accepted","cooking","ready","picked_up"], table:["accepted","cooking","ready","served"]};

A.seed.makeOrders = function(){ var t = now(), m = mins(t), out = [];
  SPECS.forEach(function(s, i){ var ago = s[0], ch = s[1], placed = m - ago; if (!allowed(ch, placed) || !SC.byId[s[3][0][0]]) return;
    var x = s[4] || {}, ts = t.getTime() - ago * MIN, o = {ts:ts, channel:ch, mode:ch === "pickup" || ch === "table" ? "pickup" : "delivery", lines:s[3].map(function(l){ return {id:l[0], q:l[1] || 1, mods:l[2] || []}; }), pay:x.pay || "cash", times:{}, seq:i};
    if (ch === "table"){ o.table = s[2]; o.name = "Маса " + s[2]; o.phone = ""; if (x.qr) o.qr = true; if (x.waiter) o.waiter = x.waiter; }
    else { if (o.mode === "delivery"){ o.zone = s[2]; o.addr = x.addr; } }
    if (x.note) o.note = x.note; if (x.code) o.code = x.code;
    if (x.cancel){ o.status = "cancelled"; o.reason = x.cancel; o.times.accepted = new Date(ts).toISOString(); o.times.cancelled = new Date(ts + 6 * MIN).toISOString(); }
    else { var p = plan(ch, s[2]), f = ch === "table" ? A.seed.FLOW.table : o.mode === "pickup" ? A.seed.FLOW.pickup : A.seed.FLOW.delivery;
      f.forEach(function(k){ if (p[k] <= ago){ o.status = k; o.times[k] = new Date(ts + p[k] * MIN).toISOString(); } });
      if (o.status === "on_way" || o.status === "delivered") o.driver = o.zone === "Дружба 1" || o.zone === "НПЗ Искър" ? "Шофьор 1" : "Шофьор 2"; }
    out.push(o); });
  out.sort(function(a, b){ return a.ts - b.ts; });
  out.forEach(function(o, i){ o.no = String(1042 + i); if (o.channel !== "table"){ var k = i + 1; o.name = o.channel === "office" ? "Офис на Клиент " + k : "Клиент " + k; o.phone = "0888 00 00 " + String(k).padStart(2, "0"); } delete o.seq; });
  var s = A.sofia(t); return {at:String(s.h).padStart(2, "0") + ":" + String(s.m).padStart(2, "0"), list:out}; };

A.seed.orders = function(force){ var d = A.data.get("orders", null); if (d && d.list && !force) return d; d = A.seed.makeOrders(); A.data.set("orders", d); return d; };

A.seed.inquiries = function(force){ var q = A.data.get("feedback-iq", null); if (q && !force) return q; var t = now().getTime(), H = 3600e3;
  q = [{id:"q1", topic:"voucher", sum:50, name:"Клиент 21", tel:"0888 00 00 21", note:"За рождения ден на колега.", at:new Date(t - 2 * H).toISOString(), st:"new"},
    {id:"q2", topic:"birthday", name:"Клиент 22", tel:"0888 00 00 22", note:"Рожден ден на 3 декември, за 8 души. Искаме малка торта.", at:new Date(t - 5 * H).toISOString(), st:"new"},
    {id:"q3", topic:"voucher", sum:30, name:"Клиент 23", tel:"0888 00 00 23", note:"", at:new Date(t - 28 * H).toISOString(), st:"call"},
    {id:"q4", topic:"voucher", sum:100, name:"Клиент 24", tel:"0888 00 00 24", note:"Коледен подарък.", at:new Date(t - 76 * H).toISOString(), st:"done"}];
  A.data.set("feedback-iq", q); return q; };

A.seed.orders(); A.seed.inquiries();
})();
