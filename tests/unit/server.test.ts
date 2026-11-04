import { describe, it, expect } from "vitest";
import { createApp } from "../../server/app.ts";

describe("server API (in-memory SQLite)", async () => {
  const { app, core } = createApp({ dbFile: ":memory:", distDir: "dist" });
  await core.staff.upsert({ username: "admin", name: "Главен админ", role: "admin", password: "test-password-123" });
  const json = (method: string, body?: unknown, cookie?: string) => ({ method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });

  it("GET /api/menu from the database", async () => {
    const r = await app.request("/api/menu");
    const m = await r.json();
    expect(m.items).toHaveLength(127);
    expect(m.cats).toHaveLength(15);
  });
  it("staff login sets an httpOnly cookie; admin routes need it", async () => {
    expect((await app.request("/api/admin/notes")).status).toBe(401);
    const bad = await app.request("/api/auth/login", json("POST", { username: "admin", password: "x" }));
    expect(bad.status).toBe(401);
    const r = await app.request("/api/auth/login", json("POST", { username: "admin", password: "test-password-123" }));
    expect(r.status).toBe(200);
    const sc = r.headers.get("set-cookie")!;
    expect(sc).toMatch(/HttpOnly/);
    expect(sc).toMatch(/SameSite=Lax/);
    const cookie = sc.split(";")[0];
    const n = await app.request("/api/admin/notes", json("POST", { module: "site", url: "/", selector: "h1", text: "Смени", viewport: { w: 390, h: 844 } }, cookie));
    expect(n.status).toBe(201);
    const list = await (await app.request("/api/admin/notes?status=new", { headers: { cookie } })).json();
    expect(list[0].text).toBe("Смени");
  });
  it("orders: numbers from 1042, public view without personal data", async () => {
    const o = await (await app.request("/api/orders", json("POST", { cart: { mode: "pickup", lines: [{ key: "pitsa-dyavolo", id: "pitsa-dyavolo", q: 1, mods: [], extra: 0 }] }, name: "Иван Петров", phone: "0888123456", sched: "утре", slot: "12:00" }))).json();
    expect(o.no).toBe("1042");
    const pub = await (await app.request("/api/orders/1042")).json();
    expect(pub.phone).toBeUndefined();
    expect(pub.name).toBe("Иван");
  });
  it("cross-origin POST is refused", async () => {
    const r = await app.request("http://localhost/api/subscribe", { method: "POST", headers: { origin: "https://evil.example", host: "localhost", "content-type": "application/json" }, body: "{}" });
    expect(r.status).toBe(403);
  });
});
