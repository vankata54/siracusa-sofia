/* Constants without the menu (small; safe for the shared runtime bundle). data.ts re-exports all of this. */
import type { Dish, AllergenId, TagId } from "../data/menu.ts";
export { MON, MONTHS, DAYS } from "./format.ts";

export const RESTAURANT = {
  est: 2013 /* from the menu logo, to confirm */,
  /** three ways, the same words everywhere (decision 21 and 12.11.2026); the gift card is part of "Ваучер" (voucherNote) */
  payment: ["В брой", "Карта при получаване (Visa, Mastercard)", "Ваучер"],
  voucherNote: "(и подаръчна карта)",
  /** a card terminal in the delivery car: null = not known (OPEN-QUESTIONS, шофьор 24: [ЛИПСВА: терминал]) */
  cardOnDelivery: null as boolean | null,
  social: { facebook: "https://www.facebook.com/BarGrillSiracusa", instagram: null as string | null, google: null as string | null },
  googleReview: null as string | null,
  name: "Siracusa Bar & Grill",
  address: "ж.к. Дружба 2, срещу бл. 311, 1582 София",
  /* the same address in parts (as in the prototype's JSON-LD, design/pages) */
  street: "ж.к. Дружба 2, срещу бл. 311", postalCode: "1582", city: "София",
  /** open every day (design/pages JSON-LD: Monday..Sunday 10:00-23:00) */
  days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  phone: "0894 36 55 77",
  phoneIntl: "+359894365577",
  phone2: "0700 199 55",
  email: "menu@siracusa-sofia.com",
  open: "10:00", close: "23:00", kitchen: "22:30", delivery: "21:00", lunchUntil: "15:00",
  maps: "https://www.google.com/maps/dir/?api=1&destination=Siracusa+Bar+%26+Grill+%D0%94%D1%80%D1%83%D0%B6%D0%B1%D0%B0+2+%D0%A1%D0%BE%D1%84%D0%B8%D1%8F",
};

/* Order rules shared by the cart, the core and the server (one place). */
export const ORDER_RULES = {
  /** max quantity of one line */
  maxQty: 50,
  /** max different lines in one order */
  maxLines: 40,
  /** categories whose dishes take add-ons from the "dobavki" category (owner to confirm, docs/OPEN-QUESTIONS.md) */
  addonCats: ["pitsi", "burgeri", "pasta-i-rizoto", "salati", "zakuski"],
  /** add-ons come only from this category */
  addonCat: "dobavki",
  /** pickup: the traditional menu is ready 20 min after ordering (lunch at once) */
  pickupLeadMin: 20,
  /** pickup slots every 15 min */
  slotStep: 15,
  /** pickup slots up to 3 hours ahead */
  horizonMin: 180,
  /** pre-orders ("за утре" / "за днес" before 10:00): from 10:30; pickup until 22:30, delivery until 20:45 */
  preorderFrom: 630, pickupUntil: 1350, preorderDeliveryUntil: 1245,
  /** -30% on lunch dishes after 15:00, pickup only */
  lunchPickupDiscount: 0.3,
  /** a web order: at most this many portions (sum of q) and this sum in € (dishes); bigger: "За голяма поръчка се обадете" */
  maxPortions: 60,
  maxTotal: 500,
  /** office group order: portions per colleague, colleagues per order; the sum limit is maxTotal */
  officePortionsPerPerson: 10,
  officeMaxPeople: 60,
} as const;

export interface Zone { n: string; slug: string; etaMin: number; free: boolean; fee?: number | null; eta: string }
export const ZONES: Zone[] = [
  { n: "Дружба 1", slug: "druzhba-1", etaMin: 30, free: true, eta: "около 30\u00a0мин" },
  { n: "Дружба 2", slug: "druzhba-2", etaMin: 25, free: true, eta: "около 25\u00a0мин" },
  { n: "НПЗ Искър", slug: "npz-iskar", etaMin: 35, free: true, eta: "около 35\u00a0мин" },
  { n: "Бусманци", slug: "busmantsi", etaMin: 40, free: true, eta: "около 40\u00a0мин" },
  { n: "Горубляне", slug: "gorublyane", etaMin: 40, free: false, fee: null, eta: "около 40\u00a0мин" },
  { n: "Гара Искър", slug: "gara-iskar", etaMin: 45, free: false, fee: null, eta: "около 45\u00a0мин" },
];

