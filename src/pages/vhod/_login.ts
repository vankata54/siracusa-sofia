/* Login (/vhod/): the flow of design/pages/login.html on the real API.
   1) phone (10 digits with 0 or +359) -> api.auth.smsRequest; blocked number -> polite "Нека го направим по телефона";
   2) 6 boxes (auto advance, paste of the whole code, Backspace back, "Изпрати нов код след 0:30") -> api.auth.smsVerify;
      wrong / expired code and too many tries come from the core (the limit lives there), with a text for people;
      v1 has no SMS provider: the API returns demoCode and the page shows it, clearly marked as demo (docs/DECISIONS.md);
   3) new profile only: name + marketing consent (unticked) -> api.auth.update;
   done: -10% "от следващата поръчка", then /profil/ or the page the visitor came from (?next= or the referrer, same site only).
   Already signed in -> "Вече сте в профила си". Prototype controls (offline, states by #hash) only with SC.preview. */
import { SC } from "../../client/sc.ts";
import { api, ApiError } from "../../client/api.ts";
import { normPhone, prettyPhone } from "../../lib/format.ts";
import type { Customer } from "../../client/api-types.ts";
import { HERO, phoneHTML, blockedHTML, alertHTML, stepper, focusAlert } from "./_views.ts";
import { previewPanel, pvToggle, PV, MKT_TITLE, MKT_SUB, OFFLINE, BACK, callBtn } from "../../lib/ui.ts";
import { RESTAURANT as R } from "../../lib/consts.ts";
/* icons this script draws (sc.ts has x, check, caret-right, phone, question) */
import "sc-icons:arrow-clockwise,arrow-left,arrow-right,fire,gift,info,paper-plane-right,shopping-bag,sign-out,sliders-horizontal,timer,user,warning,warning-circle"; /* the icons of this module in one group (scripts/icon-groups.mjs) */

const ic = SC.ic, esc = SC.esc;
/* prototype only: the core's blocked demo number (src/core/reservations.ts BLOCKED_DEMO_PHONE) and a sample number */
const BLOCKED = "0888000000";
const SAMPLE = "0888123456";

type User = Partial<Customer> & { phone?: string; name?: string };
/** too_many is per number (5 codes an hour), throttled per place (10 requests in 10 min), sms_unavailable for everyone */
type Lock = { kind: "throttled" | "too_many" | "unavailable"; phone: string; until: number; text: string };
const S = {
  ready: false, phone: "", isNew: true, offline: false, sim: false,
  /** the -10% is free for this number (sms/verify says so: customer.profileBonus); a used one is never promised */
  bonus: true,
  timer: 0 as ReturnType<typeof setInterval> | 0, left: 0, finishing: false, mkt: false, name: "",
  last: null as null | { phone: string; demo: string; known?: boolean },
  /** a refusal that trying again cannot change (429 throttled / too_many, 503 sms_unavailable): while it lasts the main
      action is the call (decision 12.11: "при 429 главното действие е „Обади се · 0894 36 55 77“", as in the cart) */
  lock: null as null | Lock,
  view: "phone" as "phone" | "code" | "name" | "done" | "signed" | "blocked",
};

let main: HTMLElement, lg: HTMLElement, box: HTMLElement;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const offlineErr = () => new ApiError("offline", "Няма връзка. Проверете интернета и опитайте пак.", 0);
/** every API call goes through here: the prototype "Без интернет" switch simulates a lost connection */
async function call<T>(fn: () => Promise<T>): Promise<T> {
  if (S.offline || (typeof navigator !== "undefined" && navigator.onLine === false)) { await wait(400); throw offlineErr(); }
  return fn();
}

