/* Siracusa · what the manager's search finds (design/pages-upravitel/_find.js; decisions 15.11 "Умна търсачка" and
   "Търсенето на ястия е едно"). Loaded on the first open of the search (the frame's shell: the field, the keys, the
   aria-live line). Only what the role sees, checked on the server (bossApi.search: tables, orders by № or 3+ digits of
   the phone with the phone masked, today's reservations, the people on shift, "изчерпано"); the dishes through the shared
   search core (src/lib/search.ts) on the live menu: by name on top, "Съдържат …", "без …" with the chip, the dishes
   without a full composition at the bottom; the admin's sections by their name only (boss.searchSections: never
   "оборот"). The exact number is first. MgrSearch.today (a sum over orders) is never drawn. */
import "sc-icons:chair,receipt,calendar-check,user,moped,caret-right,caret-down,arrow-up-right,clock,bowl-food,warning,minus,x,magnifying-glass,hourglass,check,cooking-pot,fire,pizza,storefront,briefcase,phone";
import type { Boss, BossSearch } from "../boss/frame.ts";
import { bossApi, type MgrSearch, type MgrHall } from "../../client/api-boss.ts";
import { api } from "../../client/api.ts";
import { items, setMenu, catById, type Dish } from "../../lib/data.ts";
import { pic } from "../../lib/render.ts";
import { searchDishes, chips as qChips, toggle, latin } from "../../lib/search.ts";
import { fmtNb as fmt } from "../../lib/format.ts";
import { tag } from "../boss/frame.ts";
import { ic, esc, plural, NB, ppl, hmOf, TST, tagCls, ZONE, CH_IC, go } from "./common.ts";

let live: Promise<void> | null = null;
/** the live menu (sold out today, new and removed dishes) once; the build's menu until it comes */
function liveMenu(): Promise<void> {
  if (!live) live = api.menu().then((m) => { setMenu(m); }).catch(() => { live = null; });
  return live;
}
const lat = (s: string) => latin(String(s || "")).replace(/[^a-z0-9: ]+/g, " ").replace(/\s+/g, " ").trim();
/* a word matches: 3+ letters from the start on both sides; 2-letter words only whole ("qr") */
function hit(w: string, list: string[]): boolean {
  return list.some((x) => { const l = lat(x); if (!l) return false; if (w.length < 3 || l.length < 3) return w === l; return l.indexOf(w) === 0 || w.indexOf(l.slice(0, Math.max(3, l.length - 1))) === 0; });
}
const STOP = ["маса", "маси", "masa", "masi", "table", "на", "за", "с", "и", "в", "от", "до", "no", "номер", "nomer"].map(lat);
const TABLEW = ["маса", "маси", "masa", "masi", "table"].map(lat);
const STATE_W = ["свободна", "свободни", "свободно", "заета", "заети", "вика", "повикване", "повиквания", "сметка", "сметки", "qr", "кюар", "чака", "чакат", "готово", "готови", "резервирана", "резервирани", "салон", "градина"];
const PEOPLE = ["сервитьор", "сервитьори", "шофьор", "шофьори", "servitor", "sofyor", "shofyor", "waiter", "driver", "кухня", "кухнята"];
const OUTW = ["изчерпано", "изчерпани", "изчерпан", "izcherpano"];
const RESW = ["резервация", "резервации", "резерв"];

