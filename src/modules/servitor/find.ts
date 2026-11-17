/* Siracusa · what the waiter's search finds (design/pages-servitor/_find.js; decision 15.11 "Умна търсачка = асистентът"):
   the waiter's own things only, checked on the server by the role (floorApi.search: tables, orders at the tables, today's
   reservations with the phone masked, "изчерпано"), and the dishes through the shared search core (src/lib/search.ts) on
   the live menu: by name on top, "Съдържат …", "без …" with the chips, and the dishes without a full composition at the
   bottom with the staff's words. Loaded with the menu on the first open of the search (frame.ts openSearch). */
import "sc-icons:receipt,calendar-check,bowl-food,clock,minus,magnifying-glass,warning,cooking-pot";
import { ic } from "../../lib/icons.ts";
import { esc, fmt } from "../../lib/format.ts";
import { items, setMenu, type Dish } from "../../lib/data.ts";
import { cats } from "../../lib/data.ts";
import { pic } from "../../lib/render.ts";
import { searchDishes, chips, toggle } from "../../lib/search.ts";
import { api } from "../../client/api.ts";
import { floorApi, type StaffSearch, type HallLive } from "../../client/api-floor.ts";
import type { SearchProvider } from "../staff/frame.ts";
import type { SearchApi } from "../staff/find.ts";
import { ZONE, SHORT, STATE_ICON, tableUrl, plural, ms, murl, whose } from "./common.ts";

let live: Promise<void> | null = null;
/** the live menu (sold out today, new and removed dishes) once; the build's menu until it comes */
function liveMenu(): Promise<void> {
  if (!live) live = api.menu().then((m) => { setMenu(m); }).catch(() => { live = null; });
  return live;
}
const CAT: Record<string, string> = {};
const catName = (id: string) => { if (!CAT[id]) for (const c of cats) CAT[c.id] = c.n; return CAT[id] || ""; };
const kwOf = (x: Dish) => { let k = catName(x.cat); if (/бургер/i.test(x.n)) k += " burger cheeseburger"; if (/стек/i.test(x.n)) k += " steak"; if (/Ангъс/i.test(x.n)) k += " black angus"; if (/Рибай/i.test(x.n)) k += " ribeye"; return k; };
const stt = (k: string, word: string, icon: string) => '<span class="stt ' + esc(k) + '">' + ic(icon, 18) + "<span>" + esc(word) + "</span></span>";
const LINE_ST: Record<string, [string, string, string]> = { ready: ["ready", "Готово", "chef-hat"], cooking: ["cook", "Готви се", "cooking-pot"], accepted: ["cook", "Готви се", "cooking-pot"], served: ["served", "Сервирано", "check-circle"] };

