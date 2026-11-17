/* Siracusa · "Управител" › "Екипът" (/upravitel/ekipat/): port of design/pages-upravitel/team.html over the core
   (bossApi.team, setTables, setTablesUndo; the states of the tables from bossApi.hall when the role sees the hall).
   - Сервитьори: on shift since, "Маси", "Чакат го" (the calls and the QR orders), "Отговор" (the core's average from the
     real calls; none yet: "-"), the table numbers (solid: occupied, red: calling or QR), "Смени масите" (the sheet with the
     tables of the hall, Салон and Градина, the colleague's name under his table, the changes with a dashed frame, at least
     one table stays, "Добавени: 3. Махнати: 1.", the toast "… получават известие" with "Отмени").
   - Кухня: "Натоварено" (-> "Сега"), the sections and their tablets.
   - Шофьори: На път / Връща се / В ресторанта, the course in order ("+22 мин" / "навреме"), the stylised scheme only
     while a delivery is on the road (no GPS: the core gives no position; the car is drawn on the way to the next
     address), the car ([ЛИПСВА: коли]), delivered today, the cash "За предаване в края на смяната" (after 21:00
     "За предаване сега"; to whom [ЛИПСВА]).
   MONEY: a driver's cash only (core/driver.ts: one person's cash is not turnover). */
import "sc-icons:user,moped,storefront,arrow-counter-clockwise,chair,hourglass,caret-right,arrow-up-right,info,lock,warning,check,clock,moon,warning-circle,cooking-pot,fire,pizza,bowl-food";
import { mountBoss, tag, cnt, type Boss } from "../boss/frame.ts";
import { bossApi, type MgrTeam, type MgrHall, type MgrTile } from "../../client/api-boss.ts";
import { fmtNb as fmt } from "../../lib/format.ts";
import { ic, esc, plural, NB, mmss, hmOf, statusLine, TST, ZONE, go, screen, act, nowBadge, hashMap, sectionsHTML, msgOf, type Screen } from "./common.ts";

export async function initTeam(): Promise<void> {
  const boss = await mountBoss({ module: "upravitel", tab: "team", title: "Екипът", search: { load: () => import("./find.ts").then((m) => m.provider(boss!)) } });
  if (!boss) return;
  teamScreen(boss);
}

