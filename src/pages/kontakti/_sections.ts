/* Contacts (/kontakti/): server-side HTML of design/pages/contacts.html and the JSON-LD.
   Address, phones, e-mail, hours and socials come only from RESTAURANT (src/lib/consts.ts); parking, transport, access,
   holidays, Instagram, Google and the static map are [ЛИПСВА]. What depends on the hour or the day is in _live.ts. */
import { mapSlot, callBtn, miss, faqHead } from "../../lib/ui.ts";
import { payAnswer } from "../../lib/pay.ts";
import { url, restaurantId } from "../../lib/routes.ts";
import { RESTAURANT as R } from "../../lib/consts.ts";
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";
import { ctaHTML, todayHTML, weekHTML, HOURS, TEL1, TEL2 } from "./_live.ts";

/* "ж.к. Дружба 2, срещу бл. 311, 1582 София" -> street + "1582 София" */
const addrStreet = R.address.slice(0, R.address.lastIndexOf(","));
const addrCity = R.address.slice(R.address.lastIndexOf(",") + 1).trim();
/* no line break inside "Дружба 2", "бл. 311", "1582 София" */
export const ADDR = esc(R.address).replace(/(Дружба|бл\.|\d{4}) (\S+)/g, "$1&nbsp;$2");
const q = encodeURIComponent(R.name + ", " + R.address);
export const WAZE = "https://waze.com/ul?q=" + q + "&navigate=yes";
export const EMBED = "https://www.google.com/maps?q=" + q + "&z=16&output=embed";
const fbHandle = R.social.facebook ? R.social.facebook.replace(/\/+$/, "").split("/").pop() || "" : "";

export const DESCRIPTION = R.name + ", " + R.address + ". Телефон " + R.phone + ". Всеки ден " + HOURS + ", кухнята приема до " + R.kitchen + ", доставка до " + R.delivery + ".";

function row(icon: string, label: string, valHTML: string, primary: string, copy: string, msg: string): string {
  return '<div class="ct-row"><span class="ct-tile">' + ic(icon, 22) + '</span><div><div class="lbl">' + ic(icon, 18) + label + "</div>" + valHTML + "</div>" +
    '<div class="acts">' + primary + '<button class="pill pill-line cp" type="button" data-copy="' + esc(copy) + '" data-msg="' + msg + '" aria-label="Копирай: ' + esc(copy) + '">' + ic("copy", 20) + "Копирай</button></div></div>";
}

/* 1. hero + contact list */
export function topHTML(): string {
  return '<section class="sec ct-top">' +
    '<div class="ct-hero">' +
      '<h1 class="h1">Контакти</h1>' +
      '<p class="lead">Обадете се, елате или ни пишете. Всеки ден от ' + R.open + " до " + R.close + " в Дружба&nbsp;2.</p>" +
      '<div class="ct-cta" data-cta>' + ctaHTML(null) + "</div>" +
      "<div data-heronote></div>" +
    "</div>" +
    '<div class="ct-contacts">' +
      '<h2 class="h2">Телефони и адрес</h2>' +
      '<div class="shell ct-list"><div class="core">' +
        row("phone", "Доставки и резервации", '<a class="val tel" href="tel:' + TEL1 + '">' + R.phone + "</a>",
          callBtn("pill pill-soft"), R.phone, "Номерът е копиран") +
        row("phone", "Втори телефон", '<a class="val tel" href="tel:' + TEL2 + '">' + R.phone2 + "</a>",
          '<a class="pill pill-soft" href="tel:' + TEL2 + '">' + ic("phone", 20) + '<span>Обади се · <span class="nw">' + R.phone2 + "</span></span></a>", R.phone2, "Номерът е копиран") +
        row("paper-plane-right", "Имейл", '<a class="val mail" href="mailto:' + R.email + '">' + R.email + "</a>",
          '<a class="pill pill-soft" href="mailto:' + R.email + '">' + ic("paper-plane-right", 20) + "Напиши имейл</a>", R.email, "Имейлът е копиран") +
        row("map-pin", "Адрес", '<span class="val addr">' + ADDR + "</span>",
          '<a class="pill pill-soft" href="' + R.maps + '" target="_blank" rel="noopener">' + ic("map-trifold", 20) + "Маршрут</a>", R.address, "Адресът е копиран") +
      "</div></div>" +
    "</div>" +
  "</section>";
}

