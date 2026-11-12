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

describe("runtime size: on-demand parts stay out of the shared chunk", () => {
  it("sc.ts imports only the small chrome-core; sheets / assistant / share come from sc-ui.ts on demand", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/client/sc.ts", "utf8");
    const statics = [...src.matchAll(/^import\s+(?!type)[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(statics).toContain("../lib/chrome-core.ts");
    for (const bad of ["../lib/chrome.ts", "../lib/chrome-sheets.ts", "./sc-ui.ts", "../lib/data.ts", "../lib/assistant.ts"]) expect(statics).not.toContain(bad);
    expect(src).toContain('import("./sc-ui.ts")');
    const { morePanel, cookieSettings } = await import("../../src/lib/chrome-sheets.ts");
    expect(morePanel()).toContain("Нашата фурна Bertha");
    expect(cookieSettings({ analytics: false, marketing: true })).toMatch(/name="marketing" checked/);
  });
});

describe("loadModule: a failed dynamic import is tried again", () => {
  it("reads the chunk address from the error, keeps success, forgets failure", async () => {
    const { loadModule, failedUrl } = await import("../../src/lib/load.ts");
    expect(failedUrl(new TypeError("Failed to fetch dynamically imported module: https://x.bg/_astro/sc-ui.AB12.js"))).toBe("https://x.bg/_astro/sc-ui.AB12.js");
    expect(failedUrl(new Error("Importing a module script failed."))).toBeNull();
    let calls = 0;
    const ok = () => { calls++; return Promise.resolve({ v: 1 }); };
    expect(await loadModule(ok)).toEqual({ v: 1 });
    await loadModule(ok);
    expect(calls).toBe(1);
    let fails = 0;
    const bad = () => { fails++; return Promise.reject(new Error("offline")); };
    await expect(loadModule(bad)).rejects.toThrow("offline");
    await expect(loadModule(bad)).rejects.toThrow("offline");
    expect(fails).toBe(2);
  });
});