/* ---------- refusals that "Опитай пак" cannot change: the call is the main action while they last ---------- */
function lockOf(ex: ApiError, phone: string): Lock | null {
  if (ex.code === "sms_unavailable") return { kind: "unavailable", phone, until: 0, text: "Засега не можем да изпратим SMS. Обадете ни се на " + R.phone + " и ще помогнем." };
  if (ex.code === "too_soon" || !(ex.status === 429 || ex.code === "throttled" || ex.code === "too_many")) return null;
  const kind = ex.code === "too_many" ? "too_many" : "throttled";
  /* the server says how long ("след 10 минути", "след час"); without a number: 10 min, an hour for too_many */
  const m = /(\d+)\s*мин/.exec(ex.message || ""), min = m ? +m[1] : kind === "too_many" ? 60 : 10;
  return { kind, phone, until: Date.now() + min * 60_000, text: ex.message || "Твърде много опити. Обадете ни се на " + R.phone + "." };
}
/** the lock that applies to this number now (too_many only to the number it came with; an old one is dropped) */
function lockFor(phone: string): Lock | null {
  const L = S.lock;
  if (!L) return null;
  if (L.until && Date.now() >= L.until) { S.lock = null; return null; }
  if (L.kind === "too_many" && phone && phone !== L.phone) return null;
  return L;
}
const lockTitle = (L: Lock, again = false) => (L.kind === "unavailable" ? "Входът с код още не работи" : again ? "Не успяхме да изпратим нов код" : "Не успяхме да изпратим кода");
const callMain = (cls = "pill pill-red pill-lg pill-block") => callBtn(cls, "data-callmain");
/** "Назад" to the phone: in the bar on a phone, a text link under the main button at 1440 (decision 12.11, as in the cart) */
const backTo = (cls: string, size: number) => '<button class="' + cls + '" type="button" data-back aria-label="' + BACK + ': Телефон">' + ic("arrow-left", size) + BACK + "</button>";

/* numbers that already have a profile on this device: only to show "Стъпка 2 от 2" instead of "от 3" */
const known = () => SC.load<Record<string, 1>>("sc-known", {});
const markKnown = (p: string) => { const k = known(); k[p] = 1; SC.store("sc-known", k); };

/* ---------- where to go after sign-in: ?next= or the referrer, only inside this site; else the profile ---------- */
function target(): { href: string; label: string; icon: string } {
  const here = new URL(location.href);
  const path = (h: string) => new URL(h, location.href).pathname.replace(/index\.html$/, "");
  const loginP = path(SC.url.page("login")), profP = path(SC.url.page("profile")), cartP = path(SC.url.cart());
  const cands = [here.searchParams.get("next"), document.referrer];
  for (const c of cands) {
    if (!c || /^\s*(javascript|data):/i.test(c)) continue;
    try {
      const u = new URL(c, location.href);
      if (u.origin !== here.origin || (u.protocol !== "http:" && u.protocol !== "https:")) continue;
      const p = u.pathname.replace(/index\.html$/, "");
      if (p === loginP) continue;
      u.searchParams.delete("preview"); u.searchParams.delete("t");
      const href = u.pathname + u.search + u.hash;
      if (p === profP) break;
      if (p === cartP) return { href, label: "Обратно към количката", icon: "shopping-bag" };
      return { href, label: "Обратно към страницата", icon: "arrow-left" };
    } catch { /* not an address */ }
  }
  return { href: SC.url.page("profile"), label: "Към профила", icon: "user" };
}

/* ---------- frame ---------- */
function hero(done: boolean, name = "", isNew = true) {
  lg.classList.toggle("done", done);
  main.querySelector("[data-eyebrow]")!.textContent = done ? "Профил" : HERO.eyebrow;
  main.querySelector("[data-h1]")!.textContent = done ? (isNew ? "Добре дошли" : "Добре дошли отново") + (name ? ", " + name : "") : HERO.h1;
  main.querySelector("[data-lead]")!.textContent = done ? "Влязохте. Поръчките, адресите и купоните ви са в профила." : HERO.lead;
}
function show(html: string, focusSel?: string | null) {
  clearInterval(S.timer as number); S.timer = 0;
  /* the -10% card next to the steps: only while the bonus is free for this number */
  const card = main.querySelector<HTMLElement>(".bonus"); if (card) card.hidden = !S.bonus;
  if (!S.finishing) hero(false);
  box.innerHTML = '<div class="view' + (SC.reduce ? "" : " in") + '">' + html + "</div>";
  if (focusSel) { const f = box.querySelector<HTMLElement>(focusSel); if (f) setTimeout(() => f.focus({ preventScroll: true }), 30); }
  /* after the first view, bring the card's top under the header so the new step is in sight */
  if (S.ready && S.finishing) { window.scrollTo({ top: 0, behavior: SC.reduce ? "auto" : "smooth" }); return; }
  if (S.ready) {
    const top = box.getBoundingClientRect().top;
    if (top < 120 || top > innerHeight * 0.45) window.scrollTo({ top: Math.max(0, scrollY + top - 150), behavior: SC.reduce ? "auto" : "smooth" });
  }
}
function busy(btn: HTMLElement, text: string) { btn.classList.add("busy"); btn.setAttribute("aria-busy", "true"); btn.innerHTML = '<span class="spin" aria-hidden="true"></span>' + text; }
function idle(btn: HTMLElement, html: string) { btn.classList.remove("busy"); btn.removeAttribute("aria-busy"); btn.innerHTML = html; }

