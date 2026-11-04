/* Siracusa driver app runtime (PWA prototype). Load after ../ds/icons.js, ../data/menu.js, ../ds/sc.js.
   Uses SC data (SC.items, SC.byId, SC.ZONES, SC.RESTAURANT, SC.fmt, SC.ic, SC.esc, SC.plural) but NOT SC.mount:
   staff screens have their own chrome (top bar, 4-tab nav), no footer, assistant, cookie banner or marketing.
   Built on the same ideas as pages-servitor/_staff.js. Mock state lives in localStorage per scenario. */
(function(){
"use strict";
var DR = window.DR = {};
function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function store(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
var esc = SC.esc, ic = SC.ic, fmt = SC.fmt;
DR.esc = esc;

/* ---------- prefs & hash (#1042&s=road) ---------- */
DR.prefs = load("dr-prefs", {}); if (!DR.prefs.theme) DR.prefs.theme = "system";
DR.hash = {}; (location.hash||"").slice(1).split("&").forEach(function(p){ if (!p) return; if (/^\d+$/.test(p)) DR.hash.id = p; else { var kv = p.split("="); DR.hash[kv[0]] = decodeURIComponent(kv[1]||""); } });
DR.STATES = [["normal","Нов курс"],["road","На път · закъснява"],["outzone","Адрес извън зоните"],["empty","Няма доставки"],["offline","Няма връзка"],["moving","В движение"]];
DR.state = DR.hash.s || DR.prefs.state || "normal";
if (DR.hash.s && DR.prefs.state !== DR.hash.s){ DR.prefs.state = DR.hash.s; try{ localStorage.setItem("dr-prefs", JSON.stringify(DR.prefs)); }catch(e){} }
DR.offline = DR.state === "offline";
DR.moving = DR.state === "moving";
function savePrefs(){ store("dr-prefs", DR.prefs); }
DR.isDarkHour = function(){ var h = SC.now().h; return h >= 18 || h < 7; };
function applyTheme(){ var de = document.documentElement, t = DR.prefs.theme;
  if (t === "hour") t = DR.isDarkHour() ? "dark" : "light";
  if (t === "system") delete de.dataset.theme; else de.dataset.theme = t; }
applyTheme();

/* ---------- vocabulary ---------- */
DR.ME = "Шофьор 1";
DR.CARS = [{id:"a1", n:"Автомобил 1"}, {id:"a2", n:"Автомобил 2"}]; /* [ЛИПСВА: автомобили, марка, рег. номер, гориво] */
DR.PAY = {cash:["В брой","money"], card:["Карта при получаване","credit-card"], voucher:["Ваучер","ticket"]};
DR.ST = {wait:["В ресторанта","storefront"], picked:["Взета","shopping-bag"], road:["На път","car"], done:["Доставена","check-circle"], prob:["Проблем","warning"]};
DR.PROB = {nobody:["Няма никой","door-open","Никой не отваря и не вдига"], addr:["Грешен адрес","map-pin-line","Няма такъв адрес или е непълен"], refuse:["Отказ","x","Клиентът не приема поръчката"]};
DR.NAVAPP = {google:"Google Maps", waze:"Waze"};
DR.zone = function(n){ return SC.ZONES.filter(function(z){ return z.n === n; })[0] || null; };

/* schematic positions (viewBox 360 x 250); NOT a map, only the rough direction of each zone from the restaurant */
DR.POS = {home:[140,150], "Дружба 2":[170,150], "Дружба 1":[150,64], "Гара Искър":[56,52], "НПЗ Искър":[290,70], "Бусманци":[296,192], "Горубляне":[118,224], out:[30,130]};

/* ---------- mock data ---------- */
function seed(kind){ var now = Date.now(), M = 60000;
  var db = {v:3, kind:kind, shiftStart: now - 3*60*M - 12*M, car:"a1", kmStart:48250, legs:[], float:null, outbox:[], route:{pick:"A", own:null}, driving:null, fuel:[], dels:[], parked:false, ended:false};
  function D(id, zone, addr, sub, pay, items, agoMin, st, note, dx, dy){ db.dels.push({id:String(id), zone:zone, addr:addr, sub:sub, client:"Клиент от № "+id, phone:"0888 12 34 56", pay:pay, items:items, at: now - agoMin*M, st:st, note:note||"", dx:dx||0, dy:dy||0, doneAt: st==="done" ? now - (agoMin-28)*M : null, prob:null, arrivedAt:null}); }
  /* delivered earlier in the shift */
  D(1031, "Дружба 2", "бл. 3xx, вх. А", "ет. 2", "cash", [["pitsa-margarita",1],["kebapcheta",1]], 150, "done", "", -14, 10);
  D(1034, "Дружба 1", "бл. 5xx, вх. В", "ет. 6", "card", [["svinski-rebra",1],["gratska-salata",1]], 128, "done", "", 12, -6);
  D(1037, "Бусманци", "ул. [ЛИПСВА], № xx", "къща", "cash", [["pitsa-dyavolo",2],["tiramisu",1]], 96, "done", "", -6, 8);
  if (kind === "empty"){
    D(1040, "Дружба 2", "бл. 4xx, вх. Б", "ет. 4", "cash", [["kebapcheta",3]], 70, "done", "", 18, 6);
    D(1041, "НПЗ Искър", "ул. [ЛИПСВА], № xx", "офис, ет. 1", "voucher", [["salata-tsezar-s-pileshki-prachki",2]], 58, "done", "", -8, 6);
    return db; }
  var on = kind === "road" || kind === "offline" || kind === "moving";
  D(1042, "Дружба 2", "бл. 3xx, вх. Б", "ет. 4, ап. xx", "cash", [["pitsa-margarita",2],["gratska-salata",1],["tiramisu",1]], kind==="road" ? 38 : 14, on ? "road" : "wait", "Звънецът не работи. Обадете се, когато пристигнете.", 24, 8);
  D(1043, "Дружба 1", "бл. 5xx, вх. А", "ет. 7", "card", [["svinski-vrat",1],["pitsa-kaprichoza",1]], 16, on ? "road" : "wait", "", -10, 6);
  D(1045, "НПЗ Искър", "ул. [ЛИПСВА], № xx", "офис, рецепция", "cash", [["salata-tsezar-s-pileshki-prachki",1],["pitsa-vegetariana",1],["kyunefe",1]], 9, on ? "road" : "wait", "", 0, 10);
  if (kind === "outzone") D(1046, null, "ул. [ЛИПСВА], № xx", "къща", "cash", [["kebapcheta",2],["pitsa-dyavolo",1]], 6, "wait", "", 0, 0);
  else D(1046, "Горубляне", "ул. [ЛИПСВА], № xx", "къща", "voucher", [["svinski-kyufteta",2],["pitsa-margarita",1]], 3, on ? "road" : "wait", "", 8, -6);
  if (on) db.driving = "1042";
  if (kind === "offline") db.outbox = [{id:"1042", w:"Взех от ресторанта", at: now - 4*M}, {id:"1042", w:"На път", at: now - 3*M}];
  return db; }
var KEY = "dr-db-" + DR.state;
DR.db = load(KEY, null);
if (!DR.db || DR.db.v !== 3) DR.db = seed(DR.state);
DR.save = function(){ store(KEY, DR.db); DR.emit(); };
DR.reset = function(){ DR.STATES.forEach(function(s){ try{ localStorage.removeItem("dr-db-"+s[0]); }catch(e){} }); };
var subs = []; DR.on = function(fn){ subs.push(fn); }; DR.emit = function(){ subs.forEach(function(f){ f(); }); updateBadges(); };

/* ---------- derived ---------- */
DR.byId = function(id){ return DR.db.dels.filter(function(d){ return d.id === String(id); })[0]; };
DR.car = function(){ return DR.CARS.filter(function(c){ return c.id === DR.db.car; })[0] || DR.CARS[0]; };
DR.itemsSum = function(d){ return d.items.reduce(function(s,l){ var x = SC.byId[l[0]]; return s + (x ? x.p*l[1] : 0); }, 0); };
DR.fee = function(d){ var z = DR.zone(d.zone); if (!z) return null; return z.free ? 0 : (z.fee == null ? null : z.fee); };
DR.total = function(d){ var f = DR.fee(d); return DR.itemsSum(d) + (f || 0); };
DR.feeKnown = function(d){ return DR.fee(d) !== null; };
DR.due = function(d){ var z = DR.zone(d.zone); return d.at + (z ? z.etaMin : 45)*60000; };
DR.active = function(){ return DR.db.dels.filter(function(d){ return d.st !== "done" && d.st !== "prob"; }); };
DR.doneList = function(){ return DR.db.dels.filter(function(d){ return d.st === "done" || d.st === "prob"; }).sort(function(a,b){ return (b.doneAt||b.at) - (a.doneAt||a.at); }); };
DR.clock = function(ms){ var d = new Date(ms); return (d.getHours()<10?"0":"")+d.getHours()+":"+(d.getMinutes()<10?"0":"")+d.getMinutes(); };
DR.mins = function(ms){ return Math.round(ms/60000); };
DR.money = function(d){ if (!d.zone) return "уточнете с ресторанта"; return fmt(DR.total(d)) + (DR.feeKnown(d) ? "" : " + такса"); };

/* ---------- route (VROOM on OSRM, own server; numbers here are only for the mock) ---------- */
function pt(d){ if (d === "home") return DR.POS.home; var p = DR.POS[d.zone || "out"]; return [p[0] + (d.dx||0), p[1] + (d.dy||0)]; }
function km(a, b){ var p = pt(a), q = pt(b); return Math.hypot(p[0]-q[0], p[1]-q[1]) * 0.032; }
function inTown(d){ return d === "home" || d.zone === "Дружба 1" || d.zone === "Дружба 2"; }
function mins(a, b){ var k = km(a, b); return 1 + k * (inTown(a) && inTown(b) ? 2.6 : 1.9); }
function perms(a){ if (a.length < 2) return [a]; var r = []; a.forEach(function(x, i){ perms(a.slice(0,i).concat(a.slice(i+1))).forEach(function(p){ r.push([x].concat(p)); }); }); return r; }
function measure(order){ var t = 0, k = 0, prev = "home", legs = [], wait = 0, late = 0;
  order.forEach(function(d, i){ var lm = mins(prev, d), lk = km(prev, d); t += lm; k += lk; wait += t + 2*i; late += Math.max(0, Date.now() + (t + 2*i)*60000 - DR.due(d)); legs.push({m:lm, k:lk}); prev = d; });
  var rk = km(prev, "home"), rm = mins(prev, "home");
  return {order:order, min:Math.round(t + rm), km:k + rk, legs:legs, back:{m:rm, k:rk}, wait:wait, late:late}; }
/* the delivery the driver is already driving to is locked at the top; the order applies to the rest */
DR.lock = function(){ var d = DR.db.driving && DR.byId(DR.db.driving); return d && d.st === "road" ? d : null; };
DR.plan = function(){ var stops = DR.active(); if (!stops.length) return null; var L = DR.lock();
  /* mock only: brute force over permutations (fine for 4-5 stops); the real app asks VROOM, never permutations */
  var all = perms(stops).filter(function(o){ return !L || o[0] === L; }).map(measure);
  /* A: by the promised time (VROOM with time windows: the locked one first, then the earliest deadline) */
  var A = measure(stops.slice().sort(function(a,b){ return (b===L) - (a===L) || DR.due(a) - DR.due(b); }));
  var B = all.slice().sort(function(a,b){ return a.km - b.km || a.min - b.min; })[0];
  var own = null; if (DR.db.route.own){ var o = DR.db.route.own.map(DR.byId).filter(function(d){ return d && stops.indexOf(d) > -1; }); stops.forEach(function(d){ if (o.indexOf(d) < 0) o.push(d); }); if (L){ o.splice(o.indexOf(L),1); o.unshift(L); } own = measure(o); }
  return {A:A, B:B, own:own}; };
DR.current = function(){ var p = DR.plan(); if (!p) return null; var k = DR.db.route.pick; return (k === "own" && p.own) ? p.own : k === "B" ? p.B : p.A; };
/* ETA: legs + 2 min for every previous address (pack 10.1) */
DR.etas = function(){ var r = DR.current(), out = {}; if (!r) return out; var t = Date.now(), cum = 0;
  r.order.forEach(function(d, i){ cum += r.legs[i].m; out[d.id] = t + (cum + 2*i)*60000; }); return out; };
DR.ordered = function(){ var r = DR.current(); return r ? r.order : []; };
DR.next = function(){ var o = DR.ordered(); return DR.lock() || o.filter(function(d){ return d.st === "road"; })[0] || o[0] || null; };
DR.lvl = function(d){ if (d.st === "done" || d.st === "prob") return ""; var left = DR.due(d) - Date.now(); return left < 0 ? "late" : left < 5*60000 ? "soon" : ""; };

/* ---------- actions ---------- */
function queue(d, w){ if (DR.offline) DR.db.outbox.push({id:d.id, w:w, at:Date.now()}); }
/* never changes another delivery silently: several can be "На път" at once (taken together) */
function snap(d){ return {st:d.st, doneAt:d.doneAt, prob:d.prob, arrivedAt:d.arrivedAt, driving:DR.db.driving}; }
function relock(){ if (DR.lock()) return; DR.db.driving = null; var o = DR.ordered().filter(function(x){ return x.st === "road"; }); DR.db.driving = o.length ? o[0].id : null; }
DR.setSt = function(id, st){ var d = DR.byId(id); if (!d) return null; var prev = snap(d);
  d.st = st; if (st === "done") d.doneAt = Date.now(); if (st === "road" && !DR.lock()) DR.db.driving = d.id;
  if (st === "done" && DR.db.driving === d.id) DR.db.driving = null; relock();
  queue(d, st === "picked" ? "Взех от ресторанта" : DR.ST[st][0]); DR.save(); return prev; };
DR.restore = function(id, prev){ var d = DR.byId(id); if (!d) return; d.st = prev.st; d.doneAt = prev.doneAt; d.prob = prev.prob; d.arrivedAt = prev.arrivedAt; DR.db.driving = prev.driving; if (DR.offline) DR.db.outbox.pop(); DR.save(); };
DR.goAll = function(){ var ids = []; DR.ordered().forEach(function(d){ if (d.st === "picked"){ d.st = "road"; ids.push(d.id); queue(d, "На път"); } }); relock(); DR.save(); return ids; };
DR.arrived = function(id){ var d = DR.byId(id), prev = snap(d); d.arrivedAt = Date.now(); queue(d, "Пристигнах (SMS: шофьорът е пред входа)"); DR.save(); return prev; };
DR.returned = function(id){ var d = DR.byId(id); d.prob.returned = Date.now(); queue(d, "Върнах в ресторанта"); DR.save(); };
DR.pickAll = function(){ var n = 0; DR.db.dels.forEach(function(d){ if (d.st === "wait" && d.zone){ d.st = "picked"; n++; queue(d, "Взех от ресторанта"); } }); DR.save(); return n; };
DR.problem = function(id, k, note){ var d = DR.byId(id), prev = snap(d); d.st = "prob"; d.prob = {k:k, note:note||"", at:Date.now()}; d.doneAt = Date.now(); if (DR.db.driving === d.id) DR.db.driving = null; relock(); queue(d, "Проблем: "+DR.PROB[k][0]); DR.save(); return prev; };
DR.cash = function(){ return DR.db.dels.filter(function(d){ return d.st === "done" && d.pay === "cash"; }).reduce(function(s,d){ return s + DR.total(d); }, 0); };
DR.fuelCash = function(){ return DR.db.fuel.filter(function(x){ return x.cash; }).reduce(function(s,x){ return s + x.s; }, 0); };
/* to hand over = cash from orders + starting change - fuel paid in cash */
DR.handover = function(){ return DR.cash() + (DR.db.float || 0) - DR.fuelCash(); };
DR.lastKm = function(){ var k = DR.db.kmStart; DR.db.fuel.forEach(function(x){ if (x.car === DR.db.car && x.km > k) k = x.km; }); return k; };
/* changing the car mid-shift: end of car 1 (end km) + start of car 2 (start km), same shift */
DR.switchCar = function(id, kmEnd, kmStart){ DR.db.legs.push({car:DR.db.car, kmStart:DR.db.kmStart, kmEnd:kmEnd, at:Date.now()}); DR.db.car = id; DR.db.kmStart = kmStart; DR.save(); };
DR.carName = function(id){ return (DR.CARS.filter(function(c){ return c.id === id; })[0] || DR.CARS[0]).n; };

/* ---------- navigation links (free, no API key) ---------- */
DR.navUrl = function(d, app){ var q = encodeURIComponent((d.zone ? "ж.к. " + d.zone + ", " : "") + d.addr + ", София");
  return app === "waze" ? "https://waze.com/ul?q=" + q + "&navigate=yes" : "https://www.google.com/maps/dir/?api=1&destination=" + q + "&travelmode=driving"; };

/* ---------- UI helpers ---------- */
DR.stt = function(k, word, icon){ return '<span class="stt '+k+'">'+ic(icon,18)+'<span>'+esc(word)+'</span></span>'; };
DR.dStt = function(d){ var s = d.st === "prob" ? ["Проблем · "+DR.PROB[d.prob.k][0], "warning"] : DR.ST[d.st]; return DR.stt(d.st, s[0], s[1]); };
DR.dueStt = function(d, eta){ var l = DR.lvl(d), left = DR.mins(DR.due(d) - Date.now()), over = eta ? DR.mins(eta - DR.due(d)) : 0;
  if (d.st === "done") return DR.stt("done", "Доставена "+DR.clock(d.doneAt), "check-circle");
  if (d.st === "prob") return DR.stt("prob", DR.PROB[d.prob.k][0], "warning");
  if (l === "late") return DR.stt("late", "Закъснява "+(-left)+" мин", "timer");
  if (l === "soon") return DR.stt("soon", "Остават "+Math.max(1,left)+" мин", "timer");
  if (over > 0) return DR.stt("soon", "Срок "+DR.clock(DR.due(d))+" · ще закъснее ~"+over+" мин", "timer");
  return DR.stt("picked", "Срок "+DR.clock(DR.due(d)), "clock"); };
DR.zoneLine = function(d){ if (!d.zone) return '<span class="stt out">'+ic("warning",18)+'<span>Извън зоните</span></span>';
  var z = DR.zone(d.zone); return esc(d.zone) + (z.free ? "" : ' · платена зона'); };
DR.payWord = function(d){ return '<span class="payw">'+ic(DR.PAY[d.pay][1],18)+esc(DR.PAY[d.pay][0])+'</span>'; };
DR.haptic = function(p){ try{ var ua = navigator.userActivation; if (ua && !ua.hasBeenActive) return; navigator.vibrate && navigator.vibrate(p||12); }catch(e){} };
DR.MASK = '<span class="missing">[ЛИПСВА: доставчик за маскирани обаждания]</span>';
DR.exTag = '<span class="ex">'+ic("info",16)+'примерен адрес</span>';

/* sheet & toast (same as the waiter app) */
DR.sheet = function(o){ var w = document.createElement("div"); w.className = "st-sheetwrap"; var id = "sh"+Math.random().toString(36).slice(2,7);
  w.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="st-sheet" role="dialog" aria-modal="true" aria-labelledby="'+id+'"><div class="handle"></div><div class="sh"><h2 id="'+id+'">'+o.title+'</h2><button class="iconbtn" type="button" data-close aria-label="Затвори">'+ic("x",22)+'</button></div><div class="body">'+o.html+'</div>'+(o.foot?'<div class="sfoot">'+o.foot+'</div>':'')+'</div>';
  document.body.appendChild(w); var prev = document.activeElement;
  var bg = [DR.app, document.querySelector(".st-nav"), document.querySelector(".st-bar")].filter(Boolean); bg.forEach(function(el){ el.inert = true; });
  w.addEventListener("keydown", function(e){ if (e.key !== "Tab") return; var f = Array.prototype.filter.call(w.querySelectorAll(".st-sheet button:not([disabled]), .st-sheet a[href], .st-sheet input, .st-sheet textarea, .st-sheet select"), function(el){ return el.offsetParent !== null; });
    if (!f.length) return; var a = f[0], z = f[f.length-1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } });
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); var f = w.querySelector("[data-close]"); f && f.focus({preventScroll:true}); }); });
  function close(){ if (document.querySelectorAll(".st-sheetwrap.on").length <= 1) bg.forEach(function(el){ el.inert = false; }); w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 340); prev && prev.focus && prev.focus({preventScroll:true}); }
  w.querySelector(".scrim").onclick = close; w.querySelector("[data-close]").onclick = close;
  return {el:w, close:close, body:w.querySelector(".body")}; };
