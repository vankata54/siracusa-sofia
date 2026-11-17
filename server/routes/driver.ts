/* The driver (core/driver.ts). The rights are in the core: a route only passes the signed-in staff member and the body.
   The driver (section "Шофьор"; only his own deliveries and the ready ones nobody took; never a customer's phone):
     GET   /api/driver/state                              who is signed in, the open shift, the cars
     POST  /api/driver/start        {car, km, float, nav} "Започни смяната" (422 fields, 409 shift_open)
     POST  /api/driver/prefs        {nav, parked}         the navigation app, "Паркирах" / "Аз съм пътник"
     POST  /api/driver/car          {car, kmEnd, kmStart} "Смених колата" (a new leg of the shift)
     GET   /api/driver/list[?all=1]                       the deliveries (all=1: every driver's, the bosses only)
     GET   /api/driver/deliveries/:no                     one delivery (404 for another driver's)
     POST  /api/driver/take         {nos}                 "Взех N поръчки" (409 taken / not_ready / ask_required)
     POST  /api/driver/go           {nos?}                "Тръгвам" (without nos: all taken ones)
     POST  /api/driver/deliveries/:no/arrive              "Пристигнах" (the customer is told)
     POST  /api/driver/deliveries/:no/deliver  {sum?}     "Доставена · взех X €"
     POST  /api/driver/deliveries/:no/problem  {kind, note}
     POST  /api/driver/deliveries/:no/returned            "Върнах я"
     POST  /api/driver/deliveries/:no/ask      {note?}    "Адрес извън зоните": the question to the manager
     POST  /api/driver/undo         {id}                  "Отмени" (409 undo_gone / undo_late / undo_changed)
     GET   /api/driver/route                              Път А, Път Б, "Моят ред" (no km: [ЛИПСВА: маршрути от OSRM])
     POST  /api/driver/route        {pick}   ·   POST /api/driver/route/move {no, dir}
     GET   /api/driver/fuel   ·   POST /api/driver/fuel {litres, sum, km, full, cash, photo, noPhoto}
     POST  /api/driver/receipt      (the body is the photo) {url: "/media/<sha256>.<ext>"}; 30 an hour per person
     GET   /api/driver/shift  ·   POST /api/driver/end {km, handed}
     GET   /api/driver/search?q=
   The main admin, the owner, the manager:
     GET   /api/driver/drivers                            the drivers on shift, the questions, the problems
     GET   /api/driver/asks[?all=1]  ·  POST /api/driver/asks/:id/answer {answer}  ·  POST /api/driver/asks/:id/undo
     PUT   /api/driver/cars         {cars}                the cars (a setting)
   The owner or "Финанси и гориво":
     GET   /api/driver/fuel/report?from=&to= */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { qv } from "./deps.ts";
import { sniffImage } from "./menu.ts";
import { CoreError, rid, DRIVER_MSG, RECEIPT_PER_HOUR, type AskAnswer, type FuelInput, type ProblemKind, type RoutePick, type ShiftStart } from "../../src/core/index.ts";

const MEDIA_TYPE: Record<string, string> = { webp: "image/webp", jpg: "image/jpeg", png: "image/png" };

