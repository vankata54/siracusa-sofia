/* Siracusa · the ONE frame of the modules "Управител" (/upravitel/) and "Собственик" (/sobstvenik/), stage D, step 6.
   From the approved prototypes (design/pages-upravitel/_mgr.js MG.mount, design/pages-sobstvenik/_own.js O.mount): the same
   frame, different content. The styles and the content classes (mg-, ow-) are in ./boss.css. Everything is on "ти".

   ==================================== THE API (for the authors of the screens) ====================================
   mountBoss(opts: BossOpts): Promise<Boss | null>
       Reads the session and draws the frame: the top bar (H1 + "Управител · Siracusa"; "Търси", "Звук" for the manager,
       "Към админа", the profile), the bottom nav with 4 tabs and the pencil on its row (phone), the left rail 104 px with
       the pencil at its bottom (from 900 px), the bar "Няма връзка". Returns null when the page is left (no session ->
       the sign-in with #next=; a role without the module -> its own home) or when "Нямаш права за този екран." is drawn
       (the tab needs a section the role does not have). Otherwise the handle below; boss.body holds the skeleton.
     opts.module   "upravitel" | "sobstvenik"
     opts.tab      "now" | "hall" | "team" | "more"  /  "today" | "trends" | "finance" | "decisions" (the active tab)
     opts.title    the H1 ("Сега"); opts.docTitle: the <title> when it differs
     opts.needs    sections, one is enough (default by tab: "hall": hall or reservations; "team": staff)
     opts.search   {label?, placeholder?, phonePlaceholder?, load()}: the result provider, loaded on the first open
   boss.me / boss.role / boss.module / boss.tab            the session (Me), the role id, the module, the active tab
   boss.main / boss.body                                   <main id="main"> and the mount point inside it (data-body)
   boss.can(section): boolean                              does the role see the section (the main admin: always)
   boss.sheet({title, html?, foot?, focus?, onClose?}): BossSheet     a sheet (bottom on the phone, right from 900 px):
       focus trap, the page behind is inert, Esc and the scrim close it, the focus returns. {el, body, foot, close()}
   boss.confirm({title, text?, html?, ok?, no?, danger?, icon?}, onOk?): BossSheet     a sheet with "Откажи" and the action
   boss.toast(text, {undo?, undoLabel?, action?: {label, href? | fn?}, ms?})     one at a time, at the top under the bar;
       with undo: the button "Отмени" for 6 s, then "Отменено"
   boss.skeleton(n?, label?): string                       loading: aria-hidden blocks + a hidden role="status"
   boss.empty({icon?, title, text?, action?, lock?}): string                     the polite empty state (text and action: HTML)
   boss.error(text?, title?): string                       what happened + "Опитай пак" (runs the onRetry handlers)
   boss.noRights(section): string                          "Нямаш права за този екран." + which section + the way back
   boss.onRetry(fn): void                                  "Опитай пак" (the error and the offline bar) and "the connection is back"
   boss.loaded(): void                                     call after every successful load: the time in the offline bar
   boss.offline(): boolean                                 is the bar "Няма връзка · Показваме данните от HH:MM" shown
   boss.onLive(fn(type, data), types?): () => void         real-time events (SSE on the server, BroadcastChannel in the demo)
   boss.badge(tab, n | null, words?)                       the number on a tab; null: back to the frame's own number
       (the frame counts "Сега" = "Чака те" of the admin summary, "Решения" = the no-shows; the screens set the full number)
   boss.freshOrder(): string | null / boss.orderSeen()     the new online order that is not seen yet (the blinking badge)
   boss.say(text)                                          a hidden aria-live line (what changed)
   boss.searchSections(q): string                          the group "Раздели на админа" for a search provider
   boss.logout()                                           sign out, to the sign-in
   HTML helpers (plain functions, also on the handle): tag(cls, icon, word) · cnt(n, hot?) · delta(cur, prev, opts?) ·
     sample(text?) · missing(text) · and ic, esc, plural from the admin runtime.
   A search provider: {results(q, more): string | Promise<string>}: for q === "" the start screen; else groups
     <section class="mg-fgrp" aria-label="Маси"><h2>Маси<span class="muted">2</span></h2> plain links (a.mg-frow / a.ow-fr)
     </section>. The shell does the keys (down from the field to the first link, the arrows between the links, up from the
     first and Esc back to the field, Enter opens the first), counts the links for the aria-live line and understands
     <button data-fq="нова заявка"> (fills the field) and <button data-fmore="key"> (more[key] = true, drawn again).
   ================================================================================================================= */
import "sc-icons:magnifying-glass,bell,bell-ringing,squares-four,chart-bar,clock,chair,users-three,dots-three,house,wallet,list-checks,x,caret-right,caret-up,caret-down,minus,arrow-counter-clockwise,arrow-clockwise,warning-circle,warning,lock,check-circle,pencil-simple,sign-out,circles-three,sun,moon,info";
import { api } from "../../client/api.ts";
import { staffApi, ApiError, type Me } from "../../client/api-admin.ts";
import type { Summary } from "../../core/index.ts";
import {
  A, session, logout, mountPen, can, loadSummary, bootFail, soundOn, soundReady, toggleSound, onSoundChange, watchNewOrders,
  freshOrder, ordersSeen, initials, roleName, norm, visibleSections, groupOf, secHref, SEC, ic, esc, plural,
} from "../../admin/a.ts";
import { aurl } from "../../admin/routes.ts";
import { murl, type UpravitelScreen, type SobstvenikScreen } from "../routes.ts";
import { keptCount, dropAll } from "./outbox.ts";
import { homeHref, switchHome, bossAllowed, bossHref, bossModuleOf, type BossModule, type HomeChoice } from "./home.ts";

