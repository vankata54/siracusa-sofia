/* Siracusa · "Собственик" › "Днес" (/sobstvenik/): port of design/pages-sobstvenik/today.html over the core
   (ownerApi.today, src/core/owner.ts). The main number "Днес: X € от N поръчки" is the admin dashboard's number; ONE
   comparison (decision 16.11): the turnover against "обичайното за <ден> до <час>" (the same weekday in the last 4 weeks
   up to this minute), the sign + % + word; "Миналия <ден> по това време" is a sum on a second line, without a percent.
   The alert at 20% either way (only with 10+ usual orders, the core decides). "Чака те" only for the owner (the main
   admin: the notes to approve). The turnover by hour cumulative against the usual (a line, "сега", "Таблица"); "На живо";
   by channel (5 rows); the last 7 days (today red, a week earlier as a line). A new restaurant without history: "Още
   събираме история. Сравнението идва след 4 седмици." "Примерни данни" only when the core marks the orders. */
import "sc-icons:wallet,caret-right,truck,storefront,phone,chair,briefcase,users-three,hourglass,warning,check-circle,chart-bar,warning-circle,chat-circle-dots,pencil-simple";
import { mountBoss, delta, type Boss } from "../boss/frame.ts";
import { ownerApi, type OwnerToday } from "../../client/api-boss.ts";
import { ic, esc, plural, fmt, fd, eur0, sample, banner, go, screen, miss } from "./common.ts";
import { card, line, cols, hbars, legend, bindTips } from "./charts.ts";

export async function initToday(): Promise<void> {
  const boss = await mountBoss({ module: "sobstvenik", tab: "today", title: "Днес", search: { load: () => import("./find.ts").then((m) => m.provider(boss!)) } });
  if (!boss) return;
  todayScreen(boss);
}

const CH_IC: Record<string, string> = { delivery: "truck", pickup: "storefront", phone: "phone", table: "chair", office: "briefcase" };
/* the shift clock: after midnight is still the evening (00:30 = 24:30; the day starts at 04:00) */
const toMin = (hm: string) => { const m = +hm.slice(0, 2) * 60 + +hm.slice(3, 5); return m < 240 ? m + 1440 : m; };

