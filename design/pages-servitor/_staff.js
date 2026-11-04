/* Siracusa staff app runtime (waiter PWA prototype). Load after ../ds/icons.js, ../data/menu.js, ../ds/sc.js.
   Uses SC data (SC.items, SC.byId, SC.cats, SC.TABLES, SC.fmt, SC.ic, SC.art, SC.esc) but NOT SC.mount:
   staff screens have their own chrome (top bar, 4-tab nav), no footer, assistant, cookie banner or marketing.
   Mock state lives in localStorage per scenario so actions on one screen show on the others. */
(function(){
"use strict";
var ST = window.ST = {};
function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function store(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
var esc = SC.esc, ic = SC.ic, fmt = SC.fmt;
ST.esc = esc;

/* ---------- prefs & hash (#12&s=rush) ---------- */
ST.prefs = load("st-prefs", {theme:"system", state:"normal"});
ST.hash = {}; (location.hash||"").slice(1).split("&").forEach(function(p){ if (!p) return; if (/^\d+$/.test(p)) ST.hash.table = +p; else { var kv = p.split("="); ST.hash[kv[0]] = decodeURIComponent(kv[1]||""); } });
ST.STATES = [["normal","Нормална вечер"],["rush","Много повиквания"],["empty","Празна опашка"],["offline","Няма връзка"]];
ST.state = ST.hash.s || ST.prefs.state || "normal";
ST.offline = ST.state === "offline";
function savePrefs(){ store("st-prefs", ST.prefs); }
ST.isDarkHour = function(){ var h = SC.now().h; return h >= 18 || h < 7; };
function applyTheme(){ var de = document.documentElement, t = ST.prefs.theme;
  if (t === "hour") t = ST.isDarkHour() ? "dark" : "light";
  if (t === "system") delete de.dataset.theme; else de.dataset.theme = t; }
applyTheme();

/* ---------- mock data ---------- */
ST.WARN = 120; ST.LATE = 300; /* seconds; prototype values, the real threshold is a setting [ЛИПСВА] */
ST.ME = "Сервитьор 1"; ST.OTHER = "Сервитьор 2";
ST.REASONS = {order:["Поръчка","fork-knife"], bill:["Сметка","receipt"], water:["Вода / прибори","drop"], other:["Друго","chat-circle-dots"]};
ST.LINE = {acc:["Прието","check"], cook:["Готви се","cooking-pot"], ready:["Готово за сервиране","chef-hat"], served:["Сервирано","check-circle"]};
ST.tableByN = {}; SC.TABLES.forEach(function(t){ ST.tableByN[t.n] = t; });
ST.ZONE = {salon:"Салон", garden:"Градина"};
ST.MINE = load("st-mine", null) || [3,4,7,12,14,16];
ST.setMine = function(a){ store("st-mine", a); };

function seed(kind){ var now = Date.now(), S = 1000;
  var db = {v:4, kind:kind, shiftStart: now - 2*3600*S - 14*60*S, tables:{}, calls:[], orders:[], paid:{}, seq:2186, outbox:[]};
  SC.TABLES.forEach(function(t){ db.tables[t.n] = {owner: ST.MINE.indexOf(t.n)>-1 ? "me" : "other", st:"free", since:now}; });
  function seat(n, min, st){ db.tables[n].st = st||"seated"; db.tables[n].since = now - min*60*S; }
  function order(n, agoMin, src, bill, lines, pending){ db.seq++; db.orders.push({id:String(db.seq), t:n, at:now - agoMin*60*S, src:src, bill:bill||"", pending:!!pending, lines:lines.map(function(l){ return {id:l[0], q:l[1], st:l[2]||"acc", note:l[3]||"", readyAt: l[2]==="ready" ? now - (l[4]||60)*S : null}; })}); }
  function call(n, r, sec, taken){ db.calls.push({id:"c"+n+r, t:n, r:r, since: now - sec*S, taken: taken||null, takenAt: taken ? now - 20*S : null}); }
  [12,3,4,7,14,2,5,8,9,11,15,17].forEach(function(n){ seat(n, 55); });
  seat(7, 4, "wait"); seat(15, 2, "wait");
  order(12, 48, "me", "", [["gratska-salata",1,"served"],["pitsa-kaprichoza",1,"served"],["kebapcheta",2,"served"]]);
  order(4, 22, "me", "", [["gratska-salata",1,"served"],["pitsa-margarita",2,"ready","",90]]);
  order(14, 18, "me", "Гост 1", [["svinski-vrat",1,"cook","средно изпечен"],["kapreze-s-beybi-motsarela",1,"served"]]);
  order(14, 18, "me", "Гост 2", [["pitsa-s-proshuto-koto-i-tryufel",1,"cook"],["tiramisu",1,"acc"]]);
  order(2, 30, "me", "", [["salata-tsezar-s-pileshki-prachki",2,"served"]]);
  order(5, 35, "me", "", [["pitsa-vegetariana",1,"served"],["kyunefe",1,"served"]]);
  order(8, 12, "qr", "", [["chiyzburger-s-teleshko-kyufte-blek-angas-s-parzh",2,"cook"]]);
  order(9, 50, "me", "", [["svinski-kyufteta",2,"served"]]);
  order(11, 16, "me", "", [["svinski-kyufteta",1,"ready","",140],["gratska-salata",1,"served"]]);
  order(17, 8, "qr", "", [["pitsa-retro-s-chubritsa",1,"cook"]]);
  if (kind !== "empty"){
    order(3, 1, "qr", "", [["pitsa-margarita",1],["salata-tsezar-s-pileshki-prachki",1,"acc","без крутони"],["tiramisu",2]], true);
    call(12,"bill",80); call(7,"order",165); call(5,"water",200,"other"); call(9,"other",412);
  } else {
    seat(3, 30); order(3, 25, "qr", "", [["pitsa-margarita",1,"served"],["tiramisu",2,"served"]]);
    db.orders.forEach(function(o){ o.lines.forEach(function(l){ if (l.st==="ready"){ l.st="served"; l.readyAt=null; } }); });
    seat(7, 6); order(7, 5, "me", "", [["kebapcheta",3,"cook"]]);
  }
  if (kind === "rush"){
    [[1,"order",30],[2,"bill",95],[8,"water",140],[11,"bill",222],[14,"other",58],[17,"bill",330],[15,"order",250],[4,"water",12]].forEach(function(c){ if (db.tables[c[0]].st==="free") seat(c[0],15); call(c[0],c[1],c[2]); });
    order(16, 2, "qr", "", [["kebapcheta",2],["gratska-salata",1]], true); seat(16, 3);
    order(18, 1, "qr", "", [["pitsa-kaprichoza",2]], true); seat(18, 2);
  }
  return db; }
var KEY = "st-db-" + ST.state;
ST.db = load(KEY, null);
if (!ST.db || ST.db.v !== 4) ST.db = seed(ST.state);
ST.save = function(){ store(KEY, ST.db); ST.emit(); };
ST.reset = function(){ try{ Object.keys(localStorage).forEach(function(k){ if (/^st-(db|cart|mine)/.test(k)) localStorage.removeItem(k); }); }catch(e){} };
SC.TABLES.forEach(function(t){ if (ST.db.tables[t.n]) ST.db.tables[t.n].owner = ST.MINE.indexOf(t.n)>-1 ? "me" : "other"; });
var subs = []; ST.on = function(fn){ subs.push(fn); }; ST.emit = function(){ subs.forEach(function(f){ f(); }); updateBadges(); };

/* ---------- derived ---------- */
ST.item = function(id){ return SC.byId[id]; };
/* per100 items (Black Angus steaks) are priced by weight: l.g grams per piece */
ST.linePrice = function(l){ var x = SC.byId[l.id]; if (!x) return 0; return x.per100 ? x.p * (l.g||0)/100 * l.q : x.p * l.q; };
ST.lineName = function(l){ var x = SC.byId[l.id]; return x.n + (x.per100 && l.g ? " · " + l.g + " гр." : ""); };
ST.linesTotal = function(lines){ return lines.reduce(function(s,l){ return s + ST.linePrice(l); }, 0); };
ST.ordersOf = function(n){ return ST.db.orders.filter(function(o){ return o.t === n; }); };
ST.callsOf = function(n){ return ST.db.calls.filter(function(c){ return c.t === n; }); };
ST.isMine = function(n){ return ST.db.tables[n] && ST.db.tables[n].owner === "me"; };
ST.secs = function(since){ return Math.max(0, Math.floor((Date.now() - since)/1000)); };
ST.mmss = function(s){ var m = Math.floor(s/60), r = s%60; return m + ":" + (r<10?"0":"") + r; };
ST.clock = function(ms){ var d = new Date(ms); return (d.getHours()<10?"0":"")+d.getHours()+":"+(d.getMinutes()<10?"0":"")+d.getMinutes(); };
ST.level = function(s){ return s >= ST.LATE ? "late" : s >= ST.WARN ? "warn" : ""; };
/* table status: call > bill > QR to confirm > ready to serve > waiting to order > seated > free */
ST.tStatus = function(n){ var t = ST.db.tables[n], cs = ST.callsOf(n), os = ST.ordersOf(n);
  var c = cs.filter(function(x){ return x.r !== "bill"; })[0], b = cs.filter(function(x){ return x.r === "bill"; })[0];
  if (c) return {k:"call", w:"Вика · "+ST.REASONS[c.r][0], short:ST.REASONS[c.r][0], i:"bell-ringing", since:c.since, wait:true};
  if (b) return {k:"bill", w:"Чака сметка", i:"receipt", since:b.since, wait:true};
  var q = os.filter(function(o){ return o.pending; })[0];
  if (q) return {k:"qr", w:"QR поръчка", i:"qr-code", since:q.at, wait:true};
  var rl = null; os.forEach(function(o){ o.lines.forEach(function(l){ if (l.st==="ready" && (!rl || l.readyAt < rl.readyAt)) rl = l; }); });
  if (rl) return {k:"ready", w:"Готово", i:"chef-hat", since:rl.readyAt, wait:true};
  if (t.st === "wait") return {k:"wait", w:"Чака поръчка", i:"hourglass", since:t.since, wait:true};
  if (t.st === "seated") return {k:"busy", w:"Заета", i:"users", since:t.since};
  return {k:"free", w:"Свободна", i:"chair"}; };
ST.readyGroups = function(){ var g = {}; ST.db.orders.forEach(function(o){ o.lines.forEach(function(l){ if (l.st==="ready"){ (g[o.t] = g[o.t] || {t:o.t, lines:[], since:l.readyAt}).lines.push({o:o, l:l}); if (l.readyAt < g[o.t].since) g[o.t].since = l.readyAt; } }); });
  return Object.keys(g).map(function(k){ return g[k]; }).sort(function(a,b){ return (ST.isMine(b.t)-ST.isMine(a.t)) || (a.since-b.since); }); };
ST.openCalls = function(){ return ST.db.calls.slice().sort(function(a,b){ return a.since - b.since; }); };
ST.pendingQR = function(){ return ST.db.orders.filter(function(o){ return o.pending; }); };
ST.tLabel = function(n){ var t = ST.tableByN[n]; return "Маса " + n + " · " + ST.ZONE[t.zone]; };

/* ---------- actions ---------- */
ST.takeCall = function(id){ var c = ST.db.calls.filter(function(x){ return x.id===id; })[0]; if (c){ c.taken = "me"; c.takenAt = Date.now(); ST.save(); } };
ST.doneCall = function(id){ ST.db.calls = ST.db.calls.filter(function(x){ return x.id!==id; }); ST.save(); };
ST.restoreCall = function(c){ ST.db.calls.push(c); ST.save(); };
ST.serve = function(oid, idx){ ST.db.orders.forEach(function(o){ if (o.id===oid) o.lines[idx].st = "served"; }); ST.save(); };
ST.serveTable = function(n){ ST.ordersOf(n).forEach(function(o){ o.lines.forEach(function(l){ if (l.st==="ready") l.st="served"; }); }); ST.save(); };
ST.confirmQR = function(oid){ ST.db.orders.forEach(function(o){ if (o.id===oid){ o.pending = false; o.at = Date.now(); } }); ST.save(); };
ST.rejectQR = function(oid){ ST.db.orders = ST.db.orders.filter(function(o){ return o.id!==oid; }); ST.save(); };
ST.sendOrder = function(n, groups, note){ var ids = [];
  Object.keys(groups).forEach(function(bill){ var lines = groups[bill].filter(function(l){ return l.q>0; }); if (!lines.length) return;
    ST.db.seq++; ids.push(ST.db.seq);
    var o = {id:String(ST.db.seq), t:n, at:Date.now(), src:"me", bill: bill==="all" ? "" : bill, pending:false, note:note||"", queued: ST.offline, lines: lines.map(function(l){ return {id:l.id, q:l.q, g:l.g||0, st:"acc", note:l.note||"", readyAt:null}; })};
    ST.db.orders.push(o); });
  var t = ST.db.tables[n]; if (t.st !== "seated"){ t.st = "seated"; t.since = Date.now(); }
  ST.db.calls = ST.db.calls.filter(function(c){ return !(c.t===n && c.r==="order"); });
  ST.save(); return ids; };
ST.markPaid = function(n, key, how, sum, lines){ ST.db.paid[n] = ST.db.paid[n] || []; ST.db.paid[n].push({key:key, how:how, sum:sum, lines:lines||[], at:Date.now()});
  ST.db.calls = ST.db.calls.filter(function(c){ return !(c.t===n && c.r==="bill"); }); ST.save(); };
ST.paidLines = function(n){ var r = {}; (ST.db.paid[n]||[]).forEach(function(p){ (p.lines||[]).forEach(function(k){ r[k] = 1; }); }); return r; };
ST.paidSum = function(n){ return (ST.db.paid[n]||[]).reduce(function(s,p){ return s+p.sum; }, 0); };
ST.closeTable = function(n){ ST.db.orders = ST.db.orders.filter(function(o){ return o.t!==n; }); ST.db.calls = ST.db.calls.filter(function(c){ return c.t!==n; }); delete ST.db.paid[n]; ST.db.tables[n].st = "free"; ST.db.tables[n].since = Date.now(); ST.save(); };

/* ---------- UI helpers ---------- */
ST.stt = function(k, word, icon, extra){ return '<span class="stt '+k+'">'+ic(icon,18)+'<span>'+esc(word)+'</span>'+(extra||"")+'</span>'; };
ST.lineStt = function(st){ return ST.stt(st, ST.LINE[st][0], ST.LINE[st][1]); };
ST.timer = function(since, cls){ return '<span class="tnum '+(cls||"")+'" data-since="'+since+'">'+ST.mmss(ST.secs(since))+'</span>'; };
ST.haptic = function(p){ try{ var ua = navigator.userActivation; if (ua && !ua.hasBeenActive) return; navigator.vibrate && navigator.vibrate(p||12); }catch(e){} };

/* ticking timers + warn/late classes on [data-lvl] ancestors */
function tick(){ if (ST.frozen) return; document.querySelectorAll("[data-since]").forEach(function(el){ var s = ST.secs(+el.dataset.since); el.textContent = ST.mmss(s);
  var host = el.closest("[data-lvl]"); if (host){ var l = ST.level(s); host.classList.toggle("warn", l==="warn"); host.classList.toggle("late", l==="late"); } }); }
setInterval(tick, 1000);
ST.tick = function(){ var f = ST.frozen; ST.frozen = false; tick(); ST.frozen = f; };

/* sheet & toast */
ST.sheet = function(o){ var w = document.createElement("div"); w.className = "st-sheetwrap"; var id = "sh"+Math.random().toString(36).slice(2,7);
  w.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="st-sheet" role="dialog" aria-modal="true" aria-labelledby="'+id+'"><div class="handle"></div><div class="sh"><h2 id="'+id+'">'+o.title+'</h2><button class="iconbtn" type="button" data-close aria-label="Затвори">'+ic("x",22)+'</button></div><div class="body">'+o.html+'</div>'+(o.foot?'<div class="sfoot">'+o.foot+'</div>':'')+'</div>';
  document.body.appendChild(w); var prev = document.activeElement;
  var bg = [ST.app, document.querySelector(".st-nav"), document.querySelector(".st-bar")].filter(Boolean); bg.forEach(function(el){ el.inert = true; });
  w.addEventListener("keydown", function(e){ if (e.key !== "Tab") return; var f = Array.prototype.filter.call(w.querySelectorAll(".st-sheet button:not([disabled]), .st-sheet a[href], .st-sheet input, .st-sheet textarea, .st-sheet select"), function(el){ return el.offsetParent !== null; });
    if (!f.length) return; var a = f[0], z = f[f.length-1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } });
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); var f = w.querySelector("[data-close]"); f && f.focus({preventScroll:true}); }); });
  function close(){ if (document.querySelectorAll(".st-sheetwrap.on").length <= 1) bg.forEach(function(el){ el.inert = false; }); w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 340); prev && prev.focus && prev.focus({preventScroll:true}); }
  w.querySelector(".scrim").onclick = close; w.querySelector("[data-close]").onclick = close;
  return {el:w, close:close, body:w.querySelector(".body"), foot:w.querySelector(".sfoot")}; };
