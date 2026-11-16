/* No imports: the pencil and "Предложи подобрение" in the browser use the same function as the core. */
/* personal data never stays in a note: phone numbers and e-mail addresses become a marker (server and demo).
   Digits of any script count (full-width, Arabic-Indic ...), with up to 3 separators between them (spaces, brackets,
   hyphens and dashes); dots and slashes are not separators, so dates ("15.11.2026") and prices stay. */
const ND = /\p{Nd}/u;
function asciiDigits(s: string): string {
  return Array.from(s.normalize("NFKC"), (ch) => {
    if (ch >= "0" && ch <= "9" || !ND.test(ch)) return ch;
    let cp = ch.codePointAt(0)!, start = cp;
    while (start > cp - 60 && ND.test(String.fromCodePoint(start - 1))) start--;
    return String((cp - start) % 10);
  }).join("");
}
/* bounded parts (64 / 63 characters) keep every pattern linear: a long text without "@" never costs more than one pass */
const EMAIL = /[\p{L}\p{N}._%+-]{1,64}\s{0,3}@\s{0,3}[\p{L}\p{N}-]{1,63}(?:\s{0,3}\.\s{0,3}[\p{L}\p{N}-]{1,63}){0,4}\s{0,3}\.\s{0,3}\p{L}{2,12}/gu;
/* an address written with words: "ivan at abv dot bg", "иван маймунка абв точка бг" */
const EMAIL_WORDS = /[\p{L}\p{N}._-]{2,64}\s{0,3}\(?\s{0,3}(?:at|ат|маймунка|кльомба)\s{0,3}\)?\s{0,3}[\p{L}\p{N}-]{2,63}\s{1,3}(?:dot|точка)\s{1,3}\p{L}{2,12}/giu;
const PHONE = /(?:\+|00)?\d(?:[\s()\-\u2010-\u2015]{0,3}\d){7,}/g;
/* groups of 3-4 digits with "." or "/" (0888.123.456, 0888/123456); dates (15.11.2026) have groups of 2 and stay */
const PHONE_DOTS = /(?<!\d)\d{3,4}(?:[./]\d{3,7}){1,3}(?!\d)/g;
/** the longest text a note keeps (the note's text); anything longer is cut BEFORE the patterns run */
export const SCRUB_MAX = 4000;
export function scrubPersonal(s: string, max = SCRUB_MAX): string {
  const t = asciiDigits(String(s || "").slice(0, max));
  const e = /[@＠]/.test(t) ? t.replace(EMAIL, "[имейл]") : t;
  return e.replace(EMAIL_WORDS, "[имейл]").replace(PHONE, "[телефон]").replace(PHONE_DOTS, (m) => (m.replace(/\D/g, "").length >= 9 ? "[телефон]" : m));
}
