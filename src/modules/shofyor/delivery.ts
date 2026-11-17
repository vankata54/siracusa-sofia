/* Шофьор · Доставката (/shofyor/dostavka/#1042; design/pages-shofyor/delivery.html, "#1042&call" opens the call sheet).
   The stages Взета -> На път -> Доставена; the address, the deadline, "около"; "Навигация · Google Maps" (or Waze);
   the customer by name only ("Номерът е скрит", calls and SMS "през ресторанта"); the note; "В торбата"; the payment
   and the change for cash; "Проблем с доставката" (only taken / on the way); the statuses with one tap in the bottom bar,
   each with "Отмени" (the core's window). An order outside the zones: "Взех · след потвърждение" asks the manager
   (driverApi.ask); the answer arrives live. */
import { mountDriver, driverApi, ApiError, ic, esc, fmt, plural, murl, money, addrLine, zoneName, dStt, dueStt, etaStt, isLate, openProb, live, askLine, navUrl, NAVAPP, RT, RT_TEL, PAY, MISS, at, stt, type Delivery } from "./app.ts";
import type { DriverList, ProblemKind } from "../../client/api-driver.ts";

function hashOf(): { no: string; call: boolean } {
  const p = location.hash.slice(1).split("&");
  return { no: p.find((x) => /^\d+$/.test(x)) || "", call: p.includes("call") };
}
const PROB: [ProblemKind, string, string, string][] = [
  ["nobody", "Няма никой", "door-open", "Никой не отваря и не вдига"],
  ["address", "Грешен адрес", "map-pin-line", "Няма такъв адрес или е непълен"],
  ["refused", "Отказ", "x", "Клиентът не приема поръчката"],
];

