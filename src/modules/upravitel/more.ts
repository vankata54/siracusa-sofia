/* Siracusa · "Управител" › "Още" (/upravitel/oshte/): port of design/pages-upravitel/more.html. "Бързо": "Нова поръчка по
   телефон" (-> the admin's form), "Нова резервация" (-> the admin's form), "Моите препоръки", "Към Собственик" (the owner
   here as a guest), "Към админа"; the sections of the admin the role has, as a list with a 2-line description (links,
   never copies); the theme Авто / Светла / Тъмна, "Звук за нова онлайн поръчка" (not for the owner, decision 16.11),
   "Изход". Nothing to load from the server: the rights are in the session the frame read. */
import "sc-icons:phone,calendar-check,pencil-simple,chart-bar,squares-four,caret-right,arrow-up-right,bell-ringing,sign-out,circles-three,sun,moon,lock,receipt,fork-knife,bowl-food,users-three,sliders-horizontal";
import { mountBoss, type Boss } from "../boss/frame.ts";
import { SEC, soundOn, toggleSound, onSoundChange } from "../../admin/a.ts";
import { aurl } from "../../admin/routes.ts";
import { bossHref, bossModuleOf } from "../boss/home.ts";
import { ic, esc, go, nowBadge } from "./common.ts";

export async function initMore(): Promise<void> {
  const boss = await mountBoss({ module: "upravitel", tab: "more", title: "Още", search: { load: () => import("./find.ts").then((m) => m.provider(boss!)) } });
  if (!boss) return;
  moreScreen(boss);
}

/* the sections of the admin (the full work is there; here only the links), the descriptions of the prototype */
const SECS: [string, string, string, string][] = [
  ["orders", "Поръчки", "", "Всички поръчки по статус и канал, детайл, смяна на статус"],
  ["reservations", "Резервации", "", "Денят по часове, маси, неявили се, блокиране"],
  ["menu", "Меню и изчерпано", "f=out", "Ястия, цени, „Изчерпано днес“ и „Върни“"],
  ["lunch", "Обедно меню", "", "Седмичният график пн-пт и ПИН за персонала"],
  ["reports", "Отчети", "", "Поръчки, канали, часове, топ ястия"],
  ["staff", "Персонал", "", "Потребители, роли, пароли и ПИН"],
  ["settings", "Настройки", "", "„Натоварено“ и минутите, часове"],
];
const THEMES: [string, string, string][] = [["system", "Авто", "circles-three"], ["light", "Светла", "sun"], ["dark", "Тъмна", "moon"]];
const themeNow = (): string => { try { const t = JSON.parse(localStorage.getItem("sa-prefs") || "{}").theme; return t === "light" || t === "dark" ? t : "system"; } catch { return "system"; } };

function moreScreen(boss: Boss): void {
  nowBadge(boss);
  const owner = boss.role === "owner", home = bossModuleOf(boss.role) === "upravitel" ? ' data-home="admin"' : "";
  /* "Звук" is for the one who accepts the orders: the manager and the main admin, never the owner (decision 16.11.2026) */
  const sound = !owner && boss.can("orders");
  const row = (href: string, icon: string, t: string, sub: string, extra = "", arrow = "caret-right") => '<a class="mg-setrow" href="' + href + '"' + extra + '><span class="si">' + ic(icon, 22) + "</span><span><b>" + esc(t) + "</b><small>" + esc(sub) + "</small></span>" + ic(arrow, 20) + "</a>";
  function draw() {
    const list = SECS.filter((s) => boss.can(s[0])), th = themeNow();
    boss.body.innerHTML = '<div class="mg-grid" data-upscr="more">' +
      '<section class="mg-blk" aria-labelledby="h-a"><div class="mg-h"><h2 id="h-a">Бързо</h2></div>' +
        (boss.can("orders") ? '<a class="mg-hero" href="' + go.phoneOrder() + '"><span class="hi">' + ic("phone", 28) + "</span><span><b>Нова поръчка по телефон</b><small>Телефон на клиента, доставка или вземане, час. Формата е в админа.</small></span>" + ic("caret-right", 24) + "</a>" : "") +
        '<div class="mg-card mg-list up-gap">' +
          (boss.can("reservations") ? row(go.newRes(), "calendar-check", "Нова резервация", "Формата е в „Резервации“ на админа") : "") +
          row(go.notes(boss.role), "pencil-simple", "Моите препоръки", "Какво предложи с молива и докъде е стигнало") +
          (owner ? row(bossHref("sobstvenik"), "chart-bar", "Към Собственик", "Твоят модул: оборот, тенденции, решения") : "") +
          row(aurl.home(), "squares-four", "Към админа", "Таблото и пълната работа на компютър", home) + "</div></section>" +
      '<section class="mg-blk" aria-labelledby="h-s"><div class="mg-h"><h2 id="h-s">Разделите на админа</h2><span class="mg-cnt">' + list.length + "</span></div>" +
        (list.length ? '<div class="mg-card mg-list">' + list.map((s) => row(aurl.section(s[0], s[2] || undefined), (SEC[s[0]] || { ic: "squares-four" }).ic, s[1], s[3], "", "arrow-up-right")).join("") + "</div>"
          : boss.empty({ icon: "lock", lock: true, title: "Няма раздели за тази роля", text: "Помоли главния админ за права." })) + "</section>" +
      '<section class="mg-blk all" aria-labelledby="h-v"><div class="mg-h"><h2 id="h-v">Изглед и звук</h2></div><div class="mg-card pad">' +
        '<p class="label up-lab" id="mg-thl">Тема</p><div class="mg-themes" role="group" aria-labelledby="mg-thl">' + THEMES.map((t) => '<button type="button" data-sa="settheme" data-v="' + t[0] + '" aria-pressed="' + (th === t[0]) + '">' + ic(t[2], 20) + t[1] + "</button>").join("") + "</div>" +
        (sound ? '<label class="mg-setrow up-snd"><span class="si">' + ic("bell-ringing", 22) + "</span><span><b>Звук за нова онлайн поръчка</b><small>Двоен тон и известие. Помни се на това устройство.</small></span>" +
          '<span class="mg-switch"><input type="checkbox" role="switch" data-snd data-keep="snd" aria-label="Звук за нова онлайн поръчка"' + (soundOn() ? " checked" : "") + '><span class="tr"></span></span></label>' : "") +
      '</div><button class="pill pill-line pill-lg pill-block up-out" type="button" data-bs="logout">' + ic("sign-out", 22) + "Изход</button></section></div>";
  }
  draw();
  boss.loaded();
  boss.body.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement; if (!t.matches("[data-snd]")) return;
    if (t.checked !== soundOn()) toggleSound();
    boss.toast(soundOn() ? "Звукът за нови онлайн поръчки е включен" : "Звукът за нови онлайн поръчки е изключен");
  });
  /* the key "Звук" in the top bar and this switch are one setting */
  onSoundChange(() => { const t = boss.body.querySelector<HTMLInputElement>("[data-snd]"); if (t) t.checked = soundOn(); });
}
