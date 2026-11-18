/* Siracusa · "Собственик": the small charts (design/pages-sobstvenik/_own.js: O.cols, O.line, O.hbars, O.legend,
   O.tableHTML, O.card, O.bindTips; 1:1). Plain SVG and HTML: the text is HTML with the tokens (readable in the dark
   theme), the comparison is always a word and a sign (the colour never alone), every chart has "Таблица" as an
   alternative (the word says what the button shows; the name starts with the visible word; no aria-pressed).
   The classes are in src/modules/boss/boss.css (.ow-plot, .ow-lgd, .ow-hb, .ow-table, .ow-card, .ow-tbtn). */
import "sc-icons:chart-bar,list-bullets";
import { ic, esc } from "../boss/frame.ts";

export interface Tip { t: string; tv: string }
/** the tooltips of the plots on the screen (by the id of the plot) */
export const TIPS: Record<string, Tip[]> = {};
/** which cards show their table instead of the chart (kept over a redraw) */
export const showTbl: Record<string, boolean> = {};

/** the top of a count axis: its half is whole too (4 / 2 / 0, 30 / 15 / 0), never "2.5" */
export function niceCount(v: number): number {
  let m = 1; while (v > 100 * m) m *= 10;
  return [2, 4, 6, 8, 10, 12, 16, 20, 30, 40, 50, 60, 80, 100].map((x) => x * m).find((x) => x >= v) || 100 * m;
}
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v))), m = v / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}
/** the labels of the X axis: under every column (centred) or under the points of a line */
function xLabels(labels: string[], xn = 7, ticks: number[] | null = null, line = false): string {
  const n = labels.length, step = Math.ceil(n / (xn || 7));
  let idx: number[] = [];
  if (ticks) idx = ticks.filter((i) => i < n);
  else {
    for (let k = 0; k < n; k += step) idx.push(k);
    if (idx[idx.length - 1] !== n - 1) { if (n - 1 - idx[idx.length - 1] < step * 0.7 && idx.length > 1) idx[idx.length - 1] = n - 1; else idx.push(n - 1); }
  }
  return '<div class="xa" aria-hidden="true">' + idx.map((i) => {
    /* the first and the last label stay inside the chart (many narrow columns: the label is wider than its column) */
    const edge = !line && n > 7 && (i === 0 || i === n - 1);
    const left = n === 1 ? 50 : line ? (i / (n - 1)) * 100 : edge ? (i === 0 ? 0 : 100) : ((i + 0.5) / n) * 100, tr = (line || edge) && i === 0 ? "0" : (line || edge) && i === n - 1 ? "-100%" : "-50%";
    return '<span style="left:' + left + "%;transform:translateX(" + tr + ')">' + esc(labels[i]) + "</span>";
  }).join("") + "</div>";
}
const yAxis = (nice: number, f: (v: number) => string = String) => '<div class="ya" aria-hidden="true"><span>' + f(nice) + "</span><span>" + f(nice / 2) + "</span><span>" + f(0) + "</span></div>";
const grid = () => '<div class="grid"><i></i><i></i><i></i></div>';

