/* Business types shared by the server, the demo and the screens. */
import type { Mode } from "../lib/cart.ts";

export type Iso = string; // ISO date-time

export type OrderStatus = "accepted" | "cooking" | "ready" | "on_way" | "delivered" | "picked_up" | "cancelled";
export type PayMethod = "cash" | "card" | "voucher";
export const PAY_LABEL: Record<PayMethod, string> = { cash: "В брой", card: "Карта при получаване", voucher: "Ваучер" };
export type Channel = "web" | "qr" | "waiter" | "phone" | "office";

/** cat and course: from the menu at the time of the order (the tracking page draws the step texts without the menu chunk) */
export interface OrderLine { id: string; q: number; mods: string[]; extra: number; name?: string; unit?: number; cat?: string; course?: string;
  /* ---- stage D, the modules (docs/MODULES-BRIEF.md, section 4); all optional, older orders have none ---- */
  /** the kitchen section at the time of the order (core/kitchen.ts) and the line's state there */
  sec?: string; ks?: "wait" | "cook" | "ready"; readyAt?: Iso;
  /** "Започни" in the kitchen: when the section started this line ("готви се от 19:22") */
  cookAt?: Iso;
  /** "Сервирах" (a table order): when the waiter served this line */
  servedAt?: Iso; servedBy?: string;
  /** marked "Изчерпано днес" after the order was accepted (the kitchen) */
  out?: boolean;
  /** a note for the kitchen on this line; the weight of a `per100` steak in grams; the guest of the table ("Гост 1") */
  note?: string; grams?: number; guest?: string;
  /** the payment (of the table's bill) that covered this line */
  paid?: string }
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
  /** when each status was reached (ISO), e.g. {accepted, cooking, ready}; orders before 13.11.2026 have only createdAt */
  times?: Partial<Record<OrderStatus, Iso>>;
  /** changes by the customer (pre-orders only): how many and when the last one was */
  changes?: number;
  changedAt?: Iso;
  /** the status before "Отказана" (the way back with "Отмени") */
  prevStatus?: OrderStatus;
  /** why it was cancelled ("Откажи" in the admin: required, the customer sees it) */
  reason?: string;
  /** a phone order: the staff member who took it */
  by?: string;
  /* ---- stage D, the modules (docs/MODULES-BRIEF.md, section 4) ---- */
  /** a table order: the sitting at the table (core/floor.ts), the bill it belongs to ("Обща сметка" / "Гост 1"),
      and "waiter" when a QR order went through the waiter's confirmation */
  session?: string; bill?: string; via?: "waiter" | "";
  /** delivery: the driver's username, the course (one trip) it rides in, "Взех" / "Пристигнах" (ISO) and a problem
      the driver reported ("nobody" | "address" | "refused") */
  driver?: string; course?: string; pickedAt?: Iso; arrivedAt?: Iso;
  problem?: { kind: "nobody" | "address" | "refused"; at: Iso; note?: string; solved?: "returned" | "delivered" | ""; solvedAt?: Iso } | null;
  /** "Доставена · взех X €" (core/driver.ts): what the driver took at the door: cash (the sum), or the card / voucher as such */
  collected?: { pay: PayMethod; sum: number; at: Iso; by: string; feeMissing?: boolean } | null;
  /** the manager's notes on the order ("Обади се на клиента": called, accepted without a sold-out dish ...) */
  staffNotes?: { at: Iso; by: string; text: string }[];
  /** the kitchen: minutes added to the deadline because the order was placed while "Натоварено" was on (core/kitchen-base.ts) */
  kBusy?: number;
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
  /** made by the staff ("Нова резервация" in the admin): the username */
  by?: string;
  /** the status before the last change by the staff (the way back with "Отмени") */
  prevStatus?: ReservationStatus;
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
  /** "Изтрий" in the admin (GDPR): deleted for good after `until` (epoch ms) unless "Отмени" comes first */
  deleting?: { at: Iso; by: string; until: number } | null;
}

/** sentAt: last code (30 s between codes); sends: codes in the current hour window from windowAt */
export interface SmsCode { id: string; phone: string; code: string; expiresAt: number; tries: number; sentAt?: number; sends?: number; windowAt?: number }

export interface Rating {
  id: string; orderNo: string; happy: boolean; text?: string; code: string; pct: number; createdAt: Iso;
  /** phone of the rated order (kept for the owner's later rule "one code per phone") */
  phone?: string;
  /** the order that used the code, once */
  usedBy?: string | null; usedAt?: Iso | null; updatedAt?: Iso;
  /** a rating from the QR table (core/floor-guest.ts): the sitting and the phone ("p2"); orderNo is the sitting's first order */
  session?: string; guest?: string;
}

