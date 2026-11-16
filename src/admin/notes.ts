/* /admin/notes/: "Бележки (молив)" and "Моите препоръки" (design/pages-admin/notes.html, version 4, 1:1; decisions 15.11.2026).
   - The roles with "Бележки" see every note and its course: tabs by status with a count (нова -> одобрена -> в изпълнение ->
     за преглед -> публикувана, or отхвърлена with a reason), filters by source (a role or "Клиент от сайта") and by module,
     search (Cyrillic or Latin). Only the main admin acts (the server checks it too); the others read.
   - "Одобри и изпълни": the run of Claude is stage E. In the code the button approves, the note goes to "Одобрени" and the
     next Claude session takes it (GET /api/admin/notes?status=approved or NOTES.json); no simulated "Claude работи".
   - The roles without "Бележки" see "Моите препоръки": their own, read-only, with the status and "Нов статус"; opening it
     calls notesSeen() and resets the badge (in the bar and on the pencil). Waiter, kitchen and driver get it full screen,
     without the bar of the admin, with "Към приложението" (decision 15.11.2026 "Вход според ролята").
   - Real time: note.created / note.status redraw the list (the badges follow in a.ts).
   States: loading (skeleton), empty, error, no connection; no rights is drawn by A.mount. */
import "sc-icons:export,play,x,check,eye,trash,hourglass,check-circle,sparkle,globe,user,squares-four,clock,info,lock,magnifying-glass,pencil-simple,arrow-counter-clockwise,caret-left,sign-out,warning-circle";
import { api } from "../client/api.ts";
import { adminApi, ApiError, type Me } from "../client/api-admin.ts";
import type { FeedbackNote, NoteStatus } from "../client/api-types.ts";
import { A, mount, session, can, isMainAdmin, mountPen, bootFail, toast, sheet, confirm, setBadge, loadSummary, skel, failHTML, offline, empty, norm, esc, ic, plural, MODULES, SEC, APPS, roleName, nameRole, initials } from "./a.ts";
import { aurl } from "./routes.ts";
import { ago } from "./when.ts";
import { STS, statusName } from "./notes-names.ts";

const STEP: Record<string, number> = { new: 0, approved: 1, doing: 2, review: 3, published: 4 };
const ICO: Record<string, string> = { new: "sparkle", approved: "check", doing: "hourglass", review: "eye", published: "check-circle", rejected: "x" };
const modName = (m: string) => { const x = MODULES.find((y) => y.id === m); return x ? x.n : m === "servitor" ? "Сервитьор" : m === "kuhnya" ? "Кухня" : m === "shofyor" ? "Шофьор" : m; };

/* the name of a screen by its address (the reverse of the routes; only for reading, never for links) */
const SITE: Record<string, string> = {
  "": "Начало", menu: "Меню", "obedno-menu": "Обедно меню", kolichka: "Количка", porachka: "Поръчка", "obedna-porachka-za-ofisa": "Обедна поръчка за офиса",
  rezervatsia: "Резервация", sabitia: "Събития", praznik: "Празник", oferti: "Оферти", vhod: "Вход", profil: "Профил", dostavka: "Доставка",
  "vzemi-ot-myasto": "Вземане от място", "furna-bertha": "Фурната Bertha", "za-nas": "За нас", galeria: "Галерия", kontakti: "Контакти", alergeni: "Алергени",
  poveritelnost: "Поверителност", biskvitki: "Бисквитки", "obshti-uslovia": "Общи условия", masa: "QR маса", servitor: "Сервитьор", kuhnya: "Кухня", shofyor: "Шофьор",
};
export function pageName(url: string): string {
  const p = String(url || "").split("#")[0].split("?")[0].replace(/index\.html$/, ""), seg = p.split("/").filter(Boolean);
  if (seg[0] === "admin") { if (!seg[1]) return "Табло"; if (seg[1] === "vhod") return "Вход"; if (seg[1] === "preview") return "Модулите на живо"; return SEC[seg[1]] ? SEC[seg[1]].n : seg[1]; }
  if (seg[0] === "menu" && seg.length === 2) return "Категория";
  if (seg[0] === "menu" && seg.length >= 3) return "Ястие";
  if (seg[0] === "sabitia" && seg.length >= 2) return "Събитие";
  return SITE[seg[0] || ""] || p || "/";
}
/** the source: {key: role | "client", label} */
export function sourceOf(n: FeedbackNote): { key: string; label: string } {
  const s = n.source;
  if (s && s.type === "client") return { key: "client", label: "Клиент от сайта" };
  if (s && s.type === "staff") return { key: s.role, label: nameRole(n.author || roleName(s.role), s.role) };
  return { key: "admin", label: n.author || "Главен админ" };
}

