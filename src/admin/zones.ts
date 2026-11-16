/* /admin/zones/: "Зони за доставка" (design/pages-admin/zones.html, approved, 1:1; decision 16.11.2026, part 3).
   - The six quarters of the site (core/zones.ts, the data in "site:zones"): free or paid with the fee, the minimum order,
     the time (15-90 min), the hours (never after 21:00), "Доставяме" on / off. The fee of Горубляне and Гара Искър and every
     minimum order stay [ЛИПСВА] until somebody writes them in.
   - The stylised map is the schematic of /dostavka/ (the same shapes, hatched for paid, grey for off, keyboard reachable);
     "Нарисувай зона" is "Скоро". "Натоварено" and its minutes are not here: a link to "Настройки".
   - Every change goes into the core at once (the price and the checks of an order) and rebuilds the site (sales-site.ts);
     the demo says that the site is not rebuilt. "Отмени" in the toast writes the old values back.
   States: loading (skeleton), error, no connection (load and write), empty, conflict (409: loaded again), no rights (A.mount). */
import "sc-icons:eye,check-circle,money,clock,moped,info,sliders-horizontal,pencil-simple,check,x,map-trifold,arrow-clockwise,warning";
import { zonesApi, ApiError, type ZonesView, type ZonePatch } from "../client/api-admin-3.ts";
import { A, mount, can, toast, sheet, skel, failHTML, empty, missing, esc, ic, fmt } from "./a.ts";
import { aurl } from "./routes.ts";
import { loadSite, siteLine, rebuildNote, afterWrite, bindRebuild } from "./sales-site.ts";

type Row = ZonesView["zones"][number];

/* the schematic of /dostavka/ (src/pages/dostavka/_delivery.ts, the same shapes): not to scale, no streets */
const SHAPES: Record<string, { d: string; lx: number; ly: number; two?: [string, string] }> = {
  "gara-iskar": { d: "M24 92 L112 100 L124 156 L110 214 L44 206 L16 150 Z", lx: 66, ly: 146, two: ["Гара", "Искър"] },
  "npz-iskar": { d: "M114 34 L212 26 L236 66 L226 110 L156 114 L112 100 Z", lx: 172, ly: 72 },
  "druzhba-1": { d: "M112 100 L156 114 L226 110 L236 166 L214 214 L110 214 L124 156 Z", lx: 172, ly: 164 },
  "druzhba-2": { d: "M236 66 L304 72 L330 116 L314 206 L214 214 L236 166 L226 110 Z", lx: 274, ly: 112 },
  busmantsi: { d: "M330 116 L398 132 L404 196 L362 232 L314 206 Z", lx: 362, ly: 172 },
  gorublyane: { d: "M150 236 L304 226 L330 266 L290 294 L176 294 L140 266 Z", lx: 236, ly: 262 },
};
const PIN = { x: 272, y: 168 }; /* Siracusa: Дружба 2, срещу бл. 311 (the place on the schematic is approximate) */
const OPEN = "10:00", LAST = "21:00", KITCHEN = "22:30";

