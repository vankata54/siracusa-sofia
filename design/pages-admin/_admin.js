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
  reset:function(){ A.data.keys().forEach(function(k){ if (k !== "session" && k !== "prefs") del(k); }); }
};

/* ---------- hash ---------- */
A.hash = {};
(location.hash.slice(1) || "").split("&").forEach(function(p){ if (!p) return; var i = p.indexOf("="); if (i < 0) A.hash[decodeURIComponent(p)] = ""; else A.hash[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); });
A.st = A.hash.st || "";
A.setHash = function(obj, replace){ var h = Object.keys(obj).filter(function(k){ return obj[k] !== "" && obj[k] != null; }).map(function(k){ return encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]); }).join("&");
  A.hash = obj; A.liveHash = true; if (replace !== false) history.replaceState(null, "", location.pathname + (h ? "#" + h : "")); else location.hash = h; };
/* страниците, които сами следят #, слагат A.liveHash = true; иначе смяна на # презарежда (като в другите модули) */
window.addEventListener("hashchange", function(){ if (!A.liveHash) location.reload(); });

/* ---------- time & formats (София) ---------- */
A.DAYS = ["нд","пн","вт","ср","чт","пт","сб"];
A.sofia = function(d){ d = d || new Date();
  try{ var f = new Intl.DateTimeFormat("en-GB", {timeZone:"Europe/Sofia", year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", weekday:"short", hour12:false}).formatToParts(d), o = {};
    f.forEach(function(p){ o[p.type] = p.value; });
    return {y:+o.year, mo:+o.month - 1, d:+o.day, h:+o.hour % 24, m:+o.minute, dow:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].indexOf(o.weekday)}; }
  catch(e){ return {y:d.getFullYear(), mo:d.getMonth(), d:d.getDate(), h:d.getHours(), m:d.getMinutes(), dow:d.getDay()}; } };
A.todayKey = function(){ var s = A.sofia(); return s.y + "-" + String(s.mo + 1).padStart(2, "0") + "-" + String(s.d).padStart(2, "0"); };
A.hm = function(d){ var s = A.sofia(d instanceof Date ? d : new Date(d)); return String(s.h).padStart(2, "0") + ":" + String(s.m).padStart(2, "0"); };
/* „сб, 28 ноември“; short: „сб, 28 ное“ */
A.fmtDate = function(d, short){ var s = A.sofia(d instanceof Date ? d : new Date(d)); return A.DAYS[s.dow] + ", " + s.d + " " + (short ? SC.MON[s.mo] : SC.MONTHS[s.mo]); };
/* кога: „преди 5 мин“, „днес в 19:02“, „вчера в 18:40“, „сб, 7 ноември в 12:10“ */
A.ago = function(iso){ var d = new Date(iso), diff = (Date.now() - d.getTime()) / 60000;
  if (diff < 1) return "току-що"; if (diff < 60) return "преди " + Math.round(diff) + " мин";
  var a = A.sofia(d), b = A.sofia(), dayA = Date.UTC(a.y, a.mo, a.d), dayB = Date.UTC(b.y, b.mo, b.d), dd = Math.round((dayB - dayA) / 864e5);
  if (dd === 0) return "днес в " + A.hm(d); if (dd === 1) return "вчера в " + A.hm(d); return A.fmtDate(d) + " в " + A.hm(d); };
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
  {id:"waiter", n:"Сервитьор", desc:"Повиквания, статус на масите, въвеждане на поръчки, потвърждаване на QR поръчки, сметки.", sections:["dashboard","waiter","orders","reservations","site"]},
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
A.can = function(section, role){ role = role || (A.me && A.me.role); if (!role) return false; if (role === "admin") return true; var r = A.role(role); return !!r && r.sections.indexOf(section) > -1; };

/* ---------- audit (дневник) ---------- */
/* A.audit("menu.price", "Цена на „Кебапчета“: 3,50 € → 3,80 €", "kebapcheta") ; ключовете като в ядрото: staff.login, role.update, note.status ... */
A.audit = function(action, text, target){ var e = {id:Math.random().toString(36).slice(2, 10), at:new Date().toISOString(), who:A.me ? A.me.name : "?", role:A.me ? A.me.role : "", action:action, text:text || action, target:target || null};
  A.data.update("audit", [], function(l){ l.unshift(e); if (l.length > 500) l.length = 500; }); return e; };

/* ---------- prefs (тема, свита лента) ---------- */
A.prefs = get("prefs", {theme:"system", side:"open"});
A.savePrefs = function(){ set("prefs", A.prefs); };
A.applyTheme = function(){ var de = document.documentElement; if (A.prefs.theme === "light" || A.prefs.theme === "dark") de.dataset.theme = A.prefs.theme; else delete de.dataset.theme; };
A.applyTheme();
var THEMES = [["system","Авто","circles-three"],["light","Светла","sun"],["dark","Тъмна","moon"]];

/* ---------- notes (бележките от молива: полетата са като в src/core/notes.ts) ---------- */
A.MODULE_NAMES = {site:"Клиентски сайт", masa:"QR маса", waiter:"Сервитьор", watch:"Часовник", kitchen:"Кухня", driver:"Шофьор", admin:"Админ"};
A.notes = {
  list:function(){ return get("notes", A.SEED_NOTES()); },
  save:function(l){ set("notes", l); },
  add:function(n){ var l = A.notes.list(); l.unshift(n); A.notes.save(l); return n; },
  status:function(id, st){ var l = A.notes.list(), n = l.filter(function(x){ return x.id === id; })[0]; if (!n) return null; var was = n.status; n.status = st; n.updatedAt = new Date().toISOString(); A.notes.save(l); return was; },
  remove:function(id){ var l = A.notes.list(), i = -1; l.forEach(function(x, j){ if (x.id === id) i = j; }); if (i < 0) return null; var g = l.splice(i, 1)[0]; A.notes.save(l); return {note:g, index:i}; },
  restore:function(r){ var l = A.notes.list(); l.splice(Math.min(r.index, l.length), 0, r.note); A.notes.save(l); },
  count:function(st){ return A.notes.list().filter(function(n){ return !st || n.status === st; }).length; }
};
/* примерни бележки (автор „Примерна бележка“), за да се виждат картите; „Върни данните в начало“ ги връща */
A.SEED_NOTES = function(){ var t = Date.now(), iso = function(min){ return new Date(t - min * 60000).toISOString(); };
  function N(id, mod, url, sel, txt, el, w, h, st, min, upd){ return {id:id, module:mod, url:url, selector:sel, editId:null, text:txt, elementText:el, viewport:{w:w, h:h}, screenshot:null, author:"Примерна бележка", status:st, createdAt:iso(min), updatedAt:iso(upd == null ? min : upd)}; }
  return [
    N("n7k2q9a1","site","/pages/home.html",".hero-ttl","Заглавието да е на два реда на телефон, без да се реже.","Пица на пещ и скара на дървени въглища",390,844,"new",12),
    N("n3m8x2b4","kitchen","/pages-kuhnya/queue.html#s=skara",".kq > article:nth-of-type(1) .kdone","Бутонът „Готово“ да е по-високо, до таймера.","Готово",1280,800,"new",48),
    N("n5c1v7d3","admin","/pages-admin/dashboard.html","[data-edit-id=\"admin.dashboard.today\"]","Броят на изчерпаните да води направо към менюто с филтър.","Днес",1440,900,"new",95),
    N("n9p4r6e8","waiter","/pages-servitor/tables.html",".st-top","Името на сервитьора да е по-голямо.","Залата",390,844,"doing",60*26,60*3),
    N("n2h6t1f5","site","/pages/menu.html","#main h1","Да пише само „Меню“.","Меню",1440,900,"done",60*50,60*30)
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
A.toast = function(text, o){ o = o || {}; var col = A.col || document.body, t = col.querySelector(".sa-toast");
  if (!t){ t = document.createElement("div"); t.className = "sa-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); col.appendChild(t); }
  t.innerHTML = '<span class="tx">' + esc(text) + '</span>' + (o.action ? (o.action.href ? '<a href="' + esc(o.action.href) + '">' + esc(o.action.label) + ic("caret-right", 18) + '</a>' : '<button type="button" data-ta>' + esc(o.action.label) + '</button>') : '') + (o.undo ? '<button type="button" data-tu>' + ic("arrow-counter-clockwise", 18) + esc(o.undoLabel || "Отмени") + '</button>' : '');
  var u = t.querySelector("[data-tu]"); if (u) u.onclick = function(){ t.classList.remove("on"); o.undo(); };
  var a = t.querySelector("[data-ta]"); if (a) a.onclick = function(){ t.classList.remove("on"); o.action.fn(); };
  requestAnimationFrame(function(){ t.classList.add("on"); }); clearTimeout(toastT);
  toastT = setTimeout(function(){ t.classList.remove("on"); }, o.ms || (o.undo ? 6000 : 3200)); };

/* ---------- sheet (листът от sc.css: отдолу на телефон, вдясно от 900px) ---------- */
/* A.sheet({title, html, foot, onClose}) -> {el, body, foot, close} */
A.sheet = function(o){ var ov = A.ov || document.body, w = document.createElement("div"), id = "sa" + Math.random().toString(36).slice(2, 8); w.className = "sheetwrap";
  w.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle"></div><div class="sheet-h"><h2 id="' + id + '">' + esc(o.title || "") + '</h2><button class="hb" type="button" data-close>' + ic("x", 20) + 'Затвори</button></div><div class="body">' + (o.html || "") + '</div>' + (o.foot ? '<div class="sa-sfoot">' + o.foot + '</div>' : '') + '</div>';
  ov.appendChild(w); var prev = document.activeElement, bg = [A.side, A.col && A.col.querySelector(".sa-scroller"), A.col && A.col.querySelector(".sa-top"), A.bnav].filter(Boolean);
  bg.forEach(function(el){ el.inert = true; });
  w.addEventListener("keydown", function(e){ if (e.key !== "Tab") return; var f = Array.prototype.filter.call(w.querySelectorAll(".sheet button:not([disabled]), .sheet a[href], .sheet input:not([disabled]), .sheet textarea, .sheet select"), function(el){ return el.offsetParent !== null; });
    if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } });
  var closed = false;
  function close(){ if (closed) return; closed = true; if (document.querySelectorAll(".sa-ov .sheetwrap.on").length <= 1) bg.forEach(function(el){ el.inert = false; }); w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 340); o.onClose && o.onClose(); prev && prev.focus && prev.focus({preventScroll:true}); }
  w.querySelector(".scrim").onclick = close; w.querySelector("[data-close]").onclick = close;
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); var f = o.focus ? w.querySelector(o.focus) : w.querySelector("[data-close]"); f && f.focus({preventScroll:true}); }); });
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
A.badges = {};
A.setBadge = function(id, n){ A.badges[id] = n; document.querySelectorAll('[data-badge="' + id + '"]').forEach(function(el){ el.textContent = n; el.hidden = !n; }); };
function badge(id){ var n = A.badges[id]; return '<span class="sa-n" data-badge="' + id + '"' + (n ? '' : ' hidden') + ' aria-hidden="true">' + (n || 0) + '</span>'; }

