/* Siracusa · "Собственик" › "Решения" (/sobstvenik/reshenia/): port of design/pages-sobstvenik/decisions.html over the
   core (ownerApi.decisions / answer / answerUndo / block). The no-shows to block ("Блокирай" with the confirmation, "Не
   блокирай", the number masked, no "Отмени", decision 16.11; the focus to the card's title after). The questions of the
   agency word for word with the default: one big card "Въпрос 1 от N" with "Съгласен" / "Друго" (the error "Напиши
   отговора си." under the field); the next question comes; the toast with "Отмени" (ownerApi.answerUndo). Only the owner
   answers (the core checks it); the main admin reads ("Отговаря собственикът"). An answer is ONE note per question in
   "Бележки" (kind "answer"), it changes nothing until the agency applies it. The filter "Чакат отговор / Отговорени" with
   the counts, the list by groups, "Промени отговора". On a computer the card is sticky on the left, the list on the right.
   "Google профил": "Скоро" with the [ЛИПСВА] of the core. Hash: #f=done, #q=<id>, #noshow, #google. */
import "sc-icons:hourglass,lock,check,check-circle,caret-right,chat-circle-dots,pencil-simple,paper-plane-right,ticket,info,clock,star";
import { mountBoss, type Boss } from "../boss/frame.ts";
import { ownerApi, ApiError, type OwnerDecisions, type QuestionView } from "../../client/api-boss.ts";
import { ic, esc, plural, soon, miss, go, screen, hashMap, setHash, act, ago, keptAnswers } from "./common.ts";

export async function initDecisions(): Promise<void> {
  const boss = await mountBoss({ module: "sobstvenik", tab: "decisions", title: "Решения", search: { load: () => import("./find.ts").then((m) => m.provider(boss!)) } });
  if (!boss) return;
  decisionsScreen(boss);
}

/* the words of the status of an answer in "Бележки" */
const NSN: Record<string, string> = { new: "при агенцията, чака преглед", approved: "одобрен, агенцията го прилага", doing: "агенцията го прилага", review: "приложен, чака публикуване", published: "приложен", rejected: "агенцията ще се обади" };
/** an answer kept on the phone (no connection): shown on its card and in the list until it goes */
type QV = QuestionView & { kept?: boolean };
const grpName = (q: QuestionView) => (q.sec === "r" ? (q.id === "v1" ? "Решения за ресторанта · ваучери" : "Решения за ресторанта") : q.group);

function decisionsScreen(boss: Boss): void {
  const body = boss.body, h0 = hashMap();
  let filt: "wait" | "done" = h0.f === "done" ? "done" : "wait", cur = h0.q || "", other = false, otherErr = "", otherVal = "", focusAfter: "" | "card" | "noshow" = h0.q ? "card" : "";
  body.innerHTML = boss.skeleton(4, "Зареждаме решенията…");
  const S = screen<OwnerDecisions>(boss, {
    load: () => ownerApi.decisions().then(withKept), draw, err: "Отговорите ти са запазени. Опитай пак след малко.",
    after: (d) => {
      boss.badge("decisions", d.waits.blocks + (d.waits.next ? 1 : 0), ["чака теб", "чакат теб"]);
      const ta = body.querySelector<HTMLTextAreaElement>("#dc-other"); if (ta) ta.value = otherVal;
      if (focusAfter === "card") focusCard(); else if (focusAfter === "noshow") document.getElementById("dc-nh")?.focus({ preventScroll: true });
      focusAfter = "";
    },
    live: ["reservation.status", "note.created", "note.status", "owner.answer"],
  });
  let jumped = false;
  function jump() {
    if (jumped) return; jumped = true;
    const k = /(^#|&)noshow($|&)/.test(location.hash) ? "noshow" : /(^#|&)google($|&)/.test(location.hash) ? "google" : "";
    const t = k && document.getElementById(k); if (t) setTimeout(() => t.scrollIntoView({ block: "start" }), 60);
  }
  /* the answers waiting on the phone count as answered (marked "Записан на телефона") */
  function withKept(d: OwnerDecisions): OwnerDecisions {
    const K = keptAnswers(boss);
    d.questions = d.questions.map((q): QV => (K[q.id] ? { ...q, kept: true, answer: { answer: K[q.id].answer, other: K[q.id].text, at: new Date().toISOString(), status: "new", noteId: "", applied: false, changed: q.answer ? q.answer.changed + 1 : 0 } } : q));
    return d;
  }
  const qById = (d: OwnerDecisions, id: string) => d.questions.find((q) => q.id === id) || null;
  const lists = (d: OwnerDecisions) => ({ wait: d.questions.filter((q) => !q.answer), done: d.questions.filter((q) => !!q.answer) });

  function draw(d: OwnerDecisions): string {
    setTimeout(jump, 0);
    const CAN = d.canAnswer;
    let h = '<p class="ow-lead">' + (CAN ? "Тук решаваш. Отговорите отиват при агенцията като препоръка от собственика." : "На въпросите от агенцията отговаря собственикът. Тук ги виждаш само за четене.") + "</p>";
    h += '<div class="ow-grid">' + noshowHTML(d) + "</div>";
    h += '<div class="ow-sh" id="questions"><h2>Въпроси от агенцията</h2></div>';
    const L = lists(d), list = filt === "wait" ? L.wait : L.done, total = d.questions.length;
    const q0 = qById(d, cur);
    if (!q0 || list.indexOf(q0) < 0) cur = list[0] ? list[0].id : "";
    h += '<p class="ow-note" style="margin:-6px 4px 10px">' + L.done.length + " от " + total + ' са с отговор.</p><div class="dc-prog" aria-hidden="true"><div class="bar"><i style="width:' + (total ? (L.done.length / total) * 100 : 0) + '%"></i></div></div><div style="height:14px"></div>';
    h += '<div class="seg dc-filter" role="group" aria-label="Покажи"><button type="button" data-f="wait" aria-pressed="' + (filt === "wait") + '"><span><span class="lg">Чакат отговор</span><span class="sm">Чакат</span> · ' + L.wait.length + '</span></button><button type="button" data-f="done" aria-pressed="' + (filt === "done") + '">Отговорени · ' + L.done.length + "</button></div>";
    const q = qById(d, cur);
    h += '<div class="dc-wrap"><div class="dc-main">';
    if (!list.length) h += '<section class="ow-card">' + (filt === "wait"
      ? boss.empty({ icon: "check-circle", title: "Всички въпроси са с отговор", text: "Благодарим! Агенцията ги преглежда. Отговорите са в „Отговорени“.", action: L.done.length ? '<button class="pill pill-line pill-lg" type="button" data-f="done">Виж отговорите</button>' : "" })
      : boss.empty({ icon: "chat-circle-dots", title: "Още няма отговорени въпроси", text: CAN ? "Започни от първия: един бутон, ако си съгласен с варианта по подразбиране." : "Собственикът още не е отговорил.", action: '<button class="pill pill-line pill-lg" type="button" data-f="wait">Към въпросите</button>' })) + "</section>";
    else if (q) h += focusHTML(q, list, CAN);
    h += "</div>";
    if (list.length) {
      const groups: { n: string; l: QuestionView[] }[] = [];
      list.forEach((x) => { const g = grpName(x).split(" · ")[0]; let G = groups.find((y) => y.n === g); if (!G) { G = { n: g, l: [] }; groups.push(G); } G.l.push(x); });
      h += '<div class="dc-list">' + groups.map((g) => "<h3>" + esc(g.n) + " · " + g.l.length + '</h3><div class="rows">' + g.l.map((x) => {
        const a = x.answer;
        return '<button class="dc-row" type="button" data-q="' + esc(x.id) + '" aria-current="' + (x.id === cur) + '"><span class="n" aria-hidden="true">' + (x.n ? esc(x.n) : ic("ticket", 20)) + '</span><span class="t"><b>' + esc(x.text) + "</b><small>" +
          (a ? (a.answer === "default" ? "Съгласен с варианта по подразбиране" : "Друго: " + esc(a.other)) : (x.hasDefault ? "По подразбиране: " : "Сега в системата: ") + miss(x.def)) + '</small></span><span class="s">' +
          ((x as QV).kept ? '<span class="ow-tag warn">' + ic("hourglass", 16) + "Записан</span>" : a ? '<span class="ow-tag ok">' + ic("check", 16) + "Отговорен</span>" : ic("caret-right", 20)) + "</span></button>";
      }).join("") + "</div>").join("") + "</div>";
    }
    h += "</div>";
    h += '<div style="height:24px"></div><div class="ow-grid">' + googleHTML(d) + "</div>";
    return h;
  }

  function focusHTML(q: QuestionView, list: QuestionView[], CAN: boolean): string {
    const i = list.indexOf(q), canDef = q.hasDefault, a = q.answer;
    let h = '<section class="dc-q" id="dc-focus" aria-labelledby="dc-qt" data-edit-id="own.decisions.question" data-qid="' + esc(q.id) + '"><div class="eye"><span><b>Въпрос ' + (i + 1) + " от " + list.length + "</b></span><span>" + esc(grpName(q)) + (q.n ? " · т. " + esc(q.n) : "") + "</span></div>" +
      '<h3 id="dc-qt">' + esc(q.text) + "</h3>" +
      '<div class="dc-def"><small>' + (canDef ? "Вариант по подразбиране (така работи системата сега)" : "Сега в системата") + "</small><span>" + miss(q.def || "[ЛИПСВА]") + "</span></div>";
    const nextBtn = i < list.length - 1 ? '<button class="pill pill-soft pill-lg" type="button" data-next>Следващ' + ic("caret-right", 22) + "</button>" : "";
    if (a && !other && (q as QV).kept) {
      h += '<div class="dc-ans kept" role="status">' + ic("hourglass", 24) + "<span><b>" + (a.answer === "default" ? "Съгласен с варианта по подразбиране" : "Отговор: " + esc(a.other)) + '</b><span class="ow-muted">Записан на телефона, още не е изпратен. Тръгва сам, щом има връзка.</span></span></div>' +
        (nextBtn ? '<div class="dc-acts">' + nextBtn + "</div>" : "");
    } else if (a && !other) {
      h += '<div class="dc-ans" role="status">' + ic("check-circle", 24) + "<span><b>" + (a.answer === "default" ? "Съгласен с варианта по подразбиране" : "Отговор: " + esc(a.other)) + '</b><span class="ow-muted">Изпратен ' + esc(ago(a.at)) + " · " + esc(NSN[a.status] || "при агенцията") + (a.changed ? " · отговорът е сменян" : "") + "</span></span></div>" +
        '<div class="dc-acts">' + (CAN ? '<button class="pill pill-line pill-lg" type="button" data-change>' + ic("pencil-simple", 22) + "Промени отговора</button>" : "") + nextBtn + "</div>";
    } else if (!CAN) {
      h += '<p class="dc-ro">' + ic("lock", 22) + "<span><b>Отговаря собственикът.</b> Тук въпросът е само за четене.</span></p>" + (nextBtn ? '<div class="dc-acts">' + nextBtn + "</div>" : "");
    } else if (other || !canDef) {
      h += (a && a.applied ? '<p class="dc-ro">' + ic("info", 22) + "<span>Агенцията вече го е приложила. Новият отговор отива пак за преглед.</span></p>" : "") +
        '<div class="dc-other"><div class="field"><label for="dc-other">Твоят отговор</label><textarea class="input" id="dc-other" rows="3" placeholder="Напиши с няколко думи"' + (otherErr ? ' aria-invalid="true" aria-describedby="dc-oe"' : "") + "></textarea>" +
        (otherErr ? '<span class="err" id="dc-oe">' + esc(otherErr) + "</span>" : '<span class="help">Пиши свободно, агенцията ще се обади, ако нещо не е ясно.</span>') + "</div>" +
        '<div class="ow-row"><button class="pill pill-red pill-lg" type="button" data-send>' + ic("paper-plane-right", 22) + "Изпрати отговора</button>" +
        (canDef && a ? '<button class="pill pill-line pill-lg" type="button" data-agree>' + ic("check", 22) + "Съгласен с варианта</button>" : "") +
        (a || canDef ? '<button class="pill pill-line pill-lg" type="button" data-cancel>Откажи</button>' : "") + "</div></div>";
    } else {
      h += '<div class="dc-acts"><button class="pill pill-red pill-lg" type="button" data-agree>' + ic("check", 22) + 'Съгласен</button><button class="pill pill-line pill-lg" type="button" data-other>' + ic("chat-circle-dots", 22) + "Друго</button></div>";
    }
    if (CAN) h += '<p class="ow-note">Агенцията прилага отговора. Нищо не се сменя, докато тя не го одобри.</p>';
    return h + "</section>";
  }

  function noshowHTML(d: OwnerDecisions): string {
    const B = d.blocks, lim = B.limit || 2;
    return '<section class="ow-card wall" id="noshow" aria-labelledby="dc-nh" data-edit-id="own.decisions.noshow"><header><div><h2 id="dc-nh" tabindex="-1">Неявили се за блокиране<small>След ' + plural(lim, "неявяване", "неявявания") + " номерът чака решение. Решават собственик, управител или главен админ.</small></h2></div></header>" +
      (B.hidden ? '<p class="ow-note">Неявилите се не се виждат: ролята ти няма „Резервации“ или „Клиенти“. Въпросите на агенцията са по-долу.</p>' : B.rows.length ? '<div class="dc-ns">' + B.rows.map((b) => '<div class="it"><div><b>' + esc(b.name || "Без име") + '</b><span class="ow-muted"> · <span class="nw">' + esc(b.phone) + '</span> · <span class="nw">' + plural(b.count || lim, "неявяване", "неявявания") + "</span></span></div>" +
        '<p class="ow-note">Блокиран номер не може да резервира онлайн и да прави профил.</p>' +
        (B.canDecide ? '<div class="ow-row"><button class="pill pill-ink pill-lg" type="button" data-bl="block" data-ref="' + esc(b.ref) + '">' + ic("lock", 22) + 'Блокирай</button><button class="pill pill-line pill-lg" type="button" data-bl="clear" data-ref="' + esc(b.ref) + '">Не блокирай</button></div>' : "") + "</div>").join("") + "</div>"
        : '<p class="td-ok" style="display:flex;gap:12px;align-items:center;margin:0">' + ic("check-circle", 26) + "<span><b>Няма неявили се за решение.</b></span></p>") +
      '<p class="ow-note">' + (B.blocked ? plural(B.blocked, "блокиран номер", "блокирани номера") + ". " : "") + 'Целият списък и отблокирането: <a class="link" href="' + go.reservations("blocks") + '">Резервации · Блокиране' + ic("caret-right", 18) + "</a></p></section>";
  }

  const googleHTML = (d: OwnerDecisions) => '<section class="ow-card" id="google" aria-labelledby="dc-gh" data-edit-id="own.decisions.google"><header><div><h2 id="dc-gh">Google профил</h2></div>' + soon() + '</header><div class="dc-g">' +
    '<div class="it"><span class="ill">' + ic("clock", 22) + '</span><span><b>Работно време от едно място</b><span class="ow-muted">Сменяш часовете в админа, Google се обновява сам.</span> ' + miss(d.google.missing[0] || "") + "</span></div>" +
    '<div class="it"><span class="ill">' + ic("star", 22) + "</span><span><b>Рейтинг и отзиви</b>" + miss(d.google.missing[1] || "") + "</span></div></div></section>";

  function focusCard() {
    const f = body.querySelector<HTMLElement>("#dc-focus"); if (!f) return;
    f.scrollIntoView({ block: "start", behavior: "smooth" });
    const t = f.querySelector<HTMLElement>("h3")!; t.setAttribute("tabindex", "-1"); t.focus({ preventScroll: true });
  }
  const sync = () => setHash({ ...hashMap(), f: filt === "done" ? "done" : "", q: cur });

  /* ---------- the answer: one note per question; "Отмени" brings back the earlier answer (or none) ---------- */
  function send(q: QuestionView, kind: "default" | "other", text: string) {
    const was = cur, d = S.data()!;
    void act(boss, {
      op: "answer", args: [q.id, { answer: kind, text: kind === "other" ? text : undefined }], label: "Отговорът" + (q.n ? " на т. " + q.n : ""),
      offMsg: "Отговорът" + (q.n ? " на т. " + q.n : "") + " е записан на телефона. Тръгва сам, щом има връзка.",
      run: () => ownerApi.answer(q.id, { answer: kind, text: kind === "other" ? text : undefined }),
      ok: (r) => {
        other = false; otherErr = ""; otherVal = "";
        if (filt === "wait") { const w = lists(d).wait.filter((x) => x.id !== q.id); cur = w[0] ? w[0].id : ""; }
        focusAfter = "card"; sync(); void S.reload();
        boss.toast(r.applied ? r.msg : r.replaced ? "Отговорът е сменен" + (q.n ? " (т. " + q.n + ")" : "") : "Отговорът е при агенцията" + (q.n ? " (т. " + q.n + ")" : ""), {
          undo: () => { ownerApi.answerUndo(q.id).then(() => { cur = was; focusAfter = "card"; sync(); void S.reload(); }, (e) => boss.toast(e instanceof ApiError ? e.message : "Не успяхме да го върнем. Опитай пак.")); },
        });
      },
      /* without a connection: the card shows the answer as waiting and the next question comes, as after a success */
      queued: () => {
        other = false; otherErr = ""; otherVal = "";
        withKept(d);
        if (filt === "wait") { const w = lists(d).wait; cur = w[0] ? w[0].id : ""; }
        sync(); S.redraw(); focusCard();
      },
      fail: (e) => { if (e instanceof ApiError && e.status === 422 && e.fields && e.fields.text) { otherErr = e.fields.text; other = true; S.redraw(); body.querySelector<HTMLElement>("#dc-other")?.focus(); return true; } return false; },
    });
  }

  body.addEventListener("input", (e) => { const t = e.target as HTMLTextAreaElement; if (t.id === "dc-other") otherVal = t.value; });
  body.addEventListener("click", (e) => {
    const tg = e.target as Element, d = S.data(); if (!d) return;
    let t: HTMLElement | null;
    const q = qById(d, cur);
    if ((t = tg.closest<HTMLElement>("[data-f]"))) { filt = t.dataset.f === "done" ? "done" : "wait"; cur = ""; other = false; otherErr = ""; S.redraw(); sync(); body.querySelector<HTMLElement>('.dc-filter [data-f="' + filt + '"]')?.focus({ preventScroll: true }); return; }
    if ((t = tg.closest<HTMLElement>("[data-q]"))) { cur = t.dataset.q!; other = false; otherErr = ""; otherVal = ""; S.redraw(); sync(); focusCard(); return; }
    if (tg.closest("[data-other], [data-change]")) {
      const a = q && q.answer; other = true; otherErr = ""; otherVal = a && a.answer === "other" ? a.other : ""; S.redraw();
      const ta = body.querySelector<HTMLTextAreaElement>("#dc-other"); if (ta) { ta.value = otherVal; ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return;
    }
    if (tg.closest("[data-cancel]")) { other = false; otherErr = ""; S.redraw(); focusCard(); return; }
    if (tg.closest("[data-next]")) { const l = filt === "wait" ? lists(d).wait : lists(d).done, i = q ? l.indexOf(q) : -1; if (l[i + 1]) cur = l[i + 1].id; other = false; otherErr = ""; S.redraw(); sync(); focusCard(); return; }
    if (tg.closest("[data-agree], [data-send]")) {
      if (!d.canAnswer || !q) return;
      const kind = tg.closest("[data-agree]") ? "default" : "other", txt = (otherVal || "").trim();
      if (kind === "other" && !txt) { otherErr = "Напиши отговора си."; other = true; S.redraw(); body.querySelector<HTMLElement>("#dc-other")?.focus(); return; }
      send(q, kind, txt); return;
    }
    if ((t = tg.closest<HTMLElement>("[data-bl]"))) {
      const ref = t.dataset.ref!, b = d.blocks.rows.find((x) => x.ref === ref); if (!b) return;
      const who = b.name || b.phone;
      if (t.dataset.bl === "block") boss.confirm({ title: "Да блокирам ли?", html: "<p><b>" + esc(who) + "</b>, номер " + esc(b.phone) + ", няма да може да резервира онлайн и да прави профил. Отблокира се от „Резервации“ в админа.</p>", ok: "Блокирай", icon: "lock", danger: true }, () => block(ref, "block", who));
      else block(ref, "clear", who);
    }
  });
  /* no "Отмени" (decision 16.11): the core does not bring back exactly the earlier state */
  function block(ref: string, action: "block" | "clear", who: string) {
    void act(boss, { op: "block", args: [ref, action], label: action === "block" ? who + " е блокиран" : who + " не е блокиран", run: () => ownerApi.block(ref, action),
      offMsg: who + (action === "block" ? " ще бъде блокиран" : " ще остане без блокиране") + ", щом има връзка. Решението е записано на телефона.",
      ok: () => { focusAfter = "noshow"; void S.reload(); boss.toast(action === "block" ? who + " е блокиран." : who + " не е блокиран.", { action: { label: "Резервации", href: go.reservations("blocks") } }); },
      queued: () => { document.getElementById("dc-nh")?.focus({ preventScroll: true }); } });
  }
}
