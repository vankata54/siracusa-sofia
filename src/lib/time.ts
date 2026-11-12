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

/* Preview mode (demo build, admin preview frames, ?preview=1): the browser runtime switches it on. The API client then
   sends the preview clock to a server that allows it (SC_PREVIEW_API=1, tests only); real pages never set it. */
let preview = false;
export function setPreview(b: boolean): void { preview = !!b; }
export function isPreview(): boolean { return preview; }

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

/** Date in Sofia as "YYYY-MM-DD". */
export function sofiaYmd(d: Date = new Date()): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d); }
  catch { return d.toISOString().slice(0, 10); }
}
/** "2026-11-12" + 1 -> "2026-11-13" (calendar days, no time zone involved). */
export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/* validYmd lives in core/reservations.ts: time.ts is part of the shared runtime (size budget) and only the core needs it */
/** Epoch ms of a wall-clock time in Sofia ("2026-11-12", 690 = 11:30). */
export function sofiaEpoch(ymd: string, min: number): number {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d, Math.floor(min / 60), min % 60);
  /* the offset of Sofia at that moment (+2 or +3 hours) */
  const n = sofiaNow(new Date(guess)), ymdAt = sofiaYmd(new Date(guess));
  let off = n.h * 60 + n.m - min;
  if (ymdAt > ymd) off += 1440; else if (ymdAt < ymd) off -= 1440;
  return guess - off * 60_000;
}
