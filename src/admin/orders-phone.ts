/* „Нова поръчка по телефон“ (главен админ, собственик, управител; решения 15.11.2026 „Персоналът без количка“ и 16.11.2026
   „основа на част 3“; design/pages-admin/orders.html, README-2 „Промени 15.11“). Отделна форма в лист, не клиентската
   количка: телефон и име, доставка или вземане, адрес и зона, час („Възможно най-скоро“ или „По-късно днес“), ястията с
   търсенето на сайта (src/lib/search.ts), бройки, бележка, плащане. Сумите се смятат с price() от src/lib/pricing.ts (същото
   правило като ядрото) върху живото меню (api.menu(): изчерпаното днес е с „Изчерпано днес“ и без „Добави“); окончателната
   цена и всички проверки са на ядрото (ordersAdminApi.phoneOrder, канал „phone“, без маркетинг, бонус и код).
   Зарежда се при първото отваряне на формата (менюто е извън JS на страницата „Поръчки“). */
import "sc-icons:phone,moped,storefront,map-pin,info,clock,magnifying-glass,x,plus,minus,check,chef-hat,warning-circle";
import { api } from "../client/api.ts";
import { ordersAdminApi, zonesApi, ApiError, type OrderDetail } from "../client/api-admin-3.ts";
import { setMenu, items, byId, catById, lunchIsToday, isOut, type Dish } from "../lib/data.ts";
import { price, pickupToday } from "../lib/pricing.ts";
import { state } from "../lib/status.ts";
import { minutes } from "../lib/time.ts";
import { searchDishes, chips as qChips, toggle as qToggle } from "../lib/search.ts";
import { ZONES, RESTAURANT, ORDER_RULES, type Zone } from "../lib/consts.ts";
import type { Cart } from "../lib/cart.ts";
import { sheet, banner, missing, esc, ic, fmt } from "./a.ts";

const pad = (n: number) => String(n).padStart(2, "0");
const hm = (m: number) => pad(Math.floor(m / 60)) + ":" + pad(m % 60);
const PAY: [string, string][] = [["cash", "В брой"], ["card", "Карта при получаване"], ["voucher", "Ваучер"]];

let menuReady: Promise<void> | null = null;
/** the live menu once per page (sold out today, the published lunch menu); without it the built one stays */
function liveMenu(): Promise<void> {
  if (!menuReady) menuReady = api.menu().then((m) => { setMenu(m); }).catch(() => { menuReady = null; });
  return menuReady || Promise.resolve();
}
let zonesReady: Promise<Zone[]> | null = null;
function liveZones(): Promise<Zone[]> {
  if (!zonesReady) zonesReady = zonesApi.live().then((z) => z.filter((x) => x.on !== false)).catch(() => { zonesReady = null; return ZONES.slice(); });
  return zonesReady;
}

interface Line { id: string; q: number }
interface Form { tel: string; name: string; mode: "delivery" | "pickup"; zone: string; addr: string; when: "asap" | "later"; slot: string; lines: Line[]; note: string; pay: string; q: string }

