/* "Данни на сайта" (decision 16.11.2026, part 3 of the admin): the delivery zones, the hall (tables and plan), the events
   and the offers are edited in the admin and shown on the static site, like the menu.
   - A change goes into the live data of the core at once (prices, zones, reservation checks read it from here) and the
     server rebuilds the site through the same queue as the menu (ctx.onSite -> server/publish.ts, one build at a time);
     the build reads the data from one file (SITE_FILE, scripts/site-file.mjs), as MENU_FILE for the menu.
   - Documents (collection `settings`, no migration): "site:zones", "site:hall", "site:events", "site:offers", each
     {version, data, at, by}. Nothing stored = the built-in data (src/lib/zones-data.ts, tables.ts, events.ts, offers.ts),
     so a fresh database builds exactly the same site. The version only grows: a screen with an old version gets 409.
   - The demo has no rebuild (the static pages stay); the demo core puts the zones and tables into the page's own lib
     arrays, so the demo's cart and reservation follow the admin at once. */
import { COL, iso, type Ctx } from "./ctx.ts";
import { CoreError } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { serial, need } from "./rights.ts";
import { ZONES, RESTAURANT, type Zone, type Table } from "../lib/consts.ts";
import { TABLES } from "../lib/tables.ts";
import { events as builtinEvents } from "../lib/events.ts";

/* ---------- data shapes ---------- */
export interface ZoneRow { slug: string; n: string; free: boolean; fee: number | null; min: number | null; etaMin: number; on: boolean; from: string; to: string }
export interface HallTable extends Table { cx: number; cy: number; walkin: boolean; off: boolean }
export interface HallData { tables: HallTable[]; gardenOpen: boolean; merges: string[][] }
export type PriceMode = "price" | "free" | "tbd";
export interface EventRow {
  id: string; n: string; cat: string; date: string | null; recur: "last-sat" | null; time: string; text: string; prog: string; menu: string;
  priceMode: PriceMode; price: number | null; seats: number | null; status: "draft" | "published"; createdAt: string; updatedAt: string; by?: string;
}
export interface EventsData { rows: EventRow[]; /** every address that was ever published: a gone one -> 301 to /sabitia/ */ ever: string[] }
export type OfferChannel = "delivery" | "pickup" | "table" | "office";
export interface OfferRule { days: number[]; from: string; to: string; ch: OfferChannel[]; dish: "all" | "lunch" | string[] }
export interface OfferRow {
  id: string; kind: "pct" | "gift"; pct: number | null; gift?: string; ic: string; title: string; sub: string; text: string; on: boolean; r: OfferRule;
  /** decision 19 (-30% lunch after 15:00): only shown, never changed */
  lock?: boolean;
  /** cannot be turned on while this is missing (the early days in the settings, the loyalty rule) */
  needs?: "earlyDays" | "loyalty";
  rule?: string; custom?: boolean;
}
export interface SiteSections { zones: ZoneRow[]; hall: HallData; events: EventsData; offers: OfferRow[] }
export type SiteSection = keyof SiteSections;
export const SITE_SECTIONS: SiteSection[] = ["zones", "hall", "events", "offers"];

/** the file of the rebuild (scripts/site-file.mjs): only published rows, only what the pages use */
export interface SiteBuild {
  zones: Zone[]; tables: Table[];
  events: { id: string; n: string; cat: string; date: string | null; recur: "last-sat" | null; time: string; price: number | null; free: boolean; seatsLeft: number | null; text: string; note: string }[];
  eventExtra: Record<string, { prog: string; menu: string }>;
  offersOff: string[];
  redirects: Record<string, string>;
}

export const SITE_MSG = {
  conflict: "Някой друг промени данните току-що. Заредете ги пак.",
};

