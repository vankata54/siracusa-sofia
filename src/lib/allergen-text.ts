/* Not in ui.ts (its 6 000 B budget): only /menu/ and the categories use it. */
/* ---------- the "Алергени" sheet: one intro and one note on /menu/ and every category ---------- */
export const AL_INTRO = "Отметнете какво не ядете. Ще скрием ястията, които го съдържат.";
/** noComp: "73 ястия" without a composition yet ("" = none) */
export const alNote = (noComp: string) => "Алергените са предварителни, от състава. Кухнята ги потвърждава." +
  (noComp ? " За " + noComp + " още нямаме състав: показваме ги с бележка „попитайте ни“." : "") + " При силна алергия ни се обадете.";
