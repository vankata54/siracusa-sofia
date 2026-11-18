/* QR маса · the shared cart (/masa/<код>/kolichka/): design/pages-masa/cart.html. Grouped by phone, a counter on every
   line (any phone may change any line), "Отмени" after a removal; "Поръчано" above with every dish's status; the first
   order waits for the waiter ("Чака потвърждение от сервитьора"), a rejection comes back with the reason; "Сметка на
   масата досега" / "Общо с новите"; "Изпрати към сервитьора" / "Изпрати към кухнята"; "Поискай сметката". */
import "sc-icons:hourglass,shopping-bag,fork-knife,minus,trash,plus,users-three,hand-waving,bell-ringing,paper-plane-right,cooking-pot,receipt,caret-right,arrow-clockwise,check,fire,check-circle,warning-circle";
import { mountMasa, type Masa } from "./frame.ts";
import { SC, dishesOf, syncMenu } from "./dishes.ts";
import { masaApi, type GuestCartLine } from "../../client/api-floor.ts";
import { REJECT_EN } from "./words.ts";

let M: Masa;
let D: ReturnType<typeof dishesOf>;
const pic = (id: string) => (SC.byId[id] ? SC.pic(id) : '<span class="pic"></span>');

function waitHTML(): string {
  const v = M.view, L = M.L, p = v.pending;
  if (!p) return "";
  /* whose order waits: this phone's, or another phone's (a late phone's first order while the table is confirmed) */
  const whose = p.phone === M.me() ? L("Вашата поръчка чака сервитьора.", "Your order is waiting for the waiter.") : L("Поръчката на Телефон " + p.phone + " чака сервитьора.", "Phone " + p.phone + "’s order is waiting for the waiter.");
  return '<div class="shell" role="status" aria-live="polite"><div class="core wait"><span class="ring">' + M.ic("hourglass", 44) + "</span>" +
    /* one line says whose order waits (round 3: the title and a second line said the same) */
    '<h2 class="whose" data-whose>' + whose.replace(/\.$/, "") + "</h2>" +
    "<p>" + L("Сервитьорът ще я потвърди до минута. Така пазим масата от чужди поръчки.", "The waiter will confirm it within a minute. This keeps your table safe from orders that are not yours.") + "</p>" +
    '<p class="meta">' + M.dishes(p.n) + " · " + M.fmt(p.sum) + " · " + L("изпратено в ", "sent at ") + M.clock(p.at) + "</p></div></div>";
}

function sub(l: GuestCartLine): string {
  const x = SC.byId[l.id], L = M.L;
  if (l.per100) return (x ? M.fmt(x.p) + " " : "") + L("за 100 гр. · грамажът след рязане", "per 100 g · weighed after cutting");
  const w = x ? D.gnb(x) : "";
  return M.fmt(l.unit || 0) + (w ? "\u00a0· " + '<span class="nw">' + w + "</span>" : "");
}
const BLOCK: Record<string, [string, string]> = { sold_out: ["Изчерпано днес", "Sold out today"], removed: ["Вече не е в менюто", "No longer on the menu"], lunch: ["Обедното меню не се поръчва от масата", "The lunch menu is not ordered from the table"], breakfast: ["Закуските са до 11:30", "Breakfast is served until 11:30"] };

