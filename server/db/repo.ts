/* Repo (src/core/repo.ts) on SQLite. Each core collection is a table with `id`, `data` (JSON) and a few
   indexed columns filled from the document (see schema.ts). */
import type Database from "better-sqlite3";
import { matches, type Doc, type Repo } from "../../src/core/repo.ts";

type Cols = Record<string, (d: Record<string, any>) => unknown>;
const TABLES: Record<string, Cols> = {
  orders: { no: (d) => +d.no, mode: (d) => d.mode, status: (d) => d.status, phone: (d) => d.phone, total: (d) => d.total, channel: (d) => d.channel },
  reservations: { date: (d) => d.date, time: (d) => d.time, table_id: (d) => d.table, phone: (d) => d.phone, status: (d) => d.status },
  celebrations: { status: (d) => d.status },
  office_orders: { code: (d) => d.code },
  subscriptions: { email: (d) => d.email },
  ratings: { order_no: (d) => d.orderNo },
  users: { phone: (d) => d.phone },
  sms_codes: {},
  staff_users: { username: (d) => d.username, role: (d) => d.role },
  roles: {},
  sessions: { user_id: (d) => d.userId, kind: (d) => d.kind, expires_at: (d) => d.expiresAt },
  feedback_notes: { status: (d) => d.status, module: (d) => d.module },
  audit_log: { actor: (d) => d.actor, action: (d) => d.action },
  events: {}, offers: {}, settings: {},
};
/* where-keys that map 1:1 to a column (to filter in SQL); the rest is filtered in JS */
const WHERE: Record<string, Record<string, string>> = {
  orders: { status: "status", phone: "phone", mode: "mode" }, reservations: { date: "date", time: "time", table: "table_id", phone: "phone", status: "status" },
  office_orders: { code: "code" }, subscriptions: { email: "email" }, users: { phone: "phone" }, staff_users: { username: "username" },
  sessions: { userId: "user_id" }, ratings: { orderNo: "order_no" }, feedback_notes: { status: "status", module: "module" },
};
const val = (v: unknown) => (typeof v === "boolean" ? Number(v) : v === undefined ? null : v);

export class SqliteRepo implements Repo {
  db: Database.Database;
  constructor(db: Database.Database) { this.db = db; }
  private t(col: string): string {
    if (!(col in TABLES)) throw new Error("unknown collection " + col);
    return col;
  }
  async list<T extends Doc>(col: string, where?: Partial<T>): Promise<T[]> {
    const t = this.t(col), w = WHERE[t] || {}, sqlW: string[] = [], args: unknown[] = [];
    for (const [k, v] of Object.entries(where || {})) if (w[k] && v != null) { sqlW.push(`"${w[k]}" = ?`); args.push(val(v)); }
    const rows = this.db.prepare(`SELECT data FROM "${t}"${sqlW.length ? " WHERE " + sqlW.join(" AND ") : ""}`).all(...args) as { data: string }[];
    return rows.map((r) => JSON.parse(r.data) as T).filter((d) => matches(d, where));
  }
  async get<T extends Doc>(col: string, id: string): Promise<T | null> {
    const r = this.db.prepare(`SELECT data FROM "${this.t(col)}" WHERE id = ?`).get(id) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as T) : null;
  }
  async put<T extends Doc>(col: string, doc: T): Promise<T> {
    const t = this.t(col), extra = TABLES[t], d = doc as unknown as Record<string, any>;
    const cols = ["id", "data", "created_at", "updated_at", ...Object.keys(extra)];
    const vals = [doc.id, JSON.stringify(doc), d.createdAt || d.at || new Date().toISOString(), d.updatedAt || new Date().toISOString(), ...Object.values(extra).map((f) => val(f(d)))];
    this.db.prepare(`INSERT INTO "${t}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${cols.map(() => "?").join(",")})
      ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).filter((c) => c !== "created_at").map((c) => `"${c}"=excluded."${c}"`).join(",")}`).run(...vals);
    if (t === "orders") {
      this.db.prepare(`DELETE FROM order_lines WHERE order_id = ?`).run(doc.id);
      const ins = this.db.prepare(`INSERT INTO order_lines (order_id, item_id, name, qty, unit, mods) VALUES (?,?,?,?,?,?)`);
      for (const l of d.lines || []) ins.run(doc.id, l.id, l.name || null, l.q, l.unit ?? null, JSON.stringify(l.mods || []));
    }
    return doc;
  }
  async del(col: string, id: string): Promise<void> {
    const t = this.t(col);
    this.db.prepare(`DELETE FROM "${t}" WHERE id = ?`).run(id);
    if (t === "orders") this.db.prepare(`DELETE FROM order_lines WHERE order_id = ?`).run(id);
  }
  async seq(name: string, start: number): Promise<number> {
    const r = this.db.prepare(`INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value`).get(name, start) as { value: number };
    return r.value;
  }
  /* better-sqlite3 is synchronous; the core awaits only these synchronous calls, so BEGIN/COMMIT around them is atomic.
     Re-entrant: a transaction inside a transaction (office submit -> createOrder) joins the outer one. */
  private depth = 0;
  async transaction<R>(fn: () => Promise<R>): Promise<R> {
    if (this.depth > 0) { this.depth++; try { return await fn(); } finally { this.depth--; } }
    this.db.exec("BEGIN IMMEDIATE"); this.depth = 1;
    try { const r = await fn(); this.depth = 0; this.db.exec("COMMIT"); return r; }
    catch (e) { this.depth = 0; this.db.exec("ROLLBACK"); throw e; }
  }
}
