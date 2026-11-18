# Пускане на живо: сървърът (етап E)

Как се качва Siracusa v1 на истински сървър, как се обновява, архивира и връща. Какво трябва от собственика е в `docs/ZA-SOBSTVENIKA-PUSKANE.md`; докато няма хостинг, работи само демото.

**Какво е проверено и какво не (18.11.2026):**

- Проверено на машина с Ubuntu 24.04, Node.js 22 и nginx 1.24 (версиите на нов сървър), с отделен потребител `siracusa` и подредбата по-долу в `/srv/siracusa`:
  - `deploy/deploy.sh`: първо качване без база; обновяване с живото меню (променена цена остава след обновяването, без второ сглобяване); версия, която не тръгва, се връща сама към предишната; пазят се 3 версии;
  - `scripts/backup.mjs`: както го пуска нощният таймер (от папката на версията, копията отиват в `shared/backups`), с шифроване и изнасяне с rsync към друга папка;
  - `deploy/restore.sh`: списък, отказ без „YES“, повреден файл (нищо не се пипа), истинско връщане (сайтът се пресглобява сам със старото меню);
  - `deploy/nginx-siracusa.conf` със самоподписан сертификат: HTTPS, HTTP/2, пренасочване от http и от www, потокът на живо идва веднага, заключването при грешна парола работи и при подправен `X-Forwarded-For`, чужд `Origin` е 403, логът е без пълен IP и без ключовете в адресите, страницата „Обновяваме сайта“, докато услугата е спряна;
  - `scripts/preflight.mjs --url`: всички проверки `OK` през nginx (остават двете `WARN` за място извън сървъра и за `SECRET_KEY`, докато не се зададат).
- Не е проверено (няма как без истински сървър и домейн; ръчна проверка при първото качване): командите за инсталиране от раздел 1, услугите под истински systemd (`systemd-analyze verify` минава; в пробата услугата се пускаше със скрипт), сертификатът от Let's Encrypt, изнасянето на архива към истинско отдалечено място (SSH или rclone).

## Как е подредено на сървъра

```
/srv/siracusa/
  repo/                    копие на git хранилището (само за изтегляне)
  shared/.env              тайните (никога в git): пароли, ключове, настройки
  shared/data/             базата siracusa.db, снимките (media/), бележките за гориво (receipts/)
  shared/backups/          архивите (db/, media/, receipts/)
  releases/<час>-<комит>/  всяка версия в своя папка, със своите node_modules и dist
  current -> releases/...  версията, която работи
```

Услугата `siracusa` пуска версията от `current`. Обновяването прави нова папка, сглобява сайта в нея и чак тогава превключва `current`; сайтът спира за няколко секунди (рестартът). Пазят се последните 3 версии.

## 1. Сървърът за пръв път (като root)

Ubuntu 24.04 LTS, поне 2 GB RAM (препоръчано 4 GB), в ЕС.

```bash
apt update && apt install -y nginx certbot git curl gnupg rsync ufw
```

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt install -y nodejs
```

```bash
node -v
```

Трябва 22.12 или по-нова; `/usr/bin/node` е пътят, който услугата очаква.

```bash
useradd --system --create-home --home-dir /srv/siracusa --shell /bin/bash siracusa
```

```bash
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

Потребителят `siracusa` рестартира само своята услуга. Файл `/etc/sudoers.d/siracusa` (с `visudo -f /etc/sudoers.d/siracusa`):

```
siracusa ALL=(root) NOPASSWD: /usr/bin/systemctl restart siracusa, /usr/bin/systemctl stop siracusa, /usr/bin/systemctl start siracusa
```

## 2. Кодът и тайните (като siracusa)

Достъп до GitHub: ключ само за четене (GitHub → хранилището → Settings → Deploy keys). [ЛИПСВА: ключът се прави на сървъра при първото качване]

```bash
sudo -iu siracusa
```

```bash
git clone --bare git@github.com:vankata54/siracusa-sofia.git /srv/siracusa/repo
```

```bash
mkdir -p /srv/siracusa/shared /srv/siracusa/bootstrap && git -C /srv/siracusa/repo archive build/v1 deploy scripts/make-env.mjs | tar -x -C /srv/siracusa/bootstrap
```

Тайните: скриптът прави `.env` със случайни пароли на персонала и ключове (нищо не показва на екрана).

```bash
cd /srv/siracusa/shared && node ../bootstrap/scripts/make-env.mjs
```

После в `/srv/siracusa/shared/.env` се добавят редовете за жив сървър от `deploy/env.production.example`: `COOKIE_SECURE=1`, `TRUST_PROXY=1`, истинският `SITE_URL`. Паролите се четат от файла на сървъра и се дават на хората по сигурен път, не в чат и не по имейл.

## 3. Услугите (като root)

```bash
cp /srv/siracusa/bootstrap/deploy/siracusa.service /srv/siracusa/bootstrap/deploy/siracusa-backup.service /srv/siracusa/bootstrap/deploy/siracusa-backup.timer /etc/systemd/system/ && systemctl daemon-reload && systemctl enable siracusa siracusa-backup.timer
```

## 4. Първото качване (като siracusa)

```bash
/srv/siracusa/bootstrap/deploy/deploy.sh build/v1
```

