/* Celebration calculator (/praznik/): the light part (no menu): the steps, the summary, the bar and the success screen
   as pure functions of the state, the same on the server (Astro draws step 1 and the summary) and in the browser
   (./_praznik.ts redraws after every change). The package cards, their prices and the dish picker need the menu and
   live in ./_menu.ts (server; in the browser only after "Собствено меню"). Rules (design/PAGES.md "celebration.html",
   decision 28, OPEN-QUESTIONS 3 and 13): the admin chooses "estimate" or "offer" for the price and the days for the
   -5% early booking (GET /api/status: celebrationPrice, earlyDays); earlyDays null = [ЛИПСВА], no -5% is computed.
   Capacity, cakes, decoration and the call-back time are [ЛИПСВА]. */
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural, MONTHS, DAYS_SHORT, prettyPhone } from "../../lib/format.ts";
import { RESTAURANT as R } from "../../lib/consts.ts";
import { url } from "../../lib/routes.ts";
import { stepperHTML, MKT_TITLE, MKT_SUB } from "../../lib/ui.ts";

export const TEL = "tel:" + R.phoneIntl;

/* ---------- data (only real dishes) ---------- */
export const TYPES = [
  { id: "rozhden-den", n: "Рожден ден", ic: "cake" }, { id: "krashtene", n: "Кръщене", ic: "baby" },
  { id: "yubiley", n: "Юбилей", ic: "heart" }, { id: "firmeno-parti", n: "Фирмено парти", ic: "briefcase" },
  { id: "abiturientski", n: "Абитуриентски", ic: "star" }, { id: "detski", n: "Детски празник", ic: "balloon" },
  { id: "drugo", n: "Друг повод", ic: "confetti", wide: true },
];
export type Group = "app" | "starter" | "main" | "dessert";
export const GROUP_IDS: Group[] = ["app", "starter", "main", "dessert"];
export const GROUP_NAMES: Record<Group, string> = { app: "Апетайзери", starter: "Предястие", main: "Основно", dessert: "Десерт" };
export const SHARE_PER = 4;
/** a package without the menu (computed on the server by ./_menu.ts): total = a × guests + b × ceil(guests / SHARE_PER) */
export interface PkgInfo { id: string; n: string; items: string[]; a: number; b: number }
export const ZONES = [
  { id: "salon", n: "Салон", ic: "chair", sub: "В ресторанта" },
  { id: "garden", n: "Отоплявана градина", ic: "tree", sub: "Отоплява се през зимата" },
  { id: "all", n: "Цялото място", ic: "house", sub: "Салон и градина само за вас" },
] as const;
export const CAKES: [string, string][] = [["none", "Без торта"], ["ours", "От нас"], ["bring", "Носим наша"]];
export const WISHES = ["Балони", "Цветя", "Надпис с име", "В цветовете на повода"];
export const TIMES: string[] = [];
for (let h = 11; h <= 20; h++) { TIMES.push((h < 10 ? "0" : "") + h + ":00"); if (h < 20) TIMES.push(h + ":30"); }
export const STEPS = ["Повод и гости", "Меню", "Торта, украса и данни"];
export const G_MIN = 2, G_MAX = 200;
/** The admin decides whether guests see a price (OPEN-QUESTIONS 3, setting celebrationPrice in /api/status).
    Until the status arrives (and on the server) the page shows "offer". */
export const PRICE_DEFAULT: "show" | "offer" = "offer";

/* ---------- state ---------- */
export interface St {
  step: number; type: string | null; guests: number; date: string; time: string; zone: string; menu: string | null;
  picks: string[]; pg: Group; pc: Partial<Record<Group, string>>; cake: string; cakeNote: string; decor: string; wishes: string[];
  name: string; phone: string; email: string; note: string; consent: boolean;
}
export function fresh(): St {
  return { step: 1, type: null, guests: 20, date: "", time: "19:00", zone: "salon", menu: null, picks: [], pg: "app", pc: {}, cake: "none", cakeNote: "",
    decor: "no", wishes: [], name: "", phone: "", email: "", note: "", consent: false };
}
/** everything the HTML depends on */
export interface View {
  S: St; price: "show" | "offer"; sent: boolean; sending: boolean; restored: boolean;
  /** the packages without the menu (name, dish ids, price sums) */
  pk: Record<string, PkgInfo>;
  /** the admin's days for the -5% early booking; null = [ЛИПСВА] (no -5% is computed) */
  earlyDays: number | null;
  /** -5% applies: the chosen date is at least earlyDays away (or, only in preview while earlyDays is null, the example switch) */
  early: boolean;
  /** tomorrow and one year ahead in Sofia, "YYYY-MM-DD" (the date field); "" on the server (set in the browser) */
  minDate: string; maxDate: string;
  /** the restaurant is open now (success screen: "ще ви потърсим ...") and before opening today */
  open: boolean; beforeOpen: boolean;
}

