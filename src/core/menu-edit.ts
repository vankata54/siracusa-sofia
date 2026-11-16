/* The menu editor (decisions 15.11.2026 „Добави“ и „Смени“, „Ново меню“, „Празна категория“, „Махнато ястие“):
   the live menu (what the site shows) and ONE shared draft with a version (two people editing at once: the second one gets
   409 "conflict" instead of overwriting). "Изчерпано днес" stays outside the draft (core/menu.ts).

   Documents (collection `settings`, no migration):
   - "menu-live":  {version, menu, at, by, count}: the published menu. Nothing stored: the built-in menu (src/data/menu.json).
   - "menu-prev":  the live menu before the last "Публикувай" / "Връщане" (one step back, "връщане с един бутон").
   - "menu-draft": {version, menu | null}: the shared draft; null = no changes (the editor starts from the live menu).
     The version only grows (also after "Откажи" and "Публикувай"), so a screen with an old version never writes over.

   The data = Menu (src/data/menu.ts) + opts ("Добави" / "Смени") + removed (dishes taken off the menu, kept for reference:
   old orders, the kitchen, a cart, the 301) + redirects (old public addresses -> where they lead now).
   A new dish or category has a temporary id ("new-…") in the draft; at "Публикувай" it gets its id and address by the
   rule of scripts/slug.mjs (src/lib/slug.ts: whole words, up to 72 characters, unique, never another dish's id).
   After publish / rollback the live menu goes into src/lib/data.ts (setMenu) in this process: prices, "Добави",
   "Изчерпано днес", orders, /api/menu and the search read it at once; ctx.onMenu tells the server to rebuild the site. */
import { COL, emit, iso, rid, type Ctx } from "./ctx.ts";
import { CoreError } from "./types.ts";
import { audit } from "./audit.ts";
import type { StaffCtx } from "./staff.ts";
import { MENU, type Menu, type Dish, type Category, type MenuOpts, type Course, type TagId, type AllergenId, type SwapGroup } from "../data/menu.ts";
import { setMenu, defaultOpts, TAGS, ALLERGENS, ORDER_RULES } from "../lib/data.ts";
import { fmt } from "../lib/format.ts";
import { newSlug } from "../lib/slug.ts";
import { lunchToday } from "./lunch.ts";
import { soldOutToday } from "./menu.ts";

/** the menu built into this process at start (before any setMenu): the base when nothing is published */
const BUILT: Menu = JSON.parse(JSON.stringify(MENU));

export interface MenuDoc { id: string; version: number; menu: Menu | null; at?: string; by?: string; count?: number }
export interface FieldChange { key: string; label: string; from: string; to: string }
export interface MenuChanges {
  dishes: { added: { id: string; n: string; cat: string }[]; changed: { id: string; n: string; fields: FieldChange[] }[]; removed: { id: string; n: string; cat: string; to: string }[] };
  cats: { added: { id: string; n: string }[]; renamed: { id: string; from: string; to: string }[]; removed: { id: string; n: string }[]; order: boolean; empty: { id: string; n: string }[] };
  opts: string[];
  /** dishes without a composition: they never pass the filters "без …" (decision 15.11.2026); does not stop publishing */
  noComp: { id: string; n: string }[];
  count: number;
}
export interface DraftView { version: number; menu: Menu; changes: MenuChanges; at?: string; by?: string }
export interface PublishState {
  mode: "server" | "demo"; version: number; at: string | null; by: string | null; count: number;
  prev: { version: number; at: string | null } | null; draft: { version: number; count: number };
}

export const MENU_MSG = {
  conflict: "Някой друг промени черновата. Заредете я пак.",
  conflictLive: "Менюто току-що беше публикувано от друг. Заредете го пак.",
  nothing: "Няма промени за публикуване.",
  noPrev: "Няма предишна версия за връщане.",
  invalid: "Проверете полетата в менюто.",
  price: "Напишете цена като 10,22.",
};

const COURSES: Course[] = ["starter", "salad", "main", "side", "sauce", "dessert", "drink", "addon", "breakfast"];
const ALL_AL = ALLERGENS.map((a) => a[0]);
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TEMP_RE = /^new-[a-z0-9]{1,24}$/;
const MEDIA_RE = /^\/media\/[a-f0-9]{64}\.(webp|jpg|png)$/;
const DATA_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
/** in the demo the photo stays in the draft as a data: URL; at most this long (localStorage is about 5 MB) */
export const DEMO_PHOTO_MAX = 1_400_000;

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v)).replace(/\s+/g, " ").trim();

