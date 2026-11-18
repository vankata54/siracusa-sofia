/* Кухня · "Търси" (design/pages-kuhnya/_find.js, README "Промени 15.11"): one field, only the waiting orders of the tablet's
   section (the head chef: of every section): number, table, channel, "закъснява" / "наближава", a dish (also in Latin
   letters). The list comes from the server (kitchenApi.search: the section is checked there). A touch or Enter goes to the
   card in the queue and frames it for a moment; from the other screens through the address (#go=<№>). One "×" clears the
   field (the browser's own is hidden), Esc and "Затвори" close. Loaded at the first touch of "Търси".
   With no connection the search still answers, from the last queue the tablet has (number, table, channel, state, name). */
import { ic, esc, type KFrame } from "./frame.ts";
import { kitchenApi, type KFound, type KSearch, type KKind } from "../../client/api-kitchen.ts";
import { SRC_IC, TIMER_WORD, mmss, timerAt, lineText } from "./view.ts";

const LAT: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya" };
const lat = (s: string): string => String(s || "").toLowerCase().replace(/[а-я]/g, (c) => LAT[c] || c).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const KIND: Record<KKind, string[]> = { table: ["маса", "маси", "салон", "градина"], delivery: ["доставка", "доставки", "шофьор"], pickup: ["вземане", "вземания"] };
const STATE: Record<"late" | "soon", string[]> = { late: ["закъснява", "закъсняват", "закъснели"], soon: ["наближава", "наближават"] };
const hit = (w: string, list: string[]): boolean => list.some((x) => { const l = lat(x); return w.length >= 3 && (l.indexOf(w) === 0 || w.indexOf(l.slice(0, Math.max(4, l.length - 1))) === 0); });

/** the same question over the last queue on the tablet (no connection): the simple rules of the core's search */
function localSearch(k: KFrame, raw: string): KSearch {
  const q = k.queue, now = k.now(), res: KSearch = { q: raw, sec: k.sec, now, act: [], later: [], dish: [] };
  const words = lat(raw).split(" ").filter(Boolean), nums = raw.match(/\d+/g) || [], txt = words.filter((w) => !/^\d/.test(w));
  const kinds = (Object.keys(KIND) as KKind[]).filter((x) => txt.some((w) => hit(w, KIND[x])));
  const states = (Object.keys(STATE) as ("late" | "soon")[]).filter((x) => txt.some((w) => hit(w, STATE[x])));
  const rest = txt.filter((w) => !Object.values(KIND).some((l) => hit(w, l)) && !Object.values(STATE).some((l) => hit(w, l)));
  if (!q || !(kinds.length || states.length || nums.length || rest.length)) return res;
  const named = (name: string) => { const ws = lat(name).split(" "); return rest.length > 0 && rest.every((r) => r.length >= 2 && ws.some((w) => w.indexOf(r) === 0)); };
  const one = (o: { no: string; kind: KKind; src: KFound["src"]; lines: { q: number; name: string }[]; due?: number; dueHm?: string; enterHm: string; tomorrow: boolean }, later: boolean): KFound | null => {
    const tm = later ? null : timerAt(o.due || 0, now, k.cfg.soon);
    if (kinds.length && !kinds.includes(o.kind)) return null;
    if (states.length && (!tm || !states.includes(tm.timer as "late" | "soon"))) return null;
    const numbers = o.kind === "table" && o.src.tableNo != null ? [o.no, String(o.src.tableNo)] : [o.no];
    if (nums.length && !nums.every((n) => numbers.some((x) => x.indexOf(n) === 0))) return null;
    const lines = o.lines.map((l) => ({ q: l.q, name: l.name, hit: named(l.name) }));
    if (rest.length && !lines.some((l) => l.hit)) return null;
    return { no: o.no, kind: o.kind, src: o.src, lines, later, timer: tm ? tm.timer : "", left: tm ? tm.left : 0, due: o.due || 0, dueHm: o.dueHm || "", enterHm: o.enterHm, tomorrow: o.tomorrow };
  };
  for (const t of q.tickets) { const f = one(t, false); if (f) res.act.push(f); }
  for (const l of q.later) { const f = one(l, true); if (f) res.later.push(f); }
  return res;
}

