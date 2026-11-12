/* Обща поръчка за офиса: the parts of the start view that do not depend on the hour or the visitor
   (hero, "Как работи", subscription teaser, FAQ). Drawn on the server for SEO; the browser script (./_office.ts)
   draws the create form and the other views. Port of design/pages/office.html. */
import { ic, pic, esc, fmt } from "../../lib/render.ts";
import { byId, RESTAURANT, lunchIsToday, lunch, menu } from "../../lib/data.ts";
import { url } from "../../lib/routes.ts";

/** The example in the hero (a picture of the idea, real dishes from the lunch menu). In the shared list the same
    three colleagues are simulated ONLY behind ?preview=1 (./_office.ts). */
export const TEAM: { n: string; picks: Record<string, number> }[] = [
  { n: "Иван", picks: { "l-kyufteta-s-parzheni-kartofi-zele-i-morkov-lyuten": 1, "l-supa-topcheta": 1 } },
  { n: "Петя", picks: { "l-svezha-s-pile-i-parmezan": 1, "l-tikven-chiyzkeyk": 1 } },
  { n: "Георги", picks: { "l-lazanya-boloneze": 1, "l-pechena-tikva-s-med-i-orehi": 1 } },
].map((t) => ({ n: t.n, picks: Object.fromEntries(Object.entries(t.picks).filter(([k]) => byId[k])) }));

const sum = (p: Record<string, number>) => Math.round(Object.keys(p).reduce((s, k) => s + (byId[k] ? byId[k].p * p[k] : 0), 0) * 100) / 100;
const cnt = (p: Record<string, number>) => Object.values(p).reduce((s, q) => s + q, 0);
const dishes = (n: number) => n + " " + (n === 1 ? "ястие" : "ястия");
const souls = (n: number) => n + " " + (n === 1 ? "човек" : "души");

