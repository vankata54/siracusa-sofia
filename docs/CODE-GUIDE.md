# Ръководство за кода (за авторите на страници и модули)

Кратко и точно. Решенията са в `docs/DECISIONS.md`, редът на работа в `docs/BUILD-PLAN.md`. Еталонът за визия и поведение е прототипът в `design/`.

## 1. Папки

```
astro.config.mjs        Astro, винаги статичен; DEMO=1 прави демото
src/
  styles/               tokens.css + components.css (1:1 от design/ds/sc.css), preview.css (само за рамките в админа)
  data/                 menu.json (генериран от design/data/menu.js, не се пипа на ръка), menu.ts (типове)
  lib/                  чиста логика, без DOM; работи в Node и в браузъра
    consts.ts           RESTAURANT, ZONES, TAGS, ALLERGENS, FILTERS, TABLES, EVENT_CATS ... (без менюто, малко)
    data.ts             менюто: items, byId, cats, catById, inCat, isOut, lunch, lunchIsToday (+ всичко от consts.ts)
    time.ts status.ts   now, minutes, setClock; state, status, eta, lastSaturday
    format.ts           fmt (10,22 €), esc, plural, dateLong („сб, 28 ноември“), dateShort, hhmm, normPhone
    routes.ts           ЕДИНСТВЕНОТО място за адреси: url.*, fromProto()
    icons.ts icons/     регистър на иконите: ic(); icons/<име>.ts = една икона; icons-all.ts = всички
    chrome.ts           header, bottomNav, footer, cookieBanner, morePanel, sheetHTML (без менюто)
    render.ts art.ts    art, pic, badges, plusBtn, dishCard (с менюто) + всичко от chrome.ts
    suggest.ts offers.ts events.ts filters.ts pricing.ts zones.ts cart.ts assistant.ts
    index.ts            всичко наведнъж: import { url, fmt, dishCard } from "../lib/index.ts"
  core/                 бизнес ядро (поръчки, резервации, празници, офис, абонамент, SMS вход, профил, оценка,
                        бележки от молива, персонал и роли, дневник); хранилище по интерфейс Repo
  client/
    sc.ts               браузърният runtime на всяка страница (window.SC), БЕЗ менюто: под 30 KB
    sc-menu.ts          същият SC + менюто (SC.items, SC.byId, SC.dishCard, SC.suggest, SC.offers ...)
    api.ts              един клиент за всички екрани (сървър или демо)
  layouts/Base.astro    SEO head + обвивката на всяка страница
  pages/                маршрутите (един файл = една страница)
server/                 Hono сървър: dist/ + /api/* + /api/stream (SSE); db/ (схема, миграции, Repo върху SQLite)
scripts/                gen-menu, gen-icons, relativize (демо), make-env, shoot (снимки)
tests/unit, tests/e2e   Vitest и Playwright
```

**Правило: пипаш само своите файлове** (своята страница в `src/pages/...` и нейните тестове). Общото (`src/lib`, `src/core`, `src/client`, `src/styles`, `Base.astro`, `server/`) не се променя от авторите на страници. Ако ти трябва нещо общо, направи го временно в своята страница и го опиши в отчета в „Искания към шефа“.

## 2. Адреси

Никога не пиши адрес на ръка. Винаги `url.*` от `src/lib/routes.ts`:

| Прототип | Код |
| --- | --- |
| `home.html` | `url.home()` → `/` |
| `menu.html` | `url.menu()` → `/menu/` |
| `category.html#pitsi` | `url.cat("pitsi")` → `/menu/pitsi/` |
| `dish.html#<id>` | `url.dish(id)` → `/menu/<кат>/<slug или id>/` (`slug` има само при 11-те срязани `id`, решение 12.11; старият адрес дава 301; обедните ястия → `/obedno-menu/`) |
| `tracking.html#1042` | `url.tracking(1042)` → `/porachka/1042/` |
| `event.html#<id>` | `url.event(id)` → `/sabitia/<id>/` |
| `offers.html#birthday` | `url.offers("birthday")` → `/oferti/#birthday` |
| други | `url.page("contacts")` → `/kontakti/` (ключовете са в `PAGES`) |

При пренасяне на голям скрипт: `SC.fromProto("dish.html#" + id)` превежда стар адрес. Параметрите остават в `#` (например `/menu/#pitsi&f=veg.hot`). В демото `url()` сам връща относителни адреси с `index.html`, а `scripts/relativize.mjs` оправя HTML-а след build.

## 3. Как се прави страница

