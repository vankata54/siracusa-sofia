/* A section of the admin that has no screen in the code yet (stage C, part 1): the frame with its rights, the head of the
   section and a calm "Скоро" card that says what the section will do, with "Към таблото". Chosen over a sheet: every
   link of the dashboard and "Чака те" has its real address from day one (bookmarks, #next= after sign-in), the rights are
   checked on the address ("Нямате права за този раздел."), and the author of the section only replaces this page. */
import "sc-icons:squares-four";
import { A, mount, can, empty, soonTag, ic, esc, SEC, groupOf, session } from "./a.ts";
import { aurl } from "./routes.ts";

export async function initSoon(section: string, title?: string): Promise<void> {
  let s = SEC[section];
  /* "Бележки" without the section: "Моите препоръки" (every role writes recommendations with the pencil, decision 15.11.2026) */
  if (section === "notes") { if (!A.me) await session().catch(() => null); if (A.me && !can("notes")) { s = { ...s, n: "Моите препоръки", desc: "Препоръките, които сте изпратили с молива, и докъде са стигнали." }; title = s.n; } }
  const body = await mount({ section, title: title || s.n, sub: esc(s.desc), docTitle: title || s.n, eyebrow: groupOf(section) || "Админ", anyRole: section === "notes", barTitle: title || s.n });
  if (!body) return;
  body.innerHTML = '<div class="sa-card" data-edit-id="admin.' + section + '.soon"><p style="margin:0; padding:20px 20px 0; display:flex; justify-content:center">' + soonTag() + "</p>" +
    empty({ icon: s.ic, title: "Този екран идва скоро в новата система.", text: esc(s.desc) + " Дотогава таблото показва какво чака и какво става днес.",
      action: '<a class="pill pill-ink pill-lg" href="' + aurl.home() + '">' + ic("squares-four", 22) + "Към таблото</a>" }) + "</div>";
}
