/* Dish page (/menu/<кат>/<ястие>/): HTML pieces that need the menu. The server ([yastie].astro frontmatter) uses all of it;
   the browser loads this module only later, for "Върви добре с" when the cart is not empty (the light part is _dish-ui.ts).
   Port of design/pages/dish.html (design/PAGES.md "dish.html"). Pure string renderers: no DOM. */
import { items, byId, catById, inCat, isOut, ALLERGENS, allergenName, COURSE_NAME, RESTAURANT, type Dish } from "../../../lib/data.ts";
import { pic, plusBtn } from "../../../lib/render.ts";
import { ic } from "../../../lib/icons.ts";
import { callBtn } from "../../../lib/ui.ts";
import { esc, fmt } from "../../../lib/format.ts";
import { url } from "../../../lib/routes.ts";
import { suggest, type ManualPairs } from "../../../lib/suggest.ts";
import { ORDER_RULES } from "../../../lib/consts.ts";
import { compList, cap, canAdd, endDot, type Addon, type DishLite } from "./_dish-ui.ts";
import "sc-icons:caret-down,caret-right,info,phone"; /* the icons of this module in one group (scripts/icon-groups.mjs) */

export * from "./_dish-ui.ts";

export const ADDONS: Addon[] = inCat(ORDER_RULES.addonCat).slice().sort((a, b) => b.p - a.p).map((a) => ({ id: a.id, n: a.n, p: a.p }));
const ICON_OF: Record<string, string> = {};
ALLERGENS.forEach((a) => { ICON_OF[a[0]] = a[2]; });

/** Dishes that have their own page (lunch items link to the lunch menu). */
export const DISHES: Dish[] = items.filter((x) => !x.lunch && x.cat !== "obedno" && catById[x.cat]);

export interface CatRef { id: string; n: string; href: string; back: string }
export function catOf(d: Dish): CatRef {
  const c = catById[d.cat] || { id: d.cat, n: "Меню" };
  return { id: c.id, n: c.n, href: url.cat(c.id), back: url.menu(c.id) };
}
export const hasMods = (d: Dish): boolean => !isOut(d) && (compList(d).length > 0 || canAdd(d));
/** What the page script needs (JSON in the page), so the browser does not load the whole menu at start. */
export function dishLite(d: Dish): DishLite {
  return { id: d.id, n: d.n, p: d.p, cat: d.cat, comp: d.comp, g: d.g, ...(d.per100 ? { per100: true } : {}), ...(isOut(d) ? { out: true } : {}) };
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
      '<div class="ask">' + callBtn("pill pill-line") + "</div>";
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
      '<p class="note-auto" style="margin-top:8px">' + ic("info", 18) + "<span>" + esc(endDot(d.per100 ? "На 100 гр." : d.g ? "На порция " + d.g : "На порция")) + " Стойностите идват, когато кухнята ги въведе.</span></p></div></details></div>" +
    "</div></div>";
}

/* ---------- SEO ---------- */
/** at most 160 characters (build check): the composition is cut at a comma ("…"), never in a word, nothing added */
export const DESC_MAX = 160;
export function metaDescription(d: Dish): string {
  /* no "." after a text that already ends with one ("за 100 гр.", "400 гр.") */
  const head = d.n + " от Siracusa, Дружба 2", tail = " " + endDot((d.per100 ? "" : d.g ? d.g + ", " : "") + fmt(d.p) + (d.per100 ? " за 100 гр." : "")) + " Поръчайте с доставка или вземете от място.";
  if (!d.comp) return head + "." + tail;
  const parts = d.comp.replace(/\.\s*$/, "").split(/,\s*/);
  for (let k = parts.length; k > 0; k--) {
    const s = head + ": " + parts.slice(0, k).join(", ") + (k < parts.length ? "…" : ".") + tail;
    if (s.length <= DESC_MAX) return s;
  }
  const s = head + "." + tail;
  return s.length <= DESC_MAX ? s : head + "." + tail.replace(/ Поръчайте .*$/, "");
}

/** <title> without " | Siracusa Bar & Grill" (Base adds it, 23 signs): the whole title stays within about 70 signs.
    "Ястие | Категория" when it fits, else only the dish; a too long name keeps its start and its end ("... пушена сьомга"),
    so two similar dishes do not get the same title. */
const TITLE_MAX = 70 - " | Siracusa Bar & Grill".length;
const SHORT = /^(и|с|със|от|в|във|на|за|по|без)$/i;
export function shortName(n: string, max = TITLE_MAX): string {
  if (n.length <= max) return n;
  const w = n.split(/\s+/);
  let k = 2; while (k < w.length - 1 && SHORT.test(w[w.length - k])) k++;
  const tail = w.slice(-k).join(" ");
  let head = w.slice(0, w.length - k);
  const clean = (a: string[]) => { const b = a.slice(); while (b.length > 1 && SHORT.test(b[b.length - 1])) b.pop(); return b.join(" ").replace(/[,;:]$/, ""); };
  while (head.length > 1 && (clean(head) + " … " + tail).length > max) head.pop();
  return clean(head) + " … " + tail;
}
export function docTitle(d: Dish): string {
  const c = catOf(d), full = d.n + " | " + c.n;
  /* a name only 1-2 signs over stays whole (72 at most): cutting it would hurt more than the 2 signs */
  return full.length <= TITLE_MAX ? full : d.n.length <= TITLE_MAX + 2 ? d.n : shortName(d.n);
}

export function dishLd(d: Dish, site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  const c = catOf(d), price = d.p.toFixed(2);
  const offer: Record<string, unknown> = {
    "@type": "Offer", price, priceCurrency: "EUR",
    availability: isOut(d) ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
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
      { "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) },
      { "@type": "ListItem", position: 2, name: "Меню", item: abs(url.menu()) },
      { "@type": "ListItem", position: 3, name: c.n, item: abs(c.href) },
      { "@type": "ListItem", position: 4, name: d.n, item: abs(url.dish(d)) },
    ],
  };
  return [item, crumbs];
}
