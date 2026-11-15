/* Асистентът = умната търсачка (решение 15.11.2026). Зарежда се при първото отваряне от SC.openAI (ds/sc.js), заедно с ds/search.js.
   Едно поле: докато пишете, резултатите идват веднага от общото ядро (ds/search.js, строи се от src/lib/search.ts) и от реалните
   данни в SC (статус и часове, доставка и зони, събития, оферти, адрес и телефон). Всичко това работи и без интернет.
   Желания („за 4 души, единият не яде лук“, „до 15 €“, „без глутен“) получават и „Попитай AI“: в прототипа това е примерен отговор,
   съставен само от ястия и цени от менюто и ясно отбелязан „Пример: свързването с Claude е етап E“.
   Тук нищо не се измисля: каквото го няма в данните, е „попитайте ни“ с телефона. */
(function(){
"use strict";
var SC = window.SC, S = window.SCSearch, esc = SC.esc, ic = SC.ic, fmt = SC.fmt, R = SC.RESTAURANT;
var TEL = "tel:+359" + R.phone.replace(/\D/g, "").replace(/^0/, "");
var DSH = ["нд","пн","вт","ср","чт","пт","сб"];
function dateBG(d){ return DSH[d.getDay()] + ", " + d.getDate() + " " + SC.MONTHS[d.getMonth()]; }
function joinAnd(a){ return a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " и " + a[a.length - 1]; }
function plural(n){ return SC.plural(n, "ястие", "ястия"); }
var ITEMS = SC.items;
var MAINCATS = ["pitsi","skara-bertha","osnovni-yastia","pasta-i-rizoto","burgeri"];
var LIM = 6;

/* ---------- желанието: хора, цена, „не яде ...“ (в прототипа тук; в кода е отделен модул до ядрото, виж отчета) ---------- */
var NUMW = {"двама":2,"двамата":2,"трима":3,"тримата":3,"четирима":4,"четиримата":4,"петима":5,"шестима":6,"седмина":7,"осмина":8};
var FILL = {"за":1,"ние":1,"сме":1,"единият":1,"единия":1,"едната":1,"един":1,"една":1,"от":1,"нас":1,"другите":1,"останалите":1,"моля":1,"искам":1,"искаме":1,"търся":1,"търсим":1,
  "предложи":1,"предложете":1,"препоръчай":1,"препоръчайте":1,"какво":1,"кое":1,"кои":1,"какви":1,"какъв":1,"да":1,"ни":1,"ми":1,"имате":1,"ли":1,"има":1,"е":1,"са":1,"нещо":1,
  "ястие":1,"ястия":1,"храна":1,"поръчаме":1,"поръчам":1,"хапнем":1,"хапна":1,"в":1,"във":1,"по":1,"към":1,"до":1,"а":1,"но":1,"че":1,"или":1,"for":1,"us":1,"we":1,"are":1,"something":1,"in":1,"to":1,"of":1,"is":1,"any":1};
var NEG = /(^|\s)(?:не\s+(?:яде|ям|ядем|ядат|обича|обичам|обичаме|обичат|понася|понасям|бива)|алергичн\w*\s+(?:към|на)|алергия\s+(?:към|на)|непоносимост\s+към|doesn't\s+eat|don't\s+eat|allergic\s+to)\s+/gi;
var ONE = /(^|\s)(?:единият|единия|едната|един|една|one)(\s|$)/i;
function wish(raw){ var t = " " + String(raw).toLowerCase().replace(/[?!]/g, " ") + " ", w = {people:0, price:0, one:false, core:"", ask:false};
  var m = /(^|\s)(?:до|под|максимум|макс\.?|max|under|up\s+to)\s*(\d+(?:[.,]\d+)?)\s*(€|евро|eur|euro|лв\.?|лева)?(?=\s|$|[.,;])/.exec(t)
       || /(^|\s)()(\d+(?:[.,]\d+)?)\s*(€|евро|eur|euro)(?=\s|$|[.,;])/.exec(t);
  if (m){ var v = parseFloat((m[2] || m[3]).replace(",", ".")), cur = m[3] && !/^\d/.test(m[3]) ? m[3] : m[4]; if (/лв|лева/.test(cur || "")) v = v / 1.95583;
    if (v > 0){ w.price = Math.round(v * 100) / 100; t = t.replace(m[0], " "); } }
  m = /(^|\s)(\d{1,2})\s*(?:души|човека|човек|people|persons|pax)(?=\s|$|[.,;])/.exec(t) || /(^|\s)за\s+(\d{1,2})(?=\s|$|[.,;])/.exec(t);
  if (m){ w.people = Math.min(12, +m[2]); t = t.replace(m[0], " "); }
  else { Object.keys(NUMW).some(function(k){ var re = new RegExp("(^|\\s)" + k + "(?=\\s|$|[.,;])"); if (re.test(t)){ w.people = NUMW[k]; t = t.replace(re, " "); return true; } return false; }); }
  var negs = t.match(NEG); if (negs){ if (ONE.test(t.split(negs[0].trim())[0] + " ")) w.one = true; t = t.replace(NEG, "$1без "); }
  w.ask = /предлож|препоръч|какво да|идея|изнен|recommend|suggest/.test(t);
  w.core = t.split(/[\s,.;:]+/).filter(function(x){ return x && !FILL[x]; }).join(" ");
  return w; }
/* чипът обръща думата в полето; „не яде лук“ става „лук“, „лук“ става „без лук“ */
function toggleRaw(raw, word){ var e = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), re = new RegExp(NEG.source + e + "(?=\\s|$|[.,;?!])", "i");
  if (re.test(raw)) return raw.replace(re, "$1" + word);
  return S.toggle(raw, word); }

/* ---------- информацията: само от реалните данни ---------- */
var INTENTS = [
  ["delivery", /достав|доставя|delivery|зон[аи]|квартал/],
  ["hours", /работн|работите|работи|отворен|отваряте|отваря|затваряте|затвор|часове|работно|до колко|кухня|кухнята|hours|open/],
  ["lunch", /обед|lunch/],
  ["events", /събити|гръцк|тематичн|вечер(?!я)|музик|парти|event/],
  ["party", /рожден|юбиле|кръщен|абитур|фирмен|празн|birthday/],
  ["offers", /оферт|отстъпк|промоц|намал|\d\s*%|offer|discount/],
  ["where", /адрес|къде|как да стигн|стигна|локац|маршрут|where|address/],
  ["contact", /телефон|обад|номер|контакт|имейл|e-?mail|phone/],
  ["reserve", /резерв|запаз|маса за|book|reserv/],
  ["pay", /плащ|плат(?!о)|в брой|ваучер|pay|cash/],
  ["pickup", /вземан|взема|вземете|от място|pickup|take ?away/],
  ["nodata", /паркинг|parking|wi-?fi|детск|деца|бебе|куче|кучета|любимц|капацитет|колко места|колко души|терас|градин|пушач|пушене|smok|инвалид|рампа/]
];
function intents(raw){ var t = String(raw).toLowerCase(), out = {};
  INTENTS.forEach(function(z){ if (z[1].test(t)) out[z[0]] = 1; });
  if (out.delivery && out.hours && !/работ|отвор|затвор|часове|кухн|hours|open/.test(t)) delete out.hours;
  return out; }
function card(icon, title, body){ return '<section class="ainfo"><h3>'+ic(icon,20)+title+'</h3>'+body+'</section>'; }
function link(href, text, ext){ return '<a class="link" href="'+href+'"'+(ext?' target="_blank" rel="noopener"':'')+'>'+text+ic(ext?"arrow-up-right":"caret-right",16)+'</a>'; }
function nowLine(){ var s = SC.state();
  if (s.delivery) return "Сега доставяме, " + SC.eta().text + ".";
  if (s.kitchen) return "Доставката приключи за днес. Вземане от място до 22:30.";
  if (s.open) return "Кухнята затвори за днес. Отворено до 23:00.";
  return "Сега сме затворени. Отваряме в 10:00."; }
function lunchBody(){ var s = SC.state(), today = SC.lunchIsToday(), L = SC.lunch;
  var rule = s.lunchDiscount ? "<p>След 15:00 обедното меню е само за вземане от място, с -30%.</p>" : "<p>Поръчка до 15:00 с доставка или вземане. След 15:00 само за вземане, с -30%.</p>";
  if (!today) return '<p>Обедното меню се качва всяка сутрин.</p>' + rule + '<div class="acts">'+link("lunch.html","Обедно меню")+'</div>';
  var pick = [L[0], L[7], L[12], L[16]].filter(Boolean);
  return '<p>Днес в обедното меню има '+plural(L.length)+', например:</p><ul class="ailist">'+pick.map(function(x){ return '<li>'+esc(x.n)+' · '+fmt(x.p)+'</li>'; }).join("")+'</ul>' + rule + '<div class="acts">'+link("lunch.html","Цялото обедно меню")+'</div>'; }
function infoHTML(it){ var h = "", s = SC.state(), st = SC.status();
  if (it.hours) h += card("clock", "Работно време", '<p>Всеки ден '+R.open+' - '+R.close+'. Кухнята приема поръчки до '+R.kitchen+', доставка до '+R.delivery+'.</p><p class="sub">Сега: '+st.html.replace(/<[^>]+>/g, "")+'</p>');
  if (it.delivery) h += card("moped", "Доставка до "+R.delivery, '<p>'+nowLine()+'</p><p class="sub">Зони и време за доставка:</p><div class="zl">'+SC.ZONES.map(function(z){ return '<span>'+esc(z.n)+'<small>'+esc(z.eta)+(z.free ? " · безплатна" : " · такса: попитайте ни")+'</small></span>'; }).join("")+'</div><div class="acts">'+link("delivery.html","Доставка")+link("pickup.html","Вземи от място")+'</div>');
  if (it.pickup && !it.delivery) h += card("storefront", "Вземи от място", '<p>Поръчайте онлайн и вземете от ресторанта до '+R.kitchen+'. '+(s.lunchDiscount ? "Обедното меню сега е с -30% при вземане." : "")+'</p><div class="acts">'+link("pickup.html","Вземи от място")+'</div>');
  if (it.lunch) h += card("bowl-food", "Обедно меню", lunchBody());
  if (it.events) SC.events().forEach(function(e){ h += card("calendar-blank", esc(e.n), '<p><b>'+dateBG(e.date)+' · '+e.time+'</b> <span class="sub">· '+esc(e.cat)+'</span></p><p>'+esc(e.text)+'</p><p class="sub"><span class="missing">'+esc(e.note)+'</span></p><div class="acts">'+link("event.html#"+e.id,"Запази място")+link("events.html","Всички събития")+'</div>'); });
  if (it.party){ var b = SC.offers().filter(function(o){ return o.id === "birthday"; })[0];
    h += card("confetti", "Празник при нас", (b ? '<p>'+esc(b.t)+': '+esc(b.p)+'</p>' : '')+'<p class="sub">Цена и меню за празника: попитайте ни или сметнете в калкулатора.</p><div class="acts">'+link("celebration.html","Калкулатор на празник")+link("events.html","Събития и поводи")+'</div>'); }
  if (it.offers) h += card("seal-percent", "Оферти сега", SC.offers().map(function(o){ return '<p><b>'+esc(o.t)+'.</b> '+esc(o.p)+'</p>'; }).join("")+'<div class="acts">'+link("offers.html","Всички оферти")+'</div>');
  if (it.where) h += card("map-pin", "Адрес", '<p>'+esc(R.address)+'</p><div class="acts">'+link(R.maps,"Маршрут в Google Maps",true)+link("contacts.html","Контакти")+'</div>');
  if (it.contact) h += card("phone", "Телефон", '<p><a class="link" href="'+TEL+'">'+esc(R.phone)+'</a> · <a class="link" href="tel:'+R.phone2.replace(/\s/g,"")+'">'+esc(R.phone2)+'</a></p><p class="sub">'+esc(R.email)+'</p>');
  if (it.reserve) h += card("calendar-check", "Резервирай маса", '<p>Онлайн или по телефона '+esc(R.phone)+'.</p><div class="acts">'+link("reservation.html","Резервирай маса")+'</div>');
  if (it.pay) h += card("wallet", "Плащане", '<p>В брой · Карта при получаване · Ваучер</p><p class="sub">Кои ваучери приемаме: попитайте ни.</p>');
  if (it.nodata) h += card("question", "Нямаме това в данните на сайта", '<p>Попитайте ни и ще ви кажем веднага.</p><div class="acts"><a class="pill pill-line" href="'+TEL+'">'+ic("phone",20)+R.phone+'</a></div>');
  return h; }

/* ---------- ястията ---------- */
var open = {};
function outLast(a){ return a.map(function(x, i){ return [x, i]; }).sort(function(p, q){ return (SC.isOut(p[0]) - SC.isOut(q[0])) || (p[1] - q[1]); }).map(function(z){ return z[0]; }); }
function row(x){ var c = SC.catById[x.cat], out = SC.isOut(x);
  return '<div class="arow"><a class="open" href="dish.html#'+x.id+'">'+SC.pic(x)+'<span><span class="nm">'+esc(x.n)+'</span><span class="mt'+(out?" out":"")+'">'+(out ? "Изчерпано днес" : esc(c ? c.n : "")+(x.g ? " · "+esc(x.per100 ? "за 100 гр." : x.g) : ""))+'</span></span><span class="price">'+fmt(x.p)+'</span></a>'+(out ? '<span class="sp"></span>' : SC.plusBtn(x))+'</div>'; }
function rows(key, list, lim){ lim = lim || LIM; var all = open[key], show = all ? list : list.slice(0, lim);
  return '<div class="arows">'+show.map(row).join("")+'</div>'+(list.length > show.length ? '<button class="link amore" type="button" data-amore="'+key+'">Покажи всички '+list.length+ic("caret-down",16)+'</button>' : ''); }

/* ---------- „Попитай AI“: примерен отговор от реалното меню ---------- */
function pickMains(pool, n, avoid){ var used = {}, out = []; (avoid || []).forEach(function(x){ used[x.id] = 1; });
  var sorted = pool.filter(function(x){ return !SC.isOut(x) && MAINCATS.indexOf(x.cat) > -1 && !used[x.id]; })
    .sort(function(a, b){ return ((b.t.indexOf("hit") > -1) - (a.t.indexOf("hit") > -1)) || (b.p - a.p); });
  var cats = {};
  sorted.forEach(function(x){ if (out.length < n && !cats[x.cat]){ out.push(x); cats[x.cat] = 1; used[x.id] = 1; } });
  sorted.forEach(function(x){ if (out.length < n && !used[x.id]){ out.push(x); used[x.id] = 1; } });
  return out; }
function prow(x, who){ var c = SC.catById[x.cat];
  return '<div class="prow"><span class="pic">'+SC.art(x)+'</span><span><small>'+who+'</small><b>'+esc(x.n)+'</b><em>'+esc(c ? c.n : "")+(x.t.indexOf("hit") > -1 ? " · Хит" : "")+'</em></span><span class="price">'+fmt(x.p)+'</span></div>'; }
function addAll(list){ var tot = list.reduce(function(a, x){ return a + x.p; }, 0);
  return '<button class="pill pill-red pill-block" type="button" data-aiadd="'+list.map(function(x){ return x.id; }).join(",")+'">Добави всичко · '+fmt(tot)+'</button>'; }
function aiAnswer(raw, w, r, it){
  var excl = r ? r.query.exc.map(function(q){ return q.label; }) : [], exq = excl.map(function(l){ return "без " + l; }).join(" ");
  var under = function(a){ return w.price ? a.filter(function(x){ return x.p <= w.price; }) : a; };
  var safe = excl.length ? (SC.searchGroups(ITEMS, exq) || {rest:[]}).rest : ITEMS;
  var unk = excl.length ? (SC.searchGroups(ITEMS, exq) || {unknown:[]}).unknown.length : 0;
  var fine = '<p class="fine">'+(excl.length ? "„Без "+joinAnd(excl)+"“ е по състава в менюто. Кухнята потвърждава алергените и съставките. " : "")+'Цените са от менюто.</p>';
  if (it.lunch && !w.people) return lunchBody();
  if (w.people || (w.one && excl.length)){ var n = w.people || 2, one = w.one && excl.length;
    var restricted = one ? 1 : (excl.length ? n : 0), picks = [], lab = [];
    pickMains(under(safe), restricted).forEach(function(x){ picks.push(x); lab.push(one ? "За единия: без "+joinAnd(excl) : "Без "+joinAnd(excl)); });
    pickMains(under(ITEMS), n - picks.length, picks).forEach(function(x, i){ picks.push(x); lab.push(one ? "За останалите" : "Човек "+(picks.length)); });
    var salad = under(excl.length && !one ? safe : ITEMS).filter(function(x){ return x.cat === "salati" && !SC.isOut(x); }).sort(function(a, b){ return a.p - b.p; })[0];
    if (!picks.length) return '<p>В менюто не намирам основни ястия, които да отговарят на всичко това. Попитайте ни: <a class="link" href="'+TEL+'">'+R.phone+'</a>.</p>';
    var all = picks.concat(salad ? [salad] : []);
    return '<p>Ето пример за '+SC.plural(n, "човек", "души")+(excl.length ? (one ? ", единият без " : ", без ")+joinAnd(excl) : "")+(w.price ? ", до "+fmt(w.price)+" на ястие" : "")+':</p>'+
      picks.map(function(x, i){ return prow(x, lab[i]); }).join("")+(salad ? prow(salad, "За споделяне") : "")+(picks.length < n ? '<p class="fine">Не намерих '+n+' различни ястия с тези условия. Кажете ми повече и ще допълня.</p>' : '')+
      addAll(all)+fine; }
  if (w.price){ var p = pickMains(under(safe), 4);
    if (!p.length) return '<p>В менюто няма основни ястия до '+fmt(w.price)+(excl.length ? " без "+joinAnd(excl) : "")+'. Най-евтиното основно е '+fmt(Math.min.apply(null, ITEMS.filter(function(x){ return MAINCATS.indexOf(x.cat) > -1; }).map(function(x){ return x.p; })))+'.</p>';
    return '<p>Основни ястия до '+fmt(w.price)+(excl.length ? ", без "+joinAnd(excl) : "")+':</p>'+p.map(function(x){ return prow(x, x.t.indexOf("hit") > -1 ? "Хит" : "До "+fmt(w.price)); }).join("")+fine; }
  if (excl.length){ var g = pickMains(safe, 4);
    return '<p>По състава без '+joinAnd(excl)+' изглеждат например:</p>'+g.map(function(x){ return prow(x, "Без "+joinAnd(excl)); }).join("")+
      '<p class="fine">Общо '+plural(safe.length)+' са без '+joinAnd(excl)+' по състава.'+(unk ? ' За '+plural(unk)+' нямаме пълен състав, попитайте ни.' : '')+' Кухнята потвърждава алергените.</p>'; }
  if (it.events){ var e = SC.events()[0]; return '<p>Следващото събитие е '+esc(e.n)+': '+dateBG(e.date)+' от '+e.time+'. Програмата, менюто и цената още не са обявени, попитайте ни.</p><div class="acts">'+link("event.html#"+e.id,"Запази място")+'</div>'; }
  var found = r ? r.name.concat(r.comp).filter(function(x){ return !SC.isOut(x); }).slice(0, 3) : [];
  if (found.length) return '<p>От менюто най-близо до „'+esc(raw.trim())+'“ са:</p>'+found.map(function(x){ return prow(x, SC.catById[x.cat] ? SC.catById[x.cat].n : ""); }).join("")+'<p class="fine">Искате предложение за цялата маса? Напишете за колко души и какво не ядете.</p>';
  return '<p>Не намирам това в менюто и в информацията на сайта. Попитайте ни: <a class="link" href="'+TEL+'">'+R.phone+'</a>.</p>'; }

/* ---------- панелът ---------- */
var SUGG = [
  ["Ястия", [["magnifying-glass","пица"],["magnifying-glass","kebapcheta"],["magnifying-glass","onion"],["magnifying-glass","без глутен"]]],
  ["Желания", [["sparkle","За 4 души, единият не яде лук"],["sparkle","Основно до 15 €"]]],
  ["Информация", [["moped","До колко е доставката?"],["calendar-blank","Кога е Гръцката вечер?"],["bowl-food","Обедно меню"],["map-pin","Къде сте?"]]]];
function homeHTML(){ var st = SC.status();
  return '<div class="anow"><span class="dot '+st.cls+'"></span><span>'+st.html+'</span></div>'+
    SUGG.map(function(g){ return '<p class="agh">'+g[0]+'</p><div class="asugg">'+g[1].map(function(z){ return '<button class="chip'+(z[0]==="sparkle"?" wish":"")+'" type="button" data-asugg="'+esc(z[1])+'">'+ic(z[0],18)+esc(z[1])+'</button>'; }).join("")+'</div>'; }).join(""); }
var ai = {q:null, phase:""}, sh = null, inp, res, clr, live, aiT;
function online(){ return navigator.onLine !== false; }
function wishLine(w, r){ var bits = [], ex = r ? r.query.exc.map(function(q){ return q.label; }) : [];
  if (w.people) bits.push("за "+SC.plural(w.people, "човек", "души"));
  if (ex.length) bits.push((w.one ? "единият без " : "без ")+joinAnd(ex));
  if (w.price) bits.push("до "+fmt(w.price));
  return bits.join(", "); }
function aiSlot(raw, w, r, it, isWish){
  if (ai.q === raw && ai.phase){
    return '<section class="aians" data-aians aria-live="polite"><div class="hd">'+ic("sparkle",20)+'Попитай AI<span class="aiex">'+ic("info",16)+'Пример: свързването с Claude е етап E</span></div>'+
      (ai.phase === "loading" ? '<div class="typing" aria-label="Мисля"><span></span><span></span><span></span></div>' : aiAnswer(raw, w, r, it))+'</section>'; }
  if (!isWish) return "";
  var line = wishLine(w, r);
  return '<section class="awish"><b>'+(line ? "Мога да предложа ястия "+esc(line)+"." : "Мога да предложа ястия от менюто.")+'</b><p>Само от нашето меню и цени. Отдолу са резултатите от търсенето.</p>'+
    (online() ? '<button class="pill pill-ember" type="button" data-aiask>'+ic("sparkle",20)+'Попитай AI</button>'
              : '<button class="pill" type="button" disabled>'+ic("sparkle",20)+'Попитай AI</button><p style="margin:8px 0 0">Без интернет AI не работи. Търсенето отдолу работи и така.</p>')+'</section>'; }
function render(){ var raw = inp.value, q = raw.trim(); clr.hidden = !raw;
  if (ai.q !== null && ai.q !== raw){ ai = {q:null, phase:""}; clearTimeout(aiT); }
  if (!q){ res.innerHTML = homeHTML(); live.textContent = ""; return; }
  var w = wish(raw), it = intents(raw), r = w.core ? SC.searchGroups(ITEMS, w.core) : null;
  var under = function(a){ return w.price ? a.filter(function(x){ return x.p <= w.price; }) : a; };
  var h = "", n = 0, unkN = 0, isWish = !!(w.people || w.price || w.ask || (r && r.query.exc.length));
  if (r) h += SC.searchChipsHTML(r.chips);
  h += aiSlot(raw, w, r, it, isWish);
  h += infoHTML(it);
  if (r){ var name = outLast(under(r.name)), comp = outLast(under(r.comp)), rest = outLast(under(r.rest)), unk = outLast(under(r.unknown));
    if (name.length) h += '<p class="agh">По име<span class="n">'+plural(name.length)+'</span></p>'+rows("name", name);
    if (comp.length) h += '<p class="sband">'+ic("list-bullets",18)+esc(r.band)+'<span class="n">'+plural(comp.length)+'</span></p>'+rows("comp", comp);
    if (!r.query.inc.length && rest.length) h += '<p class="agh">Без '+esc(joinAnd(r.query.exc.map(function(x){ return x.label; })))+' по състава<span class="n">'+plural(rest.length)+'</span></p>'+rows("rest", rest);
    if (unk.length) h += '<section class="aunk"><div class="uh">'+ic("warning-circle",22)+'<span><b>Нямаме пълен състав, попитайте ни</b><span>Не знаем дали съдържат '+esc(joinAnd(r.query.exc.map(function(x){ return x.label; })))+'. <a class="link" href="'+TEL+'">'+R.phone+'</a></span></span></div>'+rows("unk", unk, 3)+'</section>';
    n = name.length + comp.length + (r.query.inc.length ? 0 : rest.length); unkN = unk.length; }
  else if (w.price){ var cheap = ITEMS.filter(function(x){ return x.p <= w.price && !SC.isOut(x); }).sort(function(a, b){ return ((MAINCATS.indexOf(b.cat) > -1) - (MAINCATS.indexOf(a.cat) > -1)) || (b.p - a.p); });
    h += '<p class="agh">До '+fmt(w.price)+'<span class="n">'+plural(cheap.length)+'</span></p>'+rows("price", cheap); n = cheap.length; }
  var anyInfo = Object.keys(it).length > 0;
  if (!n && !unkN && !anyInfo) h += card("magnifying-glass", "Не намерихме „"+esc(q)+"“", '<p>Нито в менюто, нито в информацията на сайта. Проверете думата или попитайте ни.</p><div class="acts"><a class="pill pill-line" href="'+TEL+'">'+ic("phone",20)+R.phone+'</a></div>');
  if (!isWish && !(ai.q === raw && ai.phase)) h += '<section class="awish" style="margin-top:16px"><b>Не е това, което търсите?</b><p>Опишете с думи: за колко души, какво не ядете, до каква цена.</p>'+(online() ? '<button class="pill pill-ember" type="button" data-aiask>'+ic("sparkle",20)+'Попитай AI</button>' : '<button class="pill" type="button" disabled>'+ic("sparkle",20)+'Попитай AI</button>')+'</section>';
  res.innerHTML = h;
  live.textContent = n ? "Намерихме "+plural(n)+(unkN ? " и "+unkN+" без пълен състав" : "") : (anyInfo ? "Има отговор от информацията" : "Нищо не намерихме"); }
function ask(){ var raw = inp.value; ai = {q:raw, phase:"loading"}; render(); res.scrollTop = 0;
  clearTimeout(aiT); aiT = setTimeout(function(){ if (ai.q === raw){ ai.phase = "done"; render(); res.scrollTop = 0; } }, SC.reduce ? 50 : 700); }

function openPanel(q){
  sh = SC.sheet({title:"Асистент", html:
    '<form class="aq" role="search" data-aq><label for="aiq">Търсете ястие или попитайте</label><div class="aqbox">'+ic("magnifying-glass",22)+
      '<input id="aiq" type="search" placeholder="пица, без глутен, до 15 €" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search">'+
      '<button class="aqclr" type="button" data-aqclr aria-label="Изчисти" hidden>'+ic("x",20)+'</button></div></form>'+
    '<div class="aqres" data-aqres></div><p class="vh" aria-live="polite" data-alive></p>'+
    '<p class="aifine">Търсенето работи веднага и без интернет. Отговаря само от менюто и информацията на сайта.</p>'});
  var el = sh.el; el.classList.add("aisheetwrap");
  inp = el.querySelector("#aiq"); res = el.querySelector("[data-aqres]"); clr = el.querySelector("[data-aqclr]"); live = el.querySelector("[data-alive]");
  open = {}; inp.value = q || SCAI.last || ""; render();
  inp.addEventListener("input", function(){ open = {}; SCAI.last = inp.value; render(); });
  inp.addEventListener("keydown", function(e){ if (e.key === "Escape" && inp.value){ e.stopPropagation(); inp.value = ""; SCAI.last = ""; render(); } });
  el.querySelector("[data-aq]").addEventListener("submit", function(e){ e.preventDefault(); inp.blur(); });
  el.addEventListener("click", function(e){ var t = e.target.closest("button"); if (!t) return;
    if (t.hasAttribute("data-aqclr")){ inp.value = ""; SCAI.last = ""; open = {}; render(); inp.focus({preventScroll:true}); return; }
    if (t.dataset.asugg){ inp.value = t.dataset.asugg; SCAI.last = inp.value; render(); return; }
    if (t.dataset.qtoggle){ inp.value = toggleRaw(inp.value, t.dataset.qtoggle); SCAI.last = inp.value; open = {}; render(); return; }
    if (t.dataset.amore){ open[t.dataset.amore] = 1; render(); return; }
    if (t.hasAttribute("data-aiask")){ ask(); return; } });
  var re = function(){ if (sh && sh.el.isConnected) render(); };
  window.addEventListener("online", re); window.addEventListener("offline", re);
  setTimeout(function(){ inp.focus({preventScroll:true}); }, 60); }

window.SCAI = {open:openPanel, last:"", wish:wish, intents:intents};
})();
