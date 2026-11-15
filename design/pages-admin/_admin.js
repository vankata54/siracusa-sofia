/* Siracusa · Админ: обща рамка на прототипа. Зарежда се след ../ds/icons.js, ../data/menu.js, ../ds/sc.js (без SC.mount)
   и преди _pencil.js и скрипта на страницата.
   - A.mount(opts) рисува лявата лента, горната лента, долната лента (телефон), панела „Само в прототипа“ и връща елемента за съдържание.
   - Сесия в прототипа: localStorage "sa-session" {user, name, role}. Без сесия страницата води към login.html.
   - Данни: localStorage с префикс "sa-" (A.data), общи за всички екрани. Менюто и цените са от SC.items.
   - Правата: ролите и разделите са от src/core/staff.ts (DEFAULT_ROLES, SECTIONS); главният админ вижда всичко.
   Параметри на страниците само през # (st=<състояние> и каквото страницата реши). Подробно: README.md, „Рамка за авторите 2 и 3“. */
(function(){
"use strict";
var A = window.A = {};
var ic = SC.ic, esc = SC.esc;
A.ic = ic; A.esc = esc; A.fmt = SC.fmt;
/* inside the frame of preview.html: the pencil belongs to the preview, not to the framed page */
A.inPreview = (function(){ try{ return window.parent !== window && !!window.parent.A_PREVIEW; }catch(e){ return false; } })();

/* ---------- storage: всичко с префикс sa- ---------- */
var P = "sa-";
function clone(v){ return v == null ? v : JSON.parse(JSON.stringify(v)); }
function get(k, d){ try{ var v = localStorage.getItem(P + k); return v == null ? clone(d) : JSON.parse(v); }catch(e){ return clone(d); } }
function set(k, v){ try{ localStorage.setItem(P + k, JSON.stringify(v)); return true; }catch(e){ return false; } }
function del(k){ try{ localStorage.removeItem(P + k); }catch(e){} }
A.data = {
  get:get, set:set, del:del,
  /* A.data.update("notes", [], function(list){ list.unshift(x); }) -> записва и връща новата стойност */
  update:function(k, d, fn){ var v = get(k, d), r = fn(v); r = r === undefined ? v : r; set(k, r); return r; },
  keys:function(){ var out = []; try{ for (var i = 0; i < localStorage.length; i++){ var k = localStorage.key(i); if (k && k.indexOf(P) === 0) out.push(k.slice(P.length)); } }catch(e){} return out; },
  /* „Върни данните в начало“: трие всички sa- ключове без сесията и настройките на изгледа */
  reset:function(){ A.data.keys().forEach(function(k){ if (k !== "session" && k !== "prefs") del(k); }); try{ sessionStorage.removeItem("sa-clock"); }catch(e){} }
};

/* ---------- hash ---------- */
A.hash = {};
(location.hash.slice(1) || "").split("&").forEach(function(p){ if (!p) return; var i = p.indexOf("="); if (i < 0) A.hash[decodeURIComponent(p)] = ""; else A.hash[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
A.st = A.hash.st || "";
A.setHash = function(obj, replace){ var h = Object.keys(obj).filter(function(k){ return obj[k] !== "" && obj[k] != null; }).map(function(k){ return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&");
  A.hash = obj; A.liveHash = true; if (replace !== false) history.replaceState(null, "", location.pathname + (h ? "#" + h : "")); else location.hash = h; };
/* страниците, които сами следят #, слагат A.liveHash = true; иначе смяна на # презарежда (като в другите модули) */
window.addEventListener("hashchange", function(){ if (!A.liveHash) location.reload(); });

/* ---------- time & formats (София). Часът на прототипа: A.now() ---------- */
A.DAYS = ["нд","пн","вт","ср","чт","пт","сб"];
function sofiaParts(d){
  try{ var f = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/Sofia", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", weekday:"short", hour12:false}).formatToParts(d), o = {};
    f.forEach(function(p){ o[p.type] = p.value; });
    return {y:+o.year, mo:+o.month - 1, d:+o.day, h:+o.hour % 24, m:+o.minute, dow:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(o.weekday)}; }
  catch(e){ return {y:d.getFullYear(), mo:d.getMonth(), d:d.getDate(), h:d.getHours(), m:d.getMinutes(), dow:d.getDay()}; } }
/* A.now(): истинската дата в София, но в часа на прототипа (по подразбиране 19:42, вечерен пик като в кухнята).
   Сменя се от панела „Само в прототипа“ (12:30 · 19:42 · 21:30 · 23:30) и стои в sa-prefs.time. Часовникът тече от зареждането. */
A.TIMES = ["12:30","19:42","21:30","23:30"];
var _pref0 = get("prefs", {});
A.protoTime = A.TIMES.indexOf(_pref0.time) > -1 ? _pref0.time : "19:42";
/* отместването се пази за сесията (sessionStorage): часът тече от първото зареждане, не започва отначало на всяка страница */
var OFFSET = (function(){ var k = "sa-clock", c = null; try{ c = JSON.parse(sessionStorage.getItem(k) || "null"); }catch(e){}
  if (c && c.time === A.protoTime && typeof c.offset === "number" && Math.abs(c.offset) < 864e5) return c.offset;
  var r = sofiaParts(new Date()), t = A.protoTime.split(":"), off = ((+t[0]) * 60 + (+t[1]) - (r.h * 60 + r.m)) * 60000 - new Date().getSeconds() * 1000;
  try{ sessionStorage.setItem(k, JSON.stringify({time:A.protoTime, offset:off})); }catch(e){} return off; })();
A.now = function(){ return new Date(Date.now() + OFFSET); };
A.sofia = function(d){ return sofiaParts(d || A.now()); };
A.todayKey = function(d){ var s = A.sofia(d); return s.y + "-" + String(s.mo + 1).padStart(2, "0") + "-" + String(s.d).padStart(2, "0"); };
A.minutes = function(){ var s = A.sofia(); return s.h * 60 + s.m; };
A.hm = function(d){ var s = A.sofia(d instanceof Date ? d : new Date(d)); return String(s.h).padStart(2, "0") + ":" + String(s.m).padStart(2, "0"); };
/* „сб, 28 ноември“; short: „сб, 28 ное“ */
A.fmtDate = function(d, short){ var s = A.sofia(d instanceof Date ? d : new Date(d)); return A.DAYS[s.dow] + ", " + s.d + " " + (short ? SC.MON[s.mo] : SC.MONTHS[s.mo]); };
/* кога: „току-що“, „преди 5 мин“, „преди 1 ч. 40 мин“ (до 24 ч.), „вчера в 18:40“, „сб, 7 ноември в 12:10“ */
A.ago = function(iso){ var d = new Date(iso), diff = Math.round((A.now().getTime() - d.getTime()) / 60000);
  if (diff < 1) return "току-що"; if (diff < 60) return "преди " + diff + " мин";
  if (diff < 1440){ var h = Math.floor(diff / 60), m = diff % 60; return "преди " + h + " ч." + (m ? " " + m + " мин" : ""); }
  var a = A.sofia(d), b = A.sofia(), dd = Math.round((Date.UTC(b.y, b.mo, b.d) - Date.UTC(a.y, a.mo, a.d)) / 864e5);
  if (dd === 1) return "вчера в " + A.hm(d); return A.fmtDate(d) + " в " + A.hm(d); };
/* статусът на ресторанта по часа на прототипа (същите граници като SC.status): [клас, HTML] */
A.status = function(){ var m = A.minutes();
  if (m < 600) return ["", "<b>Затворено</b> · отваряме в 10:00"]; if (m >= 1380) return ["", "<b>Затворено</b> · отваряме утре в 10:00"];
  if (m < 1260) return ["ok", "<b>Отворено до 23:00</b> · Доставка до 21:00"]; if (m < 1350) return ["warn", "<b>Доставката приключи за днес</b> · Вземане до 22:30"];
  return ["warn", "<b>Кухнята затвори</b> · Отворено до 23:00"]; };
A.setProtoTime = function(t){ var p = get("prefs", {}); p.time = t; set("prefs", p); del("orders"); del("reservations"); try{ sessionStorage.removeItem("sa-clock"); }catch(e){} };
A.plural = SC.plural;

/* ---------- sections (имената са от src/core/staff.ts, SECTIONS) ---------- */
/* [ключ, име, кратко (за лентата с икони), икона, файл, описание] ; "settings" го няма в SECTIONS (искане към шефа в README) */
var SEC = [
  ["dashboard","Табло","Табло","squares-four","dashboard.html","Всички модули на системата на едно място и какво става днес."],
  ["orders","Поръчки","Поръчки","receipt","orders.html","Поръчките на живо по статус и канал, смяна на статус, детайл."],
  ["reservations","Резервации","Резервации","calendar-check","reservations.html","Деня по часове, маси, брой хора, поводи, неявили се, чакащи."],
  ["menu","Меню","Меню","fork-knife","menu.html","Ястия, цени в евро, етикети, алергени, „Изчерпано днес“."],
  ["lunch","Обедно меню","Обедно","bowl-food","lunch.html","Седмичен график пн-пт, ПИН за персонала, публикуване."],
  ["offers","Оферти и ваучери","Оферти","seal-percent","offers.html","Оферти с правила по час, ден, канал и ястие; кодове и ваучери."],
  ["events","Събития","Събития","confetti","events.html","Предстоящи и минали събития, ново събитие, преглед в сайта."],
  ["zones","Зони за доставка","Зони","map-trifold","zones.html","Кварталите, такси, минимална поръчка, време, часове до 21:00."],
  ["hall","Залата и масите","Залата","chair","hall.html","План на Салон и Градина, места, обединяване и блокиране на маси."],
  ["qr","QR генератор","QR","qr-code","qr.html","Етикети с QR код за всяка маса, готови за печат."],
  ["customers","Клиенти","Клиенти","users","customers.html","Профили, поръчки, съгласия, обратна връзка; данни и изтриване."],
  ["staff","Персонал","Персонал","users-three","staff.html","Потребители, роли, пароли и ПИН за персонала."],
  ["roles","Роли и права","Роли","shield-check","roles.html","Кой какво вижда: роли по раздели, промените влизат в дневника."],
  ["reports","Отчети","Отчети","chart-bar","reports.html","Поръчки, оборот, среден бон, канали, часове, топ ястия."],
  ["finance","Финанси и гориво","Финанси","wallet","","Разходи, гориво по шофьор и автомобил, сравнение на периоди. За собственика."],
  ["audit","Дневник","Дневник","list-bullets","audit.html","Кой, кога, какво: вход, роли, меню, обедно, бележки."],
  ["notes","Бележки (молив)","Бележки","pencil-simple","notes.html","Бележките от молива: нови, в работа, готови. Следващата сесия ги изпълнява."],
  ["site","Клиентски сайт","Сайт","globe","dashboard.html#modules","Всички модули на живо в рамка на телефон, таблет и компютър."],
  ["settings","Настройки","Настройки","sliders-horizontal","settings.html","„Натоварено“ и минутите, задържане на маса, празник, часове."],
  ["waiter","Сервитьор","Сервитьор","bell-ringing","../pages-servitor/login.html","Приложението на сервитьора."],
  ["kitchen","Кухня","Кухня","chef-hat","../pages-kuhnya/login.html","Екранът на кухнята."],
  ["driver","Шофьор","Шофьор","moped","../pages-shofyor/login.html","Приложението на шофьора."]
];
A.SEC = {}; SEC.forEach(function(s){ A.SEC[s[0]] = {id:s[0], n:s[1], short:s[2], ic:s[3], href:s[4], desc:s[5], soon:s[0] === "finance"}; });
A.GROUPS = [
  ["Днес", ["dashboard","orders","reservations"]],
  ["Меню", ["menu","lunch"]],
  ["Продажби", ["offers","events","zones"]],
  ["Залата", ["hall","qr"]],
  ["Хора", ["customers","staff","roles"]],
  ["Анализ", ["reports","finance","audit"]],
  ["Работа по сайта", ["notes","site","settings"]]
];
A.APPS = ["waiter","kitchen","driver"]; /* приложенията на персонала (в матрицата на правата; в лентата като връзка) */
A.groupOf = function(id){ var g = A.GROUPS.filter(function(x){ return x[1].indexOf(id) > -1; })[0]; return g ? g[0] : (A.APPS.indexOf(id) > -1 ? "Приложения" : ""); };

/* ---------- roles (DEFAULT_ROLES от src/core/staff.ts) ---------- */
var ALL = ["dashboard","notes","menu","lunch","zones","offers","events","reservations","hall","qr","orders","customers","reports","finance","staff","roles","audit","waiter","kitchen","driver","site"];
A.ALL = ALL.concat(["settings"]);
A.DEFAULT_ROLES = [
  {id:"admin", n:"Главен админ", desc:"Всичко; прави директни промени по сайта. Агенцията, която държи и ролята Маркетинг.", sections:A.ALL.slice()},
  {id:"owner", n:"Собственик", desc:"Всичко, включително финанси, гориво и отчети.", sections:A.ALL.filter(function(s){ return s !== "roles"; })},
  {id:"manager", n:"Управител", desc:"Почти всичко като собственика: меню, цени, промоции, събития, резервации, персонал, отчети.", sections:A.ALL.filter(function(s){ return ["roles","finance","audit"].indexOf(s) < 0; })},
  {id:"waiter", n:"Сервитьор", desc:"Повиквания, статус на масите, въвеждане на поръчки, потвърждаване на QR поръчки, сметки.", sections:["dashboard","waiter","orders","reservations"]},
  {id:"kitchen", n:"Кухня", desc:"Кухненски екран на своята секция с опашката от поръчки.", sections:["dashboard","kitchen"]},
  {id:"driver", n:"Шофьор", desc:"Своите доставки, навигация, статуси, зареждане с гориво, избор на автомобил.", sections:["dashboard","driver"]},
  {id:"marketing", n:"Маркетинг", desc:"Събития, поводи, оферти, снимки, текстове, SEO полета.", sections:["dashboard","notes","offers","events","site"]}
];
A.roles = function(){ var st = get("roles", {}); return A.DEFAULT_ROLES.map(function(d){ var r = clone(d); if (d.id !== "admin" && st[d.id]) r.sections = st[d.id].filter(function(s){ return A.ALL.indexOf(s) > -1; }); return r; }); };
A.role = function(id){ return A.roles().filter(function(r){ return r.id === id; })[0] || null; };
/* setRoles({manager:[...], ...}) пази само разликите; главният админ не се променя */
A.setRoles = function(map){ var st = {}; Object.keys(map).forEach(function(k){ if (k !== "admin") st[k] = map[k].slice(); }); set("roles", st); };

/* ---------- session (само в прототипа) ---------- */
A.PASSWORD = "demo-demo-1"; /* само в прототипа; в кода паролите са от .env и хеширани в базата */
A.ACCOUNTS = [
  ["admin","admin","Поли"], ["owner","owner","Собственик 1"], ["manager","manager","Управител 1"], ["waiter","waiter","Сервитьор 1"],
  ["kitchen","kitchen","Кухня · Скара"], ["driver","driver","Шофьор 1"], ["marketing","marketing","Маркетинг 1"]
]; /* [потребител, роля, име] */
A.session = function(){ var s = get("session", null); return s && s.role && A.role(s.role) ? s : null; };
A.me = A.session();
A.login = function(user){ var a = A.ACCOUNTS.filter(function(x){ return x[0] === user; })[0]; if (!a) return null;
  var s = {user:a[0], name:a[2], role:a[1]}; set("session", s); A.me = s; return s; };
A.logout = function(){ if (A.me) A.audit("staff.logout", "Изход"); del("session"); location.href = "login.html"; };
A.viewAs = function(role){ var a = A.ACCOUNTS.filter(function(x){ return x[1] === role; })[0]; if (a) A.login(a[0]); location.reload(); };
A.roleName = function(id){ var r = A.role(id); return r ? r.n : id; };
A.who = function(){ return A.me ? A.me.name + " (" + A.roleName(A.me.role) + ")" : "?"; };
/* A.can("menu") -> може ли влязлата роля да вижда раздела. Главният админ: винаги. */
/* вход според ролята (решение 15.11): сервитьор, кухня и шофьор работят в своя модул на цял екран, без админа */
A.STAFF_HOME = {waiter:"../pages-servitor/tables.html", kitchen:"../pages-kuhnya/queue.html#s=skara", driver:"../pages-shofyor/list.html"};
A.isStaffApp = function(role){ role = role || (A.me && A.me.role); return !!A.STAFF_HOME[role]; };
A.homeOf = function(role){ return A.STAFF_HOME[role] || "dashboard.html"; };
A.can = function(section, role){ role = role || (A.me && A.me.role); if (!role) return false; if (role === "admin") return true; var r = A.role(role); return !!r && r.sections.indexOf(section) > -1; };

/* ---------- audit (дневник) ---------- */
/* A.audit("menu.price", "Цена на „Кебапчета“: 3,50 € → 3,80 €", "kebapcheta") ; ключовете като в ядрото: staff.login, role.update, note.status ... */
A.audit = function(action, text, target){ var e = {id:Math.random().toString(36).slice(2, 10), at:A.now().toISOString(), who:A.me ? A.me.name : "?", role:A.me ? A.me.role : "", action:action, text:text || action, target:target || null};
  A.data.update("audit", [], function(l){ l.unshift(e); if (l.length > 500) l.length = 500; }); return e; };

/* ---------- prefs (тема, свита лента) ---------- */
A.prefs = get("prefs", {theme:"system", side:"open"});
A.savePrefs = function(){ set("prefs", A.prefs); };
A.applyTheme = function(){ var de = document.documentElement; if (A.prefs.theme === "light" || A.prefs.theme === "dark") de.dataset.theme = A.prefs.theme; else delete de.dataset.theme; };
A.applyTheme();
var THEMES = [["system","Авто","circles-three"],["light","Светла","sun"],["dark","Тъмна","moon"]];

/* ---------- notes (бележките от молива: полетата са като в src/core/notes.ts) ---------- */
A.MODULE_NAMES = {site:"Клиентски сайт", masa:"QR маса", waiter:"Сервитьор", servitor:"Сервитьор", watch:"Часовник", kitchen:"Кухня", kuhnya:"Кухня", driver:"Шофьор", shofyor:"Шофьор", admin:"Админ"};
/* статуси (решение на Поли 15.11): нова → одобрена → в изпълнение → за преглед → публикувана, или отхвърлена (с причина) */
A.NOTE_STATUSES = [["new","Нови","Нова"],["approved","Одобрени","Одобрена"],["doing","В изпълнение","В изпълнение"],["review","За преглед","За преглед"],["published","Публикувани","Публикувана"],["rejected","Отхвърлени","Отхвърлена"]];
A.noteStatusName = function(st){ var x = A.NOTE_STATUSES.filter(function(s){ return s[0] === st; })[0]; return x ? x[2] : st; };
/* източникът: роля и потребител или „Клиент от сайта“ (поле source; старите бележки без него: по автора) */
A.noteSource = function(n){ var s = n.source; if (s && s.type === "client") return {key:"client", label:"Клиент от сайта"};
  if (s && s.role) return {key:s.role, label:A.roleName(s.role) + (s.user ? " · " + s.user : ""), user:s.user};
  return {key:"admin", label:"Главен админ"}; };
A.isMainAdmin = function(){ return !!A.me && A.me.role === "admin"; };
A.notes = {
  /* примерните бележки се добавят веднъж (флаг sa-notes-seeded), така че препоръка от сайта или от молива не ги изтрива */
  list:function(){ var l = get("notes", null); if (!get("notes-seeded", false)){ var seeds = A.SEED_NOTES(), have = {}; (l || []).forEach(function(n){ have[n.id] = 1; });
      l = (l || []).concat(seeds.filter(function(n){ return !have[n.id]; })); set("notes", l); set("notes-seeded", true); } return l || []; },
  save:function(l){ set("notes", l); },
  add:function(n){ var l = A.notes.list(); l.unshift(n); A.notes.save(l); return n; },
  get:function(id){ return A.notes.list().filter(function(x){ return x.id === id; })[0] || null; },
  /* смяна на статус; extra: {reason, change, publishedAt ...}. Пише история {status, at, who} */
  status:function(id, st, extra){ var l = A.notes.list(), n = l.filter(function(x){ return x.id === id; })[0]; if (!n) return null; var was = n.status, at = A.now().toISOString();
    n.status = st; n.updatedAt = at; Object.keys(extra || {}).forEach(function(k){ n[k] = extra[k]; });
    (n.history = n.history || []).push({status:st, at:at, who:A.me ? A.me.name : "?"}); A.notes.save(l); return was; },
  /* „Отмени“: връща цялата бележка отпреди промяната */
  put:function(note){ var l = A.notes.list(); for (var i = 0; i < l.length; i++){ if (l[i].id === note.id){ l[i] = note; break; } } A.notes.save(l); },
  isSample:function(n){ return A.SAMPLE_NOTE_IDS.indexOf(n.id) > -1; },
  /* износът (като GET /api/admin/notes?status=approved): одобрените от главния админ, без примерните, най-старата първа (по реда на одобрение) */
  exportApproved:function(){ return A.notes.list().filter(function(n){ return n.status === "approved" && !A.notes.isSample(n); }).sort(function(a, b){ return a.updatedAt < b.updatedAt ? -1 : 1; }); },
  remove:function(id){ var l = A.notes.list(), i = -1; l.forEach(function(x, j){ if (x.id === id) i = j; }); if (i < 0) return null; var g = l.splice(i, 1)[0]; A.notes.save(l); return {note:g, index:i}; },
  restore:function(r){ var l = A.notes.list(); l.splice(Math.min(r.index, l.length), 0, r.note); A.notes.save(l); },
  mine:function(){ return A.notes.list().filter(function(n){ return n.source && n.source.user && A.me && n.source.user === A.me.user; }); },
  count:function(st){ return A.notes.list().filter(function(n){ return !st || n.status === st; }).length; }
};
/* примерни бележки: по една във всеки статус, с различни източници (етикет „Примерна“); „Върни данните в начало“ ги връща */
A.SAMPLE_NOTE_IDS = ["n7k2q9a1","n3m8x2b4","n5c1v7d3","n9p4r6e8","n2h6t1f5","n6r3j8k2"];
A.SEED_NOTES = function(){ var t = A.now().getTime(), iso = function(min){ return new Date(t - min * 60000).toISOString(); };
  function N(id, mod, url, sel, txt, el, w, h, st, min, upd, src, author, x){ var n = {id:id, module:mod, url:url, selector:sel, editId:null, text:txt, elementText:el, viewport:{w:w, h:h}, screenshot:null, author:author, source:src, status:st, createdAt:iso(min), updatedAt:iso(upd == null ? min : upd)};
    Object.keys(x || {}).forEach(function(k){ n[k] = x[k]; }); return n; }
  var CL = {type:"client"};
  return [
    N("n7k2q9a1","site","/pages/home.html","#hero-h","Заглавието да е на два реда на телефон.","Пица на пещ и скара на дървени въглища",390,844,"new",12,null,CL,"Клиент от сайта"),
    N("n3m8x2b4","kitchen","/pages-kuhnya/queue.html#s=skara","button[aria-label=\"Готово, Маса 12. Задръжте 1 секунда\"]","Бутонът „Готово“ да е по-високо, до таймера.","Готово задръжте 1 сек.",1180,820,"approved",48,20,{type:"staff", role:"kitchen", user:"kitchen"},"Кухня · Скара (Кухня)"),
    N("n5c1v7d3","admin","/pages-admin/dashboard.html","a.kpi:nth-of-type(4)","Броят на изчерпаните да води направо към менюто с филтър.","Изчерпани днес 1 Плескавица",1440,900,"doing",95,3,{type:"staff", role:"admin", user:"admin"},"Поли (Главен админ)"),
    N("n9p4r6e8","waiter","/pages-servitor/tables.html","div.tt > b","Заглавието на екрана да е по-голямо.","Залата",390,844,"review",60*26,60*3,{type:"staff", role:"waiter", user:"waiter"},"Сервитьор 1 (Сервитьор)",
      {change:{summary:"Заглавието на екрана е 24px вместо 17px.", before:"Залата (17px, на един ред с името на сервитьора)", after:"Залата (24px, името на сервитьора на втори ред)"}}),
    N("n2h6t1f5","site","/pages/menu.html","#mh1","Под заглавието да има ред с часовете на кухнята.","Меню",1440,900,"published",60*50,60*30,{type:"staff", role:"owner", user:"owner"},"Собственик 1 (Собственик)",
      {change:{summary:"Под „Меню“ е добавен редът „Кухнята приема до 22:30“.", before:"Меню", after:"Меню · Кухнята приема до 22:30"}, publishedAt:iso(60*30), publishedBy:"Поли"}),
    N("n6r3j8k2","site","/pages/offers.html","#main h1","Да има отстъпка за отзив в Google.","Оферти",390,844,"rejected",60*30,60*28,{type:"staff", role:"marketing", user:"marketing"},"Маркетинг 1 (Маркетинг)",
      {reason:"Без отстъпка срещу отзив в Google (правилата на Google и решението на собственика)."})
  ]; };

/* ---------- modules (за таблото и прегледа; екраните са от index.html на всеки модул) ---------- */
function S(k, n, f){ return {k:k, n:n, f:f}; }
A.MODULES = [
  {id:"site", n:"Клиентски сайт", ic:"globe", what:"Сайтът за гостите: меню, поръчка, резервация, събития, оферти.", who:"Гости", dev:"phone", sec:"site", dir:"../pages/", time:true, screens:[
    S("home","Начало","home.html"), S("menu","Меню","menu.html"), S("category","Категория: Пици на пещ","category.html#pitsi"), S("dish","Ястие","dish.html#pitsa-s-burata-i-proshuto-krudo"),
    S("lunch","Обедно меню","lunch.html"), S("cart","Количка и поръчка","cart.html"), S("tracking","Проследяване","tracking.html"), S("office","Обща поръчка за офиса","office.html"),
    S("reservation","Резервирай маса","reservation.html"), S("events","Събития и поводи","events.html"), S("event","Събитие: Гръцка вечер","event.html#gratska-vecher"), S("celebration","Празник при нас","celebration.html"),
    S("offers","Оферти","offers.html"), S("login","Вход","login.html"), S("profile","Профил","profile.html"), S("delivery","Доставка","delivery.html"), S("pickup","Вземи от място","pickup.html"),
    S("bertha","Фурната Bertha","bertha.html"), S("about","За нас","about.html"), S("gallery","Галерия","gallery.html"), S("contacts","Контакти","contacts.html"), S("allergens","Алергени","allergens.html"), S("404","404","404.html")]},
  {id:"masa", n:"QR маса", ic:"qr-code", what:"Менюто и поръчката от масата, повикване на сервитьор, сметката.", who:"Гости в салона и градината", dev:"phone", sec:"site", dir:"../pages-masa/", screens:[
    S("welcome","Добре дошли","welcome.html"), S("menu","Меню на масата","menu.html"), S("cart","Обща количка","cart.html"), S("call","Повикай сервитьор","call.html"), S("bill","Сметката","bill.html")], states:[
    S("cart-waiting","Чака потвърждение","cart.html#demo=waiting"), S("cart-cooking","Статус на ястията","cart.html#demo=cooking"), S("call-called","Сервитьорът идва","call.html#demo=called"),
    S("call-manager","Известие до управителя","call.html#demo=manager"), S("bill-rated","Оценка „Не“","bill.html#demo=rated"), S("bill-closed","Сметката е платена","bill.html#demo=closed"),
    S("welcome-closed","Сесията е затворена","welcome.html#demo=closed"), S("welcome-invalid","Невалиден QR код","welcome.html#demo=invalid"), S("menu-kitchen","Кухнята затвори","menu.html#demo=kitchen"),
    S("cart-offline","Няма интернет","cart.html#demo=offline"), S("cart-rejected","Сервитьорът отказа","cart.html#demo=rejected")]},
  {id:"waiter", n:"Сервитьор", ic:"bell-ringing", what:"Повиквания, масите, нови поръчки, сметки.", who:"Сервитьорите", dev:"phone", sec:"waiter", dir:"../pages-servitor/", screens:[
    S("login","Вход и смяна","login.html"), S("tables","Залата","tables.html"), S("calls","Повиквания","calls.html"), S("table","Маса 12","table.html#12"), S("table-qr","Маса с QR поръчка","table.html#3"),
    S("order","Нова поръчка","order.html#12"), S("ready","Готови","ready.html")], states:[
    S("calls-rush","Много повиквания","calls.html#s=rush"), S("calls-empty","Празна опашка","calls.html#s=empty"), S("tables-offline","Няма връзка","tables.html#s=offline"), S("order-search","Търсене „pitsa“","order.html#12&q=pitsa")]},
  {id:"watch", n:"Часовник", ic:"clock", what:"Повикване и готово ястие на китката на сервитьора.", who:"Сервитьорите", dev:"phone", sec:"waiter", dir:"../pages-servitor/", screens:[S("watch","Смарт часовник","watch.html")]},
  {id:"kitchen", n:"Кухня", ic:"chef-hat", what:"Опашката на всяка секция, изчерпано днес, натоварено.", who:"Готвачите", dev:"tablet", land:true, sec:"kitchen", dir:"../pages-kuhnya/", screens:[
    S("login","Вход","login.html"), S("queue","Опашка","queue.html#s=skara"), S("item-out","Изчерпано днес","item-out.html#s=skara"), S("busy","Натоварено +20 мин","busy.html#s=skara"),
    S("done","Изпълнени","done.html#s=skara"), S("summary","Общ изглед","summary.html#s=all")], states:[
    S("queue-new","Нова поръчка","queue.html#s=skara&st=new"), S("queue-many","Много поръчки","queue.html#s=skara&st=many"), S("queue-empty","Празна опашка","queue.html#s=skara&st=empty"), S("queue-offline","Няма връзка","queue.html#s=skara&st=offline"), S("busy-on","Натоварено: включено","busy.html#s=skara&st=on")]},
  {id:"driver", n:"Шофьор", ic:"moped", what:"Доставките, маршрут, гориво, край на смяната.", who:"Шофьорите", dev:"phone", sec:"driver", dir:"../pages-shofyor/", screens:[
    S("login","Вход и начало на смяната","login.html"), S("list","Моите доставки","list.html"), S("delivery","Една доставка","delivery.html#1042"), S("route","Маршрут","route.html"), S("fuel","Гориво","fuel.html"), S("shift","Край на смяната","shift.html")], states:[
    S("list-empty","Няма доставки","list.html#s=empty"), S("list-offline","Няма връзка","list.html#s=offline"), S("delivery-call","Обаждане до клиента","delivery.html#1042&call"),
    S("delivery-outzone","Извън зоните","delivery.html#1046&s=outzone"), S("delivery-road","Закъснява","delivery.html#1042&s=road"), S("list-moving","В движение","list.html#s=moving")]},
  {id:"manager", n:"Управител", ic:"briefcase", soon:true, what:"Смяната на живо: зала, кухня, доставки, закъснения и известия към управителя.", who:"Управителя", roles:["owner","manager"]},
  {id:"owner", n:"Собственик", ic:"chart-bar", soon:true, what:"Оборот и отчети, финанси и гориво, сравнение на периоди.", who:"Собственика", roles:["owner"]},
  {id:"admin", n:"Админ", ic:"shield-check", what:"Този панел: разделите, ролите и правата, моливът за бележки.", who:"Агенцията, собственика, управителя", dev:"desktop", roles:["owner","manager","marketing"], dir:"../pages-admin/", screens:[
    S("dashboard","Табло","dashboard.html"), S("notes","Бележки","notes.html"), S("roles","Роли и права","roles.html"), S("login","Вход","login.html"),
    S("menu","Меню","menu.html"), S("lunch","Обедно меню","lunch.html"), S("zones","Зони за доставка","zones.html"), S("offers","Оферти и ваучери","offers.html"), S("events","Събития","events.html"), S("orders","Поръчки","orders.html"),
    S("reservations","Резервации","reservations.html"), S("hall","Залата и масите","hall.html"), S("qr","QR генератор","qr.html"), S("customers","Клиенти","customers.html"), S("reports","Отчети","reports.html"),
    S("staff","Персонал","staff.html"), S("audit","Дневник","audit.html"), S("settings","Настройки","settings.html")]}
];
A.MOD = {}; A.MODULES.forEach(function(m){ A.MOD[m.id] = m; });
/* модулите пишат бележки с module "servitor" / "kuhnya" / "shofyor" (_pen-mount.js) */
A.MOD.servitor = A.MOD.waiter; A.MOD.kuhnya = A.MOD.kitchen; A.MOD.shofyor = A.MOD.driver;
/* кой вижда плочката на модула: по раздела му, а Управител, Собственик и Админ по роля */
A.modCan = function(m){ if (!A.me) return false; if (m.roles) return A.me.role === "admin" || m.roles.indexOf(A.me.role) > -1; return A.can(m.sec); };
/* модул и екран по адрес (за бележките): "/pages-kuhnya/queue.html#s=skara" -> {m, s} */
A.screenOf = function(url){ url = String(url || ""); var best = null;
  A.MODULES.forEach(function(m){ if (!m.dir) return; var dir = m.dir.replace("../", "/"); if (url.indexOf(dir) !== 0) return;
    var rest = url.slice(dir.length); (m.screens || []).concat(m.states || []).forEach(function(s){ var f = s.f.split("#")[0];
      if (rest === s.f && (!best || best.exact !== true)) best = {m:m, s:s, exact:true};
      else if (rest.split("#")[0] === f && !best) best = {m:m, s:s}; }); });
  if (best && best.m.id === "waiter" && /watch\.html/.test(url)) best = {m:A.MOD.watch, s:A.MOD.watch.screens[0]};
  return best; };

/* ---------- small UI helpers (HTML низове) ---------- */
A.sample = function(t){ return '<span class="sa-tag sample">' + ic("info", 16) + (t || "Примерни данни") + '</span>'; };
A.missing = function(t){ return '<span class="missing">[ЛИПСВА: ' + esc(t) + ']</span>'; };
A.soonTag = function(){ return '<span class="sa-tag soon">' + ic("sparkle", 16) + 'Скоро</span>'; };
/* A.empty({icon, title, text, action:'<a class="pill pill-red" ...>'}) */
A.empty = function(o){ return '<div class="sa-empty"><div class="ill">' + ic(o.icon || "check-circle", 44) + '</div><h3>' + esc(o.title) + '</h3>' + (o.text ? '<p>' + o.text + '</p>' : '') + (o.action || '') + '</div>'; };
/* скелет: aria-hidden + скрит role=status (решение 13.11) */
A.skel = function(n, label){ var h = ''; for (var i = 0; i < (n || 4); i++) h += '<div class="skel"></div>'; return '<div class="sa-skel"><span class="vh" role="status">' + esc(label || "Зареждаме …") + '</span><div class="sa-skel" aria-hidden="true"><div class="skel s"></div>' + h + '</div></div>'; };
/* банер: tone = "ember" (нова поръчка) | "warn" | "danger" | "ok" | "" */
A.banner = function(o){ return '<div class="sa-banner ' + (o.tone || '') + '" role="' + (o.tone === "danger" || o.tone === "warn" ? "alert" : "status") + '">' + ic(o.icon || "info", 26) + '<div class="tx">' + (o.title ? '<b>' + esc(o.title) + '</b>' : '') + (o.text || '') + '</div>' + (o.action || '') + '</div>'; };
A.offline = function(text){ return A.banner({tone:"warn", icon:"warning-circle", title:"Няма връзка с интернет", text:esc(text || "Показваме последно зареденото. Проверете връзката и опитайте пак."), action:'<button class="pill pill-line" type="button" data-sa="retry">' + ic("arrow-clockwise", 20) + 'Опитай пак</button>'}); };
A.error = function(text){ return A.banner({tone:"danger", icon:"warning", title:"Не успяхме да заредим данните", text:esc(text || "Опитайте пак след малко. Ако не стане, кажете на главния админ."), action:'<button class="pill pill-line" type="button" data-sa="retry">' + ic("arrow-clockwise", 20) + 'Опитай пак</button>'}); };
A.noRightsHTML = function(section){ var s = A.SEC[section];
  return '<section class="sa-noperm sa-card" data-edit-id="admin.noperm"><div class="ill">' + ic("lock", 44) + '</div><h1>Нямате права за този раздел.</h1><p>Ролята „' + esc(A.roleName(A.me.role)) + '“ не вижда „' + esc(s ? s.n : section) + '“. Ако ви трябва, помолете главния админ.</p><a class="pill pill-ink pill-lg" href="dashboard.html">' + ic("squares-four", 22) + 'Към таблото</a></section>'; };
A.initials = function(name){ var p = String(name || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/); return (p[0] ? p[0][0] : "?").toUpperCase(); };

/* ---------- toast (едно известие; новото заменя старото) ---------- */
/* A.toast("Бележката е изтрита", {undo:fn, undoLabel:"Отмени", action:{label, href} | {label, fn}, ms}) */
var toastT;
/* известието е винаги над лентата „Запази“ / „Публикувай“, и когато лентата се появи след него */
/* известието стои над видимата лента „Запази“, колкото и висока да е тя (на 390 може да е на два реда) */
function toastUp(){ var col = A.col || document.body, t = col.querySelector(".sa-toast"); if (!t) return; var bar = document.querySelector(".sa-pbar.on, .rl-bar.on, [data-pbar].on, .st-savebar.on, .hl-savebar.on");
  t.classList.toggle("up", !!bar);
  /* от разположението (bottom + височина), не от getBoundingClientRect: лентата влиза с transform и по време на анимацията е още долу */
  if (bar){ var cs = getComputedStyle(bar), bb = parseFloat(cs.bottom); t.style.bottom = (cs.position === "fixed" || isNaN(bb) ? Math.max(28, Math.round(col.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + 12)) : Math.round(bb + bar.offsetHeight + 12)) + "px"; } else t.style.bottom = ""; }
window.addEventListener("resize", function(){ toastUp(); });
/* която и страница да покаже или скрие своята лента (.on), известието се мести само: един наблюдател за всички екрани */
var toastRaf = 0;
try{ new MutationObserver(function(){ if (toastRaf) return; toastRaf = requestAnimationFrame(function(){ toastRaf = 0; toastUp(); }); }).observe(document.documentElement, {subtree:true, attributes:true, attributeFilter:["class"]}); }catch(e){}
A.toastUp = toastUp;
A.toast = function(text, o){ o = o || {}; var col = A.col || document.body, t = col.querySelector(".sa-toast");
  if (!t){ t = document.createElement("div"); t.className = "sa-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); col.appendChild(t); }
  t.innerHTML = '<span class="tx">' + esc(text) + '</span>' + (o.action ? (o.action.href ? '<a href="' + esc(o.action.href) + '">' + esc(o.action.label) + ic("caret-right", 18) + '</a>' : '<button type="button" data-ta>' + esc(o.action.label) + '</button>') : '') + (o.undo ? '<button type="button" data-tu>' + ic("arrow-counter-clockwise", 18) + esc(o.undoLabel || "Отмени") + '</button>' : '');
  var u = t.querySelector("[data-tu]"); if (u) u.onclick = function(){ t.classList.remove("on"); o.undo(); };
  var a = t.querySelector("[data-ta]"); if (a) a.onclick = function(){ t.classList.remove("on"); o.action.fn(); };
  toastUp();
  requestAnimationFrame(function(){ t.classList.add("on"); }); clearTimeout(toastT);
  toastT = setTimeout(function(){ t.classList.remove("on"); }, o.ms || (o.undo ? 6000 : 3200)); };

/* ---------- sheet (листът от sc.css: отдолу на телефон, вдясно от 900px) ---------- */
/* A.sheet({title, html, foot, onClose}) -> {el, body, foot, close} */
A.sheet = function(o){ var ov = A.ov || document.body, w = document.createElement("div"), id = "sa" + Math.random().toString(36).slice(2, 8); w.className = "sheetwrap";
  w.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle"></div><div class="sheet-h"><h2 id="' + id + '">' + esc(o.title || "") + '</h2><button class="hb" type="button" data-close>' + ic("x", 20) + 'Затвори</button></div><div class="body">' + (o.html || "") + '</div>' + (o.foot ? '<div class="sa-sfoot">' + o.foot + '</div>' : '') + '</div>';
  ov.appendChild(w); var penHost = document.querySelector("sa-pen-ui"); penHost && penHost.setAttribute("data-sheet", ""); /* hide the round „Молив“ while a sheet is open */
  var prev = document.activeElement, bg = [A.side, A.col && A.col.querySelector(".sa-scroller"), A.col && A.col.querySelector(".sa-top"), A.bnav].filter(Boolean);
  bg.forEach(function(el){ el.inert = true; });
  w.addEventListener("keydown", function(e){ if (e.key !== "Tab") return; var f = Array.prototype.filter.call(w.querySelectorAll(".sheet button:not([disabled]), .sheet a[href], .sheet input:not([disabled]), .sheet textarea, .sheet select"), function(el){ return el.offsetParent !== null; });
    if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } });
  var closed = false;
  function close(){ if (closed) return; closed = true; if (document.querySelectorAll(".sa-ov .sheetwrap.on").length <= 1){ bg.forEach(function(el){ el.inert = false; }); penHost && penHost.removeAttribute("data-sheet"); } w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 340); o.onClose && o.onClose(); prev && prev.focus && prev.focus({preventScroll:true}); }
  w.querySelector(".scrim").onclick = close; w.querySelector("[data-close]").onclick = close;
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); var f = o.focus ? w.querySelector(o.focus) : w.querySelector(".sheet-h h2"); if (f && !o.focus) f.setAttribute("tabindex", "-1"); f && f.focus({preventScroll:true}); }); });
  return {el:w, body:w.querySelector(".body"), foot:w.querySelector(".sa-sfoot"), close:close}; };
