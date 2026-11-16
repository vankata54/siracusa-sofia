/* The statuses of a note in words (shared by "Бележки" and "Дневник"; decision 15.11.2026): [status, tab, one]. */
import type { NoteStatus } from "../client/api-types.ts";

export const STS: [NoteStatus, string, string][] = [["new", "Нови", "Нова"], ["approved", "Одобрени", "Одобрена"], ["doing", "В изпълнение", "В изпълнение"], ["review", "За преглед", "За преглед"], ["published", "Публикувани", "Публикувана"], ["rejected", "Отхвърлени", "Отхвърлена"]];
export const statusName = (s: string) => (STS.find((x) => x[0] === s) || [s, s, s])[2];