function need(s: StaffCtx, section: string) {
  if (!s || !s.user) throw new CoreError("auth", "Влезте отново.", 401);
  if (s.user.role !== "admin" && !s.sections.includes(section)) throw new CoreError("forbidden", "Нямате права за този раздел.", 403);
}
function invalid(fields: Record<string, string>): never {
  throw Object.assign(new CoreError("invalid", MENU_MSG.invalid, 422), { fields });
}

/* one write at a time per store (the demo and the tests run calls in parallel in one event loop) */
const locks = new WeakMap<object, Promise<unknown>>();
async function serial<T>(ctx: Ctx, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(ctx.repo) || Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((r) => { release = r; });
  locks.set(ctx.repo, prev.then(() => mine));
  await prev.catch(() => undefined);
  try { return await fn(); } finally { release(); }
}

/* ---------- documents ---------- */
/** the built-in menu in the editor's shape (opts by default, nothing removed) */
export function builtinMenu(): Menu {
  const m = clone(BUILT);
  return { ...m, opts: m.opts || defaultOpts(), removed: m.removed || [], redirects: m.redirects || {} };
}
async function liveDoc(ctx: Ctx): Promise<MenuDoc & { menu: Menu }> {
  const d = await ctx.repo.get<MenuDoc>(COL.settings, "menu-live");
  return d && d.menu ? (d as MenuDoc & { menu: Menu }) : { id: "menu-live", version: 0, menu: builtinMenu(), at: undefined, by: undefined };
}
async function draftDoc(ctx: Ctx): Promise<MenuDoc> {
  return (await ctx.repo.get<MenuDoc>(COL.settings, "menu-draft")) || { id: "menu-draft", version: 0, menu: null };
}
/** the live menu (published, or the built-in one) and its version */
export async function getLive(ctx: Ctx): Promise<{ version: number; menu: Menu; at: string | null; by: string | null }> {
  const d = await liveDoc(ctx);
  return { version: d.version, menu: d.menu, at: d.at || null, by: d.by || null };
}

/** What the site and the core use now: the live menu, its lunch replaced by today's published lunch menu (core/lunch.ts). */
export async function effectiveMenu(ctx: Ctx): Promise<Menu> {
  const live = (await liveDoc(ctx)).menu;
  const l = await lunchToday(ctx);
  return l ? { ...live, lunch: l } : live;
}

/** The menu for the site, the kitchen and the staff (/api/menu, api.menu() in the demo): the effective menu with today's
    "Изчерпано днес" (core/menu.ts) in `t` and `lunch.items[].out`; only categories with a dish; no redirects. */
export async function siteMenu(ctx: Ctx): Promise<Menu> {
  const m = await effectiveMenu(ctx), today = await soldOutToday(ctx);
  const flag = (id: string, base: boolean) => (own(today, id) ? !!today[id] : base);
  const used = new Set(m.items.map((x) => x.cat));
  return {
    updated: m.updated, source: m.source, cats: m.cats.filter((c) => used.has(c.id)),
    items: m.items.map((x) => {
      const was = x.t.includes("out"), now = flag(x.id, was);
      return now === was ? x : { ...x, t: now ? [...x.t, "out"] : x.t.filter((t) => t !== "out") };
    }),
    lunch: { ...m.lunch, items: m.lunch.items.map((x) => ({ ...x, out: flag(x.id, !!x.out) })) },
    opts: m.opts || defaultOpts(), removed: m.removed || [],
  };
}

let applied = "";
/** Puts the effective menu into src/lib/data.ts in this process (once at start, after publish / rollback / today's lunch).
    Returns the menu and whether it changed since the last call (the server rebuilds the site only then). */
export async function refreshLive(ctx: Ctx, kind: "boot" | "publish" | "rollback" | "lunch" | "tick" = "tick"): Promise<{ menu: Menu; changed: boolean }> {
  const m = await effectiveMenu(ctx);
  const sig = JSON.stringify(m);
  const changed = sig !== applied;
  if (changed) { applied = sig; setMenu(clone(m)); }
  if (changed && kind !== "boot") { try { ctx.onMenu && ctx.onMenu(m, kind); } catch { /* the rebuild must never break a write */ } }
  return { menu: m, changed };
}
/** at start: the published menu into this process (no rebuild; the site on disk was built from it) */
export async function boot(ctx: Ctx): Promise<void> { await refreshLive(ctx, "boot"); }