document.addEventListener("keydown", function(e){ if (e.key==="Escape"){ var w = document.querySelectorAll(".st-sheetwrap.on"); if (w.length) w[w.length-1].querySelector("[data-close]").click(); } });
var toastT;
ST.toast = function(text, undo, label){ var t = document.querySelector(".st-toast"); if (!t){ t = document.createElement("div"); t.className = "st-toast"; t.setAttribute("role","status"); document.body.appendChild(t); }
  t.innerHTML = '<span>'+text+'</span>' + (undo ? '<button type="button">'+(label||"Отмени")+'</button>' : '');
  t.classList.toggle("solo", !undo);
  if (undo) t.querySelector("button").onclick = function(){ undo(); t.classList.remove("on"); };
  t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function(){ t.classList.remove("on"); }, undo ? 5000 : 2600); };

/* ---------- chrome ---------- */
/* the single "for me" queue: my tables' calls + free calls from other tables + QR to confirm on my tables */
ST.myCalls = function(){ return ST.openCalls().filter(function(c){ return c.taken !== "other" && (ST.isMine(c.t) || !c.taken); }); };
ST.myQR = function(){ return ST.pendingQR().filter(function(o){ return ST.isMine(o.t); }); };
ST.myQueueCount = function(){ return ST.myCalls().length + ST.myQR().length; };
function counts(){ var mine = ST.myQueueCount();
  var ready = 0; ST.db.orders.forEach(function(o){ o.lines.forEach(function(l){ if (l.st==="ready") ready++; }); }); return {calls:mine, ready:ready}; }