document.addEventListener("keydown", function(e){ if (e.key==="Escape"){ var w = document.querySelectorAll(".st-sheetwrap.on"); if (w.length) w[w.length-1].querySelector("[data-close]").click(); } });
var toastT;
DR.toast = function(text, undo, label){ var t = document.querySelector(".st-toast"); if (!t){ t = document.createElement("div"); t.className = "st-toast"; t.setAttribute("role","status"); document.body.appendChild(t); }
  t.innerHTML = '<span>'+text+'</span>' + (undo ? '<button type="button">'+(label||"Отмени")+'</button>' : '');
  t.classList.toggle("solo", !undo); t.classList.toggle("low", !!document.querySelector(".st-net"));
  if (undo) t.querySelector("button").onclick = function(){ undo(); t.classList.remove("on"); };
  t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function(){ t.classList.remove("on"); }, undo ? 5000 : 2600); };

/* ---------- chrome ---------- */
function updateBadges(){ var n = DR.active().length, el = document.querySelector('[data-cnt="list"]'); if (!el) return; el.textContent = n; el.hidden = !n;
  var a = el.closest("a"); a.setAttribute("aria-label", "Доставки" + (n ? ", " + n + " активни" : "")); }
DR.updateBadges = updateBadges;
function nav(cur){ var n = DR.active().length;
  var tabs = [["list","list.html","moped","Доставки",1],["route","route.html","path","Маршрут"],["fuel","fuel.html","drop","Гориво"],["shift","shift.html","wallet","Смяна"]];
  return '<nav class="st-nav" aria-label="Приложение на шофьора">'+tabs.map(function(t){
    return '<a href="'+t[1]+'"'+(cur===t[0]?' aria-current="page"':'')+'>'+ic(t[2],26)+t[3]+(t[4]?'<span class="cnt" data-cnt="list"'+(n?'':' hidden')+'>'+n+'</span>':'')+'</a>'; }).join("")+'</nav>'; }
