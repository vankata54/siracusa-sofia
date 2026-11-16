/* /admin/lunch/: "Обедно меню" (design/pages-admin/lunch.html, approved, 1:1; decisions 12.11 and 16.11.2026).
   - A weekly schedule Mon-Fri (#w=<monday>, #d=<day>); the lunch dishes on the left (search in Cyrillic or Latin), the day on
     the right by groups with "Махни". Adding: drag (also onto a day tile), double click, or "Добави" (the phone and the
     keyboard; on the phone a sheet "Добави във вторник"). Every change is saved at once (a draft until "Публикувай"), with
     "Отмени" in the toast; the core writes the log (lunch.*).
   - The rule: the same list of dishes as the calendar day before or after stops publishing, with a clear red text
     (the server checks the same: 422 "same_menu").
   - "Публикувай" in the floating bar publishes the days of the week that wait; only today's published day reaches the site
     (the server rebuilds it by itself; a future day the day it comes). The demo does not rebuild the site: the bar and the
     toast say so.
   - Favourite combinations, "Ново ястие" (name, group, price; grammage and allergens [ЛИПСВА]), "Изчерпано днес" for today's
     lunch dishes (the same switch as the menu and the kitchen: adminApi.setSoldOut), the note about -30% after 15:00 (pickup
     only), "Публикация в Google профила · Скоро", the last 5 lunch.* lines of the log.
   - PIN: the owner, the manager and the main admin work without it and see "ПИН е зададен · Смени ПИН" (the new PIN is
     shown once in the sheet, never again; no "Покажи", no "Отмени": the old one is hashed). Anyone else with the section
     opens the schedule with the PIN (wrong: how many tries are left; locked: a countdown by retryIn), "Заключи".
   States: loading (skeleton), empty day, error, no connection, no rights (A.mount), PIN not set yet. */
import "sc-icons:caret-left,caret-right,calendar-blank,warning,check,plus,x,bowl-food,copy,heart,trash,arrow-right,lock,pencil-simple,list-bullets,google-logo,magnifying-glass,info,clock,paper-plane-right,arrow-counter-clockwise";
import { api } from "../client/api.ts";
import { adminApi, ApiError } from "../client/api-admin.ts";
import { lunchApi, type LunchView } from "../client/api-menu.ts";
import { A, mount, can, toast, sheet, skel, failHTML, offline, banner, missing, soonTag, fmtYmd, sofiaYmd, sofiaHM, norm, esc, ic, fmt, plural } from "./a.ts";
import { aurl } from "./routes.ts";
import { ago } from "./when.ts";

type Item = LunchView["catalog"][number];
type Out = { id: string; n: string; out: boolean };
/* the preview (?preview=1&t=19:42) and the demo: the hour of the preview, and the lunch menu of the data counts as today's
   (decision 12.11.2026). Read here, not from lib/time.ts: importing it would add exports to the shared runtime chunk. */
const QS = new URLSearchParams(location.search);
const PREVIEW = QS.has("preview") || document.documentElement.dataset.demo === "1";
function now(): { h: number; m: number } {
  const t = PREVIEW ? /^(\d{1,2}):(\d{2})$/.exec(QS.get("t") || "") : null;
  return t && +t[1] < 24 && +t[2] < 60 ? { h: +t[1], m: +t[2] } : sofiaHM();
}
type Log = { at: string; actor: string; action: string; target?: string; data?: unknown };

/* ---------- dates ("YYYY-MM-DD", calendar days, no time zone shift) ---------- */
const DAYN = ["Неделя", "Понеделник", "Вторник", "Сряда", "Четвъртък", "Петък", "Събота"];
const DS = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
const MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
const MON = MONTHS.map((m) => m.slice(0, 3));
const pad = (n: number) => String(n).padStart(2, "0");
function ymd(y: number, m: number, d: number) { const t = new Date(Date.UTC(y, m, d)); return t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1) + "-" + pad(t.getUTCDate()); }
function parts(s: string) { const p = s.split("-"); return { y: +p[0], m: +p[1] - 1, d: +p[2] }; }
export function addDays(s: string, n: number) { const p = parts(s); return ymd(p.y, p.m, p.d + n); }
export function dowOf(s: string) { const p = parts(s); return new Date(Date.UTC(p.y, p.m, p.d)).getUTCDay(); }
/** the Monday of the week to show: this week; on Saturday and Sunday the next one */
export function mondayOf(today: string) { const w = dowOf(today); return w === 6 ? addDays(today, 2) : w === 0 ? addDays(today, 1) : addDays(today, 1 - w); }
/** "в пн", but "във вт" */
const vd = (d: string, cap = false) => { const w = DS[dowOf(d)]; return (w.charAt(0) === "в" ? (cap ? "Във " : "във ") : (cap ? "В " : "в ")) + w; };
const dayLow = (d: string) => (dowOf(d) === 2 ? "във " : "в ") + DAYN[dowOf(d)].toLowerCase();
const dayFull = (d: string) => DAYN[dowOf(d)] + ", " + parts(d).d + " " + MONTHS[parts(d).m];

