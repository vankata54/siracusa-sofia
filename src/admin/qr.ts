/* /admin/qr/: "QR генератор" (design/pages-admin/qr.html, version 4, 1:1; README-3 "QR кодът"; DECISIONS 16.11.2026: a
   stable random code of 8 characters per table from the core, the address /masa/<код>/, "Нов код" stops the old label).
   - The tables in use with their codes from hallApi.qr() (a table without a code gets one there); the label 105 × 74,25 mm:
     the text mark "Siracusa" (the logo [ЛИПСВА]), "Bar & Grill", "Маса 12", the zone, the QR code, the address under it,
     "Сканирайте за меню и повикване". The label is "paper": light with a dark code also in the dark theme (tokens only).
   - The QR code is drawn here (src/admin/qr-code.ts, the port of the prototype's encoder, no outside library), level Q,
     for the address of the site (SITE_URL of the build) + /masa/<код>/.
   - A table (select, "Предишна" / "Следваща", #t=S5), "Копирай", "Как го вижда гостът (пример)" (the QR table in "Модулите
     на живо"), "Изтегли SVG", "Нов код" (asks first: the old label stops at once; the core cannot bring an old code back,
     so there is no "Отмени"); the list by zone with ticks for the print, "Всички", "Нито една", "Избери салона /
     градината"; the A4 sheets (2 × 4); "Печат" (@media print: A4, 8 per sheet, cut lines, always light). */
import "sc-icons:qr-code,caret-left,caret-right,globe,copy,shield-check,arrow-up-right,export,arrow-clockwise,caret-down,info,check,x,chair,tree,eye";
import { hallApi, ApiError, type QrRow } from "../client/api-admin-3.ts";
import { A, mount, toast, confirm, skel, failHTML, offline, empty, missing, esc, ic, plural } from "./a.ts";
import { aurl } from "./routes.ts";
import { makeQr, qrPath, type Qr } from "./qr-code.ts";

