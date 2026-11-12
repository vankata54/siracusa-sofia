/* Internal rating after an order and its -10% code (decision 30: the same for "Да" and "Не", the Google link is shown
   for both and is never tied to a discount).
   - only for an existing order that is delivered / picked up; one rating per order (asking again changes the answer
     and the text, the code stays the same);
   - the code: "SC10-" + 10 digits (10^10; digits only: nothing to confuse, easy on a phone keypad), kept in the core with
     the order's phone; the server limits code checks per IP;
   - it is used once, by any phone (owner to decide on "one code per phone"), for -10% on the dishes (not on the fee),
     never together with the lunch -30% (pricing.ts takes the better one); it is marked used only by a saved order. */
import { COL, emit, iso, randomDigits, rid, type Ctx } from "./ctx.ts";
import { CoreError, type Order, type Rating } from "./types.ts";
import { RESTAURANT } from "../lib/consts.ts";
import { FINISHED, findTracked } from "./orders.ts";

export const RATING_DISCOUNT = 10;
export const CODE_PREFIX = "SC10-";
export const CODE_MSG = {
  unknown: "Няма такъв код. Проверете цифрите, например SC10-4829163057.",
  used: "Този код вече е използван.",
};

/** "sc10 4829 163 057" -> "SC10-4829163057" */
export function normCode(c: string): string {
  const s = String(c || "").toUpperCase().replace(/[\s-]/g, "");
  return s.startsWith("SC10") ? CODE_PREFIX + s.slice(4) : CODE_PREFIX + s;
}
export const CODE_DIGITS = 10;

export async function findCode(ctx: Ctx, code: string): Promise<{ rating: Rating } | { error: string; used?: boolean }> {
  const c = normCode(code);
  if (!new RegExp("^SC10-\\d{" + CODE_DIGITS + "}$").test(c)) return { error: CODE_MSG.unknown };
  const r = (await ctx.repo.list<Rating>(COL.ratings)).find((x) => x.code === c);
  if (!r) return { error: CODE_MSG.unknown };
  if (r.usedBy) return { error: CODE_MSG.used, used: true };
  return { rating: r };
}

/** For the cart, before the order: { code, pct } or 422 with fields.code. */
export async function checkCode(ctx: Ctx, code: string): Promise<{ code: string; pct: number; valid: true }> {
  const f = await findCode(ctx, code);
  if ("error" in f) throw Object.assign(new CoreError("invalid", f.error, 422), { fields: { code: f.error } });
  return { code: f.rating.code, pct: f.rating.pct, valid: true };
}

/** Inside the order's transaction. */
export async function markCodeUsed(ctx: Ctx, code: string, orderNo: string): Promise<void> {
  const f = await findCode(ctx, code);
  if ("error" in f) throw Object.assign(new CoreError("invalid", f.error, 422), { fields: { code: f.error } });
  const r = f.rating;
  r.usedBy = orderNo; r.usedAt = iso(ctx); r.updatedAt = r.usedAt;
  await ctx.repo.put(COL.ratings, r);
}

export interface RatingResult { rating: Rating; code: string; pct: number; google: string | null; googleMissing: boolean }

export async function submitRating(ctx: Ctx, r: { orderNo: string; happy: boolean; text?: string }): Promise<RatingResult> {
  const o: Order | null = await findTracked(ctx, String(r && r.orderNo));
  if (!o) throw new CoreError("not_found", "Няма такава поръчка.", 404);
  if (FINISHED.indexOf(o.status) < 0) throw new CoreError("not_finished", "Можете да оцените поръчката, след като е доставена или взета.", 409);
  const text = r.text ? String(r.text).trim().slice(0, 2000) : undefined;
  const now = iso(ctx);
  const make = async (): Promise<Rating> => {
    const have = (await ctx.repo.list<Rating>(COL.ratings, { orderNo: o.no }))[0];
    if (have) {
      have.happy = !!r.happy; if (text) have.text = text; have.updatedAt = now;
      await ctx.repo.put(COL.ratings, have);
      return have;
    }
    let code = CODE_PREFIX + randomDigits(CODE_DIGITS);
    for (let i = 0; i < 5 && (await ctx.repo.list<Rating>(COL.ratings)).some((x) => x.code === code); i++) code = CODE_PREFIX + randomDigits(CODE_DIGITS);
    const rating: Rating = { id: rid(8), orderNo: o.no, happy: !!r.happy, text, code, pct: RATING_DISCOUNT, phone: o.phone, usedBy: null, usedAt: null, createdAt: now, updatedAt: now };
    await ctx.repo.put(COL.ratings, rating);
    return rating;
  };
  const rating = ctx.repo.transaction ? await ctx.repo.transaction(make) : await make();
  emit(ctx, "rating.created", { orderNo: rating.orderNo, happy: rating.happy });
  return { rating: { ...rating, phone: undefined }, code: rating.code, pct: rating.pct, google: RESTAURANT.googleReview, googleMissing: !RESTAURANT.googleReview };
}
