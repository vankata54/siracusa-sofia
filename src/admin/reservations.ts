/* /admin/reservations/: "Резервации" (design/pages-admin/reservations.html, version 4, 1:1; README-3; DECISIONS 16.11.2026
   "основа на част 3"). Everything from reservationsAdminApi (src/client/api-admin-3.ts: server or demo, the rights in the core).
   - The day: the calendar of the month (dots by the bookings) and on the phone a strip of days + "Календар" in a sheet; the
     4 numbers (bookings, people, to confirm, no-shows), "Хора в залата по час" (capacity [ЛИПСВА]), tabs by status with
     counts (a select on the phone), search by name or the last digits (3+ digits: on the server, the phone never comes whole).
   - The list by hour: guest, the phone masked, status, "Закъснява 20 мин", people, table · zone, occasion, note; quick
     actions "Потвърди", "Дошли" / "Неявили се" (from 30 min before the time, canArrive of the core), "Дай маса", "Още" ->
     a sheet with everything: "Покажи" the phone (into the log), the 6 statuses, "Смени маса" (only the free ones),
     "Обади се". Every change: a toast with "Отмени" (the core takes the status back to prevStatus).
   - "Чакащи" (waiting list) with "Дай маса"; "Нова резервация" from the staff (the core's rules, "Потвърдена", never
     marketing; without a table "Чака маса").
   - "Блокиране" (#blocks from the dashboard "Неявили се за решение"): the numbers waiting for a decision and the blocked
     ones, always masked, addressed by ref; "Блокирай" / "Не блокирай" / "Отблокирай" / "Добави номер ръчно" only for the
     main admin, the owner and the manager (canDecide); the others see the list with why.
   States: loading, error, offline (the last data stay), empty day, nothing for the filter, no rights (a.ts). */
import "sc-icons:plus,sparkle,check,check-circle,warning-circle,x,hourglass,chair,dots-three,clock,lock,users,tree,cake,note,calendar-blank,calendar-check,caret-left,caret-right,info,arrow-counter-clockwise,magnifying-glass,phone";
import { reservationsAdminApi as RA, hallApi, ApiError, type ResRow, type ResDay, type BlockRow, type HallView } from "../client/api-admin-3.ts";
import { adminApi } from "../client/api-admin.ts";
import { api } from "../client/api.ts";
import { A, mount, can, toast, sheet, skel, failHTML, offline, empty, missing, banner, loadSummary, sofiaYmd, sofiaHM, fmtYmd, roleName, esc, ic, plural } from "./a.ts";
import { ago } from "./when.ts";

type St = ResRow["status"];
const SN: Record<St, string> = { new: "Нова", confirmed: "Потвърдена", seated: "Дошли", no_show: "Неявили се", cancelled: "Отказана", waitlist: "Чака маса" };
const SI: Record<St, string> = { new: "sparkle", confirmed: "check", seated: "check-circle", no_show: "warning-circle", cancelled: "x", waitlist: "hourglass" };
const ZN: Record<string, string> = { salon: "Салон", garden: "Градина" };
const OCC = ["Рожден ден", "Имен ден", "Годишнина", "Делова среща", "Друго"];
const FL: [string, string][] = [["", "Всички"], ["new", "Нови"], ["confirmed", "Потвърдени"], ["seated", "Дошли"], ["no_show", "Неявили се"], ["cancelled", "Отказани"]];
const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
const DOW = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
const PHONE_MSG = "Телефонът трябва да е 10 цифри, например 0888 12 34 56.";

/* ---------- days ("YYYY-MM-DD", no time zone surprises: noon UTC) ---------- */
const pad2 = (n: number) => String(n).padStart(2, "0");
const ymdOf = (d: Date) => d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
const parse = (k: string) => { const p = k.split("-").map(Number); return new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)); };
const addD = (k: string, n: number) => { const d = parse(k); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); };
const toM = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
const hm = (m: number) => pad2(Math.floor(m / 60)) + ":" + pad2(m % 60);
const SLOTS: string[] = []; for (let m0 = 660; m0 <= 1290; m0 += 30) SLOTS.push(hm(m0)); /* 11:00-21:30 every 30 min (the core) */
const people = (n: number) => plural(n, "човек", "души");
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const errText = (e: unknown, d = "Не успяхме. Опитайте пак.") => (e instanceof ApiError ? e.message : d);

