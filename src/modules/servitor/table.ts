/* Siracusa · "Маса" of the waiter (/servitor/masa/#12): port of design/pages-servitor/table.html on the real data of the
   core (floorApi.table, src/core/floor-staff.ts). No bottom nav: "Назад" (Маси) + the action bar.
   - the calls of the table (the same strip as in the hall) with "Отивам" → "Обслужено" (+ "Отмени");
   - "Поръчка от QR · чака потвърждение": "Потвърди и прати" / "Откажи" in the action bar; a steak "за 100 гр." asks the
     grams first (the sheet "Грамаж"); "Откажи" asks the reason (the three of the core) and has "Отмени";
   - the orders by bill ("Обща сметка" / "Гост 1"), "№ 2187 · 19:02 · от QR", the order's note, every line's state
     (Прието, Готви се, Готово за сервиране with "Сервирах" + "Отмени", Сервирано, "Изчерпано днес" from the kitchen);
   - what the phones asked for the bill; "Сметка": Една сметка / По гости / По ястия, В брой / Карта, "Маркирай платено ·
     29,48 €" (each payment keeps its lines, the paid ones are struck and off, the sum is never over the rest);
   - "Затвори масата" only after payment; unserved dishes are listed and asked "Затвори въпреки това";
   - an empty table, guests without an order ("Гостите седнаха": floorApi.seat), the closed sitting;
   - everything live (floor.session, floor.qr, floor.call, order.new, order.line, order.status); no connection: the old
     data with the frame's note, the actions say why they wait; the orders kept on the phone are shown here too. */
import "sc-icons:receipt,money,credit-card,door-open,chair,hourglass,qr-code,note,check,check-circle,cooking-pot,chef-hat,users,bell-ringing,fork-knife,drop,chat-circle-dots,plus,warning,clock,caret-left,x";
import { mountStaff, type Staff, type Sheet } from "../staff/frame.ts";
import { floorApi, ApiError, type TableDetail, type StaffLine, type StaffBill, type HallCall, type PendingLine } from "../../client/api-floor.ts";
import { murl } from "../routes.ts";
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural } from "../../lib/format.ts";
import { $, $$, sheetOf, readHash, keepFocus, gramsSheet, why, isOffline, outbox, flushOutbox, notice, items, STATE_ICON, STATE_SHORT, CALL_ICON, CALL_WORD, LINE_KIND, type StateKey } from "./bits.ts";

type Pay = "cash" | "card";
type Mode = "one" | "guests" | "dishes";
const ALL = "Обща сметка";

