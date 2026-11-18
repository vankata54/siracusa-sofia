/* Siracusa · "Управител" › "Сега" (/upravitel/): port of design/pages-upravitel/now.html over the core (bossApi.now, the
   actions of core/shift.ts). Day, hour and status; the pulse (tables, "В работа" = the admin's tab, "Закъсняват",
   "Повиквания", "Резервации до 21:42"); "Проблеми сега" by urgency (the core's order) with one number (mm:ss live) and one
   main action, "Покажи още N" over 5; "Чака те" ("Приеми" straight to "Готви се", the sheet "В поръчката има изчерпано",
   "Потвърди", the no-shows "Реши" without "Отмени", the recommendations); the kitchen ("Натоварено" with the confirmation,
   the sections and their tablets, "Изчерпано днес" with "Върни"). On the phone "Проблеми сега" is above the pulse when
   there are problems; on the computer the pulse is on top across the width (boss.css .now-grid).
   The sound and the blinking badge of a new online order are the frame's (boss.freshOrder / boss.orderSeen).
   MONEY: only the sum of ONE order ("Чака те"); never a sum over orders (MgrNow.today is not drawn). */
import "sc-icons:warning,check-circle,chair,receipt,hand-waving,calendar-check,caret-right,caret-down,arrow-right,user,check,map-pin,phone,chef-hat,qr-code,moped,storefront,shopping-bag,bell-ringing,warning-circle,scales,pencil-simple,hourglass,arrow-up-right,arrow-counter-clockwise,info,lock,cooking-pot,fire,pizza,bowl-food,clock";
import { mountBoss, tag, cnt, type Boss } from "../boss/frame.ts";
import { bossApi, ApiError, type MgrNow, type Problem, type WaitOrder, type MgrKitchen } from "../../client/api-boss.ts";
import { pic } from "../../lib/render.ts";
import { findDish, catById } from "../../lib/data.ts";
import { ic, esc, plural, NB, ppl, timer, agoMin, statusLine, go, screen, act, callSheet, pickWaiter, hashMap, CH_IC, dayOf, sectionsHTML, prettyPhone, isOff, msgOf, type Screen } from "./common.ts";
import { fmtNb as fmt } from "../../lib/format.ts";
import { floorApi, type TableRating } from "../../client/api-floor.ts";
import { aurl } from "../../admin/routes.ts";

export async function initNow(): Promise<void> {
  const boss = await mountBoss({ module: "upravitel", tab: "now", title: "Сега", search: { load: () => import("./find.ts").then((m) => m.provider(boss!)) } });
  if (!boss) return;
  nowScreen(boss);
}

