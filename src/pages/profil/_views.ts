/* Profile (/profil/): HTML pieces shared by the server (index.astro, first paint) and the browser (./_profile.ts).
   Pure strings, no DOM and no menu: ic / url work in Node and in the browser. */
import { ic } from "../../lib/icons.ts";
import { url } from "../../lib/routes.ts";

/* "Какво получавате": the same lines as on /vhod/ (one source, design review "login" minor 1-2) */
import { PERKS } from "../vhod/_views.ts";

export function inviteHTML(): string {
  return '<section class="inv"><div class="shell"><div class="core">' +
    '<span class="ring">' + ic("user", 32) + "</span>" +
    '<div><h1 class="h1">Вашият профил</h1><p class="lead" style="margin-top:8px">Влезте с телефона си. Без парола, с код по SMS.</p></div>' +
    '<div class="bonus ember-card"><span class="big">-10%</span><span class="tx"><b>от следващата поръчка</b><span class="s">Прилага се сам на следващата ви поръчка.</span></span></div>' +
    '<a class="pill pill-red pill-lg pill-block" href="' + url.page("login") + '" data-login>' + ic("sign-in", 22) + "Влез с телефон</a>" +
    '<h2 class="h3 vh">Какво получавате</h2><ul class="perks">' + PERKS.map((p) => '<li><span class="i">' + ic(p[0], 22) + "</span><span><b>" + p[1] + '</b><span class="s">' + p[2] + "</span></span></li>").join("") + "</ul>" +
    '<p class="noacc">Поръчка без профил също става. <a class="link" href="' + url.menu() + '">Към менюто' + ic("caret-right", 18) + "</a></p>" +
    "</div></div></section>";
}

const sk = (w: string, h: number, r = 0) => '<span class="skel" style="width:' + w + ";height:" + h + "px" + (r ? ";border-radius:" + r + "px" : "") + '"></span>';

/** one order card while loading */
export function orderSkel(): string {
  return '<div class="card sk-ord" aria-hidden="true"><div class="sk-row">' + sk("76px", 52, 26) +
    '<span style="flex:1;display:grid;gap:8px">' + sk("60%", 16) + sk("40%", 14) + "</span></div>" +
    sk("100%", 14) + sk("80%", 14) + sk("100%", 48, 24) + "</div>";
}

/** first paint for a browser that remembers a signed-in customer (no h1: the real one comes with the name) */
export function skeletonHTML(): string {
  return '<div class="pf pf-sk"><div class="pf-aside" aria-hidden="true"></div><div class="pm">' +
    '<div class="ph" aria-hidden="true">' + sk("64px", 64, 32) + '<span style="flex:1;display:grid;gap:10px">' + sk("40%", 14) + sk("70%", 30) + sk("45%", 16) + "</span></div>" +
    '<div class="tiles" aria-hidden="true">' + sk("100%", 96, 24) + sk("100%", 96, 24) + sk("100%", 96, 24) + "</div>" +
    '<div class="ps"><div class="olist">' + orderSkel() + orderSkel() + "</div></div>" +
    '<p class="vh" role="status">Зареждаме профила…</p>' +
    "</div></div>";
}
