/* /admin/audit/: "Дневник" (design/pages-admin/audit.html, 1:1): who, when and what, read-only.
   - The core keeps {at, actor, action, target, data} (src/core/audit.ts); this screen says it in plain words:
     staff.login -> "Вход", staff.login_failed -> "Грешен вход: потребител „x“", role.update -> "Права на „Управител“: + Отчети,
     - Персонал", note.status -> "Бележка: Одобрена · „…“", settings.update -> "„Натоварено“: включено, около 55 мин" ...;
     an unknown action: "Действие: <код>". The key of the core is shown only to the main admin.
   - Filters as in the prototype: search, who, period (Днес, 7 дни, 30 дни, Всичко), kinds; by days ("Днес · нд, 15 ноември"),
     the hour "19:42"; "Покажи още"; "Изтегли CSV". No sample entries in the code. */
import "sc-icons:clock,export,lock,magnifying-glass,funnel,x,sign-in,sign-out,warning,shield-check,users-three,fork-knife,bowl-food,receipt,seal-percent,pencil-simple,calendar-check,chair,sliders-horizontal,list-bullets";
import { api } from "../client/api.ts";
import { adminApi, ApiError } from "../client/api-admin.ts";
import type { AuditEntry, FeedbackNote } from "../client/api-types.ts";
import { A, mount, can, isMainAdmin, toast, skel, failHTML, offline, empty, missing, norm, esc, ic, plural, SEC, roleName, fmtYmd } from "./a.ts";
import { aurl } from "./routes.ts";
import { hmOf, ymdOf, dayDiff, dayTitle } from "./when.ts";
import { statusName } from "./notes-names.ts";

/* ---------- kinds by the key of the action ---------- */
export const G: [string, string, string][] = [["login", "Вход", "sign-in"], ["fail", "Грешен вход", "warning"], ["roles", "Роли", "shield-check"], ["staff", "Персонал", "users-three"], ["menu", "Меню", "fork-knife"], ["lunch", "Обедно", "bowl-food"], ["orders", "Поръчки", "receipt"], ["sales", "Продажби", "seal-percent"], ["notes", "Бележки", "pencil-simple"], ["res", "Резервации и клиенти", "calendar-check"], ["hall", "Залата и QR", "chair"], ["settings", "Настройки", "sliders-horizontal"], ["other", "Друго", "list-bullets"]];
export function group(a: string): string {
  a = String(a || "");
  if (a === "staff.login_failed") return "fail"; if (a === "staff.login" || a === "staff.logout") return "login"; if (/^role\./.test(a)) return "roles"; if (/^staff\./.test(a)) return "staff";
  if (/^menu\./.test(a)) return "menu"; if (/^lunch\./.test(a)) return "lunch"; if (/^(order|office)\./.test(a)) return "orders"; if (/^(offer|event|zone|code|voucher)\./.test(a)) return "sales";
  if (/^note\./.test(a)) return "notes"; if (/^(reservation|customer|feedback)\./.test(a)) return "res";
  if (/^(hall|qr)\./.test(a)) return "hall"; if (/^settings\./.test(a)) return "settings"; return "other";
}
const gOf = (id: string) => G.find((g) => g[0] === id) || G[G.length - 1];

