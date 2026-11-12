/* Customers: sign-in with phone + SMS code (v1/demo: the code is returned and shown on screen), profile, consents
   (marketing always false by default), favourites, addresses, internal rating (-10% code; Google link always). */
import { COL, iso, nowDate, rid, randomDigits, type Ctx } from "./ctx.ts";
import { CoreError, type Customer, type Order, type Rating, type Session, type SmsCode } from "./types.ts";
import { normPhone } from "../lib/format.ts";
import { BLOCKED_DEMO_PHONE } from "./reservations.ts";

export const SMS_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

export const SMS_RESEND_S = 30;
export const SMS_PER_HOUR = 5;
/** A code by SMS. Limits: 30 s between codes and 5 codes an hour per number (the server also limits per IP).
    known: the number already has a profile (the SMS itself tells the same, so it reveals nothing new).
    demoCode only when ctx.smsDemo (demo build, tests, SMS_DEMO=1): without an SMS provider production refuses clearly. */
export async function requestSmsCode(ctx: Ctx, rawPhone: string): Promise<{ sent: true; phone: string; demoCode?: string; resendIn: number; known: boolean }> {
  const phone = normPhone(rawPhone);
  if (!phone) throw Object.assign(new CoreError("invalid", "Телефонът трябва да е 10 цифри, например 0888 12 34 56.", 422), { fields: { phone: "Телефонът трябва да е 10 цифри, например 0888 12 34 56." } });
  if (phone === BLOCKED_DEMO_PHONE) throw new CoreError("blocked", "За съжаление не можем да изпратим код до този номер. Обадете ни се на 0894 36 55 77.", 403);
  if (!ctx.smsDemo && !ctx.demo) throw new CoreError("sms_unavailable", "Входът с код по SMS още не работи. Обадете ни се на 0894 36 55 77.", 503);
  const now = nowDate(ctx).getTime(), prev = await ctx.repo.get<SmsCode>(COL.smsCodes, phone);
  if (!ctx.noLimits && prev && prev.sentAt && now - prev.sentAt < SMS_RESEND_S * 1000) {
    const left = Math.ceil((SMS_RESEND_S * 1000 - (now - prev.sentAt)) / 1000);
    throw Object.assign(new CoreError("too_soon", "Нов код може след " + left + " сек.", 429), { retryIn: left });
  }
  const fresh = !prev || !prev.windowAt || now - prev.windowAt >= 3600_000;
  const sends = fresh ? 1 : (prev!.sends || 0) + 1;
  if (!ctx.noLimits && sends > SMS_PER_HOUR) throw new CoreError("too_many", "Твърде много кодове за този номер. Опитайте след час или ни се обадете на 0894 36 55 77.", 429);
  const code = randomDigits(6);
  const doc: SmsCode = { id: phone, phone, code, expiresAt: now + SMS_TTL_MS, tries: 0, sentAt: now, sends, windowAt: fresh ? now : prev!.windowAt };
  await ctx.repo.put(COL.smsCodes, doc);
  const known = (await ctx.repo.list<Customer>(COL.customers, { phone })).length > 0;
  return { sent: true, phone, demoCode: code, resendIn: SMS_RESEND_S, known };
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

export type ProfilePatch = Partial<Pick<Customer, "name" | "email">> & { consent?: Partial<Customer["consent"]>; notify?: Partial<NonNullable<Customer["notify"]>> };

export async function updateCustomer(ctx: Ctx, id: string, patch: ProfilePatch): Promise<Customer> {
  const c = await ctx.repo.get<Customer>(COL.customers, id);
  if (!c) throw new CoreError("not_found", "Няма такъв профил.", 404);
  if (patch.name != null) c.name = String(patch.name).trim();
  if (patch.email != null) c.email = String(patch.email).trim() || undefined;
  if (patch.consent) c.consent = { ...c.consent, ...patch.consent, marketing: patch.consent.marketing === true ? true : patch.consent.marketing === false ? false : c.consent.marketing };
  if (patch.notify) {
    const cur = c.notify || { order: false, events: false, offers: false }, n = patch.notify;
    c.notify = { order: n.order == null ? cur.order : n.order === true, events: n.events == null ? cur.events : n.events === true, offers: n.offers == null ? cur.offers : n.offers === true };
  }
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

/** "Моите кодове": the -10% codes from the ratings of this customer's orders (by phone), newest first. */
export async function customerCodes(ctx: Ctx, c: Customer): Promise<{ code: string; pct: number; orderNo: string; used: boolean; usedBy: string | null; createdAt: string }[]> {
  const all = await ctx.repo.list<Rating>(COL.ratings);
  return all.filter((r) => r.phone === c.phone).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((r) => ({ code: r.code, pct: r.pct, orderNo: r.orderNo, used: !!r.usedBy, usedBy: r.usedBy || null, createdAt: r.createdAt }));
}

/* ---------- internal rating after an order: src/core/codes.ts ---------- */
export { submitRating, RATING_DISCOUNT } from "./codes.ts";
