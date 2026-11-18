/* The screens of "Кухня" (src/modules/kuhnya): the pure part. The card is drawn from the real views of the core
   (kitchen.queue) for every source: a table (there are no table orders through the public API yet), a delivery from the
   site, a pickup for an hour; the timers from timestamps; what the tablet shows at once (tick / begin / finish); the
   actions kept while there is no connection (outbox) with their real time. */
import { describe, it, expect } from "vitest";
import "sc-icons:fork-knife,moped,storefront,minus,plus,note,x,check,flame,hourglass,warning,warning-circle,bell-ringing,calendar-check,check-circle";
import { createCore, MemoryRepo, type Ctx, type Hasher, type StaffCtx } from "../../src/core/index.ts";
import { ticketHTML, ticketSig, timerAt, timerHTML, mmss, countsAt, countsHTML, laterRowHTML, tick, begin, finish, active, fifo, lineHTML } from "../../src/modules/kuhnya/view.ts";
import { makeOutbox, flushOutbox, type Queued } from "../../src/modules/kuhnya/outbox.ts";

const hasher: Hasher = { async hash(p) { return { salt: "s" + p.length, hash: "h:" + p, algo: "scrypt" }; }, async verify(p, _s, h) { return h === "h:" + p; } };
const DAY = "2026-11-16";
async function mk(start = "19:42") {
  const state = { now: new Date(0) };
  const ctx: Ctx = { repo: new MemoryRepo(), hasher, now: () => state.now, clock: start, smsDemo: true, emit: () => {} };
  const at = (hm: string, sec = 0) => { state.now = new Date(Date.parse(DAY + "T" + hm + ":00+02:00") + sec * 1000); ctx.clock = hm; return state.now; };
  at(start);
  const core = createCore(ctx);
  await core.staff.upsert({ username: "kitchen", name: "Кухня", role: "kitchen", password: "a-long-password-1" });
  const k = (await core.staff.bySession((await core.staff.login("kitchen", "a-long-password-1", "1.1.1.1")).token)) as StaffCtx;
  const line = (id: string, q = 1, mods: string[] = []) => ({ key: id + mods.join(), id, q, mods, extra: 0 });
  const base = { name: "Иван", phone: "0888123456", pay: "cash" as const };
  return { core, k, at, line, base, state };
}
const text = (h: string) => h.replace(/<svg[^>]*>.*?<\/svg>/g, "").replace(/<[^>]+>/g, " ").replace(/&thinsp;/g, " ").replace(/\s+/g, " ").trim();