/* ---------- already signed in ---------- */
function viewSignedIn(u: User) {
  S.view = "signed";
  const t = target();
  show('<div class="view center"><span class="ring">' + ic("user", 32) + '</span><h2 class="h3">Вече сте в профила си</h2><p class="sub">' +
    esc(u.name || "") + (u.name ? " · " : "") + "<b>" + esc(prettyPhone(u.phone || "")) + "</b></p>" +
    '<a class="pill pill-red pill-lg pill-block" href="' + esc(t.href) + '">' + ic(t.icon, 20) + t.label + "</a>" +
    '<button class="pill pill-line pill-lg pill-block" type="button" data-other>' + ic("sign-out", 20) + "Влез с друг номер</button></div>");
  box.querySelector<HTMLButtonElement>("[data-other]")!.onclick = async (e) => {
    const b = e.currentTarget as HTMLButtonElement; busy(b, "Излизаме...");
    try { await call(() => api.auth.logout()); } catch (err) { idle(b, ic("sign-out", 20) + "Влез с друг номер"); SC.toast((err as Error).message || "Нещо се обърка. Опитайте пак."); return; }
    S.phone = ""; viewPhone("", true);
  };
}

/* ---------- step 1: phone ---------- */
function offlineAlert(slot: Element | null) {
  if (slot) { slot.innerHTML = alertHTML(OFFLINE, "Номерът ви е запазен. Проверете връзката и опитайте пак."); focusAlert(slot); }
}
function viewPhone(err = "", focus = false, reuse = false) {
  S.bonus = true;
  S.view = "phone";
  if (!reuse) show(phoneHTML(S.phone, err), focus ? "#ph" : null);
  const f = box.querySelector<HTMLFormElement>("form[data-f=phone]")!, inp = f.querySelector<HTMLInputElement>("#ph")!, er = f.querySelector<HTMLElement>("#ph-err")!;
  const alert = f.querySelector("[data-alert]")!, send = f.querySelector<HTMLElement>("[data-send]")!;
  const BTN = ic("paper-plane-right", 20) + "Изпрати код по SMS";
  /* while a lock lasts: the message without "Опитай пак", the call in the place of "Изпрати код по SMS" */
  let lockT: ReturnType<typeof setTimeout> | undefined;
  function paintLock(d: string, focus: boolean) {
    const L = lockFor(d), cur = f.querySelector("[data-callmain]");
    clearTimeout(lockT);
    if (!L) { if (cur) { cur.remove(); send.hidden = false; alert.innerHTML = ""; } return; }
    if (!cur) {
      send.hidden = true; send.insertAdjacentHTML("afterend", callMain());
      alert.innerHTML = alertHTML(lockTitle(L), L.text, false);
    }
    if (L.until) lockT = setTimeout(() => { if (f.isConnected) paintLock(normPhone(inp.value) || "", false); }, L.until - Date.now() + 50);
    if (focus) focusAlert(alert);
  }
  paintLock(normPhone(S.phone) || "", false);
  const fieldErr = (msg: string) => { inp.setAttribute("aria-invalid", "true"); er.textContent = msg; er.hidden = false; inp.focus(); };
  inp.addEventListener("input", () => {
    S.phone = inp.value;
    if (S.lock && S.lock.kind === "too_many") paintLock(normPhone(inp.value) || "", false); /* another number is not limited */
    if (inp.getAttribute("aria-invalid") && (normPhone(inp.value) || !inp.value.trim())) { inp.removeAttribute("aria-invalid"); er.hidden = true; }
  });
  inp.addEventListener("blur", () => { const d = normPhone(inp.value); if (d) inp.value = prettyPhone(d); });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = send;
    if (btn.classList.contains("busy")) return;
    const raw = inp.value.trim(), d = normPhone(raw);
    S.phone = d || raw;
    /* Enter during a lock: the message again, nothing sent */
    if (lockFor(d || "")) return paintLock(d || "", true);
    alert.innerHTML = "";
    if (!raw) return fieldErr("Напишете номера си, например 0888 12 34 56.");
    if (!d) return fieldErr("Номерът изглежда непълен. Трябват 10 цифри, започващи с 0 (или +359), например 0888 12 34 56.");
    inp.value = prettyPhone(d);
    busy(btn, "Изпращаме кода...");
    try {
      const r = await call(() => api.auth.smsRequest(d));
      S.lock = null;
      viewCode(r.demoCode, r.resendIn, r.known);
    } catch (x) {
      idle(btn, BTN);
      const ex = x as ApiError;
      if (ex.code === "blocked") return viewBlocked();
      /* a code went to this number less than 30 s ago (after "Назад", a reload or a new tab): it is still valid, so the
         code step with the countdown; the demo box only when this page knows that code */
      if (ex.code === "too_soon") { const same = S.last && S.last.phone === d ? S.last : null; return viewCode(same ? same.demo : "", ex.retryIn ?? 30, same ? same.known : undefined); }
      if (ex.code === "offline") return offlineAlert(alert);
      if (ex.code === "invalid") return fieldErr(ex.fields?.phone || ex.message);
      const L = lockOf(ex, d);
      if (L) { S.lock = L; return paintLock(d, true); }
      alert.innerHTML = alertHTML("Не успяхме да изпратим кода", ex.message || "Нещо се обърка. Опитайте пак.");
      focusAlert(alert);
    }
  });
}

