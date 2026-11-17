/* Siracusa · "Залата" (/servitor/), the first screen of the waiter (design/pages-servitor/tables.html, 1:1 on the core's data):
   the counters (the ONE queue number, tables with ready dishes, free tables), "Чакат сега" (the late ones first, then my
   tables, then by time; the QR orders too), "Моите маси", "Резервации" with "Нова резервация" (the admin's reservations
   API: the waiter's role has the section "Резервации"), "Цялата зала" Салон / Градина with the tiles and the legend.
   Live: the hall reloads after every event of the floor; the timers tick from the timestamps; no connection: the frame's
   whole screen, then "Виж последните данни" (frozen timers, actions say why they wait). */
import { flushOutbox } from "./bits.ts";
import "sc-icons:plus,minus,calendar-blank,calendar-check,caret-down,magnifying-glass";
import { mountStaff, type Staff } from "../staff/frame.ts";
import { reservationsAdminApi, ApiError, type ResRow } from "../../client/api-admin-3.ts";
import { aurl } from "../../admin/routes.ts";
import {
  ZONE, REASON, SHORT, STATE_ICON, LEGEND, tableUrl, plural, ms, sofiaDay, sofiaMin, dayText, hm, lvl, whose, queue, sortNow, paint, hallStore, shiftInfo, subOf, searchOf, callActions, why, esc, ic, murl,
  type HallLive, type HallTile, type QItem, type HallStore,
} from "./common.ts";