describe("the card of an order", () => {
  it("a table: „Салон“, „Маса 1“, the lines of the section with „без …“ and the note, „Други секции“ with the three states", async () => {
    const { core, k, at, line, base } = await mk();
    const o = await core.orders.create({ ...base, cart: { mode: "pickup", lines: [line("kebapcheta", 2, ["без лук"]), line("svinski-vrat"), line("pitsa-margarita", 1, ["+ Гъби"]), line("shopska-salata")] }, channel: "waiter", table: "S1", note: "Алергия към ядки" } as never);
    at("19:50");
    const q = await core.kitchen.queue(k, "skara");
    expect(q.tickets).toHaveLength(1);
    const t = q.tickets[0], h = ticketHTML(t, timerAt(t.due, q.now, 5));
    expect(t.src).toMatchObject({ kind: "table", k: "Салон", t: "Маса 1", who: "сервитьора" });
    expect(h).toContain('<article class="tk ok isnew" data-no="' + o.no + '" aria-label="Маса 1">');
    expect(text(h)).toMatch(/^Салон остават 12:00 Маса 1 Нова пристигна 19:42 срок 20:02 Алергия към ядки 2 × Кебапчета без лук , натисни за готово 1 × Свински врат , натисни за готово Други секции 1 × Пица Маргарита Пещ · чака 1 × Шопска салата Салати · чака Започни Готово задръж 1 сек\. : Маса 1$/);
    expect(h).not.toContain("от сайта");
    expect(h).not.toContain("шофьор");
    expect(h).toContain('<span class="md no">'); expect(h).toContain('<div class="tk-note">');
    expect(h).toContain('<span class="vh">, натисни за готово</span></button>'); expect(h).not.toContain("aria-label=\"2");
    expect(h).toContain('<span class="vh">: Маса 1</span></button>');
    /* the icon of the source is the fork and knife, never a question mark */
    expect(h.split('<div class="tk-k">')[1].startsWith('<svg class="ic"')).toBe(true);
    /* the oven: the add-on in ember under the pizza; after "Започни" there: „Пещ · готви се“ on the grill's card and one button on the oven's */
    const p = (await core.kitchen.queue(k, "pesht")).tickets[0];
    expect(ticketHTML(p, timerAt(p.due, q.now, 5))).toContain('<span class="md add">');
    expect(text(lineHTML(p.lines[0]))).toBe("1 × Пица Маргарита + Гъби , натисни за готово");
    expect(text(lineHTML({ ...p.lines[0], ks: "ready" }))).toBe("1 × Пица Маргарита + Гъби , готово");
    await core.kitchen.start(k, o.no, "pesht");
    const t2 = (await core.kitchen.queue(k, "skara")).tickets[0];
    expect(text(ticketHTML(t2, timerAt(t2.due, q.now, 5)))).toContain("1 × Пица Маргарита Пещ · готви се");
    const p2 = (await core.kitchen.queue(k, "pesht")).tickets[0], hp = ticketHTML(p2, timerAt(p2.due, q.now, 5));
    expect(hp).toContain('<footer class="tk-f one">'); expect(hp).not.toContain("data-start");
    expect(text(hp)).toContain("готви се от 19:50");
    expect(hp).not.toContain("isnew");
  });

  it("a delivery from the site: „Доставка“, „№“, „Нова · от сайта“, „шофьор“; „закъснява“ with a plus and the word", async () => {
    const { core, k, at, line, base } = await mk();
    const o = await core.orders.create({ ...base, cart: { mode: "delivery", lines: [line("kebapcheta")] }, addr: "ж.к. Дружба 2, бл. 311", channel: "web" } as never);
    const q = await core.kitchen.queue(k, "skara"), t = q.tickets[0];
    expect(text(ticketHTML(t, timerAt(t.due, q.now, 5)))).toMatch(new RegExp("^Доставка остават 20:00 № " + o.no + " Нова · от сайта пристигна 19:42 срок 20:02 1 × Кебапчета , натисни за готово Започни Готово"));
    at("19:58");
    expect(timerAt(t.due, Date.parse(DAY + "T19:58:00+02:00"), 5)).toEqual({ timer: "soon", left: 240 });
    const late = timerAt(t.due, Date.parse(DAY + "T20:06:01+02:00"), 5);
    expect(late).toEqual({ timer: "late", left: -241 });
    expect(text(timerHTML(late))).toBe("закъснява +04:01");
    expect(text(timerHTML({ timer: "soon", left: 119 }))).toBe("наближава 01:59");
    expect(ticketHTML(t, late)).toContain('<article class="tk late isnew"');
    /* the card without its running timer is the same text at any moment: an unchanged card is never rebuilt */
    expect(ticketSig(t)).toBe(ticketSig({ ...t, left: -5, timer: "late" }));
    expect(mmss(75 * 60 + 10)).toBe("75:10");
  });

  it("a pickup for an hour waits in „По-късно“ and enters with „за 20:30“; the counters follow the clock", async () => {
    const { core, k, at, line, base } = await mk("19:42");
    const o = await core.orders.create({ ...base, cart: { mode: "pickup", lines: [line("kebapcheta"), line("svinski-vrat")] }, slot: "20:30" } as never);
    let q = await core.kitchen.queue(k, "skara");
    expect(q.tickets).toHaveLength(0); expect(q.later).toHaveLength(1);
    expect(text(laterRowHTML(q.later[0]))).toBe("Вземане № " + o.no + " 1 × Кебапчета, 1 × Свински врат за 20:30 влиза в 20:10");
    at("20:11");
    q = await core.kitchen.queue(k, "skara");
    const t = q.tickets[0], h = text(ticketHTML(t, timerAt(t.due, q.now, 5)));
    expect(h).toMatch(/^Вземане остават 19:00 № \d+ Нова · от сайта за 20:30 приета 19:42 1 × Кебапчета/);
    expect(countsAt(q.tickets, q.now, 5)).toEqual({ n: 1, late: 0, soon: 0 });
    expect(countsAt(q.tickets, t.due - 60_000, 5)).toEqual({ n: 1, late: 0, soon: 1 });
    expect(text(countsHTML({ n: 8, late: 1, soon: 2 }))).toBe("Чакат 8 Закъсняват 1 Наближават 2");
    expect(text(countsHTML({ n: 3, late: 0, soon: 0 }))).toBe("Чакат 3");
  });
});

