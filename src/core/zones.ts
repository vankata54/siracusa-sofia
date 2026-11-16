/* Delivery zones in the admin (section "Зони за доставка"; design/pages-admin/zones.html): per quarter "Доставяме"
   (on / off), free or paid with the fee, the minimum order, the time (15-90 min) and the hours (never after 21:00).
   The zones themselves (names, addresses) stay the six of lib/zones.ts ("Нарисувай зона" is "Скоро").
   The order (core/orders.ts) reads the live zone from here: the fee and the minutes for the price, and the rules
   (off, minimum, hours) refuse an order with a clear text. The site gets the zones at the next rebuild (site-data.ts). */
import { audit } from "./audit.ts";
import { type Ctx } from "./ctx.ts";
import { CoreError } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { need, invalid, money, HHMM, toMin } from "./rights.ts";
import { getSection, writeSection, zoneOf, ZONE_FROM, ZONE_TO, type ZoneRow } from "./site-data.ts";
import { fmt } from "../lib/format.ts";
import type { Zone } from "../lib/consts.ts";

export const ZONE_MSG = {
  unknown: "Няма такъв квартал.",
  fee: "Таксата е от 0 до 50 €, например 2,50 (или празно, докато не е ясна).",
  min: "Минималната поръчка е от 0 до 500 € (или празно).",
  eta: "Времето е цяло число от 15 до 90 минути.",
  hours: "Часовете са от 10:00 до 21:00 през 15 минути, началото преди края.",
  off: (n: string) => "Временно не доставяме до " + n + ". Изберете „Вземи от място“.",
  minOrder: (n: string, min: number) => "Минималната поръчка за доставка до " + n + " е " + fmt(min) + ".",
  late: (n: string, from: string, to: string) => "Доставката до " + n + " е от " + from + " до " + to + ". Поръчки за вземане до 22:30.",
};

export interface ZonesView {
  version: number; zones: ZoneRow[]; at: string | null; by: string | null;
  summary: { free: number; paid: number; off: number; feeMissing: number; minMissing: number; eta: [number, number]; until: string };
}

/** the live zones (the core's checks; no rights: used by the order and the public /api/zones) */
export async function liveZones(ctx: Ctx): Promise<ZoneRow[]> { return (await getSection(ctx, "zones")).data; }
/** the live zone for a lib zone (by slug), as the price uses it, with the rules */
export async function liveZone(ctx: Ctx, z: Zone): Promise<{ row: ZoneRow; zone: Zone } | null> {
  const row = (await liveZones(ctx)).find((r) => r.slug === z.slug);
  return row ? { row, zone: zoneOf(row, true) } : null;
}
/** the public list (/api/zones, api.zones() in the demo): the lib shape + on / min / from / to */
export async function publicZones(ctx: Ctx): Promise<Zone[]> { return (await liveZones(ctx)).map((r) => zoneOf(r, true)); }

export async function listZones(ctx: Ctx, s: StaffCtx): Promise<ZonesView> {
  need(s, "zones");
  const v = await getSection(ctx, "zones"), z = v.data, mins = z.map((r) => r.etaMin);
  return {
    version: v.version, zones: z, at: v.at, by: v.by,
    summary: {
      free: z.filter((r) => r.free && r.on).length, paid: z.filter((r) => !r.free && r.on).length, off: z.filter((r) => !r.on).length,
      feeMissing: z.filter((r) => !r.free && r.fee == null).length, minMissing: z.filter((r) => r.min == null).length,
      eta: [Math.min(...mins), Math.max(...mins)], until: z.reduce((a, r) => (r.on && r.to > a ? r.to : a), "00:00"),
    },
  };
}

