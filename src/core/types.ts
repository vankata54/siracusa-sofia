/* Business types shared by the server, the demo and the screens. */
import type { Mode } from "../lib/cart.ts";

export type Iso = string; // ISO date-time

export type OrderStatus = "accepted" | "cooking" | "ready" | "on_way" | "delivered" | "picked_up" | "cancelled";
export type PayMethod = "cash" | "card" | "voucher";
export const PAY_LABEL: Record<PayMethod, string> = { cash: "В брой", card: "Карта при получаване", voucher: "Ваучер" };
export type Channel = "web" | "qr" | "waiter" | "phone" | "office";

export interface OrderLine { id: string; q: number; mods: string[]; extra: number; name?: string; unit?: number }
export interface Order {
  id: string;            // = String(no)
  no: string;            // "1042"
  mode: Mode;
  channel: Channel;
  lines: OrderLine[];
  lunchOnly: boolean;
  zone: string;          // zone name for delivery, "" for pickup
  addr: string;
  pay: PayMethod;
  payLabel: string;
  sub: number;
  disc: number;
  fee: number | null;    // null = paid zone, fee unknown [ЛИПСВА]
  total: number;
  eta: number | null;    // minutes until delivery / ready (null for pre-orders)
  at: string;            // "HH:MM" or "веднага"
  sched: string;         // "" | "утре" | "днес"
  placedAt: string;      // "HH:MM" on the shop clock
  ts: number;            // epoch ms
  status: OrderStatus;
  name: string;
  phone: string;
  email?: string;
  note?: string;
  marketing: boolean;    // always false unless ticked
  userId?: string | null;
  table?: string | null; // QR / waiter orders
  createdAt: Iso;
  updatedAt: Iso;
}

export type ReservationStatus = "new" | "confirmed" | "seated" | "cancelled" | "no_show" | "waitlist";
export interface Reservation {
  id: string; date: string; time: string; people: number; table: string | null; zone: "salon" | "garden" | null;
  name: string; phone: string; email?: string; occasion?: string; note?: string; marketing: boolean;
  status: ReservationStatus; createdAt: Iso; updatedAt: Iso;
}

export interface Celebration {
  id: string; kind: string; people: number; date?: string; pack?: string; custom?: boolean; items?: string[]; cake?: boolean; decor?: boolean;
  zone?: "salon" | "garden" | "all"; name: string; phone: string; email?: string; note?: string; marketing: boolean;
  early: boolean; status: "new" | "offer_sent" | "confirmed" | "declined"; createdAt: Iso;
}

export interface OfficeParticipant { name: string; lines: OrderLine[]; paid?: boolean }
export interface OfficeOrder {
  id: string; code: string; office: string; addr: string; zone: string; deadline: string; payer: "one" | "each";
  mode: Mode; participants: OfficeParticipant[]; status: "open" | "sent" | "cancelled"; orderNo?: string; createdAt: Iso;
}

export interface Subscription { id: string; email: string; topic: "events"; consent: boolean; createdAt: Iso }

export interface Customer {
  id: string; phone: string; name: string; email?: string; isNew?: boolean; since: string;
  consent: { marketing: boolean; birthday: boolean; bday: string };
  favs: string[]; addrs: { id: string; label: string; addr: string; zone: string }[];
  stamps: number; coupons: { code: string; pct: number; note: string; used: boolean }[];
  blocked?: boolean; createdAt: Iso;
}

export interface SmsCode { id: string; phone: string; code: string; expiresAt: number; tries: number }

export interface Rating {
  id: string; orderNo: string; happy: boolean; text?: string; code: string; pct: number; createdAt: Iso;
}

export type NoteStatus = "new" | "doing" | "done";
export interface FeedbackNote {
  id: string; module: string; url: string; selector: string; editId?: string | null; text: string; elementText?: string;
  viewport: { w: number; h: number }; screenshot?: string | null; author: string; status: NoteStatus; createdAt: Iso; updatedAt: Iso;
}

export type RoleId = "admin" | "owner" | "manager" | "waiter" | "kitchen" | "driver" | "marketing";
export interface Role { id: RoleId; n: string; desc: string; sections: string[] }
export interface StaffUser { id: string; username: string; name: string; role: RoleId; salt: string; hash: string; algo: "scrypt" | "pbkdf2"; active: boolean; createdAt: Iso }
export interface Session { id: string; kind: "staff" | "customer"; userId: string; role?: RoleId; expiresAt: number; createdAt: Iso }

export interface AuditEntry { id: string; at: Iso; actor: string; action: string; target?: string; data?: unknown }

export class CoreError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