DR.queued = function(){ return DR.db.outbox.length + DR.db.fuel.filter(function(x){ return x.q; }).length; };
function netStrip(){ var q = DR.queued();
  return '<div class="st-net" role="status">'+ic("warning",22)+'<span>Няма връзка. '+(q ? SC.plural(q,"запис чака","записа чакат")+' и тръгват сами.' : 'Записите се пазят тук.')+'</span><button type="button" data-act="queue">Виж</button></div>'; }
function topbar(o){ var since = DR.clock(DR.db.shiftStart);
  if (o.bare) return '<header class="st-top"><div class="tt"><b class="st-word">Siracusa</b><span>Шофьор</span></div>'+(o.right||'')+'</header>';
  var left = o.back ? '<a class="st-back" href="'+o.back.href+'">'+ic("caret-left",22)+esc(o.back.label)+'</a>' : '';
  return '<header class="st-top'+(o.back?' back':'')+'">'+left+'<div class="tt"><b>'+esc(o.title)+'</b><span>'+esc(o.sub || (DR.ME+" · "+DR.car().n))+'</span></div>'+
    '<button class="st-me'+(DR.offline?' off':'')+'" type="button" data-act="menu" aria-label="Смяна и настройки, '+(DR.offline?'няма връзка':'свързано')+'"><span class="dot"></span>'+(DR.offline?'Без връзка':'Смяна')+'</button></header>'+
    (DR.offline ? netStrip() : ''); }
