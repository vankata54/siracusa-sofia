/* Profile (/profil/): port of design/pages/profile.html for the real signed-in customer.
   Data and actions only through api.auth.* (server or demo core, same codes and texts):
     me -> who is signed in (null -> invitation to sign in, /vhod/), orders -> "Поръчки" with "Поръчай отново",
     update -> name, email, consents (marketing is false until the customer turns it on), toggleFav -> "Любими",
     export -> "Изтегли данните ми" (JSON), remove -> "Изтрий профила" (confirmed in the page), logout -> "Изход".
   "Поръчай отново" puts the dishes into the cart through SC.cart with the CURRENT menu prices; a dish that is sold out
   today, gone from the menu or from another day's lunch menu is not added (and is shown as such).
     addresses / addAddress / removeAddress -> "Адреси", codes -> "Моите кодове" (from the ratings), update({notify}) -> "Известия".
   Still [ЛИПСВА]: the stamp rule and reward, how notifications are sent (no SMS provider yet), English. */
import { SC } from "../../client/sc-menu.ts";
import { api, ApiError } from "../../client/api.ts";
import type { Customer, Order } from "../../client/api-types.ts";
import type { CustomerView } from "../../client/api.ts";
import type { Dish } from "../../lib/data.ts";
import { inviteHTML, orderSkel } from "./_views.ts";
/* the icons this script draws, in one module (scripts/icon-groups.mjs) */
import "sc-icons:user,sign-in,sign-out,receipt,heart,map-pin,ticket,bell,shield-check,sliders-horizontal,lock,house,briefcase,truck,warning-circle,warning,check-circle,info,arrow-right,arrow-clockwise,pencil-simple,fork-knife,gift,cake,caret-down,export,trash,flag,timer,copy,plus";

type Notify = { order: boolean; reservation: boolean };
type Code = { code: string; pct: number; orderNo: string; used: boolean; usedBy: string | null; createdAt: string };
const SECTIONS: [string, string, string][] = [
  ["porachki", "Поръчки", "receipt"], ["lyubimi", "Любими", "heart"], ["adresi", "Адреси", "map-pin"], ["nagradi", "Печати и купони", "ticket"],
  ["izvestia", "Известия", "bell"], ["saglasia", "Съгласия", "shield-check"], ["nastroyki", "Настройки", "sliders-horizontal"], ["danni", "Вашите данни", "lock"],
];
const LIVE: Record<string, string> = { accepted: "Приета", cooking: "Готви се", ready: "Готова", on_way: "На път" };
const STAMPS_MAX = 10; /* "наградата при 10" (design/BRIEF.md 8); the rule and the reward are [ЛИПСВА] */

