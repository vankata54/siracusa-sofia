/* The personal PIN of the staff apps (core/staff-pin.ts, core/device.ts): only on a device where somebody has already
   signed in with a password; person + PIN (the kitchen: the PIN alone); the lockouts; the result is a normal staff session. */
import { describe, it, expect } from "vitest";
import { createCore, MemoryRepo, PIN_LOGIN_DEVICE, PIN_LOGIN_PERSON, type Hasher, type RoleId, type StaffCtx } from "../../src/core/index.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const PW = "a-long-password-1", DEV = "d".repeat(48), DEV2 = "e".repeat(48), DEV3 = "f".repeat(48);
function mk(demo = false) {
  const t = { now: Date.parse("2026-11-16T17:42:00Z") }, repo = new MemoryRepo();
  return { core: createCore({ repo, hasher, now: () => new Date(t.now), clock: "19:42", demo }), repo, t };
}
async function staff(core: ReturnType<typeof mk>["core"]) {
  const list: [string, string, RoleId][] = [["admin", "Главен админ", "admin"], ["manager", "Управител", "manager"], ["w1", "Сервитьор 1", "waiter"], ["w2", "Сервитьор 2", "waiter"], ["w3", "Сервитьор 3", "waiter"], ["k1", "Кухня 1", "kitchen"], ["k2", "Кухня 2", "kitchen"], ["d1", "Шофьор 1", "driver"]];
  for (const [username, name, role] of list) await core.staff.upsert({ username, name, role, password: PW });
  const admin = (await core.staff.bySession((await core.staff.login("admin", PW, "1.1.1.1")).token)) as StaffCtx;
  const rows = (await core.staffAdmin.list(admin)).rows, id = (u: string) => rows.find((r) => r.username === u)!.id;
  await core.staffAdmin.setPin(admin, id("w1"), "4821");
  await core.staffAdmin.setPin(admin, id("w2"), "7305");
  await core.staffAdmin.setPin(admin, id("k1"), "6094");
  await core.staffAdmin.setPin(admin, id("k2"), "3187");
  await core.staffAdmin.setPin(admin, id("d1"), "5526");
  return { admin, id };
}

