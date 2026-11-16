/* Addresses of the prototype -> addresses of the site, for porting prototype scripts (design/pages/*.html).
   OUT of the shared runtime (src/client/sc.ts): no page of the site needs it at run time. A script that still does
   imports it from here: import { fromProto } from "../lib/routes-proto.ts" (decision 16.11.2026, the runtime budget). */
import { url, type PageKey } from "./routes.ts";

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
  if (file === "404.html") return url.notFound();
  const k = PROTO[file];
  return k ? url.page(k, hash) : href;
}