const ZN: Record<string, string> = { salon: "Салон", garden: "Градина" };
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const errText = (e: unknown, d = "Не успяхме. Опитайте пак.") => (e instanceof ApiError ? e.message : d);
const tableOfHash = () => { const m = /(?:^#|&)t=([^&]+)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : ""; };

export async function initQr(site: string): Promise<void> {
  const body = await mount({ section: "qr", title: "QR генератор",
    sub: "Етикет с QR код за всяка маса. Кодът води към „/masa/код/“: гостът вижда масата и менюто без вход. Кодът е случаен, за да не се отгатне друга маса.",
    actions: '<button class="pill pill-red" type="button" data-print>' + ic("qr-code", 20) + "<span data-printlbl>Печат</span></button>" });
  if (!body) return;
  const root = body, sc = A.scroller!;
  let T: QrRow[] | null = null, loadErr: unknown = null, offlineNote = false, cur: QrRow | null = null;
  const sel: Record<string, boolean> = {}, fresh: Record<string, boolean> = {};
  const qcache: Record<string, Qr> = {};

  const url = (t: QrRow) => site + t.url;
  const shortUrl = (t: QrRow) => url(t).replace(/^https?:\/\//, "").replace(/\/$/, "");
  const qrOf = (t: QrRow) => (qcache[url(t)] ||= makeQr(url(t), "Q"));
  const selected = () => (T || []).filter((t) => sel[t.id]);
  const pagesOf = <X>(list: X[]) => { const p: X[][] = []; for (let i = 0; i < list.length; i += 8) p.push(list.slice(i, i + 8)); return p; };

  async function load() {
    try {
      const list = (await hallApi.qr()).slice().sort((a, b) => a.n - b.n);
      const first = !T; T = list; loadErr = null; offlineNote = false;
      if (first) list.forEach((t) => { sel[t.id] = true; });
      const want = cur ? cur.id : tableOfHash();
      cur = list.find((t) => t.id === want) || list.find((t) => t.n === 12) || list[0] || null;
    } catch (e) { if (!T) loadErr = e; else { offlineNote = isOffline(e); toast(errText(e)); } }
  }

  /* ---------- the label: SVG 105 × 74,25 mm (× 10), the same on the screen, in the print and in the file ---------- */
  type LabelOpt = { print?: boolean; inline?: boolean; bg?: string; ink?: string; mute?: string };
  function labelSVG(t: QrRow, o: LabelOpt = {}) {
    const q = qrOf(t), n = q.size + 8, S = 430, x0 = 1050 - 64 - S, y0 = 70, big = String(t.n).length > 1 ? 250 : 270;
    const f = (k: "bg" | "ink" | "mute") => (o.inline ? ' fill="' + o[k] + '"' : "");
    const font = o.inline ? ' font-family="Manrope, sans-serif"' : "";
    return '<svg viewBox="0 0 1050 742" role="img" aria-label="Етикет: Маса ' + t.n + ", " + ZN[t.zone] + ". QR код към " + esc(shortUrl(t)) + '"' + (o.inline ? ' xmlns="http://www.w3.org/2000/svg"' : "") + ">" +
      '<rect class="bg" x="0" y="0" width="1050" height="742" rx="' + (o.print ? 0 : 36) + '"' + f("bg") + "/>" +
      '<text class="ink" x="70" y="138" font-size="66" font-weight="800" letter-spacing="-3"' + f("ink") + font + ">Siracusa</text>" +
      '<text class="mute" x="72" y="186" font-size="30" font-weight="700"' + f("mute") + font + ">Bar &amp; Grill</text>" +
      '<line class="rule" x1="70" y1="236" x2="' + (x0 - 40) + '" y2="236"' + (o.inline ? ' stroke="' + o.mute + '" stroke-width="2"' : "") + "/>" +
      '<text class="mute" x="70" y="318" font-size="40" font-weight="700"' + f("mute") + font + ">Маса</text>" +
      '<text class="ink" x="58" y="' + (318 + big - 22) + '" font-size="' + big + '" font-weight="800" letter-spacing="-12"' + f("ink") + font + ">" + t.n + "</text>" +
      '<text class="ink" x="72" y="' + (318 + big + 46) + '" font-size="40" font-weight="700"' + f("ink") + font + ">" + ZN[t.zone] + "</text>" +
      '<text class="ink" x="70" y="684" font-size="36" font-weight="800"' + f("ink") + font + ">Сканирайте за меню и повикване</text>" +
      '<svg x="' + x0 + '" y="' + y0 + '" width="' + S + '" height="' + S + '" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges">' +
        '<rect class="bg" width="' + n + '" height="' + n + '"' + f("bg") + '/><path class="ink" data-qrpath d="' + qrPath(q, 4) + '"' + f("ink") + "/></svg>" +
      '<text class="mute mono" x="' + (x0 + S / 2) + '" y="' + (y0 + S + 34) + '" font-size="25" font-weight="600" text-anchor="middle"' + f("mute") + (o.inline ? ' font-family="monospace"' : "") + ">" + esc(shortUrl(t)) + "</text>" +
      "</svg>";
  }
  function miniQR(t: QrRow) { const q = qrOf(t), n = q.size + 8; return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + n + " " + n + '" shape-rendering="crispEdges"><path d="' + qrPath(q, 4) + '"/></svg>'; }
  function selCount() { const n = selected().length, p = Math.ceil(n / 8); return n ? plural(n, "етикет", "етикета") + " · " + plural(p, "лист", "листа") + " A4" : "Няма избрани маси"; }
  function syncPrint() {
    const n = selected().length, b = A.app!.querySelector("[data-printlbl]"); if (b) b.textContent = n ? "Печат · " + plural(n, "етикет", "етикета") : "Печат";
    const pb = A.app!.querySelector<HTMLButtonElement>("[data-print]"); if (pb) pb.disabled = !n || !T || !T.length;
  }

  function draw() {
    if (!T) { root.innerHTML = loadErr ? failHTML(loadErr, "Не успяхме да заредим масите и кодовете. Отпечатаните етикети продължават да работят.") : skel(4, "Зареждаме масите …"); syncPrint(); return; }
    if (!T.length || !cur) { root.innerHTML = '<div class="sa-card">' + empty({ icon: "qr-code", title: "Още няма маси.", text: "Добавете масите в „Залата и масите“. Всяка нова маса получава свой код тук.", action: '<a class="pill pill-red pill-lg" href="' + aurl.section("hall") + '">' + ic("chair", 22) + "Към залата и масите</a>" }) + "</div>"; syncPrint(); return; }
    const c = cur, q = qrOf(c), sl = selected(), pg = pagesOf(sl);
    root.innerHTML = (offlineNote ? offline("Етикетите се рисуват и печатат и без връзка. Нов код се записва, щом връзката се върне.") + '<div style="height:16px"></div>' : "") +
      '<div class="qr-top">' +
        '<section class="qr-prev" data-edit-id="admin.qr.preview" aria-labelledby="qr-ph"><h2 class="vh" id="qr-ph">Преглед на етикета</h2>' +
          '<div class="qr-pick"><label class="vh" for="qr-t">Маса</label><select class="input" id="qr-t" data-pick>' + T.map((t) => '<option value="' + t.id + '"' + (t.id === c.id ? " selected" : "") + ">Маса " + t.n + " · " + ZN[t.zone] + "</option>").join("") + "</select>" +
            '<button class="pill pill-line" type="button" data-step="-1">' + ic("caret-left", 20) + 'Предишна</button><button class="pill pill-line" type="button" data-step="1">Следваща' + ic("caret-right", 20) + "</button></div>" +
          '<div class="qr-stage"><div class="qrl" data-label>' + labelSVG(c) + "</div></div>" +
          '<div class="qr-url">' + ic("globe", 20) + "<code data-url>" + esc(url(c)).replace("/masa/", "<wbr>/masa/") + '</code><button class="pill pill-soft" type="button" data-copy>' + ic("copy", 20) + "Копирай</button></div>" +
          '<p class="qr-ok">' + ic("shield-check", 20) + "<span>Чете се и с надраскан или леко скъсан етикет.</span></p>" +
          '<div class="qr-acts"><a class="pill pill-line" href="' + aurl.preview("m=masa&p=welcome&d=phone") + '">' + ic("arrow-up-right", 20) + 'Как го вижда гостът (пример)</a><button class="pill pill-line" type="button" data-svg>' + ic("export", 20) + 'Изтегли SVG</button><button class="pill pill-line" type="button" data-regen="' + c.id + '">' + ic("arrow-clockwise", 20) + "Нов код</button></div>" +
          '<details class="qr-det"><summary>' + ic("caret-down", 20) + "Технически данни</summary><p>Версия " + q.version + ", " + q.size + " × " + q.size + " модула, корекция на грешки Q (до 25%), маска " + q.mask + ", поле 4 модула. Кодът е случаен, 8 знака.</p></details>" +
          '<p class="qr-note">' + ic("info", 20) + "<span>Логото: " + missing("ново лого") + ". Дотогава етикетът е с текстовия знак „Siracusa“. Масите са условни: " + missing("истински маси и план") + ". Домейнът на етикета: " + esc(site.replace(/^https?:\/\//, "")) + ".</span></p>" +
        "</section>" +
        '<section aria-labelledby="qr-lh" data-edit-id="admin.qr.list">' +
          '<div class="qr-bar"><h2 class="vh" id="qr-lh">Маси за печат</h2><span class="grow" style="font-weight:800" aria-live="polite" data-cnt>' + selCount() + "</span>" +
            '<button class="pill pill-soft" type="button" data-all>' + ic("check", 20) + 'Всички</button><button class="pill pill-soft" type="button" data-none>' + ic("x", 20) + "Нито една</button></div>" +
          '<div class="qr-list">' + ["salon", "garden"].map((z) => {
            const L = T!.filter((t) => t.zone === z); if (!L.length) return "";
            return '<div class="qr-zone"><header><h3>' + ic(z === "salon" ? "chair" : "tree", 20) + ZN[z] + "</h3><small>" + plural(L.length, "маса", "маси") + "</small>" +
              '<button class="pill pill-soft" type="button" data-zsel="' + z + '">Избери ' + (z === "salon" ? "салона" : "градината") + "</button></header>" +
              L.map((t) => '<div class="qr-row"' + (t.id === c.id ? ' aria-current="true"' : "") + ">" +
                '<label class="sa-check"><input type="checkbox" data-sel="' + t.id + '"' + (sel[t.id] ? " checked" : "") + ' aria-label="Маса ' + t.n + ' за печат"><span class="bx">' + ic("check", 18) + "</span></label>" +
                '<button class="qr-show" type="button" data-show="' + t.id + '" aria-pressed="' + (t.id === c.id) + '"><span class="no" aria-hidden="true">' + t.n + '</span><span class="tx"><b>Маса ' + t.n + "</b><code>" + esc(t.url) + "</code>" + (fresh[t.id] ? '<span class="tag-new">Нов код: отпечатайте етикета</span>' : "") + "</span>" +
                '<span class="qr-go">' + ic(t.id === c.id ? "check" : "eye", 20) + '<span class="w">' + (t.id === c.id ? "На екрана" : "Покажи") + "</span></span></button></div>").join("") + "</div>";
          }).join("") + "</div>" +
        "</section>" +
      "</div>" +
      '<div class="sa-sh"><h2>Листове за печат</h2><p>A4, 8 етикета на лист (2 × 4, по 105 × 74 мм), с линии за рязане.</p></div>' +
      (sl.length ? '<div class="qr-sheets">' + pg.map((p, i) => '<div><div class="qr-a4" aria-hidden="true">' + [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
          const t = p[k];
          return t ? '<div class="cell"><b>' + t.n + "</b><i style=\"--qrm:url('data:image/svg+xml," + encodeURIComponent(miniQR(t)) + "') center/contain no-repeat\"></i></div>" : '<div class="cell vac"></div>';
        }).join("") + "</div>" +
        '<p class="qr-a4cap">Лист ' + (i + 1) + " от " + pg.length + " · маси " + p.map((t) => t.n).join(", ") + "</p></div>").join("") + "</div>"
        : '<div class="sa-card">' + empty({ icon: "qr-code", title: "Не сте избрали маси за печат.", text: "Отметнете масите в списъка или натиснете „Всички“." }) + "</div>");
    syncPrint();
  }

  /* ---------- the print: tokens only; the theme is light for the print ---------- */
  function buildPrint() {
    document.getElementById("qr-print")?.remove();
    const div = document.createElement("div"); div.id = "qr-print"; div.setAttribute("aria-hidden", "true");
    div.innerHTML = pagesOf(selected()).map((p) => '<div class="pg">' + p.map((t) => '<div class="qrl">' + labelSVG(t, { print: true }) + "</div>").join("") + "</div>").join("");
    document.body.appendChild(div);
  }
  let themeBefore: string | null = null;
  window.addEventListener("beforeprint", () => { buildPrint(); themeBefore = document.documentElement.getAttribute("data-theme"); document.documentElement.setAttribute("data-theme", "light"); });
  window.addEventListener("afterprint", () => { if (themeBefore) document.documentElement.setAttribute("data-theme", themeBefore); else document.documentElement.removeAttribute("data-theme"); });

  function setCur(id: string) {
    if (!T) return; cur = T.find((t) => t.id === id) || cur;
    try { history.replaceState(null, "", location.pathname + location.search + "#t=" + encodeURIComponent(cur!.id)); } catch { /* ignore */ }
    const y = sc.scrollTop; draw(); sc.scrollTop = y;
  }
  function regen(id: string) {
    const t = T && T.find((x) => x.id === id); if (!t) return;
    confirm({ title: "Нов код за маса " + t.n + "?", text: "Старият етикет на маса " + t.n + " спира да работи веднага: гостите ще видят „Този код вече не работи“ и ще повикат сервитьора. Отпечатайте новия етикет и го сменете на масата.", ok: "Смени кода", danger: true, icon: "arrow-clockwise" }, async () => {
      try {
        const nr = await hallApi.qrRenew(id);
        T = T!.map((x) => (x.id === id ? nr : x)); if (cur && cur.id === id) cur = nr; fresh[id] = true;
        const y = sc.scrollTop; draw(); sc.scrollTop = y;
        toast("Нов код за маса " + t.n + ". Старият етикет вече не работи.");
      } catch (e) { toast(errText(e)); }
    });
  }
  function resolve(v: string, el: Element) { const p = document.createElement("span"); p.style.color = "var(" + v + ")"; el.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c; }
  function download(name: string, text: string, type: string) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  document.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.matches("[data-pick]")) { setCur(t.value); return; }
    if (t.matches("[data-sel]")) { sel[t.dataset.sel!] = t.checked; const y = sc.scrollTop; draw(); sc.scrollTop = y; root.querySelector<HTMLElement>('[data-sel="' + t.dataset.sel + '"]')?.focus({ preventScroll: true }); }
  });
  document.addEventListener("click", (e) => {
    const el = e.target as Element; let t: HTMLElement | null;
    if (el.closest(".sa-check")) return;
    if (el.closest("[data-print]")) { if (!selected().length) return; buildPrint(); window.print(); return; }
    if (!T || !cur || !root.contains(el)) return;
    if ((t = el.closest<HTMLElement>("[data-show]"))) {
      setCur(t.dataset.show!);
      /* on the phone the preview is above the list: show it */
      const pv = root.querySelector<HTMLElement>(".qr-stage"), r = pv && pv.getBoundingClientRect();
      if (r && (r.bottom < 80 || r.top > sc.clientHeight)) pv!.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
      return;
    }
    if ((t = el.closest<HTMLElement>("[data-step]"))) { const i = T.indexOf(cur) + +t.dataset.step!; setCur(T[(i + T.length) % T.length].id); return; }
    if ((t = el.closest<HTMLElement>("[data-regen]"))) { regen(t.dataset.regen!); return; }
    if (el.closest("[data-all]") || el.closest("[data-none]")) { const on = !!el.closest("[data-all]"); T.forEach((x) => { sel[x.id] = on; }); draw(); return; }
    if ((t = el.closest<HTMLElement>("[data-zsel]"))) { const z = t.dataset.zsel; T.forEach((x) => { sel[x.id] = x.zone === z; }); draw(); toast("Избрани: " + (z === "salon" ? "салонът" : "градината")); return; }
    if (el.closest("[data-copy]")) { const u = url(cur); (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject(new Error("no clipboard"))).then(() => toast("Адресът е копиран"), () => toast("Копирайте адреса ръчно: " + u)); return; }
    if (el.closest("[data-svg]")) {
      /* the values of the tokens are read from the label on the page: the file carries the same colours */
      const lab = root.querySelector("[data-label]")!;
      const svg = labelSVG(cur, { inline: true, bg: resolve("--lab-bg", lab), ink: resolve("--lab-ink", lab), mute: resolve("--lab-mute", lab) });
      download("siracusa-masa-" + cur.n + ".svg", '<?xml version="1.0" encoding="UTF-8"?>\n' + svg, "image/svg+xml"); toast("Изтеглен етикет: Маса " + cur.n); return;
    }
  });
  window.addEventListener("hashchange", () => { const h = tableOfHash(); if (h && T && cur && h !== cur.id) setCur(h); });

  draw();
  await load();
  draw();
}
