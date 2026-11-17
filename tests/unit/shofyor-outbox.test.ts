import { describe, it, expect } from "vitest";
import { makeOutbox, flushOutbox, applyLocal, stepWord, type DQueued } from "../../src/modules/shofyor/outbox.ts";
import type { Delivery } from "../../src/client/api-driver.ts";

/* Шофьор: the steps kept on the phone with no connection (src/modules/shofyor/outbox.ts): their order, what a refusal
   does, and the delivery as a kept step leaves it on the screen. */
function mem() { let v: string | null = null; return { get: () => v, set: (x: string | null) => { v = x; } }; }
const off = Object.assign(new Error("Няма връзка."), { code: "offline" });
const D = (no: string, st: Delivery["st"], extra: Partial<Delivery> = {}): Delivery => ({ no, st, stLabel: "", mine: st !== "wait", pay: "cash", payLabel: "В брой", total: 24.47, feeKnown: true, problem: null, arrivedAt: null, ...extra } as Delivery);

describe("driver outbox", () => {
  it("keeps the steps in order and sends them in the same order", async () => {
    const box = makeOutbox(mem()), sent: string[] = [];
    box.add({ k: "take", nos: ["1042"] }, 1); box.add({ k: "go" }, 2); box.add({ k: "arrive", no: "1042" }, 3);
    expect(box.list().map((q) => q.a.k)).toEqual(["take", "go", "arrive"]);
    const r = await flushOutbox(box, async (q: DQueued) => { sent.push(q.a.k); }, () => false);
    expect(sent).toEqual(["take", "go", "arrive"]);
    expect(r).toEqual({ sent: 3, dropped: [], stopped: false });
    expect(box.size()).toBe(0);
  });
  it("still no connection: stops and keeps the rest; a refusal of the core is dropped with its words", async () => {
    const box = makeOutbox(mem());
    box.add({ k: "deliver", no: "1" }); box.add({ k: "arrive", no: "2" }); box.add({ k: "returned", no: "3" });
    let n = 0;
    const r = await flushOutbox(box, async () => { n++; if (n === 1) throw new Error("№ 1 вече е доставена."); if (n === 2) throw off; }, (e) => (e as { code?: string }).code === "offline");
    expect(r).toEqual({ sent: 0, dropped: ["№ 1 вече е доставена."], stopped: true });
    expect(box.list().map((q) => q.a.k)).toEqual(["arrive", "returned"]);
  });
  it("broken storage gives an empty queue", () => {
    const s = mem(); s.set("{broken"); expect(makeOutbox(s).list()).toEqual([]);
  });
  it("the delivery as the kept step leaves it", () => {
    const d = D("1042", "wait");
    expect(applyLocal(d, { k: "take", nos: ["1042"] }, 0)).toBe(true); expect(d.st).toBe("picked");
    expect(applyLocal(d, { k: "arrive", no: "1042" }, 0)).toBe(false); /* not on the way yet */
    expect(applyLocal(d, { k: "go" }, 0)).toBe(true); expect(d.st).toBe("road");
    expect(applyLocal(d, { k: "arrive", no: "1042" }, 5)).toBe(true); expect(d.arrivedAt).toBe(new Date(5).toISOString());
    expect(applyLocal(d, { k: "problem", no: "1042", kind: "nobody" }, 0)).toBe(true); expect(d.problem!.label).toBe("Няма никой");
    expect(applyLocal(d, { k: "deliver", no: "1042" }, 0)).toBe(true); expect(d.st).toBe("done"); expect(d.problem!.solved).toBe("delivered");
    expect(stepWord({ k: "fuel", input: { litres: "40.5", sum: 60, km: 1 } })).toBe("Зареждане 40,5 л");
  });
});
