/* The orders the operational screens need, never the whole table (decision of the chief: after a year every screen is
   fast). The SQLite repo (server/db/repo.ts) answers by its indexes: `day` (core/order-day.ts: the day an order is for),
   `status`, `phone`, `no`; and `fields` reads a few fields of every order without parsing the documents (a search in the
   whole history: by number, name, phone). A repo without them (memory, the demo) reads the list as before, so the
   answers are the same there.
   liveOrders: the orders of the days around today (from the day before yesterday's evening to the day after tomorrow: the
   pre-orders "за утре" too) and every order still open, whatever its day. Every caller filters further exactly as before:
   this is only a superset of what it can keep. */
import { COL, nowDate, type Ctx } from "./ctx.ts";
import type { Order } from "./types.ts";
import type { Repo } from "./repo.ts";
import { addDaysYmd } from "../lib/time.ts";
import { shiftDay } from "../lib/shift-day.ts";

export interface IndexRepo extends Repo {
  range<T>(col: string, key: string, from: string, to: string): Promise<T[]>;
  /** a few fields of every document (dotted paths of the JSON), with its id; the documents are not parsed */
  fields<T>(col: string, fields: string[]): Promise<(T & { id: string })[]>;
}
export const indexed = (r: Repo): r is IndexRepo => typeof (r as Partial<IndexRepo>).range === "function" && typeof (r as Partial<IndexRepo>).fields === "function";
/** the statuses of an order still in work (any day) */
export const OPEN_STATUSES: Order["status"][] = ["accepted", "cooking", "ready", "on_way"];

/** the open orders (any day), by the status index */
export async function openOrders(ctx: Ctx, statuses: Order["status"][] = OPEN_STATUSES): Promise<Order[]> {
  return (await Promise.all(statuses.map((st) => ctx.repo.list<Order>(COL.orders, { status: st } as Partial<Order>)))).flat();
}
/** the orders of the days [from, to] (default: 2 days back to 2 days ahead of today) and every open one */
export async function liveOrders(ctx: Ctx, from?: string, to?: string): Promise<Order[]> {
  const repo = ctx.repo;
  if (!indexed(repo)) return repo.list<Order>(COL.orders);
  const t = shiftDay(nowDate(ctx)), f = from || addDaysYmd(t, -2), e = to || addDaysYmd(t, 2);
  const [days, open] = await Promise.all([repo.range<Order>(COL.orders, "day", f, e), openOrders(ctx)]);
  const seen = new Set(days.map((o) => o.id));
  return [...days, ...open.filter((o) => !seen.has(o.id))];
}
/** a few (scalar) fields of every document of a collection (the search in the whole history, the customers' numbers);
    the memory repo: the list */
export async function docFields<T extends object>(ctx: Ctx, col: string, fields: string[]): Promise<(T & { id: string })[]> {
  const repo = ctx.repo;
  if (indexed(repo)) return repo.fields<T>(col, fields);
  return (await repo.list<{ id: string }>(col)).map((o) => { const r: Record<string, unknown> = { id: o.id }; for (const f of fields) r[f] = (o as unknown as Record<string, unknown>)[f]; return r as T & { id: string }; });
}
export const orderFields = <T extends object>(ctx: Ctx, fields: string[]) => docFields<T>(ctx, COL.orders, fields);
/** the documents whose indexed key is in [from, to] (the memory repo: the list, filtered by `keyOf`) */
export async function docRange<T extends { id: string }>(ctx: Ctx, col: string, key: string, from: string, to: string, keyOf: (d: T) => string): Promise<T[]> {
  const repo = ctx.repo;
  if (indexed(repo)) return repo.range<T>(col, key, from, to);
  return (await repo.list<T>(col)).filter((d) => { const k = keyOf(d); return k >= from && k <= to; });
}
/** the orders by their ids (the hits of a search) */
export async function ordersByIds(ctx: Ctx, ids: string[]): Promise<Order[]> {
  return (await Promise.all(ids.map((id) => ctx.repo.get<Order>(COL.orders, id)))).filter((o): o is Order => !!o);
}

/* ---------- the searches in the whole history (the SQLite repo by its columns; else the list, the same rules) ---------- */
export interface LightOrder { id: string; no: string; status: Order["status"]; ts: number; phone: string; name: string; placedAt: string; createdAt: string }
export interface OrdersPageQuery { statuses: string[] | null; channels: string[] | null; text: string; digits: string; limit: number }
export interface CustomerGroup { phone: string | null; userId: string | null; n: number; sum: number; lastTs: number }
interface SearchRepo extends Repo {
  orderSearch(nameKey: string, digits: string): Promise<LightOrder[]>;
  ordersPage(q: OrdersPageQuery): Promise<{ counts: Record<string, number>; ids: string[] }>;
  customerGroups(): Promise<CustomerGroup[]>;
}
const searchable = (r: Repo): r is SearchRepo => typeof (r as Partial<SearchRepo>).orderSearch === "function";
const light = (o: Order): LightOrder => ({ id: o.id, no: o.no, status: o.status, ts: o.ts, phone: o.phone || "", name: o.name || "", placedAt: o.placedAt, createdAt: o.createdAt });
/** the candidates of the admin's search (a superset: the caller checks each with its own rule) */
export async function searchOrdersLight(ctx: Ctx, nameKey: string, digits: string): Promise<LightOrder[]> {
  const repo = ctx.repo;
  if (searchable(repo)) return repo.orderSearch(nameKey, digits);
  return (await repo.list<Order>(COL.orders)).map(light);
}
/** "Поръчки" › "Всички дни": the counts by status and the newest `limit` orders that pass the filters (the memory repo: the
    same rules on the list) */
export async function ordersPage(ctx: Ctx, q: OrdersPageQuery): Promise<{ counts: Record<string, number>; orders: Order[] }> {
  const repo = ctx.repo;
  if (searchable(repo)) { const r = await repo.ordersPage(q); const by = new Map((await ordersByIds(ctx, r.ids)).map((o) => [o.id, o])); return { counts: r.counts, orders: r.ids.map((id) => by.get(id)).filter((o): o is Order => !!o) }; }
  const all = (await repo.list<Order>(COL.orders)).sort((a, b) => +b.no - +a.no), counts: Record<string, number> = {};
  for (const o of all) counts[o.status] = (counts[o.status] || 0) + 1;
  const tx = (o: Order) => !q.text || o.no === q.digits || (q.digits.length >= 3 && (o.phone || "").endsWith(q.digits)) || (q.text.length >= 3 && (o.addr || "").toLowerCase().includes(q.text)) || (q.text.length >= 2 && (o.name || "").toLowerCase().includes(q.text));
  return { counts, orders: all.filter((o) => (!q.statuses || q.statuses.includes(o.status)) && (!q.channels || q.channels.includes(o.channel)) && tx(o)).slice(0, q.limit) };
}
/** "Клиенти": the orders grouped by phone and account (each order once) */
export async function customerGroups(ctx: Ctx): Promise<CustomerGroup[]> {
  const repo = ctx.repo;
  if (searchable(repo)) return repo.customerGroups();
  const m = new Map<string, CustomerGroup>();
  for (const o of await repo.list<Order>(COL.orders)) {
    const k = (o.phone || "") + "|" + (o.userId || ""), g = m.get(k) || { phone: o.phone || null, userId: o.userId || null, n: 0, sum: 0, lastTs: 0 };
    g.n++; if (o.status !== "cancelled") g.sum = Math.round((g.sum + (o.total || 0)) * 100) / 100; g.lastTs = Math.max(g.lastTs, o.ts || 0); m.set(k, g);
  }
  return [...m.values()];
}