/* ---------- validation and normalisation ---------- */
const label: Record<string, string> = { n: "Име", desc: "Описание", cat: "Категория", comp: "Състав", p: "Цена", g: "Грамаж", t: "Етикети", al: "Алергени", photo: "Снимка", per100: "Цена за 100 гр.", course: "Вид" };

function money(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.replace(",", ".").replace(/\s|€/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 9999) return null;
  return Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? Math.round(n * 100) / 100 : null;
}

/** Cleans a menu from a screen against the live one: only known fields, texts for people in `fields`.
    The draft keeps temporary ids of new dishes and categories; `removed` and `redirects` are always the core's. */
export function cleanMenu(input: unknown, live: Menu, opts: { demo?: boolean; mediaExists?: (url: string) => boolean } = {}): { menu: Menu; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const src = (input && typeof input === "object" ? input : {}) as Partial<Menu>;
  const liveDish = new Map<string, Dish>();
  for (const x of live.items) liveDish.set(x.id, x);
  for (const x of live.removed || []) if (!liveDish.has(x.id)) liveDish.set(x.id, x);
  const lunchIds = new Set([...BUILT.lunch.items.map((x) => x.id), ...live.lunch.items.map((x) => x.id)]);

  /* categories */
  const cats: Category[] = [], catIds = new Set<string>(), catNames = new Map<string, string>();
  const rawCats = Array.isArray(src.cats) ? src.cats.slice(0, 200) : [];
  if (!Array.isArray(src.cats)) fields.cats = "Липсват категориите.";
  for (const c0 of rawCats) {
    const c = (c0 && typeof c0 === "object" ? c0 : {}) as Partial<Category>;
    let id = str(c.id);
    if (!id) id = "new-" + rid(4);
    const key = "cats." + id;
    if (!(ID_RE.test(id) && id.length <= 72) || id === "obedno") { fields[key + ".id"] = "Невалидна категория."; continue; }
    if (catIds.has(id)) { fields[key + ".id"] = "Категорията е два пъти в менюто."; continue; }
    const n = str(c.n);
    if (!n) fields[key + ".n"] = "Напишете името на категорията.";
    else if (n.length > 60) fields[key + ".n"] = "Името на категорията е до 60 знака.";
    else if (catNames.has(n.toLowerCase())) fields[key + ".n"] = "Има категория с това име.";
    catNames.set(n.toLowerCase(), id);
    const prev = live.cats.find((z) => z.id === id);
    const course = COURSES.includes(c.course as Course) ? (c.course as Course) : prev ? prev.course : "main";
    catIds.add(id);
    cats.push({ id, n, course });
  }

  /* dishes */
  const items: Dish[] = [], ids = new Set<string>();
  const rawItems = Array.isArray(src.items) ? src.items.slice(0, 1000) : [];
  if (!Array.isArray(src.items)) fields.items = "Липсват ястията.";
  for (const x0 of rawItems) {
    const x = (x0 && typeof x0 === "object" ? x0 : {}) as Partial<Dish> & Record<string, unknown>;
    let id = str(x.id);
    if (!id) id = "new-" + rid(4);
    const key = "items." + id;
    if (!(ID_RE.test(id) && id.length <= 80) || lunchIds.has(id) || id.startsWith("l-")) { fields[key + ".id"] = "Невалидно ястие."; continue; }
    if (ids.has(id)) { fields[key + ".id"] = "Ястието е два пъти в менюто."; continue; }
    ids.add(id);
    const base = liveDish.get(id);
    const d: Dish = base ? clone(base) : { id, n: "", cat: "", course: "main", comp: "", g: "", p: 0, t: [], al: [], noOnion: false, share: false };
    delete d.removed;
    const n = str(x.n);
    if (!n) fields[key + ".n"] = "Напишете името на ястието.";
    else if (n.length > 120) fields[key + ".n"] = "Името е до 120 знака.";
    d.n = n;
    const cat = str(x.cat);
    if (!catIds.has(cat)) fields[key + ".cat"] = "Изберете категория.";
    d.cat = cat;
    const cc = cats.find((z) => z.id === cat);
    d.course = COURSES.includes(x.course as Course) ? (x.course as Course) : base && base.cat === cat ? base.course : cc ? cc.course : "main";
    const p = money(x.p);
    if (p == null) fields[key + ".p"] = MENU_MSG.price;
    else { if (base && base.p !== p) { delete d.lv; delete d.site_eur; } d.p = p; }
    const comp = str(x.comp);
    if (comp.length > 1000) fields[key + ".comp"] = "Съставът е до 1000 знака.";
    d.comp = comp;
    const g = str(x.g);
    if (g.length > 40) fields[key + ".g"] = "Грамажът е до 40 знака, например 350 гр.";
    d.g = g;
    const desc = str(x.desc);
    if (desc.length > 600) fields[key + ".desc"] = "Описанието е до 600 знака.";
    if (desc) d.desc = desc; else delete d.desc;
    const t = Array.isArray(x.t) ? [...new Set(x.t.map(String))] : [];
    if (t.some((v) => !own(TAGS, v))) fields[key + ".t"] = "Непознат етикет.";
    d.t = t.filter((v) => own(TAGS, v)) as TagId[];
    const al = Array.isArray(x.al) ? [...new Set(x.al.map(String))] : [];
    if (al.some((v) => !ALL_AL.includes(v as AllergenId))) fields[key + ".al"] = "Непознат алерген.";
    d.al = al.filter((v) => ALL_AL.includes(v as AllergenId)) as AllergenId[];
    const photo = str(x.photo);
    if (photo) {
      const okDemo = !!opts.demo && DATA_RE.test(photo) && photo.length <= DEMO_PHOTO_MAX;
      if (!(MEDIA_RE.test(photo) || okDemo)) fields[key + ".photo"] = "Качете снимката отново (WebP, JPEG или PNG).";
      else if (MEDIA_RE.test(photo) && opts.mediaExists && !opts.mediaExists(photo)) fields[key + ".photo"] = "Снимката липсва. Качете я отново.";
      d.photo = photo;
    } else delete d.photo;
    if (typeof x.per100 === "boolean") { if (x.per100) d.per100 = true; else delete d.per100; }
    if (typeof x.noOnion === "boolean") d.noOnion = x.noOnion;
    if (typeof x.share === "boolean") d.share = x.share;
    items.push(d);
  }

  /* "Добави" and "Смени" */
  const o0 = (src.opts && typeof src.opts === "object" ? src.opts : live.opts || defaultOpts()) as Partial<MenuOpts>;
  const a0 = (o0.addon && typeof o0.addon === "object" ? o0.addon : {}) as Partial<MenuOpts["addon"]>;
  const addon = {
    cats: [...new Set((Array.isArray(a0.cats) ? a0.cats : ORDER_RULES.addonCats).map(String))].filter((c) => catIds.has(c)),
    dishes: {} as Record<string, boolean>,
  };
  if (a0.dishes && typeof a0.dishes === "object") for (const [k, v] of Object.entries(a0.dishes)) if (ids.has(k) && typeof v === "boolean") addon.dishes[k] = v;
  const s0 = (o0.swap && typeof o0.swap === "object" ? o0.swap : {}) as Partial<MenuOpts["swap"]>;
  const groups: SwapGroup[] = [], gIds = new Set<string>();
  for (const g0 of (Array.isArray(s0.groups) ? s0.groups : []).slice(0, 30)) {
    const g = (g0 && typeof g0 === "object" ? g0 : {}) as Partial<SwapGroup>;
    const id = /^[a-z0-9-]{1,40}$/.test(str(g.id)) ? str(g.id) : "g-" + rid(4);
    if (gIds.has(id)) continue;
    const key = "opts.swap." + id, n = str(g.n);
    if (!n || n.length > 60) fields[key + ".n"] = "Напишете името на групата (до 60 знака).";
    const vs = (Array.isArray(g.opts) ? g.opts : []).slice(0, 20).map((v, i) => {
      const vn = str(v && v.n), vp = money(v && v.p);
      if (!vn || vn.length > 60) fields[key + ".opts." + i + ".n"] = "Напишете името на опцията (до 60 знака).";
      if (vp == null) fields[key + ".opts." + i + ".p"] = "Напишете доплатата като 1,50 (или 0).";
      return { n: vn, p: vp ?? 0 };
    });
    gIds.add(id);
    groups.push({ id, n, opts: vs, cats: [...new Set((Array.isArray(g.cats) ? g.cats : []).map(String))].filter((c) => catIds.has(c)) });
  }
  const sd: Record<string, string[]> = {};
  if (s0.dishes && typeof s0.dishes === "object") for (const [k, v] of Object.entries(s0.dishes)) if (ids.has(k) && Array.isArray(v)) { const l = v.map(String).filter((z) => gIds.has(z)); if (l.length) sd[k] = [...new Set(l)]; }

  const menu: Menu = {
    updated: live.updated, source: live.source, cats, items, lunch: clone(live.lunch),
    opts: { addon, swap: { on: false, groups, dishes: sd } }, removed: clone(live.removed || []), redirects: { ...(live.redirects || {}) },
  };
  return { menu, fields };
}

