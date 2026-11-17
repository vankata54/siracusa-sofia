/* Siracusa · "Нова поръчка" of the waiter (/servitor/porachka/#12): port of design/pages-servitor/order.html on the
   real menu (the live menu of the core: "Изчерпано днес") and the core of the hall (floorApi.order). Decision 15.11
   "Персоналът без количка": маса → ястия → „Към кухнята“; no customer cart, no payment, no address.
   - without a table: "За коя маса?" (the hall: "Моите маси" first, then "Други маси · Салон" / "Градина");
   - the search of the site (src/lib/search.ts: Cyrillic and Latin, forgiving spelling, "Съдържат …", "без …", the
     dishes without a composition at the bottom; one clear button), "Последно поръчвани" (today's orders at the tables,
     from the core; hidden while there are none), the categories, rows with a big "+" and a counter, "Изчерпано днес";
   - "Една сметка / Поотделно" with "Гост 1, Гост 2, + Гост" (one order per guest);
   - the review: quantities, a note to the kitchen per dish, a note for the order, the grams of a steak "за 100 гр.",
     "Към кухнята · 27,99 €" and "Добавя се към сметката на Маса 12. Плащането е от „Сметка“ на масата.";
   - the unsent order is a draft on this phone per table ("st-draft-<n>"); no connection: "Запази на телефона" and the
     order goes to the kitchen by itself when the connection is back (bits.ts, "st-outbox");
   - the kitchen takes orders 10:00-22:30 (lib/status.ts, the same rule as the core; the core's own message wins). */
import "sc-icons:magnifying-glass,x,plus,minus,list-checks,paper-plane-right,note,pencil-simple,clock,check,bowl-food,warning,user,caret-left,squares-four,bell-ringing,receipt,qr-code,chef-hat,hourglass,users,chair,fork-knife,drop,chat-circle-dots";
import { mountStaff, type Staff } from "../staff/frame.ts";
import { floorApi, ApiError, type TableDetail, type HallLive, type HallTile } from "../../client/api-floor.ts";
import { api } from "../../client/api.ts";
import { murl } from "../routes.ts";
import { items as MENU, cats, byId, catById, inCat, isOut, setMenu, type Dish } from "../../lib/data.ts";
import { pic } from "../../lib/render.ts";
import { searchDishes, chips as qChips, toggle as qToggle, latin } from "../../lib/search.ts";
import { state } from "../../lib/status.ts";
import { minutes } from "../../lib/time.ts";
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural } from "../../lib/format.ts";
import {
  $, $$, sheetOf, readHash, gramsSheet, why, isOffline, items, lineKey, readDraft, saveDraft, enqueue, flushOutbox, outbox, notice,
  STATE_ICON, STATE_SHORT, CALL_WORD, type Draft, type DraftLine, type StateKey,
} from "./bits.ts";

const r2 = (v: number) => Math.round(v * 100) / 100;
const QUICK = ["Без лук", "Без сирене", "Сосът отделно", "Добре изпечено", "Първо за детето"];
const isBf = (x: Dish) => x.course === "breakfast" || x.cat === "zakuski";

export async function mountOrder(): Promise<void> {
  const H = readHash();
  window.addEventListener("hashchange", () => location.reload());
  if (!H.n) return pickTable(H.q);
  return orderFor(H.n, H.q);
}

