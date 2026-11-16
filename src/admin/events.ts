/* /admin/events/: "Събития" (design/pages-admin/events.html, approved, 1:1; decision 16.11.2026, part 3).
   - Tabs Предстоящи · Минали (#t=past), a filter by category (#c=<категория>), "Страницата в сайта".
   - A card: the date tile, "В сайта" / "Чернова" / "Минало", the category, the name, "сб, 28 ноември · 19:00 · След 12 дни",
     price / seats / program and menu ([ЛИПСВА], where nothing is written), "Промени", "Виж в сайта" or "Публикувай",
     "Изтрий" (a confirmation and "Отмени"). The monthly Greek night (last Saturday) is part of the site: it is changed,
     never deleted or hidden (the core refuses it too); its date stays "the last Saturday".
   - "Ново събитие" / "Промени" (#e=<id> opens it): name, category, date (today .. a year ahead), time, description, program,
     menu, price (Цена / Вход свободен / Още не е ясно), seats, a photo [ЛИПСВА], and the live preview "Така изглежда в
     сайта"; "Запази чернова" and "Публикувай" (a published one: "Скрий от сайта" and "Запази"). The core's 422 goes to the field.
   - Every change of a published event rebuilds the site (sales-site.ts); the demo says that the site is not rebuilt.
   States: loading, error, no connection, empty (per tab), conflict (409: loaded again), no rights (A.mount). */
import "sc-icons:plus,eye,check,pencil-simple,paper-plane-right,trash,warning-circle,info,image,clock,arrow-right,calendar-blank,music-notes,globe,confetti,cake,baby,heart,briefcase,star,balloon,users-three,images,arrow-clockwise,warning,check-circle,calendar-dots";
import { eventsAdminApi, ApiError, type EventView, type EventInput, type EventRow } from "../client/api-admin-3.ts";
import { A, mount, toast, sheet, confirm, skel, failHTML, empty, missing, sofiaYmd, fmtYmd, esc, ic, fmt, plural } from "./a.ts";
import { aurl } from "./routes.ts";
import { loadSite, siteLine, rebuildNote, afterWrite, bindRebuild } from "./sales-site.ts";

const CATI: Record<string, string> = { "Жива музика": "music-notes", "Тематични вечери": "globe", "Празници": "confetti", "Рождени дни": "cake", "Кръщенета": "baby", "Юбилеи": "heart", "Фирмени партита": "briefcase", "Абитуриентски": "star", "Детски": "balloon", "Частни партита": "users-three" };
const DS = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"], MON = ["яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"];
/* the official holidays with a fixed date (Easter moves: [ЛИПСВА] until the owner says) */
const HOL: Record<string, string> = { "01-01": "Нова година", "03-03": "Освобождението", "05-01": "Денят на труда", "05-06": "Гергьовден", "05-24": "24 май", "09-06": "Съединението", "09-22": "Независимостта", "12-24": "Бъдни вечер", "12-25": "Коледа", "12-26": "Коледа" };
const RECUR_NAME = 24, RECUR_TEXT = 90; /* core/events-admin.ts: the monthly evening is in the shared runtime of the site */

