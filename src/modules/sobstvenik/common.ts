/* Siracusa · "Собственик": what the four screens share (design/pages-sobstvenik/_own.js, the parts that are not the
   frame). The frame is src/modules/boss/frame.ts (mountBoss); here only the content helpers:
   - the small HTML parts of the prototype (O.sample, O.soon, O.banner, the [ЛИПСВА] marks of the core);
   - the dates ("ср, 18 ноември"), the sums (always with cents; whole numbers only on the axis ticks);
   - the period and the comparison of "Тенденции" and "Финанси" (O.per, O.periodHTML, O.bindPeriod; the hash #p= #c= #a= #b=);
   - screen(): the first load, the polite error, "Опитай пак", real time, a quiet look every minute, the scroll kept;
   - act(): an action of the owner; without a connection it waits on the phone and goes by itself when it is back;
   - the badge of "Решения" (the no-shows + the next question of the agency, as "Чака те");
   - the CSV download (the core's rows: the header first, "Примерни данни" the last line only when the core says so).
   Every sum comes from the core (src/core/owner.ts); nothing here invents a number. */
import "sc-icons:info,sparkle,warning,house,export";
import { ic, esc, plural, type Boss } from "../boss/frame.ts";
import { fmtYmd, sofiaYmd } from "../../admin/a.ts";
import { ownerApi, ApiError, type TrendQuery } from "../../client/api-boss.ts";
import { fmt } from "../../lib/format.ts";
import { murl } from "../routes.ts";
import { aurl } from "../../admin/routes.ts";
import { showTbl } from "./charts.ts";
import { outbox, fresh, type Kept } from "../boss/outbox.ts";

export { ic, esc, plural, fmt };
export const NB = " ";
/** "ср, 18 ноември"; short: "ср, 18 ное" */
export const fd = (ymd: string, short = false) => fmtYmd(ymd, short);
/** the label under a column: up to 7 days the weekday ("вт"), else the date ("18 ное") */
export const dayL = (ymd: string, n: number) => (n <= 7 ? fd(ymd, true).slice(0, 2) : fd(ymd, true).replace(/^.., /, ""));
/** the axis ticks only: "1000 €" (whole) */
export const eur0 = (v: number) => Math.abs(v - Math.round(v)) > 1e-9 ? fmt(v) : Math.round(v).toLocaleString("bg-BG").replace(/\s/g, " ") + " €";
export const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
export const today = () => sofiaYmd();
export function addDays(ymd: string, n: number): string { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); }
export const span = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5) + 1;
/** "19:41" in Sofia */
export function hmNow(): string {
  try { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":"); return String(+p[0] % 24).padStart(2, "0") + ":" + p[1]; }
  catch { const d = new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
}
/** "преди 5 мин" */
export function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return "току-що"; if (m < 60) return "преди " + m + NB + "мин";
  const h = Math.floor(m / 60); if (h < 24) return "преди " + h + NB + "ч.";
  return fd(sofiaYmd(new Date(iso)), true);
}

/* ---------- the small parts of the prototype ---------- */
export const sample = (t?: string) => '<span class="ow-tag">' + ic("info", 16) + esc(t || "Примерни данни") + "</span>";
export const soon = () => '<span class="ow-tag soon">' + ic("sparkle", 16) + "Скоро</span>";
export const missing = (t: string) => '<span class="missing">[ЛИПСВА: ' + esc(t) + "]</span>";
/** the text of the core with its "[ЛИПСВА: …]" marks shown as such */
export const miss = (t: string) => esc(t).replace(/\[ЛИПСВА(?::\s*([^\]]*))?\]/g, (_m, x) => '<span class="missing">[ЛИПСВА' + (x ? ": " + String(x).replace(/ (€|л|км)/g, NB + "$1") : "") + "]</span>");
/** the sum in running text: "7,15 €" never broken before "€" */
export const fmtNb = (v: number) => fmt(v).replace(" €", NB + "€");
/** a comparison with nothing to compare with (0 in the earlier period): said, not hidden */
export const NONE = '<span class="ow-d flat"><small>няма с какво да се сравни</small></span>';
export const banner = (o: { tone?: string; icon?: string; title?: string; text?: string; action?: string }) =>
  '<div class="ow-banner ' + (o.tone || "") + '" role="' + (o.tone === "danger" || o.tone === "warn" ? "alert" : "status") + '">' + ic(o.icon || "info", 26) + '<div class="tx">' + (o.title ? "<b>" + esc(o.title) + "</b>" : "") + (o.text || "") + "</div>" + (o.action || "") + "</div>";
