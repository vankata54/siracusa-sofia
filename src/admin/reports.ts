/* /admin/reports/: „Отчети“ (design/pages-admin/reports.html, версия 4, 1:1; ядро src/core/reports.ts).
   - Период: Днес, Вчера, 7 дни, 30 дни, Месец, Период (от-до, до 92 дни, не в бъдещето); на телефон избор. „Сравни с
     предишния“ (± % със стрелка и дума; „Днес“ се сравнява със същия ден миналата седмица до същата минута, „Вчера“ със същия ден миналата седмица, core/history.ts).
   - Числа: поръчки (+ отказани), оборот, среден бон, резервации, неявили се (%). Графики: оборот по ден (днес в червено, само
     ако днес има оборот) или по час за един ден, по канал (оборот, дял, поръчки), най-поръчвани ястия (илюстрациите),
     поръчки по час (най-натовареният в червено), резервации с неявилите отгоре. За всяка графика „Таблица“ (достъпна
     алтернатива) и подсказка при посочване. Плотът е прост SVG в токените (чете се и в тъмна тема), надписите са HTML.
   - Всички суми са „10,22 €“; само делениците на осите са цели („1000 €“, „2 поръчки“). Себестойност [ЛИПСВА].
   - „Изтегли CSV“: по дни. Без лични данни (ядрото не ги дава).
   - Без раздела „Финанси и гориво“ (управителят по подразбиране; решение 17.11) ядрото не дава суми (`money: false`):
     екранът е без „Оборот“ и „Среден бон“, графиката е поръчки по ден / час, каналът е дял от поръчките, CSV е без суми.
   Адреси: #p=today|yday|30|month|custom (7 дни по подразбиране), #c=0 без сравнение, #a=&b= за „Период“. */
import "sc-icons:export,chart-bar,list-bullets,minus,caret-up,caret-down,globe,phone,chair,briefcase,scales,sparkle,info";
import { reportsApi, ApiError, type Report, type ReportView, type Period } from "../client/api-admin-3.ts";
import { A, can, mount, toast, skel, failHTML, offline, empty, missing, soonTag, sample, sofiaYmd, sofiaHM, hm, fmtYmd, esc, ic, fmt, plural } from "./a.ts";
import { aurl } from "./routes.ts";

function readHash(): Record<string, string> { const o: Record<string, string> = {}; location.hash.slice(1).split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return o; }
function writeHash(o: Record<string, string>) {
  const h = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
  try { history.replaceState(history.state, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ }
}
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const pad = (n: number) => String(n).padStart(2, "0");
function addD(k: string, n: number) { const [y, m, d] = k.split("-").map(Number), x = new Date(Date.UTC(y, m - 1, d + n)); return x.getUTCFullYear() + "-" + pad(x.getUTCMonth() + 1) + "-" + pad(x.getUTCDate()); }
function span(a: string, b: string) { const p = (k: string) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 864e5) + 1; }
const fd = (k: string, short = false) => fmtYmd(k, short);
/** whole euros for the axis ticks only ("1000 €") */
const eur0 = (v: number) => String(Math.round(v)) + " €";