/* ---------- the words ---------- */
const OST: Record<string, string> = { accepted: "Приета", cooking: "Готви се", ready: "Готова", on_way: "На път", delivered: "Доставена", picked_up: "Взета", served: "Сервирана", cancelled: "Отказана" };
const RST: Record<string, string> = { new: "Нова", confirmed: "Потвърдена", seated: "Дошли", no_show: "Неявили се", cancelled: "Отказана", waitlist: "Чака маса" };
export interface Names { dish?: Record<string, string>; note?: Record<string, string> }
const q = (s: string) => "„" + s + "“";
/* "YYYY-MM-DD" -> "ср, 18 ноември" */
const fmtDay = (ymd: string) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? fmtYmd(ymd) : ymd);
const cut = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 2) + " …" : s);
/** an entry in plain words (pure: the names of dishes and notes come in `names`, when the screen could load them) */
export function auditText(e: AuditEntry, names: Names = {}): string {
  const d = (e.data && typeof e.data === "object" ? e.data : {}) as Record<string, unknown>;
  const t = e.target || "";
  const dish = () => (names.dish && names.dish[t] ? q(names.dish[t]) : t ? q(t) : "ястие");
  const note = () => (names.note && names.note[t] ? " · " + q(cut(names.note[t])) : "");
  const secs = (l: unknown) => (Array.isArray(l) ? l.map((s) => (SEC[s] ? SEC[s].n : String(s))) : []);
  switch (e.action) {
    case "staff.login": return "Вход";
    case "staff.logout": return "Изход";
    case "staff.login_failed": return "Грешен вход: потребител " + q(e.actor && e.actor !== "?" ? e.actor : "без име");
    case "role.update": {
      const plus = secs(d.added).map((s) => "+ " + s), minus = secs(d.removed).map((s) => "- " + s);
      return "Права на " + q(roleName(t)) + ": " + (plus.concat(minus).join(", ") || "без промяна");
    }
    case "note.create": return "Нова бележка" + (d.module ? " (" + modWord(String(d.module)) + ")" : "") + note();
    case "note.status": return "Бележка: " + statusName(String(d.status || "")) + note() + (d.reason ? " · причина: " + q(cut(String(d.reason), 120)) : "");
    case "note.delete": return "Изтрита бележка" + note();
    case "note.restore": return "Върната изтрита бележка" + note();
    case "order.status": return "№\u00a0" + t + ": " + (OST[String(d.status)] || String(d.status || ""));
    case "order.change": return "№\u00a0" + t + ": клиентът промени поръчката" + (d.slot ? " (час " + String(d.slot).slice(-5) + ")" : "");
    case "office.auto_sent": return "Обедна поръчка за офиса " + t + ": изпратена автоматично в крайния час";
    case "reservation.status": return "Резервация: " + (RST[String(d.status)] || String(d.status || ""));
    case "reservation.cancel": return "Резервация: отказана от госта";
    case "menu.sold_out": return "Изчерпано днес: " + dish();
    case "menu.back": return "Върнато в менюто: " + dish();
    case "menu.draft": return "Меню: промяна в черновата";
    case "menu.publish": return "Меню: публикувано" + (d.version != null ? " (версия " + String(d.version) + ")" : "") + " · сайтът се пресглобява";
    case "menu.rollback": return "Меню: върнато предишното" + (d.version != null ? " (версия " + String(d.version) + ")" : "");
    case "menu.rebuild": return "Меню: сайтът е пресглобен пак";
    case "menu.discard": return "Меню: черновата е отказана";
    case "menu.media": return "Меню: качена снимка";
    case "lunch.update": return /^\d{4}-\d{2}-\d{2}$/.test(t) ? (d.n ? "Обедно меню, " + fmtDay(t) + ": " + String(d.n) + " ястия" : "Обедно меню: изчистен ден " + fmtDay(t)) : "Обедно меню: графикът е променен";
    case "lunch.publish": return "Обедно меню: публикувано" + (Array.isArray(d.days) ? " за " + d.days.map((x) => fmtDay(String(x))).join(", ") : t ? " за " + fmtDay(t) : "");
    case "lunch.fav": return "Обедно меню: нова любима комбинация" + (t ? " " + q(cut(t, 60)) : "");
    case "lunch.fav_remove": return "Обедно меню: махната любима комбинация";
    case "lunch.dish": return "Обедно меню: ново ястие" + (d.n ? " " + q(String(d.n)) : "");
    case "lunch.pin": return d.changed === false ? "ПИН за обедното меню: зададен" : "ПИН за обедното меню: сменен";
    case "lunch.unlock": return "Обедно меню: отключено с ПИН";
    case "lunch.lock": return "Обедно меню: заключено";
    case "lunch.pin_fail": return "Обедно меню: грешен ПИН";
    case "settings.update": return settingsText(d) || "Настройки: променени";
    default: return "Действие: " + e.action;
  }
}
function modWord(m: string) { return ({ site: "Клиентски сайт", masa: "QR маса", waiter: "Сервитьор", watch: "Часовник", kitchen: "Кухня", driver: "Шофьор", admin: "Админ", owner: "Собственик", manager: "Управител" } as Record<string, string>)[m] || m; }
function settingsText(d: Record<string, unknown>): string {
  const out: string[] = [], k = (d.kitchen && typeof d.kitchen === "object" ? d.kitchen : {}) as Record<string, unknown>;
  if (k.busy === true) out.push("„Натоварено“: включено" + (k.etaBusyMin ? ", около " + k.etaBusyMin + " мин" : ""));
  else if (k.busy === false) out.push("„Натоварено“: изключено" + (k.etaMin ? ", около " + k.etaMin + " мин" : ""));
  else {
    if (k.etaMin != null) out.push("Обичайно време: " + k.etaMin + " мин");
    if (k.etaBusyMin != null) out.push("При натоварване: " + k.etaBusyMin + " мин");
  }
  if (d.resMinutes != null) out.push("Колко време е масата на гостите: " + d.resMinutes + " мин");
  if (d.celebrationPrice != null) out.push("Празник: " + (d.celebrationPrice === "estimate" ? "ориентировъчна цена" : "само оферта"));
  if (d.earlyDays !== undefined) out.push("Ранна резервация: " + (d.earlyDays == null ? "изключена" : d.earlyDays + " дни"));
  return out.join("; ");
}
/** who in plain words: a known account -> its name and role; the customer, a guest, the system; a failed sign-in -> "Непознат" */
export function whoOf(e: AuditEntry, staff: Record<string, { name: string; role: string }>): { name: string; role: string } {
  if (e.action === "staff.login_failed") return { name: "Непознат", role: "" };
  const a = e.actor || "";
  if (staff[a]) return staff[a];
  if (a === "customer") return { name: "Клиент", role: "" };
  if (a === "guest") return { name: "Гост", role: "" };
  if (a === "system") return { name: "Системата", role: "" };
  if (!a || a === "?") return { name: "Непознат", role: "" };
  return { name: a, role: "" };
}

