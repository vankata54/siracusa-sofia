/* Siracusa · Собственик: рамката на модула (BRIEF-STEP5, раздел 4 и 7). Зарежда се след ../ds/icons.js, ../data/menu.js, ../ds/sc.js (без SC.mount),
   ../pages-admin/_admin.js, _seed-orders.js, _res-lib.js, _seed-res.js (без A.mount: оттам са данните и помощниците, за да са числата като в админа),
   ../pages-admin/_pencil.js, _pen-mount.js (data-auto="false") и _history.js.
   O.mount({page, title, states}) рисува горната лента (телефон: името на екрана, „Търси“, профилът), долната лента (телефон) или лявата лента (компютър),
   лентата „Няма връзка“, панела „Само в прототипа“ и молива за препоръки; връща елемента за съдържание (или null без права).
   Часът е A.now() (по подразбиране 19:42). Ключовете са на админа (sa-orders, sa-reservations, sa-blocks, sa-notes ...); свои: sa-own-mail. */
(function(){
"use strict";
var O = window.O = {};
var ic = SC.ic, esc = SC.esc;
O.ic = ic; O.esc = esc; O.fmt = SC.fmt;
O.st = A.st || "";
if (A.MODULE_NAMES) A.MODULE_NAMES.sobstvenik = "Собственик"; /* името в листа на молива (искане към шефа: и в _pencil.js) */

/* екраните (имената са фиксирани в BRIEF-STEP5, раздел 3) */
O.SCREENS = [["today","Днес","house","today.html"],["trends","Тенденции","chart-bar","trends.html"],["finance","Финанси","wallet","finance.html"],["decisions","Решения","list-checks","decisions.html"]];
O.TITLES = {today:"Днес", trends:"Тенденции", finance:"Финанси и гориво", decisions:"Решения", index:"Собственик"};
O.ALLOWED = ["owner","admin"];
O.STATES = [["","Обичайно"],["loading","Зареждане"],["empty","Без история"],["error","Грешка"],["offline","Без връзка"],["drop","Отклонение"]];

/* ---------- малки части (HTML) ---------- */
O.sample = function(t){ return '<span class="ow-tag">' + ic("info", 16) + esc(t || "Примерни данни") + '</span>'; };
O.missing = function(t){ return A.missing(t); };
O.soon = function(){ return '<span class="ow-tag soon">' + ic("sparkle", 16) + 'Скоро</span>'; };
O.banner = function(o){ return '<div class="ow-banner ' + (o.tone || '') + '" role="' + (o.tone === "danger" || o.tone === "warn" ? "alert" : "status") + '">' + ic(o.icon || "info", 26) + '<div class="tx">' + (o.title ? '<b>' + esc(o.title) + '</b>' : '') + (o.text || '') + '</div>' + (o.action || '') + '</div>'; };
O.retryBtn = function(){ return '<button class="pill pill-line" type="button" data-ow="retry">' + ic("arrow-clockwise", 20) + 'Опитай пак</button>'; };
O.error = function(text){ return O.banner({tone:"danger", icon:"warning", title:"Не успяхме да заредим данните", text:esc(text || "Опитай пак след малко. Ако не стане, кажи на агенцията."), action:O.retryBtn()}); };
/* живият регион: какво се смени (период, сравнение) за екранния четец */
O.say = function(t){ var l = document.getElementById("ow-live"); if (!l) return; l.textContent = ""; setTimeout(function(){ l.textContent = t; }, 60); };
O.empty = function(o){ return '<div class="ow-empty"><div class="ill">' + ic(o.icon || "check-circle", 44) + '</div><h2>' + esc(o.title) + '</h2>' + (o.text ? '<p>' + o.text + '</p>' : '') + (o.action || '') + '</div>'; };
O.skel = function(n, label){ var h = ''; for (var i = 0; i < (n || 3); i++) h += '<div class="skel"></div>'; return '<div><span class="vh" role="status">' + esc(label || "Зареждаме …") + '</span><div class="ow-skel" aria-hidden="true"><div class="skel s"></div>' + h + '</div></div>'; };
O.eur0 = function(v){ return Math.round(v).toLocaleString("bg-BG").replace(/\s/g, " ") + " €"; };
O.f1 = function(v){ return (Math.round(v * 10) / 10).toFixed(1).replace(".", ","); };
O.pct = function(cur, prev){ if (!prev) return null; return Math.round((cur - prev) / prev * 100); };
/* разлика: знак, процент и дума; цветът е само на иконата (никога сам). inv: „повече“ е лошо (неявили се, разход) */
O.delta = function(cur, prev, o){ o = o || {}; var p = O.pct(cur, prev); if (p == null) return o.none != null ? o.none : '';
  var cls = p === 0 ? "flat" : ((p > 0) !== !!o.inv ? "up" : "down"), word = p === 0 ? "без промяна" : p > 0 ? (o.more || "повече") : (o.less || "по-малко");
  return '<span class="ow-d ' + cls + (o.chip ? ' dchip' : '') + '">' + '<span class="p">' + ic(p === 0 ? "minus" : p > 0 ? "caret-up" : "caret-down", 18) + (p > 0 ? "+" : "") + p + '%</span>' + '<small><span class="w">' + word + '</span>' + (o.vs ? ' ' + esc(o.vs) : '') + '</small></span>'; };

/* ---------- права и сесия ---------- */
O.allowed = function(){ return !!A.me && O.ALLOWED.indexOf(A.me.role) > -1; };
/* друга роля: началото ѝ по правилата на админа (A.homeOf + A.adminHref: своя модул или таблото според запомнения избор) */
O.homeOf = function(role){ return A.adminHref(A.homeOf(role)); };
O.logout = function(){ A.logout(); };
/* на въпросите от агенцията отговаря само собственикът (главният админ ги вижда само за четене) */
O.canAnswer = function(){ return !!A.me && A.me.role === "owner"; };

/* ---------- въпросите от агенцията (docs/OPEN-QUESTIONS.md, дословно) ---------- */
O.QUESTIONS = [
  ["r1","1","r","","Онлайн плащания (виртуален POS) или само на място?","само на място"],
  ["r2","2","r","","Депозит за резервации и празници?","няма"],
  ["r3","3","r","","Калкулатор на празник: показва ли ориентировъчна цена?","превключвател в админа"],
  ["r4","4","r","","Каса и СУПТО: коя система, има ли API?","поръчките се печатат / виждат в кухнята, касовата бележка се издава на място"],
  ["r5","5","r","","„Двете бази“: каква е била идеята?","не се прави"],
  ["r6","6","r","","Отзиви в Google: приема ли логиката линк към всички, отстъпка само за вътрешната оценка?","да"],
  ["r7","7","r","","Права на управителя: какво остава само за собственика?","като собственика без финанси, роли и дневник; така е и в прототипа на админа"],
  ["r8","8","r","","Блокиране на неявили се: след колко неявявания, как се отблокира?","след 2, отблокира управителят"],
  ["r9","9","r","","Смяна на съставка: безплатно, по-скъпата цена или само някои?","групата „Смени“ е скрита"],
  ["r11","11","r","","Резервации от Google (Reserve with Google) или само собствената система?","само собствената"],
  ["r12","12","r","","Размери на отстъпките: регистрация, ранна резервация, рожден ден.","-10%, -5%, -10% или торта"],
  ["r12a","12а","r","","Бонусът -10% при регистрация: има ли срок на валидност?","без срок, еднократен, за първата поръчка след регистрацията"],
  ["r13","13","r","","Колко дни по-рано е „ранна резервация“ за празник?","[ЛИПСВА]"],
  ["r14","14","r","","-5% важи ли и за тематични вечери (Гръцка вечер)?","не, само празник"],
  ["r15","15","r","","Печати за лоялност: за какво се дава печат и каква е наградата при 10?","[ЛИПСВА]"],
  ["r16","16","r","","Ваучери: валидност; комбинират ли се отстъпките?","не се комбинират; валидност [ЛИПСВА]"],
  ["r17","17","r","","Обща поръчка за офиса: ръчно изпращане след крайния час? Колегите без профил? Отделно плащане на шофьора?","автоматично в крайния час; без профил е позволено; едно плащане"],
  ["r18","18","r","","Часове за резервации и правило за маса (колко души на маса).","11:00-21:30 през 30 мин; масата е за броя места"],
  ["r17a","17а","r","","Горна граница на една онлайн поръчка (над нея: „обадете се“) и на обща поръчка за офиса.","60 порции и 500 € на поръчка; офис: до 10 порции на човек, до 60 души, до 500 €; сменят се в ORDER_RULES"],
  ["r18a","18а","r","","Колко време се пази масата при резервация (кога се освобождава за следващи гости)?","2 часа; настройка в админа"],
  ["r19","19","r","","Резервен интернет за кухнята и персонала.","екран „Няма връзка“ с указания"],
  ["r20","20","r","","Google Cloud профил за маршрути с трафик или само VROOM / OSRM.","само VROOM / OSRM"],
  ["r21","21","r","","Кога кухнята е „натоварена“ и с колко минути расте времето.","ръчен превключвател в кухнята, +20 мин: „около 35 мин“ → „около 55 мин“; минутите се сменят от админа"],
  ["r22","22","r","","Пекат ли се пиците във фурната Bertha?","текстът не го твърди"],
  ["r23","23","r","","„Изчерпано днес“: да се нулира ли само на следващия ден, или ястието остава изчерпано, докато някой не го върне ръчно?","нулира се само в полунощ по София; ключът е за днешния ден; поръчка „за утре“ не се засяга"],
  ["m1","1","m","QR маса и сервитьор","Повикване: колко минути между две еднакви повиквания и след колко минути без отговор отива при управителя? Едно и също за всички причини или по-кратко за „Сметка“?","3 мин интервал; цвят след 2 и 5 мин, при управителя след 5 мин, еднакво за всички"],
  ["m2","2","m","QR маса и сервитьор","Втори праг за поето, но неотбелязано „Обслужено“ повикване?","няма"],
  ["m3","3","m","QR маса и сервитьор","Може ли сервитьор да поеме повикване от чужда маса?","да, ако никой не го е поел"],
  ["m5","5","m","QR маса и сервитьор","Може ли всеки на масата да променя и маха ястията на другите в общата количка?","да, вижда се на всички телефони"],
  ["m6","6","m","QR маса и сервитьор","Поръчва ли се обедното меню от масата до 15:00?","[ЛИПСВА] в менюто на масата"],
  ["m7","7","m","QR маса и сервитьор","Стековете Black Angus („за 100 гр.“): кой въвежда точния грамаж след рязане, кухнята или сервитьорът, и как става при поръчка от масата?","сервитьорът, лист „Грамаж“ 300-600 гр. или друг"],
  ["m8","8","m","QR маса и сервитьор","Сметка „По ястия“: нужна ли е, или стига „По гости“? Една касова бележка с отделни плащания или бележка за всеки?","и трите начина; бележка за всяко плащане"],
  ["m9","9","m","QR маса и сервитьор","Плащане с ваучер на масата?","няма"],
  ["m10","10","m","QR маса и сервитьор","Кодът -10% от оценката за гост без профил: само на телефона или срещу телефонен номер („веднъж на номер“)?","само на телефона"],
  ["m11","11","m","QR маса и сервитьор","Причина при отказ на QR поръчка: задължителна ли е?","да"],
  ["m12","12","m","QR маса и сервитьор","„Отивам“ и за готово ястие, за да не тръгнат двама?","само „Сервирах“"],
  ["m13","13","m","QR маса и сервитьор","Нощна тема за персонала от 18:00 като стандарт?","изборът е на телефона; „По часа“ е тъмна 18:00-07:00"],
  ["m14","14","m","QR маса и сервитьор","Кои часовници поддържаме: Wear OS, Apple Watch или само известия от телефона?","само известия от телефона"],
  ["m15","15","m","Кухня","Кой може да включва „Натоварено“: всяка секция или само главният готвач? Напомняне след 60 мин?","всяка секция, с напомняне"],
  ["m16","16","m","Кухня","Срок за всяко ястие или за канал? Колко минути преди срока е „наближава“?","20 мин за канал, „наближава“ 5 мин преди"],
  ["m17","17","m","Кухня","Поръчка за час: влиза в кухнята 20 мин преди часа или според ястието?","20 мин преди"],
  ["m18","18","m","Кухня","Изчерпаното днес: кога се връща в менюто?","в полунощ по София, както в кода; виж въпрос 23 в „За собственика: решения“ и DECISIONS 12.11. Прототипът на кухнята казва „утре в 10:00“: остава за решение"],
  ["m19","19","m","Кухня","При изчерпване в приета поръчка за доставка или вземане: кой се обажда на клиента?","управителят"],
  ["m20","20","m","Кухня","Поръчка от няколко секции: сервитьорът се известява за всяка готова секция, а шофьорът и клиентът, когато всичко е готово?","да"],
  ["m21","21","m","Кухня","Печат на бон в кухнята при срив или само екран?","само екран"],
  ["m22","22","m","Шофьор","Кара ли всеки шофьор една и съща кола?","колата се избира при вход, смяна в смяната е позволена"],
  ["m23","23","m","Шофьор","Колко чака шофьорът при „Няма никой“ и какво става с храната (връща се, плаща ли клиентът)?","[ЛИПСВА], решава ресторантът по телефона"],
  ["m24","24","m","Шофьор","Има ли терминал за карти в колата?","„Карта при получаване“ е [ЛИПСВА: терминал]"],
  ["m25","25","m","Шофьор","Парите се предават на управителя или на касата; в края на смяната или след всеки курс?","в края на смяната, на кого е [ЛИПСВА]"],
  ["m26","26","m","Шофьор","Може ли горивото да се плаща в брой от събраните пари?","да, вади се от „За предаване“"],
  ["m27","27","m","Шофьор","Може ли шофьорът сам да смени реда на адресите?","да, „Моят ред“"],
  ["m28","28","m","Шофьор","Екран „Колата е в движение“ (по GPS скоростта)?","да"],
  ["m29","29","m","Управител и Собственик","QR поръчка, която никой не е потвърдил: след колко минути отива при управителя?","3 мин"],
  ["m30","30","m","Управител и Собственик","Адрес извън зоните: управителят решава „Да я достави“ или „Върни я в ресторанта“. Има ли трети вариант (по-висока такса, вземане от място)?","само двата"],
  ["m31","31","m","Управител и Собственик","„Приеми“ от телефона на управителя праща поръчката направо в кухнята („Готви се“). Така ли?","да"],
  ["m32","32","m","Управител и Собственик","„Обади се на клиента“: вижда ли управителят телефона без маска?","да, обаждането влиза в дневника"],
  ["m33","33","m","Управител и Собственик","Известие при отклонение на оборота: праг 20% под или над обичайното до същия час? Само в модула или и като известие на телефона?","20%, само в модула"],
  ["m34","34","m","Управител и Собственик","„Обичайното“ за деня: средно от същия ден в последните 4 или 8 седмици?","4"],
  ["m35","35","m","Управител и Собственик","Отчети по имейл: и седмичният (понеделник 6:00), и месечният (1-во число)? На кой имейл?","и двата, имейлът е [ЛИПСВА]"],
  ["v1","","r","","Ваучерите SCV-, за собственика: колко време са валидни? (Онлайн не се приемат, решено 16.11.)","Предложение: 12 месеца; дотогава валидност [ЛИПСВА]"]
].map(function(x){ return {id:x[0], n:x[1], sec:x[2], grp:x[3] || "Решения", text:x[4], def:x[5]}; });
O.GROUPS = [["r","Решения за ресторанта"],["m","Модулите: QR маса и сервитьор, кухня, шофьор"]];
/* отговорите са в sa-notes (бележки при главния админ), kind:"answer"; последният отговор на въпроса печели */
O.answers = function(){ var m = {}; A.notes.list().slice().reverse().forEach(function(n){ if (n.kind === "answer" && n.q && n.q.id) m[n.q.id] = n; }); return m; };
O.unanswered = function(){ var a = O.answers(); return O.QUESTIONS.filter(function(q){ return !a[q.id]; }); };
/* въпроси за факт: „Съгласен“ не носи отговор, затова там е само „Твоят отговор“ */
O.FACT = ["r4","r5","r22","m6","m18","m24"];
O.hasDefault = function(q){ return q.def && O.FACT.indexOf(q.id) < 0 && !/^\[ЛИПСВА[^\]]*\]$/.test(q.def.trim()); };


/* ---------- „Чака те“ за собственика (същото правило като таблото на админа: значката = сборът на редовете за „Решения“) ---------- */
O.nextQuestion = function(){ var a = O.answers(); return O.QUESTIONS.filter(function(q){ return !a[q.id]; })[0] || null; };
O.waits = function(){ var nw = A.notesWaiting(), W = [], empty = O.st === "empty";
  var bp = empty ? 0 : A.blocksPending();
  if (bp) W.push({n:bp, icon:"warning-circle", title:"Неявили се за решение", sub:"Две неявявания: блокиране или не", href:"decisions.html#noshow", go:"Реши", dec:true});
  var nq = empty || !O.canAnswer() ? null : O.nextQuestion(), left = nq ? O.unanswered().length : 0;
  if (nq) W.push({n:1, icon:"chat-circle-dots", title:"Следващ въпрос от агенцията", sub:nq.text.length > 70 ? nq.text.slice(0, 68).replace(/\s+\S*$/, "") + " …" : nq.text, more:left > 1 ? "Още " + (left - 1) + " чакат отговор" : "", href:"decisions.html#q=" + nq.id, go:"Отговори", dec:true});
  if (A.isMainAdmin()){ if (nw.newN) W.push({n:nw.newN, icon:"pencil-simple", title:"Бележки за одобрение", sub:"Нови бележки и препоръки", href:"../pages-admin/notes.html#s=new", go:"Одобри"}); }
  else if (nw.n) W.push({n:nw.n, icon:"pencil-simple", title:"Твоите препоръки", sub:nw.n === 1 ? "1 твоя препоръка е с нов статус" : nw.n + " твои препоръки са с нов статус", href:"../pages-admin/notes.html", go:"Виж"});
  return W; };
O.decisionsBadge = function(){ return O.waits().filter(function(x){ return x.dec; }).reduce(function(a, x){ return a + x.n; }, 0); };

/* ---------- графики (прости SVG и HTML; текстът е в HTML) ---------- */
O.TIPS = {}; O.showTbl = {};
function niceMax(v){ if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
O.niceMax = niceMax;
/* подписите на оста X: при колони всеки е центриран под своята колона; при линия под точката */
function xLabels(labels, xn, ticks, line){ var n = labels.length, step = Math.ceil(n / (xn || 7)), idx = [];
  if (ticks) idx = ticks.slice(); else { for (var k = 0; k < n; k += step) idx.push(k); if (idx[idx.length - 1] !== n - 1){ if (n - 1 - idx[idx.length - 1] < step * .7 && idx.length > 1) idx[idx.length - 1] = n - 1; else idx.push(n - 1); } }
  return '<div class="xa" aria-hidden="true">' + idx.map(function(i){ var left = n === 1 ? 50 : line ? i / (n - 1) * 100 : (i + .5) / n * 100, tr = line && i === 0 ? "0" : line && i === n - 1 ? "-100%" : "-50%";
    return '<span style="left:' + left + '%;transform:translateX(' + tr + ')">' + esc(labels[i]) + '</span>'; }).join("") + '</div>'; }
function yAxis(nice, fmt){ fmt = fmt || String; return '<div class="ya" aria-hidden="true"><span>' + fmt(nice) + '</span><span>' + fmt(nice / 2) + '</span><span>' + fmt(0) + '</span></div>'; }
function grid(){ return '<div class="grid"><i></i><i></i><i></i></div>'; }
/* колони: items [{l, v, v2, hi, t, tv}], prev: [стойности] като линия (сравнението) */
O.cols = function(id, items, o){ o = o || {}; var prev = o.prev || null, mx = Math.max.apply(null, items.map(function(x){ return (x.v || 0) + (x.v2 || 0); }).concat(prev ? prev : []).concat([1])), nice = niceMax(mx), n = items.length;
  O.TIPS[id] = items.map(function(x, i){ return {t:x.t, tv:x.tv + (prev && o.prevTip ? o.prevTip(i) : '')}; });
  var cols = '<div class="cols">' + items.map(function(x, i){ var h = (x.v || 0) / nice * 100, h2 = (x.v2 || 0) / nice * 100;
    return '<span data-i="' + i + '"' + (x.v2 ? ' class="st"' : '') + '>' + (x.v2 ? '<i class="ns" style="height:' + h2 + '%"></i>' : '') + '<i' + (x.hi ? ' class="hi"' : '') + ' style="height:' + Math.max(h, x.v ? .8 : 0) + '%' + (x.v2 ? ';border-radius:0' : '') + '"></i></span>'; }).join("") + '</div>';
  var line = prev ? '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline class="ln prev" points="' + prev.map(function(v, i){ return ((i + .5) / n * 100).toFixed(2) + "," + (100 - v / nice * 100).toFixed(2); }).join(" ") + '"/></svg>' : '';
  return '<div class="ow-plot" data-plot="' + id + '">' + yAxis(nice, o.fmt) + '<div class="area">' + grid() + cols + line + '</div>' + xLabels(items.map(function(x){ return x.l; }), o.xn) + '</div>'; };
/* линия: cur и prev [стойности]; cur може да свършва по-рано (днес до сега) */
O.line = function(id, labels, cur, prev, o){ o = o || {}; var n = labels.length, all = cur.concat(prev || []).filter(function(v){ return v != null; }), nice = niceMax(Math.max.apply(null, all.concat([1])));
  function pts(a){ return a.map(function(v, i){ return v == null ? null : ((i / (n - 1)) * 100).toFixed(2) + "," + (100 - v / nice * 100).toFixed(2); }).filter(Boolean).join(" "); }
  function pos(a){ var i = -1; a.forEach(function(v, j){ if (v != null) i = j; }); return i < 0 ? null : {x:i / (n - 1) * 100, y:100 - a[i] / nice * 100, v:a[i]}; }
  O.TIPS[id] = labels.map(function(l, i){ return {t:l, tv:(cur[i] != null ? (o.curName || "Днес") + ": " + (o.fmt || String)(cur[i]) : "") + (prev && prev[i] != null ? (cur[i] != null ? " · " : "") + (o.prevName || "Обичайно") + ": " + (o.fmt || String)(prev[i]) : "")}; });
  var pc = pos(cur), pp = prev ? pos(prev) : null, cpts = pts(cur);
  var svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + (cpts ? '<polygon class="wash" points="0,100 ' + cpts + ' ' + (pc ? pc.x.toFixed(2) : 0) + ',100"/>' : '') + (prev ? '<polyline class="ln prev" points="' + pts(prev) + '"/>' : '') + '<polyline class="ln cur" points="' + cpts + '"/></svg>';
  var dots = (pp ? '<i class="dot prev" style="left:' + pp.x + '%;top:' + pp.y + '%"></i>' : '') + (pc ? '<i class="dot" style="left:' + pc.x + '%;top:' + pc.y + '%"></i>' : '');
  /* подписът на днешната точка стои над нея (не върху линията на обичайното) */
  var py = null; if (pc && prev){ var ix = Math.round(pc.x / 100 * (n - 1)); if (prev[ix] != null) py = 100 - prev[ix] / nice * 100; }
  /* подписът не стои върху линията на обичайното: ако тя е точно над точката, подписът е под нея */
  var below = py != null && py < pc.y && pc.y - py < 18;
  var bl = below || (pc && pc.y < 15), lx = pc ? (bl && o.nowX != null ? Math.max(pc.x, o.nowX) : pc.x) : 0; /* вдясно: след линията „сега“, не върху нея */
  var labs = (pc && o.curLabel ? '<span class="elab ' + (bl ? 'bl' : 'l') + '" style="left:' + lx + '%;top:' + pc.y + '%">' + esc(o.curLabel) + '</span>' : '');
  var now = o.nowX != null ? '<i class="now" style="left:' + o.nowX + '%"></i>' : '';
  return '<div class="ow-plot" data-plot="' + id + '" data-line="1">' + yAxis(nice, o.fmt0 || o.fmt) + '<div class="area">' + grid() + svg + now + dots + labs + '</div>' + xLabels(labels, o.xn, o.ticks, true) + '</div>'; };
O.legend = function(items){ return '<ul class="ow-lgd">' + items.map(function(x){ return '<li><i class="' + (x[1] || '') + '"></i>' + esc(x[0]) + '</li>'; }).join("") + '</ul>'; };
/* ленти: {n, icon, v, vt, sub (дял с дума), d (разликата, на свой ред)} */
O.hbars = function(rows){ var mx = Math.max.apply(null, rows.map(function(r){ return r.v; }).concat([1e-9]));
  return '<div class="ow-hb">' + rows.map(function(r){ return '<div class="r"><span class="n">' + (r.icon ? ic(r.icon, 20) : '') + '<span>' + esc(r.n) + '</span></span><span class="v">' + r.vt + '</span><span class="tr" aria-hidden="true"><i style="width:' + (r.v / mx * 100) + '%"></i></span>' +
    (r.sub ? '<span class="s">' + r.sub + '</span>' : '') + (r.d ? '<span class="dd">' + r.d + '</span>' : '') + '</div>'; }).join("") + '</div>'; };
O.tableHTML = function(t, cap){ return '<div class="ow-tablewrap"><table class="ow-table">' + (cap ? '<caption class="vh">' + esc(cap) + '</caption>' : '') + '<thead><tr>' + t.head.map(function(h, i){ return '<th scope="col"' + (i ? ' class="r"' : '') + '>' + esc(h) + '</th>'; }).join("") + '</tr></thead><tbody>' +
  t.rows.map(function(r){ return '<tr>' + r.map(function(c, i){ return i ? '<td class="r" data-label="' + esc(t.head[i]) + '">' + esc(c) + '</td>' : '<th scope="row" data-main>' + esc(c) + '</th>'; }).join("") + '</tr>'; }).join("") + '</tbody></table></div>'; };
/* карта с графика и бутон „Таблица“ / „Графика“ (думата казва какво ще покаже; без aria-pressed) */
O.card = function(o){ var id = o.id, tb = !!O.showTbl[id], plain = String(o.title).replace(/<[^>]+>/g, "");
  return '<section class="ow-card ' + (o.cls || '') + '" aria-labelledby="h-' + id + '" data-edit-id="own.' + (o.page || "card") + '.' + id + '"' + (o.anchor ? ' id="' + o.anchor + '"' : '') + '><header><div><h2 id="h-' + id + '">' + o.title + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</h2></div>' +
    (o.table ? '<button class="pill pill-soft ow-tbtn" type="button" data-tbl="' + id + '" aria-label="' + (tb ? 'Графика: ' : 'Таблица: ') + esc(plain) + '">' + ic(tb ? "chart-bar" : "list-bullets", 18) + (tb ? 'Графика' : 'Таблица') + '</button>' : '') + '</header>' +
    (tb && o.table ? O.tableHTML(o.table, plain) : o.inner) + (o.extra || '') + '</section>'; };
O.bindTips = function(root){ root.querySelectorAll("[data-plot]").forEach(function(pl){ var data = O.TIPS[pl.dataset.plot]; if (!data || pl._tip) return; pl._tip = 1; var area = pl.querySelector(".area"), tip = document.createElement("div"); tip.className = "ow-tip"; tip.hidden = true; pl.appendChild(tip);
  pl.addEventListener("pointermove", function(e){ var r = area.getBoundingClientRect(), line = pl.dataset.line, n = data.length, i = line ? Math.round((e.clientX - r.left) / r.width * (n - 1)) : Math.floor((e.clientX - r.left) / r.width * n);
    if (i < 0 || i >= n || !data[i].tv){ tip.hidden = true; return; }
    pl.querySelectorAll(".cols span").forEach(function(b){ b.classList.toggle("on", +b.dataset.i === i); });
    var pr = pl.getBoundingClientRect(), x = line ? i / (n - 1) * r.width : (i + .5) / n * r.width; tip.hidden = false; tip.innerHTML = esc(data[i].tv) + '<small>' + esc(data[i].t) + '</small>';
    tip.style.left = Math.max(90, Math.min(pr.width - 90, r.left - pr.left + x)) + "px"; tip.style.top = "0px"; });
  pl.addEventListener("pointerleave", function(){ tip.hidden = true; pl.querySelectorAll(".cols span.on").forEach(function(b){ b.classList.remove("on"); }); }); }); };

/* ---------- период и сравнение (Тенденции и Финанси) ----------
   „Предишния период“: като в „Отчети“ на админа; за „Днес“ и „Вчера“ същият ден миналата седмица.
   „Миналата година“: същият ден от седмицата (364 дни назад), както „по ден от седмицата“ в GA4. */
O.per = {per:"7", cmp:"prev", cust:{a:H.addD(H.TODAY, -13), b:H.TODAY}};
(function(){ var h = A.hash; if (h.p && H.PERIODS.some(function(p){ return p[0] === h.p; })) O.per.per = h.p; if (h.c === "year") O.per.cmp = "year";
  if (h.a && h.b && /^\d{4}-\d\d-\d\d$/.test(h.a) && /^\d{4}-\d\d-\d\d$/.test(h.b)) O.per.cust = {a:h.a, b:h.b}; })();
O.ranges = function(){ var p = O.per, R = H.range(p.per, p.cust), one = R[0] === R[1], day = p.per === "today" || p.per === "yday";
  var C = p.cmp === "year" ? [H.addD(R[0], -364), H.addD(R[1], -364)] : day ? [H.addD(R[0], -7), H.addD(R[1], -7)] : H.prevRange(R[0], R[1], p.per);
  var upTo = p.per === "today" ? A.hm(A.now()) : "", yr = p.cmp === "year" ? " " + (+C[1].slice(0, 4)) : "";
  /* годината е след датата, преди часа: „вт, 18 ное 2025 до 12:30“ */
  var cl = C[0] === C[1] ? H.fd(C[0], true) + yr + (upTo ? " до " + upTo : "") : H.fd(C[0], true) + " - " + H.fd(C[1], true) + yr;
  return {R:R, C:C, one:one, upTo:upTo, label:one ? H.fd(R[0]) : H.fd(R[0], true) + " - " + H.fd(R[1], true),
    cmpLabel:p.cmp === "year" ? "същите дни от седмицата миналата година: " + cl : day ? "същия ден миналата седмица: " + cl : "предишния период: " + cl,
    cmpShort:p.cmp === "year" ? "миналата година" : day ? "същия ден миналата седмица" : "предишния период"}; };
/* сборовете за избрания период и за сравнението (днес: до същата минута, както на „Днес“) */
O.aggs = function(){ var g = O.ranges(), cur = H.agg(g.R[0], g.R[1]), prev = H.agg(g.C[0], g.C[1]), s = A.sofia(); if (g.upTo) prev = H.cutAt(prev, s.h, s.m); return {g:g, cur:cur, prev:prev}; };
O.periodHTML = function(){ var p = O.per;
  return '<div class="ow-per" data-edit-id="own.period"><div class="pp"><p class="lbl" id="ow-pl">Период</p><div class="seg" role="group" aria-labelledby="ow-pl">' + H.PERIODS.map(function(x){ return '<button type="button" data-per="' + x[0] + '" aria-pressed="' + (p.per === x[0]) + '">' + x[1] + '</button>'; }).join("") + '</div></div>' +
    '<div class="pc"><p class="lbl" id="ow-cl">Сравни с</p><div class="seg cmp" role="group" aria-labelledby="ow-cl"><button type="button" data-cmp="prev" aria-pressed="' + (p.cmp === "prev") + '">Предишния период</button><button type="button" data-cmp="year" aria-pressed="' + (p.cmp === "year") + '">Миналата година</button></div></div>' +
    (p.per === "custom" ? '<div class="ow-cust"><div class="field"><label for="ow-a">От</label><input class="input" id="ow-a" type="date" max="' + H.TODAY + '" value="' + p.cust.a + '" data-ca aria-describedby="ow-ch"></div><div class="field"><label for="ow-b">До</label><input class="input" id="ow-b" type="date" max="' + H.TODAY + '" value="' + p.cust.b + '" data-cb aria-describedby="ow-ch"></div><p class="ow-note" id="ow-ch" style="margin:0 0 14px">' + esc(H.fd(p.cust.a) + " - " + H.fd(p.cust.b)) + '. Най-много 92 дни.</p></div>' : '') + '</div>'; };
O.periodHash = function(extra){ var p = O.per, h = Object.assign({}, A.hash, {p:p.per === "7" ? "" : p.per, c:p.cmp === "year" ? "year" : "", a:p.per === "custom" ? p.cust.a : "", b:p.per === "custom" ? p.cust.b : ""}, extra || {}); A.setHash(h); };
O.bindPeriod = function(root, redraw){ A.liveHash = true;
  function told(){ var g = O.ranges(); O.say("Период " + g.label + ", сравнение с " + g.cmpShort + "."); }
  root.addEventListener("click", function(e){ var t = e.target.closest("[data-per], [data-cmp]"); if (!t || !root.contains(t)) return;
    if (t.dataset.per) O.per.per = t.dataset.per; else O.per.cmp = t.dataset.cmp; O.periodHash(); redraw(); told(); var b = root.querySelector(t.dataset.per ? '[data-per="' + t.dataset.per + '"]' : '[data-cmp="' + t.dataset.cmp + '"]'); b && b.focus({preventScroll:true}); });
  root.addEventListener("change", function(e){ var t = e.target; if (!t.matches("[data-ca], [data-cb]")) return; var a = root.querySelector("[data-ca]").value, b = root.querySelector("[data-cb]").value; if (!a || !b) return;
    if (a > b){ var x = a; a = b; b = x; } if (b > H.TODAY) b = H.TODAY; var cut = H.span(a, b) > 92; if (cut) a = H.addD(b, -91); O.per.cust = {a:a, b:b}; O.periodHash(); redraw(); told();
    if (cut) O.toast("Най-много 92 дни: показваме " + H.fd(a, true) + " - " + H.fd(b, true)); var f = root.querySelector(t.matches("[data-ca]") ? "[data-ca]" : "[data-cb]"); f && f.focus({preventScroll:true}); }); };

/* ---------- известие (едно наведнъж; на телефон под горната лента, на компютър долу в средата) ---------- */
var toastT;
O.toast = function(text, o){ o = o || {}; var t = O.ov.querySelector(".ow-toast");
  if (!t){ t = document.createElement("div"); t.className = "ow-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); O.ov.appendChild(t); }
  t.innerHTML = '<span class="tx">' + esc(text) + '</span>' + (o.action ? (o.action.href ? '<a href="' + esc(o.action.href) + '">' + esc(o.action.label) + ic("caret-right", 18) + '</a>' : '<button type="button" data-ta>' + esc(o.action.label) + '</button>') : '') + (o.undo ? '<button type="button" data-tu>' + ic("arrow-counter-clockwise", 18) + esc(o.undoLabel || "Отмени") + '</button>' : '');
  var u = t.querySelector("[data-tu]"); if (u) u.onclick = function(){ hide(); o.undo(); };
  var a = t.querySelector("[data-ta]"); if (a) a.onclick = function(){ hide(); o.action.fn(); };
  function hide(){ t.classList.remove("on"); document.body.classList.remove("ow-toast-on"); }
  requestAnimationFrame(function(){ t.classList.add("on"); document.body.classList.add("ow-toast-on"); }); clearTimeout(toastT);
  toastT = setTimeout(hide, o.ms || (o.undo ? 6000 : 3400)); };

/* ---------- лист (sc.css: отдолу на телефон, вдясно от 900 px); фокусът стои вътре, Esc затваря ---------- */
O.sheet = function(o){ var w = document.createElement("div"), id = "ow" + Math.random().toString(36).slice(2, 8); w.className = "sheetwrap";
  w.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle"></div><div class="sheet-h"><h2 id="' + id + '">' + esc(o.title || "") + '</h2><button class="hb" type="button" data-close>' + ic("x", 20) + 'Затвори</button></div><div class="body">' + (o.html || "") + '</div>' + (o.foot ? '<div class="ow-sfoot">' + o.foot + '</div>' : '') + '</div>';
  O.ov.appendChild(w); document.body.classList.add("ow-sheet");
  var prev = document.activeElement, bg = [O.rail, O.col, O.bnav, O.skip, O.penSlot].filter(Boolean); bg.forEach(function(el){ el.inert = true; });
  w.addEventListener("keydown", function(e){ if (e.key === "Escape"){ e.preventDefault(); close(); return; } if (e.key !== "Tab") return;
    var f = Array.prototype.filter.call(w.querySelectorAll(".sheet button:not([disabled]), .sheet a[href], .sheet input:not([disabled]), .sheet textarea, .sheet select"), function(el){ return el.offsetParent !== null; });
    if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a){ e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z){ e.preventDefault(); a.focus(); } });
  var closed = false;
  function close(){ if (closed) return; closed = true; if (O.ov.querySelectorAll(".sheetwrap.on").length <= 1){ bg.forEach(function(el){ el.inert = false; }); document.body.classList.remove("ow-sheet"); } w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 340); o.onClose && o.onClose(); if (!o.noReturn && prev && prev.isConnected && prev.focus) prev.focus({preventScroll:true}); }
  w.querySelector(".scrim").onclick = close; w.querySelector("[data-close]").onclick = close;
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ w.classList.add("on"); var f = o.focus ? w.querySelector(o.focus) : w.querySelector(".sheet-h h2"); if (f && !o.focus) f.setAttribute("tabindex", "-1"); f && f.focus({preventScroll:true}); }); });
  return {el:w, body:w.querySelector(".body"), foot:w.querySelector(".ow-sfoot"), close:close}; };
