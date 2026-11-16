/* "Предложи подобрение" on the site (decision 15.11.2026; port of design/ds/suggest.js). The shared runtime
   (src/client/sc.ts) imports this file only at the first tap on a [data-suggest] button (the footer of every page, "Още").
   No sign-in, no personal data. The guest may point at a place on the page (outline and pick, as the pencil; the
   selector and the text come from src/admin/pen-core.ts, never the value of a field).
   Server: POST /api/notes/suggest (only the site's addresses, 3 an hour per device and per IP, 429 with retryIn).
   Demo: the same core in the browser (core.notes.suggest) with the same limit kept in this browser ("sc-suggest"). */
import "sc-icons:check-circle,map-pin,paper-plane-right"; /* the icons of this sheet */
import { esc } from "../lib/format.ts";
import { ApiError, http, pick } from "./api.ts";
import { elementText, kindOf, resolve, selectorFor } from "../admin/pen-core.ts";
import type { NoteInput } from "./api-types.ts";
import type { SCType } from "./sc.ts";

const sc = (): SCType => window.SC;
const LIMIT = 3, HOUR = 3600e3;
const MSG_LIMIT = "Благодарим! Вече получихме няколко предложения от вас. Можете да пишете пак след час.";

/* ---------- the call ---------- */
const recent = (): number[] => { const now = Date.now(); return sc().load<number[]>("sc-suggest", []).filter((t) => typeof t === "number" && now - t < HOUR); };
/** POST /api/notes/suggest; the demo keeps the server's limit in this browser */
export const sendSuggestion = pick(async (c, n: NoteInput) => {
  const r = recent();
  if (r.length >= LIMIT) throw new ApiError("throttled", MSG_LIMIT, 429, undefined, Math.max(1, Math.ceil((Math.min(...r) + HOUR - Date.now()) / 1000)));
  const res = await c.notes.suggest(n, null);
  r.push(Date.now()); sc().store("sc-suggest", r);
  return res;
}, (n) => http<{ id: string }>("POST", "notes/suggest", n));

/* ---------- personal data: a mobile or landline phone, an e-mail (also written with words) ---------- */
export function personal(t: string): boolean {
  const x = " " + t + " ";
  return /[\w.+-]+@[\w-]+\.[\w.]+/.test(x) || /(\+?359|\b0)[\s-]?8\d([\s-]?\d){7}/.test(x) || /(\+?359|\b0)[\s-]?[2-9]\d{0,2}([\s/-]?\d){5,7}\b/.test(x) ||
    /[\w.-]{2,}\s*(\(?\s*(at|ат|маймунка|кльомба)\s*\)?)\s*[\w-]{2,}\s*(\.|dot|точка)\s*[a-zа-я]{2,}/i.test(x);
}
const hm = (ms: number) => { try { return new Intl.DateTimeFormat("bg-BG", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ms)); } catch { const d = new Date(ms); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); } };
/** the address saved with the note: only the path of the page (the demo: without "index.html"); never "?" or "#" (codes,
    keys) and never the secret key of an order (/porachka/1042-k7f3m2pq/ -> /porachka/); the server checks it again */
const urlOf = () => (location.pathname.replace(/index\.html$/, "") || "/").replace(/\/porachka\/[^/]+\/?$/, "/porachka/");

