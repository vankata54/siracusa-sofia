/* The menu editor and the lunch menu on the server (decisions 15.11.2026; core/menu-edit.ts, core/lunch.ts).
   The rights are in the core (section "Меню" / "Обедно меню", the PIN of the lunch schedule); these routes only pass the
   signed-in staff member and the device (cookie sc_dev). "Публикувай" / "Върни" rebuild the site (server/publish.ts).
     GET    /api/admin/menu/draft                 the shared draft {version, menu, changes}
     PUT    /api/admin/menu/draft                 {menu, version} -> the draft (409 conflict, 422 fields)
     POST   /api/admin/menu/draft/discard         {version} (required: 422 without it, 409 old) -> no draft
     POST   /api/admin/menu/publish               {version} -> the state (+ changes); the site rebuilds itself
     POST   /api/admin/menu/rollback              {version: the live one} -> the state
     GET    /api/admin/menu/publish               the state: version, who, when, one step back, the draft, the rebuild
     POST   /api/admin/media                      a photo (the body is the file): {url: "/media/<sha256>.<ext>"}; 60 an hour per person (429)
     GET    /media/<sha256>.<webp|jpg|png>        the photo (long cache, nosniff)
     GET    /api/admin/lunch                      the schedule (403 pin_required / pin_unset without the PIN)
     PUT    /api/admin/lunch/days/:date           {ids}
     POST   /api/admin/lunch/publish              {dates}
     POST   /api/admin/lunch/favs                 {n, ids};  DELETE /api/admin/lunch/favs/:id
     POST   /api/admin/lunch/dishes               {n, group, p}
     GET    /api/admin/lunch/pin                  {pinSet, boss, openUntil, at} (never the PIN)
     PUT    /api/admin/lunch/pin                  {pin?} -> {pin} once (owner, manager, main admin)
     POST   /api/admin/lunch/unlock               {pin} -> {until} (5 wrong per person and device, 10 per person: 429)
     POST   /api/admin/lunch/lock */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Hono, Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { CoreError, rid, type Core, type StaffCtx } from "../../src/core/index.ts";
import type { Publisher } from "../publish.ts";

export const MEDIA_MAX = 5 * 1024 * 1024;
/** photos per person per hour (review admin-menu flows, minor 4): 429 with retryIn */
export const MEDIA_PER_HOUR = 60;
export const MEDIA_RE = /^([a-f0-9]{64})\.(webp|jpg|png)$/;
const MEDIA_TYPE: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", png: "image/png" };

/** the type of an image by its first bytes (never by the name or the header the browser sent) */
export function sniffImage(b: Uint8Array): "png" | "jpg" | "webp" | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

export interface MenuDeps {
  core: Core;
  /** the signed-in staff member with one of the sections (core.staff.guard) */
  staff: (c: Context, section?: string | string[]) => Promise<StaffCtx>;
  body: (c: Context) => Promise<Record<string, unknown>>;
  cookieOpts: { httpOnly: boolean; sameSite: "Lax"; secure: boolean; path: string };
  mediaDir: string;
  publisher: Publisher | null;
  /** the site again with the live menu and site data (after a failed rebuild) */
  rebuild: () => Promise<void>;
}

