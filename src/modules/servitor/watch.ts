/* Siracusa · "Часовник" of the waiter (/servitor/chasovnik/): port of design/pages-servitor/watch.html on the live data
   of the hall (floorApi.hall + floorApi.ready). Two watch faces, round 232 px and rectangular 204 × 244 px, always dark,
   text at least 14 px, one button of 52-56 px. What they show, in this order:
   - the oldest call for me ("Маса 12 · Сметка · 1:20", the late ones first) with "Отивам" → "Обслужено" (+ "Отмени");
   - a ready order of the kitchen ("Маса 4 · Готово · 2× Пица Маргарита") with "Сервирах" (+ "Отмени");
   - several at once: the dots (role="img", "1 от 4"), a swipe goes to the next one;
   - nothing waits: "Няма повиквания" and my tables; no connection: "Дръж телефона с теб и провери Bluetooth".
   The real watch apps are [ЛИПСВА: кои часовници поддържаме] (OPEN-QUESTIONS 14): this page is the view for a watch
   browser and the phone's notification preview. Vibrations through navigator.vibrate where the phone supports it:
   a call 2 long, ready 3 short, a late call repeats. */
import "sc-icons:bell-ringing,receipt,fork-knife,drop,chat-circle-dots,chef-hat,check,check-circle,warning,clock,caret-left";
import { mountStaff, type Staff } from "../staff/frame.ts";
import { floorApi, type HallLive, type HallCall, type ReadyGroup } from "../../client/api-floor.ts";
import { murl } from "../routes.ts";
import { ic } from "../../lib/icons.ts";
import { esc } from "../../lib/format.ts";
import { $, $$, why, isOffline, flushOutbox, CALL_ICON, CALL_WORD } from "./bits.ts";

type Item = { kind: "call"; id: string; c: HallCall } | { kind: "ready"; id: string; g: ReadyGroup };
const VIB = { call: [400, 200, 400], ready: [120, 100, 120, 100, 120], late: [400, 150, 120, 150, 400] };

