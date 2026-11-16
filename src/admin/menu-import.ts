/* /admin/menu/vnos/: „Внос на меню“ (design/pages-admin/menu-import.html, версия 4; решение 15.11.2026 „Ново меню“).
   Стъпки „Качете файла · Проверете черновата · Публикувайте от „Меню““; истинско поле за файл (PDF или снимка до 20 MB, и с
   пускане); „Добави към менюто“ / „Замени цялото меню“.
   ОТКЛОНЕНИЕ от прототипа (по указание): автоматичното четене е етап E, затова тук НЯМА примерна чернова. Файлът се приема
   на това устройство (име, размер, вид) с честна бележка, а ястията се въвеждат в таблица за бързо въвеждане (име,
   категория, цена, грамаж по желание) -> „Сложи в черновата на менюто“ (menuApi.saveDraft) -> /admin/menu/#review=1. */
import "sc-icons:export,arrow-left,note,image,info,warning-circle,check,plus,trash,arrow-clockwise,fork-knife,x";
import { menuApi, ApiError, type Menu } from "../client/api-menu.ts";
import { mount, toast, skel, banner, offline as offlineHTML, esc, ic, plural } from "./a.ts";
import { aurl } from "./routes.ts";

const MAX = 20 * 1024 * 1024;
const ADDONS = "dobavki";
const kb = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1).replace(".", ",") + " MB" : n < 1024 ? "под 1 KB" : Math.round(n / 1024) + " KB");
const kind = (t: string) => (/pdf/.test(t) ? "PDF" : /png/.test(t) ? "Снимка PNG" : /webp/.test(t) ? "Снимка WebP" : "Снимка JPG");
function priceOk(p: string) { const v = String(p || "").replace(/\s/g, "").replace("€", "").replace(",", "."); return /^\d{1,3}(\.\d{1,2})?$/.test(v) && +v > 0; }
const priceNum = (p: string) => +String(p).replace(/\s/g, "").replace("€", "").replace(",", ".");
const tmpId = () => "new-" + Math.random().toString(36).slice(2, 10);
const isOfflineErr = (e: unknown) => e instanceof ApiError && e.code === "offline";

interface Row { k: number; n: string; cat: string; g: string; p: string }

