/* QR маса · menu (/masa/<код>/menu/): design/pages-masa/menu.html. The shared search of the site (src/lib/search.ts:
   by name, the band „Съдържат …“, „без …“, Latin and English, the chips „глутен ✕“ ↔ „без глутен“), the filters (Алергени in
   a sheet, Вегетарианско, Люто, Без лук, Без глутен, Без мляко), sticky categories, compact rows. "+" fills the SHARED cart;
   another phone's dish is highlighted live; the bar "4 ястия на масата · Към количката · 21,70 €". */
import "sc-icons:magnifying-glass,x,funnel,leaf,pepper,plant,grains,drop,list-bullets,warning-circle,bell-ringing,arrow-right,caret-right,info,bowl-food,check,shrimp,egg,fish,circles-three,acorn,carrot,jar,dots-nine,wine,flower,fish-simple";
import { mountMasa, type Masa } from "./frame.ts";
import { SC, dishesOf, syncMenu } from "./dishes.ts";
import { searchDishes, chips as qChips, toggle, type Chip, type Result } from "../../lib/search.ts";
import { murl } from "../routes.ts";
import { FILTER_EN } from "./words.ts";
import type { Dish, Category } from "../../lib/data.ts";

type Group = { c: { id: string; n: string }; kind?: "name" | "band" | "unk"; it: Dish[] };
const FILT = ["veg", "hot", "noonion", "nogluten", "nomilk"].map((id) => SC.FILTERS.find((f) => f.id === id)!).filter(Boolean);
const FCLS: Record<string, string> = { veg: "leaf", hot: "pep" };
let st = { q: "", f: [] as string[], a: [] as string[] };
let SR: (Result<Dish> & { chips: Chip[] }) | null = null;
let D: ReturnType<typeof dishesOf>;
let M: Masa;
let built = false, lastKey = "";
const rowSig: Record<string, string> = {};
const $ = <T extends HTMLElement = HTMLElement>(s: string) => M.main.querySelector<T>(s)!;

const CATS = (): Category[] => SC.cats.filter((c) => c.id !== "dobavki");
const ALL = (): number => SC.items.filter((x) => x.cat !== "dobavki").length;
function passes(x: Dish): boolean {
  for (const id of st.f) { const f = FILT.find((z) => z.id === id); if (f && !f.test(x)) return false; }
  for (const a of st.a) if (x.al.indexOf(a as never) > -1) return false;
  return true;
}
const outLast = (a: Dish[]) => a.map((x, i) => [x, i] as const).sort((p, q) => (+SC.isOut(p[0]) - +SC.isOut(q[0])) || (p[1] - q[1])).map((z) => z[0]);
const byCat = (list: Dish[]): Group[] => CATS().map((c) => ({ c, it: outLast(list.filter((x) => x.cat === c.id)) })).filter((g) => g.it.length);
function groups(): Group[] {
  const L = M.L, base = SC.items.filter((x) => x.cat !== "dobavki" && SC.catById[x.cat] && passes(x)), q = st.q.trim();
  SR = null;
  if (q) { const r = searchDishes(base, q); if (r.query.inc.length || r.query.exc.length) SR = { ...r, chips: qChips(q) }; }
  if (!SR) return byCat(base);
  let G: Group[] = [];
  if (SR.query.inc.length) {
    if (SR.name.length) G.push({ c: { id: "q-name", n: L("По име", "By name") }, kind: "name", it: outLast(SR.name) });
    if (SR.comp.length) G.push({ c: { id: "q-comp", n: L(SR.band, "Contains " + SR.query.inc.filter((w) => w.c).map((w) => w.raw).join(", ")) }, kind: "band", it: outLast(SR.comp) });
  } else G = byCat(SR.rest);
  if (SR.unknown.length) G.push({ c: { id: "q-unk", n: L("Нямаме пълен състав", "No full ingredients") }, kind: "unk", it: outLast(SR.unknown) });
  return G;
}
const count = (G: Group[]) => G.reduce((a, g) => a + (g.kind === "unk" ? 0 : g.it.length), 0);

