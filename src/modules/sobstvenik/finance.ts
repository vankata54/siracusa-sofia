/* Siracusa · "Собственик" › "Финанси и гориво" (/sobstvenik/finansi/): port of design/pages-sobstvenik/finance.html
   over the core (ownerApi.finance: 403 without "Финанси и гориво" -> the frame's "Нямаш права за този екран."). The same
   period and comparison as "Тенденции"; the revenue by payment ("В брой", "Карта при получаване", "Ваучер"; at the
   tables cash and card); the fuel by day, driver and car (the drivers' fuel entries, core/driver.ts fuelReport), l/100 km
   where two full-tank entries allow; one delivery's fuel against the fee of each quarter ([ЛИПСВА] where unknown); the
   saving of the shorter way only when the core gives a number (it does not: the honest empty text); the drivers' cash
   today (to hand / handed); the food cost [ЛИПСВА]; "Изтегли CSV" (the core's rows). */
import "sc-icons:house,caret-right,money,credit-card,ticket,user,scales,hourglass,check-circle,wallet,gas-pump,car,map-pin";
import { mountBoss, delta, type Boss } from "../boss/frame.ts";
import { ownerApi, type OwnerFinance } from "../../client/api-boss.ts";
import { ic, esc, plural, fmt, fd, dayL, eur0, f1, sample, miss, go, screen, perFromHash, perHash, periodHTML, perWords, bindPeriod, query, decBadge, downloadCsv, csvBtn, hmNow, NONE, cutNotice, type PerWords } from "./common.ts";
import { card, cols, hbars, legend, bindTips } from "./charts.ts";

export async function initFinance(): Promise<void> {
  const boss = await mountBoss({ module: "sobstvenik", tab: "finance", title: "Финанси и гориво", needs: ["finance"], search: { load: () => import("./find.ts").then((m) => m.provider(boss!)) } });
  if (!boss) return;
  financeScreen(boss);
}
const l1 = (v: number) => f1(v) + " л";

