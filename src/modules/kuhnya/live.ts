/* Кухня: small helpers of the screens "Изчерпано", "Натоварено", "Изпълнени", "Общ изглед" (built on frame.ts).
   - live(): the screen's data from the core, loaded at once and again after the events of real time (debounced), after
     the connection is back, when the page shows again and once a minute (a quiet safety net). Never redrawn under a
     finger (k.afterTouch) and never over an action that is still on its way (hold / release).
   - whoText(): who did it, in the prototype's words ("Скара Bertha", "Главен готвач (Общ изглед)"); the core keeps
     "Кухня · Скара" / "Главен готвач" (the same words in the log and in the admin). */
import type { KFrame } from "./frame.ts";
import type { KConfigView } from "../../client/api-kitchen.ts";

export interface Live { reload(): void; now(): Promise<void>; hold(): void; release(): void; loaded(): boolean; at(): number }
export function live<T>(k: KFrame, o: { load: () => Promise<T>; take: (d: T) => void; events: string[] }): Live {
  let seq = 0, ok = false, pending = 0, want = false, at = 0, last = 0;
  let t: ReturnType<typeof setTimeout> | undefined;
  async function now(): Promise<void> {
    clearTimeout(t);
    if (pending) { want = true; return; }
    const my = ++seq;
    last = Date.now();
    try {
      const d = await k.call(o.load);
      if (my !== seq || pending) { if (pending) want = true; return; }
      ok = true; at = k.now();
      k.afterTouch(() => { if (my === seq) o.take(d); });
    } catch (e) {
      if (my !== seq) return;
      if (!ok) k.fail(e, () => { k.loading(); void now(); });
    }
  }
  const reload = () => { clearTimeout(t); t = setTimeout(() => { void now(); }, 150); };
  for (const ev of o.events) k.on(ev, reload);
  k.onNet((on) => { if (on) reload(); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden && k.online()) reload(); });
  k.onTick(() => { if (ok && k.online() && Date.now() - last >= 60_000) reload(); });
  return {
    reload, now, loaded: () => ok, at: () => at,
    hold: () => { pending++; },
    release: () => { pending = Math.max(0, pending - 1); if (!pending && want) { want = false; reload(); } },
  };
}

/** who switched / marked it, as the prototype writes it */
export function whoText(by: string | null | undefined, cfg: KConfigView): string {
  const b = String(by || "");
  if (b === cfg.all.who) return cfg.all.who + " (" + cfg.all.n + ")";
  const m = /^Кухня · (.+)$/.exec(b), s = m ? cfg.sections.find((x) => x.short === m[1]) : undefined;
  return s ? s.n : b;
}
/** "1 поръчка чака" / "3 поръчки чакат" without the shared runtime's plural() (CODE-GUIDE 3а) */
export const pl = (n: number, one: string, many: string): string => (n === 1 ? one : many);