/* ---------- step 0: "За коя маса?" ---------- */
async function pickTable(q: string) {
  const st0 = await mountStaff({ module: "waiter", screen: "order", tab: "order", title: "Нова поръчка", sub: "На маса: за коя маса?" });
  if (!st0) return;
  const st: Staff = st0;
  let L: HallLive | null = null;
  const tile = (t: HallTile) => {
    const s = t.state as StateKey, w = s === "call" && t.reason ? CALL_WORD[t.reason] : STATE_SHORT[s];
    /* the name is read from the content ("Маса 3, Салон, QR поръчка"): what is seen is a part of it */
    return '<a class="tile ' + s + '" href="' + esc(murl.servitor("porachka", t.n + (q ? "&q=" + encodeURIComponent(q) : ""))) + '"><span class="no"><span class="vh">Маса </span>' + t.n + '<span class="vh">, ' + (t.zone === "garden" ? "Градина" : "Салон") + ",</span></span> " + '<span class="w">' + ic(STATE_ICON[s] || "users", 18) + esc(w) + "</span></a>";
  };
  function draw() {
    if (!L) return;
    const mine = L.tables.filter((t) => t.mine), rest = L.tables.filter((t) => !t.mine);
    let h = '<div class="pick">' + (q ? '<section class="st-sec">' + notice("magnifying-glass", "Избери маса, после добави „" + esc(q) + "“.") + "</section>" : "");
    if (mine.length) h += '<section class="st-sec"><div class="st-h"><h2>Моите маси</h2></div><div class="tgrid">' + mine.map(tile).join("") + "</div></section>";
    (["salon", "garden"] as const).forEach((z) => {
      const ts = rest.filter((t) => t.zone === z);
      if (ts.length) h += '<section class="st-sec"><div class="st-h"><h2>' + (mine.length ? "Други маси · " : "Маси · ") + (z === "salon" ? "Салон" : "Градина") + '</h2></div><div class="tgrid">' + ts.map(tile).join("") + "</div></section>";
    });
    if (!L.tables.length) h += st.empty({ icon: "chair", title: "Няма маси", text: "Масите се добавят от „Залата“ в админа." });
    st.main.innerHTML = h + "</div>";
  }
  async function load() {
    try {
      L = await floorApi.hall(); st.synced(); draw();
      st.setBadge("calls", L.counters.queue); st.setBadge("ready", L.counters.ready);
    } catch (e) { if (!L) st.fail(e); }
  }
  let t: ReturnType<typeof setTimeout> | undefined;
  st.onLive(["floor.session", "floor.qr", "floor.call", "order.new", "order.line", "order.status", "shift.update"], () => { clearTimeout(t); t = setTimeout(load, 300); });
  st.onReload(() => { void load(); void flushOutbox(st); });
  await load();
  if (outbox().length && !st.offline) void flushOutbox(st);
}

