/* Кухня · Вход (/kuhnya/vhod/): the section of this tablet + the personal PIN (design/pages-kuhnya/login.html): the sections
   of the kitchen's settings + "Общ изглед" for the head chef. The choice is remembered on the tablet ("sk-sec").
   Three ways in:
   - signed in already (the password at /admin/vhod/ brought the person here): the section and "Влез · …", no PIN;
   - no session on a KNOWN device (somebody signed in here with a password before; decision of the chief 17.11): the
     section + "Кой влиза?" (the people with the role "Кухня" and a PIN; decision 18.11: the lockouts are per person and
     per device, never the whole kitchen) + the personal PIN of 4 digits, "Влез · Скара Bertha" (core/staff-pin.ts). A
     wrong PIN says so (role="status") with the tries left; too many: the core's text and the button counts down;
     "Вход с потребител и парола" is always there;
   - no session on an unknown device: one line, the first sign-in on a new tablet is with the user name and the password.
   Before the sign-in the core does not give the kitchen's settings: the names of the sections come from the last time
   they were read on this tablet ("sk-secs"), else from the defaults of the build (the page, #k-secs).
   Also here, because the top bar of the module has no room for them: the theme of the tablet and "Изход". */
import "sc-icons:lock,user";
import { kitchenGuard, tabletSec, store, load, theme, setTheme, secIcon, ic, esc, K_ALL, type KGuard } from "./frame.ts";
import { session, logout, nameRole } from "../../admin/a.ts";
import { aurl } from "../../admin/routes.ts";
import { murl } from "../routes.ts";
import { kitchenApi, ApiError, type KConfigView } from "../../client/api-kitchen.ts";
import { pinApi } from "../../client/api-floor.ts";

/* what is cooked where, in the words of the prototype: true only while the sections are the conditional ones (cfg.missing) */
const DESC: Record<string, string> = { topla: "Супи, топли предястия, основни, паста, бургери, гарнитури", skara: "Скара на дървени въглища", pesht: "Пици и пърленки", studeni: "Салати, студени предястия, сосове, десерти" };
const LEFT_SHOWN = 3;