/* ---------- blocked number: polite, no blame ---------- */
function viewBlocked() {
  S.view = "blocked";
  show(blockedHTML(S.phone), "[data-focus]");
  box.querySelector<HTMLButtonElement>("[data-again]")!.onclick = () => viewPhone("", true);
}

/* ---------- step 2: SMS code ---------- */
const spaced = (c: string) => c.slice(0, 3) + " " + c.slice(3);
function demoHTML(code: string) {
  return '<div class="democode" data-demo-code>' + ic("info", 22) + '<span class="t">Демо: SMS още не се изпраща</span>' +
    '<span class="c">Вашият код: <b data-code>' + esc(spaced(code)) + "</b></span>" +
    '<button class="link" type="button" data-fill>Попълни кода' + ic("caret-right", 18) + "</button></div>";
}
function viewCode(demoCode?: string, resendIn = 30, isKnown?: boolean) {
  S.view = "code";
  S.isNew = typeof isKnown === "boolean" ? !isKnown : !known()[S.phone];
  let demo = demoCode || "";
  S.last = { phone: S.phone, demo, known: typeof isKnown === "boolean" ? isKnown : undefined };
  show(stepper(2, "Код от SMS", S.isNew ? 3 : 2) +
    '<div class="head"><h2 class="h3">Въведете кода</h2><p class="sub">Изпратихме 6 цифри на <b>' + esc(prettyPhone(S.phone)) + "</b>. Грешен номер? Натиснете „Назад“.</p></div>" +
    '<div data-demo-slot>' + (demo ? demoHTML(demo) : "") + "</div>" +
    '<form class="view" data-f="code" novalidate>' +
      '<fieldset class="otp" aria-describedby="otp-err"><legend class="vh">Код от SMS, 6 цифри</legend><div class="boxes">' +
        [0, 1, 2, 3, 4, 5].map((i) => '<input type="text" inputmode="numeric" pattern="[0-9]*" maxlength="1" ' + (i === 0 ? 'autocomplete="one-time-code" ' : 'autocomplete="off" ') + 'aria-label="Цифра ' + (i + 1) + ' от 6" data-i="' + i + '">').join("") +
      "</div></fieldset>" +
      '<p class="err" id="otp-err" role="alert" hidden></p>' +
      '<div class="acts2">' + backTo("pill pill-line pill-lg back", 20) + '<button class="pill pill-red pill-lg" type="submit" disabled>' + ic("check", 20) + "Потвърди кода</button></div>" +
      backTo("link flow-back", 18) +
    "</form>" +
    "<div data-alert></div>" +
    '<div class="resend" data-resend tabindex="-1" aria-live="off"></div>' +
    '<p class="hint">' + ic("info", 20) + "<span>Кодът идва до минута. Ако не дойде, проверете дали номерът е верен.</span></p>", ".otp input");
  const f = box.querySelector<HTMLFormElement>("form[data-f=code]")!;
  const ins = [...f.querySelectorAll<HTMLInputElement>(".otp input")];
  const fs = f.querySelector<HTMLElement>(".otp")!, er = f.querySelector<HTMLElement>("#otp-err")!, btn = f.querySelector<HTMLButtonElement>("[type=submit]")!;
  const BTN = ic("check", 20) + "Потвърди кода";
  box.querySelectorAll<HTMLButtonElement>("[data-back]").forEach((b) => { b.onclick = () => viewPhone("", true); });
  const code = () => ins.map((x) => x.value).join("");
  const sync = () => { ins.forEach((x) => x.classList.toggle("full", !!x.value)); btn.disabled = code().length !== 6 || btn.classList.contains("busy"); };
  const clearErr = () => { fs.removeAttribute("aria-invalid"); er.hidden = true; };
  const pop = (x: HTMLElement) => { if (SC.reduce) return; x.classList.remove("pop"); void x.offsetWidth; x.classList.add("pop"); };
  function fill(from: number, str: string) {
    str = str.replace(/\D/g, "");
    if (str.length >= 6) from = 0; /* a whole code pasted into any box */
    for (let k = 0; k < str.length && from + k < 6; k++) { ins[from + k].value = str[k]; pop(ins[from + k]); }
    ins[Math.min(from + str.length, 5)].focus(); sync();
    if (code().length === 6) submit();
  }
  ins.forEach((x, i) => {
    x.addEventListener("input", () => { clearErr(); const v = x.value.replace(/\D/g, ""); x.value = ""; if (v.length) fill(i, v); else sync(); });
    x.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !x.value && i > 0) { e.preventDefault(); ins[i - 1].value = ""; ins[i - 1].focus(); sync(); }
      else if (e.key === "ArrowLeft" && i > 0) { e.preventDefault(); ins[i - 1].focus(); }
      else if (e.key === "ArrowRight" && i < 5) { e.preventDefault(); ins[i + 1].focus(); }
    });
    x.addEventListener("paste", (e) => { const t = e.clipboardData?.getData("text"); if (t) { e.preventDefault(); clearErr(); fill(i, t); } });
    x.addEventListener("focus", () => x.select());
  });
  const slot = box.querySelector<HTMLElement>("[data-demo-slot]")!;
  slot.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-fill]") && demo) { clearErr(); ins.forEach((x) => { x.value = ""; x.disabled = false; }); fill(0, demo); } });

  /* the limit of tries lives in the core: after it, or when the code expired, a new code is the only way on.
     Within 30 s of the last code the countdown goes on (the server would answer too_soon) and the focus waits on it;
     the button takes the focus when the countdown ends. */
  let dead = false;
  function needNew(msg: string) {
    dead = true;
    /* the dead code is not offered again ("Попълни кода" would send it once more), only a new code or the call */
    demo = ""; slot.innerHTML = "";
    er.textContent = msg; er.hidden = false; fs.setAttribute("aria-invalid", "true");
    ins.forEach((x) => { x.value = ""; x.disabled = true; }); sync(); btn.disabled = true;
    if (S.left > 0) { rs.focus(); return; }
    tick(); rs.querySelector<HTMLElement>("[data-resend-btn]")?.focus();
  }
  async function submit() {
    if (code().length !== 6 || btn.classList.contains("busy")) return;
    busy(btn, "Проверяваме..."); ins.forEach((x) => { x.disabled = true; });
    try {
      const r = await call(() => api.auth.smsVerify(S.phone, code()));
      markKnown(S.phone);
      S.bonus = (r.customer as { profileBonus?: boolean }).profileBonus !== false;
      if (r.isNew) { S.isNew = true; viewName(); } else { S.isNew = false; finish(r.customer, false); }
    } catch (x) {
      const ex = x as ApiError;
      idle(btn, BTN);
      if (ex.code === "too_many") return needNew("Кодът не съвпадна няколко пъти. За сигурност поискайте нов код отдолу.");
      if (ex.code === "expired") return needNew("Кодът вече не важи. Поискайте нов код отдолу.");
      fs.setAttribute("aria-invalid", "true"); er.hidden = false;
      if (ex.code === "wrong_code") {
        er.textContent = "Кодът не съвпада. Проверете SMS-а и опитайте пак.";
        if (!SC.reduce) { fs.classList.remove("shake"); void fs.offsetWidth; fs.classList.add("shake"); }
        ins.forEach((y) => { y.disabled = false; y.value = ""; }); sync(); ins[0].focus(); return;
      }
      er.textContent = ex.code === "offline" ? "Няма връзка с интернет. Кодът е запазен, проверете връзката и опитайте пак." : ex.message || "Нещо се обърка. Опитайте пак.";
      ins.forEach((y) => { y.disabled = false; }); sync(); btn.focus();
    }
  }
  f.addEventListener("submit", (e) => { e.preventDefault(); submit(); });

  /* resend countdown 0:30 (the time comes from the API: resendIn) */
  const rs = box.querySelector<HTMLElement>("[data-resend]")!;
  function tick() {
    if (S.left > 0) rs.innerHTML = ic("timer", 20) + "<span>Изпрати нов код след 0:" + (S.left < 10 ? "0" : "") + S.left + "</span>";
    else {
      clearInterval(S.timer as number); S.timer = 0;
      if (!rs.querySelector("[data-resend-btn]")) {
        const had = document.activeElement === rs;
        rs.innerHTML = '<button class="link" type="button" data-resend-btn>' + ic("paper-plane-right", 20) + "Изпрати нов код</button>";
        if (had) rs.querySelector<HTMLElement>("[data-resend-btn]")!.focus();
      }
    }
  }
  /* a lock on "Изпрати нов код" (429 throttled / too_many, 503): the message, the call in its place; red when the code
     is dead (the call is then the only way on), else the code still works and "Потвърди кода" stays the main action */
  const rsAlert = box.querySelector<HTMLElement>("[data-alert]")!;
  let lockT: ReturnType<typeof setTimeout> | undefined;
  function paintLock(L: Lock) {
    clearInterval(S.timer as number); S.timer = 0; S.left = 0; clearTimeout(lockT);
    rsAlert.innerHTML = alertHTML(lockTitle(L, true), L.text, false);
    rs.innerHTML = callMain(dead ? "pill pill-red pill-lg pill-block" : "pill pill-line pill-lg pill-block");
    btn.hidden = dead; btn.parentElement!.classList.toggle("solo", dead); /* the bar keeps only "Назад" */
    /* at 1440 "Назад" stays under the main button, now the call */
    const fb = box.querySelector(".flow-back"); if (dead && fb) rs.after(fb);
    if (dead) er.textContent = er.textContent!.replace(/\s*(За сигурност )?поискайте нов код отдолу\.?/i, "");
    focusAlert(rsAlert);
    if (L.until) lockT = setTimeout(() => { if (!rs.isConnected || lockFor(S.phone)) return; rsAlert.innerHTML = ""; btn.hidden = false; btn.parentElement!.classList.remove("solo"); rs.innerHTML = ""; tick(); }, L.until - Date.now() + 50);
  }
  function startTimer(sec: number) { S.left = Math.max(0, Math.min(59, sec)); clearInterval(S.timer as number); rs.innerHTML = ""; tick(); S.timer = setInterval(() => { S.left--; tick(); }, 1000); }
  rs.addEventListener("click", async (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-resend-btn]");
    if (!b || b.classList.contains("busy")) return;
    busy(b, "Изпращаме...");
    try {
      const r = await call(() => api.auth.smsRequest(S.phone));
      demo = r.demoCode || ""; S.last = { phone: S.phone, demo, known: r.known }; slot.innerHTML = demo ? demoHTML(demo) : "";
      S.lock = null; dead = false;
      clearErr(); ins.forEach((x) => { x.disabled = false; x.value = ""; }); sync(); ins[0].focus();
      startTimer(r.resendIn ?? 30);
      SC.toast("Изпратихме нов код на " + prettyPhone(S.phone));
    } catch (x) {
      const ex = x as ApiError;
      idle(b, ic("paper-plane-right", 20) + "Изпрати нов код");
      if (ex.code === "blocked") return viewBlocked();
      /* too_soon: the countdown from the server's retryIn, the focus on it (not dropped on <body> with the button) */
      if (ex.code === "too_soon") { startTimer(ex.retryIn ?? 30); rs.focus(); return; }
      const L = lockOf(ex, S.phone);
      if (L) { S.lock = L; return paintLock(L); }
      er.textContent = ex.code === "offline" ? "Няма връзка с интернет. Проверете връзката и поискайте кода пак." : ex.message || "Нещо се обърка. Опитайте пак.";
      er.hidden = false;
    }
  });
  startTimer(resendIn);
}

