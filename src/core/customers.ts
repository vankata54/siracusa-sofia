/* Customers: sign-in with phone + SMS code (v1/demo: the code is returned and shown on screen), profile, consents
   (marketing always false by default), favourites, addresses, internal rating (-10% code; Google link always). */
import { COL, emit, iso, nowDate, rid, randomDigits, type Ctx } from "./ctx.ts";
import { CoreError, type Customer, type Order, type Rating, type Session, type SmsCode } from "./types.ts";
import { normPhone } from "../lib/format.ts";
import { RESTAURANT } from "../lib/data.ts";
import { BLOCKED_DEMO_PHONE } from "./reservations.ts";

export const SMS_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const RATING_DISCOUNT = 10;

export async function requestSmsCode(ctx: Ctx, rawPhone: string): Promise<{ sent: true; phone: string; demoCode: string; resendIn: number }> {
  const phone = normPhone(rawPhone);
  if (!phone) throw Object.assign(new CoreError("invalid", "Телефонът трябва да е 10 цифри, например 0888 12 34 56.", 422), { fields: { phone: "Телефонът трябва да е 10 цифри, например 0888 12 34 56." } });
  if (phone === BLOCKED_DEMO_PHONE) throw new CoreError("blocked", "За съжаление не можем да изпратим код до този номер. Обадете ни се на 0894 36 55 77.", 403);
  const code = randomDigits(6);
  const doc: SmsCode = { id: phone, phone, code, expiresAt: nowDate(ctx).getTime() + SMS_TTL_MS, tries: 0 };
  await ctx.repo.put(COL.smsCodes, doc);
  /* v1 has no SMS provider: the code is returned and shown on the screen (marked as demo). */
  return { sent: true, phone, demoCode: code, resendIn: 30 };
}

export async function verifySmsCode(ctx: Ctx, rawPhone: string, code: string, extra: { name?: string; marketing?: boolean } = {}):
  Promise<{ token: string; customer: Customer; isNew: boolean }> {
  const phone = normPhone(rawPhone);
  const rec = phone ? await ctx.repo.get<SmsCode>(COL.smsCodes, phone) : null;
  if (!rec || rec.expiresAt < nowDate(ctx).getTime()) throw new CoreError("expired", "Кодът изтече. Изпратете нов код.", 410);
  if (rec.tries >= 5) throw new CoreError("too_many", "Твърде много опити. Изпратете нов код.", 429);
  if (rec.code !== String(code).trim()) {
    rec.tries++; await ctx.repo.put(COL.smsCodes, rec);
    throw new CoreError("wrong_code", "Кодът не съвпада. Проверете съобщението и опитайте пак.", 401);
  }
  await ctx.repo.del(COL.smsCodes, phone!);
  let c = (await ctx.repo.list<Customer>(COL.customers, { phone: phone! }))[0];
  const isNew = !c;
  if (!c) {
    c = {
      id: rid(8), phone: phone!, name: String(extra.name || "").trim(), isNew: true, since: iso(ctx).slice(0, 10),
      consent: { marketing: extra.marketing === true, birthday: false, bday: "" },
      favs: [], addrs: [], stamps: 0,
      coupons: [{ code: "PROFIL10", pct: 10, note: "-10% от следващата поръчка", used: false }],
      createdAt: iso(ctx),
    };
    await ctx.repo.put(COL.customers, c);
  }
  const s: Session = { id: rid(24), kind: "customer", userId: c.id, expiresAt: nowDate(ctx).getTime() + SESSION_TTL_MS, createdAt: iso(ctx) };
  await ctx.repo.put(COL.sessions, s);
  return { token: s.id, customer: c, isNew };
}

export async function customerBySession(ctx: Ctx, token: string | undefined | null): Promise<Customer | null> {
  if (!token) return null;
  const s = await ctx.repo.get<Session>(COL.sessions, token);
  if (!s || s.kind !== "customer" || s.expiresAt < nowDate(ctx).getTime()) return null;
  return ctx.repo.get<Customer>(COL.customers, s.userId);
}

export async function logout(ctx: Ctx, token: string): Promise<void> { await ctx.repo.del(COL.sessions, token); }

