/* Siracusa · small shared pieces of the waiter's screens "Маса", "Нова поръчка" and "Часовник" (stage D, author W2).
   - the words and icons of the table states, the call reasons and the line states (the same as the prototype's ST.*);
   - the sheet "Грамаж" for the steaks "за 100 гр." (Black Angus): 300 / 400 / 500 / 600 гр. + "Друг грамаж" 100-2000;
   - the order that waits for the connection: localStorage "st-outbox" (the frame's offline mode "queue": it is sent by
     itself as soon as the connection is back; a refusal of the core puts it back in the table's draft "st-draft-<n>");
   - the draft of a new order per table ("st-draft-<n>"): never a customer cart, kept on this phone only.
   No menu here (the order page brings it), nothing of the site's runtime. */
import { ic } from "../../lib/icons.ts";
import { esc, fmt, DAYS_SHORT, MONTHS } from "../../lib/format.ts";
import { sofiaYmd } from "../../lib/time.ts";
import { shiftDay as dayOf } from "../../lib/shift-day.ts";
import { floorApi, ApiError, type StaffOrderInput } from "../../client/api-floor.ts";
import type { Staff, ShiftInfo } from "../staff/frame.ts";
import { shiftInfo } from "./common.ts";

export type StateKey = "call" | "bill" | "qr" | "ready" | "wait" | "busy" | "free";
export const STATE_ICON: Record<StateKey, string> = { call: "bell-ringing", bill: "receipt", qr: "qr-code", ready: "chef-hat", wait: "hourglass", busy: "users", free: "chair" };
/** the short word of a tile / chip ("Готово", not "Готово за сервиране") */
export const STATE_SHORT: Record<StateKey, string> = { call: "Вика", bill: "Сметка", qr: "QR поръчка", ready: "Готово", wait: "Чака поръчка", busy: "Заета", free: "Свободна" };
export const CALL_ICON: Record<string, string> = { order: "fork-knife", bill: "receipt", water: "drop", other: "chat-circle-dots" };
export const CALL_WORD: Record<string, string> = { order: "Поръчка", bill: "Сметка", water: "Вода / прибори", other: "Друго" };
export const LINE_KIND: Record<string, [string, string]> = { accepted: ["acc", "check"], cooking: ["cook", "cooking-pot"], ready: ["ready", "chef-hat"], served: ["served", "check-circle"] };

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
export function lsGet<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } }
export function lsSet(k: string, v: unknown) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
/** "2 артикула" */
export const items = (n: number) => n + " " + (n === 1 ? "артикул" : "артикула");
/** the message of an error for a person */
export const why = (e: unknown) => (e instanceof ApiError && e.message ? e.message : "Нещо се обърка. Опитай пак.");
export const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";

/** "#12", "#12&q=pica", "#q=pica": the table number and the search of the address */
export function readHash(): { n: number | null; q: string } {
  let n: number | null = null, q = "";
  (location.hash || "").slice(1).split("&").forEach((p) => {
    if (!p) return;
    if (/^\d{1,3}$/.test(p)) n = +p;
    else if (p.indexOf("q=") === 0) { try { q = decodeURIComponent(p.slice(2)); } catch { q = p.slice(2); } }
  });
  return { n: n && n > 0 ? n : null, q: q.slice(0, 60) };
}

/** keep the focus on the same control when a part of the screen is drawn again (live data) */
export function keepFocus(root: HTMLElement, draw: () => void) {
  const a = document.activeElement as HTMLElement | null;
  let sel = "";
  if (a && root.contains(a) && a !== root) {
    const d = Array.from(a.attributes).find((x) => x.name.indexOf("data-") === 0 && x.name !== "data-since");
    if (d) sel = "[" + d.name + (d.value ? '="' + CSS.escape(d.value) + '"' : "") + "]";
    else if (a.id) sel = "#" + CSS.escape(a.id);
  }
  draw();
  if (sel) { const f = $<HTMLElement>(sel, root); if (f) f.focus({ preventScroll: true }); }
}

/** the frame's own sheet (frame.ts sheet(): focus trap, Esc), not the site's SC.sheet of src/client/sc-sheet.ts */
export const sheetOf = (st: Staff) => st.sheet;