/* ---------- the built-in data (copied at start, before anything is applied) ---------- */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const BUILT_ZONES: Zone[] = clone(ZONES);
const BUILT_TABLES: Table[] = clone(TABLES);
const BUILT_EVENT = builtinEvents(new Date())[0];
export const ZONE_FROM = "10:00", ZONE_TO = RESTAURANT.delivery; /* 21:00: delivery ends (CLAUDE.md) */
/** the plan's coordinates of a table from its place in the 4-column grid (the editor moves cx / cy, the site keeps x / y) */
export const planXY = (x: number, y: number) => ({ cx: 100 + x * 200, cy: 100 + y * 180 });
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0], ALL_CH: OfferChannel[] = ["delivery", "pickup", "table", "office"];

export function defaultSections(): SiteSections {
  return {
    zones: BUILT_ZONES.map((z) => ({ slug: z.slug, n: z.n, free: z.free, fee: z.free ? null : z.fee ?? null, min: null, etaMin: z.etaMin, on: true, from: ZONE_FROM, to: ZONE_TO })),
    hall: { tables: BUILT_TABLES.map((t) => ({ ...t, ...planXY(t.x, t.y), walkin: true, off: false })), gardenOpen: true, merges: [] },
    events: {
      rows: BUILT_EVENT ? [{
        id: BUILT_EVENT.id, n: BUILT_EVENT.n, cat: BUILT_EVENT.cat, date: null, recur: "last-sat", time: BUILT_EVENT.time, text: BUILT_EVENT.text,
        prog: "", menu: "", priceMode: BUILT_EVENT.free ? "free" : BUILT_EVENT.price != null ? "price" : "tbd", price: BUILT_EVENT.price, seats: BUILT_EVENT.seatsLeft,
        status: "published", createdAt: "2026-11-04T00:00:00.000Z", updatedAt: "2026-11-04T00:00:00.000Z",
      }] : [],
      ever: BUILT_EVENT ? [BUILT_EVENT.id] : [],
    },
    /* the offers of the approved admin prototype (design/pages-admin/offers.html) */
    offers: [
      { id: "lunch30", kind: "pct", pct: 30, ic: "bowl-food", title: "Обедното меню след 15:00", sub: "при вземане от място", text: "Отстъпката се смята сама в количката. След 15:00 обедното меню не се доставя.", on: true, r: { days: [1, 2, 3, 4, 5], from: "15:00", to: "22:30", ch: ["pickup"], dish: "lunch" }, rule: "Правило от решенията (19)", lock: true },
      { id: "signup", kind: "pct", pct: 10, ic: "user", title: "Направете профил", sub: "от следващата поръчка", text: "Веднъж на телефонен номер, дори след изтриване на профила. Прилага се сам на следващата поръчка.", on: true, r: { days: ALL_DAYS, from: "10:00", to: "22:30", ch: ["delivery", "pickup"], dish: "all" }, rule: "Решение 27" },
      { id: "rating", kind: "pct", pct: 10, ic: "chat-circle-dots", title: "Кажете ни как беше", sub: "за кратка оценка", text: "Еднакво при „Да“ и при „Не“. Код SC10- с 10 цифри, веднъж, на ястията (не на таксата), не се комбинира с -30%.", on: true, r: { days: ALL_DAYS, from: "10:00", to: "22:30", ch: ["delivery", "pickup", "table"], dish: "all" }, rule: "Решение 30" },
      { id: "birthday", kind: "gift", pct: 10, gift: "или малка торта", ic: "cake", title: "Рожден ден при нас", sub: "или малка торта", text: "Само с отделно съгласие „Искам подарък за рождения си ден“. Пишем седмица по-рано.", on: true, r: { days: ALL_DAYS, from: "10:00", to: "23:00", ch: ["table"], dish: "all" } },
      { id: "celebration", kind: "pct", pct: 5, ic: "confetti", title: "Ранна резервация на празник", sub: "от крайната цена", text: "Само за празник (не за тематични вечери). Показва се, щом зададете колко дни по-рано.", on: false, needs: "earlyDays", r: { days: ALL_DAYS, from: "10:00", to: "23:00", ch: ["table"], dish: "all" } },
      { id: "loyalty", kind: "gift", pct: null, ic: "seal-check", title: "Карта с печати", sub: "на 10-ия печат", text: "За какво се дава печат и каква е наградата: [ЛИПСВА: правило и награда].", on: false, needs: "loyalty", r: { days: ALL_DAYS, from: "10:00", to: "22:30", ch: ALL_CH, dish: "all" } },
      { id: "voucher", kind: "gift", pct: null, ic: "gift", title: "Ваучер за подарък", sub: "сума по избор", text: "Запитване от сайта, плащане на място. Валидност: [ЛИПСВА: от собственика].", on: true, r: { days: ALL_DAYS, from: "10:00", to: "23:00", ch: ["table", "pickup"], dish: "all" } },
    ],
  };
}

