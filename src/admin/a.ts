/* Siracusa · Админ: the runtime of the admin (port of design/pages-admin/_admin.js, version 4, without the parts
   "Само в прототипа": no prototype clock, no "Виж като", no sample data, no sa-* data in localStorage).
   - A.mount(opts) draws the side bar by groups, the top bar, the bottom bar on the phone, the sheet "Раздели", the profile
     with "Изход", the theme; returns the element for the page content, or null (no session: off to the sign-in; a staff
     role: off to its module; no rights: "Нямате права за този раздел." is already drawn).
   - The data come from adminApi / staffApi (src/client/api-admin.ts: server or demo, the rights are checked in both).
   - localStorage keeps only the preferences of this device: "sa-prefs" {theme, side} and "sa-sound" ("on" | "off").
     The blinking "Поръчки" after a new online order lives in sessionStorage of the tab until the orders are seen.
   Addresses only through src/admin/routes.ts. Icons: the group below (scripts/icon-groups.mjs). */
import "sc-icons:squares-four,receipt,calendar-check,fork-knife,bowl-food,seal-percent,confetti,map-trifold,chair,qr-code,users,users-three,shield-check,chart-bar,wallet,list-bullets,pencil-simple,globe,sliders-horizontal,bell-ringing,chef-hat,moped,caret-left,caret-down,magnifying-glass,sun,moon,circles-three,sign-out,bell,list,info,sparkle,check-circle,warning-circle,warning,arrow-clockwise,lock,arrow-counter-clockwise,user,eye,arrow-up-right,clock,briefcase";
import { ic } from "../lib/icons.ts";
import { esc, fmt, plural } from "../lib/format.ts";
import { api } from "../client/api.ts";
import { staffApi, adminApi, ApiError, type Me } from "../client/api-admin.ts";
import type { Summary, SearchAnswer, SearchHit } from "../core/index.ts";
import type { FeedbackNote } from "../client/api-types.ts";
import { aurl } from "./routes.ts";
import type { Pencil } from "./pencil.ts";

import { SEC, GROUPS, APPS, groupOf, secHref, ROLES, roleName, nameRole, MODULES, type Sec, type Mod } from "./sections.ts";
export { SEC, GROUPS, APPS, groupOf, secHref, ROLES, roleName, nameRole, MODULES, type Sec, type Mod };

/* ---------- small helpers ---------- */
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
function lsGet<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } }
function lsSet(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }
function ssGet(k: string): string | null { try { return sessionStorage.getItem(k); } catch { return null; } }
function ssSet(k: string, v: string | null) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, v); } catch { /* ignore */ } }
const reduceMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/* dates as in src/lib/format.ts ("сб, 28 ноември"); kept here, so the admin adds no exports to the shared runtime chunk */
const DS = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"], MONTHS = ["януари", "февруари", "март", "април", "май", "юни", "юли", "август", "септември", "октомври", "ноември", "декември"];
/** "сб, 28 ноември"; short: "сб, 28 ное" */
export const dateLong = (d: Date, short = false) => DS[d.getDay()] + ", " + d.getDate() + " " + (short ? MONTHS[d.getMonth()].slice(0, 3) : MONTHS[d.getMonth()]);
/** "YYYY-MM-DD" in Sofia */
export function sofiaYmd(d: Date = new Date()): string { try { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(d); } catch { return d.toISOString().slice(0, 10); } }
/** today in Sofia as a Date at noon (for "нд, 15 ноември"; no time zone surprises) */
export function sofiaToday(): Date { const [y, m, d] = sofiaYmd().split("-").map(Number); return new Date(y, m - 1, d, 12); }
/** the real hour and minute in Sofia */
export function sofiaHM(): { h: number; m: number } {
  try { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":"); return { h: +p[0] % 24, m: +p[1] }; }
  catch { const d = new Date(); return { h: d.getHours(), m: d.getMinutes() }; }
}
const pad2 = (n: number) => String(n).padStart(2, "0");
export const hm = (t: { h: number; m: number }) => pad2(t.h) + ":" + pad2(t.m);
/** "сб, 28 ноември" from "2026-11-28" */
export const fmtYmd = (ymd: string, short = false) => { const [y, m, d] = ymd.split("-").map(Number); const x = new Date(y, m - 1, d, 12); return dateLong(x, short); };
export const initials = (name: string) => { const p = String(name || "?").replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/); return (p[0] ? p[0][0] : "?").toUpperCase(); };

/* ---------- prefs of this device (sa-prefs) ---------- */
type Theme = "system" | "light" | "dark";
const prefs: { theme: Theme; side: "open" | "mini" } = { theme: "system", side: "open", ...lsGet<Partial<{ theme: Theme; side: "open" | "mini" }>>("sa-prefs", {}) };
const savePrefs = () => lsSet("sa-prefs", { theme: prefs.theme, side: prefs.side });
function applyTheme() { const de = document.documentElement; if (prefs.theme === "light" || prefs.theme === "dark") de.dataset.theme = prefs.theme; else delete de.dataset.theme; }
const THEMES: [Theme, string, string][] = [["system", "Авто", "circles-three"], ["light", "Светла", "sun"], ["dark", "Тъмна", "moon"]];

/* ---------- UI helpers (HTML strings, as in the prototype) ---------- */
export const sample = (t?: string) => '<span class="sa-tag sample">' + ic("info", 16) + esc(t || "Примерни данни") + "</span>";
export const missing = (t: string) => '<span class="missing">[ЛИПСВА: ' + esc(t) + "]</span>";
export const soonTag = () => '<span class="sa-tag soon">' + ic("sparkle", 16) + "Скоро</span>";
/** {icon, title, text (HTML), action (HTML)} */
export const empty = (o: { icon?: string; title: string; text?: string; action?: string }) =>
  '<div class="sa-empty"><div class="ill">' + ic(o.icon || "check-circle", 44) + "</div><h3>" + esc(o.title) + "</h3>" + (o.text ? "<p>" + o.text + "</p>" : "") + (o.action || "") + "</div>";
/** the skeleton: aria-hidden + a hidden role=status (decision 13.11) */
export function skel(n = 4, label = "Зареждаме …") {
  let h = ""; for (let i = 0; i < n; i++) h += '<div class="skel"></div>';
  return '<div class="sa-skel"><span class="vh" role="status">' + esc(label) + '</span><div class="sa-skel" aria-hidden="true"><div class="skel s"></div>' + h + "</div></div>";
}
/** tone: "ember" (new order) | "warn" | "danger" | "ok" | "" */
export const banner = (o: { tone?: string; icon?: string; title?: string; text?: string; action?: string }) =>
  '<div class="sa-banner ' + (o.tone || "") + '" role="' + (o.tone === "danger" || o.tone === "warn" ? "alert" : "status") + '">' + ic(o.icon || "info", 26) + '<div class="tx">' + (o.title ? "<b>" + esc(o.title) + "</b>" : "") + (o.text || "") + "</div>" + (o.action || "") + "</div>";
const retryBtn = () => '<button class="pill pill-line" type="button" data-sa="retry">' + ic("arrow-clockwise", 20) + "Опитай пак</button>";
export const offline = (text?: string) => banner({ tone: "warn", icon: "warning-circle", title: "Няма връзка с интернет", text: esc(text || "Показваме последно зареденото. Проверете връзката и опитайте пак."), action: retryBtn() });
export const error = (text?: string) => banner({ tone: "danger", icon: "warning", title: "Не успяхме да заредим данните", text: esc(text || "Опитайте пак след малко. Ако не стане, кажете на главния админ."), action: retryBtn() });
/** "no connection" or "error", by the ApiError */
export const failHTML = (e: unknown, text?: string) => (e instanceof ApiError && e.code === "offline" ? offline(text) : error(text));

