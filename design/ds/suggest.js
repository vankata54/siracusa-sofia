/* „Предложи подобрение“ на клиентския сайт (решение на Поли 15.11). Зарежда се от sc.js чак при първото натискане на бутона
   във футъра или в „Още“. Без вход и без лични данни. По желание гостът посочва място на страницата (огражда и избира, като молива).
   Ограничение в прототипа: 3 препоръки на час от едно устройство (localStorage "sc-suggest"), после учтиво кога може пак.
   Записва в localStorage "sa-notes" (бележките на админа) бележка с полетата от src/core/notes.ts и източник „Клиент от сайта“:
   {id, module:"site", url, selector, editId, text, elementText, viewport:{w,h}, screenshot:null, author:"Клиент от сайта",
    source:{type:"client"}, status:"new", createdAt, updatedAt}. В кода: POST /api/notes/suggest с лимит по IP и устройство. */
(function(){
"use strict";
if (window.SCSuggest) return;
var ic = SC.ic, esc = SC.esc, LIMIT = 3, HOUR = 3600e3;
function clean(s){ return String(s || "").replace(/\s+/g, " ").trim(); }
function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function store(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); return true; }catch(e){ return false; } }
function recent(){ var now = Date.now(); return load("sc-suggest", []).filter(function(t){ return now - t < HOUR; }); }
function hm(ms){ try{ return new Intl.DateTimeFormat("bg-BG", {timeZone:"Europe/Sofia", hour:"2-digit", minute:"2-digit", hour12:false}).format(new Date(ms)); }catch(e){ var d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); } }