/** Settings the admin / kitchen change (one document "main"). */
export interface Settings {
  id: "main";
  /** busyAt: when "Натоварено" was turned on (ISO; set by the core, null when off) */
  kitchen: { busy: boolean; etaMin: number; etaBusyMin: number; busyAt?: string | null;
    /** who turned "Натоварено" on (the name shown: "Управител", "Кухня · Скара", "Главен готвач"); null when off */
    busyBy?: string | null };
  /** how long a reservation holds the table, minutes (default 120, owner to confirm) */
  resMinutes: number;
  /** the celebration calculator: show an estimate to the guest, or only "Ще ви изпратим оферта" (OPEN-QUESTIONS 3) */
  celebrationPrice: "estimate" | "offer";
  /** "early booking" -5% for a celebration booked this many days ahead; null = [ЛИПСВА] (OPEN-QUESTIONS 13): no -5% */
  earlyDays: number | null;
  /** no-shows of one phone before it waits for a decision ("Блокирай" / "Не блокирай"), 1-5 (OPEN-QUESTIONS 8: 2) */
  noShowLimit: number;
  /** the QR table: minutes between two same calls (3) and to the manager after (5) (OPEN-QUESTIONS, modules 1) */
  callCooldown: number;
  callManager: number;
  /** a QR order nobody confirmed goes to the manager after this many minutes (decision 17.11.2026, answer 29: 3) */
  qrManager?: number;
  updatedAt?: Iso;
}

/** decision 15.11.2026: new -> approved -> doing -> review -> published, or rejected (with a reason). Only the role admin changes it. */
export type NoteStatus = "new" | "approved" | "doing" | "review" | "published" | "rejected";
export const NOTE_STATUSES: NoteStatus[] = ["new", "approved", "doing", "review", "published", "rejected"];
/** who wrote it: a staff member (role + username) or a customer from the site ("Предложи подобрение", no sign-in) */
export type NoteSource = { type: "staff"; role: RoleId; user: string } | { type: "client" };
export interface FeedbackNote {
  id: string; module: string; url: string; selector: string; editId?: string | null; text: string; elementText?: string;
  viewport: { w: number; h: number }; screenshot?: string | null; author: string; status: NoteStatus; createdAt: Iso; updatedAt: Iso;
  source?: NoteSource;
  /** why it was rejected (required for "rejected") */
  reason?: string;
  /** "Върни за поправка": what to fix (review -> doing) */
  fix?: string;
  /** what was changed, shown in "За преглед" (filled by the session that did the work) */
  change?: { summary: string; before?: string; after?: string } | null;
  history?: { status: NoteStatus; at: Iso; who: string }[];
  /** "answer": the owner's answer to a question of the agency ("Решения", core/owner.ts); one note per question */
  kind?: "answer";
  /** the question and the answer (kind "answer") */
  q?: NoteQuestion;
  /** the earlier answers to the same question, the newest last (what "Отмени" brings back) */
  answers?: NoteAnswerPrev[];
}
/** the owner's answer: the question word for word, the default, "Съгласен" (default) or "Друго" (other, the text) */
export interface NoteQuestion { id: string; n: string; sec: "r" | "m"; group: string; text: string; def: string; answer: "default" | "other"; other: string }
export interface NoteAnswerPrev { at: Iso; text: string; q: NoteQuestion; status: NoteStatus; reason?: string; history?: { status: NoteStatus; at: Iso; who: string }[] }
/** the moment a staff member last opened "Бележки" / "Моите препоръки" (the badge counts what changed after it) */
export interface NotesSeen { id: string; at: Iso }
/** no-shows of one phone (id = the phone): "pending" after 2 (the manager decides), "blocked", "cleared" */
export interface NoShowBlock { id: string; name: string; count: number; status: "pending" | "blocked" | "cleared"; at: Iso; by?: string }

export type RoleId = "admin" | "owner" | "manager" | "waiter" | "kitchen" | "driver" | "marketing";
export interface Role { id: RoleId; n: string; desc: string; sections: string[] }
export interface StaffUser { id: string; username: string; name: string; role: RoleId; salt: string; hash: string; algo: "scrypt" | "pbkdf2"; active: boolean; createdAt: Iso; updatedAt?: Iso;
  /** the PIN of the staff apps (waiter, kitchen, driver): only its salted hash (staff-admin.ts), never the PIN */
  pin?: { salt: string; hash: string; algo: "scrypt" | "pbkdf2"; at: Iso } | null;
  /** the last sign-in (ISO) */
  lastLoginAt?: Iso }
export interface Session { id: string; kind: "staff" | "customer"; userId: string; role?: RoleId; expiresAt: number; createdAt: Iso }

export interface AuditEntry { id: string; at: Iso; actor: string; action: string; target?: string; data?: unknown }

export class CoreError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
