// The address (slug) of a dish from its Bulgarian name (decision 12.11.2026, variant 1): the same transliteration as the
// ids in design/data/menu.js (Обтекаемата система, "ъ" -> "a", "щ" -> "sht"), whole words only, up to SLUG_MAX
// characters (72), unique. The id stays as it is (carts, orders, ratings, the database); only the address changes.
// Used by scripts/gen-menu.mjs (writes `slug` into src/data/menu.json) and tests/unit/slug.test.ts.

export const SLUG_MAX = 72; // 72 (decision 14.11.2026): "…-sushen-domat-tryufel" keeps its last word; no other address changes

const T = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y",
  ю: "yu", я: "ya",
};

/** "Пица Дяволо" -> "pitsa-dyavolo": lower case, Cyrillic to Latin, anything else between words becomes one "-" */
export function translit(name) {
  return String(name).toLowerCase().split("").map((c) => T[c] ?? c).join("")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** whole words only: a slug longer than `max` is cut at the last "-" that keeps it within `max` (never inside a word) */
export function slugify(name, max = SLUG_MAX) {
  const s = translit(name);
  if (s.length <= max) return s;
  const cut = s.lastIndexOf("-", max);
  return cut > 0 ? s.slice(0, cut) : s.slice(0, max);
}

/** slug for every item ({id, n}); unique among all slugs and never another item's id (the old addresses redirect).
    A clash gets "-2", "-3" ... (the base is shortened by whole words to make room). Returns a Map id -> slug. */
export function assignSlugs(items, max = SLUG_MAX) {
  const ids = new Set(items.map((x) => x.id));
  const used = new Set();
  const out = new Map();
  for (const x of items) {
    let base = slugify(x.n, max), s = base, k = 1;
    const taken = (v) => used.has(v) || (v !== x.id && ids.has(v));
    while (taken(s)) {
      k++;
      const tail = "-" + k;
      base = slugify(x.n, max - tail.length);
      s = base + tail;
    }
    used.add(s);
    out.set(x.id, s);
  }
  return out;
}
