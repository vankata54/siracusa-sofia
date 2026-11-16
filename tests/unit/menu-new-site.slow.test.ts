/* SLOW (a full Astro build, about 15 s): the site follows ANY published menu (decision 15.11.2026 "Ново меню",
   "Празна категория"; 16.11.2026 "основа на менюто, част 2"). The admin's "Публикувай" rebuilds the site with MENU_FILE
   (server/publish.ts); a menu without the categories the pages used to name (pitsi, skara-bertha, zakuski, garnituri,
   dobavki ...) must still build, and the pages must follow the data:
     - every category with dishes has its page, chip and sitemap entry; an empty one has none of them;
     - texts and links that name a category the menu does not have are not shown;
     - the admin's photo replaces the illustration (width/height, lazy except the first one in the first screen, alt = name),
       the description is on the dish page.
   The menu is tests/fixtures/menu-new.json. Folder: MENU_TEST_DIST (default dist-menu-new, git-ignored). */
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const out = process.env.MENU_TEST_DIST || "dist-menu-new";
const dir = path.join(root, out);
const fixture = path.join(root, "tests/fixtures/menu-new.json");
const menu = JSON.parse(fs.readFileSync(fixture, "utf8")) as { cats: { id: string; n: string }[]; items: { id: string; slug?: string; cat: string; n: string; photo?: string; desc?: string }[] };
const page = (p: string) => fs.readFileSync(path.join(dir, p, "index.html"), "utf8");
const has = (p: string) => fs.existsSync(path.join(dir, p, "index.html"));
/* every public HTML page (the admin is not the site) */
function htmlFiles(d = dir): string[] {
  const res: string[] = [];
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) { if (!(d === dir && f === "admin")) res.push(...htmlFiles(p)); } else if (f.endsWith(".html")) res.push(p);
  }
  return res;
}
const GONE = ["pitsi", "skara-bertha", "zakuski", "garnituri", "dobavki", "sosove", "supi", "deserti"];
const SHOWN = ["ribni-yastia", "salati", "sladko", "burgeri"];
const salmon = menu.items.find((x) => x.id === "syomga-na-skara")!;

