/* /admin/: the dashboard (design/pages-admin/dashboard.html, version 4, 1:1), from adminApi.summary():
   "Чака те" first (only what the role sees, each with its count and a button straight to the action; empty: "Нищо не чака.
   Всичко е наред."), then "Днес" (for the owner and the main admin first "Днес: X € от N поръчки"; "Примерни данни" only if
   the sales say so), "Модулите" (Управител and Собственик "Скоро"; "Отвори на живо" -> /admin/preview/#m=...), "Разделите" by
   groups (each section to its own address). A new online order redraws everything from one place. */
import "sc-icons:wallet,receipt,calendar-check,clock,pencil-simple,eye,warning-circle,check-circle,caret-right,arrow-up-right,info";
import { statusHTML } from "../lib/chrome-core.ts";
import { events } from "../lib/events.ts";
import { ZONES, RESTAURANT } from "../lib/consts.ts";
import { TABLES } from "../lib/tables.ts";
import { api } from "../client/api.ts";
import { adminApi } from "../client/api-admin.ts";
import type { Summary } from "../core/index.ts";
import { A, mount, can, isMainAdmin, modCan, loadSummary, markFresh, skel, failHTML, offline, soonTag, ic, esc, fmt, plural, MODULES, GROUPS, SEC, ROLES, secHref, sofiaToday, sofiaHM, hm, fmtYmd, dateLong, type Mod } from "./a.ts";
import { aurl } from "./routes.ts";

