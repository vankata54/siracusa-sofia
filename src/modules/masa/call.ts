/* QR маса · "Повикай сервитьор" (/masa/<код>/povikvane/): design/pages-masa/call.html. 4 tiles (Поръчка, Сметка →
   the bill, Вода или прибори, Друго with a few words in a sheet); after a call "Сервитьорът идва · чакате 0:42" (a live
   timer from the core's time), "Отмени повикването" with "Отмени"; the same call is locked while it waits and for
   settings.callCooldown minutes after "Обслужено" ("Пак след 2:18"); after settings.callManager minutes "Чакате над 5 мин.
   Известихме и управителя." The minutes always come from the view (the admin's settings). No dish data here. */
import "sc-icons:bell-ringing,note,receipt,drop,chat-circle-dots,caret-right,timer,warning,x,info,check-circle";
import { mountMasa, type Masa } from "./frame.ts";
import { SC } from "../../client/sc.ts";
import { masaApi, type CallKind } from "../../client/api-floor.ts";
import { CALLS } from "./words.ts";

const ORDER: CallKind[] = ["order", "bill", "water", "other"];
let M: Masa, hl = false, renderKey = "";

const st = (k: CallKind) => M.view.calls.state[k];
const active = (k: CallKind) => M.view.calls.active.find((c) => c.kind === k) || null;
const waited = (k: CallKind) => { const a = active(k); return a ? M.since(a.at) : 0; };
const left = (k: CallKind) => { const s = st(k); return s.state === "cool" && s.until ? Math.max(0, M.until(s.until)) : 0; };
/* "cool" ends on the phone's clock too (the view comes again every minute) */
const stateOf = (k: CallKind) => { const s = st(k).state; return s === "cool" && left(k) <= 0 ? "free" : s; };
const late = (k: CallKind) => { const a = active(k); return !!a && !a.taken && (a.manager || waited(k) >= M.view.settings.callManager * 60); };
const callName = (k: CallKind) => M.L(CALLS[k].bg, CALLS[k].en);

function liveHTML(): string {
  const v = M.view, L = M.L, mg = v.settings.callManager;
  const served = ORDER.find((k) => stateOf(k) === "cool");
  return v.calls.active.map((c) => {
    const k = c.kind as CallKind;
    return '<div class="shell" role="status"><div class="core coming"><span class="bell">' + M.ic("bell-ringing", 30) + "</span>" +
      "<h2>" + L("Сервитьорът идва", "A waiter is on the way") + ' · <span class="t">' + L("чакате ", "waiting ") + '<span data-wt="' + k + '">' + M.mmss(waited(k)) + "</span></span></h2>" +
      '<p class="what">' + M.esc(callName(k)) + (c.note ? ": „" + M.esc(c.note) + "“" : "") + " · " + L("повикан в ", "called at ") + M.clock(c.at) + "</p>" +
      '<div class="more">' + (late(k) ? '<p class="mgr">' + M.ic("warning", 20) + "<span>" + L("Чакате над " + mg + " мин. Известихме и управителя.", "You have waited over " + mg + " min. We have told the manager too.") + "</span></p>"
        : "<p>" + L("Сервитьорът вижда номера на масата и колко чакате. Ако не отговори до " + mg + " мин, известието отива и при управителя.", "The waiter sees your table number and how long you have waited. If nobody answers within " + mg + " min, the manager is told too.") + "</p>") +
      (k === "bill" ? '<a class="link" href="' + M.href("bill") + '">' + M.ic("receipt", 20) + L("Виж сметката", "See the bill") + "</a>" : '<button class="link" type="button" data-cancel="' + k + '">' + M.ic("x", 18) + L("Отмени повикването", "Cancel the call") + "</button>") + "</div></div></div>";
  }).join("") +
    (served && !v.calls.active.length ? '<div class="served" role="status">' + M.ic("check-circle", 24) + "<span><b>" + L("Обслужено", "Done") + "</b> · " + M.esc(callName(served)) + ". " + L("Сервитьорът го отбеляза.", "The waiter marked it.") + "</span></div>" : "");
}

function tileHTML(k: CallKind): string {
  const c = CALLS[k], L = M.L, s = stateOf(k), on = s === "active", v = M.view;
  const inner = '<span class="ti">' + M.ic(c.icon, 30) + "</span><b>" + L(c.bg, c.en) + "</b>";
  if (k === "bill") {
    const req = v.bill.mine || v.bill.others.find((o) => o.split === "one") || null;
    return '<a class="tile' + (on ? " on" : "") + '" href="' + M.href("bill") + '"><span class="tgo">' + M.ic("caret-right", 20) + "</span>" + inner + '<span class="d">' + (req ? L("Поискана в ", "Asked at ") + M.clock(req.at) : L(c.sub[0], c.sub[1])) + "</span></a>";
  }
  if (on) return '<button class="tile on" type="button" aria-disabled="true" data-locked="' + k + '" aria-describedby="why">' + inner + '<span class="tmsg">' + L("Вече повикахме", "Already called") + '</span><span class="lock">' + M.ic("timer", 18) + L("чакате ", "waiting ") + '<span class="t" data-wt="' + k + '">' + M.mmss(waited(k)) + "</span></span></button>";
  if (s === "cool") return '<button class="tile" type="button" aria-disabled="true" data-locked="' + k + '" aria-describedby="why">' + inner + '<span class="tmsg">' + L("Сервитьорът току-що дойде", "The waiter has just been here") + '</span><span class="lock">' + M.ic("timer", 18) + L("Пак след ", "Again in ") + '<span class="t" data-lt="' + k + '">' + M.mmss(left(k)) + "</span></span></button>";
  return '<button class="tile" type="button" data-call="' + k + '"' + (M.offline || v.status !== "open" ? ' aria-disabled="true"' : "") + ">" + inner + '<span class="d">' + L(c.sub[0], c.sub[1]) + "</span></button>";
}

