/* AI assistant v1: rule-based, answers only from the menu data (same scripted scenarios as the prototype). */
import { items, menu, isOut } from "./data.ts";
import { art, ic } from "./render.ts";
import { esc, fmt } from "./format.ts";
import { url } from "./routes.ts";

export type AiKind = "group" | "lunch" | "allergen" | "other";

export function aiPanelHTML(): string {
  return '<div class="aimsgs" data-aimsgs aria-live="polite"><div class="msg bot">Здравейте! Кажете ми за колко души поръчвате и какво обича всеки. Предлагам само ястия от нашето меню.</div></div>' +
    '<div class="chips aichips" style="margin:0;padding:2px 0"><button class="chip aichip" type="button" data-aiq="group">Ние сме четирима: един е вегетарианец и не яде лук, един иска месо, един обича сиренца</button><button class="chip aichip" type="button" data-aiq="lunch">Какво има в обедното меню днес?</button><button class="chip aichip" type="button" data-aiq="allergen">Кое е без глутен?</button></div>' +
    '<form class="aiform" data-aiform><label class="vh" for="aiq">Вашият въпрос</label><input id="aiq" type="text" placeholder="Напишете какво търсите" autocomplete="off"><button class="pill pill-red" type="submit" aria-label="Изпрати">' + ic("paper-plane-right", 20) + '</button></form><p class="aifine">Отговаря само от менюто. Алергените проверявайте и на страницата на ястието.</p>';
}

/** Classify free text into one of the scripted answers. */
export function aiClassify(v: string): AiKind {
  return /четир|вегетари|лук|сирен|месо|души|трима|двама/i.test(v) ? "group" : /обед/i.test(v) ? "lunch" : /глутен|алерг/i.test(v) ? "allergen" : "other";
}

export function aiPlan() {
  const I2 = items.filter((x) => !isOut(x));
  const veg = I2.filter((x) => x.t.indexOf("veg") > -1 && x.course === "main" && x.noOnion).sort((a, b) => b.p - a.p)[0];
  const meat = I2.filter((x) => x.cat === "skara-bertha").sort((a, b) => b.p - a.p)[0];
  const cheese = I2.filter((x) => /сиренца|формаджи/i.test(x.n)).sort((a, b) => a.p - b.p)[0];
  return ([["Вегетарианец, без лук", veg, "Без лук и без месо по състава."], ["Иска месо", meat, "Най-поръчваното от скарата Bertha."], ["Обича сиренца", cheese, "Хрупкави, с домашно сладко от боровинки."]] as const)
    .filter((z) => z[1]);
}

export function aiReply(kind: AiKind): string {
  if (kind === "group") {
    const plan = aiPlan(), ids: string[] = [];
    let tot = 0;
    const rows = plan.map((z) => { const x = z[1]!; ids.push(x.id); tot += x.p; return '<div class="prow"><span class="pic">' + art(x) + "</span><span><small>" + z[0] + "</small><b>" + esc(x.n) + "</b><em>" + z[2] + '</em></span><span class="price">' + fmt(x.p) + "</span></div>"; }).join("");
    return "<p>Ето предложение за трима от вас:</p>" + rows + '<p>А четвъртият какво обича? Кажете ми и ще допълня.</p><button class="pill pill-red pill-block" type="button" data-aiadd="' + ids.join(",") + '" style="margin-top:6px">Добави всичко · ' + fmt(tot) + "</button>";
  }
  if (kind === "lunch") {
    const L = menu.lunch.items.filter((x) => x.p);
    const pick = [L[0], L[7], L[12], L[16]].filter(Boolean);
    return '<p>Обедното меню за днес, до 15:00:</p><ul class="ailist">' + pick.map((x) => "<li>" + esc(x.n) + " · " + fmt(x.p as number) + "</li>").join("") + '</ul><p><a class="link" href="' + url.lunch() + '">Цялото обедно меню' + ic("caret-right", 16) + "</a></p>";
  }
  if (kind === "allergen") {
    const g = items.filter((x) => x.comp && x.al.indexOf("gluten") < 0 && x.course === "main").slice(0, 4);
    return '<p>По състава без глутен изглеждат:</p><ul class="ailist">' + g.map((x) => '<li><a href="' + url.dish(x) + '">' + esc(x.n) + "</a></li>").join("") + '</ul><p class="muted small">Това е предварително, от състава. Кухнята още потвърждава алергените.</p>';
  }
  return "<p>Засега отговарям на въпроси за менюто, обедното меню и алергените. Опитайте с някой от примерите отгоре или ни се обадете.</p>";
}
