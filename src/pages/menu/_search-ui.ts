/* The search results pieces shared by /menu/, /menu/<кат>/ and /alergeni/ (decision 15.11.2026 „Търсенето на ястия е едно“).
   Pure strings, no menu and no search code here (only types), so /alergeni/ can draw them on the small runtime:
   the chips next to the recognised words („глутен ✕“ ↔ „без глутен“) and the one phrase for a dish without composition. */
import type { Chip } from "../../lib/search.ts";
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";

/** The one phrase for a dish without a composition (site, table menu, staff, assistant). */
export const NO_COMP = "Нямаме пълен състав, попитайте ни";
/** „глутен“, „глутен и лук“, „глутен, лук и мляко“ */
export const joinAnd = (a: string[]): string => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " и " + a[a.length - 1]);
/** The excluded words of a query as a title: „Без глутен“, „Без глутен и лук“. */
export const withoutTitle = (chips: Chip[]): string => { const w = chips.filter((c) => c.without).map((c) => c.label); return w.length ? "Без " + joinAnd(w) : ""; };

/** The chips next to the recognised words. Pressing one switches the word in the field and the address (lib/search.ts toggle). */
export function qchipsHTML(chips: Chip[]): string {
  if (!chips.length) return "";
  return '<span class="ql">Търсим:</span>' + chips.map((c) => {
    const l = esc(c.label);
    return '<button class="chip qchip" type="button" data-qtoggle="' + esc(c.word) + '" aria-pressed="' + c.without + '" aria-label="' +
      (c.without ? "без " + l + ", покажи и с " + l : l + ", покажи без " + l) + '">' + (c.without ? ic("check", 18) + "без " + l : l + ic("x", 18)) + "</button>";
  }).join("");
}

/** The sentence under the „Нямаме пълен състав“ heading: what we cannot promise. */
export function unknownText(chips: Chip[]): string {
  const w = chips.filter((c) => c.without).map((c) => c.label);
  return "Не знаем дали " + (w.length ? "съдържат " + esc(joinAnd(w)) : "отговарят на търсенето") + ". Обадете ни се, преди да поръчате.";
}
