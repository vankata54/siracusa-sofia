# Пакет за обучение на нов акаунт

Всички скилове от текущия акаунт, без `createx-style` (той остава само тук).
В `client-onboarding` единственото споменаване на CreateX е заменено с неутрално „Клиент / лийд“.

## Съдържание

- `skills/` - 30 скила като папки (SKILL.md + references/scripts)
- `zips/` - същите скилове като .zip, готови за качване
- `CLAUDE.md` - общи правила за работа (за Project instructions или в репото)

## Как се инсталира в новия акаунт

**1. Собствени скилове (качват се ръчно)** - claude.ai -> Settings -> Capabilities -> Skills -> Upload skill -> избери .zip от `zips/`:

| Скил | За какво |
|---|---|
| client-onboarding | Клиентска карта за нов SEO клиент/лийд |
| speed-optimization-pgsp-gtm | Анализ на скорост и SEO от PageSpeed линк или HAR файл |
| design-md-library | 74 готови DESIGN.md на известни брандове |
| design-taste-frontend | Anti-slop фронтенд (лендинги, портфолиа, редизайни) |
| design-taste-frontend-v1 | Старата версия на горния |
| redesign-existing-projects | Одит и ъпгрейд на съществуващ сайт |
| high-end-visual-design | Шрифтове, отстояния, сенки като „скъпа“ агенция |
| minimalist-ui | Чист editorial стил |
| industrial-brutalist-ui | Брутализъм / терминална естетика |
| gpt-taste | GSAP анимации, AIDA структура |
| stitch-design-taste | DESIGN.md за Google Stitch |
| web-design-guidelines | Ревю на UI за добри практики и достъпност |
| image-to-code | Дизайн изображение -> код |
| imagegen-frontend-web | Дизайн референции за уеб (по 1 изображение на секция) |
| imagegen-frontend-mobile | Дизайн референции за мобилни приложения |
| brandkit | Бранд гайдлайни, лого системи |
| full-output-enforcement | Без съкращения и плейсхолдъри в кода |

**2. Вградени скилове на Anthropic** - не е нужно качване, само се включват от същия екран
(Settings -> Capabilities -> Skills): `docx`, `pdf`, `pptx`, `xlsx`, `skill-creator`, `deep-research`,
`docs`, `google-workspace`, `computer-use`, `chrome-browser`, `built-in-browser`, `import-memory`, `morning`.
Копията им са в пакета само за справка/резерва.

**3. Конектори** - в новия акаунт свържи отново: GitHub, Gmail, Google Drive, Slack (Settings -> Connectors).

**4. Правила** - съдържанието на `CLAUDE.md` постави в Project instructions на всеки проект
(или в „What personal preferences should Claude consider“ в Settings -> Profile).

## Бележки

- `client-onboarding` е писан за „Поли“ - ако новият акаунт е на друг човек, смени името в `skills/client-onboarding/SKILL.md` и прекачи zip-а.
- Скилът чете/пише във файла „Клиентски карти“ в Claude проектите - този файл трябва да се качи отделно в проекта на новия акаунт (не е част от скиловете).
