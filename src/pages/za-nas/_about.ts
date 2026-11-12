/* About page (/za-nas/): server-side HTML for every section of design/pages/about.html, plus the JSON-LD.
   Numbers come only from the data (menu, zones); history, team, photos, seats and parking stay [ЛИПСВА]. */
import { payAnswer } from "../../lib/pay.ts";
import { url, restaurantId } from "../../lib/routes.ts";
import { RESTAURANT, ZONES } from "../../lib/consts.ts";
import { items, cats, inCat, lunch } from "../../lib/data.ts";
import { art } from "../../lib/render.ts";
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";
import { status } from "../../lib/status.ts";
import { endCta, lunchLinkText } from "./_cta.ts";

const R = RESTAURANT;
/* the main menu is the 14 categories (breakfast is a separate menu) */
export const mainCats = cats.filter((c) => c.id !== "zakuski");
export const mainItems = items.filter((x) => x.cat !== "zakuski");
const freeZones = ZONES.filter((z) => z.free);
const hours = R.open + " - " + R.close;
/* "ж.к. Дружба 2, срещу бл. 311, 1582 София" -> street + "1582 София" */
const addrStreet = R.address.slice(0, R.address.lastIndexOf(","));
const addrCity = R.address.slice(R.address.lastIndexOf(",") + 1).trim();
const intl = (ph: string) => "+359" + ph.replace(/\D/g, "").replace(/^0/, "");
const andList = (a: string[]) => (a.length > 1 ? a.slice(0, -1).join(", ") + " и " + a[a.length - 1] : a.join(""));

function slot(icon: string, label: string, cls = ""): string {
  return '<div class="ab-slot ' + cls + '" role="img" aria-label="Място за снимка: ' + esc(label) + '">' +
    '<span class="big">' + ic(icon, 72) + '</span><span class="tag"><span class="missing">[ЛИПСВА: ' + esc(label) + "]</span></span></div>";
}

/* 1. hero */
export function heroHTML(): string {
  return '<section class="sec ab-hero" aria-labelledby="ab-h1">' +
    "<div>" +
      '<p class="ab-eyebrow">' + ic("map-pin", 18) + "За нас · ж.к. Дружба 2</p>" +
      '<h1 class="h1" id="ab-h1">Вашият ресторант в Дружба 2</h1>' +
      '<p class="lead">Пица на пещ, меса и риба на дървени въглища във фурна Bertha и обедно меню с доставка. Салон и отоплявана градина, за всеки ден и за семейните празници.</p>' +
      '<div class="ab-cta"><a class="pill pill-red pill-lg" href="' + url.reservation() + '">' + ic("calendar-blank", 20) + 'Резервирай маса</a><a class="pill pill-line pill-lg" href="' + url.menu() + '">' + ic("fork-knife", 20) + "Виж менюто</a></div>" +
      '<ul class="ab-facts"><li>' + ic("clock", 20) + "Всеки ден " + hours + "</li><li>" + ic("tree", 20) + "Салон и градина</li><li>" + ic("truck", 20) + "Доставка до " + R.delivery + "</li></ul>" +
    "</div>" +
    '<div class="ab-vis">' + slot("storefront", "снимка на ресторанта", "ab-hero-slot") +
      '<div class="ab-plate" aria-hidden="true">' + art("svinski-rebra") + "</div></div>" +
  "</section>";
}