function tableCard(): string {
  const v = M.view, L = M.L, by: Record<number, number> = {};
  v.cart.lines.forEach((l) => { by[l.phone] = (by[l.phone] || 0) + l.q; });
  const order = [M.me(), ...v.phones.map((p) => p.phone).filter((p) => p !== M.me())];
  const parts = order.filter((p) => by[p]).map((p) => '<span class="nw">' + M.esc(M.name(p)) + ": " + by[p] + "</span>");
  return '<a class="tbl" href="' + M.href("cart") + '" data-tbl><span class="avs">' + v.phones.map((p) => M.av(p.phone)).join("") + "</span><span><b>" + L("Обща количка на масата", "Shared table cart") + '</b><span class="d">' + (parts.length ? parts.join(" · ") : L("Още е празна", "Still empty")) + "</span></span>" + M.ic("caret-right", 20) + "</a>";
}
function qchipsHTML(c: Chip[]): string {
  if (!c.length) return "";
  const L = M.L;
  return '<div class="qchips" role="group" aria-label="' + L("Как разбрахме търсенето", "How we understood the search") + '"><span class="ql">' + L("Търсим:", "Searching:") + "</span>" + c.map((x) => {
    const l = M.esc(x.label);
    return '<button class="chip qchip" type="button" data-qtoggle="' + M.esc(x.word) + '" aria-pressed="' + x.without + '" aria-label="' + (x.without ? L("без ", "without ") + l + L(", покажи и с ", ", show with ") + l : l + L(", покажи без ", ", show without ") + l) + '">' + (x.without ? M.ic("check", 18) + L("без ", "without ") + l : l + M.ic("x", 18)) + "</button>";
  }).join("") + "</div>";
}
function chipsHTML(): string {
  const L = M.L, aOn = st.a.length;
  return '<button class="chip" type="button" data-al aria-pressed="' + (aOn > 0) + '" aria-haspopup="dialog">' + M.ic("funnel", 20) + L("Алергени", "Allergens") + (aOn ? ' <span class="dot">' + aOn + "</span>" : "") + "</button>" +
    FILT.map((f) => '<button class="chip ' + (FCLS[f.id] || "") + '" type="button" data-f="' + f.id + '" aria-pressed="' + (st.f.indexOf(f.id) > -1) + '">' + M.ic(f.icon, 20) + L(f.n, FILTER_EN[f.id]) + "</button>").join("");
}
function lunchNote(): string {
  const v = M.view, L = M.L;
  if (!SC.state().lunch || !v.kitchen.open || v.status !== "open") return "";
  return '<div class="mnote">' + M.ic("bowl-food", 24) + "<div><b>" + L("Обедното меню", "The lunch menu") + "</b><p>" + L("Дали се поръчва от масата до 15:00, още не е решено.", "Whether it can be ordered from the table until 15:00 is not decided yet.") + ' <span class="missing">[ЛИПСВА: обедно меню от масата, въпрос към собственика]</span></p></div></div>';
}

/* ---------- the frame of the screen (once per language) ---------- */
function build() {
  const v = M.view, L = M.L, ic = M.ic;
  M.main.innerHTML =
    '<section class="mpage mm" aria-labelledby="mm-h">' +
      '<div class="mm-top"><div class="mm-h"><h1 class="h1" id="mm-h">' + L("Меню", "Menu") + '</h1><p class="lead" data-mlead></p></div><div data-tblbox></div></div>' +
      '<div class="mnotes" data-notes></div>' +
      '<div class="sbox" role="search"><label class="vh" for="mq">' + L("Търсете ястие или съставка", "Search a dish or ingredient") + "</label>" + ic("magnifying-glass", 22) +
        '<input id="mq" type="search" placeholder="' + L("Търсете: пица, бурата, кебапчета", "Search: pizza, burrata") + '" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"><button class="clr" type="button" data-qclr aria-label="' + L("Изчисти търсенето", "Clear search") + '" hidden>' + ic("x", 20) + "</button></div>" +
      "<div data-qchips></div>" +
      '<div class="chips fchips" data-fchips role="group" aria-label="' + L("Филтри", "Filters") + '"></div>' +
      '<div class="mstat"><p data-count aria-live="polite"></p><button class="link" type="button" data-clr hidden>' + ic("x", 18) + L("Изчисти", "Clear") + "</button></div>" +
      '<p class="note-auto alnote">' + ic("info", 18) + "<span>" + L("Алергените са предварителни, от състава. Кухнята ги потвърждава.", "Allergens are preliminary, from the ingredients. The kitchen confirms them.") + "</span></p>" +
      (M.lang() === "en" ? '<p class="note-auto">' + ic("info", 18) + '<span>Dish names are in Bulgarian for now. <span class="missing">[ЛИПСВА: английски имена и състав на ястията]</span></span></p>' : "") +
      '<nav class="catbar" aria-label="' + L("Категории", "Categories") + '"><div class="cs" data-cats></div></nav>' +
      "<div data-res></div>" +
    "</section>";
  const q = $<HTMLInputElement>("#mq");
  q.value = st.q; $("[data-qclr]").hidden = !st.q;
  let qt: ReturnType<typeof setTimeout> | undefined;
  q.addEventListener("input", () => { $("[data-qclr]").hidden = !q.value; clearTimeout(qt); qt = setTimeout(() => { st.q = q.value; results(); }, 120); });
  built = true; lastKey = "";
  void v;
}

