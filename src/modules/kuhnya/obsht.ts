/* Кухня · Общ изглед (/kuhnya/obsht-izgled/): port of design/pages-kuhnya/summary.html over the core (kitchenApi.summary).
   The head chef's screen ("all", its own tabs: Общ изглед · Изчерпано · Натоварено); a section's tablet sees it too.
   - 4 cards, one per section: how many wait, late, soon, the oldest, sold out today, the tablet ("Таблетът работи" /
     "без връзка от 19:37"); a card with a late order has the red frame. The head chef opens a section's queue from its
     card (queue#s=<section>, the frame); a section's tablet opens its own.
   - "Поръчки в работа" in the order of arrival: the state of every section with an icon and a word ("Скара · готви се",
     "Салати · готово") and the deadline that ticks every second (the word is always there: остават / наближава / закъснява).
   - Counted again from the timestamps every second (the cards and the row above agree with the table); the data again
     after every event of real time.
   - No connection: the frame's bar says "Данните за секциите са от 19:41"; the cards say "Няма данни след 19:41". */
import { mountKitchen, ic, esc, type KFrame } from "./frame.ts";
import { kitchenApi, type KSummary, type KState } from "../../client/api-kitchen.ts";
import { timerAt, mmss, ST_IC, ST_CLS, TIMER_WORD, type Tm } from "./view.ts";
import { live, pl } from "./live.ts";

export async function initObsht(): Promise<void> {
  const k = await mountKitchen({ page: "obsht-izgled", title: "Общ изглед" });
  if (!k) return;
  screen(k);
}