export function start(): void {
  const { esc, fmt, ic } = SC;
  const main = SC.mount();
  const smooth = (): ScrollBehavior => (SC.reduce ? "auto" : "smooth");
  const pretty = (p: string) => { const d = String(p || ""); return /^0\d{9}$/.test(d) ? d.slice(0, 4) + " " + d.slice(4, 6) + " " + d.slice(6, 8) + " " + d.slice(8) : d; };

  let U: Customer | null = null;
  /* the unused -10% with a profile, as the core says (me().profileBonus; update() returns it too); never promised otherwise */
  let BONUS = false;
  const take = (c: Customer | CustomerView) => { if ("profileBonus" in c) BONUS = c.profileBonus === true; return c; };
  let ORD: Order[] | null = null;
  let OFF = false; /* preview: simulate no connection */
  const offline = () => { if (OFF || navigator.onLine === false) { SC.toast("Няма връзка. Опитайте пак."); return true; } return false; };
  const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Нещо се обърка. Опитайте пак.");

  /* notifications live in the profile (core: all off by default) */
  const notify = (): Notify => ({ order: U?.notify?.order === true, reservation: (U?.notify as Partial<Notify> | undefined)?.reservation === true });
  let CODES: Code[] | null = null; /* "Моите кодове" from api.auth.codes() */

  /* ---------- small builders ---------- */
  const kindOf = (label: string): [string, string] => (/вкъщи|дом/i.test(label) ? [label, "house"] : /работа|офис/i.test(label) ? [label, "briefcase"] : [label || "Адрес", "map-pin"]);
  const zoneOf = (n: string) => SC.ZONES.find((z) => z.n === n);
  function zoneLine(n: string) {
    const z = zoneOf(n);
    if (!z) return { cls: "no", icon: "warning-circle", html: "Не доставяме до този адрес. Можете да я вземете от ресторанта." };
    if (z.free) return { cls: "ok", icon: "truck", html: 'Безплатна доставка · <span style="white-space:nowrap">' + esc(z.eta) + "</span>" };
    return { cls: "tar", icon: "truck", html: 'Доставка по тарифа <span class="missing">[ЛИПСВА: такса]</span> · <span style="white-space:nowrap">' + esc(z.eta) + "</span>" };
  }
  const sw = (key: string, title: string, sub: string, on: boolean) =>
    '<button class="psw" type="button" role="switch" aria-checked="' + on + '" data-sw="' + key + '"><span class="tx"><b>' + title + '</b><span class="s">' + sub + '</span></span><span class="tg" aria-hidden="true"><span class="tr"><span class="kn"></span></span><span class="st2">' + (on ? "Включено" : "Изключено") + "</span></span></button>";
  const cpsCount = () => (BONUS ? 1 : 0) + (CODES ? CODES.filter((c) => !c.used).length : 0) + (U && U.consent.birthday && U.email ? 1 : 0);

  /* an order's lines against TODAY's menu: what can go into the cart again, at today's prices */
  type Part = { l: Order["lines"][number]; x: Dish | undefined; why: "" | "out" | "gone" | "lunch" };
  function parts(o: Order) {
    const all: Part[] = o.lines.map((l) => {
      const x = SC.byId[l.id] as Dish | undefined;
      const why: Part["why"] = !x ? "gone" : (x.lunch || x.cat === "obedno") && !SC.lunchIsToday() ? "lunch" : SC.isOut(x) ? "out" : "";
      return { l, x, why };
    });
    const ok = all.filter((p) => !p.why);
    const sum = ok.reduce((a, p) => a + (p.x!.p + (p.l.extra || 0)) * p.l.q, 0);
    return { all, ok, bad: all.filter((p) => p.why), sum: Math.round(sum * 100) / 100 };
  }
  const count = (ps: Part[]) => ps.reduce((a, p) => a + p.l.q, 0);

  /* ---------- views ---------- */
  function renderInvite() {
    U = null; ORD = null;
    delete document.documentElement.dataset.pfSigned;
    main.innerHTML = inviteHTML() + protoHTML();
    SC.reveal();
  }

  function renderLoadError(msg: string) {
    main.innerHTML = '<section class="gone"><div class="card empty" role="alert" style="padding:40px 20px"><span class="ill">' + ic("warning-circle", 44) + "</span>" +
      '<h1 class="h2">Не успяхме да отворим профила</h1><p class="muted" style="margin:0;max-width:30em">' + esc(msg) + " Нищо не е изгубено.</p>" +
      '<button class="pill pill-red pill-lg" type="button" data-reload>' + ic("arrow-clockwise", 20) + "Опитай пак</button></div></section>" + protoHTML();
  }

  function renderProfile() {
    const u = U!;
    const aside = '<nav class="pf-aside" aria-label="Раздели на профила">' + SECTIONS.map((s) => '<a href="#' + s[0] + '" data-spy="' + s[0] + '" aria-current="' + (s[0] === "porachki") + '">' + ic(s[2], 20) + s[1] + "</a>").join("") +
      '<hr><button type="button" data-logout>' + ic("sign-out", 20) + "Изход</button></nav>";
    const head = '<header class="ph"><span class="av" aria-hidden="true">' + esc((u.name || "?").trim().charAt(0).toUpperCase() || "?") + '</span><div class="who"><p class="pf-eyebrow">Вашият профил</p><h1 class="h1" data-hello>' + hello() + '</h1><p class="tel">' + esc(pretty(u.phone)) + "</p></div></header>" +
      '<nav class="tiles" aria-label="Бързо към">' + tilesHTML() + "</nav>";
    const st = SC.state() as { kitchen?: boolean };
    const orders = '<section class="ps" id="porachki" aria-labelledby="h-ord"><div class="sec-h"><h2 class="h2" id="h-ord">Поръчки</h2></div>' +
      (st.kitchen ? "" : '<p class="pf-closed">' + ic("clock", 20) + "<span><b>Кухнята приема поръчки до 22:30.</b> Добавете в количката и поръчайте за утре.</span></p>") +
      '<div class="olist" data-orders aria-busy="true">' + orderSkel() + orderSkel() + "</div></section>";
    const favs = '<section class="ps" id="lyubimi" aria-labelledby="h-fav"><div class="sec-h"><h2 class="h2" id="h-fav">Любими</h2><button class="link" type="button" data-favedit' + (u.favs.length ? "" : " hidden") + ">" + ic("pencil-simple", 18) + 'Промени</button></div><div data-favs>' + favsHTML() + "</div></section>";
    const adrs = '<section class="ps" id="adresi" aria-labelledby="h-adr"><div class="sec-h"><h2 class="h2" id="h-adr" tabindex="-1">Адреси</h2></div><div data-adrs>' + adrsHTML() + "</div></section>";
    const rew = '<section class="ps" id="nagradi" aria-labelledby="h-rew"><div class="sec-h"><h2 class="h2" id="h-rew">Печати и купони</h2></div><div class="rew">' + loyalHTML() + '<div class="cps" data-cps>' + couponsHTML() + "</div></div></section>";
    const n = notify();
    const notifs = '<section class="ps" id="izvestia" aria-labelledby="h-not"><div class="sec-h"><h2 class="h2" id="h-not">Известия</h2></div><div class="card pbox">' +
      sw("notify.order", "Статус на поръчката", "Кога е приета, готова и на път.", n.order) +
      sw("notify.reservation", "Напомняне за резервация", "Ден преди и 3 часа преди резервацията.", n.reservation) + "</div>" +
      '<p class="pf-help">Изборът се пази в профила ви. <span class="missing">[ЛИПСВА: как се изпращат (SMS или имейл)]</span></p></section>';
    const cons = '<section class="ps" id="saglasia" aria-labelledby="h-con"><div class="sec-h"><h2 class="h2" id="h-con">Съгласия</h2></div><div class="card pbox" data-cons>' + consHTML() + "</div>" +
      '<p class="legal">Можете да оттеглите съгласие по всяко време, със същото докосване. <a href="' + SC.url.page("privacy") + '">Политика за поверителност</a></p></section>';
    const sets = '<section class="ps" id="nastroyki" aria-labelledby="h-set"><div class="sec-h"><h2 class="h2" id="h-set">Настройки</h2></div><div class="card pbox" data-sets>' + setsHTML() + "</div></section>";
    const data = '<section class="ps" id="danni" aria-labelledby="h-dat"><div class="sec-h"><h2 class="h2" id="h-dat">Вашите данни</h2></div><div class="card dbox">' +
      '<p class="muted">Вие решавате какво пазим. Можете да изтеглите всичко за вас или да изтриете профила.</p>' +
      '<button class="pill pill-line pill-block" type="button" data-export>' + ic("export", 20) + "Изтегли данните ми</button>" +
      '<div data-del><button class="pill pill-dline pill-block" type="button" data-delask>' + ic("trash", 20) + "Изтрий профила</button></div></div>" +
      '<button class="pill pill-soft pill-lg pill-block out-btn" type="button" data-logout>' + ic("sign-out", 20) + "Изход от профила</button></section>";
    main.innerHTML = '<div class="pf">' + aside + '<div class="pm">' + head + orders + favs + adrs + rew + '<div class="duo">' + notifs + cons + '</div><div class="duo">' + sets + data + "</div></div></div>" + protoHTML();
    loadOrders(); loadCodes();
    SC.reveal(); spy();
  }

  const hello = () => "Здравейте" + (U && U.name ? ", " + esc(U.name) : "");
  function tilesHTML() {
    const n = ORD ? ORD.length : null, c = cpsCount(), s = Math.min(U!.stamps || 0, STAMPS_MAX);
    return '<a href="#porachki">' + ic("receipt", 22) + "<b data-nord>" + (n == null ? "-" : n) + '</b><span class="w">' + (n === 1 ? "поръчка" : "поръчки") + "</span></a>" +
      '<a href="#nagradi">' + ic("fire", 22) + "<b>" + s + "<small> от " + STAMPS_MAX + '</small></b><span class="w">печата</span></a>' +
      '<a href="#nagradi"' + (c ? ' class="em"' : "") + ">" + ic("ticket", 22) + "<b>" + c + '</b><span class="w">' + (c === 1 ? "купон" : "купона") + "</span></a>";
  }
  function refreshTiles() { const t = main.querySelector(".tiles"); if (t) t.innerHTML = tilesHTML(); }

  /* ---------- orders ---------- */
  async function loadOrders(fail = false) {
    const box = main.querySelector<HTMLElement>("[data-orders]");
    if (!box) return;
    box.setAttribute("aria-busy", "true"); box.style.display = ""; box.innerHTML = orderSkel() + orderSkel();
    try {
      if (fail) throw new ApiError("offline", "Връзката прекъсна за момент.", 0);
      ORD = await api.auth.orders();
    } catch (e) {
      if (!box.isConnected) return;
      box.removeAttribute("aria-busy"); box.style.display = "block";
      box.innerHTML = '<div class="card empty" role="alert"><span class="ill">' + ic("warning-circle", 44) + '</span><h3 class="h3">Не успяхме да заредим поръчките</h3><p class="muted" style="margin:0;max-width:30em">' + esc(errText(e)) + " Нищо не е изгубено, опитайте пак.</p>" +
        '<button class="pill pill-red" type="button" data-retry>' + ic("arrow-clockwise", 20) + "Опитай пак</button></div>";
      return;
    }
    if (!box.isConnected) return;
    box.removeAttribute("aria-busy"); refreshTiles();
    if (!ORD.length) {
      box.style.display = "block";
      box.innerHTML = '<div class="card empty"><span class="ill">' + ic("receipt", 44) + '</span><h3 class="h3">Още нямате поръчки</h3><p class="muted" style="margin:0;max-width:30em">Първата ще се появи тук и после ще я поръчвате отново с едно докосване.</p><a class="pill pill-red" href="' + SC.url.menu() + '">' + ic("fork-knife", 20) + "Към менюто</a></div>";
      return;
    }
    box.innerHTML = ORD.map(orderHTML).join("");
  }

  function orderHTML(o: Order, i: number) {
    const P = parts(o), n = count(P.ok);
    const pics = o.lines.slice(0, 3).map((l) => SC.pic(l.id)).join("");
    const live = LIVE[o.status], when = o.ts ? SC.dateLong(new Date(o.ts)) : "";
    const st = live ? '<span class="st live">' + ic("timer", 18) + live + "</span>"
      : o.status === "cancelled" ? '<span class="st no">' + ic("x", 18) + "Отказана</span>"
      : '<span class="st">' + ic("check-circle", 18) + (o.mode === "pickup" ? "Взета" : "Доставена") + "</span>";
    const why = { out: "Изчерпано днес", gone: "Вече не е в менюто", lunch: "От обедното меню за друг ден", "": "" };
    const lines = P.all.map((p) => {
      const name = p.x ? p.x.n : p.l.name || "Ястие";
      const unit = p.x ? p.x.p + (p.l.extra || 0) : p.l.unit;
      const mods = p.l.mods && p.l.mods.length ? "<small>" + esc(p.l.mods.join(", ")) + "</small>" : "";
      return "<li" + (p.why ? ' class="out"' : "") + '><span class="q">' + p.l.q + ' ×</span><span class="n">' + esc(name) + mods +
        (p.why === "out" ? "<br>" + SC.badges({ t: ["out"] } as unknown as Dish) : p.why ? "<small>" + why[p.why] + "</small>" : "") +
        '</span><span class="price">' + (unit != null ? fmt(unit * p.l.q) : "") + "</span></li>";
    }).join("");
    const note = P.bad.length && P.ok.length
      ? '<p class="note">' + ic("info", 18) + "<span>" + P.bad.map((p) => esc(p.x ? p.x.n : p.l.name || "Ястие")).join(", ") + (P.bad.length > 1 ? " ги няма" : " го няма") + " днес. Добавяме останалите " + SC.plural(n, "ястие", "ястия") + ".</span></p>"
      : P.bad.length ? '<p class="note">' + ic("info", 18) + "<span>Днес няма нито едно от тези ястия. Вижте менюто.</span></p>" : "";
    const btn = P.ok.length
      ? '<button class="pill ' + (i === 0 ? "pill-red pill-lg" : "pill-line") + ' pill-block" type="button" data-re="' + esc(o.no) + '">' + ic("arrow-right", 20) + '<span>Поръчай отново · <span class="price">' + fmt(P.sum) + "</span></span></button>"
      : '<a class="pill pill-line pill-block" href="' + SC.url.menu() + '">' + ic("fork-knife", 20) + "Към менюто</a>";
    return '<article class="card ord" aria-labelledby="o' + esc(o.no) + '">' +
      '<div class="ord-h"><span class="ord-pics" aria-hidden="true">' + pics + '</span><span class="ord-meta"><b id="o' + esc(o.no) + '">Поръчка №&nbsp;' + esc(o.no) + '</b><span class="d">' + esc(when) + (when ? " · " : "") + (o.mode === "pickup" ? "Вземане" : "Доставка") + " · " + fmt(o.total).replace(" €", "&nbsp;€") + "</span>" + st + "</span></div>" +
      '<ul class="ord-l">' + lines + "</ul>" + note +
      '<div class="acts">' + btn +
      (live ? '<a class="link" href="' + SC.url.tracking({ no: o.no, key: o.key }) + '">Проследи поръчката' + ic("caret-right", 18) + "</a>" : "") +
      '<a class="link" href="' + SC.url.cart() + '" data-gocart hidden>Към количката' + ic("caret-right", 18) + "</a></div></article>";
  }

  function reorder(no: string, btn: HTMLElement) {
    const o = ORD && ORD.find((x) => String(x.no) === no);
    if (!o) return;
    const P = parts(o);
    if (!P.ok.length || offline()) return;
    const snap = JSON.parse(JSON.stringify(SC.cart.lines()));
    P.ok.forEach((p) => SC.cart.add(p.l.id, p.l.q, { mods: p.l.mods || [], extra: p.l.extra || 0, p: p.x!.p, n: p.x!.n }));
    SC.fly(btn, P.ok[0].l.id); SC.haptic(); SC.flash(btn, ic("check", 20) + "Добавено в количката", 1800);
    const go = btn.parentElement?.querySelector<HTMLElement>("[data-gocart]");
    if (go) go.hidden = false;
    SC.toast("Добавихме " + SC.plural(count(P.ok), "ястие", "ястия"), () => { SC.cart.clear(); snap.forEach((l: Parameters<typeof SC.cart.restore>[0]) => SC.cart.restore(l)); if (go) go.hidden = true; });
  }

  /* ---------- favourites ---------- */
  function favsHTML() {
    const list = U!.favs.map((id) => SC.byId[id]).filter(Boolean) as Dish[];
    if (!list.length) return '<div class="card empty"><span class="ill">' + ic("heart", 44) + '</span><h3 class="h3">Още нямате любими</h3><p class="muted" style="margin:0;max-width:30em">Докоснете сърцето на страницата на ястие и то ще чака тук.</p><a class="pill pill-line" href="' + SC.url.menu() + '">' + ic("fork-knife", 20) + "Разгледай менюто</a></div>";
    return '<div class="rail favs">' + list.map((x) => SC.dishCard(x).replace(/<\/div>$/, '<button class="pill fx" type="button" data-unfav="' + esc(x.id) + '" aria-label="Махни ' + esc(x.n) + ' от любими">' + ic("x", 18) + "Махни</button></div>")).join("") + "</div>";
  }
  function redrawFavs(editing: boolean) {
    const box = main.querySelector("[data-favs]"); if (!box) return;
    box.innerHTML = favsHTML();
    const fv = main.querySelector(".favs"), eb = main.querySelector<HTMLElement>("[data-favedit]");
    if (fv && editing) fv.classList.add("editing");
    if (eb) { eb.hidden = !U!.favs.length; eb.innerHTML = editing && U!.favs.length ? ic("check", 18) + "Готово" : ic("pencil-simple", 18) + "Промени"; }
  }
  async function unfav(id: string) {
    if (offline()) return;
    const name = SC.byId[id] ? SC.byId[id].n : "ястието";
    try { U = await api.auth.toggleFav(id); } catch (e) { SC.toast(errText(e)); return; }
    redrawFavs(true);
    SC.toast("Махнахме " + name + " от любими", async () => {
      try { if (!U!.favs.includes(id)) U = await api.auth.toggleFav(id); redrawFavs(true); } catch (e) { SC.toast(errText(e)); }
    });
  }

  /* ---------- addresses (api.auth.addAddress / removeAddress) ---------- */
  const KINDS: [string, string][] = [["Вкъщи", "house"], ["Работа", "briefcase"], ["Друго", "map-pin"]];
  function adrsHTML() {
    const a = U!.addrs;
    const list = a.length
      ? '<div class="card alist">' + a.map((x) => {
          const k = kindOf(x.label), z = zoneLine(x.zone);
          return '<div class="adr"><span class="i">' + ic(k[1], 22) + '</span><span><span class="top2"><b>' + esc(k[0]) + '</b><button class="link" type="button" data-adrdel="' + esc(x.id) + '" aria-label="Махни адрес ' + esc(k[0]) + '">' + ic("trash", 18) + "Махни</button></span>" +
            '<span class="l">' + esc(x.addr || x.zone || "") + '</span><span class="z ' + z.cls + '">' + ic(z.icon, 18) + "<span>" + z.html + "</span></span></span></div>";
        }).join("") + "</div>"
      : '<div class="card empty"><span class="ill">' + ic("map-pin", 44) + '</span><h3 class="h3">Няма запазени адреси</h3><p class="muted" style="margin:0;max-width:30em">Добавете адрес веднъж и при поръчка само го изберете.</p></div>';
    return list + '<button class="pill pill-line pill-block addbtn" type="button" data-adradd>' + ic("plus", 20) + "Добави адрес</button>";
  }
  const adrHead = () => main.querySelector<HTMLElement>("#h-adr");
  const focusAdrs = () => adrHead()?.focus({ preventScroll: true });
  const redrawAdrs = () => { const b = main.querySelector("[data-adrs]"); if (b) b.innerHTML = adrsHTML(); };
  function adrSheet() {
    const zones = SC.ZONES.map((z) => z.n).concat(["Друг квартал"]);
    let kind = U!.addrs.some((x) => x.label === "Вкъщи") ? "Работа" : "Вкъщи";
    const s = SC.sheet({ title: "Нов адрес", returnTo: () => main.querySelector(".adr:last-child [data-adrdel]") || adrHead(), html:
      '<form class="sform" novalidate>' +
      '<div class="field" role="group" aria-labelledby="ak-l"><span class="label" id="ak-l">Какъв е адресът</span><div class="seg" data-kind>' + KINDS.map((k) => '<button type="button" data-k="' + k[0] + '" aria-pressed="' + (k[0] === kind) + '">' + ic(k[1], 20) + k[0] + "</button>").join("") + "</div></div>" +
      '<div class="field"><label for="a-z">Квартал</label><div class="selw"><select class="input" id="a-z">' + zones.map((z) => "<option>" + esc(z) + "</option>").join("") + "</select>" + ic("caret-down", 20) + '</div><div class="zres" data-zres aria-live="polite"></div></div>' +
      '<div class="field"><label for="a-l">Улица и номер или блок, вход, етаж</label><input class="input" id="a-l" autocomplete="street-address" placeholder="например бл. 311, вх. Б, ет. 4" aria-describedby="a-l-err"><p class="pf-err" id="a-l-err" hidden></p></div>' +
      '<button class="pill pill-red pill-lg pill-block" type="submit">' + ic("check", 20) + "Запази адреса</button></form>" });
    const f = s.el.querySelector("form")!, zs = f.querySelector<HTMLSelectElement>("#a-z")!, zr = f.querySelector<HTMLElement>("[data-zres]")!;
    const zupd = () => { const z = zoneLine(zs.value); zr.className = "zres " + z.cls; zr.innerHTML = ic(z.icon, 20) + "<span>" + z.html + "</span>"; };
    zs.addEventListener("change", zupd); zupd();
    f.querySelector("[data-kind]")!.addEventListener("click", (e) => { const b = (e.target as Element).closest<HTMLElement>("[data-k]"); if (!b) return; kind = b.dataset.k!; f.querySelectorAll("[data-k]").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (offline()) return;
      const l = f.querySelector<HTMLInputElement>("#a-l")!, er = f.querySelector<HTMLElement>("#a-l-err")!;
      if (!l.value.trim()) { l.setAttribute("aria-invalid", "true"); er.textContent = "Напишете улица или блок, за да ви намери шофьорът."; er.hidden = false; l.focus(); return; }
      const zone = zs.value === "Друг квартал" ? "" : zs.value;
      const btn = f.querySelector<HTMLButtonElement>('button[type="submit"]')!; btn.disabled = true;
      try { U = await api.auth.addAddress({ label: kind, addr: (zone && !l.value.includes(zone) ? zone + ", " : "") + l.value.trim(), zone }); }
      catch (err) { btn.disabled = false; SC.toast(errText(err)); return; }
      redrawAdrs(); s.close(); SC.toast("Адресът е добавен");
    });
  }
  async function removeAdr(id: string) {
    if (offline()) return;
    const a = U!.addrs.find((x) => x.id === id); if (!a) return;
    try { U = await api.auth.removeAddress(id); } catch (e) { SC.toast(errText(e)); return; }
    redrawAdrs(); focusAdrs();
    SC.toast("Махнахме адреса", async () => {
      try { U = await api.auth.addAddress({ label: a.label, addr: a.addr, zone: a.zone }); redrawAdrs(); focusAdrs(); } catch (e) { SC.toast(errText(e)); }
    });
  }

  /* ---------- stamps + coupons (only what the core gives) ---------- */
  function loyalHTML() {
    const n = Math.min(U!.stamps || 0, STAMPS_MAX);
    let li = "";
    for (let i = 1; i <= STAMPS_MAX; i++) li += i <= n ? '<li class="f">' + ic("fire", 24) + '<span class="vh">Печат ' + i + "</span></li>" : i === STAMPS_MAX ? '<li class="g">' + ic("gift", 24) + '<span class="vh">Печат ' + STAMPS_MAX + ", награда</span></li>" : '<li class="e"><span>' + i + "</span></li>";
    return '<div class="loyal rv" role="group" aria-label="Карта с печати, ' + n + " от " + STAMPS_MAX + '"><div class="lh"><span><b>Карта с печати</b><span class="s"><span class="missing">[ЛИПСВА: правило за печат]</span></span></span><span class="cnt2"><b>' + n + "</b> от " + STAMPS_MAX + "</span></div>" +
      '<ol class="stamps">' + li + "</ol><p>Още " + (STAMPS_MAX - n) + ' до <span class="missing">[ЛИПСВА: награда при ' + STAMPS_MAX + " печата]</span>.</p></div>";
  }
  function couponsHTML() {
    const u = U!, c = u.consent;
    /* the -10% with a profile: shown as ready only when the core says it is unused (profileBonus); used -> where */
    const used = u.coupons.find((k) => k.code === "PROFIL10" && k.used);
    const bonus = BONUS
      ? '<div class="ticket ember-card" data-bonus><span class="big">-10%</span><span class="cut" aria-hidden="true"></span><span><b>от следващата поръчка</b><span class="s">Прилага се сам на следващата ви поръчка.</span></span></div>'
      : used ? '<div class="ticket off" data-bonus><span class="big">-10%</span><span class="cut" aria-hidden="true"></span><span><b>с профил</b><span class="state">' + ic("check-circle", 18) + "Използван" + (used.orderNo ? " в поръчка №&nbsp;" + esc(used.orderNo) : "") + "</span></span></div>" : "";
    return bonus + codesHTML() +
      (c.birthday && u.email
        ? '<div class="ticket ember-card"><span class="big">' + ic("cake", 34) + '</span><span class="cut" aria-hidden="true"></span><span><b>Рожден ден</b><span class="s">-10% от сметката или малка торта.</span><span class="state">' + ic("check-circle", 18) + "Включено</span></span></div>"
        : '<div class="ticket off"><span class="big">' + ic("cake", 34) + '</span><span class="cut" aria-hidden="true"></span><span><b>Рожден ден</b><span class="s">-10% от сметката или малка торта.</span>' +
          (c.birthday ? '<button class="link" type="button" data-edit="email">' + ic("plus", 16) + "Добавете имейл за подаръка</button>" : '<a class="link" href="#saglasia">Включете в „Съгласия“' + ic("caret-right", 16) + "</a>") + "</span></div>");
  }


  /* "Моите кодове": the -10% codes from the internal ratings (api.auth.codes) */
  function codesHTML() {
    const how = "Въведете го в количката, в полето „Код за отстъпка“.";
    if (CODES == null) return '<div class="ticket off" data-codes aria-busy="true"><span class="big">-10%</span><span class="cut" aria-hidden="true"></span><span><b>Моите кодове</b><span class="s">Зареждаме...</span></span></div>';
    const list = CODES.map((k) => k.used
      ? '<div class="ticket off" data-code="' + esc(k.code) + '"><span class="big">-' + k.pct + '%</span><span class="cut" aria-hidden="true"></span><span><b><code>' + esc(k.code) + '</code></b><span class="s">За оценката на поръчка №&nbsp;' + esc(k.orderNo) + '.</span><span class="state">' + ic("check-circle", 18) + "Използван" + (k.usedBy ? " в поръчка №&nbsp;" + esc(k.usedBy) : "") + "</span></span></div>"
      : '<div class="ticket ember-card" data-code="' + esc(k.code) + '"><span class="big">-' + k.pct + '%</span><span class="cut" aria-hidden="true"></span><span><b><code>' + esc(k.code) + '</code></b><span class="s">' + how + '</span><button class="link" type="button" data-copy="' + esc(k.code) + '">' + ic("copy", 18) + "Копирай кода</button></span></div>").join("");
    return list || '<div class="ticket off"><span class="big">-10%</span><span class="cut" aria-hidden="true"></span><span><b>за вашата оценка</b><span class="s">Оценете поръчката с „Да“ или „Не“ и кодът идва тук. ' + how + "</span></span></div>";
  }
  async function loadCodes() {
    try { CODES = await api.auth.codes(); } catch { CODES = []; }
    const cp = main.querySelector("[data-cps]"); if (cp) cp.innerHTML = couponsHTML();
    refreshTiles();
  }
  async function copyCode(code: string, btn: HTMLElement) {
    try { await navigator.clipboard.writeText(code); SC.flash(btn, ic("check", 18) + "Копирано", 1600); }
    catch { SC.toast("Кодът е " + code); }
  }

  /* ---------- consents ---------- */
  function consHTML() {
    const c = U!.consent;
    const bd = (c.bday || "").split("-"), bm = +bd[0] || 0, bdd = +bd[1] || 0;
    let days = ""; for (let d = 1; d <= 31; d++) days += "<option" + (d === bdd ? " selected" : "") + ">" + d + "</option>";
    return sw("consent.marketing", "Искам да получавам оферти и маркетингови предложения", "Първи научавате за събитията и новите оферти.", c.marketing === true) +
      sw("consent.birthday", "Искам подарък за рождения си ден", "Седмица преди рождения ви ден ви пращаме имейл с подаръка: -10% от сметката или малка торта, когато празнувате при нас.", c.birthday === true) +
      (c.birthday && !U!.email ? '<div class="bday"><div class="needmail" role="status">' + ic("warning-circle", 22) + '<b>Добавете имейл, за да ви пишем</b><span class="muted small">Подаръкът идва по имейл. Без него няма къде да го изпратим.</span><button class="pill pill-line sm" type="button" data-edit="email">' + ic("plus", 18) + "Добави имейл</button></div></div>" : "") +
      (c.birthday ? '<div class="bday"><span class="label" id="bd-l">Рожден ден (по желание)</span><div class="two">' +
        '<div class="selw"><label class="vh" for="bd-d">Ден</label><select class="input" id="bd-d" data-bday aria-describedby="bd-l"><option value="">Ден</option>' + days + "</select>" + ic("caret-down", 20) + "</div>" +
        '<div class="selw"><label class="vh" for="bd-m">Месец</label><select class="input" id="bd-m" data-bday aria-describedby="bd-l"><option value="">Месец</option>' + SC.MONTHS.map((m, i) => '<option value="' + (i + 1) + '"' + (i + 1 === bm ? " selected" : "") + ">" + m + "</option>").join("") + "</select>" + ic("caret-down", 20) + "</div>" +
        '</div><span class="muted small">Пазим само деня и месеца, без годината.</span></div>' : "");
  }
  function refreshConsents(focusKey?: string) {
    const b = main.querySelector("[data-cons]"); if (b) b.innerHTML = consHTML();
    const cp = main.querySelector("[data-cps]"); if (cp) cp.innerHTML = couponsHTML();
    refreshTiles();
    if (focusKey) main.querySelector<HTMLElement>('[data-sw="' + focusKey + '"]')?.focus({ preventScroll: true });
  }

  const MSG: Record<string, [string, string]> = {
    "notify.order": ["Ще ви известяваме за поръчката.", "Спряхме известията за поръчката. Следете я от сайта."],
    "notify.reservation": ["Ще ви напомняме за резервацията.", "Спряхме напомнянията за резервации."],
    "consent.marketing": ["Благодарим! Ще научавате първи за офертите.", "Спряхме офертите. Няма да ви пишем за тях."],
    "consent.birthday": ["", "Спряхме подаръка за рождения ден."],
  };
  const setSw = (btn: HTMLElement, on: boolean) => { btn.setAttribute("aria-checked", String(on)); btn.querySelector(".st2")!.textContent = on ? "Включено" : "Изключено"; };

  async function toggle(btn: HTMLElement) {
    const key = btn.dataset.sw!, [grp, k] = key.split("."), on = btn.getAttribute("aria-checked") !== "true";
    if (offline()) return;
    setSw(btn, on); btn.setAttribute("aria-busy", "true");
    const consent = k === "birthday" ? (on ? { birthday: true } : { birthday: false, bday: "" }) : { marketing: on };
    try { U = take(await api.auth.update(grp === "notify" ? { notify: { [k]: on } } : { consent })); }
    catch (e) { setSw(btn, !on); btn.removeAttribute("aria-busy"); SC.toast(errText(e)); return; }
    btn.removeAttribute("aria-busy");
    if (k === "birthday") refreshConsents(key);
    const msg = k === "birthday" && on ? (U.email ? "Включено. Изберете деня, ако искате." : "Включено. Добавете имейл за подаръка.") : on ? MSG[key][0] : MSG[key][1];
    SC.toast(msg);
  }

  async function saveBday() {
    const d = main.querySelector<HTMLSelectElement>("#bd-d")!.value, m = main.querySelector<HTMLSelectElement>("#bd-m")!.value;
    if (!(m && d) && U!.consent.bday === "") return;
    if (offline()) return;
    try { U = take(await api.auth.update({ consent: { bday: m && d ? m + "-" + d : "" } })); }
    catch (e) { SC.toast(errText(e)); return; }
    if (m && d) SC.toast("Записахме: " + d + " " + SC.MONTHS[+m - 1]);
  }

  /* ---------- settings ---------- */
  function setsHTML() {
    const th = SC.prefs.theme || "system";
    return '<div class="kvr"><span><span class="k">Име</span><span class="v' + (U!.name ? "" : " none") + '">' + (U!.name ? esc(U!.name) : "Не е добавено") + '</span></span><button class="pill pill-soft sm" type="button" data-edit aria-label="Промени името">Промени</button></div>' +
      '<div class="kvr"><span><span class="k">Телефон</span><span class="v" style="font-variant-numeric:tabular-nums">' + esc(pretty(U!.phone)) + '</span><span class="h">С него влизате.</span></span></div>' +
      '<div class="kvr"><span><span class="k">Имейл</span><span class="v' + (U!.email ? "" : " none") + '">' + (U!.email ? esc(U!.email) : "Не е добавен") + '</span><span class="h">По желание. За касовата бележка и за подаръка за рождения ден.</span></span><button class="pill pill-soft sm" type="button" data-edit="email" aria-label="' + (U!.email ? "Промени имейла" : "Добави имейл") + '">' + (U!.email ? "Промени" : "Добави") + "</button></div>" +
      '<div class="setg" role="group" aria-labelledby="lang-l"><span class="label" id="lang-l">Език</span><div class="seg"><button type="button" aria-pressed="true">Български</button><button type="button" data-en aria-pressed="false">English</button></div><span class="muted small"><span class="missing">[ЛИПСВА: превод]</span></span></div>' +
      '<div class="setg" role="group" aria-labelledby="th-l"><span class="label" id="th-l">Тъмен режим</span><div class="seg" data-theme-seg>' + [["system", "Авто"], ["light", "Светъл"], ["dark", "Тъмен"]].map((t) => '<button type="button" data-th="' + t[0] + '" aria-pressed="' + (th === t[0]) + '">' + t[1] + "</button>").join("") + '</div><span class="muted small">„Авто“ следва настройката на телефона.</span></div>';
  }
  function setTheme(v: "system" | "light" | "dark") {
    SC.prefs.theme = v; SC.store("sc-prefs", SC.prefs);
    const de = document.documentElement;
    if (v === "system") delete de.dataset.theme; else de.dataset.theme = v;
    document.querySelectorAll<HTMLElement>("[data-th]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.th === v)));
  }

  function editSheet(focusEmail: boolean) {
    const s = SC.sheet({ title: "Лични данни", html:
      '<form class="sform" novalidate><div class="field"><label for="e-n">Име</label><input class="input" id="e-n" autocomplete="given-name" value="' + esc(U!.name || "") + '" aria-describedby="e-n-err"><p class="pf-err" id="e-n-err" hidden></p></div>' +
      '<div class="field"><label for="e-m">Имейл (по желание)</label><input class="input" id="e-m" type="email" inputmode="email" autocomplete="email" placeholder="ime@primer.bg" value="' + esc(U!.email || "") + '" aria-describedby="e-m-h e-m-err"><p class="help" id="e-m-h">За касовата бележка и за подаръка за рождения ден. Без реклами, освен ако не ги включите.</p><p class="pf-err" id="e-m-err" hidden></p></div>' +
      '<button class="pill pill-red pill-lg pill-block" type="submit">' + ic("check", 20) + "Запази промените</button></form>" });
    const f = s.el.querySelector("form")!;
    if (focusEmail) setTimeout(() => f.querySelector<HTMLInputElement>("#e-m")?.focus({ preventScroll: true }), 380);
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (offline()) return;
      const n = f.querySelector<HTMLInputElement>("#e-n")!, m = f.querySelector<HTMLInputElement>("#e-m")!;
      let ok = true;
      ([[n, !n.value.trim(), "Напишете името си."], [m, !!m.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(m.value.trim()), "Проверете имейла, ime@primer.bg."]] as [HTMLInputElement, boolean, string][]).forEach(([el, bad, txt]) => {
        const er = f.querySelector<HTMLElement>("#" + el.id + "-err")!;
        if (bad) { ok = false; el.setAttribute("aria-invalid", "true"); er.textContent = txt; er.hidden = false; } else { el.removeAttribute("aria-invalid"); er.hidden = true; }
      });
      if (!ok) { f.querySelector<HTMLElement>('[aria-invalid="true"]')!.focus(); return; }
      const btn = f.querySelector<HTMLButtonElement>('button[type="submit"]')!; btn.disabled = true;
      try { U = take(await api.auth.update({ name: n.value.trim(), email: m.value.trim() })); }
      catch (err) {
        btn.disabled = false;
        if (err instanceof ApiError && err.fields) {
          ([["name", n], ["email", m]] as [string, HTMLInputElement][]).forEach(([k, el]) => { const t = err.fields![k]; if (t) { el.setAttribute("aria-invalid", "true"); const er = f.querySelector<HTMLElement>("#" + el.id + "-err")!; er.textContent = t; er.hidden = false; } });
        }
        SC.toast(errText(err)); return;
      }
      s.close();
      const sb = main.querySelector("[data-sets]"); if (sb) sb.innerHTML = setsHTML();
      refreshConsents();
      const h = main.querySelector("[data-hello]"); if (h) h.innerHTML = hello();
      const av = main.querySelector(".av"); if (av) av.textContent = (U.name || "?").charAt(0).toUpperCase();
      SC.toast("Записахме промените");
    });
  }

  /* ---------- data, delete, logout ---------- */
  async function exportData(btn: HTMLButtonElement) {
    if (offline()) return;
    btn.disabled = true;
    try {
      const d = await api.auth.export();
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = "siracusa-moite-danni.json"; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
      SC.toast("Файлът с данните ви е изтеглен");
    } catch (e) { SC.toast(e instanceof ApiError ? e.message : "Не успяхме да изтеглим файла. Опитайте пак."); }
    finally { btn.disabled = false; }
  }
  const delBtn = () => '<button class="pill pill-dline pill-block" type="button" data-delask>' + ic("trash", 20) + "Изтрий профила</button>";
  function askDelete() {
    const box = main.querySelector<HTMLElement>("[data-del]")!, n = Math.min(U!.stamps || 0, STAMPS_MAX);
    box.innerHTML = '<div class="confirm' + (SC.reduce ? "" : " in") + '" role="region" aria-labelledby="del-h"><h3 class="h3" id="del-h">' + ic("warning", 24) + "Да изтрием ли профила?</h3>" +
      "<ul><li>Изтриваме адресите, любимите, печатите (" + n + " от " + STAMPS_MAX + ") и купоните.</li><li>Касовите бележки пазим, колкото изисква законът.</li><li>Това не може да се върне.</li></ul>" +
      '<div class="btns"><button class="pill pill-danger pill-lg pill-block" type="button" data-delyes>' + ic("trash", 20) + 'Да, изтрий профила</button><button class="pill pill-line pill-block" type="button" data-delno>Не, остави го</button></div></div>';
    box.querySelector<HTMLElement>("[data-delno]")!.focus({ preventScroll: true });
  }
  async function doDelete(btn: HTMLButtonElement) {
    if (offline()) return;
    btn.disabled = true;
    try { await api.auth.remove(); } catch (e) { btn.disabled = false; SC.toast(errText(e)); return; }
    U = null; ORD = null; delete document.documentElement.dataset.pfSigned;
    main.innerHTML = '<section class="gone"><div class="card empty" style="padding:40px 20px"><span class="ill">' + ic("check", 44) + '</span><h1 class="h2">Профилът е изтрит</h1><p class="muted" style="margin:0;max-width:30em">Изтрихме данните ви. Благодарим, че бяхте с нас. Можете да поръчвате и без профил.</p><a class="pill pill-red pill-lg" href="' + SC.url.menu() + '">' + ic("fork-knife", 20) + 'Към менюто</a><a class="link" href="' + SC.url.page("login") + '">Нов профил' + ic("caret-right", 18) + "</a></div></section>";
    window.scrollTo({ top: 0 });
  }
  async function logout() {
    if (offline()) return;
    try { await api.auth.logout(); } catch (e) { SC.toast(errText(e)); return; }
    renderInvite(); window.scrollTo({ top: 0 });
    SC.toast("Излязохте. До скоро!");
  }

  /* ---------- desktop scrollspy for the side menu ---------- */
  let io: IntersectionObserver | null = null;
  function spy() {
    io?.disconnect();
    if (!("IntersectionObserver" in window)) return;
    const links = main.querySelectorAll<HTMLElement>("[data-spy]"); if (!links.length) return;
    io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) links.forEach((a) => a.setAttribute("aria-current", a.dataset.spy === e.target.id ? "true" : "false")); }), { root: null, rootMargin: "-30% 0px -60% 0px" });
    SECTIONS.forEach((s) => { const el = main.querySelector("#" + s[0]); if (el) io!.observe(el); });
  }

  /* ---------- preview-only panel (?preview=1): simulated states, never on the real page ---------- */
  function protoHTML() {
    if (!SC.preview) return "";
    return '<div class="proto"><span class="t">' + ic("flag", 18) + "Само в прегледа</span><p>Симулирани състояния. Данните са истински, от ядрото.</p><div class=\"btns\">" +
      (U ? '<button class="pill pill-soft" type="button" data-p="error">' + ic("warning", 18) + "Грешка при зареждане</button>" : "") +
      '<button class="pill pill-soft" type="button" data-p="off" aria-pressed="' + OFF + '">' + ic("warning-circle", 18) + "Без интернет: " + (OFF ? "включено" : "изключено") + "</button></div></div>";
  }

  /* ---------- delegation ---------- */
  main.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("button, a"); if (!t) return;
    if (t.dataset.re) { reorder(t.dataset.re, t); return; }
    if (t.hasAttribute("data-retry")) { loadOrders(); return; }
    if (t.hasAttribute("data-reload")) { boot(); return; }
    if (t.dataset.sw) { toggle(t); return; }
    if (t.dataset.th) { setTheme(t.dataset.th as "system" | "light" | "dark"); return; }
    if (t.hasAttribute("data-en")) { SC.toast("Английската версия идва след българската."); return; }
    if (t.hasAttribute("data-edit")) { editSheet(t.dataset.edit === "email"); return; }
    if (t.hasAttribute("data-favedit")) { const fv = main.querySelector(".favs"); if (!fv) return; const on = fv.classList.toggle("editing"); t.innerHTML = on ? ic("check", 18) + "Готово" : ic("pencil-simple", 18) + "Промени"; return; }
    if (t.dataset.unfav) { unfav(t.dataset.unfav); return; }
    if (t.hasAttribute("data-adradd")) { adrSheet(); return; }
    if (t.dataset.adrdel) { removeAdr(t.dataset.adrdel); return; }
    if (t.dataset.copy) { copyCode(t.dataset.copy, t); return; }
    if (t.hasAttribute("data-export")) { exportData(t as HTMLButtonElement); return; }
    if (t.hasAttribute("data-delask")) { askDelete(); return; }
    if (t.hasAttribute("data-delno")) { const b = main.querySelector<HTMLElement>("[data-del]")!; b.innerHTML = delBtn(); b.querySelector<HTMLElement>("[data-delask]")!.focus({ preventScroll: true }); return; }
    if (t.hasAttribute("data-delyes")) { doDelete(t as HTMLButtonElement); return; }
    if (t.hasAttribute("data-logout")) { logout(); return; }
    if (t.dataset.p === "off") { OFF = !OFF; t.setAttribute("aria-pressed", String(OFF)); t.innerHTML = ic("warning-circle", 18) + "Без интернет: " + (OFF ? "включено" : "изключено"); SC.toast(OFF ? "Симулираме липса на връзка" : "Връзката е обратно"); return; }
    if (t.dataset.p === "error") { loadOrders(true); main.querySelector("#porachki")?.scrollIntoView({ block: "start", behavior: smooth() }); return; }
  });
  main.addEventListener("change", (e) => { if ((e.target as Element).matches("[data-bday]")) saveBday(); });

  /* ---------- boot: who is signed in (the core decides, "sc-user" only paints the first frame) ---------- */
  async function boot() {
    let me: Customer | null;
    try { me = await api.auth.me(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) { renderInvite(); return; }
      renderLoadError(errText(e)); return;
    }
    if (!me) { try { localStorage.removeItem("sc-user"); } catch { /* private mode */ } renderInvite(); return; }
    U = take(me); document.documentElement.dataset.pfSigned = "1";
    renderProfile();
    if (location.hash && location.hash.length > 1) { const el = main.querySelector(location.hash.replace(/[^#\w-]/g, "")); el?.scrollIntoView({ block: "start" }); }
  }
  boot();
}
