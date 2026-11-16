/* The staff modules until stage D (/servitor/, /kuhnya/, /shofyor/): "Модулът ти идва скоро", full screen, without the bar
   of the admin (decision 15.11.2026 "Вход според ролята"), with "Изход" and the pencil for recommendations.
   No session -> /admin/vhod/. A role that does not work in this module goes to its own home. */
import "sc-icons:sign-out,bell-ringing,chef-hat,moped,squares-four";
import { session, logout, mountPen, nameRole, ROLES, ic, esc, bootFail } from "./a.ts";
import { aurl } from "./routes.ts";

const MOD: Record<string, { n: string; title: string; what: string; ic: string }> = {
  waiter: { n: "Сервитьор", title: "Приложението на сервитьора", what: "Повикванията, масите, поръчките и сметките.", ic: "bell-ringing" },
  kitchen: { n: "Кухня", title: "Екранът на кухнята", what: "Опашката на твоята секция, изчерпано днес и „Натоварено“.", ic: "chef-hat" },
  driver: { n: "Шофьор", title: "Приложението на шофьора", what: "Твоите доставки, маршрутът, горивото и краят на смяната.", ic: "moped" },
};

export async function initStaffApp(module: "waiter" | "kitchen" | "driver"): Promise<void> {
  let me = null;
  try { me = await session(); } catch (e) { bootFail(e); return; }
  if (!me) { location.replace(aurl.login(aurl.here())); return; }
  const role = me.user.role;
  if (!(role === "admin" || role === module || me.sections.includes(module))) { location.replace(ROLES[role] && ["waiter", "kitchen", "driver"].includes(role) ? aurl.app(role) : aurl.home()); return; }
  const m = MOD[module];
  /* the main admin, the owner and the manager see the module from the admin: the way back to the dashboard */
  const boss = !["waiter", "kitchen", "driver"].includes(role);
  document.title = m.n + " | Siracusa · Админ";
  const app = document.createElement("div"); app.className = "sm-app";
  app.innerHTML = '<header class="sm-top"><div class="brand"><span class="word">Siracusa</span><span class="sa-btag">' + esc(m.n) + "</span></div>" +
    (boss ? '<a class="sa-tb" href="' + aurl.home() + '">' + ic("squares-four", 20) + "Към таблото</a>" : "") +
    '<button class="sa-tb" type="button" data-out>' + ic("sign-out", 20) + "Изход</button></header>" +
    '<main id="main" class="sm-main" tabindex="-1"><section class="sm-card" data-edit-id="' + module + '.soon"><div class="ill">' + ic(m.ic, 44) + "</div>" +
    "<h1>Модулът ти идва скоро</h1><p>" + esc(m.title) + ": " + esc(m.what.charAt(0).toLowerCase() + m.what.slice(1)) + "</p>" +
    '<p class="who">Вход: ' + esc(nameRole(me.user.name, role)) + ".</p>" +
    (boss ? "<p>Тук ще е модулът на персонала. Моливът работи и тук: посочи какво да е различно.</p></section>"
      : "<p>Дотогава моливът е тук: посочи какво да е различно и препоръката отива при главния админ.</p></section>") +
    '<div class="sm-end" aria-hidden="true"></div></main>';
  document.querySelector(".sa-boot")?.remove();
  document.body.appendChild(app);
  app.addEventListener("click", (e) => { if ((e.target as Element).closest("[data-out]")) logout(); });
  /* the pencil of the module (src/admin/pencil.ts): recommendations, the round button floats over the empty space below */
  mountPen(module);
}
