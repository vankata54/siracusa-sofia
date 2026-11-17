/* The manager's and the owner's modules (core/shift.ts, core/owner.ts). The rights are in the core: a route only passes the
   signed-in staff member and the body (401 without a session, 403 for a role without the module or the section).
   "Управител" (the main admin, the owner, the manager):
     GET   /api/boss/now                                  "Сега": the pulse, the problems, "Чака те", the kitchen, fresh
     GET   /api/boss/hall · /api/boss/hall/:table         "Залата" (hall | reservations) · the sheet of a table
     POST  /api/boss/hall/:table/waiter  {waiter}         who serves the table
     POST  /api/boss/hall/:table/walkin  {allow}          "Блокирай за гости без резервация" (hall)
     GET   /api/boss/team                                 "Екипът" (staff)
     POST  /api/boss/team/tables  {who, tables, to?}  ·  POST /api/boss/team/tables/undo {id}
     GET   /api/boss/search?q=
     POST  /api/boss/orders/:no/accept  {without?}  ·  POST /api/boss/orders/undo {id}  ·  POST /api/boss/orders/:no/call
     POST  /api/boss/ack  {key, what}  ·  POST /api/boss/ack/undo {key}
     POST  /api/boss/calls/:id/go  ·  /calls/:id/assign {waiter}  ·  /calls/:id/undo
     POST  /api/boss/qr/:table/confirm {grams?}  ·  /api/boss/qr/:session/assign {waiter}  ·  /api/boss/qr/:session/undo
     POST  /api/boss/asks/:id/answer {answer}  ·  /api/boss/asks/:id/undo
     POST  /api/boss/reservations/:id/confirm {undo?}  ·  POST /api/boss/blocks/:ref {action}
     POST  /api/boss/kitchen/busy {on}  ·  POST /api/boss/kitchen/back {dish, back?}
   "Собственик" (the owner and the main admin):
     GET   /api/owner/today · /api/owner/trends?period=&from=&to=&compare=prev|year&dish= · /api/owner/finance?… · /api/owner/decisions
     POST  /api/owner/questions/:id {answer, text?}  (the owner only) · POST /api/owner/questions/:id/undo
     POST  /api/owner/blocks/:ref {action}  ·  PUT /api/owner/mail {weekly?, monthly?} */
import type { Context, Hono } from "hono";
import type { AdminDeps } from "./deps.ts";
import { qv } from "./deps.ts";
import type { AskAnswer, Compare, Period } from "../../src/core/index.ts";