export interface ColItem { l: string; v: number; v2?: number; hi?: boolean; t: string; tv: string }
/** columns; prev: the comparison as a line (null: no point, e.g. after "сега"); nowX: the mark "сега" (% of the width) */
export function cols(id: string, items: ColItem[], o: { prev?: (number | null)[] | null; prevTip?: (i: number) => string; fmt?: (v: number) => string; xn?: number; nowX?: number | null } = {}): string {
  const prev = o.prev || null, n = items.length, pv = (prev || []).filter((v): v is number => v != null);
  /* counts (no money format): whole ticks only (the half too) */
  const mx = Math.max(...items.map((x) => (x.v || 0) + (x.v2 || 0)), ...pv, 1), nice = o.fmt ? niceMax(Math.max(mx, 10)) : niceCount(mx);
  TIPS[id] = items.map((x, i) => ({ t: x.t, tv: x.tv + (prev && o.prevTip ? o.prevTip(i) : "") }));
  const c = '<div class="cols">' + items.map((x, i) => {
    const h = ((x.v || 0) / nice) * 100, h2 = ((x.v2 || 0) / nice) * 100;
    return '<span data-i="' + i + '"' + (x.v2 ? ' class="st"' : "") + ">" + (x.v2 ? '<i class="ns" style="height:' + h2 + '%"></i>' : "") +
      "<i" + (x.hi ? ' class="hi"' : "") + ' style="height:' + Math.max(h, x.v ? 0.8 : 0) + "%" + (x.v2 ? ";border-radius:0" : "") + '"></i></span>';
  }).join("") + "</div>";
  const pts = prev ? prev.map((v, i) => (v == null ? "" : (((i + 0.5) / n) * 100).toFixed(2) + "," + (100 - (v / nice) * 100).toFixed(2))).filter(Boolean).join(" ") : "";
  const line = pts ? '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline class="ln prev" points="' + pts + '"/></svg>' : "";
  const now = o.nowX != null ? '<i class="now" style="left:' + o.nowX + '%"></i>' : "";
  return '<div class="ow-plot" data-plot="' + id + '">' + yAxis(nice, o.fmt) + '<div class="area">' + grid() + c + line + now + "</div>" + xLabels(items.map((x) => x.l), o.xn) + "</div>";
}

/** a line: cur and prev; cur may end earlier (today up to now) */
export function line(id: string, labels: string[], cur: (number | null)[], prev: (number | null)[] | null, o: { fmt?: (v: number) => string; fmt0?: (v: number) => string; ticks?: number[]; xn?: number; curName?: string; prevName?: string; nowX?: number | null; curLabel?: string } = {}): string {
  const n = labels.length, f = o.fmt || String;
  const all = [...cur, ...(prev || [])].filter((v): v is number => v != null), nice = niceMax(Math.max(...all, 10));
  const pts = (a: (number | null)[]) => a.map((v, i) => (v == null ? null : ((i / (n - 1)) * 100).toFixed(2) + "," + (100 - (v / nice) * 100).toFixed(2))).filter(Boolean).join(" ");
  const pos = (a: (number | null)[]) => { let i = -1; a.forEach((v, j) => { if (v != null) i = j; }); return i < 0 ? null : { x: (i / (n - 1)) * 100, y: 100 - ((a[i] as number) / nice) * 100 }; };
  TIPS[id] = labels.map((l, i) => ({ t: l, tv: (cur[i] != null ? (o.curName || "Днес") + ": " + f(cur[i] as number) : "") + (prev && prev[i] != null ? (cur[i] != null ? " · " : "") + (o.prevName || "Обичайно") + ": " + f(prev[i] as number) : "") }));
  const pc = pos(cur), pp = prev ? pos(prev) : null, cp = pts(cur);
  const svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + (cp ? '<polygon class="wash" points="0,100 ' + cp + " " + (pc ? pc.x.toFixed(2) : 0) + ',100"/>' : "") +
    (prev ? '<polyline class="ln prev" points="' + pts(prev) + '"/>' : "") + '<polyline class="ln cur" points="' + cp + '"/></svg>';
  const dots = (pp ? '<i class="dot prev" style="left:' + pp.x + "%;top:" + pp.y + '%"></i>' : "") + (pc ? '<i class="dot" style="left:' + pc.x + "%;top:" + pc.y + '%"></i>' : "");
  /* the label of today's point: above it; under it, to the right of the line "сега", when the usual line is right above */
  let py: number | null = null;
  if (pc && prev) { const ix = Math.round((pc.x / 100) * (n - 1)); if (prev[ix] != null) py = 100 - ((prev[ix] as number) / nice) * 100; }
  const below = py != null && pc != null && py < pc.y && pc.y - py < 18, bl = below || (!!pc && pc.y < 15);
  const lx = pc ? (bl && o.nowX != null ? Math.max(pc.x, o.nowX) : pc.x) : 0;
  /* the first guess; placeLabels() moves it where no line crosses it, inside the chart */
  const toR = bl && lx < 75;
  const labs = pc && o.curLabel ? '<span class="elab ' + (toR ? "bl" : "l") + '" data-x="' + pc.x + '" data-nx="' + (o.nowX != null ? o.nowX : "") + '" style="left:' + (toR ? lx : pc.x) + "%;top:" + pc.y + '%">' + esc(o.curLabel) + "</span>" : "";
  const now = o.nowX != null ? '<i class="now" style="left:' + o.nowX + '%"></i>' : "";
  return '<div class="ow-plot" data-plot="' + id + '" data-line="1">' + yAxis(nice, o.fmt0 || o.fmt) + '<div class="area">' + grid() + svg + now + dots + labs + "</div>" + xLabels(labels, o.xn, o.ticks || null, true) + "</div>";
}

