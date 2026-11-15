/* Siracusa · търсачката на сервитьора (решение 15.11 „Умна търсачка = асистентът“, „Търсенето на ястия е едно“).
   Едно поле със свободен текст. Сервитьорът търси само в своето: маси, поръчки, изчерпано, резервации и ястията.
   В кода списъкът идва от сървъра по ролята (GET /api/staff/search?q=… проверява правата); тук е от макетните данни.
   Ястията: window.SCSearch (../ds/search.js, същият код като src/lib/search.ts): по име горе, „Съдържат …“ по състав,
   „без …“ (ястие без състав никога не минава) и най-долу „Нямаме пълен състав, попитайте ни“.
   Зарежда се при първото отваряне (ST.openFind в _staff.js). */
(function(){
"use strict";
var ic = SC.ic, esc = SC.esc, fmt = SC.fmt;
var S = window.SCSearch;
function lat(s){ return S.latin(String(s || "")).replace(/[^a-z0-9: ]+/g, " ").replace(/\s+/g, " ").trim(); }

/* the dishes with the words of their category (and a few English names) for the search by name */
var CAT = {}; SC.cats.forEach(function(c){ CAT[c.id] = c.n; });
function kwOf(x){ var k = CAT[x.cat] || "";
  if (/бургер/i.test(x.n)) k += " burger cheeseburger"; if (/стек/i.test(x.n)) k += " steak"; if (/Ангъс/i.test(x.n)) k += " black angus"; if (/Рибай/i.test(x.n)) k += " ribeye"; return k; }
var DL = SC.items.map(function(x){ return {id:x.id, n:x.n, comp:x.comp, al:x.al, t:x.t, kw:kwOf(x), x:x}; });

/* status words of a table (icon + word, as on the tiles) */
var SW = {call:["вика","повикване","повиквания"], bill:["сметка","сметки"], qr:["qr","кюар"], ready:["готово","готови"], wait:["чака","чакат"], busy:["заета","заети"], free:["свободна","свободни","свободно"]};
var STOP = ["маса","маси","masa","masi","table","tables","на","за","с","и"];
function stem(w){ return w.length > 5 ? w.slice(0, w.length - 1) : w; }
function wordHit(q, list){ return list.some(function(w){ var l = lat(w); return q.length >= 3 && (l.indexOf(q) === 0 || q.indexOf(stem(l)) === 0); }); }

function search(raw){ var q = lat(raw), words = q.split(" ").filter(function(w){ return w && STOP.indexOf(w) < 0; }), r = {tables:[], orders:[], res:[], out:[], dish:null};
  if (!q) return r;
  var nums = (raw.match(/\d+/g) || []), time = raw.match(/\b(\d{1,2}):(\d{2})\b/), txt = words.filter(function(w){ return !/^\d/.test(w); });
  var kOut = txt.some(function(w){ return wordHit(w, ["изчерпано","изчерпани","изчерпан"]) || w === "out"; });
  var kRes = txt.some(function(w){ return wordHit(w, ["резервация","резервации","резерв"]) || w === "rezervacia"; });
  var kMine = txt.some(function(w){ return wordHit(w, ["моите","мои","моя"]); });
  var zone = txt.filter(function(w){ return wordHit(w, ["салон"]) ? "salon" : null; }).length ? "salon" : txt.filter(function(w){ return wordHit(w, ["градина"]); }).length ? "garden" : null;
  var st = Object.keys(SW).filter(function(k){ return txt.some(function(w){ return wordHit(w, SW[k]); }); });
  /* tables */
  var tn = nums.filter(function(n){ return n.length <= 2 && !time; });
  SC.TABLES.forEach(function(t){ var s = ST.tStatus(t.n), ok = false;
    if (tn.length) ok = tn.some(function(n){ return String(t.n) === n || (n.length === 1 && String(t.n).indexOf(n) === 0); });
    else if (st.length || zone || kMine) ok = true; else return;
    if (st.length && st.indexOf(s.k) < 0) ok = false; if (zone && t.zone !== zone) ok = false; if (kMine && !ST.isMine(t.n)) ok = false;
    if (ok) r.tables.push(t.n); });
  r.tables.sort(function(a,b){ return (ST.isMine(b)-ST.isMine(a)) || a-b; });
  /* dishes (not for numbers and times only) */
  var dishQ = txt.filter(function(w){ return !wordHit(w, ["изчерпано","изчерпани","резервация","резервации","моите","салон","градина"]) && !Object.keys(SW).some(function(k){ return wordHit(w, SW[k]); }); });
  var dq = raw.replace(/\d+(:\d+)?/g, " ").trim();
  if (dishQ.length && dq){ var sd = S.searchDishes(DL, dq), back = function(l){ return l.map(function(d){ return SC.byId[d.id]; }); };
    r.dish = {query:sd.query, band:sd.band, name:back(sd.name), comp:back(sd.comp), rest:back(sd.rest), unknown:back(sd.unknown)}; }
  /* orders: by number, or the dishes found by name */
  var ids = r.dish ? r.dish.name.map(function(d){ return d.id; }) : [];
  ST.db.orders.forEach(function(o){ var hit = nums.some(function(n){ return n.length >= 3 && o.id.indexOf(n) > -1; }) || (ids.length && o.lines.some(function(l){ return ids.indexOf(l.id) > -1; }));
    if (hit) r.orders.push(o); });
  r.orders.sort(function(a,b){ return (ST.isMine(b.t)-ST.isMine(a.t)) || b.at - a.at; });
  /* reservations */
  ST.resAll().forEach(function(x){ var hit = kRes;
    if (!hit && time) hit = ST.hm(x.at) === (time[1].length < 2 ? "0" : "") + time[1] + ":" + time[2];
    if (!hit && !time) hit = nums.some(function(n){ return n.length >= 3 ? x.phone.replace(/\s/g, "").indexOf(n) > -1 : String(x.t) === n || ST.hm(x.at).indexOf(n + ":") === 0; });
    if (!hit && txt.length) hit = txt.every(function(w){ return lat(x.name + " " + x.note).split(" ").some(function(p){ return p.indexOf(w) === 0; }); });
    if (hit) r.res.push(x); });
  /* out of stock today */
  if (kOut) r.out = SC.items.filter(SC.isOut);
  return r; }

/* ---------- rows ---------- */
var SHORT = {call:"Вика", bill:"Сметка", qr:"QR поръчка", ready:"Готово", wait:"Чака поръчка", busy:"Заета", free:"Свободна"};
function tRow(n){ var t = ST.tableByN[n], s = ST.tStatus(n), mine = ST.isMine(n);
  return '<a class="frow" href="table.html#'+n+'"><span class="fi '+s.k+'">'+n+'</span><span><b>Маса '+n+' · '+ST.ZONE[t.zone]+'</b><small>'+(mine?'Моя маса':'на '+ST.OTHER)+(s.since && s.wait?' · чака '+ST.mmss(ST.secs(s.since)):'')+'</small></span><span class="fr">'+ST.stt(s.k, s.k==="call"?s.short:SHORT[s.k], s.i)+'</span></a>'; }
function oRow(o){ var lines = o.lines.map(function(l){ return l.q+'× '+esc(ST.lineName(l)); }).join(", "), ready = o.lines.filter(function(l){ return l.st==="ready"; }).length, cook = o.lines.filter(function(l){ return l.st==="cook" || l.st==="acc"; }).length;
  var stx = o.pending ? ST.stt("qr","Чака потвърждение","qr-code") : ready ? ST.stt("ready","Готово","chef-hat") : cook ? ST.stt("cook","Готви се","cooking-pot") : ST.stt("served","Сервирано","check-circle");
  return '<a class="frow" href="table.html#'+o.t+'"><span class="fi">'+ic("receipt",22)+'</span><span><b>№ '+o.id+' · Маса '+o.t+(o.bill?' · '+esc(o.bill):'')+'</b><small>'+lines+' · '+ST.clock(o.at)+'</small></span><span class="fr">'+stx+'</span></a>'; }
function rRow(x){ return '<a class="frow" href="tables.html#res"><span class="fi">'+ic("calendar-check",22)+'</span><span><b>'+ST.hm(x.at)+' · Маса '+x.t+' · '+SC.plural(x.n,"човек","души")+'</b><small>'+esc(x.name)+' · '+esc(x.phone)+' · '+ST.dayText(x.day)+(x.note?' · '+esc(x.note):'')+'</small></span><span class="fr">'+ic("caret-right",20)+'</span></a>'; }
function dRow(x){ var out = SC.isOut(x);
  return '<a class="frow" href="order.html#q='+encodeURIComponent(x.n)+'">'+SC.pic(x)+'<span><b>'+esc(x.n)+'</b><small>'+[esc(CAT[x.cat]||""), x.per100?'за 100 гр.':esc(x.g||"")].filter(Boolean).join(" · ")+'</small></span><span class="fr">'+(out?'<span class="out-b">'+ic("clock",16)+'Изчерпано днес</span>':'<span class="price">'+fmt(x.p)+'</span>')+'</span></a>'; }
function grp(title, list, row, key, max){ if (!list.length) return ""; max = max || 5; var open = more[key];
  return '<section class="fgrp"><h3>'+title+'<span class="muted">'+list.length+'</span></h3>'+list.slice(0, open ? 99 : max).map(row).join("")+(list.length > max && !open ? '<button class="link fmore" type="button" data-more="'+key+'">Още '+(list.length - max)+ic("caret-down",18)+'</button>' : '')+'</section>'; }
var more = {};

function results(raw){ var r = search(raw), d = r.dish, h = "";
  var chips = S.chips(raw);
  if (chips.length) h += '<div class="fchips" role="group" aria-label="Съставки и алергени">'+chips.map(function(c){ return '<button class="chip'+(c.without?' without':'')+'" type="button" data-tog="'+esc(c.word)+'" aria-pressed="'+c.without+'">'+(c.without ? ic("minus",18)+'без '+esc(c.label) : esc(c.label)+' '+ic("x",16))+'</button>'; }).join("")+'</div>';
  h += grp("Маси", r.tables, tRow, "t");
  h += grp("Поръчки", r.orders, oRow, "o", 4);
  h += grp("Резервации", r.res, rRow, "r", 4);
  h += grp("Изчерпано днес", r.out, dRow, "x", 8);
  if (d){
    h += grp(d.query.exc.length && !d.query.inc.length ? "Ястия без "+d.query.exc.map(function(w){ return w.label; }).join(" и ") : "Ястия", d.query.inc.length ? d.name : d.rest, dRow, "d", d.query.inc.length ? 6 : 8);
    if (d.comp.length) h += '<div class="fband">'+ic("bowl-food",20)+'<span>'+esc(d.band)+'</span></div>'+d.comp.slice(0, more.c ? 99 : 6).map(dRow).join("")+(d.comp.length > 6 && !more.c ? '<button class="link fmore" type="button" data-more="c">Още '+(d.comp.length-6)+ic("caret-down",18)+'</button>' : '');
    if (d.unknown.length) h += '<div class="fband unk">'+ic("warning",20)+'<span>Нямаме пълен състав, попитайте ни<small>Питай кухнята, преди да кажеш на госта.</small></span></div>'+d.unknown.slice(0, more.u ? 99 : 4).map(dRow).join("")+(d.unknown.length > 4 && !more.u ? '<button class="link fmore" type="button" data-more="u">Още '+(d.unknown.length-4)+ic("caret-down",18)+'</button>' : '');
  }
  var any = r.tables.length || r.orders.length || r.res.length || r.out.length || (d && (d.name.length || d.comp.length || d.rest.length || d.unknown.length));
  if (!any) h += '<div class="fempty"><div class="ill">'+ic("magnifying-glass",40)+'</div><h3>Няма „'+esc(raw)+'“</h3><p>Опитай с номер на маса или поръчка, час на резервация, име на ястие (и на латиница) или „без лук“.</p></div>';
  return h; }
function start(){ var ex = [["моите маси","Моите маси"],["свободни","Свободни маси"],["сметка","Чакат сметка"],["изчерпано","Изчерпано днес"],["резервации","Резервации"],["без глутен","Без глутен"]];
  return '<p class="fscope">Търсиш само в своето: маси, поръчки, изчерпано, резервации и ястията. На кирилица или латиница.</p><div class="fchips">'+ex.map(function(e){ return '<button class="chip" type="button" data-ex="'+e[0]+'">'+e[1]+'</button>'; }).join("")+'</div>'; }

/* ---------- the overlay ---------- */
ST.find = function(q0){
  var w = document.createElement("div"); w.className = "st-find"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Търси");
  w.innerHTML = '<div class="fwin"><div class="fhead"><form class="search" role="search" onsubmit="return false"><label class="vh" for="fq">Търси маса, поръчка, резервация или ястие</label>'+ic("magnifying-glass",22)+
    '<input class="input" id="fq" type="search" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="Маса, №, резервация, ястие…"><button class="clr" type="button" data-clr aria-label="Изчисти търсенето" hidden>'+ic("x",22)+'</button></form>'+
    '<button class="fx" type="button" data-fclose>'+ic("x",22)+'<span>Затвори</span></button></div><div class="fbody" aria-live="polite"></div></div>';
  document.body.appendChild(w);
  var inp = w.querySelector("#fq"), body = w.querySelector(".fbody"), clr = w.querySelector("[data-clr]"), prev = document.activeElement;
  var bg = [ST.app, document.querySelector(".st-nav"), document.querySelector(".st-bar")].filter(Boolean); bg.forEach(function(el){ el.inert = true; });
  function draw(){ var v = inp.value.trim(); clr.hidden = !v; body.innerHTML = v ? results(v) : start(); }
  function close(){ bg.forEach(function(el){ el.inert = false; }); w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 260); document.removeEventListener("keydown", key, true); prev && prev.focus && prev.focus({preventScroll:true}); }
  function key(e){ if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Tab"){ var f = Array.prototype.filter.call(w.querySelectorAll("button:not([hidden]), a[href], input"), function(el){ return el.offsetParent !== null; }); if (!f.length) return;
      var a = f[0], z = f[f.length-1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } } }
  document.addEventListener("keydown", key, true);
  inp.addEventListener("input", function(){ more = {}; draw(); });
  inp.addEventListener("keydown", function(e){ if (e.key === "Enter"){ var a = body.querySelector("a.frow"); if (a){ e.preventDefault(); location.href = a.getAttribute("href"); } } });
  w.addEventListener("click", function(e){ if (e.target === w){ close(); return; } var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-fclose")){ close(); return; }
    if (b.hasAttribute("data-clr")){ inp.value = ""; more = {}; draw(); inp.focus(); return; }
    if (b.dataset.ex){ inp.value = b.dataset.ex; more = {}; draw(); inp.focus(); return; }
    if (b.dataset.tog){ inp.value = S.toggle(inp.value, b.dataset.tog); draw(); return; }
    if (b.dataset.more){ more[b.dataset.more] = 1; draw(); } });
  if (q0) inp.value = q0; draw();
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); inp.focus({preventScroll:true}); }); });
};
ST.search2 = search; /* for the tests in the prototype */
})();