/* ---------- step 3: name (new profiles only) ---------- */
/** "Създай профил и вземи -10%" only while the bonus is free for this number; else just "Създай профил" */
const nameBtn = () => (S.bonus ? ic("gift", 20) + "Създай профил и вземи -10%" : ic("check", 20) + "Създай профил");
function viewName() {
  S.view = "name";
  show(stepper(3, "Име") +
    '<div class="head"><h2 class="h3">Как да ви наричаме?</h2><p class="sub">Името е за поръчките и резервациите, за да знае шофьорът кого да търси.</p></div>' +
    '<form class="view" data-f="name" novalidate>' +
      '<div class="field"><label for="nm">Име</label><input class="input" id="nm" type="text" autocomplete="given-name" placeholder="Например Мария" maxlength="60" value="' + esc(S.name) + '" aria-describedby="nm-err"><p class="err" id="nm-err" hidden></p></div>' +
      '<label class="check"><input type="checkbox" id="mkt"' + (S.mkt ? " checked" : "") + "><span><b>" + MKT_TITLE + '</b><br><span class="muted small">' + MKT_SUB + "</span></span></label>" +
      "<div data-alert></div>" +
      '<button class="pill pill-red pill-lg pill-block" type="submit">' + nameBtn() + "</button>" +
    "</form>", "#nm");
  const f = box.querySelector<HTMLFormElement>("form[data-f=name]")!, inp = f.querySelector<HTMLInputElement>("#nm")!, er = f.querySelector<HTMLElement>("#nm-err")!;
  const alert = f.querySelector("[data-alert]")!;
  const BTN = nameBtn();
  inp.addEventListener("input", () => { S.name = inp.value; if (inp.value.trim()) { inp.removeAttribute("aria-invalid"); er.hidden = true; } });
  f.querySelector<HTMLInputElement>("#mkt")!.addEventListener("change", (e) => { S.mkt = (e.target as HTMLInputElement).checked; });
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = f.querySelector<HTMLElement>("button.pill-red")!;
    if (btn.classList.contains("busy")) return;
    const n = inp.value.trim();
    alert.innerHTML = "";
    if (!n) { inp.setAttribute("aria-invalid", "true"); er.textContent = "Напишете името си, за да знаем кого да търсим."; er.hidden = false; inp.focus(); return; }
    S.name = n; busy(btn, "Създаваме профила...");
    try {
      const c = S.sim ? await call(async () => { await wait(500); return { name: n, phone: S.phone, stamps: 0 } as User; })
        : await call(() => api.auth.update({ name: n, consent: { marketing: S.mkt === true } }));
      finish(c, true);
    } catch (x) {
      const ex = x as ApiError;
      idle(btn, BTN);
      if (ex.code === "offline") return offlineAlert(alert);
      if (ex.fields?.name) { inp.setAttribute("aria-invalid", "true"); er.textContent = ex.fields.name; er.hidden = false; inp.focus(); return; }
      alert.innerHTML = alertHTML("Профилът не се запази", ex.code === "auth" ? "Входът изтече. Въведете номера си отново." : ex.message || "Нещо се обърка. Опитайте пак.", ex.code !== "auth");
      focusAlert(alert);
      if (ex.code === "auth") setTimeout(() => viewPhone("", true), 2500);
    }
  });
}

