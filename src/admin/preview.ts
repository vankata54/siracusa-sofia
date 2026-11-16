/* "Модулите на живо" (/admin/preview/#m=site&p=home&d=phone): port 1:1 of design/pages-admin/preview.html (version 4).
   The REAL pages of the code in a frame of a phone (390 × 844), a tablet (820 × 1180, "Хоризонтално") or a computer
   (1440 × 900, with the browser bar and the address), scaled to fit ("Побери · 86%") or "100%". Module, screen,
   "Предишен" / "Следващ", the hour of the site (?preview=1&t=21:30, decision 04.11.2026), the theme in the frame,
   "Презареди", "Отвори в нов раздел"; the choice stays in the address. On the phone the device is the whole screen with a
   floating bar (Табло · Екран · Устройство · Молив).
   - The modules: the client site (all routes of src/lib/routes.ts, the addresses come from the page, made with url.*),
     the staff modules until stage D as their stubs (/servitor/, /kuhnya/, /shofyor/), QR маса and Часовник as a plate
     "Модулът идва в етап D", the admin's own screens (only the allowed ones). Управител and Собственик are "Скоро".
     Only the modules the role may see (modCan, as the dashboard); no right to the page: "Нямате права за този раздел.".
   - The pencil points into the frame (the same origin): the outline is drawn in the frame's document, the sheet is here;
     the address saved is the path in the frame ("/menu/pitsi/"), the size is the device's. #n=<id> opens a note on its
     address and size and outlines the element (or says that it is not there).
   - The frame leaves nothing in the viewer's storage (the frame and the admin share one origin): see "guard" below. */
import "sc-icons:caret-left,caret-right,arrow-clockwise,sliders-horizontal,arrow-up-right,pencil-simple,list,lock,warning,qr-code,clock,squares-four";
import { A, mount, can, modCan, session, MODULES, SEC, sheet, toast, ic, esc, who, loadSummary, empty, type Mod, type Sheet } from "./a.ts";
import { aurl } from "./routes.ts";
import { adminApi } from "../client/api-admin.ts";
import type { FeedbackNote } from "../client/api-types.ts";
import type { Pencil } from "./pencil.ts";

type Dev = "phone" | "tablet" | "desktop";
interface Scr { k: string; n: string; path: string }
interface PMod { id: string; n: string; ic: string; what: string; dev: Dev; land: boolean; time: boolean; sec: string; plate: string[] | null; screens: Scr[] }

const DEV: Record<Dev, [number, number, string]> = { phone: [390, 844, "Телефон"], tablet: [820, 1180, "Таблет"], desktop: [1440, 900, "Компютър"] };
const TIMES: [string, string][] = [["now", "Сега (истинският час)"], ["08:30", "08:30 · преди отваряне"], ["12:30", "12:30 · обед"], ["16:30", "16:30 · -30% обедно"], ["21:30", "21:30 · без доставка"], ["23:30", "23:30 · затворено"]];
const THEMES: [string, string][] = [["system", "Авто"], ["light", "Светла"], ["dark", "Тъмна"]];
/* the screens of the approved design of the modules that come in stage D (shown on the plate) */
const FUTURE: Record<string, string[]> = {
  masa: ["Добре дошли", "Меню на масата", "Обща количка", "Повикай сервитьор", "Сметката"],
  watch: ["Смарт часовник"],
};
/* the prototype's folders in old addresses and notes */
const ALIAS: Record<string, string> = { servitor: "waiter", kuhnya: "kitchen", shofyor: "driver" };

const $ = <E extends Element = HTMLElement>(s: string, r: ParentNode = document) => r.querySelector<E>(s);
const $$ = <E extends Element = HTMLElement>(s: string, r: ParentNode = document) => Array.from(r.querySelectorAll<E>(s));