export type ZonePatch = Partial<Pick<ZoneRow, "on" | "free" | "etaMin" | "from" | "to">> & { fee?: number | string | null; min?: number | string | null };
const LABEL: Record<string, string> = { on: "Доставяме", free: "Безплатна доставка", fee: "Такса", min: "Минимална поръчка", etaMin: "Време", from: "От", to: "До" };
const show = (k: string, v: unknown) => (v == null ? "[ЛИПСВА]" : typeof v === "boolean" ? (v ? "да" : "не") : k === "fee" || k === "min" ? fmt(v as number) : k === "etaMin" ? v + " мин" : String(v));

/** One quarter: only the fields sent change. 422 with fields; 409 "conflict" for an old version. Log: zones.update. */
export async function saveZone(ctx: Ctx, s: StaffCtx, slug: string, patch: ZonePatch, version?: number): Promise<ZonesView> {
  need(s, "zones");
  const p = patch && typeof patch === "object" ? patch : {};
  await writeSection(ctx, "zones", s.user.username, version, async (cur) => {
    const i = cur.findIndex((r) => r.slug === slug);
    if (i < 0) throw new CoreError("not_found", ZONE_MSG.unknown, 404);
    const r = { ...cur[i] }, f: Record<string, string> = {};
    if (p.on !== undefined) r.on = p.on === true;
    if (p.free !== undefined) r.free = p.free === true;
    if (p.fee !== undefined) { const v = money(p.fee); if (v !== null && !(v >= 0 && v <= 50)) f.fee = ZONE_MSG.fee; else r.fee = v; }
    if (p.min !== undefined) { const v = money(p.min); if (v !== null && !(v >= 0 && v <= 500)) f.min = ZONE_MSG.min; else r.min = v; }
    if (p.etaMin !== undefined) { const v = +(p.etaMin as number); if (!Number.isInteger(v) || v < 15 || v > 90) f.etaMin = ZONE_MSG.eta; else r.etaMin = v; }
    if (p.from !== undefined) r.from = String(p.from);
    if (p.to !== undefined) r.to = String(p.to);
    const okT = (t: string) => HHMM.test(t) && toMin(t) % 15 === 0;
    if (!okT(r.from) || !okT(r.to) || r.from < ZONE_FROM || r.to > ZONE_TO || toMin(r.to) - toMin(r.from) < 30) f[p.to !== undefined ? "to" : "from"] = ZONE_MSG.hours;
    if (r.free) r.fee = null;
    if (Object.keys(f).length) invalid(f);
    const changes = (Object.keys(LABEL) as (keyof ZoneRow)[]).filter((k) => r[k] !== cur[i][k]).map((k) => ({ key: k, label: LABEL[k], from: show(k, cur[i][k]), to: show(k, r[k]) }));
    cur[i] = r;
    if (changes.length) await audit(ctx, s.user.username, "zones.update", slug, { n: r.n, changes });
    return { data: cur, result: {} };
  });
  return listZones(ctx, s);
}

/** The rules of a live zone for an order (core/orders.ts): null = fine, else the field and the text.
    now: minutes on the shop clock for an order now; slot: minutes of a pre-order / a later time today; sub: the dishes. */
export function zoneRule(row: ZoneRow, o: { now?: number | null; slot?: number | null; sub?: number | null }): { field: "addr" | "slot"; code: string; msg: string } | null {
  if (!row.on) return { field: "addr", code: "zone_off", msg: ZONE_MSG.off(row.n) };
  const from = toMin(row.from), to = toMin(row.to);
  if (o.slot != null && (o.slot < from || o.slot > to - 15)) return { field: "slot", code: "delivery_closed", msg: ZONE_MSG.late(row.n, row.from, row.to) };
  if (o.slot == null && o.now != null && (o.now < from || o.now >= to)) return { field: "addr", code: "delivery_closed", msg: ZONE_MSG.late(row.n, row.from, row.to) };
  if (o.sub != null && row.min != null && o.sub < row.min) return { field: "addr", code: "min_order", msg: ZONE_MSG.minOrder(row.n, row.min) };
  return null;
}
