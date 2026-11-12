/* The one answer to „Как мога да платя?“ on every page (decision 12.11.2026), built from RESTAURANT.payment.
   The voucher's brand is not known: [ЛИПСВА] (OPEN-QUESTIONS). payAnswerText() is the same without [ЛИПСВА], for JSON-LD. */
import { RESTAURANT } from "./consts.ts";

const MISSING_VOUCHER = '<span class="missing">[ЛИПСВА: името на ваучерите]</span>';

/** HTML (with the [ЛИПСВА] mark), e.g. "В брой, карта при получаване (Visa, Mastercard), ваучер [ЛИПСВА] или подаръчна карта. ..." */
export function payAnswer(): string {
  const p = RESTAURANT.payment.map((x, i) => (i ? x.charAt(0).toLowerCase() + x.slice(1) : x))
    .map((x) => (/^ваучер$/i.test(x) ? x + " " + MISSING_VOUCHER : x));
  return p.slice(0, -1).join(", ") + " или " + p[p.length - 1] + ". Онлайн плащане засега няма: плащате, когато получите поръчката.";
}
/** plain text without [ЛИПСВА] (FAQPage JSON-LD) */
export function payAnswerText(): string {
  return payAnswer().replace(/\s*<span class="missing">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}
