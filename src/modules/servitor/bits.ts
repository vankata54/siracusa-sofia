/* Siracusa · small shared pieces of the waiter's screens "Маса", "Нова поръчка" and "Часовник" (stage D, author W2).
   - the words and icons of the table states, the call reasons and the line states (the same as the prototype's ST.*);
   - the sheet "Грамаж" for the steaks "за 100 гр." (Black Angus): 300 / 400 / 500 / 600 гр. + "Друг грамаж" 100-2000;
   - the order that waits for the connection: localStorage "st-outbox" (the frame's offline mode "queue": it is sent by
     itself as soon as the connection is back; a refusal of the core puts it back in the table's draft "st-draft-<n>");
   - the draft of a new order per table ("st-draft-<n>"): never a customer cart, kept on this phone only.
   No menu here (the order page brings it), nothing of the site's runtime. */
import { ic } from "../../lib/icons.ts";
import { esc, fmt } from "../../lib/format.ts";
import { floorApi, ApiError, type StaffOrderInput } from "../../client/api-floor.ts";
import type { Staff } from "../staff/frame.ts";

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
    html: '<p style="margin:0 0 12px;font-weight:700">' + (q > 1 ? q + "× " : "") + esc(o.name) + " · " + fmt(o.price100) + " за 100 гр.</p>" +
      '<div class="grams" role="group" aria-label="Грамаж">' + GRAMS.map((v) => '<button class="chip" type="button" data-gr="' + v + '" aria-pressed="' + (v === gr) + '">' + v + " гр.</button>").join("") + "</div>" +
      '<div class="field" style="margin-top:14px"><label for="gg">Друг грамаж (гр.)</label><input class="input" id="gg" type="number" inputmode="numeric" min="100" max="2000" step="10" value="' + gr + '" aria-describedby="ggerr gghelp"><span class="err" id="ggerr" role="alert" hidden></span>' +
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

/* ---------- the draft of a new order (per table, on this phone) ---------- */
export interface DraftLine { id: string; q: number; g: number; note: string; bill: string }
export interface Draft { split: boolean; guests: string[]; cart: Record<string, DraftLine>; note: string }
export const draftKey = (n: number) => "st-draft-" + n;
export const lineKey = (bill: string, id: string, g?: number) => bill + "|" + id + (g ? "|" + g : "");
export function readDraft(n: number): Draft | null {
  const d = lsGet<Draft | null>(draftKey(n), null);
  if (!d || typeof d !== "object" || !d.cart || typeof d.cart !== "object") return null;
  return { split: !!d.split, guests: Array.isArray(d.guests) && d.guests.length ? d.guests.slice(0, 20) : ["Гост 1", "Гост 2"], cart: d.cart, note: String(d.note || "") };
}
export function saveDraft(n: number, d: Draft) {
  const has = Object.keys(d.cart).some((k) => d.cart[k].q > 0);
  lsSet(draftKey(n), has || d.note ? d : null);
}

/* ---------- the orders kept on the phone while there is no connection ---------- */
export interface Queued { id: string; table: number; at: number; n: number; sum: number; input: StaffOrderInput; guests: string[]; /** "2× Пица Маргарита" (the table screen has no menu) */ labels: string[] }
const OUTBOX = "st-outbox";
export const outbox = (): Queued[] => lsGet<Queued[]>(OUTBOX, []).filter((x) => x && typeof x.table === "number" && x.input && Array.isArray(x.input.lines));
export function enqueue(q: Omit<Queued, "id" | "at">): Queued {
  const x: Queued = { ...q, id: Math.random().toString(36).slice(2, 10), at: Date.now() };
  lsSet(OUTBOX, [...outbox(), x]);
  window.dispatchEvent(new CustomEvent("st:outbox"));
  return x;
}
function drop(id: string) { const l = outbox().filter((x) => x.id !== id); lsSet(OUTBOX, l.length ? l : null); }
/** the refused order goes back to its table's draft (nothing is lost; the waiter sees why) */
function backToDraft(q: Queued) {
  const d = readDraft(q.table) || { split: false, guests: q.guests.length ? q.guests : ["Гост 1", "Гост 2"], cart: {}, note: "" };
  for (const l of q.input.lines) {
    const bill = l.guest ? l.guest : "all", k = lineKey(bill, l.id, l.grams || 0);
    const cur = d.cart[k];
    if (cur) cur.q += l.q; else d.cart[k] = { id: l.id, q: l.q, g: l.grams || 0, note: l.note || "", bill };
    if (l.guest) { d.split = true; if (!d.guests.includes(l.guest)) d.guests.push(l.guest); }
  }
  if (q.input.note && !d.note) d.note = q.input.note;
  saveDraft(q.table, d);
}
let flushing: Promise<void> | null = null;
/** send what waits (oldest first). Stops at the first "no connection"; a refusal of the core returns the order to the
    draft and says why. onSent: the numbers of each order that reached the kitchen. */
export function flushOutbox(st: Staff, onSent?: (q: Queued, nos: string[]) => void): Promise<void> {
  if (flushing) return flushing;
  flushing = (async () => {
    for (const q of outbox()) {
      try {
        const r = await floorApi.order(q.table, q.input);
        drop(q.id); if (onSent) onSent(q, r.orders);
        st.toast("Поръчката за Маса " + q.table + " е в кухнята · № " + r.orders.join(", № "));
      } catch (e) {
        if (isOffline(e)) break;
        drop(q.id); backToDraft(q);
        st.toast("Поръчката за Маса " + q.table + " не тръгна: " + why(e) + " Остана като чернова.", { ms: 8000 });
      }
    }
  })().finally(() => { flushing = null; window.dispatchEvent(new CustomEvent("st:outbox")); });
  return flushing;
}

/** an icon + a word for a sheet's notice */
export const notice = (icon: string, html: string, warn = false) => '<div class="notice' + (warn ? " warn" : "") + '">' + ic(icon, 22) + "<span>" + html + "</span></div>";