/* ---------- documents ---------- */
interface SiteDoc<K extends SiteSection> { id: string; version: number; data: SiteSections[K]; at?: string; by?: string }
export interface SectionView<K extends SiteSection> { version: number; data: SiteSections[K]; at: string | null; by: string | null }

export async function getSection<K extends SiteSection>(ctx: Ctx, sec: K): Promise<SectionView<K>> {
  const d = await ctx.repo.get<SiteDoc<K>>(COL.settings, "site:" + sec);
  return d && d.data != null ? { version: d.version, data: d.data, at: d.at || null, by: d.by || null } : { version: 0, data: defaultSections()[sec], at: null, by: null };
}
export async function allSections(ctx: Ctx): Promise<SiteSections & { versions: Record<SiteSection, number> }> {
  const [z, h, e, o] = await Promise.all([getSection(ctx, "zones"), getSection(ctx, "hall"), getSection(ctx, "events"), getSection(ctx, "offers")]);
  return { zones: z.data, hall: h.data, events: e.data, offers: o.data, versions: { zones: z.version, hall: h.version, events: e.version, offers: o.version } };
}

/** Writes one section: `version` is the one the screen loaded (409 "conflict" with the current version when someone else
    wrote first; undefined = no check, for single switches). `make` gets the current data and returns the new data. */
export async function writeSection<K extends SiteSection, R>(ctx: Ctx, sec: K, actor: string, version: number | undefined,
  make: (cur: SiteSections[K]) => Promise<{ data: SiteSections[K]; result: R }> | { data: SiteSections[K]; result: R }): Promise<R & { version: number }> {
  const out = await serial(ctx.repo, "site:" + sec, async () => {
    const cur = await getSection(ctx, sec);
    if (version != null && version !== cur.version) throw Object.assign(new CoreError("conflict", SITE_MSG.conflict, 409), { version: cur.version });
    const { data, result } = await make(clone(cur.data));
    const doc: SiteDoc<K> = { id: "site:" + sec, version: cur.version + 1, data, at: iso(ctx), by: actor };
    await ctx.repo.put(COL.settings, doc);
    return { ...result, version: doc.version } as R & { version: number };
  });
  await siteChanged(ctx);
  return out;
}

/* ---------- what the site gets ---------- */
const NB = " ";
export const zoneEta = (min: number) => "около " + min + NB + "мин";
/** a zone as the site and the price use it (lib Zone): the fee only for a paid zone; + the admin's rules for the core */
export function zoneOf(r: ZoneRow, withRules = false): Zone {
  const z: Zone = { n: r.n, slug: r.slug, etaMin: r.etaMin, free: r.free, ...(r.free ? {} : { fee: r.fee }), eta: zoneEta(r.etaMin) };
  return withRules ? { ...z, on: r.on, min: r.min, from: r.from, to: r.to } : z;
}
/** "[ЛИПСВА: програма, меню и цена]" from what is missing ("" when nothing is) */
export function eventNote(e: Pick<EventRow, "prog" | "menu" | "priceMode">): string {
  const miss = [e.prog ? "" : "програма", e.menu ? "" : "меню", e.priceMode === "tbd" ? "цена" : ""].filter(Boolean);
  return miss.length ? "[ЛИПСВА: " + (miss.length > 1 ? miss.slice(0, -1).join(", ") + " и " + miss[miss.length - 1] : miss[0]) + "]" : "";
}
/** the banner offers of the site (lib/offers.ts) that an admin offer turns off */
const BANNER: Record<string, string> = { birthday: "birthday", signup: "signup" };
const siteTable = (t: HallTable): Table => ({ id: t.id, n: t.n, zone: t.zone, seats: t.seats, shape: t.shape, x: t.x, y: t.y, window: t.window, stroller: t.stroller, access: t.access });

