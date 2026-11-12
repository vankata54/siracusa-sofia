/* Offers (/oferti/): the server-only part. Real lunch examples (src/lib/data.ts, prices by pricing.ts lunchPrice), the
   sections that do not depend on the hour (loyalty card, gift voucher, FAQ) and the JSON-LD (BreadcrumbList, FAQPage,
   OfferCatalog with Offer only from real rules: no invented dates or validity). Never imported by the browser. */
import { lunch, MENU_LUNCH_DATE } from "../../lib/data.ts";
import { lunchPrice } from "../../lib/pricing.ts";
import { RESTAURANT as R } from "../../lib/consts.ts";
import { ic } from "../../lib/icons.ts";
import { esc, fmt } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import { miss, type OfData } from "./_offers.ts";

/* ---------- real lunch dishes as examples (never invented) ---------- */
const pick = (re: RegExp) => lunch.find((x) => re.test(x.n));
const exDish = pick(/Лазаня/) || lunch.find((x) => x.course === "main") || lunch[0];
const on = { lunchDiscount: true };
export const DATA: OfData = {
  ex: exDish ? (() => { const r = lunchPrice(exDish, on, "pickup"); return { n: exDish.n, p: exDish.p, now: r.p, disc: r.disc }; })() : null,
  teaser: [lunch.find((x) => x.group === "Супи"), exDish, lunch.find((x) => x.group === "Десерти")].filter((x): x is NonNullable<typeof x> => !!x).map((x) => ({ n: x.n, p: x.p })),
  lunchDate: MENU_LUNCH_DATE,
};

export const DESCRIPTION = "Оферти на Siracusa в Дружба 2: -30% на обедното меню след 15:00 при вземане, -10% с профил, подарък за рожден ден, карта с печати и ваучер.";

export const JUMP: [string, string][] = [["lunch", "Обедно -30%"], ["greek", "Гръцка вечер"], ["signup", "Профил -10%"], ["rating", "Оценка -10%"], ["birthday", "Рожден ден"], ["celebration", "Празник -5%"], ["loyalty", "Карта с печати"], ["voucher", "Ваучер"]];

/* ---------- loyalty card: the rule and the reward are [ЛИПСВА]; "2 от 10" is only an example of the card ---------- */
export function loyaltyHTML(): string {
  let st = "";
  for (let i = 1; i <= 10; i++) st += '<li class="st' + (i <= 2 ? " on" : "") + (i === 10 ? " gift" : "") + '">' + (i <= 2 ? ic("fire", 22) : i === 10 ? ic("gift", 22) : i) + "</li>";
  return '<section class="sec" aria-labelledby="h-loyalty"><div class="of-split">' +
    '<div class="of-stage rv" id="loyalty">' +
      '<div class="lc" role="img" aria-label="Пример за карта с печати: 2 от 10 печата">' +
        '<div class="lc-h"><span class="word">Siracusa</span><span class="lc-k">Карта с печати</span></div>' +
        '<ol class="lc-st" aria-hidden="true">' + st + "</ol>" +
        '<div class="lc-f"><span class="cnt2"><b>2</b> от 10</span><span class="lc-tag">' + ic("gift", 16) + "Пример</span></div>" +
      "</div></div>" +
    '<div class="of-copy"><h2 class="h2" id="h-loyalty">Карта с печати</h2>' +
      '<p class="lead">Картата е в профила ви: без приложение и без пластмаса. Там виждате колко печата имате.</p>' +
      '<ol class="steps">' +
        '<li><div><b>Направете профил</b><span class="d">С телефонния номер и код по SMS.</span></div></li>' +
        '<li><div><b>Събирайте печати</b><span class="d">Печат получавате за ' + miss("за какво се дава печат") + ".</span></div></li>" +
        '<li><div><b>Вземете подаръка</b><span class="d">На 10-ия печат: ' + miss("наградата") + ".</span></div></li>" +
      "</ol>" +
      '<a class="pill pill-line of-cta" href="' + url.login() + '">Вземи картата в профила' + ic("arrow-right", 20) + "</a>" +
      '<p class="of-fine">Картата на снимката е пример. С колко печата започвате: ' + miss("от собственика") + "</p>" +
    "</div></div></section>";
}

