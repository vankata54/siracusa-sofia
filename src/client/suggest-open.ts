/* The browser entry of "Предложи подобрение": the shared runtime (src/client/sc.ts) imports THIS file at the first tap on a
   [data-suggest] button. It brings SC.sheet() (./sc-sheet.ts, not part of the runtime) together with the sheet itself;
   ./suggest.ts stays free of the runtime's DOM code, so the unit tests can import it. */
import "./sc-sheet.ts";
export { openSuggest } from "./suggest.ts";
