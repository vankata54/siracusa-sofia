/* Category page (/menu/<кат>/): HTML pieces shared by the server (index.astro frontmatter) and the browser (its script).
   Port of design/pages/category.html (design/PAGES.md "category.html" + the common logic of menus and filters).
   Pure string renderers, no DOM. The card, the chip icons and the plural come from ../_menu.ts (same look as /menu/).
   Pieces that depend on the hour take a State; the server calls them without one and the browser fills them in. */
import { cats, catById, inCat, isOut, FILTERS, ZONES, RESTAURANT, type Dish, type Category } from "../../../lib/data.ts";
import type { State, Eta } from "../../../lib/status.ts";
import { art } from "../../../lib/render.ts";
import { kind } from "../../../lib/art.ts";
import { ic } from "../../../lib/icons.ts";
import { esc, fmt } from "../../../lib/format.ts";
import { url } from "../../../lib/routes.ts";
import { noun, NOUN, passes, searchScores, filterById } from "../../../lib/filters.ts";
import { card, cap, fic, FICON } from "../_menu.ts";
/* icons this module draws (registered for SC.ic in the browser; the server has them all) */
import "../../../lib/icons/pizza.ts";
import "../../../lib/icons/bowl-food.ts";
import "../../../lib/icons/cooking-pot.ts";
import "../../../lib/icons/knife.ts";
import "../../../lib/icons/flame.ts";
import "../../../lib/icons/fork-knife.ts";
import "../../../lib/icons/bread.ts";
import "../../../lib/icons/carrot.ts";
import "../../../lib/icons/jar.ts";
import "../../../lib/icons/hamburger.ts";
import "../../../lib/icons/cake.ts";
import "../../../lib/icons/coffee.ts";
import "../../../lib/icons/tag.ts";
import "../../../lib/icons/scales.ts";
import "../../../lib/icons/moped.ts";
import "../../../lib/icons/storefront.ts";
import "../../../lib/icons/list-bullets.ts";
import "../../../lib/icons/funnel.ts";
import "../../../lib/icons/sliders-horizontal.ts";
import "../../../lib/icons/info.ts";
import "../../../lib/icons/warning-circle.ts";
import "../../../lib/icons/arrow-up-right.ts";
import "../../../lib/icons/caret-down.ts";
import "../../../lib/icons/caret-right.ts";
import "../../../lib/icons/star.ts";
import "../../../lib/icons/list-checks.ts";
import "../../../lib/icons/x.ts";
import "../../../lib/icons/phone.ts";

/** Categories that have dishes (one static page each). */
export const CATS: Category[] = cats.filter((c) => inCat(c.id).length);

export const ICON: Record<string, string> = {
  pitsi: "pizza", salati: "bowl-food", supi: "cooking-pot", "studeni-predyastia": "knife", "topli-predyastia": "flame", "osnovni-yastia": "fork-knife", "pasta-i-rizoto": "bowl-food",
  "skara-bertha": "fire", hlebcheta: "bread", garnituri: "carrot", sosove: "jar", burgeri: "hamburger", dobavki: "plus", deserti: "cake", zakuski: "coffee",
};
/* target keywords from MASTER-PROMPT v2, 11.3 (only where the pack names them) */
export const KEYS: Record<string, string> = { pitsi: "пица Дружба, пица на пещ София, доставка на пица Дружба", "skara-bertha": "скара на дървени въглища, кебапчета, ребра, стек Black Angus" };
/* one real sentence per category where the pack gives a fact (no invented copy) */
export const FACT: Record<string, string> = { "skara-bertha": "Печем на дървени въглища в затворената фурна Bertha, при около 250 - 350 °C.", zakuski: "Сервираме закуски всеки ден от 10:00 до 11:30." };

const many = (catId: string): string => (NOUN[catId] ? NOUN[catId][1] : "ястия");
export const count = (catId: string, n: number): string => noun(catId, n);
const listJoin = (names: string[]): string => (names.length < 2 ? names.join("") : names.slice(0, -1).join(", ") + " и " + names[names.length - 1]);
export const FREE = ZONES.filter((z) => z.free).map((z) => z.n);
export const PAID = ZONES.filter((z) => !z.free).map((z) => z.n);

