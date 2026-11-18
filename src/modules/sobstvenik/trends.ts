/* Siracusa · "Собственик" › "Тенденции" (/sobstvenik/tendentsii/): port of design/pages-sobstvenik/trends.html over
   the core (ownerApi.trends: the same numbers as "Отчети" in the admin for the same period). The period (Днес, Вчера,
   7 дни, 30 дни, Месец, Избери дати up to 92 days) and "Сравни с" (Предишния период / Миналата година = the same weekdays
   364 days back); every KPI with its difference (sign + % + word; no-shows inverse); the charts each with "Таблица";
   "Още без данни" with the [ЛИПСВА] of the core; "Изтегли CSV" (the core's rows); "Отчети по имейл" (ownerApi.setMail;
   the address [ЛИПСВА], the sending "Скоро"); the dish card from the search (#dish=<id>).
   Hash: #p=today|yday|30|month|custom&a=&b=, #c=year, #dish=<id>, #top #heat #res #clients #times #offers. */
import "sc-icons:hourglass,caret-right,truck,storefront,phone,chair,briefcase,globe,calendar-check,warning-circle,eye,scales,x,chart-bar,house";
import { mountBoss, delta, type Boss } from "../boss/frame.ts";
import { ownerApi, type OwnerTrends, type MailSettings } from "../../client/api-boss.ts";
import { pic } from "../../lib/render.ts";
import { findDish, catById, isOut } from "../../lib/data.ts";
import {
  ic, esc, plural, fmt, fd, dayL, eur0, f1, sample, soon, miss, go, screen, perFromHash, perHash, periodHTML, perWords, bindPeriod, query,
  hashMap, setHash, act, decBadge, downloadCsv, csvBtn, findPer, today, fmtNb, NONE, cutNotice, type PerWords,
} from "./common.ts";
import { card, cols, hbars, legend, bindTips } from "./charts.ts";

export async function initTrends(): Promise<void> {
  const boss = await mountBoss({ module: "sobstvenik", tab: "trends", title: "Тенденции", search: { load: () => import("./find.ts").then((m) => m.provider(boss!)) } });
  if (!boss) return;
  trendsScreen(boss);
}

