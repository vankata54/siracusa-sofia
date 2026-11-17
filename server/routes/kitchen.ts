/* The kitchen (core/kitchen.ts). The rights are in the core: the section "Кухня"; the main admin, the owner and the
   manager always. Every action takes `at` (when it was made on the tablet: ISO or epoch ms) and is idempotent.
     GET   /api/kitchen/config                                  the sections, the norms, what is still [ЛИПСВА]
     PUT   /api/kitchen/config  {sections, lunch, other, norm, soon, enterBefore, version}   главен админ, собственик, управител
     GET   /api/kitchen/queue?sec=skara|all                     the queue (FIFO), "По-късно", the counts, "Натоварено"
     POST  /api/kitchen/orders/:no/start   {sec, at}            "Започни"
     POST  /api/kitchen/orders/:no/line    {i, ready, sec, at}  a line ready / not ready
     POST  /api/kitchen/orders/:no/done    {sec, at}            "Готово" for the section
     POST  /api/kitchen/orders/:no/back    {sec, lines, at}     "Върни" / "Върни в опашката" (409 served, taken, closed)
     POST  /api/kitchen/orders/:no/seen    {sec}                "Виж": no longer "Нова"
     GET   /api/kitchen/done?sec=                               "Изпълнени днес"
     GET   /api/kitchen/summary                                 "Общ изглед"
     GET   /api/kitchen/sold-out?sec=                           the tiles and the list "Изчерпано днес"
     PUT   /api/kitchen/sold-out/:id       {out, sec, at}       the one switch + the lines of accepted orders
     GET   /api/kitchen/busy                                    "Натоварено": who, when, the day's log
     PUT   /api/kitchen/busy               {on, sec, at}
     POST  /api/kitchen/beat               {sec, device}        the tablet's heartbeat
     GET   /api/kitchen/tablets                                 "Таблетът работи" / "без връзка от 19:37"
     GET   /api/kitchen/search?sec=&q=                          "Търси" in the waiting orders of the section */
import type { Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { qv, ver } from "./deps.ts";
import type { KConfigPatch } from "../../src/core/index.ts";

export function kitchenRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  const k = core.kitchen;
  const sec = (b: Record<string, unknown>): string => (typeof b.sec === "string" ? b.sec : "");
  const at = (b: Record<string, unknown>): string | number | undefined => (typeof b.at === "string" || typeof b.at === "number" ? b.at : undefined);
  app.get("/api/kitchen/config", async (c) => c.json(await k.config(await staff(c))));
  app.put("/api/kitchen/config", async (c) => { const s = await staff(c), b = await body(c); return c.json(await k.setConfig(s, { sections: b.sections, lunch: b.lunch, other: b.other, norm: b.norm, soon: b.soon, enterBefore: b.enterBefore } as KConfigPatch, ver(b))); });
  app.get("/api/kitchen/queue", async (c) => c.json(await k.queue(await staff(c), qv(c, "sec") || "")));
  app.post("/api/kitchen/orders/:no/start", async (c) => { const s = await staff(c), b = await body(c); return c.json(await k.start(s, c.req.param("no"), sec(b), { at: at(b) })); });
  app.post("/api/kitchen/orders/:no/line", async (c) => { const s = await staff(c), b = await body(c); return c.json(await k.line(s, c.req.param("no"), b.i as number, b.ready as boolean, { sec: sec(b) || undefined, at: at(b) })); });
  app.post("/api/kitchen/orders/:no/done", async (c) => { const s = await staff(c), b = await body(c); return c.json(await k.done(s, c.req.param("no"), sec(b), { at: at(b) })); });
  app.post("/api/kitchen/orders/:no/back", async (c) => { const s = await staff(c), b = await body(c); return c.json(await k.back(s, c.req.param("no"), sec(b), { at: at(b), lines: Array.isArray(b.lines) ? (b.lines as number[]) : undefined })); });
  app.post("/api/kitchen/orders/:no/seen", async (c) => { const s = await staff(c), b = await body(c); return c.json(await k.seen(s, c.req.param("no"), sec(b))); });
  app.get("/api/kitchen/done", async (c) => c.json(await k.doneToday(await staff(c), qv(c, "sec") || "")));
  app.get("/api/kitchen/summary", async (c) => c.json(await k.summary(await staff(c))));
  app.get("/api/kitchen/sold-out", async (c) => c.json(await k.soldOut(await staff(c), qv(c, "sec") || "")));
  app.put("/api/kitchen/sold-out/:id", async (c) => { const s = await staff(c), b = await body(c); return c.json(await k.setOut(s, c.req.param("id"), b.out as boolean, { sec: sec(b) || undefined, at: at(b) })); });
  app.get("/api/kitchen/busy", async (c) => c.json(await k.busy(await staff(c))));
  app.put("/api/kitchen/busy", async (c) => { const s = await staff(c), b = await body(c); return c.json(await k.setBusy(s, b.on as boolean, { sec: sec(b) || undefined, at: at(b) })); });
  app.post("/api/kitchen/beat", async (c) => { const s = await staff(c), b = await body(c); return c.json(await k.beat(s, sec(b), { device: typeof b.device === "string" ? b.device : undefined })); });
  app.get("/api/kitchen/tablets", async (c) => c.json(await k.tablets(await staff(c))));
  app.get("/api/kitchen/search", async (c) => c.json(await k.search(await staff(c), qv(c, "sec") || "", qv(c, "q") || "")));
}