/* ---------- public addresses and history ---------- */
const catPath = (c: string) => "/menu/" + c + "/";
const dishPath = (x: Dish) => "/menu/" + x.cat + "/" + (x.slug || x.id) + "/";
/** the public pages of the menu: category pages (only non-empty ones) and dish pages */
export function menuPages(m: Menu): Map<string, { kind: "cat" | "dish"; id: string }> {
  const out = new Map<string, { kind: "cat" | "dish"; id: string }>();
  const used = new Set(m.items.map((x) => x.cat));
  const known = new Set(m.cats.map((c) => c.id));
  for (const c of m.cats) if (used.has(c.id)) out.set(catPath(c.id), { kind: "cat", id: c.id });
  for (const x of m.items) if (known.has(x.cat) && !x.lunch && x.cat !== "obedno") out.set(dishPath(x), { kind: "dish", id: x.id });
  return out;
}

/** The menu as it goes live after `cur`: real ids for new dishes and categories, the removed dishes kept, the old addresses
    leading (301) to the dish's new address, its category, or /menu/. */
export function finalize(m0: Menu, cur: Menu, at: string): Menu {
  const m = clone(m0);
  /* ids for new categories and dishes: the slug rule, never an id or address in use (also of removed dishes and lunch) */
  const takenCats = new Set<string>([...cur.cats.map((c) => c.id), ...m.cats.filter((c) => !TEMP_RE.test(c.id)).map((c) => c.id), "obedno"]);
  const catMap = new Map<string, string>();
  for (const c of m.cats) if (TEMP_RE.test(c.id) && !cur.cats.some((z) => z.id === c.id)) { const id = newSlug(c.n, takenCats); takenCats.add(id); catMap.set(c.id, id); c.id = id; }
  const known = new Set<string>([...cur.items.map((x) => x.id), ...(cur.removed || []).map((x) => x.id)]);
  const takenIds = new Set<string>([...known, ...m.items.map((x) => x.id), ...m.items.map((x) => x.slug || x.id), ...(cur.removed || []).map((x) => x.slug || x.id),
    ...BUILT.lunch.items.map((x) => x.id), ...cur.lunch.items.map((x) => x.id)]);
  const idMap = new Map<string, string>();
  for (const x of m.items) {
    if (catMap.has(x.cat)) x.cat = catMap.get(x.cat)!;
    if (known.has(x.id)) continue;
    /* a new dish: its id and address from the name (the address = the id, so no slug field) */
    takenIds.delete(x.id);
    const id = newSlug(x.n, takenIds);
    takenIds.add(id);
    idMap.set(x.id, id);
    x.id = id;
    delete x.slug;
  }
  const o = m.opts || defaultOpts();
  const remap = <V>(r: Record<string, V>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [idMap.get(k) || k, v]));
  o.addon = { cats: o.addon.cats.map((c) => catMap.get(c) || c), dishes: remap(o.addon.dishes) };
  o.swap = { on: false, groups: o.swap.groups.map((g) => ({ ...g, cats: g.cats.map((c) => catMap.get(c) || c) })), dishes: remap(o.swap.dishes) };
  m.opts = o;

  /* removed: every dish that was live or removed before and is not in the menu now (unpublished new dishes just go) */
  const inMenu = new Set(m.items.map((x) => x.id));
  const removed = new Map<string, Dish>();
  for (const x of [...(cur.removed || []), ...cur.items]) if (!inMenu.has(x.id)) removed.set(x.id, { ...clone(x), removed: true });
  m.removed = [...removed.values()];

  /* redirects: old addresses -> the new address of the same dish, else its category, else /menu/ */
  const now = menuPages(m), before = menuPages(cur);
  const byIdNow = new Map(m.items.map((x) => [x.id, x]));
  const target = (dishId: string, catOf: string): string => {
    const x = byIdNow.get(dishId);
    if (x && now.has(dishPath(x))) return dishPath(x);
    const c = x ? x.cat : catOf;
    return now.has(catPath(c)) ? catPath(c) : "/menu/";
  };
  const red: Record<string, string> = {};
  const curById = new Map([...(cur.removed || []), ...cur.items].map((x) => [x.id, x]));
  for (const [p, v] of before) {
    if (now.has(p)) continue;
    if (v.kind === "cat") { red[p] = "/menu/"; continue; }
    const old = curById.get(v.id)!;
    red[p] = target(v.id, old.cat);
    /* a cut id had its own old address (/menu/<cat>/<id>/ -> 301); it keeps leading to the same place */
    if (old.slug && old.slug !== old.id) red["/menu/" + old.cat + "/" + old.id + "/"] = red[p];
  }
  /* earlier redirects: kept, re-aimed when their target is gone; dropped when the address is a page again */
  for (const [from, to] of Object.entries(cur.redirects || {})) if (!own(red, from)) red[from] = to;
  const slugAlias = new Set(m.items.filter((x) => x.slug && x.slug !== x.id).map((x) => "/menu/" + x.cat + "/" + x.id + "/"));
  for (const from of Object.keys(red)) {
    if (now.has(from) || slugAlias.has(from)) { delete red[from]; continue; }
    let to = red[from], hops = 0;
    while (!now.has(to) && to !== "/menu/" && own(red, to) && hops++ < 10) to = red[to];
    if (!now.has(to) && to !== "/menu/") {
      /* the target was a dish or a category that is gone: its category if it is shown, else the menu */
      const mm = /^\/menu\/([^/]+)\//.exec(to);
      to = mm && now.has(catPath(mm[1])) ? catPath(mm[1]) : "/menu/";
    }
    red[from] = to;
  }
  m.redirects = red;
  m.updated = at.slice(0, 10);
  return m;
}

