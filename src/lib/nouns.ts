/* The count words of the categories ("4 супи", "3 бургера"; decision 12.11.2026), WITHOUT the menu: light pages
   (allergens) use them too. filters.ts re-exports them. */
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
