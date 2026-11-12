/* /sabitia/praznik-masa.svg: the "Празник при нас" table drawing (static file at build), loaded by /sabitia/
   only when the section comes near the screen (it keeps about 28 KB out of the page HTML). */
import { partySvg } from "./_party.ts";

export function GET(): Response {
  return new Response(partySvg(), { headers: { "Content-Type": "image/svg+xml; charset=utf-8" } });
}