DR.netStrip = function(){ var s = document.querySelector(".st-net"); if (s) s.outerHTML = netStrip(); };

/* moving overlay: the app is used only when parked (proposal: GPS speed) */
function movingOverlay(){ if (!DR.moving || DR.db.parked) return;
  var o = document.createElement("div"); o.className = "moving"; o.setAttribute("role","alertdialog"); o.setAttribute("aria-modal","true"); o.setAttribute("aria-labelledby","mvh");
  o.innerHTML = '<div class="ill">'+ic("car",52)+'</div><h1 id="mvh">Колата е в движение</h1><p>За ваша безопасност приложението се ползва само в паркирано положение. Навигацията в '+DR.NAVAPP[DR.prefs.nav||"google"]+' продължава.</p>'+
    '<span class="prop">'+ic("sparkle",14)+'Предложение: по скоростта от GPS</span>'+
    '<button class="pill pill-red pill-lg" type="button" data-park="parked">'+ic("check",22)+'Паркирах</button><button class="pill pill-line pill-lg" type="button" data-park="passenger">Аз съм пътник</button><p class="small" style="max-width:34ch">„Аз съм пътник“ важи до края на смяната. „Паркирах“ важи, докато колата не тръгне отново.</p>';
  document.body.appendChild(o); o.querySelector("[data-park]").focus();
  o.addEventListener("click", function(e){ var b = e.target.closest("[data-park]"); if (b){ DR.db.parked = b.dataset.park; DR.save(); o.remove(); } }); }

