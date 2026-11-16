/* /admin/orders/: „Поръчки“ (design/pages-admin/orders.html, версия 4, 1:1; решения 15.11 и 16.11.2026, основа на част 3).
   - Поръчките за деня на живо (ordersAdminApi.list): табове по статус (В работа · Приета · Готви се · Готова · На път ·
     Доставена · Отказана, с брой; под 1100 px избор „Статус“), канал (Доставка, Вземане, Маса, Офис, Телефон), търсене по №,
     последните цифри на телефона, адрес или име (сървърът търси, телефонът е маскиран). На широко „В работа“ е дъска с 4
     колони, иначе карти. Без примерни данни: празното състояние е „Още няма поръчки днес.“.
   - Смяна на статус по една стъпка (ordersAdminApi.step) с „Отмени“ (стъпката назад); „Откажи“ с причина (задължителна,
     клиентът я вижда в проследяването), „Отмени“ връща предишния статус.
   - Детайл в лист (ordersAdminApi.get): часът на всеки статус, клиент (телефонът скрит до „Покажи телефона“ ->
     ordersAdminApi.phone, ред в дневника), адрес, бележка, редовете с цена за брой, сумите, плащането.
   - Нова онлайн поръчка (a.ts: звук, известие, мигаща значка; тук A.onNewOrder): лента в жар „Нова поръчка № …“ с „Виж
     поръчката“ и рамка на картата; мигането спира, щом поръчката е видяна (детайл, „Виж“, смяна на статус).
   - „Нова поръчка по телефон“ (главен админ, собственик, управител): отделна форма в лист (src/admin/orders-phone.ts, зарежда
     се при първото отваряне: менюто, цените и търсенето са там).
   - Реално време: order.created / order.status четат списъка наново; на 30 сек. също („преди N мин“, „Закъснява“).
   Адреси: #s=accepted|cooking|ready|on_way|done|cancelled, #ch=delivery|pickup|table|office|phone, #n=1069 (детайлът),
   #phone=1 (формата). Състояния: зареждане, празно, грешка, без връзка; без права рисува A.mount. */
import "sc-icons:phone,chef-hat,moped,storefront,chair,briefcase,check,receipt,warning-circle,qr-code,x,magnifying-glass,info,bell-ringing,clock,eye,check-circle,calendar-check";
import { api } from "../client/api.ts";
import { ordersAdminApi, ApiError, type OrderRow, type OrderDetail } from "../client/api-admin-3.ts";
import type { OrderStatus } from "../client/api-types-3.ts";
import { ZONES, RESTAURANT } from "../lib/consts.ts";
import { A, mount, can, toast, sheet, skel, failHTML, offline as offlineHTML, empty, banner, missing, ordersSeen, sofiaHM, norm, esc, ic, fmt, plural, type Sheet } from "./a.ts";
import { aurl } from "./routes.ts";
import { hmOf } from "./when.ts";

type Row = OrderRow;
type Ch = "delivery" | "pickup" | "table" | "office" | "phone";

const LABEL: Record<string, string> = { accepted: "Приета", cooking: "Готви се", ready: "Готова", on_way: "На път", delivered: "Доставена", picked_up: "Взета", cancelled: "Отказана" };
const FIN = ["delivered", "picked_up"];
const CH: Record<Ch, [string, string]> = { delivery: ["Доставка", "moped"], pickup: ["Вземане", "storefront"], table: ["Маса", "chair"], office: ["Офис", "briefcase"], phone: ["Телефон", "phone"] };
const ZONE: Record<string, number> = {}; ZONES.forEach((z) => { ZONE[z.n] = z.etaMin; });
export const REASONS = ["Клиентът се отказа по телефона.", "Изчерпано ястие и клиентът не иска замяна.", "Адресът е извън зоната.", "Друго"];
const BOSS = ["admin", "owner", "manager"];

const chOf = (r: Pick<Row, "channel" | "mode">): Ch => (r.channel === "qr" || r.channel === "waiter" ? "table" : r.channel === "office" || r.channel === "phone" ? r.channel : r.mode === "pickup" ? "pickup" : "delivery");
const fin = (r: Pick<Row, "status">) => FIN.includes(r.status);
const open = (r: Pick<Row, "status">) => !fin(r) && r.status !== "cancelled";
/** "Взета" at a table is "Сервирана" (the waiter says "Сервирах") */
const label = (r: Pick<Row, "channel" | "mode">, st: string) => (st === "picked_up" && chOf(r) === "table" ? "Сервирана" : LABEL[st] || st);
const nextLabel = (r: Row, st: string) => (st === "on_way" ? "Даден на шофьор" : label(r, st));
function agoMin(m: number): string { return m < 1 ? "току-що" : m < 60 ? "преди " + m + " мин" : "преди " + Math.floor(m / 60) + " ч" + (m % 60 ? " " + (m % 60) + " мин" : ""); }
const kitchenOpen = () => { const t = sofiaHM(), m = t.h * 60 + t.m; return m >= 600 && m < 1350; };

