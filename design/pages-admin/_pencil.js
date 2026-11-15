/* Siracusa · Молив: бележки „какво да се промени“ върху елемент от екрана.
   Самостоятелен скрипт: всичко е в Shadow DOM с префикс sa-pen-, не чупи стиловете на страницата и не зависи от A.
   Цветовете са токените на страницата (var(--red), var(--ember) ...): CSS променливите минават през Shadow DOM.
   Два слоя:
   - UI (бутон „Молив“, лента в жар, лист „Какво да се промени?“, известие) в прозореца, който го пуска (админът);
   - ограждане (рамка 2px --red и етикет) в документа, който се посочва (същият прозорец или рамката на прегледа, същият произход).
   Мишка: курсорът огражда, клик избира. Докосване: първото огражда, второто (или „Бележка за това“) избира; скролът не се пречи.
   Клавиатура: Tab огражда елемента на фокуса, Enter избира, ↑ / ↓ разширява и стеснява, Esc изключва.
   Бележката има точно полетата от src/core/notes.ts: id, module, url, selector, editId, text, elementText (до 500), viewport {w,h},
   screenshot (null в прототипа), author, status "new", createdAt, updatedAt.
   SAPen.mount({module, target:()=>window, viewport:()=>({w,h}), url:()=>"/pages/x.html#..", author:()=>"", onSave(note), onToggle(on),
                notesHref, fab:true, fabBottom:[телефон, широко]}) -> {toggle, on, off, isOn, retarget(win), show(win, selector, text), hide(win)} */
(function(){
"use strict";
if (window.SAPen) return;
var SAPen = window.SAPen = {};
var ZTOP = 2147483000;

function svg(n, s){ var I = window.SC_ICONS || {}; return I[n] ? '<svg viewBox="0 0 256 256" width="' + (s || 20) + '" height="' + (s || 20) + '" fill="currentColor" aria-hidden="true">' + I[n] + '</svg>' : ''; }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]; }); }
function clean(s){ return String(s || "").replace(/\s+/g, " ").trim(); }
function rid(){ return Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-4); }

/* ---------- what is this element (for the label) ---------- */
var KIND = {a:"Връзка", button:"Бутон", input:"Поле", textarea:"Поле", select:"Избор", img:"Снимка", h1:"Заглавие", h2:"Заглавие", h3:"Заглавие", h4:"Заглавие", h5:"Заглавие", h6:"Заглавие", p:"Текст", li:"Ред от списък", label:"Етикет", nav:"Навигация", header:"Горна лента", footer:"Долна част", section:"Раздел", article:"Карта", aside:"Странична лента", main:"Съдържание", table:"Таблица", tr:"Ред от таблица", td:"Клетка", th:"Заглавие на колона", form:"Форма", ul:"Списък", ol:"Списък", figure:"Картинка", dialog:"Прозорец", blockquote:"Цитат", summary:"Бутон", details:"Разгъване", fieldset:"Група полета", output:"Число", time:"Час"};
var INLINE = /^(span|b|strong|small|em|i|u|mark|abbr|code|kbd|sup|sub)$/;
function kindOf(el){ var t = el.tagName.toLowerCase(), r = el.getAttribute("role"), c = typeof el.className === "string" ? el.className : "";
  if (r === "button" || r === "tab" || r === "switch") return "Бутон"; if (r === "dialog") return "Прозорец"; if (r === "status" || r === "alert") return "Съобщение";
  if (t === "input" && /checkbox|radio/.test(el.type)) return "Отметка";
  if (KIND[t]) return KIND[t];
  if (/(^|\s)(pic|art)(\s|$)/.test(c)) return "Илюстрация";
  if (/(card|core|shell|tile|kcard)/.test(c)) return "Карта";
  if (/(badge|chip|tag|pill)/.test(c)) return "Етикет";
  if (INLINE.test(t)) return "Текст";
  return "Блок"; }