O.confirm = function(o, onOk){ var s = O.sheet({title:o.title, noReturn:!!o.noReturn, html:'<p>' + (o.text || "") + '</p>',
  foot:'<button class="pill pill-line pill-lg" type="button" data-no>Откажи</button><button class="pill ' + (o.danger ? 'pill-red' : 'pill-ink') + ' pill-lg" type="button" data-yes>' + (o.icon ? ic(o.icon, 22) : '') + esc(o.ok || "Да") + '</button>'});
  s.foot.querySelector("[data-no]").onclick = s.close; s.foot.querySelector("[data-yes]").onclick = function(){ s.close(); onOk && onOk(); }; return s; };

/* ---------- профил ---------- */
var THEMES = [["system","Авто","circles-three"],["light","Светла","sun"],["dark","Тъмна","moon"]];
function openProfile(){ var r = A.role(A.me.role);
  /* по образеца на листа „Профил“ в модула на управителя: връзките с подзаглавие къде водят, после темата, изходът долу */
  function row(href, icon, t, sub, extra){ return '<a class="ow-setrow" href="' + href + '"' + (extra || '') + '><span class="si">' + ic(icon, 22) + '</span><span><b>' + t + '</b><small>' + sub + '</small></span>' + ic("caret-right", 20) + '</a>'; }
  O.sheet({title:"Профил", html:'<div class="ow-prof"><span class="ow-av" aria-hidden="true">' + esc(A.initials(A.me.name)) + '</span><div><b>' + esc(A.me.name) + '</b><span class="ow-muted">' + esc(r ? r.n : A.me.role) + '</span></div></div>' +
    '<div class="ow-setlist">' + row("../pages-upravitel/now.html", "users-three", "Смяната сега", "Модулът на управителя: залата, кухнята, шофьорите") +
      row("../pages-admin/dashboard.html", "squares-four", "Към админа", "Пълната работа: поръчки, резервации, меню, отчети", ' data-home="admin"') +
      row("../pages-admin/notes.html#src=" + esc(A.me.role), "pencil-simple", "Моите препоръки", "Какво предложи с молива и докъде е стигнало") + '</div>' +
    '<h3 class="ow-sh3" id="ow-thl">Тема</h3><div class="seg" role="group" aria-labelledby="ow-thl">' + THEMES.map(function(t){ return '<button type="button" data-ow="settheme" data-v="' + t[0] + '" aria-pressed="' + (A.prefs.theme === t[0]) + '">' + ic(t[2], 20) + t[1] + '</button>'; }).join("") + '</div>',
    foot:'<button class="pill pill-line pill-lg" type="button" data-ow="logout">' + ic("sign-out", 22) + 'Изход</button>'}); }

