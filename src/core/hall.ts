/* The hall in the admin (section "Залата и масите"; design/pages-admin/hall.html) and the QR codes of the tables
   (section "QR генератор"; qr.html). The tables live in the core (site-data.ts "site:hall") instead of src/lib/tables.ts:
   the reservations (online and from the staff) and the QR table read them from here; the site's reservation page gets
   them at the next rebuild. [ЛИПСВА: истински маси и план]: the built-in plan is the mock one of the prototype.
   - a table: number, Салон / Градина, seats 1-12 (the shape follows the seats), by the window, stroller, accessible,
     "Само с резервация" (walkin: false, never given to guests without a booking), its place on the plan (cx, cy, step 10)
     and in the site's 4-column grid (x, y);
   - "Махни масата" never deletes: off (future bookings and the history keep their table; its QR code stops working);
   - joined tables (merges): a booking of one holds the whole group and may have the seats of the whole group;
   - "Градината е отворена": when closed, the garden's tables are taken for online bookings.
   QR: one random code per table (8 characters without 0/o/1/l/i, crypto), the address /masa/<code>/; "Нов код" makes a new
   one and the old label stops working. The codes are a separate document "qr" (a new code does not rebuild the site). */
import { audit } from "./audit.ts";
import { COL, iso, randomKey, type Ctx } from "./ctx.ts";
import { CoreError } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { need, invalid, serial } from "./rights.ts";
import { getSection, writeSection, planXY, type HallData, type HallTable } from "./site-data.ts";
import type { Table } from "../lib/consts.ts";

export const HALL_MSG = {
  table: "Няма такава маса.",
  seats: "Местата са от 1 до 12.",
  n: "Номерът на масата е цяло число от 1 до 999 и не се повтаря.",
  zone: "Изберете Салон или Градина.",
  place: "Мястото на плана е извън залата.",
  merge: "Обединяват се поне 2 маси от една зона; всяка маса е в едно обединяване.",
  qrGone: "Този код вече не работи. Попитайте сервитьора за новия.",
};
export const SEATS_MAX = 12, PLAN_MAX = 2000;

export interface HallView extends HallData { version: number; at: string | null; by: string | null; /** [ЛИПСВА: капацитет] */ capacity: null; missing: string }
export const HALL_MISSING = "[ЛИПСВА: истински маси и план]";

/* ---------- the live hall (no rights: the reservations and the QR table read it) ---------- */
export async function liveHall(ctx: Ctx): Promise<HallData> { return (await getSection(ctx, "hall")).data; }
/** the group of joined tables of a table (itself only when not joined) */
export function groupOf(h: HallData, id: string): string[] { return h.merges.find((g) => g.includes(id)) || [id]; }
/** the seats a booking of this table may have: the whole group when joined */
export function seatsOf(h: HallData, id: string): number {
  return groupOf(h, id).reduce((a, x) => a + (h.tables.find((t) => t.id === x && !t.off)?.seats || 0), 0);
}
/** tables never free online: removed, and the garden's while it is closed */
export function closedTables(h: HallData): string[] { return h.tables.filter((t) => t.off || (!h.gardenOpen && t.zone === "garden")).map((t) => t.id); }

export async function getHall(ctx: Ctx, s: StaffCtx): Promise<HallView> {
  need(s, ["hall", "reservations", "qr"]);
  const v = await getSection(ctx, "hall");
  return { ...v.data, version: v.version, at: v.at, by: v.by, capacity: null, missing: v.version ? "" : HALL_MISSING };
}

const shapeOf = (seats: number): Table["shape"] => (seats <= 2 ? "round" : seats <= 4 ? "square" : "rect");
const B = (v: unknown, d: boolean) => (v === undefined ? d : v === true);
const FIELDS: (keyof HallTable)[] = ["n", "zone", "seats", "cx", "cy", "window", "stroller", "access", "walkin", "off"];

/** "Запази плана": the whole plan at once (tables, joined groups, the garden). A table missing from the list stays as
    removed (off), never deleted. New tables: without an id (or "new-…"), they get S<n> / G<n> and a free place in the grid.
    422 with fields "tables.<i>.<field>" / "merges"; 409 "conflict" for an old version. Log: hall.update with what changed. */
