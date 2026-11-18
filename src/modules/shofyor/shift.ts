/* Шофьор · Край на смяната (/shofyor/smyana/; design/pages-shofyor/shift.html). Delivered, with a problem, fuel; "Пари в
   брой за предаване" by order + the start change - fuel paid in cash (the core's formula); cards and vouchers; km per car
   and in all; "Предадох … на [ЛИПСВА]"; the warning and the stopped button while an order is not finished; "Смяната
   приключи", then the sign-out. "Смених колата" opens the car sheet (end km of car 1, start km of car 2). */
import { mountDriver, driverApi, ApiError, ic, esc, fmt, plural, murl, MISS, kmText } from "./app.ts";
import { http, pick, demoTok, setDemoTok } from "../../client/api.ts";
import type { ShiftSummary } from "../../client/api-driver.ts";

/** the sign-out (the same call as staffApi.logout; kept here so the page does not load the admin's client) */
const signOut = pick(async (c) => { const t = demoTok("staff"); if (t) await c.staff.logout(t); setDemoTok("staff", null); return { ok: true }; }, () => http<{ ok: boolean }>("POST", "auth/logout"));
const whole = (v: string) => parseInt(String(v || "").replace(/\s/g, ""), 10);

export async function initShift(): Promise<void> {
  const drv0 = await mountDriver({ screen: "shift", tab: "shift", title: "Край на смяната", bar: true });
  if (!drv0) return;
  const drv = drv0;
  const { st } = drv, main = st.main, bar = st.bar!;
  let S: ShiftSummary | null = null, kmEnd = "", handed = false, errs: Record<string, string> = {}, ended: ShiftSummary | null = null, busy = false;

  /* drawn again keeping the focus on the same control (or on the main button of the bar) */
  const render = () => drv.paint(draw);
  function draw() {
    if (ended) {
      const e = ended;
      bar.innerHTML = ""; st.app.classList.remove("withbar");
      main.innerHTML = '<section class="st-sec">' + st.empty({ icon: "check-circle", title: "Смяната приключи",
        text: (e.owe ? "Ресторантът ти дължи " + fmt(-e.handover) + "." : "Предаде " + fmt(e.handover) + " в брой.") + (e.km.total != null ? " Изминати: " + kmText(e.km.total) + " км." : "") + " Благодарим и приятна вечер!",
        action: '<a class="pill pill-red pill-lg" href="' + esc(murl.shofyor("vhod")) + '" style="margin-top:8px">' + ic("sign-out", 22) + "Към входа</a>" }) + "</section>";
      main.querySelector<HTMLElement>("h2")?.setAttribute("tabindex", "-1");
      return;
    }
    if (!S) return;
    const s = S, sh = s.shift!, un = s.unfinished, open = un.filter((d) => d.st !== "prob"), probOpen = un.filter((d) => d.st === "prob");
    const cars = [...new Set([...sh.legs.map((l) => l.n), sh.car.n])];
    let h = '<section class="st-sec"><p class="lead" style="color:var(--ink)">На смяна от ' + esc(sh.sinceAt) + " с " + esc(cars.join(" и ")) + ". Провери сумите и предай парите.</p></section>";
    if (open.length) h += '<section class="st-sec"><div class="notice warn" data-unfinished>' + ic("warning", 22) + "<span><b>" + plural(open.length, "поръчка не е доставена", "поръчки не са доставени") + " (" + esc(open.map((d) => "№\u00a0" + d.no).join(", ")) + ").</b> Достави ги или ги върни в ресторанта, преди да приключиш.<br>" +
      '<a class="pill pill-line" href="' + esc(murl.shofyor()) + '" style="margin-top:10px">Към доставките' + ic("caret-right", 20) + "</a></span></div></section>";
    probOpen.forEach((d) => { h += '<section class="st-sec"><div class="notice warn">' + ic("warning", 22) + "<span><b>№ " + esc(d.no) + " · Проблем: " + esc(d.problem ? d.problem.label : "") + ".</b> Върни я в ресторанта или я достави, преди да приключиш.<br>" +
      '<a class="pill pill-line" href="' + esc(murl.shofyor("dostavka", d.no)) + '" style="margin-top:10px">Отвори № ' + esc(d.no) + ic("caret-right", 20) + "</a></span></div></section>"; });
    h += '<section class="st-sec"><div class="dsum"><div><b>' + s.delivered + "</b><span>" + (s.delivered === 1 ? "доставена" : "доставени") + "</span></div><div><b>" + s.problems + "</b><span>с проблем</span></div><div><b>" + s.fuel + "</b><span>" + (s.fuel === 1 ? "зареждане" : "зареждания") + "</span></div></div></section>";
    const owe = s.owe, hand = s.handover;
    h += '<section class="st-sec"><div class="cashbox"><div class="hd">' + ic("money", 22) + (owe ? "Сметка на парите в брой" : "Пари в брой за предаване") + '</div><div class="in">' +
      (owe ? '<div class="owe"><span>Ресторантът ти дължи</span><b>' + esc(fmt(-hand)) + "</b></div>" : '<div class="big">' + esc(fmt(hand)) + "</div>") +
      (s.cash.feeMissing ? '<p class="small muted" style="margin:6px 0 0">Без таксите за платените зони ' + MISS("[ЛИПСВА: такси]") + ".</p>" : "") +
      '<div class="kvs" style="margin-top:10px">' + (s.cash.rows.length ? s.cash.rows.map((r) => '<div class="kv"><span>№ ' + esc(r.no) + " · " + esc(r.zone || "извън зоните") + '</span><b class="price">' + esc(fmt(r.sum)) + "</b></div>").join("") : '<div class="kv"><span class="muted">Няма плащания в брой</span></div>') +
      '<div class="kv"><span style="white-space:nowrap">+ Начално ресто</span><b class="price">' + (s.float == null ? "не е въведено" : esc(fmt(s.float))) + "</b></div>" +
      '<div class="kv"><span>- Гориво, платено в брой</span><b class="price">' + esc(fmt(s.fuelCash)) + "</b></div>" +
      '<div class="kv tot" style="font-size:20px;font-weight:800"><span>' + (owe ? "Дължи ти" : "За предаване") + '</span><b class="price">' + esc(fmt(Math.abs(hand))) + "</b></div></div>" +
      (s.float == null ? '<p class="small muted" style="margin:6px 0 0">Рестото се въвежда при вход. Колко ресто се дава: ' + MISS(drv.state.missing.float) + ".</p>" : "") + "</div></div></section>";
    h += '<section class="st-sec"><div class="icard" style="padding-top:8px"><div class="kv"><span>Карта при получаване · ' + s.cards.n + '</span><b class="price">' + esc(fmt(s.cards.sum)) + "</b></div><div class=\"kv\"><span>Ваучери за предаване · " + s.vouchers.n + '</span><b class="price">' + esc(fmt(s.vouchers.sum)) + "</b></div></div>" +
      '<p class="small muted" style="margin:8px 4px 0">Плащанията с карта минават през терминала; ваучерите се предават с парите.</p></section>';
    const done = s.km.legs.filter((l) => l.km != null), prevKm = done.reduce((a, l) => a + (l.km || 0), 0), ke = whole(kmEnd);
    const diff = ke > sh.kmStart ? ke - sh.kmStart + prevKm : null;
    h += '<section class="st-sec"><div class="st-h"><h2>Километри</h2><span class="muted">' + esc(sh.car.n) + "</span></div>" +
      (done.length ? '<div class="icard" style="margin-bottom:12px;padding-top:6px">' + done.map((l) => '<div class="kv"><span>' + esc(l.n) + " · " + kmText(l.kmStart) + " → " + kmText(l.kmEnd!) + "</span><b>" + kmText(l.km!) + " км</b></div>").join("") + "</div>" : "") +
      '<div class="fgrid"><div class="field"><label for="ks">В началото</label><input class="input tnum" id="ks" readonly value="' + kmText(sh.kmStart) + '" style="min-height:64px;font-size:22px;font-weight:800;background:var(--surface-2);box-shadow:none"></div>' +
      '<div class="field bigf"><label for="ke">Сега</label><div class="wrapi"><input class="input" id="ke" inputmode="numeric" autocomplete="off" placeholder="0" value="' + esc(kmEnd) + '"' + (errs.km ? ' aria-invalid="true" aria-describedby="eke"' : "") + ' style="font-size:22px;padding-right:56px"><span class="u">км</span></div></div>' +
      (errs.km ? '<span class="err full" id="eke" style="color:var(--danger);font-weight:600;font-size:16px">' + esc(errs.km) + "</span>" : "") + "</div>" +
      '<button class="pill pill-soft pill-block" type="button" data-car style="margin-top:12px">' + ic("car", 20) + "Смених колата</button>" +
      '<div class="calc" style="margin-top:12px"><span>Изминати за смяната</span><b id="diff">' + (diff !== null ? kmText(diff) + " км" : "-") + "</b></div></section>";
    h += '<section class="st-sec"><label class="chk"><input type="checkbox" id="hd"' + (handed ? " checked" : "") + (errs.handed ? ' aria-invalid="true" aria-describedby="ehd"' : "") + "><span>" + (owe ? "Получих " + esc(fmt(-hand)) + (s.vouchers.n ? " и предадох ваучерите на" : " от") : "Предадох " + esc(fmt(hand)) + (s.vouchers.n ? " и ваучерите на" : " на")) + " " + MISS(s.handTo) + "</span></label>" +
      (errs.handed ? '<p class="err" id="ehd" style="margin:0 4px;color:var(--danger);font-weight:600;font-size:16px">' + esc(errs.handed) + "</p>" : "") + "</section>";
    main.innerHTML = h;
    bar.innerHTML = '<button class="pill pill-red" type="button" data-end' + (un.length ? ' disabled aria-describedby="end-why"' : "") + ">" + ic("sign-out", 22) + "Приключи смяната</button>" + (un.length ? '<span class="vh" id="end-why">Първо достави или върни недоставените поръчки.</span>' : "");
  }
  async function load() {
    if (ended) return;
    try { S = await drv.cached("shift", () => driverApi.shift()); st.synced(); render(); }
    catch (e) { if (e instanceof ApiError && e.code === "no_shift") { location.replace(murl.shofyor("vhod")); return; } st.fail(e); }
  }
  drv.onChange(() => { if (!(document.activeElement instanceof HTMLInputElement)) void load(); });

  main.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement; if (t.id !== "ke" || !S) return;
    kmEnd = t.value; const ke = whole(kmEnd), sh = S.shift!, pk = S.km.legs.filter((l) => l.km != null).reduce((a, l) => a + (l.km || 0), 0);
    main.querySelector("#diff")!.textContent = ke > sh.kmStart ? kmText(ke - sh.kmStart + pk) + " км" : "-";
  });
  main.addEventListener("change", (e) => { const t = e.target as HTMLInputElement; if (t.id === "hd") handed = t.checked; });
  main.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-car]")) void drv.carSheet(() => { kmEnd = ""; void load(); }); });
  bar.addEventListener("click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("[data-end]"); if (!b || busy || b.disabled) return;
    if (st.offline) { st.toast("Няма връзка. Смяната се приключва, щом връзката се върне."); return; }
    busy = true; b.disabled = true; errs = {};
    try {
      ended = await driverApi.end({ km: kmEnd, handed });
      try { const u = drv.state.user.username; Object.keys(localStorage).filter((k) => k === "dr-outbox:" + u || k.startsWith("dr-cache-" + u + "-")).forEach((k) => localStorage.removeItem(k)); } catch { /* blocked */ }
      /* the session goes with the shift: "Смяната приключи" is on the sign-in (no pencil, no bars, only "Към входа") */
      await signOut().catch(() => { /* the next sign-in replaces the session */ });
      const e = ended;
      location.replace(murl.shofyor("vhod", "done&h=" + e.handover.toFixed(2) + (e.owe ? "&owe=1" : "") + (e.km.total != null ? "&km=" + e.km.total : "")));
      return;
    } catch (er) {
      if (er instanceof ApiError && er.fields && (er.fields.km || er.fields.handed)) { errs = er.fields; render(); main.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }
      else { drv.oops(er); await load(); }
    } finally { busy = false; if (!ended) { const nb = bar.querySelector<HTMLButtonElement>("[data-end]"); if (nb && S && !S.unfinished.length) nb.disabled = false; } }
  });
  await load();
}