function nowScreen(boss: Boss): void {
  let showAll = false;
  boss.body.innerHTML = boss.skeleton(4, "Зареждаме смяната…");
  const S: Screen<MgrNow> = screen(boss, {
    load: () => bossApi.now(),
    err: "Поръчките и повикванията не се заредиха. Админът и кухнята работят; опитай пак след малко.",
    draw,
    after: (d) => { boss.badge("now", d.counts.now); },
  });
  const D = () => S.data();

  /* ---------- "Оценки от масите": the texts after "Не" at the QR tables (decision 18.11.2026); only for the roles the
     core lets read them (floorApi.ratings: main admin, owner, manager), loaded beside the shift's data ---------- */
  let rates: TableRating[] | null = null;
  const loadRates = () => { floorApi.ratings().then((r) => { rates = r; S.redraw(); }, () => { rates = null; }); };
  loadRates();
  boss.onLive(() => loadRates(), ["rating.created"]);
  function ratingsHTML(): string {
    if (!rates) return "";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());
    const no = rates.filter((r) => !r.happy && r.text && new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date(r.at)) === today).slice(0, 5);
    const hm = (iso: string) => new Intl.DateTimeFormat("bg-BG", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
    return '<section class="mg-blk now-rates" id="rates" aria-labelledby="h-rt"><div class="mg-h"><h2 id="h-rt">Оценки от масите</h2>' + (no.length ? cnt(no.length) : "") +
      '<a class="mg-link more" href="' + aurl.section("customers", "tab=feedback") + '">Обратна връзка ' + ic("arrow-up-right", 18) + "</a></div>" +
      (no.length ? '<div class="mg-card mg-list">' + no.map((r) => '<div class="mg-wrow"><span class="wi">' + ic("warning-circle", 22) + '</span><div class="wt"><b>„' + esc(r.text) + '“</b><small>' + (r.tableN ? "Маса" + NB + r.tableN + " · " : "") + esc(hm(r.at)) + "</small></div></div>").join("") + "</div>"
        : '<div class="mg-allok">' + ic("check-circle", 32) + "<div><b>Днес няма недоволни гости с бележка.</b><span>Отговорът „Не“ от QR масата идва тук и в „Обратна връзка“.</span></div></div>") + "</section>";
  }

  /* ---------- the pulse: 5 numbers, each leads to its place ---------- */
  function pulse(d: MgrNow): string {
    const p = d.pulse, t = p.tables, pct = t.total ? Math.round((t.busy / t.total) * 100) : 0, a = t.total ? (t.salon / t.total) * 100 : 0, b = t.total ? (t.garden / t.total) * 100 : 0;
    const late = p.late, rlab = p.closed ? "ресторантът е затворен" : "до " + p.reservations.until;
    return '<div class="mg-pulse" role="group" aria-label="Пулсът на смяната"><div class="in">' +
      '<a class="mg-kpi wide" href="' + go.hall() + '"><span class="lb">' + ic("chair", 20) + 'Маси заети</span><span class="v tnum">' + t.busy + "<small>от" + NB + t.total + '</small></span><span class="go">' + ic("caret-right", 20) + "</span>" +
        '<span class="bar"><span class="mg-occ" aria-hidden="true"><i style="width:' + a + '%"></i><i style="width:' + b + '%"></i></span><span class="mg-occl"><span><i></i>Салон' + NB + t.salon + "</span><span><i></i>Градина" + NB + t.garden + "</span><span>" + pct + "%" + NB + "заети</span></span></span></a>" +
      '<a class="mg-kpi" href="' + go.inWork() + '"><span class="lb">' + ic("receipt", 20) + 'В работа</span><span class="v tnum">' + p.inWork + '</span><span class="ft">' + (p.inWork === 1 ? "поръчка" : "поръчки") + "</span></a>" +
      '<a class="mg-kpi' + (late.open ? " hot" : "") + '" href="#problems" data-jump="problems"><span class="lb">' + ic(late.n ? "warning" : "check-circle", 20) + 'Закъсняват</span><span class="v tnum">' + late.n + '</span><span class="ft">' +
        (!late.n ? "нищо не закъснява" : late.open + NB + (late.open === 1 ? "чака теб" : "чакат теб") + (late.seen ? " · " + late.seen + NB + (late.seen === 1 ? "видяна" : "видени") : "")) + "</span></a>" +
      '<a class="mg-kpi" href="' + go.team("go=waiters") + '"><span class="lb">' + ic("hand-waving", 20) + 'Повиквания</span><span class="v tnum">' + p.calls + '</span><span class="ft">' + (p.calls === 1 ? "чака сервитьор" : "чакат сервитьор") + "</span></a>" +
      '<a class="mg-kpi" href="' + go.hall("go=res") + '"><span class="lb">' + ic("calendar-check", 20) + 'Резервации</span><span class="v tnum">' + p.reservations.n + '</span><span class="ft">' + rlab + "</span></a>" +
      "</div></div>";
  }

  /* ---------- "Проблеми сега": one number per card, one main action ---------- */
  function probCard(p: Problem, i: number): string {
    const first = i === 0 && !p.done, prim = first ? "pill-red" : "pill-ink", k = esc(p.key);
    let acts = "";
    if (p.kind === "call") acts = '<button class="pill ' + prim + ' grow" type="button" data-a="go" data-k="' + k + '">' + ic("arrow-right", 20) + 'Отивам</button><button class="pill pill-line" type="button" data-a="assign" data-k="' + k + '">' + ic("user", 20) + "Възложи на…</button>";
    if (p.kind === "qr") acts = '<button class="pill ' + prim + ' grow" type="button" data-a="qr" data-k="' + k + '">' + ic("check", 20) + 'Потвърди и прати</button><button class="pill pill-line" type="button" data-a="qrassign" data-k="' + k + '">' + ic("user", 20) + "Възложи на…</button>";
    if (p.kind === "ask") acts = '<button class="pill ' + prim + ' grow" type="button" data-a="ask" data-k="' + k + '">' + ic("map-pin", 20) + "Реши</button>";
    if (p.kind === "out") acts = '<button class="pill ' + prim + ' grow" type="button" data-a="callc" data-k="' + k + '">' + ic("phone", 20) + "Обади се на клиента</button>" +
      (p.actions.includes("without") ? '<button class="pill pill-line" type="button" data-a="without" data-k="' + k + '">' + ic("check", 20) + "Приеми без него</button>" : "");
    if (p.kind === "late" && !p.done) acts = p.actions.includes("kitchen")
      ? '<a class="pill ' + prim + ' grow" href="' + go.kitchen() + '">' + ic("chef-hat", 20) + 'Виж в кухнята</a><button class="pill pill-line" type="button" data-a="seen" data-k="' + k + '">' + ic("check", 20) + "Видях</button>"
      : '<button class="pill ' + prim + ' grow" type="button" data-a="callc" data-k="' + k + '">' + ic("phone", 20) + "Обади се на клиента</button>";
    const tm = p.since ? '<div class="tm">' + timer(p.since) + "<span>" + (p.kind === "ask" ? "пита" : "чака") + "</span></div>" : "";
    return '<article class="mg-prob ' + p.tone + '" data-key="' + k + '">' + (first ? '<span class="rank">' + ic("warning", 14) + "Първо това</span>" : "") +
      '<span class="pi">' + ic(p.done ? "check" : p.icon, 24) + '</span><div class="pt"><b>' + esc(p.title) + "</b><small>" + esc(p.meta) + "</small></div>" + tm + (acts ? '<div class="pa">' + acts + "</div>" : "") + "</article>";
  }
  function problems(d: MgrNow): string {
    const list = d.problems, open = list.filter((x) => !x.done), done = list.filter((x) => x.done);
    const shown = showAll ? list : open.slice(0, 5), more = list.length - shown.length;
    return '<section class="mg-blk now-probs" id="problems" aria-labelledby="h-p"><div class="mg-h"><h2 id="h-p">Проблеми сега</h2>' + (open.length ? cnt(open.length, true) : "") + "</div>" +
      (open.length ? "" : '<div class="mg-allok">' + ic("check-circle", 32) + "<div><b>Няма проблеми сега</b><span>Повикванията над " + d.settings.callManager + NB + "мин, закъсненията и въпросите на шофьорите идват тук сами.</span></div></div>") +
      (shown.length ? '<div class="mg-probs"' + (open.length ? "" : ' style="margin-top:12px"') + ">" + shown.map(probCard).join("") + "</div>" : "") +
      (more > 0 ? '<button class="pill pill-line pill-lg mg-more" type="button" data-a="allp">' + ic("caret-down", 20) + (more === done.length && open.length <= 5 ? "Решени днес · " + more : "Покажи още " + more) + "</button>" : "") + "</section>";
  }

  /* ---------- "Чака те" (the rule of the admin's dashboard) ---------- */
  function orderRow(o: WaitOrder): string {
    const nw = boss.freshOrder() === o.no, n = o.lines.reduce((a, l) => a + l.q, 0), bad = o.out.join(", "), table = o.channelName === "Маса";
    return '<div class="mg-wrow" data-wno="' + esc(o.no) + '"><span class="wi">' + ic(CH_IC[o.channelName] || "receipt", 22) + '</span><div class="wt"><b>№' + NB + esc(o.no) + " · " + esc(o.channelName + (o.tableN ? " " + o.tableN : "")) + (nw ? " " + tag("ember", "bell-ringing", "Нова") : "") + "</b><small>" +
      (!table && o.name ? esc(o.name) + " · " : "") + plural(n, "ястие", "ястия").replace(" ", NB) + ' · <span class="price">' + fmt(o.total) + "</span> · " + agoMin(o.ts) + "</small>" +
      (bad ? '<span class="mg-wout">' + tag("ember", "warning", "Изчерпано: " + bad) + "</span>" : "") + "</div>" +
      '<div class="wa"><button class="pill pill-ink" type="button" data-a="accept" data-no="' + esc(o.no) + '" aria-label="Приеми №' + NB + esc(o.no) + (bad ? ", в нея има изчерпано" : "") + '">' + ic("check", 20) + "Приеми</button></div></div>";
  }
  function waits(d: MgrNow): string {
    const W = d.waits, orders = W.orders || [], res = W.reservations || [], blocks = W.blocks || [];
    let rows = "";
    if (orders.length) rows += '<div class="mg-wgrp">' + ic("receipt", 18) + "Поръчки за приемане · " + orders.length + "</div>" + orders.map(orderRow).join("");
    if (res.length) rows += '<div class="mg-wgrp">' + ic("calendar-check", 18) + "Резервации за потвърждаване · " + res.length + "</div>" + res.map((r) =>
      '<div class="mg-wrow"><span class="wi tnum">' + esc(r.time) + '</span><div class="wt"><b>' + esc(r.name) + "</b><small>" + ppl(r.people) + "</small><small>Днес в " + esc(r.time) + (r.tableN ? " ·" + NB + "Маса" + NB + r.tableN : " · без маса") + (r.occasion ? " ·" + NB + esc(r.occasion) : "") + "</small></div>" +
      '<div class="wa"><button class="pill pill-ink" type="button" data-a="confirm" data-id="' + esc(r.id) + '" data-name="' + esc(r.name) + '" data-time="' + esc(r.time) + '" aria-label="Потвърди резервацията на ' + esc(r.name) + " в " + esc(r.time) + '">' + ic("check", 20) + "Потвърди</button></div></div>").join("");
    if (blocks.length) rows += '<div class="mg-wgrp">' + ic("warning-circle", 18) + "Неявили се за решение · " + blocks.length + "</div>" + blocks.map((x) =>
      '<div class="mg-wrow"><span class="wi">' + ic("user", 22) + '</span><div class="wt"><b>' + esc(x.name || "Клиент") + "</b><small>" + plural(x.count || 2, "неявяване", "неявявания").replace(" ", NB) + '</small><small><span class="nw">' + esc(x.phone).replace(/ /g, NB) + "</span>" + (x.at ? " · последно " + esc(dayOf(x.at.slice(0, 10), true)) : "") + "</small></div>" +
      '<div class="wa"><button class="pill pill-ink" type="button" data-a="block" data-ref="' + esc(x.ref) + '">' + ic("scales", 20) + "Реши</button></div></div>").join("");
    if (W.notes && W.notes.n) rows += '<div class="mg-wgrp">' + ic("pencil-simple", 18) + "Твоите препоръки · " + W.notes.n + '</div><div class="mg-wrow"><span class="wi">' + ic("pencil-simple", 22) + '</span><div class="wt"><b>' +
      esc((W.notes.title || "С нов статус").replace(/ваша/g, "твоя").replace(/ваши/g, "твои")) + '</b><small>От молива, в „Бележки“ на админа</small></div><div class="wa"><a class="pill pill-line" href="' + go.notes(boss.role) + '">Виж</a></div></div>';
    return '<section class="mg-blk now-wait" id="wait" aria-labelledby="h-w"><div class="mg-h"><h2 id="h-w">Чака те</h2>' + (W.n ? cnt(W.n) : "") + "</div>" +
      (W.n ? '<div class="mg-card mg-list">' + rows + "</div>" : '<div class="mg-allok">' + ic("check-circle", 32) + "<div><b>Нищо не чака.</b><span>Всичко е наред. Новите онлайн поръчки идват тук със звук.</span></div></div>") + "</section>";
  }

  /* ---------- the kitchen ---------- */
  function kitchen(k: MgrKitchen): string {
    const b = k.busy, open = k.open;
    const busy = '<label class="mg-busy' + (b.on ? " on" : "") + (open ? "" : " off") + '"><b>' + ic("hourglass", 24) + 'Натоварено</b><span class="mg-switch"><input type="checkbox" role="switch" data-busy data-keep="busy" aria-label="Натоварено"' + (b.on ? " checked" : "") + (open ? "" : " disabled") + '><span class="tr"></span></span>' +
      '<span class="sub">' + (!open ? "Кухнята не приема поръчки сега (от 10:00 до 22:30)." : b.on ? "Включено" + (b.by ? " от " + esc(b.by) : "") + (b.atHm ? " в " + esc(b.atHm) : "") + ". Гостите виждат <q>Възможни са закъснения · около" + NB + b.etaBusyMin + NB + "мин</q>." : "Изключено. Гостите виждат <q>около" + NB + b.etaMin + NB + "мин</q> за доставка.") + "</span></label>";
    const so = '<div class="mg-h" style="margin:22px 0 10px"><h2 style="font-size:19px">Изчерпано днес</h2>' + cnt(k.soldOut.length) + "</div>" +
      (k.soldOut.length ? '<div class="mg-card mg-list">' + k.soldOut.map((x) => { const dsh = findDish(x.id), c = dsh ? catById[dsh.cat] : null;
        return '<div class="mg-orow">' + (dsh ? pic(dsh) : '<span class="pic" aria-hidden="true"></span>') + "<div><b>" + esc(x.n) + "</b><small>" + (c ? esc(c.n) : esc(x.secName)) + " · скрито с „Изчерпано днес“</small></div>" +
          '<button class="pill pill-line" type="button" data-a="back" data-id="' + esc(x.id) + '" data-n="' + esc(x.n) + '" aria-label="Върни в менюто: ' + esc(x.n) + '">' + ic("arrow-counter-clockwise", 20) + "Върни</button></div>"; }).join("") + "</div>"
        : '<div class="mg-allok">' + ic("check-circle", 28) + "<div><b>Всичко е в менюто</b><span>Кухнята отбелязва изчерпаното от своя екран.</span></div></div>");
    return '<section class="mg-blk now-kit" id="kitchen" aria-labelledby="h-k"><div class="mg-h"><h2 id="h-k">Кухнята</h2><a class="mg-link more" href="' + go.kitchen() + '">Екранът ' + ic("arrow-up-right", 18) + "</a></div>" +
      busy + sectionsHTML(k) + so + "</section>";
  }

  function draw(d: MgrNow): string {
    const has = d.problems.some((x) => !x.done);
    return '<div class="now-grid' + (has ? " has-probs" : "") + '" data-upscr="now"><div class="now-day">' + statusLine(d.date, d.now) + '</div><div class="now-pulse">' + pulse(d) + "</div>" + problems(d) + waits(d) + kitchen(d.kitchen) + ratingsHTML() + "</div>";
  }

  /* ---------- the actions ---------- */
  const prob = (k: string) => (D()?.problems || []).find((p) => p.key === k) || null;
  const order = (no: string) => (D()?.waits.orders || []).find((o) => o.no === no) || null;
  /** the card leaves (the toast with "Отмени" says what happened), then the data again */
  const leave = (k: string) => { const el = boss.body.querySelector('[data-key="' + CSS.escape(k) + '"]'); if (el) el.classList.add("gone"); setTimeout(() => { void S.reload(); }, 260); };
  const after = () => { void S.reload(); };
  const undoT = (f: () => Promise<unknown>) => () => { f().then(after, (e) => boss.toast(msgOf(e))); };

  function accept(no: string, without: boolean) {
    void act(boss, { op: "accept", args: [no, { without }], label: "№" + NB + no + ": „Приеми“.", run: () => bossApi.accept(no, { without }),
      ok: (r) => { boss.orderSeen(); boss.toast("№" + NB + r.no + " е приета" + (r.without.length ? " без „" + r.without.join(", ") + "“" : "") + " · Готви се", { undo: undoT(() => bossApi.acceptUndo(r.undo.id)) }); after(); },
      fail: (e) => { if (e instanceof ApiError && (e.code === "has_out" || e.code === "all_out")) { void S.reload().then(() => { const o = order(no); if (o) void outSheet(o); }); return true; } return false; } });
  }
  /** "Приеми" of an order with a sold-out dish: call first, or "Приеми без него" */
  async function outSheet(o: WaitOrder) {
    let c: Awaited<ReturnType<typeof bossApi.callCustomer>> | null = null;
    try { c = await bossApi.callCustomer(o.no); } catch (e) { if (!isOff(e)) { boss.toast(msgOf(e)); return; } }
    const names = o.out.join(", "), tel = c ? String(c.phone || "").replace(/[^\d+]/g, "") : "";
    const s = boss.sheet({ title: "В поръчката има изчерпано", html: "<p><b>№" + NB + esc(o.no) + " · " + esc(o.channelName + (o.tableN ? " " + o.tableN : "")) + "</b><br>Изчерпано днес: <b>" + esc(names) + "</b>. Обади се на клиента и предложи друго ястие.</p>" +
      '<div class="mg-kv"><span>Клиент</span><b>' + esc(o.name || "") + '</b></div><div class="mg-kv"><span>Телефон</span><b class="tnum">' + esc(c ? prettyPhone(c.phone) : o.phone) + "</b></div>" +
      (o.outAll ? '<p class="mg-note">' + ic("info", 16) + "<span>Всички ястия в поръчката са изчерпани: откажи я от „Поръчки“ в админа, ако клиентът не иска друго.</span></p>"
        : '<p class="mg-note">' + ic("info", 16) + "<span>„Приеми без него“ праща в кухнята останалите ястия и пише бележка в поръчката. Друго ястие се добавя от „Поръчки“ в админа.</span></p>"),
      foot: (o.outAll ? '<a class="pill pill-line pill-lg" href="' + go.order(o.no) + '">' + ic("receipt", 22) + "Към поръчката</a>" : '<button class="pill pill-line pill-lg" type="button" data-wo>' + ic("check", 22) + "Приеми без него</button>") +
        (tel ? '<a class="pill pill-red pill-lg" href="tel:' + esc(tel) + '" data-tel>' + ic("phone", 22) + "Обади се на клиента</a>" : "") });
    const wo = s.foot && s.foot.querySelector<HTMLButtonElement>("[data-wo]");
    if (wo) wo.onclick = () => { s.close(); accept(o.no, true); };
  }
  function ack(key: string, what: "seen" | "called", text: string) {
    void act(boss, { op: "ack", args: [key, what], label: text, run: () => bossApi.ack(key, what),
      ok: () => { boss.toast(text, { undo: undoT(() => bossApi.ackUndo(key)) }); leave(key); } });
  }
  function callGo(p: Problem) {
    const id = p.ref.call!, n = p.ref.table ? p.ref.table.n : "";
    void act(boss, { op: "callGo", args: [id], label: "Маса " + n + ": отиваш ти.", run: () => bossApi.callGo(id),
      ok: () => { boss.toast("Маса " + n + ": отиваш ти. Сервитьорът вижда, че е поето.", { undo: undoT(() => bossApi.callUndo(id)) }); leave(p.key); } });
  }
  function qrConfirm(p: Problem) {
    const t = p.ref.table!;
    void act(boss, { op: "qrConfirm", args: [t.n], label: "Маса " + t.n + ": „Потвърди и прати“.", run: () => bossApi.qrConfirm(t.n),
      ok: (r) => { boss.toast("Маса " + t.n + ": поръчката е в кухнята · №" + NB + r.no); leave(p.key); } });
  }
  function askSheet(p: Problem) {
    const id = p.ref.ask!, no = p.ref.no || "", driver = p.title.split(" · ")[0], parts = p.meta.split(" · "), addr = parts.length > 2 ? parts.slice(1, -1).join(" · ") : "";
    const sh = boss.sheet({ title: "Адрес извън зоните", html: "<p>" + esc(driver) + " пита какво да прави с <b>№" + NB + esc(no) + "</b>. Адресът е извън зоните за доставка.</p>" +
      (addr ? '<div class="mg-kv"><span>Адрес</span><b>' + esc(addr) + "</b></div>" : "") + '<div class="mg-kv"><span>Чака отговор</span><b>' + (p.since ? timer(p.since) : "") + "</b></div>" +
      '<p class="mg-note">' + ic("info", 16) + "<span>Шофьорът вижда отговора веднага в своето приложение.</span></p>",
      /* decision 17.11 (OPEN-QUESTIONS 30): three answers, one under the other; "Да я достави" last, near the thumb */
      foot: '<div class="mg-foot3"><button class="pill pill-line pill-lg" type="button" data-r="return">' + ic("storefront", 22) + 'Върни я в ресторанта</button><button class="pill pill-line pill-lg" type="button" data-r="pickup">' + ic("shopping-bag", 22) + 'Предложи вземане от място</button><button class="pill pill-red pill-lg" type="button" data-r="deliver">' + ic("moped", 22) + "Да я достави</button></div>" });
    const TXT: Record<string, string> = { deliver: "да достави поръчката", pickup: "да предложи на клиента вземане от място", return: "да върне поръчката в ресторанта" };
    sh.foot!.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-r]"); if (!b) return;
      const a = b.dataset.r as "return" | "pickup" | "deliver"; sh.close();
      void act(boss, { op: "answer", args: [id, a], label: driver + ": " + TXT[a] + ".", run: () => bossApi.answer(id, a),
        ok: () => { boss.toast(driver + ": " + TXT[a], { undo: undoT(() => bossApi.answerUndo(id)) }); leave(p.key); } });
    });
  }
  function blockSheet(ref: string) {
    const x = (D()?.waits.blocks || []).find((b) => b.ref === ref); if (!x) return;
    const who = x.name || "Клиент";
    const sh = boss.sheet({ title: "Неявили се: реши", html: "<p><b>" + esc(who) + "</b> не дойде " + (x.count || 2) + " пъти без да се обади (" + esc(x.phone) + ").</p><p>Ако блокираш номера, резервацията от сайта иска обаждане до ресторанта. Отблокира се от „Резервации“ в админа.</p>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-b="clear">Не блокирай</button><button class="pill pill-red pill-lg" type="button" data-b="block">' + ic("lock", 22) + "Блокирай номера</button>" });
    sh.foot!.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-b]"); if (!b) return;
      const block = b.dataset.b === "block"; sh.close();
      /* no "Отмени" (decision 16.11): the confirmation is the sheet */
      void act(boss, { op: "block", args: [ref, block ? "block" : "clear"], label: who + ": " + (block ? "блокирай номера." : "без блокиране."), run: () => bossApi.block(ref, block ? "block" : "clear"),
        ok: () => { boss.toast(block ? who + ": номерът е блокиран за резервации. Отблокира се от „Резервации“ в админа." : who + ": без блокиране"); after(); } });
    });
  }
  function setBusy(on: boolean) {
    const k = D()?.kitchen.busy;
    const text = on ? "„Натоварено“ е включено: „Възможни са закъснения · около " + (k ? k.etaBusyMin : 55) + NB + "мин“." : "„Натоварено“ е изключено: „около " + (k ? k.etaMin : 35) + NB + "мин“.";
    void act(boss, { op: "busy", args: [on], label: text, run: () => bossApi.busy(on),
      ok: () => { boss.toast(text, { undo: undoT(() => bossApi.busy(!on)) }); after(); } });
  }
  function busySheet() {
    const k = D()?.kitchen.busy; if (!k) return;
    boss.confirm({ title: "Включи „Натоварено“?", ok: "Включи", icon: "hourglass",
      html: "<p>Новите поръчки за доставка получават +" + (k.etaBusyMin - k.etaMin) + NB + "мин. Приетите пазят своя час.</p><div class=\"mg-cmp\"><div><span>Сега гостите виждат</span><b>около" + NB + k.etaMin + NB + 'мин</b></div><div class="now"><span>След включване</span><b>Възможни са закъснения · около' + NB + k.etaBusyMin + NB + "мин</b></div></div>" +
        '<p class="mg-note">' + ic("info", 16) + "<span>Сайтът, кухнята и админът показват това веднага; кой и кога го е включил се пише в дневника.</span></p>" }, () => setBusy(true));
  }
  function backIn(id: string, n: string) {
    void act(boss, { op: "backIn", args: [id, true], label: "„" + n + "“: обратно в менюто.", run: () => bossApi.backIn(id, true),
      ok: () => { boss.toast("„" + n + "“ е отново в менюто", { undo: undoT(() => bossApi.backIn(id, false)) }); after(); } });
  }
  function confirmRes(id: string, name: string, time: string) {
    void act(boss, { op: "resConfirm", args: [id], label: name + " · " + time + ": „Потвърди“.", run: () => bossApi.resConfirm(id),
      ok: () => { boss.toast(name + " · " + time + " е потвърдена", { undo: undoT(() => bossApi.resConfirm(id, true)) }); after(); } });
  }
  function callWhy(p: Problem): string {
    if (p.kind === "out") return "Изчерпано днес: " + p.title.replace(/^.*Изчерпано: /, "") + ". Предложи друго ястие или откажи само него.";
    const road = p.icon === "moped", who = p.meta.split(" · ")[1] || "шофьор";
    return "Закъснява " + (p.lateMin || 0) + NB + "мин" + (road ? ", на път с " + who : ", още в кухнята") + ". Кажи на клиента новото време.";
  }

  boss.body.addEventListener("click", (e) => {
    const tg = e.target as Element;
    const j = tg.closest<HTMLElement>("[data-jump]"); if (j) { e.preventDefault(); const t = document.getElementById(j.dataset.jump!); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    const b = tg.closest<HTMLElement>("[data-a]"); if (!b) return;
    const a = b.dataset.a, p = b.dataset.k ? prob(b.dataset.k) : null;
    if (a === "allp") { showAll = true; S.redraw(); return; }
    if (a === "accept") { const o = order(b.dataset.no!); if (o && o.out.length) void outSheet(o); else accept(b.dataset.no!, false); return; }
    if (a === "confirm") { confirmRes(b.dataset.id!, b.dataset.name || "", b.dataset.time || ""); return; }
    if (a === "block") { blockSheet(b.dataset.ref!); return; }
    if (a === "back") { backIn(b.dataset.id!, b.dataset.n || ""); return; }
    if (!p) return;
    if (a === "go") callGo(p);
    else if (a === "assign") {
      const id = p.ref.call!, n = p.ref.table ? p.ref.table.n : null;
      void pickWaiter(boss, "Маса " + (n ?? "") + ": кой отива?", n, (who, name) => {
        if (who === "me") { callGo(p); return; }
        void act(boss, { op: "callAssign", args: [id, who], label: "Маса " + n + ": възложено на " + name + ".", run: () => bossApi.callAssign(id, who),
          ok: () => { boss.toast("Маса " + n + ": възложено на " + name + ". Получава известие.", { undo: undoT(() => bossApi.callUndo(id)) }); leave(p.key); } });
      });
    }
    else if (a === "qr") qrConfirm(p);
    else if (a === "qrassign") {
      const sid = p.ref.session!, n = p.ref.table ? p.ref.table.n : null;
      void pickWaiter(boss, "QR поръчка на Маса " + (n ?? "") + ": кой потвърждава?", n, (who, name) => {
        if (who === "me") { qrConfirm(p); return; }
        void act(boss, { op: "qrAssign", args: [sid, who], label: "QR поръчката на Маса " + n + ": възложена на " + name + ".", run: () => bossApi.qrAssign(sid, who),
          ok: () => { boss.toast("QR поръчката на Маса " + n + " е възложена на " + name + ". Получава известие.", { undo: undoT(() => bossApi.qrAssignUndo(sid)) }); after(); } });
      });
    }
    else if (a === "ask") askSheet(p);
    else if (a === "callc") { const no = p.ref.no!; void callSheet(boss, no, callWhy(p), () => ack(p.kind === "out" ? "out:" + no : "late:" + no, "called", "№" + NB + no + ": обади се на клиента")); }
    else if (a === "without") accept(p.ref.no!, true);
    else if (a === "seen") ack(p.key, "seen", "№" + NB + p.ref.no + ": видяно, кухнята е предупредена");
  });
  boss.body.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement; if (!t.matches("[data-busy]")) return;
    if (t.checked) { t.checked = false; busySheet(); } else setBusy(false);
  });

  /* #n=<№> (the toast "Нова онлайн поръчка · Виж"): the row into view, the badge stops blinking; #go=<block> */
  function see(no: string) {
    boss.orderSeen();
    const r = boss.body.querySelector<HTMLElement>('[data-wno="' + CSS.escape(no) + '"]'); if (!r) return;
    r.scrollIntoView({ block: "center", behavior: "smooth" }); r.classList.remove("flash"); void r.offsetWidth; r.classList.add("flash");
    const b = r.querySelector<HTMLButtonElement>("button"); if (b) b.focus({ preventScroll: true });
  }
  function onHash() {
    const h = hashMap();
    const run = () => { if (h.n) see(h.n); if (h.go) { const el = document.getElementById(h.go); if (el) el.scrollIntoView({ block: "start" }); } };
    if (S.data()) setTimeout(run, 60); else { const t = setInterval(() => { if (S.data()) { clearInterval(t); setTimeout(run, 60); } }, 100); setTimeout(() => clearInterval(t), 8000); }
  }
  window.addEventListener("hashchange", onHash);
  onHash();
}
