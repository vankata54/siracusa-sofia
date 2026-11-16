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
    expect(morePanel()).toContain("Фурната Bertha"); /* site.review-consistency Д5 */
    expect(cookieSettings({ analytics: false, marketing: true })).toMatch(/name="marketing" checked/);
  });
});

describe("runtime size: what the bundler puts into the shared chunk", () => {
  /* astro.config.mjs puts the RUNTIME modules into the chunk "sc"; the bundler adds EVERY module they import (also a plain
     re-export), on every page. So a runtime module may import only runtime modules (decision 16.11.2026). */
  it("a module of the runtime imports only modules of the runtime (the rest comes with import())", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const cfg = fs.readFileSync("astro.config.mjs", "utf8");
    const list = [.../const RUNTIME = \[([\s\S]*?)\];/.exec(cfg)![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(list).toContain("/src/client/sc.ts");
    for (const m of list) {
      const file = path.join(process.cwd(), m), src = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const froms = [...src.matchAll(/^\s*(?:import|export)\s+(?!type\b)(?:[^;"']*?\sfrom\s+)?"(\.[^"]+)"/gm)].map((x) => x[1]);
      for (const f of froms) {
        const to = "/" + path.relative(process.cwd(), path.resolve(path.dirname(file), f)).split(path.sep).join("/");
        expect(list, m + " imports " + f + " (not a module of the runtime)").toContain(to);
      }
    }
  });
  it("the menu constants (TAGS, FILTERS, COURSE_NAME) have one importer, lib/data.ts: they stay in the chunk of the menu", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const users: string[] = [];
    (function walk(d: string) {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|astro|mjs)$/.test(f) && /from\s+"[^"]*consts-menu\.ts"/.test(fs.readFileSync(p, "utf8"))) users.push(p.split(path.sep).join("/"));
      }
    })("src");
    expect(users).toEqual(["src/lib/data.ts"]);
  });
});

describe("loadModule: after a failed chunk the next try reloads the page", () => {
  it("keeps success; after a failure, offline rejects at once and online reloads", async () => {
    const { loadModule, loadFailed } = await import("../../src/lib/load.ts");
    let calls = 0;
    const ok = () => { calls++; return Promise.resolve({ v: 1 }); };
    expect(await loadModule(ok)).toEqual({ v: 1 });
    await loadModule(ok);
    expect(calls).toBe(1);
    expect(loadFailed()).toBe(false);
    const bad = () => Promise.reject(new Error("Failed to fetch dynamically imported module"));
    await expect(loadModule(bad)).rejects.toThrow("Failed to fetch");
    expect(loadFailed()).toBe(true);
    let reloaded = 0;
    Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true, writable: true });
    Object.defineProperty(globalThis, "location", { value: { reload: () => { reloaded++; } }, configurable: true, writable: true });
    await expect(loadModule(bad)).rejects.toThrow("offline");
    Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });
    void loadModule(bad);
    expect(reloaded).toBe(1);
  });
});