/* ---------- state ---------- */
export interface MountOpts {
  section: string; title?: string; sub?: string; eyebrow?: string; crumb?: string; barTitle?: string; docTitle?: string;
  actions?: string; wide?: boolean; head?: boolean; pencil?: boolean;
  /** every signed-in role may open it ("Моите препоръки" on /admin/notes/ for the roles without "Бележки") */
  anyRole?: boolean;
}
interface AState {
  me: Me | null; app: HTMLElement | null; side: HTMLElement | null; col: HTMLElement | null; scroller: HTMLElement | null; ov: HTMLElement | null; bnav: HTMLElement | null;
  pen: Pencil | null; summary: Summary | null; badges: Record<string, number>; badgeTitles: Record<string, string>;
  /** the page hears every new summary (after a new order, a note ...) */
  onSummary: ((s: Summary) => void) | null;
  onNewOrder: ((d: { no: string }) => void) | null;
}
export const A: AState = { me: null, app: null, side: null, col: null, scroller: null, ov: null, bnav: null, pen: null, summary: null, badges: {}, badgeTitles: {}, onSummary: null, onNewOrder: null };

export const isMainAdmin = () => !!A.me && A.me.user.role === "admin";
/** can the signed-in role see the section? The main admin: always. */
export const can = (section: string) => !!A.me && (A.me.user.role === "admin" || A.me.sections.includes(section));
export const who = () => (A.me ? nameRole(A.me.user.name, A.me.user.role) : "?");
export const modCan = (m: Mod) => !!A.me && (m.roles ? A.me.user.role === "admin" || m.roles.includes(A.me.user.role) : can(m.sec || ""));
export const visibleSections = () => { const out: Sec[] = []; GROUPS.forEach((g) => g[1].forEach((id) => { if (can(id)) out.push(SEC[id]); })); return out; };

/* ---------- section search (Cyrillic or Latin) ---------- */
const TR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya" };
export function norm(s: string): string {
  return String(s).toLowerCase().split("").map((c) => (TR[c] != null ? TR[c] : c)).join("").replace(/sht/g, "st").replace(/zh/g, "z").replace(/ch/g, "c").replace(/sh/g, "s").replace(/ts/g, "c").replace(/yu/g, "u").replace(/ya/g, "a")
    .replace(/[yj]/g, "i").replace(/w/g, "v").replace(/q/g, "k").replace(/x/g, "ks").replace(/[^a-z0-9 ]/g, " ").replace(/([a-z])\1+/g, "$1").replace(/\s+/g, " ").trim();
}
export function searchSections(q: string): Sec[] {
  const n = norm(q); if (!n) return [];
  return visibleSections().filter((s) => { const k = norm(s.n + " " + s.short + " " + s.desc + " " + groupOf(s.id)); const ws = k.split(" "); return n.split(" ").every((p) => ws.some((w) => w.startsWith(p))); })
    .sort((a, b) => Number(norm(b.n).indexOf(n) === 0) - Number(norm(a.n).indexOf(n) === 0));
}

/* ---------- toast (one at a time; the new one replaces the old) ---------- */
let toastT: ReturnType<typeof setTimeout> | undefined;
const BAR_SEL = ".sa-pbar.on, [data-pbar].on";
/* the page bar "Запази" lifts the round "Молив" (data-up on sa-pen-ui); while a toast is open the round button hides */
function penUp() {
  const ph = $("sa-pen-ui"); if (!ph) return;
  if ($(BAR_SEL)) ph.setAttribute("data-up", ""); else ph.removeAttribute("data-up");
  if ($(".sa-toast.on")) ph.setAttribute("data-toast", ""); else ph.removeAttribute("data-toast");
}
/* the toast is always above the page bar, also when the bar appears after it */
export function toastUp() {
  penUp(); const col = A.col || document.body, t = $(".sa-toast", col); if (!t) return; const bar = $<HTMLElement>(BAR_SEL);
  t.classList.toggle("up", !!bar);
  if (bar) { const cs = getComputedStyle(bar), bb = parseFloat(cs.bottom); t.style.bottom = (cs.position === "fixed" || isNaN(bb) ? Math.max(28, Math.round(col.getBoundingClientRect().bottom - bar.getBoundingClientRect().top + 12)) : Math.round(bb + bar.offsetHeight + 12)) + "px"; }
  else t.style.bottom = "";
}
/** A.toast("Бележката е изтрита", {undo, undoLabel, action:{label, href} | {label, fn}, ms}) */
/* one toast at a time: a toast that can be undone ("Отмени") is never replaced by a notice that came by itself (a new online
   order): the notice waits until the "Отмени" toast is gone */
let undoUntil = 0, waiting: (() => void) | null = null;
export function toast(text: string, o: { undo?: () => void; undoLabel?: string; action?: { label: string; href?: string; fn?: () => void }; ms?: number; queue?: boolean } = {}) {
  /* never over an open sheet (a new PIN is shown there only once): the toast waits until the sheet is closed */
  if ($(".sa-ov .sheetwrap.on")) { const t0 = Date.now(); const wait = () => { if (!$(".sa-ov .sheetwrap.on") || Date.now() - t0 > 120_000) toast(text, o); else setTimeout(wait, 400); }; setTimeout(wait, 400); return; }
  const left = undoUntil - Date.now();
  if (o.queue && left > 0) { waiting = () => toast(text, o); setTimeout(() => { const w = waiting; waiting = null; if (w) w(); }, left + 400); return; }
  const col = A.col || document.body; let t = $(".sa-toast", col);
  if (!t) { t = document.createElement("div"); t.className = "sa-toast"; t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite"); col.appendChild(t); }
  const tt = t;
  tt.innerHTML = '<span class="tx">' + esc(text) + "</span>" + (o.action ? (o.action.href ? '<a href="' + esc(o.action.href) + '">' + esc(o.action.label) + ic("caret-right", 18) + "</a>" : '<button type="button" data-ta>' + esc(o.action.label) + "</button>") : "") +
    (o.undo ? '<button type="button" data-tu>' + ic("arrow-counter-clockwise", 18) + esc(o.undoLabel || "Отмени") + "</button>" : "");
  const ms = o.ms || (o.undo ? 6000 : 3200);
  undoUntil = o.undo ? Date.now() + ms : 0;
  const u = $<HTMLButtonElement>("[data-tu]", tt); if (u) u.onclick = () => { tt.classList.remove("on"); undoUntil = 0; o.undo!(); };
  const a = $<HTMLButtonElement>("[data-ta]", tt); if (a) a.onclick = () => { tt.classList.remove("on"); o.action!.fn && o.action!.fn(); };
  toastUp();
  requestAnimationFrame(() => tt.classList.add("on")); clearTimeout(toastT);
  toastT = setTimeout(() => tt.classList.remove("on"), ms);
}

/* ---------- sheet (from components.css: from the bottom on the phone, on the right from 900 px) ---------- */
export interface Sheet { el: HTMLElement; body: HTMLElement; foot: HTMLElement | null; close(): void }
export function sheet(o: { title: string; html?: string; foot?: string; focus?: string; onClose?: () => void }): Sheet {
  const ov = A.ov || document.body, w = document.createElement("div"), id = "sa" + Math.random().toString(36).slice(2, 8); w.className = "sheetwrap";
  w.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle"></div><div class="sheet-h"><h2 id="' + id + '">' + esc(o.title || "") + '</h2><button class="hb" type="button" data-close>' + ic("x", 20) + "Затвори</button></div><div class=\"body\">" + (o.html || "") + "</div>" + (o.foot ? '<div class="sa-sfoot">' + o.foot + "</div>" : "") + "</div>";
  /* a toast that is still on screen goes away: it must never cover the sheet (a new PIN is shown there only once) */
  const oldToast = $(".sa-toast", A.col || document.body); if (oldToast) { oldToast.classList.remove("on"); clearTimeout(toastT); }
  ov.appendChild(w); const penHost = $("sa-pen-ui"); if (penHost) penHost.setAttribute("data-sheet", ""); /* the round "Молив" hides while a sheet is open */
  const prev = document.activeElement as HTMLElement | null, bg = [A.side, A.scroller, A.col && $(".sa-top", A.col), A.bnav].filter(Boolean) as HTMLElement[];
  bg.forEach((el) => { el.inert = true; });
  w.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "Tab") return;
    const f = $$<HTMLElement>(".sheet button:not([disabled]), .sheet a[href], .sheet input:not([disabled]), .sheet textarea, .sheet select", w).filter((el) => el.offsetParent !== null);
    if (!f.length) return; const a = f[0], z = f[f.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  });
  let closed = false;
  function close() {
    if (closed) return; closed = true;
    if ($$(".sa-ov .sheetwrap.on").length <= 1) { bg.forEach((el) => { el.inert = false; }); if (penHost) penHost.removeAttribute("data-sheet"); }
    w.classList.remove("on"); setTimeout(() => w.remove(), 340); if (o.onClose) o.onClose(); if (prev && prev.focus) prev.focus({ preventScroll: true });
  }
  ($<HTMLButtonElement>(".scrim", w)!).onclick = close; ($<HTMLButtonElement>("[data-close]", w)!).onclick = close;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    w.classList.add("on"); const f = o.focus ? $<HTMLElement>(o.focus, w) : $<HTMLElement>(".sheet-h h2", w);
    if (f && !o.focus) f.setAttribute("tabindex", "-1"); if (f) f.focus({ preventScroll: true });
  }));
  return { el: w, body: $(".body", w)!, foot: $(".sa-sfoot", w), close };
}
/** A.confirm({title, text, ok:"Изтрий", danger:true}, onOk) */
export function confirm(o: { title: string; text?: string; ok?: string; danger?: boolean; icon?: string }, onOk?: () => void): Sheet {
  const s = sheet({ title: o.title, html: '<p style="margin:0 0 8px">' + (o.text || "") + "</p>",
    foot: '<button class="pill pill-line pill-lg" type="button" data-no>Откажи</button><button class="pill ' + (o.danger ? "pill-red" : "pill-ink") + ' pill-lg" type="button" data-yes>' + (o.icon ? ic(o.icon, 22) : "") + esc(o.ok || "Да") + "</button>" });
  ($<HTMLButtonElement>("[data-no]", s.foot!)!).onclick = s.close;
  ($<HTMLButtonElement>("[data-yes]", s.foot!)!).onclick = () => { s.close(); if (onOk) onOk(); };
  return s;
}