const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const failText = (e: unknown) => (isOffline(e) ? "Няма връзка. Промяната не е записана; опитайте пак, щом връзката се върне." : e instanceof ApiError ? e.message : "Не успяхме. Опитайте пак.");
const parts = (s: string) => { const p = s.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2])); };
const addDays = (s: string, n: number) => { const d = parts(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dd = (a: string, b: string) => Math.round((parts(b).getTime() - parts(a).getTime()) / 864e5);
const holiday = (s: string) => HOL[s.slice(5)] || "";
const inDays = (n: number) => (n === 0 ? "Днес" : n === 1 ? "Утре" : n > 0 ? "След " + n + " дни" : "Мина");
function readHash(): Record<string, string> { const o: Record<string, string> = {}; location.hash.slice(1).split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return o; }
function writeHash(o: Record<string, string>) { const h = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&"); try { history.replaceState(history.state, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ } }
type Ev = EventView;
const priceHTML = (e: Pick<Ev, "priceMode" | "price">, long = false) => (e.priceMode === "free" ? "Вход свободен" : e.priceMode === "price" && e.price != null ? fmt(e.price) : missing(long ? "цена или вход свободен" : "цена"));
const seatsHTML = (e: Pick<Ev, "seats">) => (e.seats != null ? plural(e.seats, "място", "места") : missing("брой"));
/** the fields of an event for a write ("Отмени" writes them back) */
const inputOf = (e: Ev | EventRow): EventInput => ({ n: e.n, cat: e.cat, time: e.time, text: e.text, prog: e.prog, menu: e.menu, priceMode: e.priceMode, price: e.price, seats: e.seats, ...(e.recur ? {} : { date: e.date || undefined }) });

export async function initEvents(): Promise<void> {
  const body = await mount({ section: "events", title: "Събития", docTitle: "Събития",
    sub: "Тематични вечери, жива музика и празници. Новото събитие се показва в сайта веднага след „Публикувай“.",
    actions: '<button class="pill pill-red pill-lg" type="button" data-new>' + ic("plus", 22) + "Ново събитие</button>" });
  if (!body) return;
  const root = body;
  root.innerHTML = skel(4, "Зареждаме събитията …");

  const H = readHash();
  let E: Ev[] | null = null, cats: readonly string[] = [], version = 0, err: unknown = null, net = true;
  let tab: "up" | "past" = H.t === "past" ? "past" : "up", cat = H.c || "";
  const today = () => sofiaYmd();
  const byId = (id: string) => (E || []).find((e) => e.id === id) || null;

  async function load() {
    try { const [r] = await Promise.all([eventsAdminApi.list({ tab: "all" }), loadSite()]); E = r.rows; cats = r.cats; version = r.version; err = null; net = true; }
    catch (e) { err = e; }
    draw();
  }
  const isPast = (e: Ev) => e.phase === "past";
  function list() { return (E || []).filter((e) => (tab === "up" ? !isPast(e) : isPast(e)) && (!cat || e.cat === cat)).sort((a, b) => (tab === "up" ? a.days - b.days : b.days - a.days)); }
  const siteHref = (e: Ev) => aurl.preview(e.recur ? "m=site&p=event&d=phone" : "m=site&p=events&d=phone");

  function cardHTML(e: Ev) {
    const past = isPast(e), s = past ? "past" : e.status === "published" ? "pub" : "draft", d = parts(e.dateNext);
    const prog = e.prog && e.menu ? "Попълнени" : missing([e.prog ? "" : "програма", e.menu ? "" : "меню"].filter(Boolean).join(" и "));
    return '<article class="ev' + (s === "draft" ? " draft" : "") + '" data-id="' + esc(e.id) + '" data-edit-id="admin.events.card"><div class="ev-date" aria-hidden="true"><small>' + DS[d.getUTCDay()] + "</small><b>" + d.getUTCDate() + "</b><small>" + MON[d.getUTCMonth()] + "</small></div>" +
      '<div class="ev-b"><div class="ev-tags"><span class="sa-tag ' + (s === "pub" ? "st-pub" : s === "draft" ? "st-draft" : "st-past") + '">' + (s === "pub" ? ic("check", 16) + "В сайта" : s === "draft" ? "Чернова" : "Минало") + '</span><span class="sa-tag">' + ic(CATI[e.cat] || "calendar-blank", 16) + esc(e.cat) + "</span>" +
        (e.recur ? '<span class="sa-tag">' + ic("calendar-dots", 16) + "Всеки месец</span>" : "") +
        (holiday(e.dateNext) && !past ? '<span class="sa-tag hol">' + ic("warning-circle", 16) + "Празник (" + holiday(e.dateNext) + "): проверете</span>" : "") + "</div>" +
        "<h3>" + esc(e.n) + '</h3><span class="when">' + esc(fmtYmd(e.dateNext)) + " · " + esc(e.time) + ' <span class="muted" style="font-weight:600">· ' + inDays(e.days) + "</span></span></div>" +
      '<dl class="ev-facts"><div><dt>Цена</dt><dd>' + priceHTML(e) + "</dd></div><div><dt>Места</dt><dd>" + seatsHTML(e) + "</dd></div><div><dt>Програма и меню</dt><dd>" + prog + "</dd></div></dl>" +
      '<div class="ev-f"><button class="pill pill-ink" type="button" data-edit aria-label="Промени ' + esc(e.n) + '">' + ic("pencil-simple", 20) + "Промени</button>" +
        (s === "pub" ? '<a class="pill pill-line" href="' + siteHref(e) + '">' + ic("eye", 20) + "Виж в сайта</a>" : s === "draft" ? '<button class="pill pill-line" type="button" data-pub>' + ic("paper-plane-right", 20) + "Публикувай</button>" : "") +
        '<span class="sp"></span>' + (e.recur ? '<span class="ev-keep">' + ic("info", 18) + "Не се трие</span>" : '<button class="pill pill-line del" type="button" data-del aria-label="Изтрий ' + esc(e.n) + '">' + ic("trash", 20) + "Изтрий</button>") + "</div></article>";
  }

  function draw(keep = false) {
    if (!E) { root.innerHTML = err ? failHTML(err, "Не успяхме да заредим събитията. Страниците в сайта остават, както са.") : skel(4, "Зареждаме събитията …"); return; }
    const sc = A.scroller, y = sc ? sc.scrollTop : 0, up = E.filter((e) => !isPast(e)).length, past = E.length - up, l = list();
    const cs = cats.filter((c) => E!.some((e) => e.cat === c && (tab === "up" ? !isPast(e) : isPast(e))));
    let html = (!net ? failHTML(new ApiError("offline", ""), "Показваме последно заредените събития. Промените не се записват без връзка; опитайте пак, щом връзката се върне.") + '<div style="height:16px"></div>' : "") +
      '<div class="ev-top" data-edit-id="admin.events.tabs"><div class="sa-tabs" role="tablist" aria-label="Събития"><button type="button" role="tab" aria-selected="' + (tab === "up") + '" data-tab="up" aria-controls="ev-p">Предстоящи<span class="c">' + up + '</span></button><button type="button" role="tab" aria-selected="' + (tab === "past") + '" data-tab="past" aria-controls="ev-p">Минали<span class="c">' + past + '</span></button></div><span class="sp"></span>' +
      '<a class="pill pill-line" href="' + aurl.preview("m=site&p=events&d=phone") + '">' + ic("eye", 20) + "Страницата в сайта</a></div>" + siteLine("events", repaintLine) +
      (cs.length > 1 ? '<div class="ev-cats" role="group" aria-label="Категория"><button class="chip" type="button" data-c="" aria-pressed="' + !cat + '">Всички</button>' + cs.map((c) => '<button class="chip" type="button" data-c="' + esc(c) + '" aria-pressed="' + (cat === c) + '">' + ic(CATI[c] || "calendar-blank", 18) + esc(c) + "</button>").join("") + "</div>" : "");
    html += '<div id="ev-p" role="tabpanel">';
    if (!l.length) html += '<div class="sa-card">' + (tab === "up" ? empty({ icon: "confetti", title: "Няма предстоящи събития.", text: "Добавете тематична вечер, жива музика или празник. Страницата в сайта се прави сама.", action: '<button class="pill pill-red pill-lg" type="button" data-new>' + ic("plus", 22) + "Ново събитие</button>" })
      : empty({ icon: "images", title: "Още няма минали събития.", text: "Тук остават събитията след датата им. Архивът отпреди: " + missing("архив със снимки") + "." })) + "</div>";
    else html += '<div class="ev-list">' + l.map(cardHTML).join("") + "</div>";
    html += '</div><section class="ev-help" data-edit-id="admin.events.help"><h3>' + ic("info", 20) + "Какво трябва за всяка тематична вечер</h3><ul><li>Програма, меню на вечерта и цена (или „Вход свободен“): " + missing("от ресторанта") + "</li><li>Капацитет на салона и градината: " + missing("брой места") + "</li><li>Снимки от минали вечери: " + missing("след фотосесията") + "</li></ul></section>";
    root.innerHTML = html; if (keep && sc) sc.scrollTop = y;
  }
  function repaintLine() { const el = root.querySelector("[data-site-line]"); if (el) el.outerHTML = siteLine("events"); }
  const sync = () => writeHash({ t: tab === "past" ? "past" : "", c: cat });

  /* the view after a write: the row from the core in place (or added), the version */
  function put(r: Ev & { version: number }) { version = r.version; const { version: _v, ...row } = r; const i = E!.findIndex((e) => e.id === row.id); if (i < 0) E!.push(row); else E![i] = row; }
  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    try { const r = await fn(); net = true; return r; }
    catch (e) {
      if (e instanceof ApiError && e.code === "conflict") { toast(e.message); E = null; draw(); await load(); return null; }
      if (isOffline(e)) net = false;
      draw(true); toast(failText(e)); return null;
    }
  }
  async function publish(id: string, on: boolean, undo = true) {
    const ev = byId(id)!, r = await run(() => eventsAdminApi.publish(id, on)); if (!r) return;
    put(r); draw(true); afterWrite();
    const txt = (on ? "Публикувано в сайта: " : "Скрито от сайта: ") + ev.n + ", " + fmtYmd(ev.dateNext);
    toast(txt + "." + rebuildNote(), undo ? { undo: () => { void publish(id, !on, false); } } : {});
  }

  root.addEventListener("click", (e) => {
    const tg = e.target as Element; let t: HTMLElement | null;
    if (tg.closest('[data-sa="retry"]')) { e.stopPropagation(); E = null; err = null; draw(); void load(); return; }
    if ((t = tg.closest<HTMLElement>("[data-tab]"))) { tab = t.dataset.tab === "past" ? "past" : "up"; cat = ""; sync(); draw(); const n = root.querySelector<HTMLElement>('[data-tab="' + tab + '"]'); if (n) n.focus({ preventScroll: true }); return; }
    if ((t = tg.closest<HTMLElement>("[data-c]"))) { cat = t.dataset.c || ""; sync(); draw(true); const n = root.querySelector<HTMLElement>('[data-c="' + CSS.escape(cat) + '"]'); if (n) n.focus({ preventScroll: true }); return; }
    if ((t = tg.closest<HTMLElement>("[data-edit]"))) { editor(t.closest<HTMLElement>("[data-id]")!.dataset.id!); return; }
    if ((t = tg.closest<HTMLElement>("[data-pub]"))) { void publish(t.closest<HTMLElement>("[data-id]")!.dataset.id!, true); return; }
    if ((t = tg.closest<HTMLElement>("[data-del]"))) {
      const id = t.closest<HTMLElement>("[data-id]")!.dataset.id!, ev = byId(id)!;
      confirm({ title: "Да изтрием ли „" + ev.n + "“?", text: esc(fmtYmd(ev.dateNext) + ". " + (ev.status === "published" ? "Страницата изчезва от сайта." : "Черновата се изтрива.") + " Може да го върнете с „Отмени“ веднага след това."), ok: "Изтрий", danger: true, icon: "trash" }, async () => {
        const r = await run(() => eventsAdminApi.remove(id)); if (!r) return;
        version = r.version; E = E!.filter((x) => x.id !== id); draw(true); afterWrite();
        const row = r.removed;
        toast("Изтрито: " + ev.n + "." + (ev.status === "published" ? rebuildNote() : ""), { undo: async () => { const b = await run(() => eventsAdminApi.restore(row)); if (b) { put(b); draw(true); afterWrite(); toast("Върнато: " + ev.n); } } });
      });
      return;
    }
  }, true);
  document.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-new]")) editor(null); });
  bindRebuild(root);

  /* ---------- the editor: a sheet with the preview "Така изглежда в сайта" ---------- */
  function editor(id: string | null) {
    if (!E) return;
    const t0 = today(), maxD = addDays(t0, 365);
    const e: Ev | null = id ? byId(id) : null; if (id && !e) return;
    const recur = !!(e && e.recur), wasPub = !!(e && e.status === "published");
    const v0 = e ? { ...e } : { n: "", cat: "Тематични вечери", date: "", time: "19:00", text: "", prog: "", menu: "", price: null as number | null, priceMode: "tbd" as Ev["priceMode"], seats: null as number | null };
    const T: string[] = []; for (let m = 600; m <= 1350; m += 30) T.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));
    if (v0.time && !T.includes(v0.time)) T.push(v0.time), T.sort();
    const html = '<form class="ev-form" novalidate data-edit-id="admin.events.sheet">' +
      '<div class="field"><label for="ef-n">Име</label><input class="input" id="ef-n" name="n" value="' + esc(v0.n) + '" autocomplete="off" maxlength="' + (recur ? RECUR_NAME : 80) + '" placeholder="Например: Гръцка вечер" aria-describedby="ef-n-e"><span class="err" id="ef-n-e" hidden></span></div>' +
      '<div class="field"><label for="ef-cat">Категория</label><select class="input" id="ef-cat" name="cat" aria-describedby="ef-cat-e">' + cats.map((c) => "<option" + (c === v0.cat ? " selected" : "") + ">" + esc(c) + "</option>").join("") + '</select><span class="err" id="ef-cat-e" hidden></span></div>' +
      '<div class="two"><div class="field"><label for="ef-date">Дата</label>' + (recur ? '<input class="input" id="ef-date" name="date" type="text" value="' + esc(fmtYmd(e!.dateNext)) + '" disabled aria-describedby="ef-date-h"><span class="help" id="ef-date-h">Всяка последна събота на месеца.</span>'
        : '<input class="input" id="ef-date" name="date" type="date" min="' + t0 + '" max="' + maxD + '" value="' + esc(v0.date || "") + '" aria-describedby="ef-date-e">') + '<span class="err" id="ef-date-e" hidden></span></div>' +
        '<div class="field"><label for="ef-time">Час</label><select class="input" id="ef-time" name="time" aria-describedby="ef-time-e">' + T.map((x) => "<option" + (x === v0.time ? " selected" : "") + ">" + x + "</option>").join("") + '</select><span class="err" id="ef-time-e" hidden></span></div></div>' +
      '<div class="field"><label for="ef-text">Кратко описание</label><textarea class="input" id="ef-text" name="text" rows="2" maxlength="' + (recur ? RECUR_TEXT : 600) + '" placeholder="Едно-две изречения за сайта" aria-describedby="ef-text-e">' + esc(v0.text) + '</textarea><span class="err" id="ef-text-e" hidden></span></div>' +
      '<div class="field"><label for="ef-prog">Програма</label><textarea class="input" id="ef-prog" name="prog" rows="3" maxlength="2000" placeholder="19:00 посрещане, 20:00 музика …" aria-describedby="ef-prog-h ef-prog-e">' + esc(v0.prog) + '</textarea><span class="help" id="ef-prog-h">Празно в сайта: ' + missing("програма") + '</span><span class="err" id="ef-prog-e" hidden></span></div>' +
      '<div class="field"><label for="ef-menu">Меню на вечерта</label><textarea class="input" id="ef-menu" name="menu" rows="3" maxlength="2000" placeholder="Ястията на вечерта, по едно на ред" aria-describedby="ef-menu-h ef-menu-e">' + esc(v0.menu) + '</textarea><span class="help" id="ef-menu-h">Празно в сайта: ' + missing("меню на вечерта") + '</span><span class="err" id="ef-menu-e" hidden></span></div>' +
      '<div class="grp"><span class="label" id="ef-pl">Цена</span><div class="seg" role="group" aria-labelledby="ef-pl">' + ([["price", "Цена"], ["free", "Вход свободен"], ["tbd", "Още не е ясно"]] as [string, string][]).map((p) => '<button type="button" data-pm="' + p[0] + '" aria-pressed="' + (v0.priceMode === p[0]) + '">' + p[1] + "</button>").join("") + "</div>" +
        '<div class="field" data-pricef' + (v0.priceMode === "price" ? "" : " hidden") + '><label for="ef-price">Цена на човек</label><div class="ev-eu" style="max-width:200px"><input class="input" id="ef-price" name="price" inputmode="decimal" autocomplete="off" value="' + (v0.price != null ? v0.price.toFixed(2).replace(".", ",") : "") + '" placeholder="25,00" aria-describedby="ef-price-e"><span class="u" aria-hidden="true">€</span></div><span class="err" id="ef-price-e" hidden></span></div></div>' +
      '<div class="field"><label for="ef-seats">Места <span class="muted" style="font-weight:600">(по желание)</span></label><input class="input" id="ef-seats" name="seats" inputmode="numeric" maxlength="3" value="' + (v0.seats != null ? v0.seats : "") + '" style="max-width:200px" aria-describedby="ef-seats-h ef-seats-e"><span class="help" id="ef-seats-h">Капацитетът на залата: ' + missing("от собственика") + '. Сайтът показва „Остават 6 места“, когато са малко.</span><span class="err" id="ef-seats-e" hidden></span></div>' +
      '<div class="ev-photo">' + ic("image", 22) + "<span>Снимка: " + missing("след фотосесията") + ". Дотогава сайтът показва иконата на категорията.</span></div>" +
      '<p class="ev-prevh">' + ic("eye", 18) + 'Така изглежда в сайта</p><div class="ev-prev" data-prev aria-live="polite"></div></form>';
    const pubLabel = wasPub ? "Запази" : "Публикувай", draftLabel = wasPub ? (recur ? "" : "Скрий от сайта") : "Запази чернова";
    const s = sheet({ title: e ? e.n : "Ново събитие", html, focus: id ? "[data-close]" : "#ef-n",
      foot: (draftLabel ? '<button class="pill pill-line pill-lg" type="button" data-draft>' + draftLabel + "</button>" : "") + '<button class="pill pill-red pill-lg" type="button" data-ok>' + ic(wasPub ? "check" : "paper-plane-right", 22) + pubLabel + "</button>" });
    const f = s.body.querySelector<HTMLFormElement>("form")!;
    const fld = <T extends HTMLElement = HTMLInputElement>(n: string) => f.querySelector<T>("#ef-" + n)!;
    let pm = v0.priceMode;
    function read() {
      const p = fld("price").value.replace(/\s/g, "").replace("€", "").replace(",", "."), se = fld("seats").value.trim();
      return { n: fld("n").value.trim(), cat: fld<HTMLSelectElement>("cat").value, date: recur ? "" : fld("date").value, time: fld<HTMLSelectElement>("time").value, text: fld<HTMLTextAreaElement>("text").value.trim(),
        prog: fld<HTMLTextAreaElement>("prog").value.trim(), menu: fld<HTMLTextAreaElement>("menu").value.trim(), priceMode: pm, price: pm === "price" && /^\d{1,3}(\.\d{1,2})?$/.test(p) ? +p : null, seats: /^\d{1,3}$/.test(se) ? +se : null, seatsRaw: se };
    }
    function prev() {
      const v = read(), date = recur ? e!.dateNext : v.date, n = date ? dd(t0, date) : 0;
      s.body.querySelector("[data-prev]")!.innerHTML = '<div class="pv">' + ic(CATI[v.cat] || "calendar-blank", 44) + '<span class="flag">' + ic("clock", 16) + (date ? inDays(n) : "Без дата") + '</span><span class="cap">' + missing("снимка") + "</span></div>" +
        '<span class="sa-tag" style="justify-self:start">' + ic(CATI[v.cat] || "calendar-blank", 16) + esc(v.cat) + "</span><h4>" + (v.n ? esc(v.n) : '<span class="missing">Име на събитието</span>') + "</h4>" +
        '<div class="meta"><span>' + (date ? esc(fmtYmd(date)) : '<span class="muted">Изберете дата</span>') + " · " + v.time + "</span><span>" + priceHTML(v) + "</span>" + (v.seats != null && v.seats <= 10 ? "<span>Остават " + plural(v.seats, "място", "места") + "</span>" : "") + "</div>" +
        '<span class="pill pill-red go" aria-hidden="true">Запази място' + ic("arrow-right", 20) + "</span>";
    }
    prev(); f.addEventListener("input", prev); f.addEventListener("change", prev);
    f.addEventListener("click", (ev) => {
      const b = (ev.target as Element).closest<HTMLElement>("[data-pm]"); if (!b) return;
      pm = b.dataset.pm as Ev["priceMode"]; f.querySelectorAll("[data-pm]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      f.querySelector<HTMLElement>("[data-pricef]")!.hidden = pm !== "price"; if (pm === "price") fld("price").focus(); prev();
    });
    function er(name: string, m: string) { const i = fld<HTMLElement>(name), el = s.body.querySelector<HTMLElement>("#ef-" + name + "-e"); if (!el) return !m; if (m) { i.setAttribute("aria-invalid", "true"); el.hidden = false; el.textContent = m; } else { i.removeAttribute("aria-invalid"); el.hidden = true; } return !m; }
    const btns = () => Array.from(s.foot!.querySelectorAll<HTMLButtonElement>("button"));
    async function commit(publishIt: boolean) {
      const v = read();
      const ok = [er("n", v.n.length < 2 ? "Напишете име, например „Гръцка вечер“." : ""),
        recur ? true : er("date", !v.date ? "Изберете дата." : v.date < t0 ? "Датата е минала. Изберете днес или по-късно." : v.date > maxD ? "До една година напред." : ""),
        er("price", pm === "price" && v.price == null ? "Напишете цена като 25,00 или изберете „Вход свободен“." : ""), er("seats", v.seatsRaw && (v.seats == null || v.seats < 1) ? "Само цифри, например 40." : "")];
      const bad = (["n", "date", "price", "seats"] as const).filter((_, i) => !ok[i]); if (bad.length) { fld(bad[0]).focus(); return; }
      const input: EventInput = { n: v.n, cat: v.cat, time: v.time, text: v.text, prog: v.prog, menu: v.menu, priceMode: pm, price: v.price, seats: v.seats, ...(recur ? {} : { date: v.date }) };
      btns().forEach((b) => { b.disabled = true; });
      let r: (Ev & { version: number }) | null = null;
      try {
        if (!e) r = await eventsAdminApi.create({ ...input, publish: publishIt });
        else {
          r = await eventsAdminApi.update(e.id, input, version);
          if (publishIt !== (r.status === "published")) { put(r); r = await eventsAdminApi.publish(e.id, publishIt); }
        }
        net = true;
      } catch (x) {
        btns().forEach((b) => { b.disabled = false; });
        if (x instanceof ApiError && x.fields) {
          const keys = Object.keys(x.fields).filter((k) => s.body.querySelector("#ef-" + k + "-e"));
          keys.forEach((k) => er(k, x.fields![k])); if (keys.length) { fld(keys[0]).focus(); return; }
        }
        if (x instanceof ApiError && x.code === "conflict") { s.close(); toast(x.message); E = null; draw(); await load(); return; }
        if (isOffline(x)) { net = false; draw(true); }
        toast(failText(x)); return;
      }
      put(r!); s.close();
      const row = r!, past = row.phase === "past";
      if (!past && tab !== "up") { tab = "up"; sync(); }
      draw(true); afterWrite();
      const isPub = row.status === "published";
      const txt = (isPub ? (wasPub ? "Запазено в сайта: " : "Публикувано: ") : (wasPub ? "Скрито от сайта: " : "Чернова: ")) + row.n + ", " + fmtYmd(row.dateNext);
      const note = isPub || wasPub ? rebuildNote() : "";
      const old = e ? { ...e } : null;
      toast(txt + "." + note, { undo: async () => {
        if (!old) { const b = await run(() => eventsAdminApi.remove(row.id)); if (b) { version = b.version; E = E!.filter((x) => x.id !== row.id); draw(true); afterWrite(); toast("Отменено: " + txt); } return; }
        let b = await run(() => eventsAdminApi.update(old.id, inputOf(old), undefined));
        if (b && (b.status === "published") !== wasPub) b = await run(() => eventsAdminApi.publish(old.id, wasPub));
        if (b) { put(b); draw(true); afterWrite(); toast("Отменено: " + txt); }
      } });
    }
    s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!.onclick = () => { void commit(true); };
    const dB = s.foot!.querySelector<HTMLButtonElement>("[data-draft]"); if (dB) dB.onclick = () => { void commit(false); };
  }

  await load();
  const want = readHash().e; if (want && byId(want)) setTimeout(() => editor(want), 300);
}