/* A.confirm({title, text, ok:"Изтрий", danger:true}, onOk) */
A.confirm = function(o, onOk){ var s = A.sheet({title:o.title, html:'<p style="margin:0 0 8px">' + (o.text || "") + '</p>',
  foot:'<button class="pill pill-line pill-lg" type="button" data-no>Откажи</button><button class="pill ' + (o.danger ? 'pill-red' : 'pill-ink') + ' pill-lg" type="button" data-yes>' + (o.icon ? ic(o.icon, 22) : '') + esc(o.ok || "Да") + '</button>'});
  s.foot.querySelector("[data-no]").onclick = s.close; s.foot.querySelector("[data-yes]").onclick = function(){ s.close(); onOk && onOk(); }; return s; };

/* ---------- download ---------- */
A.download = function(name, text, type){ try{ var b = new Blob([text], {type:type || "application/json"}), u = URL.createObjectURL(b), a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(u); a.remove(); }, 400); return true; }catch(e){ return false; } };

/* ---------- section search (кирилица или латиница) ---------- */
var TR = {"а":"a","б":"b","в":"v","г":"g","д":"d","е":"e","ж":"zh","з":"z","и":"i","й":"y","к":"k","л":"l","м":"m","н":"n","о":"o","п":"p","р":"r","с":"s","т":"t","у":"u","ф":"f","х":"h","ц":"ts","ч":"ch","ш":"sh","щ":"sht","ъ":"a","ь":"y","ю":"yu","я":"ya"};
function norm(s){ return String(s).toLowerCase().split("").map(function(c){ return TR[c] != null ? TR[c] : c; }).join("").replace(/sht/g,"st").replace(/zh/g,"z").replace(/ch/g,"c").replace(/sh/g,"s").replace(/ts/g,"c").replace(/yu/g,"u").replace(/ya/g,"a").replace(/[yj]/g,"i").replace(/w/g,"v").replace(/q/g,"k").replace(/x/g,"ks").replace(/[^a-z0-9 ]/g," ").replace(/([a-z])\1+/g,"$1").replace(/\s+/g," ").trim(); }
A.norm = norm;
A.visibleSections = function(){ var out = []; A.GROUPS.forEach(function(g){ g[1].forEach(function(id){ if (A.can(id)) out.push(A.SEC[id]); }); }); return out; };
A.searchSections = function(q){ var n = norm(q); if (!n) return []; return A.visibleSections().filter(function(s){ var k = norm(s.n + " " + s.short + " " + s.desc + " " + A.groupOf(s.id)); return n.split(" ").every(function(p){ return k.indexOf(p) > -1; }); })
  .sort(function(a, b){ return (norm(b.n).indexOf(n) === 0) - (norm(a.n).indexOf(n) === 0); }); };

