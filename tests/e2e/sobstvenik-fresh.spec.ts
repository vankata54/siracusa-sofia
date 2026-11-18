import { test, expect } from "@playwright/test";
import { ownServer, signIn, type Own } from "./own-server.ts";

/* "Собственик" in a new restaurant (an own server with an empty database: no day before today): "Днес" says the
   comparison with the usual comes after 4 weeks; "Тенденции" and "Финанси" show the prototype's "Още събираме история"
   with the way to "Днес" (never "Няма поръчки за този период" with a button that leads to the same empty screen). */

let S: Own;
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => { S = await ownServer("own-fresh", 8); });
test.afterAll(async () => { if (S) await S.stop(); });

test("@desktop a new restaurant: „Днес“, „Тенденции“ and „Финанси“ say „Още събираме история“", async ({ page, context }) => {
  await signIn(context, S.base, "owner");
  await page.goto(S.base + "/sobstvenik/");
  await expect(page.locator(".ow-banner")).toContainText("Още събираме история");
  await expect(page.locator(".ow-banner")).toContainText("Сравнението с обичайното идва след 4 седмици.");
  await expect(page.locator(".td-hero .cmp")).toHaveCount(0);
  for (const [path, text] of [["/sobstvenik/tendentsii/", "Тенденциите и сравнението идват след 4 седмици. Днешните числа са в „Днес“."], ["/sobstvenik/finansi/", "Финансите за минали дни и сравнението идват след 4 седмици. Днешните пари в брой са по-долу."]]) {
    await page.goto(S.base + path);
    const e = page.locator(".ow-empty");
    await expect(e.locator("h2")).toHaveText("Още събираме история");
    await expect(e).toContainText(text);
    await expect(e.locator('a[href="/sobstvenik/"]')).toContainText("Към „Днес“");
    await expect(page.locator("[data-csv]")).toHaveCount(0);
    await expect(page.locator('.ow-empty [data-per="30"]')).toHaveCount(0);
  }
  await expect(page.locator("#cash")).toContainText("Пари в брой от шофьорите");
});