/* ---------- the hash: #d=2026-11-20&f=new, #blocks ---------- */
function readHash(): Record<string, string> {
  const o: Record<string, string> = {};
  location.hash.replace(/^#/, "").split("&").forEach((p) => { if (!p) return; const i = p.indexOf("="); o[i < 0 ? p : p.slice(0, i)] = i < 0 ? "1" : decodeURIComponent(p.slice(i + 1)); });
  return o;
}
function writeHash(o: Record<string, string>) {
  const s = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
  try { history.replaceState(null, "", location.pathname + location.search + (s ? "#" + s : "")); } catch { /* ignore */ }
}

export async function initReservations(): Promise<void> {
  const body = await mount({ section: "reservations", title: "Резервации",
    sub: "Денят по часове: кой идва, на коя маса, с какъв повод. Потвърдете новите, отбележете дошлите и неявилите се; два пъти „Неявили се“ предлагат номера за блокиране.",
    actions: '<button class="pill pill-red" type="button" data-new>' + ic("plus", 20) + "Нова резервация</button>" });
  if (!body) return;
  const root = body;
  const TODAY = sofiaYmd();
  const nowM = () => { const t = sofiaHM(); return t.h * 60 + t.m; };
  const H = readHash();
  let day = /^\d{4}-\d{2}-\d{2}$/.test(H.d || "") ? H.d : TODAY, flt = FL.some((f) => f[0] === H.f) ? H.f : "", q = "", month = day.slice(0, 7);

  /* ---------- data ---------- */
  let DAY: ResDay | null = null, CANC: ResRow[] = [], QR: ResRow[] | null = null;
  const MON: Record<string, Record<string, { bookings: number; toConfirm: number }>> = {};
  let BL: { rows: BlockRow[]; canDecide: boolean; limit: number } | null = null, HALL: HallView | null = null;
  let loadErr: unknown = null, offlineNote = false;
  const revealed: Record<string, string> = {};
  const names: Record<string, string> = {};

  const monthsFor = () => { const s = new Set([month, TODAY.slice(0, 7)]); const base = day < TODAY ? day : TODAY; s.add(addD(base, -1).slice(0, 7)); s.add(addD(base, 6).slice(0, 7)); return [...s]; };
  async function loadMonths(force = false) {
    await Promise.all(monthsFor().filter((m) => force || !MON[m]).map(async (m) => { MON[m] = (await RA.month(m)).days; }));
  }
  async function loadBlocks() { try { BL = await RA.blocks(); } catch (e) { if (!BL) throw e; } }
  /** the day (all but the cancelled) + the cancelled + the months + the blocks */
  async function load(): Promise<void> {
    const [d, c] = await Promise.all([RA.day({ date: day }), RA.day({ date: day, status: "cancelled" }), loadMonths(true), loadBlocks()]);
    DAY = d; CANC = c.rows; loadErr = null; offlineNote = false;
    if (q) await search();
  }
  /** the search: 3+ digits look in the whole phone on the server; names too */
  async function search() {
    if (!q) { QR = null; return; }
    const [a, b] = await Promise.all([RA.day({ date: day, q }), RA.day({ date: day, status: "cancelled", q })]);
    QR = a.rows.concat(b.rows);
  }
  async function refresh(quiet = true) {
    try { await load(); } catch (e) { if (!DAY) loadErr = e; else { offlineNote = isOffline(e); if (!quiet) toast(errText(e, "Не успяхме да обновим резервациите.")); } }
    draw();
  }
  const extras = async () => {
    try { HALL = await hallApi.get(); } catch { /* the seats in the sheet only */ }
    if (can("staff")) try { (await adminApi.staff()).forEach((u) => { names[u.username] = u.name; }); } catch { /* usernames then */ }
  };
  const nameOf = (u: string | null) => (!u ? "" : names[u] || (A.me && A.me.user.username === u ? A.me.user.name : roleName(u)));
  const seatsOf = (id: string | null) => { const t = id && HALL ? HALL.tables.find((x) => x.id === id) : null; return t ? t.seats : null; };

  /* ---------- small parts ---------- */
  const fdate = (k: string, short = false) => fmtYmd(k, short);
  const all = () => (DAY ? DAY.rows : []).concat(CANC);
  const stTag = (s: St) => '<span class="st st-' + s + '">' + ic(SI[s], 16) + SN[s] + "</span>";
  const tableTxt = (r: ResRow) => (r.tableN != null ? "Маса " + r.tableN + " · " + ZN[r.zone || "salon"] : "Без маса");
  const blockOf = (r: ResRow) => (BL ? BL.rows.find((b) => b.phone === r.phone && b.name === r.name && (b.status === "pending" || b.status === "blocked")) : undefined);
  const canDecide = () => !!BL && BL.canDecide;
  const dayCount = (k: string) => { const m = MON[k.slice(0, 7)]; return m && m[k] ? m[k] : { bookings: 0, toConfirm: 0 }; };

  function calHTML() {
    const y = +month.slice(0, 4), mo = +month.slice(5, 7) - 1, first = new Date(Date.UTC(y, mo, 1, 12)), off = (first.getUTCDay() + 6) % 7, start = addD(ymdOf(first), -off);
    const dim = new Date(Date.UTC(y, mo + 1, 0, 12)).getUTCDate(), cells = Math.ceil((off + dim) / 7) * 7;
    let h = "";
    for (let i = 0; i < cells; i++) {
      const k = addD(start, i), L = dayCount(k).bookings, inM = k.slice(0, 7) === month;
      h += '<button type="button" data-day="' + k + '" class="' + (inM ? "" : "out ") + (k === TODAY ? "today " : "") + (k < TODAY ? "past" : "") + '" aria-pressed="' + (k === day) + '" aria-label="' + fdate(k) + (L ? ", " + plural(L, "резервация", "резервации") : ", няма резервации") + '">' + +k.slice(8) +
        (L ? '<span class="dots" aria-hidden="true">' + "<i></i>".repeat(Math.min(3, Math.ceil(L / 4))) + "</span>" : "") + "</button>";
    }
    const mn = MONTHS[mo];
    return '<div class="cal" data-edit-id="admin.reservations.calendar"><div class="cal-h"><b>' + mn.charAt(0).toUpperCase() + mn.slice(1) + " " + y + '</b><button class="iconbtn" type="button" data-mon="-1" aria-label="Предишен месец">' + ic("caret-left", 22) + '</button><button class="iconbtn" type="button" data-mon="1" aria-label="Следващ месец">' + ic("caret-right", 22) + "</button></div>" +
      '<div class="cal-g" role="group" aria-label="Дни">' + ["пн", "вт", "ср", "чт", "пт", "сб", "нд"].map((d) => '<span class="dw" aria-hidden="true">' + d + "</span>").join("") + h + "</div>" +
      '<div class="cal-foot"><button class="pill pill-soft" type="button" data-day="' + TODAY + '">Днес</button><button class="pill pill-soft" type="button" data-day="' + addD(TODAY, 1) + '">Утре</button></div></div>';
  }
  function daysHTML() {
    let h = "";
    for (let i = -1; i <= 6; i++) {
      const k = addD(day < TODAY ? day : TODAY, i), c = dayCount(k), d = parse(k);
      /* the name is the hidden text (the visible "пн 16 3 рез." would not match an aria-label) */
      h += '<button type="button" data-day="' + k + '" aria-pressed="' + (k === day) + '"><span class="vh">' + fdate(k) + ", " + plural(c.bookings, "резервация", "резервации") + (c.toConfirm ? ", " + c.toConfirm + " чакат потвърждение" : "") + '</span><small aria-hidden="true">' + (k === TODAY ? "днес" : DOW[d.getUTCDay()]) + '</small><span aria-hidden="true">' + d.getUTCDate() + "</span>" +
        '<span class="n" aria-hidden="true">' + (c.bookings ? c.bookings + " рез." : "няма") + "</span>" + (c.toConfirm ? '<span class="nw" aria-hidden="true"></span>' : "") + "</button>";
    }
    return '<div class="days" role="group" aria-label="Ден">' + h + '<button class="cal" type="button" data-calsheet>' + ic("calendar-blank", 22) + "Календар</button></div>";
  }
  function waitHTML(sfx = "") {
    const W = (DAY ? DAY.rows : []).filter((r) => r.status === "waitlist");
    return '<section class="box" aria-labelledby="wl-h' + sfx + '" data-edit-id="admin.reservations.waitlist"><h3 id="wl-h' + sfx + '">' + ic("hourglass", 20) + 'Чакащи<span class="c">' + W.length + "</span></h3>" +
      (W.length ? "<p>Няма свободна маса за техния час. Щом се освободи, дайте им маса и им се обадете.</p>" + W.map((r) => '<div class="bi"><div class="l1"><b>' + esc(r.name) + "</b><span>" + r.time + " · " + people(r.people) + '</span></div><div class="row"><button class="pill pill-red" type="button" data-seat-wl="' + r.id + '">' + ic("chair", 18) + 'Дай маса</button><button class="pill pill-line" type="button" data-open="' + r.id + '">Детайли</button></div></div>').join("")
        : "<p>Никой не чака за " + (day === TODAY ? "днес" : fdate(day)) + ".</p>") + "</section>";
  }
  function blockHTML(sfx = "") {
    const rows = BL ? BL.rows : [], pend = rows.filter((b) => b.status === "pending"), blk = rows.filter((b) => b.status === "blocked"), CAN = canDecide(), dis = CAN ? "" : " disabled";
    const item = (b: BlockRow) => '<div class="bi"><div class="l1"><b>' + esc(b.name || "Без име") + "</b><span>" + esc(b.phone) + "</span><span>" + (b.manual ? "добавен ръчно" : plural(b.count, "неявяване", "неявявания")) + "</span></div>" +
      (b.status === "pending"
        ? '<div class="row"><button class="pill pill-red" type="button" data-bl="block" data-ref="' + b.ref + '"' + dis + ">" + ic("lock", 18) + 'Блокирай</button><button class="pill pill-line" type="button" data-bl="clear" data-ref="' + b.ref + '"' + dis + ">Не блокирай</button></div>"
        : "<p>Блокиран " + esc(ago(b.at)) + (b.by ? " от " + esc(nameOf(b.by)) : "") + '. Не може да резервира онлайн и да прави профил.</p><div class="row"><button class="pill pill-line" type="button" data-bl="unblock" data-ref="' + b.ref + '"' + dis + ">" + ic("arrow-counter-clockwise", 18) + "Отблокирай</button></div>") + "</div>";
    const lim = BL ? BL.limit : 2;
    return '<section class="box" aria-labelledby="bl-h' + sfx + '" data-edit-id="admin.reservations.blocks"><h3 id="bl-h' + sfx + '">' + ic("lock", 20) + 'Блокиране<span class="c">' + (pend.length + blk.length) + "</span></h3>" +
      "<p>След " + plural(lim, "неявяване", "неявявания") + " номерът чака решение. Блокира и отблокира управителят (или собственикът и главният админ).</p>" +
      (!CAN && A.me ? '<p style="color:var(--ink);display:flex;gap:8px;align-items:flex-start">' + ic("info", 18) + "<span>Ролята „" + esc(roleName(A.me.user.role)) + "“ само вижда списъка.</span></p>" : "") +
      (pend.length ? '<p style="color:var(--ink);font-weight:800;margin-top:4px">Чакат решение</p>' + pend.map(item).join("") : "") +
      (blk.length ? '<p style="color:var(--ink);font-weight:800;margin-top:4px">Блокирани</p>' + blk.map(item).join("") : "") +
      (!pend.length && !blk.length ? "<p>Няма блокирани номера.</p>" : "") +
      '<button class="pill pill-soft" type="button" data-bladd' + dis + ">" + ic("plus", 18) + "Добави номер ръчно</button></section>";
  }
  function rowHTML(r: ResRow) {
    let acts = "";
    if (r.status === "new") acts = '<button class="pill pill-red" type="button" data-st="confirmed" data-id="' + r.id + '">' + ic("check", 18) + "Потвърди</button>";
    else if (r.status === "confirmed" && r.canArrive) acts = '<button class="pill pill-ink" type="button" data-st="seated" data-id="' + r.id + '">' + ic("check-circle", 18) + 'Дошли</button><button class="pill pill-line" type="button" data-st="no_show" data-id="' + r.id + '">Неявили се</button>';
    else if (r.status === "waitlist") acts = '<button class="pill pill-red" type="button" data-seat-wl="' + r.id + '">' + ic("chair", 18) + "Дай маса</button>";
    const compact = !acts;
    acts += '<button class="pill pill-soft" type="button" data-open="' + r.id + '" aria-label="Още за ' + esc(r.name) + ", " + r.time + '">' + ic("dots-three", 20) + "Още</button>";
    const b = blockOf(r);
    return '<article class="rsv s-' + r.status + (compact ? " compact" : "") + '" data-rv="' + r.id + '"><div><div class="who"><b>' + esc(r.name) + '</b><span class="ph">' + esc(revealed[r.id] ? fmtPhone(revealed[r.id]) : r.phone) + "</span>" + stTag(r.status) +
      (r.lateMin ? '<span class="late">' + ic("clock", 16) + "Закъснява " + r.lateMin + " мин</span>" : "") + (b ? '<span class="late">' + ic("lock", 16) + (b.status === "blocked" ? "Блокиран номер" : "Чака блокиране") + "</span>" : "") + "</div>" +
      '<div class="meta"><span class="sa-tag">' + ic("users", 16) + people(r.people) + '</span><span class="sa-tag">' + ic(r.tableN != null ? (r.zone === "garden" ? "tree" : "chair") : "hourglass", 16) + tableTxt(r) + "</span>" + (r.occasion ? '<span class="sa-tag ember">' + ic("cake", 16) + esc(r.occasion) + "</span>" : "") + "</div>" +
      (r.note ? '<p class="note">' + ic("note", 18) + "<span>" + esc(r.note) + "</span></p>" : "") + '</div><div class="acts">' + acts + "</div></article>";
  }
  function loadHTML(by: ResDay["byHour"]) {
    const cnt = by.map((x) => x.people), mx = Math.max(...cnt, 1), pk = cnt.indexOf(Math.max(...cnt)), nm = nowM();
    return '<div class="load" data-edit-id="admin.reservations.load"><div class="load-h"><b>Хора в залата по час</b><small>Спрямо най-натоварения час (' + by[pk].time + ", " + people(cnt[pk]) + "). Капацитет: " + missing("капацитет") + "</small></div>" +
      '<div class="bars" role="img" aria-label="' + esc(by.map((x) => x.time + ": " + x.people).join(", ")) + '">' + by.map((x, i) => {
        const now = day === TODAY && toM(x.time) <= nm && nm < toM(x.time) + 30;
        return '<span class="' + (now ? "now" : i === pk && x.people ? "pk" : "") + '" style="height:' + Math.max(5, Math.round((x.people / mx) * 100)) + '%" title="' + x.time + " · " + x.people + '"></span>';
      }).join("") + "</div>" +
      '<div class="bars-x" aria-hidden="true"><span>11:00</span><span>13:00</span><span>15:00</span><span>17:00</span><span>19:00</span><span>21:30</span></div></div>';
  }

  function draw() {
    const sc = A.scroller!, y = sc.scrollTop;
    if (!DAY) { root.innerHTML = loadErr ? failHTML(loadErr, "Не успяхме да заредим резервациите. Новите резервации от сайта се пазят и ще се появят тук.") : skel(5, "Зареждаме резервациите …"); return; }
    /* a quiet refresh keeps the focus where it was */
    const ae = document.activeElement as HTMLElement | null;
    let keep = "";
    if (ae && root.contains(ae)) keep = ae.id ? "#" + ae.id : ["data-open", "data-st", "data-id", "data-flt", "data-day", "data-seat-wl", "data-bl", "data-ref", "data-mon"].filter((k) => ae.hasAttribute(k)).map((k) => "[" + k + '="' + ae.getAttribute(k) + '"]').join("");
    const L = all(), live = L.filter((r) => r.status !== "cancelled" && r.status !== "waitlist"), s = DAY.stats;
    const count = (f: string) => L.filter((r) => r.status !== "waitlist" && (f ? r.status === f : r.status !== "cancelled")).length;
    const src = QR || L;
    const shown = src.filter((r) => r.status !== "waitlist" && (flt ? r.status === flt : r.status !== "cancelled"));
    const hours: Record<string, ResRow[]> = {};
    shown.forEach((r) => { (hours[r.time.slice(0, 2)] ||= []).push(r); });
    const title = day === TODAY ? "Днес" : day === addD(TODAY, 1) ? "Утре" : day === addD(TODAY, -1) ? "Вчера" : "";
    root.innerHTML = (offlineNote ? offline("Показваме последно заредените резервации. Проверете връзката и опитайте пак.") + '<div style="height:16px"></div>' : "") +
      '<div class="rs"><aside class="rs-side"><div class="cal-wrap">' + calHTML() + '</div><div class="side-only" style="gap:12px">' + waitHTML("s") + blockHTML("s") + "</div></aside>" +
      '<div class="rs-main">' +
        '<div class="rs-phone">' + daysHTML() + "</div>" +
        '<div class="dayh"><h2>' + (title ? "<small>" + title + "</small>" : "") + fdate(day) + "</h2></div>" +
        '<div class="kpis" data-edit-id="admin.reservations.kpis"><div class="kpi"><b>' + s.bookings + '</b><span>резервации</span></div><div class="kpi"><b>' + s.people + "</b><span>души</span></div>" +
          '<div class="kpi' + (s.toConfirm ? " hot" : "") + '"><b>' + s.toConfirm + '</b><span>чакат потвърждение</span></div><div class="kpi"><b>' + s.noShows + "</b><span>неявили се</span></div></div>" +
        (live.length || s.noShows ? loadHTML(DAY.byHour) : "") +
        '<div class="rs-bar"><div class="sa-tabs" role="tablist" aria-label="Статус">' + FL.map((f) => '<button role="tab" type="button" data-flt="' + f[0] + '" aria-selected="' + (flt === f[0]) + '">' + f[1] + '<span class="c">' + count(f[0]) + "</span></button>").join("") + "</div>" +
          '<div class="rs-sel"><label class="vh" for="rs-f">Статус</label><select class="input" id="rs-f" data-fsel>' + FL.map((f) => '<option value="' + f[0] + '"' + (flt === f[0] ? " selected" : "") + ">" + f[1] + " · " + count(f[0]) + "</option>").join("") + "</select></div>" +
          '<div class="sa-field-s"><label class="vh" for="rs-q">Търси по име или телефон</label>' + ic("magnifying-glass", 20) + '<input class="input" id="rs-q" type="search" placeholder="Име или последни цифри" autocomplete="off" value="' + esc(q) + '"></div></div>' +
        '<div data-list aria-live="polite">' + (!L.length ? '<div class="sa-card">' + empty({ icon: "calendar-check", title: "Няма резервации за " + (day === TODAY ? "днес." : fdate(day) + "."), text: "Резервациите от сайта и по телефона идват тук.", action: '<button class="pill pill-red pill-lg" type="button" data-new>' + ic("plus", 22) + "Нова резервация</button>" }) + "</div>"
          : !shown.length ? '<div class="sa-card">' + empty({ icon: "magnifying-glass", title: "Нищо не отговаря на филтъра.", text: "Махнете търсенето или изберете „Всички“." }) + "</div>"
          : Object.keys(hours).sort().map((h) => { const G = hours[h]; return '<div class="hr"><div class="t">' + h + ":00<small>" + people(G.reduce((a, r) => a + (r.status === "cancelled" ? 0 : r.people), 0)) + '</small></div><div class="rlist">' + G.map(rowHTML).join("") + "</div></div>"; }).join("")) + "</div>" +
        '<div class="main-only sa-grid c2">' + waitHTML() + blockHTML() + "</div>" +
      "</div></div>";
    sc.scrollTop = y;
    if (keep) { const f = Array.from(root.querySelectorAll<HTMLElement>(keep)).find((x) => x.offsetParent !== null); if (f) f.focus({ preventScroll: true }); }
    const dsel = root.querySelector<HTMLElement>('.days [aria-pressed="true"]');
    if (dsel) { const strip = dsel.parentElement!; strip.scrollLeft = Math.max(0, dsel.offsetLeft - strip.clientWidth / 2 + dsel.offsetWidth / 2); }
  }

  /* #blocks (the dashboard "Неявили се за решение"): to the visible "Блокиране" box, a short glow, the focus on its title */
  function goBlocks() {
    const box = Array.from(root.querySelectorAll<HTMLElement>('section.box[aria-labelledby^="bl-h"]')).filter((b) => b.offsetParent !== null)[0];
    if (!box) return;
    const h = box.querySelector("h3")!; h.setAttribute("tabindex", "-1");
    box.scrollIntoView({ block: "start" }); h.focus({ preventScroll: true });
    box.classList.remove("flash"); void box.offsetWidth; box.classList.add("flash"); setTimeout(() => box.classList.remove("flash"), 2200);
    setTimeout(() => { const sc = A.scroller!, top = box.getBoundingClientRect().top - sc.getBoundingClientRect().top; if (Math.abs(top - 96) > 4) sc.scrollTop += top - 96; }, 450);
  }
  window.addEventListener("hashchange", () => { if (/(^#|&)blocks(&|$)/.test(location.hash)) goBlocks(); });
  /* #new=1: "Нова резервация" from the manager's module opens the form at once */
  if (H.new) setTimeout(() => newRes(), 0);
  const hashSync = () => writeHash({ d: day === TODAY ? "" : day, f: flt });
  const byId = (id: string) => all().find((r) => r.id === id) || (QR || []).find((r) => r.id === id);
  const busy = new Set<string>();

  /* ---------- the status (a toast with "Отмени"); a no-show may put the number on the list ---------- */
  async function setStatus(r: ResRow, s: St, after?: () => void) {
    if (busy.has(r.id)) return; busy.add(r.id);
    const was = r.status, pendBefore = new Set((BL ? BL.rows : []).filter((b) => b.status === "pending").map((b) => b.ref));
    try { await RA.setStatus(r.id, s); }
    catch (e) { busy.delete(r.id); toast(errText(e)); if (isOffline(e)) { offlineNote = true; draw(); } return; }
    busy.delete(r.id);
    await refresh(); loadSummary(true).catch(() => undefined); if (after) after();
    let extra = "";
    if (s === "no_show" && BL) { const nb = BL.rows.find((b) => b.status === "pending" && !pendBefore.has(b.ref) && b.name === r.name); if (nb) extra = ". " + plural(nb.count, "неявяване", "неявявания") + ": номерът чака решение за блокиране"; }
    toast(r.name + ": " + SN[s] + extra, { undo: async () => { try { await RA.setStatus(r.id, was); toast(r.name + ": върнато „" + SN[was] + "“"); } catch (e) { toast(errText(e)); } await refresh(); loadSummary(true).catch(() => undefined); } });
  }

  function openRes(r: ResRow) {
    const seats = seatsOf(r.table);
    const ph = () => (revealed[r.id] ? '<a href="tel:' + esc(revealed[r.id]) + '">' + esc(fmtPhone(revealed[r.id])) + "</a>" : esc(r.phone) + ' <button class="link" type="button" data-reveal>Покажи</button>');
    const stBtns = () => (["new", "confirmed", "seated", "no_show", "cancelled", "waitlist"] as St[]).map((k) => {
      const off = k !== r.status && ((k === "waitlist" && r.prevStatus !== "waitlist") || ((k === "seated" || k === "no_show") && !r.canArrive && r.prevStatus !== k));
      return '<button type="button" data-sst="' + k + '" aria-pressed="' + (r.status === k) + '"' + (off ? " disabled" : "") + ">" + ic(SI[k], 18) + SN[k] + "</button>";
    }).join("");
    const s = sheet({ title: r.name + " · " + r.time, html:
      '<p style="margin:0 0 10px" data-sttag>' + stTag(r.status) + "</p>" +
      '<div class="kvs">' +
        '<div class="kv"><b>Ден и час</b><span>' + fdate(r.date) + ", " + r.time + " (масата е за гостите до " + r.until + ")</span></div>" +
        '<div class="kv"><b>Телефон</b><span data-phv>' + ph() + "</span></div>" +
        '<div class="kv"><b>Хора</b><span>' + people(r.people) + "</span></div>" +
        '<div class="kv"><b>Маса</b><span>' + tableTxt(r) + (r.tableN != null && seats ? ", " + seats + " места" : "") + "</span></div>" +
        '<div class="kv"><b>Повод</b><span>' + (r.occasion ? esc(r.occasion) : "Няма") + "</span></div>" +
        '<div class="kv"><b>Бележка</b><span>' + (r.note ? esc(r.note) : "Няма") + "</span></div>" +
        (r.by ? '<div class="kv"><b>Записал</b><span>' + esc(nameOf(r.by)) + "</span></div>" : "") +
      "</div>" +
      '<p class="label" style="margin:16px 0 8px">Статус</p><div class="seg-st" role="group" aria-label="Статус" data-segs>' + stBtns() + "</div>" +
      (!r.canArrive ? '<p class="rs-help">„Дошли“ и „Неявили се“ се отбелязват от 30 минути преди часа.</p>' : "") +
      '<div class="field" style="margin-top:16px"><label for="rs-tb">Смени маса</label><select class="input" id="rs-tb"><option value="">' + (r.tableN != null ? "Остава маса " + r.tableN : "Изберете маса") + '</option></select><span class="help">Само свободните в ' + r.time + " за " + people(r.people) + ".</span></div>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-call>' + ic("phone", 22) + 'Обади се</button><button class="pill pill-red pill-lg" type="button" data-done>' + ic("check", 22) + "Готово</button>" });
    RA.free(r.date, r.time, r.people, r.id).then((free) => {
      const sel = s.body.querySelector<HTMLSelectElement>("#rs-tb"); if (!sel) return;
      sel.insertAdjacentHTML("beforeend", free.filter((x) => x.id !== r.table).map((x) => '<option value="' + x.id + '">Маса ' + x.n + " · " + ZN[x.zone] + ", " + x.seats + " места</option>").join(""));
    }).catch(() => undefined);
    const reveal = async () => {
      if (!revealed[r.id]) { try { revealed[r.id] = (await RA.phone(r.id)).phone; } catch (e) { toast(errText(e)); return false; } }
      const el = s.body.querySelector("[data-phv]"); if (el) el.innerHTML = ph();
      draw(); return true;
    };
    s.body.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("[data-sst]");
      if (b && !b.disabled && b.dataset.sst !== r.status) {
        setStatus(r, b.dataset.sst as St, () => { const nr = byId(r.id); if (nr) Object.assign(r, nr); const g = s.body.querySelector("[data-segs]"); if (g) g.innerHTML = stBtns(); const tg = s.body.querySelector("[data-sttag]"); if (tg) tg.innerHTML = stTag(r.status); });
        return;
      }
      if ((e.target as Element).closest("[data-reveal]")) void reveal();
    });
    s.foot!.querySelector<HTMLButtonElement>("[data-call]")!.onclick = async () => { if (await reveal()) location.href = "tel:" + revealed[r.id]; };
    s.foot!.querySelector<HTMLButtonElement>("[data-done]")!.onclick = async () => {
      const v2 = s.body.querySelector<HTMLSelectElement>("#rs-tb")!.value;
      if (!v2) { s.close(); return; }
      const old = r.table, oldN = r.tableN, wasSt = r.status;
      try { const nr = await RA.setTable(r.id, v2); s.close(); await refresh();
        toast(r.name + ": маса " + nr.tableN, { undo: async () => { try { await RA.setTable(r.id, old); if (wasSt === "waitlist") await RA.setStatus(r.id, "waitlist"); toast(r.name + ": " + (oldN != null ? "пак маса " + oldN : "без маса")); } catch (e) { toast(errText(e)); } await refresh(); } });
      } catch (e) { toast(errText(e)); }
    };
  }

  async function seatWaitlist(r: ResRow) {
    let free: Awaited<ReturnType<typeof RA.free>> = [];
    try { free = await RA.free(r.date, r.time, r.people, r.id); } catch (e) { toast(errText(e)); return; }
    const s = sheet({ title: "Маса за " + r.name, html: "<p>" + fdate(r.date) + ", " + r.time + " · " + people(r.people) + "</p>" +
      (free.length ? '<div class="field"><label for="wl-t">Свободна маса</label><select class="input" id="wl-t">' + free.map((x) => '<option value="' + x.id + '">Маса ' + x.n + " · " + ZN[x.zone] + ", " + x.seats + " места</option>").join("") + '</select></div><p class="muted" style="margin:12px 0 0">Обадете се на клиента. Известие по SMS: ' + missing("доставчик за SMS") + ".</p>"
        : banner({ tone: "warn", icon: "warning-circle", title: "Още няма свободна маса", text: "В " + r.time + " всички маси за " + people(r.people) + " са заети. Обединете маси в „Залата и масите“ или изчакайте отказ." })),
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button>' + (free.length ? '<button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Дай масата</button>" : ""), focus: free.length ? "#wl-t" : undefined });
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const ok = s.foot!.querySelector<HTMLButtonElement>("[data-ok]");
    if (ok) ok.onclick = async () => {
      ok.disabled = true;
      try {
        const nr = await RA.setTable(r.id, s.body.querySelector<HTMLSelectElement>("#wl-t")!.value); s.close(); await refresh(); loadSummary(true).catch(() => undefined);
        toast(r.name + " получи маса " + nr.tableN + ". Обадете се на клиента.", { undo: async () => { try { await RA.setTable(r.id, null); await RA.setStatus(r.id, "waitlist"); } catch (e) { toast(errText(e)); } await refresh(); } });
      } catch (e) { ok.disabled = false; toast(errText(e)); }
    };
  }

  /* ---------- "Нова резервация" (the core's rules: 11:00-21:30, up to 92 days, a table by the seats, a blocked number) ---------- */
  function newRes() {
    const d0 = day < TODAY ? TODAY : day;
    const s = sheet({ title: "Нова резервация", html: '<form class="form" novalidate data-nf>' +
      '<div class="two"><div class="field"><label for="nr-d">Ден</label><input class="input" id="nr-d" type="date" min="' + TODAY + '" max="' + addD(TODAY, 92) + '" value="' + d0 + '"></div>' +
      '<div class="field"><label for="nr-t">Час</label><select class="input" id="nr-t"><option value="">Изберете</option>' + SLOTS.map((x) => "<option>" + x + "</option>").join("") + "</select></div></div>" +
      '<div class="two"><div class="field"><label for="nr-p">Хора</label><input class="input" id="nr-p" type="number" inputmode="numeric" min="1" max="60" value="2"></div>' +
      '<div class="field"><label for="nr-tb">Маса</label><select class="input" id="nr-tb"><option value="">Първо изберете час</option></select></div></div>' +
      '<div class="field"><label for="nr-n">Име</label><input class="input" id="nr-n" autocomplete="off"></div>' +
      '<div class="field"><label for="nr-ph">Телефон</label><input class="input" id="nr-ph" type="tel" inputmode="tel" placeholder="0888 12 34 56" autocomplete="off"></div>' +
      '<div class="field"><label for="nr-o">Повод (по желание)</label><select class="input" id="nr-o"><option value="">Няма</option>' + OCC.map((o) => "<option>" + o + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="nr-no">Бележка (по желание)</label><textarea class="input" id="nr-no" rows="2"></textarea></div>' +
      '<p class="muted" style="margin:0;font-size:15px">Съгласие за оферти се дава само от госта в сайта; тук не се отбелязва.</p></form>',
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Запази</button>", focus: "#nr-t" });
    const B = s.body, $ = <T extends HTMLElement = HTMLInputElement>(sel: string) => B.querySelector<T>(sel)!;
    let seq = 0;
    async function fillTables() {
      const d = $("#nr-d").value, t = $<HTMLSelectElement>("#nr-t").value, p = +$("#nr-p").value || 1, sel = $<HTMLSelectElement>("#nr-tb"), cur = sel.value, my = ++seq;
      if (!t) { sel.innerHTML = '<option value="">Първо изберете час</option>'; return; }
      let free: Awaited<ReturnType<typeof RA.free>> = [];
      try { free = await RA.free(d, t, p); } catch { free = []; }
      if (my !== seq) return;
      sel.innerHTML = '<option value="">' + (free.length ? "Чакащи (без маса)" : "Няма свободна: чакащи") + "</option>" + free.map((x) => '<option value="' + x.id + '"' + (x.id === cur ? " selected" : "") + ">Маса " + x.n + " · " + ZN[x.zone] + ", " + x.seats + " места</option>").join("");
    }
    ["#nr-d", "#nr-t", "#nr-p"].forEach((k) => $(k).addEventListener("change", () => void fillTables()));
    function err(el: HTMLElement, msg: string) {
      const fld = el.closest(".field")!; let e = fld.querySelector<HTMLElement>(".err");
      if (!e) { e = document.createElement("span"); e.className = "err"; e.id = el.id + "-err"; fld.appendChild(e); }
      e.textContent = msg; e.hidden = !msg; el.setAttribute("aria-invalid", msg ? "true" : "false");
      if (msg) el.setAttribute("aria-describedby", e.id); else el.removeAttribute("aria-describedby");
    }
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const okb = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    okb.onclick = async () => {
      const d = $("#nr-d").value, t = $<HTMLSelectElement>("#nr-t").value, p = +$("#nr-p").value, nm = $("#nr-n").value.trim(), ph = $("#nr-ph").value.replace(/\D/g, "").replace(/^359/, "0");
      let bad: HTMLElement | null = null;
      const chk = (el: HTMLElement, cond: boolean, msg: string) => { err(el, cond ? "" : msg); if (!cond && !bad) bad = el; };
      const today = sofiaYmd(), nm0 = nowM();
      chk($("#nr-d"), !!d && d >= today && d <= addD(today, 92), "Изберете дата от днес до 3 месеца напред.");
      chk($("#nr-t"), !!t && !(d === today && toM(t) <= nm0), t ? "Този час вече мина. Изберете по-късен." : "Изберете час между 11:00 и 21:30.");
      chk($("#nr-p"), Number.isInteger(p) && p >= 1 && p <= 60, "Изберете брой хора.");
      chk($("#nr-n"), !!nm, "Напишете името на госта.");
      chk($("#nr-ph"), /^0\d{9}$/.test(ph), PHONE_MSG);
      err($("#nr-tb"), "");
      if (bad) { (bad as HTMLElement).focus(); return; }
      const tb = $<HTMLSelectElement>("#nr-tb").value;
      okb.disabled = true;
      try {
        const r = await RA.create({ date: d, time: t, people: p, table: tb || null, name: nm, phone: ph, occasion: $<HTMLSelectElement>("#nr-o").value || undefined, note: $<HTMLTextAreaElement>("#nr-no").value.trim() || undefined, waitlist: !tb });
        s.close(); day = d; month = d.slice(0, 7); hashSync(); await refresh(); loadSummary(true).catch(() => undefined);
        toast("Резервацията е записана: " + fdate(d, true) + ", " + t + (r.status === "waitlist" ? " (чака маса)" : ""), { undo: async () => { try { await RA.setStatus(r.id, "cancelled"); toast("Резервацията е отказана"); } catch (e) { toast(errText(e)); } await refresh(); } });
      } catch (e) {
        okb.disabled = false;
        const map: Record<string, string> = { date: "#nr-d", time: "#nr-t", people: "#nr-p", name: "#nr-n", phone: "#nr-ph", table: "#nr-tb" };
        if (e instanceof ApiError && e.fields) {
          let first: HTMLElement | null = null;
          for (const k of Object.keys(e.fields)) { const el = map[k] ? $(map[k]) : null; if (el) { err(el, k === "name" ? "Напишете името на госта." : e.fields[k]); first ||= el; } }
          if (first) { (first as HTMLElement).focus(); return; }
        }
        if (e instanceof ApiError && e.code === "blocked") { err($("#nr-ph"), "Този номер е блокиран за резервации. Отблокирайте го в „Блокиране“, ако управителят реши."); $("#nr-ph").focus(); return; }
        if (e instanceof ApiError && e.code === "taken") { err($("#nr-tb"), e.message); await fillTables(); $("#nr-tb").focus(); return; }
        toast(errText(e));
      }
    };
  }

  /* ---------- blocking (main admin, owner, manager; the core checks it too) ---------- */
  async function blockAct(act: string, ref: string) {
    const b = BL && BL.rows.find((x) => x.ref === ref); if (!b) return;
    const who = b.name || b.phone;
    try {
      await RA.decide(ref, act === "block" ? "block" : "clear");
      await refresh(); loadSummary(true).catch(() => undefined);
      if (act === "unblock") toast(who + " е отблокиран", { undo: async () => { try { await RA.decide(ref, "block"); } catch (e) { toast(errText(e)); } await refresh(); } });
      else toast(act === "block" ? who + " е блокиран" : who + " не е блокиран");
    } catch (e) { toast(errText(e)); }
  }
  function addBlock() {
    const s = sheet({ title: "Добави номер за блокиране", html: '<div class="form"><div class="field"><label for="ba-p">Телефон</label><input class="input" id="ba-p" type="tel" inputmode="tel" placeholder="0888 12 34 56"></div><div class="field"><label for="ba-n">Име (по желание)</label><input class="input" id="ba-n" autocomplete="off" placeholder="Например: Иван"></div><p class="muted" style="margin:0;font-size:15px">Блокираният номер не може да резервира онлайн и да прави профил. Списъкът се описва в политиката за поверителност (срок на пазене: ' + missing("срок") + ").</p></div>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("lock", 22) + "Блокирай</button>", focus: "#ba-p" });
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!.onclick = async () => {
      const el = s.body.querySelector<HTMLInputElement>("#ba-p")!, ph = el.value.replace(/\D/g, "").replace(/^359/, "0"), f = el.closest(".field")!;
      const show = (m: string) => { let e = f.querySelector<HTMLElement>(".err"); if (!e) { e = document.createElement("span"); e.className = "err"; e.id = "ba-p-err"; f.appendChild(e); } e.textContent = m; el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", "ba-p-err"); el.focus(); };
      if (!/^0\d{9}$/.test(ph)) { show(PHONE_MSG); return; }
      try {
        const b = await RA.addBlock(ph, s.body.querySelector<HTMLInputElement>("#ba-n")!.value.trim() || undefined);
        s.close(); await refresh(); loadSummary(true).catch(() => undefined);
        toast("Номерът " + b.phone + " е блокиран", { undo: async () => { try { await RA.decide(b.ref, "clear"); } catch (e) { toast(errText(e)); } await refresh(); } });
      } catch (e) { if (e instanceof ApiError && e.fields && e.fields.phone) show(e.fields.phone); else toast(errText(e)); }
    };
  }

  /* ---------- events ---------- */
  document.addEventListener("click", (e) => {
    const el = e.target as Element; let t: HTMLElement | null;
    if ((t = el.closest<HTMLElement>("[data-day]"))) {
      day = t.dataset.day!; month = day.slice(0, 7); q = ""; QR = null; hashSync();
      const w = t.closest(".sheetwrap"); if (w) w.querySelector<HTMLButtonElement>("[data-close]")!.click();
      DAY = null; draw(); void refresh(false); return;
    }
    if ((t = el.closest<HTMLElement>("[data-mon]"))) {
      const y = +month.slice(0, 4), mo = +month.slice(5, 7) - 1 + +t.dataset.mon!; month = ymdOf(new Date(Date.UTC(y, mo, 1, 12))).slice(0, 7);
      const sh = t.closest(".sheet");
      loadMonths().catch(() => undefined).then(() => { if (sh) { const b = sh.querySelector(".body"); if (b) b.innerHTML = calHTML(); } else draw(); });
      return;
    }
    if (el.closest("[data-calsheet]")) { sheet({ title: "Изберете ден", html: calHTML() }); return; }
    if ((t = el.closest<HTMLElement>("[data-flt]"))) { flt = t.dataset.flt!; hashSync(); draw(); root.querySelector<HTMLElement>('[data-flt="' + flt + '"]')?.focus({ preventScroll: true }); return; }
    if ((t = el.closest<HTMLElement>("[data-st]"))) { const r = byId(t.dataset.id!); if (r) void setStatus(r, t.dataset.st as St); return; }
    if ((t = el.closest<HTMLElement>("[data-open]"))) { const r = byId(t.dataset.open!); if (r) openRes(r); return; }
    if ((t = el.closest<HTMLElement>("[data-seat-wl]"))) { const r = byId(t.dataset.seatWl!); if (r) void seatWaitlist(r); return; }
    if ((t = el.closest<HTMLElement>("[data-bl]"))) { if (!(t as HTMLButtonElement).disabled) void blockAct(t.dataset.bl!, t.dataset.ref!); return; }
    if (el.closest("[data-bladd]")) { if (canDecide()) addBlock(); return; }
    if (el.closest("[data-new]")) { newRes(); return; }
  });
  root.addEventListener("change", (e) => { const t = e.target as HTMLSelectElement; if (t.matches("[data-fsel]")) { flt = t.value; hashSync(); draw(); root.querySelector<HTMLElement>("[data-fsel]")?.focus({ preventScroll: true }); } });
  let qT: ReturnType<typeof setTimeout> | undefined;
  root.addEventListener("input", (e) => {
    const inp = e.target as HTMLInputElement; if (inp.id !== "rs-q") return;
    q = inp.value.trim(); clearTimeout(qT);
    qT = setTimeout(async () => {
      try { await search(); } catch (er) { toast(errText(er)); return; }
      const pos = (root.querySelector<HTMLInputElement>("#rs-q") || inp).selectionStart; draw();
      const i = root.querySelector<HTMLInputElement>("#rs-q"); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch { /* type=search */ } }
    }, 250);
  });
  /* new bookings from the site and changes from other screens: a quiet refresh */
  let rT: ReturnType<typeof setTimeout> | undefined;
  const soon = () => { clearTimeout(rT); rT = setTimeout(() => { if (!document.querySelector(".sa-ov .sheetwrap.on")) void refresh(); }, 600); };
  api.on("reservation.created", soon); api.on("reservation.status", soon);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") soon(); });
  setInterval(() => { if (document.visibilityState === "visible") soon(); }, 60_000);

  draw();
  void extras();
  await refresh(false);
  if ("blocks" in H && DAY) setTimeout(goBlocks, 60);
}

/** "0888 12 34 56" */
function fmtPhone(p: string): string { const d = String(p || "").replace(/\D/g, ""); return d.length === 10 ? d.slice(0, 4) + " " + d.slice(4, 6) + " " + d.slice(6, 8) + " " + d.slice(8) : p; }