function todayScreen(boss: Boss): void {
  boss.body.innerHTML = boss.skeleton(4, "Зареждаме деня…");
  screen<OwnerToday>(boss, {
    load: () => ownerApi.today(), draw, err: "Поръчките са запазени. Опитай пак след малко.",
    after: (d) => { bindTips(boss.body); boss.badge("decisions", d.waits.blocks + (d.waits.next ? 1 : 0), ["чака теб", "чакат теб"]); },
    live: ["order.created", "order.new", "order.status", "order.changed", "reservation.created", "reservation.status", "note.created", "note.status", "floor.session", "owner.answer", "driver.course"],
  });
  boss.body.addEventListener("click", (e) => {
    const g = (e.target as Element).closest<HTMLElement>("[data-goto]"); if (!g) return;
    const t = document.getElementById(g.dataset.goto!);
    if (t) { t.scrollIntoView({ block: "start", behavior: "smooth" }); const h = t.querySelector<HTMLElement>("h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({ preventScroll: true }); } }
  });
  let jumped = false;
  function jump() {
    if (jumped) return; jumped = true;
    const k = /channels/.test(location.hash) ? "channels" : /hourly/.test(location.hash) ? "hourly" : "";
    const t = k && document.getElementById(k); if (t) setTimeout(() => t.scrollIntoView({ block: "start" }), 60);
  }

  /** a new restaurant: no order on any day before today (the usual, the last 7 and the 7 before them are empty) */
  const noHistory = (d: OwnerToday) => d.usual.withData === 0 && d.last7.weekAgo.orders === 0 && d.last7.days.every((x) => x.date === d.date || x.orders === 0);

  function draw(d: OwnerToday): string {
    setTimeout(jump, 0);
    const money = d.money, empty = noHistory(d), now = d.now, dayName = d.weekday;
    const sumTxt = (v: number | null) => (v == null ? "" : fmt(v));
    let h = "";
    if (empty) h += '<div class="ow-grid"><div class="wall">' + banner({ icon: "hourglass", title: "Още събираме история", text: "Сравнението с обичайното идва след 4 седмици. Дотогава виждаш числата за днес." }) + "</div></div>";
    else if (d.alert) h += '<div class="ow-grid"><div class="wall td-alert" data-edit-id="own.today.alert">' + banner({ tone: d.alert.dir === "down" ? "warn" : "ok", icon: d.alert.dir === "down" ? "warning" : "check-circle", title: d.alert.text,
      text: '<span class="ow-muted">' + esc(d.alert.sub).replace(/ €/g, "\u00a0€") + " (средно от същия ден в последните 4 седмици).</span>" + (d.sample ? " " + sample() : ""),
      action: money ? '<button class="pill pill-line" type="button" data-goto="hourly">' + ic("chart-bar", 20) + "Виж по час</button>" : "" }) + "</div></div>";
    h += '<div class="ow-grid td-grid">';
    /* the main number */
    const vs = "от обичайното за " + dayName + " до " + now;
    h += '<section class="td-hero w2" aria-labelledby="td-h" data-edit-id="own.today.sales"><div class="l">' + ic("wallet", 20) + '<span id="td-h">Днес · ' + esc(fd(d.date)) + " · до " + esc(now) + "</span></div>" +
      "<div>" + (money ? '<div class="sum">' + fmt(d.sales.sum || 0) + '</div><div class="of">' + (d.sales.n ? "от " + plural(d.sales.n, "поръчка", "поръчки") : "Още няма поръчки днес") + "</div>"
        : '<div class="sum">' + d.sales.n + '</div><div class="of">' + (d.sales.n === 1 ? "поръчка" : "поръчки") + "</div>") + "</div>" +
      (empty ? "" : '<div class="cmp">' + (money ? delta(d.sales.sum || 0, d.usual.sum || 0, { chip: true, vs, none: '<span class="lw">Обичайното за ' + esc(dayName) + " до " + esc(now) + ": още няма поръчки</span>" })
        : delta(d.sales.n, d.usual.orders, { chip: true, vs, none: "" })) +
        '<span class="lw">' + esc(d.lastWeek.label) + ": <b>" + (money ? sumTxt(d.lastWeek.sum) : plural(d.lastWeek.orders, "поръчка", "поръчки")) + "</b></span></div>") +
      '<div class="mini">' + (money ? '<div><span class="k">Среден бон</span><b>' + fmt(d.avg.value || 0) + "</b>" + (empty ? "" : delta(d.avg.value || 0, d.avg.usual || 0, { vs: "от обичайния" })) + "</div>" : "") +
        '<div><span class="k">Отказани днес</span><b>' + d.cancelled + '</b><span class="ow-note">не влизат в оборота</span></div></div>' +
      '<div class="ft">' + (d.sample ? sample() : "<span></span>") + '<a class="link" href="' + go.reports("today") + '">Пълният отчет в админа' + ic("caret-right", 18) + "</a></div></section>";
    h += waits(d);
    if (money && d.byHour) h += hourly(d, empty);
    h += liveCard(d);
    h += channels(d);
    h += week(d, empty);
    h += "</div>";
    return h;
  }

  /* "Чака те": only for the owner (the main admin: the notes to approve) */
  function waits(d: OwnerToday): string {
    const w = d.waits, W: { n: number; icon: string; title: string; sub: string; more?: string; href: string; go: string }[] = [];
    if (w.blocks) W.push({ n: w.blocks, icon: "warning-circle", title: "Неявили се за решение", sub: "Две неявявания: блокиране или не", href: go.decisions("noshow"), go: "Реши" });
    if (w.next) W.push({ n: 1, icon: "chat-circle-dots", title: "Следващ въпрос от агенцията", sub: w.next.text.length > 70 ? w.next.text.slice(0, 68).replace(/\s+\S*$/, "") + " …" : w.next.text, more: w.unanswered > 1 ? "Още " + (w.unanswered - 1) + " чакат отговор" : "", href: go.decisions("q=" + w.next.id), go: "Отговори" });
    if (boss.role === "admin") { if (w.notes.newN) W.push({ n: w.notes.newN, icon: "pencil-simple", title: "Бележки за одобрение", sub: "Нови бележки и препоръки", href: go.notes("s=new"), go: "Одобри" }); }
    else if (w.notes.n) W.push({ n: w.notes.n, icon: "pencil-simple", title: "Твоите препоръки", sub: w.notes.n === 1 ? "1 твоя препоръка е с нов статус" : w.notes.n + " твои препоръки са с нов статус", href: go.notes("src=" + boss.role), go: "Виж" });
    return '<section class="ow-card td-wait" aria-labelledby="td-w" data-edit-id="own.today.waiting"><header><div><h2 id="td-w">Чака те</h2></div></header>' +
      (W.length ? "<div>" + W.map((x) => '<a class="ow-li" href="' + x.href + '"><span class="si">' + ic(x.icon, 22) + '</span><span class="tx"><b><span class="wcnt" aria-hidden="true">' + x.n + "</span>" + esc(x.title) + "</b>" + (x.sub ? "<small>" + esc(x.sub) + "</small>" : "") + (x.more ? '<span class="more">' + esc(x.more) + "</span>" : "") + '</span><span class="end"><span class="pill pill-ink">' + esc(x.go) + "</span></span></a>").join("") + "</div>"
        : '<p class="td-ok">' + ic("check-circle", 26) + "<span><b>Нищо не чака.</b> Всичко е наред.</span></p>") + "</section>";
  }

  /* the turnover by hour: cumulative from 10:00 against the usual, every 15 min */
  function hourly(d: OwnerToday, empty: boolean): string {
    const b = d.byHour!, n = b.labels.length, nowMin = toMin(d.now), before = nowMin < 600;
    const nowX = nowMin >= 600 && nowMin <= 1380 ? ((nowMin - 600) / b.step / (n - 1)) * 100 : null;
    const cur = before ? b.cur.map(() => null) : b.cur;
    const last = cur.filter((v): v is number => v != null).pop();
    const rows: string[][] = [];
    for (let hh = 10; hh <= 23; hh++) { const j = ((hh - 10) * 60) / b.step; if (j < n) rows.push([b.labels[j], cur[j] == null ? "-" : fmt(cur[j] as number), empty ? "-" : fmt(b.usual[j])]); }
    const inner = (before ? '<p class="ow-note">Поръчките за днес се появяват тук от 10:00.</p>' : "") +
      line("hour", b.labels, cur, empty ? null : b.usual, { fmt, fmt0: eur0, ticks: [0, 16, 32, 48], curName: "Днес", prevName: "Обичайно", nowX, curLabel: before || last == null || !d.sales.n ? "" : fmt(d.sales.sum || 0) }) +
      legend(empty ? [["Днес, натрупано от 10:00", "ln"]] : [["Днес, натрупано от 10:00", "ln"], ["Обичайно за " + d.weekday, "ln prev"]]) + (empty ? '<p class="ow-note">Обичайното идва след 4 седмици.</p>' : "");
    return card({ page: "today", id: "hour", anchor: "hourly", cls: "w2", title: "Оборот по час", inner, table: { head: ["Час", "Днес", "Обичайно"], rows }, extra: !empty && d.sample ? "<p>" + sample("Обичайното: примерни данни") + "</p>" : "" });
  }

  /* "На живо": the same numbers as the manager's module */
  function liveCard(d: OwnerToday): string {
    const nowM = toMin(d.now), L = d.live, r = L.reservations;
    return '<section class="ow-card" aria-labelledby="td-l" data-edit-id="own.today.live"><header><div><h2 id="td-l">На живо</h2><small>' + (nowM >= 1350 || nowM < 600 ? "Кухнята не работи сега" : "Обновява се само") + "</small></div></header>" +
      '<div class="td-live"><a href="' + go.orders("s=work") + '"><b>' + L.inWork + "</b><span>в работа</span></a>" +
      '<a href="' + go.hall() + '"><b>' + L.tables.busy + "<small> от " + L.tables.total + "</small></b><span>заети маси</span></a>" +
      '<a href="' + go.reservations() + '"><b>' + r.ahead + "</b><span>" + (nowM >= 1020 ? "резервации тази вечер" : "резервации до края на деня") + (r.aheadPeople ? " · " + plural(r.aheadPeople, "човек", "души") : "") + "</span></a></div>" +
      (L.tables.missing || d.sample ? '<p class="ow-note">' + (L.tables.missing ? "Масите са условни: " + miss(L.tables.missing) : "") + (d.sample ? " " + sample() : "") + "</p>" : "") +
      '<a class="pill pill-red pill-lg pill-block" href="' + go.shift() + '">' + ic("users-three", 22) + "Смяната сега</a></section>";
  }

  /* by channel: the share with a word */
  function channels(d: OwnerToday): string {
    const money = d.money, tot = d.byChannel.reduce((a, c) => a + (money ? c.revenue || 0 : c.orders), 0);
    const share = (c: OwnerToday["byChannel"][number]) => (tot ? Math.round(((money ? c.revenue || 0 : c.orders) / tot) * 100) : 0);
    const rows = d.byChannel.map((c) => ({ n: c.label, icon: CH_IC[c.key], v: money ? c.revenue || 0 : c.orders, vt: money ? fmt(c.revenue || 0) : String(c.orders),
      sub: money ? plural(c.orders, "поръчка", "поръчки") + " · " + share(c) + "% от оборота" : share(c) + "% от поръчките" }));
    return card({ page: "today", id: "ch", anchor: "channels", title: "По канал", sub: money ? "Оборот днес" : "Поръчки днес", inner: hbars(rows),
      table: money ? { head: ["Канал", "Оборот", "Поръчки", "Дял от оборота"], rows: d.byChannel.map((c) => [c.label, fmt(c.revenue || 0), c.orders, share(c) + "%"]) }
        : { head: ["Канал", "Поръчки", "Дял от поръчките"], rows: d.byChannel.map((c) => [c.label, c.orders, share(c) + "%"]) } });
  }

  /* the last 7 days: the same number as "Отчети" for 7 days; today red, a week earlier as a line */
  function week(d: OwnerToday, empty: boolean): string {
    const money = d.money, L = d.last7, v = (x: { orders: number; revenue: number | null }) => (money ? x.revenue || 0 : x.orders);
    const items = L.days.map((x) => ({ l: x.short, v: money ? Math.round(x.revenue || 0) : x.orders, hi: x.date === d.date, t: fd(x.date) + (x.date === d.date ? " (до " + d.now + ")" : ""), tv: (money ? fmt(x.revenue || 0) + " · " : "") + plural(x.orders, "поръчка", "поръчки") }));
    const tot = L.total, wa = L.weekAgo;
    const inner = '<div class="ow-row" style="align-items:baseline;gap:6px 14px"><span class="ow-big">' + (money ? fmt(tot.revenue || 0) : plural(tot.orders, "поръчка", "поръчки")) + "</span>" + (empty ? "" : delta(v(tot), v(wa), { vs: "от 7-те дни преди това" })) + "</div>" +
      (money ? '<p class="ow-note">' + plural(tot.orders, "поръчка", "поръчки") + " · среден бон " + fmt(tot.orders ? (tot.revenue || 0) / tot.orders : 0) + "</p>" : "") +
      cols("week", items, { fmt: money ? eur0 : undefined, prev: empty ? null : L.days.map((x) => v(x.weekAgo)), prevTip: (i) => " · 7 дни по-рано" + (i === L.days.length - 1 ? " (до " + d.now + ")" : "") + " " + (money ? fmt(L.days[i].weekAgo.revenue || 0) : String(L.days[i].weekAgo.orders)) }) +
      legend(empty ? [["Последните 7 дни"], ["Днес (до " + d.now + ")", "r"]] : [["Последните 7 дни"], ["Днес (до " + d.now + ")", "r"], ["7 дни по-рано", "ln prev"]]) +
      '<div class="ow-row" style="justify-content:space-between">' + (d.sample ? sample() : "<span></span>") + '<a class="link" href="' + go.trends() + '">Към тенденциите' + ic("caret-right", 18) + "</a></div>";
    return card({ page: "today", id: "week", cls: "w2 td-week", title: "Последните 7 дни", sub: fd(L.days[0].date, true) + " - " + fd(L.days[L.days.length - 1].date, true), inner,
      table: { head: money ? ["Ден", "Оборот", "Поръчки", "7 дни по-рано"] : ["Ден", "Поръчки", "7 дни по-рано"],
        rows: L.days.map((x) => (money ? [fd(x.date, true), fmt(x.revenue || 0), x.orders, empty ? "-" : fmt(x.weekAgo.revenue || 0)] : [fd(x.date, true), x.orders, empty ? "-" : x.weekAgo.orders])) } });
  }
}
