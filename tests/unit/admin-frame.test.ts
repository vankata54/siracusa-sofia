/* The admin frame (stage C, part 1): its data stay equal to the core (section names, roles), every section key has an
   address, and the addresses come from one place (src/admin/routes.ts). */
import { describe, it, expect } from "vitest";
import { SECTIONS, DEFAULT_ROLES } from "../../src/core/index.ts";
import { SEC, GROUPS, APPS, ROLES, SOON, secHref } from "../../src/admin/sections.ts";
import { aurl } from "../../src/admin/routes.ts";

describe("admin frame: data and addresses", () => {
  it("the sections and their names are those of SECTIONS (src/core/staff.ts)", () => {
    expect(Object.keys(SEC).sort()).toEqual(SECTIONS.map((s) => s[0]).sort());
    for (const [k, n] of SECTIONS) expect(SEC[k].n, k).toBe(n);
    /* every section of the bar is in a group exactly once; the staff apps are their own group */
    const inGroups = GROUPS.flatMap((g) => g[1]);
    expect(new Set(inGroups).size).toBe(inGroups.length);
    expect([...inGroups, ...APPS].sort()).toEqual(SECTIONS.map((s) => s[0]).sort());
  });
  it("the roles and their descriptions are those of DEFAULT_ROLES", () => {
    expect(Object.keys(ROLES).sort()).toEqual(DEFAULT_ROLES.map((r) => r.id).sort());
    for (const r of DEFAULT_ROLES) expect(ROLES[r.id], r.id).toEqual({ n: r.n, desc: r.desc });
  });
  it("the addresses: /admin/vhod/, /admin/, /admin/<key>/, /admin/preview/ and the staff modules", () => {
    expect(aurl.login()).toBe("/admin/vhod/");
    expect(aurl.login("/admin/notes/#s=new")).toBe("/admin/vhod/#next=" + encodeURIComponent("/admin/notes/#s=new"));
    expect(aurl.home()).toBe("/admin/");
    expect(aurl.section("roles")).toBe("/admin/roles/");
    expect(aurl.section("dashboard")).toBe("/admin/");
    expect(aurl.preview("m=site&p=home&d=phone")).toBe("/admin/preview/#m=site&p=home&d=phone");
    expect([aurl.app("waiter"), aurl.app("kitchen"), aurl.app("driver")]).toEqual(["/servitor/", "/kuhnya/", "/shofyor/"]);
    expect(secHref("site")).toBe("/admin/#modules");
    expect(secHref("orders", "n=1042")).toBe("/admin/orders/#n=1042");
  });
  it("#next= takes only an admin address (never another site or the sign-in itself)", () => {
    expect(aurl.fromLogical("/admin/notes/#s=new")).toBe("/admin/notes/#s=new");
    expect(aurl.fromLogical("/admin/")).toBe("/admin/");
    expect(aurl.fromLogical("/admin/vhod/")).toBeNull();
    expect(aurl.fromLogical("https://example.com/admin/")).toBeNull();
    expect(aurl.fromLogical("//example.com/admin/")).toBeNull();
    expect(aurl.fromLogical("/menu/")).toBeNull();
    expect(aurl.keyOf("/admin/roles/")).toBe("roles");
    expect(aurl.keyOf("/admin/")).toBe("dashboard");
    expect(aurl.fromLogical("/kuhnya/")).toBe("/kuhnya/");
    expect(aurl.keyOf("/kuhnya/")).toBe("kitchen");
  });
  it("every section with a screen has an address until its page comes (\"Скоро\")", () => {
    const keys = SOON.map((s) => s[0]);
    for (const k of Object.keys(SEC)) if (!["dashboard", "site", "finance", ...APPS].includes(k)) expect(keys, k).toContain(k);
    expect(keys).toContain("preview");
  });
});
