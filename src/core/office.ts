/* Office group order ("Обща поръчка за офиса").
   - create: the deadline is "HH:MM" between 10:30 and 14:00 (every 15 min); the day follows the page's rule
     (if the deadline is less than 30 min away, the order is for tomorrow); returns the organizer token `orgKey`
     (send, edit anyone, continue from another device) and keeps the organizer contact for the automatic send;
   - join: only lunch dishes of today's lunch menu, no modifications; every colleague gets a personal token `pid`
     (an entry is changed only with its pid or by the organizer; a name already in the list is refused);
     after the deadline the list is closed;
   - submit: only the organizer (or the server at the deadline), only once (the second call is refused, nothing is sent twice);
   - the public view never has orgKey, the colleagues' pids or the contact. */
import { COL, emit, iso, nowDate, rid, randomDigits, type Ctx } from "./ctx.ts";
import { CoreError, PAY_LABEL, type OfficeOrder, type OfficeParticipant, type Order, type PayMethod } from "./types.ts";
import { audit } from "./audit.ts";
import { createOrder, checkLines, type OrderInput } from "./orders.ts";
import { zoneOfAddress } from "../lib/zones.ts";
import { minutes, sofiaYmd, addDaysYmd } from "../lib/time.ts";
import { normPhone } from "../lib/format.ts";
import type { Mode } from "../lib/cart.ts";

export const OFFICE_FIRST = 630, OFFICE_LAST = 840; /* 10:30 .. 14:00 */
/** dishes (lines) one colleague may choose */
export const OFFICE_MAX_LINES = 10;
export const OFFICE_MSG = {
  deadline: "Изберете краен час между 10:30 и 14:00.",
  notFound: "Тази обща поръчка не съществува.",
  closedList: "Крайният час мина. Списъкът е затворен.",
  nameTaken: "Това име вече е в списъка. Добавете инициал, например „Иван П.“.",
  onlyOrg: "Само организаторът може да изпрати поръчката.",
  tooEarly: "Поръчката е за друг ден. Изпраща се в деня на обяда.",
};

const toMin = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3);
function invalid(fields: Record<string, string>): never {
  throw Object.assign(new CoreError("invalid", "Проверете полетата.", 422), { fields });
}
const dateOf = (o: OfficeOrder) => o.date || (o.createdAt || "").slice(0, 10);

/** Has the deadline passed (Sofia day + time)? */
export function officeDue(ctx: Ctx, o: OfficeOrder): boolean {
  const today = sofiaYmd(nowDate(ctx)), d = dateOf(o);
  return d < today || (d === today && minutes(ctx.clock) >= toMin(o.deadline));
}

export type PublicOffice = Omit<OfficeOrder, "orgKey" | "contact" | "participants"> & { participants: { name: string; lines: OfficeParticipant["lines"]; paid?: boolean }[]; due: boolean;
  /** the organizer gave a phone (so the order leaves at the deadline by itself); never the data itself */
  hasContact: boolean };
export function publicOffice(ctx: Ctx, o: OfficeOrder, orgKey?: string | null): PublicOffice {
  const { orgKey: k, contact: _c, participants, ...rest } = o;
  return { ...rest, participants: participants.map((p) => ({ name: p.name, lines: p.lines, ...(p.paid != null ? { paid: p.paid } : {}) })), isOrg: !!orgKey && orgKey === k, due: officeDue(ctx, o), hasContact: !!(o.contact && o.contact.phone) };
}

export interface OfficeInput {
  office: string; addr: string; deadline?: string; payer?: "one" | "each"; mode?: Mode;
  /** organizer contact (name + phone): with it the order leaves at the deadline even if no page is open */
  name?: string; phone?: string; pay?: PayMethod; email?: string;
}

