import { t as __exportAll } from "./rolldown-runtime_D8jQpDG7.mjs";
import { C as addAttribute, T as unescapeHTML, c as renderComponent, g as maybeRenderHead, h as renderTemplate, l as Fragment } from "./server_DqW8LlMt.mjs";
import { H as createComponent, R as ic, S as url, x as $$Base } from "./lib_C2pGS49A.mjs";
// src/pages/404.astro
var _404_exports = /* @__PURE__ */ __exportAll({
	default: () => $$404,
	file: () => $$file,
	url: () => $$url
});
var $$404 = createComponent(($$result, $$props, $$slots) => {
	return renderTemplate`${renderComponent($$result, "Base", $$Base, {
		"page": "404",
		"nav": null,
		"title": "Страницата я няма",
		"noindex": true
	}, { "default": ($$result) => renderTemplate` ${maybeRenderHead($$result)}<section class="sec" style="padding-top:28px"> <div class="empty"> <span class="ill">${renderComponent($$result, "Fragment", Fragment, {}, { "default": ($$result) => renderTemplate`${unescapeHTML(ic("question", 44))}` })}</span> <h1 class="h2">Тази страница я няма в менюто</h1> <p class="lead">Може адресът да е сгрешен или страницата да е преместена.</p> <div class="row" style="flex-wrap:wrap;justify-content:center"> <a class="pill pill-red"${addAttribute(url.menu(), "href")}>Към менюто</a> <a class="pill pill-line"${addAttribute(url.home(), "href")}>Начало</a> </div> </div> </section> ` })}`;
}, "/home/user/siracusa-sofia/src/pages/404.astro", void 0);
var $$file = "/home/user/siracusa-sofia/src/pages/404.astro";
var $$url = "/404/";
// \0virtual:astro:page:src/pages/404@_@astro
var page = () => _404_exports;
export { page };