/* DR.mount({page, title, sub, back:{href,label}, nav:"list"|"route"|"fuel"|"shift"|null, bar:true}) -> <main> */
DR.mount = function(o){ o = o || {};
  document.body.classList.add("st");
  var app = document.createElement("div"); app.className = "st-app" + (o.nav===null ? " nonav" : "") + (o.bar ? " withbar" : ""); app.dataset.page = o.page||"";
  app.innerHTML = topbar(o) + '<main id="main"></main>' + (o.proto===false ? '' : protoPanel());
  document.body.appendChild(app);
  if (o.nav !== null) document.body.insertAdjacentHTML("beforeend", nav(o.nav));
  document.title = o.title + " | Siracusa · Шофьор";
  if (o.page !== "login" && o.page !== "index") setTimeout(movingOverlay, 0);
  DR.app = app; return app.querySelector("main"); };

/* ---------- settings sheet ---------- */
function themeSeg(){ var t = DR.prefs.theme; return '<div class="st-seg" role="group" aria-label="Тема">'+[["system","Авто"],["light","Светла"],["dark","Тъмна"],["hour","По часа"]].map(function(x){ return '<button type="button" data-act="theme" data-v="'+x[0]+'" aria-pressed="'+(t===x[0])+'">'+x[1]+'</button>'; }).join("")+'</div>'; }
function navSeg(){ var n = DR.prefs.nav || "google"; return '<div class="st-seg" role="group" aria-label="Приложение за навигация">'+[["google","Google Maps"],["waze","Waze"]].map(function(x){ return '<button type="button" data-act="navapp" data-v="'+x[0]+'" aria-pressed="'+(n===x[0])+'">'+x[1]+'</button>'; }).join("")+'</div>'; }
DR.themeSeg = themeSeg; DR.navSeg = navSeg;
function menuSheet(){
  DR.sheet({title:"Смяна", html:
    '<div class="kvs"><div class="kv"><span class="muted">Шофьор</span><b>'+DR.ME+'</b></div><div class="kv"><span class="muted">Автомобил</span><button class="link" type="button" data-act="car">'+DR.car().n+' · смени</button></div><div class="kv"><span class="muted">На смяна от</span><b class="tnum">'+DR.clock(DR.db.shiftStart)+'</b></div><div class="kv"><span class="muted">Начален километраж</span><b class="tnum">'+DR.db.kmStart.toLocaleString("bg-BG")+' км</b></div><div class="kv"><span class="muted">Връзка</span><b>'+(DR.offline?'Няма връзка':'Свързано')+'</b></div></div>'+
    '<p class="st-cap" style="margin-top:18px">Навигация с</p>'+navSeg()+'<p class="small muted" style="margin:8px 0 0">Бутонът „Навигация“ отваря адреса направо в избраното приложение.</p>'+
    '<p class="st-cap" style="margin-top:18px">Тема</p>'+themeSeg()+'<p class="small muted" style="margin:8px 0 0">„По часа“ е тъмна от 18:00 до 07:00. <span class="prop">'+ic("sparkle",14)+'Предложение</span></p>'+
    '<p class="st-cap" style="margin-top:18px">Местоположение</p><p class="small muted" style="margin:0">Споделя се само по време на активна доставка и го виждат само собственикът и управителят.</p>',
    foot:'<a class="pill pill-line pill-lg pill-block" href="shift.html">'+ic("sign-out",22)+'Приключи смяната</a>'}); }
