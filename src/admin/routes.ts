/* THE ONLY PLACE FOR THE ADDRESSES OF THE ADMIN AND THE STAFF MODULES (decision of the chief 15.11.2026):
     sign-in /admin/vhod/, dashboard /admin/, sections /admin/<key of SECTIONS>/ (/admin/notes/, /admin/roles/ ...),
     the live preview /admin/preview/, the staff modules /servitor/, /kuhnya/, /shofyor/ (their screens and the modules of
     the manager and the owner are in src/modules/routes.ts; here only what #next= needs to know about them).
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
/* the modules a signed-in person may be sent back to after the sign-in (#next=): the first folder of the address -> the key
   that decides who may open it (the staff apps: their section; "upravitel" / "sobstvenik": by role, BOSS_ROLES).
   One screen below the module and parameters in "#" are allowed ("/upravitel/zalata/#t=12"). */
const MODULE_KEYS: Record<string, string> = { servitor: "waiter", kuhnya: "kitchen", shofyor: "driver", upravitel: "upravitel", sobstvenik: "sobstvenik" };
const MODULE_RE = /^\/(servitor|kuhnya|shofyor|upravitel|sobstvenik)\/((?:[a-z-]+\/)?)(#[^\s]*)?$/;
/** who opens the modules of the manager and the owner (BRIEF-STEP5, section 5): the owner sees both ("Смяната сега") */
export const BOSS_ROLES: Record<string, string[]> = { upravitel: ["admin", "owner", "manager"], sobstvenik: ["admin", "owner"] };
/** the own module of the role, for "Къде продължаваш?" after the sign-in */
export const BOSS_HOME: Record<string, "upravitel" | "sobstvenik"> = { manager: "upravitel", owner: "sobstvenik" };

const go = (path: string, hash?: string) => (cfg.demo ? cfg.root + path + (path === "" || path.endsWith("/") ? "index.html" : "") : "/" + path) + (hash ? "#" + hash : "");

export const aurl = {
  /** the dashboard */
  home: (hash?: string) => go("admin/", hash),
  /** sign-in; next: a logical address to return to ("/admin/notes/#s=new") */
  login: (next?: string) => go("admin/vhod/", next ? "next=" + encodeURIComponent(next) : undefined),
  /** a section by its key in SECTIONS; "dashboard" is /admin/ */
  section: (key: string, hash?: string) => (key === "dashboard" ? go("admin/", hash) : go("admin/" + key + "/", hash)),
  /** "Внос на меню" (a screen of the section "Меню"; its rights are those of "Меню") */
  menuImport: (hash?: string) => go("admin/menu/vnos/", hash),
  /** the live preview ("Отвори на живо"): #m=<module>&p=<screen>&d=<device> */
  preview: (hash?: string) => go("admin/preview/", hash),
  /** the module of a staff role */
  app: (role: string) => go(STAFF_APPS[role] || "admin/"),
  /** the logical address of a section ("/admin/notes/") */
  logical: (key: string, hash?: string) => "/admin/" + (key === "dashboard" ? "" : key + "/") + (hash ? "#" + hash : ""),
  /** "/admin/notes/#s=new" or the address of a module of the staff ("/kuhnya/", "/upravitel/zalata/#t=12") -> href;
      anything else (another site, the sign-in itself) -> null */
  fromLogical(l: string | null | undefined): string | null {
    const v = String(l || ""), app = MODULE_RE.exec(v);
    if (app) return go(app[1] + "/" + app[2], app[3] ? app[3].slice(1) : undefined);
    const m = /^\/admin\/((?:[a-z-]+\/){0,2})(#[^\s]*)?$/.exec(v);
    if (!m || m[1] === "vhod/") return null;
    return go("admin/" + m[1], m[2] ? m[2].slice(1) : undefined);
  },
  /** the key of a logical address: a section ("/admin/notes/" -> "notes", "/admin/" -> "dashboard"), the section of a staff
      module ("/kuhnya/" -> "kitchen") or the module of the manager / the owner ("/upravitel/zalata/" -> "upravitel") */
  keyOf(l: string): string {
    const app = MODULE_RE.exec(l); if (app) return MODULE_KEYS[app[1]];
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