/* 2. hours: "Днес" card + the week table (the browser marks today and the live status) */
export function hoursHTML(): string {
  return '<section class="sec" id="rabotno-vreme" aria-labelledby="h-hours">' +
    '<div class="sec-h"><h2 class="h2" id="h-hours">Работно време</h2></div>' +
    '<div class="ct-hours">' +
      '<div class="shell"><div class="core ct-today rv" data-today>' + todayHTML(null, null) + "</div></div>" +
      '<div class="shell"><div class="core ct-week" data-week>' + weekHTML(null, null) + "</div></div>" +
    "</div>" +
  "</section>";
}

/* 3. map (abstract background + [ЛИПСВА], the real Google map loads on tap) + how to get here */
export function mapSceneHTML(): string {
  /* the one map placeholder of the site (lib/ui.ts); a button: the real Google map loads on tap. Its name is its visible text. */
  return mapSlot({ tag: "button", attrs: "data-mapgo", cta: "Покажи картата", cls: "ct-mapbtn" });
}
export function wayHTML(): string {
  return '<section class="sec" id="marshrut" aria-labelledby="h-way">' +
    '<div class="sec-h"><h2 class="h2" id="h-way">Как да стигнете</h2></div>' +
    '<div class="ct-way">' +
      '<div class="shell"><div class="core"><div class="ct-map" data-map data-embed="' + esc(EMBED) + '">' + mapSceneHTML() + "</div></div></div>" +
      '<div class="shell"><div class="core">' +
        '<div class="ct-addr"><div class="lbl">Адрес</div><p class="h3">' + ADDR + "</p>" +
          '<div class="btns"><a class="pill pill-red pill-lg pill-block" href="' + R.maps + '" target="_blank" rel="noopener">' + ic("map-trifold", 22) + "Маршрут в Google Maps</a>" +
          '<div class="duo"><a class="pill pill-line" href="' + esc(WAZE) + '" target="_blank" rel="noopener" aria-label="Маршрут в Waze">' + ic("car", 20) + "Waze</a>" +
          '<button class="pill pill-line cp" type="button" data-copy="' + esc(R.address) + '" data-msg="Адресът е копиран">' + ic("copy", 20) + "Копирай</button></div></div>" +
        "</div>" +
        '<hr class="divider">' +
        '<ul class="ct-info">' +
          '<li><span class="ct-tile">' + ic("car", 22) + '</span><span><b>Паркиране</b><p>' + miss("parking") + "</p></span></li>" +
          '<li><span class="ct-tile">' + ic("path", 22) + '</span><span><b>С градски транспорт</b><p class="missing">[ЛИПСВА: най-близки спирки и линии]</p></span></li>' +
          '<li><span class="ct-tile">' + ic("tree", 22) + '</span><span><b>Салон и градина</b><p>Градината е отоплявана и работи целогодишно.</p><a class="link" href="' + url.reservation() + '">Резервирай маса' + ic("caret-right", 18) + "</a></span></li>" +
          '<li><span class="ct-tile">' + ic("wheelchair", 22) + '</span><span><b>Достъп с количка</b><p class="missing">[ЛИПСВА: вход без стъпала, тоалетна]</p></span></li>' +
        "</ul>" +
      "</div></div>" +
    "</div>" +
  "</section>";
}

/* 4. FAQ. [question, answer HTML, plain answer for JSON-LD or null when it has [ЛИПСВА]] */
export const FAQ: [string, string, string | null][] = [
  ["Работите ли всеки ден?", "Да, всеки ден от " + R.open + " до " + R.close + ". Кухнята приема поръчки до " + R.kitchen + ".", null],
  ["До колко часа доставяте?", "Доставяме до " + R.delivery + ". След това можете да вземете поръчката от ресторанта до " + R.kitchen + ".", null],
  ["До кои квартали е безплатна доставката?", 'Безплатна е за Дружба 1 и 2, НПЗ Искър и Бусманци. За Горубляне и Гара Искър е по тарифа <span class="missing">[ЛИПСВА: такса в €]</span>.', null],
  ["Как мога да платя?", payAnswer(), null],
  ["Работи ли градината през зимата?", "Да. Градината е отоплявана и работи целогодишно.", null],
  ["Има ли къде да паркирам?", miss("parking"), null],
];
/* the answers without [ЛИПСВА] are plain text and go to FAQPage as they are */
for (const f of FAQ) if (!f[1].includes("ЛИПСВА")) f[2] = f[1];