function queueSheet(){ var q = DR.db.outbox.concat(DR.db.fuel.filter(function(x){ return x.q; }).map(function(x){ return {id:"", w:"Зареждане "+x.l.toFixed(2).replace(".",",")+" л", at:x.at}; }));
  DR.sheet({title:"Чакат връзка", html: (q.length ? '<p class="muted" style="margin:0 0 6px">Тези статуси са записани на телефона и тръгват сами към ресторанта, щом има връзка. Не ги натискайте пак.</p><div class="hist">'+q.map(function(x){ return '<div class="h"><b>'+(x.id?'№ '+x.id+' · ':'')+esc(x.w)+'</b><span class="tnum">'+DR.clock(x.at)+'</span></div>'; }).join("")+'</div>' : '<p class="muted" style="margin:0">Нищо не чака. Всички статуси са изпратени.</p>')+
    '<div class="notice" style="margin-top:12px">'+ic("phone",22)+'<span>Ако е спешно (отказ, грешен адрес), обадете се в ресторанта: <a class="link" href="tel:'+SC.RESTAURANT.phone.replace(/\s/g,"")+'" style="min-height:0;display:inline">'+SC.RESTAURANT.phone+'</a>.</span></div>',
    foot:'<button class="pill pill-red pill-lg pill-block" type="button" data-act="retry">'+ic("arrow-clockwise",22)+'Опитай пак сега</button>'}); }
