/* /admin/roles/: "Роли и права" (design/pages-admin/roles.html, version 4, 1:1).
   - Roles (columns) x sections (rows by the groups + "Приложения на персонала"), check boxes of 48 px. The main admin is
     locked ("винаги всичко"), "Табло" is for every role (decision 14.11.2026).
   - A change shows at once (a coloured cell, the count in the head) and the bar "3 промени · Още не са запазени · Откажи ·
     Запази промените" (above the bottom bar on the phone; the round "Молив" goes up by itself: a.ts watches .sa-pbar.on).
   - Saving: adminApi.setRole for every changed role; the core writes "role.update" in the log; a toast with "Отмени" puts
     the earlier rights back the same way. Only the main admin saves; another role with "Роли и права" sees the table
     locked, with why. Leaving with unsaved changes asks first.
   - Phone: one role at a time (#r=waiter), a list of switches. Below: the descriptions of the roles; question 7 of
     docs/OPEN-QUESTIONS.md as a note next to "Управител". */
import "sc-icons:lock,check,question,info,clock,squares-four,receipt,calendar-check,fork-knife,bowl-food,seal-percent,confetti,map-trifold,chair,qr-code,users,users-three,shield-check,chart-bar,wallet,list-bullets,pencil-simple,globe,sliders-horizontal,bell-ringing,chef-hat,moped,sparkle";
import { adminApi, ApiError } from "../client/api-admin.ts";
import type { Role, RoleId, AuditEntry } from "../client/api-types.ts";
import { A, mount, can, isMainAdmin, toast, sheet, skel, failHTML, offline, soonTag, esc, ic, plural, SEC, GROUPS, APPS, refreshSide } from "./a.ts";
import { aurl } from "./routes.ts";
import { ago } from "./when.ts";

const LOCKED = ["dashboard"]; /* "Табло" is for every role: without it a role has nowhere to land */
const ROWS: [string, string[]][] = GROUPS.map((g) => [g[0], g[1]] as [string, string[]]).concat([["Приложения на персонала", APPS]]);
const ALL = ROWS.flatMap((g) => g[1]);
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";

