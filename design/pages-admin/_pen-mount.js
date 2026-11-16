/* Молив в модулите Сервитьор, Кухня, Шофьор, Управител и Собственик (стъпка 5; решения на Поли 15.11: „Моливът на телефон“, „Вход според ролята“).
   Самостоятелен: не зависи от A (рамката на админа). Включва се след ../ds/icons.js и ../pages-admin/_pencil.js:
     <script src="../pages-admin/_pencil.js"></script>
     <script src="../pages-admin/_pen-mount.js" data-place="top" data-top="10" data-bottom="96" data-side="right"></script>
   Ако има влязъл служител (localStorage "sa-session" {user, name, role}), закача молива. Служителите пишат ПРЕПОРЪКИ:
   те не променят нищо, отиват в „Бележки“ на админа и главният админ ги одобрява.
   Запис в localStorage "sa-notes" (същият формат като в админа, полетата от src/core/notes.ts + source):
   {id, module:"servitor"|"kuhnya"|"shofyor"|"upravitel"|"sobstvenik" (по папката), url:"/pages-servitor/tables.html#…", selector, editId, text, elementText, viewport:{w,h},
    screenshot:null, author:"Сервитьор 1 (Сервитьор)", source:{type:"staff", role, user}, status:"new", createdAt, updatedAt}.
   Бутонът „Молив“ (икона и дума, 48 px) е собствен, не кръглият на админа:
   - data-place="top"    на телефон горе вдясно (data-top px от горния ръб), за модули, чиято горна лента има място;
   - data-place="bottom" на телефон над долната лента (data-bottom px от долния ръб, напр. 96 над лента от 80 px);
   - data-side="right" | "left"; от 700 px ширина: data-wide-place="bottom" (data-wide-bottom, 24) или "top" (data-wide-top, 16), data-wide-side.
   Изберете място, където бутонът не застъпва основни действия (за кухнята на таблет: горе вдясно, в реда на броячите).
   - data-slot="<селектор>" (или slot: елемент): бутонът се слага в този елемент, в потока (без плаване);
   - data-toast-wide="top" | "bottom": известието на широк екран; по подразбиране горе, ако бутонът е горе или в слот.
   Програмно: SAPenMount.mount({place, top, bottom, side, wideBottom, widePlace, wideTop, wideSide, module, slot, toastWide}) -> контролерът на молива или null. */
