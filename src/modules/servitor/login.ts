/* Siracusa · "Вход и смяна" of the waiter (/servitor/vhod/; design/pages-servitor/login.html):
   - the personal PIN by default, ONLY on a known device (pinApi.people: a phone becomes known after a sign-in with the
     password on it): the person + 4 digits (the keyboard too), a wrong PIN said in role="status", the lockout of the core;
   - the password as the alternative, in this page (staffApi.login, the same as /admin/vhod/): an error under each field,
     no autofill, "Покажи / Скрий" with aria-pressed; an unknown phone starts here with one line why;
   - "#shift": "Моите маси днес" (shiftApi.start), then the hall (or #next=); "#end": the tables handed over (shiftApi.end)
     and the sign-out, back to the PIN.
   Kitchen and driver accounts go to their own app; the main admin, the owner and the manager to #next= or the dashboard. */
import "sc-icons:user,arrow-left,eye,lock,sign-in,sign-out,sparkle,bell-ringing,check-circle,warning,arrow-clockwise";
import { mountStaff, type Staff } from "../staff/frame.ts";
import { pinApi, shiftApi, floorApi, ApiError, type PinPeople, type ShiftMine, type HallLive } from "../../client/api-floor.ts";
import { staffApi, type Me } from "../../client/api-admin.ts";
import { aurl } from "../../admin/routes.ts";
import { ZONE, SHORT, STATE_ICON, plural, ms, dayText, sofiaDay, why, esc, ic, murl } from "./common.ts";

const lsGet = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
const STAFF_APP = ["kitchen", "driver"];

