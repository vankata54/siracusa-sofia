/* Siracusa · Админ: примерни резервации, блокирани номера и настройки (автор 3). Зарежда се след _admin.js и _res-lib.js на всяка страница.
   Един източник за таблото, лентата и разделите. Всеки ключ се попълва само ако липсва, по часа на прототипа A.now().
   A.seed.reservations(force) -> sa-reservations (+ sa-blocks)    A.seed.settings(force) -> sa-settings
   A.seed.feedback(force) -> sa-feedback (обратна връзка), A.seed.customers(force) -> sa-customers. Помощниците (A.rl) са в _res-lib.js; този файл само попълва ключовете.

   Форма на данните (описана и в README-3.md):
   sa-reservations: [{id, date:"2026-11-15", time:"19:30", people:4, table:"S3"|null, zone:"salon"|"garden"|null, name:"Клиент 7",
                      phone:"0888123456", occasion:"", note:"", marketing:false,
                      status:"new"|"confirmed"|"seated"|"no_show"|"cancelled"|"waitlist", createdAt:ISO, sample:true}]
   „Резервации днес“ = date === днес и status не е cancelled и не е waitlist.
   sa-blocks: {"0888123456": {status:"pending"|"blocked", name, count, at:ISO, by?, manual?}}
   sa-settings: {kitchen:{busy, etaMin:35, etaBusyMin:55, busyAt:ISO|null}, resMinutes:120, celebrationPrice:"offer"|"estimate",
                 earlyDays:null|число, noShowLimit:2, callCooldown:3, callManager:5} */
