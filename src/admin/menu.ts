/* /admin/menu/: „Меню“, пълен редактор (design/pages-admin/menu.html, версия 4, 1:1; решения 15.11 и 16.11.2026).
   Три части (табове; на телефон избор): Ястия · Категории · Добави и Смени.
   - Една обща чернова с версия (src/client/api-menu.ts): всяка промяна (без „Изчерпано днес“) -> menuApi.saveDraft(цялото
     меню, версията); известие „В черновата: …“ с „Отмени“ (записва предишното меню); лентата „Чернова: N промени · Откажи ·
     Публикувай“ над долната лента (data-pbar: рамката вдига известието и молива). 409 -> „Някой друг промени черновата.“
     и „Зареди пак“; 422 -> текстът на полето.
   - „Изчерпано днес“ действа веднага (adminApi.setSoldOut), не е чернова; „Върни“ / „Отмени“ в известието.
   - „Публикувай“: обобщението от changes на сървъра (нови, променени с какво, махнати с 301, категориите, „Добави“, ястия
     без състав като бележка), после menuApi.publish и състоянието на пресглобяването (state(): опашка, строи, готово, грешка);
     в демото сайтът не се пресглобява (екранът го казва). „Върни предишното меню“ (rollback) с потвърждение.
   - Цените на добавките = цените на ястията в категория „Добавки“ (решение 16.11.2026).
   Адреси: #t=cats|opts, #f=out|draft|hit|new|veg|hot, #c=<категория>, #q=<търсене>, #d=<id> (от търсачката), #review=1. */
import "sc-icons:plus,export,fork-knife,clock,pencil-simple,warning-circle,check-circle,info,caret-right,arrow-counter-clockwise,trash,magnifying-glass,list,caret-up,caret-down,lock,arrow-clockwise,money,eye,image,cube,paper-plane-right,fire,sparkle,leaf,pepper,funnel,warning,check,x,grains,shrimp,egg,fish,circles-three,plant,drop,acorn,carrot,jar,dots-nine,wine,flower,fish-simple";
import { api } from "../client/api.ts";
import { adminApi } from "../client/api-admin.ts";
import { menuApi, ApiError, type MenuChanges, type MenuState, type Menu } from "../client/api-menu.ts";
import type { Dish } from "../data/menu.ts";
import { artSvg } from "../lib/art.ts";
import { searchDishes, chips as qChips, toggle as qToggle, type Searchable } from "../lib/search.ts";
import { A, mount, toast, sheet, confirm, skel, empty, banner, offline as offlineHTML, missing, soonTag, norm, esc, ic, fmt, plural } from "./a.ts";
import { aurl } from "./routes.ts";
import { ago, hmOf } from "./when.ts";

/* the tags and the 14 allergens as in src/lib/consts.ts (TAGS, ALLERGENS); kept here so the admin adds no exports to the
   shared runtime chunk (it holds consts.ts) */
const TAGS: [string, string, string][] = [["hit", "Хит", "fire"], ["new", "Ново", "sparkle"], ["veg", "Вегетарианско", "leaf"], ["hot", "Люто", "pepper"]];
const TAGN: Record<string, [string, string]> = { hit: ["Хит", "fire"], new: ["Ново", "sparkle"], veg: ["Вегетарианско", "leaf"], hot: ["Люто", "pepper"] };
const ALLERGENS: [string, string, string][] = [
  ["gluten", "Глутен", "grains"], ["crustaceans", "Ракообразни", "shrimp"], ["eggs", "Яйца", "egg"], ["fish", "Риба", "fish"],
  ["peanuts", "Фъстъци", "circles-three"], ["soy", "Соя", "plant"], ["milk", "Мляко", "drop"], ["nuts", "Ядки", "acorn"],
  ["celery", "Целина", "carrot"], ["mustard", "Синап", "jar"], ["sesame", "Сусам", "dots-nine"], ["sulphites", "Сулфити", "wine"],
  ["lupin", "Лупина", "flower"], ["molluscs", "Мекотели", "fish-simple"],
];
const ADDONS = "dobavki";
const FILTERS: [string, string, string][] = [["", "Всички", "list"], ["out", "Изчерпани днес", "clock"], ["draft", "В черновата", "pencil-simple"], ["hit", "Хит", "fire"], ["new", "Ново", "sparkle"], ["veg", "Вегетарианско", "leaf"], ["hot", "Люто", "pepper"]];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const num = (p: number) => (Math.round(p * 100) / 100).toFixed(2).replace(".", ",");
function parsePrice(s: string): number { const v = String(s || "").replace(/\s/g, "").replace("€", "").replace(",", "."); if (!/^\d{1,3}(\.\d{1,2})?$/.test(v)) return NaN; return +v; }
const tmpId = () => "new-" + Math.random().toString(36).slice(2, 10);
const isOfflineErr = (e: unknown) => e instanceof ApiError && e.code === "offline";

