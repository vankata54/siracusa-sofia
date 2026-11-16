/* Constants without the menu (small; safe for the shared runtime bundle). data.ts re-exports all of this. */
import type { AllergenId } from "../data/menu.ts";
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
  /** categories whose dishes take add-ons from the "dobavki" category: pizzas and burgers (DECISIONS 12.11 and 15.11, OPEN-QUESTIONS 10); in the admin code this list comes from the menu settings */
  addonCats: ["pitsi", "burgeri"],
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
  /** pickup TODAY (decision 12.11.2026): the kitchen accepts orders until 22:30; the order is ready at the latest at closing */
  pickupReadyUntil: 1380,
  /** -30% on lunch dishes after 15:00, pickup only */
  lunchPickupDiscount: 0.3,
  /** a web order: at most this many portions (sum of q) and this sum in € (dishes); bigger: "За голяма поръчка се обадете" */
  maxPortions: 60,
  maxTotal: 500,
  /** office group order: portions per colleague, colleagues per order; the sum limit is maxTotal */
  officePortionsPerPerson: 10,
  officeMaxPeople: 60,
} as const;

/** a delivery zone. on / min / from / to: the admin's settings (core/zones.ts); only the core reads them, the site build
    carries the fields above (the shared runtime budget) */
export interface Zone { n: string; slug: string; etaMin: number; free: boolean; fee?: number | null; eta: string; on?: boolean; min?: number | null; from?: string; to?: string }
/* ZONES: in lib/zones-data.ts (the server's rebuild puts the zones from the admin in its place, astro.config.mjs SITE_FILE) */
export { ZONES } from "./zones-data.ts";

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

/* TAGS, FILTERS and COURSE_NAME (only for the pages with dishes) are in lib/consts-menu.ts; lib/data.ts re-exports them.
   This file must NOT import or re-export that module: every module the shared runtime imports lands in the runtime chunk
   on every page (decision 16.11.2026, the runtime budget). The allergens stay here: /alergeni/ shows them without the menu. */

export interface Table { id: string; n: number; zone: "salon" | "garden"; seats: number; shape: "round" | "square" | "rect"; x: number; y: number; window: boolean; stroller: boolean; access: boolean }
/* TABLES (the mock floor plan) is in lib/tables.ts: only the reservation and the core need it (runtime size budget) */