/* ---------- helpers ---------- */
const parse = (s: string): Date | null => { if (!s) return null; const a = s.split("-"); const d = new Date(+a[0], +a[1] - 1, +a[2]); return isNaN(+d) ? null : d; };
export function dateText(s: string): string { const d = parse(s); return d ? DAYS_SHORT[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] : ""; }
export const guestsText = (n: number) => n + " " + (n === 1 ? "гост" : "гости");
export const typeName = (S: St) => TYPES.find((x) => x.id === S.type)?.n || "";
export const zoneName = (S: St) => ZONES.find((x) => x.id === S.zone)?.n || "";
export const cakeName = (S: St) => ({ none: "Без торта", ours: "Торта от ресторанта", bring: "Носим наша" } as Record<string, string>)[S.cake] || "";
export const pkgTotal = (p: PkgInfo, n: number) => p.a * n + p.b * Math.ceil(n / SHARE_PER);
export interface Calc { pkg: PkgInfo | null; custom: boolean; early: boolean; food: number; per: number; disc: number; total: number }
export function calc(v: View): Calc {
  const pkg = (v.S.menu && v.pk[v.S.menu]) || null;
  const r: Calc = { pkg, custom: v.S.menu === "custom", early: v.early, food: 0, per: 0, disc: 0, total: 0 };
  if (pkg) { r.food = pkgTotal(pkg, v.S.guests); r.per = r.food / v.S.guests; r.disc = r.early ? r.food * 0.05 : 0; r.total = r.food - r.disc; }
  return r;
}
const errHTML = (id: string) => '<p class="err" id="' + id + '" hidden></p>';
const icInline = (n: string, s: number, va: number) => ic(n, s).replace('class="ic"', 'class="ic" style="display:inline;vertical-align:' + va + 'px"');

/* ---------- stepper (shared .stepper) ---------- */
export function stepper(S: St): string {
  return stepperHTML(S.step, 3, STEPS[S.step]); /* the same words in every flow (lib/ui.ts) */
}