export const isOff = (e: unknown) => e instanceof ApiError && e.code === "offline";
export const msgOf = (e: unknown) => (e instanceof ApiError ? e.message : "Нещо се обърка. Опитай пак.");

/* ---------- the addresses (never by hand) ---------- */
export const go = {
  today: (h?: string) => murl.sobstvenik("", h), trends: (h?: string) => murl.sobstvenik("tendentsii", h),
  finance: (h?: string) => murl.sobstvenik("finansi", h), decisions: (h?: string) => murl.sobstvenik("reshenia", h),
  shift: () => murl.upravitel(""),
  reports: (p?: string) => aurl.section("reports", p && p !== "7" ? "p=" + p : undefined),
  orders: (h?: string) => aurl.section("orders", h), hall: () => aurl.section("hall"), reservations: (h?: string) => aurl.section("reservations", h),
  menu: (id: string) => aurl.section("menu", "d=" + encodeURIComponent(id)), notes: (h?: string) => aurl.section("notes", h),
};

/* ---------- the period and the comparison ("Тенденции", "Финанси") ---------- */
export type Per = "today" | "yday" | "7" | "30" | "month" | "custom";
export const PERIODS: [Per, string][] = [["today", "Днес"], ["yday", "Вчера"], ["7", "7 дни"], ["30", "30 дни"], ["month", "Месец"], ["custom", "Избери дати"]];
export const MAX_DAYS = 92;
export interface PerState { per: Per; cmp: "prev" | "year"; a: string; b: string }
export function hashMap(): Record<string, string> {
  const o: Record<string, string> = {};
  location.hash.slice(1).split("&").forEach((p) => { if (!p) return; const i = p.indexOf("="); try { o[decodeURIComponent(i < 0 ? p : p.slice(0, i))] = i < 0 ? "" : decodeURIComponent(p.slice(i + 1)); } catch { /* broken */ } });
  return o;
}
export function setHash(o: Record<string, string>): void {
  const h = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
  try { history.replaceState(history.state, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ }
}
const okYmd = (v: string) => /^\d{4}-\d\d-\d\d$/.test(v) && new Date(v + "T12:00:00Z").toISOString().slice(0, 10) === v;
/** the period from the address; dates in the future, reversed or over 92 days are set right (cut: the notice to say) */
export function perFromHash(): PerState & { cut?: boolean } {
  const h = hashMap(), t = today(), s: PerState & { cut?: boolean } = { per: "7", cmp: h.c === "year" ? "year" : "prev", a: addDays(t, -13), b: t };
  if (PERIODS.some((p) => p[0] === h.p)) s.per = h.p as Per;
  if (okYmd(h.a || "") && okYmd(h.b || "")) {
    let a = h.a, b = h.b;
    if (a > b) { const x = a; a = b; b = x; }
    if (b > t) b = t; if (a > b) a = b;
    if (span(a, b) > MAX_DAYS) { a = addDays(b, -(MAX_DAYS - 1)); s.cut = true; }
    s.a = a; s.b = b;
  }
  return s;
}
/** "Най-много 92 дни: показваме …" (the prototype's notice) */
export const cutNotice = (s: PerState) => "Най-много " + MAX_DAYS + " дни: показваме " + fd(s.a, true) + " - " + fd(s.b, true);
export function perHash(s: PerState, extra: Record<string, string> = {}): void {
  setHash({ ...hashMap(), p: s.per === "7" ? "" : s.per, c: s.cmp === "year" ? "year" : "", a: s.per === "custom" ? s.a : "", b: s.per === "custom" ? s.b : "", ...extra });
}
/** the query of the core */
export const query = (s: PerState, dish?: string): TrendQuery => ({ period: s.per === "yday" ? "yesterday" : s.per, from: s.per === "custom" ? s.a : undefined, to: s.per === "custom" ? s.b : undefined, compare: s.cmp, dish: dish || undefined });
/** the period the search shows the sales of the dishes for (the selected one on "Тенденции", else 7 days) */
export const findPer: { s: PerState | null } = { s: null };

export function periodHTML(s: PerState): string {
  return '<div class="ow-per" data-edit-id="own.period"><div class="pp"><p class="lbl" id="ow-pl">Период</p><div class="seg" role="group" aria-labelledby="ow-pl">' +
    PERIODS.map((x) => '<button type="button" data-per="' + x[0] + '" aria-pressed="' + (s.per === x[0]) + '">' + x[1] + "</button>").join("") + "</div></div>" +
    '<div class="pc"><p class="lbl" id="ow-cl">Сравни с</p><div class="seg cmp" role="group" aria-labelledby="ow-cl"><button type="button" data-cmp="prev" aria-pressed="' + (s.cmp === "prev") + '">Предишния период</button><button type="button" data-cmp="year" aria-pressed="' + (s.cmp === "year") + '">Миналата година</button></div></div>' +
    (s.per === "custom" ? '<div class="ow-cust"><div class="field"><label for="ow-a">От</label><input class="input" id="ow-a" type="date" max="' + today() + '" value="' + s.a + '" data-ca aria-describedby="ow-ch"></div><div class="field"><label for="ow-b">До</label><input class="input" id="ow-b" type="date" max="' + today() + '" value="' + s.b + '" data-cb aria-describedby="ow-ch"></div><p class="ow-note" id="ow-ch" style="margin:0 0 14px">' + esc(fd(s.a) + " - " + fd(s.b)) + ". Най-много " + MAX_DAYS + " дни.</p></div>" : "") + "</div>";
}
/** the words of a loaded period: the label, "спрямо …", the short name and the column name of the comparison */
export interface PerWords { label: string; cmpLabel: string; cmpShort: string; cmpName: string; one: boolean }
export function perWords(s: PerState, d: { from: string; to: string; until: string | null; cmp: { kind: string; from: string; to: string } }): PerWords {
  const one = d.from === d.to, day = s.per === "today" || s.per === "yday", year = d.cmp.kind === "year", yr = year ? " " + d.cmp.to.slice(0, 4) : "";
  const cl = d.cmp.from === d.cmp.to ? fd(d.cmp.from, true) + yr + (d.until ? " до " + d.until : "") : fd(d.cmp.from, true) + " - " + fd(d.cmp.to, true) + yr;
  return {
    one, label: one ? fd(d.from) : fd(d.from, true) + " - " + fd(d.to, true),
    cmpLabel: year ? "същите дни от седмицата миналата година: " + cl : day ? "същия ден миналата седмица: " + cl : "предишния период: " + cl,
    cmpShort: year ? "миналата година" : day ? "същия ден миналата седмица" : "предишния период",
    cmpName: year ? "Миналата година" : day ? "Същият ден миналата седмица" : "Предишният период",
  };
}
/** the period and the comparison buttons, the dates; redraw() loads again */
export function bindPeriod(boss: Boss, s: PerState, load: () => Promise<void>, words: () => PerWords | null, extra: () => Record<string, string> = () => ({})): void {
  const root = boss.body;
  const told = () => { const w = words(); if (w) boss.say("Период " + w.label + ", сравнение с " + w.cmpShort + "."); };
  root.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-per], [data-cmp]"); if (!t || !root.contains(t)) return;
    if (t.dataset.per) s.per = t.dataset.per as Per; else s.cmp = t.dataset.cmp === "year" ? "year" : "prev";
    perHash(s, extra());
    /* the choice shows at once; the numbers follow when the core answers */
    t.closest(".seg")?.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === t)));
    const sel = t.dataset.per ? '[data-per="' + t.dataset.per + '"]' : '[data-cmp="' + t.dataset.cmp + '"]';
    load().then(() => { told(); const b = root.querySelector<HTMLElement>(".ow-per " + sel) || root.querySelector<HTMLElement>(sel); if (b) b.focus({ preventScroll: true }); });
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement; if (!t.matches || !t.matches("[data-ca], [data-cb]")) return;
    let a = root.querySelector<HTMLInputElement>("[data-ca]")!.value, b = root.querySelector<HTMLInputElement>("[data-cb]")!.value; if (!a || !b) return;
    if (a > b) { const x = a; a = b; b = x; }
    const t0 = today(); if (b > t0) b = t0; if (a > t0) a = t0;
    const cut = span(a, b) > MAX_DAYS; if (cut) a = addDays(b, -(MAX_DAYS - 1));
    s.a = a; s.b = b; perHash(s, extra());
    /* the fields show the period at once (the numbers follow) */
    root.querySelector<HTMLInputElement>("[data-ca]")!.value = a; root.querySelector<HTMLInputElement>("[data-cb]")!.value = b;
    const which = t.matches("[data-ca]") ? "[data-ca]" : "[data-cb]";
    load().then(() => { told(); if (cut) boss.toast(cutNotice(s)); const f = root.querySelector<HTMLElement>(which); if (f) f.focus({ preventScroll: true }); });
  });
}

