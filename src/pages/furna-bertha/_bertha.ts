/* Bertha page (/furna-bertha/): HTML pieces shared by the server (Astro frontmatter) and the browser (page script).
   No menu import here: the browser part of this page runs on the small runtime (src/client/sc.ts) without the menu.
   Facts only from hand-off 6.10 and master prompt 11.3 (design/PAGES.md "bertha.html"). The text never says that the
   pizzas are baked in Bertha (OPEN-QUESTIONS 22). */
import { ic } from "../../lib/icons.ts";
import { esc, plural } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import { RESTAURANT as R, ZONES } from "../../lib/consts.ts";
import { stateBox, loadingText, hourNote, OFFLINE } from "../../lib/ui.ts";
import "sc-icons:arrow-clockwise,caret-down,check-circle,clock,globe,moon,pause,phone,play,shopping-bag,storefront,warning-circle"; /* the icons of this page in one module (scripts/icon-groups.mjs) */

export const STEPS: [string, string][] = [
  ["Огънят е затворен", "Дървените въглища горят в затворена камера, а не на открито."],
  ["Нагрява стените и тавана", "Горещината остава във фурната и нагрява стените и тавана."],
  ["Топлината идва отвсякъде", "Затова температурата е равномерна: около 250 - 350 °C."],
  ["Опушеният вкус", "Идва от дървените въглища. Месото го поема, докато се пече."],
];

/* ---------- dishes order: hits first, sold out last (same as the prototype) ---------- */
type D = { t: string[] };
export function sortDishes<T extends D>(xs: T[], isOut: (x: T) => boolean): T[] {
  const r = (x: T) => (isOut(x) ? 2 : x.t.indexOf("hit") > -1 ? 0 : 1);
  return xs.slice().sort((a, b) => r(a) - r(b));
}

function zonesText(): string {
  const free = ZONES.filter((z) => z.free).map((z) => z.n);
  const paid = ZONES.filter((z) => !z.free).map((z) => z.n);
  const list = (a: string[]) => (a.length > 1 ? a.slice(0, -1).join(", ") + " и " + a[a.length - 1] : a[0]);
  return "безплатно до " + list(free) + ", а до " + list(paid) + " по тарифа";
}

/** FAQ (visible answers and FAQPage JSON-LD from the same array). names: the dishes of "Скара Bertha". */
export function faq(names: string[]): [string, string][] {
  return [
    ["Какво е фурната Bertha?", "Bertha е британска затворена фурна на дървени въглища. Огънят гори в затворена камера, която нагрява стените и тавана. Така топлината идва отвсякъде, а не само отдолу."],
    ["До колко градуса се нагрява?", "Скарата работи при около 250 - 350 °C. Камерата е затворена, затова температурата е равномерна."],
    ["Откъде идва опушеният вкус?", "От дървените въглища. Те горят в същата затворена фурна, в която се пече месото."],
    ["Кои ястия се приготвят в Bertha?", "Всичко от раздела „Скара Bertha“: " + names.map((n) => n.charAt(0).toLowerCase() + n.slice(1)).join(", ") + "."],
    ["Мога ли да поръчам скара за вкъщи?", "Да. Доставяме всеки ден до " + R.delivery + ": " + zonesText() + ". Поръчки за вземане до " + R.kitchen + ", готови най-късно в " + R.close + "."],
    ["Къде е ресторантът?", R.name + " е в " + R.address + ". Отворено всеки ден " + R.open + " - " + R.close + ", кухнята приема до " + R.kitchen + "."],
  ];
}

export function faqHTML(q: [string, string][]): string {
  return q.map((f, i) => "<details" + (i === 0 ? " open" : "") + "><summary>" + esc(f[0]) + '<span class="cv">' + ic("caret-down", 20) + '</span></summary><p class="ans">' + esc(f[1]) + "</p></details>").join("");
}