export async function initRoles(): Promise<void> {
  const body = await mount({ section: "roles", title: "Роли и права", eyebrow: "Хора",
    sub: "Кой какво вижда. Отметнатият раздел се показва в лентата на ролята. Главният админ вижда всичко и не може да заключи себе си." });
  if (!body) return;
  const root = body, MAIN = isMainAdmin();
  root.innerHTML = skel(6, "Зареждаме ролите …");

  let ROLES: Role[] = [], saved: Record<string, string[]> = {}, draft: Record<string, string[]> = {}, last: AuditEntry | null = null, names: Record<string, string> = {};
  const hash = () => { const m = /(?:^|[#&])r=([a-z]+)/.exec(location.hash); return m ? m[1] : ""; };
  let phoneRole = "manager", saving = false;

  const roleName = (id: string) => { const r = ROLES.find((x) => x.id === id); return r ? r.n : id; };
  const has = (r: string, s: string) => r === "admin" || LOCKED.includes(s) || (draft[r] || []).includes(s);
  const was = (r: string, s: string) => r === "admin" || LOCKED.includes(s) || (saved[r] || []).includes(s);
  const diff = () => { const out: [string, string, boolean][] = []; ROLES.forEach((r) => { if (r.id === "admin") return; ALL.forEach((s) => { if (has(r.id, s) !== was(r.id, s)) out.push([r.id, s, has(r.id, s)]); }); }); return out; };
  const count = (r: string) => ALL.filter((s) => has(r, s)).length;
  const secName = (s: string) => (SEC[s] ? SEC[s].n : s);
  const copy = (o: Record<string, string[]>) => JSON.parse(JSON.stringify(o)) as Record<string, string[]>;

  async function load(): Promise<boolean> {
    try {
      ROLES = await adminApi.roles();
      saved = {}; ROLES.forEach((r) => { saved[r.id] = r.sections.slice(); }); draft = copy(saved);
      if (!ROLES.some((r) => r.id === phoneRole)) phoneRole = ROLES[1] ? ROLES[1].id : "admin";
      const h = hash(); if (h && saved[h]) phoneRole = h;
      return true;
    } catch (e) {
      root.innerHTML = failHTML(e, "Не успяхме да заредим ролите. Правата не са променени.");
      return false;
    }
  }
  /* "Последна промяна: Поли, преди 5 мин" (the log, for the roles that see it) */
  async function lastChange() {
    if (!can("audit")) return;
    try {
      const [log, staff] = await Promise.all([adminApi.audit(), can("staff") ? adminApi.staff().catch(() => []) : Promise.resolve([])]);
      last = log.find((x) => x.action === "role.update") || null;
      staff.forEach((u) => { names[u.username] = u.name; names[u.name] = u.name; });
      const el = root.querySelector("[data-last]"); if (el) el.outerHTML = lastHTML();
    } catch { /* without the line */ }
  }
  const lastHTML = () => (last ? '<p class="rl-last" data-last>' + ic("clock", 18) + "Последна промяна: " + esc(names[last.actor] || last.actor) + ", " + esc(ago(last.at)) + "</p>" : '<p class="rl-last" data-last hidden></p>');

  /* ---------- drawing ---------- */
  function head() {
    return '<thead><tr><th scope="col"><span class="rn">Раздел</span></th>' + ROLES.map((r) =>
      '<th scope="col" class="' + (r.id === "admin" ? "adm" : "") + (r.id === "manager" ? " col-mgr" : "") + '"><span class="rn">' + esc(r.n) + "</span>" +
      (r.id === "admin" ? '<span class="rc">' + ic("lock", 14) + " винаги всичко</span>" : '<span class="rc" data-cnt="' + r.id + '">' + plural(count(r.id), "раздел", "раздела") + "</span>") +
      (r.id === "manager" ? '<span class="sa-tag ember">Въпрос 7</span>' : "") + "</th>").join("") + "</tr></thead>";
  }
  function cell(r: string, s: string) {
    const lock = r === "admin" || LOCKED.includes(s), on = has(r, s), lbl = roleName(r) + ": " + secName(s);
    return '<td class="' + (r === "admin" ? "adm" : "") + (r === "manager" ? " col-mgr" : "") + '"><label class="sa-check' + (on !== was(r, s) ? " chg" : "") + '" title="' + esc(lbl) + '"><input type="checkbox" data-r="' + r + '" data-s="' + s + '"' + (on ? " checked" : "") + (lock || !MAIN ? " disabled" : "") +
      ' aria-label="' + esc(lbl) + (lock ? (r === "admin" ? ", винаги" : ", за всички") : "") + '"><span class="bx">' + (lock && r === "admin" ? ic("lock", 16) : ic("check", 18)) + "</span></label></td>";
  }
  const rowNote = (s: string) => (s === "dashboard" ? "<small>За всички роли</small>" : s === "notes" ? "<small>Без него: само „Моите препоръки“</small>" : s === "site" ? "<small>„Модулите на живо“ с рамките</small>" : "");
  function matrix() {
    return '<div class="sa-tablewrap scroll rl-wrap"><table class="rl" aria-label="Роли по раздели">' + head() + "<tbody>" + ROWS.map((g) =>
      '<tr class="gh"><th colspan="' + (ROLES.length + 1) + '" scope="colgroup">' + esc(g[0]) + "</th></tr>" + g[1].map((s) => {
        const x = SEC[s];
        return '<tr><th scope="row"><span class="sn">' + ic(x.ic, 20) + esc(x.n) + (x.soon ? " " + soonTag() : "") + "</span>" + rowNote(s) + "</th>" + ROLES.map((r) => cell(r.id, s)).join("") + "</tr>";
      }).join("")).join("") + "</tbody></table></div>";
  }
  function phone() {
    const r = ROLES.find((x) => x.id === phoneRole) || ROLES[0];
    return '<div class="rl-ph"><div class="chips" role="tablist" aria-label="Роля">' + ROLES.map((x) => '<button class="chip" type="button" role="tab" data-pr="' + x.id + '" aria-selected="' + (x.id === r.id) + '" tabindex="' + (x.id === r.id ? 0 : -1) + '">' + esc(x.n) + "</button>").join("") + "</div>" +
      '<div class="sa-card rl-who"><h2>' + esc(r.n) + "</h2><p>" + esc(r.desc) + '</p><div class="tags">' + (r.id === "admin" ? '<span class="sa-tag">' + ic("lock", 16) + "Винаги всичко</span>" : '<span class="sa-tag" data-cnt="' + r.id + '">' + plural(count(r.id), "раздел", "раздела") + "</span>") + (r.id === "manager" ? '<span class="sa-tag ember">Въпрос 7</span>' : "") + "</div></div>" +
      ROWS.map((g) => '<div class="rl-g"><h3>' + esc(g[0]) + '</h3><div class="sa-card">' + g[1].map((s) => {
        const x = SEC[s], lock = r.id === "admin" || LOCKED.includes(s), on = has(r.id, s), id = "sw-" + r.id + "-" + s;
        return '<div class="rl-sw' + (on !== was(r.id, s) ? " chg" : "") + '">' + ic(x.ic, 22) + '<label for="' + id + '">' + esc(x.n) + (x.soon ? " · Скоро" : "") + (lock ? "<small>" + (r.id === "admin" ? "Винаги" : "За всички роли") + "</small>" : "") + "</label>" +
          '<label class="sa-switch"><input type="checkbox" role="switch" id="' + id + '" data-r="' + r.id + '" data-s="' + s + '"' + (on ? " checked" : "") + (lock || !MAIN ? " disabled" : "") + '><span class="tr"></span></label></div>';
      }).join("") + "</div></div>").join("") + "</div>";
  }
  function desc() {
    return '<div class="sa-sh"><h2>Ролите</h2><p>Описанията са от мастър промпта, раздел 8.1.</p></div><div class="rl-desc">' + ROLES.map((r) =>
      '<article class="sa-card"><h3>' + esc(r.n) + (r.id === "admin" ? ' <span class="sa-tag">' + ic("lock", 16) + "Не се променя</span>" : "") + "</h3><p>" + esc(r.desc) + '</p><span class="sa-tag"' + (r.id === "admin" ? "" : ' data-cnt="' + r.id + '"') + ">" +
      (r.id === "admin" ? "Всички " + ALL.length + " раздела" : plural(count(r.id), "раздел", "раздела")) + "</span>" +
      "</article>").join("") + "</div>";
  }
  let offlineNote = false;
  function draw() {
    root.innerHTML = (offlineNote ? offline("Няма връзка. Промените са тук и още не са запазени; опитайте пак, щом връзката се върне.") + '<div style="height:16px"></div>' : "") +
      (!MAIN ? '<div class="rl-q rl-lock">' + ic("lock", 24) + "<div><b>Само главният админ променя правата</b><p>Виждате таблицата, за да знаете кой какво вижда. Ако трябва промяна, помолете главния админ.</p></div></div>" : "") +
      '<div class="rl-q" data-edit-id="admin.roles.question7">' + ic("question", 24) + "<div><b>Отворен въпрос към собственика (7): права на управителя</b><p>Какво остава само за собственика? По подразбиране управителят е като собственика без „Финанси и гориво“, „Роли и права“ и „Дневник“.</p></div></div>" +
      '<div class="rl-q rl-info">' + ic("info", 24) + "<div><b>Вход според ролята</b><p>Сервитьорът, кухнята и шофьорът влизат направо в своето приложение на цял екран; моливът за препоръки е вътре. Админът и „Модулите на живо“ са за ролите с „Табло“ и „Клиентски сайт“: главен админ, собственик, управител, маркетинг.</p></div></div>" +
      matrix() + phone() + lastHTML() + desc();
  }
  function chipIntoView() { const c = root.querySelector<HTMLElement>('[data-pr][aria-selected="true"]'); if (!c) return; const p = c.parentElement!; p.scrollLeft += c.getBoundingClientRect().left - p.getBoundingClientRect().left - 16; }

  /* ---------- the save bar (.sa-pbar in the column, as in the prototype) ---------- */
  A.col!.insertAdjacentHTML("beforeend", '<div class="sa-pbar rl-bar" role="region" aria-label="Незапазени промени"><span class="n" data-n aria-live="polite"></span><button class="pill pill-line" type="button" data-cancel><span class="lg">Откажи промените</span><span class="sm">Откажи</span></button><button class="pill pill-red" type="button" data-save>' + ic("check", 20) + '<span class="lg">Запази промените</span><span class="sm">Запази</span></button></div>');
  const bar = A.col!.querySelector<HTMLElement>(".rl-bar")!;
  function upd() {
    const d = diff(); bar.classList.toggle("on", d.length > 0);
    bar.querySelector("[data-n]")!.innerHTML = plural(d.length, "промяна", "промени") + '<small class="lg">Още не са запазени</small>';
    (bar.querySelector("[data-save]") as HTMLButtonElement).disabled = saving;
    root.querySelectorAll<HTMLElement>("[data-cnt]").forEach((el) => { el.textContent = plural(count(el.dataset.cnt!), "раздел", "раздела"); });
    root.querySelectorAll<HTMLInputElement>("input[data-r]").forEach((i) => {
      const ch = has(i.dataset.r!, i.dataset.s!) !== was(i.dataset.r!, i.dataset.s!);
      const host = i.closest(".sa-check") || i.closest(".rl-sw"); if (host) host.classList.toggle("chg", ch);
      i.checked = has(i.dataset.r!, i.dataset.s!);
    });
  }
  root.addEventListener("change", (e) => {
    const i = (e.target as Element).closest<HTMLInputElement>("input[data-r]"); if (!i || !MAIN) return;
    const r = i.dataset.r!, s = i.dataset.s!, l = draft[r] || (draft[r] = []);
    if (i.checked) { if (!l.includes(s)) l.push(s); } else draft[r] = l.filter((x) => x !== s);
    upd();
  });
  root.addEventListener("click", (e) => {
    const t = e.target as Element;
    if (t.closest('[data-sa="retry"]')) { e.stopPropagation(); offlineNote = false; root.innerHTML = skel(6, "Зареждаме ролите …"); start(); return; }
    const c = t.closest<HTMLElement>("[data-pr]"); if (!c) return;
    phoneRole = c.dataset.pr!;
    try { history.replaceState(history.state, "", location.pathname + location.search + "#r=" + phoneRole); } catch { /* ignore */ }
    const y = A.scroller ? A.scroller.scrollTop : 0; draw(); upd(); if (A.scroller) A.scroller.scrollTop = y;
    chipIntoView(); root.querySelector<HTMLElement>('[data-pr="' + phoneRole + '"]')?.focus({ preventScroll: true });
  }, true);
  /* arrows between the roles (tabs) */
  root.addEventListener("keydown", (e) => {
    const c = (e.target as Element).closest("[data-pr]"); if (!c || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return; e.preventDefault();
    const ids = ROLES.map((r) => r.id as string), i = ids.indexOf(phoneRole);
    root.querySelector<HTMLElement>('[data-pr="' + ids[(i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length] + '"]')?.click();
  });
  bar.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => { draft = copy(saved); upd(); toast("Промените са отказани"); };

  /** sets the rights of the given roles one by one; on an error the roles saved so far stay saved */
  async function apply(target: Record<string, string[]>, ids: string[]): Promise<{ ok: string[]; err: unknown }> {
    const ok: string[] = [];
    for (const id of ids) {
      try { const r = await adminApi.setRole(id as RoleId, target[id]); saved[id] = r.sections.slice(); ok.push(id); }
      catch (e) { return { ok, err: e }; }
    }
    return { ok, err: null };
  }
  async function save(): Promise<boolean> {
    const d = diff(); if (!d.length || saving) return true;
    saving = true; upd();
    const prev = copy(saved), ids = [...new Set(d.map((x) => x[0]))];
    const r = await apply(draft, ids);
    saving = false;
    if (r.err) {
      if (r.err instanceof ApiError && r.err.status === 401) { location.replace(aurl.login(aurl.here())); return false; }
      offlineNote = isOffline(r.err);
      const keep = copy(draft); draw(); draft = keep; upd();
      toast(offlineNote ? "Няма връзка. Промените не са запазени; опитайте пак." : r.err instanceof ApiError ? r.err.message : "Не успяхме да запазим. Опитайте пак.");
      return false;
    }
    offlineNote = false;
    draft = copy(saved);
    last = { id: "", at: new Date().toISOString(), actor: A.me ? A.me.user.name : "", action: "role.update" };
    refreshSide(); draw(); upd(); chipIntoView();
    toast("Правата са запазени · " + plural(d.length, "промяна", "промени"), { undo: async () => {
      const back = await apply(prev, ids);
      draft = copy(saved); draw(); upd();
      toast(back.err ? (isOffline(back.err) ? "Няма връзка. Правата не са върнати; опитайте пак." : "Не успяхме да върнем всички права.") : "Правата са върнати");
    } });
    return true;
  }
  bar.querySelector<HTMLButtonElement>("[data-save]")!.onclick = () => { save(); };

  /* unsaved changes: ask before leaving the page */
  window.addEventListener("beforeunload", (e) => { if (diff().length) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!a || !diff().length || a.target === "_blank" || (a.getAttribute("href") || "").charAt(0) === "#" || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); const n = diff().length, href = a.href;
    const sh = sheet({ title: "Незапазени промени", html: '<p style="margin:0">Имате ' + plural(n, "незапазена промяна", "незапазени промени") + " в правата. Да ги запазим, преди да продължите?</p>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-leave>Не запазвай</button><button class="pill pill-red pill-lg" type="button" data-keep>' + ic("check", 22) + "Запази и продължи</button>" });
    sh.foot!.querySelector<HTMLButtonElement>("[data-leave]")!.onclick = () => { draft = copy(saved); location.href = href; };
    sh.foot!.querySelector<HTMLButtonElement>("[data-keep]")!.onclick = async () => { sh.close(); if (await save()) location.href = href; };
  }, true);

  async function start() {
    if (!(await load())) return;
    draw(); upd(); chipIntoView();
    lastChange();
  }
  await start();
}
