/* QR маса · the bill (/masa/<код>/smetka/): design/pages-masa/bill.html with the "Поправки" of its README. Every sent dish
   with who ordered it and the total; "В брой" / "С карта"; "Една сметка" / "По гости" / "По ястия" (the picks are shared:
   "Телефон 2 плаща" is locked, "Още никой не плаща: 1 ястие · 2,19 €" / "Всички ястия са разпределени"); "Поискай сметката",
   "Поискай моята част", "Поискай останалото", "Всичко вече е поискано"; after asking "Сервитьорът идва със сметката ·
   чакате 0:26"; the other phones' requests in one short line without their sums; the rating with the -10% code and the
   Google line for BOTH answers (never a discount for a Google review); the closed sitting "Сметката е платена". */
import "sc-icons:receipt,fork-knife,money,credit-card,check,check-circle,users-three,shopping-bag,arrow-clockwise,seal-percent,thumbs-up,thumbs-down,copy,google-logo,arrow-up-right,paper-plane-right";
import { mountMasa, type Masa } from "./frame.ts";
import { SC } from "../../client/sc.ts";
import { masaApi, type GuestOrderLine } from "../../client/api-floor.ts";
import { murl } from "../routes.ts";
import { PAY, SPLIT } from "./words.ts";

type Split = "one" | "guests" | "dishes";
let M: Masa;
const C: { pay: "cash" | "card"; split: Split } = { pay: "cash", split: "one" };
const R: { changing: boolean; err: string; fb: string } = { changing: false, err: "", fb: "" };

const lines = (): GuestOrderLine[] => M.view.orders.flatMap((o) => o.lines);
const sumOf = (l: GuestOrderLine[]) => Math.round(l.reduce((a, x) => a + x.sum, 0) * 100) / 100;
const myPicks = () => lines().filter((l) => M.view.bill.picks[l.key] === M.me()).map((l) => l.key);

