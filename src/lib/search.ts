/* Търсене на ястия: едно и също за сайта, менюто на масата, персонала и асистента (решение 15.11.2026).
   Без менюто и без DOM: работи на сървъра, в браузъра и в прототипа (design/ds/search.js се строи от този файл).

   1. По име (горе): всяка дума в името (и в думите на категорията), която ЗАПОЧВА с написаното; 2 букви стигат.
      „лук“ намира „Луканка“ и „Пица с луканка“.
   2. По състав (под лентата „Съдържат лук“): само цели думи и формите им (лук, лука, лукът, луков, червен лук),
      алергените по алергените на ястието, „люто“ и „вегетарианско“ по етикетите. „Пица с луканка“ не влиза тук,
      освен ако в състава ѝ има и лук. Ястие, което е горе по име, не се повтаря отдолу.
   3. Английски и латиница: onion → лук, gluten → глутен, cheese → сирене (речникът lib/lexicon.ts), kebap → кебап.
   4. Изключване: „без глутен“, „no gluten“, „gluten free“, „-лук“; няколко наведнъж. Ястие без въведен състав
      НИКОГА не минава „без ...“: то е отделно най-долу (unknown) с „Нямаме пълен състав, попитайте ни“. */
import { LEXICON, type Term } from "./lexicon.ts";

/** What the search needs from a dish (Dish from data.ts fits; the prototype passes SC.items). */
export interface Searchable { id: string; n: string; comp: string; al: readonly string[]; t: readonly string[]; kw?: string }