export function menuRoutes(app: Hono, d: MenuDeps): void {
  const { core, staff, body } = d;
  const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? +v : -1);
  /* the device for the lunch PIN (the same cookie as the other limits); a new one is set when missing */
  const device = (c: Context): string => {
    let dev = getCookie(c, "sc_dev") || "";
    if (!/^[0-9a-f]{16,32}$/.test(dev)) { dev = rid(12); setCookie(c, "sc_dev", dev, { ...d.cookieOpts, maxAge: 365 * 24 * 3600 }); }
    return dev;
  };
  const state = async (s: StaffCtx) => ({ ...(await core.menuEdit.publishState(s)), build: d.publisher ? d.publisher.state() : { state: "idle", at: null, waiting: false } });

  /* ---------- the menu editor ---------- */
  app.get("/api/admin/menu/draft", async (c) => c.json(await core.menuEdit.getDraft(await staff(c, "menu"))));
  app.put("/api/admin/menu/draft", async (c) => { const s = await staff(c, "menu"), b = await body(c); return c.json(await core.menuEdit.saveDraft(s, b.menu, num(b.version))); });
  app.post("/api/admin/menu/draft/discard", async (c) => { const s = await staff(c, "menu"), b = await body(c); return c.json(await core.menuEdit.discardDraft(s, num(b.version))); });
  app.get("/api/admin/menu/publish", async (c) => c.json(await state(await staff(c, "menu"))));
  app.post("/api/admin/menu/publish", async (c) => {
    const s = await staff(c, "menu"), b = await body(c);
    const r = await core.menuEdit.publish(s, num(b.version));
    return c.json({ ...r, build: d.publisher ? d.publisher.state() : { state: "idle", at: null, waiting: false } });
  });
  /* any section whose data is on the site may rebuild it again (menu, zones, offers, events, the hall) */
  app.post("/api/admin/menu/rebuild", async (c) => { const s = await staff(c, ["menu", "zones", "offers", "events", "hall"]); await core.audit.log(s.user.username, "menu.rebuild"); await d.rebuild(); return c.json(await state(s)); });
  app.post("/api/admin/menu/rollback", async (c) => { const s = await staff(c, "menu"), b = await body(c); await core.menuEdit.rollback(s, num(b.version)); return c.json(await state(s)); });

  /* ---------- photos ---------- */
  /* at most MEDIA_PER_HOUR photos an hour per person (a photo not used in the menu stays on the disk; see menu.ts) */
  const uploads = new Map<string, number[]>();
  app.post("/api/admin/media", async (c) => {
    const s = await staff(c, "menu");
    const t = Date.now(), mine = (uploads.get(s.user.id) || []).filter((x) => x > t - 3600_000);
    uploads.set(s.user.id, mine);
    if (mine.length >= MEDIA_PER_HOUR) throw Object.assign(new CoreError("throttled", "Качихте много снимки за кратко време. Опитайте след малко.", 429), { retryIn: Math.max(1, Math.ceil((mine[0] + 3600_000 - t) / 1000)) });
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.length > MEDIA_MAX) throw new CoreError("too_large", "Снимката е до 5 MB.", 413);
    if (!buf.length) throw new CoreError("empty", "Изберете снимка.", 422);
    const ext = sniffImage(buf);
    if (!ext) throw new CoreError("unsupported", "Качете снимка в WebP, JPEG или PNG.", 415);
    const hash = crypto.createHash("sha256").update(buf).digest("hex"), name = hash + "." + ext;
    fs.mkdirSync(d.mediaDir, { recursive: true });
    const file = path.join(d.mediaDir, name);
    if (!fs.existsSync(file)) { const tmp = file + "." + rid(4) + ".tmp"; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, file); }
    mine.push(t);
    await core.audit.log(s.user.username, "menu.media", name, { bytes: buf.length });
    return c.json({ url: "/media/" + name, type: MEDIA_TYPE[ext], bytes: buf.length }, 201);
  });
  app.get("/media/:name", (c) => {
    const m = MEDIA_RE.exec(c.req.param("name"));
    const file = m ? path.join(d.mediaDir, c.req.param("name")) : "";
    if (!m || !fs.existsSync(file)) return c.text("Not found", 404);
    c.header("Content-Type", MEDIA_TYPE[m[2]]);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Content-Security-Policy", "default-src 'none'; sandbox");
    return c.body(new Uint8Array(fs.readFileSync(file)));
  });

  /* ---------- the lunch menu ---------- */
  app.get("/api/admin/lunch", async (c) => c.json(await core.lunch.get(await staff(c, "lunch"), device(c))));
  app.put("/api/admin/lunch/days/:date", async (c) => { const s = await staff(c, "lunch"), b = await body(c); return c.json(await core.lunch.saveDay(s, device(c), c.req.param("date"), b.ids)); });
  app.post("/api/admin/lunch/publish", async (c) => { const s = await staff(c, "lunch"), b = await body(c); return c.json(await core.lunch.publish(s, device(c), b.dates)); });
  app.post("/api/admin/lunch/favs", async (c) => { const s = await staff(c, "lunch"), b = await body(c); return c.json(await core.lunch.saveFav(s, device(c), b as { n?: unknown; ids?: unknown }), 201); });
  app.delete("/api/admin/lunch/favs/:id", async (c) => c.json(await core.lunch.removeFav(await staff(c, "lunch"), device(c), c.req.param("id"))));
  app.post("/api/admin/lunch/dishes", async (c) => { const s = await staff(c, "lunch"), b = await body(c); return c.json(await core.lunch.addDish(s, device(c), b as { n?: unknown; group?: unknown; p?: unknown }), 201); });
  app.get("/api/admin/lunch/pin", async (c) => c.json(await core.lunch.pinState(await staff(c, "lunch"), device(c))));
  app.put("/api/admin/lunch/pin", async (c) => { const s = await staff(c, "lunch"), b = await body(c); return c.json(await core.lunch.setPin(s, b.pin == null ? undefined : String(b.pin))); });
  app.post("/api/admin/lunch/unlock", async (c) => { const s = await staff(c, "lunch"), b = await body(c); return c.json(await core.lunch.unlock(s, device(c), String(b.pin ?? ""))); });
  app.post("/api/admin/lunch/lock", async (c) => c.json(await core.lunch.lock(await staff(c, "lunch"), device(c))));
}