/* ---------- chrome ---------- */
function sideHTML(cur){
  return '<a class="sa-brand" href="dashboard.html" aria-label="Siracusa · Админ, към таблото"><span class="sa-mono" aria-hidden="true">S</span><span class="word">Siracusa</span><span class="sa-btag">Админ</span></a>' +
    '<nav class="sa-nav" aria-label="Раздели">' + A.GROUPS.map(function(g){ var items = g[1].filter(function(id){ return A.can(id); }); if (!items.length) return "";
      return '<div class="sa-g"><h2>' + esc(g[0]) + '</h2>' + items.map(function(id){ var s = A.SEC[id];
        var inner = ic(s.ic, 22) + '<span class="lb">' + esc(s.n) + '</span><span class="sh">' + esc(s.short) + '</span>' + (s.soon ? '<span class="soon">Скоро</span>' : badge(id));
        if (s.soon) return '<button class="sa-i" type="button" data-sa="soon" data-id="' + id + '" title="' + esc(s.n) + ': скоро">' + inner + '</button>';
        return '<a class="sa-i" href="' + s.href + '"' + (cur === id ? ' aria-current="page"' : '') + ' title="' + esc(s.n) + '">' + inner + '</a>'; }).join("") + '</div>'; }).join("") +
      (A.APPS.some(function(id){ return A.can(id) && A.me.role !== "admin" && A.me.role !== "owner" && A.me.role !== "manager"; }) ? '<div class="sa-g"><h2>Приложение</h2>' + A.APPS.filter(function(id){ return A.can(id); }).map(function(id){ var s = A.SEC[id];
        return '<a class="sa-i" href="' + s.href + '" title="' + esc(s.n) + '">' + ic(s.ic, 22) + '<span class="lb">' + esc(s.n) + ': приложението</span><span class="sh">' + esc(s.short) + '</span></a>'; }).join("") + '</div>' : '') + '</nav>' +
    '<div class="sa-sidefoot"><button class="sa-i sa-collapse" type="button" data-sa="side" aria-expanded="' + (A.prefs.side !== "mini") + '">' + ic(A.prefs.side === "mini" ? "caret-right" : "caret-left", 22) + '<span class="lb">Свий лентата</span><span class="sh">Разгъни</span></button></div>'; }