/* 2. what matters to us */
export function valuesHTML(): string {
  const vals = [
    { art: art("pitsa-margarita"), h: "Пещта", p: "Пиците се пекат на пещ. В менюто има " + inCat("pitsi").length + " вида, от Маргарита до сладката Нутела.", a: "Пиците на пещ", href: url.cat("pitsi"), data: "" },
    { art: art("t-bon-stek-ot-blek-angas"), h: "Дървените въглища", p: "Месата и рибата се пекат във Bertha, затворена фурна на дървени въглища. Огънят нагрява стените и тавана, затова топлината е равномерна, а вкусът е опушен.", a: "Как работи фурната", href: url.page("bertha"), data: "" },
    { art: art(lunch[0] || "kebapcheta"), h: "Кварталът", p: "Готвим за съседите от Дружба 1 и 2 и за офисите наоколо: обедно меню всеки ден и безплатна доставка до " + andList(freeZones.map((z) => z.n)) + ".", a: lunchLinkText(false), href: url.lunch(), data: " data-lunchlink" },
    { art: art("tiramisu"), h: "Семейните празници", p: "Рожден ден, кръщене, юбилей или фирмено парти, в салона или в градината. При ранна резервация -5%.", a: "Празник при нас", href: url.page("celebration"), data: "" },
  ];
  return '<section class="sec" aria-labelledby="ab-vals-h"><div class="sec-h"><h2 class="h2" id="ab-vals-h">Какво ни е важно</h2></div>' +
    '<div class="ab-vals">' + vals.map((v, i) =>
      '<article class="shell ab-val rv"><div class="core">' +
        '<div class="art" aria-hidden="true"><span class="num">0' + (i + 1) + "</span>" + v.art + "</div>" +
        '<div class="txt"><h3 class="h3">' + v.h + "</h3><p>" + v.p + '</p><a class="link" href="' + v.href + '"' + v.data + "><span>" + v.a + "</span>" + ic("caret-right", 18) + "</a></div></div></article>").join("") +
    "</div></section>";
}

/* 3. story (owner text missing) + numbers from the data */
export function storyHTML(): string {
  const nums = [
    { n: mainItems.length, l: "ястия в основното меню", href: url.menu(), ink: true },
    { n: mainCats.length, l: "категории, от супите до десертите", href: url.menu() },
    { n: inCat("pitsi").length, l: "пици на пещ", href: url.cat("pitsi") },
    { n: inCat("skara-bertha").length, l: "ястия от фурната Bertha", href: url.cat("skara-bertha") },
    { n: 7, l: "дни в седмицата, " + hours, href: url.page("contacts") },
    { n: freeZones.length, l: "квартала с безплатна доставка", href: url.page("delivery") },
  ];
  return '<section class="sec" aria-labelledby="ab-story-h"><div class="sec-h"><h2 class="h2" id="ab-story-h">Нашата история</h2></div>' +
    '<div class="ab-story">' +
      '<div class="rv"><div class="ab-year"><b>' + R.est + "</b><span><em>Siracusa est. " + R.est + '</em>както пише на логото на менюто</span></div><p class="missing ab-conf">[ЛИПСВА: потвърждение на годината от собственика]</p></div>' +
      '<div class="card ab-note rv"><span class="ico">' + ic("pencil-simple", 22) + '</span><div><p class="missing">[ЛИПСВА: историята от собственика. Как започна Siracusa, кой стои зад ресторанта и защо в Дружба 2.]</p></div></div>' +
    "</div>" +
    '<h3 class="h3" style="margin-top:44px">Siracusa в числа</h3>' +
    '<div class="ab-nums">' + nums.map((x) =>
      '<a class="ab-n rv' + (x.ink ? " ink" : "") + '" href="' + x.href + '"><span class="go-ic" aria-hidden="true">' + ic("arrow-up-right", 18) + "</span><b>" + x.n + '</b><span class="l">' + x.l + "</span></a>").join("") +
    '</div><p class="ab-src">Числата са от менюто ни.</p></section>';
}

/* 4. hall + heated garden (seats are [ЛИПСВА], never a sum of the mock tables) */
export function spacesHTML(): string {
  return '<section class="sec" aria-labelledby="ab-sp-h"><div class="sec-h"><h2 class="h2" id="ab-sp-h">Салон и градина</h2><a class="link" href="' + url.page("gallery") + '">Галерия' + ic("caret-right", 18) + "</a></div>" +
    '<p class="lead" style="margin:-4px 0 18px">Отворени всеки ден. Градината е затворена и се отоплява, затова работи и през зимата.</p>' +
    '<div class="ab-spaces">' +
      '<article class="shell ab-space rv"><div class="core">' + slot("chair", "снимка на салона") +
        '<div class="txt"><h3 class="h3">Салонът</h3><p>За обяд, вечеря и празници.</p><p class="missing">[ЛИПСВА: брой места]</p></div></div></article>' +
      '<article class="shell ab-space rv"><div class="core">' + slot("tree", "снимка на градината") +
        '<div class="txt"><h3 class="h3">Градината</h3><p>Затворена и отоплявана, работи целогодишно.</p><div class="feat"><span class="badge">' + ic("thermometer", 16) + 'Отоплява се</span><span class="badge">' + ic("calendar-check", 16) + 'Цяла година</span></div><p class="missing">[ЛИПСВА: брой места]</p></div></div></article>' +
    "</div>" +
    '<a class="pill pill-ink go ab-go" href="' + url.reservation() + '"><span>Избери маса по карта</span><span class="knob">' + ic("arrow-right", 22) + "</span></a>" +
  "</section>";
}