/* ---------- gauge (hero) ---------- */
export function gauge(): string {
  const cx = 120, cy = 126, r = 100;
  const pt = (v: number, rr: number) => { const a = Math.PI * (1 - v / 400); return [(cx + rr * Math.cos(a)).toFixed(2), (cy - rr * Math.sin(a)).toFixed(2)]; };
  const arc = (v1: number, v2: number) => { const a = pt(v1, r), b = pt(v2, r); return "M" + a[0] + " " + a[1] + " A" + r + " " + r + " 0 0 1 " + b[0] + " " + b[1]; };
  let ticks = "";
  for (let v = 0; v <= 400; v += 25) {
    const mj = v % 100 === 0, a = pt(v, mj ? 78 : 82), b = pt(v, 88);
    ticks += '<line class="g-tick' + (mj ? " mj" : "") + '" x1="' + a[0] + '" y1="' + a[1] + '" x2="' + b[0] + '" y2="' + b[1] + '"/>';
  }
  return '<div class="gauge" role="img" aria-label="Работна температура на скарата: около 250 до 350 градуса">' +
    '<svg viewBox="0 0 240 138" aria-hidden="true"><defs><linearGradient id="gband" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:var(--ember)"/><stop offset="1" style="stop-color:var(--red)"/></linearGradient></defs>' +
    '<path class="g-track" d="' + arc(0, 400) + '"/>' + ticks + '<path class="g-band" d="' + arc(250, 350) + '"/>' +
    '<g class="g-dot"><circle class="halo" cx="20" cy="126" r="17"/><circle class="pin" cx="20" cy="126" r="9"/></g></svg>' +
    '<div class="read" aria-hidden="true"><span class="k">до</span><span class="v">350<small>°C</small></span></div></div>' +
    '<p class="gcap">Скарата работи при <b>около 250 - 350 °C</b>, равномерно в цялата фурна.</p>';
}