/* ---------- badges in the bars: from adminApi.summary() (the same numbers as the dashboard) ---------- */
const BADGE_WORD: Record<string, [string, string]> = { orders: ["нова", "нови"], reservations: ["за потвърждаване", "за потвърждаване"], notes: ["чака теб", "чакат теб"] };
/* the visible number is aria-hidden; the link's name is built from its own text + a hidden ", 2 чакат теб" (no aria-label,
   so the name always starts with the visible word: "Бележки (молив), 2 чакат теб") */
function badge(id: string) { const n = A.badges[id] || 0, t = A.badgeTitles[id]; return '<span class="sa-n" data-badge="' + id + '"' + (n ? "" : " hidden") + (t ? ' title="' + esc(t) + '"' : "") + ' aria-hidden="true">' + n + '</span><span class="vh" data-badge-sr="' + id + '">' + badgeWords(id, n) + "</span>"; }
function badgeWords(id: string, n: number) {
  if (!n) return "";
  const word = id === "notes" && !isMainAdmin() ? "с нов статус" : (BADGE_WORD[id] || ["нова", "нови"])[n === 1 ? 0 : 1];
  return ", " + n + " " + word;
}
export function setBadge(id: string, n: number) {
  A.badges[id] = n; const t = A.badgeTitles[id];
  $$('[data-badge="' + id + '"]').forEach((el) => { el.textContent = String(n); el.hidden = !n; if (t) el.title = t; else el.removeAttribute("title"); });
  $$('[data-badge-sr="' + id + '"]').forEach((el) => { el.textContent = badgeWords(id, n); });
}
function badgesFrom(s: Summary) {
  const w = s.waiting;
  A.badges = { orders: w.orders || 0, reservations: w.reservations || 0, notes: w.notes.n };
  /* the pencil's own badge: the person's recommendations with a new status (the main admin has none) */
  if (A.pen) A.pen.setBadge(isMainAdmin() ? 0 : w.notes.changedN);
  A.badgeTitles = { notes: w.notes.title, orders: "Нови поръчки за приемане", reservations: "Резервации за потвърждаване днес" };
  Object.keys(A.badges).forEach((k) => setBadge(k, A.badges[k]));
  markFresh();
}
let sumP: Promise<Summary | null> | null = null;
/** the summary of this person ("Чака те", "Днес", the badges); again after a new order or a note */
export function loadSummary(force = false): Promise<Summary | null> {
  if (sumP && !force) return sumP;
  sumP = adminApi.summary().then((s) => { A.summary = s; badgesFrom(s); if (A.onSummary) A.onSummary(s); return s; }).catch((e) => { if (e instanceof ApiError && e.status === 401) toLogin(); throw e; });
  return sumP;
}
let sumTimer: ReturnType<typeof setTimeout> | undefined;
const refreshSoon = () => { clearTimeout(sumTimer); sumTimer = setTimeout(() => { loadSummary(true).catch(() => { /* keep the old numbers */ }); }, 250); };

/* ---------- a new online order: sound and a blinking badge (decision 15.11.2026, "Админът, допълнения" 4) ----------
   "Звук" is in the top bar (roles with "Поръчки") and is remembered on this device (localStorage "sa-sound": "on" | "off",
   "on" by default). The browser plays a sound only after the first touch: until then the key says "Звук: докоснете";
   "unlocked" is never kept between loads. */
