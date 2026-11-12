/* Page chrome renderers WITHOUT the menu (shared runtime + server): header, nav, footer, cookie, "Още", sheet.
   Same DOM and classes as design/ds/sc.js, with the addresses from routes.ts. */
import { ic } from "./icons.ts";
import "./icons/x.ts";
import "./icons/check.ts";
import "./icons/caret-right.ts";
import "./icons/phone.ts";
import { RESTAURANT } from "./consts.ts";
import { esc } from "./format.ts";
import { status } from "./status.ts";
import { url, type PageKey } from "./routes.ts";
import type { ClockInput } from "./time.ts";

export { ic, registerIcons, loadAllIcons } from "./icons.ts";

/* ---------- chrome ---------- */
export type NavKey = "menu" | "reserve" | "offers" | "profile";
const NAV: [NavKey, string, string, PageKey][] = [["menu", "Меню", "fork-knife", "menu"], ["reserve", "Резервирай", "calendar-blank", "reservation"], ["offers", "Оферти", "seal-percent", "offers"], ["profile", "Профил", "user", "profile"]];
const DNAV: [string, string, PageKey][] = [["menu", "Меню", "menu"], ["lunch", "Обедно меню", "lunch"], ["reserve", "Резервирай", "reservation"], ["events", "Събития", "events"], ["offers", "Оферти", "offers"], ["delivery", "Доставка", "delivery"], ["about", "За нас", "about"]];
export const MORE_PAGES: [PageKey, string][] = [["home", "Начало"], ["menu", "Меню"], ["lunch", "Обедно меню"], ["offers", "Оферти"], ["events", "Събития и поводи"], ["celebration", "Калкулатор на празник"], ["office", "Обедна поръчка за офиса"], ["reservation", "Резервирай маса"], ["delivery", "Доставка"], ["pickup", "Вземи от място"], ["bertha", "Нашата фурна Bertha"], ["about", "За нас"], ["gallery", "Галерия"], ["contacts", "Контакти"], ["allergens", "Алергени"], ["profile", "Профил"]];

export interface HeaderOpts {
  nav?: string | null;                 // active section (desktop links)
  back?: { href: string; label?: string } | null;
  title?: string;
  share?: boolean;
  status?: boolean;                    // default true
  cart?: boolean;                      // default true
  clock?: ClockInput;                  // for status at render time
}

export function statusHTML(o?: ClockInput): string {
  const st = status(o);
  return '<span class="dot ' + st.cls + '"></span><span>' + st.html + "</span>";
}

export function header(o: HeaderOpts = {}): string {
  const cartBtn = '<a class="cartbtn" href="' + url.cart() + '" data-cartnav aria-label="Количка">' + ic("shopping-bag", 24) + '<span class="cnt" data-cnt hidden>0</span></a>';
  const row1 = o.back
    ? '<header class="top back"><a class="hb" href="' + o.back.href + '">' + ic("arrow-left", 20) + esc(o.back.label || "Назад") + '</a><span class="ttl">' + esc(o.title || "") + '</span><div class="hact">' + (o.share ? '<button class="hb" type="button" data-share>' + ic("export", 20) + "Сподели</button>" : "") + "</div></header>"
    : '<header class="top"><a class="word" href="' + url.home() + '" title="Заместител до новото лого">Siracusa</a><nav class="dnav" aria-label="Раздели">' + DNAV.map((d) => '<a href="' + url.page(d[2]) + '"' + (o.nav === d[0] ? ' aria-current="page"' : "") + ">" + d[1] + "</a>").join("") + '</nav><div class="hact">' +
      '<a class="hb call" href="tel:' + RESTAURANT.phoneIntl + '" aria-label="Обади се на ' + RESTAURANT.phone + '">' + ic("phone", 20) + 'Обади се</a><button class="hb" type="button" data-lang>BG<span class="vh">, смени езика на английски</span></button><button class="hb more" type="button" data-more>' + ic("list", 20) + "Още</button></div></header>";
  const row2 = o.status === false && o.cart === false ? "" : '<div class="row2" role="region" aria-label="Работно време и количка">' + (o.status === false ? "" : '<div class="status" data-status>' + statusHTML(o.clock) + "</div>") + (o.cart === false ? "" : cartBtn) + "</div>";
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
  return '<footer class="foot"><div class="cols"><div><span class="word">Siracusa</span><p class="muted" style="margin:10px 0 0">Пица на пещ и скара на дървени въглища в Дружба 2.</p><p style="margin:12px 0 0">' + R.address + "<br>" + R.phone + " · " + R.email + '</p><p class="muted small" style="margin:8px 0 0">Всеки ден 10:00 - 23:00. Кухнята приема до 22:30, доставка до 21:00.</p></div>' +
    "<div><h3>Поръчай</h3>" + a("menu", "Меню") + a("lunch", "Обедно меню") + a("delivery", "Доставка") + a("pickup", "Вземи от място") + a("office", "За офиса") + "</div>" +
    "<div><h3>Елате при нас</h3>" + a("reservation", "Резервирай маса") + a("events", "Събития и поводи") + a("celebration", "Празник при нас") + a("bertha", "Фурната Bertha") + a("gallery", "Галерия") + "</div>" +
    "<div><h3>Информация</h3>" + a("about", "За нас") + a("contacts", "Контакти") + a("allergens", "Алергени") + a("terms", "Общи условия") + a("privacy", "Поверителност") + a("cookies", "Бисквитки") + '<button class="flink" type="button" data-cookie-settings>Настройки на бисквитките</button></div></div>' +
    '<p class="legal">© ' + year + " Siracusa Bar &amp; Grill. Цените са в евро с ДДС.</p></footer>";
}