export async function mountTable(): Promise<void> {
  const N = readHash().n;
  window.addEventListener("hashchange", () => location.reload());
  const st0 = await mountStaff({ module: "waiter", screen: "table", tab: null, title: N ? "Маса " + N : "Маса", sub: "", back: { href: murl.servitor(), label: "Маси" }, bar: true });
  if (!st0) return;
  const st: Staff = st0;
  const main = st.main, bar = st.bar!;
  if (!N) {
    main.innerHTML = st.empty({ icon: "chair", title: "Коя маса?", text: "Отвори маса от „Залата“.", action: '<a class="pill pill-red pill-lg" href="' + esc(murl.servitor()) + '">Към залата</a>' });
    return;
  }
  let D: TableDetail | null = null, closedNow = false, billRedraw: (() => void) | null = null;

  /* ---------- load ---------- */
  let loading = false, again = false;
  async function load() {
    if (loading) { again = true; return; }
    loading = true;
    try {
      const d = await floorApi.table(N!);
      if (d.session) closedNow = false;
      D = d; st.synced(); render();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { main.innerHTML = st.empty({ icon: "chair", title: "Няма Маса " + N, text: e.message || "Провери номера на масата.", action: '<a class="pill pill-red pill-lg" href="' + esc(murl.servitor()) + '">Към залата</a>' }); bar.innerHTML = ""; }
      else if (!D) st.fail(e);
      else if (!isOffline(e)) st.toast(why(e));
    } finally { loading = false; if (again) { again = false; void load(); } }
  }
  let liveT: ReturnType<typeof setTimeout> | undefined;
  const soon = () => { clearTimeout(liveT); liveT = setTimeout(load, 250); };
  st.onLive(["floor.session", "floor.qr", "floor.call", "order.new", "order.line", "order.status"], (d) => {
    const t = d && typeof d === "object" ? (d as { table?: unknown }).table : undefined;
    if (D && typeof t === "string" && t !== D.table.id) return;
    soon();
  });
  st.onReload(() => { void load(); void flushOutbox(st, () => soon()); });
  st.onNet(() => render());
  window.addEventListener("st:outbox", () => render());

  /* ---------- pieces ---------- */
  const off = () => st.offAttr();
  const lineName = (l: { name: string; grams?: number | null }) => l.name + (l.grams ? " · " + l.grams + " гр." : "");
  function lineStt(l: StaffLine): string {
    if (l.out) return st.stt("wait", "Изчерпано днес", "clock");
    const k = LINE_KIND[l.st] || LINE_KIND.accepted;
    return st.stt(k[0], l.stLabel, k[1]);
  }
  function lineHTML(l: StaffLine): string {
    const mods = l.mods && l.mods.length ? '<div class="mods">' + esc(l.mods.join(", ")) + "</div>" : "";
    return '<div class="oline' + (l.st === "served" || l.out ? " served" : "") + '"><span class="q">' + l.q + "×</span><div><div class=\"nm\">" + esc(lineName(l)) + "</div>" + mods +
      (l.note ? '<div class="note">' + ic("note", 18) + esc(l.note) + "</div>" : "") +
      '<div class="sub">' + lineStt(l) + '<span class="price">' + (l.out ? "<s>" + fmt(l.sum) + "</s>" : fmt(l.sum)) + "</span>" +
      (l.paid ? '<span class="paidrow" style="font-size:14px">' + ic("check-circle", 18) + "Платено</span>" : "") +
      (l.st === "ready" && !l.out ? '<span class="serve"><button class="pill pill-red" type="button" data-serve="' + esc(l.key) + '" aria-label="Сервирах: ' + esc(l.q + "× " + lineName(l)) + '"' + off() + ">" + ic("check", 20) + "Сервирах</button></span>" : "") +
      "</div></div></div>";
  }
  function callHTML(c: HallCall): string {
    const mine = !!c.taken && c.taken.mine, other = !!c.taken && !c.taken.mine;
    const small = mine ? "отивам" : other ? "поема " + esc(c.taken!.name) : '<span class="escl">при управителя</span>';
    return '<div class="cstrip' + (mine || other ? " taken" : "") + (c.late && !c.taken ? " late" : "") + '" style="margin-top:14px"' + (c.taken ? "" : ' data-lvl="120,300"') + '><div class="tx">' + ic(CALL_ICON[c.kind] || "bell-ringing", 24) +
      '<span class="w"><span>Вика · ' + esc(CALL_WORD[c.kind] || c.label) + "</span><small>" + small + "</small></span></div>" +
      '<span class="tm">' + st.timer(Date.parse(c.at)) + "</span>" +
      (mine ? '<button class="pill" type="button" data-done="' + esc(c.id) + '"' + off() + ">" + ic("check", 20) + "Обслужено</button>"
        : other ? "" : '<button class="pill" type="button" data-take="' + esc(c.id) + '"' + off() + ">Отивам</button>") + "</div>";
  }
  function pendingLine(l: PendingLine): string {
    return '<div class="oline"><span class="q">' + l.q + "×</span><div><div class=\"nm\">" + esc(l.name) + "</div>" +
      (l.mods && l.mods.length ? '<div class="mods">' + esc(l.mods.join(", ")) + "</div>" : "") +
      '<div class="sub"><span class="price">' + (l.per100 ? fmt(l.price100 || 0) + " за 100 гр.</span><span class=\"g\">грамаж при потвърждение" : fmt(l.sum || 0)) + "</span></div></div></div>";
  }
  const queued = () => outbox().filter((q) => q.table === N);

  /* ---------- the screen ---------- */
  function render() {
    if (!D) return;
    const d = D;
    st.setTop({ title: "Маса " + d.table.n, sub: d.table.zoneName });
    keepFocus(main, () => { main.innerHTML = closedNow && !d.session ? closedHTML() : bodyHTML(d); });
    drawBar(d);
    if (billRedraw) billRedraw();
  }
  function closedHTML(): string {
    return '<section class="st-sec"><div class="st-empty" style="padding-top:28px"><div class="ill">' + ic("door-open", 48) + "</div><h2>Масата е затворена</h2>" +
      "<p>Следващите гости ще отворят нова сесия, като сканират кода на масата отново.</p>" +
      '<a class="pill pill-line pill-lg" href="' + esc(murl.servitor()) + '">' + ic("caret-left", 22) + "Към масите</a></div></section>";
  }
  function bodyHTML(d: TableDetail): string {
    const s = d.state as StateKey, sess = d.session;
    const who = d.mine ? "Моя маса" : d.owner ? "Маса на " + esc(d.owner.name) : "Без сервитьор";
    let h = '<section class="hero"><div class="thead"><div class="meta"><span>' + who + " · " + plural(d.table.seats, "място", "места") + (sess ? "<br>Заета от " + st.clock(Date.parse(sess.openedAt)) : "") + "</span></div>" +
      st.stt(s, s === "call" ? "Вика" : s === "ready" ? STATE_SHORT.ready : d.label, STATE_ICON[s] || "users") + "</div>";
    d.calls.forEach((c) => { h += callHTML(c); });
    h += "</section>";

    /* the QR order that waits */
    if (d.pending) {
      const p = d.pending;
      h += '<section class="st-sec"><div class="qrcard' + (p.late ? " late" : "") + '"' + (p.late ? "" : ' data-lvl="120,180"') + '><div class="hd">' + ic("qr-code", 24) + "<span>Поръчка от QR · чака потвърждение</span>" + '<span class="tm">' + st.timer(Date.parse(p.at)) + '</span></div><div class="in">' +
        p.lines.map(pendingLine).join("") +
        '<div class="ocard" style="box-shadow:none;padding:0;margin-top:4px"><div class="ft"><span>Общо' + (p.open ? " без стека" : "") + '</span><span class="price">' + fmt(p.sum) + "</span></div></div>" +
        '<p class="small muted" style="margin:10px 0 0">Първата поръчка от QR се потвърждава, за да няма фалшиви поръчки. Следващите от тази маса отиват направо в кухнята' + (p.open ? ", освен стек за 100 гр.: неговият грамаж въвеждаш тук" : "") + ".</p></div></div></section>";
    }

    /* the bill requests of the phones */
    if (d.requests.length && d.rest > 0.004) {
      h += '<section class="st-sec"><div class="st-h"><h2>Искат сметка</h2></div><div class="reqs">' + d.requests.map((r, i) =>
        '<button class="reqrow" type="button" data-req="' + i + '"><span class="ri">' + ic(r.pay === "card" ? "credit-card" : "money", 22) + "</span><span><b>Телефон " + r.phone + " · " + (r.pay === "card" ? "Карта" : "В брой") + "</b><small>" +
        (r.split === "dishes" ? "По ястия" : r.split === "guests" ? "По гости" : "Една сметка") + " · " + st.clock(Date.parse(r.at)) + '</small></span><span class="price">' + fmt(r.sum) + "</span></button>").join("") + "</div></section>";
    }

    /* the orders kept on this phone (no connection) */
    const qd = queued();
    if (qd.length) h += '<section class="st-sec">' + qd.map((q) => '<div class="ocard queued"><div class="oh"><b>Запазена на телефона</b><span>чака връзка</span></div>' +
      '<ul class="qlist">' + (q.labels || []).map((t) => "<li>" + esc(t) + "</li>").join("") + "</ul>" + '<div class="ft"><span>' + items(q.n) + '</span><span class="price">' + fmt(q.sum) + "</span></div>" + "</div>").join("") + "</section>";

    const bills = d.bills;
    if (!sess && !bills.length && !d.pending) {
      h += '<section class="st-sec"><div class="st-empty" style="padding-top:24px"><div class="ill">' + ic("chair", 48) + "</div><h2>Масата е свободна</h2><p>Като седнат гости: „Нова поръчка“ или поръчка от QR.</p>" +
        '<button class="pill pill-line pill-lg" type="button" data-seat' + off() + ">" + ic("users", 22) + "Гостите седнаха</button></div></section>";
    } else if (!bills.length && !d.pending && sess) {
      const min = Math.max(1, Math.round((Date.now() - Date.parse(sess.openedAt)) / 60000));
      h += '<section class="st-sec">' + notice("hourglass", "Гостите са седнали преди " + min + " мин и още нямат поръчка." + (sess.cart ? " В общата количка на телефоните: " + items(sess.cart) + "." : ""), true) + "</section>";
    }
    if (bills.length) {
      h += '<section class="st-sec"><div class="st-h"><h2>Поръчки</h2><span class="muted">' + (bills.length > 1 ? "поотделно · " + bills.length + " сметки" : "една сметка") + "</span></div>" +
        bills.map((b) => '<div class="ocard"><div class="oh"><b>' + esc(b.name) + '</b><span class="price" style="color:var(--ink);font-size:17px">' + fmt(b.sum) + "</span></div>" +
          b.orders.map((o) => '<p class="st-cap ono">№ ' + esc(o.no) + " · " + esc(o.placedAt) + " · " + esc(o.source) + "</p>" + (o.note ? '<div class="onote">' + ic("note", 18) + esc(o.note) + "</div>" : "") + o.lines.map(lineHTML).join("")).join("") + "</div>").join("") +
        '<div class="tot"><span>Общо за масата</span><span class="price">' + fmt(d.total) + "</span></div>" +
        (d.paid > 0.004 ? '<div class="paidrow" style="padding:6px 4px 0">' + ic("check-circle", 22) + "Платено " + fmt(d.paid) + (d.rest > 0.004 ? " · остават " + fmt(d.rest) : " · всичко е платено") + "</div>" : "") +
        "</section>";
    }
    if (sess) h += '<section class="st-sec"><button class="pill pill-line pill-lg pill-block" type="button" data-close-table' + (d.canClose ? off() : ' aria-disabled="true"') + ">" + ic("door-open", 22) + "Затвори масата</button>" +
      (d.canClose ? "" : '<p class="small muted" style="margin:8px 4px 0;text-align:center">' + (d.pending ? "Първо потвърди или откажи поръчката от QR." : "Масата се затваря след като сметката е платена.") + "</p>") + "</section>";
    return h;
  }
  function drawBar(d: TableDetail) {
    if (closedNow && !d.session) { bar.innerHTML = '<a class="pill pill-red grow" href="' + esc(murl.servitor("porachka", String(N))) + '">' + ic("plus", 22) + "Нова поръчка</a>"; return; }
    if (d.pending) {
      bar.innerHTML = '<button class="pill pill-line" type="button" data-reject' + off() + ">Откажи</button>" +
        '<button class="pill pill-red grow" type="button" data-confirm' + off() + ">" + ic("check", 22) + "Потвърди и прати</button>";
      return;
    }
    bar.innerHTML = (d.bills.length && d.rest > 0.004 ? '<button class="pill pill-line" type="button" data-bill>' + ic("receipt", 22) + "Сметка</button>" : "") +
      '<a class="pill pill-red grow" href="' + esc(murl.servitor("porachka", String(N))) + '">' + ic("plus", 22) + "Нова поръчка</a>";
  }

  /* ---------- actions ---------- */
  async function act<T>(btn: HTMLElement | null, fn: () => Promise<T>): Promise<T | null> {
    if (btn) { if (btn.getAttribute("aria-busy") === "true") return null; btn.setAttribute("aria-busy", "true"); }
    try { return await fn(); }
    catch (e) {
      if (isOffline(e)) st.toast("Няма връзка. Опитай, щом се върне.");
      else st.toast(why(e));
      void load(); return null;
    } finally { if (btn) btn.removeAttribute("aria-busy"); }
  }
  const take = (b: HTMLElement, id: string) => act(b, async () => { await floorApi.callTake(id); st.haptic(); st.toast("Маса " + N + ": отивам. Колегите виждат, че масата е поета."); await load(); });
  const doneCall = (b: HTMLElement, id: string) => act(b, async () => {
    await floorApi.callDone(id); await load();
    st.toast("Обслужено", { undo: () => { void act(null, async () => { await floorApi.callUndo(id); await load(); }); } });
  });
  const serve = (b: HTMLElement, key: string) => act(b, async () => {
    D = await floorApi.serve(N!, [key]); render();
    st.toast("Сервирано", { undo: () => { void act(null, async () => { D = await floorApi.unserve(N!, [key]); render(); }); } });
  });
  const seat = (b: HTMLElement) => act(b, async () => { D = await floorApi.seat(N!); render(); st.toast("Маса " + N + ": гостите седнаха"); });

  /* "Потвърди и прати": every steak "за 100 гр." asks its grams first */
  function confirmQR(b: HTMLElement) {
    if (!D || !D.pending) return;
    const steaks = D.pending.lines.filter((l) => l.per100), grams: Record<string, number> = {};
    const send = () => act(b, async () => {
      const r = await floorApi.qrConfirm(N!, grams); D = r; render();
      st.toast("Потвърдено и изпратено в кухнята · № " + r.no);
    });
    const ask = (i: number) => {
      if (i >= steaks.length) { void send(); return; }
      const l = steaks[i];
      gramsSheet(st, { name: l.name, price100: l.price100 || 0, q: l.q, title: "Грамаж" + (steaks.length > 1 ? " · " + (i + 1) + " от " + steaks.length : ""),
        ok: (p) => (i + 1 < steaks.length ? "Напред · " : "Потвърди и прати · ") + p, done: (g) => { grams[l.key] = g; ask(i + 1); } });
    };
    ask(0);
  }
  function rejectQR() {
    if (!D || !D.pending) return;
    let reason = "";
    const s = sheetOf(st)({ title: "Да откажа ли поръчката?",
      html: '<p style="margin:0 0 12px">Гостите ще видят на телефона, че поръчката е отказана. Причина:</p><div class="notechips" role="group" aria-label="Причина">' +
        D.reasons.map((r) => '<button class="chip" type="button" data-r="' + esc(r.key) + '" aria-pressed="false">' + esc(r.label) + "</button>").join("") + "</div>" +
        '<p class="small muted" data-rhint style="margin:10px 0 0">Избери причина.</p>',
      foot: '<button class="pill pill-red pill-lg pill-block" type="button" data-rj disabled>Откажи поръчката</button><button class="pill pill-line pill-lg pill-block" type="button" data-keep>Не, върни се</button>' });
    s.el.addEventListener("click", (e) => {
      const x = (e.target as Element).closest<HTMLButtonElement>("button"); if (!x) return;
      if (x.dataset.r) { reason = x.dataset.r; $$("[data-r]", s.el).forEach((c) => c.setAttribute("aria-pressed", String(c === x))); $<HTMLButtonElement>("[data-rj]", s.el)!.disabled = false; $("[data-rhint]", s.el)!.hidden = true; }
      if (x.hasAttribute("data-keep")) s.close();
      if (x.hasAttribute("data-rj") && reason) {
        s.close();
        void act(null, async () => {
          D = await floorApi.qrReject(N!, reason as "test" | "gaveup" | "manual"); render();
          st.toast("Поръчката е отказана", { undo: () => { void act(null, async () => { D = await floorApi.qrRejectUndo(N!); render(); }); } });
        });
      }
    });
  }

  /* ---------- "Сметка" ---------- */
  let mode: Mode = "one", pay: Pay = "cash";
  interface Row { k: string; l: StaffLine; who: string; paid: boolean }
  function openBill(pre?: { keys: string[]; split: string; pay: Pay }) {
    if (!D) return;
    const multi = () => D!.bills.length > 1;
    if (pre) { pay = pre.pay; mode = pre.split === "dishes" ? "dishes" : pre.split === "guests" && multi() ? "guests" : "one"; }
    else if (multi() && mode === "one") mode = "guests";
    const picked = new Set<string>(pre && pre.split === "dishes" ? pre.keys : []);
    const s: Sheet = sheetOf(st)({ title: "Сметка · Маса " + N, html: "<div data-bb></div>", foot: "<div data-bf></div>", onClose: () => { billRedraw = null; } });
    const bb = $("[data-bb]", s.el)!, bf = $("[data-bf]", s.el)!;
    const rows = (): Row[] => D!.bills.flatMap((b: StaffBill) => b.orders.flatMap((o) => o.lines.filter((l) => !l.out).map((l) => ({ k: l.key, l, who: b.name, paid: l.paid }))));
    const sum = (rs: Row[]) => Math.round(rs.reduce((a, r) => a + r.l.sum, 0) * 100) / 100;
    const nm = (r: Row) => r.l.q + "× " + esc(lineName(r.l));
    const seg = () => '<div class="st-seg" role="group" aria-label="Как се плаща">' + ([["one", "Една сметка"], ["guests", "По гости"], ["dishes", "По ястия"]] as [Mode, string][]).map((m) =>
      '<button type="button" data-m="' + m[0] + '" aria-pressed="' + (mode === m[0]) + '"' + (m[0] === "guests" && !multi() ? " disabled" : "") + ">" + m[1] + "</button>").join("") + "</div>";
    const paySeg = () => '<p class="st-cap" style="margin:16px 0 8px">Плащане</p><div class="st-seg" role="group" aria-label="Плащане"><button type="button" data-p="cash" aria-pressed="' + (pay === "cash") + '">' + ic("money", 22) + 'В брой</button><button type="button" data-p="card" aria-pressed="' + (pay === "card") + '">' + ic("credit-card", 22) + "Карта</button></div>";
    const row = (r: Row) => '<div class="kv"' + (r.paid ? ' style="color:var(--muted)"' : "") + "><span>" + (r.paid ? "<s>" + nm(r) + "</s> · платено" : nm(r)) + '</span><span class="price">' + fmt(r.l.sum) + "</span></div>";
    function draw() {
      if (!D) return;
      const all = rows(), open = all.filter((r) => !r.paid);
      [...picked].forEach((k) => { if (!open.some((r) => r.k === k)) picked.delete(k); });
      if (mode === "guests" && !multi()) mode = "one";
      let body = seg(), foot = "";
      if (mode === "one") {
        body += '<div class="kvs" style="margin-top:12px">' + all.map(row).join("") + '<div class="kv tot"><span>За плащане</span><span class="price">' + fmt(sum(open)) + "</span></div></div>" + paySeg();
        foot = open.length ? '<button class="pill pill-red pill-lg pill-block" type="button" data-pay="one"' + off() + ">" + ic("check", 22) + 'Маркирай платено · <span class="price">' + fmt(sum(open)) + "</span></button>" : "";
      } else if (mode === "guests") {
        body += '<div style="margin-top:12px">' + D.bills.map((b) => {
          const mine = all.filter((r) => r.who === b.name), op = mine.filter((r) => !r.paid);
          return '<div class="splitcard"><div class="hd"><span>' + esc(b.name) + '</span><span class="price">' + fmt(sum(mine)) + "</span></div>" +
            mine.map((r) => '<div class="ln"' + (r.paid ? ' style="color:var(--muted)"' : "") + "><span>" + (r.paid ? "<s>" + nm(r) + "</s>" : nm(r)) + '</span><span class="price" style="font-weight:700">' + fmt(r.l.sum) + "</span></div>").join("") +
            (!op.length ? '<div class="paidrow" style="margin-top:8px">' + ic("check-circle", 22) + "Платено</div>"
              : '<div class="acts"><button class="pill pill-line" type="button" data-pay="bill" data-bill="' + esc(b.name) + '" data-how="cash" aria-label="' + esc(b.name) + ": в брой, " + fmt(sum(op)) + '"' + off() + ">" + ic("money", 20) + "В брой</button>" +
                '<button class="pill pill-line" type="button" data-pay="bill" data-bill="' + esc(b.name) + '" data-how="card" aria-label="' + esc(b.name) + ": карта, " + fmt(sum(op)) + '"' + off() + ">" + ic("credit-card", 20) + "Карта</button></div>") + "</div>";
        }).join("") + "</div>";
      } else {
        const sel = open.filter((r) => picked.has(r.k)), v = sum(sel);
        body += '<p class="small muted" style="margin:12px 0 4px">Отбележи какво плаща този гост.</p>' + all.map((r) =>
          '<label class="chk"' + (r.paid ? ' style="color:var(--muted)"' : "") + '><input type="checkbox" data-k="' + esc(r.k) + '"' + (r.paid ? " disabled checked" : picked.has(r.k) ? " checked" : "") + "><span>" + nm(r) + (r.paid ? " · платено" : "") + (multi() ? ' <small class="muted">' + esc(r.who) + "</small>" : "") + '</span><span class="price">' + fmt(r.l.sum) + "</span></label>").join("") + paySeg();
        foot = '<button class="pill pill-red pill-lg pill-block" type="button" data-pay="dishes"' + (v ? off() : " disabled") + ">" + ic("check", 22) + (v ? 'Маркирай платено · <span class="price">' + fmt(v) + "</span>" : "Избери ястия") + "</button>";
      }
      body += '<p class="small muted" style="margin:14px 0 0">Касовият бон се издава от касата за всяко плащане <span class="missing">[ЛИПСВА: връзка с касовия апарат]</span>.</p>';
      keepFocus(s.el, () => { bb.innerHTML = body; bf.innerHTML = foot; });
    }
    billRedraw = draw;
    draw();
    s.el.addEventListener("change", (e) => { const t = e.target as HTMLInputElement; if (t.dataset.k) { if (t.checked) picked.add(t.dataset.k); else picked.delete(t.dataset.k); draw(); } });
    s.el.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b || b.disabled) return;
      if (b.dataset.m) { mode = b.dataset.m as Mode; draw(); return; }
      if (b.dataset.p) { pay = b.dataset.p as Pay; draw(); return; }
      if (b.dataset.pay) {
        const how: Pay = (b.dataset.how as Pay) || pay;
        const p = b.dataset.pay === "bill" ? { how, bill: b.dataset.bill || ALL } : b.dataset.pay === "dishes" ? { how, keys: [...picked] } : { how };
        void act(b, async () => {
          const r = await floorApi.pay(N!, p);
          picked.clear(); D = r; render();
          st.toast("Платено " + fmt(r.payment.sum) + (how === "card" ? " с карта" : " в брой"));
          if (r.rest < 0.005) s.close();
        });
      }
    });
  }

  /* ---------- "Затвори масата" ---------- */
  function closeTable() {
    if (!D) return;
    const un = D.unserved;
    const s = sheetOf(st)({ title: "Затваряне на Маса " + N,
      html: (un.length ? '<div class="notice warn" style="margin-bottom:12px">' + ic("warning", 22) + "<span><b>" + (un.length === 1 ? "1 ястие още не е сервирано" : un.length + " ястия още не са сервирани") + ":</b> " + un.map((l) => l.q + "× " + esc(l.name)).join(", ") + ". Те изчезват и от екрана на кухнята.</span></div>" : "") +
        '<p style="margin:0">Масата става свободна, а QR сесията се затваря. Следващите гости сканират кода на масата отново и започват нова сесия.</p>',
      foot: '<button class="pill pill-red pill-lg pill-block" type="button" data-yes>' + ic("door-open", 22) + (un.length ? "Затвори въпреки това" : "Затвори масата") + '</button><button class="pill pill-line pill-lg pill-block" type="button" data-no>Остави отворена</button>' });
    s.el.addEventListener("click", (e) => {
      const x = (e.target as Element).closest<HTMLButtonElement>("button"); if (!x) return;
      if (x.hasAttribute("data-no")) s.close();
      if (x.hasAttribute("data-yes")) {
        void act(x, async () => {
          try { D = await floorApi.close(N!, un.length > 0); }
          catch (err) {
            if (err instanceof ApiError && err.code === "unserved") { s.close(); await load(); closeTable(); return; }
            throw err;
          }
          s.close(); closedNow = true; render(); main.focus({ preventScroll: true });
          st.toast("Маса " + N + " е свободна");
        });
      }
    });
  }

  document.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button"); if (!b || b.closest(".st-sheetwrap, .st-find") || b.hasAttribute("data-off")) return;
    if (b.hasAttribute("data-bill")) openBill();
    else if (b.dataset.req !== undefined && D) { const r = D.requests[+b.dataset.req]; if (r) openBill({ keys: r.keys, split: r.split, pay: r.pay }); }
    else if (b.dataset.serve) void serve(b, b.dataset.serve);
    else if (b.dataset.take) void take(b, b.dataset.take);
    else if (b.dataset.done) void doneCall(b, b.dataset.done);
    else if (b.hasAttribute("data-confirm")) confirmQR(b);
    else if (b.hasAttribute("data-reject")) rejectQR();
    else if (b.hasAttribute("data-seat")) void seat(b);
    else if (b.hasAttribute("data-close-table")) { if (b.getAttribute("aria-disabled") === "true") st.toast(D && D.pending ? "Първо потвърди или откажи поръчката от QR." : "Масата се затваря след като сметката е платена."); else closeTable(); }
  });

  await load();
  if (outbox().length && !st.offline) void flushOutbox(st, () => soon());
}