/* ---------- the columns: SVG for the plot, the text in HTML ---------- */
export interface Col { l: string; v: number; v2?: number; hi?: boolean; t: string; tv: string }
/** a round top of the axis whose half is a whole number too ("делениците на осите цели") */
export function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))), m = v / p;
  const n = (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  return Number.isInteger(n / 2) ? n : Math.max(2, Math.ceil(n / 2) * 2);
}
function colChart(id: string, items: Col[], o: { money?: boolean; xn?: number } = {}) {
  const mx = Math.max(1, ...items.map((x) => (x.v || 0) + (x.v2 || 0))), nice = niceMax(mx), n = items.length, W = n * 10, gap = n > 20 ? 1.6 : 2.6;
  const f = o.money ? eur0 : (v: number) => String(v);
  const svg = '<svg viewBox="0 0 ' + W + ' 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><g class="grid">' + [0, 0.5, 1].map((k) => '<line x1="0" x2="' + W + '" y1="' + (100 - k * 100) + '" y2="' + (100 - k * 100) + '"/>').join("") + "</g>" +
    items.map((x, i) => {
      const h = ((x.v || 0) / nice) * 100, h2 = ((x.v2 || 0) / nice) * 100, xx = i * 10 + gap / 2, w = 10 - gap;
      return '<rect class="bar' + (x.hi ? " hi" : "") + '" data-i="' + i + '" x="' + xx + '" y="' + (100 - h) + '" width="' + w + '" height="' + Math.max(h, x.v ? 0.8 : 0) + '"/>' +
        (h2 ? '<rect class="bar ns" data-i="' + i + '" x="' + xx + '" y="' + (100 - h - h2) + '" width="' + w + '" height="' + h2 + '"/>' : "");
    }).join("") + '<line class="base" x1="0" x2="' + W + '" y1="100" y2="100"/></svg>';
  const step = Math.ceil(n / (o.xn || 7)), idx: number[] = []; for (let k = 0; k < n; k += step) idx.push(k);
  if (idx[idx.length - 1] !== n - 1) { if (n - 1 - idx[idx.length - 1] < step * 0.7 && idx.length > 1) idx[idx.length - 1] = n - 1; else idx.push(n - 1); }
  return '<div class="plot" data-plot="' + id + '"><div class="ya" aria-hidden="true"><span>' + f(nice) + "</span><span>" + f(nice / 2) + "</span><span>0</span></div>" + svg +
    '<div class="xa" aria-hidden="true">' + idx.map((i, j) => {
      const tr = n === 1 ? "-50%" : j === 0 && i === 0 ? "0" : i === n - 1 ? "-100%" : "-50%", left = n === 1 ? 50 : i === 0 ? 0 : i === n - 1 ? 100 : ((i + 0.5) / n) * 100;
      return '<span style="left:' + left + "%;transform:translateX(" + tr + ')">' + esc(items[i].l) + "</span>";
    }).join("") + "</div></div>";
}
interface Tbl { head: string[]; rows: (string | number)[][] }
function tableHTML(t: Tbl) {
  return '<div class="tbl-alt"><table class="sa-table"><thead><tr>' + t.head.map((h, i) => "<th" + (i ? ' class="r"' : "") + ">" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
    t.rows.map((r) => "<tr>" + r.map((c, i) => "<td" + (i ? ' class="r" data-label="' + esc(t.head[i]) + '"' : " data-main") + ">" + esc(String(c)) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";
}

const P: [string, string][] = [["today", "Днес"], ["yday", "Вчера"], ["7", "7 дни"], ["30", "30 дни"], ["month", "Месец"], ["custom", "Период"]];
const CORE: Record<string, Period> = { today: "today", yday: "yesterday", "7": "7", "30": "30", month: "month", custom: "custom" };
const CH_IC: Record<string, string> = { web: "globe", phone: "phone", table: "chair", office: "briefcase" };
type Art = { byId: Record<string, import("../data/menu.ts").Dish>; artSvg: (x: import("../data/menu.ts").Dish) => string };

export async function initReports(): Promise<void> {
  const body = await mount({ section: "reports", title: "Отчети",
    sub: "Поръчки, оборот и среден бон за избрания период, по канал и по час, най-поръчваните ястия, резервации и неявили се. Сравнение с предишния период.",
    actions: '<button class="pill pill-line" type="button" data-csv>' + ic("export", 20) + "Изтегли CSV</button>" });
  if (!body) return;
  const root = body;
  /* the sums only with "finance" (the core sends null without it); the line under the title says the same */
  if (!can("finance")) { const sub = document.querySelector(".sa-sub"); if (sub) sub.textContent = "Поръчки за избрания период, по канал и по час, най-поръчваните ястия, резервации и неявили се. Сравнение с предишния период."; }
  const TODAY = sofiaYmd();
  const h0 = readHash();
  let per = P.some((p) => p[0] === h0.p) ? h0.p : "7", cmp = h0.c !== "0";
  const okYmd = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && s <= TODAY;
  let cust = { a: okYmd(h0.a) ? h0.a : addD(TODAY, -13), b: okYmd(h0.b) ? h0.b : TODAY };
  if (cust.a > cust.b) cust = { a: cust.b, b: cust.a };
  if (span(cust.a, cust.b) > 92) cust.a = addD(cust.b, -91);
  const showTbl: Record<string, boolean> = {};
  let R: Report | null = null, M = true, offlineNote = false, art: Art | null = null, seq = 0;
  import("./reports-art.ts").then((m) => { art = m as Art; if (R) draw(); }).catch(() => { /* the plates stay empty */ });

  const hashSync = () => writeHash({ p: per === "7" ? "" : per, c: cmp ? "" : "0", a: per === "custom" ? cust.a : "", b: per === "custom" ? cust.b : "" });
  async function load() {
    const my = ++seq;
    if (!R) root.innerHTML = skel(5, "Смятаме отчета …");
    try {
      const r = await reportsApi.get({ period: CORE[per], from: per === "custom" ? cust.a : undefined, to: per === "custom" ? cust.b : undefined, compare: cmp });
      if (my !== seq) return;
      /* with "finance" the report has every sum (Report); without it (money: false) draw() never reads a sum */
      R = r as Report; M = r.money !== false; offlineNote = false; draw();
    } catch (e) {
      if (my !== seq) return;
      if (e instanceof ApiError && e.status === 401) { location.replace(aurl.login(aurl.here())); return; }
      if (R && isOffline(e)) { offlineNote = true; draw(); return; }
      R = null; root.innerHTML = failHTML(e, "Не успяхме да сметнем отчета. Поръчките и оборотът са запазени; опитайте пак.");
    }
  }

  function pct(cur: number, prev: number) { return prev ? Math.round(((cur - prev) / prev) * 100) : null; }
  function delta(cur: number, prev: number | undefined, inv = false) {
    if (!cmp || prev == null) return "";
    const p = pct(cur, prev); if (p == null) return "";
    const up = p > 0, cls = p === 0 ? "flat" : up !== inv ? "up" : "down";
    return '<span class="dl ' + cls + '">' + ic(p === 0 ? "minus" : up ? "caret-up" : "caret-down", 16) + (p > 0 ? "+" : "") + p + "%<small>спрямо преди</small></span>";
  }
  const CHARTS: Record<string, Tbl> = {};
  function chartCard(id: string, title: string, sub: string, inner: string, table: Tbl, extra = "") {
    CHARTS[id] = table;
    return '<section class="ch" aria-labelledby="h-' + id + '" data-edit-id="admin.reports.' + id + '"><header><h2 id="h-' + id + '">' + esc(title) + (sub ? "<small>" + esc(sub) + "</small>" : "") + "</h2>" +
      '<button class="pill pill-soft tg" type="button" data-tbl="' + id + '" aria-pressed="' + !!showTbl[id] + '">' + ic(showTbl[id] ? "chart-bar" : "list-bullets", 18) + (showTbl[id] ? "Графика" : "Таблица") + "</button></header>" +
      (showTbl[id] ? tableHTML(table) : inner) + extra + "</section>";
  }
  const hh = (h: number) => pad(h) + ":00";
  let tips: Record<string, { t: string; tv: string }[]> = {};

  function draw() {
    if (!R) return;
    const r = R, y = A.scroller ? A.scroller.scrollTop : 0, one = r.from === r.to, upTo = r.until;
    const pr = r.prev;
    const head = '<div class="rp-bar"><div class="sa-tabs" role="tablist" aria-label="Период">' + P.map((p) => '<button role="tab" type="button" data-per="' + p[0] + '" aria-selected="' + (per === p[0]) + '" tabindex="' + (per === p[0] ? 0 : -1) + '">' + p[1] + "</button>").join("") + "</div>" +
        '<div class="rp-psel"><label class="vh" for="rp-p">Период</label><select class="input" id="rp-p" data-psel>' + P.map((p) => '<option value="' + p[0] + '"' + (per === p[0] ? " selected" : "") + ">" + p[1] + "</option>").join("") + "</select></div>" +
        '<label class="cmp">Сравни с предишния<span class="sa-switch"><input type="checkbox" role="switch" data-cmp' + (cmp ? " checked" : "") + '><span class="tr"></span></span></label></div>' +
      (per === "custom" ? '<div class="rp-custom"><div class="field"><label for="rp-a">От</label><input class="input" id="rp-a" type="date" max="' + TODAY + '" value="' + cust.a + '" data-ca></div><div class="field"><label for="rp-b">До</label><input class="input" id="rp-b" type="date" max="' + TODAY + '" value="' + cust.b + '" data-cb></div><p class="muted" style="margin:0 0 12px;font-size:15px">До 92 дни.</p></div>' : "") +
      '<p class="rp-meta"><span><b>' + esc(one ? fd(r.from) : fd(r.from) + " - " + fd(r.to)) + "</b>" +
        (cmp && pr ? " · спрямо " + esc(pr.from === pr.to ? fd(pr.from) + (upTo ? " до " + upTo : "") : fd(pr.from) + " - " + fd(pr.to)) : "") + "</span>" +
        (cmp && pr && !pr.orders && !pr.cancelled && !pr.reservations ? "<span>Предишният период няма данни за сравнение.</span>" : "") + (r.sample ? sample("Има примерни поръчки") : "") + "</p>";
    const off = offlineNote ? offline("Показваме последно сметнатия отчет. Числата се обновяват, щом връзката се върне.") + '<div style="height:16px"></div>' : "";
    if (!r.orders && !r.reservations && !r.cancelled) {
      root.innerHTML = off + head + '<div class="sa-card">' + empty({ icon: "chart-bar", title: "Няма поръчки за този период.", text: per === "today" ? "Поръчките за днес ще се появят тук от 10:00." : "Изберете друг период.",
        action: per === "30" ? "" : '<button class="pill pill-line pill-lg" type="button" data-per="30">Последните 30 дни</button>' }) + "</div>";
      if (A.scroller) A.scroller.scrollTop = y; return;
    }
    const hrs = r.byHour, pk = hrs.reduce((a, h) => (h.orders > a.orders ? h : a), { hour: -1, orders: 0, revenue: 0 });
    /* without money the main chart counts the orders (by day; for one day the hours are already "Поръчки по час") */
    const sumTv = (rev: number, n: number) => (M ? fmt(rev) + " · " : "") + plural(n, "поръчка", "поръчки");
    const main: Col[] = one ? hrs.map((h) => ({ l: hh(h.hour), v: M ? h.revenue : h.orders, t: hh(h.hour) + " - " + pad(h.hour) + ":59", tv: sumTv(h.revenue, h.orders) }))
      : r.byDay.map((d) => ({ l: fd(d.date, true).replace(/^.., /, ""), v: M ? d.revenue : d.orders, hi: d.date === TODAY && (M ? d.revenue : d.orders) > 0, t: fd(d.date), tv: sumTv(d.revenue, d.orders) }));
    const todayRed = !one && r.byDay.some((d) => d.date === TODAY && (M ? d.revenue : d.orders) > 0);
    const chMax = Math.max(1, ...r.byChannel.map((c) => (M ? c.revenue : c.orders))), tq = r.top.length ? r.top[0].q : 1, nsr = r.noShowPct;
    const picOf = (id: string, n: string) => { const d = art && art.byId[id]; return d ? '<div class="pic" role="img" aria-label="' + esc(n) + ' (илюстрация)">' + art!.artSvg(d) + "</div>" : '<div class="pic" aria-hidden="true"></div>'; };
    tips = {
      main,
      hour: hrs.map((h) => ({ t: hh(h.hour) + " - " + pad(h.hour) + ":59", tv: plural(h.orders, "поръчка", "поръчки") })),
      res: r.byDay.map((d) => ({ t: fd(d.date), tv: plural(d.reservations, "резервация", "резервации") + (d.noShows ? ", " + d.noShows + " неявили се" : "") })),
    };
    root.innerHTML = off + head +
      '<div class="kp' + (M ? "" : " n3") + '" data-edit-id="admin.reports.kpi">' +
        '<div><span class="l">Поръчки' + (r.cancelled ? " (+" + r.cancelled + " отказ" + (r.cancelled === 1 ? "ана" : "ани") + ")" : "") + "</span><b>" + r.orders + "</b>" + delta(r.orders, pr?.orders) + "</div>" +
        (M ? '<div><span class="l">Оборот</span><b>' + fmt(r.revenue) + "</b>" + delta(r.revenue, pr?.revenue) + "</div>" +
          '<div><span class="l">Среден бон</span><b>' + fmt(r.avg) + "</b>" + delta(r.avg, pr?.avg) + "</div>" : "") +
        '<div><span class="l">Резервации</span><b>' + r.reservations + "</b>" + delta(r.reservations, pr?.reservations) + "</div>" +
        '<div><span class="l">Неявили се</span><b>' + r.noShows + (r.reservations ? ' <span style="font-size:18px;color:var(--muted)">(' + nsr + "%)</span>" : "") + "</b>" + delta(r.noShows, pr?.noShows, true) + "</div></div>" +
      '<div class="rp-g two">' +
        (M || !one ? chartCard("main", M ? (one ? "Оборот по час" : "Оборот по ден") : "Поръчки по ден", one ? fd(r.from) : todayRed ? "Днес" + (r.to === TODAY ? " (до " + hhNow() + ")" : "") + " е в червено" : "", colChart("main", main, { money: M, xn: one ? 7 : 6 }),
          M ? { head: one ? ["Час", "Оборот", "Поръчки"] : ["Ден", "Оборот", "Поръчки"], rows: one ? hrs.map((h) => [hh(h.hour), fmt(h.revenue), h.orders]) : r.byDay.map((d) => [fd(d.date), fmt(d.revenue), d.orders]) }
            : { head: ["Ден", "Поръчки"], rows: r.byDay.map((d) => [fd(d.date), d.orders]) }) : "") +
        chartCard("ch", "По канал", M ? "Оборот и дял" : "Поръчки и дял", '<div class="rp-hb">' + r.byChannel.slice().sort((a, b) => (M ? b.revenue - a.revenue : b.orders - a.orders)).map((c) =>
          '<div class="r"><span class="n">' + ic(CH_IC[c.channel] || "globe", 18).replace('class="ic"', 'class="ic" style="display:inline-block;vertical-align:-3px;margin-right:6px;color:var(--muted)"') + esc(c.label) + '</span><span class="v">' + (M ? fmt(c.revenue) + "<small>" + c.share + "% · " + c.orders + "</small>" : plural(c.orders, "поръчка", "поръчки") + "<small>" + c.share + "%</small>") + '</span><span class="tr" aria-hidden="true"><i style="width:' + ((M ? c.revenue : c.orders) / chMax) * 100 + '%"></i></span></div>').join("") + "</div>",
          M ? { head: ["Канал", "Оборот", "Дял", "Поръчки"], rows: r.byChannel.map((c) => [c.label, fmt(c.revenue), c.share + "%", c.orders]) }
            : { head: ["Канал", "Поръчки", "Дял"], rows: r.byChannel.map((c) => [c.label, c.orders, c.share + "%"]) },
          '<p class="muted" style="margin:0;font-size:15px">„Сайт“ е доставка и вземане от сайта; „Маса“ е QR масата и сервитьорът.</p>') +
      '</div><div style="height:16px"></div><div class="rp-g two">' +
        chartCard("top", "Най-поръчвани ястия", "По бройки за периода", r.top.length ? '<div class="rp-top">' + r.top.map((t, i) => '<div class="r"><span class="k">' + (i + 1) + "</span>" + picOf(t.id, t.name) + '<span class="n"><b>' + esc(t.name) + '</b><span class="tr" aria-hidden="true"><i style="width:' + (t.q / tq) * 100 + '%"></i></span></span><span class="v">' + t.q + (M ? "<small>" + fmt(t.revenue) + "</small>" : "") + "</span></div>").join("") + "</div>"
          : '<p class="muted" style="margin:0">Още няма поръчани ястия за периода.</p>',
          M ? { head: ["Ястие", "Бройки", "Оборот"], rows: r.top.map((t) => [t.name, t.q, fmt(t.revenue)]) } : { head: ["Ястие", "Бройки"], rows: r.top.map((t) => [t.name, t.q]) }) +
        '<div style="display:grid;gap:16px;align-content:start">' +
        chartCard("hour", "Поръчки по час", pk.orders ? "Най-натоварено: " + hh(pk.hour) : "", colChart("hour", hrs.map((h) => ({ l: hh(h.hour), v: h.orders, hi: h.hour === pk.hour && pk.orders > 0, t: "", tv: "" })), { xn: 7 }),
          { head: ["Час", "Поръчки"], rows: hrs.map((h) => [hh(h.hour), h.orders]) }) +
        chartCard("res", "Резервации и неявили се", "", one ? '<div class="rp-hb"><div class="r"><span class="n">Резервации</span><span class="v">' + r.reservations + '</span></div><div class="r"><span class="n">Неявили се</span><span class="v">' + r.noShows + "</span></div></div>" :
          colChart("res", r.byDay.map((d) => ({ l: fd(d.date, true).replace(/^.., /, ""), v: d.reservations - d.noShows, v2: d.noShows, t: "", tv: "" })), { xn: 6 }) + '<ul class="lgd"><li><i></i>Дошли и предстоящи</li><li><i class="r"></i>Неявили се</li></ul>',
          { head: ["Ден", "Резервации", "Неявили се"], rows: r.byDay.map((d) => [fd(d.date), d.reservations, d.noShows]) }) +
        "</div></div>" +
      (M ? '<div style="height:16px"></div><section class="ch cost" data-edit-id="admin.reports.cost"><span class="ill">' + ic("scales", 30) + '</span><h2>Печалба по ястие</h2><p class="muted" style="margin:0">Матрицата „популярност срещу печалба“ и марж на ястие искат себестойност: ' + missing("себестойност на ястията") + ". Щом се въведе в менюто, отчетът се появява тук.</p></section>" : "") +
      '<div style="height:16px"></div><div class="rp-soon">' + soonTag() + "<span><b>Отчети по имейл</b> всеки понеделник в 6:00 и на 1-во число (PDF), известие при отклонение.</span></div>";
    if (A.scroller) A.scroller.scrollTop = y;
    bindTips();
  }
  function hhNow() { return R && R.until ? R.until : hm(sofiaHM()); }
  /* ---------- the tip on hover ---------- */
  function bindTips() {
    root.querySelectorAll<HTMLElement>("[data-plot]").forEach((pl) => {
      const data = tips[pl.dataset.plot!]; if (!data) return;
      const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; pl.appendChild(tip);
      pl.addEventListener("pointermove", (e) => {
        const svg = pl.querySelector("svg")!, rc = svg.getBoundingClientRect(), i = Math.floor(((e.clientX - rc.left) / rc.width) * data.length);
        if (i < 0 || i >= data.length) { tip.hidden = true; return; }
        pl.querySelectorAll<SVGElement>(".bar").forEach((b) => b.classList.toggle("on", +(b.dataset.i || -1) === i));
        const pr = pl.getBoundingClientRect(); tip.hidden = false; tip.innerHTML = esc(data[i].tv) + "<small>" + esc(data[i].t) + "</small>";
        tip.style.left = Math.max(70, Math.min(pr.width - 70, rc.left - pr.left + ((i + 0.5) / data.length) * rc.width)) + "px"; tip.style.top = "0px";
      });
      pl.addEventListener("pointerleave", () => { tip.hidden = true; pl.querySelectorAll(".bar.on").forEach((b) => b.classList.remove("on")); });
    });
  }

  /* ---------- events ---------- */
  root.addEventListener("click", (e) => {
    const t = e.target as Element; let el: HTMLElement | null;
    if (t.closest('[data-sa="retry"]')) { e.stopPropagation(); R = null; load(); return; }
    if ((el = t.closest<HTMLElement>("[data-per]"))) { per = el.dataset.per!; hashSync(); load().then(() => root.querySelector<HTMLElement>('[role="tab"][data-per="' + per + '"]')?.focus({ preventScroll: true })); return; }
    if ((el = t.closest<HTMLElement>("[data-tbl]"))) { const id = el.dataset.tbl!; showTbl[id] = !showTbl[id]; draw(); root.querySelector<HTMLElement>('[data-tbl="' + id + '"]')?.focus({ preventScroll: true }); return; }
  });
  root.addEventListener("keydown", (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.rp-bar [role="tab"]'); if (!b || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return; e.preventDefault();
    const i = P.findIndex((p) => p[0] === b.dataset.per), n = P[(i + (e.key === "ArrowRight" ? 1 : P.length - 1)) % P.length][0];
    per = n; hashSync(); load().then(() => root.querySelector<HTMLElement>('[role="tab"][data-per="' + per + '"]')?.focus());
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-psel]")) { per = t.value; hashSync(); load().then(() => root.querySelector<HTMLElement>("[data-psel]")?.focus({ preventScroll: true })); return; }
    if (t.matches("[data-cmp]")) { cmp = t.checked; hashSync(); load(); return; }
    if (t.matches("[data-ca], [data-cb]")) {
      let a = root.querySelector<HTMLInputElement>("[data-ca]")!.value, b = root.querySelector<HTMLInputElement>("[data-cb]")!.value; if (!a || !b) return;
      if (a > b) [a, b] = [b, a];
      if (b > TODAY) b = TODAY;
      if (span(a, b) > 92) { a = addD(b, -91); toast("До 92 дни: началото е преместено на " + fd(a)); }
      cust = { a, b }; hashSync(); load();
    }
  });
  document.addEventListener("click", (e) => {
    if (!(e.target as Element).closest("[data-csv]")) return;
    if (!R) { toast("Отчетът още се смята."); return; }
    const rows = M ? [["Ден", "Поръчки", "Оборот €", "Среден бон €", "Резервации", "Неявили се"]].concat(R.byDay.map((d) => [d.date, String(d.orders), d.revenue.toFixed(2).replace(".", ","), (d.orders ? d.revenue / d.orders : 0).toFixed(2).replace(".", ","), String(d.reservations), String(d.noShows)]))
      : [["Ден", "Поръчки", "Резервации", "Неявили се"]].concat(R.byDay.map((d) => [d.date, String(d.orders), String(d.reservations), String(d.noShows)]));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.join(";")).join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "siracusa-otchet-" + R.from + "-" + R.to + ".csv"; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast("Отчетът е изтеглен (CSV)");
  });
  await load();
}
