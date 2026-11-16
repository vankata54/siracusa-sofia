/* "Сайтът се пресглобява" for the screens of the section group "Продажби" (zones, offers, events; decision 16.11.2026,
   "основа на част 3"): a change of the site data goes into the core at once and the server rebuilds the static site
   through the same queue as the menu. The state comes from siteApi.state() (who and when per section, the rebuild);
   in the demo the site is not rebuilt and every screen says so ("В демото сайтът не се пресглобява").
   - siteLine(sec): one line under the summary (demo / waits / builds / done at 19:42 / error), with polling while it builds;
   - rebuildNote(): the end of a toast after a change (" Сайтът се пресглобява." / " В демото сайтът не се пресглобява.").
   Own file of the three screens (no change to the frame a.ts). */
import { siteApi, staffAdminApi, type SiteBuildState } from "../client/api-admin-3.ts";
import { menuApi } from "../client/api-menu.ts";
import { A, can, toast, esc, ic } from "./a.ts";
import { ago, hmOf } from "./when.ts";

type Sec = "zones" | "hall" | "events" | "offers";
type St = { mode: "server" | "demo"; sections: Record<Sec, { version: number; at: string | null; by: string | null }>; build: SiteBuildState };

export const DEMO = typeof document !== "undefined" && document.documentElement.dataset.demo === "1";
let S: St | null = null, T: ReturnType<typeof setTimeout> | undefined, onPaint: (() => void) | null = null;

/* who changed it: the person's name ("Поли"), as the other screens say it, never the user name ("admin");
   the signed-in person from the session, the others from "Персонал" (when the role sees it), else the role-less user name */
const NAMES: Record<string, string> = {};
let namesP: Promise<void> | null = null;
function names(): Promise<void> {
  if (A.me) NAMES[A.me.user.username] = A.me.user.name;
  const need = S ? Object.values(S.sections).some((x) => x.by && !NAMES[x.by]) : false;
  if (!need || !can("staff")) return Promise.resolve();
  if (!namesP) namesP = staffAdminApi.list().then((r) => { r.rows.forEach((u) => { NAMES[u.username] = u.name; }); }, () => { /* the user name stays */ });
  return namesP;
}
const whoName = (by: string) => NAMES[by] || by;
/** the state (null when it cannot be read: the screens still work, only the line is missing) */
export async function loadSite(): Promise<St | null> {
  try { S = await siteApi.state(); await names(); } catch { S = S || null; }
  return S;
}
/** the end of a toast after a change that the site shows */
export function rebuildNote(): string {
  return (S ? S.mode === "demo" : DEMO) ? " В демото сайтът не се пресглобява." : " Сайтът се пресглобява.";
}
/** after a write: read the state again and follow the rebuild until it is done */
export function afterWrite(): void { clearTimeout(T); T = setTimeout(() => { loadSite().then(() => { paint(); poll(); }); }, 400); }
function poll() {
  clearTimeout(T);
  if (!S || S.mode === "demo" || !(S.build.state === "queued" || S.build.state === "building")) return;
  T = setTimeout(async () => { await loadSite(); paint(); poll(); }, 2500);
}
function paint() { if (onPaint) onPaint(); }

/** the line about the site for one section ("" when there is nothing to say); repaint: draws the line again */
export function siteLine(sec: Sec, repaint?: () => void): string {
  if (repaint) { onPaint = repaint; poll(); }
  const demo = S ? S.mode === "demo" : DEMO;
  const me = S ? S.sections[sec] : null;
  const who = me && me.at ? '<span class="who">' + ic("check-circle", 18) + "<span>Последна промяна " + esc(ago(me.at)) + (me.by ? " от " + esc(whoName(me.by)) : "") + "</span></span>" : "";
  let st = "";
  if (demo) st = '<span class="st">' + ic("info", 18) + "<span>В демото сайтът не се пресглобява; на сървъра се пресглобява сам след всяка промяна.</span></span>";
  else if (S) {
    const b = S.build;
    if (b.state === "queued") st = '<span class="st wait" role="status">' + ic("clock", 18) + "<span>Сайтът чака да се пресглоби …</span></span>";
    else if (b.state === "building") st = '<span class="st wait" role="status">' + ic("arrow-clockwise", 18) + "<span>Сайтът се пресглобява …</span></span>";
    else if (b.state === "done" && b.at && me && me.at) st = '<span class="st">' + ic("check-circle", 18) + "<span>Сайтът е пресглобен: готово в " + esc(hmOf(b.at)) + "</span></span>";
    else if (b.state === "error") st = '<span class="st bad" role="alert">' + ic("warning", 18) + "<span>Сайтът не се пресглоби, остава предишният. Поръчките вече следват новите данни." + (can("menu") ? "" : " Кажете на главния админ.") + "</span></span>" +
      (can("menu") ? '<button class="pill pill-ink" type="button" data-site-rebuild>' + ic("arrow-clockwise", 18) + "Пресглоби пак</button>" : "");
  }
  if (!who && !st) return '<div class="ss-line" data-site-line hidden></div>';
  return '<div class="ss-line" data-site-line data-edit-id="admin.' + sec + '.site">' + who + st + "</div>";
}
/** "Пресглоби пак" (the same queue as the menu; only with the section "Меню") */
export function bindRebuild(root: HTMLElement): void {
  root.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("[data-site-rebuild]"); if (!b) return;
    b.disabled = true;
    menuApi.rebuild().then(() => { toast("Сайтът се пресглобява пак"); afterWrite(); }, (x) => { b.disabled = false; toast(x instanceof Error ? x.message : "Не успяхме. Опитайте пак."); });
  });
}
