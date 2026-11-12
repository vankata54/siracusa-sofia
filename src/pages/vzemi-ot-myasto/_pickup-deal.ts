/* Pickup page (/vzemi-ot-myasto/): the -30% card with three dishes of the lunch menu. It needs the menu, so the browser
   draws it after the first paint (the menu chunk loads then); the server draws it into the HTML as always. */
import { RESTAURANT as R } from "../../lib/consts.ts";
import { byId } from "../../lib/data.ts";
import { fmt, esc } from "../../lib/format.ts";
import { ic } from "../../lib/icons.ts";
import { url } from "../../lib/routes.ts";
import { pic, plusBtn } from "../../lib/render.ts";
import { round2 } from "../../lib/pricing.ts";
/* the cart total in the button: price() comes with this chunk (a dynamic import of pricing.ts itself would keep all its exports) */
export { price } from "../../lib/pricing.ts";
import type { State } from "../../lib/status.ts";
import { OPEN, LUNCH_END, PCT, dur } from "./_pickup.ts";

const K = R.kitchen, L = R.lunchUntil;
/** Lunch price after 15:00 for pickup (same rounding as price()). */
export const off = (p: number) => round2(p - Math.round(p * PCT) / 100);

export const DEAL_IDS = ["l-pile-chetiri-sirena-s-kartofeno-pyure", "l-lazanya-boloneze", "l-svezha-s-pile-i-parmezan"];
export interface DealView { s: State | null; isToday: boolean; orderable: boolean }
export function dealHTML(v: DealView): string {
  const s = v.s, m = s ? s.m : -1;
  let when: string;
  if (!s) when = "Всеки ден от " + L + " до " + K;
  else if (s.lunchDiscount) when = "Важи сега · до " + K;
  else if (s.kitchen && m < LUNCH_END) when = "Започва в " + L + " · след " + dur(LUNCH_END - m);
  else if (m < OPEN) when = "Днес от " + L + " до " + K;
  else when = "Утре от " + L + " до " + K;
  const active = !!s && s.lunchDiscount;
  const ex = DEAL_IDS.map((id) => byId[id]).filter(Boolean);
  const rows = ex.map((x) => {
    const pr = active
      ? '<span class="price">' + fmt(off(x.p)) + '</span><span class="old price">' + fmt(x.p) + "</span>"
      : '<span class="price">' + fmt(x.p) + '</span><span class="after">след ' + L + ': <span class="price">' + fmt(off(x.p)) + "</span></span>";
    return '<div class="pk-ex" role="listitem">' + pic(x) + '<span><span class="nm">' + esc(x.n) + '</span><span class="pr">' + pr + "</span></span>" + (v.orderable ? plusBtn(x) : "<span></span>") + "</div>";
  }).join("");
  const first = ex[0];
  return '<div class="ember-card pk-deal"><span class="pk-when">' + ic("clock", 16) + when + "</span>" +
    '<div><span class="pct" aria-hidden="true">-' + PCT + '%</span><h2 class="h2" id="pk-deal-h">на обедното меню след ' + L + '</h2><p style="margin-top:10px">Само при вземане от място. След ' + L + " обедното меню не се доставя.</p></div>" +
    (v.isToday ? "" : '<p class="pk-sample">' + ic("info", 20) + "<span>Обедното меню се качва всяка сутрин. Пример за цените:</span></p>") +
    '<div class="core" role="list" aria-label="' + (v.isToday ? "Примери от днешното обедно меню" : "Примери от обедното меню") + '">' + rows + "</div>" +
    (first ? '<p class="foot-note">' + ic("info", 20) + "<span>Отстъпката се смята сама в количката, без код. Например: „Отстъпка след " + L + ": -" + fmt(round2(first.p - off(first.p))) + "“.</span></p>" : "") +
    '<a class="pill pill-ink" href="' + url.lunch() + '">' + ic("bowl-food", 20) + "Виж цялото обедно меню</a></div>";
}
