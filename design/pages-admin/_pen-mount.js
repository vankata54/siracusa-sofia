/* Молив в модулите Сервитьор, Кухня и Шофьор (решения на Поли 15.11: „Моливът на телефон“, „Вход според ролята“).
   Самостоятелен: не зависи от A (рамката на админа). Включва се след ../ds/icons.js и ../pages-admin/_pencil.js:
     <script src="../pages-admin/_pencil.js"></script>
     <script src="../pages-admin/_pen-mount.js" data-place="top" data-top="10" data-bottom="96" data-side="right"></script>
   Ако има влязъл служител (localStorage "sa-session" {user, name, role}), закача молива. Служителите пишат ПРЕПОРЪКИ:
   те не променят нищо, отиват в „Бележки“ на админа и главният админ ги одобрява.
   Запис в localStorage "sa-notes" (същият формат като в админа, полетата от src/core/notes.ts + source):
   {id, module:"servitor"|"kuhnya"|"shofyor", url:"/pages-servitor/tables.html#…", selector, editId, text, elementText, viewport:{w,h},
    screenshot:null, author:"Сервитьор 1 (Сервитьор)", source:{type:"staff", role, user}, status:"new", createdAt, updatedAt}.
   Бутонът „Молив“ (икона и дума, 48 px) е собствен, не кръглият на админа:
   - data-place="top"    на телефон горе вдясно (data-top px от горния ръб), за модули, чиято горна лента има място;
   - data-place="bottom" на телефон над долната лента (data-bottom px от долния ръб, напр. 96 над лента от 80 px);
   - data-side="right" | "left"; от 700 px ширина: data-wide-place="bottom" (data-wide-bottom, 24) или "top" (data-wide-top, 16), data-wide-side.
   Изберете място, където бутонът не застъпва основни действия (за кухнята на таблет: горе вдясно, в реда на броячите).
   Програмно: SAPenMount.mount({place, top, bottom, side, wideBottom, widePlace, wideTop, wideSide, module}) -> контролерът на молива или null. */
(function(){
"use strict";
if (window.SAPenMount) return;
var ROLE = {admin:"Главен админ", owner:"Собственик", manager:"Управител", waiter:"Сервитьор", kitchen:"Кухня", driver:"Шофьор", marketing:"Маркетинг"};
var MODS = {"pages-servitor":"servitor", "pages-kuhnya":"kuhnya", "pages-shofyor":"shofyor"};
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
  var pen = SAPen.mount({module:mod, author:author, recommend:rec, fab:false, notesHref:"../pages-admin/notes.html", barTop:[8, 8], toastBottom:o.bottom != null ? +o.bottom + 64 : 96,
    onSave:function(n){ n.source = {type:"staff", role:ses.role, user:ses.user}; var l = load("sa-notes", null); if (!Array.isArray(l)) l = []; l.unshift(n); store("sa-notes", l); },
    onToggle:function(on){ btn.setAttribute("aria-pressed", String(on)); btn.innerHTML = on ? icon("x", 20) + '<span>Изключи</span>' : icon("pencil-simple", 20) + '<span>Молив</span>';
      btn.style.background = on ? "var(--ember)" : "var(--glass)"; btn.style.color = on ? "var(--on-ember)" : "var(--ink)"; }});
  /* own button: 48 px, icon and word, tokens only */
  var btn = document.createElement("button"); btn.type = "button"; btn.className = "sa-pen-btn"; btn.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-label", rec ? "Молив: препоръка към админа" : "Молив: бележка към админа");
  btn.innerHTML = icon("pencil-simple", 20) + '<span>Молив</span>';
  var st = document.createElement("style");
  var place = o.place === "top" ? "top" : "bottom", side = o.side === "left" ? "left" : "right", top = +(o.top != null ? o.top : 10), bottom = +(o.bottom != null ? o.bottom : 96), wide = +(o.wideBottom != null ? o.wideBottom : 24),
    wplace = o.widePlace === "top" ? "top" : "bottom", wtop = +(o.wideTop != null ? o.wideTop : 16), wside = o.wideSide === "left" ? "left" : "right";
  st.textContent = ".sa-pen-btn{position:fixed; z-index:2147482990; " + side + ":max(8px, env(safe-area-inset-" + side + ")); " + (place === "top" ? "top:calc(" + top + "px + env(safe-area-inset-top))" : "bottom:calc(" + bottom + "px + env(safe-area-inset-bottom))") + "; display:inline-flex; align-items:center; gap:8px; min-height:48px; min-width:48px; padding:0 16px 0 14px; border:0; border-radius:999px; background:var(--glass); color:var(--ink); -webkit-backdrop-filter:blur(16px); backdrop-filter:blur(16px); box-shadow:inset 0 0 0 1px var(--glass-line), var(--shadow); font:800 15px/1 var(--font, system-ui, sans-serif); font-feature-settings:\"locl\" 0; cursor:pointer; -webkit-tap-highlight-color:transparent}" +
    ".sa-pen-btn:active{transform:scale(.96)} .sa-pen-btn:focus-visible{outline:3px solid var(--red); outline-offset:2px}" +
    ".sa-pen-btn svg{color:var(--red)} .sa-pen-btn[aria-pressed=\"true\"] svg{color:inherit}" +
    "@media (min-width:700px){ .sa-pen-btn{top:" + (wplace === "top" ? wtop + "px" : "auto") + "; bottom:" + (wplace === "top" ? "auto" : wide + "px") + "; " + (wside === "left" ? "left:24px; right:auto" : "right:24px; left:auto") + "; min-height:52px; padding:0 20px 0 16px; font-size:16px} }"; /* ширината на прозореца: скриптът е извън контейнерите на модулите */
  document.head.appendChild(st); document.body.appendChild(btn);
  btn.addEventListener("click", function(){ pen.toggle(); });
  pen.button = btn; return pen; }

window.SAPenMount = {mount:mount};
var ds = script ? script.dataset : {};
function auto(){ window.SAPenMount.pen = mount({place:ds.place, top:ds.top, bottom:ds.bottom, side:ds.side, wideBottom:ds.wideBottom, widePlace:ds.widePlace, wideTop:ds.wideTop, wideSide:ds.wideSide, module:ds.module}); }
if (ds.auto !== "false"){ if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", auto); else auto(); }
})();