export async function saveHall(ctx: Ctx, s: StaffCtx, input: Partial<HallData>, version?: number): Promise<HallView> {
  need(s, "hall");
  const inp = input && typeof input === "object" ? input : {};
  await writeSection(ctx, "hall", s.user.username, version, async (cur) => {
    const f: Record<string, string> = {};
    const list: unknown[] = Array.isArray(inp.tables) ? inp.tables : cur.tables;
    const out: HallTable[] = [];
    const seen = new Set<string>();
    list.slice(0, 300).forEach((raw, i) => {
      const t = (raw && typeof raw === "object" ? raw : {}) as Partial<HallTable>;
      const old = typeof t.id === "string" ? cur.tables.find((x) => x.id === t.id) : undefined;
      const zone = t.zone ?? old?.zone;
      if (zone !== "salon" && zone !== "garden") { f["tables." + i + ".zone"] = HALL_MSG.zone; return; }
      const seats = t.seats === undefined ? old?.seats : +t.seats;
      if (!Number.isInteger(seats) || seats! < 1 || seats! > SEATS_MAX) f["tables." + i + ".seats"] = HALL_MSG.seats;
      const n = t.n === undefined ? old?.n : +t.n;
      if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 999)) f["tables." + i + ".n"] = HALL_MSG.n;
      const cx = t.cx === undefined ? old?.cx : +t.cx, cy = t.cy === undefined ? old?.cy : +t.cy;
      if ((cx !== undefined && !(cx >= 0 && cx <= PLAN_MAX)) || (cy !== undefined && !(cy >= 0 && cy <= PLAN_MAX))) f["tables." + i + ".cx"] = HALL_MSG.place;
      if (old && seen.has(old.id)) { f["tables." + i + ".n"] = HALL_MSG.n; return; }
      if (old) seen.add(old.id);
      out.push({
        id: old ? old.id : "", n: n ?? 0, zone, seats: seats || 1, shape: shapeOf(seats || 1),
        x: old ? old.x : -1, y: old ? old.y : -1, cx: cx == null ? -1 : Math.round(cx / 10) * 10, cy: cy == null ? -1 : Math.round(cy / 10) * 10,
        window: B(t.window, old?.window ?? false), stroller: B(t.stroller, old?.stroller ?? false), access: B(t.access, old?.access ?? false),
        walkin: B(t.walkin, old?.walkin ?? true), off: B(t.off, old?.off ?? false),
      });
    });
    /* the tables the list left out: kept as removed */
    for (const t of cur.tables) if (!seen.has(t.id)) out.push({ ...t, off: true });
    /* numbers: unique among the tables in use; a new table without a number gets the next one */
    let maxN = Math.max(0, ...out.map((t) => t.n || 0));
    for (const t of out) if (!t.n) t.n = ++maxN;
    const used = out.filter((t) => !t.off);
    const dupN = used.find((t, k) => used.findIndex((u) => u.n === t.n) !== k);
    if (dupN) f["tables." + out.indexOf(dupN) + ".n"] = HALL_MSG.n;
    /* ids and places of the new tables */
    for (const t of out.filter((x) => !x.id)) {
      const p = t.zone === "salon" ? "S" : "G";
      let k = 1 + Math.max(0, ...out.filter((x) => x.id.startsWith(p)).map((x) => +x.id.slice(1) || 0));
      while (out.some((x) => x.id === p + k)) k++;
      t.id = p + k;
    }
    for (const t of out.filter((x) => x.x < 0)) {
      const taken = new Set(out.filter((x) => x !== t && x.zone === t.zone && !x.off && x.x >= 0).map((x) => x.x + ":" + x.y));
      let c = 0; while (taken.has((c % 4) + ":" + Math.floor(c / 4))) c++;
      t.x = c % 4; t.y = Math.floor(c / 4);
    }
    for (const t of out) if (t.cx < 0 || t.cy < 0) Object.assign(t, planXY(t.x, t.y));
    /* joined tables */
    const merges: string[][] = [];
    const inMerge = new Set<string>();
    for (const g0 of Array.isArray(inp.merges) ? inp.merges : inp.merges === undefined ? cur.merges : []) {
      const g = Array.isArray(g0) ? [...new Set(g0.map(String))] : [];
      const ts = g.map((id) => out.find((t) => t.id === id && !t.off));
      if (g.length < 2 || ts.some((t) => !t) || new Set(ts.map((t) => t!.zone)).size > 1 || g.some((id) => inMerge.has(id))) { f.merges = HALL_MSG.merge; continue; }
      g.forEach((id) => inMerge.add(id));
      merges.push(g);
    }
    if (Object.keys(f).length) invalid(f);
    const gardenOpen = inp.gardenOpen === undefined ? cur.gardenOpen : inp.gardenOpen === true;
    /* what changed, for the log ("Маса 6: места 4 → 6") */
    const added = out.filter((t) => !cur.tables.some((c) => c.id === t.id)).map((t) => t.id);
    const removed = out.filter((t) => t.off && cur.tables.some((c) => c.id === t.id && !c.off)).map((t) => t.id);
    const changed = out.filter((t) => !added.includes(t.id) && !removed.includes(t.id)).map((t) => {
      const c = cur.tables.find((x) => x.id === t.id)!;
      const keys = FIELDS.filter((k) => t[k] !== c[k]);
      return keys.length ? { id: t.id, n: t.n, fields: keys.map((k) => ({ key: k, from: c[k], to: t[k] })) } : null;
    }).filter(Boolean);
    const mergesChanged = JSON.stringify(merges) !== JSON.stringify(cur.merges);
    if (added.length || removed.length || changed.length || mergesChanged || gardenOpen !== cur.gardenOpen)
      await audit(ctx, s.user.username, "hall.update", "hall", { added, removed, changed, merges: mergesChanged ? merges : undefined, gardenOpen: gardenOpen !== cur.gardenOpen ? gardenOpen : undefined });
    return { data: { tables: out, merges, gardenOpen }, result: {} };
  });
  return getHall(ctx, s);
}

