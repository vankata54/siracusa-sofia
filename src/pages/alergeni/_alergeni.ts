/* Allergens page (/alergeni/): HTML pieces shared by the server (Astro frontmatter) and the browser (page script).
   No menu import here (only the Dish type): the browser part of this page runs on the small runtime (src/client/sc.ts)
   and filters the rows that the server drew, by their data attributes. The search alone loads the menu chunk lazily
   (src/lib/filters.ts, the same logic as the menu). Port of design/pages/allergens.html (design/PAGES.md "allergens.html"). */
import type { Dish } from "../../lib/data.ts";
import * as ui from "../../lib/ui.ts";
import { noun } from "../../lib/nouns.ts";
import { ic } from "../../lib/icons.ts";
import { esc, plural as pl } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import { RESTAURANT as R, ALLERGENS as AL, allergenName } from "../../lib/consts.ts";
import "sc-icons:arrow-clockwise,bowl-food,caret-down,caret-right,clock,funnel,globe,info,magnifying-glass,phone,warning-circle,x"; /* the icons of this module in one group (scripts/icon-groups.mjs) */

export { AL };
export const TEL = "tel:" + R.phoneIntl;
export { noun };
export const plural = (n: number) => pl(n, "ястие", "ястия");
/* ---------- icon sprite: every icon of the table once per page (<symbol>), the cells point to it with <use> ---------- */
const SPRITE = [...AL.map((a) => a[2]), "caret-right", "info", "check", "phone"];
/** The sprite (server only; the page draws it once, the browser reuses it in the "cannot check" table). */
export function spriteHTML(): string {
  return '<svg class="sprite" width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;overflow:hidden">' +
    SPRITE.map((n) => '<symbol id="i-' + n + '" viewBox="0 0 256 256">' + ic(n).replace(/^<svg[^>]*>|<\/svg>$/g, "") + "</symbol>").join("") + "</svg>";
}
/** An icon from the sprite. Size and color come from CSS (.i14 ... .i24 in the page), so each <use> is short. */
export function u(n: string, s = 22, cls = ""): string {
  return '<svg class="ic i' + s + (cls ? " " + cls : "") + '"><use href="#i-' + n + '"/></svg>';
}
const cap = (s: string) => { s = String(s).trim(); return s.charAt(0).toUpperCase() + s.slice(1); };

/* soft hyphens so long names fit the narrow table columns */
const HY: Record<string, string> = { crustaceans: "Ракооб&shy;разни", peanuts: "Фъс&shy;тъци", molluscs: "Меко&shy;тели", sulphites: "Сул&shy;фити" };

/* what each allergen covers (Annex II of Reg. (EU) 1169/2011, shortened) */
export const DESC: Record<string, string> = {
  gluten: "Пшеница (и спелта), ръж, ечемик, овес и продуктите от тях: хляб, паста, брашно, панировка.",
  crustaceans: "Скариди, раци, омари и продуктите от тях.",
  eggs: "Яйца и продуктите от тях: майонеза, някои сосове и тестени изделия.",
  fish: "Риба и продуктите от нея.",
  peanuts: "Фъстъци и продуктите от тях.",
  soy: "Соя и продуктите от нея, например соев сос.",
  milk: "Мляко и продуктите от него, включително лактоза: сирене, кашкавал, масло, сметана.",
  nuts: "Бадеми, лешници, орехи, кашу, пекан, бразилски орех, шам фъстък, макадамия.",
  celery: "Целина (корен и стрък) и продуктите от нея.",
  mustard: "Синап и продуктите от него, например горчица.",
  sesame: "Сусамово семе и продуктите от него, например тахан.",
  sulphites: "Серен диоксид и сулфити над 10 mg/kg или 10 mg/l, например във вино.",
  lupin: "Лупина и продуктите от нея.",
  molluscs: "Миди, калмари, октопод, охлюви и продуктите от тях.",
};