/* ---------- step 1: occasion, guests, date, place ---------- */
export function step1(v: View): string {
  const S = v.S;
  return '<h2 class="h2" tabindex="-1" data-focus>Повод и гости</h2>' +
    '<div class="blk" id="b-type"><div class="blk-h"><h3 class="h3" id="l-type">Какъв е поводът?</h3></div><div class="tiles" role="radiogroup" aria-labelledby="l-type">' +
    TYPES.map((t) => { const on = S.type === t.id; return '<label class="tile' + (t.wide ? " wide" : "") + (on ? " on" : "") + '"><input class="vh" type="radio" name="ctype" value="' + t.id + '"' + (on ? " checked" : "") + '><span class="bub">' + ic(t.ic, 24) + "</span><span>" + t.n + "</span></label>"; }).join("") + "</div>" + errHTML("e-type") + "</div>" +
    '<div class="blk"><div class="blk-h"><h3 class="h3"><label for="guests">Колко гости?</label></h3><span class="opt">заедно с децата</span></div><div class="guests">' +
    '<div class="gcount"><button type="button" data-g="-1" aria-label="С един гост по-малко"' + (S.guests <= G_MIN ? " disabled" : "") + ">" + ic("minus", 22) + '</button><span class="gnum"><input id="guests" type="number" inputmode="numeric" min="' + G_MIN + '" max="' + G_MAX + '" value="' + S.guests + '" aria-describedby="g-help"><small aria-hidden="true">гости</small></span><button type="button" data-g="1" aria-label="С един гост повече"' + (S.guests >= G_MAX ? " disabled" : "") + ">" + ic("plus", 22) + "</button></div>" +
    '<div class="gquick" role="group" aria-label="Бърз избор на брой гости">' + [10, 20, 30, 50].map((n) => '<button class="chip" type="button" data-gset="' + n + '" aria-pressed="' + (S.guests === n) + '" aria-label="' + n + ' гости">' + n + "</button>").join("") + "</div></div>" +
    '<p class="help" id="g-help">Не е нужно да е точно. Броят се уточнява с управителя.</p>' + errHTML("e-guests") + "</div>" +
    '<div class="blk" id="b-date"><div class="blk-h"><h3 class="h3">Кога?</h3></div><div class="when">' +
    '<div class="field"><label for="cdate">Дата</label><input class="input" type="date" id="cdate"' + (v.minDate ? ' min="' + v.minDate + '" max="' + v.maxDate + '"' : "") + ' value="' + esc(S.date) + '" aria-describedby="e-date early"></div>' +
    '<div class="field"><label for="ctime">Начален час</label><div class="selw"><select class="input" id="ctime">' + TIMES.map((t) => "<option" + (S.time === t ? " selected" : "") + ">" + t + "</option>").join("") + "</select>" + ic("caret-down", 18) + "</div></div></div>" +
    errHTML("e-date") + '<div class="early' + (v.early ? " on" : "") + '" id="early" data-early aria-live="polite">' + earlyHTML(v) + "</div></div>" +
    '<div class="blk"><div class="blk-h"><h3 class="h3" id="l-zone">Къде?</h3></div><div class="zones" role="radiogroup" aria-labelledby="l-zone">' +
    ZONES.map((z) => { const on = S.zone === z.id; return '<label class="zone' + (on ? " on" : "") + '"><input class="vh" type="radio" name="czone" value="' + z.id + '"' + (on ? " checked" : "") + '><span class="bub">' + ic(z.ic, 24) + "</span><span><b>" + z.n + "</b><small>" + z.sub + '</small></span><span class="radio">' + ic("check", 16) + "</span></label>"; }).join("") + "</div>" +
    '<p class="note-auto" style="margin-top:14px">' + ic("info", 18) + '<span>Колко гости събира всяка зона: <span class="missing">[ЛИПСВА: капацитет]</span>. Ще уточним мястото заедно според броя гости.</span></p></div>';
}
export function earlyHTML(v: View): string {
  const d = v.earlyDays;
  if (d == null) return v.early
    ? ic("seal-percent", 22) + '<span><b>Ранна резервация: -5% от крайната цена.</b><br>Пример в прегледа. Колко дни по-рано: <span class="missing">[ЛИПСВА: колко дни по-рано]</span></span>'
    : ic("seal-percent", 22) + '<span><b>-5% при ранна резервация за празник.</b><br>Колко дни по-рано: <span class="missing">[ЛИПСВА: колко дни по-рано]</span>. Потвърждава се в офертата.</span>';
  return v.early
    ? ic("seal-percent", 22) + "<span><b>Ранна резервация: -5% от крайната цена.</b><br>Празникът е поне " + plural(d, "ден", "дни") + " напред. Потвърждава се в офертата.</span>"
    : ic("seal-percent", 22) + "<span><b>-5% при ранна резервация за празник.</b><br>Важи, когато запитването е поне " + plural(d, "ден", "дни") + " преди празника.</span>";
}