function topHTML(o){ var s = A.SEC[o.section], g = A.groupOf(o.section), th = THEMES.filter(function(t){ return t[0] === A.prefs.theme; })[0] || THEMES[0], pen = A.can("notes") && o.pencil !== false;
  return '<header class="sa-top">' +
    '<div class="sa-crumb"><small class="sa-only-td">' + esc(o.crumb || g || "Админ") + '</small><b>' + esc(o.barTitle || (s && s.n) || o.title || "") + '</b></div>' +
    '<div class="sa-search sa-only-d" role="search"><label class="vh" for="sa-q">Търси раздел</label>' + ic("magnifying-glass", 20) + '<input id="sa-q" type="search" placeholder="Търси раздел" autocomplete="off" aria-controls="sa-sres" aria-expanded="false"><span class="k" aria-hidden="true">/</span><div class="sa-sres" id="sa-sres" role="listbox" hidden></div></div>' +
    '<button class="sa-tb sa-only-t" type="button" data-sa="sections">' + ic("magnifying-glass", 20) + 'Търси</button>' +
    (pen ? '<button class="sa-tb sa-only-td" type="button" data-sa="pen" aria-pressed="false">' + ic("pencil-simple", 20) + 'Молив</button>' : '') +
    '<button class="sa-tb sa-only-d" type="button" data-sa="theme" aria-label="Тема: ' + th[1] + '. Смени">' + ic(th[2], 20) + th[1] + '</button>' +
    '<button class="sa-tb sa-only-p" type="button" data-sa="sections">' + ic("list", 22) + 'Раздели</button>' +
    '<button class="sa-me" type="button" data-sa="profile" aria-label="Профил: ' + esc(A.me.name) + ', ' + esc(A.roleName(A.me.role)) + '"><span class="sa-av" aria-hidden="true">' + esc(A.initials(A.me.name)) + '</span><span class="who sa-only-d"><b>' + esc(A.me.name) + '</b><small>' + esc(A.roleName(A.me.role)) + '</small></span></button>' +
    '<button class="sa-tb sa-only-d" type="button" data-sa="logout">' + ic("sign-out", 20) + 'Изход</button>' +
  '</header>'; }
