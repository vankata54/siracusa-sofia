import { describe, it, expect } from "vitest";
import { fmt, plural, dateLong, dateShort, hhmm, normPhone, esc } from "../../src/lib/format.ts";
import { items, byId, lunch, isOut, inCat, ALLERGENS, FILTERS } from "../../src/lib/data.ts";
import { suggest, courseOf } from "../../src/lib/suggest.ts";
import { offers } from "../../src/lib/offers.ts";
import { events } from "../../src/lib/events.ts";
import { price, lunchDiscountActive } from "../../src/lib/pricing.ts";
import { zoneOfAddress, findAddress, zoneByName } from "../../src/lib/zones.ts";
import { addLine, setQty, removeLine, count, subtotal, emptyCart, lineKey, sanitize } from "../../src/lib/cart.ts";
import { search, passes, filterChips, readHash, writeHash } from "../../src/lib/filters.ts";
import { url, fromProto, configureRoutes } from "../../src/lib/routes.ts";
import { dishCard, header, ic } from "../../src/lib/render.ts";

describe("format", () => {
  it("euro, plural, dates, time, phone", () => {
    expect(fmt(10.22)).toBe("10,22 €");
    expect(fmt(2.7)).toBe("2,70 €");
    expect(plural(1, "ястие", "ястия")).toBe("1 ястие");
    expect(plural(3, "ястие", "ястия")).toBe("3 ястия");
    expect(dateLong(new Date(2026, 10, 28))).toBe("сб, 28 ноември");
    expect(dateShort(new Date(2026, 10, 28))).toBe("сб, 28 ное");
    expect(hhmm(19 * 60)).toBe("19:00");
    expect(normPhone("0888 12 34 56")).toBe("0888123456");
    expect(normPhone("+359 888 123 456")).toBe("0888123456");
    expect(normPhone("12345")).toBeNull();
    expect(esc('<a href="x">')).toBe("&lt;a href=&quot;x&quot;&gt;");
  });
});

describe("data", () => {
  it("127 real items, lunch joins the lookup", () => {
    expect(items.length).toBe(127);
    expect(lunch.length).toBeGreaterThan(5);
    expect(byId[lunch[0].id].lunch).toBe(true);
    expect(items.some((x) => x.cat === "obedno")).toBe(false);
    expect(ALLERGENS.length).toBe(14);
    expect(FILTERS.find((f) => f.id === "protein")!.needs).toBeTruthy();
  });
});

describe("Върви добре с", () => {
  const mains = ["main"];
  it("max 3, never a second main for a main dish, no empty course (no drinks)", () => {
    for (const x of items.filter((i) => i.course === "main")) {
      const s = suggest(x.id);
      expect(s.length).toBeLessThanOrEqual(3);
      for (const k of s) {
        expect(mains).not.toContain(courseOf(byId[k.id]));
        expect(k.c).not.toBe("drink");
        expect(isOut(byId[k.id])).toBe(false);
        expect(byId[k.id].cat).not.toBe("dobavki");
      }
    }
  });
  it("pizza: salad and dessert, most expensive first", () => {
    const s = suggest("pitsa-s-burata-i-proshuto-krudo");
    expect(s.map((x) => x.c)).toEqual(["salad", "dessert"]);
    const salads = items.filter((x) => courseOf(x) === "salad" && !isOut(x));
    expect(byId[s[0].id].p).toBe(Math.max(...salads.map((x) => x.p)));
  });
  it("skips courses already in the cart", () => {
    const first = suggest("pitsa-s-burata-i-proshuto-krudo");
    const s = suggest("pitsa-s-burata-i-proshuto-krudo", [first[0].id]);
    expect(s.map((x) => x.c)).toEqual(["dessert"]);
  });
  it("desserts before sweet pizzas", () => {
    const s = suggest(inCat("salati")[0].id);
    const d = s.find((x) => x.c === "dessert");
    expect(d && byId[d.id].cat).toBe("deserti");
  });
  it("manual pairings win", () => {
    const s = suggest("pitsa-s-burata-i-proshuto-krudo", [], { "pitsa-s-burata-i-proshuto-krudo": { salad: inCat("salati")[1].id } });
    expect(s[0].id).toBe(inCat("salati")[1].id);
  });
});

