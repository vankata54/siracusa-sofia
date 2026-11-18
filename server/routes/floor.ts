/* The hall live (core/floor*.ts), the PIN sign-in on a known device (core/staff-pin.ts) and the waiter's search.
   The rights and every rule are in the core: a route passes the table code + the phone's token (the guests) or the
   signed-in staff member (the staff), exactly like the demo (src/client/api-floor.ts).

   THE GUESTS (no sign-in; POST with {g: <the phone's token>}; 404 "Този код вече не работи", 403 "guest", 409 "session_closed"):
     POST /api/floor/t/:code/open          {g, fresh?}                 the sitting of this phone (opens it at the first scan)
     POST /api/floor/t/:code/view          {g}                         the view again (never opens anything)
     POST /api/floor/t/:code/cart/add      {g, id, q?, mods?}          "+"
     POST /api/floor/t/:code/cart/qty      {g, key, q}                 the counter (0 removes)
     POST /api/floor/t/:code/cart/remove   {g, key}                    -> {view, gone}
     POST /api/floor/t/:code/cart/restore  {g, line}                   "Отмени" after a removal
     POST /api/floor/t/:code/send          {g}                         -> {view, to: "waiter" | "kitchen", no}
     POST /api/floor/t/:code/rejected-ok   {g}                         "Разбрах"
     POST /api/floor/t/:code/call          {g, kind, note?}            order | bill | water | other
     POST /api/floor/t/:code/call/cancel   {g, kind}                   "Не ни трябва вече"
     POST /api/floor/t/:code/call/restore  {g, kind}                   "Отмени" after the cancel
     POST /api/floor/t/:code/bill          {g, pay, split}             cash | card; one | guests | dishes
     POST /api/floor/t/:code/pick          {g, keys, on}               "По ястия"
     POST /api/floor/t/:code/rate          {g, happy, text?}           -> {view, code, pct, google, googleMissing}
   Limits (off in the test mode): 600 calls per phone and 20000 per address in 10 minutes (the guests of the restaurant
   share one Wi-Fi address); "call" 12 and "send" 10 per phone in 10 minutes; wrong codes: 30 per address in 10 minutes
   (only the wrong ones count).

   THE STAFF (the section "Сервитьор"; the main admin, the owner and the manager always):
     GET  /api/floor/hall                                       the hall live
     GET  /api/floor/ready                                      "Готови"
     GET  /api/floor/table/:ref                                 a table (its id "S12" or its number "12")
     POST /api/floor/table/:ref/seat                            guests sat down, no order yet
     POST /api/floor/table/:ref/order      {lines, note?}       "Нова поръчка" → "Към кухнята" (201)
     POST /api/floor/table/:ref/qr/confirm {grams?}             "Потвърди и прати"
     POST /api/floor/table/:ref/qr/reject  {reason}             "Откажи"
     POST /api/floor/table/:ref/qr/drop   {key}                "Махни" one line of the waiting QR order (sold out)
     POST /api/floor/table/:ref/qr/undo                         "Отмени" after "Откажи"
     POST /api/floor/table/:ref/serve      {keys?}              "Сервирах" (no keys: every ready line)
     POST /api/floor/table/:ref/unserve    {keys}               "Отмени"
     POST /api/floor/table/:ref/pay        {how, keys?, bill?}  "Маркирай платено"
     POST /api/floor/table/:ref/close      {force?}             "Затвори масата" (409 "unserved" + lines)
     POST /api/floor/call/:id/take | done | undo                "Отивам" / "Обслужено" / "Отмени"
     GET  /api/floor/shift                                      my shift, the tables, the colleagues
     POST /api/floor/shift/start           {tables}             "Започни смяната"
     POST /api/floor/shift/end             {to?}                hands the tables over AND signs out
     GET  /api/floor/shift/view                                 the manager's view (main admin, owner, manager)
     POST /api/floor/shift/tables          {who, tables, to?}   the manager changes a waiter's tables
     GET  /api/floor/ratings                                    the ratings from the tables (main admin, owner, manager)
     GET  /api/staff/search?q=                                  the waiter's search

   THE PIN (public, only on a known device: the httpOnly cookie "sc_kd" set by a password sign-in):
     GET  /api/auth/pin/people?module=waiter|kitchen|driver     {known, pinOnly, people: [{id, name}]}
     POST /api/auth/pin  {module, user?, pin}                   the normal staff session (cookie "sc_staff") */
import type { Context, Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AdminDeps } from "./deps.ts";
import { CoreError, HALL_MSG, type CallKind, type PinModule, type RejectReason, type StaffOrderInput } from "../../src/core/index.ts";