export async function mountLogin(): Promise<void> {
  const st = await mountStaff({ module: "waiter", screen: "login", title: "Вход", bare: true, tab: null });
  if (!st) return;
  const S: Staff = st, main = S.main;
  const hp = new URLSearchParams(location.hash.slice(1)), next = hp.get("next");
  let want: "shift" | "end" | null = hp.has("end") ? "end" : hp.has("shift") ? "shift" : null;
  let view: "pin" | "pass" | "shift" | "end" = "pin";
  let me: Me | null = null, people: PinPeople | null = null, who = lsGet<string>("sv-who", ""), pin = "", pinMsg = "", pinBad = false, lockUntil = 0, busy = false;
  let perr: { u?: string; p?: string } = {}, uVal = "", pVal = "", showPw = false;
  let mine: ShiftMine | null = null, hall: HallLive | null = null, picked: number[] = [], to = "";

  const go = () => { location.href = (next && aurl.fromLogical(next)) || murl.servitor(); };
  const setHash = (h: string) => { try { history.replaceState(null, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ } };
  function focusHead() { const h = main.querySelector<HTMLElement>("h1"); if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); } window.scrollTo(0, 0); }
  function fail(e: unknown) {
    main.innerHTML = S.error(e instanceof ApiError && e.code === "offline" ? "Няма връзка с ресторанта. Провери връзката и опитай пак." : why(e));
  }

  /* ---------- the views ---------- */
  const seg = () => '<div class="st-seg" role="group" aria-label="Начин на вход"><button type="button" data-v="pin" aria-pressed="' + (view === "pin") + '">Личен ПИН</button><button type="button" data-v="pass" aria-pressed="' + (view === "pass") + '">Парола</button></div>';
  function pinView(): string {
    const list = people ? people.people : [], known = !!people && people.known, locked = lockUntil > Date.now();
    if (!list.some((p) => p.id === who) && list.length) who = list[0].id;
    let h = '<div><h1 class="h1">Вход за персонала</h1><p class="lead" style="margin-top:6px">Личен 4-цифрен ПИН, който дава управителят.</p></div>' + seg();
    if (!known) return h + '<div class="notice">' + ic("lock", 22) + "<span>Първият вход на нов телефон е с парола. После тук влизаш с личния ПИН.</span></div>" +
      '<button class="pill pill-red pill-lg pill-block" type="button" data-v="pass">' + ic("sign-in", 22) + "Влез с парола</button>";
    if (!list.length) return h + '<div class="notice">' + ic("user", 22) + "<span>Още никой няма личен ПИН. Управителят го задава в „Персонал“. Дотогава влез с парола.</span></div>" +
      '<button class="pill pill-red pill-lg pill-block" type="button" data-v="pass">' + ic("sign-in", 22) + "Влез с парола</button>";
    h += '<div><p class="st-cap" id="l-who">Кой влиза?</p><div class="who" role="group" aria-labelledby="l-who">' + list.map((p) => '<button class="chip" type="button" data-who="' + esc(p.id) + '" aria-pressed="' + (who === p.id) + '">' + ic("user", 18) + esc(p.name) + "</button>").join("") +
      '</div><p class="small muted" style="margin:8px 0 0">Имената идват от „Персонал“ в админ панела. На личен телефон изборът се помни.</p></div>' +
      '<div class="dots' + (pinBad ? " bad" : "") + '" aria-hidden="true">' + [0, 1, 2, 3].map((i) => '<span class="' + (i < pin.length ? "on" : "") + '"></span>').join("") + "</div>" +
      '<p class="pinerr" role="status" aria-live="polite">' + (pinMsg ? esc(pinMsg) : '<span class="vh">Въведени ' + pin.length + " от 4 цифри</span>") + "</p>" +
      '<div class="pinpad">' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => '<button type="button" data-d="' + d + '"' + (locked || busy ? " disabled" : "") + ">" + d + "</button>").join("") +
      '<button class="fn" type="button" data-clear' + (locked ? " disabled" : "") + '>Изчисти</button><button type="button" data-d="0"' + (locked || busy ? " disabled" : "") + '>0</button><button class="fn" type="button" data-del aria-label="Изтрий последната цифра"' + (locked ? " disabled" : "") + ">" + ic("arrow-left", 24) + "</button></div>";
    return h;
  }
  function passView(): string {
    const fresh = !people || !people.known;
    return '<div><div class="row" style="gap:8px;flex-wrap:wrap"><h1 class="h1">Вход с парола</h1>' + (fresh ? "" : '<span class="prop">' + ic("sparkle", 14) + "Алтернатива</span>") + "</div>" +
      '<p class="lead" style="margin-top:6px">' + (fresh ? "Първият вход на нов телефон е с парола. После тук влизаш с личния ПИН." : "За личен телефон. Паролата дава управителят.") + "</p></div>" + seg() +
      '<form class="stack" style="gap:16px" novalidate><div class="field"><label for="u">Потребител</label><input class="input" id="u" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="например servitor1"' + (perr.u ? ' aria-invalid="true" aria-describedby="uerr"' : "") + ">" + (perr.u ? '<span class="err" id="uerr">' + esc(perr.u) + "</span>" : "") + "</div>" +
      '<div class="field"><label for="p">Парола</label><div class="pw"><input class="input" id="p" type="' + (showPw ? "text" : "password") + '" autocomplete="off"' + (perr.p ? ' aria-invalid="true" aria-describedby="perr"' : "") + '><button class="show" type="button" data-show aria-controls="p" aria-pressed="' + showPw + '">' + ic(showPw ? "lock" : "eye", 20) + (showPw ? "Скрий" : "Покажи") + "</button></div>" +
      (perr.p ? '<span class="err" id="perr">' + esc(perr.p) + "</span>" : "") + "</div>" +
      '<button class="pill pill-red pill-lg pill-block" type="submit"' + (busy ? ' aria-busy="true"' : "") + ">" + ic("sign-in", 22) + "Влез</button></form>" +
      '<p class="small muted" style="margin:0;text-align:center">Забравена парола? Управителят я сменя от админ панела.</p>';
  }
  function zonesText(): string {
    if (!mine) return "";
    return (["salon", "garden"] as const).map((z) => { const ns = mine!.tables.filter((t) => t.zone === z).map((t) => t.n); return ns.length ? ZONE[z] + ": " + (ns.length > 1 ? Math.min(...ns) + "-" + Math.max(...ns) : ns[0]) : ""; }).filter(Boolean).join(" · ");
  }
  function shiftView(): string {
    const m = mine!, since = m.shift ? S.clock(ms(m.shift.since)) : S.clock(Date.now());
    const zt = zonesText();
    return '<div class="hello"><span class="av">' + ic("user", 32) + '</span><div><h1 class="h2">Смяна · ' + esc(me ? me.user.name : "") + '</h1><p class="muted" style="margin:2px 0 0;font-weight:700">' + dayText(sofiaDay()) + " · от " + since + "</p></div></div>" +
      '<div><p class="st-cap" id="l-t">Моите маси днес</p>' + (m.tables.length ? '<div class="tchips" role="group" aria-labelledby="l-t">' + m.tables.map((t) => {
        const other = !!t.owner && !t.mine;
        return '<button class="chip" type="button" data-t="' + t.n + '" aria-pressed="' + picked.includes(t.n) + '"' + (other ? ' aria-disabled="true"' : "") + ' aria-label="Маса ' + t.n + ", " + ZONE[t.zone] + (other ? ", при " + esc(t.owner!.name) : "") + '">' + t.n + "</button>";
      }).join("") + "</div>" : '<div class="notice">' + ic("warning", 22) + "<span>Още няма маси. Управителят ги добавя в „Залата“ в админ панела.</span></div>") +
      '<p class="small muted" style="margin:10px 0 0">Избери своите маси за смяната. Управителят може да ги промени.' + (zt ? " " + zt + "." : "") + "</p></div>" +
      '<div class="notice">' + ic("bell-ringing", 22) + "<span>Повикванията от моите маси идват на телефона и на часовника. Повикванията от другите маси, които никой не е поел, също се виждат.</span></div>" +
      '<button class="pill pill-red pill-lg pill-block" type="button" data-start' + (picked.length && !busy ? "" : ' aria-disabled="true"') + ">" + (m.shift ? "Запази масите" : "Започни смяната") + " · " + plural(picked.length, "маса", "маси") + "</button>" +
      (m.shift ? '<a class="pill pill-line pill-lg pill-block" href="' + esc(murl.servitor()) + '">Към залата</a>' : "");
  }
  function endView(): string {
    const m = mine!;
    if (!m.shift) return '<div><h1 class="h1">Край на смяната</h1><p class="lead" style="margin-top:6px">Не си на смяна.</p></div>' +
      '<button class="pill pill-red pill-lg pill-block" type="button" data-out>' + ic("sign-out", 22) + "Излез</button>" +
      '<a class="pill pill-line pill-lg pill-block" href="' + esc(murl.servitor("vhod", "shift")) + '">Започни смяната</a>';
    const open = hall ? hall.tables.filter((t) => t.mine && t.state !== "free") : [];
    return '<div><h1 class="h1">Край на смяната</h1><p class="lead" style="margin-top:6px">На смяна от ' + S.clock(ms(m.shift.since)) + ". Отворените маси се предават, преди изход.</p></div>" +
      (open.length ? '<div class="stack">' + open.map((t) => '<div class="endrow"><div><b>Маса ' + t.n + "</b><span>" + ZONE[t.zone] + "</span></div>" + S.stt(t.state, t.state === "call" ? "Вика" : t.state === "ready" ? SHORT.ready : t.label, STATE_ICON[t.state]) + "</div>").join("") + "</div>" +
        '<div class="field"><label for="to">Предай масите на</label><select class="input" id="to">' + m.colleagues.map((c) => '<option value="' + esc(c.username) + '"' + (to === c.username ? " selected" : "") + ">" + esc(c.name) + "</option>").join("") + '<option value=""' + (to === "" && m.colleagues.length ? " selected" : "") + ">Управителя</option></select>" +
        (m.colleagues.length ? "" : '<span class="help">Няма друг сервитьор на смяна: управителят ги дава на колега.</span>') + "</div>"
        : '<div class="notice">' + ic("check-circle", 22) + "<span>Всички мои маси са затворени.</span></div>") +
      '<button class="pill pill-red pill-lg pill-block" type="button" data-end' + (busy ? ' aria-busy="true"' : "") + ">" + ic("sign-out", 22) + (open.length ? "Предай " + plural(open.length, "маса", "маси") + " и излез" : "Излез") + "</button>" +
      '<a class="pill pill-line pill-lg pill-block" href="' + esc(murl.servitor()) + '">Остани на смяна</a>';
  }
  function render(focus = false) {
    const h = view === "pin" ? pinView() : view === "pass" ? passView() : view === "shift" ? shiftView() : endView();
    main.innerHTML = '<div class="lg">' + h + "</div>";
    if (view === "pass") { const u = main.querySelector<HTMLInputElement>("#u")!, p = main.querySelector<HTMLInputElement>("#p")!; u.value = uVal; p.value = pVal; }
    document.title = (view === "shift" ? "Смяна" : view === "end" ? "Край на смяната" : "Вход") + " | Siracusa · Персонал";
    if (focus) focusHead();
  }

  /* ---------- the steps ---------- */
  async function start() {
    main.innerHTML = S.skeleton(3);
    try { me = await staffApi.me(); } catch (e) { if (!(e instanceof ApiError && e.status === 401)) { fail(e); return; } me = null; }
    if (me) { await signedIn(); return; }
    try { people = await pinApi.people("waiter"); } catch (e) { fail(e); return; }
    view = people.known && people.people.length ? "pin" : "pass";
    render(true);
  }
  /** a session: the role's place, else the shift (or the end of it) */
  async function signedIn() {
    const role = me!.user.role;
    if (STAFF_APP.includes(role)) { location.href = aurl.app(role); return; }
    if (role !== "waiter" && !me!.sections.includes("waiter") && role !== "admin" && role !== "owner" && role !== "manager") { location.href = aurl.home(); return; }
    main.innerHTML = S.skeleton(3);
    try { [mine, hall] = await Promise.all([shiftApi.mine(), want === "end" ? floorApi.hall() : Promise.resolve(null)]); }
    catch (e) { if (e instanceof ApiError && e.status === 401) { me = null; start(); return; } fail(e); return; }
    if (want === "end") { view = "end"; to = mine.colleagues[0] ? mine.colleagues[0].username : ""; setHash("end"); render(true); return; }
    if (mine.shift && want !== "shift") { go(); return; }
    const can = new Set(mine.tables.filter((t) => !t.owner || t.mine).map((t) => t.n));
    picked = mine.shift ? mine.shift.tables.map((t) => t.n) : lsGet<number[]>("sv-mine", []).filter((n) => can.has(n));
    view = "shift"; setHash("shift"); render(true);
  }
  async function submitPin() {
    if (!who) return;
    busy = true; render();
    try {
      await pinApi.login("waiter", pin, who);
      lsSet("sv-who", who);
      me = await staffApi.me();
      busy = false; pin = "";
      if (me) await signedIn(); else start();
      return;
    } catch (e) {
      pin = ""; pinBad = true;
      if (e instanceof ApiError && e.code === "unknown_device") { people = { ...(people as PinPeople), known: false }; pinBad = false; view = "pass"; }
      else if (e instanceof ApiError && e.code === "throttled") { lockUntil = Date.now() + (e.retryIn || 900) * 1000; pinMsg = e.message; setTimeout(() => { lockUntil = 0; pinMsg = ""; pinBad = false; if (view === "pin") render(); }, (e.retryIn || 900) * 1000); }
      else if (e instanceof ApiError && e.code === "bad_pin") pinMsg = e.message + (e.left ? " Остават " + plural(e.left, "опит", "опита") + "." : "");
      else pinMsg = why(e);
    }
    busy = false; render();
  }
  function digit(d: string) {
    if (view !== "pin" || busy || lockUntil > Date.now() || !people || !people.known || !people.people.length) return;
    pinBad = false; pinMsg = "";
    if (pin.length < 4) pin += d;
    render();
    if (pin.length === 4) setTimeout(submitPin, 150);
  }
  async function submitPass() {
    const u = main.querySelector<HTMLInputElement>("#u")!, p = main.querySelector<HTMLInputElement>("#p")!;
    uVal = u.value; pVal = p.value; perr = {};
    if (!uVal.trim()) perr.u = "Въведи потребител.";
    if (!pVal) perr.p = "Въведи парола.";
    if (perr.u || perr.p) { render(); main.querySelector<HTMLElement>(perr.u ? "#u" : "#p")!.focus(); return; }
    busy = true; render();
    try {
      const r = await staffApi.login(uVal.trim(), pVal);
      pVal = "";
      me = await staffApi.me();
      busy = false;
      if (!me) { perr.p = "Не успяхме да влезем. Опитай пак."; render(); return; }
      if (r.user.role !== "waiter" && !STAFF_APP.includes(r.user.role) && !want) { location.href = (next && aurl.fromLogical(next)) || aurl.home(); return; }
      await signedIn();
      return;
    } catch (e) {
      if (e instanceof ApiError && e.fields && (e.fields.username || e.fields.password)) { if (e.fields.username) perr.u = e.fields.username; if (e.fields.password) perr.p = e.fields.password; }
      else perr.p = (e instanceof ApiError && e.code !== "offline" ? e.message : why(e)) + (e instanceof ApiError && e.left ? " Остават " + plural(e.left, "опит", "опита") + "." : "");
    }
    busy = false; render();
    main.querySelector<HTMLElement>(perr.u ? "#u" : "#p")?.focus();
  }
  async function startShift() {
    if (busy) return;
    if (!picked.length) { S.toast("Избери поне една маса."); return; }
    busy = true; render();
    try { await shiftApi.start(picked.slice().sort((a, b) => a - b)); lsSet("sv-mine", picked); go(); return; }
    catch (e) {
      S.toast(why(e));
      if (e instanceof ApiError && e.status === 409) { try { mine = await shiftApi.mine(); const can = new Set(mine.tables.filter((t) => !t.owner || t.mine).map((t) => t.n)); picked = picked.filter((n) => can.has(n)); } catch { /* keep */ } }
    }
    busy = false; render();
  }
  async function endShift() {
    if (busy) return;
    busy = true; render();
    try {
      const r = await shiftApi.end(to || null);
      me = null; want = null; mine = null; hall = null; setHash("");
      S.toast(r.handed.length ? "Смяната приключи. " + (r.handed.length === 1 ? "Масата е предадена." : "Масите са предадени.") : "Смяната приключи.");
      busy = false; await start(); return;
    } catch (e) { S.toast(why(e)); }
    busy = false; render();
  }

  /* ---------- input ---------- */
  document.addEventListener("keydown", (e) => {
    if (view !== "pin" || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".st-sheetwrap.on")) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); digit(e.key); }
    else if (e.key === "Backspace" && pin) { e.preventDefault(); pin = pin.slice(0, -1); render(); }
  });
  main.addEventListener("submit", (e) => { e.preventDefault(); if (!busy) submitPass(); });
  main.addEventListener("change", (e) => { const t = e.target as HTMLSelectElement; if (t.id === "to") to = t.value; });
  main.addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.id === "u") uVal = t.value; else if (t.id === "p") pVal = t.value; });
  main.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button"); if (!b) return;
    if (b.dataset.v) { view = b.dataset.v === "pass" ? "pass" : "pin"; pin = ""; pinBad = false; pinMsg = ""; perr = {}; render(); main.querySelector<HTMLElement>(view === "pass" ? "#u" : '[data-v="pin"]')?.focus(); return; }
    if (b.hasAttribute("data-show")) { showPw = !showPw; const p = main.querySelector<HTMLInputElement>("#p")!; pVal = p.value; p.type = showPw ? "text" : "password"; b.setAttribute("aria-pressed", String(showPw)); b.innerHTML = ic(showPw ? "lock" : "eye", 20) + (showPw ? "Скрий" : "Покажи"); return; }
    if (b.dataset.who) { who = b.dataset.who; pin = ""; pinBad = false; pinMsg = ""; render(); main.querySelector<HTMLElement>('[data-who="' + CSS.escape(who) + '"]')?.focus(); return; }
    if (b.dataset.d) { digit(b.dataset.d); return; }
    if (b.hasAttribute("data-del")) { pin = pin.slice(0, -1); pinBad = false; render(); main.querySelector<HTMLElement>("[data-del]")?.focus(); return; }
    if (b.hasAttribute("data-clear")) { pin = ""; pinBad = false; pinMsg = ""; render(); main.querySelector<HTMLElement>("[data-clear]")?.focus(); return; }
    if (b.dataset.t) {
      const n = +b.dataset.t, t = mine && mine.tables.find((x) => x.n === n);
      if (t && t.owner && !t.mine) { S.toast("Маса " + n + " е при " + t.owner.name + ". Управителят може да я премести."); return; }
      picked = picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n];
      render(); main.querySelector<HTMLElement>('[data-t="' + n + '"]')?.focus(); return;
    }
    if (b.hasAttribute("data-start")) { startShift(); return; }
    if (b.hasAttribute("data-end")) { endShift(); return; }
    if (b.hasAttribute("data-out")) { staffApi.logout().catch(() => null).then(() => { me = null; want = null; setHash(""); start(); }); return; }
  });
  S.onReload(() => { start(); });
  await start();
}
