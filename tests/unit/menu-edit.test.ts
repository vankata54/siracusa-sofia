import { PIN_FAILS_DAY } from "../../src/core/lunch.ts";
import { describe, it, expect, afterAll } from "vitest";
import { createCore, MemoryRepo, type Ctx, type Hasher } from "../../src/core/index.ts";
import { builtinMenu, cleanMenu, finalize, menuChanges } from "../../src/core/menu-edit.ts";
import { scryptHasher } from "../../server/hasher.ts";
import { byId, removedById, items, cats, catById, takesAddons, MENU_LUNCH_DATE, lunch as lunchItems } from "../../src/lib/data.ts";
import { parseMods, price } from "../../src/lib/pricing.ts";
import { MENU, type Menu } from "../../src/data/menu.ts";
import * as TS from "../../src/lib/slug.ts";
/* the build's copy of the rule (plain .mjs) */
import * as JS from "../../scripts/slug.mjs";

/* The menu editor (decisions 15.11.2026): one shared draft with a version, 409, validation, slug, publish / rollback,
   setMenu (prices and "Добави" after publish), a removed dish in an order; the lunch menu: the rule, the PIN. */
const fast: Hasher = { async hash(p) { return { salt: "s", hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const NOW = new Date("2026-11-16T10:00:00Z"); /* Monday, 12:00 in Sofia */
function mk(extra: Partial<Ctx> = {}) {
  const menus: Menu[] = [];
  const core = createCore({ repo: new MemoryRepo(), hasher: fast, now: () => NOW, clock: "12:00", onMenu: (m) => { menus.push(m); }, ...extra });
  return { core, menus };
}
async function as(core: ReturnType<typeof mk>["core"], role: "admin" | "owner" | "manager" | "waiter" | "kitchen" | "marketing", name: string = role) {
  await core.staff.upsert({ username: name, name, role, password: "test-password-123" });
  const { token } = await core.staff.login(name, "test-password-123");
  return core.staff.guard(token);
}
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

afterAll(async () => { await mk().core.menuEdit.boot(); }); /* the built-in menu back into src/lib/data.ts */

describe("slug: src/lib/slug.ts = scripts/slug.mjs", () => {
  it("the same transliteration, cut and uniqueness for every name of the menu", () => {
    const all = [...MENU.items, ...MENU.lunch.items].map((x) => ({ id: x.id, n: x.n }));
    for (const x of all) {
      expect(TS.translit(x.n)).toBe(JS.translit(x.n));
      expect(TS.slugify(x.n)).toBe(JS.slugify(x.n));
      expect(TS.slugify(x.n, 30)).toBe(JS.slugify(x.n, 30));
    }
    expect([...TS.assignSlugs(all).entries()]).toEqual([...JS.assignSlugs(all).entries()]);
    expect(TS.SLUG_MAX).toBe(JS.SLUG_MAX);
    for (const n of ["Щрудел с ябълки, сладолед & сметана", "  Crème brûlée  ", "Брускети със семена, прошуто Крудо, филаделфия мус, сушен домат, трюфел, още"]) expect(TS.slugify(n)).toBe(JS.slugify(n));
  });
  it("a new id never takes an id or an address in use", () => {
    expect(TS.newSlug("Пица Дяволо", new Set(["pitsa-dyavolo"]))).toBe("pitsa-dyavolo-2");
    expect(TS.newSlug("Пица Дяволо", new Set(["pitsa-dyavolo", "pitsa-dyavolo-2"]))).toBe("pitsa-dyavolo-3");
    expect(TS.newSlug("???", new Set())).toBe("yastie");
    expect(TS.newSlug("а ".repeat(60), new Set()).length).toBeLessThanOrEqual(72);
  });
});

describe("menu editor: draft, 409, validation", async () => {
  const { core } = mk();
  const admin = await as(core, "admin");

  it("no draft: the live (built-in) menu, version 0, no changes, opts by default", async () => {
    const d = await core.menuEdit.getDraft(admin);
    expect(d.version).toBe(0);
    expect(d.changes.count).toBe(0);
    expect(d.menu.items).toHaveLength(127);
    expect(d.menu.opts!.addon.cats).toEqual(["pitsi", "burgeri"]);
    expect(d.menu.removed).toEqual([]);
  });
  it("save: the version grows; an old version gets 409 'conflict' with a text for people", async () => {
    const d = await core.menuEdit.getDraft(admin);
    const m = clone(d.menu);
    m.items.find((x) => x.id === "pileshka-supa")!.p = 2.9;
    const a = await core.menuEdit.saveDraft(admin, m, d.version);
    expect(a.version).toBe(1);
    expect(a.changes.dishes.changed).toEqual([{ id: "pileshka-supa", n: "Пилешка супа", fields: [{ key: "p", label: "Цена", from: "2,70 €", to: "2,90 €" }] }]);
    await expect(core.menuEdit.saveDraft(admin, m, d.version)).rejects.toMatchObject({ code: "conflict", status: 409, message: "Някой друг промени черновата. Заредете я пак." });
    await expect(core.menuEdit.publish(admin, 0)).rejects.toMatchObject({ code: "conflict", status: 409 });
    const again = await core.menuEdit.getDraft(admin);
    expect(again.version).toBe(1);
    expect(again.changes.count).toBe(1);
    const off = await core.menuEdit.discardDraft(admin, 1);
    expect(off.version).toBe(2);
    expect(off.changes.count).toBe(0);
  });
  it("422 with fields: price with 2 decimals, name up to 120, a known category, tags, 14 allergens, a photo from the upload, unique ids", async () => {
    const d = await core.menuEdit.getDraft(admin);
    const m = clone(d.menu);
    const x = m.items[0];
    x.p = 2.355; x.n = "я".repeat(121);
    m.items[1].cat = "nyama-takava"; m.items[2].t = ["hit", "super" as never]; m.items[3].al = ["gluten", "pork" as never];
    m.items[4].photo = "https://evil.example/x.png";
    m.items.push(clone(m.items[5]));
    m.cats.push({ id: "new-c1", n: "", course: "main" });
    try { await core.menuEdit.saveDraft(admin, m, d.version); expect.unreachable(); }
    catch (e) {
      const f = (e as { fields: Record<string, string> }).fields;
      expect((e as { status: number }).status).toBe(422);
      expect(f["items." + x.id + ".p"]).toBe("Напишете цена като 10,22.");
      expect(f["items." + x.id + ".n"]).toBe("Името е до 120 знака.");
      expect(f["items." + m.items[1].id + ".cat"]).toBe("Изберете категория.");
      expect(f["items." + m.items[2].id + ".t"]).toBe("Непознат етикет.");
      expect(f["items." + m.items[3].id + ".al"]).toBe("Непознат алерген.");
      expect(f["items." + m.items[4].id + ".photo"]).toMatch(/Качете снимката отново/);
      expect(f["items." + m.items[5].id + ".id"]).toBe("Ястието е два пъти в менюто.");
      expect(f["cats.new-c1.n"]).toBe("Напишете името на категорията.");
    }
    /* the composition is optional: it never stops publishing; a photo from the upload is fine */
    const ok = clone(d.menu);
    ok.items[0].comp = ""; ok.items[0].photo = "/media/" + "a".repeat(64) + ".webp"; ok.items[0].p = 0;
    const r = await core.menuEdit.saveDraft(admin, ok, d.version);
    expect(r.changes.noComp.some((z) => z.id === ok.items[0].id)).toBe(true);
    /* "Откажи" needs the version on the screen: without it 422, an old one 409 */
    await expect(core.menuEdit.discardDraft(admin, undefined as never)).rejects.toMatchObject({ code: "invalid", status: 422 });
    await expect(core.menuEdit.discardDraft(admin, r.version - 1)).rejects.toMatchObject({ code: "conflict", status: 409 });
    await core.menuEdit.discardDraft(admin, r.version);
  });
  it("demo: a photo as a data: URL is allowed only in the demo", () => {
    const m = builtinMenu();
    m.items[0].photo = "data:image/png;base64,iVBORw0KGgo=";
    expect(cleanMenu(m, builtinMenu(), {}).fields["items." + m.items[0].id + ".photo"]).toBeTruthy();
    expect(cleanMenu(m, builtinMenu(), { demo: true }).fields).toEqual({});
  });
  it("rights: section 'Меню' (marketing and the kitchen have none)", async () => {
    const mkt = await as(core, "marketing"), kit = await as(core, "kitchen");
    await expect(core.menuEdit.getDraft(mkt)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(core.menuEdit.publishState(kit)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    const mgr = await as(core, "manager");
    expect((await core.menuEdit.getDraft(mgr)).version).toBeGreaterThan(0);
  });
});

describe("menu editor: publish, setMenu, removed dishes, rollback", async () => {
  const { core, menus } = mk();
  const admin = await as(core, "admin");

  it("publish: new dish and category get ids by the slug rule; prices, 'Добави', removed dishes reach src/lib/data.ts at once", async () => {
    const d = await core.menuEdit.getDraft(admin);
    const m = clone(d.menu);
    m.items.find((x) => x.id === "pitsa-margarita")!.p = 7.5;
    m.items = m.items.filter((x) => x.id !== "shkembe");
    m.items.find((x) => x.id === "tarator")!.cat = "studeni-predyastia"; /* moved: the old address leads to the new one */
    m.cats.push({ id: "new-c1", n: "Сезонно меню", course: "main" });
    m.items.push({ id: "new-d1", n: "Пица Дяволо", cat: "new-c1", course: "main", comp: "", g: "", p: 9.9, t: [], al: [], noOnion: false, share: false });
    m.opts!.addon.dishes = Object.fromEntries(Object.entries({ [m.items.find((x) => /^Гръцка/.test(x.n))!.id]: true, "pitsa-margarita": false, "new-d1": true }));
    const s = await core.menuEdit.saveDraft(admin, m, d.version);
    expect(s.changes.dishes.removed).toEqual([{ id: "shkembe", n: "Шкембе", cat: "supi", to: "/menu/supi/" }]);
    expect(s.changes.cats.added).toEqual([{ id: "new-c1", n: "Сезонно меню" }]);
    const p = await core.menuEdit.publish(admin, s.version);
    expect(p).toMatchObject({ mode: "server", version: 1, draft: { count: 0 }, prev: { version: 0 } });
    /* the server was told to rebuild */
    expect(menus).toHaveLength(1);
    const live = menus[0];
    const nd = live.items.find((x) => x.n === "Пица Дяволо" && x.cat !== "pitsi")!;
    expect(nd.id).toBe("pitsa-dyavolo-2"); /* never the id of the existing "Пица Дяволо" */
    expect(nd.slug).toBeUndefined();
    expect(live.cats.some((c) => c.id === "sezonno-menyu")).toBe(true);
    expect(nd.cat).toBe("sezonno-menyu");
    expect(live.opts!.addon.dishes["pitsa-dyavolo-2"]).toBe(true);
    expect(live.removed!.map((x) => x.id)).toEqual(["shkembe"]);
    expect(live.redirects).toMatchObject({ "/menu/supi/shkembe/": "/menu/supi/", "/menu/supi/tarator/": "/menu/studeni-predyastia/tarator/" });
    /* in this process */
    expect(byId["pitsa-margarita"].p).toBe(7.5);
    expect(byId.shkembe).toBeUndefined();
    expect(removedById.shkembe.n).toBe("Шкембе");
    expect(items.some((x) => x.id === "shkembe")).toBe(false);
    expect(catById["sezonno-menyu"].n).toBe("Сезонно меню");
    expect(price({ mode: "pickup", lines: [{ key: "a", id: "pitsa-margarita", q: 2, mods: [], extra: 0 }] }, { scheduled: true }).sub).toBe(15);
    /* "Добави": the dish wins over the category */
    const greek = items.find((x) => /^Гръцка/.test(x.n))!;
    expect(takesAddons(greek)).toBe(true);
    expect(takesAddons(byId["pitsa-margarita"])).toBe(false);
    expect(takesAddons(byId["pitsa-dyavolo"])).toBe(true);
    expect(parseMods(greek, ["+ Кашкавал"]).bad).toBeNull();
    expect(parseMods(byId["pitsa-margarita"], ["+ Кашкавал"]).bad).toBe("+ Кашкавал");
    /* a removed dish in a cart line: not counted, flagged */
    const pr = price({ mode: "pickup", lines: [{ key: "s", id: "shkembe", q: 1, mods: [], extra: 0 }, { key: "t", id: "tarator", q: 1, mods: [], extra: 0 }] }, { scheduled: true });
    expect(pr.rows.find((r) => r.x.id === "shkembe")).toMatchObject({ removed: true, out: true });
    expect(pr.n).toBe(1);
  });
  it("an order with a removed dish: 'removed' with the name and the line", async () => {
    try {
      await core.orders.create({ cart: { mode: "pickup", lines: [{ key: "t", id: "tarator", q: 1, mods: [], extra: 0 }, { key: "s", id: "shkembe", q: 1, mods: [], extra: 0 }] }, name: "Иван", phone: "0888123456", sched: "утре", slot: "12:00" });
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: "removed", status: 409, message: "Шкембе вече не е в менюто.", lines: ["shkembe"], fields: { "lines.1": "Шкембе вече не е в менюто." } });
    }
    const o = await core.orders.create({ cart: { mode: "pickup", lines: [{ key: "m", id: "pitsa-margarita", q: 1, mods: [], extra: 0 }] }, name: "Иван", phone: "0888123457", sched: "утре", slot: "12:00" });
    expect(o.sub).toBe(7.5);
    /* the public menu for the site and the staff: no removed dish in the lists, kept in `removed` */
    const site = await core.menuEdit.site();
    expect(site.items.some((x) => x.id === "shkembe")).toBe(false);
    expect(site.removed!.some((x) => x.id === "shkembe")).toBe(true);
    expect(site.items.find((x) => x.id === "pitsa-margarita")!.p).toBe(7.5);
  });
  it("back in the menu: the dish leaves `removed`, its address is a page again (no redirect)", async () => {
    const d = await core.menuEdit.getDraft(admin);
    const m = clone(d.menu);
    m.items.push({ ...m.removed!.find((x) => x.id === "shkembe")! });
    const s = await core.menuEdit.saveDraft(admin, m, d.version);
    expect(s.changes.dishes.added).toEqual([{ id: "shkembe", n: "Шкембе", cat: "supi" }]);
    await core.menuEdit.publish(admin, s.version);
    const live = menus[menus.length - 1];
    expect(live.removed!.some((x) => x.id === "shkembe")).toBe(false);
    expect(live.redirects!["/menu/supi/shkembe/"]).toBeUndefined();
    expect(byId.shkembe).toBeTruthy();
  });
  it("rollback: one step back with one call (409 for an old version), twice = forward again", async () => {
    const st = await core.menuEdit.publishState(admin);
    expect(st.version).toBe(2);
    await expect(core.menuEdit.rollback(admin, 1)).rejects.toMatchObject({ code: "conflict", status: 409 });
    const r = await core.menuEdit.rollback(admin, 2);
    expect(r.version).toBe(3);
    expect(byId.shkembe).toBeUndefined(); /* the menu of version 1 again */
    expect(removedById.shkembe).toBeTruthy();
    const back = await core.menuEdit.rollback(admin, 3);
    expect(back.version).toBe(4);
    expect(byId.shkembe).toBeTruthy();
    const log = await core.audit.list({ action: "menu." });
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(["menu.draft", "menu.publish", "menu.rollback"]));
    expect(log.every((e) => e.actor === "admin" && e.at)).toBe(true);
  });
  it("an emptied category: no page, not on the site; its old address leads to /menu/; it stays in the admin", async () => {
    const d = await core.menuEdit.getDraft(admin);
    const m = clone(d.menu);
    m.items = m.items.filter((x) => x.cat !== "sosove");
    const s = await core.menuEdit.saveDraft(admin, m, d.version);
    expect(s.changes.cats.empty.map((c) => c.id)).toContain("sosove");
    await core.menuEdit.publish(admin, s.version);
    const live = menus[menus.length - 1];
    expect(live.cats.some((c) => c.id === "sosove")).toBe(true);
    expect(live.redirects!["/menu/sosove/"]).toBe("/menu/");
    expect(Object.entries(live.redirects!).filter(([k]) => k.startsWith("/menu/sosove/") && k !== "/menu/sosove/").every(([, v]) => v === "/menu/")).toBe(true);
    expect(cats.some((c) => c.id === "sosove")).toBe(false);
    expect((await core.menuEdit.site()).cats.some((c) => c.id === "sosove")).toBe(false);
    expect((await core.menuEdit.getDraft(admin)).menu.cats.some((c) => c.id === "sosove")).toBe(true);
  });
  it("publish without changes: 422 'nothing'", async () => {
    const d = await core.menuEdit.getDraft(admin);
    await expect(core.menuEdit.publish(admin, d.version)).rejects.toMatchObject({ code: "nothing", status: 422, message: "Няма промени за публикуване." });
  });
  it("demo: publishState says mode 'demo'", async () => {
    const demo = mk({ demo: true }).core;
    expect((await demo.menuEdit.publishState(await as(demo, "admin"))).mode).toBe("demo");
  });
});

describe("finalize: redirect chains", () => {
  it("a dish moved twice: the first address leads straight to the last one", () => {
    const a = builtinMenu();
    const b = clone(a); b.items.find((x) => x.id === "tarator")!.cat = "salati";
    const b2 = finalize(b, a, "2026-11-16T10:00:00Z");
    const c = clone(b2); c.items.find((x) => x.id === "tarator")!.cat = "studeni-predyastia";
    const c2 = finalize(c, b2, "2026-11-16T11:00:00Z");
    expect(c2.redirects!["/menu/supi/tarator/"]).toBe("/menu/studeni-predyastia/tarator/");
    expect(c2.redirects!["/menu/salati/tarator/"]).toBe("/menu/studeni-predyastia/tarator/");
    expect(menuChanges(b2, c2).dishes.changed[0].fields[0]).toMatchObject({ key: "cat", from: "Салати" });
  });
  it("a removed dish with a cut id: both of its old addresses lead to the category", () => {
    const a = builtinMenu();
    const cut = a.items.find((x) => x.slug)!;
    const b = clone(a); b.items = b.items.filter((x) => x.id !== cut.id);
    const r = finalize(b, a, "2026-11-16T10:00:00Z").redirects!;
    expect(r["/menu/" + cut.cat + "/" + cut.slug + "/"]).toBe("/menu/" + cut.cat + "/");
    expect(r["/menu/" + cut.cat + "/" + cut.id + "/"]).toBe("/menu/" + cut.cat + "/");
  });
});

describe("lunch menu: schedule, the rule, publishing, the PIN", async () => {
  const { core } = mk({ hasher: scryptHasher });
  const boss = await as(core, "manager", "upr");
  const w = await as(core, "waiter", "srv");
  const adminS = await as(core, "admin", "adm");
  await core.staff.setRole("waiter", [...w.sections, "lunch"], "adm");
  const waiter = await core.staff.guard((await core.staff.login("srv", "test-password-123")).token);

  it("the same menu two days in a row stops publishing with a clear text", async () => {
    const v = await core.lunch.get(boss, "d1");
    expect(v.catalog.length).toBe(20);
    expect(v.boss).toBe(true);
    const ids = v.catalog.slice(0, 6).map((x) => x.id);
    await core.lunch.saveDay(boss, "d1", "2026-11-16", ids);
    await core.lunch.saveDay(boss, "d1", "2026-11-17", [...ids].reverse());
    try { await core.lunch.publish(boss, "d1", ["2026-11-17"]); expect.unreachable(); }
    catch (e) {
      expect(e).toMatchObject({ code: "same_menu", status: 422 });
      expect((e as Error).message).toBe("Същото меню като в понеделник, 16 ноември. Едно и също меню не може два поредни дни. Сменете поне едно ястие, за да го публикувате.");
      expect((e as { fields: Record<string, string> }).fields["2026-11-17"]).toBeTruthy();
    }
    await expect(core.lunch.publish(boss, "d1", ["2026-11-13"])).rejects.toMatchObject({ status: 422, message: "Този ден вече мина." });
    await core.lunch.saveDay(boss, "d1", "2026-11-17", v.catalog.slice(2, 9).map((x) => x.id));
    const p = await core.lunch.publish(boss, "d1", ["2026-11-16", "2026-11-17"]);
    expect(p.pub["2026-11-16"].ids).toEqual(ids);
  });
  it("today's published day reaches the site and the orders (src/lib/data.ts)", async () => {
    expect(MENU_LUNCH_DATE).toBe("2026-11-16");
    expect(lunchItems.map((x) => x.id)).toEqual((await core.lunch.get(boss, "d1")).pub["2026-11-16"].ids);
    const site = await core.menuEdit.site();
    expect(site.lunch.date).toBe("2026-11-16");
    expect(site.lunch.dayName).toBe("Понеделник");
  });
  it("new lunch dish: 'l-' id, group and price checked; favourites", async () => {
    await expect(core.lunch.addDish(boss, "d1", { n: "Боб чорба", group: "Пици", p: "3,50" })).rejects.toMatchObject({ status: 422, fields: { group: "Изберете група." } });
    const r = await core.lunch.addDish(boss, "d1", { n: "Боб чорба", group: "Супи", p: "3,50" });
    expect(r.id).toBe("l-bob-chorba");
    expect(r.catalog.find((x) => x.id === r.id)).toMatchObject({ p: 3.5, group: "Супи" });
    const f = await core.lunch.saveFav(boss, "d1", { n: "Понеделник", ids: [r.id] });
    expect(f.favs.some((x) => x.n === "Понеделник")).toBe(true);
  });
  it("PIN: only the owner, the manager, the main admin set it; hashed, never returned again", async () => {
    await expect(core.lunch.setPin(waiter, "2580")).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(core.lunch.setPin(boss, "12a4")).rejects.toMatchObject({ status: 422, message: "ПИН-ът е от 4 цифри." });
    await expect(core.lunch.setPin(boss, "1111")).rejects.toMatchObject({ status: 422 });
    const r = await core.lunch.setPin(boss, "2580");
    expect(r.pin).toBe("2580");
    const stored = JSON.stringify(await core.ctx.repo.get("settings", "lunch-pin"));
    expect(stored).not.toContain("2580");
    expect(stored).toMatch(/"algo":"scrypt"/);
    const st = await core.lunch.pinState(boss, "d1");
    expect(st).toMatchObject({ pinSet: true, boss: true });
    expect(JSON.stringify(st)).not.toContain("2580");
    const rnd = await core.lunch.setPin(adminS);
    expect(rnd.pin).toMatch(/^\d{4}$/);
    await core.lunch.setPin(boss, "2580");
    const log = await core.audit.list({ action: "lunch.pin" });
    expect(JSON.stringify(log)).not.toContain("2580");
  });
  it("another staff member: the schedule is locked, opens with the PIN on this device; 5 wrong per device -> 429", async () => {
    await expect(core.lunch.get(waiter, "phone-1")).rejects.toMatchObject({ code: "pin_required", status: 403, pinSet: true });
    await expect(core.lunch.saveDay(waiter, "phone-1", "2026-11-18", [])).rejects.toMatchObject({ code: "pin_required" });
    for (let i = 0; i < 4; i++) await expect(core.lunch.unlock(waiter, "phone-1", "0000")).rejects.toMatchObject({ code: "bad_pin", status: 401, message: "Грешен ПИН. Опитайте пак." });
    await expect(core.lunch.unlock(waiter, "phone-1", "0000")).rejects.toMatchObject({ code: "throttled", status: 429 });
    await expect(core.lunch.unlock(waiter, "phone-1", "2580")).rejects.toMatchObject({ code: "throttled", status: 429, retryIn: expect.any(Number) });
    /* another device of the same person still works (the person's limit is 10) */
    const u = await core.lunch.unlock(waiter, "phone-2", "2580");
    expect(u.until).toBeGreaterThan(NOW.getTime());
    const v = await core.lunch.get(waiter, "phone-2");
    expect(v.boss).toBe(false);
    expect(v.openUntil).toBe(u.until);
    await core.lunch.saveDay(waiter, "phone-2", "2026-11-18", v.catalog.slice(10, 14).map((x) => x.id));
    const log = await core.audit.list({ action: "lunch." });
    expect(log.filter((e) => e.action === "lunch.pin_fail")).toHaveLength(5);
    expect(log.find((e) => e.action === "lunch.update" && e.actor === "srv")!.data).toMatchObject({ pin: true });
    /* a new PIN closes the open schedules */
    await core.lunch.setPin(boss, "3691");
    await expect(core.lunch.get(waiter, "phone-2")).rejects.toMatchObject({ code: "pin_required" });
  });
  it("a day's limit per person: 30 wrong in a day close the PIN until midnight (Sofia), also on new devices", async () => {
    let t = new Date("2026-11-16T07:00:00Z").getTime(); /* 09:00 in Sofia */
    const c2 = createCore({ repo: new MemoryRepo(), hasher: fast, now: () => new Date(t), clock: "09:00" });
    const b2 = await as(c2 as never, "owner", "own2");
    await as(c2 as never, "waiter", "srv2");
    await c2.staff.setRole("waiter", ["dashboard", "waiter", "lunch"], "own2");
    const w2 = await c2.staff.guard((await c2.staff.login("srv2", "test-password-123")).token);
    await c2.lunch.setPin(b2, "2580");
    let wrong = 0;
    /* 4 wrong on a new device every 16 minutes: the 15-minute limits never trip */
    while (wrong < PIN_FAILS_DAY - 1) {
      for (let i = 0; i < 4 && wrong < PIN_FAILS_DAY - 1; i++, wrong++) await expect(c2.lunch.unlock(w2, "d" + wrong, "0000")).rejects.toMatchObject({ code: "bad_pin" });
      t += 16 * 60_000;
    }
    const e = await c2.lunch.unlock(w2, "last", "0000").catch((x) => x);
    expect(e).toMatchObject({ code: "throttled", status: 429, message: "Твърде много грешни опити днес. Опитайте утре или помолете управителя." });
    const midnight = new Date("2026-11-16T22:00:00Z").getTime();
    expect(e.retryIn).toBe(Math.ceil((midnight - t) / 1000));
    await expect(c2.lunch.unlock(w2, "fresh", "2580")).rejects.toMatchObject({ code: "throttled" });
    t = midnight + 60_000; /* the next day */
    expect((await c2.lunch.unlock(w2, "fresh", "2580")).until).toBeGreaterThan(t);
  });
  it("rights: without the section 'Обедно меню' -> 403", async () => {
    const k = await as(core, "kitchen", "kit");
    await expect(core.lunch.get(k, "x")).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });
});