export function faqHTML(): string {
  return '<section class="sec" aria-labelledby="h-faq">' +
    faqHead("h-faq") +
    '<div class="shell"><div class="core ct-faq">' +
      FAQ.map((f) => '<details class="ct-q"><summary>' + f[0] + ic("caret-down", 20) + "</summary><p>" + f[1] + "</p></details>").join("") +
    "</div></div>" +
  "</section>";
}

/* 5. socials: only the Facebook link is known */
export function socHTML(): string {
  const miss = (icon: string, name: string, extra: string) =>
    '<div class="card ct-scard is-missing"><span class="ct-tile">' + ic(icon, 24) + "</span><span><b>" + name + "</b>" + extra + "</span></div>";
  const link = (href: string, icon: string, name: string, handle: string) =>
    '<a class="card ct-scard" href="' + esc(href) + '" target="_blank" rel="noopener"><span class="ct-tile">' + ic(icon, 24) + "</span><span><b>" + name + '</b><span class="h">' + esc(handle) + '</span></span><span class="go-t">Отвори' + ic("arrow-up-right", 18) + "</span></a>";
  return '<section class="sec" aria-labelledby="h-soc">' +
    '<div class="sec-h"><h2 class="h2" id="h-soc">Последвайте ни</h2></div>' +
    '<div class="ct-soc">' +
      (R.social.facebook ? link(R.social.facebook, "facebook-logo", "Facebook", fbHandle) : miss("facebook-logo", "Facebook", '<span class="missing">[ЛИПСВА: профил във Facebook]</span>')) +
      (R.social.instagram ? link(R.social.instagram, "instagram-logo", "Instagram", "Instagram") : miss("instagram-logo", "Instagram", '<span class="missing">[ЛИПСВА: профил в Instagram]</span>')) +
      (R.social.google ? link(R.social.google, "google-logo", "Google", "Отзиви и снимки") : miss("google-logo", "Google", '<span class="h">Отзиви и снимки</span><span class="missing">[ЛИПСВА: линк към профила]</span>')) +
    "</div>" +
  "</section>";
}

/* 6. feedback: intro + faster routes; the form box is filled in index.astro */
export function fbIntroHTML(): string {
  return '<div class="intro">' +
    '<h2 class="h2" id="h-fb">Пишете ни</h2>' +
    '<p class="lead" style="margin-top:10px">Въпрос, похвала или нещо, което да подобрим. Четем всяко съобщение.</p>' +
    '<nav class="card ct-route" aria-label="По-бързи начини"><p class="t">По-бързо е онлайн</p>' +
      '<a href="' + url.reservation() + '"><span><small>Искате маса?</small><b>Резервирай маса</b></span>' + ic("caret-right", 20) + "</a>" +
      '<a href="' + url.menu() + '"><span><small>Гладни сте?</small><b>Поръчай</b></span>' + ic("caret-right", 20) + "</a>" +
      '<a href="' + url.events() + '"><span><small>Празник или фирмено парти?</small><b>Събития и поводи</b></span>' + ic("caret-right", 20) + "</a>" +
    "</nav>" +
  "</div>";
}

/* ---------- JSON-LD: BreadcrumbList, ContactPage > Restaurant (only facts from RESTAURANT), FAQPage without [ЛИПСВА] ---------- */
export function contactsLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site).href;
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name: "Контакти", item: abs(url.page("contacts")) }],
  };
  const restaurant: Record<string, unknown> = {
    "@type": "Restaurant", "@id": restaurantId(site), name: R.name, url: abs(url.home()),
    address: { "@type": "PostalAddress", streetAddress: addrStreet, postalCode: addrCity.split(" ")[0], addressLocality: addrCity.split(" ").slice(1).join(" "), addressCountry: "BG" },
    telephone: R.phoneIntl, email: R.email,
    /* the first number is "Доставки и резервации"; the second has no stated purpose, so it is not a ContactPoint */
    contactPoint: [{ "@type": "ContactPoint", telephone: TEL1, contactType: "reservations", availableLanguage: "bg" }],
    openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], opens: R.open, closes: R.close }],
    hasMenu: abs(url.menu()), hasMap: R.maps,
  };
  const same = [R.social.facebook, R.social.instagram, R.social.google].filter(Boolean);
  if (same.length) restaurant.sameAs = same;
  const page = { "@context": "https://schema.org", "@type": "ContactPage", name: "Контакти", url: abs(url.page("contacts")), inLanguage: "bg", mainEntity: restaurant };
  const faq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.filter((f) => f[2]).map((f) => ({ "@type": "Question", name: f[0], acceptedAnswer: { "@type": "Answer", text: f[2] } })) };
  return [crumbs, page, faq];
}