/* ---------- oven cross-section: how the heat travels ---------- */
export function diagram(): string {
  let s = '<svg viewBox="22 6 356 284" role="img" aria-labelledby="dtitle ddesc">' +
    '<title id="dtitle">Как минава топлината във фурната Bertha</title>' +
    '<desc id="ddesc">Разрез на затворена фурна. Отдолу горят дървени въглища. Топлината се качва по стените и тавана и оттам се връща към месото на скарата отгоре, отстрани и отдолу. Над месото се вдига лек дим, който дава опушения вкус.</desc>' +
    '<defs><radialGradient id="coalglow" cx=".5" cy=".7" r=".6"><stop offset="0" style="stop-color:var(--ember);stop-opacity:.75"/><stop offset=".55" style="stop-color:var(--red);stop-opacity:.25"/><stop offset="1" style="stop-color:var(--red);stop-opacity:0"/></radialGradient>' +
    '<filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="5"/></filter></defs>';
  /* body: flue, shell, legs, chamber */
  s += '<rect class="d-body" x="88" y="12" width="30" height="50" rx="5"/><rect class="d-edge" x="88" y="12" width="30" height="50" rx="5"/>' +
    '<rect class="d-body" x="72" y="250" width="16" height="34" rx="4"/><rect class="d-body" x="312" y="250" width="16" height="34" rx="4"/>' +
    '<rect class="d-body" x="30" y="54" width="340" height="200" rx="24"/><rect class="d-edge" x="30" y="54" width="340" height="200" rx="24"/>' +
    '<rect class="d-cav" x="52" y="80" width="296" height="152" rx="12"/>';
  /* L2: walls and ceiling heat up */
  let ch = "";
  const up = [[64, 206], [64, 182], [64, 158], [64, 134], [64, 110]], upR = [[336, 206], [336, 182], [336, 158], [336, 134], [336, 110]];
  const ceilL = [[86, 94], [112, 94], [138, 94], [164, 94]], ceilR = [[314, 94], [288, 94], [262, 94], [236, 94]];
  const chev = (x: number, y: number, rot: number, d: number) => '<path class="d-chev" style="animation-delay:' + d.toFixed(2) + 's" transform="translate(' + x + " " + y + ") rotate(" + rot + ')" d="M-5 3 L0 -2.5 L5 3"/>';
  up.forEach((p, i) => { ch += chev(p[0], p[1], 0, i * 0.2); });
  upR.forEach((p, i) => { ch += chev(p[0], p[1], 0, i * 0.2); });
  ceilL.forEach((p, i) => { ch += chev(p[0], p[1], 90, 1 + i * 0.2); });
  ceilR.forEach((p, i) => { ch += chev(p[0], p[1], -90, 1 + i * 0.2); });
  s += '<g class="layer l2"><rect class="d-wallglow" x="56" y="84" width="288" height="144" rx="10"/><path class="d-wall" d="M54 226 V94 Q54 82 66 82 H334 Q346 82 346 94 V226"/>' + ch + "</g>";
  /* L1: closed fire on the floor */
  const coals: [number, number, number, string][] = [[80, 222, 9, "a"], [96, 218, 8, "b"], [112, 223, 9, "c"], [128, 217, 8, "a"], [146, 222, 10, "b"], [164, 218, 8, "c"], [180, 223, 9, "a"], [198, 217, 9, "b"], [216, 222, 10, "a"], [234, 218, 8, "c"], [252, 223, 9, "b"], [270, 217, 8, "a"], [288, 222, 10, "c"], [306, 218, 8, "b"], [322, 223, 8, "a"]];
  const flames: [number, number, string, number][] = [[104, 208, "", 0], [150, 206, "r", 0.4], [196, 204, "", 0.8], [242, 206, "r", 0.2], [290, 208, "", 0.6]];
  s += '<g class="layer l1"><ellipse cx="200" cy="214" rx="160" ry="44" fill="url(#coalglow)"/>' +
    flames.map((f) => '<path class="d-flame ' + f[2] + '" style="animation-delay:' + f[3] + 's" d="M' + f[0] + " " + f[1] + ' c-8 -6 -8 -16 0 -26 c2 8 10 10 8 18 c-1 5 -4 8 -8 8z"/>').join("") +
    coals.map((c) => '<circle class="d-coal-' + c[3] + '" cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '"/>').join("") + "</g>";
  /* base: grill rack with meat */
  s += '<line class="d-rack" x1="74" y1="152" x2="326" y2="152"/>';
  for (let k = 0; k < 11; k++) s += '<line class="d-rack-s" x1="' + +(84 + k * 23.2).toFixed(1) + '" y1="152" x2="' + +(84 + k * 23.2).toFixed(1) + '" y2="158"/>';
  s += '<rect class="d-meat" x="110" y="134" width="80" height="18" rx="9"/><rect class="d-meat" x="210" y="134" width="80" height="18" rx="9"/>';
  for (let k = 0; k < 4; k++) s += '<line class="d-sear" x1="' + (124 + k * 16) + '" y1="137" x2="' + (130 + k * 16) + '" y2="149"/><line class="d-sear" x1="' + (224 + k * 16) + '" y1="137" x2="' + (230 + k * 16) + '" y2="149"/>';
  /* L3: even heat from every side + temperature (on the dark panel: --ink there is the light --on-chip-dark) */
  const ray = (d: string, delay: number) => '<path class="d-ray" style="animation-delay:' + delay + 's" d="' + d + '"/>';
  s += '<g class="layer l3">' +
    ray("M150 98 q5 6 0 12 q-5 6 0 12 M145 118 l5 7 l5 -7", 0) + ray("M250 98 q5 6 0 12 q-5 6 0 12 M245 118 l5 7 l5 -7", 0.3) +
    ray("M62 143 q6 -5 12 0 q6 5 12 0 q6 -5 12 0 M92 138 l7 5 l-7 5", 0.6) + ray("M338 143 q-6 -5 -12 0 q-6 5 -12 0 q-6 -5 -12 0 M308 138 l-7 5 l7 5", 0.9) +
    ray("M150 196 q5 -6 0 -12 q-5 -6 0 -12 M145 176 l5 -7 l5 7", 1.2) + ray("M250 196 q5 -6 0 -12 q-5 -6 0 -12 M245 176 l5 -7 l5 7", 1.5) +
    '</g><text class="d-temp" x="200" y="72" text-anchor="middle">250 - 350 °C</text>';
  /* L4: smoke = flavour */
  const wisps = [[124, 0], [148, 1.1], [172, 2.1], [228, 0.5], [252, 1.6], [276, 2.6]];
  s += '<g class="layer l4">' + wisps.map((w) => '<path class="d-smoke" style="animation-delay:' + w[1] + 's" d="M' + w[0] + ' 128 c-7 -6 5 -11 0 -17 c-6 -6 5 -10 0 -16"/>').join("") + "</g>";
  /* numbered markers matching the list */
  const nums = [[200, 243, 1], [84, 114, 2], [200, 116, 3], [300, 112, 4]];
  s += nums.map((n) => '<g class="d-num n' + n[2] + '" aria-hidden="true"><circle cx="' + n[0] + '" cy="' + n[1] + '" r="12"/><text x="' + n[0] + '" y="' + (n[1] + 5) + '" text-anchor="middle">' + n[2] + "</text></g>").join("");
  return s + "</svg>";
}

export function stepsHTML(): string {
  return STEPS.map((s, i) => '<li><button class="step" type="button" data-step="' + (i + 1) + '" aria-pressed="' + (i === 0) + '"><span class="no">' + (i + 1) + "</span><span><b>" + s[0] + '</b><span class="t">' + s[1] + "</span></span></button></li>").join("");
}

export function playHTML(playing: boolean): string {
  return ic(playing ? "pause" : "play", 18) + "<span>" + (playing ? "Пауза" : "Пусни") + "</span>";
}

/* ---------- service note (depends on the hour: drawn again in the browser) ---------- */
export type Svc = { m: number; kitchen: boolean; delivery: boolean; etaMin: number; offline: boolean };
export function serviceHTML(v: Svc): string {
  if (v.offline) return '<div class="svc err" role="status">' + ic("warning-circle", 24) + "<div><b>" + OFFLINE + "</b><p>Може да добавяте ястия в количката. Поръчката ви е запазена, изпратете я, щом връзката се върне.</p></div></div>";
  /* after 21:00 / 22:30 / before 10:00: the one hour note of the site (lib/ui.ts) */
  const st = { open: true, kitchen: v.kitchen, delivery: v.delivery, m: v.m };
  if (v.m < 600) return hourNote(st, { more: "Добавете ястията сега и поръчайте по-късно." });
  if (!v.kitchen) return hourNote(st, { tomorrow: '<a class="pill pill-line" href="' + url.cart() + '">' + ic("shopping-bag", 20) + "Поръчай за утре</a>" });
  if (!v.delivery) return hourNote(st, { more: "Скарата е готова за вземане след около 20 мин", pickup: '<a class="pill pill-line" href="' + url.page("pickup") + '">' + ic("storefront", 20) + "Поръчай за вземане</a>" });
  return '<div class="svc ok">' + ic("check-circle", 24) + '<div class="lines"><span><b>Доставка:</b> около ' + v.etaMin + ' мин</span><span><b>Вземане от място:</b> след около 20 мин</span></div></div>';
}

export function countHTML(n: number, nOut: number): string {
  return '<p class="count">' + plural(n, "ястие", "ястия") + " от скарата на дървени въглища" + (nOut ? " · " + nOut + " изчерпано днес" : "") + ". Цените са с ДДС.</p>";
}

/* ---------- states (reached only from the preview panel; the dishes are in the HTML) ---------- */
export function skeletonHTML(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += '<div class="skcard" aria-hidden="true"><div class="skel a"></div><div class="skel b"></div><div class="skel c"></div></div>';
  return '<p class="vh" role="status">' + loadingText("ястията") + '</p><div class="grid-dishes">' + s + "</div>";
}
export function errorHTML(): string {
  return stateBox({ kind: "error", what: "ястията", h: "h3" });
}