/* ---------- the place on the page ---------- */
type Place = { selector: string; editId: string | null; text: string; kind: string };
let picked: Place | null = null;
const OWN = ".sg-ui, .sg-box, .sheetwrap";
let box: HTMLElement | null = null, bar: HTMLElement | null = null, cand: Element | null = null, lastTouch = false, lastKey = false, pickDone: ((p: Place | null) => void) | null = null;
function draw(el: Element | null) {
  if (!box) {
    box = document.createElement("div"); box.className = "sg-box"; box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:fixed;left:0;top:0;z-index:95;pointer-events:none;border:2px solid var(--red);border-radius:8px;background:color-mix(in srgb, var(--red) 7%, transparent);box-shadow:0 0 0 4px color-mix(in srgb, var(--red) 16%, transparent);transition:opacity 120ms";
    sc().ov.appendChild(box);
  }
  if (!el) { box.style.opacity = "0"; return; }
  const r = el.getBoundingClientRect();
  box.style.opacity = "1"; box.style.width = r.width + 6 + "px"; box.style.height = r.height + 6 + "px"; box.style.transform = "translate(" + (r.left - 3) + "px," + (r.top - 3) + "px)";
}
function barHTML() {
  const t = lastKey ? "<b>Посочете мястото</b> · Tab до него, Enter избира" + (cand ? ": " + esc(kindOf(cand)) : "")
    : cand && lastTouch ? "<b>" + esc(kindOf(cand)) + "</b> · докоснете пак или „Избери това“" : "<b>Посочете мястото</b> на страницата";
  return '<span style="flex:1 1 180px;min-width:0">' + t + "</span>" + (cand && lastTouch ? '<button class="pill pill-ink" type="button" data-sg="pick">Избери това</button>' : "") + '<button class="pill pill-soft" type="button" data-sg="stop">Откажи</button>';
}
function showBar() {
  if (!bar) {
    bar = document.createElement("div"); bar.className = "sg-ui"; bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:96;display:flex;align-items:center;gap:8px;flex-wrap:wrap;width:min(560px, calc(100% - 24px));padding:8px 8px 8px 18px;border-radius:26px;background:var(--ember);color:var(--on-ember);box-shadow:var(--shadow-lg);font-size:16px;font-weight:600;line-height:1.35";
    sc().ov.appendChild(bar);
    bar.addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLElement>("[data-sg]"); if (!b) return; if (b.dataset.sg === "pick" && cand) choose(cand); else stop(null); });
  }
  bar.innerHTML = barHTML();
}
const mine = (e: Event) => !!(e.target as Element | null)?.closest?.(".sg-ui");
const pickAt = (t: EventTarget | null) => resolve(t, window, OWN);
function onMove(e: PointerEvent) { if (e.pointerType === "touch" || mine(e)) return; lastTouch = false; const el = pickAt(e.target); if (el !== cand) { cand = el; draw(el); showBar(); } }
function onDown(e: Event) { if (mine(e)) return; const p = e as PointerEvent; if (p.pointerType) lastTouch = p.pointerType === "touch"; e.stopPropagation(); if (!lastTouch) e.preventDefault(); }
function onClick(e: MouseEvent) {
  if (mine(e)) return;
  e.preventDefault(); e.stopImmediatePropagation();
  const el = pickAt(e.target);
  if (!el) return;
  if (lastTouch && !(cand && (cand === el || cand.contains(el)))) { cand = el; draw(el); showBar(); return; }
  choose(el);
}
function onTouch(e: TouchEvent) { if (!mine(e)) lastTouch = true; }
function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); stop(null); return; }
  if (e.key === "Tab") { lastKey = true; return; }
  if (e.key === "Enter" && cand && !mine(e)) { e.preventDefault(); e.stopPropagation(); choose(cand); }
}
function onFocus(e: FocusEvent) { if (!lastKey || mine(e)) return; const el = pickAt(e.target); if (el) { cand = el; lastTouch = false; draw(el); showBar(); } }
const L: [string, EventListener, AddEventListenerOptions][] = [
  ["pointermove", onMove as EventListener, { capture: true }], ["pointerdown", onDown, { capture: true }], ["mousedown", onDown, { capture: true }],
  ["click", onClick as EventListener, { capture: true }], ["keydown", onKey as EventListener, { capture: true }], ["focusin", onFocus as EventListener, { capture: true }],
  ["touchstart", onTouch as EventListener, { capture: true, passive: true }],
];
function startPick(done: (p: Place | null) => void) {
  pickDone = done; cand = null; lastKey = false; showBar();
  for (const [k, f, o] of L) document.addEventListener(k, f, o);
}
function stop(res: Place | null) {
  for (const [k, f, o] of L) document.removeEventListener(k, f, o);
  lastKey = false;
  bar?.remove(); bar = null; draw(null);
  const d = pickDone; pickDone = null; d && d(res);
}
function choose(el: Element) {
  const ed = el.closest("[data-edit-id]");
  stop({ selector: selectorFor(el), editId: ed ? ed.getAttribute("data-edit-id") : null, text: elementText(el).slice(0, 500), kind: kindOf(el) });
}

