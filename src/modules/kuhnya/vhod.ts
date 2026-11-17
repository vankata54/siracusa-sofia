/* Кухня · Вход (/kuhnya/vhod/): the choice of the section of this tablet (design/pages-kuhnya/login.html): the sections of
   the kitchen's settings + "Общ изглед" for the head chef. The choice is remembered on the tablet ("sk-sec").
   The person signs in at /admin/vhod/ with a user name and a password and lands here; the step with the personal PIN is
   added later, in the empty [data-pin] of the card on the right (the core gets PIN sign-in first).
   Also here, because the top bar of the module has no room for them: the theme of the tablet and "Изход". */
import { kitchenGuard, tabletSec, store, theme, setTheme, secIcon, ic, esc, K_ALL } from "./frame.ts";
import { logout, nameRole } from "../../admin/a.ts";
import { aurl } from "../../admin/routes.ts";
import { murl } from "../routes.ts";

/* what is cooked where, in the words of the prototype: true only while the sections are the conditional ones (cfg.missing) */
const DESC: Record<string, string> = { topla: "Супи, топли предястия, основни, паста, бургери, гарнитури", skara: "Скара на дървени въглища", pesht: "Пици и пърленки", studeni: "Салати, студени предястия, сосове, десерти" };

export async function initVhod(): Promise<void> {
  const g = await kitchenGuard();
  if (!g) return;
  const { me, cfg, boss } = g;
  const cond = cfg.missing.find((m) => m.indexOf("секции") > -1) || "";
  let chosen = tabletSec(cfg) || (cfg.sections[0] ? cfg.sections[0].id : K_ALL);
  document.title = "Вход | Кухня · Siracusa";
  const el = document.createElement("div"); el.className = "lg";
  el.innerHTML = '<main class="lg-in" id="main" tabindex="-1">' +
    '<div class="lg-top"><span class="word">Siracusa</span> <span class="muted">Кухня</span>' + (boss ? '<a class="kboss" href="' + aurl.home() + '" title="Към таблото">' + ic("squares-four", 22) + "Табло</a>" : "") + "</div>" +
    '<section aria-labelledby="h-sec"><h1 id="h-sec">Коя е секцията на този таблет?</h1><p class="lead">Таблетът ще показва само ястията на секцията. Изборът се помни.</p>' +
    '<div class="secs" role="group" aria-label="Секции">' + cfg.sections.map((s) =>
      '<button class="sct" type="button" data-sec="' + esc(s.id) + '" aria-pressed="false"><span class="si">' + ic(secIcon(s.icon), 32) + "</span><b>" + esc(s.n) + "</b> " + (cond && DESC[s.id] ? '<span class="d">' + DESC[s.id] + "</span>" : "") + "</button>").join("") +
    '<button class="sct wide" type="button" data-sec="' + K_ALL + '" aria-pressed="false"><span class="si">' + ic(secIcon(cfg.all.icon), 32) + "</span><b>" + esc(cfg.all.n) + '</b> <span class="d">За главния готвач: всички секции, колко чакат, закъснения</span></button></div>' +
    (cond ? '<p class="note">' + ic("info", 20) + '<span>Секциите и кое ястие къде се готви са условни: <span class="miss">' + esc(cond) + "</span></span></p>" : "") + "</section>" +
    '<section class="pin kcard" aria-labelledby="h-in"><h2 id="h-in"><span data-name></span><small>Вход: ' + esc(nameRole(me.user.name, me.user.role)) + "</small></h2>" +
    "<div data-pin></div>" +
    '<button class="kb red" type="button" data-go>' + ic("sign-in", 24) + "<span data-golbl></span></button>" +
    '<div class="lg-set"><span class="lbl" id="h-theme">Тема на този таблет</span><div class="kseg" role="group" aria-labelledby="h-theme">' +
      '<button type="button" data-theme-set="dark">' + ic("moon", 20) + 'Тъмна</button><button type="button" data-theme-set="light">' + ic("sun", 20) + "Светла</button></div>" +
      '<button class="kb line" type="button" data-out style="min-height:52px; width:auto; font-size:16px">' + ic("sign-out", 22) + "Изход</button></div></section></main>";
  document.querySelector("[data-kboot]")?.remove();
  document.body.appendChild(el);

  const name = () => (chosen === K_ALL ? cfg.all.n : cfg.sections.find((s) => s.id === chosen)!.n);
  function upd(): void {
    el.querySelectorAll<HTMLElement>("[data-sec]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sec === chosen)));
    el.querySelector("[data-name]")!.textContent = name();
    el.querySelector("[data-golbl]")!.textContent = "Влез · " + name();
    el.querySelectorAll<HTMLElement>("[data-theme-set]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === theme())));
  }
  el.addEventListener("click", (e) => {
    const t = e.target as Element;
    const s = t.closest<HTMLElement>("[data-sec]");
    if (s) { chosen = s.dataset.sec!; upd(); return; }
    const th = t.closest<HTMLElement>("[data-theme-set]");
    if (th) { setTheme(th.dataset.themeSet === "light" ? "light" : "dark"); upd(); return; }
    if (t.closest("[data-out]")) { void logout(); return; }
    if (t.closest("[data-go]")) {
      store("sec", chosen);
      location.href = chosen === K_ALL ? murl.kuhnya("obsht-izgled") : murl.kuhnya();
    }
  });
  upd();
}