describe("what the tablet shows at once", () => {
  it("tick, begin, finish change a copy; the last ticked line leaves nothing to cook", async () => {
    const { core, k, line, base } = await mk();
    await core.orders.create({ ...base, cart: { mode: "pickup", lines: [line("kebapcheta", 2), line("svinski-vrat")] } } as never);
    const t = (await core.kitchen.queue(k, "skara")).tickets[0], [a, b] = t.lines.map((l) => l.i);
    const t1 = tick(t, a, true);
    expect(t.lines[0].ks).toBe("wait"); expect(t1.lines[0].ks).toBe("ready"); expect(t1.isNew).toBe(false); expect(active(t1)).toBe(true);
    expect(tick(t1, a, false).lines[0].ks).toBe("wait");
    const s = begin(t1, 1000, "19:45");
    expect(s.lines.map((l) => l.ks)).toEqual(["ready", "cook"]); expect(s.startedHm).toBe("19:45");
    expect(tick(s, a, false).lines[0].ks).toBe("cook");
    expect(active(tick(s, b, true))).toBe(false);
    const f = finish(t1);
    expect(f.changed).toEqual([b]); expect(active(f.t)).toBe(false);
    expect([{ ...t, key: 5, no: "12" }, { ...t, key: 5, no: "9" }, { ...t, key: 1, no: "30" }].sort(fifo).map((x) => x.no)).toEqual(["30", "9", "12"]);
  });
});

describe("the actions kept while there is no connection", () => {
  const mem = () => { let v: string | null = null; return { get: () => v, set: (x: string | null) => { v = x; }, raw: () => v }; };
  it("are kept in order with their time and sent when the connection is back; a refused one is dropped, the rest go on", async () => {
    const st = mem(), box = makeOutbox(st);
    box.add("skara", 1000, { k: "line", no: "1042", i: 0, ready: true });
    box.add("skara", 2000, { k: "done", no: "1043" });
    box.add("skara", 3000, { k: "start", no: "1044" });
    expect(makeOutbox(st).list().map((q) => [q.at, q.a.k])).toEqual([[1000, "line"], [2000, "done"], [3000, "start"]]);
    /* still no connection: nothing is lost */
    const off = new Error("offline");
    let r = await flushOutbox(box, async () => { throw off; }, (e) => e === off);
    expect(r).toEqual({ sent: 0, dropped: [], stopped: true }); expect(box.size()).toBe(3);
    /* back: the first goes, the second is refused by the server (the order was closed), the third goes */
    const sent: Queued[] = [];
    r = await flushOutbox(box, async (q) => { if (q.a.k === "done") throw new Error("Поръчката вече е готова. Опресни опашката."); sent.push(q); }, (e) => e === off);
    expect(r).toEqual({ sent: 2, dropped: ["Поръчката вече е готова. Опресни опашката."], stopped: false });
    expect(sent.map((q) => [q.sec, q.at, q.a.k])).toEqual([["skara", 1000, "line"], ["skara", 3000, "start"]]);
    expect(box.size()).toBe(0); expect(st.raw()).toBeNull();
  });
  it("a broken or foreign value in the storage is ignored", () => {
    const st = mem(); st.set('[{"id":"a","sec":"skara","at":"x","a":{"k":"line"}},{"id":"b","sec":"skara","at":5,"a":{"k":"nope"}},7]');
    expect(makeOutbox(st).list()).toEqual([]);
    st.set("{broken"); expect(makeOutbox(st).size()).toBe(0);
  });
});
