/* Menu page (/menu/): HTML pieces shared by the server (index.astro frontmatter) and the browser (its script).
   Port of design/pages/menu.html; the logic of menus and filters is in design/PAGES.md and src/lib/filters.ts.
   Pure string renderers: no DOM. The icons drawn here are imported below, so SC.ic() knows them in the browser too. */
import { items, cats, catById, inCat, isOut, FILTERS, ALLERGENS, RESTAURANT, type Dish, type Category, type Filter } from "../../lib/data.ts";
import type { State, Eta } from "../../lib/status.ts";
import { dishCard, art } from "../../lib/render.ts";
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural as pl } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import { hourNote, offlineKeep } from "../../lib/ui.ts";
import { NOUN, noun, passes, filterById, searchGroups, sortInCat } from "../../lib/filters.ts";
import { chips as qChips, type Chip } from "../../lib/search.ts";
import { callBtn } from "../../lib/ui.ts";
import { NO_COMP, qchipsHTML, withoutTitle, unknownText } from "./_search-ui.ts";
export { qchipsHTML, NO_COMP };
import "sc-icons:barbell,bowl-food,caret-right,clock,drop,funnel,grains,info,magnifying-glass,moon,moped,phone,plant,sliders-horizontal,storefront,sun,users-three,warning,warning-circle,x"; /* the icons of this page in one module (scripts/icon-groups.mjs) */

export const MAIN_CATS: Category[] = cats.filter((c) => c.id !== "zakuski");
export const MAIN_ITEMS: Dish[] = items.filter((x) => x.cat !== "zakuski");
export const BF_ITEMS: Dish[] = inCat("zakuski");
/** the menu has breakfasts: the „Закуски“ segment and #zakuski exist only then (any published menu, decision 15.11.2026) */
export const HAS_BF = BF_ITEMS.length > 0;
export const HERO_ID = "pitsa-s-burata-i-proshuto-krudo";
/** the plate in the hero: the chosen dish, else a pizza, else the category hero of the first category (a new menu) */
export const heroDish = (): Dish | undefined => {
  const ok = MAIN_ITEMS.filter((x) => !isOut(x));
  return items.find((x) => x.id === HERO_ID) || inCat("pitsi")[0] || ok.find((x) => x.t.indexOf("hit") > -1) || ok[0] || items[0];
};
/** /menu/'s meta description: the current wording while its categories are on the menu, else built from the menu */
export function menuDescription(): string {
  const n = MAIN_ITEMS.length, has = (id: string) => !!catById[id];
  if (["pitsi", "skara-bertha", "salati", "pasta-i-rizoto", "burgeri", "deserti"].every(has) && HAS_BF)
    return "Менюто на Siracusa в Дружба 2: " + n + " ястия и закуски. Пица на пещ, скара на дървени въглища Bertha, салати, паста, бургери и десерти. Доставка до 21:00.";
  const head = "Менюто на Siracusa в Дружба 2: " + n + " " + (n === 1 ? "ястие" : "ястия") + (HAS_BF ? " и закуски" : "") + ".", tail = " Доставка до 21:00.";
  let list = "";
  for (const c of MAIN_CATS) { const next = (list ? list + ", " : " ") + (list ? c.n.toLowerCase() : c.n); if ((head + next + "." + tail).length > 160) break; list = next; }
  return head + (list ? list + "." : "") + tail;
}
/** the line under "Меню": pizza and the grill only while the menu has them */
export function menuLead(): string {
  const pz = !!catById.pitsi, gr = !!catById["skara-bertha"];
  return pz && gr ? "Пица на пещ и скара на дървени въглища." : pz ? "Пица на пещ." : gr ? "Скара на дървени въглища." : "";
}
/** the search placeholder: words from the menu (pizza only while pizzas are on it) */
export function searchHint(): string {
  if (catById.pitsi) return "пица, моцарела, бурата";
  return MAIN_CATS.slice(0, 3).map((c) => c.n.toLowerCase()).join(", ");
}

export { filterById };
export type MenuKind = "main" | "bf";
export interface MenuState { menu: MenuKind; f: string[]; a: string[]; q: string; cat: string | null }
export interface Group { c: Category; items: Dish[]; top: number }
/** A search group (decision 15.11.2026): by name on top, „Съдържат ...“ by composition below, „Нямаме пълен състав“ last. */
export interface SGroup { c: { id: string; n: string }; items: Dish[]; kind: "name" | "comp" | "unknown" }
/** What the navigation needs (categories and search groups alike). */
export type NavGroup = { c: { id: string; n: string }; items: { length: number } };
export interface Results { list: Dish[]; groups: Group[]; search: SGroup[]; unknown: number; chips: Chip[] }

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
    if (i < 0) { if (p === "zakuski" && HAS_BF) st.menu = "bf"; else if (catById[p]) st.cat = p; return; }
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
export const scopeCats = (st: MenuState): Category[] => (st.menu === "bf" ? (catById.zakuski ? [catById.zakuski] : []) : MAIN_CATS);
/** Without a search: the categories as sections. With a search (lib/search.ts): the dishes by name on top, then the band
    „Съдържат ...“ with the dishes by composition (never repeated), and the dishes without a composition apart at the bottom
    (only with „без ...“). Only „без ...“: the dishes that pass it, in their categories (like a filter), then that bottom group.
    The filters and the ticked allergens apply first, together with the search. */
