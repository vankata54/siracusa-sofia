import { t as __exportAll } from "./rolldown-runtime_D8jQpDG7.mjs";
import { C as addAttribute, T as unescapeHTML, c as renderComponent, g as maybeRenderHead, h as renderTemplate, l as Fragment, n as templateExit, t as templateEnter } from "./server_DqW8LlMt.mjs";
import { A as ZONES, B as renderScript, C as eta, F as esc, H as createComponent, M as DAYS, N as MON, P as MONTHS, R as ic, S as url, T as state, V as createAstro, _ as isOut, b as MENU, d as offers, g as inCat, k as RESTAURANT, p as byId, r as dishCard, t as art, w as lastSaturday, x as $$Base, y as lunchIsToday } from "./lib_C2pGS49A.mjs";
// src/lib/events.ts
function events(today = /* @__PURE__ */ new Date()) {
	return [{
		id: "gratska-vecher",
		n: "Гръцка вечер",
		cat: "Тематични вечери",
		date: lastSaturday(today).d,
		time: "19:00",
		price: null,
		free: false,
		seatsLeft: null,
		text: "Всяка последна събота от месеца кухнята сменя посоката. Този път: Гърция.",
		note: "[ЛИПСВА: програма, меню и цена]"
	}];
}
// src/pages/_home.ts
function goHTML(st) {
	let o;
	if (st.delivery) o = {
		t: "Поръчай",
		s: "Доставка или вземане от място"
	};
	else if (st.kitchen) o = {
		t: "Поръчай за вземане",
		s: "Вземане от място до 22:30",
		pickup: true
	};
	else if (st.m < 600) o = {
		t: "Поръчай за днес",
		s: "Отваряме в 10:00"
	};
	else o = {
		t: "Поръчай за утре",
		s: "Кухнята приема поръчки от 10:00"
	};
	return "<a class=\"pill pill-red go\" data-go href=\"" + url.menu() + "\"" + (o.pickup ? " data-pickup" : "") + "><span class=\"gol\"><span>" + o.t + "</span><small>" + o.s + "</small></span><span class=\"knob\">" + ic("arrow-right", 22) + "</span></a>";
}
function lunchTileText(st, lunchToday) {
	let sub;
	if (st.lunch) sub = lunchToday ? "<small>До 15:00 · с доставка</small>" : "<small>Качва се всяка сутрин</small>";
	else if (st.lunchDiscount) sub = "<small class=\"hot\"><span>-30%</span>при вземане</small>";
	else sub = "<small>От 10:00 до 15:00</small>";
	return "<b>" + (lunchToday && st.open ? "Обедно меню днес" : "Обедно меню") + "</b>" + sub;
}
function etaInner(st, eta) {
	let dot, html;
	if (st.delivery && !eta.busy) {
		dot = "ok";
		html = "<b>Доставка сега: " + eta.text + "</b>";
	} else if (st.delivery) {
		dot = "warn";
		html = "<b>Възможни са закъснения</b><span>Доставка сега: около " + eta.min + " мин</span>";
	} else if (st.kitchen) {
		dot = "warn";
		html = "<b>Доставката приключи</b><span>Вземане от място до 22:30</span>";
	} else if (st.open) {
		dot = "";
		html = "<b>Кухнята затвори</b><span>Доставка утре от 10:00</span>";
	} else {
		dot = "";
		html = "<b>Затворено</b><span>Доставка " + (st.m < 600 ? "днес" : "утре") + " от 10:00</span>";
	}
	return "<span class=\"dot " + dot + "\"></span>" + ic("moped", 22) + "<span class=\"tx\">" + html + "</span>" + ic("caret-right", 18);
}
var OFF_META = {
	lunch: ["До 15:00", "bowl-food"],
	lunchToday: ["Днес до 15:00", "bowl-food"],
	lunch30: ["След 15:00", "storefront"],
	tomorrow: ["Утре от 10:00", "clock"],
	greek: ["Събитие", "calendar-check"],
	birthday: ["Празник", "cake"],
	signup: ["За нов профил", "gift"]
};
/** One slide. `key` picks the eyebrow ("lunchToday" for the lunch slide when the lunch menu is for today). */
function slideHTML(o, key = o.id) {
	const m = OFF_META[key] || OFF_META[o.id] || ["Оферта", "seal-percent"];
	return "<article class=\"slide\" data-oid=\"" + o.id + "\" role=\"group\" aria-roledescription=\"слайд\"><span class=\"sl-ic\">" + ic(m[1], 180) + "</span><span class=\"sl-ey\">" + m[0] + "</span><h2>" + esc(o.t) + "</h2><p data-op>" + esc(o.p) + "</p><a class=\"pill\" href=\"" + o.href + "\">" + esc(o.go) + ic("arrow-right", 20) + "</a></article>";
}
function dotHTML(title, i) {
	return "<button type=\"button\" data-dot=\"" + i + "\" aria-label=\"Оферта " + (i + 1) + ": " + esc(title) + "\"><span class=\"d\"><i></i></span></button>";
}
/** Which first slide fits the hour: lunch (today / another day), -30% after 15:00, or "for tomorrow". */
function firstOfferKey(st, lunchToday) {
	return st.lunch ? lunchToday ? "lunchToday" : "lunch" : st.lunchDiscount ? "lunch30" : "tomorrow";
}
function daysText(n) {
	return n === 0 ? "Днес" : n === 1 ? "Утре" : "След " + n + " дни";
}
function eventsHTML(evs, days) {
	return (evs.length ? evs.slice(0, 2).map((e) => {
		const d = e.date;
		return "<article class=\"card ev rv\"><div class=\"cal\" aria-hidden=\"true\"><span class=\"m\">" + MON[d.getMonth()] + "</span><b>" + d.getDate() + "</b><span class=\"wd\">" + DAYS[d.getDay()].slice(0, 3) + "</span></div><div><span class=\"badge\">" + ic("calendar-check", 16) + esc(e.cat) + "</span><h3 class=\"h3\">" + esc(e.n) + "</h3><p class=\"when\"><span>" + DAYS[d.getDay()] + ", " + d.getDate() + " " + MONTHS[d.getMonth()] + " · " + e.time + "</span><span class=\"cd\">" + ic("hourglass", 16) + daysText(days) + "</span></p><p class=\"txt\">" + esc(e.text) + "</p><span class=\"missing\">" + esc(e.note) + "</span><a class=\"pill pill-ink\" href=\"" + url.event(e.id) + "\">Запази място" + ic("arrow-right", 20) + "</a></div></article>";
	}).join("") : "<div class=\"empty card\"><div class=\"ill\">" + ic("calendar-blank", 40) + "</div><b>Скоро обявяваме следващото събитие.</b><a class=\"pill pill-line\" href=\"" + url.events() + "\">Уведоми ме</a></div>") + "<article class=\"card ev cel rv\"><div class=\"ci\" aria-hidden=\"true\">" + ic("confetti", 36) + "</div><div><span class=\"tag-ember\">" + ic("seal-percent", 16) + "-5% при ранна резервация</span><h3 class=\"h3\">Празник при нас</h3><p class=\"txt\">Рожден ден, кръщене, юбилей или фирмено парти. Изберете повод, брой гости и меню, а управителят ви изпраща оферта.</p><a class=\"pill pill-line\" href=\"" + url.page("celebration") + "\">Планирай празник" + ic("arrow-right", 20) + "</a></div></article>";
}
function deliveryNote(st) {
	if (st.delivery) return "";
	return "<span class=\"dot\"></span>" + (st.kitchen ? "Днес доставката приключи. Можете да вземете поръчката до 22:30." : "Доставяме отново " + (st.m < 600 ? "днес" : "утре") + " от 10:00");
}
function restaurantLd(site) {
	const R = RESTAURANT, abs = (p) => new URL(p, site).href;
	const m = /^(.*),\s*(\d{4})\s+(.+)$/.exec(R.address);
	return {
		"@context": "https://schema.org",
		"@type": "Restaurant",
		"@id": abs("/") + "#restaurant",
		name: R.name,
		url: abs("/"),
		telephone: R.phoneIntl,
		email: R.email,
		address: {
			"@type": "PostalAddress",
			streetAddress: m ? m[1] : R.address,
			postalCode: m ? m[2] : void 0,
			addressLocality: m ? m[3] : "София",
			addressCountry: "BG"
		},
		hasMenu: abs(url.menu()),
		acceptsReservations: true,
		openingHoursSpecification: [{
			"@type": "OpeningHoursSpecification",
			dayOfWeek: [
				"Monday",
				"Tuesday",
				"Wednesday",
				"Thursday",
				"Friday",
				"Saturday",
				"Sunday"
			],
			opens: R.open,
			closes: R.close
		}],
		sameAs: [R.social.facebook, R.social.instagram].filter(Boolean)
	};
}
// src/pages/index.astro
var pages_exports = /* @__PURE__ */ __exportAll({
	default: () => $$Index,
	file: () => $$file,
	url: () => ""
});
createAstro("https://siracusa-sofia.com");
var $$Index = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Index;
	const R = RESTAURANT, MENU_LUNCH_DATE = MENU.lunch.date;
	const st = state(), et = eta(), lunchToday = lunchIsToday(), ls = lastSaturday();
	const lunchDay = /* @__PURE__ */ new Date(MENU_LUNCH_DATE + "T12:00:00");
	const otherDay = new Date(lunchDay.getTime() + 864e5);
	const variants = {
		lunchToday: offers("11:00", lunchDay)[0],
		lunch: offers("11:00", otherDay)[0],
		lunch30: offers("16:00")[0],
		tomorrow: offers("23:30")[0]
	};
	const rest = offers().slice(1);
	const fk = firstOfferKey(st, lunchToday);
	let slides = [[variants[fk], fk], ...rest.map((o) => [o, o.id])];
	if (st.lunch && slides.length > 1) slides.push(slides.shift());
	const slidesHTML = slides.map(([o, k], i) => slideHTML(o, k).replace("class=\"slide\"", "class=\"slide" + (i === 0 ? " on" : "") + "\"" + (i ? " aria-hidden=\"true\"" : "") + " aria-label=\"" + (i + 1) + " от " + slides.length + "\"").replace(/<a class="pill"/, i ? "<a class=\"pill\" tabindex=\"-1\"" : "<a class=\"pill\"")).join("");
	const dotsHTML = slides.map(([o], i) => dotHTML(o.t, i).replace("<button ", i === 0 ? "<button aria-current=\"true\" " : "<button ")).join("");
	const variantsHTML = Object.entries(variants).map(([k, o]) => slideHTML(o, k).replace("class=\"slide\"", "class=\"slide\" data-key=\"" + k + "\"")).join("");
	const popItems = [
		"pitsa-s-burata-i-proshuto-krudo",
		"svinski-rebra",
		"pitsa-s-proshuto-koto-i-tryufel",
		"pitsa-margarita",
		"kebapcheta",
		"pitsa-dyavolo",
		"ribay-stek-ot-blek-angas",
		"pitsa-vegetariana"
	].map((id) => byId[id]).filter((x) => x && !isOut(x));
	const berthaN = inCat("skara-bertha").length;
	const sparks = [
		[
			58,
			"5px",
			"4.8s",
			"0s",
			"-22px",
			"34%"
		],
		[
			66,
			"4px",
			"5.6s",
			"1.1s",
			"10px",
			"30%"
		],
		[
			74,
			"6px",
			"4.2s",
			"2.2s",
			"-30px",
			"38%"
		],
		[
			82,
			"4px",
			"6s",
			"0.6s",
			"14px",
			"32%"
		],
		[
			62,
			"3px",
			"5.2s",
			"3s",
			"-8px",
			"40%"
		],
		[
			88,
			"5px",
			"4.6s",
			"1.8s",
			"-20px",
			"36%"
		],
		[
			70,
			"3px",
			"6.4s",
			"3.8s",
			"18px",
			"28%"
		],
		[
			78,
			"4px",
			"5s",
			"4.4s",
			"-14px",
			"42%"
		]
	].map((p) => "<span class=\"spark\" style=\"--x:" + p[0] + "%;--s:" + p[1] + ";--d:" + p[2] + ";--w:" + p[3] + ";--dx:" + p[4] + ";--b:" + p[5] + "\"></span>").join("");
	const free = ZONES.filter((z) => z.free), paid = ZONES.filter((z) => !z.free);
	const dnote = deliveryNote(st);
	const mapSvg = "<svg viewBox=\"0 0 400 300\" preserveAspectRatio=\"xMidYMid slice\" aria-hidden=\"true\"><path class=\"park\" d=\"M-10 214 C40 196 96 206 130 236 L150 310 L-10 310Z\"/><rect class=\"blk\" x=\"22\" y=\"26\" width=\"92\" height=\"58\" rx=\"10\"/><rect class=\"blk\" x=\"22\" y=\"108\" width=\"62\" height=\"72\" rx=\"10\"/><rect class=\"blk\" x=\"150\" y=\"20\" width=\"70\" height=\"44\" rx=\"10\"/><rect class=\"blk\" x=\"250\" y=\"18\" width=\"128\" height=\"50\" rx=\"10\"/><rect class=\"blk\" x=\"270\" y=\"96\" width=\"44\" height=\"88\" rx=\"10\"/><rect class=\"blk\" x=\"334\" y=\"96\" width=\"60\" height=\"64\" rx=\"10\"/><rect class=\"blk\" x=\"164\" y=\"196\" width=\"80\" height=\"60\" rx=\"10\"/><rect class=\"blk\" x=\"276\" y=\"214\" width=\"108\" height=\"64\" rx=\"10\"/><rect class=\"blk\" x=\"112\" y=\"112\" width=\"30\" height=\"64\" rx=\"8\"/><path class=\"road big\" d=\"M-20 94 C120 92 240 84 420 82\"/><path class=\"road mid\" d=\"M236 -10 C232 80 246 170 258 320\"/><path class=\"road sm\" d=\"M-10 192 C70 188 160 186 250 190\"/><path class=\"road sm\" d=\"M132 -10 L138 92\"/><path class=\"road sm\" d=\"M256 196 C310 200 360 196 420 190\"/><path class=\"road sm\" d=\"M98 96 L104 300\"/></svg>";
	const mapEmbed = "https://www.google.com/maps?output=embed&hl=bg&q=" + encodeURIComponent(R.name + ", " + R.address);
	const jsonld = restaurantLd(Astro.site);
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"page": "home",
		"nav": null,
		"title": "Начало",
		"docTitle": "Пица на пещ и скара в Дружба 2",
		"description": "Siracusa Bar & Grill в ж.к. Дружба 2, София: пица на пещ, скара на дървени въглища във фурна Bertha, обедно меню с доставка. Всеки ден 10:00 - 23:00, доставка до 21:00.",
		"jsonld": jsonld
	}, { "default": ($$result) => renderTemplate` ${maybeRenderHead($$result)}<div class="homepg" data-home${addAttribute(MENU_LUNCH_DATE, "data-lunch-date")}> <!-- ---------- hero: simulated 8 - 15 s clip ([ЛИПСВА: видео]) under the floating header ---------- --><section class="hero" aria-labelledby="hero-h"> <div class="stage"> <div class="film" data-film aria-hidden="true"><div class="cam"><span class="glow"></span><span class="shade"></span><span class="spin">${unescapeHTML(art("pitsa-dyavolo"))}</span>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(sparks)}` })}</div><span class="veil"></span></div> <div class="htxt"><p class="eyebrow" hidden>Siracusa Bar &amp; Grill</p><h1 class="h1" id="hero-h">Пица на пещ и скара на дървени въглища</h1><p>В Дружба 2. Всеки ден до 23:00.</p></div> <div class="vctl"><button class="vbtn" type="button" data-vid aria-pressed="false">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("pause", 20))}` })}<span>Пауза</span></button><span class="vtag">[ЛИПСВА: видео 8 - 15 сек.]</span></div> </div> <div class="acts"> <div class="offline" role="status" data-offline hidden>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("warning", 22))}` })}<div><b>Няма връзка с интернет</b><p>Менюто се вижда. Поръчката ще изпратите, щом връзката се върне.</p><button class="link" type="button" data-retry>Опитай пак${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("caret-right", 18))}` })}</button></div></div> ${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(goHTML(st))}` })} <div class="tiles"> <a class="tile"${addAttribute(url.reservation(), "href")}><span class="ti">${unescapeHTML(ic("calendar-check", 22))}</span><span><b>Резервирай маса</b><small>Салон и градина</small></span></a> <a class="tile"${addAttribute(url.lunch(), "href")}><span class="ti">${unescapeHTML(ic("bowl-food", 22))}</span><span data-lunchtile>${unescapeHTML(lunchTileText(st, lunchToday))}</span></a> </div> <a class="eta"${addAttribute(url.page("delivery"), "href")} data-eta>${unescapeHTML(etaInner(st, et))}</a> </div> </section> <!-- ---------- promo banner (ember): offers(), 6 s, pause, dots; the first slide is static ---------- --> <section class="sec promo-sec" aria-label="Оферти"> <div class="promo" data-promo role="region" aria-roledescription="въртящ се банер" aria-label="Оферти"> <div class="slides" data-slides aria-live="off">${unescapeHTML(slidesHTML)}</div> <div class="pctl"><div class="dots" role="group" aria-label="Избери оферта" data-dots>${unescapeHTML(dotsHTML)}</div> <button class="pp" type="button" data-pp>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("pause", 20))}` })}<span>Пауза</span></button></div> </div> <template data-variants>${templateEnter($$result)}${unescapeHTML(variantsHTML)}${templateExit($$result)}</template> </section> <!-- ---------- popular ---------- --> <section class="sec" aria-labelledby="pop-h"> <div class="sec-h"><h2 class="h2" id="pop-h">Популярни</h2><a class="link"${addAttribute(url.menu(), "href")}>Цялото меню${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("caret-right", 18))}` })}</a></div> <p class="small sec-note"><span class="missing">[ЛИПСВА: най-поръчваните по данни от касата; сега примерен избор]</span></p> <div data-popbody> ${popItems.length ? renderTemplate`<div class="rail pop">${unescapeHTML(popItems.map((x) => dishCard(x)).join(""))}</div>` : renderTemplate`<div class="errbox" role="alert">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("warning-circle", 28))}` })}<b>Не успяхме да заредим ястията.</b><p>Проверете връзката и опитайте пак. Можете да поръчате и по телефона: ${R.phone}.</p><button class="pill pill-line" type="button" data-retry>Опитай пак</button></div>`} </div> </section> <!-- ---------- Bertha ---------- --> <section class="sec" aria-labelledby="bertha-h"><div class="shell rv"><div class="core bcore"> <div class="btxt"><p class="eyebrow">Нашата фурна</p><h2 class="h2" id="bertha-h">Фурната Bertha</h2> <p class="lead">Затворена фурна на дървени въглища. Огънят нагрява стените и тавана, затова месото се пече равномерно и хваща опушен вкус.</p> <ul class="facts" style="margin-top:20px"><li>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("fire", 22))}` })}<span>Истински дървени въглища</span></li><li>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("thermometer", 22))}` })}<span>Равномерна топлина отвсякъде</span></li><li>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("fork-knife", 22))}` })}<span>${berthaN} ястия от скарата в менюто</span></li></ul></div> <div class="temp" data-temp><div class="deg" role="img" aria-label="до 350 градуса">350<small>°C</small></div><p class="deg-cap">Толкова става в затворената камера. Работим между 250 и 350 °C.</p> <div class="scale" aria-hidden="true"><span class="band"></span><span class="mk"></span></div><div class="scale-l" aria-hidden="true"><span style="left:0">0</span><span class="on" style="left:62.5%">250</span><span class="on" style="left:87.5%">350</span></div></div> <div class="bact"><a class="pill pill-light"${addAttribute(url.cat("skara-bertha"), "href")}>Ястията от Bertha${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("arrow-right", 20))}` })}</a><a class="pill pill-ghost"${addAttribute(url.page("bertha"), "href")}>Как работи фурната</a></div> </div></div></section> <!-- ---------- come visit (long video slot) ---------- --> <section class="sec visit" aria-labelledby="visit-h"> <div class="vid shell rv"><div class="core vslot"><button class="play" type="button" data-vslot aria-label="Пусни видеото за ресторанта">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("play", 32))}` })}</button> <b>Видео за ресторанта</b><span class="missing">[ЛИПСВА: видео 30 - 45 сек. от новата фотосесия: отвън, салон, градина, фурната, ястията]</span> <span class="len">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("video-camera", 18))}` })}без звук</span></div></div> <div class="vtxt"><div class="sec-h" style="margin:22px 0 8px"><h2 class="h2" id="visit-h">Елате при нас</h2></div> <p class="lead">Салон и отоплявана градина, която работи целогодишно. Подходящо за вечеря с приятели и за семейни празници.</p> <ul class="places"><li>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("chair", 22))}` })}Салон</li><li>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("tree", 22))}` })}Отоплявана градина</li></ul> <a class="pill pill-red pill-lg pill-block"${addAttribute(url.reservation(), "href")}>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("calendar-check", 22))}` })}Резервирай маса</a></div> </section> <!-- ---------- events ---------- --> <section class="sec" aria-labelledby="ev-h"> <div class="sec-h"><h2 class="h2" id="ev-h">Предстоящи събития</h2><a class="link"${addAttribute(url.events(), "href")}>Всички${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("caret-right", 18))}` })}</a></div> <div class="evs" data-evs>${unescapeHTML(eventsHTML(events(), ls.days))}</div> </section> <!-- ---------- office lunch ---------- --> <section class="sec" aria-labelledby="off-h"><div class="card office rv"> <div><div class="oh"><span class="oi">${unescapeHTML(ic("briefcase", 24))}</span><h2 class="h3" id="off-h">Обща поръчка за офиса</h2></div><p style="margin-top:10px">Една обща поръчка за целия офис, с една доставка до 15:00.</p></div> <ol class="steps"><li>Създавате обща връзка</li><li>Всеки колега избира сам</li><li>Доставяме всичко заедно</li></ol> <a class="pill pill-line"${addAttribute(url.page("office"), "href")}>Започни обща поръчка${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("arrow-right", 20))}` })}</a> </div></section> <!-- ---------- delivery zones + address check ---------- --> <section class="sec" id="dostavka" aria-labelledby="dl-h"> <div class="sec-h"><h2 class="h2" id="dl-h">Доставка до 21:00</h2></div> <p class="dnote" data-dnote${addAttribute(!dnote, "hidden")}>${unescapeHTML(dnote)}</p> <div class="dlv"><div> <div class="zgroup"><h3>Безплатна доставка</h3><ul class="ztags">${free.map((z) => renderTemplate`<li>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("check-circle", 20))}` })}${z.n}</li>`)}</ul></div> <div class="zgroup"><h3>По тарифа</h3><ul class="ztags paid">${paid.map((z) => renderTemplate`<li>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("map-pin", 20))}` })}${z.n}</li>`)}</ul><span class="missing">[ЛИПСВА: такси за доставка в €]</span></div> <a class="link"${addAttribute(url.page("delivery"), "href")}>Карта на зоните${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("caret-right", 18))}` })}</a> <p class="pay">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("wallet", 20))}` })}<span>Плащане на място: В брой, Карта при получаване или Ваучер.</span></p> </div> <form class="card chk rv" data-chk novalidate${addAttribute(url.page("delivery"), "action")}><div class="field"><label for="addr">Провери адреса си</label> <div class="irow"><input class="input" id="addr" name="addr" type="text" autocomplete="street-address" placeholder="Квартал и блок" aria-describedby="addr-err"><button class="pill pill-red" type="submit">Провери</button></div> <p class="err" id="addr-err" hidden></p></div> <div class="res" data-res hidden aria-live="polite"></div></form></div> </section> <!-- ---------- how to get here (static schematic, live map on tap) ---------- --> <section class="sec" aria-labelledby="wh-h"> <div class="sec-h"><h2 class="h2" id="wh-h">Как да стигнете</h2></div> <div class="where"> <div class="shell rv"><div class="core map" data-map${addAttribute(mapEmbed, "data-embed")}>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(mapSvg)}` })} <div class="pinw" aria-hidden="true"><span class="lbl">Siracusa</span><span class="pin">${unescapeHTML(ic("fork-knife", 22))}</span><span class="ring"></span></div> <span class="mtag missing">[ЛИПСВА: статична карта от Google]</span> <button class="pill live" type="button" data-maplive>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("map-trifold", 20))}` })}Отвори картата</button></div></div> <div class="info"><p class="addr">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("map-pin", 24))}` })}<span>${R.address}</span></p> <div class="kv"><span>Всеки ден</span><b>${R.open} - ${R.close}</b></div><div class="kv"><span>Кухнята приема</span><b>до ${R.kitchen}</b></div> <div class="kv"><span>Доставка</span><b>до ${R.delivery}</b></div><div class="kv"><span>Обедно меню</span><b>${R.open} - ${R.lunchUntil}</b></div> <div class="kv"><span>Паркиране</span><b class="missing">[ЛИПСВА]</b></div> <div class="btns"><a class="pill pill-ink pill-lg"${addAttribute(R.maps, "href")} target="_blank" rel="noopener">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("path", 22))}` })}Маршрут в Google Maps</a> <a class="pill pill-line pill-lg"${addAttribute("tel:" + R.phoneIntl, "href")}>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("phone", 22))}` })}${R.phone}</a></div></div> </div> </section> </div> ` })}${renderScript($$result, "/home/user/siracusa-sofia/src/pages/index.astro?astro&type=script&index=0&lang.ts")}`;
}, "/home/user/siracusa-sofia/src/pages/index.astro", void 0);
var $$file = "/home/user/siracusa-sofia/src/pages/index.astro";
// \0virtual:astro:page:src/pages/index@_@astro
var page = () => pages_exports;
export { page };
