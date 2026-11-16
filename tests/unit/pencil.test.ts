/* The pure parts of the pencil and of "Предложи подобрение" without a DOM (vitest runs in node; there is no jsdom here).
   The DOM parts (a unique, short selector; a field gives its label, never its value) are in tests/e2e/pencil.spec.ts. */
import { describe, it, expect } from "vitest";
import { scrub, goodId, clean } from "../../src/admin/pen-core.ts";
import { scrubPersonal } from "../../src/core/notes.ts";
import { personal } from "../../src/client/suggest.ts";

describe("pencil: personal data and ids", () => {
  const samples = [
    "Обадете се на 0888 12 34 56", "0888123456", "+359 888 123 456", "ivan@abv.bg", "Пишете на menu@siracusa-sofia.com или 02 812 34 56",
    "Цена 10,22 € за 2 души", "Поръчка № 1042 в 19:00", "Меню", "",
  ];
  it("the browser scrubs a note's text exactly as the server (scrubPersonal in src/core/notes.ts)", () => {
    for (const s of samples) expect(scrub(s), s).toBe(scrubPersonal(s));
    expect(scrub("Обадете се на 0894 36 55 77")).toBe("Обадете се на [телефон]");
    expect(scrub("ivan@abv.bg")).toBe("[имейл]");
  });
  it("an id is used in the selector only when it is not random or live data", () => {
    expect(goodId("mh1")).toBe(true);
    expect(goodId("f-name")).toBe(true);
    expect(goodId("order-1042")).toBe(false);
    expect(goodId("shk3x9a")).toBe(false);
    expect(goodId("1abc")).toBe(false);
    expect(goodId("")).toBe(false);
    expect(goodId(null)).toBe(false);
  });
  it("clean() keeps one space and no ends", () => {
    expect(clean("  Меню \n\t за  деня ")).toBe("Меню за деня");
    expect(clean(null)).toBe("");
  });
});

describe("Предложи подобрение: no personal data in the text", () => {
  it("refuses phones (mobile, landline, +359) and e-mails (also written with words)", () => {
    for (const s of ["0888 12 34 56", "0888123456", "+359 888 123 456", "02 812 34 56", "ivan@abv.bg", "ivan at abv dot bg", "ivan маймунка abv точка bg"]) expect(personal(s), s).toBe(true);
  });
  it("lets prices, dates, times and order numbers pass", () => {
    for (const s of ["Пицата е 10,22 €", "сб, 28 ноември в 19:00", "Поръчка № 1042", "Бутонът е твърде малък", "3 души, маса 12"]) expect(personal(s), s).toBe(false);
  });
});
