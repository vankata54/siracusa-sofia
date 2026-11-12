/* Gallery (/galeria/): server-side HTML for design/pages/gallery.html, plus the JSON-LD.
   The dishes are real (illustrations stand in for the new photo shoot, drawn lazily by the browser so the HTML stays light);
   the hall, the garden and the events are the shot list for the new photo shoot: subjects only, [ЛИПСВА: снимка]. */
import { url } from "../../lib/routes.ts";
import { RESTAURANT } from "../../lib/consts.ts";
import { byId, catById, isOut, type Dish } from "../../lib/data.ts";
import { pic, art } from "../../lib/render.ts";
import { ic } from "../../lib/icons.ts";
import { esc, fmt } from "../../lib/format.ts";

export type CatId = "all" | "yastia" | "salon" | "gradina" | "sabitia";
export const CATS: { id: CatId; n: string; icon: string }[] = [
  { id: "all", n: "Всички", icon: "squares-four" },
  { id: "yastia", n: "Ястия", icon: "bowl-food" },
  { id: "salon", n: "Салон", icon: "chair" },
  { id: "gradina", n: "Градина", icon: "tree" },
  { id: "sabitia", n: "Събития", icon: "confetti" },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c])) as Record<CatId, (typeof CATS)[number]>;

type Go = { href: string; label: string; icon: string };
type DishIt = { k: "dish"; cat: "yastia"; x: Dish; ar: number; title: string; sub: string };
type SlotIt = { k: "slot"; cat: CatId; title: string; ic: string; ar: number; go: Go };
export type Item = DishIt | SlotIt;

/* real dishes; aspect ratios give the masonry its rhythm (sold-out dishes stay out of the gallery, as in the prototype) */
const DISHES: DishIt[] = ([
  ["pitsa-s-burata-i-proshuto-krudo", 0.8], ["svinski-rebra", 1], ["kapreze-s-burata-i-avokado", 1], ["pitsa-s-proshuto-koto-i-tryufel", 1],
  ["ribay-stek-ot-blek-angas", 0.8], ["pitsa-dyavolo", 1], ["kebapcheta", 1.25], ["spageti-karbonara", 1],
  ["plato-frenski-sirena", 1.25], ["pitsa-margarita", 0.8], ["chiyzburger-s-teleshko-kyufte-blek-angas-s-parzh", 1], ["tiramisu", 1],
] as [string, number][]).filter(([id]) => byId[id] && !isOut(byId[id])).map(([id, ar]) => {
  const x = byId[id];
  return { k: "dish", cat: "yastia", x, ar, title: x.n, sub: (catById[x.cat] || { n: "" }).n };
});

/* empty slots: the shot list for the new photo shoot. Subjects only, no invented facts. */
const RES: Go = { href: url.reservation(), label: "Резервирай маса", icon: "calendar-blank" };
const PARTY: Go = { href: url.page("celebration"), label: "Планирай празник", icon: "arrow-right" };
const SLOTS: SlotIt[] = ([
  ["salon", "Салонът, общ план", "chair", 1.25, RES],
  ["gradina", "Градината през деня", "sun", 0.8, RES],
  ["sabitia", "Гръцка вечер", "calendar-dots", 1, { href: url.event("gratska-vecher"), label: "Виж Гръцка вечер", icon: "arrow-right" }],
  ["salon", "Маса до прозореца", "fork-knife", 0.8, RES],
  ["gradina", "Градината вечер", "moon", 1.25, RES],
  ["sabitia", "Рожден ден при нас", "cake", 0.8, PARTY],
  ["salon", "Барът", "wine", 1, RES],
  ["gradina", "Отопляваната градина зимата", "thermometer", 1, RES],
  ["sabitia", "Жива музика", "music-notes", 1.25, { href: url.events(), label: "Виж събитията", icon: "arrow-right" }],
  ["salon", "Подредена маса за празник", "confetti", 1, PARTY],
  ["gradina", "Маса в градината", "tree", 0.8, RES],
  ["sabitia", "Фирмено парти", "briefcase", 1, PARTY],
] as [CatId, string, string, number, Go][]).map(([cat, title, icon, ar, go]) => ({ k: "slot", cat, title, ic: icon, ar, go }));

/* "Всички": dishes and places interleaved, so the page reads as a mix and not as a menu */
export const ALL: Item[] = (() => {
  const d: Item[] = DISHES.slice(), s: Item[] = SLOTS.slice(), out: Item[] = [];
  for (let i = 0; d.length || s.length; i++) out.push((i % 2 === 0 && d.length) || !s.length ? d.shift()! : s.shift()!);
  return out;
})();
export const listFor = (cat: CatId) => (cat === "all" ? ALL : ALL.filter((it) => it.cat === cat));
export const counts = Object.fromEntries(CATS.map((c) => [c.id, listFor(c.id).length])) as Record<CatId, number>;
export const nDishes = ALL.filter((it) => it.k === "dish").length;

