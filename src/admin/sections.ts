/* The data of the admin frame (no DOM, works in Node for the tests): the sections by groups, the roles, the modules, and the
   addresses that still show "Скоро". Names and descriptions from the approved prototype (design/pages-admin/_admin.js, v4);
   the section names and the roles are the same as in src/core/staff.ts (tests/unit/admin-frame.test.ts). */
import { aurl } from "./routes.ts";

export interface Sec { id: string; n: string; short: string; ic: string; desc: string; soon?: boolean }
const SEC_LIST: [string, string, string, string, string][] = [
  ["dashboard", "Табло", "Табло", "squares-four", "Всички модули на системата на едно място и какво става днес."],
  ["orders", "Поръчки", "Поръчки", "receipt", "Поръчките на живо по статус и канал, смяна на статус, детайл."],
  ["reservations", "Резервации", "Резервации", "calendar-check", "Деня по часове, маси, брой хора, поводи, неявили се, чакащи."],
  ["menu", "Меню", "Меню", "fork-knife", "Ястия, цени в евро, етикети, алергени, „Изчерпано днес“."],
  ["lunch", "Обедно меню", "Обедно", "bowl-food", "Седмичен график пн-пт, ПИН за персонала, публикуване."],
  ["offers", "Оферти и ваучери", "Оферти", "seal-percent", "Оферти с правила по час, ден, канал и ястие; кодове и ваучери."],
  ["events", "Събития", "Събития", "confetti", "Предстоящи и минали събития, ново събитие, преглед в сайта."],
  ["zones", "Зони за доставка", "Зони", "map-trifold", "Кварталите, такси, минимална поръчка, време, часове до 21:00."],
  ["hall", "Залата и масите", "Залата", "chair", "План на Салон и Градина, места, обединяване и блокиране на маси."],
  ["qr", "QR генератор", "QR", "qr-code", "Етикети с QR код за всяка маса, готови за печат."],
  ["customers", "Клиенти", "Клиенти", "users", "Профили, поръчки, съгласия, обратна връзка; данни и изтриване."],
  ["staff", "Персонал", "Персонал", "users-three", "Потребители, роли, пароли и ПИН за персонала."],
  ["roles", "Роли и права", "Роли", "shield-check", "Кой какво вижда: роли по раздели, промените влизат в дневника."],
  ["reports", "Отчети", "Отчети", "chart-bar", "Поръчки, оборот, среден бон, канали, часове, топ ястия."],
  ["finance", "Финанси и гориво", "Финанси", "wallet", "Разходи, гориво по шофьор и автомобил, сравнение на периоди. За собственика."],
  ["audit", "Дневник", "Дневник", "list-bullets", "Кой, кога, какво: вход, роли, меню, обедно, бележки."],
  ["notes", "Бележки (молив)", "Бележки", "pencil-simple", "Бележки и препоръки от молива: одобряване, изпълнение, преглед и публикуване."],
  ["site", "Клиентски сайт", "Сайт", "globe", "Всички модули на живо в рамка на телефон, таблет и компютър."],
  ["settings", "Настройки", "Настройки", "sliders-horizontal", "„Натоварено“ и минутите, задържане на маса, празник, часове."],
  ["waiter", "Сервитьор", "Сервитьор", "bell-ringing", "Приложението на сервитьора."],
  ["kitchen", "Кухня", "Кухня", "chef-hat", "Екранът на кухнята."],
  ["driver", "Шофьор", "Шофьор", "moped", "Приложението на шофьора."],
];
export const SEC: Record<string, Sec> = {};
SEC_LIST.forEach((s) => { SEC[s[0]] = { id: s[0], n: s[1], short: s[2], ic: s[3], desc: s[4], soon: s[0] === "finance" }; });
export const GROUPS: [string, string[]][] = [
  ["Днес", ["dashboard", "orders", "reservations"]],
  ["Меню", ["menu", "lunch"]],
  ["Продажби", ["offers", "events", "zones"]],
  ["Залата", ["hall", "qr"]],
  ["Хора", ["customers", "staff", "roles"]],
  ["Анализ", ["reports", "finance", "audit"]],
  ["Работа по сайта", ["notes", "site", "settings"]],
];
export const APPS = ["waiter", "kitchen", "driver"];
export const groupOf = (id: string): string => { const g = GROUPS.find((x) => x[1].includes(id)); return g ? g[0] : APPS.includes(id) ? "Приложения" : ""; };
/** where a section link goes: "site" is the dashboard with the modules, the staff apps their module */
export function secHref(id: string, hash?: string): string {
  if (id === "site") return aurl.home("modules");
  if (APPS.includes(id)) return aurl.app(id);
  return aurl.section(id, hash);
}