export const soundOn = () => { try { return localStorage.getItem("sa-sound") !== "off"; } catch { return true; } };
let audioReady = false;
let AC: AudioContext | null = null;
function unlock(e?: Event) {
  if (audioReady) return;
  try { const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext; AC = AC || new C(); if (AC.resume) AC.resume(); audioReady = true; } catch { /* no audio */ }
  /* the first touch on "Звук" itself: its click redraws it (redrawing now would take the node under the finger away and lose the click) */
  const t = e && (e.target as Element | null);
  if (t && t.closest && t.closest('[data-sa="sound"]')) return;
  /* redraw only after this touch / key is done: "Звук: докоснете" -> "Звук вкл." changes the width of the button, and the
     buttons beside it would move away under the finger before the click lands (the first click on "Молив" was lost) */
  const later = () => { removeEventListener("click", later, true); removeEventListener("keyup", later, true); removeEventListener("pointercancel", later, true); setTimeout(syncSound, 0); };
  addEventListener("click", later, true); addEventListener("keyup", later, true); addEventListener("pointercancel", later, true);
}
document.addEventListener("pointerdown", unlock, { capture: true }); document.addEventListener("keydown", unlock, { capture: true });
/** two calm tones */
export function chime() {
  if (!soundOn() || !audioReady || !AC) return;
  try {
    const ac = AC, t0 = ac.currentTime;
    [[880, 0], [1320, 0.18]].forEach(([f, d]) => {
      const o = ac.createOscillator(), g = ac.createGain(); o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.25, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.32);
      o.connect(g); g.connect(ac.destination); o.start(t0 + d); o.stop(t0 + d + 0.35);
    });
  } catch { /* no audio */ }
}
function soundLabel(): [string, string] { return !soundOn() ? ["Звук изкл.", "bell"] : audioReady ? ["Звук вкл.", "bell-ringing"] : ["Звук: докоснете", "bell"]; }
/* the same key in another frame (the module of the manager draws its own button, on "ти"): it hears every change */
const soundSubs: (() => void)[] = [];
/** fn runs whenever the key "Звук" may look different: on / off, or the first touch unlocked the sound */
export function onSoundChange(fn: () => void) { soundSubs.push(fn); }
/** has the first touch unlocked the sound of the browser (never kept between loads) */
export const soundReady = () => audioReady;
/** the key "Звук" was pressed: remembered on this device ("sa-sound"), two tones when it is turned on; returns the new state */
export function toggleSound(): boolean {
  try { localStorage.setItem("sa-sound", soundOn() ? "off" : "on"); } catch { /* ignore */ }
  unlock(); syncSound(); if (soundOn()) chime();
  return soundOn();
}
export function syncSound() {
  const l = soundLabel();
  $$('[data-sa="sound"]').forEach((b) => {
    b.setAttribute("aria-pressed", String(soundOn()));
    b.innerHTML = ic(l[1], 20) + '<span class="lg">' + l[0] + '</span><span class="sm">Звук</span>';
    /* the name starts with the visible text */
    b.setAttribute("aria-label", l[0] + " · нови поръчки" + (soundOn() && !audioReady ? ", тръгва след първото докосване" : ""));
    b.classList.toggle("wait", soundOn() && !audioReady);
  });
  soundSubs.forEach((f) => f());
}
/* the badge "Поръчки" blinks until the orders are seen (opened "Поръчки", "Виж" or a link to the orders) */
const ALERT = "sa-order-alert";
export function ordersSeen() { ssSet(ALERT, null); markFresh(); }
export function markFresh() { const on = !!ssGet(ALERT); $$('[data-badge="orders"], [data-fresh="orders"]').forEach((el) => el.classList.toggle("fresh", on)); }
/** the new online order that is not seen yet (the blinking badge), or null */
export function freshOrder(): { no: string; at: number } | null { try { return JSON.parse(ssGet(ALERT) || "null"); } catch { return null; } }
let watching = false;
/** ONE watcher of the new online orders for the admin and for the module of the manager (BUILD-TODO, step 6): it marks the
    order as not seen (the blinking badge; the same key in both), plays the two tones (unless `silent`: the owner has no
    sound) and calls onNew; every other change of the orders calls onChange. Only for the roles with "Поръчки"; once a page. */
export function watchNewOrders(h: { onNew(d: { no: string }): void; onChange?(): void; silent?: boolean }): void {
  if (watching || !can("orders")) return; watching = true;
  const changed = () => { if (h.onChange) h.onChange(); };
  api.on("order.created", (raw) => {
    const d = (raw || {}) as { no?: string; status?: string; channel?: string };
    /* online = from the site (web, office); an order typed by the staff (waiter, phone) or from a QR table is not "new online" */
    const online = !d.channel || d.channel === "web" || d.channel === "office";
    if (!d.no || (d.status && d.status !== "accepted") || !online) { changed(); return; }
    ssSet(ALERT, JSON.stringify({ no: d.no, at: Date.now() }));
    if (!h.silent) chime();
    h.onNew({ no: d.no });
  });
  api.on("order.status", changed);
}
function watchOrders() {
  watchNewOrders({ onNew: (d) => {
    toast("Нова онлайн поръчка №\u00a0" + d.no, { action: { label: "Виж", href: aurl.section("orders", "n=" + d.no) }, ms: 6000, queue: true });
    if (A.onNewOrder) A.onNewOrder({ no: d.no });
    refreshSoon();
  }, onChange: refreshSoon });
}
function watchNotes() { api.on("note.created", refreshSoon); api.on("note.status", refreshSoon); }

/* ---------- chrome ---------- */
function sideHTML(cur: string) {
  const me = A.me!;
  return '<a class="sa-brand" href="' + aurl.home() + '"><span class="word">Siracusa</span><span class="sa-btag">Админ</span><span class="vh">, към таблото</span></a>' +
    '<nav class="sa-nav" aria-label="Раздели">' + GROUPS.map((g) => {
      const items = g[1].filter((id) => can(id) || id === "notes"); if (!items.length) return "";
      return '<div class="sa-g"><h2>' + esc(g[0]) + "</h2>" + items.map((id) => {
        let s = SEC[id];
        if (id === "notes" && !can("notes")) s = { id: "notes", n: "Моите препоръки", short: "Препоръки", ic: "pencil-simple", desc: "" };
        const inner = ic(s.ic, 22) + '<span class="lb">' + esc(s.n) + '</span><span class="sh">' + esc(s.short) + "</span>" + (s.soon ? '<span class="soon sa-tag soon">' + ic("sparkle", 14) + "Скоро</span>" : badge(id));
        if (s.soon) return '<button class="sa-i" type="button" data-sa="soon" data-id="' + id + '" title="' + esc(s.n) + ': скоро">' + inner + "</button>";
        return '<a class="sa-i" href="' + secHref(id) + '"' + (cur === id ? ' aria-current="page"' : "") + ' title="' + esc(s.n) + '">' + inner + "</a>";
      }).join("") + "</div>";
    }).join("") +
    (APPS.some((id) => can(id) && !["admin", "owner", "manager"].includes(me.user.role)) ? '<div class="sa-g"><h2>Приложение</h2>' + APPS.filter((id) => can(id)).map((id) => {
      const s = SEC[id];
      return '<a class="sa-i" href="' + secHref(id) + '" title="' + esc(s.n) + '">' + ic(s.ic, 22) + '<span class="lb">' + esc(s.n) + ': приложението</span><span class="sh">' + esc(s.short) + "</span></a>";
    }).join("") + "</div>" : "") + "</nav>" +
    '<div class="sa-sidefoot"><button class="sa-i sa-collapse" type="button" data-sa="side" aria-expanded="' + (prefs.side !== "mini") + '">' + ic(prefs.side === "mini" ? "caret-right" : "caret-left", 22) + '<span class="lb">Свий лентата</span><span class="sh">Разгъни</span></button></div>';
}
function topHTML(o: MountOpts) {
  const me = A.me!, s = SEC[o.section], g = groupOf(o.section), th = THEMES.find((t) => t[0] === prefs.theme) || THEMES[0], pen = o.pencil !== false;
  return '<header class="sa-top">' +
    '<div class="sa-crumb"><small class="sa-only-td">' + esc(o.crumb || g || "Админ") + "</small><b>" + esc(o.barTitle || (s && s.n) || o.title || "") + "</b></div>" +
    '<div class="sa-search sa-only-d" role="search"><label class="vh" for="sa-q">Търсене: раздели, ястия, поръчки, резервации</label>' + ic("magnifying-glass", 20) + '<input id="sa-q" type="search" placeholder="Търси навсякъде" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="sa-sres" aria-expanded="false"><span class="k" aria-hidden="true">/</span><button class="sa-clear" type="button" aria-label="Изчисти" hidden>' + ic("x", 18) + '</button><div class="sa-sres" id="sa-sres" role="listbox" aria-label="Резултати" hidden></div></div>' +
    '<button class="sa-tb sa-only-t" type="button" data-sa="sections">' + ic("magnifying-glass", 20) + "Търси</button>" +
    (pen ? '<button class="sa-tb" type="button" data-sa="pen" aria-pressed="false">' + ic("pencil-simple", 20) + "Молив</button>" : "") +
    (can("orders") ? '<button class="sa-tb sa-snd" type="button" data-sa="sound" aria-pressed="' + soundOn() + '"></button>' : "") +
    '<button class="sa-tb sa-only-d" type="button" data-sa="theme" aria-label="Тема: ' + th[1] + '. Смени">' + ic(th[2], 20) + "Тема: " + th[1] + "</button>" +
    /* the name of the button from its text: "Профил: Поли, Главен админ" (an account named like its role shows the name once);
       below 1100 px the name is only for the reader */
    '<button class="sa-me" type="button" data-sa="profile"><span class="vh">Профил: </span><span class="sa-av" aria-hidden="true">' + esc(initials(me.user.name)) + '</span><span class="who"><b>' + esc(me.user.name) + "</b>" + (me.user.name === roleName(me.user.role) ? "" : '<small><span class="vh">, </span>' + esc(roleName(me.user.role)) + "</small>") + "</span></button>" +
    '<button class="sa-tb sa-only-d" type="button" data-sa="logout">' + ic("sign-out", 20) + "Изход</button>" +
    "</header>";
}
function bnavHTML(cur: string) {
  const items = ([["dashboard", "Табло", "squares-four"], ["orders", "Поръчки", "receipt"], ["notes", can("notes") ? "Бележки" : "Препоръки", "pencil-simple"]] as [string, string, string][]).filter((x) => can(x[0]) || x[0] === "notes");
  return '<nav class="sa-bnav" aria-label="Основни раздели">' + items.map((x) => '<a href="' + secHref(x[0]) + '"' + (cur === x[0] ? ' aria-current="page"' : "") + ">" + ic(x[2], 24) + x[1] + badge(x[0]) + "</a>").join("") +
    '<button type="button" data-sa="sections"' + (["dashboard", "orders", "notes"].includes(cur) ? "" : ' aria-current="page"') + ">" + ic("list", 24) + "Раздели</button></nav>";
}
export function noRightsHTML(section: string) {
  const s = SEC[section];
  return '<section class="sa-noperm sa-card" data-edit-id="admin.noperm"><div class="ill">' + ic("lock", 44) + "</div><h1>Нямате права за този раздел.</h1><p>Ролята „" + esc(roleName(A.me!.user.role)) + "“ не вижда „" + esc(s ? s.n : section) + "“. Ако ви трябва, помолете главния админ.</p>" +
    '<a class="pill pill-ink pill-lg" href="' + aurl.home() + '">' + ic("squares-four", 22) + "Към таблото</a></section>";
}

