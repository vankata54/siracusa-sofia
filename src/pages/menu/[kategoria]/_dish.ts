/* Dish page (/menu/<кат>/<ястие>/): HTML pieces shared by the server ([yastie].astro frontmatter) and the browser (its script).
   Port of design/pages/dish.html (design/PAGES.md "dish.html"). Pure string renderers: no DOM.
   The icons drawn here are imported below, so SC.ic() knows them in the browser too. */
import { items, byId, catById, inCat, isOut, ALLERGENS, allergenName, COURSE_NAME, RESTAURANT, type Dish } from "../../../lib/data.ts";
import { pic, plusBtn } from "../../../lib/render.ts";
import { ic } from "../../../lib/icons.ts";
import { esc, fmt } from "../../../lib/format.ts";
import { url } from "../../../lib/routes.ts";
import { suggest, type ManualPairs } from "../../../lib/suggest.ts";
import "../../../lib/icons/caret-right.ts";
import "../../../lib/icons/caret-down.ts";
import "../../../lib/icons/sliders-horizontal.ts";
import "../../../lib/icons/minus.ts";
import "../../../lib/icons/plus.ts";
import "../../../lib/icons/check.ts";
import "../../../lib/icons/heart.ts";
import "../../../lib/icons/clock.ts";
import "../../../lib/icons/cube.ts";
import "../../../lib/icons/image.ts";
import "../../../lib/icons/info.ts";
import "../../../lib/icons/phone.ts";

/* Categories where "Добави" makes sense (pizza toppings, cheese, prosciutto...). Owner to confirm (docs/OPEN-QUESTIONS.md). */
export const ADDON_CATS = ["pitsi", "burgeri", "pasta-i-rizoto", "salati", "zakuski"];
export const ADDONS: Dish[] = inCat("dobavki").slice().sort((a, b) => b.p - a.p);
const ICON_OF: Record<string, string> = {};
ALLERGENS.forEach((a) => { ICON_OF[a[0]] = a[2]; });

/** Dishes that have their own page (lunch items link to the lunch menu). */
export const DISHES: Dish[] = items.filter((x) => !x.lunch && x.cat !== "obedno" && catById[x.cat]);

export interface CatRef { id: string; n: string; href: string; back: string }
export function catOf(d: Dish): CatRef {
  const c = catById[d.cat] || { id: d.cat, n: "Меню" };
  return { id: c.id, n: c.n, href: url.cat(c.id), back: url.menu(c.id) };
}
export const compList = (d: Dish): string[] => (d.comp ? d.comp.split(",").map((s) => s.trim()).filter(Boolean) : []);
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
export const canAdd = (d: Dish): boolean => ADDON_CATS.indexOf(d.cat) > -1;
export const hasMods = (d: Dish): boolean => !isOut(d) && (compList(d).length > 0 || canAdd(d));

/* ---------- modifiers: rem = {index of the ingredient: true}, add = {addon id: true} ---------- */
export type Rem = Record<string, boolean>;
export type Add = Record<string, boolean>;
export const extra = (add: Add): number => ADDONS.filter((a) => add[a.id]).reduce((s, a) => s + a.p, 0);
export function modsList(d: Dish, rem: Rem, add: Add): string[] {
  const m: string[] = [];
  compList(d).forEach((c, i) => { if (rem[i]) m.push("без " + c); });
  ADDONS.forEach((a) => { if (add[a.id]) m.push("+ " + a.n); });
  return m;
}
export function modSummary(d: Dish, rem: Rem, add: Add): { has: boolean; sub: string; xp: string } {
  const m = modsList(d, rem, add), e = extra(add);
  if (!m.length) return {
    has: false, xp: "",
    sub: compList(d).length && canAdd(d) ? "Махнете съставка или добавете още сирене, прошуто, гъби" : compList(d).length ? "Махнете съставка, която не искате. Безплатно." : "Добавете сирене, прошуто, гъби и още",
  };
  return { has: true, sub: cap(m.join(" · ")), xp: e ? "+" + fmt(e) : "" };
}
export function modBtnInner(d: Dish, rem: Rem = {}, add: Add = {}): string {
  const s = modSummary(d, rem, add);
  return '<span class="ico">' + ic("sliders-horizontal", 24) + '</span><span><b>Добавки и промени</b><span class="sub">' + esc(s.sub) + "</span>" + (s.xp ? '<span class="xp">' + s.xp + " на брой</span>" : "") + '</span><span class="end">' + ic("caret-right", 20) + "</span>";
}