function linesHTML(pick: boolean): string {
  const v = M.view, L = M.L, ls = lines();
  if (!ls.length) return '<div class="shell"><div class="core empty bempty"><span class="ill">' + M.ic("receipt", 40) + '</span><h2 class="h3">' + L("Още нищо не е поръчано", "Nothing ordered yet") + "</h2><p>" + L("Сметката се пълни с изпратените поръчки.", "The bill fills up with the orders you send.") + '</p><a class="pill pill-red" href="' + M.href("menu") + '">' + M.ic("fork-knife", 20) + L("Към менюто", "Go to the menu") + "</a></div></div>";
  const free = new Set(v.bill.free);
  return '<div class="shell"><div class="core lines">' + ls.map((l) => {
    const owner = v.bill.picks[l.key], on = owner === M.me();
    const body = '<span class="nm">' + (l.q > 1 ? l.q + " × " : "") + M.esc(l.name) + "</span>" + M.whoTag(l.phone, l.who) + '<span class="price">' + (l.out ? L("Изчерпано", "Sold out") : M.fmt(l.sum)) + "</span>";
    if (!pick || l.out) return '<div class="bl">' + body + (l.paid ? '<span class="payer me">' + L("Платено", "Paid") + "</span>" : "") + "</div>";
    const lock = (txt: string) => '<div class="bl pick taken"><input type="checkbox" checked disabled aria-label="' + M.esc(l.name) + ": " + M.esc(txt) + '">' + body + '<span class="payer">' + M.esc(txt) + "</span></div>";
    if (l.paid) return lock(L("Платено", "Paid"));
    if (owner && !on) return lock(M.name(owner) + L(" плаща", " pays"));
    if (!owner && !free.has(l.key)) return lock(L("Вече е поискано", "Already asked for"));
    const pay = owner ? '<span class="payer me">' + L("Плащате вие", "You pay") + "</span>" : '<span class="payer">' + L("Още никой не го плаща", "Nobody pays for it yet") + "</span>";
    return '<label class="bl pick"><input type="checkbox" data-pick="' + l.key + '"' + (on ? " checked" : "") + ">" + body + pay + "</label>";
  }).join("") +
    (pick ? unassigned() : "") +
    '<div class="tot"><b>' + L("Общо за масата", "Table total") + '</b><span class="price">' + M.fmt(v.total) + "</span></div>" +
    (v.paid > 0 && v.rest > 0 ? '<div class="kv"><span>' + L("Платено досега", "Paid so far") + '</span><span class="price">' + M.fmt(v.paid) + '</span></div><div class="kv"><span>' + L("Остава", "Left to pay") + '</span><span class="price">' + M.fmt(v.rest) + "</span></div>" : "") +
    '<p class="fine">' + L("Касовата бележка ви носи сервитьорът.", "The waiter brings your receipt.") + "</p></div></div>";
}
function unassigned(): string {
  const v = M.view, L = M.L, free = new Set(v.bill.free), u = lines().filter((l) => free.has(l.key) && !v.bill.picks[l.key]);
  return u.length ? '<div class="unas" role="status"><span>' + L("Още никой не плаща: ", "Nobody pays yet for: ") + M.dishes(u.reduce((a, l) => a + l.q, 0)) + '</span><span class="price">' + M.fmt(sumOf(u)) + "</span></div>"
    : '<div class="unas ok" role="status"><span>' + M.ic("check-circle", 20) + " " + L("Всички ястия са разпределени", "Every dish has a payer") + "</span></div>";
}
function splitBox(): string {
  const L = M.L;
  if (C.split === "guests") {
    const by = new Map<number, number>();
    lines().forEach((l) => { if (l.phone) by.set(l.phone, (by.get(l.phone) || 0) + l.sum); });
    const order = [...by.keys()].sort((a, b) => (a === M.me() ? -1 : b === M.me() ? 1 : a - b));
    return '<div class="splitbox"><div class="shell"><div class="core ppl">' + order.map((p) => '<div class="pp">' + M.av(p) + "<b>" + M.esc(M.name(p)) + '</b><span class="price">' + M.fmt(by.get(p)!) + "</span></div>").join("") + "</div></div>" +
      '<p class="fine">' + L("Всеки плаща ястията, които е добавил от своя телефон.", "Everyone pays for the dishes they added from their phone.") + "</p></div>";
  }
  if (C.split === "dishes") return '<p class="fine" style="margin-top:12px">' + L("Отметнете в списъка „Поръчано“ какво плащате вие. Другите отбелязват своето от техните телефони.", "Tick in the “Ordered” list what you pay for. The others tick theirs on their phones.") + "</p>";
  return "";
}