/* ---------- търсачката: зарежда се при първото отваряне (../ds/search.js + _find.js) ---------- */
O.loadFind = function(cb){ if (window.OF) return cb && cb(); if (O._fl){ O._fl.push(cb); return; } O._fl = [cb];
  function add(src, next){ var s = document.createElement("script"); s.src = src; s.onload = next; s.onerror = function(){ O._fl = null; O.toast("Търсенето не се зареди. Опитай пак."); }; document.head.appendChild(s); }
  function done(){ var l = O._fl || []; O._fl = null; l.forEach(function(f){ f && f(); }); }
  if (window.SCSearch) add("_find.js", done); else add("../ds/search.js", function(){ add("_find.js", done); }); };

/* ---------- рамката ---------- */
function topHTML(o){
  return '<header class="ow-top" data-edit-id="own.top"><div class="ow-ttl"><h1 id="ow-h1">' + (o.shortTitle ? '<span class="lg">' + esc(o.title) + '</span><span class="sm">' + esc(o.shortTitle) + '</span>' : esc(o.title)) + '</h1><small>Собственик · Siracusa</small></div>' +
    '<div class="ow-tsearch" role="search"><label class="vh" for="ow-q">Търси ястие, показател, поръчка</label>' + ic("magnifying-glass", 20) + '<input id="ow-q" type="text" placeholder="Търси: ястие, оборот" autocomplete="off"><button class="clr" type="button" aria-label="Изчисти" hidden>' + ic("x", 18) + '</button></div>' +
    '<button class="ow-tb ph" type="button" data-ow="find">' + ic("magnifying-glass", 24) + 'Търси</button>' +
    '<a class="pill pill-line ow-toadmin" href="../pages-admin/dashboard.html" data-home="admin">' + ic("squares-four", 20) + 'Към админа</a>' +
    '<button class="ow-me" type="button" data-ow="profile"><span class="ow-av" aria-hidden="true">' + esc(A.initials(A.me.name)) + '</span><span class="who"><span class="vh">Профил: </span><b>' + esc(A.me.name) + '</b><small>' + esc(A.roleName(A.me.role)) + '</small></span></button></header>'; }
