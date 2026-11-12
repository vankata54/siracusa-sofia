/* Lunch menu (/obedno-menu/): the parts drawn ONLY on the server (index.astro frontmatter), from the menu data:
   the groups with every dish (pic, name, price, "+" with data-p), the week, office, FAQ and the JSON-LD.
   The browser never imports this module (it would pull the whole menu, lib/data.ts); it updates the rows in place
   from their data-id / data-p (see the script in index.astro and metaHTML / plusHTML in _lunch.ts). */
import { lunch, isOut, menu, RESTAURANT, type Dish } from "../../lib/data.ts";
import { pic } from "../../lib/render.ts";
import { ic } from "../../lib/icons.ts";
import { esc, plural } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import { faqHead } from "../../lib/ui.ts";
import { canOrderIn, metaHTML, plusHTML, SLOT, weekHTML, dateText, FREE_TXT, PAID_TXT, DISC_PCT, type View, type Meta } from "./_lunch.ts";

const R = RESTAURANT;
export const minP = (): number => Math.min(...lunch.map((x) => x.p));
export const meta = (): Meta => ({ date: menu.lunch.date, dayName: (menu.lunch as { dayName?: string }).dayName, count: lunch.length, minP: minP() });

const GROUP_ICON: Record<string, string> = { "Супи": "bowl-food", "Салати": "leaf", "Скара на дървени въглища": "fire", "Основни": "cooking-pot", "Десерти": "cake" };
const GROUP_ID: Record<string, string> = { "Супи": "supi", "Салати": "salati", "Скара на дървени въглища": "skara", "Основни": "osnovni", "Десерти": "deserti" };
const gid = (n: string): string => GROUP_ID[n] || n.toLowerCase().replace(/[^a-zа-я0-9]+/gi, "-");

export interface Group { n: string; items: Dish[] }
/** Groups in data order; sold out stay visible, always last in their group (decision 2). */
export function groups(): Group[] {
  const gs: Group[] = [];
  for (const x of lunch) {
    let g = gs.find((z) => z.n === x.group);
    if (!g) { g = { n: x.group || "Обедно меню", items: [] }; gs.push(g); }
    g.items.push(x);
  }
  gs.forEach((g) => g.items.sort((a, b) => Number(isOut(a)) - Number(isOut(b))));
  return gs;
}

/* ---------- list ---------- */
function row(x: Dish, v: View): string {
  const out = isOut(x), can = (v.phase === null || canOrderIn(v.phase)) && v.orderable;
  return '<li class="lrow' + (out ? " out" : "") + (!can ? " locked" : "") + '" data-id="' + esc(x.id) + '" data-p="' + x.p + '">' + pic(x) + '<span class="lt"><span class="nm">' + esc(x.n) + '</span><span class="meta">' +
    metaHTML(x.p, v.phase === "discount", out) + "</span></span>" + (out || !can ? SLOT : plusHTML(x.id, x.p, x.n)) + "</li>";
}
function groupHTML(g: Group, i: number, v: View): string {
  return '<section class="grp rv" id="g-' + gid(g.n) + '" aria-labelledby="gh' + i + '"><div class="grp-h"><span class="gi">' + ic(GROUP_ICON[g.n] || "fork-knife", 22) + '</span><h2 class="h3" id="gh' + i + '">' + esc(g.n) + "</h2>" +
    '<span class="n">' + plural(g.items.length, "ястие", "ястия") + '</span></div><div class="shell"><div class="core"><ul class="lrows">' + g.items.map((x) => row(x, v)).join("") + "</ul></div></div></section>";
}
function jumpChips(gs: Group[]): string {
  return '<div class="chips jump" role="navigation" aria-label="Групи в обедното меню">' + gs.map((g) =>
    '<button class="chip" type="button" data-jump="g-' + gid(g.n) + '">' + ic(GROUP_ICON[g.n] || "fork-knife", 18) + esc(g.n === "Скара на дървени въглища" ? "Скара" : g.n) + ' <span class="n">' + g.items.length + "</span></button>").join("") + "</div>";
}
function allergenNote(): string {
  return '<div class="lnote">' + ic("info", 22) + '<span><b>Алергени и грамаж</b>Съставът на обедните ястия още не е въведен. Ако имате алергия, попитайте ни на <a class="tel" href="tel:' + R.phoneIntl + '">' + R.phone + '</a> преди да поръчате. <span class="missing">[ЛИПСВА: грамаж, състав и алергени от кухнята]</span></span></div>';
}
/** [data-lnotes] gets the hour notes (closed, offline) in the browser. */
export function listHTML(v: View): string {
  const gs = groups();
  return "<div data-lnotes></div>" + jumpChips(gs) + '<div class="grps">' + gs.map((g, i) => groupHTML(g, i, v)).join("") + "</div>" + allergenNote();
}

