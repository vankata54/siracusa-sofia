/* The admin dashboard numbers, computed in the core for one staff member (server and demo give the same):
   - "Чака те" (decision 15.11.2026, 3): orders to accept, reservations to confirm today, notes to approve / review
     (or the person's recommendations with a new status), no-shows waiting for a decision; only what the role sees;
   - "Днес": orders in work, reservations today, sold out today, and for the owner and the main admin
     "Днес: X € от N поръчки" (decision 15.11.2026, 5) from the real orders (without the cancelled ones).
   The badges in the admin bar read the same numbers (the badge "Бележки" = the number in "Чака те"). */
import { COL, nowDate, type Ctx } from "./ctx.ts";
import type { NoShowBlock, Order, Reservation } from "./types.ts";
import { FINISHED } from "./orders.ts";
import { notesWaiting } from "./notes.ts";
import { soldOutToday, outNow } from "./menu.ts";
import { items, lunch } from "../lib/data.ts";
import { MENU } from "../data/menu.ts";
import { shiftDay } from "../lib/shift-day.ts";
import { sofiaYmd } from "../lib/time.ts";
import { ordersOfDays } from "./history.ts";
import type { StaffCtx } from "./staff.ts";

export interface Summary {
  waiting: {
    orders: number | null; reservations: number | null; noShows: number | null;
    notes: { n: number; newN: number; reviewN: number; changedN: number; title: string };
  };
  today: {
    inWork: number | null; reservations: number | null; soldOut: number | null;
    /** owner and main admin only */
    sales: { sum: number; n: number; sample: boolean } | null;
  };
  /** the date the numbers are for (Sofia) */
  date: string;
}

const may = (s: StaffCtx, sec: string) => s.user.role === "admin" || s.sections.includes(sec);
/** the orders still in work (any day): by status, each an indexed read (never the whole list of orders) */
const OPEN: Order["status"][] = ["accepted", "cooking", "ready", "on_way"];

export async function summary(ctx: Ctx, s: StaffCtx): Promise<Summary> {
  /* "Днес" is the shift day (from 04:00) and an order is in the day it is for (core/order-day.ts), as in "Отчети" */
  const day = shiftDay(nowDate(ctx));
  const seeOrders = may(s, "orders"), seeRes = may(s, "reservations");
  const orders = seeOrders ? (await Promise.all(OPEN.map((st) => ctx.repo.list<Order>(COL.orders, { status: st } as Partial<Order>)))).flat() : [];
  const res = seeRes ? (await ctx.repo.list<Reservation>(COL.reservations)).filter((r) => r.date === day) : [];
  const decide = seeRes && ["admin", "owner", "manager"].includes(s.user.role);
  const blocks = decide ? (await ctx.repo.list<NoShowBlock>(COL.blocks)).filter((b) => b.status === "pending").length : null;
  let soldOut: number | null = null;
  if (may(s, "menu") || may(s, "kitchen") || may(s, "lunch")) {
    const t = await soldOutToday(ctx);
    const lunchOut = new Map(MENU.lunch.items.map((x) => [x.id, !!x.out]));
    soldOut = items.filter((x) => outNow(x, t)).length + lunch.filter((x) => (Object.prototype.hasOwnProperty.call(t, x.id) ? t[x.id] : lunchOut.get(x.id))).length;
  }
  const money = s.user.role === "admin" || s.user.role === "owner";
  const todays = money ? (await ordersOfDays(ctx, day, day)).filter((o) => o.status !== "cancelled") : [];
  const sales = money
    ? { sum: Math.round(todays.reduce((a, o) => a + (o.total || 0), 0) * 100) / 100, n: todays.length, sample: todays.some((o) => (o as Order & { sample?: boolean }).sample) }
    : null;
  return {
    waiting: {
      /* to accept: web, phone and office orders; a table order is already in the kitchen (the waiter or the QR confirmation) */
      orders: seeOrders ? orders.filter((o) => o.status === "accepted" && !(o.channel === "qr" || o.channel === "waiter" || !!o.table)).length : null,
      reservations: seeRes ? res.filter((r) => r.status === "new").length : null,
      noShows: blocks,
      notes: await notesWaiting(ctx, s),
    },
    today: {
      inWork: seeOrders ? orders.filter((o) => !FINISHED.includes(o.status) && o.status !== "cancelled").length : null,
      reservations: seeRes ? res.filter((r) => r.status !== "cancelled" && r.status !== "waitlist").length : null,
      soldOut,
      sales,
    },
    date: day,
  };
}

