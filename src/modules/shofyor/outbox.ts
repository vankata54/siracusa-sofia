/* Шофьор: what the driver did while there was no connection. Kept on the phone (localStorage "dr-outbox") and sent in
   the same order when the connection is back (src/modules/shofyor/app.ts); the core's rules and undo windows apply when
   they arrive. No DOM here: the storage is passed in (unit tests). Also the local picture of a queued step: the screen
   shows the delivery as the step left it ("Записано на телефона") until the server answers. */
import type { Delivery, FuelInput, ProblemKind } from "../../client/api-driver.ts";

/** a step of the driver that changes something */
export type DAction =
  | { k: "take"; nos: string[] }
  | { k: "go"; nos?: string[] }
  | { k: "arrive"; no: string }
  | { k: "deliver"; no: string; sum?: string }
  | { k: "problem"; no: string; kind: ProblemKind; note?: string }
  | { k: "returned"; no: string }
  | { k: "fuel"; input: FuelInput };
export interface DQueued { id: string; at: number; a: DAction }
export interface DStore { get(): string | null; set(v: string | null): void }

const KINDS = ["take", "go", "arrive", "deliver", "problem", "returned", "fuel"];
const valid = (x: unknown): x is DQueued => {
  const q = x as DQueued;
  return !!q && typeof q.id === "string" && typeof q.at === "number" && Number.isFinite(q.at) && !!q.a && KINDS.includes(q.a.k);
};
export interface DOutbox { list(): DQueued[]; add(a: DAction, at?: number): DQueued; remove(id: string): void; size(): number }
export function makeOutbox(store: DStore): DOutbox {
  const read = (): DQueued[] => { try { const v = JSON.parse(store.get() || "[]"); return Array.isArray(v) ? v.filter(valid) : []; } catch { return []; } };
  const write = (l: DQueued[]) => { try { store.set(l.length ? JSON.stringify(l) : null); } catch { /* storage blocked: the step stays on the screen only */ } };
  let n = 0;
  return {
    list: read,
    add(a, at = Date.now()) { const q: DQueued = { id: at.toString(36) + "-" + (n++).toString(36) + Math.random().toString(36).slice(2, 6), at, a }; write([...read(), q]); return q; },
    remove(id) { write(read().filter((x) => x.id !== id)); },
    size: () => read().length,
  };
}
export interface DFlush { sent: number; dropped: string[]; stopped: boolean }
/** sends the kept steps in order; `isOffline(e)`: still no connection, stop and keep the rest; any other refusal drops
    that step (the message is shown) and goes on */
export async function flushOutbox(box: DOutbox, run: (q: DQueued) => Promise<unknown>, isOffline: (e: unknown) => boolean, onDrop?: (q: DQueued, e: unknown) => void): Promise<DFlush> {
  const res: DFlush = { sent: 0, dropped: [], stopped: false };
  for (const q of box.list()) {
    try { await run(q); box.remove(q.id); res.sent++; }
    catch (e) {
      if (isOffline(e)) { res.stopped = true; break; }
      box.remove(q.id); if (onDrop) onDrop(q, e); res.dropped.push(e instanceof Error && e.message ? e.message : "Записът не мина.");
    }
  }
  return res;
}

/** the words of a kept step in "Чакат връзка" */
export function stepWord(a: DAction): string {
  switch (a.k) {
    case "take": return "Взех от ресторанта";
    case "go": return "На път";
    case "arrive": return "Пристигнах";
    case "deliver": return "Доставена";
    case "problem": return "Проблем: " + ({ nobody: "Няма никой", address: "Грешен адрес", refused: "Отказ" } as Record<string, string>)[a.kind];
    case "returned": return "Върнах я в ресторанта";
    case "fuel": return "Зареждане " + String(a.input.litres).replace(".", ",") + " л";
  }
}
/** the numbers a step is about */
export const stepNos = (a: DAction): string[] => (a.k === "take" ? a.nos : a.k === "go" ? a.nos || [] : a.k === "fuel" ? [] : [a.no]);
/** is it a status of a delivery (not a fuel entry) */
export const isStatus = (a: DAction): boolean => a.k !== "fuel";

const LABEL: Record<string, string> = { wait: "В ресторанта", picked: "Взета", road: "На път", done: "Доставена", prob: "Проблем" };
/** the delivery as a kept step leaves it (the screen until the server answers); returns true when it changed */
export function applyLocal(d: Delivery, a: DAction, at: number): boolean {
  const iso = new Date(at).toISOString(), set = (st: Delivery["st"]) => { d.st = st; d.stLabel = LABEL[st] || d.stLabel; };
  switch (a.k) {
    case "take": if (!a.nos.includes(d.no) || d.st !== "wait") return false; set("picked"); d.mine = true; d.pickedAt = iso; return true;
    case "go": if (d.st !== "picked" || !d.mine || (a.nos && !a.nos.includes(d.no))) return false; set("road"); d.onWayAt = iso; return true;
    case "arrive": if (a.no !== d.no || d.st !== "road") return false; d.arrivedAt = d.arrivedAt || iso; return true;
    case "deliver":
      if (a.no !== d.no || !(d.st === "road" || (d.st === "prob" && d.problem && !d.problem.solved))) return false;
      if (d.problem) d.problem = { ...d.problem, solved: "delivered", solvedAt: iso };
      set("done"); d.deliveredAt = iso; d.collected = { pay: d.pay, payLabel: d.payLabel, sum: a.sum != null && a.sum !== "" ? Number(String(a.sum).replace(",", ".")) || d.total : d.total, at: iso, feeMissing: !d.feeKnown }; return true;
    case "problem":
      if (a.no !== d.no || !(d.st === "picked" || d.st === "road")) return false;
      set("prob"); d.problem = { kind: a.kind, label: stepWord(a).slice(9), at: iso, note: a.note || null, solved: "", solvedAt: null }; return true;
    case "returned":
      if (a.no !== d.no) return false;
      d.problem = { ...(d.problem || { kind: "address", label: "Грешен адрес", at: iso, note: null }), solved: "returned", solvedAt: iso };
      set("prob"); return true;
    default: return false;
  }
}
