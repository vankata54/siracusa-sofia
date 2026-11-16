/* /admin/staff/: „Персонал“ (design/pages-admin/staff.html, версия 4, 1:1; решение 16.11.2026 „основа на част 3“).
   - 4 числа (активни, неактивни, в приложенията, без ПИН), табове Активни · Неактивни · Всички, търсене; таблица -> карти.
   - Кой кого управлява (ядрото, staff-admin.ts): главният админ всички; останалите само по-ниски роли, не себе си, не
     последния активен главен админ. Себе си: само паролата. Екранът показва само позволените действия; сървърът пак проверява.
   - „Нов потребител“: потребител (латиница), име, роля (само тези, които можете да давате, с описанието), парола поне 10 знака
     с „Покажи“, сила и „Генерирай парола“; ПИН за сервитьор, кухня и шофьор: случаен по подразбиране, мой или по-късно.
   - ПИН: случаен по подразбиране; новият се показва ВЕДНЪЖ (после само „••••“). Зает или лесен: „Изберете друг ПИН.“ (без да
     се казва чий); след 5 отказани избора 15 мин пауза (429). „Махни ПИН“.
   - Деактивиране с потвърждение и „Отмени“; „Име и роля“ с „Отмени“. Паролите и ПИН-овете не влизат в дневника, само че са сменени.
   Адреси: #f=off|all. Състояния: зареждане, празно, грешка, без връзка, без права (A.mount). */
import "sc-icons:plus,users-three,magnifying-glass,info,lock,dots-nine,pencil-simple,sliders-horizontal,sparkle,copy,check,warning-circle,arrow-counter-clockwise";
import { staffAdminApi, ApiError, type StaffRow } from "../client/api-admin-3.ts";
import type { RoleId } from "../client/api-types.ts";
import { A, mount, toast, sheet, confirm, skel, failHTML, offline, empty, missing, norm, initials, dateLong, esc, ic, roleName } from "./a.ts";
import { aurl } from "./routes.ts";
import { hmOf, ymdOf, dayDiff } from "./when.ts";