export function driverRoutes(app: Hono, d: AdminDeps & { mediaDir: string }): void {
  const { core, staff, body } = d;
  const list = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.map(String) : undefined);

  app.get("/api/driver/state", async (c) => c.json(await core.driver.state(await staff(c))));
  app.post("/api/driver/start", async (c) => { const s = await staff(c); return c.json(await core.driver.start(s, (await body(c)) as ShiftStart), 201); });
  app.post("/api/driver/prefs", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.driver.prefs(s, { nav: b.nav, parked: b.parked })); });
  app.post("/api/driver/car", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.driver.changeCar(s, { car: b.car, kmEnd: b.kmEnd, kmStart: b.kmStart })); });
  app.put("/api/driver/cars", async (c) => { const s = await staff(c); return c.json(await core.driver.saveCars(s, (await body(c)).cars)); });

  app.get("/api/driver/list", async (c) => c.json(await core.driver.list(await staff(c), { all: qv(c, "all") === "1" })));
  app.get("/api/driver/deliveries/:no", async (c) => c.json(await core.driver.get(await staff(c), c.req.param("no"))));
  app.post("/api/driver/take", async (c) => { const s = await staff(c); return c.json(await core.driver.take(s, list((await body(c)).nos) || [])); });
  app.post("/api/driver/go", async (c) => { const s = await staff(c); return c.json(await core.driver.go(s, list((await body(c)).nos))); });
  app.post("/api/driver/deliveries/:no/arrive", async (c) => c.json(await core.driver.arrive(await staff(c), c.req.param("no"))));
  app.post("/api/driver/deliveries/:no/deliver", async (c) => { const s = await staff(c); return c.json(await core.driver.deliver(s, c.req.param("no"), { sum: (await body(c)).sum })); });
  app.post("/api/driver/deliveries/:no/problem", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.driver.problem(s, c.req.param("no"), b.kind as ProblemKind, typeof b.note === "string" ? b.note : undefined)); });
  app.post("/api/driver/deliveries/:no/returned", async (c) => c.json(await core.driver.returned(await staff(c), c.req.param("no"))));
  app.post("/api/driver/deliveries/:no/ask", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.driver.ask(s, c.req.param("no"), typeof b.note === "string" ? b.note : undefined), 201); });
  app.post("/api/driver/undo", async (c) => { const s = await staff(c); return c.json(await core.driver.undo(s, String((await body(c)).id || ""))); });

  app.get("/api/driver/route", async (c) => c.json(await core.driver.route(await staff(c))));
  app.post("/api/driver/route", async (c) => { const s = await staff(c); return c.json(await core.driver.routePick(s, (await body(c)).pick as RoutePick)); });
  app.post("/api/driver/route/move", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.driver.routeMove(s, String(b.no || ""), b.dir)); });

  app.get("/api/driver/fuel/report", async (c) => c.json(await core.driver.fuelReport(await staff(c), { from: qv(c, "from"), to: qv(c, "to") })));
  app.get("/api/driver/fuel", async (c) => c.json(await core.driver.fuel(await staff(c))));
  app.post("/api/driver/fuel", async (c) => { const s = await staff(c); return c.json(await core.driver.fuelAdd(s, (await body(c)) as FuelInput), 201); });
  /* the photo of a receipt: the same checks and the same store as a photo of the menu (png / jpeg / webp by the first
     bytes, up to 5 MB, /media/<sha256>.<ext>); only a driver in a shift, at most RECEIPT_PER_HOUR an hour per person */
  const uploads = new Map<string, number[]>();
  app.post("/api/driver/receipt", async (c) => {
    const s = await staff(c);
    await core.driver.receiptCheck(s, { bytes: 1, ext: "jpg" }); /* the rights and the shift before the body is read */
    const t = Date.now(), mine = (uploads.get(s.user.id) || []).filter((x) => x > t - 3600_000);
    uploads.set(s.user.id, mine);
    if (mine.length >= RECEIPT_PER_HOUR) throw Object.assign(new CoreError("throttled", DRIVER_MSG.receiptMany, 429), { retryIn: Math.max(1, Math.ceil((mine[0] + 3600_000 - t) / 1000)) });
    const buf = new Uint8Array(await c.req.arrayBuffer()), ext = sniffImage(buf);
    await core.driver.receiptCheck(s, { bytes: buf.length, ext });
    const name = crypto.createHash("sha256").update(buf).digest("hex") + "." + ext;
    fs.mkdirSync(d.mediaDir, { recursive: true });
    const file = path.join(d.mediaDir, name);
    if (!fs.existsSync(file)) { const tmp = file + "." + rid(4) + ".tmp"; fs.writeFileSync(tmp, buf); fs.renameSync(tmp, file); }
    mine.push(t);
    await core.audit.log(s.user.username, "fuel.receipt", name, { bytes: buf.length });
    return c.json({ url: "/media/" + name, type: MEDIA_TYPE[ext!], bytes: buf.length }, 201);
  });

  app.get("/api/driver/shift", async (c) => c.json(await core.driver.shift(await staff(c))));
  app.post("/api/driver/end", async (c) => { const s = await staff(c), b = await body(c); return c.json(await core.driver.end(s, { km: b.km, handed: b.handed === true })); });
  app.get("/api/driver/search", async (c) => c.json(await core.driver.search(await staff(c), qv(c, "q") || "")));

  app.get("/api/driver/drivers", async (c) => c.json(await core.driver.drivers(await staff(c))));
  app.get("/api/driver/asks", async (c) => c.json(await core.driver.asks(await staff(c), { all: qv(c, "all") === "1" })));
  app.post("/api/driver/asks/:id/answer", async (c) => { const s = await staff(c); return c.json(await core.driver.answer(s, c.req.param("id"), (await body(c)).answer as AskAnswer)); });
  app.post("/api/driver/asks/:id/undo", async (c) => c.json(await core.driver.answerUndo(await staff(c), c.req.param("id"))));
}
