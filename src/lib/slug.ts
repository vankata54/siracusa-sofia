/* The address (slug) of a dish from its Bulgarian name: the same algorithm as scripts/slug.mjs (decision 12.11.2026,
   variant 1; 72 characters since 14.11.2026), in TypeScript for the core (the menu editor gives a new dish its id and
   address at "Публикувай"). tests/unit/menu-edit.test.ts checks that both give the same result for every name. */

export const SLUG_MAX = 72;

const T: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n",
  о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y",
  ю: "yu", я: "ya",
};

/** "Пица Дяволо" -> "pitsa-dyavolo": lower case, Cyrillic to Latin, anything else between words becomes one "-" */
export function translit(name: string): string {
  return String(name).toLowerCase().split("").map((c) => T[c] ?? c).join("")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** whole words only: a slug longer than `max` is cut at the last "-" that keeps it within `max` (never inside a word) */
export function slugify(name: string, max = SLUG_MAX): string {
  const s = translit(name);
  if (s.length <= max) return s;
  const cut = s.lastIndexOf("-", max);
  return cut > 0 ? s.slice(0, cut) : s.slice(0, max);
}

/** slug for every item ({id, n}); unique among all slugs and never another item's id. A clash gets "-2", "-3" ...
    Returns a Map id -> slug. */
export function assignSlugs(items: { id: string; n: string }[], max = SLUG_MAX): Map<string, string> {
  const ids = new Set(items.map((x) => x.id));
  const used = new Set<string>();
  const out = new Map<string, string>();
  for (const x of items) {
    let base = slugify(x.n, max), s = base, k = 1;
    const taken = (v: string) => used.has(v) || (v !== x.id && ids.has(v));
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

/** a new id (and address) from a name: the slug rule, unique against every id and slug in `taken`; "" names give "yastie" */
export function newSlug(name: string, taken: Set<string>, max = SLUG_MAX): string {
  const first = slugify(name, max) || "yastie";
  if (!taken.has(first)) return first;
  for (let k = 2; ; k++) {
    const tail = "-" + k, s = (slugify(name, max - tail.length) || "yastie") + tail;
    if (!taken.has(s)) return s;
  }
}
