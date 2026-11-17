/* Siracusa · Управител: търсачката (решения 15.11 „Умна търсачка = асистентът“ и „Търсенето на ястия е едно“).
   Зарежда се при първото отваряне (MG.loadFind), след ../ds/search.js (window.SCSearch, същото ядро като src/lib/search.ts).
   Едно поле, на кирилица и латиница. Управителят търси само в това, което ролята вижда (A.can): маси, поръчки, резервации,
   персонала на смяната, изчерпаното, ястията (по име горе, „Съдържат …“ по състав, „без …“ с чип, без състав най-долу) и разделите на админа.
   В кода списъкът идва от сървъра по ролята. Телефон: цял екран. Компютър: панел под полето в горната лента. */
(function(){
"use strict";
var A = window.A, SH = A.sh, S = window.SCSearch, ic = SC.ic, esc = SC.esc, fmt = SC.fmt;
var MGF = window.MGF = {};
function lat(s){ return S.latin(String(s || "")).replace(/[^a-z0-9: ]+/g, " ").replace(/\s+/g, " ").trim(); }
function digits(s){ return String(s || "").replace(/\D/g, ""); }
var ADM = "../pages-admin/";
var STOP = ["маса","маси","masa","masi","table","на","за","с","и","в","от","до","no","номер","nomer"];
var TABLEW = ["маса","маси","masa","masi","table"];
/* съвпадение на дума: поне 3 букви от двете страни (кратки служебни думи като „и“, „с“ не съвпадат с всичко); 2-буквени думи само цели („qr“) */
function hit(w, list){ return list.some(function(x){ var l = lat(x); if (!l) return false;
  if (w.length < 3 || l.length < 3) return w === l;
  return l.indexOf(w) === 0 || w.indexOf(l.slice(0, Math.max(3, l.length - 1))) === 0; }); }
var TWORDS = {free:["свободна","свободни","свободно"], busy:["заета","заети"], call:["вика","повикване","повиквания"], bill:["сметка","сметки"], qr:["qr","кюар"], wait:["чака","чакат"], ready:["готово","готови"], res:["резервирана","резервирани"]};
var PEOPLE = ["сервитьор","сервитьори","шофьор","шофьори","servitor","sofyor","shofyor","waiter","driver"];

function search(raw){ var q = lat(raw), all = q.split(" ").filter(Boolean), words = all.filter(function(w){ return STOP.indexOf(w) < 0; }), txt = words.filter(function(w){ return !/^\d/.test(w); });
  var nums = raw.match(/\d+/g) || [], time = raw.match(/\b(\d{1,2}):(\d{2})\b/), dq = digits(raw), r = {tables:[], orders:[], res:[], staff:[], out:[], secs:[], dish:null, first:""};
  if (!q) return r;
  var tableWord = all.some(function(w){ return TABLEW.indexOf(w) > -1; });
  /* човек от смяната: „Сервитьор 2“, „шофьор 1“ (числото е част от името, не маса) */
  var person = txt.some(function(w){ return hit(w, PEOPLE); }) && !tableWord;
  var sh = MG.shift();
  if (person){ (sh.waiters || []).concat(sh.drivers || []).forEach(function(p){ var kind = p.id.charAt(0) === "w" ? "waiter" : "driver", base = kind === "waiter" ? ["сервитьор","сервитьори","servitor","waiter"] : ["шофьор","шофьори","sofyor","shofyor","driver"];
      if (!txt.some(function(w){ return hit(w, base); })) return; var n = p.name.replace(/\D/g, "");
      if (nums.length && nums.indexOf(n) < 0) return; r.staff.push({p:p, kind:kind}); });
    if (r.staff.length) r.first = "s"; }
  var zone = txt.some(function(w){ return hit(w, ["салон"]); }) ? "salon" : txt.some(function(w){ return hit(w, ["градина"]); }) ? "garden" : null;
  var sts = Object.keys(TWORDS).filter(function(k){ return txt.some(function(w){ return hit(w, TWORDS[k]); }); });
  var kOut = txt.some(function(w){ return hit(w, ["изчерпано","изчерпани","изчерпан","izcherpano"]) || w === "out"; });
  var kRes = txt.some(function(w){ return hit(w, ["резервация","резервации","резерв"]); });
  if (kOut){ r.out = A.soldOutToday().map(function(id){ return SC.byId[id]; }).filter(Boolean); r.first = r.first || "x"; }
  /* маси: номер (1-2 цифри), статус с дума, зона; не когато числото е на човек */
  var tn = time || person ? [] : nums.filter(function(n){ return n.length <= 2; });
  if (!kOut && (A.can("hall") || A.can("reservations"))){ MG.tableStates().forEach(function(x){ var ok = false;
      if (tn.length) ok = tn.some(function(n){ return String(x.n) === n; }); else if (sts.length || zone) ok = true; else return;
      if (sts.length && sts.indexOf(x.st) < 0 && !(sts.indexOf("busy") > -1 && x.seated)) ok = false; if (zone && x.zone !== zone) ok = false; if (ok) r.tables.push(x); });
    if (r.tables.length && tn.length) r.first = r.first || "t"; }
  /* поръчки: № (поне 3 цифри от началото) или поне 3 цифри от телефона; име „Клиент 7“ */
  if (A.can("orders") && !person && !kOut){ A.orders().forEach(function(o){ var h = false;
      if (dq.length >= 3 && !time) h = o.no.indexOf(dq) === 0 || digits(o.phone).indexOf(dq) > -1;
      if (!h && txt.length && !sts.length) h = (" " + lat(o.name) + " ").indexOf(" " + q + " ") > -1;
      if (h) r.orders.push(o); });
    r.orders.sort(function(a, b){ return (b.no === dq) - (a.no === dq) || b.ts - a.ts; });
    if (r.orders.length && r.orders[0].no === dq) r.first = "o"; }
  /* резервации днес и напред: час, маса (с „маса 12“ само масата, не часа 12:…), име, телефон */
  if (A.can("reservations") && !person && !kOut){ var today = A.todayKey(); A.reservations().forEach(function(x){ if (x.date < today || x.status === "cancelled") return; var h = kRes && x.date === today;
      if (!h && time) h = x.time === (time[1].length < 2 ? "0" : "") + time[1] + ":" + time[2];
      if (!h && !time && tn.length && x.date === today){ var t = MG.tableByN(tn[0]); h = (t && x.table === t.id) || (!tableWord && x.time.indexOf(tn[0].padStart(2, "0") + ":") === 0); }
      if (!h && dq.length >= 3 && !time) h = digits(x.phone).indexOf(dq) > -1;
      if (!h && txt.length && !sts.length && !kRes) h = q.length >= 3 && (" " + lat(x.name + " " + (x.occasion || "")) + " ").indexOf(" " + q) > -1;
      if (h) r.res.push(x); });
    r.res.sort(function(a, b){ return (a.date + a.time < b.date + b.time) ? -1 : 1; }); }
  /* секциите на кухнята (по думите от името, без съюзите) */
  if (!person && !kOut) SH.SECTIONS.forEach(function(s){ var ws = s.n.split(" ").filter(function(w){ return w.length >= 3; }).concat(["кухня","кухнята"]); if (txt.length && txt.some(function(w){ return hit(w, ws); })) r.staff.push({p:{name:s.n, id:s.id}, kind:"kitchen", sec:s}); });
  /* разделите на админа: само по името (не по описанието), само разрешените; без „оборот“ (решение 15.11, т. 5) */
  if (txt.length && !sts.length && !person && !kOut) r.secs = A.visibleSections().filter(function(s){ if (s.soon) return false; var ws = (s.n + " " + s.short).split(" ").filter(function(w){ return w.length >= 3; });
    return txt.every(function(w){ return hit(w, ws); }); });
  /* ястията: общото ядро; не за чисти числа, часове, хора и служебни думи */
  var dishQ = raw.replace(/\d+(:\d+)?/g, " ").trim();
  if (dishQ && !sts.length && !kOut && !kRes && !person && !tableWord && (A.can("menu") || A.can("lunch"))){ var sd = S.searchDishes(SC.items.map(SC.searchable), dishQ), back = function(l){ return l.map(function(d){ return d.src; }); };
    r.dish = {query:sd.query, band:sd.band, name:back(sd.name), comp:back(sd.comp), rest:back(sd.rest), unknown:back(sd.unknown)}; }
  return r; }

/* ---------- редове ---------- */
var more = {}, seq = 0;
function opt(href, inner, extra){ return '<a class="mg-frow" id="mgf-' + (seq++) + '" href="' + esc(href) + '"' + (extra || '') + '>' + inner + '</a>'; }
function tRow(x){ var st = MG.TST[x.st], w = x.waiter ? x.waiter.name : "без сервитьор";
  return opt("hall.html#t=" + x.n, '<span class="fi ' + x.st + '">' + x.n + '</span><span><b>Маса ' + x.n + ' · ' + MG.ZONE[x.zone] + '</b><small>' + esc(w) + (x.seated ? ' · от ' + MG.hm(x.seated.since) : '') + (x.next ? ' · резервация ' + esc(x.next.time) : '') + '</small></span><span class="fr">' + MG.tag(x.st === "call" || x.st === "bill" ? "red" : x.st === "ready" ? "ember" : x.st === "free" ? "ok" : "", st[1], st[0]) + '</span>'); }
function oRow(o){ var c = SH.CH[o.channel] || SH.CH.delivery, href = o.status === "accepted" ? "now.html#n=" + o.no : ADM + "orders.html#n=" + o.no;
  return opt(href, '<span class="fi">' + ic(c[1], 22) + '</span><span><b>№ ' + esc(o.no) + ' · ' + esc(c[0]) + (o.channel === "table" ? " " + esc(o.table) : "") + '</b><small>' + esc(SH.LABEL[o.status]) + ' · ' + esc(o.placedAt) + (o.name && o.channel !== "table" ? ' · ' + esc(o.name) : '') + (o.phone ? ' · ' + esc(A.maskPhone(o.phone)) : '') + '</small></span><span class="fr price">' + fmt(SH.total(o)) + '</span>'); }
var RST = {"new":"Нова", confirmed:"Потвърдена", seated:"Дошли", no_show:"Неявили се", waitlist:"Чака маса"};
function rRow(x){ var t = A.tables().filter(function(z){ return z.id === x.table; })[0], today = x.date === A.todayKey();
  return opt(today ? "hall.html#go=res" : ADM + "reservations.html#d=" + x.date, '<span class="fi">' + ic("calendar-check", 22) + '</span><span><b>' + esc(x.time) + ' · ' + esc(x.name) + ' · ' + A.plural(+x.people || 0, "човек", "души") + '</b><small>' + (today ? "Днес" : esc(A.fmtDate(new Date(x.date + "T12:00:00"), true))) + (t ? ' · Маса ' + t.n : ' · без маса') + (x.occasion ? ' · ' + esc(x.occasion) : '') + '</small></span><span class="fr">' + MG.tag(x.status === "new" ? "warn" : "", x.status === "new" ? "hourglass" : "check", RST[x.status] || x.status) + '</span>'); }
function sRow(s){ var ic0 = s.kind === "waiter" ? "user" : s.kind === "driver" ? "moped" : s.sec.ic, sub = s.kind === "waiter" ? A.plural(s.p.tables.length, "маса", "маси") + " · на смяна от " + MG.hm(s.p.since) : s.kind === "driver" ? "Шофьор на смяна от " + MG.hm(s.p.since) : "Секция в кухнята";
  return opt("team.html#go=" + (s.kind === "kitchen" ? "kitchen" : s.p.id), '<span class="fi">' + ic(ic0, 22) + '</span><span><b>' + esc(s.p.name) + '</b><small>' + esc(sub) + '</small></span><span class="fr">' + ic("caret-right", 20) + '</span>'); }
function dRow(x){ var out = A.soldOutToday().indexOf(x.id) > -1, c = SC.catById[x.cat];
  return opt(ADM + "menu.html#d=" + x.id, SC.pic(x) + '<span><b>' + esc(x.n) + '</b><small>' + [c ? esc(c.n) : "", x.per100 ? "за 100 гр." : esc(x.g || "")].filter(Boolean).join(" · ") + '</small></span><span class="fr">' + (out ? '<span class="out">' + ic("clock", 16) + 'Изчерпано днес</span>' : '<span class="price">' + fmt(x.p) + '</span>') + '</span>'); }
function secRow(s){ return opt(ADM + s.href, '<span class="fi">' + ic(s.ic, 22) + '</span><span><b>' + esc(s.n) + '</b><small>В админа · ' + esc(A.groupOf(s.id)) + '</small></span><span class="fr">' + ic("arrow-up-right", 20) + '</span>'); }
function grp(title, list, row, key, max){ if (!list.length) return ""; max = max || 5; var open = more[key];
  return '<section class="mg-fgrp" aria-label="' + esc(title) + '"><h2>' + esc(title) + '<span class="muted">' + list.length + '</span></h2>' + list.slice(0, open ? 60 : max).map(row).join("") +
    (list.length > max && !open ? '<button class="mg-link mg-fmore" type="button" id="mgf-m-' + key + '" data-fmore="' + key + '">' + ic("caret-down", 18) + 'Покажи още ' + (list.length - max) + '</button>' : '') + '</section>'; }

function results(raw){ seq = 0; var r = search(raw), d = r.dish, h = "", chips = S.chips(raw);
  if (chips.length) h += '<div class="mg-fchips" role="group" aria-label="Как разбрахме търсенето">' + chips.map(function(c){ return '<button class="chip' + (c.without ? ' without' : '') + '" type="button" data-tog="' + esc(c.word) + '" aria-pressed="' + c.without + '" aria-label="' + (c.without ? "без " + esc(c.label) + ", покажи и с " + esc(c.label) : esc(c.label) + ", покажи без " + esc(c.label)) + '">' + (c.without ? ic("minus", 18) + 'без ' + esc(c.label) : esc(c.label) + ' ' + ic("x", 16)) + '</button>'; }).join("") + '</div>';
  var parts = {t:grp("Маси", r.tables, tRow, "t", 6), o:grp("Поръчки", r.orders, oRow, "o", 5), r:grp("Резервации", r.res, rRow, "r", 4), s:grp(r.first === "s" ? "Хората на смяната" : "Персоналът на смяната", r.staff, sRow, "s", 6), x:grp("Изчерпано днес", r.out, dRow, "x", 8)};
  var order = ["t","o","r","s","x"]; if (r.first){ order.splice(order.indexOf(r.first), 1); order.unshift(r.first); }
  h += order.map(function(k){ return parts[k]; }).join("");
  if (d){ var exc = d.query.exc.map(function(w){ return w.label; });
    h += grp(d.query.inc.length || !exc.length ? "Ястия" : "Ястия без " + exc.join(" и "), d.query.inc.length || !exc.length ? d.name : d.rest, dRow, "d", 6);
    if (d.comp.length) h += '<div class="mg-fband">' + ic("bowl-food", 20) + '<span>' + esc(d.band) + '</span></div>' + d.comp.slice(0, more.c ? 60 : 6).map(dRow).join("") + (d.comp.length > 6 && !more.c ? '<button class="mg-link mg-fmore" type="button" id="mgf-m-c" data-fmore="c">' + ic("caret-down", 18) + 'Покажи още ' + (d.comp.length - 6) + '</button>' : '');
    if (d.unknown.length) h += '<div class="mg-fband unk">' + ic("warning", 20) + '<span>Нямаме пълен състав, попитайте ни<small>Провери с кухнята, преди да кажеш на госта.</small></span></div>' + d.unknown.slice(0, more.u ? 60 : 4).map(dRow).join("") + (d.unknown.length > 4 && !more.u ? '<button class="mg-link mg-fmore" type="button" id="mgf-m-u" data-fmore="u">' + ic("caret-down", 18) + 'Покажи още ' + (d.unknown.length - 4) + '</button>' : ''); }
  h += grp("Раздели на админа", r.secs, secRow, "a", 3);
  var any = r.tables.length || r.orders.length || r.res.length || r.staff.length || r.out.length || r.secs.length || (d && (d.name.length || d.comp.length || d.rest.length || d.unknown.length));
  if (!any) h += '<div class="mg-fempty"><div class="ill">' + ic("magnifying-glass", 40) + '</div><h2>Нищо за „' + esc(raw) + '“</h2><p>Опитай с номер на маса или поръчка, час на резервация, „Сервитьор 1“, ястие (и на латиница) или „без лук“.</p></div>';
  return h; }
function start(){ var ex = [["12","Маса 12"],["свободни","Свободни маси"],["вика","Масите, които викат"],["изчерпано","Изчерпано днес"],["Шофьор 1","Шофьор 1"],["без лук","Без лук"]];
  return '<p class="mg-fscope">Търсиш само в своето: маси, поръчки, резервации, хората на смяната, изчерпаното, ястията и разделите на админа. На кирилица или латиница.</p><div class="mg-fchips">' + ex.map(function(e){ return '<button class="chip" type="button" data-ex="' + esc(e[0]) + '">' + esc(e[1]) + '</button>'; }).join("") + '</div>'; }

/* общото поведение на полето и резултатите (и за двата изгледа). Резултатите са обикновени връзки в групи със заглавия (без combobox / listbox):
   стрелка надолу от полето отива на първия резултат, стрелките местят фокуса между тях, стрелка нагоре от първия и Esc връщат в полето.
   Enter в полето отваря първия резултат. Бройката се казва в скрит aria-live. */
function bind(inp, box, clr, onEsc, wrapFn, live){
  function links(){ return Array.prototype.slice.call(box.querySelectorAll("a.mg-frow, button.mg-fmore")); }
  function draw(){ var v = inp.value.trim(); clr.hidden = !v; box.innerHTML = '<div class="mg-fres">' + (v ? results(v) : start()) + '</div>'; wrapFn && wrapFn(v);
    if (live){ var n = box.querySelectorAll("a.mg-frow").length; live.textContent = v ? (n ? A.plural(n, "резултат", "резултата") + " за „" + v + "“" : "Нищо за „" + v + "“") : ""; } }
  inp.addEventListener("input", function(){ more = {}; draw(); });
  inp.addEventListener("keydown", function(e){ var o = links();
    if (e.key === "ArrowDown"){ if (o[0]){ e.preventDefault(); o[0].focus(); } }
    else if (e.key === "Enter"){ var t = box.querySelector("a.mg-frow"); if (t){ e.preventDefault(); t.click(); } }
    else if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); if (inp.value && !onEsc.closeFirst){ inp.value = ""; more = {}; draw(); } else onEsc(); } });
  box.addEventListener("keydown", function(e){ var o = links(), i = o.indexOf(document.activeElement); if (i < 0) return;
    if (e.key === "ArrowDown"){ e.preventDefault(); (o[i + 1] || o[i]).focus(); }
    else if (e.key === "ArrowUp"){ e.preventDefault(); if (i > 0) o[i - 1].focus(); else inp.focus(); }
    else if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); inp.focus(); } });
  clr.addEventListener("mousedown", function(e){ e.preventDefault(); });
  clr.addEventListener("click", function(){ inp.value = ""; more = {}; draw(); inp.focus(); });
  box.addEventListener("mousedown", function(e){ if (e.target.closest("button")) e.preventDefault(); });
  box.addEventListener("click", function(e){ var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ex){ inp.value = b.dataset.ex; more = {}; draw(); inp.focus(); return; }
    if (b.dataset.tog){ inp.value = S.toggle(inp.value, b.dataset.tog); draw(); inp.focus(); return; }
    if (b.dataset.fmore){ var k = b.dataset.fmore; more[k] = 1; var y = box.scrollTop; draw(); box.scrollTop = y; var nl = box.querySelectorAll("a.mg-frow"); nl.length && nl[Math.min(nl.length - 1, 4)].focus({preventScroll:true}); } });
  return draw; }