function waitedAt(): string | null { const b = M.view.calls.state.bill; return b && b.state === "active" ? b.at : null; }
function reqHTML(): string {
  const v = M.view, L = M.L, B = v.bill.mine, done = v.status === "closed";
  const head = (h: string, what: string, ok: boolean) => '<div class="shell" role="status"><div class="core coming' + (ok ? " done" : "") + '"><span class="bell">' + M.ic(ok ? "check" : "receipt", 30) + "</span><h2>" + h + '</h2><p class="what">' + what + "</p>";
  if (done || !B) {
    if (!B) return head(L("Сметката е платена", "The bill is paid"), L("Масата е затворена. Благодарим, че бяхте при нас!", "The table is closed. Thank you for coming!"), true) + "</div></div>";
  }
  const at = waitedAt();
  return (done ? head(L("Сметката е платена", "The bill is paid"), L("Масата е затворена. Благодарим, че бяхте при нас!", "The table is closed. Thank you for coming!"), true)
    : head(L("Сервитьорът идва със сметката", "The waiter is bringing the bill") + (at ? ' · <span class="t">' + L("чакате ", "waiting ") + "<span data-wt>" + M.mmss(M.since(at)) + "</span></span>" : ""), L("Поискахте в ", "You asked at ") + M.clock(B!.at), false)) +
    '<div class="kvs"><div class="kv"><span>' + L("Плащане", "Payment") + "</span><span>" + L(PAY[B!.pay][0], PAY[B!.pay][1]) + '</span></div><div class="kv"><span>' + L("Разделяне", "Split") + "</span><span>" + L(SPLIT[B!.split][0], SPLIT[B!.split][1]) + "</span></div>" +
    (B!.split !== "one" ? '<div class="kv"><span>' + L("Вашата част", "Your share") + '</span><span class="price">' + M.fmt(B!.sum) + "</span></div>"
      : '<div class="kv"><span>' + (B!.sum < v.total - 0.001 ? L("Останалото", "The rest") : L("Общо за масата", "Table total")) + '</span><span class="price">' + M.fmt(B!.sum) + "</span></div>") + "</div>" +
    (done ? "" : '<p class="fine" style="grid-column:1 / -1">' + L("Ако искате промяна, кажете на сервитьора, когато дойде.", "If you want a change, tell the waiter when they come.") + "</p>") + "</div></div>";
}
/* what the other phones asked for: one short line each (their amounts stay on their phones) */
function othersHTML(): string {
  const v = M.view, L = M.L, os = v.bill.others;
  if (!os.length) return "";
  const all = [...os.map((o) => o.at), ...(v.bill.mine ? [v.bill.mine.at] : [])];
  return '<div class="mnote">' + M.ic("users-three", 24) + "<div>" + os.map((o) => {
    const rest = all.some((a) => a < o.at);
    const what = o.split === "one" ? (rest ? L(" поиска останалото от сметката", " asked for the rest of the bill") : L(" поиска сметката за цялата маса", " asked for the bill for the whole table")) : L(" плаща своята част отделно", " pays their share separately");
    return '<p class="oth">' + M.av(o.phone, true) + " <span>" + M.esc(M.name(o.phone)) + what + " (" + L(PAY[o.pay][0], PAY[o.pay][1]).toLowerCase() + ") · " + M.clock(o.at) + "</span></p>";
  }).join("") + "</div></div>";
}

