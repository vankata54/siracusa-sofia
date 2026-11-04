/* Pure cart logic (no storage, no DOM). Line key = id + modifications ("pitsa|без лук,+ Кашкавал").
   Stored in the browser as localStorage "sc-cart" = {lines, mode} (same shape as the prototype). */
import { resolveDish } from "./registry.ts";

export type Mode = "delivery" | "pickup";
/* n / p: name and unit price at the moment of adding, so the shared runtime (badge, aria label) works without the menu.
   Pricing for the order always takes the current price from the menu (pricing.ts). */
export interface CartLine { key: string; id: string; q: number; mods: string[]; extra: number; n?: string; p?: number }
export interface Cart { lines: CartLine[]; mode: Mode }

export function emptyCart(): Cart { return { lines: [], mode: "delivery" }; }

export function lineKey(id: string, mods?: string[]): string {
  return id + (mods && mods.length ? "|" + mods.join(",") : "");
}

/** Returns a new cart (inputs are not mutated). */
export function addLine(c: Cart, id: string, q = 1, opts: { mods?: string[]; extra?: number; n?: string; p?: number } = {}): Cart {
  const key = lineKey(id, opts.mods);
  const d = resolveDish(id), n = d?.n ?? opts.n, p = d?.p ?? opts.p;
  const found = c.lines.some((l) => l.key === key);
  const lines = found
    ? c.lines.map((l) => (l.key === key ? { ...l, q: l.q + q } : l))
    : [...c.lines, { key, id, q, mods: opts.mods || [], extra: opts.extra || 0, ...(n != null ? { n } : {}), ...(p != null ? { p } : {}) }];
  return { ...c, lines };
}
export function setQty(c: Cart, key: string, q: number): Cart {
  return { ...c, lines: c.lines.map((l) => (l.key === key ? { ...l, q } : l)).filter((l) => l.q > 0) };
}
export function removeLine(c: Cart, key: string): { cart: Cart; gone: CartLine | undefined } {
  return { cart: { ...c, lines: c.lines.filter((l) => l.key !== key) }, gone: c.lines.find((l) => l.key === key) };
}
export function count(c: Cart): number { return c.lines.reduce((a, l) => a + l.q, 0); }
/** Sum of (price + extras) x qty: current menu price when the menu is loaded, else the price saved in the line. */
export function subtotal(c: Cart): number {
  return c.lines.reduce((a, l) => { const p = resolveDish(l.id)?.p ?? l.p ?? 0; return a + p * l.q + (l.extra || 0) * l.q; }, 0);
}
/** Normalise whatever is in storage (old/broken data) into a valid cart. */
export function sanitize(v: unknown): Cart {
  const c = (v && typeof v === "object" ? v : {}) as Partial<Cart>;
  const lines = Array.isArray(c.lines) ? c.lines.filter((l) => l && typeof l.id === "string" && l.q > 0).map((l) => ({
    key: typeof l.key === "string" ? l.key : lineKey(l.id, l.mods), id: l.id, q: Math.floor(+l.q) || 1,
    mods: Array.isArray(l.mods) ? l.mods.map(String) : [], extra: +l.extra || 0,
    ...(typeof l.n === "string" ? { n: l.n } : {}), ...(Number.isFinite(+(l.p as number)) && l.p != null ? { p: +(l.p as number) } : {}),
  })) : [];
  return { lines, mode: c.mode === "pickup" ? "pickup" : "delivery" };
}