export const TAGS: Record<TagId, [string, string]> = {
  hit: ["Хит", "fire"], new: ["Ново", "sparkle"], veg: ["Вегетарианско", "leaf"], hot: ["Люто", "pepper"], out: ["Изчерпано днес", "clock"],
};

/* 14 EU allergens (Reg. 1169/2011). Values in data are derived from the composition and must be confirmed by the kitchen. */
export const ALLERGENS: [AllergenId, string, string][] = [
  ["gluten", "Глутен", "grains"], ["crustaceans", "Ракообразни", "shrimp"], ["eggs", "Яйца", "egg"], ["fish", "Риба", "fish"],
  ["peanuts", "Фъстъци", "circles-three"], ["soy", "Соя", "plant"], ["milk", "Мляко", "drop"], ["nuts", "Ядки", "acorn"],
  ["celery", "Целина", "carrot"], ["mustard", "Синап", "jar"], ["sesame", "Сусам", "dots-nine"], ["sulphites", "Сулфити", "wine"],
  ["lupin", "Лупина", "flower"], ["molluscs", "Мекотели", "fish-simple"],
];
export function allergenName(k: string): string {
  const a = ALLERGENS.find((x) => x[0] === k);
  return a ? a[1] : k;
}

export interface Filter { id: string; n: string; icon: string; test: (x: Dish) => boolean; needs?: string }
/* Menu filters. Data-driven: a filter is shown only if at least one item matches. */
export const FILTERS: Filter[] = [
  { id: "veg", n: "Вегетарианско", icon: "leaf", test: (x) => x.t.indexOf("veg") > -1 },
  { id: "hot", n: "Люто", icon: "pepper", test: (x) => x.t.indexOf("hot") > -1 },
  { id: "noonion", n: "Без лук", icon: "plant", test: (x) => x.noOnion },
  { id: "share", n: "За споделяне", icon: "users-three", test: (x) => x.share },
  { id: "bertha", n: "От фурната Bertha", icon: "fire", test: (x) => x.cat === "skara-bertha" },
  { id: "nogluten", n: "Без глутен", icon: "grains", test: (x) => !!x.comp && x.al.indexOf("gluten") < 0 },
  { id: "nomilk", n: "Без мляко", icon: "drop", test: (x) => !!x.comp && x.al.indexOf("milk") < 0 },
  { id: "protein", n: "Протеиново", icon: "barbell", test: (x) => !!x.protein && x.protein >= 30, needs: "хранителни данни" },
  { id: "light", n: "Леко до 500 ккал", icon: "leaf", test: (x) => !!x.kcal && x.kcal <= 500, needs: "хранителни данни" },
];

export const EVENT_CATS = ["Жива музика", "Тематични вечери", "Празници", "Рождени дни", "Кръщенета", "Юбилеи", "Фирмени партита", "Абитуриентски", "Детски", "Частни партита"];

export const COURSE_NAME: Record<string, string> = {
  salad: "Салата", starter: "Предястие", main: "Основно", side: "Гарнитура", sauce: "Сос", dessert: "Десерт", drink: "Напитка", addon: "Добавка", breakfast: "Закуска",
};

export interface Table { id: string; n: number; zone: "salon" | "garden"; seats: number; shape: "round" | "square" | "rect"; x: number; y: number; window: boolean; stroller: boolean; access: boolean }
/* Mock floor plan for the mockups: 12 in the hall, 8 in the garden. Not a real capacity. */
export const TABLES: Table[] = (() => {
  const t: Table[] = [];
  const hall: [number, Table["shape"]][] = [[2, "round"], [2, "round"], [4, "square"], [4, "square"], [4, "square"], [6, "rect"], [2, "round"], [4, "square"], [4, "square"], [6, "rect"], [2, "round"], [4, "square"]];
  hall.forEach((h, i) => t.push({ id: "S" + (i + 1), n: i + 1, zone: "salon", seats: h[0], shape: h[1], x: i % 4, y: Math.floor(i / 4), window: i < 4, stroller: [5, 9].indexOf(i) > -1, access: [2, 6].indexOf(i) > -1 }));
  const gar: [number, Table["shape"]][] = [[4, "square"], [4, "square"], [6, "rect"], [2, "round"], [4, "square"], [2, "round"], [6, "rect"], [4, "square"]];
  gar.forEach((g, i) => t.push({ id: "G" + (i + 1), n: i + 13, zone: "garden", seats: g[0], shape: g[1], x: i % 4, y: Math.floor(i / 4), window: false, stroller: true, access: [0, 4].indexOf(i) > -1 }));
  return t;
})();

