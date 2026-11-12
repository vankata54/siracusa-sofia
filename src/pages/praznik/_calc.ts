/* Celebration calculator (/praznik/): data and HTML of the steps, port of design/pages/celebration.html.
   Pure functions of the state, the same on the server (Astro draws step 1 and the summary for SEO and the first paint)
   and in the browser (./_praznik.ts redraws after every change). Packages only from the real dishes (lib/data.ts),
   prices from the menu. Rules (design/PAGES.md "celebration.html", decision 28, OPEN-QUESTIONS 3 and 13):
   - price for the guest: "show" (ориентировъчна) or "offer" (ще ви изпратим оферта); the admin decides, the core has no
     such setting yet, so the page shows "offer" (PRICE_DEFAULT) and the preview panel switches it;
   - -5% early booking only for a celebration; how many days earlier is [ЛИПСВА], so it is never computed from the date
     (only shown as an example in the preview panel);
   - capacity, cakes, decoration and the call-back time are [ЛИПСВА]. */
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural, MONTHS, DAYS_SHORT } from "../../lib/format.ts";
import { byId, inCat, catById, RESTAURANT as R, type Dish } from "../../lib/data.ts";
import { art, badges } from "../../lib/render.ts";
import { url } from "../../lib/routes.ts";
import "../../lib/icons/arrow-left.ts";
import "../../lib/icons/arrow-right.ts";
import "../../lib/icons/seal-percent.ts";
import "../../lib/icons/fork-knife.ts";
import "../../lib/icons/map-pin.ts";
import "../../lib/icons/phone.ts";
import "../../lib/icons/sliders-horizontal.ts";
import "../../lib/icons/cake.ts";
import "../../lib/icons/baby.ts";
import "../../lib/icons/heart.ts";
import "../../lib/icons/briefcase.ts";
import "../../lib/icons/star.ts";
import "../../lib/icons/balloon.ts";
import "../../lib/icons/confetti.ts";
import "../../lib/icons/minus.ts";
import "../../lib/icons/plus.ts";
import "../../lib/icons/caret-down.ts";
import "../../lib/icons/caret-up.ts";
import "../../lib/icons/info.ts";
import "../../lib/icons/chair.ts";
import "../../lib/icons/tree.ts";
import "../../lib/icons/house.ts";
import "../../lib/icons/check.ts";
import "../../lib/icons/receipt.ts";
import "../../lib/icons/list-checks.ts";
import "../../lib/icons/warning-circle.ts";
import "../../lib/icons/lock.ts";
import "../../lib/icons/clock.ts";
import "../../lib/icons/paper-plane-right.ts";
import "../../lib/icons/calendar-blank.ts";

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
/* [id, share]: "share" dishes are counted 1 portion per SHARE_PER guests (prototype rule until the admin sets the logic) */
type PkgDish = [string, 1?];
export interface Pkg { id: string; n: string; d: string; g: Record<Group, PkgDish[]> }
export const PKGS: Pkg[] = [
  { id: "klasicheski", n: "Класически", d: "Българска трапеза: колбаси, шопска салата и кебапчета от скарата.",
    g: { app: [["set-ot-balgarski-kolbasi", 1], ["urnabes-razyadka-s-brusketi", 1]], starter: [["shopska-salata"]], main: [["kebapcheta"]], dessert: [["tiramisu"]] } },
  { id: "pesht-i-skara", n: "Пещ и скара", d: "Пици от пещта за споделяне и свински ребра от фурната Bertha.",
    g: { app: [["pitsa-margarita", 1], ["pitsa-s-burata-i-proshuto-krudo", 1]], starter: [["gratska-salata"]], main: [["svinski-rebra"], ["parzheni-kartofi"]], dessert: [["pitsa-nutela", 1]] } },
  { id: "butikov", n: "Бутиков", d: "Скариди, френски сирена, капрезе с бурата и патешко магре.",
    g: { app: [["skaridi-s-maslo-chesan-byalo-vino-sovinyon-blan", 1], ["plato-frenski-sirena", 1]], starter: [["kapreze-s-burata-i-avokado"]], main: [["pateshko-magre-s-pyure-ot-tselina-i-sladko-ot-vi"]], dessert: [["sufle"]] } },
];
export const PKG: Record<string, Pkg> = Object.fromEntries(PKGS.map((p) => [p.id, p]));
export const SHARE_PER = 4;
export const GROUPS: { id: Group; cats: string[] }[] = [
  { id: "app", cats: ["studeni-predyastia", "topli-predyastia", "hlebcheta"] },
  { id: "starter", cats: ["salati", "supi"] },
  { id: "main", cats: ["skara-bertha", "pitsi", "osnovni-yastia", "pasta-i-rizoto", "burgeri", "garnituri"] },
  { id: "dessert", cats: ["deserti", "pitsi"] },
];
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
/** The admin decides whether guests see a price (OPEN-QUESTIONS 3). No setting in the core yet: "offer". */
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
  S: St; price: "show" | "offer"; early: boolean; sent: boolean; sending: boolean; restored: boolean;
  /** tomorrow in Sofia, "YYYY-MM-DD" (min of the date field); "" on the server (set in the browser) */
  minDate: string;
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
interface PkgItem { g: Group; x: Dish; share: boolean }
export function pkgItems(p: Pkg): PkgItem[] {
  const out: PkgItem[] = [];
  GROUP_IDS.forEach((g) => p.g[g].forEach((z) => out.push({ g, x: byId[z[0]], share: !!z[1] })));
  return out;
}
export const pkgTotal = (p: Pkg, n: number) => pkgItems(p).reduce((a, it) => a + it.x.p * (it.share ? Math.ceil(n / SHARE_PER) : n), 0);
export interface Calc { pkg: Pkg | null; custom: boolean; early: boolean; food: number; per: number; disc: number; total: number }
export function calc(v: View): Calc {
  const pkg = (v.S.menu && PKG[v.S.menu]) || null;
  const r: Calc = { pkg, custom: v.S.menu === "custom", early: v.early, food: 0, per: 0, disc: 0, total: 0 };
  if (pkg) { r.food = pkgTotal(pkg, v.S.guests); r.per = r.food / v.S.guests; r.disc = r.early ? r.food * 0.05 : 0; r.total = r.food - r.disc; }
  return r;
}
/* "Изчерпано днес" is about today, not the party date */
const cleanTags = (x: Dish): Dish => ({ ...x, t: x.t.filter((k) => k !== "out") });
export function itemsFor(g: Group, cat: string): Dish[] {
  return inCat(cat).filter((x) => (cat === "pitsi" ? (g === "dessert" ? x.course === "dessert" : x.course !== "dessert") : true));
}
const catLabel = (g: Group, cat: string) => (cat === "pitsi" && g === "dessert" ? "Сладка пица" : catById[cat].n);
export function groupOf(id: string): Group {
  const x = byId[id];
  for (const gr of GROUPS) if (gr.cats.includes(x.cat) && itemsFor(gr.id, x.cat).includes(x)) return gr.id;
  return "main";
}
export const picksIn = (S: St, g: Group) => S.picks.filter((id) => byId[id] && groupOf(id) === g);
const errHTML = (id: string) => '<p class="err" id="' + id + '" hidden></p>';
const icInline = (n: string, s: number, va: number) => ic(n, s).replace('class="ic"', 'class="ic" style="display:inline;vertical-align:' + va + 'px"');