/* ---------- what changes with the view: the table card, the notes, the lead, the bar ---------- */
function live() {
  const v = M.view, L = M.L;
  $("[data-mlead]").textContent = v.kitchen.open && v.status === "open" ? L("Натиснете „+“ и ястието отива в общата количка на масата.", "Tap “+” and the dish goes to the table’s shared cart.") : L("Кухнята затвори за днес. Менюто е за разглеждане.", "The kitchen has closed for today. The menu is for browsing.");
  if (!v.kitchen.open && v.kitchen.before) $("[data-mlead]").textContent = L("Кухнята още не е отворила. Менюто е за разглеждане.", "The kitchen has not opened yet. The menu is for browsing.");
  $("[data-tblbox]").innerHTML = tableCard();
  $("[data-notes]").innerHTML = M.banners() + lunchNote();
  bar();
}

/* ---------- the results: drawn again only when the search, the filters, the hour or the language change ---------- */
function results() {
  const L = M.L, G = groups(), n = count(G), any = st.f.length || st.a.length || st.q.trim();
  $("[data-qchips]").innerHTML = SR ? qchipsHTML(SR.chips) : "";
  $("[data-fchips]").innerHTML = chipsHTML();
  $("[data-count]").innerHTML = any ? L("Показваме ", "Showing ") + n + " <span>" + L("от ", "of ") + M.dishes(ALL()) + "</span>" : M.dishes(ALL()) + " <span>· " + CATS().length + L(" категории", " categories") + "</span>";
  $("[data-clr]").hidden = !any;
  $("[data-cats]").innerHTML = G.map((g) => '<a class="chip" href="#c-' + g.c.id + '" data-go="' + g.c.id + '">' + M.esc(g.c.n) + "</a>").join("");
  M.main.querySelector<HTMLElement>(".catbar")!.hidden = G.length < 2;
  const ex = SR ? SR.query.exc.map((w) => w.label) : [];
  $("[data-res]").innerHTML = G.length ? G.map((g) => {
    const head = g.kind === "band" ? '<div class="sband mband"><h2>' + M.ic("list-bullets", 18) + M.esc(g.c.n) + '</h2><span class="n">' + M.dishes(g.it.length) + "</span></div>"
      : g.kind === "unk" ? '<div class="mnote warn munk">' + M.ic("warning-circle", 24) + "<div><b>" + L("Нямаме пълен състав, попитайте ни", "No full ingredients yet, ask us") + "</b><p>" + L("Не знаем дали съдържат ", "We don’t know if they contain ") + M.esc(ex.length < 2 ? ex.join("") : ex.slice(0, -1).join(", ") + L(" и ", " and ") + ex[ex.length - 1]) + ". " + L("Попитайте сервитьора.", "Ask the waiter.") + '</p><div class="acts"><a class="pill pill-line" href="' + M.href("call") + '">' + M.ic("bell-ringing", 20) + L("Повикай сервитьор", "Call a waiter") + "</a></div></div></div>"
      : '<h2 class="h3">' + M.esc(g.c.n) + "</h2>";
    return '<section class="mcat" id="c-' + g.c.id + '" data-cat="' + g.c.id + '">' + head + (g.c.id === "zakuski" ? '<p class="cdesc">' + L("Всеки ден до 11:30", "Every day until 11:30") + "</p>" : "") + '<div class="rows">' + g.it.map((x) => { rowSig[x.id] = sig(x); return D.row(x); }).join("") + "</div></section>";
  }).join("")
    : '<div class="empty mempty"><span class="ill">' + M.ic("funnel", 40) + '</span><h2 class="h3">' + L("Няма ястия с тези филтри", "No dishes match these filters") + "</h2><p>" + L("Махнете някой филтър или изчистете всички.", "Remove a filter or clear them all.") + '</p><button class="pill pill-red" type="button" data-clr>' + L("Изчисти филтрите", "Clear filters") + "</button></div>";
  active = null;
  requestAnimationFrame(spy);
}
/** what a row shows from the view: who has it in the cart, "+" or not */
const sig = (x: Dish) => D.inCartTag(x) + "|" + D.orderable(x) + "|" + D.breakfastLate(x) + "|" + SC.isOut(x);
function patchRows() {
  M.main.querySelectorAll<HTMLElement>("[data-row]").forEach((r) => {
    const x = SC.byId[r.dataset.row!];
    if (!x) return;
    const s = sig(x);
    if (rowSig[x.id] !== s) { rowSig[x.id] = s; const flash = r.classList.contains("flash"); r.outerHTML = D.row(x); if (flash) M.main.querySelector('[data-row="' + x.id + '"]')?.classList.add("flash"); }
  });
}

