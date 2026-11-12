/* 404 page: HTML pieces for the server (404.astro frontmatter only; nothing here goes to the browser).
   Port of design/pages/404.html (design/PAGES.md "gallery.html + 404.html", design/reviews/404.review.md) plus two
   variants from docs/BUILD-TODO.md: a missing category or dish under /menu/... (with the list of categories, same logic
   as catsHTML in menu/[kategoria]/_cat.ts, copied here so that file stays untouched) and a missing event under
   /sabitia/... (the invalid-event state of design/pages/event.html with the "Предстои" card).
   Every variant is in the HTML; a small inline script in 404.astro shows the right one (data-v). */
import { cats, inCat, isOut, events, lastSaturday, noun, RESTAURANT as R, MON, DAYS, art, esc, ic, url, dateLong, type Dish } from "../lib/index.ts";

export type Variant = "gen" | "cat" | "dish" | "ev";
/** Wrapper attribute: the element is shown only for these variants (the general one is visible in the raw HTML). */
export const v = (list: Variant[]): string => ' data-v="' + list.join(" ") + '"' + (list.includes("gen") ? "" : " hidden");

/* ---------- the joke illustration: the art's own plate, emptied (as in the prototype) ---------- */
export function emptyPlate(): string {
  const fake = { id: "prazna-chinia", n: "", comp: "", cat: "supi", t: [] } as unknown as Dish;
  const soup = art(fake);
  const plate = (soup.match(/<circle cx="100" cy="100" r="94"[^>]*\/><circle cx="100" cy="100" r="78"[^>]*\/>/) || [""])[0];
  const pz = art("pitsa-margarita");
  /* colours taken from the pizza illustration (art, not interface tokens); fallbacks only if the art changes */
  const crust = (pz.match(/r="92" fill="(#[0-9A-Fa-f]{6})"/) || [0, "#D9A262"])[1];
  const sauce = (pz.match(/r="76" fill="(#[0-9A-Fa-f]{6})"/) || [0, "#C23A22"])[1];
  const char = (pz.match(/fill="(#[0-9A-Fa-f]{6})" opacity/) || [0, "#7E4618"])[1];
  const crumbs = ([[78, 92, 3.2, crust], [86, 118, 2.2, crust], [70, 108, 1.6, char], [112, 82, 2.4, crust], [121, 96, 1.4, char], [94, 76, 1.8, crust], [64, 90, 1.2, crust], [104, 124, 1.5, char]] as [number, number, number, string][])
    .map((c) => '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '" fill="' + c[3] + '"/>').join("");
  const knife = '<g transform="translate(86 74) rotate(-45)"><path class="cut" d="M-1 0Q10 10 10 58L-1 58Z"/><rect class="cut" x="-3.5" y="58" width="11" height="62" rx="5.5"/></g>';
  const fork = '<g transform="translate(103 57) rotate(-45)"><rect class="cut" x="-7.6" y="0" width="2.6" height="22" rx="1.3"/><rect class="cut" x="-3.2" y="0" width="2.6" height="22" rx="1.3"/><rect class="cut" x="1.2" y="0" width="2.6" height="22" rx="1.3"/><rect class="cut" x="5.6" y="0" width="2.6" height="22" rx="1.3"/><rect class="cut" x="-8" y="18" width="16.2" height="12" rx="6"/><rect class="cut" x="-2" y="26" width="4.2" height="34" rx="2"/><rect class="cut" x="-4.4" y="58" width="9" height="62" rx="4.5"/></g>';
  return '<svg viewBox="0 0 200 200" aria-hidden="true">' + plate +
    '<g class="crumbs"><circle cx="100" cy="100" r="58" fill="none" stroke="' + sauce + '" stroke-width="2.5" opacity=".16"/>' + crumbs + "</g>" +
    '<g class="cutlery">' + knife + fork + "</g></svg>";
}

/* ---------- phone line (the browser rewrites it by the hour, same words) ---------- */
export const TEL = "tel:" + R.phoneIntl;
export function callLine(st: { open: boolean; m: number } | null): string {
  const tel = '<a class="link" href="' + TEL + '">' + ic("phone", 18);
  if (!st || st.open) return "Търсите нещо конкретно? " + tel + "Обадете се: " + R.phone + "</a>";
  return "Търсите нещо конкретно? Обадете ни се " + (st.m < 600 ? "след 10:00" : "утре след 10:00") + ": " + tel + R.phone + "</a>";
}

/* ---------- "Може би търсите" (prototype list; review 404 small fixes 1 and 2 applied) ---------- */
export function suggestionsHTML(): string {
  const SUG: [string, string, string, string][] = [
    [url.lunch(), "Обедно меню", "Ястия и цени за деня", "bowl-food"],
    [url.reservation(), "Резервирай маса", "Салон или отоплявана градина", "calendar-blank"],
    [url.page("delivery"), "Доставка", "Зони, часове и такси", "truck"],
    [url.events(), "Събития и поводи", "Гръцка вечер и празници при нас", "confetti"],
    [url.offers(), "Оферти", "Всички отстъпки на едно място", "seal-percent"],
    [url.page("contacts"), "Контакти", "Дружба 2, срещу бл. 311", "map-pin"],
  ];
  return '<div class="shell sug-wrap"><div class="core"><nav class="sug-list" aria-label="Често отваряни страници">' + SUG.map((s) =>
    '<a class="sug" href="' + s[0] + '"><span class="ico">' + ic(s[3], 22) + "</span><span><b>" + s[1] + "</b><small>" + s[2] + "</small></span>" + ic("caret-right", 20) + "</a>").join("") + "</nav></div></div>";
}
/** Four pizzas for the general variant: hits first, then new ones, never sold out. */
export function pizzas(): Dish[] {
  const has = (x: Dish, t: Dish["t"][number]) => (x.t.indexOf(t) > -1 ? 1 : 0);
  return inCat("pitsi").filter((x) => !isOut(x)).sort((a, b) => has(b, "hit") - has(a, "hit") || has(b, "new") - has(a, "new")).slice(0, 4);
}

/* ---------- the categories (copy of catsHTML(null) from menu/[kategoria]/_cat.ts) ---------- */
function heroDish(list: Dish[]): Dish {
  const ok = list.filter((x) => !isOut(x));
  return ok.find((x) => x.t.indexOf("hit") > -1) || ok.find((x) => x.t.indexOf("new") > -1) || ok.slice().sort((a, b) => b.p - a.p)[0] || list[0];
}
export function catsHTML(): string {
  return '<ul class="nf-cats">' + cats.filter((c) => inCat(c.id).length).map((c) => {
    const its = inCat(c.id), h = heroDish(its);
    return '<li><a class="cat" href="' + url.cat(c.id) + '" data-cat="' + c.id + '" data-name="' + esc(c.n) + '"><span class="pic" aria-hidden="true">' + art(h) + "</span><span><b>" + esc(c.n) + "</b><small>" +
      (c.id === "zakuski" ? noun(c.id, its.length) + " · до 11:30" : noun(c.id, its.length)) + "</small></span></a></li>";
  }).join("") + "</ul>";
}

/* ---------- missing event: the "Предстои" card of design/pages/event.html ---------- */
export function calLeaf(d: Date | null): string {
  if (!d) return '<span class="cal nodate" aria-hidden="true"><span class="m">Последна</span><span class="d">сб</span><span class="w">от месеца</span></span>';
  return '<span class="cal" aria-hidden="true"><span class="m">' + MON[d.getMonth()] + '</span><span class="d">' + d.getDate() + '</span><span class="w">' + DAYS[d.getDay()] + "</span></span>";
}
/** The first event. A recurring "last Saturday" evening gets no date at build time (it would go stale);
    the browser fills in the date (data-ls). */
export function upcomingHTML(today: Date = new Date()): string {
  const ev = events(today)[0];
  if (!ev) return "";
  const ls = lastSaturday(today).d.getTime() === ev.date.getTime();
  const when = ls ? "Всяка последна събота от месеца" : dateLong(ev.date);
  return '<div class="ev-up"><h2 class="h3">Предстои</h2><a class="card ev-upcard" href="' + url.event(ev.id) + '"' + (ls ? " data-ls" : "") + ">" + calLeaf(ls ? null : ev.date) +
    "<span><b>" + esc(ev.n) + '</b><span class="muted"><span data-when>' + when + "</span> · " + esc(ev.time) + '</span></span><span class="go2" aria-hidden="true">' + ic("arrow-right", 22) + "</span></a></div>";
}
