/* The pure DOM part of the pencil (design/pages-admin/_pencil.js): what an element is, its text for the note and a unique,
   short CSS selector. Shared by the pencil of the admin and the staff modules (src/admin/pencil.ts) and by "Предложи
   подобрение" on the site (src/client/suggest.ts), so both write the same selector and never the value of a field.
   No imports: this file never pulls the site runtime (src/client/sc.ts) into the admin. */

export const clean = (s: unknown): string => String(s ?? "").replace(/\s+/g, " ").trim();

/* personal data never leaves the browser in a note: the same rules as scrubPersonal() in src/core/notes.ts (the server
   scrubs again); one function for both: src/core/scrub.ts */
import { scrubPersonal } from "../core/scrub.ts";
export const scrub = (s: string): string => scrubPersonal(s);

const cls = (el: Element): string => (typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "");

/* ---------- what is this element (for the label) ---------- */
const KIND: Record<string, string> = { a: "Връзка", button: "Бутон", input: "Поле", textarea: "Поле", select: "Избор", img: "Снимка", h1: "Заглавие", h2: "Заглавие", h3: "Заглавие", h4: "Заглавие", h5: "Заглавие", h6: "Заглавие", p: "Текст", li: "Ред от списък", label: "Етикет", nav: "Навигация", header: "Горна лента", footer: "Долна част", section: "Раздел", article: "Карта", aside: "Странична лента", main: "Съдържание", table: "Таблица", tr: "Ред от таблица", td: "Клетка", th: "Заглавие на колона", form: "Форма", ul: "Списък", ol: "Списък", figure: "Картинка", dialog: "Прозорец", blockquote: "Цитат", summary: "Бутон", details: "Разгъване", fieldset: "Група полета", output: "Число", time: "Час" };
const INLINE = /^(span|b|strong|small|em|i|u|mark|abbr|code|kbd|sup|sub)$/;
export function kindOf(el: Element): string {
  const t = el.tagName.toLowerCase(), r = el.getAttribute("role"), c = cls(el);
  if (r === "button" || r === "tab" || r === "switch") return "Бутон";
  if (r === "dialog") return "Прозорец";
  if (r === "status" || r === "alert") return "Съобщение";
  if (t === "input" && /checkbox|radio/.test((el as HTMLInputElement).type)) return "Отметка";
  if (KIND[t]) return KIND[t];
  if (/(^|\s)(pic|art)(\s|$)/.test(c)) return "Илюстрация";
  if (/(card|core|shell|tile|kcard)/.test(c)) return "Карта";
  if (/(badge|chip|tag|pill)/.test(c)) return "Етикет";
  if (INLINE.test(t)) return "Текст";
  return "Блок";
}

/** a field: its value is never read (input, textarea, select, an editable block) */
export const isField = (el: Element): boolean => /^(input|textarea|select)$/i.test(el.tagName) || (el as HTMLElement).isContentEditable === true;
/* fields whose placeholder may be an example of personal data: only the label and aria-label */
const PRIVATE = /^(password|tel|email)$/;

