/* Siracusa · "Готови" (/servitor/gotovi/; design/pages-servitor/ready.html): what the kitchen marked ready and nobody served,
   by table (floorApi.ready(): my tables first, then the oldest first), "чака 1:30"; "Сервирах" (+ "Отмени" → unserve);
   another's table: "Може да я занесе всеки, който е наблизо". The card about the notifications is in "Смяна".
   The names of the categories come with the menu after the first paint (filled in place). */
import "sc-icons:note,squares-four";
import { mountStaff, type Staff } from "../staff/frame.ts";
import { startOutbox } from "./bits.ts";
import { floorApi, type ReadyGroup } from "../../client/api-floor.ts";
import { ZONE, LIVE, tableUrl, ms, paint, hallStore, shiftInfo, subOf, searchOf, why, refocus, neighbour, esc, ic, murl, type HallStore } from "./common.ts";

let catNames: Record<string, string> | null = null;
function fillCats(root: HTMLElement) {
  const run = () => root.querySelectorAll<HTMLElement>("[data-cat]").forEach((el) => { const n = catNames![el.dataset.cat!]; if (n && !el.firstChild) el.prepend(n); });
  if (catNames) { run(); return; }
  import("../../lib/data.ts").then((d) => { catNames = {}; for (const c of d.cats) catNames[c.id] = c.n; run(); }).catch(() => { /* the line stays without its category */ });
}

export async function mountReady(): Promise<void> {
  let store: HallStore | null = null, groups: ReadyGroup[] | null = null, running = false, again = false, t: ReturnType<typeof setTimeout> | undefined;
  const st = await mountStaff({ module: "waiter", screen: "ready", tab: "ready", title: "Готови", search: () => searchOf(store!)(), shift: () => shiftInfo(st!, store!)() });
  if (!st) return;
  const S: Staff = st;
  store = hallStore(S);
  startOutbox(S); /* the orders kept on this phone: sent on reconnect; asked about at "Изход" (bits.ts) */

  async function load() {
    if (running) { again = true; return; }
    running = true;
    try { groups = await floorApi.ready(); S.synced(); render(); }
    catch (e) { if (!groups) S.fail(e); }
    finally { running = false; if (again) { again = false; schedule(); } }
  }
  function schedule() { clearTimeout(t); t = setTimeout(load, 120); }

  function card(g: ReadyGroup): string {
    const off = S.offAttr();
    return '<article class="rcard' + (g.mine ? "" : " other") + '" aria-label="Маса ' + g.table.n + ', готово за сервиране"><div class="hd">' + ic("chef-hat", 26) + "<b>Маса " + g.table.n + "</b><span>" + ZONE[g.table.zone] + '</span><span class="tm">чака ' + S.timer(ms(g.since)) + '</span></div><div class="in">' +
      g.lines.map((l) => {
        const sub = [l.cat ? '<span data-cat="' + esc(l.cat) + '"></span>' : "", l.bill ? esc(l.bill) : "", l.mods.length ? esc(l.mods.join(", ")) : ""].filter(Boolean).join(" · ");
        return '<div class="oline"><span class="q">' + l.q + '×</span><div><div class="nm">' + esc(l.name) + (l.grams ? " · " + l.grams + "\u00a0гр." : "") + "</div>" + (sub ? '<div class="cat">' + sub + "</div>" : "") + (l.note ? '<div class="note">' + ic("note", 18) + esc(l.note) + "</div>" : "") + "</div></div>";
      }).join("") +
      (g.mine ? "" : '<p class="who">' + (g.owner ? "Маса на " + esc(g.owner.name) + "." : "Масата е без сервитьор.") + " Може да я занесе всеки, който е наблизо.</p>") +
      '<div class="go2"><a class="pill pill-line" href="' + esc(tableUrl(g.table.n)) + '">Масата</a><button class="pill pill-red" type="button" data-serve="' + esc(g.table.id) + '" data-fk="s' + esc(g.table.id) + '"' + off + ">" + ic("check", 22) + "Сервирах</button></div></div></article>";
  }
  function render() {
    if (!groups) return;
    const h = store!.get(); if (h) S.setTop({ sub: subOf(S, h) });
    const html = !groups.length
      ? S.empty({ title: "Нищо не чака", text: "Щом кухнята отбележи „Готово“, ястието се появява тук, а телефонът и часовникът вибрират (3 кратки).", action: '<a class="pill pill-line pill-lg" href="' + esc(murl.servitor()) + '">' + ic("squares-four", 22) + "Към залата</a>" })
      : '<section class="st-sec"><div class="st-h"><h2>От кухнята</h2><span class="muted">най-старото отгоре</span></div>' + groups.map(card).join("") + "</section>";
    if (paint(S, html)) fillCats(S.main);
  }
  const busy = new Set<string>();
  S.main.addEventListener("click", async (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button[data-serve]"); if (!b || b.hasAttribute("data-off") || !groups) return;
    const id = b.dataset.serve!, g = groups.find((x) => x.table.id === id); if (!g || busy.has(id)) return;
    const keys = g.lines.map((l) => l.key);
    busy.add(id);
    try {
      const next = neighbour(S, "s" + id);
      const r = await floorApi.serve(id, keys);
      groups = groups.filter((x) => x.table.id !== id); render(); store!.load();
      /* the card goes away: the focus goes to the next "Сервирах" (else the heading) */
      refocus(S, [next, "h2"]);
      const done = r.served.length ? r.served : keys;
      S.toast("Маса " + g.table.n + ": сервирано", { undo: async () => { try { await floorApi.unserve(id, done); } catch (x) { S.toast(why(x)); } await load(); store!.load(); refocus(S, ['[data-fk="s' + CSS.escape(id) + '"]', "h2"]); } });
    } catch (x) { S.toast(why(x)); load(); }
    finally { busy.delete(id); }
  });
  S.onLive(LIVE, schedule);
  S.onReload(() => { load(); });
  S.onNet(render);
  store.load();
  await load();
}