function bnavHTML(cur){ var items = [["dashboard","Табло","squares-four","dashboard.html"],["orders","Поръчки","receipt","orders.html"],["notes","Бележки","pencil-simple","notes.html"]].filter(function(x){ return A.can(x[0]); });
  return '<nav class="sa-bnav" aria-label="Основни раздели">' + items.map(function(x){ return '<a href="' + x[3] + '"' + (cur === x[0] ? ' aria-current="page"' : '') + '>' + ic(x[2], 24) + x[1] + (x[0] === "notes" ? badge("notes") : '') + '</a>'; }).join("") +
    '<button type="button" data-sa="sections"' + (["dashboard","orders","notes"].indexOf(cur) < 0 ? ' aria-current="page"' : '') + '>' + ic("list", 24) + 'Раздели</button></nav>'; }
function protoHTML(o){ var role = A.me ? A.me.role : "";
  return '<section class="sa-proto" aria-label="Само в прототипа" data-edit-id="admin.proto"><h2>' + ic("sliders-horizontal", 20) + 'Само в прототипа</h2>' +
    (o.states && o.states.length ? '<p>Състояние на екрана:</p><div class="row">' + o.states.map(function(s){ var h = Object.assign({}, A.hash, {st:s[0]});
      return '<a class="chip" href="#' + Object.keys(h).filter(function(k){ return h[k]; }).map(function(k){ return k + "=" + encodeURIComponent(h[k]); }).join("&") + '" data-sa="state" aria-pressed="' + (A.st === s[0]) + '" style="text-decoration:none">' + esc(s[1]) + '</a>'; }).join("") + '</div>' : '') +
    '<p>Виж като (сменя ролята на влезлия, за да се види какво вижда всяка роля):</p><div class="row">' + A.DEFAULT_ROLES.map(function(r){ return '<button class="chip" type="button" data-sa="viewas" data-v="' + r.id + '" aria-pressed="' + (role === r.id) + '">' + esc(r.n) + '</button>'; }).join("") + '</div>' +
    '<p>Пробни акаунти: <code>admin</code>, <code>owner</code>, <code>manager</code>, <code>waiter</code>, <code>kitchen</code>, <code>driver</code>, <code>marketing</code>, всички с парола <code>' + A.PASSWORD + '</code>. Само в прототипа; истинските пароли са в <code>.env</code> и не са в git.</p>' +
    '<div class="row"><button class="chip" type="button" data-sa="reset">' + ic("arrow-counter-clockwise", 18) + 'Върни данните в начало</button><a class="chip" href="index.html" style="text-decoration:none">' + ic("list", 18) + 'Всички екрани</a></div>' +
    (o.protoExtra || '') + '</section>'; }

/* A.mount(opts) -> елементът за съдържанието (под заглавието) или null, ако ролята няма права.
   opts: {section, title, sub, eyebrow, crumb, actions (HTML), states:[[st, "Име"]], wide, head:false, pencil:false, public:true, immersive:true, protoExtra} */
A.mount = function(o){ o = o || {};
  if (!A.me && !o.public){ location.replace("login.html#next=" + encodeURIComponent(location.pathname.split("/").pop() + location.hash)); return null; }
  document.title = (o.docTitle || o.title || (A.SEC[o.section] && A.SEC[o.section].n) || "Админ") + " | Siracusa · Админ";
  A.badges.notes = A.notes.count("new");
  var app = document.createElement("div"); app.className = "sa-app" + (o.immersive ? " immersive" : ""); app.dataset.side = o.immersive ? "mini" : (A.prefs.side === "mini" ? "mini" : "open"); app.dataset.page = o.section || "";
  var allowed = !o.section || A.can(o.section);
  var s = A.SEC[o.section] || {};
  var head = o.head === false ? '' : '<div class="sa-head" data-edit-id="admin.' + (o.section || "page") + '.head"><div>' + (o.eyebrow !== false ? '<span class="sa-eye">' + ic(s.ic || "squares-four", 18) + esc(o.eyebrow || A.groupOf(o.section) || "Админ") + '</span>' : '') + '<h1 class="sa-h1">' + esc(o.title || s.n || "") + '</h1>' + (o.sub ? '<p class="sa-sub">' + o.sub + '</p>' : '') + '</div>' + (o.actions ? '<div class="sa-acts">' + o.actions + '</div>' : '') + '</div>';
  app.innerHTML = '<aside class="sa-side" aria-label="Лента с разделите">' + sideHTML(o.section) + '</aside>' +
    '<div class="sa-col">' + topHTML(o) + '<div class="sa-scroller" data-scroller><main id="main" class="sa-page' + (o.wide ? ' wide' : '') + '">' + (allowed ? head + '<div data-body></div>' : A.noRightsHTML(o.section)) + protoHTML(o) + '<div class="sa-end"></div></main></div></div>' +
    bnavHTML(o.section) + '<div class="sa-ov"></div>';
  document.body.appendChild(app);
  A.app = app; A.side = app.querySelector(".sa-side"); A.col = app.querySelector(".sa-col"); A.scroller = app.querySelector(".sa-scroller"); A.ov = app.querySelector(".sa-ov"); A.bnav = app.querySelector(".sa-bnav");
  bindSearch();
  var inPreview = false; try{ inPreview = window.parent !== window && !!window.parent.A_PREVIEW; }catch(e){}
  if (window.SAPen && A.can("notes") && o.pencil !== false && !inPreview) A.pen = SAPen.mount({module:"admin", author:A.who, notesHref:"notes.html", onSave:function(n){ A.notes.add(n); A.audit("note.create", "Нова бележка: " + n.text.slice(0, 80), n.id); A.setBadge("notes", A.notes.count("new")); }, onToggle:syncPen, fabBottom:o.fabBottom});
  return allowed ? app.querySelector("[data-body]") : null; };
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
  var sh = A.sheet({title:"Раздели", html:'<div class="sa-field-s" style="margin:4px 0 6px"><label class="vh" for="sa-q2">Търси раздел</label>' + ic("magnifying-glass", 20) + '<input class="input" id="sa-q2" type="search" placeholder="Търси раздел" autocomplete="off"></div><div data-list>' + A.sectionsHTML(cur) + '</div>'});
  var inp = sh.body.querySelector("#sa-q2"), box = sh.body.querySelector("[data-list]");
  inp.addEventListener("input", function(){ box.innerHTML = A.sectionsHTML(cur, inp.value.trim()); });
  inp.addEventListener("keydown", function(e){ if (e.key === "Enter"){ var a = box.querySelector("a"); if (a) location.href = a.getAttribute("href"); } }); }
