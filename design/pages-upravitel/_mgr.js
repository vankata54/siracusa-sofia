/* Siracusa · Управител: рамката на модула (MG). Зарежда се след ../ds/icons.js, ../data/menu.js, ../ds/sc.js (без SC.mount),
   ../pages-admin/_admin.js, _seed-orders.js, _res-lib.js, _seed-res.js (без A.mount), _seed-shift.js, ../pages-admin/_pencil.js и _pen-mount.js.
   - MG.mount({page, title, states}) рисува горната лента, долната лента (телефон) или лявата лента (компютър), лентата „Няма връзка“,
     панела „Само в прототипа“ и молива; връща <main> или null (без сесия: към входа; друга роля: в своя модул).
   - Данните са само ключовете на админа през A (sa-orders, sa-reservations, sa-settings, sa-soldout, sa-tables, sa-blocks, sa-audit)
     и sa-shift (_seed-shift.js). Всяко действие пише там и в дневника (A.audit), с „Отмени“.
   - Свои MG.sheet, MG.toast, MG.confirm: A.sheet и A.toast искат рамката на админа (A.mount). */
(function(){
"use strict";
var A = window.A, SH = A.sh, ic = SC.ic, esc = SC.esc, fmt = SC.fmt;
var MG = window.MG = {ic:ic, esc:esc, fmt:fmt};
var MIN = 60000;
MG.ROLES = ["admin","owner","manager"];
MG.PAGES = [["now","Сега","clock","now.html"],["hall","Залата","chair","hall.html"],["team","Екипът","users-three","team.html"],["more","Още","dots-three","more.html"]];
MG.STATES = [["normal","Обичайно"],["rush","Вечерен пик"],["calm","Нищо не чака"],["offline","Без връзка"],["loading","Зареждане"],["error","Грешка"],["noperm","Без права"]];
MG.st = A.st || "";
MG.offline = MG.st === "offline";
MG.ADMIN = "../pages-admin/";
function now(){ return A.now(); }
function nowMs(){ return A.now().getTime(); }
function iso(ms){ return new Date(ms == null ? nowMs() : ms).toISOString(); }
MG.now = now;
MG.mmss = function(sec){ sec = Math.max(0, Math.floor(sec)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; };
MG.secSince = function(t){ return (nowMs() - (typeof t === "number" ? t : new Date(t).getTime())) / 1000; };
MG.agoMin = function(t){ var m = Math.max(0, Math.round(MG.secSince(t) / 60)); return m < 1 ? "току-що" : m < 60 ? "преди " + m + " мин" : "преди " + Math.floor(m / 60) + " ч." + (m % 60 ? " " + (m % 60) + " мин" : ""); };
MG.hm = function(t){ return A.hm(new Date(t)); };
MG.who = function(){ return A.me ? A.me.name : "Управител"; };
/* „Към админа“: за управителя сменя запомнения избор (data-home="admin", _admin.js); за собственика не (той е тук като гост, „Смяната сега“) */
MG.isOwner = function(){ return !!A.me && A.me.role === "owner"; };
MG.homeAttr = function(){ return MG.isOwner() ? ' data-keephome' : ' data-home="admin"'; };
MG.OWN = "../pages-sobstvenik/today.html";
/* връзките с data-keephome не минават през правилото за запомнения избор в _admin.js (то слуша click на document) */
window.addEventListener("click", function(e){ if (e.target && e.target.closest && e.target.closest("[data-keephome]")) e.stopPropagation(); }, true);

/* ---------- данни ---------- */
MG.shift = function(){ return A.data.get("shift", null) || A.seed.shift(); };
MG.saveShift = function(s){ A.data.set("shift", s); };
MG.ordersDoc = function(){ var d = A.data.get("orders", null); if (!d || !d.list) d = A.seed.orders(); return d; };
MG.saveOrders = function(d){ A.data.set("orders", d); };
MG.order = function(no){ return A.orders().filter(function(o){ return o.no === String(no); })[0] || null; };
MG.waiterOf = function(n, s){ s = s || MG.shift(); return (s.waiters || []).filter(function(w){ return w.tables.indexOf(+n) > -1; })[0] || null; };
MG.tableByN = function(n){ return A.tables().filter(function(t){ return +t.n === +n; })[0] || null; };
MG.ZONE = {salon:"Салон", garden:"Градина"};
MG.callMgr = function(){ var s = A.settings(); return (+s.callManager > 0 ? +s.callManager : 5); };
MG.QR_MIN = 3; /* след колко минути непотвърдената QR поръчка е проблем (условно, [ЛИПСВА] в README) */
MG.WHY = {call:["Вика","hand-waving"], bill:["Сметка","receipt"]};
/* резервациите днес, които още предстоят (или закъсняват до 60 мин). Минал час, а масата е заета: гостите са дошли, не „закъсняват“ */
MG.resMin = function(r){ var t = r.time.split(":"); return +t[0] * 60 + +t[1]; };
MG.resAhead = function(){ var nm = A.minutes(), seated = SH.seated(MG.shift()), byId = {}; A.tables().forEach(function(t){ byId[t.id] = +t.n; });
  return A.reservations().filter(function(r){ if (r.date !== A.todayKey() || (r.status !== "new" && r.status !== "confirmed")) return false; var m = MG.resMin(r);
    if (m < nm && r.table && seated[byId[r.table]]) return false; return m >= nm - 60; }).sort(function(a, b){ return a.time < b.time ? -1 : 1; }); };

/* масите сега: статус с дума и икона, чий сервитьор, от кога, сума, следваща резервация (само бъдещ час) */
MG.TST = {call:["Вика","hand-waving"], bill:["Сметка","receipt"], qr:["QR поръчка","qr-code"], ready:["Готово","chef-hat"], wait:["Чака поръчка","hourglass"], busy:["Заета","users"], res:["Резервирана","calendar-check"], free:["Свободна","check-circle"]};
MG.tableStates = function(){ var s = MG.shift(), seated = SH.seated(s), nm = A.minutes(), ahead = MG.resAhead().filter(function(r){ return MG.resMin(r) >= nm; });
  return A.activeTables().map(function(t){ var n = +t.n, se = seated[n], orders = se ? SH.tableOrders(n, se.since) : [], sum = orders.reduce(function(a, o){ return a + SH.total(o); }, 0);
    var call = (s.calls || []).filter(function(c){ return c.n === n && !c.taken; }).sort(function(a, b){ return a.at < b.at ? -1 : 1; })[0] || null;
    var q = (s.qr || []).filter(function(x){ return x.n === n; })[0] || null, ready = orders.some(function(o){ return o.status === "ready"; });
    var next = ahead.filter(function(r){ return r.table === t.id; })[0] || null;
    var st = call ? call.why : q ? "qr" : ready ? "ready" : se ? (orders.length ? "busy" : "wait") : next && MG.resMin(next) - nm <= 60 ? "res" : "free";
    return {t:t, n:n, zone:t.zone, st:st, seated:se || null, orders:orders, sum:Math.round(sum * 100) / 100, call:call, qr:q, next:next, waiter:MG.waiterOf(n, s), walkin:t.walkin !== false}; }); };

/* изчерпаните ястия в поръчка (A.soldOutToday, като в админа) */
MG.outLines = function(o, out0){ out0 = out0 || A.soldOutToday(); return o.lines.filter(function(l){ return out0.indexOf(l.id) > -1; }); };
MG.outNames = function(o, out0){ return MG.outLines(o, out0).map(function(l){ return SC.byId[l.id].n; }).filter(function(x, i, a){ return a.indexOf(x) === i; }).join(", "); };

/* „Проблеми сега“: подредени по спешност; всеки с дума, икона, едно число (колко чака или колко закъснява) и едно действие.
   Закъснялата доставка расте два пъти по-бързо, за да не остане зад „Покажи още“. Решените закъснения остават най-долу като „решено“
   (числото „Закъсняват“ в пулса е същото като в админа). */
MG.problems = function(){ var s = MG.shift(), out = [], ack = s.ack || {}, lim = MG.callMgr(), out0 = A.soldOutToday();
  (s.calls || []).forEach(function(c){ if (c.taken) return; var sec = MG.secSince(c.at); if (sec < lim * 60) return; var w = MG.waiterOf(c.n, s);
    out.push({key:"call:" + c.id, kind:"call", sev:100 + sec / 60, cls:"hot", icon:MG.WHY[c.why][1], title:"Маса " + c.n + " · " + MG.WHY[c.why][0], meta:(w ? w.name + " не е отговорил" : "Никой не е отговорил") + " · изпратено на теб", since:c.at, tl:"чака", id:c.id, n:c.n, w:w}); });
  (s.qr || []).forEach(function(q){ var sec = MG.secSince(q.at); if (sec < MG.QR_MIN * 60) return; var w = MG.waiterOf(q.n, s);
    out.push({key:"qr:" + q.id, kind:"qr", sev:80 + sec / 60, cls:"hot", icon:"qr-code", title:"Маса " + q.n + " · QR поръчка", meta:A.plural(q.lines.reduce(function(a, l){ return a + l.q; }, 0), "ястие", "ястия") + " · никой не я е потвърдил" + (q.assigned ? " · възложена на " + q.assigned : w ? " · " + w.name : ""), since:q.at, tl:"чака", id:q.id, n:q.n, w:w}); });
  (s.asks || []).forEach(function(a){ var o = MG.order(a.no);
    out.push({key:"ask:" + a.id, kind:"ask", sev:85 + MG.secSince(a.at) / 60, cls:"warn", icon:"map-pin", title:a.driver + " · адрес извън зоните", meta:"№ " + a.no + (o && o.addr ? " · " + o.addr : "") + " · пита какво да прави", since:a.at, tl:"пита", id:a.id, no:a.no}); });
  A.orders().forEach(function(o){ if (o.status !== "accepted" && o.status !== "cooking") return; if (o.channel === "table") return;
    var names = MG.outNames(o, out0); if (!names || ack["out:" + o.no]) return;
    out.push({key:"out:" + o.no, kind:"out", sev:95, cls:"ember", icon:"warning", title:"№ " + o.no + " · Изчерпано: " + names, meta:SH.chName(o) + " · " + (o.name || "") + " · " + (o.status === "accepted" ? "чака „Приеми“" : "в кухнята") + " · обади се и предложи друго", no:o.no}); });
  A.orders().forEach(function(o){ if (!SH.late(o)) return; var lm = SH.lateMin(o), road = o.status === "on_way", done = ack["late:" + o.no];
    var secs = o.lines.map(function(l){ return SH.secOf(l.id); }).filter(function(x, i, a){ return x && a.indexOf(x) === i; }).map(function(id){ return SH.SECTIONS.filter(function(x){ return x.id === id; })[0].n; });
    var title = (o.channel === "table" ? "Маса " + o.table + " · № " + o.no : SH.chName(o) + " № " + o.no) + " · закъснява " + lm + " мин";
    var meta = (road ? "На път · " + (o.driver || "шофьор") + (o.zone ? " · " + o.zone : "") : SH.LABEL[o.status] + " · " + secs.join(", ")) + " · приета " + o.placedAt;
    out.push({key:"late:" + o.no, kind:"late", sev:done ? -1 : (o.mode === "delivery" ? 70 + 2 * lm : 60 + lm), cls:done ? "solved" : "warn", icon:road ? "moped" : o.channel === "table" ? "chair" : "chef-hat", title:title, meta:done ? meta + " · " + (done.what || "решено") + " " + MG.hm(done.at) : meta, no:o.no, table:o.channel === "table", done:!!done}); });
  return out.sort(function(a, b){ return b.sev - a.sev; }); };

/* „Чака те“: същото правило като таблото на админа (поръчки за приемане, резервации за потвърждаване, неявили се, препоръки) */
MG.waits = function(){ var W = {orders:[], res:[], blocks:[], notes:null};
  if (A.can("orders")) W.orders = A.orders().filter(function(o){ return o.status === "accepted"; }).sort(function(a, b){ return a.ts - b.ts; });
  if (A.can("reservations")) W.res = A.reservationsToday().filter(function(r){ return r.status === "new"; }).sort(function(a, b){ return a.time < b.time ? -1 : 1; });
  if (A.can("reservations") && MG.ROLES.indexOf(A.me.role) > -1){ var bl = A.data.get("blocks", {}) || {}; W.blocks = Object.keys(bl).filter(function(k){ return bl[k] && bl[k].status === "pending"; }).map(function(k){ return {phone:k, b:bl[k]}; }); }
  var nw = A.notesWaiting(); if (nw.n) W.notes = nw;
  W.n = W.orders.length + W.res.length + W.blocks.length + (W.notes ? W.notes.n : 0); return W; };

/* кухнята: по секции (чакат, закъсняват), таблетът, „Натоварено“, изчерпано днес */
MG.kitchen = function(){ var s = MG.shift(), work = A.orders().filter(function(o){ return o.status === "accepted" || o.status === "cooking"; });
  return SH.SECTIONS.map(function(sec){ var mine = work.filter(function(o){ return o.lines.some(function(l){ return SH.secOf(l.id) === sec.id; }); });
    var k = (s.kitchen || {})[sec.id] || {online:true};
    return {sec:sec, wait:mine.length, late:mine.filter(SH.late).length, online:k.online !== false, seen:k.seen}; }); };
MG.kitchenOpen = function(){ var m = A.minutes(); return m >= 600 && m < 1350; };

/* шофьорите: статус, курсът (номера и адреси по ред), пари в брой за предаване */
MG.drivers = function(){ var s = MG.shift(), all = A.orders();
  return (s.drivers || []).map(function(d){ var road = all.filter(function(o){ return o.driver === d.name && o.status === "on_way"; }).sort(function(a, b){ return a.ts - b.ts; });
    var done = all.filter(function(o){ return o.driver === d.name && o.status === "delivered"; }), last = done.map(function(o){ return new Date(o.times.delivered).getTime(); }).sort().pop();
    var st = road.length ? "road" : last && nowMs() - last < 15 * MIN ? "back" : "home";
    var cash = done.filter(function(o){ return o.pay === "cash"; }).reduce(function(a, o){ return a + SH.total(o); }, 0);
    return {d:d, st:st, road:road, done:done, cash:Math.round(cash * 100) / 100}; }); };
MG.DST = {road:["На път","moped"], back:["Връща се","arrow-counter-clockwise"], home:["В ресторанта","storefront"]};
MG.shiftOver = function(){ return A.minutes() >= 1380; };

/* значката на „Сега“ брои всяко нещо веднъж (поръчка с изчерпано е и проблем, и „Приеми“: брои се веднъж) */
MG.counts = function(){ var ts = MG.tableStates(), s = MG.shift(), p = MG.problems().filter(function(x){ return !x.done; }), w = MG.waits(), nm = A.minutes(), end = Math.min(nm + 120, 1380);
  var dup = p.filter(function(x){ return x.kind === "out" && w.orders.some(function(o){ return o.no === x.no; }); }).length;
  return {tables:ts.length, seated:ts.filter(function(x){ return !!x.seated; }).length, salon:ts.filter(function(x){ return x.seated && x.zone === "salon"; }).length, garden:ts.filter(function(x){ return x.seated && x.zone === "garden"; }).length,
    inWork:A.ordersInWork().length, late:A.orders().filter(SH.late).length, calls:(s.calls || []).filter(function(c){ return !c.taken; }).length,
    res2:MG.resAhead().filter(function(r){ var m = MG.resMin(r); return m >= nm && m <= end; }).length, resEnd:end, closed:nm >= 1380 || nm < 600, probs:p.length, waits:w.n, now:p.length + w.n - dup}; };

/* ---------- действия (пишат в ключовете на админа и в дневника; всяко с „Отмени“) ---------- */
function offTxt(t){ return MG.offline ? t + " Записано на телефона, тръгва само, щом има връзка." : t; }
MG.done = function(text, undo, extra){ MG.toast(offTxt(text), Object.assign({undo:undo ? function(){ undo(); MG.refresh(); } : null}, extra || {})); MG.refresh(); };
function withOrders(fn){ var d = MG.ordersDoc(); var r = fn(d); MG.saveOrders(d); return r; }
/* „Приеми“: поръчка с изчерпано ястие не отива тихо в кухнята (лист „В поръчката има изчерпано“) */
MG.accept = function(no, force){ var o0 = MG.order(no); if (!o0) return; if (!force && MG.outLines(o0).length){ MG.outSheet(o0); return; }
  var prev, drop = force === "without" ? MG.outLines(o0).map(function(l){ return l.id; }) : [], names = MG.outNames(o0);
  withOrders(function(d){ var o = d.list.filter(function(x){ return x.no === no; })[0]; if (!o || o.status !== "accepted") return; prev = JSON.parse(JSON.stringify(o));
    if (drop.length){ o.lines = o.lines.filter(function(l){ return drop.indexOf(l.id) < 0; }); Object.assign(o, A.seed.sums(o)); o.note = ((o.note ? o.note + " " : "") + "Без „" + names + "“ (изчерпано днес), клиентът е уведомен.").trim(); }
    o.status = "cooking"; o.times.cooking = iso(); });
  if (!prev) return; var al = A.data.get("order-alert", null); if (al && al.no === no) A.data.del("order-alert");
  A.audit("order.status", "№ " + no + ": Готви се (приета от модула „Управител“" + (drop.length ? ", без „" + names + "“, изчерпано днес" : "") + ")", no);
  MG.done("№ " + no + " е приета" + (drop.length ? " без „" + names + "“" : "") + " · Готви се", function(){ withOrders(function(d){ d.list.forEach(function(o, i){ if (o.no === no) d.list[i] = prev; }); }); A.audit("order.status", "Отменено: № " + no + " отново „Приета“", no); }); };
MG.confirmRes = function(id){ var rs = A.data.get("reservations", []), r = rs.filter(function(x){ return x.id === id; })[0]; if (!r) return; var was = r.status; r.status = "confirmed"; A.data.set("reservations", rs);
  var txt = "Резервация " + r.name + ", " + A.fmtDate(new Date(r.date + "T12:00:00"), true) + " " + r.time; A.audit("reservation.status", txt + ": Нова → Потвърдена", r.id);
  MG.done(r.name + " · " + r.time + " е потвърдена", function(){ var l = A.data.get("reservations", []); l.forEach(function(x){ if (x.id === id) x.status = was; }); A.data.set("reservations", l); A.audit("reservation.status", txt + ": върнато „Нова“", id); }); };
MG.decideBlock = function(phone, block){ var bl = A.data.get("blocks", {}) || {}, b = bl[phone]; if (!b) return; var who = b.name || "";
  if (block){ b.status = "blocked"; b.at = iso(); b.by = MG.who(); A.audit("customer.block", "Блокиран номер " + A.maskPhone(phone) + " (" + who + ")", phone); }
  else { delete bl[phone]; A.audit("customer.block", "Не е блокиран: " + A.maskPhone(phone) + " (" + who + ")", phone); }
  A.data.set("blocks", bl);
  /* без „Отмени“ (решение 16.11): ядрото не връща точно предишното; потвърждението е в листа */
  MG.done(block ? who + ": номерът е блокиран за резервации. Отблокира се от „Резервации“ в админа." : who + ": без блокиране", null); };
MG.takeCall = function(id, by){ var s = MG.shift(), c = (s.calls || []).filter(function(x){ return x.id === id; })[0]; if (!c) return; var mine = by === MG.who();
  c.taken = {by:by, at:iso(), assigned:!mine}; MG.saveShift(s);
  A.audit("call.take", "Маса " + c.n + ": " + (mine ? "поема " + by : "възложено на " + by), "table-" + c.n);
  MG.done(mine ? "Маса " + c.n + ": отиваш ти. Сервитьорът вижда, че е поето." : "Маса " + c.n + ": възложено на " + by + ". Получава известие.", function(){ var s2 = MG.shift(); s2.calls.forEach(function(x){ if (x.id === id) x.taken = null; }); MG.saveShift(s2); A.audit("call.take", "Отменено: Маса " + c.n, "table-" + c.n); }); };
MG.assignQR = function(id, by){ var s = MG.shift(), q = (s.qr || []).filter(function(x){ return x.id === id; })[0]; if (!q) return; var was = q.assigned || null; q.assigned = by; MG.saveShift(s);
  A.audit("call.take", "QR поръчка на Маса " + q.n + ": възложено на " + by, "table-" + q.n);
  MG.done("QR поръчката на Маса " + q.n + " е възложена на " + by + ". Получава известие.", function(){ var s2 = MG.shift(); s2.qr.forEach(function(x){ if (x.id === id) x.assigned = was; }); MG.saveShift(s2); A.audit("call.take", "Отменено: QR на Маса " + q.n, "table-" + q.n); }); };
MG.confirmQR = function(id){ var s = MG.shift(), qi = -1; (s.qr || []).forEach(function(x, i){ if (x.id === id) qi = i; }); if (qi < 0) return; var q = s.qr[qi], w = MG.waiterOf(q.n, s), no;
  withOrders(function(d){ no = String(Math.max.apply(null, [1041].concat(d.list.map(function(o){ return +o.no || 0; }))) + 1); var t = now();
    var o = {no:no, ts:t.getTime(), placedAt:A.hm(t), channel:"table", mode:"pickup", table:String(q.n), name:"Маса " + q.n, phone:"", qr:true, waiter:w ? w.name : "", lines:q.lines.map(function(l){ return {id:l.id, q:l.q, mods:[]}; }), pay:"cash", status:"cooking", times:{accepted:t.toISOString(), cooking:t.toISOString()}, sample:true};
    Object.assign(o, A.seed.sums(o)); d.list.push(o); });
  s.qr.splice(qi, 1); MG.saveShift(s);
  A.audit("order.status", "№ " + no + ": QR поръчка на Маса " + q.n + " потвърдена от модула „Управител“, Готви се", no);
  MG.done("Маса " + q.n + ": поръчката е в кухнята · № " + no, function(){ withOrders(function(d){ d.list = d.list.filter(function(o){ return o.no !== no; }); }); var s2 = MG.shift(); s2.qr.splice(qi, 0, q); MG.saveShift(s2); A.audit("order.status", "Отменено: № " + no + " (QR на Маса " + q.n + " чака пак)", no); }); };
MG.ack = function(key, text, auditKey, target, what){ var s = MG.shift(); s.ack = s.ack || {}; s.ack[key] = {at:iso(), by:MG.who(), what:what || "решено"}; MG.saveShift(s); A.audit(auditKey || "order.note", text, target || key);
  MG.done(text, function(){ var s2 = MG.shift(); delete s2.ack[key]; MG.saveShift(s2); A.audit(auditKey || "order.note", "Отменено: " + text, target || key); }); };
MG.answerAsk = function(id, text){ var s = MG.shift(), i = -1; (s.asks || []).forEach(function(x, j){ if (x.id === id) i = j; }); if (i < 0) return; var a = s.asks.splice(i, 1)[0]; MG.saveShift(s);
  A.audit("order.note", "№ " + a.no + ": " + text + " (" + a.driver + ")", a.no);
  MG.done(a.driver + ": " + text, function(){ var s2 = MG.shift(); s2.asks.splice(i, 0, a); MG.saveShift(s2); A.audit("order.note", "Отменено: № " + a.no + ": " + text, a.no); }); };
MG.setBusy = function(on){ var all = A.data.get("settings", null) || A.seed.settings(), prev = JSON.parse(JSON.stringify(all.kitchen || {})), k = all.kitchen = Object.assign({busy:false, etaMin:35, etaBusyMin:55}, all.kitchen || {});
  k.busy = !!on; k.busyAt = on ? iso() : null; k.busyBy = on ? MG.who() : null; A.data.set("settings", all);
  A.audit("settings.update", "„Натоварено“: " + (on ? "включено" : "изключено") + " (от модула „Управител“)", "kitchen.busy");
  MG.done(on ? "„Натоварено“ е включено: „Възможни са закъснения · около " + k.etaBusyMin + "\u00a0мин“." : "„Натоварено“ е изключено: „около " + k.etaMin + "\u00a0мин“.", function(){ var a2 = A.data.get("settings", {}); a2.kitchen = prev; A.data.set("settings", a2); A.audit("settings.update", "Отменено: „Натоварено“ " + (prev.busy ? "включено" : "изключено"), "kitchen.busy"); }); };
/* „Върни“ изчерпано: същото правило като menu.html (sa-soldout {date, ids, back}) */
function soldDoc(){ var d = A.data.get("soldout", {date:"", ids:[], back:[]}); if (!d || d.date !== A.todayKey()) d = {date:A.todayKey(), ids:[], back:[]}; d.ids = d.ids || []; d.back = d.back || []; return d; }
function setOut(id, out){ var d = soldDoc(), b = SC.byId[id], data = !!(b && SC.isOut(b)); d.ids = d.ids.filter(function(x){ return x !== id; }); d.back = d.back.filter(function(x){ return x !== id; });
  if (out && !data) d.ids.unshift(id); if (!out && data) d.back.push(id); A.data.set("soldout", d); }
MG.backIn = function(id){ var x = SC.byId[id]; setOut(id, false); A.audit("menu.back", "Отново в менюто: " + x.n, id);
  MG.done("„" + x.n + "“ е отново в менюто", function(){ setOut(id, true); A.audit("menu.sold_out", "Изчерпано днес: " + x.n, id); }); };
MG.setTables = function(wid, list){ var s = MG.shift(), prev = JSON.stringify(s.waiters), w = s.waiters.filter(function(x){ return x.id === wid; })[0]; if (!w) return;
  var moved = []; s.waiters.forEach(function(o){ if (o.id === wid) return; o.tables = o.tables.filter(function(n){ if (list.indexOf(n) > -1){ moved.push(n); return false; } return true; }); });
  var dropped = w.tables.filter(function(n){ return list.indexOf(n) < 0; }), other = s.waiters.filter(function(o){ return o.id !== wid; })[0];
  if (other && dropped.length) other.tables = other.tables.concat(dropped).sort(function(a, b){ return a - b; });
  w.tables = list.slice().sort(function(a, b){ return a - b; }); MG.saveShift(s);
  A.audit("shift.tables", "Масите на " + w.name + ": " + w.tables.join(", "), wid);
  MG.done("Масите на " + w.name + " са сменени. " + w.name + (other && (moved.length || dropped.length) ? " и " + other.name + " получават известие." : " получава известие."), function(){ var s2 = MG.shift(); s2.waiters = JSON.parse(prev); MG.saveShift(s2); A.audit("shift.tables", "Отменено: масите на " + w.name, wid); }); };
MG.setWalkin = function(n, allow){ var d = A.rl ? A.rl.tables() : {tables:A.tables()}, prev = JSON.stringify(d); d.tables.forEach(function(t){ if (+t.n === +n) t.walkin = allow; }); A.data.set("tables", d);
  A.audit("hall.update", "Маса " + n + ": " + (allow ? "отново и за гости без резервация" : "само с резервация"), "table-" + n);
  MG.done(allow ? "Маса " + n + " е отново и за гости без резервация" : "Маса " + n + " е само с резервация", function(){ A.data.set("tables", JSON.parse(prev)); A.audit("hall.update", "Отменено: Маса " + n + (allow ? " само с резервация" : " и за гости без резервация"), "table-" + n); }); };

/* ---------- лист, потвърждение, известие ---------- */
var hideReasons = {};
function penHide(k, on){ if (on) hideReasons[k] = 1; else delete hideReasons[k]; document.documentElement.classList.toggle("mg-hidepen", Object.keys(hideReasons).length > 0); }
MG.penHide = penHide;
MG.sheet = function(o){ var ov = MG.ov || document.body, w = document.createElement("div"), id = "mgs" + Math.random().toString(36).slice(2, 7); w.className = "mg-sheetwrap";
  w.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="mg-sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle" aria-hidden="true"></div><div class="sh"><h2 id="' + id + '" tabindex="-1">' + esc(o.title || "") + '</h2><button class="mg-x" type="button" data-close>' + ic("x", 20) + 'Затвори</button></div><div class="body">' + (o.html || "") + '</div>' + (o.foot ? '<div class="sfoot">' + o.foot + '</div>' : '') + '</div>';
  ov.appendChild(w); penHide("sheet", true);
  var prev = document.activeElement, bg = [MG.app && MG.app.querySelector(".mg-col"), MG.app && MG.app.querySelector(".mg-nav"), MG.app && MG.app.querySelector(".mg-rail")].filter(Boolean); bg.forEach(function(el){ el.inert = true; });
  var closed = false;
  function close(){ if (closed) return; closed = true; w.classList.add("closing"); var others = document.querySelectorAll(".mg-sheetwrap:not(.closing)").length > 0; if (!others) bg.forEach(function(el){ el.inert = false; }); penHide("sheet", others); w.classList.remove("on"); document.removeEventListener("keydown", key, true); setTimeout(function(){ w.remove(); }, 340); o.onClose && o.onClose(); prev && prev.focus && prev.focus({preventScroll:true}); }
  function key(e){ if (e.key === "Escape"){ e.preventDefault(); close(); return; } if (e.key !== "Tab") return;
    var f = Array.prototype.filter.call(w.querySelectorAll(".mg-sheet button:not([disabled]), .mg-sheet a[href], .mg-sheet input:not([disabled]), .mg-sheet textarea, .mg-sheet select"), function(el){ return el.offsetParent !== null; });
    if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } }
  document.addEventListener("keydown", key, true);
  w.querySelector(".scrim").onclick = close; w.querySelector("[data-close]").onclick = close;
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); var f = o.focus ? w.querySelector(o.focus) : w.querySelector(".sh h2"); f && f.focus({preventScroll:true}); }); });
  return {el:w, body:w.querySelector(".body"), foot:w.querySelector(".sfoot"), close:close}; };
