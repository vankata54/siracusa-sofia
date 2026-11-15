/* The floating bars never stay on a link or button of the page (Поли 15.11; the CSS is in src/styles/components.css).
   Loaded by sc.ts on the first scroll, outside the 30 000 B shared runtime (the prototype has the same in design/ds/sc.js).
   - Scrolling down hides the bottom nav (html.navaway): the action bar and the assistant go down in its place. It comes
     back on scroll up and near the top (and while a link of the nav has the focus: CSS).
   - Where the scroll stops and the page settles (150 ms after the last scroll, and after every transition: the bars, the
     assistant, the .rv reveal of the sections), the assistant fades out (.dodge, phone only) while a link, button or
     field of <main> is under it or within 8 px of it (a grid of points every 12 px; a target is at least 48 px). */
const de = document.documentElement;
const ov = document.querySelector<HTMLElement>("[data-ov]");
const fab = ov?.querySelector<HTMLElement>(".aifab");
const TARGET = "main :is(a[href], button, input, select, textarea, summary, [tabindex])";

export function dodge(): void {
  if (!fab) return;
  const r = fab.getBoundingClientRect();
  let on = false;
  for (let x = r.left - 8; x < r.right + 9 && !on; x += 12) {
    for (let y = r.top - 8; y < r.bottom + 9 && !on; y += 12) on = document.elementsFromPoint(x, y).some((e) => e.matches(TARGET));
  }
  fab.classList.toggle("dodge", on);
}

let lastY = 0, rest: ReturnType<typeof setTimeout> | undefined, pressed = false;
/* the bars never move under a finger or while typing: the browser scrolls a field into view, the button next to it must
   stay where the person is about to press it (office: the first press of „Изпрати“ right after typing the phone) */
addEventListener("pointerdown", () => { pressed = true; }, { passive: true, capture: true });
addEventListener("pointerup", () => { pressed = false; }, { passive: true, capture: true });
addEventListener("pointercancel", () => { pressed = false; }, { passive: true, capture: true });
const typing = (): boolean => !!document.activeElement && document.activeElement.matches("input:not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable]");
function onScroll() {
  const y = scrollY;
  if (!pressed && !typing()) de.classList.toggle("navaway", y > lastY && y > 80);
  lastY = y;
  clearTimeout(rest);
  rest = setTimeout(dodge, 150);
}
addEventListener("scroll", onScroll, { passive: true });
addEventListener("transitionend", dodge);
onScroll(); /* the scroll that loaded this module */