function draftHTML(): string {
  const v = M.view, L = M.L, n = v.cart.n, sent = v.orders.length || v.pending;
  const head = '<div class="blk-h"><h2 class="h3">' + (sent ? L("Още за поръчване", "More to order") : L("За поръчване", "To order")) + "</h2>" + (n ? '<span class="muted small">' + M.dishes(n) + "</span>" : "") + "</div>";
  if (!n && sent) return "<section>" + head + '<div class="mnote">' + M.ic("shopping-bag", 24) + "<div><b>" + L("Нищо ново за поръчване", "Nothing new to order") + "</b><p>" + L("Каквото добави някой на масата, ще се появи тук.", "Whatever anyone at the table adds will show up here.") + '</p><div class="acts"><a class="pill pill-line" href="' + M.href("menu") + '">' + M.ic("fork-knife", 20) + L("Към менюто", "Go to the menu") + "</a></div></div></div></section>";
  const open = v.kitchen.open;
  if (!n) return "<section>" + head + '<div class="shell"><div class="core empty cempty"><span class="ill">' + M.ic("shopping-bag", 40) + '</span><h3 class="h3">' + (open ? L("Количката е празна. Какво ви се хапва?", "Your cart is empty. What are you craving?") : L("Количката е празна.", "Your cart is empty.")) + "</h3><p>" + (open ? L("Каквото добави всеки на масата, се появява тук.", "Whatever anyone at the table adds shows up here.") : M.kitchenWhy() + ".") + '</p><a class="pill ' + (open ? "pill-red" : "pill-line") + '" href="' + M.href("menu") + '">' + M.ic("fork-knife", 20) + L("Към менюто", "Go to the menu") + "</a></div></div></section>";
  const me = M.me(), phones = [...new Set(v.cart.lines.map((l) => l.phone))].sort((a, b) => (a === me ? -1 : b === me ? 1 : a - b));
  return "<section>" + head + '<div class="shell"><div class="core">' + phones.map((p) => {
    const ls = v.cart.lines.filter((l) => l.phone === p), sum = ls.reduce((a, l) => a + (l.block ? 0 : l.sum || 0), 0);
    return '<div class="grp"><div class="grp-h">' + M.av(p) + "<b>" + M.esc(M.name(p)) + '</b><span class="price">' + M.fmt(sum) + "</span></div>" +
      ls.map((l) => {
        const x = SC.byId[l.id], canMore = !!x && D.orderable(x) && !l.block;
        return '<div class="cl" data-key="' + l.key + '">' + pic(l.id) + '<span><span class="nm">' + M.esc(l.name) + '</span><span class="sub">' + sub(l) + "</span>" + (l.block ? '<span class="blk">' + M.ic("warning-circle", 16) + L(BLOCK[l.block][0], BLOCK[l.block][1]) + "</span>" : "") + "</span>" +
          /* a line that cannot be sent: only "Махни" (no counter) */
          (l.block ? '<button class="pill pill-line rm" type="button" data-q="-' + l.q + '" data-k="' + l.key + '" aria-label="' + L("Махни ", "Remove ") + M.esc(l.name) + '">' + M.ic("trash", 18) + '<span class="lbl">' + L("Махни", "Remove") + "</span></button>" :
          '<span class="counter" role="group" aria-label="' + L("Брой: ", "Quantity: ") + M.esc(l.name) + '"><button type="button" data-q="-1" data-k="' + l.key + '" aria-label="' + (l.q > 1 ? L("Намали", "Decrease") : L("Махни", "Remove")) + '">' + M.ic(l.q > 1 ? "minus" : "trash", 20) + "</button><output>" + l.q + '</output><button type="button" data-q="1" data-k="' + l.key + '" aria-label="' + L("Увеличи", "Increase") + '"' + (canMore ? "" : ' aria-disabled="true"') + ">" + M.ic("plus", 20) + "</button></span>") + "</div>";
      }).join("") + "</div>";
  }).join("") + '</div></div><p class="note-auto" style="margin-top:10px">' + M.ic("users-three", 18) + "<span>" + L("Всеки на масата може да промени количката. Промените се виждат веднага на всички телефони.", "Anyone at the table can change the cart. Changes show at once on every phone.") + "</span></p></section>";
}