/* 5. team (only with consent) */
export function teamHTML(): string {
  const t: [string, string, string][] = [["chef-hat", "Кухнята", "готвачите"], ["users", "Салонът", "сервитьорите"], ["truck", "Доставките", "шофьорите"]];
  return '<section class="sec" aria-labelledby="ab-team-h"><div class="ab-teamw"><div><div class="sec-h"><h2 class="h2" id="ab-team-h">Екипът</h2></div>' +
    '<p class="lead" style="margin:-4px 0 18px">Хората в кухнята, в салона и по пътя до вас. Показваме ги само със съгласието им.</p>' +
    '<p class="missing ab-team-miss">[ЛИПСВА: снимки и имена на екипа, ако се съгласят]</p></div>' +
    '<div class="ab-team">' + t.map((x) =>
      '<figure class="rv"><div class="ab-slot tall" role="img" aria-label="Място за снимка: ' + x[1] + '"><span class="big">' + ic(x[0], 56) + "</span></div><figcaption>" + x[1] + "<span>" + x[2] + "</span></figcaption></figure>").join("") +
    "</div></div></section>";
}

/* 6. FAQ + visit. [question, answer HTML, plain answer for JSON-LD or null when it has [ЛИПСВА]] */
export const FAQ: [string, string, string | null][] = [
  ["Работи ли градината през зимата?", "<p>Да. Градината е затворена и се отоплява, затова работи през цялата година.</p>", "Да. Градината е затворена и се отоплява, затова работи през цялата година."],
  ["Къде се намирате?", "<p>" + esc(R.address) + '.</p><a class="link" href="' + R.maps + '" target="_blank" rel="noopener">Маршрут в Google Maps' + ic("arrow-up-right", 18) + "</a>", R.address + "."],
  ["Какво е работното време?", "<p>Всеки ден от " + R.open + " до " + R.close + ". Кухнята приема поръчки до " + R.kitchen + ", доставката е до " + R.delivery + ", а обедното меню до " + R.lunchUntil + ".</p>",
    "Всеки ден от " + R.open + " до " + R.close + ". Кухнята приема поръчки до " + R.kitchen + ", доставката е до " + R.delivery + ", а обедното меню до " + R.lunchUntil + "."],
  ["Как мога да платя?", "<p>" + payAnswer() + "</p>", null],
  ["Има ли паркинг?", '<p class="missing">[ЛИПСВА: паркиране]</p>', null],
  ["Може ли да направим празник при вас?", '<p>Да: рожден ден, кръщене, юбилей, фирмено парти. Изчислете празника онлайн, а при ранна резервация вземате -5%.</p><a class="link" href="' + url.page("celebration") + '">Празник при нас' + ic("caret-right", 18) + "</a>",
    "Да: рожден ден, кръщене, юбилей, фирмено парти. Изчислете празника онлайн, а при ранна резервация вземате -5%."],
];