export async function initMenuImport(): Promise<void> {
  const body0 = await mount({ section: "menu", title: "Внос на меню", docTitle: "Внос на меню", barTitle: "Внос на меню", crumb: "Меню", eyebrow: "Меню",
    sub: "Качете новото меню като PDF или снимка; ястията влизат в черновата и се публикуват от „Меню“. Четенето от Claude идва в етап E.",
    actions: '<a class="pill pill-line pill-lg" href="' + aurl.section("menu") + '">' + ic("arrow-left", 22) + "Към менюто</a>" });
  if (!body0) return;
  const body = body0;

  let M: Menu | null = null, ver = 0, loadErr: unknown = null, net = navigator.onLine !== false;
  let file: { name: string; size: number; type: string } | null = null, fileErr = "", mode: "add" | "replace" = "add";
  let rows: Row[] = [0, 1, 2].map((k) => ({ k, n: "", cat: "", g: "", p: "" })), nextK = 3;

  const cats = () => (M ? M.cats.filter((c) => c.id !== ADDONS) : []);
  const filled = (r: Row) => !!(r.n.trim() || r.p.trim() || r.g.trim());
  const activeCount = () => (M ? M.items.length : 0);
  const step = () => (file || rows.some(filled) ? 1 : 0);

  function stepper() {
    const t = ["Качете файла", "Проверете черновата", "Публикувайте от „Меню“"], k = step();
    return '<div class="stepper im-steps" style="--n:3" data-edit-id="admin.menuimport.steps"><div class="bar">' + t.map((_, i) => '<span class="' + (i <= k ? "on" : "") + '"></span>').join("") + '</div><div class="t"><span>Стъпка <b>' + (k + 1) + " от 3</b></span><span>" + t[k] + "</span></div></div>";
  }
  function upload() {
    return '<section class="im-drop" data-drop data-edit-id="admin.menuimport.upload"><div class="ill">' + ic("export", 40) + "</div><h2>Новото меню</h2><p>PDF или снимка (JPG, PNG, WebP), до 20 MB. Може и няколко снимки една след друга.</p>" +
      '<input class="vh im-in" id="im-f" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" aria-describedby="im-f-e"><label class="pill pill-ink pill-lg" for="im-f">' + ic("export", 22) + (file ? "Друг файл" : "Избери файл") + "</label>" +
      '<p class="err" id="im-f-e" role="alert" style="color:var(--danger); font-weight:700"' + (fileErr ? "" : " hidden") + ">" + esc(fileErr) + "</p></section>" +
      (file ? '<div class="im-ok" data-edit-id="admin.menuimport.file" role="status"><div class="im-file">' + ic(/pdf/.test(file.type) ? "note" : "image", 24) + "<span>" + esc(file.name) + "<small>" + kb(file.size) + " · " + kind(file.type) + " · приет на това устройство, не се изпраща никъде</small></span></div>" +
        '<p class="im-note">' + ic("info", 20) + "<span><b>Автоматичното четене на менюто идва в етап E.</b> Дотогава въведете ястията в „Меню“ или изпратете файла на главния админ. За бързо въвеждане препишете ястията в таблицата по-долу.</span></p>" +
        '<div class="acts"><a class="pill pill-line" href="' + aurl.section("menu") + '">' + ic("fork-knife", 20) + "Към „Меню“</a></div></div>" : "") +
      '<div class="im-mode"><span class="label" id="im-ml">Какво да направим с ястията от таблицата</span><div class="seg" role="group" aria-labelledby="im-ml"><button type="button" data-mode="add" aria-pressed="' + (mode === "add") + '">Добави към менюто</button><button type="button" data-mode="replace" aria-pressed="' + (mode === "replace") + '">Замени цялото меню</button></div>' +
      (mode === "replace" ? '<span class="im-warn">' + ic("warning-circle", 18) + "<span>Сегашните " + activeCount() + " ястия ще се махнат от сайта след „Публикувай“. Старите им адреси водят (301) към категорията.</span></span>" : '<span class="help" style="font-size:14px; color:var(--muted)">Новите ястия влизат в черновата до сегашните.</span>') + "</div>";
  }
  function rowHTML(r: Row, i: number) {
    const bad = filled(r) && (!priceOk(r.p) || r.n.trim().length < 2);
    return '<article class="im-r' + (bad && r.p.trim() ? " bad" : "") + '" data-k="' + r.k + '"><div class="im-top"><b>Ред ' + (i + 1) + '</b><span class="sp"></span>' +
      (rows.length > 1 ? '<button class="iconbtn" type="button" data-rm aria-label="Махни ред ' + (i + 1) + '">' + ic("trash", 20) + "</button>" : "") + "</div>" +
      '<div class="im-f"><div class="field"><label for="im-n' + r.k + '">Име</label><input class="input" id="im-n' + r.k + '" data-fld="n" value="' + esc(r.n) + '" autocomplete="off"></div>' +
        '<div class="field"><label for="im-c' + r.k + '">Категория</label><select class="input" id="im-c' + r.k + '" data-fld="cat">' + cats().map((c) => '<option value="' + esc(c.id) + '"' + (c.id === r.cat ? " selected" : "") + ">" + esc(c.n) + "</option>").join("") + "</select></div>" +
        '<div class="field"><label for="im-g' + r.k + '">Грамаж <span class="muted" style="font-weight:600">(по желание)</span></label><input class="input" id="im-g' + r.k + '" data-fld="g" value="' + esc(r.g) + '" placeholder="напр. 350 гр." autocomplete="off"></div>' +
        '<div class="field"><label for="im-p' + r.k + '">Цена</label><div class="im-eu"><input class="input" id="im-p' + r.k + '" data-fld="p" inputmode="decimal" value="' + esc(r.p) + '" placeholder="0,00" autocomplete="off"' + (bad && r.p.trim() && !priceOk(r.p) ? ' aria-invalid="true"' : "") + '><span class="u" aria-hidden="true">€</span></div></div></div></article>';
  }
  function counts() {
    const use = rows.filter(filled), noP = use.filter((r) => !priceOk(r.p)).length;
    return '<div class="im-k"><span class="lb">Попълнени редове</span><span class="v">' + use.length + '</span></div><div class="im-k"><span class="lb">Ще се внесат</span><span class="v">' + use.filter((r) => priceOk(r.p) && r.n.trim().length >= 2).length + "</span></div>" +
      '<div class="im-k"><span class="lb">Без цена</span><span class="v">' + noP + '</span></div><div class="im-k"><span class="lb">' + (mode === "replace" ? "Ще се махнат" : "Сегашни ястия") + '</span><span class="v">' + activeCount() + "</span></div>";
  }
  function table() {
    if (!cats().length) return '<div class="sa-sh"><h2>Ястията на ръка</h2></div>' + banner({ tone: "warn", icon: "info", title: "Менюто още няма категории", text: "Първо направете категориите в „Меню“ → „Категории“, после въведете ястията тук.", action: '<a class="pill pill-line" href="' + aurl.section("menu", "t=cats") + '">Към „Категории“</a>' });
    return '<div class="sa-sh" data-edit-id="admin.menuimport.manual"><h2>Ястията на ръка</h2><p>Препишете ги от файла: име, категория и цена; грамажът е по желание.</p></div>' +
      '<div class="im-sum" data-counts>' + counts() + "</div>" +
      '<p class="im-hint">Описанието, съставът, алергените и снимката се добавят после в листа на ястието в „Меню“. Нищо не отива в сайта преди „Публикувай“.</p>' +
      '<div class="im-rows" data-rows>' + rows.map(rowHTML).join("") + "</div>" +
      '<div class="im-more"><button class="pill pill-line" type="button" data-addrow>' + ic("plus", 20) + "Още ред</button></div>" +
      '<div class="im-bottom"><button class="pill pill-red pill-lg" type="button" data-put' + (net ? "" : " disabled") + ">" + ic("check", 22) + 'Сложи в черновата на менюто</button><p class="err" data-err role="alert" hidden></p></div>';
  }
  function draw(focusSel?: string) {
    if (!M) {
      body.innerHTML = loadErr ? (isOfflineErr(loadErr) ? offlineHTML("Черновата на менюто не се зареди. Проверете връзката и опитайте пак.") : banner({ tone: "danger", icon: "warning", title: "Черновата на менюто не се зареди", text: "Опитайте пак след малко.", action: '<button class="pill pill-line" type="button" data-retry>' + ic("arrow-clockwise", 20) + "Опитай пак</button>" })) : skel(4, "Зареждаме …");
      return;
    }
    body.innerHTML = (!net ? offlineHTML("Без връзка ястията не могат да влязат в черновата. Опитайте пак, щом интернетът се върне.") + '<div style="height:16px"></div>' : "") + stepper() + upload() + table();
    if (focusSel) { const f = body.querySelector<HTMLElement>(focusSel); if (f) f.focus({ preventScroll: true }); }
  }

  async function load() {
    loadErr = null;
    try { const d = await menuApi.draft(); M = d.menu; ver = d.version; }
    catch (e) { if (e instanceof ApiError && e.status === 401) { location.replace(aurl.login(aurl.here())); return; } loadErr = e; }
    const first = cats()[0]; rows.forEach((r) => { if (!r.cat && first) r.cat = first.id; });
  }

  function pickFile(f: File | null | undefined) {
    if (!f) return;
    if (!/^(application\/pdf|image\/(jpeg|png|webp))$/.test(f.type)) { fileErr = "„" + f.name + "“ не е PDF или снимка. Изберете PDF или снимка (JPG, PNG, WebP)."; draw("#im-f"); return; }
    if (f.size > MAX) { fileErr = "„" + f.name + "“ е " + kb(f.size) + ". Изберете файл до 20 MB или снимки на страниците една по една."; draw("#im-f"); return; }
    fileErr = ""; file = { name: f.name, size: f.size, type: f.type }; draw(".im-ok");
    const ok = body.querySelector<HTMLElement>(".im-ok"); if (ok) { ok.setAttribute("tabindex", "-1"); ok.focus({ preventScroll: true }); ok.scrollIntoView({ block: "nearest" }); }
  }
  const rowOf = (el: Element) => { const a = el.closest<HTMLElement>("[data-k]"); return a ? rows.find((r) => r.k === +a.dataset.k!) : undefined; };
  function updCounts() { const c = body.querySelector("[data-counts]"); if (c) c.innerHTML = counts(); const st = body.querySelector(".stepper"); if (st) st.outerHTML = stepper(); }

  body.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "im-f") { pickFile(t.files && t.files[0]); return; }
    if (t.matches("[data-fld]")) {
      const r = rowOf(t); if (!r) return; (r as unknown as Record<string, string>)[t.dataset.fld!] = t.value;
      if (t.dataset.fld === "p") { const art = t.closest(".im-r")!, ok = priceOk(t.value) || !t.value.trim(); art.classList.toggle("bad", !ok); if (ok) t.removeAttribute("aria-invalid"); else t.setAttribute("aria-invalid", "true"); }
      updCounts();
    }
  });
  body.addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.matches("[data-fld]")) { const r = rowOf(t); if (r) (r as unknown as Record<string, string>)[t.dataset.fld!] = t.value; updCounts(); } });
  body.addEventListener("click", (e) => {
    const tg = e.target as Element; let t: HTMLElement | null;
    if (tg.closest("[data-retry]")) { start(); return; }
    if ((t = tg.closest<HTMLElement>("[data-mode]"))) { mode = t.dataset.mode === "replace" ? "replace" : "add"; draw('[data-mode="' + mode + '"]'); return; }
    if (tg.closest("[data-addrow]")) { const k = nextK++; rows.push({ k, n: "", cat: (cats()[0] || { id: "" }).id, g: "", p: "" }); draw("#im-n" + k); return; }
    if ((t = tg.closest<HTMLElement>("[data-rm]"))) { const r = rowOf(t); if (!r) return; const i = rows.indexOf(r); rows.splice(i, 1); draw(); const n = body.querySelectorAll<HTMLElement>("[data-rm]")[Math.max(0, i - 1)] || body.querySelector<HTMLElement>("[data-addrow]"); if (n) n.focus({ preventScroll: true }); return; }
    if (tg.closest("[data-put]")) put();
  });
  const drop = () => body.querySelector<HTMLElement>("[data-drop]");
  body.addEventListener("dragover", (e) => { const d = drop(); if (d && d.contains(e.target as Node)) { e.preventDefault(); d.classList.add("over"); } });
  body.addEventListener("dragleave", (e) => { const d = drop(); if (d && !d.contains(e.relatedTarget as Node)) d.classList.remove("over"); });
  body.addEventListener("drop", (e) => { const d = drop(); if (d && d.contains(e.target as Node)) { e.preventDefault(); d.classList.remove("over"); pickFile(e.dataTransfer && e.dataTransfer.files[0]); } });
  window.addEventListener("offline", () => { net = false; if (M) draw(); });
  window.addEventListener("online", () => { net = true; if (M) draw(); });

  /* into the shared draft of the menu (the same as /admin/menu/); publishing is there, with the summary */
  let busy = false;
  async function put() {
    const er = body.querySelector<HTMLElement>("[data-err]")!, use = rows.filter(filled), bad = use.filter((r) => !priceOk(r.p) || r.n.trim().length < 2);
    const say = (t: string) => { er.hidden = false; er.textContent = t; };
    if (!use.length) { say("Няма редове за внос: попълнете поне един."); body.querySelector<HTMLElement>("#im-n" + rows[0].k)?.focus(); return; }
    if (bad.length) {
      say(plural(bad.length, "ред", "реда") + " без име или цена. Попълнете ги или махнете реда.");
      const b = bad[0], f = body.querySelector<HTMLElement>("#im-" + (b.n.trim().length < 2 ? "n" : "p") + b.k); if (f) f.focus(); return;
    }
    if (busy || !M) return; busy = true;
    const btn = body.querySelector<HTMLButtonElement>("[data-put]")!; btn.disabled = true;
    const apply = (m: Menu) => {
      const next: Menu = JSON.parse(JSON.stringify(m));
      if (mode === "replace") next.items = [];
      for (const r of use) {
        const c = next.cats.find((z) => z.id === r.cat) || next.cats[0];
        next.items.push({ id: tmpId(), n: r.n.replace(/\s+/g, " ").trim(), cat: c.id, course: c.course, comp: "", g: r.g.trim(), p: priceNum(r.p), t: [], al: [], noOnion: false, share: false });
      }
      return next;
    };
    try {
      try { await menuApi.saveDraft(apply(M), ver); }
      catch (e) {
        /* someone saved the draft meanwhile: the rows are added to the newest draft once */
        if (!(e instanceof ApiError && e.code === "conflict")) throw e;
        const d = await menuApi.draft(); M = d.menu; ver = d.version;
        await menuApi.saveDraft(apply(M), ver);
      }
      location.href = aurl.section("menu", "review=1");
    } catch (e) {
      busy = false; btn.disabled = !net;
      if (e instanceof ApiError && e.status === 401) { location.replace(aurl.login(aurl.here())); return; }
      if (isOfflineErr(e)) { net = false; draw(); toast("Няма връзка. Ястията не са в черновата; опитайте пак."); return; }
      say(e instanceof ApiError && e.fields ? (Object.values(e.fields)[0] || e.message) : e instanceof ApiError ? e.message : "Не успяхме. Опитайте пак.");
    }
  }

  async function start() { M = null; loadErr = null; draw(); await load(); draw(); }
  await start();
}
