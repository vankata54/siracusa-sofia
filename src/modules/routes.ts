/* THE ONLY PLACE FOR THE ADDRESSES OF THE MODULES OF STAGE D (docs/MODULES-BRIEF.md, section 3):
     the QR table   /masa/<код>/ (+ menu/, kolichka/, povikvane/, smetka/)
     the waiter     /servitor/ (+ vhod/, povikvania/, gotovi/, masa/#12, porachka/#12, chasovnik/)
     the kitchen    /kuhnya/ (+ vhod/, izcherpano/, natovareno/, izpalneni/, obsht-izgled/)
     the driver     /shofyor/ (+ vhod/, dostavka/#1042, marshrut/, gorivo/, smyana/)
     the manager    /upravitel/ (+ zalata/, ekipat/, oshte/)
     the owner      /sobstvenik/ (+ tendentsii/, finansi/, reshenia/)
   The same rule as src/admin/routes.ts: the server build gets "/servitor/gotovi/", the demo build a relative address
   with index.html (scripts/relativize.mjs does the same for the HTML). Parameters stay in "#".
   The QR table: on the server the code is a part of the path (/masa/k7f3m2pq/menu/; the server answers with the one
   static page of the screen); in the demo it is in the hash (masa/menu/index.html#k=k7f3m2pq). */
const cfg = { demo: false, root: "/" };
if (typeof document !== "undefined") {
  const de = document.documentElement;
  cfg.demo = de.dataset.demo === "1"; cfg.root = de.dataset.root || "/";
  if (!cfg.root.endsWith("/")) cfg.root += "/";
}
const go = (path: string, hash?: string) => (cfg.demo ? cfg.root + path + (path === "" || path.endsWith("/") ? "index.html" : "") : "/" + path) + (hash ? "#" + hash : "");

export type MasaScreen = "" | "menu" | "kolichka" | "povikvane" | "smetka";
export const MASA_SCREENS: MasaScreen[] = ["", "menu", "kolichka", "povikvane", "smetka"];
export type ServitorScreen = "" | "vhod" | "povikvania" | "gotovi" | "masa" | "porachka" | "chasovnik";
export type KuhnyaScreen = "" | "vhod" | "izcherpano" | "natovareno" | "izpalneni" | "obsht-izgled";
export type ShofyorScreen = "" | "vhod" | "dostavka" | "marshrut" | "gorivo" | "smyana";
export type UpravitelScreen = "" | "zalata" | "ekipat" | "oshte";
export type SobstvenikScreen = "" | "tendentsii" | "finansi" | "reshenia";

const sub = (base: string) => (screen = "", hash?: string) => go(base + (screen ? screen + "/" : ""), hash);
const CODE = /^[a-z0-9]{4,16}$/i;

export const murl = {
  /** the QR table: a screen of the table with this code; extra parameters go after the code in the hash */
  masa(code: string, screen: MasaScreen = "", hash?: string): string {
    const s = screen ? screen + "/" : "";
    if (cfg.demo) return go("masa/" + s, "k=" + encodeURIComponent(code) + (hash ? "&" + hash : ""));
    return "/masa/" + encodeURIComponent(code) + "/" + s + (hash ? "#" + hash : "");
  },
  /** the code of the table from the address of this page ("" when there is none or it is not a code) */
  masaCode(): string {
    if (typeof location === "undefined") return "";
    let c = "";
    if (cfg.demo) c = new URLSearchParams(location.hash.slice(1)).get("k") || "";
    else { const m = /^\/masa\/([^/]+)\//.exec(location.pathname); c = m ? decodeURIComponent(m[1]) : ""; }
    return CODE.test(c) ? c : "";
  },
  /** the parameters of this page from the hash, without the table code of the demo */
  hash(): URLSearchParams { const p = new URLSearchParams(typeof location === "undefined" ? "" : location.hash.slice(1)); p.delete("k"); return p; },
  servitor: sub("servitor/") as (screen?: ServitorScreen, hash?: string) => string,
  kuhnya: sub("kuhnya/") as (screen?: KuhnyaScreen, hash?: string) => string,
  shofyor: sub("shofyor/") as (screen?: ShofyorScreen, hash?: string) => string,
  upravitel: sub("upravitel/") as (screen?: UpravitelScreen, hash?: string) => string,
  sobstvenik: sub("sobstvenik/") as (screen?: SobstvenikScreen, hash?: string) => string,
  /** the tracking page of an order (the site): "1042-k7f3m2pq" */
  tracking: (id: string) => (cfg.demo ? go("porachka/", id) : "/porachka/" + encodeURIComponent(id) + "/"),
  /** this page as a logical address ("/servitor/masa/#12"): what #next= carries after the sign-in */
  here(): string {
    const root = new URL(document.documentElement.dataset.root || "/", location.href).pathname;
    let p = location.pathname.startsWith(root) ? "/" + location.pathname.slice(root.length) : location.pathname;
    p = p.replace(/index\.html$/, "");
    return p + location.hash;
  },
};