/* ---------- step 2: menu ---------- */
export function pkgFoot(v: View, p: PkgInfo): string {
  if (v.price !== "show") return '<span class="offer">Цена с оферта</span><span class="per">' + ic("receipt", 18) + "</span>";
  const n = v.S.guests, tot = pkgTotal(p, n);
  return '<span><span class="price">≈ ' + fmt(tot / n) + '</span> <span class="per">на гост</span></span><span class="tot">за ' + guestsText(n) + " ≈ " + fmt(tot) + (v.early ? ", преди -5%" : "") + "</span>";
}
export function skeletons(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += '<div class="skel" style="height:' + (i < 3 ? 380 : 220) + 'px;border-radius:22px" aria-hidden="true"></div>';
  return s + '<span class="vh" role="status">Зареждаме пакетите</span>';
}
/** pkgs: the package cards (from the server's <template>, or skeletons); picker: the dish picker or "" */
export function step2(pkgs: string, picker: string): string {
  return '<h2 class="h2" tabindex="-1" data-focus>Меню</h2><p class="lead">Изберете готов пакет от нашето меню или си направете собствено.</p>' +
    '<div class="pkgs" role="radiogroup" aria-label="Меню за празника" id="b-menu" data-pkgs>' + pkgs + "</div>" + errHTML("e-menu") +
    "<div data-picker>" + picker + "</div>" +
    '<p class="note-auto" style="margin-top:20px">' + ic("info", 18) + '<span>Напитките не са включени. <span class="missing">[ЛИПСВА: бар и винена карта]</span> Вегетарианци и алергии напишете в бележката на следващата стъпка.</span></p>';
}
/** the picker while ./_menu.ts loads */
export function pickerLoading(): string {
  return '<div class="picker" id="b-picker"><div class="blk-h"><h3 class="h3">Вашето меню</h3><span class="opt">изберете от всяка група</span></div>' +
    '<div class="skel" style="height:64px;border-radius:24px" aria-hidden="true"></div><div class="skel" style="height:320px;border-radius:22px;margin-top:14px" aria-hidden="true"></div>' +
    '<span class="vh" role="status">Зареждаме менюто</span>' + errHTML("e-picks") + "</div>";
}

/* ---------- step 3: cake, decor, contact ---------- */
function seg(name: string, opts: [string, string][], val: string): string {
  return '<div class="seg" role="group" aria-labelledby="l-' + name + '">' + opts.map((o) => '<button type="button" data-seg="' + name + '" data-v="' + o[0] + '" aria-pressed="' + (val === o[0]) + '">' + o[1] + "</button>").join("") + "</div>";
}
export function step3(v: View): string {
  const S = v.S;
  return '<h2 class="h2" tabindex="-1" data-focus>Торта, украса и данни</h2>' +
    '<div class="blk"><div class="blk-h"><h3 class="h3" id="l-cake">Торта</h3></div>' + seg("cake", CAKES, S.cake) +
    '<div class="reveal-box" data-cakebox="ours"' + (S.cake === "ours" ? "" : " hidden") + '><div class="field"><label for="cakenote">Вкус и надпис <span class="opt">(по желание)</span></label><input class="input" id="cakenote" type="text" maxlength="200" value="' + esc(S.cakeNote) + '" placeholder="Например шоколад, „Честит рожден ден, Мария“"></div><p class="help" style="margin:0"><span class="missing">[ЛИПСВА: видове торти и цени]</span></p></div>' +
    '<div class="reveal-box" data-cakebox="bring"' + (S.cake === "bring" ? "" : " hidden") + '><p class="help" style="margin:0">Ще я съхраним и сервираме. <span class="missing">[ЛИПСВА: условия за собствена торта]</span></p></div></div>' +
    '<div class="blk"><div class="blk-h"><h3 class="h3" id="l-decor">Украса</h3></div>' + seg("decor", [["no", "Без украса"], ["yes", "Искаме украса"]], S.decor) +
    '<div class="reveal-box" data-decorbox' + (S.decor === "yes" ? "" : " hidden") + '><div class="wishes" role="group" aria-label="Какво си представяте">' + WISHES.map((w) => '<button class="chip" type="button" data-wish="' + esc(w) + '" aria-pressed="' + S.wishes.includes(w) + '">' + esc(w) + "</button>").join("") + '</div><p class="help" style="margin:0"><span class="missing">[ЛИПСВА: варианти и цени на украсата]</span></p></div></div>' +
    '<div class="blk"><div class="blk-h"><h3 class="h3">Вашите данни</h3><span class="opt">за да ви се обадим</span></div><div class="fields">' +
    '<div class="field"><label for="cname">Име</label><input class="input" id="cname" type="text" autocomplete="name" maxlength="80" value="' + esc(S.name) + '" aria-describedby="e-name">' + errHTML("e-name") + "</div>" +
    '<div class="field"><label for="cphone">Телефон</label><input class="input" id="cphone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" value="' + esc(S.phone) + '" placeholder="0888 12 34 56" aria-describedby="e-phone">' + errHTML("e-phone") + "</div>" +
    '<div class="field"><label for="cemail">Имейл <span class="opt">(по желание, за писмена оферта)</span></label><input class="input" id="cemail" type="email" autocomplete="email" maxlength="120" value="' + esc(S.email) + '" placeholder="ime@primer.bg" aria-describedby="e-email">' + errHTML("e-email") + "</div>" +
    '<div class="field"><label for="cnote">Бележка <span class="opt">(по желание)</span></label><textarea class="input" id="cnote" rows="3" maxlength="1000" placeholder="Вегетарианци, алергии, детски столчета, музика">' + esc(S.note) + "</textarea></div>" +
    '<label class="check"><input type="checkbox" id="cconsent"' + (S.consent ? " checked" : "") + '><span><b>' + MKT_TITLE + '</b><br><span class="muted small">' + MKT_SUB + "</span></span></label></div>" +
    '<p class="fine">' + ic("lock", 18) + "<span>Запитването не ви задължава. Не плащате нищо онлайн. Телефонът ви е само за връзка за празника.</span></p>" +
    '<div class="alert" role="alert" data-alert hidden></div></div>';
}