export function buildOf(s: SiteSections): SiteBuild {
  const pub = s.events.rows.filter((e) => e.status === "published");
  const redirects: Record<string, string> = {};
  for (const id of s.events.ever) if (!pub.some((e) => e.id === id)) redirects["/sabitia/" + id + "/"] = "/sabitia/";
  return {
    zones: s.zones.map((r) => zoneOf(r)),
    tables: s.hall.tables.filter((t) => !t.off).map(siteTable),
    events: pub.map((e) => ({ id: e.id, n: e.n, cat: e.cat, date: e.recur ? null : e.date, recur: e.recur, time: e.time, price: e.priceMode === "price" ? e.price : null, free: e.priceMode === "free", seatsLeft: e.seats, text: e.text, note: eventNote(e) })),
    eventExtra: Object.fromEntries(pub.filter((e) => e.prog || e.menu).map((e) => [e.id, { prog: e.prog, menu: e.menu }])),
    offersOff: s.offers.filter((o) => !o.on && BANNER[o.id]).map((o) => BANNER[o.id]),
    redirects,
  };
}
/** the data of the rebuild (SITE_FILE) */
export async function siteBuild(ctx: Ctx): Promise<SiteBuild> { return buildOf(await allSections(ctx)); }
/** has anything been changed from the built-in data (the server rebuilds at start only then) */
export async function siteVersion(ctx: Ctx): Promise<number> {
  const a = await allSections(ctx);
  return a.versions.zones + a.versions.hall + a.versions.events + a.versions.offers;
}

/* ---------- into this process ---------- */
/** The demo: the zones and tables into the page's lib arrays (in place), so the demo's cart and reservation follow the
    admin without a rebuild. The server keeps the arrays of its build: the core reads the live data from the documents. */
export async function applySite(ctx: Ctx): Promise<void> {
  if (!ctx.demo) return;
  const s = await allSections(ctx);
  ZONES.splice(0, ZONES.length, ...s.zones.map((r) => zoneOf(r, true)));
  TABLES.splice(0, TABLES.length, ...s.hall.tables.filter((t) => !t.off).map(siteTable));
}
export async function bootSite(ctx: Ctx): Promise<void> { await applySite(ctx); }
async function siteChanged(ctx: Ctx): Promise<void> {
  await applySite(ctx);
  if (ctx.onSite) { try { ctx.onSite(await siteBuild(ctx)); } catch { /* the rebuild must never break a write */ } }
}

/** what the screens show about the site data: the version and who / when of each section; mode "demo": the static site
    is not rebuilt (the server adds the state of the rebuild queue) */
export async function siteState(ctx: Ctx, s: StaffCtx): Promise<{ mode: "server" | "demo"; sections: Record<SiteSection, { version: number; at: string | null; by: string | null }> }> {
  need(s, ["zones", "hall", "events", "offers"]);
  const out = {} as Record<SiteSection, { version: number; at: string | null; by: string | null }>;
  for (const k of SITE_SECTIONS) { const v = await getSection(ctx, k); out[k] = { version: v.version, at: v.at, by: v.by }; }
  return { mode: ctx.demo ? "demo" : "server", sections: out };
}