/* ---------- the hash (#s=review&m=site&src=client) ---------- */
function readHash(): Record<string, string> { const o: Record<string, string> = {}; location.hash.slice(1).split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return o; }
function writeHash(o: Record<string, string>) {
  const h = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
  try { history.replaceState(history.state, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ }
}
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const toLogin = () => location.replace(aurl.login(aurl.here()));

export async function initNotes(): Promise<void> {
  let me: Me | null = null;
  try { me = await session(); } catch (e) { bootFail(e); return; }
  if (!me) { toLogin(); return; }
  const STAFF = APPS.includes(me.user.role);
  const FULL = !STAFF && can("notes"), MAIN = isMainAdmin();
  const SUB_FULL = "Бележки и препоръки от молива и от сайта. Главният админ ги одобрява, пуска изпълнението, проверява преди / след и чак тогава публикува. Нищо не отива направо на живия сайт.";
  const SUB_MINE = "Препоръките, които сте пратили с молива, и докъде са стигнали. Само за четене: главният админ ги одобрява.";
  let body: HTMLElement | null;
  if (STAFF) body = staffShell(me, SUB_MINE);
  else body = await mount(FULL
    ? { section: "notes", title: "Бележки", eyebrow: "Работа по сайта", sub: esc(SUB_FULL), actions: '<button class="pill pill-line" type="button" data-dl>' + ic("export", 20) + "Изтегли NOTES.json</button>" }
    : { section: "notes", anyRole: true, title: "Моите препоръки", barTitle: "Моите препоръки", docTitle: "Моите препоръки", eyebrow: "Работа по сайта", sub: esc(SUB_MINE) });
  if (!body) return;
  const root = body;
  /* the preview of a note: only for the roles that can open "Модулите на живо" */
  const PREVIEW = can("site");

  let notes: FeedbackNote[] = [], loaded = false, fail: unknown = null;
  const changed = new Set<string>();
  const h0 = readHash();
  const f = { s: (STS.some((x) => x[0] === h0.s) ? h0.s : "") as string, m: h0.m || "", src: h0.src || "", q: "" };

  /* ---------- the frame of the page ---------- */
  const how = FULL ? '<details class="nt-how sa-rise" data-edit-id="admin.notes.how"><summary><span>' + ic("info", 20) + "Как работи?</span><small>Как бележките стигат до Claude</small></summary><ol>" +
    "<li><span>Всеки пише с молива (в админа и в прегледа на живо); гостите пишат с „Предложи подобрение“ на сайта.</span></li>" +
    "<li><span>Главният админ одобрява. „Одобри и изпълни“ я праща към следващата сесия на Claude; автоматичното пускане е в етап E.</span></li>" +
    "<li><span>Следващата сесия чете одобрените: <code>GET /api/admin/notes?status=approved</code> или <code>docs/NOTES.json</code> („Изтегли NOTES.json“). После „За преглед“ с преди / след и „Публикувай“ от главния админ.</span></li></ol></details>" : "";
  root.innerHTML = how +
    (FULL && !MAIN ? '<div class="nt-ro">' + ic("lock", 22) + "<span>Само главният админ одобрява, пуска изпълнение и публикува. Вие виждате всички бележки и техния ход.</span></div>" : "") +
    '<div data-off></div>' +
    '<div class="nt-bar"><div class="sa-tabs" role="tablist" aria-label="Статус" data-tabs></div>' +
    (FULL ? '<div class="flt"><div><label class="vh" for="nt-src">Източник</label><select class="input" id="nt-src" data-src></select></div><div><label class="vh" for="nt-m">Модул</label><select class="input" id="nt-m" data-mod></select></div>' +
      '<div class="sa-field-s"><label class="vh" for="nt-q">Търси в бележките</label>' + ic("magnifying-glass", 20) + '<input class="input" id="nt-q" type="search" placeholder="Търси в бележките" autocomplete="off"></div></div>' : "") + "</div>" +
    '<div data-list id="nt-list" role="tabpanel" aria-live="polite"></div>';
  const tabs = root.querySelector<HTMLElement>("[data-tabs]")!, list = root.querySelector<HTMLElement>("[data-list]")!, offBox = root.querySelector<HTMLElement>("[data-off]")!;
  const msel = root.querySelector<HTMLSelectElement>("[data-mod]"), ssel = root.querySelector<HTMLSelectElement>("[data-src]"), q = root.querySelector<HTMLInputElement>("#nt-q");

  const all = () => notes;
  const cnt = (s: string) => all().filter((n) => n.status === s).length;
  function firstTab(): string {
    if (f.s) return f.s;
    if (!FULL) { const hit = STS.find((x) => all().some((n) => n.status === x[0])); return hit ? hit[0] : "new"; }
    return MAIN && cnt("review") && !cnt("new") ? "review" : "new";
  }

  /* ---------- drawing ---------- */
  function drawTabs() {
    tabs.innerHTML = STS.map((s) => '<button type="button" role="tab" data-tab="' + s[0] + '" aria-selected="' + (f.s === s[0]) + '" tabindex="' + (f.s === s[0] ? 0 : -1) + '" aria-controls="nt-list">' + s[1] + '<span class="c">' + (loaded ? cnt(s[0]) : "") + "</span></button>").join("");
  }
  function drawFilters() {
    if (!FULL || !msel || !ssel) return;
    const mods: Record<string, number> = {}, srcs: Record<string, { n: number; label: string }> = {};
    all().forEach((n) => { mods[n.module] = (mods[n.module] || 0) + 1; const so = sourceOf(n); srcs[so.key] = srcs[so.key] || { n: 0, label: so.key === "client" ? "Клиент от сайта" : roleName(so.key) }; srcs[so.key].n++; });
    msel.innerHTML = '<option value="">Всички модули</option>' + Object.keys(mods).map((k) => '<option value="' + esc(k) + '"' + (f.m === k ? " selected" : "") + ">" + esc(modName(k)) + " (" + mods[k] + ")</option>").join("");
    ssel.innerHTML = '<option value="">Всички източници</option>' + Object.keys(srcs).map((k) => '<option value="' + esc(k) + '"' + (f.src === k ? " selected" : "") + ">" + esc(srcs[k].label) + " (" + srcs[k].n + ")</option>").join("");
  }
  function steps(n: FeedbackNote) {
    const k = STEP[n.status], rej = n.status === "rejected";
    return '<div class="nt-steps' + (rej ? " rej" : "") + '" role="img" aria-label="' + (rej ? "Отхвърлена" : "Стъпка " + (k + 1) + " от 5: " + statusName(n.status)) + '">' + [0, 1, 2, 3, 4].map((i) => '<i class="' + (k != null && i <= k ? "on" : "") + '"></i>').join("") + "</div>";
  }
  function acts(n: FeedbackNote) {
    const show = PREVIEW ? '<a class="pill pill-line" href="' + aurl.preview("n=" + encodeURIComponent(n.id)) + '">' + ic("eye", 18) + (n.status === "review" || n.status === "published" ? "Виж в прегледа" : "Покажи на страницата") + "</a>" : "";
    if (!MAIN) return show;
    const a = ({
      new: '<button class="pill pill-ink" type="button" data-act="run">' + ic("play", 18) + 'Одобри и изпълни</button><button class="pill pill-soft" type="button" data-act="approve">' + ic("check", 18) + 'Одобри</button><button class="pill pill-line" type="button" data-act="reject">' + ic("x", 18) + "Отхвърли</button>",
      approved: '<button class="pill pill-soft" type="button" data-act="back">' + ic("arrow-counter-clockwise", 18) + "Върни в нови</button>",
      review: '<button class="pill pill-red" type="button" data-act="publish">' + ic("check", 18) + 'Публикувай</button><button class="pill pill-soft" type="button" data-act="fix">' + ic("arrow-counter-clockwise", 18) + "Върни за поправка</button>",
      rejected: '<button class="pill pill-soft" type="button" data-act="back">' + ic("arrow-counter-clockwise", 18) + "Върни в нови</button>",
    } as Record<string, string>)[n.status] || "";
    return a + show + '<button class="pill pill-soft del" type="button" data-act="del">' + ic("trash", 18) + "Изтрий</button>";
  }
  function tech(n: FeedbackNote) {
    const hist = (n.history || []).slice().reverse();
    return '<details class="nt-tech"><summary>' + ic("info", 18) + "Технически данни</summary><dl>" +
      "<dt>Адрес</dt><dd>" + esc(n.url) + "</dd>" +
      "<dt>CSS селектор</dt><dd><code>" + esc(n.selector || "без посочено място") + "</code></dd>" +
      (n.editId ? "<dt>data-edit-id</dt><dd><code>" + esc(n.editId) + "</code></dd>" : "") +
      (hist.length ? "<dt>История</dt><dd><ol class=\"nt-hist\">" + hist.map((x) => "<li><b>" + esc(statusName(x.status)) + "</b> · " + esc(x.who) + " · " + esc(ago(x.at)) + "</li>").join("") + "</ol></dd>" : "") +
      "</dl></details>";
  }
  function card(n: FeedbackNote) {
    const so = sourceOf(n);
    let extra = "";
    if (n.status === "doing") extra = (n.fix ? '<div class="nt-why"><b>Да се поправи</b>' + esc(n.fix) + "</div>" : "") + '<p class="muted nt-p">Следващата сесия на Claude работи по бележката. После тя идва тук „За преглед“.</p>';
    else if ((n.status === "review" || n.status === "published") && n.change) extra = '<p class="nt-p">' + esc(n.change.summary) + '</p><div class="nt-diff"><div><small>Преди</small>' + esc(n.change.before || "") + '</div><div class="after"><small>След</small>' + esc(n.change.after || "") + "</div></div>" +
      (n.status === "published" ? '<p class="muted nt-p">Публикувана ' + esc(ago(n.updatedAt)) + ".</p>" : '<p class="muted nt-p">Проверете в прегледа на същия адрес и размер; на живия сайт отива само след „Публикувай“.</p>');
    else if (n.status === "rejected" && n.reason) extra = '<div class="nt-why"><b>Причина</b>' + esc(n.reason) + "</div>";
    else if (n.status === "approved") extra = '<p class="muted nt-p">Чака изпълнение: следващата сесия на Claude я поема (влиза в NOTES.json). Автоматичното пускане е в етап E.</p>';
    const et = n.elementText || "";
    return '<article class="nt" data-id="' + esc(n.id) + '" data-edit-id="admin.notes.card">' +
      '<div class="nt-top"><span class="sa-tag st-' + n.status + '">' + ic(ICO[n.status] || "info", 16) + esc(statusName(n.status)) + '</span><span class="sa-tag">' + esc(modName(n.module)) + "</span>" +
      (changed.has(n.id) ? '<span class="sa-tag ember">' + ic("sparkle", 16) + "Нов статус</span>" : "") + '<span class="when">' + esc(ago(n.createdAt)) + "</span></div>" +
      steps(n) + "<h3>" + esc(n.text) + "</h3>" +
      '<div class="where"><b>' + esc(modName(n.module) === pageName(n.url) ? modName(n.module) : modName(n.module) + " · " + pageName(n.url)) + "</b><span>" + esc(n.url) + "</span></div>" +
      (et ? "<blockquote><small>Текстът на елемента</small>„" + esc(et.length > 220 ? et.slice(0, 218) + " …" : et) + "“</blockquote>" : "") + extra + tech(n) +
      '<div class="nt-foot"><div class="by"><span>' + ic(so.key === "client" ? "globe" : "user", 18) + "<b>" + esc(so.label) + "</b></span>" +
      (n.viewport && n.viewport.w ? "<span>" + ic("squares-four", 18) + '<span class="num">' + n.viewport.w + " × " + n.viewport.h + "</span></span>" : "") +
      (n.updatedAt !== n.createdAt ? "<span>" + ic("clock", 18) + "Променена " + esc(ago(n.updatedAt)) + "</span>" : "") + "</div>" +
      '<div class="acts">' + acts(n) + "</div></div></article>";
  }
  const EMPTY: Record<string, [string, string, string]> = {
    new: ["sparkle", "Няма нови бележки.", "Включете молива и посочете елемент. Препоръките от сайта също идват тук."],
    approved: ["check", "Няма одобрени бележки.", "„Одобри“ на нова бележка я праща за следващата сесия (NOTES.json)."],
    doing: ["hourglass", "Няма бележки в изпълнение.", "Сесията на Claude, която поеме одобрена бележка, я слага тук."],
    review: ["eye", "Няма бележки за преглед.", "Изпълнените бележки чакат тук преглед и „Публикувай“."],
    published: ["check-circle", "Още няма публикувани.", "Публикуваните остават тук, за да се види какво е направено."],
    rejected: ["x", "Няма отхвърлени.", "Отхвърлената бележка пази причината."],
  };
  function draw() {
    if (!f.s) f.s = firstTab();
    drawTabs();
    offBox.innerHTML = fail && isOffline(fail) && loaded ? offline("Показваме последно заредените бележки. Проверете връзката и опитайте пак.") + '<div style="height:16px"></div>' : "";
    if (!loaded && !fail) { list.innerHTML = skel(3, "Зареждаме бележките …"); return; }
    if (!loaded && fail) { list.innerHTML = failHTML(fail, "Не успяхме да заредим бележките. Моливът записва и без това."); return; }
    const qq = norm(f.q);
    const l = all().filter((n) => n.status === f.s && (!f.m || n.module === f.m) && (!f.src || sourceOf(n).key === f.src) &&
      (!qq || norm(n.text + " " + (n.elementText || "") + " " + n.selector + " " + n.url + " " + pageName(n.url) + " " + modName(n.module)).includes(qq)));
    if (!l.length) {
      const mineEmpty = !FULL && !all().length;
      const e: [string, string, string] = f.q ? ["magnifying-glass", "Няма бележки с „" + f.q + "“.", "Опитайте с друга дума или махнете филтрите."]
        : mineEmpty ? ["pencil-simple", "Още нямате препоръки.", "Натиснете „Молив“ горе и посочете какво да подобрим."] : EMPTY[f.s] || EMPTY.new;
      list.innerHTML = '<div class="sa-card">' + empty({ icon: e[0], title: e[1], text: esc(e[2]) }) + "</div>";
      return;
    }
    list.innerHTML = '<div class="nt-list">' + l.map(card).join("") + "</div>";
  }
  function refresh() { drawFilters(); draw(); writeHash({ s: f.s === firstTabDefault ? "" : f.s, m: f.m, src: f.src }); }
  let firstTabDefault = "";

  async function load() {
    try { notes = FULL ? await adminApi.notes() : await adminApi.myNotes(); loaded = true; fail = null; }
    catch (e) { if (e instanceof ApiError && e.status === 401) { toLogin(); return; } fail = e; }
  }

  /* ---------- the events ---------- */
  tabs.addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLElement>("[data-tab]"); if (!b) return; f.s = b.dataset.tab!; refresh(); tabs.querySelector<HTMLElement>('[data-tab="' + f.s + '"]')?.focus(); });
  tabs.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return; e.preventDefault();
    const ks = STS.map((x) => x[0] as string), i = ks.indexOf(f.s); f.s = ks[(i + (e.key === "ArrowRight" ? 1 : ks.length - 1)) % ks.length]; refresh(); tabs.querySelector<HTMLElement>('[data-tab="' + f.s + '"]')?.focus();
  });
  msel?.addEventListener("change", () => { f.m = msel.value; refresh(); });
  ssel?.addEventListener("change", () => { f.src = ssel.value; refresh(); });
  q?.addEventListener("input", () => { f.q = q.value.trim(); draw(); });

  /* errors of an action: one calm toast; the note stays as it was */
  const failToast = (e: unknown) => toast(isOffline(e) ? "Няма връзка. Промяната не е изпратена; опитайте пак." : e instanceof ApiError ? e.message : "Не успяхме. Опитайте пак.");
  const put = (n: FeedbackNote) => { const i = notes.findIndex((x) => x.id === n.id); if (i > -1) notes[i] = n; else notes.unshift(n); };
  async function setStatus(n: FeedbackNote, status: NoteStatus, extra: { reason?: string; change?: FeedbackNote["change"]; fix?: string }, text: string, after?: () => void) {
    const prev = JSON.parse(JSON.stringify(n)) as FeedbackNote;
    try { put(await adminApi.setNoteStatus(n.id, status, extra)); } catch (e) { failToast(e); return; }
    if (after) after();
    refresh();
    toast(text, { undo: async () => {
      try { put(await adminApi.setNoteStatus(prev.id, prev.status, { reason: prev.reason, change: prev.change })); refresh(); toast("Върнато: „" + statusName(prev.status) + "“"); }
      catch (e) { failToast(e); }
    } });
  }
  function ask(title: string, label: string, need: boolean, ok: string, cb: (v: string) => void) {
    const s0 = sheet({ title, focus: "#nt-why", html: '<div class="field"><label for="nt-why">' + esc(label) + '</label><textarea class="input" id="nt-why" rows="3"' + (need ? " required" : "") + ' aria-describedby="nt-why-e"></textarea><p class="err" id="nt-why-e" hidden>Напишете причината.</p></div>',
      foot: '<button class="pill pill-line pill-lg" type="button" data-no>Откажи</button><button class="pill pill-ink pill-lg" type="button" data-ok>' + esc(ok) + "</button>" });
    s0.foot!.querySelector<HTMLButtonElement>("[data-no]")!.onclick = s0.close;
    s0.foot!.querySelector<HTMLButtonElement>("[data-ok]")!.onclick = () => {
      const ta = s0.body.querySelector<HTMLTextAreaElement>("#nt-why")!, v = ta.value.trim();
      if (need && !v) { s0.body.querySelector<HTMLElement>("#nt-why-e")!.hidden = false; ta.setAttribute("aria-invalid", "true"); ta.focus(); return; }
      s0.close(); cb(v);
    };
  }
  list.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-act]"); if (!b || !MAIN) return;
    const id = b.closest<HTMLElement>("[data-id]")!.dataset.id!, a = b.dataset.act, n = notes.find((x) => x.id === id); if (!n) return;
    const short = n.text.length > 80 ? n.text.slice(0, 78) + " …" : n.text;
    if (a === "del") {
      adminApi.deleteNote(id).then((r) => {
        notes = notes.filter((x) => x.id !== id); refresh();
        const saved = r.note || n;
        toast("Бележката е изтрита", { undo: () => { adminApi.restoreNote(saved).then((x) => { put(x); refresh(); toast("Бележката е върната"); }, failToast); } });
      }, failToast);
      return;
    }
    if (a === "approve") { setStatus(n, "approved", {}, "Одобрена. Влиза в NOTES.json за следващата сесия на Claude"); return; }
    if (a === "run") { setStatus(n, "approved", {}, "Одобрена за изпълнение: следващата сесия на Claude я поема", () => { f.s = "approved"; }); return; }
    if (a === "back") { setStatus(n, "new", {}, "Върната в нови"); return; }
    if (a === "reject") { ask("Отхвърли бележката", "Причина (вижда я и авторът)", true, "Отхвърли", (v) => setStatus(n, "rejected", { reason: v }, "Бележката е отхвърлена")); return; }
    if (a === "fix") { ask("Върни за поправка", "Какво да се поправи (по желание)", false, "Върни за поправка", (v) => setStatus(n, "doing", { fix: v }, "Върната за поправка: сесията на Claude я поправя", () => { f.s = "doing"; })); return; }
    if (a === "publish") {
      confirm({ title: "Публикувай промяната", text: "Промяната по „" + esc(short) + "“ е проверена в прегледа и може да отиде на живия сайт. Бележката става „Публикувана“.", ok: "Публикувай", danger: true, icon: "check" },
        () => setStatus(n, "published", {}, "Публикувана"));
    }
  });
  /* "Изтегли NOTES.json": only the approved ones (what the next session executes), oldest approval first */
  A.app?.addEventListener("click", (e) => {
    if (!(e.target as Element).closest("[data-dl]")) return;
    adminApi.exportNotes().then((data) => {
      if (!data.length) { toast("Няма одобрени бележки за изтегляне."); return; }
      const blob = new Blob([JSON.stringify({ status: "approved", exportedAt: new Date().toISOString(), notes: data }, null, 2)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "NOTES.json"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("Изтеглихме NOTES.json · " + plural(data.length, "одобрена бележка", "одобрени бележки"));
    }, failToast);
  });
  /* "Опитай пак" reloads the list in place */
  root.addEventListener("click", (e) => { if ((e.target as Element).closest('[data-sa="retry"]')) { e.stopPropagation(); fail = null; draw(); load().then(refresh); } }, true);

  const own = (x: FeedbackNote) => !!x.source && x.source.type === "staff" && x.source.user === me!.user.username;
  /* "Моите препоръки": which ones changed since the last look (the badge counted them), then the badge goes to 0 */
  async function markSeen() {
    /* every opening is "seen" on the server (the main admin's badge is new + "за преглед" anyway) */
    if (MAIN) { adminApi.notesSeen().catch(() => { /* later */ }); return; }
    try {
      const w = await adminApi.notesWaiting();
      notes.filter((x) => own(x) && x.status !== "new").sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, w.changedN).forEach((x) => changed.add(x.id));
      await adminApi.notesSeen();
      setBadge("notes", 0); if (A.pen) A.pen.setBadge(0);
      loadSummary(true).catch(() => { /* the badges stay as they are */ });
    } catch { /* the badge stays; the list is shown anyway */ }
  }

  /* ---------- real time: a new note or a new status redraws the list ---------- */
  let rt: ReturnType<typeof setTimeout> | undefined;
  const live = (d: unknown) => {
    const id = d && (d as { id?: string }).id;
    clearTimeout(rt);
    rt = setTimeout(async () => {
      const before = new Map(notes.map((x) => [x.id, x.status]));
      await load();
      const nn = id ? notes.find((x) => x.id === id) : undefined;
      if (!MAIN && nn && own(nn) && before.has(nn.id) && before.get(nn.id) !== nn.status) { changed.add(nn.id); adminApi.notesSeen().then(() => { setBadge("notes", 0); if (A.pen) A.pen.setBadge(0); }, () => { /* later */ }); }
      refresh();
    }, 250);
  };
  api.on("note.created", live); api.on("note.status", live);

  draw();
  await load();
  firstTabDefault = firstTab();
  await markSeen();
  refresh();
}