/* ---------- the hash (#s=accepted&ch=table&n=1069) ---------- */
function readHash(): Record<string, string> { const o: Record<string, string> = {}; location.hash.slice(1).split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) { try { o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch { /* broken */ } } }); return o; }
function writeHash(o: Record<string, string>) {
  const h = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
  try { history.replaceState(history.state, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ }
}
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const msgOf = (e: unknown) => (e instanceof ApiError ? e.message : "Нещо се обърка. Опитайте пак.");

const TABS: [string, string, (r: Row) => boolean][] = [
  ["work", "В работа", open], ["accepted", "Приета", (r) => r.status === "accepted"], ["cooking", "Готви се", (r) => r.status === "cooking"],
  ["ready", "Готова", (r) => r.status === "ready"], ["on_way", "На път", (r) => r.status === "on_way"], ["done", "Доставена", fin], ["cancelled", "Отказана", (r) => r.status === "cancelled"],
];
const tabTest = (k: string) => (TABS.find((t) => t[0] === k) || TABS[0])[2];

export async function initOrders(): Promise<void> {
  const role = () => (A.me ? A.me.user.role : "");
  const actions = () => (BOSS.includes(role()) ? '<button class="pill pill-red pill-lg" type="button" data-phone>' + ic("phone", 22) + "Нова поръчка по телефон</button>" : "") +
    (can("site") ? '<a class="pill pill-line pill-lg" href="' + aurl.preview("m=kitchen&p=queue&d=tablet&o=land") + '">' + ic("chef-hat", 22) + "Екранът на кухнята</a>" : "");
  /* the actions need the role: drawn after the session is known (A.mount reads it first) */
  const body = await mount({ section: "orders", title: "Поръчки", docTitle: "Поръчки", wide: true, sub: '<span class="or-live" data-live><span class="pulse" aria-hidden="true"></span><span>На живо · обновява се само</span></span>', actions: '<span data-acts hidden></span>' });
  if (!body) return;
  const acts = document.querySelector<HTMLElement>("[data-acts]");
  if (acts) { const box = acts.parentElement!; box.innerHTML = actions(); if (!box.innerHTML) box.remove(); }
  const root = body;

  let rows: Row[] = [], loaded = false, fail: unknown = null, stale = false, lost = false;
  let hits: Set<string> | null = null, qSeq = 0, qTimer: ReturnType<typeof setTimeout> | undefined;
  const fresh = new Set<string>();
  let bannerNo: string | null = null;
  const h0 = readHash();
  const view = { t: TABS.some((x) => x[0] === h0.s) ? h0.s : "work", ch: (h0.ch && h0.ch in CH ? h0.ch : "") as Ch | "", q: "" };
  const byNo = (no: string) => rows.find((r) => r.no === no);
  const syncHash = (n?: string) => writeHash({ s: view.t !== "work" ? view.t : "", ch: view.ch, n: n || "" });

  /* ---------- the parts of a card ---------- */
  function chTag(r: Row) {
    const k = chOf(r), c = CH[k];
    return '<span class="sa-tag">' + ic(c[1], 16) + c[0] + (k === "table" ? (r.table ? " " + esc(r.table) : "") : r.mode === "delivery" && r.zone ? " · " + esc(r.zone) : "") + "</span>";
  }
  const stTag = (r: Row) => '<span class="stt s-' + (fin(r) ? "done" : r.status) + '">' + (r.status === "cancelled" ? ic("x", 14) : "") + esc(label(r, r.status)) + "</span>";
  const lateTag = () => '<span class="sa-tag late-t">' + ic("warning-circle", 16) + "Закъснява</span>";
  const schedTag = (r: Row) => (r.sched ? '<span class="sa-tag">' + ic("calendar-check", 16) + "За " + esc(r.sched) + (/^\d{2}:\d{2}$/.test(r.at) ? " " + esc(r.at) : "") + "</span>" : "");
  const feeMissing = (r: Pick<Row, "fee" | "mode">) => r.mode === "delivery" && r.fee == null;
  function cardHTML(r: Row) {
    const nx = r.next, lt = r.late, items = r.lines.slice(0, 3);
    return '<article class="oc' + (fresh.has(r.no) ? " fresh" : "") + (lt ? " late" : "") + (open(r) ? "" : " done") + '" data-no="' + esc(r.no) + '" data-edit-id="admin.orders.card">' +
      '<div class="oc-t"><b>№ ' + esc(r.no) + "</b>" + stTag(r) + '<span class="ago">' + esc(r.placedAt) + " · " + agoMin(r.minutesAgo) + "</span></div>" +
      '<div class="oc-tags">' + chTag(r) + (lt ? lateTag() : "") + (r.channel === "qr" ? '<span class="sa-tag">' + ic("qr-code", 16) + "QR</span>" : "") + schedTag(r) + "</div>" +
      '<ul class="oc-items">' + items.map((l) => '<li><span class="q">' + l.q + " ×</span><span>" + esc(l.name) + (l.mods.length ? ' <span class="muted">(' + esc(l.mods.join(", ")) + ")</span>" : "") + "</span></li>").join("") +
        (r.lines.length > 3 ? '<li class="more">и още ' + (r.lines.length - 3) + "</li>" : "") + "</ul>" +
      (r.status === "cancelled" && r.reason ? '<p class="oc-why"><b>Причина:</b> ' + esc(r.reason) + "</p>" : "") +
      '<div class="oc-sum"><span class="price">' + fmt(r.total) + (feeMissing(r) ? " <small>+ такса " + missing("в €") + "</small>" : "") + "</span><small>" + esc(r.payLabel) + (r.disc ? " · отстъпка -" + fmt(r.disc) : "") + "</small></div>" +
      '<div class="oc-f">' + (nx ? '<button class="pill ' + (lt ? "pill-red" : "pill-ink") + ' nx" type="button" data-next aria-label="' + esc(nextLabel(r, nx)) + ": № " + esc(r.no) + '">' + ic(nx === "on_way" ? "moped" : "check", 20) + esc(nextLabel(r, nx)) + "</button>" : "") +
        '<button class="pill pill-line" type="button" data-open aria-label="Детайли: № ' + esc(r.no) + '">' + ic("receipt", 20) + "Детайли</button></div></article>";
  }

  /* ---------- the bar: tabs (select under 1100 px), channels, search ---------- */
  const cnt = (k: string) => rows.filter(tabTest(k)).length;
  const tabsHTML = () => TABS.map((t) => '<button type="button" role="tab" aria-selected="' + (view.t === t[0]) + '" tabindex="' + (view.t === t[0] ? 0 : -1) + '" data-tab="' + t[0] + '" aria-controls="or-list">' + t[1] + '<span class="c">' + (loaded ? cnt(t[0]) : "") + "</span></button>").join("");
  const selHTML = () => '<label class="vh" for="or-st">Статус</label><select class="input" id="or-st">' + TABS.map((t) => '<option value="' + t[0] + '"' + (view.t === t[0] ? " selected" : "") + ">" + t[1] + (loaded ? " (" + cnt(t[0]) + ")" : "") + "</option>").join("") + "</select>";
  const chHTML = () => '<button class="chip" type="button" data-ch="" aria-pressed="' + !view.ch + '">Всички канали</button>' + (Object.keys(CH) as Ch[]).map((k) => {
    const n = rows.filter((r) => chOf(r) === k && tabTest(view.t)(r)).length;
    return '<button class="chip" type="button" data-ch="' + k + '" aria-pressed="' + (view.ch === k) + '">' + ic(CH[k][1], 18) + CH[k][0] + ' <span class="n">' + (loaded ? n : "") + "</span></button>";
  }).join("");

  /* ---------- the list ---------- */
  function match(r: Row) {
    if (view.ch && chOf(r) !== view.ch) return false;
    const q = view.q.trim(); if (!q) return true;
    if (hits && hits.has(r.no)) return true;
    const d = q.replace(/[№\s]/g, "");
    if (/^\d+$/.test(d) && r.no.indexOf(d) > -1) return true;
    return norm(r.name + " " + r.zone + " " + (r.table ? "маса " + r.table : "")).indexOf(norm(q)) > -1;
  }
  function shown(): Row[] {
    const f = tabTest(view.t), newest = view.t === "done" || view.t === "cancelled";
    return rows.filter((r) => f(r) && match(r)).sort((a, b) => (newest ? b.ts - a.ts : a.ts - b.ts));
  }
  const wide = () => root.getBoundingClientRect().width >= 1080;
  function listHTML(): string {
    const l = shown();
    if (!l.length) {
      if (view.q || view.ch) return '<div class="sa-card">' + empty({ icon: "magnifying-glass", title: "Няма поръчка с този избор.", text: view.q ? "Търсете по № (например 1047), последните цифри на телефона, адреса или името." : "", action: '<button class="pill pill-line pill-lg" type="button" data-clear>' + ic("x", 20) + "Покажи всички</button>" }) + "</div>";
      const t = sofiaHM(), mm = t.h * 60 + t.m, on = kitchenOpen();
      const hours = on ? "Новата поръчка идва тук сама, с лента в жар." : mm < 600 ? "Кухнята приема поръчки от 10:00." : "Кухнята приема поръчки до 22:30.";
      if (!rows.length) return '<div class="sa-card">' + empty({ icon: "receipt", title: "Още няма поръчки днес.", text: hours }) + "</div>";
      const tn = (TABS.find((x) => x[0] === view.t) || TABS[0])[1];
      const et = view.t === "work" ? (on ? hours : mm < 600 ? hours : "Кухнята приема поръчки до 22:30. Днешните приключени са в „Доставена“.")
        : view.t === "done" ? "Тук идват доставените, взетите и сервираните поръчки за днес." : view.t === "cancelled" ? "Днес няма отказани поръчки." : "";
      return '<div class="sa-card">' + empty({ icon: view.t === "work" || view.t === "cancelled" ? "check-circle" : "receipt", title: view.t === "work" ? "Няма поръчки в работа." : view.t === "cancelled" ? "Няма отказани поръчки." : "Няма поръчки със статус „" + tn + "“.", text: et }) + "</div>";
    }
    if (view.t === "work" && wide()) {
      return '<div class="or-board">' + ["accepted", "cooking", "ready", "on_way"].map((k) => {
        const c = l.filter((r) => r.status === k);
        return '<section class="or-colm" aria-labelledby="col-' + k + '"><div class="or-colh"><h2 id="col-' + k + '"><span class="dot c-' + k + '"></span>' + LABEL[k] + '</h2><span class="n">' + c.length + "</span></div>" + (c.length ? c.map(cardHTML).join("") : '<p class="or-none">Няма</p>') + "</section>";
      }).join("") + "</div>";
    }
    return '<div class="or-grid">' + l.map(cardHTML).join("") + "</div>";
  }

  /* ---------- the frame of the page ---------- */
  root.innerHTML = '<div data-off></div><div data-new></div>' +
    '<div class="or-bar" data-edit-id="admin.orders.filters"><div class="row1"><div class="sa-tabs" role="tablist" aria-label="Статус" data-tabs></div><div class="or-sel" data-sel></div></div>' +
    '<div class="row2"><div class="or-ch" role="group" aria-label="Канал" data-chs></div>' +
    '<div class="sa-field-s"><label class="vh" for="or-q">Търси поръчка</label>' + ic("magnifying-glass", 20) + '<input class="input" id="or-q" type="search" placeholder="№, телефон или адрес" autocomplete="off"></div></div></div>' +
    '<div id="or-list" role="tabpanel" data-list></div>';
  const offBox = root.querySelector<HTMLElement>("[data-off]")!, newBox = root.querySelector<HTMLElement>("[data-new]")!, list = root.querySelector<HTMLElement>("[data-list]")!;
  const tabs = root.querySelector<HTMLElement>("[data-tabs]")!, sel = root.querySelector<HTMLElement>("[data-sel]")!, chs = root.querySelector<HTMLElement>("[data-chs]")!, bar = root.querySelector<HTMLElement>(".or-bar")!;
  const live = document.querySelector<HTMLElement>("[data-live]");

  function drawLive() {
    if (!live) return; const off = lost || stale;
    live.classList.toggle("lost", off); live.lastElementChild!.textContent = off ? "Свързваме се отново …" : "На живо · обновява се само";
  }
  function drawBanner() {
    const b = bannerNo ? byNo(bannerNo) : null;
    if (!b || !open(b)) { newBox.innerHTML = ""; return; }
    if (newBox.querySelector('[data-bno="' + b.no + '"]')) return;
    newBox.innerHTML = '<div class="or-new" data-bno="' + esc(b.no) + '" data-edit-id="admin.orders.new">' + banner({ tone: "ember", icon: "bell-ringing", title: "Нова поръчка № " + b.no,
      text: esc(CH[chOf(b)][0] + (b.mode === "delivery" && b.zone ? " · " + b.zone : "") + " · " + fmt(b.total) + (feeMissing(b) ? " + такса" : "") + " · " + b.lines.map((l) => l.q + " × " + l.name).join(", ")),
      action: '<button class="pill" type="button" data-seenew>' + ic("receipt", 20) + "Виж поръчката</button>" }) + "</div>";
  }
  function draw() {
    if (!loaded && fail) { offBox.innerHTML = ""; newBox.innerHTML = ""; bar.hidden = true; list.innerHTML = failHTML(fail, isOffline(fail) ? "Връзката прекъсна. Поръчките ще се покажат, щом се свържем отново; кухнята продължава да ги получава." : "Не успяхме да заредим поръчките. Кухнята продължава да ги получава; опитайте пак след малко."); drawLive(); return; }
    bar.hidden = false;
    if (!loaded) { list.innerHTML = skel(6, "Зареждаме поръчките …"); tabs.innerHTML = tabsHTML(); sel.innerHTML = selHTML(); chs.innerHTML = chHTML(); return; }
    offBox.innerHTML = stale ? offlineHTML("Връзката прекъсна. Показваме поръчките отпреди малко; новите ще дойдат, щом се свържем отново.") : "";
    drawBanner(); drawLive();
    const act = document.activeElement as HTMLElement | null, inBar = act && bar.contains(act) && act.id !== "or-q" ? (act.dataset.tab ? '[data-tab="' + act.dataset.tab + '"]' : act.dataset.ch != null ? '[data-ch="' + act.dataset.ch + '"]' : act.id === "or-st" ? "#or-st" : "") : "";
    tabs.innerHTML = tabsHTML(); sel.innerHTML = selHTML(); chs.innerHTML = chHTML();
    const y = A.scroller ? A.scroller.scrollTop : 0;
    list.innerHTML = listHTML();
    if (A.scroller) A.scroller.scrollTop = y;
    if (inBar) { const n = bar.querySelector<HTMLElement>(inBar); if (n) n.focus({ preventScroll: true }); }
  }

  /* ---------- the data ---------- */
  let loading = false, again = false;
  async function load(): Promise<void> {
    if (loading) { again = true; return; }
    loading = true;
    try {
      const r = await ordersAdminApi.list({});
      rows = r.rows; loaded = true; fail = null; stale = false;
      fresh.forEach((no) => { const x = byNo(no); if (!x || !open(x)) fresh.delete(no); });
    } catch (e) {
      if (loaded) stale = true; else fail = e;
    } finally { loading = false; }
    draw();
    if (again) { again = false; load(); }
  }
  let lt: ReturnType<typeof setTimeout> | undefined;
  const loadSoon = () => { clearTimeout(lt); lt = setTimeout(load, 250); };
  /** apply the answer of a change at once (the list is read again in the background) */
  function apply(d: OrderDetail | { no: string; status: OrderStatus }) {
    const i = rows.findIndex((r) => r.no === d.no);
    if (i > -1 && "lines" in d) rows[i] = { ...rows[i], ...d, lines: d.lines.map((l) => ({ id: l.id, name: l.name, q: l.q, mods: l.mods })) };
    else if (i > -1) rows[i] = { ...rows[i], status: d.status };
    draw(); loadSoon();
  }
  /** a fresh order is seen: the ember frame and the banner go, the badge stops blinking */
  function seen(no: string) {
    fresh.delete(no); if (bannerNo === no) { bannerNo = null; newBox.innerHTML = ""; }
    root.querySelector('article.oc[data-no="' + CSS.escape(no) + '"]')?.classList.remove("fresh");
    if (!fresh.size) ordersSeen();
  }

  /* ---------- status: one step, with "Отмени" ---------- */
  async function step(r: Row, to: OrderStatus) {
    const prev = r.status, no = r.no;
    try { apply(await ordersAdminApi.step(no, to)); }
    catch (e) { toast(isOffline(e) ? "Няма връзка: статусът не е сменен. Опитайте пак." : msgOf(e)); loadSoon(); return; }
    seen(no);
    const txt = "№ " + no + ": " + label(r, to);
    toast(txt, { undo: async () => {
      try { apply(await ordersAdminApi.step(no, prev)); toast("Върнато: № " + no + " е „" + label(r, prev) + "“"); }
      catch (e) { toast(msgOf(e)); loadSoon(); }
    } });
  }

  /* ---------- the detail in a sheet ---------- */
  let cur: { no: string; sh: Sheet } | null = null;
  function stepsHTML(d: OrderDetail) {
    const flow = d.steps.filter((s) => s.status !== "cancelled");
    const ci = flow.findIndex((s) => s.status === d.status);
    const list = d.status === "cancelled" ? [...flow.filter((s) => s.at), ...d.steps.filter((s) => s.status === "cancelled")] : flow;
    return '<ol class="od-steps" aria-label="Статуси и часове">' + list.map((s, i) => {
      const isCur = s.status === d.status, done = d.status === "cancelled" ? !isCur : i < ci;
      const at = s.at && (d.status === "cancelled" || i <= ci) ? hmOf(s.at) : "";
      return '<li class="' + (isCur ? "cur" : done ? "done" : "") + '"><span>' + esc(label(d, s.status)) + (isCur ? ' <span class="vh">(сега)</span>' : "") + "</span><time>" + at + "</time></li>";
    }).join("") + "</ol>";
  }
  function detailHTML(d: OrderDetail) {
    const k = chOf(d), eta = ZONE[d.zone];
    const disc = d.disc ? '<div class="kv"><dt>' + (d.discKind === "lunch" ? "Обедно -30% при вземане" : d.discKind === "code" ? "Код " + esc(d.code || "") : d.discKind === "profile" ? "Отстъпка с профил" : "Отстъпка") + "</dt><dd>-" + fmt(d.disc) + "</dd></div>" : "";
    const fee = d.mode === "delivery" ? '<div class="kv"><dt>Доставка</dt><dd>' + (d.fee === 0 ? "Безплатна" : d.fee == null ? missing("такса в €") : fmt(d.fee)) + "</dd></div>" : "";
    const who = k === "table" ? '<span class="muted">' + (d.channel === "qr" ? "поръчка от QR менюто" : "въведена от сервитьора") + "</span>"
      : (d.name ? "<b>" + esc(d.name) + "</b>" : "") + (d.phone ? '<span class="tel" data-tel>' + esc(d.phone) + '</span><button class="pill pill-line" type="button" data-showtel>' + ic("eye", 18) + "Покажи телефона</button>" : "");
    return '<div class="od" data-edit-id="admin.orders.detail"><div class="oc-tags">' + stTag(d) + chTag(d) + (d.late ? lateTag() : "") + schedTag(d) + '<span class="sa-tag">' + ic("clock", 16) + esc(d.placedAt) + " · " + agoMin(d.minutesAgo) + "</span></div>" +
      stepsHTML(d) +
      (d.status === "cancelled" && d.reason ? '<div class="od-box"><span class="lb">Причина за отказа</span><span>' + esc(d.reason) + "</span></div>" : "") +
      '<div class="od-box"><span class="lb">' + (k === "table" ? "Маса" + (d.table ? " " + esc(d.table) : "") : "Клиент") + '</span><div class="od-who">' + who + "</div></div>" +
      (d.mode === "delivery" ? '<div class="od-box"><span class="lb">Адрес</span><span><b>' + esc(d.addr) + '</b></span><span class="muted" style="font-size:15px">' + esc(d.zone) + (eta ? " · около " + eta + " мин" : "") + (/^\d{2}:\d{2}$/.test(d.at) ? " · до " + esc(d.at) : "") + "</span></div>"
        : k !== "table" ? '<div class="od-box"><span class="lb">Вземане</span><span>От ресторанта, ' + esc(RESTAURANT.address) + (/^\d{2}:\d{2}$/.test(d.at) ? " · в " + esc(d.at) : "") + "</span></div>" : "") +
      (d.note ? '<div class="od-box"><span class="lb">Бележка от клиента</span><span>' + esc(d.note) + "</span></div>" : "") +
      '<div><h3 style="margin:0 0 4px; font-size:18px">' + plural(d.lines.reduce((a, l) => a + l.q, 0), "ястие", "ястия") + '</h3><div class="od-lines">' + d.lines.map((l) =>
        '<div class="od-line"><span class="q">' + l.q + " ×</span><span>" + esc(l.name) + (l.mods.length ? "<small>" + esc(l.mods.join(", ")) + "</small>" : "") + (l.unit != null ? "<small>" + fmt(l.unit) + " за брой</small>" : "") + '</span><span class="price">' + (l.sum != null ? fmt(l.sum) : "") + "</span></div>").join("") + "</div></div>" +
      '<dl class="od-tot" style="margin:0"><div class="kv"><dt>Ястия</dt><dd>' + fmt(d.sub) + "</dd></div>" + disc + fee +
        '<div class="kv big"><dt>Общо</dt><dd>' + fmt(d.total) + (feeMissing(d) ? " + такса" : "") + '</dd></div><div class="kv"><dt>Плащане</dt><dd>' + esc(d.payLabel) + "</dd></div></dl></div>";
  }
  async function detail(no: string) {
    if (cur) { cur.sh.close(); cur = null; }
    let d: OrderDetail;
    try { d = await ordersAdminApi.get(no); }
    catch (e) { toast(e instanceof ApiError && e.status === 404 ? "Няма поръчка № " + no + "." : msgOf(e)); syncHash(); return; }
    seen(no); syncHash(no);
    const nx = d.next, canAct = open(d);
    const sh = sheet({ title: "№\u00a0" + d.no, html: detailHTML(d), onClose: () => { if (cur && cur.sh === sh) { cur = null; syncHash(); } },
      foot: (canAct ? '<button class="pill pill-line pill-lg" type="button" data-cancel>' + ic("x", 20) + "Откажи</button>" : '<button class="pill pill-line pill-lg" type="button" data-x>Затвори</button>') +
        (nx ? '<button class="pill pill-red pill-lg" type="button" data-nx>' + ic(nx === "on_way" ? "moped" : "check", 22) + esc(nextLabel(d, nx)) + "</button>" : "") });
    cur = { no, sh };
    const f = sh.foot!;
    f.querySelector<HTMLButtonElement>("[data-x]")?.addEventListener("click", sh.close);
    f.querySelector<HTMLButtonElement>("[data-nx]")?.addEventListener("click", () => { sh.close(); step(d, nx!); });
    f.querySelector<HTMLButtonElement>("[data-cancel]")?.addEventListener("click", () => { sh.close(); setTimeout(() => cancelSheet(d), 200); });
    sh.body.addEventListener("click", async (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("[data-showtel]"); if (!b) return;
      b.disabled = true;
      try {
        const p = await ordersAdminApi.phone(no), tel = p.phone.replace(/[^\d+]/g, "");
        const t = sh.body.querySelector("[data-tel]"); if (t) t.textContent = p.phone;
        const a = document.createElement("a"); a.className = "pill pill-ink"; a.href = "tel:" + tel; a.innerHTML = ic("phone", 18) + "Обади се";
        b.replaceWith(a); a.focus();
      } catch (er) { b.disabled = false; toast(msgOf(er)); }
    });
  }

  /* ---------- "Откажи" with a reason (required, the customer sees it) ---------- */
  function cancelSheet(d: OrderDetail) {
    const sh = sheet({ title: "Да откажем ли №\u00a0" + d.no + "?", focus: "#or-r",
      html: '<div class="od"><p style="margin:0">Клиентът вижда „Отказана“ и причината на страницата за проследяване. Кухнята спира поръчката.</p><div class="field"><label for="or-r">Причина</label><select class="input" id="or-r" aria-describedby="or-r-e"><option value="">Изберете причина</option>' + REASONS.map((r) => "<option>" + esc(r) + "</option>").join("") + '</select><span class="err" id="or-r-e" hidden></span></div>' +
        '<div class="field" data-other hidden><label for="or-r2">Каква е причината</label><input class="input" id="or-r2" autocomplete="off" maxlength="200" aria-describedby="or-r2-e"><span class="err" id="or-r2-e" hidden></span></div></div>',
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Назад</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("x", 22) + "Откажи поръчката</button>" });
    const b = sh.body, s = b.querySelector<HTMLSelectElement>("#or-r")!, oth = b.querySelector<HTMLElement>("[data-other]")!, i2 = b.querySelector<HTMLInputElement>("#or-r2")!;
    const err = (el: HTMLInputElement | HTMLSelectElement, msg: string) => { const e = b.querySelector<HTMLElement>("#" + el.id + "-e")!; e.hidden = !msg; e.textContent = msg; if (msg) { el.setAttribute("aria-invalid", "true"); el.focus(); } else el.removeAttribute("aria-invalid"); };
    s.addEventListener("change", () => { oth.hidden = s.value !== "Друго"; err(s, ""); });
    sh.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = () => { sh.close(); setTimeout(() => detail(d.no), 200); };
    const ok = sh.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    ok.onclick = async () => {
      if (!s.value) { err(s, "Изберете причина: клиентът я вижда."); return; }
      const reason = s.value === "Друго" ? i2.value.trim() : s.value;
      if (!reason) { err(i2, "Напишете причината с няколко думи."); return; }
      const prev = d.status; ok.disabled = true;
      try { apply(await ordersAdminApi.cancel(d.no, reason)); }
      catch (e) {
        ok.disabled = false;
        if (e instanceof ApiError && e.fields && e.fields.reason) { err(s.value === "Друго" ? i2 : s, e.fields.reason); return; }
        toast(msgOf(e)); return;
      }
      sh.close(); seen(d.no);
      toast("№ " + d.no + ": Отказана (" + reason + ")", { undo: async () => {
        try { apply(await ordersAdminApi.step(d.no, prev)); toast("Върнато: № " + d.no + " е „" + label(d, prev) + "“"); } catch (e) { toast(msgOf(e)); loadSoon(); }
      } });
    };
  }

  /* ---------- "Нова поръчка по телефон" (its own chunk: the menu, the prices, the search) ---------- */
  async function phoneOrder() {
    if (!BOSS.includes(role())) return;
    try {
      const m = await import("./orders-phone.ts");
      m.phoneOrderSheet({
        onDone: (d, slot) => {
          rows = [d as Row, ...rows.filter((r) => r.no !== d.no)]; fresh.add(d.no); view.t = "work"; syncHash(); draw(); loadSoon();
          toast("№ " + d.no + " е в кухнята" + (slot ? " за " + slot : ""), { undo: async () => {
            try { apply(await ordersAdminApi.cancel(d.no, "Отменена при въвеждането.")); fresh.delete(d.no); toast("№ " + d.no + " е отменена"); } catch (e) { toast(msgOf(e)); loadSoon(); }
          } });
        },
      });
    } catch { toast("Формата не се зареди. Проверете връзката и опитайте пак."); }
  }

  /* ---------- events ---------- */
  root.addEventListener("click", (e) => { if ((e.target as Element).closest('[data-sa="retry"]')) { e.stopPropagation(); fail = null; stale = false; draw(); load(); } }, true);
  root.addEventListener("click", (e) => {
    const t = e.target as Element; let n: HTMLElement | null;
    if ((n = t.closest<HTMLElement>("[data-tab]"))) { view.t = n.dataset.tab!; syncHash(); draw(); bar.querySelector<HTMLElement>('[data-tab="' + view.t + '"]')?.focus({ preventScroll: true }); return; }
    if ((n = t.closest<HTMLElement>("[data-ch]"))) { view.ch = (n.dataset.ch || "") as Ch | ""; syncHash(); draw(); return; }
    if (t.closest("[data-clear]")) { view.q = ""; view.ch = ""; hits = null; root.querySelector<HTMLInputElement>("#or-q")!.value = ""; syncHash(); draw(); return; }
    if ((n = t.closest<HTMLElement>("[data-next]"))) { const r = byNo(n.closest<HTMLElement>("[data-no]")!.dataset.no!); if (r && r.next) { (n as HTMLButtonElement).disabled = true; step(r, r.next); } return; }
    if ((n = t.closest<HTMLElement>("[data-open]"))) { detail(n.closest<HTMLElement>("[data-no]")!.dataset.no!); return; }
    if (t.closest("[data-seenew]")) { const no = bannerNo; if (no) { seen(no); detail(no); } return; }
  });
  root.addEventListener("keydown", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-tab]"); if (!t || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return;
    const i = TABS.findIndex((x) => x[0] === t.dataset.tab), j = (i + (e.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
    e.preventDefault(); view.t = TABS[j][0]; syncHash(); draw(); bar.querySelector<HTMLElement>('[data-tab="' + view.t + '"]')?.focus();
  });
  root.addEventListener("change", (e) => { const t = e.target as HTMLSelectElement; if (t.id !== "or-st") return; view.t = t.value; syncHash(); draw(); });
  root.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement; if (t.id !== "or-q") return;
    view.q = t.value; hits = null; draw();
    clearTimeout(qTimer);
    const q = view.q.trim(); if (!q) return;
    /* the phone is masked in the list: the server searches the digits, the address and the name */
    const my = ++qSeq;
    qTimer = setTimeout(async () => { try { const r = await ordersAdminApi.list({ q }); if (my !== qSeq) return; hits = new Set(r.rows.map((x) => x.no)); draw(); } catch { /* the local match stays */ } }, 250);
  });
  document.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-phone]")) phoneOrder(); });
  window.addEventListener("hashchange", () => {
    const h = readHash(), t = TABS.some((x) => x[0] === h.s) ? h.s : "work", ch = (h.ch && h.ch in CH ? h.ch : "") as Ch | "";
    if (t !== view.t || ch !== view.ch) { view.t = t; view.ch = ch; draw(); }
    if (h.n && (!cur || cur.no !== h.n)) detail(h.n);
    if (h.phone) phoneOrder();
  });
  let lastW = root.getBoundingClientRect().width;
  new ResizeObserver(() => { const w = root.getBoundingClientRect().width; if ((w >= 1080) !== (lastW >= 1080) && loaded) list.innerHTML = listHTML(); lastW = w; }).observe(root);

  /* live: the list follows the kitchen, the driver and the other admins; a new online order gets the ember banner */
  A.onNewOrder = (d) => { fresh.add(d.no); bannerNo = d.no; loadSoon(); };
  api.on("order.created", loadSoon);
  api.on("order.status", loadSoon);
  api.on("stream.lost", () => { lost = true; drawLive(); });
  api.on("stream.back", () => { lost = false; drawLive(); load(); });
  window.addEventListener("online", () => load());
  setInterval(() => { if (!document.querySelector(".sa-ov .sheetwrap.on") && !document.hidden && (loaded || !fail)) load(); }, 30_000);

  draw();
  await load();
  if (h0.n) detail(h0.n);
  if (h0.phone) phoneOrder();
}