/* ---------- changes (the summary before "Публикувай") ---------- */
const catName = (m: Menu, id: string) => (m.cats.find((c) => c.id === id) || { n: id }).n;
const tagNames = (t: string[]) => t.filter((v) => v !== "out").map((v) => (own(TAGS, v) ? TAGS[v as TagId][0] : v)).join(", ") || "няма";
const alNames = (a: string[]) => a.map((v) => (ALLERGENS.find((z) => z[0] === v) || [v, v])[1]).join(", ") || "няма";
const short = (s: string) => (s.length > 60 ? s.slice(0, 57) + "…" : s) || "няма";

export function menuChanges(live: Menu, next: Menu): MenuChanges {
  const L = new Map(live.items.map((x) => [x.id, x]));
  const N = new Map(next.items.map((x) => [x.id, x]));
  const ch: MenuChanges = { dishes: { added: [], changed: [], removed: [] }, cats: { added: [], renamed: [], removed: [], order: false, empty: [] }, opts: [], noComp: [], count: 0 };
  const nowPages = menuPages(next);
  for (const x of next.items) {
    const a = L.get(x.id);
    if (!a) { ch.dishes.added.push({ id: x.id, n: x.n, cat: x.cat }); continue; }
    const f: FieldChange[] = [];
    const add = (key: string, from: string, to: string) => f.push({ key, label: label[key] || key, from, to });
    if (a.n !== x.n) add("n", a.n, x.n);
    if (a.p !== x.p) add("p", fmt(a.p), fmt(x.p));
    if (a.cat !== x.cat) add("cat", catName(live, a.cat), catName(next, x.cat));
    if ((a.desc || "") !== (x.desc || "")) add("desc", short(a.desc || ""), short(x.desc || ""));
    if (a.comp !== x.comp) add("comp", short(a.comp), short(x.comp));
    if (a.g !== x.g) add("g", a.g || "няма", x.g || "няма");
    if (a.t.filter((v) => v !== "out").join() !== x.t.filter((v) => v !== "out").join()) add("t", tagNames(a.t), tagNames(x.t));
    if ([...a.al].sort().join() !== [...x.al].sort().join()) add("al", alNames(a.al), alNames(x.al));
    if ((a.photo || "") !== (x.photo || "")) add("photo", a.photo ? "има" : "няма", x.photo ? (a.photo ? "нова" : "има") : "махната");
    if (!!a.per100 !== !!x.per100) add("per100", a.per100 ? "да" : "не", x.per100 ? "да" : "не");
    if (f.length) ch.dishes.changed.push({ id: x.id, n: x.n, fields: f });
  }
  for (const a of live.items) if (!N.has(a.id)) {
    const c = next.cats.some((z) => z.id === a.cat) && nowPages.has(catPath(a.cat)) ? catPath(a.cat) : "/menu/";
    ch.dishes.removed.push({ id: a.id, n: a.n, cat: a.cat, to: c });
  }
  const LC = new Map(live.cats.map((c) => [c.id, c]));
  for (const c of next.cats) {
    const a = LC.get(c.id);
    if (!a) ch.cats.added.push({ id: c.id, n: c.n });
    else if (a.n !== c.n) ch.cats.renamed.push({ id: c.id, from: a.n, to: c.n });
    if (!next.items.some((x) => x.cat === c.id)) ch.cats.empty.push({ id: c.id, n: c.n });
  }
  for (const a of live.cats) if (!next.cats.some((c) => c.id === a.id)) ch.cats.removed.push({ id: a.id, n: a.n });
  const common = (l: Category[], other: Category[]) => l.filter((c) => other.some((z) => z.id === c.id)).map((c) => c.id).join();
  ch.cats.order = common(live.cats, next.cats) !== common(next.cats, live.cats);
  const lo = live.opts || defaultOpts(), no = next.opts || defaultOpts();
  const catsTxt = (l: string[], m: Menu) => l.map((c) => catName(m, c)).join(", ") || "няма";
  if ([...lo.addon.cats].sort().join() !== [...no.addon.cats].sort().join()) ch.opts.push("„Добави“ по категория: " + catsTxt(lo.addon.cats, live) + " → " + catsTxt(no.addon.cats, next));
  const dk = new Set([...Object.keys(lo.addon.dishes), ...Object.keys(no.addon.dishes)]);
  for (const k of dk) if (lo.addon.dishes[k] !== no.addon.dishes[k]) {
    const nm = (N.get(k) || L.get(k) || { n: k }).n, v = (b: boolean | undefined) => (b === true ? "Да" : b === false ? "Не" : "Като категорията");
    ch.opts.push("„Добави“ при „" + nm + "“: " + v(lo.addon.dishes[k]) + " → " + v(no.addon.dishes[k]));
  }
  if (JSON.stringify(lo.swap) !== JSON.stringify(no.swap)) ch.opts.push("„Смени“: групите са променени (скрито до новото меню)");
  ch.noComp = next.items.filter((x) => !x.comp).map((x) => ({ id: x.id, n: x.n }));
  ch.count = ch.dishes.added.length + ch.dishes.changed.length + ch.dishes.removed.length + ch.cats.added.length + ch.cats.renamed.length + ch.cats.removed.length + (ch.cats.order ? 1 : 0) + ch.opts.length;
  return ch;
}