/* ---------- QR codes ---------- */
interface QrDoc { id: "qr"; codes: Record<string, string>; at: string }
export interface QrRow { id: string; n: number; zone: "salon" | "garden"; code: string; url: string }
const qrUrl = (code: string) => "/masa/" + code + "/";
async function qrDoc(ctx: Ctx): Promise<QrDoc> { return (await ctx.repo.get<QrDoc>(COL.settings, "qr")) || { id: "qr", codes: {}, at: iso(ctx) }; }
const newCode = (taken: Set<string>) => { let c = randomKey(8); while (taken.has(c)) c = randomKey(8); return c; };

/** every table in use with its code (a table without one gets it now: stable from then on) */
export async function qrList(ctx: Ctx, s: StaffCtx): Promise<QrRow[]> {
  need(s, ["qr", "hall"]);
  const h = await liveHall(ctx);
  const d = await serial(ctx.repo, "qr", async () => {
    const d = await qrDoc(ctx);
    const taken = new Set(Object.values(d.codes));
    let n = 0;
    for (const t of h.tables) if (!t.off && !d.codes[t.id]) { const c = newCode(taken); taken.add(c); d.codes[t.id] = c; n++; }
    if (n) { d.at = iso(ctx); await ctx.repo.put(COL.settings, d); }
    return d;
  });
  return h.tables.filter((t) => !t.off).sort((a, b) => a.n - b.n).map((t) => ({ id: t.id, n: t.n, zone: t.zone, code: d.codes[t.id], url: qrUrl(d.codes[t.id]) }));
}
/** "Нов код": the old label stops working at once. Log: qr.renew (without the codes). */
export async function qrRenew(ctx: Ctx, s: StaffCtx, tableId: string): Promise<QrRow> {
  need(s, "qr");
  const h = await liveHall(ctx), t = h.tables.find((x) => x.id === tableId && !x.off);
  if (!t) throw new CoreError("not_found", HALL_MSG.table, 404);
  const d = await serial(ctx.repo, "qr", async () => {
    const d = await qrDoc(ctx);
    d.codes[t.id] = newCode(new Set(Object.values(d.codes))); d.at = iso(ctx);
    await ctx.repo.put(COL.settings, d);
    return d;
  });
  await audit(ctx, s.user.username, "qr.renew", t.id, { n: t.n });
  return { id: t.id, n: t.n, zone: t.zone, code: d.codes[t.id], url: qrUrl(d.codes[t.id]) };
}
/** the QR table (/masa/<code>/, public): the table, or 404 "Този код вече не работи" (an old or unknown code) */
export async function tableByQr(ctx: Ctx, code: string): Promise<{ id: string; n: number; zone: "salon" | "garden"; seats: number }> {
  const c = String(code || "").toLowerCase();
  const d = await qrDoc(ctx), id = /^[a-z2-9]{8}$/.test(c) ? Object.keys(d.codes).find((k) => d.codes[k] === c) : undefined;
  const t = id ? (await liveHall(ctx)).tables.find((x) => x.id === id && !x.off) : undefined;
  if (!t) throw new CoreError("not_found", HALL_MSG.qrGone, 404);
  return { id: t.id, n: t.n, zone: t.zone, seats: t.seats };
}