describe("бавен: сайтът се сглобява с ново меню (MENU_FILE)", () => {
  beforeAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    execFileSync("npx", ["astro", "build", "--outDir", out], { cwd: root, env: { ...process.env, MENU_FILE: fixture, DEMO: "" }, stdio: "pipe", timeout: 240_000 });
  }, 260_000);

  it("the fixture is a different menu: other categories, a photo, an empty category, no pizzas", () => {
    const used = new Set(menu.items.map((x) => x.cat));
    expect(menu.cats.some((c) => !used.has(c.id))).toBe(true);
    expect(used.has("pitsi")).toBe(false);
    expect(menu.items.some((x) => x.photo)).toBe(true);
  });

  it("a page for every category with dishes and every dish; none for an empty or absent category", () => {
    for (const c of SHOWN) expect(has("menu/" + c), c).toBe(true);
    expect(has("menu/prazna-kategoria")).toBe(false);
    for (const c of GONE) expect(has("menu/" + c), c).toBe(false);
    for (const x of menu.items) expect(has("menu/" + x.cat + "/" + (x.slug || x.id)), x.id).toBe(true);
  });

  it("sitemap and redirects follow the menu", () => {
    const sm = fs.readFileSync(path.join(dir, "sitemap.xml"), "utf8");
    for (const c of SHOWN) expect(sm).toContain("/menu/" + c + "/</loc>");
    expect(sm).not.toContain("prazna-kategoria");
    for (const c of GONE) expect(sm, c).not.toContain("/menu/" + c + "/");
    const rd = JSON.parse(fs.readFileSync(path.join(dir, "redirects.json"), "utf8"));
    expect(rd["/menu/pitsi/"]).toBe("/menu/");
    expect(rd["/menu/ribni-yastia/lavrak-file-s-maslo-i/"]).toBe("/menu/ribni-yastia/lavrak-file-s-maslo-i-chesan/");
  });

  it("no public page links to a category the menu does not have, nor to the empty one", () => {
    for (const f of htmlFiles()) {
      const h = fs.readFileSync(f, "utf8"), rel = path.relative(dir, f);
      expect(h, rel).not.toMatch(/href="\/menu\/prazna-kategoria\//);
      for (const c of GONE) expect(h, rel + " -> " + c).not.toMatch(new RegExp('href="/menu/' + c + '/'));
    }
  });

  it("/menu/: the categories of the data, no breakfast segment, no pizza line", () => {
    const h = page("menu");
    for (const c of SHOWN) expect(h, c).toContain('id="c-' + c + '"');
    expect(h).not.toContain('id="c-prazna-kategoria"');
    expect(h).not.toContain('data-menu="bf"');
    expect(h).not.toContain("Пица на пещ и скара на дървени въглища.</p>");
    expect(h).not.toContain("пица, моцарела, бурата");
    expect(h).toMatch(/<meta name="description" content="Менюто на Siracusa в Дружба 2: 6 ястия\./);
  });

  it("home and Bertha: the oven stays, its dish count and category link go", () => {
    const home = page("");
    expect(home).toContain("Фурната Bertha");
    expect(home).not.toContain("ястия от скарата в менюто");
    expect(home).toContain(salmon.n); /* the popular rail falls back to the hits of the menu */
    const b = page("furna-bertha");
    expect(b).not.toContain("Кебапчета, ребра и стекове");
    expect(b).not.toContain("Кои ястия се приготвят в Bertha?");
    expect(b).toMatch(/<section class="sec rv anchor" id="yastia"[^>]* hidden/);
  });

  it("the dish page: the photo (first screen, not lazy), the description, JSON-LD image; no 3D for a photo", () => {
    const h = page("menu/ribni-yastia/syomga-na-skara");
    const img = /<div class="pic"><img [^>]*>/.exec(h)?.[0] || "";
    expect(img).toContain('src="' + salmon.photo + '"');
    expect(img).toContain('alt="' + salmon.n + '"');
    expect(img).toMatch(/width="\d+" height="\d+"/);
    expect(img).toContain('fetchpriority="high"');
    expect(img).not.toContain('loading="lazy"');
    expect(h).toContain('<p class="desc">' + salmon.desc + "</p>");
    expect(h).not.toContain("[ЛИПСВА: описание на ястието");
    expect(h).not.toContain("data-3d");
    expect(h).toContain('"image":"https://siracusa-sofia.com' + salmon.photo + '"');
    /* without a photo: the illustration and the [ЛИПСВА] description, as before */
    const l = page("menu/ribni-yastia/lavrak-file-s-maslo-i-chesan");
    expect(l).toMatch(/<div class="pic\s*" role="img" aria-label="[^"]*илюстрация[^"]*"><svg/);
    expect(l).toContain("[ЛИПСВА: описание на ястието");
  });

  it("cards: the photo in place of the illustration, lazy below the first screen", () => {
    const c = page("menu/sladko");
    expect(c).toMatch(/<div class="pic\s*"><img src="\/media\/[a-f0-9]{64}\.png" alt="Шоколадово суфле" width="600" height="600" decoding="async" loading="lazy">/);
    /* the category hero: the photo on the plate (first screen), no spinning illustration */
    expect(c).toMatch(/<div class="ch-spin ph" aria-hidden="true"><img [^>]*alt="" [^>]*fetchpriority="high">/);
    /* a card with a photo never gets data-art (the browser would draw the illustration over it) */
    for (const f of htmlFiles()) expect(fs.readFileSync(f, "utf8"), path.relative(dir, f)).not.toMatch(/data-art="(syomga-na-skara|shokoladov-sufle)"/);
  });

  it("no add-ons on the menu (no \"Добавки\" category): a burger does not offer them", () => {
    const h = page("menu/burgeri/klasicheski-burger");
    expect(h).not.toContain("сирене, прошуто, гъби");
    expect(h).toContain("Махнете съставка, която не искате. Безплатно.");
  });

  it("the shared runtime stays under its budget", () => {
    const a = path.join(dir, "_astro");
    const sc = fs.readdirSync(a).filter((f) => /^sc\.[\w-]+\.js$/.test(f));
    expect(sc.length).toBe(1);
    expect(fs.statSync(path.join(a, sc[0])).size).toBeLessThanOrEqual(30000);
  });
  /* the admin's text never runs as a script on the site (round 1 of the flows review of part 2): JSON-LD and every field */
  it("text from the menu editor stays text: no markup from the data in any page", () => {
    for (const f of htmlFiles()) {
      /* inside a quoted attribute ("content", "alt", "aria-label") "<" is only text: those are taken out first */
      const h = fs.readFileSync(f, "utf8").replace(/\s[\w-]+="[^"]*"/g, "");
      expect(h.includes("<img src=x onerror"), f).toBe(false);
      expect(/<\/script><img/.test(h), f).toBe(false);
    }
  });
});
