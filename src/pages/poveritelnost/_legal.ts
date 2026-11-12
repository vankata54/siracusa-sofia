/* Legal pages (/poveritelnost/, /biskvitki/, /obshti-uslovia/): shared pieces (server only).
   docs/BUILD-PLAN.md: simple text templates with "[ЛИПСВА: текст от юрист]". Only facts that already exist in the code
   (RESTAURANT, the decisions, what the site really stores); every legal wording is a [ЛИПСВА] slot, nothing invented. */
import { url, esc, RESTAURANT as R, type PageKey } from "../../lib/index.ts";

export interface LegalSection { id: string; h: string; html: string }

/** A "[ЛИПСВА: ...]" slot (class .missing, as everywhere on the site). */
export const M = (what = "текст от юрист"): string => '<span class="missing">[ЛИПСВА: ' + esc(what) + "]</span>";
/** A paragraph that is only a slot for the lawyer's text. */
export const MP = (what = "текст от юрист"): string => '<p class="lg-miss">' + M(what) + "</p>";

export const LEGAL: [PageKey, string][] = [["privacy", "Поверителност"], ["cookies", "Бисквитки"], ["terms", "Общи условия"]];

/** The restaurant's contacts, from RESTAURANT only. */
export function contactsHTML(): string {
  return '<dl class="lg-dl"><div><dt>Име</dt><dd>' + esc(R.name) + "</dd></div><div><dt>Адрес</dt><dd>" + esc(R.address) + "</dd></div>" +
    '<div><dt>Телефон</dt><dd><a class="link" href="tel:' + R.phoneIntl + '">' + R.phone + "</a></dd></div>" +
    '<div><dt>Имейл</dt><dd><a class="link" href="mailto:' + R.email + '">' + R.email + "</a></dd></div>" +
    "<div><dt>Юридическо лице</dt><dd>" + M("фирма, ЕИК, седалище и представител") + "</dd></div></dl>";
}

export function breadcrumbLd(site: URL | undefined, key: PageKey, name: string): object {
  const abs = (p: string) => new URL(p, site).href;
  return {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [{ "@type": "ListItem", position: 1, name: "Начало", item: abs(url.home()) }, { "@type": "ListItem", position: 2, name, item: abs(url.page(key)) }],
  };
}