/* ---------- the sheet "Грамаж" (a steak "за 100 гр.": the price is grams / 100 × the price) ---------- */
export const GRAMS = [300, 400, 500, 600];
export function gramsSheet(st: Staff, o: { name: string; price100: number; q?: number; start?: number; ok: (price: string) => string; done: (g: number) => void; title?: string }) {
  let gr = o.start || 400;
  const q = o.q || 1;
  const s = sheetOf(st)({
    title: o.title || "Грамаж",
    html: '<p class="shead">' + (q > 1 ? q + "× " : "") + esc(o.name) + " · " + fmt(o.price100) + " за 100\u00a0гр.</p>" +
      '<div class="grams" role="group" aria-label="Грамаж">' + GRAMS.map((v) => '<button class="chip" type="button" data-gr="' + v + '" aria-pressed="' + (v === gr) + '">' + v + "\u00a0гр.</button>").join("") + "</div>" +
      '<div class="field mt14"><label for="gg">Друг грамаж (гр.)</label><input class="input" id="gg" type="number" inputmode="numeric" min="100" max="2000" step="10" value="' + gr + '" aria-describedby="ggerr gghelp"><span class="err" id="ggerr" role="alert" hidden></span>' +
      '<span class="help" id="gghelp">Цената се смята по грамажа' + (q > 1 ? " (за едно парче)" : "") + '. Кой въвежда точното тегло след рязане: <span class="missing">[ЛИПСВА: кухнята или сервитьорът]</span>.</span></div>',
    foot: '<button class="pill pill-red pill-lg pill-block" type="button" data-gok>' + o.ok('<span class="price" data-gp>' + fmt((o.price100 * gr * q) / 100) + "</span>") + "</button>",
    focus: '[aria-pressed="true"]',
  });
  const gi = $<HTMLInputElement>("#gg", s.el)!, ge = $("#ggerr", s.el)!, gb = $<HTMLButtonElement>("[data-gok]", s.el)!;
  function upd() {
    const raw = gi.value.trim(), v = Math.round(+raw || 0), bad = !raw || v < 100 || v > 2000;
    if (!bad) gr = v;
    ge.hidden = !bad; ge.textContent = v > 2000 ? "До 2000 гр. За повече: две отделни парчета." : "Поне 100 гр.";
    gi.setAttribute("aria-invalid", String(bad)); gb.disabled = bad;
    $("[data-gp]", s.el)!.textContent = fmt((o.price100 * gr * q) / 100);
    $$("[data-gr]", s.el).forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.gr! === v)));
  }
  gi.addEventListener("input", upd);
  gi.addEventListener("keydown", (e) => { if (e.key === "Enter" && !gb.disabled) { e.preventDefault(); gb.click(); } });
  s.el.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b) return;
    if (b.dataset.gr) { gi.value = b.dataset.gr; upd(); }
    if (b.hasAttribute("data-gok") && !b.disabled) { s.close(); o.done(gr); }
  });
  return s;
}

/* ---------- who and when: every draft and every saved order belongs to one person and one shift day ----------
   A phone is shared (the PIN sign-in): an order kept on it is sent by itself ONLY for the person who saved it, on the same
   shift day (Sofia, the day starts at 04:00 like the kitchen's) and within 2 hours. Anything older is never sent by
   itself: it becomes the table's draft for that person to check ("Запазена на телефона в 22:10 и не е изпратена").
   Another person's orders and drafts are never shown, never sent; "Изход" asks and removes the person's own. */
export const STALE_MS = 2 * 3600_000;
/** the one rule of the restaurant (src/lib/shift-day.ts): the day starts at 04:00 Sofia */
export const shiftDay = (t = Date.now()) => dayOf(new Date(t));
export const userOf = (st: Staff) => (st.me ? st.me.user.username : "");
const fresh = (at: number) => shiftDay(at) === shiftDay() && Date.now() - at <= STALE_MS;

/* ---------- the draft of a new order (per table, on this phone, of one person) ---------- */
export interface DraftLine { id: string; q: number; g: number; note: string; bill: string }
export interface Draft {
  split: boolean; guests: string[]; cart: Record<string, DraftLine>; note: string;
  /** the person and the time of the last change (set by saveDraft) */ user?: string; at?: number;
  /** a saved order that was not sent by itself (an earlier shift, over 2 hours): the time it was saved */ kept?: number;
}
export const draftKey = (n: number) => "st-draft-" + n;
export const lineKey = (bill: string, id: string, g?: number) => bill + "|" + id + (g ? "|" + g : "");
/** the draft of this person for the table (a draft of another person or of an earlier shift day is not shown) */
export function readDraft(n: number, user: string): Draft | null {
  const d = lsGet<Draft | null>(draftKey(n), null);
  if (!d || typeof d !== "object" || !d.cart || typeof d.cart !== "object") return null;
  if ((d.user || "") !== user) return null;
  if (!d.kept && (!d.at || shiftDay(d.at) !== shiftDay())) { lsSet(draftKey(n), null); return null; }
  return { split: !!d.split, guests: Array.isArray(d.guests) && d.guests.length ? d.guests.slice(0, 20) : ["Гост 1", "Гост 2"], cart: d.cart, note: String(d.note || ""), user, at: d.at, kept: d.kept };
}
export function saveDraft(n: number, d: Draft, user: string) {
  const has = Object.keys(d.cart).some((k) => d.cart[k].q > 0);
  lsSet(draftKey(n), has || d.note ? { ...d, user, at: Date.now() } : null);
}
const draftKeys = (): string[] => { try { return Object.keys(localStorage).filter((k) => /^st-draft-\d+$/.test(k)); } catch { return []; } };
const hasLines = (d: Draft | null) => !!d && Object.keys(d.cart || {}).some((k) => d.cart[k] && d.cart[k].q > 0);