/* ---------- "Търси навсякъде" (decision 15.11.2026): people and numbers, only in what the role may see ----------
   Sections and dishes are public data and are searched in the browser (lib/search.ts); the core answers for customers,
   orders and reservations. Phones are masked in the answer ("0888 •• •• 56"). The exact match (a whole name or a phone of
   6+ digits) wins over partial ones, as in the prototype. */
const TR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya" };
/** Cyrillic or Latin, the same key (the prototype's norm()): "Клиент" and "klient" match */
export function normKey(s: string): string {
  return String(s || "").toLowerCase().split("").map((c) => (TR[c] != null ? TR[c] : c)).join("")
    .replace(/sht/g, "st").replace(/zh/g, "z").replace(/ch/g, "c").replace(/sh/g, "s").replace(/ts/g, "c").replace(/yu/g, "u").replace(/ya/g, "a")
    .replace(/[yj]/g, "i").replace(/w/g, "v").replace(/q/g, "k").replace(/x/g, "ks").replace(/[^a-z0-9 ]/g, " ").replace(/([a-z])\1+/g, "$1").replace(/\s+/g, " ").trim();
}
const digits = (x: unknown) => String(x || "").replace(/\D/g, "");
import { maskPhone } from "./rights.ts";
export { maskPhone };

export interface SearchHit { kind: "customer" | "order" | "reservation"; id: string; title: string; status?: string; date?: string; time?: string; people?: number; phone: string; exact: boolean }
export interface SearchAnswer { customers: SearchHit[] | null; orders: SearchHit[] | null; reservations: SearchHit[] | null }

export async function search(ctx: Ctx, s: StaffCtx, raw: string): Promise<SearchAnswer> {
  const q = String(raw || "").slice(0, 80), nq = normKey(q), dq = digits(q), txt = nq.replace(/[^a-z ]/g, "").trim().length >= 3;
  const match = (name: string, phone: string): 0 | 1 | 2 => {
    const nm = normKey(name), ph = digits(phone);
    if ((txt && nm === nq) || (dq.length >= 6 && ph.endsWith(dq))) return 2;
    if ((dq.length >= 3 && ph.includes(dq)) || (txt && (nm.startsWith(nq + " ") || (" " + nm + " ").includes(" " + nq + " ") || (!/\d/.test(nq) && nm.includes(nq))))) return 1;
    return 0;
  };
  const out: SearchAnswer = { customers: null, orders: null, reservations: null };
  if (!nq && !dq) return out;
  if (may(s, "customers")) {
    const l = await ctx.repo.list<{ id: string; name: string; phone: string }>(COL.customers);
    out.customers = l.map((c) => ({ c, m: match(c.name, c.phone) })).filter((x) => x.m).map(({ c, m }) => ({ kind: "customer" as const, id: c.id, title: c.name || "Клиент", phone: maskPhone(c.phone), exact: m === 2 }));
  }
  if (may(s, "orders")) {
    const l = await ctx.repo.list<Order>(COL.orders);
    out.orders = l.map((o) => {
      const byNo = !!dq && (o.no === dq || (dq.length >= 3 && dq.length < 6 && o.no.startsWith(dq)));
      const m = byNo ? (o.no === dq ? 2 : 1) : match(o.name, o.phone);
      return { o, m };
    }).filter((x) => x.m).sort((a, b) => b.o.ts - a.o.ts)
      .map(({ o, m }) => ({ kind: "order" as const, id: o.no, title: "№ " + o.no, status: o.status, phone: maskPhone(o.phone), exact: m === 2, date: sofiaYmd(new Date(o.ts || o.createdAt)), time: o.placedAt, people: undefined }));
  }
  if (may(s, "reservations")) {
    const l = await ctx.repo.list<Reservation>(COL.reservations);
    out.reservations = l.map((r) => ({ r, m: match(r.name, r.phone) })).filter((x) => x.m).sort((a, b) => (a.r.date < b.r.date ? 1 : -1))
      .map(({ r, m }) => ({ kind: "reservation" as const, id: r.id, title: r.name || "Резервация", status: r.status, date: r.date, time: r.time, people: r.people, phone: maskPhone(r.phone), exact: m === 2 }));
  }
  /* any exact match anywhere: only the exact ones (as in the prototype) */
  const lists = [out.customers, out.orders, out.reservations].filter(Boolean) as SearchHit[][];
  if (lists.some((l) => l.some((h) => h.exact))) {
    if (out.customers) out.customers = out.customers.filter((h) => h.exact);
    if (out.orders) out.orders = out.orders.filter((h) => h.exact);
    if (out.reservations) out.reservations = out.reservations.filter((h) => h.exact);
  }
  for (const k of ["customers", "orders", "reservations"] as const) { const l = out[k]; if (l) out[k] = l.slice(0, 60); }
  return out;
}