/* ---------- badges in the bars ---------- */
/* ---------- общите данни (един източник за таблото, значките и разделите) ---------- */
/* Примерните данни идват от _seed-orders.js и _seed-res.js (A.seed.*), заредени след _admin.js. Рамката работи и без тях. */
function seeded(key, fn){ if (get(key, null) == null && A.seed && typeof A.seed[fn] === "function"){ try{ A.seed[fn](); }catch(e){} } return get(key, null); }
function listOf(d){ return Array.isArray(d) ? d : d && (d.list || d.items || d.orders || d.reservations) || []; }
A.FIN = ["delivered","picked_up","served"];
A.orders = function(){ return listOf(seeded("orders", "orders")); };
A.ordersInWork = function(){ return A.orders().filter(function(o){ return A.FIN.indexOf(o.status) < 0 && o.status !== "cancelled"; }); };
A.reservations = function(){ return listOf(seeded("reservations", "reservations")); };
/* резервации днес, без отказаните и чакащите (като в reservations.html) */
A.reservationsToday = function(){ var t = A.todayKey(); return A.reservations().filter(function(r){ return r.date === t && ["cancelled","waitlist"].indexOf(r.status) < 0; }); };
A.settings = function(){ var s = seeded("settings", "settings") || {}; s.kitchen = Object.assign({busy:false, etaMin:35, etaBusyMin:55}, s.kitchen || {}); return s; };
/* „Изчерпано днес“ по едно правило (като menu.html): sa-soldout {date, ids, back}; back = изчерпано в данните, върнато за днес */
A.soldOutToday = function(){ var d = get("soldout", null); if (!d || d.date !== A.todayKey()) d = {ids:[], back:[]}; var back = d.back || [], out = (d.ids || []).slice();
  SC.items.concat(SC.lunch || []).forEach(function(x){ if (SC.isOut(x) && back.indexOf(x.id) < 0 && out.indexOf(x.id) < 0) out.push(x.id); });
  return out.filter(function(id){ return !!SC.byId[id]; }); };
