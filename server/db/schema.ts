/* SQLite schema (Drizzle). Tables from BUILD-PLAN A.3 + the core collections.
   Core documents keep their full JSON in `data`; the columns next to it are for indexes, reports and admin lists.
   Migrations: npm run db:migrate (drizzle-kit generate) -> server/db/migrations, applied on server start. */
import { sqliteTable, text, integer, real, index, uniqueIndex } from "drizzle-orm/sqlite-core";

const doc = { id: text("id").primaryKey(), data: text("data").notNull(), createdAt: text("created_at"), updatedAt: text("updated_at") };

/* ---------- menu (seeded from design/data/menu.js) ---------- */
export const categories = sqliteTable("categories", {
  id: text("id").primaryKey(), name: text("name").notNull(), course: text("course").notNull(), sort: integer("sort").notNull().default(0),
});
export const menuItems = sqliteTable("menu_items", {
  id: text("id").primaryKey(), cat: text("cat").notNull(), name: text("name").notNull(), course: text("course").notNull(),
  comp: text("comp").notNull().default(""), weight: text("weight").notNull().default(""), price: real("price").notNull(),
  priceLv: real("price_lv"), tags: text("tags").notNull().default("[]"), allergens: text("allergens").notNull().default("[]"),
  noOnion: integer("no_onion", { mode: "boolean" }).notNull().default(false), share: integer("share", { mode: "boolean" }).notNull().default(false),
  per100: integer("per100", { mode: "boolean" }).notNull().default(false), soldOut: integer("sold_out", { mode: "boolean" }).notNull().default(false),
  lunchGroup: text("lunch_group"), lunchDate: text("lunch_date"), sort: integer("sort").notNull().default(0),
}, (t) => [index("menu_items_cat").on(t.cat)]);
export const allergens = sqliteTable("allergens", { id: text("id").primaryKey(), name: text("name").notNull(), icon: text("icon").notNull() });
export const tables = sqliteTable("tables", {
  id: text("id").primaryKey(), n: integer("n").notNull(), zone: text("zone").notNull(), seats: integer("seats").notNull(), shape: text("shape").notNull(),
  x: integer("x").notNull(), y: integer("y").notNull(), window: integer("window", { mode: "boolean" }).notNull().default(false),
  stroller: integer("stroller", { mode: "boolean" }).notNull().default(false), access: integer("access", { mode: "boolean" }).notNull().default(false),
});
export const events = sqliteTable("events", { ...doc, date: text("date"), slug: text("slug") });
export const offers = sqliteTable("offers", { ...doc, active: integer("active", { mode: "boolean" }).default(true) });

/* ---------- orders ---------- */
export const orders = sqliteTable("orders", {
  ...doc, no: integer("no").notNull(), mode: text("mode").notNull(), status: text("status").notNull(), phone: text("phone"), total: real("total"), channel: text("channel"),
}, (t) => [uniqueIndex("orders_no").on(t.no), index("orders_status").on(t.status), index("orders_phone").on(t.phone)]);
export const orderLines = sqliteTable("order_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }), orderId: text("order_id").notNull(), itemId: text("item_id").notNull(),
  name: text("name"), qty: integer("qty").notNull(), unit: real("unit"), mods: text("mods").notNull().default("[]"),
}, (t) => [index("order_lines_order").on(t.orderId)]);

/* ---------- reservations and requests ---------- */
export const reservations = sqliteTable("reservations", {
  ...doc, date: text("date"), time: text("time"), tableId: text("table_id"), phone: text("phone"), status: text("status"),
}, (t) => [index("reservations_slot").on(t.date, t.time)]);
export const celebrations = sqliteTable("celebrations", { ...doc, status: text("status") });
export const officeOrders = sqliteTable("office_orders", { ...doc, code: text("code") }, (t) => [index("office_code").on(t.code)]);
export const subscriptions = sqliteTable("subscriptions", { ...doc, email: text("email") });
export const ratings = sqliteTable("ratings", { ...doc, orderNo: text("order_no") });

/* ---------- people ---------- */
export const users = sqliteTable("users", { ...doc, phone: text("phone") }, (t) => [uniqueIndex("users_phone").on(t.phone)]);
export const smsCodes = sqliteTable("sms_codes", { ...doc });
export const staffUsers = sqliteTable("staff_users", { ...doc, username: text("username"), role: text("role") }, (t) => [uniqueIndex("staff_username").on(t.username)]);
export const roles = sqliteTable("roles", { ...doc });
export const sessions = sqliteTable("sessions", { ...doc, userId: text("user_id"), kind: text("kind"), expiresAt: integer("expires_at") });

/* ---------- admin ---------- */
export const feedbackNotes = sqliteTable("feedback_notes", { ...doc, status: text("status"), module: text("module") }, (t) => [index("notes_status").on(t.status)]);
export const auditLog = sqliteTable("audit_log", { ...doc, actor: text("actor"), action: text("action") });
/* one document "main": kitchen "Натоварено" + minutes, reservation length (the admin edits them) */
export const settings = sqliteTable("settings", { ...doc });
/* phones that already used the one-time profile bonus: only a SHA-256 hash of the number (kept after a profile is deleted) */
export const bonusUsed = sqliteTable("bonus_used", { ...doc });
/* contact messages from /kontakti/ */
export const feedback = sqliteTable("feedback", { ...doc, status: text("status") });
export const counters = sqliteTable("counters", { name: text("name").primaryKey(), value: integer("value").notNull() });