function navItem(s, cur, cls){ var n = s[0] === "decisions" ? O.decisionsBadge() : 0;
  return '<a class="' + (cls || '') + '" href="' + s[3] + '"' + (cur === s[0] ? ' aria-current="page"' : '') + '>' + ic(s[2], 24) + s[1] + (n ? '<span class="ow-n" aria-hidden="true">' + n + '</span><span class="vh">, ' + n + ' чака' + (n === 1 ? '' : 'т') + ' теб</span>' : '') + '</a>'; }
function protoHTML(o){ var role = A.me ? A.me.role : "";
  return '<section class="ow-proto" aria-label="Само в прототипа" data-edit-id="own.proto"><h2>' + ic("sliders-horizontal", 20) + 'Само в прототипа</h2>' +
    (o.states && o.states.length ? '<p>Състояние на екрана:</p><div class="ow-row">' + o.states.map(function(s){ var h = Object.assign({}, A.hash, {st:s[0]}), q = Object.keys(h).filter(function(k){ return h[k]; }).map(function(k){ return k + "=" + encodeURIComponent(h[k]); }).join("&");
      return '<a class="chip" href="#' + q + '" data-ow="state"' + (O.st === s[0] ? ' aria-current="true"' : '') + '>' + esc(s[1]) + '</a>'; }).join("") + '</div>' : '') +
    '<p>Час на прототипа (днешната дата; смяната пресъздава примерните поръчки и резервации, като в админа):</p><div class="ow-row">' + A.TIMES.map(function(t){ return '<button class="chip" type="button" data-ow="ptime" data-v="' + t + '" aria-pressed="' + (A.protoTime === t) + '">' + t + '</button>'; }).join("") + '</div>' +
    '<p>Виж като:</p><div class="ow-row">' + [["owner","Собственик"],["admin","Главен админ"],["manager","Управител"]].map(function(r){ return '<button class="chip" type="button" data-ow="viewas" data-v="' + r[0] + '" aria-pressed="' + (role === r[0]) + '">' + r[1] + '</button>'; }).join("") + '</div>' +
    '<p>Управителят няма модула Собственик: отива в своето начало. Главният админ вижда двата модула; на въпросите отговаря само собственикът.</p>' +
    '<div class="ow-row"><button class="chip" type="button" data-ow="reset">' + ic("arrow-counter-clockwise", 18) + 'Върни данните в начало</button><a class="chip" href="index.html">' + ic("list", 18) + 'Всички екрани</a><a class="chip" href="../pages-admin/index.html">' + ic("squares-four", 18) + 'Екраните на админа</a></div></section>'; }