describe("PIN sign-in on a known device", () => {
  it("an unknown device gets no names and no sign-in; a password sign-in makes it known", async () => {
    const { core } = mk(), { id } = await staff(core);
    expect(await core.pin.people(DEV, "waiter")).toEqual({ known: false, module: "waiter", pinOnly: false, people: [] });
    expect(await core.pin.people(null, "waiter")).toMatchObject({ known: false, people: [] });
    await expect(core.pin.login(DEV, { module: "waiter", user: id("w1"), pin: "4821" })).rejects.toMatchObject({ code: "unknown_device", status: 403 });
    await expect(core.pin.login("", { module: "waiter", user: id("w1"), pin: "4821" })).rejects.toMatchObject({ code: "unknown_device" });
    /* a wrong password does not make the device known */
    await expect(core.staff.login("manager", "wrong-password-1", "2.2.2.2", DEV)).rejects.toMatchObject({ code: "bad_login" });
    expect((await core.pin.people(DEV, "waiter")).known).toBe(false);
    /* any staff member with the right password does */
    await core.staff.login("manager", PW, "2.2.2.2", DEV);
    const p = await core.pin.people(DEV, "waiter");
    /* the active waiters who have a PIN, with their public names: never usernames, never a person without a PIN */
    expect(p).toEqual({ known: true, module: "waiter", pinOnly: false, people: [{ id: id("w1"), name: "Сервитьор 1" }, { id: id("w2"), name: "Сервитьор 2" }] });
    expect(JSON.stringify(p)).not.toMatch(/"w1"|username|hash|salt/);
    expect(await core.pin.people(DEV, "driver")).toMatchObject({ people: [{ name: "Шофьор 1" }] });
    expect(await core.pin.people(DEV, "kitchen")).toEqual({ known: true, module: "kitchen", pinOnly: true, people: [] });
    await expect(core.pin.people(DEV, "admin" as never)).rejects.toMatchObject({ code: "invalid", status: 422 });
    /* another device stays unknown; the store keeps only a hash of the token */
    expect((await core.pin.people(DEV2, "waiter")).known).toBe(false);
    expect(JSON.stringify(await core.ctx.repo.list("devices"))).not.toContain(DEV);
  });
  it("person + PIN gives the normal staff session with the person's rights; the kitchen signs in with the PIN alone", async () => {
    const { core } = mk(), { id } = await staff(core);
    await core.staff.login("manager", PW, "2.2.2.2", DEV);
    const r = await core.pin.login(DEV, { module: "waiter", user: id("w1"), pin: "4821" });
    expect(r).toMatchObject({ user: { username: "w1", name: "Сервитьор 1", role: "waiter" }, home: "app:waiter" });
    expect(r.user).not.toHaveProperty("pin");
    const s = (await core.staff.bySession(r.token))!;
    expect(s.sections).toContain("waiter");
    expect((await core.floor.hall(s)).me.username).toBe("w1");
    /* the PIN of a colleague, a person of another module, a person without a PIN, no person: the same answer */
    await expect(core.pin.login(DEV, { module: "waiter", user: id("w1"), pin: "7305" })).rejects.toMatchObject({ code: "bad_pin", status: 401, message: "Грешен ПИН. Опитай пак." });
    await expect(core.pin.login(DEV, { module: "waiter", user: id("k1"), pin: "6094" })).rejects.toMatchObject({ code: "bad_pin" });
    await expect(core.pin.login(DEV, { module: "waiter", user: id("w3"), pin: "0000" })).rejects.toMatchObject({ code: "bad_pin" });
    await expect(core.pin.login(DEV, { module: "waiter", pin: "4821" })).rejects.toMatchObject({ code: "invalid", fields: { user: "Избери кой влиза." } });
    /* the kitchen: the PIN alone finds the person among the kitchen staff */
    const k = await core.pin.login(DEV, { module: "kitchen", pin: "3187" });
    expect(k.user).toMatchObject({ username: "k2", role: "kitchen" });
    await expect(core.pin.login(DEV, { module: "kitchen", pin: "4821" })).rejects.toMatchObject({ code: "bad_pin" }); /* a waiter's PIN */
    const d = await core.pin.login(DEV, { module: "driver", user: id("d1"), pin: "5526" });
    expect(d.home).toBe("app:driver");
    /* a deactivated person cannot sign in with the PIN and leaves the list */
    const admin = (await core.staff.bySession((await core.staff.login("admin", PW, "1.1.1.1")).token))!;
    await core.staffAdmin.setActive(admin, id("w2"), false);
    expect((await core.pin.people(DEV, "waiter")).people.map((x) => x.name)).toEqual(["Сервитьор 1"]);
    await expect(core.pin.login(DEV, { module: "waiter", user: id("w2"), pin: "7305" })).rejects.toMatchObject({ code: "bad_pin" });
    const log = (await core.audit.list({ limit: 200 })).map((e) => e.action);
    expect(log).toContain("staff.pin_login");
    expect(log).toContain("staff.pin_failed");
    expect(JSON.stringify(await core.audit.list({ limit: 200 }))).not.toMatch(/4821|7305|3187/);
  });
  it("5 wrong per person and device, 10 per person on all devices, for 15 minutes; a right PIN starts the device again", async () => {
    const { core, t } = mk(), { id } = await staff(core);
    for (const d of [DEV, DEV2, DEV3]) await core.staff.login("manager", PW, "2.2.2.2", d);
    const bad = (dev: string, user = "w1", pin = "0001") => core.pin.login(dev, { module: "waiter", user: id(user), pin });
    /* the last 3 tries say how many are left */
    await expect(bad(DEV)).rejects.not.toHaveProperty("left");
    await expect(bad(DEV)).rejects.toMatchObject({ code: "bad_pin", status: 401, left: 3 });
    await expect(bad(DEV)).rejects.toMatchObject({ code: "bad_pin", left: 2 });
    /* the right PIN in between: this device starts again */
    await core.pin.login(DEV, { module: "waiter", user: id("w1"), pin: "4821" });
    for (let i = 0; i < PIN_LOGIN_DEVICE - 1; i++) await expect(bad(DEV)).rejects.toMatchObject({ code: "bad_pin" });
    await expect(bad(DEV)).rejects.toMatchObject({ code: "throttled", status: 429, retryIn: 900, message: expect.stringContaining("15 минути") });
    /* locked on this device even with the right PIN; the colleague on the same device is not */
    await expect(core.pin.login(DEV, { module: "waiter", user: id("w1"), pin: "4821" })).rejects.toMatchObject({ code: "throttled", retryIn: 900 });
    expect((await core.pin.login(DEV, { module: "waiter", user: id("w2"), pin: "7305" })).user.username).toBe("w2");
    /* another device still works for the person, until 10 wrong ones on all devices together */
    expect((await core.pin.login(DEV2, { module: "waiter", user: id("w1"), pin: "4821" })).user.username).toBe("w1");
    let locked = 0;
    for (let i = 0; i < PIN_LOGIN_PERSON; i++) { try { await bad(i % 2 ? DEV2 : DEV3); } catch (e) { if ((e as { code: string }).code === "throttled") locked++; } }
    expect(locked).toBeGreaterThan(0);
    await expect(core.pin.login(DEV3, { module: "waiter", user: id("w1"), pin: "4821" })).rejects.toMatchObject({ code: "throttled", status: 429 });
    /* 15 minutes later everything is open again */
    t.now += 15 * 60_000 + 1000;
    expect((await core.pin.login(DEV, { module: "waiter", user: id("w1"), pin: "4821" })).user.username).toBe("w1");
    /* parallel tries cannot slip past the limit */
    const res = await Promise.allSettled(Array.from({ length: 12 }, () => bad(DEV, "w2", "0002")));
    expect(res.filter((r) => r.status === "rejected" && (r.reason as { code: string }).code === "bad_pin")).toHaveLength(PIN_LOGIN_DEVICE - 1);
    expect(res.filter((r) => r.status === "rejected" && (r.reason as { code: string }).code === "throttled")).toHaveLength(12 - PIN_LOGIN_DEVICE + 1);
  });
  it("the kitchen's PIN alone: 5 wrong per device; the demo store is one device, known after a password sign-in there", async () => {
    const { core } = mk(), {} = await staff(core);
    await core.staff.login("manager", PW, "2.2.2.2", DEV);
    for (let i = 0; i < PIN_LOGIN_DEVICE - 1; i++) await expect(core.pin.login(DEV, { module: "kitchen", pin: "000" + i })).rejects.toMatchObject({ code: "bad_pin" });
    await expect(core.pin.login(DEV, { module: "kitchen", pin: "0009" })).rejects.toMatchObject({ code: "throttled" });
    await expect(core.pin.login(DEV, { module: "kitchen", pin: "6094" })).rejects.toMatchObject({ code: "throttled" });
    /* the demo: no cookie, the browser's own store is the device */
    const demo = mk(true), x = await staff(demo.core);
    expect((await demo.core.pin.people(null, "waiter")).known).toBe(true); /* staff() signed the admin in with a password */
    const fresh = mk(true);
    await fresh.core.staff.upsert({ username: "w1", name: "Сервитьор 1", role: "waiter", password: PW });
    expect((await fresh.core.pin.people(undefined, "waiter")).known).toBe(false);
    expect((await demo.core.pin.login(null, { module: "waiter", user: x.id("w1"), pin: "4821" })).user.username).toBe("w1");
  });
});