/* ---------- FAQ: visible answers (HTML) and FAQPage JSON-LD (plain text, without [ЛИПСВА]) from the same array ---------- */
export function faqData(upd: string): [string, string][] {
  return [
    ["Колко точни са тези данни?", "<p>Алергените са извлечени автоматично от състава в менюто (" + upd + "). Кухнята ги проверява едно по едно. Дотогава ги приемайте като ориентир, а не като гаранция.</p>"],
    ["Имам силна алергия. Какво да направя?", '<p>Обадете ни се на <a href="' + TEL + '">' + R.phone + "</a> преди да поръчате или кажете на сервитьора. При поръчка онлайн напишете алергията в бележката към поръчката.</p><p><span class=\"missing\">[ЛИПСВА: как кухнята предпазва от смесване, например обща фурна и фритюрник]</span></p>"],
    ["Защо при някои ястия пише „Няма данни“?", "<p>За тях още нямаме пълен състав в менюто. Кухнята го въвежда. Попитайте ни и ще ви кажем веднага.</p>"],
    ["Къде още виждам алергените?", "<p>На страницата на всяко ястие и в количката, преди да поръчате.</p>"],
    ["Какво е Регламент (ЕС) 1169/2011?", "<p>Европейското правило за информацията за храните. По него всеки ресторант посочва 14-те основни алергена в ястията си.</p>"],
  ];
}
export function faqText(html: string): string {
  return html.replace(/<span class="missing">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

/* ---------- the ring (decorative): 14 allergen tokens around "14"; positions in CSS, radius set by the browser ---------- */
export function ringHTML(): string {
  return '<div class="ring" aria-hidden="true"><div class="ctr"><b>14</b><span>алергена</span></div>' +
    AL.map((a, i) => {
      const ang = (i / AL.length) * Math.PI * 2 - Math.PI / 2;
      return '<span class="t" data-ring="' + a[0] + '" style="--i:' + i + ";--x:calc(var(--r) * " + Math.cos(ang).toFixed(4) + ");--y:calc(var(--r) * " + Math.sin(ang).toFixed(4) + ')">' + u(a[2], 24) + "</span>";
    }).join("") + "</div>";
}

export function chipsHTML(): string {
  return AL.map((a) => '<button class="chip" type="button" data-al="' + a[0] + '" aria-pressed="false"><span class="ai">' +
    u(a[2], 20, "al") + u("check", 20, "ck") + "</span>Без " + a[1].toLowerCase() + "</button>").join("");
}

/* ---------- the table: one markup, cards on the phone, a real table at 1100+ ---------- */
export function theadHTML(): string {
  return '<thead><tr><th scope="col" class="th-dish"><b class="th-d">Ястие</b><span class="legend" aria-hidden="true"><span><span class="lgtk">' + u("check", 14) + '</span>Съдържа</span><span><span class="no"></span>Не е открит в състава</span><span><span class="lgnd"></span>Няма данни</span></span></th>' +
    AL.map((a) => '<th scope="col" class="c-' + a[0] + '"><span class="ah"><i>' + u(a[2], 20) + '</i><span class="hn">' + (HY[a[0]] || a[1]) + "</span></span></th>").join("") + "</tr></thead>";
}
export function tableOpen(): string {
  return '<table class="atbl"><caption class="vh">Ястия и 14-те алергена. „Съдържа“ означава, че алергенът е открит в състава.</caption><colgroup><col>' +
    AL.map(() => '<col class="ca">').join("") + "</colgroup>" + theadHTML();
}
export function cathHTML(pre: string, cat: string, name: string, n: number): string {
  return '<tbody class="cath" id="' + pre + "-" + cat + '" data-cat="' + cat + '"><tr><th colspan="' + (AL.length + 1) + '" scope="colgroup"><span class="ch"><h3>' + esc(name) + '</h3><span class="cn">' + noun(cat, n) + "</span></span></th></tr></tbody>";
}
export const OUT_BADGE = '<span class="badge out">' + ic("clock", 16) + "Изчерпано днес</span>";

/** Icons drawn by CSS (mask) in every row, so the rows carry no <svg>: "url(data:...)" for mask-image. */
export function maskURL(n: string): string {
  return 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">' + ic(n).replace(/^<svg[^>]*>|<\/svg>$/g, "") + "</svg>") + '")';
}

/** One dish row, as short as possible (127 of them): the browser reads the id from the link, the category from the group,
    the allergens from the "y" cells (column = allergen), "has composition" from .comp and sold out from .out.
    A cell without the allergen is an empty <td> (end tags of cells are optional in HTML). */
export function rowHTML(x: Dish, out: boolean): string {
  const has = !!x.comp;
  const name = '<th scope="row" class="nm"><a href="' + url.dish(x) + '"><b>' + esc(x.n) + "</b></a>" +
    (has ? '<p class="comp">' + esc(cap(x.comp)) + "</p>" : "") +
    (!has && x.al.length ? '<p class="ndn"><span>Непълен състав, попитайте ни.<span class="pz"> Знаем поне за:</span></span></p>' : "") +
    (out ? OUT_BADGE : "") + "</th>";
  let cells: string;
  if (!has && !x.al.length) {
    cells = '<td class="nd" colspan="' + AL.length + '"><p><span><b>Няма данни за алергени,</b> попитайте ни</span></p>';
  } else {
    cells = AL.map((a) => x.al.indexOf(a[0]) > -1 ? '<td class="y"><span class="tk"><i>' + u(a[2], 16) + '</i><span class="w">' + a[1] + "</span></span>" : "<td>").join("");
    if (has && !x.al.length) cells += '<td class="none"><p><span>Не открихме алергени в състава · Не е потвърдено от кухнята</span></p>';
  }
  return '<tr class="dish' + (out ? " out" : "") + '">' + name + cells + "</tr>";
}

/* ---------- the summary line above the results ---------- */
export function summaryText(st: { a: string[]; q: string; nd: boolean }, n: number, nn: number): string {
  const bits: string[] = [];
  if (st.a.length) bits.push("без " + st.a.map((k) => allergenName(k).toLowerCase()).join(", "));
  if (st.q.trim()) bits.push("„" + esc(st.q.trim()) + "“");
  if (st.a.length && !st.nd && nn) bits.push("+ " + plural(nn) + " без данни най-долу");
  if (st.nd) bits.push("само с данни");
  return "<b>" + plural(n) + "</b>" + (bits.length ? " · " + bits.join(" · ") : " · всички");
}

/* ---------- the "cannot check" group (an allergen is excluded): summary of the <details> ---------- */
export function ndSummaryHTML(nd: number, a: string[]): string {
  const names = a.map((k) => allergenName(k).toLowerCase()).join(", ");
  return '<summary><span class="ni">' + ic("warning-circle", 24) + '</span><span class="nt2"><b>Не можем да проверим: ' + plural(nd) + "</b><span>Нямаме състав за тях и не знаем дали съдържат " + esc(names) + ". Попитайте ни преди да поръчате: " + R.phone + '.</span></span><span class="tg" aria-hidden="true">' + ic("caret-down", 18) + "</span></summary>";
}

/* ---------- states ---------- */
export function stateBox(icon: string, cls: string, title: string, text: string, acts: string): string {
  return '<div class="shell state"><div class="core"><div class="empty"><span class="ill ' + cls + '">' + ic(icon, 44) + '</span><h3 class="h2">' + title + '</h3><p class="muted" style="margin:0;max-width:38ch">' + text + '</p><div class="acts">' + acts + "</div></div></div></div>";
}
export function emptyHTML(st: { a: string[]; q: string; nd: boolean }): string {
  const q = st.q.trim();
  if (q) return stateBox("magnifying-glass", "", "Не намерихме „" + esc(q) + "“", "Проверете думата или потърсете по съставка, например „моцарела“ или „скариди“." + (st.a.length ? " Включени са и филтрите за алергени." : ""),
    '<button class="pill pill-red" type="button" data-clrq>' + ic("x", 20) + "Изчисти търсенето</button>" + (st.a.length || st.nd ? '<button class="pill pill-line" type="button" data-clear>Изчисти всичко</button>' : ""));
  return stateBox("funnel", "", "Няма ястия с тези филтри", "Всяко ястие съдържа поне един от избраните алергени. Махнете някой от тях, за да видите повече.",
    '<button class="pill pill-red" type="button" data-clear>' + ic("x", 20) + "Изчисти филтрите</button>");
}
/* error / no connection: the shared box (lib/ui.ts), same words and buttons as on every page */
export function errorHTML(search = false): string {
  return ui.stateBox({ kind: "error", what: search ? "търсенето" : "алергените" });
}
export function offlineHTML(): string {
  return ui.stateBox({ kind: "offline", what: "алергените" });
}
export function loadingHTML(): string {
  let rows = "";
  for (let i = 0; i < 5; i++) rows += '<div class="skrow"><div class="skel" style="height:20px;width:' + [70, 55, 82, 62, 48][i] + '%"></div><div class="skel" style="height:16px;width:' + [90, 76, 60, 84, 70][i] + '%"></div><div class="tks"><div class="skel" style="height:34px;width:96px;border-radius:999px"></div><div class="skel" style="height:34px;width:84px;border-radius:999px"></div></div></div>';
  return '<div aria-busy="true" aria-label="' + ui.loadingText("алергените") + '"><div class="skel" style="height:24px;width:120px;margin:32px 4px 14px"></div><div class="shell" style="padding:0;background:none;box-shadow:none"><div class="core">' + rows + "</div></div></div>";
}

/* ---------- the lunch note: never "today" unless the lunch menu in the data is for today (BRIEF 8) ---------- */
export function lunchHTML(today: boolean, dayName: string, n: number): string {
  const miss = '<span class="missing">[ЛИПСВА: състав и алергени на дневните ястия от кухнята]</span>';
  return '<span class="li">' + ic("bowl-food", 24) + "</span><div>" +
    (today
      ? "<h3>Обедното меню се сменя всеки ден</h3><p>Днес" + (dayName ? " (" + dayName.toLowerCase() + ")" : "") + " в него има " + plural(n) + ". Тях ги няма в таблицата: " + miss + '. Дотогава попитайте ни.</p><a class="link" href="' + url.lunch() + '">Обедно меню днес' + ic("caret-right", 18) + "</a>"
      : "<h3>Обедното меню се качва всяка сутрин</h3><p>Ястията от него ги няма в таблицата: " + miss + '. Дотогава попитайте ни.</p><a class="link" href="' + url.lunch() + '">Обедно меню' + ic("caret-right", 18) + "</a>") +
    "</div>";
}
