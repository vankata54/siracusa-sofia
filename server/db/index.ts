/* Opens the SQLite file, applies Drizzle migrations and seeds the menu (idempotent). */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { sql } from "drizzle-orm";
import * as schema from "./schema.ts";
import { MENU } from "../../src/data/menu.ts";
import { ALLERGENS } from "../../src/lib/data.ts";
import { TABLES } from "../../src/lib/tables.ts";

export function openDb(file: string) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "migrations") });
  return { sqlite, db };
}

export type Db = ReturnType<typeof openDb>["db"];

/** Menu, allergens and the mock floor plan from the design data. Updates prices/names, keeps sold_out set by the admin. */
export function seedMenu(db: Db) {
  db.transaction((tx) => {
    MENU.cats.forEach((c, i) => tx.insert(schema.categories).values({ id: c.id, name: c.n, course: c.course, sort: i })
      .onConflictDoUpdate({ target: schema.categories.id, set: { name: c.n, course: c.course, sort: i } }).run());
    MENU.items.forEach((x, i) => {
      const v = { id: x.id, cat: x.cat, name: x.n, course: x.course, comp: x.comp, weight: x.g, price: x.p, priceLv: x.lv ?? null,
        tags: JSON.stringify(x.t.filter((t) => t !== "out")), allergens: JSON.stringify(x.al), noOnion: x.noOnion, share: x.share, per100: !!x.per100, sort: i };
      tx.insert(schema.menuItems).values({ ...v, soldOut: x.t.includes("out") }).onConflictDoUpdate({ target: schema.menuItems.id, set: v }).run();
    });
    MENU.lunch.items.filter((x) => x.p).forEach((x, i) => {
      const v = { id: x.id, cat: "obedno", name: x.n, course: /Супи|Салати/.test(x.group) ? "starter" : /Десерти/.test(x.group) ? "dessert" : "main", price: x.p as number, lunchGroup: x.group, lunchDate: MENU.lunch.date, sort: 1000 + i };
      tx.insert(schema.menuItems).values(v).onConflictDoUpdate({ target: schema.menuItems.id, set: v }).run();
    });
    ALLERGENS.forEach(([id, name, icon]) => tx.insert(schema.allergens).values({ id, name, icon }).onConflictDoNothing().run());
    TABLES.forEach((t) => tx.insert(schema.tables).values(t).onConflictDoNothing().run());
  });
  return db.select({ n: sql<number>`count(*)` }).from(schema.menuItems).get()!.n;
}

/** The menu in the same shape as menu.json (for /api/menu), with "out" from sold_out. */
export function readMenu(db: Db) {
  const cats = db.select().from(schema.categories).orderBy(schema.categories.sort).all().map((c) => ({ id: c.id, n: c.name, course: c.course }));
  const rows = db.select().from(schema.menuItems).orderBy(schema.menuItems.sort).all();
  const toDish = (r: typeof rows[number]) => ({
    id: r.id, n: r.name, cat: r.cat, course: r.course, comp: r.comp, g: r.weight, p: r.price,
    t: [...JSON.parse(r.tags), ...(r.soldOut ? ["out"] : [])], al: JSON.parse(r.allergens), noOnion: r.noOnion, share: r.share, ...(r.per100 ? { per100: true } : {}),
  });
  const lunchRows = rows.filter((r) => r.cat === "obedno");
  return {
    updated: MENU.updated, source: MENU.source, cats,
    items: rows.filter((r) => r.cat !== "obedno").map(toDish),
    lunch: { date: lunchRows[0]?.lunchDate || MENU.lunch.date, dayName: MENU.lunch.dayName, items: lunchRows.map((r) => ({ id: r.id, group: r.lunchGroup, n: r.name, p: r.price, out: r.soldOut })) },
  };
}