export async function initDashboard(): Promise<void> {
  const t = sofiaHM(), h = t.h;
  const hello = h >= 5 && h < 12 ? "Добро утро" : h >= 12 && h < 18 ? "Добър ден" : "Добър вечер";
  /* by the real hour in Sofia (never the preview clock of the site) */
  const st = statusHTML(t);
  /* the body is drawn after the session is known (the name is part of the title) */
  const body = await mount({ section: "dashboard", title: hello, eyebrow: "Днес · " + dateLong(sofiaToday()) + " · " + hm(t), docTitle: "Табло",
    sub: '<span class="db-st" data-edit-id="admin.dashboard.status">' + st + "</span>" });
  if (!body || !A.me) return;
  const me = A.me;
  /* "Добър вечер, Поли": the first name; an account named like its role ("Главен админ") keeps the whole name */
  const nm = me.user.name === (ROLES[me.user.role] && ROLES[me.user.role].n) ? me.user.name : me.user.name.split(" ")[0];
  const h1 = document.querySelector(".sa-h1"); if (h1) h1.textContent = hello + ", " + nm;
  const site = MODULES.find((m) => m.id === "site")!;
  if (modCan(site)) {
    const head = document.querySelector(".sa-head");
    head?.insertAdjacentHTML("beforeend", '<div class="sa-acts"><a class="pill pill-ink pill-lg" href="' + aurl.preview("m=site&p=home&d=phone") + '">' + ic("eye", 22) + "Сайтът на живо</a></div>");
  }
  const menuN = +(document.documentElement.dataset.menuN || 0), lunchDate = document.documentElement.dataset.lunchDate || "";

  let sum: Summary | null = null, fail: unknown = null, outNames: string[] | null = null, eta = "";
  const draw = () => { body.innerHTML = html(); markFresh(); };
  draw(); /* the skeleton while the numbers come */

  function html(): string {
    const loading = !sum && !fail;
    const off = !!fail && (fail as { code?: string }).code === "offline";
    const w = sum ? sum.waiting : null, td = sum ? sum.today : null;
    const SAMPLE = '<span class="sa-tag sample">' + ic("info", 16) + '<span class="lg">Примерни данни</span><span class="sm">Примерно</span></span>';

    /* ---------- "Днес" ---------- */
    const mins = (x: string) => +x.slice(0, 2) * 60 + +x.slice(3, 5), now = sofiaHM(), m0 = now.h * 60 + now.m;
    const kitchenOpen = m0 >= mins(RESTAURANT.open) && m0 < mins(RESTAURANT.kitchen);
    type K = [string, string, string, string, string, string, boolean];
    const K: K[] = [];
    if (td) {
      if (td.sales) K.push(["dashboard", "Днес", "wallet", '<span class="sum">' + fmt(td.sales.sum) + "</span>", "от " + plural(td.sales.n, "поръчка", "поръчки") + (td.sales.sample ? " " + SAMPLE : ""), secHref("reports", "p=today"), false]);
      if (td.inWork != null) K.push(["orders", "Поръчки в работа", "receipt", String(td.inWork), td.inWork ? "" : kitchenOpen ? "Няма поръчки в работа" : "Кухнята не работи сега", secHref("orders"), false]);
      if (td.reservations != null) K.push(["reservations", "Резервации днес", "calendar-check", String(td.reservations), "", secHref("reservations"), false]);
      if (td.soldOut != null && can("menu")) {
        const n = td.soldOut, names = outNames || [];
        K.push(["menu", "Изчерпани днес", "clock", String(n), n ? (names.length ? esc(names.slice(0, 2).join(", ")) + (names.length > 2 ? " и още " + (names.length - 2) : "") : "") : "Всичко е налично", secHref("menu", "f=out"), n > 0]);
      }
    }
    const kpis = () => {
      if (loading) return skel(2, "Зареждаме таблото …");
      if (fail) return off ? "" : failHTML(fail, "Не успяхме да заредим числата за днес. Модулите и разделите работят.");
      if (!K.length) return "";
      /* only the tile that asks for action now is inverted (sold out today) */
      return '<div class="sa-shell sa-rise" data-edit-id="admin.dashboard.today"><div class="kpis n' + K.length + '">' + K.map((k) =>
        '<a class="kpi' + (k[6] ? " hot" : "") + '" href="' + k[5] + '"><span class="lb">' + ic(k[2], 20) + k[1] + '</span><span class="v">' + k[3] + '</span><span class="ft">' + k[4] + "</span></a>").join("") + "</div></div>";
    };

    /* ---------- "Чака те" (only what the role sees, each straight to the action) ---------- */
    const waitHTML = () => {
      if (loading || (fail && !off) || !w) return "";
      const nw = w.notes, CANB = ["admin", "owner", "manager"].includes(me.user.role);
      const W = ([
        ["orders", w.orders != null, w.orders || 0, "receipt", "Поръчки за приемане", "Нови, още не са започнати", secHref("orders", "s=accepted"), "Приеми", "orders"],
        ["res", w.reservations != null, w.reservations || 0, "calendar-check", "Резервации за потвърждаване", "Днес, чакат потвърждение", secHref("reservations", "f=new"), "Потвърди", ""],
        /* the main admin: two rows, each to the view with the same count (new / for review) */
        ["notes", isMainAdmin(), nw.newN, "pencil-simple", "Бележки за одобрение", "Нови бележки и препоръки", secHref("notes", "s=new"), "Одобри", ""],
        ["review", isMainAdmin(), nw.reviewN, "eye", "Бележки за преглед", "Изпълнени, чакат „Публикувай“", secHref("notes", "s=review"), "Прегледай", ""],
        ["mine", !isMainAdmin(), nw.n, "pencil-simple", "Вашите препоръки", nw.title || "", secHref("notes"), "Виж", ""],
        ["noshow", w.noShows != null && CANB, w.noShows || 0, "warning-circle", "Неявили се за решение", "Две неявявания: блокиране или не", secHref("reservations", "blocks"), "Реши", ""],
      ] as [string, boolean, number, string, string, string, string, string, string][]).filter((x) => x[1] && x[2] > 0);
      return '<section class="db-wait sa-rise" data-edit-id="admin.dashboard.waiting" aria-labelledby="db-wait-h"><div class="sa-sh" style="margin-top:0"><h2 id="db-wait-h">Чака те</h2>' + (W.length ? "<p>" + plural(W.reduce((a, x) => a + x[2], 0), "нещо", "неща") + " за действие</p>" : "") + "</div>" +
        (W.length ? '<div class="waits">' + W.map((x) => '<a class="wt" href="' + x[6] + '"' + (x[8] ? ' data-fresh="' + x[8] + '"' : "") + '><span class="si">' + ic(x[3], 22) + '</span><span class="tx"><b><span class="sa-n">' + x[2] + "</span>" + esc(x[4]) + "</b>" + (x[5] ? "<small>" + esc(x[5]) + "</small>" : "") + '</span><span class="wgo pill pill-ink">' + esc(x[7]) + ic("caret-right", 18) + "</span></a>").join("") + "</div>"
          : '<div class="wt-ok">' + ic("check-circle", 24) + "<span><b>Нищо не чака.</b> Всичко е наред.</span></div>") + "</section>";
    };

    /* ---------- modules ---------- */
    const DEV: Record<string, string> = { phone: "Телефон", tablet: "Таблет", desktop: "Компютър" };
    const glyph = (m: Mod) => '<span class="g ' + (m.id === "watch" ? "watch" : m.dev || "phone") + '">' + ic(m.ic, 30) + "</span>";
    const modCard = (m: Mod, i: number) => {
      if (m.soon) return '<article class="mod soon sa-rise d' + (i % 4) + '" data-edit-id="admin.dashboard.module.' + m.id + '"><div class="vis">' + glyph(m) + '<span class="cnt">Скоро</span></div><div class="body"><h3>' + esc(m.n) + "</h3><p>" + esc(m.what) + '</p><p class="who">За: <span>' + esc(m.who) + '</span></p></div><p class="note">Скоро. Тук ще виждате ' + esc(m.what.charAt(0).toLowerCase() + m.what.slice(1)) + "</p></article>";
      const n = m.screens.length;
      return '<article class="mod sa-rise d' + (i % 4) + '" data-edit-id="admin.dashboard.module.' + m.id + '"><div class="vis">' + glyph(m) + '<span class="cnt">' + plural(n, "екран", "екрана") + '</span><span class="dv">' + (m.id === "watch" ? "Часовник" : DEV[m.dev || ""] || "") + "</span></div>" +
        '<div class="body"><h3>' + esc(m.n) + "</h3><p>" + esc(m.what) + '</p><p class="who">За: <span>' + esc(m.who) + "</span></p></div>" +
        '<div class="act"><a class="pill pill-line open" href="' + aurl.preview("m=" + m.id + "&p=" + m.screens[0] + "&d=" + (m.dev || "phone")) + '" aria-label="Отвори на живо: ' + esc(m.n) + '"><span class="lg">Отвори на живо</span><span class="sm">На живо</span><span class="knob">' + ic("arrow-up-right", 20) + "</span></a></div></article>";
    };
    const mods = MODULES.filter(modCan);

    /* ---------- sections: real numbers where there are some, else what the section does ---------- */
    const ev = events()[0];
    const META: Record<string, string> = {
      orders: td && td.inWork != null ? td.inWork + " в работа" : "", reservations: td && td.reservations != null ? td.reservations + " днес" : "",
      menu: menuN + " ястия" + (td && td.soldOut != null ? " · " + plural(td.soldOut, "изчерпано", "изчерпани") + " днес" : ""), lunch: lunchDate ? "Последно качено: " + fmtYmd(lunchDate) : "",
      events: ev ? esc(ev.n) + ", " + fmtYmd(ymd(ev.date), true) : "Няма предстоящи", zones: ZONES.length + " квартала · доставка до 21:00",
      hall: TABLES.length + " маси (условни за макета)", qr: TABLES.length + " етикета за печат", roles: Object.keys(ROLES).length + " роли",
      notes: w ? (w.notes.title || "Няма нови") : "", site: "Модулите на живо", settings: eta,
    };
    const groups = () => '<div class="groups" data-edit-id="admin.dashboard.sections">' + GROUPS.map((g, gi) => {
      const items = g[1].filter((id) => can(id) && id !== "dashboard"); if (!items.length) return "";
      return '<section class="grp sa-rise d' + (gi % 4) + '"><h3>' + esc(g[0]) + '</h3><div class="core">' + items.map((id) => {
        const sc = SEC[id], meta = META[id] || esc(sc.desc);
        const nb = id === "notes" && w ? w.notes.n : 0;
        const end = sc.soon ? soonTag() : (nb ? '<span class="sa-n">' + nb + "</span>" : "") + ic("caret-right", 20);
        const inner = '<span class="si">' + ic(sc.ic, 22) + "</span><span><b>" + esc(sc.n) + "</b><small>" + (sc.soon ? esc(sc.desc) : meta) + '</small></span><span class="end">' + end + "</span>";
        return sc.soon ? '<button class="srow soon" type="button" data-sa="soon" data-id="' + id + '">' + inner + "</button>" : '<a class="srow" href="' + secHref(id) + '">' + inner + "</a>";
      }).join("") + "</div></section>";
    }).join("") + "</div>";

    let out = (off ? offline("Показваме последно зареденото. Числата за днес не се обновяват.") + '<div style="height:16px"></div>' : "") + waitHTML() +
      (K.length || loading || (fail && !off) ? '<div class="sa-sh db-today"><h2>Днес</h2></div>' + kpis() : "");
    out += '<div class="sa-sh" id="modules"><h2>Модулите</h2><p>Всеки се отваря на живо в рамка на телефон, таблет или компютър.</p></div>' + '<div class="mods">' + mods.map(modCard).join("") + "</div>";
    const gh = groups();
    if (gh.includes("srow")) out += '<div class="sa-sh"><h2>Разделите</h2><p>Каквото не е готово, е „Скоро“ с описание.</p></div>' + gh;
    return out;
  }

  /* the sold-out dishes by name (the live menu), only for the roles with "Меню" and only when there are some */
  async function names(s: Summary) {
    if (!s.today.soldOut || !can("menu")) { outNames = []; return; }
    try {
      const m = await api.menu();
      outNames = m.items.filter((x) => x.t.includes("out")).map((x) => x.n).concat((m.lunch.items || []).filter((x) => (x as { out?: boolean }).out).map((x) => x.n));
    } catch { outNames = []; }
  }
  const redraw = () => { const y = A.scroller ? A.scroller.scrollTop : 0; body.classList.add("no-rise"); draw(); if (A.scroller) A.scroller.scrollTop = y; };
  A.onSummary = (s) => { sum = s; fail = null; names(s).then(redraw); redraw(); };
  A.onNewOrder = () => { /* the summary follows (a.ts); the numbers change from one place */ };
  adminApi.settings().then((x) => { eta = x.kitchen.busy ? "Натоварено: около " + x.kitchen.etaBusyMin + " мин" : "Доставка: около " + x.kitchen.etaMin + " мин"; if (sum) redraw(); }).catch(() => { /* the description stays */ });
  try { sum = A.summary || (await loadSummary()); await names(sum!); }
  catch (e) { fail = e; }
  draw();
  if (location.hash.includes("modules")) { const el = document.getElementById("modules"); if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 60); }
  body.addEventListener("click", (e) => { if ((e.target as Element).closest('[data-sa="retry"]')) { e.stopPropagation(); fail = null; draw(); loadSummary(true).catch((x) => { fail = x; draw(); }); } }, true);
}
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
