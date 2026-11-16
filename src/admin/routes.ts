/* THE ONLY PLACE FOR THE ADDRESSES OF THE ADMIN AND THE STAFF MODULES (decision of the chief 15.11.2026):
     sign-in /admin/vhod/, dashboard /admin/, sections /admin/<key of SECTIONS>/ (/admin/notes/, /admin/roles/ ...),
     the live preview /admin/preview/, the staff modules /servitor/, /kuhnya/, /shofyor/.
   The same rule as src/lib/routes.ts: the server build gets "/admin/notes/", the demo build relative "../notes/index.html"
   (scripts/relativize.mjs does the same for the HTML).
   "Logical" addresses ("/admin/notes/#s=new") are what #next= carries: the same in the server and in the demo. */
/* the same rule as p() in src/lib/routes.ts (kept here: importing it would add exports to the shared runtime chunk) */
const cfg = { demo: false, root: "/" };
if (typeof document !== "undefined") {
  const de = document.documentElement;
  cfg.demo = de.dataset.demo === "1"; cfg.root = de.dataset.root || "/";
  if (!cfg.root.endsWith("/")) cfg.root += "/";
}

/** the staff apps (decision 15.11.2026: waiter, kitchen and driver work in their own module, full screen) */
export const STAFF_APPS: Record<string, string> = { waiter: "servitor/", kitchen: "kuhnya/", driver: "shofyor/" };
export type StaffApp = "waiter" | "kitchen" | "driver";

const go = (path: string, hash?: string) => (cfg.demo ? cfg.root + path + (path === "" || path.endsWith("/") ? "index.html" : "") : "/" + path) + (hash ? "#" + hash : "");

export const aurl = {
  /** the dashboard */
  home: (hash?: string) => go("admin/", hash),
  /** sign-in; next: a logical address to return to ("/admin/notes/#s=new") */
  login: (next?: string) => go("admin/vhod/", next ? "next=" + encodeURIComponent(next) : undefined),
  /** a section by its key in SECTIONS; "dashboard" is /admin/ */
  section: (key: string, hash?: string) => (key === "dashboard" ? go("admin/", hash) : go("admin/" + key + "/", hash)),
  /** the live preview ("Отвори на живо"): #m=<module>&p=<screen>&d=<device> */
  preview: (hash?: string) => go("admin/preview/", hash),
  /** the module of a staff role */
  app: (role: string) => go(STAFF_APPS[role] || "admin/"),
  /** the logical address of a section ("/admin/notes/") */
  logical: (key: string, hash?: string) => "/admin/" + (key === "dashboard" ? "" : key + "/") + (hash ? "#" + hash : ""),
  /** "/admin/notes/#s=new" or a staff module ("/kuhnya/") -> href; anything else (another site, the sign-in itself) -> null */
  fromLogical(l: string | null | undefined): string | null {
    const v = String(l || ""), app = /^\/(servitor|kuhnya|shofyor)\/$/.exec(v);
    if (app) return go(app[1] + "/");
    const m = /^\/admin\/((?:[a-z-]+\/)?)(#[^\s]*)?$/.exec(v);
    if (!m || m[1] === "vhod/") return null;
    return go("admin/" + m[1], m[2] ? m[2].slice(1) : undefined);
  },
  /** the section key of a logical address ("/admin/notes/" -> "notes", "/admin/" -> "dashboard", "/kuhnya/" -> "kitchen") */
  keyOf(l: string): string {
    const app = Object.keys(STAFF_APPS).find((k) => l === "/" + STAFF_APPS[k]); if (app) return app;
    const m = /^\/admin\/([a-z-]+)\//.exec(l); return m ? m[1] : "dashboard";
  },
  /** this page as a logical address (server: the path; demo: the path below the site root, without index.html) */
  here(): string {
    const root = new URL(document.documentElement.dataset.root || "/", location.href).pathname;
    let p = location.pathname.startsWith(root) ? "/" + location.pathname.slice(root.length) : location.pathname;
    p = p.replace(/index\.html$/, "");
    return p + location.hash;
  },
};
