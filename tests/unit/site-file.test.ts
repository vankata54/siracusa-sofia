/* The site data in the rebuild (scripts/site-file.mjs, SITE_FILE): the generated modules give the pages exactly what the
   source files give with the same data, so the first rebuild after a change in the admin starts from the same site. */
import { describe, it, expect, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { siteModule, SITE_MODULES } from "../../scripts/site-file.mjs";
import { createCore, MemoryRepo } from "../../src/core/index.ts";
import { ZONES } from "../../src/lib/zones-data.ts";
import { TABLES } from "../../src/lib/tables.ts";
import { events, EVENT_SLUGS } from "../../src/lib/events.ts";
import { EVENT_EXTRA } from "../../src/lib/events-extra.ts";
import { OFFER_OFF } from "../../src/lib/offers-data.ts";
import { buildOf, defaultSections } from "../../src/core/site-data.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sc-site-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const STATUS = pathToFileURL(path.resolve("src/lib/status.ts")).href;
let n = 0;
async function load(suffix: string, site: unknown) {
  const f = path.join(dir, "m" + ++n + ".ts");
  fs.writeFileSync(f, siteModule(suffix, site, STATUS)!);
  return import(pathToFileURL(f).href);
}

describe("site file: the generated modules", () => {
  it("covers exactly the modules the plugin replaces", () => {
    expect(SITE_MODULES).toEqual(["/src/lib/zones-data.ts", "/src/lib/tables.ts", "/src/lib/events.ts", "/src/lib/events-all.ts", "/src/lib/events-extra.ts", "/src/lib/offers-data.ts"]);
    expect(siteModule("/src/lib/consts.ts", {})).toBeNull();
  });
  it("with the data of a fresh database = the source files (zones, tables, events on several days, extra, offers)", async () => {
    const site = await createCore({ repo: new MemoryRepo() }).site.build();
    expect((await load("/src/lib/zones-data.ts", site)).ZONES).toEqual(ZONES);
    expect((await load("/src/lib/tables.ts", site)).TABLES).toEqual(TABLES);
    expect((await load("/src/lib/events-extra.ts", site)).EVENT_EXTRA).toEqual(EVENT_EXTRA);
    expect((await load("/src/lib/offers-data.ts", site)).OFFER_OFF).toEqual(OFFER_OFF);
    for (const m of ["/src/lib/events.ts", "/src/lib/events-all.ts"]) {
      const ev = await load(m, site);
      expect(ev.EVENT_SLUGS).toEqual(EVENT_SLUGS);
      for (const d of ["2026-11-16T10:00:00", "2026-11-28T23:00:00", "2026-11-29T01:00:00", "2026-12-31T12:00:00", "2027-02-27T12:00:00"]) expect(ev.events(new Date(d))).toEqual(events(new Date(d)));
    }
  });
  it("events with dates: all in events-all (the monthly evening first, then by date), only the monthly one in the runtime", async () => {
    const s = defaultSections();
    s.events.rows.push(
      { ...s.events.rows[0], id: "a", n: "А", recur: null, date: "2026-12-05", priceMode: "price", price: 25, prog: "x", menu: "y", seats: 6 },
      { ...s.events.rows[0], id: "b", n: "Б", recur: null, date: "2026-11-01", priceMode: "free" },
      { ...s.events.rows[0], id: "c", n: "В", recur: null, date: "2026-12-01", status: "draft" },
    );
    const site = buildOf(s);
    const ev = await load("/src/lib/events-all.ts", site);
    const list = ev.events(new Date("2026-11-16T12:00:00"));
    expect(list.map((e: { id: string }) => e.id)).toEqual(["gratska-vecher", "b", "a"]);
    expect(list[2]).toMatchObject({ price: 25, free: false, seatsLeft: 6, note: "" });
    expect(list[2].date).toEqual(new Date(2026, 11, 5));
    expect(list[1]).toMatchObject({ free: true, note: "[ЛИПСВА: програма и меню]" });
    expect(ev.EVENT_SLUGS).toEqual(["gratska-vecher", "b", "a"]);
    const rt = await load("/src/lib/events.ts", site);
    expect(rt.EVENT_SLUGS).toEqual(["gratska-vecher"]);
    expect(rt.events(new Date("2026-11-16T12:00:00"))).toEqual(events(new Date("2026-11-16T12:00:00")));
    expect((await load("/src/lib/events-extra.ts", site)).EVENT_EXTRA).toEqual({ a: { prog: "x", menu: "y" } });
  });
});