/** the label of a field (never its value): <label for>, the wrapping <label> without its fields, aria-label, placeholder, title */
export function labelOf(el: Element): string {
  const doc = el.ownerDocument;
  let l: Element | null = null;
  if (el.id) { try { l = doc.querySelector('label[for="' + el.id.replace(/["\\]/g, "\\$&") + '"]'); } catch { /* bad id */ } }
  if (!l) l = el.closest("label");
  const t = l ? clean(Array.from(l.childNodes).filter((n) => !(n.nodeType === 1 && (isField(n as Element) || /^(INPUT|SELECT|TEXTAREA)$/.test((n as Element).tagName)))).map((n) => n.textContent).join(" ")) : "";
  if (t) return t;
  const priv = el.tagName === "INPUT" && PRIVATE.test((el as HTMLInputElement).type);
  return clean(el.getAttribute("aria-label") || (priv ? "" : el.getAttribute("placeholder") || el.getAttribute("title")) || "");
}

/* the visible text of a block without what people typed: text nodes outside fields, scripts and hidden parts */
function textWithoutFields(el: Element): string {
  const doc = el.ownerDocument, out: string[] = [];
  const w = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const p = n.parentElement;
    if (!p || p.closest("textarea, select, script, style, template, [hidden], [contenteditable]:not([contenteditable=false])")) continue;
    out.push(n.textContent || "");
  }
  return clean(out.join(" "));
}

/** The text saved with the note (elementText, before the 500 cut): a field gives its label, never its value; a password,
    phone or e-mail field only its label; phone numbers and e-mail addresses in any text become a marker. */
export function elementText(el: Element): string {
  const t = el.tagName.toLowerCase();
  let s: string;
  if (isField(el)) s = labelOf(el);
  else if (t === "img") s = clean((el as HTMLImageElement).alt || "");
  else {
    s = el.querySelector("textarea, select, [contenteditable]") ? textWithoutFields(el) : clean((el as HTMLElement).innerText ?? el.textContent ?? "");
    if (!s) s = clean(el.getAttribute("aria-label") || el.getAttribute("title") || "");
  }
  return scrub(s);
}

/** "Бутон „Влез“": the kind and the start of the text (the label of the outline) */
export function describe(el: Element): string {
  const k = kindOf(el);
  let t = elementText(el);
  if (t.length > 34) t = t.slice(0, 32).replace(/\s+\S*$/, "") + " …";
  return k + (t ? " „" + t + "“" : "");
}

/* ---------- unique, short CSS selector ---------- */
const STATE = /^(on|in|rv|rv-on|active|done|bump|open|away|mini|scrolled|warn|late|sel|cur|hover|focus|show|hide|hidden|is-.*|has-.*|js-.*)$/;
const cssEsc = (win: Window | null, s: string): string => {
  const C = (win as unknown as { CSS?: { escape?: (s: string) => string } } | null)?.CSS;
  return C && C.escape ? C.escape(s) : String(s).replace(/([^\w-])/g, "\\$1");
};
/** an id that is not random or live data (the sheet ids of the runtime, numbers) */
export const goodId = (id: string | null | undefined): boolean => !!id && /^[A-Za-z][\w-]*$/.test(id) && !/\d{3,}/.test(id) && !/^(sh|sa)[a-z0-9]{5,6}$/.test(id);
const ATTRS = ["data-edit-id", "data-add", "data-id", "data-act", "data-sa", "data-k", "name", "for", "aria-label", "href", "type"];
function pieces(el: Element, win: Window | null): string[] {
  const t = el.tagName.toLowerCase(), out: string[] = [], late: string[] = [];
  if (goodId(el.id)) out.push("#" + cssEsc(win, el.id));
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (!v || v.length > 60 || /^javascript:/i.test(v) || v === "#") continue;
    const sel = t + "[" + a + '="' + v.replace(/["\\]/g, "\\$&") + '"]';
    /* aria-label and href with numbers follow live data (a timer, an order number): only as a last resort */
    if ((a === "aria-label" || a === "href") && /\d/.test(v)) late.push(sel); else out.push(sel);
  }
  const c = cls(el).split(/\s+/).filter((x) => x && !STATE.test(x) && /^[A-Za-z_][\w-]*$/.test(x)).slice(0, 2);
  if (c.length) out.push(t + "." + c.map((x) => cssEsc(win, x)).join("."));
  out.push(t);
  return out.concat(late);
}
function nth(el: Element, base: string): string {
  const p = el.parentElement;
  if (!p) return base;
  const same = Array.from(p.children).filter((c) => c.tagName === el.tagName);
  if (same.length < 2) return base;
  try { if (Array.from(p.children).filter((c) => c.matches(base)).length < 2) return base; } catch { /* bad selector */ }
  return base + ":nth-of-type(" + (same.indexOf(el) + 1) + ")";
}
function shorten(parts: string[], only: (s: string) => boolean): string {
  if (parts.length < 3) return parts.join(" > ");
  const last = parts[parts.length - 1];
  for (let i = 0; i < parts.length - 1; i++) { const s = parts[i] + " " + last; if (only(s)) return s; }
  for (let j = parts.length - 2; j > 0; j--) { const s2 = parts[0] + " " + parts.slice(j).join(" > "); if (only(s2)) return s2; }
  return parts.join(" > ");
}
/** A CSS selector that finds exactly this element: a good #id, then attributes (data-edit-id, data-add, name, aria-label,
    href ...), then classes without states, :nth-of-type only when needed; the shortest path that is still unique. */
export function selectorFor(el: Element): string {
  const doc = el.ownerDocument, win = doc.defaultView;
  const only = (s: string) => { try { const l = doc.querySelectorAll(s); return l.length === 1 && l[0] === el; } catch { return false; } };
  const path: string[] = [];
  let cur: Element | null = el, guard = 0;
  while (cur && cur.nodeType === 1 && cur !== doc.documentElement && guard++ < 14) {
    const opts = pieces(cur, win);
    for (const o of opts) { const s = [o].concat(path).join(" > "); if (only(s)) return shorten([o].concat(path), only); }
    const noId = opts.filter((o) => o.charAt(0) !== "#");
    const best = noId.length > 1 ? noId[noId.length - 2] : noId[0];
    path.unshift(nth(cur, best));
    if (only(path.join(" > "))) return shorten(path, only);
    cur = cur.parentElement;
  }
  return path.join(" > ");
}

/* ---------- which element the pointer means ---------- */
const TARGET = "a[href],button,label,input,select,textarea,summary,[role=button],[role=tab],[role=switch],[role=option]";
/** The element a pointer or the focus means: the control around it (a link, a button, a field), not a decorative layer
    (aria-hidden, no text and no role); never the page, the body or a block of almost the whole screen.
    skip: a selector of the caller's own interface (never a target). */
export function resolve(target: EventTarget | null, win: Window, skip?: string): Element | null {
  let el = target as Element | null;
  if (!el || el.nodeType !== 1) return null;
  const doc = win.document;
  if (/^sa-pen-/i.test(el.tagName) || (skip && el.closest(skip))) return null;
  const s = el.closest("svg");
  if (s && s.parentElement) el = s.parentElement;
  const it = el.closest(TARGET);
  if (it) el = it;
  for (let k = 0; k < 3 && el.parentElement && el.parentElement !== doc.body; k++) {
    const deco = el.getAttribute("aria-hidden") === "true" || (!clean(el.textContent) && !el.getAttribute("role") && !/^(img|svg|input|select|textarea|button|a|video|canvas|picture|iframe)$/i.test(el.tagName) && !el.querySelector("img,svg,input,select,textarea,button"));
    if (!deco) break;
    el = el.parentElement;
  }
  if (el === doc.documentElement || el === doc.body) return null;
  const r = el.getBoundingClientRect();
  if (r.width * r.height > win.innerWidth * win.innerHeight * 0.8) return null; /* the whole screen is not a useful target */
  return el;
}
