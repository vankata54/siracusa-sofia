/* Siracusa design system runtime v1. Load order on every page:
   ../ds/icons.js, ../data/menu.js, ../ds/sc.js, then the page script that calls SC.mount({...}).
   Everything here is shared by all pages: chrome (header, status, cart, nav, "Още", AI assistant, cookie banner, footer),
   data helpers, cart store, illustrations, sheets, toasts. Pages must not redefine these. */
(function(){
"use strict";
var M = window.SC_MENU, I = window.SC_ICONS;
var reduce = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
var SC = window.SC = {reduce:reduce};

/* ---------- storage (per-viewer convenience only) ---------- */
function load(k, d){ try{ var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }catch(e){ return d; } }
function store(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
SC.load = load; SC.store = store;
var prefs = load("sc-prefs", {theme:"system", view:"phone", time:"now"});
SC.prefs = prefs;
function savePrefs(){ store("sc-prefs", prefs); }

/* ---------- formatting ---------- */
SC.fmt = function(p){ return (Math.round(p*100)/100).toFixed(2).replace(".", ",") + " €"; };
SC.esc = function(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];}); };
SC.ic = function(n, s){ s = s || 22; return '<svg class="ic" viewBox="0 0 256 256" width="'+s+'" height="'+s+'" fill="currentColor" aria-hidden="true">'+(I[n]||I["question"])+'</svg>'; };
SC.plural = function(n, one, many){ return n + " " + (n===1 ? one : many); };

/* ---------- data ---------- */
SC.menu = M;
SC.items = M.items;
SC.byId = {}; M.items.forEach(function(x){ SC.byId[x.id] = x; });
/* today's lunch items join the lookup (for cart/prices) but stay out of the main menu lists */
SC.lunch = M.lunch.items.filter(function(x){ return x.p; }).map(function(x){ var g=x.group;
  var it = {id:x.id, n:x.n, cat:"obedno", group:g, course:/Супи|Салати/.test(g)?"starter":/Десерти/.test(g)?"dessert":"main", comp:"", g:"", p:x.p, t:[], al:[], noOnion:false, share:false, lunch:true};
  SC.byId[it.id] = it; return it; });
SC.cats = M.cats;
SC.catById = {}; M.cats.forEach(function(c){ SC.catById[c.id] = c; });
SC.inCat = function(cat){ return M.items.filter(function(x){ return x.cat === cat; }); };
SC.isOut = function(x){ return x.t.indexOf("out") > -1; };
SC.RESTAURANT = {est:2013 /* from the menu logo, to confirm */, payment:["В брой","Карта при получаване (Visa, Mastercard)","Ваучери (Sodexo, да се провери името)","Подаръчна карта"], social:{facebook:"https://www.facebook.com/BarGrillSiracusa", instagram:null, google:null}, googleReview:null,
  name:"Siracusa Bar & Grill", address:"ж.к. Дружба 2, срещу бл. 311, 1582 София", phone:"0894 36 55 77", phone2:"0700 199 55", email:"menu@siracusa-sofia.com",
  open:"10:00", close:"23:00", kitchen:"22:30", delivery:"21:00", lunchUntil:"15:00",
  maps:"https://www.google.com/maps/dir/?api=1&destination=Siracusa+Bar+%26+Grill+%D0%94%D1%80%D1%83%D0%B6%D0%B1%D0%B0+2+%D0%A1%D0%BE%D1%84%D0%B8%D1%8F"};
SC.ZONES = [
  {n:"Дружба 1", free:true, eta:"около 30 мин"}, {n:"Дружба 2", free:true, eta:"около 25 мин"},
  {n:"НПЗ Искър", free:true, eta:"около 35 мин"}, {n:"Бусманци", free:true, eta:"около 40 мин"},
  {n:"Горубляне", free:false, fee:null, eta:"около 40 мин"}, {n:"Гара Искър", free:false, fee:null, eta:"около 45 мин"}];
SC.TAGS = {hit:["Хит","fire"], new:["Ново","sparkle"], veg:["Вегетарианско","leaf"], hot:["Люто","pepper"], out:["Изчерпано днес","clock"]};
/* 14 EU allergens (Reg. 1169/2011). Values in data are derived from the composition text and must be confirmed by the kitchen. */
SC.ALLERGENS = [
  ["gluten","Глутен","grains"],["crustaceans","Ракообразни","shrimp"],["eggs","Яйца","egg"],["fish","Риба","fish"],
  ["peanuts","Фъстъци","plant"],["soy","Соя","plant"],["milk","Мляко","drop"],["nuts","Ядки","tree"],
  ["celery","Целина","carrot"],["mustard","Синап","jar"],["sesame","Сусам","dots-three"],["sulphites","Сулфити","wine"],
  ["lupin","Лупина","flower"],["molluscs","Мекотели","fish"]];
SC.allergenName = function(k){ var a = SC.ALLERGENS.filter(function(x){ return x[0]===k; })[0]; return a ? a[1] : k; };

/* Filters for the menu ("менюта като филтри"). Data-driven: a filter is shown only if at least one item matches. */
SC.FILTERS = [
  {id:"veg", n:"Вегетарианско", icon:"leaf", test:function(x){ return x.t.indexOf("veg")>-1; }},
  {id:"hot", n:"Люто", icon:"pepper", test:function(x){ return x.t.indexOf("hot")>-1; }},
  {id:"noonion", n:"Без лук", icon:"plant", test:function(x){ return x.noOnion; }},
  {id:"share", n:"За споделяне", icon:"users-three", test:function(x){ return x.share; }},
  {id:"bertha", n:"От фурната Bertha", icon:"fire", test:function(x){ return x.cat==="skara-bertha"; }},
  {id:"nogluten", n:"Без глутен", icon:"grains", test:function(x){ return x.comp && x.al.indexOf("gluten")<0; }},
  {id:"nomilk", n:"Без мляко", icon:"drop", test:function(x){ return x.comp && x.al.indexOf("milk")<0; }},
  {id:"protein", n:"Протеиново", icon:"barbell", test:function(x){ return !!x.protein && x.protein>=30; }, needs:"хранителни данни"},
  {id:"light", n:"Леко до 500 ккал", icon:"leaf", test:function(x){ return !!x.kcal && x.kcal<=500; }, needs:"хранителни данни"}
];