/* ---------- one screen: load, draw, live, a quiet look ---------- */
export interface Screen<T> { reload(quiet?: boolean): Promise<void>; data(): T | null; redraw(): void }
export function screen<T>(boss: Boss, o: { load: () => Promise<T>; draw: (d: T) => string; after?: (d: T) => void; err: string; top?: () => string; noRights?: string; every?: number; live?: string[];
  /** a period the core refuses (422): set it right and load again (never an error that "Опитай пак" cannot fix) */
  bad?: () => boolean }): Screen<T> {
  let d: T | null = null, seq = 0, t: ReturnType<typeof setTimeout> | undefined;
  const body = boss.body;
  function redraw() {
    if (!d) return;
    const y = window.scrollY, ae = document.activeElement as HTMLElement | null;
    const keep = ae && body.contains(ae) ? (ae.id ? "#" + ae.id : ae.dataset.tbl ? '[data-tbl="' + ae.dataset.tbl + '"]' : ae.dataset.top ? '[data-top="' + ae.dataset.top + '"]' : "") : "";
    const html = o.draw(d);
    /* a focused field is let go first: a date field taken out of the page while focused can keep its old copy */
    if (ae && body.contains(ae)) ae.blur();
    body.innerHTML = html;
    /* the screen is drawn (tests/e2e/boss-frame.spec.ts tells the filled screen from the frame's skeleton by it) */
    body.firstElementChild?.setAttribute("data-owscr", boss.tab);
    if (o.after) o.after(d);
    window.scrollTo(0, y);
    if (keep) { const nf = body.querySelector<HTMLElement>(keep); if (nf) nf.focus({ preventScroll: true }); }
  }
  /* the promise of the latest load: a load overtaken by a newer one waits for it (its caller's toast and focus come after
     the screen shows the new numbers) */
  let latest: Promise<void> = Promise.resolve();
  function reload(quiet = true): Promise<void> { latest = run(quiet); return latest; }
  async function run(quiet: boolean): Promise<void> {
    const my = ++seq;
    body.setAttribute("aria-busy", "true");
    try {
      const r = await o.load();
      if (my !== seq) return latest;
      d = r; boss.loaded(); redraw();
    } catch (e) {
      if (my !== seq) return latest;
      if (isOff(e)) { if (!d) body.innerHTML = (o.top ? o.top() : "") + boss.error("Няма връзка със сървъра. Щом се върне, зареждаме сами.", "Няма връзка"); return; }
      if (e instanceof ApiError && e.status === 403) { body.innerHTML = boss.noRights(o.noRights || "dashboard"); return; }
      if (e instanceof ApiError && e.status === 422 && o.bad && o.bad()) { boss.toast("Избери период до " + MAX_DAYS + " дни, не в бъдещето. Показваме последните 7 дни."); void reload(false); return; }
      if (!d || !quiet) body.innerHTML = (o.top ? o.top() : "") + boss.error(o.err);
    } finally {
      if (my === seq) body.removeAttribute("aria-busy");
    }
  }
  const soon = () => { clearTimeout(t); t = setTimeout(() => { void reload(); }, 400); };
  boss.onLive(soon, o.live);
  boss.onRetry(() => { void flush(boss).then(() => reload(false)); });
  /* the time moves ("до 19:42"): a quiet look every minute (not while the search is typed in or a sheet is open) */
  setInterval(() => {
    if (document.visibilityState === "visible" && !(document.activeElement && document.activeElement.id === "bs-q") && !document.querySelector(".bs-sheetwrap:not(.closing)") && !body.querySelector("textarea:focus, input:focus")) void reload();
  }, o.every || 60_000);
  /* "Таблица" / "Графика" */
  body.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-tbl]"); if (!b) return;
    const id = b.dataset.tbl!; showTbl[id] = !showTbl[id]; redraw();
    const nb = body.querySelector<HTMLElement>('[data-tbl="' + id + '"]'); if (nb) nb.focus({ preventScroll: true });
    boss.say(showTbl[id] ? "Показана е таблицата." : "Показана е графиката.");
  });
  void flush(boss).then(() => reload(false));
  return { reload, data: () => d, redraw };
}