/* ---------- the session ---------- */
function toLogin() { location.replace(aurl.login(aurl.here())); }
/** the staff session, or null (the caller decides where to go) */
export async function session(force = false): Promise<Me | null> {
  if (A.me && !force) return A.me;
  try { A.me = await staffApi.me(); } catch (e) { if (e instanceof ApiError && e.status === 401) A.me = null; else throw e; }
  return A.me;
}
export async function logout() {
  try { await staffApi.logout(); } catch { /* the cookie goes anyway on the next sign-in */ }
  location.href = aurl.login();
}

/** A.mount(opts) -> the element for the content, or null (no session / staff role: redirected; no rights: drawn) */
export async function mount(o: MountOpts): Promise<HTMLElement | null> {
  applyTheme();
  let me: Me | null = null;
  try { me = await session(); }
  catch (e) { bootFail(e); return null; }
  if (!me) { toLogin(); return null; }
  /* a staff member on an admin address goes to their module (decision 15.11.2026) */
  if (APPS.includes(me.user.role)) { location.replace(aurl.app(me.user.role)); return null; }
  document.title = (o.docTitle || o.title || (SEC[o.section] && SEC[o.section].n) || "Админ") + " | Siracusa · Админ";
  const app = document.createElement("div"); app.className = "sa-app"; app.dataset.side = prefs.side === "mini" ? "mini" : "open"; app.dataset.page = o.section;
  const allowed = can(o.section) || !!o.anyRole;
  const s = SEC[o.section] || ({} as Sec);
  const head = o.head === false ? "" : '<div class="sa-head" data-edit-id="admin.' + o.section + '.head"><div>' + (o.eyebrow !== "" ? '<span class="sa-eye">' + ic(s.ic || "squares-four", 18) + esc(o.eyebrow || groupOf(o.section) || "Админ") + "</span>" : "") + '<h1 class="sa-h1">' + esc(o.title || s.n || "") + "</h1>" + (o.sub ? '<p class="sa-sub">' + o.sub + "</p>" : "") + "</div>" + (o.actions ? '<div class="sa-acts">' + o.actions + "</div>" : "") + "</div>";
  app.innerHTML = '<aside class="sa-side" aria-label="Лента с разделите">' + sideHTML(o.section) + "</aside>" +
    '<div class="sa-col">' + topHTML(o) + '<div class="sa-scroller" data-sa-scroller><main id="main" class="sa-page' + (o.wide ? " wide" : "") + '" tabindex="-1">' + (allowed ? head + "<div data-body></div>" : noRightsHTML(o.section)) + '<div class="sa-end"></div></main></div></div>' +
    bnavHTML(o.section) + '<div class="sa-ov"></div>';
  $(".sa-boot")?.remove();
  document.body.appendChild(app);
  A.app = app; A.side = $(".sa-side", app); A.col = $(".sa-col", app); A.scroller = $(".sa-scroller", app); A.ov = $(".sa-ov", app); A.bnav = $(".sa-bnav", app);
  bindSearch(); watchTabs(); syncSound();
  if (o.section === "orders") ordersSeen();
  markFresh();
  watchOrders(); watchNotes();
  loadSummary().catch(() => { /* the badges stay hidden; the page shows its own error */ });
  try { new MutationObserver(toastUp).observe(A.col!, { subtree: true, attributes: true, attributeFilter: ["class"] }); } catch { /* old browser */ }
  if (o.pencil !== false) mountPen("admin");
  return allowed ? $<HTMLElement>("[data-body]", app) : null;
}
/** the session could not be read (no connection / server error): one calm screen with "Опитай пак" */
export function bootFail(e: unknown) {
  const b = $(".sa-boot"); if (!b) return;
  b.innerHTML = '<div style="max-width:560px; width:100%; padding:16px">' + failHTML(e, "Не успяхме да отворим админа. Проверете връзката и опитайте пак.") + "</div>";
  const r = $<HTMLButtonElement>('[data-sa="retry"]', b); if (r) r.onclick = () => location.reload();
}

/* ---------- the pencil (src/admin/pencil.ts, its own author): loaded after sign-in ---------- */
/* the modules of the manager and the owner by the name of their folder: the notes know them as "manager" / "owner"
   (src/core/notes.ts), and the pencil there writes recommendations only, whatever the role (decision 15.11.2026) */
const BOSS_PEN: Record<string, string> = { upravitel: "manager", sobstvenik: "owner" };
/** returns false when there is no pencil here (no session, or the page is inside the frame of "Модулите на живо") */
export function mountPen(module: string, slot?: HTMLElement): boolean {
  if (!A.me) return false;
  /* inside the frame of "Модулите на живо" the pencil of the preview points here; no second one */
  try { if (window.frameElement && window.frameElement.closest(".pv-dev")) return false; } catch { /* another origin */ }
  const boss = BOSS_PEN[module];
  import("./pencil.ts").then((m) => {
    A.pen = m.mountPencil({
      module: boss || module, who: who(), sectionNotes: boss ? false : can("notes"), slot, notesHref: aurl.section("notes"),
      badge: A.summary && !isMainAdmin() ? A.summary.waiting.notes.changedN : 0,
      /* the ember bar under the top bar of the admin (BRIEF, decision 3 of the chief); the staff apps have no top bar of the admin */
      barTop: APPS.includes(module) || boss ? undefined : [8, 88],
      onSave: async (n) => { await adminApi.createNote(n); refreshSoon(); },
    });
  }).catch(() => { /* without the pencil the page still works */ });
  return true;
}
function syncPen() { const on = !!A.pen && A.pen.on(); $$('[data-sa="pen"]').forEach((b) => b.setAttribute("aria-pressed", String(on))); }