/* ---------- hero art (server) ---------- */
export function feastHTML(): string {
  return '<div class="feast" aria-hidden="true">' +
    '<span class="cf e" style="left:8%;top:14%;transform:rotate(24deg)"></span><span class="cf r c" style="left:20%;top:80%"></span><span class="cf o" style="left:47%;top:7%;transform:rotate(-30deg)"></span>' +
    '<span class="cf i" style="left:63%;top:86%;transform:rotate(50deg)"></span><span class="cf e c" style="left:86%;top:12%"></span><span class="cf r" style="left:93%;top:66%;transform:rotate(-14deg)"></span>' +
    '<span class="cf o c" style="left:4%;top:56%"></span><span class="cf e" style="left:34%;top:88%;transform:rotate(70deg)"></span>' +
    '<span class="pl p1">' + art("pitsa-s-burata-i-proshuto-krudo") + '</span><span class="pl p2">' + art("svinski-rebra") + '</span><span class="pl p3">' + art("gratska-salata") + '</span><span class="pl p4">' + art("sufle") + "</span></div>";
}

/* ---------- stepper (shared .stepper) ---------- */
export function stepper(S: St): string {
  const next = S.step < 3 ? "<span>Следва: <b>" + STEPS[S.step] + "</b></span>" : "<b>Последна стъпка</b>";
  return '<div class="stepper" style="--n:3"><div class="t"><span>Стъпка ' + S.step + " от 3</span>" + next + '</div><div class="bar" aria-hidden="true">' +
    STEPS.map((_, i) => '<span class="' + (i + 1 <= S.step ? "on" : "") + '"></span>').join("") + "</div></div>";
}