/* телефон: цял екран, полето горе, „Затвори“ */
MGF.open = function(q0){ var w = document.createElement("div"); w.className = "mg-find"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Търси");
  w.innerHTML = '<div class="fwin"><div class="fhead"><form class="mg-q" role="search" onsubmit="return false"><label class="vh" for="mgfq">Търси маса, поръчка, резервация, човек от смяната или ястие</label>' + ic("magnifying-glass", 22) +
    '<input class="input" id="mgfq" type="search" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="Маса, №, час, ястие"><button class="clr" type="button" aria-label="Изчисти търсенето" hidden>' + ic("x", 20) + '</button></form>' +
    '<button class="fx" type="button" data-fclose>' + ic("x", 24) + '<span>Затвори</span></button></div><div class="fbody" id="mgfr" role="region" aria-label="Резултати от търсенето"></div><div class="vh" aria-live="polite" data-live></div></div>';
  document.body.appendChild(w); MG.penHide("find", true);
  var inp = w.querySelector("#mgfq"), body = w.querySelector(".fbody"), clr = w.querySelector(".clr"), prev = document.activeElement, bg = [MG.app].filter(Boolean); bg.forEach(function(el){ el.inert = true; });
  function close(){ bg.forEach(function(el){ el.inert = false; }); MG.penHide("find", false); w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 260); document.removeEventListener("keydown", trap, true); prev && prev.focus && prev.focus({preventScroll:true}); }
  close.closeFirst = true;
  /* Esc: от резултатите в полето (bind), от полето затваря; от бутоните горе затваря */
  function trap(e){ if (e.key === "Escape" && document.activeElement !== inp && !body.contains(document.activeElement)){ e.preventDefault(); close(); return; } if (e.key !== "Tab") return;
    var f = Array.prototype.filter.call(w.querySelectorAll("button:not([hidden]), a[href], input"), function(el){ return el.offsetParent !== null; }); if (!f.length) return;
    var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } }
  document.addEventListener("keydown", trap, true);
  var draw = bind(inp, body, clr, close, null, w.querySelector("[data-live]"));
  w.querySelector("[data-fclose]").onclick = close;
  w.addEventListener("click", function(e){ if (e.target.closest("a.mg-frow")) setTimeout(close, 0); });
  if (q0) inp.value = q0; draw(); MGF.close = close;
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); inp.focus({preventScroll:true}); }); }); };