/* tabs that do not fit: a fade on the edge and the selected tab fully in view */
export function fadeTabs() {
  $$<HTMLElement & { _sa?: 1 }>(".sa-tabs").forEach((t) => {
    const max = t.scrollWidth - t.clientWidth; t.classList.toggle("fl", max > 2 && t.scrollLeft > 2); t.classList.toggle("fr", max > 2 && t.scrollLeft < max - 2);
    if (!t._sa) { t._sa = 1; t.addEventListener("scroll", fadeTabs, { passive: true }); const cur = $<HTMLElement>('[aria-selected="true"],[aria-pressed="true"],[aria-current="page"]', t); if (cur && max > 2) t.scrollLeft = Math.max(0, cur.offsetLeft - t.offsetLeft - 24); }
  });
}
function watchTabs() {
  let q = 0; const run = () => { if (q) return; q = requestAnimationFrame(() => { q = 0; fadeTabs(); }); };
  try { new MutationObserver(run).observe(A.scroller!, { childList: true, subtree: true }); } catch { /* old browser */ }
  window.addEventListener("resize", run); run();
}
export function refreshSide() { if (A.side && A.app) { A.side.innerHTML = sideHTML(A.app.dataset.page || ""); Object.keys(A.badges).forEach((k) => setBadge(k, A.badges[k])); markFresh(); } }

/* ---------- the sheet "Търсене и раздели" (phone and tablet) ---------- */
function secTile(s: Sec, cur: string) {
  const meta = s.soon ? "Скоро" : groupOf(s.id);
  if (s.soon) return '<button type="button" data-sa="soon" data-id="' + s.id + '">' + ic(s.ic, 24) + esc(s.n) + "<small>" + meta + "</small></button>";
  return '<a href="' + secHref(s.id) + '"' + (cur === s.id ? ' aria-current="page"' : "") + ">" + ic(s.ic, 24) + esc(s.n) + "<small>" + esc(meta) + "</small>" + (s.id === "notes" ? badge("notes") : "") + "</a>";
}
export function sectionsHTML(cur: string, q?: string) {
  if (q) { const list = searchSections(q); return list.length ? '<div class="sa-secgrid">' + list.map((s) => secTile(s, cur)).join("") + "</div>" : '<p class="muted">Няма раздел с „' + esc(q) + "“.</p>"; }
  const apps = APPS.filter((id) => can(id));
  return GROUPS.map((g) => { const items = g[1].filter((id) => can(id)); if (!items.length) return ""; return '<h3 class="sa-sgh">' + esc(g[0]) + '</h3><div class="sa-secgrid">' + items.map((id) => secTile(SEC[id], cur)).join("") + "</div>"; }).join("") +
    (apps.length ? '<h3 class="sa-sgh">Приложения на персонала</h3><div class="sa-secgrid">' + apps.map((id) => secTile(SEC[id], cur)).join("") + "</div>" : "");
}
function openSections() {
  const cur = A.app ? A.app.dataset.page || "" : "";
  const sh = sheet({ title: "Търсене и раздели", focus: "#sa-q2", html: '<div class="sa-search sa-field-s" role="search" style="margin:4px 0 6px"><label class="vh" for="sa-q2">Търсене: раздели, ястия, поръчки, резервации</label>' + ic("magnifying-glass", 20) + '<input class="input" id="sa-q2" type="search" placeholder="Търси навсякъде" autocomplete="off" aria-controls="sa-q2r"><button class="sa-clear" type="button" aria-label="Изчисти" hidden>' + ic("x", 18) + '</button></div><div data-list id="sa-q2r" role="listbox" aria-label="Резултати">' + sectionsHTML(cur) + "</div>" });
  sh.el.classList.add("sa-tall");
  const inp = $<HTMLInputElement>("#sa-q2", sh.body)!, box = $("[data-list]", sh.body)!, clr = $<HTMLButtonElement>(".sa-clear", sh.body)!;
  let open: Record<string, boolean> = {}, lastQ = "";
  const draw = () => { const q = inp.value.trim(); if (q !== lastQ) { open = {}; lastQ = q; } clr.hidden = !q; if (!q) { box.innerHTML = sectionsHTML(cur); return; } search(q, open, (h) => { if (inp.value.trim() === q) box.innerHTML = h; }, "q2"); };
  box.addEventListener("click", (e) => { const m = (e.target as Element).closest<HTMLElement>("[data-smore]"); if (!m) return; e.preventDefault(); open[m.dataset.smore!] = true; draw(); });
  inp.addEventListener("input", draw); clr.addEventListener("click", () => { inp.value = ""; draw(); inp.focus(); });
  inp.addEventListener("focus", () => preloadSearch(), { once: true });
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { const a = $<HTMLElement>("a[href], button[data-ask]", box); if (a) { e.preventDefault(); a.click(); } } });
}
function openProfile() {
  const me = A.me!, r = ROLES[me.user.role] || { n: me.user.role, desc: "" };
  sheet({ title: "Профил", html: '<div class="sa-prof"><span class="sa-av" aria-hidden="true">' + esc(initials(me.user.name)) + "</span><div><b>" + esc(me.user.name) + '</b><span class="muted">' + esc(r.n) + " · потребител " + esc(me.user.username) + '</span></div></div><p class="muted" style="margin:0 0 16px">' + esc(r.desc) + "</p>" +
    '<p class="label" style="margin:0 0 8px">Тема</p><div class="seg" role="group" aria-label="Тема">' + THEMES.map((t) => '<button type="button" data-sa="settheme" data-v="' + t[0] + '" aria-pressed="' + (prefs.theme === t[0]) + '">' + ic(t[2], 20) + t[1] + "</button>").join("") + "</div>",
  foot: '<button class="pill pill-line pill-lg pill-block" type="button" data-sa="logout">' + ic("sign-out", 22) + "Изход</button>" });
}
export function soonSheet(id: string) {
  const s = SEC[id];
  sheet({ title: s.n, html: '<p style="margin:0 0 12px">' + soonTag() + '</p><p style="margin:0 0 8px">' + esc(s.desc) + '</p><p class="muted" style="margin:0">Разделът ще се появи след модулите на управителя и собственика. Сега е видим, за да е пълна картата на правата.</p>' });
}

/* ---------- "Търси навсякъде" (decision 15.11.2026: "Умна търсачка = асистентът") ----------
   One field: the sections and the dishes in the browser (src/lib/search.ts, loaded on first use), people and numbers from
   adminApi.search (checked by role on the server), notes ("Моите препоръки" for the roles without "Бележки").
   "Попитай AI" is only the flow: the link to Claude is stage E. */
