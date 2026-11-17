/* Шофьор · Маршрут (/shofyor/marshrut/; design/pages-shofyor/route.html). A stylised scheme (not a map: the quarters
   as blobs around the restaurant S, the next address red), "Път А · по срока" / "Път Б · по-кратък" / "Моят ред" as the
   core gives them (km, minutes and fuel are never invented: [ЛИПСВА: маршрути от OSRM]), "Адресите по ред" with the
   arrival "около" (when the core has one) and the deadline, "По-рано" / "По-късно" on every address; the one he drives
   to is locked first ("Караш към нея сега: остава първа") without its buttons. */
import { mountDriver, driverApi, ic, esc, plural, murl, addrLine, MISS, type Delivery } from "./app.ts";
import type { RouteView, RouteOption } from "../../client/api-driver.ts";

/* where each quarter lies from the restaurant on the scheme (viewBox 360 x 272): only the rough direction, NOT a map */
const POS: Record<string, [number, number]> = { home: [126, 146], "Дружба 2": [170, 150], "Дружба 1": [150, 64], "Гара Искър": [56, 52], "НПЗ Искър": [290, 70], "Бусманци": [296, 192], "Горубляне": [118, 224], out: [30, 130] };
const LBL: Record<string, [number, number]> = { "Дружба 1": [0, -38], "Дружба 2": [0, -34], "НПЗ Искър": [0, -38], "Бусманци": [0, 46], "Горубляне": [0, 46], "Гара Искър": [0, -38] };
/** a small, stable offset per order (two addresses of one quarter do not cover each other) */
function jitter(no: string, i: number): [number, number] {
  let h = 0; for (const c of no) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const a = ((h % 360) * Math.PI) / 180, r = 10 + (i % 3) * 7;
  return [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r * 0.6)];
}