export async function mountWatch(): Promise<void> {
  const st0 = await mountStaff({ module: "waiter", screen: "watch", tab: null, title: "Часовник", sub: "Само известия", back: { href: murl.servitor(), label: "Маси" } });
  if (!st0) return;
  const st: Staff = st0;
  const main = st.main;
  let L: HallLive | null = null, R: ReadyGroup[] = [], cur = "", first = true;
  const seen = new Set<string>();
  let lateAt = 0;

  main.innerHTML = '<section class="wsec"><p class="wnote">' + ic("bell-ringing", 20) + '<span>Изгледът за браузъра на часовника и за известията на телефона. Приложение за часовника: <span class="missing">[ЛИПСВА: кои часовници поддържаме]</span>.</span></p></section>' +
    '<section class="wsec" aria-labelledby="wnow"><h2 id="wnow">Сега</h2><div class="pair" data-pair></div><p class="vh" role="status" data-say></p></section>' +
    '<section class="wsec"><h2>Вибрации</h2><p class="wsub">Натисни ред, за да усетиш вибрацията.</p><div class="vib">' +
    ([["call", "bell-ringing", "Повикване", "2 дълги", [44, 44]], ["ready", "chef-hat", "Готово от кухнята", "3 кратки", [14, 14, 14]], ["late", "warning", "Закъснява", "повтаря се", [44, 14, 44]]] as [keyof typeof VIB, string, string, string, number[]][])
      .map((r) => '<button class="r" type="button" data-vib="' + r[0] + '">' + ic(r[1], 24) + '<span class="lb"><b>' + r[2] + '</b><span class="vh">, </span><span class="vw">' + r[3] + '</span></span><span class="bars" aria-hidden="true">' + r[4].map((w) => '<i style="width:' + w + 'px"></i>').join("") + "</span></button>").join("") +
    '</div><p class="wsub" data-novib hidden>Този телефон не вибрира от браузъра: известието идва със звук.</p></section>';
  const pairEl = $("[data-pair]", main)!;
  if (!("vibrate" in navigator)) $("[data-novib]", main)!.hidden = false;

  const list = (): Item[] => {
    if (!L) return [];
    const calls = L.calls.filter((c) => c.forMe).sort((a, b) => Number(lateNow(b)) - Number(lateNow(a)) || (a.at < b.at ? -1 : 1));
    return [...calls.map((c) => ({ kind: "call" as const, id: "c" + c.id, c })), ...R.map((g) => ({ kind: "ready" as const, id: "r" + g.table.id, g }))];
  };
  const lateNow = (c: HallCall) => !c.taken && (c.late || (!!L && Date.now() - Date.parse(c.at) >= L.settings.callManager * 60_000));
  const lvl = () => '120,' + (L ? L.settings.callManager * 60 : 300);

  /* ---------- the faces ---------- */
  const pager = (i: number, n: number) => (n > 1 ? '<span class="pager" role="img" aria-label="' + (i + 1) + " от " + n + '">' + Array.from({ length: Math.min(n, 5) }, (_, k) => '<span class="' + (k === Math.min(i, 4) ? "on" : "") + '"></span>').join("") + "</span>" : "");
  function face(it: Item | null, i: number, n: number, round: boolean): string {
    if (st.offline) return '<div class="face idle"><span class="warn">' + ic("warning", 40) + '</span><div class="why">Няма връзка</div><div class="muted">Дръж телефона с теб и провери Bluetooth</div></div>';
    if (!it) {
      const t = L && L.me.tables.length ? "Маси: " + L.me.tables.join(", ") : "";
      return '<div class="face idle"><span class="big">' + ic("check-circle", 40) + '</span><div class="why">Няма повиквания</div>' + (t ? '<div class="muted">' + esc(t) + "</div>" : "") + "</div>";
    }
    const pg = pager(i, n);
    if (it.kind === "ready") {
      const g = it.g, first = g.lines[0], more = g.lines.length - 1;
      const what = first.q + "× " + first.name + (first.grams ? " · " + first.grams + "\u00a0гр." : "") + (more > 0 ? " + още " + more : "");
      const btn = '<button class="btn" type="button" data-served="' + esc(g.table.id) + '" aria-label="Сервирах: Маса ' + g.table.n + '">' + ic("check", 20) + "Сервирах</button>";
      return round
        ? '<div class="face ready">' + pg + '<div class="t">Маса ' + g.table.n + '</div><div class="why">' + ic("chef-hat", 20) + 'Готово</div><div class="muted">' + esc(what) + '</div><div class="tm">' + st.timer(Date.parse(g.since)) + "</div>" + btn + "</div>"
        : '<div class="face ready"><div class="wtop">' + (pg || ic("chef-hat", 18) + "От кухнята") + '</div><div class="mid"><div class="t">Маса ' + g.table.n + '</div><div class="why">' + ic("chef-hat", 20) + 'Готово</div><div class="muted">' + esc(what) + "</div></div>" + btn + "</div>";
    }
    const c = it.c, word = CALL_WORD[c.kind] || c.label, icon = CALL_ICON[c.kind] || "bell-ringing";
    if (c.taken && c.taken.mine) {
      const btn = '<button class="btn" type="button" data-done="' + esc(c.id) + '" aria-label="Обслужено: Маса ' + c.table.n + '">' + ic("check", 20) + "Обслужено</button>";
      return round
        ? '<div class="face ok">' + pg + '<div class="why">' + ic("check-circle", 20) + 'Отивам</div><div class="t">Маса ' + c.table.n + '</div><div class="muted">' + esc(word) + " · " + st.timer(Date.parse(c.at)) + "</div>" + btn + "</div>"
        : '<div class="face ok"><div class="wtop">' + (pg || ic("check-circle", 18) + "Отивам") + '</div><div class="mid">' + (pg ? '<div class="why">' + ic("check-circle", 20) + "Отивам</div>" : "") + '<div class="t">Маса ' + c.table.n + '</div><div class="muted">' + esc(word) + " · " + st.timer(Date.parse(c.at)) + "</div></div>" + btn + "</div>";
    }
    const btn = '<button class="btn" type="button" data-take="' + esc(c.id) + '" aria-label="Отивам: Маса ' + c.table.n + '">Отивам</button>';
    const cls = "face call" + (lateNow(c) ? " late" : "");
    return round
      ? '<div class="' + cls + '" data-lvl="' + lvl() + '">' + pg + '<div class="t">Маса ' + c.table.n + '</div><div class="why">' + ic(icon, 20) + esc(word) + '</div><div class="tm">' + st.timer(Date.parse(c.at)) + "</div>" + btn + "</div>"
      : '<div class="' + cls + '" data-lvl="' + lvl() + '"><div class="wtop">' + (pg || ic("bell-ringing", 18) + "Повикване") + '</div><div class="mid"><div class="t">Маса ' + c.table.n + '</div><div class="why">' + ic(icon, 20) + esc(word) + '</div><div class="tm">' + st.timer(Date.parse(c.at)) + "</div></div>" + btn + "</div>";
  }
  /* the screen reader hears only what changed ("Маса 12 · Сметка"), never the ticking timers */
  let said = "";
  function say(it: Item | null) {
    const t = st.offline ? "Няма връзка" : !it ? "Няма повиквания" : it.kind === "ready" ? "Готово · Маса " + it.g.table.n : "Маса " + it.c.table.n + " · " + (CALL_WORD[it.c.kind] || it.c.label) + (it.c.taken && it.c.taken.mine ? " · отивам" : "");
    if (t !== said) { said = t; $("[data-say]", main)!.textContent = t; }
  }
  function render() {
    const all = list();
    let i = all.findIndex((x) => x.id === cur);
    if (i < 0) i = 0;
    const it = all[i] || null; cur = it ? it.id : ""; say(it);
    const a = document.activeElement as HTMLElement | null, focusAt = a && pairEl.contains(a) ? (a.closest(".w.round") ? ".w.round .btn" : ".w.rect .btn") : "";
    pairEl.innerHTML = '<figure class="dev"><div class="w round st-dark">' + face(it, i, all.length, true) + '</div><figcaption>Кръгъл · 232 px</figcaption></figure>' +
      '<figure class="dev"><div class="w rect st-dark">' + face(it, i, all.length, false) + "</div><figcaption>Правоъгълен · 204 × 244 px</figcaption></figure>";
    st.tick();
    if (focusAt) { const f = $<HTMLElement>(focusAt, pairEl); if (f) f.focus({ preventScroll: true }); else focusUndo(); }
  }

  /* ---------- the data and the vibrations ---------- */
  async function load() {
    try {
      const [h, r] = await Promise.all([floorApi.hall(), floorApi.ready()]);
      L = h; R = r; st.synced();
      const all = list();
      const fresh = all.filter((x) => !seen.has(x.kind === "ready" ? x.id + ":" + x.g.lines.map((l) => l.key).join(",") : x.id) && !(x.kind === "call" && x.c.taken));
      all.forEach((x) => seen.add(x.kind === "ready" ? x.id + ":" + x.g.lines.map((l) => l.key).join(",") : x.id));
      if (!first && fresh.length) st.haptic(fresh.some((x) => x.kind === "call") ? VIB.call : VIB.ready);
      first = false;
      render();
    } catch (e) { if (!L) st.fail(e); }
  }
  let t: ReturnType<typeof setTimeout> | undefined;
  st.onLive(["floor.session", "floor.call", "floor.qr", "order.new", "order.line", "order.status", "shift.update"], () => { clearTimeout(t); t = setTimeout(load, 250); });
  st.onReload(() => { void load(); });
  st.onNet(() => render());
  /* a late call repeats its vibration (every 30 s) until somebody says "Отивам" */
  setInterval(() => {
    if (!L || st.offline) return;
    const late = L.calls.some((c) => c.forMe && lateNow(c));
    if (late && Date.now() - lateAt >= 30_000) { lateAt = Date.now(); st.haptic(VIB.late); render(); }
  }, 5000);

  /* ---------- actions ---------- */
  async function act(b: HTMLElement, fn: () => Promise<void>) {
    if (b.getAttribute("aria-busy") === "true") return;
    b.setAttribute("aria-busy", "true");
    try { await fn(); } catch (e) { st.toast(isOffline(e) ? "Няма връзка. Опитай, щом се върне." : why(e)); await load(); }
    finally { b.removeAttribute("aria-busy"); }
  }
  const focusUndo = () => { const t = $<HTMLElement>(".st-toast button", st.ov); if (t) t.focus(); };
  pairEl.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("button"); if (!b) return;
    if (b.dataset.take) { const id = b.dataset.take; void act(b, async () => { L = await floorApi.callTake(id); st.haptic(12); render(); }); }
    else if (b.dataset.done) {
      const id = b.dataset.done;
      const n = L ? (L.calls.find((c) => c.id === id) || { table: { n: 0 } }).table.n : 0;
      void act(b, async () => { L = await floorApi.callDone(id); cur = ""; st.toast("Маса " + n + ": обслужено", { undo: () => { void floorApi.callUndo(id).then((h) => { L = h; render(); }, (er) => st.toast(why(er))); } }); render(); });
    } else if (b.dataset.served) {
      const g = R.find((x) => x.table.id === b.dataset.served); if (!g) return;
      const keys = g.lines.map((l) => l.key);
      void act(b, async () => {
        await floorApi.serve(g.table.id, keys); cur = "";
        st.toast("Маса " + g.table.n + ": сервирано", { undo: () => { void floorApi.unserve(g.table.id, keys).then(() => load(), (er) => st.toast(why(er))); } });
        await load();
      });
    }
  });
  /* a swipe to the side: the next (or the previous) one */
  let x0 = 0, y0 = 0;
  pairEl.addEventListener("pointerdown", (e) => { x0 = e.clientX; y0 = e.clientY; });
  pairEl.addEventListener("pointerup", (e) => {
    const dx = e.clientX - x0, dy = e.clientY - y0, all = list();
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5 || all.length < 2) return;
    const i = Math.max(0, all.findIndex((x) => x.id === cur)), j = (i + (dx < 0 ? 1 : -1) + all.length) % all.length;
    cur = all[j].id; render();
  });
  main.addEventListener("click", (e) => {
    const b = (e.target as Element).closest<HTMLElement>("[data-vib]"); if (!b) return;
    const p = VIB[b.dataset.vib as keyof typeof VIB];
    try { if (navigator.vibrate) navigator.vibrate(p); } catch { /* no vibration */ }
    $$("[data-vib]", main).forEach((x) => x.classList.toggle("on", x === b)); setTimeout(() => b.classList.remove("on"), 900);
  });

  await load();
  /* the waiter's orders kept on this phone: the retries and the question at "Изход" (bits.ts) */
  void flushOutbox(st);
}
