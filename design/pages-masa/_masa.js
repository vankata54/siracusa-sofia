/* QR маса: shared runtime for design/pages-masa. Load after ../ds/icons.js, ../data/menu.js, ../ds/sc.js.
   Holds the table session (shared cart, sent orders with dish statuses, waiter calls, bill, rating),
   the module chrome (header with the table, bottom nav per decision 34, profile sheet), the blocking states
   and the prototype-only panel. In the prototype the session lives in localStorage; two tabs act as two phones. */
(function(){
"use strict";
var SC = window.SC, ic = SC.ic, esc = SC.esc;
var M = window.MASA = {};
var KEY = "sc-masa", CKEY = "sc-masa-cfg";

/* ---------- settings owned by the admin (sample values only in the prototype) ---------- */
var CFG = Object.assign({cooldown:3, manager:5, table:"G2"}, SC.load(CKEY, {}));
M.cfg = CFG;
M.saveCfg = function(){ SC.store(CKEY, CFG); };

/* ---------- people at the table: this phone + 2 simulated phones (no invented names) ---------- */
M.GUESTS = {me:{bg:"Вие", en:"You", ini:["В","Y"]}, g2:{bg:"Телефон 2", en:"Phone 2", ini:["2","2"]}, g3:{bg:"Телефон 3", en:"Phone 3", ini:["3","3"]}};
M.WHO = ["me","g2","g3"];
function uid(){ return Math.random().toString(36).slice(2,9); }
function ln(id, who, q, ago){ return {key:uid(), id:id, q:q||1, who:who, at:Date.now()-(ago||0)*1000}; }
function seedDraft(){ return [ln("pitsa-margarita","g2",1,140), ln("shopska-salata","g2",1,130), ln("kebapcheta","g3",1,90), ln("parzheni-kartofi","g3",1,80)]; }
function fresh(){ return {v:1, mode:"open", lang:"bg", offline:false, draft:seedDraft(), rounds:[], calls:{}, bill:null, rating:null, sim:{}, skew:0, opened:Date.now()-14*60000}; }
var S = SC.load(KEY, null); if (!S || S.v !== 1) S = fresh();
M.st = S;
function replace(n){ Object.keys(S).forEach(function(k){ delete S[k]; }); Object.assign(S, n); }
var subs = [];
M.on = function(f){ subs.push(f); };
function emit(why){ subs.forEach(function(f){ try{ f(why); }catch(e){ console.error(e); } }); }
M.save = function(why){ SC.store(KEY, S); emit(why || "save"); };
M.reset = function(){ var l = S.lang; replace(fresh()); S.lang = l; SC.store(KEY, S); };
/* another tab = another phone at the same table */
window.addEventListener("storage", function(e){ if (e.key === KEY){ var n = SC.load(KEY, null); if (n){ replace(n); emit("remote"); } } });

/* ---------- language ---------- */
M.L = function(bg, en){ return S.lang === "en" && en != null ? en : bg; };
var L = M.L;
M.name = function(who){ var g = M.GUESTS[who] || M.GUESTS.g2; return L(g.bg, g.en); };
M.av = function(who, sm){ var g = M.GUESTS[who] || M.GUESTS.g2; return '<span class="av '+(who==="me"?"":who)+(sm?" sm":"")+'" aria-hidden="true">'+(S.lang==="en"?g.ini[1]:g.ini[0])+'</span>'; };
M.whoTag = function(who){ return '<span class="who">'+M.av(who, true)+esc(M.name(who))+'</span>'; };

/* ---------- table ---------- */
M.table = function(){ return SC.TABLES.filter(function(t){ return t.id === CFG.table; })[0] || SC.TABLES[13]; };
M.zone = function(t){ t = t || M.table(); return t.zone === "garden" ? L("Градина","Garden") : L("Салон","Hall"); };
M.tableLabel = function(){ var t = M.table(); return L("Маса ","Table ")+t.n+" · "+M.zone(t); };

/* ---------- time helpers ---------- */
M.now = function(){ return Date.now(); };
M.mmss = function(sec){ sec = Math.max(0, Math.round(sec)); return Math.floor(sec/60)+":"+String(sec%60).padStart(2,"0"); };
M.clock = function(ts){ var d = new Date(ts); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); };
M.kitchen = function(){ return SC.state().kitchen; };
M.canOrder = function(){ return S.mode === "open" && !S.offline && M.kitchen(); };

/* ---------- shared cart (draft = not sent yet) ---------- */
M.sum = function(list){ return list.reduce(function(a,l){ var x = SC.byId[l.id]; return a + (x ? x.p*l.q : 0); }, 0); };
M.qty = function(list){ return list.reduce(function(a,l){ return a + l.q; }, 0); };
M.add = function(id, who){ who = who || "me"; var l = S.draft.filter(function(z){ return z.id === id && z.who === who; })[0];
  if (l) l.q++; else S.draft.push(ln(id, who, 1, 0)); M.save("add"); return l || S.draft[S.draft.length-1]; };
M.setQty = function(key, q){ S.draft = S.draft.map(function(l){ if (l.key === key) l.q = q; return l; }).filter(function(l){ return l.q > 0; }); M.save("qty"); };
M.removeLine = function(key){ var gone = S.draft.filter(function(l){ return l.key === key; })[0]; S.draft = S.draft.filter(function(l){ return l.key !== key; }); M.save("remove"); return gone; };
M.restoreLine = function(l){ S.draft.push(l); M.save("restore"); };
M.inDraft = function(id){ return S.draft.filter(function(l){ return l.id === id; }); };

/* ---------- sent orders: the first one waits for the waiter, the next ones go straight to the kitchen ---------- */
M.send = function(){ if (!S.draft.length || !M.canOrder()) return null;
  var first = !S.rounds.length || M.waiting(), r = {no:S.rounds.length+1, at:Date.now(), conf: first ? null : Date.now(), lines:S.draft};
  S.rounds.push(r); S.draft = []; M.save("send"); return r; };
M.confirm = function(){ var n = 0; S.rounds.forEach(function(r){ if (!r.conf){ r.conf = Date.now(); n++; } }); if (n) M.save("confirm"); return n > 0; };
M.waiting = function(){ return S.rounds.some(function(r){ return !r.conf; }); };
/* prototype: statuses move by time since the waiter confirmed; "Следващ етап" adds a skew */
M.status = function(r, i){ if (!r.conf) return "wait"; var e = (Date.now() - r.conf)/1000 + (S.skew||0), c = 8 + i*8, s = 40 + i*12; return e < c ? "ok" : e < s ? "cook" : "served"; };
M.STATUS = {wait:["Чака потвърждение","Waiting for the waiter","hourglass"], ok:["Прието","Accepted","check"], cook:["Готви се","Cooking","fire"], served:["Сервирано","Served","check-circle"]};
M.stp = function(s){ var d = M.STATUS[s]; return '<span class="stp '+s+'">'+ic(d[2],16)+L(d[0], d[1])+'</span>'; };
M.sent = function(){ var out = []; S.rounds.forEach(function(r){ r.lines.forEach(function(l, i){ out.push({r:r, l:l, i:i, s:M.status(r, i)}); }); }); return out; };

/* ---------- waiter calls: the same call once every few minutes; tables are never muted ---------- */
M.CALLS = {
  order:{bg:"Поръчка", en:"Order", icon:"note", sub:["Да дойде да вземе поръчката","Come and take our order"]},
  bill:{bg:"Сметка", en:"Bill", icon:"receipt", sub:["В брой или с карта, заедно или поотделно","Cash or card, together or split"]},
  water:{bg:"Вода или прибори", en:"Water or cutlery", icon:"drop", sub:["Чаша вода, приборите, салфетки","A glass of water, cutlery, napkins"]},
  other:{bg:"Друго", en:"Something else", icon:"chat-circle-dots", sub:["Напишете с няколко думи","Tell us in a few words"]}
};
M.callName = function(t){ var c = M.CALLS[t]; return L(c.bg, c.en); };
M.callLeft = function(t){ var c = S.calls[t]; if (!c) return 0; return Math.max(0, Math.ceil((CFG.cooldown*60000 - (Date.now() - c.at))/1000)); };
M.call = function(t, text){ if (M.callLeft(t) || S.offline || S.mode !== "open") return false; S.calls[t] = {at:Date.now(), text:text||"", done:false}; M.save("call"); return true; };
M.cancelCall = function(t){ if (S.calls[t]){ S.calls[t].done = "cancel"; M.save("cancel"); } };
M.serveCall = function(t){ if (S.calls[t]){ S.calls[t].done = "served"; M.save("served"); } };
M.active = function(){ return Object.keys(S.calls).filter(function(k){ return !S.calls[k].done; }).sort(function(a,b){ return S.calls[a].at - S.calls[b].at; }); };

/* ---------- bill & session ---------- */
M.requestBill = function(o){ if (S.offline || S.mode !== "open") return false; S.bill = Object.assign({at:Date.now()}, o); S.calls.bill = {at:Date.now(), text:"", done:false}; M.save("bill"); return true; };
M.close = function(){ S.mode = "closed"; M.save("close"); };

/* ---------- prototype scenarios via the address: page.html#demo=cooking ---------- */
function round1(confAgo){ var now = Date.now(), ls = seedDraft().concat([ln("pitsa-s-burata-i-proshuto-krudo","me",1,60), ln("svezha-salata-s-koze-sirene-i-krushi","me",1,55)]);
  return {no:1, at: now - ((confAgo==null ? 3 : confAgo+25)*1000), conf: confAgo==null ? null : now - confAgo*1000, lines:ls}; }
function demo(name){ var n = fresh(), now = Date.now(); n.lang = S.lang;
  if (name === "empty") n.draft = [];
  if (name === "mine") n.draft.push(ln("pitsa-s-burata-i-proshuto-krudo","me",1,30), ln("tiramisu","me",1,10));
  if (name === "waiting"){ n.draft = []; n.rounds = [round1(null)]; }
  if (name === "cooking" || name === "offline"){ n.draft = [ln("tiramisu","g3",1,20)]; n.rounds = [round1(45)]; }
  if (name === "offline"){ n.offline = true; n.draft.push(ln("sufle","me",1,5)); }
  if (name === "called"){ n.draft = []; n.rounds = [round1(45)]; n.calls.water = {at:now-42000, text:"", done:false}; }
  if (name === "manager"){ n.draft = []; n.rounds = [round1(300)]; n.calls.order = {at:now-(CFG.manager*60+12)*1000, text:"", done:false}; }
  if (name === "served"){ n.draft = []; n.rounds = [round1(900)]; n.calls.water = {at:now-95000, text:"", done:"served"}; }
  if (name === "bill" || name === "billreq" || name === "rated" || name === "closed"){ n.draft = []; n.rounds = [round1(1500)]; }
  if (name === "billreq" || name === "rated" || name === "closed"){ var mine = n.rounds[0].lines.filter(function(l){ return l.who === "me"; }).map(function(l){ return l.key; });
    n.bill = {at:now-25000, pay:"card", split:"dishes", mine:mine}; n.calls.bill = {at:now-25000, text:"", done: name==="closed" ? "served" : false}; }
  if (name === "rated") n.rating = {ans:"no", fb:"", sent:false};
  if (name === "closed") n.mode = "closed";
  if (name === "invalid") n.mode = "invalid";
  if (name === "kitchen"){ SC.prefs.time = "22:45"; }
  replace(n); SC.store(KEY, S); }
function readDemo(){ var m = /demo=([a-z]+)/.exec(location.hash); if (!m) return; demo(m[1]);
  try{ history.replaceState(null, "", location.pathname + location.hash.replace(/&?demo=[a-z]+/,"").replace(/^#$/,"")); }catch(e){} }

/* ---------- chrome ---------- */
var NAV = [["menu","Меню","Menu","fork-knife","menu.html"],["call","Повикай сервитьор","Call a waiter","bell-ringing","call.html"],["cart","Количка","Cart","shopping-bag","cart.html"],["profile","Профил","Profile","user",""]];
function navItem(n, page, desk){ var cur = page === n[0] ? ' aria-current="page"' : '', cls = n[0] === "call" ? ' class="call"' : '';
  var cnt = n[0] === "cart" ? '<span class="cnt" data-mcnt hidden>0</span>' : '';
  var inner = desk ? ic(n[3],20)+L(n[1],n[2])+cnt : '<span class="ib">'+ic(n[3],24)+cnt+'</span>'+L(n[1],n[2]);
  if (n[0] === "profile") return '<button type="button" data-mprofile'+cls+cur+'>'+inner+'</button>';
  return '<a href="'+n[4]+'"'+cls+cur+'>'+inner+'</a>'; }
function headerHTML(page){
  return '<header class="top mtop"><a class="word" href="welcome.html" title="Заместител до новото лого">Siracusa</a>'+
    '<a class="mtab" href="welcome.html" aria-label="'+esc(M.tableLabel())+L(", начало",", start")+'">'+ic("map-pin",18)+'<span>'+esc(M.tableLabel())+'</span></a><span class="sp"></span>'+
    '<nav class="mdnav" aria-label="'+L("Раздели","Sections")+'">'+NAV.map(function(n){ return navItem(n, page, true); }).join("")+'</nav>'+
    '<button class="hb mlang" type="button" data-mlang="'+(S.lang==="en"?"bg":"en")+'" aria-label="'+(S.lang==="en"?"Превключи на български":"Switch to English")+'">'+ic("globe",20)+(S.lang==="en"?"BG":"EN")+'</button></header>'; }
function navHTML(page){ return '<nav class="mnav" aria-label="'+L("Основна навигация","Main navigation")+'">'+NAV.map(function(n){ return navItem(n, page, false); }).join("")+'</nav>'; }
M.updateCount = function(){ var n = M.qty(S.draft), s = M.sum(S.draft);
  document.querySelectorAll("[data-mcnt]").forEach(function(el){ el.textContent = n; el.hidden = n === 0; });
  document.querySelectorAll('.mnav a[href="cart.html"], .mdnav a[href="cart.html"]').forEach(function(a){ a.setAttribute("aria-label", n ? L("Количка на масата, ","Table cart, ")+n+" · "+SC.fmt(s) : L("Количка на масата, празна","Table cart, empty")); }); };

/* ---------- banners shared by the pages ---------- */
M.banners = function(o){ o = o || {}; var h = "", st = SC.state();
  if (S.offline) h += '<div class="mnote bad" role="alert">'+ic("warning-circle",24)+'<div><b>'+L("Няма връзка","No connection")+'</b><p>'+L("Поръчката ви е запазена - опитайте пак. Ако бърза, махнете на сервитьора.","Your order is saved - try again. If it is urgent, wave to the waiter.")+'</p><div class="acts"><button class="pill pill-ink" type="button" data-mretry>'+ic("arrow-clockwise",20)+L("Опитай пак","Try again")+'</button></div></div></div>';
  if (o.kitchen !== false && !st.kitchen && S.mode === "open"){
    var before = st.m < 600;
    h += '<div class="mnote warn" role="status">'+ic("clock",24)+'<div><b>'+(before ? L("Кухнята отваря в 10:00","The kitchen opens at 10:00") : L("Кухнята приема поръчки до 22:30","The kitchen takes orders until 22:30"))+'</b><p>'+L("Менюто е за разглеждане, поръчка от телефона не може. За сметката или нещо друго повикайте сервитьор.","You can browse the menu, but not order from the phone. For the bill or anything else, call a waiter.")+'</p>'+(o.callLink===false?'':'<div class="acts"><a class="pill pill-line" href="call.html">'+ic("bell-ringing",20)+L("Повикай сервитьор","Call a waiter")+'</a></div>')+'</div></div>'; }
  return h; };

/* ---------- blocking states ---------- */
function gateHTML(){ var R = SC.RESTAURANT;
  if (S.mode === "invalid") return '<div class="gate bad" role="alert"><span class="ill">'+ic("qr-code",52)+'</span><p class="eyebrow">'+L("QR кодът","The QR code")+'</p><h1 class="h2">'+L("Този код вече не работи","This code no longer works")+'</h1>'+
    '<p>'+L("Може да е от друга маса или от стара сметка. Попитайте сервитьора: той ще ви отвори масата за секунди.","It may be from another table or an old bill. Ask the waiter: they will open your table in seconds.")+'</p>'+
    '<div class="btns"><a class="pill pill-line pill-lg" href="../pages/menu.html">'+ic("fork-knife",20)+L("Разгледай менюто","Browse the menu")+'</a><a class="pill pill-soft pill-lg" href="tel:+359894365577">'+ic("phone",20)+R.phone+'</a></div></div>';
  return '<div class="gate ok" role="status"><span class="ill">'+ic("check",52)+'</span><p class="eyebrow">'+esc(M.tableLabel())+'</p><h1 class="h2">'+L("Благодарим, че бяхте при нас!","Thank you for coming!")+'</h1>'+
    '<p>'+L("Сметката е платена и масата е затворена. Нова поръчка от този телефон не може. Ако останете още, сканирайте кода на масата отново.","The bill is paid and the table is closed. You cannot order from this phone any more. If you stay longer, scan the table code again.")+'</p>'+
    '<div class="btns">'+(S.rating ? '' : '<a class="pill pill-red pill-lg" href="bill.html#rate">'+ic("smiley",20)+L("Кажете ни как беше","Tell us how it was")+'</a>')+
    '<a class="pill pill-line pill-lg" href="../pages/home.html">'+ic("house",20)+L("Към сайта на Siracusa","Go to the Siracusa website")+'</a></div></div>'; }

/* ---------- prototype panel ---------- */
M.protoHTML = function(extra){
  var t = SC.prefs.time, closedK = !M.kitchen();
  var states = [["normal","Нормално"],["invalid","Невалиден QR код"],["closed","Сесията е затворена"],["offline","Без интернет"],["kitchen","Кухнята затвори (22:45)"]];
  var cur = S.mode !== "open" ? S.mode : S.offline ? "offline" : (closedK && t === "22:45") ? "kitchen" : "normal";
  return '<section class="proto" aria-label="Само в прототипа"><p class="ptag">'+ic("eye",18)+'Само в прототипа</p><p class="ptxt">Симулира другите телефони на масата, сервитьора и кухнята. Два раздела в браузъра са два телефона на една маса.</p>'+
    (extra ? '<p class="sub">Тази страница</p><div class="pbtns">'+extra+'</div>' : '')+
    '<p class="sub">Състояние на масата</p><div class="pbtns">'+states.map(function(s){ return '<button class="pill" type="button" data-mstate="'+s[0]+'" aria-pressed="'+(cur===s[0])+'">'+s[1]+'</button>'; }).join("")+'</div>'+
    '<div class="pset"><label class="label" for="mp-table">Масата (условна, от плана на залата)</label><div class="prow"><select class="input" id="mp-table" data-mtable>'+SC.TABLES.map(function(x){ return '<option value="'+x.id+'"'+(x.id===CFG.table?" selected":"")+'>Маса '+x.n+' · '+(x.zone==="garden"?"Градина":"Салон")+'</option>'; }).join("")+'</select></div></div>'+
    '<div class="pset"><label class="label" for="mp-cd">Едно и също повикване веднъж на (мин)</label><div class="prow"><input class="input" id="mp-cd" type="number" min="1" max="30" inputmode="numeric" value="'+CFG.cooldown+'" data-mcfg="cooldown"><span class="missing">[ЛИПСВА: настройва се от админа]</span></div>'+
      '<label class="label" for="mp-mg">Без отговор, известието отива при управителя след (мин)</label><div class="prow"><input class="input" id="mp-mg" type="number" min="1" max="30" inputmode="numeric" value="'+CFG.manager+'" data-mcfg="manager"><span class="missing">[ЛИПСВА: настройва се от админа]</span></div></div>'+
    '<div class="pbtns"><button class="pill" type="button" data-mreset>'+ic("arrow-counter-clockwise",18)+'Нова сесия на масата</button><a class="pill" href="index.html">'+ic("squares-four",18)+'Всички екрани на QR маса</a></div></section>'; };

/* ---------- profile sheet ---------- */
M.profile = function(){ var mine = M.sent().filter(function(z){ return z.l.who === "me"; }), th = SC.prefs.theme;
  var rows = mine.length ? mine.map(function(z){ var x = SC.byId[z.l.id]; return '<div class="pline">'+SC.pic(x)+'<span><b>'+esc(x.n)+'</b><small>'+z.l.q+L(" бр. · "," pcs · ")+SC.fmt(x.p*z.l.q)+'</small></span>'+M.stp(z.s)+'</div>'; }).join("")
    : '<p>'+L("Още не сте поръчали от този телефон.","You have not ordered from this phone yet.")+'</p>';
  var s = SC.sheet({title:L("Профил","Profile"), html:
    '<div class="psec"><h3>'+L("Език","Language")+'</h3><div class="seg" role="group" aria-label="'+L("Език","Language")+'"><button type="button" data-mlang="bg" aria-pressed="'+(S.lang==="bg")+'">Български</button><button type="button" data-mlang="en" aria-pressed="'+(S.lang==="en")+'">English</button></div></div>'+
    '<div class="psec"><h3>'+L("Моите поръчки на тази маса","My orders at this table")+'</h3>'+rows+'</div>'+
    '<div class="psec"><h3>'+L("Вход по желание","Sign in if you like")+'</h3><p>'+L("Не е нужен, за да поръчате. С телефон и SMS код кодовете за отстъпка и поръчките ви се пазят в профила. С профил вземате -10% от следващата поръчка.","Not needed to order. With your phone and an SMS code, discount codes and orders stay in your profile. With a profile you get 10% off your next order.")+'</p><a class="pill pill-line pill-block" href="../pages/login.html">'+ic("sign-in",20)+L("Влез с телефон","Sign in with phone")+'</a></div>'+
    '<div class="psec"><h3>'+L("Тема","Theme")+'</h3><div class="seg" role="group" aria-label="'+L("Тема","Theme")+'">'+[["system","Авто","Auto"],["light","Светла","Light"],["dark","Тъмна","Dark"]].map(function(o){ return '<button type="button" data-mtheme="'+o[0]+'" aria-pressed="'+(th===o[0])+'">'+L(o[1],o[2])+'</button>'; }).join("")+'</div></div>'+
    '<div class="psec"><p class="small" style="margin:0">'+esc(M.tableLabel())+' · '+L("отворена в ","opened at ")+M.clock(S.opened)+' · '+L("3 телефона на масата","3 phones at the table")+'</p></div>'}); return s; };

/* ---------- dishes in the table context (no links to the public dish page, no delivery, no hours) ---------- */
M.orderable = function(x){ if (SC.isOut(x) || !M.kitchen() || S.mode !== "open") return false; if (x.cat === "zakuski" && !SC.state().breakfast) return false; return true; };
M.plus = function(x){ if (!M.orderable(x)) return "";
  return '<button class="plus" type="button" data-madd="'+x.id+'" aria-label="'+L("Добави ","Add ")+esc(x.n)+L(" в общата количка"," to the table cart")+'">'+ic("plus",22)+'</button>'; };
M.why = function(x){ if (SC.isOut(x)) return ""; if (x.cat === "zakuski" && !SC.state().breakfast && M.kitchen()) return '<span class="later">'+L("до 11:30","until 11:30")+'</span>'; return ""; };
/* who already has it in the shared cart: "2 · Телефон 2" */
M.inCartTag = function(x){ var ls = M.inDraft(x.id); if (!ls.length) return "";
  return '<span class="incart">'+ls.map(function(l){ return '<span class="who">'+M.av(l.who, true)+(l.q > 1 ? l.q+" × " : "")+esc(M.name(l.who))+'</span>'; }).join("")+'</span>'; };
M.card = function(x){ return '<div class="dcard"><button class="open" type="button" data-mdish="'+x.id+'"><span class="pw">'+SC.pic(x)+SC.badges(x,true)+'</span><span class="nm">'+esc(x.n)+'</span></button><div class="rowp"><span><span class="price">'+SC.fmt(x.p)+'</span><small>'+(x.per100?L("за 100 гр.","per 100 g"):esc(x.g))+'</small></span>'+M.plus(x)+M.why(x)+'</div></div>'; };
M.row = function(x){ return '<div class="mrow'+(SC.isOut(x)?" out":"")+'" data-row="'+x.id+'"><button class="open" type="button" data-mdish="'+x.id+'">'+SC.pic(x)+'<span class="tx"><span class="nm">'+esc(x.n)+'</span>'+
  '<span class="meta"><span class="price">'+SC.fmt(x.p)+'</span><span>'+(x.per100?L("за 100 гр.","per 100 g"):esc(x.g))+'</span></span>'+(x.t.length?SC.badges(x):"")+M.inCartTag(x)+'</span></button>'+(M.plus(x)||M.why(x)||'<span></span>')+'</div>'; };
function cap(s){ s = String(s||"").trim().replace(/,(?=\S)/g, ", "); return s.charAt(0).toUpperCase() + s.slice(1); }
M.cap = cap;
M.dishSheet = function(id){ var x = SC.byId[id]; if (!x) return;
  var al = x.al.length ? x.al.map(function(k){ var a = SC.ALLERGENS.filter(function(z){ return z[0]===k; })[0]; return '<span class="badge">'+ic(a?a[2]:"info",16)+SC.allergenName(k)+'</span>'; }).join("") : '<span class="muted">'+(x.comp ? L("Не открихме алергени в състава.","No allergens found in the ingredients.") : L("Няма данни за състава. Попитайте сервитьора.","No ingredient data. Please ask the waiter."))+'</span>';
  var ok = M.orderable(x), reason = SC.isOut(x) ? L("Изчерпано днес","Sold out today") : !M.kitchen() ? L("Кухнята приема поръчки до 22:30","The kitchen takes orders until 22:30") : (x.cat==="zakuski" && !SC.state().breakfast) ? L("Закуските са до 11:30","Breakfast is served until 11:30") : "";
  var s = SC.sheet({title:x.n, html:'<div class="dsh">'+SC.pic(x, "dsh-pic")+'<div class="dsh-m"><span class="price">'+SC.fmt(x.p)+'</span><span class="muted">'+(x.per100?L("за 100 гр.","per 100 g"):esc(x.g))+'</span>'+(x.t.length?SC.badges(x):"")+'</div>'+
    (x.comp ? '<p>'+esc(cap(x.comp))+'</p>' : '<p class="missing">[ЛИПСВА: състав]</p>')+
    '<h3>'+L("Алергени","Allergens")+'</h3><div class="badges">'+al+'</div><p class="note-auto">'+ic("info",18)+'<span>'+L("Предварително, от състава. Чака потвърждение от кухнята.","Preliminary, from the ingredients. Waiting for the kitchen to confirm.")+'</span></p>'+
    M.inCartTag(x)+
    (ok ? '<button class="pill pill-red pill-lg pill-block" type="button" data-madd="'+x.id+'" data-close-after>'+ic("plus",20)+L("Добави в общата количка · ","Add to the table cart · ")+SC.fmt(x.p)+'</button>'
        : '<p class="dsh-no">'+ic("clock",20)+'<b>'+reason+'</b></p>')+'</div>'});
  s.el.classList.add("dshwrap"); return s; };
/* the dish flies to the visible cart in the nav */
M.fly = function(fromEl, id){ if (SC.reduce || !fromEl) return; var dev = SC.device, to = null;
  dev.querySelectorAll('.mnav a[href="cart.html"] .ib, .mdnav a[href="cart.html"]').forEach(function(el){ if (el.getBoundingClientRect().width) to = el; }); if (!to) return;
  var b = dev.getBoundingClientRect(), A = fromEl.getBoundingClientRect(), B = to.getBoundingClientRect(), el = document.createElement("div"); el.className = "fly"; el.innerHTML = SC.art(id);
  var x0 = A.left-b.left+A.width/2-20, y0 = A.top-b.top+A.height/2-20, dx = B.left-b.left+B.width/2-20-x0, dy = B.top-b.top+B.height/2-20-y0; el.style.left = x0+"px"; el.style.top = y0+"px"; dev.appendChild(el);
  el.animate([{transform:"translate(0,0) scale(1) rotate(0)"},{transform:"translate("+dx*.5+"px,"+(dy*.5-40)+"px) scale(.9) rotate(120deg)",offset:.5},{transform:"translate("+dx+"px,"+dy+"px) scale(.35) rotate(240deg)",opacity:.7}],{duration:400,easing:"cubic-bezier(.32,.72,0,1)"}).onfinish = function(){ el.remove(); }; };
/* another phone adds a dish (prototype simulation, once per session and tag) */
M.simOther = function(tag, id, who, ms){ setTimeout(function(){ if (S.sim[tag] || S.mode !== "open" || !M.kitchen()) return; S.sim[tag] = 1; var l = M.add(id, who);
  emit("other:"+l.key); SC.toast(M.name(who)+L(" добави "," added ")+SC.byId[id].n); }, ms); };

/* ---------- mount ---------- */
var ticks = [];
M.tick = function(f){ ticks.push(f); };
M.mount = function(o){ readDemo();
  var main = SC.mount({page:"masa-"+o.page, nav:null, title:o.title, docTitle:o.docTitle, footer:false, ai:false, bottomNav:false, status:false, cart:false, actionBar:!!o.actionBar});
  document.documentElement.lang = S.lang;
  var top = SC.scroller.querySelector(".top"); if (top) top.outerHTML = headerHTML(o.page);
  var gated = S.mode === "invalid" || (S.mode === "closed" && !o.allowClosed);
  if (!gated) SC.ov.insertAdjacentHTML("afterbegin", navHTML(o.page));
  else SC.scroller.querySelectorAll(".mdnav"+(S.mode==="invalid"?", .mtab":"")).forEach(function(n){ n.remove(); });
  M.updateCount(); M.on(M.updateCount);
  setInterval(function(){
    if (M.waiting() && Date.now() - S.rounds.filter(function(r){ return !r.conf; })[0].at > 14000){ M.confirm(); SC.toast(L("Сервитьорът потвърди поръчката","The waiter confirmed your order")); }
    ticks.forEach(function(f){ f(); }); }, 1000);
  if (gated){ main.innerHTML = '<div class="mpage">'+gateHTML()+M.protoHTML("")+'</div><div class="mend"></div>'; return null; }
  return main; };

/* ---------- delegation ---------- */
document.addEventListener("click", function(e){ var t = e.target.closest("button, a"); if (!t) return;
  if (t.hasAttribute("data-mprofile")){ M.profile(); return; }
  if (t.dataset.mdish){ M.dishSheet(t.dataset.mdish); return; }
  if (t.dataset.madd){ e.preventDefault(); var id = t.dataset.madd; M.add(id, "me"); M.fly(t, id); SC.haptic(); SC.toast(L("Добавено в общата количка ✓","Added to the table cart ✓"));
    if (t.hasAttribute("data-close-after")){ var w = t.closest(".sheetwrap"); var c = w && w.querySelector("[data-close]"); c && c.click(); } else SC.flash(t, ic("check",22)); return; }
  if (t.dataset.mlang){ S.lang = t.dataset.mlang; M.save("lang"); location.reload(); return; }
  if (t.dataset.mtheme){ SC.prefs.theme = t.dataset.mtheme; SC.store("sc-prefs", SC.prefs); location.reload(); return; }
  if (t.hasAttribute("data-mretry")){ t.setAttribute("aria-busy","true"); setTimeout(function(){ S.offline = false; M.save("online"); SC.toast(L("Връзката се върна","You are back online")); }, 700); return; }
  if (t.hasAttribute("data-mreset")){ M.reset(); location.reload(); return; }
  if (t.dataset.mstate){ var v = t.dataset.mstate;
    if (SC.prefs.time === "22:45" && v !== "kitchen") SC.prefs.time = "now";
    S.mode = v === "invalid" || v === "closed" ? v : "open"; S.offline = v === "offline";
    if (v === "kitchen") SC.prefs.time = "22:45";
    SC.store("sc-prefs", SC.prefs); M.save("state"); location.reload(); return; }
});
document.addEventListener("change", function(e){ var t = e.target;
  if (t.matches("[data-mtable]")){ CFG.table = t.value; M.saveCfg(); location.reload(); }
  if (t.matches("[data-mcfg]")){ var v = Math.max(1, Math.min(30, parseInt(t.value,10) || 1)); CFG[t.dataset.mcfg] = v; t.value = v; M.saveCfg(); SC.toast("Запазено: "+v+" мин"); }
});
window.addEventListener("hashchange", function(){ if (/demo=[a-z]+/.test(location.hash)) location.reload(); });
window.addEventListener("offline", function(){ S.offline = true; M.save("offline"); });
window.addEventListener("online", function(){ if (S.offline){ S.offline = false; M.save("online"); } });
})();