/* ---------- the orders kept on the phone (no connection, or the answer was lost) ---------- */
export interface Queued {
  id: string; table: number; at: number; n: number; sum: number; input: StaffOrderInput; guests: string[];
  /** "2× Пица Маргарита" (the table screen has no menu) */ labels: string[];
  /** who saved it (the username) and on which shift day */ user: string; day: string;
}
const OUTBOX = "st-outbox";
export const outbox = (): Queued[] => lsGet<Queued[]>(OUTBOX, []).filter((x) => x && typeof x.table === "number" && x.input && Array.isArray(x.input.lines));
/** the person's own orders that may still go by themselves */
export const myQueue = (user: string): Queued[] => outbox().filter((q) => q.user === user && fresh(q.at));
export function enqueue(q: Omit<Queued, "id" | "at" | "day">): Queued {
  const at = Date.now(), x: Queued = { ...q, id: Math.random().toString(36).slice(2, 10), at, day: shiftDay(at) };
  lsSet(OUTBOX, [...outbox(), x]);
  window.dispatchEvent(new CustomEvent("st:outbox"));
  return x;
}
function drop(id: string) { const l = outbox().filter((x) => x.id !== id); lsSet(OUTBOX, l.length ? l : null); }
/** the order goes back to its table's draft of the same person (nothing is lost; the waiter sees why) */
function backToDraft(q: Queued, kept?: number) {
  const d = readDraft(q.table, q.user) || { split: false, guests: q.guests.length ? q.guests : ["Гост 1", "Гост 2"], cart: {}, note: "" };
  for (const l of q.input.lines) {
    const bill = l.guest ? l.guest : "all", k = lineKey(bill, l.id, l.grams || 0);
    const cur = d.cart[k];
    if (cur) cur.q += l.q; else d.cart[k] = { id: l.id, q: l.q, g: l.grams || 0, note: l.note || "", bill };
    if (l.guest) { d.split = true; if (!d.guests.includes(l.guest)) d.guests.push(l.guest); }
  }
  if (q.input.note && !d.note) d.note = q.input.note;
  if (kept) d.kept = kept;
  saveDraft(q.table, d, q.user);
}
/** "22:10" today, "вчера 22:10", "сб, 28 ноември 22:10" (Sofia) */
export function whenSaved(at: number): string {
  const d = new Date(at), hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  const day = sofiaYmd(d), today = sofiaYmd(), yest = sofiaYmd(new Date(Date.now() - 864e5));
  if (day === today) return hm;
  if (day === yest) return "вчера " + hm;
  const p = day.split("-").map(Number), u = new Date(Date.UTC(p[0], p[1] - 1, p[2], 12));
  return DAYS_SHORT[u.getUTCDay()] + ", " + p[2] + " " + MONTHS[p[1] - 1] + " " + hm;
}

let flushing: Promise<void> | null = null;
const sentSubs = new Set<(q: Queued, nos: string[]) => void>();
/** send what waits (oldest first), only the signed-in person's and only the fresh ones; an older one of the person
    becomes the table's draft to check. Stops at the first "no connection"; a refusal of the core returns the order to
    the draft and says why. onSent: the numbers of each order that reached the kitchen (one per order: the same `rid`,
    a resend after a lost answer never makes a second order). The first call also starts the retries and the sign-out
    question for this screen (startOutbox). */
export function flushOutbox(st: Staff, onSent?: (q: Queued, nos: string[]) => void): Promise<void> {
  startOutbox(st);
  if (onSent) sentSubs.add(onSent);
  settleStale(st);
  if (flushing) return flushing;
  const user = userOf(st);
  if (st.offline || !user) return Promise.resolve();
  flushing = (async () => {
    for (const q of outbox()) {
      if (q.user !== user || !fresh(q.at)) continue;
      try {
        const r = await floorApi.order(q.table, q.input);
        drop(q.id); sentSubs.forEach((f) => f(q, r.orders));
        st.toast("Поръчката за Маса " + q.table + " е в кухнята · №\u00a0" + r.orders.join(", №\u00a0"));
      } catch (e) {
        if (isOffline(e)) break;
        drop(q.id); backToDraft(q);
        st.toast("Поръчката за Маса " + q.table + " не тръгна: " + why(e) + " Остана като чернова.", { ms: 8000 });
      }
    }
  })().finally(() => { flushing = null; window.dispatchEvent(new CustomEvent("st:outbox")); });
  return flushing;
}

