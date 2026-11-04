/* THE ONLY PLACE FOR ADDRESSES. Every link in pages, render functions and client scripts goes through `url`.
   Server build: absolute pretty paths ("/menu/pitsi/"). Demo build (static files, no server): the HTML is rewritten
   to relative "../menu/index.html" by scripts/relativize.mjs, and in the browser `configureRoutes()` (called by
   src/client/sc.ts from <html data-root data-demo>) makes url() return relative "index.html" paths as well. */
import type { Dish } from "../data/menu.ts";

type Opts = { root: string; demo: boolean };
let cfg: Opts = { root: "/", demo: false };

/** Browser only: <html data-demo data-root="../../">. Server code never calls this. */
export function configureRoutes(o: Partial<Opts>): void {
  cfg = { ...cfg, ...o };
  if (!cfg.root.endsWith("/")) cfg.root += "/";
}
export function routesConfig(): Opts { return { ...cfg }; }

/** Path inside the site without leading slash ("menu/pitsi/" or "" for home) -> final href. */
function p(path: string, hash?: string): string {
  const h = hash ? "#" + hash : "";
  if (!cfg.demo) return "/" + path + h;
  const file = path === "" || path.endsWith("/") ? path + "index.html" : path;
  return cfg.root + file + h;
}

export const PAGES = {
  home: "",
  menu: "menu/",
  lunch: "obedno-menu/",
  cart: "kolichka/",
  tracking: "porachka/",
  office: "obedna-porachka-za-ofisa/",
  reservation: "rezervatsia/",
  events: "sabitia/",
  celebration: "praznik/",
  offers: "oferti/",
  login: "vhod/",
  profile: "profil/",
  delivery: "dostavka/",
  pickup: "vzemi-ot-myasto/",
  bertha: "furna-bertha/",
  about: "za-nas/",
  gallery: "galeria/",
  contacts: "kontakti/",
  allergens: "alergeni/",
  privacy: "poveritelnost/",
  cookies: "biskvitki/",
  terms: "obshti-uslovia/",
  admin: "admin/",
  adminLogin: "admin/vhod/",
} as const;
export type PageKey = keyof typeof PAGES;

type DishLike = Pick<Dish, "id" | "cat"> & { lunch?: boolean };

export const url = {
  page: (k: PageKey, hash?: string) => p(PAGES[k], hash),
  home: (hash?: string) => p("", hash),
  menu: (hash?: string) => p(PAGES.menu, hash),
  cat: (id: string, hash?: string) => p("menu/" + id + "/", hash),
  /** Dish page. Lunch items have no own page: they link to the lunch menu. */
  dish: (x: DishLike | string, hash?: string) => {
    const d = typeof x === "string" ? resolveDish(x) : x;
    if (!d) return p(PAGES.menu, hash);
    if (d.lunch || d.cat === "obedno") return p(PAGES.lunch, hash);
    return p("menu/" + d.cat + "/" + d.id + "/", hash);
  },
  lunch: (hash?: string) => p(PAGES.lunch, hash),
  cart: (hash?: string) => p(PAGES.cart, hash),
  /** Order tracking. Server: /porachka/1042/ (the server serves the same static page for any number).
      Demo (no server): porachka/index.html#1042. */
  tracking: (no?: string | number) => (no == null ? p(PAGES.tracking) : cfg.demo ? p(PAGES.tracking, String(no)) : p(PAGES.tracking + no + "/")),
  events: (hash?: string) => p(PAGES.events, hash),
  event: (slug: string, hash?: string) => p("sabitia/" + slug + "/", hash),
  reservation: (hash?: string) => p(PAGES.reservation, hash),
  offers: (hash?: string) => p(PAGES.offers, hash),
  login: (hash?: string) => p(PAGES.login, hash),
  profile: (hash?: string) => p(PAGES.profile, hash),
  /** API base: "/api" (never used in demo, where api.ts calls the core in the browser). */
  api: (path: string) => "/api/" + path.replace(/^\//, ""),
  /** A static asset under public/ ("favicon.svg"). */
  asset: (path: string) => p(path.replace(/^\//, "")),
};

/* dish lookup is injected (to keep routes.ts free of the 40 KB menu in pages that only need links) */
let resolveDish: (id: string) => DishLike | undefined = () => undefined;
export function setDishResolver(fn: (id: string) => DishLike | undefined): void { resolveDish = fn; }

/** Prototype file -> page key (for porting prototype scripts). */
export const PROTO: Record<string, PageKey> = {
  "home.html": "home", "menu.html": "menu", "lunch.html": "lunch", "cart.html": "cart", "tracking.html": "tracking",
  "office.html": "office", "reservation.html": "reservation", "events.html": "events", "celebration.html": "celebration",
  "offers.html": "offers", "login.html": "login", "profile.html": "profile", "delivery.html": "delivery", "pickup.html": "pickup",
  "bertha.html": "bertha", "about.html": "about", "gallery.html": "gallery", "contacts.html": "contacts", "allergens.html": "allergens",
};

/** "menu.html" -> "/menu/", "dish.html#id" -> dish url, "category.html#pitsi" -> "/menu/pitsi/", "event.html#x" -> "/sabitia/x/",
    "tracking.html#1042" -> tracking url, "offers.html#birthday" -> "/oferti/#birthday", "#x" stays "#x". */
export function fromProto(href: string): string {
  if (!href || href.startsWith("#") || /^(https?:|tel:|mailto:)/.test(href)) return href;
  const [file, hash] = href.replace(/^(\.\.\/)?(pages\/)?/, "").split("#");
  if (file === "dish.html") return hash ? url.dish(hash.split("&")[0]) : url.menu();
  if (file === "category.html") {
    const [cat, ...rest] = (hash || "pitsi").split("&");
    return url.cat(cat, rest.length ? rest.join("&") : undefined);
  }
  if (file === "event.html") return hash ? url.event(hash) : url.events();
  if (file === "tracking.html") return url.tracking(hash || undefined);
  if (file === "404.html") return p("404/");
  const k = PROTO[file];
  return k ? url.page(k, hash) : href;
}