/* ---------- the sheet ---------- */
let draft = "", opener: HTMLElement | null = null;
const visible = (el: Element | null): el is HTMLElement => !!el && el.isConnected && (el as HTMLElement).getClientRects().length > 0 && !el.closest("[inert]");
/** the focus goes back to the button that opened the sheet; from "Още" (gone by then) the runtime's own way back ("Още") */
const returnTo = () => (visible(opener) ? opener : null);
/* the sheet is above the cookie banner (its own layer .ov-ck): the layer of the sheets is lifted while it is open */
function lift(on: boolean) { const ov = sc().ov; ov.style.zIndex = on ? "42" : ""; }
const placeHTML = () => {
  if (picked) return '<div class="kv" style="align-items:center;padding:10px 14px;border-radius:18px;background:var(--surface-2)"><span><b>Място:</b> ' + esc(picked.kind) + (picked.text ? " „" + esc(picked.text.slice(0, 40)) + (picked.text.length > 40 ? " …" : "") + "“" : "") + '</span><button class="link" type="button" data-sgp="clear">Махни</button></div>';
  const point = typeof matchMedia === "function" && matchMedia("(hover: hover) and (pointer: fine)").matches;
  return '<button class="pill pill-line pill-block" type="button" data-sgp="pick">' + sc().ic("map-pin", 20) + 'Посочи място на страницата</button><p class="help small muted" style="margin:6px 0 0">По желание: ' + (point ? "посочете" : "докоснете") + " мястото, за което пишете.</p>";
};
function limitSheet(next: number | null, msg: string) {
  const S = sc();
  lift(true);
  S.sheet({ title: "Предложи подобрение", returnTo, onClose: () => lift(false), html: '<div class="empty" style="padding:16px 4px" data-sglimit><div class="ill">' + S.ic("check-circle", 40) + '</div><h3 class="h3">Благодарим за препоръките!</h3><p class="muted" style="margin:0">' + esc(msg.replace(/^Благодарим!\s*/, "")) + (next ? " Може да изпратите нова след " + hm(next) + "." : "") + "</p></div>" });
}
function sheet() {
  const S = sc();
  const next = S.load<number>("sc-suggest-next", 0);
  if (next && next > Date.now()) { limitSheet(next, MSG_LIMIT); return; }
  lift(true);
  const s = S.sheet({
    title: "Предложи подобрение", returnTo, onClose: () => lift(false),
    html: '<form class="stack" data-sgform novalidate style="gap:14px;padding-bottom:4px">' +
      '<p class="muted" style="margin:0">Кажете ни какво да е по-удобно или по-ясно на тази страница. Без вход.</p>' +
      '<div class="field"><label for="sg-t">Какво да подобрим?</label><textarea class="input" id="sg-t" rows="4" required maxlength="4000" aria-describedby="sg-h" placeholder="Например: бутонът е твърде малък"></textarea>' +
      '<p class="err" id="sg-e" hidden></p><p class="help" id="sg-h">Без име, телефон и имейл: препоръката е анонимна.</p></div>' +
      "<div data-place>" + placeHTML() + "</div>" +
      '<button class="pill pill-red pill-lg pill-block" type="submit">' + S.ic("paper-plane-right", 22) + "Изпрати препоръката</button>" +
      '<p class="muted small" style="margin:0;text-align:center">До ' + LIMIT + " препоръки на час от едно устройство.</p></form>",
  });
  const f = s.el.querySelector("[data-sgform]") as HTMLFormElement, ta = f.querySelector("#sg-t") as HTMLTextAreaElement, er = f.querySelector("#sg-e") as HTMLElement, send = f.querySelector("[type=submit]") as HTMLButtonElement;
  ta.value = draft;
  setTimeout(() => { if (ta.isConnected) ta.focus({ preventScroll: true }); }, 360);
  const ok = () => { er.hidden = true; ta.removeAttribute("aria-invalid"); ta.setAttribute("aria-describedby", "sg-h"); };
  ta.addEventListener("input", () => { draft = ta.value; ok(); });
  f.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-sgp]");
    if (!b) return;
    e.preventDefault();
    if (b.dataset.sgp === "clear") { picked = null; (f.querySelector("[data-place]") as HTMLElement).innerHTML = placeHTML(); (f.querySelector("[data-sgp]") as HTMLElement | null)?.focus(); return; }
    draft = ta.value; s.close();
    setTimeout(() => startPick((res) => { if (res) picked = res; sheet(); }), 360);
  });
  let busy = false;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const t = ta.value.trim();
    const bad = (m: string) => { er.textContent = m; er.hidden = false; ta.setAttribute("aria-invalid", "true"); ta.setAttribute("aria-describedby", "sg-e sg-h"); ta.focus(); };
    if (!t) return bad("Напишете какво да подобрим.");
    if (personal(t)) return bad("Моля, без телефон и имейл: препоръката е анонимна.");
    const note: NoteInput = { module: "site", url: urlOf(), selector: picked ? picked.selector : "", editId: picked ? picked.editId : null, text: t.slice(0, 4000), elementText: picked ? picked.text : "", viewport: { w: innerWidth, h: innerHeight } };
    busy = true; send.disabled = true; send.setAttribute("aria-busy", "true");
    try { await sendSuggestion(note); }
    catch (x) {
      busy = false; send.disabled = false; send.removeAttribute("aria-busy");
      const a = x instanceof ApiError ? x : null;
      if (a && a.status === 429) {
        const at = a.retryIn ? Date.now() + a.retryIn * 1000 : null;
        if (at) S.store("sc-suggest-next", at);
        s.close(); setTimeout(() => limitSheet(at, a.message || MSG_LIMIT), 360);
        return;
      }
      return bad((a && a.fields && a.fields.text) || (a && a.message) || "Нещо се обърка. Опитайте пак.");
    }
    draft = ""; picked = null; s.close(); S.toast("Благодарим! Препоръката е изпратена.");
  });
}

/** Opens the sheet (closes "Още" first). The button that was tapped gets the focus back. */
export function openSuggest(from?: Element | null): void {
  const a = (from || document.activeElement) as HTMLElement | null;
  if (a && a.hasAttribute && a.hasAttribute("data-suggest") && !a.closest(".sheetwrap")) opener = a;
  else if (a && a.closest && a.closest(".sheetwrap")) opener = null;
  const open = document.querySelectorAll<HTMLElement>(".sheetwrap.on [data-close]");
  open.forEach((b) => b.click());
  setTimeout(sheet, open.length ? 360 : 0);
}