function codeHTML(): string {
  const r = M.view.rating!, L = M.L;
  return '<div class="code ember-card"><span class="k">' + L("Вашият код за -" + r.pct + "% от следващата поръчка", "Your code for " + r.pct + "% off your next order") + '</span><div class="row"><span class="v" data-code>' + M.esc(r.code) + '</span><button class="pill pill-ink" type="button" data-copy>' + M.ic("copy", 18) + L("Копирай кода", "Copy code") + "</button></div><p>" + L("За следваща поръчка от сайта или на масата. Един код на телефонен номер.", "For your next order on the website or at the table. One code per phone number.") + "</p></div>";
}
function googleHTML(big: boolean): string {
  const L = M.L, g = M.view.google;
  const miss = g ? "" : '<span class="missing">[ЛИПСВА: линк за отзив в Google]</span>';
  const label = big ? L("Напиши отзив в Google", "Write a Google review") : L("Отзив в Google", "Google review");
  const a = g ? '<a class="' + (big ? "pill pill-line pill-lg pill-block" : "link") + '" href="' + M.esc(g) + '" target="_blank" rel="noopener">' + M.ic("google-logo", 20) + label + M.ic("arrow-up-right", 18) + "</a>"
    : '<button class="' + (big ? "pill pill-line pill-lg pill-block" : "link") + '" type="button" data-google aria-disabled="true">' + M.ic("google-logo", 20) + label + "</button>";
  return big ? '<div class="gq"><p><b>' + L("Ще ни помогнете ли с отзив в Google?", "Would you help us with a Google review?") + "</b></p>" + a + miss + "</div>"
    : '<p class="muted">' + L("Ако желаете, можете да оставите и отзив в Google.", "If you like, you can also leave a Google review.") + "</p><div>" + a + (miss ? "<br>" + miss : "") + "</div>";
}
function rateHTML(): string {
  const v = M.view, L = M.L;
  if (!v.canRate) return "";
  const r = v.rating, a = R.changing || !r ? "" : r.happy ? "yes" : "no";
  const sep = '<hr class="gsep"><p class="muted">' + L("Кодът е за оценката ви тук. Отзивът в Google е по желание и не носи отстъпка.", "The code is for your rating here. A Google review is optional and brings no discount.") + "</p>";
  const change = '<button class="link change" type="button" data-rate-reset>' + L("Промени отговора", "Change your answer") + "</button>";
  let ans = "";
  if (a === "yes") ans = '<div class="ans"><h3 tabindex="-1" data-focus>' + L("Благодарим! Радваме се, че ви хареса.", "Thank you! We are glad you liked it.") + "</h3>" + codeHTML() + sep + googleHTML(true) + change + "</div>";
  if (a === "no") ans = '<div class="ans"><h3 tabindex="-1" data-focus>' + L("Съжаляваме. Благодарим, че ни казвате.", "We are sorry. Thank you for telling us.") + "</h3>" +
    (r!.sent ? '<div class="fbsent">' + M.ic("check-circle", 22) + "<span><b>" + L("Изпратихме го на управителя.", "We sent it to the manager.") + '</b><br><span class="muted">' + L("Ще го прочете лично.", "They will read it personally.") + "</span></span></div>"
      : '<div class="field"><label for="fb">' + L("Как да подобрим обслужването?", "How can we improve our service?") + '</label><textarea class="input" id="fb" rows="4" maxlength="2000" aria-describedby="fbh' + (R.err ? " fbe" : "") + '"' + (R.err ? ' aria-invalid="true"' : "") + ">" + M.esc(R.fb) + '</textarea><span class="help" id="fbh">' + L("Стига само до управителя.", "Only the manager reads it.") + "</span>" + (R.err ? '<span class="err" id="fbe">' + R.err + "</span>" : "") + "</div>" +
        '<button class="pill pill-red pill-lg pill-block" type="button" data-fb>' + M.ic("paper-plane-right", 20) + L("Изпрати на управителя", "Send to the manager") + "</button>") +
    codeHTML() + sep + googleHTML(false) + change + "</div>";
  return '<section class="shell rate" id="rate"><div class="core cpad"><span class="offer">' + M.ic("seal-percent", 18) + L("-10% за оценката", "10% off for your rating") + '</span><h2 id="rate-h">' + L("Останахте ли доволни?", "Did you enjoy your visit?") + '</h2><p class="lead">' + L("От храната и обслужването. За отговора ви даваме -10% от следващата поръчка, каквото и да изберете.", "With the food and the service. For your answer you get 10% off your next order, whatever you choose.") + "</p>" +
    '<div class="yn" role="group" aria-labelledby="rate-h"><button type="button" data-rate="yes" aria-pressed="' + (a === "yes") + '">' + M.ic("thumbs-up", 26) + L("Да", "Yes") + '</button><button type="button" data-rate="no" aria-pressed="' + (a === "no") + '">' + M.ic("thumbs-down", 26) + L("Не", "No") + "</button></div>" + ans + "</div></section>";
}

