/* Шофьор · Вход (/shofyor/vhod/; design/pages-shofyor/login.html): "Стъпка X от 3". 1 the sign-in (user and password,
   the staff sign-in of the admin; an error under each field; "Покажи" with aria-pressed); 2 the car (the most used one
   first and chosen; one tap changes it); 3 the km from the dashboard (checked by the core against the car's last one),
   the change taken from the restaurant ([ЛИПСВА: колко ресто се дава]) and the reminder "само в паркирано положение".
   "Назад" on the left of the bottom bar. A signed-in driver with an open shift goes straight to "Доставки"; signed in
   without a shift starts at step 2. */
import "sc-icons:car,caret-left,caret-right,eye,moped,sign-in,check";
import { mountStaff } from "../staff/frame.ts";
import { driverApi, ApiError, type DriverState } from "../../client/api-driver.ts";
import { http, pick, demoTok, setDemoTok } from "../../client/api.ts";
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";
import { murl } from "../routes.ts";
import { aurl } from "../../admin/routes.ts";

/** the staff sign-in (the same call as staffApi.login; kept here so the page does not load the admin's client) */
const login = pick(async (c, username: string, password: string) => { const r = await c.staff.login(username, password, "demo"); setDemoTok("staff", r.token); return { user: r.user, home: r.home }; },
  (username, password) => http<{ user: { role: string }; home: string }>("POST", "auth/login", { username, password }));
const readMe = pick(async (c) => c.staff.bySession(demoTok("staff")), () => http<{ user: { role: string } } | null>("GET", "auth/me"));
const kmText = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, " ");
const STAFF = ["waiter", "kitchen"];

