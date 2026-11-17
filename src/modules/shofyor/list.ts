/* Шофьор · Моите доставки (/shofyor/; design/pages-shofyor/list.html). On top the three numbers in one row of 56 px;
   "Следваща" (the one he drives to, else the first of the route, else the first ready one); "След това" in the route's
   order (then the ready ones nobody took); "Доставени днес". The main button in the thumb zone changes: "Взех N
   поръчки" -> "Тръгвам · N на път" -> "Пристигнах" -> "Отвори № 1042", with "Навигация" next to it. */
import { mountDriver, driverApi, ic, esc, fmt, plural, murl, money, payWord, dStt, dueStt, etaStt, addrLine, isLate, openProb, pickable, askLine, navUrl, NAVAPP, RT_TEL, PAY, type Delivery, type Drv } from "./app.ts";
import type { DriverList } from "../../client/api-driver.ts";

export async function initList(): Promise<void> {
  const drv0 = await mountDriver({ screen: "list", tab: "list", title: "Моите доставки", bar: true, homeFind: true });
  if (!drv0) return;
  const drv = drv0;
  const { st } = drv, main = st.main, bar = st.bar!;
  let data: DriverList | null = null;

  const href = (d: Delivery, call = false) => murl.shofyor("dostavka", d.no + (call ? "&call" : ""));
  function nextCard(d: Delivery): string {
    const late = isLate(d);
    return '<div class="next' + (late ? " late" : "") + '"><div class="hd"><span class="n1">1</span><span>№ ' + esc(d.no) + "</span>" + dStt(d) + '</div><div class="in">' +
      '<a href="' + esc(href(d)) + '" style="color:inherit;text-decoration:none;display:block"><div class="addr"><b>' + esc(addrLine(d)) + "</b>" + (d.note ? "<span>" + esc(d.note) + "</span>" : "") + "</div></a>" +
      '<div class="meta">' + (d.outzone ? st.stt("out", "Извън зоните", "warning") : "") + dueStt(d) + etaStt(d) + "</div>" +
      (d.outzone && d.st !== "done" ? '<div class="notice bad" style="margin-top:12px">' + ic("map-pin-line", 22) + "<span><b>Адрес извън зоните: уточни с ресторанта.</b> " + esc(askLine(d)) + '<br><a class="pill pill-line" href="' + RT_TEL + '">' + ic("phone", 20) + "Обади се в ресторанта</a></span></div>" : "") +
      '<div class="money' + (d.pay === "cash" ? " cash" : "") + '"><span class="w">' + ic(PAY[d.pay][1], 22) + "<span>" + (d.pay === "cash" ? "Вземи в брой" : esc(PAY[d.pay][0])) + '</span></span><span class="price">' + esc(money(d)) + "</span></div>" +
      (pickable(d) ? '<p class="muted" style="margin:10px 2px 0">Провери бройките в торбите, преди да натиснеш „Взех“.</p>' : "") +
      (d.arrivedAt ? '<div class="arr">' + ic("check-circle", 20) + "Клиентът вижда „Шофьорът е пред входа“ от " + esc(at(d.arrivedAt)) + '</div><p class="small muted" style="margin:4px 2px 0">SMS: <span class="missing">' + esc(drv.state.missing.sms) + "</span></p>" : "") +
      '<div class="acts"><a class="pill pill-line" href="' + esc(href(d, true)) + '">' + ic("phone", 22) + 'Обади се</a><a class="pill pill-soft" href="' + esc(href(d)) + '">Отвори' + ic("caret-right", 20) + "</a></div></div></div>";
  }
  function row(d: Delivery, n: number): string {
    const fin = d.st === "done" || d.st === "cancelled" || (d.st === "prob" && !openProb(d));
    const cls = d.st === "done" ? "done" : d.st === "prob" || d.st === "cancelled" ? "prob" : isLate(d) ? "late" : "";
    const no = d.st === "done" ? ic("check", 22) : d.st === "prob" || d.st === "cancelled" ? ic("warning", 22) : n ? String(n) : ic("storefront", 22);
    return '<a class="drow2 ' + cls + '" href="' + esc(href(d)) + '">' +
      '<span class="no">' + no + '</span><span><span class="a">' + esc(addrLine(d)) + '</span><span class="s">№ ' + esc(d.no) + (d.etaAt && !fin ? " · пристигане около " + esc(d.etaAt) : "") + "</span>" +
      '<span class="ln"><span class="price">' + esc(fin && d.collected ? fmt(d.collected.sum) : money(d)) + "</span>" + payWord(d) + "</span>" +
      '<span class="ln">' + (d.outzone && !fin ? st.stt("out", "Извън зоните", "warning") : "") + (d.st === "wait" || d.st === "road" || openProb(d) ? dStt(d) : "") + (openProb(d) ? "" : dueStt(d)) + "</span></span></a>";
  }
  const at = (i: string | null) => (i ? st.clock(Date.parse(i)) : "");

  function render() {
    if (!data) return;
    const L = data, mine = drv.local(L.active.slice()), waiting = drv.local(L.waiting.slice()), done = L.done.slice();
    /* a kept step moves a ready one into "mine" and a delivered one out of the route */
    const route = [...mine, ...waiting.filter((d) => d.st !== "wait")].filter((d) => d.st === "picked" || d.st === "road").sort((a, b) => (a.n || 1e6) - (b.n || 1e6));
    const probs = mine.filter(openProb), waitL = waiting.filter((d) => d.st === "wait");
    const finished = [...mine.filter((d) => d.st === "done" || (d.st === "prob" && !openProb(d))), ...done];
    const act = [...route, ...waitL];
    const cash = act.filter((d) => d.pay === "cash" && !d.outzone).reduce((s, d) => s + d.total, 0);
    const noFee = act.some((d) => d.pay === "cash" && (!d.feeKnown || d.outzone));
    const doneN = finished.filter((d) => d.st === "done").length;
    drv.badge(route.length + waitL.length);
    drv.setExamples(act.map((d) => d.no));
    const lockedNo = L.route.locked;
    const nx = route.find((d) => d.no === lockedNo) || route.find((d) => d.st === "road") || route[0] || waitL[0] || probs[0] || null;
    let h = '<section class="st-sec" style="padding-top:12px"><div class="dsum one"><a href="#sled"><b>' + act.length + "</b><span>" + (act.length === 1 ? "адрес" : "адреса") + "</span></a><div><b>" + esc(fmt(cash)) + '</b><span>в брой</span></div><a href="#dneshni"><b>' + doneN + "</b><span>доставени</span></a></div>" +
      (noFee ? '<p class="small muted" style="margin:6px 18px 0">Сумата в брой е без таксите за платените зони.</p>' : "") + "</section>";
    if (!nx) {
      h += '<section class="st-sec">' + st.empty({ icon: "check-circle", title: "Няма доставки за теб", text: "Когато кухнята приготви поръчка, телефонът ще вибрира и тя ще се появи тук.",
        action: '<a class="pill pill-line pill-lg" href="' + esc(murl.shofyor("smyana")) + '" style="margin-top:8px">' + ic("wallet", 22) + "Виж смяната и парите</a>" }) + "</section>";
    } else {
      const pick = L.route.pick;
      h += '<section class="st-sec"><div class="st-h"><h2>Следваща</h2>' + (route.length ? '<a class="link" href="' + esc(murl.shofyor("marshrut")) + '" style="font-size:15px">' + ic("path", 18) + (pick === "own" ? "Моят ред" : "Път " + (pick === "B" ? "Б" : "А")) + " · смени</a>" : "") + "</div>" + nextCard(nx) + "</section>";
      const rest = [...route, ...probs, ...waitL].filter((d) => d !== nx);
      if (rest.length) h += '<section class="st-sec" id="sled"><div class="st-h"><h2>След това</h2><span class="muted">по реда на маршрута</span></div><div class="dl">' + rest.map((d) => row(d, route.indexOf(d) + 1)).join("") + "</div></section>";
    }
    if (finished.length) h += '<section class="st-sec donel" id="dneshni"><div class="st-h"><h2>Доставени днес</h2><span class="muted">' + plural(finished.length, "адрес", "адреса") + '</span></div><div class="dl">' + finished.map((d) => row(d, 0)).join("") + "</div></section>";
    main.innerHTML = h;
    renderBar(nx, route, waitL);
  }
  function renderBar(nx: Delivery | null, route: Delivery[], waitL: Delivery[]) {
    if (!nx) { bar.innerHTML = ""; st.app.classList.remove("withbar"); return; }
    st.app.classList.add("withbar");
    const app = drv.navApp();
    const navb = '<a class="pill pill-ink" href="' + esc(navUrl(nx, app)) + '" target="_blank" rel="noopener" aria-label="Навигация до № ' + esc(nx.no) + " в " + NAVAPP[app] + '">' + ic("path", 22) + "Навигация</a>";
    const road = route.filter((d) => d.st === "road"), picked = route.filter((d) => d.st === "picked"), canTake = waitL.filter(pickable);
    if (!road.length && canTake.length) bar.innerHTML = '<button class="pill pill-red" type="button" data-pickall>' + ic("shopping-bag", 22) + "Взех " + plural(canTake.length, "поръчка", "поръчки") + "</button>";
    else if (picked.length && !road.length) bar.innerHTML = navb + '<button class="pill pill-red" type="button" data-goall>' + ic("car", 22) + "Тръгвам" + (picked.length > 1 ? " · " + picked.length + " на път" : "") + "</button>";
    else if (nx.st === "road" && !nx.arrivedAt) bar.innerHTML = navb + '<button class="pill pill-red" type="button" data-arr="' + esc(nx.no) + '">' + ic("map-pin", 22) + "Пристигнах</button>";
    else bar.innerHTML = navb + '<a class="pill pill-red" href="' + esc(href(nx)) + '">Отвори № ' + esc(nx.no) + ic("caret-right", 22) + "</a>";
  }

  async function load() {
    try { data = await drv.cached("list", () => driverApi.list()); st.synced(); render(); }
    catch (e) { st.fail(e); }
  }
  drv.onChange(load);

  let busy = false;
  bar.addEventListener("click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b || busy || !data) return;
    busy = true; b.disabled = true;
    try {
      if (b.hasAttribute("data-pickall")) {
        const nos = drv.local(data.waiting.slice()).filter(pickable).map((d) => d.no);
        const r = await drv.act({ k: "take", nos });
        st.haptic();
        drv.stepToast(plural(nos.length, "поръчка е взета", "поръчки са взети") + ". Натисни „Тръгвам“, когато потеглиш.", r, load);
      } else if (b.hasAttribute("data-goall")) {
        const r = await drv.act({ k: "go" });
        st.haptic(); window.scrollTo({ top: 0 });
        const res = r.res as { deliveries: Delivery[]; skipped: { no: string; why: string }[] } | undefined;
        const n = res ? res.deliveries.length : 0;
        drv.stepToast((res ? (n > 1 ? plural(n, "поръчка е", "поръчки са") + " на път" : "№ " + res.deliveries[0].no + " е на път") : "Поръчките са на път") + ". Клиентите виждат приблизително време." + (res && res.skipped.length ? " " + res.skipped.map((x) => x.why).join(" ") : ""), r, load);
      } else if (b.dataset.arr) {
        const r = await drv.act({ k: "arrive", no: b.dataset.arr });
        st.haptic();
        drv.stepToast("Клиентът вижда „Шофьорът е пред входа“. SMS: " + drv.state.missing.sms + ".", r, load);
      }
    } catch (er) { drv.oops(er); }
    finally { busy = false; b.disabled = false; }
    await load();
  });
  await load();
}
export type { Drv };
