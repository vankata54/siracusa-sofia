/* Celebration calculator (/praznik/): everything that needs the menu (lib/data.ts, the illustrations).
   On the server it draws the hero art, the package cards (into a <template>) and the package prices (JSON);
   in the browser it is loaded with import() only when the guest opens "Собствено меню" (the dish picker),
   so the menu is not in the page's first JS. Packages only from the real dishes, prices from the menu. */
import { ic } from "../../lib/icons.ts";
import { esc, fmt, plural } from "../../lib/format.ts";
import { byId, inCat, catById, RESTAURANT as R, type Dish } from "../../lib/data.ts";
import { art, badges } from "../../lib/render.ts";
import { GROUP_IDS, GROUP_NAMES, SHARE_PER, TEL, type Group, type PkgInfo, type St } from "./_calc.ts";
import { callBtn } from "../../lib/ui.ts";

/* [id, share]: "share" dishes are counted 1 portion per SHARE_PER guests (prototype rule until the admin sets the logic) */
type PkgDish = [string, 1?];
interface Pkg { id: string; n: string; d: string; g: Record<Group, PkgDish[]> }
const PKGS: Pkg[] = [
  { id: "klasicheski", n: "Класически", d: "Българска трапеза: колбаси, шопска салата и кебапчета от скарата.",
    g: { app: [["set-ot-balgarski-kolbasi", 1], ["urnabes-razyadka-s-brusketi", 1]], starter: [["shopska-salata"]], main: [["kebapcheta"]], dessert: [["tiramisu"]] } },
  { id: "pesht-i-skara", n: "Пещ и скара", d: "Пици от пещта за споделяне и свински ребра от фурната Bertha.",
    g: { app: [["pitsa-margarita", 1], ["pitsa-s-burata-i-proshuto-krudo", 1]], starter: [["gratska-salata"]], main: [["svinski-rebra"], ["parzheni-kartofi"]], dessert: [["pitsa-nutela", 1]] } },
  { id: "butikov", n: "Бутиков", d: "Скариди, френски сирена, капрезе с бурата и патешко магре.",
    g: { app: [["skaridi-s-maslo-chesan-byalo-vino-sovinyon-blan", 1], ["plato-frenski-sirena", 1]], starter: [["kapreze-s-burata-i-avokado"]], main: [["pateshko-magre-s-pyure-ot-tselina-i-sladko-ot-vi"]], dessert: [["sufle"]] } },
];
interface PkgItem { g: Group; x: Dish; share: boolean }
function pkgItems(p: Pkg): PkgItem[] {
  const out: PkgItem[] = [];
  GROUP_IDS.forEach((g) => p.g[g].forEach((z) => out.push({ g, x: byId[z[0]], share: !!z[1] })));
  return out;
}
/** name, the dish ids and the two price sums (per guest, per SHARE_PER guests): the browser computes the total without the menu */
export function pkgInfos(): PkgInfo[] {
  return PKGS.map((p) => { const it = pkgItems(p);
    return { id: p.id, n: p.n, items: it.map((i) => i.x.id), a: it.filter((i) => !i.share).reduce((s, i) => s + i.x.p, 0), b: it.filter((i) => i.share).reduce((s, i) => s + i.x.p, 0) }; });
}

/* ---------- hero art ---------- */
export function feastHTML(): string {
  return '<div class="feast" aria-hidden="true">' +
    '<span class="cf e" style="left:8%;top:14%;transform:rotate(24deg)"></span><span class="cf r c" style="left:20%;top:80%"></span><span class="cf o" style="left:47%;top:7%;transform:rotate(-30deg)"></span>' +
    '<span class="cf i" style="left:63%;top:86%;transform:rotate(50deg)"></span><span class="cf e c" style="left:86%;top:12%"></span><span class="cf r" style="left:93%;top:66%;transform:rotate(-14deg)"></span>' +
    '<span class="cf o c" style="left:4%;top:56%"></span><span class="cf e" style="left:34%;top:88%;transform:rotate(70deg)"></span>' +
    '<span class="pl p1">' + art("pitsa-s-burata-i-proshuto-krudo") + '</span><span class="pl p2">' + art("svinski-rebra") + '</span><span class="pl p3">' + art("gratska-salata") + '</span><span class="pl p4">' + art("sufle") + "</span></div>";
}

/* ---------- package cards (server; the browser marks the chosen one and fills the price footers) ---------- */
export function pkgCardsHTML(): string {
  return PKGS.map((p) => { const items = pkgItems(p), firsts = GROUP_IDS.map((g) => p.g[g][0][0]);
    return '<label class="pkg"><input class="vh" type="radio" name="cmenu" value="' + p.id + '">' +
      '<span class="pkg-h"><span><span class="h3">' + p.n + "</span><p>" + p.d + '</p></span><span class="radio">' + ic("check", 16) + "</span></span>" +
      '<span class="minis" aria-hidden="true">' + firsts.map((id) => '<span class="pl">' + art(id) + "</span>").join("") + "</span>" +
      "<dl>" + GROUP_IDS.map((g) => { const list = items.filter((it) => it.g === g);
        return "<div><dt>" + GROUP_NAMES[g] + (list.every((it) => it.share) ? " <i>· за споделяне</i>" : "") + "</dt><dd>" + list.map((it) => esc(it.x.n)).join(", ") + "</dd></div>"; }).join("") + "</dl>" +
      '<span class="pkg-f" data-pkgf="' + p.id + '"></span></label>'; }).join("") +
    '<label class="pkg custom"><input class="vh" type="radio" name="cmenu" value="custom">' +
    '<span class="pkg-h"><span><span class="h3">Собствено меню</span><p>Изберете ястията сами от цялото меню. Количествата уточняваме заедно.</p></span><span class="radio">' + ic("check", 16) + "</span></span>" +
    '<span class="bigbub" aria-hidden="true">' + ic("list-checks", 28) + "</span>" +
    '<span class="pkg-f"><span class="offer">Свържете се с нас за оферта</span></span></label>';
}