export async function initDelivery(): Promise<void> {
  const h0 = hashOf();
  const drv0 = await mountDriver({ screen: "delivery", tab: "list", title: h0.no ? "№ " + h0.no : "Доставка", back: { href: murl.shofyor(), label: "Доставки" }, bar: true });
  if (!drv0) return;
  const drv = drv0;
  const { st } = drv, main = st.main, bar = st.bar!;
  /* the frame's sheet (not SC.sheet of the site: tests/unit/runtime.test.ts looks for ".sheet(" calls) */
  const openSheet = st.sheet;
  let no = h0.no, d: Delivery | null = null, L: DriverList | null = null, given = 0, other = "", callOpened = false;
  const M = drv.state.missing;

  function flow(x: Delivery): string {
    const i = x.st === "wait" ? -1 : x.st === "picked" ? 0 : x.st === "road" ? 1 : x.st === "done" ? 2 : x.onWayAt ? 1 : 0;
    return '<ol class="flow" aria-label="Етапи">' + ["Взета", "На път", "Доставена"].map((s, k) => '<li class="' + (k <= i ? "on" : "") + (k === i && x.st === "road" ? " now" : "") + '"' + (k === i ? ' aria-current="step"' : "") + ">" + s + "</li>").join("") + "</ol>";
  }
  const payable = (x: Delivery) => live(x) || openProb(x);
  function changeBox(x: Delivery): string {
    if (!x.feeKnown || x.outzone) return '<div class="notice warn" style="margin-top:12px">' + ic("warning", 22) + "<span><b>Таксата не е въведена: питай ресторанта</b> " + (x.outzone ? "(адрес извън зоните)" : MISS("[ЛИПСВА: такса за " + x.zone + "]")) + ". Попитай колко да вземеш, преди да върнеш ресто.</span></div>";
    const c = Math.round(x.total * 100) / 100, opts: number[] = [];
    [5, 10, 20, 50, 100].forEach((s) => { const v = Math.ceil(c / s) * s; if (v > c && !opts.includes(v)) opts.push(v); });
    return '<div class="notice" style="margin-top:12px;display:block"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:6px"><b>Ресто</b></div><p class="muted" style="margin:4px 0 10px">Клиентът дава:</p><div class="change">' +
      '<button class="chip" type="button" data-give="' + c + '" aria-pressed="' + (given === c) + '">Точна сума</button>' +
      opts.slice(0, 4).map((n) => '<button class="chip" type="button" data-give="' + n + '" aria-pressed="' + (given === n) + '">' + n + " €</button>").join("") +
      '<button class="chip" type="button" data-give="-1" aria-pressed="' + (given === -1) + '">Друга сума</button></div>' +
      (given === -1 ? '<div class="field bigf" style="margin-top:10px"><label for="oth">Колко дава клиентът</label><div class="wrapi"><input class="input" id="oth" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + esc(other) + '"><span class="u">€</span></div></div>' : "") +
      '<div id="chg" aria-live="polite">' + changeOut(c) + "</div></div>";
  }
  function changeOut(c: number): string {
    const g = given === -1 ? parseFloat(String(other).replace(",", ".").replace(/\s/g, "")) : given;
    if (!g) return "";
    if (g < c - 0.004) return '<div class="chg" style="color:var(--danger)">Сумата е по-малка от ' + esc(fmt(c)) + "</div>";
    if (Math.abs(g - c) < 0.005) return '<div class="chg big">Без ресто</div>';
    return '<div class="chg big">Върни ' + esc(fmt(g - c)) + "</div>";
  }

  function render() {
    if (!d) return;
    const x = d, locked = L && L.route.locked && L.route.locked !== x.no ? L.route.locked : null, app = drv.navApp();
    st.setTop({ title: "№ " + x.no, sub: zoneName(x) });
    let h = '<section class="st-sec">' + flow(x) + "</section>";
    if (x.st === "prob" && x.problem) h += '<section class="st-sec"><div class="notice bad">' + ic("warning", 22) + "<span><b>Проблем: " + esc(x.problem.label) + ".</b> Ресторантът е уведомен в " + esc(at(x.problem.at)) + ". " +
      (x.problem.solved === "returned" ? "Върната в ресторанта в " + esc(at(x.problem.solvedAt)) + "." : "Ако клиентът се обади, достави я. Иначе я върни в ресторанта" + (x.pay === "cash" ? "; сумата не се събира" : "") + ".") + "</span></div></section>";
    if (x.st === "cancelled") h += '<section class="st-sec"><div class="notice bad">' + ic("x", 22) + "<span><b>Поръчката е отказана.</b> " + esc(x.reason || "") + "</span></div></section>";
    if (x.outzone && live(x)) h += '<section class="st-sec"><div class="notice bad">' + ic("map-pin-line", 22) + "<span><b>Адресът е извън зоните за доставка.</b> " +
      (x.ask ? esc(askLine(x)) + " " + (x.ask.answer === "return" ? "Не я вземай: остава в ресторанта." : x.ask.answer === "pickup" ? "Не я карай: ресторантът предлага на клиента да я вземе." : x.ask.answer === "deliver" ? "Можеш да я вземеш." : "Отговорът идва тук.") : "Преди да тръгнеш, уточни с ресторанта дали да я караш и каква е сумата.") +
      '<br><a class="pill pill-line" href="' + RT_TEL + '">' + ic("phone", 20) + "Обади се в ресторанта</a></span></div></section>";
    if (isLate(x)) h += '<section class="st-sec"><div class="notice bad">' + ic("timer", 22) + "<span><b>Закъснява " + Math.max(1, Math.ceil((Date.now() - x.due!) / 60000)) + " мин.</b> Обади се на клиента и кажи кога пристигаш. Ресторантът също вижда закъснението.<br>" +
      '<button class="pill pill-line" type="button" data-call>' + ic("phone", 20) + "Обади се на клиента</button></span></div></section>";
    if (x.st === "road" && locked) h += '<section class="st-sec"><div class="notice">' + ic("info", 22) + '<span>Сега караш към <a class="link" href="' + esc(murl.shofyor("dostavka", locked)) + '" style="min-height:0;display:inline">№ ' + esc(locked) + "</a>. Тази е следваща по реда на маршрута.</span></div></section>";
    h += '<section class="st-sec"><div class="acard"><div class="addr"><b>' + esc(addrLine(x)) + "</b></div>" +
      '<div class="meta">' + dueStt(x) + etaStt(x) + (!x.outzone && x.fee !== 0 && x.zone ? stt("picked", "Платена зона", "tag") : "") + "</div>" +
      (x.arrivedAt ? '<div class="arr">' + ic("check-circle", 20) + "Клиентът вижда „Шофьорът е пред входа“ от " + esc(at(x.arrivedAt)) + '</div><p class="small muted" style="margin:4px 2px 0">SMS: ' + MISS(M.sms) + "</p>" : "") +
      (live(x) ? '<div class="acts"><a class="pill pill-ink pill-lg" href="' + esc(navUrl(x, app)) + '" target="_blank" rel="noopener">' + ic("path", 22) + "Навигация · " + NAVAPP[app] + "</a></div>" : "") + "</div></section>";
    h += '<section class="st-sec"><p class="st-cap">Клиент</p><div class="client"><span class="nm"><b>' + esc(x.name) + '</b><span style="font-size:15px">Номерът е скрит</span></span><button class="pill pill-line" type="button" data-call>' + ic("phone", 22) + "Обади се</button></div>" +
      '<p class="muted" style="margin:8px 4px 0">Обаждането и SMS минават през номера на ресторанта. Клиентът не вижда твоя номер, ти не виждаш неговия.</p></section>';
    if (x.note) h += '<section class="st-sec"><p class="st-cap">Бележка от клиента</p><div class="notebox">' + ic("note", 22) + "<span>" + esc(x.note) + "</span></div></section>";
    h += '<section class="st-sec"><div class="st-h"><h2>В торбата</h2><span class="muted">' + plural(x.count, "артикул", "артикула") + '</span></div><div class="icard">' +
      x.lines.map((l) => '<div class="il"><span class="q">' + l.q + '×</span><span class="nm">' + esc(l.name) + (l.mods.length ? '<small class="muted" style="display:block;font-size:14px">' + esc(l.mods.join(", ")) + "</small>" : "") + '</span><span class="price">' + (l.sum != null ? esc(fmt(l.sum)) : "") + "</span></div>").join("") +
      (x.disc > 0 ? '<div class="kv" style="border-top:1px solid var(--line)"><span class="muted">Отстъпка</span><b class="price">-' + esc(fmt(x.disc)) + "</b></div>" : "") +
      '<div class="kv"' + (x.disc > 0 ? "" : ' style="border-top:1px solid var(--line)"') + '><span class="muted">Доставка</span><b>' + (x.outzone ? "уточни с ресторанта" : x.fee === 0 ? "Безплатна" : x.fee === null ? MISS("[ЛИПСВА: такса за " + x.zone + "]") : esc(fmt(x.fee))) + "</b></div>" +
      '<div class="kv tot"><span>Общо</span><span class="price">' + (x.outzone ? esc(fmt(x.total)) + " + ?" : esc(money(x))) + "</span></div></div></section>";
    h += '<section class="st-sec"><div class="st-h"><h2>Плащане</h2></div><div class="paygrid">' + (["cash", "card", "voucher"] as const).map((k) => '<div class="' + (x.pay === k ? "on" : "") + '"' + (x.pay === k ? ' aria-current="true"' : "") + ">" + ic(PAY[k][1], 24) + PAY[k][0] + "</div>").join("") + "</div>";
    if (x.pay === "cash" && payable(x)) h += changeBox(x);
    if (x.pay === "card" && live(x)) h += '<div class="notice" style="margin-top:12px">' + ic("credit-card", 22) + "<span>Вземи терминала за карти. " + MISS(M.terminal) + "</span></div>";
    if (x.pay === "voucher" && live(x)) h += '<div class="notice" style="margin-top:12px">' + ic("ticket", 22) + "<span>Вземи ваучерите за " + esc(money(x)) + ". Предават се в края на смяната.</span></div>";
    if (x.collected && x.st === "done") h += '<div class="notice" style="margin-top:12px">' + ic("check-circle", 22) + "<span>Взе " + esc(fmt(x.collected.sum)) + " · " + esc(x.collected.payLabel) + " в " + esc(at(x.collected.at)) + ".</span></div>";
    h += "</section>";
    if (x.st === "picked" || x.st === "road") h += '<section class="st-sec"><button class="pill pill-line pill-lg pill-block" type="button" data-problem>' + ic("warning", 22) + "Проблем с доставката</button></section>";
    main.innerHTML = h;
    renderBar();
    if (h0.call && !callOpened) { callOpened = true; callSheet(); }
  }
  const moneyWord = (x: Delivery, arrived: boolean) => (x.pay === "cash" ? (arrived ? "взех " : "") + money(x) : x.pay === "card" ? (arrived ? "платено с карта" : "карта") : arrived ? "взех ваучера" : "ваучер");
  function renderBar() {
    const x = d!, ord = L ? [...L.active, ...L.waiting].filter((y) => y.no !== x.no && (y.st === "picked" || y.st === "road" || y.st === "wait")) : [];
    const nx = ord.sort((a, b) => (a.n || 1e6) - (b.n || 1e6))[0];
    const nextLink = nx ? '<a class="pill pill-red" href="' + esc(murl.shofyor("dostavka", nx.no)) + '">Следваща · № ' + esc(nx.no) + ic("caret-right", 22) + "</a>" : '<a class="pill pill-red" href="' + esc(murl.shofyor()) + '">' + ic("check-circle", 22) + "Към доставките</a>";
    const green = (word: string) => '<button class="pill grow" type="button" data-st="done" style="background:var(--ok);color:var(--on-ok)">' + ic("check-circle", 22) + esc(word) + "</button>";
    const a = x.ask;
    if (x.st === "wait" && x.outzone && !(a && a.answer === "deliver")) bar.innerHTML = a && a.answer ? nextLink : '<button class="pill pill-red" type="button" data-confirm>' + ic("shopping-bag", 22) + "Взех · след потвърждение</button>";
    else if (x.st === "wait") bar.innerHTML = '<button class="pill pill-red" type="button" data-st="picked">' + ic("shopping-bag", 22) + "Взех от ресторанта</button>";
    else if ((x.st === "picked" || x.st === "road") && a && (a.answer === "return" || a.answer === "pickup")) bar.innerHTML = '<button class="pill pill-red" type="button" data-ret>' + ic("storefront", 22) + "Върнах я в ресторанта</button>";
    else if (x.st === "picked") bar.innerHTML = '<button class="pill pill-red" type="button" data-st="road">' + ic("car", 22) + "Тръгвам · На път</button>";
    else if (x.st === "road") bar.innerHTML = (x.arrivedAt ? "" : '<button class="pill pill-line" type="button" data-arr>' + ic("map-pin", 22) + "Пристигнах</button>") + green("Доставена · " + moneyWord(x, !!x.arrivedAt));
    else if (openProb(x)) bar.innerHTML = '<button class="pill pill-line" type="button" data-ret aria-label="Върнах поръчката в ресторанта">' + ic("storefront", 22) + "Върнах я</button>" + green("Доставих все пак · " + moneyWord(x, false));
    else bar.innerHTML = nextLink;
    /* two buttons with a sum: the words need the room more than the icons (390 px would cut "28,91 €") */
    bar.classList.toggle("two", !!bar.querySelector('[data-st="done"]') && bar.children.length > 1);
  }

  /* ----- sheets ----- */
  function callSheet() {
    const s = openSheet({ title: "Обаждане до клиента",
      html: '<div class="callbig"><span>' + esc(d!.name) + "</span><b>Скрит номер</b><span>Обаждането минава през номера на ресторанта " + esc(RT) + "</span></div>" +
        '<p class="small muted" style="margin:6px 0 0;text-align:center">' + MISS(M.calls) + "</p>" +
        '<p class="st-cap" style="margin-top:14px">Бързо SMS до клиента</p><div class="notechips">' + ["Пристигам след 5 минути", "Пред входа съм", "Не намирам входа"].map((t) => '<button class="chip" type="button" data-sms="' + esc(t) + '">' + ic("chat-circle-dots", 18) + esc(t) + "</button>").join("") + "</div>" +
        '<p class="small muted" style="margin:10px 0 0">SMS тръгва от номера на ресторанта, не от твоя телефон. ' + MISS(M.sms) + "</p>",
      foot: '<a class="pill pill-red pill-lg pill-block" href="' + RT_TEL + '">' + ic("phone", 22) + "Обади се в ресторанта</a>" });
    s.el.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-sms]"); if (!b) return;
      s.close(); st.toast("SMS още не тръгва: няма доставчик. Обади се в ресторанта и те ще предадат „" + b.dataset.sms + "“.");
    });
  }
  function confirmSheet() {
    const s = openSheet({ title: "Ресторантът потвърди ли?",
      html: '<p style="margin:0">Адресът е извън зоните. Вземи поръчката само ако ресторантът е казал да я караш и колко да вземеш.</p><p class="muted" style="margin:10px 0 0">Управителят отговаря тук: „Върни я в ресторанта“, „Предложи вземане от място“ или „Да я достави“.</p>',
      foot: '<button class="pill pill-red pill-lg pill-block" type="button" data-askmgr>' + ic("chat-circle-dots", 22) + "Питай управителя</button><a class=\"pill pill-line pill-lg pill-block\" href=\"" + RT_TEL + '">' + ic("phone", 22) + "Обади се в ресторанта</a>" });
    s.el.querySelector<HTMLButtonElement>("[data-askmgr]")!.onclick = async (e) => {
      const b = e.currentTarget as HTMLButtonElement; b.disabled = true;
      try { await driverApi.ask(d!.no, undefined); s.close(); st.toast("Попита управителя за № " + d!.no + ". Отговорът идва тук."); await load(); }
      catch (er) { b.disabled = false; drv.oops(er); }
    };
  }
  function problemSheet() {
    let pick: ProblemKind | null = null;
    const s = openSheet({ title: "Какво се случи?",
      html: '<div class="ptiles">' + PROB.map((p) => '<button class="ptile" type="button" data-p="' + p[0] + '" aria-pressed="false"><span class="ii">' + ic(p[2], 24) + "</span><span>" + p[1] + "<small>" + p[3] + "</small></span></button>").join("") + '</div><div id="pmore"></div>',
      foot: '<button class="pill pill-red pill-lg pill-block" type="button" data-psend disabled>Изпрати на ресторанта</button>' });
    const more = s.el.querySelector<HTMLElement>("#pmore")!, send = s.el.querySelector<HTMLButtonElement>("[data-psend]")!;
    const TIP: Record<ProblemKind, string> = {
      nobody: '<div class="notice" style="margin-top:12px">' + ic("phone", 22) + "<span>Първо се обади на клиента. Ако не вдига, изчакай и изпрати. " + MISS(M.wait) + '</span></div><button class="pill pill-line pill-block" type="button" data-callnow style="margin-top:10px">' + ic("phone", 20) + "Обади се на клиента</button>",
      address: '<div class="field" style="margin-top:12px"><label for="na">Верният адрес, ако клиентът го каже</label><input class="input" id="na" autocomplete="off" placeholder="например бл. 311, вх. В"></div>',
      refused: '<div class="field" style="margin-top:12px"><label for="nr">Причина (по желание)</label><input class="input" id="nr" autocomplete="off" placeholder="например студена храна"></div><p class="muted" style="margin:8px 0 0">Не спори с клиента. Върни поръчката в ресторанта.</p>',
    };
    s.el.addEventListener("click", async (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b) return;
      if (b.dataset.p) {
        pick = b.dataset.p as ProblemKind;
        s.el.querySelectorAll("[data-p]").forEach((y) => y.setAttribute("aria-pressed", String(y === b)));
        more.innerHTML = TIP[pick]; send.disabled = false; send.textContent = "Изпрати: " + PROB.find((p) => p[0] === pick)![1];
        return;
      }
      if (b.hasAttribute("data-callnow")) { s.close(); callSheet(); return; }
      if (b.hasAttribute("data-psend") && pick) {
        const inp = more.querySelector<HTMLInputElement>("input"), k = pick;
        send.disabled = true;
        try {
          const r = await drv.act({ k: "problem", no: d!.no, kind: k, note: inp ? inp.value : undefined });
          s.close(); st.haptic([30, 60, 30]);
          drv.stepToast("Ресторантът е уведомен: " + PROB.find((p) => p[0] === k)![1] + ".", r, load);
          await after(r.queued);
        } catch (er) { send.disabled = false; drv.oops(er); }
      }
    });
  }

  /* ----- data ----- */
  async function load() {
    if (!no) { main.innerHTML = '<section class="st-sec">' + st.empty({ icon: "magnifying-glass", title: "Няма такава доставка", action: '<a class="pill pill-line pill-lg" href="' + esc(murl.shofyor()) + '">Към доставките</a>' }) + "</section>"; bar.innerHTML = ""; return; }
    try {
      const [one, all] = await Promise.all([drv.cached("d-" + no, () => driverApi.get(no)), drv.cached("list", () => driverApi.list())]);
      d = drv.local([one])[0]; L = all; st.synced(); render();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) { main.innerHTML = '<section class="st-sec">' + st.empty({ icon: "magnifying-glass", title: "Няма такава доставка", text: "№ " + no + " не е твоя или вече я няма.", action: '<a class="pill pill-line pill-lg" href="' + esc(murl.shofyor()) + '">Към доставките</a>' }) + "</section>"; bar.innerHTML = ""; return; }
      st.fail(e);
    }
  }
  /** after a step: the screen from the server (or as the kept step leaves it) */
  async function after(queued?: unknown) { if (queued) { d = drv.local([d!])[0]; render(); } else await load(); }
  drv.onChange(load);
  window.addEventListener("hashchange", () => { const h = hashOf(); if (h.no && h.no !== no) { no = h.no; given = 0; other = ""; d = null; st.loading(); window.scrollTo({ top: 0 }); void load(); } });

  main.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "oth" && d) { other = t.value; main.querySelector("#chg")!.innerHTML = changeOut(Math.round(d.total * 100) / 100); }
  });
  main.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b || !d) return;
    if (b.hasAttribute("data-call")) { callSheet(); return; }
    if (b.hasAttribute("data-problem")) { problemSheet(); return; }
    if (b.dataset.give) { const v = +b.dataset.give; given = v === given ? 0 : v; render(); if (given === -1) main.querySelector<HTMLInputElement>("#oth")?.focus(); }
  });
  let busy = false;
  bar.addEventListener("click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b || busy || !d) return;
    if (b.hasAttribute("data-confirm")) { confirmSheet(); return; }
    const x = d; busy = true; b.disabled = true;
    try {
      if (b.hasAttribute("data-arr")) {
        const r = await drv.act({ k: "arrive", no: x.no }); st.haptic();
        drv.stepToast("Клиентът вижда „Шофьорът е пред входа“. SMS: " + M.sms + ".", r, load); await after(r.queued);
      } else if (b.hasAttribute("data-ret")) {
        const r = await drv.act({ k: "returned", no: x.no }); st.haptic();
        drv.stepToast("№ " + x.no + " е върната в ресторанта.", r, load); await after(r.queued);
      } else if (b.dataset.st) {
        const s2 = b.dataset.st, r = await drv.act(s2 === "picked" ? { k: "take", nos: [x.no] } : s2 === "road" ? { k: "go", nos: [x.no] } : { k: "deliver", no: x.no });
        st.haptic(s2 === "done" ? [20, 40, 20] : 12);
        drv.stepToast("№ " + x.no + " " + (s2 === "picked" ? "е взета от ресторанта" : s2 === "road" ? "е на път. Клиентът вижда приблизително време" : "е доставена") + ".", r, load);
        window.scrollTo({ top: 0 }); await after(r.queued);
      }
    } catch (er) { drv.oops(er); await load(); }
    finally { busy = false; b.disabled = false; }
  });
  await load();
}
