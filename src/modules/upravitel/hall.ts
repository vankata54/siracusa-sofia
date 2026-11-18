/* Siracusa · "Управител" › "Залата" (/upravitel/zalata/): port of design/pages-upravitel/hall.html over the core
   (bossApi.hall, table, setWaiter, walkin, resConfirm). Салон / Градина (on the phone a switch, from 900 px side by side),
   the tiles (number, state word + icon, the waiter, since when / how long it waits, the lock "само с резервация"), the
   legend; "До края на вечерта" ("Потвърди" for the new ones, "Закъснява 42 мин" only while the table is not occupied),
   "Чакат маса"; the links to the admin (new reservation, all reservations, the plan, the QR codes). The sheet of a table
   (#t=12): the state, who serves it (a change in one tap), occupied since, the orders of the table and the sum OF THE
   TABLE, the call, the next reservation (a future hour only), "Блокирай за гости без резервация", "В плана на админа".
   MONEY: the sum of ONE order and of ONE table only (MgrHall.tablesSum is never drawn). */
import "sc-icons:hand-waving,receipt,qr-code,chef-hat,hourglass,users,calendar-check,check-circle,check,user,lock,info,plus,chair,arrow-right,clock";
import { mountBoss, tag, cnt, type Boss } from "../boss/frame.ts";
import { bossApi, type MgrHall, type MgrTile, type MgrTable, type TonightRes } from "../../client/api-boss.ts";
import { fmtNb as fmt } from "../../lib/format.ts";
import { ic, esc, NB, ppl, timer, hmOf, secSince, statusOf, toMin, nbsp, lateText, TST, tagCls, ZONE, go, screen, act, nowBadge, hashMap, isOff, msgOf, type Screen } from "./common.ts";

export async function initHall(): Promise<void> {
  const boss = await mountBoss({ module: "upravitel", tab: "hall", title: "Залата", search: { load: () => import("./find.ts").then((m) => m.provider(boss!)) } });
  if (!boss) return;
  hallScreen(boss);
}

const minsSince = (iso: string) => Math.max(1, Math.round(secSince(iso) / 60));
function tile(x: MgrTile): string {
  const s = TST[x.state] || TST.free;
  let tm = "";
  if ((x.state === "call" || x.state === "bill" || x.state === "qr") && x.since) tm = timer(x.since) + "<small>чака</small>";
  else if (x.since && x.state !== "free" && x.state !== "res") tm = "от " + hmOf(x.since) + "<small>" + minsSince(x.since) + NB + "мин</small>";
  else if (x.next) tm = esc(x.next.time) + "<small>" + ppl(x.next.people) + "</small>";
  return '<button class="mg-tile ' + x.state + '" type="button" data-t="' + x.n + '"><span class="no"><span class="vh">Маса </span>' + x.n + '</span><span class="tm">' + tm + "</span>" +
    '<span class="w">' + ic(s[1], 18) + esc(s[0]) + '</span><span class="who">' + ic("user", 16) + "<span>" + esc(x.waiter ? x.waiter.name : "без сервитьор") + "</span></span>" +
    (x.walkin ? "" : '<span class="lock" title="Само с резервация">' + ic("lock", 18) + '<span class="vh">, само с резервация</span></span>') + "</button>";
}
const seated = (x: MgrTile) => x.state !== "free" && x.state !== "res";
function zoneHTML(z: string, list: MgrTile[]): string {
  return '<div class="mg-zone"><h3>' + ZONE[z] + ' <span class="muted">' + list.filter(seated).length + " от " + list.length + " заети</span></h3><div class=\"mg-tiles\">" + list.map(tile).join("") + "</div></div>";
}
const RS: Record<string, [string, string, string]> = { new: ["warn", "hourglass", "Нова"], confirmed: ["", "check", "Потвърдена"] };
function resRow(r: TonightRes): string {
  return '<div class="mg-rrow"><span class="rt">' + esc(r.time) + "</span><div><b>" + esc(r.name) + "</b><small>" + ppl(r.people) + "</small><small>" + (r.tableN ? "Маса" + NB + r.tableN + (r.zone ? " ·" + NB + esc(r.zone) : "") : "без маса") + (r.occasion ? " ·" + NB + esc(r.occasion) : "") + "</small>" +
    (r.lateMin ? '<span class="up-late">' + tag("warn", "clock", "Закъснява " + lateText(r.lateMin).replace(/ (мин|ч)/g, NB + "$1")) + "</span>" : "") + "</div>" +
    (r.canConfirm ? '<button class="pill pill-ink" type="button" data-confirm="' + esc(r.id) + '" data-name="' + esc(r.name) + '" data-time="' + esc(r.time) + '" aria-label="Потвърди ' + esc(r.name) + " в " + esc(r.time) + '">' + ic("check", 20) + "Потвърди</button>"
      : RS[r.status] ? tag(RS[r.status][0], RS[r.status][1], RS[r.status][2]) : tag("line", "", r.statusLabel)) + "</div>";
}

