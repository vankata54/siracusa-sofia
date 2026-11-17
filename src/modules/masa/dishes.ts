/* QR маса: the dishes in the table's context (design/pages-masa/_masa.js M.orderable … M.dishSheet): no link to the public
   dish page, no delivery, no hours. "+" fills the SHARED cart (masaApi.cartAdd); under a dish "В количката: 2 × Телефон 2";
   the dish sheet with the composition and the allergens (preliminary). Sold out stays visible with "Изчерпано днес" and
   no "+"; breakfast after 11:30 without "+" ("до 11:30"). Needs the menu: the screens with dishes import this file. */
import "sc-icons:plus,clock,info,x";
import { SC } from "../../client/sc-menu.ts";
import { masaApi } from "../../client/api-floor.ts";
import type { Dish } from "../../lib/data.ts";
import type { Masa } from "./frame.ts";

export { SC };
const ic = SC.ic, esc = SC.esc;

/** "Изчерпано днес" and the prices from the kitchen / admin (the live menu), after the first paint: as the site's menu */
export function syncMenu(after: () => void): void {
  import("../../client/api.ts").then(({ api }) => api.menu()).then((m) => {
    let changed = false;
    for (const x of m.items) {
      const d = SC.byId[x.id];
      if (!d) continue;
      const out = x.t.indexOf("out") > -1, was = d.t.indexOf("out") > -1;
      if (out !== was) { d.t = out ? [...d.t, "out"] : d.t.filter((k) => k !== "out"); changed = true; }
      if (typeof x.p === "number" && x.p !== d.p) { d.p = x.p; changed = true; }
    }
    if (changed) after();
  }).catch(() => { /* the menu of the build stays */ });
}