export function visitHTML(): string {
  /* the live row is drawn with the build hour (like the header status) and refreshed in the browser at once */
  const s = status();
  return '<section class="sec" aria-labelledby="ab-faq-h"><div class="ab-visit">' +
    '<div><div class="sec-h"><h2 class="h2" id="ab-faq-h">Често задавани въпроси</h2></div><div class="ab-faq">' + FAQ.map((q, i) =>
      "<details" + (i === 0 ? " open" : "") + "><summary>" + q[0] + '<span class="tw" aria-hidden="true">' + ic("caret-down", 18) + '</span></summary><div class="a">' + q[1] + "</div></details>").join("") + "</div></div>" +
    '<div><div class="sec-h"><h2 class="h2" id="ab-visit-h">Елате при нас</h2></div>' +
      '<div class="shell"><div class="core">' +
        '<div class="ab-live" role="status" data-ab-live><span class="dot ' + s.cls + '"></span><span>' + s.html + "</span></div>" +
        '<ul class="ab-info">' +
          '<li><span class="ico">' + ic("map-pin", 20) + "</span><span><small>Адрес</small><b>" + esc(addrStreet).replace("бл. ", "бл.&nbsp;") + '</b><span class="sub">' + esc(addrCity) + "</span></span></li>" +
          '<li><span class="ico">' + ic("clock", 20) + "</span><span><small>Работно време</small><b>Всеки ден " + hours + '</b><span class="sub">Кухнята до ' + R.kitchen + " · доставка до " + R.delivery + "</span></span></li>" +
          '<li><span class="ico">' + ic("phone", 20) + '</span><span><small>Доставки и резервации</small><b><a href="tel:' + R.phoneIntl + '">' + R.phone + '</a></b><span class="sub">Втори телефон: <a href="tel:' + intl(R.phone2) + '">' + R.phone2 + "</a></span></span></li>" +
        "</ul>" +
        '<div class="ab-acts"><a class="pill pill-line pill-block" href="' + R.maps + '" target="_blank" rel="noopener">' + ic("map-trifold", 20) + 'Маршрут в Google Maps</a><a class="pill pill-soft pill-block" href="' + url.page("contacts") + '">' + ic("chat-circle-dots", 20) + "Всички контакти</a></div>" +
      "</div></div></div>" +
  "</div></section>";
}

/* 7. closing call to action: the server draws the daytime version, the browser sets the one for the hour */
export function endHTML(): string {
  const c = endCta({ kitchen: true, delivery: true });
  return '<section class="sec" aria-labelledby="ab-end-h"><div class="ab-end rv" data-ab-end>' +
    '<div class="ab-end-art" aria-hidden="true">' + art("pitsa-dyavolo") + "</div>" +
    '<div class="ab-end-t"><h2 class="h2" id="ab-end-h">Заповядайте в Siracusa</h2><p data-end-text>' + c.text + "</p></div>" +
    '<div class="btns"><a class="pill pill-red pill-lg" href="' + url.reservation() + '">' + ic("calendar-blank", 20) + 'Резервирай маса</a><a class="pill pill-ghost pill-lg" href="' + c.href + '" data-end-btn>' + ic("shopping-bag", 20) + "<span>" + c.label + "</span></a></div>" +
  "</div></section>";
}

/* ---------- JSON-LD: BreadcrumbList, AboutPage > Restaurant (only facts from RESTAURANT), FAQPage without [ЛИПСВА] ---------- */
export function aboutLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site).href;
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name: "За нас", item: abs(url.page("about")) }],
  };
  const restaurant: Record<string, unknown> = {
    "@type": "Restaurant", "@id": restaurantId(site), name: R.name, url: abs(url.home()),
    address: { "@type": "PostalAddress", streetAddress: addrStreet, postalCode: addrCity.split(" ")[0], addressLocality: addrCity.split(" ").slice(1).join(" "), addressCountry: "BG" },
    telephone: R.phoneIntl, email: R.email,
    openingHoursSpecification: [{ "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"], opens: R.open, closes: R.close }],
    hasMenu: abs(url.menu()),
  };
  const same = [R.social.facebook, R.social.instagram].filter(Boolean);
  if (same.length) restaurant.sameAs = same;
  const page = { "@context": "https://schema.org", "@type": "AboutPage", name: "За нас", url: abs(url.page("about")), inLanguage: "bg", mainEntity: restaurant };
  const faq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.filter((f) => f[2]).map((f) => ({ "@type": "Question", name: f[0], acceptedAnswer: { "@type": "Answer", text: f[2] } })) };
  return [crumbs, page, faq];
}