/** the legend: [text, class] (class: "" a square, "r" red, "ln" a line, "ln prev" the comparison) */
export const legend = (items: [string, string?][]) => '<ul class="ow-lgd">' + items.map((x) => '<li><i class="' + (x[1] || "") + '"></i>' + esc(x[0]) + "</li>").join("") + "</ul>";

export interface HRow { n: string; icon?: string; v: number; vt: string; sub?: string; d?: string }
/** bars: the share with a word (sub), the difference on its own line (d) */
export function hbars(rows: HRow[]): string {
  const mx = Math.max(...rows.map((r) => r.v), 1e-9);
  return '<div class="ow-hb">' + rows.map((r) => '<div class="r"><span class="n">' + (r.icon ? ic(r.icon, 20) : "") + "<span>" + esc(r.n) + '</span></span><span class="v">' + r.vt + '</span><span class="tr" aria-hidden="true"><i style="width:' + (r.v / mx) * 100 + '%"></i></span>' +
    (r.sub ? '<span class="s">' + r.sub + "</span>" : "") + (r.d ? '<span class="dd">' + r.d + "</span>" : "") + "</div>").join("") + "</div>";
}

export interface Table { head: string[]; rows: (string | number)[][] }
export function tableHTML(t: Table, cap: string): string {
  return '<div class="ow-tablewrap"><table class="ow-table"><caption class="vh">' + esc(cap) + "</caption><thead><tr>" + t.head.map((h, i) => '<th scope="col"' + (i ? ' class="r"' : "") + ">" + esc(h) + "</th>").join("") + "</tr></thead><tbody>" +
    t.rows.map((r) => "<tr>" + r.map((c, i) => (i ? '<td class="r" data-label="' + esc(t.head[i]) + '">' + esc(String(c)) + "</td>" : '<th scope="row" data-main>' + esc(String(c)) + "</th>")).join("") + "</tr>").join("") + "</tbody></table></div>";
}

/** a card with a chart and the button "Таблица" / "Графика" */
export function card(o: { id: string; page: string; title: string; sub?: string; cls?: string; anchor?: string; inner: string; table?: Table; extra?: string }): string {
  const tb = !!showTbl[o.id] && !!o.table, plain = o.title.replace(/<[^>]+>/g, "");
  return '<section class="ow-card ' + (o.cls || "") + '" aria-labelledby="h-' + o.id + '" data-edit-id="own.' + o.page + "." + o.id + '"' + (o.anchor ? ' id="' + o.anchor + '"' : "") + '><header><div><h2 id="h-' + o.id + '">' + o.title + (o.sub ? "<small>" + o.sub + "</small>" : "") + "</h2></div>" +
    (o.table ? '<button class="pill pill-soft ow-tbtn" type="button" data-tbl="' + o.id + '" aria-label="' + (tb ? "Графика: " : "Таблица: ") + esc(plain) + '">' + ic(tb ? "chart-bar" : "list-bullets", 18) + (tb ? "Графика" : "Таблица") + "</button>" : "") + "</header>" +
    (tb ? tableHTML(o.table!, plain) : o.inner) + (o.extra || "") + "</section>";
}