/* ---------- step 1: occasion, guests, date, place ---------- */
export function step1(v: View): string {
  const S = v.S;
  return '<h2 class="h2" tabindex="-1" data-focus><span class="vh">Стъпка 1 от 3: </span>Повод и гости</h2>' +
    '<div class="blk" id="b-type"><div class="blk-h"><h3 class="h3" id="l-type">Какъв е поводът?</h3></div><div class="tiles" role="radiogroup" aria-labelledby="l-type">' +
    TYPES.map((t) => { const on = S.type === t.id; return '<label class="tile' + (t.wide ? " wide" : "") + (on ? " on" : "") + '"><input class="vh" type="radio" name="ctype" value="' + t.id + '"' + (on ? " checked" : "") + '><span class="bub">' + ic(t.ic, 24) + "</span><span>" + t.n + "</span></label>"; }).join("") + "</div>" + errHTML("e-type") + "</div>" +
    '<div class="blk"><div class="blk-h"><h3 class="h3"><label for="guests">Колко гости?</label></h3><span class="opt">заедно с децата</span></div><div class="guests">' +
    '<div class="gcount"><button type="button" data-g="-1" aria-label="С един гост по-малко"' + (S.guests <= G_MIN ? " disabled" : "") + ">" + ic("minus", 22) + '</button><span class="gnum"><input id="guests" type="number" inputmode="numeric" min="' + G_MIN + '" max="' + G_MAX + '" value="' + S.guests + '" aria-describedby="g-help"><small aria-hidden="true">гости</small></span><button type="button" data-g="1" aria-label="С един гост повече"' + (S.guests >= G_MAX ? " disabled" : "") + ">" + ic("plus", 22) + "</button></div>" +
    '<div class="gquick" role="group" aria-label="Бърз избор на брой гости">' + [10, 20, 30, 50].map((n) => '<button class="chip" type="button" data-gset="' + n + '" aria-pressed="' + (S.guests === n) + '" aria-label="' + n + ' гости">' + n + "</button>").join("") + "</div></div>" +
    '<p class="help" id="g-help">Не е нужно да е точно. Броят се уточнява с управителя.</p>' + errHTML("e-guests") + "</div>" +
    '<div class="blk" id="b-date"><div class="blk-h"><h3 class="h3">Кога?</h3></div><div class="when">' +
    '<div class="field"><label for="cdate">Дата</label><input class="input" type="date" id="cdate"' + (v.minDate ? ' min="' + v.minDate + '"' : "") + ' value="' + esc(S.date) + '" aria-describedby="e-date early"></div>' +
    '<div class="field"><label for="ctime">Начален час</label><div class="selw"><select class="input" id="ctime">' + TIMES.map((t) => "<option" + (S.time === t ? " selected" : "") + ">" + t + "</option>").join("") + "</select>" + ic("caret-down", 18) + "</div></div></div>" +
    errHTML("e-date") + '<div class="early' + (v.early ? " on" : "") + '" id="early" data-early aria-live="polite">' + earlyHTML(v) + "</div></div>" +
    '<div class="blk"><div class="blk-h"><h3 class="h3" id="l-zone">Къде?</h3></div><div class="zones" role="radiogroup" aria-labelledby="l-zone">' +
    ZONES.map((z) => { const on = S.zone === z.id; return '<label class="zone' + (on ? " on" : "") + '"><input class="vh" type="radio" name="czone" value="' + z.id + '"' + (on ? " checked" : "") + '><span class="bub">' + ic(z.ic, 24) + "</span><span><b>" + z.n + "</b><small>" + z.sub + '</small></span><span class="radio">' + ic("check", 16) + "</span></label>"; }).join("") + "</div>" +
    '<p class="note-auto" style="margin-top:14px">' + ic("info", 18) + '<span>Колко гости събира всяка зона: <span class="missing">[ЛИПСВА: капацитет]</span>. Ще уточним мястото заедно според броя гости.</span></p></div>';
}
export function earlyHTML(v: View): string {
  return v.early
    ? ic("seal-percent", 22) + '<span><b>Ранна резервация: -5% от крайната цена.</b><br>Пример в прегледа. Колко дни по-рано: <span class="missing">[ЛИПСВА: колко дни по-рано]</span></span>'
    : ic("seal-percent", 22) + '<span><b>-5% при ранна резервация за празник.</b><br>Колко дни по-рано: <span class="missing">[ЛИПСВА: колко дни по-рано]</span>. Потвърждава се в офертата.</span>';
}

