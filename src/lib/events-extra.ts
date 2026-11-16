/* The long parts of an event from the admin (program, menu of the evening), for the event pages at build time only: NOT in
   lib/events.ts, which is part of the shared runtime (size budget). The server's rebuild of the site puts the published
   events in place of this file (astro.config.mjs, SITE_FILE); empty = "[ЛИПСВА: програма]" / "[ЛИПСВА: меню на вечерта]". */
export const EVENT_EXTRA: Record<string, { prog: string; menu: string }> = {};