A.tables = function(){ var d = get("tables", null); return d && d.tables ? d.tables : SC.TABLES; };
A.activeTables = function(){ return A.tables().filter(function(t){ return !t.off; }); };
/* телефон: „0888 12 34 56“ и скрит „0888 •• •• 56“ (общите помощници, не в примерните данни) */
A.fmtPhone = function(p){ var d = String(p || "").replace(/\D/g, ""); if (d.indexOf("359") === 0) d = "0" + d.slice(3); return d.length === 10 ? d.slice(0, 4) + " " + d.slice(4, 6) + " " + d.slice(6, 8) + " " + d.slice(8) : String(p || ""); };
A.maskPhone = function(p){ var f = A.fmtPhone(p); return f.length === 13 ? f.slice(0, 4) + " •• •• " + f.slice(11) : f; };

A.badges = {};
/* броят на всеки раздел, сметнат на всяка страница от общите ключове */
A.computeBadges = function(){ var b = A.badges;
  /* главният админ: нови и за преглед (чакат него); другите с „Бележки“: нови */
  b.notes = !A.can("notes") ? 0 : A.notes.count("new") + (A.isMainAdmin() ? A.notes.count("review") : 0);
  A.badgeTitles = {notes:A.isMainAdmin() ? A.plural(A.notes.count("new"), "нова", "нови") + ", " + A.notes.count("review") + " за преглед" : ""};
  b.orders = A.orders().filter(function(o){ return o.status === "accepted"; }).length;
  b.customers = listOf(get("feedback", [])).filter(function(f){ return f.status === "new"; }).length;
  b.offers = listOf(get("feedback-iq", [])).filter(function(q){ return q.st === "new" || q.status === "new"; }).length;
  b.reservations = A.reservations().filter(function(r){ return r.date === A.todayKey() && r.status === "new"; }).length;
  return b; };