function askHTML(): string {
  const v = M.view, L = M.L;
  if (!lines().length || v.status !== "open") return "";
  const w = v.bill.want ? v.bill.want[C.split] : { keys: [], sum: 0 }, s = w.sum, part = v.bill.others.length > 0, none = !w.keys.length;
  const whoPays = v.bill.others.map((o) => M.esc(M.name(o.phone))).join(", ");
  const btnTxt = C.split === "one" ? (part ? L("Поискай останалото · ", "Ask for the rest · ") : L("Поискай сметката · ", "Ask for the bill · ")) + M.fmt(s) : L("Поискай моята част · ", "Ask for my share · ") + M.fmt(s);
  const mineAll = lines().some((l) => l.phone === M.me());
  const why = C.split === "dishes" && !myPicks().length ? L("Отметнете поне едно ястие", "Tick at least one dish") : C.split === "guests" && !mineAll ? L("От този телефон няма поръчани ястия", "No dishes ordered from this phone") : L("Всичко вече е поискано", "Everything has already been asked for");
  return '<div class="shell"><div class="core cpad"><p class="qh">' + L("Как ще платите?", "How will you pay?") + "</p>" +
    '<div class="seg pay" role="group" aria-label="' + L("Плащане", "Payment") + '">' + (["cash", "card"] as const).map((k) => '<button type="button" data-pay="' + k + '" aria-pressed="' + (C.pay === k) + '">' + M.ic(PAY[k][2], 22) + L(PAY[k][0], PAY[k][1]) + "</button>").join("") + "</div>" +
    '<p class="qh" style="margin-top:20px">' + L("Как да я разделим?", "How should we split it?") + "</p>" +
    '<div class="seg split" role="group" aria-label="' + L("Разделяне", "Split") + '">' + (["one", "guests", "dishes"] as const).map((k) => '<button type="button" data-split="' + k + '" aria-pressed="' + (C.split === k) + '">' + L(SPLIT[k][0], SPLIT[k][1]) + "</button>").join("") + "</div>" +
    splitBox() +
    (C.split === "one" && part && !none ? '<div class="mine"><b>' + L("Остават", "Left to pay") + '</b><span class="price">' + M.fmt(s) + '</span></div><p class="fine">' + whoPays + L(" плаща своята част отделно. Тук остава само останалото.", " pays their share separately. Only the rest is left here.") + "</p>" : "") +
    (C.split !== "one" ? '<div class="mine"><b>' + L("Вие плащате", "You pay") + '</b><span class="price">' + M.fmt(s) + "</span></div>" : "") +
    (!M.offline ? '<button class="pill pill-red pill-lg pill-block reqbtn" type="button" data-req' + (none ? ' aria-disabled="true" data-why="' + M.esc(why) + '"' : "") + ">" + M.ic("receipt", 20) + (none ? why : btnTxt) + "</button>"
      : '<button class="pill pill-ink pill-lg pill-block reqbtn" type="button" data-mretry>' + M.ic("arrow-clockwise", 20) + L("Няма връзка · Опитай пак", "No connection · Try again") + "</button>") +
    "</div></div>";
}

let jumped = false;
function render(m: Masa) {
  M = m;
  const v = M.view, L = M.L, closed = v.status === "closed", n = lines().reduce((a, l) => a + l.q, 0);
  const focused = document.activeElement && (document.activeElement as HTMLElement).id === "fb";
  const fb = M.main.querySelector<HTMLTextAreaElement>("#fb");
  if (fb) R.fb = fb.value;
  M.main.innerHTML = '<section class="mpage" aria-labelledby="bl-h"><div class="mh"><h1 class="h1" id="bl-h">' + L("Сметката", "The bill") + '</h1><p class="lead">' + M.esc(M.tableLabel()) + " · " + L("всичко поръчано досега", "everything ordered so far") + "</p></div>" +
    '<div class="bg">' + (M.offline || M.lost ? '<div class="mnotes">' + M.banners({ kitchen: false }) + "</div>" : "") +
    (v.cart.n && !closed ? '<div class="mnote warn">' + M.ic("shopping-bag", 24) + "<div><b>" + M.dishes(v.cart.n) + (v.cart.n === 1 ? L(" в количката още не е изпратено", " in the cart is not sent yet") : L(" в количката още не са изпратени", " in the cart are not sent yet")) + "</b><p>" + (v.cart.n === 1 ? L("Не е в сметката. Изпратете го или го махнете.", "It is not on the bill. Send or remove it.") : L("Не са в сметката. Изпратете ги или ги махнете.", "They are not on the bill. Send or remove them.")) + '</p><div class="acts"><a class="pill pill-line" href="' + M.href("cart") + '">' + L("Към количката", "To the cart") + "</a></div></div></div>" : "") +
    '<div class="side">' + othersHTML() + (v.bill.mine || closed ? reqHTML() : askHTML()) + rateHTML() + "</div>" +
    '<section><div class="blk-h"><h2 class="h3">' + L("Поръчано", "Ordered") + '</h2><span class="muted small">' + M.dishes(n) + "</span></div>" + linesHTML(!v.bill.mine && !closed && C.split === "dishes") + "</section>" +
    "</div></section>";
  if (focused) { const t = M.main.querySelector<HTMLTextAreaElement>("#fb"); if (t) { t.focus({ preventScroll: true }); t.setSelectionRange(t.value.length, t.value.length); } }
  if (!jumped) { jumped = true; if (murl.hash().has("rate")) requestAnimationFrame(() => document.getElementById("rate")?.scrollIntoView()); }
}
function tick(m: Masa) { const s = m.main.querySelector("[data-wt]"), at = waitedAt(); if (s && at) s.textContent = m.mmss(m.since(at)); }