function openProfile(){ var r = A.role(A.me.role);
  var sh = A.sheet({title:"Профил", html:'<div class="sa-prof"><span class="sa-av" aria-hidden="true">' + esc(A.initials(A.me.name)) + '</span><div><b>' + esc(A.me.name) + '</b><span class="muted">' + esc(r.n) + ' · потребител ' + esc(A.me.user) + '</span></div></div><p class="muted" style="margin:0 0 16px">' + esc(r.desc) + '</p>' +
    '<p class="label" style="margin:0 0 8px">Тема</p><div class="seg" role="group" aria-label="Тема">' + THEMES.map(function(t){ return '<button type="button" data-sa="settheme" data-v="' + t[0] + '" aria-pressed="' + (A.prefs.theme === t[0]) + '">' + ic(t[2], 20) + t[1] + '</button>'; }).join("") + '</div>',
    foot:'<button class="pill pill-line pill-lg pill-block" type="button" data-sa="logout">' + ic("sign-out", 22) + 'Изход</button>'}); return sh; }
function soonSheet(id){ var s = A.SEC[id]; A.sheet({title:s.n, html:'<p style="margin:0 0 12px">' + A.soonTag() + '</p><p style="margin:0 0 8px">' + esc(s.desc) + '</p><p class="muted" style="margin:0">Разделът ще се появи след модулите на управителя и собственика. Сега е видим, за да е пълна картата на правата.</p>'}); }
A.soonSheet = soonSheet;