const OST: Record<string, string> = { accepted: "Приета", cooking: "Готви се", ready: "Готова", on_way: "На път", delivered: "Доставена", picked_up: "Взета", served: "Сервирана", cancelled: "Отказана" };
const RST: Record<string, string> = { new: "Нова", confirmed: "Потвърдена", seated: "Дошли", no_show: "Неявили се", cancelled: "Отказана", waitlist: "Чака маса" };
const NST: Record<string, string> = { new: "Нова", approved: "Одобрена", doing: "В изпълнение", review: "За преглед", published: "Публикувана", rejected: "Отхвърлена" };
const MODN: Record<string, string> = { site: "Клиентски сайт", masa: "QR маса", waiter: "Сервитьор", watch: "Часовник", kitchen: "Кухня", driver: "Шофьор", admin: "Админ" };
type DishMod = { items: { id: string; n: string; p: number; cat: string; comp: string; al: readonly string[]; t: readonly string[] }[]; catById: Record<string, { n: string }>; searchDishes: typeof import("../lib/search.ts").searchDishes };
let dishP: Promise<DishMod> | null = null;
const dishesOn = () => can("menu") || can("lunch");
function loadDishes(): Promise<DishMod> {
  if (!dishP) dishP = import("./dishes.ts").then((d) => ({ items: d.items, catById: d.catById, searchDishes: d.searchDishes }));
  return dishP;
}
let notesP: Promise<FeedbackNote[]> | null = null;
function loadNotes(): Promise<FeedbackNote[]> {
  if (!notesP) notesP = (can("notes") ? adminApi.notes() : adminApi.myNotes()).catch(() => []);
  return notesP;
}
function preloadSearch() { if (dishesOn()) loadDishes().catch(() => { dishP = null; }); loadNotes(); }
interface Item { href: string; soon?: string; icon: string; title: string; meta: string }
interface Group { key: string; title: string; items: Item[]; more: number; exact: boolean; i: number; wait?: boolean }
const digits = (x: string) => String(x || "").replace(/\D/g, "");
let people: { q: string; p: Promise<SearchAnswer | null> } | null = null;
let peopleT: ReturnType<typeof setTimeout> | undefined;
/** people and numbers from the server (debounced, one request per query) */
function askPeople(q: string): Promise<SearchAnswer | null> {
  if (people && people.q === q) return people.p;
  const p = new Promise<SearchAnswer | null>((res) => { clearTimeout(peopleT); peopleT = setTimeout(() => { adminApi.search(q).then(res, () => res(null)); }, 180); });
  people = { q, p }; return p;
}
/** groups for a query; cb is called with the HTML once now and again when the server and the dishes answer */
export function search(q: string, open: Record<string, boolean>, cb: (html: string) => void, pre: string) {
  const nq = norm(q), dq = digits(q), txt = nq.replace(/[^a-z ]/g, "").trim().length >= 3;
  let ans: SearchAnswer | null | undefined, dm: DishMod | null = null, notes: FeedbackNote[] | null = null;
  const render = () => cb(searchHTML(q, groups(), pre));
  function groups(): Group[] {
    const out: Group[] = [];
    const grp = (key: string, title: string, items: Item[], exact = false) => { if (!items.length) return; const cut = open[key] ? 60 : 5; out.push({ key, title, items: items.slice(0, cut), more: Math.max(0, items.length - cut), exact, i: out.length }); };
    grp("sec", "Раздели", searchSections(q).map((s) => ({ href: s.soon ? "" : secHref(s.id), soon: s.soon ? s.id : "", icon: s.ic, title: s.n, meta: s.soon ? "Скоро" : groupOf(s.id) })));
    const peopleOn = can("customers") || can("orders") || can("reservations");
    if (peopleOn && (txt || dq.length >= 3)) {
      if (ans === undefined) out.push({ key: "wait-p", title: "Поръчки, резервации и клиенти", items: [], more: 0, exact: false, i: out.length, wait: true });
      else if (ans) {
        const mapH = (l: SearchHit[] | null, f: (h: SearchHit) => Item) => (l || []).map(f);
        grp("cus", "Клиенти", mapH(ans.customers, (h) => ({ href: secHref("customers"), icon: "user", title: h.title, meta: h.phone })), !!ans.customers && ans.customers.some((h) => h.exact));
        grp("ord", "Поръчки", mapH(ans.orders, (h) => ({ href: secHref("orders", "n=" + h.id), icon: "receipt", title: h.title + " · " + (OST[h.status || ""] || h.status || ""), meta: [h.date ? fmtYmd(h.date) : "", h.time || "", h.phone].filter(Boolean).join(" · ") })), !!ans.orders && ans.orders.some((h) => h.exact));
        grp("res", "Резервации", mapH(ans.reservations, (h) => ({ href: secHref("reservations", "d=" + (h.date || "")), icon: "calendar-check", title: h.title + (h.time ? " · " + h.time : ""), meta: [h.date ? fmtYmd(h.date) : "", h.people ? plural(h.people, "човек", "души") : "", RST[h.status || ""] || h.status || ""].filter(Boolean).join(" · ") })), !!ans.reservations && ans.reservations.some((h) => h.exact));
      }
    }
    if (dishesOn()) {
      if (!dm) out.push({ key: "wait", title: "Ястия", items: [], more: 0, exact: false, i: out.length, wait: true });
      else {
        const r = dm.searchDishes(dm.items, q), m = dm;
        const dish = (x: DishMod["items"][number]): Item => ({ href: secHref("menu", "d=" + x.id), icon: "fork-knife", title: x.n, meta: (m.catById[x.cat] ? m.catById[x.cat].n + " · " : "") + fmt(x.p) });
        const exc = (r.query && r.query.exc || []).map((w) => w.label), excT = exc.length ? "Без " + exc.join(" и ") + " по състава" : "";
        grp("dish", r.query && r.query.inc && r.query.inc.length ? "Ястия" : excT || "Ястия", r.name.map(dish));
        if (r.comp.length) grp("dishc", r.band || "Съдържат", r.comp.map(dish));
        if (r.rest.length && !r.name.length && !r.comp.length) grp("dishr", excT || "Ястия", r.rest.map(dish));
        if (r.unknown.length) grp("dishu", "Нямаме пълен състав, попитайте ни", r.unknown.map(dish));
      }
    }
    if (txt && notes) grp("note", can("notes") ? "Бележки" : "Моите препоръки", notes.filter((n) => norm(n.text + " " + (n.elementText || "")).includes(nq))
      .map((n) => ({ href: secHref("notes", "s=" + n.status), icon: "pencil-simple", title: n.text, meta: (NST[n.status] || n.status) + " · " + (MODN[n.module] || n.module) })));
    /* the group with the exact match first */
    return out.sort((a, b) => (b.exact ? 1 : 0) - (a.exact ? 1 : 0) || a.i - b.i);
  }
  render();
  const jobs: Promise<unknown>[] = [];
  if ((can("customers") || can("orders") || can("reservations")) && (txt || dq.length >= 3)) jobs.push(askPeople(q).then((a) => { ans = a; render(); }));
  if (dishesOn()) jobs.push(loadDishes().then((m) => { dm = m; render(); }, () => { dishP = null; }));
  if (txt) jobs.push(loadNotes().then((l) => { notes = l; if (l.length) render(); }));
}
function searchHTML(q: string, g: Group[], pre: string) {
  let i = 0, any = false;
  const h = g.map((gr) => {
    if (gr.wait) return '<div class="sa-rg"><h3>' + esc(gr.title) + '</h3><p class="none" role="status">Търсим …</p></div>';
    any = true;
    return '<div class="sa-rg"><h3>' + esc(gr.title) + "</h3>" + gr.items.map((it) => {
      const id = "sa-" + pre + "-" + i++;
      return it.soon ? '<button type="button" role="option" id="' + id + '" data-sa="soon" data-id="' + it.soon + '">' + ic(it.icon, 20) + "<span><b>" + esc(it.title) + "</b><small>" + esc(it.meta) + "</small></span></button>"
        : '<a href="' + it.href + '" role="option" id="' + id + '">' + ic(it.icon, 20) + "<span><b>" + esc(it.title) + "</b>" + (it.meta ? "<small>" + esc(it.meta) + "</small>" : "") + "</span></a>";
    }).join("") + (gr.more ? '<button class="sa-more" type="button" role="option" id="sa-' + pre + "-m-" + gr.key + '" data-smore="' + gr.key + '" aria-label="Покажи още ' + gr.more + " в „" + esc(gr.title) + '“">' + ic("caret-down", 18) + "Покажи още " + gr.more + "</button>" : "") + "</div>";
  }).join("");
  const waiting = g.some((x) => x.wait);
  return (any || waiting ? h : '<p class="none">Нищо не намерихме за „' + esc(q) + "“. Опитайте с друга дума, № на поръчка или последните цифри на телефон.</p>") +
    '<button class="sa-ask" type="button" role="option" id="sa-' + pre + '-ai" data-ask="' + esc(q) + '">' + ic("sparkle", 20) + "<span><b>Попитай AI: „" + esc(q) + "“</b><small>Свързването с Claude е етап E</small></span></button>";
}
/** "Попитай AI": only the flow; the answer lists what the plain search found (stage E connects Claude) */
function askAI(q: string) {
  const s0 = sheet({ title: "Попитай AI", html: '<p class="sa-tag sample" style="margin:0 0 12px">' + ic("info", 16) + "Пример: свързването с Claude е етап E</p>" +
    '<div class="msg me" style="margin-left:auto">' + esc(q) + '</div><div class="msg bot" data-ans><span class="typing" aria-label="Мисли"><span></span><span></span><span></span></span></div>' });
  let last = "";
  search(q, {}, (h) => { last = h; }, "ai");
  setTimeout(() => {
    const a = $("[data-ans]", s0.el); if (!a) return;
    const tmp = document.createElement("div"); tmp.innerHTML = last;
    const parts = $$(".sa-rg", tmp).filter((g) => $$("[role=option]:not(.sa-more)", g).length).map((g) => $("h3", g)!.textContent + ": " + $$("[role=option]:not(.sa-more) b", g).slice(0, 3).map((b) => b.textContent).join(", ") + ($$("[role=option]", g).length > 3 ? " …" : ""));
    a.innerHTML = parts.length ? '<p>Ето какво намерих в данните, до които имате достъп:</p><ul class="ailist">' + parts.map((p) => "<li>" + esc(p) + "</li>").join("") + "</ul><p>Отговарям само от тях; каквото липсва, казвам „попитайте ни“.</p>"
      : "<p>Не намерих нищо по този въпрос в данните, до които имате достъп. Опитайте с № на поръчка, телефон или име на ястие.</p>";
  }, 900);
}
function bindSearch() {
  const app = A.app!, inp0 = $<HTMLInputElement>("#sa-q", app); if (!inp0) return; const inp = inp0;
  const box = $("#sa-sres", app)!, clr = $<HTMLButtonElement>(".sa-top .sa-clear", app)!, kbd = $(".sa-top .sa-search .k", app)!;
  let sel = -1, open: Record<string, boolean> = {}, lastQ = "";
  const opts = () => $$<HTMLElement>("[role=option]", box);
  const mark = () => { const o = opts(); o.forEach((el, i) => el.setAttribute("aria-selected", String(i === sel))); if (o[sel]) { inp.setAttribute("aria-activedescendant", o[sel].id); o[sel].scrollIntoView({ block: "nearest" }); } else inp.removeAttribute("aria-activedescendant"); };
  const show = (h: string) => { box.innerHTML = h; box.hidden = false; inp.setAttribute("aria-expanded", "true"); if (sel >= opts().length) sel = -1; mark(); };
  function draw() {
    const q = inp.value.trim(); if (q !== lastQ) { open = {}; lastQ = q; } clr.hidden = !q; kbd.hidden = !!q; sel = -1;
    if (!q) {
      show('<div class="sa-rg"><h3>Раздели</h3>' + visibleSections().slice(0, 6).map((s, i) => '<a href="' + (s.soon ? "#" : secHref(s.id)) + '" role="option" id="sa-q-s' + i + '"' + (s.soon ? ' data-sa="soon" data-id="' + s.id + '"' : "") + ">" + ic(s.ic, 20) + "<span><b>" + esc(s.n) + "</b><small>" + esc(s.soon ? "Скоро" : groupOf(s.id)) + "</small></span></a>").join("") + '</div><p class="hint">Търсете раздел, ястие („без лук“, „пиле“), № на поръчка или телефон.</p>');
      return;
    }
    search(q, open, (h) => { if (inp.value.trim() === q && document.activeElement === inp) { const y = box.scrollTop; show(h); box.scrollTop = y; } }, "q");
  }
  const hide = () => { box.hidden = true; inp.setAttribute("aria-expanded", "false"); inp.removeAttribute("aria-activedescendant"); };
  inp.addEventListener("focus", () => { draw(); preloadSearch(); }); inp.addEventListener("input", draw);
  clr.addEventListener("mousedown", (e) => e.preventDefault()); clr.addEventListener("click", () => { inp.value = ""; draw(); inp.focus(); });
  inp.addEventListener("keydown", (e) => {
    const o = opts();
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(o.length - 1, sel + 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); mark(); }
    else if (e.key === "Enter") { const t = o[sel >= 0 ? sel : 0]; if (t) { e.preventDefault(); t.click(); } }
    else if (e.key === "Escape") { if (inp.value) { inp.value = ""; draw(); } else { hide(); inp.blur(); } }
  });
  box.addEventListener("mousedown", (e) => e.preventDefault());
  box.addEventListener("click", (e) => { const m = (e.target as Element).closest<HTMLElement>("[data-smore]"); if (!m) return; e.preventDefault(); open[m.dataset.smore!] = true; draw(); });
  inp.addEventListener("blur", () => setTimeout(hide, 150));
  document.addEventListener("keydown", (e) => { if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || ({} as Element)).tagName || "") && !$(".sa-ov .sheetwrap.on") && inp.offsetParent) { e.preventDefault(); inp.focus(); } });
}

