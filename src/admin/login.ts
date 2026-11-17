/* /admin/vhod/: the sign-in (design/pages-admin/login.html, version 4). The markup is rendered by the page; this wires it.
   - One message for a wrong user and a wrong password, under the form, with the focus there: "Грешен потребител или парола."
   - The last 3 attempts: "Остават N опита, после входът се заключва за 15 минути." (ApiError.left from the core).
   - Locked (429 with retryIn): "Твърде много опити. Опитайте след 15 минути." and the button counts down by retryIn.
   - After sign-in by `home`: "app:waiter|kitchen|driver" -> the module of the staff. Everyone else: #next= wins, but only
     to an address the role may open (a section it sees, or a module it may enter; anything else is ignored); then the
     manager and the owner get "Къде продължаваш?" (their module or the admin), unless the choice is remembered on this
     device (src/modules/boss/home.ts, "sa-home"); the others go to the dashboard.
   - "Къде продължаваш?" (design/pages-admin/login.html, step 5): two big cards, on the phone the module first and main,
     "Запомни избора на това устройство" (a setting of the device, never of the server); the owner also gets "Смяната
     сега: екранът на управителя". /admin/vhod/#st=choose opens it again for a signed-in manager or owner.
   - Already signed in: "Вече сте влезли като ..." with "Към таблото" (or "Към приложението"; the manager and the owner both). */
import "sc-icons:warning,warning-circle,lock,sign-in,arrow-clockwise,check-circle,eye,arrow-right,briefcase,chart-bar,squares-four,check,sign-out";
import { ic } from "../lib/icons.ts";
import { esc, plural } from "../lib/format.ts";
import { staffApi, ApiError, type Me } from "../client/api-admin.ts";
import { aurl } from "./routes.ts";
import { banner, nameRole, roleName, logout, APPS } from "./a.ts";
import { homeChoice, setHomeChoice, switchHome, bossModuleOf, bossHref, mayOpen, type HomeChoice } from "../modules/boss/home.ts";

const MAX_LEFT_SHOWN = 3;