/* ---------- място на страницата ---------- */
var picked = null; /* {el, selector, editId, text, kind} */
var KIND = {a:"Връзка", button:"Бутон", input:"Поле", textarea:"Поле", select:"Избор", img:"Снимка", h1:"Заглавие", h2:"Заглавие", h3:"Заглавие", p:"Текст", li:"Ред", label:"Етикет", nav:"Навигация", header:"Горна лента", footer:"Долна част", section:"Раздел", article:"Карта", form:"Форма"};
function kindOf(el){ var t = el.tagName.toLowerCase(), c = typeof el.className === "string" ? el.className : ""; if (KIND[t]) return KIND[t]; if (/(^|\s)pic(\s|$)/.test(c)) return "Илюстрация"; if (/(card|core|shell|dcard)/.test(c)) return "Карта"; return "Място"; }
function labelOf(el){ var l = el.id ? document.querySelector('label[for="' + el.id.replace(/"/g, '\\"') + '"]') : null; l = l || el.closest("label");
  return clean(l ? l.textContent : "") || clean(el.getAttribute("aria-label") || el.getAttribute("placeholder") || ""); }
/* никога стойността на поле */
function textOf(el){ var t = el.tagName.toLowerCase(); if (/^(input|textarea|select)$/.test(t)) return labelOf(el); if (t === "img") return clean(el.alt); return clean(el.innerText || el.textContent) || clean(el.getAttribute("aria-label")); }
function cssEsc(s){ return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/([^\w-])/g, "\\$1"); }
var STATE = /^(on|in|rv|rv-on|active|done|bump|open|away|mini|scrolled|warn|sel|cur|show|hide)$/;
function piece(el){ var t = el.tagName.toLowerCase(), hr = t === "a" ? el.getAttribute("href") : null;
  if (hr && hr !== "#" && hr.length < 60 && !/^javascript:/i.test(hr)){ var hs = 'a[href="' + hr.replace(/"/g, '\\"') + '"]'; try{ if (document.querySelectorAll(hs).length === 1) return hs; }catch(e){} }
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id) && !/\d{3,}/.test(el.id)) return "#" + cssEsc(el.id);
  var ed = el.getAttribute("data-edit-id") || el.getAttribute("data-add"); if (ed) return t + "[" + (el.hasAttribute("data-edit-id") ? "data-edit-id" : "data-add") + '="' + ed.replace(/"/g, '\\"') + '"]';
  var cls = (typeof el.className === "string" ? el.className : "").split(/\s+/).filter(function(c){ return c && !STATE.test(c) && /^[A-Za-z_][\w-]*$/.test(c); }).slice(0, 2);
  var b = t + (cls.length ? "." + cls.map(cssEsc).join(".") : ""), p = el.parentElement;
  if (p){ var same = Array.prototype.filter.call(p.children, function(c){ try{ return c.matches(b); }catch(e){ return false; } }); if (same.length > 1){ var tt = Array.prototype.filter.call(p.children, function(c){ return c.tagName === el.tagName; }); b += ":nth-of-type(" + (tt.indexOf(el) + 1) + ")"; } }
  return b; }
function selectorFor(el){ var path = [], cur = el, n = 0;
  while (cur && cur.nodeType === 1 && cur !== document.documentElement && n++ < 12){ path.unshift(piece(cur)); var s = path.join(" > ");
    try{ var l = document.querySelectorAll(s); if (l.length === 1 && l[0] === el) return s; }catch(e){} if (path[0].charAt(0) === "#") break; cur = cur.parentElement; }
  return path.join(" > "); }
function resolve(el){ if (!el || el.nodeType !== 1 || el.closest(".sg-ui, .sheetwrap, .sg-box, .pv-bar")) return null; var s = el.closest("svg"); if (s && s.parentElement) el = s.parentElement;
  var it = el.closest("a[href],button,label,input,select,textarea,[role=button]"); if (it) el = it;
  if (el === document.body || el === document.documentElement || el.matches(".device, .scroller, main")) return null; return el; }

var box = null, bar = null, cand = null, lastTouch = false, pickDone = null;
function draw(el){ if (!box){ box = document.createElement("div"); box.className = "sg-box"; box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:fixed;left:0;top:0;z-index:2147483000;pointer-events:none;border:2px solid var(--red);border-radius:8px;background:color-mix(in srgb, var(--red) 7%, transparent);box-shadow:0 0 0 4px color-mix(in srgb, var(--red) 16%, transparent);transition:opacity 120ms";
    document.body.appendChild(box); }
  if (!el){ box.style.opacity = "0"; return; } var r = el.getBoundingClientRect();
  box.style.opacity = "1"; box.style.width = (r.width + 6) + "px"; box.style.height = (r.height + 6) + "px"; box.style.transform = "translate(" + (r.left - 3) + "px," + (r.top - 3) + "px)"; }
function barHTML(){ var t = lastKey ? '<b>Посочете мястото</b> · Tab до него, Enter избира' + (cand ? ': ' + esc(kindOf(cand)) : '') : cand && lastTouch ? '<b>' + esc(kindOf(cand)) + '</b> · докоснете пак или „Избери това“' : '<b>Посочете мястото</b> на страницата';
  return '<span style="flex:1;min-width:0">' + t + '</span>' + (cand && lastTouch ? '<button class="pill pill-ink" type="button" data-sg="pick">Избери това</button>' : '') + '<button class="pill pill-soft" type="button" data-sg="stop">Откажи</button>'; }
function showBar(){ if (!bar){ bar = document.createElement("div"); bar.className = "sg-ui"; bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483001;display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:min(560px, calc(100% - 24px));padding:8px 8px 8px 18px;border-radius:26px;background:var(--ember);color:var(--on-ember);box-shadow:var(--shadow-lg);font:600 16px/1.35 var(--font);font-feature-settings:\"locl\" 0";
    document.body.appendChild(bar); bar.addEventListener("click", function(e){ var b = e.target.closest("[data-sg]"); if (!b) return; if (b.dataset.sg === "pick" && cand) choose(cand); else stop(null); }); }
  bar.innerHTML = barHTML(); }
function onMove(e){ if (e.pointerType === "touch" || e.target.closest(".sg-ui")) return; lastTouch = false; var el = resolve(e.target); if (el !== cand){ cand = el; draw(el); showBar(); } }
function onDown(e){ if (e.target.closest(".sg-ui")) return; if (e.pointerType) lastTouch = e.pointerType === "touch"; e.stopPropagation(); if (!lastTouch) e.preventDefault(); }
function onClick(e){ if (e.target.closest(".sg-ui")) return; e.preventDefault(); e.stopImmediatePropagation(); var el = resolve(e.target); if (!el) return;
  if (lastTouch && !(cand && (cand === el || cand.contains(el)))){ cand = el; draw(el); showBar(); return; } choose(el); }
function onTouch(e){ if (!e.target.closest(".sg-ui")) lastTouch = true; }
var lastKey = false;
function onKey(e){ if (e.key === "Escape"){ e.preventDefault(); stop(null); return; } if (e.key === "Tab"){ lastKey = true; return; }
  if (e.key === "Enter" && cand && !e.target.closest(".sg-ui")){ e.preventDefault(); e.stopPropagation(); choose(cand); } }
function onFocus(e){ if (!lastKey || e.target.closest(".sg-ui")) return; var el = resolve(e.target); if (el){ cand = el; lastTouch = false; draw(el); showBar(); } }
function startPick(done){ pickDone = done; cand = null; showBar();
  document.addEventListener("pointermove", onMove, true); document.addEventListener("pointerdown", onDown, true); document.addEventListener("mousedown", onDown, true); document.addEventListener("click", onClick, true); document.addEventListener("keydown", onKey, true); document.addEventListener("focusin", onFocus, true); document.addEventListener("touchstart", onTouch, {capture:true, passive:true}); }
function stop(res){ document.removeEventListener("pointermove", onMove, true); document.removeEventListener("pointerdown", onDown, true); document.removeEventListener("mousedown", onDown, true); document.removeEventListener("click", onClick, true); document.removeEventListener("keydown", onKey, true); document.removeEventListener("focusin", onFocus, true); lastKey = false; document.removeEventListener("touchstart", onTouch, {capture:true});
  if (bar){ bar.remove(); bar = null; } draw(null); var d = pickDone; pickDone = null; d && d(res); }
function choose(el){ var ed = el.closest("[data-edit-id]"); stop({selector:selectorFor(el), editId:ed ? ed.getAttribute("data-edit-id") : null, text:textOf(el).slice(0, 500), kind:kindOf(el)}); }

/* ---------- the sheet ---------- */
var draft = "";
function viewport(){ var d = document.documentElement.classList.contains("pv-phone") && SC.device ? SC.device : null; return d ? {w:d.clientWidth, h:d.clientHeight} : {w:window.innerWidth, h:window.innerHeight}; }
/* лични данни: мобилен и стационарен телефон, имейл (и написан с думи) */
function personal(t){ var x = " " + t + " ";
  return /[\w.+-]+@[\w-]+\.[\w.]+/.test(x) || /(\+?359|\b0)[\s-]?8\d([\s-]?\d){7}/.test(x) || /(\+?359|\b0)[\s-]?[2-9]\d{0,2}([\s\/-]?\d){5,7}\b/.test(x) ||
    /[\w.-]{2,}\s*(\(?\s*(at|ат|маймунка|кльомба)\s*\)?)\s*[\w-]{2,}\s*(\.|dot|точка)\s*[a-zа-я]{2,}/i.test(x); }
function urlOf(){ var p = location.pathname, i = p.indexOf("/design/"); if (i > -1) p = p.slice(i + 7); return p + location.hash; }
var opener = null, noBack = false;
/* капан на фокуса в листа и връщане на фокуса на бутона, от който е отворен */
function trap(w){ w.addEventListener("keydown", function(e){ if (e.key !== "Tab") return; var f = Array.prototype.filter.call(w.querySelectorAll(".sheet button:not([disabled]), .sheet a[href], .sheet textarea, .sheet input"), function(el){ return el.offsetParent !== null; });
  if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } }); }
function back(){ var o = opener; setTimeout(function(){ if (pickDone) return; if (o && o.isConnected && o.offsetParent !== null) o.focus({preventScroll:true}); else { var b = document.querySelector(".foot [data-suggest]"); b && b.focus({preventScroll:true}); } }, 360); }
function open(){ var a = document.activeElement; opener = a && a.hasAttribute && a.hasAttribute("data-suggest") ? a : opener; document.querySelectorAll(".sheetwrap.on [data-close]").forEach(function(b){ b.click(); });
  setTimeout(sheet, document.querySelector(".sheetwrap") ? 360 : 0); }
function sheet(){ var r = recent();
  if (r.length >= LIMIT){ var next = Math.min.apply(null, r) + HOUR;
    var s0 = SC.sheet({title:"Предложи подобрение", onClose:back, html:'<div class="empty" style="padding:16px 4px"><div class="ill">' + ic("check-circle", 40) + '</div><h3 class="h3">Благодарим за препоръките!</h3><p class="muted" style="margin:0">За последния час изпратихте ' + LIMIT + '. Може да изпратите нова след ' + hm(next) + '.</p></div>'}); s0.el.style.zIndex = "85"; trap(s0.el); return; }
  var s = SC.sheet({title:"Предложи подобрение", onClose:function(){ if (!noBack) back(); noBack = false; }, html:
    '<form class="stack" data-sgform novalidate style="gap:14px;padding-bottom:4px">' +
      '<p class="muted" style="margin:0">Кажете ни какво да е по-удобно или по-ясно на тази страница. Без вход.</p>' +
      '<div class="field"><label for="sg-t">Какво да подобрим?</label><textarea class="input" id="sg-t" rows="4" required aria-describedby="sg-h" placeholder="Например: бутонът е твърде малък"></textarea>' +
        '<p class="err" id="sg-e" hidden></p><p class="help" id="sg-h">Без име, телефон и имейл: препоръката е анонимна.</p></div>' +
      '<div data-place>' + placeHTML() + '</div>' +
      '<button class="pill pill-red pill-lg pill-block" type="submit">' + ic("paper-plane-right", 22) + 'Изпрати препоръката</button>' +
      '<p class="muted small" style="margin:0;text-align:center">До ' + LIMIT + ' препоръки на час от едно устройство.</p></form>'});
  s.el.style.zIndex = "85"; /* над банера за бисквитки */
  trap(s.el);
  var f = s.el.querySelector("[data-sgform]"), ta = f.querySelector("#sg-t"), er = f.querySelector("#sg-e");
  ta.value = draft; setTimeout(function(){ ta.focus({preventScroll:true}); }, 360);
  ta.addEventListener("input", function(){ draft = ta.value; er.hidden = true; ta.removeAttribute("aria-invalid"); });
  f.addEventListener("click", function(e){ var b = e.target.closest("[data-sgp]"); if (!b) return; e.preventDefault();
    if (b.dataset.sgp === "clear"){ picked = null; f.querySelector("[data-place]").innerHTML = placeHTML(); return; }
    draft = ta.value; noBack = true; s.close(); setTimeout(function(){ startPick(function(res){ if (res) picked = res; sheet(); }); }, 360); });
  f.addEventListener("submit", function(e){ e.preventDefault(); var t = ta.value.trim();
    function bad(m){ er.textContent = m; er.hidden = false; ta.setAttribute("aria-invalid", "true"); ta.setAttribute("aria-describedby", "sg-e sg-h"); ta.focus(); }
    if (!t) return bad("Напишете какво да подобрим.");
    if (personal(t)) return bad("Моля, без телефон и имейл: препоръката е анонимна.");
    var now = new Date().toISOString(), vp = viewport(), note = {id:Math.random().toString(36).slice(2, 6) + Date.now().toString(36).slice(-4), module:"site", url:urlOf(),
      selector:picked ? picked.selector : "", editId:picked ? picked.editId : null, text:t.slice(0, 4000), elementText:picked ? picked.text : "", viewport:vp, screenshot:null,
      author:"Клиент от сайта", source:{type:"client"}, status:"new", createdAt:now, updatedAt:now};
    var l = load("sa-notes", null); if (!Array.isArray(l)) l = []; l.unshift(note); store("sa-notes", l);
    var r2 = recent(); r2.push(Date.now()); store("sc-suggest", r2);
    draft = ""; picked = null; s.close(); SC.toast("Благодарим! Препоръката е изпратена."); }); }
function placeHTML(){ return picked
  ? '<div class="kv" style="align-items:center;padding:10px 14px;border-radius:18px;background:var(--surface-2)"><span><b>Място:</b> ' + esc(picked.kind) + (picked.text ? ' „' + esc(picked.text.slice(0, 40)) + (picked.text.length > 40 ? ' …' : '') + '“' : '') + '</span><button class="link" type="button" data-sgp="clear">Махни</button></div>'
  : '<button class="pill pill-line pill-block" type="button" data-sgp="pick">' + ic("map-pin", 20) + 'Посочи място на страницата</button><p class="help" style="margin:6px 0 0;font-size:14px;color:var(--muted)">По желание: докоснете мястото, за което пишете.</p>'; }

window.SCSuggest = {open:open};
})();