/* ---------- scrollspy for the sticky categories (the document scrolls) ---------- */
let active: string | null = null;
function spy() {
  const secs = M.main.querySelectorAll<HTMLElement>(".mcat");
  let id: string | null = null;
  const off = SC.device.clientWidth >= 900 ? 190 : 150;
  secs.forEach((s) => { if (s.getBoundingClientRect().top < off) id = s.dataset.cat || null; });
  if (id === active) return;
  active = id;
  M.main.querySelectorAll<HTMLElement>("[data-go]").forEach((a) => {
    const on = a.dataset.go === id;
    a.setAttribute("aria-current", String(on));
    if (on) { const cs = a.parentElement!; cs.scrollTo({ left: a.offsetLeft - 40, behavior: SC.reduce ? "auto" : "smooth" }); }
  });
}
addEventListener("scroll", () => requestAnimationFrame(spy), { passive: true });

/* ---------- the allergen sheet ---------- */
function alSheet() {
  const L = M.L;
  const s = M.openSheet({ title: L("Алергени", "Allergens"), html: '<p class="muted" style="margin:0 0 6px">' + L("Отметнете какво не ядете. Скриваме ястията, които го съдържат по състава.", "Tick what you don’t eat. We hide dishes that contain it.") + '</p><div class="flist">' +
    SC.ALLERGENS.map((a) => '<label class="check"><input type="checkbox" data-alk="' + a[0] + '"' + (st.a.indexOf(a[0]) > -1 ? " checked" : "") + '><span class="fi">' + M.ic(a[2], 22) + '</span><span class="ft"><b>' + a[1] + "</b><small>" + SC.items.filter((x) => x.al.indexOf(a[0]) > -1).length + L(" ястия по състава", " dishes by ingredients") + "</small></span></label>").join("") +
    '</div><div class="sh-foot"><button class="pill pill-soft" type="button" data-shclr>' + L("Изчисти", "Clear") + '</button><button class="pill pill-red" type="button" data-shok>' + L("Покажи ", "Show ") + "<span data-n></span></button></div>" });
  const upd = () => { results(); s.el.querySelector("[data-n]")!.textContent = M.dishes(groups().reduce((a, g) => a + g.it.length, 0)); };
  s.el.addEventListener("change", (e) => { const k = (e.target as HTMLInputElement).dataset.alk; if (!k) return; st.a = st.a.filter((z) => z !== k); if ((e.target as HTMLInputElement).checked) st.a.push(k); upd(); });
  s.el.querySelector<HTMLElement>("[data-shclr]")!.onclick = () => { st.a = []; s.el.querySelectorAll("input").forEach((i) => { i.checked = false; }); upd(); };
  s.el.querySelector<HTMLElement>("[data-shok]")!.onclick = () => s.close();
  upd();
}

