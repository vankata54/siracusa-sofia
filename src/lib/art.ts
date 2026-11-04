/* Dish illustrations (stand-ins until the new photo shoot). Exact port of design/ds/sc.js: same seed -> same SVG. */
import type { Dish } from "./data.ts";

type R = () => number;
function rng(seed: string): R {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return function () { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function inDisk(r: R, R0: number): [number, number] { const a = r() * 6.2832, d = Math.sqrt(r()) * R0; return [100 + Math.cos(a) * d, 100 + Math.sin(a) * d]; }
function plate(s: string): string { return s + '<circle cx="100" cy="100" r="94" fill="#ECE5DA"/><circle cx="100" cy="100" r="78" fill="#F7F3EC"/>'; }

function drawPizza(x: Dish, r: R): string {
  const t = (x.n + " " + x.comp).toLowerCase();
  let s = "", i: number, p: [number, number], a: number, X: number, Y: number;
  const sweet = /нутела|шоколад/.test(t), white = /сметана/.test(t) && !/доматен/.test(t);
  s += '<circle cx="100" cy="100" r="92" fill="#D9A262"/>';
  for (i = 0; i < 18; i++) { a = r() * 6.2832; X = 100 + Math.cos(a) * 84; Y = 100 + Math.sin(a) * 84; s += '<ellipse cx="' + X + '" cy="' + Y + '" rx="' + (3 + r() * 7) + '" ry="' + (2 + r() * 3) + '" fill="#7E4618" opacity="' + (.3 + r() * .4) + '" transform="rotate(' + (a * 57) + ' ' + X + ' ' + Y + ')"/>'; }
  s += '<circle cx="100" cy="100" r="76" fill="' + (sweet ? "#4A2A18" : white ? "#F1E6C8" : /трюфел/.test(t) ? "#E9D6A6" : "#C23A22") + '"/>';
  if (!sweet) for (i = 0; i < 12; i++) { p = inDisk(r, 60); s += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="' + (9 + r() * 10) + '" ry="' + (7 + r() * 8) + '" fill="#F3E2AE" opacity=".92"/>'; }
  const scatter = (n: number, R0: number, fn: (X: number, Y: number) => string) => { for (let j = 0; j < n; j++) { const q = inDisk(r, R0); s += fn(q[0], q[1]); } };
  if (/прошуто|шунка|пуешко/.test(t)) scatter(7, 54, (X, Y) => '<path d="M' + X + ' ' + Y + ' q12 ' + (r() * 20 - 10) + ' 24 ' + (r() * 10 - 5) + '" stroke="#DA857C" stroke-width="9" stroke-linecap="round" fill="none"/>');
  if (/салам|луканка|кренвирш|кайма/.test(t)) scatter(11, 58, (X, Y) => '<circle cx="' + X + '" cy="' + Y + '" r="11" fill="#A6281C" stroke="#78180F" stroke-width="2"/>');
  if (/гъби/.test(t)) scatter(8, 56, (X, Y) => '<path d="M' + (X - 8) + ' ' + Y + ' a8 7 0 0 1 16 0z" fill="#C9B79C"/><rect x="' + (X - 2.5) + '" y="' + Y + '" width="5" height="7" fill="#BCA889"/>');
  if (/чушка/.test(t)) scatter(8, 58, (X, Y) => '<rect x="' + (X - 9) + '" y="' + (Y - 2) + '" width="18" height="4" rx="2" fill="' + (/червена/.test(t) && r() > .5 ? "#D7402A" : "#4E8A36") + '" transform="rotate(' + (r() * 180) + ' ' + X + ' ' + Y + ')"/>');
  if (/маслини/.test(t)) scatter(8, 58, (X, Y) => '<circle cx="' + X + '" cy="' + Y + '" r="4.5" fill="none" stroke="#2A2420" stroke-width="3"/>');
  if (/царевица/.test(t)) scatter(16, 60, (X, Y) => '<circle cx="' + X + '" cy="' + Y + '" r="2.6" fill="#F2C445"/>');
  if (/тон/.test(t) && /риба/.test(t)) scatter(10, 54, (X, Y) => '<ellipse cx="' + X + '" cy="' + Y + '" rx="7" ry="4" fill="#C9A98A"/>');
  if (/трюфел/.test(t)) scatter(40, 66, (X, Y) => '<circle cx="' + X + '" cy="' + Y + '" r="' + (1 + r() * 2.2) + '" fill="#3A2A22"/>');
  if (/босилек|рукола/.test(t)) scatter(12, 62, (X, Y) => '<ellipse cx="' + X + '" cy="' + Y + '" rx="8" ry="3.4" fill="#4E8A36" transform="rotate(' + (r() * 180) + ' ' + X + ' ' + Y + ')"/>');
  if (/люта/.test(t)) scatter(8, 62, (X, Y) => '<circle cx="' + X + '" cy="' + Y + '" r="4" fill="none" stroke="#E2452A" stroke-width="2.4"/>');
  if (/яйце/.test(t)) s += '<circle cx="100" cy="100" r="18" fill="#FBF8F1"/><circle cx="100" cy="100" r="8" fill="#F2B23A"/>';
  if (/бурата/.test(t)) s += '<circle cx="101" cy="99" r="26" fill="#FBF8F1"/><circle cx="104" cy="96" r="14" fill="#EFE7D4"/>';
  if (sweet) { scatter(70, 84, (X, Y) => '<circle cx="' + X + '" cy="' + Y + '" r="' + (.6 + r() * 1.3) + '" fill="#FFF" opacity=".85"/>'); scatter(8, 50, (X, Y) => '<circle cx="' + X + '" cy="' + Y + '" r="6" fill="#C8361F"/>'); }
  return s;
}

const ART: Record<string, (r: R) => string> = {
  soup(r) { let s = plate(""); s += '<circle cx="100" cy="100" r="62" fill="#E8C877"/>'; for (let i = 0; i < 14; i++) { const p = inDisk(r, 48); s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (3 + r() * 4) + '" fill="' + ["#4E8A36", "#E39A3B", "#F4EEDC"][i % 3] + '"/>'; } return s; },
  salad(r) { let s = plate(""), i: number, p: [number, number]; for (i = 0; i < 26; i++) { p = inDisk(r, 60); s += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="' + (10 + r() * 8) + '" ry="' + (6 + r() * 4) + '" fill="' + ["#4E8A36", "#6FA544", "#3D7A2E", "#86B85A"][i % 4] + '" transform="rotate(' + (r() * 180) + ' ' + p[0] + ' ' + p[1] + ')"/>'; } for (i = 0; i < 7; i++) { p = inDisk(r, 48); s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (7 + r() * 4) + '" fill="#D8402B"/>'; } for (i = 0; i < 6; i++) { p = inDisk(r, 44); s += '<rect x="' + (p[0] - 5) + '" y="' + (p[1] - 5) + '" width="10" height="10" rx="2" fill="#F7F1E3"/>'; } return s; },
  platter(r) { let s = '<rect x="18" y="40" width="164" height="120" rx="20" fill="#9A6A42"/><rect x="26" y="48" width="148" height="104" rx="14" fill="#B9845A"/>'; for (let i = 0; i < 14; i++) { const X = 40 + r() * 120, Y = 60 + r() * 80; s += '<circle cx="' + X + '" cy="' + Y + '" r="' + (8 + r() * 6) + '" fill="' + ["#B23A2E", "#E9C88F", "#8E2A20", "#F3E2AE", "#C9635A"][i % 5] + '"/>'; } return s; },
  cheese(_r) { let s = plate(""); for (let i = 0; i < 6; i++) { const a = i * 1.05 + .3, X = 100 + Math.cos(a) * 36, Y = 104 + Math.sin(a) * 30; s += '<rect x="' + (X - 15) + '" y="' + (Y - 11) + '" width="30" height="22" rx="9" fill="#D99B3E" transform="rotate(' + (a * 40) + ' ' + X + ' ' + Y + ')"/>'; } s += '<circle cx="100" cy="100" r="17" fill="#ECE5DA"/><circle cx="100" cy="100" r="13" fill="#5B2A5E"/>'; return s; },
  seafood(r) { let s = plate(""); for (let i = 0; i < 9; i++) { const p = inDisk(r, 50); s += '<path d="M' + (p[0] - 12) + ' ' + p[1] + ' a12 12 0 0 1 24 0" stroke="#F08A5D" stroke-width="7" fill="none" stroke-linecap="round" transform="rotate(' + (r() * 360) + ' ' + p[0] + ' ' + p[1] + ')"/>'; } s += '<circle cx="150" cy="140" r="14" fill="#F4EEDC"/>'; return s; },
  steak(_r) { let s = plate(""); s += '<path d="M46 86C50 54 116 44 150 60C174 72 170 124 144 140C112 160 58 152 48 122Z" fill="#6A2D18"/>'; for (let i = 0; i < 5; i++) s += '<path d="M' + (58 + i * 22) + ' 60l-26 84" stroke="#2A1208" stroke-width="6" stroke-linecap="round" opacity=".75"/>'; s += '<path d="M120 132c10-2 26 4 30 14-12 8-30 8-38 0z" fill="#C9635A"/><circle cx="58" cy="150" r="7" fill="#3F7F30"/>'; return s; },
  ribs(_r) { let s = plate('') + '<g transform="rotate(-22 100 100)">'; for (let i = 0; i < 3; i++) { const y = 66 + i * 24; s += '<rect x="30" y="' + (y + 8) + '" width="14" height="8" rx="3" fill="#EFE2CC"/><rect x="156" y="' + (y + 8) + '" width="14" height="8" rx="3" fill="#EFE2CC"/><rect x="38" y="' + y + '" width="124" height="22" rx="11" fill="#7A3818"/>'; for (let k = 0; k < 6; k++) s += '<path d="M' + (52 + k * 19) + ' ' + (y + 3) + 'l-6 16" stroke="#2E1408" stroke-width="3" stroke-linecap="round" opacity=".7"/>'; } return s + '</g>'; },
  kebap(_r) { let s = plate(""); for (let i = 0; i < 4; i++) { const y = 62 + i * 22; s += '<rect x="' + (44 + i * 3) + '" y="' + y + '" width="104" height="18" rx="9" fill="#6E3A1F" transform="rotate(' + (-8 + i * 3) + ' 100 ' + y + ')"/>'; } return s; },
  patty(_r) { let s = plate("") + '<circle cx="100" cy="100" r="50" fill="#6C3A1E"/>'; for (let i = 0; i < 5; i++) s += '<path d="M' + (64 + i * 16) + ' 66l-14 64" stroke="#2C1408" stroke-width="4" stroke-linecap="round" opacity=".55"/>'; return s; },
  chicken(r) { let s = plate(""); for (let i = 0; i < 5; i++) { const p = inDisk(r, 40); s += '<rect x="' + (p[0] - 22) + '" y="' + (p[1] - 9) + '" width="44" height="18" rx="9" fill="#D9A55A" transform="rotate(' + (r() * 180) + ' ' + p[0] + ' ' + p[1] + ')"/>'; } return s; },
  pasta(r) { let s = plate("") + '<circle cx="100" cy="100" r="58" fill="#EBC877"/>'; for (let i = 0; i < 16; i++) { const p = inDisk(r, 44); s += '<path d="M' + (p[0] - 20) + ' ' + p[1] + ' q10 -14 20 0 t20 0" stroke="#F3D78E" stroke-width="4" fill="none"/>'; } return s; },
  risotto(r) { let s = plate("") + '<circle cx="100" cy="100" r="60" fill="#EBD9A8"/>'; for (let i = 0; i < 9; i++) { const p = inDisk(r, 46); s += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="8" ry="5" fill="#7A5232"/>'; } return s; },
  burger(r) { let s = '<circle cx="100" cy="100" r="58" fill="#4F8A36"/><circle cx="100" cy="100" r="52" fill="#C98B3E"/><circle cx="100" cy="100" r="46" fill="#D99B52"/>'; for (let i = 0; i < 22; i++) { const p = inDisk(r, 40); s += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="2.4" ry="1.4" fill="#FBF3DD"/>'; } return s; },
  fries(r) { let s = plate(""); for (let i = 0; i < 22; i++) { const p = inDisk(r, 44); s += '<rect x="' + (p[0] - 4) + '" y="' + (p[1] - 18) + '" width="8" height="36" rx="3" fill="' + ["#E9B54C", "#F2C863", "#D9A03A"][i % 3] + '" transform="rotate(' + (r() * 180) + ' ' + p[0] + ' ' + p[1] + ')"/>'; } return s; },
  veggies(r) { let s = plate(""); for (let i = 0; i < 16; i++) { const p = inDisk(r, 46); s += '<rect x="' + (p[0] - 7) + '" y="' + (p[1] - 11) + '" width="14" height="22" rx="4" fill="' + ["#4E8A36", "#C8361F", "#7A4FA0", "#E0A33A"][i % 4] + '" transform="rotate(' + (r() * 180) + ' ' + p[0] + ' ' + p[1] + ')"/>'; } return s; },
  puree(_r) { return plate("") + '<circle cx="100" cy="100" r="54" fill="#F3E3B5"/><path d="M70 100 q30 -30 60 0" stroke="#E9D29A" stroke-width="6" fill="none"/>'; },
  bread(r) { let s = '<ellipse cx="100" cy="100" rx="70" ry="56" fill="#D9A262"/>'; for (let i = 0; i < 14; i++) { const p = inDisk(r, 42); s += '<ellipse cx="' + p[0] + '" cy="' + p[1] + '" rx="' + (5 + r() * 7) + '" ry="' + (3 + r() * 4) + '" fill="#F3E2AE"/>'; } return s; },
  sauce(r) { const c = ["#F4EEDC", "#7A2E14", "#E2452A", "#E8C14A", "#F2E6C8"][Math.floor(r() * 5)]; return '<circle cx="100" cy="100" r="58" fill="#E8E2D6" stroke="#CFC6B6" stroke-width="5"/><circle cx="100" cy="100" r="44" fill="' + c + '"/>'; },
  addon(r) { let s = '<circle cx="100" cy="100" r="58" fill="#E8E2D6"/>'; for (let i = 0; i < 14; i++) { const p = inDisk(r, 40); s += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="' + (5 + r() * 4) + '" fill="' + ["#F3E2AE", "#D8402B", "#4E8A36", "#A6281C"][i % 4] + '"/>'; } return s; },
  dessert(r) { let s = plate("") + '<path d="M60 130 L140 130 L118 62 Z" fill="#F1E3C6"/><path d="M60 130 L140 130 L136 118 L64 118 Z" fill="#6B3A1E"/>'; for (let i = 0; i < 20; i++) { const p = inDisk(r, 30); s += '<circle cx="' + (p[0] + 4) + '" cy="' + (p[1] + 4) + '" r="' + (.8 + r() * 1.2) + '" fill="#5A3420"/>'; } return s; },
  breakfast(_r) { return plate("") + '<circle cx="80" cy="96" r="24" fill="#FBF8F1"/><circle cx="80" cy="96" r="10" fill="#F2B23A"/><rect x="108" y="70" width="44" height="14" rx="7" fill="#B4553A"/><rect x="108" y="92" width="44" height="14" rx="7" fill="#B4553A"/><circle cx="120" cy="130" r="10" fill="#D8402B"/>'; },
};

export function kind(x: Dish): string {
  const t = (x.n + " " + x.comp).toLowerCase(), g = x.group || "";
  if (x.cat === "obedno") return /Супи/.test(g) ? "soup" : /Салати/.test(g) ? "salad" : /Десерти/.test(g) ? "dessert" : /Скара/.test(g) ? "kebap" : /спагети|лазаня/i.test(x.n) ? "pasta" : /яйца/i.test(x.n) ? "breakfast" : /скумрия/i.test(x.n) ? "seafood" : /пиле/i.test(x.n) ? "chicken" : "steak";
  if (x.cat === "pitsi") return "pizza";
  if (x.cat === "supi") return "soup";
  if (x.cat === "salati") return "salad";
  if (x.cat === "studeni-predyastia") return /сирена|колбаси|разядк/.test(t) ? "platter" : /тиквички/.test(t) ? "veggies" : "platter";
  if (x.cat === "topli-predyastia") return /скарид|калмар/.test(t) ? "seafood" : /сирен/.test(t) ? "cheese" : /пилеш|крилца|ушета/.test(t) ? "chicken" : /тиквич/.test(t) ? "veggies" : "steak";
  if (x.cat === "skara-bertha") return /ребра/.test(t) ? "ribs" : /кебап|кюфте|суджук|ущипци/.test(t) ? "kebap" : /плескавица/.test(t) ? "patty" : /пилешко/.test(t) ? "chicken" : "steak";
  if (x.cat === "pasta-i-rizoto") return /ризото/.test(t) ? "risotto" : "pasta";
  if (x.cat === "osnovni-yastia") return /пиле/.test(t) ? "chicken" : "steak";
  if (x.cat === "burgeri") return "burger";
  if (x.cat === "hlebcheta") return "bread";
  if (x.cat === "sosove") return "sauce";
  if (x.cat === "dobavki") return "addon";
  if (x.cat === "garnituri") return /пюре/.test(t) ? "puree" : /картоф/.test(t) ? "fries" : "veggies";
  if (x.cat === "deserti") return "dessert";
  if (x.cat === "zakuski") return "breakfast";
  return "salad";
}

/** SVG markup of a dish illustration. */
export function artSvg(x: Dish, attrs?: string): string {
  const r = rng(x.id), k = kind(x);
  const body = k === "pizza" ? drawPizza(x, r) : ART[k](r);
  return '<svg viewBox="0 0 200 200" ' + (attrs || "") + ' data-dish="' + x.id + '" aria-hidden="true">' + body + '</svg>';
}
