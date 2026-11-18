/* Repo (src/core/repo.ts) on SQLite. Each core collection is a table with `id`, `data` (JSON) and a few
   indexed columns filled from the document (see schema.ts). */
import type Database from "better-sqlite3";
import { matches, type Doc, type Repo } from "../../src/core/repo.ts";
import { histDay } from "../../src/core/order-day.ts";
import { normKey } from "../../src/core/admin.ts";
import type { LightOrder, OrdersPageQuery, CustomerGroup } from "../../src/core/order-index.ts";

type Cols = Record<string, (d: Record<string, any>) => unknown>;
const TABLES: Record<string, Cols> = {
  orders: { no: (d) => +d.no, mode: (d) => d.mode, status: (d) => d.status, phone: (d) => d.phone, total: (d) => d.total, channel: (d) => d.channel, day: (d) => histDay(d),
    ts: (d) => (typeof d.ts === "number" ? d.ts : Date.parse(d.createdAt) || null), user_id: (d) => d.userId || null,
    name_key: (d) => normKey(d.name || ""), name_lc: (d) => String(d.name || "").toLowerCase(), addr_lc: (d) => String(d.addr || "").toLowerCase() },
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
  events: {}, offers: {}, settings: {}, bonus_used: {}, feedback: { status: (d) => d.status },
  push_subs: { order_no: (d) => d.orderNo },
  notes_seen: {}, noshow_blocks: {}, login_fails: {},
  vouchers: { used_by: (d) => d.usedBy || null },
  /* stage D, the modules */
  table_sessions: { table_id: (d) => d.table, status: (d) => d.status },
  shifts: { user_id: (d) => d.user, role: (d) => d.role, status: (d) => d.status },
  devices: {}, fuel_logs: { user_id: (d) => d.user }, driver_asks: { status: (d) => d.status }, module_state: {},
};
/* where-keys that map 1:1 to a column (to filter in SQL); the rest is filtered in JS */
const WHERE: Record<string, Record<string, string>> = {
  orders: { status: "status", phone: "phone", mode: "mode", userId: "user_id" }, reservations: { date: "date", time: "time", table: "table_id", phone: "phone", status: "status" },
  office_orders: { code: "code" }, subscriptions: { email: "email" }, users: { phone: "phone" }, staff_users: { username: "username" },
  sessions: { userId: "user_id" }, ratings: { orderNo: "order_no" }, feedback_notes: { status: "status", module: "module" }, push_subs: { orderNo: "order_no" },
  table_sessions: { table: "table_id", status: "status" }, shifts: { user: "user_id", role: "role", status: "status" }, fuel_logs: { user: "user_id" }, driver_asks: { status: "status" },
};
/* the range keys (core/history.ts RangeRepo): an indexed column, compared as text; "createdAt" is every table's created_at */
const RANGE: Record<string, Record<string, string>> = { orders: { day: "day", createdAt: "created_at" }, reservations: { date: "date", createdAt: "created_at" }, table_sessions: { createdAt: "created_at" } };
const val = (v: unknown) => (typeof v === "boolean" ? Number(v) : v === undefined ? null : v);

