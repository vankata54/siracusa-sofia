/* Siracusa · "Повиквания" (/servitor/povikvania/; design/pages-servitor/calls.html): ONE queue. "За мен N" (the core's
   forMe: nobody took it, or I did, + the QR orders for me; N = counters.queue, the same number as the counter of the hall
   and the badge) / "Всички N". By the waiting time, the taken ones at the bottom; the colour follows the time (yellow after
   the warn minutes, red + "Изпратено и на управителя" after settings.callManager; both from the core). "Отивам" →
   "Обслужено" (+ "Отмени" 5 s); a colleague's taken call is dimmed with "Поема <име>"; the QR orders with "Отвори масата". */
import "sc-icons:squares-four";
import { mountStaff, type Staff } from "../staff/frame.ts";
import { fmt } from "../../lib/format.ts";
import { ZONE, REASON, tableUrl, plural, ms, lvl, queue, paint, hallStore, shiftInfo, subOf, searchOf, callActions, esc, ic, murl, type HallLive, type HallCall, type HallQr, type HallStore } from "./common.ts";

export async function mountCalls(): Promise<void> {
  let store: HallStore | null = null, filter: "mine" | "all" = /(^#|&)all\b/.test(location.hash) ? "all" : "mine";
  const st = await mountStaff({ module: "waiter", screen: "calls", tab: "calls", title: "Повиквания", search: () => searchOf(store!)(), shift: () => shiftInfo(st!, store!)() });
  if (!st) return;
  const S: Staff = st;
  store = hallStore(S);
  const acts = callActions(S, store);

  function card(h: HallLive, c: HallCall): string {
    const r = REASON[c.kind], t = h.tables.find((x) => x.n === c.table.n), off = S.offAttr();
    const cls = c.taken ? (c.taken.mine ? " mine-taken" : " other-taken") : "";
    const who = c.taken && c.taken.mine ? "<span>" + ic("check-circle", 18) + "</span><span>Отивам · от " + S.timer(ms(c.taken.at)) + "</span>"
      : c.taken ? "<span>" + ic("user", 18) + "</span><span>Поема " + esc(c.taken.name) + "</span>"
      : t && t.mine ? "<span>Моя маса</span>"
      : "<span>" + (t && t.owner ? "Маса на " + esc(t.owner.name) : "Маса без сервитьор") + " · никой не го е поел, затова е и при мен</span>";
    const note = c.note ? '<span class="cnote">„' + esc(c.note) + "“</span>" : "";
    const escl = c.taken ? "" : '<span class="esc" data-esc hidden>' + ic("warning", 18) + "Изпратено и на управителя</span>";
    return '<article class="callc' + cls + '"' + (c.taken ? "" : lvl(h)) + ' aria-label="Маса ' + c.table.n + ", " + r[0] + '">' +
      '<div class="t1"><b>Маса ' + c.table.n + '</b><span class="zone">' + ZONE[c.table.zone] + "</span></div>" +
      '<div class="timer" style="grid-row:span 2"><span>чака</span><b>' + S.timer(ms(c.at)) + "</b></div>" +
      '<div class="why">' + ic(r[1], 24) + r[0] + "</div>" +
      '<div class="meta">' + who + note + escl + "</div>" +
      (c.taken && !c.taken.mine ? "" : '<div class="acts">' + (c.taken
        ? '<button class="pill pill-red" type="button" data-done="' + esc(c.id) + '" data-fk="d' + esc(c.id) + '"' + off + ' style="background:var(--ok);color:var(--on-ok)">' + ic("check", 22) + "Обслужено</button>"
        : '<button class="pill pill-red" type="button" data-take="' + esc(c.id) + '" data-fk="g' + esc(c.id) + '"' + off + ">Отивам</button>") +
        '<a class="pill pill-line" href="' + esc(tableUrl(c.table.n)) + '">Масата</a></div>') + "</article>";
  }
  function qrCard(h: HallLive, q: HallQr): string {
    return '<article class="callc qrc"' + lvl(h, h.settings.qrManager) + ' aria-label="Маса ' + q.table.n + ', QR поръчка за потвърждение">' +
      '<div class="t1"><b>Маса ' + q.table.n + '</b><span class="zone">' + ZONE[q.table.zone] + "</span></div>" +
      '<div class="timer" style="grid-row:span 2"><span>чака</span><b>' + S.timer(ms(q.at)) + "</b></div>" +
      '<div class="why">' + ic("qr-code", 24) + "QR поръчка · " + plural(q.n, "артикул", "артикула") + "</div>" +
      '<div class="meta"><span>Първата поръчка от QR чака моето потвърждение · ' + fmt(q.sum) + (q.open ? " + стек по грамаж" : "") + "</span>" +
      '<span class="esc" data-esc hidden>' + ic("warning", 18) + "Изпратено и на управителя</span></div>" +
      '<div class="acts"><a class="pill pill-red" href="' + esc(tableUrl(q.table.n)) + '" data-fk="q' + q.table.n + '">Отвори масата</a></div></article>';
  }
  function render() {
    const h = store!.get(); if (!h) return;
    S.setTop({ sub: subOf(S, h) });
    const list = queue(h, filter === "all"), mineN = h.counters.queue, allN = h.calls.length + h.qr.length;
    let html = '<section class="st-sec"><div class="st-seg" role="group" aria-label="Кои повиквания">' +
      '<button type="button" data-f="mine" data-fk="fmine" aria-pressed="' + (filter === "mine") + '">За мен <span class="n">' + mineN + "</span></button>" +
      '<button type="button" data-f="all" data-fk="fall" aria-pressed="' + (filter === "all") + '">Всички <span class="n">' + allN + "</span></button></div></section>";
    if (!list.length) {
      html += S.empty({ title: "Няма повиквания", text: filter === "mine" && allN ? "Нищо не чака теб. Повикванията на колегите са във „Всички“." : "Всички маси са обслужени. Щом някой повика, телефонът и часовникът ще вибрират.",
        action: '<a class="pill pill-line pill-lg" href="' + esc(murl.servitor()) + '">' + ic("squares-four", 22) + "Към залата</a>" });
    } else {
      const open = queue(h).filter((it) => it.kind === "qr" || !it.c.taken).sort((a, b) => a.since - b.since), oldest = open[0];
      if (mineN >= 5) html += '<section class="st-sec"><div class="lead2">' + ic("warning", 24) + "<span><b>" + mineN + "</b> чакат наведнъж" + (oldest ? " · най-старото: Маса " + oldest.n + ", " + S.timer(oldest.since) : "") + ". Първо най-старото; колегите виждат кои са поети.</span></div></section>";
      const rows = list.map((it) => ({ s: it.since, t: it.kind === "call" && it.c.taken ? 1 : 0, html: it.kind === "qr" ? qrCard(h, it.q) : card(h, it.c) }));
      html += '<section class="st-sec"><div class="list">' + rows.sort((a, b) => a.t - b.t || a.s - b.s).map((r) => r.html).join("") + "</div></section>";
    }
    paint(S, html); escTick();
  }
  /* "Изпратено и на управителя" goes with the red colour of the card (the frame sets .late from the timer) */
  function escTick() { S.main.querySelectorAll<HTMLElement>("[data-esc]").forEach((el) => { const c = el.closest(".callc"); el.hidden = !(c && c.classList.contains("late")); }); }
  setInterval(escTick, 1000);

  S.main.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button"); if (!b || b.hasAttribute("data-off")) return;
    if (b.dataset.f) { filter = b.dataset.f === "all" ? "all" : "mine"; render(); return; }
    if (b.dataset.take) { acts.take(b.dataset.take); return; }
    if (b.dataset.done) { acts.done(b.dataset.done); return; }
  });
  store.on(render);
  S.onNet(render);
  setInterval(() => { if (!document.hidden && !S.stale) render(); }, 15_000);
  await store.load();
  render();
}