const key = () => ORDER.map((k) => stateOf(k) + ":" + (late(k) ? 1 : 0)).join("|");
function render(m: Masa) {
  M = m;
  const L = M.L, s = M.view.settings, y = scrollY;
  M.main.innerHTML = '<section class="mpage" aria-labelledby="cw-h"><div class="mh"><h1 class="h1" id="cw-h">' + L("Повикай сервитьор", "Call a waiter") + '</h1><p class="lead">' + L("Изберете за какво. Сервитьорът вижда номера на масата.", "Choose what for. The waiter sees your table number.") + "</p></div>" +
    '<div class="cl-grid"><div class="live" aria-live="polite">' + liveHTML() + "</div>" +
    (M.offline || M.lost ? '<div class="mnotes">' + M.banners({ kitchen: false }) + "</div>" : "") +
    '<div class="tiles" role="group" aria-label="' + L("За какво", "What for") + '">' + ORDER.map(tileHTML).join("") + "</div>" +
    '<div class="why' + (hl ? " hl" : "") + '" id="why">' + M.ic("info", 22) + "<div><b>" + L("Повикването остава, докато сервитьорът дойде", "Your call stays until the waiter comes") + "</b><p>" +
      L("Времето, което чакате, не се нулира и ако минат " + s.callManager + " мин, известяваме и управителя. Щом сервитьорът дойде, същото повикване може пак след " + s.callCooldown + " мин. Другите плочки работят веднага. Ако е спешно, махнете на сервитьора.",
        "Your waiting time never resets, and after " + s.callManager + " min we tell the manager too. Once the waiter has come, the same call works again after " + s.callCooldown + " min. The other tiles work right away. If it is urgent, wave to the waiter.") + "</p></div></div></div></section>";
  renderKey = key();
  if (Math.abs(scrollY - y) > 1) scrollTo(0, y);
}

function tick(m: Masa) {
  M = m;
  if (key() !== renderKey) { render(m); return; }
  M.main.querySelectorAll<HTMLElement>("[data-wt]").forEach((s) => { s.textContent = M.mmss(waited(s.dataset.wt as CallKind)); });
  M.main.querySelectorAll<HTMLElement>("[data-lt]").forEach((s) => { s.textContent = M.mmss(left(s.dataset.lt as CallKind)); });
}

function otherSheet() {
  const L = M.L;
  const s = M.openSheet({ title: L("Друго", "Something else"), html: '<div class="oth"><div class="field"><label for="oth">' + L("Какво ви трябва? (по желание)", "What do you need? (optional)") + '</label><textarea class="input" id="oth" rows="3" maxlength="140"></textarea><span class="help">' + L("Сервитьорът ще го прочете на телефона си.", "The waiter will read it on their phone.") + "</span></div>" +
    '<button class="pill pill-red pill-lg pill-block" type="button" data-osend>' + M.ic("bell-ringing", 20) + L("Повикай сервитьор", "Call a waiter") + "</button></div>" });
  s.el.querySelector<HTMLElement>("[data-osend]")!.onclick = () => { const v = s.el.querySelector<HTMLTextAreaElement>("#oth")!.value.trim(); s.close(); void doCall("other", v); };
  setTimeout(() => s.el.querySelector<HTMLTextAreaElement>("#oth")?.focus({ preventScroll: true }), 80);
}
async function doCall(k: CallKind, text?: string, busy?: HTMLElement) {
  const L = M.L;
  if (M.offline) { M.toast(L("Няма връзка. Опитайте пак или махнете на сервитьора.", "No connection. Try again or wave to the waiter.")); return; }
  const r = await M.act(() => masaApi.call(M.code, k, text), { busy });
  if (r) { SC.haptic(); M.toast(L("Сервитьорът идва", "A waiter is on the way")); scrollTo({ top: 0, behavior: SC.reduce ? "auto" : "smooth" }); }
}

const m = mountMasa({ screen: "call", title: ["Повикай сервитьор", "Call a waiter"], render, tick });
M = m;
m.main.addEventListener("click", async (e) => {
  const t = (e.target as Element).closest<HTMLElement>("button, a");
  if (!t || !m.view) return;
  const L = m.L;
  if (t.dataset.call) {
    if (m.view.status !== "open") return;
    if (t.dataset.call === "other" && !m.offline) otherSheet(); else await doCall(t.dataset.call as CallKind, undefined, t);
    return;
  }
  if (t.dataset.locked) {
    const k = t.dataset.locked as CallKind, act = stateOf(k) === "active";
    hl = true; render(m);
    m.toast(act ? L("Вече повикахме. Сервитьорът вижда, че чакате " + m.mmss(waited(k)) + ".", "Already called. The waiter sees you have waited " + m.mmss(waited(k)) + ".") : L("Сервитьорът току-що дойде. Пак след " + m.mmss(left(k)) + ".", "The waiter has just been here. Again in " + m.mmss(left(k)) + "."));
    m.main.querySelector("#why")?.scrollIntoView({ block: "nearest", behavior: SC.reduce ? "auto" : "smooth" });
    return;
  }
  if (t.dataset.cancel) {
    const k = t.dataset.cancel as CallKind;
    const r = await m.act(() => masaApi.callCancel(m.code, k), { busy: t });
    if (r) m.toast(L("Отменихте повикването", "You cancelled the call"), () => { void m.act(() => masaApi.callRestore(m.code, k)); });
  }
});
