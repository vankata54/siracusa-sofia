/* Page chrome renderers WITHOUT the menu (shared runtime + server): header, nav, footer, cookie banner, sheet.
   The "Още" panel and the cookie settings are in chrome-sheets.ts (loaded on demand in the browser).
   Same DOM and classes as design/ds/sc.js, with the addresses from routes.ts. */
import { ic } from "./icons.ts";
import "sc-icons:caret-right,check,phone,x"; /* the icons of this module in one group (scripts/icon-groups.mjs) */
import { RESTAURANT } from "./consts.ts";
import { esc } from "./format.ts";
import { statusHTML } from "./chrome-core.ts";
import { NEUTRAL_HOUR } from "./status.ts";
import { url, type PageKey } from "./routes.ts";
import type { ClockInput } from "./time.ts";

export { ic, registerIcons, loadAllIcons } from "./icons.ts";
/* the two renderers the browser runtime needs live in chrome-core.ts (small); the rest here is mostly for the server */
export { statusHTML, sheetHTML } from "./chrome-core.ts";

/* ---------- chrome ---------- */
export type NavKey = "menu" | "reserve" | "offers" | "profile";
const NAV: [NavKey, string, string, PageKey][] = [["menu", "Меню", "fork-knife", "menu"], ["reserve", "Резервирай", "calendar-blank", "reservation"], ["offers", "Оферти", "seal-percent", "offers"], ["profile", "Профил", "user", "profile"]];
const DNAV: [string, string, PageKey][] = [["menu", "Меню", "menu"], ["lunch", "Обедно меню", "lunch"], ["reserve", "Резервирай", "reservation"], ["events", "Събития", "events"], ["offers", "Оферти", "offers"], ["delivery", "Доставка", "delivery"], ["about", "За нас", "about"]];

export interface HeaderOpts {
  nav?: string | null;                 // active section (desktop links)
  back?: { href: string; label?: string } | null;
  title?: string;
  share?: boolean;
  status?: boolean;                    // default true
  cart?: boolean;                      // default true
  clock?: ClockInput;                  // for status at render time
}


export function header(o: HeaderOpts = {}): string {
  const cartBtn = '<a class="cartbtn" href="' + url.cart() + '" data-cartnav aria-label="Количка">' + ic("shopping-bag", 24) + '<span class="cnt" data-cnt hidden>0</span></a>';
  /* the full bar: logo, sections (from 1180 px), "Обади се", BG, "Профил" (computer; the phone has it in the bottom nav), "Още" */
  const full = (cls: string) => '<header class="top' + cls + '"><a class="word" href="' + url.home() + '" title="Заместител до новото лого">Siracusa</a><nav class="dnav" aria-label="Раздели">' + DNAV.map((d) => '<a href="' + url.page(d[2]) + '"' + (o.nav === d[0] ? ' aria-current="page"' : "") + ">" + d[1] + "</a>").join("") + '</nav><div class="hact">' +
      '<a class="hb call" href="tel:' + RESTAURANT.phoneIntl + '" aria-label="Обади се на ' + RESTAURANT.phone + '">' + ic("phone", 20) + 'Обади се</a><button class="hb" type="button" data-lang>BG<span class="vh">, смени езика на английски</span></button><a class="hb prof" href="' + url.page("profile") + '"' + (o.nav === "profile" ? ' aria-current="page"' : "") + ">" + ic("user", 20) + 'Профил</a><button class="hb more" type="button" data-more>' + ic("list", 20) + "Още</button></div></header>";
  /* pages with "Назад" (dish, event, cart): the back bar on the phone; the computer keeps the full bar (the way back is the
     breadcrumb in <main>, or the flow's own "Назад"); "Сподели" stays in the back bar on the phone and goes to the full bar */
  const row1 = o.back
    ? '<header class="top back"><a class="hb" href="' + o.back.href + '">' + ic("arrow-left", 20) + esc(o.back.label || "Назад") + '</a><span class="ttl">' + esc(o.title || "") + '</span><div class="hact">' + (o.share ? '<button class="hb" type="button" data-share>' + ic("share-network", 20) + "Сподели</button>" : "") + "</div></header>" + full(" desk")
    : full("");
  /* the status depends on the hour: in the static HTML it would be the hour of the build ("Доставката приключи за днес"
     from a build after 21:00). Without a given clock the server draws an empty place of the same size (the daytime status,
     invisible: [data-pending]) and the browser fills it at once (src/client/sc.ts tick); decision 14.11.2026 */
  const pending = statusHTML(NEUTRAL_HOUR);
  const row2 = o.status === false && o.cart === false ? "" : '<div class="row2" role="region" aria-label="Работно време и количка">' + (o.status === false ? "" : o.clock != null ? '<div class="status" data-status>' + statusHTML(o.clock) + "</div>" : '<div class="status" data-status data-pending>' + pending + "</div>") + (o.cart === false ? "" : cartBtn) + "</div>";
  return '<div class="sentinel" data-sent></div>' + row1 + row2;
}

