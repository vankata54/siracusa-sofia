/* Dish page: the light renderers (no menu data, no illustrations). The page script imports ONLY this module at load
   (with the shared runtime sc.ts); the menu, the illustrations and "Върви добре с" (_dish.ts) load later and only when needed.
   The server uses the same functions through _dish.ts (which re-exports this file). Pure string renderers: no DOM. */
import { ic } from "../../../lib/icons.ts";
import { esc, fmt } from "../../../lib/format.ts";
import { ORDER_RULES } from "../../../lib/consts.ts";
import "../../../lib/icons/caret-right.ts";
import "../../../lib/icons/sliders-horizontal.ts";
import "../../../lib/icons/minus.ts";
import "../../../lib/icons/plus.ts";
import "../../../lib/icons/heart.ts";
import "../../../lib/icons/clock.ts";

/** What the browser needs about the dish (embedded in the page as JSON). */
export interface DishLite { id: string; n: string; p: number; cat: string; comp: string; g: string; per100?: boolean; out?: boolean }
/** A paid add-on (category "dobavki"). */
export interface Addon { id: string; n: string; p: number }

/** Ends a sentence with "." unless the text already ends with one ("400 гр." stays "400 гр."). */
export const endDot = (s: string): string => (/[.!?…]$/.test(s.trim()) ? s.trim() : s.trim() + ".");
export const compList = (d: { comp: string }): string[] => (d.comp ? d.comp.split(",").map((s) => s.trim()).filter(Boolean) : []);
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
/** Categories where "Добави" makes sense: one list for the page, the cart and the core (ORDER_RULES.addonCats). */
export const canAdd = (d: { cat: string }): boolean => (ORDER_RULES.addonCats as readonly string[]).indexOf(d.cat) > -1;

/* ---------- modifiers: rem = {index of the ingredient: true}, add = {addon id: true} ---------- */
export type Rem = Record<string, boolean>;
export type Add = Record<string, boolean>;
export const extra = (addons: Addon[], add: Add): number => addons.filter((a) => add[a.id]).reduce((s, a) => s + a.p, 0);
export function modsList(d: DishLite, addons: Addon[], rem: Rem, add: Add): string[] {
  const m: string[] = [];
  compList(d).forEach((c, i) => { if (rem[i]) m.push("без " + c); });
  addons.forEach((a) => { if (add[a.id]) m.push("+ " + a.n); });
  return m;
}
export function modSummary(d: DishLite, addons: Addon[], rem: Rem, add: Add): { has: boolean; sub: string; xp: string } {
  const m = modsList(d, addons, rem, add), e = extra(addons, add);
  if (!m.length) return {
    has: false, xp: "",
    sub: compList(d).length && canAdd(d) ? "Махнете съставка или добавете още сирене, прошуто, гъби" : compList(d).length ? "Махнете съставка, която не искате. Безплатно." : "Добавете сирене, прошуто, гъби и още",
  };
  return { has: true, sub: cap(m.join(" · ")), xp: e ? "+" + fmt(e) : "" };
}
export function modBtnInner(d: DishLite, addons: Addon[], rem: Rem = {}, add: Add = {}): string {
  const s = modSummary(d, addons, rem, add);
  return '<span class="ico">' + ic("sliders-horizontal", 24) + '</span><span><b>Добавки и промени</b><span class="sub">' + esc(s.sub) + "</span>" + (s.xp ? '<span class="xp">' + s.xp + " на брой</span>" : "") + '</span><span class="end">' + ic("caret-right", 20) + "</span>";
}

/* ---------- buy box (desktop inline) and the floating .abar (phone): the same HTML ---------- */
export function buyLabel(d: DishLite, qty: number, unit: number): string {
  return d.per100
    ? '<span>Добави · <span class="price">' + fmt(unit) + '</span><span class="u100">/100 гр.</span></span>'
    : "<span>Добави" + (qty > 1 ? ' <span class="q">' + qty + " бр.</span>" : "") + ' · <span class="price">' + fmt(unit * qty) + "</span></span>";
}
export function buyHTML(d: DishLite, qty = 1, unit = d.p): string {
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