/* ---------- time & status ---------- */
SC.now = function(){
  if (prefs.time && prefs.time !== "now"){ var t = prefs.time.split(":"); return {h:+t[0], m:+t[1]}; }
  try{ var f = new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Sofia",hour:"2-digit",minute:"2-digit",hour12:false}).format(new Date()).split(":"); return {h:+f[0]%24, m:+f[1]}; }
  catch(e){ var d = new Date(); return {h:d.getHours(), m:d.getMinutes()}; }
};
SC.minutes = function(){ var n = SC.now(); return n.h*60 + n.m; };
SC.state = function(){ var m = SC.minutes();
  return {open: m>=600 && m<1380, kitchen: m>=600 && m<1350, delivery: m>=600 && m<1260, lunch: m>=600 && m<900, lunchDiscount: m>=900 && m<1350, breakfast: m>=600 && m<690, m:m}; };
SC.status = function(){ var m = SC.minutes();
  if (m < 600) return {cls:"", html:"<b>Затворено</b> · отваряме в 10:00"};
  if (m >= 1380) return {cls:"", html:"<b>Затворено</b> · отваряме утре в 10:00"};
  if (m < 1260) return {cls:"ok", html:"<b>Отворено до 23:00</b> · Доставка до 21:00"};
  if (m < 1350) return {cls:"warn", html:"<b>Доставката приключи за днес</b> · Вземане до 22:30"};
  return {cls:"warn", html:"<b>Кухнята затвори</b> · Отворено до 23:00"};
};
/* honest delivery estimate (prototype: fixed by hour; real one comes from the kitchen load) */
SC.eta = function(){ var m = SC.minutes(); var busy = (m>=720 && m<810) || (m>=1140 && m<1230);
  return busy ? {min:55, busy:true, text:"Възможни са закъснения · около 55 мин"} : {min:35, busy:false, text:"около 35 мин"}; };
SC.lastSaturday = function(){ var n = new Date(), y = n.getFullYear(), mo = n.getMonth();
  function ls(y,mo){ var d = new Date(y,mo+1,0); while(d.getDay()!==6) d.setDate(d.getDate()-1); return d; }
  var d = ls(y,mo), t = new Date(y,mo,n.getDate()); if (d < t) d = ls(mo===11?y+1:y,(mo+1)%12);
  return {d:d, days:Math.round((d-t)/864e5)}; };
SC.MON = ["яну","фев","мар","апр","май","юни","юли","авг","сеп","окт","ное","дек"];
SC.MONTHS = ["януари","февруари","март","април","май","юни","юли","август","септември","октомври","ноември","декември"];
SC.DAYS = ["неделя","понеделник","вторник","сряда","четвъртък","петък","събота"];

/* ---------- events & offers (only real or pack-defined items) ---------- */
SC.events = function(){ var ls = SC.lastSaturday();
  return [{id:"gratska-vecher", n:"Гръцка вечер", cat:"Тематични вечери", date:ls.d, time:"19:00", price:null, free:false, seatsLeft:null,
    text:"Всяка последна събота от месеца кухнята сменя посоката. Този път: Гърция.", note:"[ЛИПСВА: програма, меню и цена]"}]; };
SC.EVENT_CATS = ["Жива музика","Тематични вечери","Празници","Рождени дни","Кръщенета","Юбилеи","Фирмени партита","Абитуриентски","Детски","Частни партита"];
SC.offers = function(){ var s = SC.state(), ev = SC.lastSaturday(), o = [];
  if (s.lunch) o.push({id:"lunch", t:"Обедно меню днес", p:"Поръчайте до 15:00 с доставка или вземане от място.", go:"Виж обедното меню", href:"lunch.html"});
  else if (s.lunchDiscount) o.push({id:"lunch30", t:"-30% на обедното меню", p:"След 15:00 при вземане от място. Отстъпката се смята сама.", go:"Вземи от място", href:"lunch.html"});
  else o.push({id:"tomorrow", t:"Поръчай за утре", p:"Кухнята приема поръчки всеки ден от 10:00 до 22:30.", go:"Към менюто", href:"menu.html"});
  o.push({id:"greek", t:"Гръцка вечер", p:(ev.days===0?"Днес":"След "+SC.plural(ev.days,"ден","дни"))+". -5% при ранна резервация.", go:"Запази място", href:"event.html#gratska-vecher"});
  o.push({id:"birthday", t:"Рожден ден при нас", p:"-10% от сметката или малка торта за рожденика.", go:"Виж офертата", href:"offers.html#birthday"});
  o.push({id:"signup", t:"-10% с профил", p:"Направете профил и вземете -10% от следващата поръчка.", go:"Направи профил", href:"login.html"});
  return o; };

/* ---------- tables (mock floor plan: 12 in the hall, 8 in the garden) ---------- */
SC.TABLES = (function(){ var t = [], i;
  var hall = [[2,"round"],[2,"round"],[4,"square"],[4,"square"],[4,"square"],[6,"rect"],[2,"round"],[4,"square"],[4,"square"],[6,"rect"],[2,"round"],[4,"square"]];
  for (i=0;i<hall.length;i++) t.push({id:"S"+(i+1), n:i+1, zone:"salon", seats:hall[i][0], shape:hall[i][1], x:(i%4), y:Math.floor(i/4), window:i<4, stroller:[5,9].indexOf(i)>-1, access:[2,6].indexOf(i)>-1});
  var gar = [[4,"square"],[4,"square"],[6,"rect"],[2,"round"],[4,"square"],[2,"round"],[6,"rect"],[4,"square"]];
  for (i=0;i<gar.length;i++) t.push({id:"G"+(i+1), n:i+13, zone:"garden", seats:gar[i][0], shape:gar[i][1], x:(i%4), y:Math.floor(i/4), window:false, stroller:true, access:[0,4].indexOf(i)>-1});
  return t; })();

/* ---------- "Върви добре с" (hand-off 10.12) ---------- */
var PLAN = {pitsi:["salad","drink","dessert"], "skara-bertha":["side","drink","salad"], "osnovni-yastia":["salad","drink","dessert"], "pasta-i-rizoto":["salad","drink","dessert"], burgeri:["side","drink","dessert"],
  salati:["main","drink","dessert"], supi:["main","drink"], "studeni-predyastia":["drink","sauce","main"], "topli-predyastia":["drink","sauce","main"],
  garnituri:["main","sauce"], hlebcheta:["main","sauce"], sosove:["main"], deserti:["drink"], zakuski:["drink"]};
var COURSE_OF = function(x){ if (x.cat==="salati") return "salad"; return x.course; };
SC.COURSE_NAME = {salad:"Салата", starter:"Предястие", main:"Основно", side:"Гарнитура", sauce:"Сос", dessert:"Десерт", drink:"Напитка", addon:"Добавка", breakfast:"Закуска"};
SC.MANUAL_PAIRS = {}; /* owner's manual pairings from the admin: {dishId:{course:itemId}} */
SC.suggest = function(id, inCart){ var d = SC.byId[id]; if (!d) return []; var plan = PLAN[d.cat] || ["salad","drink","dessert"]; var mine = COURSE_OF(d);
  var cartCourses = (inCart||[]).map(function(k){ return SC.byId[k] && COURSE_OF(SC.byId[k]); });
  return plan.filter(function(c){ return c!==mine && cartCourses.indexOf(c)<0; }).map(function(c){
    var man = SC.MANUAL_PAIRS[id] && SC.MANUAL_PAIRS[id][c]; if (man && SC.byId[man]) return {c:c, id:man};
    var best = M.items.filter(function(x){ return x.id!==id && COURSE_OF(x)===c && !SC.isOut(x) && x.cat!=="dobavki" && !(d.t.indexOf("veg")>-1 && x.comp && x.t.indexOf("veg")<0 && c!=="drink"); })
      .sort(function(a,b){ return ((a.cat==="pitsi")-(b.cat==="pitsi")) || (b.p-a.p); })[0];
    return best ? {c:c, id:best.id} : null; }).filter(Boolean).slice(0,3); };

/* ---------- illustrations (stand-ins until the new photo shoot) ---------- */
function rng(seed){ var h=2166136261; for (var i=0;i<seed.length;i++){ h^=seed.charCodeAt(i); h=Math.imul(h,16777619); } return function(){ h+=0x6D2B79F5; var t=h; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
function inDisk(r,R){ var a=r()*6.2832, d=Math.sqrt(r())*R; return [100+Math.cos(a)*d, 100+Math.sin(a)*d]; }
function plate(s){ return s+'<circle cx="100" cy="100" r="94" fill="#ECE5DA"/><circle cx="100" cy="100" r="78" fill="#F7F3EC"/>'; }
function drawPizza(x, r){ var t=(x.n+" "+x.comp).toLowerCase(), s="", i, p, a, X, Y;
  var sweet = /нутела|шоколад/.test(t), white = /сметана/.test(t) && !/доматен/.test(t);
  s+='<circle cx="100" cy="100" r="92" fill="#D9A262"/>';
  for (i=0;i<18;i++){ a=r()*6.2832; X=100+Math.cos(a)*84; Y=100+Math.sin(a)*84; s+='<ellipse cx="'+X+'" cy="'+Y+'" rx="'+(3+r()*7)+'" ry="'+(2+r()*3)+'" fill="#7E4618" opacity="'+(.3+r()*.4)+'" transform="rotate('+(a*57)+' '+X+' '+Y+')"/>'; }
  s+='<circle cx="100" cy="100" r="76" fill="'+(sweet?"#4A2A18":white?"#F1E6C8":/трюфел/.test(t)?"#E9D6A6":"#C23A22")+'"/>';
  if (!sweet) for (i=0;i<12;i++){ p=inDisk(r,60); s+='<ellipse cx="'+p[0]+'" cy="'+p[1]+'" rx="'+(9+r()*10)+'" ry="'+(7+r()*8)+'" fill="#F3E2AE" opacity=".92"/>'; }
  function scatter(n, R, fn){ for (var j=0;j<n;j++){ var q=inDisk(r,R); s+=fn(q[0],q[1]); } }
  if (/прошуто|шунка|пуешко/.test(t)) scatter(7,54,function(X,Y){ return '<path d="M'+X+' '+Y+' q12 '+(r()*20-10)+' 24 '+(r()*10-5)+'" stroke="#DA857C" stroke-width="9" stroke-linecap="round" fill="none"/>'; });
  if (/салам|луканка|кренвирш|кайма/.test(t)) scatter(11,58,function(X,Y){ return '<circle cx="'+X+'" cy="'+Y+'" r="11" fill="#A6281C" stroke="#78180F" stroke-width="2"/>'; });
  if (/гъби/.test(t)) scatter(8,56,function(X,Y){ return '<path d="M'+(X-8)+' '+Y+' a8 7 0 0 1 16 0z" fill="#C9B79C"/><rect x="'+(X-2.5)+'" y="'+Y+'" width="5" height="7" fill="#BCA889"/>'; });
  if (/чушка/.test(t)) scatter(8,58,function(X,Y){ return '<rect x="'+(X-9)+'" y="'+(Y-2)+'" width="18" height="4" rx="2" fill="'+(/червена/.test(t)&&r()>.5?"#D7402A":"#4E8A36")+'" transform="rotate('+(r()*180)+' '+X+' '+Y+')"/>'; });
  if (/маслини/.test(t)) scatter(8,58,function(X,Y){ return '<circle cx="'+X+'" cy="'+Y+'" r="4.5" fill="none" stroke="#2A2420" stroke-width="3"/>'; });
  if (/царевица/.test(t)) scatter(16,60,function(X,Y){ return '<circle cx="'+X+'" cy="'+Y+'" r="2.6" fill="#F2C445"/>'; });
  if (/тон/.test(t) && /риба/.test(t)) scatter(10,54,function(X,Y){ return '<ellipse cx="'+X+'" cy="'+Y+'" rx="7" ry="4" fill="#C9A98A"/>'; });
  if (/трюфел/.test(t)) scatter(40,66,function(X,Y){ return '<circle cx="'+X+'" cy="'+Y+'" r="'+(1+r()*2.2)+'" fill="#3A2A22"/>'; });
  if (/босилек|рукола/.test(t)) scatter(12,62,function(X,Y){ return '<ellipse cx="'+X+'" cy="'+Y+'" rx="8" ry="3.4" fill="#4E8A36" transform="rotate('+(r()*180)+' '+X+' '+Y+')"/>'; });
  if (/люта/.test(t)) scatter(8,62,function(X,Y){ return '<circle cx="'+X+'" cy="'+Y+'" r="4" fill="none" stroke="#E2452A" stroke-width="2.4"/>'; });
  if (/яйце/.test(t)) s+='<circle cx="100" cy="100" r="18" fill="#FBF8F1"/><circle cx="100" cy="100" r="8" fill="#F2B23A"/>';
  if (/бурата/.test(t)) s+='<circle cx="101" cy="99" r="26" fill="#FBF8F1"/><circle cx="104" cy="96" r="14" fill="#EFE7D4"/>';
  if (sweet){ scatter(70,84,function(X,Y){ return '<circle cx="'+X+'" cy="'+Y+'" r="'+(.6+r()*1.3)+'" fill="#FFF" opacity=".85"/>'; }); scatter(8,50,function(X,Y){ return '<circle cx="'+X+'" cy="'+Y+'" r="6" fill="#C8361F"/>'; }); }
  return s; }
var ART = {
  soup:function(r){ var s=plate(""); s+='<circle cx="100" cy="100" r="62" fill="#E8C877"/>'; for (var i=0;i<14;i++){ var p=inDisk(r,48); s+='<circle cx="'+p[0]+'" cy="'+p[1]+'" r="'+(3+r()*4)+'" fill="'+["#4E8A36","#E39A3B","#F4EEDC"][i%3]+'"/>'; } return s; },
  salad:function(r){ var s=plate(""); for (var i=0;i<26;i++){ var p=inDisk(r,60); s+='<ellipse cx="'+p[0]+'" cy="'+p[1]+'" rx="'+(10+r()*8)+'" ry="'+(6+r()*4)+'" fill="'+["#4E8A36","#6FA544","#3D7A2E","#86B85A"][i%4]+'" transform="rotate('+(r()*180)+' '+p[0]+' '+p[1]+')"/>'; } for (i=0;i<7;i++){ p=inDisk(r,48); s+='<circle cx="'+p[0]+'" cy="'+p[1]+'" r="'+(7+r()*4)+'" fill="#D8402B"/>'; } for (i=0;i<6;i++){ p=inDisk(r,44); s+='<rect x="'+(p[0]-5)+'" y="'+(p[1]-5)+'" width="10" height="10" rx="2" fill="#F7F1E3"/>'; } return s; },
  platter:function(r){ var s='<rect x="18" y="40" width="164" height="120" rx="20" fill="#9A6A42"/><rect x="26" y="48" width="148" height="104" rx="14" fill="#B9845A"/>'; for (var i=0;i<14;i++){ var X=40+r()*120, Y=60+r()*80; s+='<circle cx="'+X+'" cy="'+Y+'" r="'+(8+r()*6)+'" fill="'+["#B23A2E","#E9C88F","#8E2A20","#F3E2AE","#C9635A"][i%5]+'"/>'; } return s; },
  cheese:function(r){ var s=plate(""); for (var i=0;i<6;i++){ var a=i*1.05+.3, X=100+Math.cos(a)*36, Y=104+Math.sin(a)*30; s+='<rect x="'+(X-15)+'" y="'+(Y-11)+'" width="30" height="22" rx="9" fill="#D99B3E" transform="rotate('+(a*40)+' '+X+' '+Y+')"/>'; } s+='<circle cx="100" cy="100" r="17" fill="#ECE5DA"/><circle cx="100" cy="100" r="13" fill="#5B2A5E"/>'; return s; },
  seafood:function(r){ var s=plate(""); for (var i=0;i<9;i++){ var p=inDisk(r,50); s+='<path d="M'+(p[0]-12)+' '+p[1]+' a12 12 0 0 1 24 0" stroke="#F08A5D" stroke-width="7" fill="none" stroke-linecap="round" transform="rotate('+(r()*360)+' '+p[0]+' '+p[1]+')"/>'; } s+='<circle cx="150" cy="140" r="14" fill="#F4EEDC"/>'; return s; },
  steak:function(r){ var s=plate(""); s+='<path d="M46 86C50 54 116 44 150 60C174 72 170 124 144 140C112 160 58 152 48 122Z" fill="#6A2D18"/>'; for (var i=0;i<5;i++) s+='<path d="M'+(58+i*22)+' 60l-26 84" stroke="#2A1208" stroke-width="6" stroke-linecap="round" opacity=".75"/>'; s+='<path d="M120 132c10-2 26 4 30 14-12 8-30 8-38 0z" fill="#C9635A"/><circle cx="58" cy="150" r="7" fill="#3F7F30"/>'; return s; },
  ribs:function(r){ var s=plate('')+'<g transform="rotate(-22 100 100)">'; for (var i=0;i<3;i++){ var y=66+i*24; s+='<rect x="30" y="'+(y+8)+'" width="14" height="8" rx="3" fill="#EFE2CC"/><rect x="156" y="'+(y+8)+'" width="14" height="8" rx="3" fill="#EFE2CC"/><rect x="38" y="'+y+'" width="124" height="22" rx="11" fill="#7A3818"/>'; for (var k=0;k<6;k++) s+='<path d="M'+(52+k*19)+' '+(y+3)+'l-6 16" stroke="#2E1408" stroke-width="3" stroke-linecap="round" opacity=".7"/>'; } return s+'</g>'; },
  kebap:function(r){ var s=plate(""); for (var i=0;i<4;i++){ var y=62+i*22; s+='<rect x="'+(44+i*3)+'" y="'+y+'" width="104" height="18" rx="9" fill="#6E3A1F" transform="rotate('+(-8+i*3)+' 100 '+y+')"/>'; } return s; },
  patty:function(r){ var s=plate("")+'<circle cx="100" cy="100" r="50" fill="#6C3A1E"/>'; for (var i=0;i<5;i++) s+='<path d="M'+(64+i*16)+' 66l-14 64" stroke="#2C1408" stroke-width="4" stroke-linecap="round" opacity=".55"/>'; return s; },
  chicken:function(r){ var s=plate(""); for (var i=0;i<5;i++){ var p=inDisk(r,40); s+='<rect x="'+(p[0]-22)+'" y="'+(p[1]-9)+'" width="44" height="18" rx="9" fill="#D9A55A" transform="rotate('+(r()*180)+' '+p[0]+' '+p[1]+')"/>'; } return s; },
  pasta:function(r){ var s=plate("")+'<circle cx="100" cy="100" r="58" fill="#EBC877"/>'; for (var i=0;i<16;i++){ var p=inDisk(r,44); s+='<path d="M'+(p[0]-20)+' '+p[1]+' q10 -14 20 0 t20 0" stroke="#F3D78E" stroke-width="4" fill="none"/>'; } return s; },
  risotto:function(r){ var s=plate("")+'<circle cx="100" cy="100" r="60" fill="#EBD9A8"/>'; for (var i=0;i<9;i++){ var p=inDisk(r,46); s+='<ellipse cx="'+p[0]+'" cy="'+p[1]+'" rx="8" ry="5" fill="#7A5232"/>'; } return s; },
  burger:function(r){ var s='<circle cx="100" cy="100" r="58" fill="#4F8A36"/><circle cx="100" cy="100" r="52" fill="#C98B3E"/><circle cx="100" cy="100" r="46" fill="#D99B52"/>'; for (var i=0;i<22;i++){ var p=inDisk(r,40); s+='<ellipse cx="'+p[0]+'" cy="'+p[1]+'" rx="2.4" ry="1.4" fill="#FBF3DD"/>'; } return s; },
  fries:function(r){ var s=plate(""); for (var i=0;i<22;i++){ var p=inDisk(r,44); s+='<rect x="'+(p[0]-4)+'" y="'+(p[1]-18)+'" width="8" height="36" rx="3" fill="'+["#E9B54C","#F2C863","#D9A03A"][i%3]+'" transform="rotate('+(r()*180)+' '+p[0]+' '+p[1]+')"/>'; } return s; },
  veggies:function(r){ var s=plate(""); for (var i=0;i<16;i++){ var p=inDisk(r,46); s+='<rect x="'+(p[0]-7)+'" y="'+(p[1]-11)+'" width="14" height="22" rx="4" fill="'+["#4E8A36","#C8361F","#7A4FA0","#E0A33A"][i%4]+'" transform="rotate('+(r()*180)+' '+p[0]+' '+p[1]+')"/>'; } return s; },
  puree:function(r){ return plate("")+'<circle cx="100" cy="100" r="54" fill="#F3E3B5"/><path d="M70 100 q30 -30 60 0" stroke="#E9D29A" stroke-width="6" fill="none"/>'; },
  bread:function(r){ var s='<ellipse cx="100" cy="100" rx="70" ry="56" fill="#D9A262"/>'; for (var i=0;i<14;i++){ var p=inDisk(r,42); s+='<ellipse cx="'+p[0]+'" cy="'+p[1]+'" rx="'+(5+r()*7)+'" ry="'+(3+r()*4)+'" fill="#F3E2AE"/>'; } return s; },
  sauce:function(r){ var c=["#F4EEDC","#7A2E14","#E2452A","#E8C14A","#F2E6C8"][Math.floor(r()*5)]; return '<circle cx="100" cy="100" r="58" fill="#E8E2D6" stroke="#CFC6B6" stroke-width="5"/><circle cx="100" cy="100" r="44" fill="'+c+'"/>'; },
  addon:function(r){ var s='<circle cx="100" cy="100" r="58" fill="#E8E2D6"/>'; for (var i=0;i<14;i++){ var p=inDisk(r,40); s+='<circle cx="'+p[0]+'" cy="'+p[1]+'" r="'+(5+r()*4)+'" fill="'+["#F3E2AE","#D8402B","#4E8A36","#A6281C"][i%4]+'"/>'; } return s; },
  dessert:function(r){ var s=plate("")+'<path d="M60 130 L140 130 L118 62 Z" fill="#F1E3C6"/><path d="M60 130 L140 130 L136 118 L64 118 Z" fill="#6B3A1E"/>'; for (var i=0;i<20;i++){ var p=inDisk(r,30); s+='<circle cx="'+(p[0]+4)+'" cy="'+(p[1]+4)+'" r="'+(.8+r()*1.2)+'" fill="#5A3420"/>'; } return s; },
  breakfast:function(r){ return plate("")+'<circle cx="80" cy="96" r="24" fill="#FBF8F1"/><circle cx="80" cy="96" r="10" fill="#F2B23A"/><rect x="108" y="70" width="44" height="14" rx="7" fill="#B4553A"/><rect x="108" y="92" width="44" height="14" rx="7" fill="#B4553A"/><circle cx="120" cy="130" r="10" fill="#D8402B"/>'; }
};
SC.kind = function(x){ var t = (x.n+" "+x.comp).toLowerCase();
  if (x.cat==="obedno") return /Супи/.test(x.group) ? "soup" : /Салати/.test(x.group) ? "salad" : /Десерти/.test(x.group) ? "dessert" : /Скара/.test(x.group) ? "kebap" : /спагети|лазаня/i.test(x.n) ? "pasta" : /яйца/i.test(x.n) ? "breakfast" : /скумрия/i.test(x.n) ? "seafood" : /пиле/i.test(x.n) ? "chicken" : "steak";
  if (x.cat==="pitsi") return "pizza";
  if (x.cat==="supi") return "soup"; if (x.cat==="salati") return "salad";
  if (x.cat==="studeni-predyastia") return /сирена|колбаси|разядк/.test(t) ? "platter" : /тиквички/.test(t) ? "veggies" : "platter";
  if (x.cat==="topli-predyastia") return /скарид|калмар/.test(t) ? "seafood" : /сирен/.test(t) ? "cheese" : /пилеш|крилца|ушета/.test(t) ? "chicken" : /тиквич/.test(t) ? "veggies" : "steak";
  if (x.cat==="skara-bertha") return /ребра/.test(t) ? "ribs" : /кебап|кюфте|суджук|ущипци/.test(t) ? "kebap" : /плескавица/.test(t) ? "patty" : /пилешко/.test(t) ? "chicken" : "steak";
  if (x.cat==="pasta-i-rizoto") return /ризото/.test(t) ? "risotto" : "pasta";
  if (x.cat==="osnovni-yastia") return /пиле/.test(t) ? "chicken" : "steak";
  if (x.cat==="burgeri") return "burger"; if (x.cat==="hlebcheta") return "bread"; if (x.cat==="sosove") return "sauce"; if (x.cat==="dobavki") return "addon";
  if (x.cat==="garnituri") return /пюре/.test(t) ? "puree" : /картоф/.test(t) ? "fries" : "veggies";
  if (x.cat==="deserti") return "dessert"; if (x.cat==="zakuski") return "breakfast"; return "salad"; };
SC.art = function(x, attrs){ if (typeof x === "string") x = SC.byId[x]; var r = rng(x.id), k = SC.kind(x);
  var body = k==="pizza" ? drawPizza(x, r) : ART[k](r);
  return '<svg viewBox="0 0 200 200" '+(attrs||"")+' data-dish="'+x.id+'" aria-hidden="true">'+body+'</svg>'; };
SC.pic = function(x, cls){ if (typeof x === "string") x = SC.byId[x];
  return '<div class="pic '+(cls||"")+(SC.isOut(x)?" out":"")+'" role="img" aria-label="'+SC.esc(x.n)+' (илюстрация до новата фотосесия)">'+SC.art(x)+'</div>'; };
SC.badges = function(x, onpic){ var t = x.t.filter(function(k){ return SC.TAGS[k]; }); if (!t.length) return "";
  return '<span class="badges'+(onpic?" onpic":"")+'">'+t.map(function(k){ return '<span class="badge '+k+'">'+SC.ic(SC.TAGS[k][1],16)+SC.TAGS[k][0]+'</span>'; }).join("")+'</span>'; };
SC.href = function(page, id){ return page+".html"+(id?"#"+id:""); };
SC.plusBtn = function(x){ if (typeof x === "string") x = SC.byId[x]; if (SC.isOut(x)) return "";
  return '<button class="plus" type="button" data-add="'+x.id+'" aria-label="Добави '+SC.esc(x.n)+' в количката">'+SC.ic("plus",22)+'</button>'; };
/* variant: "card" (rail/grid) or "row" */
SC.dishCard = function(x, variant){ if (typeof x === "string") x = SC.byId[x];
  if (variant==="row") return '<div class="drow"><a class="open" href="'+SC.href("dish",x.id)+'">'+SC.pic(x)+'<span><span class="nm">'+SC.esc(x.n)+'</span><span class="meta"><span class="price">'+SC.fmt(x.p)+'</span><span class="muted small">'+(x.per100?'за 100 гр.':x.g)+'</span></span>'+(x.t.length?'<span style="display:block;margin-top:6px">'+SC.badges(x)+'</span>':'')+'</span></a>'+SC.plusBtn(x)+'</div>';
  return '<div class="dcard"><a class="open" href="'+SC.href("dish",x.id)+'"><span class="pw">'+SC.pic(x)+SC.badges(x,true)+'</span><span class="nm">'+SC.esc(x.n)+'</span></a><div class="rowp"><span><span class="price">'+SC.fmt(x.p)+'</span><small>'+(x.per100?'за 100 гр.':x.g)+'</small></span>'+SC.plusBtn(x)+'</div></div>'; };

/* ---------- cart store ---------- */
var cart = load("sc-cart", {lines:[], mode:"delivery"});
var listeners = [];
function saveCart(){ store("sc-cart", cart); listeners.forEach(function(f){ f(cart); }); updateCartUI(true); }
/* signed-in client (prototype: localStorage "sc-user", written by login.html) */
SC.user = function(){ return load("sc-user", null); };
SC.cart = {
  get:function(){ return cart; },
  lines:function(){ return cart.lines; },
  count:function(){ return cart.lines.reduce(function(a,l){ return a+l.q; },0); },
  subtotal:function(){ return cart.lines.reduce(function(a,l){ var x=SC.byId[l.id]; return a+(x?x.p*l.q:0)+(l.extra||0)*l.q; },0); },
  add:function(id, q, opts){ q=q||1; opts=opts||{}; var key=id+(opts.mods&&opts.mods.length?"|"+opts.mods.join(","):"");
    var l=cart.lines.filter(function(z){ return z.key===key; })[0]; if (l) l.q+=q; else cart.lines.push({key:key, id:id, q:q, mods:opts.mods||[], extra:opts.extra||0});
    saveCart(); },
  setQty:function(key, q){ cart.lines = cart.lines.map(function(l){ if (l.key===key) l.q=q; return l; }).filter(function(l){ return l.q>0; }); saveCart(); },
  remove:function(key){ var gone=cart.lines.filter(function(l){ return l.key===key; })[0]; cart.lines=cart.lines.filter(function(l){ return l.key!==key; }); saveCart(); return gone; },
  restore:function(line){ cart.lines.push(line); saveCart(); },
  clear:function(){ cart.lines=[]; saveCart(); },
  mode:function(m){ if (m){ cart.mode=m; saveCart(); } return cart.mode; },
  on:function(f){ listeners.push(f); }
};
function updateCartUI(bump){ var n = SC.cart.count(), s = SC.cart.subtotal();
  document.querySelectorAll("[data-cnt]").forEach(function(el){ el.textContent=n; el.hidden=n===0; if (bump && !reduce){ el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); } });
  document.querySelectorAll("[data-cartnav]").forEach(function(b){ b.setAttribute("aria-label", n ? "Количка, "+SC.plural(n,"ястие","ястия")+", "+SC.fmt(s) : "Количка, празна"); }); }
SC.updateCartUI = updateCartUI;

/* ---------- motion helpers ---------- */
var device, scroller, ov;
function rel(el){ var a=el.getBoundingClientRect(), b=device.getBoundingClientRect(); return {x:a.left-b.left, y:a.top-b.top, w:a.width, h:a.height}; }
SC.fly = function(fromEl, id){ if (reduce || !fromEl || !device) return; var to = device.querySelector("[data-cartnav]"); if (!to) return;
  var a=rel(fromEl), b=rel(to), el=document.createElement("div"); el.className="fly"; el.innerHTML=SC.art(id);
  var x0=a.x+a.w/2-20, y0=a.y+a.h/2-20, dx=b.x+b.w/2-20-x0, dy=b.y+b.h/2-20-y0; el.style.left=x0+"px"; el.style.top=y0+"px"; device.appendChild(el);
  el.animate([{transform:"translate(0,0) scale(1) rotate(0)"},{transform:"translate("+dx*.5+"px,"+(dy*.5-40)+"px) scale(.9) rotate(120deg)",offset:.5},{transform:"translate("+dx+"px,"+dy+"px) scale(.35) rotate(240deg)",opacity:.7}],{duration:400,easing:"cubic-bezier(.32,.72,0,1)"}).onfinish=function(){ el.remove(); }; };
SC.haptic = function(){ try{ navigator.vibrate && navigator.vibrate(12); }catch(e){} };
var toastT;
SC.toast = function(text, undo){ var t = device.querySelector(".toast"); if (!t){ t=document.createElement("div"); t.className="toast"; t.setAttribute("role","status"); device.appendChild(t); }
  t.innerHTML='<span>'+SC.esc(text)+'</span>'+(undo?'<button type="button">Отмени</button>':''); if (undo) t.querySelector("button").onclick=function(){ undo(); t.classList.remove("on"); };
  requestAnimationFrame(function(){ t.classList.add("on"); }); clearTimeout(toastT); toastT=setTimeout(function(){ t.classList.remove("on"); }, undo?5000:2400); };
SC.flash = function(btn, html, ms){ var old=btn.innerHTML; btn.classList.add("done"); btn.innerHTML=html; setTimeout(function(){ if (btn.isConnected){ btn.classList.remove("done"); btn.innerHTML=old; } }, ms||1200); };
/* generic bottom sheet: returns {el, close} */
SC.sheet = function(opts){ var w=document.createElement("div"); w.className="sheetwrap"; var id="sh"+Math.random().toString(36).slice(2,7);
  w.innerHTML='<button class="scrim" type="button" aria-label="Затвори"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="'+id+'"><div class="handle"></div><div class="sheet-h"><h2 id="'+id+'">'+SC.esc(opts.title||"")+'</h2><button class="hb" type="button" data-close>'+SC.ic("x",20)+'Затвори</button></div><div class="body">'+(opts.html||"")+'</div></div>';
  ov.appendChild(w); var close=function(){ w.classList.remove("on"); setTimeout(function(){ w.remove(); }, 340); opts.onClose && opts.onClose(); };
  w.querySelector(".scrim").onclick=close; w.querySelector("[data-close]").onclick=close;
  requestAnimationFrame(function(){ w.classList.add("on"); var f=w.querySelector("[data-close]"); f && f.focus({preventScroll:true}); });
  return {el:w, close:close}; };
SC.reveal = function(root){ root = root || scroller; if (reduce || !("IntersectionObserver" in window)) return; var items=root.querySelectorAll(".rv:not(.in)"); if (!items.length) return;
  var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if (e.isIntersecting){ e.target.classList.add("in"); io.unobserve(e.target); } }); }, {root:scroller, threshold:.12});
  scroller.classList.add("rv-on"); items.forEach(function(el){ io.observe(el); }); };