/* ---------- addresses: logical paths ("/menu/pitsi/#x") <-> hrefs of this build (the server or the demo) ---------- */
const de = document.documentElement, DEMO = de.dataset.demo === "1";
const ROOT = ((r) => (r.endsWith("/") ? r : r + "/"))(de.dataset.root || "/");
function hrefOf(logical: string): string {
  const m = /^([^?#]*)(.*)$/.exec(logical)!, p = m[1].replace(/^\//, "");
  return (DEMO ? ROOT + (p === "" || p.endsWith("/") ? p + "index.html" : p) : "/" + p) + m[2];
}
function logicalOf(u: { pathname: string; hash: string }): string {
  const rp = new URL(ROOT, location.href).pathname;
  const p = (u.pathname.startsWith(rp) ? "/" + u.pathname.slice(rp.length) : u.pathname).replace(/index\.html$/, "");
  return p + u.hash;
}
const bare = (l: string) => l.split("#")[0];

/* ---------- the hash: #m=site&p=home&d=phone[&o=land][&t=21:30][&th=dark][&z=100][&n=<note>] ---------- */
function readHash(): Record<string, string> {
  const h: Record<string, string> = {};
  location.hash.replace(/^#/, "").split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) { try { h[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); } catch { /* broken */ } } });
  return h;
}
function writeHash(h: Record<string, string>) {
  const s = Object.keys(h).filter((k) => h[k] !== "" || k === "p").map((k) => k + "=" + String(h[k]).replace(/[^\w:.-]/g, encodeURIComponent)).join("&");
  try { history.replaceState(history.state, "", "#" + s); } catch { /* old browser */ }
}

/* ---------- the modules of the code ---------- */
function modules(site: [string, string, string][]): PMod[] {
  const app = (role: string, n: string): Scr[] => [{ k: "app", n, path: "/" + (role === "waiter" ? "servitor" : role === "kitchen" ? "kuhnya" : "shofyor") + "/" }];
  return MODULES.filter((m) => !m.soon && modCan(m)).map((m: Mod): PMod => {
    const base = { id: m.id, n: m.n, ic: m.ic, what: m.what, dev: (m.dev || "phone") as Dev, land: m.id === "kitchen", time: m.id === "site", sec: m.sec || "site", plate: null as string[] | null };
    if (m.id === "site") return { ...base, screens: site.map(([k, n, path]) => ({ k, n, path })) };
    if (m.id === "waiter" || m.id === "kitchen" || m.id === "driver") return { ...base, screens: app(m.id, "Модулът ти идва скоро") };
    if (m.id === "admin") return { ...base, screens: m.screens.filter((k) => k === "login" || !SEC[k] || can(k)).map((k) => ({ k, n: k === "login" ? "Вход" : SEC[k] ? SEC[k].n : k, path: k === "login" ? "/admin/vhod/" : aurl.logical(k) })) };
    return { ...base, plate: FUTURE[m.id] || [], screens: [{ k: "soon", n: "Модулът идва в етап D", path: "" }] };
  });
}

/* ---------- guard: the frame never leaves the site's state in the viewer's storage ----------
   The frame is the same origin as the admin (the pencil needs it), so a page in it would write its cart, prefs, cookie
   answer, profile and drafts ("sc-*") into the admin's own localStorage. Here:
   - before a page of the frame loads, the frame's own values are put in ("arm": the hour, the theme, "only the necessary
     cookies", the cart that the frame added a moment ago); as soon as it has loaded they are put back ("disarm");
   - every write of the frame is seen at once (the "storage" event of this window, StorageEvent.url = the frame's
     address), kept for the frame and put back at once through the frame's own Storage (so the page in the frame keeps
     its state in memory: no storage event reaches it);
   - leaving the preview (pagehide): the frame is unloaded first, then everything is put back, also sessionStorage;
   - a crash in between: the viewer's values wait in "sa-pv-own" and are put back on the next open of the preview.
   Not "sc-db-*" (the demo's data: an order in the frame is a real order, as on the server) and not "sc-demo-staff" (the
   admin's own demo session). */
const JOURNAL = "sa-pv-own";
const siteKey = (k: string | null): k is string => !!k && k.startsWith("sc-") && !k.startsWith("sc-db-") && k !== "sc-demo-staff";
const own = new Map<string, string | null>(), mine = new Map<string, string | null>(), expect = new Map<string, (string | null)[]>(), seenUrls = new Set<string>();
let ssOwn: Record<string, string> = {}, leaving = false;
let frame: HTMLIFrameElement | null = null;
function put(s: Storage, k: string, v: string | null) { try { if (v == null) s.removeItem(k); else s.setItem(k, v); } catch { /* full / private */ } }
function journal() { try { if (own.size) localStorage.setItem(JOURNAL, JSON.stringify(Object.fromEntries(own))); else localStorage.removeItem(JOURNAL); } catch { /* private */ } }
function remember(k: string, v: string | null) { if (!own.has(k)) { own.set(k, v); journal(); } }
function frameStorage(): Storage | null { try { const w = frame && frame.contentWindow; return w && w.location.href !== "about:blank" ? w.localStorage : null; } catch { return null; } }
function guardStart() {
  try { const j = JSON.parse(localStorage.getItem(JOURNAL) || "null") as Record<string, string | null> | null; if (j) { Object.keys(j).forEach((k) => { if (siteKey(k)) put(localStorage, k, j[k]); }); localStorage.removeItem(JOURNAL); } } catch { /* nothing to put back */ }
  try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k && k.startsWith("sc-")) ssOwn[k] = sessionStorage.getItem(k) || ""; } } catch { /* private */ }
  window.addEventListener("storage", (e) => {
    if (leaving || !siteKey(e.key)) return;
    try { if (e.storageArea === sessionStorage) return; } catch { /* no sessionStorage */ }
    const k = e.key, ex = expect.get(k), i = ex ? ex.indexOf(e.newValue) : -1;
    if (ex && i > -1) { ex.splice(0, i + 1); return; } /* our own putting back */
    let fromFrame = seenUrls.has(e.url);
    try { fromFrame = fromFrame || (!!frame && frame.contentWindow!.location.href === e.url); } catch { /* gone */ }
    if (!fromFrame) { if (own.has(k)) { own.set(k, e.newValue); journal(); } return; } /* another tab of the viewer: that is the viewer's value */
    remember(k, e.oldValue); mine.set(k, e.newValue); back(k);
  });
}
/** the viewer's value of one key back, through the frame's Storage when it is there */
function back(k: string) {
  if (!own.has(k)) return;
  const v = own.get(k)!, fs = frameStorage();
  let cur: string | null = null; try { cur = localStorage.getItem(k); } catch { return; }
  if (cur === v) return;
  if (fs) { const ex = expect.get(k) || []; ex.push(v); expect.set(k, ex); put(fs, k, v); } else put(localStorage, k, v);
}
function arm() {
  if (leaving) return;
  mine.forEach((v, k) => { let cur: string | null = null; try { cur = localStorage.getItem(k); } catch { return; } remember(k, cur); if (cur !== v) put(localStorage, k, v); });
}
function disarm() { own.forEach((_, k) => back(k)); }
function leave() {
  if (leaving) return; leaving = true;
  try { frame && frame.remove(); } catch { /* already gone */ } /* unloads the frame now: its last writes come before ours */
  own.forEach((v, k) => put(localStorage, k, v)); own.clear(); journal();
  try {
    const now: string[] = []; for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); if (k && k.startsWith("sc-")) now.push(k); }
    now.forEach((k) => { if (!(k in ssOwn)) sessionStorage.removeItem(k); });
    Object.keys(ssOwn).forEach((k) => { if (sessionStorage.getItem(k) !== ssOwn[k]) sessionStorage.setItem(k, ssOwn[k]); });
  } catch { /* private */ }
}