const PER: [string, string][] = [["1", "Днес"], ["7", "7 дни"], ["30", "30 дни"], ["all", "Всичко"]];

export async function initAudit(): Promise<void> {
  const body = await mount({ section: "audit", title: "Дневник",
    sub: "Кой, кога и какво е променил: входове, роли и права, меню, обедно меню, бележки, резервации, клиенти, залата и настройките.",
    actions: '<button class="pill pill-line" type="button" data-csv>' + ic("export", 20) + "Изтегли CSV</button>" });
  if (!body) return;
  const root = body, MAIN = isMainAdmin();
  let L0: AuditEntry[] = [], loaded = false, fail: unknown = null, shown = 60;
  const staff: Record<string, { name: string; role: string }> = {}, names: Names = {};
  const h = (() => { const o: Record<string, string> = {}; location.hash.slice(1).split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return o; })();
  let f = { g: G.some((x) => x[0] === h.g) ? h.g : "", who: h.who || "", p: PER.some((x) => x[0] === h.p) ? h.p : "7", q: "" };

  const whoName = (e: AuditEntry) => whoOf(e, staff).name;
  const today = () => ymdOf(new Date());
  const inPeriod = (e: AuditEntry) => f.p === "all" || dayDiff(ymdOf(e.at), today()) < +f.p;
  const text = (e: AuditEntry) => auditText(e, names);
  const list = () => L0.filter((e) => inPeriod(e) && (!f.g || group(e.action) === f.g) && (!f.who || whoName(e) === f.who) && (!f.q || norm(text(e) + " " + whoName(e) + " " + e.action).includes(norm(f.q))));
  function hashSync() {
    const o: Record<string, string> = { g: f.g, who: f.who, p: f.p === "7" ? "" : f.p };
    const s = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
    try { history.replaceState(history.state, "", location.pathname + location.search + (s ? "#" + s : "")); } catch { /* ignore */ }
  }

  function row(e: AuditEntry) {
    const g = gOf(group(e.action)), w = whoOf(e, staff);
    return '<div class="au-e g-' + g[0] + '" role="listitem"><span class="t">' + hmOf(e.at) + '</span><span class="dot" aria-hidden="true">' + ic(g[2], 22) + '</span><div class="tx"><p>' + esc(text(e)) + "</p>" +
      '<div class="meta"><span>' + esc(w.name) + (w.role && w.name !== roleName(w.role) ? " · " + esc(roleName(w.role)) : "") + "</span>" + (MAIN ? '<code title="Ключ в ядрото">' + esc(e.action) + "</code>" : "") + "</div></div></div>";
  }
  function draw() {
    const sc = A.scroller, y = sc ? sc.scrollTop : 0;
    if (!loaded && !fail) { root.innerHTML = skel(6, "Зареждаме дневника …"); return; }
    if (!loaded && fail) { root.innerHTML = failHTML(fail, "Не успяхме да заредим дневника. Записите се пазят; опитайте пак."); return; }
    const L = list(), who = [...new Set(L0.map(whoName))].filter((x) => x && x !== "Непознат").sort((a, b) => a.localeCompare(b, "bg"));
    const days: { k: string; at: string; items: AuditEntry[] }[] = [];
    L.slice(0, shown).forEach((e) => { const k = ymdOf(e.at), cur = days[days.length - 1]; if (!cur || cur.k !== k) days.push({ k, at: e.at, items: [e] }); else cur.items.push(e); });
    /* all the kinds, as in the prototype (an empty one gives "Нищо за този филтър.") */
    const kinds = G;
    /* the count of a day is the whole day in the filter, not only the shown part */
    const perDay: Record<string, number> = {}; L.forEach((e) => { const k = ymdOf(e.at); perDay[k] = (perDay[k] || 0) + 1; });
    const isQ = document.activeElement && (document.activeElement as HTMLElement).id === "au-q";
    root.innerHTML = (fail && loaded ? offline("Показваме последно заредените записи. Новите се появяват, щом връзката се върне.") + '<div style="height:16px"></div>' : "") +
      '<div class="au-note" data-edit-id="admin.audit.note">' + ic("lock", 20) + "<span><b>Само за четене.</b> Записите не се трият и не се променят; пазят се " + missing("срок на пазене") + ". Паролите и ПИН кодовете никога не влизат в дневника, само че са сменени.</span></div>" +
      '<div class="au-bar"><div class="sa-field-s"><label class="vh" for="au-q">Търси в дневника</label>' + ic("magnifying-glass", 20) + '<input class="input" id="au-q" type="search" placeholder="Търси: ястие, маса, човек" autocomplete="off" value="' + esc(f.q) + '"></div>' +
        '<div><label class="vh" for="au-w">Кой</label><select class="input" id="au-w" data-who><option value="">Всички хора</option>' + who.map((w) => "<option" + (f.who === w ? " selected" : "") + ">" + esc(w) + "</option>").join("") + "</select></div>" +
        '<div><label class="vh" for="au-p">Период</label><select class="input" id="au-p" data-per>' + PER.map((p) => '<option value="' + p[0] + '"' + (f.p === p[0] ? " selected" : "") + ">" + p[1] + "</option>").join("") + "</select></div>" +
        '<div class="chips" role="group" aria-label="Вид"><button class="chip" type="button" data-g="" aria-pressed="' + !f.g + '">Всичко</button>' + kinds.map((g) => '<button class="chip" type="button" data-g="' + g[0] + '" aria-pressed="' + (f.g === g[0]) + '">' + ic(g[2], 16) + g[1] + "</button>").join("") + "</div></div>" +
      '<p class="au-sum"><span><b>' + plural(L.length, "запис", "записа") + "</b> · " + PER.find((p) => p[0] === f.p)![1].toLowerCase() + "</span>" + (more ? '<button class="pill pill-line" type="button" data-older>' + ic("clock", 20) + "Зареди по-стари</button>" : "") + "</p>" +
      (!L.length ? '<div class="sa-card">' + (!L0.length ? empty({ icon: "list-bullets", title: "Дневникът е празен.", text: "Всеки вход и всяка промяна в панела се записва тук: кой, кога и какво." })
        : empty({ icon: "funnel", title: "Нищо за този филтър.", text: "Изберете по-дълъг период или „Всичко“.", action: '<button class="pill pill-line pill-lg" type="button" data-clear>' + ic("x", 20) + "Махни филтрите</button>" })) + "</div>"
        : days.map((d) => '<section class="au-day" aria-label="' + esc(dayTitle(d.at)) + '"><h2>' + esc(dayTitle(d.at)) + "<small>" + (perDay[d.k] || d.items.length) + '</small></h2><div class="au-list" role="list">' + d.items.map(row).join("") + "</div></section>").join("") +
          (L.length > shown ? '<div class="au-more"><button class="pill pill-line pill-lg" type="button" data-more>Покажи още ' + Math.min(60, L.length - shown) + "</button></div>" : ""));
    if (sc) sc.scrollTop = y;
    if (isQ) { const i = root.querySelector<HTMLInputElement>("#au-q"); if (i) { i.focus(); const n = i.value.length; try { i.setSelectionRange(n, n); } catch { /* ignore */ } } }
  }

  /* the server gives the newest 1000 (with its filters); "Зареди по-стари" pages back */
  const PAGE = 1000; let more = false;
  async function load() {
    try {
      L0 = (await adminApi.audit({ limit: PAGE })).slice().sort((a, b) => (a.at < b.at ? 1 : -1)); more = L0.length >= PAGE; loaded = true; fail = null;
    } catch (e) { if (e instanceof ApiError && e.status === 401) { location.replace(aurl.login(aurl.here())); return; } fail = e; return; }
    /* names: the people (Персонал), the notes (Бележки), the dishes (the live menu); each only if this role may read it */
    const jobs: Promise<unknown>[] = [];
    if (can("staff")) jobs.push(adminApi.staff().then((l) => { l.forEach((u) => { staff[u.username] = { name: u.name, role: u.role }; staff[u.name] = { name: u.name, role: u.role }; }); }, () => { /* usernames stay */ }));
    else if (A.me) { const u = A.me.user; staff[u.username] = staff[u.name] = { name: u.name, role: u.role }; }
    if (can("notes") && L0.some((e) => /^note\./.test(e.action))) jobs.push(adminApi.notes().then((l: FeedbackNote[]) => { names.note = {}; l.forEach((n) => { names.note![n.id] = n.text; }); }, () => { /* without the text */ }));
    if (L0.some((e) => /^menu\./.test(e.action))) jobs.push(api.menu().then((m) => { names.dish = {}; m.items.forEach((x) => { names.dish![x.id] = x.n; }); (m.lunch.items || []).forEach((x) => { names.dish![x.id] = x.n; }); }, () => { /* the id stays */ }));
    await Promise.all(jobs);
  }

  root.addEventListener("click", (e) => {
    const t = e.target as Element; let x: HTMLElement | null;
    if (t.closest('[data-sa="retry"]')) { e.stopPropagation(); fail = null; draw(); load().then(draw); return; }
    if ((x = t.closest<HTMLElement>("[data-g]")) && x.closest(".au-bar")) { f.g = x.dataset.g || ""; shown = 60; hashSync(); draw(); return; }
    if (t.closest("[data-more]")) { shown += 60; draw(); return; }
    if (t.closest("[data-older]") && L0.length) {
      const b = t.closest<HTMLButtonElement>("[data-older]")!; b.disabled = true;
      adminApi.audit({ limit: PAGE, before: L0[L0.length - 1].at }).then((l) => { const have = new Set(L0.map((x) => x.id)), add = l.filter((x) => !have.has(x.id)); L0 = L0.concat(add); more = add.length > 0 && l.length >= PAGE; draw(); }, () => { b.disabled = false; toast("Не успяхме да заредим по-старите записи. Опитайте пак."); });
      return;
    }
    if (t.closest("[data-clear]")) { f = { g: "", who: "", p: "all", q: "" }; hashSync(); draw(); }
  }, true);
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLSelectElement;
    if (t.matches("[data-who]")) { f.who = t.value; shown = 60; hashSync(); draw(); }
    if (t.matches("[data-per]")) { f.p = t.value; shown = 60; hashSync(); draw(); }
  });
  root.addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.id !== "au-q") return; f.q = t.value; shown = 60; draw(); });
  /* "Изтегли CSV": what the filters show, in plain words (Excel reads ";" and the BOM) */
  A.app?.addEventListener("click", (e) => {
    if (!(e.target as Element).closest("[data-csv]")) return;
    if (!loaded) { toast("Дневникът още се зарежда."); return; }
    const rows = [["Кога", "Кой", "Роля", "Действие", "Какво"]].concat(list().map((x) => { const w = whoOf(x, staff); return [ymdOf(x.at) + " " + hmOf(x.at), w.name, w.role ? roleName(w.role) : "", x.action, text(x)]; }));
    /* a cell that starts with = + - @ (or a tab / return) is text, never a formula: a username from a failed sign-in is anyone's */
    const cell = (v: unknown) => { let x = String(v == null ? "" : v); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
    const csv = "﻿" + rows.map((r) => r.map(cell).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "siracusa-dnevnik.csv"; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast("Изтеглени " + plural(list().length, "запис", "записа"));
  });

  draw();
  await load();
  draw();
}
