/* Siracusa · Собственик: търсачката (решения 15.11 „Умна търсачка = асистентът“ и „Търсенето на ястия е едно“).
   Зарежда се при първото отваряне (O.loadFind в _own.js), след ../ds/search.js (window.SCSearch, същият код като src/lib/search.ts).
   Само каквото собственикът вижда: показателите („оборот“, „гориво“, „неявили се“ водят към мястото им), ястията с продажбите им
   за последните 7 дни (по име горе, лента „Съдържат …“ по състав, „без …“ с чип; ястие без състав най-долу с „Нямаме пълен състав,
   попитайте ни“) и през A.search разделите на админа, поръчките, резервациите, клиентите и бележките (по правата на ролята).
   Телефон: цял екран (OF.open). Компютър: панел под полето горе (OF.bindField). Esc, „Затвори“, Enter отваря първия резултат. */
(function(){
"use strict";
var S = window.SCSearch, ic = SC.ic, esc = SC.esc, norm = A.norm;
var OF = window.OF = {};

/* показателите: думи (кирилица или латиница) → мястото им в модула */
function sales(){ return A.todaySales(); }
var KPI = [
  ["оборот приходи продажби пари revenue sales turnover", "Оборот днес", function(){ var s = O.todaySales ? O.todaySales() : sales(); return SC.fmt(s.sum) + " от " + A.plural(s.n, "поръчка", "поръчки"); }, "today.html", "wallet"],
  ["оборот тенденции седмица месец период сравнение revenue trend", "Оборот по ден и сравнение", function(){ return "Тенденции · 7 дни, 30 дни, месец"; }, "trends.html", "chart-bar"],
  ["поръчки брой orders", "Поръчки днес", function(){ return "Днес и на живо"; }, "today.html", "receipt"],
  ["среден бон средна поръчка average", "Среден бон", function(){ return "Днес и по периоди"; }, "trends.html", "receipt"],
  ["канали канал доставка вземане маса офис телефон сайт channel delivery pickup", "Поръчки по канал", function(){ return "Сайт (доставка и вземане), телефон, маса, офис"; }, "today.html#channels", "truck"],
  ["гориво бензин дизел литри километри км разход шофьор автомобил кола fuel gas petrol", "Гориво", function(){ return "Литри, €, км по ден, шофьор и автомобил"; }, "finance.html#fuel", "car"],
  ["брой кеш пари предаване шофьор cash", "Пари в брой от шофьорите", function(){ return "Предадени и за предаване"; }, "finance.html#cash", "money"],
  ["плащане карта ваучер брой payment card voucher", "Приходи по начин на плащане", function(){ return "В брой, Карта при получаване, Ваучер"; }, "finance.html#pay", "credit-card"],
  ["неявили неявяване блокиране блокирай no show noshow", "Неявили се", function(){ var n = A.blocksPending(); return n ? A.plural(n, "номер чака", "номера чакат") + " решение" : "Нищо не чака решение"; }, "decisions.html#noshow", "warning-circle"],
  ["резервации резервация заетост reservations", "Резервации и неявили се", function(){ return "По периоди"; }, "trends.html#res", "calendar-check"],
  ["въпроси въпрос решения агенция отговор questions", "Въпроси от агенцията", function(){ var n = O.unanswered().length; return n ? A.plural(n, "въпрос чака", "въпроса чакат") + " отговор" : "Всички са с отговор"; }, "decisions.html", "chat-circle-dots"],
  ["топ ястия най поръчвани хит продавани top dishes", "Най-поръчвани ястия", function(){ return "По брой и по оборот"; }, "trends.html#top", "fork-knife"],
  ["часове час пик натоварено топлинна карта hours peak", "Пикови часове", function(){ return "Ден от седмицата × час"; }, "trends.html#heat", "clock"],
  ["клиенти нови връщащи customers", "Нови и връщащи се клиенти", function(){ return "По периоди"; }, "trends.html#clients", "users"],
  ["времена време приготвяне доставка повикване times", "Средни времена", function(){ return "Приготвяне, доставка, отговор на повикване"; }, "trends.html#times", "timer"],
  ["оферти оферта отстъпка обедно код offers discount", "Ефектът на офертите", function(){ return "-30% след 15:00 и кодът от оценката"; }, "trends.html#offers", "seal-percent"],
  ["себестойност печалба марж cost profit", "Себестойност и печалба", function(){ return "[ЛИПСВА: себестойност на ястията]"; }, "finance.html#cost", "scales"],
  ["google профил отзиви рейтинг работно време", "Google профил", function(){ return "Скоро"; }, "decisions.html#google", "google-logo"],
  ["отклонение под обичайното alert", "Известие при отклонение", function(){ return "Днес спрямо обичайното за деня"; }, "today.html", "warning"]
].map(function(k){ return {keys:norm(k[0]).split(" "), title:k[1], meta:k[2], href:k[3], icon:k[4], tn:norm(k[1])}; });
function kpis(q){ var words = norm(q).split(" ").filter(function(w){ return w.length >= 3; }); if (!words.length) return [];
  return KPI.filter(function(k){ return words.every(function(w){ return k.keys.some(function(x){ return x.indexOf(w) === 0 || (w.length >= 5 && w.indexOf(x) === 0 && x.length >= 4); }) || k.tn.indexOf(w) > -1; }); }); }

/* продажбите на ястието за последните 7 дни (същият генератор като „Отчети“) */
var WEEK = null;
function week(){ if (!WEEK) WEEK = H.agg(H.addD(H.TODAY, -6), H.TODAY); return WEEK; }
function dishRow(x){ var q = week().dish[x.id] || 0, out = SC.isOut(x), cat = SC.catById[x.cat];
  return '<a class="ow-fr" href="trends.html#dish=' + encodeURIComponent(x.id) + '">' + SC.pic(x) + '<span><b>' + esc(x.n) + '</b><small>' + esc(cat ? cat.n : "") + ' · ' + SC.fmt(x.p) + (out ? ' · Изчерпано днес' : '') + '</small></span><span class="fv">' + (q ? A.plural(q, "брой", "броя") + '<small>' + O.eur0(q * x.p) + ' · 7 дни</small>' : '<small>0 за 7 дни</small>') + '</span></a>'; }
function row(it){ return '<a class="ow-fr" href="' + esc(it.href) + '"><span class="fi">' + ic(it.icon, 22) + '</span><span><b>' + esc(it.title) + '</b>' + (it.meta ? '<small>' + esc(it.meta) + '</small>' : '') + '</span><span class="fv">' + ic("caret-right", 20) + '</span></a>'; }
var more = {};
function group(key, title, list, render, max, sub){ if (!list.length) return ""; max = max || 5; var open = more[key];
  return '<section class="ow-fg"><h3>' + esc(title) + '<small>' + (sub || list.length) + '</small></h3>' + list.slice(0, open ? 60 : max).map(render).join("") +
    (list.length > max && !open ? '<button class="link ow-fmore" type="button" data-fmore="' + key + '">Покажи още ' + (list.length - max) + ic("caret-down", 18) + '</button>' : '') + '</section>'; }

/* търсенето (без HTML): за проверките в прототипа */
OF.search = function(q){ var r = {kpi:kpis(q), dish:null, admin:[]};
  var d = S.searchDishes(SC.items, q); r.dish = d;
  A.search(q).forEach(function(g){ if (/^dish|^wait/.test(g.key) || !g.items.length) return;
    r.admin.push({key:g.key, title:g.key === "sec" ? "В админа" : g.title, items:g.items.map(function(it){ return {href:it.href ? "../pages-admin/" + it.href : it.title === "Финанси и гориво" ? "finance.html" : "../pages-admin/dashboard.html", icon:it.icon, title:it.title, meta:it.title === "Финанси и гориво" ? "Тук, в модула" : it.meta}; }), more:g.more}); });
  return r; };
OF.results = function(q){ q = q.trim(); if (!q) return start();
  var r = OF.search(q), d = r.dish, h = "", chips = S.chips(q);
  if (chips.length) h += '<div class="ow-fchips" role="group" aria-label="Съставки и алергени">' + chips.map(function(c){ return '<button class="chip' + (c.without ? ' without' : '') + '" type="button" data-tog="' + esc(c.word) + '" aria-pressed="' + c.without + '">' + (c.without ? ic("minus", 18) + 'без ' + esc(c.label) : esc(c.label) + ic("x", 16)) + '</button>'; }).join("") + '</div>';
  h += group("k", "Показатели", r.kpi, function(k){ return row({href:k.href, icon:k.icon, title:k.title, meta:k.meta()}); }, 4);
  var exc = d.query.exc.map(function(w){ return w.label; }), inc = d.query.inc.length;
  h += group("d", inc ? "Ястия" : exc.length ? "Без " + exc.join(" и ") + " по състава" : "Ястия", inc ? d.name : d.rest, dishRow, inc ? 5 : 8, "продажби за 7 дни");
  if (d.comp.length) h += '<div class="ow-fband">' + ic("bowl-food", 20) + '<span>' + esc(d.band) + '</span></div>' + d.comp.slice(0, more.c ? 60 : 5).map(dishRow).join("") + (d.comp.length > 5 && !more.c ? '<button class="link ow-fmore" type="button" data-fmore="c">Покажи още ' + (d.comp.length - 5) + ic("caret-down", 18) + '</button>' : '');
  if (d.unknown.length) h += '<div class="ow-fband unk">' + ic("warning", 20) + '<span>Нямаме пълен състав, попитайте ни<small>Не знаем дали са „без ' + esc(exc.join(" и ") || "…") + '“: съставът им още не е въведен.</small></span></div>' + d.unknown.slice(0, more.u ? 60 : 4).map(dishRow).join("") + (d.unknown.length > 4 && !more.u ? '<button class="link ow-fmore" type="button" data-fmore="u">Покажи още ' + (d.unknown.length - 4) + ic("caret-down", 18) + '</button>' : '');
  r.admin.forEach(function(g){ h += group("a" + g.key, g.title, g.items, row, 4); });
  var any = r.kpi.length || d.name.length || d.comp.length || d.rest.length || d.unknown.length || r.admin.length;
  if (!any) h += '<div class="ow-fnone"><b>Нищо не намерихме за „' + esc(q) + '“</b>Опитай с име на ястие (и на латиница), „без глутен“, „оборот“, „гориво“ или № на поръчка.</div>';
  return h; };
function start(){ var ex = [["оборот","Оборот"],["гориво","Гориво"],["неявили се","Неявили се"],["маргарита","Маргарита"],["без глутен","Без глутен"],["въпроси","Въпроси"]];
  return '<p class="ow-fscope">Търсиш в своето: показателите, ястията с продажбите им, поръчките и разделите на админа. На кирилица или латиница.</p><div class="ow-fchips">' + ex.map(function(e){ return '<button class="chip" type="button" data-ex="' + esc(e[0]) + '">' + e[1] + '</button>'; }).join("") + '</div>'; }
function onBody(e, inp, draw){ var b = e.target.closest("button"); if (!b) return false;
  if (b.dataset.ex){ inp.value = b.dataset.ex; more = {}; draw(); inp.focus(); return true; }
  if (b.dataset.tog){ inp.value = S.toggle(inp.value, b.dataset.tog); draw(); return true; }
  if (b.dataset.fmore){ more[b.dataset.fmore] = 1; draw(); return true; } return false; }

/* ---------- телефон: цял екран ---------- */
OF.open = function(q0){ if (O.app.querySelector(".ow-find")) return;
  var w = document.createElement("div"); w.className = "ow-find"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Търси");
  w.innerHTML = '<div class="fh"><form role="search" onsubmit="return false"><label class="vh" for="ow-fq">Търси ястие, показател, поръчка</label>' + ic("magnifying-glass", 22) + '<input id="ow-fq" type="search" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="Ястие, оборот, гориво …"><button class="clr" type="button" data-clr aria-label="Изчисти търсенето" hidden>' + ic("x", 22) + '</button></form>' +
    '<button class="fx" type="button" data-fclose>' + ic("x", 24) + 'Затвори</button></div><div class="fb" aria-live="polite"></div>';
  O.app.appendChild(w); document.body.classList.add("ow-find-on");
  var inp = w.querySelector("#ow-fq"), body = w.querySelector(".fb"), clr = w.querySelector("[data-clr]"), prev = document.activeElement, bg = [O.rail, O.col, O.bnav].filter(Boolean);
  bg.forEach(function(el){ el.inert = true; });
  function draw(){ var v = inp.value.trim(); clr.hidden = !v; body.innerHTML = OF.results(v); }
  function close(){ bg.forEach(function(el){ el.inert = false; }); document.body.classList.remove("ow-find-on"); w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 220); document.removeEventListener("keydown", key, true); prev && prev.focus && prev.focus({preventScroll:true}); }
  function key(e){ if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Tab"){ var f = Array.prototype.filter.call(w.querySelectorAll("button:not([hidden]), a[href], input"), function(el){ return el.offsetParent !== null; }); if (!f.length) return;
      var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } } }
  document.addEventListener("keydown", key, true);
  inp.addEventListener("input", function(){ more = {}; draw(); });
  inp.addEventListener("keydown", function(e){ if (e.key === "Enter"){ var a = body.querySelector("a.ow-fr"); if (a){ e.preventDefault(); location.href = a.getAttribute("href"); } } });
  w.addEventListener("click", function(e){ if (e.target.closest("[data-fclose]")){ close(); return; } if (e.target.closest("[data-clr]")){ inp.value = ""; more = {}; draw(); inp.focus(); return; } onBody(e, inp, draw); });
  if (q0) inp.value = q0; draw();
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); inp.focus({preventScroll:true}); }); });
  OF.close = close; };