/* ---------- desktop search ---------- */
function bindSearch(){ var inp = A.app.querySelector("#sa-q"); if (!inp) return; var box = A.app.querySelector("#sa-sres"), sel = 0, list = [];
  function draw(){ var q = inp.value.trim(); list = q ? A.searchSections(q) : A.visibleSections().slice(0, 6); sel = Math.min(sel, Math.max(0, list.length - 1));
    box.innerHTML = list.length ? list.map(function(s, i){ return '<a href="' + (s.soon ? '#' : s.href) + '" role="option" id="sa-o' + i + '" aria-selected="' + (i === sel) + '"' + (s.soon ? ' data-sa="soon" data-id="' + s.id + '"' : '') + '>' + ic(s.ic, 20) + esc(s.n) + '<small>' + (s.soon ? 'Скоро' : esc(A.groupOf(s.id))) + '</small></a>'; }).join("") : '<div class="none">Няма раздел с „' + esc(q) + '“.</div>';
    box.hidden = false; inp.setAttribute("aria-expanded", "true"); if (list.length) inp.setAttribute("aria-activedescendant", "sa-o" + sel); }
  function hide(){ box.hidden = true; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); }
  inp.addEventListener("focus", draw); inp.addEventListener("input", function(){ sel = 0; draw(); });
  inp.addEventListener("keydown", function(e){ if (e.key === "ArrowDown"){ e.preventDefault(); sel = Math.min(list.length - 1, sel + 1); draw(); } else if (e.key === "ArrowUp"){ e.preventDefault(); sel = Math.max(0, sel - 1); draw(); }
    else if (e.key === "Enter"){ var s = list[sel]; if (s){ e.preventDefault(); if (s.soon){ hide(); soonSheet(s.id); } else location.href = s.href; } } else if (e.key === "Escape"){ inp.value = ""; hide(); inp.blur(); } });
  inp.addEventListener("blur", function(){ setTimeout(hide, 150); });
  document.addEventListener("keydown", function(e){ if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "") && !document.querySelector(".sa-ov .sheetwrap.on") && inp.offsetParent){ e.preventDefault(); inp.focus(); } }); }

/* ---------- delegation ---------- */
document.addEventListener("click", function(e){ var t = e.target.closest("[data-sa]"); if (!t) return; var a = t.dataset.sa;
  if (a === "sections"){ openSections(); return; }
  if (a === "profile"){ openProfile(); return; }
  if (a === "logout"){ A.logout(); return; }
  if (a === "theme"){ var i = THEMES.map(function(x){ return x[0]; }).indexOf(A.prefs.theme); A.prefs.theme = THEMES[(i + 1) % THEMES.length][0]; A.savePrefs(); A.applyTheme(); var th = THEMES[(i + 1) % THEMES.length]; t.innerHTML = ic(th[2], 20) + th[1]; t.setAttribute("aria-label", "Тема: " + th[1] + ". Смени"); A.onTheme && A.onTheme(); return; }
  if (a === "settheme"){ A.prefs.theme = t.dataset.v; A.savePrefs(); A.applyTheme(); document.querySelectorAll('[data-sa="settheme"]').forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.v === A.prefs.theme)); });
    var tb = A.app.querySelector('[data-sa="theme"]'), th2 = THEMES.filter(function(x){ return x[0] === A.prefs.theme; })[0]; if (tb){ tb.innerHTML = ic(th2[2], 20) + th2[1]; } A.onTheme && A.onTheme(); return; }
  if (a === "side"){ A.prefs.side = A.prefs.side === "mini" ? "open" : "mini"; A.savePrefs(); A.app.dataset.side = A.prefs.side; A.refreshSide(); return; }
  if (a === "pen"){ if (A.pen) A.pen.toggle(); return; }
  if (a === "soon"){ e.preventDefault(); soonSheet(t.dataset.id); return; }
  if (a === "viewas"){ A.viewAs(t.dataset.v); return; }
  if (a === "reset"){ A.data.reset(); A.toast("Данните са върнати в начало"); setTimeout(function(){ location.reload(); }, 700); return; }
  if (a === "state"){ e.preventDefault(); location.hash = t.getAttribute("href").slice(1); location.reload(); return; }
  if (a === "retry"){ t.disabled = true; var old = t.innerHTML; t.innerHTML = "Проверяваме …"; setTimeout(function(){ t.disabled = false; t.innerHTML = old; A.toast("Още няма връзка. Опитваме сами на всеки 10 сек."); }, 900); return; }
});
})();
