/* The chrome renderer the browser runtime (src/client/sc.ts) needs on every page: the status line, plus the icons the
   runtime and the shared components draw (x, check, caret-right, phone). The sheet frame is in src/client/sc-sheet.ts
   (out of the runtime). header(), footer(), the banner and the bars are rendered by the server
   (chrome.ts) and stay out of the runtime chunk. */
import "./icons/x.ts";
import "./icons/check.ts";
import "./icons/caret-right.ts";
import "./icons/phone.ts";
import { status } from "./status.ts";
import type { ClockInput } from "./time.ts";

export { ic, registerIcons, loadAllIcons } from "./icons.ts";

export function statusHTML(o?: ClockInput): string {
  const st = status(o);
  return '<span class="dot ' + st.cls + '"></span><span>' + st.html + "</span>";
}
