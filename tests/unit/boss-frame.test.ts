/* The modules "Управител" and "Собственик" (stage D, step 6): their addresses in #next=, who may open what after the
   sign-in, the home of a role, and the data of the dashboard (no DOM: src/admin/routes.ts, src/modules/boss/home.ts,
   src/admin/sections.ts). The frame itself is checked in tests/e2e/boss-frame.spec.ts. */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import { DEFAULT_ROLES } from "../../src/core/index.ts";
import { aurl, BOSS_ROLES, BOSS_HOME } from "../../src/admin/routes.ts";
import { murl } from "../../src/modules/routes.ts";
import { MODULES, MOD_SCREENS } from "../../src/admin/sections.ts";
import { mayOpen, homeHref, homeChoice, setHomeChoice, switchHome, bossAllowed, bossHref, bossModuleOf } from "../../src/modules/boss/home.ts";

const sections = (role: string) => DEFAULT_ROLES.find((r) => r.id === role)!.sections;
const may = (l: string, role: string) => mayOpen(l, role, sections(role));

describe("the modules of the manager and the owner: addresses and rights", () => {
  /* the device: a tiny localStorage for the remembered choice */
  beforeEach(() => {
    const m = new Map<string, string>();
    (globalThis as unknown as { localStorage: unknown }).localStorage = { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); } };
  });

  it("#next= knows the module addresses (one screen below, parameters in #), and nothing else", () => {
    expect(aurl.fromLogical("/upravitel/")).toBe("/upravitel/");
    expect(aurl.fromLogical("/upravitel/zalata/#t=12")).toBe("/upravitel/zalata/#t=12");
    expect(aurl.fromLogical("/sobstvenik/tendentsii/#p=30&c=year")).toBe("/sobstvenik/tendentsii/#p=30&c=year");
    expect(aurl.fromLogical("/servitor/masa/#12")).toBe("/servitor/masa/#12");
    expect(aurl.keyOf("/upravitel/ekipat/")).toBe("upravitel");
    expect(aurl.keyOf("/sobstvenik/")).toBe("sobstvenik");
    expect(aurl.keyOf("/shofyor/dostavka/#1042")).toBe("driver");
    for (const bad of ["/upravitel", "/upravitel/a/b/", "/upravitel/../admin/", "//example.com/upravitel/", "https://example.com/sobstvenik/", "/sobstvenik/?x=1", "/masa/abcd1234/", "/upravitel/ x/"]) expect(aurl.fromLogical(bad), bad).toBeNull();
    /* the same addresses as the one place for the modules */
    expect(aurl.fromLogical("/upravitel/oshte/")).toBe(murl.upravitel("oshte"));
    expect(aurl.fromLogical("/sobstvenik/reshenia/")).toBe(murl.sobstvenik("reshenia"));
  });

  it("who opens which module: the manager his own, the owner and the main admin both, nobody else", () => {
    expect(BOSS_ROLES).toEqual({ upravitel: ["admin", "owner", "manager"], sobstvenik: ["admin", "owner"] });
    expect(BOSS_HOME).toEqual({ manager: "upravitel", owner: "sobstvenik" });
    expect(["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"].map((r) => bossAllowed("upravitel", r))).toEqual([true, true, true, false, false, false, false]);
    expect(["admin", "owner", "manager", "waiter", "kitchen", "driver", "marketing"].map((r) => bossAllowed("sobstvenik", r))).toEqual([true, true, false, false, false, false, false]);
    expect([bossModuleOf("manager"), bossModuleOf("owner"), bossModuleOf("admin"), bossModuleOf("waiter")]).toEqual(["upravitel", "sobstvenik", null, null]);
    expect([bossHref("upravitel"), bossHref("sobstvenik", "st=x")]).toEqual(["/upravitel/", "/sobstvenik/#st=x"]);
  });

  it("#next= after the sign-in: only an address the role may open", () => {
    expect(may("/upravitel/zalata/", "manager")).toBe(true);
    expect(may("/sobstvenik/", "manager")).toBe(false);
    expect(may("/sobstvenik/finansi/", "owner")).toBe(true);
    expect(may("/upravitel/", "owner")).toBe(true);
    expect(may("/sobstvenik/", "admin")).toBe(true);
    expect(may("/upravitel/", "marketing")).toBe(false);
    /* the sections of the admin as before: what the role sees, the dashboard, the preview */
    expect(may("/admin/orders/", "manager")).toBe(true);
    expect(may("/admin/roles/", "manager")).toBe(false);
    expect(may("/admin/audit/", "manager")).toBe(false);
    expect(may("/admin/roles/", "admin")).toBe(true);
    expect(may("/admin/", "marketing")).toBe(true);
    expect(may("/admin/preview/#m=site", "marketing")).toBe(true);
    expect(may("/kuhnya/", "owner")).toBe(true);
    /* a staff member: only the own module */
    expect(may("/servitor/gotovi/", "waiter")).toBe(true);
    expect(may("/kuhnya/", "waiter")).toBe(false);
    expect(may("/upravitel/", "waiter")).toBe(false);
    expect(may("/admin/orders/", "waiter")).toBe(false);
    /* never the sign-in itself or another site */
    for (const bad of ["/admin/vhod/", "https://example.com/admin/", "//example.com/", "/menu/", ""]) expect(may(bad, "admin"), bad).toBe(false);
  });

  it("the choice is remembered per user on the device and follows the person only when it is remembered", () => {
    expect(homeChoice("manager")).toBeNull();
    switchHome("manager", "app");
    expect(homeChoice("manager")).toBeNull();
    setHomeChoice("manager", "admin");
    expect(homeChoice("manager")).toBe("admin");
    expect(homeChoice("owner")).toBeNull();
    switchHome("manager", "app");
    expect(homeChoice("manager")).toBe("app");
    expect(JSON.parse(localStorage.getItem("sa-home")!)).toEqual({ manager: "app" });
    setHomeChoice("manager", null);
    expect(homeChoice("manager")).toBeNull();
    /* a broken value on the device never breaks the sign-in */
    localStorage.setItem("sa-home", "[1,2");
    expect(homeChoice("manager")).toBeNull();
    localStorage.setItem("sa-home", JSON.stringify({ manager: "elsewhere" }));
    expect(homeChoice("manager")).toBeNull();
  });

  it("the home of a role that may not open a page", () => {
    expect([homeHref("waiter", "waiter"), homeHref("kitchen", "kitchen"), homeHref("driver", "driver")]).toEqual(["/servitor/", "/kuhnya/", "/shofyor/"]);
    expect(homeHref("marketing", "marketing")).toBe("/admin/");
    /* the manager: the dashboard, the module only when he chose it on this device */
    expect(homeHref("manager", "manager")).toBe("/admin/");
    setHomeChoice("manager", "app");
    expect(homeHref("manager", "manager")).toBe("/upravitel/");
    setHomeChoice("manager", "admin");
    expect(homeHref("manager", "manager")).toBe("/admin/");
  });

  it("the dashboard: both modules are real, with the four screens of the approved prototypes and a page for each", () => {
    const m = MODULES.find((x) => x.id === "manager")!, o = MODULES.find((x) => x.id === "owner")!;
    expect([m.soon, o.soon]).toEqual([undefined, undefined]);
    expect(m.roles).toEqual(["owner", "manager"]); expect(o.roles).toEqual(["owner"]);
    expect(m.screens).toEqual(MOD_SCREENS.manager.map((s) => s[0]));
    expect(o.screens).toEqual(MOD_SCREENS.owner.map((s) => s[0]));
    expect(MOD_SCREENS.manager.map((s) => s[1])).toEqual(["Сега", "Залата", "Екипът", "Още"]);
    expect(MOD_SCREENS.owner.map((s) => s[1])).toEqual(["Днес", "Тенденции", "Финанси и гориво", "Решения"]);
    for (const [, , path] of [...MOD_SCREENS.manager, ...MOD_SCREENS.owner]) {
      expect(aurl.fromLogical(path), path).toBe(path);
      expect(fs.existsSync("src/pages" + path + "index.astro"), path).toBe(true);
    }
  });
});
