import { t as __exportAll } from "./rolldown-runtime_D8jQpDG7.mjs";
import { C as addAttribute, T as unescapeHTML, c as renderComponent, g as maybeRenderHead, h as renderTemplate, l as Fragment } from "./server_DqW8LlMt.mjs";
import { B as renderScript, D as COURSE_NAME, E as ALLERGENS, F as esc, H as createComponent, I as fmt, R as ic, S as url, V as createAstro, _ as isOut, a as plusBtn, f as suggest, g as inCat, i as pic, j as allergenName, k as RESTAURANT, m as catById, n as badges, p as byId, v as items, x as $$Base, z as registerIcons } from "./lib_C2pGS49A.mjs";
import "./info_D6E2Z_vY.mjs";
// src/lib/icons/caret-down.ts
registerIcons({ "caret-down": "<path d=\"M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z\"/>" });
// src/lib/icons/minus.ts
registerIcons({ "minus": "<path d=\"M228,128a12,12,0,0,1-12,12H40a12,12,0,0,1,0-24H216A12,12,0,0,1,228,128Z\"/>" });
// src/lib/icons/heart.ts
registerIcons({ "heart": "<path d=\"M178,40c-20.65,0-38.73,8.88-50,23.89C116.73,48.88,98.65,40,78,40a62.07,62.07,0,0,0-62,62c0,70,103.79,126.66,108.21,129a8,8,0,0,0,7.58,0C136.21,228.66,240,172,240,102A62.07,62.07,0,0,0,178,40ZM128,214.8C109.74,204.16,32,155.69,32,102A46.06,46.06,0,0,1,78,56c19.45,0,35.78,10.36,42.6,27a8,8,0,0,0,14.8,0c6.82-16.67,23.15-27,42.6-27a46.06,46.06,0,0,1,46,46C224,155.61,146.24,204.15,128,214.8Z\"/>" });
// src/lib/icons/cube.ts
registerIcons({ "cube": "<path d=\"M223.68,66.15,135.68,18h0a15.88,15.88,0,0,0-15.36,0l-88,48.17a16,16,0,0,0-8.32,14v95.64a16,16,0,0,0,8.32,14l88,48.17a15.88,15.88,0,0,0,15.36,0l88-48.17a16,16,0,0,0,8.32-14V80.18A16,16,0,0,0,223.68,66.15ZM128,32h0l80.34,44L128,120,47.66,76ZM40,90l80,43.78v85.79L40,175.82Zm96,129.57V133.82L216,90v85.78Z\"/>" });
// src/lib/icons/image.ts
registerIcons({ "image": "<path d=\"M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H216a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40Zm0,16V158.75l-26.07-26.06a16,16,0,0,0-22.63,0l-20,20-44-44a16,16,0,0,0-22.62,0L40,149.37V56ZM40,172l52-52,80,80H40Zm176,28H194.63l-36-36,20-20L216,181.38V200ZM144,100a12,12,0,1,1,12,12A12,12,0,0,1,144,100Z\"/>" });
// src/pages/menu/[kategoria]/_dish.ts
var ADDON_CATS = [
	"pitsi",
	"burgeri",
	"pasta-i-rizoto",
	"salati",
	"zakuski"
];
var ADDONS = inCat("dobavki").slice().sort((a, b) => b.p - a.p);
var ICON_OF = {};
ALLERGENS.forEach((a) => {
	ICON_OF[a[0]] = a[2];
});
/** Dishes that have their own page (lunch items link to the lunch menu). */
var DISHES = items.filter((x) => !x.lunch && x.cat !== "obedno" && catById[x.cat]);
function catOf(d) {
	const c = catById[d.cat] || {
		id: d.cat,
		n: "Меню"
	};
	return {
		id: c.id,
		n: c.n,
		href: url.cat(c.id),
		back: url.menu(c.id)
	};
}
var compList = (d) => d.comp ? d.comp.split(",").map((s) => s.trim()).filter(Boolean) : [];
var cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
var canAdd = (d) => ADDON_CATS.indexOf(d.cat) > -1;
var hasMods = (d) => !isOut(d) && (compList(d).length > 0 || canAdd(d));
var extra = (add) => ADDONS.filter((a) => add[a.id]).reduce((s, a) => s + a.p, 0);
function modsList(d, rem, add) {
	const m = [];
	compList(d).forEach((c, i) => {
		if (rem[i]) m.push("без " + c);
	});
	ADDONS.forEach((a) => {
		if (add[a.id]) m.push("+ " + a.n);
	});
	return m;
}
function modSummary(d, rem, add) {
	const m = modsList(d, rem, add), e = extra(add);
	if (!m.length) return {
		has: false,
		xp: "",
		sub: compList(d).length && canAdd(d) ? "Махнете съставка или добавете още сирене, прошуто, гъби" : compList(d).length ? "Махнете съставка, която не искате. Безплатно." : "Добавете сирене, прошуто, гъби и още"
	};
	return {
		has: true,
		sub: cap(m.join(" · ")),
		xp: e ? "+" + fmt(e) : ""
	};
}
function modBtnInner(d, rem = {}, add = {}) {
	const s = modSummary(d, rem, add);
	return "<span class=\"ico\">" + ic("sliders-horizontal", 24) + "</span><span><b>Добавки и промени</b><span class=\"sub\">" + esc(s.sub) + "</span>" + (s.xp ? "<span class=\"xp\">" + s.xp + " на брой</span>" : "") + "</span><span class=\"end\">" + ic("caret-right", 20) + "</span>";
}
function buyLabel(d, qty, unit) {
	return d.per100 ? "<span>Добави · <span class=\"price\">" + fmt(unit) + "</span><span class=\"u100\">/100 гр.</span></span>" : "<span>Добави" + (qty > 1 ? " <span class=\"q\">" + qty + " бр.</span>" : "") + " · <span class=\"price\">" + fmt(unit * qty) + "</span></span>";
}
function buyHTML(d, qty = 1, unit = d.p) {
	return "<div class=\"counter\" role=\"group\" aria-label=\"Брой\"><button type=\"button\" data-q=\"-1\" aria-label=\"Едно по-малко\"" + (qty <= 1 ? " disabled style=\"opacity:.4;cursor:not-allowed\"" : "") + ">" + ic("minus", 20) + "</button><output aria-live=\"polite\">" + qty + "</output><button type=\"button\" data-q=\"1\" aria-label=\"Едно повече\">" + ic("plus", 20) + "</button></div><button class=\"pill pill-red pill-lg\" type=\"button\" data-buy>" + buyLabel(d, qty, unit) + "</button>";
}
function soldBarHTML() {
	return "<span class=\"soldlbl\">" + ic("clock", 20) + "Изчерпано днес</span><a class=\"pill pill-red\" href=\"#similar\" data-tosim>Вижте подобни</a>";
}
function favHTML(on = false) {
	return "<button class=\"pill pill-line fav\" type=\"button\" data-fav aria-pressed=\"" + on + "\">" + ic("heart", 20) + "Любимо</button>";
}
function pairCard(d, label) {
	return "<div class=\"pcard\"><a class=\"open\" href=\"" + url.dish(d) + "\">" + pic(d) + "<span><span class=\"eb\">" + esc(label) + "</span><span class=\"nm\">" + esc(d.n) + "</span><span class=\"meta\"><span class=\"price\">" + fmt(d.p) + "</span><span class=\"muted small\">" + (d.per100 ? "за 100 гр." : esc(d.g)) + "</span></span></span></a>" + plusBtn(d) + "</div>";
}
function similar(d) {
	let pool = inCat(d.cat).filter((z) => z.id !== d.id && !isOut(z));
	if (pool.length < 3) pool = pool.concat(items.filter((z) => z.id !== d.id && !isOut(z) && z.course === d.course && z.cat !== d.cat && pool.indexOf(z) < 0));
	return pool.sort((a, b) => Math.abs(a.p - d.p) - Math.abs(b.p - d.p)).slice(0, 3);
}
/** "Върви добре с" (empty when sold out or nothing fits). */
function pairsHTML(d, inCart = [], manual = {}) {
	if (isOut(d)) return "";
	const sug = suggest(d.id, inCart, manual);
	if (!sug.length) return "";
	return "<section class=\"sec\" aria-labelledby=\"pairh\"><div class=\"sec-h\"><h2 class=\"h2\" id=\"pairh\">Върви добре с</h2></div><div class=\"pairs cols\">" + sug.map((s) => pairCard(byId[s.id], COURSE_NAME[s.c] || "")).join("") + "</div></section>";
}
function allergenBlock(d) {
	const al = d.al || [], diet = [];
	if (d.t.indexOf("veg") > -1) diet.push(["leaf", "Вегетарианско"]);
	if (d.noOnion) diet.push(["check", "Без лук"]);
	const li = al.map((k) => "<li class=\"alg\"><span class=\"ico\">" + ic(ICON_OF[k] || "info", 22) + "</span>" + esc(allergenName(k)) + "</li>").join("");
	let h = "<div class=\"fblk\"><h2 class=\"h3\">Алергени</h2>";
	if (!d.comp) h += (al.length ? "<p class=\"algnone\" style=\"margin-bottom:8px\">Съдържа поне:</p><ul class=\"algs\">" + li + "</ul>" : "") + "<p class=\"algnone\">" + (al.length ? "Пълни данни за алергените още нямаме." : "Няма данни за алергени, попитайте ни.") + "</p><p class=\"note-auto\" style=\"margin:0\">" + ic("info", 18) + "<span>Кухнята въвежда състава и алергените на това ястие. Дотогава ви казваме по телефона.</span></p><div class=\"ask\"><a class=\"pill pill-line\" href=\"tel:" + RESTAURANT.phoneIntl + "\">" + ic("phone", 20) + "Попитай: " + RESTAURANT.phone + "</a></div>";
	else h += (al.length ? "<ul class=\"algs\" aria-label=\"Съдържа\">" + li + "</ul>" : "<p class=\"algnone\">По състава не открихме от 14-те основни алергена.</p>") + (diet.length ? "<p class=\"dietlbl\">Също по състава:</p><ul class=\"algs\" aria-label=\"По състава\">" + diet.map((z) => "<li class=\"alg diet\"><span class=\"ico\">" + ic(z[0], 20) + "</span>" + z[1] + "</li>").join("") + "</ul>" : "") + "<p class=\"note-auto\" style=\"margin:0\">" + ic("info", 18) + "<span>Предварително, от състава. Потвърждава се от кухнята.</span></p>";
	return h + "<a class=\"link\" href=\"" + url.page("allergens") + "\">Всички алергени в менюто" + ic("caret-right", 18) + "</a></div>";
}
function factsCard(d) {
	const c = compList(d);
	return "<div class=\"shell fcard\"><div class=\"core\"><div class=\"fblk\"><h2 class=\"h3\">Състав</h2>" + (c.length ? "<p class=\"comp\">" + c.map((s, i) => "<span class=\"ing\">" + esc(i ? s : cap(s)) + (i < c.length - 1 ? "<span class=\"vh\">,</span><span class=\"dot\" aria-hidden=\"true\">·</span>" : "") + "</span>").join(" ") + "</p>" : "<p class=\"comp\"><span class=\"missing\">[ЛИПСВА: състав от кухнята]</span></p>") + "</div>" + allergenBlock(d) + "<div class=\"fblk\"><details class=\"nutr\"><summary>Хранителна информация" + ic("caret-down", 22) + "</summary><div class=\"nbody\">" + [
		["Енергия", "ккал"],
		["Белтъчини", "г"],
		["Въглехидрати", "г"],
		["от тях захари", "г"],
		["Мазнини", "г"],
		["Сол", "г"]
	].map((r) => "<div class=\"kv\"><span>" + r[0] + "</span><span class=\"missing\">[ЛИПСВА]</span></div>").join("") + "<p class=\"note-auto\" style=\"margin-top:8px\">" + ic("info", 18) + "<span>" + (d.per100 ? "На 100 гр." : "На порция " + esc(d.g || "")) + ". Стойностите идват, когато кухнята ги въведе.</span></p></div></details></div></div></div>";
}
function metaDescription(d) {
	return d.n + " от Siracusa Bar & Grill, Дружба 2: " + (d.comp ? d.comp + ". " : "") + (d.per100 ? "" : d.g ? d.g + ", " : "") + fmt(d.p) + (d.per100 ? " за 100 гр." : "") + ". Поръчайте с доставка или вземете от място.";
}
function dishLd(d, site) {
	const abs = (p) => new URL(p, site || "https://siracusa-sofia.com").href;
	const c = catOf(d), price = d.p.toFixed(2);
	const offer = {
		"@type": "Offer",
		price,
		priceCurrency: "EUR",
		availability: isOut(d) ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
		url: abs(url.dish(d))
	};
	if (d.per100) offer.priceSpecification = {
		"@type": "UnitPriceSpecification",
		price,
		priceCurrency: "EUR",
		referenceQuantity: {
			"@type": "QuantitativeValue",
			value: 100,
			unitCode: "GRM"
		}
	};
	const item = {
		"@context": "https://schema.org",
		"@type": "MenuItem",
		name: d.n,
		url: abs(url.dish(d)),
		offers: offer
	};
	if (d.comp) item.description = d.comp;
	if (d.t.indexOf("veg") > -1) item.suitableForDiet = "https://schema.org/VegetarianDiet";
	return [item, {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				position: 1,
				name: "Меню",
				item: abs(url.menu())
			},
			{
				"@type": "ListItem",
				position: 2,
				name: c.n,
				item: abs(c.href)
			},
			{
				"@type": "ListItem",
				position: 3,
				name: d.n,
				item: abs(url.dish(d))
			}
		]
	}];
}
// src/pages/menu/[kategoria]/[yastie].astro
var _yastie__exports = /* @__PURE__ */ __exportAll({
	default: () => $$Yastie,
	file: () => $$file,
	getStaticPaths: () => getStaticPaths,
	url: () => $$url
});
createAstro("https://siracusa-sofia.com");
var getStaticPaths = (() => DISHES.map((x) => ({
	params: {
		kategoria: x.cat,
		yastie: x.id
	},
	props: { id: x.id }
})));
var $$Yastie = createComponent(($$result, $$props, $$slots) => {
	const Astro = $$result.createAstro($$props, $$slots);
	Astro.self = $$Yastie;
	const x = DISHES.find((d) => d.id === Astro.props.id);
	const cat = catOf(x);
	const out = isOut(x);
	const facts = [];
	if (x.share) facts.push("<span class=\"badge\">" + ic("users-three", 16) + "За споделяне</span>");
	if (x.cat === "skara-bertha") facts.push("<span class=\"badge\">" + ic("fire", 16) + "От фурната Bertha</span>");
	const simHTML = out ? similar(x).map((z) => pairCard(z, catById[z.cat] ? catById[z.cat].n : "")).join("") : "";
	const jsonld = dishLd(x, Astro.site);
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"page": "dish",
		"nav": "menu",
		"back": {
			href: cat.back,
			label: "Меню"
		},
		"title": x.n,
		"docTitle": x.n + " | " + cat.n,
		"share": true,
		"actionBar": true,
		"description": metaDescription(x),
		"jsonld": jsonld
	}, {
		"default": ($$result) => renderTemplate` ${maybeRenderHead($$result)}<article class="dish"${addAttribute(x.id, "data-dish")}${addAttribute(cat.id, "data-cat")}${addAttribute(cat.href, "data-cathref")}${addAttribute(cat.n, "data-catn")}> <div class="dgrid"> <div class="hero"> <div class="shell"><div class="core"> ${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(pic(x) + badges(x, true))}` })} ${!out && renderTemplate`<button class="v3d" type="button" data-3d>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("cube", 20))}` })}Виж в 3D</button>`} <span class="hint3d" aria-hidden="true">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("hand-waving", 18))}` })}Завъртете с пръст</span> </div></div> <p class="note3d muted" data-note3d hidden>Прототип: истинският 3D модел идва след фотосесията. <span class="missing">[ЛИПСВА: 3D модел]</span></p> </div> <div class="info"> <nav aria-label="Хлебни трохи"><ol class="crumbs"> <li><a${addAttribute(url.menu(), "href")}>Меню</a></li> <li>${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("caret-right", 16))}` })}<a${addAttribute(cat.href, "href")}>${cat.n}</a></li> </ol></nav> <h1 class="h1" data-h1>${x.n}</h1> <div class="prow2"> <span class="pg"><span class="price">${fmt(x.p)}</span>${x.per100 ? renderTemplate`<span class="g">за 100 гр.</span>` : x.g ? renderTemplate`<span class="g">${x.g}</span>` : null}</span> ${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(favHTML(false))}` })} </div> ${x.per100 && renderTemplate`<p class="per100note">Продава се на тегло: сумата се смята по теглото на парчето. <span class="missing">[ЛИПСВА: среден грамаж на порция]</span></p>`} ${facts.length > 0 && renderTemplate`<div class="badges facts">${unescapeHTML(facts.join(""))}</div>`} <div data-closedslot></div> ${out ? renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate` <div class="soldout" role="status"><span class="ico">${unescapeHTML(ic("clock", 24))}</span><span><b>Изчерпано днес</b><span>Вижте подобни ястия, които имаме сега.</span></span></div> <section class="subsec" id="similar" aria-labelledby="simh"><h2 class="h3" id="simh">Вижте подобни</h2><div class="pairs">${unescapeHTML(simHTML)}</div></section> ` })}` : renderTemplate`${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${hasMods(x) && renderTemplate`<button class="modbtn" type="button" data-mods aria-haspopup="dialog">${unescapeHTML(modBtnInner(x))}</button>`}<div class="buy" data-buybox>${unescapeHTML(buyHTML(x))}</div> ` })}`} <p class="desc"><span class="missing">[ЛИПСВА: описание на ястието - как се приготвя и с какво върви]</span></p> ${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(factsCard(x))}` })} </div> </div> </article> <div data-pairs>${unescapeHTML(pairsHTML(x))}</div>  `,
		"ov": ($$result) => renderTemplate`<div${addAttribute("abar dish-abar" + (out ? " out" : ""), "class")}>${unescapeHTML(out ? soldBarHTML() : buyHTML(x))}</div>`
	})}${renderScript($$result, "/home/user/siracusa-sofia/src/pages/menu/[kategoria]/[yastie].astro?astro&type=script&index=0&lang.ts")}`;
}, "/home/user/siracusa-sofia/src/pages/menu/[kategoria]/[yastie].astro", void 0);
var $$file = "/home/user/siracusa-sofia/src/pages/menu/[kategoria]/[yastie].astro";
var $$url = "/menu/[kategoria]/[yastie]/";
// \0virtual:astro:page:src/pages/menu/[kategoria]/[yastie]@_@astro
var page = () => _yastie__exports;
export { page };