export function bottomNav(active?: string | null): string {
  return '<nav class="nav" aria-label="Основна навигация">' + NAV.map((n) => '<a href="' + url.page(n[3]) + '"' + (active === n[0] ? ' aria-current="page"' : "") + ">" + ic(n[2], 24) + n[1] + "</a>").join("") + "</nav>";
}

export function aiFab(o: { actionBar?: boolean; bottomNav?: boolean } = {}): string {
  return '<button class="aifab away' + (o.actionBar ? " up" : "") + (o.bottomNav === false ? " nonav" : "") + '" type="button" data-ai aria-label="Асистент">' + ic("sparkle", 20) + '<span class="lbl">Асистент</span></button>';
}

export function footer(year: number = new Date().getFullYear()): string {
  const R = RESTAURANT, a = (k: PageKey, t: string) => '<a href="' + url.page(k) + '">' + t + "</a>";
  /* a hidden h2 before the column titles (h3): the heading order stays right on pages with only an h1 (axe heading-order) */
  return '<footer class="foot"><h2 class="vh">Карта на сайта</h2><div class="cols"><div><span class="word">Siracusa</span><p class="muted" style="margin:10px 0 0">Пица на пещ и скара на дървени въглища в Дружба 2.</p><p style="margin:12px 0 0">' + R.address + "<br>" + R.phone + " · " + R.email + '</p><p class="muted small" style="margin:8px 0 0">Всеки ден 10:00 - 23:00. Кухнята приема до 22:30, доставка до 21:00.</p></div>' +
    "<div><h3>Поръчай</h3>" + a("menu", "Меню") + a("lunch", "Обедно меню") + a("delivery", "Доставка") + a("pickup", "Вземи от място") + a("office", "Обща поръчка за офиса") + "</div>" +
    "<div><h3>Елате при нас</h3>" + a("reservation", "Резервирай маса") + a("events", "Събития и поводи") + a("celebration", "Празник при нас") + a("bertha", "Фурната Bertha") + a("gallery", "Галерия") + "</div>" +
    "<div><h3>Информация</h3>" + a("about", "За нас") + a("contacts", "Контакти") + a("allergens", "Алергени") + a("terms", "Общи условия") + a("privacy", "Поверителност") + a("cookies", "Бисквитки") + '<button class="flink" type="button" data-cookie-settings>Настройки на бисквитките</button></div></div>' +
    '<p class="legal">© ' + year + " Siracusa Bar &amp; Grill. Цените са в евро с ДДС.</p></footer>";
}

export function cookieBanner(): string {
  return '<div class="cookie" role="dialog" aria-label="Бисквитки"><p><b>Бисквитки.</b> Ползваме необходимите, за да работи количката. Аналитичните само ако разрешите. <a href="' + url.page("cookies") + '">За бисквитките</a> · <a href="' + url.page("privacy") + '">Поверителност</a></p><div class="btns"><button class="pill pill-line" type="button" data-cookie="all">Приеми всички</button><button class="pill pill-line" type="button" data-cookie="min">Само необходимите</button><button class="pill pill-line" type="button" data-cookie="set">Настройки</button></div></div>';
}