/* never the value of a field: the label of the field (and nothing at all for passwords, phones, e-mails) */
function labelOf(el){ var doc = el.ownerDocument, l = null;
  if (el.id){ try{ l = doc.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]'); }catch(e){} }
  if (!l) l = el.closest("label");
  var t = l ? clean(Array.prototype.filter.call(l.childNodes, function(n){ return !(n.nodeType === 1 && /^(INPUT|SELECT|TEXTAREA)$/.test(n.tagName)); }).map(function(n){ return n.textContent; }).join(" ")) : "";
  return t || clean(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || ""); }
function textOf(el){ var t = el.tagName.toLowerCase();
  if (t === "input" || t === "textarea" || t === "select") return labelOf(el);
  if (t === "img") return clean(el.alt || "");
  var s = clean(el.innerText || el.textContent || ""); return s || clean(el.getAttribute("aria-label") || el.getAttribute("title") || ""); }
function describe(el){ var k = kindOf(el), t = textOf(el); if (t.length > 34) t = t.slice(0, 32).replace(/\s+\S*$/, "") + " …"; return k + (t ? " „" + t + "“" : ""); }

/* ---------- unique, short CSS selector ---------- */
var STATE = /^(on|in|rv|rv-on|active|done|bump|open|away|mini|scrolled|warn|late|sel|cur|hover|focus|show|hide|hidden|is-.*|has-.*|js-.*)$/;
function cssEsc(win, s){ return win.CSS && win.CSS.escape ? win.CSS.escape(s) : String(s).replace(/([^\w-])/g, "\\$1"); }
function goodId(id){ return id && /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}/.test(id) && !/^(sh|sa)[a-z0-9]{5,6}$/.test(id); }
function pieces(el, win){ var t = el.tagName.toLowerCase(), out = [], late = [];
  if (goodId(el.id)) out.push("#" + cssEsc(win, el.id));
  ["data-edit-id","data-add","data-id","data-act","data-sa","data-k","name","for","aria-label","href","type"].forEach(function(a){ var v = el.getAttribute(a);
    if (!v || v.length > 60 || /^javascript:/i.test(v) || v === "#") return;
    var sel = t + "[" + a + "=\"" + v.replace(/["\\]/g, "\\$&") + "\"]";
    /* aria-label and href with numbers follow live data (a timer, an order number): only as a last resort */
    if ((a === "aria-label" || a === "href") && /\d/.test(v)) late.push(sel); else out.push(sel); });
  var cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter(function(c){ return c && !STATE.test(c) && /^[A-Za-z_][\w-]*$/.test(c); }).slice(0, 2);
  if (cls.length) out.push(t + "." + cls.map(function(c){ return cssEsc(win, c); }).join("."));
  out.push(t); return out.concat(late); }
function nth(el, base){ var p = el.parentElement; if (!p) return base; var same = Array.prototype.filter.call(p.children, function(c){ return c.tagName === el.tagName; });
  if (same.length < 2) return base; try{ if (Array.prototype.filter.call(p.children, function(c){ return c.matches(base); }).length < 2) return base; }catch(e){}
  return base + ":nth-of-type(" + (same.indexOf(el) + 1) + ")"; }
function selectorFor(el){ var doc = el.ownerDocument, win = doc.defaultView;
  function only(s){ try{ var l = doc.querySelectorAll(s); return l.length === 1 && l[0] === el; }catch(e){ return false; } }
  var path = [], cur = el, guard = 0;
  while (cur && cur.nodeType === 1 && cur !== doc.documentElement && guard++ < 14){
    var opts = pieces(cur, win);
    for (var i = 0; i < opts.length; i++){ var s = [opts[i]].concat(path).join(" > "); if (only(s)) return shorten([opts[i]].concat(path), only); }
    var best = opts.filter(function(o){ return o.charAt(0) !== "#"; }); best = best.length > 1 ? best[best.length - 2] : best[0];
    path.unshift(nth(cur, best));
    if (only(path.join(" > "))) return shorten(path, only);
    cur = cur.parentElement; }
  return path.join(" > "); }
function shorten(parts, only){ if (parts.length < 3) return parts.join(" > ");
  var last = parts[parts.length - 1];
  for (var i = 0; i < parts.length - 1; i++){ var s = parts[i] + " " + last; if (only(s)) return s; }
  for (var j = parts.length - 2; j > 0; j--){ var s2 = parts[0] + " " + parts.slice(j).join(" > "); if (only(s2)) return s2; }
  return parts.join(" > "); }

/* ---------- which element the pointer means ---------- */
function resolve(el, win){ if (!el || el.nodeType !== 1) return null; var doc = win.document;
  if (/^sa-pen-/i.test(el.tagName)) return null;
  var s = el.closest("svg"); if (s && s.parentElement) el = s.parentElement;
  var it = el.closest("a[href],button,label,input,select,textarea,summary,[role=button],[role=tab],[role=switch],[role=option]"); if (it) el = it;
  /* decorative layers without text or role (veils, gradients): take the parent */
  for (var k = 0; k < 3 && el.parentElement && el.parentElement !== doc.body; k++){
    var deco = el.getAttribute("aria-hidden") === "true" || (!clean(el.textContent) && !el.getAttribute("role") && !/^(img|svg|input|select|textarea|button|a|video|canvas|picture|iframe)$/i.test(el.tagName) && !el.querySelector("img,svg,input,select,textarea,button"));
    if (!deco) break; el = el.parentElement; }
  if (el === doc.documentElement || el === doc.body) return null;
  var r = el.getBoundingClientRect(), vw = win.innerWidth, vh = win.innerHeight;
  if (r.width * r.height > vw * vh * .8) return null; /* the whole screen is not a useful target */
  return el; }

/* ---------- styles ---------- */
var UI_CSS = ':host{all:initial; position:fixed; inset:0; pointer-events:none; z-index:' + ZTOP + '; container-type:inline-size; container-name:pen; font-family:var(--font, system-ui, sans-serif); color:var(--ink); -webkit-text-size-adjust:100%}' +
  '*{box-sizing:border-box} svg{flex:none; display:block}' +
  'button{font:inherit; color:inherit; cursor:pointer}' +
  ':focus-visible{outline:3px solid var(--red); outline-offset:2px}' +
  '.fab{position:absolute; right:16px; bottom:var(--fab-b, 24px); pointer-events:auto; display:inline-flex; align-items:center; gap:10px; min-height:56px; padding:0 22px 0 18px; border:0; border-radius:999px; background:var(--ink); color:var(--bg); font-weight:800; font-size:16px; box-shadow:var(--shadow-lg); transition:transform var(--t-fast, 120ms) var(--ease, ease), background-color var(--t-base, 200ms) var(--ease, ease)}' +
  '.fab svg{color:var(--ember)} .fab:active{transform:scale(.96)}' +
  '.fab[aria-pressed="true"]{background:var(--ember); color:var(--on-ember)} .fab[aria-pressed="true"] svg{color:var(--on-ember)}' +
  '@container pen (max-width:699px){ .fab{right:12px; bottom:var(--fab-bp, 96px)} :host([data-nofab-phone]) .fab{display:none} }' +
  ':host([data-sheet]) .fab{display:none}' + /* a sheet of the admin is open: the round button must not cover its buttons */
  '.bar{position:absolute; top:var(--bar-t, 10px); left:50%; transform:translate(-50%,-140%); opacity:0; pointer-events:none; display:flex; align-items:center; gap:8px; max-width:calc(100% - 24px); min-height:60px; padding:6px 6px 6px 20px; border-radius:999px; background:var(--ember); color:var(--on-ember); box-shadow:var(--shadow-lg); transition:transform var(--t-slow, 320ms) var(--ease, ease), opacity var(--t-slow, 320ms) var(--ease, ease); font-size:16px; line-height:1.3}' +
  '.bar.on{transform:translate(-50%,0); opacity:1; pointer-events:auto}' +
  '.bar .t{min-width:0} .bar .t b{font-weight:800} .bar .t span{font-weight:600}' +
  '.bar .acts{display:flex; gap:6px; flex:none}' +
  '.bb{display:inline-flex; align-items:center; justify-content:center; gap:6px; min-height:48px; padding:0 16px; border:0; border-radius:999px; background:color-mix(in srgb, var(--on-ember) 12%, transparent); color:var(--on-ember); font-weight:800; font-size:16px; white-space:nowrap}' +
  '.bb.main{background:var(--on-ember); color:var(--ember)}' +
  '.bb[hidden]{display:none}' +
  '@container pen (max-width:899px){ .bar{top:var(--bar-tp, 8px); left:8px; right:8px; max-width:none; transform:translateY(-140%); border-radius:26px; flex-wrap:wrap; padding:10px 8px 8px 16px} .bar.on{transform:none} .bar .t{flex:1 1 100%; padding-right:8px} .bar .acts{flex:1 1 100%; flex-wrap:wrap} .bar .acts .bb{flex:1 1 auto} }' +
  '.sw{position:absolute; inset:0; pointer-events:none}' +
  '.sw .scrim{position:absolute; inset:0; width:100%; border:0; background:var(--scrim); opacity:0; transition:opacity var(--t-slow, 320ms) var(--ease, ease)}' +
  '.sw.on{pointer-events:auto} .sw.on .scrim{opacity:1}' +
  '.sheet{position:absolute; left:6px; right:6px; bottom:6px; max-height:88%; display:flex; flex-direction:column; background:var(--surface); color:var(--ink); border-radius:32px; padding:10px 18px 16px; transform:translateY(110%); transition:transform var(--t-slow, 320ms) var(--ease, ease); box-shadow:var(--shadow-lg); font-size:16px; line-height:1.5}' +
  '.sw.on .sheet{transform:none}' +
  '@container pen (min-width:700px){ .sheet{left:auto; right:20px; top:20px; bottom:20px; width:460px; max-height:none; transform:translateX(112%)} }' +
  '.handle{width:42px; height:5px; border-radius:3px; background:var(--line-strong); margin:4px auto 10px; flex:none}' +
  '.sh{display:flex; align-items:center; justify-content:space-between; gap:8px; flex:none; margin-bottom:6px}' +
  '.sh h2{margin:0; font-size:24px; line-height:1.15; letter-spacing:-.03em; font-weight:800}' +
  '.x{display:inline-flex; align-items:center; gap:6px; min-height:48px; padding:0 12px; border:0; border-radius:999px; background:transparent; font-weight:700; font-size:16px}' +
  '.x:hover{background:var(--surface-2)}' +
  '.body{flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding:2px 2px 6px}' +
  '.meta{display:flex; flex-wrap:wrap; gap:6px; margin:4px 0 14px}' +
  '.tag{display:inline-flex; align-items:center; gap:6px; min-height:30px; padding:0 11px; border-radius:999px; background:var(--surface-2); font-size:14px; font-weight:700; color:var(--ink); white-space:nowrap}' +
  '.tag svg{color:var(--red)}' +
  '.quote{margin:0 0 16px; padding:14px 16px; border-radius:20px; background:var(--surface-2); box-shadow:inset 3px 0 0 var(--red)}' +
  '.quote small{display:block; font-size:14px; font-weight:700; color:var(--muted); margin-bottom:4px}' +
  '.quote p{margin:0; font-size:16px; font-weight:600; overflow-wrap:anywhere}' +
  '.quote p.none{color:var(--muted); font-weight:600; font-style:italic}' +
  'label{display:block; font-weight:700; font-size:15px; margin:0 0 6px}' +
  'textarea{display:block; width:100%; min-height:132px; padding:14px 16px; border:0; border-radius:16px; background:var(--surface); color:var(--ink); box-shadow:inset 0 0 0 1.5px var(--line-strong); font:inherit; font-size:16px; line-height:1.45; resize:vertical; outline:none}' +
  'textarea:focus{box-shadow:inset 0 0 0 2px var(--red)} textarea:focus-visible{outline:none} textarea[aria-invalid="true"]{box-shadow:inset 0 0 0 2px var(--danger)} textarea::placeholder{color:var(--muted)}' +
  '.err{margin:6px 0 0; font-size:14px; font-weight:700; color:var(--danger)}' +
  '.help{margin:6px 0 0; font-size:14px; color:var(--muted)}' +
  'details{margin-top:16px; border-radius:16px; background:var(--surface-2); padding:0 14px}' +
  'summary{min-height:48px; display:flex; align-items:center; font-weight:700; font-size:15px; cursor:pointer; list-style:none} summary::-webkit-details-marker{display:none}' +
  'summary::after{content:"+"; margin-left:auto; font-weight:800; color:var(--muted)} details[open] summary::after{content:"-"}' +
  'dl{margin:0 0 12px; display:grid; gap:8px} dt{font-size:14px; font-weight:700; color:var(--muted)} dd{margin:0; font-size:15px; font-family:ui-monospace, SFMono-Regular, Menlo, monospace; overflow-wrap:anywhere}' +
  '.foot{display:flex; gap:8px; flex:none; padding-top:12px; margin-top:6px; border-top:1px solid var(--line)}' +
  '.pill{flex:1; display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:56px; padding:0 18px; border:0; border-radius:999px; font-weight:800; font-size:17px; white-space:nowrap; transition:transform var(--t-fast, 120ms) var(--ease, ease)}' +
  '.pill:active{transform:scale(.97)} .pill.red{background:var(--red); color:var(--on-red); flex:1.6} .pill.line{background:transparent; color:var(--ink); box-shadow:inset 0 0 0 1.5px var(--line-strong)}' +
  '.toast{position:absolute; left:50%; bottom:28px; transform:translate(-50%,160%); opacity:0; pointer-events:none; display:flex; align-items:center; gap:10px; min-height:56px; padding:6px 6px 6px 20px; border-radius:999px; background:var(--ink); color:var(--bg); font-weight:700; font-size:16px; box-shadow:var(--shadow-lg); max-width:calc(100% - 24px); width:max-content; transition:transform var(--t-slow, 320ms) var(--ease, ease), opacity var(--t-slow, 320ms) var(--ease, ease)}' +
  '.toast.on{transform:translate(-50%,0); opacity:1; pointer-events:auto}' +
  '.toast svg{color:var(--ok)}' +
  '.toast a{flex:none; min-height:44px; padding:0 16px; border-radius:999px; background:color-mix(in srgb, var(--bg) 18%, transparent); color:inherit; font-weight:800; text-decoration:none; display:inline-flex; align-items:center}' +
  '@container pen (max-width:699px){ .toast{bottom:var(--toast-bp, 96px)} }' +
  '@media (prefers-reduced-motion: reduce){ *{transition-duration:1ms !important} }';
var LAYER_CSS = ':host{all:initial; position:fixed; inset:0; pointer-events:none; z-index:' + (ZTOP - 1) + '}' +
  '.box{position:absolute; left:0; top:0; width:0; height:0; border:2px solid var(--red); border-radius:8px; background:color-mix(in srgb, var(--red) 7%, transparent); box-shadow:0 0 0 4px color-mix(in srgb, var(--red) 16%, transparent); opacity:0; transition:opacity 120ms ease}' +
  '.box.on{opacity:1} .box.picked{border-width:3px; box-shadow:0 0 0 6px color-mix(in srgb, var(--red) 24%, transparent)}' +
  '.box.mark{border-color:var(--red); animation:pulse 1.6s cubic-bezier(.32,.72,0,1) 3}' +
  '@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb, var(--red) 45%, transparent)} 100%{box-shadow:0 0 0 18px transparent}}' +
  '.lab{position:absolute; left:0; top:0; max-width:calc(100vw - 16px); padding:6px 11px; border-radius:999px; background:var(--red); color:var(--on-red); font:700 14px/1.2 var(--font, system-ui, sans-serif); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; box-shadow:0 6px 16px -6px color-mix(in srgb, var(--ink) 50%, transparent); opacity:0}' +
  '.lab.on{opacity:1}' +
  '@media (prefers-reduced-motion: reduce){ .box.mark{animation:none} }';

/* ---------- target layer (one per window/document) ---------- */
function layerOf(win){ var doc = win.document; if (win.__saPenLayer && win.__saPenLayer.host.isConnected) return win.__saPenLayer;
  var host = doc.createElement("sa-pen-layer"); host.setAttribute("aria-hidden", "true");
  var root = host.attachShadow({mode:"open"}); root.innerHTML = '<style>' + LAYER_CSS + '</style><div class="box"></div><div class="lab"></div>';
  (doc.documentElement || doc.body).appendChild(host);
  var L = {host:host, box:root.querySelector(".box"), lab:root.querySelector(".lab"), el:null, win:win};
  L.draw = function(el, label, cls){ L.el = el; if (!el || !el.isConnected){ L.box.classList.remove("on"); L.lab.classList.remove("on"); return; }
    var r = el.getBoundingClientRect(), pad = 3, x = r.left - pad, y = r.top - pad, w = r.width + pad * 2, h = r.height + pad * 2;
    L.box.style.width = w + "px"; L.box.style.height = h + "px"; L.box.style.transform = "translate(" + x + "px," + y + "px)";
    L.box.className = "box on" + (cls ? " " + cls : "");
    if (label != null) L.lab.textContent = label;
    var top0 = Math.max(4, L.avoidY || 0), lw = Math.min(L.lab.offsetWidth || 160, win.innerWidth - 16), ly = y - 34 < top0 ? Math.min(y + h + 6, win.innerHeight - 34) : y - 34, lx = Math.max(8, Math.min(x, win.innerWidth - lw - 8));
    if (y - 34 < top0 && y + h + 40 > win.innerHeight) ly = Math.max(4, y + 6), lx = Math.max(8, Math.min(x + 6, win.innerWidth - lw - 8));
    L.lab.style.transform = "translate(" + lx + "px," + ly + "px)"; L.lab.classList.add("on"); };
  L.clear = function(){ L.el = null; L.box.className = "box"; L.lab.classList.remove("on"); };
  var raf = 0; function re(){ if (raf) return; raf = win.requestAnimationFrame(function(){ raf = 0; if (L.el) L.draw(L.el, null, L.box.className.replace(/^box ?(on)? ?/, "")); }); }
  win.addEventListener("scroll", re, true); win.addEventListener("resize", re);
  win.__saPenLayer = L; return L; }

/* ---------- public: show a stored note on a page (preview) ---------- */
SAPen.show = function(win, selector, text){ var L = layerOf(win), el = null; try{ el = win.document.querySelector(selector); }catch(e){}
  if (!el) { L.clear(); return false; }
  try{ el.scrollIntoView({block:"center", inline:"nearest"}); }catch(e){ el.scrollIntoView(); }
  setTimeout(function(){ L.draw(el, "Бележка: " + clean(text).slice(0, 60), "mark picked"); }, 260); return true; };
SAPen.hide = function(win){ if (win && win.__saPenLayer) win.__saPenLayer.clear(); };
SAPen.selectorFor = selectorFor; SAPen.describe = describe;

/* ---------- mount ---------- */
SAPen.mount = function(o){ o = o || {};
  var REC = !!o.recommend, ui = window, udoc = document, backTo = null, on = false, sheetOpen = false, lastType = "mouse", cand = null, stack = [], saved = 0, tw = null;
  var getTarget = o.target || function(){ return window; };
  var host = udoc.createElement("sa-pen-ui"), root = host.attachShadow({mode:"open"});
  if (o.fabPhone === false) host.setAttribute("data-nofab-phone", "");
  if (o.barTop){ host.style.setProperty("--bar-tp", o.barTop[0] + "px"); host.style.setProperty("--bar-t", o.barTop[1] + "px"); }
  if (o.toastBottom) host.style.setProperty("--toast-bp", o.toastBottom + "px");
  if (o.fabBottom){ host.style.setProperty("--fab-bp", o.fabBottom[0] + "px"); host.style.setProperty("--fab-b", o.fabBottom[1] + "px"); }
  root.innerHTML = '<style>' + UI_CSS + '</style>' +
    (o.fab === false ? '' : '<button class="fab" type="button" aria-pressed="false" data-fab>' + svg("pencil-simple", 22) + '<span>Молив</span></button>') +
    '<div class="bar" role="status" aria-live="polite"><div class="t"></div><div class="acts"><button class="bb main" type="button" data-pick hidden>Бележка за това</button><button class="bb" type="button" data-up hidden>' + svg("caret-up", 18) + 'Разшири</button><button class="bb" type="button" data-down hidden>' + svg("caret-down", 18) + 'Стесни</button><button class="bb" type="button" data-offb>' + svg("x", 18) + 'Изключи</button></div></div>' +
    '<div class="sw"></div><div class="toast" role="status" aria-live="polite"></div>';
  udoc.body.appendChild(host);
  var fab = root.querySelector("[data-fab]"), bar = root.querySelector(".bar"), sw = root.querySelector(".sw"), toastEl = root.querySelector(".toast");
  function val(x){ return typeof x === "function" ? x() : x; }
  function tdoc(){ return tw && tw.document; }

  function barText(){ var touch = lastType === "touch", t;
    if (cand && touch) t = '<b>Оградено:</b> <span>' + esc(describe(cand)) + '. Докоснете пак или „Бележка за това“.</span>';
    else if (touch) t = '<b>' + (REC ? 'Препоръка' : 'Моливът е включен') + '</b> <span>· Докоснете елемент</span>';
    else t = '<b>' + (REC ? 'Препоръка' : 'Моливът е включен') + '</b> <span>· Изберете елемент · Esc за изход</span>';
    if (saved) t += ' <span>· Записани: ' + saved + '</span>';
    bar.querySelector(".t").innerHTML = t;
    bar.querySelector("[data-pick]").hidden = !(cand && (touch || lastType === "key"));
    bar.querySelector("[data-up]").hidden = !cand || !cand.parentElement || cand.parentElement === (tdoc() && tdoc().body);
    bar.querySelector("[data-down]").hidden = !cand || !stack.length; }
  function setCand(el, keepStack){ cand = el; if (!keepStack) stack = []; var L = tw && layerOf(tw); if (!L) return;
    /* the label must not go under the ember bar (same window only; in the frame the bar is outside) */
    L.avoidY = tw === ui && on ? bar.getBoundingClientRect().bottom + 4 : 0;
    if (!el){ L.clear(); barText(); return; } L.draw(el, describe(el) + (el.closest("[data-edit-id]") ? " · " + el.closest("[data-edit-id]").getAttribute("data-edit-id") : ""), lastType === "touch" || lastType === "key" ? "picked" : ""); barText();
    if (lastType === "touch" || lastType === "key") requestAnimationFrame(clearOfBar); }
  /* the bar is drawn over the top of the screen: scroll the outlined element just under it */
  function clearOfBar(){ if (!cand || !cand.isConnected) return; var br = bar.getBoundingClientRect(), r = cand.getBoundingClientRect(), sc = 1, top = r.top;
    if (tw !== ui){ try{ var fr = tw.frameElement.getBoundingClientRect(); sc = fr.width / (tw.innerWidth || fr.width) || 1; top = fr.top + r.top * sc; }catch(x){ return; } }
    var need = (br.bottom + 12 - top) / sc; if (need <= 0) return;
    var p = cand.parentElement; while (p && p !== tw.document.body && p !== tw.document.documentElement){ var cs = tw.getComputedStyle(p); if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight){ p.scrollTop -= need; break; } p = p.parentElement; }
    if (!p || p === tw.document.body || p === tw.document.documentElement) tw.scrollBy(0, -need);
    setTimeout(function(){ if (cand) layerOf(tw).draw(cand, null, "picked"); }, 30); }
  function ours(e){ var p = e.composedPath ? e.composedPath() : []; for (var i = 0; i < p.length; i++){ if (p[i] === host || (p[i] && p[i].tagName && /^SA-PEN-/i.test(p[i].tagName))) return true; } return false; }

  /* --- events on the target window (capture phase, so the page never sees them while the pencil is on) --- */
  var H = {
    pointermove:function(e){ if (!on || sheetOpen || ours(e) || e.pointerType === "touch") return; lastType = e.pointerType || "mouse"; var el = resolve(e.target, tw); if (el !== cand) setCand(el); },
    pointerdown:function(e){ if (!on || ours(e)) return; lastType = e.pointerType || "mouse"; e.stopPropagation(); if (lastType !== "touch") e.preventDefault(); },
    mousedown:function(e){ if (!on || ours(e)) return; e.stopPropagation(); e.preventDefault(); },
    pointerup:function(e){ if (!on || ours(e)) return; e.stopPropagation(); },
    mouseup:function(e){ if (!on || ours(e)) return; e.stopPropagation(); },
    touchstart:function(e){ if (!on || ours(e)) return; lastType = "touch"; e.stopPropagation(); },
    touchend:function(e){ if (!on || ours(e)) return; e.stopPropagation(); },
    dblclick:function(e){ if (!on || ours(e)) return; e.stopPropagation(); e.preventDefault(); },
    auxclick:function(e){ if (!on || ours(e)) return; e.stopPropagation(); e.preventDefault(); },
    submit:function(e){ if (!on || ours(e)) return; e.stopPropagation(); e.preventDefault(); },
    click:function(e){ if (!on || ours(e)) return; e.preventDefault(); e.stopImmediatePropagation(); if (sheetOpen) return;
      var el = resolve(e.target, tw); if (!el) return;
      if (lastType === "touch"){ if (cand && (cand === el || cand.contains(el))) openSheet(); else setCand(el); return; }
      if (el !== cand) setCand(el); openSheet(); },
    pointerleave:function(e){ if (!on || sheetOpen || lastType === "touch") return; if (e.target === tdoc() || e.target === tdoc().documentElement) setCand(null); },
    focusin:function(e){ if (!on || sheetOpen || ours(e) || lastType !== "key") return; var el = resolve(e.target, tw); if (el) setCand(el); },
    keydown:function(e){ if (!on || ours(e)) return; key(e); }
  };
  function key(e){ if (sheetOpen) return;
    if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); off(); return; }
    if (e.key === "Tab"){ lastType = "key"; return; }
    if (!cand) return;
    if (e.key === "ArrowUp"){ e.preventDefault(); e.stopPropagation(); widen(); }
    else if (e.key === "ArrowDown"){ e.preventDefault(); e.stopPropagation(); narrow(); }
    else if (e.key === "Enter"){ e.preventDefault(); e.stopPropagation(); openSheet(); } }
  function widen(){ if (!cand || !cand.parentElement || cand.parentElement === tdoc().body) return; stack.push(cand); setCand(cand.parentElement, true); }
  function narrow(){ if (!stack.length) return; setCand(stack.pop(), true); }
  function attach(win){ if (!win || !win.document) return; tw = win; if (win.__saPenBound) return; win.__saPenBound = true;
    Object.keys(H).forEach(function(k){ win.addEventListener(k, function(e){ if (win === tw) H[k](e); }, {capture:true, passive:k === "touchstart" || k === "touchend" || k === "pointermove"}); }); }
  /* Esc in the admin window too (the frame of the preview may not have focus) */
  ui.addEventListener("keydown", function(e){ if (!on || tw === ui) return; if (e.key === "Escape" && sheetOpen) return; if (!ours(e)) key(e); }, true);

  /* --- sheet --- */
  function openSheet(){ if (!cand) return; var el = cand; sheetOpen = true; backTo = udoc.activeElement; var L = layerOf(tw); L.draw(el, describe(el), "picked");
    var mod = val(o.module) || "admin", url = (o.url ? o.url() : pathOf(tw)), vp = o.viewport ? o.viewport() : {w:tw.innerWidth, h:tw.innerHeight};
    var etxt = textOf(el), edit = el.closest("[data-edit-id]"), sel = selectorFor(el), A = ui.A, mname = A && A.MODULE_NAMES ? A.MODULE_NAMES[mod] || mod : mod;
    var sc = A && A.screenOf ? A.screenOf(url) : null, page = sc ? sc.s.n : url.split("/").pop().split("#")[0];
    sw.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="pen-h">' +
      '<div class="handle"></div><div class="sh"><h2 id="pen-h">' + (REC ? 'Какво да подобрим?' : 'Какво да се промени?') + '</h2><button class="x" type="button" data-x>' + svg("x", 20) + 'Затвори</button></div>' +
      '<div class="body"><div class="meta"><span class="tag">' + svg("squares-four", 16) + esc(mname) + '</span><span class="tag">' + esc(page) + '</span><span class="tag">' + vp.w + ' × ' + vp.h + '</span></div>' +
      '<figure class="quote"><small>' + esc(kindOf(el)) + '</small>' + (etxt ? '<p>„' + esc(etxt.length > 280 ? etxt.slice(0, 278) + " …" : etxt) + '“</p>' : '<p class="none">Елемент без текст</p>') + '</figure>' +
      (REC ? '<p class="help" style="margin:0 0 12px">Препоръката отива при главния админ. Тя не променя нищо, докато той не я одобри.</p>' : '') + '<label for="pen-t">' + (REC ? 'Препоръка' : 'Бележка') + '</label><textarea id="pen-t" placeholder="Например: по-голям текст, друга дума, махнете това" aria-describedby="pen-help"></textarea><p class="err" id="pen-err" hidden>Напишете какво да се промени.</p><p class="help" id="pen-help">Записва се с адреса, елемента и размера на екрана. Ctrl + Enter записва.</p>' +
      '<details><summary>Технически данни</summary><dl><dt>Адрес</dt><dd>' + esc(url) + '</dd><dt>CSS селектор</dt><dd>' + esc(sel) + '</dd><dt>data-edit-id</dt><dd>' + (edit ? esc(edit.getAttribute("data-edit-id")) : "няма") + '</dd></dl></details></div>' +
      '<div class="foot"><button class="pill line" type="button" data-x>Откажи</button><button class="pill red" type="button" data-save>' + svg("check", 22) + (REC ? 'Изпрати препоръката' : 'Запази бележката') + '</button></div></div>';
    var ta = sw.querySelector("textarea"), err = sw.querySelector(".err");
    function close(){ sheetOpen = false; sw.classList.remove("on"); setTimeout(function(){ if (!sheetOpen) sw.innerHTML = ""; }, 340); if (cand && on) setCand(cand, true);
      try{ if (tw !== ui) tw.frameElement.focus(); var el2 = cand; if (el2 && el2.isConnected && (el2.tabIndex >= 0 || /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/.test(el2.tagName))) el2.focus({preventScroll:true}); else if (fab && fab.offsetParent) fab.focus({preventScroll:true}); else if (backTo && backTo.focus) backTo.focus({preventScroll:true}); }catch(x){} }
    function save(){ var text = ta.value.trim(); if (!text){ err.hidden = false; ta.setAttribute("aria-invalid", "true"); ta.setAttribute("aria-describedby", "pen-err pen-help"); ta.focus(); return; }
      var now = (o.now ? o.now() : new Date()).toISOString(), author = val(o.author) || "?";
      var note = {id:rid(), module:mod, url:url, selector:sel, editId:edit ? edit.getAttribute("data-edit-id") : null, text:text.slice(0, 4000), elementText:etxt.slice(0, 500), viewport:{w:Math.round(vp.w), h:Math.round(vp.h)}, screenshot:null, author:author, status:"new", createdAt:now, updatedAt:now};
      if (o.onSave) o.onSave(note); else { try{ var l = JSON.parse(localStorage.getItem("sa-notes") || "[]"); l.unshift(note); localStorage.setItem("sa-notes", JSON.stringify(l)); }catch(x){} }
      saved++; close(); toast(REC ? "Препоръката е изпратена" : "Бележката е записана", o.notesHref ? {label:REC ? "Моите препоръки" : "Виж бележките", href:o.notesHref} : null); barText(); }
    sw.querySelectorAll("[data-x]").forEach(function(b){ b.onclick = close; }); sw.querySelector(".scrim").onclick = close; sw.querySelector("[data-save]").onclick = save;
    ta.addEventListener("input", function(){ if (ta.value.trim()){ err.hidden = true; ta.removeAttribute("aria-invalid"); } });
    sw.addEventListener("keydown", function(e){ if (e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); save(); return; }
      if (e.key === "Tab"){ var f = Array.prototype.slice.call(sw.querySelectorAll("button:not([tabindex]), textarea, summary")), a = f[0], z = f[f.length - 1], act = root.activeElement;
        if (e.shiftKey && act === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && act === z){ e.preventDefault(); a.focus(); } } });
    requestAnimationFrame(function(){ requestAnimationFrame(function(){ sw.classList.add("on"); ta.focus({preventScroll:true}); }); }); }

  var tt; function toast(text, link){ toastEl.innerHTML = svg("check-circle", 22) + '<span>' + esc(text) + '</span>' + (link ? '<a href="' + esc(link.href) + '">' + esc(link.label) + '</a>' : '');
    requestAnimationFrame(function(){ toastEl.classList.add("on"); }); clearTimeout(tt); tt = setTimeout(function(){ toastEl.classList.remove("on"); }, 5200); }

  function pathOf(win){ var p = win.location.pathname, i = p.indexOf("/design/"); if (i > -1) p = p.slice(i + 7); return p + win.location.hash; }
  function setOn(v){ on = !!v; if (on && lastType === "mouse" && ui.matchMedia && ui.matchMedia("(hover: none)").matches) lastType = "touch"; /* телефон: без „Esc за изход“ */ if (fab){ fab.setAttribute("aria-pressed", String(on)); fab.innerHTML = on ? svg("x", 22) + '<span>Изключи</span>' : svg("pencil-simple", 22) + '<span>Молив</span>'; fab.setAttribute("aria-label", on ? "Изключи молива" : "Молив: посочете елемент и напишете какво да се промени"); }
    bar.classList.toggle("on", on); if (on){ attach(getTarget()); barText(); } else { cand = null; stack = []; if (tw && tw.__saPenLayer) tw.__saPenLayer.clear(); }
    o.onToggle && o.onToggle(on); }
  function off(){ setOn(false); }
  root.addEventListener("keydown", function(e){ if (e.key === "Escape" && on && !sheetOpen){ e.preventDefault(); e.stopPropagation(); off(); if (fab && fab.offsetParent) fab.focus(); } });
  root.addEventListener("pointerdown", function(e){ if (e.pointerType) lastType = e.pointerType; }, true);
  if (fab){ fab.addEventListener("click", function(){ setOn(!on); }); fab.setAttribute("aria-label", "Молив: посочете елемент и напишете какво да се промени"); }
  bar.querySelector("[data-offb]").onclick = off;
  bar.querySelector("[data-pick]").onclick = function(){ openSheet(); };
  bar.querySelector("[data-up]").onclick = widen; bar.querySelector("[data-down]").onclick = narrow;
  return {
    toggle:function(){ setOn(!on); }, on:function(){ setOn(true); }, off:off, isOn:function(){ return on; },
    /* the preview calls this after every load of its frame */
    retarget:function(win){ cand = null; stack = []; if (on){ attach(win || getTarget()); barText(); } else tw = win || getTarget(); },
    show:SAPen.show, host:host
  }; };
})();