function updateBadges(){ var c = counts(); [["calls",c.calls],["ready",c.ready]].forEach(function(p){ var el = document.querySelector('[data-cnt="'+p[0]+'"]'); if (!el) return; el.textContent = p[1]; el.hidden = !p[1];
  var a = el.closest("a"); if (a){ var base = a.dataset.label; a.setAttribute("aria-label", base + (p[1] ? ", " + p[1] : "")); } }); }
ST.updateBadges = updateBadges;
function nav(cur){ var c = counts();
  var tabs = [["tables","tables.html","squares-four","Маси"],["calls","calls.html","bell-ringing","Повиквания","calls"],["ready","ready.html","chef-hat","Готови","ready"],["order","order.html","plus","Поръчка"]];
  return '<nav class="st-nav'+(ST.offline?' stale':'')+'" aria-label="Приложение на сервитьора">'+tabs.map(function(t){ var n = t[4] ? c[t[4]] : 0;
    return '<a href="'+t[1]+'" data-label="'+(t[0]==="order"?"Нова поръчка":t[3])+'"'+(t[0]==="order"?' aria-label="Нова поръчка"':'')+''+(cur===t[0]?' aria-current="page"':'')+'>'+ic(t[2],26)+'<span class="lb">'+t[3]+'</span>'+(t[4]?'<span class="cnt'+(t[4]==="ready"?" ember":"")+'" data-cnt="'+t[4]+'"'+(n?'':' hidden')+'>'+n+'</span>':'')+'</a>'; }).join("")+'</nav>'; }