/** the label of today's point: the first place around the point where no line of the chart crosses it and it stays
    inside the chart (above left, below right after "сега", below left, above right); else above left on the card's colour */
export function placeLabels(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>(".ow-plot .elab").forEach((lab) => {
    const plot = lab.closest<HTMLElement>(".ow-plot")!, area = plot.querySelector<HTMLElement>(".area")!, svg = area.querySelector("svg");
    const A = area.getBoundingClientRect(), P = plot.getBoundingClientRect(); if (!A.width) return;
    const segs: [number, number, number, number][] = [];
    svg?.querySelectorAll("polyline").forEach((pl) => {
      const p = (pl.getAttribute("points") || "").trim().split(/\s+/).map((xy) => xy.split(",").map(Number)).map(([x, y]) => [A.left + (x / 100) * A.width, A.top + (y / 100) * A.height]);
      for (let i = 1; i < p.length; i++) segs.push([p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]]);
    });
    const hits = (r: DOMRect) => segs.some(([x1, y1, x2, y2]) => {
      const L = r.left - 2, R = r.right + 2, T = r.top - 2, B = r.bottom + 2;
      if (Math.max(x1, x2) < L || Math.min(x1, x2) > R) return false;
      /* sample the segment inside the box's x range */
      for (let k = 0; k <= 12; k++) { const t = k / 12, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t; if (x >= L && x <= R && y >= T && y <= B) return true; }
      return false;
    });
    const x = +(lab.dataset.x || 0), nx = lab.dataset.nx ? +lab.dataset.nx : null;
    const tries: [string, number][] = [["l", x], ["bl", nx != null ? Math.max(x, nx) : x], ["dl", x], ["r", x]];
    lab.classList.remove("bg");
    for (const [cls, left] of tries) {
      lab.classList.remove("l", "bl", "dl", "r"); lab.classList.add(cls); lab.style.left = left + "%";
      const r = lab.getBoundingClientRect();
      if (r.left >= P.left && r.right <= P.right && r.top >= P.top - 4 && !hits(r)) return;
    }
    lab.classList.remove("l", "bl", "dl", "r"); lab.classList.add("l", "bg"); lab.style.left = x + "%";
  });
}
let placing = false;
/** the tooltips on pointer move (the table is the accessible way to the same numbers); the point labels placed */
export function bindTips(root: ParentNode): void {
  placeLabels(root);
  if (!placing) { placing = true; window.addEventListener("resize", () => placeLabels(document)); }
  root.querySelectorAll<HTMLElement>("[data-plot]").forEach((pl) => {
    const data = TIPS[pl.dataset.plot || ""], area = pl.querySelector<HTMLElement>(".area");
    if (!data || !area || pl.dataset.tip) return;
    pl.dataset.tip = "1";
    const tip = document.createElement("div"); tip.className = "ow-tip"; tip.hidden = true; pl.appendChild(tip);
    pl.addEventListener("pointermove", (e) => {
      const r = area.getBoundingClientRect(), isLine = !!pl.dataset.line, n = data.length;
      const i = isLine ? Math.round(((e.clientX - r.left) / r.width) * (n - 1)) : Math.floor(((e.clientX - r.left) / r.width) * n);
      if (i < 0 || i >= n || !data[i].tv) { tip.hidden = true; return; }
      pl.querySelectorAll<HTMLElement>(".cols span").forEach((b) => b.classList.toggle("on", +(b.dataset.i || -1) === i));
      const pr = pl.getBoundingClientRect(), x = isLine ? (i / Math.max(1, n - 1)) * r.width : ((i + 0.5) / n) * r.width;
      tip.hidden = false; tip.innerHTML = esc(data[i].tv) + "<small>" + esc(data[i].t) + "</small>";
      tip.style.left = Math.max(90, Math.min(pr.width - 90, r.left - pr.left + x)) + "px"; tip.style.top = "0px";
    });
    pl.addEventListener("pointerleave", () => { tip.hidden = true; pl.querySelectorAll(".cols span.on").forEach((b) => b.classList.remove("on")); });
  });
}