/* ---------- step 2: menu ---------- */
function pkgCard(v: View, p: Pkg): string {
  const on = v.S.menu === p.id, items = pkgItems(p), firsts = GROUP_IDS.map((g) => p.g[g][0][0]);
  return '<label class="pkg' + (on ? " on" : "") + '"><input class="vh" type="radio" name="cmenu" value="' + p.id + '"' + (on ? " checked" : "") + ">" +
    '<span class="pkg-h"><span><span class="h3">' + p.n + "</span><p>" + p.d + '</p></span><span class="radio">' + ic("check", 16) + "</span></span>" +
    '<span class="minis" aria-hidden="true">' + firsts.map((id) => '<span class="pl">' + art(id) + "</span>").join("") + "</span>" +
    "<dl>" + GROUP_IDS.map((g) => { const list = items.filter((it) => it.g === g);
      return "<div><dt>" + GROUP_NAMES[g] + (list.every((it) => it.share) ? " <i>· за споделяне</i>" : "") + "</dt><dd>" + list.map((it) => esc(it.x.n)).join(", ") + "</dd></div>"; }).join("") + "</dl>" +
    '<span class="pkg-f" data-pkgf="' + p.id + '">' + pkgFoot(v, p) + "</span></label>";
}
export function pkgFoot(v: View, p: Pkg): string {
  if (v.price !== "show") return '<span class="offer">Цена с оферта</span><span class="per">' + ic("receipt", 18) + "</span>";
  const n = v.S.guests, tot = pkgTotal(p, n);
  return '<span><span class="price">≈ ' + fmt(tot / n) + '</span> <span class="per">на гост</span></span><span class="tot">за ' + guestsText(n) + " ≈ " + fmt(tot) + (v.early ? ", преди -5%" : "") + "</span>";
}
export function pkgsHTML(v: View): string {
  const on = v.S.menu === "custom";
  return PKGS.map((p) => pkgCard(v, p)).join("") +
    '<label class="pkg custom' + (on ? " on" : "") + '"><input class="vh" type="radio" name="cmenu" value="custom"' + (on ? " checked" : "") + ">" +
    '<span class="pkg-h"><span><span class="h3">Собствено меню</span><p>Изберете ястията сами от цялото меню. Количествата уточняваме заедно.</p></span><span class="radio">' + ic("check", 16) + "</span></span>" +
    '<span class="bigbub" aria-hidden="true">' + ic("list-checks", 28) + "</span>" +
    '<span class="pkg-f"><span class="offer">Свържете се с нас за оферта</span></span></label>';
}
export function skeletons(): string {
  let s = "";
  for (let i = 0; i < 4; i++) s += '<div class="skel" style="height:' + (i < 3 ? 380 : 220) + 'px;border-radius:22px" aria-hidden="true"></div>';
  return s + '<span class="vh" role="status">Зареждаме пакетите</span>';
}
export function step2(v: View, loading = false): string {
  return '<h2 class="h2" tabindex="-1" data-focus><span class="vh">Стъпка 2 от 3: </span>Меню</h2><p class="lead">Изберете готов пакет от нашето меню или си направете собствено.</p>' +
    '<div class="pkgs" role="radiogroup" aria-label="Меню за празника" id="b-menu" data-pkgs>' + (loading ? skeletons() : pkgsHTML(v)) + "</div>" + errHTML("e-menu") +
    "<div data-picker>" + pickerHTML(v) + "</div>" +
    '<p class="note-auto" style="margin-top:20px">' + ic("info", 18) + '<span>Напитките не са включени. <span class="missing">[ЛИПСВА: бар и винена карта]</span> Вегетарианци и алергии напишете в бележката на следващата стъпка.</span></p>';
}
export function pickerHTML(v: View): string {
  const S = v.S;
  if (S.menu !== "custom") return "";
  const g = S.pg, gr = GROUPS.find((x) => x.id === g)!, cat = S.pc[g] || gr.cats[0];
  return '<div class="picker" id="b-picker"><div class="blk-h"><h3 class="h3">Вашето меню</h3><span class="opt">изберете от всяка група</span></div>' +
    '<div class="gtabs" role="tablist" aria-label="Групи ястия">' + GROUPS.map((x) => { const n = picksIn(S, x.id).length;
      return '<button type="button" role="tab" data-pg="' + x.id + '" aria-selected="' + (x.id === g) + '">' + GROUP_NAMES[x.id] + (n ? '<span class="n" aria-label="' + n + ' избрани">' + n + "</span>" : "") + "</button>"; }).join("") + "</div>" +
    '<div class="chips" role="group" aria-label="Категории">' + gr.cats.map((c) => '<button class="chip" type="button" data-pc="' + c + '" aria-pressed="' + (c === cat) + '">' + catLabel(g, c) + ' <span class="n">' + itemsFor(g, c).length + "</span></button>").join("") + "</div>" +
    '<div class="plist" role="tabpanel">' + itemsFor(g, cat).map((x) => { const on = S.picks.includes(x.id), cx = cleanTags(x);
      return '<button class="pk" type="button" data-pick="' + x.id + '" aria-pressed="' + on + '"><span class="pic" aria-hidden="true">' + art(x) + "</span><span><b>" + esc(x.n) + '</b><span class="m"><span class="price">' + fmt(x.p) + "</span>" + (x.g ? "<span>" + esc(x.g) + "</span>" : "") + '<span class="yes">' + icInline("check", 14, -2) + " Избрано</span></span>" + (cx.t.length ? '<span style="display:block;margin-top:6px">' + badges(cx) + "</span>" : "") + '</span><span class="tk">' + ic("check", 18) + "</span></button>"; }).join("") + "</div>" +
    errHTML("e-picks") + '<div class="mine shell" data-mine><div class="core">' + mineHTML(S) + "</div></div>" +
    '<div class="callbox"><h4>Свържете се с нас за оферта</h4><p>Собственото меню го смятаме на ръка. Изпратете запитването или ни се обадете.</p><a class="pill pill-line" href="' + TEL + '">' + ic("phone", 20) + "Обади се · " + R.phone + "</a></div></div>";
}
export function mineHTML(S: St): string {
  if (!S.picks.length) return '<div class="empty"><span class="ill">' + ic("fork-knife", 32) + '</span><h4>Още нищо не е избрано</h4><p class="muted" style="margin:0">Докоснете ястие, за да го добавите в менюто на празника.</p></div>';
  return "<h4>" + plural(S.picks.length, "ястие", "ястия") + " в менюто</h4>" + GROUP_IDS.map((g) => { const l = picksIn(S, g); if (!l.length) return "";
    return '<div class="grp"><small>' + GROUP_NAMES[g] + "</small>" + l.map((id) => { const x = byId[id]; return '<div class="it"><span>' + esc(x.n) + '</span><button class="link" type="button" data-unpick="' + id + '" aria-label="Махни ' + esc(x.n) + '">Махни</button></div>'; }).join("") + "</div>"; }).join("");
}

