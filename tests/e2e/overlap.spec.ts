import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/* Поли 15.11: the floating elements never sit on a link or button of the page, and the logo never touches the buttons
   of the top bar. Real phone sizes (360 and 390, no zoom), scrolled down step by step:
   1. the assistant (.aifab) and the toast never cover a target (the assistant fades out where it would: .dodge);
   2. the bottom nav covers nothing once the page is scrolled (it slides away while scrolling down: html.navaway);
   3. the bars that stay (the action bar, the cookie banner, the nav on the first screen): every target they cover at
      one step is completely free at another step (nothing stays hidden), and at the end of the page nothing is covered.
   A target is covered when elementFromPoint at its center or at a corner (2 px inside) hits a floating element. */

const PAGES = ["/", "/sabitia/", "/menu/", "/kolichka/", "/menu/pitsi/pitsa-s-burata-i-proshuto-krudo/"];
const SIZES = [{ width: 360, height: 740 }, { width: 390, height: 844 }];
const STEP = 240;          // px per step
const MAX_SCROLL = 7000;   // the menu is 25 000 px of the same cards: the first 7 000 and then the end are enough
const CART = { mode: "delivery", lines: [
  { key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 },
  { key: "l-lazanya-boloneze", id: "l-lazanya-boloneze", q: 2, mods: [], extra: 0 },
] };

type Hit = { k: string; name: string; by: string };
type Probe = { y: number; max: number; covered: Hit[]; free: string[] };

/* all the targets of <main> on the screen: which are covered (and by what), which are completely free */
function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const FL = ".nav, .aifab, .abar, .toast, .cookie";
    const w = window as Window & { __ovk?: number };
    const covered: Hit[] = [], free: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("main :is(a[href], button, input, select, textarea, summary, [role=button])")) {
      const q = el.getBoundingClientRect();
      if (!q.width || !q.height || q.bottom <= 0 || q.top >= innerHeight || q.right <= 0 || q.left >= innerWidth) continue;
      if (getComputedStyle(el).visibility === "hidden" || el.closest("[hidden], [inert]")) continue;
      if (!el.dataset.ovk) el.dataset.ovk = String((w.__ovk = (w.__ovk || 0) + 1));
      const pts = [[(q.left + q.right) / 2, (q.top + q.bottom) / 2], [q.left + 2, q.top + 2], [q.right - 2, q.top + 2], [q.left + 2, q.bottom - 2], [q.right - 2, q.bottom - 2]];
      /* free: on the screen from top to bottom (a card in a side rail may stay partly to the right), no point on a floating
         element and the center on the target itself (the corners of a round button are outside it) */
      let by = "", all = q.top >= 0 && q.bottom <= innerHeight;
      for (const [x, y] of pts) {
        if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
        const hit = document.elementFromPoint(x, y);
        const f = hit?.closest<HTMLElement>(FL);
        if (f && !el.contains(hit)) { by = f.classList[0]; break; }
        if (x === pts[0][0] && y === pts[0][1] && !(hit && el.contains(hit))) all = false;
      }
      const name = (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().replace(/\s+/g, " ").slice(0, 40);
      if (by) covered.push({ k: el.dataset.ovk, name, by });
      else if (all) free.push(el.dataset.ovk);
    }
    const max = document.scrollingElement!.scrollHeight - innerHeight;
    return { y: Math.round(scrollY), max, covered, free };
  });
}

/* the bars, the assistant and the reveal of the sections settle (transitions and the 150 ms check after the scroll) */
async function settle(page: Page) {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => document.getAnimations().every((a) => !(a instanceof CSSTransition) || a.playState !== "running"), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(200);
}

async function scan(page: Page) {
  const steps: Probe[] = [];
  for (let i = 0; ; i++) {
    await settle(page);
    const p = await probe(page);
    steps.push(p);
    if (p.y >= p.max - 1) break;
    if (p.y >= MAX_SCROLL) {
      await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
      continue;
    }
    await page.evaluate((s) => window.scrollBy(0, s), STEP);
  }
  return steps;
}

