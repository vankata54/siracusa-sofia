/* Business types shared by the server, the demo and the screens. */
import type { Mode } from "../lib/cart.ts";

export type Iso = string; // ISO date-time

export type OrderStatus = "accepted" | "cooking" | "ready" | "on_way" | "delivered" | "picked_up" | "cancelled";
export type PayMethod = "cash" | "card" | "voucher";
export const PAY_LABEL: Record<PayMethod, string> = { cash: "В брой", card: "Карта при получаване", voucher: "Ваучер" };
export type Channel = "web" | "qr" | "waiter" | "phone" | "office";

/** cat and course: from the menu at the time of the order (the tracking page draws the step texts without the menu chunk) */
export interface OrderLine { id: string; q: number; mods: string[]; extra: number; name?: string; unit?: number; cat?: string; course?: string }
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
  /** the time the customer chose: "asap" or "HH:MM" (delivery today is always "asap") */
  slot?: string;
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
  /** secret part of the tracking address /porachka/<no>-<key>/ (orders before 12.11.2026 have none) */
  key?: string;
  /** discount code from the internal rating (used once), the discount it gave and which discount won */
  code?: string;
  codeDisc?: number;
  /** the one-time -10% of a new profile ("Отстъпка с профил: -X €") */
  profileDisc?: number;
  discKind?: "" | "lunch" | "code" | "profile";
  createdAt: Iso;
  updatedAt: Iso;
}

export type ReservationStatus = "new" | "confirmed" | "seated" | "cancelled" | "no_show" | "waitlist";
export interface Reservation {
  id: string; date: string; time: string; people: number; table: string | null; zone: "salon" | "garden" | null;
  name: string; phone: string; email?: string; occasion?: string; note?: string; marketing: boolean;
  status: ReservationStatus; createdAt: Iso; updatedAt: Iso;
  /** minutes the table is held (the setting at booking time, default 120) */
  dur?: number;
  /** secret for get/cancel from the SMS link (returned only by create) */
  key?: string;
}

export interface Celebration {
  id: string; kind: string; people: number; date?: string; pack?: string; custom?: boolean; items?: string[]; cake?: boolean; decor?: boolean;
  zone?: "salon" | "garden" | "all"; name: string; phone: string; email?: string; note?: string; marketing: boolean;
  early: boolean; status: "new" | "offer_sent" | "confirmed" | "declined"; createdAt: Iso;
  /** start time "HH:MM"; wishes for the cake (cake: true) and for the decoration / the evening (up to 300 / 1000 characters) */
  time?: string; cakeNote?: string; wishes?: string;
}

/** pid: the participant's personal token (kept in the colleague's browser; never shown to others) */
export interface OfficeParticipant { name: string; lines: OrderLine[]; paid?: boolean; pid?: string }
export interface OfficeOrder {
  id: string; code: string; office: string; addr: string; zone: string; deadline: string; payer: "one" | "each";
  mode: Mode; participants: OfficeParticipant[]; status: "open" | "sent" | "cancelled"; orderNo?: string; createdAt: Iso;
  /** the day of the lunch ("YYYY-MM-DD", Sofia) */
  date?: string;
  /** organizer token: send, edit anyone, continue from another device (never in the public view) */
  orgKey?: string;
  /** organizer contact, needed for the automatic send at the deadline */
  contact?: { name: string; phone: string; pay?: PayMethod; email?: string } | null;
  /** why the automatic send at the deadline did not happen ("no_contact" | "empty" | an error code) */
  autoFailed?: string;
  sentAt?: Iso;
  /** of the sent order, the same on every device: "HH:MM" (or "веднага"), total in € */
  orderAt?: string; orderTotal?: number;
  /** created in the test preview of the server (x-sc-clock): the real-time sweep leaves it alone */
  preview?: boolean;
  /** public view only: the caller holds the organizer token */
  isOrg?: boolean;
}

export interface Subscription { id: string; email: string; topic: "events"; topics: string[]; consent: boolean; createdAt: Iso; updatedAt?: Iso }

export interface Customer {
  id: string; phone: string; name: string; email?: string; isNew?: boolean; since: string;
  consent: { marketing: boolean; birthday: boolean; bday: string };
  /** notifications the customer wants (off by default): order status, reservation reminder. Events and offers come only
      with the marketing consent (decision 12.11.2026). Old records {order, events, offers} are read as {order, reservation: false}. */
  notify?: { order: boolean; reservation: boolean };
  favs: string[]; addrs: { id: string; label: string; addr: string; zone: string }[];
  stamps: number; coupons: { code: string; pct: number; note: string; used: boolean; orderNo?: string }[];
  blocked?: boolean; createdAt: Iso;
}

/** sentAt: last code (30 s between codes); sends: codes in the current hour window from windowAt */
export interface SmsCode { id: string; phone: string; code: string; expiresAt: number; tries: number; sentAt?: number; sends?: number; windowAt?: number }

export interface Rating {
  id: string; orderNo: string; happy: boolean; text?: string; code: string; pct: number; createdAt: Iso;
  /** phone of the rated order (kept for the owner's later rule "one code per phone") */
  phone?: string;
  /** the order that used the code, once */
  usedBy?: string | null; usedAt?: Iso | null; updatedAt?: Iso;
}

/** Settings the admin / kitchen change (one document "main"). */
export interface Settings {
  id: "main";
  kitchen: { busy: boolean; etaMin: number; etaBusyMin: number };
  /** how long a reservation holds the table, minutes (default 120, owner to confirm) */
  resMinutes: number;
  /** the celebration calculator: show an estimate to the guest, or only "Ще ви изпратим оферта" (OPEN-QUESTIONS 3) */
  celebrationPrice: "estimate" | "offer";
  /** "early booking" -5% for a celebration booked this many days ahead; null = [ЛИПСВА] (OPEN-QUESTIONS 13): no -5% */
  earlyDays: number | null;
  updatedAt?: Iso;
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