/* ---------- компютър: панел под полето ---------- */
OF.bindField = function(inp){ if (inp._of) return; inp._of = 1; var wrap = inp.parentElement, clr = wrap.querySelector(".clr"), sel = -1;
  var box = document.createElement("div"); box.className = "ow-fpanel"; box.id = "ow-qres"; box.hidden = true; box.setAttribute("aria-label", "Резултати"); wrap.appendChild(box);
  function opts(){ return Array.prototype.slice.call(box.querySelectorAll("a.ow-fr")); }
  function mark(){ opts().forEach(function(el, i){ el.classList.toggle("sel", i === sel); if (i === sel) el.scrollIntoView({block:"nearest"}); }); }
  function draw(){ var v = inp.value.trim(); clr.hidden = !v; sel = -1; box.innerHTML = OF.results(v); box.hidden = false; inp.setAttribute("aria-expanded", "true"); }
  function hide(){ box.hidden = true; inp.setAttribute("aria-expanded", "false"); }
  inp.addEventListener("focus", draw); inp.addEventListener("input", function(){ more = {}; draw(); });
  clr.addEventListener("mousedown", function(e){ e.preventDefault(); }); clr.addEventListener("click", function(){ inp.value = ""; draw(); inp.focus(); });
  box.addEventListener("mousedown", function(e){ if (!e.target.closest("a")) e.preventDefault(); });
  box.addEventListener("click", function(e){ if (onBody(e, inp, draw)) inp.focus(); });
  inp.addEventListener("keydown", function(e){ var o = opts();
    if (e.key === "ArrowDown"){ e.preventDefault(); sel = Math.min(o.length - 1, sel + 1); mark(); } else if (e.key === "ArrowUp"){ e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === "Enter"){ var t = o[sel >= 0 ? sel : 0]; if (t){ e.preventDefault(); location.href = t.getAttribute("href"); } }
    else if (e.key === "Escape"){ if (inp.value){ inp.value = ""; draw(); } else { hide(); inp.blur(); } } });
  inp.addEventListener("blur", function(){ setTimeout(function(){ if (!wrap.contains(document.activeElement)) hide(); }, 150); });
  document.addEventListener("keydown", function(e){ if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "") && inp.offsetParent){ e.preventDefault(); inp.focus(); } });
  draw(); };
})();
