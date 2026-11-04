/* Menu page (/menu/): HTML pieces shared by the server (index.astro frontmatter) and the browser (its script).
   Port of design/pages/menu.html; the logic of menus and filters is in design/PAGES.md and src/lib/filters.ts.
   Pure string renderers: no DOM. The icons drawn here are imported below, so SC.ic() knows them in the browser too. */
import { items, cats, catById, inCat, isOut, FILTERS, ALLERGENS, RESTAURANT, type Dish, type Category, type Filter } from "../../lib/data.ts";
import type { State, Eta } from "../../lib/status.ts";
import { dishCard } from "../../lib/render.ts";
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural as pl } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import { NOUN, noun, passes, filterById, searchScores, sortInCat } from "../../lib/filters.ts";
import "../../lib/icons/funnel.ts";
import "../../lib/icons/sliders-horizontal.ts";
import "../../lib/icons/plant.ts";
import "../../lib/icons/users-three.ts";
import "../../lib/icons/grains.ts";
import "../../lib/icons/drop.ts";
import "../../lib/icons/barbell.ts";
import "../../lib/icons/info.ts";
import "../../lib/icons/moped.ts";
import "../../lib/icons/storefront.ts";
import "../../lib/icons/caret-right.ts";
import "../../lib/icons/warning-circle.ts";
import "../../lib/icons/warning.ts";
import "../../lib/icons/sun.ts";
import "../../lib/icons/moon.ts";
import "../../lib/icons/magnifying-glass.ts";
import "../../lib/icons/x.ts";
import "../../lib/icons/phone.ts";

export const MAIN_CATS: Category[] = cats.filter((c) => c.id !== "zakuski");
export const MAIN_ITEMS: Dish[] = items.filter((x) => x.cat !== "zakuski");
export const BF_ITEMS: Dish[] = inCat("zakuski");
export const HERO_ID = "pitsa-s-burata-i-proshuto-krudo";

export type MenuKind = "main" | "bf";
export interface MenuState { menu: MenuKind; f: string[]; a: string[]; q: string; cat: string | null }
export interface Group { c: Category; items: Dish[]; top: number }

/* chip colours and the "Без лук" icon ("x" on a pressed chip reads as "remove") */
export const FICON: Record<string, string> = { veg: "leaf", hot: "pep" };
const FIC: Record<string, string> = { noonion: "plant" };
export const fic = (f: Filter): string => FIC[f.id] || f.icon;
export const plural = (n: number): string => pl(n, "ястие", "ястия");
export const cap = (s: string): string => { s = String(s || "").trim().replace(/,(?=\S)/g, ", "); return s.charAt(0).toUpperCase() + s.slice(1); };
const ALLERGEN_IDS = ALLERGENS.map((a) => a[0] as string);