/* ---------- office + FAQ ---------- */
export const FAQ: [string, string, string?][] = [
  ["До колко часа доставяте обедното меню?", "До 15:00. След 15:00 обедното меню е само за вземане от място, с -" + DISC_PCT + "% от цената."],
  ["Колко бързо е готово, ако го взема от ресторанта?", "Обедните ястия са готови веднага след поръчката. Ако добавите и от основното меню, поръчката е готова най-рано след 20 минути."],
  ["Къде доставяте безплатно?", "В " + FREE_TXT + ". До " + PAID_TXT + " доставяме по тарифа.", ' <span class="missing">[ЛИПСВА: такса в €]</span>'],
  ["Менюто различно ли е всеки ден?", "Да. Менюто се сменя всеки ден и едно и също меню не се повтаря два поредни дни."],
  ["Как ще разбера какви алергени има?", "Съставът на обедните ястия още не е въведен на сайта. Обадете ни се на " + R.phone + " и ще ви кажем преди да поръчате."],
];
export function bottomHTML(v: View): string {
  return '<section class="sec" aria-labelledby="wk"><div class="sec-h"><h2 class="h2" id="wk">Цялата седмица</h2></div><p class="muted" style="margin:-4px 0 16px">Само за преглед. Всеки ден поръчвате от менюто за деня.</p><div data-week>' + weekHTML(v) + "</div></section>" +
    '<section class="sec"><div class="duo">' +
    '<div class="shell office"><div class="core"><span class="ill">' + ic("briefcase", 28) + '</span><h2 class="h3">Обща поръчка за офиса</h2><p class="muted">Без събиране на поръчки по телефона.</p>' +
    "<ol><li><span>Един колега отваря поръчка и праща връзка в чата.</span></li><li><span>Всеки добавя своето от обедното меню до 11:30.</span></li><li><span>Всичко пристига заедно, с обща сметка или поотделно.</span></li></ol>" +
    '<a class="pill pill-line" href="' + url.page("office") + '">' + ic("users-three", 20) + "Започни обща поръчка</a></div></div>" +
    '<div class="faq">' + faqHead("lfaq-h") + '<div class="shell"><div class="core">' + FAQ.map((q) => "<details><summary>" + q[0] + ic("caret-down", 20) + "</summary><p>" + esc(q[1]) + (q[2] || "") + "</p></details>").join("") + "</div></div></div>" +
    "</div></section>";
}

/* ---------- SEO: Menu > MenuSection > MenuItem, BreadcrumbList, FAQPage ---------- */
export function lunchLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  const page = abs(url.lunch());
  const menuLd = {
    /* a name without the date (it would age between builds); provider -> the Restaurant of the home page (@id) */
    "@context": "https://schema.org", "@type": "Menu", "@id": page + "#menu", name: "Обедно меню на " + R.name, url: page, inLanguage: "bg",
    provider: { "@type": "Restaurant", "@id": abs(url.home()) + "#restaurant", name: R.name },
    description: "Обедното меню на " + R.name + " в Дружба 2, ново всеки ден: до 15:00 с доставка или за вземане, след 15:00 само за вземане от място с -" + DISC_PCT + "%.",
    hasMenuSection: groups().map((g) => ({
      "@type": "MenuSection", name: g.n,
      hasMenuItem: g.items.map((x) => ({
        "@type": "MenuItem", name: x.n,
        offers: { "@type": "Offer", price: x.p.toFixed(2), priceCurrency: "EUR", availability: isOut(x) ? "https://schema.org/SoldOut" : "https://schema.org/InStock" },
      })),
    })),
  };
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name: "Обедно меню", item: page }],
  };
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: FAQ.map((q) => ({ "@type": "Question", name: q[0], acceptedAnswer: { "@type": "Answer", text: q[1] } })),
  };
  return [menuLd, crumbs, faq];
}
export { dateText };