/* ---------- buy box (desktop inline) and the floating .abar (phone): the same HTML ---------- */
export function buyLabel(d: Dish, qty: number, unit: number): string {
  return d.per100
    ? '<span>Добави · <span class="price">' + fmt(unit) + '</span><span class="u100">/100 гр.</span></span>'
    : "<span>Добави" + (qty > 1 ? ' <span class="q">' + qty + " бр.</span>" : "") + ' · <span class="price">' + fmt(unit * qty) + "</span></span>";
}
export function buyHTML(d: Dish, qty = 1, unit = d.p): string {
  return '<div class="counter" role="group" aria-label="Брой"><button type="button" data-q="-1" aria-label="Едно по-малко"' + (qty <= 1 ? ' disabled style="opacity:.4;cursor:not-allowed"' : "") + ">" + ic("minus", 20) + '</button><output aria-live="polite">' + qty + '</output><button type="button" data-q="1" aria-label="Едно повече">' + ic("plus", 20) + "</button></div>" +
    '<button class="pill pill-red pill-lg" type="button" data-buy>' + buyLabel(d, qty, unit) + "</button>";
}
export function soldBarHTML(): string {
  return '<span class="soldlbl">' + ic("clock", 20) + 'Изчерпано днес</span><a class="pill pill-red" href="#similar" data-tosim>Вижте подобни</a>';
}

export function favHTML(on = false): string {
  return '<button class="pill pill-line fav" type="button" data-fav aria-pressed="' + on + '">' + ic("heart", 20) + "Любимо</button>";
}

/** Kitchen closed (depends on the hour: drawn in the browser). m = minutes since midnight. */
export function closedNote(kitchen: boolean, m: number, out: boolean): string {
  if (kitchen || out) return "";
  return '<div class="closednote">' + ic("clock", 20) + "<span>" + (m < 600 ? "Кухнята отваря в 10:00. Добавете сега и поръчайте, когато отворим." : "Кухнята приема поръчки до 22:30. Добавете сега и поръчайте за утре.") + "</span></div>";
}

/* ---------- pairing / similar cards ---------- */
export function pairCard(d: Dish, label: string): string {
  return '<div class="pcard"><a class="open" href="' + url.dish(d) + '">' + pic(d) + '<span><span class="eb">' + esc(label) + '</span><span class="nm">' + esc(d.n) + '</span><span class="meta"><span class="price">' + fmt(d.p) + '</span><span class="muted small">' + (d.per100 ? "за 100 гр." : esc(d.g)) + "</span></span></span></a>" + plusBtn(d) + "</div>";
}
export function similar(d: Dish): Dish[] {
  let pool = inCat(d.cat).filter((z) => z.id !== d.id && !isOut(z));
  if (pool.length < 3) pool = pool.concat(items.filter((z) => z.id !== d.id && !isOut(z) && z.course === d.course && z.cat !== d.cat && pool.indexOf(z) < 0));
  return pool.sort((a, b) => Math.abs(a.p - d.p) - Math.abs(b.p - d.p)).slice(0, 3);
}
/** "Върви добре с" (empty when sold out or nothing fits). */
export function pairsHTML(d: Dish, inCart: string[] = [], manual: ManualPairs = {}): string {
  if (isOut(d)) return "";
  const sug = suggest(d.id, inCart, manual);
  if (!sug.length) return "";
  return '<section class="sec" aria-labelledby="pairh"><div class="sec-h"><h2 class="h2" id="pairh">Върви добре с</h2></div><div class="pairs cols">' + sug.map((s) => pairCard(byId[s.id], COURSE_NAME[s.c] || "")).join("") + "</div></section>";
}