function topbar(o){ var since = ST.clock(ST.db.shiftStart);
  if (o.bare) return '<header class="st-top"><div class="tt"><b class="st-word">Siracusa</b><span>Персонал</span></div>'+(o.right||'')+'</header>';
  var left = o.back ? '<a class="st-back" href="'+o.back.href+'">'+ic("caret-left",22)+esc(o.back.label)+'</a>' : '';
  return '<header class="st-top'+(o.back?' back':'')+'">'+left+'<div class="tt"><b>'+esc(o.title)+'</b><span>'+esc(o.sub || (ST.ME+" · на смяна от "+since))+'</span></div>'+
    '<button class="st-me'+(ST.offline?' off':'')+'" type="button" data-act="menu" aria-label="Смяна и настройки, '+(ST.offline?'няма връзка':'свързано')+'"><span class="dot"></span>Смяна</button></header>'+
    (ST.offline ? '<div class="st-net" role="status">'+ic("warning",22)+'<span>Няма връзка. Поръчките се пазят тук.</span><button type="button" data-act="retry">Опитай пак</button></div>' : ''); }

/* ST.mount({page, title, sub, back:{href,label}, nav:"tables"|"calls"|"ready"|"order"|null, bar:true}) -> <main> */
ST.mount = function(o){ o = o || {};
  document.body.classList.add("st");
  var app = document.createElement("div"); app.className = "st-app" + (o.nav===null ? " nonav" : "") + (o.bar ? " withbar" : ""); app.dataset.page = o.page||"";
  app.innerHTML = topbar(o) + '<main id="main"></main>' + (o.proto===false ? '' : protoPanel());
  document.body.appendChild(app);
  if (o.nav !== null) document.body.insertAdjacentHTML("beforeend", nav(o.nav));
  document.title = o.title + " | Siracusa · Персонал";
  ST.app = app; return app.querySelector("main"); };

