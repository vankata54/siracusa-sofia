/* String HTML renderers, identical on the server (Astro pages, set:html) and in the browser (client scripts).
   Same DOM and classes as design/ds/sc.js, with the new addresses from routes.ts. */
import { ICONS } from "./icons.ts";
import { byId, isOut, TAGS, RESTAURANT, type Dish } from "./data.ts";
import { artSvg } from "./art.ts";
import { esc, fmt } from "./format.ts";
import { status } from "./status.ts";
import { url, type PageKey } from "./routes.ts";
import type { ClockInput } from "./time.ts";

type DishRef = Dish | string;
const D = (x: DishRef): Dish => (typeof x === "string" ? byId[x] : x);

/** Phosphor icon as inline SVG. */
export function ic(n: string, s = 22): string {
  return '<svg class="ic" viewBox="0 0 256 256" width="' + s + '" height="' + s + '" fill="currentColor" aria-hidden="true">' + (ICONS[n] || ICONS["question"]) + "</svg>";
}

export function art(x: DishRef, attrs?: string): string { return artSvg(D(x), attrs); }

export function pic(x: DishRef, cls?: string): string {
  const d = D(x);
  return '<div class="pic ' + (cls || "") + (isOut(d) ? " out" : "") + '" role="img" aria-label="' + esc(d.n) + ' (илюстрация до новата фотосесия)">' + art(d) + "</div>";
}

export function badges(x: DishRef, onpic?: boolean): string {
  const d = D(x);
  const t = d.t.filter((k) => TAGS[k]);
  if (!t.length) return "";
  return '<span class="badges' + (onpic ? " onpic" : "") + '">' + t.map((k) => '<span class="badge ' + k + '">' + ic(TAGS[k][1], 16) + TAGS[k][0] + "</span>").join("") + "</span>";
}

export function plusBtn(x: DishRef): string {
  const d = D(x);
  if (isOut(d)) return "";
  return '<button class="plus" type="button" data-add="' + d.id + '" aria-label="Добави ' + esc(d.n) + ' в количката">' + ic("plus", 22) + "</button>";
}

/** variant "card" (rail / grid) or "row" */
export function dishCard(x: DishRef, variant: "card" | "row" = "card"): string {
  const d = D(x), href = url.dish(d), unit = d.per100 ? "за 100 гр." : d.g;
  if (variant === "row") return '<div class="drow"><a class="open" href="' + href + '">' + pic(d) + '<span><span class="nm">' + esc(d.n) + '</span><span class="meta"><span class="price">' + fmt(d.p) + '</span><span class="muted small">' + unit + "</span></span>" + (d.t.length ? '<span style="display:block;margin-top:6px">' + badges(d) + "</span>" : "") + "</span></a>" + plusBtn(d) + "</div>";
  return '<div class="dcard"><a class="open" href="' + href + '"><span class="pw">' + pic(d) + badges(d, true) + '</span><span class="nm">' + esc(d.n) + '</span></a><div class="rowp"><span><span class="price">' + fmt(d.p) + "</span><small>" + unit + "</small></span>" + plusBtn(d) + "</div></div>";
}

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
      '<a class="hb call" href="tel:' + RESTAURANT.phoneIntl + '" aria-label="Обади се на ' + RESTAURANT.phone + '">' + ic("phone", 20) + 'Обади се</a><button class="hb" type="button" data-lang aria-label="Смени езика на английски">BG</button><button class="hb more" type="button" data-more>' + ic("list", 20) + "Още</button></div></header>";
  const row2 = o.status === false && o.cart === false ? "" : '<div class="row2">' + (o.status === false ? "" : '<div class="status" data-status>' + statusHTML(o.clock) + "</div>") + (o.cart === false ? "" : cartBtn) + "</div>";
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
    "<div><h3>Информация</h3>" + a("about", "За нас") + a("contacts", "Контакти") + a("allergens", "Алергени") + a("terms", "Общи условия") + a("privacy", "Поверителност") + '<a href="' + url.page("cookies") + '" data-cookie-settings>Бисквитки</a></div></div>' +
    '<p class="legal">© ' + year + " Siracusa Bar &amp; Grill. Цените са в евро с ДДС.</p></footer>";
}

export function cookieBanner(): string {
  return '<div class="cookie" role="dialog" aria-label="Бисквитки"><p><b>Бисквитки.</b> Ползваме необходимите, за да работи количката. Аналитичните само ако разрешите.</p><div class="btns"><button class="pill pill-line" type="button" data-cookie="all">Приеми всички</button><button class="pill pill-line" type="button" data-cookie="min">Само необходимите</button><button class="pill pill-line" type="button" data-cookie="set">Настройки</button></div></div>';
}

export function cookieSettings(): string {
  return '<label class="check"><input type="checkbox" checked disabled id="ck1"><span><b>Необходими</b><br><span class="muted small">Количка, вход, език. Винаги включени.</span></span></label><label class="check"><input type="checkbox" id="ck2"><span><b>Аналитични</b><br><span class="muted small">Помагат ни да виждаме кое се поръчва. Изключени по подразбиране.</span></span></label><label class="check"><input type="checkbox" id="ck3"><span><b>Маркетингови</b><br><span class="muted small">Изключени по подразбиране.</span></span></label>';
}

export function morePanel(): string {
  return '<div class="stack" style="gap:2px">' + MORE_PAGES.map((p) => '<a class="kv" href="' + url.page(p[0]) + '" style="text-decoration:none;font-weight:700;min-height:52px;align-items:center">' + p[1] + ic("caret-right", 18) + "</a>").join("") + '</div><div class="row" style="margin-top:14px"><a class="pill pill-line" href="tel:' + RESTAURANT.phoneIntl + '">' + ic("phone", 20) + RESTAURANT.phone + '</a><button class="pill pill-soft" type="button" data-lang>BG / EN</button></div>';
}

/** Generic bottom-sheet markup (the client wires it). */
export function sheetHTML(id: string, title: string, body: string): string {
  return '<button class="scrim" type="button" aria-label="Затвори"></button><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="' + id + '"><div class="handle"></div><div class="sheet-h"><h2 id="' + id + '">' + esc(title) + '</h2><button class="hb" type="button" data-close>' + ic("x", 20) + 'Затвори</button></div><div class="body">' + body + "</div></div>";
}

export { fmt, esc } from "./format.ts";
