/* The one answer to „Как мога да платя?“ on every page (decision 12.11.2026), built from RESTAURANT.payment.
   Two facts are not known yet and are never promised: whether the delivery car has a card terminal
   (RESTAURANT.cardOnDelivery, OPEN-QUESTIONS шофьор 24) and the brand of the vouchers. payAnswer() marks them [ЛИПСВА];
   payAnswerText() (JSON-LD, plain text) says only what is true: the card at the restaurant, ask us about the card at delivery. */
import { RESTAURANT } from "./consts.ts";

const miss = (t: string) => '<span class="missing">[ЛИПСВА: ' + t + "]</span>";
const low = (x: string, i: number) => (i ? x.charAt(0).toLowerCase() + x.slice(1) : x);
const isCard = (x: string) => /^карта при получаване/i.test(x);
const isVoucher = (x: string) => /^ваучер$/i.test(x);
const join = (p: string[]) => p.slice(0, -1).join(", ") + " или " + p[p.length - 1];
/** "Карта при получаване (Visa, Mastercard)" + note -> "(Visa, Mastercard; note)" */
const addNote = (x: string, note: string) => (/\)$/.test(x) ? x.slice(0, -1) + "; " + note + ")" : x + " (" + note + ")");
const ONLINE = "Онлайн плащане засега няма: плащате, когато получите поръчката.";

/** HTML with the [ЛИПСВА] marks */
export function payAnswer(): string {
  const d = RESTAURANT.cardOnDelivery;
  const p = RESTAURANT.payment.map(low).map((x) =>
    isCard(x) ? (d === true ? x : addNote(x, d === false ? "в ресторанта; при доставка в брой" : "при доставка " + miss("терминал за карти в колата")))
      : isVoucher(x) ? x + " " + miss("името на ваучерите") : x);
  return join(p) + ". " + ONLINE;
}
/** plain text without [ЛИПСВА] and without a promise that is not known (FAQPage JSON-LD) */
export function payAnswerText(): string {
  const d = RESTAURANT.cardOnDelivery;
  const p = RESTAURANT.payment.map(low).map((x) => (isCard(x) && d !== true ? x + " в ресторанта" : x));
  return join(p) + "." + (d === null ? " За карта при доставка ни попитайте по телефона." : d === false ? " При доставка се плаща в брой." : "") + " " + ONLINE;
}
