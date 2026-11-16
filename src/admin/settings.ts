/* /admin/settings/: „Настройки“ (design/pages-admin/settings.html, версия 4, 1:1; решения 04.11, 13.11, 14.11 и 16.11.2026).
   - Кухнята: „Натоварено“ (ключ, от кога е включено), обичайно време (35) и при натоварване (55, поне колкото обичайното),
     как го виждат гостите: нормално „около 35 мин“, натоварено „Възможни са закъснения · около 55 мин“.
   - Резервации: колко време е масата на гостите (30-360 през 30; не е „задържане“ докато гостът попълва: такова няма, решение
     14.11), блокиране след N неявявания (1-5), часовете за резервация (от ядрото, само за четене).
   - Празник: „Само оферта“ / „Ориентировъчна цена“; -5% за ранна резервация: без число е изключено (дни не се измислят).
   - Часове (само за четене: правила в ядрото). QR маса: между две еднакви повиквания (1-15 мин), към управителя след (1-30).
   - Отворените въпроси, които стават настройки, със стойността по подразбиране.
   - Промените се трупат в лента „N промени · Откажи · Запази“; „Запази“ праща само сменените полета (adminApi.setSettings,
     проверките на src/core/settings.ts; 422 -> текстът под полето), ред „settings.update“ в дневника, „Отмени“ връща
     предишните стойности. Известието казва какво ще стане, без да твърди повече (BRIEF, решение 12 на шефа).
   - „Натоварено“, включено от кухнята, идва на живо (api.on("settings")), щом тук няма незапазени промени. */
import "sc-icons:chef-hat,calendar-check,confetti,clock,bell-ringing,question,hourglass,minus,plus,check,sparkle,info";
import { api } from "../client/api.ts";
import { adminApi, ApiError } from "../client/api-admin.ts";
import type { Settings } from "../client/api-types.ts";
import type { SettingsPatch } from "../core/settings.ts";
import { A, mount, toast, sheet, skel, failHTML, offline, missing, soonTag, reduceMotion, esc, ic, plural } from "./a.ts";
import { aurl } from "./routes.ts";
import { hmOf } from "./when.ts";

type Hours = Awaited<ReturnType<typeof adminApi.settings>>["hours"];
type W = Pick<Settings, "kitchen" | "resMinutes" | "celebrationPrice" | "earlyDays" | "noShowLimit" | "callCooldown" | "callManager">;
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const isOffline = (e: unknown) => e instanceof ApiError && e.code === "offline";
/* the fields of the bar, the log line and the patch */
const LABEL: Record<string, string> = { "kitchen.busy": "„Натоварено“", "kitchen.etaMin": "обичайно време", "kitchen.etaBusyMin": "време при натоварване", resMinutes: "колко време е масата на гостите", noShowLimit: "блокиране след",
  celebrationPrice: "цена на празник", earlyDays: "ранна резервация", callCooldown: "между повиквания", callManager: "към управителя" };
const LIMITS: Record<string, [string | null, string, number, number]> = { etaMin: ["kitchen", "etaMin", 5, 240], etaBusyMin: ["kitchen", "etaBusyMin", 5, 240], resMinutes: [null, "resMinutes", 30, 360],
  noShowLimit: [null, "noShowLimit", 1, 5], callCooldown: [null, "callCooldown", 1, 15], callManager: [null, "callManager", 1, 30] };