function financeScreen(boss: Boss): void {
  const P = perFromHash(), body = boss.body;
  let words: PerWords | null = null;
  body.innerHTML = periodHTML(P) + boss.skeleton(5, "Смятаме финансите…");
  const S = screen<OwnerFinance>(boss, {
    load: () => ownerApi.finance(query(P)), draw, err: "Нищо не е изгубено. Опитай пак след малко.", top: () => periodHTML(P), noRights: "finance",
    bad: () => { if (P.per !== "custom") return false; P.per = "7"; perHash(P); return true; },
    after: () => bindTips(body),
    live: ["order.created", "order.status", "order.changed", "driver.course", "shift.update", "floor.session"], every: 120_000,
  });
  decBadge(boss);
  bindPeriod(boss, P, () => S.reload(false), () => words);
  if (P.cut) { perHash(P); boss.toast(cutNotice(P)); }
  let jumped = false;
  function jump() {
    if (jumped) return; jumped = true;
    ["fuel", "cash", "pay", "cost"].forEach((k) => { if (new RegExp("(^#|&)" + k + "($|&)").test(location.hash)) setTimeout(() => document.getElementById(k)?.scrollIntoView({ block: "start" }), 60); });
  }

  function draw(d: OwnerFinance): string {
    setTimeout(jump, 0);
    const W = perWords(P, d); words = W;
    const dl = (a: number, b: number, inv = false) => delta(a, b, { inv, none: NONE });
    let h = periodHTML(P);
    const noData = !d.revenue.cur && !d.fuel.total.n, fresh = !d.history;
    h += '<div class="fi-acts"><p class="ow-meta"><span><b>' + esc(W.label) + "</b> · спрямо " + esc(W.cmpLabel) + "</span>" + (d.sample ? sample() : "") + "</p>" + (noData || fresh ? "" : csvBtn()) + "</div>";
    /* a new restaurant: no day before today (the prototype's "Без история"); today's cash below */
    if (fresh) {
      h += '<section class="ow-card">' + boss.empty({ icon: "hourglass", title: "Още събираме история", text: "Финансите за минали дни и сравнението идват след 4 седмици. Днешните пари в брой са по-долу.",
        action: '<a class="pill pill-line pill-lg" href="' + go.today() + '">' + ic("house", 22) + "Към „Днес“</a>" }) + "</section>";
      return h + '<div class="ow-mas">' + cashCard(d) + "</div>";
    }
    if (noData) {
      h += '<section class="ow-card">' + boss.empty({ icon: "wallet", title: "Няма приходи за този период", text: P.per === "today" ? "Поръчките за днес се появяват тук от 10:00. Парите в брой от шофьорите са по-долу." : "Избери друг период.",
        action: P.per === "30" ? "" : '<button class="pill pill-line pill-lg" type="button" data-per="30">Последните 30 дни</button>' }) + "</section>";
      return h + '<div class="ow-mas">' + cashCard(d) + "</div>";
    }
    const F = d.fuel.total, PF = d.prevFuel, per = d.delivery.fuelPer, pper = d.delivery.prevFuelPer, km = d.km;
    const kpi = (l: string, v: string, dd: string) => '<div class="ow-kpi"><span class="l">' + esc(l) + "</span><b>" + v + "</b>" + (dd || "") + "</div>";
    h += '<div class="ow-kpis fi-kpis" data-edit-id="own.finance.kpi">' + kpi("Приходи", fmt(d.revenue.cur), dl(d.revenue.cur, d.revenue.prev)) + kpi("Гориво", fmt(F.sum), dl(F.sum, PF.sum, true)) +
      kpi("Гориво на доставка", per == null ? "-" : fmt(per), per != null && pper != null ? dl(per, pper, true) : per != null ? NONE : "") +
      kpi("Изминати", km.cur == null ? "-" : Math.round(km.cur).toLocaleString("bg-BG") + " <small>км</small>", km.cur == null ? '<span class="ow-note">' + miss("[ЛИПСВА: километри от смените на шофьорите]") + "</span>" : dl(km.cur, km.prev || 0, true)) + "</div>";
    h += '<div class="ow-grid">' + fuelDays(d, W) + "</div>";
    h += '<div class="ow-mas">' + pay(d, W) + byDriver(d) + cashCard(d) + byCar(d) + delivery(d) + saved() +
      '<section class="ow-card fi-cost" id="cost" aria-labelledby="h-co" data-edit-id="own.finance.cost"><span class="ill">' + ic("scales", 28) + '</span><h2 id="h-co">Себестойност на храната</h2><p>Печалба по ястие се смята, щом в менюто има себестойност: ' + miss(d.cost) + ".</p></section></div>";
    h += '<p class="ow-note" style="margin:4px 4px 0">Поръчките и оборотът по дни: <a class="link" href="' + go.reports(P.per === "custom" ? "custom&a=" + P.a + "&b=" + P.b : P.per) + '">Отчети в админа' + ic("caret-right", 18) + "</a></p>";
    return h;
  }

  /* the fuel by day (for one day: three numbers) */
  function fuelDays(d: OwnerFinance, W: PerWords): string {
    const F = d.fuel.total, PF = d.prevFuel, by = new Map(d.fuel.byDay.map((x) => [x.date, x])), days: string[] = [];
    for (let x = d.from; x <= d.to; x = addDay(x)) days.push(x);
    const row = (k: string) => by.get(k) || { date: k, n: 0, litres: 0, sum: 0 };
    const t0 = days[days.length - 1], hasToday = !!d.until || t0 === todayLocal(), pf = d.prevFuelDays;
    const inner = !F.n && !PF.n ? '<p class="ow-note">Няма зареждания за този период. Шофьорите ги записват в „Гориво“ на телефона си.</p>' : W.one
      ? '<div class="tr-two fi-three"><div><span class="k">Литри</span><b>' + l1(F.litres) + "</b>" + delta(F.litres, PF.litres, { inv: true }) + '</div><div><span class="k">Сума</span><b>' + fmt(F.sum) + "</b>" + delta(F.sum, PF.sum, { inv: true }) + '</div><div><span class="k">Зареждания</span><b>' + F.n + "</b>" + delta(F.n, PF.n, { inv: true }) + "</div></div>"
      : cols("fuel", days.map((k) => { const x = row(k); return { l: dayL(k, days.length), v: Math.round(x.sum * 100) / 100, hi: hasToday && k === t0, t: fd(k), tv: fmt(x.sum) + " · " + l1(x.litres) + " · " + plural(x.n, "зареждане", "зареждания") }; }),
          { fmt: eur0, xn: days.length > 14 ? 4 : 7, prev: days.map((_, i) => (pf[i] ? pf[i].sum : null)), prevTip: (i) => (pf[i] ? " · сравнение " + fmt(pf[i].sum) : "") }) +
        legend([["Сума за гориво"], ...(hasToday ? [["Днес (до " + (d.until || hmNow()) + ")", "r"] as [string, string]] : []), [W.cmpName, "ln prev"]]);
    return card({ page: "finance", id: "fuel", anchor: "fuel", cls: "wall", title: "Гориво по ден", sub: plural(F.n, "зареждане", "зареждания") + " · " + l1(F.litres) + " · " + fmt(F.sum),
      inner: inner + (F.litres ? '<p class="ow-note">По бележките от зарежданията средно ' + (F.sum / F.litres).toFixed(2).replace(".", ",") + " €/л." + (d.sample ? " " + sample() : "") + "</p>" : ""),
      table: { head: ["Ден", "Зареждания", "Литри", "Сума", W.cmpName], rows: days.map((k, i) => { const x = row(k); return [fd(k, true), x.n, f1(x.litres), fmt(x.sum), pf[i] ? fmt(pf[i].sum) : "-"]; }) } });
  }

  /* the revenue by payment: the share with a word, the difference on its own line */
  function pay(d: OwnerFinance, W: PerWords): string {
    const p = d.pay, q = d.prevPay;
    const rows: [string, string, number, number, string][] = [["В брой", "money", p.online.cash, q.online.cash, "доставка, вземане, офис"], ["Карта при получаване", "credit-card", p.online.card, q.online.card, "доставка, вземане, офис"], ["Ваучер", "ticket", p.online.voucher, q.online.voucher, "ваучери за храна"],
      ["На маса в брой", "money", p.table.cash, q.table.cash, ""], ["На маса с карта", "credit-card", p.table.card, q.table.card, ""]];
    if (p.table.unpaid) rows.push(["На маса, още неплатени", "hourglass", p.table.unpaid, q.table.unpaid, "отворени сметки"]);
    const tot = p.total, sh = (v: number) => (tot ? Math.round((v / tot) * 100) : 0);
    return card({ page: "finance", id: "pay", anchor: "pay", title: "Приходи по начин на плащане", sub: "Общо " + fmt(tot),
      inner: hbars(rows.map((r) => ({ n: r[0], icon: r[1], v: r[2], vt: fmt(r[2]), sub: sh(r[2]) + "% от приходите" + (r[4] ? " · " + r[4] : ""), d: delta(r[2], r[3]) }))) + '<p class="ow-note">Плаща се само на място; касовата бележка се издава там.' + (d.sample ? " " + sample() : "") + "</p>",
      table: { head: ["Начин", "Сума", "Дял от приходите", W.cmpName], rows: rows.map((r) => [r[0], fmt(r[2]), sh(r[2]) + "%", fmt(r[3])]) } });
  }

  function byDriver(d: OwnerFinance): string {
    const l = d.fuel.byDriver;
    return card({ page: "finance", id: "drv", title: "По шофьор", sub: "Гориво: зареждания, литри, сума",
      inner: l.length ? hbars(l.map((x) => ({ n: x.name, icon: "user", v: x.sum, vt: fmt(x.sum), sub: plural(x.n, "зареждане", "зареждания") + " · " + l1(x.litres) }))) : '<p class="ow-note">Няма зареждания за този период.</p>',
      table: { head: ["Шофьор", "Зареждания", "Литри", "Сума"], rows: l.map((x) => [x.name, x.n, f1(x.litres), fmt(x.sum)]) } });
  }

  function byCar(d: OwnerFinance): string {
    const l = d.fuel.byCar;
    /* an impossible consumption (a slip of the odometer): "-" and what to check */
    const ok = (v: number | null) => v != null && v >= 3 && v <= 30, odd = l.some((c) => c.per100 != null && !ok(c.per100));
    return card({ page: "finance", id: "car", title: "По автомобил", sub: "Разход от зарежданията",
      inner: (l.length ? '<div class="fi-kv">' + l.map((c) => "<div><span>" + esc(c.n) + "<small>" + plural(c.entries, "зареждане", "зареждания") + " · " + l1(c.litres) + " · " + fmt(c.sum) + "</small></span><b>" + (c.per100 == null ? "-" : ok(c.per100) ? f1(c.per100) + "\u00a0л/100\u00a0км" : '-<small>провери километража</small>') + "</b></div>").join("") + "</div>" : '<p class="ow-note">Няма зареждания за този период.</p>') +
        (odd ? '<p class="ow-note">При едно от зарежданията километражът изглежда сбъркан: провери го в смяната на шофьора.</p>' : "") +
        '<p class="ow-note">Разходът се смята между две зареждания догоре. Марка и рег. №: ' + miss("[ЛИПСВА: марка и рег. №]") + ". Разход по паспорт: " + miss("[ЛИПСВА: разход л/100 км]") + ".</p>",
      table: { head: ["Автомобил", "Зареждания", "Литри", "Сума", "Км", "л/100 км"], rows: l.map((c) => [c.n, c.entries, f1(c.litres), fmt(c.sum), c.km == null ? "-" : Math.round(c.km), c.per100 == null ? "-" : ok(c.per100) ? f1(c.per100) : "- (провери километража)"]) } });
  }

  function delivery(d: OwnerFinance): string {
    const D = d.delivery, free = D.fees.filter((z) => z.free), paid = D.fees.filter((z) => !z.free);
    return '<section class="ow-card" aria-labelledby="h-dc" data-edit-id="own.finance.delivery"><header><div><h2 id="h-dc">Цена на една доставка<small>Горивото, спрямо таксата</small></h2></div></header>' +
      '<div class="fi-big"><span class="ow-big">' + (D.fuelPer == null ? "-" : fmt(D.fuelPer)) + '</span><span class="ow-note">' + plural(D.delivered, "доставена поръчка", "доставени поръчки") + "</span></div>" +
      '<div class="fi-kv">' + (free.length ? "<div><span>Такса в " + plural(free.length, "квартал", "квартала") + "<small>" + esc(free.map((z) => z.zone).join(", ")) + "</small></span><b>безплатна</b></div>" : "") +
      paid.map((z) => "<div><span>Такса в " + esc(z.zone) + "</span><b>" + (z.missing ? miss(z.missing) : fmt(z.fee || 0).replace(" €", "\u00a0€")) + "</b></div>").join("") + "</div>" +
      '<p class="ow-note">Без заплатата на шофьора и колата: ' + miss(D.driverCost) + ".</p></section>";
  }

  /* the core gives no number (there is no routing service): the honest empty text */
  const saved = () => '<section class="ow-card" aria-labelledby="h-sv" data-edit-id="own.finance.saved"><header><div><h2 id="h-sv">Спестено от по-краткия път</h2></div></header>' +
    '<p class="ow-note">Още не се смята: пътищата на шофьорите не се записват. Числото идва, щом има услуга за маршрути.</p></section>';

  function cashCard(d: OwnerFinance): string {
    const C = d.cash;
    return '<section class="ow-card" id="cash" aria-labelledby="h-ca" data-edit-id="own.finance.cash"><header><div><h2 id="h-ca">Пари в брой от шофьорите<small>Днес, ' + esc(fd(C.date)) + " до " + esc(hmNow()) + "</small></h2></div></header>" +
      (C.rows.length ? '<div class="fi-drv">' + C.rows.map((r) => '<div><div class="hd"><b>' + esc(r.name) + "</b>" + (r.open ? '<span class="ow-tag warn">' + ic("hourglass", 16) + "За предаване</span>" : '<span class="ow-tag ok">' + ic("check-circle", 16) + "Предадени</span>") + "</div>" +
        '<div class="fi-kv">' + (r.open ? '<div class="tot"><span>За предаване<small>На смяна, до края ѝ</small></span><b>' + fmt(r.toHand) + "</b></div>" : '<div class="tot"><span>Предадени<small>Смяната е приключила</small></span><b>' + fmt(r.handed || 0) + "</b></div>") + "</div></div>").join("") + "</div>"
        : '<p class="ow-note">Днес още няма шофьор на смяна.</p>') +
      '<div class="fi-kv"><div><span>Предадени днес</span><b>' + fmt(C.handed) + '</b></div><div class="tot"><span>За предаване общо</span><b>' + fmt(C.toHand) + "</b></div></div>" +
      '<p class="ow-note">Предават се в края на смяната на ' + miss(C.handTo) + ".</p></section>";
  }

  body.addEventListener("click", (e) => {
    if (!(e.target as Element).closest("[data-csv]")) return;
    const d = S.data(); if (!d) return;
    const ok = downloadCsv("siracusa-finansi-" + d.from + "-" + d.to + (d.sample ? "-primerni-danni" : "") + ".csv", d.csv);
    boss.toast(ok ? "Изтеглено: " + plural(d.csv.length - 1 - (d.sample ? 1 : 0), "ден", "дни") + " в CSV" : "Файлът не се изтегли. Опитай пак.");
  });
}
function addDay(ymd: string): string { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); }
function todayLocal(): string { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } }
