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
const EMAIL = /[\p{L}\p{N}._%+-]+\s*@\s*[\p{L}\p{N}-]+(?:\s*\.\s*[\p{L}\p{N}-]+)*\s*\.\s*\p{L}{2,}/gu;
const PHONE = /(?:\+|00)?\d(?:[\s()\-\u2010-\u2015]{0,3}\d){7,}/g;
export function scrubPersonal(s: string): string {
  return asciiDigits(String(s || "")).replace(EMAIL, "[имейл]").replace(PHONE, "[телефон]");
}