/* ---------- chrome ---------- */
var NAV = [["menu","Меню","fork-knife","menu.html"],["reserve","Резервирай","calendar-blank","reservation.html"],["offers","Оферти","seal-percent","offers.html"],["profile","Профил","user","profile.html"]];
var DNAV = [["menu","Меню","menu.html"],["lunch","Обедно меню","lunch.html"],["reserve","Резервирай","reservation.html"],["events","Събития","events.html"],["offers","Оферти","offers.html"],["delivery","Доставка","delivery.html"],["about","За нас","about.html"]];
SC.PAGES = [["home.html","Начало"],["menu.html","Меню"],["lunch.html","Обедно меню"],["offers.html","Оферти"],["events.html","Събития и поводи"],["celebration.html","Калкулатор на празник"],["office.html","Обедна поръчка за офиса"],["reservation.html","Резервирай маса"],["delivery.html","Доставка"],["pickup.html","Вземи от място"],["bertha.html","Нашата фурна Bertha"],["about.html","За нас"],["gallery.html","Галерия"],["contacts.html","Контакти"],["allergens.html","Алергени"],["profile.html","Профил"]];
function header(o){ var st = SC.status();
  var cartBtn = '<a class="cartbtn" href="cart.html" data-cartnav aria-label="Количка">'+SC.ic("shopping-bag",24)+'<span class="cnt" data-cnt hidden>0</span></a>';
  var row1 = o.back
    ? '<header class="top back"><a class="hb" href="'+o.back.href+'">'+SC.ic("arrow-left",20)+SC.esc(o.back.label||"Назад")+'</a><span class="ttl">'+SC.esc(o.title||"")+'</span><div class="hact">'+(o.share?'<button class="hb" type="button" data-share>'+SC.ic("export",20)+'Сподели</button>':'')+'</div></header>'
    : '<header class="top"><a class="word" href="home.html" title="Заместител до новото лого">Siracusa</a><nav class="dnav" aria-label="Раздели">'+DNAV.map(function(d){ return '<a href="'+d[2]+'"'+(o.nav===d[0]?' aria-current="page"':'')+'>'+d[1]+'</a>'; }).join("")+'</nav><div class="hact">'+
      '<a class="hb call" href="tel:+359894365577" aria-label="Обади се на 0894 36 55 77">'+SC.ic("phone",20)+'Обади се</a><button class="hb" type="button" data-lang aria-label="Смени езика на английски">BG</button><button class="hb more" type="button" data-more>'+SC.ic("list",20)+'Още</button></div></header>';
  var row2 = '<div class="row2">'+(o.status===false?'':'<div class="status"><span class="dot '+st.cls+'"></span><span>'+st.html+'</span></div>')+cartBtn+'</div>';
  return '<div class="sentinel" data-sent></div>'+row1+row2; }