/* ---------- the editor's API ---------- */
async function view(ctx: Ctx, d: MenuDoc, live: Menu): Promise<DraftView> {
  const menu = d.menu || clone(live);
  return { version: d.version, menu, changes: menuChanges(live, menu), ...(d.menu ? { at: d.at, by: d.by } : {}) };
}

/** The shared draft: {version, menu, changes}. No draft: the live menu, no changes. Section "Меню". */
export async function getDraft(ctx: Ctx, s: StaffCtx): Promise<DraftView> {
  need(s, "menu");
  const live = (await liveDoc(ctx)).menu;
  return view(ctx, await draftDoc(ctx), live);
}

/** Saves the whole draft. version = the one the screen loaded; another one -> 409 "conflict". Invalid -> 422 with fields. */
export async function saveDraft(ctx: Ctx, s: StaffCtx, menu: unknown, version: number): Promise<DraftView> {
  need(s, "menu");
  return serial(ctx, async () => {
    const d = await draftDoc(ctx);
    if (version !== d.version) throw Object.assign(new CoreError("conflict", MENU_MSG.conflict, 409), { version: d.version });
    const live = (await liveDoc(ctx)).menu;
    const r = cleanMenu(menu, live, { demo: ctx.demo, mediaExists: ctx.mediaExists });
    if (Object.keys(r.fields).length) invalid(r.fields);
    const ch = menuChanges(live, r.menu);
    const next: MenuDoc = { id: "menu-draft", version: d.version + 1, menu: ch.count ? r.menu : null, at: iso(ctx), by: s.user.username };
    await ctx.repo.put(COL.settings, next);
    await audit(ctx, s.user.username, "menu.draft", "menu", { version: next.version, count: ch.count });
    emit(ctx, "menu.draft", { version: next.version, count: ch.count, by: s.user.name });
    return view(ctx, next, live);
  });
}

