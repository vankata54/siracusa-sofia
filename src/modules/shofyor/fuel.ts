/* Шофьор · Гориво (/shofyor/gorivo/; design/pages-shofyor/fuel.html). The car (changed through the car sheet), litres,
   the sum in €, the km (big fields, numeric keyboard), the price per litre live, "Напълних резервоара догоре", "Платих в
   брой от събраните пари", the photo of the receipt (optional: OPEN-QUESTIONS 29; "Камерата не работи"), the core's
   errors under the fields, the entries of the shift. With no connection the entry is kept on the phone. */
import { mountDriver, driverApi, ApiError, ic, esc, fmt, MISS, kmText, type DQueued } from "./app.ts";
import type { FuelPage, FuelInput } from "../../client/api-driver.ts";

const num = (v: string) => parseFloat(String(v || "").replace(",", ".").replace(/\s/g, ""));
const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export async function initFuel(): Promise<void> {
  const drv0 = await mountDriver({ screen: "fuel", tab: "fuel", title: "Гориво", bar: true });
  if (!drv0) return;
  const drv = drv0;
  const { st } = drv, main = st.main, bar = st.bar!;
  let P: FuelPage | null = null, photo: string | null = null, noPhoto = false, full = false, paidCash = false, errs: Record<string, string> = {}, sending = false;
  const v: Record<string, string> = { litres: "", sum: "", km: "" };
  bar.innerHTML = '<button class="pill pill-red" type="button" data-save>' + ic("check", 22) + "Запиши зареждането</button>";

  function field(id: string, label: string, unit: string, mode: string, ph: string, help?: string): string {
    return '<div class="field bigf' + (id === "km" ? " full" : "") + '"><label for="f-' + id + '">' + label + '</label><div class="wrapi"><input class="input" id="f-' + id + '" data-f="' + id + '" inputmode="' + mode + '" autocomplete="off" placeholder="' + ph + '" value="' + esc(v[id]) + '"' +
      (errs[id] ? ' aria-invalid="true" aria-describedby="e-' + id + '"' : help ? ' aria-describedby="h-' + id + '"' : "") + '><span class="u">' + unit + "</span></div>" +
      (errs[id] ? '<span class="err" id="e-' + id + '">' + esc(errs[id]) + "</span>" : help ? '<span class="help" id="h-' + id + '">' + help + "</span>" : "") + "</div>";
  }
  function render() {
    if (!P) return;
    const car = P.car, q = drv.queued().filter((x) => x.a.k === "fuel");
    let h = '<section class="st-sec"><div class="carline"><span class="ii">' + ic("car", 24) + "</span><span><b>" + esc(car.n) + "</b><small>Гориво " + MISS("[ЛИПСВА: вид]") + " · рег. № " + (car.plate ? esc(car.plate) : MISS("[ЛИПСВА]")) + '</small></span><button class="pill pill-soft" type="button" data-carsheet>Смени</button></div></section>';
    h += '<section class="st-sec"><div class="fgrid">' + field("litres", "Литри", "л", "decimal", "0,00") + field("sum", "Сума", "€", "decimal", "0,00") +
      field("km", "Километраж", "км", "numeric", "0", "Числото от таблото на колата. Последно записан: " + kmText(P.lastKm) + " км.") + "</div>" +
      '<div class="calc" style="margin-top:12px" id="calc"><span>Цена на литър</span><b aria-live="polite">-</b></div><p class="pwarn" id="pwarn" role="status"></p>' +
      (P.lastPerLitre != null ? '<p class="small muted" style="margin:6px 4px 0">При последното зареждане: ' + f2(P.lastPerLitre) + " €/л.</p>" : "") +
      '<label class="chk" style="margin-top:6px"><input type="checkbox" id="full"' + (full ? " checked" : "") + '><span>Напълних резервоара догоре <span class="small muted" style="display:block;font-weight:600">Така системата смята реалния разход (л/100 км).</span></span></label>' +
      '<label class="chk"><input type="checkbox" id="pc"' + (paidCash ? " checked" : "") + '><span>Платих в брой от събраните пари <span class="small muted" style="display:block;font-weight:600">Сумата се вади от парите за предаване в края на смяната. Сега имаш ' + esc(fmt(P.cashOnHand)) + " в брой.</span></span></label></section>";
    h += '<section class="st-sec"><p class="st-cap">Снимка на касовата бележка</p><button class="slot' + (photo ? " has" : "") + '" type="button" data-photo' + (errs.photo ? ' aria-describedby="e-photo"' : "") + '><span class="ii">' + ic(photo ? "check" : "image", 30) + "</span><b>" + (photo ? "Снимката е добавена" : "Снимай бележката") + "</b><span>" + (photo ? "Докосни, за да смениш снимката" : "Отваря камерата. Бележката трябва да се чете ясно. По желание.") + "</span></button>" +
      '<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" data-file hidden>' +
      (photo ? "" : '<label class="chk"><input type="checkbox" id="np"' + (noPhoto ? " checked" : "") + "><span>Камерата не работи: ще дам бележката на управителя</span></label>") +
      (errs.photo ? '<p class="err" id="e-photo" style="margin:6px 4px 0;color:var(--danger);font-weight:600;font-size:16px">' + esc(errs.photo) + "</p>" : "") + "</section>";
    const rows = [...q.map((x) => ({ q: x, i: (x.a as { input: FuelInput }).input })), ...P.entries.map((e) => ({ q: null as DQueued | null, e }))];
    h += '<section class="st-sec"><div class="st-h"><h2>Тази смяна</h2></div>' + (rows.length ? '<div class="icard hist">' + rows.map((r) => {
      if ("e" in r && r.e) { const e = r.e; return '<div class="h"><b>' + f2(e.litres) + " л · " + esc(fmt(e.sum)) + '</b><span class="tnum">' + esc(e.atClock) + "</span><span>" + esc(e.carName) + " · " + kmText(e.km) + " км" + (e.full ? " · пълен резервоар" : "") + (e.cash ? " · в брой" : "") + (e.photo ? " · със снимка" : e.noPhoto ? " · бележката у управителя" : "") + "</span><span>изпратено</span></div>"; }
      const i = (r as { i: FuelInput }).i; return '<div class="h"><b>' + esc(String(i.litres).replace(".", ",")) + " л · " + esc(fmt(num(String(i.sum)))) + '</b><span class="tnum">' + esc(st.clock(r.q!.at)) + "</span><span>" + esc(P!.car.n) + " · " + esc(String(i.km)) + " км</span><span>чака връзка</span></div>";
    }).join("") + "</div>" : '<p class="muted" style="margin:0">Още няма зареждания.</p>') +
      '<p class="small muted" style="margin:12px 0 0">Отчетът за гориво (по ден, шофьор и автомобил) е в админ панела. Разходът (л/100 км) се смята от зарежданията „догоре“.</p></section>';
    main.innerHTML = h;
    calc();
  }
  function calc() {
    const l = num(v.litres), s = num(v.sum), c = main.querySelector("#calc b");
    if (c) c.textContent = l > 0 && s > 0 ? f2(s / l) + " €/л" : "-";
    /* a soft sign only: a price far from a litre of fuel is usually a typo in the litres or the sum */
    const w = main.querySelector("#pwarn"), odd = l > 0 && s > 0 && (s / l < 1 || s / l > 3);
    if (w) w.textContent = odd ? "Провери литрите и сумата: " + f2(s / l) + " €/л е необичайна цена." : "";
  }
  async function load() {
    try { P = await drv.cached("fuel", () => driverApi.fuel()); st.synced(); render(); }
    catch (e) { st.fail(e); }
  }
  drv.onChange(() => { if (!main.contains(document.activeElement) || !(document.activeElement instanceof HTMLInputElement)) void load(); });

  main.addEventListener("input", (e) => { const t = e.target as HTMLInputElement; if (t.dataset.f) { v[t.dataset.f] = t.value; calc(); } });
  main.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "full") full = t.checked;
    if (t.id === "pc") paidCash = t.checked;
    if (t.id === "np") { noPhoto = t.checked; delete errs.photo; }
    if (t.dataset.file !== undefined && t.files && t.files[0]) void upload(t.files[0]);
  });
  main.addEventListener("click", (e) => {
    if ((e.target as Element).closest("[data-carsheet]")) { e.stopPropagation(); void drv.carSheet(() => load()); return; }
    if ((e.target as Element).closest("[data-photo]")) main.querySelector<HTMLInputElement>("[data-file]")!.click();
  }, true);
  async function upload(file: File) {
    const slot = main.querySelector<HTMLElement>("[data-photo] b");
    if (slot) slot.textContent = "Качваме снимката …";
    try { photo = (await driverApi.receipt(file)).url; delete errs.photo; noPhoto = false; st.toast("Снимката е добавена."); }
    catch (er) { photo = null; errs.photo = er instanceof ApiError && er.code === "offline" ? "Няма връзка: снимката не се качи. Опитай пак или дай бележката на управителя." : er instanceof ApiError ? er.message : "Снимката не се качи."; }
    render();
  }
  bar.addEventListener("click", async (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>("[data-save]"); if (!b || sending) return;
    const input: FuelInput = { litres: v.litres.trim(), sum: v.sum.trim(), km: v.km.trim(), full, cash: paidCash, photo, noPhoto: !photo && noPhoto };
    sending = true; b.disabled = true; errs = {};
    try {
      const r = await drv.act({ k: "fuel", input });
      const was = { ...v };
      v.litres = ""; v.sum = ""; v.km = ""; photo = null; noPhoto = false; full = false; paidCash = false;
      if (r.queued) { render(); st.toast("Записано на телефона. Тръгва, щом има връзка."); }
      else { await load(); st.toast("Зареждането е записано: " + was.litres.replace(".", ",") + " л · " + fmt(num(was.sum)) + "."); }
      window.scrollTo({ top: 0 });
    } catch (er) {
      if (er instanceof ApiError && er.fields) { errs = er.fields; render(); main.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(); }
      else drv.oops(er);
    } finally { sending = false; b.disabled = false; }
  });
  await load();
}
