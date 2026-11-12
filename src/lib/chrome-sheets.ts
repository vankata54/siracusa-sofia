/* The sheets the shared runtime opens only on demand ("Още", "Бисквитки → Настройки"). Kept OUT of chrome.ts, so
   the runtime chunk on every page does not carry them: src/client/sc-ui.ts imports this file at the first opening.
   The server and pages can import them from here or from lib/index.ts. */
import { ic } from "./icons.ts";
import "./icons/caret-right.ts";
import "./icons/phone.ts";
import { RESTAURANT } from "./consts.ts";
import { url, type PageKey } from "./routes.ts";

export const MORE_PAGES: [PageKey, string][] = [["home", "Начало"], ["menu", "Меню"], ["lunch", "Обедно меню"], ["offers", "Оферти"], ["events", "Събития и поводи"], ["celebration", "Калкулатор на празник"], ["office", "Обедна поръчка за офиса"], ["reservation", "Резервирай маса"], ["delivery", "Доставка"], ["pickup", "Вземи от място"], ["bertha", "Нашата фурна Bertha"], ["about", "За нас"], ["gallery", "Галерия"], ["contacts", "Контакти"], ["allergens", "Алергени"], ["profile", "Профил"]];

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
