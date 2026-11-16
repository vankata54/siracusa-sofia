/* Offers and vouchers in the admin (section "Оферти и ваучери"; design/pages-admin/offers.html, README-2):
   - the offers of the site (site-data.ts "site:offers"): "В сайта" on / off, the rules (days, from-to, channel, dishes)
     and the texts; "-30% обедно след 15:00" is locked (decision 19); "-5% ранна резервация" cannot be on while the
     early days are not set (settings.earlyDays) and the loyalty card while its rule is [ЛИПСВА]; a new offer (custom, a %);
   - NEVER a discount for a review in Google (decision 30): a title or text about Google / a review is refused;
   - the rules are applied where the core gives the discount: the profile bonus ("signup") and the rating code
     ("rating") need the offer on and the order inside its days, hours, channel and dishes (orders.ts); off or outside:
     no discount (the profile coupon stays for a next order, the code says why). The banner of the site hides an offer
     that is off (lib/offers.ts OFFER_OFF at the next rebuild; /api/offers at once);
   - codes: check (SC10- from the rating, SCV- vouchers: valid / used / unknown, the core's texts), "Нови кодове"
     (a voucher of a sum or a %, 1-50 at a time, SCV- + 10 digits from crypto, once), "Използван" at the till.
     A voucher is not taken by the online cart in v1 ([ЛИПСВА: ваучери онлайн и валидност], OPEN-QUESTIONS 16);
   - the inquiries for a voucher and a birthday (feedback with topic "voucher" / "birthday"): customers-admin.ts. */
import { audit } from "./audit.ts";
import { COL, iso, nowDate, randomDigits, randomKey, type Ctx } from "./ctx.ts";
import { CoreError, type Rating } from "./types.ts";
import type { StaffCtx } from "./staff.ts";
import { need, invalid, HHMM, money } from "./rights.ts";
import { getSection, writeSection, type OfferRow, type OfferRule, type OfferChannel } from "./site-data.ts";
import { liveOffers } from "./offer-rules.ts";
export { offerApplies, orderOfferContext, liveOffers, type OfferContext } from "./offer-rules.ts";
import { getSettings } from "./settings.ts";
import { normCode, CODE_MSG } from "./codes.ts";
import { byId } from "../lib/data.ts";
import { offers as bannerOffers, type Offer } from "../lib/offers.ts";
import type { ClockInput } from "../lib/time.ts";

export const OFFER_MSG = {
  unknown: "Няма такава оферта.",
  locked: "Това правило е от решенията (19) и не се сменя оттук.",
  early: "Ранна резервация: [ЛИПСВА: колко дни]. Задайте дните в „Празник при нас“, после включете офертата.",
  loyalty: "Карта с печати: [ЛИПСВА: правило и награда]. Не може да се включи без тях.",
  google: "Никаква отстъпка срещу отзив в Google (правилата на Google). Махнете думите за отзив.",
  title: "Напишете заглавие (до 60 знака).",
  text: "Текстът е до 300 знака.",
  pct: "Отстъпката е цяло число от 1 до 50 %.",
  days: "Изберете поне един ден.",
  hours: "Часовете са от 10:00 до 23:00, началото преди края.",
  ch: "Изберете поне един канал.",
  dish: "Изберете ястия от менюто (или „Всички“ / „Обедното меню“).",
  onlyCustom: "Само нова оферта може да се изтрие; вградената се изключва.",
  outside: "Отстъпката не важи за тази поръчка (ден, час, канал или ястия).",
  off: "Тази отстъпка е изключена в момента.",
  vKind: "Изберете сума или процент.",
  vSum: "Сумата е от 1 до 500 €, например 25,00.",
  vN: "Броят е от 1 до 50.",
  vUnknown: "Няма такъв код. Проверете цифрите, например SCV-4829163057.",
  vUsed: "Този код вече е използван.",
};
const GOOGLE = /google|гугъл|гугл|отзив|ревю|review/i;
/* "G00gle", "G o o g l e", "гуг ъл": letters only, 0 -> o, 1 -> l, 3 -> e before the check */
const looksGoogle = (t: string) => GOOGLE.test(t) || GOOGLE.test(String(t).toLowerCase().replace(/0/g, "o").replace(/1/g, "l").replace(/3/g, "e").replace(/[^a-zа-я]/g, ""));
const CH: OfferChannel[] = ["delivery", "pickup", "table", "office"];

export interface OffersView { version: number; offers: (OfferRow & { blocked: string | null })[]; settings: { celebrationPrice: "estimate" | "offer"; earlyDays: number | null }; at: string | null; by: string | null }