A.setBadge = function(id, n){ A.badges[id] = n; document.querySelectorAll('[data-badge="' + id + '"]').forEach(function(el){ el.textContent = n; el.hidden = !n; }); };
function badge(id){ var n = A.badges[id], t = (A.badgeTitles || {})[id]; return '<span class="sa-n" data-badge="' + id + '"' + (n ? '' : ' hidden') + (t ? ' title="' + esc(t) + '"' : '') + ' aria-hidden="true">' + (n || 0) + '</span>'; }

/* ---------- chrome ---------- */
function sideHTML(cur){
  return '<a class="sa-brand" href="dashboard.html" aria-label="Siracusa · Админ, към таблото"><span class="word">Siracusa</span><span class="sa-btag">Админ</span></a>' +
    '<nav class="sa-nav" aria-label="Раздели">' + A.GROUPS.map(function(g){ var items = g[1].filter(function(id){ return A.can(id) || (id === "notes" && A.me); }); if (!items.length) return "";
      return '<div class="sa-g"><h2>' + esc(g[0]) + '</h2>' + items.map(function(id){ var s = A.SEC[id];
        if (id === "notes" && !A.can("notes")) s = {id:"notes", n:"Моите препоръки", short:"Препоръки", ic:"pencil-simple", href:"notes.html"};
        var inner = ic(s.ic, 22) + '<span class="lb">' + esc(s.n) + '</span><span class="sh">' + esc(s.short) + '</span>' + (s.soon ? '<span class="soon sa-tag soon">' + ic("sparkle", 14) + 'Скоро</span>' : badge(id));
        if (s.soon) return '<button class="sa-i" type="button" data-sa="soon" data-id="' + id + '" title="' + esc(s.n) + ': скоро">' + inner + '</button>';
        return '<a class="sa-i" href="' + s.href + '"' + (cur === id ? ' aria-current="page"' : '') + ' title="' + esc(s.n) + '">' + inner + '</a>'; }).join("") + '</div>'; }).join("") +
      (A.APPS.some(function(id){ return A.can(id) && A.me.role !== "admin" && A.me.role !== "owner" && A.me.role !== "manager"; }) ? '<div class="sa-g"><h2>Приложение</h2>' + A.APPS.filter(function(id){ return A.can(id); }).map(function(id){ var s = A.SEC[id];
        return '<a class="sa-i" href="' + s.href + '" title="' + esc(s.n) + '">' + ic(s.ic, 22) + '<span class="lb">' + esc(s.n) + ': приложението</span><span class="sh">' + esc(s.short) + '</span></a>'; }).join("") + '</div>' : '') + '</nav>' +
    '<div class="sa-sidefoot"><button class="sa-i sa-collapse" type="button" data-sa="side" aria-expanded="' + (A.prefs.side !== "mini") + '">' + ic(A.prefs.side === "mini" ? "caret-right" : "caret-left", 22) + '<span class="lb">Свий лентата</span><span class="sh">Разгъни</span></button></div>'; }
