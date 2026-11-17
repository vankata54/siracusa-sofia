/* Кухня · Натоварено (/kuhnya/natovareno/): port of design/pages-kuhnya/busy.html over the core (kitchenApi.busy / setBusy:
   the one setting the site, the admin and the manager read; decision 04.11: only this manual switch).
   - The switch "+20 мин" for the whole kitchen (the minutes from the core), who switched it (the section, "Главен готвач
     (Общ изглед)", or the role of a boss) and since when; the reminder after 60 min (OPEN-QUESTIONS 34, the core's flag).
   - "Беше / Сега": only the deadline in the kitchen per channel (the core's norms): маса, вземане with the earliest hour,
     доставка; what the customer sees for delivery (the core's texts, "около 35 мин" -> "Възможни са закъснения · около
     55 мин"); the time by quarter (the core's zone, "Дружба 2: около 25 → 45 мин"); accepted orders keep their deadline.
   - "Днес": the day's log from the core.
   - Real time: "kitchen.busy" from any tablet, the admin or the manager redraws the screen. */
import { mountKitchen, ic, esc, type KFrame } from "./frame.ts";
import { kitchenApi, ApiError, type KBusyView } from "../../client/api-kitchen.ts";
import { live, whoText } from "./live.ts";

export async function initNatovareno(): Promise<void> {
  const k = await mountKitchen({ page: "natovareno", title: "Натоварено" });
  if (!k) return;
  screen(k);
}

