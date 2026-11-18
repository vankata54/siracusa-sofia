/* Кухня · Опашка (/kuhnya/): port of design/pages-kuhnya/queue.html over the real queue of the core (kitchenApi.queue).
   FIFO columns, the oldest on the left. A touch on a line = ready for the line; "Започни"; "Готово" with a 1 s hold; the
   last ticked line hands the order over as "Готово" does; the notice with "Върни · 10" (kitchenApi.back with KAct.changed).
   A new order: the ember banner "Нова · Доставка № 1048 · Виж" and "Нова" on the card until it is opened, started or a
   line is ticked. "По-късно N": the orders for a later hour. Everything shown at once, the server's answer settles it;
   with no connection the actions are kept by the frame (k.send) and the card behaves the same.
   The cards are patched one by one (by order number): a card that did not change is never rebuilt, so a hold or a touch
   in progress is not lost when another order arrives. */
import { mountKitchen, ic, esc, reduceMotion, type KFrame } from "./frame.ts";
import { kitchenApi, ApiError, type KAct, type KTicket, type KQueue } from "../../client/api-kitchen.ts";
import { murl } from "../routes.ts";
import type { KSaw } from "./outbox.ts";
import { ticketHTML, ticketSig, timerAt, timerHTML, countsHTML, countsAt, laterRowHTML, lineText, tick, begin, finish, active, fifo, outWait } from "./view.ts";

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode) => root.querySelector<T>(sel);

export async function initQueue(): Promise<void> {
  const k = await mountKitchen({ page: "queue", title: "Опашка" });
  if (!k) return;
  queueScreen(k);
}

