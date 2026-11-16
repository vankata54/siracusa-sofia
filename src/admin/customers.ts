/* /admin/customers/: „Клиенти“ (design/pages-admin/customers.html, версия 4, 1:1; решение 16.11.2026 „основа на част 3“).
   - „Лични данни“ (сгъва се на телефон): телефонът е скрит; целият номер и имейлът само с „Покажи“ (customersAdminApi.contact,
     ред „customer.phone_view“ в дневника). Съгласията ги дава и оттегля само клиентът: тук са само етикети.
   - Табове Профили · Обратна връзка · Запитвания (ваучер, рожден ден) с брой нови. Профили: търсене (име или последни цифри,
     на сървъра), филтри с брой (с оферти, рожден ден, блокирани, нови за 30 дни), таблица -> карти на телефон.
   - Профил (лист): телефон и имейл скрити, поръчки и сума, резервации и неявявания, -10% с профил, печати [ЛИПСВА], съгласия,
     последните 4 поръчки, блокирането (решава се в „Резервации“), „Изтегли данните“ (JSON от ядрото, ред в дневника) и
     „Изтрий профила“ (GDPR): потвърждение, после 10 сек за „Отмени“; след прозореца изтриването е окончателно (ядрото).
   - „Изтегли списъка“: CSV със скритите телефони. Примерни данни няма: без клиенти е празното състояние.
   Адреси: #tab=feedback|requests, #f=mk|bd|bl|new. Състояния: зареждане, празно, грешка, без връзка, без права (A.mount). */
import "sc-icons:export,users,chat-circle-dots,gift,check,cake,lock,magnifying-glass,caret-right,caret-down,shield-check,check-circle,trash,phone,envelope-simple,arrow-counter-clockwise,info,x,calendar-check,warning-circle";
import { api } from "../client/api.ts";
import { customersAdminApi, ApiError, type CustomerRow, type CustomerDetail, type FeedbackRow, type FeedbackStatus } from "../client/api-admin-3.ts";
import { A, mount, can, toast, sheet, confirm, skel, failHTML, offline, empty, missing, dateLong, initials, esc, ic, fmt, plural } from "./a.ts";
import { aurl } from "./routes.ts";
import { ago, hmOf } from "./when.ts";

