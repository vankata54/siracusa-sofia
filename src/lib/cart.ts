/* Pure cart logic (no storage, no DOM). Line key = id + modifications ("pitsa|без лук,+ Кашкавал").
   Stored in the browser as localStorage "sc-cart" = {lines, mode} (same shape as the prototype). */
import { byId } from "./data.ts";

export type Mode = "delivery" | "pickup";
export interface CartLine { key: string; id: string; q: number; mods: string[]; extra: number }
export interface Cart { lines: CartLine[]; mode: Mode }

export function emptyCart(): Cart { return { lines: [], mode: "delivery" }; }

export function lineKey(id: string, mods?: string[]): string {
  return id + (mods && mods.length ? "|" + mods.join(",") : "");
}

/** Returns a new cart (inputs are not mutated). */
export function addLine(c: Cart, id: string, q = 1, opts: { mods?: string[]; extra?: number } = {}): Cart {
  const key = lineKey(id, opts.mods);
  const found = c.lines.some((l) => l.key === key);
  const lines = found
    ? c.lines.map((l) => (l.key === key ? { ...l, q: l.q + q } : l))
    : [...c.lines, { key, id, q, mods: opts.mods || [], extra: opts.extra || 0 }];
  return { ...c, lines };
}
export function setQty(c: Cart, key: string, q: number): Cart {
  return { ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, q } : l)).filter((l) => l.q > 0) };
}
export function removeLine(c: Cart, key: string): { cart: Cart; gone: CartLine | undefined } {
  return { cart: { ...c, lines: c.lines.filter((l) => l.key !== key) }, gone: c.lines.find((l) => l.key === key) };
}
export function count(c: Cart): number { return c.lines.reduce((a, l) => a + l.q, 0); }
/** Sum of (price + extras) x qty; unknown ids count 0. */
export function subtotal(c: Cart): number {
  return c.lines.reduce((a, l) => { const x = byId[l.id]; return a + (x ? x.p * l.q : 0) + (l.extra || 0) * l.q; }, 0);
}
/** Normalise whatever is in storage (old/broken data) into a valid cart. */
export function sanitize(v: unknown): Cart {
  const c = (v && typeof v === "object" ? v : {}) as Partial<Cart>;
  const lines = Array.isArray(c.lines) ? c.lines.filter((l) => l && typeof l.id === "string" && l.q > 0).map((l) => ({
    key: typeof l.key === "string" ? l.key : lineKey(l.id, l.mods), id: l.id, q: Math.floor(+l.q) || 1,
    mods: Array.isArray(l.mods) ? l.mods.map(String) : [], extra: +l.extra || 0,
  })) : [];
  return { lines, mode: c.mode === "pickup" ? "pickup" : "delivery" };
}