export async function mountHall(): Promise<void> {
  let store: HallStore | null = null;
  let zone: "salon" | "garden" = /(^#|&)zone=garden/.test(location.hash) ? "garden" : "salon", allRes = false;
  const st = await mountStaff({
    module: "waiter", screen: "tables", tab: "tables", title: "Залата", offlineFull: true,
    homeFind: { text: "Търси маса, №, резервация, ястие…", label: "Търси маса, №, резервация, ястие…" },
    search: () => searchOf(store!)(),
    shift: () => shiftInfo(st!, store!)(),
  });
  if (!st) return;
  const S: Staff = st;
  store = hallStore(S);
  const acts = callActions(S, store);

  /* ---------- today's reservations (null: not loaded; "no": the role has no section "Резервации") ---------- */
  let res: ResRow[] | null = null, resNo = false;
  async function loadRes() {
    try { const d = await reservationsAdminApi.day({ date: sofiaDay() }); res = d.rows.filter((r) => r.status === "new" || r.status === "confirmed" || r.status === "waitlist"); resNo = false; }
    catch (e) { if (e instanceof ApiError && e.status === 403) resNo = true; }
  }

  /* ---------- pieces ---------- */
  function tile(h: HallLive, t: HallTile): string {
    const k = t.state, since = ms(t.since), word = k === "call" && t.reason ? REASON[t.reason][0] : SHORT[k];
    const tm = t.waits ? '<span class="tm">чака ' + S.timer(since) + "</span>" : k === "busy" ? '<span class="tm" style="font-weight:700;opacity:.8">от ' + Math.max(1, Math.round(S.secs(since) / 60)) + " мин</span>" : '<span class="tm" aria-hidden="true"></span>';
    /* the name is the visible text with the hidden words around it ("Маса 3 Салон Моя QR поръчка чака 1:00"): the label
       always contains what is seen (axe "label-content-name-mismatch") */
    const state = k === "call" ? "Вика: " : k === "bill" ? "Чака " : "";
    return '<a class="tile ' + k + (t.mine ? "" : " other") + '" href="' + esc(tableUrl(t.n)) + '"' + (t.waits ? lvl(h, k === "qr" ? h.settings.qrManager : undefined) : "") + ' data-fk="t' + t.n + '">' +
      '<span class="no"><span class="vh">Маса </span>' + t.n + '<span class="vh"> ' + ZONE[t.zone] + "</span></span>" + (t.mine ? '<span class="own">Моя</span>' : "") +
      '<span class="w">' + ic(STATE_ICON[k], 18) + (state ? '<span class="vh">' + state + "</span>" : "") + esc(word) + "</span>" + tm + "</a>";
  }
  /* one strip per waiting thing; the colour follows the waiting time, the words say whose table it is */
  function strip(h: HallLive, it: QItem): string {
    const url = esc(tableUrl(it.n));
    if (it.kind === "qr") {
      return '<div class="cstrip"' + lvl(h, h.settings.qrManager) + '><a class="tx" href="' + url + '">' + ic("qr-code", 24) + '<span class="w"><span>Маса ' + it.n + '</span><small>QR поръчка · <span class="nlate">чака потвърждение</span><span class="escl">при управителя</span></small></span></a>' +
        '<span class="tm">' + S.timer(it.since) + '</span><a class="pill" href="' + url + '" data-fk="qr' + it.n + '">Виж</a></div>';
    }
    const c = it.c, r = REASON[c.kind], mineTaken = !!c.taken && c.taken.mine, off = S.offAttr();
    const sub = r[0] + " · " + (mineTaken ? "отивам" : '<span class="nlate">' + esc(whose(h, it.n)) + '</span><span class="escl">при управителя</span>');
    return '<div class="cstrip' + (mineTaken ? " taken" : "") + '"' + (c.taken ? "" : lvl(h)) + '><a class="tx" href="' + url + '">' + ic(r[1], 24) + '<span class="w"><span>Маса ' + it.n + "</span><small>" + sub + "</small></span></a>" +
      '<span class="tm">' + S.timer(it.since) + "</span>" +
      (mineTaken ? '<button class="pill" type="button" data-done="' + esc(c.id) + '" data-fk="d' + esc(c.id) + '"' + off + ">" + ic("check", 20) + "Обслужено</button>"
        : '<button class="pill" type="button" data-take="' + esc(c.id) + '" data-fk="g' + esc(c.id) + '"' + off + ">Отивам</button>") + "</div>";
  }
  function resRow(r: ResRow, today: string): string {
    const sub = [r.date === today ? "Днес" : dayText(r.date), r.phone, r.status === "waitlist" ? "Чака маса" : "", r.note || ""].filter(Boolean).map(esc).join(" · ");
    return '<div class="resr"><span class="tm">' + esc(r.time) + "</span><b>" + (r.tableN ? "Маса " + r.tableN : "Без маса") + " · " + plural(r.people, "човек", "души") + " · " + esc(r.name) + "</b><small>" + sub + "</small></div>";
  }

  /* ---------- the screen ---------- */
  function render() {
    const h = store!.get(); if (!h) return;
    S.setTop({ sub: subOf(S, h) });
    const q = sortNow(S, h, queue(h)), n = h.counters;
    let html = '<section class="st-sec" style="padding-top:12px"><div class="sum">' +
      '<a href="' + esc(murl.servitor("povikvania")) + '"' + (n.queue ? ' class="hot"' : "") + "><b>" + n.queue + "</b><span>повиквания и QR</span></a>" +
      '<a href="' + esc(murl.servitor("gotovi")) + '"' + (n.readyTables ? ' class="emb"' : "") + "><b>" + n.readyTables + "</b><span>маси с готово</span></a>" +
      '<a href="#zala"><b>' + n.free + "</b><span>свободни маси</span></a></div></section>";
    if (q.length) {
      html += '<section class="st-sec"><div class="st-h"><h2>Чакат сега</h2><span class="muted">закъснелите, после моите</span></div><div class="strips">' + q.slice(0, 3).map((it) => strip(h, it)).join("") + "</div>" +
        (q.length > 3 ? '<div class="more"><a class="link" href="' + esc(murl.servitor("povikvania")) + '">Още ' + (q.length - 3) + " в „Повиквания“" + ic("caret-right", 18) + "</a></div>" : "") + "</section>";
    }
    const mine = h.tables.filter((t) => t.mine);
    if (h.me.onShift) {
      html += '<section class="st-sec"><div class="st-h"><h2>Моите маси</h2><span class="muted">' + plural(mine.length, "маса", "маси") + "</span></div>" +
        (mine.length ? '<div class="tgrid">' + mine.map((t) => tile(h, t)).join("") + "</div>" : '<div class="notice">' + ic("users", 22) + "<span>Нямаш маси сега. Управителят може да ти даде.</span></div>") + "</section>";
    } else if (!S.boss) {
      html += '<section class="st-sec"><div class="st-h"><h2>Моите маси</h2></div><div class="notice">' + ic("users", 22) + '<span><b>Не си на смяна.</b> Избери своите маси, за да идват повикванията от тях при теб.</span></div>' +
        '<a class="pill pill-red pill-lg pill-block" style="margin-top:12px" href="' + esc(murl.servitor("vhod", "shift")) + '">Започни смяната</a></section>';
    }
    const today = sofiaDay();
    html += '<section class="st-sec" id="res"><div class="st-h"><h2>Резервации</h2>' +
      (resNo ? '<a class="link" href="' + esc(aurl.section("reservations")) + '" style="font-size:16px">' + ic("plus", 20) + "Нова резервация</a>"
        : '<button class="link" type="button" data-newres data-fk="newres" style="font-size:16px"' + S.offAttr() + ">" + ic("plus", 20) + "Нова резервация</button>") + "</div>" +
      (resNo ? '<div class="notice">' + ic("calendar-blank", 22) + "<span>Резервациите са в админ панела.</span></div>"
        : res && res.length ? '<div class="resl">' + res.slice(0, allRes ? 999 : 3).map((r) => resRow(r, today)).join("") + "</div>" +
          (res.length > 3 && !allRes ? '<div class="more"><button class="link" type="button" data-allres data-fk="allres">Още ' + (res.length - 3) + ic("caret-down", 18) + "</button></div>" : "")
        : '<div class="notice">' + ic("calendar-blank", 22) + "<span>" + (res ? "Няма резервации за днес." : "Резервациите не се заредиха.") + "</span></div>") + "</section>";
    const zones = (["salon", "garden"] as const).filter((z) => h.tables.some((t) => t.zone === z));
    if (!zones.includes(zone) && zones.length) zone = zones[0];
    html += '<section class="st-sec" id="zala"><div class="st-h"><h2>Цялата зала</h2></div>' +
      (zones.length > 1 ? '<div class="st-seg" role="group" aria-label="Зона" style="margin-bottom:12px">' + zones.map((z) => '<button type="button" data-zone="' + z + '" data-fk="z' + z + '" aria-pressed="' + (zone === z) + '">' + ZONE[z] + ' <span class="n">' + h.tables.filter((t) => t.zone === z).length + "</span></button>").join("") + "</div>" : "") +
      (h.tables.length ? '<div class="tgrid">' + h.tables.filter((t) => t.zone === zone).map((t) => tile(h, t)).join("") + "</div>" : '<div class="notice">' + ic("chair", 22) + "<span>Още няма маси. Управителят ги добавя в „Залата“ в админ панела.</span></div>") +
      '<p class="st-cap" style="margin-top:18px">Какво значат цветовете</p><div class="legend">' + LEGEND.map(([k, w]) => S.stt(k, w, STATE_ICON[k])).join("") + "</div></section>";
    paint(S, html);
  }

  /* ---------- "Нова резервация" for the staff (decision 15.11): no marketing consent, "Отмени" in the toast ---------- */
  function newRes() {
    if (resNo) { location.href = aurl.section("reservations"); return; }
    const d0 = sofiaDay(), d1 = sofiaDay(1), dMax = sofiaDay(92);
    const SLOTS: number[] = []; for (let m = 660; m <= 1290; m += 30) SLOTS.push(m);
    const f = { day: d0, at: null as number | null, n: 2, t: null as string | null, name: "", phone: "", note: "" };
    let err: Record<string, string> = {}, free: { id: string; n: number; zone: "salon" | "garden"; seats: number }[] | null = null, ask = 0, saving = false;
    const slots = () => { const m = f.day === d0 ? sofiaMin() : -1; return SLOTS.filter((x) => x > m + 15); };
    f.at = slots()[0] ?? null;
    /* the frame's own sheet (frame.ts), not the site's SC.sheet: no sc-sheet.ts here */
    const frameSheet = S.sheet;
    const sh = frameSheet({ title: "Нова резервация", html: '<div class="rsheet" data-rs></div>', foot: '<button class="pill pill-red pill-lg pill-block" type="button" data-rsave>' + ic("calendar-check", 22) + "Запази резервацията</button>" });
    const box = sh.el.querySelector<HTMLElement>("[data-rs]")!;
    const e = (k: string) => (err[k] ? '<span class="err" id="e-' + k + '">' + esc(err[k]) + "</span>" : "");
    const inv = (k: string) => (err[k] ? ' aria-invalid="true" aria-describedby="e-' + k + '"' : "");
    /** the tables that fit: first the ones with up to 2 seats more, else every free table with enough seats */
    const fit = () => { if (!free) return []; const near = free.filter((t) => t.seats <= f.n + 2); return (near.length ? near : free).slice().sort((a, b) => a.seats - b.seats || a.n - b.n); };
    function focusKey(): string | null {
      const a = document.activeElement as HTMLElement | null; if (!a || !box.contains(a)) return null;
      if (a.id) return "#" + a.id;
      for (const k of ["day", "n", "rt"]) if (a.dataset[k] !== undefined) return "[data-" + k + '="' + a.dataset[k] + '"]';
      return null;
    }
    function draw(focus?: string | null) {
      const sl = slots(), ts = fit();
      if (f.t && free && !ts.some((t) => t.id === f.t)) f.t = null;
      box.innerHTML =
        '<div class="field" style="margin-top:0"><span class="label" id="l-day">Дата</span><div class="days" role="group" aria-labelledby="l-day">' +
          [[d0, "Днес"], [d1, "Утре"]].map((x) => '<button class="chip" type="button" data-day="' + x[0] + '" aria-pressed="' + (f.day === x[0]) + '">' + x[1] + " · " + dayText(x[0]) + "</button>").join("") +
          '</div><label class="help" for="rday" style="margin-top:4px">Или друга дата</label><input class="input" id="rday" type="date" min="' + d0 + '" max="' + dMax + '" value="' + f.day + '"' + inv("day") + ">" + e("day") + "</div>" +
        '<div class="grid2"><div class="field"><label for="rat">Час</label>' + (sl.length ? '<select class="input" id="rat"' + inv("at") + ">" + sl.map((x) => '<option value="' + x + '"' + (x === f.at ? " selected" : "") + ">" + hm(x) + "</option>").join("") + "</select>" : '<p class="muted" style="margin:0">За днес часовете свършиха.</p>') + e("at") + "</div>" +
          '<div class="field"><span class="label" id="l-n">Брой хора</span><div class="stepper" role="group" aria-labelledby="l-n"><button type="button" data-n="-1" aria-label="По-малко хора"' + (f.n <= 1 ? " disabled" : "") + ">" + ic("minus", 20) + '</button><output aria-live="polite">' + f.n + '</output><button type="button" data-n="1" aria-label="Повече хора"' + (f.n >= 12 ? " disabled" : "") + ">" + ic("plus", 20) + "</button></div></div></div>" +
        (f.n >= 12 ? '<p class="small muted" style="margin:8px 0 0">Повече от 12 души: празник, през управителя.</p>' : "") +
        '<div class="field"><span class="label" id="l-t">Маса · свободните за ' + (f.at != null ? hm(f.at) : "часа") + "</span>" +
          (f.at == null ? '<p class="muted" style="margin:0">Избери друга дата.</p>'
            : !free ? '<p class="muted" style="margin:0" role="status">Търсим свободните маси …</p>'
            : ts.length ? '<div class="tchips" role="group" aria-labelledby="l-t">' + ts.map((t) => '<button class="chip" type="button" data-rt="' + esc(t.id) + '" aria-pressed="' + (f.t === t.id) + '"><span class="vh">Маса </span>' + t.n + " <small>" + ZONE[t.zone] + " · " + t.seats + " места</small></button>").join("") + "</div>"
            : f.n > 6 ? '<p class="muted" style="margin:0">Над 6 души: управителят събира маси.</p>' : '<p class="muted" style="margin:0">Няма свободна маса за ' + f.n + " в този час. Опитай друг час.</p>") + e("t") + "</div>" +
        '<div class="field"><label for="rname">Име на госта</label><input class="input" id="rname" autocomplete="off" value="' + esc(f.name) + '"' + inv("name") + ">" + e("name") + "</div>" +
        '<div class="field"><label for="rph">Телефон на госта</label><input class="input" id="rph" type="tel" inputmode="tel" autocomplete="off" placeholder="0888 12 34 56" value="' + esc(f.phone) + '"' + inv("phone") + ">" + e("phone") + "</div>" +
        '<div class="field"><label for="rnote">Бележка (по желание)</label><input class="input" id="rnote" autocomplete="off" maxlength="300" placeholder="Например: детско столче" value="' + esc(f.note) + '"></div>';
      if (focus) { const el = box.querySelector<HTMLElement>(focus); if (el) el.focus(); }
    }
    async function fetchFree() {
      const id = ++ask; free = null; draw(focusKey());
      if (f.at == null) return;
      try { const list = await reservationsAdminApi.free(f.day, hm(f.at), f.n); if (id === ask) { free = list; draw(focusKey()); } }
      catch (x) { if (id === ask) { free = []; err.t = why(x); draw(focusKey()); } }
    }
    fetchFree();
    box.addEventListener("input", (ev) => { const t = ev.target as HTMLInputElement; if (t.id === "rname") f.name = t.value; else if (t.id === "rph") f.phone = t.value; else if (t.id === "rnote") f.note = t.value; });
    box.addEventListener("change", (ev) => {
      const t = ev.target as HTMLInputElement;
      if (t.id === "rat") { f.at = +t.value; delete err.at; fetchFree(); }
      else if (t.id === "rday" && t.value) { f.day = t.value < d0 ? d0 : t.value > dMax ? dMax : t.value; delete err.day; f.at = slots()[0] ?? null; fetchFree(); }
    });
    sh.el.addEventListener("click", async (ev) => {
      const b = (ev.target as Element).closest<HTMLButtonElement>("button"); if (!b || !sh.el.contains(b)) return;
      if (b.dataset.day) { f.day = b.dataset.day; const sl = slots(); if (f.at == null || !sl.includes(f.at)) f.at = sl[0] ?? null; fetchFree(); return; }
      if (b.dataset.n) { f.n = Math.max(1, Math.min(12, f.n + +b.dataset.n)); fetchFree(); return; }
      if (b.dataset.rt) { f.t = b.dataset.rt; delete err.t; draw('[data-rt="' + f.t + '"]'); return; }
      if (!b.hasAttribute("data-rsave") || saving) return;
      err = {};
      if (f.at == null) err.at = "Избери час.";
      if (!f.t) err.t = "Избери маса.";
      if (!f.name.trim()) err.name = "Напиши името на госта.";
      const ph = f.phone.replace(/[\s\-()]/g, "");
      if (!/^(\+359|0)\d{8,9}$/.test(ph)) err.phone = f.phone.trim() ? "Провери номера: например 0888 12 34 56." : "Напиши телефона на госта.";
      const first = ["at", "t", "name", "phone"].find((k) => err[k]);
      if (first) { draw(({ at: "#rat", t: "[data-rt]", name: "#rname", phone: "#rph" } as Record<string, string>)[first]); return; }
      saving = true; b.setAttribute("aria-busy", "true");
      try {
        const r = await reservationsAdminApi.create({ date: f.day, time: hm(f.at!), people: f.n, table: f.t, name: f.name.trim(), phone: f.phone.trim(), note: f.note.trim() || undefined });
        sh.close();
        S.toast("Резервация: " + (r.tableN ? "Маса " + r.tableN : "без маса") + " · " + dayText(r.date) + " · " + r.time, { undo: async () => {
          try { await reservationsAdminApi.setStatus(r.id, "cancelled"); S.toast("Резервацията е отменена."); } catch (x) { S.toast(why(x)); }
          await loadRes(); render();
        } });
        await loadRes(); render();
      } catch (x) {
        if (x instanceof ApiError && x.status === 403 && x.code !== "blocked") { resNo = true; sh.close(); render(); S.toast("Резервациите са в админ панела."); return; }
        if (x instanceof ApiError && x.code === "blocked") err.phone = x.message;
        else if (x instanceof ApiError && x.code === "taken") { err.t = "Тази маса току-що беше заета. Избери друга."; f.t = null; fetchFree(); }
        else if (x instanceof ApiError && x.fields && Object.keys(x.fields).length) {
          const map: Record<string, string> = { date: "day", time: "at", table: "t", people: "t", name: "name", phone: "phone" };
          for (const k of Object.keys(x.fields)) err[map[k] || "t"] = x.fields[k];
        } else S.toast(why(x));
        draw(err.phone ? "#rph" : err.name ? "#rname" : err.at ? "#rat" : err.day ? "#rday" : null);
      } finally { saving = false; b.removeAttribute("aria-busy"); }
    });
  }

  /* ---------- events ---------- */
  S.main.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button"); if (!b || b.hasAttribute("data-off")) return;
    if (b.dataset.zone) { zone = b.dataset.zone as "salon" | "garden"; render(); return; }
    if (b.hasAttribute("data-newres")) { newRes(); return; }
    if (b.hasAttribute("data-allres")) { allRes = true; render(); return; }
    if (b.dataset.take) { acts.take(b.dataset.take); return; }
    if (b.dataset.done) { acts.done(b.dataset.done); return; }
  });
  store.on(render);
  S.onNet(render);
  /* the connection is back: also send the orders kept on the phone (W2's flushOutbox(st) of src/modules/servitor/bits.ts,
     wired here at the merge) */
  S.onReload(() => { loadRes().then(render); void flushOutbox(S); });
  void flushOutbox(S); /* what waited on this phone from before (the order screen keeps it) */
  S.onLive(["reservation.created", "reservation.status"], () => { loadRes().then(render); });
  /* the late ones move up and "от 55 мин" grows without a load */
  setInterval(() => { if (!document.hidden && !S.stale) render(); }, 15_000);

  await Promise.all([store.load(), loadRes()]);
  render();
  if (/(^#|&)newres\b/.test(location.hash) && !S.stale) newRes();
  else if (/(^#|&)(res|zala)\b/.test(location.hash)) document.getElementById(/res\b/.test(location.hash) ? "res" : "zala")?.scrollIntoView();
}