export function dishesOf(M: Masa) {
  const L = M.L;
  const isOut = (x: Dish) => SC.isOut(x);
  const breakfastLate = (x: Dish) => x.cat === "zakuski" && !M.view.kitchen.breakfast;
  const orderable = (x: Dish) => !isOut(x) && M.view.canOrder && !breakfastLate(x);
  /* grams from the data are Bulgarian ("400 гр."); in English "g / ml / pcs" */
  const g = (x: Dish) => {
    if (x.per100) return L("за 100 гр.", "per 100 g");
    const s = esc(x.g || "");
    return M.lang() === "en" ? s.replace(/\s*гр\.?/g, " g").replace(/\s*мл\.?/g, " ml").replace(/\s*бр\.?/g, " pcs") : s;
  };
  const gnb = (x: Dish) => g(x).replace(/ (?=гр|мл|бр|g\b|ml\b|pcs\b)/g, " ");
  const plus = (x: Dish) => (orderable(x) ? '<button class="plus" type="button" data-madd="' + x.id + '" aria-label="' + L("Добави ", "Add ") + esc(x.n) + L(" в общата количка", " to the table cart") + '">' + ic("plus", 22) + "</button>" : "");
  const why = (x: Dish) => (!isOut(x) && breakfastLate(x) && M.view.kitchen.open ? '<span class="later">' + L("до 11:30", "until 11:30") + "</span>" : "");
  /** who already has it in the shared cart */
  const inCartTag = (x: Dish) => {
    const ls = M.view.cart.lines.filter((l) => l.id === x.id);
    if (!ls.length || M.view.status !== "open") return "";
    return '<span class="incart"><span class="who">' + L("В количката:", "In the cart:") + "</span>" + ls.map((l) => '<span class="who">' + M.av(l.phone, true) + (l.q > 1 ? l.q + " × " : "") + esc(M.name(l.phone)) + "</span>").join("") + "</span>";
  };
  const card = (x: Dish) => '<div class="dcard"><button class="open" type="button" data-mdish="' + x.id + '"><span class="pw">' + SC.pic(x) + SC.badges(x, true) + '</span><span class="nm">' + esc(x.n) + '</span></button><div class="rowp"><span><span class="price">' + SC.fmt(x.p) + "</span><small>" + gnb(x) + "</small></span>" + plus(x) + why(x) + "</div></div>";
  const row = (x: Dish) => '<div class="mrow' + (isOut(x) ? " out" : "") + '" data-row="' + x.id + '"><button class="open" type="button" data-mdish="' + x.id + '">' + SC.pic(x) + '<span class="tx"><span class="nm">' + esc(x.n) + "</span>" +
    '<span class="meta"><span class="price">' + SC.fmt(x.p) + "</span><span>" + gnb(x) + "</span></span>" + (x.t.length ? SC.badges(x) : "") + inCartTag(x) + "</span></button>" + (plus(x) || why(x) || "<span></span>") + "</div>";
  const cap = (s: string) => { s = String(s || "").trim().replace(/,(?=\S)/g, ", "); return s.charAt(0).toUpperCase() + s.slice(1); };

  function dishSheet(id: string) {
    const x = SC.byId[id];
    if (!x) return;
    const al = x.al.length ? x.al.map((k) => { const a = SC.ALLERGENS.find((z) => z[0] === k); return '<span class="badge">' + ic(a ? a[2] : "info", 16) + SC.allergenName(k) + "</span>"; }).join("")
      : '<span class="muted">' + (x.comp ? L("Не открихме алергени в състава.", "No allergens found in the ingredients.") : L("Няма данни за състава. Попитайте сервитьора.", "No ingredient data. Please ask the waiter.")) + "</span>";
    const ok = orderable(x);
    const reason = isOut(x) ? L("Изчерпано днес", "Sold out today") : M.view.status !== "open" ? L("Масата е затворена", "The table is closed") : !M.view.kitchen.open ? (M.view.kitchen.before ? L("Кухнята отваря в 10:00", "The kitchen opens at 10:00") : L("Кухнята приема поръчки до 22:30", "The kitchen takes orders until 22:30")) : breakfastLate(x) ? L("Закуските са до 11:30", "Breakfast is served until 11:30") : "";
    const s = M.openSheet({ title: x.n, html: '<div class="dsh">' + SC.pic(x, "dsh-pic") + '<div class="dsh-m"><span class="price">' + SC.fmt(x.p) + '</span><span class="muted">' + gnb(x) + "</span>" + (x.t.length ? SC.badges(x) : "") + "</div>" +
      (x.comp ? "<p>" + esc(cap(x.comp)) + "</p>" : '<p class="missing">[ЛИПСВА: състав]</p>') +
      "<h3>" + L("Алергени", "Allergens") + '</h3><div class="badges">' + al + '</div><p class="note-auto">' + ic("info", 18) + "<span>" + L("Предварително, от състава. Чака потвърждение от кухнята.", "Preliminary, from the ingredients. Waiting for the kitchen to confirm.") + "</span></p>" +
      inCartTag(x) +
      (ok ? '<button class="pill pill-red pill-lg pill-block" type="button" data-madd="' + x.id + '" data-close-after>' + ic("plus", 20) + L("Добави в общата количка · ", "Add to the table cart · ") + SC.fmt(x.p) + "</button>"
        : '<p class="dsh-no">' + ic("clock", 20) + "<b>" + reason + "</b></p>") + "</div>" });
    s.el.classList.add("dshwrap");
  }
  /* the dish flies to the visible cart of the nav */
  function fly(from: HTMLElement, id: string) {
    if (SC.reduce) return;
    let to: Element | null = null;
    document.querySelectorAll('[data-mnav] [data-mgo="kolichka"] .ib, [data-mdnav] [data-mgo="kolichka"]').forEach((el) => { if (el.getBoundingClientRect().width) to = el; });
    if (!to) return;
    const A = from.getBoundingClientRect(), B = (to as Element).getBoundingClientRect(), el = document.createElement("div");
    el.className = "fly"; el.innerHTML = SC.art(id);
    const x0 = A.left + A.width / 2 - 20, y0 = A.top + A.height / 2 - 20, dx = B.left + B.width / 2 - 20 - x0, dy = B.top + B.height / 2 - 20 - y0;
    el.style.left = x0 + "px"; el.style.top = y0 + "px"; SC.ov.appendChild(el);
    el.animate([{ transform: "translate(0,0) scale(1) rotate(0)" }, { transform: "translate(" + dx * .5 + "px," + (dy * .5 - 40) + "px) scale(.9) rotate(120deg)", offset: .5 }, { transform: "translate(" + dx + "px," + dy + "px) scale(.35) rotate(240deg)", opacity: .7 }], { duration: 400, easing: "cubic-bezier(.32,.72,0,1)" }).onfinish = () => el.remove();
  }
  document.addEventListener("click", async (e) => {
    const t = (e.target as Element).closest<HTMLElement>("button");
    if (!t) return;
    if (t.dataset.mdish) { dishSheet(t.dataset.mdish); return; }
    if (t.dataset.madd) {
      e.preventDefault();
      const id = t.dataset.madd, inSheet = t.hasAttribute("data-close-after");
      fly(t, id); SC.haptic();
      const r = await M.act(() => masaApi.cartAdd(M.code, id), { busy: t });
      if (!r) return;
      M.toast(L("Добавено в общата количка ✓", "Added to the table cart ✓"));
      if (inSheet) (t.closest(".sheetwrap")?.querySelector("[data-close]") as HTMLElement | null)?.click();
      else { const again = document.querySelector<HTMLElement>('[data-madd="' + id + '"]:not([data-close-after])'); if (again && again.isConnected) SC.flash(again, ic("check", 22)); }
    }
  });
  return { orderable, plus, why, inCartTag, card, row, g, gnb, dishSheet, isOut, breakfastLate };
}