/* ---------- roles (names and descriptions from DEFAULT_ROLES, src/core/staff.ts) ---------- */
export const ROLES: Record<string, { n: string; desc: string }> = {
  admin: { n: "Главен админ", desc: "Всичко; прави директни промени по сайта. Агенцията, която държи и ролята Маркетинг." },
  owner: { n: "Собственик", desc: "Всичко, включително финанси, гориво и отчети." },
  manager: { n: "Управител", desc: "Почти всичко като собственика: меню, цени, промоции, събития, резервации, персонал, отчети." },
  waiter: { n: "Сервитьор", desc: "Повиквания, статус на масите, въвеждане на поръчки, потвърждаване на QR поръчки, сметки." },
  kitchen: { n: "Кухня", desc: "Кухненски екран на своята секция с опашката от поръчки." },
  driver: { n: "Шофьор", desc: "Своите доставки, навигация, статуси, зареждане с гориво, избор на автомобил." },
  marketing: { n: "Маркетинг", desc: "Събития, поводи, оферти, снимки, текстове, SEO полета." },
};
export const roleName = (id: string) => (ROLES[id] ? ROLES[id].n : id);
/** "Поли (Главен админ)"; an account named like its role ("Главен админ") once */
export const nameRole = (name: string, role: string) => (name === roleName(role) ? name : name + " (" + roleName(role) + ")");

/* ---------- modules (the dashboard tiles and the preview; the screens are those of the approved prototype) ---------- */
export interface Mod { id: string; n: string; ic: string; what: string; who: string; dev?: "phone" | "tablet" | "desktop"; sec?: string; roles?: string[]; soon?: boolean; screens: string[] }
export const MODULES: Mod[] = [
  { id: "site", n: "Клиентски сайт", ic: "globe", what: "Сайтът за гостите: меню, поръчка, резервация, събития, оферти.", who: "Гости", dev: "phone", sec: "site",
    screens: ["home", "menu", "category", "dish", "lunch", "cart", "tracking", "office", "reservation", "events", "event", "celebration", "offers", "login", "profile", "delivery", "pickup", "bertha", "about", "gallery", "contacts", "allergens", "404"] },
  { id: "masa", n: "QR маса", ic: "qr-code", what: "Менюто и поръчката от масата, повикване на сервитьор, сметката.", who: "Гости в салона и градината", dev: "phone", sec: "site", screens: ["welcome", "menu", "cart", "call", "bill"] },
  { id: "waiter", n: "Сервитьор", ic: "bell-ringing", what: "Повиквания, масите, нови поръчки, сметки.", who: "Сервитьорите", dev: "phone", sec: "waiter", screens: ["login", "tables", "calls", "table", "table-qr", "order", "ready"] },
  { id: "watch", n: "Часовник", ic: "clock", what: "Повикване и готово ястие на китката на сервитьора.", who: "Сервитьорите", dev: "phone", sec: "waiter", screens: ["watch"] },
  { id: "kitchen", n: "Кухня", ic: "chef-hat", what: "Опашката на всяка секция, изчерпано днес, натоварено.", who: "Готвачите", dev: "tablet", sec: "kitchen", screens: ["login", "queue", "item-out", "busy", "done", "summary"] },
  { id: "driver", n: "Шофьор", ic: "moped", what: "Доставките, маршрут, гориво, край на смяната.", who: "Шофьорите", dev: "phone", sec: "driver", screens: ["login", "list", "delivery", "route", "fuel", "shift"] },
  { id: "manager", n: "Управител", ic: "briefcase", soon: true, what: "Смяната на живо: зала, кухня, доставки, закъснения и известия към управителя.", who: "Управителя", roles: ["owner", "manager"], screens: [] },
  { id: "owner", n: "Собственик", ic: "chart-bar", soon: true, what: "Оборот и отчети, финанси и гориво, сравнение на периоди.", who: "Собственика", roles: ["owner"], screens: [] },
  { id: "admin", n: "Админ", ic: "shield-check", what: "Този панел: разделите, ролите и правата, моливът за бележки.", who: "Агенцията, собственика, управителя", dev: "desktop", roles: ["owner", "manager", "marketing"],
    screens: ["dashboard", "notes", "roles", "login", "menu", "lunch", "zones", "offers", "events", "orders", "reservations", "hall", "qr", "customers", "reports", "staff", "audit", "settings"] },
];


/* The admin addresses that still show "Скоро" (src/admin/soon.ts) in stage C, part 1: every section key of SECTIONS that
   has a screen in the admin prototype, and the live preview. Without a page: "dashboard" (/admin/), "site" (the dashboard
   with the modules), "finance" (a "Скоро" sheet, as in the prototype) and the staff apps (/servitor/, /kuhnya/, /shofyor/).
   The author of a section takes its key out of this list when the section gets its own page. */
export const SOON: [string, string][] = [
  ["orders", "Поръчки"], ["reservations", "Резервации"], ["menu", "Меню"], ["lunch", "Обедно меню"], ["offers", "Оферти и ваучери"],
  ["events", "Събития"], ["zones", "Зони за доставка"], ["hall", "Залата и масите"], ["qr", "QR генератор"], ["customers", "Клиенти"],
  ["staff", "Персонал"], ["reports", "Отчети"],
  ["settings", "Настройки"],
];