/* ---------- facts: composition, allergens, nutrition ---------- */
export function allergenBlock(d: Dish): string {
  const al = d.al || [], diet: [string, string][] = [];
  if (d.t.indexOf("veg") > -1) diet.push(["leaf", "Вегетарианско"]);
  if (d.noOnion) diet.push(["check", "Без лук"]);
  const li = al.map((k) => '<li class="alg"><span class="ico">' + ic(ICON_OF[k] || "info", 22) + "</span>" + esc(allergenName(k)) + "</li>").join("");
  let h = '<div class="fblk"><h2 class="h3">Алергени</h2>';
  if (!d.comp) {
    h += (al.length ? '<p class="algnone" style="margin-bottom:8px">Съдържа поне:</p><ul class="algs">' + li + "</ul>" : "") +
      '<p class="algnone">' + (al.length ? "Пълни данни за алергените още нямаме." : "Няма данни за алергени, попитайте ни.") + "</p>" +
      '<p class="note-auto" style="margin:0">' + ic("info", 18) + "<span>Кухнята въвежда състава и алергените на това ястие. Дотогава ви казваме по телефона.</span></p>" +
      '<div class="ask"><a class="pill pill-line" href="tel:' + RESTAURANT.phoneIntl + '">' + ic("phone", 20) + "Попитай: " + RESTAURANT.phone + "</a></div>";
  } else {
    h += (al.length ? '<ul class="algs" aria-label="Съдържа">' + li + "</ul>" : '<p class="algnone">По състава не открихме от 14-те основни алергена.</p>') +
      (diet.length ? '<p class="dietlbl">Също по състава:</p><ul class="algs" aria-label="По състава">' + diet.map((z) => '<li class="alg diet"><span class="ico">' + ic(z[0], 20) + "</span>" + z[1] + "</li>").join("") + "</ul>" : "") +
      '<p class="note-auto" style="margin:0">' + ic("info", 18) + "<span>Предварително, от състава. Потвърждава се от кухнята.</span></p>";
  }
  return h + '<a class="link" href="' + url.page("allergens") + '">Всички алергени в менюто' + ic("caret-right", 18) + "</a></div>";
}

export function factsCard(d: Dish): string {
  const c = compList(d);
  return '<div class="shell fcard"><div class="core">' +
    '<div class="fblk"><h2 class="h3">Състав</h2>' + (c.length
      ? '<p class="comp">' + c.map((s, i) => '<span class="ing">' + esc(i ? s : cap(s)) + (i < c.length - 1 ? '<span class="vh">,</span><span class="dot" aria-hidden="true">·</span>' : "") + "</span>").join(" ") + "</p>"
      : '<p class="comp"><span class="missing">[ЛИПСВА: състав от кухнята]</span></p>') + "</div>" +
    allergenBlock(d) +
    '<div class="fblk"><details class="nutr"><summary>Хранителна информация' + ic("caret-down", 22) + '</summary><div class="nbody">' +
      [["Енергия", "ккал"], ["Белтъчини", "г"], ["Въглехидрати", "г"], ["от тях захари", "г"], ["Мазнини", "г"], ["Сол", "г"]].map((r) => '<div class="kv"><span>' + r[0] + '</span><span class="missing">[ЛИПСВА]</span></div>').join("") +
      '<p class="note-auto" style="margin-top:8px">' + ic("info", 18) + "<span>" + (d.per100 ? "На 100 гр." : "На порция " + esc(d.g || "")) + ". Стойностите идват, когато кухнята ги въведе.</span></p></div></details></div>" +
    "</div></div>";
}

/* ---------- SEO ---------- */
export function metaDescription(d: Dish): string {
  return d.n + " от Siracusa Bar & Grill, Дружба 2: " + (d.comp ? d.comp + ". " : "") + (d.per100 ? "" : d.g ? d.g + ", " : "") + fmt(d.p) + (d.per100 ? " за 100 гр." : "") + ". Поръчайте с доставка или вземете от място.";
}

export function dishLd(d: Dish, site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  const c = catOf(d), price = d.p.toFixed(2);
  const offer: Record<string, unknown> = {
    "@type": "Offer", price, priceCurrency: "EUR",
    availability: isOut(d) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
    url: abs(url.dish(d)),
  };
  if (d.per100) offer.priceSpecification = {
    "@type": "UnitPriceSpecification", price, priceCurrency: "EUR",
    referenceQuantity: { "@type": "QuantitativeValue", value: 100, unitCode: "GRM" },
  };
  const item: Record<string, unknown> = {
    "@context": "https://schema.org", "@type": "MenuItem", name: d.n, url: abs(url.dish(d)), offers: offer,
  };
  if (d.comp) item.description = d.comp;
  if (d.t.indexOf("veg") > -1) item.suitableForDiet = "https://schema.org/VegetarianDiet";
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Меню", item: abs(url.menu()) },
      { "@type": "ListItem", position: 2, name: c.n, item: abs(c.href) },
      { "@type": "ListItem", position: 3, name: d.n, item: abs(url.dish(d)) },
    ],
  };
  return [item, crumbs];
}