function readHash(): Record<string, string> { const o: Record<string, string> = {}; location.hash.slice(1).split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return o; }
function writeHash(o: Record<string, string>) {
  const h = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
  try { history.replaceState(history.state, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ }
}
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const toLogin = () => location.replace(aurl.login(aurl.here()));
/** "0888 12 34 56" */
export const fmtPhone = (p: string) => { const d = String(p || "").replace(/\D/g, ""); return d.length === 10 ? d.slice(0, 4) + " " + d.slice(4, 6) + " " + d.slice(6, 8) + " " + d.slice(8) : p; };
const dShort = (iso: string) => dateLong(new Date(iso));
function download(name: string, text: string, type = "application/json") {
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const OST: Record<string, string> = { accepted: "Приета", cooking: "Готви се", ready: "Готова", on_way: "На път", delivered: "Доставена", picked_up: "Взета", served: "Сервирана", cancelled: "Отказана" };
/* the filters: the hash keys of the prototype -> the core's filters */
const FLT: [string, string, "offers" | "birthday" | "blocked" | "new" | ""][] = [["", "Всички", ""], ["mk", "С оферти", "offers"], ["bd", "Рожден ден", "birthday"], ["bl", "Блокирани", "blocked"], ["new", "Нови за 30 дни", "new"]];
const COMPLAINT = "Нещо не беше наред";

export async function initCustomers(): Promise<void> {
  const body = await mount({ section: "customers", title: "Клиенти",
    sub: "Профилите на гостите, поръчките им, съгласията, блокираните номера и всичко, което пишат: обратна връзка и запитвания за ваучер или рожден ден.",
    actions: '<button class="pill pill-line" type="button" data-csv>' + ic("export", 20) + "Изтегли списъка</button>" });
  if (!body) return;
  const root = body; root.classList.add("cu-page");
  const h0 = readHash();
  let tab = /^(feedback|requests)$/.test(h0.tab || "") ? h0.tab : "profiles";
  let flt = FLT.some((f) => f[0] === h0.f) ? h0.f : "", q = "";
  let all: CustomerRow[] = [], found: CustomerRow[] | null = null, FB: FeedbackRow[] = [], IQ: FeedbackRow[] = [];
  let loaded = false, offlineNote = false, gdprState: boolean | null = null;
  const revealed: Record<string, { phone: string; email: string | null }> = {}, shown: Record<string, string> = {};

  /* ---------- data ---------- */
  async function load(): Promise<boolean> {
    try {
      const [l, f, i] = await Promise.all([customersAdminApi.list({}), customersAdminApi.messages("feedback"), customersAdminApi.messages("inquiries")]);
      all = l.rows; FB = f.rows; IQ = i.rows; loaded = true; offlineNote = false;
      if (q) await search();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { toLogin(); return false; }
      if (loaded && isOffline(e)) { offlineNote = true; draw(); return false; }
      root.innerHTML = failHTML(e, "Не успяхме да заредим клиентите. Профилите и съгласията са в безопасност; опитайте пак.");
      return false;
    }
  }
  async function search() {
    const t = q.trim(); if (!t) { found = null; return; }
    try { found = (await customersAdminApi.list({ q: t })).rows; } catch { found = all.filter((c) => c.name.toLowerCase().includes(t.toLowerCase())); }
  }
  const coreF = () => (FLT.find((f) => f[0] === flt) || FLT[0])[2];
  const pass = (c: CustomerRow, f: string) => !f || (f === "offers" && c.consent.marketing) || (f === "birthday" && c.consent.birthday) || (f === "blocked" && !!c.block) || (f === "new" && c.isNew);
  const list = () => (found || all).filter((c) => pass(c, coreF()));
  const phoneOf = (c: { id: string; phone: string }) => (revealed[c.id] ? fmtPhone(revealed[c.id].phone) : c.phone);
  const fbNew = () => FB.filter((f) => f.status === "new").length, iqNew = () => IQ.filter((f) => f.status === "new").length;

  /* ---------- drawing ---------- */
  function consentTags(c: CustomerRow) {
    return (c.deleting ? '<span class="sa-tag warn">' + ic("trash", 16) + "Изтрива се</span>" : "") +
      (c.consent.marketing ? '<span class="sa-tag tg-mk">' + ic("check", 16) + "Оферти</span>" : "") + (c.consent.birthday ? '<span class="sa-tag">' + ic("cake", 16) + "Рожден ден</span>" : "") +
      (c.block ? '<span class="sa-tag ' + (c.block === "blocked" ? "tg-bl" : "warn") + '">' + ic("lock", 16) + (c.block === "blocked" ? "Блокиран" : "Чака блокиране") + "</span>" : "") +
      (!c.consent.marketing && !c.consent.birthday && !c.block && !c.deleting ? '<span class="sa-tag">Без съгласия</span>' : "");
  }
  function profilesHTML() {
    const L = list();
    return '<div class="cu-flt"><div class="sa-field-s"><label class="vh" for="cu-q">Търси клиент</label>' + ic("magnifying-glass", 20) + '<input class="input" id="cu-q" type="search" placeholder="Име или последни цифри" autocomplete="off" value="' + esc(q) + '"></div>' +
      '<div class="chips" role="group" aria-label="Филтър">' + FLT.map((f) => '<button class="chip" type="button" data-f="' + f[0] + '" aria-pressed="' + (flt === f[0]) + '">' + f[1] + ' <span class="n">' + all.filter((c) => pass(c, f[2])).length + "</span></button>").join("") + "</div></div>" +
      (!L.length ? '<div class="sa-card">' + (!all.length ? empty({ icon: "users", title: "Още няма профили.", text: "Профил се прави с телефон и SMS код в сайта или на масата. Ще се появят тук." })
        : empty({ icon: "magnifying-glass", title: "Няма клиент с това търсене.", text: "Пробвайте с последните цифри на телефона или махнете филтъра." })) + "</div>" :
      '<div class="sa-tablewrap scroll"><table class="sa-table"><thead><tr><th>Клиент</th><th>Телефон</th><th class="r">Поръчки</th><th>Последна</th><th class="r">Общо</th><th>Съгласия и статус</th><th><span class="vh">Действия</span></th></tr></thead><tbody>' +
      L.map((c) => '<tr data-c="' + esc(c.id) + '"' + (c.deleting ? ' class="del"' : "") + '><td data-main><span class="cu-name"><span class="cu-av' + (c.block === "blocked" ? " bl" : "") + '" aria-hidden="true">' + esc(initials(c.name)) + "</span><span><b>" + esc(c.name) + "</b><small>профил от " + esc(dShort(c.since)) + '</small><small class="ph-only">' + esc(phoneOf(c)) + "</small></span></span></td>" +
        '<td class="ph dt-only" data-label="Телефон">' + esc(phoneOf(c)) + '</td><td class="r dt-only" data-label="Поръчки">' + c.orders + '</td><td class="ph-only" data-label="Поръчки">' + plural(c.orders, "поръчка", "поръчки") + " · " + fmt(c.sum) + "</td>" +
        '<td class="dt-only" data-label="Последна">' + (c.last ? esc(dShort(c.last)) : '<span class="muted">няма</span>') + '</td><td class="r price dt-only" data-label="Общо">' + fmt(c.sum) + "</td>" +
        '<td data-label="Съгласия"><span class="cu-tags">' + consentTags(c) + "</span></td>" +
        '<td class="cu-act" data-label="Профил"><button class="pill pill-line cu-open" type="button" data-open="' + esc(c.id) + '" aria-label="Отвори профила: ' + esc(c.name) + '"><span class="dt-l">Отвори</span><span class="ph-l">Отвори профила</span>' + ic("caret-right", 18) + "</button></td></tr>").join("") +
      "</tbody></table></div>");
  }
  function who(f: FeedbackRow) {
    const sh = shown[f.id];
    return '<div class="who"><b>' + esc(f.name) + "</b><span>" + (sh ? '<a href="' + (f.mode === "email" ? "mailto:" : "tel:") + esc(sh) + '">' + esc(f.mode === "email" ? sh : fmtPhone(sh)) + "</a>" : esc(f.contact)) + "</span></div>";
  }
  const contactBtn = (f: FeedbackRow) => '<button class="pill pill-line" type="button" data-contact="' + esc(f.id) + '">' + (f.mode === "email" ? ic("envelope-simple", 18) + "Пиши" : ic("phone", 18) + "Обади се") + "</button>";
  function iqHTML() {
    const ord: Record<string, number> = { new: 0, called: 1, done: 2 };
    const L = IQ.slice().sort((a, b) => (ord[a.status] - ord[b.status]) || (b.createdAt < a.createdAt ? -1 : 1));
    if (!L.length) return '<div class="sa-card">' + empty({ icon: "gift", title: "Няма запитвания.", text: "Запитванията за ваучер и рожден ден от сайта идват тук и в „Оферти и ваучери“." }) + "</div>";
    return (can("offers") ? '<p style="margin:0 0 12px"><a class="link" href="' + aurl.section("offers", "t=iq") + '">Същите са в „Оферти и ваучери“' + ic("caret-right", 18) + "</a></p>" : "") + '<div class="fb-list">' + L.map((f) => {
      const v = f.topic === "voucher";
      return '<article class="fb' + (f.status === "done" ? " done" : "") + '" data-edit-id="admin.customers.inquiry"><div class="tp"><span class="sa-tag ' + (f.status === "new" ? "new" : f.status === "called" ? "" : "ok") + '">' + (f.status === "new" ? "Ново" : f.status === "called" ? ic("phone", 16) + "Обадихме се" : ic("check", 16) + "Готово") + "</span>" +
        '<span class="sa-tag">' + ic(v ? "gift" : "cake", 16) + (v ? "Ваучер" : "Рожден ден") + '</span><span class="when">' + esc(ago(f.createdAt)) + "</span></div>" +
        '<h3 style="margin:0;font-size:18px">' + (v ? "Ваучер за подарък" : "Подарък за рожден ден") + "</h3>" + (f.message ? "<blockquote>" + esc(f.message) + "</blockquote>" : "") + who(f) +
        '<div class="acts">' + (f.status === "new" ? '<button class="pill pill-ink" type="button" data-st="called" data-id="' + esc(f.id) + '">' + ic("phone", 18) + "Обадихме се</button>" : "") +
        (f.status !== "done" ? '<button class="pill pill-line" type="button" data-st="done" data-id="' + esc(f.id) + '">' + ic("check", 18) + "Готово</button>" : '<button class="pill pill-line" type="button" data-st="new" data-id="' + esc(f.id) + '">' + ic("arrow-counter-clockwise", 18) + "Върни в нови</button>") +
        contactBtn(f) + "</div></article>";
    }).join("") + "</div>";
  }
  function fbHTML() {
    if (!FB.length) return '<div class="sa-card">' + empty({ icon: "chat-circle-dots", title: "Няма обратна връзка.", text: "Съобщенията от „Пишете ни“ идват тук. Стигат само до хората с „Клиенти“." }) + "</div>";
    const nw = FB.filter((f) => f.status === "new"), dn = FB.filter((f) => f.status !== "new");
    const card = (f: FeedbackRow) => '<article class="fb' + (f.status === "new" ? "" : " done") + '" data-edit-id="admin.customers.feedback"><div class="tp"><span class="sa-tag">' + ic("envelope-simple", 16) + "Пишете ни</span>" +
      (f.topic ? '<span class="sa-tag' + (f.topic === COMPLAINT ? " warn" : "") + '">' + (f.topic === COMPLAINT ? ic("warning-circle", 16) : "") + esc(f.topic) + "</span>" : "") +
      (f.status === "new" ? '<span class="sa-tag new">Ново</span>' : '<span class="sa-tag ok">' + ic("check", 16) + "Прегледано</span>") + '<span class="when">' + esc(ago(f.createdAt)) + "</span></div>" +
      "<blockquote>" + esc(f.message) + "</blockquote>" + who(f) +
      '<div class="acts">' + (f.status === "new" ? '<button class="pill pill-ink" type="button" data-st="done" data-id="' + esc(f.id) + '">' + ic("check", 18) + "Прегледано</button>" : '<button class="pill pill-line" type="button" data-st="new" data-id="' + esc(f.id) + '">' + ic("arrow-counter-clockwise", 18) + "Върни в нови</button>") + contactBtn(f) + "</div></article>";
    return (nw.length ? '<div class="fb-list">' + nw.map(card).join("") + "</div>" : '<div class="sa-card">' + empty({ icon: "check-circle", title: "Всичко е прегледано.", text: "Новите съобщения ще се появят тук." }) + "</div>") +
      (dn.length ? '<div class="sa-sh"><h2>Прегледани</h2><p>' + plural(dn.length, "съобщение", "съобщения") + '</p></div><div class="fb-list">' + dn.map(card).join("") + "</div>" : "");
  }
  const scroller = () => A.scroller || document.documentElement;
  function draw() {
    if (!loaded) return;
    const y = scroller().scrollTop, gd = root.querySelector<HTMLDetailsElement>(".cu-gdpr"); if (gd) gdprState = gd.open;
    const gOpen = gdprState == null ? (A.scroller ? A.scroller.clientWidth >= 900 : true) : gdprState;
    const nF = fbNew(), nR = iqNew();
    root.innerHTML = (offlineNote ? offline("Показваме последно заредените профили. Изтегляне и изтриване чакат връзката.") + '<div style="height:16px"></div>' : "") +
      '<details class="cu-gdpr" data-edit-id="admin.customers.gdpr"' + (gOpen ? " open" : "") + "><summary><h2>" + ic("shield-check", 22) + 'Лични данни<span class="more">' + ic("caret-down", 20) + "</span></h2></summary><ul>" +
        "<li>" + ic("lock", 18) + "<span>Телефонът е скрит; „Покажи“ се записва в дневника.</span></li>" +
        "<li>" + ic("check-circle", 18) + "<span>Съгласията дава и оттегля само клиентът. Офертите са неотметнати по подразбиране.</span></li>" +
        "<li>" + ic("trash", 18) + "<span>„Изтегли данните“ и „Изтрий“ по искане на клиента. Поръчките остават за касовия отчет, без лични данни.</span></li></ul></details>" +
      '<div class="cu-top"><div class="sa-tabs" role="tablist" aria-label="Изглед">' +
        '<button role="tab" type="button" data-tab="profiles" aria-selected="' + (tab === "profiles") + '" tabindex="' + (tab === "profiles" ? 0 : -1) + '">' + ic("users", 20) + 'Профили<span class="c">' + all.length + "</span></button>" +
        '<button role="tab" type="button" data-tab="feedback" aria-selected="' + (tab === "feedback") + '" tabindex="' + (tab === "feedback" ? 0 : -1) + '">' + ic("chat-circle-dots", 20) + "Обратна връзка" + (nF ? '<span class="c">' + nF + "</span>" : "") + "</button>" +
        '<button role="tab" type="button" data-tab="requests" aria-selected="' + (tab === "requests") + '" tabindex="' + (tab === "requests" ? 0 : -1) + '">' + ic("gift", 20) + "Запитвания" + (nR ? '<span class="c">' + nR + "</span>" : "") + "</button></div></div>" +
      '<div data-panel role="tabpanel">' + (tab === "profiles" ? profilesHTML() : tab === "feedback" ? fbHTML() : iqHTML()) + "</div>";
    scroller().scrollTop = y;
  }
  const hashSync = () => writeHash({ tab: tab === "profiles" ? "" : tab, f: flt });

  /* ---------- the profile ---------- */
  function profileHTML(c: CustomerDetail) {
    const rv = revealed[c.id];
    return '<div class="cp-page"><div class="cp-h"><span class="cu-av' + (c.block === "blocked" ? " bl" : "") + '" aria-hidden="true">' + esc(initials(c.name)) + "</span><div><b>" + esc(c.name) + '</b><span class="muted">профил от ' + esc(dateLong(new Date(c.since))) + "</span></div></div>" +
      '<div class="kvs">' +
        '<div class="kv"><b>Телефон</b><span data-phv>' + (rv ? '<a href="tel:' + esc(rv.phone) + '">' + esc(fmtPhone(rv.phone)) + "</a>" : esc(c.phone) + ' <button class="link" type="button" data-reveal>Покажи</button>') + "</span></div>" +
        '<div class="kv"><b>Имейл</b><span data-mlv>' + (rv ? (rv.email ? '<a href="mailto:' + esc(rv.email) + '">' + esc(rv.email) + "</a>" : "Не е добавен") : c.email ? esc(c.email) : "Не е добавен") + "</span></div>" +
        '<div class="kv"><b>Поръчки</b><span>' + plural(c.orders, "поръчка", "поръчки") + " · " + fmt(c.sum) + "</span></div>" +
        '<div class="kv"><b>Резервации</b><span>' + c.reservations + (c.noShows ? ", " + plural(c.noShows, "неявяване", "неявявания") : "") + "</span></div>" +
        '<div class="kv"><b>-10% с профил</b><span>' + (c.profileBonus === "used" ? "Използван" : c.profileBonus === "unused" ? "Чака следващата поръчка" : "Няма") + "</span></div>" +
        '<div class="kv"><b>Печати</b><span>' + missing("правило за печатите") + "</span></div>" +
      "</div>" +
      '<p class="cp-sec">Съгласия</p><div class="cu-tags" style="justify-content:flex-start">' + (c.consent.marketing ? '<span class="sa-tag tg-mk">' + ic("check", 16) + "Иска оферти и маркетингови предложения</span>" : '<span class="sa-tag">' + ic("x", 16) + "Без оферти</span>") +
        (c.consent.birthday ? '<span class="sa-tag">' + ic("cake", 16) + "Подарък за рожден ден</span>" : '<span class="sa-tag">' + ic("x", 16) + "Без рожден ден</span>") + "</div>" +
      '<p class="cp-note">' + ic("info", 18) + "<span>Съгласията се сменят само от клиента в профила му. Имейли за рожден ден само с отделното съгласие.</span></p>" +
      '<p class="cp-sec">Последни поръчки</p>' + (c.lastOrders.length ? c.lastOrders.map((o) => '<div class="cp-ord"><div class="l1"><span>№ ' + esc(o.no) + " · " + esc(OST[o.status] || o.status) + '</span><span class="price">' + fmt(o.total) + '</span></div><div class="l2">' + esc(dateLong(new Date(o.at))) + ", " + esc(hmOf(o.at)) + " · " + o.lines.map((l) => l.q + " × " + esc(l.name)).join(", ") + "</div></div>").join("") : '<p class="muted" style="margin:0">Още няма поръчки.</p>') +
      '<div class="cp-danger"><b>Блокиране за резервации</b><p class="muted" style="margin:0;font-size:15px">' + (c.block === "blocked" ? "Блокиран: не може да резервира онлайн." : c.block === "pending" ? "Чака решение след неявявания." : "Не е блокиран.") + " Решават главният админ, собственикът и управителят в „Резервации“.</p>" +
        (can("reservations") ? '<div class="row"><a class="pill pill-line" href="' + aurl.section("reservations", "blocks") + '">' + ic("calendar-check", 20) + "Към „Блокиране“</a></div>" : "") + "</div>" +
      '<div class="cp-danger"><b>По искане на клиента (GDPR)</b><div class="row"><button class="pill pill-line" type="button" data-export>' + ic("export", 20) + 'Изтегли данните</button><button class="pill pill-dline" type="button" data-del>' + ic("trash", 20) + "Изтрий профила</button></div></div></div>";
  }
  async function openC(id: string) {
    const row = all.find((c) => c.id === id);
    const s = sheet({ title: "Профил", html: skel(4, "Зареждаме профила …") });
    let c: CustomerDetail;
    try { c = await customersAdminApi.get(id); } catch (e) {
      if (e instanceof ApiError && e.status === 401) { toLogin(); return; }
      s.body.innerHTML = failHTML(e, e instanceof ApiError && e.status === 404 ? "Този профил вече го няма." : "Не успяхме да заредим профила. Опитайте пак.");
      const r = s.body.querySelector<HTMLButtonElement>('[data-sa="retry"]'); if (r) r.onclick = (ev) => { ev.stopPropagation(); s.close(); openC(id); };
      return;
    }
    s.body.innerHTML = profileHTML(c);
    s.body.addEventListener("click", async (e) => {
      const t = e.target as Element;
      if (t.closest("[data-reveal]")) {
        try { revealed[c.id] = await customersAdminApi.contact(c.id); } catch (er) { toast(isOffline(er) ? "Няма връзка. Опитайте пак." : er instanceof ApiError ? er.message : "Не успяхме. Опитайте пак."); return; }
        const rv = revealed[c.id];
        s.body.querySelector("[data-phv]")!.innerHTML = '<a href="tel:' + esc(rv.phone) + '">' + esc(fmtPhone(rv.phone)) + "</a>";
        s.body.querySelector("[data-mlv]")!.innerHTML = rv.email ? '<a href="mailto:' + esc(rv.email) + '">' + esc(rv.email) + "</a>" : "Не е добавен";
        s.body.querySelector<HTMLElement>("[data-phv] a")?.focus();
        draw(); return;
      }
      if (t.closest("[data-export]")) {
        try {
          const data = await customersAdminApi.export(c.id);
          download("siracusa-klient-" + c.id + ".json", JSON.stringify(data, null, 2));
          toast("Данните на " + c.name + " са изтеглени");
        } catch (er) { toast(isOffline(er) ? "Няма връзка. Изтеглянето чака връзката." : er instanceof ApiError ? er.message : "Не успяхме да изтеглим данните."); }
        return;
      }
      if (t.closest("[data-del]")) {
        confirm({ title: "Да изтрием профила на " + c.name + "?", text: "Изтриват се профилът, имейлът, съгласията, любимите и адресите. Поръчките остават за касовия отчет, но без име, телефон и адрес. Бонусът -10% не се дава отново на този номер. 10 секунди след „Изтрий“ можете да отмените.", ok: "Изтрий профила", danger: true, icon: "trash" }, () => { s.close(); remove(c.id, c.name, row); });
      }
    });
  }
  async function remove(id: string, name: string, row?: CustomerRow) {
    let until: number;
    try { until = (await customersAdminApi.remove(id)).until; } catch (e) {
      toast(isOffline(e) ? "Няма връзка. Профилът не е изтрит; опитайте пак." : e instanceof ApiError ? e.message : "Не успяхме да изтрием профила."); return;
    }
    const ms = Math.min(10_000, Math.max(2000, until - Date.now()));
    if (row) row.deleting = { until };
    draw();
    let undone = false;
    toast("Профилът на " + name + " се изтрива. Окончателно след 10 секунди.", { ms, undo: async () => {
      undone = true;
      try { await customersAdminApi.restore(id); if (row) row.deleting = null; draw(); toast("Профилът на " + name + " е върнат"); }
      catch (e) { toast(e instanceof ApiError && e.status === 410 ? "Профилът вече е изтрит." : isOffline(e) ? "Няма връзка. Профилът не е върнат." : "Не успяхме да върнем профила."); await load(); draw(); }
    } });
    setTimeout(async () => { if (undone) return; if (await load()) draw(); }, ms + 900);
  }

  /* ---------- events ---------- */
  root.addEventListener("click", async (e) => {
    const t = e.target as Element; let el: HTMLElement | null;
    if (t.closest('[data-sa="retry"]')) { e.stopPropagation(); root.innerHTML = skel(6, "Зареждаме клиентите …"); if (await load()) draw(); return; }
    if ((el = t.closest<HTMLElement>("[data-tab]"))) { tab = el.dataset.tab!; hashSync(); draw(); root.querySelector<HTMLElement>('[data-tab="' + tab + '"]')?.focus({ preventScroll: true }); return; }
    if ((el = t.closest<HTMLElement>(".cu-flt [data-f]"))) { flt = el.dataset.f || ""; hashSync(); draw(); root.querySelector<HTMLElement>('.cu-flt [data-f="' + flt + '"]')?.focus({ preventScroll: true }); return; }
    if ((el = t.closest<HTMLElement>("[data-open]"))) { openC(el.dataset.open!); return; }
    if ((el = t.closest<HTMLElement>("tr[data-c]")) && !t.closest("button, a")) { openC(el.dataset.c!); return; }
    if ((el = t.closest<HTMLElement>("[data-st]"))) { setStatus(el.dataset.id!, el.dataset.st as FeedbackStatus); return; }
    if ((el = t.closest<HTMLElement>("[data-contact]"))) { contact(el.dataset.contact!); return; }
  });
  async function setStatus(id: string, st: FeedbackStatus) {
    const f = FB.find((x) => x.id === id) || IQ.find((x) => x.id === id); if (!f) return;
    const was = f.status, inq = f.inquiry;
    try { Object.assign(f, await customersAdminApi.messageStatus(id, st)); } catch (e) { toast(isOffline(e) ? "Няма връзка. Статусът не е сменен." : e instanceof ApiError ? e.message : "Не успяхме. Опитайте пак."); return; }
    draw();
    const lab = inq ? ({ called: "Обадихме се", done: "Готово", new: "Върнато в нови" } as Record<string, string>)[st] + ": " + f.name : st === "done" ? "Отбелязано като прегледано" : "Върнато в нови";
    toast(lab, { undo: async () => { try { Object.assign(f, await customersAdminApi.messageStatus(id, was)); draw(); } catch { toast("Не успяхме да върнем статуса."); } } });
  }
  async function contact(id: string) {
    const f = FB.find((x) => x.id === id) || IQ.find((x) => x.id === id); if (!f) return;
    try { const r = await customersAdminApi.messageContact(id); shown[id] = r.contact; } catch (e) { toast(isOffline(e) ? "Няма връзка. Опитайте пак." : e instanceof ApiError ? e.message : "Не успяхме. Опитайте пак."); return; }
    draw();
    location.href = (f.mode === "email" ? "mailto:" : "tel:") + shown[id];
  }
  /* tabs: the arrows move the choice (tabindex only on the selected one) */
  root.addEventListener("keydown", (e) => {
    const b = (e.target as Element).closest<HTMLElement>(".cu-top [data-tab]"); if (!b || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return; e.preventDefault();
    const L = ["profiles", "feedback", "requests"]; tab = L[(L.indexOf(b.dataset.tab!) + (e.key === "ArrowRight" ? 1 : 2)) % 3]; hashSync(); draw(); root.querySelector<HTMLElement>('[data-tab="' + tab + '"]')?.focus();
  });
  let qT: ReturnType<typeof setTimeout> | undefined;
  root.addEventListener("input", (e) => {
    const i = e.target as HTMLInputElement; if (i.id !== "cu-q") return;
    q = i.value; clearTimeout(qT);
    qT = setTimeout(async () => {
      await search(); const pos = i.selectionStart; draw();
      const n = root.querySelector<HTMLInputElement>("#cu-q"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignore */ } }
    }, 220);
  });
  document.addEventListener("click", (e) => {
    if (!(e.target as Element).closest("[data-csv]") || !loaded) return;
    const L = list();
    const rows = [["Клиент", "Телефон (скрит)", "Профил от", "Поръчки", "Общо €", "Оферти", "Рожден ден", "Блокиран"]].concat(L.map((c) => [c.name, c.phone, c.since.slice(0, 10), String(c.orders), c.sum.toFixed(2).replace(".", ","), c.consent.marketing ? "да" : "не", c.consent.birthday ? "да" : "не", c.block === "blocked" ? "да" : c.block === "pending" ? "чака" : "не"]));
    download("siracusa-klienti.csv", "﻿" + rows.map((r) => r.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(";")).join("\n"), "text/csv");
    toast(L.length ? "Списъкът е изтеглен, телефоните са скрити" : "Списъкът е празен: изтеглена е само заглавната редица");
  });
  /* a new message from the site: the counts follow */
  api.on("feedback.created", async () => { try { const [f, i] = await Promise.all([customersAdminApi.messages("feedback"), customersAdminApi.messages("inquiries")]); FB = f.rows; IQ = i.rows; draw(); } catch { /* keep */ } });

  root.innerHTML = skel(6, "Зареждаме клиентите …");
  if (await load()) draw();
}