/* ---------- the actions: without a connection they wait on the phone ---------- */
const OFF = " Записано на телефона, тръгва само, щом има връзка.";
type Op = "answer" | "block" | "setMail";
/* the box of THIS person (src/modules/boss/outbox.ts: the same person, the same shift day from 04:00, up to 2 hours) */
let me = "";
const BX = outbox("own-outbox", () => me);
export async function act<T>(boss: Boss, o: { op: Op; args: unknown[]; label: string; run: () => Promise<T>; ok: (r: T) => void; queued?: () => void; fail?: (e: unknown) => boolean;
  /** the whole sentence of the notice when the action waits on the phone */
  offMsg?: string }): Promise<T | null> {
  me = boss.me.user.username;
  const keep = () => { BX.keep(o.op, o.args, o.label); boss.toast(o.offMsg || o.label + "." + OFF); if (o.queued) o.queued(); return null; };
  if (boss.offline()) return keep();
  try { const r = await o.run(); o.ok(r); return r; }
  catch (e) {
    if (isOff(e)) return keep();
    if (o.fail && o.fail(e)) return null;
    boss.toast(msgOf(e));
    return null;
  }
}
/** the answers of this person kept on the phone (not sent yet): question -> {answer, text} (the last one wins) */
export function keptAnswers(boss: Boss): Record<string, { answer: "default" | "other"; text: string }> {
  const out: Record<string, { answer: "default" | "other"; text: string }> = {}, me = boss.me.user.username;
  let l: Kept[] = [];
  try { const v = JSON.parse(localStorage.getItem("own-outbox") || "[]"); l = Array.isArray(v) ? v : []; } catch { /* private mode */ }
  for (const k of l) if (k && k.op === "answer" && k.user === me && fresh(k)) { const a = (k.args[1] || {}) as { answer?: string; text?: string }; out[String(k.args[0])] = { answer: a.answer === "other" ? "other" : "default", text: a.text || "" }; }
  return out;
}
export async function flush(boss: Boss): Promise<void> {
  me = boss.me.user.username;
  const l = BX.take(), old = BX.stale();
  const api = ownerApi as unknown as Record<Op, (...a: unknown[]) => Promise<unknown>>;
  let sent = 0;
  for (const q of l) {
    try { await api[q.op as Op](...q.args); sent++; }
    catch (e) { if (isOff(e)) { BX.back(q); continue; } boss.toast(q.label + ": " + msgOf(e)); }
  }
  if (sent) boss.toast(sent === 1 ? "Записаното на телефона е изпратено." : "Изпратихме " + sent + " записани действия.");
  else if (old.length) boss.toast(old.length + (old.length === 1 ? " записано действие не е изпратено" : " записани действия не са изпратени") + ": по-стари от 2 часа или от друг ден.",
    { action: { label: "Изтрий", fn: () => { BX.drop(true); boss.toast("Изтрити."); } }, ms: 9000 });
}

/** the badge of "Решения" on the screens without "Чака те": the same number (no-shows + the next question) */
export function decBadge(boss: Boss): void {
  let t: ReturnType<typeof setTimeout> | undefined;
  const load = () => { ownerApi.decisions().then((d) => boss.badge("decisions", d.waits.blocks + (d.waits.next ? 1 : 0), ["чака теб", "чакат теб"]), () => { /* the frame's own number stays */ }); };
  boss.onLive(() => { clearTimeout(t); t = setTimeout(load, 500); }, ["reservation.status", "note.created", "note.status", "owner.answer"]);
  load();
}

/* ---------- "Изтегли CSV" ---------- */
export function downloadCsv(name: string, rows: string[][]): boolean {
  try {
    const q = (c: string) => (/[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c);
    const blob = new Blob(["﻿" + rows.map((r) => r.map((c) => q(String(c))).join(";")).join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  } catch { return false; }
}
export const csvBtn = () => '<button class="pill pill-red pill-lg" type="button" data-csv>' + ic("export", 22) + "Изтегли CSV</button>";