type RoleInfo = { id: RoleId; n: string; desc: string; manageable: boolean };
const PIN_ROLES = ["waiter", "kitchen", "driver"];
const APP_OF: Record<string, string> = { waiter: "на сервитьора", kitchen: "на кухнята", driver: "на шофьора" };
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
function readHash(): Record<string, string> { const o: Record<string, string> = {}; location.hash.slice(1).split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return o; }
function writeHash(o: Record<string, string>) {
  const h = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&");
  try { history.replaceState(history.state, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ }
}
const errText = (e: unknown, def: string) => (isOffline(e) ? "Няма връзка. Нищо не е сменено; опитайте пак." : e instanceof ApiError ? e.message : def);
/** "днес, 19:10", "вчера, 18:40", "чт, 12 ное, 20:02" */
export function whenShort(iso: string, now: Date = new Date()): string {
  const dd = dayDiff(ymdOf(iso), ymdOf(now));
  return (dd === 0 ? "днес" : dd === 1 ? "вчера" : dateLong(new Date(iso), true)) + ", " + hmOf(iso);
}
/** 0..4 */
export function strength(p: string) { let s = 0; if (p.length >= 10) s++; if (p.length >= 14) s++; if (/[a-zа-я]/.test(p) && /[A-ZА-Я]/.test(p)) s++; if (/\d/.test(p) && /[^\w]/.test(p)) s++; return Math.min(4, p.length < 10 ? Math.min(1, s) : s); }
function genPw() { const abc = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789", a = new Uint32Array(14); let s = ""; crypto.getRandomValues(a); for (let i = 0; i < 14; i++) s += abc[a[i] % abc.length]; return s.slice(0, 4) + "-" + s.slice(4, 9) + "-" + s.slice(9); }
function fieldErr(el: HTMLElement, msg: string) {
  const f = el.closest(".field")!; let e = f.querySelector<HTMLElement>(".err");
  if (!e) { e = document.createElement("span"); e.className = "err"; e.setAttribute("role", "alert"); f.appendChild(e); }
  e.textContent = msg || ""; e.hidden = !msg; el.setAttribute("aria-invalid", msg ? "true" : "false");
}

export async function initStaff(): Promise<void> {
  const body = await mount({ section: "staff", title: "Персонал",
    sub: "Потребителите на панела и на приложенията: роля, парола (поне 10 знака) и личен 4-цифрен ПИН за сервитьорите, кухнята и шофьорите.",
    actions: '<button class="pill pill-red" type="button" data-new>' + ic("plus", 20) + "Нов потребител</button>" });
  if (!body) return;
  const root = body;
  let U: StaffRow[] = [], ROLES: RoleInfo[] = [], loaded = false, offlineNote = false;
  let flt = readHash().f === "off" ? "off" : readHash().f === "all" ? "all" : "on", q = "";
  const rank = (r: string) => ({ admin: 4, owner: 3, manager: 2 } as Record<string, number>)[r] || 1;
  const role = (id: string) => ROLES.find((r) => r.id === id) || { id: id as RoleId, n: roleName(id), desc: "", manageable: false };
  const byId = (id: string) => U.find((u) => u.id === id)!;

  async function load(): Promise<boolean> {
    try { const r = await staffAdminApi.list(); U = r.rows; ROLES = r.roles; loaded = true; offlineNote = false; return true; }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { location.replace(aurl.login(aurl.here())); return false; }
      if (loaded && isOffline(e)) { offlineNote = true; draw(); return false; }
      root.innerHTML = failHTML(e, "Не успяхме да заредим потребителите. Входът на персонала работи както досега."); return false;
    }
  }
  function list() {
    return U.filter((u) => (flt === "all" || (flt === "on") === u.active) && (!q || norm(u.name + " " + u.username + " " + roleName(u.role)).includes(norm(q))))
      .sort((a, b) => rank(b.role) - rank(a.role) || a.name.localeCompare(b.name, "bg"));
  }
  const pinCell = (u: StaffRow) => (u.pin === "n/a" ? '<span class="muted">не трябва</span>' : u.pin === "set" ? '<span class="pin" role="img" aria-label="ПИН зададен">••••</span>' : '<span class="sa-tag warn">' + ic("warning-circle", 16) + "Няма ПИН</span>");
  const canOpen = (u: StaffRow) => u.canManage || u.self;
  function draw() {
    if (!loaded) return;
    const y = A.scroller ? A.scroller.scrollTop : 0, L = list();
    const act = U.filter((u) => u.active), noPin = act.filter((u) => u.pin === "none").length;
    root.innerHTML = (offlineNote ? offline("Промените по персонала чакат връзката. Входът на персонала работи с последните данни.") + '<div style="height:16px"></div>' : "") +
      '<div class="sf-sum" data-edit-id="admin.staff.sum"><div><b>' + act.length + "</b><span>активни</span></div><div><b>" + U.filter((u) => !u.active).length + "</b><span>неактивни</span></div>" +
        "<div><b>" + act.filter((u) => PIN_ROLES.includes(u.role)).length + "</b><span>в приложенията</span></div><div><b" + (noPin ? ' style="color:var(--warn)"' : "") + ">" + noPin + "</b><span>без ПИН</span></div></div>" +
      '<p class="sf-note" style="margin-bottom:14px">' + ic("info", 20) + "<span>Списъкът с хората и ролите им: " + missing("списък на персонала с имената и ролите") + ". Паролата и ПИН-ът се дават на човека лично.</span></p>" +
      '<div class="sf-bar"><div class="sa-tabs" role="tablist" aria-label="Филтър">' + ([["on", "Активни"], ["off", "Неактивни"], ["all", "Всички"]] as [string, string][]).map((f) => {
        const n = U.filter((u) => f[0] === "all" || (f[0] === "on") === u.active).length;
        return '<button role="tab" type="button" data-f="' + f[0] + '" aria-selected="' + (flt === f[0]) + '" tabindex="' + (flt === f[0] ? 0 : -1) + '">' + f[1] + '<span class="c">' + n + "</span></button>";
      }).join("") + "</div>" +
        '<div class="sa-field-s"><label class="vh" for="sf-q">Търси</label>' + ic("magnifying-glass", 20) + '<input class="input" id="sf-q" type="search" placeholder="Име, потребител или роля" autocomplete="off" value="' + esc(q) + '"></div></div>' +
      (!L.length ? '<div class="sa-card">' + (U.length <= 1 && !q && flt !== "off" ? empty({ icon: "users-three", title: "Още няма персонал.", text: "Добавете сервитьорите, кухнята и шофьорите. Всеки получава потребител, парола и личен ПИН.", action: '<button class="pill pill-red pill-lg" type="button" data-new>' + ic("plus", 22) + "Нов потребител</button>" })
        : empty({ icon: "magnifying-glass", title: flt === "off" && !q ? "Няма неактивни потребители." : "Няма такъв потребител.", text: "Сменете филтъра или търсенето." })) + "</div>" :
      '<div class="sa-tablewrap scroll"><table class="sa-table"><thead><tr><th>Потребител</th><th class="c-rl">Роля</th><th>ПИН</th><th>Последен вход</th><th>Активен</th><th><span class="vh">Действия</span></th></tr></thead><tbody>' +
      L.map((u) => '<tr data-u="' + esc(u.id) + '"' + (u.active ? "" : ' class="off"') + '><td data-main><span class="sf-u"><span class="sa-av' + (u.active ? "" : " off") + '" aria-hidden="true">' + esc(initials(u.name)) + "</span><span><b>" + esc(u.name) + (u.self ? '<span class="me">вие</span>' : "") + "</b><code>" + esc(u.username) + '</code><small class="rl2">' + esc(roleName(u.role)) + "</small></span></span></td>" +
        '<td class="c-rl" data-label="Роля">' + esc(roleName(u.role)) + '</td><td data-label="ПИН">' + pinCell(u) + '</td><td data-label="Последен вход">' + (u.lastLoginAt ? esc(whenShort(u.lastLoginAt)) : "никога") + "</td>" +
        '<td data-label="Активен"><label class="sa-switch"><input type="checkbox" role="switch" data-act="' + esc(u.id) + '" aria-label="Активен: ' + esc(u.name) + '"' + (u.active ? " checked" : "") + (!u.canManage ? " disabled" : "") + '><span class="tr"></span></label></td>' +
        '<td data-label="Действия"><span class="sf-acts">' + (canOpen(u) ? '<button class="pill pill-line sf-man" type="button" data-man="' + esc(u.id) + '" aria-label="Управлявай: ' + esc(u.name) + '">' + ic("sliders-horizontal", 18) + "Управлявай</button>"
          : '<span class="muted" style="font-size:15px">' + (u.role === "admin" ? "Само главният админ" : "Само по-висока роля") + "</span>") + "</span></td></tr>").join("") + "</tbody></table></div>");
    if (A.scroller) A.scroller.scrollTop = y;
  }
  async function reload() { if (await load()) draw(); }

  /* ---------- sheets ---------- */
  function manage(u: StaffRow) {
    const pin = PIN_ROLES.includes(u.role) && u.canManage;
    const s = sheet({ title: u.name, html: '<p class="muted" style="margin:0 0 12px">' + esc(roleName(u.role)) + " · " + esc(u.username) + '</p><div class="sf-mlist">' +
      '<button class="pill pill-line pill-lg pill-block" type="button" data-pw>' + ic("lock", 20) + "Смени паролата</button>" +
      (pin ? '<button class="pill pill-line pill-lg pill-block" type="button" data-pin>' + ic("dots-nine", 20) + (u.pin === "set" ? "Смени ПИН" : "Задай ПИН") + "</button>" : "") +
      (u.canManage ? '<button class="pill pill-line pill-lg pill-block" type="button" data-edit>' + ic("pencil-simple", 20) + "Име и роля</button>" : "") + "</div>" });
    s.body.addEventListener("click", (e) => {
      const t = e.target as Element;
      if (t.closest("[data-pw]")) { s.close(); setTimeout(() => setPw(u), 60); }
      else if (t.closest("[data-pin]")) { s.close(); setTimeout(() => setPin(u), 60); }
      else if (t.closest("[data-edit]")) { s.close(); setTimeout(() => editUser(u), 60); }
    });
  }
  const pwFields = (pre: string) => '<div class="field"><label for="' + pre + '1">Нова парола</label><div class="pw"><input class="input" id="' + pre + '1" type="password" autocomplete="new-password" aria-describedby="' + pre + 'h"><button class="pill pill-soft show" type="button" data-showpw="' + pre + '1">Покажи</button></div><div class="meter" aria-hidden="true" data-meter><i></i><i></i><i></i><i></i></div><span class="help" id="' + pre + 'h">Поне 10 знака. Най-добре 3-4 думи или генерирана.</span></div>' +
    '<div class="field"><label for="' + pre + '2">Повторете паролата</label><input class="input" id="' + pre + '2" type="password" autocomplete="new-password"></div>' +
    '<button class="pill pill-soft" type="button" data-gen>' + ic("sparkle", 18) + "Генерирай парола</button><div data-genout></div>";
  function bindPw(B: HTMLElement, pre: string): () => string | null {
    const a = B.querySelector<HTMLInputElement>("#" + pre + "1")!, b = B.querySelector<HTMLInputElement>("#" + pre + "2")!, m = B.querySelector<HTMLElement>("[data-meter]")!;
    a.addEventListener("input", () => { m.className = "meter s" + (a.value ? strength(a.value) : 0); });
    B.addEventListener("click", (e) => {
      const t = (e.target as Element).closest<HTMLElement>("[data-showpw]");
      if (t) { const sh = a.type === "password"; a.type = sh ? "text" : "password"; b.type = a.type; t.textContent = sh ? "Скрий" : "Покажи"; return; }
      if ((e.target as Element).closest("[data-gen]")) {
        const p = genPw(); a.value = p; b.value = p; a.dispatchEvent(new Event("input")); fieldErr(a, ""); fieldErr(b, "");
        B.querySelector("[data-genout]")!.innerHTML = '<div class="genpw"><code>' + esc(p) + '</code><button class="pill pill-soft" type="button" data-cp>' + ic("copy", 18) + 'Копирай</button></div><p class="sf-note" style="margin-top:8px">' + ic("info", 18) + "<span>Дайте я на човека лично. След запис не се вижда повече.</span></p>";
        B.querySelector<HTMLButtonElement>("[data-cp]")!.onclick = () => { if (navigator.clipboard) navigator.clipboard.writeText(p).then(() => toast("Паролата е копирана"), () => toast("Не успяхме да копираме; препишете я.")); };
      }
    });
    return () => {
      fieldErr(a, ""); fieldErr(b, "");
      if (a.value.length < 10) { fieldErr(a, "Паролата трябва да е поне 10 знака."); a.focus(); return null; }
      if (a.value !== b.value) { fieldErr(b, "Двете пароли не съвпадат."); b.focus(); return null; }
      return a.value;
    };
  }
  /** the new PIN, shown once in the open sheet */
  function showPinOnce(title: string, name: string, pin: string, appRole: string) {
    const s = sheet({ title, html: '<div class="pin-once" data-edit-id="admin.staff.pin"><p>Новият ПИН на ' + esc(name) + "</p><b data-pin-once>" + esc(pin) + "</b><p>Кажете го лично. Показва се само сега; после се вижда само „••••“.</p></div>" +
      '<p class="sf-note" style="margin-top:12px">' + ic("info", 18) + "<span>С него " + esc(name) + " влиза в приложението " + (APP_OF[appRole] || "") + " на общото устройство.</span></p>",
      foot: '<button class="pill pill-ink pill-lg pill-block" type="button" data-ok>' + ic("check", 22) + "Готово, запомних го</button>" });
    s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!.onclick = s.close;
  }

  function newUser() {
    const roles = ROLES.filter((r) => r.manageable);
    if (!roles.length) { toast("Нямате роля, която можете да давате."); return; }
    let pinMode: "random" | "own" | "later" = "random";
    const s = sheet({ title: "Нов потребител", focus: "#nu-u", html: '<div class="form">' +
      '<div class="field"><label for="nu-u">Потребител</label><input class="input" id="nu-u" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="например waiter4" aria-describedby="nu-uh"><span class="help" id="nu-uh">Латиница, цифри, точка, тире; от 3 до 32 знака.</span></div>' +
      '<div class="field"><label for="nu-n">Име</label><input class="input" id="nu-n" autocomplete="off" placeholder="например Сервитьор 4"></div>' +
      '<div class="field"><label for="nu-r">Роля</label><select class="input" id="nu-r" aria-describedby="nu-rd">' + roles.map((r) => '<option value="' + r.id + '"' + (r.id === "waiter" ? " selected" : "") + ">" + esc(r.n) + "</option>").join("") + '</select><span class="help" id="nu-rd" data-rdesc></span></div>' +
      pwFields("nu-p") +
      '<div class="field" data-pinf><span class="label" id="nu-pml">ПИН за приложението</span><div class="sf-pinmode" role="group" aria-labelledby="nu-pml"><button type="button" data-pm="random" aria-pressed="true">Случаен</button><button type="button" data-pm="own" aria-pressed="false">Мой</button><button type="button" data-pm="later" aria-pressed="false">По-късно</button></div>' +
        '<span class="help" data-pmh>Системата избира свободен ПИН и го показва веднъж след „Създай“.</span></div>' +
      '<div class="field" data-pinown hidden><label for="nu-pin">Личен ПИН</label><input class="input pinin" id="nu-pin" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="····"><span class="help">4 цифри, не лесни (1111, 1234).</span></div></div>',
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Създай</button>" });
    const B = s.body, getPw = bindPw(B, "nu-p"), rsel = B.querySelector<HTMLSelectElement>("#nu-r")!, pinIn = B.querySelector<HTMLInputElement>("#nu-pin")!;
    const syncRole = () => { const r = role(rsel.value); B.querySelector("[data-rdesc]")!.textContent = r.desc; const p = PIN_ROLES.includes(r.id); B.querySelector<HTMLElement>("[data-pinf]")!.hidden = !p; B.querySelector<HTMLElement>("[data-pinown]")!.hidden = !p || pinMode !== "own"; };
    rsel.addEventListener("change", syncRole); syncRole();
    pinIn.addEventListener("input", () => { pinIn.value = pinIn.value.replace(/\D/g, "").slice(0, 4); fieldErr(pinIn, ""); });
    B.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("[data-pm]"); if (!b) return;
      pinMode = b.dataset.pm as typeof pinMode;
      B.querySelectorAll<HTMLElement>("[data-pm]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      B.querySelector("[data-pmh]")!.textContent = pinMode === "random" ? "Системата избира свободен ПИН и го показва веднъж след „Създай“." : pinMode === "own" ? "Напишете 4 цифри. Показва се само сега." : "Без ПИН засега; задава се после от „Управлявай“.";
      syncRole(); if (pinMode === "own") pinIn.focus();
    });
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const ok = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    ok.onclick = async () => {
      const un = B.querySelector<HTMLInputElement>("#nu-u")!, nm = B.querySelector<HTMLInputElement>("#nu-n")!, v = un.value.trim().toLowerCase();
      let bad = false; fieldErr(un, ""); fieldErr(nm, ""); fieldErr(pinIn, "");
      if (!/^[a-z0-9._-]{3,32}$/.test(v)) { fieldErr(un, "Латиница, цифри, точка или тире; от 3 до 32 знака."); bad = true; }
      else if (U.some((u) => u.username === v)) { fieldErr(un, "Този потребител вече съществува."); bad = true; }
      if (!nm.value.trim()) { fieldErr(nm, "Напишете име."); bad = true; }
      const pinRole = PIN_ROLES.includes(rsel.value);
      if (pinRole && pinMode === "own" && !/^\d{4}$/.test(pinIn.value)) { fieldErr(pinIn, "ПИН-ът е от 4 цифри."); bad = true; }
      if (bad) { (B.querySelector<HTMLElement>('[aria-invalid="true"]') || un).focus(); return; }
      const pw = getPw(); if (!pw) return;
      ok.disabled = true;
      try {
        const r = await staffAdminApi.create({ username: v, name: nm.value.trim(), role: rsel.value as RoleId, password: pw, pin: !pinRole || pinMode === "later" ? null : pinMode === "own" ? pinIn.value : "" });
        s.close(); flt = "on"; writeHash({}); await reload();
        if (r.pin_once) showPinOnce("ПИН за " + r.name, r.name, r.pin_once, r.role);
        toast("Създаден: " + r.name + ". Дайте му паролата лично.");
      } catch (e) {
        ok.disabled = false;
        const f = e instanceof ApiError ? e.fields || {} : {};
        const map: Record<string, HTMLElement> = { username: un, name: nm, role: rsel, password: B.querySelector<HTMLInputElement>("#nu-p1")!, pin: pinIn };
        let any = false; Object.keys(f).forEach((k) => { if (map[k]) { fieldErr(map[k], f[k]); any = true; } });
        if (f.pin && pinMode !== "own") toast(f.pin);
        if (any) (B.querySelector<HTMLElement>('[aria-invalid="true"]') || un).focus(); else toast(errText(e, "Не успяхме да създадем потребителя."));
      }
    };
  }
  function setPw(u: StaffRow) {
    const s = sheet({ title: "Нова парола: " + u.name, focus: "#pw-p1", html: '<div class="form"><p class="sf-note">' + ic("lock", 18) + "<span>Старата парола спира да работи веднага и " + (u.self ? "другите ви сесии се затварят." : esc(u.name) + " трябва да влезе отново.") + " Паролата се пази само като хеш.</span></p>" + pwFields("pw-p") + "</div>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Смени паролата</button>" });
    const getPw = bindPw(s.body, "pw-p"); s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const ok = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    ok.onclick = async () => {
      const pw = getPw(); if (!pw) return; ok.disabled = true;
      try { await staffAdminApi.setPassword(u.id, pw); s.close(); toast("Паролата на " + u.name + " е сменена"); }
      catch (e) { ok.disabled = false; const f = e instanceof ApiError && e.fields && e.fields.password; if (f) fieldErr(s.body.querySelector<HTMLElement>("#pw-p1")!, f); else toast(errText(e, "Не успяхме да сменим паролата.")); }
    };
  }
  function setPin(u: StaffRow) {
    const s = sheet({ title: (u.pin === "set" ? "Смени ПИН: " : "ПИН за ") + u.name, focus: "#pn", html: '<div class="form"><p class="sf-note">' + ic("info", 18) + "<span>С личния ПИН " + esc(u.name) + " влиза в приложението " + (APP_OF[u.role] || "") + " на общото устройство. Кажете му го лично.</span></p>" +
      '<div class="field"><label for="pn">Нов ПИН</label><input class="input pinin" id="pn" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="····" aria-describedby="pnh"><span class="help" id="pnh">4 цифри. Оставете празно и системата избира случаен свободен ПИН.</span></div>' +
      '<button class="pill pill-soft" type="button" data-rnd>' + ic("sparkle", 18) + "Случаен ПИН</button></div>",
      foot: (u.pin === "set" ? '<button class="pill pill-line pill-lg" type="button" data-rm>Махни ПИН</button>' : '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button>') + '<button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Запази ПИН</button>" });
    const inp = s.body.querySelector<HTMLInputElement>("#pn")!, ok = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    inp.addEventListener("input", () => { inp.value = inp.value.replace(/\D/g, "").slice(0, 4); fieldErr(inp, ""); });
    const x = s.foot!.querySelector<HTMLButtonElement>("[data-x]"); if (x) x.onclick = s.close;
    const rm = s.foot!.querySelector<HTMLButtonElement>("[data-rm]");
    if (rm) rm.onclick = async () => { try { await staffAdminApi.removePin(u.id); s.close(); await reload(); toast("ПИН-ът на " + u.name + " е махнат"); } catch (e) { toast(errText(e, "Не успяхме да махнем ПИН-а.")); } };
    const save = async (pin?: string) => {
      if (pin && !/^\d{4}$/.test(pin)) { fieldErr(inp, "ПИН-ът е от 4 цифри."); inp.focus(); return; }
      ok.disabled = true;
      try {
        const had = u.pin === "set", r = await staffAdminApi.setPin(u.id, pin || undefined);
        s.close(); await reload();
        showPinOnce((had ? "Сменен ПИН: " : "ПИН за ") + u.name, u.name, r.pin, u.role);
      } catch (e) {
        ok.disabled = false;
        const f = e instanceof ApiError && e.fields && e.fields.pin;
        if (f || (e instanceof ApiError && e.status === 429)) { fieldErr(inp, f || (e as ApiError).message); inp.focus(); } else toast(errText(e, "Не успяхме да запазим ПИН-а."));
      }
    };
    ok.onclick = () => save(inp.value);
    s.body.querySelector<HTMLButtonElement>("[data-rnd]")!.onclick = () => save();
  }
  function editUser(u: StaffRow) {
    const roles = ROLES.filter((r) => r.manageable || r.id === u.role);
    const s = sheet({ title: "Роля и име: " + u.name, focus: "#eu-n", html: '<div class="form"><div class="field"><label for="eu-n">Име</label><input class="input" id="eu-n" value="' + esc(u.name) + '"></div>' +
      '<div class="field"><label for="eu-r">Роля</label><select class="input" id="eu-r" aria-describedby="eu-rd">' + roles.map((r) => '<option value="' + r.id + '"' + (r.id === u.role ? " selected" : "") + ">" + esc(r.n) + "</option>").join("") + '</select><span class="help" id="eu-rd" data-rd></span></div>' +
      '<p class="sf-note">' + ic("info", 18) + "<span>Смяната на ролята затваря сесиите на човека. Какво вижда всяка роля се променя в „<a href=\"" + aurl.section("roles") + '">Роли и права</a>“.</span></p></div>',
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + "Запази</button>" });
    const sel = s.body.querySelector<HTMLSelectElement>("#eu-r")!, d = () => { s.body.querySelector("[data-rd]")!.textContent = role(sel.value).desc; }; sel.addEventListener("change", d); d();
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const ok = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    ok.onclick = async () => {
      const nm = s.body.querySelector<HTMLInputElement>("#eu-n")!; fieldErr(nm, "");
      if (!nm.value.trim()) { fieldErr(nm, "Напишете име."); nm.focus(); return; }
      const was = { name: u.name, role: u.role }, next = { name: nm.value.trim(), role: sel.value as RoleId };
      if (was.name === next.name && was.role === next.role) { s.close(); return; }
      ok.disabled = true;
      try {
        await staffAdminApi.update(u.id, next); s.close(); await reload();
        toast("Запазено: " + next.name, { undo: async () => { try { await staffAdminApi.update(u.id, was); await reload(); toast("Върнато: " + was.name); } catch (e) { toast(errText(e, "Не успяхме да върнем промяната.")); } } });
      } catch (e) { ok.disabled = false; const f = e instanceof ApiError ? e.fields || {} : {}; if (f.name) fieldErr(nm, f.name); else toast(errText(e, "Не успяхме да запазим.")); }
    };
  }
  async function setActive(u: StaffRow, on: boolean, undo = true) {
    try { await staffAdminApi.setActive(u.id, on); } catch (e) { await reload(); toast(errText(e, "Не успяхме да сменим.")); return; }
    await reload();
    if (!undo) return;
    toast(on ? u.name + " е активен отново" : u.name + " е деактивиран", { undo: () => setActive(u, !on, false).then(() => toast(on ? "Активирането е отменено" : "Деактивирането е отменено")) });
  }

  /* ---------- events ---------- */
  document.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-new]") && loaded) newUser(); });
  root.addEventListener("click", async (e) => {
    const t = e.target as Element; let el: HTMLElement | null;
    if (t.closest('[data-sa="retry"]')) { e.stopPropagation(); root.innerHTML = skel(6, "Зареждаме персонала …"); await reload(); return; }
    if ((el = t.closest<HTMLElement>("[data-man]"))) { manage(byId(el.dataset.man!)); return; }
    if ((el = t.closest<HTMLElement>(".sf-bar [data-f]"))) { flt = el.dataset.f!; writeHash({ f: flt === "on" ? "" : flt }); draw(); root.querySelector<HTMLElement>('.sf-bar [data-f="' + flt + '"]')?.focus({ preventScroll: true }); }
  });
  root.addEventListener("keydown", (e) => {
    const b = (e.target as Element).closest<HTMLElement>(".sf-bar [data-f]"); if (!b || (e.key !== "ArrowRight" && e.key !== "ArrowLeft")) return; e.preventDefault();
    const L = ["on", "off", "all"]; flt = L[(L.indexOf(b.dataset.f!) + (e.key === "ArrowRight" ? 1 : 2)) % 3]; writeHash({ f: flt === "on" ? "" : flt }); draw(); root.querySelector<HTMLElement>('.sf-bar [data-f="' + flt + '"]')?.focus();
  });
  root.addEventListener("change", (e) => {
    const t = (e.target as Element).closest<HTMLInputElement>("[data-act]"); if (!t) return;
    const u = byId(t.dataset.act!), on = t.checked;
    if (on) { setActive(u, true); return; }
    t.checked = true;
    confirm({ title: "Да деактивираме " + u.name + "?", text: "Не може да влиза в панела и в приложенията; отворените сесии се затварят. Историята в дневника остава. Може да го активирате отново.", ok: "Деактивирай", danger: true }, () => setActive(u, false));
  });
  root.addEventListener("input", (e) => {
    const i = e.target as HTMLInputElement; if (i.id !== "sf-q") return;
    q = i.value; const pos = i.selectionStart; draw(); const n = root.querySelector<HTMLInputElement>("#sf-q"); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* ignore */ } }
  });

  root.innerHTML = skel(6, "Зареждаме персонала …");
  await reload();
}