/* ---------- done ---------- */
let goT: ReturnType<typeof setTimeout> | undefined;
function finish(c: User | null, isNew: boolean) {
  S.view = "done"; S.finishing = true;
  const name = (c && c.name) || (isNew ? S.name : "") || "";
  const t = target();
  const stamps = c && typeof c.stamps === "number" && c.stamps > 0 ? c.stamps : 0;
  const bonus = !c || (c as { profileBonus?: boolean }).profileBonus !== false; /* the -10% is once per phone number, even after a deleted profile */
  const okRing = '<span class="ok-ring' + (SC.reduce ? "" : " in") + '">' + ic("check", 44) + "</span>";
  if (isNew) {
    show('<div class="view center">' + okRing +
      (bonus ? '<div class="head"><h2 class="h3 done-big">Профилът е готов</h2><p class="sub">Ето подаръка ви за добре дошли:</p></div>' +
      '<div class="ticket ember-card' + (SC.reduce ? "" : " in") + '"><span class="big">-10%</span><span class="cut" aria-hidden="true"></span><span class="tx"><b>от следващата поръчка</b><span class="s">Прилага се сам на следващата ви поръчка.</span></span></div>' : '<div class="head"><h2 class="h3 done-big">Профилът е готов</h2><p class="sub">Бонусът -10% вече е използван с този номер, затова този път го няма.</p></div>') +
      (stamps ? '<p class="sub" style="display:flex;gap:8px;align-items:center;justify-content:center">' + ic("fire", 20) + "И " + stamps + " от 10 печата на картата ви.</p>" : "") +
      '<a class="pill pill-red pill-lg pill-block" href="' + esc(t.href) + '" data-go>' + ic(t.icon, 20) + t.label + "</a>" +
      '<a class="link" href="' + SC.url.menu() + '">Към менюто' + ic("caret-right", 18) + "</a></div>");
  } else {
    /* a returning visitor goes straight on: a short confirmation, then the profile (or the page they came from) */
    show('<div class="view center">' + okRing +
      '<h2 class="h3 done-big">Влязохте успешно</h2><p class="sub">С номер <b>' + esc(prettyPhone(S.phone)) + "</b>. Отваряме „" + esc(t.label.replace(/^(Към|Обратно към) /, "")) + "“...</p>" +
      '<a class="pill pill-red pill-lg pill-block" href="' + esc(t.href) + '" data-go>' + ic(t.icon, 20) + t.label + "</a></div>");
    if (!S.sim) { clearTimeout(goT); goT = setTimeout(() => location.assign(t.href), 1600); }
  }
  hero(true, name, isNew); S.finishing = false;
  const a = box.querySelector<HTMLElement>("[data-go]"); if (a) setTimeout(() => a.focus({ preventScroll: true }), 60);
}

