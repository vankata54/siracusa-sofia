/* Dish renderers (need the menu) + everything from chrome.ts. String HTML renderers, identical on the server (Astro pages, set:html) and in the browser (client scripts).
   Same DOM and classes as design/ds/sc.js, with the new addresses from routes.ts. */
import { ic } from "./icons.ts";
import "sc-icons:clock,fire,leaf,pepper,plus,sparkle"; /* the icons of this module in one group (scripts/icon-groups.mjs) */
import { byId, isOut, TAGS, type Dish } from "./data.ts";
import { artSvg } from "./art.ts";
import { esc, fmt } from "./format.ts";
import { url } from "./routes.ts";

export * from "./chrome.ts";
export { fmt, esc } from "./format.ts";

type DishRef = Dish | string;
const D = (x: DishRef): Dish => (typeof x === "string" ? byId[x] : x);


/** The illustration; "" when the dish is not in this menu (a decoration of a page whose dish the new menu does not have). */
export function art(x: DishRef, attrs?: string): string { const d = D(x); return d ? artSvg(d, attrs) : ""; }

/** The dish photo from the admin (/media/<sha256>.<ext>, a data: URL in the demo); square box, lazy unless `eager`
    (the first photo in the first screen). alt "" when the picture is a decoration next to the name. */
export function photo(d: Dish, o: { eager?: boolean; alt?: string; w?: number; h?: number } = {}): string {
  return '<img src="' + esc(d.photo || "") + '" alt="' + esc(o.alt ?? d.n) + '" width="' + (o.w || 600) + '" height="' + (o.h || 600) + '" decoding="async"' + (o.eager ? ' fetchpriority="high"' : ' loading="lazy"') + ">";
}

/** The picture alone, as a decoration next to the dish name (aria-hidden box): the photo (alt "") or the illustration. */
export function thumb(x: DishRef): string { const d = D(x); return d && d.photo ? photo(d, { alt: "" }) : art(d); }

/** The dish picture: the photo when the admin uploaded one, else the illustration (until the new photo shoot). */
export function pic(x: DishRef, cls?: string, eager?: boolean): string {
  const d = D(x);
  if (!d) return ""; /* a decoration naming a dish the published menu does not have */
  const c = '<div class="pic ' + (cls || "") + (isOut(d) ? " out" : "") + '"';
  if (d.photo) return c + ">" + photo(d, { eager }) + "</div>";
  return c + ' role="img" aria-label="' + esc(d.n) + ' (илюстрация до новата фотосесия)">' + art(d) + "</div>";
}

export function badges(x: DishRef, onpic?: boolean): string {
  const d = D(x);
  const t = d.t.filter((k) => TAGS[k]);
  if (!t.length) return "";
  return '<span class="badges' + (onpic ? " onpic" : "") + '">' + t.map((k) => '<span class="badge ' + k + '">' + ic(TAGS[k][1], 16) + TAGS[k][0] + "</span>").join("") + "</span>";
}

export function plusBtn(x: DishRef): string {
  const d = D(x);
  if (isOut(d)) return "";
  return '<button class="plus" type="button" data-add="' + d.id + '" data-p="' + d.p + '" aria-label="Добави ' + esc(d.n) + ' в количката">' + ic("plus", 22) + "</button>";
}

/** variant "card" (rail / grid) or "row" */
export function dishCard(x: DishRef, variant: "card" | "row" = "card", eager?: boolean): string {
  const d = D(x), href = url.dish(d), unit = d.per100 ? "за 100 гр." : esc(d.g);
  if (variant === "row") return '<div class="drow"><a class="open" href="' + href + '">' + pic(d, "", eager) + '<span><span class="nm">' + esc(d.n) + '</span><span class="meta"><span class="price">' + fmt(d.p) + '</span><span class="muted small">' + unit + "</span></span>" + (d.t.length ? '<span style="display:block;margin-top:6px">' + badges(d) + "</span>" : "") + "</span></a>" + plusBtn(d) + "</div>";
  return '<div class="dcard"><a class="open" href="' + href + '"><span class="pw">' + pic(d, "", eager) + badges(d, true) + '</span><span class="nm">' + esc(d.n) + '</span></a><div class="rowp"><span><span class="price">' + fmt(d.p) + "</span><small>" + unit + "</small></span>" + plusBtn(d) + "</div></div>";
}