O.mount = function(o){ o = o || {}; O.page = o.page;
  /* общата проверка на админа: без сесия → вход с #next=<този адрес>, друга роля → нейното начало */
  if (!o.public && !A.guardModule("sobstvenik")) return null;
  /* #st=noperm (само в прототипа): какво вижда друга роля (Управител) за миг, преди да отиде в своето начало */
  var noperm = O.st === "noperm" && !o.public && !!A.me;
  H.empty = O.st === "empty";
  /* „Отклонение“ (само в прототипа): част от днешните поръчки липсват (с № , завършващ на 0, 1, 5 или 6), за да се види известието */
  if (O.st === "drop") H.todayFilter = function(x){ return (+x.no % 5) >= 2; };
  document.title = (o.docTitle || o.title) + " | Siracusa · Собственик";
  var app = document.createElement("div"); app.className = "ow-app"; app.dataset.page = o.page || "";
  app.innerHTML = '<a class="ow-skip" href="#main">Към съдържанието</a><div class="vh" id="ow-live" aria-live="polite"></div>' +
    '<aside class="ow-rail" aria-label="Разделите на модула"><a class="brand" href="today.html"><b>Siracusa</b><small>Собственик</small></a>' + (A.me ? O.SCREENS.map(function(s){ return navItem(s, o.page, "it"); }).join("") : '') + '</aside>' +
    '<div class="ow-col"><div class="ow-scroller" data-scroller>' + (A.me ? topHTML(o) : '<header class="ow-top"><div class="ow-ttl"><h1 id="ow-h1">' + esc(o.title) + '</h1><small>Собственик · Siracusa</small></div></header>') +
    (O.st === "offline" ? '<div class="ow-net" role="status">' + ic("warning-circle", 22) + '<span><b>Няма връзка</b>Данните са от ' + A.hm(new Date(A.now().getTime() - 60000)) + '</span>' + O.retryBtn() + '</div>' : '') +
    '<main id="main" class="ow-page" tabindex="-1">' + (noperm ? nopermHTML() : '<div data-body></div>') + (A.me ? protoHTML(o) : '') + '<div class="ow-end"></div></main></div></div>' +
    (noperm || !A.me ? '' : '<nav class="ow-bnav" aria-label="Разделите на модула">' + O.SCREENS.map(function(s){ return navItem(s, o.page); }).join("") + '</nav>') + '<div class="ow-penslot"></div><div class="ow-ov"></div>';
  document.body.appendChild(app);
  O.app = app; O.skip = app.querySelector(".ow-skip"); O.rail = app.querySelector(".ow-rail"); O.col = app.querySelector(".ow-col"); O.scroller = app.querySelector(".ow-scroller"); O.ov = app.querySelector(".ow-ov"); O.bnav = app.querySelector(".ow-bnav"); O.penSlot = app.querySelector(".ow-penslot");
  if (noperm) return null;
  bindTopSearch();
  /* моливът: само препоръки (решение 15.11), кръгла икона 56 px; на телефон над долната лента, вдясно. В прегледа на админа връща null: без бутон */
  /* място на молива (решение на шефа, кръг 1): на телефон на реда на долната лента, вдясно от нея; от 900 px най-долу в лявата лента. Никога над съдържанието */
  if (A.me && window.SAPenMount && !A.inPreview){ O.pen = SAPenMount.mount({module:"sobstvenik", slot:O.penSlot, place:"bottom", bottom:92, side:"right", toastWide:"bottom"});
    if (O.pen && O.pen.button) app.classList.add("has-pen"); }
  return app.querySelector("[data-body]"); };