export function provider(hall: () => HallLive | null): SearchProvider {
  liveMenu();
  let more: Record<string, boolean> = {};
  const isOut = (x: Dish) => x.t.indexOf("out") > -1;
  function grp(title: string, list: string[], key: string, max = 5): string {
    if (!list.length) return "";
    const open = more[key];
    return '<section class="fgrp"><h3>' + esc(title) + '<span class="muted">' + list.length + "</span></h3>" + list.slice(0, open ? 999 : max).join("") +
      (list.length > max && !open ? '<button class="link fmore" type="button" data-more="' + key + '">Още ' + (list.length - max) + ic("caret-down", 18) + "</button>" : "") + "</section>";
  }
  function tRow(t: StaffSearch["tables"][number]): string {
    const h = hall(), tile = h ? h.tables.find((x) => x.n === t.n) : null, w = h ? whose(h, t.n) : t.mine ? "моя маса" : "";
    const since = tile && tile.waits && tile.since ? " · чака " + mmss(Math.max(0, Math.floor((Date.now() - ms(tile.since)) / 1000))) : "";
    const word = t.state === "call" && tile && tile.reason ? ({ order: "Поръчка", bill: "Сметка", water: "Вода / прибори", other: "Друго" } as Record<string, string>)[tile.reason] : SHORT[t.state];
    return '<a class="frow" href="' + esc(tableUrl(t.n)) + '"><span class="fi ' + t.state + '">' + t.n + "</span><span><b>Маса " + t.n + " · " + ZONE[t.zone] + "</b><small>" + esc(w ? w[0].toUpperCase() + w.slice(1) : "") + since + '</small></span><span class="fr">' + stt(t.state, word, STATE_ICON[t.state]) + "</span></a>";
  }
  function oRow(o: StaffSearch["orders"][number]): string {
    const lines = o.lines.map((l) => l.q + "× " + esc(l.name)).join(", ");
    const k = o.lines.some((l) => l.st === "ready") ? "ready" : o.lines.some((l) => l.st === "cooking" || l.st === "accepted") ? "cooking" : "served", s = LINE_ST[k];
    return '<a class="frow" href="' + esc(tableUrl(o.table.n)) + '"><span class="fi">' + ic("receipt", 22) + "</span><span><b>№ " + esc(o.no) + " · Маса " + o.table.n + (o.bill && o.bill !== "Обща сметка" ? " · " + esc(o.bill) : "") + "</b><small>" + lines + " · " + esc(o.placedAt) + '</small></span><span class="fr">' + stt(s[0], s[1], s[2]) + "</span></a>";
  }
  function rRow(r: NonNullable<StaffSearch["reservations"]>[number]): string {
    return '<button class="frow" type="button" data-res><span class="fi">' + ic("calendar-check", 22) + "</span><span><b>" + esc(r.time) + " · " + (r.tableN ? "Маса " + r.tableN : "Без маса") + " · " + plural(r.people, "човек", "души") + "</b><small>" + esc(r.name) + " · " + esc(r.phone) + " · Днес" + (r.note ? " · " + esc(r.note) : "") + '</small></span><span class="fr">' + ic("caret-right", 20) + "</span></button>";
  }
  function dRow(x: Dish): string {
    return '<a class="frow" href="' + esc(murl.servitor("porachka", "q=" + encodeURIComponent(x.n))) + '">' + pic(x) + "<span><b>" + esc(x.n) + "</b><small>" + [esc(catName(x.cat)), x.per100 ? "за 100 гр." : esc(x.g || "")].filter(Boolean).join(" · ") + '</small></span><span class="fr">' +
      (isOut(x) ? '<span class="out-b">' + ic("clock", 16) + "Изчерпано днес</span>" : '<span class="price">' + fmt(x.p) + "</span>") + "</span></a>";
  }
  return {
    label: "Търси маса, поръчка, резервация или ястие",
    placeholder: "Маса, №, резервация, ястие…",
    wait: 150,
    start() {
      const ex = [["моите маси", "Моите маси"], ["свободни", "Свободни маси"], ["сметка", "Чакат сметка"], ["изчерпано", "Изчерпано днес"], ["резервации", "Резервации"], ["без глутен", "Без глутен"]];
      return '<p class="fscope">Търсиш само в своето: маси, поръчки, изчерпано, резервации и ястията. На кирилица или латиница.</p><div class="fchips">' + ex.map((e) => '<button class="chip" type="button" data-ex="' + esc(e[0]) + '">' + esc(e[1]) + "</button>").join("") + "</div>";
    },
    async results(raw: string) {
      more = {};
      return draw(raw);
    },
    click(el: HTMLElement, s: SearchApi) {
      if (el.dataset.more) { more[el.dataset.more] = true; Promise.resolve(draw(s.value())).then((h) => { const b = el.closest(".fbody"); if (b) b.innerHTML = h; }); return; }
      if (el.dataset.tog) { s.set(toggle(s.value(), el.dataset.tog)); return; }
      if (el.hasAttribute("data-res")) { s.close(); const r = document.getElementById("res"); if (r) r.scrollIntoView({ block: "start" }); else location.href = murl.servitor("", "res"); }
    },
  };
  async function draw(raw: string): Promise<string> {
    let srv: StaffSearch | null = null, offline = false;
    try { srv = await floorApi.search(raw); } catch { offline = true; }
    await Promise.race([liveMenu(), new Promise((r) => setTimeout(r, 1500))]);
    let h = "";
    const ch = chips(raw);
    if (ch.length) h += '<div class="fchips" role="group" aria-label="Съставки и алергени">' + ch.map((c) => '<button class="chip' + (c.without ? " without" : "") + '" type="button" data-tog="' + esc(c.word) + '" aria-pressed="' + c.without + '">' + (c.without ? ic("minus", 18) + "без " + esc(c.label) : esc(c.label) + " " + ic("x", 16)) + "</button>").join("") + "</div>";
    if (offline) h += '<div class="fband unk">' + ic("warning", 20) + "<span>Няма връзка: търсим само в ястията.</span></div>";
    if (srv) {
      h += grp("Маси", srv.tables.map(tRow), "t");
      h += grp("Поръчки", srv.orders.map(oRow), "o", 4);
      h += grp("Резервации", (srv.reservations || []).map(rRow), "r", 4);
      h += grp("Изчерпано днес", srv.soldOut.map((x) => items.find((d) => d.id === x.id)).filter((d): d is Dish => !!d).map(dRow), "x", 8);
    }
    /* the dishes: not for a number or an hour alone, not for the words of the tables */
    const KNOWN = /^(маса|маси|masa|masi|table|tables|на|за|с|и|вика|повикван\S*|сметк\S*|qr|кюар|готов\S*|чака\S*|заета|заети|свободн\S*|изчерпан\S*|резерв\S*|моите|мои|моя|салон\S*|градин\S*|out)$/i;
    const dq = raw.replace(/\d+(:\d+)?/g, " ").split(/\s+/).filter((w) => w && !KNOWN.test(w)).join(" ").trim();
    let dishes = 0;
    if (dq) {
      const d = searchDishes(items.map((x) => ({ id: x.id, n: x.n, comp: x.comp, al: x.al, t: x.t, kw: kwOf(x), x })), dq), back = (l: { x: Dish }[]) => l.map((y) => y.x);
      const top = back(d.query.inc.length ? d.name : d.rest), comp = back(d.comp), unk = back(d.unknown);
      dishes = top.length + comp.length + unk.length;
      h += grp(d.query.exc.length && !d.query.inc.length ? "Ястия без " + d.query.exc.map((w) => w.label).join(" и ") : "Ястия", top.map(dRow), "d", d.query.inc.length ? 6 : 8);
      if (comp.length) h += '<div class="fband">' + ic("bowl-food", 20) + "<span>" + esc(d.band) + "</span></div>" + comp.slice(0, more.c ? 999 : 6).map(dRow).join("") + (comp.length > 6 && !more.c ? '<button class="link fmore" type="button" data-more="c">Още ' + (comp.length - 6) + ic("caret-down", 18) + "</button>" : "");
      if (unk.length) h += '<div class="fband unk">' + ic("warning", 20) + "<span>Нямаме пълен състав: питай кухнята, преди да кажеш на госта.</span></div>" + unk.slice(0, more.u ? 999 : 4).map(dRow).join("") + (unk.length > 4 && !more.u ? '<button class="link fmore" type="button" data-more="u">Още ' + (unk.length - 4) + ic("caret-down", 18) + "</button>" : "");
    }
    const any = dishes || (srv && (srv.tables.length || srv.orders.length || (srv.reservations || []).length || srv.soldOut.length));
    if (!any) h += '<div class="fempty"><div class="ill">' + ic("magnifying-glass", 40) + "</div><h3>Няма „" + esc(raw) + "“</h3><p>Опитай с номер на маса или поръчка, час на резервация, име на ястие (и на латиница) или „без лук“.</p></div>";
    return h;
  }
}
const mmss = (s: number) => Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
