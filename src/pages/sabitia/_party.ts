/* "Празник при нас" table illustration (real dishes, top view). Server only: it needs the menu, which must not
   reach the browser bundle of this page. Port of partyArt() in design/pages/events.html. */
import { byId, inCat, type Dish } from "../../lib/data.ts";
import { art } from "../../lib/render.ts";
import { esc } from "../../lib/format.ts";

const pick = (id: string, cat: string): Dish | undefined => byId[id] || inCat(cat)[0];

/** the dishes on the table (their names go into the aria-label in the page HTML) */
function dishes(): (Dish | undefined)[] {
  return [pick("pitsa-s-burata-i-proshuto-krudo", "pitsi"), pick("gratska-salata", "salati"), pick("svinski-rebra", "skara-bertha"),
    inCat("pasta-i-rizoto")[0], pick("tiramisu", "deserti"), pick("ribay-stek-ot-blek-angas", "skara-bertha")];
}

/** The drawing alone (about 28 KB). Served as /sabitia/praznik-masa.svg (praznik-masa.svg.ts) and put into the
    page by its script shortly before it scrolls into view, so it is not in the HTML of the page. */
export function partySvg(): string {
  const D = dishes();
  const P = [[190, 140], [320, 140], [450, 140], [190, 262], [320, 262], [450, 262]];
  let s = "";
  [[150, 22], [280, 22], [410, 22], [150, 338], [280, 338], [410, 338]].forEach((c) => { s += '<rect x="' + c[0] + '" y="' + c[1] + '" width="80" height="40" rx="16" style="fill:var(--surface-3)"/>'; });
  s += '<rect x="38" y="160" width="40" height="80" rx="16" style="fill:var(--surface-3)"/><rect x="562" y="160" width="40" height="80" rx="16" style="fill:var(--surface-3)"/>';
  s += '<rect x="70" y="48" width="500" height="304" rx="72" style="fill:var(--surface);stroke:var(--line-strong);stroke-width:1.5"/>';
  [[108, 200], [532, 200]].forEach((g) => { s += '<circle cx="' + g[0] + '" cy="' + g[1] + '" r="15" style="fill:var(--surface-2);stroke:var(--line-strong);stroke-width:1.5"/><circle cx="' + g[0] + '" cy="' + g[1] + '" r="8" style="fill:var(--ember);opacity:.55"/>'; });
  D.forEach((x, i) => {
    if (!x) return;
    const c = P[i];
    s += '<g class="pl" style="--i:' + i + '"><ellipse cx="' + c[0] + '" cy="' + (c[1] + 6) + '" rx="54" ry="52" style="fill:var(--line)"/>' + art(x, 'x="' + (c[0] - 60) + '" y="' + (c[1] - 60) + '" width="120" height="120"') + "</g>";
  });
  const C: [number, number, number, string][] = [[26, 40, -20, "--ember"], [96, 330, 30, "--ok"], [600, 52, 15, "--ok"], [612, 330, -35, "--ember"], [24, 300, 40, "--muted"], [560, 16, -10, "--muted"], [118, 14, 22, "--ember"], [620, 180, 60, "--ember"], [14, 190, -50, "--ok"], [520, 380, 12, "--ember"], [250, 384, -25, "--muted"], [370, 8, 35, "--ok"]];
  C.forEach((c, i) => { s += '<rect class="cf" style="--i:' + (i % 6) + ";fill:var(" + c[3] + ')" x="' + c[0] + '" y="' + c[1] + '" width="14" height="7" rx="2" transform="rotate(' + c[2] + " " + (c[0] + 7) + " " + (c[1] + 3) + ')"/>'; });
  return '<svg xmlns="http://www.w3.org/2000/svg" class="tbl" viewBox="20 0 600 400" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' + s + "</svg>";
}

/** The frame in the page HTML: label and size on the server, the drawing comes from praznik-masa.svg. */
export function partyArt(): string {
  return '<div class="party-art rv" role="img" data-art aria-label="Празнична маса отгоре с ястия от менюто: ' + dishes().filter(Boolean).map((x) => esc(x!.n)).join(", ") + ' (илюстрация)"></div>';
}