function bottomNav(active){ return '<nav class="nav" aria-label="Основна навигация">'+NAV.map(function(n){ return '<a href="'+n[3]+'"'+(active===n[0]?' aria-current="page"':'')+'>'+SC.ic(n[2],24)+n[1]+'</a>'; }).join("")+'</nav>'; }
SC.footer = function(){ var R=SC.RESTAURANT;
  return '<footer class="foot"><div class="cols"><div><span class="word">Siracusa</span><p class="muted" style="margin:10px 0 0">Пица на пещ и скара на дървени въглища в Дружба 2.</p><p style="margin:12px 0 0">'+R.address+'<br>'+R.phone+' · '+R.email+'</p><p class="muted small" style="margin:8px 0 0">Всеки ден 10:00 - 23:00. Кухнята приема до 22:30, доставка до 21:00.</p></div>'+
    '<div><h3>Поръчай</h3><a href="menu.html">Меню</a><a href="lunch.html">Обедно меню</a><a href="delivery.html">Доставка</a><a href="pickup.html">Вземи от място</a><a href="office.html">За офиса</a></div>'+
    '<div><h3>Ела при нас</h3><a href="reservation.html">Резервирай маса</a><a href="events.html">Събития и поводи</a><a href="celebration.html">Празник при нас</a><a href="bertha.html">Фурната Bertha</a><a href="gallery.html">Галерия</a></div>'+
    '<div><h3>Информация</h3><a href="about.html">За нас</a><a href="contacts.html">Контакти</a><a href="allergens.html">Алергени</a><a href="#" data-noop>Общи условия</a><a href="#" data-noop>Поверителност</a><a href="#" data-cookie-settings>Бисквитки</a></div></div>'+
    '<p class="legal">© '+new Date().getFullYear()+' Siracusa Bar &amp; Grill. Цените са в евро с ДДС.</p></footer>'; };
