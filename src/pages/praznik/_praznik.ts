/* Celebration calculator (/praznik/): the browser part. Port of the script of design/pages/celebration.html.
   The server drew the hero, step 1 (fresh state), the summary and "Как става"; here the draft is restored (localStorage
   "sc-celebration-draft", consent always unticked again), the steps are redrawn on every change, and the inquiry goes
   through api.celebrations.create (server or demo core). "Назад" keeps everything (one state for the 3 steps).
   #<type> (from /sabitia/) preselects the occasion. Only in preview (?preview=1): the panel "Само в прототипа"
   (price for the guest, -5% example, send error / offline) and the review states #demo-2, #demo-custom, #demo-3, #demo-sent. */
import { SC } from "../../client/sc-menu.ts";
import { api, ApiError } from "../../client/api.ts";
import { sofiaYmd, addDaysYmd } from "../../lib/time.ts";
import { byId } from "../../lib/data.ts";
import {
  TYPES, PKG, G_MIN, G_MAX, PRICE_DEFAULT, fresh, flowHTML, asideHTML, barHTML, summaryHTML, nextLabel, earlyHTML,
  pkgsHTML, pkgFoot, pkgItems, pickerHTML, mineHTML, picksIn, inquiryNote, typeName, TEL, type St, type View, type Group,
} from "./_calc.ts";

interface Proto { price: "show" | "offer"; send: "ok" | "error" | "offline"; early: boolean }

