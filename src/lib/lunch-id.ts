/* Its own tiny module (not in lunch.ts): a light page imports only this, so nothing more of lunch.ts moves into the
   shared runtime (the 30 000 B budget). */
/** A dish of the lunch menu, from its id alone: every lunch dish in the data has the "l-" prefix (design/data/menu.js) and no
    other dish does (tests/unit/lib.test.ts keeps that true; the admin's lunch editor must keep it too). For light pages
    that know a cart line but not the menu. */
export const isLunchId = (id: string): boolean => id.startsWith("l-");