function morePanel(){ return '<div class="stack" style="gap:2px">'+SC.PAGES.map(function(p){ return '<a class="kv" href="'+p[0]+'" style="text-decoration:none;font-weight:700;min-height:52px;align-items:center">'+p[1]+SC.ic("caret-right",18)+'</a>'; }).join("")+'</div><div class="row" style="margin-top:14px"><a class="pill pill-line" href="tel:+359894365577">'+SC.ic("phone",20)+'0894 36 55 77</a><button class="pill pill-soft" type="button" data-lang>BG / EN</button></div>'; }
/* AI assistant: prototype answers the scripted examples, always from the real menu data */
function aiPanelHTML(){ return '<div class="aimsgs" data-aimsgs aria-live="polite"><div class="msg bot">Здравейте! Кажете ми за колко души поръчвате и какво обича всеки. Предлагам само ястия от нашето меню.</div></div>'+
  '<div class="chips aichips" style="margin:0;padding:2px 0"><button class="chip aichip" type="button" data-aiq="group">Ние сме четирима: един е вегетарианец и не яде лук, един иска месо, един обича сиренца</button><button class="chip aichip" type="button" data-aiq="lunch">Какво има в обедното меню днес?</button><button class="chip aichip" type="button" data-aiq="allergen">Кое е без глутен?</button></div>'+
  '<form class="aiform" data-aiform><label class="vh" for="aiq">Вашият въпрос</label><input id="aiq" type="text" placeholder="Напишете какво търсите" autocomplete="off"><button class="pill pill-red" type="submit" aria-label="Изпрати">'+SC.ic("paper-plane-right",20)+'</button></form><p class="aifine">Отговаря само от менюто. Алергените проверявайте и на страницата на ястието.</p>'; }