MG.confirm = function(o, onOk){ var s = MG.sheet({title:o.title, html:o.html || '<p>' + esc(o.text || "") + '</p>',
  foot:'<button class="pill pill-line pill-lg" type="button" data-no>' + esc(o.no || "Откажи") + '</button><button class="pill ' + (o.danger ? 'pill-red' : 'pill-ink') + ' pill-lg" type="button" data-yes>' + (o.icon ? ic(o.icon, 22) : '') + esc(o.ok || "Да") + '</button>'});
  s.foot.querySelector("[data-no]").onclick = s.close; s.foot.querySelector("[data-yes]").onclick = function(){ s.close(); onOk && onOk(); }; return s; };
var toastT;
MG.toast = function(text, o){ o = o || {}; var t = document.querySelector(".mg-toast");
  if (!t){ t = document.createElement("div"); t.className = "mg-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); (MG.ov || document.body).appendChild(t); }
  var acts = (o.action ? (o.action.href ? '<a class="sec" href="' + esc(o.action.href) + '">' + esc(o.action.label) + ic("caret-right", 18) + '</a>' : '<button class="sec" type="button" data-ta>' + esc(o.action.label) + '</button>') : '') + (o.undo ? '<button type="button" data-tu>' + ic("arrow-counter-clockwise", 18) + esc(o.undoLabel || "Отмени") + '</button>' : '');
  t.innerHTML = '<span class="tx">' + esc(text) + '</span>' + (acts ? '<span class="acts">' + acts + '</span>' : ''); t.classList.toggle("solo", !acts);
  var u = t.querySelector("[data-tu]"); if (u) u.onclick = function(){ t.classList.remove("on"); o.undo(); MG.toast("Отменено"); };
  var a = t.querySelector("[data-ta]"); if (a) a.onclick = function(){ t.classList.remove("on"); o.action.fn(); };
  requestAnimationFrame(function(){ t.classList.add("on"); }); clearTimeout(toastT);
  toastT = setTimeout(function(){ t.classList.remove("on"); }, o.ms || (o.undo ? 6000 : 3400)); };

/* ---------- звук за нова онлайн поръчка (като в админа: sa-sound, двоен тон; на „ти“: „Звук: докосни“ до първото докосване) ----------
   Собственикът е без звук (решение 16.11): ключът е за управителя и главния админ. */
MG.hasSound = function(){ return A.can("orders") && A.me && A.me.role !== "owner"; };
function soundLabel(){ return !A.soundOn() ? ["Звук изкл.", "bell"] : A.audioReady ? ["Звук вкл.", "bell-ringing"] : ["Звук: докосни", "bell"]; }
MG.syncSound = function(){ var l = soundLabel(); document.querySelectorAll("[data-mg=sound]").forEach(function(b){ b.setAttribute("aria-pressed", String(A.soundOn()));
  b.innerHTML = ic(l[1], 24) + '<span class="lg">' + l[0] + '</span><span class="sm">Звук</span>';
  b.setAttribute("aria-label", l[0] + ", нови онлайн поръчки"); b.title = l[0] + " · нови онлайн поръчки"; b.classList.toggle("wait", A.soundOn() && !A.audioReady); }); };
document.addEventListener("pointerdown", function(){ setTimeout(MG.syncSound, 30); }, true); document.addEventListener("keydown", function(){ setTimeout(MG.syncSound, 30); }, true);
/* нова онлайн поръчка: следи sa-orders (както watchOrders в админа); значката на „Сега“ мига, докато поръчката не е видяна */
var known = null;
function watchOrders(){ known = {}; A.orders().forEach(function(o){ known[o.no] = 1; });
  setInterval(function(){ var fresh = A.orders().filter(function(o){ return !known[o.no]; }); if (!fresh.length) return; fresh.forEach(function(o){ known[o.no] = 1; });
    var nw = fresh.filter(function(o){ return o.status === "accepted" && o.channel !== "table"; }); if (!nw.length){ MG.refresh(); return; }
    var o = nw[nw.length - 1]; A.data.set("order-alert", {no:o.no, at:Date.now()}); A.chime(); MG.refresh();
    MG.toast("Нова онлайн поръчка № " + o.no, {action:MG.page === "now" ? {label:"Виж", fn:function(){ MG.see(o.no); }} : {label:"Виж", href:"now.html#n=" + o.no}, ms:6500}); }, 1500); }
MG.see = function(no){ A.data.del("order-alert"); MG.refresh(); var r = document.querySelector('[data-wno="' + no + '"]'); if (r){ r.scrollIntoView({block:"center", behavior:"smooth"}); r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash"); var b = r.querySelector("button"); b && b.focus({preventScroll:true}); } };

/* ---------- значки ---------- */
MG.badges = function(){ if (!MG.app || MG.st === "loading" || MG.st === "error") return; var c = MG.counts(), fresh = !!A.data.get("order-alert", null);
  MG.app.querySelectorAll('[data-nb="now"]').forEach(function(el){ el.textContent = c.now; el.hidden = !c.now; el.classList.toggle("fresh", fresh);
    var v = el.parentNode.querySelector(".mg-nbv"); if (v) v.textContent = c.now ? ", " + c.now + (c.now === 1 ? " чака теб" : " чакат теб") + (fresh ? ", нова онлайн поръчка" : "") : ""; }); };

/* ---------- рамката ---------- */
/* горната лента е като в модула Собственик: заглавие; на компютър полето „Търси“, „Звук“, „Към админа“ (хапче с контур) и профилът */
function topHTML(o){ var me = A.me;
  return '<header class="mg-top"><div class="mg-tt"><h1>' + esc(o.title) + '</h1><span>Управител · Siracusa</span></div>' +
    '<div class="mg-dsearch mg-only-d" role="search"><div class="mg-q"><label class="vh" for="mg-q">Търси маса, поръчка, резервация, човек от смяната или ястие</label>' + ic("magnifying-glass", 20) +
      '<input class="input" id="mg-q" type="search" placeholder="Търси: маса, №, ястие" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="mg-dres"><span class="k" aria-hidden="true">/</span><button class="clr" type="button" data-mg="dclr" aria-label="Изчисти търсенето" hidden>' + ic("x", 18) + '</button></div>' +
      '<div class="mg-dpanel" id="mg-dres" role="listbox" aria-label="Резултати" hidden></div></div>' +
    '<button class="mg-tb mg-only-p" type="button" data-mg="find">' + ic("magnifying-glass", 24) + '<span class="sm">Търси</span></button>' +
    (MG.hasSound() ? '<button class="mg-tb mg-snd" type="button" data-mg="sound"></button>' : '') +
    (MG.isOwner() ? '<a class="pill pill-line mg-toadmin" href="' + MG.OWN + '" data-keephome>' + ic("chart-bar", 20) + 'Към Собственик</a>' : '') +
    '<a class="pill pill-line mg-toadmin" href="' + MG.ADMIN + 'dashboard.html"' + MG.homeAttr() + '>' + ic("squares-four", 20) + 'Към админа</a>' +
    '<button class="mg-me" type="button" data-mg="profile" aria-label="Профил: ' + esc(me.name) + ', ' + esc(A.roleName(me.role)) + '"><span class="av" aria-hidden="true">' + esc(A.initials(me.name)) + '</span><span class="who" aria-hidden="true"><b>' + esc(me.name) + '</b><small>' + esc(A.roleName(me.role)) + '</small></span></button></header>'; }
function navLinks(cur, cls){ var keep = MG.offline ? "#st=offline" : "";
  return MG.PAGES.map(function(p){ return '<a class="' + cls + '" href="' + p[3] + keep + '"' + (cur === p[0] ? ' aria-current="page"' : '') + '>' + ic(p[2], 26) + '<span>' + p[1] + '</span>' + (p[0] === "now" ? '<span class="vh mg-nbv"></span><span class="mg-n" data-nb="now" aria-hidden="true" hidden>0</span>' : '') + '</a>'; }).join(""); }
/* лентата „Примерни данни“, докато поръчките са от „Вечерен пик“ / „Нищо не чака“ */
function demoHTML(){ var d = SH.demo(); if (!d) return '';
  return '<div class="mg-demo" role="status">' + ic("info", 20) + '<span><b>Примерни данни: ' + SH.DEMO_NAME[d] + '</b></span><button class="pill pill-ink" type="button" data-mg="normal">' + ic("arrow-counter-clockwise", 18) + 'Върни обичайното</button></div>'; }
function protoHTML(o){ var d = SH.demo(), cur = MG.st && SH.DEMOS.indexOf(MG.st) < 0 && MG.st !== "normal" ? MG.st : (d || "normal");
  var role = A.me ? A.me.role : "";
  return '<section class="mg-proto" aria-label="Само в прототипа"><h2>' + ic("sliders-horizontal", 20) + 'Само в прототипа</h2>' +
    '<p>Състояние на екрана. „Вечерен пик“ и „Нищо не чака“ пресъздават примерните поръчки и резервации веднъж, при избора (и за админа), както смяната на часа; „Обичайно“ ги връща.</p><div class="row">' + MG.STATES.map(function(s0){
      return '<a class="chip" href="' + MG.file + '#st=' + s0[0] + '" data-mg="state"' + (s0[0] === cur ? ' aria-current="true"' : '') + '>' + esc(s0[1]) + '</a>'; }).join("") + '</div>' +
    '<p>Час на прототипа (днешната дата; смяната пресъздава поръчките, резервациите и смяната):</p><div class="row">' + A.TIMES.map(function(t){ return '<button class="chip" type="button" data-mg="ptime" data-v="' + t + '" aria-pressed="' + (A.protoTime === t) + '">' + t + '</button>'; }).join("") + '</div>' +
    '<p>Виж като:</p><div class="row">' + [["manager","Управител"],["owner","Собственик"],["admin","Главен админ"]].map(function(r){ return '<button class="chip" type="button" data-mg="viewas" data-v="' + r[0] + '" aria-pressed="' + (role === r[0]) + '">' + r[1] + '</button>'; }).join("") + '</div>' +
    '<div class="row" style="margin-top:6px">' + (A.can("orders") ? '<button class="chip" type="button" data-mg="simorder">' + ic("bell-ringing", 18) + 'Симулирай нова онлайн поръчка</button>' : '') +
    '<button class="chip" type="button" data-mg="reset">' + ic("arrow-counter-clockwise", 18) + 'Върни данните в начало</button><a class="chip" href="index.html">' + ic("list", 18) + 'Всички екрани</a></div></section>'; }

/* примерните данни от „Само в прототипа“: прилагат се веднъж, при избора; после #st= се маха от адреса, за да не се повтарят при презареждане */
function takeDemo(){ var st = MG.st; if (SH.DEMOS.indexOf(st) < 0 && st !== "normal") return;
  var ok = st === "normal" ? (SH.applyDemo("normal"), true) : SH.applyDemo(st);
  var h = Object.assign({}, A.hash); delete h.st; var q = Object.keys(h).map(function(k){ return encodeURIComponent(k) + (h[k] ? "=" + encodeURIComponent(h[k]) : ""); }).join("&");
  history.replaceState(null, "", location.pathname + (q ? "#" + q : "")); A.hash = h; MG.st = "";
  MG.demoMsg = ok ? (st === "normal" ? "" : "Примерни данни: " + SH.DEMO_NAME[st] + ". Виждат се и в админа.") : "Вечерният пик е само между 11:00 и 22:30. Смени часа в „Само в прототипа“."; }

MG.mount = function(o){ o = o || {};
  MG.page = o.page; MG.file = (MG.PAGES.filter(function(p){ return p[0] === o.page; })[0] || [0,0,0,"now.html"])[3];
  /* общата проверка (_admin.js): без сесия към входа с #next=, друга роля в своето начало */
  if (!A.guardModule("upravitel")) return null;
  takeDemo(); SH.ensure();
  /* адресът: #st= сменя състоянието (презарежда), #n= / #t= / #go= страницата обработва на място (MG.onHash) */
  A.liveHash = true;
  window.addEventListener("hashchange", function(){ var h = {}; (location.hash.slice(1) || "").split("&").forEach(function(p){ if (!p) return; var i = p.indexOf("="); if (i < 0) h[decodeURIComponent(p)] = ""; else h[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
    if ((h.st || "") !== (MG.st || "")){ location.reload(); return; } MG.onHash && MG.onHash(h); });
  document.title = o.title + " | Siracusa · Управител";
  document.body.classList.add("mg");
  var app = document.createElement("div"); app.className = "mg-app"; app.dataset.page = o.page;
  app.innerHTML = '<nav class="mg-rail" aria-label="Раздели на модула"><a class="brand" href="now.html" aria-label="Siracusa · Управител, към „Сега“"><b>Siracusa</b><small>Управител</small></a>' + navLinks(o.page, "it") + '</nav>' +
    '<div class="mg-col">' + topHTML(o) +
      (MG.offline ? '<div class="mg-net" role="status">' + ic("warning-circle", 22) + '<span>Няма връзка · Показваме данните от ' + A.hm(new Date(nowMs() - MIN)) + '</span><button type="button" data-mg="retry">' + ic("arrow-clockwise", 18) + 'Опитай пак</button></div>' : '') +
      '<div class="mg-main mg-demowrap">' + demoHTML() + '</div><main id="main" class="mg-main"></main><div class="mg-main">' + protoHTML(o) + '</div><div class="mg-end"></div></div>' +
    '<nav class="mg-nav' + (MG.offline ? ' stale' : '') + '" aria-label="Раздели на модула">' + navLinks(o.page, "") + '</nav>' +
    '<div class="mg-penslot"></div>';
  document.body.appendChild(app);
  var ov = document.createElement("div"); ov.className = "mg-ov"; document.body.appendChild(ov);
  MG.app = app; MG.ov = ov; MG.main = app.querySelector("#main");
  MG.syncSound(); watchOrders(); MG.badges();
  /* моливът: само препоръки (решение 15.11), кръг 56 px в мястото на модула (до долната лента на телефон, долу в лявата лента на компютър);
     в прегледа на админа mount връща null: тогава мястото го няма и долната лента е на цялата ширина */
  MG.pen = window.SAPenMount ? SAPenMount.mount({module:"upravitel", slot:app.querySelector(".mg-penslot")}) : null;
  if (!MG.pen) app.classList.add("nopen");
  /* „/“ фокусира търсенето на компютър */
  document.addEventListener("keydown", function(e){ if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "") && !document.querySelector(".mg-sheetwrap.on")){ var q = app.querySelector("#mg-q"); if (q && q.offsetParent){ e.preventDefault(); q.focus(); } } });
  var dq = app.querySelector("#mg-q"); if (dq) dq.addEventListener("focus", function(){ MG.loadFind(function(){ MGF.desktop(dq); }); }, {once:true});
  /* фокусът след действие: блокът, в който е било действието (страницата се рисува наново) */
  app.addEventListener("click", function(e){ var b = e.target.closest("button, a"); var blk = b && b.closest(".mg-blk[id]"); if (blk) MG.lastBlock = blk.id; }, true);
  setInterval(MG.tick, 1000); setInterval(function(){ if (!document.querySelector(".mg-sheetwrap.on, .mg-find.on") && !(dq && document.activeElement === dq)) MG.refresh(); }, 20000);
  if (MG.demoMsg) setTimeout(function(){ MG.toast(MG.demoMsg); }, 300);
  if (MG.st === "noperm"){ MG.main.innerHTML = MG.noperm(o.section || "orders"); return null; }
  return MG.main; };
MG.tick = function(){ document.querySelectorAll("[data-since]").forEach(function(el){ el.textContent = MG.mmss(MG.secSince(el.getAttribute("data-since"))); }); };
MG.render = null;
MG.onRender = function(fn){ MG.render = fn; fn(); MG.tick(); };
MG.refresh = function(){ if (MG.render && ["loading","error","noperm"].indexOf(MG.st) < 0){ var ae = document.activeElement, inMain = ae && MG.main && MG.main.contains(ae), y = window.scrollY, f = ae && ae.closest && ae.closest("[data-keep]"), fk = f && f.getAttribute("data-keep");
    MG.render(); MG.tick(); window.scrollTo(0, y);
    if (fk){ var nf = document.querySelector('[data-keep="' + fk + '"]'); nf && nf.focus({preventScroll:true}); }
    /* фокусът е паднал (бутонът е изчезнал): първото действие в същия блок, иначе заглавието на блока */
    else if ((inMain || document.activeElement === document.body) && MG.lastBlock && !document.querySelector(".mg-sheetwrap.on, .mg-find.on")){ var blk = document.getElementById(MG.lastBlock); if (blk){ var t = blk.querySelector(".mg-prob button, .mg-wrow button, .mg-orow button, .mg-rrow button") || blk.querySelector("h2"); if (t){ if (t.tagName === "H2") t.setAttribute("tabindex", "-1"); t.focus({preventScroll:true}); } } } }
  MG.badges(); };

/* ---------- общи части на страниците ---------- */
MG.skel = function(n, label){ var h = '<div class="mg-skel"><span class="vh" role="status">' + esc(label || "Зареждаме…") + '</span><div class="mg-skel" aria-hidden="true" style="margin:0"><div class="skel s"></div>'; for (var i = 0; i < (n || 3); i++) h += '<div class="skel"></div>'; return h + '</div></div>'; };
MG.error = function(text){ return '<div class="mg-banner" role="alert">' + ic("warning", 26) + '<div><b>Не успяхме да заредим смяната</b><p>' + esc(text || "Опитай пак след малко. Ако не стане, обади се на главния админ.") + '</p></div><button class="pill pill-line" type="button" data-mg="retry">' + ic("arrow-clockwise", 20) + 'Опитай пак</button></div>'; };
MG.empty = function(o){ return '<div class="mg-empty"><div class="ill' + (o.lock ? ' lock' : '') + '">' + ic(o.icon || "check-circle", 48) + '</div><h2>' + esc(o.title) + '</h2>' + (o.text ? '<p>' + o.text + '</p>' : '') + (o.action || '') + '</div>'; };
MG.noperm = function(section){ var s = A.SEC[section] || {n:section}, real = !A.can(section);
  return MG.empty({icon:"lock", lock:true, title:"Нямаш права за този екран.", text:(real ? "Ролята „" + esc(A.roleName(A.me.role)) + "“ не вижда „" + esc(s.n) + "“." : "Така изглежда екранът за роля без раздела „" + esc(s.n) + "“ (пример в прототипа).") + " Ако ти трябва, помоли главния админ.", action:MG.page === "now" ? '<a class="pill pill-ink pill-lg" href="' + MG.ADMIN + 'dashboard.html"' + MG.homeAttr() + '>' + ic("squares-four", 22) + 'Към админа</a>' : '<a class="pill pill-ink pill-lg" href="now.html">' + ic("clock", 22) + 'Към „Сега“</a>'}); };
MG.sample = function(t){ return '<span class="mg-sample">' + ic("info", 16) + esc(t || "Примерни данни") + '</span>'; };
MG.missing = function(t){ return '<span class="missing">[ЛИПСВА: ' + esc(t) + ']</span>'; };
MG.tag = function(cls, icon, word){ return '<span class="mg-tag ' + (cls || "") + '">' + (icon ? ic(icon, 16) : '') + esc(word) + '</span>'; };
MG.statusLine = function(){ var s = A.status(), cls = s[0] === "ok" ? "" : s[0] === "warn" ? " warn" : " closed";
  return '<p class="mg-day"><b>' + esc(A.fmtDate(now())) + ' · ' + A.hm(now()) + '</b><span class="st"><span class="mg-dot' + cls + '" aria-hidden="true"></span><span>' + s[1].replace(/<\/?b>/g, "") + '</span></span></p>'; };
/* лист: обади се на клиента (номерът се вижда, обаждането е от телефона; „Обадих се“ решава проблема) */
MG.callSheet = function(o, why, ackKey){ var tel = String(o.phone || "").replace(/\s/g, "");
  var s = MG.sheet({title:"Обади се на клиента", html:'<p><b>№ ' + esc(o.no) + ' · ' + esc(SH.chName(o)) + '</b><br>' + esc(why) + '</p>' +
    '<div class="mg-kv"><span>Клиент</span><b>' + esc(o.name || "") + '</b></div><div class="mg-kv"><span>Телефон</span><b class="tnum">' + esc(A.fmtPhone(o.phone)) + '</b></div>' + (o.addr ? '<div class="mg-kv"><span>Адрес</span><b>' + esc(o.addr) + '</b></div>' : '') +
    '<p class="mg-note">' + ic("info", 16) + 'Примерен клиент и телефон. В системата обаждането се записва в дневника.</p>',
    foot:'<button class="pill pill-line pill-lg" type="button" data-ok>' + ic("check", 22) + 'Готово, обадих се</button><a class="pill pill-red pill-lg" href="tel:' + esc(tel) + '" data-tel>' + ic("phone", 22) + 'Обади се</a>'});
  s.foot.querySelector("[data-tel]").addEventListener("click", function(){ A.audit("order.phone_view", "Обаждане на клиента по № " + o.no, o.no); });
  s.foot.querySelector("[data-ok]").onclick = function(){ s.close(); MG.ack(ackKey, "№ " + o.no + ": обади се на клиента", "order.call", o.no, "обади се"); }; return s; };
/* „Приеми“ на поръчка с изчерпано: обади се първо; после „Приеми без него“ (махат се само изчерпаните редове) */
MG.outSheet = function(o){ var tel = String(o.phone || "").replace(/\s/g, ""), names = MG.outNames(o), all = MG.outLines(o).length === o.lines.length;
  var s = MG.sheet({title:"В поръчката има изчерпано", html:'<p><b>№ ' + esc(o.no) + ' · ' + esc(SH.chName(o)) + '</b><br>Изчерпано днес: <b>' + esc(names) + '</b>. Обади се на клиента и предложи друго ястие.</p>' +
    '<div class="mg-kv"><span>Клиент</span><b>' + esc(o.name || "") + '</b></div><div class="mg-kv"><span>Телефон</span><b class="tnum">' + esc(A.fmtPhone(o.phone)) + '</b></div>' +
    (all ? '<p class="mg-note">' + ic("info", 16) + 'Всички ястия в поръчката са изчерпани: откажи я от „Поръчки“ в админа, ако клиентът не иска друго.</p>' : '<p class="mg-note">' + ic("info", 16) + '„Приеми без него“ праща в кухнята останалите ястия и пише бележка в поръчката. Друго ястие се добавя от „Поръчки“ в админа.</p>'),
    foot:(all ? '<a class="pill pill-line pill-lg" href="' + MG.ADMIN + 'orders.html#n=' + esc(o.no) + '">' + ic("receipt", 22) + 'Към поръчката</a>' : '<button class="pill pill-line pill-lg" type="button" data-wo>' + ic("check", 22) + 'Приеми без него</button>') + '<a class="pill pill-red pill-lg" href="tel:' + esc(tel) + '" data-tel>' + ic("phone", 22) + 'Обади се на клиента</a>'});
  s.foot.querySelector("[data-tel]").addEventListener("click", function(){ A.audit("order.call", "№ " + o.no + ": обаждане за изчерпано („" + names + "“)", o.no); });
  var wo = s.foot.querySelector("[data-wo]"); if (wo) wo.onclick = function(){ s.close(); MG.accept(o.no, "without"); }; return s; };
MG.pickWaiter = function(title, silent, cb){ var s = MG.shift();
  var sh = MG.sheet({title:title, html:(silent ? '<p>' + esc(silent.name) + ' е на масата и не е отговорил. Избери кой да отиде.</p>' : '') + '<div class="mg-pick" role="group" aria-label="Сервитьор">' + s.waiters.map(function(w){ var no = silent && silent.id === w.id; return '<button type="button" data-w="' + w.id + '">' + ic("user", 22) + esc(w.name) + '<small>' + (no ? 'не е отговорил' : A.plural(w.tables.length, "маса", "маси")) + '</small></button>'; }).join("") +
    '<button type="button" data-w="me">' + ic("briefcase", 22) + 'Отивам аз<small>' + esc(MG.who()) + '</small></button></div>'});
  sh.body.addEventListener("click", function(e){ var b = e.target.closest("[data-w]"); if (!b) return; sh.close(); var w = s.waiters.filter(function(x){ return x.id === b.dataset.w; })[0]; cb(b.dataset.w === "me" ? MG.who() : w.name, b.dataset.w); }); return sh; };

/* ---------- търсачката: скриптът се зарежда при първото отваряне (../ds/search.js + _find.js) ---------- */
var findQ = null;
MG.loadFind = function(cb){ if (window.MGF && window.SCSearch) return cb && cb(); if (findQ){ findQ.push(cb); return; } findQ = [cb];
  A.loadSearch(function(){ if (window.MGF){ var l = findQ; findQ = null; l.forEach(function(f){ f && f(); }); return; } var sc = document.createElement("script"); sc.src = "_find.js"; sc.onload = function(){ var l = findQ; findQ = null; l.forEach(function(f){ f && f(); }); }; document.head.appendChild(sc); }); };

/* ---------- профил ---------- */
var THEMES = [["system","Авто","circles-three"],["light","Светла","sun"],["dark","Тъмна","moon"]];
MG.themesHTML = function(){ return '<div class="mg-themes" role="group" aria-label="Тема">' + THEMES.map(function(t){ return '<button type="button" data-mg="theme" data-v="' + t[0] + '" aria-pressed="' + ((A.prefs.theme || "system") === t[0]) + '">' + ic(t[2], 20) + t[1] + '</button>'; }).join("") + '</div>'; };
function openProfile(){ var r = A.role(A.me.role);
  MG.sheet({title:"Профил", html:'<div class="mg-ph" style="margin:4px 0 14px"><span class="av" style="background:var(--ink);color:var(--bg);font-weight:800;font-size:19px">' + esc(A.initials(A.me.name)) + '</span><div><b>' + esc(A.me.name) + '</b><small>' + esc(r.n) + ' · потребител ' + esc(A.me.user) + '</small></div></div>' +
    '<div class="mg-card mg-list" style="box-shadow:inset 0 0 0 1.5px var(--line-strong)">' +
      (MG.isOwner() ? '<a class="mg-setrow" href="' + MG.OWN + '" data-keephome><span class="si">' + ic("chart-bar", 22) + '</span><span><b>Към Собственик</b><small>Твоят модул: оборот, тенденции, решения</small></span>' + ic("caret-right", 20) + '</a>' : '') +
      '<a class="mg-setrow" href="' + MG.ADMIN + 'dashboard.html"' + MG.homeAttr() + '><span class="si">' + ic("squares-four", 22) + '</span><span><b>Към админа</b><small>Пълната работа: поръчки, резервации, меню, отчети</small></span>' + ic("caret-right", 20) + '</a>' +
      '<a class="mg-setrow" href="' + MG.ADMIN + 'notes.html#src=' + esc(A.me.role) + '"><span class="si">' + ic("pencil-simple", 22) + '</span><span><b>Моите препоръки</b><small>Какво предложи с молива и докъде е стигнало</small></span>' + ic("caret-right", 20) + '</a></div>' +
    '<h3>Тема</h3>' + MG.themesHTML(),
    foot:'<button class="pill pill-line pill-lg" type="button" data-mg="logout">' + ic("sign-out", 22) + 'Изход</button>'}); }
MG.logout = function(){ A.logout(); };

/* ---------- делегиране ---------- */
document.addEventListener("click", function(e){ var t = e.target.closest("[data-mg]"); if (!t) return; var a = t.dataset.mg;
  if (a === "profile"){ openProfile(); return; }
  if (a === "logout"){ MG.logout(); return; }
  if (a === "find"){ MG.loadFind(function(){ MGF.open(); }); return; }
  if (a === "theme"){ A.prefs.theme = t.dataset.v; A.savePrefs(); A.applyTheme(); document.querySelectorAll("[data-mg=theme]").forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.v === A.prefs.theme)); }); return; }
  if (a === "sound"){ try{ localStorage.setItem("sa-sound", A.soundOn() ? "off" : "on"); }catch(x){} setTimeout(function(){ MG.syncSound(); if (A.soundOn()) A.chime(); }, 40); MG.toast(A.soundOn() ? "Звукът за нови онлайн поръчки е включен" : "Звукът за нови онлайн поръчки е изключен"); return; }
  if (a === "state"){ e.preventDefault(); location.href = t.getAttribute("href"); location.reload(); return; }
  if (a === "normal"){ SH.applyDemo("normal"); location.reload(); return; }
  if (a === "ptime"){ A.setProtoTime(t.dataset.v); location.reload(); return; }
  if (a === "viewas"){ A.viewAs(t.dataset.v); return; }
  if (a === "simorder"){ var so = A.simulateOrder(); MG.toast("Симулирахме онлайн поръчка № " + so.no + ". След миг идва като нова."); return; }
  if (a === "reset"){ A.data.reset(); MG.toast("Данните са върнати в начало"); setTimeout(function(){ location.href = MG.file; location.reload(); }, 700); return; }
  if (a === "retry"){ t.disabled = true; var old = t.innerHTML; t.innerHTML = "Проверяваме…"; setTimeout(function(){ t.disabled = false; t.innerHTML = old; MG.toast(MG.offline ? "Още няма връзка. Опитваме сами на всеки 10 сек." : "Още не става. Опитваме сами на всеки 10 сек."); }, 900); return; }
});
})();
