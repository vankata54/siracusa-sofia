/* /admin/offers/: "Оферти и ваучери" (design/pages-admin/offers.html, approved, 1:1; decisions 12.11, 16.11.2026 part 3, 30).
   - On top, always: "Никаква отстъпка срещу отзив в Google." (decision 30); a new offer or a text about Google / a review is
     refused by the core (the screen shows the core's text on the field).
   - Tabs Оферти · Кодове · Запитвания (#t=codes, #t=iq).
   - Оферти: the offers of the site (site:offers) with their rules as chips (days, hours, channel, dishes), "В сайта" on / off,
     "Правила" (a sheet: days, from-to, channel, dishes). -30% after 15:00 is locked and explained (decision 19, only shown);
     -5% early booking cannot be turned on while the days are [ЛИПСВА]; the loyalty card while its rule is [ЛИПСВА].
     "Нова оферта" (title, text, %, rules; starts off); an offer added here can be deleted ("Отмени" in the toast).
     "Празник при нас": the price of the calculator (celebrationPrice) and "Ранна резервация: колко дни" (earlyDays),
     read live by the site (no rebuild).
   - Кодове: check SC10- (the rating) and SCV- (vouchers) with the core's texts; "Нови кодове" (a sum or a %, 1-50, SCV- and
     10 digits, once); the vouchers with "Копирай" and "Използван" (at the till: a voucher is not taken online in v1).
   - Запитвания: voucher and birthday from the site (also from guests without a profile), the contact hidden until
     "Покажи телефона" / "Покажи имейла" (into the log), "Обадихме се", "Готово", "Върни в нови".
   Every change of an offer rebuilds the site (sales-site.ts); the demo says that the site is not rebuilt.
   States: loading, error, no connection, empty (per tab), conflict (409: loaded again), no rights (A.mount). */
import "sc-icons:shield-check,plus,warning-circle,calendar-blank,clock,storefront,fork-knife,pencil-simple,sliders-horizontal,confetti,check,magnifying-glass,ticket,copy,check-circle,envelope-simple,gift,cake,eye,phone,arrow-counter-clockwise,lock,moped,chair,briefcase,bowl-food,user,chat-circle-dots,seal-check,seal-percent,warning,trash,info,arrow-clockwise";
import { api } from "../client/api.ts";
import { adminApi } from "../client/api-admin.ts";
import { offersApi, customersAdminApi, ApiError, type OffersView, type OfferPatch, type OfferRow, type Voucher, type CodeCheck, type FeedbackRow, type FeedbackStatus } from "../client/api-admin-3.ts";
import type { Menu } from "../data/menu.ts";
import { A, mount, toast, sheet, confirm, setBadge, skel, failHTML, empty, missing, banner, esc, ic, fmt, plural } from "./a.ts";
import { ago } from "./when.ts";
import { loadSite, siteLine, rebuildNote, afterWrite, bindRebuild } from "./sales-site.ts";

type Offer = OffersView["offers"][number];
type Rule = OfferRow["r"];
const DAYS: [number, string][] = [[1, "пн"], [2, "вт"], [3, "ср"], [4, "чт"], [5, "пт"], [6, "сб"], [0, "нд"]];
const CH: [Rule["ch"][number], string, string][] = [["delivery", "Доставка", "moped"], ["pickup", "Вземане", "storefront"], ["table", "Маса", "chair"], ["office", "Офис", "briefcase"]];
const ALLD = [1, 2, 3, 4, 5, 6, 0];
const GOOGLE = /google|гугъл|гугл|отзив|ревю|review/i;

const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
const failText = (e: unknown) => (isOffline(e) ? "Няма връзка. Промяната не е записана; опитайте пак, щом връзката се върне." : e instanceof ApiError ? e.message : "Не успяхме. Опитайте пак.");
const mins = (t: string) => { const p = t.split(":"); return +p[0] * 60 + +p[1]; };
const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
function readHash(): Record<string, string> { const o: Record<string, string> = {}; location.hash.slice(1).split("&").forEach((kv) => { const i = kv.indexOf("="); if (i > 0) o[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1)); }); return o; }
function writeHash(o: Record<string, string>) { const h = Object.keys(o).filter((k) => o[k]).map((k) => k + "=" + encodeURIComponent(o[k])).join("&"); try { history.replaceState(history.state, "", location.pathname + location.search + (h ? "#" + h : "")); } catch { /* ignore */ } }

/** "Всеки ден", "пн - пт", "сб, нд" */
export function daysTxt(d: number[]): string {
  if (d.length === 7) return "Всеки ден";
  const n = d.map((x) => x || 7).sort((a, b) => a - b), nm = (x: number) => DAYS.find((z) => z[0] === x % 7)![1];
  const run = n.every((x, i) => !i || x === n[i - 1] + 1);
  return run && n.length > 2 ? nm(n[0]) + " - " + nm(n[n.length - 1]) : n.map(nm).join(", ");
}
const chTxt = (ch: string[]) => (ch.length === 4 ? "Всички канали" : ch.map((c) => (CH.find((z) => z[0] === c) || [c, c])[1]).join(", "));
/** the voucher sum from the text the site sends ("Запитване за ваучер за подарък: 50,00 €. За кого / повод: …") */
export function inquiryOf(q: Pick<FeedbackRow, "topic" | "message">): { title: string; note: string } {
  if (q.topic === "voucher") {
    const m = /ваучер за подарък:\s*([\d\s.,]+\s*€)\.?\s*(?:За кого \/ повод:\s*)?([\s\S]*)$/i.exec(q.message || "");
    return m ? { title: "Ваучер за " + m[1].trim(), note: m[2].trim() } : { title: "Ваучер за подарък", note: q.message || "" };
  }
  return { title: "Подарък за рожден ден", note: q.message || "" };
}