const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const failText = (e: unknown) => (isOffline(e) ? "Няма връзка. Промяната не е записана; опитайте пак, щом връзката се върне." : e instanceof ApiError ? e.message : "Не успяхме. Опитайте пак.");
const mins = (t: string) => { const p = t.split(":"); return +p[0] * 60 + +p[1]; };
const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
const num = (p: number | null) => (p == null ? "" : (Math.round(p * 100) / 100).toFixed(2).replace(".", ","));
function eur(s: string): number | null { const v = String(s || "").replace(/\s/g, "").replace("€", "").replace(",", "."); if (!v) return null; return /^\d{1,3}(\.\d{1,2})?$/.test(v) ? +v : NaN; }
const kind = (z: Pick<Row, "on" | "free">) => (!z.on ? "off" : z.free ? "free" : "paid");
const feeHTML = (z: Pick<Row, "free" | "fee">) => (z.free ? "Безплатно" : z.fee != null ? fmt(z.fee) : missing("в €"));
const minHTML = (z: Pick<Row, "min">) => (z.min != null ? fmt(z.min) : missing("в €"));
function tagHTML(z: Pick<Row, "on" | "free">) {
  const k = kind(z);
  return '<span class="ztag ' + k + '">' + (k === "off" ? ic("x", 16) + "Не доставяме" : k === "free" ? ic("check", 16) + "Безплатна" : ic("money", 16) + "Платена") + "</span>";
}
function readHash(): Record<string, string> { const o: Record<string, string> = {}; location.hash.slice(1).split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return o; }
function writeHash(o: Record<string, string>) { const h = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&"); try { history.replaceState(history.state, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ } }

export async function initZones(): Promise<void> {
  const body = await mount({ section: "zones", title: "Зони за доставка", docTitle: "Зони за доставка",
    sub: "Кварталите, в които доставяме, с такса, минимална поръчка, време и часове. Клиентът вижда същата карта на страницата „Доставка“.",
    actions: '<a class="pill pill-ink pill-lg" href="' + aurl.preview("m=site&p=delivery&d=phone") + '">' + ic("eye", 22) + "Виж в сайта</a>" });
  if (!body) return;
  const root = body;
  root.innerHTML = skel(5, "Зареждаме зоните …");

  let V: ZonesView | null = null, err: unknown = null, net = true, sel: string | null = readHash().z || null;
  const bySlug = (s: string) => (V ? V.zones.find((z) => z.slug === s) || null : null);

  async function load() {
    try { [V] = await Promise.all([zonesApi.list(), loadSite()]); err = null; net = true; }
    catch (e) { err = e; }
    draw();
    if (V && sel && bySlug(sel)) setTimeout(() => pick(sel!, true), 200);
  }

  /* ---------- the map ---------- */
  function mapSVG(list: Row[]) {
    let dots = ""; for (let y = 14; y < 300; y += 22) for (let x = 12; x < 420; x += 22) dots += '<circle class="grid-dot" cx="' + x + '" cy="' + y + '" r="1.3"/>';
    const g = list.filter((z) => SHAPES[z.slug]).map((z) => {
      /* the name of the button is its visible text ("Дружба 2 25 мин"), the kind of delivery is its description */
      const s = SHAPES[z.slug], k = kind(z), sub = k === "off" ? "изключена" : z.etaMin + " мин";
      const label = s.two ? '<text class="zl" x="' + s.lx + '" y="' + (s.ly - 8) + '">' + s.two[0] + '</text><text class="zl" x="' + s.lx + '" y="' + (s.ly + 11) + '">' + s.two[1] + '</text><text class="zs" x="' + s.lx + '" y="' + (s.ly + 30) + '">' + sub + "</text>"
        : '<text class="zl" x="' + s.lx + '" y="' + (s.ly + 2) + '">' + esc(z.n) + '</text><text class="zs" x="' + s.lx + '" y="' + (s.ly + 21) + '">' + sub + "</text>";
      return '<g class="z ' + k + (sel === z.slug ? " on" : "") + '" data-zone="' + z.slug + '" tabindex="0" role="button"><desc>' + (k === "off" ? "не доставяме" : z.free ? "безплатна доставка" : "платена доставка") + '</desc><path class="f" d="' + s.d + '"/>' + (z.free ? "" : '<path class="h" d="' + s.d + '"/>') + '<path class="sel" d="' + s.d + '"/>' + label + "</g>";
    }).join("");
    return '<svg class="map" viewBox="0 0 420 304" role="group" aria-labelledby="zn-mt"><title id="zn-mt">Схема на зоните за доставка</title>' +
      '<defs><pattern id="zn-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.2" height="7" style="fill:var(--z-hatch)"/></pattern></defs>' + dots +
      '<g class="air" aria-hidden="true"><path d="M246 6 L414 6 L414 112 L344 110 L314 60 L248 52 Z"/><text x="352" y="44">Летище</text><text x="352" y="62">София</text></g>' +
      '<path class="edge" d="M10 86 L108 26 L240 18 L310 64 L340 106 L410 124 L414 202 L366 244 L336 270 L296 302 L170 302 L132 270 L144 228 L104 222 L38 214 L8 150 Z"/>' + g +
      '<g class="pin" aria-hidden="true"><circle class="dotp" cx="' + PIN.x + '" cy="' + PIN.y + '" r="9"/><g class="tag"><rect x="' + (PIN.x - 40) + '" y="' + (PIN.y + 16) + '" width="80" height="26" rx="13"/><text x="' + PIN.x + '" y="' + (PIN.y + 33.5) + '">Siracusa</text></g></g></svg>';
  }

  function summary() {
    const s = V!.summary, on = V!.zones.filter((z) => z.on), eta = on.length ? Math.min(...on.map((z) => z.etaMin)) + " - " + Math.max(...on.map((z) => z.etaMin)) : "0";
    const from = on.length ? on.map((z) => z.from).sort()[0] : OPEN;
    return '<div class="sa-shell" data-edit-id="admin.zones.summary"><div class="zn-sum">' +
      '<div class="zn-k"><span class="lb">' + ic("check-circle", 20) + 'Безплатна доставка</span><span class="v">' + s.free + '</span><span class="ft">' + (s.free === 1 ? "квартал" : "квартала") + "</span></div>" +
      '<div class="zn-k"><span class="lb">' + ic("money", 20) + 'Платена доставка</span><span class="v">' + s.paid + '</span><span class="ft">такса: ' + (s.feeMissing ? missing("в €") : "въведена") + "</span></div>" +
      '<div class="zn-k"><span class="lb">' + ic("clock", 20) + 'Време</span><span class="v">' + eta + '</span><span class="ft">минути, по квартали</span></div>' +
      '<div class="zn-k"><span class="lb">' + ic("moped", 20) + 'Доставка</span><span class="v">' + (on.length ? "до " + s.until : "спряна") + '</span><span class="ft">' + (on.length ? "от " + from + ", всеки ден" : "във всички квартали") + "</span></div></div></div>" +
      siteLine("zones", repaintLine) +
      '<div class="zn-note" data-edit-id="admin.zones.busy"><span>' + ic("info", 20) + "<span>„Натоварено“ и минутите при натоварване (+20 мин) са в „Настройки“. Те важат за всички квартали.</span></span>" +
      (can("settings") ? '<a class="pill pill-line" href="' + aurl.section("settings") + '">' + ic("sliders-horizontal", 20) + "Към настройките</a>" : "") + "</div>";
  }
  function repaintLine() { const el = root.querySelector("[data-site-line]"); if (el) el.outerHTML = siteLine("zones"); }

  function zoneHTML(z: Row) {
    return '<article class="zn-z' + (sel === z.slug ? " on" : "") + (z.on ? "" : " off") + '" id="z-' + z.slug + '" data-slug="' + z.slug + '" data-edit-id="admin.zones.zone">' +
      '<div class="zn-zh"><h3><button type="button" data-pick="' + z.slug + '">' + esc(z.n) + "</button></h3>" + tagHTML(z) + "</div>" +
      '<dl class="zn-facts"><div><dt>Такса</dt><dd>' + feeHTML(z) + "</dd></div><div><dt>Минимална поръчка</dt><dd>" + minHTML(z) + "</dd></div><div><dt>Време</dt><dd>около " + z.etaMin + " мин</dd></div><div><dt>Часове</dt><dd>" + z.from + " - " + z.to + "</dd></div></dl>" +
      '<div class="zn-zf"><label class="zn-on">Доставяме<span class="sa-switch"><input type="checkbox" role="switch" data-on aria-label="Доставяме в ' + esc(z.n) + '"' + (z.on ? " checked" : "") + '><span class="tr"></span></span></label>' +
      '<button class="pill pill-line" type="button" data-edit aria-label="Промени ' + esc(z.n) + '">' + ic("pencil-simple", 20) + "Промени</button></div></article>";
  }

  function draw(keep = false) {
    if (!V) { root.innerHTML = err ? failHTML(err, isOffline(err) ? "Зоните не се заредиха. Сайтът проверява адресите по последните запазени зони." : "Не успяхме да заредим зоните. Сайтът проверява адресите по последните запазени зони.") : skel(5, "Зареждаме зоните …"); return; }
    const sc = A.scroller, y = sc ? sc.scrollTop : 0, zs = V.zones;
    const mapCard = '<section class="zn-mapc" aria-labelledby="zn-mh" data-edit-id="admin.zones.map"><div class="zn-mh"><h2 id="zn-mh">Картата</h2><button class="pill pill-line zn-draw" type="button" disabled>' + ic("pencil-simple", 20) + "Нарисувай зона · Скоро</button></div>" +
      '<ul class="legend"><li><span class="sw free"></span>Безплатна</li><li><span class="sw paid"></span>Платена</li><li><span class="sw off"></span>Не доставяме</li></ul>' + mapSVG(zs) +
      '<p class="zn-mapnote">' + ic("info", 18) + "<span>Схема без мащаб, като на страницата „Доставка“. Изберете квартал на картата или в списъка.</span></p></section>";
    const list = !zs.length ? '<div class="sa-card">' + empty({ icon: "map-trifold", title: "Още няма зони за доставка.", text: "Без зона сайтът приема само „Вземи от място“. Рисуването на зона на картата идва скоро; дотогава зоните се добавят от главния админ." }) + "</div>"
      : '<div class="zn-list">' + zs.map(zoneHTML).join("") + "</div>";
    root.innerHTML = '<div class="zn">' + (!net ? failHTML(new ApiError("offline", ""), "Показваме последно заредените зони. Промените не се записват без връзка; опитайте пак, щом връзката се върне.") + '<div style="height:16px"></div>' : "") +
      summary() + '<div class="zn-lay">' + mapCard + list + "</div></div>";
    if (keep && sc) sc.scrollTop = y;
  }

  function pick(slug: string, scroll: boolean) {
    sel = sel === slug && !scroll ? null : slug; writeHash(sel ? { z: sel } : {});
    root.querySelectorAll<SVGGElement>(".map .z").forEach((g) => g.classList.toggle("on", g.dataset.zone === sel));
    root.querySelectorAll<HTMLElement>(".zn-z").forEach((c) => c.classList.toggle("on", c.dataset.slug === sel));
    if (sel && scroll) { const c = root.querySelector("#z-" + sel); if (c) c.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }
  }

  /* one write: the view comes back from the core; "Отмени" writes the old fields back */
  async function save(slug: string, patch: ZonePatch, text: string, undo: ZonePatch | null, version?: number): Promise<boolean> {
    try { V = await zonesApi.save(slug, patch, version); net = true; }
    catch (e) {
      if (e instanceof ApiError && e.code === "conflict") { toast(e.message); V = null; draw(); await load(); return false; }
      if (isOffline(e)) net = false;
      draw(true); toast(failText(e)); return false;
    }
    draw(true); afterWrite();
    toast(text + "." + rebuildNote(), undo ? { undo: () => { void save(slug, undo, "Отменено: " + text, null); } } : {});
    return true;
  }

  root.addEventListener("click", (e) => {
    const t = e.target as Element; let x: HTMLElement | null;
    if (t.closest('[data-sa="retry"]')) { e.stopPropagation(); V = null; err = null; draw(); void load(); return; }
    if ((x = t.closest<HTMLElement>(".map .z"))) { pick(x.dataset.zone!, true); return; }
    if ((x = t.closest<HTMLElement>("[data-pick]"))) { pick(x.dataset.pick!, false); return; }
    if ((x = t.closest<HTMLElement>("[data-edit]"))) { edit(x.closest<HTMLElement>("[data-slug]")!.dataset.slug!); return; }
  }, true);
  root.addEventListener("keydown", (e) => { const g = (e.target as Element).closest && (e.target as Element).closest<HTMLElement>(".map .z"); if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(g.dataset.zone!, true); } });
  root.addEventListener("change", async (e) => {
    const t = e.target as HTMLInputElement; if (!t.matches("[data-on]")) return;
    const slug = t.closest<HTMLElement>("[data-slug]")!.dataset.slug!, z = bySlug(slug)!, on = t.checked;
    const txt = (on ? "Доставяме отново в " : "Спряна доставка в ") + z.n;
    await save(slug, { on }, txt, { on: !on });
    const nt = root.querySelector<HTMLElement>("#z-" + slug + " [data-on]"); if (nt) nt.focus({ preventScroll: true });
  });
  bindRebuild(root);

  /* ---------- the sheet: one quarter ---------- */
  function times(from: number, to: number) { const o: string[] = []; for (let m = 600; m <= 1260; m += 30) if (m >= from && m <= to) o.push(hhmm(m)); return o; }
  function edit(slug: string) {
    const z = bySlug(slug); if (!z) return;
    if (sel !== slug) pick(slug, false);
    const etas: number[] = []; for (let m = 15; m <= 90; m += 5) etas.push(m);
    const opt = (list: string[], cur: string) => (list.includes(cur) ? list : [...list, cur].sort()).map((t) => "<option" + (t === cur ? " selected" : "") + ">" + t + "</option>").join("");
    const html = '<form class="zn-form" novalidate data-edit-id="admin.zones.sheet">' +
      '<div class="zn-sw"><span><b>Доставяме в квартала</b><small>Изключено: адресът се отказва с „Изберете „Вземи от място““</small></span><span class="sa-switch"><input type="checkbox" role="switch" name="on" aria-label="Доставяме в квартала"' + (z.on ? " checked" : "") + '><span class="tr"></span></span></div>' +
      '<div class="zn-sw"><span><b>Безплатна доставка</b><small>По решение: Дружба 1 и 2, НПЗ Искър, Бусманци</small></span><span class="sa-switch"><input type="checkbox" role="switch" name="free" aria-label="Безплатна доставка"' + (z.free ? " checked" : "") + '><span class="tr"></span></span></div>' +
      '<div class="two"><div class="field" data-feef><label for="zf-fee">Такса</label><div class="zn-eu"><input class="input" id="zf-fee" name="fee" inputmode="decimal" autocomplete="off" value="' + num(z.fee) + '" placeholder="[ЛИПСВА]" aria-describedby="zf-fee-e"><span class="u" aria-hidden="true">€</span></div><span class="err" id="zf-fee-e" hidden></span></div>' +
        '<div class="field"><label for="zf-min">Минимална поръчка</label><div class="zn-eu"><input class="input" id="zf-min" name="min" inputmode="decimal" autocomplete="off" value="' + num(z.min) + '" placeholder="[ЛИПСВА]" aria-describedby="zf-min-e"><span class="u" aria-hidden="true">€</span></div><span class="err" id="zf-min-e" hidden></span></div></div>' +
      '<p class="help zn-help" style="margin:-8px 0 0">Празно поле остава ' + missing("от собственика") + " в сайта и в количката.</p>" +
      '<div class="field"><label for="zf-eta">Време за доставка</label><select class="input" id="zf-eta" name="etaMin">' + etas.map((m) => '<option value="' + m + '"' + (m === z.etaMin ? " selected" : "") + ">около " + m + " мин</option>").join("") + '</select><span class="help">Клиентът вижда „около ' + z.etaMin + " мин“; при „Натоварено“ +20 мин.</span></div>" +
      '<div class="two"><div class="field"><label for="zf-from">От</label><select class="input" id="zf-from" name="from">' + opt(times(600, 1230), z.from) + "</select></div>" +
        '<div class="field"><label for="zf-to">До</label><select class="input" id="zf-to" name="to" aria-describedby="zf-to-e">' + opt(times(630, 1260), z.to) + '</select><span class="err" id="zf-to-e" hidden></span></div></div>' +
      '<span class="help zn-help" style="margin-top:-10px">Доставката е до ' + LAST + " (кухнята приема до " + KITCHEN + ").</span>" +
      '<p class="zn-prevh">' + ic("eye", 18) + 'Така го вижда клиентът</p><div class="zn-prev" data-prev aria-live="polite"></div></form>';
    const s = sheet({ title: z.n, html, foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Запази</button>" });
    const f = s.body.querySelector<HTMLFormElement>("form")!;
    const el = <T extends HTMLElement>(n: string) => f.elements.namedItem(n) as unknown as T;
    const read = () => ({ on: el<HTMLInputElement>("on").checked, free: el<HTMLInputElement>("free").checked, fee: eur(el<HTMLInputElement>("fee").value), min: eur(el<HTMLInputElement>("min").value),
      etaMin: +el<HTMLSelectElement>("etaMin").value, from: el<HTMLSelectElement>("from").value, to: el<HTMLSelectElement>("to").value });
    function prev() {
      const v = read(), d = { n: z!.n, on: v.on, free: v.free, fee: v.fee != null && isNaN(v.fee) ? null : v.fee, min: v.min != null && isNaN(v.min) ? null : v.min };
      f.querySelector<HTMLElement>("[data-feef]")!.hidden = v.free;
      f.querySelector("[data-prev]")!.innerHTML = '<div class="t"><b>' + esc(z!.n) + "</b>" + tagHTML(d) + "</div>" + (v.on ? '<dl style="margin:0"><div class="kv"><dt>Доставка</dt><dd>' + feeHTML(d) + '</dd></div><div class="kv"><dt>Минимална поръчка</dt><dd>' + minHTML(d) + '</dd></div><div class="kv"><dt>Време</dt><dd>около ' + v.etaMin + ' мин</dd></div><div class="kv"><dt>Часове</dt><dd>' + v.from + " - " + v.to + "</dd></div></dl>"
        : '<p style="margin:0">Адресът е извън зоната ни. Изберете „Вземи от място“.</p>');
    }
    prev(); f.addEventListener("input", prev); f.addEventListener("change", prev);
    function er(name: string, m: string) { const i = el<HTMLElement>(name), e = s.body.querySelector<HTMLElement>("#zf-" + (name === "etaMin" ? "eta" : name) + "-e"); if (!e) return !m; if (m) { i.setAttribute("aria-invalid", "true"); e.hidden = false; e.textContent = m; } else { i.removeAttribute("aria-invalid"); e.hidden = true; } return !m; }
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const okB = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    okB.onclick = async () => {
      const v = read();
      const ok = [er("fee", !v.free && v.fee != null && isNaN(v.fee) ? "Напишете таксата като 2,50 или оставете празно." : ""), er("min", v.min != null && isNaN(v.min) ? "Напишете сумата като 15,00 или оставете празно." : ""),
        er("to", mins(v.to) <= mins(v.from) ? "Краят е след началото." : mins(v.to) > mins(LAST) ? "Доставката е до " + LAST + "." : "")];
      const bad = ["fee", "min", "to"].filter((_, i) => !ok[i]); if (bad.length) { el<HTMLElement>(bad[0]).focus(); return; }
      const patch: ZonePatch = { on: v.on, free: v.free, fee: v.free ? null : v.fee, min: v.min, etaMin: v.etaMin, from: v.from, to: v.to };
      const chg: string[] = [], back: ZonePatch = {};
      if (v.on !== z!.on) { chg.push(v.on ? "доставяме" : "спряна"); back.on = z!.on; }
      if (v.free !== z!.free) { chg.push(v.free ? "безплатна" : "платена"); back.free = z!.free; back.fee = z!.fee; }
      if (!v.free && v.fee !== z!.fee) { chg.push("такса " + (v.fee == null ? "[ЛИПСВА]" : fmt(v.fee))); back.fee = z!.fee; }
      if (v.min !== z!.min) { chg.push("мин. поръчка " + (v.min == null ? "[ЛИПСВА]" : fmt(v.min))); back.min = z!.min; }
      if (v.etaMin !== z!.etaMin) { chg.push("около " + v.etaMin + " мин"); back.etaMin = z!.etaMin; }
      if (v.from !== z!.from || v.to !== z!.to) { chg.push(v.from + " - " + v.to); back.from = z!.from; back.to = z!.to; }
      if (!chg.length) { s.close(); toast("Нищо не е променено."); return; }
      okB.disabled = true;
      try { V = await zonesApi.save(slug, patch, V!.version); net = true; }
      catch (e) {
        okB.disabled = false;
        if (e instanceof ApiError && e.fields) {
          const map: Record<string, string> = { fee: "fee", min: "min", etaMin: "etaMin", from: "to", to: "to" };
          const first = Object.keys(e.fields).map((k) => map[k]).filter(Boolean)[0];
          Object.keys(e.fields).forEach((k) => { if (map[k]) er(map[k], e.fields![k]); });
          if (first) { el<HTMLElement>(first).focus(); return; }
        }
        if (e instanceof ApiError && e.code === "conflict") { s.close(); toast(e.message); V = null; draw(); await load(); return; }
        if (isOffline(e)) { net = false; draw(true); }
        toast(failText(e)); return;
      }
      s.close(); draw(true); afterWrite();
      const txt = z!.n + ": " + chg.join(", ");
      toast(txt + "." + rebuildNote(), { undo: () => { void save(slug, back, "Отменено: " + txt, null); } });
    };
  }

  await load();
}
