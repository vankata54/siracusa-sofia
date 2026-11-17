/* Кухня · Изпълнени днес (/kuhnya/izpalneni/): port of design/pages-kuhnya/done.html over the core (kitchenApi.doneToday,
   kitchenApi.back): the section's finished orders of the shift day, the newest first: the time, the source, the section's
   lines, "за 19 мин · навреме / с 3 мин закъснение", "Върни в опашката" (the notice says who was told, "Върни · 10"). An
   order that was served or taken meanwhile cannot go back: the core's 409 says why. "Днес изпълнени 8 · Навреме 6".
   Real time: "order.line" / "order.status" / "order.new" redraw the list. */
import "sc-icons:clock";
import { mountKitchen, ic, esc, type KFrame } from "./frame.ts";
import { kitchenApi, ApiError, type KDone, type KDoneRow, type KAct } from "../../client/api-kitchen.ts";
import { SRC_IC } from "./view.ts";
import { live } from "./live.ts";

export async function initIzpalneni(): Promise<void> {
  const k = await mountKitchen({ page: "izpalneni", title: "Изпълнени" });
  if (!k) return;
  screen(k);
}

const KIND_WORD = { delivery: "Доставка", pickup: "Вземане" } as const;

function screen(k: KFrame): void {
  const main = k.main;
  let d: KDone | null = null;
  const away = new Set<string>(); /* sent back from this tablet, until the core's list agrees */
  const rows = () => (d ? d.rows.filter((r) => !away.has(r.no)) : []);

  k.strip(() => {
    if (!d) return { counts: "" };
    const l = rows();
    return { counts: "<span>Днес изпълнени <b>" + l.length + '</b></span><span class="sep"></span><span>Навреме <b>' + l.filter((r) => r.onTime).length + "</b></span>", pills: k.pills.back("queue", "Към опашката") };
  });

  function rowHTML(r: KDoneRow): string {
    const s = r.src;
    const lines = r.lines.map((l) => '<span class="nw">' + l.q + " × " + esc(l.name) + (l.weight ? " (" + esc(l.weight) + ")" : "") + "</span>" + l.no.map((t) => ' <span class="md no">без ' + esc(t) + "</span>").join("")).join(", ");
    return '<div class="dr" data-no="' + esc(r.no) + '"><div class="t">' + esc(r.doneHm) + "<small>готово</small></div>" +
      '<div class="s">' + ic(SRC_IC[r.kind] || "fork-knife", 26) + "<span><b>" + esc(s.t) + "</b><small>" + esc(r.kind === "table" ? s.k : KIND_WORD[r.kind]) + "</small></span></div>" +
      '<div class="it">' + lines + "</div>" +
      '<div class="du">' + esc(r.text) + (r.onTime ? "<small>" + ic("check", 16) + esc(r.lateText) + "</small>" : '<small class="late">' + ic("warning", 16) + esc(r.lateText) + "</small>") + "</div>" +
      '<button class="kb line' + (r.canBack ? "" : " dis") + '" type="button" data-back="' + esc(r.no) + '"' + (r.canBack ? "" : ' aria-disabled="true"') + ' aria-label="Върни в опашката: ' + esc(s.text) + '">' + ic("arrow-counter-clockwise", 22) + 'Върни <span class="x">в опашката</span></button></div>';
  }
  function render(): void {
    if (!d) return;
    const l = rows(), act = document.activeElement as HTMLElement | null, fno = act && main.contains(act) ? act.dataset.back || "" : "", top = main.scrollTop;
    main.innerHTML = '<div class="kpage"><h1 class="kh1">Изпълнени днес</h1><p class="klead">Последните поръчки на ' + esc(k.secName) + ", най-новата горе. Ако нещо е отбелязано по грешка, върнете го в опашката.</p>" +
      (l.length ? '<div class="dl kcard">' + l.map(rowHTML).join("") + "</div>"
        : '<div class="kempty"><div><div class="ill">' + ic("clock", 56) + "</div><h2>Още няма изпълнени поръчки днес</h2><p>Тук ще виждате последните поръчки, отбелязани с „Готово“.</p></div></div>") + "</div>";
    main.scrollTop = top;
    if (fno) (main.querySelector<HTMLElement>('[data-back="' + CSS.escape(fno) + '"]') || main.querySelector<HTMLElement>("h1"))?.focus({ preventScroll: true });
    k.strip();
  }

  const failed = (e: unknown, title = "Не се записа") => { k.toast("<b>" + title + "</b><small>" + esc(e instanceof ApiError && e.message ? e.message : "Опитай пак.") + "</small>", { secs: 8 }); };
  function send(a: { k: "back"; no: string } | { k: "done"; no: string }): Promise<KAct | null> {
    data.hold();
    return k.send<KAct>(a).finally(() => data.release());
  }
  function back(r: KDoneRow): void {
    if (!r.canBack) { k.toast("<b>" + esc(r.src.text) + " не може да се върне</b><small>" + esc(r.why) + "</small>", { secs: 8 }); return; }
    away.add(r.no); render();
    const undo = () => { away.delete(r.no); render(); send({ k: "done", no: r.no }).then(() => data.reload()).catch((e) => { failed(e); data.reload(); }); };
    send({ k: "back", no: r.no }).then((x) => {
      const small = !x ? "Ще се изпрати, щом връзката се върне." : x.msg || "Пак е за готвене.";
      k.toast("<b>" + esc(r.src.text) + " е отново в опашката</b><small>" + esc(small) + "</small>", { undo });
      data.reload();
    }).catch((e) => { away.delete(r.no); render(); failed(e, "Не се върна"); data.reload(); });
  }
  main.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-back]"), r = b && d ? d.rows.find((x) => x.no === b.dataset.back) : null;
    if (r) back(r);
  });

  const data = live(k, {
    load: () => kitchenApi.doneToday(k.sec),
    take: (v) => { d = v; for (const no of [...away]) if (!v.rows.some((r) => r.no === no)) away.delete(no); render(); },
    events: ["order.line", "order.status", "order.new"],
  });
  void data.now();
}