DR.queueSheet = queueSheet;
DR.carSheet = function(onDone){ var pick = DR.db.car;
  function body(){ return '<div class="cars" role="group" aria-label="Автомобил">'+DR.CARS.map(function(c){ return '<button class="car" type="button" data-c="'+c.id+'" aria-pressed="'+(pick===c.id)+'"><span class="ii">'+ic("car",24)+'</span><span><b>'+c.n+'</b><span>'+(c.id===DR.db.car?"Карате я сега · ":"")+'рег. № <span class="missing">[ЛИПСВА]</span></span></span></button>'; }).join("")+'</div>'+
    (pick !== DR.db.car ? '<p class="small muted" style="margin:14px 0 8px">Смяната продължава. Записваме края на '+DR.car().n+' и началото на '+DR.carName(pick)+'.</p><div class="fgrid"><div class="field"><label for="cke">Краен км на '+DR.car().n+'</label><input class="input" id="cke" inputmode="numeric" placeholder="0"></div><div class="field"><label for="cks">Начален км на '+DR.carName(pick)+'</label><input class="input" id="cks" inputmode="numeric" placeholder="0"></div></div><p class="err" id="ckerr" style="margin:6px 0 0;color:var(--danger);font-weight:600;font-size:14px"></p>' : ''); }
  var s = DR.sheet({title:"С коя кола карате?", html:'<div id="carb">'+body()+'</div>', foot:'<button class="pill pill-red pill-lg pill-block" type="button" data-csave>Готово</button>'});
  var b = s.el.querySelector("#carb");
  s.el.addEventListener("click", function(e){ var t = e.target.closest("button"); if (!t) return;
    if (t.dataset.c){ pick = t.dataset.c; b.innerHTML = body(); return; }
    if (t.hasAttribute("data-csave")){ if (pick === DR.db.car){ s.close(); return; }
      var ke = parseInt((s.el.querySelector("#cke").value||"").replace(/\s/g,""),10), ks = parseInt((s.el.querySelector("#cks").value||"").replace(/\s/g,""),10), er = s.el.querySelector("#ckerr");
      if (!ke || ke < DR.lastKm()){ er.textContent = "Крайният км трябва да е поне "+DR.lastKm().toLocaleString("bg-BG")+"."; return; }
      if (!ks){ er.textContent = "Въведете началния км на "+DR.carName(pick)+"."; return; }
      DR.switchCar(pick, ke, ks); s.close(); DR.toast("Карате "+DR.car().n+". Километрите се пазят поотделно за всяка кола."); onDone && onDone(); } }); };