export async function initRoute(): Promise<void> {
  const drv0 = await mountDriver({ screen: "route", tab: "route", title: "Маршрут" });
  if (!drv0) return;
  const drv = drv0;
  const { st } = drv, main = st.main;
  let R: RouteView | null = null;
  const zonesShown = Object.keys(POS).filter((z) => z !== "home" && z !== "out");

  function scheme(stops: Delivery[]): string {
    const P0 = POS.home, nx = stops[0];
    const pt = (d: Delivery, i: number): [number, number] => { const p = POS[d.outzone ? "out" : d.zone] || POS.out, j = jitter(d.no, i); return [p[0] + j[0], p[1] + j[1]]; };
    const pts = stops.map(pt);
    let path = "M" + P0.join(","), prev = P0;
    pts.forEach((p) => { const mx = (prev[0] + p[0]) / 2 + (p[1] - prev[1]) * 0.12, my = (prev[1] + p[1]) / 2 - (p[0] - prev[0]) * 0.12; path += " Q" + mx.toFixed(1) + "," + my.toFixed(1) + " " + p.join(","); prev = p; });
    const last = pts[pts.length - 1];
    const svg = '<svg viewBox="0 0 360 272" role="img" aria-label="Схема на маршрута: ресторантът и ' + plural(stops.length, "адрес", "адреса") + ' по ред. Не е карта; списъкът отдолу е същият.">' +
      zonesShown.map((z) => { const p = POS[z]; return '<ellipse class="sv-zone" cx="' + p[0] + '" cy="' + p[1] + '" rx="52" ry="30"/><text class="sv-zl" x="' + (p[0] + LBL[z][0]) + '" y="' + (p[1] + LBL[z][1]) + '" text-anchor="middle">' + esc(z) + "</text>"; }).join("") +
      (stops.some((d) => d.outzone || !POS[d.zone]) ? '<text class="sv-zl" x="' + POS.out[0] + '" y="' + (POS.out[1] - 26) + '">извън</text>' : "") +
      '<path class="sv-ret" d="M' + last.join(",") + " L" + P0.join(",") + '"/><path class="sv-path" d="' + path + '"/>' +
      '<rect class="sv-home" x="' + (P0[0] - 17) + '" y="' + (P0[1] - 17) + '" width="34" height="34" rx="10"/><text class="sv-stop-t sv-home-t" x="' + P0[0] + '" y="' + P0[1] + '">S</text>' +
      stops.map((d, i) => { const p = pts[i], c = d === nx ? "next" : ""; return '<circle class="sv-stop ' + c + '" cx="' + p[0] + '" cy="' + p[1] + '" r="16"/><text class="sv-stop-t ' + c + '" x="' + p[0] + '" y="' + p[1] + '">' + (i + 1) + "</text>"; }).join("") + "</svg>";
    return '<div class="scheme"><div class="in">' + svg + '</div><div class="cap">' + ic("info", 16) + "Схема, не е карта. S е ресторантът, червено е следващият адрес.</div></div>";
  }
  function card(o: RouteOption, pick: string): string {
    const on = o.key === pick;
    return '<button class="rc" type="button" data-pick="' + o.key + '" aria-pressed="' + on + '"><span class="t">' + esc(o.title) + (on ? st.stt("done", "Избран", "check") : "") + '</span><span class="ord">' + esc(o.sub) + "</span>" +
      '<span class="nums"><span class="muted">км, минути и гориво ' + MISS(o.note) + "</span></span>" +
      '<span class="ord">' + o.zones.map((z, i) => (i + 1) + ". " + esc(z)).join(" → ") + " → S</span></button>";
  }
  function render() {
    if (!R) return;
    const stops = R.stops, L = R.locked;
    if (!stops.length) {
      main.innerHTML = '<section class="st-sec">' + st.empty({ icon: "path", title: "Няма маршрут", text: "Маршрутът се предлага сам, щом имаш взети поръчки.", action: '<a class="pill pill-line pill-lg" href="' + esc(murl.shofyor()) + '" style="margin-top:8px">Към доставките</a>' }) + "</section>";
      return;
    }
    const A = R.options.find((o) => o.key === "A")!, B = R.options.find((o) => o.key === "B")!, own = R.options.find((o) => o.key === "own");
    let h = '<section class="st-sec">' + scheme(stops) + "</section>";
    h += '<section class="st-sec"><div class="st-h"><h2>Предложение</h2><span class="muted">ти решаваш</span></div><div class="rchoice">' + card(A, R.pick) +
      (R.same ? '<p class="small muted" style="margin:0">Най-краткият път съвпада с Път А за този курс.</p>' : card(B, R.pick)) + (own ? card(own, R.pick) : "") + "</div>" +
      '<p class="small muted" style="margin:10px 4px 0">Път А води първо до поръчките с по-ранен срок, Път Б първо до близките квартали. Километрите, минутите и литрите се показват, щом има маршрути ' + MISS(R.note) + ".</p></section>";
    h += '<section class="st-sec"><div class="st-h"><h2>Адресите по ред</h2><span class="muted">пристигане</span></div><div class="stops">' +
      stops.map((d, i) => '<div class="stop" data-no="' + esc(d.no) + '"><span class="no">' + (i + 1) + '</span><a href="' + esc(murl.shofyor("dostavka", d.no)) + '" style="color:inherit;text-decoration:none"><span class="a" style="display:block">' + esc(addrLine(d)) + '</span><span class="s" style="display:block">№ ' + esc(d.no) + " · " + esc(d.stLabel) + "</span></a>" +
        '<span class="eta">' + (d.etaAt ? '<b aria-label="около ' + esc(d.etaAt) + '">~' + esc(d.etaAt) + "</b>" : "") + (d.dueAt ? "срок " + esc(d.dueAt) : "") + "</span>" +
        (d.no === L ? '<span class="lockh">' + ic("lock", 16) + "Караш към нея сега: остава първа</span>"
          : '<span class="mv"><button class="pill pill-soft" type="button" data-up="' + esc(d.no) + '"' + (i === 0 || (i === 1 && L) ? " disabled" : "") + ' aria-label="По-рано: № ' + esc(d.no) + '">' + ic("caret-up", 20) + 'По-рано</button><button class="pill pill-soft" type="button" data-down="' + esc(d.no) + '"' + (i === stops.length - 1 ? " disabled" : "") + ' aria-label="По-късно: № ' + esc(d.no) + '">' + ic("caret-down", 20) + "По-късно</button></span>") + "</div>").join("") +
      '<div class="stop home"><span class="no">S</span><span><span class="a" style="display:block">Обратно в ресторанта</span></span><span class="eta"></span></div></div>' +
      '<p class="small muted" style="margin:10px 4px 0">' + esc(R.etaNote) + " Клиентът вижда приблизително време.</p></section>";
    main.innerHTML = h;
  }
  async function load() {
    try { R = await drv.cached("route", () => driverApi.route()); st.synced(); render(); }
    catch (e) { st.fail(e); }
  }
  drv.onChange(load);
  let busy = false;
  main.addEventListener("click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b || busy || b.disabled) return;
    const up = b.dataset.up, dn = b.dataset.down, pick = b.dataset.pick;
    if (!up && !dn && !pick) return;
    busy = true;
    try {
      if (pick) { R = await driverApi.routePick(pick as "A" | "B" | "own"); st.toast(pick === "own" ? "Караш по своя ред." : "Избран е Път " + (pick === "B" ? "Б" : "А") + "."); }
      else {
        const no = (up || dn)!;
        R = await driverApi.routeMove(no, up ? "up" : "down");
        render();
        main.querySelector<HTMLElement>('.stop[data-no="' + no + '"] [data-' + (up ? "up" : "down") + "]:not([disabled])")?.focus({ preventScroll: true });
        busy = false; return;
      }
      render();
    } catch (er) { drv.oops(er); await load(); }
    finally { busy = false; }
  });
  await load();
}
