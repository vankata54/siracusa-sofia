/* Кухня · Изчерпано днес (/kuhnya/izcherpano/): port of design/pages-kuhnya/item-out.html over the core
   (kitchenApi.soldOut / setOut; the one switch of core/menu.ts: site, QR, waiter and the order check read the same).
   - The tiles of the section's dishes (+ "Обедно меню" on its day in its section, "Добавки · за всички секции"): one
     touch = "Изчерпано днес" at once, the notice says in how many accepted orders the dish is and who was told (the
     core's sentence: "сервитьора" for a table, "управителя (доставка и вземане)" for delivery and pickup), "Върни · 10".
   - "Списък изчерпани" from every section (the section's own first) with when and who, "Върни в менюто".
   - The reset line is the core's: back by itself at midnight (Sofia).
   - Real time: "menu.soldout" from any tablet, the admin or the manager redraws the screen; with no connection the touch
     is kept on the tablet (k.send) and the tile stays as it was touched. */
import { mountKitchen, ic, esc, type KFrame } from "./frame.ts";
import { kitchenApi, ApiError, type KSoldOut, type KOutResult, type KOutRow } from "../../client/api-kitchen.ts";
import { live, whoText } from "./live.ts";

export async function initIzcherpano(): Promise<void> {
  const k = await mountKitchen({ page: "izcherpano", title: "Изчерпано днес" });
  if (!k) return;
  screen(k);
}

