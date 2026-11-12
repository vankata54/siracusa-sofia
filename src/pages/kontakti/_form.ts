/* Contacts (/kontakti/): the feedback form (HTML + validation). The server draws the empty form (works before the JS),
   the browser redraws it with the draft kept in localStorage ("sc-contact-draft"). No menu import. */
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";
import { url } from "../../lib/routes.ts";

export const TOPICS = ["Въпрос", "Похвала", "Нещо не беше наред", "Друго"];
export const COMPLAINT = "Нещо не беше наред";
export const MAX = 1000;
export type Mode = "phone" | "email";
export interface Draft { topic: string; name: string; mode: Mode; contact: string; msg: string }
export const EMPTY: Draft = { topic: "", name: "", mode: "phone", contact: "", msg: "" };

export const MODES: Record<Mode, { type: string; im: string; ac: string; ph: string; help: string }> = {
  phone: { type: "tel", im: "tel", ac: "tel", ph: "0888 12 34 56", help: "Ще ви се обадим на този номер. Не го ползваме за реклами." },
  email: { type: "email", im: "email", ac: "email", ph: "ime@primer.bg", help: "Ще ви отговорим на този имейл. Не го ползваме за реклами." },
};

/** A draft from localStorage is user data: keep only known fields with the right types. */
export function cleanDraft(v: unknown): Draft {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const s = (k: string, max: number) => (typeof o[k] === "string" ? (o[k] as string).slice(0, max) : "");
  const topic = s("topic", 40);
  return { topic: TOPICS.includes(topic) ? topic : "", name: s("name", 60), mode: o.mode === "email" ? "email" : "phone", contact: s("contact", 80), msg: s("msg", MAX) };
}

export function formHTML(d: Draft): string {
  const md = MODES[d.mode] || MODES.phone;
  return '<form class="ct-form" novalidate data-form aria-labelledby="h-fb">' +
    '<fieldset><legend>За какво е? <span>(по желание)</span></legend><div class="chips" data-topics>' +
      TOPICS.map((t) => '<button class="chip" type="button" aria-pressed="' + (d.topic === t) + '">' + t + "</button>").join("") + "</div>" +
      '<p class="hint" data-tophint' + (d.topic === COMPLAINT ? "" : " hidden") + ">" + ic("info", 18) + '<span>Съжаляваме. <span class="missing">[ЛИПСВА: кой чете оплакванията]</span></span></p></fieldset>' +
    '<div class="two">' +
      '<div class="field"><label for="f-name">Вашето име</label><input class="input" id="f-name" name="name" autocomplete="name" maxlength="60" value="' + esc(d.name) + '" aria-describedby="e-name"><p class="err" id="e-name" hidden></p></div>' +
      '<div class="field"><label for="f-contact" id="l-contact">Как да ви отговорим?</label>' +
        '<div class="seg" role="group" aria-label="Как да ви отговорим">' +
          '<button type="button" data-mode="phone" aria-pressed="' + (d.mode !== "email") + '">' + ic("phone", 20) + "Телефон</button>" +
          '<button type="button" data-mode="email" aria-pressed="' + (d.mode === "email") + '">' + ic("paper-plane-right", 20) + "Имейл</button></div>" +
        '<input class="input" id="f-contact" name="contact" type="' + md.type + '" inputmode="' + md.im + '" autocomplete="' + md.ac + '" placeholder="' + md.ph + '" maxlength="80" value="' + esc(d.contact) + '" aria-describedby="h-contact e-contact">' +
        '<p class="help" id="h-contact">' + md.help + '</p><p class="err" id="e-contact" hidden></p></div>' +
    "</div>" +
    '<div class="field"><div class="cnt-row"><label for="f-msg">Съобщение</label><span class="count" data-count aria-hidden="true">' + d.msg.length + " / " + MAX + "</span></div>" +
      '<textarea class="input" id="f-msg" name="msg" rows="5" maxlength="' + MAX + '" aria-describedby="e-msg">' + esc(d.msg) + '</textarea><p class="err" id="e-msg" hidden></p></div>' +
    '<p class="priv">Ползваме данните ви само за да ви отговорим. <a href="' + url.page("privacy") + '">Поверителност</a></p>' +
    '<div class="ct-alert" data-alert role="alert" hidden></div>' +
    '<button class="pill pill-red pill-lg pill-block" type="submit" data-send>' + ic("paper-plane-right", 22) + "Изпрати съобщението</button>" +
  "</form>";
}

/** Validation of one field ("" = fine). Phone: 10 digits starting with 0, or +359 and 9 digits (BRIEF 8). */
export function fieldError(id: "name" | "contact" | "msg", raw: string, mode: Mode): string {
  const v = (raw || "").trim();
  if (id === "name") return v.length < 2 ? "Напишете името си." : "";
  if (id === "contact") {
    if (mode === "email") {
      if (!v) return "Напишете имейл, за да ви отговорим.";
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) ? "" : "Имейлът изглежда непълен. Пример: ime@primer.bg";
    }
    if (!v) return "Напишете телефон, за да ви се обадим.";
    const dg = v.replace(/[\s\-().\/]/g, "");
    return /^(0\d{9}|\+359\d{9})$/.test(dg) ? "" : "Номерът трябва да е 10 цифри, започващи с 0. Пример: 0888 12 34 56";
  }
  if (!v) return "Напишете съобщението си.";
  return v.length < 10 ? "Напишете малко повече, поне 10 знака." : "";
}
