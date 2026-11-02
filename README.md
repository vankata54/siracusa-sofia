# siracusa-sofia

Нов сайт и система за Siracusa Bar & Grill (ж.к. Дружба 2, София): публичен сайт, QR маса, приложения за персонала и админ панел.

## Структура

| Папка | Какво има |
| --- | --- |
| `docs/` | Мастър промпт v2 (`master-prompt-v2.docx`) и hand-off пакетът за Claude Design v2 (`hand-off-claude-design-v2.md`) |
| `design/project/` | Изходните файлове на дизайна от Claude Design: `canvas.json` (подредбата на платното) и по един `.dc.html` файл за всяко табло |

## Дизайн

Дизайнът се прави в Claude Design (платно "Siracusa Bar & Grill"). Файловете в `design/project/` са копие на платното и се обновяват с всяка промяна.

Етап 1 - груб дизайн (hand-off пакет, секция 0.2):

- Визуални посоки: `Main.dc.html` (А · Жар · Начало), `A-Dish.dc.html`, `B-Home.dc.html`, `B-Dish.dc.html`, `Fonts.dc.html` (сравнение на шрифтовете)
- Карта на екраните: `Sitemap.dc.html`; отворените въпроси са в `canvas.json` (бележка `q`)
- Wireframes: `WF-Site-Phone-1`, `WF-Site-Phone-2`, `WF-Site-Desktop`, `WF-QR`, `WF-Staff`, `WF-Kitchen`, `WF-Admin`

Следва: избор на посока и шрифт, после дизайн система (секции 3, 4 и 11).

## Източник на истина

- Функционалност и бизнес логика: мастър промптът v2.
- Визия, движение и подредба: hand-off пакетът v2 и дизайнът в `design/`.
- Решенията от 02.11.2026 (hand-off пакет, секция 0.1) печелят над всичко друго, докато не влязат в мастър промпт v3.