/* ---------- shift / settings sheet ---------- */
function themeSeg(){ var t = ST.prefs.theme; return '<div class="st-seg" role="group" aria-label="Тема">'+[["system","Авто"],["light","Светла"],["dark","Тъмна"],["hour","По часа"]].map(function(x){ return '<button type="button" data-act="theme" data-v="'+x[0]+'" aria-pressed="'+(t===x[0])+'">'+x[1]+'</button>'; }).join("")+'</div>'; }
ST.themeSeg = themeSeg;
function menuSheet(){ var mine = ST.MINE.join(", ");
  ST.sheet({title:"Смяна", html:
    '<div class="kvs"><div class="kv"><span class="muted">Сервитьор</span><b>'+ST.ME+'</b></div><div class="kv"><span class="muted">На смяна от</span><b class="tnum">'+ST.clock(ST.db.shiftStart)+'</b></div><div class="kv"><span class="muted">Моите маси</span><b>'+mine+'</b></div><div class="kv"><span class="muted">Връзка</span><b>'+(ST.offline?'Няма връзка':'Свързано')+'</b></div></div>'+
    '<p class="st-cap" style="margin-top:18px">Тема</p>'+themeSeg()+'<p class="small muted" style="margin:8px 0 0">„По часа“ е тъмна от 18:00 до 07:00, защото вечер салонът е тъмен. <span class="prop">'+ic("sparkle",14)+'Предложение</span></p>'+
    '<p class="st-cap" style="margin-top:18px">Известия</p><div class="kvs"><div class="kv"><span>Вибрация за повикване</span><b>2 дълги</b></div><div class="kv"><span>Вибрация за готово ястие</span><b>3 кратки</b></div><div class="kv"><span>Смарт часовник</span><a class="link" href="watch.html">Виж екрана'+ic("caret-right",18)+'</a></div></div>',
    foot:'<a class="pill pill-line pill-lg pill-block" href="login.html#end">'+ic("sign-out",22)+'Приключи смяната</a>'}); }