/* ---------- the flow (stepper + current step) ---------- */
/** step2: the HTML of step 2 (the browser builds it; the server draws only step 1) */
export function flowHTML(v: View, dir = "", step2html = ""): string {
  if (v.sent) return successHTML(v);
  const S = v.S;
  const body = S.step === 1 ? step1(v) : S.step === 2 ? step2html : step3(v);
  return (v.restored ? '<p class="draft">' + ic("clock", 18) + '<span>Продължавате оттам, докъдето стигнахте.</span><button class="link" type="button" data-reset>Започни отначало</button></p>' : "") +
    stepper(S) + '<div class="panel' + (dir ? " " + dir : "") + '" data-panel>' + body + "</div>";
}

/* ---------- summary (desktop aside, phone sheet, success) ---------- */
export function summaryHTML(v: View, forSheet: boolean): string {
  const S = v.S, c = calc(v);
  const row = (k: string, val: string) => '<div class="kv"><span>' + k + "</span>" + (val ? "<b>" + val + "</b>" : '<b class="none">не е избрано</b>') + "</div>";
  const menuTxt = c.pkg ? c.pkg.n : c.custom ? "Собствено меню" + (S.picks.length ? " · " + plural(S.picks.length, "ястие", "ястия") : "") : "";
  let h = (forSheet ? "" : '<div class="sum-h"><h3 class="h3">Вашият празник</h3></div>') + '<div class="sum">' +
    row("Повод", typeName(S)) + row("Гости", guestsText(S.guests)) + row("Дата", S.date ? dateText(S.date) + " · " + S.time : "") + row("Място", zoneName(S)) + row("Меню", esc(menuTxt)) +
    (S.step === 3 || v.sent ? row("Торта", cakeName(S)) + row("Украса", S.decor === "yes" ? (S.wishes.length ? esc(S.wishes.join(", ")) : "Да") : "Без украса") : "");
  let pr = "";
  if (c.custom) pr = '<div class="sum-offer">' + ic("phone", 20) + "<span>Собствено меню: свържете се с нас за оферта.</span></div>";
  else if (v.price !== "show") pr = '<div class="sum-offer">' + ic("receipt", 20) + "<span>Цена: ще ви изпратим оферта.</span></div>" + (c.early ? '<p class="sum-note">' + icInline("seal-percent", 16, -3) + " Ранна резервация: -5% от крайната цена.</p>" : "");
  else if (c.pkg) pr = '<div class="kv"><span>Храна, ' + S.guests + " × " + fmt(c.per) + '</span><b class="price">' + fmt(c.food) + "</b></div>" +
    (c.early ? '<div class="kv disc"><span>Ранна резервация -5%' + (v.earlyDays == null ? " (пример)" : "") + '</span><b class="price">-' + fmt(c.disc) + "</b></div>" : "") +
    '<div class="sum-total"><span>Ориентировъчно</span><span class="price">' + fmt(c.total) + "</span></div>";
  else pr = '<div class="sum-offer">' + ic("fork-knife", 20) + "<span>Цената се появява, щом изберете меню.</span></div>" + (c.early ? '<p class="sum-note">Ранна резервация: -5% от крайната цена.</p>' : "");
  h += '<div class="sum-price">' + pr + "</div>";
  if (c.pkg && v.price === "show") h += '<p class="sum-note">Без напитки и торта. Ястията за споделяне са по 1 порция на ' + SHARE_PER + " гости. Окончателната цена е в офертата.</p>";
  return h + "</div>";
}
export function nextLabel(v: View, compact: boolean): string {
  if (v.sending) return '<span class="spin" aria-hidden="true"></span>Изпращаме...';
  const arr = compact ? "" : ic("arrow-right", 20), s = v.S.step;
  /* "Напред: <next step>": "Към менюто" leads to /menu/ everywhere else (site.review-consistency В5) */
  return s < 3 ? "Напред: " + STEPS[s] + arr : "Изпрати запитване" + (compact ? "" : ic("paper-plane-right", 20));
}
export function asideHTML(v: View): string {
  const S = v.S;
  return summaryHTML(v, false) + '<div class="sum-btns"><button class="pill pill-line pill-lg" type="button" data-back' + (S.step > 1 ? "" : " hidden") + ">" + ic("arrow-left", 20) + 'Назад</button><button class="pill pill-red pill-lg" type="button" data-next' + (v.sending ? ' aria-busy="true"' : "") + ">" + nextLabel(v, S.step > 1) + "</button></div>" +
    '<div class="sum-call"><a class="link" href="' + TEL + '">' + ic("phone", 18) + "Или се обадете · " + R.phone + "</a></div>";
}
export function barSummary(v: View): string {
  const c = calc(v), up = ic("caret-up", 18);
  if (c.custom) return "<span><small>Собствено меню</small></span><b>С оферта" + up + "</b>";
  if (c.pkg && v.price === "show") return "<span><small>Ориентировъчно" + (c.early ? ", с -5%" : "") + '</small></span><b class="price">' + fmt(c.total) + up + "</b>";
  if (c.pkg) return "<span><small>Цена</small></span><b>С оферта" + up + "</b>";
  return "<span><small>Вашият празник</small></span><b>" + guestsText(v.S.guests) + up + "</b>";
}
export function barHTML(v: View): string {
  return '<button class="sumbtn" type="button" data-sum aria-haspopup="dialog">' + barSummary(v) + '<span class="vh">. Виж какво включва празникът и цената</span></button>' +
    '<div class="cbtns"><button class="pill pill-line" type="button" data-back' + (v.S.step < 2 ? " hidden" : "") + ">" + ic("arrow-left", 20) + 'Назад</button><button class="pill pill-red" type="button" data-next>' + nextLabel(v, v.S.step > 1) + "</button></div>";
}

