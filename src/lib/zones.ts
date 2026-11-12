/* Delivery zones by address. v1 has no geocoder: sample addresses (as in the cart prototype) + a quarter-name parser
   (as in delivery.html). Free: Дружба 1 и 2, НПЗ Искър, Бусманци. Paid [ЛИПСВА: такса]: Горубляне, Гара Искър. */
import { ZONES, type Zone } from "./consts.ts";

export const SAMPLE_ADDRESSES: [string, string][] = [
  ["ж.к. Дружба 2, бл. 311", "Дружба 2"], ["ж.к. Дружба 2, бл. 402", "Дружба 2"], ["ж.к. Дружба 1, бл. 72", "Дружба 1"], ["ж.к. Дружба 1, бл. 19", "Дружба 1"],
  ["НПЗ Искър", "НПЗ Искър"], ["кв. Бусманци", "Бусманци"], ["кв. Горубляне", "Горубляне"], ["кв. Гара Искър", "Гара Искър"],
  ["ж.к. Младост 1, бл. 20", ""], ["ж.к. Младост 4, бл. 401", ""],
];

export function zoneByName(n: string): Zone | null { return ZONES.find((z) => z.n === n) || null; }
export function zoneBySlug(s: string): Zone | null { return ZONES.find((z) => z.slug === s) || null; }
/** Minutes for a zone ("около 35 мин" -> 35). */
export function zoneMin(z: Zone): number { return z.etaMin || parseInt(String(z.eta).replace(/\D/g, ""), 10) || 35; }

const LAT: [string, string][] = [["sht", "щ"], ["zh", "ж"], ["sh", "ш"], ["ch", "ч"], ["ts", "ц"], ["yu", "ю"], ["ya", "я"], ["ia", "я"], ["a", "а"], ["b", "б"], ["v", "в"], ["w", "в"], ["g", "г"], ["d", "д"], ["e", "е"], ["z", "з"], ["i", "и"], ["j", "ж"], ["k", "к"], ["l", "л"], ["m", "м"], ["n", "н"], ["o", "о"], ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"], ["u", "у"], ["f", "ф"], ["h", "х"], ["c", "ц"], ["y", "ъ"], ["q", "к"], ["x", "кс"]];
function toCyr(s: string): string { s = String(s || "").toLowerCase(); for (const [a, b] of LAT) s = s.split(a).join(b); return s; }

/** Sample-address autocomplete (cart step 2). */
export function findAddress(q: string): { a: string; z: string; i: number }[] {
  const norm = (s: string) => toCyr(String(s).replace(/[.,„“"]/g, " ")).replace(/\s+/g, " ").trim();
  const tk = norm(q).split(" ").filter(Boolean);
  if (!tk.length) return [];
  return SAMPLE_ADDRESSES.map((a, i) => ({ a: a[0], z: a[1], i }))
    .filter((a) => { const h = norm(a.a + " " + a.z + " софия"); return tk.every((t) => h.indexOf(t) > -1); })
    .slice(0, 6);
}

function lev(a: string, b: string): number {
  const m = a.length, n = b.length, d: number[][] = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
function like(tok: string, word: string): boolean {
  if (tok === word) return true;
  if (word.length > 4 && Math.abs(tok.length - word.length) <= 1 && lev(tok, word) <= 1) return true;
  return word.length > 5 && tok.indexOf(word.slice(0, 6)) === 0;
}
/* known Sofia quarters outside our zones: a clear refusal. Nearby villages are left out on purpose (may be "по тарифа"). */
const OUTSIDE = ["младост", "люлин", "слатина", "изгрев", "лозенец", "надежда", "овча", "красно", "студентски", "център", "центъра", "гео", "редута", "подуяне", "сухата", "витоша", "борово", "бъкстон", "илинден", "връбница", "банишора", "обеля", "хиподрума", "яворов", "дианабад", "мусагеница", "дървеница", "симеоново", "бояна", "драгалевци", "манастирски", "разсадника", "захарна", "толстой", "левски", "суходол", "гоце", "хаджи", "стрелбище", "белите", "павлово", "княжево", "горна", "модерно"];

export type AddressResult =
  | { type: "zone"; zone: Zone }
  | { type: "ask"; opts: Zone[]; q: string }
  | { type: "out" } | { type: "street" } | { type: "short" } | { type: "unknown" };

/** Free-text address -> zone (delivery.html parser). */
export function zoneOfAddress(text: string): AddressResult {
  const t = toCyr(text).replace(/ж\.?\s*к\.?|кв\.|\bс\./g, " ").replace(/([а-яъ])(\d)/g, "$1 $2").replace(/[^а-яъь0-9ivx\s]/g, " ").replace(/\s+/g, " ").trim();
  const w = t.split(" ");
  const has = (word: string) => { for (let k = 0; k < w.length; k++) if (like(w[k], word)) return k; return -1; };
  const z = (s: string) => zoneBySlug(s)!;
  if (t.length < 3) return { type: "short" };
  if (has("нпз") > -1) return { type: "zone", zone: z("npz-iskar") };
  const g = has("гара");
  let isk = has("искър"); if (isk < 0) isk = has("искар");
  if (g > -1 && isk > -1) return { type: "zone", zone: z("gara-iskar") };
  let i = has("дружба"); if (i < 0) i = has("друба");
  if (i > -1) {
    const nx = w[i + 1] || "";
    if (/^(1|i|едно|първа)$/.test(nx)) return { type: "zone", zone: z("druzhba-1") };
    if (/^(2|ii|две|втора)$/.test(nx)) return { type: "zone", zone: z("druzhba-2") };
    return { type: "ask", opts: [z("druzhba-1"), z("druzhba-2")], q: "Дружба 1 или Дружба 2?" };
  }
  if (has("бусманци") > -1) return { type: "zone", zone: z("busmantsi") };
  if (has("горубляне") > -1) return { type: "zone", zone: z("gorublyane") };
  if (isk > -1) return { type: "ask", opts: [z("npz-iskar"), z("gara-iskar")], q: "НПЗ Искър или Гара Искър?" };
  for (const o of OUTSIDE) if (has(o) > -1) return { type: "out" };
  if (/(^|\s)(ул|улица|бул|булевард|бл|блок|вх|ет|ап)(\s|$)/.test(t) || /\d/.test(t)) return { type: "street" };
  return { type: "unknown" };
}

/** A web order needs a street or block (the core and the cart use this one function). Is there more than the quarter: after taking away "ж.к.", "кв.", "София" and the quarter names (Дружба 1/2, НПЗ Искър,
    Гара Искър, Бусманци, Горубляне), something must remain: a number (block, street number) or a word (street, landmark). */
export function hasStreet(addr: string): boolean {
  const rest = String(addr).toLowerCase()
    .replace(/ж\.?\s*к\.?|кв\.|гр\.|(^|\s)с\.|софия/g, " ")
    .replace(/дружба\s*(1|2|i{1,2}|едно|две)?(?![0-9a-zа-я])|друба\s*(1|2)?|нпз\s*искър|гара\s*искър|искър|искар|бусманци|горубляне/g, " ")
    .replace(/[^а-яa-z0-9]+/g, " ").trim();
  return /\d/.test(rest) || /[а-яa-z]{3,}/.test(rest);
}