export async function initOffers(): Promise<void> {
  const body = await mount({ section: "offers", title: "Оферти и ваучери", docTitle: "Оферти и ваучери",
    sub: "Офертите в сайта с правилата им (час, ден, канал, ястия), кодовете за отстъпка и запитванията за ваучер и рожден ден.",
    actions: '<button class="pill pill-red pill-lg" type="button" data-newoffer>' + ic("plus", 22) + "Нова оферта</button>" });
  if (!body) return;
  const root = body;
  root.innerHTML = skel(5, "Зареждаме офертите …");

  let V: OffersView | null = null, err: unknown = null, net = true;
  let C: Voucher[] = [], Q: FeedbackRow[] = [], qErr: unknown = null, cErr: unknown = null, M: Menu | null = null;
  let tab = ["offers", "codes", "iq"].includes(readHash().t) ? readHash().t : "offers";
  const check: { v: string; res: CodeCheck | null; err: string } = { v: "", res: null, err: "" };
  const shown: Record<string, string> = {}; /* inquiry id -> the whole contact, after "Покажи" */

  async function load() {
    try {
      const r = await Promise.all([offersApi.list(), offersApi.vouchers().catch((e) => { cErr = e; return [] as Voucher[]; }), customersAdminApi.messages("inquiries").catch((e) => { qErr = e; return { rows: [] as FeedbackRow[], newN: 0 }; }), loadSite()]);
      V = r[0]; C = r[1]; Q = r[2].rows; err = null; net = true;
    } catch (e) { err = e; }
    draw();
    api.menu().then((m) => { M = m; }, () => { /* the rules sheet then offers only "Всички" / "Обедното меню" */ });
  }

  /* ---------- dishes of a rule ---------- */
  function catsOf(): { id: string; n: string; ids: string[] }[] {
    if (!M) return [];
    return M.cats.filter((c) => c.id !== "dobavki").map((c) => ({ id: c.id, n: c.n, ids: M!.items.filter((x) => x.cat === c.id).map((x) => x.id) })).filter((c) => c.ids.length);
  }
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");
  function dishTxt(d: Rule["dish"]) {
    if (d === "lunch") return "Обедно меню"; if (d === "all") return "Всички ястия";
    const c = catsOf().find((x) => same(x.ids, d)); return c ? c.n : plural(d.length, "ястие", "ястия");
  }

  /* ---------- parts ---------- */
  const blocked = (o: Offer) => (o.needs === "earlyDays" && o.blocked ? "Ранна резервация: " + missing("колко дни") : o.needs === "loyalty" ? "Печат и награда: " + missing("правило") : "");
  const numHTML = (o: Offer) => (o.kind === "pct" ? "<b>-" + o.pct + "%</b>" : o.pct ? "<b>-" + o.pct + "%</b><small>или торта</small>" : ic(o.ic, 36));
  const textHTML = (t: string) => esc(t).replace(/\[ЛИПСВА: ([^\]]+)\]/g, (_m, x) => missing(x));
  function offerHTML(o: Offer) {
    const b = blocked(o), on = o.on && !o.blocked;
    return '<article class="of' + (on ? "" : " off") + '" data-id="' + esc(o.id) + '" data-edit-id="admin.offers.offer"><div class="of-num" aria-hidden="true">' + numHTML(o) + "</div>" +
      '<div class="of-h"><h3>' + esc(o.title) + "</h3><p>" + esc(o.sub) + "</p></div>" +
      '<p style="grid-column:1 / -1; margin:0">' + textHTML(o.text) + "</p>" +
      '<div class="of-rules" aria-label="Правила">' + (b ? '<span class="warn">' + ic("warning-circle", 16) + b + "</span>" : "") + (o.lock ? '<span class="warn lockr">' + ic("lock", 16) + "Заключено: правило на ресторанта</span>" : "") +
        "<span>" + ic("calendar-blank", 16) + daysTxt(o.r.days) + "</span><span>" + ic("clock", 16) + o.r.from + " - " + o.r.to + "</span>" +
        "<span>" + ic("storefront", 16) + chTxt(o.r.ch) + "</span><span>" + ic("fork-knife", 16) + esc(dishTxt(o.r.dish)) + "</span>" +
        (o.custom ? "<span>" + ic("pencil-simple", 16) + "Добавена от вас</span>" : "") + "</div>" +
      '<div class="of-f"><label class="of-sw">В сайта<span class="sa-switch"><input type="checkbox" role="switch" data-on aria-label="В сайта: ' + esc(o.title) + '"' + (on ? " checked" : "") + (o.blocked || o.lock ? " disabled" : "") + '><span class="tr"></span></span></label><span class="sp"></span>' +
        (o.custom ? '<button class="pill pill-line del" type="button" data-del aria-label="Изтрий: ' + esc(o.title) + '">' + ic("trash", 20) + "Изтрий</button>" : "") +
        '<button class="pill pill-line" type="button" data-rules aria-label="Правила: ' + esc(o.title) + '">' + ic(o.lock ? "lock" : "sliders-horizontal", 20) + "Правила</button></div></article>";
  }
  const policy = () => '<div class="of-policy" data-edit-id="admin.offers.policy">' + ic("shield-check", 26) + "<div><b>Никаква отстъпка срещу отзив в Google.</b><p>Отстъпката -10% е само за вътрешната оценка, еднаква при „Да“ и при „Не“. Линкът за отзив в Google се показва и при двата отговора и не е свързан с код. Такава оферта не може да се добави.</p></div></div>";
  function celebration() {
    const s = V!.settings, cp = s.celebrationPrice || "offer", ed = s.earlyDays;
    return '<section class="of-set" aria-labelledby="h-cel" data-edit-id="admin.offers.celebration"><h3 id="h-cel">' + ic("confetti", 22) + 'Празник при нас</h3><div class="grid">' +
      '<div class="grp" style="display:grid; gap:8px"><span class="label">Цена в калкулатора на празник</span><div class="seg" role="group" aria-label="Цена в калкулатора"><button type="button" data-cp="estimate" aria-pressed="' + (cp === "estimate") + '">Ориентировъчна цена</button><button type="button" data-cp="offer" aria-pressed="' + (cp === "offer") + '">Само оферта</button></div>' +
        '<span class="help of-help">' + (cp === "estimate" ? "Клиентът вижда ориентировъчна сума, преди да изпрати запитването." : "Клиентът изпраща запитване; управителят се обажда с оферта.") + " Логиката на цените: " + missing("торти, украса, пакети") + ".</span></div>" +
      '<div class="field"><label for="of-ed">Ранна резервация: колко дни по-рано</label><div class="of-days"><input class="input" id="of-ed" inputmode="numeric" maxlength="3" autocomplete="off" value="' + (ed == null ? "" : ed) + '" placeholder="дни" aria-describedby="of-ed-h of-ed-e"><button class="pill pill-line" type="button" data-saveed>' + ic("check", 20) + "Запази</button></div>" +
        '<span class="help" id="of-ed-h">' + (ed == null ? "Сега: " + missing("колко дни") + ". Без него -5% не се показва никъде." : "Сега: -5% при резервация поне " + plural(ed, "ден", "дни") + " по-рано.") + '</span><span class="err" id="of-ed-e" hidden></span></div></div>' +
      '<p class="of-live">' + ic("info", 18) + "<span>Тези две настройки сайтът чете веднага, без пресглобяване.</span></p></section>";
  }
  function tabsHTML() {
    const nNew = Q.filter((q) => q.status === "new").length;
    return '<div class="of-tabs" data-edit-id="admin.offers.tabs"><div class="sa-tabs" role="tablist" aria-label="Оферти и ваучери">' +
      ([["offers", "Оферти", V!.offers.length], ["codes", "Кодове", C.length], ["iq", "Запитвания", nNew]] as [string, string, number][]).map((t) => '<button type="button" role="tab" id="tb-' + t[0] + '" aria-controls="tp" aria-selected="' + (tab === t[0]) + '" data-tab="' + t[0] + '">' + t[1] + '<span class="c">' + t[2] + "</span></button>").join("") + "</div></div>";
  }
  function offersTab() {
    const O = V!.offers;
    if (!O.length) return '<div class="sa-card">' + empty({ icon: "seal-percent", title: "Още няма оферти.", text: "Добавете първата: правила по час, ден, канал и ястия. Включва се в сайта, когато решите.", action: '<button class="pill pill-red pill-lg" type="button" data-newoffer>' + ic("plus", 22) + "Нова оферта</button>" }) + "</div>" + celebration();
    const on = O.filter((o) => o.on && !o.blocked), off = O.filter((o) => !(o.on && !o.blocked));
    return '<div class="sa-sh" style="margin-top:8px"><h2>В сайта · ' + on.length + '</h2><p class="of-sh-p">Гръцката вечер е в „Събития“.</p></div><div class="of-list">' + on.map(offerHTML).join("") + "</div>" +
      (off.length ? '<div class="sa-sh"><h2>Изключени · ' + off.length + "</h2><p>Не се виждат в сайта.</p></div>" + '<div class="of-list">' + off.map(offerHTML).join("") + "</div>" : "") + celebration();
  }
  function codeRes() {
    if (check.err) return banner({ tone: "danger", icon: "warning", title: "Не успяхме да проверим кода.", text: esc(check.err) });
    const r = check.res; if (!r) return "";
    if (r.status === "unknown") return banner({ tone: "danger", icon: "warning", title: "Няма такъв код.", text: esc(r.message.replace(/^Няма такъв код\.\s*/, "") || "Проверете цифрите, например SC10-4829163057.") });
    if (r.status === "used") return banner({ tone: "warn", icon: "warning-circle", title: "Този код вече е използван.", text: esc(r.code + (r.usedBy ? ": " + r.usedBy : "") + ".") });
    const what = r.sum != null ? fmt(r.sum) + " ваучер" : "-" + r.pct + "% на ястията";
    return banner({ tone: "ok", icon: "check-circle", title: "Валиден код · " + what, text: esc(r.code + (r.kind === "rating" ? ": от оценката. Още не е използван. Не се комбинира с -30% на обедното." : ": ваучер. Още не е използван. Отбелязва се „Използван“ на касата.")) +
      (r.kind === "voucher" ? '<div style="margin-top:8px"><button class="pill pill-ink" type="button" data-use="' + esc(r.code) + '">' + ic("check", 18) + "Използван</button></div>" : "") });
  }
  function codesTab() {
    return '<div class="of-cols"><section class="of-box" aria-labelledby="h-chk" data-edit-id="admin.offers.check"><h3 id="h-chk">' + ic("magnifying-glass", 22) + 'Проверка на код</h3><p class="muted">Кодът от оценката е SC10- и 10 цифри, ваучерът е SCV- и 10 цифри. Еднократни са; кодът от оценката се отбелязва като използван от поръчката.</p>' +
        '<form class="of-chk" data-chk novalidate><label class="vh" for="of-code">Код</label><input class="input" id="of-code" autocomplete="off" spellcheck="false" placeholder="SC10-4829163057" value="' + esc(check.v) + '"><button class="pill pill-ink" type="submit">' + ic("check", 20) + 'Провери</button></form><div class="of-res" data-res aria-live="polite">' + codeRes() + "</div></section>" +
      '<section class="of-box" aria-labelledby="h-gen" data-edit-id="admin.offers.generate"><h3 id="h-gen">' + ic("ticket", 22) + 'Генерирай кодове</h3><p class="muted">За ваучери за подарък и промоции. Всеки код е еднократен. Онлайн количката не приема ваучери: отбелязват се на касата.</p><div><button class="pill pill-red pill-lg" type="button" data-gen>' + ic("plus", 22) + "Нови кодове</button></div></section></div>" +
      '<div class="sa-sh"><h2>Ваучерите</h2><p>Кодовете от оценките не са в списъка: проверете ги горе.</p></div>' +
      (cErr && !C.length ? failHTML(cErr, "Ваучерите не се заредиха. Опитайте пак.")
        : C.length ? '<div class="sa-tablewrap scroll of-codes" data-edit-id="admin.offers.codes"><table class="sa-table"><thead><tr><th>Код</th><th>Стойност</th><th>За какво</th><th>Създаден</th><th>Състояние</th><th><span class="vh">Действия</span></th></tr></thead><tbody>' +
          C.map((c) => '<tr><td data-main><span class="mono">' + esc(c.code) + '</span></td><td data-label="Стойност">' + (c.sum != null ? fmt(c.sum) : "-" + c.pct + "%") + '</td><td data-label="За какво">' + esc(c.note || "Ваучер") + '</td><td data-label="Създаден">' + esc(ago(c.createdAt)) + "</td>" +
            '<td data-label="Състояние">' + (c.usedBy ? '<span class="of-st used">' + ic("check", 18) + "Използван" + (c.usedAt ? ", " + esc(ago(c.usedAt)) : "") + "</span>" : '<span class="of-st ok">' + ic("check-circle", 18) + "Неизползван</span>") + "</td>" +
            '<td data-label="Действия"><span class="of-acts"><button class="pill pill-line" type="button" data-copy="' + esc(c.code) + '" aria-label="Копирай ' + esc(c.code) + '">' + ic("copy", 18) + "Копирай</button>" +
              (c.usedBy ? "" : '<button class="pill pill-line" type="button" data-use="' + esc(c.code) + '" aria-label="Използван: ' + esc(c.code) + '">' + ic("check", 18) + "Използван</button>") + "</span></td></tr>").join("") + "</tbody></table></div>"
          : '<div class="sa-card">' + empty({ icon: "ticket", title: "Още няма ваучери.", text: "Ваучерите за подарък и промоциите се генерират с „Нови кодове“. Кодовете от оценките се проверяват горе." }) + "</div>");
  }
  function iqTab() {
    if (qErr && !Q.length) return failHTML(qErr, "Запитванията не се заредиха. Опитайте пак.");
    const o: Record<string, number> = { new: 0, called: 1, done: 2 };
    const list = Q.slice().sort((a, b) => (o[a.status] - o[b.status]) || (b.createdAt < a.createdAt ? -1 : 1));
    if (!list.length) return '<div class="sa-card">' + empty({ icon: "envelope-simple", title: "Няма нови запитвания.", text: "Запитванията за ваучер и за рожден ден от сайта идват тук (от гости и без профил)." }) + "</div>";
    return '<div class="of-iq">' + list.map((q) => {
      const v = q.topic === "voucher", x = inquiryOf(q), mail = q.mode === "email", full = shown[q.id];
      const href = full ? (mail ? "mailto:" + full : "tel:" + full.replace(/[^\d+]/g, "")) : "";
      return '<article class="iq' + (q.status === "done" ? " done" : "") + '" data-q="' + esc(q.id) + '" data-edit-id="admin.offers.inquiry"><div class="iq-t"><span class="sa-tag ' + (q.status === "new" ? "st-new" : q.status === "called" ? "st-call" : "ok") + '">' + (q.status === "new" ? "Ново" : q.status === "called" ? "Обадихме се" : ic("check", 16) + "Готово") + '</span><span class="sa-tag">' + ic(v ? "gift" : "cake", 16) + (v ? "Ваучер" : "Рожден ден") + '</span><span class="when">' + esc(ago(q.createdAt)) + "</span></div>" +
        "<h3>" + esc(x.title) + "</h3>" +
        '<div class="who"><span>' + esc(q.name) + '</span><span class="tel" data-tel>' + (full ? '<a class="link" href="' + esc(href) + '">' + esc(full) + "</a>" : esc(q.contact)) + "</span>" +
          (full ? '<a class="pill pill-ink" href="' + esc(href) + '">' + ic(mail ? "envelope-simple" : "phone", 18) + (mail ? "Пиши" : "Обади се") + "</a>" : '<button class="pill pill-line" type="button" data-show>' + ic("eye", 18) + (mail ? "Покажи имейла" : "Покажи телефона") + "</button>") + "</div>" +
        (x.note ? "<blockquote>" + esc(x.note) + "</blockquote>" : "") +
        '<div class="iq-f">' + (q.status === "new" ? '<button class="pill pill-ink" type="button" data-qs="called">' + ic("phone", 20) + "Обадихме се</button>" : "") + (q.status !== "done" ? '<button class="pill pill-line" type="button" data-qs="done">' + ic("check", 20) + "Готово</button>" : '<button class="pill pill-line" type="button" data-qs="new">' + ic("arrow-counter-clockwise", 20) + "Върни в нови</button>") + "</div></article>";
    }).join("") + "</div>";
  }

  function draw(keep = false) {
    if (!V) { root.innerHTML = err ? failHTML(err, "Не успяхме да заредим офертите. Сайтът показва последно запазените.") : skel(5, "Зареждаме офертите …"); return; }
    const sc = A.scroller, y = sc ? sc.scrollTop : 0;
    root.innerHTML = (!net ? failHTML(new ApiError("offline", ""), "Показваме последно заредените оферти. Промените не се записват без връзка; опитайте пак, щом връзката се върне.") + '<div style="height:16px"></div>' : "") +
      policy() + siteLine("offers", repaintLine) + tabsHTML() + '<div id="tp" role="tabpanel" aria-labelledby="tb-' + tab + '">' + (tab === "offers" ? offersTab() : tab === "codes" ? codesTab() : iqTab()) + "</div>";
    setBadge("offers", Q.filter((q) => q.status === "new").length);
    if (keep && sc) sc.scrollTop = y;
  }
  function repaintLine() { const el = root.querySelector("[data-site-line]"); if (el) el.outerHTML = siteLine("offers"); }

  /* ---------- writes ---------- */
  async function run<T>(fn: () => Promise<T>): Promise<T | null> {
    try { const r = await fn(); net = true; return r; }
    catch (e) {
      if (e instanceof ApiError && e.code === "conflict") { toast(e.message); V = null; draw(); await load(); return null; }
      if (isOffline(e)) net = false;
      draw(true); toast(failText(e)); return null;
    }
  }
  async function toggle(id: string, on: boolean, undo = true) {
    const o = V!.offers.find((x) => x.id === id)!, r = await run(() => offersApi.toggle(id, on, undefined));
    if (!r) return; V = r; draw(true); afterWrite();
    const nt = root.querySelector<HTMLElement>('[data-id="' + id + '"] [data-on]'); if (nt) nt.focus({ preventScroll: true });
    const txt = (on ? "Включена в сайта: " : "Изключена от сайта: ") + o.title;
    toast(txt + "." + rebuildNote(), undo ? { undo: () => { void toggle(id, !on, false); } } : {});
  }
  async function setS(p: { celebrationPrice?: "estimate" | "offer"; earlyDays?: number | null }, txt: string, back: typeof p | null) {
    const r = await run(() => adminApi.setSettings(p)); if (!r) return;
    V!.settings = { ...V!.settings, ...p };
    const ov = await offersApi.list().catch(() => null); if (ov) V = ov;
    draw(true);
    toast(txt + ". Сайтът го показва веднага.", back ? { undo: () => { void setS(back, "Отменено: " + txt, null); } } : {});
  }

  root.addEventListener("click", async (e) => {
    const tg = e.target as Element; let t: HTMLElement | null;
    if (tg.closest('[data-sa="retry"]')) { e.stopPropagation(); V = null; err = null; qErr = null; cErr = null; draw(); void load(); return; }
    if ((t = tg.closest<HTMLElement>("[data-tab]"))) { tab = t.dataset.tab!; writeHash(tab !== "offers" ? { t: tab } : {}); draw(); const nt = root.querySelector<HTMLElement>('[data-tab="' + tab + '"]'); if (nt) nt.focus({ preventScroll: true }); return; }
    if ((t = tg.closest<HTMLElement>("[data-rules]"))) { offerSheet(t.closest<HTMLElement>("[data-id]")!.dataset.id!); return; }
    if ((t = tg.closest<HTMLElement>("[data-del]"))) { delOffer(t.closest<HTMLElement>("[data-id]")!.dataset.id!); return; }
    if ((t = tg.closest<HTMLElement>("[data-cp]"))) {
      const v = t.dataset.cp as "estimate" | "offer", old = V!.settings.celebrationPrice || "offer"; if (v === old) return;
      void setS({ celebrationPrice: v }, "Цена в калкулатора на празник: " + (v === "estimate" ? "ориентировъчна" : "само оферта"), { celebrationPrice: old }); return;
    }
    if (tg.closest("[data-saveed]")) { saveEarly(); return; }
    if ((t = tg.closest<HTMLElement>("[data-copy]"))) { const code = t.dataset.copy!; try { void navigator.clipboard.writeText(code).catch(() => { /* ignore */ }); } catch { /* ignore */ } toast("Копирано: " + code); return; }
    if ((t = tg.closest<HTMLElement>("[data-use]"))) { useVoucher(t.dataset.use!); return; }
    if (tg.closest("[data-gen]")) { genSheet(); return; }
    if ((t = tg.closest<HTMLElement>("[data-show]"))) {
      const id = t.closest<HTMLElement>("[data-q]")!.dataset.q!; t.setAttribute("disabled", "");
      const r = await run(() => customersAdminApi.messageContact(id)); if (!r) return;
      shown[id] = r.contact; draw(true); const a = root.querySelector<HTMLElement>('[data-q="' + id + '"] .who .pill'); if (a) a.focus({ preventScroll: true }); return;
    }
    if ((t = tg.closest<HTMLElement>("[data-qs]"))) {
      const id = t.closest<HTMLElement>("[data-q]")!.dataset.q!, q = Q.find((z) => z.id === id)!, was = q.status, st = t.dataset.qs as FeedbackStatus;
      const setQ = async (to: FeedbackStatus, txt: string, back: FeedbackStatus | null) => {
        const r = await run(() => customersAdminApi.messageStatus(id, to)); if (!r) return;
        Q = Q.map((z) => (z.id === id ? { ...z, status: r.status } : z)); draw(true);
        toast(txt, back ? { undo: () => { void setQ(back, "Отменено: " + txt, null); } } : {});
      };
      const lab = { called: "Обадихме се", done: "Готово", new: "Върнато в нови" }[st];
      void setQ(st, lab + ": " + (q.topic === "voucher" ? "ваучер, " : "рожден ден, ") + q.name, was); return;
    }
  }, true);
  document.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-newoffer]")) offerSheet(null); });
  root.addEventListener("change", (e) => { const t = e.target as HTMLInputElement; if (!t.matches("[data-on]")) return; void toggle(t.closest<HTMLElement>("[data-id]")!.dataset.id!, t.checked); });
  root.addEventListener("submit", async (e) => {
    if (!(e.target as Element).matches("[data-chk]")) return; e.preventDefault();
    const inp = root.querySelector<HTMLInputElement>("#of-code")!, raw = inp.value.trim(); check.v = raw; check.err = "";
    if (!raw) { check.res = { code: "", kind: null, status: "unknown", pct: null, sum: null, message: "Напишете кода, например SC10-4829163057.", usedBy: null }; }
    else {
      try { check.res = await offersApi.checkCode(raw); }
      catch (x) { check.res = null; check.err = failText(x); }
    }
    root.querySelector("[data-res]")!.innerHTML = codeRes();
  });
  bindRebuild(root);

  function saveEarly() {
    const i = root.querySelector<HTMLInputElement>("#of-ed")!, er = root.querySelector<HTMLElement>("#of-ed-e")!, v = i.value.trim(), old = V!.settings.earlyDays;
    if (v && (!/^\d{1,3}$/.test(v) || +v < 1 || +v > 365)) { i.setAttribute("aria-invalid", "true"); er.hidden = false; er.textContent = "Дните са цяло число от 1 до 365 (или празно)."; i.focus(); return; }
    const nv = v ? +v : null; if (nv === old) { toast("Нищо не е променено."); return; }
    void setS({ earlyDays: nv }, nv == null ? "Ранна резервация: без дни (-5% не се показва)" : "Ранна резервация: поне " + plural(nv, "ден", "дни") + " по-рано", { earlyDays: old });
  }
  function delOffer(id: string) {
    const o = V!.offers.find((x) => x.id === id)!;
    confirm({ title: "Да изтрием ли „" + o.title + "“?", text: esc((o.on ? "Офертата изчезва от сайта. " : "") + "Може да я върнете с „Отмени“ веднага след това."), ok: "Изтрий", danger: true, icon: "trash" }, async () => {
      const r = await run(() => offersApi.remove(id)); if (!r) return;
      const row = r.removed; V = r; draw(true); afterWrite();
      toast("Изтрита оферта: " + o.title + "." + rebuildNote(), { undo: async () => { const b = await run(() => offersApi.restore(row)); if (b) { V = b; draw(true); afterWrite(); toast("Офертата е върната: " + o.title); } } });
    });
  }
  async function useVoucher(code: string) {
    const r = await run(() => offersApi.useVoucher(code, undefined)); if (!r) return;
    C = C.map((c) => (c.code === r.code ? r : c)); if (check.res && check.res.code === r.code) check.res = { ...check.res, status: "used", usedBy: r.usedBy, message: "Този код вече е използван." };
    draw(true); toast("Отбелязан като използван: " + code);
  }

  /* ---------- sheets ---------- */
  function times() { const o: string[] = []; for (let m = 600; m <= 1380; m += 30) o.push(hhmm(m)); return o; }
  function offerSheet(id: string | null) {
    if (!V) return;
    const o: Offer = id ? V.offers.find((x) => x.id === id)! : { id: "", kind: "pct", pct: 10, ic: "seal-percent", title: "", sub: "", text: "", on: false, custom: true, blocked: null, r: { days: ALLD.slice(), from: "10:00", to: "22:30", ch: ["delivery", "pickup"], dish: "all" } };
    const T = times(), cats = catsOf();
    const dishVal = o.r.dish === "all" || o.r.dish === "lunch" ? o.r.dish : (cats.find((c) => same(c.ids, o.r.dish as string[])) || { id: "own" }).id;
    const dishOpts: [string, string][] = [["all", "Всички ястия"], ["lunch", "Обедно меню"], ...cats.map((c) => [c.id, c.n] as [string, string])];
    if (dishVal === "own") dishOpts.push(["own", dishTxt(o.r.dish) + " (избрани)"]);
    const editPct = !id || o.custom;
    let html = '<form class="of-form" novalidate data-edit-id="admin.offers.sheet">' +
      (id ? "" : '<div class="field"><label for="ofs-t">Заглавие</label><input class="input" id="ofs-t" autocomplete="off" maxlength="60" placeholder="Например: Пица на обяд" aria-describedby="ofs-t-e"><span class="err" id="ofs-t-e" hidden></span></div>' +
        '<div class="field"><label for="ofs-x">Текст за сайта</label><textarea class="input" id="ofs-x" rows="2" maxlength="300" placeholder="Едно изречение: какво получава клиентът" aria-describedby="ofs-x-e"></textarea><span class="err" id="ofs-x-e" hidden></span></div>') +
      (o.kind === "pct" ? '<div class="field"><label for="ofs-p">Отстъпка</label><div class="of-pct" style="max-width:160px"><input class="input" id="ofs-p" inputmode="numeric" maxlength="2" value="' + (o.pct ?? "") + '" aria-describedby="ofs-p-e"' + (editPct ? "" : " disabled") + '><span class="u" aria-hidden="true">%</span></div><span class="err" id="ofs-p-e" hidden></span>' + (!editPct ? '<span class="help">Процентът е правило на ресторанта и не се сменя оттук.</span>' : "") + "</div>" : "") +
      '<div class="grp"><span class="label" id="ofs-dl">Дни</span><div class="of-cx" role="group" aria-labelledby="ofs-dl">' + DAYS.map((d) => '<button class="chip" type="button" data-d="' + d[0] + '" aria-pressed="' + o.r.days.includes(d[0]) + '">' + d[1] + "</button>").join("") + '</div><span class="err" id="ofs-d-e" hidden></span></div>' +
      '<div class="two"><div class="field"><label for="ofs-from">От</label><select class="input" id="ofs-from">' + T.map((t) => "<option" + (t === o.r.from ? " selected" : "") + ">" + t + "</option>").join("") + "</select></div>" +
        '<div class="field"><label for="ofs-to">До</label><select class="input" id="ofs-to" aria-describedby="ofs-to-e">' + [...new Set(T.concat(["22:30", o.r.to]))].sort().map((t) => "<option" + (t === o.r.to ? " selected" : "") + ">" + t + "</option>").join("") + '</select><span class="err" id="ofs-to-e" hidden></span></div></div>' +
      '<div class="grp"><span class="label" id="ofs-cl">Канал</span><div class="of-cx" role="group" aria-labelledby="ofs-cl">' + CH.map((c) => '<button class="chip" type="button" data-c="' + c[0] + '" aria-pressed="' + o.r.ch.includes(c[0]) + '">' + ic(c[2], 18) + c[1] + "</button>").join("") + '</div><span class="err" id="ofs-c-e" hidden></span></div>' +
      '<div class="field"><label for="ofs-dish">Ястия</label><select class="input" id="ofs-dish" aria-describedby="ofs-dish-h ofs-dish-e">' + dishOpts.map((d) => '<option value="' + esc(d[0]) + '"' + (d[0] === dishVal ? " selected" : "") + ">" + esc(d[1]) + "</option>").join("") + '</select><span class="help" id="ofs-dish-h">Правило за ястие: поне едно от тях в поръчката.</span><span class="err" id="ofs-dish-e" hidden></span></div>' +
      '<p class="muted" style="margin:0; font-size:15px">Отстъпките не се комбинират: важи по-изгодната за клиента. Правилото спира отстъпката извън дните, часовете и каналите, не я преизчислява. ' + (id ? "" : "Новата оферта е изключена, докато не я включите.") + "</p></form>";
    if (o.lock) html = '<p class="of-lock">' + ic("lock", 20) + "<span>Правило на ресторанта: след 15:00 обедното меню е само за вземане, с -30%. Тук само се вижда и не се сменя.</span></p>" + html.replace(/<(input|select|button|textarea)(?=[ >])/g, "<$1 disabled");
    const s = sheet({ title: id ? "Правила: " + o.title : "Нова оферта", html, focus: id ? "[data-close]" : "#ofs-t",
      foot: o.lock ? '<button class="pill pill-ink pill-lg" type="button" data-x>Затвори</button>' : '<button class="pill pill-line pill-lg" type="button" data-x>Откажи</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("check", 22) + (id ? "Запази правилата" : "Добави офертата") + "</button>" });
    const f = s.body;
    f.addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLButtonElement>("[data-d],[data-c]"); if (b && !b.disabled) b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); });
    function er(sel: string, m: string, inp?: HTMLElement | null) { const el = f.querySelector<HTMLElement>(sel); if (el) { el.hidden = !m; el.textContent = m || ""; } if (inp) { if (m) inp.setAttribute("aria-invalid", "true"); else inp.removeAttribute("aria-invalid"); } return !m; }
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    if (o.lock) return;
    const okB = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    okB.onclick = async () => {
      const days = Array.from(f.querySelectorAll<HTMLElement>("[data-d][aria-pressed=true]")).map((b) => +b.dataset.d!);
      const ch = Array.from(f.querySelectorAll<HTMLElement>("[data-c][aria-pressed=true]")).map((b) => b.dataset.c as Rule["ch"][number]);
      const from = f.querySelector<HTMLSelectElement>("#ofs-from")!.value, to = f.querySelector<HTMLSelectElement>("#ofs-to")!.value;
      const pI = f.querySelector<HTMLInputElement>("#ofs-p"), tI = f.querySelector<HTMLInputElement>("#ofs-t"), xI = f.querySelector<HTMLTextAreaElement>("#ofs-x");
      const title = tI ? tI.value.trim() : o.title, text = xI ? xI.value.trim() : o.text;
      const dv = f.querySelector<HTMLSelectElement>("#ofs-dish")!.value;
      const dish: Rule["dish"] = dv === "all" || dv === "lunch" ? dv : dv === "own" ? o.r.dish : (cats.find((c) => c.id === dv) || { ids: [] as string[] }).ids;
      const ok = [tI ? er("#ofs-t-e", title.length < 3 ? "Напишете заглавие." : GOOGLE.test(title + " " + text) ? "Отстъпка срещу отзив в Google не се дава (правила на Google)." : "", tI) : true,
        pI && !pI.disabled ? er("#ofs-p-e", !/^\d{1,2}$/.test(pI.value) || +pI.value < 1 || +pI.value > 50 ? "Отстъпката е от 1 до 50%." : "", pI) : true,
        er("#ofs-d-e", days.length ? "" : "Изберете поне един ден."), er("#ofs-to-e", mins(to) > mins(from) ? "" : "Краят е след началото.", f.querySelector<HTMLElement>("#ofs-to")), er("#ofs-c-e", ch.length ? "" : "Изберете поне един канал.")];
      if (ok.includes(false)) { const first = f.querySelector<HTMLElement>("[aria-invalid=true]") || f.querySelector<HTMLElement>(".err:not([hidden])"); if (first) { first.scrollIntoView({ block: "center" }); first.focus(); } return; }
      const r: Rule = { days, from, to, ch, dish };
      okB.disabled = true;
      try {
        if (id) {
          const p: OfferPatch = { r }; if (pI && !pI.disabled) p.pct = +pI.value;
          const prev: OfferPatch = { r: o.r, ...(p.pct != null ? { pct: o.pct ?? undefined } : {}) };
          V = await offersApi.save(id, p, V!.version); net = true;
          s.close(); draw(true); afterWrite();
          const txt = "Правила: " + o.title + " · " + daysTxt(days) + ", " + from + " - " + to;
          toast(txt + "." + rebuildNote(), { undo: async () => { const b = await run(() => offersApi.save(id, prev, undefined)); if (b) { V = b; draw(true); afterWrite(); toast("Отменено: " + txt); } } });
        } else {
          const res = await offersApi.create({ title, text, pct: +pI!.value, r }); V = res; net = true;
          s.close(); draw(true); afterWrite();
          const txt = "Нова оферта: " + title + " · " + daysTxt(days) + ", " + from + " - " + to + ". Изключена е, докато не я включите.";
          toast(txt, { undo: async () => { const b = await run(() => offersApi.remove(res.id)); if (b) { V = b; draw(true); afterWrite(); toast("Офертата е махната: " + title); } } });
        }
      } catch (e) {
        okB.disabled = false;
        if (e instanceof ApiError && e.fields) {
          const map: Record<string, [string, HTMLElement | null]> = { title: ["#ofs-t-e", tI], text: ["#ofs-x-e", xI], pct: ["#ofs-p-e", pI], "r.days": ["#ofs-d-e", null], "r.from": ["#ofs-to-e", f.querySelector<HTMLElement>("#ofs-to")], "r.ch": ["#ofs-c-e", null], "r.dish": ["#ofs-dish-e", f.querySelector<HTMLElement>("#ofs-dish")] };
          let first: HTMLElement | null = null;
          Object.keys(e.fields).forEach((k) => { const m = map[k]; if (m) { er(m[0], e.fields![k], m[1]); if (!first) first = m[1] || f.querySelector<HTMLElement>(m[0]); } });
          if (!tI && e.fields.title) toast(e.fields.title);
          if (first) { (first as HTMLElement).focus(); return; }
        }
        if (e instanceof ApiError && e.code === "conflict") { s.close(); toast(e.message); V = null; draw(); await load(); return; }
        if (isOffline(e)) { net = false; draw(true); }
        toast(failText(e));
      }
    };
  }
  function genSheet() {
    const s = sheet({ title: "Нови кодове", focus: "#og-v", html: '<form class="of-form" novalidate>' +
        '<div class="field"><label for="og-k">Вид</label><select class="input" id="og-k"><option value="sum">Ваучер за подарък (сума)</option><option value="pct">Отстъпка в %</option></select></div>' +
        '<div class="two"><div class="field"><label for="og-v">Стойност</label><div class="of-pct"><input class="input" id="og-v" inputmode="decimal" autocomplete="off" placeholder="50" aria-describedby="og-v-e"><span class="u" data-u aria-hidden="true">€</span></div><span class="err" id="og-v-e" hidden></span></div>' +
          '<div class="field"><label for="og-n">Брой кодове</label><input class="input" id="og-n" inputmode="numeric" value="1" maxlength="2" aria-describedby="og-n-e"><span class="err" id="og-n-e" hidden></span></div></div>' +
        '<div class="field"><label for="og-note">За кого или по какъв повод <span class="muted" style="font-weight:600">(по желание)</span></label><input class="input" id="og-note" autocomplete="off" maxlength="120"></div>' +
        '<p class="muted" style="margin:0; font-size:15px">Валидност: ' + missing("от собственика") + '. Кодът е SCV- и 10 цифри, еднократен. Онлайн количката не го приема: отбелязва се „Използван“ на касата.</p><div data-out></div></form>',
      foot: '<button class="pill pill-line pill-lg" type="button" data-x>Затвори</button><button class="pill pill-red pill-lg" type="button" data-ok>' + ic("ticket", 22) + "Генерирай</button>" });
    const f = s.body;
    f.querySelector<HTMLSelectElement>("#og-k")!.addEventListener("change", function () { f.querySelector("[data-u]")!.textContent = this.value === "sum" ? "€" : "%"; });
    s.foot!.querySelector<HTMLButtonElement>("[data-x]")!.onclick = s.close;
    const okB = s.foot!.querySelector<HTMLButtonElement>("[data-ok]")!;
    okB.onclick = async () => {
      const k = f.querySelector<HTMLSelectElement>("#og-k")!.value as "sum" | "pct", vI = f.querySelector<HTMLInputElement>("#og-v")!, nI = f.querySelector<HTMLInputElement>("#og-n")!;
      const v = +String(vI.value).replace(/\s/g, "").replace(",", "."), n = +nI.value;
      const er = (i: HTMLElement, sel: string, m: string) => { const el = f.querySelector<HTMLElement>(sel)!; el.hidden = !m; el.textContent = m || ""; if (m) i.setAttribute("aria-invalid", "true"); else i.removeAttribute("aria-invalid"); return !m; };
      const ok1 = er(vI, "#og-v-e", !(v > 0) || (k === "pct" && (v > 50 || v % 1 !== 0)) || (k === "sum" && (v < 1 || v > 500)) ? (k === "sum" ? "Напишете сума от 1 до 500 €, например 50 или 25,50." : "Отстъпката е от 1 до 50%.") : "");
      const ok2 = er(nI, "#og-n-e", !(n >= 1 && n <= 50 && n % 1 === 0) ? "От 1 до 50 кода наведнъж." : "");
      if (!ok1) { vI.focus(); return; } if (!ok2) { nI.focus(); return; }
      okB.disabled = true;
      let made: Voucher[];
      try { made = await offersApi.createVouchers({ kind: k, value: v, n, note: f.querySelector<HTMLInputElement>("#og-note")!.value.trim() }); net = true; }
      catch (e) {
        okB.disabled = false;
        if (e instanceof ApiError && e.fields) { if (e.fields.value) { er(vI, "#og-v-e", e.fields.value); vI.focus(); return; } if (e.fields.n) { er(nI, "#og-n-e", e.fields.n); nI.focus(); return; } }
        toast(failText(e)); return;
      }
      okB.disabled = false;
      C = made.concat(C); draw(true);
      f.querySelector("[data-out]")!.innerHTML = '<div class="of-new" role="status"><b>Готово: ' + plural(n, "код", "кода") + "</b>" + made.slice(0, 5).map((c) => '<span class="mono">' + esc(c.code) + "</span>").join("") + (n > 5 ? '<span class="muted">и още ' + (n - 5) + " в списъка</span>" : "") +
        '<button class="pill pill-line" type="button" data-copyall>' + ic("copy", 18) + "Копирай " + (n === 1 ? "кода" : "кодовете") + "</button></div>";
      f.querySelector<HTMLButtonElement>("[data-copyall]")!.onclick = () => { try { void navigator.clipboard.writeText(made.map((c) => c.code).join("\n")).catch(() => { /* ignore */ }); } catch { /* ignore */ } toast(n === 1 ? "Кодът е копиран" : "Кодовете са копирани"); };
    };
  }

  await load();
}