function verdict(steps: Probe[]) {
  const bad: string[] = [];
  const free = new Set(steps.flatMap((s) => s.free));
  const stays = new Map<string, Hit & { y: number }>();
  steps.forEach((s, i) => {
    for (const h of s.covered) {
      const at = "y=" + s.y + ": " + h.name + " <- ." + h.by;
      if (h.by === "aifab" || h.by === "toast") bad.push(at);
      else if (h.by === "nav" && i > 0) bad.push(at);
      else stays.set(h.k, { ...h, y: s.y });
    }
  });
  for (const h of stays.values()) if (!free.has(h.k)) bad.push("never free: " + h.name + " <- ." + h.by + " (y=" + h.y + ")");
  const end = steps[steps.length - 1];
  for (const h of end.covered) bad.push("at the end: " + h.name + " <- ." + h.by);
  return Array.from(new Set(bad));
}

for (const size of SIZES) {
  test.describe(size.width + " px", () => {
    test.use({ viewport: size, isMobile: true, hasTouch: true });
    test.beforeEach(({}, info) => { test.skip(info.project.name !== "phone", "phone sizes only"); });

    for (const path of PAGES) {
      test("floating elements never cover a link or button: " + path, async ({ page }) => {
        test.setTimeout(120_000);
        await page.addInitScript(([c]) => {
          try { localStorage.setItem("sc-cookie", '"min"'); localStorage.setItem("sc-cart", JSON.stringify(c)); } catch { /* ignore */ }
        }, [CART]);
        await page.goto(path + "?preview=1&t=12:30");
        await expect(page.locator("main")).toBeVisible();
        const steps = await scan(page);
        expect(steps.length).toBeGreaterThan(path === "/kolichka/" ? 1 : 5);
        expect(verdict(steps)).toEqual([]);
      });
    }

    test("the cookie banner on the first visit hides nothing for good: /", async ({ page }) => {
      test.setTimeout(120_000);
      await page.goto("/?preview=1&t=12:30");
      await expect(page.locator(".cookie")).toBeVisible();
      expect(verdict(await scan(page))).toEqual([]);
    });

    test("top bar: the logo at least 8 px from the buttons; „Обади се“ is a 48 px phone icon", async ({ page }) => {
      await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
      for (const path of ["/", "/sabitia/"]) {
        await page.goto(path);
        await topBar(page);
      }
    });
  });
}

/* the full bar (logo, "Обади се", BG, "Още"), in any size */
async function topBar(page: Page) {
  const top = page.locator("header.top:not(.back)").filter({ has: page.locator(".word") }).first();
  const m = await top.evaluate((t) => {
    const word = t.querySelector(".word")!.getBoundingClientRect();
    const first = Array.from(t.querySelectorAll(".dnav a, .hact > *")).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0).sort((a, b) => a.left - b.left)[0];
    const call = t.querySelector<HTMLElement>(".hb.call")!, c = call.getBoundingClientRect();
    return { gap: first.left - word.right, w: c.width, h: c.height, text: call.textContent!.trim(), svg: !!call.querySelector("svg") };
  });
  expect(m.gap, "logo to the first button").toBeGreaterThanOrEqual(8);
  expect(m).toMatchObject({ text: "", svg: true });
  expect(m.w).toBeGreaterThanOrEqual(48);
  expect(m.h).toBeGreaterThanOrEqual(48);
  const call = top.getByRole("link", { name: "Обади се", exact: true });
  await expect(call).toHaveAttribute("href", "tel:+359894365577");
  await expect(call).toBeVisible();
  const axe = await new AxeBuilder({ page }).include("header.top").withRules(["label-content-name-mismatch", "link-name", "button-name", "target-size"]).analyze();
  expect(axe.violations.map((v) => v.id + ": " + v.nodes.map((n) => n.target.join(" ")).join(", "))).toEqual([]);
}

test("top bar on the computer: the logo at least 8 px from the buttons; „Обади се“ is a 48 px phone icon", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "1440 only");
  await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
  await page.goto("/");
  await topBar(page);
});
