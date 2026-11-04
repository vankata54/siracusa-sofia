/* Кухня: общ runtime за екраните на кухнята (прототип). Зарежда се след ../ds/icons.js, ../data/menu.js, ../ds/sc.js.
   Ползва от SC само данни и помощници (SC.byId, SC.cats, SC.fmt, SC.ic, SC.esc). Своя рамка: K.mount().
   Параметрите са само през # : s=<секция> (topla|skara|pesht|studeni), st=<състояние> (many|empty|new|offline), t=<тема> (dark|light).
   Данните за поръчките са УСЛОВНИ за макета; ястията са истинските от менюто. */
(function(){
"use strict";
var K = window.K = {};
var ic = SC.ic, esc = SC.esc;

/* ---------- per-tablet convenience storage (try/catch: may be blocked) ---------- */
function load(k, d){ try{ var v = localStorage.getItem("sk-"+k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function store(k, v){ try{ localStorage.setItem("sk-"+k, JSON.stringify(v)); }catch(e){} }
K.load = load; K.store = store;

/* ---------- sections (условно: [ЛИПСВА: секциите на кухнята и кое ястие къде се готви]) ---------- */
K.SECTIONS = [
  {id:"topla",   n:"Топла кухня",      ic:"cooking-pot", cats:["supi","topli-predyastia","osnovni-yastia","pasta-i-rizoto","burgeri","garnituri","zakuski","obedno"]},
  {id:"skara",   n:"Скара Bertha",     ic:"fire",        cats:["skara-bertha"]},
  {id:"pesht",   n:"Пещ за пици",      ic:"pizza",       cats:["pitsi","hlebcheta"]},
  {id:"studeni", n:"Салати и студени", ic:"bowl-food",   cats:["salati","studeni-predyastia","sosove","deserti"]}
];
K.secById = {}; K.SECTIONS.forEach(function(s){ K.secById[s.id] = s; });
K.secOfCat = {}; K.SECTIONS.forEach(function(s){ s.cats.forEach(function(c){ K.secOfCat[c] = s.id; }); });
K.secOf = function(id){ var x = SC.byId[id]; return x ? K.secOfCat[x.cat] : null; };
K.shortSec = {topla:"Топла", skara:"Скара", pesht:"Пещ", studeni:"Салати"};
/* „Добавки“ нямат свой ред: готвят се в секцията на основното ястие и се показват под него (+ гъби). Изчерпват се от всяка секция. */
K.SHARED_CATS = ["dobavki"];
/* обедното меню (SC.lunch, cat "obedno") е условно в „Топла кухня“ [ЛИПСВА] */

/* ---------- hash params ---------- */
K.hash = {};
(location.hash.slice(1) || "").split("&").forEach(function(p){ var i = p.indexOf("="); if (i > 0) K.hash[p.slice(0,i)] = decodeURIComponent(p.slice(i+1)); });
K.all = K.hash.s === "all"; /* общ изглед на главния готвач */
K.secId = K.all ? "all" : K.secById[K.hash.s] ? K.hash.s : (K.secById[load("sec","")] ? load("sec","") : "skara");
K.sec = K.all ? {id:"all", n:"Общ изглед", ic:"chef-hat", cats:[].concat.apply([], K.SECTIONS.map(function(s){ return s.cats; }))} : K.secById[K.secId];
K.st = K.hash.st || "";
K.theme = K.hash.t || load("theme", "dark");
document.documentElement.setAttribute("data-theme", K.theme === "light" ? "light" : "dark");
K.link = function(page, extra){ return page + ".html#s=" + K.secId + (K.hash.t ? "&t=" + K.hash.t : "") + (extra ? "&" + extra : ""); };

/* ---------- clock (условно: прототипът започва в 19:42 и тече) ---------- */
var T0 = 19*3600 + 42*60, started = Date.now();
K.now = function(){ return T0 + Math.floor((Date.now() - started) / 1000); };
K.s = function(hm){ var a = hm.split(":"); return (+a[0])*3600 + (+a[1])*60; };
K.hm = function(sec){ sec = Math.floor(sec/60); return String(Math.floor(sec/60)%24).padStart(2,"0") + ":" + String(sec%60).padStart(2,"0"); };
K.mmss = function(sec){ sec = Math.abs(sec); return String(Math.floor(sec/60)).padStart(2,"0") + ":" + String(sec%60).padStart(2,"0"); };
K.mins = function(sec){ return Math.max(0, Math.round(sec/60)); };

/* ---------- време: един източник (решение на шефа) ----------
   Срок в кухнята: 20 мин за всеки канал (условно, [ЛИПСВА: норми]). Доставка до клиента: около 35 мин (= SC.eta() в обичаен режим).
   „Натоварено“ е САМО ръчният превключвател тук: +20 мин за новите поръчки, доставката става „около 55 мин“ (пакет 10.9 и 12). */
K.NORM = 20; K.DELIVERY = 35;
K.BUSY_MIN = 20;
K.custText = function(on){ return on ? "Възможни са закъснения · около " + (K.DELIVERY + K.BUSY_MIN) + " мин" : "около " + K.DELIVERY + " мин"; };
K.busy = function(){ return load("busy", {on:false, at:null, by:null, log:[{on:"13:05", off:"13:50", by:"Общ изглед"}]}); };
K.setBusy = function(on){ var b = K.busy(), t = K.hm(K.now());
  if (on){ b.on = true; b.at = t; b.by = K.all ? "Главен готвач (Общ изглед)" : K.sec.n; }
  else { if (b.on && b.at) b.log.unshift({on:b.at, off:t, by:b.by}); b.on = false; b.at = null; b.by = null; }
  store("busy", b); return b; };
K.OUT_DEFAULT = [{id:"teleshki-kyufteta-ot-blek-angas", at:"18:05", sec:"skara"}, {id:"katmer", at:"17:40", sec:"studeni"}];
K.outSec = function(id){ var x = SC.byId[id]; return x && K.SHARED_CATS.indexOf(x.cat) > -1 ? "shared" : K.secOf(id); };
K.outMine = function(){ return K.outs().filter(function(o){ return K.all || o.sec === K.secId || o.sec === "shared"; }); };
K.outs = function(){ return load("outs", K.OUT_DEFAULT); };
K.isOut = function(id){ return K.outs().some(function(o){ return o.id === id; }); };
K.setOut = function(id, on){ var o = K.outs().filter(function(x){ return x.id !== id; });
  if (on) o.unshift({id:id, at:K.hm(K.now()), sec:K.outSec(id)}); store("outs", o); return o; };
K.outBadge = function(){ var a = document.querySelector('.ktabs a[href^="item-out"]'); if (!a) return;
  var n = K.outMine().length, b = a.querySelector(".n");
  if (!n){ if (b) b.remove(); return; } if (!b){ b = document.createElement("span"); b.className = "n warn"; a.appendChild(b); } b.textContent = n; };
K.sound = function(){ return load("sound", true); };
/* браузърът пуска звук само след докосване: докато не е отключен, „Звук“ не се показва като включен */
K.audioReady = false;
K.unlock = function(){ try{ var A = window.AudioContext || window.webkitAudioContext; K._ac = K._ac || new A(); if (K._ac.resume) K._ac.resume(); K.audioReady = true; }catch(e){} };

/* ---------- mock orders (УСЛОВНИ). Line: [qty, itemId, {no:[], add:[], nt:"", w:"", st:"done"}] ---------- */
function O(kind, num, at, due, lines, extra){ var o = {kind:kind, num:num, at:K.s(at), due:K.s(at) + K.NORM*60, lines:lines.map(function(l){ return {q:l[0], id:l[1], o:l[2]||{}}; })};
  for (var k in extra) o[k] = extra[k];
  if (kind === "pickup") o.pickupAt = K.hm(o.due); /* „вземане възможно най-скоро“ = срокът в кухнята */
  if (kind === "delivery") o.driver = K.hm(o.due + 4*60); /* условно: шофьорът тръгва 4 мин след срока */
  return o; }
var BASE = function(){ return [
  O("table", 12, "19:18", "19:38", [[2,"kebapcheta",{no:["лук"]}],[1,"svinski-vrat"],[1,"parzheni-kartofi",{st:"done"}],[1,"shopska-salata",{st:"done"}],[1,"pitsa-margarita"]], {zone:"Салон", startedBy:{skara:"19:22", pesht:"19:24"}}),
  O("table", 9, "19:24", "19:44", [[2,"pileshka-supa",{st:"done"}],[1,"spageti-karbonara"],[1,"salata-tsezar-s-pileshki-prachki",{st:"done"}],[1,"pitsa-s-proshuto-koto-i-tryufel"],[1,"svinski-kyufteta"]], {zone:"Градина", startedBy:{topla:"19:26"}}),
  O("delivery", 1042, "19:26", "19:47", [[1,"pileshko-file"],[1,"pleskavitsa",{nt:"Добре изпечена"}],[1,"pitsa-dyavolo",{add:["гъби"]}],[1,"kartofeno-pyure"]], {note:"Без прибори", startedBy:{skara:"19:30"}}),
  O("table", 7, "19:30", "19:50", [[1,"t-bon-stek-ot-blek-angas",{w:"600 гр.", nt:"Средно изпечен"}],[1,"ushtiptsi"],[2,"grilovani-zelenchutsi"]], {zone:"Градина"}),
  O("pickup", 1043, "19:33", "20:00", [[1,"svinski-rebra"],[1,"chiyzburger-s-teleshko-kyufte-blek-angas-s-parzh",{no:["лук"], add:["кашкавал"]}],[1,"tiramisu"],[1,"l-lazanya-boloneze"]], {}),
  O("table", 4, "19:35", "19:55", [[1,"shkembe"],[1,"teleshki-buzi-s-kartofeno-pyure"],[1,"shopska-salata",{no:["лук"]}],[1,"kyunefe",{nt:"След основното"}]], {zone:"Салон"}),
  O("table", 3, "19:37", "19:57", [[3,"kebapcheta"],[2,"svinski-kyufteta",{no:["лук"]}],[1,"parzheni-kartofi"],[2,"parlenka-s-chesan"]], {zone:"Салон"}),
  O("pickup", 1045, "19:38", "20:05", [[2,"pitsa-margarita",{add:["гъби"]}],[1,"pitsa-s-lukanka",{add:["кашкавал"]}],[1,"parlenka-s-chesan"]], {}),
  O("table", 15, "19:39", "19:59", [[2,"pileshko-file"],[1,"ribay-stek-ot-blek-angas",{w:"400 гр.", nt:"Алангле"}],[1,"salata-s-kinoa-beybi-spanak-i-feta"]], {zone:"Градина", note:"Алергия към ядки"}),
  O("delivery", 1044, "19:40", "20:02", [[2,"teleshki-sudzhuk"],[1,"pitsa-kaprichoza"],[1,"gratska-salata"],[1,"glazirani-pileshki-kascheta-s-kartofeno-pyure"]], {})
]; };
/* extra orders for the "many" state: cycles through the current section's dishes */
function many(sec){ var pool = SC.items.filter(function(x){ return sec.cats.indexOf(x.cat) > -1 && !K.isOut(x.id); }), out = [], i;
  var other = {topla:"shopska-salata", skara:"parzheni-kartofi", pesht:"gratska-salata", studeni:"kebapcheta"}[sec.id];
  for (i = 0; i < 9; i++){ var at = 19*60 + 41 - (8 - i) % 3, a = pool[(i*3) % pool.length], b = pool[(i*5+2) % pool.length];
    var hm = function(m){ return String(Math.floor(m/60)).padStart(2,"0") + ":" + String(m%60).padStart(2,"0"); };
    var kind = ["table","delivery","table","pickup"][i%4];
    out.push(O(kind, kind === "table" ? [2,5,6,8,10,11,14,16,18][i] : 1046 + i, hm(at), hm(at + (kind === "table" ? 20 : 24)),
      [[1 + (i%3 === 0 ? 1 : 0), a.id], [1, b.id, i%4 === 1 ? {no:["лук"]} : {}], [1, other]],
      {zone: i%2 ? "Градина" : "Салон"}));
  }
  return out; }
K.orders = function(){
  var list = K.st === "empty" ? [] : BASE();
  if (K.st === "many") list = list.concat(many(K.sec));
  var b = K.busy();
  list.forEach(function(o){ if (b.on && b.at && o.at >= K.s(b.at)) { o.due += K.BUSY_MIN*60; o.busy = true; } });
  list.sort(function(a,b){ return a.at - b.at; });
  return list; };
/* a just-arrived order for the "new" state and for "Пусни нова поръчка" */
K.newOrder = function(){ var n = K.now();
  var pick = {topla:["spageti-boloneze","rizoto-s-gorski-gabi-i-tryufel-pasta"], skara:["svinski-vrat","kebapcheta"], pesht:["pitsa-kuatro-formadzhi","pitsa-vegetariana"], studeni:["kapreze-s-burata-i-avokado","salata-sirakuza"]}[K.secId];
  var o = O("table", 20, K.hm(n), "", [[2, pick[0]], [1, pick[1], {no:["лук"]}], [1, K.secId === "skara" ? "parzheni-kartofi" : "kebapcheta"]], {zone:"Градина", isNew:true});
  var b = K.busy(); if (b.on){ o.due += K.BUSY_MIN*60; o.busy = true; }
  return o; };

/* едно състояние на секция в поръчка, еднакво навсякъде: чака / готви се / готово */
K.secState = function(o, sid){ var ls = o.lines.filter(function(l){ return K.secOf(l.id) === sid; }); if (!ls.length) return null;
  if (ls.every(function(l){ return l.o.st === "done"; })) return "done"; return o.startedBy && o.startedBy[sid] ? "cook" : "wait"; };
K.ST_TXT = {done:"готово", cook:"готви се", wait:"чака"}; K.ST_IC = {done:"check", cook:"flame", wait:"hourglass"};
K.mine = function(o, secId){ return o.lines.filter(function(l){ return K.secOf(l.id) === (secId || K.secId); }); };
K.others = function(o, secId){ return o.lines.filter(function(l){ return K.secOf(l.id) !== (secId || K.secId); }); };
K.left = function(o){ return o.due - K.now(); };
K.SOON = 5*60; /* условно: „наближава“ 5 мин преди срока [ЛИПСВА: норми за време] */
K.stateOf = function(o){ var l = K.left(o); return l < 0 ? "late" : l <= K.SOON ? "soon" : "ok"; };
K.src = function(o){
  if (o.kind === "table") return {ic:"fork-knife", k:(o.zone || "Салон"), t:"Маса " + o.num, who:"сервитьора"};
  if (o.kind === "delivery") return {ic:"moped", k:"Доставка", t:"№ " + o.num, who:"шофьора"};
  return {ic:"storefront", k:"Вземане в " + (o.pickupAt || ""), t:"№ " + o.num, who:"клиента", pick:true};
};
K.srcText = function(o){ return o.kind === "table" ? "Маса " + o.num : (o.kind === "delivery" ? "Доставка № " : "Вземане № ") + o.num; };

/* ---------- ticket ---------- */
function mods(l){ var o = l.o, h = "";
  (o.no||[]).forEach(function(t){ h += '<span class="md no">' + ic("minus",18) + 'без ' + esc(t) + '</span>'; });
  (o.add||[]).forEach(function(t){ var out = K.outs().some(function(x){ var d = SC.byId[x.id]; return d && d.cat === "dobavki" && d.n.toLowerCase() === t.toLowerCase(); });
    h += '<span class="md add">' + ic("plus",18) + esc(t) + (out ? ' · изчерпано днес' : '') + '</span>'; });
  if (o.nt) h += '<span class="md nt">' + ic("note",18) + esc(o.nt) + '</span>';
  if (K.isOut(l.id)) h += '<span class="md out">' + ic("x",18) + 'Изчерпано днес</span>';
  return h ? '<span class="mds">' + h + '</span>' : ""; }
K.lineHTML = function(l, i){ var x = SC.byId[l.id], done = l.o.st === "done";
  return '<button class="ln' + (done ? " done" : "") + '" type="button" data-ln="' + i + '" aria-pressed="' + done + '" aria-label="' + l.q + ' по ' + esc(x.n) + (done ? ", готово" : ", натиснете за готово") + '">' +
    '<span class="q">' + l.q + '&thinsp;×</span><span class="nm">' + esc(x.n) + (l.o.w ? ' <small>' + esc(l.o.w) + '</small>' : '') + '</span><span class="ck">' + ic("check",24) + '</span>' + mods(l) + '</button>'; };
K.timerHTML = function(o){ var l = K.left(o), s = K.stateOf(o);
  var lbl = s === "late" ? ic("warning",18) + "закъснява" : s === "soon" ? ic("hourglass",18) + "наближава" : "остават";
  return '<small>' + lbl + '</small><b>' + (s === "late" ? "+" : "") + K.mmss(l) + '</b>'; };
K.ticket = function(o, idx){
  var src = K.src(o), mine = K.mine(o), oth = K.others(o), started = o.startedBy && o.startedBy[K.secId];
  var allDone = mine.every(function(l){ return l.o.st === "done"; });
  var meta = '<span>пристигна <b>' + K.hm(o.at) + '</b></span><span>срок <b>' + K.hm(o.due) + '</b></span>';
  if (o.driver) meta += '<span>шофьор <b>' + o.driver + '</b></span>';
  if (o.isNew) meta = '<span class="tag new">' + ic("bell-ringing",16) + 'Нова</span>' + meta;
  if (started) meta += '<span class="tag cook">' + ic("flame",16) + 'готви се от ' + started + '</span>';
  if (o.busy) meta += '<span class="tag busy">+' + K.BUSY_MIN + ' мин</span>';
  var h = '<article class="tk ' + K.stateOf(o) + (o.isNew ? " isnew" : "") + '" data-o="' + idx + '" aria-label="' + esc(K.srcText(o)) + '">' +
    '<header class="tk-h"><div class="tk-k' + (src.pick ? " pick" : "") + '">' + ic(src.ic,20) + '<span>' + esc(src.k) + '</span></div>' +
    '<div class="tmr" data-tmr>' + K.timerHTML(o) + '</div><div class="tk-t">' + esc(src.t) + '</div><div class="tk-m">' + meta + '</div></header>' +
    '<div class="tk-b">' + (o.note ? '<div class="tk-note">' + ic("warning-circle",22) + '<span>' + esc(o.note) + '</span></div>' : '') +
    mine.map(function(l){ return K.lineHTML(l, o.lines.indexOf(l)); }).join("");
  if (oth.length) h += '<div class="tk-o"><h4>Други секции</h4>' + oth.map(function(l){ var sid = K.secOf(l.id), st = l.o.st === "done" ? "done" : K.secState(o, sid) === "cook" ? "cook" : "wait";
      return '<div><span class="num">' + l.q + '&thinsp;×</span><span>' + esc(SC.byId[l.id].n) + '</span><span class="os ' + st + '">' + ic(K.ST_IC[st],15) + K.shortSec[sid] + ' · ' + K.ST_TXT[st] + '</span></div>'; }).join("") + '</div>';
  h += '</div><footer class="tk-f' + (started || allDone ? " one" : "") + '">' +
    (started || allDone ? "" : '<button class="kb ink" type="button" data-start>' + ic("flame",22) + 'Започни</button>') +
    '<button class="kb ok hold" type="button" data-done aria-label="Готово, ' + esc(K.srcText(o)) + '. Задръжте 1 секунда"><span class="lbl"><span>' + ic("check-circle",24) + ' Готово</span><small>задръжте 1 сек.</small></span></button></footer></article>';
  return h; };

/* ---------- press-and-hold 1 s (keyboard Enter/Space confirms at once; "Върни" covers mistakes) ---------- */
K.hold = function(btn, fn){ var t = null;
  function stop(){ clearTimeout(t); t = null; btn.classList.remove("holding"); }
  btn.addEventListener("pointerdown", function(e){ if (e.button) return; btn.classList.add("holding"); t = setTimeout(function(){ stop(); fn(); }, 1000); });
  ["pointerup","pointerleave","pointercancel"].forEach(function(ev){ btn.addEventListener(ev, stop); });
  btn.addEventListener("click", function(e){ if (e.detail === 0) fn(); });
  btn.addEventListener("contextmenu", function(e){ e.preventDefault(); }); };

/* ---------- toast with undo (10 s) ---------- */
K.toast = function(html, undo, secs){ secs = secs || 10; var layer = document.querySelector(".ktoasts");
  var el = document.createElement("div"); el.className = "kt"; el.setAttribute("role", "status");
  el.innerHTML = ic("check-circle",28) + '<span>' + html + '</span>' + (undo ? '<button type="button">' + ic("arrow-counter-clockwise",20).replace('class="ic"','class="ic" style="display:inline;vertical-align:-4px;margin-right:6px;color:inherit"') + 'Върни · <b class="num">' + secs + '</b></button>' : '') + '<i style="animation-duration:' + secs + 's"></i>';
  if (K._toast) K._toast.close(); /* най-много едно известие: новото заменя старото */
  layer.appendChild(el); var left = secs, b = el.querySelector("button b");
  var iv = setInterval(function(){ left--; if (b) b.textContent = left; if (left <= 0) close(); }, 1000);
  function close(){ clearInterval(iv); if (el.parentNode) el.parentNode.removeChild(el); }
  if (undo) el.querySelector("button").addEventListener("click", function(){ close(); undo(); });
  K._toast = {close:close}; return K._toast; };

/* ---------- soft beep for new orders (only after a tap, browsers block sound before that) ---------- */
K.beep = function(){ if (!K.sound() || !K.audioReady) return; try{ var A = window.AudioContext || window.webkitAudioContext; var c = K._ac || (K._ac = new A());
  [0, .22].forEach(function(d){ var o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination);
    g.gain.setValueAtTime(.0001, c.currentTime + d); g.gain.exponentialRampToValueAtTime(.25, c.currentTime + d + .02); g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + d + .18);
    o.start(c.currentTime + d); o.stop(c.currentTime + d + .2); }); }catch(e){} };

/* ---------- frame ---------- */
var TABS = [["queue","Опашка","list-checks"],["item-out","Изчерпано","x"],["done","Изпълнени","check-circle"],["summary","Общ изглед","squares-four"]];
var TABS_ALL = [["summary","Общ изглед","squares-four"],["item-out","Изчерпано","x"],["busy","Натоварено","hourglass"]];
K.mount = function(opt){
  opt = opt || {}; document.title = (opt.title || "Кухня") + " | Кухня · Siracusa";
  if (K.all && (opt.page === "queue" || opt.page === "done")){ location.replace("summary.html#s=all" + (K.hash.t ? "&t=" + K.hash.t : "")); }
  var off = K.st === "offline", outN = K.outMine().length;
  var qn = K.orders().filter(function(o){ return K.mine(o).length; }).length + (K.st === "new" ? 1 : 0);
  var d = document.createElement("div"); d.className = "kd" + (off ? " offline" : "");
  d.innerHTML =
    '<header class="kbar">' +
      '<a class="ksec" href="login.html#' + (K.hash.t ? "t=" + K.hash.t : "") + '" aria-label="' + esc(K.all ? "Главен готвач" : K.sec.n) + '. Смени секцията"><span class="si">' + ic(K.sec.ic, 26) + '</span><span><b>' + (K.all ? "Главен готвач" : esc(K.sec.n)) + ic("caret-down",18) + '</b><small>Смени секцията</small></span></a>' +
      '<nav class="ktabs" aria-label="Екрани на кухнята">' + (K.all ? TABS_ALL : TABS).map(function(t){
        var n = t[0] === "queue" ? '<span class="n" data-qn>' + qn + '</span>' : t[0] === "item-out" && outN ? '<span class="n warn">' + outN + '</span>' : "";
        return '<a href="' + K.link(t[0]) + '"' + (opt.page === t[0] ? ' aria-current="page"' : '') + '>' + ic(t[2],22) + t[1] + n + '</a>'; }).join("") + '</nav>' +
      '<div class="kclock"><span class="net' + (off ? " off" : "") + '" role="status"><i></i><span>' + (off ? "Няма връзка" : "Онлайн") + '</span></span><b data-clock>' + K.hm(K.now()) + '</b></div>' +
    proto(opt.page) + '</header><div class="kstripw"><div class="kstrip" data-strip></div><div class="ktoasts" aria-live="polite"></div></div><main class="kmain" id="main"></main>';
  document.body.appendChild(d);
  var clock = d.querySelector("[data-clock]"); setInterval(function(){ clock.textContent = K.hm(K.now()); }, 1000);
  K.protoBind(d);
  K.strip = d.querySelector("[data-strip]");
  if (off) K.strip.innerHTML = K.offlineHTML(opt.page);
  return d.querySelector("main"); };
K.protoBind = function(d){
  var pb = d.querySelector(".kproto > button"); pb.addEventListener("click", function(){ var p = d.querySelector(".kproto .pp"); p.hidden = !p.hidden; pb.setAttribute("aria-expanded", String(!p.hidden)); });
  d.querySelectorAll("[data-theme-set]").forEach(function(b){ b.addEventListener("click", function(){ store("theme", b.getAttribute("data-theme-set")); K.hash.t = b.getAttribute("data-theme-set"); location.hash = hashStr(); location.reload(); }); }); };
K.proto = function(page){ return proto(page); };
function hashStr(){ return Object.keys(K.hash).filter(function(k){ return K.hash[k]; }).map(function(k){ return k + "=" + K.hash[k]; }).join("&"); }
function proto(page){
  var states = [["","Обичайно"],["new","Нова поръчка"],["many","Много поръчки"],["empty","Празна опашка"],["offline","Няма връзка"]];
  return '<div class="kproto"><button type="button" aria-expanded="false" aria-label="Само в прототипа">' + ic("sliders-horizontal",18) + '<span>Прототип</span></button><div class="pp" hidden>' +
    '<h3>Само в прототипа</h3><p>Данните за поръчките и часът (19:42) са условни. Ястията са от менюто.</p>' +
    (page === "login" ? "" : '<div class="opts">' + states.map(function(s){ var h = Object.assign({}, K.hash, {st:s[0]});
      return '<a href="' + page + '.html#' + Object.keys(h).filter(function(k){ return h[k]; }).map(function(k){ return k + "=" + h[k]; }).join("&") + '" aria-pressed="' + (K.st === s[0]) + '" onclick="setTimeout(function(){location.reload()},0)">' + s[1] + '</a>'; }).join("") + '</div>') +
    '<div class="opts"><button type="button" data-theme-set="dark" aria-pressed="' + (K.theme !== "light") + '">Тъмна тема</button><button type="button" data-theme-set="light" aria-pressed="' + (K.theme === "light") + '">Светла тема</button></div>' +
    '<div class="opts"><a href="index.html">Всички екрани</a></div></div></div>'; }
K.offlineHTML = function(page){
  var p = page === "queue" ? 'Данните са от <b class="num">19:41</b>. Таймерите вървят по часовника на таблета. „Готово“ се запазва и се изпраща, щом връзката се върне.'
    : page === "summary" ? 'Данните за секциите са от <b class="num">19:41</b> и не се обновяват.' : 'Данните са от <b class="num">19:41</b>. Промените се запазват и се изпращат, щом връзката се върне.';
  return '<div class="koff" role="alert">' + ic("warning",32) + '<div><b>Няма връзка.' + (page === "summary" ? '' : ' Новите поръчки не идват.') + '</b>' +
  '<p>' + p + '</p>' +
  '<ol><li>Проверете Wi-Fi на таблета.</li><li>Ако до 2 мин няма връзка, кажете на управителя. <span class="miss">[ЛИПСВА: резервен интернет и ред при срив]</span></li></ol></div>' +
  '<button class="kb line" type="button" onclick="location.reload()">' + ic("arrow-clockwise",22) + 'Опитай пак</button></div>'; };

/* ---------- done today (УСЛОВНО) ---------- */
K.doneToday = function(){ var pool = SC.items.filter(function(x){ return K.sec.cats.indexOf(x.cat) > -1; }).concat(K.secId === "topla" ? SC.lunch : []); return [
  ["19:40","table",11,"19:21","19:41",[[2,"kebapcheta"],[1,"svinski-vrat"]]],
  ["19:37","delivery",1040,"19:12","19:34",[[1,"pleskavitsa"],[1,"pileshko-file"]]],
  ["19:31","table",6,"19:10","19:30",[[2,"svinski-kyufteta",{no:["лук"]}],[1,"ushtiptsi"]]],
  ["19:22","pickup",1039,"19:00","19:25",[[1,"svinski-rebra"]]],
  ["19:15","table",2,"18:58","19:18",[[1,"ribay-stek-ot-blek-angas",{w:"300 гр."}],[2,"pileshko-file"]]],
  ["19:04","table",14,"18:41","19:01",[[4,"kebapcheta"],[2,"teleshki-sudzhuk"]]],
  ["18:52","delivery",1037,"18:30","18:52",[[1,"svinski-vrat"]]],
  ["18:40","table",8,"18:20","18:40",[[1,"t-bon-stek-ot-blek-angas",{w:"500 гр."}]]]
].map(function(r, i){ return {doneAt:r[0], kind:r[1], num:r[2], at:K.s(r[3]), due:K.s(r[3]) + K.NORM*60, zone:i%2 ? "Градина" : "Салон",
  lines:r[5].map(function(l, j){ var id = l[1], o = l[2]||{};
    if (K.secId !== "skara"){ id = pool[(i*2 + j*5) % pool.length].id; o = {}; } /* other sections: same rhythm, their own dishes */
    return {q:l[0], id:id, o:o}; })}; }); };
})();