export const STAFF_COOKIE = "sc_staff", KNOWN_COOKIE = "sc_kd";
export interface FloorDeps extends AdminDeps {
  /** server/app.ts: at most `max` per `key` in `minutes` (429 with retryIn); returns undo() */
  limit: (key: string, max: number, minutes: number, msg: string) => () => void;
  ip: (c: Context) => string;
  cookieOpts: { httpOnly: boolean; sameSite: "Lax"; secure: boolean; path: string };
}
const GUEST_BUSY = "Твърде много заявки за кратко време. Изчакайте малко или повикайте сервитьор.";
const PIN_BUSY = "Твърде много опити. Опитай след 10 минути или влез с парола.";

export function floorRoutes(app: Hono, d: FloorDeps): void {
  const { core, staff, body, limit, ip } = d;
  const cf = (c: Context) => (d.coreFor ? d.coreFor(c) : core);

  /* ---------- the guests ---------- */
  type G = { code: string; g: string; b: Record<string, any>; f: ReturnType<typeof cf>["floor"] };
  /** the limits, the body and the phone's token. Only a WRONG code counts against the address (30 in 10 min): a request
      with a right code never meets that limit (the guests share one Wi-Fi address; decision 17.11.2026). own: a smaller
      limit of this kind of request per phone (calls, sends) */
  const guest = (path: string, fn: (x: G) => Promise<unknown>, own?: [number, string]) => app.post("/api/floor/t/:code/" + path, async (c) => {
    const b = await body(c), g = String(b.g || ""), a = ip(c);
    limit("fl-ip:" + a, 20000, 10, GUEST_BUSY);
    limit("fl-g:" + a + ":" + g.slice(0, 64), 600, 10, GUEST_BUSY);
    const undoOwn = own ? limit("fl-" + path + ":" + g.slice(0, 64), own[0], 10, own[1]) : () => {};
    try { return c.json((await fn({ code: c.req.param("code") as string, g, b, f: cf(c).floor })) as object); }
    catch (e) {
      if (!(e instanceof CoreError && e.status < 500 && e.status !== 404)) undoOwn();
      /* a wrong code: counted; over the limit the answer is 429 instead of 404 */
      if (e instanceof CoreError && e.status === 404 && e.message === HALL_MSG.qrGone) limit("fl-miss:" + a, 30, 10, GUEST_BUSY);
      throw e;
    }
  });
  guest("open", (x) => x.f.open(x.code, x.g, x.b.fresh === true));
  guest("view", (x) => x.f.view(x.code, x.g));
  guest("cart/add", (x) => x.f.cartAdd(x.code, x.g, { id: x.b.id, q: x.b.q, mods: x.b.mods }));
  guest("cart/qty", (x) => x.f.cartQty(x.code, x.g, String(x.b.key || ""), x.b.q));
  guest("cart/remove", (x) => x.f.cartRemove(x.code, x.g, String(x.b.key || "")));
  guest("cart/restore", (x) => x.f.cartRestore(x.code, x.g, x.b.line || {}));
  guest("send", (x) => x.f.send(x.code, x.g), [10, "Твърде много поръчки за кратко време. Повикайте сервитьор."]);
  guest("rejected-ok", (x) => x.f.rejectedOk(x.code, x.g));
  guest("call", (x) => x.f.call(x.code, x.g, x.b.kind as CallKind, x.b.note), [12, "Твърде много повиквания за кратко време. Махнете на сервитьора."]);
  guest("call/cancel", (x) => x.f.callCancel(x.code, x.g, x.b.kind as CallKind));
  guest("call/restore", (x) => x.f.callRestore(x.code, x.g, x.b.kind as CallKind));
  guest("bill", (x) => x.f.bill(x.code, x.g, { pay: x.b.pay, split: x.b.split }));
  guest("pick", (x) => x.f.pick(x.code, x.g, Array.isArray(x.b.keys) ? x.b.keys : String(x.b.keys || x.b.key || ""), x.b.on !== false));
  guest("rate", (x) => x.f.rate(x.code, x.g, { happy: x.b.happy, text: x.b.text }));

  /* ---------- the staff ---------- */
  const ref = (c: Context) => c.req.param("ref") as string;
  app.get("/api/floor/hall", async (c) => c.json(await cf(c).floor.hall(await staff(c))));
  app.get("/api/floor/ready", async (c) => c.json(await cf(c).floor.ready(await staff(c))));
  app.get("/api/floor/ratings", async (c) => c.json(await core.floor.ratings(await staff(c))));
  app.get("/api/floor/table/:ref", async (c) => c.json(await cf(c).floor.table(await staff(c), ref(c))));
  app.post("/api/floor/table/:ref/seat", async (c) => c.json(await cf(c).floor.seat(await staff(c), ref(c))));
  app.post("/api/floor/table/:ref/order", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).floor.order(s, ref(c), { lines: b.lines, note: b.note, rid: b.rid } as StaffOrderInput), 201); });
  app.post("/api/floor/table/:ref/qr/confirm", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).floor.qrConfirm(s, ref(c), b.grams && typeof b.grams === "object" ? b.grams : {})); });
  app.post("/api/floor/table/:ref/qr/reject", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).floor.qrReject(s, ref(c), b.reason as RejectReason)); });
  app.post("/api/floor/table/:ref/qr/drop", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).floor.qrDrop(s, ref(c), String(b.key || ""))); });
  /* "Махни" on a sent line the kitchen marked "Изчерпано днес" before it started it (core floor-staff.ts outDrop) */
  app.post("/api/floor/table/:ref/out/drop", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).floor.outDrop(s, ref(c), String(b.key || ""))); });
  app.post("/api/floor/table/:ref/qr/undo", async (c) => c.json(await cf(c).floor.qrRejectUndo(await staff(c), ref(c))));
  app.post("/api/floor/table/:ref/serve", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).floor.serve(s, ref(c), Array.isArray(b.keys) ? b.keys : undefined)); });
  app.post("/api/floor/table/:ref/unserve", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).floor.unserve(s, ref(c), Array.isArray(b.keys) ? b.keys : [])); });
  app.post("/api/floor/table/:ref/pay", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).floor.pay(s, ref(c), { how: b.how, keys: Array.isArray(b.keys) ? b.keys : undefined, bill: typeof b.bill === "string" ? b.bill : undefined })); });
  app.post("/api/floor/table/:ref/close", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).floor.close(s, ref(c), b.force === true)); });
  app.post("/api/floor/call/:id/take", async (c) => c.json(await cf(c).floor.callTake(await staff(c), c.req.param("id"))));
  app.post("/api/floor/call/:id/done", async (c) => c.json(await cf(c).floor.callDone(await staff(c), c.req.param("id"))));
  app.post("/api/floor/call/:id/undo", async (c) => c.json(await cf(c).floor.callUndo(await staff(c), c.req.param("id"))));
  /* the shift */
  app.get("/api/floor/shift", async (c) => c.json(await core.floor.shiftMine(await staff(c))));
  app.post("/api/floor/shift/start", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.floor.shiftStart(s, Array.isArray(b.tables) ? b.tables : [])); });
  /* the end of the shift signs the person out too (the screen goes back to the sign-in) */
  app.post("/api/floor/shift/end", async (c) => {
    const s = await staff(c), b = await body(c), r = await core.floor.shiftEnd(s, typeof b.to === "string" && b.to ? b.to : null);
    /* only a waiter who had a shift is signed out; the main admin / owner / manager without one stay signed in */
    const t = getCookie(c, STAFF_COOKIE), hadShift = !!(r as { closed?: boolean }).closed;
    if (t && hadShift) { await core.staff.logout(t); deleteCookie(c, STAFF_COOKIE, { path: "/" }); }
    return c.json(r);
  });
  app.get("/api/floor/shift/view", async (c) => c.json(await core.floor.shiftView(await staff(c))));
  app.post("/api/floor/shift/tables", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.floor.shiftSetTables(s, String(b.who || ""), Array.isArray(b.tables) ? b.tables : [], typeof b.to === "string" && b.to ? b.to : null)); });
  /* the waiter's search: only what the role may see (the dishes are searched in the browser) */
  app.get("/api/staff/search", async (c) => c.json(await cf(c).floor.search(await staff(c), c.req.query("q") || "")));

  /* ---------- the PIN on a known device ---------- */
  app.get("/api/auth/pin/people", async (c) => {
    limit("pin-list:" + ip(c), 120, 10, PIN_BUSY);
    return c.json(await core.pin.people(getCookie(c, KNOWN_COOKIE), (c.req.query("module") || "") as PinModule));
  });
  app.post("/api/auth/pin", async (c) => {
    limit("pin-ip:" + ip(c), 60, 10, PIN_BUSY);
    const b = await body(c);
    const r = await core.pin.login(getCookie(c, KNOWN_COOKIE), { module: b.module as PinModule, user: typeof b.user === "string" ? b.user : undefined, pin: String(b.pin == null ? "" : b.pin) });
    setCookie(c, STAFF_COOKIE, r.token, { ...d.cookieOpts, maxAge: 12 * 3600 });
    return c.json({ user: r.user, home: r.home });
  });
}