function topHTML(o){ var s = A.SEC[o.section], g = A.groupOf(o.section), th = THEMES.filter(function(t){ return t[0] === A.prefs.theme; })[0] || THEMES[0], pen = !!A.me && (o.pencil !== false || o.penButton) && !A.inPreview;
  return '<header class="sa-top">' + (A.isStaffApp() ? '<a class="sa-tb" href="' + A.homeOf(A.me.role) + '">' + ic("caret-left", 20) + '<span class="lg">Към приложението</span><span class="sm">Приложение</span></a>' : '') +
    '<div class="sa-crumb"><small class="sa-only-td">' + esc(o.crumb || g || "Админ") + '</small><b>' + esc(o.barTitle || (s && s.n) || o.title || "") + '</b></div>' +
    '<div class="sa-search sa-only-d" role="search"><label class="vh" for="sa-q">Търсене: раздели, ястия, поръчки, резервации</label>' + ic("magnifying-glass", 20) + '<input id="sa-q" type="search" placeholder="Търси навсякъде" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="sa-sres" aria-expanded="false"><span class="k" aria-hidden="true">/</span><button class="sa-clear" type="button" aria-label="Изчисти" hidden>' + ic("x", 18) + '</button><div class="sa-sres" id="sa-sres" role="listbox" aria-label="Резултати" hidden></div></div>' +
    '<button class="sa-tb sa-only-t" type="button" data-sa="sections">' + ic("magnifying-glass", 20) + 'Търси</button>' +
    (pen ? '<button class="sa-tb" type="button" data-sa="pen" aria-pressed="false">' + ic("pencil-simple", 20) + 'Молив</button>' : '') +
    '<button class="sa-tb sa-only-d" type="button" data-sa="theme" aria-label="Тема: ' + th[1] + '. Смени">' + ic(th[2], 20) + 'Тема: ' + th[1] + '</button>' +
    
    '<button class="sa-me" type="button" data-sa="profile" aria-label="Профил: ' + esc(A.me.name) + ', ' + esc(A.roleName(A.me.role)) + '"><span class="sa-av" aria-hidden="true">' + esc(A.initials(A.me.name)) + '</span><span class="who sa-only-d"><b>' + esc(A.me.name) + '</b><small>' + esc(A.roleName(A.me.role)) + '</small></span></button>' +
    '<button class="sa-tb sa-only-d" type="button" data-sa="logout">' + ic("sign-out", 20) + 'Изход</button>' +
  '</header>'; }
function bnavHTML(cur){ var items = [["dashboard","Табло","squares-four","dashboard.html"],["orders","Поръчки","receipt","orders.html"],["notes",A.can("notes") ? "Бележки" : "Препоръки","pencil-simple","notes.html"]].filter(function(x){ return A.can(x[0]) || (x[0] === "notes" && A.me); });
  return '<nav class="sa-bnav" aria-label="Основни раздели">' + items.map(function(x){ return '<a href="' + x[3] + '"' + (cur === x[0] ? ' aria-current="page"' : '') + '>' + ic(x[2], 24) + x[1] + badge(x[0]) + '</a>'; }).join("") +
    '<button type="button" data-sa="sections"' + (["dashboard","orders","notes"].indexOf(cur) < 0 ? ' aria-current="page"' : '') + '>' + ic("list", 24) + 'Раздели</button></nav>'; }
function protoHTML(o){ var role = A.me ? A.me.role : "";
  return '<section class="sa-proto" aria-label="Само в прототипа" data-edit-id="admin.proto"><h2>' + ic("sliders-horizontal", 20) + 'Само в прототипа</h2>' +
    (o.states && o.states.length ? '<p>Състояние на екрана:</p><div class="row">' + o.states.map(function(s){ var h = Object.assign({}, A.hash, {st:s[0]});
      return '<a class="chip" href="#' + Object.keys(h).filter(function(k){ return h[k]; }).map(function(k){ return k + "=" + encodeURIComponent(h[k]); }).join("&") + '" data-sa="state" aria-pressed="' + (A.st === s[0]) + '" style="text-decoration:none">' + esc(s[1]) + '</a>'; }).join("") + '</div>' : '') +
    '<p>Час на прототипа (днешната дата; смяната пресъздава примерните поръчки и резервации):</p><div class="row">' + A.TIMES.map(function(t){ return '<button class="chip" type="button" data-sa="ptime" data-v="' + t + '" aria-pressed="' + (A.protoTime === t) + '">' + t + '</button>'; }).join("") + '</div>' +
    '<p>Виж като (сменя ролята на влезлия, за да се види какво вижда всяка роля):</p><div class="row">' + A.DEFAULT_ROLES.map(function(r){ return '<button class="chip" type="button" data-sa="viewas" data-v="' + r.id + '" aria-pressed="' + (role === r.id) + '">' + esc(r.n) + '</button>'; }).join("") + '</div>' +
    '<p>Пробни акаунти: <code>admin</code>, <code>owner</code>, <code>manager</code>, <code>waiter</code>, <code>kitchen</code>, <code>driver</code>, <code>marketing</code>, всички с парола <code>' + A.PASSWORD + '</code>. Само в прототипа; истинските пароли са в <code>.env</code> и не са в git.</p>' +
    '<div class="row"><button class="chip" type="button" data-sa="reset">' + ic("arrow-counter-clockwise", 18) + 'Върни данните в начало</button><a class="chip" href="index.html" style="text-decoration:none">' + ic("list", 18) + 'Всички екрани</a></div>' +
    (o.protoExtra || '') + '</section>'; }

/* A.mount(opts) -> елементът за съдържанието (под заглавието) или null, ако ролята няма права.
   opts: {section, title, sub, eyebrow, crumb, actions (HTML), states:[[st, "Име"]], wide, head:false, pencil:false, public:true, immersive:true, protoExtra} */
A.mount = function(o){ o = o || {};
  if (!A.me && !o.public){ location.replace("login.html#next=" + encodeURIComponent(location.pathname.split("/").pop() + location.hash)); return null; }
  /* служител на адрес на админа: в своя модул; само „Моите препоръки“ остава тук, на цял екран, без лентата */
  var staff = !!A.me && A.isStaffApp() && !o.public;
  if (staff && o.section !== "notes"){ location.replace(A.homeOf(A.me.role)); return null; }
  document.title = (o.docTitle || o.title || (A.SEC[o.section] && A.SEC[o.section].n) || "Админ") + " | Siracusa · Админ";
  A.computeBadges();
  var app = document.createElement("div"); app.className = "sa-app" + (o.immersive ? " immersive" : "") + (staff ? " staffmode" : ""); app.dataset.side = o.immersive ? "mini" : (A.prefs.side === "mini" ? "mini" : "open"); app.dataset.page = o.section || "";
  var allowed = !o.section || A.can(o.section) || o.anyRole;
  var s = A.SEC[o.section] || {};
  var head = o.head === false ? '' : '<div class="sa-head" data-edit-id="admin.' + (o.section || "page") + '.head"><div>' + (o.eyebrow !== false ? '<span class="sa-eye">' + ic(s.ic || "squares-four", 18) + esc(o.eyebrow || A.groupOf(o.section) || "Админ") + '</span>' : '') + '<h1 class="sa-h1">' + esc(o.title || s.n || "") + '</h1>' + (o.sub ? '<p class="sa-sub">' + o.sub + '</p>' : '') + '</div>' + (o.actions ? '<div class="sa-acts">' + o.actions + '</div>' : '') + '</div>';
  app.innerHTML = '<aside class="sa-side" aria-label="Лента с разделите">' + sideHTML(o.section) + '</aside>' +
    '<div class="sa-col">' + topHTML(o) + '<div class="sa-scroller" data-scroller><main id="main" class="sa-page' + (o.wide ? ' wide' : '') + '">' + (allowed ? head + '<div data-body></div>' : A.noRightsHTML(o.section)) + protoHTML(o) + '<div class="sa-end"></div></main></div></div>' +
    bnavHTML(o.section) + '<div class="sa-ov"></div>';
  document.body.appendChild(app);
  A.app = app; A.side = app.querySelector(".sa-side"); A.col = app.querySelector(".sa-col"); A.scroller = app.querySelector(".sa-scroller"); A.ov = app.querySelector(".sa-ov"); A.bnav = app.querySelector(".sa-bnav");
  bindSearch(); watchTabs();
  try{ new MutationObserver(toastUp).observe(A.col, {subtree:true, attributes:true, attributeFilter:["class"]}); }catch(e){}
  if (window.SAPen && A.me && o.pencil !== false && !A.inPreview) A.pen = A.mountPen({module:"admin"});
  return allowed ? app.querySelector("[data-body]") : null; };