/* ---------- prototype panel ---------- */
function protoPanel(){ return '<section class="proto" aria-label="Само в прототипа"><h2>Само в прототипа</h2><p>Състояние на смяната (данните са условни за макета):</p><div class="row">'+
  DR.STATES.map(function(s){ return '<button class="chip" type="button" data-act="state" data-v="'+s[0]+'" aria-pressed="'+(DR.state===s[0])+'">'+s[1]+'</button>'; }).join("")+'</div><p>Тема:</p>'+themeSeg()+
  '<div class="row"><button class="chip" type="button" data-act="reset">'+ic("arrow-counter-clockwise",18)+'Върни данните в начало</button><a class="chip" href="index.html" style="text-decoration:none">'+ic("list",18)+'Всички екрани</a></div></section>'; }

/* ---------- global delegation ---------- */
document.addEventListener("click", function(e){ var t = e.target.closest("[data-act]"); if (!t) return; var a = t.dataset.act;
  if (a==="menu"){ menuSheet(); return; }
  if (a==="queue"){ queueSheet(); return; }
  if (a==="car"){ DR.carSheet(function(){ location.reload(); }); return; }
  if (a==="theme"){ DR.prefs.theme = t.dataset.v; savePrefs(); applyTheme(); document.querySelectorAll('[data-act="theme"]').forEach(function(b){ b.setAttribute("aria-pressed", b.dataset.v===DR.prefs.theme); }); return; }
  if (a==="navapp"){ DR.prefs.nav = t.dataset.v; savePrefs(); document.querySelectorAll('[data-act="navapp"]').forEach(function(b){ b.setAttribute("aria-pressed", b.dataset.v===DR.prefs.nav); }); DR.emit(); return; }
  if (a==="state"){ DR.prefs.state = t.dataset.v; savePrefs(); var h = location.hash.replace(/(^#|&)s=[a-z]+/,""); location.hash = h; location.reload(); return; }
  if (a==="reset"){ DR.reset(); location.reload(); return; }
  if (a==="retry"){ t.disabled = true; var old = t.innerHTML; t.textContent = "Проверяваме…"; setTimeout(function(){ t.disabled = false; t.innerHTML = old; DR.toast("Още няма връзка. Опитваме сами на всеки 10 сек."); }, 900); return; }
});

/* refresh "minutes left" once a minute */
setInterval(function(){ DR.emit(); }, 60000);
if (DR.db) setTimeout(updateBadges, 0);
})();
