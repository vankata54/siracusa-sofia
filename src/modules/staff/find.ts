/* Siracusa · the shell of the staff search (decision 15.11 "Умна търсачка = асистентът"): full screen, ONE field with ONE
   clear button, "Затвори" and Esc, Enter opens the first result, the focus stays inside, the page behind is inert.
   Port of the overlay of design/pages-servitor/_find.js and design/pages-shofyor/_find.js; WHAT is searched comes from
   the screen authors as a SearchProvider (the waiter: tables, orders, reservations, sold out, dishes; the driver: only
   the own deliveries). Loaded on the first open (frame.ts openSearch), never with the first paint.

   Rows of the results: <a class="frow" href> or <button class="frow" type="button" data-…>; groups .fgrp > h3, bands
   .fband, the empty state .fempty, example chips <button class="chip" data-ex="…"> (the shell types the example). */
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";

export interface SearchApi {
  /** the text in the field */
  value(): string;
  /** put a text in the field and search */
  set(q: string): void;
  /** draw the results again (after "Още", a chip) */
  redraw(): void;
  close(): void;
}
export interface SearchProvider {
  /** the hidden label of the field: "Търси маса, поръчка, резервация или ястие" */
  label: string;
  /** "Маса, №, резервация, ястие…" */
  placeholder: string;
  /** HTML while the field is empty: what is searched (p.fscope) and examples (.fchips) */
  start(): string;
  /** HTML of the results for a text that is not empty (may come from the server) */
  results(q: string): string | Promise<string>;
  /** a button inside the results that the shell does not know (data-more, data-tog …) */
  click?(el: HTMLElement, s: SearchApi): void;
  /** ms to wait after the last key before results() is called (a provider that asks the server; default 0) */
  wait?: number;
}
export interface FindHost { ov: HTMLElement; before: HTMLElement; background(): HTMLElement[]; sheetsOpen(): boolean }

export function openFind(host: FindHost, p: SearchProvider, q0?: string): void {
  const w = document.createElement("div"); w.className = "st-find"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Търси");
  w.innerHTML = '<div class="fwin"><div class="fhead"><form class="search" role="search"><label class="vh" for="fq">' + esc(p.label) + "</label>" + ic("magnifying-glass", 22) +
    '<input class="input" id="fq" type="search" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="' + esc(p.placeholder) + '"><button class="clr" type="button" data-clr aria-label="Изчисти търсенето" hidden>' + ic("x", 22) + "</button></form>" +
    '<button class="fx" type="button" data-fclose>' + ic("x", 22) + '<span>Затвори</span></button></div><div class="fbody" aria-live="polite"></div></div>';
  host.ov.insertBefore(w, host.before);
  const inp = w.querySelector<HTMLInputElement>("#fq")!, body = w.querySelector<HTMLElement>(".fbody")!, clr = w.querySelector<HTMLElement>("[data-clr]")!;
  const prev = document.activeElement as HTMLElement | null, bg = host.background();
  bg.forEach((el) => { el.inert = true; });
  let run = 0, waitT: ReturnType<typeof setTimeout> | undefined, closed = false;
  function show(v: string) {
    const id = ++run;
    Promise.resolve().then(() => (v ? p.results(v) : p.start())).then((html) => { if (id === run && !closed) body.innerHTML = html; })
      .catch(() => { if (id === run && !closed) body.innerHTML = '<div class="fempty"><div class="ill">' + ic("magnifying-glass", 40) + "</div><h3>Търсенето не успя</h3><p>Провери връзката и опитай пак.</p></div>"; });
  }
  function draw(now = true) {
    const v = inp.value.trim(); clr.hidden = !v; clearTimeout(waitT);
    if (!now && v && p.wait) waitT = setTimeout(() => show(v), p.wait); else show(v);
  }
  function close() {
    if (closed) return; closed = true; clearTimeout(waitT);
    if (!host.sheetsOpen()) bg.forEach((el) => { el.inert = false; });
    w.classList.remove("on"); setTimeout(() => w.remove(), 260);
    document.removeEventListener("keydown", key, true);
    if (prev && prev.isConnected && prev.focus) prev.focus({ preventScroll: true });
  }
  const s: SearchApi = { value: () => inp.value.trim(), set(q) { inp.value = q; draw(); inp.focus(); }, redraw: () => draw(), close };
  function key(e: KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== "Tab") return;
    const f = Array.from(w.querySelectorAll<HTMLElement>("button:not([hidden]):not([disabled]), a[href], input")).filter((el) => el.offsetParent !== null);
    if (!f.length) return;
    const a = f[0], z = f[f.length - 1], act = document.activeElement;
    if (e.shiftKey && (act === a || !w.contains(act))) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && (act === z || !w.contains(act))) { e.preventDefault(); a.focus(); }
  }
  document.addEventListener("keydown", key, true);
  w.querySelector("form")!.addEventListener("submit", (e) => e.preventDefault());
  inp.addEventListener("input", () => draw(false));
  /* Enter opens the first result */
  inp.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const a = body.querySelector<HTMLElement>("a.frow, button.frow"); if (a) a.click();
  });
  w.addEventListener("click", (e) => {
    if (e.target === w) { close(); return; }
    const b = (e.target as Element).closest<HTMLElement>("button"); if (!b) return;
    if (b.hasAttribute("data-fclose")) close();
    else if (b.hasAttribute("data-clr")) s.set("");
    else if (b.dataset.ex !== undefined) s.set(b.dataset.ex);
    else if (p.click && body.contains(b)) p.click(b, s);
  });
  if (q0) inp.value = q0;
  draw();
  requestAnimationFrame(() => requestAnimationFrame(() => { w.classList.add("on"); inp.focus({ preventScroll: true }); }));
}