/* ---------- prototype controls (only with ?preview=1 / the demo) ---------- */
let paintOffline: (() => void) | null = null;
function proto() {
  const slot = main.querySelector<HTMLElement>("[data-lproto]");
  if (!slot || !SC.preview) return;
  /* the shared panel (lib/ui.ts): same title, sentence and switch words on every page */
  slot.outerHTML = previewPanel(pvToggle(PV.offline, false, "data-offline") + '<a class="chip" href="' + SC.url.page("profile") + '">Примерен профил</a>',
    { id: "lg-pv", text: "Вижте как изглежда входът в другите състояния. Тези бутони ги няма на истинския сайт. Блокиран номер: " + prettyPhone(BLOCKED) + ". Докато няма SMS доставчик, кодът се показва на екрана." });
  const b = main.querySelector<HTMLButtonElement>("[data-pv] [data-offline]")!;
  const paint = () => { b.setAttribute("aria-pressed", String(S.offline)); b.textContent = PV.offline + ": " + (S.offline ? "вкл." : "изкл."); };
  paint();
  /* no toast: the switch itself says "вкл."/"изкл." (a toast covered the hero for 2.4 s) */
  b.onclick = () => { S.offline = !S.offline; paint(); };
  paintOffline = paint;
}

/* ---------- entry ---------- */
function route(first = false) {
  const h = SC.preview ? location.hash.slice(1) : "";
  S.sim = false; S.offline = h === "offline";
  paintOffline?.();
  if (h) S.phone = SAMPLE;
  if (h === "kod") { call(() => api.auth.smsRequest(SAMPLE)).then((r) => viewCode(r.demoCode, r.resendIn, r.known)).catch(() => viewPhone()); return; }
  if (h === "ime") { S.sim = true; S.isNew = true; viewName(); return; }
  if (h === "gotovo") { S.sim = true; S.isNew = true; S.name = "Мария"; finish({ name: "Мария", phone: SAMPLE, stamps: 0 }, true); return; }
  if (h === "blokiran") { S.phone = BLOCKED; viewBlocked(); return; }
  if (h === "offline") { viewPhone(); offlineAlert(box.querySelector("[data-alert]")); return; }
  const me = SC.user() as User | null;
  if (me && me.phone) { viewSignedIn(me); return; }
  viewPhone("", false, first);
}

export function start() {
  main = SC.mount();
  lg = main.querySelector<HTMLElement>("[data-lg]")!;
  box = main.querySelector<HTMLElement>("[data-box]")!;
  proto();
  route(true);
  window.addEventListener("hashchange", () => route());
  S.ready = true;
  /* the session decides (cookie on the server, token in the demo): fix the first guess from this browser's memory */
  if (!location.hash || !SC.preview) {
    api.auth.me().then((u) => {
      if (u && u.phone && (S.view === "phone" && !S.phone)) viewSignedIn(u);
      else if (!u && S.view === "signed") viewPhone();
    }).catch(() => { /* offline: keep the first view */ });
  }
}