/* ---------- delegation ---------- */
document.addEventListener("click", (e) => {
  const tg = e.target as Element;
  const ask = tg.closest<HTMLElement>("[data-ask]"); if (ask) { e.preventDefault(); askAI(ask.dataset.ask || ""); return; }
  /* a link to the orders: they are seen, the badge stops blinking */
  const ao = tg.closest<HTMLAnchorElement>("a[href]");
  if (ao && ssGet(ALERT) && ao.href.split("#")[0] === new URL(secHref("orders"), location.href).href.split("#")[0]) ssSet(ALERT, null);
  const t = tg.closest<HTMLElement>("[data-sa]"); if (!t) return; const a = t.dataset.sa;
  if (a === "sections") { openSections(); return; }
  if (a === "profile") { openProfile(); return; }
  if (a === "logout") { logout(); return; }
  if (a === "theme") {
    const i = THEMES.findIndex((x) => x[0] === prefs.theme), th = THEMES[(i + 1) % THEMES.length]; prefs.theme = th[0]; savePrefs(); applyTheme();
    t.innerHTML = ic(th[2], 20) + "Тема: " + th[1]; t.setAttribute("aria-label", "Тема: " + th[1] + ". Смени"); return;
  }
  if (a === "settheme") {
    prefs.theme = t.dataset.v as Theme; savePrefs(); applyTheme(); $$('[data-sa="settheme"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === prefs.theme)));
    const tb = A.app && $('[data-sa="theme"]', A.app), th2 = THEMES.find((x) => x[0] === prefs.theme)!; if (tb) { tb.innerHTML = ic(th2[2], 20) + "Тема: " + th2[1]; tb.setAttribute("aria-label", "Тема: " + th2[1] + ". Смени"); } return;
  }
  if (a === "side") { prefs.side = prefs.side === "mini" ? "open" : "mini"; savePrefs(); if (A.app) A.app.dataset.side = prefs.side; refreshSide(); return; }
  if (a === "pen") { if (A.pen) { A.pen.toggle(); syncPen(); } return; }
  if (a === "soon") { e.preventDefault(); soonSheet(t.dataset.id || ""); return; }
  if (a === "sound") { toast(toggleSound() ? "Звукът за нови поръчки е включен" : "Звукът за нови поръчки е изключен"); return; }
  if (a === "retry") { location.reload(); return; }
});
window.addEventListener("resize", () => toastUp());
/* any page that shows or hides its own bar (.on): the toast moves by itself; one observer for all screens */
let toastRaf = 0;
try { new MutationObserver(() => { if (toastRaf) return; toastRaf = requestAnimationFrame(() => { toastRaf = 0; toastUp(); }); }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"] }); } catch { /* old browser */ }
export { reduceMotion, esc, ic, fmt, plural };