export type { BossModule };
export type BossTab = "now" | "hall" | "team" | "more" | "today" | "trends" | "finance" | "decisions";
export interface BossSearch {
  /** the HTML of the results; "" is the start screen. `more`: the groups opened with "Покажи още" */
  results(q: string, more: Record<string, boolean>): string | Promise<string>;
}
export interface BossSearchOpts {
  /** the hidden label of the field ("Търси маса, поръчка …") */
  label?: string;
  /** the hint in the field on the computer and on the phone */
  placeholder?: string; phonePlaceholder?: string;
  /** the provider (its own chunk: `() => import("./find.ts").then((m) => m.provider(boss))`), loaded on the first open */
  load(): Promise<BossSearch>;
}
export interface BossOpts {
  module: BossModule; tab: BossTab; title: string; docTitle?: string;
  /** the sections the screen needs (one is enough); default by tab */
  needs?: string[];
  search?: BossSearchOpts;
}
export interface BossSheet { el: HTMLElement; body: HTMLElement; foot: HTMLElement | null; close(): void }
export interface SheetOpts { title: string; html?: string; foot?: string; focus?: string; onClose?: () => void }
export interface ConfirmOpts { title: string; text?: string; html?: string; ok?: string; no?: string; danger?: boolean; icon?: string }
export interface ToastOpts { undo?: () => void; undoLabel?: string; action?: { label: string; href?: string; fn?: () => void }; ms?: number }
export interface EmptyOpts { icon?: string; title: string; text?: string; action?: string; lock?: boolean }
export interface DeltaOpts { inv?: boolean; more?: string; less?: string; vs?: string; chip?: boolean; none?: string }
export interface Boss {
  me: Me; role: string; module: BossModule; tab: BossTab;
  main: HTMLElement; body: HTMLElement;
  can(section: string): boolean;
  sheet(o: SheetOpts): BossSheet;
  confirm(o: ConfirmOpts, onOk?: () => void): BossSheet;
  toast(text: string, o?: ToastOpts): void;
  skeleton(n?: number, label?: string): string;
  empty(o: EmptyOpts): string;
  error(text?: string, title?: string): string;
  noRights(section: string): string;
  onRetry(fn: () => void): void;
  loaded(): void;
  offline(): boolean;
  onLive(fn: (type: string, data: unknown) => void, types?: string[]): () => void;
  badge(tab: BossTab, n: number | null, words?: [string, string]): void;
  freshOrder(): string | null;
  orderSeen(): void;
  say(text: string): void;
  searchSections(q: string): string;
  logout(): void;
  tag: typeof tag; cnt: typeof cnt; delta: typeof delta; sample: typeof sample; missing: typeof missing;
}

/* ---------- the tabs (the names are fixed in BRIEF-STEP5, section 3; the addresses in src/modules/routes.ts) ---------- */
interface TabDef { id: BossTab; n: string; ic: string; screen: string; needs?: string[] }
const TABS: Record<BossModule, TabDef[]> = {
  upravitel: [
    { id: "now", n: "Сега", ic: "clock", screen: "" },
    { id: "hall", n: "Залата", ic: "chair", screen: "zalata", needs: ["hall", "reservations"] },
    { id: "team", n: "Екипът", ic: "users-three", screen: "ekipat", needs: ["staff"] },
    { id: "more", n: "Още", ic: "dots-three", screen: "oshte" },
  ],
  sobstvenik: [
    { id: "today", n: "Днес", ic: "house", screen: "" },
    { id: "trends", n: "Тенденции", ic: "chart-bar", screen: "tendentsii" },
    { id: "finance", n: "Финанси", ic: "wallet", screen: "finansi" },
    { id: "decisions", n: "Решения", ic: "list-checks", screen: "reshenia" },
  ],
};
const NAME: Record<BossModule, string> = { upravitel: "Управител", sobstvenik: "Собственик" };
/** the address of a tab of a module */
export function tabHref(module: BossModule, tab: BossTab, hash?: string): string {
  const t = TABS[module].find((x) => x.id === tab) || TABS[module][0];
  return module === "upravitel" ? murl.upravitel(t.screen as UpravitelScreen, hash) : murl.sobstvenik(t.screen as SobstvenikScreen, hash);
}
/* the words of the search field, from the prototypes (a provider may give its own) */
const FIND: Record<BossModule, { label: string; ph: string; phone: string }> = {
  upravitel: { label: "Търси маса, поръчка, резервация, човек от смяната или ястие", ph: "Търси: маса, №, ястие", phone: "Маса, №, час, ястие" },
  sobstvenik: { label: "Търси ястие, показател, поръчка", ph: "Търси: ястие, оборот", phone: "Ястие или показател" },
};
/* the real-time events a screen of these modules may care about (docs/MODULES-BRIEF.md, section 4; src/core) */
const LIVE = ["order.created", "order.status", "order.changed", "order.line", "reservation.created", "reservation.status", "note.created", "note.status",
  "settings", "menu.soldout", "kitchen.busy", "floor.session", "floor.call", "floor.qr", "driver.course", "shift.update"];