/* табовете, които не се събират: избледняване на ръба и избраният таб се вижда целият */
function fadeTabs(){ document.querySelectorAll(".sa-tabs").forEach(function(t){ var max = t.scrollWidth - t.clientWidth; t.classList.toggle("fl", max > 2 && t.scrollLeft > 2); t.classList.toggle("fr", max > 2 && t.scrollLeft < max - 2);
  if (!t._sa){ t._sa = 1; t.addEventListener("scroll", fadeTabs, {passive:true}); var cur = t.querySelector('[aria-selected="true"],[aria-pressed="true"],[aria-current="page"]'); if (cur && max > 2) t.scrollLeft = Math.max(0, cur.offsetLeft - t.offsetLeft - 24); } }); }
A.fadeTabs = fadeTabs;
function watchTabs(){ var q = 0; function run(){ if (q) return; q = requestAnimationFrame(function(){ q = 0; fadeTabs(); }); }
  try{ new MutationObserver(run).observe(A.scroller, {childList:true, subtree:true}); }catch(e){} window.addEventListener("resize", run); run(); }
/* моливът за всяка роля (решение 15.11): с „Бележки“ пише бележки, без тях пише препоръки (само предлага, нищо не променя) */
A.mountPen = function(x){ var rec = !A.can("notes");
  return SAPen.mount(Object.assign({author:A.who, now:A.now, fabPhone:false, barTop:[8, 88], recommend:rec, notesHref:"notes.html",
    onSave:function(n){ n.source = {type:"staff", role:A.me.role, user:A.me.user}; A.notes.add(n); A.audit("note.create", (rec ? "Нова препоръка: " : "Нова бележка: ") + n.text.slice(0, 80), n.id); A.computeBadges(); A.setBadge("notes", A.badges.notes); },
    onToggle:syncPen}, x)); };
function syncPen(on){ document.querySelectorAll('[data-sa="pen"]').forEach(function(b){ b.setAttribute("aria-pressed", String(!!on)); }); }
A.syncPen = syncPen;
A.refreshSide = function(){ if (A.side) A.side.innerHTML = sideHTML(A.app.dataset.page); };

/* ---------- sections sheet (телефон и таблет) ---------- */
A.sectionsHTML = function(cur, q){ var list = q ? A.searchSections(q) : null;
  if (list) return list.length ? '<div class="sa-secgrid">' + list.map(function(s){ return secTile(s, cur); }).join("") + '</div>' : '<p class="muted">Няма раздел с „' + esc(q) + '“.</p>';
  return A.GROUPS.map(function(g){ var items = g[1].filter(function(id){ return A.can(id); }); if (!items.length) return "";
    return '<h3 class="sa-sgh">' + esc(g[0]) + '</h3><div class="sa-secgrid">' + items.map(function(id){ return secTile(A.SEC[id], cur); }).join("") + '</div>'; }).join("") +
    (A.APPS.filter(function(id){ return A.can(id); }).length ? '<h3 class="sa-sgh">Приложения на персонала</h3><div class="sa-secgrid">' + A.APPS.filter(function(id){ return A.can(id); }).map(function(id){ return secTile(A.SEC[id], cur); }).join("") + '</div>' : ''); };
function secTile(s, cur){ var meta = s.soon ? 'Скоро' : A.groupOf(s.id);
  if (s.soon) return '<button type="button" data-sa="soon" data-id="' + s.id + '">' + ic(s.ic, 24) + esc(s.n) + '<small>' + meta + '</small></button>';
  return '<a href="' + s.href + '"' + (cur === s.id ? ' aria-current="page"' : '') + '>' + ic(s.ic, 24) + esc(s.n) + '<small>' + esc(meta) + '</small>' + (s.id === "notes" ? badge("notes") : '') + '</a>'; }
function openSections(){ var cur = A.app.dataset.page;
  var sh = A.sheet({title:"Търсене и раздели", focus:"#sa-q2", html:'<div class="sa-search sa-field-s" role="search" style="margin:4px 0 6px"><label class="vh" for="sa-q2">Търсене: раздели, ястия, поръчки, резервации</label>' + ic("magnifying-glass", 20) + '<input class="input" id="sa-q2" type="search" placeholder="Търси навсякъде" autocomplete="off" aria-controls="sa-q2r"><button class="sa-clear" type="button" aria-label="Изчисти" hidden>' + ic("x", 18) + '</button></div><div data-list id="sa-q2r" role="listbox" aria-label="Резултати">' + A.sectionsHTML(cur) + '</div>'});
  sh.el.classList.add("sa-tall");
  var inp = sh.body.querySelector("#sa-q2"), box = sh.body.querySelector("[data-list]"), clr = sh.body.querySelector(".sa-clear");
  function draw(){ var q = inp.value.trim(); clr.hidden = !q; box.innerHTML = q ? A.searchHTML(q, "q2") : A.sectionsHTML(cur); }
  inp.addEventListener("input", draw); clr.addEventListener("click", function(){ inp.value = ""; draw(); inp.focus(); });
  A.onSearchReady = function(){ if (inp.isConnected && inp.value.trim()) draw(); };
  inp.addEventListener("keydown", function(e){ if (e.key === "Enter"){ var a = box.querySelector("a[href], button[data-ask]"); if (a){ e.preventDefault(); a.click(); } } }); }
function openProfile(){ var r = A.role(A.me.role);
  var sh = A.sheet({title:"Профил", html:'<div class="sa-prof"><span class="sa-av" aria-hidden="true">' + esc(A.initials(A.me.name)) + '</span><div><b>' + esc(A.me.name) + '</b><span class="muted">' + esc(r.n) + ' · потребител ' + esc(A.me.user) + '</span></div></div><p class="muted" style="margin:0 0 16px">' + esc(r.desc) + '</p>' +
    '<p class="label" style="margin:0 0 8px">Тема</p><div class="seg" role="group" aria-label="Тема">' + THEMES.map(function(t){ return '<button type="button" data-sa="settheme" data-v="' + t[0] + '" aria-pressed="' + (A.prefs.theme === t[0]) + '">' + ic(t[2], 20) + t[1] + '</button>'; }).join("") + '</div>',
    foot:'<button class="pill pill-line pill-lg pill-block" type="button" data-sa="logout">' + ic("sign-out", 22) + 'Изход</button>'}); return sh; }
function soonSheet(id){ var s = A.SEC[id]; A.sheet({title:s.n, html:'<p style="margin:0 0 12px">' + A.soonTag() + '</p><p style="margin:0 0 8px">' + esc(s.desc) + '</p><p class="muted" style="margin:0">Разделът ще се появи след модулите на управителя и собственика. Сега е видим, за да е пълна картата на правата.</p>'}); }
A.soonSheet = soonSheet;

/* ---------- умната търсачка (решение 15.11: „Умна търсачка = асистентът“) ----------
   Едно поле: разделите, ястията (../ds/search.js, зарежда се при първа употреба), поръчки (№, телефон), резервации, клиенти, бележки.
   Само каквото ролята има право да вижда. Обикновеното търсене работи веднага; „Попитай AI“ е примерен поток (етап E). */
var OST = {accepted:"Приета", cooking:"Готви се", ready:"Готова", on_way:"На път", delivered:"Доставена", picked_up:"Взета", served:"Сервирана", cancelled:"Отказана"};
var RST = {"new":"Нова", confirmed:"Потвърдена", seated:"Дошли", no_show:"Неявили се", cancelled:"Отказана", waitlist:"Чака маса"};
A.loadSearch = function(cb){ if (window.SCSearch) return cb && cb(); if (A._sl){ A._sl.push(cb); return; } A._sl = [cb];
  var sc = document.createElement("script"); sc.src = "../ds/search.js"; sc.onload = function(){ var l = A._sl; A._sl = null; l.forEach(function(f){ f && f(); }); A.onSearchReady && A.onSearchReady(); }; document.head.appendChild(sc); };
function digits(x){ return String(x || "").replace(/\D/g, ""); }
A.search = function(q){ var out = [], nq = norm(q), dq = digits(q), cut = 5, txt = nq.replace(/[^a-z ]/g, "").trim().length >= 3;
  function grp(key, title, items, extra){ if (items.length) out.push({key:key, title:title, items:items.slice(0, cut), more:Math.max(0, items.length - cut), extra:extra || ""}); }
  grp("sec", "Раздели", A.searchSections(q).map(function(s0){ return {href:s0.soon ? "" : s0.href, soon:s0.soon ? s0.id : "", icon:s0.ic, title:s0.n, meta:s0.soon ? "Скоро" : A.groupOf(s0.id)}; }));
  if (A.can("menu") || A.can("lunch")){
    if (window.SCSearch){ var r = SCSearch.searchDishes(SC.items, q), dish = function(x){ return {href:"menu.html#d=" + x.id, icon:"fork-knife", title:x.n, meta:(SC.catById[x.cat] ? SC.catById[x.cat].n + " · " : "") + SC.fmt(x.p)}; };
      grp("dish", "Ястия", r.name.map(dish));
      if (r.comp.length) grp("dishc", r.band || "Съдържат", r.comp.map(dish));
      if (r.rest.length && !r.name.length && !r.comp.length) grp("dishr", "Ястия", r.rest.map(dish));
      if (r.unknown.length) grp("dishu", "Нямаме пълен състав, попитайте ни", r.unknown.map(dish)); }
    else out.push({key:"wait", title:"Ястия", items:[], wait:true}); }
  if (A.can("orders")) grp("ord", "Поръчки", A.orders().filter(function(o){ return (dq && (o.no === dq || (dq.length >= 3 && (digits(o.phone).indexOf(dq) > -1 || o.no.indexOf(dq) === 0)))) || (txt && norm(o.name || "").indexOf(nq) > -1); })
    .map(function(o){ return {href:"orders.html#n=" + o.no, icon:"receipt", title:"№ " + o.no + " · " + (OST[o.status] || o.status), meta:(o.name || "") + (o.phone ? " · " + A.maskPhone(o.phone) : "")}; }));
  if (A.can("reservations")) grp("res", "Резервации", A.reservations().filter(function(r0){ return (dq.length >= 3 && digits(r0.phone).indexOf(dq) > -1) || (txt && norm((r0.name || "") + " " + (r0.occasion || "")).indexOf(nq) > -1); })
    .sort(function(a0, b0){ return a0.date < b0.date ? 1 : -1; }).map(function(r0){ return {href:"reservations.html#d=" + r0.date, icon:"calendar-check", title:(r0.name || "Резервация") + " · " + r0.time, meta:A.fmtDate(new Date(r0.date + "T12:00:00"), true) + " · " + (r0.people || "") + " души · " + (RST[r0.status] || r0.status)}; }));
  if (A.can("customers")) grp("cus", "Клиенти", listOf(get("customers", [])).filter(function(c){ return (dq.length >= 3 && digits(c.phone).indexOf(dq) > -1) || (txt && norm(c.name || "").indexOf(nq) > -1); })
    .map(function(c){ return {href:"customers.html", icon:"user", title:c.name || "Клиент", meta:c.phone ? A.maskPhone(c.phone) : ""}; }));
  var notes = A.can("notes") ? A.notes.list() : A.notes.mine();
  if (nq.length >= 3) grp("note", A.can("notes") ? "Бележки" : "Моите препоръки", notes.filter(function(n){ return norm(n.text + " " + (n.elementText || "")).indexOf(nq) > -1; })
    .map(function(n){ return {href:"notes.html#s=" + n.status, icon:"pencil-simple", title:n.text, meta:A.noteStatusName(n.status) + " · " + (A.MODULE_NAMES[n.module] || n.module)}; }));
  return out; };
