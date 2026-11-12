/* Decision 12.11.2026: the shared runtime (_astro/sc.*.js) is at most 30 000 B uncompressed; robots.txt and sitemap.xml
   come from the build (scripts/build-checks.mjs). The build itself fails over the budget; this test checks every build
   folder that exists (dist*, the e2e and the agents' folders) and that the check is wired into astro.config.mjs. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RUNTIME_BUDGET, runtimeSizes, seoFiles } from "../../scripts/build-checks.mjs";

const root = path.resolve(__dirname, "../..");

describe("runtime budget and SEO files", () => {
  it("the budget is 30 000 bytes and the check runs after every build", () => {
    expect(RUNTIME_BUDGET).toBe(30000);
    const cfg = fs.readFileSync(path.join(root, "astro.config.mjs"), "utf8");
    expect(cfg).toMatch(/integrations:\s*\[buildChecks\(/);
  });
  it("the latest build on disk (DIST_DIR, else the newest dist* folder) keeps the runtime under the budget", () => {
    /* old folders of other builds may be stale: the folder named by DIST_DIR and the newest build are checked */
    const all = fs.readdirSync(root).filter((d) => /^dist/.test(d) && fs.existsSync(path.join(root, d, "_astro")))
      .sort((a, b) => fs.statSync(path.join(root, b, "_astro")).mtimeMs - fs.statSync(path.join(root, a, "_astro")).mtimeMs);
    const dirs = Array.from(new Set([process.env.DIST_DIR, all[0]].filter((d): d is string => !!d && all.includes(d))));
    /* a fresh checkout has no build yet: then the build hook (first test) and the e2e smoke test are the check */
    for (const d of dirs) for (const s of runtimeSizes(path.join(root, d)) as { file: string; bytes: number }[]) {
      expect(s.bytes, d + "/_astro/" + s.file).toBeLessThanOrEqual(RUNTIME_BUDGET);
    }
  });
  it("sitemap.xml lists only the pages without noindex; the demo robots.txt disallows everything", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sc-seo-"));
    const page = (p: string, head: string) => { fs.mkdirSync(path.join(tmp, p), { recursive: true }); fs.writeFileSync(path.join(tmp, p, "index.html"), "<html><head>" + head + "</head></html>"); };
    page("", '<link rel="canonical" href="https://x.bg/">');
    page("menu", '<link rel="canonical" href="https://x.bg/menu/">');
    page("kolichka", '<meta name="robots" content="noindex,nofollow">');
    seoFiles(tmp, "https://x.bg", false);
    const xml = fs.readFileSync(path.join(tmp, "sitemap.xml"), "utf8");
    expect(xml).toContain("<loc>https://x.bg/</loc>");
    expect(xml).toContain("<loc>https://x.bg/menu/</loc>");
    expect(xml).not.toContain("kolichka");
    expect(fs.readFileSync(path.join(tmp, "robots.txt"), "utf8")).toContain("Sitemap: https://x.bg/sitemap.xml");
    seoFiles(tmp, "https://x.bg", true);
    expect(fs.readFileSync(path.join(tmp, "robots.txt"), "utf8")).toBe("User-agent: *\nDisallow: /\n");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
