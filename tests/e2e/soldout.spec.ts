import { test, expect } from "@playwright/test";
import fs from "node:fs";

/* "Изчерпано днес": the kitchen turns it on (PUT /api/admin/menu/:id/sold-out), the menu shows it after the first paint
   (api.menu), the dish stays visible, the core refuses it in an order for today. One dish per project (they run in parallel). */
const env = (k: string): string => {
  try { const l = fs.readFileSync(".env", "utf8").split("\n").find((x) => x.startsWith(k + "=")); return l ? l.slice(k.length + 1).trim() : ""; } catch { return ""; }
};

test("„Изчерпано днес“ from the kitchen: the category shows it, the dish stays visible, the order is refused", async ({ page, request }, info) => {
  const id = info.project.name === "phone" ? "katmer" : "kyunefe";
  const name = info.project.name === "phone" ? "Катмер" : "Кюнефе";
  const login = await request.post("/api/auth/login", { data: { username: "kitchen", password: env("KITCHEN_PASSWORD") } });
  expect(login.status()).toBe(200);
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of 409/.test(m.text())) errors.push(m.text()); });
  try {
    expect((await request.put("/api/admin/menu/" + id + "/sold-out", { data: { out: true } })).status()).toBe(200);
    await page.addInitScript(() => { try { localStorage.setItem("sc-cookie", '"min"'); } catch { /* ignore */ } });
    await page.goto("/menu/deserti/?preview=1&t=12:30");
    const card = page.locator(".dcard", { has: page.locator('a[href*="/' + id + '/"]') });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Изчерпано днес", { timeout: 8000 });
    await expect(card).toContainText(name);
    /* the core refuses it for today (the preview clock: open) */
    const r = await request.post("/api/orders", { headers: { "x-sc-clock": "12:30" }, data: { cart: { mode: "pickup", lines: [{ id, q: 1 }] }, name: "Иван Петров", phone: "0888 12 34 77" } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error).toBe("sold_out");
  } finally {
    expect((await request.put("/api/admin/menu/" + id + "/sold-out", { data: { out: false } })).status()).toBe(200);
  }
  expect(errors).toEqual([]);
});