Скриптът тегли кода, инсталира пакетите, сглобява сайта, превключва `current`, пуска услугата и чака да отговори (`/api/health` и началната страница). Ако не отговори, връща предишната версия и казва къде да се гледа (`journalctl -u siracusa -n 100`).

После (като root) нощният архив:

```bash
systemctl start siracusa-backup.timer && systemctl list-timers siracusa-backup.timer
```

## 5. nginx и сертификатът (като root)

```bash
certbot certonly --webroot -w /var/www/html -d siracusa-sofia.com -d www.siracusa-sofia.com --deploy-hook "systemctl reload nginx"
```

```bash
cp /srv/siracusa/bootstrap/deploy/nginx-siracusa.conf /etc/nginx/sites-available/siracusa && ln -s ../sites-available/siracusa /etc/nginx/sites-enabled/siracusa && rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl reload nginx
```

При друг домейн `siracusa-sofia.com` се сменя навсякъде във файла преди `nginx -t`. Файлът дава: HTTP/2, пренасочване от http и от www, потока на живо без буфер (иначе кухнята закъснява), истинския адрес на посетителя за ограниченията и лог без пълни IP адреси и без ключовете от адресите (проследяване на поръчка, обща поръчка за офиса, кода на масата).

## 6. Проверка преди истински клиенти (като siracusa)

```bash
cd /srv/siracusa/current && node scripts/preflight.mjs --url https://siracusa-sofia.com
```

Всеки ред е `OK`, `WARN` (работи, но погледни) или `FAIL` (не пускай). Проверява настройките в `.env` (без да показва стойности), базата, сглобения сайт (никога демото), архива, HTTPS, HTTP/2, пренасочването и потока през nginx.

## 7. Обновяване

```bash
/srv/siracusa/current/deploy/deploy.sh build/v1
```

Преди всяка промяна скриптът прави архив на базата. Сайтът се сглобява с живото меню от копие на базата (`server/build-live.ts`), докато старата версия още работи, затова след обновяване няма минута със старите цени от git. Миграциите на базата се прилагат при старта на новата версия.

Връщане към предишната версия става само, когато новата не тръгне. Ако новата версия е променила базата и трябва да се върне и тя: раздел 9.

## 8. Архив

- Всяка нощ в 03:30 (`siracusa-backup.timer`): проверено копие на базата (`shared/backups/db/siracusa-ГГГГММДД-ЧЧММ.db.gz`, часът е по UTC), новите снимки на ястия и бележки за гориво.
- Остават: всички от последните 14 дни, по едно на седмица за 8 седмици, по едно на месец за 12 месеца.
- Папката на архива е до папката с данни (`shared/backups`); друго място се задава с `BACKUP_DIR` (пълен път).
- **Извън сървъра** (задължително преди истински клиенти): в `.env` `BACKUP_RSYNC=потребител@сървър:папка` или `BACKUP_RCLONE=име:папка`. Мястото трябва да е частно и в ЕС (лични данни). С `BACKUP_PASSFILE` копията на базата се шифроват, преди да напуснат сървъра; паролата се пази и на второ място извън сървъра, без нея архивът не се отваря. [ЛИПСВА: къде се изнася архивът; решава се с хостинга]
- На отдалеченото място нищо не се трие автоматично (празен нов сървър да не изтрие стария архив).
- Ръчно: `sudo systemctl start siracusa-backup`, после `journalctl -u siracusa-backup -n 20`.

## 9. Връщане от архив (като siracusa)

```bash
/srv/siracusa/current/deploy/restore.sh --list
```

```bash
/srv/siracusa/current/deploy/restore.sh siracusa-20261118-0130.db.gz
```

Скриптът първо разопакова и проверява копието, пита за потвърждение (всичко след архива се губи), спира услугата, запазва сегашната база до живата като `siracusa.db.before-restore-<час>`, слага копието и пуска услугата. С `--photos` връща и снимките от архива.

## 10. Какво прави сървърът сам

- **Седмично пресглобяване:** сайт, по-стар от седмица, се сглобява пак между 04:00 и 05:00 (датите на събитията в страниците са от деня на сглобяването). В „Дневник“: „Сайтът е пресглобен: седмично обновяване на датите“.
- Обедното меню за деня тръгва в полунощ; „Публикувай“ в админа пресглобява сайта; изтритите клиенти (GDPR) се махат окончателно след срока за „Отмени“.
- Старите адреси на ястията се пренасочват от `dist/redirects.json`; файлът се прави при всяко сглобяване, не се качва отделно.

## 11. Логове и лични данни

- Услугата: `journalctl -u siracusa -n 100` (без лични данни по правило; грешките са без телефони и адреси).
- nginx: `/var/log/nginx/siracusa.access.log` е без последната част на IP адреса и без ключовете в адресите; Ubuntu ги пази 14 дни (`/etc/logrotate.d/nginx`).
- Токенът на телефона на QR масата не е в адреси (бисквитка само за потока).

## 12. Какво още липсва за истински клиенти

- **SMS доставчик:** без него входът на клиент с код връща „услугата не е достъпна“ (503); поръчка без профил работи. `SMS_DEMO=1` никога на жив сървър. [ЛИПСВА: доставчик]
- **Имейл** за отчетите до собственика. [ЛИПСВА: адрес и услуга]
- **Лого 512 × 512 px** за известията на iPhone. [ЛИПСВА]
- Текстовете на правните страници от юрист. [ЛИПСВА]