```astro
---
// src/pages/menu/index.astro
import Base from "../../layouts/Base.astro";
import { cats, inCat, dishCard, ic, url } from "../../lib/index.ts";
---
<Base page="menu" nav="menu" title="Меню" description="Менюто на Siracusa ..." jsonld={{ "@context": "https://schema.org", "@type": "Menu" }}>
  <section class="sec" style="padding-top:28px">
    <h1 class="h1">Меню</h1>
  </section>
  <section class="sec">
    <div class="grid-dishes" set:html={inCat("pitsi").map((x) => dishCard(x)).join("")}></div>
  </section>
  <div class="abar" slot="ov">...</div>   <!-- плаващо (лента с действие): в слота "ov" -->
</Base>

<style>
  /* само за страницата, само с токените: var(--red), var(--surface) ... */
</style>

<script>
  import { SC } from "../../client/sc-menu.ts";   // страница с ястия; без ястия: "../../client/sc.ts"
  import "../../lib/icons/map-pin.ts";             // иконите, които скриптът рисува сам
  import { api } from "../../client/api.ts";
  const main = SC.mount();            // вече изрисуваният <main>
  SC.reveal();
</script>
```

- **Props на Base** (същите като `SC.mount` в прототипа): `page`, `nav` (`menu|reserve|offers|profile|lunch|events|delivery|about` или `null`), `back={{href, label}}`, `title`, `docTitle`, `share`, `status` (по подразбиране да), `cart`, `footer` (false → `.end-space`), `ai`, `actionBar` (ако рисуваш своя `.abar`), `bottomNav`, `description`, `jsonld`, `noindex`, `canonical`, `ogImage`.
- **Каквото може, се рисува на сървъра** (Astro, функциите от `render.ts`): SEO и скорост. Зависимото от часа, количката или потребителя се дорисува в браузъра.
- **Динамични маршрути** (категория, ястие, събитие): `getStaticPaths()` от `cats`, `items`, `EVENT_SLUGS`.
- **Десктоп:** само `@container app (min-width:900px)` (и 700 / 1100 / 1180), не `@media` за ширина.
- **Плаващи неща: само в слоя `.ov`, никога в `<main>`.** Своята `.abar`, свои листове, панели и бутони, които стоят над съдържанието, се слагат в `slot="ov"` на Base (рисувани на сървъра) или се добавят от скрипта в `SC.ov` (`SC.sheet()` вече го прави). Слоят `.ov` е `position:fixed` върху екрана и е контейнер `app`, затова `@container` правилата на `.abar`, `.nav`, `.aifab` и `.sheet` работят. Ако страницата има `.abar`, сложи `actionBar` на Base (асистентът се вдига над лентата).

## 3а. Скорост: какво влиза в JS на страницата

Общият `sc.ts` е на всяка страница и не съдържа менюто, илюстрациите и пълния набор икони (цел: под 30 KB некомпресиран). Затова:

- **Менюто:** страница, която в браузъра ползва ястия (филтри, търсене, количка, ястие, асистент), внася `../client/sc-menu.ts` (или директно `../lib/data.ts`, `../lib/render.ts`). Vite ги слага в общ отделен chunk, който се зарежда само там. На сървъра (frontmatter на Astro) менюто е безплатно: ползвай го свободно, то не влиза в JS.
- **Количката без менюто:** бутоните „+“ (`plusBtn`) носят `data-p` с цената; `SC.cart.add(id, q, {p})` пази цената и името в реда, така броячът работи навсякъде. Цената на поръчката винаги се смята от менюто (`pricing.ts`).
- **`SC.url.dish("id")` без менюто** не знае категорията и връща менюто. Подай обект (`SC.url.dish(x)`) или внеси `sc-menu.ts`.
- **Иконите:** на сървъра всяка икона се вгражда в HTML-а (Base зарежда пълния набор само там). В браузъра `SC.ic(име)` знае само регистрираните: тези от общия runtime (x, check, caret-right, phone, question), от `render.ts` (plus, fire, sparkle, leaf, pepper, clock) и тези, които страницата е внесла с `import "../lib/icons/<име>.ts"`. Непознатата икона излиза като „?“. Ако наистина трябват много, `await SC.icons()` зарежда всички (отделен файл 64 KB, само при нужда).
- **Асистентът** се зарежда при първото отваряне.

## 4. Пренасяне на скрипт от прототипа

`window.SC` има същото API като `design/ds/sc.js` (`SC.cart`, `SC.state()`, `SC.dishCard`, `SC.sheet`, `SC.toast`, `SC.flash`, `SC.fly`, `SC.reveal`, `SC.ic`, `SC.fmt`, данните ...). Разлики:

1. `SC.mount({...})` **не рисува**: връща вече изрисувания `<main>`. Опциите отиват като props на `Base`.
2. Адреси: `"dish.html#"+id` → `SC.url.dish(id)`; `"cart.html"` → `SC.url.cart()`; всичко друго → `SC.url.*` или `SC.fromProto(...)`.
3. **Скролът е на документа.** `SC.scroller.scrollTop`, `scrollTo`, `scrollBy`, `addEventListener("scroll")` и `getBoundingClientRect()` работят чрез тънка обвивка, но в нов код пиши `window.scrollY` / `window.scrollTo`. В `IntersectionObserver` смени `root: SC.scroller` с `root: null` (задължително, иначе не работи).
4. Часът: `SC.state()`, `SC.minutes()` и т.н. четат часа в София; в преглед `?preview=1&t=21:30`. Слушай `document.addEventListener("sc:tick", ...)`, ако страницата трябва да се смени, когато мине часът.
5. Нищо от `previewBar`/`pv-*` (панелът „Само в прототипа“ остава само ако страницата има симулирани състояния; пази го зад `SC.preview`).
6. Типизиран импорт вместо глобала: `import { SC } from "../client/sc-menu.ts"` (с менюто) или `"../client/sc.ts"` (без). `SC.items`, `SC.byId`, `SC.cats`, `SC.inCat`, `SC.lunch`, `SC.art`, `SC.pic`, `SC.dishCard`, `SC.suggest`, `SC.offers` съществуват само след `sc-menu.ts`.
7. Всяко `SC.ic("име")` в пренесения скрипт: провери, че иконата е внесена (`import "../lib/icons/име.ts"`).

## 5. Данни и действия: `api`

```ts
import { api, ApiError } from "../client/api.ts";
try {
  const o = await api.orders.create({ cart: SC.cart.get(), zone: "Дружба 2", addr: "бл. 311", name, phone, pay: "cash" });
  location.href = SC.url.tracking(o.no);
} catch (e) {
  if (e instanceof ApiError) { /* e.code, e.message (за човек), e.fields {поле: грешка} */ }
}
api.on("order.status", (d) => ...);   // реално време: SSE на сървъра, BroadcastChannel в демото
```

Има: `orders.create/get`, `reservations.create/taken`, `celebrations.create`, `office.create/get/join/submit`, `subscribe`, `ratings.submit`, `auth.smsRequest/smsVerify/logout/me/update/remove/orders/export/toggleFav`, `staff.login/logout/me`, `admin.*` (поръчки, резервации, роли, бележки, дневник). В демото (`npm run build:demo`) същите извиквания минават през ядрото в браузъра с localStorage. Грешките са с еднакви кодове и текстове и в двата режима.

## 6. Команди

```
npm install
npm run dev            # astro dev (без API)
npm run build          # сървърна версия в dist/
npm run serve          # http://localhost:8787 (dist/ + API); при първи старт прави data/siracusa.db
npm run build:demo     # статично демо в dist/ (относителни адреси, ядро в браузъра)
npm run db:seed        # меню + акаунти на персонала от .env
npm run db:migrate     # нова миграция след промяна в server/db/schema.ts
npm test               # vitest (src/lib, src/core, сървърът)
npm run test:e2e       # playwright (сам прави build и пуска сървъра на порт 8788)
node scripts/make-env.mjs   # прави .env със случайни пароли, само ако липсва
```

`.env` никога не влиза в git. Паролите се дават на Поли в чата.

## 7. Снимки и сравнение с прототипа

```
npm run build && npm run serve        # в отделен терминал
node scripts/shoot.mjs /menu/ shots/menu --time=21:30
node scripts/shoot.mjs /menu/ shots/menu --scroll=800 --click="[data-more]|.chip"
node scripts/shoot.mjs / shots/demo --dist          # снимка от dist/ без сървър (за демото)
cd design && node tools/shoot.js pages/menu.html /tmp/ref-menu --time=21:30   # прототипът
```

`shoot.mjs` прави 360 светла, 390 светла, 390 тъмна, 1440 светла и цялата страница на 390; показва грешките в конзолата и хоризонталния скрол. Опции: `--time`, `--scroll` (първо), `--click` (после, няколко с `|`), `--only=390,1440`, `--base=`, `--dist`. **Отвори снимките с Read** и ги сравни една до друга с прототипа (390 = рамката „Телефон“, 1440 = „Компютър“). Разлика е позволена само по решение в `docs/DECISIONS.md`.

## 8. Преди „готово“

`npm test` и `npm run test:e2e` минават; снимки на 390 и 1440 в светла и тъмна тема; без грешки в конзолата, без хоризонтален скрол на 360, текст поне 14px, цели поне 48px, без дълги тирета; всички състояния от `design/PAGES.md`.
