/* Login (/vhod/): the HTML pieces shared by the server (index.astro, first paint: hero, perks, step 1) and the browser
   (./_login.ts, every later step). Pure strings, no DOM: ic / esc / url work in Node and in the browser. */
import { ic } from "../../lib/icons.ts";
import { esc, prettyPhone } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";
import { RESTAURANT as R } from "../../lib/consts.ts";
import { stepperHTML, callBtn, miss } from "../../lib/ui.ts";

export const DESCRIPTION = "Вход и регистрация в Siracusa Bar & Grill с телефон и код по SMS, без парола. Поръчайте отново с едно докосване и вземете -10% от следващата поръчка с нов профил.";

export const HERO = {
  eyebrow: "Вход и регистрация",
  h1: "Влезте с телефона си",
  lead: "Без парола. Пращаме ви код по SMS и сте вътре.",
};

/* "Какво получавате": the stamp rule and reward are [ЛИПСВА] (design/BRIEF.md 8), so no "2 от 10" promise here */
export const PERKS: [string, string, string][] = [
  ["receipt", "Поръчай отново", "Любимата поръчка с едно докосване."],
  ["map-pin", "Адресите са запомнени", "Не ги пишете всеки път."],
  ["fire", "Карта с печати", "Събирате печати за подарък. " + miss("stampRule") + " " + miss("stampReward")],
  ["ticket", "Купоните на едно място", "Кодовете и бонусът -10% са в профила ви."],
];

export function perksHTML(): string {
  return '<ul class="perks">' + PERKS.map((p) => '<li><span class="i">' + ic(p[0], 22) + "</span><span><b>" + p[1] + '</b><span class="s">' + p[2] + "</span></span></li>").join("") + "</ul>";
}

/** the shared stepper (lib/ui.ts): "Стъпка 2 от 3" + "Следва: Име" / "Последна стъпка" (the label is the current step,
    kept for the callers; the right side names the NEXT step, as in the cart, the reservation and the celebration) */
const LOGIN_STEPS = ["Телефон", "Код от SMS", "Име"];
export function stepper(n: number, _label: string, of = 3): string {
  return stepperHTML(n, of, n < of ? LOGIN_STEPS[n] : "", { label: "Стъпки на входа" });
}

/** step 1: the phone. `phone` is the raw value kept between steps. */
export function phoneHTML(phone = "", err = ""): string {
  const v = phone ? (/^0\d{9}$/.test(phone) ? prettyPhone(phone) : phone) : "";
  return stepper(1, "Телефон") +
    '<form class="view" data-f="phone" novalidate>' +
      '<div class="field"><label for="ph">Мобилен телефон</label>' +
        '<input class="input" id="ph" name="ph" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="0888 12 34 56" value="' + esc(v) + '" aria-describedby="ph-help ph-err"' + (err ? ' aria-invalid="true"' : "") + ">" +
        '<p class="help" id="ph-help">Пращаме SMS с 6 цифри. Без парола.</p>' +
        '<p class="err" id="ph-err"' + (err ? "" : " hidden") + ">" + esc(err) + "</p></div>" +
      "<div data-alert></div>" +
      '<button class="pill pill-red pill-lg pill-block" type="submit">' + ic("paper-plane-right", 20) + "Изпрати код по SMS</button>" +
      '<p class="fine">С входа приемате <a href="' + url.page("terms") + '">Общите условия</a> и <a href="' + url.page("privacy") + '">Политиката за поверителност</a>.</p>' +
    "</form>";
}

export function blockedHTML(phone: string): string {
  return '<div class="view center"><span class="ring">' + ic("phone", 30) + "</span>" +
    '<h2 class="h3" tabindex="-1" data-focus>Нека го направим по телефона</h2>' +
    '<p class="sub">С номер <b>' + esc(prettyPhone(phone)) + "</b> не можем да направим профил онлайн. Обадете ни се и ще помогнем с удоволствие.</p>" +
    callBtn("pill pill-red pill-lg pill-block") +
    '<button class="pill pill-line pill-lg pill-block" type="button" data-again>' + ic("arrow-left", 20) + "Въведи друг номер</button>" +
    '<p class="fine">Всеки ден от ' + R.open + " до " + R.close + ".</p></div>";
}

/** retry: "Опитай пак"; "call": too many tries (429), trying again is refused, so the action is the call (as in the reservation) */
export function alertHTML(title: string, text: string, retry: boolean | "call" = true): string {
  return '<div class="alert" role="alert">' + ic("warning-circle", 24) + "<b>" + esc(title) + "</b><span>" + esc(text) + "</span>" +
    (retry === "call" ? callBtn("pill pill-line") : retry ? '<button class="pill pill-line" type="submit">' + ic("arrow-right", 18) + "Опитай пак</button>" : "") + "</div>";
}