/** "Всички: 24 кадъра, 12 ястия и 12 места за снимки" (the browser has the same function in index.astro) */
export function countText(cat: CatId): string {
  const L = listFor(cat), nd = L.filter((it) => it.k === "dish").length;
  return CAT[cat].n + ": " + L.length + " " + (L.length === 1 ? "кадър" : "кадъра") + (cat === "all" ? ", " + nd + " ястия и " + (L.length - nd) + " места за снимки" : "");
}

/* the dish picture without its SVG: the browser draws it near the viewport (data-art) */
const lazyPic = (x: Dish) => pic(x).replace(art(x), "").replace('class="pic ', 'data-art="' + x.id + '" class="pic ');

function slotHTML(it: SlotIt): string {
  return '<span class="slot"><span class="tag">' + ic(CAT[it.cat].icon, 16) + CAT[it.cat].n + '</span><span class="ring">' + ic(it.ic, 28) + "</span></span>";
}

export function chipsHTML(): string {
  return CATS.filter((c) => counts[c.id]).map((c) =>
    '<button class="chip" type="button" data-cat="' + c.id + '" aria-pressed="' + (c.id === "all") + '">' + ic(c.icon, 18) + c.n + ' <span class="n">' + counts[c.id] + "</span></button>").join("");
}

export function tilesHTML(): string {
  return ALL.map((it, i) => {
    const media = it.k === "dish" ? lazyPic(it.x) : slotHTML(it);
    const cap = it.k === "dish"
      ? "<b>" + esc(it.title) + "</b><small>" + esc(it.sub) + ' · <span class="price">' + fmt(it.x.p) + "</span></small>"
      : "<b>" + esc(it.title) + '</b><small class="missing">[ЛИПСВА: снимка]</small>';
    const label = (it.k === "dish" ? it.title : it.title + ", място за снимка") + ". Отвори на цял екран";
    /* what the viewer shows for this photo (the browser builds the caption from these, no second copy of the HTML) */
    const data = it.k === "dish"
      ? ' data-id="' + it.x.id + '" data-s="' + esc(it.sub) + '" data-g="' + esc(it.x.per100 ? "за 100 гр." : it.x.g) + '" data-p="' + it.x.p + '" data-href="' + url.dish(it.x) + '"'
      : ' data-href="' + it.go.href + '" data-go="' + esc(it.go.label) + '" data-goi="' + it.go.icon + '"';
    return '<button class="gi" type="button" data-i="' + i + '" data-c="' + it.cat + '" data-t="' + esc(it.title) + '"' + data + ' aria-label="' + esc(label) + '"><span class="tile" style="--ar:' + it.ar + '">' + media + '</span><span class="gcap" aria-hidden="true">' + cap + "</span></button>";
  }).join("");
}

/* the viewer's frame (cloned by the browser) with the few icons its captions need, so the client bundle stays small */
export function lbFrameHTML(): string {
  return '<div class="lb-bg"></div>' +
    '<div class="lb-top"><span class="lb-where" data-where></span><button class="lb-btn" type="button" data-lbclose>' + ic("x", 20) + "Затвори</button></div>" +
    '<div class="lb-stage" data-stage><div class="lb-track" data-track></div></div>' +
    '<div class="lb-bot"><div class="lb-info" data-info></div>' +
      '<div class="lb-nav"><button class="lb-btn" type="button" data-prev>' + ic("arrow-left", 20) + 'Предишна</button><button class="lb-btn" type="button" data-next>Следваща' + ic("arrow-right", 20) + "</button></div>" +
      '<span class="lb-hint">Плъзнете наляво или надясно</span>' +
      '<p class="vh" aria-live="polite" data-live></p></div>' +
    '<span hidden data-stock>' + ["plus", "calendar-blank", "arrow-right"].map((n) => '<i data-k="' + n + '">' + ic(n, 20) + "</i>").join("") + "</span>";
}

/** What the browser needs to draw the dish illustrations (art.ts reads only these fields). */
export function dishesJSON(): string {
  const o: Record<string, Pick<Dish, "id" | "n" | "comp" | "cat" | "group">> = {};
  for (const it of ALL) if (it.k === "dish") o[it.x.id] = { id: it.x.id, n: it.x.n, comp: it.x.comp, cat: it.x.cat, group: it.x.group };
  return JSON.stringify(o).replace(/</g, "\\u003c");
}

export const hours = { open: RESTAURANT.open, close: RESTAURANT.close };

export function galleryLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site).href;
  return [{
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name: "Галерия", item: abs(url.page("gallery")) }],
  }];
}