/* ---------- prototype panel ---------- */
function protoPanel(){ return '<section class="proto" aria-label="Само в прототипа"><h2>Само в прототипа</h2><p>Състояние на смяната (данните са условни за макета):</p><div class="row">'+
  ST.STATES.map(function(s){ return '<button class="chip" type="button" data-act="state" data-v="'+s[0]+'" aria-pressed="'+(ST.state===s[0])+'">'+s[1]+'</button>'; }).join("")+'</div><p>Тема:</p>'+themeSeg()+
  '<div class="row"><button class="chip" type="button" data-act="reset">'+ic("arrow-counter-clockwise",18)+'Върни данните в начало</button><a class="chip" href="index.html" style="text-decoration:none">'+ic("list",18)+'Всички екрани</a></div></section>'; }

/* ---------- global delegation (data-act only; SC's own data-* handlers are not used here) ---------- */
document.addEventListener("click", function(e){ var t = e.target.closest("[data-act]"); if (!t) return; var a = t.dataset.act;
  if (a==="menu"){ menuSheet(); return; }
  if (a==="theme"){ ST.prefs.theme = t.dataset.v; savePrefs(); applyTheme(); document.querySelectorAll('[data-act="theme"]').forEach(function(b){ b.setAttribute("aria-pressed", b.dataset.v===ST.prefs.theme); }); return; }
  if (a==="state"){ ST.prefs.state = t.dataset.v; savePrefs(); var h = location.hash.replace(/(^#|&)s=[a-z]+/,""); location.hash = h; location.reload(); return; }
  if (a==="reset"){ ST.reset(); location.reload(); return; }
  if (a==="retry"){ t.disabled = true; t.textContent = "Проверяваме…"; setTimeout(function(){ t.disabled = false; t.textContent = "Опитай пак"; ST.toast("Още няма връзка. Опитваме сами на всеки 10 сек."); }, 900); return; }
});

/* ---------- search (Latin or Cyrillic, forgiving) ---------- */
var TR = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sht","ъ":"a","ь":"y","ю":"yu","я":"ya"};
ST.translit = function(s){ return String(s).toLowerCase().split("").map(function(c){ return TR[c] != null ? TR[c] : c; }).join(""); };
var SYN = [[/pizz?a/g,"pica"],[/kebab/g,"kebap"],[/cheese ?burger|chizburger/g,"ciizburger"],[/angus/g,"angas"],[/steak/g,"stek"],[/ribeye/g,"ribai"]];
ST.norm = function(s){ var t = String(s).toLowerCase(); SYN.forEach(function(r){ t = t.replace(r[0], r[1]); }); return ST.translit(t).replace(/sht/g,"st").replace(/zh/g,"z").replace(/ch/g,"c").replace(/sh/g,"s").replace(/ts/g,"c").replace(/yu/g,"u").replace(/ya/g,"a").replace(/[yj]/g,"i").replace(/w/g,"v").replace(/x/g,"ks").replace(/q/g,"k").replace(/zz/g,"c").replace(/ck/g,"k").replace(/ee/g,"i").replace(/[^a-z0-9 ]/g," ").replace(/([a-z])\1+/g,"$1").replace(/\s+/g," ").trim(); };
var IDX = SC.items.map(function(x){ return {x:x, k:ST.norm(x.n)}; });
ST.search = function(q){ var n = ST.norm(q); if (!n) return []; var parts = n.split(" ");
  return IDX.filter(function(r){ return parts.every(function(p){ return r.k.indexOf(p) > -1; }); })
    .sort(function(a,b){ var fa = FREQ()[a.x.id]||0, fb = FREQ()[b.x.id]||0; return (fb - fa) || (b.k.indexOf(parts[0])===0) - (a.k.indexOf(parts[0])===0) || a.x.n.length - b.x.n.length; }).map(function(r){ return r.x; }); };
var _freq = null; function FREQ(){ if (_freq) return _freq; _freq = {}; ST.db.orders.forEach(function(o){ o.lines.forEach(function(l){ _freq[l.id] = (_freq[l.id]||0) + l.q; }); }); ["pitsa-margarita","kebapcheta","gratska-salata","pitsa-kaprichoza"].forEach(function(id,i){ _freq[id] = (_freq[id]||0) + 4 - i; }); return _freq; }
/* "last ordered" (mock: from the tables' orders, most frequent first) */
ST.recent = function(){ var c = {}; ST.db.orders.forEach(function(o){ o.lines.forEach(function(l){ c[l.id] = (c[l.id]||0) + l.q; }); });
  var ids = Object.keys(c).sort(function(a,b){ return c[b]-c[a]; });
  ["pitsa-margarita","kebapcheta","gratska-salata","svinski-vrat","tiramisu","pitsa-kaprichoza"].forEach(function(id){ if (ids.indexOf(id)<0) ids.push(id); });
  return ids.filter(function(id){ return SC.byId[id]; }).slice(0,6); };

if (ST.db) setTimeout(updateBadges, 0);
window.addEventListener("hashchange", function(){ location.reload(); });
})();