export function cookieBanner(): string {
  return '<div class="cookie" role="dialog" aria-label="Бисквитки"><p><b>Бисквитки.</b> Ползваме необходимите, за да работи количката. Аналитичните само ако разрешите. <a href="' + url.page("cookies") + '">За бисквитките</a> · <a href="' + url.page("privacy") + '">Поверителност</a></p><div class="btns"><button class="pill pill-line" type="button" data-cookie="all">Приеми всички</button><button class="pill pill-line" type="button" data-cookie="min">Само необходимите</button><button class="pill pill-line" type="button" data-cookie="set">Настройки</button></div></div>';
}

/** Stored cookie choices ("sc-cookie-prefs"): the necessary ones are always on. */
export interface CookiePrefs { analytics: boolean; marketing: boolean }
export function cookieSettings(prefs: CookiePrefs = { analytics: false, marketing: false }): string {
  const ck = (b: boolean) => (b ? " checked" : "");
  return '<form data-cookie-form class="stack" style="gap:6px"><label class="check"><input type="checkbox" checked disabled id="ck1"><span><b>Необходими</b><br><span class="muted small">Количка, вход, език. Винаги включени.</span></span></label><label class="check"><input type="checkbox" id="ck2" name="analytics"' + ck(prefs.analytics) + '><span><b>Аналитични</b><br><span class="muted small">Помагат ни да виждаме кое се поръчва. Изключени по подразбиране.</span></span></label><label class="check"><input type="checkbox" id="ck3" name="marketing"' + ck(prefs.marketing) + '><span><b>Маркетингови</b><br><span class="muted small">Изключени по подразбиране.</span></span></label>' +
    '<p class="small muted" style="margin:6px 0 0"><a href="' + url.page("cookies") + '">Какво ползваме и защо</a></p><button class="pill pill-red pill-block" type="submit" style="margin-top:8px">Запази избора</button></form>';
}

export function morePanel(): string {
  return '<div class="stack" style="gap:2px">' + MORE_PAGES.map((p) => '<a class="kv" href="' + url.page(p[0]) + '" style="text-decoration:none;font-weight:700;min-height:52px;align-items:center">' + p[1] + ic("caret-right", 18) + "</a>").join("") + '</div><div class="row" style="margin-top:14px"><a class="pill pill-line" href="tel:' + RESTAURANT.phoneIntl + '">' + ic("phone", 20) + RESTAURANT.phone + '</a><button class="pill pill-soft" type="button" data-lang>BG / EN</button></div>';
}

/** Generic bottom-sheet markup (the client wires it). */
export function sheetHTML(id: string, title: string, body: string): string {
  return '<button class="scrim" type="button" tabindex="-1" aria-label="Затвори"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle"></div><div class="sheet-h"><h2 id="' + id + '">' + esc(title) + '</h2><button class="hb" type="button" data-close>' + ic("x", 20) + 'Затвори</button></div><div class="body">' + body + "</div></div>";
}