export function bossRoutes(app: Hono, d: AdminDeps): void {
  const { core, staff, body } = d;
  /* the test preview clock (SC_PREVIEW_API=1, x-sc-clock) reaches the reads and the actions that depend on the hour */
  const cf = (c: Context) => (d.coreFor ? d.coreFor(c) : core);
  const period = (c: Context) => ({ period: qv(c, "period") as Period | undefined, from: qv(c, "from"), to: qv(c, "to"), compare: (qv(c, "compare") === "year" ? "year" : "prev") as Compare, dish: qv(c, "dish") });

  /* ---------- Управител ---------- */
  app.get("/api/boss/now", async (c) => c.json(await cf(c).shift.now(await staff(c))));
  app.get("/api/boss/hall", async (c) => c.json(await cf(c).shift.hall(await staff(c))));
  app.get("/api/boss/hall/:table", async (c) => c.json(await cf(c).shift.table(await staff(c), c.req.param("table"))));
  app.post("/api/boss/hall/:table/waiter", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.setWaiter(s, c.req.param("table"), String((await body(c)).waiter || ""))); });
  app.post("/api/boss/hall/:table/walkin", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.walkin(s, c.req.param("table"), (await body(c)).allow)); });
  app.get("/api/boss/team", async (c) => c.json(await cf(c).shift.team(await staff(c))));
  app.post("/api/boss/team/tables", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).shift.setTables(s, String(b.who || ""), Array.isArray(b.tables) ? b.tables : [], b.to ?? null)); });
  app.post("/api/boss/team/tables/undo", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.setTablesUndo(s, String((await body(c)).id || ""))); });
  app.get("/api/boss/search", async (c) => c.json(await cf(c).shift.search(await staff(c), qv(c, "q") || "")));
  app.post("/api/boss/orders/undo", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.acceptUndo(s, String((await body(c)).id || ""))); });
  app.post("/api/boss/orders/:no/accept", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.accept(s, c.req.param("no"), { without: (await body(c)).without === true })); });
  app.post("/api/boss/orders/:no/call", async (c) => c.json(await cf(c).shift.callCustomer(await staff(c), c.req.param("no"))));
  app.post("/api/boss/ack", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).shift.ack(s, String(b.key || ""), b.what)); });
  app.post("/api/boss/ack/undo", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.ackUndo(s, String((await body(c)).key || ""))); });
  app.post("/api/boss/calls/:id/go", async (c) => c.json(await cf(c).shift.callGo(await staff(c), c.req.param("id"))));
  app.post("/api/boss/calls/:id/assign", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.callAssign(s, c.req.param("id"), String((await body(c)).waiter || ""))); });
  app.post("/api/boss/calls/:id/undo", async (c) => c.json(await cf(c).shift.callUndo(await staff(c), c.req.param("id"))));
  app.post("/api/boss/qr/:table/confirm", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).shift.qrConfirm(s, c.req.param("table"), b.grams && typeof b.grams === "object" ? b.grams : {})); });
  app.post("/api/boss/qr/:session/assign", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.qrAssign(s, c.req.param("session"), String((await body(c)).waiter || ""))); });
  app.post("/api/boss/qr/:session/undo", async (c) => c.json(await cf(c).shift.qrAssignUndo(await staff(c), c.req.param("session"))));
  app.post("/api/boss/asks/:id/answer", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.answer(s, c.req.param("id"), (await body(c)).answer as AskAnswer)); });
  app.post("/api/boss/asks/:id/undo", async (c) => c.json(await cf(c).shift.answerUndo(await staff(c), c.req.param("id"))));
  app.post("/api/boss/reservations/:id/confirm", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.resConfirm(s, c.req.param("id"), (await body(c)).undo === true)); });
  app.post("/api/boss/blocks/:ref", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.block(s, c.req.param("ref"), (await body(c)).action)); });
  app.post("/api/boss/kitchen/busy", async (c) => { const s = await staff(c); return c.json(await cf(c).shift.busy(s, (await body(c)).on)); });
  app.post("/api/boss/kitchen/back", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).shift.backIn(s, String(b.dish || ""), b.back !== false)); });

  /* ---------- Собственик ---------- */
  app.get("/api/owner/today", async (c) => c.json(await cf(c).owner.today(await staff(c))));
  app.get("/api/owner/trends", async (c) => c.json(await cf(c).owner.trends(await staff(c), period(c))));
  app.get("/api/owner/finance", async (c) => c.json(await cf(c).owner.finance(await staff(c), period(c))));
  app.get("/api/owner/decisions", async (c) => c.json(await cf(c).owner.decisions(await staff(c))));
  app.post("/api/owner/questions/:id/undo", async (c) => c.json(await cf(c).owner.answerUndo(await staff(c), c.req.param("id"))));
  app.post("/api/owner/questions/:id", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).owner.answer(s, c.req.param("id"), { answer: b.answer, text: typeof b.text === "string" ? b.text : undefined })); });
  app.post("/api/owner/blocks/:ref", async (c) => { const s = await staff(c); return c.json(await cf(c).owner.block(s, c.req.param("ref"), (await body(c)).action)); });
  app.put("/api/owner/mail", async (c) => { const s = await staff(c), b = await body(c); return c.json(await cf(c).owner.setMail(s, { weekly: b.weekly, monthly: b.monthly })); });
}
