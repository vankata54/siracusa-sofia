import { t as __exportAll } from "./rolldown-runtime_D8jQpDG7.mjs";
import { C as addAttribute, T as unescapeHTML, c as renderComponent, g as maybeRenderHead, h as renderTemplate, l as Fragment } from "./server_DqW8LlMt.mjs";
import { B as renderScript, C as eta, E as ALLERGENS, F as esc, H as createComponent, I as fmt, L as plural$1, O as FILTERS, R as ic, S as url, T as state, V as createAstro, _ as isOut, c as passes, g as inCat, h as cats, k as RESTAURANT, l as searchScores, m as catById, o as NOUN, p as byId, r as dishCard, s as noun, t as art, u as sortInCat, v as items, x as $$Base, z as registerIcons } from "./lib_C2pGS49A.mjs";
import "./info_D6E2Z_vY.mjs";
// src/lib/icons/funnel.ts
registerIcons({ "funnel": "<path d=\"M230.6,49.53A15.81,15.81,0,0,0,216,40H40A16,16,0,0,0,28.19,66.76l.08.09L96,139.17V216a16,16,0,0,0,24.87,13.32l32-21.34A16,16,0,0,0,160,194.66V139.17l67.74-72.32.08-.09A15.8,15.8,0,0,0,230.6,49.53ZM40,56h0Zm106.18,74.58A8,8,0,0,0,144,136v58.66L112,216V136a8,8,0,0,0-2.16-5.47L40,56H216Z\"/>" });
// src/lib/icons/plant.ts
registerIcons({ "plant": "<path d=\"M247.63,47.89a8,8,0,0,0-7.52-7.52c-51.76-3-93.32,12.74-111.18,42.22-11.8,19.49-11.78,43.16-.16,65.74a71.34,71.34,0,0,0-14.17,27L98.33,159c7.82-16.33,7.52-33.35-1-47.49-13.2-21.79-43.67-33.47-81.5-31.25a8,8,0,0,0-7.52,7.52c-2.23,37.83,9.46,68.3,31.25,81.5A45.82,45.82,0,0,0,63.44,176,54.58,54.58,0,0,0,87,170.33l25,25V224a8,8,0,0,0,16,0V194.51a55.61,55.61,0,0,1,12.27-35,73.91,73.91,0,0,0,33.31,8.4,60.9,60.9,0,0,0,31.83-8.86C234.89,141.21,250.67,99.65,247.63,47.89ZM47.81,155.6C32.47,146.31,23.79,124.32,24,96c28.32-.24,50.31,8.47,59.6,23.81,4.85,8,5.64,17.33,2.46,26.94L61.65,122.34a8,8,0,0,0-11.31,11.31l24.41,24.41C65.14,161.24,55.82,160.45,47.81,155.6Zm149.31-10.22c-13.4,8.11-29.15,8.73-45.15,2l53.69-53.7a8,8,0,0,0-11.31-11.31L140.65,136c-6.76-16-6.15-31.76,2-45.15,13.94-23,47-35.82,89.33-34.83C232.94,98.34,220.14,131.44,197.12,145.38Z\"/>" });
// src/lib/icons/users-three.ts
registerIcons({ "users-three": "<path d=\"M244.8,150.4a8,8,0,0,1-11.2-1.6A51.6,51.6,0,0,0,192,128a8,8,0,0,1-7.37-4.89,8,8,0,0,1,0-6.22A8,8,0,0,1,192,112a24,24,0,1,0-23.24-30,8,8,0,1,1-15.5-4A40,40,0,1,1,219,117.51a67.94,67.94,0,0,1,27.43,21.68A8,8,0,0,1,244.8,150.4ZM190.92,212a8,8,0,1,1-13.84,8,57,57,0,0,0-98.16,0,8,8,0,1,1-13.84-8,72.06,72.06,0,0,1,33.74-29.92,48,48,0,1,1,58.36,0A72.06,72.06,0,0,1,190.92,212ZM128,176a32,32,0,1,0-32-32A32,32,0,0,0,128,176ZM72,120a8,8,0,0,0-8-8A24,24,0,1,1,87.24,82a8,8,0,1,0,15.5-4A40,40,0,1,0,37,117.51,67.94,67.94,0,0,0,9.6,139.19a8,8,0,1,0,12.8,9.61A51.6,51.6,0,0,1,64,128,8,8,0,0,0,72,120Z\"/>" });
// src/lib/icons/grains.ts
registerIcons({ "grains": "<path d=\"M208,56a87.53,87.53,0,0,0-31.85,6c-14.32-29.7-43.25-44.46-44.57-45.12a8,8,0,0,0-7.16,0c-1.33.66-30.25,15.42-44.57,45.12A87.53,87.53,0,0,0,48,56a8,8,0,0,0-8,8v80a88,88,0,0,0,176,0V64A8,8,0,0,0,208,56ZM120,215.56A72.1,72.1,0,0,1,56,144V128.44A72.1,72.1,0,0,1,120,200Zm0-66.1a88,88,0,0,0-64-37.09V72.44A72.1,72.1,0,0,1,120,144ZM94.15,69.11c9.22-19.21,26.41-31.33,33.85-35.9,7.44,4.58,24.63,16.7,33.84,35.9A88.61,88.61,0,0,0,128,107.36,88.57,88.57,0,0,0,94.15,69.11ZM200,144a72.1,72.1,0,0,1-64,71.56V200a72.1,72.1,0,0,1,64-71.56Zm0-31.63a88,88,0,0,0-64,37.09V144a72.1,72.1,0,0,1,64-71.56Z\"/>" });
// src/lib/icons/drop.ts
registerIcons({ "drop": "<path d=\"M174,47.75a254.19,254.19,0,0,0-41.45-38.3,8,8,0,0,0-9.18,0A254.19,254.19,0,0,0,82,47.75C54.51,79.32,40,112.6,40,144a88,88,0,0,0,176,0C216,112.6,201.49,79.32,174,47.75ZM128,216a72.08,72.08,0,0,1-72-72c0-57.23,55.47-105,72-118,16.53,13,72,60.75,72,118A72.08,72.08,0,0,1,128,216Zm55.89-62.66a57.6,57.6,0,0,1-46.56,46.55A8.75,8.75,0,0,1,136,200a8,8,0,0,1-1.32-15.89c16.57-2.79,30.63-16.85,33.44-33.45a8,8,0,0,1,15.78,2.68Z\"/>" });
// src/lib/icons/barbell.ts
registerIcons({ "barbell": "<path d=\"M248,120h-8V88a16,16,0,0,0-16-16H208V64a16,16,0,0,0-16-16H168a16,16,0,0,0-16,16v56H104V64A16,16,0,0,0,88,48H64A16,16,0,0,0,48,64v8H32A16,16,0,0,0,16,88v32H8a8,8,0,0,0,0,16h8v32a16,16,0,0,0,16,16H48v8a16,16,0,0,0,16,16H88a16,16,0,0,0,16-16V136h48v56a16,16,0,0,0,16,16h24a16,16,0,0,0,16-16v-8h16a16,16,0,0,0,16-16V136h8a8,8,0,0,0,0-16ZM32,168V88H48v80Zm56,24H64V64H88V192Zm104,0H168V64h24V175.82c0,.06,0,.12,0,.18s0,.12,0,.18V192Zm32-24H208V88h16Z\"/>" });
// src/lib/icons/moped.ts
registerIcons({ "moped": "<path d=\"M216,128a39.3,39.3,0,0,0-6.27.5L175.49,37.19A8,8,0,0,0,168,32H136a8,8,0,0,0,0,16h26.46l32.3,86.13a40.13,40.13,0,0,0-18,25.87H136.54l-25-66.81A8,8,0,0,0,104,88H24a8,8,0,0,0,0,16h8v13.39A56.12,56.12,0,0,0,0,168a8,8,0,0,0,8,8h8.8a40,40,0,0,0,78.4,0h81.6A40,40,0,1,0,216,128ZM42.67,130.27A8,8,0,0,0,48,122.73V104H98.46l21,56H16.81A40.07,40.07,0,0,1,42.67,130.27ZM56,192a24,24,0,0,1-22.62-16H78.62A24,24,0,0,1,56,192Zm160,0a24,24,0,0,1-15.43-42.36l7.94,21.17a8,8,0,0,0,15-5.62L215.55,144H216a24,24,0,0,1,0,48Z\"/>" });
// src/lib/icons/storefront.ts
registerIcons({ "storefront": "<path d=\"M232,96a7.89,7.89,0,0,0-.3-2.2L217.35,43.6A16.07,16.07,0,0,0,202,32H54A16.07,16.07,0,0,0,38.65,43.6L24.31,93.8A7.89,7.89,0,0,0,24,96h0v16a40,40,0,0,0,16,32v72a8,8,0,0,0,8,8H208a8,8,0,0,0,8-8V144a40,40,0,0,0,16-32V96ZM54,48H202l11.42,40H42.61Zm50,56h48v8a24,24,0,0,1-48,0Zm-16,0v8a24,24,0,0,1-35.12,21.26,7.88,7.88,0,0,0-1.82-1.06A24,24,0,0,1,40,112v-8ZM200,208H56V151.2a40.57,40.57,0,0,0,8,.8,40,40,0,0,0,32-16,40,40,0,0,0,64,0,40,40,0,0,0,32,16,40.57,40.57,0,0,0,8-.8Zm4.93-75.8a8.08,8.08,0,0,0-1.8,1.05A24,24,0,0,1,168,112v-8h48v8A24,24,0,0,1,204.93,132.2Z\"/>" });
// src/lib/icons/warning-circle.ts
registerIcons({ "warning-circle": "<path d=\"M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z\"/>" });
// src/lib/icons/warning.ts
registerIcons({ "warning": "<path d=\"M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z\"/>" });
// src/lib/icons/sun.ts
registerIcons({ "sun": "<path d=\"M120,40V16a8,8,0,0,1,16,0V40a8,8,0,0,1-16,0Zm72,88a64,64,0,1,1-64-64A64.07,64.07,0,0,1,192,128Zm-16,0a48,48,0,1,0-48,48A48.05,48.05,0,0,0,176,128ZM58.34,69.66A8,8,0,0,0,69.66,58.34l-16-16A8,8,0,0,0,42.34,53.66Zm0,116.68-16,16a8,8,0,0,0,11.32,11.32l16-16a8,8,0,0,0-11.32-11.32ZM192,72a8,8,0,0,0,5.66-2.34l16-16a8,8,0,0,0-11.32-11.32l-16,16A8,8,0,0,0,192,72Zm5.66,114.34a8,8,0,0,0-11.32,11.32l16,16a8,8,0,0,0,11.32-11.32ZM48,128a8,8,0,0,0-8-8H16a8,8,0,0,0,0,16H40A8,8,0,0,0,48,128Zm80,80a8,8,0,0,0-8,8v24a8,8,0,0,0,16,0V216A8,8,0,0,0,128,208Zm112-88H216a8,8,0,0,0,0,16h24a8,8,0,0,0,0-16Z\"/>" });
// src/lib/icons/moon.ts
registerIcons({ "moon": "<path d=\"M233.54,142.23a8,8,0,0,0-8-2,88.08,88.08,0,0,1-109.8-109.8,8,8,0,0,0-10-10,104.84,104.84,0,0,0-52.91,37A104,104,0,0,0,136,224a103.09,103.09,0,0,0,62.52-20.88,104.84,104.84,0,0,0,37-52.91A8,8,0,0,0,233.54,142.23ZM188.9,190.34A88,88,0,0,1,65.66,67.11a89,89,0,0,1,31.4-26A106,106,0,0,0,96,56,104.11,104.11,0,0,0,200,160a106,106,0,0,0,14.92-1.06A89,89,0,0,1,188.9,190.34Z\"/>" });
// src/lib/icons/magnifying-glass.ts
registerIcons({ "magnifying-glass": "<path d=\"M229.66,218.34l-50.07-50.06a88.11,88.11,0,1,0-11.31,11.31l50.06,50.07a8,8,0,0,0,11.32-11.32ZM40,112a72,72,0,1,1,72,72A72.08,72.08,0,0,1,40,112Z\"/>" });
// src/pages/menu/_menu.ts
var MAIN_CATS = cats.filter((c) => c.id !== "zakuski");
var MAIN_ITEMS = items.filter((x) => x.cat !== "zakuski");
var BF_ITEMS = inCat("zakuski");
var FICON = {
	veg: "leaf",
	hot: "pep"
};
var FIC = { noonion: "plant" };
var fic = (f) => FIC[f.id] || f.icon;
var plural = (n) => plural$1(n, "ястие", "ястия");
var cap = (s) => {
	s = String(s || "").trim().replace(/,(?=\S)/g, ", ");
	return s.charAt(0).toUpperCase() + s.slice(1);
};
ALLERGENS.map((a) => a[0]);
var scopeItems = (st) => st.menu === "bf" ? BF_ITEMS : MAIN_ITEMS;
var scopeCats = (st) => st.menu === "bf" ? [catById.zakuski] : MAIN_CATS;
function results(st) {
	const qv = st.q.trim();
	let list = scopeItems(st).filter((x) => passes(x, st));
	let sc;
	if (qv) {
		sc = searchScores(list, qv);
		list = list.filter((x) => sc[x.id]);
	}
	const groups = scopeCats(st).map((c) => {
		const it = sortInCat(list.filter((x) => x.cat === c.id), sc);
		return {
			c,
			items: it,
			top: sc ? Math.max(0, ...it.map((x) => sc[x.id])) : 0
		};
	}).filter((g) => g.items.length);
	if (qv) groups.sort((a, b) => b.top - a.top);
	return {
		list,
		groups
	};
}
function catDesc(c, shown) {
	const it = inCat(c.id), parts = [(shown < it.length ? shown + " от " : "") + noun(c.id, it.length)];
	const g = it.map((x) => {
		const m = /(\d+)\s*(гр|мл)/.exec(x.g);
		return m ? [+m[1], m[2]] : null;
	}).filter(Boolean);
	if (g.length) {
		const lo = Math.min(...g.map((z) => z[0])), hi = Math.max(...g.map((z) => z[0]));
		parts.push((lo === hi ? lo : lo + " - " + hi) + " " + g[0][1] + ".");
	}
	const ps = it.map((x) => x.p), plo = Math.min(...ps), phi = Math.max(...ps);
	parts.push(plo === phi ? fmt(plo) : "от " + fmt(plo) + " до " + fmt(phi));
	const v = it.filter((x) => x.t.indexOf("veg") > -1).length;
	if (v && v < it.length) parts.push(v + " вегетариански");
	return parts.join(" · ");
}
/** One dish card: the shared dishCard + the composition line; "no allergen data" and "later" variants. */
function card(x, o = {}) {
	let h = dishCard(x);
	if (o.lazy) h = h.replace(art(x), "").replace("class=\"pic ", "data-art=\"" + x.id + "\" class=\"pic ");
	if (x.comp) h = h.replace("</a><div class=\"rowp\">", "<span class=\"cp\">" + esc(cap(x.comp)) + "</span></a><div class=\"rowp\">");
	if (o.nd && !x.comp) h = h.replace("</a><div class=\"rowp\">", "<span class=\"nodata\">" + ic("info", 18) + "Няма данни за алергени, попитайте ни</span></a><div class=\"rowp\">");
	if (o.later) h = h.replace("class=\"pic ", "class=\"pic out ").replace(/<button class="plus"[\s\S]*?<\/button>/, "<span class=\"later\">" + o.later + "</span>");
	return h;
}
function sectionHTML(g, o) {
	const c = g.c, nn = NOUN[c.id];
	return "<section class=\"mcat\" id=\"c-" + c.id + "\" data-cat=\"" + c.id + "\" aria-labelledby=\"h-" + c.id + "\"" + (o.hidden ? " hidden" : "") + "><div class=\"sec-h\"><h2 class=\"h2\" id=\"h-" + c.id + "\">" + esc(c.n) + "</h2>" + (o.menu === "main" ? "<a class=\"link\" href=\"" + url.cat(c.id) + "\"" + (nn ? "" : " aria-label=\"Към категорията " + esc(c.n) + "\"") + ">" + (nn ? "Всички " + nn[1] : "Към категорията") + ic("caret-right", 18) + "</a>" : "") + "</div><p class=\"cdesc\">" + catDesc(c, g.items.length) + "</p>" + (o.q ? "" : "<p class=\"cseo missing\">[ЛИПСВА: SEO текст за „" + esc(c.n) + "“, 2 - 3 изречения]</p>") + "<div class=\"grid-dishes\">" + g.items.map((x) => card(x, {
		nd: o.nd,
		later: o.later,
		lazy: o.lazy
	})).join("") + "</div></section>";
}
/** Sub-line under each menu in the segment (depends on the hour). */
function segSub(kind, S) {
	if (kind === "main") return plural(MAIN_ITEMS.length);
	if (kind === "lunch") {
		if (S.lunch) return "до 15:00";
		if (S.lunchDiscount) return "<span class=\"tg\"><i>-30%</i>вземане</span>";
		return S.m < 600 ? "от 10:00" : "утре от 10:00";
	}
	if (S.breakfast) return "до 11:30";
	return S.m < 600 ? "от 10:00" : "утре от 10:00";
}
/** The delivery / pickup line under the lead (empty when the kitchen is closed). */
function etaLine(S, e) {
	if (S.delivery) return "<p class=\"eta" + (e.busy ? " warn" : "") + "\" data-eta>" + ic("moped", 20) + "<b>" + (e.busy ? "Доставка: " + e.text.charAt(0).toLowerCase() + e.text.slice(1) : "Доставка сега: " + e.text).replace(/около (\d+) мин/, "около&nbsp;$1&nbsp;мин") + "</b></p>";
	if (S.kitchen) return "<p class=\"eta warn\" data-eta>" + ic("storefront", 20) + "<b>Вземане от място <span>· готово след около&nbsp;20&nbsp;мин</span></b></p>";
	return "<p class=\"eta\" data-eta hidden></p>";
}
function filterChipsHTML(st) {
	const list = scopeItems(st), aOn = st.a.length;
	let h = "<button class=\"chip\" type=\"button\" data-sheet=\"al\" aria-pressed=\"" + (aOn ? "true" : "false") + "\" aria-haspopup=\"dialog\">" + ic("funnel", 20) + "Алергени" + (aOn ? " <span class=\"dot\" aria-label=\"избрани " + aOn + "\">" + aOn + "</span>" : "") + "</button>";
	for (const f of FILTERS) {
		if (f.needs) continue;
		const n = list.filter(f.test).length;
		if (!n) continue;
		h += "<button class=\"chip " + (FICON[f.id] || "") + "\" type=\"button\" data-f=\"" + f.id + "\" aria-pressed=\"" + (st.f.indexOf(f.id) > -1) + "\">" + ic(fic(f), 20) + f.n + " <span class=\"n\">" + n + "</span></button>";
	}
	return h + "<button class=\"chip more\" type=\"button\" data-sheet=\"more\" aria-haspopup=\"dialog\">" + ic("sliders-horizontal", 20) + "Още филтри</button>";
}
function countHTML(st, n) {
	const total = scopeItems(st).length, q = st.q.trim();
	if (q) return n ? "Намерихме " + plural(n) + " <span>за „" + esc(q) + "“</span>" : "Нищо за „" + esc(q) + "“" + (st.f.length || st.a.length ? " <span>с тези филтри</span>" : "");
	if (st.f.length || st.a.length) return "Показваме " + n + " <span>от " + plural(total) + "</span>";
	return plural(total) + " <span>· " + (st.menu === "bf" ? "закуски" : MAIN_CATS.length + " категории") + "</span>";
}
function noticesHTML(S, st, offline = false) {
	let h = "";
	if (offline) h += "<div class=\"notice off\" role=\"status\"><span class=\"nic\">" + ic("warning-circle", 24) + "</span><b>Няма връзка с интернет</b><p>Менюто е заредено, а количката ви е запазена. Поръчайте, когато връзката се върне.</p><div class=\"acts\"><button class=\"pill pill-line\" type=\"button\" data-retry>Опитай пак</button></div></div>";
	if (S.m < 600) h += "<div class=\"notice\"><span class=\"nic\">" + ic("clock", 24) + "</span><b>Кухнята отваря в 10:00</b><p>Можете да поръчате още сега за днес.</p></div>";
	else if (!S.kitchen) h += "<div class=\"notice warn\"><span class=\"nic\">" + ic("clock", 24) + "</span><b>Кухнята приема поръчки до 22:30. Поръчай за утре?</b><p>Изберете ястията сега, а в количката посочете час утре след 10:00.</p></div>";
	if (st.menu === "bf") {
		if (S.breakfast) {
			const left = 690 - S.m;
			h += "<div class=\"notice\"><span class=\"nic\">" + ic("sun", 24) + "</span><b>Закуски всеки ден до 11:30</b><p>Остават " + (left >= 60 ? "1 ч." + (left > 60 ? " и " + (left - 60) + " мин" : "") : left + " мин") + " за днес.</p></div>";
		} else if (S.m < 600) h += "<div class=\"notice\"><span class=\"nic\">" + ic("sun", 24) + "</span><b>Закуските са от 10:00 до 11:30</b><p>Разгледайте ги сега и поръчайте, щом отворим.</p></div>";
		else h += "<div class=\"notice\"><span class=\"nic\">" + ic("moon", 24) + "</span><b>Закуските свършиха за днес</b><p>Очакваме ви утре от 10:00 до 11:30. Междувременно цялото меню е тук.</p><div class=\"acts\"><button class=\"pill pill-line\" type=\"button\" data-menu=\"main\">Към основното меню</button></div></div>";
	}
	return h;
}
function catChipsHTML(groups) {
	return "<span class=\"ind\" aria-hidden=\"true\"><i class=\"l\"></i><i class=\"m\"></i><i class=\"r\"></i></span>" + groups.map((g) => "<a class=\"chip\" href=\"#" + g.c.id + "\" data-go=\"" + g.c.id + "\">" + esc(g.c.n) + " <span class=\"n\">" + g.items.length + "</span></a>").join("");
}
function sideHTML(groups) {
	return "<span class=\"smark\" aria-hidden=\"true\"></span>" + groups.map((g) => "<a href=\"#" + g.c.id + "\" data-go=\"" + g.c.id + "\"><span>" + esc(g.c.n) + "</span><span class=\"n\">" + g.items.length + "</span></a>").join("");
}
function menuLd(site) {
	const abs = (p) => new URL(p, site || "https://siracusa-sofia.com").href;
	const item = (x) => {
		const offer = {
			"@type": "Offer",
			price: x.p.toFixed(2),
			priceCurrency: "EUR",
			availability: isOut(x) ? "https://schema.org/SoldOut" : "https://schema.org/InStock"
		};
		if (x.per100) offer.priceSpecification = {
			"@type": "UnitPriceSpecification",
			price: x.p.toFixed(2),
			priceCurrency: "EUR",
			referenceQuantity: {
				"@type": "QuantitativeValue",
				value: 100,
				unitCode: "GRM"
			}
		};
		const it = {
			"@type": "MenuItem",
			name: x.n,
			url: abs(url.dish(x)),
			offers: offer
		};
		if (x.comp) it.description = cap(x.comp);
		if (x.t.indexOf("veg") > -1) it.suitableForDiet = "https://schema.org/VegetarianDiet";
		return it;
	};
	return [{
		"@context": "https://schema.org",
		"@type": "Menu",
		"@id": abs(url.menu()) + "#menu",
		name: "Меню на " + RESTAURANT.name,
		url: abs(url.menu()),
		inLanguage: "bg",
		hasMenuSection: cats.map((c) => ({
			"@type": "MenuSection",
			name: c.n,
			url: abs(url.cat(c.id)),
			hasMenuItem: inCat(c.id).map(item)
		}))
	}, {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [{
			"@type": "ListItem",
			position: 1,
			name: "Начало",
			item: abs(url.home())
		}, {
			"@type": "ListItem",
			position: 2,
			name: "Меню",
			item: abs(url.menu())
		}]
	}];
}
// src/pages/menu/index.astro
var menu_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => $$url
});
createAstro("https://siracusa-sofia.com");
var $$Index = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Index;
	const S = state(), E = eta();
	const st0 = {
		menu: "main",
		f: [],
		a: [],
		q: "",
		cat: null
	};
	const R = results(st0);
	const bfGroup = {
		c: catById.zakuski,
		items: BF_ITEMS,
		top: 0
	};
	const heroArt = byId["pitsa-s-burata-i-proshuto-krudo"] || inCat("pitsi")[0];
	const resultsHTML = R.groups.map((g, i) => sectionHTML(g, {
		menu: "main",
		lazy: i >= 2
	})).join("") + sectionHTML(bfGroup, {
		menu: "bf",
		hidden: true,
		lazy: true
	});
	const jsonld = menuLd(Astro.site);
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"page": "menu",
		"nav": "menu",
		"title": "Меню",
		"description": "Менюто на Siracusa Bar & Grill в Дружба 2: " + MAIN_ITEMS.length + " ястия и закуски. Пица на пещ, скара на дървени въглища Bertha, салати, паста, бургери и десерти. Цени в евро, доставка до 21:00.",
		"jsonld": jsonld
	}, {
		"default": ($$result) => renderTemplate` ${maybeRenderHead($$result)}<div class="menupg" data-menupg> <section class="sec mhero" aria-labelledby="mh1"> <div class="mtop"><div class="hero-art" aria-hidden="true"><div class="pic">${unescapeHTML(art(heroArt))}</div></div> <h1 class="h1" id="mh1">Меню</h1> <p class="lead">Пица на пещ и скара на дървени въглища.</p> ${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(etaLine(S, E))}` })} </div> <div class="mctl"> <div class="seg mseg" role="group" aria-label="Кое меню"> <button type="button" data-menu="main" aria-pressed="true"><b>Основно</b><small data-sub="main">${unescapeHTML(segSub("main", S))}</small></button> <a${addAttribute(url.lunch(), "href")}><b>Обедно</b><small data-sub="lunch">${unescapeHTML(segSub("lunch", S))}</small></a> <button type="button" data-menu="bf" aria-pressed="false"><b>Закуски</b><small data-sub="bf">${unescapeHTML(segSub("bf", S))}</small></button> </div> <div class="search" role="search"><label for="mq">Търсете ястие или съставка</label><div class="sbox">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("magnifying-glass", 22))}` })} <input id="mq" type="search" placeholder="пица, kebapcheta, бурата" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="search"> <button class="clr" type="button" data-qclear aria-label="Изчисти търсенето" hidden>${unescapeHTML(ic("x", 20))}</button></div></div> <div class="chips fchips" data-fchips role="group" aria-label="Филтри">${unescapeHTML(filterChipsHTML(st0))}</div> </div> <div class="mstat"><p class="cnt-t" data-count aria-live="polite" style="margin:0">${unescapeHTML(countHTML(st0, R.list.length))}</p><button class="link" type="button" data-clearall hidden>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("x", 18))}` })}Изчисти</button></div> <p class="note-auto alnote">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("info", 18))}` })}<span>Алергените са предварителни, от състава. Кухнята ги потвърждава.</span></p> <div class="notices" data-notices>${unescapeHTML(noticesHTML(S, st0))}</div> </section> <div class="wrap mbody"> <aside class="mside"><nav class="snav" aria-label="Категории в менюто"><span class="label">Категории</span><div class="slist" data-slist>${unescapeHTML(sideHTML(R.groups))}</div></nav></aside> <div class="mmain"><nav class="catbar" data-catbar aria-label="Категории"><div class="catscroll atstart" data-catscroll>${unescapeHTML(catChipsHTML(R.groups))}</div></nav><div data-results>${unescapeHTML(resultsHTML)}</div></div> </div> </div>  `,
		"ov": ($$result) => renderTemplate`<div class="abar cbar" aria-hidden="true" inert><span class="cn" data-cn></span><a class="pill pill-red"${addAttribute(url.cart(), "href")} data-cgo>Поръчай<span class="knob">${unescapeHTML(ic("arrow-right", 20))}</span></a></div>`
	})}${renderScript($$result, "/home/user/siracusa-sofia/src/pages/menu/index.astro?astro&type=script&index=0&lang.ts")}`;
}, "/home/user/siracusa-sofia/src/pages/menu/index.astro", void 0);
var $$file = "/home/user/siracusa-sofia/src/pages/menu/index.astro";
var $$url = "/menu/";
// \0virtual:astro:page:src/pages/menu/index@_@astro
var page = () => menu_exports;
export { page };