/* компютър: полето в горната лента и панел под него */
MGF.desktop = function(inp){ if (inp._mgf) return; inp._mgf = 1; var wrap = inp.closest(".mg-dsearch"), box = wrap.querySelector(".mg-dpanel"), clr = wrap.querySelector(".clr"), k = wrap.querySelector(".k");
  /* панелът е под полето, но никога под лявата лента и извън колоната: позицията се смята от колоната (на 1024 полето е тясно) */
  function place(){ var col = MG.app.querySelector(".mg-col").getBoundingClientRect(), f = inp.getBoundingClientRect(), w = Math.min(620, col.width - 48), left = Math.min(f.right - w, col.right - 24 - w); left = Math.max(col.left + 24, left);
    box.style.width = w + "px"; box.style.left = left + "px"; box.style.top = (f.bottom + 8) + "px"; box.style.maxHeight = Math.max(240, window.innerHeight - f.bottom - 24) + "px"; }
  function show(){ place(); box.hidden = false; }
  function hide(){ box.hidden = true; }
  /* второто Esc затваря панела, фокусът остава в полето */
  function esc0(){ hide(); }
  var live = document.createElement("div"); live.className = "vh"; live.setAttribute("aria-live", "polite"); wrap.appendChild(live);
  var draw = bind(inp, box, clr, esc0, function(v){ k.hidden = !!v; show(); }, live);
  inp.addEventListener("focus", function(){ draw(); });
  inp.addEventListener("click", function(){ if (box.hidden) draw(); });
  inp.addEventListener("blur", function(){ setTimeout(function(){ if (!wrap.contains(document.activeElement)) hide(); }, 160); });
  window.addEventListener("resize", function(){ if (!box.hidden) place(); }); window.addEventListener("scroll", function(){ if (!box.hidden) place(); }, {passive:true});
  document.addEventListener("click", function(e){ if (!wrap.contains(e.target)) hide(); });
  if (document.activeElement === inp) draw(); };
MGF.search = search; /* за проверките в прототипа */
})();