describe("offers and events", () => {
  const nov4 = new Date(2026, 10, 4);
  it("lunch before 15:00, -30% after, tomorrow at night; -10% with profile always 'от следващата поръчка'", () => {
    expect(offers("12:30", nov4)[0].id).toBe("lunch");
    expect(offers("16:30", nov4)[0].id).toBe("lunch30");
    expect(offers("23:30", nov4)[0].id).toBe("tomorrow");
    const o = offers("12:30", nov4);
    expect(o.map((x) => x.id)).toEqual(["lunch", "greek", "birthday", "signup"]);
    expect(o.find((x) => x.id === "signup")!.p).toContain("от следващата поръчка");
    expect(JSON.stringify(o)).not.toMatch(/-5%/);
    expect(o[1].href).toBe("/sabitia/gratska-vecher/");
  });
  it("Greek night on the last Saturday", () => {
    const e = events(nov4)[0];
    expect(e.id).toBe("gratska-vecher");
    expect(e.date.getDay()).toBe(6);
  });
});

describe("pricing: -30% lunch after 15:00 only for pickup, zones and fees", () => {
  const L = lunch[0], trad = items.find((x) => x.cat === "pitsi" && !isOut(x))!;
  const cartOf = (mode: "delivery" | "pickup") => addLine(addLine({ ...emptyCart(), mode }, L.id, 2), trad.id, 1);
  it("no discount before 15:00", () => {
    const p = price(cartOf("pickup"), { clock: "12:30" });
    expect(p.disc).toBe(0);
  });
  it("-30% on lunch lines after 15:00 for pickup only", () => {
    const p = price(cartOf("pickup"), { clock: "16:30" });
    expect(p.disc).toBe(Math.round(L.p * 2 * 30) / 100);
    expect(p.total).toBe(Math.round((L.p * 2 + trad.p - p.disc) * 100) / 100);
    expect(lunchDiscountActive("pickup", "16:30")).toBe(true);
    expect(lunchDiscountActive("delivery", "16:30")).toBe(false);
  });
  it("delivery after 15:00 with lunch: no discount, conflict", () => {
    const p = price(cartOf("delivery"), { clock: "16:30", zone: zoneByName("Дружба 2") });
    expect(p.disc).toBe(0);
    expect(p.conflict).toBe("delivery");
  });
  it("after 21:00 delivery switches to pickup", () => {
    const p = price({ ...emptyCart(), lines: addLine(emptyCart(), trad.id).lines }, { clock: "21:30" });
    expect(p.mode).toBe("pickup");
    expect(p.deliveryOk).toBe(false);
  });
  it("free zones: fee 0; paid zones: fee unknown", () => {
    const c = addLine(emptyCart(), trad.id);
    expect(price(c, { clock: "12:30", zone: zoneByName("Дружба 1") }).fee).toBe(0);
    const paid = price(c, { clock: "12:30", zone: zoneByName("Горубляне") });
    expect(paid.fee).toBeNull();
    expect(paid.feeUnknown).toBe(true);
    expect(paid.total).toBe(trad.p);
  });
  it("zone ETA (+20 when busy)", () => {
    const c = addLine(emptyCart(), trad.id);
    expect(price(c, { clock: "16:30", zone: zoneByName("Дружба 2") }).etaMin).toBe(25);
    expect(price(c, { clock: "12:30", zone: zoneByName("Гара Искър") }).etaMin).toBe(65);
  });
  it("kitchen closed", () => {
    expect(price(addLine(emptyCart(), trad.id), { clock: "23:30" }).closed).toBe(true);
  });
});

describe("zones by address", () => {
  it("sample addresses", () => {
    expect(findAddress("druzhba 2")[0].z).toBe("Дружба 2");
    expect(findAddress("Горубляне")[0].z).toBe("Горубляне");
    expect(findAddress("Младост 1")[0].z).toBe("");
  });
  it("free text", () => {
    const r = zoneOfAddress("ж.к. Дружба 2, бл. 311");
    expect(r.type === "zone" && r.zone.n).toBe("Дружба 2");
    expect(zoneOfAddress("druzhba").type).toBe("ask");
    expect(zoneOfAddress("Младост 4").type).toBe("out");
    const g = zoneOfAddress("Гара Искър");
    expect(g.type === "zone" && g.zone.free).toBe(false);
    const n = zoneOfAddress("НПЗ Искър");
    expect(n.type === "zone" && n.zone.free).toBe(true);
    expect(zoneOfAddress("Бусманци").type).toBe("zone");
  });
});

