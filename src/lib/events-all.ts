/* ALL the events of the site for the pages at build time (/sabitia/, the event pages, getStaticPaths, the start page's
   server HTML): NOT in the shared runtime. The runtime (src/client/sc.ts, SC.events()) keeps lib/events.ts: only the
   monthly evening the reservation calendar and the offers know (size budget, decision 12.11.2026).
   The server's rebuild of the site puts the published events from the admin in place of this file (astro.config.mjs,
   SITE_FILE, scripts/site-file.mjs); without it this is the same list as lib/events.ts. */
export { events, EVENT_SLUGS } from "./events.ts";