const blockedOf = (o: OfferRow, earlyDays: number | null) => (o.needs === "earlyDays" && earlyDays == null ? OFFER_MSG.early : o.needs === "loyalty" ? OFFER_MSG.loyalty : null);

export async function offersList(ctx: Ctx, s: StaffCtx): Promise<OffersView> {
  need(s, "offers");
  const v = await getSection(ctx, "offers"), st = await getSettings(ctx);
  return { version: v.version, offers: v.data.map((o) => ({ ...o, blocked: blockedOf(o, st.earlyDays) })), settings: { celebrationPrice: st.celebrationPrice, earlyDays: st.earlyDays }, at: v.at, by: v.by };
}

/** "В сайта": 409 "locked" (-30%), 409 "missing" (early days / loyalty rule). Log: offer.toggle. */
export async function offerToggle(ctx: Ctx, s: StaffCtx, id: string, on: boolean, version?: number): Promise<OffersView> {
  need(s, "offers");
  const st = await getSettings(ctx);
  await writeSection(ctx, "offers", s.user.username, version, async (cur) => {
    const o = cur.find((x) => x.id === id);
    if (!o) throw new CoreError("not_found", OFFER_MSG.unknown, 404);
    if (o.lock) throw new CoreError("locked", OFFER_MSG.locked, 409);
    const b = blockedOf(o, st.earlyDays);
    if (on && b) throw new CoreError("missing", b, 409);
    if (o.on !== (on === true)) { o.on = on === true; await audit(ctx, s.user.username, "offer.toggle", id, { on: o.on, title: o.title }); }
    return { data: cur, result: {} };
  });
  return offersList(ctx, s);
}

