/* The chrome renderers the browser runtime (src/client/sc.ts) needs on every page: the status line and the sheet frame,
   plus the icons the runtime draws itself (x, check, caret-right, phone). header(), footer(), the banner and the bars are
   rendered by the server (chrome.ts) and stay out of the runtime chunk. */
import { ic } from "./icons.ts";
import "./icons/x.ts";
import "./icons/check.ts";
import "./icons/caret-right.ts";
import "./icons/phone.ts";
import { esc } from "./format.ts";
import { status } from "./status.ts";
import type { ClockInput } from "./time.ts";

export { ic, registerIcons, loadAllIcons } from "./icons.ts";

export function statusHTML(o?: ClockInput): string {
  const st = status(o);
  return '<span class="dot ' + st.cls + '"></span><span>' + st.html + "</span>";
}

/** Generic bottom-sheet markup (the client wires it). */
export function sheetHTML(id: string, title: string, body: string): string {
  return '<button class="scrim" type="button" tabindex="-1" aria-label="Затвори"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle"></div><div class="sheet-h"><h2 id="' + id + '">' + esc(title) + '</h2><button class="hb" type="button" data-close>' + ic("x", 20) + 'Затвори</button></div><div class="body">' + body + "</div></div>";
}