export function provider(boss: Boss): BossSearch {
  liveMenu();
  const dishesOk = boss.can("menu") || boss.can("lunch");
  let hall: { at: number; d: MgrHall | null } = { at: 0, d: null };
  async function hallNow(): Promise<MgrHall | null> {
    if (!(boss.can("hall") || boss.can("reservations"))) return null;
    if (Date.now() - hall.at < 10_000) return hall.d;
    try { hall = { at: Date.now(), d: await bossApi.hall() }; } catch { /* the rows go without the waiter */ }
    return hall.d;
  }
  function grp(title: string, rows: string[], key: string, max: number, more: Record<string, boolean>): string {
    if (!rows.length) return "";
    const open = more[key];
    return '<section class="mg-fgrp" aria-label="' + esc(title) + '"><h2>' + esc(title) + '<span class="muted">' + rows.length + "</span></h2>" + rows.slice(0, open ? 60 : max).join("") +
      (rows.length > max && !open ? '<button class="mg-link mg-fmore" type="button" data-fmore="' + key + '">' + ic("caret-down", 18) + "Покажи още " + (rows.length - max) + "</button>" : "") + "</section>";
  }
  const a = (href: string, inner: string) => '<a class="mg-frow" href="' + esc(href) + '">' + inner + "</a>";
  function tRow(t: MgrSearch["tables"][number], h: MgrHall | null): string {
    const x = h ? h.tiles.find((y) => y.id === t.id) : null, st = x ? x.state : t.state, s = TST[st] || TST.free;
    const sub = (x ? (x.waiter ? x.waiter.name : "без сервитьор") + (x.since && st !== "free" && st !== "res" ? " · от " + hmOf(x.since) : "") + (x.next ? " · резервация " + x.next.time : "") : "");
    return a(go.hall("t=" + t.n), '<span class="fi ' + st + '">' + t.n + "</span><span><b>Маса " + t.n + " · " + ZONE[t.zone] + "</b><small>" + esc(sub) + '</small></span><span class="fr">' + tag(tagCls(st), s[1], s[0]) + "</span>");
  }
  function oRow(o: NonNullable<MgrSearch["orders"]>[number]): string {
    const href = o.status === "accepted" ? go.now("n=" + o.no) : go.order(o.no);
    return a(href, '<span class="fi">' + ic(CH_IC[o.channelName] || "receipt", 22) + "</span><span><b>№" + NB + esc(o.no) + " · " + esc(o.channelName) + "</b><small>" + esc(o.statusLabel) + " · " + esc(o.placedAt) +
      (o.name && o.channelName !== "Маса" ? " · " + esc(o.name) : "") + (o.phone ? " · " + esc(o.phone) : "") + '</small></span><span class="fr price">' + fmt(o.total) + "</span>");
  }
  const RST: Record<string, string> = { new: "Нова", confirmed: "Потвърдена", seated: "Дошли", no_show: "Неявили се", waitlist: "Чака маса" };
  function rRow(r: NonNullable<MgrSearch["reservations"]>[number]): string {
    return a(go.hall("go=res"), '<span class="fi">' + ic("calendar-check", 22) + "</span><span><b>" + esc(r.time) + " · " + esc(r.name) + " · " + ppl(r.people) + "</b><small>Днес" + (r.tableN ? " · Маса" + NB + r.tableN : " · без маса") + (r.note ? " · " + esc(r.note) : "") + "</small></span>" +
      '<span class="fr">' + tag(r.status === "new" ? "warn" : "", r.status === "new" ? "hourglass" : "check", RST[r.status] || r.status) + "</span>");
  }
  function pRow(p: MgrSearch["people"][number]): string {
    const icon = p.kind === "waiter" ? "user" : p.kind === "driver" ? "moped" : "cooking-pot";
    const sub = p.kind === "waiter" ? plural(p.tables.length, "маса", "маси") + (p.tables.length ? ": " + p.tables.join(", ") : "") : p.kind === "driver" ? "Шофьор на смяна" : "Секция в кухнята";
    return a(go.team("go=" + (p.kind === "kitchen" ? "kitchen" : p.kind === "waiter" ? "w-" + p.id : "d-" + p.id)), '<span class="fi">' + ic(icon, 22) + "</span><span><b>" + esc(p.name) + "</b><small>" + esc(sub) + '</small></span><span class="fr">' + ic("caret-right", 20) + "</span>");
  }
  function dRow(x: Dish): string {
    const out = x.t.indexOf("out") > -1, c = catById[x.cat];
    return a(go.dish(x.id), pic(x) + "<span><b>" + esc(x.n) + "</b><small>" + [c ? esc(c.n) : "", x.per100 ? "за 100 гр." : esc(x.g || "")].filter(Boolean).join(" · ") + '</small></span><span class="fr">' +
      (out ? '<span class="out">' + ic("clock", 16) + "Изчерпано днес</span>" : '<span class="price">' + fmt(x.p) + "</span>") + "</span>");
  }
  function start(): string {
    const ex: [string, string][] = [["12", "Маса 12"], ["свободни", "Свободни маси"], ["вика", "Масите, които викат"], ["изчерпано", "Изчерпано днес"], ["Шофьор 1", "Шофьор 1"], ["без лук", "Без лук"]];
    return '<p class="mg-fscope">Търсиш само в своето: маси, поръчки, резервации, хората на смяната, изчерпаното, ястията и разделите на админа. На кирилица или латиница.</p><div class="mg-fchips">' +
      ex.map((e) => '<button class="chip" type="button" data-fq="' + esc(e[0]) + '">' + esc(e[1]) + "</button>").join("") + "</div>";
  }
  return {
    async results(raw: string, more: Record<string, boolean>): Promise<string> {
      if (!raw) return start();
      const q = lat(raw), all = q.split(" ").filter(Boolean), words = all.filter((w) => !STOP.includes(w)), txt = words.filter((w) => !/^\d/.test(w));
      const tableWord = all.some((w) => TABLEW.includes(w)), person = txt.some((w) => hit(w, PEOPLE)) && !tableWord;
      const sts = txt.some((w) => hit(w, STATE_W)), kOut = txt.some((w) => hit(w, OUTW) || w === "out"), kRes = txt.some((w) => hit(w, RESW));
      let srv: MgrSearch | null = null, off = false;
      const [r, h] = await Promise.all([bossApi.search(raw).catch(() => { off = true; return null; }), hallNow()]);
      srv = r;
      await Promise.race([liveMenu(), new Promise((res) => setTimeout(res, 1500))]);
      let html = "";
      const ch = qChips(raw);
      if (ch.length) html += '<div class="mg-fchips" role="group" aria-label="Как разбрахме търсенето">' + ch.map((c) => '<button class="chip' + (c.without ? " without" : "") + '" type="button" data-fq="' + esc(toggle(raw, c.word)) + '" aria-pressed="' + c.without + '" aria-label="' +
        (c.without ? "без " + esc(c.label) + ", покажи и с " + esc(c.label) : esc(c.label) + ", покажи без " + esc(c.label)) + '">' + (c.without ? ic("minus", 18) + "без " + esc(c.label) : esc(c.label) + " " + ic("x", 16)) + "</button>").join("") + "</div>";
      if (off) html += '<div class="mg-fband unk">' + ic("warning", 20) + "<span>Няма връзка: търсим само в ястията.</span></div>";
      let any = false;
      if (srv) {
        /* a person ("Сервитьор 2"): the number is part of the name, not a table, an order or an hour */
        const tables = person || kOut ? [] : srv.tables, orders = person || kOut ? [] : srv.orders || [], res = person || kOut ? [] : srv.reservations || [];
        const dq = raw.replace(/\D/g, ""), exactT = !person && /^\d{1,2}$/.test(raw.trim().replace(/^маса\s*/i, "")) && tables.some((t) => String(t.n) === raw.trim().replace(/^маса\s*/i, ""));
        const sortedO = orders.slice().sort((x, y) => Number(y.exact || y.no === dq) - Number(x.exact || x.no === dq));
        const out = srv.soldOut.map((x) => items.find((d) => d.id === x.id)).filter((d): d is Dish => !!d);
        const parts: Record<string, string> = {
          t: grp("Маси", tables.map((t) => tRow(t, h)), "t", 6, more), o: grp("Поръчки", sortedO.map(oRow), "o", 5, more), r: grp("Резервации", res.map(rRow), "r", 4, more),
          s: grp(person ? "Хората на смяната" : "Персоналът на смяната", srv.people.map(pRow), "s", 6, more), x: grp("Изчерпано днес", out.map(dRow), "x", 8, more),
        };
        const order = ["t", "o", "r", "s", "x"];
        const first = person && srv.people.length ? "s" : kOut ? "x" : sortedO.length && (sortedO[0].exact || sortedO[0].no === dq) ? "o" : exactT ? "t" : "";
        if (first) { order.splice(order.indexOf(first), 1); order.unshift(first); }
        html += order.map((k) => parts[k]).join("");
        any = !!(tables.length || orders.length || res.length || srv.people.length || out.length);
      }
      /* the dishes: the shared core; not for numbers, hours, people, the words of the tables */
      const dishQ = raw.replace(/\d+(:\d+)?/g, " ").trim();
      if (dishesOk && dishQ && !sts && !kOut && !kRes && !person && !tableWord) {
        const d = searchDishes(items.map((x) => ({ id: x.id, n: x.n, comp: x.comp, al: x.al, t: x.t, kw: catById[x.cat] ? catById[x.cat].n : "", x })), dishQ), back = (l: { x: Dish }[]) => l.map((y) => y.x);
        const exc = d.query.exc.map((w) => w.label), top = back(d.query.inc.length || !exc.length ? d.name : d.rest), comp = back(d.comp), unk = back(d.unknown);
        html += grp(d.query.inc.length || !exc.length ? "Ястия" : "Ястия без " + exc.join(" и "), top.map(dRow), "d", 6, more);
        if (comp.length) html += '<div class="mg-fband">' + ic("bowl-food", 20) + "<span>" + esc(d.band) + "</span></div>" + comp.slice(0, more.c ? 60 : 6).map(dRow).join("") + (comp.length > 6 && !more.c ? '<button class="mg-link mg-fmore" type="button" data-fmore="c">' + ic("caret-down", 18) + "Покажи още " + (comp.length - 6) + "</button>" : "");
        if (unk.length) html += '<div class="mg-fband unk">' + ic("warning", 20) + "<span>Нямаме пълен състав, попитайте ни<small>Провери с кухнята, преди да кажеш на госта.</small></span></div>" + unk.slice(0, more.u ? 60 : 4).map(dRow).join("") + (unk.length > 4 && !more.u ? '<button class="mg-link mg-fmore" type="button" data-fmore="u">' + ic("caret-down", 18) + "Покажи още " + (unk.length - 4) + "</button>" : "");
        if (top.length || comp.length || unk.length) any = true;
      }
      /* the sections of the admin: by the name only, only the allowed (never "оборот", decision 17.11.2026) */
      if (txt.length && !sts && !person && !kOut) { const s = boss.searchSections(raw); if (s) { html += s; any = true; } }
      if (!any) html += '<div class="mg-fempty"><div class="ill">' + ic("magnifying-glass", 40) + "</div><h2>Нищо за „" + esc(raw) + "“</h2><p>Опитай с номер на маса или поръчка, час на резервация, „Сервитьор 1“, ястие (и на латиница) или „без лук“.</p></div>";
      return html;
    },
  };
}