/* ---------- own menu: the dish picker ---------- */
export const GROUPS: { id: Group; cats: string[] }[] = [
  { id: "app", cats: ["studeni-predyastia", "topli-predyastia", "hlebcheta"] },
  { id: "starter", cats: ["salati", "supi"] },
  { id: "main", cats: ["skara-bertha", "pitsi", "osnovni-yastia", "pasta-i-rizoto", "burgeri", "garnituri"] },
  { id: "dessert", cats: ["deserti", "pitsi"] },
];
/* "Изчерпано днес" is about today, not the party date */
const cleanTags = (x: Dish): Dish => ({ ...x, t: x.t.filter((k) => k !== "out") });
function itemsFor(g: Group, cat: string): Dish[] {
  return inCat(cat).filter((x) => (cat === "pitsi" ? (g === "dessert" ? x.course === "dessert" : x.course !== "dessert") : true));
}
const catLabel = (g: Group, cat: string) => (cat === "pitsi" && g === "dessert" ? "Сладка пица" : catById[cat].n);
function groupOf(id: string): Group {
  const x = byId[id];
  for (const gr of GROUPS) if (gr.cats.includes(x.cat) && itemsFor(gr.id, x.cat).includes(x)) return gr.id;
  return "main";
}
export const known = (id: string) => !!byId[id];
export const picksIn = (S: St, g: Group) => S.picks.filter((id) => byId[id] && groupOf(id) === g);
const errHTML = (id: string) => '<p class="err" id="' + id + '" hidden></p>';
export function pickerHTML(S: St): string {
  const g = S.pg, gr = GROUPS.find((x) => x.id === g)!, cat = S.pc[g] || gr.cats[0];
  return '<div class="picker" id="b-picker"><div class="blk-h"><h3 class="h3">Вашето меню</h3><span class="opt">изберете от всяка група</span></div>' +
    '<div class="gtabs" role="tablist" aria-label="Групи ястия">' + GROUPS.map((x) => { const n = picksIn(S, x.id).length;
      return '<button type="button" role="tab" data-pg="' + x.id + '" aria-selected="' + (x.id === g) + '">' + GROUP_NAMES[x.id] + (n ? '<span class="n" aria-label="' + n + ' избрани">' + n + "</span>" : "") + "</button>"; }).join("") + "</div>" +
    '<div class="chips" role="group" aria-label="Категории">' + gr.cats.map((c) => '<button class="chip" type="button" data-pc="' + c + '" aria-pressed="' + (c === cat) + '">' + catLabel(g, c) + ' <span class="n">' + itemsFor(g, c).length + "</span></button>").join("") + "</div>" +
    '<div class="plist" role="tabpanel">' + itemsFor(g, cat).map((x) => { const on = S.picks.includes(x.id), cx = cleanTags(x);
      return '<button class="pk" type="button" data-pick="' + x.id + '" aria-pressed="' + on + '"><span class="pic" aria-hidden="true">' + art(x) + "</span><span><b>" + esc(x.n) + '</b><span class="m"><span class="price">' + fmt(x.p) + "</span>" + (x.g ? "<span>" + esc(x.g) + "</span>" : "") + '<span class="yes">' + ic("check", 14).replace('class="ic"', 'class="ic" style="display:inline;vertical-align:-2px"') + " Избрано</span></span>" + (cx.t.length ? '<span style="display:block;margin-top:6px">' + badges(cx) + "</span>" : "") + '</span><span class="tk">' + ic("check", 18) + "</span></button>"; }).join("") + "</div>" +
    errHTML("e-picks") + '<div class="mine shell" data-mine><div class="core">' + mineHTML(S) + "</div></div>" +
    '<div class="callbox"><h4>Свържете се с нас за оферта</h4><p>Собственото меню го смятаме на ръка. Изпратете запитването или ни се обадете.</p>' + callBtn("pill pill-line") + "</div></div>";
}
export function mineHTML(S: St): string {
  if (!S.picks.length) return '<div class="empty"><span class="ill">' + ic("fork-knife", 32) + '</span><h4>Още нищо не е избрано</h4><p class="muted" style="margin:0">Докоснете ястие, за да го добавите в менюто на празника.</p></div>';
  return "<h4>" + plural(S.picks.length, "ястие", "ястия") + " в менюто</h4>" + GROUP_IDS.map((g) => { const l = picksIn(S, g); if (!l.length) return "";
    return '<div class="grp"><small>' + GROUP_NAMES[g] + "</small>" + l.map((id) => { const x = byId[id]; return '<div class="it"><span>' + esc(x.n) + '</span><button class="link" type="button" data-unpick="' + id + '" aria-label="Махни ' + esc(x.n) + '">Махни</button></div>'; }).join("") + "</div>"; }).join("");
}