/* ---------- the floating cart bar ---------- */
let cbar: HTMLElement | null = null;
function bar() {
  if (!cbar) {
    SC.ov.insertAdjacentHTML("beforeend", '<div class="abar cbar" data-cbar hidden><span class="avs" data-cav></span><span class="cn" data-cn></span><a class="pill pill-red" href="' + M.href("cart") + '" data-cgo><span></span><span class="knob">' + M.ic("arrow-right", 20) + "</span></a></div>");
    cbar = SC.ov.querySelector<HTMLElement>("[data-cbar]");
  }
  const v = M.view, L = M.L, n = v.status === "open" ? v.cart.n : 0;
  cbar!.hidden = !n;
  cbar!.setAttribute("aria-label", L("Количка на масата", "Table cart"));
  if (!n) return;
  const who = [...new Set(v.cart.lines.map((l) => l.phone))].sort((a, b) => a - b);
  cbar!.querySelector("[data-cav]")!.innerHTML = who.map((p) => M.av(p, true)).join("");
  cbar!.querySelector("[data-cn]")!.innerHTML = "<b>" + M.dishes(n) + "</b>" + L("на масата", "at the table");
  cbar!.classList.toggle("off", !v.kitchen.open);
  cbar!.querySelector("[data-cgo] span")!.textContent = (v.kitchen.open ? L("Към количката · ", "To the cart · ") : L("Виж количката · ", "View cart · ")) + M.fmt(v.cart.sum);
}

/* ---------- render ---------- */
let scrolled = false;
function render(m: Masa, why: string) {
  M = m; D = D || dishesOf(M);
  if (!built || why === "lang") build();
  live();
  const v = M.view, key = [M.lang(), v.canOrder, v.kitchen.breakfast, v.kitchen.open, v.status].join("|");
  if (key !== lastKey) { lastKey = key; results(); } else patchRows();
  if (!scrolled) {
    scrolled = true;
    const c = murl.hash().get("c");
    if (c) requestAnimationFrame(() => document.getElementById("c-" + c)?.scrollIntoView());
  }
}

const m = mountMasa({
  screen: "menu", title: ["Меню на масата", "Table menu"],
  render,
  added: (mm, keys) => {
    M.main.querySelector("[data-tbl]")?.classList.add("flash");
    keys.forEach((k) => { const l = mm.view.cart.lines.find((z) => z.key === k); if (l) M.main.querySelector('[data-row="' + l.id + '"]')?.classList.add("flash"); });
  },
});
M = m;
syncMenu(() => { if (m.view && built) { lastKey = ""; render(m, "remote"); } });

m.main.addEventListener("click", (e) => {
  const t = (e.target as Element).closest<HTMLElement>("button, a");
  if (!t) return;
  if (t.dataset.go) { e.preventDefault(); document.getElementById("c-" + t.dataset.go)?.scrollIntoView({ behavior: SC.reduce ? "auto" : "smooth" }); return; }
  if (t.dataset.f) { const id = t.dataset.f; st.f = st.f.indexOf(id) > -1 ? st.f.filter((z) => z !== id) : st.f.concat(id); results(); return; }
  if (t.hasAttribute("data-al")) { alSheet(); return; }
  if (t.hasAttribute("data-clr")) { st = { q: "", f: [], a: [] }; $<HTMLInputElement>("#mq").value = ""; $("[data-qclr]").hidden = true; results(); return; }
  if (t.dataset.qtoggle) { st.q = toggle(st.q, t.dataset.qtoggle); $<HTMLInputElement>("#mq").value = st.q; $("[data-qclr]").hidden = !st.q; results(); return; }
  if (t.hasAttribute("data-qclr")) { const q = $<HTMLInputElement>("#mq"); q.value = ""; st.q = ""; t.hidden = true; results(); q.focus(); return; }
});