const get = (o: W, k: string): unknown => k.split(".").reduce((x: unknown, p) => (x as Record<string, unknown>)[p], o);
export function fmtV(k: string, v: unknown): string {
  if (k === "kitchen.busy") return v ? "включено" : "изключено";
  if (k === "celebrationPrice") return v === "offer" ? "само оферта" : "ориентировъчна";
  if (k === "earlyDays") return v == null ? "изключено" : plural(v as number, "ден", "дни");
  if (k === "noShowLimit") return plural(v as number, "път", "пъти");
  return v + " мин";
}
/** what the guests see (decision 04.11.2026): "около 35 мин" / "Възможни са закъснения · около 55 мин" */
export const custText = (k: Settings["kitchen"], busy: boolean) => (busy ? "Възможни са закъснения · около " + k.etaBusyMin + " мин" : "около " + k.etaMin + " мин");
/** only the changed fields (kitchen as one object) */
export function patchOf(saved: W, w: W): SettingsPatch {
  const p: SettingsPatch = {};
  const k: Partial<Settings["kitchen"]> = {};
  (["busy", "etaMin", "etaBusyMin"] as const).forEach((x) => { if (saved.kitchen[x] !== w.kitchen[x]) (k as Record<string, unknown>)[x] = w.kitchen[x]; });
  if (Object.keys(k).length) p.kitchen = k;
  (["resMinutes", "celebrationPrice", "earlyDays", "noShowLimit", "callCooldown", "callManager"] as const).forEach((x) => { if (!eq(saved[x], w[x])) (p as Record<string, unknown>)[x] = w[x]; });
  return p;
}