/* ---------- address: #pitsi&f=veg.hot&a=gluten.milk&q=пица (same format as /menu/<кат>/) ---------- */
export function parseHash(hash: string): MenuState {
  const st: MenuState = { menu: "main", f: [], a: [], q: "", cat: null };
  let h = hash.replace(/^#/, "");
  try { h = decodeURIComponent(h); } catch { /* keep raw */ }
  h.split("&").forEach((p) => {
    if (!p) return;
    const i = p.indexOf("=");
    if (i < 0) { if (p === "zakuski") st.menu = "bf"; else if (catById[p]) st.cat = p; return; }
    const k = p.slice(0, i), v = p.slice(i + 1);
    if (k === "f") st.f = v.split(".").filter((id) => { const f = filterById(id); return !!f && !f.needs; });
    if (k === "a") st.a = v.split(".").filter((id) => ALLERGEN_IDS.indexOf(id) > -1);
    if (k === "q") st.q = v;
  });
  return st;
}
export function hashOf(st: MenuState): string {
  const p: string[] = [];
  if (st.menu === "bf") p.push("zakuski"); else if (st.cat) p.push(st.cat);
  if (st.f.length) p.push("f=" + st.f.join("."));
  if (st.a.length) p.push("a=" + st.a.join("."));
  if (st.q) p.push("q=" + encodeURIComponent(st.q));
  return p.length ? "#" + p.join("&") : "";
}

/* ---------- results ---------- */
export const scopeItems = (st: MenuState): Dish[] => (st.menu === "bf" ? BF_ITEMS : MAIN_ITEMS);
export const scopeCats = (st: MenuState): Category[] => (st.menu === "bf" ? [catById.zakuski] : MAIN_CATS);
export function results(st: MenuState): { list: Dish[]; groups: Group[] } {
  const qv = st.q.trim();
  let list = scopeItems(st).filter((x) => passes(x, st));
  let sc: Record<string, number> | undefined;
  if (qv) { sc = searchScores(list, qv); list = list.filter((x) => sc![x.id]); }
  const groups = scopeCats(st).map((c) => {
    const it = sortInCat(list.filter((x) => x.cat === c.id), sc);
    return { c, items: it, top: sc ? Math.max(0, ...it.map((x) => sc![x.id])) : 0 };
  }).filter((g) => g.items.length);
  if (qv) groups.sort((a, b) => b.top - a.top);
  return { list, groups };
}

/* ---------- small pieces ---------- */
export function catDesc(c: Category, shown: number): string {
  const it = inCat(c.id), parts = [(shown < it.length ? shown + " от " : "") + noun(c.id, it.length)];
  const g = it.map((x) => { const m = /(\d+)\s*(гр|мл)/.exec(x.g); return m ? [+m[1], m[2]] as [number, string] : null; }).filter(Boolean) as [number, string][];
  if (g.length) {
    const lo = Math.min(...g.map((z) => z[0])), hi = Math.max(...g.map((z) => z[0]));
    parts.push((lo === hi ? lo : lo + " - " + hi) + " " + g[0][1] + ".");
  }
  const ps = it.map((x) => x.p), plo = Math.min(...ps), phi = Math.max(...ps);
  parts.push(plo === phi ? fmt(plo) : "от " + fmt(plo) + " до " + fmt(phi));
  const v = it.filter((x) => x.t.indexOf("veg") > -1).length;
  if (v && v < it.length) parts.push(v + " вегетариански");
  return parts.join(" · ");
}

/** One dish card: the shared dishCard + the composition line; "no allergen data" and "later" variants. */
export function card(x: Dish, o: { nd?: boolean; later?: string | null } = {}): string {
  let h = dishCard(x);
  if (x.comp) h = h.replace('</a><div class="rowp">', '<span class="cp">' + esc(cap(x.comp)) + '</span></a><div class="rowp">');
  if (o.nd && !x.comp) h = h.replace('</a><div class="rowp">', '<span class="nodata">' + ic("info", 18) + 'Няма данни за алергени, попитайте ни</span></a><div class="rowp">');
  if (o.later) h = h.replace('class="pic ', 'class="pic out ').replace(/<button class="plus"[\s\S]*?<\/button>/, '<span class="later">' + o.later + "</span>");
  return h;
}

export function sectionHTML(g: Group, o: { q?: string; menu: MenuKind; nd?: boolean; later?: string | null; hidden?: boolean }): string {
  const c = g.c, nn = NOUN[c.id];
  return '<section class="mcat" id="c-' + c.id + '" data-cat="' + c.id + '" aria-labelledby="h-' + c.id + '"' + (o.hidden ? " hidden" : "") + ">" +
    '<div class="sec-h"><h2 class="h2" id="h-' + c.id + '">' + esc(c.n) + "</h2>" +
    (o.menu === "main" ? '<a class="link" href="' + url.cat(c.id) + '"' + (nn ? "" : ' aria-label="Към категорията ' + esc(c.n) + '"') + ">" + (nn ? "Всички " + nn[1] : "Към категорията") + ic("caret-right", 18) + "</a>" : "") + "</div>" +
    '<p class="cdesc">' + catDesc(c, g.items.length) + "</p>" +
    (o.q ? "" : '<p class="cseo missing">[ЛИПСВА: SEO текст за „' + esc(c.n) + "“, 2 - 3 изречения]</p>") +
    '<div class="grid-dishes">' + g.items.map((x) => card(x, { nd: o.nd, later: o.later })).join("") + "</div></section>";
}

/** Sub-line under each menu in the segment (depends on the hour). */
export function segSub(kind: "main" | "lunch" | "bf", S: State): string {
  if (kind === "main") return plural(MAIN_ITEMS.length);
  if (kind === "lunch") {
    if (S.lunch) return "до 15:00";
    if (S.lunchDiscount) return '<span class="tg"><i>-30%</i>вземане</span>';
    return S.m < 600 ? "от 10:00" : "утре от 10:00";
  }
  if (S.breakfast) return "до 11:30";
  return S.m < 600 ? "от 10:00" : "утре от 10:00";
}

/** The delivery / pickup line under the lead (empty when the kitchen is closed). */
export function etaLine(S: State, e: Eta): string {
  if (S.delivery) return '<p class="eta' + (e.busy ? " warn" : "") + '" data-eta>' + ic("moped", 20) + "<b>" + (e.busy ? "Доставка: " + e.text.charAt(0).toLowerCase() + e.text.slice(1) : "Доставка сега: " + e.text).replace(/около (\d+) мин/, "около&nbsp;$1&nbsp;мин") + "</b></p>";
  if (S.kitchen) return '<p class="eta warn" data-eta>' + ic("storefront", 20) + "<b>Вземане от място <span>· готово след около&nbsp;20&nbsp;мин</span></b></p>";
  return '<p class="eta" data-eta hidden></p>';
}

export function filterChipsHTML(st: MenuState): string {
  const list = scopeItems(st), aOn = st.a.length;
  let h = '<button class="chip" type="button" data-sheet="al" aria-pressed="' + (aOn ? "true" : "false") + '" aria-haspopup="dialog">' + ic("funnel", 20) + "Алергени" + (aOn ? ' <span class="dot" aria-label="избрани ' + aOn + '">' + aOn + "</span>" : "") + "</button>";
  for (const f of FILTERS) {
    if (f.needs) continue;
    const n = list.filter(f.test).length;
    if (!n) continue;
    h += '<button class="chip ' + (FICON[f.id] || "") + '" type="button" data-f="' + f.id + '" aria-pressed="' + (st.f.indexOf(f.id) > -1) + '">' + ic(fic(f), 20) + f.n + ' <span class="n">' + n + "</span></button>";
  }
  return h + '<button class="chip more" type="button" data-sheet="more" aria-haspopup="dialog">' + ic("sliders-horizontal", 20) + "Още филтри</button>";
}

export function countHTML(st: MenuState, n: number): string {
  const total = scopeItems(st).length, q = st.q.trim();
  if (q) return n ? "Намерихме " + plural(n) + " <span>за „" + esc(q) + "“</span>" : "Нищо за „" + esc(q) + "“" + (st.f.length || st.a.length ? " <span>с тези филтри</span>" : "");
  if (st.f.length || st.a.length) return "Показваме " + n + " <span>от " + plural(total) + "</span>";
  return plural(total) + " <span>· " + (st.menu === "bf" ? "закуски" : MAIN_CATS.length + " категории") + "</span>";
}

export function noticesHTML(S: State, st: MenuState, offline = false): string {
  let h = "";
  if (offline) h += '<div class="notice off" role="status"><span class="nic">' + ic("warning-circle", 24) + "</span><b>Няма връзка с интернет</b><p>Менюто е заредено, а количката ви е запазена. Поръчайте, когато връзката се върне.</p><div class=\"acts\"><button class=\"pill pill-line\" type=\"button\" data-retry>Опитай пак</button></div></div>";
  if (S.m < 600) h += '<div class="notice"><span class="nic">' + ic("clock", 24) + "</span><b>Кухнята отваря в 10:00</b><p>Можете да поръчате още сега за днес.</p></div>";
  else if (!S.kitchen) h += '<div class="notice warn"><span class="nic">' + ic("clock", 24) + "</span><b>Кухнята приема поръчки до 22:30. Поръчай за утре?</b><p>Изберете ястията сега, а в количката посочете час утре след 10:00.</p></div>";
  if (st.menu === "bf") {
    if (S.breakfast) {
      const left = 690 - S.m;
      h += '<div class="notice"><span class="nic">' + ic("sun", 24) + "</span><b>Закуски всеки ден до 11:30</b><p>Остават " + (left >= 60 ? "1 ч." + (left > 60 ? " и " + (left - 60) + " мин" : "") : left + " мин") + " за днес.</p></div>";
    } else if (S.m < 600) h += '<div class="notice"><span class="nic">' + ic("sun", 24) + "</span><b>Закуските са от 10:00 до 11:30</b><p>Разгледайте ги сега и поръчайте, щом отворим.</p></div>";
    else h += '<div class="notice"><span class="nic">' + ic("moon", 24) + '</span><b>Закуските свършиха за днес</b><p>Очакваме ви утре от 10:00 до 11:30. Междувременно цялото меню е тук.</p><div class="acts"><button class="pill pill-line" type="button" data-menu="main">Към основното меню</button></div></div>';
  }
  return h;
}

/** Breakfast cards outside 10:00 - 11:30: no "+", the hour instead. */
export const laterText = (S: State, st: MenuState): string | null => (st.menu === "bf" && !S.breakfast ? (S.m < 600 ? "от 10:00" : "утре<br>от 10:00") : null);

export function catChipsHTML(groups: Group[]): string {
  return '<span class="ind" aria-hidden="true"><i class="l"></i><i class="m"></i><i class="r"></i></span>' +
    groups.map((g) => '<a class="chip" href="#' + g.c.id + '" data-go="' + g.c.id + '">' + esc(g.c.n) + ' <span class="n">' + g.items.length + "</span></a>").join("");
}
export function sideHTML(groups: Group[]): string {
  return '<span class="smark" aria-hidden="true"></span>' +
    groups.map((g) => '<a href="#' + g.c.id + '" data-go="' + g.c.id + '"><span>' + esc(g.c.n) + '</span><span class="n">' + g.items.length + "</span></a>").join("");
}

/* ---------- JSON-LD: Menu > MenuSection > MenuItem (all 127, prices in EUR, description = composition) ---------- */
export function menuLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  const item = (x: Dish) => {
    const offer: Record<string, unknown> = {
      "@type": "Offer", price: x.p.toFixed(2), priceCurrency: "EUR",
      availability: isOut(x) ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
    };
    if (x.per100) offer.priceSpecification = { "@type": "UnitPriceSpecification", price: x.p.toFixed(2), priceCurrency: "EUR", referenceQuantity: { "@type": "QuantitativeValue", value: 100, unitCode: "GRM" } };
    const it: Record<string, unknown> = { "@type": "MenuItem", name: x.n, url: abs(url.dish(x)), offers: offer };
    if (x.comp) it.description = cap(x.comp);
    if (x.t.indexOf("veg") > -1) it.suitableForDiet = "https://schema.org/VegetarianDiet";
    return it;
  };
  const menu = {
    "@context": "https://schema.org", "@type": "Menu", "@id": abs(url.menu()) + "#menu",
    name: "Меню на " + RESTAURANT.name, url: abs(url.menu()), inLanguage: "bg",
    hasMenuSection: cats.map((c) => ({ "@type": "MenuSection", name: c.n, url: abs(url.cat(c.id)), hasMenuItem: inCat(c.id).map(item) })),
  };
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name: "Меню", item: abs(url.menu()) }],
  };
  return [menu, crumbs];
}
