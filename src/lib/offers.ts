/* Offers banner (ember): lunch / -30% after 15:00 / order for tomorrow, Greek night, birthday, -10% with a profile. */
import { state } from "./status.ts";
import { lastSaturday } from "./status.ts";
import { lunchIsToday } from "./data.ts";
import { plural } from "./format.ts";
import { url } from "./routes.ts";
import type { ClockInput } from "./time.ts";

export interface Offer { id: string; t: string; p: string; go: string; href: string }

export function offers(o?: ClockInput, today: Date = new Date()): Offer[] {
  const s = state(o), ev = lastSaturday(today), out: Offer[] = [];
  if (s.lunch) out.push(lunchIsToday(today)
    ? { id: "lunch", t: "Обедно меню днес", p: "Поръчайте до 15:00 с доставка или вземане от място.", go: "Виж обедното меню", href: url.lunch() }
    : { id: "lunch", t: "Обедно меню", p: "Качва се всяка сутрин. Поръчка до 15:00 с доставка или вземане.", go: "Виж обедното меню", href: url.lunch() });
  else if (s.lunchDiscount) out.push({ id: "lunch30", t: "-30% на обедното меню", p: "След 15:00 при вземане от място. Отстъпката се смята сама.", go: "Вземи от място", href: url.lunch() });
  else out.push({ id: "tomorrow", t: "Поръчай за утре", p: "Кухнята приема поръчки всеки ден от 10:00 до 22:30.", go: "Към менюто", href: url.menu() });
  out.push({ id: "greek", t: "Гръцка вечер", p: (ev.days === 0 ? "Днес" : "След " + plural(ev.days, "ден", "дни")) + ". Последната събота от месеца.", go: "Запази място", href: url.event("gratska-vecher") });
  out.push({ id: "birthday", t: "Рожден ден при нас", p: "-10% от сметката или малка торта за рожденика.", go: "Виж офертата", href: url.offers("birthday") });
  out.push({ id: "signup", t: "-10% с профил", p: "Направете профил и вземете -10% от следващата поръчка.", go: "Направи профил", href: url.login() });
  return out;
}