/* ---------- the page ---------- */
export async function initPreview(site: [string, string, string][]): Promise<void> {
  guardStart();
  window.addEventListener("pagehide", leave); window.addEventListener("beforeunload", leave);
  /* back from the browser's cache: the frame was unloaded on the way out, start again */
  window.addEventListener("pageshow", (e) => { if (e.persisted) location.reload(); });

  const H = readHash();
  let me = null; try { me = await session(); } catch { /* mount shows the error */ }
  const mods = me ? modules(site) : [];
  const MODS: Record<string, PMod> = {}; mods.forEach((m) => { MODS[m.id] = m; });
  /* the note of #n=<id> (the notes for the section "Бележки", else the person's own recommendations) */
  let NOTE: FeedbackNote | null = null, noteMissing = false;
  if (me && H.n) {
    try { const list = await (can("notes") ? adminApi.notes() : adminApi.myNotes()); NOTE = list.find((x) => x.id === H.n) || null; } catch { /* no note */ }
    noteMissing = !NOTE;
  }
  const want = ALIAS[(NOTE && NOTE.module) || H.m || ""] || (NOTE && NOTE.module) || H.m || "";
  const mod0: PMod | null = MODS[want] || mods[0] || null;
  const wanted = MODULES.find((m) => m.id === want);
  const denied = want && !MODS[want] && wanted && !wanted.soon && mod0 ? wanted : null;
  if (denied && NOTE) NOTE = null;

  const body = await mount({ section: mod0 ? mod0.sec : "site", title: "На живо", barTitle: mod0 ? mod0.n + " на живо" : "На живо", crumb: "Модулите", head: false, wide: true, pencil: false,
    docTitle: (mod0 ? mod0.n : "Модулите") + " на живо" });
  if (!body || !A.app || !A.col || !A.scroller) return;
  if (!mod0) { body.innerHTML = '<div class="sa-card">' + empty({ icon: "lock", title: "Няма модул, който ролята да вижда на живо.", text: "Помолете главния админ за права.", action: '<a class="pill pill-ink" href="' + aurl.home() + '">Към таблото</a>' }) + "</div>"; return; }
  const mod: PMod = mod0;
  const app = A.app, col = A.col, scroller = A.scroller;
  /* immersive: the side bar narrow (only here, the viewer's choice stays), on the phone the device is the whole screen */
  app.classList.add("immersive"); app.dataset.side = "mini";
  const sideBtn = () => $<HTMLButtonElement>('[data-sa="side"]', app);
  const paintSide = () => { const b = sideBtn(); if (!b) return; const mini = app.dataset.side === "mini"; b.setAttribute("aria-expanded", String(!mini)); b.innerHTML = ic(mini ? "caret-right" : "caret-left", 22) + '<span class="lb">Свий лентата</span><span class="sh">Разгъни</span>'; };
  paintSide();
  document.addEventListener("click", (e) => { if (!(e.target as Element).closest('[data-sa="side"]')) return; e.stopImmediatePropagation(); app.dataset.side = app.dataset.side === "mini" ? "open" : "mini"; paintSide(); setTimeout(layout, 30); }, true);
  /* "Молив" in the top bar (a.ts toggles A.pen for [data-sa="pen"]) */
  $('.sa-top [data-sa="sections"]', app)?.insertAdjacentHTML("afterend", '<button class="sa-tb" type="button" data-sa="pen" aria-pressed="false">' + ic("pencil-simple", 20) + "Молив</button>");

  const plate = !!mod.plate;
  const st = { d: (DEV[H.d as Dev] ? H.d : mod.dev) as Dev, land: H.o === "land" || (!H.o && mod.land), t: H.t && TIMES.some((x) => x[0] === H.t) ? H.t : "now",
    th: THEMES.some((x) => x[0] === H.th) ? H.th : "system", z: H.z === "100" ? "100" : "fit", p: H.p || "", custom: null as [number, number] | null, vp: [390, 844] as [number, number] };
  if (NOTE) {
    const w = NOTE.viewport.w, h = NOTE.viewport.h;
    st.d = w < 700 ? "phone" : w < 1100 || (w < 1366 && w > h && mod.dev === "tablet") ? "tablet" : "desktop";
    st.custom = [w, h]; st.land = w > h && st.d === "tablet";
  }
  const scr = () => mod.screens.find((x) => x.k === st.p) || mod.screens[0];
  if (!NOTE) st.p = scr().k;
  else { const f = mod.screens.find((x) => x.path === NOTE!.url) || mod.screens.find((x) => bare(x.path) === bare(NOTE!.url)); st.p = f ? f.k : ""; }
  let showNote = !!NOTE;

  /* the frame's own state from the start: the hour and the theme, and the cookie banner answered "only the necessary"
     when the viewer has not answered (the banner must not cover the frame); the viewer's answer stays */
  const prefsFor = () => { let p: Record<string, unknown> = {}; try { p = JSON.parse((mine.has("sc-prefs") ? mine.get("sc-prefs") : localStorage.getItem("sc-prefs")) || "{}") || {}; } catch { p = {}; } p.theme = st.th; p.time = st.t; return JSON.stringify(p); };
  if (mod.time) { mine.set("sc-prefs", prefsFor()); let ck: string | null = null; try { ck = localStorage.getItem("sc-cookie"); } catch { /* private */ } if (ck == null) mine.set("sc-cookie", JSON.stringify("min")); }

  /* ---------- markup ---------- */
  const isPhoneUI = () => app.clientWidth < 700;
  const srcOf = (logical: string) => { const h = hrefOf(logical); if (!mod.time) return h; const u = new URL(h, location.href); u.searchParams.set("preview", "1"); u.searchParams.set("t", st.t); return u.pathname + u.search + u.hash; };
  /* the new tab: the same page, hour and theme; its address differs from the frame's (t first), so its writes are its own */
  const tabOf = (logical: string) => { const h = hrefOf(logical); if (!mod.time) return h; const u = new URL(h, location.href); return u.pathname + "?t=" + st.t + "&preview=1" + u.hash; };
  const frameLogical = (): string => { try { const w = frame!.contentWindow!; if (w.location.href !== "about:blank") return logicalOf(w.location); } catch { /* not loaded */ } return NOTE && (showNote || !st.p) ? NOTE.url : scr().path; };
  const frameSrc0 = () => srcOf(NOTE && (showNote || !st.p) ? NOTE.url : scr().path);
  const optList = () => '<optgroup label="Екрани">' + mod.screens.map((x) => '<option value="' + x.k + '"' + (x.k === st.p ? " selected" : "") + ">" + esc(x.n) + "</option>").join("") + "</optgroup>" + (st.p === "" ? '<option value="" selected>Друг екран</option>' : "");
  const devSeg = () => '<div class="seg" role="group" aria-label="Устройство" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + (Object.keys(DEV) as Dev[]).map((k) => '<button type="button" data-dev="' + k + '" aria-pressed="' + (st.d === k) + '">' + DEV[k][2] + "</button>").join("") + "</div>";
  const rotBtn = () => (st.d === "tablet" ? '<button class="pill pill-soft" type="button" data-rot>' + ic("arrow-clockwise", 18) + (st.land ? "Вертикално" : "Хоризонтално") + "</button>" : "");
  const themeSeg = () => '<div class="seg" role="group" aria-label="Тема в рамката" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + THEMES.map((t) => '<button type="button" data-th="' + t[0] + '" aria-pressed="' + (st.th === t[0]) + '">' + t[1] + "</button>").join("") + "</div>";
  const timeSel = (id: string) => '<select class="input" id="' + id + '" data-time>' + TIMES.map((t) => '<option value="' + t[0] + '"' + (st.t === t[0] ? " selected" : "") + ">" + t[1] + "</option>").join("") + "</select>";
  const zoomSeg = () => '<div class="seg" role="group" aria-label="Мащаб" style="grid-template-columns:repeat(2,minmax(0,1fr))"><button type="button" data-z="fit" aria-pressed="' + (st.z === "fit") + '">Побери <span class="num" data-pct></span></button><button type="button" data-z="100" aria-pressed="' + (st.z === "100") + '">100%</button></div>';
  const modSel = (id: string) => '<select class="input" id="' + id + '" data-mod>' + mods.map((m) => '<option value="' + m.id + '"' + (m === mod ? " selected" : "") + ">" + esc(m.n) + "</option>").join("") + "</select>";
  body.innerHTML = '<div class="pv" data-edit-id="admin.preview">' +
    '<div class="pv-tools" data-tools>' +
      '<div class="grp mod"><label class="pv-lb" for="pv-m">Модул</label>' + modSel("pv-m") + "</div>" +
      '<div class="grp scr"><label class="pv-lb" for="pv-s">Екран</label><select class="input" id="pv-s" data-scr>' + optList() + "</select>" +
        '<div class="pv-steps"><button class="pill pill-soft" type="button" data-step="-1">' + ic("caret-left", 18) + 'Предишен</button><button class="pill pill-soft" type="button" data-step="1">Следващ' + ic("caret-right", 18) + "</button></div></div>" +
      '<div class="grp dv"><span class="pv-lb">Устройство</span>' + devSeg() + rotBtn() + "</div>" +
      '<div class="grp nw"><span class="pv-lb">Час, тема, мащаб</span><button class="pill pill-soft" type="button" data-fb="device">' + ic("sliders-horizontal", 18) + "Изглед</button></div>" +
      (mod.time ? '<div class="grp ww"><label class="pv-lb" for="pv-t">Час на деня</label>' + timeSel("pv-t") + "</div>" : "") +
      '<div class="grp ww"><span class="pv-lb">Тема в рамката</span>' + themeSeg() + "</div>" +
      '<div class="grp ww"><span class="pv-lb">Мащаб</span>' + zoomSeg() + "</div>" +
      '<div class="grp ww"><span class="pv-lb">Рамката</span><div class="pv-acts"><button class="pill pill-line" type="button" data-reload>' + ic("arrow-clockwise", 18) + 'Презареди</button><a class="pill pill-line" data-newtab href="' + esc(tabOf(NOTE && showNote ? NOTE.url : scr().path)) + '" target="_blank" rel="noopener">' + ic("arrow-up-right", 18) + "Отвори в нов раздел</a></div></div>" +
      '<p class="pv-hint">' + ic("pencil-simple", 20) + "<span><b>Моливът работи и в рамката.</b> Натиснете „Молив“ и посочете елемент от екрана вдясно.</span></p>" +
    "</div>" +
    '<div class="pv-stage" data-stage><div class="pv-fit" data-fit><div class="pv-dev" data-dev-box></div></div><span class="pv-cap" data-cap></span></div>' +
  "</div>";
  const tools = $<HTMLElement>("[data-tools]", body)!, stage = $<HTMLElement>("[data-stage]", body)!, fit = $<HTMLElement>("[data-fit]", body)!, box = $<HTMLElement>("[data-dev-box]", body)!, cap = $<HTMLElement>("[data-cap]", body)!;
  /* the phone: the floating bar */
  col.insertAdjacentHTML("beforeend", '<nav class="pv-fbar" aria-label="Прегледът"><a href="' + aurl.home("modules") + '">' + ic("caret-left", 24) + 'Табло</a><button type="button" data-fb="screen">' + ic("list", 24) + 'Екран</button><button type="button" data-fb="device">' + ic("sliders-horizontal", 24) + 'Устройство</button><button type="button" data-sa="pen" aria-pressed="false">' + ic("pencil-simple", 24) + "Молив</button></nav>");

  /* ---------- the pencil: points into the frame ---------- */
  const penMod = await import("./pencil.ts");
  let pen: Pencil | null = null;
  const syncPen = (on: boolean) => $$('[data-sa="pen"]').forEach((b) => b.setAttribute("aria-pressed", String(on)));
  /* on the phone the round button gives way to "Молив" in the floating bar (as in the prototype) */
  const penPhone = () => { if (pen) pen.host.toggleAttribute("data-sheet", isPhoneUI() || !!$(".sa-ov .sheetwrap")); };
  pen = penMod.mountPencil({
    module: plate ? "admin" : mod.id, who: who(), sectionNotes: can("notes"), notesHref: aurl.section("notes"), toastBottom: 96, barTop: [8, 88],
    doc: () => { try { return frame && frame.contentWindow && frame.contentWindow.location.href !== "about:blank" ? frame.contentDocument : null; } catch { return null; } },
    url: () => (frame ? frameLogical() : logicalOf(location)),
    viewport: () => (frame ? { w: st.vp[0], h: st.vp[1] } : { w: innerWidth, h: innerHeight }),
    onSave: async (n) => { await adminApi.createNote(n); loadSummary(true).catch(() => { /* the badge waits */ }); },
    onToggle: syncPen,
  });
  A.pen = pen; penPhone();

  let loadEl: HTMLElement | null = null, phoneBare = false, sheetNow: Sheet | null = null;
  const dims = (): [number, number] => { let d: [number, number] = st.custom ? [st.custom[0], st.custom[1]] : [DEV[st.d][0], DEV[st.d][1]]; if (!st.custom && st.d === "tablet" && st.land) d = [d[1], d[0]]; return d; };

  function build() {
    phoneBare = isPhoneUI() && st.d === "phone" && !st.custom;
    if (frame) { const old = frame; frame = null; old.remove(); }
    if (plate) {
      box.className = "pv-dev"; box.innerHTML = ""; fit.hidden = true; cap.hidden = true;
      stage.querySelector(".pv-plate")?.remove();
      stage.insertAdjacentHTML("afterbegin", '<section class="pv-plate" data-edit-id="admin.preview.plate"><div class="ill">' + ic(mod.ic, 40) + "</div><h2>Модулът идва в етап D</h2><p>" + esc(mod.n) + ": " + esc(mod.what.charAt(0).toLowerCase() + mod.what.slice(1)) + "</p>" +
        (mod.plate!.length ? "<p>Екраните от одобрения дизайн:</p><ul class=\"scr\">" + mod.plate!.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>" : "") +
        '<a class="pill pill-ink" href="' + aurl.home("modules") + '">' + ic("squares-four", 20) + "Към таблото</a></section>");
      layout(); return;
    }
    box.className = "pv-dev " + (phoneBare ? "bare" : st.d);
    arm();
    const src = frameSrc0(), x = scr();
    seenUrls.add(new URL(src, location.href).href);
    box.innerHTML = (st.d === "desktop" && !phoneBare ? '<div class="pv-chrome" aria-hidden="true"><span class="dots"><i></i><i></i><i></i></span><span class="url" data-url></span></div>' : "") +
      '<div style="position:relative"><iframe title="' + esc(mod.n + ": " + (st.p ? x.n : "екран")) + '" src="' + esc(src) + '" data-frame></iframe><div class="pv-load"><span><i class="spin"></i>Зареждаме екрана …</span></div></div>';
    frame = $<HTMLIFrameElement>("[data-frame]", box)!; loadEl = $(".pv-load", box);
    frame.addEventListener("load", onLoad);
    const u = $("[data-url]", box); if (u) u.textContent = "siracusa · " + bare(NOTE && showNote ? NOTE.url : x.path);
    layout();
  }
  function layout() {
    const sh = scroller.clientHeight, top = stage.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const phone = isPhoneUI(), bottomGap = phone ? 88 : 16;
    const h = Math.max(phone ? 300 : 420, sh - top - bottomGap); stage.style.height = h + "px";
    tools.style.maxHeight = !phone && app.clientWidth >= 1100 ? h + "px" : "";
    if (plate) { st.vp = [innerWidth, innerHeight]; return; }
    let [w, hh] = dims();
    if (phoneBare) { w = stage.clientWidth; hh = h; }
    if (frame) { frame.style.width = w + "px"; frame.style.height = hh + "px"; }
    const chrome = st.d === "desktop" && !phoneBare ? 44 : 0, pad = phoneBare ? 0 : st.d === "phone" ? 12 : st.d === "tablet" ? 18 : 0;
    const ow = w + pad * 2, oh = hh + pad * 2 + chrome, margin = phone ? (phoneBare ? 0 : 12) : 32;
    const sc = st.z === "100" || phoneBare ? 1 : Math.min(1, (stage.clientWidth - margin) / ow, (h - margin) / oh);
    box.style.transform = sc === 1 ? "none" : "scale(" + sc + ")";
    fit.style.width = Math.floor(ow * sc) + "px"; fit.style.height = Math.floor(oh * sc) + "px"; fit.style.margin = phoneBare ? "0" : phone ? "6px" : "16px";
    stage.classList.toggle("z100", st.z === "100" && !phoneBare);
    const pct = Math.round(sc * 100) + "%"; $$("[data-pct]").forEach((el) => { el.textContent = "· " + pct; });
    cap.textContent = w + " × " + hh + " · " + pct;
    st.vp = [w, hh];
  }

  function onLoad() {
    const f = frame; if (!f) return;
    let win: Window | null = null, doc: Document | null = null;
    try { win = f.contentWindow; doc = f.contentDocument; if (!win || win.location.href === "about:blank") return; } catch { loadEl?.classList.add("off"); return; }
    disarm();
    seenUrls.add(win.location.href);
    /* a link inside the frame: the frame's state goes in just before its next page reads it (never while leaving) */
    win.addEventListener("pagehide", () => { if (leaving || frame !== f) return; arm(); loadEl?.classList.remove("off"); setTimeout(() => { if (!leaving) disarm(); }, 4000); });
    try {
      /* the pages' own pencil stays out of the frame: here the pencil is the preview's */
      doc!.head.insertAdjacentHTML("beforeend", "<style>sa-pen-ui{display:none!important}</style>");
      if (st.th !== "system") doc!.documentElement.setAttribute("data-theme", st.th);
    } catch { /* the page is gone */ }
    loadEl?.classList.add("off");
    const lp = logicalOf(win.location);
    const u = $("[data-url]", box); if (u) u.textContent = "siracusa · " + bare(lp);
    /* the screen picker follows the frame */
    const hit = mod.screens.find((x) => x.path === lp) || mod.screens.find((x) => bare(x.path) === bare(lp));
    if (hit) st.p = hit.k; else if (!(NOTE && st.p === "")) st.p = "";
    const sel = $<HTMLSelectElement>("[data-scr]", tools); if (sel) sel.innerHTML = optList();
    saveHash();
    $$<HTMLAnchorElement>("[data-newtab]").forEach((a) => { a.href = tabOf(lp); });
    if (pen) pen.retarget(doc!);
    if (NOTE && showNote) {
      showNote = false; const n = NOTE;
      setTimeout(() => { let ok = false; try { ok = penMod.showNote(doc!, n.selector, n.text); } catch { /* bad selector */ } noteBanner(n, ok); }, 350);
    }
  }

  /* the note this preview was opened for */
  function noteBanner(n: FeedbackNote, ok: boolean) {
    stage.querySelector(".pv-nb")?.remove();
    stage.insertAdjacentHTML("beforeend", '<div class="pv-nb' + (ok ? "" : " warn") + '" role="status">' + ic(ok ? "pencil-simple" : "warning", 22) + '<span class="tx">' +
      (ok ? "<b>Бележка:</b> " + esc(n.text) : "<b>Елементът го няма на страницата.</b> Може да е променен или да е в друго състояние. Бележката: „" + esc(n.text) + "“") +
      '</span><a class="pill pill-soft" href="' + aurl.section("notes") + '">Бележките</a><button class="pill pill-line" type="button" data-hide-note>Скрий</button></div>');
  }
  stage.addEventListener("click", (e) => {
    if (!(e.target as Element).closest("[data-hide-note]")) return;
    stage.querySelector(".pv-nb")?.remove();
    try { if (frame && frame.contentDocument) penMod.hideNote(frame.contentDocument); } catch { /* gone */ }
  });

  function saveHash() {
    const h: Record<string, string> = { m: mod.id, p: st.p, d: st.d };
    if (st.d === "tablet") h.o = st.land ? "land" : "port";
    if (mod.time && st.t !== "now") h.t = st.t;
    if (st.th !== "system") h.th = st.th;
    if (st.z === "100") h.z = "100";
    if (NOTE && st.custom) h.n = NOTE.id;
    writeHash(h);
  }
  function nav(logical: string) {
    if (!frame) { build(); return; }
    loadEl?.classList.remove("off"); arm();
    const src = srcOf(logical); seenUrls.add(new URL(src, location.href).href); frame.src = src;
  }
  function go(p: string) {
    st.p = p; if (!(NOTE && st.custom)) NOTE = null; showNote = false;
    stage.querySelector(".pv-nb")?.remove(); saveHash();
    const x = scr(); if (frame) frame.title = mod.n + ": " + x.n;
    const u = $("[data-url]", box); if (u) u.textContent = "siracusa · " + bare(x.path);
    nav(x.path);
  }
  function reload() {
    if (!frame) { build(); return; }
    loadEl?.classList.remove("off"); arm();
    try { frame.contentWindow!.location.reload(); } catch { frame.src = srcOf(frameLogical()); }
  }

  /* ---------- controls ---------- */
  function paintTools() {
    const g = $("[data-dev]", tools)?.closest(".grp"); if (g) g.innerHTML = '<span class="pv-lb">Устройство</span>' + devSeg() + rotBtn();
    $$("[data-dev]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.dev === st.d)));
  }
  function setDev(k: Dev) { st.d = k; st.custom = null; if (k === "tablet" && H.o == null) st.land = mod.land; paintTools(); saveHash(); build(); }
  function setTheme(t: string) {
    st.th = t; $$("[data-th]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.th === t))); saveHash();
    if (mod.time) mine.set("sc-prefs", prefsFor());
    if (frame && st.th === "system") { try { frame.contentDocument!.documentElement.removeAttribute("data-theme"); } catch { /* gone */ } }
    reload();
  }
  function setTime(t: string) {
    st.t = t; $$<HTMLSelectElement>("[data-time]").forEach((s) => { s.value = t; }); saveHash();
    if (mod.time) mine.set("sc-prefs", prefsFor());
    nav(frameLogical());
  }
  function step(n: number) { const all = mod.screens, i = Math.max(0, all.findIndex((x) => x.k === st.p)); go(all[(i + n + all.length) % all.length].k); }
  const li = (x: Scr) => '<button type="button" data-pick="' + x.k + '"' + (x.k === st.p ? ' aria-current="true"' : "") + ">" + esc(x.n) + "<small>" + esc(bare(x.path)) + "</small></button>";
  function openSheet(title: string, html: string) {
    sheetNow?.close();
    sheetNow = sheet({ title, html, onClose: () => { sheetNow = null; setTimeout(penPhone, 0); } });
    penPhone(); layout();
  }

  document.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-dev],[data-th],[data-z],[data-reload],[data-rot],[data-step],[data-fb],[data-pick],[data-newtab]"); if (!t) return;
    if (t.dataset.dev) { setDev(t.dataset.dev as Dev); return; }
    if (t.dataset.th) { setTheme(t.dataset.th); return; }
    if (t.dataset.z) { st.z = t.dataset.z; $$("[data-z]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.z === st.z))); saveHash(); layout(); return; }
    if (t.hasAttribute("data-reload")) { reload(); return; }
    if (t.hasAttribute("data-rot")) { st.land = !st.land; H.o = st.land ? "land" : "port"; paintTools(); saveHash(); build(); return; }
    if (t.dataset.step) { step(+t.dataset.step); return; }
    if (t.dataset.pick != null) { go(t.dataset.pick); sheetNow?.close(); return; }
    if (t.hasAttribute("data-newtab")) { /* the new tab is the viewer's own tab of the site: it gets the hour by its address */ return; }
    if (t.dataset.fb === "screen") {
      openSheet(mod.n + ": екран", '<div class="pv-sh"><div class="field"><label for="pv-m2">Модул</label>' + modSel("pv-m2") + "</div>" +
        '<div><span class="label">Екрани</span><div class="pv-list">' + mod.screens.map(li).join("") + "</div></div></div>");
      return;
    }
    if (t.dataset.fb === "device") {
      openSheet("Устройство и изглед", '<div class="pv-sh"><div class="field"><span class="label">Устройство</span>' + devSeg() + "</div>" + (mod.time ? '<div class="field"><label for="pv-t2">Час на деня</label>' + timeSel("pv-t2") + "</div>" : "") +
        '<div class="field"><span class="label">Тема в рамката</span>' + themeSeg() + '</div><div class="field"><span class="label">Мащаб</span>' + zoomSeg() + '</div><div class="pv-acts"><button class="pill pill-line" type="button" data-reload>' + ic("arrow-clockwise", 18) + 'Презареди</button><a class="pill pill-line" href="' + esc(tabOf(frameLogical())) + '" data-newtab target="_blank" rel="noopener">' + ic("arrow-up-right", 18) + "Нов раздел</a></div></div>");
    }
  });
  document.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.matches("[data-scr]")) { go(t.value); return; }
    if (t.matches("[data-time]")) { setTime(t.value); return; }
    if (t.matches("[data-mod]")) { const m = MODS[t.value]; if (!m) return; writeHash({ m: m.id, p: m.screens[0].k, d: m.dev }); location.reload(); }
  });
  /* the address typed or changed by hand: start again with it */
  window.addEventListener("hashchange", () => location.reload());
  let rt = 0;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = window.setTimeout(() => { penPhone(); if (!plate && (isPhoneUI() && st.d === "phone" && !st.custom) !== phoneBare) build(); else layout(); }, 120); });

  saveHash();
  build();
  if (denied) toast("Нямате права за „" + denied.n + "“; показваме „" + mod.n + "“.");
  else if (wanted && wanted.soon) toast("„" + wanted.n + "“ идва скоро; показваме „" + mod.n + "“.");
  else if (noteMissing) toast("Бележката не е намерена; показваме екрана.");
}