function hallScreen(boss: Boss): void {
  let zone: "salon" | "garden" = hashMap().z === "garden" ? "garden" : "salon";
  boss.body.innerHTML = boss.skeleton(5, "Зареждаме залата…");
  nowBadge(boss);
  const S: Screen<MgrHall> = screen(boss, { load: () => bossApi.hall(), err: "Масите и резервациите не се заредиха. Опитай пак след малко.", draw });

  function resHTML(d: MgrHall): string {
    const list = d.tonight, wl = d.waitlist;
    const wrows = wl.map((r) => '<div class="mg-rrow"><span class="rt">' + esc(r.time) + "</span><div><b>" + esc(r.name) + "</b><small>" + ppl(r.people) + "</small><small>Чака маса ·" + NB + esc(r.phone).replace(/ /g, NB) + "</small></div>" + tag("line", "hourglass", "Чака маса") + "</div>").join("");
    return '<section class="mg-blk" id="res" aria-labelledby="h-r"><div class="mg-h"><h2 id="h-r">До края на вечерта</h2>' + (list.length ? cnt(list.length) : "") + "</div>" +
      (list.length ? '<div class="mg-card mg-list">' + list.map(resRow).join("") + "</div>" : '<div class="mg-allok">' + ic("calendar-check", 28) + "<div><b>" + "Няма повече резервации тази вечер" + "</b><span>Новите от сайта и по телефона идват тук.</span></div></div>") +
      (wrows ? '<div class="mg-h up-sub"><h2>Чакат маса</h2>' + cnt(wl.length) + '</div><div class="mg-card mg-list">' + wrows + "</div>" : "") +
      (d.canReservations ? '<div class="mg-acts"><a class="pill pill-red pill-lg" href="' + go.newRes() + '">' + ic("plus", 22) + 'Нова резервация</a><a class="pill pill-line pill-lg" href="' + go.resDay(todayOf()) + '">' + ic("calendar-check", 22) + "Всички резервации</a></div>" : "") +
      '<div class="mg-acts up-acts2">' + (boss.can("hall") ? '<a class="pill pill-line" href="' + go.plan() + '">' + ic("chair", 20) + "Планът на залата</a>" : "") + (boss.can("qr") ? '<a class="pill pill-line" href="' + go.qr() + '">' + ic("qr-code", 20) + "QR кодовете</a>" : "") + "</div></section>";
  }
  function draw(d: MgrHall): string {
    const T = d.tiles, sal = T.filter((x) => x.zone === "salon"), gar = T.filter((x) => x.zone === "garden"), busy = T.filter(seated).length;
    const leg = d.legend.map(([k, w]) => tag(tagCls(k), (TST[k] || TST.free)[1], w)).join("");
    return '<p class="hl-sum" data-upscr="hall"><b>' + busy + " от " + T.length + " маси заети</b><span>" + esc(d.now) + " · " + nbsp(esc(statusOf(toMin(d.now))[1])) + "</span></p>" +
      '<div class="hl-grid"><section class="mg-blk" aria-labelledby="h-t"><div class="mg-h"><h2 id="h-t">Масите</h2><span class="mg-sample" title="Масите са условни">' + ic("info", 16) + "Условен план</span></div>" +
        '<div class="mg-seg hl-seg" role="group" aria-label="Зона"><button type="button" data-z="salon" aria-pressed="' + (zone === "salon") + '">Салон <span class="n">' + sal.filter(seated).length + "/" + sal.length + '</span></button><button type="button" data-z="garden" aria-pressed="' + (zone === "garden") + '">Градина <span class="n">' + gar.filter(seated).length + "/" + gar.length + "</span></button></div>" +
        '<div class="hl-zone-p">' + zoneHTML(zone, zone === "salon" ? sal : gar) + "</div>" +
        '<div class="hl-zone-d">' + zoneHTML("salon", sal) + zoneHTML("garden", gar) + "</div>" +
        '<div class="mg-legend" aria-label="Какво значат цветовете">' + leg + "</div>" +
        '<p class="mg-note">' + ic("info", 16) + '<span>Масите и номерата са условни <span class="missing">[ЛИПСВА: истински маси и план]</span>. Докосни маса за сервитьора, сумата и блокирането.</span></p></section>' +
      resHTML(d) + "</div>";
  }

  /* ---------- the sheet of a table ---------- */
  async function tableSheet(n: number) {
    let x: MgrTable;
    try { x = await bossApi.table(n); } catch (e) { boss.toast(isOff(e) ? "Няма връзка. Опитай пак, щом се върне." : msgOf(e)); return; }
    const s = TST[x.state] || TST.free, call = x.calls.find((c) => !c.taken) || null;
    const orders = x.orders.map((o) => '<div class="mg-kv"><span>№' + NB + esc(o.no) + " · " + esc(o.statusLabel) + " · " + esc(o.placedAt) + '</span><b class="price">' + fmt(o.total) + "</b></div>").join("");
    const html = '<p class="up-tags">' + tag(x.state === "busy" || x.state === "res" || x.state === "qr" ? "" : tagCls(x.state), s[1], s[0]) + (x.walkin ? "" : tag("line", "lock", "Само с резервация")) + "</p>" +
      "<h3>Обслужва</h3>" + (x.waiters.length ? '<div class="mg-pick" role="group" aria-label="Смени сервитьора">' + x.waiters.map((w) => { const on = !!x.waiter && x.waiter.username === w.username;
        return '<button type="button" data-sw="' + esc(w.username) + '" data-swn="' + esc(w.name) + '" aria-pressed="' + on + '">' + ic("user", 22) + esc(w.name) + "<small>" + (on ? "сега" : "смени на него") + "</small></button>"; }).join("") + "</div>"
        : '<p class="mg-note">' + ic("info", 16) + "<span>Никой сервитьор не е на смяна. Сервитьорите избират масите си при вход.</span></p>") +
      "<h3>Сега</h3>" +
      (x.occupiedSince ? '<div class="mg-kv"><span>Заета от</span><b>' + hmOf(x.occupiedSince) + " · " + minsSince(x.occupiedSince) + NB + "мин</b></div>" +
        /* no "Сума на масата 0,00 €" while there is no order */
        (orders ? orders + '<div class="mg-kv up-sum"><span>Сума на масата</span><b class="price">' + fmt(x.sum) + "</b></div>" : '<div class="mg-kv"><span>Поръчки</span><b>още няма</b></div>')
        : '<div class="mg-kv"><span>Масата</span><b>свободна</b></div>') +
      (call ? '<div class="mg-kv"><span>Повикване</span><b>' + esc(call.label) + " · чака " + timer(call.at) + "</b></div>" : "") +
      (x.state === "qr" ? '<div class="mg-kv"><span>QR поръчка</span><b>чака потвърждение</b></div>' : "") +
      '<div class="mg-kv"><span>Следваща резервация</span><b>' + (x.next ? esc(x.next.time) + " · " + ppl(x.next.people) + " · " + esc(x.next.name) : "няма до края на вечерта") + "</b></div>" +
      (x.canWalkin ? '<h3>Гости без резервация</h3><label class="mg-busy up-walk"><b>' + ic("lock", 22) + 'Блокирай за гости без резервация</b><span class="mg-switch"><input type="checkbox" role="switch" data-walk aria-label="Блокирай маса ' + x.table.n + ' за гости без резервация"' + (x.walkin ? "" : " checked") + '><span class="tr"></span></span><span class="sub">Масата се дава само по резервация. Сменя се и в плана на админа.</span></label>' : "");
    const sh = boss.sheet({ title: "Маса " + x.table.n + " · " + x.table.zoneName, html,
      foot: (boss.can("hall") ? '<a class="pill pill-line pill-lg" href="' + go.plan(x.table.zone) + '">' + ic("chair", 22) + "В плана на админа</a>" : "") + (call ? '<button class="pill pill-red pill-lg" type="button" data-go>' + ic("arrow-right", 22) + "Отивам</button>" : "") });
    sh.body.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-sw]"); if (!b || b.getAttribute("aria-pressed") === "true") return;
      const to = b.dataset.sw!, name = b.dataset.swn || "", was = x.waiter;
      sh.close();
      void act(boss, { op: "setWaiter", args: [x.table.n, to], label: "Маса " + x.table.n + ": обслужва " + name + ".", run: () => bossApi.setWaiter(x.table.n, to),
        ok: () => { boss.toast("Маса " + x.table.n + ": обслужва " + name + ". " + name + (was ? " и " + was.name + " получават известие." : " получава известие."),
          was ? { undo: () => { bossApi.setWaiter(x.table.n, was.username).then(() => S.reload(), (er) => boss.toast(msgOf(er))); } } : {}); void S.reload(); } });
    });
    sh.body.addEventListener("change", (e) => {
      const t = e.target as HTMLInputElement; if (!t.matches("[data-walk]")) return;
      const allow = !t.checked, nn = x.table.n, text = allow ? "Маса " + nn + " е отново и за гости без резервация" : "Маса " + nn + " е само с резервация";
      void act(boss, { op: "walkin", args: [nn, allow], label: text + ".", run: () => bossApi.walkin(nn, allow),
        ok: () => { boss.toast(text, { undo: () => { bossApi.walkin(nn, !allow).then(() => S.reload(), (er) => boss.toast(msgOf(er))); } }); void S.reload(); } });
    });
    const g = sh.foot && sh.foot.querySelector<HTMLButtonElement>("[data-go]");
    if (g && call) g.onclick = () => {
      sh.close();
      void act(boss, { op: "callGo", args: [call.id], label: "Маса " + x.table.n + ": отиваш ти.", run: () => bossApi.callGo(call.id),
        ok: () => { boss.toast("Маса " + x.table.n + ": отиваш ти. Сервитьорът вижда, че е поето.", { undo: () => { bossApi.callUndo(call.id).then(() => S.reload(), (er) => boss.toast(msgOf(er))); } }); void S.reload(); } });
    };
  }

  boss.body.addEventListener("click", (e) => {
    const tg = e.target as Element;
    const t = tg.closest<HTMLElement>("[data-t]"); if (t) { void tableSheet(+t.dataset.t!); return; }
    const z = tg.closest<HTMLElement>("[data-z]");
    if (z) { zone = z.dataset.z === "garden" ? "garden" : "salon"; S.redraw(); const nb = boss.body.querySelector<HTMLElement>('[data-z="' + zone + '"]'); if (nb) nb.focus({ preventScroll: true }); return; }
    const c = tg.closest<HTMLElement>("[data-confirm]");
    if (c) {
      const id = c.dataset.confirm!, name = c.dataset.name || "", time = c.dataset.time || "";
      void act(boss, { op: "resConfirm", args: [id], label: name + " · " + time + ": „Потвърди“.", run: () => bossApi.resConfirm(id),
        ok: () => { boss.toast(name + " · " + time + " е потвърдена", { undo: () => { bossApi.resConfirm(id, true).then(() => S.reload(), (er) => boss.toast(msgOf(er))); } }); void S.reload(); } });
    }
  });
  function onHash() {
    const h = hashMap();
    const run = () => { if (h.t && /^\d{1,3}$/.test(h.t)) void tableSheet(+h.t); if (h.go) { const el = document.getElementById(h.go); if (el) el.scrollIntoView({ block: "start" }); } };
    if (S.data()) setTimeout(run, 80); else { const iv = setInterval(() => { if (S.data()) { clearInterval(iv); setTimeout(run, 80); } }, 100); setTimeout(() => clearInterval(iv), 8000); }
  }
  window.addEventListener("hashchange", onHash);
  onHash();
}
/** today in Sofia ("2026-11-18") */
function todayOf(): string { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date()); } catch { return new Date().toISOString().slice(0, 10); } }