/* ---------- the order for one table ---------- */
async function orderFor(N: number, q0: string) {
  const st0 = await mountStaff({ module: "waiter", screen: "order", tab: null, title: "Нова поръчка", sub: "На маса: Маса " + N, back: { href: murl.servitor("masa", String(N)), label: "Маса" }, bar: "stack", tall: true, offline: "queue" });
  if (!st0) return;
  const st: Staff = st0;
  const main = st.main, bar = st.bar!;
  let T: TableDetail | null = null;
  const saved = readDraft(N);
  const d: Draft = saved || { split: false, guests: ["Гост 1", "Гост 2"], cart: {}, note: "" };
  let cur = d.guests[0], q = q0, cat: string | null = null, serverClosed = "", sent = false;
  const freq = new Map<string, number>();
  let recentOn = false;

  /* the table: its zone and its guests' bills (the draft starts "Поотделно" when the table already has them) */
  const tableP = floorApi.table(N).then((t) => {
    T = t;
    /* the zone would not fit next to the three buttons of the top bar at 360 */
    const guests = t.bills.map((b) => b.name).filter((n) => /^Гост \d+$/.test(n));
    if (!saved && guests.length && !count()) { d.split = true; d.guests = guests.sort((a, b) => +a.slice(5) - +b.slice(5)); cur = d.guests[0]; }
  }).catch((e) => {
    if (e instanceof ApiError && e.status === 404) { sent = true; bar.innerHTML = ""; st.app.classList.remove("withbar"); main.innerHTML = st.empty({ icon: "chair", title: "Няма Маса " + N, text: e.message || "Провери номера на масата.", action: '<a class="pill pill-red pill-lg" href="' + esc(murl.servitor("porachka")) + '">Избери маса</a>' }); }
    else if (e instanceof ApiError && e.status === 401) st.fail(e);
  });

  /* ---------- the menu: the built one at once, the live one (sold out today) after it ---------- */
  const loadMenu = () => api.menu().then((m) => { setMenu(m); if (!sent) { draw(); drawBar(); } }).catch(() => { /* the built menu stays */ });
  st.onLive("menu.soldout", () => { void loadMenu(); });

  /* ---------- the cart of this order (a draft, not a customer cart) ---------- */
  const bill = () => (d.split ? cur : "all");
  const lines = (): (DraftLine & { k: string })[] => Object.keys(d.cart).filter((k) => d.cart[k] && d.cart[k].q > 0 && byId[d.cart[k].id]).map((k) => ({ ...d.cart[k], k }));
  const count = () => lines().reduce((a, l) => a + l.q, 0);
  const unit = (l: { id: string; g: number }) => { const x = byId[l.id]; return !x ? 0 : x.per100 ? r2((x.p * (l.g || 0)) / 100) : x.p; };
  const lineSum = (l: DraftLine) => r2(unit(l) * l.q);
  const sum = () => r2(lines().reduce((a, l) => a + lineSum(l), 0));
  const qty = (id: string) => lines().filter((l) => l.bill === bill() && l.id === id).reduce((a, l) => a + l.q, 0);
  const lineName = (l: DraftLine) => { const x = byId[l.id]; return (x ? x.n : l.id) + (x && x.per100 && l.g ? " · " + l.g + " гр." : ""); };
  const persist = () => saveDraft(N, d);
  const blocked = (x: Dish) => isOut(x) || (isBf(x) && !state().breakfast);
  const kitchenOpen = () => !serverClosed && state().kitchen;
  const closedText = () => serverClosed || (minutes() < 600 ? "Кухнята отваря в 10:00, затова изпращането е спряно." : "Кухнята приема поръчки до 22:30, затова изпращането е спряно. За нещо по изключение: управителят.");

  function add(id: string, n: number, g?: number) {
    const x = byId[id]; if (!x) return;
    if (n > 0 && blocked(x)) return;
    if (x.per100 && n > 0 && !g) { gramsSheet(st, { name: x.n, price100: x.p, ok: (p) => "Добави · " + p, done: (gr) => add(id, 1, gr) }); return; }
    let k = lineKey(bill(), id, g);
    if (n < 0 && !d.cart[k]) { const any = lines().filter((l) => l.bill === bill() && l.id === id).pop(); if (!any) return; k = any.k; }
    const l = d.cart[k] || (d.cart[k] = { id, q: 0, g: g || 0, note: "", bill: bill() });
    l.q = Math.max(0, Math.min(99, l.q + n)); if (!l.q) delete d.cart[k];
    if (n > 0) st.haptic(8);
    persist(); redraw(); drawBar();
  }

  /* ---------- the search (the one of the site) ---------- */
  const DL = MENU.map((x) => {
    let k = (catById[x.cat] && catById[x.cat].n) || "";
    if (/бургер/i.test(x.n)) k += " burger cheeseburger"; if (/стек/i.test(x.n)) k += " steak"; if (/Ангъс/i.test(x.n)) k += " black angus"; if (/Рибай/i.test(x.n)) k += " ribeye";
    return { id: x.id, n: x.n, comp: x.comp, al: x.al, t: x.t, kw: k };
  });
  const back = (l: { id: string }[]) => l.map((z) => byId[z.id]).filter(Boolean);
  function find(qq: string) {
    const r = searchDishes(DL, qq), first = (r.query.inc[0] && r.query.inc[0].v[0]) || "";
    const starts = (x: Dish) => (first && (latin(x.n).replace(/[^a-z0-9]+/g, " ").trim().split(" ")[0] || "").indexOf(first) === 0 ? 0 : 1);
    const f = (x: Dish) => -(freq.get(x.id) || 0);
    const name = back(r.name).map((x, i) => [x, i] as const).sort((a, b) => starts(a[0]) - starts(b[0]) || f(a[0]) - f(b[0]) || a[1] - b[1]).map((z) => z[0]);
    return { query: r.query, name, comp: back(r.comp), band: r.band, rest: back(r.rest), unknown: back(r.unknown) };
  }

  /* ---------- drawing ---------- */
  function row(x: Dish): string {
    const n = qty(x.id), out = isOut(x), bf = !out && isBf(x) && !state().breakfast;
    return '<div class="qrow' + (out || bf ? " out" : "") + '">' + pic(x) + '<div><div class="nm">' + esc(x.n) + '</div><div class="mt"><span class="price">' + fmt(x.p) + '</span><span class="g">' + (x.per100 ? "за 100 гр." : esc(x.g || "")) + "</span>" +
      (out ? '<span class="out-b">' + ic("clock", 16) + "Изчерпано днес</span>" : bf ? '<span class="out-b">' + ic("clock", 16) + "Закуските са до 11:30</span>" : "") + "</div></div>" +
      (out || bf ? "" : n ? '<div class="qcount"><button type="button" data-dec="' + x.id + '" aria-label="Едно по-малко ' + esc(x.n) + '">' + ic("minus", 22) + '</button><output aria-live="polite">' + n + '</output><button type="button" data-inc="' + x.id + '" aria-label="Още едно ' + esc(x.n) + '">' + ic("plus", 22) + "</button></div>"
        : '<button class="bigplus" type="button" data-inc="' + x.id + '" aria-label="Добави ' + esc(x.n) + '">' + ic("plus", 26) + "</button>") + "</div>";
  }
  function recentHTML(): string {
    const ids = [...freq.entries()].filter(([id]) => byId[id] && !byId[id].lunch).sort((a, b) => b[1] - a[1]).slice(0, 6).map((e) => e[0]);
    if (!ids.length) return "";
    return '<section class="st-sec"><div class="st-h"><h2>Последно поръчвани</h2></div><div class="recent">' + ids.map((id) => {
      const x = byId[id], n = qty(id), off = blocked(x);
      return '<button class="rbtn" type="button" data-inc="' + id + '"' + (off ? ' aria-disabled="true"' : "") + ' aria-label="Добави ' + esc(x.n) + (off ? ", " + (isOut(x) ? "изчерпано днес" : "закуските са до 11:30") : "") + '">' + (n ? '<span class="qn">' + n + "</span>" : "") + '<span class="nm">' + esc(x.n) + '</span><span class="price">' + (off && isOut(x) ? "Изчерпано днес" : fmt(x.p)) + '</span><span class="pl">' + ic("plus", 20) + "</span></button>";
    }).join("") + "</div></section>";
  }
  function draw() {
    if (sent) return;
    $$("[data-split]", main).forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.split === "1") === d.split)));
    const gEl = $("[data-guests]", main)!;
    gEl.innerHTML = d.split ? d.guests.map((g) => { const c = lines().filter((l) => l.bill === g).reduce((a, l) => a + l.q, 0); return '<button class="chip" type="button" data-guest="' + esc(g) + '" aria-pressed="' + (g === cur) + '">' + ic("user", 18) + esc(g) + (c ? ' <span class="n">' + c + "</span>" : "") + "</button>"; }).join("") +
      (d.guests.length < 20 ? '<button class="chip" type="button" data-addguest>' + ic("plus", 18) + "Гост</button>" : "") : "";
    gEl.hidden = !d.split;
    let h = "";
    if (!kitchenOpen()) h += '<section class="st-sec">' + notice("clock", esc(closedText()), true) + "</section>";
    if (q) {
      const R = find(q), any = R.name.length + R.comp.length + R.rest.length + R.unknown.length, ch = qChips(q);
      h += '<section class="st-sec" style="padding-top:8px">' + (ch.length ? '<div class="schips" role="group" aria-label="Съставки и алергени">' + ch.map((c) => '<button class="chip' + (c.without ? " without" : "") + '" type="button" data-tog="' + esc(c.word) + '" aria-pressed="' + c.without + '">' + (c.without ? ic("minus", 18) + "без " + esc(c.label) : esc(c.label) + " " + ic("x", 16)) + "</button>").join("") + "</div>" : "") +
        (any ? '<p class="res-h" role="status">' + plural(any, "резултат", "резултата") + "</p>" : "") +
        (R.query.inc.length ? R.name : R.rest).map(row).join("") +
        (R.comp.length ? '<div class="fband">' + ic("bowl-food", 20) + "<span>" + esc(R.band) + "</span></div>" + R.comp.map(row).join("") : "") +
        (R.unknown.length ? '<div class="fband unk">' + ic("warning", 20) + "<span>Нямаме пълен състав, попитайте ни<small>Питай кухнята, преди да кажеш на госта.</small></span></div>" + R.unknown.map(row).join("") : "") +
        (any ? "" : '<div class="st-empty" style="padding-top:24px"><div class="ill" style="color:var(--muted)">' + ic("magnifying-glass", 44) + "</div><h2 role=\"status\">Няма „" + esc(q) + "“</h2><p>Може на кирилица или латиница, например „kebap“ или „цезар“, и „без лук“. Или по категория.</p><button class=\"pill pill-line\" type=\"button\" data-clr>Покажи категориите</button></div>") + "</section>";
    } else if (cat && catById[cat]) {
      const list = inCat(cat);
      h += '<section class="st-sec" style="padding-top:12px"><button class="backchip" type="button" data-cat="">' + ic("caret-left", 20) + 'Всички категории</button><div class="st-h" style="margin-top:12px"><h2>' + esc(catById[cat].n) + '</h2><span class="muted">' + list.length + "</span></div>" + list.map(row).join("") + "</section>";
    } else {
      h += (recentOn ? recentHTML() : "") + '<section class="st-sec"><div class="st-h"><h2>Категории</h2></div><div class="cattiles">' + cats.map((c) => {
        const list = inCat(c.id); if (!list.length) return "";
        return '<button class="cattile" type="button" data-cat="' + c.id + '">' + pic(list[0]) + "<span>" + esc(c.n) + '<span class="n">' + list.length + "</span></span></button>";
      }).join("") + "</div></section>";
    }
    $("[data-body]", main)!.innerHTML = h;
  }
  /* draw again and keep the focus on the same control (the "+" that became a counter keeps it; a "−" that emptied the
     counter hands it to the "+" of the same dish) */
  function redraw() {
    const a = document.activeElement as HTMLElement | null, inMain = !!a && main.contains(a);
    const id = inMain ? a!.dataset.inc || a!.dataset.dec || "" : "", wasRecent = inMain && a!.classList.contains("rbtn"), dec = inMain && !!a!.dataset.dec;
    draw();
    if (!id) return;
    const f = (wasRecent ? $<HTMLElement>('.rbtn[data-inc="' + id + '"]', main) : null) || (dec ? $<HTMLElement>('[data-dec="' + id + '"]', main) : null) || $<HTMLElement>('.qrow [data-inc="' + id + '"]', main) || $<HTMLElement>('[data-inc="' + id + '"]', main);
    if (f) f.focus({ preventScroll: true });
  }
  const sendWord = () => (st.offline ? "Запази на телефона" : "Към кухнята");
  function drawBar() {
    if (sent) return;
    const n = count(), ok = n > 0 && kitchenOpen();
    bar.innerHTML = '<button class="sumbtn" type="button" data-review' + (n ? "" : " disabled") + ">" + ic("list-checks", 22) + (n ? items(n) + " · Преглед" : "Няма добавени ястия") + "</button>" +
      '<button class="pill pill-red" type="button" data-send' + (ok ? "" : " disabled") + ">" + ic("paper-plane-right", 22) + sendWord() + (n ? ' · <span class="price">' + fmt(sum()) + "</span>" : "") + "</button>";
  }

  /* ---------- the note to the kitchen for one dish ---------- */
  function noteSheet(k: string, after?: () => void) {
    const l = d.cart[k]; if (!l) return;
    const s = sheetOf(st)({ title: "Бележка към кухнята",
      html: '<p style="margin:0 0 12px;font-weight:700">' + l.q + "× " + esc(lineName(l)) + '</p><div class="notechips">' + QUICK.map((t) => '<button class="chip" type="button" data-nt="' + t + '">' + t + "</button>").join("") + "</div>" +
        '<div class="field" style="margin-top:14px"><label for="nt">Друго</label><textarea class="input" id="nt" maxlength="140" rows="2" placeholder="Например: алергия към ядки">' + esc(l.note) + '</textarea><span class="help">Вижда се на екрана на кухнята под ястието.</span></div>',
      foot: '<button class="pill pill-red pill-lg pill-block" type="button" data-save>Запази бележката</button>' });
    const ta = $<HTMLTextAreaElement>("#nt", s.el)!;
    s.el.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b) return;
      if (b.dataset.nt) { const t = b.dataset.nt; ta.value = ta.value.trim() ? (ta.value.toLowerCase().indexOf(t.toLowerCase()) > -1 ? ta.value : ta.value.trim() + ", " + t.toLowerCase()) : t; ta.focus(); }
      if (b.hasAttribute("data-save")) { l.note = ta.value.replace(/\s+/g, " ").trim().slice(0, 140); persist(); s.close(); if (after) after(); }
    });
  }

  /* ---------- the review (draws itself again in place, the focus stays on the same control) ---------- */
  function review() {
    let offNet = () => { /* set below */ };
    const s = sheetOf(st)({ title: "Маса " + N + " · преглед", html: "<div data-rv></div>", foot: "<div data-rf></div>", onClose: () => offNet() });
    const rv = $("[data-rv]", s.el)!, rf = $("[data-rf]", s.el)!;
    function paint(focusSel?: string) {
      if (!count()) { s.close(); return; }
      const by: Record<string, (DraftLine & { k: string })[]> = {};
      lines().forEach((l) => { (by[l.bill] = by[l.bill] || []).push(l); });
      const order = Object.keys(by).sort((a, b) => (a === "all" ? -1 : b === "all" ? 1 : +a.slice(5) - +b.slice(5)));
      rv.innerHTML = order.map((b) => (d.split ? '<p class="st-cap" style="margin:12px 0 0">' + esc(b === "all" ? "Обща сметка" : b) + "</p>" : "") + by[b].map((l) => {
        const nm = esc(lineName(l));
        return '<div class="sum-line"><div class="counter"><button type="button" data-rdec="' + esc(l.k) + '" aria-label="Едно по-малко ' + nm + '">' + ic("minus", 20) + "</button><output>" + l.q + '</output><button type="button" data-rinc="' + esc(l.k) + '" aria-label="Още едно ' + nm + '">' + ic("plus", 20) + "</button></div>" +
          '<div><div class="nm">' + nm + "</div>" + (l.note ? '<div class="nb">' + ic("note", 16) + esc(l.note) + "</div>" : "") +
          '<button class="notebtn" type="button" data-note="' + esc(l.k) + '" aria-label="Бележка към ' + nm + '">' + ic("pencil-simple", 18) + (l.note ? "Промени бележката" : "Бележка") + '</button></div><span class="price">' + fmt(lineSum(l)) + "</span></div>";
      }).join("")).join("") +
        '<div class="field" style="margin-top:14px"><label for="gn">Бележка за цялата поръчка</label><input class="input" id="gn" maxlength="300" value="' + esc(d.note) + '" placeholder="Например: двете пици заедно"></div>';
      const ok = kitchenOpen();
      rf.innerHTML = '<button class="pill pill-red pill-lg pill-block" type="button" data-send' + (ok ? "" : " disabled") + ">" + ic("paper-plane-right", 22) + sendWord() + ' · <span class="price">' + fmt(sum()) + "</span></button>" +
        '<p class="small muted rfl">Добавя се към сметката на Маса ' + N + ". Плащането е от „Сметка“ на масата.</p>" +
        (st.offline ? '<p class="small muted rfl">Няма връзка: поръчката тръгва към кухнята сама, щом се върне.</p>' : "") +
        (ok ? "" : '<p class="small muted rfl">' + esc(closedText()) + "</p>");
      $<HTMLInputElement>("#gn", rv)!.addEventListener("input", (e) => { d.note = (e.target as HTMLInputElement).value; persist(); });
      if (focusSel) { const f = $<HTMLElement>(focusSel, s.el); if (f) f.focus(); }
    }
    paint();
    offNet = st.onNet(() => paint());
    s.el.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b) return;
      const k = b.dataset.rinc || b.dataset.rdec;
      if (k && d.cart[k]) {
        d.cart[k].q = Math.max(0, Math.min(99, d.cart[k].q + (b.dataset.rinc ? 1 : -1)));
        const gone = !d.cart[k].q; if (gone) delete d.cart[k];
        persist(); draw(); drawBar(); paint(gone ? "[data-close]" : "[data-" + (b.dataset.rinc ? "rinc" : "rdec") + '="' + CSS.escape(k) + '"]'); return;
      }
      if (b.dataset.note) { const nk = b.dataset.note; noteSheet(nk, () => paint('[data-note="' + CSS.escape(nk) + '"]')); return; }
      if (b.hasAttribute("data-send") && !b.disabled) { s.close(); void send(); }
    });
  }

  /* ---------- "Към кухнята" / "Запази на телефона" ---------- */
  let sending = false;
  async function send() {
    if (sending || !count() || !kitchenOpen()) return;
    const ls = lines(), n = count(), total = sum(), guests = d.split ? d.guests.slice() : [];
    /* one id per order: a resend (lost answer, the offline outbox) never makes a second order in the kitchen */
    const rid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
    const input = { rid, lines: ls.map((l) => ({ id: l.id, q: l.q, ...(l.note ? { note: l.note } : {}), ...(l.g ? { grams: l.g } : {}), ...(d.split ? { guest: l.bill } : {}) })), ...(d.note.trim() ? { note: d.note.trim() } : {}) };
    const labels = ls.map((l) => l.q + "× " + lineName(l) + (d.split ? " · " + l.bill : ""));
    const keep = () => { const qd = enqueue({ table: N, n, sum: total, input, guests, labels }); clear(); done(null, n, total, qd.id); };
    if (st.offline) { keep(); return; }
    sending = true; $$<HTMLButtonElement>("[data-send]").forEach((b) => b.setAttribute("aria-busy", "true"));
    try {
      const r = await floorApi.order(N, input);
      clear(); done(r.orders, n, total);
    } catch (e) {
      if (isOffline(e)) { keep(); return; }
      if (e instanceof ApiError && e.code === "closed") { serverClosed = e.message; draw(); }
      if (e instanceof ApiError && (e.code === "sold_out" || e.code === "removed")) void loadMenu();
      st.toast(why(e), { ms: 6000 });
    } finally { sending = false; $$<HTMLButtonElement>("[data-send]").forEach((b) => b.removeAttribute("aria-busy")); drawBar(); }
  }
  function clear() { d.cart = {}; d.note = ""; persist(); }
  function done(nos: string[] | null, n: number, total: number, queuedId?: string) {
    sent = true; bar.innerHTML = ""; st.app.classList.remove("withbar", "tall"); window.scrollTo(0, 0);
    const paint = (no: string[] | null) => {
      main.innerHTML = '<div class="sent' + (no ? "" : " kept") + '"><div class="ill">' + ic(no ? "check" : "clock", 56) + '</div><h1 class="h2" tabindex="-1">' + (no ? "Поръчката е в кухнята" : "Запазено на телефона") + "</h1>" +
        '<p class="lead">' + (no ? "Маса " + N + " · " + items(n) + ' · <span class="price" style="color:var(--ink)">' + fmt(total) + "</span>" : "Няма връзка. Поръчката тръгва сама към кухнята, щом връзката се върне.") + "</p>" +
        '<p class="muted" style="margin:0">' + (no ? no.map((x) => "№ " + esc(x)).join(", ") + (no.length > 1 ? " · отделни сметки" : "") + " · в сметката на масата" : "Номерът на поръчката идва, щом има връзка.") + "</p>" +
        '<div class="btns"><a class="pill pill-red pill-lg pill-block" href="' + esc(murl.servitor("masa", String(N))) + '">Към Маса ' + N + '</a><a class="pill pill-line pill-lg pill-block" href="' + esc(murl.servitor("porachka")) + '">' + ic("plus", 22) + "Нова поръчка за друга маса</a></div></div>";
      const h = $<HTMLElement>("h1", main); if (h) h.focus({ preventScroll: true });
    };
    paint(nos);
    waiting = queuedId ? { id: queuedId, paint } : null;
  }
  /* the order kept on the phone reached the kitchen while this screen shows "Запазено на телефона" */
  let waiting: { id: string; paint: (no: string[]) => void } | null = null;
  const onSent = (qd: { id: string }, no: string[]) => { if (waiting && qd.id === waiting.id && main.querySelector(".sent.kept")) waiting.paint(no); };

  /* ---------- the page ---------- */
  main.innerHTML = '<div class="osticky"><div class="search"><label class="vh" for="q">Търси ястие</label>' + ic("magnifying-glass", 22) +
    '<input class="input" id="q" type="search" autocomplete="off" enterkeyhint="search" placeholder="Търси: kebap, пица, без лук…" spellcheck="false"><button class="clr" type="button" data-clr aria-label="Изчисти търсенето" hidden>' + ic("x", 22) + "</button></div>" +
    '<div class="billrow"><div class="st-seg" role="group" aria-label="Сметка"><button type="button" data-split="0">Една сметка</button><button type="button" data-split="1">Поотделно</button></div></div><div class="guests" data-guests></div></div><div data-body></div>';
  const inp = $<HTMLInputElement>("#q", main)!, clr = $<HTMLButtonElement>(".clr", main)!;
  const setQ = (v: string) => { q = v; inp.value = v; clr.hidden = !v; };
  main.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b || sent) return;
    if (b.dataset.inc) { if (b.getAttribute("aria-disabled") === "true") { st.toast(isOut(byId[b.dataset.inc]) ? "Изчерпано днес" : "Закуските са до 11:30"); return; } add(b.dataset.inc, 1); return; }
    if (b.dataset.dec) { add(b.dataset.dec, -1); return; }
    if (b.dataset.cat !== undefined) { cat = b.dataset.cat || null; draw(); window.scrollTo(0, 0); const f = $<HTMLElement>(cat ? ".backchip" : ".cattile", main); if (f) f.focus({ preventScroll: true }); return; }
    if (b.hasAttribute("data-clr")) { setQ(""); draw(); inp.focus(); return; }
    if (b.dataset.tog) { setQ(qToggle(q, b.dataset.tog)); draw(); return; }
    if (b.dataset.split) {
      const sp = b.dataset.split === "1";
      if (!sp && d.split) {
        /* back to one bill: everything goes into "all" */
        const ls = lines(); d.cart = {};
        ls.forEach((l) => { const k2 = lineKey("all", l.id, l.g), t = d.cart[k2]; if (t) { t.q += l.q; if (!t.note && l.note) t.note = l.note; } else d.cart[k2] = { id: l.id, q: l.q, g: l.g, note: l.note, bill: "all" }; });
        if (ls.length) st.toast("Сметките са обединени в една");
      }
      if (sp && !d.split) { const ls = lines(); d.cart = {}; ls.forEach((l) => { d.cart[lineKey(d.guests[0], l.id, l.g)] = { id: l.id, q: l.q, g: l.g, note: l.note, bill: d.guests[0] }; }); cur = d.guests[0]; }
      d.split = sp; persist(); draw(); drawBar(); return;
    }
    if (b.dataset.guest) { cur = b.dataset.guest; draw(); return; }
    if (b.hasAttribute("data-addguest")) { const g = "Гост " + (Math.max(0, ...d.guests.map((x) => +x.slice(5) || 0)) + 1); d.guests.push(g); cur = g; persist(); draw(); const f = $<HTMLElement>('[data-guest="' + g + '"]', main); if (f) { f.focus({ preventScroll: true }); f.scrollIntoView({ inline: "nearest", block: "nearest" }); } return; }
  });
  bar.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b || b.disabled) return;
    if (b.hasAttribute("data-review")) review();
    if (b.hasAttribute("data-send")) void send();
  });
  inp.addEventListener("input", () => { q = inp.value.trim(); clr.hidden = !q; draw(); });
  st.onNet(() => { drawBar(); if (!sent) draw(); });
  st.onReload(() => { void flushOutbox(st, onSent); });
  /* the hour: 22:30 stops the sending (and 10:00 starts it) without a reload */
  let was = kitchenOpen();
  setInterval(() => { const now = kitchenOpen(); if (now !== was) { was = now; draw(); drawBar(); } }, 15_000);

  if (q) setQ(q);
  draw(); drawBar(); st.synced();
  if (saved && count()) setTimeout(() => st.toast("Недоизпратената поръчка е запазена: " + items(count())), 300);
  await Promise.all([tableP, loadMenu()]);
  if (!sent) { draw(); drawBar(); }
  if (outbox().length && !st.offline) void flushOutbox(st, onSent);
  void recent();

  /* "Последно поръчвани": the dishes of today's orders at the tables (the core; kept for 2 minutes in this tab) */
  async function recent() {
    let c: Record<string, number> | null = null;
    try { const x = JSON.parse(sessionStorage.getItem("st-recent") || "null"); if (x && Date.now() - x.at < 120_000) c = x.c; } catch { /* none */ }
    if (!c) {
      try {
        const h = await floorApi.hall(), out: Record<string, number> = {};
        const ds = await Promise.all(h.tables.filter((t) => t.session).map((t) => (T && t.id === T.table.id ? Promise.resolve(T) : floorApi.table(t.id).catch(() => null))));
        ds.forEach((dd) => { if (dd) dd.bills.forEach((b) => b.orders.forEach((o) => o.lines.forEach((l) => { out[l.id] = (out[l.id] || 0) + l.q; }))); });
        c = out;
        try { sessionStorage.setItem("st-recent", JSON.stringify({ at: Date.now(), c })); } catch { /* private mode */ }
      } catch { return; }
    }
    Object.keys(c).forEach((k) => freq.set(k, c![k]));
    recentOn = freq.size > 0;
    if (recentOn && !sent && !q && !cat) redraw();
  }
}