/** the person's saved orders that are too old to go by themselves become the tables' drafts to check (no network) */
export function settleStale(st: Staff): void {
  const user = userOf(st); if (!user) return;
  for (const q of outbox()) {
    if (q.user !== user || fresh(q.at)) continue;
    drop(q.id); backToDraft(q, q.at);
    st.toast("Поръчката за Маса " + q.table + " от " + whenSaved(q.at) + " не е изпратена. Провери я в „Нова поръчка“.", { ms: 8000 });
  }
}

/* the retries while something waits: soon after it was saved (2 and 4 s: a lost answer), at the browser's "online",
   when the stream is back, and every 15 s; never while the frame says "no connection" */
let started: Staff | null = null;
export function startOutbox(st: Staff): void {
  if (started === st) return;
  started = st;
  const user = userOf(st), go = () => { if (!st.offline && myQueue(user).length) void flushOutbox(st); };
  window.addEventListener("online", () => setTimeout(go, 600));
  st.onReload(go);
  setInterval(go, 15_000);
  window.addEventListener("st:queued", () => { setTimeout(go, 2000); setTimeout(go, 6000); });
  st.beforeLogout(() => askDrop(st));
}
/** a new order was just kept on the phone: try again soon (a lost answer is usually back in seconds) */
export const retrySoon = () => window.dispatchEvent(new CustomEvent("st:queued"));

/** what this person leaves unsent on the phone: the saved orders and the drafts with dishes */
export function pendingOf(user: string): { queued: Queued[]; drafts: number[] } {
  const queued = outbox().filter((q) => q.user === user);
  const drafts = draftKeys().map((k) => +k.slice(9)).filter((n) => hasLines(readDraft(n, user)));
  return { queued, drafts };
}
export function dropMine(user: string) {
  const rest = outbox().filter((q) => q.user !== user);
  lsSet(OUTBOX, rest.length ? rest : null);
  draftKeys().forEach((k) => { const d = lsGet<Draft | null>(k, null); if (d && d.user === user) lsSet(k, null); });
  try { sessionStorage.removeItem("st-recent"); } catch { /* none */ }
}
/** "Изход": the person's unsent orders are asked about and removed (the next person on this phone never sends them) */
export function askDrop(st: Staff): Promise<boolean> {
  const user = userOf(st), p = pendingOf(user), n = p.queued.length + p.drafts.length;
  if (!n) { dropMine(user); return Promise.resolve(true); }
  return new Promise((resolve) => {
    let ok = false;
    const one = n === 1;
    const s = sheetOf(st)({ title: one ? "1 поръчка не е изпратена. Да я изтрия ли?" : n + " поръчки не са изпратени. Да ги изтрия ли?",
      html: '<p class="m0">' + esc([...p.queued.map((q) => "Маса " + q.table + " · " + items(q.n)), ...p.drafts.map((t) => "Маса " + t + " · чернова")].join(", ")) + ". " +
        (one ? "Ако излезеш, тя се изтрива и следващият на този телефон няма да я види." : "Ако излезеш, те се изтриват и следващият на този телефон няма да ги види.") + "</p>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-stay>Остани</button><button class="pill pill-red pill-lg" type="button" data-drop>Изтрий и излез</button>',
      onClose: () => resolve(ok) });
    s.foot!.classList.add("two");
    $<HTMLButtonElement>("[data-stay]", s.el)!.onclick = () => s.close();
    $<HTMLButtonElement>("[data-drop]", s.el)!.onclick = () => { ok = true; dropMine(user); s.close(); };
  });
}

/** the sheet "Смяна" of a screen without the live hall (the table, the new order, the watch): the same rows as the hall
    ("На смяна от", "Моите маси", "Приключи смяната"), the hall read when the sheet opens */
export const shiftSheet = (get: () => Staff | null) => (): Promise<ShiftInfo> => {
  const st = get(); if (!st) return Promise.resolve({});
  return shiftInfo(st, { get: () => null, load: () => floorApi.hall().catch(() => null), set() { /* none */ }, on() { /* none */ } })();
};

/** an icon + a word for a sheet's notice */
export const notice = (icon: string, html: string, warn = false) => '<div class="notice' + (warn ? " warn" : "") + '">' + ic(icon, 22) + "<span>" + html + "</span></div>";
