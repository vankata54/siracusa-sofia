/* The shared dish search (decision 15.11.2026): by name, then „Съдържат ...“ by composition, English and Latin, „без ...“. */
import { describe, expect, it } from "vitest";
import { searchDishes, isForm, parse, chips, toggle, type Searchable } from "../../src/lib/search.ts";
import { items } from "../../src/lib/data.ts";
import { searchable, searchGroups } from "../../src/lib/filters.ts";

const D = (id: string, n: string, comp: string, al: string[] = [], t: string[] = []): Searchable => ({ id, n, comp, al, t });
const list = [
  D("lukanka", "Луканка", "свинско месо, черен пипер"),
  D("p-lukanka", "Пица с луканка", "доматен сос, моцарела, луканка, зелена чушка", ["milk"]),
  D("p-luk", "Пица с луканка и лук", "доматен сос, моцарела, луканка, червен лук", ["milk"]),
  D("shopska", "Шопска салата", "домат, краставица, лук, маслини"),
  D("tuna", "Пица с риба Тон", "доматен сос, моцарела, риба тон, червен лук, зелен лук", ["fish", "milk"]),
  D("krila", "Пилешки крилца", "пилешки крила, мед, зелен лук, сусам", ["sesame"]),
  D("kolbasi", "Сет от български колбаси", "луканка, суджук, пастърма"),
  D("lukov", "Лучена супа", "лукът, масло, хляб", ["gluten", "milk"]),
  D("nodata", "Пица Маргарита", ""),
  D("kebap", "Кебапчета", "свинска и телешка кайма"),
  D("burger", "Хрупкав пилешки бургер", "пилешко филе, хлебче, айсберг", ["gluten"]),
];
const ids = (a: Searchable[]) => a.map((x) => x.id);

describe("search: by name, then „Съдържат ...“", () => {
  it("„лук“: Луканка by name (prefix); only real onion below the band; no repeats", () => {
    const r = searchDishes(list, "лук");
    expect(ids(r.name)).toEqual(["lukanka", "p-lukanka", "p-luk", "lukov"]); /* „Лучена“ is a form of лук */
    expect(r.band).toBe("Съдържат лук");
    expect(ids(r.comp)).toEqual(["shopska", "tuna", "krila"]);
    expect(ids(r.comp)).not.toContain("p-lukanka"); /* луканка is not onion */
    expect(ids(r.comp)).not.toContain("kolbasi");
    expect(r.name.filter((x) => r.comp.indexOf(x) > -1)).toEqual([]);
  });
  it("a typo is forgiven only in a word of 5+ letters (two from 9): „суши“ does not find „сушен домат“", () => {
    const l = [D("brusk", "Брускета със сушен домат", "хляб, домат"), D("keb", "Кебапчета", "кайма")];
    expect(ids(searchDishes(l, "суши").name)).toEqual([]);
    expect(ids(searchDishes(l, "суши").comp)).toEqual([]);
    expect(ids(searchDishes(l, "kebapceta").name)).toEqual(["keb"]); /* 9 letters: two typos */
    expect(ids(searchDishes(l, "кебепчета").name)).toEqual(["keb"]);
    expect(ids(searchDishes(l, "брускта").name)).toEqual(["brusk"]); /* 7 letters: one */
    expect(searchGroups(items, "kebapceta").name.map((x) => x.n)).toContain("Кебапчета");
    /* on the real menu: „суши“ finds nothing (the „Брускети ... сушен домат“ was a typo match) */
    const g = searchGroups(items, "суши");
    expect(g.name.length + g.comp.length).toBe(0);
  });
  it("2 letters are enough by name", () => { expect(ids(searchDishes(list, "лу").name)).toContain("lukanka"); });
  it("the forms of a word, not a longer word", () => {
    expect(isForm("luk", "luk")).toBe(true);
    expect(isForm("luka", "luk")).toBe(true);
    expect(isForm("lukat", "luk")).toBe(true);
    expect(isForm("lukov", "luk")).toBe(true);
    expect(isForm("lukanka", "luk")).toBe(false);
    expect(isForm("gabi", "gaba")).toBe(true);
    expect(isForm("sireneto", "sirene")).toBe(true);
  });
});