export async function createOffice(ctx: Ctx, o: OfficeInput): Promise<OfficeOrder> {
  const f: Record<string, string> = {};
  const mode: Mode = o.mode === "pickup" ? "pickup" : "delivery";
  /* the office name is optional (PAGES.md, BRIEF) */
  const z = zoneOfAddress(o.addr || "");
  if (mode === "delivery" && z.type !== "zone") f.addr = "Напишете квартала, например Дружба 2.";
  const deadline = o.deadline == null || o.deadline === "" ? "11:30" : String(o.deadline);
  const ok = /^([01]\d|2[0-3]):[0-5]\d$/.test(deadline) && toMin(deadline) >= OFFICE_FIRST && toMin(deadline) <= OFFICE_LAST && toMin(deadline) % 15 === 0;
  if (!ok) f.deadline = OFFICE_MSG.deadline;
  let contact: OfficeOrder["contact"] = null;
  if (o.phone != null && String(o.phone).trim()) {
    const ph = normPhone(o.phone);
    if (!ph) f.phone = "Телефонът трябва да е 10 цифри, например 0888 12 34 56.";
    else contact = { name: String(o.name || "").trim().slice(0, 80), phone: ph, pay: o.pay && PAY_LABEL[o.pay] ? o.pay : "cash", ...(o.email ? { email: String(o.email).trim() } : {}) };
  }
  if (Object.keys(f).length) invalid(f);
  /* the day: today if the deadline is at least 30 min away (the page's rule), else tomorrow */
  const today = sofiaYmd(nowDate(ctx));
  const date = minutes(ctx.clock) + 30 > toMin(deadline) ? addDaysYmd(today, 1) : today;
  let code = randomDigits(6);
  for (let i = 0; i < 5 && (await getOffice(ctx, code)); i++) code = randomDigits(6);
  const doc: OfficeOrder = {
    id: rid(8), code, office: String(o.office || "").trim().slice(0, 80), addr: mode === "delivery" ? String(o.addr || "").trim().slice(0, 300) : "", zone: mode === "delivery" && z.type === "zone" ? z.zone.n : "",
    deadline, payer: o.payer === "each" ? "each" : "one", mode, participants: [], status: "open", createdAt: iso(ctx),
    date, orgKey: rid(12), contact, ...(ctx.preview && ctx.clock ? { preview: true } : {}),
  };
  await ctx.repo.put(COL.office, doc);
  emit(ctx, "office.created", { code: doc.code, date, deadline }, {});
  return doc;
}

/** Raw document (the core and the scheduler); screens get publicOffice(). */
export async function getOffice(ctx: Ctx, code: string): Promise<OfficeOrder | null> {
  if (!/^\d{4,12}$/.test(String(code || ""))) return null;
  return (await ctx.repo.list<OfficeOrder>(COL.office, { code: String(code) }))[0] || null;
}
export async function viewOffice(ctx: Ctx, code: string, orgKey?: string | null): Promise<PublicOffice | null> {
  const o = await getOffice(ctx, code);
  return o ? publicOffice(ctx, o, orgKey) : null;
}

export interface JoinInput { name: string; lines: OfficeParticipant["lines"]; pid?: string; orgKey?: string }

