/* The words of the QR table that both the server (Masa.astro) and the browser (frame.ts) need, BG and EN
   (design/pages-masa/_masa.js). Only the module's own texts have English; dish names, categories and allergens stay in
   Bulgarian ([ЛИПСВА: английски имена и състав на ястията]). Pure data, no DOM. */
import type { MasaScreen } from "../routes.ts";

export type MasaPage = "welcome" | "menu" | "cart" | "call" | "bill";
export const SCREEN_PATH: Record<MasaPage, MasaScreen> = { welcome: "", menu: "menu", cart: "kolichka", call: "povikvane", bill: "smetka" };

/** decision 34: Меню · Повикай сервитьор · Количка · Профил */
export const NAV: { id: MasaPage | "profile"; bg: string; en: string; icon: string; path: MasaScreen }[] = [
  { id: "menu", bg: "Меню", en: "Menu", icon: "fork-knife", path: "menu" },
  { id: "call", bg: "Повикай сервитьор", en: "Call a waiter", icon: "bell-ringing", path: "povikvane" },
  { id: "cart", bg: "Количка", en: "Cart", icon: "shopping-bag", path: "kolichka" },
  { id: "profile", bg: "Профил", en: "Profile", icon: "user", path: "" },
];

export type Kind = "order" | "bill" | "water" | "other";
export const CALLS: Record<Kind, { bg: string; en: string; icon: string; sub: [string, string] }> = {
  order: { bg: "Поръчка", en: "Order", icon: "note", sub: ["Сервитьорът да вземе поръчката", "The waiter takes our order"] },
  bill: { bg: "Сметка", en: "Bill", icon: "receipt", sub: ["В брой или с карта, заедно или поотделно", "Cash or card, together or split"] },
  water: { bg: "Вода или прибори", en: "Water or cutlery", icon: "drop", sub: ["Чаша вода, приборите, салфетки", "A glass of water, cutlery, napkins"] },
  other: { bg: "Друго", en: "Something else", icon: "chat-circle-dots", sub: ["Напишете с няколко думи", "Tell us in a few words"] },
};
/** the waiter's reasons (core/floor.ts REJECT_REASONS: the Bulgarian text comes from the view) */
export const REJECT_EN: Record<string, string> = {
  test: "It looks like it was sent by mistake or as a test.",
  gaveup: "The waiter noted that you changed your mind.",
  manual: "The waiter will take it in person, at the table.",
};
export const STATUS: Record<string, [string, string, string]> = {
  wait: ["Чака", "Waiting", "hourglass"],
  accepted: ["Прието", "Accepted", "check"],
  cooking: ["Готви се", "Cooking", "fire"],
  served: ["Сервирано", "Served", "check-circle"],
  out: ["Изчерпано днес", "Sold out today", "warning-circle"],
};
export const PAY: Record<"cash" | "card", [string, string, string]> = { cash: ["В брой", "Cash", "money"], card: ["С карта", "By card", "credit-card"] };
/** the same words as the waiter's module */
export const SPLIT: Record<"one" | "guests" | "dishes", [string, string]> = { one: ["Една сметка", "One bill"], guests: ["По гости", "By guest"], dishes: ["По ястия", "By dish"] };
export const FILTER_EN: Record<string, string> = { veg: "Vegetarian", hot: "Spicy", noonion: "No onion", nogluten: "Gluten free", nomilk: "Dairy free" };
