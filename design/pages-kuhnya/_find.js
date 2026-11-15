/* Кухня · „Търси“ (решение 15.11 „Умна търсачка = асистентът“): едно поле, само чакащите поръчки на секцията
   (главният готвач: на всички секции): номер („1042“), маса („маса 12“, „12“), канал („доставка“, „вземане“), ястие (и на латиница).
   В кода списъкът идва от сървъра само за секцията на таблета (GET /api/kitchen/search?q=…, проверка на правата).
   Имената на ястията се търсят с общото ядро window.SCSearch (../ds/search.js), по име. Зарежда се при първото отваряне. */
(function(){
"use strict";
var ic = SC.ic, esc = SC.esc, S = window.SCSearch;
var LAT = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sht","ъ":"a","ь":"y","ю":"yu","я":"ya"};
function lat(s){ return String(s || "").toLowerCase().replace(/[а-я]/g, function(c){ return LAT[c] || c; }).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
var KIND = {table:["маса","маси","салон","градина"], delivery:["доставка","доставки","шофьор"], pickup:["вземане","вземания"]};
var STATE = {late:["закъснява","закъсняват","закъснели"], soon:["наближава","наближават"]};
function hit(w, list){ return list.some(function(x){ var l = lat(x); return w.length >= 3 && (l.indexOf(w) === 0 || w.indexOf(l.slice(0, Math.max(4, l.length - 1))) === 0); }); }
function lines(o){ return K.all ? o.lines : K.mine(o); }

function search(raw){ var q = lat(raw), words = q.split(" ").filter(Boolean), nums = raw.match(/\d+/g) || [];
  var txt = words.filter(function(w){ return !/^\d/.test(w); });
  var kinds = Object.keys(KIND).filter(function(k){ return txt.some(function(w){ return hit(w, KIND[k]); }); });
  var states = Object.keys(STATE).filter(function(k){ return txt.some(function(w){ return hit(w, STATE[k]); }); });
  var rest = txt.filter(function(w){ return !Object.keys(KIND).some(function(k){ return hit(w, KIND[k]); }) && !Object.keys(STATE).some(function(k){ return hit(w, STATE[k]); }); });
  var dishIds = null;
  if (rest.length){ var r = S ? S.searchDishes(SC.items, rest.join(" ")) : {name:[]}; dishIds = r.name.map(function(x){ return x.id; }); }
  function match(o){
    if (kinds.length && kinds.indexOf(o.kind) < 0) return false;
    if (states.length && states.indexOf(K.stateOf(o)) < 0) return false;
    if (nums.length && !nums.every(function(n){ return String(o.num).indexOf(n) === 0; })) return false;
    if (dishIds && !lines(o).some(function(l){ return dishIds.indexOf(l.id) > -1; })) return false;
    return !!(kinds.length || states.length || nums.length || dishIds); }
  var act = K.orders().filter(function(o){ return K.all ? true : K.active(o); }).filter(match);
  var later = K.later().filter(function(o){ return K.all || K.mine(o).length; }).filter(match);
  return {act:act, later:later, dish:dishIds || []}; }

function row(o, dish, isLater){ var src = K.src(o), s = isLater ? "" : K.stateOf(o), l = K.left(o);
  var ls = lines(o).map(function(x){ var n = x.q + ' × ' + esc(SC.byId[x.id].n); return dish.indexOf(x.id) > -1 ? '<strong>' + n + '</strong>' : n; }).join(", ");
  return '<button class="kfrow ' + s + '" type="button" data-go="' + K.keyOf(o) + '"' + (isLater ? ' data-later' : '') + '><span class="fi">' + ic(src.ic, 26) + '</span><span><b>' + esc(K.srcText(o)) + (o.kind === "table" ? ' · ' + esc(o.zone || "") : '') + '</b><small>' + ls + '</small></span>' +
    '<span class="tm">' + (isLater ? '<small>влиза в</small>' + K.hm(o.enter) : (s === "late" ? '<small>закъснява</small>+' : s === "soon" ? '<small>наближава</small>' : '<small>остават</small>') + K.mmss(l)) + '</span></button>'; }
function results(raw){ var r = search(raw), h = "";
  if (r.act.length) h += '<h3>Чакат<span class="muted">' + r.act.length + '</span></h3>' + r.act.map(function(o){ return row(o, r.dish); }).join("");
  if (r.later.length) h += '<h3>По-късно<span class="muted">' + r.later.length + '</span></h3>' + r.later.map(function(o){ return row(o, r.dish, true); }).join("");
  if (!h) h = '<div class="kfempty"><b>Няма „' + esc(raw) + '“ в чакащите</b><p>Търсите само в поръчките на ' + (K.all ? "кухнята" : esc(K.sec.n)) + ': номер, маса, доставка, вземане или ястие.</p></div>';
  return h; }
function start(){ var os = K.orders().filter(function(o){ return K.all || K.active(o); }).slice(0, 2), first = os[0] && lines(os[0])[0];
  var ex = os.map(function(o){ return [o.kind === "table" ? "маса " + o.num : String(o.num), K.srcText(o)]; }).concat([["доставка","Доставки"],["закъснява","Закъсняват"]]);
  if (first) ex.push([SC.byId[first.id].n.split(" ")[0].toLowerCase(), SC.byId[first.id].n]);
  return '<p class="fscope">Търсите само в чакащите поръчки на ' + (K.all ? "кухнята" : esc(K.sec.n)) + ': номер, маса, ястие (и на латиница).</p><div class="fchips">' + ex.map(function(e){ return '<button type="button" data-ex="' + esc(e[0]) + '">' + esc(e[1]) + '</button>'; }).join("") + '</div>'; }

K.find = function(){
  var w = document.createElement("div"); w.className = "kfind"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Търси в чакащите поръчки");
  w.innerHTML = '<div class="fwin"><div class="fhead"><form class="fs" role="search" onsubmit="return false"><label class="vh" for="kq">Търси поръчка: номер, маса или ястие</label>' + ic("magnifying-glass", 24) +
    '<input class="input" id="kq" type="search" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="№, маса или ястие…"><button class="clr" type="button" data-clr aria-label="Изчисти търсенето" hidden>' + ic("x", 24) + '</button></form>' +
    '<button class="kpill" type="button" data-fclose>' + ic("x", 22) + 'Затвори</button></div><div class="fbody" aria-live="polite"></div></div>';
  document.body.appendChild(w);
  var inp = w.querySelector("#kq"), body = w.querySelector(".fbody"), clr = w.querySelector("[data-clr]"), prev = document.activeElement, kd = document.querySelector(".kd");
  if (kd) kd.inert = true;
  function draw(){ var v = inp.value.trim(); clr.hidden = !v; body.innerHTML = v ? results(v) : start(); }
  function close(){ if (kd) kd.inert = false; w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 260); document.removeEventListener("keydown", key, true); prev && prev.focus && prev.focus({preventScroll:true}); }
  function key(e){ if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Tab"){ var f = Array.prototype.filter.call(w.querySelectorAll("button:not([hidden]), input"), function(el){ return el.offsetParent !== null; }); if (!f.length) return;
      var a = f[0], z = f[f.length-1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } } }
  function go(b){ var k = b.getAttribute("data-go"), later = b.hasAttribute("data-later"); close();
    if (later){ K.toast && K.toast('Поръчката влиза в опашката в ' + b.querySelector(".tm").textContent.replace("влиза в", "").trim(), null, 5); return; }
    if (K.goTo && K.goTo(k)) return;
    location.href = (K.all ? "summary.html#s=all" + (K.hash.t ? "&t=" + K.hash.t : "") : K.link("queue", "go=" + k)); }
  document.addEventListener("keydown", key, true);
  inp.addEventListener("input", draw);
  inp.addEventListener("keydown", function(e){ if (e.key === "Enter"){ var b = body.querySelector("[data-go]"); if (b){ e.preventDefault(); go(b); } } });
  w.addEventListener("click", function(e){ if (e.target === w){ close(); return; } var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-fclose")){ close(); return; }
    if (b.hasAttribute("data-clr")){ inp.value = ""; draw(); inp.focus(); return; }
    if (b.dataset.ex){ inp.value = b.dataset.ex; draw(); inp.focus(); return; }
    if (b.hasAttribute("data-go")) go(b); });
  draw();
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); inp.focus({preventScroll:true}); }); });
};
})();