/* ---------- the rule (the same as the core: the same list, order does not matter, the calendar day before or after) ---------- */
export function sameList(a: string[], b: string[]) { return a.length > 0 && a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|"); }
export function clashOf(days: Record<string, string[]>, day: string): string | null {
  const me = days[day] || [];
  for (const o of [addDays(day, -1), addDays(day, 1)]) if (sameList(me, days[o] || [])) return o;
  return null;
}
type St = { k: "empty" | "bad" | "pub" | "draft" | "past"; t: string };
export function statusOf(v: Pick<LunchView, "days" | "pub" | "today">, day: string): St {
  const me = v.days[day] || [], pb = v.pub[day];
  if (!me.length) return { k: "empty", t: "Празен" };
  if (pb && sameList(me, pb.ids)) return { k: "pub", t: "Публикувано" };
  if (day < v.today) return { k: "past", t: "Мина, не е публикувано" };
  if (clashOf(v.days, day)) return { k: "bad", t: "Повтаря се" };
  return pb ? { k: "draft", t: "Промени след публикуване" } : { k: "draft", t: "Чернова" };
}

export async function initLunch(): Promise<void> {
  const body = await mount({ section: "lunch", title: "Обедно меню", docTitle: "Обедно меню",
    sub: "Седмичен график от понеделник до петък. Сайтът показва обедното меню като текст до 15:00, след това само за вземане с -30%." });
  if (!body) return;
  const root = body, DEMO = document.documentElement.dataset.demo === "1";
  root.innerHTML = skel(5, "Зареждаме графика …");

  let V: LunchView | null = null, boss = false, mon = "", cur = "", q = "", busy = 0, offlineNote = false;
  let outs: Out[] | null = null, outToday = false, log: Log[] | null = null;
  const names: Record<string, string> = {};
  const cat = () => (V ? V.catalog : []);
  const byId = (id: string): Item | undefined => cat().find((x) => x.id === id);
  const ids = (day: string) => (V && V.days[day]) || [];
  const week = () => [0, 1, 2, 3, 4].map((i) => addDays(mon, i));
  const groups = () => (V ? V.groups : []);
  const isOff = (e: unknown) => e instanceof ApiError && e.code === "offline";
  const isPin = (e: unknown) => e instanceof ApiError && (e.code === "pin_required" || e.code === "pin_unset");

  /* ---------- the address: #w=<monday>&d=<day> ---------- */
  function readHash(today: string) {
    const h = new URLSearchParams(location.hash.slice(1)), def = mondayOf(today);
    let w = h.get("w") || "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w)) w = def;
    if (dowOf(w) !== 1) w = addDays(w, 1 - (dowOf(w) || 7));
    mon = w;
    const d = h.get("d") || "";
    cur = /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= mon && d <= addDays(mon, 4) ? d : today >= mon && today <= addDays(mon, 4) ? today : mon;
  }
  function sync() {
    if (!V) return; const def = mondayOf(V.today), p: string[] = [];
    if (mon !== def) p.push("w=" + mon);
    if (cur !== (V.today >= mon && V.today <= addDays(mon, 4) ? V.today : mon)) p.push("d=" + cur);
    history.replaceState(null, "", location.pathname + location.search + (p.length ? "#" + p.join("&") : ""));
  }

  /* ---------- loading ---------- */
  async function load(): Promise<void> {
    try {
      /* another staff member without an open schedule: straight to the PIN (no refused request) */
      const ps = await lunchApi.pinState();
      if (!ps.boss && !ps.openUntil) { V = null; if (ps.pinSet) gateDraw(); else unsetDraw(); return; }
      V = await lunchApi.get();
    }
    catch (e) {
      V = null;
      if (e instanceof ApiError && e.code === "pin_required") { gateDraw(); return; }
      if (e instanceof ApiError && e.code === "pin_unset") { unsetDraw(); return; }
      setBar(); root.innerHTML = failHTML(e, "Не успяхме да заредим графика. В сайта остава последното публикувано обедно меню."); return;
    }
    boss = V.boss; offlineNote = false;
    if (!mon) readHash(V.today);
    draw(); loadOuts(); loadLog();
  }
  /* today's lunch menu of the site with "Изчерпано днес" (api.menu: the same as the site and the kitchen) */
  async function loadOuts() {
    try {
      const m = await api.menu(), t = V ? V.today : sofiaYmd();
      outToday = PREVIEW || m.lunch.date === t;
      outs = outToday ? m.lunch.items.filter((x) => x.p).map((x) => ({ id: x.id, n: x.n, out: !!x.out })) : [];
    } catch { outs = null; }
    const c = root.querySelector(".ln-out"); if (c) c.outerHTML = outCard();
  }
  let logT: ReturnType<typeof setTimeout> | undefined;
  async function loadLog() {
    if (!can("audit")) return;
    try {
      const [l, staff] = await Promise.all([adminApi.audit({ action: "lunch.", limit: 5 }), can("staff") && !Object.keys(names).length ? adminApi.staff().catch(() => []) : Promise.resolve([])]);
      staff.forEach((u) => { names[u.username] = u.name; });
      log = l as Log[];
    } catch { log = log || null; }
    const c = root.querySelector(".ln-logc"); if (c) c.outerHTML = logCard();
  }
  const logSoon = () => { clearTimeout(logT); logT = setTimeout(loadLog, 400); };

  /* ---------- parts ---------- */
  function after3() {
    const t = now(), m = t.h * 60 + t.m, on = m >= 900 && m < 1350;
    return '<div class="ln-30' + (on ? " now" : "") + '" data-edit-id="admin.lunch.after15"><span class="pct">-30%</span><span>' + (on
      ? "<b>Сега е след 15:00:</b> обедното меню е само за вземане от място, с -30%. Отстъпката се смята сама в количката."
      : "<b>След 15:00</b> обедното меню е само за вземане от място, с -30%. Отстъпката се смята сама; доставка след 15:00 няма.") + "</span></div>";
  }
  function weekBar() {
    const w = week(), a = parts(w[0]), z = parts(w[4]), td = V!.today, def = mondayOf(td), wd = dowOf(td);
    return '<div class="ln-week" data-edit-id="admin.lunch.week"><div class="wk"><button class="hb" type="button" data-wk="-1" aria-label="Назад: предишна седмица">' + ic("caret-left", 20) + "Назад</button><b>" +
      a.d + (a.m !== z.m ? " " + MON[a.m] : "") + " - " + z.d + ' <span class="lm">' + MONTHS[z.m] + '</span><span class="sm">' + MON[z.m] + "</span></b>" +
      '<button class="hb" type="button" data-wk="1" aria-label="Напред: следваща седмица">Напред' + ic("caret-right", 20) + "</button></div>" +
      (mon !== def ? '<button class="pill pill-line" type="button" data-wk="0">' + ic("calendar-blank", 20) + "Към " + (wd === 0 || wd === 6 ? "следващата" : "тази") + " седмица</button>" : "") +
      '<span class="sp"></span></div>';
  }
  function dayTabs() {
    return '<div class="ln-days" role="tablist" aria-label="Дни от седмицата" data-edit-id="admin.lunch.days">' + week().map((d) => {
      const s = statusOf(V!, d), n = ids(d).length;
      return '<button class="ln-dt" type="button" role="tab" id="tab-' + d + '" aria-controls="ln-day" aria-selected="' + (d === cur) + '" tabindex="' + (d === cur ? 0 : -1) + '" data-day="' + d + '"><span class="d">' + DAYN[dowOf(d)] + "</span><b>" + parts(d).d + " " + MON[parts(d).m] + "</b>" +
        (n ? '<span class="c">' + plural(n, "ястие", "ястия") + "</span>" : "") + '<span class="s s-' + s.k + '">' + (s.k === "bad" ? ic("warning", 16) : '<span class="dot"></span>') + s.t + "</span></button>";
    }).join("") + "</div>";
  }
  function itemHTML(x: Item, inDay: boolean) {
    const used = week().filter((d) => ids(d).includes(x.id)).map((d) => DS[dowOf(d)]);
    return '<div class="ln-it' + (inDay ? " in" : "") + '" draggable="' + !inDay + '" data-it="' + x.id + '" title="Влачете към деня или щракнете два пъти"><span class="nm">' + esc(x.n) +
      (used.length ? "<small>тази седмица: " + used.join(", ") + "</small>" : "") + '</span><span class="price">' + fmt(x.p) + "</span>" +
      (inDay ? '<span class="pill" aria-disabled="true">' + ic("check", 18) + "В деня</span>" : '<button class="pill pill-soft" type="button" data-put="' + x.id + '" aria-label="Добави ' + esc(x.n) + " " + vd(cur) + '">' + ic("plus", 18) + "Добави</button>") + "</div>";
  }
  function catalogueHTML(qq = q) {
    const mine = ids(cur), n = norm(qq), list = cat().filter((x) => { const k = norm(x.n + " " + x.group); return !n || n.split(" ").every((p) => k.indexOf(p) > -1); });
    return groups().map((g) => {
      const it = list.filter((x) => x.group === g); if (!it.length) return "";
      return '<div class="ln-gh"><span>' + esc(g) + "</span><span>" + it.length + "</span></div>" + it.map((x) => itemHTML(x, mine.includes(x.id))).join("");
    }).join("") || '<p class="ln-none">Няма ястие с „' + esc(qq) + "“.</p>";
  }
  function catalogue() {
    return '<section class="ln-panel ln-cat" aria-labelledby="h-cat" data-edit-id="admin.lunch.catalogue"><div class="ln-ph"><div><h2 id="h-cat">Ястия</h2><small>' + plural(cat().length, "обедно ястие", "обедни ястия") + " · цени от сайта</small></div>" +
      '<button class="pill pill-line" type="button" data-newdish>' + ic("plus", 20) + "Ново ястие</button></div>" +
      '<div class="ln-search"><div class="sa-field-s"><label class="vh" for="ln-q">Търси обедно ястие</label>' + ic("magnifying-glass", 20) + '<input class="input" id="ln-q" type="search" placeholder="Търси (и на латиница)" autocomplete="off" value="' + esc(q) + '"></div></div>' +
      '<div class="ln-scroll" data-cat>' + catalogueHTML() + '</div><p class="ln-tip">' + ic("info", 18) + "<span>Влачете ястие към деня, щракнете два пъти или „Добави“.</span></p></section>";
  }
  function dayHTML() {
    const list = ids(cur).map(byId).filter((x): x is Item => !!x), c = clashOf(V!.days, cur), prev = addDays(cur, -1), pdow = dowOf(prev), s = statusOf(V!, cur), pb = V!.pub[cur];
    const rows = groups().map((g) => {
      const it = list.filter((x) => x.group === g); if (!it.length) return "";
      return '<div class="ln-gh"><span>' + esc(g) + "</span><span>" + it.length + "</span></div>" + it.map((x) => '<div class="ln-row" data-row="' + x.id + '"><span class="nm">' + esc(x.n) + '</span><span class="price">' + fmt(x.p) + "</span>" +
        '<button class="pill pill-line rm" type="button" data-rm="' + x.id + '" aria-label="Махни ' + esc(x.n) + '">' + ic("x", 18) + "Махни</button></div>").join("");
    }).join("");
    const pbWhen = pb ? (list.length ? "" : " · в сайта остава публикуваното") + " · " + esc(pb.who) + ", " + fmtYmd(sofiaYmd(new Date(pb.at)), true) : "";
    return '<section class="ln-panel ln-day" id="ln-day" role="tabpanel" aria-labelledby="tab-' + cur + '" data-drop data-edit-id="admin.lunch.day">' +
      '<div class="ln-ph"><div><h2>' + dayFull(cur) + "</h2><small>" + (list.length ? plural(list.length, "ястие", "ястия") + " · " : "") + esc(s.t) + pbWhen + "</small></div></div>" +
      (c && s.k !== "pub" && cur >= V!.today ? '<div class="ln-rule">' + banner({ tone: "danger", icon: "warning", title: "Същото меню като " + dayLow(c) + ", " + parts(c).d + " " + MONTHS[parts(c).m] + ".", text: "Едно и също меню не може два поредни дни. Сменете поне едно ястие, за да го публикувате." }) + "</div>" : "") +
      '<div class="ln-dl" data-dl>' + rows + "</div>" +
      (list.length ? "" : '<div class="ln-dz">' + ic("bowl-food", 32) + "<span>Денят е празен. Пуснете тук ястие от списъка" + (pdow >= 1 && pdow <= 5 && ids(prev).length ? " или започнете от менюто за " + DAYN[pdow].toLowerCase() : "") + ".</span></div>") +
      '<div class="ln-acts"><button class="pill pill-line add" type="button" data-pick>' + ic("plus", 20) + "Добави ястия</button>" +
      (pdow >= 1 && pdow <= 5 ? '<button class="pill pill-line" type="button" data-copy' + (ids(prev).length ? "" : " disabled") + ">" + ic("copy", 20) + "Копирай от " + DS[pdow] + "</button>" : "") +
      '<button class="pill pill-line" type="button" data-fav' + (list.length ? "" : " disabled") + ">" + ic("heart", 20) + "Запази като любима</button>" +
      (list.length ? '<button class="pill pill-line" type="button" data-clear>' + ic("trash", 20) + "Изчисти деня</button>" : "") + "</div></section>";
  }
  function favs() {
    const f = V!.favs || [];
    return '<section class="ln-card" aria-labelledby="h-fav" data-edit-id="admin.lunch.favs"><h3 id="h-fav">' + ic("heart", 22) + "Любими комбинации</h3>" +
      (f.length ? f.map((x) => '<div class="ln-fav"><b>' + esc(x.n) + "</b><small>" + plural(x.ids.length, "ястие", "ястия") + (x.id === "f-site" ? " · от сайта" : "") + "</small>" +
        '<button class="pill pill-line" type="button" data-usefav="' + esc(x.id) + '" aria-label="Сложи „' + esc(x.n) + "“ " + vd(cur) + '">' + ic("arrow-right", 18) + vd(cur, true) + "</button></div>").join("")
        : '<p class="muted">Запазете ден като любим, за да го ползвате пак с едно натискане.</p>') + "</section>";
  }
  function pinCard() {
    if (!boss) return '<section class="ln-card" aria-labelledby="h-pin" data-edit-id="admin.lunch.pin"><h3 id="h-pin">' + ic("lock", 22) + "Отключено с ПИН</h3><p class=\"muted\">Промените се записват в дневника с вашето име и „с ПИН“. Графикът се заключва сам след 15 минути без промени.</p>" +
      '<button class="pill pill-line" type="button" data-lock>' + ic("lock", 20) + "Заключи</button></section>";
    const set = V!.pinSet;
    return '<section class="ln-card" aria-labelledby="h-pin" data-edit-id="admin.lunch.pin"><h3 id="h-pin">' + ic("lock", 22) + "ПИН за персонала</h3><p class=\"muted\">Друг служител отваря графика с ПИН от 4 цифри. ПИН-ът се вижда само веднъж, когато го зададете; после само се сменя.</p>" +
      '<div class="ln-pin">' + (set ? '<span class="sa-tag ln-set">' + ic("check", 16) + "ПИН е зададен</span>" : '<span class="sa-tag ln-unset">' + ic("warning", 16) + "ПИН още не е зададен</span>") +
      '<button class="pill pill-ink" type="button" data-setpin>' + ic("pencil-simple", 20) + (set ? "Смени ПИН" : "Задай ПИН") + "</button></div></section>";
  }
  function logText(e: Log): string {
    const d = (e.data && typeof e.data === "object" ? e.data : {}) as Record<string, unknown>, t = e.target || "", day = (x: string) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? fmtYmd(x, true) : x);
    const pin = d.pin ? " (с ПИН)" : "";
    switch (e.action) {
      case "lunch.update": return (d.n ? "График за " + day(t) + ": " + plural(Number(d.n), "ястие", "ястия") : "Изчистен ден: " + day(t)) + pin;
      case "lunch.publish": return "Публикувано в сайта: " + (Array.isArray(d.days) ? d.days.map((x) => DS[dowOf(String(x))]).join(", ") : t) + pin;
      case "lunch.fav": return "Нова любима комбинация: „" + t + "“" + pin;
      case "lunch.fav_remove": return "Махната любима комбинация" + pin;
      case "lunch.dish": return "Ново обедно ястие: „" + String(d.n || (byId(t) || { n: t }).n) + "“" + (typeof d.p === "number" ? " (" + fmt(d.p) + ")" : "") + pin;
      case "lunch.pin": return d.changed === false ? "ПИН за обедното меню е зададен" : "ПИН за обедното меню е сменен";
      case "lunch.unlock": return "Графикът е отключен с ПИН";
      case "lunch.pin_fail": return "Грешен ПИН за обедното меню";
      default: return "Обедно меню: промяна";
    }
  }
  function logCard() {
    const list = can("audit") && log && log.length ? '<ul class="ln-log">' + log.map((e) => "<li><span>" + esc(logText(e)) + "</span><small>" + esc(names[e.actor] || e.actor) + " · " + esc(ago(e.at)) + "</small></li>").join("") + "</ul>"
      : '<p class="muted">Всяка промяна в графика се записва в дневника: кой, кога и какво.</p>';
    return '<section class="ln-card ln-logc" aria-labelledby="h-log" data-edit-id="admin.lunch.log"><h3 id="h-log">' + ic("list-bullets", 22) + "Дневник</h3>" + list +
      (can("audit") ? '<a class="link" href="' + aurl.section("audit") + '">Целият дневник' + ic("caret-right", 18) + "</a>" : "") +
      '<div class="ln-g"><b>' + ic("google-logo", 20) + "Публикация в Google профила</b>" + soonTag() + "</div></section>";
  }
  function outCard() {
    const n = (outs || []).filter((x) => x.out).length;
    const inner = outs == null ? '<p class="muted">Не успяхме да заредим днешното меню. ' + '<button class="link" type="button" data-outs-retry>Опитай пак</button></p>'
      : !outs.length ? '<p class="muted">Днес няма публикувано обедно меню в сайта. Ключовете се появяват за ястията на днешния публикуван ден.</p>'
      : '<div class="ln-og">' + outs.map((x) => '<label class="ln-orow' + (x.out ? " on" : "") + '"><span class="nm"><span>' + esc(x.n) + "</span>" + (x.out ? "<small>Изчерпано днес</small>" : "") + "</span>" +
        '<span class="sa-switch"><input type="checkbox" role="switch" data-lout="' + x.id + '" aria-label="Изчерпано днес: ' + esc(x.n) + '"' + (x.out ? " checked" : "") + '><span class="tr"></span></span></label>').join("") + "</div>";
    return '<section class="ln-out" aria-labelledby="h-lout" data-edit-id="admin.lunch.soldout"><h3 id="h-lout">' + ic("clock", 22) + "Изчерпано днес" + (n ? " · " + n : "") + "</h3>" +
      (outs && outs.length ? '<p class="muted">Днешното обедно меню в сайта. Изчерпаното остава видимо с „Изчерпано днес“ и без „+“, до полунощ.</p>' : "") + inner + "</section>";
  }
  function gate(msg = "") {
    return '<section class="sa-card ln-gate" data-edit-id="admin.lunch.gate"><div class="ill">' + ic("lock", 40) + "</div><h2>Графикът е заключен</h2><p>Въведете ПИН от 4 цифри. Ако го нямате, попитайте управителя.</p>" +
      '<div class="ln-dots" data-dots aria-hidden="true"><span></span><span></span><span></span><span></span></div><label class="vh" for="ln-pin">ПИН от 4 цифри</label><input class="vh" id="ln-pin" inputmode="numeric" autocomplete="off" maxlength="4">' +
      '<p class="err" role="alert" data-perr>' + esc(msg) + '</p><div class="ln-keys">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<button type="button" data-k="' + n + '">' + n + "</button>").join("") +
      '<button class="w" type="button" data-k="del">Изтрий</button><button type="button" data-k="0">0</button><button class="w" type="button" data-k="ok">Отключи</button></div></section>';
  }

  /* ---------- drawing ---------- */
  let bar: HTMLElement | null = null;
  function draw(keep = false) {
    if (!V) return;
    const y = A.scroller ? A.scroller.scrollTop : 0;
    root.innerHTML = (offlineNote ? offline("Показваме последно заредения график. Промените и публикуването чакат връзката.") + '<div style="height:16px"></div>' : "") +
      after3() + weekBar() + dayTabs() + '<div class="ln-board">' + catalogue() + dayHTML() + "</div>" +
      outCard() + '<div class="ln-low">' + favs() + pinCard() + logCard() + '</div><div class="ln-pad"></div>';
    if (keep && A.scroller) A.scroller.scrollTop = y;
    tabIntoView(); bindDnD(); setBar();
  }
  /** the selected day tile in view (the phone scrolls the tiles sideways) */
  function tabIntoView() {
    const t = root.querySelector<HTMLElement>('.ln-dt[aria-selected="true"]'), p = t && t.parentElement; if (!t || !p || p.scrollWidth <= p.clientWidth) return;
    const l = t.offsetLeft - p.offsetLeft, r = l + t.offsetWidth;
    if (l < p.scrollLeft || r > p.scrollLeft + p.clientWidth) p.scrollLeft = Math.max(0, l - (p.clientWidth - t.offsetWidth) / 2);
  }
  /** redraws the tabs, the day, the catalogue and the cards below; keeps the scroll and the focus */
  function redrawDay() {
    const b = root.querySelector(".ln-board"); if (!b || !V) { draw(true); return; }
    const y = A.scroller ? A.scroller.scrollTop : 0, a = document.activeElement as HTMLElement | null;
    const keyOf = (el: HTMLElement | null): [string, number] | null => {
      if (!el || !root.contains(el)) return null;
      for (const k of ["data-put", "data-rm", "data-day", "data-usefav"]) if (el.hasAttribute(k)) return [k, Array.from(root.querySelectorAll("[" + k + "]")).indexOf(el)];
      return el.id === "ln-q" ? ["id", 0] : null;
    };
    const fk = keyOf(a);
    const sl = root.querySelector(".ln-days")!.scrollLeft;
    root.querySelector(".ln-days")!.outerHTML = dayTabs();
    root.querySelector(".ln-days")!.scrollLeft = sl; tabIntoView();
    root.querySelector(".ln-day")!.outerHTML = dayHTML();
    const c = root.querySelector("[data-cat]"); if (c) c.innerHTML = catalogueHTML();
    root.querySelector(".ln-low")!.innerHTML = favs() + pinCard() + logCard();
    if (A.scroller) A.scroller.scrollTop = y;
    if (fk) {
      const el = fk[0] === "id" ? root.querySelector<HTMLElement>("#ln-q") : (Array.from(root.querySelectorAll<HTMLElement>("[" + fk[0] + "]"))[fk[0] === "data-day" ? week().indexOf(cur) : Math.max(0, fk[1])] || root.querySelector<HTMLElement>("#ln-day h2"));
      if (el) { if (el.tagName === "H2") el.setAttribute("tabindex", "-1"); el.focus({ preventScroll: true }); }
    }
    bindDnD(); setBar();
  }
  const pending = () => (V ? week().filter((d) => statusOf(V!, d).k === "draft" || statusOf(V!, d).k === "bad") : []);
  function setBar() {
    if (!bar) {
      bar = document.createElement("div"); bar.className = "ln-pub"; bar.setAttribute("data-pbar", ""); bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Публикуване"); bar.setAttribute("data-edit-id", "admin.lunch.pubbar");
      A.col!.appendChild(bar);
      bar.addEventListener("click", (e) => { if ((e.target as HTMLElement).closest("[data-publish]")) publish(); });
    }
    const n = pending().length, show = !!V && n > 0;
    bar.hidden = !show; bar.classList.toggle("on", show);
    if (show) bar.innerHTML = '<span class="tx">' + (n === 1 ? "1 ден чака публикуване" : n + " дни чакат публикуване") + (DEMO ? "<small>В демото сайтът не се пресглобява</small>" : "") + "</span>" +
      '<button class="pill pill-red" type="button" data-publish' + (busy ? " disabled" : "") + ">" + ic("paper-plane-right", 20) + "Публикувай</button>";
  }

  /* ---------- changes: at once on the screen, then saved (the core writes the log) ---------- */
  let inFlight = 0;
  async function change(day: string, next: string[], text: string, undoable = true) {
    if (!V) return;
    const prev = ids(day).slice();
    if (next.length) V.days[day] = next; else delete V.days[day];
    redrawDay();
    inFlight++;
    try {
      const v = await lunchApi.saveDay(day, next);
      if (--inFlight === 0 && V) { V = v; redrawDay(); }
      logSoon();
      if (undoable) toast(text, { undo: () => change(day, prev, "Отменено: " + text, false) });
      else toast(text);
    } catch (e) {
      inFlight = Math.max(0, inFlight - 1);
      if (V) { if (prev.length) V.days[day] = prev; else delete V.days[day]; }
      if (isPin(e)) { relock(e); return; }
      redrawDay();
      toast(isOff(e) ? "Няма връзка. Промяната не е запазена: опитайте пак, щом интернетът се върне." : (e as Error).message || "Не успяхме да запазим. Опитайте пак.");
    }
  }
  function addTo(day: string, id: string) {
    const x = byId(id); if (!x) return;
    if (ids(day).includes(id)) { toast("„" + x.n + "“ вече е " + vd(day) + "."); return; }
    change(day, ids(day).concat([id]), "Добавено " + vd(day) + ": " + x.n);
  }
  /** the schedule closed (15 minutes without a change, or a new PIN): back to the PIN */
  function relock(e: unknown) {
    V = null; setBar();
    if (e instanceof ApiError && e.code === "pin_unset") { unsetDraw(); return; }
    gateDraw("Графикът се заключи. Въведете ПИН пак.");
  }

  /* ---------- clicks ---------- */
  root.addEventListener("click", (e) => {
    const tg = e.target as HTMLElement; let t: HTMLElement | null;
    if (tg.closest("[data-outs-retry]")) { loadOuts(); return; }
    if (!V) return;
    if ((t = tg.closest("[data-wk]"))) { const k = +t.dataset.wk!; mon = k === 0 ? mondayOf(V.today) : addDays(mon, 7 * k); cur = V.today >= mon && V.today <= addDays(mon, 4) ? V.today : mon; sync(); draw(); return; }
    if ((t = tg.closest("[data-day]"))) { cur = t.dataset.day!; sync(); redrawDay(); return; }
    if ((t = tg.closest("[data-put]"))) { addTo(cur, t.dataset.put!); return; }
    if ((t = tg.closest("[data-rm]"))) { const id = t.dataset.rm!, x = byId(id); change(cur, ids(cur).filter((z) => z !== id), "Махнато от " + DS[dowOf(cur)] + ": " + (x ? x.n : id)); return; }
    if (tg.closest("[data-copy]")) { const p = addDays(cur, -1); change(cur, ids(p).slice(), "Копирано от " + DS[dowOf(p)] + " " + vd(cur)); return; }
    if (tg.closest("[data-clear]")) { change(cur, [], "Денят е изчистен: " + DS[dowOf(cur)]); return; }
    if ((t = tg.closest("[data-usefav]"))) { const f = V.favs.find((z) => z.id === t!.dataset.usefav); if (f) change(cur, f.ids.filter((id) => !!byId(id)), "„" + f.n + "“ " + vd(cur)); return; }
    if (tg.closest("[data-fav]")) { favSheet(); return; }
    if (tg.closest("[data-pick]")) { pickSheet(); return; }
    if (tg.closest("[data-newdish]")) { dishSheet(); return; }
    if (tg.closest("[data-setpin]")) { pinSheet(); return; }
    if (tg.closest("[data-lock]")) { lockNow(); return; }
  });
  /* the day tabs: arrows move between the days (role=tablist) */
  root.addEventListener("keydown", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-day]"); if (!t || !V) return;
    const w = week(), i = w.indexOf(t.dataset.day!), j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : e.key === "Home" ? 0 : e.key === "End" ? 4 : -9;
    if (j === -9) return; e.preventDefault(); cur = w[Math.max(0, Math.min(4, j))]; sync(); redrawDay();
  });
  root.addEventListener("dblclick", (e) => { const tg = e.target as HTMLElement, t = tg.closest<HTMLElement>("[data-it]"); if (t && !t.classList.contains("in") && !tg.closest("button")) addTo(cur, t.dataset.it!); });
  root.addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.id === "ln-q") { q = t.value; const c = root.querySelector("[data-cat]"); if (c) c.innerHTML = catalogueHTML(); bindDnD(); } });
  /* "Изчерпано днес" (the same switch as the menu and the kitchen; the core writes menu.sold_out / menu.back) */
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement; if (!t.matches("[data-lout]") || !outs) return;
    const id = t.dataset.lout!, on = t.checked, x = outs.find((z) => z.id === id); if (!x) return;
    const redraw = () => { const c = root.querySelector(".ln-out"); if (c) { c.outerHTML = outCard(); root.querySelector<HTMLElement>('[data-lout="' + id + '"]')?.focus({ preventScroll: true }); } };
    const set = async (v: boolean, undo: boolean) => {
      x.out = v; redraw();
      try {
        await adminApi.setSoldOut(id, v);
        if (undo) toast((v ? "Изчерпано днес: " : "Отново в менюто: ") + x.n, { undo: () => set(!v, false), undoLabel: v ? "Върни" : "Отмени" });
        else toast(v ? "Изчерпано днес: " + x.n : "Отново в менюто: " + x.n);
      } catch (er) { x.out = !v; redraw(); toast(isOff(er) ? "Няма връзка. Не е записано: опитайте пак." : (er as Error).message); }
    };
    set(on, true);
  });

  /* ---------- drag (mouse); on the phone and with the keyboard: "Добави" ---------- */
  function bindDnD() {
    root.querySelectorAll<HTMLElement>('.ln-it[draggable="true"]').forEach((it) => {
      it.addEventListener("dragstart", (e) => { e.dataTransfer!.setData("text/plain", it.dataset.it!); e.dataTransfer!.effectAllowed = "copy"; it.classList.add("dragging"); });
      it.addEventListener("dragend", () => { it.classList.remove("dragging"); root.querySelectorAll(".drop").forEach((z) => z.classList.remove("drop")); });
    });
    root.querySelectorAll<HTMLElement>("[data-drop], .ln-dt").forEach((z) => {
      z.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer!.dropEffect = "copy"; z.classList.add("drop"); });
      z.addEventListener("dragleave", (e) => { if (!z.contains(e.relatedTarget as Node)) z.classList.remove("drop"); });
      z.addEventListener("drop", (e) => { e.preventDefault(); z.classList.remove("drop"); const id = e.dataTransfer!.getData("text/plain"); if (!byId(id)) return; addTo(z.dataset.day || cur, id); });
    });
  }

  /* ---------- "Публикувай" ---------- */
  async function publish() {
    if (!V || busy) return;
    const w = week().filter((d) => ids(d).length && d >= V!.today), bad = w.filter((d) => statusOf(V!, d).k === "bad");
    if (!w.length) { toast("Седмицата е празна. Добавете ястия в поне един ден."); return; }
    if (bad.length) {
      if (!bad.includes(cur)) { cur = bad[0]; sync(); redrawDay(); }
      toast("Не е публикувано: " + bad.map((d) => DS[dowOf(d)]).join(" и ") + " повтаря съседен ден.");
      root.querySelector(".ln-rule")?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    const todo = w.filter((d) => statusOf(V!, d).k === "draft");
    if (!todo.length) { toast("Всичко от седмицата вече е публикувано."); return; }
    busy++; setBar();
    try {
      V = await lunchApi.publish(todo);
      const list = todo.map((d) => DS[dowOf(d)]).join(", "), today = todo.includes(V.today);
      redrawDay(); logSoon(); if (today) loadOuts();
      const txt = DEMO ? "Публикувано: " + list + ". В демото сайтът не се пресглобява." : "Публикувано: " + list + ". " + (today ? "Сайтът се пресглобява сам." : "Стига до сайта в своя ден.");
      toast(txt, can("site") ? { action: { label: "Виж в сайта", href: aurl.preview("m=site&p=lunch&d=phone") }, ms: 7000 } : { ms: 7000 });
    } catch (e) {
      if (isPin(e)) { busy = 0; relock(e); return; }
      if (e instanceof ApiError && e.code === "same_menu" && e.fields) { const d = Object.keys(e.fields)[0]; if (d && d >= mon && d <= addDays(mon, 4)) { cur = d; sync(); redrawDay(); } }
      toast(isOff(e) ? "Няма връзка. Публикуването чака: опитайте пак, щом интернетът се върне." : "Не е публикувано. " + (e as Error).message);
    } finally { busy = Math.max(0, busy - 1); setBar(); }
  }

  /* ---------- sheets ---------- */
  function pickSheet() {
    let qq = "";
    const s = sheet({ title: "Добави " + dayLow(cur), html: '<div class="sa-field-s" style="margin:4px 0 8px"><label class="vh" for="ln-q2">Търси обедно ястие</label>' + ic("magnifying-glass", 20) + '<input class="input" id="ln-q2" type="search" placeholder="Търси (и на латиница)" autocomplete="off"></div><div data-list></div>',
      foot: '<button class="pill pill-line pill-lg" type="button" data-newdish2>' + ic("plus", 20) + 'Ново ястие</button><button class="pill pill-ink pill-lg" type="button" data-done>' + ic("check", 22) + "Готово</button>" });
    const box = s.body.querySelector<HTMLElement>("[data-list]")!, inp = s.body.querySelector<HTMLInputElement>("#ln-q2")!;
    const fill = () => { box.innerHTML = catalogueHTML(qq); };
    fill(); inp.addEventListener("input", () => { qq = inp.value; fill(); });
    box.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-put]"); if (!t) return;
      const i = Array.from(box.querySelectorAll("[data-put]")).indexOf(t);
      addTo(cur, t.dataset.put!); fill();
      const nx = box.querySelectorAll<HTMLElement>("[data-put]"); (nx[Math.min(i, nx.length - 1)] || inp).focus({ preventScroll: true });
    });
    s.foot!.querySelector<HTMLButtonElement>("[data-done]")!.onclick = s.close;
    s.foot!.querySelector<HTMLButtonElement>("[data-newdish2]")!.onclick = () => { s.close(); setTimeout(dishSheet, 200); };
  }
  function favSheet() {
    const s = sheet({ title: "Запази като любима", focus: "#ln-fn", html: '<div class="field"><label for="ln-fn">Име на комбинацията</label><input class="input" id="ln-fn" maxlength="60" value="' + esc(dayFull(cur)) + '" aria-describedby="ln-fn-e"><span class="err" id="ln-fn-e" hidden></span></div>' +
      '<p class="muted" style="margin:12px 0 0">' + plural(ids(cur).length, "ястие", "ястия") + ". Слага се във всеки ден с едно натискане.</p>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("heart", 22) + "Запази</button>" });
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const ok = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    ok.onclick = async () => {
      const i = s.body.querySelector<HTMLInputElement>("#ln-fn")!, n = i.value.trim(), er = s.body.querySelector<HTMLElement>("#ln-fn-e")!;
      const fail = (m: string) => { i.setAttribute("aria-invalid", "true"); er.hidden = false; er.textContent = m; i.focus(); };
      if (n.length < 2) { fail("Напишете име, например „Лек понеделник“."); return; }
      ok.disabled = true;
      try {
        const before = new Set(V!.favs.map((f) => f.id));
        V = await lunchApi.saveFav({ n, ids: ids(cur).slice() });
        const nf = V.favs.find((f) => !before.has(f.id));
        s.close(); redrawDay(); logSoon();
        toast("Запазено в любими: " + n, nf ? { undo: async () => { try { V = await lunchApi.removeFav(nf.id); redrawDay(); logSoon(); } catch (e) { if (isPin(e)) relock(e); else toast((e as Error).message); } } } : {});
      } catch (e) {
        ok.disabled = false;
        if (isPin(e)) { s.close(); relock(e); return; }
        fail(isOff(e) ? "Няма връзка. Опитайте пак." : (e instanceof ApiError && e.fields && (e.fields.n || e.fields.ids)) || (e as Error).message);
      }
    };
  }
  function dishSheet() {
    const s = sheet({ title: "Ново обедно ястие", focus: "#ld-n", html: '<form class="ln-form" novalidate style="display:grid; gap:16px">' +
      '<div class="field"><label for="ld-n">Име</label><input class="input" id="ld-n" autocomplete="off" maxlength="120" aria-describedby="ld-n-e"><span class="err" id="ld-n-e" hidden></span></div>' +
      '<div class="field"><label for="ld-g">Група</label><select class="input" id="ld-g">' + groups().map((g) => "<option>" + esc(g) + "</option>").join("") + "</select></div>" +
      '<div class="field"><label for="ld-p">Цена в евро</label><input class="input" id="ld-p" inputmode="decimal" autocomplete="off" placeholder="4,70" aria-describedby="ld-p-e"><span class="err" id="ld-p-e" hidden></span></div>' +
      '<p class="muted" style="margin:0; font-size:15px">Грамаж, състав и алергени: ' + missing("от кухнята") + ". Ястието отива в списъка вляво и се слага във всеки ден.</p></form>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("plus", 22) + "Добави ястието</button>" });
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const ok = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    s.body.querySelector("form")!.addEventListener("submit", (e) => { e.preventDefault(); ok.click(); });
    ok.onclick = async () => {
      const b = s.body, n = b.querySelector<HTMLInputElement>("#ld-n")!, p = b.querySelector<HTMLInputElement>("#ld-p")!, v = String(p.value).replace(/\s/g, "").replace(",", ".");
      const er = (i: HTMLInputElement, id: string, m: string) => { const el = b.querySelector<HTMLElement>(id)!; if (m) { i.setAttribute("aria-invalid", "true"); el.hidden = false; el.textContent = m; } else { i.removeAttribute("aria-invalid"); el.hidden = true; } return !m; };
      const ok1 = er(n, "#ld-n-e", n.value.trim().length < 2 ? "Напишете името на ястието." : ""), ok2 = er(p, "#ld-p-e", !/^\d{1,3}(\.\d{1,2})?$/.test(v) || +v <= 0 ? "Напишете цена като 4,70." : "");
      if (!ok1) { n.focus(); return; } if (!ok2) { p.focus(); return; }
      ok.disabled = true;
      try {
        const r = await lunchApi.addDish({ n: n.value.trim(), group: b.querySelector<HTMLSelectElement>("#ld-g")!.value, p: +v });
        V = r; const x = byId(r.id);
        s.close(); redrawDay(); logSoon();
        toast("Добавено в списъка: " + (x ? x.n : n.value.trim()), { action: { label: vd(cur, true), fn: () => addTo(cur, r.id) } });
      } catch (e) {
        ok.disabled = false;
        if (isPin(e)) { s.close(); relock(e); return; }
        const f = e instanceof ApiError && e.fields ? e.fields : {};
        if (f.n) { er(n, "#ld-n-e", f.n); n.focus(); } else if (f.p) { er(p, "#ld-p-e", f.p); p.focus(); }
        else toast(isOff(e) ? "Няма връзка. Ястието не е добавено: опитайте пак." : (e as Error).message);
      }
    };
  }
  /* "Смени ПИН": 4 digits twice; the new PIN is shown ONCE after it is saved (only its hash is kept), never again */
  function pinSheet() {
    const set = !!V && V.pinSet;
    const s = sheet({ title: set ? "Смени ПИН" : "Задай ПИН", focus: "#lp-1", html: '<div class="ln-pinform"><p class="muted" style="margin:0">4 цифри. Кажете новия ПИН на служителите, които сменят графика.' + (set ? " Старият спира да важи веднага." : "") + "</p>" +
      '<div class="field"><label for="lp-1">Нов ПИН</label><input class="input" id="lp-1" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" aria-describedby="lp-1-e"><span class="err" id="lp-1-e" hidden></span></div>' +
      '<div class="field"><label for="lp-2">Повторете ПИН</label><input class="input" id="lp-2" type="password" inputmode="numeric" maxlength="4" autocomplete="new-password" aria-describedby="lp-2-e"><span class="err" id="lp-2-e" hidden></span></div></div>',
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Запази ПИН</button>" });
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const ok = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    s.body.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") { e.preventDefault(); ok.click(); } });
    ok.onclick = async () => {
      const a = s.body.querySelector<HTMLInputElement>("#lp-1")!, b = s.body.querySelector<HTMLInputElement>("#lp-2")!;
      const er = (i: HTMLInputElement, m: string) => { const el = s.body.querySelector<HTMLElement>("#" + i.id + "-e")!; if (m) { i.setAttribute("aria-invalid", "true"); el.hidden = false; el.textContent = m; } else { i.removeAttribute("aria-invalid"); el.hidden = true; } return !m; };
      if (!er(a, /^\d{4}$/.test(a.value) ? "" : "ПИН-ът е точно 4 цифри.")) { a.focus(); return; }
      if (!er(b, b.value === a.value ? "" : "Двата ПИН-а не са еднакви.")) { b.focus(); return; }
      ok.disabled = true;
      try {
        const r = await lunchApi.setPin(a.value);
        if (V) V.pinSet = true;
        redrawDay(); logSoon();
        s.body.innerHTML = '<div class="ln-newpin" role="status"><span class="sa-tag ok">' + ic("check", 16) + 'Новият ПИН е запазен</span><p class="code">' + esc(r.pin) + '</p><p class="muted" style="margin:0">Кажете го на служителите, които сменят графика. След като затворите, ПИН-ът не се показва повече.</p></div>';
        s.foot!.innerHTML = '<button class="pill pill-ink pill-lg" type="button" data-done>' + ic("check", 22) + "Готово</button>";
        const d = s.foot!.querySelector<HTMLButtonElement>("[data-done]")!; d.onclick = s.close; d.focus();
      } catch (e) {
        ok.disabled = false;
        const m = e instanceof ApiError && e.fields && e.fields.pin ? e.fields.pin : isOff(e) ? "Няма връзка. ПИН-ът не е сменен." : (e as Error).message;
        er(a, m); a.focus();
      }
    };
  }

  /* ---------- the PIN for another staff member ---------- */
  let tick: ReturnType<typeof setInterval> | undefined;
  function gateDraw(msg = "") {
    clearInterval(tick); boss = false; setBar();
    root.innerHTML = gate(msg);
    const inp = root.querySelector<HTMLInputElement>("#ln-pin")!, dots = root.querySelector<HTMLElement>("[data-dots]")!, errEl = root.querySelector<HTMLElement>("[data-perr]")!;
    const keys = () => root.querySelectorAll<HTMLButtonElement>(".ln-keys button");
    let v = "", sending = false;
    const paint = () => dots.querySelectorAll("span").forEach((s, i) => s.classList.toggle("on", i < v.length));
    const mmss = (s: number) => Math.floor(s / 60) + ":" + pad(s % 60);
    function wait(sec: number) {
      let left = Math.max(1, Math.round(sec));
      keys().forEach((b) => { b.disabled = true; });
      const show = () => { errEl.innerHTML = "Твърде много грешни опити.<span class=\"left\">Опитайте пак след " + mmss(left) + " мин.</span>"; };
      show(); clearInterval(tick);
      tick = setInterval(() => { left--; if (left <= 0) { clearInterval(tick); errEl.textContent = "Можете да опитате пак."; keys().forEach((b) => { b.disabled = false; }); root.querySelector<HTMLButtonElement>('[data-k="1"]')?.focus(); } else show(); }, 1000);
    }
    async function key(k: string) {
      if (sending) return;
      if (!/^\d$|^del$|^ok$/.test(k)) return;
      if (k !== "ok") { errEl.textContent = ""; dots.classList.remove("bad"); }
      if (k === "del") { v = v.slice(0, -1); paint(); return; }
      if (k === "ok") {
        if (v.length < 4) { errEl.textContent = "ПИН-ът е 4 цифри."; return; }
        sending = true;
        try {
          await lunchApi.unlock(v);
          clearInterval(tick); root.innerHTML = skel(5, "Отключваме графика …");
          await load();
          if (V) toast("Отключено. Промените влизат в дневника с вашето име.");
        } catch (e) {
          v = ""; paint(); dots.classList.add("bad");
          if (e instanceof ApiError && e.status === 429) wait(e.retryIn || 900);
          else if (e instanceof ApiError && e.code === "bad_pin") errEl.innerHTML = esc(e.message) + (e.left ? '<span class="left">' + (e.left === 1 ? "Остава 1 опит" : "Остават " + e.left + " опита") + " преди заключване за 15 минути.</span>" : "");
          else if (e instanceof ApiError && e.code === "pin_unset") unsetDraw();
          else errEl.textContent = isOff(e) ? "Няма връзка. Опитайте пак." : (e as Error).message;
        } finally { sending = false; }
        return;
      }
      if (v.length < 4) { v += k; paint(); if (v.length === 4) key("ok"); }
    }
    root.querySelector(".ln-keys")!.addEventListener("click", (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>("[data-k]"); if (b) key(b.dataset.k!); });
    root.querySelector(".ln-gate")!.addEventListener("keydown", (e) => {
      const ke = e as KeyboardEvent; if (ke.target === inp) return;
      if (/^\d$/.test(ke.key)) { ke.preventDefault(); key(ke.key); } else if (ke.key === "Backspace") { ke.preventDefault(); key("del"); } else if (ke.key === "Enter" && !(ke.target as HTMLElement).closest("button")) { ke.preventDefault(); key("ok"); }
    });
    inp.addEventListener("input", () => { const d = inp.value.replace(/\D/g, ""); inp.value = ""; d.split("").forEach((c) => key(c)); });
  }
  function unsetDraw() {
    clearInterval(tick); setBar();
    root.innerHTML = '<section class="sa-card ln-gate" data-edit-id="admin.lunch.gate"><div class="ill">' + ic("lock", 40) + "</div><h2>ПИН още не е зададен</h2><p>Графикът се отваря с ПИН от 4 цифри. Помолете управителя или собственика да го зададе в „Обедно меню“.</p>" +
      '<button class="pill pill-line pill-lg" type="button" data-sa="retry">' + ic("arrow-counter-clockwise", 20) + "Опитай пак</button></section>";
  }
  async function lockNow() {
    try { await lunchApi.lock(); } catch (e) { if (isOff(e)) { toast("Няма връзка. Графикът се заключва сам след 15 минути."); return; } }
    V = null; gateDraw(); toast("Графикът е заключен.");
  }

  /* a link to another week or day (#w=..&d=..) on this page */
  addEventListener("hashchange", () => { if (V) { readHash(V.today); draw(); } });
  /* the connection: a calm note, and the schedule again when it is back */
  addEventListener("offline", () => { if (V) { offlineNote = true; draw(true); } });
  addEventListener("online", () => { if (V && offlineNote) { offlineNote = false; load(); } });
  /* the hour turns 15:00: the note changes */
  document.addEventListener("sc:tick", () => { const n = root.querySelector(".ln-30"); if (n) n.outerHTML = after3(); });

  await load();
}