/* ---------- the hash ---------- */
function readHash(): Record<string, string> {
  const o: Record<string, string> = {};
  location.hash.replace(/^#/, "").split("&").forEach((p) => { if (!p) return; const i = p.indexOf("="); const k = i < 0 ? p : p.slice(0, i); try { o[k] = i < 0 ? "1" : decodeURIComponent(p.slice(i + 1)); } catch { o[k] = p.slice(i + 1); } });
  return o;
}

export async function initMenu(): Promise<void> {
  const body0 = await mount({ section: "menu", title: "Меню", docTitle: "Меню", eyebrow: "Меню",
    sub: "Пълен редактор: ястия, категории и редът им, „Добави“ и „Смени“. Промените са чернова, докато не натиснете „Публикувай“. „Изчерпано днес“ действа веднага.",
    actions: '<button class="pill pill-red pill-lg" type="button" data-new>' + ic("plus", 22) + 'Ново ястие</button><a class="pill pill-line pill-lg" href="' + aurl.menuImport() + '">' + ic("export", 22) + "Внос на меню</a>" });
  if (!body0) return;
  const body = body0;

  /* ---------- the data ---------- */
  let M: Menu | null = null, ver = 0;
  let CH: MenuChanges = emptyChanges();
  let live: Menu | null = null;
  let PS: MenuState | null = null;
  let outs = new Set<string>();
  let loadErr: unknown = null, loading = true, conflict = false;
  let net = typeof navigator === "undefined" || navigator.onLine !== false;
  const H = readHash();
  const view = { t: ["cats", "opts"].includes(H.t) ? H.t : "", f: FILTERS.some((f) => f[0] === H.f) ? H.f : "", c: H.c || "", q: H.q || "" };

  function emptyChanges(): MenuChanges { return { dishes: { added: [], changed: [], removed: [] }, cats: { added: [], renamed: [], removed: [], order: false, empty: [] }, opts: [], noComp: [], count: 0 }; }
  const liveDish = (id: string): Dish | undefined => (live ? live.items.find((x) => x.id === id) : undefined);
  const catIds = () => (M ? M.cats.map((c) => c.id) : []);
  function catName(id: string, m: Menu | null = M): string {
    const c = (m && m.cats.find((z) => z.id === id)) || (M && M.cats.find((z) => z.id === id)) || (live && live.cats.find((z) => z.id === id));
    return c ? c.n : id;
  }
  const dish = (id: string): Dish | undefined => (M ? M.items.find((x) => x.id === id) : undefined) || removedDishes().find((x) => x.id === id);
  /** the dishes the draft takes off the menu ("Ще се махне"): live dishes not in the draft */
  /* new and removed by the live menu at once (also before the server answers); "changed" with what: from the server */
  const inDraft = (id: string) => !!M && M.items.some((x) => x.id === id);
  function removedDishes(): Dish[] { return live && M ? live.items.filter((x) => !inDraft(x.id)) : []; }
  function stateOf(id: string): "" | "new" | "chg" | "del" {
    const isLive = !!liveDish(id), here = inDraft(id);
    if (here && !isLive) return "new";
    if (!here && isLive) return "del";
    if (CH.dishes.changed.some((x) => x.id === id)) return "chg";
    return "";
  }
  const isOut = (id: string) => outs.has(id);
  const addonOn = (x: Dish) => { const o = M && M.opts ? M.opts.addon : { cats: [], dishes: {} as Record<string, boolean> }; return own(o.dishes, x.id) ? !!o.dishes[x.id] : o.cats.includes(x.cat); };
  const tagsOf = (x: Dish) => x.t.filter((k) => k !== "out");
  function lunchName(id: string) { const l = live && live.lunch.items.find((x) => x.id === id); return l ? l.n : ""; }
  function outList(): { id: string; n: string; lunch: boolean }[] {
    const l: { id: string; n: string; lunch: boolean }[] = [];
    outs.forEach((id) => { const x = (M && M.items.find((z) => z.id === id)) || liveDish(id); if (x) l.push({ id, n: x.n, lunch: false }); else { const n = lunchName(id); if (n) l.push({ id, n, lunch: true }); } });
    return l;
  }
  function readOuts(m: Menu) { outs = new Set(m.items.filter((x) => x.t.includes("out")).map((x) => x.id).concat(m.lunch.items.filter((x) => x.out).map((x) => x.id))); }

  async function load() {
    loading = true; loadErr = null;
    try {
      const [d, l] = await Promise.all([menuApi.draft(), api.menu()]);
      M = d.menu; ver = d.version; CH = d.changes; live = l; readOuts(l); conflict = false;
      PS = await menuApi.state().catch(() => PS);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { location.replace(aurl.login(aurl.here())); return; }
      loadErr = e;
    }
    loading = false;
  }

  /* ---------- saving the draft (one at a time; the whole menu with the version) ---------- */
  let chain: Promise<void> = Promise.resolve(), pending = 0;
  function failText(e: unknown): string {
    if (e instanceof ApiError && e.fields) { const k = Object.keys(e.fields)[0]; if (k) return e.fields[k]; }
    if (isOfflineErr(e)) return "Няма връзка. Промяната не е записана; опитайте пак, щом връзката се върне.";
    return e instanceof ApiError ? e.message : "Не успяхме да запишем черновата. Опитайте пак.";
  }
  function onFail(e: unknown, before: Menu) {
    if (e instanceof ApiError && e.status === 401) { location.replace(aurl.login(aurl.here())); return; }
    if (e instanceof ApiError && e.code === "conflict") { conflict = true; draw(true); hideToast(); return; }
    M = before; if (isOfflineErr(e)) net = false;
    draw(true); toast(failText(e));
  }
  /** writes the draft as it is now; ok() after the server took it */
  function save(before: Menu, ok?: () => void, redraw: () => void = () => draw(true)) {
    pending++;
    chain = chain.then(async () => {
      try {
        const r = await menuApi.saveDraft(M!, ver);
        pending--; ver = r.version; CH = r.changes; if (!pending) M = r.menu; const wasOff = !net; net = true;
        if (wasOff) draw(true); else redraw();
        if (ok) ok();
      } catch (e) { pending--; onFail(e, before); }
    });
    return chain;
  }
  /** a change to the draft: fn(the draft), drawn at once, then saved; the toast "В черновата: …" with "Отмени".
      row: only that row is drawn again (a price typed in the list: the next field keeps the focus) */
  function edit(txt: string, fn: (m: Menu) => void, after?: () => void, row?: string) {
    if (!M || conflict) return;
    const before = clone(M), redraw = row ? () => refreshRow(row) : () => draw(true);
    fn(M); redraw(); if (after) after();
    save(before, () => { draftToast(txt, before); }, redraw);
  }
  function draftToast(txt: string, before: Menu) {
    toast("В черновата: " + txt, { undo: () => { if (!M || conflict) return; const cur = clone(M); M = before; draw(true); save(cur, () => toast("Отменено: " + txt)); } });
  }
  function hideToast() { const t = A.col && A.col.querySelector(".sa-toast"); if (t) t.classList.remove("on"); }

  /* ---------- "Изчерпано днес": at once, not the draft ---------- */
  async function setOut(id: string, on: boolean, n: string, focusSel?: string) {
    const was = isOut(id);
    if (on) outs.add(id); else outs.delete(id);
    refreshRow(id, focusSel); flash(id);
    try {
      await adminApi.setSoldOut(id, on);
      toast((on ? "Изчерпано днес: " : "Отново в менюто: ") + n, { undo: () => { setOut(id, !on, n); }, undoLabel: on ? "Върни" : "Отмени" });
    } catch (e) {
      if (was) outs.add(id); else outs.delete(id);
      refreshRow(id, focusSel);
      toast(isOfflineErr(e) ? "Няма връзка. „Изчерпано днес“ не е сменено; опитайте пак." : e instanceof ApiError ? e.message : "Не успяхме. Опитайте пак.");
    }
  }

  /* ---------- the picture: the photo from the admin, else the illustration ---------- */
  function picHTML(x: Dish, cls = "") {
    if (x.photo) return '<img class="pic ' + cls + '" src="' + esc(x.photo) + '" alt="' + esc(x.n) + '" loading="lazy" decoding="async">';
    return '<div class="pic ' + cls + '" role="img" aria-label="' + esc(x.n) + ' (илюстрация до новата фотосесия)">' + artSvg(x) + "</div>";
  }

  /* ---------- filters and search ---------- */
  function pass(x: Dish, f = view.f) { if (f === "out") return isOut(x.id); if (f === "draft") return !!stateOf(x.id); if (f) return x.t.includes(f as Dish["t"][number]); return true; }
  function match(x: Dish) { const q = norm(view.q); if (!q) return true; const k = norm(x.n + " " + (x.comp || "") + " " + (x.desc || "") + " " + catName(x.cat)); return q.split(" ").every((p) => k.includes(p)); }
  function syncHash() {
    const p: string[] = [];
    if (view.t) p.push("t=" + view.t); if (view.f) p.push("f=" + view.f); if (view.c) p.push("c=" + encodeURIComponent(view.c)); if (view.q) p.push("q=" + encodeURIComponent(view.q));
    try { history.replaceState(history.state, "", location.pathname + location.search + (p.length ? "#" + p.join("&") : "")); } catch { /* ignore */ }
  }

  /* ---------- the parts ---------- */
  function tagsHTML(x: Dish) {
    const out = isOut(x.id), s = stateOf(x.id);
    return (s === "new" ? '<span class="mn-dt new">' + ic("plus", 14) + "Ново в черновата</span>" : s === "chg" ? '<span class="mn-dt chg">' + ic("pencil-simple", 14) + "Променено в черновата</span>" : s === "del" ? '<span class="mn-dt del">' + ic("trash", 14) + "Ще се махне</span>" : "") +
      (out ? '<span class="badge out">' + ic("clock", 16) + "Изчерпано днес</span>" : "") + tagsOf(x).filter((k) => TAGN[k]).map((k) => '<span class="badge ' + k + '">' + ic(TAGN[k][1], 16) + TAGN[k][0] + "</span>").join("");
  }
  function rowHTML(x: Dish) {
    const out = isOut(x.id), s = stateOf(x.id), lv = liveDish(x.id), was = lv && lv.p !== x.p && s !== "new" ? lv.p : null, al = x.al.length, isLive = !!lv;
    return '<div class="mn-row' + (out ? " out" : "") + (s === "del" ? " del" : "") + '" data-id="' + esc(x.id) + '" data-edit-id="admin.menu.row">' + picHTML(x) +
      '<div class="mn-nm"><button class="mn-open" type="button" data-edit aria-label="Редактирай: ' + esc(x.n) + '">' + esc(x.n) + ic("caret-right", 20) + "</button>" +
        (x.desc ? '<span class="mn-desc">' + esc(x.desc) + "</span>" : "") +
        '<span class="meta">' + (x.per100 ? "<span>за 100 гр.</span>" : x.g ? "<span>" + esc(x.g) + "</span>" : "") +
        '<span class="al">' + ic("info", 16) + (al ? plural(al, "алерген", "алергена") : x.comp ? "Без алергени по състава" : "Без състав: в сайта „Нямаме пълен състав, попитайте ни“") + "</span>" +
        (addonOn(x) ? '<span class="al">' + ic("plus", 16) + "Добави</span>" : "") + tagsHTML(x) + "</span></div>" +
      '<div class="mn-ctl">' + (s === "del" ? '<button class="pill pill-line" type="button" data-undel>' + ic("arrow-counter-clockwise", 20) + "Върни в менюто</button>" :
        '<div class="mn-pr"><label class="mn-pf' + (was != null ? " chg" : "") + '"><span class="vh">Цена на „' + esc(x.n) + "“ в евро" + (x.per100 ? ", за 100 гр." : "") + '</span><input type="text" inputmode="decimal" autocomplete="off" value="' + num(x.p) + '" data-price aria-describedby="pe-' + esc(x.id) + '"><span aria-hidden="true">€</span></label>' +
          '<small id="pe-' + esc(x.id) + '"' + (was != null || x.per100 ? "" : " hidden") + ">" + (was != null ? "в сайта " + fmt(was) : x.per100 ? "за 100 гр." : "") + "</small></div>" +
        (isLive ? '<label class="mn-out' + (out ? " on" : "") + '">Изчерпано днес<span class="sa-switch"><input type="checkbox" role="switch" data-out aria-label="Изчерпано днес: ' + esc(x.n) + '"' + (out ? " checked" : "") + '><span class="tr"></span></span></label>' : "") +
        '<button class="pill pill-line ed" type="button" data-edit>' + ic("pencil-simple", 20) + "Редактирай</button>") +
      "</div></div>";
  }

  function pubInfo(): string {
    if (!PS) return "";
    const b = PS.build;
    let st = "";
    if (PS.mode === "demo") st = '<span class="st">' + ic("info", 18) + "В демото сайтът не се пресглобява; на сървъра се пресглобява сам.</span>";
    else if (b.state === "queued") st = '<span class="st wait" role="status">' + ic("clock", 18) + "Сайтът чака да се пресглоби …</span>";
    else if (b.state === "building") st = '<span class="st wait" role="status">' + ic("arrow-clockwise", 18) + "Сайтът се пресглобява …</span>";
    else if (b.state === "done" && b.at) st = '<span class="st">' + ic("check-circle", 18) + "Сайтът е пресглобен: готово в " + esc(hmOf(b.at)) + (PS.by ? " от " + esc(PS.by) : "") + "</span>";
    else if (b.state === "error") st = '<span class="st bad" role="alert">' + ic("warning", 18) + "Сайтът не се пресглоби, остава предишният. Опитайте „Публикувай“ пак или кажете на главния админ.</span>";
    const head = PS.at ? ic("check-circle", 18) + "<span>Публикувано " + esc(ago(PS.at)) + (PS.by ? " от " + esc(PS.by) : "") + (PS.count ? " · " + plural(PS.count, "промяна", "промени") : "") + "</span>" : "";
    const back = PS.prev ? '<button class="pill pill-line" type="button" data-rollback>' + ic("arrow-counter-clockwise", 18) + "Върни предишното меню</button>" : "";
    if (!head && !back && PS.mode !== "demo" && b.state === "idle") return "";
    return '<div class="mn-pubinfo" data-pubinfo data-edit-id="admin.menu.pubinfo">' + head + st + back + "</div>";
  }

  function summary() {
    const ol = outList(), list = M!.items, n = CH.count;
    return '<div class="sa-shell" data-edit-id="admin.menu.summary"><div class="mn-sum">' +
      '<button class="mn-k" type="button" data-f=""><span class="lb">' + ic("fork-knife", 20) + 'Ястия в менюто</span><span class="v">' + list.length + '</span><span class="ft">в ' + plural(M!.cats.length, "категория", "категории") + "</span></button>" +
      '<button class="mn-k out" type="button" data-f="out"><span class="lb">' + ic("clock", 20) + 'Изчерпани днес</span><span class="v">' + ol.length + '</span><span class="ft">' + (ol.length ? esc(ol.slice(0, 2).map((x) => x.n).join(", ")) + (ol.length > 2 ? " и още " + (ol.length - 2) : "") : "Всичко е налично") + "</span></button>" +
      '<button class="mn-k" type="button" data-f="draft"><span class="lb">' + ic("pencil-simple", 20) + 'В черновата</span><span class="v">' + n + '</span><span class="ft">' + (n ? "чакат „Публикувай“" : "няма промени") + "</span></button>" +
      '<div class="mn-k" style="cursor:default"><span class="lb">' + ic("warning-circle", 20) + 'Без състав</span><span class="v">' + list.filter((x) => !x.comp).length + '</span><span class="ft">ястия; алергените на останалите чакат кухнята</span></div>' +
      "</div></div>" + pubInfo() +
      '<div class="mn-rule" data-edit-id="admin.menu.rule">' + ic("clock", 22) + "<span><b>„Изчерпано днес“ действа веднага и важи до полунощ по София.</b> Ястието остава видимо в сайта, в QR менюто и при сервитьора с „Изчерпано днес“ и без „+“. Скрито е само в Wolt и Foodpanda.</span></div>" +
      (ol.length ? '<div class="mn-today" data-edit-id="admin.menu.today"><b>' + ic("clock", 20) + "Днес изчерпани</b>" + ol.map((x) => '<button class="chip" type="button" data-back="' + esc(x.id) + '">' + esc(x.n) + (x.lunch ? " (обедно)" : "") + " · " + ic("arrow-counter-clockwise", 18) + "Върни</button>").join("") + "</div>" : "");
  }

  function tabsHTML() {
    const n = M!.items.length, c = M!.cats.length;
    const T: [string, string, number | null][] = [["", "Ястия", n], ["cats", "Категории", c], ["opts", "Добави и Смени", null]];
    return '<div class="mn-tabs" data-edit-id="admin.menu.tabs"><div class="sa-tabs" role="tablist" aria-label="Редактор на менюто">' + T.map((t) =>
      '<button type="button" role="tab" id="mt-' + (t[0] || "dishes") + '" aria-controls="mn-tp" aria-selected="' + (view.t === t[0]) + '" tabindex="' + (view.t === t[0] ? 0 : -1) + '" data-tab="' + t[0] + '">' + t[1] + (t[2] != null ? '<span class="c">' + t[2] + "</span>" : "") + "</button>").join("") +
      '</div><div class="mn-tsel"><label class="vh" for="mn-ts">Част от редактора</label><select class="input" id="mn-ts">' + ([["", "Ястия (" + n + ")"], ["cats", "Категории (" + c + ")"], ["opts", "Добави и Смени"]] as [string, string][]).map((t) => '<option value="' + t[0] + '"' + (view.t === t[0] ? " selected" : "") + ">" + t[1] + "</option>").join("") + "</select></div></div>";
  }

  function schipsHTML() {
    if (!view.q.trim()) return ""; const ch = qChips(view.q); if (!ch.length) return "";
    return '<div class="mn-sch" role="group" aria-label="Съставки в търсенето">' + ch.map((c) => '<button class="chip" type="button" data-qtog="' + esc(c.word) + '" aria-pressed="' + c.without + '">' + (c.without ? "без " + esc(c.label) : esc(c.label) + " " + ic("x", 16)) + '<span class="vh">' + (c.without ? ", смени на „" + esc(c.label) + "“" : ", смени на „без " + esc(c.label) + "“") + "</span></button>").join("") + "</div>";
  }
  function listAll(withDel: boolean) { return withDel ? M!.items.concat(removedDishes()) : M!.items.slice(); }
  function fltHTML() {
    const list = listAll(true);
    return FILTERS.map((f) => '<button class="chip" type="button" data-f="' + f[0] + '" aria-pressed="' + (view.f === f[0]) + '">' + ic(f[2], 18) + f[1] + ' <span class="n">' + list.filter((x) => pass(x, f[0])).length + "</span></button>").join("");
  }
  function toolbar() {
    const list = M!.items;
    return '<div class="mn-bar" data-edit-id="admin.menu.toolbar"><div class="sa-field-s"><label class="vh" for="mn-q">Търси ястие</label>' + ic("magnifying-glass", 20) + '<input class="input" id="mn-q" type="search" placeholder="Име или съставка, например „лук“, „без глутен“" autocomplete="off" value="' + esc(view.q) + '"><button class="mn-clr" type="button" data-qclr' + (view.q ? "" : " hidden") + ">" + ic("x", 18) + 'Изчисти</button></div><div class="mn-schips" data-schips>' + schipsHTML() + "</div>" +
      '<div class="mn-flt" role="group" aria-label="Покажи">' + fltHTML() + "</div>" +
      '<div class="mn-cats" role="group" aria-label="Категория"><button class="chip" type="button" data-c="" aria-pressed="' + !view.c + '">Всички категории</button>' + catIds().map((c) => '<button class="chip" type="button" data-c="' + esc(c) + '" aria-pressed="' + (view.c === c) + '">' + esc(catName(c)) + ' <span class="n">' + list.filter((x) => x.cat === c).length + "</span></button>").join("") + "</div></div>";
  }
  function rail() {
    const list = M!.items;
    return '<nav class="mn-rail" aria-label="Категории" data-edit-id="admin.menu.rail"><button type="button" data-c="" aria-pressed="' + !view.c + '"><span>Всички категории</span><span class="n">' + list.length + "</span></button>" +
      catIds().map((c) => { const items = list.filter((x) => x.cat === c), o = items.filter((x) => isOut(x.id)).length;
        return '<button type="button" data-c="' + esc(c) + '" aria-pressed="' + (view.c === c) + '"><span>' + esc(catName(c)) + '</span><span class="n">' + (o ? '<span class="o">' + ic("clock", 14) + o + "</span> · " : "") + items.length + "</span></button>"; }).join("") + "</nav>";
  }

  /* the search is one (src/lib/search.ts): by name on top, "Съдържат …" below, without a composition never "без …" */
  function sect(title: string, sub: string, items: Dish[], id: string) {
    return items.length ? '<section class="mn-g" aria-labelledby="h-s-' + id + '" data-edit-id="admin.menu.results"><div class="mn-gh"><h2 id="h-s-' + id + '">' + esc(title) + "</h2><small>" + (sub || plural(items.length, "ястие", "ястия")) + "</small></div>" + items.map(rowHTML).join("") + "</section>" : "";
  }
  function clearBtn(t: string) { return '<button class="pill pill-line pill-lg" type="button" data-clear>' + ic("x", 20) + t + "</button>"; }
  function searchView() {
    const pool = listAll(view.f === "draft").filter((x) => pass(x) && (!view.c || x.cat === view.c));
    const by = new Map(pool.map((x) => [x.id, x]));
    const P: (Searchable & { id: string })[] = pool.map((x) => ({ id: x.id, n: x.n, comp: x.comp || "", al: x.al, t: x.t, kw: catName(x.cat) }));
    const r = searchDishes(P, view.q), back = (l: Searchable[]) => l.map((y) => by.get(y.id)!).filter(Boolean);
    const name = back(r.name), comp = back(r.comp), rest = back(r.rest), unk = back(r.unknown);
    if (!name.length && !comp.length && !rest.length && !unk.length) return '<div class="sa-card">' + empty({ icon: "magnifying-glass", title: "Няма ястие с „" + view.q + "“.", text: "Търсете по име или съставка, и на латиница: „pitsa“, „onion“, „без лук“.", action: clearBtn("Изчисти търсенето") }) + "</div>";
    return '<div class="mn-groups">' + sect("По име", "", name, "name") + sect(r.band || "Съдържат", "", comp, "comp") + sect(r.query && r.query.exc.length ? "Без " + r.query.exc.map((w) => w.label).join(", ") : "Резултати", "", rest, "rest") +
      sect("Нямаме пълен състав", plural(unk.length, "ястие", "ястия") + " · не минават „без …“", unk, "unk") + "</div>";
  }
  function groups() {
    if (view.q.trim()) return searchView();
    let list = listAll(view.f === "draft").filter((x) => pass(x) && match(x) && (!view.c || x.cat === view.c));
    /* the dishes the draft takes off stay in their category, so they can come back */
    if (view.f !== "draft") list = list.concat(removedDishes().filter((x) => match(x) && (!view.c || x.cat === view.c) && !view.f));
    if (!list.length) {
      if (view.f === "out") return '<div class="sa-card">' + empty({ icon: "check-circle", title: "Всичко от менюто е налично днес.", text: "Когато нещо свърши, включете „Изчерпано днес“ на реда му. Кухнята може да го направи и от своя екран." }) + "</div>";
      if (view.f === "draft") return '<div class="sa-card">' + empty({ icon: "pencil-simple", title: "Черновата е празна.", text: "Сменете цена, описание или категория и промяната чака тук, докато натиснете „Публикувай“." }) + "</div>";
      return '<div class="sa-card">' + empty({ icon: "funnel", title: "Няма ястия с този избор.", action: clearBtn("Покажи всички") }) + "</div>";
    }
    const order = catIds(); list.forEach((x) => { if (!order.includes(x.cat)) order.push(x.cat); });
    return '<div class="mn-groups">' + order.map((c) => {
      const items = list.filter((x) => x.cat === c); if (!items.length) return "";
      return '<section class="mn-g" id="cat-' + esc(c) + '" aria-labelledby="h-' + esc(c) + '" data-edit-id="admin.menu.cat"><div class="mn-gh"><h2 id="h-' + esc(c) + '">' + esc(catName(c)) + "</h2><small>" + plural(items.filter((x) => stateOf(x.id) !== "del").length, "ястие", "ястия") + "</small></div>" + items.map(rowHTML).join("") + "</section>";
    }).join("") + "</div>";
  }

  function catsTab() {
    const m = M!, order = catIds(), addCats = m.opts ? m.opts.addon.cats : [];
    return '<div class="sa-sh" style="margin-top:20px"><h2>Категориите и редът им</h2><p>Влачете или „Нагоре“ / „Надолу“. Така ги вижда и сайтът.</p></div>' +
      '<div class="mn-cl" data-cl data-edit-id="admin.menu.catlist">' + order.map((c, i) => {
        const n = m.items.filter((x) => x.cat === c).length, on = addCats.includes(c), isNew = !(live && live.cats.some((z) => z.id === c)) && CH.cats.added.some((z) => z.id === c);
        return '<div class="mn-ci" draggable="true" data-cat="' + esc(c) + '"><span class="hd" aria-hidden="true" title="Влачете">' + ic("list", 22) + '<span class="no">' + (i + 1) + "</span></span><span><b>" + esc(catName(c)) + "</b><small>" + plural(n, "ястие", "ястия") + (isNew ? " · нова в черновата" : "") + "</small></span>" +
          '<div class="acts"><button class="pill pill-line" type="button" data-up' + (i ? "" : " disabled") + ' aria-label="Нагоре: ' + esc(catName(c)) + '">' + ic("caret-up", 18) + 'Нагоре</button><button class="pill pill-line" type="button" data-down' + (i < order.length - 1 ? "" : " disabled") + ' aria-label="Надолу: ' + esc(catName(c)) + '">' + ic("caret-down", 18) + "Надолу</button>" +
            (c === ADDONS ? "" : '<label class="mn-on">Добавки<span class="sa-switch"><input type="checkbox" role="switch" data-catadd aria-label="Добави при „' + esc(catName(c)) + '“"' + (on ? " checked" : "") + '><span class="tr"></span></span></label>') +
            '<button class="pill pill-line" type="button" data-rename aria-label="Преименувай: ' + esc(catName(c)) + '">' + ic("pencil-simple", 18) + "Преименувай</button>" +
            (n ? "" : '<button class="pill pill-line" type="button" data-catdel aria-label="Махни: ' + esc(catName(c)) + '">' + ic("trash", 18) + "Махни</button>") + "</div></div>";
      }).join("") + "</div>" +
      '<div style="margin-top:12px"><button class="pill pill-line pill-lg" type="button" data-newcat>' + ic("plus", 22) + "Нова категория</button></div>" +
      '<p class="mn-wait" style="margin-top:12px">' + ic("info", 18) + "<span>Категория с ястия не се маха: първо преместете ястията (в листа на ястието). Махнатата категория води (301) към „Меню“.</span></p>";
  }

  function optsTab() {
    const m = M!, o = m.opts!, addons = m.items.filter((x) => x.cat === ADDONS), dishOv = Object.keys(o.addon.dishes || {}).filter((id) => m.items.some((x) => x.id === id));
    return '<div class="mn-two" style="margin-top:20px">' +
      '<section class="mn-box" aria-labelledby="h-add" data-edit-id="admin.menu.addon"><h3 id="h-add">' + ic("plus", 22) + "„Добави“ (платени добавки)</h3>" +
        '<p class="muted">По подразбиране при пиците и бургерите. Включете категория тук или отделно ястие в листа му; ястието печели над категорията.</p>' +
        '<div class="lst">' + catIds().filter((c) => c !== ADDONS).map((c) => { const on = o.addon.cats.includes(c);
          return '<label class="li" style="cursor:pointer"><span><b>' + esc(catName(c)) + "</b><small>" + (on ? "Добавките се виждат при ястията" : "Без добавки") + '</small></span><span class="sa-switch"><input type="checkbox" role="switch" data-catadd2="' + esc(c) + '" aria-label="Добави при „' + esc(catName(c)) + '“"' + (on ? " checked" : "") + '><span class="tr"></span></span></label>'; }).join("") + "</div>" +
        (dishOv.length ? '<h3 style="font-size:17px">' + ic("fork-knife", 20) + 'Ястия по изключение</h3><div class="lst">' + dishOv.map((id) => { const x = m.items.find((z) => z.id === id)!;
          return '<div class="li"><span><b>' + esc(x.n) + "</b><small>" + (o.addon.dishes[id] ? "С добавки" : "Без добавки") + ', въпреки категорията</small></span><button class="pill pill-line" type="button" data-ovdel="' + esc(id) + '" aria-label="Като категорията: ' + esc(x.n) + '">' + ic("arrow-counter-clockwise", 18) + "Като категорията</button></div>"; }).join("") + "</div>" : "") +
        '<a class="link" href="' + aurl.preview("m=site&p=dish&d=phone") + '">' + ic("eye", 18) + "Виж ястие в сайта (след „Публикувай“)</a></section>" +
      '<section class="mn-box" aria-labelledby="h-addp" data-edit-id="admin.menu.addonprices"><h3 id="h-addp">' + ic("money", 22) + 'Цените на добавките</h3><p class="muted">Цената на добавката е цената ѝ в категория „' + esc(catName(ADDONS)) + '“: една за всички ястия с „Добави“. Сменя се в черновата.</p><div class="lst">' +
        (addons.length ? addons.map((a) => { const lv = liveDish(a.id), ch = !!lv && lv.p !== a.p;
          return '<div class="li" data-ad="' + esc(a.id) + '"><span><b>' + esc(a.n) + "</b>" + (ch ? "<small>в сайта " + fmt(lv!.p) + "</small>" : "") + '</span><span class="mn-pr"><label class="mn-pf' + (ch ? " chg" : "") + '"><span class="vh">Цена на добавка „' + esc(a.n) + '“ в евро</span><input type="text" inputmode="decimal" autocomplete="off" value="' + num(a.p) + '" data-adprice><span aria-hidden="true">€</span></label></span></div>'; }).join("")
          : '<p style="font-weight:700">Категорията „Добавки“ още е празна.</p>') + "</div></section>" +
      '<section class="mn-box off" aria-labelledby="h-swap" data-edit-id="admin.menu.swap"><h3 id="h-swap">' + ic("arrow-clockwise", 22) + "„Смени“ (например гарнитура)</h3>" +
        '<div class="mn-hid">' + ic("lock", 20) + "Скрито до новото меню</div>" +
        '<p class="muted">Групи с опции и доплата (или без), по категория или ястие. Функцията е готова; включва се с новото меню. Без измислени гарнитури и цени.</p>' +
        '<label class="li" style="display:flex; justify-content:space-between; align-items:center; gap:10px; min-height:56px"><span><b>Показвай в сайта</b><small>Изключено до новото меню</small></span><span class="sa-switch"><input type="checkbox" role="switch" disabled aria-label="Показвай „Смени“ в сайта"><span class="tr"></span></span></label>' +
        (o.swap.groups.length ? o.swap.groups.map((g) => '<div class="mn-grp"><b>' + esc(g.n) + "</b>" + g.opts.map((x) => '<span class="opt"><span>' + esc(x.n) + '</span><span class="price">' + (x.p ? "+" + fmt(x.p) : "без доплата") + "</span></span>").join("") + '<small class="muted">' + (g.cats.length ? g.cats.map((c) => esc(catName(c))).join(", ") : "Без категория") + "</small></div>").join("") : '<p style="font-weight:700">Още няма групи.</p>') +
        '<div><button class="pill pill-line" type="button" data-newgroup>' + ic("plus", 20) + "Нова група</button></div></section>" +
      "</div>";
  }

  /* ---------- drawing ---------- */
  let bar: HTMLElement | null = null;
  function draw(keepFocus = false) {
    if (loading) { body.innerHTML = skel(6, "Зареждаме менюто …"); setBar(); return; }
    if (!M) {
      body.innerHTML = isOfflineErr(loadErr) ? offlineHTML("Менюто не се зареди. Сайтът показва последното публикувано меню. Проверете връзката и опитайте пак.")
        : banner({ tone: "danger", icon: "warning", title: "Менюто не се зареди", text: "Сайтът показва последното публикувано меню. Опитайте пак.", action: '<button class="pill pill-line" type="button" data-retry>' + ic("arrow-clockwise", 20) + "Опитай пак</button>" });
      setBar(); return;
    }
    if (!M.items.length && !removedDishes().length && !M.cats.length) {
      body.innerHTML = '<div class="sa-card">' + empty({ icon: "fork-knife", title: "Менюто още е празно.", text: "Добавете първото ястие или внесете менюто от PDF или снимка. Ястията влизат в сайта с „Публикувай“.", action: '<div class="row" style="flex-wrap:wrap; justify-content:center"><button class="pill pill-red pill-lg" type="button" data-new>' + ic("plus", 22) + 'Ново ястие</button><a class="pill pill-line pill-lg" href="' + aurl.menuImport() + '">' + ic("export", 22) + "Внос на меню</a></div>" }) + "</div>";
      setBar(); return;
    }
    const sc = A.scroller, y = sc ? sc.scrollTop : 0, a = document.activeElement as HTMLElement | null, inside = !!a && body.contains(a), aid = inside && a ? a.id : "";
    const aPath = inside && a ? focusPath(a) : "";
    const panel = view.t === "cats" ? catsTab() : view.t === "opts" ? optsTab() : toolbar() + '<div class="mn-lay">' + rail() + "<div data-list>" + groups() + "</div></div>";
    body.innerHTML = (conflict ? '<div class="mn-conf">' + banner({ tone: "warn", icon: "warning-circle", title: "Някой друг промени черновата.", text: "Последната ви промяна не е записана. Заредете черновата пак и я направете отново.", action: '<button class="pill pill-ink" type="button" data-reload>' + ic("arrow-clockwise", 20) + "Зареди пак</button>" }) + "</div>" : "") +
      (!net ? offlineHTML("Показваме последно зареденото меню. Промените не се записват без връзка; „Публикувай“ чака връзка.") + '<div style="height:16px"></div>' : "") +
      "<div data-sum>" + summary() + "</div>" + tabsHTML() + '<div id="mn-tp" role="tabpanel" aria-labelledby="mt-' + (view.t || "dishes") + '">' + panel + '</div><div class="mn-pad"></div>';
    if (keepFocus) {
      if (sc) sc.scrollTop = y;
      let n: HTMLElement | null = aid ? document.getElementById(aid) : null;
      if (!n && aPath) { n = body.querySelector<HTMLElement>(aPath); if (n && (n as HTMLButtonElement).disabled) n = n.closest("[data-cat]") ? n.closest("[data-cat]")!.querySelector<HTMLElement>("[data-rename]") : null; }
      if (n) { n.focus({ preventScroll: true }); const i = n as HTMLInputElement; if (i.setSelectionRange && i.type !== "checkbox") try { i.setSelectionRange(i.value.length, i.value.length); } catch { /* ignore */ } }
    }
    if (view.t === "cats") bindCatDnD();
    setBar();
  }
  /** a selector that finds the focused control again after a redraw (the row, category or add-on it is in + what it is) */
  function focusPath(a: HTMLElement): string {
    const at = ["data-price", "data-out", "data-undel", "data-up", "data-down", "data-rename", "data-catadd", "data-catdel", "data-adprice", "data-catadd2", "data-ovdel", "data-tab", "data-f", "data-c", "data-back", "data-qtog", "data-edit", "data-newcat", "data-newgroup"].find((x) => a.hasAttribute(x));
    if (!at) return "";
    const host = a.closest<HTMLElement>("[data-id],[data-cat],[data-ad]"), hk = host ? (host.dataset.id != null ? "data-id" : host.dataset.cat != null ? "data-cat" : "data-ad") : "";
    const v = a.getAttribute(at);
    return (host ? "[" + hk + '="' + CSS.escape(host.getAttribute(hk) || "") + '"] ' : "") + (a.classList.contains("ed") ? ".ed" : at === "data-edit" ? ".mn-open" : "") + "[" + at + (v ? '="' + CSS.escape(v) + '"' : "") + "]";
  }
  function refreshRow(id: string, focusSel?: string) {
    const r = body.querySelector('.mn-row[data-id="' + CSS.escape(id) + '"]'), sm = body.querySelector("[data-sum]"), x = dish(id);
    if (!r || !sm || !x) { draw(true); return; }
    const tmp = document.createElement("div"); tmp.innerHTML = rowHTML(x); const n = tmp.firstElementChild as HTMLElement; r.replaceWith(n); sm.innerHTML = summary();
    const rl = body.querySelector(".mn-rail"); if (rl) rl.outerHTML = rail();
    const fl = body.querySelector(".mn-flt"); if (fl) fl.innerHTML = fltHTML();
    setBar();
    if (focusSel) { const f = n.querySelector<HTMLElement>(focusSel); if (f) f.focus({ preventScroll: true }); }
  }
  function drawList() {
    const box = body.querySelector("[data-list]"); if (!box) { draw(true); return; }
    box.innerHTML = groups();
    const sc = body.querySelector("[data-schips]"); if (sc) sc.innerHTML = schipsHTML();
    const cl = body.querySelector<HTMLElement>("[data-qclr]"); if (cl) cl.hidden = !view.q;
    body.querySelectorAll<HTMLElement>(".mn-flt [data-f]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === view.f)));
    body.querySelectorAll<HTMLElement>("[data-c]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.c === view.c)));
  }

  /* the draft bar: "Чернова: N промени · Откажи · Публикувай" (data-pbar: the frame lifts the toast and the round "Молив") */
  function setBar() {
    if (!bar) {
      bar = document.createElement("div"); bar.className = "mn-pub"; bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Черновата на менюто"); bar.setAttribute("data-edit-id", "admin.menu.pubbar"); bar.setAttribute("data-pbar", "");
      A.col!.appendChild(bar);
      bar.addEventListener("click", (e) => { const t = e.target as Element; if (t.closest("[data-review]")) reviewSheet(); else if (t.closest("[data-discard]")) discard(); });
    }
    const n = M && !loading ? CH.count : 0;
    bar.hidden = !n || conflict; bar.classList.toggle("on", !bar.hidden);
    bar.innerHTML = n ? '<span class="tx">Чернова: ' + plural(n, "промяна", "промени") + '</span><button class="pill pill-line" type="button" data-discard>' + ic("x", 18) + 'Откажи</button><button class="pill pill-red" type="button" data-review>' + ic("paper-plane-right", 20) + "Публикувай</button>" : "";
  }

  /* ---------- actions ---------- */
  const rowOf = (el: Element) => { const r = el.closest<HTMLElement>("[data-id]"); return r ? r.dataset.id! : ""; };
  function flash(id: string) { const r = body.querySelector('.mn-row[data-id="' + CSS.escape(id) + '"]'); if (!r) return; r.classList.add("flash"); setTimeout(() => r.classList.remove("flash"), 1400); }
  const setDish = (m: Menu, id: string, fn: (x: Dish) => void) => { const x = m.items.find((z) => z.id === id); if (x) fn(x); };

  function savePrice(inp: HTMLInputElement): boolean {
    const id = rowOf(inp), x = dish(id), v = parsePrice(inp.value), lab = inp.closest(".mn-pf")!, small = document.getElementById("pe-" + id);
    if (!x || !small) return true;
    if (isNaN(v) || v <= 0) { lab.setAttribute("aria-invalid", "true"); small.hidden = false; small.className = "err"; small.textContent = "Напишете цена като 10,22."; return false; }
    lab.removeAttribute("aria-invalid"); small.className = "";
    if (Math.abs(v - x.p) < 0.001) { inp.value = num(x.p); refreshRow(id); return true; }
    const txt = "цена на „" + x.n + "“ " + fmt(x.p) + " → " + fmt(v);
    edit(txt, (m) => setDish(m, id, (d) => { d.p = v; }), () => flash(id), id);
    return true;
  }

  body.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-out]")) { const id = rowOf(t), x = dish(id); if (x) setOut(id, t.checked, x.n, "[data-out]"); return; }
    if (t.matches("[data-catadd], [data-catadd2]")) {
      const c = t.dataset.catadd2 || t.closest<HTMLElement>("[data-cat]")!.dataset.cat!, on = t.checked;
      edit("„Добави“ " + (on ? "при „" : "без „") + catName(c) + "“", (m) => { const a = m.opts!.addon; a.cats = a.cats.filter((z) => z !== c); if (on) a.cats.push(c); },
        () => { const n = body.querySelector<HTMLElement>(t.dataset.catadd2 ? '[data-catadd2="' + CSS.escape(c) + '"]' : '[data-cat="' + CSS.escape(c) + '"] [data-catadd]'); if (n) n.focus({ preventScroll: true }); });
      return;
    }
    if (t.id === "mn-ts") { view.t = t.value; syncHash(); draw(); const n = body.querySelector<HTMLElement>("#mn-ts"); if (n) n.focus({ preventScroll: true }); }
  });
  body.addEventListener("keydown", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-price]")) { if (e.key === "Enter") { e.preventDefault(); if (savePrice(t)) t.blur(); } else if (e.key === "Escape") { const x = dish(rowOf(t)); if (x) t.value = num(x.p); t.blur(); } }
    if (t.matches("[data-adprice]") && e.key === "Enter") { e.preventDefault(); t.blur(); }
    if (t.matches('[role="tab"]') && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { const tabs = Array.from(body.querySelectorAll<HTMLElement>('[role="tab"]')); let i = tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : -1); i = (i + tabs.length) % tabs.length; tabs[i].click(); }
  });
  body.addEventListener("focusout", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-adprice]") && t.isConnected) {
      const aid = t.closest<HTMLElement>("[data-ad]")!.dataset.ad!, a = dish(aid); if (!a) return;
      const v = parsePrice(t.value);
      if (isNaN(v) || v <= 0) { t.value = num(a.p); toast("Напишете цена като 1,53."); return; }
      if (Math.abs(v - a.p) < 0.001) return;
      edit("добавка „" + a.n + "“ " + fmt(v), (m) => setDish(m, aid, (d) => { d.p = v; }));
      return;
    }
    if (!t.matches("[data-price]") || !t.isConnected) return;
    const x = dish(rowOf(t)); if (!x || t.value === num(x.p)) return;
    savePrice(t);
  });
  body.addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.id === "mn-q") { view.q = t.value; syncHash(); drawList(); } });
  body.addEventListener("click", (e) => {
    const tg = e.target as Element; let t: HTMLElement | null;
    if (tg.closest("[data-retry]")) { start(); return; }
    if (tg.closest("[data-reload]")) { hideToast(); start(true); return; }
    if (tg.closest("[data-rollback]")) { rollback(); return; }
    if ((t = tg.closest<HTMLElement>("[data-tab]"))) { view.t = t.dataset.tab || ""; syncHash(); draw(); const n = body.querySelector<HTMLElement>('[data-tab="' + view.t + '"]'); if (n) n.focus({ preventScroll: true }); return; }
    if ((t = tg.closest<HTMLElement>("[data-f]"))) {
      view.f = t.dataset.f || ""; if (view.t) view.t = ""; syncHash();
      if (t.classList.contains("mn-k") || !body.querySelector("[data-list]")) { draw(true); const l = body.querySelector(".mn-bar"); if (l) l.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); } else drawList();
      return;
    }
    if ((t = tg.closest<HTMLElement>("[data-c]"))) {
      view.c = t.dataset.c || ""; syncHash(); drawList();
      if (t.closest(".mn-rail") && A.scroller) { const g = body.querySelector<HTMLElement>("[data-list]")!; A.scroller.scrollTo({ top: Math.max(0, g.getBoundingClientRect().top - A.scroller.getBoundingClientRect().top + A.scroller.scrollTop - 110), behavior: "smooth" }); }
      return;
    }
    if ((t = tg.closest<HTMLElement>("[data-back]"))) { const id = t.dataset.back!, x = outList().find((z) => z.id === id); setOut(id, false, x ? x.n : id); return; }
    if (tg.closest("[data-qclr]")) { view.q = ""; const qi = body.querySelector<HTMLInputElement>("#mn-q")!; qi.value = ""; syncHash(); drawList(); qi.focus(); return; }
    if ((t = tg.closest<HTMLElement>("[data-qtog]"))) { const w = t.dataset.qtog!; view.q = qToggle(view.q, w); body.querySelector<HTMLInputElement>("#mn-q")!.value = view.q; syncHash(); drawList(); const nq = body.querySelector<HTMLElement>('[data-qtog="' + CSS.escape(w) + '"]'); if (nq) nq.focus(); return; }
    if (tg.closest("[data-clear]")) { view.q = ""; view.f = ""; view.c = ""; syncHash(); draw(true); return; }
    if ((t = tg.closest<HTMLElement>("[data-undel]"))) {
      const id = rowOf(t), x = liveDish(id); if (!x) return;
      edit("„" + x.n + "“ остава в менюто", (m) => {
        if (!m.cats.some((c) => c.id === x.cat)) { const lc = live!.cats.find((c) => c.id === x.cat); if (lc) m.cats.push(clone(lc)); }
        /* "out" in the live menu is today's switch (not the draft's data): it stays outside the draft */
        const d = clone(x); d.t = d.t.filter((k) => k !== "out"); m.items.push(d);
      }, () => flash(id));
      return;
    }
    if ((t = tg.closest<HTMLElement>("[data-edit]"))) { openDish(rowOf(t)); return; }
    if ((t = tg.closest<HTMLElement>("[data-up], [data-down]"))) { moveCat(t.closest<HTMLElement>("[data-cat]")!.dataset.cat!, t.hasAttribute("data-up") ? -1 : 1); return; }
    if ((t = tg.closest<HTMLElement>("[data-rename]"))) { catSheet(t.closest<HTMLElement>("[data-cat]")!.dataset.cat!); return; }
    if (tg.closest("[data-newcat]")) { catSheet(null); return; }
    if ((t = tg.closest<HTMLElement>("[data-catdel]"))) {
      const c = t.closest<HTMLElement>("[data-cat]")!.dataset.cat!, nm = catName(c);
      edit("махната категория „" + nm + "“", (m) => { m.cats = m.cats.filter((z) => z.id !== c); if (m.opts) m.opts.addon.cats = m.opts.addon.cats.filter((z) => z !== c); });
      return;
    }
    if ((t = tg.closest<HTMLElement>("[data-ovdel]"))) { const oid = t.dataset.ovdel!, x = dish(oid); edit("„Добави“ при „" + (x ? x.n : oid) + "“ като категорията", (m) => { delete m.opts!.addon.dishes[oid]; }); return; }
    if (tg.closest("[data-newgroup]")) { groupSheet(); return; }
  });
  /* "Ново ястие" is in the head of the page (outside the body) */
  document.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-new]")) { if (M) openDish(null); } });

  function discard() {
    if (!CH.count || !M) return;
    confirm({ title: "Да откажем ли черновата?", text: "Отпадат " + plural(CH.count, "промяна", "промени") + ". Сайтът остава, както е публикуван.", ok: "Откажи черновата", danger: true, icon: "x" }, async () => {
      const keep = clone(M!);
      try {
        const r = await menuApi.discardDraft(ver);
        ver = r.version; CH = r.changes; M = r.menu; draw(true);
        toast("Черновата е отказана", { undo: () => { const cur = clone(M!); M = keep; draw(true); save(cur, () => toast("Черновата е върната")); } });
      } catch (e) { onFail(e, keep); }
    });
  }

  /* ---------- categories: order (drag and buttons), name, new ---------- */
  function moveCat(c: string, dir: number) {
    const order = catIds(), i = order.indexOf(c), j = i + dir; if (j < 0 || j >= order.length) return;
    edit("„" + catName(c) + "“ на място " + (j + 1), (m) => { const [x] = m.cats.splice(i, 1); m.cats.splice(j, 0, x); }, () => {
      const b = body.querySelector<HTMLButtonElement>('[data-cat="' + CSS.escape(c) + '"] ' + (dir < 0 ? "[data-up]" : "[data-down]"));
      (b && !b.disabled ? b : body.querySelector<HTMLElement>('[data-cat="' + CSS.escape(c) + '"] [data-rename]'))!.focus({ preventScroll: true });
    });
  }
  function bindCatDnD() {
    let src = "";
    body.querySelectorAll<HTMLElement>(".mn-ci").forEach((el) => {
      el.addEventListener("dragstart", (e) => { src = el.dataset.cat!; e.dataTransfer!.setData("text/plain", src); e.dataTransfer!.effectAllowed = "move"; el.classList.add("dragging"); });
      el.addEventListener("dragend", () => { el.classList.remove("dragging"); body.querySelectorAll(".mn-ci.drop").forEach((z) => z.classList.remove("drop")); });
      el.addEventListener("dragover", (e) => { e.preventDefault(); el.classList.add("drop"); });
      el.addEventListener("dragleave", () => el.classList.remove("drop"));
      el.addEventListener("drop", (e) => {
        e.preventDefault(); const from = e.dataTransfer!.getData("text/plain") || src, to = el.dataset.cat!; if (!from || from === to) return;
        const order = catIds(); order.splice(order.indexOf(from), 1); order.splice(order.indexOf(to), 0, from);
        edit("„" + catName(from) + "“ на място " + (order.indexOf(from) + 1), (m) => { m.cats = order.map((id) => m.cats.find((z) => z.id === id)!).filter(Boolean); });
      });
    });
  }
  function catSheet(c: string | null) {
    hideToast();
    const s = sheet({ title: c ? "Преименувай категорията" : "Нова категория", focus: "#mc-n", html: '<div class="field"><label for="mc-n">Име</label><input class="input" id="mc-n" value="' + esc(c ? catName(c) : "") + '" autocomplete="off" aria-describedby="mc-n-e"><span class="err" id="mc-n-e" hidden></span></div><p class="muted" style="margin:12px 0 0; font-size:15px">' + (c ? "Адресът на категорията в сайта не се сменя." : "Новата категория е най-долу; преместете я с „Нагоре“. Празна категория не се показва в сайта, докато в нея няма ястие.") + "</p>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + (c ? "Запази" : "Добави") + "</button>" });
    s.foot!.querySelector<HTMLElement>("[data-x]")!.onclick = s.close;
    s.foot!.querySelector<HTMLElement>("[data-ok]")!.onclick = () => {
      const i = s.body.querySelector<HTMLInputElement>("#mc-n")!, n = i.value.replace(/\s+/g, " ").trim(), er = s.body.querySelector<HTMLElement>("#mc-n-e")!;
      const dup = catIds().some((z) => z !== c && catName(z).toLowerCase() === n.toLowerCase());
      if (n.length < 2 || n.length > 60 || dup) { i.setAttribute("aria-invalid", "true"); er.hidden = false; er.textContent = dup ? "Вече има категория с това име." : n.length > 60 ? "Името на категорията е до 60 знака." : "Напишете име, например „Пици на пещ“."; i.focus(); return; }
      s.close();
      if (c) edit("категория „" + n + "“", (m) => { const z = m.cats.find((q) => q.id === c); if (z) z.n = n; });
      else edit("нова категория „" + n + "“", (m) => { m.cats.push({ id: tmpId(), n, course: "main" }); });
    };
  }
  function groupSheet() {
    hideToast(); let rows = 2;
    const rowH = (i: number) => '<div class="mn-optrow" data-or><div class="field"><label for="mg-o' + i + '">Опция ' + (i + 1) + '</label><input class="input" id="mg-o' + i + '" autocomplete="off"></div><div class="field"><label for="mg-p' + i + '">Доплата</label><div class="mn-pin"><input class="input" id="mg-p' + i + '" inputmode="decimal" placeholder="0,00" autocomplete="off"><span class="u" aria-hidden="true">€</span></div></div><button class="iconbtn" type="button" data-orx aria-label="Махни опция ' + (i + 1) + '">' + ic("x", 20) + "</button></div>";
    const s = sheet({ title: "Нова група „Смени“", focus: "#mg-n", html: '<div class="mn-form"><div class="mn-hid">' + ic("lock", 20) + 'Скрито до новото меню</div><div class="field"><label for="mg-n">Име на групата</label><input class="input" id="mg-n" autocomplete="off" placeholder="Например: Гарнитура" aria-describedby="mg-n-e"><span class="err" id="mg-n-e" hidden></span></div>' +
      '<div class="mn-opts" data-opts>' + rowH(0) + rowH(1) + '</div><div><button class="pill pill-line" type="button" data-addrow>' + ic("plus", 20) + 'Още опция</button></div><span class="err" data-oerr hidden></span>' +
      '<div class="grp"><span class="label">Категории</span><div class="mn-chips" role="group" aria-label="Категории">' + catIds().filter((c) => c !== ADDONS).map((c) => '<button class="chip" type="button" data-gc="' + esc(c) + '" aria-pressed="false">' + esc(catName(c)) + "</button>").join("") + "</div></div>" +
      '<p class="muted" style="margin:0; font-size:15px">Доплата 0 = смяна без доплата. Групата се вижда в сайта, когато „Смени“ се включи с новото меню.</p></div>',
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Запази групата</button>" });
    const b = s.body;
    b.addEventListener("click", (e) => {
      const tg = e.target as Element; let t: HTMLElement | null;
      if ((t = tg.closest<HTMLElement>("[data-gc]"))) t.setAttribute("aria-pressed", String(t.getAttribute("aria-pressed") !== "true"));
      if (tg.closest("[data-addrow]")) { b.querySelector("[data-opts]")!.insertAdjacentHTML("beforeend", rowH(rows++)); b.querySelector<HTMLElement>("#mg-o" + (rows - 1))!.focus(); }
      if ((t = tg.closest<HTMLElement>("[data-orx]")) && b.querySelectorAll("[data-or]").length > 1) t.closest("[data-or]")!.remove();
    });
    s.foot!.querySelector<HTMLElement>("[data-x]")!.onclick = s.close;
    s.foot!.querySelector<HTMLElement>("[data-ok]")!.onclick = () => {
      const n = b.querySelector<HTMLInputElement>("#mg-n")!, en = b.querySelector<HTMLElement>("#mg-n-e")!, eo = b.querySelector<HTMLElement>("[data-oerr]")!; let bad = false;
      const opts = Array.from(b.querySelectorAll("[data-or]")).map((r) => { const ins = r.querySelectorAll("input"), nm = ins[0].value.trim(), pr = ins[1].value.trim(), v = pr ? parsePrice(pr) : 0; if (nm && isNaN(v)) bad = true; return nm ? { n: nm, p: v } : null; }).filter(Boolean) as { n: string; p: number }[];
      if (n.value.trim().length < 2) { n.setAttribute("aria-invalid", "true"); en.hidden = false; en.textContent = "Напишете име на групата."; n.focus(); return; }
      en.hidden = true; n.removeAttribute("aria-invalid");
      if (opts.length < 2 || bad) { eo.hidden = false; eo.textContent = bad ? "Доплатата е като 1,50 или празно." : "Добавете поне две опции."; return; }
      const g = { id: "g-" + Math.random().toString(36).slice(2, 8), n: n.value.trim(), opts, cats: Array.from(b.querySelectorAll<HTMLElement>("[data-gc][aria-pressed=true]")).map((x) => x.dataset.gc!) };
      s.close();
      edit("група „" + g.n + "“ (скрита до новото меню)", (m) => { m.opts!.swap.groups.push(g); });
    };
  }

  /* ---------- the dish sheet ---------- */
  function openDish(id: string | null) {
    if (!M) return;
    hideToast();
    const x0 = id ? dish(id) : null; if (id && !x0) return;
    if (id && stateOf(id) === "del") return;
    const x: Dish = x0 ? clone(x0) : { id: "", n: "", desc: "", cat: view.c && catIds().includes(view.c) ? view.c : catIds()[0] || "", course: "main", comp: "", g: "", p: 0, t: [], al: [], noOnion: false, share: false };
    const isLive = !!(id && liveDish(id)), o = M.opts!.addon, ov = id && own(o.dishes, id) ? (o.dishes[id] ? "on" : "off") : "cat";
    const catOpts = catIds().map((c) => '<option value="' + esc(c) + '"' + (c === x.cat ? " selected" : "") + ">" + esc(catName(c)) + "</option>").join("");
    const html = '<form class="mn-form" novalidate data-edit-id="admin.menu.sheet">' +
      '<div class="mn-file">' + (x.photo ? '<img class="ph" src="' + esc(x.photo) + '" alt="Снимката на ястието">' : id ? picHTML(x) : '<div class="pic" role="img" aria-label="Още няма снимка"></div>') +
        '<div class="in"><span class="label">Снимка</span><input class="vh mn-in" id="mf-ph" type="file" accept="image/jpeg,image/png,image/webp" aria-describedby="mf-ph-h"><label class="pill pill-ink" for="mf-ph" style="justify-self:start">' + ic("image", 20) + 'Избери снимка</label><span class="help" id="mf-ph-h" style="font-size:14px; color:var(--muted)">' + (x.photo ? "Снимката е качена. Изберете друга, за да я смените." : "JPG, PNG или WebP до 5 MB. Дотогава в сайта е илюстрацията. " + missing("снимки от фотосесията")) + "</span></div></div>" +
      '<div class="field"><label for="mf-n">Име</label><input class="input" id="mf-n" name="n" value="' + esc(x.n) + '" autocomplete="off" aria-describedby="mf-n-e"><span class="err" id="mf-n-e" hidden></span></div>' +
      '<div class="field"><label for="mf-desc">Описание <span class="muted" style="font-weight:600">(по желание)</span></label><textarea class="input" id="mf-desc" name="desc" rows="2" placeholder="Едно-две изречения за сайта" aria-describedby="mf-desc-e">' + esc(x.desc || "") + '</textarea><span class="err" id="mf-desc-e" hidden></span></div>' +
      '<div class="field"><label for="mf-cat">Категория</label><select class="input" id="mf-cat" name="cat">' + catOpts + "</select></div>" +
      '<div class="field"><label for="mf-comp">Състав</label><textarea class="input" id="mf-comp" name="comp" rows="3" placeholder="Например: домат, краставица, сирене">' + esc(x.comp || "") + '</textarea><span class="help">Не е задължително и не спира „Публикувай“. Без състав и алергени ястието е в сайта с бележка „Нямаме пълен състав, попитайте ни“ и не излиза във филтрите „без …“.</span></div>' +
      '<div class="two"><div class="field"><label for="mf-p">Цена' + (x.per100 ? " за 100 гр." : "") + '</label><div class="mn-pin"><input class="input" id="mf-p" name="p" inputmode="decimal" autocomplete="off" value="' + (x.p ? num(x.p) : "") + '" placeholder="10,22" aria-describedby="mf-p-e"><span class="u" aria-hidden="true">€</span></div><span class="err" id="mf-p-e" hidden></span></div>' +
        '<div class="field"><label for="mf-g">Грамаж</label><input class="input" id="mf-g" name="g" value="' + esc(x.per100 ? "за 100 гр." : x.g || "") + '" placeholder="350 гр."' + (x.per100 ? " disabled" : "") + "></div></div>" +
      '<div class="grp"><span class="label">Етикети</span><div class="mn-chips" role="group" aria-label="Етикети">' + TAGS.map((t) => '<button class="chip" type="button" data-tag="' + t[0] + '" aria-pressed="' + x.t.includes(t[0] as Dish["t"][number]) + '">' + ic(t[2], 18) + t[1] + "</button>").join("") + "</div>" +
        '<span class="mn-wait">' + ic("info", 18) + "<span>„Вегетарианско“ и „Люто“ са от състава и чакат потвърждение от кухнята.</span></span></div>" +
      '<div class="grp"><span class="label">Алергени <span class="muted" style="font-weight:600">(14 по ЕС)</span></span><div class="mn-alg" role="group" aria-label="Алергени">' + ALLERGENS.map((a) => '<button class="chip" type="button" data-al="' + a[0] + '" aria-pressed="' + x.al.includes(a[0] as Dish["al"][number]) + '">' + ic(a[2], 18) + a[1] + "</button>").join("") + "</div>" +
        '<span class="mn-wait">' + ic("warning-circle", 18) + "<span>Чакат потвърждение от кухнята.</span></span></div>" +
      '<div class="grp"><span class="label" id="mf-addl">„Добави“ (платени добавки)</span><div class="seg mn-seg" role="group" aria-labelledby="mf-addl">' + ([["cat", "Като категорията"], ["on", "Да"], ["off", "Не"]] as [string, string][]).map((z) => '<button type="button" data-ov="' + z[0] + '" aria-pressed="' + (ov === z[0]) + '">' + z[1] + "</button>").join("") + '</div><span class="help" data-ovh style="font-size:14px; color:var(--muted)"></span></div>' +
      '<div class="grp"><label class="label" for="mf-sw">„Смени“</label><select class="input" id="mf-sw" disabled><option>Скрито до новото меню</option></select></div>' +
      (isLive ? '<div class="mn-sw"><span><b>Изчерпано днес</b><br><span class="muted" style="font-size:15px">Действа веднага, до полунощ</span></span><span class="sa-switch"><input type="checkbox" role="switch" name="out" aria-label="Изчерпано днес"' + (isOut(id!) ? " checked" : "") + '><span class="tr"></span></span></div>' : "") +
      '<div class="mn-3d"><b>' + ic("cube", 20) + "3D модел</b>" + soonTag() + "</div>" +
      (id ? '<button class="pill pill-line pill-lg pill-block" type="button" data-rm>' + ic("trash", 20) + "Махни от менюто</button>" : "") +
      "</form>";
    const s = sheet({ title: id ? x.n : "Ново ястие", html, focus: id ? "[data-close]" : "#mf-n",
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Запази в черновата</button>" });
    const f = s.body.querySelector<HTMLFormElement>("form")!, F = (n: string) => f.querySelector<HTMLInputElement>('[name="' + n + '"]')!;
    let pick = ov, photo = x.photo || "", uploading: Promise<void> | null = null, photoErr = "";
    const ovHelp = () => { const inCat = o.cats.includes(F("cat").value); f.querySelector<HTMLElement>("[data-ovh]")!.textContent = pick === "cat" ? (inCat ? "Категорията е с добавки, затова и ястието." : "Категорията е без добавки.") : pick === "on" ? "Ястието е с добавки, каквото и да е при категорията." : "Ястието е без добавки, каквото и да е при категорията."; };
    ovHelp();
    f.addEventListener("click", (e) => {
      const tg = e.target as Element, b = tg.closest<HTMLElement>("[data-tag],[data-al]"); if (b) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true"));
      const v = tg.closest<HTMLElement>("[data-ov]"); if (v) { pick = v.dataset.ov!; f.querySelectorAll<HTMLElement>("[data-ov]").forEach((z) => z.setAttribute("aria-pressed", String(z === v))); ovHelp(); }
      if (tg.closest("[data-rm]") && id) removeDish(id, s);
    });
    F("cat").addEventListener("change", ovHelp);
    const outSw = f.querySelector<HTMLInputElement>('[name="out"]');
    if (outSw && id) outSw.addEventListener("change", () => setOut(id, outSw.checked, x.n));
    /* the photo: the preview at once, the upload right away (uploadMedia); the url goes into the dish on "Запази" */
    f.querySelector<HTMLInputElement>("#mf-ph")!.addEventListener("change", function () {
      const file = this.files && this.files[0], help = f.querySelector<HTMLElement>("#mf-ph-h")!; if (!file) return;
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) { help.innerHTML = '<span class="err">Изберете снимка JPG, PNG или WebP.</span>'; return; }
      const prev = URL.createObjectURL(file), old = f.querySelector(".mn-file .pic, .mn-file .ph");
      if (old) old.outerHTML = '<img class="ph" src="' + prev + '" alt="Новата снимка на ястието">';
      help.textContent = "Качваме „" + file.name + "“ …"; photoErr = "";
      uploading = menuApi.uploadMedia(file).then((m) => { photo = m.url; help.textContent = "Качена: " + file.name + ". Влиза в сайта с „Публикувай“."; },
        (e) => { photoErr = isOfflineErr(e) ? "Няма връзка: снимката не е качена. Опитайте пак." : e instanceof ApiError ? e.message : "Снимката не се качи. Опитайте пак."; help.innerHTML = '<span class="err">' + esc(photoErr) + "</span>"; }).finally(() => { uploading = null; });
    });
    function err(name: string, msg: string) { const i = F(name), el = s.body.querySelector<HTMLElement>("#mf-" + name + "-e")!; if (msg) { i.setAttribute("aria-invalid", "true"); el.hidden = false; el.textContent = msg; } else { i.removeAttribute("aria-invalid"); el.hidden = true; } return !msg; }
    s.foot!.querySelector<HTMLElement>("[data-x]")!.onclick = s.close;
    s.foot!.querySelector<HTMLElement>("[data-ok]")!.onclick = async () => {
      const n = F("n").value.replace(/\s+/g, " ").trim(), p = parsePrice(F("p").value), desc = F("desc").value.trim();
      const ok1 = err("n", n.length < 2 ? "Напишете името на ястието." : n.length > 120 ? "Името е до 120 знака." : ""), ok2 = err("p", isNaN(p) || p <= 0 ? "Напишете цена като 10,22." : ""), ok3 = err("desc", desc.length > 600 ? "Описанието е до 600 знака." : "");
      if (!ok1) { F("n").focus(); return; } if (!ok2) { F("p").focus(); return; } if (!ok3) { F("desc").focus(); return; }
      if (uploading) { s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!.disabled = true; await uploading; s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!.disabled = false; }
      const t = Array.from(f.querySelectorAll<HTMLElement>("[data-tag][aria-pressed=true]")).map((b) => b.dataset.tag!), al = Array.from(f.querySelectorAll<HTMLElement>("[data-al][aria-pressed=true]")).map((b) => b.dataset.al!);
      const next = { n, desc, cat: F("cat").value, comp: F("comp").value.trim(), p, g: x.per100 ? x.g : F("g").value.trim(), t: (x.t.includes("out") ? [...t, "out"] : t) as Dish["t"], al: al as Dish["al"] };
      const key = id || tmpId();
      s.close();
      const txt = id ? "„" + n + "“" + (next.p !== x.p ? " (цена " + fmt(x.p) + " → " + fmt(p) + ")" : "") : "ново ястие „" + n + "“";
      edit(txt, (m) => {
        if (!id) m.items.push({ id: key, course: (m.cats.find((c) => c.id === next.cat) || { course: "main" }).course, noOnion: false, share: false, ...next, ...(photo ? { photo } : {}) } as Dish);
        else setDish(m, id, (d) => { Object.assign(d, next); if (photo) d.photo = photo; else delete d.photo; if (d.cat !== x.cat) d.course = (m.cats.find((c) => c.id === d.cat) || d).course as Dish["course"]; });
        const ds = m.opts!.addon.dishes; if (pick === "cat") delete ds[key]; else ds[key] = pick === "on";
      }, () => { if (!id) { view.f = ""; view.q = ""; view.c = ""; view.t = ""; syncHash(); draw(true); } const r = body.querySelector('.mn-row[data-id="' + CSS.escape(key) + '"]'); if (r) r.scrollIntoView({ block: "center" }); flash(key); });
    };
  }
  function removeDish(id: string, s: { close(): void }) {
    const x = dish(id); if (!x) return;
    const isNew = !liveDish(id), cn = catName(x.cat);
    confirm({ title: "Да махнем ли „" + x.n + "“?", text: isNew ? "Ястието още не е в сайта: махаме го от черновата." : "Махането влиза в черновата. След „Публикувай“ ястието изчезва от сайта, а старият му адрес води (301) към категорията „" + esc(cn) + "“.", ok: "Махни от менюто", danger: true, icon: "trash" }, () => {
      s.close();
      edit("махнато „" + x.n + "“", (m) => { m.items = m.items.filter((z) => z.id !== id); delete m.opts!.addon.dishes[id]; delete m.opts!.swap.dishes[id]; });
    });
  }

  /* ---------- before "Публикувай": what will happen (the changes from the server) ---------- */
  function reviewSheet() {
    if (!M) return;
    hideToast();
    if (!CH.count) { const e = sheet({ title: "Публикувай менюто", html: empty({ icon: "check-circle", title: "Няма промени за публикуване.", text: "Черновата е празна: сайтът е точно както е публикуван. Сменете цена, ястие или категория и те ще чакат тук." }), foot: '<button class="pill pill-ink pill-lg" type="button" data-x>Затвори</button>' }); e.foot!.querySelector<HTMLElement>("[data-x]")!.onclick = e.close; return; }
    const d = CH.dishes, cs = new Set<string>();
    d.added.forEach((z) => cs.add(z.cat)); d.removed.forEach((z) => cs.add(z.cat)); d.changed.forEach((z) => { const x = dish(z.id); if (x) cs.add(x.cat); });
    const catChange = CH.cats.added.length + CH.cats.renamed.length + CH.cats.removed.length > 0 || CH.cats.order;
    const pages = d.added.length + d.changed.length + d.removed.length + (catChange ? M.cats.length : cs.size) + 1;
    const li = (title: string, sub: string) => "<li><span>" + esc(title) + "<small>" + sub + "</small></span></li>";
    const part = (title: string, icn: string, n: number, rows: string) => (n ? "<div><h3>" + ic(icn, 20) + title + " · " + n + "</h3><ul>" + rows + "</ul></div>" : "");
    const fieldTxt = (f: MenuChanges["dishes"]["changed"][number]["fields"][number]) => f.key === "p" ? "цена " + esc(f.from) + " → " + esc(f.to) : f.key === "cat" ? "категория „" + esc(f.to) + "“" : f.key === "photo" ? "снимка" : f.key === "n" ? "име (беше „" + esc(f.from) + "“)" : esc(f.label.toLowerCase());
    const toName = (r: MenuChanges["dishes"]["removed"][number]) => r.to === "/menu/" ? "Меню" : catName(r.cat, live) || catName(r.cat);
    const newCompless = d.added.concat(d.changed.map((z) => ({ id: z.id, n: z.n, cat: "" }))).filter((z) => CH.noComp.some((q) => q.id === z.id));
    const html = '<div class="mn-sum2" data-edit-id="admin.menu.review">' +
      '<div class="what">' + ic("arrow-clockwise", 22) + "<span><b>" + (PS && PS.mode === "demo" ? "В системата сайтът се пресглобява сам:" : "Сайтът се пресглобява сам:") + "</b> " + plural(pages, "страница", "страници") + " (ястията, категориите и менюто), sitemap.xml, JSON-LD и адресите." + (PS && PS.mode === "demo" ? " В демото сайтът не се пресглобява; на сървъра се пресглобява сам." : "") + "</span></div>" +
      (newCompless.length ? '<div class="what">' + ic("info", 22) + "<span>" + plural(newCompless.length, "ястие", "ястия") + " без състав: " + esc(newCompless.slice(0, 3).map((z) => z.n).join(", ")) + (newCompless.length > 3 ? " и още " + (newCompless.length - 3) : "") + ". В сайта са с бележка „Нямаме пълен състав, попитайте ни“; не излизат във филтрите „без …“. Не спира публикуването.</span></div>" : "") +
      part("Нови ястия", "plus", d.added.length, d.added.map((z) => { const x = dish(z.id); return li(z.n, esc(catName(z.cat)) + (x ? " · " + fmt(x.p) : "")); }).join("")) +
      part("Променени", "pencil-simple", d.changed.length, d.changed.map((z) => li(z.n, z.fields.map(fieldTxt).join(", "))).join("")) +
      part("Махнати", "trash", d.removed.length, d.removed.map((z) => li(z.n, "старият адрес води (301) към „" + esc(toName(z)) + "“")).join("")) +
      (catChange ? "<div><h3>" + ic("list", 20) + "Категории</h3><ul>" +
        CH.cats.added.map((c) => li("Нова: „" + c.n + "“", CH.cats.empty.some((q) => q.id === c.id) ? "празна: не се показва в сайта, докато в нея няма ястие" : "")).join("") +
        CH.cats.renamed.map((c) => li("„" + c.from + "“ → „" + c.to + "“", "адресът не се сменя")).join("") +
        CH.cats.removed.map((c) => li("Махната: „" + c.n + "“", "старият адрес води (301) към „Меню“")).join("") +
        (CH.cats.order ? li("Ред", esc(M.cats.map((c) => c.n).join(" · "))) : "") + "</ul></div>" : "") +
      (CH.opts.length ? "<div><h3>" + ic("plus", 20) + "„Добави“ и „Смени“</h3><ul>" + CH.opts.map((t) => li(t, "")).join("") + "</ul></div>" : "") +
      (!net ? offlineHTML("Публикуването чака връзка. Черновата е запазена.") : "") + "</div>";
    const s = sheet({ title: "Публикувай менюто", html, foot: '<button class="pill pill-line pill-lg" type="button" data-x>Назад</button><button class="pill pill-red pill-lg" type="button" data-ok' + (!net ? " disabled" : "") + ">" + ic("paper-plane-right", 22) + "Публикувай</button>" });
    s.foot!.querySelector<HTMLElement>("[data-x]")!.onclick = s.close;
    const okB = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    okB.onclick = async () => {
      okB.disabled = true; okB.textContent = "Публикуваме …";
      await chain;
      try {
        const r = await menuApi.publish(ver);
        PS = r; s.close();
        await reloadData();
        draw(true);
        const top = body.querySelector(".mn-pubinfo"); if (top) top.scrollIntoView({ block: "center" });
        toast("Публикувано в " + hmOf(r.at || new Date()) + (r.by ? " от " + r.by : "") + "." + (r.mode === "demo" ? " В демото сайтът не се пресглобява." : " Сайтът се пресглобява."), { action: { label: "Виж в сайта", href: aurl.preview("m=site&p=menu&d=phone") }, ms: 6000 });
        poll();
      } catch (e) {
        okB.disabled = !net; okB.innerHTML = ic("paper-plane-right", 22) + "Публикувай";
        if (e instanceof ApiError && e.code === "conflict") { s.close(); conflict = true; draw(true); return; }
        if (isOfflineErr(e)) { net = false; draw(true); }
        toast(failText(e));
      }
    };
  }
  async function reloadData() {
    try { const [dd, l] = await Promise.all([menuApi.draft(), api.menu()]); M = dd.menu; ver = dd.version; CH = dd.changes; live = l; readOuts(l); } catch { /* keep */ }
    try { PS = await menuApi.state(); } catch { /* keep */ }
  }
  /* the rebuild: while queued / building, ask again every 2.5 s and redraw only the line */
  let pollT: ReturnType<typeof setTimeout> | undefined;
  function poll() {
    clearTimeout(pollT);
    if (!PS || PS.mode === "demo" || !(PS.build.state === "queued" || PS.build.state === "building")) return;
    pollT = setTimeout(async () => {
      try { PS = await menuApi.state(); } catch { /* try again */ }
      const el = body.querySelector("[data-pubinfo]"); if (el) el.outerHTML = pubInfo() || "<span data-pubinfo></span>";
      poll();
    }, 2500);
  }
  function rollback() {
    if (!PS || !PS.prev) return;
    confirm({ title: "Да върнем ли предишното меню?", text: "Сайтът се връща към менюто отпреди последното „Публикувай“" + (PS.prev.at ? " (" + esc(ago(PS.prev.at)) + ")" : "") + ". Черновата остава. Ако размислите, същият бутон връща сегашното.", ok: "Върни предишното меню", danger: true, icon: "arrow-counter-clockwise" }, async () => {
      try {
        const r = await menuApi.rollback(PS!.version); PS = r;
        await reloadData(); draw(true);
        toast("Предишното меню е върнато." + (r.mode === "demo" ? " В демото сайтът не се пресглобява." : " Сайтът се пресглобява."));
        poll();
      } catch (e) {
        if (e instanceof ApiError && e.code === "conflict") { toast(e.message); await reloadData(); draw(true); return; }
        toast(failText(e));
      }
    });
  }

  /* ---------- the connection ---------- */
  window.addEventListener("offline", () => { net = false; if (M) draw(true); });
  window.addEventListener("online", () => { net = true; if (M) draw(true); });

  async function start(again = false) {
    loading = true; if (!again) draw(); else { body.innerHTML = skel(6, "Зареждаме менюто …"); }
    await load(); draw();
    if (again && M) toast("Черновата е заредена пак.");
    poll();
  }
  await start();
  if (M) {
    if (H.d && dish(H.d) && stateOf(H.d) !== "del") setTimeout(() => openDish(H.d), 300);
    else if (H.review) setTimeout(reviewSheet, 300);
  }
}