/* ---------- step 3: cake, decor, contact ---------- */
function seg(name: string, opts: [string, string][], val: string): string {
  return '<div class="seg" role="group" aria-labelledby="l-' + name + '">' + opts.map((o) => '<button type="button" data-seg="' + name + '" data-v="' + o[0] + '" aria-pressed="' + (val === o[0]) + '">' + o[1] + "</button>").join("") + "</div>";
}
export function step3(v: View): string {
  const S = v.S;
  return '<h2 class="h2" tabindex="-1" data-focus><span class="vh">Стъпка 3 от 3: </span>Торта, украса и данни</h2>' +
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
    '<label class="check"><input type="checkbox" id="cconsent"' + (S.consent ? " checked" : "") + '><span>Искам подарък за рождения си ден и първи да научавам за събитията.<br><span class="muted small">По желание. Можете да се откажете по всяко време.</span></span></label></div>' +
    '<p class="fine">' + ic("lock", 18) + "<span>Запитването не ви задължава. Не плащате нищо онлайн. Телефонът ви е само за връзка за празника.</span></p>" +
    '<div class="alert" role="alert" data-alert hidden></div></div>';
}

/* ---------- the flow (stepper + current step) ---------- */
export function flowHTML(v: View, dir = "", loadingPkgs = false): string {
  if (v.sent) return successHTML(v);
  const S = v.S;
  const body = S.step === 1 ? step1(v) : S.step === 2 ? step2(v, loadingPkgs) : step3(v);
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
    (c.early ? '<div class="kv disc"><span>Ранна резервация -5% (пример)</span><b class="price">-' + fmt(c.disc) + "</b></div>" : "") +
    '<div class="sum-total"><span>Ориентировъчно</span><span class="price">' + fmt(c.total) + "</span></div>";
  else pr = '<div class="sum-offer">' + ic("fork-knife", 20) + "<span>Цената се появява, щом изберете меню.</span></div>" + (c.early ? '<p class="sum-note">Ранна резервация: -5% от крайната цена.</p>' : "");
  h += '<div class="sum-price">' + pr + "</div>";
  if (c.pkg && v.price === "show") h += '<p class="sum-note">Без напитки и торта. Ястията за споделяне са по 1 порция на ' + SHARE_PER + " гости. Окончателната цена е в офертата.</p>";
  return h + "</div>";
}
export function nextLabel(v: View, compact: boolean): string {
  if (v.sending) return '<span class="spin" aria-hidden="true"></span>Изпращаме...';
  const arr = compact ? "" : ic("arrow-right", 20), s = v.S.step;
  return s === 1 ? "Към менюто" + arr : s === 2 ? "Към детайлите" + arr : "Изпрати запитване" + (compact ? "" : ic("paper-plane-right", 20));
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
  return '<button class="sumbtn" type="button" data-sum aria-label="Виж какво включва празникът и цената">' + barSummary(v) + "</button>" +
    '<div class="cbtns"><button class="pill pill-line" type="button" data-back' + (v.S.step < 2 ? " hidden" : "") + ">" + ic("arrow-left", 20) + 'Назад</button><button class="pill pill-red" type="button" data-next>' + nextLabel(v, v.S.step > 1) + "</button></div>";
}