function screen(k: KFrame): void {
  const main = k.main, cfg = k.cfg;
  let d: KSoldOut | null = null;
  const secName = (sec: string) => (sec === "shared" ? "Добавка, всички секции" : cfg.sections.find((s) => s.id === sec)?.n || "");
  const counts = () => { const l = d ? d.list : []; return { mine: l.filter((r) => r.mine).length, all: l.length }; };

  k.strip(() => {
    if (!d) return { counts: "" };
    const c = counts();
    return { counts: (k.all ? "" : "<span>Изчерпани за " + esc(k.secName) + " <b>" + c.mine + '</b></span><span class="sep"></span>') + "<span>Във всички секции <b>" + c.all + "</b></span>" };
  });

  function tileHTML(x: { id: string; n: string; g: string; out: boolean }): string {
    return '<button class="tile' + (x.out ? " out" : "") + '" type="button" data-id="' + esc(x.id) + '" aria-pressed="' + x.out + '"><span><b>' + esc(x.n) + "</b>" + (x.g ? "<small>" + esc(x.g) + "</small>" : "") + "</span> " +
      (x.out ? '<span class="st">' + ic("x", 18) + "Изчерпано днес</span> " : "") +
      '<span class="act">' + (x.out ? ic("arrow-counter-clockwise", 18) + "Върни в менюто" : ic("x", 18) + "Отбележи изчерпано") + "</span></button>";
  }
  function rowHTML(r: KOutRow): string {
    /* "Скара Bertha · от 18:05 · Скара Bertha" is said once; sold out in the menu's data (the admin): it does not come
       back at midnight, the line says so (review 1, important 2) */
    const by = r.by ? whoText(r.by, cfg) : "", meta = [r.secName, r.menu ? "изчерпано в менюто от админа (не се връща само)" : r.atHm ? "от " + r.atHm : "", by && by !== r.secName ? by : ""].filter(Boolean).join(" · ");
    return '<div class="orow"><div><b>' + esc(r.n) + "</b><small>" + esc(meta) + "</small></div>" +
      '<button class="kb line" type="button" data-back="' + esc(r.id) + '">' + ic("arrow-counter-clockwise", 22) + "Върни в менюто" + '<span class="vh">: ' + esc(r.n) + "</span></button></div>";
  }
  function render(): void {
    if (!d) return;
    const act = document.activeElement as HTMLElement | null, fid = act && main.contains(act) ? act.dataset.id || act.dataset.back || "" : "", wasBack = !!(act && act.dataset.back);
    const top = main.scrollTop;
    const list = d.list;
    main.innerHTML = '<div class="kpage"><div class="io"><section aria-labelledby="h1">' +
      '<div class="io-h"><div><h1 class="kh1" id="h1">Изчерпано днес</h1><p class="klead">Докосни ястие, което свърши. Действа веднага.</p></div></div>' +
      '<ul class="eff"><li>' + ic("check", 18) + "Сайт, QR меню и сервитьор: видимо с „Изчерпано днес“, без „+“</li><li>" + ic("check", 18) + "Wolt и Foodpanda: скрито</li></ul>" +
      d.groups.map((g) => '<h2 class="cath">' + esc(g.n) + (g.note ? " <span>· " + esc(g.note) + "</span>" : "") + '</h2><div class="tiles">' + g.items.map(tileHTML).join("") + "</div>").join("") +
      '</section><aside class="side kcard" aria-labelledby="h-side"><h2 id="h-side">Списък изчерпани <span class="n num">' + list.length + "</span></h2>" +
      (list.length ? list.map(rowHTML).join("") : '<p class="none">Всичко от менюто е налично.</p>') +
      '<p class="foot2">' + ic("info", 20) + "<span>" + esc(d.resets) + "</span></p></aside></div></div>";
    main.scrollTop = top;
    if (fid) {
      const sel = wasBack ? '[data-back="' + CSS.escape(fid) + '"]' : '[data-id="' + CSS.escape(fid) + '"]';
      (main.querySelector<HTMLElement>(sel) || main.querySelector<HTMLElement>('[data-id="' + CSS.escape(fid) + '"]'))?.focus({ preventScroll: true });
    }
    k.strip(); k.setTab("izcherpano", counts().mine);
  }

  /* ---------- the touch: at once on the screen, then the core ---------- */
  const itemOf = (id: string) => { for (const g of d!.groups) { const x = g.items.find((i) => i.id === id); if (x) return { x, g }; } return null; };
  /** the screen as if the core had said it already */
  function local(id: string, out: boolean, name: string): void {
    if (!d) return;
    for (const g of d.groups) for (const x of g.items) if (x.id === id) x.out = out;
    const f = itemOf(id), sec = f ? f.g.sec : d.list.find((r) => r.id === id)?.sec || "";
    d.list = d.list.filter((r) => r.id !== id);
    if (out) d.list.unshift({ id, n: name, sec, secName: secName(sec), at: new Date(k.now()).toISOString(), atHm: k.hm(k.now()), by: k.all ? cfg.all.who : k.me.user.role === "kitchen" ? "Кухня · " + (cfg.sections.find((s) => s.id === k.sec)?.short || "") : null, mine: true, menu: false });
    render();
  }
  const failed = (e: unknown) => { k.toast("<b>Не се записа</b><small>" + esc(e instanceof ApiError && e.message ? e.message : "Опитай пак.") + "</small>", { secs: 6 }); void data.now(); };
  function send(id: string, out: boolean): Promise<KOutResult | null> {
    data.hold();
    return k.send<KOutResult>({ k: "out", id, out }).finally(() => data.release());
  }
  function toggle(id: string): void {
    if (!d) return;
    const f = itemOf(id), row = d.list.find((r) => r.id === id);
    const was = f ? f.x.out : !!row, name = f ? f.x.n : row ? row.n : id;
    local(id, !was, name);
    const undo = () => { local(id, was, name); send(id, was).catch(failed); };
    send(id, !was).then((r) => {
      const small = r ? r.msg : "Ще се изпрати, щом връзката се върне.";
      k.toast(was ? "<b>" + esc(name) + " е отново в менюто</b><small>" + esc(small) + "</small>" : "<b>" + esc(name) + " · изчерпано днес</b><small>" + esc(small) + "</small>", { undo });
    }).catch(failed);
  }
  main.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-id], [data-back]");
    if (b) toggle(b.dataset.id || b.dataset.back || "");
  });

  const data = live(k, { load: () => kitchenApi.soldOut(k.sec), take: (v) => { d = v; render(); }, events: ["menu.soldout"] });
  void data.now();
}