export class SqliteRepo implements Repo {
  db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
    /* an older database: the day of its orders is filled at the start, before the first request */
    try { this.fixDays(); } catch { /* no orders table yet */ }
  }
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
  private rangeCol(col: string, key: string): string {
    const t = this.t(col), c = (RANGE[t] || {})[key];
    if (!c) throw new Error("no range " + col + "." + key);
    if (t === "orders") this.fixDays();
    return c;
  }
  /** rows written without the derived columns (an older database, a row written straight into the table): they are
      filled once, from the same extractors as put() */
  private fixDays() {
    /* in batches: a large old table never sits in memory at once */
    const ex = TABLES.orders, keys = ["day", "ts", "user_id", "name_key", "name_lc", "addr_lc"];
    /* only the rows added since the last look (a row written straight into the table gets a new rowid; put() fills them) */
    const top = (this.db.prepare(`SELECT ifnull(max(rowid), 0) AS m FROM orders`).get() as { m: number }).m;
    if (top <= this.fixedTo) return;
    const sel = this.db.prepare(`SELECT id, data FROM orders WHERE rowid > ${this.fixedTo} AND (day IS NULL OR ts IS NULL OR name_key IS NULL) LIMIT 2000`);
    const up = this.db.prepare(`UPDATE orders SET ${keys.map((k) => `"${k}" = ?`).join(", ")} WHERE id = ?`);
    for (;;) {
      const rows = sel.all() as { id: string; data: string }[];
      if (!rows.length) { this.fixedTo = top; return; }
      this.db.transaction(() => { for (const r of rows) {
        let d: Record<string, any>; try { d = JSON.parse(r.data); } catch { d = {}; }
        const v = keys.map((k) => { try { return val(ex[k](d)); } catch { return null; } });
        if (v[0] == null) v[0] = "0000-00-00"; if (v[1] == null) v[1] = 0; if (v[3] == null) v[3] = "";
        up.run(...v, r.id);
      } })();
    }
  }
  /** the documents whose key is in [from, to] (the history: the orders of a period by their day) */
  async range<T>(col: string, key: string, from: string, to: string): Promise<T[]> {
    const c = this.rangeCol(col, key);
    return (this.db.prepare(`SELECT data FROM "${this.t(col)}" WHERE "${c}" BETWEEN ? AND ?`).all(from, to) as { data: string }[]).map((r) => JSON.parse(r.data) as T);
  }
  /** the same documents one at a time in the order of the key (a long period is summed day by day, never held at once) */
  async rangeEach<T>(col: string, key: string, from: string, to: string, fn: (d: T) => void): Promise<void> {
    const c = this.rangeCol(col, key);
    for (const r of this.db.prepare(`SELECT data FROM "${this.t(col)}" WHERE "${c}" BETWEEN ? AND ? ORDER BY "${c}"`).iterate(from, to) as Iterable<{ data: string }>) fn(JSON.parse(r.data) as T);
  }
  /** one stamp per key value in [from, to]: how many, the last change and the size (changes when a document changes) */
  async stamps(col: string, key: string, from: string, to: string): Promise<Record<string, string>> {
    const c = this.rangeCol(col, key), out: Record<string, string> = {};
    for (const r of this.db.prepare(`SELECT "${c}" AS k, count(*) || '|' || ifnull(max(updated_at), '') || '|' || sum(length(data)) AS s FROM "${this.t(col)}" WHERE "${c}" BETWEEN ? AND ? GROUP BY "${c}"`).all(from, to) as { k: string; s: string }[]) out[r.k] = r.s;
    return out;
  }
  /** a few fields of every document (JSON paths "name", "times.ready"), with its id: one pass in SQLite, no JSON.parse */
  async fields<T>(col: string, fields: string[]): Promise<(T & { id: string })[]> {
    const t = this.t(col), safe = fields.filter((f) => /^[A-Za-z_][\w.]*$/.test(f));
    const sel = safe.map((f, i) => `json_extract(data, '$.${f}') AS f${i}`).join(", ");
    const rows = this.db.prepare(`SELECT id${sel ? ", " + sel : ""} FROM "${t}"`).raw().all() as unknown[][];
    return rows.map((r) => { const o: Record<string, unknown> = { id: r[0] }; safe.forEach((f, i) => { o[f] = r[i + 1]; }); return o as T & { id: string }; });
  }
  /** the admin's search in the whole history: the orders whose name (as the search compares it) holds `nameKey`, or whose
      number is `digits` (or starts with it, 3-5 digits), or whose phone holds `digits` (3+); the caller checks each again */
  async orderSearch(nameKey: string, digits: string): Promise<LightOrder[]> {
    this.fixDays();
    const w: string[] = [], a: unknown[] = [];
    if (nameKey) { w.push(`instr(name_key, ?) > 0`); a.push(nameKey); }
    if (digits) { w.push(`no = ?`); a.push(+digits); }
    if (digits.length >= 3 && digits.length < 6) { w.push(`CAST(no AS TEXT) LIKE ?`); a.push(digits + "%"); }
    if (digits.length >= 3) { w.push(`instr(phone, ?) > 0`); a.push(digits); }
    if (!w.length) return [];
    return (this.db.prepare(`SELECT id, CAST(no AS TEXT) AS no, status, ts, phone, json_extract(data, '$.name') AS name, json_extract(data, '$.placedAt') AS placedAt, created_at AS createdAt FROM orders WHERE ${w.join(" OR ")}`).all(...a) as LightOrder[])
      .map((o) => ({ ...o, phone: o.phone || "", name: o.name || "" }));
  }
  /** "Поръчки" › "Всички дни": the counts by status of every order and the newest `limit` orders that pass the filters */
  async ordersPage(q: OrdersPageQuery): Promise<{ counts: Record<string, number>; ids: string[] }> {
    this.fixDays();
    const counts: Record<string, number> = {};
    for (const r of this.db.prepare(`SELECT status, count(*) AS n FROM orders GROUP BY status`).all() as { status: string; n: number }[]) counts[r.status] = r.n;
    const w: string[] = [], a: unknown[] = [];
    if (q.statuses) { w.push(`status IN (${q.statuses.map(() => "?").join(",")})`); a.push(...q.statuses); }
    if (q.channels) { w.push(`channel IN (${q.channels.map(() => "?").join(",")})`); a.push(...q.channels); }
    if (q.text) {
      const o: string[] = [`CAST(no AS TEXT) = ?`]; a.push(q.digits);
      if (q.digits.length >= 3) { o.push(`phone LIKE ?`); a.push("%" + q.digits); }
      if (q.text.length >= 3) { o.push(`instr(addr_lc, ?) > 0`); a.push(q.text); }
      if (q.text.length >= 2) { o.push(`instr(name_lc, ?) > 0`); a.push(q.text); }
      w.push("(" + o.join(" OR ") + ")");
    }
    a.push(q.limit);
    const ids = (this.db.prepare(`SELECT id FROM orders${w.length ? " WHERE " + w.join(" AND ") : ""} ORDER BY no DESC LIMIT ?`).raw().all(...a) as string[][]).map((r) => r[0]);
    return { counts, ids };
  }
  /** "Клиенти": the orders grouped by phone and account (each order in one group): how many, the sum without the
      cancelled, the moment of the last one */
  async customerGroups(): Promise<CustomerGroup[]> {
    this.fixDays();
    return this.db.prepare(`SELECT phone, user_id AS userId, count(*) AS n, round(sum(CASE WHEN status != 'cancelled' THEN ifnull(total, 0) ELSE 0 END), 2) AS sum, max(ts) AS lastTs FROM orders GROUP BY phone, user_id`).all() as CustomerGroup[];
  }
  /** the first (not cancelled) order of every phone: new and returning customers, by the indexed phone column */
  async firstOrderTs(phones: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (let i = 0; i < phones.length; i += 500) {
      const part = phones.slice(i, i + 500);
      for (const r of this.db.prepare(`SELECT phone AS p, min(json_extract(data, '$.ts')) AS t FROM orders WHERE phone IN (${part.map(() => "?").join(",")}) AND status != 'cancelled' GROUP BY phone`).all(...part) as { p: string; t: number }[]) out[r.p] = r.t;
    }
    return out;
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
  /** the rowid up to which the derived columns of the orders are known to be filled */
  private fixedTo = 0;
  async transaction<R>(fn: () => Promise<R>): Promise<R> {
    if (this.depth > 0) { this.depth++; try { return await fn(); } finally { this.depth--; } }
    this.db.exec("BEGIN IMMEDIATE"); this.depth = 1;
    try { const r = await fn(); this.depth = 0; this.db.exec("COMMIT"); return r; }
    catch (e) { this.depth = 0; this.db.exec("ROLLBACK"); throw e; }
  }
}