export async function phoneOrderSheet(o: { onDone: (d: OrderDetail, slot: string) => void }): Promise<void> {
  const [, zones] = await Promise.all([liveMenu(), liveZones()]);
  const mnow = () => minutes();
  const m0 = mnow();
  const F: Form = { tel: "", name: "", mode: state().delivery ? "delivery" : "pickup", zone: "", addr: "", when: "asap", slot: "", lines: [], note: "", pay: "cash", q: "" };
  const closedText = () => { const m = mnow(); return m < 600 ? "Кухнята отваря в 10:00: тогава приемаме и поръчки по телефон." : m >= 1350 ? "Кухнята вече не приема поръчки за днес. Приемаме отново утре от 10:00." : ""; };
  const lunchOn = lunchIsToday();
  const POOL: Dish[] = items.filter((x) => x.cat !== ORDER_RULES.addonCat).concat(lunchOn ? Object.keys(byId).map((k) => byId[k]).filter((x) => x.lunch) : []);
  const zoneOf = (n: string) => zones.find((z) => z.n === n) || null;
  const cart = (): Cart => ({ mode: F.mode, lines: F.lines.map((l) => ({ key: l.id, id: l.id, q: l.q, mods: [], extra: 0 })) });
  const P = () => price(cart(), { zone: F.mode === "delivery" ? zoneOf(F.zone) : null });
  const isLunch = (x?: Dish) => !!x && !!x.lunch;
  function slots(): string[] {
    const m = mnow(), p = P();
    if (F.mode === "delivery") { const out: string[] = []; const step = ORDER_RULES.slotStep; for (let t = Math.ceil((m + p.etaMin) / step) * step; t <= ORDER_RULES.preorderDeliveryUntil; t += step) out.push(hm(t)); return out; }
    return pickupToday({ earliest: p.earliest, mode: "pickup" }).slots.map(hm);
  }
  const feeLabel = (z: Zone) => (z.free ? "безплатна" : z.fee != null ? "такса " + fmt(z.fee) : "такса [ЛИПСВА]");

  /* ---------- the parts ---------- */
  function resultsHTML(): string {
    const q = F.q.trim();
    if (!q) return '<p class="muted" style="margin:6px 2px 0; font-size:15px">Напишете поне 2 букви: име на ястие или съставка, например „лук“, „без глутен“, „pitsa“.</p>';
    const r = searchDishes(POOL, q), ch = qChips(q);
    const li = (x: Dish) => {
      const out = isOut(x), l = F.lines.find((z) => z.id === x.id);
      const ctl = out ? "" : l
        ? '<span class="counter"><button type="button" data-pd="' + esc(x.id) + '" data-d="-1" aria-label="Едно по-малко: ' + esc(x.n) + '">' + ic("minus", 20) + "</button><output>" + l.q + '</output><button type="button" data-pd="' + esc(x.id) + '" data-d="1" aria-label="Още едно: ' + esc(x.n) + '">' + ic("plus", 20) + "</button></span>"
        : '<button class="pill pill-soft" type="button" data-padd="' + esc(x.id) + '" aria-label="Добави ' + esc(x.n) + '">' + ic("plus", 18) + "Добави</button>";
      return '<div class="po-it"><span class="nm">' + esc(x.n) + "<small>" + (isLunch(x) ? "Обедно меню" : esc(catById[x.cat] ? catById[x.cat].n : "")) + (x.g ? " · " + esc(x.g) : "") + (out ? ' · <b class="po-out">Изчерпано днес</b>' : "") + '</small></span><span class="price">' + fmt(x.p) + "</span>" + ctl + "</div>";
    };
    let html = ch.length ? '<div class="po-chips" role="group" aria-label="Съставки">' + ch.map((c) => '<button class="chip" type="button" data-ptog="' + esc(c.word) + '" aria-pressed="' + c.without + '">' + (c.without ? "без " + esc(c.label) : esc(c.label) + " " + ic("x", 16)) + '<span class="vh">' + (c.without ? ", смени на „" + esc(c.label) + "“" : ", смени на „без " + esc(c.label) + "“") + "</span></button>").join("") + "</div>" : "";
    const any = r.name.length + r.comp.length + r.rest.length + r.unknown.length;
    if (!any) return html + '<p class="muted" style="margin:6px 2px 0">Няма ястие с „' + esc(q) + "“.</p>";
    html += r.name.slice(0, 8).map(li).join("") + (r.name.length > 8 ? '<p class="po-more">и още ' + (r.name.length - 8) + ": уточнете думата</p>" : "");
    if (r.comp.length) html += '<p class="po-band">' + esc(r.band) + "</p>" + r.comp.slice(0, 8).map(li).join("");
    if (r.rest.length) html += r.rest.slice(0, 8).map(li).join("");
    if (r.unknown.length) html += '<p class="po-band">Нямаме пълен състав, попитайте кухнята</p>' + r.unknown.slice(0, 5).map(li).join("");
    return html;
  }
  function linesHTML(): string {
    if (!F.lines.length) return '<p class="muted" style="margin:0">Още няма ястия.</p>';
    const p = P();
    return F.lines.map((l, i) => {
      const x = byId[l.id], row = p.rows.find((r) => r.key === l.id), lw = !!row && row.disc > 0;
      return '<div class="po-line"><span class="nm">' + esc(x ? x.n : l.id) + (lw ? "<small>обедно, -30% при вземане</small>" : "") + (row && row.out ? '<small class="po-out">Изчерпано днес</small>' : "") + '</span><span class="counter"><button type="button" data-pq="' + i + '" data-d="-1" aria-label="Едно по-малко: ' + esc(x ? x.n : l.id) + '">' + ic("minus", 20) + "</button><output>" + l.q + '</output><button type="button" data-pq="' + i + '" data-d="1" aria-label="Още едно: ' + esc(x ? x.n : l.id) + '">' + ic("plus", 20) + '</button></span><span class="price">' + fmt(row ? row.tot : 0) + "</span></div>";
    }).join("");
  }
  function sumHTML(): string {
    const p = P();
    return '<div class="kv"><dt>Ястия</dt><dd>' + fmt(p.sub) + "</dd></div>" + (p.disc ? '<div class="kv"><dt>Обедно -30% при вземане</dt><dd>-' + fmt(p.disc) + "</dd></div>" : "") +
      (F.mode === "delivery" ? '<div class="kv"><dt>Доставка</dt><dd>' + (!F.zone ? '<span class="muted">изберете зона</span>' : p.fee === 0 ? "Безплатна" : p.fee == null ? missing("такса в €") : fmt(p.fee)) + "</dd></div>" : "") +
      '<div class="kv po-tot"><dt>Общо</dt><dd>' + fmt(p.total) + (F.mode === "delivery" && F.zone && p.fee == null ? " + такса" : "") + "</dd></div>";
  }
  function formHTML(): string {
    const sl = slots(), dlOk = state().delivery, closed = closedText();
    return '<form class="po" novalidate data-edit-id="admin.orders.phone">' +
      (closed ? banner({ tone: "warn", icon: "clock", title: "Кухнята е затворена", text: esc(closed) }) : "") +
      '<div data-perr></div>' +
      '<fieldset class="po-sec"><legend>Клиент</legend><div class="two"><div class="field"><label for="po-tel">Телефон</label><input class="input" id="po-tel" type="tel" inputmode="tel" autocomplete="off" placeholder="0888 12 34 56" value="' + esc(F.tel) + '" aria-describedby="po-tel-e"><span class="err" id="po-tel-e" hidden></span></div>' +
        '<div class="field"><label for="po-name">Име</label><input class="input" id="po-name" autocomplete="off" value="' + esc(F.name) + '" aria-describedby="po-name-e"><span class="err" id="po-name-e" hidden></span></div></div></fieldset>' +
      '<fieldset class="po-sec"><legend>Как</legend><div class="seg" role="group" aria-label="Доставка или вземане"><button type="button" data-pmode="delivery" aria-pressed="' + (F.mode === "delivery") + '"' + (dlOk ? "" : " disabled") + ">" + ic("moped", 20) + 'Доставка</button><button type="button" data-pmode="pickup" aria-pressed="' + (F.mode === "pickup") + '">' + ic("storefront", 20) + "Вземане</button></div>" +
        (dlOk || closed ? "" : '<p class="po-note">' + ic("info", 18) + "<span>Доставката приключи за днес в 21:00. Поръчки за вземане до 22:30.</span></p>") +
        (F.mode === "delivery"
          ? '<div class="field"><label for="po-addr">Адрес</label><input class="input" id="po-addr" autocomplete="off" placeholder="Например: Дружба 2, бл. 311, вх. А" value="' + esc(F.addr) + '" aria-describedby="po-addr-e"><span class="err" id="po-addr-e" hidden></span></div>' +
            '<div class="field"><label for="po-zone">Зона</label><select class="input" id="po-zone" aria-describedby="po-zone-e"><option value="">Изберете квартал</option>' + zones.map((z) => '<option value="' + esc(z.n) + '"' + (F.zone === z.n ? " selected" : "") + ">" + esc(z.n) + " · " + feeLabel(z) + " · " + esc(z.eta) + "</option>").join("") + '</select><span class="err" id="po-zone-e" hidden></span></div>'
          : '<p class="po-note">' + ic("map-pin", 18) + "<span>От ресторанта: " + esc(RESTAURANT.address) + "</span></p>") + "</fieldset>" +
      '<fieldset class="po-sec"><legend>Час</legend><div class="seg" role="group" aria-label="Кога"><button type="button" data-pwhen="asap" aria-pressed="' + (F.when === "asap") + '">Възможно най-скоро</button><button type="button" data-pwhen="later" aria-pressed="' + (F.when === "later") + '"' + (sl.length ? "" : " disabled") + ">По-късно днес</button></div>" +
        (F.when === "later" ? '<div class="field"><label for="po-slot">Час</label><select class="input" id="po-slot" aria-describedby="po-slot-h po-slot-e">' + sl.map((t) => "<option" + (F.slot === t ? " selected" : "") + ">" + t + "</option>").join("") + '</select><span class="help" id="po-slot-h">' + (F.mode === "delivery" ? "Доставка до 21:00." : "Вземане до 22:30, готово най-късно в 23:00.") + '</span><span class="err" id="po-slot-e" hidden></span></div>' : "") + "</fieldset>" +
      '<fieldset class="po-sec"><legend>Ястия</legend><div class="po-s sa-field-s"><label class="vh" for="po-q">Търси ястие</label>' + ic("magnifying-glass", 20) + '<input class="input" id="po-q" type="search" autocomplete="off" placeholder="Ястие или съставка" value="' + esc(F.q) + '"><button class="po-clr" type="button" data-pclr' + (F.q ? "" : " hidden") + ">" + ic("x", 18) + "Изчисти</button></div>" +
        '<div class="po-res" data-pres aria-live="polite">' + resultsHTML() + '</div><div class="po-lines" data-plines><h3>Поръчката</h3>' + linesHTML() + '</div><span class="err" id="po-lines-e" hidden></span></fieldset>' +
      '<div class="field"><label for="po-note">Бележка към кухнята <span class="muted" style="font-weight:600">(по желание)</span></label><textarea class="input" id="po-note" rows="2" maxlength="300" placeholder="Например: без лук на пицата, звънецът не работи">' + esc(F.note) + "</textarea></div>" +
      '<fieldset class="po-sec"><legend>Плащане</legend><div class="seg po-pay" role="group" aria-label="Плащане">' + PAY.map((p) => '<button type="button" data-ppay="' + p[0] + '" aria-pressed="' + (F.pay === p[0]) + '">' + p[1] + "</button>").join("") + "</div></fieldset>" +
      '<dl class="od-tot po-sum" data-psum style="margin:0">' + sumHTML() + "</dl></form>";
  }

  const s = sheet({ title: "Нова поръчка по телефон", focus: "#po-tel", html: formHTML(),
    foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok' + (closedText() ? " disabled" : "") + ">" + ic("chef-hat", 22) + "<span data-plabel>Към кухнята</span></button>" });
  s.el.classList.add("sa-tall", "or-po");
  const b = s.body, okBtn = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
  function label() {
    const p = P();
    s.foot!.querySelector("[data-plabel]")!.textContent = F.lines.length ? "Към кухнята · " + fmt(p.total) + (F.mode === "delivery" && F.zone && p.fee == null ? " + такса" : "") : "Към кухнята";
  }
  function refresh(part?: "res" | "lines") {
    if (part === "res") b.querySelector("[data-pres]")!.innerHTML = resultsHTML();
    else if (part === "lines") { b.querySelector("[data-plines]")!.innerHTML = "<h3>Поръчката</h3>" + linesHTML(); b.querySelector("[data-psum]")!.innerHTML = sumHTML(); b.querySelector("[data-pres]")!.innerHTML = resultsHTML(); }
    else { const y = b.scrollTop, a = document.activeElement && (document.activeElement as HTMLElement).dataset; const sel = a && a.pmode ? '[data-pmode="' + a.pmode + '"]' : a && a.pwhen ? '[data-pwhen="' + a.pwhen + '"]' : ""; b.innerHTML = formHTML(); b.scrollTop = y; if (sel) b.querySelector<HTMLElement>(sel)?.focus({ preventScroll: true }); }
    label();
  }
  function read() {
    const g = (id: string) => { const e = b.querySelector<HTMLInputElement>(id); return e ? e.value : null; };
    F.tel = g("#po-tel") ?? F.tel; F.name = g("#po-name") ?? F.name; F.addr = g("#po-addr") ?? F.addr; F.zone = g("#po-zone") ?? F.zone; F.slot = g("#po-slot") ?? F.slot; F.note = g("#po-note") ?? F.note;
  }
  function add(id: string, d: number) {
    const l = F.lines.find((z) => z.id === id);
    if (l) { l.q = Math.max(0, Math.min(ORDER_RULES.maxQty, l.q + d)); if (!l.q) F.lines = F.lines.filter((z) => z !== l); }
    else if (d > 0) F.lines.push({ id, q: 1 });
    const le = b.querySelector<HTMLElement>("#po-lines-e"); if (le) le.hidden = true;
  }
  label();
  b.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "po-q") { F.q = t.value; b.querySelector<HTMLElement>("[data-pclr]")!.hidden = !F.q; refresh("res"); } else read();
  });
  b.addEventListener("change", (e) => { read(); const id = (e.target as HTMLElement).id; if (id === "po-zone") { if (F.when === "later" && slots().indexOf(F.slot) < 0) { F.slot = slots()[0] || ""; refresh(); } else refresh("lines"); } });
  b.addEventListener("click", (e) => {
    const t = e.target as Element; let n: HTMLElement | null;
    if ((n = t.closest<HTMLElement>("[data-pmode]"))) { read(); F.mode = n.dataset.pmode as Form["mode"]; if (F.when === "later" && slots().indexOf(F.slot) < 0) F.slot = slots()[0] || ""; refresh(); return; }
    if ((n = t.closest<HTMLElement>("[data-pwhen]"))) { read(); F.when = n.dataset.pwhen as Form["when"]; if (F.when === "later" && slots().indexOf(F.slot) < 0) F.slot = slots()[0] || ""; refresh(); return; }
    if ((n = t.closest<HTMLElement>("[data-ppay]"))) { F.pay = n.dataset.ppay!; b.querySelectorAll("[data-ppay]").forEach((z) => z.setAttribute("aria-pressed", String(z === n))); return; }
    if ((n = t.closest<HTMLElement>("[data-pclr]"))) { F.q = ""; const q = b.querySelector<HTMLInputElement>("#po-q")!; q.value = ""; n.hidden = true; refresh("res"); q.focus(); return; }
    if ((n = t.closest<HTMLElement>("[data-ptog]"))) { const w = n.dataset.ptog!; F.q = qToggle(F.q, w); b.querySelector<HTMLInputElement>("#po-q")!.value = F.q; refresh("res"); b.querySelector<HTMLElement>('[data-ptog="' + CSS.escape(w) + '"]')?.focus(); return; }
    if ((n = t.closest<HTMLElement>("[data-padd]"))) { const id = n.dataset.padd!; add(id, 1); refresh("lines"); b.querySelector<HTMLElement>('[data-pd="' + CSS.escape(id) + '"][data-d="1"]')?.focus(); return; }
    if ((n = t.closest<HTMLElement>("[data-pd]"))) { const id = n.dataset.pd!, d = +n.dataset.d!; add(id, d); refresh("lines"); (b.querySelector<HTMLElement>('[data-pd="' + CSS.escape(id) + '"][data-d="' + d + '"]') || b.querySelector<HTMLElement>('[data-padd="' + CSS.escape(id) + '"]'))?.focus(); return; }
    if ((n = t.closest<HTMLElement>("[data-pq]"))) { const i = +n.dataset.pq!, d = +n.dataset.d!, l = F.lines[i]; if (l) add(l.id, d); refresh("lines"); b.querySelector<HTMLElement>('[data-pq="' + Math.min(i, F.lines.length - 1) + '"][data-d="' + d + '"]')?.focus(); return; }
  });
  s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;

  function er(id: string, msg: string, errs: string[]) {
    const el = b.querySelector<HTMLElement>(id + "-e"), inp = b.querySelector<HTMLElement>(id); if (!el) return;
    el.hidden = !msg; el.textContent = msg || "";
    if (inp) { if (msg) inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid"); }
    if (msg) errs.push(id);
  }
  function focusFirst(errs: string[]) { const f = b.querySelector<HTMLElement>(errs[0] === "#po-lines" ? "#po-q" : errs[0]); if (f) f.focus(); }
  okBtn.onclick = async () => {
    read(); const errs: string[] = [];
    b.querySelector<HTMLElement>("[data-perr]")!.innerHTML = "";
    const digits = F.tel.replace(/[\s\-()]/g, "").replace(/^\+359/, "0");
    er("#po-tel", /^0\d{9}$/.test(digits) ? "" : "Проверете номера: 10 цифри, започва с 0. Например 0888 12 34 56.", errs);
    er("#po-name", F.name.trim().length >= 2 ? "" : "Напишете името, за да знае шофьорът или кухнята кого търси.", errs);
    if (F.mode === "delivery") {
      er("#po-addr", !F.addr.trim() ? "Напишете адреса за доставка." : !/(бл\.?|блок|ул\.?|улица|ж\.к\.|№|\d)/i.test(F.addr) ? "Добавете улица или блок, например „Дружба 2, бл. 311“." : "", errs);
      er("#po-zone", F.zone ? "" : "Изберете квартала.", errs);
    }
    const p = P();
    er("#po-lines", !F.lines.length ? "Добавете поне едно ястие." : p.conflict === "delivery" ? "Обедното меню след 15:00 е само за вземане от място." : p.outN ? "Махнете изчерпаните ястия." : "", errs);
    if (errs.length) { focusFirst(errs); return; }
    const slot = F.when === "later" && F.slot ? F.slot : "asap";
    okBtn.disabled = true; const lb = s.foot!.querySelector("[data-plabel]")!; lb.textContent = "Изпращаме …";
    try {
      const d = await ordersAdminApi.phoneOrder({ phone: F.tel.trim(), name: F.name.trim(), mode: F.mode, addr: F.mode === "delivery" ? F.addr.trim() : undefined, zone: F.mode === "delivery" ? F.zone : undefined,
        slot, lines: F.lines.map((l) => ({ id: l.id, q: l.q, mods: [] })), note: F.note.trim() || undefined, pay: F.pay as "cash" });
      s.close(); o.onDone(d, slot === "asap" ? "" : slot);
    } catch (e) {
      okBtn.disabled = false; label();
      if (e instanceof ApiError && e.fields && Object.keys(e.fields).length) {
        const map: Record<string, string> = { phone: "#po-tel", name: "#po-name", addr: "#po-addr", zone: "#po-zone", slot: "#po-slot", cart: "#po-lines", lines: "#po-lines" };
        const left: string[] = [];
        Object.keys(e.fields).forEach((k) => { if (map[k] && b.querySelector(map[k] + "-e")) er(map[k], e.fields![k], errs); else left.push(e.fields![k]); });
        if (left.length) b.querySelector<HTMLElement>("[data-perr]")!.innerHTML = banner({ tone: "danger", icon: "warning-circle", text: esc(left.join(" ")) });
        if (errs.length) focusFirst(errs); else b.scrollTop = 0;
        return;
      }
      const box = b.querySelector<HTMLElement>("[data-perr]")!;
      box.innerHTML = banner({ tone: "danger", icon: "warning-circle", text: esc(e instanceof ApiError ? (e.code === "offline" ? "Няма връзка: поръчката не е изпратена. Проверете интернета и опитайте пак." : e.message) : "Нещо се обърка. Опитайте пак.") });
      b.scrollTop = 0; box.querySelector<HTMLElement>(".sa-banner")?.setAttribute("tabindex", "-1"); box.querySelector<HTMLElement>(".sa-banner")?.focus();
    }
  };
}