/* ---------- gift voucher: inquiry, pay on site, validity [ЛИПСВА] ---------- */
export function voucherHTML(): string {
  return '<section class="sec" aria-labelledby="h-voucher"><div class="of-split rev">' +
    '<div class="of-stage" id="voucher">' +
      '<div class="vc" role="img" aria-label="Ваучер за подарък от Siracusa">' +
        '<span class="vc-rib" aria-hidden="true"></span><span class="vc-rib2" aria-hidden="true"></span><span class="vc-bow" aria-hidden="true">' + ic("gift", 26) + "</span>" +
        '<span class="word">Siracusa</span>' +
        '<div><span class="vc-k">Ваучер за подарък</span><span class="vc-t">Пица на пещ и скара на дървени въглища</span></div>' +
      "</div></div>" +
    '<div class="of-copy"><h2 class="h2" id="h-voucher">Ваучер за подарък</h2>' +
      '<p class="lead">Подарете вечеря при нас. Онлайн плащане засега няма: изпращате запитване, а плащате на място.</p>' +
      '<ol class="steps">' +
        '<li><div><b>Изпращате запитване</b><span class="d">С желаната сума и телефон за връзка.</span></div></li>' +
        '<li><div><b>Обаждаме ви се</b><span class="d">Уговаряме кога да минете. Срок: ' + miss("до кога се обаждаме") + ".</span></div></li>" +
        '<li><div><b>Плащате на място</b><span class="d">В брой или с карта и взимате ваучера.</span></div></li>' +
      "</ol>" +
      '<button class="pill pill-line of-cta" type="button" data-sheet="voucher">Запитване за ваучер' + ic("caret-right", 20) + "</button>" +
      '<p class="of-fine">Валидност на ваучера: ' + miss("срок") + "</p>" +
    "</div></div></section>";
}

/* ---------- FAQ (also FAQPage in JSON-LD) ---------- */
const exOff = DATA.ex ? fmt(DATA.ex.disc) : "";
export const FAQ: [string, string][] = [
  ["Къде виждам отстъпката?", "В количката, на отделен ред, преди да поръчате." + (exOff ? " Например: „Отстъпка след 15:00: -" + exOff + "“." : "")],
  ["Мога ли да съчетая две отстъпки?", "Не, отстъпките не се събират. Ако за една поръчка важат и -30% на обедното меню, и код за отстъпка, количката сама избира по-изгодната за вас."],
  ["Къде въвеждам кода от оценката?", "В количката, в полето „Код за отстъпка“. Кодът е еднократен и дава -10% на ястията, без таксата за доставка."],
  ["Трябва ли ми профил?", "За -30% след 15:00 и за ранната резервация не. За -10% с профил и за картата с печати да. Профилът се прави с телефон и код по SMS, без парола."],
  ["Как плащам?", "В брой или с карта, на място или при доставка. Приемаме и ваучери за храна. Онлайн плащане засега няма."],
];
export function faqHTML(): string {
  return '<section class="sec" aria-labelledby="h-faq"><div class="faq"><h2 class="h2" id="h-faq" style="margin-bottom:12px">Добре е да знаете</h2>' +
    FAQ.map((x) => '<details class="qa"><summary>' + esc(x[0]) + ic("caret-down", 20) + "</summary><p>" + esc(x[1]) + "</p></details>").join("") + "</div></section>";
}

/* ---------- JSON-LD ---------- */
export function offersLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  const seller = { "@type": "Restaurant", name: R.name, telephone: R.phoneIntl, url: abs(url.home()),
    address: { "@type": "PostalAddress", streetAddress: R.street, postalCode: R.postalCode, addressLocality: R.city, addressCountry: "BG" } };
  /* only rules that are decided; no dates, validity or conditions marked [ЛИПСВА] */
  const offer = (id: string, name: string, description: string) => ({ "@type": "Offer", name, description, url: abs(url.offers(id)), seller });
  return [
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) },
      { "@type": "ListItem", position: 2, name: "Оферти", item: abs(url.offers()) },
    ] },
    { "@context": "https://schema.org", "@type": "OfferCatalog", name: "Оферти и отстъпки", url: abs(url.offers()), itemListElement: [
      offer("lunch", "-30% на обедното меню след 15:00", "Само за ястията от обедното меню и само при вземане от място, от 15:00 до 22:30. Отстъпката се смята сама в количката."),
      offer("signup", "-10% с профил", "-10% от следващата поръчка, когато направите профил с телефонен номер и код по SMS. Прилага се сам на следващата ви поръчка."),
      offer("rating", "-10% за кратка оценка", "Код за -10% от следващата поръчка след отговор на „Останахте ли доволни?“, еднакво при „Да“ и при „Не“."),
      offer("birthday", "Рожден ден при нас", "-10% от сметката или малка торта за рожденика, с отделно съгласие."),
      offer("celebration", "-5% за празник при ранна резервация", "-5% от крайната цена на празник при ранна резервация."),
    ] },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQ.map((q) => ({ "@type": "Question", name: q[0], acceptedAnswer: { "@type": "Answer", text: q[1] } })) },
  ];
}