function aiPlan(){ var I2=M.items.filter(function(x){ return !SC.isOut(x); });
  var veg=I2.filter(function(x){ return x.t.indexOf("veg")>-1 && x.course==="main" && x.noOnion; }).sort(function(a,b){ return b.p-a.p; })[0];
  var meat=I2.filter(function(x){ return x.cat==="skara-bertha"; }).sort(function(a,b){ return b.p-a.p; })[0];
  var cheese=I2.filter(function(x){ return /сиренца|формаджи/i.test(x.n); }).sort(function(a,b){ return a.p-b.p; })[0];
  return [["Вегетарианец, без лук",veg,"Без лук и без месо по състава."],["Иска месо",meat,"Най-поръчваното от скарата Bertha."],["Обича сиренца",cheese,"Хрупкави, с домашно сладко от боровинки."]].filter(function(z){ return z[1]; }); }
function aiReply(kind){
  if (kind==="group"){ var plan=aiPlan(), ids=[], tot=0;
    var rows=plan.map(function(z){ var x=z[1]; ids.push(x.id); tot+=x.p; return '<div class="prow"><span class="pic">'+SC.art(x)+'</span><span><small>'+z[0]+'</small><b>'+SC.esc(x.n)+'</b><em>'+z[2]+'</em></span><span class="price">'+SC.fmt(x.p)+'</span></div>'; }).join("");
    return '<p>Ето предложение за трима от вас:</p>'+rows+'<p>А четвъртият какво обича? Кажете ми и ще допълня.</p><button class="pill pill-red pill-block" type="button" data-aiadd="'+ids.join(",")+'" style="margin-top:6px">Добави всичко · '+SC.fmt(tot)+'</button>'; }
  if (kind==="lunch"){ var L=M.lunch.items.filter(function(x){ return x.p; }); var pick=[L[0],L[7],L[12],L[16]].filter(Boolean);
    return '<p>Обедното меню за днес, до 15:00:</p><ul class="ailist">'+pick.map(function(x){ return '<li>'+SC.esc(x.n)+' · '+SC.fmt(x.p)+'</li>'; }).join("")+'</ul><p><a class="link" href="lunch.html">Цялото обедно меню'+SC.ic("caret-right",16)+'</a></p>'; }
  if (kind==="allergen"){ var g=M.items.filter(function(x){ return x.comp && x.al.indexOf("gluten")<0 && x.course==="main"; }).slice(0,4);
    return '<p>По състава без глутен изглеждат:</p><ul class="ailist">'+g.map(function(x){ return '<li><a href="dish.html#'+x.id+'">'+SC.esc(x.n)+'</a></li>'; }).join("")+'</ul><p class="muted small">Това е предварително, от състава. Кухнята още потвърждава алергените.</p>'; }
  return '<p>В прототипа отговарям само на примерите отгоре. Истинският асистент ще отговаря за менюто, алергените, часовете и доставката.</p>'; }
