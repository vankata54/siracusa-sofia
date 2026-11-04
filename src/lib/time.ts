/* Clock for the opening-hours logic (port of SC.now / SC.minutes). Everything that depends on the hour reads it from here.
   An override ("21:30") is used by tests, the admin preview frames and the demo build; production pages never set it. */
export interface Clock { h: number; m: number }
export type ClockInput = string | Clock | number | null | undefined;

let override: Clock | null = null;

export function parseTime(t: string): Clock | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t).trim());
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? { h, m: mi } : null;
}

/** Set a global clock override ("21:30"), or null / "now" to use the real Sofia time. */
export function setClock(t: string | Clock | null | undefined): void {
  if (!t || t === "now") { override = null; return; }
  override = typeof t === "string" ? parseTime(t) : t;
}
export function clockOverride(): Clock | null { return override; }

/** Real wall time in Europe/Sofia. */
export function sofiaNow(d: Date = new Date()): Clock {
  try {
    const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":");
    return { h: +f[0] % 24, m: +f[1] };
  } catch {
    return { h: d.getHours(), m: d.getMinutes() };
  }
}

/** Current time: explicit argument > global override > real Sofia time. A number is minutes since midnight. */
export function now(o?: ClockInput): Clock {
  if (typeof o === "number") return { h: Math.floor(o / 60) % 24, m: o % 60 };
  if (typeof o === "string" && o !== "now") { const p = parseTime(o); if (p) return p; }
  if (o && typeof o === "object") return o;
  return override || sofiaNow();
}

export function minutes(o?: ClockInput): number {
  const n = now(o);
  return n.h * 60 + n.m;
}