export type ProfilePatch = Partial<Pick<Customer, "name" | "email">> & { consent?: Partial<Customer["consent"]> };

export async function updateCustomer(ctx: Ctx, id: string, patch: ProfilePatch): Promise<Customer> {
  const c = await ctx.repo.get<Customer>(COL.customers, id);
  if (!c) throw new CoreError("not_found", "Няма такъв профил.", 404);
  if (patch.name != null) c.name = String(patch.name).trim();
  if (patch.email != null) c.email = String(patch.email).trim() || undefined;
  if (patch.consent) c.consent = { ...c.consent, ...patch.consent, marketing: patch.consent.marketing === true ? true : patch.consent.marketing === false ? false : c.consent.marketing };
  c.isNew = false;
  await ctx.repo.put(COL.customers, c);
  return c;
}

export async function toggleFavourite(ctx: Ctx, id: string, dishId: string): Promise<Customer> {
  const c = await ctx.repo.get<Customer>(COL.customers, id);
  if (!c) throw new CoreError("not_found", "Няма такъв профил.", 404);
  c.favs = c.favs.includes(dishId) ? c.favs.filter((x) => x !== dishId) : [...c.favs, dishId];
  await ctx.repo.put(COL.customers, c);
  return c;
}

export async function addAddress(ctx: Ctx, id: string, a: { label: string; addr: string; zone: string }): Promise<Customer> {
  const c = await ctx.repo.get<Customer>(COL.customers, id);
  if (!c) throw new CoreError("not_found", "Няма такъв профил.", 404);
  c.addrs = [...c.addrs, { id: rid(4), label: a.label || "Адрес", addr: a.addr, zone: a.zone }];
  await ctx.repo.put(COL.customers, c);
  return c;
}
export async function removeAddress(ctx: Ctx, id: string, addrId: string): Promise<Customer> {
  const c = await ctx.repo.get<Customer>(COL.customers, id);
  if (!c) throw new CoreError("not_found", "Няма такъв профил.", 404);
  c.addrs = c.addrs.filter((x) => x.id !== addrId);
  await ctx.repo.put(COL.customers, c);
  return c;
}

export async function customerOrders(ctx: Ctx, c: Customer): Promise<Order[]> {
  return (await ctx.repo.list<Order>(COL.orders, { phone: c.phone })).sort((a, b) => +b.no - +a.no);
}

/** GDPR: everything we hold about this customer. */
export async function exportCustomer(ctx: Ctx, c: Customer) {
  const orders = await customerOrders(ctx, c);
  const reservations = await ctx.repo.list(COL.reservations, { phone: c.phone } as never);
  return { exportedAt: iso(ctx), profile: c, orders, reservations };
}

/** GDPR: delete the profile and sessions (orders stay for the fiscal record, without the link to the profile). */
export async function deleteCustomer(ctx: Ctx, id: string): Promise<void> {
  const sessions = await ctx.repo.list<Session>(COL.sessions, { userId: id });
  for (const s of sessions) await ctx.repo.del(COL.sessions, s.id);
  await ctx.repo.del(COL.customers, id);
}

/* ---------- internal rating after an order ---------- */
export async function submitRating(ctx: Ctx, r: { orderNo: string; happy: boolean; text?: string }): Promise<{ rating: Rating; code: string; pct: number; google: string | null; googleMissing: boolean }> {
  const rating: Rating = {
    id: rid(8), orderNo: String(r.orderNo), happy: !!r.happy, text: r.text ? String(r.text).slice(0, 2000) : undefined,
    code: "SC10-" + randomDigits(4), pct: RATING_DISCOUNT, createdAt: iso(ctx),
  };
  await ctx.repo.put(COL.ratings, rating);
  emit(ctx, "rating.created", { orderNo: rating.orderNo, happy: rating.happy });
  /* The -10% is for the internal rating, the same for "Да" and "Не". The Google link is shown for both answers
     and is never tied to a discount. */
  return { rating, code: rating.code, pct: rating.pct, google: RESTAURANT.googleReview, googleMissing: !RESTAURANT.googleReview };
}
