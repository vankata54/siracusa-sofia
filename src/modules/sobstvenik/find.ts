/* Siracusa · what the owner's search finds (design/pages-sobstvenik/_find.js; decisions 15.11 "Умна търсачка" and
   "Търсенето на ястия е едно"). Loaded on the first open of the search (the frame's shell: the field, the keys, the
   aria-live line). Only what the owner sees:
   - the KPIs by a word (кирилица или латиница): "оборот", "гориво", "неявили се" … -> their place in the module;
     "смяна" -> "Смяната сега" (the manager's module); never for words with digits ("1042" is an order);
   - the dishes through the shared search core (src/lib/search.ts) on the live menu, with their sales for the period
     (the selected one on "Тенденции", else 7 days) from the core (ownerApi.trends with the dish), -> the dish card;
   - the orders by № and today's reservations (bossApi.search: the phone masked);
   - the screens of the module and the admin's sections by their name (boss.searchSections). */
import "sc-icons:wallet,chart-bar,receipt,truck,car,money,credit-card,warning-circle,calendar-check,chat-circle-dots,fork-knife,clock,users,timer,seal-percent,scales,star,warning,users-three,caret-right,caret-down,bowl-food,minus,x,magnifying-glass";
import type { Boss, BossSearch } from "../boss/frame.ts";
import { ownerApi, bossApi, type OwnerToday, type OwnerDecisions, type MgrSearch } from "../../client/api-boss.ts";
import { api } from "../../client/api.ts";
import { items, setMenu, catById, type Dish } from "../../lib/data.ts";
import { pic } from "../../lib/render.ts";
import { searchDishes, chips as qChips, toggle } from "../../lib/search.ts";
import { norm } from "../../admin/a.ts";
import { ic, esc, plural, fmt, go, findPer, query, fd, today, addDays, type PerState } from "./common.ts";

let live: Promise<void> | null = null;
function liveMenu(): Promise<void> {
  if (!live) live = api.menu().then((m) => { setMenu(m); }).catch(() => { live = null; });
  return live;
}

interface Kpi { keys: string[]; title: string; meta: () => string; href: string; icon: string; tn: string; money?: boolean }

export function provider(boss: Boss): BossSearch {
  liveMenu();
  const money = boss.can("finance");
  let td: OwnerToday | null = null, dc: OwnerDecisions | null = null;
  ownerApi.today().then((x) => { td = x; }, () => { /* the meta stays general */ });
  ownerApi.decisions().then((x) => { dc = x; }, () => { /* the meta stays general */ });
  const K: [string, string, () => string, string, string, boolean?][] = [
    ["оборот приходи продажби пари revenue sales turnover", "Оборот днес", () => (td && td.sales.sum != null ? fmt(td.sales.sum) + " от " + plural(td.sales.n, "поръчка", "поръчки") : "Днес и спрямо обичайното"), go.today(), "wallet", true],
    ["оборот тенденции седмица месец период сравнение revenue trend", "Оборот по ден и сравнение", () => "Тенденции · 7 дни, 30 дни, месец", go.trends(), "chart-bar", true],
    ["поръчки брой orders", "Поръчки днес", () => (td ? plural(td.sales.n, "поръчка", "поръчки") + " · на живо " + td.live.inWork + " в работа" : "Днес и на живо"), go.today(), "receipt"],
    ["среден бон средна поръчка average", "Среден бон", () => "Днес и по периоди", go.trends(), "receipt", true],
    ["канали канал доставка вземане маса офис телефон сайт channel delivery pickup", "Поръчки по канал", () => "Сайт (доставка и вземане), телефон, маса, офис", go.today("channels"), "truck"],
    ["гориво бензин дизел литри километри км разход шофьор автомобил кола fuel gas petrol", "Гориво", () => "Литри и € по ден, шофьор и автомобил", go.finance("fuel"), "car", true],
    ["брой кеш пари предаване шофьор cash", "Пари в брой от шофьорите", () => "Предадени и за предаване", go.finance("cash"), "money", true],
    ["плащане карта ваучер брой payment card voucher", "Приходи по начин на плащане", () => "В брой, Карта при получаване, Ваучер", go.finance("pay"), "credit-card", true],
    ["неявили неявяване блокиране блокирай no show noshow", "Неявили се", () => (dc ? (dc.blocks.rows.length ? plural(dc.blocks.rows.length, "номер чака", "номера чакат") + " решение" : "Нищо не чака решение") : "Блокиране или не"), go.decisions("noshow"), "warning-circle"],
    ["резервации резервация заетост reservations", "Резервации и неявили се", () => "По периоди", go.trends("res"), "calendar-check"],
    ["въпроси въпрос агенция отговор questions", "Въпроси от агенцията", () => (dc ? (dc.counts.open ? plural(dc.counts.open, "въпрос чака", "въпроса чакат") + " отговор" : "Всички са с отговор") : "Съгласен или друго"), go.decisions(), "chat-circle-dots"],
    ["топ ястия най поръчвани хит продавани top dishes", "Най-поръчвани ястия", () => (money ? "По брой и по оборот" : "По брой"), go.trends("top"), "fork-knife"],
    ["часове час пик натоварено топлинна карта hours peak", "Пикови часове", () => "Ден от седмицата × час", go.trends("heat"), "clock"],
    ["клиенти нови връщащи customers", "Нови и връщащи се клиенти", () => "По периоди", go.trends("clients"), "users"],
    ["времена време приготвяне доставка повикване times", "Средни времена", () => "Приготвяне, доставка, отговор на повикване", go.trends("times"), "timer"],
    ["оферти оферта отстъпка обедно код offers discount", "Ефектът на офертите", () => "-30% след 15:00 и кодът от оценката", go.trends("offers"), "seal-percent"],
    ["себестойност печалба марж cost profit", "Себестойност и печалба", () => "[ЛИПСВА: себестойност на ястията]", go.finance("cost"), "scales", true],
    ["google профил отзиви рейтинг работно време", "Google профил", () => "Скоро", go.decisions("google"), "star"],
    ["отклонение под обичайното alert", "Известие при отклонение", () => "Днес спрямо обичайното за деня", go.today(), "warning"],
    ["смяна смяната управител залата сега живо сервитьори кухня shift", "Смяната сега", () => "Модулът на управителя: залата, кухнята, шофьорите", go.shift(), "users-three"],
  ];
  const KPI: Kpi[] = K.filter((k) => money || !k[5]).map((k) => ({ keys: norm(k[0]).split(" "), title: k[1], meta: k[2], href: k[3], icon: k[4], tn: norm(k[1]) }));
  function kpis(q: string): Kpi[] {
    if (/\d/.test(q)) return [];
    const words = norm(q).split(" ").filter((w) => w.length >= 3); if (!words.length) return [];
    return KPI.filter((k) => words.every((w) => k.keys.some((x) => x.indexOf(w) === 0 || (w.length >= 5 && w.indexOf(x) === 0 && x.length >= 4)) || k.tn.indexOf(w) > -1));
  }

  /* the sales of a dish for the period (the core, one dish at a time; cached by the period) */
  const sales = new Map<string, { q: number; revenue: number | null } | null>();
  const per = (): PerState => findPer.s || { per: "7", cmp: "prev", a: addDays(today(), -6), b: today() };
  const perKey = () => { const s = per(); return s.per + (s.per === "custom" ? s.a + s.b : ""); };
  const perLabel = () => { const s = per(); return findPer.s ? (s.per === "today" ? "днес" : s.per === "yday" ? "вчера" : s.per === "7" ? "за 7 дни" : s.per === "30" ? "за 30 дни" : s.per === "month" ? "за месеца" : fd(s.a, true) + " - " + fd(s.b, true)) : "за 7 дни"; };
  async function fill(list: Dish[]): Promise<void> {
    const k = perKey(), need = list.filter((x) => !sales.has(k + x.id));
    await Promise.race([Promise.all(need.map((x) => ownerApi.trends(query(per(), x.id)).then((t) => { sales.set(k + x.id, t.dish ? { q: t.dish.q, revenue: t.dish.revenue } : { q: 0, revenue: 0 }); }, () => { /* no number */ }))), new Promise((r) => setTimeout(r, 2500))]);
  }
  const dishHref = (id: string) => { const s = per(), h = ["dish=" + encodeURIComponent(id)]; if (findPer.s) { if (s.per !== "7") h.unshift("p=" + s.per); if (s.cmp === "year") h.push("c=year"); if (s.per === "custom") h.push("a=" + s.a, "b=" + s.b); } return go.trends(h.join("&")); };
  function dRow(x: Dish): string {
    const v = sales.get(perKey() + x.id), out = x.t.indexOf("out") > -1, c = catById[x.cat];
    return '<a class="ow-fr" href="' + esc(dishHref(x.id)) + '">' + pic(x) + "<span><b>" + esc(x.n) + "</b><small>" + esc(c ? c.n : "") + " · " + fmt(x.p) + (out ? " · Изчерпано днес" : "") + '</small></span><span class="fv">' +
      (v ? (v.q ? plural(v.q, "брой", "броя") + (v.revenue != null ? "<small>" + fmt(v.revenue) + "</small>" : "") : "<small>0 броя</small>") : "") + "</span></a>";
  }
  const row = (href: string, icon: string, title: string, meta: string) => '<a class="ow-fr" href="' + esc(href) + '"><span class="fi">' + ic(icon, 22) + "</span><span><b>" + esc(title) + "</b>" + (meta ? "<small>" + meta + "</small>" : "") + '</span><span class="fv">' + ic("caret-right", 20) + "</span></a>";
  function group(key: string, title: string, rows: string[], max: number, more: Record<string, boolean>, sub?: string): string {
    if (!rows.length) return "";
    return '<section class="ow-fg" aria-label="' + esc(title) + '"><h2>' + esc(title) + "<small>" + esc(sub || String(rows.length)) + "</small></h2>" + rows.slice(0, more[key] ? 60 : max).join("") +
      (rows.length > max && !more[key] ? '<button class="link ow-fmore" type="button" data-fmore="' + key + '">Покажи още ' + (rows.length - max) + ic("caret-down", 18) + "</button>" : "") + "</section>";
  }
  const RST: Record<string, string> = { new: "Нова", confirmed: "Потвърдена", seated: "Дошли", no_show: "Неявили се", waitlist: "Чака маса", cancelled: "Отказана" };
  function start(): string {
    const ex: [string, string][] = [...(money ? [["оборот", "Оборот"], ["гориво", "Гориво"]] as [string, string][] : []), ["неявили се", "Неявили се"], ["маргарита", "Маргарита"], ["без глутен", "Без глутен"], ["въпроси", "Въпроси"]];
    return '<p class="ow-fscope">Търси ястие, показател (' + (money ? "оборот, гориво" : "поръчки, неявили се") + "), поръчка или раздел на админа. На кирилица или латиница.</p>" +
      '<div class="ow-fchips">' + ex.map((e) => '<button class="chip" type="button" data-fq="' + esc(e[0]) + '">' + esc(e[1]) + "</button>").join("") + "</div>";
  }

  return {
    async results(raw: string, more: Record<string, boolean>): Promise<string> {
      if (!raw) return start();
      let srv: MgrSearch | null = null;
      const [r] = await Promise.all([/\d/.test(raw) || raw.trim().length >= 3 ? bossApi.search(raw).catch(() => null) : Promise.resolve(null), Promise.race([liveMenu(), new Promise((res) => setTimeout(res, 1500))])]);
      srv = r;
      let h = "";
      const ch = qChips(raw);
      if (ch.length) h += '<div class="ow-fchips" role="group" aria-label="Съставки и алергени">' + ch.map((c) => '<button class="chip' + (c.without ? " without" : "") + '" type="button" data-fq="' + esc(toggle(raw, c.word)) + '" aria-pressed="' + c.without + '">' + (c.without ? ic("minus", 18) + "без " + esc(c.label) : esc(c.label) + ic("x", 16)) + "</button>").join("") + "</div>";
      /* the screens of the module by their name first ("реш" -> "Решения"), then the KPIs */
      const secs = boss.searchSections(raw), screensFirst = /Екрани на модула/.test(secs);
      if (screensFirst) h += secs;
      const K2 = kpis(raw);
      h += group("k", "Показатели", K2.map((k) => row(k.href, k.icon, k.title, esc(k.meta()).replace(/\[ЛИПСВА: ([^\]]*)\]/, '<span class="missing">[ЛИПСВА: $1]</span>'))), 4, more);
      /* the orders by № and today's reservations */
      const dq = raw.replace(/\D/g, "");
      if (srv) {
        const orders = (srv.orders || []).slice().sort((x, y) => Number(y.exact || y.no === dq) - Number(x.exact || x.no === dq));
        const og = group("o", "Поръчки", orders.map((o) => row(go.orders("n=" + encodeURIComponent(o.no)), "receipt", "№ " + o.no + " · " + o.channelName, esc(o.statusLabel + " · " + o.placedAt + (o.phone ? " · " + o.phone : "")) + (money && o.total != null ? " · " + fmt(o.total) : ""))), 4, more);
        const rg = group("r", "Резервации днес", (srv.reservations || []).map((x) => row(go.reservations(), "calendar-check", x.time + " · " + x.name + " · " + plural(x.people, "човек", "души"), esc(RST[x.status] || x.status))), 4, more);
        h = (orders.length && (orders[0].exact || orders[0].no === dq) ? og + h : h + og) + rg;
      }
      /* the dishes (not for numbers) */
      const dishQ = raw.replace(/\d+(:\d+)?/g, " ").trim(), K = kpis(raw).length;
      if (dishQ && !K) {
        const d = searchDishes(items.map((x) => ({ id: x.id, n: x.n, comp: x.comp, al: x.al, t: x.t, kw: catById[x.cat] ? catById[x.cat].n : "", x })), dishQ), back = (l: { x: Dish }[]) => l.map((y) => y.x);
        const exc = d.query.exc.map((w) => w.label), inc = d.query.inc.length, top = back(inc || !exc.length ? d.name : d.rest), comp = back(d.comp), unk = back(d.unknown);
        const max = inc ? 5 : 8;
        await fill([...top.slice(0, more.d ? 12 : max), ...comp.slice(0, 5), ...unk.slice(0, 4)]);
        h += group("d", inc || !exc.length ? "Ястия" : "Без " + exc.join(" и ") + " по състава", top.map(dRow), max, more, "продажби " + perLabel());
        if (comp.length) h += '<div class="ow-fband">' + ic("bowl-food", 20) + "<span>" + esc(d.band) + "</span></div>" + comp.slice(0, more.c ? 60 : 5).map(dRow).join("") + (comp.length > 5 && !more.c ? '<button class="link ow-fmore" type="button" data-fmore="c">Покажи още ' + (comp.length - 5) + ic("caret-down", 18) + "</button>" : "");
        if (unk.length) h += '<div class="ow-fband unk">' + ic("warning", 20) + "<span>Нямаме пълен състав<small>Не знаем дали са „без " + esc(exc.join(" и ") || "…") + "“: съставът им още не е въведен.</small></span></div>" + unk.slice(0, more.u ? 60 : 4).map(dRow).join("") + (unk.length > 4 && !more.u ? '<button class="link ow-fmore" type="button" data-fmore="u">Покажи още ' + (unk.length - 4) + ic("caret-down", 18) + "</button>" : "");
      }
      if (!screensFirst) h += secs;
      if (!/<a /.test(h)) h += '<div class="ow-fnone"><b>Нищо не намерихме за „' + esc(raw) + "“</b>Опитай с име на ястие (и на латиница), „без глутен“, " + (money ? "„оборот“, „гориво“" : "„поръчки“") + " или № на поръчка.</div>";
      return h;
    },
  };
}
