/* Siracusa · търсачката на шофьора (решение 15.11 „Умна търсачка = асистентът“).
   Едно поле. Шофьорът търси само в своите доставки за смяната: номер („1042“, „№ 1043“), адрес, зона, бележка.
   В кода списъкът идва от сървъра само с доставките на влезлия шофьор (GET /api/driver/search?q=…, проверка на правата);
   тук е от макетните данни DR.db.dels. Зарежда се при първото отваряне (DR.openFind в _driver.js). */
(function(){
"use strict";
var ic = SC.ic, esc = SC.esc;
var LAT = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sht","ъ":"a","ь":"y","ю":"yu","я":"ya"};
function lat(s){ return String(s || "").toLowerCase().replace(/[а-я]/g, function(c){ return LAT[c] || c; }).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim(); }
var STW = {wait:["в ресторанта","ресторант"], picked:["взета","взети"], road:["на път"], done:["доставена","доставени"], prob:["проблем"]};

function search(raw){ var q = lat(raw), words = q.split(" ").filter(Boolean);
  if (!words.length) return {act:[], done:[]};
  var hits = DR.db.dels.filter(function(d){
    var hay = lat([d.id, d.zone || "извън зоните", d.addr, d.sub, d.note, DR.PAY[d.pay][0], DR.ST[d.st][0]].concat(STW[d.st] || []).join(" ")).split(" ");
    return words.every(function(w){ return hay.some(function(h){ return h.indexOf(w) === 0 || (w.length >= 3 && /^\d+$/.test(w) && h.indexOf(w) > -1); }); }); });
  return {act:hits.filter(function(d){ return d.st !== "done"; }), done:hits.filter(function(d){ return d.st === "done"; })}; }

function row(d){ return '<a class="frow" href="delivery.html#'+d.id+'"><span class="fi">'+ic(DR.ST[d.st][1],22)+'</span><span><b>№ '+d.id+' · '+esc(d.zone || "Извън зоните")+'</b><small>'+esc(d.addr)+' · '+esc(d.sub)+'</small></span><span class="fr"><span class="price">'+DR.money(d)+'</span><small>'+esc(DR.ST[d.st][0])+'</small></span></a>'; }
function results(raw){ var r = search(raw), h = "";
  if (r.act.length) h += '<section class="fgrp"><h3>За доставяне<span class="muted">'+r.act.length+'</span></h3>'+r.act.map(row).join("")+'</section>';
  if (r.done.length) h += '<section class="fgrp"><h3>Доставени днес<span class="muted">'+r.done.length+'</span></h3>'+r.done.map(row).join("")+'</section>';
  if (!h) h = '<div class="fempty"><div class="ill">'+ic("magnifying-glass",40)+'</div><h3>Няма „'+esc(raw)+'“</h3><p>Търсите само в своите доставки за смяната: номер (1042), адрес (бл. 3xx) или зона (Дружба 1).</p></div>';
  return h; }
function start(){ var ex = DR.db.dels.filter(function(d){ return d.st !== "done"; }).slice(0, 3).map(function(d){ return [d.id, "№ "+d.id]; }).concat([["Дружба","Дружба"],["доставени","Доставени днес"]]);
  return '<p class="fscope">Търсите само в своите доставки за смяната: номер, адрес, зона.</p><div class="fchips">'+ex.map(function(e){ return '<button class="chip" type="button" data-ex="'+esc(e[0])+'">'+esc(e[1])+'</button>'; }).join("")+'</div>'; }

DR.find = function(q0){
  var w = document.createElement("div"); w.className = "st-find"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Търси");
  w.innerHTML = '<div class="fwin"><div class="fhead"><form class="search" role="search" onsubmit="return false"><label class="vh" for="fq">Търси доставка по номер или адрес</label>'+ic("magnifying-glass",22)+
    '<input class="input" id="fq" type="search" inputmode="search" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="№ или адрес…"><button class="clr" type="button" data-clr aria-label="Изчисти търсенето" hidden>'+ic("x",22)+'</button></form>'+
    '<button class="fx" type="button" data-fclose>'+ic("x",22)+'<span>Затвори</span></button></div><div class="fbody" aria-live="polite"></div></div>';
  document.body.appendChild(w);
  var inp = w.querySelector("#fq"), body = w.querySelector(".fbody"), clr = w.querySelector("[data-clr]"), prev = document.activeElement;
  var bg = [DR.app, document.querySelector(".st-nav"), document.querySelector(".st-bar")].filter(Boolean); bg.forEach(function(el){ el.inert = true; });
  function draw(){ var v = inp.value.trim(); clr.hidden = !v; body.innerHTML = v ? results(v) : start(); }
  function close(){ bg.forEach(function(el){ el.inert = false; }); w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 260); document.removeEventListener("keydown", key, true); prev && prev.focus && prev.focus({preventScroll:true}); }
  function key(e){ if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === "Tab"){ var f = Array.prototype.filter.call(w.querySelectorAll("button:not([hidden]), a[href], input"), function(el){ return el.offsetParent !== null; }); if (!f.length) return;
      var a = f[0], z = f[f.length-1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } } }
  document.addEventListener("keydown", key, true);
  inp.addEventListener("input", draw);
  inp.addEventListener("keydown", function(e){ if (e.key === "Enter"){ var a = body.querySelector("a.frow"); if (a){ e.preventDefault(); location.href = a.getAttribute("href"); } } });
  w.addEventListener("click", function(e){ if (e.target === w){ close(); return; } var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-fclose")){ close(); return; }
    if (b.hasAttribute("data-clr")){ inp.value = ""; draw(); inp.focus(); return; }
    if (b.dataset.ex){ inp.value = b.dataset.ex; draw(); inp.focus(); } });
  if (q0) inp.value = q0; draw();
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); inp.focus({preventScroll:true}); }); });
};
})();