/* ---------- waiter, kitchen, driver: "Моите препоръки" full screen, without the bar of the admin ---------- */
function staffShell(me: Me, sub: string): HTMLElement {
  const role = me.user.role;
  document.title = "Моите препоръки | Siracusa · Админ";
  const app = document.createElement("div"); app.className = "sa-app nt-staffmode"; app.dataset.page = "notes";
  app.innerHTML = '<div class="sa-col"><header class="sa-top">' +
    '<a class="sa-tb nt-back" href="' + aurl.app(role) + '">' + ic("caret-left", 20) + '<span class="lg">Към приложението</span><span class="sm">Приложение</span></a>' +
    '<div class="sa-crumb"><small class="sa-only-td">Работа по сайта</small><b>Моите препоръки</b></div>' +
    '<button class="sa-tb" type="button" data-sa="pen" aria-pressed="false">' + ic("pencil-simple", 20) + "Молив</button>" +
    '<button class="sa-me" type="button" data-sa="profile"><span class="vh">Профил: </span><span class="sa-av" aria-hidden="true">' + esc(initials(me.user.name)) + '</span><span class="who"><b>' + esc(me.user.name) + "</b>" + (me.user.name === roleName(role) ? "" : '<small><span class="vh">, </span>' + esc(roleName(role)) + "</small>") + "</span></button>" +
    '<button class="sa-tb" type="button" data-sa="logout" aria-label="Изход">' + ic("sign-out", 20) + '<span class="lg" aria-hidden="true">Изход</span></button>' +
    '</header><div class="sa-scroller" data-sa-scroller><main id="main" class="sa-page" tabindex="-1">' +
    '<div class="sa-head" data-edit-id="admin.notes.head"><div><span class="sa-eye">' + ic("pencil-simple", 18) + 'Работа по сайта</span><h1 class="sa-h1">Моите препоръки</h1><p class="sa-sub">' + esc(sub) + "</p></div></div>" +
    '<div data-body></div><div class="sa-end"></div></main></div></div><div class="sa-ov"></div>';
  document.querySelector(".sa-boot")?.remove();
  document.body.appendChild(app);
  A.app = app; A.col = app.querySelector(".sa-col"); A.scroller = app.querySelector(".sa-scroller"); A.ov = app.querySelector(".sa-ov");
  mountPen("admin");
  return app.querySelector<HTMLElement>("[data-body]")!;
}