function screen(k: KFrame): void {
  const main = k.main, cfg = k.cfg;
  let b: KBusyView | null = null;
  const NORMS = "[ЛИПСВА: норми за време]";

  k.strip(() => {
    if (!b) return { counts: "" };
    return {
      counts: b.on ? "<span>Натоварено <b>+" + b.extra + " мин</b> от <b>" + esc(b.atHm) + "</b></span>" : "<span>Обичаен режим</span>",
      pills: k.all ? k.pills.back("obsht-izgled", "Към общия изглед") : k.pills.back("queue", "Към опашката"),
    };
  });

  /** "най-рано в 20:22": now + the deadline of a pickup (it moves with the clock) */
  const earliest = (now: number) => k.hm(now + (b!.norm.pickup + (b!.on ? b!.extra : 0)) * 60_000);
  function row(t: string, sub: string, base: number): string {
    const on = b!.on, add = on ? b!.extra : 0;
    return '<tr class="' + (on ? "on" : "") + '"><td>' + t + "<small>" + sub + '</small></td><td class="was">' + (on ? base + " мин" : "") + '</td><td class="now">' + (base + add) + " мин" + (on ? '<span class="plus15">+' + add + "</span>" : "") + "</td></tr>";
  }
  function render(): void {
    if (!b) return;
    const on = b.on, x = b.extra, focus = document.activeElement instanceof HTMLElement && main.contains(document.activeElement) && document.activeElement.hasAttribute("data-tg");
    const remind = b.remindAfterMin;
    main.innerHTML = '<div class="kpage"><div class="bz">' +
      '<section class="sw kcard' + (on ? " on" : "") + '" aria-labelledby="h1"><h1 class="kh1" id="h1">' + ic("hourglass", 30) + "Натоварено: +" + x + " мин</h1>" +
        '<div class="state" role="status"><i></i><span>' + (on ? "Включено от " + esc(b.atHm) + "<small>Включи: " + esc(whoText(b.by, cfg)) + "</small>" : "Изключено<small>Сроковете са обичайните</small>") + "</span></div>" +
        '<button class="kb big ' + (on ? "ink" : "ember") + '" type="button" data-tg>' + (on ? ic("check-circle", 28) + "Изключи: кухнята се справя" : ic("hourglass", 28) + "Включи +" + x + " мин") + "</button>" +
        '<ul class="why"><li>' + ic("info", 20) + "<span>Важи за цялата кухня: всички секции и всички канали.</span></li>" +
        "<li>" + ic("info", 20) + "<span>Поръчките не спират. Новите получават " + x + " мин повече; приетите пазят своя срок.</span></li>" +
        "<li>" + ic("info", 20) + "<span>Изключва се само ръчно. След " + remind + " мин напомняме, ако още е включено.</span></li>" +
        (b.remind ? '<li class="rem">' + ic("warning", 20) + "<span>Включено е повече от " + remind + " мин. Ако кухнята се справя, изключи го.</span></li>" : "") + "</ul></section>" +
      '<section class="fx kcard" aria-labelledby="h-fx"><h2 id="h-fx">' + (on ? "Новите срокове" : "Какво ще се промени") + "</h2>" +
        '<p class="klead">Срок в кухнята от приемането на поръчката</p>' +
        '<table><thead><tr><th scope="col">Канал</th><th scope="col">' + (on ? "Беше" : '<span class="vh">Беше</span>') + '</th><th scope="col">Сега</th></tr></thead><tbody>' +
        row("Маса", "Салон и Градина", b.norm.table) +
        row("Вземане", 'най-рано в <span data-earliest class="num">' + earliest(k.now()) + "</span>", b.norm.pickup) +
        row("Доставка", "шофьорът тръгва след това", b.norm.delivery) +
        "</tbody></table>" +
        '<div class="cust"><span class="lbl">Клиентът вижда при доставка, преди да поръча</span>' +
        '<div class="status"><span class="dot' + (on ? " warn" : "") + '"></span><span><b>' + esc(on ? b.customer.busy : b.customer.normal) + "</b></span></div>" +
        (b.zone ? '<span class="lbl thin">В поръчката времето е по квартал, също +' + x + " мин при „Натоварено“ (" + esc(b.zone.n) + ": около " + b.zone.etaMin + " → " + (b.zone.etaMin + x) + " мин).</span>" : "") +
        '<span class="lbl thin">' + (on ? "Беше: „" + esc(b.customer.normal) + "“" : "При „Натоварено“: „" + esc(b.customer.busy) + "“") + "</span>" +
        (b.missing.includes(NORMS) ? '<span class="lbl thin">Срокът в кухнята е условен: <span class="miss">' + NORMS + "</span></span>" : "") + "</div></section>" +
      '<section class="lg2 kcard" aria-labelledby="h-lg"><h2 id="h-lg">Днес</h2>' +
        (b.log.length ? b.log.map((l) => '<div class="lrow"><b>' + esc(l.onHm) + " - " + (l.off ? esc(l.offHm) : "сега") + "</b><span>" + esc(whoText(l.by, cfg)) + (l.off && l.offBy && l.offBy !== l.by ? '<small>Изключи: ' + esc(whoText(l.offBy, cfg)) + "</small>" : "") + "</span></div>").join("")
          : '<p class="none">Днес не е включвано.</p>') + "</section>" +
    "</div></div>";
    if (focus) main.querySelector<HTMLElement>("[data-tg]")?.focus({ preventScroll: true });
    k.strip();
  }
  k.onTick((now) => { const el = b && main.querySelector<HTMLElement>("[data-earliest]"); if (el) { const v = earliest(now); if (el.textContent !== v) el.textContent = v; } });

  const failed = (e: unknown) => { k.toast("<b>Не се записа</b><small>" + esc(e instanceof ApiError && e.message ? e.message : "Опитай пак.") + "</small>", { secs: 6 }); void data.now(); };
  /** what this tablet shows at once (the core's answer settles it) */
  function local(on: boolean): void {
    if (!b || b.on === on) return;
    const t = new Date(k.now()).toISOString(), me = k.all ? cfg.all.who : k.me.user.role === "kitchen" ? "Кухня · " + (cfg.sections.find((s) => s.id === k.sec)?.short || "") : b.by || "";
    if (on) { b = { ...b, on: true, at: t, atHm: k.hm(k.now()), by: me, remind: false, log: [{ on: t, onHm: k.hm(k.now()), off: null, offHm: "", by: me, offBy: "" }, ...b.log] }; }
    else { b = { ...b, on: false, at: null, atHm: "", by: null, remind: false, log: b.log.map((l) => (l.off ? l : { ...l, off: t, offHm: k.hm(k.now()), offBy: me })) }; }
    render();
  }
  function send(on: boolean): Promise<(KBusyView & { same: boolean }) | null> {
    data.hold();
    return k.send<KBusyView & { same: boolean }>({ k: "busy", on }).then((r) => { if (r) { b = r; render(); } return r; }).finally(() => data.release());
  }
  main.addEventListener("click", (e) => {
    if (!b || !(e.target as Element).closest("[data-tg]")) return;
    const was = b.on, x = b.extra;
    local(!was);
    const undo = () => { local(was); send(was).catch(failed); };
    send(!was).then((r) => {
      const later = r ? "" : " Ще се изпрати, щом връзката се върне.";
      k.toast(was ? "<b>Натоварено е изключено</b><small>Новите поръчки са с обичайните срокове." + later + "</small>" : "<b>Натоварено: +" + x + " мин</b><small>Новите поръчки и сайтът вече показват по-дълги срокове." + later + "</small>", { undo });
    }).catch(failed);
  });

  const data = live(k, { load: () => kitchenApi.busy(), take: (v) => { b = v; render(); }, events: ["kitchen.busy"] });
  void data.now();
}