/* ---------- success ---------- */
export function successHTML(v: View): string {
  const S = v.S;
  const C: [string, number, number, number][] = [["e", -58, -26, 40], ["r", 54, -40, -30], ["o", -44, 40, 70], ["k", 62, 22, 15], ["e", 4, -62, -60], ["r", -70, 6, 110], ["o", 30, 58, -80], ["e", 72, -6, 35], ["r", -20, -58, 20], ["k", -62, -44, -45], ["o", 44, -60, 60], ["e", -30, 62, 95]];
  const conf = C.map((c) => '<i class="' + c[0] + '" style="--x:' + c[1] + "px;--y:" + c[2] + "px;--r:" + c[3] + 'deg"></i>').join("");
  return '<div class="shell done"><div class="core"><div class="burst" aria-hidden="true">' + conf + '<span class="ok">' + ic("check", 48) + "</span></div>" +
    '<h2 class="h2" tabindex="-1" data-focus>Запитването е изпратено</h2>' +
    '<p class="lead">Управителят ще ви се обади <span class="missing">до 24 часа</span> на ' + esc(S.phone) + '.</p><p class="help" style="margin:0"><span class="missing">[ЛИПСВА: срок за обаждане]</span></p>' +
    (!v.open ? '<p class="night">Сега сме затворени, затова ще ви потърсим ' + (v.beforeOpen ? "днес" : "утре") + " след " + R.open + ".</p>" : "") +
    summaryHTML(v, true) +
    '<div class="btns"><a class="pill pill-line pill-lg" href="' + url.page("events") + '">' + ic("calendar-blank", 20) + 'Към събитията и поводите</a><button class="link" type="button" data-again style="justify-self:center">Ново запитване</button></div></div></div>';
}

/* ---------- the inquiry for api.celebrations.create ---------- */
/** The core has no fields for the start time, the cake wishes and the decoration wishes: they go into the note
    (request to the boss in reviews-code/celebration.agent.md). */
export function inquiryNote(S: St): string {
  const parts = ["Начален час: " + S.time + "."];
  if (S.cake === "ours") parts.push("Торта от ресторанта" + (S.cakeNote.trim() ? ": " + S.cakeNote.trim() : "") + ".");
  else if (S.cake === "bring") parts.push("Носят своя торта.");
  if (S.decor === "yes") parts.push("Украса" + (S.wishes.length ? ": " + S.wishes.join(", ") : "") + ".");
  if (S.note.trim()) parts.push("Бележка: " + S.note.trim());
  return parts.join(" ");
}