export async function joinOffice(ctx: Ctx, code: string, p: JoinInput): Promise<PublicOffice & { pid: string }> {
  const o = await getOffice(ctx, code);
  if (!o) throw new CoreError("not_found", OFFICE_MSG.notFound, 404);
  if (o.status !== "open") throw new CoreError("closed", "Поръчката вече е изпратена.", 409);
  const isOrg = !!p.orgKey && p.orgKey === o.orgKey;
  if (!isOrg && officeDue(ctx, o)) throw new CoreError("deadline", OFFICE_MSG.closedList, 409);
  const name = String(p.name || "").trim().slice(0, 40);
  if (!name) invalid({ name: "Напишете името си." });
  if (Array.isArray(p.lines) && p.lines.length > OFFICE_MAX_LINES) throw new CoreError("too_many", "До " + OFFICE_MAX_LINES + " ястия на човек.", 422);
  const lines = Array.isArray(p.lines) && p.lines.length
    ? checkLines(ctx, { lines: p.lines }, o.mode, { lunchOnly: true }).lines.map((l) => {
      if (l.mods.length) throw new CoreError("bad_mod", "В общата поръчка ястията са без промени.", 422);
      return { id: l.id, q: l.q, mods: [], extra: 0 };
    })
    : [];
  let i = p.pid ? o.participants.findIndex((x) => x.pid === p.pid) : -1;
  const byName = o.participants.findIndex((x) => x.name.toLowerCase() === name.toLowerCase());
  if (i < 0 && byName > -1) {
    if (!isOrg) throw Object.assign(new CoreError("name_taken", OFFICE_MSG.nameTaken, 409), { fields: { name: OFFICE_MSG.nameTaken } });
    i = byName;
  } else if (i > -1 && byName > -1 && byName !== i) {
    throw Object.assign(new CoreError("name_taken", OFFICE_MSG.nameTaken, 409), { fields: { name: OFFICE_MSG.nameTaken } });
  }
  let pid: string;
  if (i > -1) { pid = o.participants[i].pid || rid(12); o.participants[i] = { ...o.participants[i], name, lines, pid }; }
  else { pid = rid(12); o.participants.push({ name, lines, pid }); }
  if (o.autoFailed === "empty" && lines.length) delete o.autoFailed; /* a dish now: the sweep tries again */
  await ctx.repo.put(COL.office, o);
  emit(ctx, "office.updated", { code: o.code, participants: o.participants.length }, { office: o.code });
  return { ...publicOffice(ctx, o, p.orgKey), pid };
}

/** The organizer adds or changes the contact (name, phone, how they pay) after creating: needed for the automatic send. */
export async function updateOffice(ctx: Ctx, code: string, orgKey: string, patch: { name?: string; phone?: string; pay?: PayMethod }): Promise<PublicOffice> {
  const o = await getOffice(ctx, code);
  if (!o) throw new CoreError("not_found", OFFICE_MSG.notFound, 404);
  if (!orgKey || orgKey !== o.orgKey) throw new CoreError("forbidden", "Само организаторът може да променя поръчката.", 403);
  if (o.status !== "open") throw new CoreError("closed", "Поръчката вече е изпратена" + (o.orderNo ? " (№ " + o.orderNo + ")." : "."), 409);
  const cur = o.contact || { name: "", phone: "", pay: "cash" as PayMethod };
  let phone = cur.phone;
  if (patch.phone != null) {
    const raw = String(patch.phone).trim();
    if (!raw) phone = "";
    else { const p = normPhone(raw); if (!p) invalid({ phone: "Телефонът трябва да е 10 цифри, например 0888 12 34 56." }); phone = p!; }
  }
  const name = patch.name != null ? String(patch.name).trim().slice(0, 80) : cur.name;
  const pay = patch.pay && PAY_LABEL[patch.pay] ? patch.pay : cur.pay || "cash";
  o.contact = phone ? { ...cur, name, phone, pay } : null;
  if (o.autoFailed === "no_contact" && phone) delete o.autoFailed; /* the server tries again at the next sweep */
  await ctx.repo.put(COL.office, o);
  emit(ctx, "office.updated", { code: o.code, participants: o.participants.length }, { office: o.code });
  return publicOffice(ctx, o, orgKey);
}

export type SubmitInput = Pick<OrderInput, "name" | "phone" | "pay" | "email" | "note"> & { orgKey?: string };