/** the names of the sections, enough for the choice before the sign-in */
interface Secs { sections: { id: string; n: string; icon: string }[]; all: { n: string; icon: string }; cond: string }
const secsOf = (cfg: KConfigView): Secs => ({ sections: cfg.sections.map((s) => ({ id: s.id, n: s.n, icon: s.icon })), all: { n: cfg.all.n, icon: cfg.all.icon }, cond: cfg.missing.find((m) => m.indexOf("секции") > -1) || "" });
function savedSecs(): Secs {
  const v = load<Secs | null>("secs", null);
  if (v && Array.isArray(v.sections) && v.sections.length && v.all) return v;
  try { return JSON.parse(document.getElementById("k-secs")!.textContent || "") as Secs; } catch { return { sections: [], all: { n: "Общ изглед", icon: "chef-hat" }, cond: "" }; }
}
/** #next= (a logical address of the module, from the frame's toSignIn) -> where to go after the sign-in */
function nextHref(): string | null {
  const v = murl.hash().get("next") || "";
  return /^\/kuhnya\/((?:[a-z-]+\/)?)(#[^\s]*)?$/.test(v) && !/^\/kuhnya\/vhod\//.test(v) ? aurl.fromLogical(v) : null;
}
const nextLogical = (): string => { const v = murl.hash().get("next") || ""; return /^\/kuhnya\//.test(v) ? v : "/kuhnya/"; };

export async function initVhod(): Promise<void> {
  document.documentElement.dataset.theme = theme();
  document.title = "Вход | Кухня · Siracusa";
  let signed = true;
  try { signed = !!(await session()); } catch { /* kitchenGuard says it (no connection) */ }
  if (signed) { const g = await kitchenGuard(); if (g) chooser(g); return; }
  void pinStep();
}

/* ---------- the page: the choice of the section on the left, the card on the right ---------- */
function page(s: Secs, chosen: string, top: string, card: string): HTMLElement {
  const el = document.createElement("div"); el.className = "lg";
  el.innerHTML = '<main class="lg-in" id="main" tabindex="-1">' +
    '<div class="lg-top"><span class="word">Siracusa</span> <span class="muted">Кухня</span>' + top + "</div>" +
    '<section aria-labelledby="h-sec"><h1 id="h-sec">Коя е секцията на този таблет?</h1><p class="lead">Таблетът ще показва само ястията на секцията. Изборът се помни.</p>' +
    '<div class="secs" role="group" aria-label="Секции">' + s.sections.map((x) =>
      '<button class="sct" type="button" data-sec="' + esc(x.id) + '" aria-pressed="' + (x.id === chosen) + '"><span class="si">' + ic(secIcon(x.icon), 32) + "</span><b>" + esc(x.n) + "</b> " + (s.cond && DESC[x.id] ? '<span class="d">' + DESC[x.id] + "</span>" : "") + "</button>").join("") +
    '<button class="sct wide" type="button" data-sec="' + K_ALL + '" aria-pressed="' + (chosen === K_ALL) + '"><span class="si">' + ic(secIcon(s.all.icon), 32) + "</span><b>" + esc(s.all.n) + '</b> <span class="d">За главния готвач: всички секции, колко чакат, закъснения</span></button></div>' +
    (s.cond ? '<p class="note">' + ic("info", 20) + '<span>Секциите и кое ястие къде се готви са условни: <span class="miss">' + esc(s.cond) + "</span></span></p>" : "") + "</section>" +
    card + "</main>";
  document.querySelector("[data-kboot]")?.remove();
  document.body.appendChild(el);
  return el;
}
const themeHTML = (out: boolean): string => '<div class="lg-set"><span class="lbl" id="h-theme">Тема на този таблет</span><div class="kseg" role="group" aria-labelledby="h-theme">' +
  '<button type="button" data-theme-set="dark">' + ic("moon", 20) + 'Тъмна</button><button type="button" data-theme-set="light">' + ic("sun", 20) + "Светла</button></div>" +
  (out ? '<button class="kb line" type="button" data-out style="min-height:52px; width:auto; font-size:16px">' + ic("sign-out", 22) + "Изход</button>" : "") + "</div>";
function paintTheme(el: HTMLElement): void { el.querySelectorAll<HTMLElement>("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === theme()))); }
function pressSec(el: HTMLElement, chosen: string): void { el.querySelectorAll<HTMLElement>("[data-sec]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sec === chosen))); }

/* ---------- signed in: the section only ---------- */
function chooser(g: KGuard): void {
  const { me, cfg, boss } = g;
  store("secs", secsOf(cfg));
  let chosen = tabletSec(cfg) || (cfg.sections[0] ? cfg.sections[0].id : K_ALL);
  const el = page(secsOf(cfg), chosen, boss ? '<a class="kboss" href="' + aurl.home() + '" title="Към таблото">' + ic("squares-four", 22) + "Табло</a>" : "",
    '<section class="pin kcard" aria-labelledby="h-in"><h2 id="h-in"><span data-name></span><small>Вход: ' + esc(nameRole(me.user.name, me.user.role)) + "</small></h2>" +
    "<div data-pin></div>" +
    '<button class="kb red" type="button" data-go>' + ic("sign-in", 24) + "<span data-golbl></span></button>" + themeHTML(true) + "</section>");
  const name = () => (chosen === K_ALL ? cfg.all.n : cfg.sections.find((s) => s.id === chosen)!.n);
  function upd(): void {
    pressSec(el, chosen);
    el.querySelector("[data-name]")!.textContent = name();
    el.querySelector("[data-golbl]")!.textContent = "Влез · " + name();
    paintTheme(el);
  }
  el.addEventListener("click", (e) => {
    const t = e.target as Element;
    const s = t.closest<HTMLElement>("[data-sec]");
    if (s) { chosen = s.dataset.sec!; upd(); return; }
    const th = t.closest<HTMLElement>("[data-theme-set]");
    if (th) { setTheme(th.dataset.themeSet === "light" ? "light" : "dark"); upd(); return; }
    if (t.closest("[data-out]")) { void logout(); return; }
    if (t.closest("[data-go]")) {
      store("sec", chosen);
      location.href = nextHref() || (chosen === K_ALL ? murl.kuhnya("obsht-izgled") : murl.kuhnya());
    }
  });
  upd();
}

/* ---------- no session: the PIN on a known device ---------- */
async function pinStep(): Promise<void> {
  const s = savedSecs(), was = load<string>("sec", "");
  let chosen = was === K_ALL || s.sections.some((x) => x.id === was) ? was : s.sections[0] ? s.sections[0].id : K_ALL;
  let known = false, why = "", people: { id: string; name: string }[] = [];
  try { const pp = await pinApi.people("kitchen"); known = pp.known; people = pp.people; }
  catch (e) { why = e instanceof ApiError && e.code === "offline" ? "Няма връзка. Провери Wi-Fi на таблета и опитай пак." : e instanceof ApiError && e.message ? e.message : "Опитай пак след малко."; }
  const pw = aurl.login(nextLogical());
  const name = () => (chosen === K_ALL ? s.all.n : s.sections.find((x) => x.id === chosen)?.n || "");
  const pad = () => '<div class="dots" data-dots aria-hidden="true"><i></i><i></i><i></i><i></i></div><p class="perr" data-err role="status"></p>' +
    '<div class="pinpad" role="group" aria-label="Цифри на ПИН" data-pad>' + [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => '<button type="button" data-k="' + n + '">' + n + "</button>").join("") +
    '<button type="button" class="fn" data-k="c">Изчисти</button><button type="button" data-k="0">0</button><button type="button" class="fn" data-k="b" aria-label="Изтрий една цифра">' + ic("arrow-left", 28) + "</button></div>";
  /* the person + the PIN (decision of the chief 18.11): the people with the role "Кухня" and a PIN; the last one is kept
     on the tablet ("sk-who"), one person alone is chosen already */
  let who = load<string>("who", "");
  if (!people.some((x) => x.id === who)) who = people.length === 1 ? people[0].id : "";
  const whoHTML = () => '<div class="who"><p class="lbl" id="l-who">Кой влиза?</p><div class="chips" role="group" aria-labelledby="l-who">' + people.map((x) =>
    '<button class="chip" type="button" data-who="' + esc(x.id) + '" aria-pressed="' + (x.id === who) + '">' + ic("user", 18) + esc(x.name) + "</button>").join("") + "</div></div>";
  const card = known && people.length
    ? '<section class="pin kcard" aria-labelledby="h-in"><h2 id="h-in">Личен ПИН<small data-for></small></h2><div data-pin>' + whoHTML() + pad() + "</div>" +
      '<button class="kb red" type="button" data-go>' + ic("sign-in", 24) + "<span data-golbl></span></button>" +
      '<p class="pw"><a href="' + pw + '" data-pw>Вход с потребител и парола</a></p></section>'
    : '<section class="pin kcard" aria-labelledby="h-in"><h2 id="h-in">' + (known ? "Вход" : "Нов таблет") + '<small data-for></small></h2><div data-pin>' +
      (why ? '<p class="perr" role="status">' + esc(why) + "</p>" : '<p class="first">' + ic("info", 22) + "<span>" + (known ? "Още никой с роля „Кухня“ няма личен ПИН. Влез с потребител и парола; ПИН дава управителят в „Персонал“." : "Първият вход на нов таблет е с потребител и парола. После тук стига личният ПИН.") + "</span></p>") + "</div>" +
      (why ? '<button class="kb line" type="button" data-again>' + ic("arrow-clockwise", 22) + "Опитай пак</button>" : "") +
      '<a class="kb red" href="' + pw + '" data-pw>' + ic("sign-in", 24) + "Влез с парола</a></section>";
  const el = page(s, chosen, "", card);
  const err = el.querySelector<HTMLElement>("[data-err]"), dots = el.querySelector<HTMLElement>("[data-dots]"), go = el.querySelector<HTMLButtonElement>("button[data-go]");
  let pin = "", busy = false, until = 0, timer: ReturnType<typeof setInterval> | undefined;
  const locked = () => until > Date.now();

  function upd(): void {
    pressSec(el, chosen);
    el.querySelector("[data-for]")!.textContent = "за вход в " + name();
    const gl = el.querySelector("[data-golbl]");
    if (gl && !busy && !locked()) gl.textContent = "Влез · " + name();
    if (dots) dots.querySelectorAll("i").forEach((d, i) => d.classList.toggle("on", i < pin.length));
    el.querySelectorAll<HTMLElement>("[data-who]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.who === who)));
    el.querySelector("[data-pad]")?.setAttribute("aria-label", "Цифри на ПИН, въведени " + pin.length + " от 4");
    paintTheme(el);
  }
  const say = (t: string) => { if (err) err.textContent = t; if (dots) dots.classList.toggle("err", !!t); };
  const label = () => { if (go) go.innerHTML = ic("sign-in", 24) + "<span data-golbl></span>"; };
  function lockTick(): void {
    if (!go) return;
    if (!locked()) { clearInterval(timer); timer = undefined; until = 0; go.disabled = false; label(); upd(); return; }
    const sec = Math.ceil((until - Date.now()) / 1000);
    go.disabled = true; go.innerHTML = ic("lock", 24) + "<span>Заключено · " + Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0") + "</span>";
  }
  function key(k: string): void {
    if (busy || locked()) return;
    say("");
    if (k === "c") pin = ""; else if (k === "b") pin = pin.slice(0, -1); else if (/^\d$/.test(k) && pin.length < 4) pin += k;
    upd();
  }
  async function submit(): Promise<void> {
    if (busy || locked() || !go) return;
    if (!who) { say("Първо избери кой влиза."); el.querySelector<HTMLElement>("[data-who]")?.focus(); return; }
    if (pin.length < 4) { say("Въведи 4 цифри."); return; }
    busy = true; go.disabled = true; go.innerHTML = ic("sign-in", 24) + "<span>Проверяваме …</span>";
    try {
      await pinApi.login("kitchen", pin, who);
      store("who", who);
    } catch (e) {
      busy = false; pin = ""; go.disabled = false; label(); upd();
      if (e instanceof ApiError && e.status === 429) { say(e.message); until = Date.now() + Math.max(1, e.retryIn || 900) * 1000; lockTick(); clearInterval(timer); timer = setInterval(lockTick, 1000); return; }
      if (e instanceof ApiError && e.code === "unknown_device") { location.reload(); return; }
      if (e instanceof ApiError && e.code === "offline") { say("Няма връзка. Провери Wi-Fi на таблета и опитай пак."); return; }
      const left = e instanceof ApiError && typeof e.left === "number" && e.left <= LEFT_SHOWN ? e.left : 0;
      say((e instanceof ApiError && e.message ? e.message : "Грешен ПИН. Опитай пак.") + (left ? " " + (left === 1 ? "Остава 1 опит" : "Остават " + left + " опита") + ", после входът се заключва за 15 минути." : ""));
      return;
    }
    /* signed in: the kitchen's settings decide whether the chosen section still exists */
    try {
      const cfg = await kitchenApi.config();
      store("secs", secsOf(cfg));
      if (chosen !== K_ALL && !cfg.sections.some((x) => x.id === chosen)) { location.reload(); return; }
    } catch { /* the screen checks it again */ }
    store("sec", chosen);
    location.href = nextHref() || (chosen === K_ALL ? murl.kuhnya("obsht-izgled") : murl.kuhnya());
  }

  el.addEventListener("click", (e) => {
    const t = e.target as Element;
    const sb = t.closest<HTMLElement>("[data-sec]");
    if (sb) { chosen = sb.dataset.sec!; upd(); return; }
    const th = t.closest<HTMLElement>("[data-theme-set]");
    if (th) { setTheme(th.dataset.themeSet === "light" ? "light" : "dark"); upd(); return; }
    const wb = t.closest<HTMLElement>("[data-who]");
    if (wb) { who = wb.dataset.who!; say(""); upd(); return; }
    const k = t.closest<HTMLElement>("[data-k]");
    if (k) { key(k.dataset.k!); return; }
    if (t.closest("button[data-go]")) { void submit(); return; }
    if (t.closest("[data-again]")) { location.reload(); return; }
    /* the password: the chosen section is waiting here when the person comes back */
    if (t.closest("[data-pw]")) store("sec", chosen);
  });
  /* a keyboard works too: digits, Backspace, Escape (clear), Enter */
  if (known && people.length) document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tg = e.target as HTMLElement | null;
    if (/^\d$/.test(e.key)) { e.preventDefault(); key(e.key); }
    else if (e.key === "Backspace") { e.preventDefault(); key("b"); }
    else if (e.key === "Escape") key("c");
    else if (e.key === "Enter" && !(tg && tg.closest("button, a"))) { e.preventDefault(); void submit(); }
  });
  upd();
}