/** "По ястия": this phone's own dishes are ticked for it at once (the others tick theirs) */
async function autoPick() {
  const v = M.view, free = new Set(v.bill.free);
  const keys = lines().filter((l) => l.phone === M.me() && free.has(l.key) && !v.bill.picks[l.key]).map((l) => l.key);
  if (keys.length && !v.bill.mine) await M.act(() => masaApi.pick(M.code, keys, true));
}

const m = mountMasa({ screen: "bill", title: ["Сметката", "The bill"], allowClosed: true, render, tick });
M = m;
m.main.addEventListener("click", async (e) => {
  const t = (e.target as Element).closest<HTMLElement>("button, a");
  if (!t || !m.view) return;
  const L = m.L;
  if (t.dataset.pay) { C.pay = t.dataset.pay as "cash" | "card"; render(m); return; }
  if (t.dataset.split) { C.split = t.dataset.split as Split; render(m); if (C.split === "dishes") void autoPick(); return; }
  if (t.hasAttribute("data-req")) {
    if (t.getAttribute("aria-disabled")) { m.toast(t.dataset.why || ""); return; }
    const r = await m.act(() => masaApi.bill(m.code, { pay: C.pay, split: C.split }), { busy: t });
    if (r) { m.toast(L("Сервитьорът идва със сметката", "The waiter is bringing the bill")); scrollTo({ top: 0, behavior: SC.reduce ? "auto" : "smooth" }); }
    return;
  }
  if (t.dataset.rate) {
    R.changing = false; R.err = "";
    const r = await m.act(() => masaApi.rate(m.code, { happy: t.dataset.rate === "yes" }), { busy: t });
    if (r) m.main.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true });
    return;
  }
  if (t.hasAttribute("data-rate-reset")) { R.changing = true; render(m); m.main.querySelector<HTMLElement>('[data-rate="yes"]')?.focus(); return; }
  if (t.hasAttribute("data-fb")) {
    const v = (m.main.querySelector<HTMLTextAreaElement>("#fb") || { value: "" }).value;
    R.fb = v;
    if (v.trim().length < 3) { R.err = L("Напишете няколко думи, за да го изпратим.", "Write a few words so we can send it."); render(m); m.main.querySelector<HTMLElement>("#fb")?.focus(); return; }
    R.err = "";
    const r = await m.act(() => masaApi.rate(m.code, { happy: false, text: v.trim() }), { busy: t });
    if (r) { R.fb = ""; m.toast(L("Изпратено на управителя", "Sent to the manager")); }
    return;
  }
  if (t.hasAttribute("data-copy")) {
    const c = m.view.rating ? m.view.rating.code : "";
    try { void navigator.clipboard.writeText(c).catch(() => { /* not allowed */ }); } catch { /* no clipboard */ }
    SC.flash(t, m.ic("check", 18) + L("Копирано", "Copied"));
    return;
  }
  if (t.hasAttribute("data-google")) { m.toast(L("Линкът към профила в Google още липсва.", "The link to our Google profile is still missing.")); return; }
});
m.main.addEventListener("change", async (e) => {
  const i = e.target as HTMLInputElement, k = i.dataset.pick;
  if (!k) return;
  const r = await m.act(() => masaApi.pick(m.code, k, i.checked));
  if (!r) render(m);
});