/* ---------- латиница ---------- */
const LAT: Record<string, string> = { "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "h", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "sht", "ъ": "a", "ь": "y", "ю": "yu", "я": "ya", "ѝ": "i" };
export function latin(s: string): string { return String(s).toLowerCase().replace(/[а-яѝ]/g, (c) => LAT[c] || c); }
function squash(s: string): string { return s.replace(/(.)\1+/g, "$1"); }
export function words(s: string): string[] { return s.split(/[^a-z0-9]+/).filter(Boolean); }
const norm = (s: string): string[] => words(squash(latin(s)));

/** A typed (Latin) word can mean several spellings: c as „ц“ (pica) or as „k“ (carbonara). */
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

/* ---------- формите на една дума (в латиница) ---------- */
/** Окончания на българските форми: лук-а, лук-ът, лук-ов, домат-и, домат-ен, сирен-ето, гъб-и (основата губи крайната гласна). */
export const ENDINGS = ["", "a", "at", "ya", "yat", "ta", "to", "te", "ti", "ov", "ova", "ovo", "ovi", "ove", "ovete", "i", "ite", "e", "ete", "en", "na", "no", "ni", "ena", "eno", "eni", "ski", "ska", "sko", "ki", "ka", "ko", "eto", "ata", "tsa", "tse", "tsi"];
/** Is `token` a form of `lemma` (both Latin, one word)? „lukanka“ is not a form of „luk“. */
export function isForm(token: string, lemma: string, strip = true): boolean {
  if (token === lemma) return true;
  const base = strip && lemma.length > 3 && /[aeiouy]$/.test(lemma) ? lemma.slice(0, -1) : lemma;
  return base.length >= 2 && token.indexOf(base) === 0 && ENDINGS.indexOf(token.slice(base.length)) > -1;
}

/* ---------- речникът ---------- */
interface Concept { label: string; forms: string[]; al?: string; tag?: string }
const toConcept = (t: Term): Concept => ({ label: t.bg[0], forms: t.bg.map((w) => norm(w).join(" ")).filter((w) => w.indexOf(" ") < 0), al: t.al, tag: t.tag });
const LEX: Concept[] = LEXICON.map(toConcept);
const EN = new Map<string, Concept>();
LEXICON.forEach((t, i) => t.en.forEach((w) => { EN.set(w, LEX[i]); if (!/s$/.test(w)) EN.set(w + "s", LEX[i]); }));
/** The concept of a typed word: an English word, or one of the Bulgarian forms (in Cyrillic or Latin). */
function conceptOf(word: string): Concept | null {
  const lw = String(word).toLowerCase();
  if (EN.has(lw)) return EN.get(lw)!;
  const vs = qVariants(lw).map((v) => v.join(""));
  for (const c of LEX) for (const f of c.forms) for (const v of vs) if (v === f || isForm(v, f)) return c;
  return null;
}

/* ---------- заявката ---------- */
export interface QWord { raw: string; v: string[]; c: Concept | null; label: string }
export interface Query { inc: QWord[]; exc: QWord[] }
const STOP = new Set(["с", "и", "със", "на", "за", "with", "and", "the", "a"]);
const NEG = new Set(["без", "bez", "no", "without", "not"]);
function qword(raw: string): QWord {
  const c = conceptOf(raw);
  return { raw, v: qVariants(raw).map((x) => x.join("")), c, label: c ? c.label : raw.toLowerCase() };
}
/** „пица без лук no gluten -сусам gluten-free“ → include [пица], exclude [лук, глутен, сусам, глутен]. */
export function parse(raw: string): Query {
  const toks = String(raw || "").toLowerCase().replace(/[-‑](free|фри)\b/g, " free").split(/[\s,.;:!?„“"()]+/).filter(Boolean);
  const q: Query = { inc: [], exc: [] };
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i];
    if (NEG.has(t) && toks[i + 1]) { q.exc.push(qword(toks[++i])); continue; }
    if (t.length > 1 && t[0] === "-") { q.exc.push(qword(t.slice(1))); continue; }
    if (toks[i + 1] === "free") { q.exc.push(qword(t)); i++; continue; }
    if (t === "free" || STOP.has(t)) continue;
    t = t.replace(/^-+|-+$/g, "");
    if (t) q.inc.push(qword(t));
  }
  return q;
}

/* ---------- съвпадения ---------- */
const IDX = new WeakMap<object, { name: string[]; comp: string[] }>();
function idx(x: Searchable) {
  let w = IDX.get(x);
  if (!w) { w = { name: norm(x.n + " " + (x.kw || "")), comp: norm(x.comp || "") }; IDX.set(x, w); }
  return w;
}
const hasForm = (toks: string[], forms: string[], strip = true): boolean => toks.some((t) => forms.some((f) => isForm(t, f, strip)));
/* дума извън речника („суши“): само тя и окончанията ѝ, без да губи крайната гласна („сушен“ не е форма на „суши“) */
/** By name: a word that starts with the typed word (2+ letters), or a form of the concept (onion → „Лучена ...“). */
function byName(x: Searchable, w: QWord, typo = false): boolean {
  const n = idx(x).name;
  if (w.v.some((v) => v.length >= 2 && n.some((t) => t.indexOf(v) === 0))) return true;
  if (w.c && hasForm(n, w.c.forms)) return true;
  /* една правописна грешка в дума над 4 букви (5+), две от 9 (design/PAGES.md): само ако нищо не е намерено без тях.
     Броят се написаните букви, не латиницата („суши“ е 4 букви, макар „sushi“ да е 5): „суши“ не намира „сушен домат“. */
  const len = w.raw.replace(/[^0-9a-zа-яѝ]/gi, "").length, k = len >= 9 ? 2 : len >= 5 ? 1 : 0;
  if (typo) return k > 0 && w.v.some((v) => n.some((t) => { for (let L = Math.max(1, v.length - k); L <= v.length + k; L++) if (dl(v, t.slice(0, L)) <= k) return true; return false; }));
  return false;
}
/** By composition: whole words and their forms, the allergens of the dish, its tags. Nothing without a composition. */
function byComp(x: Searchable, w: QWord): boolean {
  if (!x.comp) return false;
  if (w.c) {
    if (w.c.al && x.al.indexOf(w.c.al) > -1) return true;
    if (w.c.tag && x.t.indexOf(w.c.tag) > -1) return true;
    return hasForm(idx(x).comp, w.c.forms);
  }
  return w.v.some((v) => v.length >= 2 && hasForm(idx(x).comp, [v], false));
}
/** The dish has the excluded thing (or we cannot know: no composition). */
function has(x: Searchable, w: QWord): boolean { return byComp(x, w) || (w.c ? hasForm(idx(x).name, w.c.forms) : w.v.some((v) => hasForm(idx(x).name, [v], false))); }

/* ---------- резултатът ---------- */
export interface Result<T extends Searchable> {
  query: Query;
  /** горе: всички думи са в името */
  name: T[];
  /** под лентата: останалите, които имат съставката (думите, които не са в името, са в състава) */
  comp: T[];
  /** „Съдържат лук“ (празно, ако comp е празно) */
  band: string;
  /** само „без ...“ без друга дума: всички ястия, които минават изключването */
  rest: T[];
  /** при „без ...“: ястия без въведен състав („Нямаме пълен състав, попитайте ни“), най-долу */
  unknown: T[];
}
const joinAnd = (a: string[]): string => (a.length < 2 ? a.join("") : a.slice(0, -1).join(", ") + " и " + a[a.length - 1]);

export function searchDishes<T extends Searchable>(list: readonly T[], raw: string): Result<T> {
  const query = parse(raw), out: Result<T> = { query, name: [], comp: [], band: "", rest: [], unknown: [] };
  if (!query.inc.length && !query.exc.length) return out;
  /* „без ...“: ястие без състав никога не минава като „без“; ястие с изключеното отпада */
  let pool: T[] = list.slice();
  if (query.exc.length) {
    out.unknown = pool.filter((x) => !x.comp && query.inc.every((w) => byName(x, w)));
    pool = pool.filter((x) => !!x.comp && !query.exc.some((w) => has(x, w)));
  }
  if (!query.inc.length) { out.rest = pool; return out; }
  /* „pica“ е „пица“, не „пика(нтно)“: първото изписване, което намира нещо, печели (както досега) */
  for (const w of query.inc) if (w.v.length > 1) { const one = { ...w, v: [w.v[0]] }; if (pool.some((x) => byName(x, one) || byComp(x, one))) w.v = one.v; }
  const run = (typo: boolean) => {
    const name: T[] = [], comp: T[] = [], via = new Set<string>();
    for (const x of pool) {
      const n = query.inc.map((w) => byName(x, w, typo));
      if (n.every(Boolean)) { name.push(x); continue; }
      const c = query.inc.map((w, i) => n[i] || byComp(x, w));
      if (c.every(Boolean)) { comp.push(x); query.inc.forEach((w, i) => { if (!n[i]) via.add(w.label); }); }
    }
    return { name, comp, via };
  };
  let r = run(false);
  if (!r.name.length && !r.comp.length) r = run(true);
  /* в името: първо ястията, чието име започва с думата */
  const first = query.inc[0];
  const starts = (x: T): number => (first.v.some((v) => (idx(x).name[0] || "").indexOf(v) === 0) ? 0 : 1);
  out.name = r.name.map((x, i) => [x, i] as const).sort((a, b) => starts(a[0]) - starts(b[0]) || a[1] - b[1]).map((z) => z[0]);
  out.comp = r.comp;
  out.band = r.comp.length ? "Съдържат " + joinAnd(query.inc.filter((w) => r.via.has(w.label)).map((w) => w.label)) : "";
  if (query.exc.length) out.unknown = out.unknown.filter((x) => out.name.indexOf(x) < 0);
  return out;
}

/** Scores by id for the old callers (name 3, composition 1, „без ...“ only 1; unknown is not a match). */
export function scores<T extends Searchable>(list: readonly T[], raw: string): Record<string, number> {
  const r = searchDishes(list, raw), sc: Record<string, number> = {};
  r.name.forEach((x) => { sc[x.id] = 3; });
  r.comp.forEach((x) => { sc[x.id] = 1; });
  r.rest.forEach((x) => { sc[x.id] = 1; });
  return sc;
}

/* ---------- чиповете до думата: „глутен ✕“ ↔ „без глутен“ ---------- */
export interface Chip { label: string; without: boolean; word: string }
/** The recognised ingredients and allergens of the query, as chips that switch between „с“ and „без“. */
export function chips(raw: string): Chip[] {
  const q = parse(raw);
  return [...q.inc.filter((w) => w.c).map((w) => ({ label: w.label, without: false, word: w.raw })), ...q.exc.map((w) => ({ label: w.label, without: true, word: w.raw }))];
}
/** Switch one word between „X“ and „без X“ in the query text („-X“, „X-free“ and „X free“ also count as „без X“). */
export function toggle(raw: string, word: string): string {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), s = String(raw || "");
  const neg = new RegExp("(^|\\s)(?:(?:без|bez|no|without|not)\\s+" + esc + "|[-‑]" + esc + "|" + esc + "[-‑\\s](?:free|фри))(?=\\s|$)", "i");
  if (neg.test(s)) return s.replace(neg, "$1" + word).replace(/\s+/g, " ").trim();
  const pos = new RegExp("(^|\\s)" + esc + "(?=\\s|$)", "i");
  return (pos.test(s) ? s.replace(pos, "$1без " + word) : (s + " без " + word)).replace(/\s+/g, " ").trim();
}