export function start(): void {
  const { ic, esc } = SC;
  const R = SC.RESTAURANT;
  const main = SC.mount();
  const flow = main.querySelector<HTMLElement>("[data-flow]")!;
  const asideEl = main.querySelector<HTMLElement>("[data-aside]")!;
  const protoEl = main.querySelector<HTMLElement>("[data-proto]")!;
  const cbar = document.querySelector<HTMLElement>("[data-cbar]")!;
  const smooth = (): ScrollBehavior => (SC.reduce ? "auto" : "smooth");

  /* ---------- state ---------- */
  const DRAFT_KEY = "sc-celebration-draft", PROTO_KEY = "sc-celebration-proto";
  let S: St = fresh(), restored = false, sent = false, sending = false, firstMenu = !!SC.preview;
  /* preview only: the admin's decisions and the send result; real visitors get the defaults */
  const P: Proto = SC.preview ? { price: PRICE_DEFAULT, send: "ok", early: false, ...SC.load<Partial<Proto>>(PROTO_KEY, {}) } : { price: PRICE_DEFAULT, send: "ok", early: false };
  const saved = SC.load<{ v: number; s: Partial<St> } | null>(DRAFT_KEY, null);
  if (saved && saved.v === 1 && saved.s) {
    S = { ...S, ...saved.s, consent: false };
    S.picks = (S.picks || []).filter((id) => !!byId[id]);
    if (S.menu && S.menu !== "custom" && !PKG[S.menu]) S.menu = null;
    S.step = Math.min(3, Math.max(1, S.step | 0));
    restored = S.step > 1 || !!S.type || !!S.date || !!S.menu;
  }
  const save = () => SC.store(DRAFT_KEY, { v: 1, s: S });
  const saveProto = () => { if (SC.preview) SC.store(PROTO_KEY, P); };
  const today = () => sofiaYmd();
  const view = (): View => {
    const st = SC.state(), m = SC.minutes();
    return { S, price: P.price, early: P.early, sent, sending, restored, minDate: addDaysYmd(today(), 1), open: st.open, beforeOpen: m < 600 };
  };
  const daysTo = (): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(S.date)) return null;
    const a = Date.UTC(+S.date.slice(0, 4), +S.date.slice(5, 7) - 1, +S.date.slice(8, 10)), t = today();
    const b = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
    return Math.round((a - b) / 864e5);
  };

  /* ---------- errors under the fields ---------- */
  function setErr(id: string, msg?: string) {
    const el = document.getElementById(id); if (!el) return;
    if (msg) { el.innerHTML = ic("warning-circle", 18) + "<span>" + esc(msg) + "</span>"; el.hidden = false; }
    else { el.hidden = true; el.innerHTML = ""; }
  }

  /* ---------- preview panel ("Само в прототипа") ---------- */
  function renderProto() {
    if (!SC.preview) { protoEl.hidden = true; return; }
    protoEl.hidden = false;
    protoEl.innerHTML = '<div class="proto-h">' + ic("sliders-horizontal", 20) + "<span><b>Само в прототипа.</b> Тук пробвате решенията на админа и състоянията на страницата.</span></div>" +
      '<div class="proto-row"><span class="label" id="pp-l">Цена за госта</span><div class="seg" role="group" aria-labelledby="pp-l"><button type="button" data-pp="show" aria-pressed="' + (P.price === "show") + '">Ориентировъчна</button><button type="button" data-pp="offer" aria-pressed="' + (P.price === "offer") + '">Ще ви изпратим оферта</button></div></div>' +
      '<div class="proto-row"><label class="label" for="ps">При изпращане</label><div class="selw"><select class="input" id="ps" data-ps><option value="ok"' + (P.send === "ok" ? " selected" : "") + '>Успешно</option><option value="error"' + (P.send === "error" ? " selected" : "") + '>Грешка</option><option value="offline"' + (P.send === "offline" ? " selected" : "") + ">Без интернет</option></select>" + ic("caret-down", 18) + "</div></div>" +
      '<div class="proto-row"><span class="label" id="pe-l">Ранна резервация -5%</span><div class="seg" role="group" aria-labelledby="pe-l"><button type="button" data-pe="0" aria-pressed="' + !P.early + '">Не важи</button><button type="button" data-pe="1" aria-pressed="' + P.early + '">Важи (пример)</button></div></div>';
  }

  /* ---------- summary: desktop aside + phone bar ---------- */
  function updSummary() {
    main.querySelector(".calc-grid")!.classList.toggle("sent", sent);
    const aside = asideEl.closest<HTMLElement>(".aside")!;
    if (sent) { cbar.hidden = true; aside.style.display = "none"; return; }
    aside.style.display = "";
    const v = view();
    asideEl.innerHTML = asideHTML(v);
    cbar.hidden = false;
    cbar.innerHTML = barHTML(v);
    const nb = cbar.querySelector("[data-next]")!;
    if (sending) nb.setAttribute("aria-busy", "true");
  }
  function updEarly() { const el = flow.querySelector<HTMLElement>("[data-early]"); if (!el) return; el.className = "early" + (P.early ? " on" : ""); el.innerHTML = earlyHTML(view()); }
  function updGuests() {
    const inp = flow.querySelector<HTMLInputElement>("#guests"); if (inp && document.activeElement !== inp) inp.value = String(S.guests);
    flow.querySelectorAll<HTMLElement>("[data-gset]").forEach((b) => b.setAttribute("aria-pressed", String(+b.dataset.gset! === S.guests)));
    const dn = flow.querySelector<HTMLButtonElement>('[data-g="-1"]'), up = flow.querySelector<HTMLButtonElement>('[data-g="1"]');
    if (dn) dn.disabled = S.guests <= G_MIN; if (up) up.disabled = S.guests >= G_MAX;
  }
  function updPkgs() { const v = view(); flow.querySelectorAll<HTMLElement>("[data-pkgf]").forEach((f) => { f.innerHTML = pkgFoot(v, PKG[f.dataset.pkgf!]); }); }
  function updPicker() { const box = flow.querySelector<HTMLElement>("[data-picker]"); if (box) box.innerHTML = pickerHTML(view()); }
  function updPickerLight() {
    const box = flow.querySelector<HTMLElement>("[data-picker]"); if (!box) return;
    box.querySelectorAll<HTMLElement>("[data-pick]").forEach((b) => b.setAttribute("aria-pressed", String(S.picks.includes(b.dataset.pick!))));
    box.querySelectorAll<HTMLElement>("[data-pg]").forEach((b) => {
      const n = picksIn(S, b.dataset.pg as Group).length; let s = b.querySelector<HTMLElement>(".n");
      if (n) { if (!s) { b.insertAdjacentHTML("beforeend", '<span class="n"></span>'); s = b.querySelector<HTMLElement>(".n")!; } s.textContent = String(n); s.setAttribute("aria-label", n + " избрани"); }
      else if (s) s.remove();
    });
    const m = box.querySelector<HTMLElement>("[data-mine] .core"); if (m) m.innerHTML = mineHTML(S);
  }

  /* ---------- render ---------- */
  function render(dir = "") {
    const loading = S.step === 2 && firstMenu && !sent;
    flow.innerHTML = flowHTML(view(), dir, loading);
    if (loading) setTimeout(() => { firstMenu = false; const box = flow.querySelector<HTMLElement>("[data-pkgs]"); if (box) box.innerHTML = pkgsHTML(view()); }, 350);
    else if (S.step === 2) firstMenu = false;
    updSummary();
  }
  const top = (el: Element) => el.getBoundingClientRect().top + window.scrollY;
  function scrollToCalc() { const el = main.querySelector("#calc")!; const y = top(el) - 150; if (window.scrollY > y) window.scrollTo({ top: Math.max(0, y), behavior: smooth() }); }
  function scrollToEl(el: Element | null) { if (!el) return; window.scrollTo({ top: Math.max(0, top(el) - 160), behavior: smooth() }); }
  function focusHead() { flow.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true }); }
  function go(step: number) { const dir = step > S.step ? "fwd" : "bwd"; S.step = step; save(); render(dir); scrollToCalc(); focusHead(); }

  /* ---------- validation ---------- */
  function validate(): boolean {
    let first: { el: HTMLElement; f: string } | null = null;
    const bad = (id: string, msg: string, sel: string) => { setErr(id, msg); if (!first) first = { el: document.getElementById(id)!, f: sel }; };
    if (S.step === 1) {
      setErr("e-type"); setErr("e-date"); setErr("e-guests");
      if (!S.type) bad("e-type", "Изберете повод. Ако го няма в списъка, изберете „Друг повод“.", 'input[name="ctype"]');
      if (!(S.guests >= G_MIN && S.guests <= G_MAX)) bad("e-guests", "Напишете брой гости между 2 и 200. За повече гости се обадете.", "#guests");
      const n = daysTo();
      if (!S.date || n == null) bad("e-date", "Изберете дата на празника.", "#cdate"); else if (n < 1) bad("e-date", "Изберете дата от утре нататък.", "#cdate");
      flow.querySelector("#cdate")?.setAttribute("aria-invalid", String(!S.date || n == null || n < 1));
    }
    if (S.step === 2) {
      setErr("e-menu"); setErr("e-picks");
      if (!S.menu) bad("e-menu", "Изберете пакет или „Собствено меню“.", 'input[name="cmenu"]');
      else if (S.menu === "custom" && !S.picks.length) bad("e-picks", "Изберете поне едно ястие или изберете готов пакет.", "[data-pick]");
    }
    if (S.step === 3) {
      ["e-name", "e-phone", "e-email"].forEach((i) => setErr(i));
      const digits = S.phone.replace(/\D/g, ""), compact = S.phone.replace(/[\s().-]/g, "");
      if (!S.name.trim()) bad("e-name", "Напишете име, за да знаем кого да търсим.", "#cname");
      if (!digits) bad("e-phone", "Напишете телефон, на който да ви се обадим.", "#cphone");
      else if (!/^0\d{9}$/.test(compact) && !/^\+359\d{9}$/.test(compact)) bad("e-phone", "Проверете телефона: 10 цифри, започва с 0. Например 0888 12 34 56.", "#cphone");
      if (S.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(S.email)) bad("e-email", "Проверете имейла, например ime@primer.bg. Или го оставете празен.", "#cemail");
      markInvalid();
    }
    if (first) { const f0 = first as { el: HTMLElement; f: string }; scrollToEl(f0.el.closest(".blk, .field, .picker") || f0.el); flow.querySelector<HTMLElement>(f0.f)?.focus({ preventScroll: true }); return false; }
    return true;
  }
  function markInvalid() {
    [["#cname", "e-name"], ["#cphone", "e-phone"], ["#cemail", "e-email"]].forEach((p) => { const el = flow.querySelector(p[0]); el && el.setAttribute("aria-invalid", String(!document.getElementById(p[1])!.hidden)); });
  }

  /* ---------- send ---------- */
  function showAlert(kind: "offline" | "error", msg?: string) {
    const al = flow.querySelector<HTMLElement>("[data-alert]"); if (!al) return;
    al.innerHTML = kind === "offline"
      ? ic("warning-circle", 24) + '<span><b>Няма връзка с интернет.</b><p>Запитването ви е запазено на това устройство. Проверете връзката и опитайте пак.</p><span class="row"><button class="pill pill-ink" type="button" data-retry>Опитай пак</button></span></span>'
      : ic("warning-circle", 24) + "<span><b>Не успяхме да изпратим запитването.</b><p>" + esc(msg || "Нищо не се изгуби. Опитайте пак след малко или ни се обадете.") + '</p><span class="row"><button class="pill pill-ink" type="button" data-retry>Опитай пак</button><a class="pill pill-line" href="' + TEL + '">' + ic("phone", 20) + R.phone + "</a></span></span>";
    al.hidden = false; scrollToEl(al);
  }
  /* field errors from the core: kind / people belong to step 1, name / phone / email to step 3 */
  function fieldErrors(f: Record<string, string>): boolean {
    const step1 = { kind: "e-type", people: "e-guests", date: "e-date" } as Record<string, string>, step3 = { name: "e-name", phone: "e-phone", email: "e-email" } as Record<string, string>;
    const k1 = Object.keys(f).filter((k) => step1[k]), k3 = Object.keys(f).filter((k) => step3[k]);
    if (!k1.length && !k3.length) return false;
    if (k1.length) { go(1); k1.forEach((k) => setErr(step1[k], f[k])); scrollToEl(document.getElementById(step1[k1[0]])); return true; }
    k3.forEach((k) => setErr(step3[k], f[k])); markInvalid();
    const el = document.getElementById(step3[k3[0]]); scrollToEl(el?.closest(".field") || el);
    flow.querySelector<HTMLElement>({ name: "#cname", phone: "#cphone", email: "#cemail" }[k3[0]]!)?.focus({ preventScroll: true });
    return true;
  }
  async function submit() {
    if (sending || !validate()) return;
    const al = flow.querySelector<HTMLElement>("[data-alert]"); if (al) al.hidden = true;
    sending = true; updSummary();
    try {
      if (SC.preview && P.send !== "ok") { await new Promise((r) => setTimeout(r, 900)); throw new ApiError(P.send === "offline" ? "offline" : "server", "", P.send === "offline" ? 0 : 500); }
      if (navigator.onLine === false) throw new ApiError("offline", "", 0);
      await api.celebrations.create({
        kind: typeName(S), people: S.guests, date: S.date, zone: S.zone as "salon" | "garden" | "all",
        pack: S.menu && S.menu !== "custom" ? PKG[S.menu].n : undefined, custom: S.menu === "custom", items: S.menu === "custom" ? S.picks.slice() : S.menu && PKG[S.menu] ? pkgItems(PKG[S.menu]).map((it) => it.x.id) : undefined,
        cake: S.cake !== "none", decor: S.decor === "yes", time: S.time || undefined,
        cakeNote: S.cake === "ours" && S.cakeNote.trim() ? S.cakeNote.trim() : undefined, wishes: S.decor === "yes" && S.wishes.length ? S.wishes.join(", ") : undefined,
        name: S.name.trim(), phone: S.phone.trim(), email: S.email.trim() || undefined, note: inquiryNote(S), marketing: S.consent === true, early: false,
      });
      sending = false; sent = true;
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      render(); scrollToCalc(); focusHead();
    } catch (e) {
      sending = false; updSummary();
      const err = e instanceof ApiError ? e : new ApiError("server", "", 500);
      if (err.code === "invalid" && err.fields && fieldErrors(err.fields)) return;
      showAlert(err.code === "offline" ? "offline" : "error", err.code === "throttled" ? err.message : undefined);
    }
  }

  /* ---------- events ---------- */
  function changed() { save(); if (S.step === 1) { updGuests(); updEarly(); } if (S.step === 2) updPkgs(); updSummary(); }
  function onNext() { if (sending) return; if (S.step < 3) { if (validate()) go(S.step + 1); } else submit(); }
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("button, a"); if (!t) return;
    if (!main.contains(t) && !SC.ov.contains(t)) return;
    const d = t.dataset;
    if (t.hasAttribute("data-next")) { const sw = t.closest(".sheetwrap"); if (sw) sw.querySelector<HTMLElement>("[data-close]")!.click(); onNext(); return; }
    if (t.hasAttribute("data-back")) { if (S.step > 1) go(S.step - 1); return; }
    if (t.hasAttribute("data-sum")) { SC.sheet({ title: "Вашият празник", html: summaryHTML(view(), true) + '<button class="pill pill-red pill-lg pill-block" type="button" data-next style="margin-top:16px">' + nextLabel(view(), false) + "</button>" }); return; }
    if (d.g) { S.guests = Math.max(G_MIN, Math.min(G_MAX, S.guests + +d.g)); setErr("e-guests"); changed(); return; }
    if (d.gset) { S.guests = +d.gset; setErr("e-guests"); changed(); return; }
    if (d.pe) { P.early = d.pe === "1"; saveProto(); renderProto(); updEarly(); updPkgs(); updSummary(); protoEl.querySelector<HTMLElement>('[data-pe="' + d.pe + '"]')?.focus(); return; }
    if (d.pp) { P.price = d.pp as Proto["price"]; saveProto(); renderProto(); updPkgs(); updSummary(); protoEl.querySelector<HTMLElement>('[data-pp="' + P.price + '"]')?.focus(); return; }
    if (d.pg) { S.pg = d.pg as Group; updPicker(); flow.querySelector<HTMLElement>('[data-pg="' + S.pg + '"]')?.focus(); save(); return; }
    if (d.pc) { S.pc[S.pg] = d.pc; updPicker(); flow.querySelector<HTMLElement>('[data-pc="' + d.pc + '"]')?.focus(); save(); return; }
    if (d.pick) { const id = d.pick, i = S.picks.indexOf(id); if (i > -1) S.picks.splice(i, 1); else S.picks.push(id); setErr("e-picks"); updPickerLight(); changed(); return; }
    if (d.unpick) { S.picks = S.picks.filter((x) => x !== d.unpick); updPickerLight(); changed(); SC.toast("Махнато от менюто"); return; }
    if (d.seg) {
      (S as unknown as Record<string, string>)[d.seg] = d.v!;
      t.parentElement!.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === t)));
      flow.querySelectorAll<HTMLElement>("[data-cakebox]").forEach((b) => { b.hidden = b.dataset.cakebox !== S.cake; });
      const db = flow.querySelector<HTMLElement>("[data-decorbox]"); if (db) db.hidden = S.decor !== "yes";
      changed(); return;
    }
    if (d.wish) { const w = d.wish, j = S.wishes.indexOf(w); if (j > -1) S.wishes.splice(j, 1); else S.wishes.push(w); t.setAttribute("aria-pressed", String(j < 0)); changed(); return; }
    if (t.hasAttribute("data-retry")) { submit(); return; }
    if (t.hasAttribute("data-reset")) { S = fresh(); restored = false; firstMenu = false; try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ } render(); SC.toast("Започваме отначало"); return; }
    if (t.hasAttribute("data-again")) { S = fresh(); sent = false; restored = false; render(); scrollToCalc(); return; }
  });
  main.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === "ctype") { S.type = t.value; flow.querySelectorAll(".tile").forEach((l) => l.classList.toggle("on", l.contains(t))); setErr("e-type"); changed(); }
    else if (t.name === "czone") { S.zone = t.value; flow.querySelectorAll(".zone").forEach((l) => l.classList.toggle("on", l.contains(t))); changed(); }
    else if (t.name === "cmenu") {
      S.menu = t.value; flow.querySelectorAll(".pkg").forEach((l) => l.classList.toggle("on", l.contains(t))); setErr("e-menu"); updPicker(); changed();
      if (S.menu === "custom") setTimeout(() => scrollToEl(flow.querySelector("[data-picker]")), 60);
    }
    else if (t.id === "cdate") { S.date = t.value; if (S.date) { setErr("e-date"); t.removeAttribute("aria-invalid"); } changed(); }
    else if (t.id === "ctime") { S.time = t.value; changed(); }
    else if (t.id === "cconsent") { S.consent = t.checked; }
    else if (t.matches("[data-ps]")) { P.send = t.value as Proto["send"]; saveProto(); }
    else if (t.id === "guests") { let v = parseInt(t.value, 10); if (isNaN(v)) v = S.guests; S.guests = Math.max(G_MIN, Math.min(G_MAX, v)); t.value = String(S.guests); changed(); }
  });
  main.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "guests") { const v = parseInt(t.value, 10); if (!isNaN(v) && v >= G_MIN && v <= G_MAX) { S.guests = v; setErr("e-guests"); changed(); } }
    else if (t.id === "cdate") { S.date = t.value; changed(); }
    else if (t.id === "cname") { S.name = t.value; if (t.value.trim()) { setErr("e-name"); t.removeAttribute("aria-invalid"); } save(); }
    else if (t.id === "cphone") { S.phone = t.value; save(); }
    else if (t.id === "cemail") { S.email = t.value; save(); }
    else if (t.id === "cnote") { S.note = t.value; save(); }
    else if (t.id === "cakenote") { S.cakeNote = t.value; save(); }
  });
  /* the clock moved (preview / midnight): the date minimum and the night note */
  document.addEventListener("sc:tick", () => { const di = flow.querySelector<HTMLInputElement>("#cdate"); if (di) di.min = addDaysYmd(today(), 1); });

  /* ---------- entry: #<type> preselects the occasion; in preview #demo-* opens a prepared state ---------- */
  function fromHash() {
    const toks = decodeURIComponent((location.hash || "").slice(1)).split("+").filter(Boolean);
    toks.forEach((tk) => {
      if (TYPES.some((t) => t.id === tk)) { S.type = tk; if (S.step === 1) restored = false; }
      if (!SC.preview) return;
      if (tk === "offer") P.price = "offer";
      if (tk === "show") P.price = "show";
      if (tk === "early") P.early = true;
      if (tk === "error" || tk === "offline") P.send = tk;
      if (/^demo-/.test(tk)) {
        S = fresh(); S.type = "rozhden-den"; S.guests = 24; S.date = addDaysYmd(today(), 45); S.time = "19:00"; S.zone = "salon"; S.menu = "pesht-i-skara"; restored = false; firstMenu = false;
        if (tk === "demo-2") S.step = 2;
        if (tk === "demo-custom") { S.step = 2; S.menu = "custom"; S.picks = ["set-ot-balgarski-kolbasi", "topeni-sirentsa-s-kornfleyks-i-domashno-sladko-o", "shopska-salata", "svinski-rebra", "tiramisu"]; }
        if (tk === "demo-3" || tk === "demo-sent") { S.step = 3; S.cake = "ours"; S.cakeNote = "Шоколад, „Честит рожден ден, Мария“"; S.decor = "yes"; S.wishes = ["Балони"]; S.name = "Мария Петрова"; S.phone = "0888 12 34 56"; }
        if (tk === "demo-sent") sent = true;
      }
    });
  }
  fromHash();
  window.addEventListener("hashchange", () => { fromHash(); render(); });
  renderProto();
  render();
}