function sentHTML(): string {
  const v = M.view, L = M.L;
  if (!v.orders.length && !v.pending) return "";
  type R = { no: number; time: string; meta: string; lines: { name: string; q: number; phone: number | null; who?: string; st: string; id: string }[] };
  const rounds: R[] = v.orders.map((o, i) => ({ no: i + 1, time: o.placedAt, meta: o.channel === "waiter" ? L("от сервитьора", "by the waiter") : o.via ? L("потвърдена от сервитьора", "confirmed by the waiter") : L("направо в кухнята", "straight to the kitchen"),
    lines: o.lines.map((l) => ({ name: l.name, q: l.q, phone: l.phone, who: l.who, st: l.out ? "out" : l.st, id: l.id })) }));
  if (v.pending) rounds.push({ no: rounds.length + 1, time: M.clock(v.pending.at), meta: L("чака сервитьора", "waiting for the waiter"), lines: v.pending.lines.map((l) => ({ name: l.name, q: l.q, phone: l.phone, st: "wait", id: l.id })) });
  const n = rounds.reduce((a, r) => a + r.lines.reduce((b, l) => b + l.q, 0), 0);
  return '<section><div class="blk-h"><h2 class="h3">' + L("Поръчано", "Ordered") + '</h2><span class="muted small">' + M.dishes(n) + "</span></div>" +
    '<p class="legend" aria-label="' + L("Етапи", "Stages") + '">' + ["accepted", "cooking", "served"].map(M.stp).join('<span aria-hidden="true">→</span>') + "</p>" +
    '<div class="shell"><div class="core">' + rounds.slice().reverse().map((r) =>
      '<div class="rnd"><div class="rnd-h"><b>' + L("Поръчка ", "Order ") + r.no + "</b><span>" + r.time + " · " + r.meta + "</span></div>" +
      r.lines.map((l) => '<div class="sl">' + pic(l.id) + '<span><span class="nm">' + (l.q > 1 ? l.q + " × " : "") + M.esc(l.name) + "</span>" + M.whoTag(l.phone, l.who) + "</span>" + M.stp(l.st) + "</div>").join("") + "</div>").join("") + "</div></div></section>";
}