export async function initVhod(): Promise<void> {
  const st = await mountStaff({ module: "driver", screen: "login", tab: null, title: "Вход", bare: true, bar: true });
  if (!st) return;
  const main = st.main, bar = st.bar!;
  let view: "login" | "car" | "km" = "login", S: DriverState | null = null, car = "", uv = "", kmv = "", flv = "", shown = false, busy = false;
  let errs: Record<string, string> = {};

  function stepper(i: number): string {
    const names = ["Вход", "Автомобил", "Километраж и ресто"];
    return '<div class="stepper" style="--n:3"><div class="bar">' + names.map((_, k) => '<span class="' + (k <= i ? "on" : "") + '"></span>').join("") + '</div><div class="t"><b>Стъпка ' + (i + 1) + " от 3</b><span>" + names[i] + "</span></div></div>";
  }
  const err = (k: string, id: string) => (errs[k] ? '<span class="err" id="' + id + '">' + esc(errs[k]) + "</span>" : "");
  const inv = (k: string, id: string, help?: string) => (errs[k] ? ' aria-invalid="true" aria-describedby="' + id + '"' : help ? ' aria-describedby="' + help + '"' : "");
  const carN = (id: string) => (S && S.cars.find((c) => c.id === id)?.n) || "";
  const back = (to: string) => '<button class="pill pill-line" type="button" data-go="' + to + '" style="flex:0 0 auto;background:var(--surface)">' + ic("caret-left", 22) + "Назад</button>";

  function render(focus?: string) {
    let h = '<div class="lg">';
    if (view === "login") {
      h += stepper(0) + '<div><h1 class="h1">Вход за шофьора</h1><p class="lead" style="margin-top:6px">Влез със своя потребител. Паролата ти дава управителят.</p></div>' +
        '<form class="stack" style="gap:16px" novalidate id="lf"><div class="field"><label for="u">Потребител</label><input class="input" id="u" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + esc(uv) + '" placeholder="например shofyor1"' + inv("u", "uerr") + ">" + err("u", "uerr") + "</div>" +
        '<div class="field"><label for="p">Парола</label><div class="pw"><input class="input" id="p" type="' + (shown ? "text" : "password") + '" autocomplete="current-password"' + inv("p", "perr") + '><button class="show" type="button" data-show aria-pressed="' + shown + '" aria-controls="p">' + ic("eye", 20) + "<span>" + (shown ? "Скрий" : "Покажи") + "</span></button></div>" + err("p", "perr") + "</div></form>" +
        '<p class="small muted" style="margin:0;text-align:center">Забравена парола? Управителят я сменя от админ панела.</p>';
      bar.innerHTML = '<button class="pill pill-red" type="submit" form="lf">' + ic("sign-in", 22) + "Влез</button>";
    } else if (view === "car") {
      const cars = S!.cars;
      h += stepper(1) + '<div><h1 class="h2">С коя кола караш днес?</h1><p class="lead" style="margin-top:6px">Отбелязаната стои по подразбиране. Смени само ако днес караш друга.</p></div>' +
        '<div class="cars" role="group" aria-label="Автомобил">' + cars.map((c) => '<button class="car" type="button" data-car="' + esc(c.id) + '" aria-pressed="' + (car === c.id) + '"' + (c.busyBy ? " disabled" : "") + '><span class="ii">' + ic("car", 24) + "</span><span><b>" + esc(c.n) + "</b><span>" +
          (c.busyBy ? "В смяната на " + esc(c.busyBy) + " · " : c.mostUsed ? "Най-често ползвана · " : "") + "рег. № " + (c.plate ? esc(c.plate) : '<span class="missing">[ЛИПСВА]</span>') + "</span></span></button>").join("") + "</div>" + err("car", "cerr") +
        '<p class="small muted" style="margin:0">Колите се въвеждат в админ панела <span class="missing">' + esc(S!.missing.cars) + "</span>. Ако смениш колата по време на смяната, записваме края на едната и началото на другата.</p>";
      bar.innerHTML = back("login") + '<button class="pill pill-red grow" type="button" data-go="km">С ' + esc(carN(car)) + ic("caret-right", 22) + "</button>";
    } else {
      const c = S!.cars.find((x) => x.id === car)!;
      h += stepper(2) + '<div><h1 class="h2">Километраж и ресто</h1><p class="lead" style="margin-top:6px">Препиши числото от таблото на ' + esc(c.n) + ". По него се смятат изминатите километри и разходът.</p></div>" +
        (errs.car ? '<div class="notice warn">' + esc(errs.car) + "</div>" : "") +
        '<div class="field bigf"><label for="kmnow">Километраж сега</label><div class="wrapi"><input class="input" id="kmnow" inputmode="numeric" autocomplete="off" placeholder="0" value="' + esc(kmv) + '"' + inv("km", "kerr", "khelp") + '><span class="u">км</span></div>' +
        (errs.km ? err("km", "kerr") : '<span class="help" id="khelp">' + (c.lastKm != null ? "Последно записан за тази кола: " + kmText(c.lastKm) + " км." : "За тази кола още няма записан километраж.") + "</span>") + "</div>" +
        '<div class="field bigf"><label for="fl">Ресто, което взимаш от ресторанта</label><div class="wrapi"><input class="input" id="fl" inputmode="decimal" autocomplete="off" placeholder="0,00" value="' + esc(flv) + '"' + (errs.float ? ' aria-invalid="true"' : "") + ' aria-describedby="' + (errs.float ? "ferr " : "") + 'flh"><span class="u">€</span></div>' + err("float", "ferr") +
        '<span class="help" id="flh">Брои се към парите за предаване в края на смяната. Колко ресто се дава: <span class="missing">' + esc(S!.missing.float) + "</span>.</span></div>" +
        '<div class="park">' + ic("car", 22) + "<span>Ползвай приложението само когато колата е паркирана. Навигацията работи в Google Maps или Waze.</span></div>";
      bar.innerHTML = back("car") + '<button class="pill pill-red grow" type="button" data-start>' + ic("moped", 22) + "Започни смяната</button>";
    }
    main.innerHTML = h + "</div>";
    if (focus) main.querySelector<HTMLElement>(focus)?.focus();
  }
  /** where a signed-in person goes: an open shift -> "Доставки", else the car */
  async function route(): Promise<boolean> {
    /* the session first (null without one: no 401 in the console of the sign-in) */
    if (!(await readMe())) return false;
    try { S = await driverApi.state(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) return false;
      if (e instanceof ApiError && e.status === 403) {
        const me = await readMe().catch(() => null);
        const r = me ? me.user.role : ""; location.replace(STAFF.includes(r) ? aurl.app(r) : aurl.home()); return true;
      }
      throw e;
    }
    if (S.shift) { location.replace(murl.shofyor()); return true; }
    car = (S.cars.find((c) => c.mostUsed && !c.busyBy) || S.cars.find((c) => !c.busyBy) || S.cars[0])?.id || "";
    view = "car"; errs = {}; render(); window.scrollTo(0, 0);
    return true;
  }
  try { if (!(await route())) render(); }
  catch (e) { render(); st.toast(e instanceof ApiError && e.message ? e.message : "Не успяхме да проверим входа. Опитай пак."); }
  st.synced();

  main.addEventListener("submit", async (e) => {
    e.preventDefault(); if (busy) return;
    const u = main.querySelector<HTMLInputElement>("#u")!, p = main.querySelector<HTMLInputElement>("#p")!;
    uv = u.value; errs = {};
    if (!u.value.trim()) errs.u = "Въведи потребител.";
    if (!p.value) errs.p = "Въведи парола.";
    if (errs.u || errs.p) { const pv = p.value; render(errs.u ? "#u" : "#p"); main.querySelector<HTMLInputElement>("#p")!.value = pv; return; }
    busy = true;
    const go = bar.querySelector<HTMLButtonElement>("button"); if (go) { go.disabled = true; go.textContent = "Проверяваме …"; }
    try {
      const r = await login(u.value.trim().toLowerCase(), p.value);
      if (r.home.startsWith("app:") && r.home !== "app:driver") { location.replace(aurl.app(r.home.slice(4))); return; }
      if (!(await route())) { errs.p = "Входът не се запази. Опитай пак."; render("#p"); }
    } catch (er) {
      const m = er instanceof ApiError ? er.message + (er.code === "bad_login" && (er as ApiError & { left?: number }).left ? " Остават " + (er as ApiError & { left?: number }).left + " опита." : "") : "Не успяхме. Опитай пак.";
      errs.p = m; render("#p");
    } finally { busy = false; }
  });
  main.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "kmnow") kmv = t.value; else if (t.id === "fl") flv = t.value; else if (t.id === "u") uv = t.value;
  });
  document.addEventListener("click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("button"); if (!b || busy) return;
    if (b.hasAttribute("data-show")) {
      const p = main.querySelector<HTMLInputElement>("#p")!; shown = p.type === "password"; p.type = shown ? "text" : "password";
      b.setAttribute("aria-pressed", String(shown)); b.querySelector("span")!.textContent = shown ? "Скрий" : "Покажи"; return;
    }
    if (b.dataset.car) { car = b.dataset.car; errs = {}; render('[data-car="' + car + '"]'); return; }
    if (b.dataset.go) { view = b.dataset.go as typeof view; errs = {}; render(); window.scrollTo(0, 0); return; }
    if (b.hasAttribute("data-start")) {
      busy = true; b.disabled = true; errs = {};
      try {
        await driverApi.start({ car, km: kmv, float: flv.trim() ? flv.trim() : null, nav: st.navApp() });
        location.href = murl.shofyor();
      } catch (er) {
        if (er instanceof ApiError && er.fields) { errs = er.fields; render(errs.km ? "#kmnow" : errs.float ? "#fl" : undefined); }
        else if (er instanceof ApiError && er.code === "shift_open") location.replace(murl.shofyor());
        else st.toast(er instanceof ApiError && er.message ? er.message : "Не успяхме. Опитай пак.");
      } finally { busy = false; const nb = bar.querySelector<HTMLButtonElement>("[data-start]"); if (nb) nb.disabled = false; }
    }
  });
}