A.searchHTML = function(q, pre){ var g = A.search(q), i = 0, any = false;
  if (!window.SCSearch && (A.can("menu") || A.can("lunch"))) A.loadSearch();
  var h = g.map(function(gr){ if (gr.wait) return '<div class="sa-rg"><h3>Ястия</h3><p class="none" role="status">Зареждаме търсенето на ястия …</p></div>';
    any = true; return '<div class="sa-rg"><h3>' + esc(gr.title) + (gr.extra ? ' <small>' + esc(gr.extra) + '</small>' : '') + '</h3>' + gr.items.map(function(it){ var id = "sa-" + pre + "-" + (i++);
      return it.soon ? '<button type="button" role="option" id="' + id + '" data-sa="soon" data-id="' + it.soon + '">' + ic(it.icon, 20) + '<span><b>' + esc(it.title) + '</b><small>' + esc(it.meta) + '</small></span></button>'
        : '<a href="' + it.href + '" role="option" id="' + id + '">' + ic(it.icon, 20) + '<span><b>' + esc(it.title) + '</b>' + (it.meta ? '<small>' + esc(it.meta) + '</small>' : '') + '</span></a>'; }).join("") + (gr.more ? '<p class="more">и още ' + gr.more + '</p>' : '') + '</div>'; }).join("");
  return (any ? h : '<p class="none">Нищо не намерихме за „' + esc(q) + '“. Опитайте с друга дума, № на поръчка или последните цифри на телефон.</p>' + h) +
    '<button class="sa-ask" type="button" role="option" id="sa-' + pre + '-ai" data-ask="' + esc(q) + '">' + ic("sparkle", 20) + '<span><b>Попитай AI: „' + esc(q) + '“</b><small>Пример в прототипа</small></span></button>'; };
/* „Попитай AI“: примерен поток, отговорът е само от намереното по-горе */
function askAI(q){ var g = A.search(q).filter(function(x){ return !x.wait; }), parts = g.map(function(gr){ return gr.title + ": " + gr.items.slice(0, 3).map(function(it){ return it.title; }).join(", ") + (gr.items.length > 3 || gr.more ? " …" : ""); });
  var s0 = A.sheet({title:"Попитай AI", html:'<p class="sa-tag sample" style="margin:0 0 12px">' + ic("info", 16) + 'Пример: свързването с Claude е етап E</p>' +
    '<div class="msg me" style="margin-left:auto">' + esc(q) + '</div><div class="msg bot" data-ans><span class="typing" aria-label="Мисли"><span></span><span></span><span></span></span></div>'});
  setTimeout(function(){ var a = s0.el.querySelector("[data-ans]"); if (!a) return;
    a.innerHTML = parts.length ? '<p>Ето какво намерих в данните, до които имате достъп:</p><ul class="ailist">' + parts.map(function(p0){ return '<li>' + esc(p0) + '</li>'; }).join("") + '</ul><p>Отговарям само от тях; каквото липсва, казвам „попитайте ни“.</p>'
      : '<p>Не намерих нищо по този въпрос в данните, до които имате достъп. Опитайте с № на поръчка, телефон или име на ястие.</p>'; }, 900); }
A.askAI = askAI;
function bindSearch(){ var inp = A.app.querySelector("#sa-q"); if (!inp) return; var box = A.app.querySelector("#sa-sres"), clr = A.app.querySelector(".sa-top .sa-clear"), kbd = A.app.querySelector(".sa-top .sa-search .k"), sel = -1;
  function opts(){ return Array.prototype.slice.call(box.querySelectorAll("[role=option]")); }
  function mark(){ var o = opts(); o.forEach(function(el, i){ el.setAttribute("aria-selected", String(i === sel)); }); if (o[sel]){ inp.setAttribute("aria-activedescendant", o[sel].id); o[sel].scrollIntoView({block:"nearest"}); } else inp.removeAttribute("aria-activedescendant"); }
  function draw(){ var q = inp.value.trim(); clr.hidden = !q; kbd.hidden = !!q; sel = -1;
    box.innerHTML = q ? A.searchHTML(q, "q") : '<div class="sa-rg"><h3>Раздели</h3>' + A.visibleSections().slice(0, 6).map(function(s0, i){ return '<a href="' + (s0.soon ? '#' : s0.href) + '" role="option" id="sa-q-s' + i + '"' + (s0.soon ? ' data-sa="soon" data-id="' + s0.id + '"' : '') + '>' + ic(s0.ic, 20) + '<span><b>' + esc(s0.n) + '</b><small>' + esc(s0.soon ? "Скоро" : A.groupOf(s0.id)) + '</small></span></a>'; }).join("") + '</div><p class="hint">Търсете раздел, ястие („без лук“, „пиле“), № на поръчка или телефон.</p>';
    box.hidden = false; inp.setAttribute("aria-expanded", "true"); mark(); }
  function hide(){ box.hidden = true; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); }
  A.onSearchReady = function(){ if (!box.hidden) draw(); };
  inp.addEventListener("focus", function(){ draw(); A.loadSearch(); }); inp.addEventListener("input", draw);
  clr.addEventListener("mousedown", function(e){ e.preventDefault(); }); clr.addEventListener("click", function(){ inp.value = ""; draw(); inp.focus(); });
  inp.addEventListener("keydown", function(e){ var o = opts();
    if (e.key === "ArrowDown"){ e.preventDefault(); sel = Math.min(o.length - 1, sel + 1); mark(); } else if (e.key === "ArrowUp"){ e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === "Enter"){ var t = o[sel >= 0 ? sel : 0]; if (t){ e.preventDefault(); t.click(); } } else if (e.key === "Escape"){ if (inp.value){ inp.value = ""; draw(); } else { hide(); inp.blur(); } } });
  box.addEventListener("mousedown", function(e){ e.preventDefault(); });
  inp.addEventListener("blur", function(){ setTimeout(hide, 150); });
  document.addEventListener("keydown", function(e){ if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "") && !document.querySelector(".sa-ov .sheetwrap.on") && inp.offsetParent){ e.preventDefault(); inp.focus(); } }); }

/* ---------- delegation ---------- */
document.addEventListener("click", function(e){ var ask = e.target.closest("[data-ask]"); if (ask){ e.preventDefault(); askAI(ask.dataset.ask); return; }
  var t = e.target.closest("[data-sa]"); if (!t) return; var a = t.dataset.sa;
  if (a === "sections"){ openSections(); return; }
  if (a === "profile"){ openProfile(); return; }
  if (a === "logout"){ A.logout(); return; }
  if (a === "theme"){ var i = THEMES.map(function(x){ return x[0]; }).indexOf(A.prefs.theme); A.prefs.theme = THEMES[(i + 1) % THEMES.length][0]; A.savePrefs(); A.applyTheme(); var th = THEMES[(i + 1) % THEMES.length]; t.innerHTML = ic(th[2], 20) + 'Тема: ' + th[1]; t.setAttribute("aria-label", "Тема: " + th[1] + ". Смени"); A.onTheme && A.onTheme(); return; }
  if (a === "settheme"){ A.prefs.theme = t.dataset.v; A.savePrefs(); A.applyTheme(); document.querySelectorAll('[data-sa="settheme"]').forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.v === A.prefs.theme)); });
    var tb = A.app.querySelector('[data-sa="theme"]'), th2 = THEMES.filter(function(x){ return x[0] === A.prefs.theme; })[0]; if (tb){ tb.innerHTML = ic(th2[2], 20) + 'Тема: ' + th2[1]; } A.onTheme && A.onTheme(); return; }
  if (a === "side"){ A.prefs.side = A.prefs.side === "mini" ? "open" : "mini"; A.savePrefs(); A.app.dataset.side = A.prefs.side; A.refreshSide(); return; }
  if (a === "pen"){ if (A.pen) A.pen.toggle(); return; }
  if (a === "soon"){ e.preventDefault(); soonSheet(t.dataset.id); return; }
  if (a === "viewas"){ A.viewAs(t.dataset.v); return; }
  if (a === "ptime"){ A.setProtoTime(t.dataset.v); location.reload(); return; }
  if (a === "reset"){ A.data.reset(); A.toast("Данните са върнати в начало"); setTimeout(function(){ location.reload(); }, 700); return; }
  if (a === "state"){ e.preventDefault(); location.hash = t.getAttribute("href").slice(1); location.reload(); return; }
  if (a === "retry"){ t.disabled = true; var old = t.innerHTML; t.innerHTML = "Проверяваме …"; setTimeout(function(){ t.disabled = false; t.innerHTML = old; A.toast("Още няма връзка. Опитваме сами на всеки 10 сек."); }, 900); return; }
});
})();
