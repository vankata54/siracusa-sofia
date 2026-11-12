/* Types only (erased at build): api.ts must not pull the core code into the page bundles. */
export type { Core, Audience, Order, PublicOrder, OfficeOrder, PublicOffice, Reservation, Subscription, Settings, NoteStatus, OrderStatus, ReservationStatus, OfficeParticipant, Customer } from "../core/index.ts";
export type { OrderInput } from "../core/orders.ts";
export type { ReservationInput, CelebrationInput } from "../core/reservations.ts";
export type { NoteInput } from "../core/notes.ts";
export type { ProfilePatch } from "../core/customers.ts";