describe("cart", () => {
  it("line key = id + mods; same key merges", () => {
    let c = emptyCart();
    c = addLine(c, "pitsa-dyavolo", 1, { mods: ["без лук"], extra: 0 });
    c = addLine(c, "pitsa-dyavolo", 1);
    c = addLine(c, "pitsa-dyavolo", 2, { mods: ["без лук"] });
    expect(c.lines.map((l) => l.key)).toEqual(["pitsa-dyavolo|без лук", "pitsa-dyavolo"]);
    expect(c.lines[0].q).toBe(3);
    expect(count(c)).toBe(4);
    expect(lineKey("x", ["a", "b"])).toBe("x|a,b");
  });
  it("subtotal with extras, setQty 0 removes, remove returns the line", () => {
    const p = byId["pitsa-dyavolo"].p;
    let c = addLine(emptyCart(), "pitsa-dyavolo", 2, { mods: ["+ Кашкавал"], extra: 1.5 });
    expect(subtotal(c)).toBeCloseTo((p + 1.5) * 2);
    c = setQty(c, c.lines[0].key, 0);
    expect(c.lines.length).toBe(0);
    const r = removeLine(addLine(emptyCart(), "pitsa-dyavolo"), "pitsa-dyavolo");
    expect(r.gone!.id).toBe("pitsa-dyavolo");
    expect(sanitize({ lines: [{ id: "x", q: "2" }], mode: "pickup" })).toEqual({ lines: [{ key: "x", id: "x", q: 2, mods: [], extra: 0 }], mode: "pickup" });
  });
});

describe("filters and search", () => {
  it("Latin and typos", () => {
    expect(search(items, "pica").some((x) => x.cat === "pitsi")).toBe(true);
    expect(search(items, "kebapcheta").some((x) => /кебапче/i.test(x.n))).toBe(true);
    expect(search(items, "карбонра").some((x) => /карбонара/i.test(x.n))).toBe(true);
    expect(search(items, "ПИЦА").length).toBe(search(items, "пица").length);
  });
  it("filters all apply, allergens exclude", () => {
    const veg = items.filter((x) => passes(x, { f: ["veg"], a: [] }));
    expect(veg.every((x) => x.t.includes("veg"))).toBe(true);
    const ng = items.filter((x) => passes(x, { f: [], a: ["gluten"] }));
    expect(ng.every((x) => !x.al.includes("gluten"))).toBe(true);
    expect(filterChips(items).every((c) => c.inactive || c.n > 0)).toBe(true);
  });
  it("hash format", () => {
    const h = writeHash({ cat: "pitsi", f: ["veg", "hot"], a: ["gluten", "milk"], q: "бурата" });
    expect(h).toBe("#pitsi&f=veg.hot&a=gluten.milk&q=" + encodeURIComponent("бурата"));
    expect(readHash(h)).toEqual({ cat: "pitsi", f: ["veg", "hot"], a: ["gluten", "milk"], q: "бурата" });
  });
});

describe("routes and render", () => {
  it("pretty urls and prototype map", () => {
    expect(url.home()).toBe("/");
    expect(url.cat("pitsi")).toBe("/menu/pitsi/");
    expect(url.dish("pitsa-dyavolo")).toBe("/menu/pitsi/pitsa-dyavolo/");
    expect(url.dish(lunch[0])).toBe("/obedno-menu/");
    expect(url.page("contacts")).toBe("/kontakti/");
    expect(url.tracking(1042)).toBe("/porachka/1042/");
    expect(fromProto("menu.html")).toBe("/menu/");
    expect(fromProto("dish.html#pitsa-dyavolo")).toBe("/menu/pitsi/pitsa-dyavolo/");
    expect(fromProto("category.html#pitsi&f=veg")).toBe("/menu/pitsi/#f=veg");
    expect(fromProto("offers.html#birthday")).toBe("/oferti/#birthday");
    expect(fromProto("event.html#gratska-vecher")).toBe("/sabitia/gratska-vecher/");
  });
  it("demo mode gives relative index.html links", () => {
    configureRoutes({ demo: true, root: "../../" });
    try {
      expect(url.menu()).toBe("../../menu/index.html");
      expect(url.home()).toBe("../../index.html");
      expect(url.tracking(1042)).toBe("../../porachka/index.html#1042");
    } finally { configureRoutes({ demo: false, root: "/" }); }
  });
  it("same DOM as the prototype", () => {
    const h = dishCard("pitsa-dyavolo");
    expect(h).toMatch(/^<div class="dcard"><a class="open" href="\/menu\/pitsi\/pitsa-dyavolo\/"><span class="pw"><div class="pic /);
    expect(h).toContain('data-add="pitsa-dyavolo"');
    expect(dishCard("pitsa-dyavolo", "row")).toMatch(/^<div class="drow">/);
    expect(header({ nav: "menu" })).toContain('class="cartbtn" href="/kolichka/"');
    expect(ic("nope")).toContain("<svg");
  });
});
