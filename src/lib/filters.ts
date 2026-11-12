/* Menu filters, allergen exclusion and search (PAGES.md "Логика за менютата и филтрите"; port of menu.html).
   Search: name and composition, case-insensitive, Latin input ("pica" -> "пица"), one typo in words over 4 letters. */
import { FILTERS, catById, isOut, type Dish, type Filter } from "./data.ts";

/* nouns per category: [one, "Всички ..." (plural), count form after a number] (decision 12.11.2026: "10 предястия",
   "3 бургера", "3 хлебчета"; categories without a noun count as "ястия", never "вида"). [0] also feeds the search. */
export const NOUN: Record<string, [string, string, string]> = {
  supi: ["супа", "супи", "супи"], salati: ["салата", "салати", "салати"],
  "studeni-predyastia": ["предястие", "студени предястия", "предястия"], "topli-predyastia": ["предястие", "топли предястия", "предястия"],
  pitsi: ["пица", "пици", "пици"], hlebcheta: ["хлебче", "хлебчета", "хлебчета"], garnituri: ["гарнитура", "гарнитури", "гарнитури"],
  sosove: ["сос", "сосове", "соса"], burgeri: ["бургер", "бургери", "бургера"], dobavki: ["добавка", "добавки", "добавки"],
  deserti: ["десерт", "десерти", "десерта"], zakuski: ["закуска", "закуски", "закуски"],
};
/** "12 пици", "1 сос", "3 соса", "10 ястия" */
export function noun(cat: string, n: number): string {
  const w = NOUN[cat] || ["ястие", "ястия", "ястия"];
  return n + " " + (n === 1 ? w[0] : w[2]);
}
/** "Всички бургери" (or "Всички ястия" for a category without its own noun) */
export function allOf(cat: string): string { return "Всички " + (NOUN[cat] ? NOUN[cat][1] : "ястия"); }

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

/* ---------- search ---------- */
const LAT: Record<string, string> = { "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sht", "ъ": "a", "ь": "y", "ю": "yu", "я": "ya", "ѝ": "i" };
export function latin(s: string): string { return String(s).toLowerCase().replace(/[а-яѝ]/g, (c) => LAT[c] || c); }
function squash(s: string): string { return s.replace(/(.)\1+/g, "$1"); }
function words(s: string): string[] { return s.split(/[^a-z0-9]+/).filter(Boolean); }

/** A typed (Latin) query can mean several spellings: c as "ц" (pica) or as "k" (carbonara). */
export function qVariants(raw: string): string[][] {
  const s = latin(raw).replace(/4/g, "ch").replace(/6/g, "sh").replace(/w/g, "v").replace(/x/g, "ks").replace(/kh/g, "h")
    .replace(/ja/g, "ya").replace(/ju/g, "yu").replace(/j/g, "zh").replace(/q/g, "ya").replace(/tz|zz/g, "ts").replace(/ck/g, "k");
  const a = s.replace(/ch/g, "\u0001").replace(/c/g, "ts").replace(/\u0001/g, "ch");
  const b = s.replace(/ch/g, "\u0001").replace(/c/g, "k").replace(/\u0001/g, "ch");
  return (a === b ? [a] : [a, b]).map((v) => words(squash(v)));
}

/** Damerau-Levenshtein (optimal string alignment). */
export function dl(a: string, b: string): number {
  const m = a.length, n = b.length, d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}

/* exact prefix 3, inner substring 2, typo-tolerant prefix 0.5 */
function wordScore(q: string, t: string): number {
  if (t.indexOf(q) === 0) return 3;
  if (q.length >= 3 && t.indexOf(q) > 0) return 2;
  const k = q.length >= 9 ? 2 : q.length >= 4 ? 1 : 0;
  if (!k) return 0;
  for (let L = Math.max(1, q.length - k); L <= q.length + k; L++) if (dl(q, t.slice(0, L)) <= k) return 0.5;
  return 0;
}

const IDX = new Map<string, { name: string[]; rest: string[] }>();
function index(x: Dish) {
  let w = IDX.get(x.id);
  if (!w) {
    const c = catById[x.cat];
    w = {
      name: words(squash(latin(x.n + " " + x.id.replace(/-/g, " ")))),
      rest: words(squash(latin(x.comp + " " + (c ? c.n : "") + " " + (NOUN[x.cat] && x.cat !== "hlebcheta" ? NOUN[x.cat][0] : "") + " " + (x.group || "")))),
    };
    IDX.set(x.id, w);
  }
  return w;
}

/* name matches weigh 3x; returns {s: score, f: relied on a typo match} */
function scoreWords(x: Dish, qw: string[]): { s: number; f: boolean } {
  let total = 0, fz = false;
  const w = index(x);
  for (const q of qw) {
    let s = 0;
    for (const t of w.name) s = Math.max(s, wordScore(q, t) * 3);
    if (s < 9) for (const t of w.rest) s = Math.max(s, wordScore(q, t));
    if (!s) return { s: 0, f: false };
    if (s === 1.5 || s === 0.5) fz = true;
    total += s;
  }
  return { s: total, f: fz };
}

/** Scores by dish id (0 / missing = no match). First spelling variant that finds anything wins; exact hits hide typo-only hits. */
export function searchScores(list: Dish[], raw: string): Record<string, number> {
  const vs = qVariants(raw);
  let out: [Dish, { s: number; f: boolean }][] | null = null;
  for (let v = 0; v < vs.length && !out; v++) {
    let hits: [Dish, { s: number; f: boolean }][] = [];
    for (const x of list) { const r = scoreWords(x, vs[v]); if (r.s) hits.push([x, r]); }
    if (hits.length) {
      if (hits.some((h) => !h[1].f)) hits = hits.filter((h) => !h[1].f);
      out = hits;
    }
  }
  const sc: Record<string, number> = {};
  for (const h of out || []) sc[h[0].id] = h[1].s;
  return sc;
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