function sendState(): { ok: boolean; txt: string; retry?: boolean } {
  const v = M.view, L = M.L;
  if (M.offline) return { ok: false, txt: L("Няма връзка · Опитай пак", "No connection · Try again"), retry: true };
  if (!v.kitchen.open) return { ok: false, txt: M.kitchenWhy() };
  if (!v.cart.n) return { ok: false, txt: L("Добавете ястие от менюто", "Add a dish from the menu") };
  /* a sold-out dish stops the send until it is removed (decision 17.11.2026) */
  if (v.cart.blocked.length) return { ok: false, txt: L("Първо махнете изчерпаното", "First remove what is sold out") };
  const first = v.cart.toWaiter || !!v.pending;
  return { ok: true, txt: (first ? L("Изпрати към сервитьора · ", "Send to the waiter · ") : L("Изпрати към кухнята · ", "Send to the kitchen · ")) + M.fmt(v.cart.sum) };
}
function rejHTML(): string {
  const r = M.view.rejected, L = M.L;
  if (!r) return "";
  return '<div class="mnote warn" role="alert">' + M.ic("hand-waving", 24) + "<div><b>" + L("Сервитьорът отказа поръчката", "The waiter declined the order") + "</b><p>" + L(r.text, REJECT_EN[r.reason] || r.text) + " " + L("Ястията са обратно в количката. Ако все пак ги искате, изпратете ги пак или повикайте сервитьора.", "The dishes are back in the cart. If you still want them, send them again or call a waiter.") + "</p>" +
    '<div class="acts"><a class="pill pill-red" href="' + M.href("call") + '">' + M.ic("bell-ringing", 20) + L("Повикай сервитьор", "Call a waiter") + '</a><button class="pill pill-line" type="button" data-rejok>' + L("Разбрах", "OK") + "</button></div></div></div>";
}
/** a sold-out dish in the cart: out of the sum, the send waits until it is removed */
function blockedNote(): string {
  const v = M.view, L = M.L, b = v.cart.lines.filter((l) => l.block);
  if (!b.length || !v.kitchen.open) return "";
  const names = b.map((l) => "„" + M.esc(l.name) + "“").join(", ");
  return '<p class="how warn" role="status">' + M.ic("warning-circle", 20) + "<span>" + names + (b.length > 1 ? L(" не могат да се поръчат сега. Махнете ги, за да изпратите останалото.", " cannot be ordered now. Remove them to send the rest.") : L(" не може да се поръча сега. Махнете го, за да изпратите останалото.", " cannot be ordered now. Remove it to send the rest.")) + "</span></p>";
}
function sendBtn(cls: string): string {
  const s = sendState();
  if (s.retry) return '<button class="pill pill-ink ' + cls + '" type="button" data-mretry>' + M.ic("arrow-clockwise", 20) + s.txt + "</button>";
  return '<button class="pill ' + (s.ok ? "pill-red" : "") + " " + cls + '" type="button" ' + (s.ok ? "data-send" : 'aria-disabled="true" data-nosend') + ">" + (s.ok ? M.ic("paper-plane-right", 20) : "") + s.txt + "</button>";
}
function sideHTML(): string {
  const v = M.view, L = M.L, first = v.cart.toWaiter || !!v.pending, sentSum = v.total + (v.pending ? v.pending.sum : 0), had = v.orders.length || v.pending;
  const steak = v.cart.toWaiter && v.orders.length > 0 && v.cart.lines.some((l) => l.per100);
  const qrDone = v.orders.some((o) => o.channel === "qr");
  const late = v.cart.toWaiter && qrDone && !steak && !v.pending;
  /* the table is confirmed, but an order waits (another phone's first one): the new dishes go with it */
  const joins = qrDone && !!v.pending && !steak;
  const nOk = v.cart.lines.reduce((a, l) => a + (l.block ? 0 : l.q), 0);
  return '<div class="side"><div class="shell"><div class="core sum"><h2 class="h3" style="margin:0 0 4px">' + L("За изпращане", "To send") + "</h2>" +
    '<div class="kv"><span>' + M.dishes(nOk) + '</span><span class="price">' + M.fmt(v.cart.sum) + (v.cart.open ? " +" : "") + "</span></div>" +
    (had ? '<div class="kv"><span>' + L("Сметка на масата досега", "Table bill so far") + '</span><span class="price">' + M.fmt(sentSum) + "</span></div>" +
      '<div class="kv tot"><span><b>' + L("Общо с новите", "Total with the new ones") + '</b></span><span class="price">' + M.fmt(sentSum + v.cart.sum) + "</span></div>" : "") +
    (!v.kitchen.open ? "" : '<p class="how">' + M.ic(first ? "hourglass" : "cooking-pot", 20) + "<span>" +
      (joins ? (v.pending!.phone === M.me() ? L("Новото отива при сервитьора заедно с вашата чакаща поръчка.", "The new dishes go to the waiter together with your waiting order.") : L("Новото отива при сервитьора заедно с чакащата поръчка на Телефон " + v.pending!.phone + ".", "The new dishes go to the waiter together with Phone " + v.pending!.phone + "’s waiting order."))
        : late ? L("Първата поръчка от нов телефон на масата я потвърждава сервитьорът, после отива в кухнята.", "The first order from a new phone at the table is confirmed by the waiter, then it goes to the kitchen.")
        : steak ? L("Стекът „за 100 гр.“ минава през сервитьора: той отбелязва грамажа и праща поръчката в кухнята.", "A steak “per 100 g” goes through the waiter: they note the weight and send the order to the kitchen.")
        : first ? L("Първата поръчка я потвърждава сервитьорът, после отива в кухнята.", "The waiter confirms the first order, then it goes to the kitchen.") : L("Сервитьорът вече потвърди масата: тази поръчка отива направо в кухнята.", "The waiter has already confirmed your table: this order goes straight to the kitchen.")) + "</span></p>") +
    blockedNote() + sendBtn("pill-lg pill-block send") + "</div></div>" +
    '<div class="shell"><a class="core billcard" href="' + M.href("bill") + '"><span class="ci">' + M.ic("receipt", 24) + "</span><span><b>" + L("Поискай сметката", "Ask for the bill") + '</b><span class="d">' + L("В брой или с карта, заедно или поотделно", "Cash or card, together or split") + "</span></span>" + M.ic("caret-right", 20) + "</a></div></div>";
}