/** Short host + path for the example link in the chat bubble. */
export function exampleLink(site: string, code: string): string {
  return site.replace(/^https?:\/\//, "").replace(/\/$/, "") + "/" + "obedna-porachka-za-ofisa/#join-" + code;
}

export function heroHTML(site: string): string {
  const rows = TEAM.map((t, i) => {
    const x = byId[Object.keys(t.picks)[0]];
    return `<div class="o-join" style="animation-delay:${250 + i * 260}ms"><span class="o-ava a${i + 1}">${esc(t.n.charAt(0))}</span><span class="t"><b>${esc(t.n)} добави</b><span>${esc(x.n)}</span></span>${pic(x)}</div>`;
  }).join("");
  const total = TEAM.reduce((s, t) => s + sum(t.picks), 0), count = TEAM.reduce((s, t) => s + cnt(t.picks), 0);
  return `<section class="sec o-hero"><div class="o-hero-grid"><div>` +
    `<span class="o-eyebrow">${ic("briefcase", 18)}Обяд за целия офис с една поръчка</span>` +
    `<h1 class="h1">Обща поръчка за офиса</h1>` +
    `<p class="lead">Отворете поръчка, пратете връзката в чата на офиса и всеки си избира от обедното меню до крайния час. Носим всичко заедно.</p>` +
    `<ul class="o-facts">` +
      `<li><span class="o-fi">${ic("timer", 22)}</span><span>Колегите избират до 11:30 или до часа, който определите</span></li>` +
      `<li><span class="o-fi">${ic("truck", 22)}</span><span>Безплатна доставка до Дружба 1 и 2, НПЗ Искър и Бусманци</span></li>` +
      `<li><span class="o-fi">${ic("wallet", 22)}</span><span>Плаща един за всички или всеки своето</span></li>` +
    `</ul>` +
    `<div class="o-cta"><a class="pill pill-red go" href="#o-create" data-act="toform">Започни обща поръчка<span class="knob">${ic("arrow-right", 22)}</span></a>` +
    `<a class="link" href="${url.lunch()}" data-lunchlink>${lunchIsToday() ? "Виж днешното обедно меню" : "Виж обедното меню"}${ic("caret-right", 18)}</a></div></div>` +
    `<figure class="o-demo shell" style="margin:0" role="img" aria-label="Пример: връзката е в чата на офиса и колегите добавят ястия в общата поръчка"><div class="core" aria-hidden="true">` +
      `<div class="o-demo-h"><span><b>Обяд в офиса</b><span class="small">Чатът на офиса</span></span><span class="o-avas"><span class="o-ava me">М</span><span class="o-ava a1">И</span><span class="o-ava a2">П</span><span class="o-ava a3">Г</span></span></div>` +
      `<div class="o-bubble"><span class="who">Мария</span>Поръчваме обяд от Siracusa. Изберете си до 11:30.<br><span class="o-linkchip">${ic("arrow-up-right", 16)}<span>${esc(exampleLink(site, "482913"))}</span></span></div>` +
      `<div class="o-joins">${rows}</div>` +
      `<div class="o-demo-f" style="animation-delay:1050ms"><span>${souls(3)} · ${dishes(count)}</span><span class="price">${fmt(total)}</span></div>` +
    `</div></figure></div></section>`;
}

export function howHTML(): string {
  return `<section class="sec" aria-labelledby="o-how-h"><div class="sec-h"><h2 class="h2" id="o-how-h">Как работи</h2></div><ol class="o-how">` +
    `<li class="rv"><span class="o-num">1</span><div><h3 class="h3">Отворете поръчка</h3><p>Име на офиса, адрес и до колко часа избират колегите. По подразбиране 11:30.</p></div></li>` +
    `<li class="rv"><span class="o-num">2</span><div><h3 class="h3">Пратете връзката в чата</h3><p>Във Viber, в чата на фирмата или по имейл. Колегите пишат само името си, без профил.</p></div></li>` +
    `<li class="rv"><span class="o-num">3</span><div><h3 class="h3">Всеки избира, вие изпращате</h3><p>Виждате кой какво поръча и колко дължи. Ако сте дали телефон, в крайния час поръчката тръгва към ресторанта сама. Иначе я изпращате с едно докосване, и по-рано.</p></div></li>` +
  `</ol></section>`;
}

/** [question, answer HTML]; answers with [ЛИПСВА] stay on the page but not in the FAQPage JSON-LD. */
export const FAQ: [string, string][] = [
  ["До колко часа може да е крайният час?", "До 14:00. Обедното меню се доставя до 15:00, а след крайния час ние приготвяме и тръгваме към вас."],
  ["Как плащаме?", "В брой или с карта при получаване, без онлайн плащане. Може да плати един за всички или всеки своето."],
  ["Трябва ли колегите да имат профил?", "Не. Колегите отварят връзката, пишат само името си и избират от обедното меню."],
  ["Какво става в крайния час?", "Списъкът се затваря. Ако организаторът е дал телефон при създаването, поръчката тръгва към ресторанта сама. Без телефон организаторът я изпраща с един бутон. Може да я изпрати и по-рано."],
  ["Може ли организаторът да довърши поръчката от друго устройство?", "Да. След създаването получавате връзка само за вас. С нея отваряте списъка на друг телефон или компютър и изпращате поръчката."],
  ["Има ли минимална поръчка?", '<span class="missing">[ЛИПСВА: минимална поръчка за обща доставка]</span>'],
  ["Може ли фактура на фирмата?", '<span class="missing">[ЛИПСВА: фактура при обща поръчка]</span>'],
];

export function subFaqHTML(): string {
  const faq = FAQ.map(([q, a]) => `<details><summary>${esc(q)}${ic("caret-down", 20)}</summary><p>${a}</p></details>`).join("");
  return `<section class="sec"><div class="o-split">` +
    `<div class="o-sub-card shell rv"><div class="core"><span class="o-tag">Скоро</span><h2 class="h3" style="font-size:24px;letter-spacing:-.03em">Обяд за офиса всеки ден</h2>` +
      `<p class="muted" style="margin:0">Абонамент за обедното меню: седмичен план с доставка в избран час и фактура.</p>` +
      `<p class="missing small" style="margin:0">[ЛИПСВА: условия и цени на абонамента за офиси]</p>` +
      `<p style="margin:0;font-weight:600">Интересува ли ви? Обадете ни се:</p><a class="pill pill-line" href="tel:${RESTAURANT.phoneIntl}" style="justify-self:start" aria-label="Обади се на ${RESTAURANT.phone}">${ic("phone", 20)}${RESTAURANT.phone}</a></div></div>` +
    `<div><h2 class="h2" style="margin-bottom:10px">Въпроси</h2><div class="o-faq">${faq}</div></div>` +
  `</div></section>`;
}

/** The data the browser script needs (JSON in the page, #o-data): the lunch menu of the data and its date, the
    prototype's sample colleagues. Instead of the whole menu runtime (sc-menu.ts): speed. */
export function officeData() {
  return { date: menu.lunch.date, dayName: menu.lunch.dayName, items: lunch, team: TEAM };
}

export function officeLd(site: URL | undefined): object[] {
  const abs = (p: string) => new URL(p, site || "https://siracusa-sofia.com").href;
  const crumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) },
      { "@type": "ListItem", position: 2, name: "Обедно меню", item: abs(url.lunch()) },
      { "@type": "ListItem", position: 3, name: "Обща поръчка за офиса", item: abs(url.page("office")) },
    ],
  };
  const faq = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: FAQ.filter((z) => z[1].indexOf("[ЛИПСВА") < 0).map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a.replace(/<[^>]+>/g, "") } })),
  };
  return [crumbs, faq];
}