type Row = KSummary["rows"][number];
function screen(k: KFrame): void {
  const main = k.main, cfg = k.cfg, soon = cfg.soon;
  let d: KSummary | null = null, got = 0;
  const tmOf = (r: Row, now: number): Tm => timerAt(r.due, now, soon);
  const open = (r: Row, sec: string) => r.secs.some((x) => x.id === sec && x.state !== "ready");

  /** the counts at this second, from the same rows the table shows */
  function totals(now: number) {
    const rows = d ? d.rows : [];
    return { orders: rows.length, late: rows.filter((r) => tmOf(r, now).timer === "late").length, out: d ? d.totals.out : 0, later: d ? d.totals.later : 0 };
  }
  k.strip(() => {
    if (!d) return { counts: "" };
    const t = totals(k.now());
    return {
      counts: "<span>Поръчки в кухнята <b>" + t.orders + '</b></span><span class="sep"></span>' +
        (t.late ? '<span class="late">' + ic("warning", 20) + " Закъсняват <b>" + t.late + "</b></span>" : "<span>Закъсняват <b>0</b></span>") +
        '<span class="sep"></span><span>Изчерпани <b>' + t.out + '</b></span><span class="sep"></span><span>По-късно <b>' + t.later + "</b></span>",
      pills: k.pills.busy(),
    };
  });

  function cardsHTML(now: number): string {
    if (!d) return "";
    const off = !k.online(), mins = Math.floor((now - got) / 60_000);
    return d.sections.map((s) => {
      const mine = d!.rows.filter((r) => open(r, s.id)), tms = mine.map((r) => tmOf(r, now).timer);
      const wait = mine.length, late = tms.filter((x) => x === "late").length, soonN = tms.filter((x) => x === "soon").length;
      const oldest = wait && s.oldestMin != null ? s.oldestMin + Math.max(0, mins) + " мин" : "-";
      const tab = off ? '<span class="tab"><i class="off"></i>Няма данни след ' + esc(k.hm(got)) + "</span>" : '<span class="tab"><i' + (s.tablet.online ? "" : ' class="off"') + "></i>" + esc(s.tablet.text) + "</span>";
      const link = k.all || s.id === k.sec;
      const inner = '<span class="hd"><span class="si">' + ic(s.icon || "cooking-pot", 24) + "</span>" + esc(s.n) + "</span>" +
        '<span class="big"><b>' + wait + "</b><span>" + pl(wait, "поръчка чака", "поръчки чакат") + "</span></span>" +
        '<ul><li class="' + (late ? "bad" : "") + '"><span>' + (late ? ic("warning", 16) + " " : "") + "Закъсняват</span><b>" + late + '</b></li><li class="' + (soonN ? "warnl" : "") + '"><span>Наближават</span><b>' + soonN + "</b></li>" +
        "<li><span>Най-старата</span><b>" + oldest + "</b></li><li><span>Изчерпани днес</span><b>" + s.out + "</b></li></ul>" + tab;
      return link ? '<a class="sc kcard' + (late ? " late" : "") + '" data-sec="' + esc(s.id) + '" href="' + k.href("queue", k.all ? "s=" + encodeURIComponent(s.id) : undefined) + '">' + inner + "</a>"
        : '<div class="sc kcard' + (late ? " late" : "") + '" data-sec="' + esc(s.id) + '">' + inner + "</div>";
    }).join("");
  }
  const tmHTML = (tm: Tm) => "<small>" + TIMER_WORD[tm.timer] + "</small>" + (tm.timer === "late" ? "+" : "") + mmss(tm.left);
  const st = (x: { short: string; state: KState }) => '<span class="sst ' + ST_CLS[x.state] + '">' + ic(ST_IC[x.state], 16) + esc(x.short) + " · " + esc(cfg.stateText[x.state]) + "</span>";
  function rowHTML(r: Row, now: number): string {
    const tm = tmOf(r, now);
    return '<tr class="' + tm.timer + '" data-row="' + esc(r.no) + '"><td class="src"><b>' + esc(r.src.t) + "</b><small>" + esc(r.src.k) + '</small></td><td class="num">' + esc(r.arrivedHm) + "</td>" +
      '<td><div class="sts">' + r.secs.map(st).join("") + "</div></td>" + '<td class="tm">' + tmHTML(tm) + "</td></tr>";
  }
  function render(): void {
    if (!d) return;
    const now = k.now(), act = document.activeElement as HTMLElement | null, fsec = act && main.contains(act) ? act.dataset.sec || "" : "", top = main.scrollTop;
    main.innerHTML = '<div class="kpage"><h1 class="vh">Общ изглед на кухнята</h1><div class="secg" data-cards>' + cardsHTML(now) + "</div>" +
      '<h2 class="h2k">Поръчки в работа <span class="muted">· по реда на пристигане</span></h2>' +
      (d.rows.length ? '<div class="kcard otw"><table class="ot"><thead><tr><th scope="col">Поръчка</th><th scope="col">Пристигна</th><th scope="col">Секции</th><th scope="col" class="r">Срок</th></tr></thead><tbody>' +
        d.rows.map((r) => rowHTML(r, now)).join("") + "</tbody></table></div>"
        : '<div class="kempty"><div><div class="ill">' + ic("check-circle", 56) + "</div><h2>Няма поръчки в работа</h2><p>Всички секции са свободни.</p></div></div>") +
      '<p class="legend">' + st({ short: "", state: "ready" }).replace(" · ", "") + st({ short: "", state: "cook" }).replace(" · ", "") + st({ short: "", state: "wait" }).replace(" · ", "") +
      (k.all ? "<span>Докоснете секция, за да видите опашката ѝ.</span>" : "") + "</p></div>";
    main.scrollTop = top;
    if (fsec) main.querySelector<HTMLElement>('[data-sec="' + CSS.escape(fsec) + '"]')?.focus({ preventScroll: true });
    lastCards = main.querySelector("[data-cards]")!.innerHTML;
    k.strip();
  }
  /* every second: the timers of the table (only the text and the class), the cards when their numbers change */
  let lastCards = "";
  function paint(now: number): void {
    if (!d) return;
    main.querySelectorAll<HTMLElement>("[data-row]").forEach((tr) => {
      const r = d!.rows.find((x) => x.no === tr.dataset.row); if (!r) return;
      const tm = tmOf(r, now);
      if (!tr.classList.contains(tm.timer)) { tr.classList.remove("ok", "soon", "late"); tr.classList.add(tm.timer); }
      const td = tr.querySelector<HTMLElement>(".tm"), h = tmHTML(tm);
      if (td && td.innerHTML !== h) td.innerHTML = h;
    });
    const box = main.querySelector<HTMLElement>("[data-cards]"), h = cardsHTML(now);
    if (box && h !== lastCards) k.afterTouch(() => {
      const act = document.activeElement as HTMLElement | null, fsec = act && box.contains(act) ? act.dataset.sec || "" : "";
      box.innerHTML = h; lastCards = h;
      if (fsec) box.querySelector<HTMLElement>('[data-sec="' + CSS.escape(fsec) + '"]')?.focus({ preventScroll: true });
    });
    k.strip();
  }
  k.onTick(paint);
  k.onNet(() => paint(k.now()));

  const data = live(k, { load: () => kitchenApi.summary(), take: (v) => { d = v; got = v.now; k.sync(v.now); render(); }, events: ["order.new", "order.line", "order.status", "menu.soldout", "kitchen.busy"] });
  void data.now();
}
