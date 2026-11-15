/* Menu filters, allergen exclusion and search (PAGES.md "Логика за менютата и филтрите"; port of menu.html).
   Search: lib/search.ts (by name, then „Съдържат ...“ by composition, English and Latin, „без ...“; decision 15.11.2026). */
import { FILTERS, catById, isOut, type Dish, type Filter } from "./data.ts";

/* nouns per category: [one, "Всички ..." (plural), count form after a number] (decision 12.11.2026: "10 предястия",
   "3 бургера", "3 хлебчета"; categories without a noun count as "ястия", never "вида"). [0] also feeds the search. */
import { NOUN, noun, allOf } from "./nouns.ts";
export { NOUN, noun, allOf };

/* ---------- filters ---------- */
export interface FilterState { f: string[]; a: string[]; q: string }

export function filterById(id: string): Filter | undefined { return FILTERS.find((f) => f.id === id); }

/** All active filters must match; a ticked allergen hides dishes that contain it. */
export function passes(x: Dish, st: Pick<FilterState, "f" | "a">): boolean {
  for (const id of st.f) { const f = filterById(id); if (f && !f.test(x)) return false; }
  for (const a of st.a) if (x.al.indexOf(a as Dish["al"][number]) > -1) return false;
  return true;
}

/** Filters to show as chips: only those with at least one matching dish, with the count. `needs` filters are listed as inactive. */
export function filterChips(list: Dish[]): { f: Filter; n: number; inactive: boolean }[] {
  return FILTERS.map((f) => ({ f, n: list.filter(f.test).length, inactive: !!f.needs }))
    .filter((c) => c.inactive || c.n > 0);
}

/* ---------- search: the shared engine in lib/search.ts (decision 15.11.2026) ---------- */
import { scores, latin, qVariants, dl, searchDishes, type Searchable } from "./search.ts";
export { latin, qVariants, dl };
/** The dish as the search sees it: the category name and its noun also count as „name“ words („бургер“ finds „Чийзбургер ...“ in „Бургери“). */
const SX = new Map<string, Searchable>();
export function searchable(x: Dish): Searchable {
  let s = SX.get(x.id);
  if (!s) { const c = catById[x.cat]; s = { id: x.id, n: x.n, comp: x.comp, al: x.al, t: x.t, kw: (c ? c.n : "") + " " + (NOUN[x.cat] && x.cat !== "hlebcheta" ? NOUN[x.cat][0] : "") + " " + (x.group || "") }; SX.set(x.id, s); }
  return s;
}
/** Scores by dish id (0 / missing = no match): name 3, composition 1. Dishes without a composition never pass „без ...“. */
export function searchScores(list: Dish[], raw: string): Record<string, number> { return scores(list.map(searchable), raw); }
/** The two groups (name, „Съдържат ...“), the „без ...“ list and the dishes without a composition. */
export function searchGroups(list: Dish[], raw: string) {
  const r = searchDishes(list.map(searchable), raw), back = (a: Searchable[]) => a.map((s) => list.find((x) => x.id === s.id)!);
  return { query: r.query, band: r.band, name: back(r.name), comp: back(r.comp), rest: back(r.rest), unknown: back(r.unknown) };
}

/** Search a list, best first. */
export function search(list: Dish[], raw: string): Dish[] {
  if (!raw.trim()) return list.slice();
  const sc = searchScores(list, raw);
  return list.filter((x) => sc[x.id]).sort((a, b) => sc[b.id] - sc[a.id]);
}

/** Order inside a category: sold-out items last, otherwise keep order (or by score when searching). */
export function sortInCat(list: Dish[], scores?: Record<string, number>): Dish[] {
  return list.map((x, i) => [x, i] as const)
    .sort((a, b) => (Number(isOut(a[0])) - Number(isOut(b[0]))) || (scores ? (scores[b[0].id] || 0) - (scores[a[0].id] || 0) : 0) || (a[1] - b[1]))
    .map((z) => z[0]);
}

/* ---------- hash state: "#pitsi&f=veg.hot&a=gluten.milk&q=..." ---------- */
export function readHash(hash: string): FilterState & { cat: string } {
  const st = { cat: "", f: [] as string[], a: [] as string[], q: "" };
  hash.replace(/^#/, "").split("&").filter(Boolean).forEach((part) => {
    const i = part.indexOf("=");
    if (i < 0) { st.cat = decodeURIComponent(part); return; }
    const k = part.slice(0, i), v = decodeURIComponent(part.slice(i + 1));
    if (k === "f") st.f = v.split(".").filter((id) => !!filterById(id));
    if (k === "a") st.a = v.split(".").filter(Boolean);
    if (k === "q") st.q = v;
  });
  return st;
}
export function writeHash(st: Partial<FilterState> & { cat?: string }): string {
  const p: string[] = [];
  if (st.cat) p.push(st.cat);
  if (st.f && st.f.length) p.push("f=" + st.f.join("."));
  if (st.a && st.a.length) p.push("a=" + st.a.join("."));
  if (st.q) p.push("q=" + encodeURIComponent(st.q));
  return p.length ? "#" + p.join("&") : "";
}
