/* /admin/vhod/: the sign-in (design/pages-admin/login.html, version 4). The markup is rendered by the page; this wires it.
   - One message for a wrong user and a wrong password, under the form, with the focus there: "Грешен потребител или парола."
   - The last 3 attempts: "Остават N опита, после входът се заключва за 15 минути." (ApiError.left from the core).
   - Locked (429 with retryIn): "Твърде много опити. Опитайте след 15 минути." and the button counts down by retryIn.
   - After sign-in by `home`: "dashboard" -> #next= (a section the role sees) or /admin/; "app:waiter|kitchen|driver" -> the module.
   - Already signed in: "Вече сте влезли като ..." with "Към таблото" (or "Към приложението"). */
import "sc-icons:warning,warning-circle,lock,sign-in,arrow-clockwise,check-circle,eye";
import { ic } from "../lib/icons.ts";
import { esc, plural } from "../lib/format.ts";
import { staffApi, ApiError } from "../client/api-admin.ts";
import { aurl } from "./routes.ts";
import { banner, nameRole, APPS } from "./a.ts";

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

  /** where to go after sign-in: the module of a staff role; else #next= if the role sees that section, else the dashboard */
  async function after(home: string) {
    if (home.startsWith("app:")) { location.href = aurl.app(home.slice(4)); return; }
    let to = aurl.home();
    const href = aurl.fromLogical(next);
    if (href) {
      const key = aurl.keyOf(next);
      try { const me = await staffApi.me(); if (me && (me.user.role === "admin" || key === "dashboard" || key === "preview" || me.sections.includes(key))) to = href; } catch { /* the dashboard */ }
    }
    location.href = to;
  }

  /* already signed in: say who, and the way back */
  staffApi.me().then((me) => {
    if (!me) return;
    const app = APPS.includes(me.user.role);
    pre.insertAdjacentHTML("beforeend", '<div class="lg-in-as">' + banner({ tone: "ok", icon: "check-circle", title: "Вече сте влезли като " + nameRole(me.user.name, me.user.role) + ".", text: "",
      action: '<a class="pill pill-ink" href="' + (app ? aurl.app(me.user.role) : aurl.home()) + '">' + (app ? "Към приложението" : "Към таблото") + "</a>" }) + "</div>");
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
