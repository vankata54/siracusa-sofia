import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { translit, slugify, assignSlugs, SLUG_MAX } from "../../scripts/slug.mjs";
import { items } from "../../src/lib/data.ts";
import { url } from "../../src/lib/routes.ts";
import { createApp } from "../../server/app.ts";

/* Dish addresses (decision 12.11.2026, variant 1): the id stays, the cut ids get a slug of whole words up to 70 characters. */
describe("dish slug", () => {
  it("transliterates like the ids of the menu", () => {
    expect(translit("Пица Дяволо")).toBe("pitsa-dyavolo");
    expect(translit("Шопска салата")).toBe("shopska-salata");
    expect(translit("Щрудел с ябълки, сладолед & сметана")).toBe("shtrudel-s-yabalki-sladoled-smetana");
    expect(translit("Чийзбургер Блек Ангъс")).toBe("chiyzburger-blek-angas");
    expect(translit("  Crème brûlée  ")).toBe("creme-brulee");
  });
  it("whole words only, never over the limit", () => {
    const name = "Брускети със семена, прошуто Крудо, филаделфия мус, сушен домат, трюфел";
    const s = slugify(name);
    expect(s.length).toBeLessThanOrEqual(SLUG_MAX);
    expect(translit(name).startsWith(s + "-")).toBe(true); /* cut before a "-", i.e. between words */
    expect(s).toBe("brusketi-sas-semena-proshuto-krudo-filadelfiya-mus-sushen-domat");
    expect(slugify("Пица Дяволо")).toBe("pitsa-dyavolo");
    expect(slugify("аааа бббб вввв", 9)).toBe("aaaa-bbbb");
  });
  it("unique: a clash gets -2, and a slug is never another dish's id", () => {
    const m = assignSlugs([{ id: "a", n: "Пица" }, { id: "b", n: "Пица" }, { id: "pitsa-2", n: "Друго" }, { id: "c", n: "Друго" }]);
    expect(m.get("a")).toBe("pitsa");
    expect(m.get("b")).toBe("pitsa-3"); /* "pitsa-2" is the id of another dish */
    expect(new Set(m.values()).size).toBe(4);
  });
  it("the menu: 11 dishes get a new address (10 cut inside a word, 1 cut after 'чеснов'), every other address is the id", () => {
    const moved = items.filter((x) => x.slug);
    expect(moved).toHaveLength(11);
    for (const x of moved) {
      expect(x.slug).toBe(slugify(x.n));
      expect(x.slug!.startsWith(x.id.replace(/-[^-]*$/, ""))).toBe(true);
      expect(x.slug!.length).toBeLessThanOrEqual(SLUG_MAX);
      expect(url.dish(x)).toBe("/menu/" + x.cat + "/" + x.slug + "/");
    }
    for (const x of items.filter((d) => !d.slug)) {
      expect(translit(x.n)).toBe(x.id);
      expect(url.dish(x)).toBe("/menu/" + x.cat + "/" + x.id + "/");
    }
    const all = items.map((x) => x.cat + "/" + (x.slug || x.id));
    expect(new Set(all).size).toBe(all.length);
    expect(items.find((x) => x.id === "pateshko-magre-s-pyure-ot-tselina-i-sladko-ot-vi")!.slug).toBe("pateshko-magre-s-pyure-ot-tselina-i-sladko-ot-vishni");
  });
  it("the server answers an old address with 301 to the new one (the table from the build), the query stays", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-slug-"));
    fs.mkdirSync(path.join(dir, "menu/burgeri/new-one"), { recursive: true });
    fs.writeFileSync(path.join(dir, "menu/burgeri/new-one/index.html"), "<!doctype html><title>x</title>");
    fs.writeFileSync(path.join(dir, "redirects.json"), JSON.stringify({ "/menu/burgeri/old-cut-o/": "/menu/burgeri/new-one/" }));
    const { app } = createApp({ dbFile: ":memory:", distDir: dir, timers: false });
    for (const p of ["/menu/burgeri/old-cut-o/", "/menu/burgeri/old-cut-o"]) {
      const r = await app.request(p + "?utm=x");
      expect(r.status).toBe(301);
      expect(r.headers.get("location")).toBe("/menu/burgeri/new-one/?utm=x");
    }
    expect((await app.request("/menu/burgeri/new-one/")).status).toBe(200);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
