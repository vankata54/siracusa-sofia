/* /admin/hall/: "Залата и масите" (design/pages-admin/hall.html, version 4, 1:1; README-3; DECISIONS 16.11.2026 "основа на
   част 3": the whole plan with a version, a removed table stays off, joined tables keep the group).
   - Салон / Градина ("Градината е отворена"), "План" / "Списък" (the phone opens on "Списък", #v=plan for the plan).
   - The SVG plan: drag with the mouse or a finger (step 10), the keyboard (Tab to a table, the arrows move it, Shift
     further, Enter opens its settings) and the buttons "Нагоре · Наляво · Надолу · Надясно".
   - The panel of a table: seats 1-12 (the shape follows), by the window, stroller, accessible, "Само с резервация"
     (walkin: false), joining with the nearest tables, "Раздели", "QR етикет", "Махни масата" (asks first; never deleted).
   - The changes pile up: the frame's bar "3 промени · Откажи · Запази плана"; hallApi.save(plan, version): 409 -> "Някой
     друг промени плана" with "Зареди пак"; 422 -> the field's text and the table selected; leaving unsaved asks first.
     A saved plan is in the core at once (reservations, QR) and the server rebuilds the site (the line under the banner
     follows the rebuild); the demo does not rebuild the site (it says so). "Отмени" after a save puts the earlier plan back.
   - [ЛИПСВА: истински маси и план] while the plan was never saved; capacity [ЛИПСВА] always; no sum of the seats. */
import "sc-icons:plus,warning-circle,chair,tree,map-trifold,list-bullets,sun,baby,wheelchair,lock,users-three,sliders-horizontal,minus,caret-up,caret-left,caret-down,caret-right,x,qr-code,trash,info,check,arrow-clockwise,check-circle,clock,warning";
import { hallApi, siteApi, ApiError, type HallView, type HallData } from "../client/api-admin-3.ts";
/* the icon paths from the global store of src/lib/icons.ts (no import: a new export from the shared runtime would make it
   bigger for every page of the site) */
const ICONS: Record<string, string> = ((globalThis as { __SC_ICONS__?: Record<string, string> }).__SC_ICONS__ ||= {});
import { A, mount, toast, sheet, confirm, skel, failHTML, offline, empty, missing, banner, esc, ic, plural } from "./a.ts";
import { aurl } from "./routes.ts";
import { hmOf } from "./when.ts";

type T = HallData["tables"][number];
type Plan = { tables: T[]; merges: string[][]; gardenOpen: boolean };
type Zone = "salon" | "garden";
const WORLD: Record<Zone, { w: number; h: number }> = { salon: { w: 800, h: 640 }, garden: { w: 800, h: 440 } };
const ZN: Record<Zone, string> = { salon: "Салон", garden: "Градина" };
const FIELDS: (keyof T)[] = ["n", "zone", "seats", "cx", "cy", "window", "stroller", "access", "walkin", "off"];
const SNAP = 10;
const clone = <X>(v: X): X => JSON.parse(JSON.stringify(v));
const shapeFor = (n: number): T["shape"] => (n <= 2 ? "round" : n <= 4 ? "square" : "rect");
const isNew = (id: string) => id.startsWith("new-");
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const errText = (e: unknown, d = "Не успяхме. Опитайте пак.") => (e instanceof ApiError ? e.message : d);
const seatsWord = (n: number) => n + " " + (n === 1 ? "място" : "места");

