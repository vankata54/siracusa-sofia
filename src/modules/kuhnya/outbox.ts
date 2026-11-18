/* Кухня: the actions made while there is no connection. They are kept on the tablet (localStorage "sk-outbox") with the
   moment they were made (`at`, epoch ms by the server's clock) and sent in the same order when the connection is back:
   the core writes them with their real time (KOpt.at). No DOM here: the storage is passed in (unit tests). */

/** an action of the kitchen that changes something (every one of them is idempotent in the core) */
/** saw: the state of each line it acts on as the tablet showed it (index -> state); the core writes the action only while
    the lines are still so, or 409 "Друг таблет промени поръчката" (decision of the chief 18.11) */
export type KSaw = Record<string, "wait" | "cook" | "ready">;
export type KAction =
  | { k: "start"; no: string; saw?: KSaw }
  | { k: "line"; no: string; i: number; ready: boolean; saw?: KSaw }
  | { k: "done"; no: string; saw?: KSaw }
  | { k: "back"; no: string; lines?: number[]; saw?: KSaw }
  | { k: "out"; id: string; out: boolean }
  | { k: "busy"; on: boolean };
export interface Queued { id: string; sec: string; at: number; a: KAction }
export interface OutStore { get(): string | null; set(v: string | null): void }

const KINDS = ["start", "line", "done", "back", "out", "busy"];
const valid = (x: unknown): x is Queued => {
  const q = x as Queued;
  return !!q && typeof q.id === "string" && typeof q.sec === "string" && typeof q.at === "number" && Number.isFinite(q.at) && !!q.a && KINDS.includes(q.a.k);
};
export interface Outbox { list(): Queued[]; add(sec: string, at: number, a: KAction): Queued; remove(id: string): void; size(): number }
export function makeOutbox(store: OutStore): Outbox {
  const read = (): Queued[] => { try { const v = JSON.parse(store.get() || "[]"); return Array.isArray(v) ? v.filter(valid) : []; } catch { return []; } };
  const write = (l: Queued[]) => { try { store.set(l.length ? JSON.stringify(l) : null); } catch { /* storage is full or blocked: the action stays on the screen only */ } };
  let n = 0;
  return {
    list: read,
    add(sec, at, a) { const q: Queued = { id: at.toString(36) + "-" + (n++).toString(36) + Math.random().toString(36).slice(2, 6), sec, at, a }; write([...read(), q]); return q; },
    remove(id) { write(read().filter((x) => x.id !== id)); },
    size: () => read().length,
  };
}
/** what was sent and what the server refused (an order closed in the meantime, an action from another day) */
export interface FlushResult { sent: number; dropped: string[]; stopped: boolean }
/** Sends the kept actions in order. `run` throws; `isOffline(e)` = still no connection: stop and keep the rest. */
export async function flushOutbox(box: Outbox, run: (q: Queued) => Promise<unknown>, isOffline: (e: unknown) => boolean): Promise<FlushResult> {
  const res: FlushResult = { sent: 0, dropped: [], stopped: false };
  for (const q of box.list()) {
    try { await run(q); box.remove(q.id); res.sent++; }
    catch (e) {
      if (isOffline(e)) { res.stopped = true; break; }
      box.remove(q.id); res.dropped.push(e instanceof Error && e.message ? e.message : "Действието не се записа.");
    }
  }
  return res;
}