/* ---------- success ---------- */
export function successHTML(v: View): string {
  const S = v.S;
  const C: [string, number, number, number][] = [["e", -58, -26, 40], ["r", 54, -40, -30], ["o", -44, 40, 70], ["k", 62, 22, 15], ["e", 4, -62, -60], ["r", -70, 6, 110], ["o", 30, 58, -80], ["e", 72, -6, 35], ["r", -20, -58, 20], ["k", -62, -44, -45], ["o", 44, -60, 60], ["e", -30, 62, 95]];
  const conf = C.map((c) => '<i class="' + c[0] + '" style="--x:' + c[1] + "px;--y:" + c[2] + "px;--r:" + c[3] + 'deg"></i>').join("");
  return '<div class="shell done"><div class="core"><div class="burst" aria-hidden="true">' + conf + '<span class="ok">' + ic("check", 48) + "</span></div>" +
    '<h2 class="h2" tabindex="-1" data-focus>Запитването е изпратено</h2>' +
    '<p class="lead">Управителят ще ви се обади <span class="missing">до 24 часа</span> на ' + esc(prettyPhone(S.phone)) + '.</p><p class="help" style="margin:0"><span class="missing">[ЛИПСВА: срок за обаждане]</span></p>' +
    (!v.open ? '<p class="night">Сега сме затворени, затова ще ви потърсим ' + (v.beforeOpen ? "днес" : "утре") + " след " + R.open + ".</p>" : "") +
    summaryHTML(v, true) +
    '<div class="btns"><a class="pill pill-line pill-lg" href="' + url.page("events") + '">' + ic("calendar-blank", 20) + 'Към събитията и поводите</a><button class="link" type="button" data-again style="justify-self:center">Ново запитване</button></div></div></div>';
}

/* ---------- the inquiry for api.celebrations.create ---------- */
/** the start time, the cake wishes and the decoration wishes have their own fields (time, cakeNote, wishes): the note is only the guest's */
export function inquiryNote(S: St): string | undefined { return S.note.trim() || undefined; }
