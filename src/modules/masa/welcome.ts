/* QR маса · welcome (/masa/<код>/): design/pages-masa/welcome.html. The table and its zone, the language of this phone,
   "Разгледай менюто", "Повикай сервитьор", what the guests can do here, who is at the table and what is in the shared
   cart, the categories and 4 dishes at once. After 22:30: "Разгледайте менюто и повикайте сервитьор, ако ви трябва нещо." */
import "sc-icons:tree,chair,arrow-right,bell-ringing,users-three,receipt,caret-right,lock,info";
import { mountMasa, type Masa } from "./frame.ts";
import { SC, dishesOf, syncMenu } from "./dishes.ts";

/* the 4 dishes and 6 categories of the prototype; a published menu without them shows what it has */
const PICKS = ["pitsa-s-burata-i-proshuto-krudo", "svinski-rebra", "pitsa-s-proshuto-koto-i-tryufel", "gratska-salata"];
const CATS = ["pitsi", "skara-bertha", "salati", "pasta-i-rizoto", "burgeri", "deserti"];

let D: ReturnType<typeof dishesOf> | null = null;
function picks() {
  const l = PICKS.map((id) => SC.byId[id]).filter((x) => x && x.cat !== "dobavki" && !x.lunch);
  for (const x of SC.items) { if (l.length >= 4) break; if (x.cat !== "dobavki" && !SC.isOut(x) && l.indexOf(x) < 0) l.push(x); }
  return l.slice(0, 4);
}
function cats() {
  const l = CATS.map((id) => SC.catById[id]).filter(Boolean);
  return l.length ? l : SC.cats.filter((c) => c.id !== "dobavki").slice(0, 6);
}

function nowCard(M: Masa) {
  const v = M.view, L = M.L, n = v.cart.n, sent = v.orders.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.q, 0), 0);
  const line = n ? L("В общата количка: ", "In the table cart: ") + M.dishes(n) + " · " + M.fmt(v.cart.sum)
    : sent ? L("Поръчани: ", "Ordered: ") + M.dishes(sent) : L("Количката още е празна", "The cart is still empty");
  const ph = [M.me(), ...v.phones.map((p) => p.phone).filter((p) => p !== M.me())];
  return '<a class="core now" href="' + M.href("cart") + '"><span class="avs">' + ph.map((p) => M.av(p)).join("") + "</span><span><b>" + L("На масата: ", "At the table: ") + ph.map((p) => M.esc(M.name(p))).join(", ") + '</b><span class="d">' + line + "</span></span>" + M.ic("caret-right", 20) + "</a>";
}

function render(M: Masa) {
  const v = M.view, L = M.L, ic = M.ic, lang = M.lang();
  D = D || dishesOf(M);
  const P = picks(), hero = P[0];
  M.main.innerHTML =
    '<section class="mpage wl" aria-labelledby="wl-h">' +
      '<div class="wl-grid"><div>' +
        '<div class="wl-hero"><div class="wl-art" aria-hidden="true"><div class="pic">' + (hero ? SC.art(hero) : "") + "</div></div>" +
          '<p class="eyebrow">' + L("Добре дошли в Siracusa", "Welcome to Siracusa") + "</p>" +
          '<h1 class="wl-t" id="wl-h">' + L("Маса", "Table") + "\u00a0" + v.table.n + "</h1>" +
          '<p class="wl-z">' + ic(v.table.zone === "garden" ? "tree" : "chair", 26) + M.esc(M.zone()) + "</p>" +
          (v.kitchen.open ? '<p class="wl-lead">' + L("Поръчайте от телефона", "Order from your phone") + " <span>" + L("- сервитьорът потвърждава първата поръчка.", "- the waiter confirms your first order.") + "</span></p></div>"
            : '<p class="wl-lead">' + L("Разгледайте менюто", "Browse the menu") + " <span>" + L("и повикайте сервитьор, ако ви трябва нещо.", "and call a waiter if you need anything.") + "</span></p></div>") +
        '<div class="wl-lang"><span class="label" id="lng">Език · Language</span><div class="seg" role="group" aria-labelledby="lng"><button type="button" data-mlang="bg" aria-pressed="' + (lang === "bg") + '" lang="bg">Български</button><button type="button" data-mlang="en" aria-pressed="' + (lang === "en") + '" lang="en">English</button></div></div>' +
        '<div class="wl-btns"><a class="pill pill-red go" href="' + M.href("menu") + '">' + L("Разгледай менюто", "Browse the menu") + '<span class="knob">' + ic("arrow-right", 22) + "</span></a>" +
          '<a class="pill pill-line" href="' + M.href("call") + '">' + ic("bell-ringing", 22) + L("Повикай сервитьор", "Call a waiter") + "</a></div>" +
        '<div class="mnotes">' + M.banners({ callLink: false }) + "</div>" +
      "</div>" +
      '<div class="can"><h2 class="h3">' + L("Какво можете оттук", "What you can do here") + "</h2>" +
        '<div class="shell"><div class="core"><ul>' +
          '<li><span class="ci">' + ic("users-three", 24) + "</span><span><b>" + L("Поръчайте заедно", "Order together") + '</b><span class="d">' + L("Всеки добавя от своя телефон в обща количка и вижда какво са избрали другите.", "Everyone adds from their own phone to one shared cart and sees what the others picked.") + "</span></span></li>" +
          '<li><span class="ci">' + ic("bell-ringing", 24) + "</span><span><b>" + L("Повикайте сервитьор", "Call a waiter") + '</b><span class="d">' + L("За поръчка, сметка, вода или прибори, с едно докосване.", "For an order, the bill, water or cutlery, with one tap.") + "</span></span></li>" +
          '<li><span class="ci">' + ic("receipt", 24) + "</span><span><b>" + L("Поискайте сметката", "Ask for the bill") + '</b><span class="d">' + L("В брой или с карта, заедно или поотделно.", "Cash or card, together or split.") + "</span></span></li>" +
        "</ul></div></div>" +
        '<div class="shell">' + nowCard(M) + "</div>" +
        '<p class="note-auto">' + ic("lock", 18) + "<span>" + L("Без вход и без парола. Масата се затваря със сметката.", "No sign-in, no password. The table closes with the bill.") + "</span></p>" +
      "</div></div>" +
      '<div class="wl-menu"><div class="sec-h"><h2 class="h2">' + L("Менюто", "The menu") + '</h2><a class="link" href="' + M.href("menu") + '">' + L("Цялото меню", "Full menu") + ic("caret-right", 18) + "</a></div>" +
        '<ul class="chips wl-cats" aria-label="' + L("Категории", "Categories") + '">' + cats().map((c) => '<li><a class="chip" href="' + M.href("menu", "c=" + c.id) + '">' + M.esc(c.n) + "</a></li>").join("") + "</ul>" +
        '<div class="rail">' + P.map(D.card).join("") + "</div>" +
        (lang === "en" ? '<p class="note-auto" style="margin-top:14px">' + ic("info", 18) + '<span>Dish names are in Bulgarian for now. <span class="missing">[ЛИПСВА: английски имена и състав на ястията]</span></span></p>' : "") +
      "</div>" +
    "</section>";
}

const M = mountMasa({ screen: "welcome", title: ["Добре дошли", "Welcome"], render: (m) => render(m) });
syncMenu(() => { if (M.view) M.rerender("remote"); });