SC.aiAsk = function(text, kind){ var box=device.querySelector("[data-aimsgs]"); if (!box) return;
  box.insertAdjacentHTML("beforeend",'<div class="msg me">'+SC.esc(text)+'</div><div class="msg bot typing" data-typing><span></span><span></span><span></span></div>'); box.scrollTop=box.scrollHeight;
  setTimeout(function(){ var t=box.querySelector("[data-typing]"); if (t){ t.outerHTML='<div class="msg bot">'+aiReply(kind)+'</div>'; box.scrollTop=box.scrollHeight; } }, reduce?50:700); };
function openAI(){ var s = SC.sheet({title:"Асистент", html:aiPanelHTML()}); s.el.classList.add("aisheetwrap"); setTimeout(function(){ var i=s.el.querySelector("#aiq"); i && i.focus({preventScroll:true}); }, 60); }
function cookieBanner(){ if (load("sc-cookie", null)) return "";
  return '<div class="cookie" role="dialog" aria-label="Бисквитки"><p><b>Бисквитки.</b> Ползваме необходимите, за да работи количката. Аналитичните само ако разрешите.</p><div class="btns"><button class="pill pill-red" type="button" data-cookie="all">Приеми всички</button><button class="pill pill-line" type="button" data-cookie="min">Само необходимите</button><button class="pill pill-line" type="button" data-cookie="set">Настройки</button></div></div>'; }