describe("search: English and Latin", () => {
  it("onion → лук (by composition; „Луканка“ is not onion)", () => {
    const r = searchDishes(list, "onion");
    expect(ids(r.name)).toEqual(["p-luk", "lukov"]); /* „лук“ and „Лучена“ (a form of лук) in the name */
    expect(ids(r.comp)).toEqual(["shopska", "tuna", "krila"]);
    expect(ids(r.comp)).not.toContain("p-lukanka");
    expect(r.band).toBe("Съдържат лук");
  });
  it("gluten → глутен (by the allergens)", () => {
    const r = searchDishes(list, "gluten");
    expect(ids(r.comp).sort()).toEqual(["burger", "lukov"]);
    expect(r.band).toBe("Съдържат глутен");
  });
  it("kebap → кебап (Latin, by name)", () => { expect(ids(searchDishes(list, "kebap").name)).toEqual(["kebap"]); });
  it("cheese → сирене (dictionary)", () => {
    const r = searchDishes([D("a", "Салата", "краве сирене, домат"), D("b", "Супа", "моркови")], "cheese");
    expect(ids(r.comp)).toEqual(["a"]);
  });
});

describe("search: „без ...“ never lets a dish without a composition through", () => {
  it("„без глутен“: dishes with gluten out, no composition apart at the bottom", () => {
    const r = searchDishes(list, "без глутен");
    expect(ids(r.rest)).not.toContain("burger");
    expect(ids(r.rest)).not.toContain("lukov");
    expect(ids(r.rest)).not.toContain("nodata");
    expect(ids(r.unknown)).toEqual(["nodata"]);
  });
  it("„no gluten“, „gluten-free“ and several at once: „без глутен без лук“", () => {
    expect(ids(searchDishes(list, "no gluten").rest)).toEqual(ids(searchDishes(list, "без глутен").rest));
    expect(ids(searchDishes(list, "gluten-free").rest)).toEqual(ids(searchDishes(list, "без глутен").rest));
    const r = searchDishes(list, "без глутен без лук");
    expect(ids(r.rest)).not.toContain("shopska");
    expect(ids(r.rest)).toContain("kebap");
    expect(ids(r.unknown)).toEqual(["nodata"]);
  });
  it("„пица без лук“: pizzas without onion; Маргарита (no composition) only at the bottom", () => {
    const r = searchDishes(list, "пица без лук");
    expect(ids(r.name)).toEqual(["p-lukanka"]);
    expect(ids(r.unknown)).toEqual(["nodata"]);
  });
  it("parse and the chips that switch „глутен“ ↔ „без глутен“", () => {
    expect(parse("пица без лук no gluten -сусам").exc.map((w) => w.label)).toEqual(["лук", "глутен", "сусам"]);
    expect(chips("глутен")).toEqual([{ label: "глутен", without: false, word: "глутен" }]);
    expect(toggle("пица глутен", "глутен")).toBe("пица без глутен");
    expect(toggle("пица без глутен", "глутен")).toBe("пица глутен");
    /* the other ways to say „без“: the chip turns them back into the plain word, never „-лук без лук“ */
    expect(toggle("-лук", "лук")).toBe("лук");
    expect(toggle("gluten-free", "gluten")).toBe("gluten");
    expect(toggle("gluten free пица", "gluten")).toBe("gluten пица");
    expect(toggle("no gluten", "gluten")).toBe("gluten");
    expect(chips("gluten-free")).toEqual([{ label: "глутен", without: true, word: "gluten" }]);
  });
});

describe("search on the real menu", () => {
  it("„лук“: „Пица с луканка“ by name, „Сет от български колбаси“ (луканка in the composition) not below the band", () => {
    const g = searchGroups(items, "лук");
    expect(g.name.map((x) => x.n)).toContain("Пица с луканка");
    expect(g.comp.map((x) => x.n)).not.toContain("Сет от български колбаси");
    expect(g.comp.length).toBeGreaterThan(5);
    expect(g.comp.every((x) => /(^|[^а-я])лук([аъо]|ът|ов)?([^а-я]|$)/i.test(x.comp))).toBe(true);
  });
  it("„без глутен“ never lists a dish without a composition", () => {
    const g = searchGroups(items, "без глутен");
    expect(g.rest.every((x) => !!x.comp && x.al.indexOf("gluten") < 0)).toBe(true);
    expect(g.unknown.every((x) => !x.comp)).toBe(true);
    expect(g.unknown.length).toBe(items.filter((x) => !x.comp).length);
  });
  it("„бургер“ finds the burgers by the category word", () => {
    expect(searchGroups(items, "бургер").name.length).toBeGreaterThanOrEqual(items.filter((x) => x.cat === "burgeri").length);
    expect(searchable(items[0]).kw).toBeTruthy();
  });
});