/* ---------- small helpers ---------- */
const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));
/** "19:41" in Sofia */
function hmOf(d: Date): string {
  try { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Sofia", hour: "2-digit", minute: "2-digit", hour12: false }).format(d).split(":"); return String(+p[0] % 24).padStart(2, "0") + ":" + p[1]; }
  catch { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
}
const themeNow = (): string => { try { const t = JSON.parse(localStorage.getItem("sa-prefs") || "{}").theme; return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; } };

/* ---------- HTML helpers for the screens ---------- */
/** a status tag: icon + word (the colour never alone). cls: "" | red | ember | warn | ok | line */
export function tag(cls: string, icon: string, word: string): string { return '<span class="mg-tag ' + (cls || "") + '">' + (icon ? ic(icon, 16) : "") + esc(word) + "</span>"; }
/** the count chip beside a heading */
export function cnt(n: number | string, hot = false): string { return '<span class="mg-cnt' + (hot ? " hot" : "") + '">' + esc(String(n)) + "</span>"; }
export const sample = (t?: string): string => '<span class="mg-sample">' + ic("info", 16) + esc(t || "Примерни данни") + "</span>";
export const missing = (t: string): string => '<span class="missing">[ЛИПСВА: ' + esc(t) + "]</span>";
/** the difference "sign + % + word" (the colour only on the icon). inv: more is bad (no-shows, costs). null without a base. */
export function delta(cur: number, prev: number, o: DeltaOpts = {}): string {
  if (!prev) return o.none != null ? o.none : "";
  const p = Math.round(((cur - prev) / prev) * 100);
  const cls = p === 0 ? "flat" : (p > 0) !== !!o.inv ? "up" : "down", word = p === 0 ? "без промяна" : p > 0 ? o.more || "повече" : o.less || "по-малко";
  return '<span class="ow-d ' + cls + (o.chip ? " dchip" : "") + '"><span class="p">' + ic(p === 0 ? "minus" : p > 0 ? "caret-up" : "caret-down", 18) + (p > 0 ? "+" : "") + p + '%</span><small><span class="w">' + word + "</span>" + (o.vs ? " " + esc(o.vs) : "") + "</small></span>";
}

/* ---------- the frame ---------- */
export async function mountBoss(o: BossOpts): Promise<Boss | null> {
  const mod = o.module, tabs = TABS[mod], cur = tabs.find((t) => t.id === o.tab) || tabs[0];
  let me: Me | null = null;
  try { me = await session(); } catch (e) { bootFail(e); return null; }
  /* no session: the sign-in, and back here after it */
  if (!me) { location.replace(aurl.login(murl.here())); return null; }
  const role = me.user.role, uname = me.user.username, M = me;
  /* a role without this module: its own home (the staff in their app, the manager by the remembered choice, else the dashboard) */
  if (!bossAllowed(mod, role)) { location.replace(homeHref(role, uname)); return null; }
  const isOwner = role === "owner", own = bossModuleOf(role);
  /* an account named like its role ("Управител"): the name once (as in the admin) */
  const sameName = M.user.name === roleName(role);
  /* "Звук" is for the one who accepts the orders: the manager and the main admin, never the owner (decision 16.11.2026) */
  const hasSound = mod === "upravitel" && !isOwner && can("orders");
  const P = mod === "upravitel" ? "mg" : "ow";
  document.title = (o.docTitle || o.title) + " | Siracusa · " + NAME[mod];

  /* "Към админа": the manager and the owner leave their own module, a remembered choice follows them; a guest here
     (the owner in "Смяната сега", the main admin) changes nothing */
  const homeAttr = own === mod ? ' data-home="admin"' : "";
  const fo = o.search || ({} as Partial<BossSearchOpts>), F = FIND[mod];

  const navLinks = (cls: string) => tabs.map((t) =>
    '<a' + (cls ? ' class="' + cls + '"' : "") + ' href="' + tabHref(mod, t.id) + '"' + (t.id === cur.id ? ' aria-current="page"' : "") + ">" + ic(t.ic, mod === "upravitel" ? 26 : 24) + "<span>" + t.n + '</span><span class="vh" data-nbv="' + t.id + '"></span><span class="bs-n" data-nb="' + t.id + '" aria-hidden="true" hidden></span></a>').join("");
  const topHTML = '<header class="bs-top" data-edit-id="' + mod + '.top"><div class="bs-tt"><h1>' + esc(o.title) + "</h1><span>" + NAME[mod] + " · Siracusa</span></div>" +
    '<div class="bs-dsearch" role="search"><div class="bs-q"><label class="vh" for="bs-q">' + esc(fo.label || F.label) + "</label>" + ic("magnifying-glass", 20) +
      '<input class="input" id="bs-q" type="search" placeholder="' + esc(fo.placeholder || F.ph) + '" autocomplete="off" spellcheck="false"><span class="k" aria-hidden="true">/</span><button class="clr" type="button" aria-label="Изчисти търсенето" hidden>' + ic("x", 18) + "</button></div>" +
      '<div class="bs-dpanel" id="bs-dres" role="region" aria-label="Резултати от търсенето" hidden></div></div>' +
    '<button class="bs-tb bs-only-p" type="button" data-bs="find">' + ic("magnifying-glass", 24) + "<span>Търси</span></button>" +
    (hasSound ? '<button class="bs-tb bs-snd" type="button" data-bs="sound"></button>' : "") +
    (mod === "upravitel" && isOwner ? '<a class="pill pill-line bs-toadmin" href="' + bossHref("sobstvenik") + '">' + ic("chart-bar", 20) + "Към Собственик</a>" : "") +
    '<a class="pill pill-line bs-toadmin" href="' + aurl.home() + '"' + homeAttr + ">" + ic("squares-four", 20) + "Към админа</a>" +
    '<button class="bs-me" type="button" data-bs="profile"><span class="bs-av" aria-hidden="true">' + esc(initials(M.user.name)) + '</span><span class="who"><b>' + esc(M.user.name) + "</b>" + (sameName ? "" : "<small>" + esc(roleName(role)) + "</small>") + '</span><span class="vh">Профил на ' + esc(M.user.name) + "</span></button></header>";

  const app = document.createElement("div"); app.className = "bs-app"; app.dataset.mod = mod; app.dataset.tab = cur.id;
  app.innerHTML = '<div class="bs-col">' + topHTML +
    '<div class="bs-net" role="status" hidden>' + ic("warning-circle", 22) + '<span data-net></span><button type="button" data-bs="retry">' + ic("arrow-clockwise", 18) + "Опитай пак</button></div>" +
    '<main id="main" class="bs-main" tabindex="-1"><div data-body></div></main><div class="bs-end"></div></div>';
  const ov = document.createElement("div"); ov.className = "bs-ov"; ov.dataset.mod = mod;
  ov.innerHTML = '<nav class="bs-rail" aria-label="Раздели на модула"><a class="brand" href="' + tabHref(mod, tabs[0].id) + '"><b>Siracusa</b><small>' + NAME[mod] + "</small></a>" + navLinks("it") + "</nav>" +
    '<nav class="bs-nav" aria-label="Раздели на модула">' + navLinks("") + "</nav>" +
    '<div class="bs-penslot"></div><div class="vh" aria-live="polite" data-live></div>';
  $(".sa-boot")?.remove();
  /* the fixed layer first: the rail (or the bottom nav) comes before the content for the keyboard, as in the prototypes */
  document.body.appendChild(ov); document.body.appendChild(app);
  const main = $("#main", app)!, body = $("[data-body]", app)!, col = $(".bs-col", app)!, netBar = $(".bs-net", app)!;
  const rail = $(".bs-rail", ov)!, nav = $(".bs-nav", ov)!, penSlot = $(".bs-penslot", ov)!, live = $("[data-live]", ov)!;
  const behind = [app, rail, nav, penSlot];
  const say = (t: string) => { live.textContent = ""; setTimeout(() => { live.textContent = t; }, 60); };

  /* ---------- what covers the page: the pencil hides, the page behind does not scroll ---------- */
  const covers: Record<string, 1> = {};
  function cover(k: string, on: boolean) {
    if (on) covers[k] = 1; else delete covers[k];
    const any = Object.keys(covers).length > 0, de = document.documentElement;
    /* the page behind stands still on the phone (a sheet over the whole screen); on the computer the sheet is a side
       panel and hiding the scrollbar would move the page */
    de.classList.toggle("bs-hidepen", any); de.classList.toggle("bs-lock", any && window.innerWidth < 900);
  }

  /* ---------- sheet, confirm, toast ---------- */
  let toastT: ReturnType<typeof setTimeout> | undefined, undoUntil = 0;
  function sheet(s: SheetOpts): BossSheet {
    const w = document.createElement("div"), id = "bss" + Math.random().toString(36).slice(2, 7); w.className = "bs-sheetwrap";
    w.innerHTML = '<button class="scrim" type="button" aria-label="Затвори" tabindex="-1"></button><div class="bs-sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle" aria-hidden="true"></div><div class="sh"><h2 id="' + id + '" tabindex="-1">' + esc(s.title || "") + '</h2><button class="bs-x" type="button" data-close>' + ic("x", 20) + 'Затвори</button></div><div class="body">' + (s.html || "") + "</div>" + (s.foot ? '<div class="sfoot">' + s.foot + "</div>" : "") + "</div>";
    /* a toast still on screen goes away: it must never cover the sheet */
    const old = $(".bs-toast", ov); if (old) { old.classList.remove("on"); clearTimeout(toastT); }
    ov.appendChild(w); cover("sheet", true);
    const prev = document.activeElement as HTMLElement | null;
    behind.forEach((el) => { el.inert = true; });
    let closed = false;
    function close() {
      if (closed) return; closed = true; w.classList.add("closing");
      const others = $$(".bs-sheetwrap:not(.closing)", ov).length > 0;
      if (!others) { if (!$(".bs-find", ov)) behind.forEach((el) => { el.inert = false; }); cover("sheet", false); }
      w.classList.remove("on"); document.removeEventListener("keydown", key, true); setTimeout(() => w.remove(), 340);
      if (s.onClose) s.onClose();
      if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
    }
    function key(e: KeyboardEvent) {
      /* only the top sheet answers */
      const all = $$(".bs-sheetwrap:not(.closing)", ov); if (all[all.length - 1] !== w) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key !== "Tab") return;
      const f = $$<HTMLElement>(".bs-sheet button:not([disabled]), .bs-sheet a[href], .bs-sheet input:not([disabled]), .bs-sheet textarea, .bs-sheet select", w).filter((el) => el.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const a = f[0], z = f[f.length - 1], ae = document.activeElement;
      if (!w.contains(ae)) { e.preventDefault(); a.focus(); }
      else if (e.shiftKey && (ae === a || ae === $(".sh h2", w))) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && ae === z) { e.preventDefault(); a.focus(); }
    }
    document.addEventListener("keydown", key, true);
    $<HTMLButtonElement>(".scrim", w)!.onclick = close; $<HTMLButtonElement>("[data-close]", w)!.onclick = close;
    requestAnimationFrame(() => requestAnimationFrame(() => { w.classList.add("on"); const f = (s.focus && $<HTMLElement>(s.focus, w)) || $<HTMLElement>(".sh h2", w); if (f) f.focus({ preventScroll: true }); }));
    return { el: w, body: $(".body", w)!, foot: $(".sfoot", w), close };
  }
  function confirm(c: ConfirmOpts, onOk?: () => void): BossSheet {
    const s = sheet({ title: c.title, html: c.html || "<p>" + esc(c.text || "") + "</p>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-no>' + esc(c.no || "Откажи") + '</button><button class="pill ' + (c.danger ? "pill-red" : "pill-ink") + ' pill-lg" type="button" data-yes>' + (c.icon ? ic(c.icon, 22) : "") + esc(c.ok || "Да") + "</button>" });
    $<HTMLButtonElement>("[data-no]", s.foot!)!.onclick = s.close;
    $<HTMLButtonElement>("[data-yes]", s.foot!)!.onclick = () => { s.close(); if (onOk) onOk(); };
    return s;
  }
  function toast(text: string, t: ToastOpts = {}) {
    let el = $(".bs-toast", ov);
    if (!el) { el = document.createElement("div"); el.className = "bs-toast"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite"); ov.appendChild(el); }
    const tt = el;
    const acts = (t.action ? (t.action.href ? '<a class="sec" href="' + esc(t.action.href) + '" data-ta>' + esc(t.action.label) + ic("caret-right", 18) + "</a>" : '<button class="sec" type="button" data-ta>' + esc(t.action.label) + "</button>") : "") +
      (t.undo ? '<button type="button" data-tu>' + ic("arrow-counter-clockwise", 18) + esc(t.undoLabel || "Отмени") + "</button>" : "");
    tt.innerHTML = '<span class="tx">' + esc(text) + "</span>" + (acts ? '<span class="acts">' + acts + "</span>" : ""); tt.classList.toggle("solo", !acts);
    const u = $<HTMLButtonElement>("[data-tu]", tt); if (u) u.onclick = () => { tt.classList.remove("on"); t.undo!(); toast("Отменено"); };
    const a = $<HTMLElement>("[data-ta]", tt); if (a) a.onclick = () => { tt.classList.remove("on"); if (t.action!.fn) t.action!.fn(); };
    requestAnimationFrame(() => tt.classList.add("on")); clearTimeout(toastT);
    const ms = t.ms || (t.undo ? 6000 : 3400);
    undoUntil = t.undo ? Date.now() + ms : 0;
    toastT = setTimeout(() => { tt.classList.remove("on"); undoUntil = 0; }, ms);
  }

  /* ---------- the states of a screen ---------- */
  function skeleton(n = 3, label = "Зареждаме…"): string {
    let h = ""; for (let i = 0; i < n; i++) h += '<div class="skel"></div>';
    return '<div class="' + P + '-skel"><span class="vh" role="status">' + esc(label) + '</span><div class="' + P + '-skel" aria-hidden="true"><div class="skel s"></div>' + h + "</div></div>";
  }
  const empty = (e: EmptyOpts): string => '<div class="' + P + "-empty\"><div class=\"ill" + (e.lock ? " lock" : "") + '">' + ic(e.icon || "check-circle", mod === "upravitel" ? 48 : 44) + "</div><h2>" + esc(e.title) + "</h2>" + (e.text ? "<p>" + e.text + "</p>" : "") + (e.action || "") + "</div>";
  const retryBtn = '<button class="pill pill-line" type="button" data-bs="retry">' + ic("arrow-clockwise", 20) + "Опитай пак</button>";
  function error(text?: string, title?: string): string {
    return mod === "upravitel"
      ? '<div class="mg-banner" role="alert">' + ic("warning", 26) + "<div><b>" + esc(title || "Не успяхме да заредим смяната") + "</b><p>" + esc(text || "Опитай пак след малко. Ако не стане, обади се на главния админ.") + "</p></div>" + retryBtn + "</div>"
      : '<div class="ow-banner danger" role="alert">' + ic("warning", 26) + '<div class="tx"><b>' + esc(title || "Не успяхме да заредим данните") + "</b>" + esc(text || "Опитай пак след малко. Ако не стане, кажи на агенцията.") + "</div>" + retryBtn + "</div>";
  }
  function noRights(section: string): string {
    const s = SEC[section], first = cur.id === tabs[0].id;
    return empty({ icon: "lock", lock: true, title: "Нямаш права за този екран.",
      text: "Ролята „" + esc(roleName(role)) + "“ не вижда „" + esc(s ? s.n : section) + "“. Ако ти трябва, помоли главния админ.",
      action: first ? '<a class="pill pill-ink pill-lg" href="' + aurl.home() + '"' + homeAttr + ">" + ic("squares-four", 22) + "Към админа</a>"
        : '<a class="pill pill-ink pill-lg" href="' + tabHref(mod, tabs[0].id) + '">' + ic(tabs[0].ic, 22) + "Към „" + tabs[0].n + "“</a>" });
  }

  /* ---------- badges on the tabs ---------- */
  const auto: Partial<Record<BossTab, number>> = {}, fixed: Partial<Record<BossTab, number>> = {}, words: Partial<Record<BossTab, [string, string]>> = {};
  function drawBadges() {
    const fresh = mod === "upravitel" && !!freshOrder();
    tabs.forEach((t) => {
      const n = fixed[t.id] != null ? fixed[t.id]! : auto[t.id] || 0, isFresh = fresh && t.id === "now", w = words[t.id] || ["чака теб", "чакат теб"];
      $$('[data-nb="' + t.id + '"]', ov).forEach((el) => { el.textContent = n ? String(n) : ""; el.hidden = !n && !isFresh; el.classList.toggle("fresh", isFresh); });
      $$('[data-nbv="' + t.id + '"]', ov).forEach((el) => { el.textContent = (n ? ", " + n + " " + (n === 1 ? w[0] : w[1]) : "") + (isFresh ? ", нова онлайн поръчка" : ""); });
    });
  }
  function fromSummary(s: Summary) {
    const w = s.waiting;
    if (mod === "upravitel") auto.now = (w.orders || 0) + (w.reservations || 0) + (w.noShows || 0) + w.notes.n;
    else auto.decisions = w.noShows || 0;
    drawBadges();
  }
  let sumT: ReturnType<typeof setTimeout> | undefined;
  const refreshSoon = () => { clearTimeout(sumT); sumT = setTimeout(() => { loadSummary(true).then(() => loaded(), () => { /* the old numbers stay */ }); }, 300); };
  A.onSummary = fromSummary;

  /* ---------- no connection: the bar under the top bar, the time of the last successful load ---------- */
  const net = { off: false, at: new Date() };
  const retryFns: (() => void)[] = [];
  let pingT: ReturnType<typeof setInterval> | undefined;
  function loaded() { net.at = new Date(); }
  /** is the server reachable (and the session still there) */
  async function ping(): Promise<boolean> {
    if (navigator.onLine === false) return false;
    try { const m = await staffApi.me(); if (!m) { location.replace(aurl.login(murl.here())); } return true; }
    catch (e) { return !(e instanceof ApiError && e.code === "offline"); }
  }
  function setOffline(on: boolean) {
    if (net.off === on) return; net.off = on;
    $("[data-net]", netBar)!.textContent = "Няма връзка · Показваме данните от " + hmOf(net.at);
    netBar.hidden = !on; ov.classList.toggle("stale", on);
    clearInterval(pingT);
    /* without a connection we try by ourselves every 10 s */
    if (on) pingT = setInterval(() => { ping().then((ok) => { if (ok) back(); }); }, 10_000);
  }
  /** the connection is back: the bar goes, the screens load again what they may have missed */
  function back() { if (!net.off) return; setOffline(false); loaded(); refreshSoon(); retryFns.forEach((f) => f()); }
  const lost = () => { ping().then((ok) => { if (!ok) setOffline(true); }); };
  window.addEventListener("offline", () => setOffline(true));
  window.addEventListener("online", () => { ping().then((ok) => { if (ok) back(); }); });
  api.on("stream.lost", lost); api.on("stream.back", () => { if (net.off) back(); else { refreshSoon(); retryFns.forEach((f) => f()); } });
  if (navigator.onLine === false) setOffline(true);
  async function retry(btn: HTMLButtonElement) {
    const oldHTML = btn.innerHTML; btn.disabled = true; btn.innerHTML = "Проверяваме…";
    const ok = await ping();
    btn.disabled = false; btn.innerHTML = oldHTML;
    if (!ok) { setOffline(true); toast("Още няма връзка. Опитваме сами на всеки 10 сек."); return; }
    if (net.off) { back(); return; }
    if (retryFns.length) retryFns.forEach((f) => f()); else location.reload();
  }

  /* ---------- "Звук" and the new online order (the manager's module only; one watcher with the admin) ---------- */
  function syncSound() {
    const on = soundOn(), ready = soundReady(), l: [string, string] = !on ? ["Звук изкл.", "bell"] : ready ? ["Звук вкл.", "bell-ringing"] : ["Звук: докосни", "bell"];
    $$('[data-bs="sound"]', app).forEach((b) => {
      b.setAttribute("aria-pressed", String(on));
      b.innerHTML = ic(l[1], 24) + '<span class="lg">' + l[0] + '</span><span class="sm">Звук</span>';
      /* the name starts with the visible text */
      b.setAttribute("aria-label", l[0] + ", нови онлайн поръчки"); b.title = l[0] + " · нови онлайн поръчки";
      b.classList.toggle("wait", on && !ready);
    });
  }
  if (hasSound) { syncSound(); onSoundChange(syncSound); }
  if (mod === "upravitel") {
    watchNewOrders({
      silent: !hasSound,
      onNew: (d) => {
        drawBadges(); refreshSoon();
        /* "Виж": the order is seen, the badge stops blinking */
        /* never over a toast with "Отмени": it waits until that one is gone (the badge blinks at once) */
        const show = () => toast("Нова онлайн поръчка №\u00a0" + d.no, { action: { label: "Виж", href: tabHref("upravitel", "now", "n=" + d.no), fn: () => { ordersSeen(); drawBadges(); } }, ms: 6500 });
        if (Date.now() < undoUntil) setTimeout(show, undoUntil - Date.now() + 300); else show();
      },
      onChange: refreshSoon,
    });
  }
  api.on("reservation.created", refreshSoon); api.on("reservation.status", refreshSoon); api.on("note.created", refreshSoon); api.on("note.status", refreshSoon);

  /* ---------- the profile ---------- */
  const THEMES: [string, string, string][] = [["system", "Авто", "circles-three"], ["light", "Светла", "sun"], ["dark", "Тъмна", "moon"]];
  function openProfile() {
    const row = (href: string, icon: string, t: string, sub: string, extra = "") => '<a class="mg-setrow" href="' + href + '"' + extra + '><span class="si">' + ic(icon, 22) + "</span><span><b>" + t + "</b><small>" + sub + "</small></span>" + ic("caret-right", 20) + "</a>";
    const th = themeNow();
    sheet({ title: "Профил", html: '<div class="bs-prof"><span class="bs-av" aria-hidden="true">' + esc(initials(M.user.name)) + "</span><div><b>" + esc(M.user.name) + "</b>" + (sameName ? "" : "<small>" + esc(roleName(role)) + "</small>") + "</div></div>" +
      '<div class="bs-setlist">' +
        (mod === "upravitel" && isOwner ? row(bossHref("sobstvenik"), "chart-bar", "Към Собственик", "Твоят модул: оборот, тенденции, решения") : "") +
        (mod === "sobstvenik" ? row(bossHref("upravitel"), "users-three", "Смяната сега", "Модулът на управителя: залата, кухнята, шофьорите") : "") +
        row(aurl.home(), "squares-four", "Към админа", "Пълната работа: поръчки, резервации, меню, отчети", homeAttr) +
        row(aurl.section("notes", "src=" + role), "pencil-simple", "Моите препоръки", "Какво предложи с молива и докъде е стигнало") + "</div>" +
      '<h3 id="bs-thl">Тема</h3><div class="mg-themes" role="group" aria-labelledby="bs-thl">' + THEMES.map((t) => '<button type="button" data-sa="settheme" data-v="' + t[0] + '" aria-pressed="' + (th === t[0]) + '">' + ic(t[2], 20) + t[1] + "</button>").join("") + "</div>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-bs="logout">' + ic("sign-out", 22) + "Изход</button>" });
  }

  /* ---------- the search: the shell here, the results from the provider of the screens (loaded on the first open) ---------- */
  /** "Раздели на админа": only by the name, only what the role sees (the module never offers "оборот", decision 17.11.2026) */
  function searchSections(q: string): string {
    const n = norm(q); if (!n) return "";
    const hit = (name: string) => { const ws = norm(name).split(" "); return n.split(" ").every((p) => ws.some((w) => w.startsWith(p))); };
    const scr = tabs.filter((t) => hit(t.n) && (!t.needs || t.needs.some(can)));
    const secs = visibleSections().filter((s) => !s.soon && s.id !== "dashboard" && hit(s.n + " " + s.short));
    const row = (href: string, icon: string, t: string, sub: string) => '<a class="mg-frow" href="' + href + '"><span class="fi">' + ic(icon, 22) + "</span><span><b>" + esc(t) + "</b><small>" + esc(sub) + '</small></span><span class="fr">' + ic("caret-right", 18) + "</span></a>";
    const grp = (title: string, rows: string[]) => (rows.length ? '<section class="mg-fgrp" aria-label="' + esc(title) + '"><h2>' + esc(title) + '<span class="muted">' + rows.length + "</span></h2>" + rows.join("") + "</section>" : "");
    return grp("Екрани на модула", scr.map((t) => row(tabHref(mod, t.id), t.ic, t.n, NAME[mod]))) +
      grp("Раздели на админа", secs.map((s) => row(secHref(s.id), s.ic, s.n, "В админа · " + groupOf(s.id))));
  }
  /* until a screen gives its provider: the screens of the module and the sections of the admin */
  const basic: BossSearch = {
    results(q) {
      if (!q) return '<p class="mg-fscope">Търсиш в екраните на модула и в разделите на админа, които виждаш. На кирилица или латиница.</p>';
      return searchSections(q) || '<div class="mg-fempty"><div class="ill">' + ic("magnifying-glass", 40) + "</div><h2>Нищо за „" + esc(q) + "“</h2><p>Опитай с името на екран или раздел.</p></div>";
    },
  };
  let provider: BossSearch | null = null, providerP: Promise<BossSearch> | null = null;
  function loadProvider(): Promise<BossSearch> {
    if (provider) return Promise.resolve(provider);
    if (!providerP) {
      providerP = (o.search ? o.search.load() : Promise.resolve(basic)).then((p) => (provider = p), () => { toast("Търсенето не се зареди. Опитай пак."); providerP = null; return basic; });
    }
    return providerP;
  }
  const LINKS = "a[href], button[data-fmore]";
  /** the common behaviour of the field and the results (both views). Plain links in groups with headings (no combobox /
      listbox): down from the field to the first result, the arrows move the focus, up from the first and Esc go back to
      the field; Enter in the field opens the first result; the count is said in a hidden aria-live. */
  function bind(inp: HTMLInputElement, box: HTMLElement, clr: HTMLButtonElement, onEsc: () => void, closeFirst: boolean, after: ((v: string) => void) | null, liveEl: HTMLElement) {
    let more: Record<string, boolean> = {}, seq = 0;
    const links = () => $$<HTMLElement>(LINKS, box);
    function draw(keep?: () => void) {
      const v = inp.value.trim(), my = ++seq; clr.hidden = !v;
      if (!provider) box.innerHTML = '<div class="mg-fres"><p class="mg-fwait" role="status">Зареждаме…</p></div>';
      if (after) after(v);
      loadProvider().then((p) => p.results(v, more)).then((h) => {
        if (my !== seq) return;
        box.innerHTML = '<div class="mg-fres">' + h + "</div>"; if (after) after(v);
        const n = $$("a[href]", box).length; liveEl.textContent = v ? (n ? plural(n, "резултат", "резултата") + " за „" + v + "“" : "Нищо за „" + v + "“") : "";
        if (keep) keep();
      }, () => { if (my === seq) box.innerHTML = '<div class="mg-fres"><p class="mg-fwait">Търсенето не се зареди. Опитай пак.</p></div>'; });
    }
    inp.addEventListener("input", () => { more = {}; draw(); });
    inp.addEventListener("keydown", (e) => {
      const l = links();
      if (e.key === "ArrowDown") { if (l[0]) { e.preventDefault(); l[0].focus(); } }
      else if (e.key === "Enter") { const t = $<HTMLElement>("a[href]", box); if (t) { e.preventDefault(); t.click(); } }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (inp.value && !closeFirst) { inp.value = ""; more = {}; draw(); } else onEsc(); }
    });
    box.addEventListener("keydown", (e) => {
      const l = links(), i = l.indexOf(document.activeElement as HTMLElement); if (i < 0) return;
      if (e.key === "ArrowDown") { e.preventDefault(); (l[i + 1] || l[i]).focus(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); if (i > 0) l[i - 1].focus(); else inp.focus(); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); inp.focus(); }
    });
    clr.addEventListener("mousedown", (e) => e.preventDefault());
    clr.addEventListener("click", () => { inp.value = ""; more = {}; draw(); inp.focus(); });
    /* Esc on "Изчисти": back to the field, the panel closes (never opened again by the focus) */
    clr.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); inp.focus(); onEsc(); } });
    box.addEventListener("mousedown", (e) => { if ((e.target as Element).closest("button")) e.preventDefault(); });
    box.addEventListener("click", (e) => {
      const b = (e.target as Element).closest<HTMLElement>("button"); if (!b) return;
      if (b.dataset.fq != null) { inp.value = b.dataset.fq; more = {}; draw(); inp.focus(); return; }
      if (b.dataset.fmore) { more[b.dataset.fmore] = true; const y = box.scrollTop; draw(() => { box.scrollTop = y; const nl = $$<HTMLElement>("a[href]", box); if (nl.length) nl[Math.min(nl.length - 1, 4)].focus({ preventScroll: true }); }); }
    });
    return draw;
  }
  /* the phone: full screen, the field on top, "Затвори" */
  function openFind() {
    if ($(".bs-find", ov)) return;
    const w = document.createElement("div"); w.className = "bs-find"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Търси");
    w.innerHTML = '<div class="fwin"><div class="fhead"><form class="bs-q" role="search"><label class="vh" for="bs-fq">' + esc(fo.label || F.label) + "</label>" + ic("magnifying-glass", 22) +
      '<input class="input" id="bs-fq" type="search" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="' + esc(fo.phonePlaceholder || F.phone) + '"><button class="clr" type="button" aria-label="Изчисти търсенето" hidden>' + ic("x", 20) + "</button></form>" +
      '<button class="fx" type="button" data-fclose>' + ic("x", 24) + '<span>Затвори</span></button></div><div class="fbody" id="bs-fr" role="region" aria-label="Резултати от търсенето"></div><div class="vh" aria-live="polite" data-flive></div></div>';
    ov.appendChild(w); cover("find", true);
    const inp = $<HTMLInputElement>("#bs-fq", w)!, fbody = $(".fbody", w)!, clr = $<HTMLButtonElement>(".clr", w)!, prev = document.activeElement as HTMLElement | null;
    $<HTMLFormElement>("form", w)!.addEventListener("submit", (e) => e.preventDefault());
    behind.forEach((el) => { el.inert = true; });
    function close() {
      behind.forEach((el) => { el.inert = false; }); cover("find", false); w.classList.remove("on"); setTimeout(() => w.remove(), 260);
      document.removeEventListener("keydown", trap, true); if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
    }
    /* Esc: from the results to the field (bind), from the field it closes; from the buttons on top it closes */
    function trap(e: KeyboardEvent) {
      if ($(".bs-sheetwrap.on", ov)) return;
      if (e.key === "Escape" && document.activeElement !== inp && !fbody.contains(document.activeElement)) { e.preventDefault(); close(); return; }
      if (e.key !== "Tab") return;
      const f = $$<HTMLElement>("button:not([hidden]), a[href], input", w).filter((el) => el.offsetParent !== null); if (!f.length) return;
      const a = f[0], z = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    }
    document.addEventListener("keydown", trap, true);
    const draw = bind(inp, fbody, clr, close, true, null, $("[data-flive]", w)!);
    $<HTMLButtonElement>("[data-fclose]", w)!.onclick = close;
    w.addEventListener("click", (e) => { if ((e.target as Element).closest(".fbody a[href]")) setTimeout(close, 0); });
    draw();
    requestAnimationFrame(() => requestAnimationFrame(() => { w.classList.add("on"); inp.focus({ preventScroll: true }); }));
  }
  /* the computer: the field in the top bar and a panel under it */
  const dq = $<HTMLInputElement>("#bs-q", app)!;
  function desktopFind() {
    const wrap = dq.closest<HTMLElement>(".bs-dsearch")!, box = $(".bs-dpanel", wrap)!, clr = $<HTMLButtonElement>(".clr", wrap)!, k = $(".k", wrap)!;
    /* the panel is under the field, but never under the left rail and never outside the column (the field is narrow at 1024) */
    function place() {
      const c = col.getBoundingClientRect(), f = dq.getBoundingClientRect(), wr = wrap.getBoundingClientRect(), w = Math.min(620, c.width - 48);
      const left = Math.max(c.left + 24, Math.min(f.right - w, c.right - 24 - w));
      box.style.width = w + "px"; box.style.left = left - wr.left + "px"; box.style.maxHeight = Math.max(240, window.innerHeight - f.bottom - 24) + "px";
    }
    const show = () => { place(); box.hidden = false; }, hide = () => { box.hidden = true; };
    const liveEl = document.createElement("div"); liveEl.className = "vh"; liveEl.setAttribute("aria-live", "polite"); wrap.appendChild(liveEl);
    /* the second Esc closes the panel, the focus stays in the field */
    const draw = bind(dq, box, clr, hide, false, (v) => { k.hidden = !!v; show(); }, liveEl);
    dq.addEventListener("focus", () => { if (box.hidden) draw(); });
    dq.addEventListener("click", () => { if (box.hidden) draw(); });
    wrap.addEventListener("focusout", () => setTimeout(() => { if (!wrap.contains(document.activeElement)) hide(); }, 160));
    window.addEventListener("resize", () => { if (!box.hidden) place(); });
    document.addEventListener("click", (e) => { if (!wrap.contains(e.target as Node)) hide(); });
    draw();
  }
  dq.addEventListener("focus", desktopFind, { once: true });
  /* "/" focuses the search on the computer */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test((document.activeElement || ({} as Element)).tagName || "") || $(".bs-sheetwrap.on, .bs-find", ov)) return;
    if (dq.offsetParent) { e.preventDefault(); dq.focus(); }
  });

  /* ---------- delegation ---------- */
  function onClick(e: MouseEvent) {
    const tg = e.target as Element;
    /* a remembered choice follows the person ("Към админа" in the own module) */
    const h = tg.closest<HTMLElement>("a[data-home]"); if (h) switchHome(uname, h.dataset.home as HomeChoice);
    const t = tg.closest<HTMLElement>("[data-bs]"); if (!t) return;
    const a = t.dataset.bs;
    if (a === "profile") openProfile();
    else if (a === "logout") {
      /* the person's own actions kept on the phone: "Изход" asks and removes them (src/modules/boss/outbox.ts) */
      const n = keptCount(uname);
      if (!n) logout();
      else confirm({ title: "Изход", text: "На телефона " + (n === 1 ? "има 1 неизпратено действие" : "има " + n + " неизпратени действия") + ". Ако излезеш, " + (n === 1 ? "то се изтрива" : "те се изтриват") + ".", ok: "Изтрий и излез", danger: true, icon: "sign-out" }, () => { dropAll(uname); logout(); });
    }
    else if (a === "find") openFind();
    else if (a === "sound") toast(toggleSound() ? "Звукът за нови онлайн поръчки е включен" : "Звукът за нови онлайн поръчки е изключен");
    else if (a === "retry") retry(t as HTMLButtonElement);
  }
  app.addEventListener("click", onClick); ov.addEventListener("click", onClick);

  /* ---------- the pencil: recommendations only, a round button 56 px in the slot (beside the bottom nav on the phone, at
     the bottom of the rail from 900 px). Inside the frame of "Модулите на живо" there is none: the nav takes the whole width ---------- */
  if (!mountPen(mod, penSlot)) ov.classList.add("nopen");

  /* ---------- the rights of this screen (the real ones, from the session) ---------- */
  const needs = o.needs || cur.needs || [];
  const allowed = !needs.length || needs.some(can);
  body.innerHTML = allowed ? skeleton() : noRights(needs[0]);
  drawBadges();
  loadSummary().then(() => loaded(), () => { /* the badges stay hidden; the screen shows its own error */ });
  if (!allowed) return null;

  return {
    me: M, role, module: mod, tab: cur.id, main, body, can, sheet, confirm, toast, skeleton, empty, error, noRights,
    onRetry: (fn) => { retryFns.push(fn); },
    loaded, offline: () => net.off,
    onLive(fn, types = LIVE) { const offs = types.map((t) => api.on(t, (d, ty) => fn(ty, d))); return () => offs.forEach((f) => f()); },
    badge(tab, n, w) { if (n == null) delete fixed[tab]; else fixed[tab] = Math.max(0, n); if (w) words[tab] = w; drawBadges(); },
    freshOrder: () => { const f = mod === "upravitel" ? freshOrder() : null; return f ? f.no : null; },
    orderSeen: () => { ordersSeen(); drawBadges(); },
    say, searchSections, logout: () => { logout(); },
    tag, cnt, delta, sample, missing,
  };
}
export { ic, esc, plural };