function checkRule(r: unknown, f: Record<string, string>): OfferRule {
  const x = (r && typeof r === "object" ? r : {}) as Partial<OfferRule>;
  const days = Array.isArray(x.days) ? [...new Set(x.days.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : [];
  if (!days.length) f["r.days"] = OFFER_MSG.days;
  const from = String(x.from || ""), to = String(x.to || "");
  if (!HHMM.test(from) || !HHMM.test(to) || from < "10:00" || to > "23:00" || from >= to) f["r.from"] = OFFER_MSG.hours;
  const ch = Array.isArray(x.ch) ? [...new Set(x.ch.filter((c): c is OfferChannel => CH.includes(c as OfferChannel)))] : [];
  if (!ch.length) f["r.ch"] = OFFER_MSG.ch;
  let dish: OfferRule["dish"] = "all";
  if (x.dish === "all" || x.dish === "lunch") dish = x.dish;
  else if (Array.isArray(x.dish) && x.dish.length && x.dish.length <= 200 && x.dish.every((id) => typeof id === "string" && Object.prototype.hasOwnProperty.call(byId, id))) dish = [...new Set(x.dish as string[])];
  else f["r.dish"] = OFFER_MSG.dish;
  return { days, from, to, ch, dish };
}
const txt = (v: unknown, n: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n + 1);

export interface OfferPatch { title?: string; sub?: string; text?: string; pct?: number | string; r?: OfferRule }
/** "Правила" / the texts of one offer (not the locked one). 422 with fields (r.days, r.from, r.ch, r.dish, title, text,
    pct); a title or text about a Google review is refused. Log: offer.update. */
export async function offerSave(ctx: Ctx, s: StaffCtx, id: string, p: OfferPatch, version?: number): Promise<OffersView> {
  need(s, "offers");
  await writeSection(ctx, "offers", s.user.username, version, async (cur) => {
    const o = cur.find((x) => x.id === id);
    if (!o) throw new CoreError("not_found", OFFER_MSG.unknown, 404);
    if (o.lock) throw new CoreError("locked", OFFER_MSG.locked, 409);
    const f: Record<string, string> = {}, q = p && typeof p === "object" ? p : {};
    const next = { ...o };
    if (q.title !== undefined) { next.title = txt(q.title, 60); if (!next.title || next.title.length > 60) f.title = OFFER_MSG.title; }
    if (q.sub !== undefined) { next.sub = txt(q.sub, 60); if (next.sub.length > 60) f.sub = OFFER_MSG.title; }
    if (q.text !== undefined) { next.text = txt(q.text, 300); if (next.text.length > 300) f.text = OFFER_MSG.text; }
    if (q.pct !== undefined && o.custom) { const v = Number(q.pct); if (!Number.isInteger(v) || v < 1 || v > 50) f.pct = OFFER_MSG.pct; else next.pct = v; }
    if (q.r !== undefined) next.r = checkRule(q.r, f);
    if (looksGoogle(next.title + " " + next.sub + " " + next.text)) f.title = OFFER_MSG.google;
    if (Object.keys(f).length) invalid(f);
    Object.assign(o, next);
    await audit(ctx, s.user.username, "offer.update", id, { title: o.title, r: o.r });
    return { data: cur, result: {} };
  });
  return offersList(ctx, s);
}

/** "Нова оферта": a % off with rules; starts off ("В сайта" turns it on). Log: offer.create. */
export async function offerCreate(ctx: Ctx, s: StaffCtx, p: OfferPatch & { title: string }): Promise<OffersView & { id: string }> {
  need(s, "offers");
  const q = p && typeof p === "object" ? p : ({} as OfferPatch & { title: string });
  const f: Record<string, string> = {};
  const title = txt(q.title, 60), text = txt(q.text, 300), pct = Number(q.pct);
  if (!title || title.length > 60) f.title = OFFER_MSG.title;
  if (text.length > 300) f.text = OFFER_MSG.text;
  if (!Number.isInteger(pct) || pct < 1 || pct > 50) f.pct = OFFER_MSG.pct;
  const r = checkRule(q.r, f);
  if (looksGoogle(title + " " + text + " " + (q.sub || ""))) f.title = OFFER_MSG.google;
  if (Object.keys(f).length) invalid(f);
  const id = "of-" + randomKey(6);
  await writeSection(ctx, "offers", s.user.username, undefined, async (cur) => {
    cur.push({ id, kind: "pct", pct, ic: "seal-percent", title, sub: "-" + pct + "%", text: text || "[ЛИПСВА: текст]", on: false, r, custom: true });
    await audit(ctx, s.user.username, "offer.create", id, { title, pct });
    return { data: cur, result: {} };
  });
  return { ...(await offersList(ctx, s)), id };
}
/** a new offer only (the built-in ones are turned off). Returns the removed row for "Отмени" (offerRestore). */
export async function offerRemove(ctx: Ctx, s: StaffCtx, id: string): Promise<OffersView & { removed: OfferRow }> {
  need(s, "offers");
  let removed!: OfferRow;
  await writeSection(ctx, "offers", s.user.username, undefined, async (cur) => {
    const i = cur.findIndex((x) => x.id === id);
    if (i < 0) throw new CoreError("not_found", OFFER_MSG.unknown, 404);
    if (!cur[i].custom) throw new CoreError("forbidden", OFFER_MSG.onlyCustom, 403);
    removed = cur.splice(i, 1)[0];
    await audit(ctx, s.user.username, "offer.delete", id, { title: removed.title });
    return { data: cur, result: {} };
  });
  return { ...(await offersList(ctx, s)), removed };
}
export async function offerRestore(ctx: Ctx, s: StaffCtx, row: OfferRow): Promise<OffersView> {
  need(s, "offers");
  const r = row && typeof row === "object" ? row : ({} as OfferRow);
  if (!/^of-[a-z2-9]{6}$/.test(String(r.id))) throw new CoreError("not_found", OFFER_MSG.unknown, 404);
  const f: Record<string, string> = {};
  const rule = checkRule(r.r, f), title = txt(r.title, 60), pct = Number(r.pct);
  if (!title || !Number.isInteger(pct) || pct < 1 || pct > 50 || looksGoogle(title + " " + r.text)) f.title = OFFER_MSG.title;
  if (Object.keys(f).length) invalid(f);
  await writeSection(ctx, "offers", s.user.username, undefined, async (cur) => {
    if (!cur.some((x) => x.id === r.id)) cur.push({ id: r.id, kind: "pct", pct, ic: "seal-percent", title, sub: "-" + pct + "%", text: txt(r.text, 300) || "[ЛИПСВА: текст]", on: r.on === true, r: rule, custom: true });
    await audit(ctx, s.user.username, "offer.restore", r.id, { title });
    return { data: cur, result: {} };
  });
  return offersList(ctx, s);
}

/** the banner offers of the site now (/api/offers, api.offers() in the demo): the ones that are on */
export async function publicOffers(ctx: Ctx, clock?: ClockInput, today: Date = nowDate(ctx)): Promise<Offer[]> {
  const off = (await liveOffers(ctx)).filter((o) => !o.on && (o.id === "birthday" || o.id === "signup")).map((o) => o.id);
  return bannerOffers(clock ?? ctx.clock, today, off);
}

/* ---------- codes: the rating's SC10- and vouchers SCV- ---------- */
export interface Voucher { id: string; code: string; kind: "sum" | "pct"; sum: number | null; pct: number | null; note: string; createdAt: string; by: string; usedBy: string | null; usedAt: string | null }
export interface CodeCheck { code: string; kind: "rating" | "voucher" | null; status: "valid" | "used" | "unknown"; pct: number | null; sum: number | null; message: string; usedBy: string | null }

/** "sc10 4829 163 057" -> "SC10-4829163057", "scv 12..." -> "SCV-12..." */
export function normAnyCode(c: string): string {
  const s = String(c || "").toUpperCase().replace(/[\s-]/g, "");
  return s.startsWith("SCV") ? "SCV-" + s.slice(3) : normCode(s);
}
export async function codeCheck(ctx: Ctx, s: StaffCtx, raw: string): Promise<CodeCheck> {
  need(s, "offers");
  const code = normAnyCode(raw);
  let out: CodeCheck;
  if (/^SCV-\d{10}$/.test(code)) {
    const v = await ctx.repo.get<Voucher>(COL.vouchers, code);
    out = !v ? { code, kind: "voucher", status: "unknown", pct: null, sum: null, message: OFFER_MSG.vUnknown, usedBy: null }
      : { code, kind: "voucher", status: v.usedBy ? "used" : "valid", pct: v.pct, sum: v.sum, message: v.usedBy ? OFFER_MSG.vUsed : "", usedBy: v.usedBy };
  } else if (/^SC10-\d{10}$/.test(code)) {
    const r = (await ctx.repo.list<Rating>(COL.ratings)).find((x) => x.code === code);
    out = !r ? { code, kind: "rating", status: "unknown", pct: null, sum: null, message: CODE_MSG.unknown, usedBy: null }
      : { code, kind: "rating", status: r.usedBy ? "used" : "valid", pct: r.pct, sum: null, message: r.usedBy ? CODE_MSG.used : "", usedBy: r.usedBy || null };
  } else out = { code, kind: null, status: "unknown", pct: null, sum: null, message: CODE_MSG.unknown, usedBy: null };
  await audit(ctx, s.user.username, "code.check", code, { status: out.status });
  return out;
}

/** "Нови кодове": n vouchers of a sum (€) or a % at a time. Log: code.create (how many and what, not the codes). */
export async function voucherCreate(ctx: Ctx, s: StaffCtx, p: { kind: "sum" | "pct"; value: number | string; n: number | string; note?: string }): Promise<Voucher[]> {
  need(s, "offers");
  const q = p && typeof p === "object" ? p : ({} as typeof p);
  const f: Record<string, string> = {}, n = Number(q.n);
  if (q.kind !== "sum" && q.kind !== "pct") f.kind = OFFER_MSG.vKind;
  const v = q.kind === "pct" ? Number(q.value) : money(q.value);
  if (q.kind === "sum" && !(typeof v === "number" && v >= 1 && v <= 500)) f.value = OFFER_MSG.vSum;
  if (q.kind === "pct" && !(Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 50)) f.value = OFFER_MSG.pct;
  if (!Number.isInteger(n) || n < 1 || n > 50) f.n = OFFER_MSG.vN;
  if (Object.keys(f).length) invalid(f);
  const used = new Set((await ctx.repo.list<Voucher>(COL.vouchers)).map((x) => x.code));
  const out: Voucher[] = [], at = iso(ctx), note = txt(q.note, 120).slice(0, 120);
  for (let i = 0; i < n; i++) {
    let code = "SCV-" + randomDigits(10);
    while (used.has(code)) code = "SCV-" + randomDigits(10);
    used.add(code);
    const doc: Voucher = { id: code, code, kind: q.kind, sum: q.kind === "sum" ? (v as number) : null, pct: q.kind === "pct" ? (v as number) : null, note, createdAt: at, by: s.user.username, usedBy: null, usedAt: null };
    await ctx.repo.put(COL.vouchers, doc);
    out.push(doc);
  }
  await audit(ctx, s.user.username, "code.create", q.kind, { n, value: v, note });
  return out;
}
export async function vouchers(ctx: Ctx, s: StaffCtx): Promise<Voucher[]> {
  need(s, "offers");
  return (await ctx.repo.list<Voucher>(COL.vouchers)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.code < b.code ? -1 : 1));
}
/** "Използван" (at the till): once; 409 "used". Log: code.use. */
export async function voucherUse(ctx: Ctx, s: StaffCtx, raw: string, note?: string): Promise<Voucher> {
  need(s, ["offers", "orders"]);
  const code = normAnyCode(raw), v = /^SCV-\d{10}$/.test(code) ? await ctx.repo.get<Voucher>(COL.vouchers, code) : null;
  if (!v) throw new CoreError("not_found", OFFER_MSG.vUnknown, 404);
  if (v.usedBy) throw new CoreError("used", OFFER_MSG.vUsed, 409);
  v.usedBy = txt(note, 40) || s.user.username; v.usedAt = iso(ctx);
  await ctx.repo.put(COL.vouchers, v);
  await audit(ctx, s.user.username, "code.use", code);
  return v;
}