function previewBar(){ if (window.innerWidth <= 700) return "";
  var t=[["now","Часът: сега"],["08:30","08:30 (преди отваряне)"],["10:30","10:30 (закуски, обедно)"],["12:30","12:30 (натоварено)"],["16:30","16:30 (-30% обедно)"],["21:30","21:30 (без доставка)"],["22:45","22:45 (кухнята затвори)"],["23:30","23:30 (затворено)"]];
  return '<div class="pv-bar'+(prefs.view==="desktop"?" low":"")+'" role="toolbar" aria-label="Изглед на прототипа"><a href="../index.html">'+SC.ic("squares-four",18)+'Страници</a><span class="sep"></span>'+
    '<button type="button" data-pv="view" data-v="phone" aria-pressed="'+(prefs.view==="phone")+'">Телефон</button><button type="button" data-pv="view" data-v="desktop" aria-pressed="'+(prefs.view==="desktop")+'">Компютър</button><span class="sep"></span>'+
    '<button type="button" data-pv="theme" data-v="system" aria-pressed="'+(prefs.theme==="system")+'">Авто</button><button type="button" data-pv="theme" data-v="light" aria-pressed="'+(prefs.theme==="light")+'">Светла</button><button type="button" data-pv="theme" data-v="dark" aria-pressed="'+(prefs.theme==="dark")+'">Тъмна</button><span class="sep"></span>'+
    '<label class="vh" for="pvtime">Час за статуса</label><select id="pvtime" data-pvtime>'+t.map(function(x){ return '<option value="'+x[0]+'"'+(prefs.time===x[0]?" selected":"")+'>'+x[1]+'</option>'; }).join("")+'</select></div>'; }
function applyPrefs(){ var de=document.documentElement; if (prefs.theme==="system") delete de.dataset.theme; else de.dataset.theme=prefs.theme;
  de.classList.toggle("pv-phone", prefs.view==="phone" && window.innerWidth>700); }

/* SC.mount(opts) -> <main> element to fill.
   opts: {page:"home", nav:"menu"|"reserve"|"offers"|"profile"|null, back:{href,label}, title, share:bool, status:bool,
          footer:bool (default true), ai:bool (default true), actionBar:bool (page renders its own .abar into SC.ov), bottomNav:bool (default true)} */
SC.mount = function(o){ o = o || {};
  applyPrefs();
  document.body.insertAdjacentHTML("afterbegin", previewBar());
  device = document.createElement("div"); device.className = "device"; device.dataset.page = o.page || "";
  scroller = document.createElement("div"); scroller.className = "scroller"; scroller.setAttribute("data-scroller","");
  ov = document.createElement("div"); ov.className = "ov";
  device.appendChild(scroller); device.appendChild(ov); document.body.appendChild(device);
  SC.device = device; SC.scroller = scroller; SC.ov = ov;
  scroller.innerHTML = header(o) + '<main id="main" data-main></main>' + (o.footer===false ? '<div class="end-space"></div>' : SC.footer());
  var showNav = o.bottomNav !== false;
  ov.insertAdjacentHTML("beforeend", (showNav ? bottomNav(o.nav) : "") + (o.ai===false ? "" : '<button class="aifab'+(o.actionBar?" up":"")+(showNav?"":" nonav")+'" type="button" data-ai aria-label="Асистент">'+SC.ic("sparkle",20)+'<span class="lbl">Асистент</span></button>') + cookieBanner());
  if ("IntersectionObserver" in window){ var sent = scroller.querySelector("[data-sent]"); new IntersectionObserver(function(es){ var sc=!es[0].isIntersecting; scroller.classList.toggle("scrolled", sc); var f=ov.querySelector(".aifab"); f && f.classList.toggle("mini", sc); }, {root:scroller, rootMargin:"40px 0px 0px 0px"}).observe(sent); }
  updateCartUI(false);
  document.title = (o.docTitle || o.title || "Siracusa") + (o.docTitle||o.title ? " | Siracusa Bar & Grill" : " Bar & Grill");
  return scroller.querySelector("[data-main]"); };

/* ---------- global delegation ---------- */
document.addEventListener("click", function(e){
  var t = e.target.closest("button, a"); if (!t) return;
  if (t.matches("a[data-noop]")){ e.preventDefault(); SC.toast("Правната страница се прави отделно."); return; }
  if (t.dataset.pv){ prefs[t.dataset.pv] = t.dataset.v; savePrefs(); location.reload(); return; }
  if (t.dataset.add){ e.preventDefault(); SC.cart.add(t.dataset.add, 1); SC.fly(t, t.dataset.add); SC.haptic(); SC.flash(t, SC.ic("check",22)); SC.toast("Добавено ✓"); return; }
  if (t.hasAttribute("data-ai")){ openAI(); return; }
  if (t.dataset.aiq){ SC.aiAsk(t.textContent, t.dataset.aiq); return; }
  if (t.dataset.aiadd){ t.dataset.aiadd.split(",").forEach(function(k,i){ SC.cart.add(k,1); setTimeout(function(){ SC.fly(t,k); }, i*120); }); SC.flash(t, SC.ic("check",22)+"Добавено в количката", 1600); return; }
  if (t.hasAttribute("data-more")){ SC.sheet({title:"Още", html:morePanel()}); return; }
  if (t.hasAttribute("data-lang")){ SC.toast("Английската версия идва след българската."); return; }
  if (t.hasAttribute("data-share")){ SC.toast("Връзката е копирана"); try{ navigator.clipboard.writeText(location.href).catch(function(){}); }catch(x){} return; }
  if (t.dataset.cookie){ store("sc-cookie", t.dataset.cookie); var c=device.querySelector(".cookie"); if (t.dataset.cookie==="set"){ SC.sheet({title:"Бисквитки", html:'<label class="check"><input type="checkbox" checked disabled id="ck1"><span><b>Необходими</b><br><span class="muted small">Количка, вход, език. Винаги включени.</span></span></label><label class="check"><input type="checkbox" id="ck2"><span><b>Аналитични</b><br><span class="muted small">Помагат ни да виждаме кое се поръчва. Изключени по подразбиране.</span></span></label><label class="check"><input type="checkbox" id="ck3"><span><b>Маркетингови</b><br><span class="muted small">Изключени по подразбиране.</span></span></label>'}); } c && c.remove(); return; }
  if (t.hasAttribute("data-cookie-settings")){ e.preventDefault(); localStorage.removeItem("sc-cookie"); location.reload(); return; }
});
document.addEventListener("change", function(e){ if (e.target.matches("[data-pvtime]")){ prefs.time=e.target.value; savePrefs(); location.reload(); } });
document.addEventListener("submit", function(e){ var af = e.target.closest("[data-aiform]"); if (!af) return; e.preventDefault(); var inp=af.querySelector("input"), v=inp.value.trim(); if (!v) return; inp.value="";
  SC.aiAsk(v, /четир|вегетари|лук|сирен|месо|души|трима|двама/i.test(v)?"group":/обед/i.test(v)?"lunch":/глутен|алерг/i.test(v)?"allergen":"other"); });
document.addEventListener("keydown", function(e){ if (e.key==="Escape"){ var w=document.querySelectorAll(".sheetwrap.on"); if (w.length){ var last=w[w.length-1]; var b=last.querySelector("[data-close]"); b && b.click(); } } });
})();