interface Data { t: MgrTeam; h: MgrHall | null; date: string }
const DST: Record<string, [string, string]> = { road: ["На път", "moped"], back: ["Връща се", "arrow-counter-clockwise"], restaurant: ["В ресторанта", "storefront"] };
/* the stylised scheme (not a map): the restaurant S above the middle, the quarters around it (design/pages-upravitel/team.html) */
const POS: Record<string, [number, number]> = { home: [150, 130], "Дружба 2": [214, 196], "Дружба 1": [156, 62], "Гара Искър": [66, 64], "НПЗ Искър": [290, 76], "Бусманци": [302, 206], "Горубляне": [104, 236], out: [40, 182] };
const LBL: Record<string, [number, number]> = { "Дружба 1": [0, -36], "Дружба 2": [0, 48], "НПЗ Искър": [0, 48], "Бусманци": [0, -36], "Горубляне": [0, 48], "Гара Искър": [0, 46] };
type Stop = MgrTeam["drivers"][number]["course"]["stops"][number];
function scheme(name: string, road: Stop[]): string {
  const P0 = POS.home, pts = road.map((o) => (POS[o.zone] || POS.out).slice() as [number, number]);
  let path = "M" + P0.join(","), prev = P0;
  pts.forEach((p) => { const mx = (prev[0] + p[0]) / 2 + (p[1] - prev[1]) * 0.12, my = (prev[1] + p[1]) / 2 - (p[0] - prev[0]) * 0.12; path += " Q" + mx.toFixed(1) + "," + my.toFixed(1) + " " + p.join(","); prev = p; });
  /* the car: halfway to the next address (no GPS in v1: never a real position) */
  const nx = Math.max(0, road.findIndex((s) => s.next)), from = nx > 0 ? pts[nx - 1] : P0, to = pts[nx];
  const car = [from[0] + (to[0] - from[0]) * 0.5, from[1] + (to[1] - from[1]) * 0.5], last = pts[pts.length - 1];
  return '<div class="mg-scheme"><div class="in"><svg viewBox="0 0 360 292" role="img" aria-label="Схема на курса на ' + esc(name) + ": ресторантът, " + plural(road.length, "адрес", "адреса") + ' по ред и колата. Не е карта; списъкът е същият.">' +
    Object.keys(LBL).map((z) => '<ellipse class="sv-zone" cx="' + POS[z][0] + '" cy="' + POS[z][1] + '" rx="50" ry="28"/>').join("") +
    Object.keys(LBL).map((z) => '<text class="sv-zl" x="' + (POS[z][0] + LBL[z][0]) + '" y="' + (POS[z][1] + LBL[z][1]) + '" text-anchor="middle">' + esc(z) + "</text>").join("") +
    (road.some((o) => !POS[o.zone]) ? '<text class="sv-zl" x="' + POS.out[0] + '" y="' + (POS.out[1] - 34) + '" text-anchor="middle">извън</text>' : "") +
    '<path class="sv-ret" d="M' + last.join(",") + " L" + P0.join(",") + '"/><path class="sv-path" d="' + path + '"/>' +
    '<rect class="sv-home" x="' + (P0[0] - 18) + '" y="' + (P0[1] - 18) + '" width="36" height="36" rx="10"/><text class="sv-stop-t sv-home-t" x="' + P0[0] + '" y="' + P0[1] + '">S</text>' +
    pts.map((p, i) => { const c = i === nx ? "next" : ""; return '<circle class="sv-stop ' + c + '" cx="' + p[0] + '" cy="' + p[1] + '" r="17"/><text class="sv-stop-t ' + c + '" x="' + p[0] + '" y="' + p[1] + '">' + road[i].n + "</text>"; }).join("") +
    '<circle class="sv-car" cx="' + car[0].toFixed(1) + '" cy="' + car[1].toFixed(1) + '" r="14"/><g transform="translate(' + (car[0] - 10).toFixed(1) + " " + (car[1] - 10).toFixed(1) + ')" style="color:var(--on-ember)">' + ic("moped", 20) + "</g></svg></div>" +
    '<div class="cap">' + ic("info", 16) + "<span>Схема, не е карта. S е ресторантът, жълтото кръгче е колата по пътя към следващия адрес (без GPS), червеното е следващият адрес.</span></div></div>";
}