/** "Откажи": the draft goes away (the version still grows). */
export async function discardDraft(ctx: Ctx, s: StaffCtx, version?: number): Promise<DraftView> {
  need(s, "menu");
  return serial(ctx, async () => {
    const d = await draftDoc(ctx);
    if (version != null && version !== d.version) throw Object.assign(new CoreError("conflict", MENU_MSG.conflict, 409), { version: d.version });
    const next: MenuDoc = { id: "menu-draft", version: d.version + 1, menu: null };
    await ctx.repo.put(COL.settings, next);
    if (d.menu) await audit(ctx, s.user.username, "menu.discard", "menu", { version: next.version });
    emit(ctx, "menu.draft", { version: next.version, count: 0, by: s.user.name });
    return view(ctx, next, (await liveDoc(ctx)).menu);
  });
}

async function commit(ctx: Ctx, s: StaffCtx, next: Menu, kind: "publish" | "rollback", info: Record<string, unknown>) {
  const live = await liveDoc(ctx);
  const doc: MenuDoc = { id: "menu-live", version: live.version + 1, menu: next, at: iso(ctx), by: s.user.name || s.user.username, count: Number(info.count || 0) };
  await ctx.repo.put(COL.settings, { ...live, id: "menu-prev" });
  await ctx.repo.put(COL.settings, doc);
  await audit(ctx, s.user.username, "menu." + kind, "menu", { version: doc.version, ...info });
  emit(ctx, "menu.published", { version: doc.version, kind }, { public: true });
  await refreshLive(ctx, kind);
  return doc;
}

/** "Публикувай": the draft becomes the live menu (version = the draft's; another -> 409). The site rebuilds itself (server). */
export async function publish(ctx: Ctx, s: StaffCtx, version: number): Promise<PublishState & { changes: MenuChanges }> {
  need(s, "menu");
  const r = await serial(ctx, async () => {
    const d = await draftDoc(ctx);
    if (version !== d.version) throw Object.assign(new CoreError("conflict", MENU_MSG.conflict, 409), { version: d.version });
    const live = (await liveDoc(ctx)).menu;
    if (!d.menu) throw new CoreError("nothing", MENU_MSG.nothing, 422);
    const c = cleanMenu(d.menu, live, { demo: ctx.demo, mediaExists: ctx.mediaExists });
    if (Object.keys(c.fields).length) invalid(c.fields);
    const changes = menuChanges(live, c.menu);
    if (!changes.count) throw new CoreError("nothing", MENU_MSG.nothing, 422);
    const at = iso(ctx), next = finalize(c.menu, live, at);
    await commit(ctx, s, next, "publish", { count: changes.count, added: changes.dishes.added.length, changed: changes.dishes.changed.length, removed: changes.dishes.removed.length });
    await ctx.repo.put(COL.settings, { id: "menu-draft", version: d.version + 1, menu: null } as MenuDoc);
    return changes;
  });
  return { ...(await publishState(ctx, s)), changes: r };
}

/** "Върни предишната версия": the menu before the last publish / rollback goes live again (one step; twice = forward again).
    version = the live version the screen shows (a double click or someone else's publish -> 409). */
export async function rollback(ctx: Ctx, s: StaffCtx, version: number): Promise<PublishState> {
  need(s, "menu");
  await serial(ctx, async () => {
    const live = await liveDoc(ctx);
    if (version !== live.version) throw Object.assign(new CoreError("conflict", MENU_MSG.conflictLive, 409), { version: live.version });
    const prev = await ctx.repo.get<MenuDoc>(COL.settings, "menu-prev");
    const base = prev ? (prev.menu || builtinMenu()) : null;
    if (!prev || !base) throw new CoreError("no_prev", MENU_MSG.noPrev, 409);
    const next = finalize(base, live.menu, iso(ctx));
    await commit(ctx, s, next, "rollback", { to: prev.version, count: menuChanges(live.menu, next).count });
  });
  return publishState(ctx, s);
}

/** What the screen shows next to "Публикувай": the live version, who and when, one step back, the draft. In the demo
    mode "demo" (the static site is not rebuilt there; the server adds the rebuild state). */
export async function publishState(ctx: Ctx, s: StaffCtx): Promise<PublishState> {
  need(s, "menu");
  const live = await liveDoc(ctx), prev = await ctx.repo.get<MenuDoc>(COL.settings, "menu-prev"), d = await draftDoc(ctx);
  return {
    mode: ctx.demo ? "demo" : "server", version: live.version, at: live.at || null, by: live.by || null, count: live.count || 0,
    prev: prev ? { version: prev.version, at: prev.at || null } : null,
    draft: { version: d.version, count: d.menu ? menuChanges(live.menu, d.menu).count : 0 },
  };
}