let abar: HTMLElement | null = null;
function bar() {
  if (!abar) { abar = document.createElement("div"); abar.className = "abar mcbar"; SC.ov.appendChild(abar); }
  const show = (M.view.cart.n > 0 || M.offline) && M.view.status === "open";
  abar.hidden = !show || SC.device.clientWidth >= 900;
  abar.setAttribute("aria-label", M.L("Изпращане", "Sending"));
  abar.innerHTML = show ? sendBtn("") : "";
}

function render(m: Masa) {
  M = m; D = D || dishesOf(M);
  const L = M.L;
  M.main.innerHTML = '<section class="mpage" aria-labelledby="ct-h"><div class="mh"><h1 class="h1" id="ct-h">' + L("Количка на масата", "Table cart") + '</h1><p class="lead">' + L("Пълни се от всички телефони на масата.", "Filled from every phone at the table.") + "</p></div>" +
    '<div class="cg"><div class="mnotes">' + M.banners() + rejHTML() + "</div>" + waitHTML() + sentHTML() + draftHTML() + sideHTML() + "</div></section>";
  bar();
}

const m = mountMasa({
  screen: "cart", title: ["Количка на масата", "Table cart"], render,
  added: (mm, keys) => keys.forEach((k) => mm.main.querySelector('[data-key="' + k + '"]')?.classList.add("flash")),
});
M = m;
syncMenu(() => { if (m.view) m.rerender("remote"); });
if ("ResizeObserver" in window) new ResizeObserver(() => { if (m.view) bar(); }).observe(SC.device);

document.addEventListener("click", async (e) => {
  const t = (e.target as Element).closest<HTMLElement>("button");
  if (!t || !m.view) return;
  const L = m.L;
  if (t.dataset.q) {
    if (t.getAttribute("aria-disabled") === "true") { const l0 = m.view.cart.lines.find((z) => z.key === t.dataset.k); m.toast(l0 && l0.block ? L(BLOCK[l0.block][0], BLOCK[l0.block][1]) : sendState().ok ? L("Не може повече от това ястие сега.", "No more of this dish now.") : sendState().txt); return; }
    const l = m.view.cart.lines.find((z) => z.key === t.dataset.k);
    if (!l) return;
    const q = l.q + +t.dataset.q;
    if (q <= 0) {
      const r = await m.act(() => masaApi.cartRemove(m.code, l.key), { busy: t });
      if (r && r.gone) { const gone = r.gone; m.toast(L("Махнахме ", "Removed ") + l.name, () => { void m.act(() => masaApi.cartRestore(m.code, gone)); }); }
    } else await m.act(() => masaApi.cartQty(m.code, l.key, t.dataset.q === "1" ? "+1" : "-1"), { busy: t }); /* a change, not a number: two phones pressing together both count */
    return;
  }
  if (t.hasAttribute("data-rejok")) { await m.act(() => masaApi.rejectedOk(m.code), { busy: t }); return; }
  if (t.hasAttribute("data-send")) {
    const r = await m.act(() => masaApi.send(m.code), { busy: t });
    if (r) { m.toast(r.to === "kitchen" ? L("Изпратено в кухнята ✓", "Sent to the kitchen ✓") : L("Изпратено. Чака сервитьора.", "Sent. Waiting for the waiter.")); scrollTo({ top: 0, behavior: SC.reduce ? "auto" : "smooth" }); }
    return;
  }
  if (t.hasAttribute("data-nosend")) { m.toast(sendState().txt); return; }
});