function teamScreen(boss: Boss): void {
  boss.body.innerHTML = boss.skeleton(4, "Зареждаме смяната…");
  nowBadge(boss);
  const seeHall = boss.can("hall") || boss.can("reservations");
  const S: Screen<Data> = screen(boss, {
    load: async () => { const [t, h] = await Promise.all([bossApi.team(), seeHall ? bossApi.hall().catch(() => null) : Promise.resolve(null)]); return { t, h, date: todayOf() }; },
    err: "Кой е на смяна не се зареди. Опитай пак след малко.", draw,
  });
  const tileOf = (d: Data, id: string): MgrTile | null => (d.h ? d.h.tiles.find((x) => x.id === id) || null : null);

  function waiters(d: Data): string {
    const W = d.t.waiters;
    if (!W.length) return '<section class="mg-blk" id="waiters"><div class="mg-h"><h2>Сервитьори</h2></div>' + boss.empty({ icon: "moon", title: "Смяната още не е започнала", text: "Сервитьорите избират масите си при вход. Тук ги виждаш, щом влязат." }) + "</section>";
    return '<section class="mg-blk" id="waiters" aria-labelledby="h-w"><div class="mg-h"><h2 id="h-w">Сервитьори</h2>' + cnt(W.length) + "</div>" + W.map((w) => {
      const calls = w.calls + w.qr, tiles = w.tables.map((t) => ({ t, x: tileOf(d, t.id) })), busy = tiles.filter((y) => y.x && y.x.state !== "free" && y.x.state !== "res").length;
      return '<article class="mg-card mg-person" id="w-' + esc(w.username) + '" data-wid="' + esc(w.username) + '"><div class="mg-ph"><span class="av">' + ic("user", 24) + "</span><div><b>" + esc(w.name) + "</b><small>" +
        (d.t.shiftOver ? '<span class="mg-dot off" aria-hidden="true"></span>Смяната приключи · беше от ' + hmOf(w.since) : '<span class="mg-dot" aria-hidden="true"></span>На смяна от ' + hmOf(w.since)) + "</small></div></div>" +
        '<div class="mg-stats"><div class="mg-stat"><span>Маси</span><b>' + w.tables.length + '</b></div><div class="mg-stat' + (calls ? " hot" : "") + '"><span>Чакат го</span><b>' + calls + '</b></div><div class="mg-stat"><span>Отговор</span><b>' + (w.avgSec == null ? "-" : mmss(w.avgSec)) + "</b></div></div>" +
        '<p class="mg-note">' + ic("info", 16) + "<span>„Отговор“: средно от повикване до „Отивам“, днес" + (w.avgSec == null ? ": още няма повиквания." : " (" + plural(w.answered, "повикване", "повиквания") + ").") + "</span></p>" +
        '<div class="mg-chips" aria-label="Масите на ' + esc(w.name) + ": " + w.tables.map((t) => t.n).join(", ") + '">' + tiles.map(({ t, x }) => {
          const st = x ? x.state : "free", cls = st === "call" || st === "bill" || st === "qr" ? "call" : st !== "free" && st !== "res" ? "busy" : "";
          return '<span class="mg-tno ' + cls + '" title="Маса ' + t.n + ": " + (TST[st] || TST.free)[0] + '">' + t.n + "</span>"; }).join("") + "</div>" +
        (d.h ? '<p class="mg-note" style="margin-top:8px">' + busy + " заети · плътно: заета, червено: вика или QR</p>" : "") +
        '<button class="pill pill-line pill-lg change" type="button" data-change="' + esc(w.username) + '">' + ic("chair", 22) + "Смени масите</button></article>";
    }).join("") + "</section>";
  }
  function kitchen(d: Data): string {
    const k = d.t.kitchen, b = k.busy;
    return '<section class="mg-blk" id="kitchen" aria-labelledby="h-k"><div class="mg-h"><h2 id="h-k">Кухня</h2><a class="mg-link more" href="' + go.kitchen() + '">Екранът ' + ic("arrow-up-right", 18) + "</a></div>" +
      '<a class="mg-card mg-setrow" href="' + go.now("go=kitchen") + '" style="margin-bottom:12px' + (b.on ? ";background:var(--ember);color:var(--on-ember)" : "") + '"><span class="si">' + ic("hourglass", 22) + "</span><span><b>Натоварено: " + (b.on ? "включено" : "изключено") + "</b><small" + (b.on ? ' style="color:inherit"' : "") + ">" +
        (b.on ? "От " + esc(b.by || "кухнята") + (b.atHm ? " в " + esc(b.atHm) : "") + " · около " + b.etaBusyMin + NB + "мин" : "Гостите виждат „около " + b.etaMin + NB + "мин“") + "</small></span>" + ic("caret-right", 20) + "</a>" +
      sectionsHTML(k) +
      '<p class="mg-note">' + ic("info", 16) + '<span>Секциите и кое ястие къде се готви са условни <span class="missing">[ЛИПСВА: секции на кухнята]</span>.</span></p></section>';
  }
  function drivers(d: Data): string {
    const D = d.t.drivers;
    if (!D.length) return '<section class="mg-blk" id="drivers"><div class="mg-h"><h2>Шофьори</h2></div>' + boss.empty({ icon: "moon", title: "Няма шофьор на смяна", text: "Доставките са от 10:00 до 21:00." }) + "</section>";
    return '<section class="mg-blk" id="drivers" aria-labelledby="h-d"><div class="mg-h"><h2 id="h-d">Шофьори</h2>' + cnt(D.length) + "</div>" + D.map((dr) => {
      const st = DST[dr.status] || DST.restaurant, road = dr.status === "road" ? dr.course.stops.filter((s) => s.st !== "done" && s.st !== "cancelled") : [];
      const stops = road.map((o) => '<li class="' + (o.next ? "next" : "") + '"><span class="no">' + o.n + "</span><span><b>№" + NB + esc(o.no) + " · " + esc(o.zone || "извън зоните") + "</b><small>" + esc(o.addr || "") + "</small></span>" +
        (o.lateLabel ? (o.late ? tag("warn", "clock", o.lateLabel) : tag("", "clock", o.lateLabel)) : "") + "</li>").join("");
      const now = dr.cashWhen === "now", car = dr.car;
      return '<article class="mg-card mg-person" id="d-' + esc(dr.user) + '"><div class="mg-ph"><span class="av">' + ic("moped", 24) + "</span><div><b>" + esc(dr.name) + "</b><small>" + (d.t.shiftOver ? "Смяната приключи · беше от" + NB + hmOf(dr.since) : "На смяна от" + NB + hmOf(dr.since)) + "</small></div>" + tag(dr.status === "road" ? "ember" : "", st[1], st[0]) + "</div>" +
        (road.length ? '<h3 style="margin:16px 0 0;font-size:16px;font-weight:800">Курсът · ' + plural(road.length, "адрес", "адреса") + '</h3><ol class="mg-stops">' + stops + "</ol>" + scheme(dr.name, road)
          : '<p class="mg-note" style="font-size:15px">' + (dr.status === "back" ? "Връща се към ресторанта след последната доставка." : "В ресторанта, без поръчки за доставяне.") + "</p>") +
        '<div class="mg-kv" style="margin-top:8px"><span>Кола</span><b>' + (car && !car.missing ? esc(car.n) + (car.plate ? " · " + esc(car.plate) : "") : '<span class="missing">[ЛИПСВА: коли]</span>') + '</b></div><div class="mg-kv"><span>Доставени днес</span><b>' + dr.deliveredToday + "</b></div>" +
        '<div class="mg-cash' + (now ? " now" : "") + '"><span>' + (now ? "За предаване сега" : "За предаване в края на смяната") + '</span><b class="price">' + fmt(dr.cash) + '</b><small>В брой от доставените поръчки. Предава се на <span class="missing">[ЛИПСВА: на кого]</span>.</small></div></article>';
    }).join("") +
      '<p class="mg-note">' + ic("lock", 16) + "<span>Мястото на шофьора се вижда само по време на доставка и само от собственика и управителя.</span></p></section>";
  }
  function draw(d: Data): string {
    return '<div data-upscr="team">' + statusLine(d.date, d.t.now) + '<div class="mg-grid c3">' + waiters(d) + kitchen(d) + drivers(d) + "</div></div>";
  }

  /* ---------- "Смени масите" (decision 15.11: the manager may; the waiters are told) ---------- */
  function changeSheet(who: string) {
    const d = S.data(); if (!d) return;
    const w = d.t.waiters.find((x) => x.username === who); if (!w) return;
    const other = d.t.waiters.find((x) => x.username !== who) || null, was = w.tables.map((t) => t.n), sel = was.slice(), T = d.t.tables;
    function grid(z: "salon" | "garden") {
      return "<h3>" + ZONE[z] + '</h3><div class="mg-tsel">' + T.filter((x) => x.zone === z).sort((a, b) => a.n - b.n).map((x) => {
        const on = sel.includes(x.n), had = was.includes(x.n), ow = x.owner && x.owner !== who ? x.ownerName : null;
        return '<button type="button" data-n="' + x.n + '" aria-pressed="' + on + '" class="' + (on !== had ? "chg" : "") + '"><b><span class="vh">Маса </span>' + x.n + "</b><small>" + (on ? "избрана" : ow ? esc(ow).replace(/ /g, NB) : "свободна") + "</small></button>";
      }).join("") + "</div>";
    }
    function body() {
      const add = sel.filter((n) => !was.includes(n)).sort((a, b) => a - b), rem = was.filter((n) => !sel.includes(n));
      return "<p>Докосни маса, за да я дадеш на " + esc(w!.name) + " или да я махнеш. " + (other ? "Махнатите отиват при " + esc(other.name) + "." : "Махнатите остават без сервитьор.") + "</p>" + grid("salon") + grid("garden") +
        (sel.length ? "" : '<p class="mg-err" id="mg-tablerr" role="alert">' + ic("warning", 18) + "Записът е спрян: " + esc(w!.name) + " трябва да има поне една маса.</p>") +
        '<p class="mg-note" role="status">' + ic("info", 16) + "<span>" + (add.length || rem.length ? (add.length ? "Добавени: " + add.join(", ") + ". " : "") + (rem.length ? "Махнати: " + rem.join(", ") + ". " : "") : "Още нищо не е сменено. ") + "Сервитьорът получава известие на телефона.</span></p>";
    }
    const sh = boss.sheet({ title: "Масите на " + w.name, html: body(), foot: '<button class="pill pill-line pill-lg" type="button" data-no>Откажи</button><button class="pill pill-red pill-lg" type="button" data-save>' + ic("check", 22) + "Запази масите</button>" });
    const sv = sh.foot!.querySelector<HTMLButtonElement>("[data-save]")!;
    sh.body.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-n]"); if (!b) return;
      const n = +b.dataset.n!, i = sel.indexOf(n); if (i > -1) sel.splice(i, 1); else sel.push(n);
      const y = sh.body.scrollTop; sh.body.innerHTML = body(); sh.body.scrollTop = y;
      sv.disabled = !sel.length; if (sel.length) sv.removeAttribute("aria-describedby"); else sv.setAttribute("aria-describedby", "mg-tablerr");
      const nb = sh.body.querySelector<HTMLElement>('[data-n="' + n + '"]'); if (nb) nb.focus({ preventScroll: true });
    });
    sh.foot!.querySelector<HTMLButtonElement>("[data-no]")!.onclick = sh.close;
    sv.onclick = () => {
      if (!sel.length) return;
      const list = sel.slice().sort((a, b) => a - b), moved = list.some((n) => !was.includes(n) && T.some((x) => x.n === n && x.owner && x.owner !== who)), dropped = was.some((n) => !list.includes(n));
      sh.close();
      const text = "Масите на " + w.name + " са сменени. " + w.name + (other && (moved || dropped) ? " и " + other.name + " получават известие." : " получава известие.");
      void act(boss, { op: "setTables", args: [who, list, null], label: "Масите на " + w.name + ": " + list.join(", ") + ".", run: () => bossApi.setTables(who, list, null),
        ok: (r) => { boss.toast(text, { undo: () => { bossApi.setTablesUndo(r.undo.id).then(() => S.reload(), (er) => boss.toast(msgOf(er))); } }); void S.reload(); } });
    };
  }
  boss.body.addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLElement>("[data-change]"); if (b) changeSheet(b.dataset.change!); });
  function onHash() {
    const h = hashMap(); if (!h.go) return;
    const run = () => { const el = document.getElementById(h.go); if (el) el.scrollIntoView({ block: "start" }); };
    if (S.data()) setTimeout(run, 60); else { const iv = setInterval(() => { if (S.data()) { clearInterval(iv); setTimeout(run, 60); } }, 100); setTimeout(() => clearInterval(iv), 8000); }
  }
  window.addEventListener("hashchange", onHash);
  onHash();
}
function todayOf(): string { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } }
