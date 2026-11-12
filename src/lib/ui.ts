/* Shared words and small components of the client site (site.review-consistency.md, decision 12.11.2026).
   One function per repeated thing, so every page says it the same way:
     callBtn       "Обади се · 0894 36 55 77"
     miss          the [ЛИПСВА] marks from MISS (consts.ts)
     faqHead       "Често задавани въпроси" + "Не намерихте отговор? Обадете ни се, ще ви кажем." + callBtn
     stateBox      error / offline (title, one sentence, "Опитай пак" + callBtn); loadingText "Зареждаме …"
     hourNote      after 21:00 "Доставката приключи за днес" / after 22:30 "Кухнята затвори за днес"
     photoSlot     the one photo / video placeholder; mapSlot the one map placeholder
     stepperHTML   "Стъпка 2 от 3" + "Следва: …" / "Последна стъпка"
     previewPanel  "Само в прегледа" + pvChip / pvToggle with the same labels (PV)
   Pure strings: works on the server (Astro) and in the page scripts. NOT part of the shared runtime (sc.ts). */
import { ic } from "./icons.ts";
/* NO icons here (the module would carry them to every page, and twice): the module that calls a function in the browser
   registers its icons in its own group ("sc-icons:…"): stateBox warning-circle, globe, arrow-clockwise; hourNote clock;
   previewPanel sliders-horizontal; photoSlot image, video-camera; mapSlot map-pin, map-trifold (phone is in the runtime).
   On the server every icon is there. */
import { RESTAURANT as R } from "./consts.ts";
import { MISS, type MissKey } from "./miss.ts";
import { esc } from "./format.ts";

export const TEL = "tel:" + R.phoneIntl;
/** the words of the call button everywhere in <main> and in the states (the top bar keeps "Обади се") */
export const CALL = "Обади се · " + R.phone;

/** <a> "Обади се · 0894 36 55 77" (cls: the pill classes; attrs: extra attributes) */
export function callBtn(cls = "pill pill-line", attrs = ""): string {
  return '<a class="' + cls + '" href="' + TEL + '"' + (attrs ? " " + attrs : "") + ">" + ic("phone", 20) + "<span>Обади се · <span class=\"nw\">" + R.phone + "</span></span></a>";
}

/** a [ЛИПСВА] mark from the dictionary (one key = one text); `of` adds a subject: miss("photo", "пещта") -> "снимка на пещта" */
export function missText(k: MissKey, of?: string): string { return "[ЛИПСВА: " + MISS[k] + (of ? " на " + of : "") + "]"; }
export function miss(k: MissKey, of?: string): string { return '<span class="missing">' + esc(missText(k, of)) + "</span>"; }

/* ---------- FAQ ---------- */
export const FAQ_TITLE = "Често задавани въпроси";
export const FAQ_SUB = "Не намерихте отговор? Обадете ни се, ще ви кажем.";
/** the head of every FAQ block: h2 (id for aria-labelledby) + the line + the call button */
export function faqHead(id: string, o: { h?: "h2" | "h3"; cls?: string } = {}): string {
  const h = o.h || "h2";
  return '<div class="faq-head' + (o.cls ? " " + o.cls : "") + '"><' + h + ' class="h2" id="' + id + '">' + FAQ_TITLE + "</" + h + '><p class="lead">' + FAQ_SUB + "</p>" + callBtn("pill pill-line") + "</div>";
}

/* ---------- states ---------- */
export const OFFLINE = "Няма връзка с интернет";
export const errTitle = (what: string) => "Не успяхме да заредим " + what;
export const loadingText = (what: string) => "Зареждаме " + what + "…";
export const RETRY = "Опитай пак";
export interface StateOpts {
  kind: "error" | "offline";
  /** what did not load ("менюто", "ястията", ...): the title of the error */
  what: string;
  /** one sentence under the title (default: the usual one) */
  text?: string;
  /** attributes of the retry button (default "data-retry"); "" = no retry button */
  retry?: string;
  /** the heading tag (default h2) */
  h?: "h1" | "h2" | "h3";
  /** extra classes on the box */
  cls?: string;
  /** role (default alert) */
  role?: string;
}
/** the error / no-connection box: icon, title, one sentence, "Опитай пак" + "Обади се · 0894 36 55 77" */
export function stateBox(o: StateOpts): string {
  const off = o.kind === "offline";
  const title = off ? OFFLINE : errTitle(o.what);
  /* one short sentence everywhere (site.review-consistency, кръг 2 Д3) */
  const text = o.text || (off ? "Проверете връзката и опитайте пак." : "Опитайте пак след малко или ни се обадете.");
  const retry = o.retry === "" ? "" : '<button class="pill pill-red" type="button" ' + (o.retry || "data-retry") + ">" + ic("arrow-clockwise", 20) + RETRY + "</button>";
  const h = o.h || "h2";
  return '<div class="empty sc-state' + (o.cls ? " " + o.cls : "") + '" role="' + (o.role || "alert") + '"><span class="ill">' + ic(off ? "globe" : "warning-circle", 44) + "</span><" + h + ' class="h3">' + esc(title) + "</" + h + '><p class="muted">' + text + '</p><div class="acts">' + retry + callBtn("pill pill-line") + "</div></div>";
}

/* ---------- the hour notes (one component): after 21:00 and after 22:30 ---------- */
export interface HourState { open: boolean; kitchen: boolean; delivery: boolean; m: number }
/** "" while delivery runs; 21:00-22:30 "Доставката приключи за днес" + "Поръчки за вземане до 22:30"; closed: "Кухнята затвори за днес"
    + "Приемаме поръчки утре от 10:00" (+ action buttons, e.g. "Поръчай за утре"). Before 10:00: "Приемаме поръчки днес от 10:00". */
export function hourNote(st: HourState, o: { pickup?: string; tomorrow?: string; cls?: string; more?: string } = {}): string {
  if (st.delivery) return "";
  const early = !st.kitchen && st.m < 600;
  const t = st.kitchen ? "Доставката приключи за днес" : early ? "Кухнята още не е отворила" : "Кухнята затвори за днес";
  const s = st.kitchen ? "Поръчки за вземане до " + R.kitchen : "Приемаме поръчки " + (early ? "днес" : "утре") + " от " + R.open;
  const act = st.kitchen ? (o.pickup || "") : (o.tomorrow || "");
  return '<div class="sc-note' + (o.cls ? " " + o.cls : "") + '" role="status">' + ic("clock", 22) + "<div><b>" + t + "</b><span>" + s + (o.more ? ". " + o.more : "") + "</span>" + (act ? '<div class="acts">' + act + "</div>" : "") + "</div></div>";
}
export const hourTitle = (st: HourState) => (st.delivery ? "" : st.kitchen ? "Доставката приключи за днес" : st.m < 600 ? "Кухнята още не е отворила" : "Кухнята затвори за днес");
export const hourLine = (st: HourState) => (st.delivery ? "" : st.kitchen ? "Поръчки за вземане до " + R.kitchen : "Приемаме поръчки " + (st.m < 600 ? "днес" : "утре") + " от " + R.open);

/* ---------- photo and map slots (one look everywhere) ---------- */
export interface SlotOpts {
  /** the visible label in the corner ("Снимка", "Видео", or a caption) */
  label?: string;
  /** what the photo shows: the mark is "[ЛИПСВА: снимка на <of>]" */
  of?: string;
  /** "photo" (default) or "video" */
  kind?: "photo" | "video";
  /** CSS aspect-ratio, e.g. "4/3" (default "4/3"); "" = the parent sets the size */
  ratio?: string;
  cls?: string;
  /** the tag (default figure; "div" inside buttons) */
  tag?: "figure" | "div" | "span";
}
export function photoSlot(o: SlotOpts = {}): string {
  const tag = o.tag || "figure", video = o.kind === "video";
  const mark = "[ЛИПСВА: " + (video ? "видео" : MISS.photo) + (o.of ? " на " + o.of : "") + "]";
  const style = o.ratio === "" ? "" : ' style="aspect-ratio:' + (o.ratio || "4/3") + '"';
  const cap = tag === "figure" ? "figcaption" : "span";
  return "<" + tag + ' class="ph-slot' + (o.cls ? " " + o.cls : "") + '"' + style + ">" + ic(video ? "video-camera" : "image", 32) + '<span class="missing">' + esc(mark) + "</span>" +
    "<" + cap + ' class="ph-l">' + esc(o.label || (video ? "Видео" : "Снимка")) + "</" + cap + "></" + tag + ">";
}
/** the one map placeholder (until the static Google map): pin, name, address and the mark, the same on every page.
    tag "button" (the page loads the live map on tap; attrs carry its data-*): its name is the visible text (WCAG 2.5.3);
    cta: the visible action in it ("Покажи картата"); extra: the page's own controls inside (div only). */
export function mapSlot(o: { tag?: "div" | "button"; attrs?: string; cta?: string; extra?: string; cls?: string } = {}): string {
  const tag = o.tag || "div";
  return "<" + tag + ' class="map-slot' + (o.cls ? " " + o.cls : "") + '"' + (tag === "button" ? ' type="button"' : "") + (o.attrs ? " " + o.attrs : "") + ">" +
    '<span class="ms-pin">' + ic("map-pin", 28) + "</span><b>" + esc(R.name.replace(/ Bar & Grill$/, "")) + '</b><span class="ms-a">' + esc(R.street) + '</span><span class="missing">[ЛИПСВА: статична карта Google]</span>' +
    (o.cta ? '<span class="pill pill-ink ms-cta">' + ic("map-trifold", 20) + esc(o.cta) + "</span>" : "") + (o.extra || "") + "</" + tag + ">";
}

/* ---------- steps (.stepper): the same words in every flow ---------- */
/** "Стъпка 2 от 3" + on the right "Следва: <next>" or "Последна стъпка" */
export function stepperHTML(step: number, total: number, next?: string, o: { label?: string; cls?: string; now?: boolean } = {}): string {
  let bar = "";
  for (let i = 1; i <= total; i++) bar += "<span" + (i <= step ? ' class="on' + (i === step && o.now ? " now" : "") + '"' : "") + "></span>";
  return '<div class="stepper' + (o.cls ? " " + o.cls : "") + '" style="--n:' + total + '"' + (o.label ? ' role="group" aria-label="' + esc(o.label) + '"' : "") + '><div class="t"><b>Стъпка ' + step + " от " + total + "</b><span>" + (step >= total || !next ? "Последна стъпка" : "Следва: " + esc(next)) + '</span></div><div class="bar" aria-hidden="true">' + bar + "</div></div>";
}
export const BACK = "Назад";

/* ---------- "Само в прегледа" (preview panel, never on the real site) ---------- */
export const PV = { normal: "Нормално", loading: "Зареждане", error: "Грешка", offline: "Без интернет", empty: "Празно" } as const;
export const PV_TITLE = "Само в прегледа";
/** one chip of the panel (aria-pressed when it is the current state) */
export function pvChip(label: string, on: boolean, attrs: string): string {
  return '<button class="chip" type="button" ' + attrs + ' aria-pressed="' + on + '">' + esc(label) + "</button>";
}
/** an on/off switch with the same words: "Без интернет: вкл." / "Без интернет: изкл." */
export function pvToggle(label: string, on: boolean, attrs: string): string {
  return '<button class="chip" type="button" ' + attrs + ' aria-pressed="' + on + '">' + esc(label) + ": " + (on ? "вкл." : "изкл.") + "</button>";
}
/** the panel: h2 "Само в прегледа", one sentence, the chips (body) */
export function previewPanel(body: string, o: { text?: string; id?: string; cls?: string; bare?: boolean } = {}): string {
  const id = o.id || "pv-h";
  /* bare: inside a column (no .sec paddings) */
  return '<section class="' + (o.bare ? "" : "sec ") + 'pv-sec' + (o.cls ? " " + o.cls : "") + '" aria-labelledby="' + id + '" data-pv><div class="pv-panel"><h2 id="' + id + '">' + ic("sliders-horizontal", 18) + PV_TITLE + "</h2><p>" + (o.text || "Вижте как изглежда страницата в другите състояния. Тези бутони ги няма на истинския сайт.") + '</p><div class="pv-chips">' + body + "</div></div></section>";
}

/* ---------- the marketing consent: the same words in every form (never pre-ticked) ---------- */
export const MKT_TITLE = "Искам да получавам оферти и маркетингови предложения";
export const MKT_SUB = "По желание. Първи научавате за събитията и новите оферти. Отписвате се с едно натискане.";

/* ---------- breadcrumbs: the one way back on every sub-page (dish, category, event, celebration, Bertha, legal) ---------- */
/** [[label, href], ..., [label]]: the last one without href is the current page */
export function crumbs(list: [string, string?][]): string {
  return '<nav class="sc-crumbs" aria-label="Път до страницата"><ol>' + list.map((c) => "<li>" + (c[1] ? '<a href="' + c[1] + '">' + esc(c[0]) + "</a>" : '<span aria-current="page">' + esc(c[0]) + "</span>") + "</li>").join("") + "</ol></nav>";
}