function readHash(): Record<string, string> {
  const o: Record<string, string> = {};
  location.hash.replace(/^#/, "").split("&").forEach((p) => { if (!p) return; const i = p.indexOf("="); o[i < 0 ? p : p.slice(0, i)] = i < 0 ? "1" : decodeURIComponent(p.slice(i + 1)); });
  return o;
}

export async function initHall(): Promise<void> {
  const body = await mount({ section: "hall", title: "Залата и масите",
    sub: "Влачете масите, сменете местата и особеностите, обединете маси за големи групи. Резервацията и QR кодовете четат същия план.",
    actions: '<button class="pill pill-red" type="button" data-add>' + ic("plus", 20) + "Нова маса</button>" });
  if (!body) return;
  const root = body, sc = A.scroller!;
  const H = readHash();
  let view: "plan" | "list" = H.v === "list" ? "list" : H.v === "plan" ? "plan" : sc.clientWidth < 620 ? "list" : "plan";
  let zone: Zone = H.z === "garden" ? "garden" : "salon", selId: string | null = H.t || null;
  let V: HallView | null = null, saved: Plan = { tables: [], merges: [], gardenOpen: true }, W: Plan = clone(saved);
  let loadErr: unknown = null, offlineNote = false, conflict = false, saving = false, siteLine = "";
  let mode: "server" | "demo" = document.documentElement.dataset.demo === "1" ? "demo" : "server";

  const planOf = (v: HallView): Plan => ({ tables: clone(v.tables), merges: clone(v.merges), gardenOpen: v.gardenOpen });
  const live = () => W.tables.filter((t) => !t.off);
  const byId = (id: string) => W.tables.find((t) => t.id === id);
  const joinOf = (id: string) => W.merges.find((g) => g.includes(id));
  const changed = (t: T) => { const o = saved.tables.find((x) => x.id === t.id); return !o || FIELDS.some((k) => o[k] !== t[k]); };
  const zoneCount = (z: Zone) => live().filter((t) => t.zone === z).length;

  async function load(): Promise<void> {
    try {
      V = await hallApi.get(); saved = planOf(V); W = clone(saved); loadErr = null; offlineNote = false; conflict = false;
      if (selId && !byId(selId)) selId = null;
    } catch (e) { if (!V) loadErr = e; else { offlineNote = isOffline(e); toast(errText(e)); } }
  }

  /* ---------- a table on the plan (world units, as in the reservation of the site) ---------- */
  function dims(t: T) { const s = shapeFor(t.seats); if (s !== "rect") return { w: 84, h: 84, s }; const k = Math.ceil(t.seats / 2); return { w: Math.max(110, 44 * k + 26), h: 76, s }; }
  function chairs(t: T, d: ReturnType<typeof dims>) {
    const c: number[][] = [], cw = 30, chh = 13, s = d.s;
    if (s === "round") { if (t.seats >= 1) c.push([-d.w / 2 - chh - 6, -cw / 2, chh, cw]); if (t.seats >= 2) c.push([d.w / 2 + 6, -cw / 2, chh, cw]); }
    else if (s === "square") { const pos = [[-cw / 2, -d.h / 2 - chh - 6, cw, chh], [-cw / 2, d.h / 2 + 6, cw, chh], [-d.w / 2 - chh - 6, -cw / 2, chh, cw], [d.w / 2 + 6, -cw / 2, chh, cw]]; for (let i = 0; i < t.seats; i++) c.push(pos[i]); }
    else {
      const top = Math.ceil(t.seats / 2), bot = t.seats - top;
      for (let i = 0; i < top; i++) c.push([-d.w / 2 + (d.w / top) * (i + 0.5) - cw / 2, -d.h / 2 - chh - 6, cw, chh]);
      for (let i = 0; i < bot; i++) c.push([-d.w / 2 + (d.w / bot) * (i + 0.5) - cw / 2, d.h / 2 + 6, cw, chh]);
    }
    return c.map((r) => '<rect class="ch" x="' + r[0] + '" y="' + r[1] + '" width="' + r[2] + '" height="' + r[3] + '" rx="6"/>').join("");
  }
  const topShape = (d: ReturnType<typeof dims>, cls: string, extra = "") => (d.s === "round" ? '<circle class="' + cls + '" cx="0" cy="0" r="' + d.w / 2 + '"' + extra + "/>" : '<rect class="' + cls + '" x="' + -d.w / 2 + '" y="' + -d.h / 2 + '" width="' + d.w + '" height="' + d.h + '" rx="16"' + extra + "/>");
  const icon = (n: string, x: number, y: number, s: number) => '<svg class="fi" x="' + x + '" y="' + y + '" width="' + s + '" height="' + s + '" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">' + (ICONS[n] || "") + "</svg>";
  const feats = (t: T): [string, string][] => { const f: [string, string][] = []; if (t.zone === "salon" && t.window) f.push(["sun", "до прозореца"]); if (t.stroller) f.push(["baby", "детска количка"]); if (t.access) f.push(["wheelchair", "достъпна"]); return f; };
  const nOf = (id: string) => { const t = byId(id); return t ? t.n : "?"; };
  function aria(t: T) {
    const j = joinOf(t.id);
    return "Маса " + t.n + ", " + t.seats + " места" + (feats(t).length ? ", " + feats(t).map((f) => f[1]).join(", ") : "") + (t.walkin === false ? ", само с резервация" : "") +
      (j ? ", обединена с " + j.filter((x) => x !== t.id).map(nOf).join(" и ") : "") + ". Стрелките местят масата, Enter отваря настройките";
  }
  function tableSVG(t: T) {
    const d = dims(t), f = feats(t).concat(t.walkin === false ? [["lock", "само с резервация"]] : []), yb = d.h / 2 + 46, lab = seatsWord(t.seats), lw = lab.length * 10.4, fw = f.length * 26, tw = lw + (f.length ? 8 + fw : 0), x0 = -tw / 2;
    return '<g class="tb' + (t.id === selId ? " sel" : "") + (changed(t) ? " chg" : "") + '" data-t="' + t.id + '" transform="translate(' + t.cx + " " + t.cy + ')" role="button" tabindex="0" aria-pressed="' + (t.id === selId) + '" aria-label="' + esc(aria(t)) + '">' +
      '<rect class="hit" x="' + (-Math.max(d.w, tw) / 2 - 30) + '" y="' + (-d.h / 2 - 32) + '" width="' + (Math.max(d.w, tw) + 60) + '" height="' + (d.h + 92) + '" rx="22"/>' +
      '<rect class="ring" x="' + (-Math.max(d.w, tw) / 2 - 24) + '" y="' + (-d.h / 2 - 28) + '" width="' + (Math.max(d.w, tw) + 48) + '" height="' + (d.h + 84) + '" rx="22"/>' +
      '<g class="shp">' + chairs(t, d) + topShape(d, "tt") + (t.walkin === false ? topShape(d, "hatch", ' fill="url(#hl-hatch)"') : "") + "</g>" +
      /* one text (the number, then the seats): its words are the start of the accessible name (axe label-content-name-mismatch) */
      '<text dominant-baseline="central"><tspan class="no" x="0" y="1">' + t.n + '</tspan> <tspan class="lb" x="' + (x0 + lw / 2) + '" y="' + (yb - 7) + '">' + lab + "</tspan></text>" +
      f.map((x, i) => icon(x[0], x0 + lw + 8 + i * 26, yb - 19, 22)).join("") + "</g>";
  }
  function joinSVG(g: string[]) {
    const ts = g.map(byId).filter((t): t is T => !!t && !t.off && t.zone === zone); if (ts.length < 2) return "";
    let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
    ts.forEach((t) => { const d = dims(t); x1 = Math.min(x1, t.cx - d.w / 2 - 40); y1 = Math.min(y1, t.cy - d.h / 2 - 40); x2 = Math.max(x2, t.cx + d.w / 2 + 40); y2 = Math.max(y2, t.cy + d.h / 2 + 62); });
    const seats = ts.reduce((a, t) => a + t.seats, 0), lab = "Обединени · " + seats + " места", lw = lab.length * 10.5 + 28;
    return '<rect class="join" x="' + x1 + '" y="' + y1 + '" width="' + (x2 - x1) + '" height="' + (y2 - y1) + '" rx="28"/>' +
      '<rect class="jpill" x="' + (x1 + 18) + '" y="' + (y1 - 17) + '" width="' + lw + '" height="34" rx="17"/><text class="jlb" x="' + (x1 + 32) + '" y="' + (y1 + 7) + '">' + lab + "</text>";
  }
  function planSVG() {
    const Z = WORLD[zone], T0 = live().filter((t) => t.zone === zone);
    let h = '<svg class="fp" viewBox="0 0 ' + Z.w + " " + (Z.h + 52) + '" role="application" aria-label="План: ' + (zone === "salon" ? "салон" : "градина") + ". " + plural(T0.length, "маса", "маси") + '. Влачете масите или ги изберете с Tab и ги местете със стрелките." data-plan>';
    h += '<defs><pattern id="hl-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle class="grid" cx="10" cy="10" r="1.4"/></pattern>' +
      '<pattern id="hl-hatch" class="hatch-l" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="10"/></pattern></defs>';
    h += '<rect class="floor" x="8" y="8" width="' + (Z.w - 16) + '" height="' + (Z.h - 16) + '" rx="26"/>';
    if (zone === "garden") { h += '<rect class="lawn" x="8" y="8" width="' + (Z.w - 16) + '" height="' + (Z.h - 16) + '" rx="26"/>'; for (let b = 0; b < 26; b++) h += '<circle class="bush" cx="' + (34 + b * 29) + '" cy="24" r="' + (b % 2 ? 7 : 9) + '"/>'; }
    h += '<rect x="8" y="8" width="' + (Z.w - 16) + '" height="' + (Z.h - 16) + '" rx="26" fill="url(#hl-dots)"/><rect class="wall" x="8" y="8" width="' + (Z.w - 16) + '" height="' + (Z.h - 16) + '" rx="26"/>';
    if (zone === "salon") {
      for (let c = 0; c < 4; c++) { const wx = 110 + c * 193; h += '<rect class="win" x="' + (wx - 60) + '" y="3" width="120" height="11" rx="3"/>'; }
      h += '<line class="gap" x1="60" y1="' + (Z.h - 8) + '" x2="170" y2="' + (Z.h - 8) + '"/><line class="gap" x1="630" y1="' + (Z.h - 8) + '" x2="740" y2="' + (Z.h - 8) + '"/>' +
        '<text class="lbl" x="115" y="' + (Z.h + 26) + '" text-anchor="middle">Вход</text><text class="lbl" x="685" y="' + (Z.h + 26) + '" text-anchor="middle">Градина</text>';
    } else h += '<line class="gap" x1="60" y1="' + (Z.h - 8) + '" x2="170" y2="' + (Z.h - 8) + '"/><text class="lbl" x="115" y="' + (Z.h + 26) + '" text-anchor="middle">Салон</text>';
    h += W.merges.map(joinSVG).join("");
    /* the selected table on top */
    T0.sort((a, b) => Number(a.id === selId) - Number(b.id === selId)).forEach((t) => { h += tableSVG(t); });
    return h + "</svg>";
  }

  /* ---------- the panel of the selected table ---------- */
  const dist = (a: T, b: T) => Math.hypot(a.cx - b.cx, a.cy - b.cy);
  function panelHTML() {
    const t = selId ? byId(selId) : undefined;
    if (!t || t.off || t.zone !== zone) return '<aside class="hl-panel" aria-label="Настройки на масата" data-edit-id="admin.hall.panel"><div class="hl-none"><span class="ill">' + ic("chair", 32) + "</span><b>Изберете маса</b><span>Докоснете маса на плана или в списъка. Тук сменяте местата, особеностите и обединяването.</span></div></aside>";
    const j = joinOf(t.id), others = isNew(t.id) ? [] : live().filter((x) => x.zone === t.zone && x.id !== t.id && !isNew(x.id) && !(j && j.includes(x.id))).sort((a, b) => dist(a, t) - dist(b, t)).slice(0, 4);
    const sw = (k: string, icn: string, label: string, help: string, on: boolean) => '<label class="hl-sw"><span class="t">' + ic(icn, 22) + "<span>" + label + (help ? "<small>" + help + "</small>" : "") + '</span></span><span class="sa-switch"><input type="checkbox" role="switch" data-f="' + k + '"' + (on ? " checked" : "") + '><span class="tr"></span></span></label>';
    return '<aside class="hl-panel" aria-label="Настройки на маса ' + t.n + '" data-edit-id="admin.hall.panel">' +
      '<h2><span class="no" aria-hidden="true">' + t.n + "</span><span>Маса " + t.n + "<small>" + ZN[t.zone] + (changed(t) ? " · с промени" : "") + "</small></span></h2>" +
      '<div class="hl-seats"><span class="lab" id="hl-sl">Места</span><div class="counter" role="group" aria-labelledby="hl-sl"><button type="button" data-seat="-1" aria-label="Едно място по-малко"' + (t.seats <= 1 ? " disabled" : "") + ">" + ic("minus", 20) + '</button><output aria-live="polite">' + t.seats + '</output><button type="button" data-seat="1" aria-label="Едно място повече"' + (t.seats >= 12 ? " disabled" : "") + ">" + ic("plus", 20) + "</button></div></div>" +
      "<div>" + (t.zone === "salon" ? sw("window", "sun", "До прозореца", "", t.window) : "") + sw("stroller", "baby", "Място за детска количка", "", t.stroller) + sw("access", "wheelchair", "Достъпна с инвалидна количка", "", t.access) +
        sw("walkin", "lock", "Само с резервация", "Не се дава на гости без резервация", t.walkin === false) + "</div>" +
      '<div><p class="lab" id="hl-ml">Премести</p><div class="hl-move" role="group" aria-labelledby="hl-ml">' +
        '<button class="pill pill-soft" style="grid-area:1/2" type="button" data-mv="0,-1">' + ic("caret-up", 18) + "Нагоре</button>" +
        '<button class="pill pill-soft" style="grid-area:2/1" type="button" data-mv="-1,0">' + ic("caret-left", 18) + 'Наляво</button><button class="pill pill-soft" style="grid-area:2/2" type="button" data-mv="0,1">' + ic("caret-down", 18) + 'Надолу</button><button class="pill pill-soft" style="grid-area:2/3" type="button" data-mv="1,0">Надясно' + ic("caret-right", 18) + "</button></div></div>" +
      '<div class="hl-join"><p class="lab" style="margin:0">Обединяване</p>' +
        (j ? '<p style="margin:0">Обединена с ' + j.filter((x) => x !== t.id).map((x) => "маса " + nOf(x)).join(" и ") + " · " + j.reduce((a, x) => a + (byId(x)?.seats || 0), 0) + ' места общо.</p><div class="row"><button class="pill pill-line" type="button" data-split>' + ic("x", 18) + "Раздели масите</button></div>"
          : isNew(t.id) ? '<p class="muted" style="margin:0">Запазете плана, за да обедините новата маса с други.</p>' : '<p class="muted" style="margin:0">За голяма група: най-близките маси в ' + (t.zone === "salon" ? "салона" : "градината") + ".</p>") +
        (others.length ? '<div class="row">' + others.map((o) => '<button class="chip" type="button" data-join="' + o.id + '">' + ic("plus", 16) + "Маса " + o.n + " · " + o.seats + "</button>").join("") + "</div>" : "") + "</div>" +
      '<div class="hl-foot"><button class="pill pill-line" type="button" data-qr>' + ic("qr-code", 20) + 'QR етикет</button><button class="pill pill-line del" type="button" data-off>' + ic("trash", 20) + "Махни масата</button></div>" +
      "</aside>";
  }
  function listHTML() {
    const T0 = live().filter((t) => t.zone === zone).sort((a, b) => a.n - b.n);
    return '<div class="sa-card"><div role="list" aria-label="Масите в ' + (zone === "salon" ? "салона" : "градината") + '">' + T0.map((t) => {
      const j = joinOf(t.id), f = feats(t);
      return '<div class="hl-li" role="listitem"' + (t.id === selId ? ' aria-current="true"' : "") + '><span class="no" aria-hidden="true">' + t.n + "</span><span><b>Маса " + t.n + " · " + seatsWord(t.seats) + '</b><span class="ft">' +
        (f.length ? f.map((x) => "<span>" + ic(x[0], 16) + x[1] + "</span>").join("") : "<span>Без особености</span>") + (t.walkin === false ? "<span>" + ic("lock", 16) + "само с резервация</span>" : "") + (j ? "<span>" + ic("users-three", 16) + "с " + j.filter((x) => x !== t.id).map(nOf).join(" и ") + "</span>" : "") + (changed(t) ? '<span style="color:var(--warn)">с промени</span>' : "") + "</span></span>" +
        '<button class="pill pill-line" type="button" data-pick="' + t.id + '" aria-pressed="' + (t.id === selId) + '">' + ic("sliders-horizontal", 18) + "Настрой маса " + t.n + "</button></div>";
    }).join("") + "</div></div>";
  }
  function headHTML() {
    const miss = V && V.missing;
    return (miss ? '<div class="hl-warn" role="note">' + ic("warning-circle", 24) + "<div><b>Масите и планът са условни</b><p>" + missing("истински маси и план") + " · капацитет " + missing("капацитет") + ". Сборът от местата не е капацитетът.</p></div></div>"
      : '<p class="hl-cap">' + ic("info", 20) + "<span>Капацитет: " + missing("капацитет") + ". Сборът от местата не е капацитетът.</span></p>") + '<div data-site>' + siteLine + "</div>";
  }

  function draw(keep = true) {
    const y = sc.scrollTop;
    if (!V) { root.innerHTML = loadErr ? failHTML(loadErr, "Не успяхме да заредим плана на залата. Резервациите и QR кодовете работят с последния запазен план.") : skel(4, "Зареждаме плана …"); syncBar(); return; }
    const T0 = live().filter((t) => t.zone === zone);
    root.innerHTML = (offlineNote ? offline("Можете да местите маси. Запазете плана, щом връзката се върне.") + '<div style="height:16px"></div>' : "") +
      (conflict ? '<div class="hl-conf">' + banner({ tone: "warn", icon: "warning-circle", title: "Някой друг промени плана току-що.", text: "Вашите промени не са запазени. Заредете плана пак и ги направете отново.", action: '<button class="pill pill-ink" type="button" data-reload>' + ic("arrow-clockwise", 20) + "Зареди пак</button>" }) + "</div>" : "") +
      headHTML() +
      '<div class="hl-bar"><div class="sa-tabs" role="tablist" aria-label="Зона">' + (["salon", "garden"] as Zone[]).map((z) => '<button role="tab" type="button" data-zone="' + z + '" aria-selected="' + (zone === z) + '">' + ic(z === "salon" ? "chair" : "tree", 20) + ZN[z] + '<span class="c">' + zoneCount(z) + "</span></button>").join("") + "</div>" +
        '<div class="sa-tabs" role="tablist" aria-label="Изглед"><button role="tab" type="button" data-view="plan" aria-selected="' + (view === "plan") + '">' + ic("map-trifold", 20) + 'План</button><button role="tab" type="button" data-view="list" aria-selected="' + (view === "list") + '">' + ic("list-bullets", 20) + "Списък</button></div>" +
        '<span class="grow"></span>' + (zone === "garden" ? '<label class="hl-garden">Градината е отворена<span class="sa-switch"><input type="checkbox" role="switch" data-garden' + (W.gardenOpen ? " checked" : "") + '><span class="tr"></span></span></label>' : "") + "</div>" +
      (zone === "garden" && !W.gardenOpen ? banner({ tone: "warn", icon: "tree", title: "Градината е затворена", text: "Масите ѝ не се показват в резервацията на сайта. QR кодовете ѝ продължават да работят." }) + '<div style="height:12px"></div>' : "") +
      (!T0.length ? '<div class="sa-card">' + empty({ icon: "chair", title: "Няма маси в " + (zone === "salon" ? "салона." : "градината."), text: "Добавете първата с „Нова маса“. Тя се появява в резервацията и получава QR код.", action: '<button class="pill pill-red pill-lg" type="button" data-add>' + ic("plus", 22) + "Нова маса</button>" }) + "</div>"
        : '<div class="hl-grid"><div>' + (view === "plan"
          ? '<ul class="hl-lgd" aria-label="Знаците на плана">' + [["sun", "до прозореца"], ["baby", "място за детска количка"], ["wheelchair", "достъпна с инвалидна количка"], ["lock", "само с резервация"]].map((x) => "<li>" + ic(x[0], 20) + x[1] + "</li>").join("") + '<li><span class="sw j" aria-hidden="true"></span>обединени</li></ul><div class="hl-canvas' + (zone === "garden" && !W.gardenOpen ? " closed" : "") + '" data-edit-id="admin.hall.plan"><div class="core">' + planSVG() + "</div>" +
            '<p class="hl-help">' + ic("info", 20) + "<span>Влачете масите. С клавиатура: Tab до масата, стрелките я местят (Shift: по-далеч), Enter отваря настройките. Има и „Списък“ и бутони „Премести“.</span></p></div>"
          : listHTML()) + "</div>" + panelHTML() + "</div>");
    if (keep) sc.scrollTop = y;
    syncBar();
  }

  /* ---------- unsaved changes: the frame's bar ---------- */
  A.col!.insertAdjacentHTML("beforeend", '<div class="sa-pbar hl-pbar" role="region" aria-label="Незапазени промени"><span class="n" data-n aria-live="polite"></span><button class="pill pill-line" type="button" data-cancel><span class="lg">Откажи промените</span><span class="sm">Откажи</span></button><button class="pill pill-red" type="button" data-save>' + ic("check", 20) + '<span class="lg">Запази плана</span><span class="sm">Запази</span></button></div>');
  const bar = A.col!.querySelector<HTMLElement>(".hl-pbar")!;
  function diffs() {
    let n = 0;
    W.tables.forEach((t) => { if (changed(t)) n++; });
    saved.tables.forEach((o) => { if (!byId(o.id)) n++; });
    if (JSON.stringify(W.merges) !== JSON.stringify(saved.merges)) n++;
    if (W.gardenOpen !== saved.gardenOpen) n++;
    return n;
  }
  function syncBar() {
    const n = V && !conflict ? diffs() : 0;
    bar.classList.toggle("on", n > 0);
    bar.querySelector("[data-n]")!.innerHTML = n ? (n === 1 ? "1 промяна" : n + " промени") + "<small>" + (offlineNote ? "Няма връзка: запазете, щом се върне" : "Още не са запазени") + "</small>" : "";
    bar.querySelector<HTMLButtonElement>("[data-save]")!.disabled = saving;
  }

  /* ---------- the rebuild of the site after a save (the server; the demo says it does not rebuild) ---------- */
  let pollT: ReturnType<typeof setTimeout> | undefined, pollUntil = 0;
  function siteHTML(s: Awaited<ReturnType<typeof siteApi.state>>): string {
    mode = s.mode;
    const b = s.build;
    if (s.mode === "demo") return '<p class="hl-site">' + ic("info", 20) + "<span>В демото сайтът не се пресглобява; на сървъра резервацията в сайта получава плана сама.</span></p>";
    if (b.state === "queued") return '<p class="hl-site wait" role="status">' + ic("clock", 20) + "<span>Сайтът чака да се пресглоби с новия план …</span></p>";
    if (b.state === "building") return '<p class="hl-site wait" role="status">' + ic("arrow-clockwise", 20) + "<span>Сайтът се пресглобява с новия план …</span></p>";
    if (b.state === "done" && b.at) return '<p class="hl-site">' + ic("check-circle", 20) + "<span>Сайтът е пресглобен с плана: готово в " + esc(hmOf(b.at)) + ".</span></p>";
    if (b.state === "error") return '<p class="hl-site bad" role="alert">' + ic("warning", 20) + "<span>Сайтът не се пресглоби, остава предишният. Резервациите вече следват новия план; кажете на главния админ.</span></p>";
    return "";
  }
  function pollSite(start = false) {
    clearTimeout(pollT); if (start) pollUntil = Date.now() + 240_000;
    siteApi.state().then((s) => {
      siteLine = siteHTML(s);
      const el = root.querySelector("[data-site]"); if (el) el.innerHTML = siteLine; else draw();
      if (s.mode !== "demo" && (s.build.state === "queued" || s.build.state === "building" || (s.build.state === "idle" && start)) && Date.now() < pollUntil) pollT = setTimeout(() => pollSite(), 2000);
    }).catch(() => undefined);
  }

  /* ---------- saving ---------- */
  const payload = (p: Plan) => ({
    tables: p.tables.map((t) => ({ ...t, id: isNew(t.id) ? "" : t.id, shape: shapeFor(t.seats) })),
    merges: p.merges, gardenOpen: p.gardenOpen,
  });
  async function save(p: Plan, version: number | undefined, done: (v: HallView) => void) {
    saving = true; syncBar();
    try { const v = await hallApi.save(payload(p), version); saving = false; V = v; done(v); pollSite(true); }
    catch (e) {
      saving = false;
      if (e instanceof ApiError && e.code === "conflict") { conflict = true; draw(); return; }
      if (e instanceof ApiError && e.fields) {
        const k = Object.keys(e.fields)[0], m = /^tables\.(\d+)\./.exec(k || ""), t = m ? p.tables[+m[1]] : null;
        if (t && byId(t.id)) { selId = t.id; zone = t.zone; draw(); }
        toast((t ? "Маса " + t.n + ": " : "") + e.fields[k]); syncBar(); return;
      }
      offlineNote = isOffline(e); draw(); toast(offlineNote ? "Няма връзка. Планът не е запазен; опитайте пак." : errText(e, "Не успяхме да запазим плана. Опитайте пак."));
    }
  }
  function doSave() {
    if (saving || !V) return;
    const n = diffs(), prev = clone(saved), selN = selId ? byId(selId) : undefined;
    save(W, V.version, (v) => {
      saved = planOf(v); W = clone(saved); offlineNote = false;
      if (selN) { const t = W.tables.find((x) => x.n === selN.n && x.zone === selN.zone && !x.off); selId = t ? t.id : null; }
      draw();
      toast("Планът е запазен · " + plural(n, "промяна", "промени") + (mode === "demo" ? ". В демото сайтът не се пресглобява." : ". Сайтът се пресглобява."), {
        undo: () => { if (!V) return; save(prev, V.version, (v2) => { saved = planOf(v2); W = clone(saved); if (selId && !byId(selId)) selId = null; draw(); toast("Върнат е предишният план"); }); },
      });
    });
  }

  /* ---------- drag (mouse and touch), keyboard ---------- */
  let drag: { g: SVGGElement; t: T; svg: SVGSVGElement; dx: number; dy: number; x0: number; y0: number; moved: boolean; id: number } | null = null;
  function svgPt(svg: SVGSVGElement, e: PointerEvent) { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM()!.inverse()); }
  function clampT(t: T) {
    const Z = WORLD[t.zone], d = dims(t);
    t.cx = Math.round(Math.min(Z.w - d.w / 2 - 40, Math.max(d.w / 2 + 40, t.cx)) / SNAP) * SNAP;
    t.cy = Math.round(Math.min(Z.h - d.h / 2 - 66, Math.max(d.h / 2 + 46, t.cy)) / SNAP) * SNAP;
  }
  root.addEventListener("pointerdown", (e) => {
    const g = (e.target as Element).closest<SVGGElement>(".tb"); if (!g || e.button > 0) return;
    const svg = g.ownerSVGElement!, t = byId(g.dataset.t!)!, p = svgPt(svg, e);
    drag = { g, t, svg, dx: p.x - t.cx, dy: p.y - t.cy, x0: t.cx, y0: t.cy, moved: false, id: e.pointerId }; g.setPointerCapture(e.pointerId);
  });
  root.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const p = svgPt(drag.svg, e), nx = p.x - drag.dx, ny = p.y - drag.dy;
    if (!drag.moved && Math.hypot(nx - drag.x0, ny - drag.y0) < 6) return;
    drag.moved = true; drag.g.classList.add("drag");
    drag.t.cx = nx; drag.t.cy = ny; clampT(drag.t); drag.g.setAttribute("transform", "translate(" + drag.t.cx + " " + drag.t.cy + ")");
  });
  function endDrag(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; d.g.classList.remove("drag");
    if (d.moved) { selId = d.t.id; draw(); focusT(d.t.id); hashSync(); } else pick(d.t.id, true);
  }
  root.addEventListener("pointerup", endDrag); root.addEventListener("pointercancel", endDrag);
  root.addEventListener("keydown", (e) => {
    const g = (e.target as Element).closest && (e.target as Element).closest<SVGGElement>(".tb"); if (!g) return;
    const t = byId(g.dataset.t!)!, step = e.shiftKey ? 50 : SNAP;
    const mv = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[e.key];
    if (mv) { e.preventDefault(); t.cx += mv[0] * step; t.cy += mv[1] * step; clampT(t); selId = t.id; draw(); focusT(t.id); return; }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(t.id, true); A.app!.querySelector<HTMLElement>(".hl-panel [data-seat]")?.focus(); }
  });
  function focusT(id: string) { root.querySelector<SVGGElement>('.tb[data-t="' + id + '"]')?.focus({ preventScroll: true }); }
  function hashSync() {
    const o: Record<string, string> = { z: zone === "salon" ? "" : zone, v: view, t: selId || "" };
    const s = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
    try { history.replaceState(null, "", location.pathname + location.search + (s ? "#" + s : "")); } catch { /* ignore */ }
  }
  function pick(id: string, fromPlan = false) {
    selId = id; draw(); hashSync();
    const p = A.app!.querySelector<HTMLElement>(".hl-panel"), r = p && p.getBoundingClientRect();
    if (r && r.top > sc.clientHeight - 120) p!.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    if (fromPlan) focusT(id);
  }

  /* ---------- actions ---------- */
  function freeSpot(z: Zone): [number, number] {
    const Z = WORLD[z];
    for (let y = 110; y < Z.h - 80; y += 60) for (let x = 110; x < Z.w - 80; x += 60) if (live().filter((t) => t.zone === z).every((t) => Math.hypot(t.cx - x, t.cy - y) > 170)) return [x, y];
    return [Z.w / 2, Z.h / 2];
  }
  function addTable() {
    if (!V || conflict) return;
    const n = W.tables.reduce((a, x) => Math.max(a, x.n), 0) + 1, sp = freeSpot(zone);
    const nt: T = { id: "new-" + Date.now().toString(36), n, zone, seats: 4, shape: "square", x: -1, y: -1, cx: sp[0], cy: sp[1], window: false, stroller: zone === "garden", access: false, walkin: true, off: false };
    clampT(nt); W.tables.push(nt); selId = nt.id; draw(); hashSync();
    toast("Нова маса " + n + " в " + (zone === "salon" ? "салона" : "градината") + ". Преместете я на мястото ѝ.", { undo: () => { W.tables = W.tables.filter((x) => x.id !== nt.id); selId = null; draw(); } });
  }
  function leaveTo(href: string) {
    const n = diffs();
    if (!n) { location.href = href; return; }
    const sh = sheet({ title: "Незапазени промени", html: '<p style="margin:0">Имате ' + plural(n, "незапазена промяна", "незапазени промени") + " в плана. Да ги запазим, преди да продължите?</p>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-leave>Не запазвай</button><button class="pill pill-red pill-lg" type="button" data-keep>' + ic("check", 22) + "Запази и продължи</button>" });
    sh.foot!.querySelector<HTMLButtonElement>("[data-leave]")!.onclick = () => { W = clone(saved); sh.close(); location.href = href; };
    sh.foot!.querySelector<HTMLButtonElement>("[data-keep]")!.onclick = () => { sh.close(); if (!V) return; save(W, V.version, (v) => { saved = planOf(v); W = clone(saved); location.href = href; }); };
  }

  document.addEventListener("click", (e) => {
    const el = e.target as Element; let t: HTMLElement | null;
    const a = el.closest<HTMLAnchorElement>("a[href]");
    if (a && V && diffs() && a.target !== "_blank" && (a.getAttribute("href") || "").charAt(0) !== "#" && !e.ctrlKey && !e.metaKey && !a.closest(".sheetwrap")) { e.preventDefault(); leaveTo(a.href); return; }
    if (el.closest("[data-reload]")) { V = null; draw(); void load().then(() => draw()); return; }
    if (el.closest("[data-save]")) { doSave(); return; }
    if (el.closest("[data-cancel]")) { W = clone(saved); if (selId && !byId(selId)) selId = null; draw(); toast("Промените са отменени"); return; }
    if (!root.contains(el) && !el.closest(".sa-head")) return;
    if ((t = el.closest<HTMLElement>("[data-zone]"))) { zone = t.dataset.zone as Zone; const s = selId ? byId(selId) : undefined; if (s && s.zone !== zone) selId = null; draw(); hashSync(); return; }
    if ((t = el.closest<HTMLElement>("[data-view]"))) { view = t.dataset.view as "plan" | "list"; draw(); hashSync(); return; }
    if ((t = el.closest<HTMLElement>("[data-pick]"))) { pick(t.dataset.pick!); return; }
    if (el.closest("[data-add]")) { addTable(); return; }
    const cur = selId ? byId(selId) : undefined; if (!cur) return;
    if ((t = el.closest<HTMLElement>("[data-seat]"))) {
      cur.seats = Math.max(1, Math.min(12, cur.seats + +t.dataset.seat!)); cur.shape = shapeFor(cur.seats); clampT(cur); draw();
      const b = A.app!.querySelector<HTMLButtonElement>('[data-seat="' + t.dataset.seat + '"]'); if (b && !b.disabled) b.focus({ preventScroll: true }); return;
    }
    if ((t = el.closest<HTMLElement>("[data-mv]"))) {
      const m = t.dataset.mv!.split(",").map(Number); cur.cx += m[0] * 20; cur.cy += m[1] * 20; clampT(cur); draw();
      A.app!.querySelector<HTMLElement>('[data-mv="' + t.dataset.mv + '"]')?.focus({ preventScroll: true }); return;
    }
    if ((t = el.closest<HTMLElement>("[data-join]"))) {
      const other = byId(t.dataset.join!)!, j = joinOf(cur.id) || joinOf(other.id);
      if (j) [cur.id, other.id].forEach((id) => { if (!j.includes(id)) j.push(id); }); else W.merges.push([cur.id, other.id]);
      draw();
      toast("Маса " + cur.n + " и маса " + other.n + " са обединени", { undo: () => { const jj = joinOf(other.id); if (jj) { jj.splice(jj.indexOf(other.id), 1); if (jj.length < 2) W.merges.splice(W.merges.indexOf(jj), 1); } draw(); } });
      return;
    }
    if (el.closest("[data-split]")) { const jj = joinOf(cur.id), before = clone(W.merges); if (jj) W.merges.splice(W.merges.indexOf(jj), 1); draw(); toast("Масите са разделени", { undo: () => { W.merges = before; draw(); } }); return; }
    if (el.closest("[data-qr]")) { if (isNew(cur.id)) { toast("Запазете плана: новата маса получава QR код след запис."); return; } leaveTo(aurl.section("qr", "t=" + cur.id)); return; }
    if (el.closest("[data-off]")) {
      confirm({ title: "Да махнем маса " + cur.n + "?", text: "Масата изчезва от плана и от резервацията. QR етикетът ѝ спира да работи. Бъдещите резервации за нея остават и трябва да получат друга маса.", ok: "Махни масата", danger: true, icon: "trash" }, () => {
        const was = clone(W);
        if (isNew(cur.id)) W.tables = W.tables.filter((x) => x.id !== cur.id); else cur.off = true;
        W.merges = W.merges.map((g) => g.filter((x) => x !== cur.id)).filter((g) => g.length > 1); selId = null; draw();
        toast("Маса " + cur.n + " е махната (още не е запазено)", { undo: () => { W = was; selId = cur.id; draw(); } });
      });
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement, cur = selId ? byId(selId) : undefined;
    if (t.matches("[data-garden]")) { W.gardenOpen = t.checked; draw(); root.querySelector<HTMLElement>("[data-garden]")?.focus({ preventScroll: true }); return; }
    if (t.matches("[data-f]") && cur) {
      const k = t.dataset.f as "window" | "stroller" | "access" | "walkin";
      if (k === "walkin") cur.walkin = !t.checked; else cur[k] = t.checked;
      draw(); A.app!.querySelector<HTMLElement>('[data-f="' + k + '"]')?.focus({ preventScroll: true });
    }
  });
  window.addEventListener("beforeunload", (e) => { if (V && diffs()) { e.preventDefault(); e.returnValue = ""; } });

  draw(false);
  await load();
  draw(false);
  if (V && mode !== "demo") siteApi.state().then((s) => { if (s.build.state === "queued" || s.build.state === "building") pollSite(true); }).catch(() => undefined);
}