(function(){
"use strict";
if (window.SAPenMount) return;
var ROLE = {admin:"Главен админ", owner:"Собственик", manager:"Управител", waiter:"Сервитьор", kitchen:"Кухня", driver:"Шофьор", marketing:"Маркетинг"};
var MODS = {"pages-servitor":"servitor", "pages-kuhnya":"kuhnya", "pages-shofyor":"shofyor", "pages-upravitel":"upravitel", "pages-sobstvenik":"sobstvenik"};
var script = document.currentScript;
function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function store(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
function moduleOf(){ var m = location.pathname.match(/\/(pages-[a-z]+)\//); return m && MODS[m[1]] || "site"; }
function inPreview(){ try{ return window.parent !== window && !!window.parent.A_PREVIEW; }catch(e){ return false; } }
function icon(n, s){ var I = window.SC_ICONS || {}; return I[n] ? '<svg viewBox="0 0 256 256" width="' + s + '" height="' + s + '" fill="currentColor" aria-hidden="true" style="flex:none;display:block">' + I[n] + '</svg>' : ''; }

function mount(o){ o = o || {};
  var ses = load("sa-session", null); if (!ses || !ses.role || !window.SAPen || inPreview()) return null;
  var rec = ses.role !== "admin" && ses.role !== "marketing"; /* служителите: само препоръки */
  var author = (ses.name || ses.user) + " (" + (ROLE[ses.role] || ses.role) + ")", mod = o.module || moduleOf();
  var slotEl = typeof o.slot === "string" ? document.querySelector(o.slot) : o.slot || null;
  var pen = SAPen.mount({module:mod, author:author, recommend:rec, fab:false, notesHref:"../pages-admin/notes.html", barTop:[8, 8], toastBottom:o.bottom != null ? +o.bottom + 64 : 96,
    /* широк екран: известието горе, ако бутонът е горе или в слот на модула (иначе стои над „Готово“ на картите в кухнята) */
    toastTop:o.toastTop || 84, /* под горната лента на модула и под лентата в жар */ toastWideTop:function(){ return o.toastWide === "top" || (o.toastWide !== "bottom" && (wplace === "top" || btn.parentElement !== document.body)); },
    onSave:function(n){ n.source = {type:"staff", role:ses.role, user:ses.user}; var l = load("sa-notes", null); if (!Array.isArray(l)) l = []; l.unshift(n); store("sa-notes", l); },
    onToggle:function(on){ btn.setAttribute("aria-pressed", String(on)); btn.innerHTML = on ? icon("x", 22) + '<span>Изключи</span>' : icon("pencil-simple", 22) + '<span>Молив</span>'; btn.title = on ? "Изключи молива" : (rec ? "Молив: препоръка" : "Молив: бележка");
      btn.style.background = on ? "var(--ember)" : "var(--glass)"; btn.style.color = on ? "var(--on-ember)" : "var(--ink)"; }});
  /* own button: 48 px, icon and word, tokens only */
  var btn = document.createElement("button"); btn.type = "button"; btn.className = "sa-pen-btn"; btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-label", "Молив");
  btn.innerHTML = icon("pencil-simple", 22) + '<span>Молив</span>'; btn.title = rec ? "Молив: препоръка" : "Молив: бележка";
  var st = document.createElement("style");
  var place = o.place === "top" ? "top" : "bottom", side = o.side === "left" ? "left" : "right", top = +(o.top != null ? o.top : 10), bottom = +(o.bottom != null ? o.bottom : 96), wide = +(o.wideBottom != null ? o.wideBottom : 24),
    wplace = o.widePlace === "top" ? "top" : "bottom", wtop = +(o.wideTop != null ? o.wideTop : 16), wside = o.wideSide === "left" ? "left" : "right";
  st.textContent = ".sa-pen-btn{position:fixed; z-index:2147482990; " + side + ":max(8px, env(safe-area-inset-" + side + ")); " + (place === "top" ? "top:calc(" + top + "px + env(safe-area-inset-top))" : "bottom:calc(" + bottom + "px + env(safe-area-inset-bottom))") + "; display:inline-flex; align-items:center; gap:8px; min-height:48px; min-width:48px; padding:0 16px 0 14px; border:0; border-radius:999px; background:var(--glass); color:var(--ink); -webkit-backdrop-filter:blur(16px); backdrop-filter:blur(16px); box-shadow:inset 0 0 0 1px var(--glass-line), var(--shadow); font:800 15px/1 var(--font, system-ui, sans-serif); font-feature-settings:\"locl\" 0; cursor:pointer; -webkit-tap-highlight-color:transparent}" +
    ".sa-pen-btn:active{transform:scale(.96)} .sa-pen-btn:focus-visible{outline:3px solid var(--red); outline-offset:2px}" +
    ".sa-pen-btn svg{color:var(--red)} .sa-pen-btn[aria-pressed=\"true\"] svg{color:inherit}" +
    "@media (min-width:700px){ .sa-pen-btn{top:" + (wplace === "top" ? wtop + "px" : "auto") + "; bottom:" + (wplace === "top" ? "auto" : wide + "px") + "; " + (wside === "left" ? "left:24px; right:auto" : "right:24px; left:auto") + "; min-height:52px; padding:0 20px 0 16px; font-size:16px} }"; /* ширината на прозореца: скриптът е извън контейнерите на модулите */
  /* плаващ (не в слот): кръгла икона 56 px без текст, aria-label „Молив“ и подсказка (решение 15.11) */
  st.textContent += ".sa-pen-btn:not(.in-slot){width:56px; height:56px; min-width:56px; padding:0; justify-content:center; border-radius:50%} .sa-pen-btn:not(.in-slot) span{position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap}";
  st.textContent += ".sa-pen-btn.in-slot{position:static; top:auto; bottom:auto; left:auto; right:auto; box-shadow:inset 0 0 0 1px var(--line-strong)}";
  document.head.appendChild(st);
  /* слот: модулът дава място (елемент или селектор), бутонът е в потока, не плаващ */
  if (slotEl){ btn.classList.add("in-slot"); slotEl.appendChild(btn); } else document.body.appendChild(btn);
  /* модулите, които сами местят бутона в своя слот, получават същото оформление */
  function slotted(){ btn.classList.toggle("in-slot", btn.parentElement !== document.body); }
  requestAnimationFrame(slotted); setTimeout(slotted, 600);
  btn.addEventListener("click", function(){ pen.toggle(); });
  /* препоръките на служителя с нов статус (одобрена, отхвърлена, публикувана …) от последното отваряне на „Моите препоръки“: значка на бутона */
  function changedN(){ var l = load("sa-notes", []), seen = load("sa-notes-seen-" + ses.user, ""); if (!Array.isArray(l)) return 0;
    return l.filter(function(n){ return n.source && n.source.user === ses.user && n.status !== "new" && (!seen || n.updatedAt > seen); }).length; }
  function badgeSync(){ var n = changedN(), b = btn.querySelector(".sa-pen-n");
    if (!n){ if (b) b.remove(); btn.setAttribute("aria-label", "Молив"); return; }
    if (!b){ b = document.createElement("span"); b.className = "sa-pen-n"; b.setAttribute("aria-hidden", "true"); btn.appendChild(b); }
    b.textContent = n; btn.setAttribute("aria-label", "Молив, " + n + (n === 1 ? " препоръка с нов статус" : " препоръки с нов статус"));
    btn.title = n + (n === 1 ? " препоръка с нов статус: „Моите препоръки“" : " препоръки с нов статус: „Моите препоръки“"); }
  st.textContent += ".sa-pen-btn{position:fixed} .sa-pen-btn.in-slot{position:relative} .sa-pen-n{position:absolute; top:-4px; right:-4px; min-width:22px; height:22px; padding:0 6px; border-radius:11px; background:var(--ember); color:var(--on-ember); font:800 14px/22px var(--font, system-ui, sans-serif); text-align:center}";
  badgeSync(); window.addEventListener("storage", function(e){ if (e.key === "sa-notes") badgeSync(); }); setInterval(badgeSync, 4000);
  pen.button = btn; return pen; }

window.SAPenMount = {mount:mount};
var ds = script ? script.dataset : {};
function auto(){ window.SAPenMount.pen = mount({place:ds.place, top:ds.top, bottom:ds.bottom, side:ds.side, wideBottom:ds.wideBottom, widePlace:ds.widePlace, wideTop:ds.wideTop, wideSide:ds.wideSide, module:ds.module, slot:ds.slot, toastWide:ds.toastWide}); }
if (ds.auto !== "false"){ if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto); else auto(); }
})();