export async function initSettings(): Promise<void> {
  const body = await mount({ section: "settings", title: "Настройки", eyebrow: "Работа по сайта",
    sub: "Числата, които сайтът, кухнята и резервацията четат от едно място: „Натоварено“ и минутите, колко време е масата на гостите, цената на празник. Запазената промяна важи в системата веднага навсякъде." });
  if (!body) return;
  const root = body;
  let saved: W | null = null, w: W | null = null, H: Hours | null = null, errs: Record<string, string> = {}, offlineNote = false, saving = false;

  const pick = (s: Settings): W => ({ kitchen: { busy: !!s.kitchen.busy, etaMin: s.kitchen.etaMin, etaBusyMin: s.kitchen.etaBusyMin, busyAt: s.kitchen.busyAt || null }, resMinutes: s.resMinutes, celebrationPrice: s.celebrationPrice, earlyDays: s.earlyDays, noShowLimit: s.noShowLimit, callCooldown: s.callCooldown, callManager: s.callManager });
  const diffs = () => (saved && w ? Object.keys(LABEL).filter((k) => !eq(get(saved!, k), get(w!, k))) : []);
  async function load(): Promise<boolean> {
    try { const s = await adminApi.settings(); saved = pick(s); w = clone(saved); H = s.hours; offlineNote = false; return true; }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { location.replace(aurl.login(aurl.here())); return false; }
      root.innerHTML = failHTML(e, "Не успяхме да заредим настройките. Сайтът и кухнята работят с последните запазени."); return false;
    }
  }
  const ch = (k: string) => (saved && w && !eq(get(saved, k), get(w, k)) ? '<span class="chg-dot" role="img" aria-label="променено"></span>' : "");
  const counter = (key: string, val: number, min: number, max: number, step: number, unit: string, label: string) =>
    '<div class="counter" role="group" aria-label="' + esc(label) + '"><button type="button" data-inc="' + key + '" data-d="-' + step + '" aria-label="' + esc(label) + ': по-малко"' + (val <= min ? " disabled" : "") + ">" + ic("minus", 20) + "</button>" +
    '<output aria-live="polite">' + val + " <small>" + unit + '</small></output><button type="button" data-inc="' + key + '" data-d="' + step + '" aria-label="' + esc(label) + ': повече"' + (val >= max ? " disabled" : "") + ">" + ic("plus", 20) + "</button></div>";
  /* an open question to the owner (docs/OPEN-QUESTIONS.md); on the screen without its number */
  const qTag = (_n?: string | number) => '<span class="sa-tag warn">' + ic("question", 16) + "Отворен въпрос</span>";
  const err = (k: string) => (errs[k] ? '<p class="err" role="alert">' + esc(errs[k]) + "</p>" : "");

  function draw() {
    if (!saved || !w || !H) return;
    const y = A.scroller ? A.scroller.scrollTop : 0, k = w.kitchen, R = H;
    root.innerHTML = (offlineNote ? offline("Няма връзка. Промените са тук и още не са запазени; опитайте пак, щом връзката се върне. Дотогава сайтът показва старите числа.") + '<div style="height:16px"></div>' : "") +
    '<div class="stg"><nav class="stg-nav" aria-label="Части"><a href="#s-kitchen">' + ic("chef-hat", 20) + 'Кухнята</a><a href="#s-res">' + ic("calendar-check", 20) + 'Резервации</a><a href="#s-celeb">' + ic("confetti", 20) + 'Празник</a><a href="#s-hours">' + ic("clock", 20) + 'Часове</a><a href="#s-masa">' + ic("bell-ringing", 20) + 'QR маса</a><a href="#s-open">' + ic("question", 20) + "Отворени въпроси</a></nav>" +
    '<div class="stg-main">' +
    /* the kitchen */
    '<section class="sa-card card" id="s-kitchen" data-edit-id="admin.settings.kitchen" aria-labelledby="h-k"><header><span class="ill">' + ic("chef-hat", 24) + '</span><div><h2 id="h-k">Кухнята и времето до клиента</h2><p>Един източник за сайта, кухнята и админа. Минутите са около времето за доставка.</p></div></header>' +
      '<label class="busy' + (k.busy ? " on" : "") + '"><span><b>' + ic("hourglass", 24) + "Натоварено" + ch("kitchen.busy") + "</b><span>" + (k.busy ? "Сега: включено" + (saved.kitchen.busy && saved.kitchen.busyAt ? " от " + hmOf(saved.kitchen.busyAt) : "") + " · около " + k.etaBusyMin + " мин. Новите поръчки са с +" + (k.etaBusyMin - k.etaMin) + " мин." : "Сега: обичаен режим · около " + k.etaMin + " мин") + "</span><span>Обикновено го включва кухнята от таблета.</span></span>" +
        '<span class="sa-switch"><input type="checkbox" role="switch" data-busy aria-label="Натоварено"' + (k.busy ? " checked" : "") + '><span class="tr"></span></span></label>' +
      '<div class="row-s"><div class="l"><b>Обичайно време' + ch("kitchen.etaMin") + "</b><span>Какво виждат гостите в сайта и в количката.</span></div>" + counter("etaMin", k.etaMin, 5, 240, 5, "мин", "Обичайно време") + err("etaMin") + "</div>" +
      '<div class="row-s"><div class="l"><b>При „Натоварено“' + ch("kitchen.etaBusyMin") + "</b><span>Поне колкото обичайното. По подразбиране +20 мин.</span></div>" + counter("etaBusyMin", k.etaBusyMin, Math.max(5, k.etaMin), 240, 5, "мин", "Време при натоварване") + err("etaBusyMin") + "</div>" +
      '<div class="row-s"><div class="prev"><span class="lab">' + (diffs().length ? "Така ще го виждат гостите след „Запази“" : "Така го виждат гостите сега") + '</span><span class="pill-st"><span class="dot' + (k.busy ? " warn" : "") + '"></span><span>Доставка до ' + esc(R.delivery) + " · <b>" + esc(custText(k, k.busy)) + "</b></span></span>" +
        '<span class="lab">' + (k.busy ? "Без „Натоварено“" : "При „Натоварено“") + '</span><span class="pill-st"><span class="dot' + (k.busy ? "" : " warn") + '"></span><span><b>' + esc(custText(k, !k.busy)) + "</b></span></span></div><span></span></div>" +
      '<p class="muted" style="margin:0;font-size:15px">Минутите по квартали (Дружба 2: около 25 мин и т.н.) засега са отделни числа в „Зони за доставка“. ' + qTag("от общата проверка") + "</p></section>" +
    /* reservations */
    '<section class="sa-card card" id="s-res" data-edit-id="admin.settings.reservations" aria-labelledby="h-r"><header><span class="ill">' + ic("calendar-check", 24) + '</span><div><h2 id="h-r">Резервации</h2><p>Колко време масата е заета и кога номерът отива за блокиране.</p></div></header>' +
      '<div class="row-s"><div class="l"><b>Колко време е масата на гостите' + ch("resMinutes") + '</b><span>Продължителност на резервацията: после масата е свободна за следващите гости.</span><span class="tags">' + qTag("18а") + "</span></div>" + counter("resMinutes", w.resMinutes, 30, 360, 30, "мин", "Колко време е масата на гостите") + err("resMinutes") + "</div>" +
      '<div class="row-s"><div class="l"><b>Блокиране след неявявания' + ch("noShowLimit") + '</b><span>Номерът чака решение на управителя; той блокира и отблокира.</span><span class="tags">' + qTag(8) + "</span></div>" + counter("noShowLimit", w.noShowLimit, 1, 5, 1, w.noShowLimit === 1 ? "път" : "пъти", "Блокиране след неявявания") + err("noShowLimit") + "</div>" +
      '<div class="row-s"><div class="l"><b>Часове за резервация</b><span>' + esc(R.reservations.from) + " - " + esc(R.reservations.to) + " през " + R.reservations.step + " мин, до " + R.reservations.daysAhead + ' дни напред. Масата е за броя места.</span><span class="tags">' + qTag(18) + '<span class="sa-tag">Само за четене</span></span></div><span></span></div></section>' +
    /* celebration */
    '<section class="sa-card card" id="s-celeb" data-edit-id="admin.settings.celebration" aria-labelledby="h-c"><header><span class="ill">' + ic("confetti", 24) + '</span><div><h2 id="h-c">Празник при нас</h2><p>Какво показва калкулаторът на празник в сайта.</p></div></header>' +
      '<div class="row-s" style="grid-template-columns:minmax(0,1fr)"><div class="l"><b>Цена в калкулатора' + ch("celebrationPrice") + "</b><span>" + (w.celebrationPrice === "offer" ? "Гостът вижда „Ще ви изпратим оферта“, без сума." : "Гостът вижда ориентировъчна цена; точната е в офертата.") + '</span><span class="tags">' + qTag(3) + "</span></div>" +
        '<div class="seg2" role="group" aria-label="Цена в калкулатора"><button type="button" data-cp="offer" aria-pressed="' + (w.celebrationPrice === "offer") + '">Само оферта</button><button type="button" data-cp="estimate" aria-pressed="' + (w.celebrationPrice === "estimate") + '">Ориентировъчна цена</button></div>' + err("celebrationPrice") + "</div>" +
      '<div class="row-s"><div class="l"><b>-5% за ранна резервация' + ch("earlyDays") + "</b><span>" + (w.earlyDays == null ? "Изключено: колко дни по-рано е „ранна“ " + missing("брой дни") + ". Без числото -5% не се дава." : w.earlyDays ? "Празник, запазен поне " + plural(w.earlyDays, "ден", "дни") + " по-рано, получава -5%. Само за празник, не за тематични вечери." : "Напишете броя дни. Дотогава -5% не се дава.") + '</span><span class="tags">' + qTag(13) + "</span></div>" +
        '<label class="sa-switch"><input type="checkbox" role="switch" data-early aria-label="-5% за ранна резервация"' + (w.earlyDays != null ? " checked" : "") + '><span class="tr"></span></label>' +
        (w.earlyDays != null ? '<div class="field" style="grid-column:1/-1"><label for="ed">Колко дни по-рано</label><input class="input days-in" id="ed" type="number" inputmode="numeric" min="1" max="365" value="' + (w.earlyDays || "") + '" aria-describedby="edh"><span class="help" id="edh">От 1 до 365.</span></div>' : "") + err("earlyDays") + "</div></section>" +
    /* hours */
    '<section class="sa-card card" id="s-hours" data-edit-id="admin.settings.hours" aria-labelledby="h-h"><header><span class="ill">' + ic("clock", 24) + '</span><div><h2 id="h-h">Часове</h2><p>Правилата на поръчките са в ядрото. Смяната от тук: ' + soonTag() + "</p></div></header>" +
      '<div class="hrs"><div><b>' + esc(R.open) + " - " + esc(R.close) + "</b><span>Ресторантът</span></div><div><b>до " + esc(R.kitchen) + "</b><span>Кухнята приема поръчки</span></div><div><b>до " + esc(R.delivery) + "</b><span>Доставка</span></div><div><b>до " + esc(R.lunchUntil) + "</b><span>Обедно меню</span></div></div>" +
      '<p class="muted" style="margin:0;font-size:15px">След ' + esc(R.lunchUntil) + " обедното меню е само за вземане от място, с -30%. Между " + esc(R.delivery) + " и " + esc(R.kitchen) + ": „Доставката приключи за днес · Вземане до " + esc(R.kitchen) + "“. Празнични дни: " + missing("работно време в празнични дни") + ".</p></section>" +
    /* QR table */
    '<section class="sa-card card" id="s-masa" data-edit-id="admin.settings.masa" aria-labelledby="h-m"><header><span class="ill">' + ic("bell-ringing", 24) + '</span><div><h2 id="h-m">QR маса и сервитьори</h2><p>Повикванията от масата. Заглушаване на маса няма. Важат, щом QR масата заработи.</p></div></header>' +
      '<div class="row-s"><div class="l"><b>Между две еднакви повиквания' + ch("callCooldown") + '</b><span>Една маса не вика по-често за същото.</span><span class="tags">' + qTag("QR 1") + "</span></div>" + counter("callCooldown", w.callCooldown, 1, 15, 1, "мин", "Между две повиквания") + err("callCooldown") + "</div>" +
      '<div class="row-s"><div class="l"><b>Към управителя след' + ch("callManager") + '</b><span>Ако никой не поеме повикването.</span><span class="tags">' + qTag("QR 1") + "</span></div>" + counter("callManager", w.callManager, 1, 30, 1, "мин", "Към управителя след") + err("callManager") + "</div></section>" +
    /* open questions */
    '<section class="sa-card card" id="s-open" data-edit-id="admin.settings.open" aria-labelledby="h-o"><header><span class="ill">' + ic("question", 24) + '</span><div><h2 id="h-o">Отворени въпроси, които стават настройки</h2><p>Докато собственикът не реши, системата прави варианта по подразбиране.</p></div></header>' +
      '<div class="oq">' + ([["2", "Депозит за резервации и празници", "Няма"], ["7", "Права на управителя", "Като собственика без финанси, роли и дневник"], ["16", "Ваучери: валидност; комбинират ли се отстъпките", "Не се комбинират; валидност " + missing("срок")], ["17а", "Горна граница на една онлайн поръчка", "60 порции и 500 €"], ["23", "„Изчерпано днес“", "Нулира се в полунощ по София"], ["Кухня 15", "Кой включва „Натоварено“", "Всяка секция, с напомняне след 60 мин"]] as [string, string, string][])
        .map((x) => "<div><p>" + x[1] + "</p><b>" + (x[2].includes("ЛИПСВА") ? x[2] : esc(x[2])) + "</b></div>").join("") + "</div></section>" +
    "</div></div>";
    if (A.scroller) A.scroller.scrollTop = y;
    syncBar(); markNav();
  }

  /* ---------- the save bar (the frame's .sa-pbar: the toast and the round "Молив" go up by themselves) ---------- */
  A.col!.insertAdjacentHTML("beforeend", '<div class="sa-pbar st-bar" role="region" aria-label="Незапазени промени"><span class="n" data-n aria-live="polite"></span><button class="pill pill-line" type="button" data-cancel><span class="lg">Откажи промените</span><span class="sm">Откажи</span></button><button class="pill pill-red" type="button" data-save>' + ic("check", 20) + '<span class="lg">Запази</span><span class="sm">Запази</span></button></div>');
  const bar = A.col!.querySelector<HTMLElement>(".st-bar")!;
  function syncBar() {
    const d = diffs(); bar.classList.toggle("on", d.length > 0);
    bar.querySelector("[data-n]")!.innerHTML = d.length ? plural(d.length, "промяна", "промени") + '<small class="lg">' + (offlineNote ? "Още не са запазени: няма връзка" : "Още не са запазени") + "</small>" : "";
    bar.querySelector<HTMLButtonElement>("[data-save]")!.disabled = saving;
  }
  function validate(): boolean {
    errs = {}; if (!w) return false; const k = w.kitchen;
    if (!(k.etaMin >= 5 && k.etaMin <= 240)) errs.etaMin = "Минутите са цяло число от 5 до 240.";
    if (!(k.etaBusyMin >= 5 && k.etaBusyMin <= 240) || k.etaBusyMin < k.etaMin) errs.etaBusyMin = "Минутите при натоварване са поне колкото обичайните.";
    if (w.resMinutes < 30 || w.resMinutes > 360 || w.resMinutes % 30) errs.resMinutes = "Продължителността е от 30 до 360 минути, през 30.";
    if (w.earlyDays === 0) errs.earlyDays = "Напишете колко дни по-рано (от 1 до 365) или изключете -5%.";
    else if (w.earlyDays !== null && !(Number.isInteger(w.earlyDays) && w.earlyDays >= 1 && w.earlyDays <= 365)) errs.earlyDays = "Дните са цяло число от 1 до 365.";
    return !Object.keys(errs).length;
  }
  /* the left navigation: the current part by the scroll */
  function markNav() {
    const secs = root.querySelectorAll<HTMLElement>(".stg-main > section"); let cur: string | null = null;
    secs.forEach((sc) => { if (sc.getBoundingClientRect().top < 200) cur = sc.id; }); if (!cur && secs[0]) cur = secs[0].id;
    root.querySelectorAll(".stg-nav a").forEach((a) => { if (a.getAttribute("href") === "#" + cur) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
  }
  (A.scroller || window).addEventListener("scroll", markNav, { passive: true });

  async function apply(p: SettingsPatch): Promise<Settings> { return adminApi.setSettings(p); }
  async function save(): Promise<boolean> {
    if (!saved || !w || saving) return false;
    if (!validate()) { draw(); root.querySelector(".err")?.scrollIntoView({ block: "center" }); return false; }
    const d = diffs(); if (!d.length) return true;
    const p = patchOf(saved, w), back = patchOf(w, saved);
    saving = true; syncBar();
    try {
      const s = await apply(p);
      saving = false; offlineNote = false; saved = pick(s); w = clone(saved); errs = {}; draw();
      toast("Настройките са запазени · " + plural(d.length, "промяна", "промени") + ". Сайтът и новите поръчки ги ползват оттук нататък.", { undo: async () => {
        try { const s2 = await apply(back); saved = pick(s2); w = clone(saved); draw(); toast("Върнати са предишните настройки"); }
        catch (e) { toast(isOffline(e) ? "Няма връзка. Настройките не са върнати." : "Не успяхме да върнем настройките."); }
      } });
      return true;
    } catch (e) {
      saving = false;
      if (e instanceof ApiError && e.status === 401) { location.replace(aurl.login(aurl.here())); return false; }
      offlineNote = isOffline(e);
      const f = e instanceof ApiError ? e.fields || {} : {};
      errs = { ...f }; draw();
      if (Object.keys(f).length) root.querySelector(".err")?.scrollIntoView({ block: "center" });
      else toast(offlineNote ? "Няма връзка. Промените не са запазени; опитайте пак." : e instanceof ApiError ? e.message : "Не успяхме да запазим. Опитайте пак.");
      return false;
    }
  }

  /* ---------- events ---------- */
  root.addEventListener("click", async (e) => {
    const t = e.target as Element; let el: HTMLElement | null;
    if (t.closest('[data-sa="retry"]')) { e.stopPropagation(); if (saved) { offlineNote = false; draw(); return; } root.innerHTML = skel(5, "Зареждаме настройките …"); if (await load()) draw(); return; }
    const a = t.closest<HTMLAnchorElement>(".stg-nav a");
    if (a) { e.preventDefault(); root.querySelector(a.getAttribute("href")!)?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" }); return; }
    if (!w) return;
    if ((el = t.closest<HTMLElement>("[data-inc]"))) {
      const key = el.dataset.inc!, d = +el.dataset.d!, m = LIMITS[key], o = (m[0] ? (w as unknown as Record<string, Record<string, number>>)[m[0]] : (w as unknown as Record<string, number>)) as Record<string, number>;
      o[m[1]] = Math.max(key === "etaBusyMin" ? Math.max(m[2], w.kitchen.etaMin) : m[2], Math.min(m[3], o[m[1]] + d));
      if (key === "etaMin" && w.kitchen.etaBusyMin < w.kitchen.etaMin) w.kitchen.etaBusyMin = w.kitchen.etaMin;
      validate(); draw();
      const b = root.querySelector<HTMLButtonElement>('[data-inc="' + key + '"][data-d="' + el.dataset.d + '"]');
      (b && !b.disabled ? b : root.querySelector<HTMLButtonElement>('[data-inc="' + key + '"]:not([disabled])'))?.focus({ preventScroll: true });
      return;
    }
    if ((el = t.closest<HTMLElement>("[data-cp]"))) { w.celebrationPrice = el.dataset.cp as Settings["celebrationPrice"]; draw(); root.querySelector<HTMLElement>('[data-cp="' + w.celebrationPrice + '"]')?.focus({ preventScroll: true }); }
  });
  root.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement; if (!w || !saved) return;
    if (t.matches("[data-busy]")) { w.kitchen.busy = t.checked; w.kitchen.busyAt = t.checked ? saved.kitchen.busyAt : null; if (saved.kitchen.busy === t.checked) w.kitchen.busyAt = saved.kitchen.busyAt; draw(); root.querySelector<HTMLElement>("[data-busy]")?.focus({ preventScroll: true }); return; }
    if (t.matches("[data-early]")) { w.earlyDays = t.checked ? saved.earlyDays || 0 : null; validate(); draw(); const ed = root.querySelector<HTMLInputElement>("#ed"); if (ed) ed.focus(); return; }
    if (t.id === "ed") { w.earlyDays = t.value === "" ? 0 : Math.round(+t.value); validate(); draw(); }
  });
  bar.querySelector<HTMLButtonElement>("[data-cancel]")!.onclick = () => { if (!saved) return; w = clone(saved); errs = {}; draw(); toast("Промените са отказани"); };
  bar.querySelector<HTMLButtonElement>("[data-save]")!.onclick = () => { save(); };
  /* "Натоварено" from the kitchen, live: taken over when nothing is waiting here */
  api.on("settings", async () => { if (diffs().length || saving) return; if (await load()) draw(); });
  /* unsaved changes: ask before leaving */
  window.addEventListener("beforeunload", (e) => { if (diffs().length) { e.preventDefault(); e.returnValue = ""; } });
  document.addEventListener("click", (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (!a || !diffs().length || a.target === "_blank" || (a.getAttribute("href") || "").charAt(0) === "#" || e.ctrlKey || e.metaKey) return;
    e.preventDefault(); const n = diffs().length, href = a.href;
    const sh = sheet({ title: "Незапазени промени", html: '<p style="margin:0">Имате ' + plural(n, "незапазена промяна", "незапазени промени") + " в настройките. Да ги запазим, преди да продължите?</p>",
      foot: '<button class="pill pill-line pill-lg" type="button" data-leave>Не запазвай</button><button class="pill pill-red pill-lg" type="button" data-keep>' + ic("check", 22) + "Запази и продължи</button>" });
    sh.foot!.querySelector<HTMLButtonElement>("[data-leave]")!.onclick = () => { if (saved) w = clone(saved); location.href = href; };
    sh.foot!.querySelector<HTMLButtonElement>("[data-keep]")!.onclick = async () => { sh.close(); if (await save()) location.href = href; };
  }, true);

  root.innerHTML = skel(5, "Зареждаме настройките …");
  if (await load()) draw();
}
