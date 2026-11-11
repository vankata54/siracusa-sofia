# Състояние на build/v1 (11.11.2026)

Работата спря заради седмичния лимит на акаунта и продължава от друг акаунт. Всичко направено е в клон `build/v1`. Този файл казва точно докъде сме и какво следва.

## Готово

**Етап A: основа (ГОТОВО).** Astro (статичен) + TypeScript без рамка, токените и компонентите 1:1 от `design/ds/sc.css`, Manrope самохостнат, логиката от `sc.js` в `src/lib/` (часове, статус, количка, зони, цени, „Върви добре с“, оферти, филтри, търсене), бизнес ядро `src/core/` с два адаптера (SQLite на сървъра, localStorage в демото), Hono сървър `server/` (`/api/*`, SSE), вход за персонала (scrypt, httpOnly бисквитка, роли), 57 unit теста. Ръководство: `docs/CODE-GUIDE.md`. Бриф за страница: `docs/PAGE-BRIEF.md`.

**Етап B: клиентски страници, направени от автор (още без независима проверка на кода):**

| Страница | Маршрут | Файлове |
| --- | --- | --- |
| Начало | `/` | `src/pages/index.astro`, `_home.ts` |
| Меню | `/menu/` | `src/pages/menu/index.astro`, `_menu.ts` |
| Категория (15) | `/menu/<кат>/` | `src/pages/menu/[kategoria]/index.astro`, `_cat.ts` |
| Ястие (127) | `/menu/<кат>/<ястие>/` | `src/pages/menu/[kategoria]/[yastie].astro`, `_dish.ts` |
| Обедно меню | `/obedno-menu/` | `src/pages/obedno-menu/` |
| Количка | `/kolichka/` | `src/pages/kolichka/` |
| Проследяване | `/porachka/<номер>/` | `src/pages/porachka/` |
| Обща поръчка за офиса | `/obedna-porachka-za-ofisa/` | `src/pages/obedna-porachka-za-ofisa/` |
| Резервация | `/rezervatsia/` | `src/pages/rezervatsia/` |
| Събития | `/sabitia/` | `src/pages/sabitia/index.astro`, `_events.ts`, `_party.ts` |
| Събитие | `/sabitia/<slug>/` | `src/pages/sabitia/[slug]/` |

Отчетите на авторите: `reviews-code/<страница>.agent.md`. E2E тестове: `tests/e2e/<страница>.spec.ts`.

**Етап D: дизайн на модулите (живи HTML прототипи, по 2 независими проверяващи):**
- `design/pages-servitor/` Сервитьор + смарт часовник: ГОТОВО.
- `design/pages-kuhnya/` Кухня: ГОТОВО.
- `design/pages-shofyor/` Шофьор: ГОТОВО.
- `design/pages-masa/` QR маса: ГОТОВО.

Въпросите от модулите са в `docs/OPEN-QUESTIONS.md` (раздел „модулите“).

## Започнато, недовършено

Нищо. Всичко започнато е довършено (11.11.2026).

## Следва (по `docs/BUILD-PLAN.md`)

- Етап B, останалите страници (по 1 агент с `docs/PAGE-BRIEF.md`): celebration `/praznik/`, offers `/oferti/`, login `/vhod/`, profile `/profil/`, delivery `/dostavka/`, pickup `/vzemi-ot-myasto/`, bertha `/furna-bertha/`, about `/za-nas/`, gallery `/galeria/`, contacts `/kontakti/`, allergens `/alergeni/`, 404 (с текста за `/menu/...`), правните страници.
- **Първо:** независима проверка на кода на всички готови страници по групи A, B, C (`docs/AGENTS.md`), поправки до ГОТОВО.
- Общи задачи за шефа: `docs/BUILD-TODO.md`.
- Етап C: админ панел (вход, табло с модулите в рамки, роли × раздели, „молив“ за бележки, раздели от мастър промпта).
- Етап D: дизайн на Управител и Собственик; после код за QR маса, Сервитьор, Кухня, Шофьор, Управител, Собственик.
- Етап E: на живо. Няма хостинг (OPEN-QUESTIONS) → демо (`npm run build:demo`) публикувано като Artifact; бележките от молива в базата на артефакта (идея: главната страница е таблото и държи базата, модулите са в iframe и пращат бележките с postMessage — да се провери дали подстраниците на артефакта имат достъп до `claude.use`).

## Как се стартира

```
npm install
node scripts/make-env.mjs   # прави .env със случайни пароли, ако липсва (не е в git)
npm test
npm run build && npm run serve   # http://localhost:8787
npm run build:demo               # статично демо в dist/
```

`.env` не е в git: в новата сесия се създава наново с нови пароли. Акаунти на персонала: `admin`, `owner`, `manager`, `waiter`, `kitchen`, `driver`.

## Уроци от тази сесия

- Агентите пишат в общото работно дърво: всеки ползва свой порт и свои папки за build (`dist-<страница>*`, в `.gitignore`), никога `pkill` по общ шаблон.
- Шефът комитва; агентите не комитват.
- Лимитите прекъсват агентите: след нулиране се продължава същият агент (SendMessage), не нов.
