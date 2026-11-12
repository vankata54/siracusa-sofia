/* About page: the closing call to action depends on the hour (kitchen until 22:30, delivery until 21:00).
   No menu import: the browser script uses it too (keeps the page JS small). */
import { url } from "../../lib/routes.ts";
import { RESTAURANT } from "../../lib/consts.ts";
import type { State } from "../../lib/status.ts";

export interface EndCta { label: string; href: string; text: string }

export function endCta(st: Pick<State, "kitchen" | "delivery">): EndCta {
  const R = RESTAURANT;
  if (!st.kitchen) return { label: "Поръчай за утре", href: url.menu(), text: "Кухнята затвори за днес. Приемаме поръчки утре от " + R.open + ". Или запазете маса." };
  if (!st.delivery) return { label: "Поръчай за вземане", href: url.page("pickup"), text: "Доставката приключи за днес. Вземане до " + R.kitchen + "." };
  return { label: "Поръчай", href: url.menu(), text: "Запазете маса в салона или в градината. Или поръчайте и ние ще донесем, до " + R.delivery + "." };
}

/** The link under "Кварталът": "днес" only when the lunch menu in the data is for today's date (BRIEF 8). */
export function lunchLinkText(isToday: boolean): string { return isToday ? "Обедното меню днес" : "Обедното меню"; }