function queueScreen(k: KFrame): void {
  const main = k.main, cfg = k.cfg, soon = cfg.soon, guard = cfg.tapGuardMs || 800;
  let list: KTicket[] = [], loaded = false, laterOpen = false, lastTouch = Date.now();
  /* what this tablet already did, until the server says the same */
  const seenLocal = new Set<string>(), leaving = new Set<string>(), arrived = new Set<string>(), sigs = new Map<string, string>(), tapAt = new Map<string, number>(), flying = new Map<string, number>();
  const find = (no: string) => list.find((t) => t.no === no);
  const put = (t: KTicket) => { const i = list.findIndex((x) => x.no === t.no); if (i < 0) { list.push(t); list.sort(fifo); } else list[i] = t; };
  const drop = (no: string) => { list = list.filter((t) => t.no !== no); };
  const smooth = (): ScrollBehavior => (reduceMotion() ? "auto" : "smooth");
  const later = () => (k.queue ? k.queue.later : []);
  /** the newest order nobody opened yet: the banner leads to it */
  const newest = (): KTicket | undefined => list.filter((t) => t.isNew).sort(fifo).pop();

  /* ---------- the row: counters, "Нова", "По-късно", "Звук", "Натоварено" ---------- */
  k.strip(() => {
    if (!loaded) return { counts: "" };
    const counts = countsHTML(countsAt(list, k.now(), soon));
    if (!k.online()) return { counts };
    const nw = newest(), lt = later();
    return { counts, pills:
      (nw ? '<button class="knew" type="button" data-newgo data-fk="new">' + ic("bell-ringing", 22) + (nw.sched ? "Влезе" : "Нова") + " · " + esc(nw.src.text) + ' <span class="go2">Виж' + ic("arrow-right", 16) + "</span></button>" : "") +
      (lt.length ? '<div class="klater"><button class="kpill" type="button" data-later data-fk="later" aria-expanded="' + laterOpen + '">' + ic("calendar-check", 22) + 'По-късно <span class="n">' + lt.length + "</span></button>" +
        (laterOpen ? '<div class="kpanel" role="dialog" aria-label="Поръчки за по-късно" tabindex="-1" data-fk="panel"><h3>По-късно</h3><p>Влизат в опашката ' + cfg.enterBefore + " мин преди часа си.</p>" + lt.map(laterRowHTML).join("") + "</div>" : "") + "</div>" : "") +
      k.pills.sound() + k.pills.busy() +
      /* the head chef looking at one section's queue (#s=…): the way back, and the row says who is looking */
      (k.tablet !== k.sec ? k.pills.back("obsht-izgled", "Общ изглед") : "") };
  });
  const closeLater = (focus: boolean) => { if (!laterOpen) return; laterOpen = false; k.strip(); if (focus) k.afterTouch(() => $("[data-later]", k.stripEl)?.focus({ preventScroll: true })); };
  k.stripEl.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest("[data-newgo]")) { const nw = newest(); if (nw) see(nw); return; }
    if (t.closest("[data-later]")) {
      laterOpen = !laterOpen; k.strip();
      if (laterOpen) k.afterTouch(() => $(".kpanel", k.stripEl)?.focus({ preventScroll: true }));
    }
  });
  document.addEventListener("pointerdown", (e) => { lastTouch = Date.now(); if (laterOpen && !(e.target as Element).closest(".klater")) closeLater(false); }, { capture: true });
  document.addEventListener("keydown", (e) => { lastTouch = Date.now(); if (laterOpen && e.key === "Escape") { e.preventDefault(); closeLater(true); } }, { capture: true });

  /* ---------- the cards ---------- */
  const qEl = () => $("[data-q]", main);
  const cardOf = (no: string) => { const q = qEl(); return q ? Array.from(q.querySelectorAll<HTMLElement>(".tk")).find((c) => c.dataset.no === no) || null : null; };
  function emptyHTML(): string {
    const snd = k.soundOn(), rdy = k.audioReady(), last = k.queue && k.queue.lastDone;
    return '<div class="kempty" data-q0><div><div class="ill">' + ic("check-circle", 64) + "</div><h2>Няма поръчки в момента</h2>" +
      "<p>Новите поръчки " + (k.all ? "" : "за " + esc(k.secName) + " ") + "ще се появят тук сами" + (snd && rdy ? ", със звуков сигнал" : "") + ".</p>" +
      (snd && !rdy ? '<p class="sm">Звук: докоснете екрана, за да чувате новите поръчки.</p>' : "") +
      (last ? '<p class="sm">Последна изпълнена: ' + esc(last.text) + " в " + esc(last.hm) + "</p>" : "") + "</div></div>";
  }
  let emptyH = "";
  function render(): void {
    if (!loaded) return;
    if (!list.length) {
      const h = emptyHTML();
      if (emptyH !== h || !$("[data-q0]", main)) { main.innerHTML = h; emptyH = h; sigs.clear(); }
      k.strip(); k.setTab("queue", 0);
      return;
    }
    let q = qEl();
    if (!q) {
      main.innerHTML = '<button class="kless" type="button" data-kless hidden></button><div class="kq" data-q></div><button class="kmore" type="button" data-kmore hidden></button>';
      q = qEl()!; sigs.clear();
      q.addEventListener("scroll", edges, { passive: true });
    }
    const have = new Map<string, HTMLElement>();
    q.querySelectorAll<HTMLElement>(".tk").forEach((el) => have.set(el.dataset.no || "", el));
    const now = k.now();
    let prev: Element | null = null;
    for (const t of list) {
      const sig = ticketSig(t, cfg.stateText);
      let el = have.get(t.no) || null;
      if (!el || sigs.get(t.no) !== sig) {
        const tmp = document.createElement("div"); tmp.innerHTML = ticketHTML(t, timerAt(t.due, now, soon), cfg.stateText);
        const neu = tmp.firstElementChild as HTMLElement;
        if (el) {
          /* the same card, changed: keep its inner scroll and the focus */
          const top = $(".tk-b", el)?.scrollTop || 0, act = document.activeElement, sel = act instanceof HTMLElement && el.contains(act) ? (act.hasAttribute("data-ln") ? '[data-ln="' + act.getAttribute("data-ln") + '"]' : act.hasAttribute("data-start") ? "[data-start], [data-done]" : "[data-done]") : "";
          el.replaceWith(neu);
          const b = $(".tk-b", neu); if (b && top) b.scrollTop = top;
          if (sel) $<HTMLElement>(sel, neu)?.focus({ preventScroll: true });
        } else if (arrived.delete(t.no)) neu.classList.add("arr");
        el = neu; sigs.set(t.no, sig); bindHold(el, t.no);
      }
      have.delete(t.no);
      const at: Element | null = prev ? prev.nextElementSibling : q.firstElementChild;
      if (at !== el) q.insertBefore(el, at);
      prev = el;
    }
    have.forEach((el, no) => { el.remove(); sigs.delete(no); });
    k.strip(); k.setTab("queue", list.length); edges();
  }
  /* both edges: "+N още" on the right, "← N по-стари" on the left (the oldest never get lost) */
  function edges(): void {
    const q = qEl(), b = $<HTMLButtonElement>("[data-kmore]", main), a = $<HTMLButtonElement>("[data-kless]", main);
    if (!q || !a || !b) return;
    let hidden = 0, older = 0, late = 0;
    const qr = q.getBoundingClientRect();
    q.querySelectorAll(".tk").forEach((c) => {
      const r = c.getBoundingClientRect();
      if (r.right > qr.right + 4) hidden++;
      if (r.left < qr.left + 8) { older++; if (c.classList.contains("late")) late++; }
    });
    const hb = ic("arrow-right", 26) + "<b>+" + hidden + "</b> <small>още</small>";
    b.hidden = !hidden; if (b.dataset.h !== hb) { b.innerHTML = hb; b.dataset.h = hb; }
    b.setAttribute("aria-label", "+" + hidden + " още " + (hidden === 1 ? "поръчка" : "поръчки") + " вдясно");
    const lateT = late ? late + (late === 1 ? " закъснява" : " закъсняват") : "";
    const ha = ic("arrow-left", 26) + "<b>" + older + "</b> <small>по-стари</small>" + (late ? ' <small class="late">' + lateT.replace(" ", "<br>") + "</small>" : "");
    a.hidden = !older; if (a.dataset.h !== ha) { a.innerHTML = ha; a.dataset.h = ha; }
    a.setAttribute("aria-label", older + " по-стари" + (late ? " " + lateT : "") + ". Към началото на опашката");
  }
  addEventListener("resize", edges);
  const scrollToCard = (card: HTMLElement) => { const q = qEl(); if (!q) return; q.scrollTo({ left: Math.max(0, card.getBoundingClientRect().left - q.getBoundingClientRect().left + q.scrollLeft - 16), behavior: smooth() }); };

  /* ---------- press and hold 1 s (keyboard Enter / Space confirms at once; "Върни" covers mistakes) ---------- */
  function bindHold(card: HTMLElement, no: string): void {
    const btn = $<HTMLButtonElement>("[data-done]", card); if (!btn) return;
    const hint = $(".lbl small", btn)!, orig = hint.textContent || "";
    let t: ReturnType<typeof setTimeout> | null = null, th: ReturnType<typeof setTimeout> | undefined, x0 = 0, y0 = 0;
    const stop = () => { if (t) clearTimeout(t); t = null; btn.classList.remove("holding"); };
    const moved = () => {
      if (!t) return; stop();
      hint.textContent = "Задръж, без да местиш пръста"; btn.classList.add("hint");
      clearTimeout(th); th = setTimeout(() => { hint.textContent = orig; btn.classList.remove("hint"); }, 2200);
    };
    btn.addEventListener("pointerdown", (e) => { if (e.button) return; x0 = e.clientX; y0 = e.clientY; btn.classList.add("holding"); t = setTimeout(() => { t = null; stop(); done(no); }, 1000); });
    btn.addEventListener("pointermove", (e) => { if (t && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 12) moved(); });
    btn.addEventListener("pointerup", stop);
    btn.addEventListener("pointerleave", moved); btn.addEventListener("pointercancel", moved);
    btn.addEventListener("click", (e) => { if (e.detail === 0) done(no, true); });
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  /* ---------- actions ---------- */
  const failed = (e: unknown) => { k.toast("<b>Не се записа</b><small>" + esc(e instanceof ApiError && e.message ? e.message : "Опитай пак.") + "</small>", { secs: 6 }); void k.refresh(); };
  /** send an action of an order; the answer of the last one in flight settles the card */
  async function act(no: string, a: Parameters<KFrame["send"]>[0]): Promise<KAct | null> {
    flying.set(no, (flying.get(no) || 0) + 1);
    try {
      const r = await k.send<KAct>(a);
      const left = (flying.get(no) || 1) - 1; flying.set(no, left);
      if (r && !left && !leaving.has(no)) { if (r.ticket) put(seenLocal.has(no) ? { ...r.ticket, isNew: false } : r.ticket); else drop(no); k.afterTouch(render); }
      return r;
    } catch (e) { flying.set(no, Math.max(0, (flying.get(no) || 1) - 1)); throw e; }
  }
  /** what this tablet shows for the lines it acts on (the core writes the action only while they are still so) */
  const sawOf = (t: KTicket, only?: number[]): KSaw => { const o: KSaw = {}; for (const l of t.lines) if ((!only || only.includes(l.i)) && !outWait(l)) o[l.i] = l.ks; return o; };
  /** after the notice of a card that left: the focus goes to the next card in the queue (never to <body>) */
  const nextFocus = (): HTMLElement | null => $<HTMLElement>(".tk [data-start], .tk [data-done], .tk .ln", main) || main;
  function onLine(no: string, i: number, kbd = false): void {
    const t = find(no), l = t && t.lines.find((x) => x.i === i); if (!t || !l) return;
    const key = no + ":" + i, at = Date.now(), was = l.ks === "ready";
    if (at - (tapAt.get(key) || 0) < guard) return; /* a wet hand: the second touch within 0,8 s does not undo */
    tapAt.set(key, at); seenLocal.add(no);
    const next = tick(t, i, !was), name = esc(lineText(l)), where = esc(t.src.text);
    if (!was && !active(next)) { handOver(t, { k: "line", no, i, ready: true, saw: sawOf(t, [i]) }, kbd); return; } /* the last line: the card leaves the queue, with "Върни" */
    put(next); render();
    const shown = next.lines.find((x) => x.i === i)!.ks;
    const undo = () => { tapAt.delete(key); const c = find(no); if (c) { put(tick(c, i, was)); render(); } act(no, { k: "line", no, i, ready: was, saw: { [i]: shown } }).catch(failed); };
    act(no, { k: "line", no, i, ready: !was, saw: { [i]: l.ks } }).then(() => {
      if (!was) k.toast("<b>" + name + " · готово</b><small>" + where + "</small>", { undo });
      else k.toast("<b>Върнато: " + name + "</b><small>" + where + " · пак е за готвене</small>", { undo });
    }).catch(failed);
  }
  function start(no: string): void {
    const t = find(no); if (!t) return;
    seenLocal.add(no);
    put(begin(t, k.now(), k.hm(k.now()))); render();
    act(no, { k: "start", no, saw: sawOf(t) }).catch(failed);
  }
  const done = (no: string, kbd = false) => { const t = find(no); if (t && !leaving.has(no)) handOver(t, { k: "done", no, saw: sawOf(t) }, kbd); };
  /** the section is ready with the order ("Готово", or its last line): the card leaves, the notice says who was told.
      kbd: pressed with the keyboard: the focus goes to "Върни" in the notice, then to the next card */
  function handOver(t: KTicket, a: { k: "done"; no: string; saw: KSaw } | { k: "line"; no: string; i: number; ready: true; saw: KSaw }, kbd = false): void {
    const no = t.no, prev = t, local = a.k === "line" ? [a.i] : finish(t).changed;
    leaving.add(no); seenLocal.add(no);
    const card = cardOf(no);
    if (card) { if (a.k === "line") { const b = $('[data-ln="' + a.i + '"]', card); if (b) { b.classList.add("done"); b.setAttribute("aria-pressed", "true"); } } card.classList.add("gone"); }
    const gone = new Promise<void>((res) => setTimeout(() => { drop(no); render(); res(); }, 300));
    const title = "<b>" + esc(t.src.text) + " · готово</b>";
    act(no, a).then(async (r) => {
      await gone; leaving.delete(no);
      const lines = r ? r.changed : local;
      const undo = () => {
        put({ ...prev, isNew: false }); render();
        act(no, { k: "back", no, lines, saw: Object.fromEntries(lines.map((i) => [i, "ready"])) as KSaw }).catch(failed);
      };
      if (r && r.ticket) { put(r.ticket); render(); } /* the server kept it in the queue (another tablet returned a line) */
      k.toast(title + "<small>" + (r ? esc(r.msg) : "Ще се изпрати, щом връзката се върне.") + "</small>", { undo, focus: kbd || document.activeElement === document.body, after: nextFocus });
    }).catch(async (e) => { await gone; leaving.delete(no); failed(e); });
  }
  /** "Виж": the banner leads to the card; the order is no longer "Нова" */
  function see(t: KTicket): void {
    seenLocal.add(t.no); put({ ...t, isNew: false }); render();
    const card = cardOf(t.no); if (card) scrollToCard(card);
    lastTouch = Date.now();
    k.call(() => kitchenApi.seen(t.no, k.sec)).catch(() => { /* it stays seen on this tablet */ });
  }
  main.addEventListener("click", (e) => {
    const t = e.target as Element, card = t.closest<HTMLElement>(".tk"), no = card ? card.dataset.no || "" : "";
    const ln = t.closest<HTMLElement>("[data-ln]");
    if (ln && no) { onLine(no, +ln.dataset.ln!, (e as MouseEvent).detail === 0); return; }
    if (t.closest("[data-start]") && no) { start(no); return; }
    const q = qEl(); if (!q) return;
    if (t.closest("[data-kmore]")) q.scrollBy({ left: q.clientWidth * 0.8, behavior: smooth() });
    else if (t.closest("[data-kless]")) q.scrollTo({ left: 0, behavior: smooth() });
  });

  /* ---------- the ticker: only the timer text and the state class change ---------- */
  k.onTick((now) => {
    let changed = false;
    main.querySelectorAll<HTMLElement>(".tk").forEach((card) => {
      const t = find(card.dataset.no || ""); if (!t) return;
      const tm = timerAt(t.due, now, soon);
      if (!card.classList.contains(tm.timer)) { card.classList.remove("ok", "soon", "late"); card.classList.add(tm.timer); changed = true; }
      const el = $("[data-tmr]", card), h = timerHTML(tm);
      if (el && el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    });
    if (changed) { k.strip(); edges(); }
    /* 20 s without a touch: the queue returns to the oldest orders */
    const q = qEl();
    if (q && q.scrollLeft > 40 && Date.now() - lastTouch > 20000) { q.scrollTo({ left: 0, behavior: smooth() }); lastTouch = Date.now(); }
  });

  /* ---------- the data: the frame loads the queue (and again after every event) ---------- */
  function skeleton(): void {
    main.innerHTML = '<div class="kq" aria-hidden="true"><div class="kskel"></div><div class="kskel"></div><div class="kskel"></div></div><span class="vh" role="status">Зареждаме опашката …</span>';
  }
  function take(q: KQueue | null): void {
    if (!q) { if (!loaded) k.fail(k.queueErr, () => { skeleton(); void k.refresh(); }); return; }
    loaded = true;
    list = q.tickets.filter((t) => !leaving.has(t.no)).map((t) => (seenLocal.has(t.no) && t.isNew ? { ...t, isNew: false } : t));
    /* the server agrees: nothing to remember any more */
    for (const no of [...seenLocal]) { const t = q.tickets.find((x) => x.no === no); if (!t || !t.isNew) seenLocal.delete(no); }
    k.afterTouch(() => { render(); go(); });
  }
  k.onNew((t) => arrived.add(t.no));
  k.onQueue(take);
  k.onNet(() => k.strip());
  k.onSound(() => { if (loaded && !list.length) render(); });

  /* ---------- "Търси" and #go=<№>: to the card, framed for a moment ---------- */
  k.goTo = (key: string): boolean => {
    const m = /^([tdp])?(\d+)$/.exec(String(key || "")); if (!m) return false;
    const t = m[1] === "t" ? list.find((x) => x.src.tableNo === +m[2]) : find(m[2]);
    const card = t && cardOf(t.no); if (!card) return false;
    lastTouch = Date.now(); scrollToCard(card);
    card.classList.add("found"); setTimeout(() => card.classList.remove("found"), 2600);
    return true;
  };
  let want = murl.hash().get("go") || "";
  function go(): void {
    if (!want) return;
    const key = want; want = "";
    try { const p = murl.hash(); p.delete("go"); const s = p.toString(); history.replaceState(null, "", location.pathname + location.search + (s ? "#" + s : "")); } catch { /* the address stays */ }
    if (!k.goTo!(key)) k.toast("<b>Поръчката вече не е в опашката</b>", { secs: 5 });
  }

  skeleton();
  if (k.queue) take(k.queue);
}