const CH_IC: Record<string, string> = { web: "globe", phone: "phone", table: "chair", office: "briefcase" };
const mmss = (sec: number) => { const s = Math.round(sec); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

interface Data { t: OwnerTrends; prevDish: { q: number; revenue: number | null } | null; mail: MailSettings | null }

function trendsScreen(boss: Boss): void {
  const P = perFromHash();
  findPer.s = P;
  let topBy: "q" | "r" = "q", dishId = hashMap().dish || "", words: PerWords | null = null, mail: MailSettings | null = null;
  const body = boss.body;
  body.innerHTML = periodHTML(P) + boss.skeleton(5, "Смятаме тенденциите…");

  async function load(): Promise<Data> {
    const t = await ownerApi.trends(query(P, dishId));
    let prevDish: Data["prevDish"] = null;
    /* the dish card: the same dish in the comparison period (a whole period; not for "Днес", which is cut to the minute) */
    if (dishId && P.per !== "today") {
      try { const c = await ownerApi.trends({ period: "custom", from: t.cmp.from, to: t.cmp.to, dish: dishId }); prevDish = c.dish ? { q: c.dish.q, revenue: c.dish.revenue } : null; } catch { prevDish = null; }
    }
    if (!mail) { try { mail = (await ownerApi.decisions()).mail; } catch { mail = null; } }
    return { t, prevDish, mail };
  }
  const S = screen<Data>(boss, {
    load, draw, err: "Поръчките и оборотът са запазени. Опитай пак след малко.", top: () => periodHTML(P),
    bad: () => { if (P.per !== "custom") return false; P.per = "7"; perHash(P, { dish: dishId }); return true; },
    after: () => { bindTips(body); },
    live: ["order.created", "order.status", "order.changed", "reservation.created", "reservation.status"], every: 120_000,
  });
  decBadge(boss);
  bindPeriod(boss, P, () => S.reload(false), () => words, () => ({ dish: dishId }));
  /* a period over 92 days in the address: set right, said once, and the address follows */
  if (P.cut) { perHash(P, { dish: dishId }); boss.toast(cutNotice(P)); }
  let jumped = false;
  function jump() {
    if (jumped) return; jumped = true;
    if (dishId) { setTimeout(() => document.getElementById("dish")?.scrollIntoView({ block: "start" }), 60); return; }
    ["top", "heat", "res", "clients", "times", "offers"].forEach((k) => { if (new RegExp("(^#|&)" + k + "($|&)").test(location.hash)) setTimeout(() => document.getElementById(k)?.scrollIntoView({ block: "start" }), 60); });
  }

  function draw(D: Data): string {
    setTimeout(jump, 0);
    const d = D.t, cur = d.totals, prev = d.prev, money = d.money, W = perWords(P, d); words = W;
    const dl = (a: number, b: number, inv = false) => delta(a, b, { inv, none: NONE });
    let h = periodHTML(P);
    const noData = !cur.orders && !cur.reservations && !cur.cancelled, fresh = !d.history;
    h += '<div class="tr-acts"><p class="ow-meta"><span><b>' + esc(W.label) + "</b> · спрямо " + esc(W.cmpLabel) + "</span>" + (d.sample ? sample() : "") + "</p>" +
      (noData || fresh ? "" : '<div class="acts">' + csvBtn() + "</div>") + "</div>";
    /* a new restaurant: no day before today (the prototype's "Без история") */
    if (fresh) {
      h += '<section class="ow-card" data-edit-id="own.trends.empty">' + boss.empty({ icon: "hourglass", title: "Още събираме история", text: "Тенденциите и сравнението идват след 4 седмици. Днешните числа са в „Днес“.",
        action: '<a class="pill pill-line pill-lg" href="' + go.today() + '">' + ic("house", 22) + "Към „Днес“</a>" }) + "</section>";
      return h;
    }
    if (noData) {
      h += '<section class="ow-card" data-edit-id="own.trends.empty">' + boss.empty({ icon: "chart-bar", title: "Няма поръчки за този период", text: P.per === "today" ? "Поръчките за днес се появяват тук от 10:00." : "Избери друг период.",
        action: P.per === "30" ? '<a class="pill pill-line pill-lg" href="' + go.today() + '">' + ic("house", 22) + "Към „Днес“</a>" : '<button class="pill pill-line pill-lg" type="button" data-per="30">Последните 30 дни</button>' }) + "</section>";
      h += '<div class="ow-mas">' + missingCard(d) + mailCard() + "</div>";
      return h;
    }
    if (dishId && d.dish) h += dishCard(D, W);
    const kpi = (l: string, v: string, dd: string) => '<div class="ow-kpi"><span class="l">' + esc(l) + "</span><b>" + v + "</b>" + (dd || "") + "</div>";
    h += '<div class="ow-kpis tr-kpis" data-edit-id="own.trends.kpi">' +
      kpi("Поръчки" + (cur.cancelled ? " (+" + cur.cancelled + " отказ" + (cur.cancelled === 1 ? "ана" : "ани") + ")" : ""), String(cur.orders), dl(cur.orders, prev.orders)) +
      (money ? kpi("Оборот", fmt(cur.revenue || 0), dl(cur.revenue || 0, prev.revenue || 0)) + kpi("Среден бон", fmt(cur.avg || 0), dl(cur.avg || 0, prev.avg || 0)) : "") +
      kpi("Резервации", String(cur.reservations), dl(cur.reservations, prev.reservations)) +
      kpi("Неявили се", cur.noShows + (cur.reservations ? " <small>от " + cur.reservations + "</small>" : ""), dl(cur.noShows, prev.noShows, true)) + "</div>";
    h += '<p class="ow-note" style="margin:-6px 4px 16px">При „Неявили се“ по-малко е по-добре.</p>';
    h += '<div class="ow-grid tr-grid">' + mainCard(d, W) + "</div>";
    h += '<div class="ow-grid">' + heat(d) + "</div>";
    h += '<div class="ow-mas">' + channels(d, W) + top(d) + pairs(d) + clients(d) + times(d) + res(d, W) + offers(d) + missingCard(d) + mailCard() + "</div>";
    h += '<p class="ow-note" style="margin:4px 4px 0">Всички таблици: <a class="link" href="' + go.reports(P.per === "custom" ? "custom&a=" + P.a + "&b=" + P.b : P.per) + '">Отчети в админа' + ic("caret-right", 18) + "</a></p>";
    return h;
  }

  /* the turnover by day (for one day: by hour), the comparison as a line */
  function mainCard(d: OwnerTrends, W: PerWords): string {
    const money = d.money, v = (x: { revenue: number | null; orders: number }) => (money ? x.revenue || 0 : x.orders), f = money ? eur0 : undefined;
    const what = money ? "Оборот" : "Поръчки";
    if (W.one) {
      const hrs = d.byHour, um = d.until ? +d.until.slice(0, 2) * 60 + +d.until.slice(3, 5) : null;
      /* today: the comparison only up to "сега" (the same minute a week ago), the mark "сега" as on "Днес" */
      const after = (hr: number) => um != null && hr * 60 > um;
      const nowX = um != null && um >= 600 && um < 1380 ? ((um - 600) / 60 / hrs.length) * 100 : null;
      return card({ page: "trends", id: "main", cls: "wall", title: what + " по час", sub: fd(d.from) + (d.until ? " до " + d.until : ""),
        inner: cols("main", hrs.map((x) => ({ l: x.hour + ":00", v: money ? Math.round(x.revenue || 0) : x.orders, t: x.hour + ":00 - " + x.hour + ":59", tv: (money ? fmt(x.revenue || 0) + " · " : "") + plural(x.orders, "поръчка", "поръчки") })),
          { fmt: f, xn: 5, nowX, prev: hrs.map((x) => (after(x.hour) ? null : v(x.cmp))), prevTip: (i) => (after(hrs[i].hour) ? "" : " · сравнение " + (money ? fmt(hrs[i].cmp.revenue || 0) : String(hrs[i].cmp.orders))) }) +
          legend([[um != null ? "Днес (до " + d.until + ")" : "Избраният ден"], [W.cmpName + (um != null ? ", до същия час" : ""), "ln prev"]]),
        table: { head: money ? ["Час", "Оборот", "Поръчки", W.cmpName] : ["Час", "Поръчки", W.cmpName], rows: hrs.map((x) => { const c = after(x.hour) ? "-" : money ? fmt(x.cmp.revenue || 0) : x.cmp.orders, f2 = after(x.hour);
          return money ? [x.hour + ":00", f2 ? "-" : fmt(x.revenue || 0), f2 ? "-" : x.orders, c] : [x.hour + ":00", f2 ? "-" : x.orders, c]; }) } });
    }
    const days = d.byDay, n = days.length, t0 = today(), hasToday = d.to === t0;
    return card({ page: "trends", id: "main", cls: "wall", title: what + " по ден",
      inner: cols("main", days.map((x) => ({ l: dayL(x.date, n), v: money ? Math.round(x.revenue || 0) : x.orders, hi: x.date === t0, t: fd(x.date), tv: (money ? fmt(x.revenue || 0) + " · " : "") + plural(x.orders, "поръчка", "поръчки") })),
        { fmt: f, xn: n > 14 ? 4 : 7, prev: days.map((x) => v(x.cmp)), prevTip: (i) => " · сравнение " + (money ? fmt(days[i].cmp.revenue || 0) : String(days[i].cmp.orders)) }) +
        legend([["Избраният период"], ...(hasToday ? [["Днес (до " + (d.until || hmNowSafe()) + ")", "r"] as [string, string]] : []), [W.cmpName, "ln prev"]]),
      table: { head: money ? ["Ден", "Оборот", "Поръчки", W.cmpName] : ["Ден", "Поръчки", W.cmpName], rows: days.map((x) => (money ? [fd(x.date, true), fmt(x.revenue || 0), x.orders, x.cmp.date ? fmt(x.cmp.revenue || 0) : "-"] : [fd(x.date, true), x.orders, x.cmp.date ? x.cmp.orders : "-"])) } });
  }

  /* the peak hours: weekday × hour, the average orders per such day of the period (one tone: darker = more) */
  function heat(d: OwnerTrends): string {
    const pk = d.peak, wd = [1, 2, 3, 4, 5, 6, 0], cnt = wd.map(() => 0);
    for (let x = d.from; x <= d.to; x = addDay(x)) cnt[wd.indexOf(new Date(x + "T12:00:00Z").getUTCDay())]++;
    const avg = pk.cells.map((row, i) => row.map((c) => (cnt[i] ? c / cnt[i] : 0))), mx = Math.max(0, ...avg.flat());
    const lv = (v: number) => { if (!v || !mx) return ""; const f = v / mx; return f < 0.2 ? "l1" : f < 0.4 ? "l2" : f < 0.6 ? "l3" : f < 0.8 ? "l4" : "l5"; };
    let best = { v: 0, i: -1, j: -1 }; avg.forEach((row, i) => row.forEach((v, j) => { if (v > best.v) best = { v, i, j }; }));
    const top = best.i > -1 ? pk.days[best.i] + " около " + pk.hours[best.j] + ":00" : "";
    let g = '<div class="ow-heat" role="img" aria-label="Поръчки по ден от седмицата и час. Най-много: ' + esc(top || "няма") + '"><span></span>' + pk.hours.map((hh) => '<span class="h">' + (hh % 2 === 0 ? hh : "") + "</span>").join("");
    pk.days.forEach((dn, i) => { g += '<span class="d">' + esc(dn) + "</span>" + pk.hours.map((hh, j) => '<span class="c ' + lv(avg[i][j]) + '" title="' + esc(dn) + ", " + hh + ":00 · средно " + f1(avg[i][j]) + ' поръчки"></span>').join(""); });
    g += '</div><div class="ow-scale" aria-hidden="true">по-малко<i class="l0"></i><i class="l1"></i><i class="l3"></i><i class="l5"></i>повече</div>';
    return card({ page: "trends", id: "heat", anchor: "heat", cls: "wall", title: "Пикови часове", sub: "Средно поръчки по ден и час" + (top ? " · най-много: " + esc(top) : ""),
      inner: (d.days < 7 ? '<p class="ow-note">За пълната картина избери поне 7 дни.</p>' : "") + g,
      table: { head: ["Час", ...pk.days], rows: pk.hours.map((hh, j) => [hh + ":00", ...pk.days.map((_, i) => f1(avg[i][j]))]) } });
  }

  function channels(d: OwnerTrends, W: PerWords): string {
    const money = d.money;
    const rows = d.byChannel.map((c) => ({ n: c.label, icon: CH_IC[c.channel], v: money ? c.revenue || 0 : c.orders, vt: money ? fmt(c.revenue || 0) : String(c.orders),
      sub: c.share + (money ? "% от оборота · " + plural(c.orders, "поръчка", "поръчки") : "% от поръчките"), d: money ? delta(c.revenue || 0, c.cmp.revenue || 0) : delta(c.orders, c.cmp.orders) }));
    return card({ page: "trends", id: "ch", title: "По канал", sub: money ? "Оборот" : "Поръчки", inner: hbars(rows) + '<p class="ow-note">„Сайт“ е доставката и вземането от сайта.</p>',
      table: money ? { head: ["Канал", "Оборот", "Дял от оборота", "Поръчки", W.cmpName], rows: d.byChannel.map((c) => [c.label, fmt(c.revenue || 0), c.share + "%", c.orders, fmt(c.cmp.revenue || 0)]) }
        : { head: ["Канал", "Поръчки", "Дял от поръчките", W.cmpName], rows: d.byChannel.map((c) => [c.label, c.orders, c.share + "%", c.cmp.orders]) } });
  }

  function top(d: OwnerTrends): string {
    const money = d.money, by = money && topBy === "r" ? "r" : "q", list = by === "q" ? d.top.byCount : d.top.byRevenue;
    const mx = list.length ? (by === "q" ? list[0].q : list[0].revenue || 0) || 1 : 1;
    const inner = (money ? '<div class="seg tr-seg" role="group" aria-label="Подреди"><button type="button" data-top="q" aria-pressed="' + (by === "q") + '">По брой</button><button type="button" data-top="r" aria-pressed="' + (by === "r") + '">По оборот</button></div>' : "") +
      (list.length ? '<div class="ow-top10">' + list.map((t, i) => { const x = findDish(t.id);
        return '<a class="r' + (t.id === dishId ? " mark" : "") + '" href="#dish=' + encodeURIComponent(t.id) + '" data-dish="' + esc(t.id) + '" style="color:inherit;text-decoration:none"><span class="k">' + (i + 1) + "</span>" + (x ? pic(x) : '<span class="pic" aria-hidden="true"></span>') +
          '<span class="n"><b>' + esc(t.name) + '</b><span class="tr" aria-hidden="true"><i style="width:' + ((by === "q" ? t.q : t.revenue || 0) / mx) * 100 + '%"></i></span></span><span class="v">' +
          (by === "q" ? plural(t.q, "брой", "броя") + (money ? "<small>" + fmt(t.revenue || 0) + "</small>" : "") : fmt(t.revenue || 0) + "<small>" + plural(t.q, "брой", "броя") + "</small>") + "</span></a>"; }).join("") + "</div>"
        : '<p class="ow-note">Още няма продадени ястия за този период.</p>');
    return card({ page: "trends", id: "top", anchor: "top", title: "Най-поръчвани ястия", sub: d.sample ? "Примерни бройки" : "Първите 8", inner,
      table: { head: money ? ["Ястие", "Брой", "Оборот"] : ["Ястие", "Брой"], rows: list.map((t) => (money ? [t.name, t.q, fmt(t.revenue || 0)] : [t.name, t.q])) } });
  }

  function pairs(d: OwnerTrends): string {
    const l = d.together.slice(0, 5);
    const p = (id: string) => { const x = findDish(id); return x ? pic(x) : ""; };
    return '<section class="ow-card" aria-labelledby="h-pr" data-edit-id="own.trends.pairs"><header><div><h2 id="h-pr">Често поръчвани заедно<small>Ястия, които често са в една поръчка</small></h2></div></header>' +
      (l.length ? "<div>" + l.map((x) => '<div class="tr-pair"><span class="pp">' + p(x.a.id) + p(x.b.id) + '</span><span class="tx">' + esc(x.a.name) + " + " + esc(x.b.name) + '</span><span class="v">' + x.n + " пъти</span></div>").join("") + "</div>"
        : '<p class="ow-note">Още няма две ястия, поръчани заедно поне два пъти.</p>') + (d.sample ? "<p>" + sample() + "</p>" : "") + "</section>";
  }

  function clients(d: OwnerTrends): string {
    const c = d.customers, rs = c.total ? Math.round((c.returning / c.total) * 100) : 0;
    return '<section class="ow-card" id="clients" aria-labelledby="h-cl" data-edit-id="own.trends.clients"><header><div><h2 id="h-cl">Нови и връщащи се клиенти<small>Поръчки с телефонен номер</small></h2></div></header>' +
      '<div class="tr-two"><div><span class="k">Връщащи се</span><b>' + c.returning + '</b></div><div><span class="k">Нови</span><b>' + c.new + "</b></div></div>" +
      (c.total ? '<div class="ow-segbar" role="img" aria-label="' + Math.round(rs / 10) + ' от 10 клиенти се връщат"><i style="width:' + rs + '%"></i><i class="b" style="width:' + (100 - rs) + '%"></i></div>' + legend([["Връщащи се"], ["Нови", "prev"]]) +
        '<p class="ow-note">' + Math.round(rs / 10) + " от 10 клиенти се връщат.</p>" : '<p class="ow-note">Още няма поръчки с телефонен номер за този период.</p>') + (d.sample ? "<p>" + sample() + "</p>" : "") + "</section>";
  }

  function times(d: OwnerTrends): string {
    const t = d.times, none = t.cookMin == null && t.deliveryMin == null && t.callSec == null;
    const v = (x: number | null, f: (n: number) => string) => (x == null ? '<b>-</b><span class="ow-note">още няма данни</span>' : "<b>" + f(x) + "</b>");
    return '<section class="ow-card" id="times" aria-labelledby="h-tm" data-edit-id="own.trends.times"><header><div><h2 id="h-tm">Средни времена<small>По-малко е по-добре</small></h2></div></header>' +
      (none ? '<p class="ow-note">Още няма отбелязани времена за този период: идват от кухнята, шофьорите и сервитьорите.</p>'
        : '<div class="tr-two"><div><span class="k">Приготвяне</span>' + v(t.cookMin, (n) => f1(n) + " мин") + '</div><div><span class="k">Доставка (от тръгване)</span>' + v(t.deliveryMin, (n) => f1(n) + " мин") + "</div>" +
          '<div style="grid-column:1/-1"><span class="k">Отговор на повикване от масата</span>' + v(t.callSec, (n) => mmss(n) + " мин") + "</div></div>") + "</section>";
  }

  function res(d: OwnerTrends, W: PerWords): string {
    const c = d.totals, p = d.prev;
    return card({ page: "trends", id: "res", anchor: "res", title: "Резервации и неявили се", sub: plural(c.reservations, "резервация", "резервации") + ", от тях " + c.noShows + " неявили се",
      inner: (!c.reservations && !p.reservations ? '<p class="ow-note">Няма резервации за този период.</p>' : W.one ? hbars([{ n: "Резервации", icon: "calendar-check", v: c.reservations, vt: String(c.reservations), d: delta(c.reservations, p.reservations) }, { n: "Неявили се", icon: "warning-circle", v: c.noShows, vt: String(c.noShows), d: delta(c.noShows, p.noShows, { inv: true }) }])
        : cols("res", d.byDay.map((x) => ({ l: dayL(x.date, d.byDay.length), v: x.reservations - x.noShows, v2: x.noShows, t: fd(x.date), tv: plural(x.reservations, "резервация", "резервации") + (x.noShows ? ", " + x.noShows + " неявили се" : "") })), { xn: d.byDay.length > 14 ? 4 : 7 }) +
          legend([["Дошли и предстоящи"], ["Неявили се", "r"]])) +
        '<a class="link" href="' + go.decisions("noshow") + '">Неявили се за блокиране' + ic("caret-right", 18) + "</a>",
      table: { head: ["Ден", "Резервации", "Неявили се"], rows: d.byDay.map((x) => [fd(x.date, true), x.reservations, x.noShows]) } });
  }

  function offers(d: OwnerTrends): string {
    const o = d.offers, money = d.money, disc = (x: { disc: number | null }) => (money && x.disc ? '<span class="ow-note">отстъпка ' + fmt(x.disc) + "</span>" : "");
    return '<section class="ow-card" id="offers" aria-labelledby="h-of" data-edit-id="own.trends.offers"><header><div><h2 id="h-of">Ефектът на офертите</h2></div></header>' +
      '<div class="tr-two"><div><span class="k">Обедно -30% след 15:00 (вземане)</span><b>' + plural(o.lunch.orders, "поръчка", "поръчки") + "</b>" + disc(o.lunch) + '</div><div><span class="k">С кода -10% от оценката</span><b>' + plural(o.code.orders, "поръчка", "поръчки") + "</b>" + disc(o.code) + "</div></div>" +
      '<p class="ow-note">Колко поръчки са дошли с офертата. Колко печалба носят: ' + miss(d.missing.cost) + ".</p>" + (d.sample ? "<p>" + sample() + "</p>" : "") + "</section>";
  }

  function missingCard(d: OwnerTrends): string {
    return '<section class="ow-card" aria-labelledby="h-ms" data-edit-id="own.trends.missing"><header><div><h2 id="h-ms">Още без данни</h2></div></header><div class="tr-miss">' +
      '<div><span class="ill">' + ic("eye", 22) + "</span><span><b>Разгледани, но не поръчани</b>" + miss(d.missing.views) + "</span></div>" +
      '<div><span class="ill">' + ic("scales", 22) + '</span><span><b>Матрица на менюто</b><span class="ow-muted">Популярност срещу печалба.</span> ' + miss(d.missing.cost) + "</span></div></div></section>";
  }

  function mailCard(): string {
    const M = mail;
    if (!M) return "";
    return '<section class="ow-card" aria-labelledby="h-ml" data-edit-id="own.trends.mail"><header><div><h2 id="h-ml">Отчети по имейл<small>' + esc(M.format) + " до " + miss(M.email) + "</small></h2></div></header><div class=\"tr-mail\">" +
      '<label><span class="t">Всеки понеделник в 6:00<small>За миналата седмица' + (M.weekly && /ЛИПСВА/.test(M.email) ? '<span class="wait">Ще тръгне, щом агенцията добави имейла</span>' : "") + '</small></span><span class="ow-switch"><input type="checkbox" role="switch" id="ow-mw" data-mail="weekly"' + (M.weekly ? " checked" : "") + '><span class="tr"></span></span></label>' +
      '<label><span class="t">На 1-во число<small>За миналия месец' + (M.monthly && /ЛИПСВА/.test(M.email) ? '<span class="wait">Ще тръгне, щом агенцията добави имейла</span>' : "") + '</small></span><span class="ow-switch"><input type="checkbox" role="switch" id="ow-mm" data-mail="monthly"' + (M.monthly ? " checked" : "") + '><span class="tr"></span></span></label></div>' +
      '<p class="ow-note">Изпращането тръгва, щом агенцията добави имейла. ' + soon() + "</p></section>";
  }

  function dishCard(D: Data, W: PerWords): string {
    const d = D.t, x = d.dish!, m = findDish(x.id), cat = m ? catById[m.cat] : null, money = d.money, pv = D.prevDish;
    const items = x.byDay.map((b) => ({ l: dayL(b.date, x.byDay.length), v: b.q, t: fd(b.date), tv: plural(b.q, "брой", "броя") }));
    return '<div class="ow-grid"><section class="ow-card wall" id="dish" aria-labelledby="h-ds" data-edit-id="own.trends.dish"><header><div class="tr-dish">' + (m ? pic(m) : "") + '<div><h2 id="h-ds">' + esc(x.name) + '</h2><span class="ow-note">' +
      [cat ? esc(cat.n) : "", m ? fmtNb(m.p) : ""].filter(Boolean).join(" · ") + (m && isOut(m) ? " · Изчерпано днес" : "") + "</span></div></div>" +
      '<button class="pill pill-soft ow-tbtn" type="button" data-undish>' + ic("x", 18) + "Затвори</button></header>" +
      '<div class="tr-two"><div><span class="k">Продадени за периода</span><b>' + plural(x.q, "брой", "броя") + "</b>" + (pv ? delta(x.q, pv.q, { none: NONE }) : "") + "</div>" +
      (money ? '<div><span class="k">Оборот от ястието</span><b>' + fmt(x.revenue || 0) + "</b>" + (pv ? delta(x.revenue || 0, pv.revenue || 0, { none: NONE }) : "") + "</div>" : "") + "</div>" +
      (W.one ? "" : cols("dish", items, { xn: items.length > 14 ? 4 : 7 })) +
      '<div class="ow-row" style="justify-content:space-between">' + (d.sample ? sample() : "<span></span>") + '<a class="link" href="' + go.menu(x.id) + '">В менюто на админа' + ic("caret-right", 18) + "</a></div></section></div><div style=\"height:16px\"></div>";
  }

  /* ---------- the actions ---------- */
  body.addEventListener("click", (e) => {
    const tg = e.target as Element; let t: HTMLElement | null;
    if ((t = tg.closest<HTMLElement>("[data-top]"))) { topBy = t.dataset.top === "r" ? "r" : "q"; S.redraw(); body.querySelector<HTMLElement>('[data-top="' + topBy + '"]')?.focus({ preventScroll: true }); return; }
    if ((t = tg.closest<HTMLElement>("[data-dish]"))) {
      e.preventDefault(); dishId = t.dataset.dish!; perHash(P, { dish: dishId });
      S.reload(false).then(() => { window.scrollTo(0, 0); const hd = document.getElementById("h-ds"); if (hd) { hd.setAttribute("tabindex", "-1"); hd.focus({ preventScroll: true }); } }); return;
    }
    if (tg.closest("[data-undish]")) { dishId = ""; const hh = hashMap(); delete hh.dish; setHash(hh); void S.reload(false); return; }
    if (tg.closest("[data-csv]")) {
      const D = S.data(); if (!D) return;
      const d = D.t, ok = downloadCsv("siracusa-tendentsii-" + d.from + "-" + d.to + (d.sample ? "-primerni-danni" : "") + ".csv", d.csv);
      boss.toast(ok ? "Изтеглено: " + plural(d.csv.length - 1 - (d.sample ? 1 : 0), "ден", "дни") + " в CSV" : "Файлът не се изтегли. Опитай пак.");
    }
  });
  body.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement; if (!t.matches || !t.matches("[data-mail]")) return;
    const k = t.dataset.mail === "monthly" ? "monthly" : "weekly", on = t.checked, was = !on;
    const name = k === "weekly" ? "отчетът всеки понеделник в 6:00" : "отчетът на 1-во число";
    const set = (v: boolean) => ownerApi.setMail({ [k]: v });
    void act(boss, { op: "setMail", args: [{ [k]: on }], label: (on ? "Включено: " : "Изключено: ") + name, run: () => set(on),
      ok: (m) => { mail = m; S.redraw(); boss.toast((on ? "Включено: " : "Изключено: ") + name, { undo: () => { void set(was).then((m2) => { mail = m2; S.redraw(); }, () => boss.toast("Не успяхме да го върнем. Опитай пак.")); } }); },
      queued: () => { if (mail) mail = { ...mail, [k]: on }; },
      fail: () => { t.checked = was; return false; } });
  });
}
function addDay(ymd: string): string { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); }
function hmNowSafe(): string { try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()); } catch { return ""; } }