let isOpen = false;
export function openFind(k: KFrame): void {
  if (isOpen) return; isOpen = true;
  const where = k.all ? "кухнята" : esc(k.secName), soon = k.cfg.soon;
  const w = document.createElement("div"); w.className = "kfind"; w.setAttribute("role", "dialog"); w.setAttribute("aria-modal", "true"); w.setAttribute("aria-label", "Търси в чакащите поръчки");
  w.innerHTML = '<div class="fwin"><div class="fhead"><form class="fs" role="search"><label class="vh" for="kq">Търси поръчка: номер, маса или ястие</label>' + ic("magnifying-glass", 24) +
    '<input class="input" id="kq" type="search" autocomplete="off" enterkeyhint="search" spellcheck="false" placeholder="№, маса или ястие…"><button class="clr" type="button" data-clr aria-label="Изчисти търсенето" hidden>' + ic("x", 24) + "</button></form>" +
    '<button class="kpill" type="button" data-fclose>' + ic("x", 22) + 'Затвори</button></div><div class="fbody" aria-live="polite"></div></div>';
  document.body.appendChild(w);
  const inp = w.querySelector<HTMLInputElement>("#kq")!, body = w.querySelector<HTMLElement>(".fbody")!, clr = w.querySelector<HTMLElement>("[data-clr]")!;
  /* busy: an answer is on its way; enter: Enter was pressed meanwhile (it goes to the first result when it comes) */
  let seq = 0, timer: ReturnType<typeof setTimeout> | undefined, closed = false, busy = false, enter = false;

  const tmHTML = (f: KFound, now: number): { cls: string; html: string } => {
    if (f.later) return { cls: "", html: "<small>влиза " + (f.tomorrow ? "утре в" : "в") + "</small>" + esc(f.enterHm) };
    const tm = timerAt(f.due, now, soon);
    return { cls: tm.timer, html: "<small>" + TIMER_WORD[tm.timer] + "</small>" + (tm.timer === "late" ? "+" : "") + mmss(tm.left) };
  };
  const row = (f: KFound, now: number): string => {
    const t = tmHTML(f, now), ls = f.lines.map((x) => { const n = esc(lineText(x)); return x.hit ? "<strong>" + n + "</strong>" : n; }).join(", ");
    return '<button class="kfrow ' + t.cls + '" type="button" data-go="' + esc(f.no) + '"' + (f.later ? ' data-later="' + (f.tomorrow ? "утре в " : "в ") + esc(f.enterHm) + '"' : ' data-due="' + f.due + '"') + '><span class="fi">' + ic(SRC_IC[f.kind] || "fork-knife", 26) + "</span><span><b>" + esc(f.src.text) + (f.kind === "table" && f.src.k ? " · " + esc(f.src.k) : "") + "</b><small>" + ls + "</small></span>" +
      '<span class="tm">' + t.html + "</span></button>";
  };
  function results(r: KSearch, raw: string): string {
    const now = k.now(); let h = "";
    if (r.act.length) h += '<h3>Чакат<span class="muted">' + r.act.length + "</span></h3>" + r.act.map((f) => row(f, now)).join("");
    if (r.later.length) h += '<h3>По-късно<span class="muted">' + r.later.length + "</span></h3>" + r.later.map((f) => row(f, now)).join("");
    return h || '<div class="kfempty"><b>Няма „' + esc(raw) + "“ в чакащите</b><p>Търсиш само в поръчките на " + where + ": номер, маса, доставка, вземане или ястие.</p></div>";
  }
  /** before anything is typed: what can be asked, with examples from the queue itself */
  function start(): string {
    const os = (k.queue ? k.queue.tickets : []).slice(0, 2), first = os[0] && os[0].lines[0];
    const ex: [string, string][] = os.map((o): [string, string] => [o.kind === "table" && o.src.tableNo != null ? "маса " + o.src.tableNo : o.no, o.src.text]);
    ex.push(["доставка", "Доставки"], ["закъснява", "Закъсняват"]);
    if (first) ex.push([first.name.split(" ")[0].toLowerCase(), first.name]);
    return '<p class="fscope">Търсиш само в чакащите поръчки на ' + where + ': номер, маса, ястие (и на латиница).</p><div class="fchips">' + ex.map((e) => '<button type="button" data-ex="' + esc(e[0]) + '">' + esc(e[1]) + "</button>").join("") + "</div>";
  }
  function draw(now = false): void {
    const v = inp.value.trim(); clr.hidden = !v;
    clearTimeout(timer);
    const my = ++seq;
    if (!v) { busy = false; enter = false; body.innerHTML = start(); return; }
    busy = true;
    const ask = async () => {
      let r: KSearch;
      try { r = k.online() ? await k.call(() => kitchenApi.search(k.sec, v)) : localSearch(k, v); }
      catch (e) {
        if (my !== seq || closed) return;
        if (!k.online()) r = localSearch(k, v);
        else { busy = false; enter = false; body.innerHTML = '<div class="kfempty"><b>Търсенето не успя</b><p>' + esc(e instanceof Error && e.message ? e.message : "Опитай пак.") + "</p></div>"; return; }
      }
      if (my !== seq || closed) return;
      if (k.online()) k.sync(r.now);
      body.innerHTML = results(r, v); busy = false;
      if (enter) { enter = false; const b = body.querySelector<HTMLElement>("[data-go]"); if (b) go(b); }
    };
    if (now) void ask(); else timer = setTimeout(() => { void ask(); }, 160);
  }
  const offTick = k.onTick((now) => {
    body.querySelectorAll<HTMLElement>(".kfrow[data-due]").forEach((b) => {
      const tm = timerAt(+b.dataset.due!, now, soon), el = b.querySelector(".tm");
      if (!b.classList.contains(tm.timer)) { b.classList.remove("ok", "soon", "late"); b.classList.add(tm.timer); }
      if (el) el.innerHTML = "<small>" + TIMER_WORD[tm.timer] + "</small>" + (tm.timer === "late" ? "+" : "") + mmss(tm.left);
    });
  });
  function close(): void {
    if (closed) return; closed = true; isOpen = false;
    clearTimeout(timer); offTick(); release();
    w.classList.remove("on"); setTimeout(() => w.remove(), 260);
  }
  const release = k.modal(w, close);
  function go(b: HTMLElement): void {
    const no = b.dataset.go || "", later = b.dataset.later;
    close();
    if (later != null) { k.toast("<b>Поръчката влиза в опашката " + esc(later) + "</b>", { secs: 5 }); return; }
    if (k.goTo && k.goTo(no)) return;
    location.href = k.all ? k.href("obsht-izgled") : k.href("queue", "go=" + encodeURIComponent(no));
  }
  w.querySelector("form")!.addEventListener("submit", (e) => e.preventDefault());
  inp.addEventListener("input", () => draw());
  inp.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const b = body.querySelector<HTMLElement>("[data-go]");
    if (!busy) { if (b) go(b); return; }
    enter = true; draw(true);
  });
  w.addEventListener("click", (e) => {
    if (e.target === w) { close(); return; }
    const b = (e.target as Element).closest<HTMLElement>("button"); if (!b) return;
    if (b.hasAttribute("data-fclose")) { close(); return; }
    if (b.hasAttribute("data-clr")) { inp.value = ""; draw(); inp.focus(); return; }
    if (b.dataset.ex != null) { inp.value = b.dataset.ex; draw(true); inp.focus(); return; }
    if (b.hasAttribute("data-go")) go(b);
  });
  draw();
  requestAnimationFrame(() => requestAnimationFrame(() => { w.classList.add("on"); inp.focus({ preventScroll: true }); }));
}