export async function submitOffice(ctx: Ctx, code: string, contact: SubmitInput, auto = false): Promise<{ office: PublicOffice; order: Order }> {
  const run = async () => {
    const o = await getOffice(ctx, code);
    if (!o) throw new CoreError("not_found", OFFICE_MSG.notFound, 404);
    if (!auto && !(contact.orgKey && contact.orgKey === o.orgKey)) throw new CoreError("forbidden", OFFICE_MSG.onlyOrg, 403);
    if (o.status !== "open") throw new CoreError("closed", "Поръчката вече е изпратена" + (o.orderNo ? " (№ " + o.orderNo + ")." : "."), 409);
    if (dateOf(o) > sofiaYmd(nowDate(ctx))) throw new CoreError("too_early", OFFICE_MSG.tooEarly, 409);
    /* the same dish of all colleagues in one line (at most 50 per line), so a big office never hits the 40-line limit */
    const sum = new Map<string, number>();
    for (const l of o.participants.flatMap((p) => p.lines)) sum.set(l.id, (sum.get(l.id) || 0) + l.q);
    const lines: { key: string; id: string; q: number; mods: string[]; extra: number }[] = [];
    for (const [id, q0] of sum) for (let q = q0, k = 0; q > 0; q -= 50, k++) lines.push({ key: id + (k ? "#" + k : ""), id, q: Math.min(q, 50), mods: [], extra: 0 });
    const c = auto && o.contact ? o.contact : contact;
    /* the organizer's contact from the creation when this device did not send it (second device, the sweep) */
    const first = o.participants[0] ? o.participants[0].name : "";
    const order = await createOrder(ctx, {
      name: c.name || (o.contact && o.contact.name) || first, phone: c.phone || (o.contact && o.contact.phone) || "", pay: c.pay || (o.contact && o.contact.pay) || undefined, email: c.email, note: (contact as SubmitInput).note,
      cart: { mode: o.mode, lines }, zone: o.zone, addr: o.addr, channel: "office",
    });
    o.status = "sent"; o.orderNo = order.no; o.sentAt = iso(ctx); o.orderAt = order.at; o.orderTotal = order.total; delete o.autoFailed;
    await ctx.repo.put(COL.office, o);
    return { o, order };
  };
  const { o, order } = ctx.repo.transaction ? await ctx.repo.transaction(run) : await run();
  emit(ctx, "office.updated", { code: o.code, participants: o.participants.length, status: o.status, orderNo: o.orderNo }, { office: o.code });
  return { office: publicOffice(ctx, o, contact.orgKey), order };
}

/** Open office orders whose deadline has come: send them (the server calls this at start, at each deadline and every minute).
    Without the organizer's phone or without dishes the order stays open and gets `autoFailed` (the organizer sends it). */
export async function sendDueOffices(ctx: Ctx): Promise<{ sent: string[]; failed: [string, string][] }> {
  const open = (await ctx.repo.list<OfficeOrder>(COL.office, { status: "open" } as Partial<OfficeOrder>)).filter((o) => !o.autoFailed && (!o.preview || ctx.preview) && officeDue(ctx, o));
  const sent: string[] = [], failed: [string, string][] = [];
  for (const o of open) {
    let why = "";
    if (!o.participants.some((p) => p.lines.length)) why = "empty";
    else if (!o.contact || !o.contact.phone) why = "no_contact";
    else {
      try { await submitOffice(ctx, o.code, { name: o.contact.name || (o.participants[0] ? o.participants[0].name : ""), phone: o.contact.phone, pay: o.contact.pay }, true); sent.push(o.code); await audit(ctx, "system", "office.auto_sent", o.code); continue; }
      catch (e) { why = e instanceof CoreError ? e.code : "error"; }
    }
    const cur = await getOffice(ctx, o.code);
    if (cur && cur.status === "open") { cur.autoFailed = why; await ctx.repo.put(COL.office, cur); emit(ctx, "office.updated", { code: cur.code, participants: cur.participants.length, autoFailed: why }, { office: cur.code }); }
    failed.push([o.code, why]);
  }
  return { sent, failed };
}

/** Epoch ms of the deadline (for a timer). */
export function officeDueAt(o: OfficeOrder, epoch: (ymd: string, min: number) => number): number {
  return epoch(dateOf(o), toMin(o.deadline));
}
