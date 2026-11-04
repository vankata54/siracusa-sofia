/* The shared runtime works WITHOUT the menu (this file must not import lib/data.ts). */
import { describe, it, expect } from "vitest";
import { addLine, subtotal, count, emptyCart } from "../../src/lib/cart.ts";
import { ic, hasIcon, loadAllIcons } from "../../src/lib/icons.ts";
import { url } from "../../src/lib/routes.ts";
import "../../src/lib/chrome.ts";

describe("runtime without the menu", () => {
  it("cart keeps the price given at add time", () => {
    const c = addLine(addLine(emptyCart(), "pitsa-dyavolo", 2, { p: 8.18 }), "x", 1, { p: 1.5, extra: 0.5 });
    expect(c.lines[0].p).toBe(8.18);
    expect(count(c)).toBe(3);
    expect(subtotal(c)).toBeCloseTo(8.18 * 2 + 2);
  });
  it("icons: chrome set registered, others lazy", async () => {
    expect(hasIcon("x") && hasIcon("check") && hasIcon("question")).toBe(true);
    expect(hasIcon("map-pin")).toBe(false);
    expect(ic("map-pin")).toBe(ic("question"));
    await loadAllIcons();
    expect(hasIcon("map-pin")).toBe(true);
  });
  it("url.dish without the menu needs a dish object", () => {
    expect(url.dish({ id: "pitsa-dyavolo", cat: "pitsi" })).toBe("/menu/pitsi/pitsa-dyavolo/");
    expect(url.dish("pitsa-dyavolo")).toBe("/menu/");
  });
});
