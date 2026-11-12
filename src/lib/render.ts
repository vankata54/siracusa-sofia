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


export function art(x: DishRef, attrs?: string): string { return artSvg(D(x), attrs); }

export function pic(x: DishRef, cls?: string): string {
  const d = D(x);
  return '<div class="pic ' + (cls || "") + (isOut(d) ? " out" : "") + '" role="img" aria-label="' + esc(d.n) + ' (илюстрация до новата фотосесия)">' + art(d) + "</div>";
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
export function dishCard(x: DishRef, variant: "card" | "row" = "card"): string {
  const d = D(x), href = url.dish(d), unit = d.per100 ? "за 100 гр." : d.g;
  if (variant === "row") return '<div class="drow"><a class="open" href="' + href + '">' + pic(d) + '<span><span class="nm">' + esc(d.n) + '</span><span class="meta"><span class="price">' + fmt(d.p) + '</span><span class="muted small">' + unit + "</span></span>" + (d.t.length ? '<span style="display:block;margin-top:6px">' + badges(d) + "</span>" : "") + "</span></a>" + plusBtn(d) + "</div>";
  return '<div class="dcard"><a class="open" href="' + href + '"><span class="pw">' + pic(d) + badges(d, true) + '</span><span class="nm">' + esc(d.n) + '</span></a><div class="rowp"><span><span class="price">' + fmt(d.p) + "</span><small>" + unit + "</small></span>" + plusBtn(d) + "</div></div>";
}