export function initLogin(): void {
  const d = document.querySelector<HTMLElement>(".lg")!;
  const f = d.querySelector<HTMLFormElement>("form")!, u = d.querySelector<HTMLInputElement>("#u")!, p = d.querySelector<HTMLInputElement>("#p")!;
  const err = d.querySelector<HTMLElement>("[data-err]")!, go = d.querySelector<HTMLButtonElement>("[data-go]")!, pre = d.querySelector<HTMLElement>("[data-pre]")!;
  const hashNext = /(?:^|&)next=([^&]*)/.exec(location.hash.slice(1));
  const next = hashNext ? decodeURIComponent(hashNext[1]) : "";
  let until = 0, timer: ReturnType<typeof setInterval> | undefined, busy = false;

  const goLabel = () => ic("sign-in", 22) + "Влез";
  function showErr(title: string, text: string, focus: boolean, kind = "") {
    err.hidden = false; err.className = "lg-err"; err.setAttribute("role", "alert"); err.dataset.k = kind;
    err.innerHTML = ic("warning", 22) + "<div><b>" + esc(title) + "</b>" + (text ? "<span>" + text + "</span>" : "") + "</div>";
    if (focus) err.focus({ preventScroll: false });
  }
  const locked = () => until > Date.now();
  function lockUI() {
    if (!locked()) {
      until = 0; go.disabled = false; go.innerHTML = goLabel(); clearInterval(timer); timer = undefined;
      if (!err.hidden && err.dataset.k === "lock") err.hidden = true;
      return;
    }
    const s = Math.ceil((until - Date.now()) / 1000), mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, "0");
    go.disabled = true; go.innerHTML = ic("lock", 22) + "Заключено · " + mm + ":" + ss;
    const cd = err.querySelector(".cd");
    if (err.dataset.k === "lock" && cd && !err.hidden) cd.textContent = mm + ":" + ss;
    else showErr("Твърде много опити. Опитайте след 15 минути.", 'Остават <span class="cd">' + mm + ":" + ss + "</span>.", false, "lock");
  }
  function lock(seconds: number) {
    until = Date.now() + Math.max(1, seconds) * 1000; lockUI();
    clearInterval(timer); timer = setInterval(lockUI, 1000);
    err.focus({ preventScroll: false });
  }
  const offlineBanner = () => banner({ tone: "warn", icon: "warning-circle", title: "Няма връзка с интернет", text: "Проверете връзката и опитайте пак.", action: '<button class="pill pill-line" type="button" data-retry>' + ic("arrow-clockwise", 20) + "Опитай пак</button>" });
  function showOffline(on: boolean) {
    const box = pre.querySelector("[data-off]");
    if (on && !box) { pre.insertAdjacentHTML("afterbegin", '<div class="lg-off" data-off>' + offlineBanner() + "</div>"); }
    if (!on && box) box.remove();
  }
  if (navigator.onLine === false) showOffline(true);
  window.addEventListener("offline", () => showOffline(true));
  window.addEventListener("online", () => showOffline(false));
  pre.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-retry]")) { if (navigator.onLine !== false) showOffline(false); else location.reload(); } });

  /* ---------- "Къде продължаваш?" (the manager and the owner) ---------- */
  const CH: Record<string, { app: [string, string]; ic: string; also: boolean }> = {
    manager: { app: ["Смяната", "Бързият екран за деня"], ic: "briefcase", also: false },
    owner: { app: ["Собственик", "Оборот и решения"], ic: "chart-bar", also: true },
  };
  function chooseHTML(me: Me): string {
    const r = me.user.role, c = CH[r], mod = bossModuleOf(r)!, had = homeChoice(me.user.username);
    const REM = '<span class="rem sa-tag">' + ic("check", 16) + "Запомнено</span>";
    const card = (pick: HomeChoice, main: boolean, href: string, icon: string, t: string, sub: string) =>
      '<a class="ch-card' + (main ? " main" : "") + '" href="' + href + '" data-pick="' + pick + '"><span class="si">' + ic(icon, 28) + '</span><span class="tx"><b>' + esc(t) + "</b><small>" + esc(sub) + '</small></span><span class="arr">' + ic("arrow-right", 22) + "</span>" + (had === pick ? REM : "") + "</a>";
    return '<div class="ch" data-edit-id="admin.login.choose"><div><h1 id="ch-h" tabindex="-1">Къде продължаваш?</h1><p class="lead muted">Влезе като ' + esc(nameRole(me.user.name, r)) + ".</p></div>" +
      '<div class="ch-cards">' + card("app", true, bossHref(mod), c.ic, c.app[0], c.app[1]) + card("admin", false, aurl.home(), "squares-four", "Админ панел", "Пълната работа") + "</div>" +
      (c.also ? '<a class="ch-also" href="' + bossHref("upravitel") + '">' + ic("briefcase", 22) + "Смяната сега: екранът на управителя</a>" : "") +
      '<div class="ch-rem"><label class="sa-check"><input type="checkbox" id="ch-rem"' + (had ? " checked" : "") + '><span class="bx">' + ic("check", 18) + '</span></label><label class="tx" for="ch-rem">Запомни избора на това устройство<small>Следващия път входът те води направо там. Смяна: от профила, „Към админа“ или „Към приложението“.</small></label></div>' +
      '<div class="ch-foot"><p>Не си ' + esc(me.user.name) + '?</p><button class="pill pill-line" type="button" data-out>' + ic("sign-out", 20) + "Изход</button></div></div>";
  }
  function showChoose(me: Me) {
    const box = d.querySelector<HTMLElement>(".lg-box")!;
    box.classList.add("wide"); box.querySelector(".lg-in-as")?.remove(); box.querySelector(".ch")?.remove();
    /* the form stays in the page (hidden): the card replaces it */
    box.querySelectorAll<HTMLElement>(":scope > h1, :scope > .lead, :scope > form").forEach((el) => { el.hidden = true; });
    pre.insertAdjacentHTML("afterend", chooseHTML(me));
    document.title = "Къде продължаваш? | Siracusa · Админ";
    try { history.replaceState(history.state, "", location.pathname + location.search + "#st=choose"); } catch { /* old browser */ }
    const ch = box.querySelector<HTMLElement>(".ch")!;
    ch.addEventListener("click", (e) => {
      const c = (e.target as Element).closest<HTMLElement>("[data-pick]");
      /* remembered only with the tick; without it an older choice is forgotten (the person asked to be asked) */
      if (c) { setHomeChoice(me.user.username, ch.querySelector<HTMLInputElement>("#ch-rem")!.checked ? (c.dataset.pick as HomeChoice) : null); return; }
      if ((e.target as Element).closest("[data-out]")) logout();
    });
    ch.querySelector<HTMLElement>("#ch-h")!.focus({ preventScroll: false });
  }

  /** where to go after sign-in: the module of a staff role; #next= when the role may open it; the manager and the owner
      choose (or go where they chose on this device); everyone else to the dashboard */
  async function after(home: string) {
    if (home.startsWith("app:")) { location.href = aurl.app(home.slice(4)); return; }
    let me: Me | null = null;
    try { me = await staffApi.me(); } catch { /* the dashboard */ }
    if (me && next && mayOpen(next, me.user.role, me.sections)) { location.href = aurl.fromLogical(next)!; return; }
    const mod = me ? bossModuleOf(me.user.role) : null;
    if (me && mod) {
      const c = homeChoice(me.user.username);
      if (c) { location.href = c === "app" ? bossHref(mod) : aurl.home(); return; }
      busy = false; showChoose(me); return;
    }
    location.href = aurl.home();
  }

  /* already signed in: say who, and the way back; the manager and the owner may open "Къде продължаваш?" again (#st=choose) */
  staffApi.me().then((me) => {
    if (!me || d.querySelector(".ch")) return;
    const role = me.user.role, app = APPS.includes(role), mod = bossModuleOf(role);
    const asked = () => /(?:^|&)st=choose(?:&|$)/.test(location.hash.slice(1));
    /* "Смени" from another page, or the address typed on this one */
    if (mod) window.addEventListener("hashchange", () => { if (asked() && !d.querySelector(".ch")) showChoose(me); });
    if (mod && asked()) { showChoose(me); return; }
    /* two buttons (the manager and the owner) go under the text, so they fit at 360 */
    const acts = mod ? '<a class="pill pill-ink" href="' + bossHref(mod) + '" data-home="app">Към приложението</a><a class="pill pill-line" href="' + aurl.home() + '" data-home="admin">Към таблото</a>'
      : '<a class="pill pill-ink" href="' + (app ? aurl.app(role) : aurl.home()) + '">' + (app ? "Към приложението" : "Към таблото") + "</a>";
    pre.insertAdjacentHTML("beforeend", '<div class="lg-in-as">' + banner({ tone: "ok", icon: "check-circle", title: "Вече сте влезли като " + nameRole(me.user.name, role) + ".", text: mod ? '<span class="lg-acts">' + acts + "</span>" : "", action: mod ? "" : acts }) + "</div>");
    /* a remembered choice follows where the person goes */
    pre.addEventListener("click", (e) => { const a = (e.target as Element).closest<HTMLElement>("a[data-home]"); if (a) switchHome(me.user.username, a.dataset.home as HomeChoice); });
  }).catch(() => { /* no connection: the sign-in says so on submit */ });

  d.querySelector<HTMLButtonElement>("[data-show]")!.addEventListener("click", function () {
    const sh = p.type === "password"; p.type = sh ? "text" : "password"; this.setAttribute("aria-pressed", String(sh)); this.querySelector("span")!.textContent = sh ? "Скрий" : "Покажи";
  });
  f.addEventListener("submit", async (e) => {
    e.preventDefault(); if (locked() || busy) return;
    const user = u.value.trim().toLowerCase();
    if (!user || !p.value) { u.setAttribute("aria-invalid", "true"); p.setAttribute("aria-invalid", "true"); showErr("Грешен потребител или парола.", "", true); return; }
    busy = true; go.disabled = true; go.innerHTML = '<span class="vh" role="status">Проверяваме</span>Проверяваме …';
    try {
      const r = await staffApi.login(user, p.value);
      await after(r.home);
    } catch (x) {
      busy = false; go.disabled = false; go.innerHTML = goLabel();
      if (x instanceof ApiError && x.code === "throttled") { p.value = ""; lock(x.retryIn || 15 * 60); return; }
      if (x instanceof ApiError && x.code === "offline") { showOffline(true); showErr("Няма връзка с интернет", "Проверете връзката и опитайте пак.", true); return; }
      if (x instanceof ApiError && (x.code === "bad_login" || x.status === 401)) {
        u.setAttribute("aria-invalid", "true"); p.setAttribute("aria-invalid", "true"); p.value = "";
        const left = typeof x.left === "number" && x.left <= MAX_LEFT_SHOWN ? x.left : 0;
        showErr("Грешен потребител или парола.", left ? "Остават " + plural(left, "опит", "опита") + ", после входът се заключва за 15 минути." : "", true);
        return;
      }
      showErr("Нещо се обърка.", esc(x instanceof Error ? x.message : "Опитайте пак след малко."), true);
      return;
    }
  });
  [u, p].forEach((i) => i.addEventListener("input", () => { u.removeAttribute("aria-invalid"); p.removeAttribute("aria-invalid"); if (!locked()) err.hidden = true; }));
  /* the first field gets the focus, unless the person is already typing somewhere */
  setTimeout(() => { if ((!document.activeElement || document.activeElement === document.body) && !u.value && !p.value) u.focus({ preventScroll: true }); }, 60);
}
