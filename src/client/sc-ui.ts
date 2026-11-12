/* The parts of the runtime that are needed only after a tap: the "Още" sheet, the cookie settings, the assistant chat and
   "Сподели". sc.ts imports this file on the first use (and starts loading it on pointerdown / focus of such a button),
   so the chunk on every page stays small. Same DOM and behaviour as before. */
import { morePanel, cookieSettings, type CookiePrefs } from "../lib/chrome-sheets.ts";
import { esc } from "../lib/format.ts";
import { loadModule } from "../lib/load.ts";
import type { AiKind } from "../lib/assistant.ts";
import type { SCType } from "./sc.ts";

const sc = (): SCType => window.SC;
const assistantChunk = () => import("../lib/assistant.ts");
const assistant = () => loadModule(assistantChunk);

export function openMore(): void { sc().sheet({ title: "Още", html: morePanel() }); }

export function cookieSettingsSheet(prefs: CookiePrefs, save: (p: CookiePrefs) => void): void {
  const S = sc(), s = S.sheet({ title: "Бисквитки", html: cookieSettings(prefs), returnTo: () => document.querySelector('.cookie [data-cookie="set"]') });
  s.el.querySelector("[data-cookie-form]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target as HTMLFormElement, on = (n: string) => !!(f.elements.namedItem(n) as HTMLInputElement | null)?.checked;
    save({ analytics: on("analytics"), marketing: on("marketing") });
    s.close(); S.toast("Изборът е запазен");
  });
}

export function aiAsk(text: string, kind: AiKind): void {
  const box = sc().ov.querySelector<HTMLElement>("[data-aimsgs]");
  if (!box) return;
  box.insertAdjacentHTML("beforeend", '<div class="msg me">' + esc(text) + '</div><div class="msg bot typing" data-typing><span></span><span></span><span></span></div>');
  box.scrollTop = box.scrollHeight;
  const wait = new Promise((r) => setTimeout(r, sc().reduce ? 50 : 700));
  Promise.all([assistant(), wait]).then(([A]) => { const t = box.querySelector("[data-typing]"); if (t) { t.outerHTML = '<div class="msg bot">' + A.aiReply(kind) + "</div>"; box.scrollTop = box.scrollHeight; } });
}
export async function aiAskText(v: string): Promise<void> { const A = await assistant(); aiAsk(v, A.aiClassify(v)); }
export async function openAI(): Promise<void> {
  const A = await assistant();
  const s = sc().sheet({ title: "Асистент", html: A.aiPanelHTML() });
  s.el.classList.add("aisheetwrap");
  setTimeout(() => { const i = s.el.querySelector<HTMLInputElement>("#aiq"); i && i.focus({ preventScroll: true }); }, 60);
}

export async function share(): Promise<void> {
  const data = { title: document.title, url: location.href };
  try { if ("share" in navigator) { await navigator.share(data); return; } } catch { return; }
  try { await (navigator as Navigator).clipboard.writeText(location.href); } catch { /* ignore */ }
  sc().toast("Връзката е копирана");
}