function nopermHTML(){ var r0 = O.allowed() ? "manager" : A.me.role, role = A.roleName(r0), home = O.homeOf(r0), app = /pages-upravitel/.test(home);
  return '<section class="ow-card ow-noperm" data-edit-id="own.noperm">' + O.empty({icon:"lock", title:"Модулът Собственик не е за ролята „" + role + "“", text:"Оборота, финансите и решенията ги виждат само собственикът и главният админ. Отиваш в своето начало.", action:'<a class="pill pill-red pill-lg" href="' + esc(home) + '">' + ic("arrow-right", 22) + (app ? 'Към „Смяната“' : 'Към таблото') + '</a>'}) + '</section>'; }
/* на компютър: полето горе (панел под него); скриптът се зарежда при първия фокус */
function bindTopSearch(){ var inp = O.app.querySelector("#ow-q"); if (!inp) return;
  inp.addEventListener("focus", function(){ O.loadFind(function(){ OF.bindField(inp); }); }, {once:true}); }

/* ---------- делегиране ---------- */
document.addEventListener("click", function(e){ var t = e.target.closest("[data-ow]"); if (!t) return; var a = t.dataset.ow;
  if (a === "profile"){ openProfile(); return; }
  if (a === "logout"){ O.logout(); return; }
  if (a === "find"){ O.loadFind(function(){ OF.open(); }); return; }
  if (a === "settheme"){ A.prefs.theme = t.dataset.v; A.savePrefs(); A.applyTheme(); document.querySelectorAll('[data-ow="settheme"]').forEach(function(b){ b.setAttribute("aria-pressed", String(b.dataset.v === A.prefs.theme)); }); return; }
  if (a === "viewas"){ var acc = A.ACCOUNTS.filter(function(x){ return x[1] === t.dataset.v; })[0]; if (acc) A.login(acc[0]); var h = Object.assign({}, A.hash); delete h.st; location.hash = Object.keys(h).map(function(k){ return k + "=" + encodeURIComponent(h[k]); }).join("&"); location.reload(); return; }
  if (a === "ptime"){ A.setProtoTime(t.dataset.v); location.reload(); return; }
  if (a === "reset"){ A.data.reset(); O.toast("Данните са върнати в начало"); setTimeout(function(){ location.reload(); }, 700); return; }
  if (a === "state"){ e.preventDefault(); location.hash = t.getAttribute("href").slice(1); location.reload(); return; }
  if (a === "retry"){ t.disabled = true; var old = t.innerHTML; t.innerHTML = "Проверяваме …"; setTimeout(function(){ t.disabled = false; t.innerHTML = old; O.toast(O.st === "offline" ? "Още няма връзка. Опитваме сами на всеки 10 сек." : "Още не стана. Опитай пак след малко."); }, 900); return; }
});
document.addEventListener("click", function(e){ var t = e.target.closest("[data-tbl]"); if (!t || !O.redraw) return; var id = t.dataset.tbl; O.showTbl[id] = !O.showTbl[id]; var y = O.scroller.scrollTop; O.redraw(); O.scroller.scrollTop = y; var b = document.querySelector('[data-tbl="' + id + '"]'); b && b.focus({preventScroll:true}); O.say(O.showTbl[id] ? "Показана е таблицата." : "Показана е графиката."); });
})();