export function results(st: MenuState): Results {
  const qv = st.q.trim(), base = scopeItems(st).filter((x) => passes(x, st));
  const byCat = (list: Dish[]): Group[] => scopeCats(st).map((c) => ({ c, items: sortInCat(list.filter((x) => x.cat === c.id)), top: 0 })).filter((g) => g.items.length);
  if (!qv) return { list: base, groups: byCat(base), search: [], unknown: 0, chips: [] };
  const g = searchGroups(base, qv), chips = qChips(qv), search: SGroup[] = [];
  const only = !g.query.inc.length;
  if (!only) {
    if (g.name.length) search.push({ c: { id: "q-name", n: "По име" }, items: sortInCat(g.name), kind: "name" });
    if (g.comp.length) search.push({ c: { id: "q-comp", n: g.band }, items: sortInCat(g.comp), kind: "comp" });
  }
  if (g.unknown.length) search.push({ c: { id: "q-unknown", n: "Нямаме пълен състав" }, items: sortInCat(g.unknown), kind: "unknown" });
  const list = only ? g.rest : g.name.concat(g.comp);
  return { list, groups: only ? byCat(g.rest) : [], search, unknown: g.unknown.length, chips };
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
export function card(x: Dish, o: { nd?: boolean; later?: string | null; lazy?: boolean; eager?: boolean } = {}): string {
  let h = dishCard(x, "card", o.eager);
  /* lazy: the illustration (placeholder until the photo shoot, heavy SVG) is drawn by the browser near the viewport;
     a photo is an <img loading="lazy"> already */
  if (o.lazy && !x.photo) h = h.replace(art(x), "").replace('class="pic ', 'data-art="' + x.id + '" class="pic ');
  if (x.comp) h = h.replace('</a><div class="rowp">', '<span class="cp">' + esc(cap(x.comp)) + '</span></a><div class="rowp">');
  if (o.nd && !x.comp) h = h.replace('</a><div class="rowp">', '<span class="nodata">' + ic("info", 18) + NO_COMP + '</span></a><div class="rowp">');
  if (o.later) h = h.replace('class="pic ', 'class="pic out ').replace(/<button class="plus"[\s\S]*?<\/button>/, '<span class="later">' + o.later + "</span>");
  return h;
}

/** Sections after the first LAZY_AFTER ones get lazy illustrations (keeps the HTML light; names, prices and links stay). */
export const LAZY_AFTER = 2;
export function sectionHTML(g: Group, o: { q?: string; menu: MenuKind; nd?: boolean; later?: string | null; hidden?: boolean; lazy?: boolean; eager?: boolean }): string {
  const c = g.c, nn = NOUN[c.id];
  return '<section class="mcat" id="c-' + c.id + '" data-cat="' + c.id + '" aria-labelledby="h-' + c.id + '"' + (o.hidden ? " hidden" : "") + ">" +
    '<div class="sec-h"><h2 class="h2" id="h-' + c.id + '">' + esc(c.n) + "</h2>" +
    (o.menu === "main" ? '<a class="link" href="' + url.cat(c.id) + '"' + (nn ? "" : ' aria-label="Към категорията ' + esc(c.n) + '"') + ">" + (nn ? "Всички " + nn[1] : "Към категорията") + ic("caret-right", 18) + "</a>" : "") + "</div>" +
    '<p class="cdesc">' + catDesc(c, g.items.length) + "</p>" +
    (o.q ? "" : '<p class="cseo missing">[ЛИПСВА: SEO текст за „' + esc(c.n) + "“, 2 - 3 изречения]</p>") +
    '<div class="grid-dishes">' + g.items.map((x, i) => card(x, { nd: o.nd, later: o.later, lazy: o.lazy, eager: o.eager && i === 0 })).join("") + "</div></section>";
}

/** One search group. The heading is the group's title (not only a colour): by name (for screen readers only, the count line
    above says it), the band „Съдържат лук“ with its count, „Нямаме пълен състав, попитайте ни“ with a sentence and the call. */
export function searchSectionHTML(g: SGroup, o: { q: string; chips: Chip[]; later?: string | null; nd?: boolean; lazy?: boolean }): string {
  const id = g.c.id, n = g.items.length;
  let head: string;
  if (g.kind === "name") head = '<h2 class="vh" id="h-' + id + '">По име: „' + esc(o.q) + "“, " + plural(n) + "</h2>";
  else if (g.kind === "comp") head = '<h2 class="sband" id="h-' + id + '">' + ic("bowl-food", 20) + "<span>" + esc(g.c.n) + '</span><span class="n">' + plural(n) + "</span></h2>";
  else head = '<div class="qunk-h"><h2 class="sband unk" id="h-' + id + '">' + ic("warning-circle", 20) + "<span>" + NO_COMP + '</span><span class="n">' + plural(n) + "</span></h2>" +
    '<p class="qunk-t">' + unknownText(o.chips) + "</p>" + callBtn("pill pill-line") + "</div>";
  /* the dishes without a composition: the heading already says it, no note on every card */
  return '<section class="mcat qgrp q-' + g.kind + '" id="c-' + id + '" data-cat="' + id + '" aria-labelledby="h-' + id + '">' + head +
    '<div class="grid-dishes">' + g.items.map((x) => card(x, { nd: g.kind === "unknown" ? false : o.nd, later: o.later, lazy: o.lazy })).join("") + "</div></section>";
}
export { withoutTitle };

/** Sub-line under each menu in the segment (depends on the hour). */
/** lunchToday: the lunch menu in the data is for today (or preview/demo); otherwise no "-30%" promise, like the home page. */
export function segSub(kind: "main" | "lunch" | "bf", S: State, lunchToday = true): string {
  if (kind === "main") return plural(MAIN_ITEMS.length);
  if (kind === "lunch") {
    if (S.lunch) return "до 15:00";
    if (S.lunchDiscount && lunchToday) return '<span class="tg"><i>-30%</i>вземане</span>';
    return S.m < 600 ? "от 10:00" : "утре от 10:00";
  }
  if (S.breakfast) return "до 11:30";
  return S.m < 600 ? "от 10:00" : "утре от 10:00";
}

/** The delivery / pickup line under the lead (empty when the kitchen is closed). */
export function etaLine(S: State, e: Eta): string {
  if (S.delivery) return '<p class="eta' + (e.busy ? " warn" : "") + '" data-eta>' + ic("moped", 20) + "<b>" + "Доставка сега · " + (e.busy ? e.text.charAt(0).toLowerCase() + e.text.slice(1) : e.text).replace(/около (\d+) мин/, "около&nbsp;$1&nbsp;мин") + "</b></p>";
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

/** The count line (aria-live): with a search, also how many dishes are apart because we have no composition for them. */
export function countHTML(st: MenuState, n: number, unknown = 0): string {
  const total = scopeItems(st).length, q = st.q.trim();
  const unk = unknown ? " · " + plural(unknown) + " без пълен състав най-долу" : "";
  if (q && n) return "Намерихме " + plural(n) + " <span>за „" + esc(q) + "“" + unk + "</span>";
  if (q) { const tail = (st.f.length || st.a.length ? " с тези филтри" : "") + unk; return "Нищо " + (unknown ? "сигурно " : "") + "за „" + esc(q) + "“" + (tail ? " <span>" + tail.trim() + "</span>" : ""); }
  if (st.f.length || st.a.length) return "Показваме " + n + " <span>от " + plural(total) + "</span>";
  return plural(total) + " <span>· " + (st.menu === "bf" ? "закуски" : MAIN_CATS.length + " категории") + "</span>";
}

export function noticesHTML(S: State, st: MenuState, offline = false): string {
  let h = "";
  if (offline) h += offlineKeep({ retry: true }); /* the one note (lib/ui.ts) */
  /* the one hour note (lib/ui.ts): closed / before 10:00; after 21:00 the eta line says "Вземане" */
  if (!S.kitchen) h += hourNote(S);
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

export function catChipsHTML(groups: NavGroup[]): string {
  return '<span class="ind" aria-hidden="true"><i class="l"></i><i class="m"></i><i class="r"></i></span>' +
    groups.map((g) => '<a class="chip" href="#' + g.c.id + '" data-go="' + g.c.id + '">' + esc(g.c.n) + ' <span class="n">' + g.items.length + "</span></a>").join("");
}
export function sideHTML(groups: NavGroup[]): string {
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
    provider: { "@type": "Restaurant", "@id": abs(url.home()) + "#restaurant", name: RESTAURANT.name },
    hasMenuSection: cats.map((c) => ({ "@type": "MenuSection", name: c.n, url: abs(url.cat(c.id)), hasMenuItem: inCat(c.id).map(item) })),
  };
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name: "Меню", item: abs(url.menu()) }],
  };
  return [menu, crumbs];
}