/* ---------- address: /menu/pitsi/#f=veg.hot&a=gluten.milk&q=моцарела&sort=asc ---------- */
export type Sort = "rec" | "asc" | "desc";
export interface CatState { f: string[]; a: string[]; q: string; sort: Sort }
const ALLERGEN_IDS = ["gluten", "crustaceans", "eggs", "fish", "peanuts", "soy", "milk", "nuts", "celery", "mustard", "sesame", "sulphites", "lupin", "molluscs"];
export function parseHash(hash: string): CatState {
  const st: CatState = { f: [], a: [], q: "", sort: "rec" };
  let h = hash.replace(/^#/, "");
  try { h = decodeURIComponent(h); } catch { /* keep raw */ }
  h.split("&").forEach((p) => {
    const i = p.indexOf("=");
    if (i < 0) return;
    const k = p.slice(0, i), v = p.slice(i + 1), vs = v.split(/[.,]/).filter(Boolean);
    if (k === "f") st.f = vs.filter((id) => { const f = filterById(id); return !!f && !f.needs; });
    else if (k === "a" || k === "no") st.a = vs.filter((id) => ALLERGEN_IDS.indexOf(id) > -1); /* "no" = the prototype's first format */
    else if (k === "q") st.q = v.trim();
    else if (k === "sort" && (v === "asc" || v === "desc")) st.sort = v;
  });
  return st;
}
export function hashOf(st: CatState): string {
  const p: string[] = [];
  if (st.f.length) p.push("f=" + st.f.join("."));
  if (st.a.length) p.push("a=" + st.a.join("."));
  if (st.q) p.push("q=" + encodeURIComponent(st.q));
  if (st.sort !== "rec") p.push("sort=" + st.sort);
  return p.length ? "#" + p.join("&") : "";
}
export const anyFilter = (st: CatState): boolean => !!(st.f.length || st.a.length || st.q);

/* ---------- data helpers ---------- */
/** Filters + allergens + search. A dish without composition cannot be checked for allergens: it stays, with a note. */
export function apply(list: Dish[], f: string[], a: string[], q: string): Dish[] {
  let out = list.filter((x) => passes(x, { f, a: x.comp ? a : [] }));
  if (q.trim()) { const sc = searchScores(out, q); out = out.filter((x) => sc[x.id]); }
  return out;
}
/** "Препоръчани": price anchor first (hit or the priciest), then "Ново", then menu order; sold out always last. */
export function sorted(list: Dish[], all: Dish[], sort: Sort): Dish[] {
  const idx: Record<string, number> = {};
  all.forEach((x, i) => { idx[x.id] = i; });
  const anchor = all.filter((x) => !isOut(x)).slice().sort((a, b) => Number(b.t.indexOf("hit") > -1) - Number(a.t.indexOf("hit") > -1) || b.p - a.p)[0];
  const rank = (x: Dish) => (x === anchor ? 0 : x.t.indexOf("new") > -1 ? 1 : 2);
  return list.slice().sort((a, b) => {
    const oa = isOut(a), ob = isOut(b);
    if (oa !== ob) return oa ? 1 : -1;
    if (sort === "asc") return a.p - b.p || idx[a.id] - idx[b.id];
    if (sort === "desc") return b.p - a.p || idx[a.id] - idx[b.id];
    return rank(a) - rank(b) || idx[a.id] - idx[b.id];
  });
}
/** The signature dish of a list: hit, else new, else the priciest one in stock. */
export function hero(list: Dish[]): Dish {
  const ok = list.filter((x) => !isOut(x));
  return ok.find((x) => x.t.indexOf("hit") > -1) || ok.find((x) => x.t.indexOf("new") > -1) || ok.slice().sort((a, b) => b.p - a.p)[0] || list[0];
}
export function priceRange(list: Dish[]): { min: number; max: number } {
  const p = list.map((x) => x.p);
  return { min: Math.min(...p), max: Math.max(...p) };
}
/** "300 - 400 гр." (non-breaking spaces), "" when there is no weight or units are mixed. */
export function gramRange(list: Dish[]): string {
  const g: number[] = [];
  let unit: string | null = null, mixed = false;
  list.forEach((x) => {
    if (x.per100) return;
    const m = /(\d+)\s*(гр|мл)/.exec(x.g || "");
    if (!m) return;
    if (unit && unit !== m[2]) mixed = true;
    unit = m[2]; g.push(+m[1]);
  });
  if (!g.length || mixed) return "";
  const a = Math.min(...g), b = Math.max(...g);
  return (a === b ? a : a + " - " + b) + " " + unit + ".";
}
const priceText = (pr: { min: number; max: number }): string => (pr.min === pr.max ? fmt(pr.min) : "от " + fmt(pr.min).replace(" €", "") + " до " + fmt(pr.max));

/* ---------- hero ---------- */
export function crumbsHTML(c: Category | null): string {
  return '<nav class="crumbs" aria-label="Къде сте"><ol><li><a href="' + url.menu() + '">' + ic("fork-knife", 18) + "Меню</a></li>" +
    (c ? '<li aria-current="page">' + esc(c.n) + "</li>" : "") + "</ol></nav>";
}
/** The hour line in the facts (delivery / pickup / breakfast hours / opens at 10:00). */
export function timeFact(c: Category, S: State, e: Eta): string {
  if (c.id === "zakuski" && !S.breakfast) return '<span class="fi">' + ic("clock", 18) + "</span><span>Сервираме ги от 10:00 до 11:30</span>";
  if (S.delivery) return '<span class="fi">' + ic("moped", 18) + "</span><span>Доставка около " + e.min + " мин" + (e.busy ? '<span class="sub">Възможни са закъснения</span>' : "") + "</span>";
  if (S.kitchen) return '<span class="fi">' + ic("storefront", 18) + '</span><span>Вземане до 22:30<span class="sub">Доставката приключи</span></span>';
  return '<span class="fi">' + ic("clock", 18) + "</span><span>Поръчки от 10:00</span>";
}
export function timeFactCls(c: Category, S: State, e: Eta): string {
  if (c.id === "zakuski" && !S.breakfast) return "warn";
  if (S.delivery) return e.busy ? "warn" : "ok";
  return "warn";
}
export function factsHTML(c: Category): string {
  const it = inCat(c.id), gr = gramRange(it);
  return '<ul class="facts">' +
    '<li><span class="fi">' + ic(ICON[c.id] || "fork-knife", 18) + "</span>" + count(c.id, it.length) + "</li>" +
    '<li><span class="fi">' + ic("tag", 18) + '</span><span class="price" style="font-weight:700">' + priceText(priceRange(it)) + "</span></li>" +
    (gr ? '<li class="g-fact"><span class="fi">' + ic("scales", 18) + "</span>" + (/-/.test(gr) ? "по " : "") + gr + "</li>" : "") +
    '<li data-tfact hidden></li></ul>';
}
export function introHTML(c: Category): string {
  const it = inCat(c.id), pr = priceRange(it), gr = gramRange(it);
  let t = "В менюто има <b>" + count(c.id, it.length) + "</b>" + (gr ? ", по " + gr + " " : ", ") + "с цени от " + fmt(pr.min).replace(" €", "") + " до " + fmt(pr.max) + ". ";
  if (FACT[c.id]) t += FACT[c.id] + " ";
  t += "Доставяме безплатно в " + listJoin(FREE) + " всеки ден до 21:00, а поръчки за вземане от място приемаме до 22:30.";
  const gap = '<span class="seo-gap"><span class="missing">[ЛИПСВА: SEO текст за „' + esc(c.n) + "“, 150&nbsp;-&nbsp;300 думи, над ястията]</span><small>" +
    (KEYS[c.id] ? "Ключови думи от пакета: " + KEYS[c.id] + ". " : "") + "Пише го агенцията след анализа на ключовите думи и конкурентите.</small></span>";
  return '<p class="intro-p" id="intro-p">' + t + gap + '</p><button class="link intro-more" type="button" aria-expanded="false" aria-controls="intro-p" data-more-intro><span>Още</span>' + ic("caret-down", 18) + "</button>";
}
export function heroHTML(c: Category): string {
  const h = hero(inCat(c.id)), hit = h.t.indexOf("hit") > -1, nw = h.t.indexOf("new") > -1;
  return '<section class="ch" aria-labelledby="cat-h1">' +
    '<div class="ch-plate' + (kind(h) === "platter" ? " square" : "") + '"><span class="sh" aria-hidden="true"></span><div class="ch-spin" aria-hidden="true">' + art(h) + "</div>" +
    '<a class="hit-tag" href="' + url.dish(h) + '"><span class="bd">' + ic(hit ? "fire" : nw ? "sparkle" : "star", 22) + "</span><span><small>" + (hit ? "Хит" : nw ? "Ново" : "Препоръчваме") + " · " + fmt(h.p) + "</small><b>" + esc(h.n) + "</b></span></a></div>" +
    '<div class="ch-text">' + crumbsHTML(c) + '<h1 class="h1" id="cat-h1">' + esc(c.n) + "</h1>" + factsHTML(c) + "</div>" +
    '<div class="ch-intro">' + introHTML(c) + "</div></section>";
}

/* ---------- notices (closed, offline, breakfast over) ---------- */
function notice(icon: string, title: string, text: string, acts: string): string {
  return '<div class="notice"><span class="ni">' + ic(icon, 22) + "</span><div><b>" + title + "</b><p>" + text + "</p>" + (acts ? '<div class="acts">' + acts + "</div>" : "") + "</div></div>";
}
export function noticesHTML(c: Category, S: State, offline: boolean): string {
  const n: string[] = [];
  if (offline) n.push(notice("warning-circle", "Няма връзка с интернет", "Показваме менюто от последното ви посещение. Количката е запазена; ще поръчате, когато връзката се върне.", '<button class="pill pill-line" type="button" data-retry>' + ic("arrow-up-right", 18) + "Опитай пак</button>"));
  if (c.id === "zakuski" && !S.breakfast && S.m >= 690) n.push(notice("coffee", "Закуските свършиха за днес", "Сервираме ги всеки ден от 10:00 до 11:30. Можете да изберете нещо друго от менюто.", '<a class="pill pill-line" href="' + url.menu() + '">Към менюто</a>'));
  else if (c.id === "zakuski" && S.m < 600) n.push(notice("coffee", "Закуските са от 10:00 до 11:30", "Отваряме в 10:00. Тогава можете да поръчате.", ""));
  else if (!S.kitchen) n.push(notice("clock", S.m < 600 ? "Кухнята отваря в 10:00" : "Кухнята затвори за днес", "Приемаме поръчки всеки ден от 10:00 до 22:30. Изберете спокойно сега, количката ще ви чака" + (S.m < 600 ? "." : " за утре."), ""));
  return n.join("");
}

/* ---------- filters + results ---------- */
export function chipsHTML(c: Category, st: CatState): string {
  const it = inCat(c.id), total = it.length;
  let h = '<button class="chip" type="button" data-allergens aria-pressed="' + (st.a.length > 0) + '" aria-haspopup="dialog">' + ic("funnel", 18) +
    (st.a.length ? "Без " + st.a.length + " " + (st.a.length === 1 ? "алерген" : "алергена") : "Алергени") + "</button>";
  for (const F of FILTERS) {
    if (F.needs) continue;
    const all = it.filter(F.test).length;
    if (!all || all === total) continue; /* no dish, or every dish: the chip would change nothing */
    const on = st.f.indexOf(F.id) > -1, other = st.f.filter((k) => k !== F.id);
    const n = apply(it, other.concat(F.id), st.a, st.q).length;
    h += '<button class="chip ' + (FICON[F.id] || "") + '" type="button" data-f="' + F.id + '" aria-pressed="' + on + '"' + (!on && !n ? " disabled" : "") + ">" + ic(fic(F), 18) + F.n + ' <span class="n">' + n + "</span></button>";
  }
  return h + '<button class="chip ghost" type="button" data-morefilters aria-haspopup="dialog">' + ic("sliders-horizontal", 18) + "Още филтри</button>";
}
export const SORT_NAME: Record<Sort, string> = { rec: "Препоръчани", asc: "Цена ↑", desc: "Цена ↓" };
/** "later": breakfast outside 10:00 - 11:30 (no "+", the hour instead); null on the server. */
export function laterText(c: Category, S: State | null): string | null {
  if (!S || c.id !== "zakuski" || S.breakfast) return null;
  return S.m < 600 ? "от 10:00" : "утре<br>от 10:00";
}
/** The menu's card; a sold-out dish also gets muted name and price (.is-out). */
export function cardC(x: Dish, nd: boolean, later: string | null): string {
  const h = card(x, { nd, later: isOut(x) ? null : later });
  return isOut(x) ? h.replace('<div class="dcard"', '<div class="dcard is-out"') : h;
}
export function resultsHTML(c: Category, st: CatState, S: State | null): string {
  const it = inCat(c.id), total = it.length, res = sorted(apply(it, st.f, st.a, st.q), it, st.sort), any = anyFilter(st);
  const title = any ? res.length + " от " + count(c.id, total) : count(c.id, total);
  const sub = any ? "<small>" + (st.q ? "с „" + esc(st.q) + "“" + (st.f.length || st.a.length ? " и филтрите" : "") : "с избраните филтри") + "</small>" : "";
  const head = '<div class="resbar"><h2 id="res-h" aria-live="polite">' + title + sub + '</h2><button class="pill pill-soft sortbtn" type="button" data-sort aria-haspopup="dialog">' + ic("list-bullets", 18) + SORT_NAME[st.sort] + "</button></div>" +
    '<div class="res-note"><span class="note-auto">' + ic("info", 18) + "<span>Алергените са предварителни, от състава. Кухнята ги потвърждава.</span></span>" +
    (any ? '<button class="link" type="button" data-clear>' + ic("x", 16) + "Изчисти филтрите</button>" : "") + "</div>";
  const later = laterText(c, S), nd = st.a.length > 0;
  const grid = res.length ? res.map((x) => cardC(x, nd, later)).join("") :
    '<div class="empty empty-f"><span class="ill">' + ic("funnel", 40) + '</span><h3 class="h3">Няма ' + many(c.id) + ' с тези филтри</h3><p class="muted">Махнете някой филтър или вижте цялото меню.</p>' +
    '<div class="row" style="flex-wrap:wrap;justify-content:center"><button class="pill pill-red" type="button" data-clear>Изчисти филтрите</button><a class="pill pill-line" href="' + url.menu() + '">Цялото меню</a></div></div>';
  return head + '<div class="grid-dishes">' + grid + "</div>";
}

/* ---------- other categories ---------- */
export function catsHTML(current: string | null): string {
  return '<ul class="cats">' + CATS.filter((c) => c.id !== current).map((c) => {
    const its = inCat(c.id), h = hero(its);
    return '<li><a class="cat" href="' + url.cat(c.id) + '"><span class="pic" aria-hidden="true">' + art(h) + "</span><span><b>" + esc(c.n) + "</b><small>" +
      (c.id === "zakuski" ? its.length + " · до 11:30" : count(c.id, its.length)) + "</small></span></a></li>";
  }).join("") + "</ul>";
}
export function othersHTML(c: Category): string {
  return '<section class="sec" aria-labelledby="oc-h"><h2 class="h2" id="oc-h" style="margin-bottom:16px">Други категории</h2>' + catsHTML(c.id) +
    '<a class="pill pill-line pill-block allmenu" href="' + url.menu() + '">' + ic("fork-knife", 20) + "Цялото меню на една страница</a></section>";
}

/* ---------- FAQ (from the restaurant's data; the final copy is [ЛИПСВА]) ---------- */
export function faqData(c: Category): [string, string][] {
  const it = inCat(c.id), veg = it.filter((x) => x.t.indexOf("veg") > -1), gr = gramRange(it), nn = many(c.id);
  const more = (href: string, t: string) => '<p><a class="link" href="' + href + '">' + t + ic("caret-right", 16) + "</a></p>";
  const q: [string, string][] = [];
  q.push(["Докъде доставяте?", "<p>Безплатно до " + listJoin(FREE) + ", всеки ден до 21:00, обикновено за около 35 мин. До " + listJoin(PAID) + ' доставяме по тарифа <span class="missing">[ЛИПСВА: такса в €]</span>.</p>' + more(url.page("delivery"), "Проверете адреса си")]);
  q.push(["Мога ли да взема поръчката от ресторанта?", "<p>Да. Поръчки за вземане приемаме до 22:30 и са готови най-рано след 20 мин. Адресът е " + esc(RESTAURANT.address) + ".</p>" + more(url.page("pickup"), "Как работи вземането")]);
  if (c.id === "pitsi") q.push(["Колко голяма е една пица?", "<p>Пиците са " + gr + ' Диаметър: <span class="missing">[ЛИПСВА: диаметър в см]</span>.</p>']);
  if (c.id === "skara-bertha") q.push(["Какво е фурната Bertha?", "<p>Затворена фурна на дървени въглища: огънят нагрява стените и тавана, затова топлината е равномерна, около 250 - 350 °C. Оттам идва и опушеният вкус.</p>" + more(url.page("bertha"), "Повече за фурната")]);
  if (veg.length) q.push(["Има ли вегетариански " + nn + "?", "<p>Да, по състава " + (veg.length === 1 ? "е" : "са") + " " + veg.length + ": " +
    listJoin(veg.map((x) => '<a class="vlink" href="' + url.dish(x) + '">' + esc(x.n) + "</a>")) + ". Отбелязани са със зелено листо. Кухнята още ги потвърждава.</p>"]);
  q.push(["Къде да видя алергените?", "<p>На страницата на всяко ястие и в общата таблица. Засега са предварителни, извлечени от състава, и кухнята ги потвърждава. Ако имате алергия, обадете ни се на " + RESTAURANT.phone + ".</p>" + more(url.page("allergens"), "Всички алергени")]);
  return q;
}
export function faqHTML(c: Category): string {
  const q = faqData(c);
  return '<section class="sec" aria-labelledby="faq-h"><div class="faqwrap"><div><h2 class="h2" id="faq-h">Често задавани въпроси</h2><p class="muted faq-note">Отговорите са от данните на ресторанта. <span class="missing">[ЛИПСВА: окончателни въпроси и отговори от агенцията]</span></p></div>' +
    '<div class="shell faqbox"><div class="core faq">' + q.map((z, i) => "<details" + (i === 0 ? " open" : "") + "><summary>" + z[0] + '<span class="tg" aria-hidden="true">' + ic("plus", 18) + '</span></summary><div class="a">' + z[1] + "</div></details>").join("") + "</div></div></div></section>";
}

/* ---------- SEO ---------- */
export function metaDescription(c: Category): string {
  const it = inCat(c.id), pr = priceRange(it);
  return c.n + " в Siracusa Bar & Grill, Дружба 2: " + count(c.id, it.length) + " от " + fmt(pr.min) + " до " + fmt(pr.max) + ". Безплатна доставка в " + listJoin(FREE) + " до 21:00, вземане до 22:30.";
}
/** JSON-LD: Menu > MenuSection > MenuItem (prices in EUR), BreadcrumbList, FAQPage (only answers without [ЛИПСВА]). */
export function catLd(c: Category, site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  const item = (x: Dish) => {
    const offer: Record<string, unknown> = { "@type": "Offer", price: x.p.toFixed(2), priceCurrency: "EUR", availability: isOut(x) ? "https://schema.org/SoldOut" : "https://schema.org/InStock" };
    if (x.per100) offer.priceSpecification = { "@type": "UnitPriceSpecification", price: x.p.toFixed(2), priceCurrency: "EUR", referenceQuantity: { "@type": "QuantitativeValue", value: 100, unitCode: "GRM" } };
    const m: Record<string, unknown> = { "@type": "MenuItem", name: x.n, url: abs(url.dish(x)), offers: offer };
    if (x.comp) m.description = cap(x.comp);
    if (x.t.indexOf("veg") > -1) m.suitableForDiet = "https://schema.org/VegetarianDiet";
    return m;
  };
  const menu = {
    "@context": "https://schema.org", "@type": "Menu", "@id": abs(url.menu()) + "#menu", name: "Меню на " + RESTAURANT.name, url: abs(url.menu()), inLanguage: "bg",
    hasMenuSection: { "@type": "MenuSection", name: c.n, url: abs(url.cat(c.id)), hasMenuItem: inCat(c.id).map(item) },
  };
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) },
      { "@type": "ListItem", position: 2, name: "Меню", item: abs(url.menu()) },
      { "@type": "ListItem", position: 3, name: c.n, item: abs(url.cat(c.id)) },
    ],
  };
  const qs = faqData(c).filter((z) => z[1].indexOf("[ЛИПСВА") < 0);
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: qs.map((z) => ({ "@type": "Question", name: z[0], acceptedAnswer: { "@type": "Answer", text: z[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replace(/\s+([.,:])/g, "$1").trim() } })),
  };
  return [menu, crumbs, faq];
}

export { catById };