(function(){
"use strict";
var A = window.A; if (!A || !A.data) return;
var R = A.rl; if (!R) return; /* помощниците са в _res-lib.js */
var S = A.seed = A.seed || {};
var addD = R.addDays, isoAt = R.isoAt;
function parse(k){ var p = k.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 10)); }
function hm(m){ return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
function rng(seed){ var s = 0; for (var i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0; return function(){ s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
S.settings = function(force){ if (!force && A.data.get("settings", null)) return A.data.get("settings"); var v = JSON.parse(JSON.stringify(R.SETTINGS)); A.data.set("settings", v); return v; };

var OCC = ["Рожден ден","Имен ден","Годишнина","Делова среща"], NOTES = ["Идваме с детска количка.","Маса до прозореца, ако може.","Ще закъснеем с 10 минути.","Един гост е с инвалидна количка."];
S.reservations = function(force){
  if (!force && A.data.get("reservations", null)) return A.data.get("reservations");
  var TODAY = R.today(), NOWM = R.nowMin(), TABLES = R.tables().tables.filter(function(t){ return !t.off; }), DUR = R.settings().resMinutes || 120, out = [], id = 1, phoneOf = R.phoneOf;
  for (var dd = -30; dd <= 14; dd++){ var day = addD(TODAY, dd), r = rng("res" + day), dow = parse(day).getUTCDay(), n = dd === 0 ? 13 : (dow === 5 || dow === 6 ? 10 : 6) + Math.floor(r() * 4), holds = {};
    for (var k = 0; k < n; k++){ var lunch = r() < .35, slot = lunch ? 660 + 30 * Math.floor(r() * 6) : 1080 + 30 * Math.floor(r() * 8), t = hm(slot), ppl = [1,2,2,2,3,4,4,4,5,6,8][Math.floor(r() * 11)];
      var gi = Math.floor(r() * 36); if ([2, 4, 8].indexOf(gi) > -1) gi += 10;
      var cand = TABLES.filter(function(x){ return x.seats >= ppl && x.seats - ppl <= 2 && (holds[x.id] || []).every(function(h){ return slot + DUR <= h || slot >= h + DUR; }); });
      var tb = cand.length ? cand[Math.floor(r() * cand.length)] : null, past = dd < 0 || (dd === 0 && slot + 20 < NOWM), status;
      if (tb) (holds[tb.id] = holds[tb.id] || []).push(slot);
      if (!tb){ if (dd < 0 || (dd === 0 && slot < NOWM)) continue; status = "waitlist"; }
      else if (past){ var x = r(); status = x < .06 ? "no_show" : x < .13 ? "cancelled" : "seated"; }
      else { var y = r(); status = dd === 0 && slot <= NOWM + 15 ? "confirmed" : y < .25 ? "new" : y < .3 ? "cancelled" : "confirmed"; }
      /* записана 1-6 дни по-рано, в работно време */
      out.push({id:"r" + (id++), date:day, time:t, people:ppl, table:tb ? tb.id : null, zone:tb ? tb.zone : null, name:"Клиент " + (gi + 1), phone:phoneOf(gi),
        occasion:r() < .22 ? OCC[Math.floor(r() * OCC.length)] : "", note:r() < .16 ? NOTES[Math.floor(r() * NOTES.length)] : "", marketing:false, status:status,
        createdAt:isoAt(addD(day, -(1 + Math.floor(r() * 6))), 600 + Math.floor(r() * 660)), sample:true}); } }
  /* Клиент 3: едно неявяване (още едно предлага блокиране); Клиент 5: две (чака решение); Клиент 9: блокиран */
  function force2(gi, dd, t, s, tbl){ out.push({id:"r" + (id++), date:addD(TODAY, dd), time:t, people:2, table:tbl || "S1", zone:"salon", name:"Клиент " + (gi + 1), phone:phoneOf(gi), occasion:"", note:"", marketing:false, status:s, createdAt:isoAt(addD(TODAY, dd - 2), 1010), sample:true}); }
  force2(2, -12, "19:30", "no_show"); force2(4, -20, "20:00", "no_show"); force2(4, -6, "19:00", "no_show"); force2(8, -25, "20:30", "no_show"); force2(8, -14, "19:30", "no_show");
  /* Клиент 3 днес: закъснява (30-60 мин преди часа на прототипа), за да се види „Неявили се“ */
  var late = Math.max(660, Math.min(1290, Math.floor((NOWM - 30) / 30) * 30));
  out.push({id:"r" + (id++), date:TODAY, time:hm(NOWM > 690 ? late : 720), people:3, table:"S3", zone:"salon", name:"Клиент 3", phone:phoneOf(2), occasion:"Рожден ден", note:"", marketing:false, status:"confirmed", createdAt:isoAt(addD(TODAY, -3), 1105), sample:true});
  out.sort(function(a, b){ return (a.date + a.time < b.date + b.time) ? -1 : 1; });
  A.data.set("reservations", out);
  if (force || !A.data.get("blocks", null)){ var bl = {};
    bl[phoneOf(4)] = {status:"pending", name:"Клиент 5", count:2, at:isoAt(addD(TODAY, -6), 1262)};
    bl[phoneOf(8)] = {status:"blocked", name:"Клиент 9", count:2, at:isoAt(addD(TODAY, -13), 1125), by:"Управител 1"};
    A.data.set("blocks", bl); }
  return out; };

/* обратна връзка: „Пишете ни“ и отговорите след оценка „Не“ (запитванията за ваучер и рожден ден са в sa-feedback-iq, _seed-orders.js)
   sa-feedback: [{id, topic:"contact"|"rating", name, contact:"0888123456"|"ime@primer.bg", orderNo?, message, status:"new"|"done", createdAt:ISO}] */
S.feedback = function(force){ if (!force && A.data.get("feedback", null)) return A.data.get("feedback"); var T = R.today(), NM = R.nowMin();
  function at(d, m){ if (!d) m = Math.min(m, NM - 20); return isoAt(addD(T, -d), m); }
  var v = [
    {id:"f1", topic:"rating", name:"Клиент 12", contact:R.phoneOf(11), orderNo:"1047", message:"Примерен отговор на „Как да подобрим обслужването?“ след оценка „Не“.", status:"new", createdAt:at(0, 1110)},
    {id:"f2", topic:"contact", name:"Гост без профил", contact:"gost@primer.bg", message:"Примерно съобщение от формата „Пишете ни“ на страницата „Контакти“.", status:"new", createdAt:at(1, 1335)},
    {id:"f5", topic:"contact", name:"Клиент 21", contact:R.phoneOf(20), message:"Примерно съобщение от формата „Пишете ни“.", status:"done", createdAt:at(5, 860)},
    {id:"f6", topic:"rating", name:"Клиент 30", contact:R.phoneOf(29), orderNo:"1031", message:"Примерен отговор на „Как да подобрим обслужването?“.", status:"done", createdAt:at(9, 1270)}];
  A.data.set("feedback", v); return v; };

/* клиенти: 36 профила „Клиент N“ с поръчки от истинските ястия, в работно време, до часа на прототипа
   sa-customers: [{id:"c1", name, phone, email, since:ISO, consent:{marketing, birthday, bday:"8.6"}, orders:[{no, at:ISO, ch:"Доставка"|"Вземане"|"Маса"|"Офис", lines:[[брой, id]]}], bonusUsed, sample:true}] */
S.customers = function(force){ if (!force && A.data.get("customers", null)) return A.data.get("customers");
  var DAY = 864e5, NOW = (A.now ? A.now() : new Date()).getTime(), CH = ["Доставка","Вземане","Маса","Офис"], phoneOf = R.phoneOf, out = [];
  var MAIN = SC.items.filter(function(x){ return ["pitsi","skara-bertha","osnovni-yastia","burgeri","pasta-i-rizoto"].indexOf(x.cat) > -1 && !x.per100; }), SIDE = SC.items.filter(function(x){ return ["salati","deserti","garnituri"].indexOf(x.cat) > -1; });
  for (var i = 0; i < 36; i++){ var r = rng("cu" + i), since = NOW - Math.floor(r() * r() * 300 + 3) * DAY, n = Math.floor(r() * 9), orders = [];
    for (var k = 0; k < n; k++){ var day = R.addDays(R.today(), -Math.max(1, Math.floor(r() * (NOW - since) / DAY))), at = isoAt(day, 600 + Math.floor(r() * 690)), lines = [[1 + Math.floor(r() * 2), MAIN[Math.floor(r() * MAIN.length)].id], [1, SIDE[Math.floor(r() * SIDE.length)].id]];
      orders.push({no:String(1000 + Math.floor(r() * 60) + k * 7 + i), at:at, ch:CH[Math.floor(r() * (r() < .6 ? 2 : 4))], lines:lines}); }
    orders.sort(function(a, b){ return a.at < b.at ? 1 : -1; });
    var mk = r() < .32, bd = r() < .2;
    out.push({id:"c" + (i + 1), name:"Клиент " + (i + 1), phone:phoneOf(i), email:r() < .55 ? "klient" + (i + 1) + "@primer.bg" : "", since:new Date(since).toISOString(), consent:{marketing:mk, birthday:bd, bday:bd ? (1 + Math.floor(r() * 28)) + "." + (1 + Math.floor(r() * 12)) : ""}, orders:orders, bonusUsed:n > 0 && r() < .7, sample:true}); }
  A.data.set("customers", out); return out; };

S.settings(); S.reservations(); S.feedback(); S.customers();
})();
