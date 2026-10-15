# Этап 6 — сервер, копии и эксплуатация

Подготовлено 15.10.2026 по свежему ZIP после 2b34223. Это подготовка, НЕ выполненный деплой и НЕ подтверждение production-готовности. Нет подтверждённых домена, VPS/IP, ОС, пользователя, путей и production-БД. Не использовать параметры других проектов.

## Что изменено

- Health вынесен в middleware/health.js: 200 после SELECT 1, 503 при ошибке или ожидании свыше 3 секунд, no-store. Одна незавершённая DB-проба на процесс, исключено накопление запросов от health; таймаут HTTP не отменяет SQL. Fingerprint только NODE_ENV=test.
- Production HOST теперь строго 127.0.0.1. TRUST_PROXY=1 и HTTPS APP_URL уже проверялись. Cookies auth/commerce уже secure в production.
- HTTP logger больше не пишет query-параметры и заголовки запроса. Не логировать секреты вручную; существующие error-логи требуют осторожности при передаче третьим лицам.
- PM2: один fork, backoff, лимит памяти, kill_timeout 15 секунд (приложение завершает работу максимум за 10 секунд), отдельные логи. Нет автоматического запуска генератора в PM2.
- Nginx: все разрешённые запросы через Express, включая HTML, SEO, site/uploads/API; без root на проект и без статического обхода middleware. X-Forwarded-* перезаписываются для одного локального proxy. CDN требует отдельного пересмотра доверия.
- Лимит 85 MiB соответствует существующему multer: 10 файлов по 8 MiB плюс multipart. Это предел запроса, не одного файла. Multer хранит буферы в RAM: оценить VPS под параллельные загрузки.
- Backup: pg_dump custom + uploads tar, SHA256, private umask, flock, атомарная публикация каталога, retention после успеха. Пароль только через libpq pgpass. Приложение .env не исполняется shell.
- Шаблоны backup/monitor systemd, logrotate, production env. Все uppercase placeholders заменить перед установкой.
- Генератор сохраняет существующую логику и exit 0/1/2. Старый service теперь явно требует подтверждённых путей/пользователя/Node.

## Выполненные проверки

См. результат проверок в сообщении с патчем. Health-тесты используют настоящий обработчик с подменённой пробой, включая зависание, coalescing и восстановление. Это НЕ PostgreSQL-интеграция. Bash syntax НЕ доказывает рабочий backup. На VPS ничего не запускалось.

Не подтверждены: фактический nginx -t, PM2 restart/shutdown/reboot, systemd запуск, PostgreSQL backup/restore, TLS, SMTP-доставка, offsite, мониторинг с уведомлениями. Канал оповещения отсутствует: monitor пишет только journal и exit status, это не внешнее оповещение.

## Локальная приёмка: Windows CMD

Распаковать ZIP в C:\Users\ШУМ\WORKS\sibDel с заменой перечисленных файлов. Ничего не удалять. Секреты и uploads патч не содержит. PowerShell для этих команд не использовать.

```bat
cd /d C:\Users\ШУМ\WORKS\sibDel
git remote -v
git branch --show-current
git status --short
node --check app.js
node --check config/env.js
node --check middleware/health.js
node --check deploy/ecosystem.config.cjs
node --test tests/health.test.mjs
npm run test:seo
npm run test:checkout-security
npm run test:trade-unit
npm run test:delivery-unit
npm run test:operator-unit
git diff --check
```

На отдельном тестовом сервере .env.test (порт 3002, NODE_ENV=test): проверить health, затем существующие smoke. Основную БД для smoke не использовать. Генератор на основной ради проверки не запускать.

## Данные перед серверными действиями

Получить домен, IP, ОС/версию, SSH-пользователя, приложение/Node/PM2 paths, занятые порты, текущие systemd/nginx сервисы, состояние БД, роли и миграции. Следующие Linux-команды — сценарий для согласованного Linux с systemd и Nginx, НЕ команда установки на неизвестный VPS.

Сначала только чтение: cat /etc/os-release; node -v; npm -v; command -v node; psql --version; pg_dump --version; pg_restore --version; nginx -v; systemctl list-timers --all; ss -lntp. PM2 проверять от имени пользователя приложения, не root. Не выводить .env/pgpass/pm2 env. Проверить PostgreSQL server_version через локальную защищённую сессию. Требуются Node 24.x и pg_dump/restore 18 для БД 18. PostgreSQL слушает loopback/Unix socket, порт 5432 не открыт извне.

## Последовательность установки после уточнения ОС и путей

1. До любых миграций: существующая БД + uploads + текущий релиз в приватную копию; проверить восстановление ниже. Для новой БД отдельно подтвердить, что она пустая.
2. Создать отдельного непривилегированного пользователя приложения, закрытую директорию logs и writable uploads. Код не должен быть доступен на запись Nginx. .env 0600, uploads/logs 0700 пользователю приложения; не делать chmod -R 777. Для backup отдельному пользователю выдать только нужное чтение uploads и закрытую директорию вне APP_DIR. После копирования uploads убедиться, что owner позволяет приложению читать/писать.
3. От пользователя приложения в подтверждённой APP_DIR: npm ci, npm run prisma:generate, npm run prisma:validate, npm run scss, npm run prisma:deploy, npx prisma migrate status. Prisma CLI и Sass находятся в devDependencies: npm ci --omit=dev ДО этих шагов не подходит. Не запускать seed/reset/db push. Generate не применяет миграции. Свежий npm audit --omit=dev выполнить отдельно, без fix --force.
4. Существующий .env не затирать. Новый — вручную по deploy/production.env.example, заполнить реальные APP_URL/SEO_SITE_URL/SMTP/DB. SESSION_SECRET создать криптографически случайным, минимум 64 символа, передать приватно. Шаблон не содержит рабочего домена. Проверить отсутствие REPLACE/APP_ROLE и иных заглушек локально без публикации секретов.
5. Роли PostgreSQL: приложение не superuser, без CREATEDB/CREATEROLE/BYPASSRLS. Предпочтительно отдельная роль владельца миграций и runtime с CONNECT, USAGE public, DML на нужных таблицах, USAGE/SELECT sequences. Default privileges устанавливает владелец объектов для runtime; проверить права после migrate deploy. Миграции выполнять из отдельного приватного env с owner URL. Backup-роль должна читать все нужные таблицы; проверить полноту dump. Не применять шаблонные GRANT на неизвестную существующую БД.
6. mkdir -p logs uploads от имени приложения; pm2 start deploy/ecosystem.config.cjs; pm2 status; curl --fail --max-time 5 http://127.0.0.1:APP_PORT/api/health. PORT сверить с env и Nginx. pm2 startup применить по фактической ОС/Node, затем pm2 save. В shell PM2 не оставлять старые env переменные: dotenv не перезаписывает уже заданные process.env. После правки .env выполнить pm2 restart deploy/ecosystem.config.cjs --update-env в чистой сессии пользователя и проверить результат без вывода секретов.
7. HTTPS: сначала настроить отдельный HTTP vhost с ACME challenge, выпустить сертификат для подтверждённого домена по принятой процедуре сервера. Затем адаптировать TLS vhost; шаблон с несуществующими CERT/KEY не запускать. nginx -t перед reload. Не менять чужие vhost/default. Проверить продление сертификата и таймер ACME. HSTS приложения уже includeSubDomains/preload: перед публичным запуском подтвердить HTTPS всех поддоменов; в preload list автоматически не добавляется.
8. Проверить прямой внешний доступ к APP_PORT/5432 закрыт; приложение слушает 127.0.0.1. За Nginx: secure cookies, Origin/CSRF, SSR цены/404/503, robots/sitemap с реальным доменом. Запросы /.env /prisma/schema.prisma /server.js /package.json /deploy/production.env.example /backups/test.sql не должны возвращать содержимое файлов. Проверить /site и реальный /uploads, admin login и multipart upload. Не создавать заказы на основной ради smoke.
9. Logrotate: адаптировать и проверить logrotate -d на выделенном файле. copytruncate может потерять строки между copy/truncate. PM2 daemon logs тоже контролировать принятым на VPS способом; Nginx error log включить в ротацию, если нестандартный каталог. Отсутствие access log осознанно исключает query-токены и персональные данные.

## Backup и согласованность

Настроить PRIVATE_BACKUP_DIR вне проекта, 0700. backup.env, pg_service.conf, pgpass — приватные файлы 0600 пользователя backup. pgpass формат host:port:database:user:password; вводить редактором/secret manager, не через команды с паролем. Не использовать DATABASE_URL как аргумент pg_dump: там пароль и Prisma schema query.

Ручной запуск после заполнения: bash APP_DIR/scripts/backup.sh /etc/sibdel/backup.env. Для атомарно согласованной пары БД+uploads остановить записи: отключить входящий трафик приложения, дождаться текущих запросов, остановить subscriptions timer и дождаться окончания service, остановить PM2 приложение; сделать backup; затем запустить приложение, вернуть трафик и timer. На живом приложении pg_dump согласован внутри БД, но НЕ атомарен с uploads: удаления/замены могут дать несоответствие. Ночной timer без окна остановки — лишь best effort; перед публикацией согласовать окно или snapshot-процедуру. Скрипт сам не управляет PM2/systemd.

Только после успешного restore-test адаптировать backup units, выполнить systemd-analyze verify, установить units, daemon-reload, enable --now sibdel-backup.timer; проверить list-timers и journalctl -u sibdel-backup.service. Retention 14 дней — локальная политика, не замена offsite. Проверить свободное место до первой полной копии.

Вне VPS: скопировать завершённый каталог через согласованное шифрованное хранилище/SSH на независимый сервер, с отдельными ключами, ограниченными правами и retention. Канал не выбран, автоматическая offsite отправка НЕ реализована. Проверять SHA256 после переноса и периодически восстанавливать именно offsite-копию. Backup содержит персональные данные: ограничить доступ и согласовать сроки хранения.

## Восстановление только в отдельное окружение

Ниже пример для локального Linux PostgreSQL после проверки реальных имён и отсутствия существующей тестовой БД. Не подставлять production database/directory. Не использовать --clean на существующей БД. Не подключать восстановленную БД к production приложению.

1. От PostgreSQL администратора убедиться, что имя sibdel_restore_test_20261015 свободно. Создать отдельную NOLOGIN роль sibdel_restore_owner_20261015 (только если отсутствует). Создать пустую БД:

```sh
sudo -u postgres createuser --no-login --no-superuser --no-createdb --no-createrole sibdel_restore_owner_20261015
sudo -u postgres createdb --template=template0 --owner=sibdel_restore_owner_20261015 sibdel_restore_test_20261015
```

2. В приватной копии завершённого backup: sha256sum -c SHA256SUMS; pg_restore --list database.dump; tar -tzf uploads.tar.gz. Для восстановления использовать только свои доверенные архивы; проверить отсутствие абсолютных путей/.., не распаковывать чужие архивы root. Передать dump в приватную читаемую postgres директорию, не открывать весь backup всем пользователям.

```sh
sudo -u postgres pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --role=sibdel_restore_owner_20261015 --dbname=sibdel_restore_test_20261015 /PRIVATE_POSTGRES_READABLE/database.dump
```

Команда не передаёт пароль. NOLOGIN роль владеет восстановленными объектами, pg_restore подключается через администратора по локальному peer. Для приложения теста отдельно выдать ограниченную LOGIN роль, пароль вводить приватно.

3. Создать НОВУЮ приватную пустую директорию вне production uploads; распаковать tar -xzf ... -C NEW_RESTORE_DIR --no-same-owner от непривилегированного пользователя. Сверить наличие файлов из БД, размеры и выборочные фотографии, таблицы/количество заказов/товаров/миграции. pg_restore --list и SHA256 сами по себе восстановление не подтверждают.
4. Изолированная копия приложения, NODE_ENV=test, порт 3002, DB sibdel_restore_test_20261015, отдельные uploads; реальные письма отключены тестовым режимом. Проверить health и чтение каталога/карточек/фотографий. Не запускать destructive smoke на единственном восстановленном экземпляре: они могут чистить данные. Зафиксировать длительность, дату backup, контрольные показатели и результат.
5. Ничего автоматически не удалять. Тестовую БД/директорию убирать отдельно только после проверки точных имён и сохранения протокола. RPO/RTO ещё не измерены.

## Подписки и monitor

После подстановки APP_USER/GROUP/DIR/NODE_BINARY проверить права чтения .env и запуск Node 24 под этим пользователем. systemd service запускает Node прямо, а не npm. Проверить systemd-analyze verify для units. Генератор: только один timer; убедиться, что нет cron/PM2-дубля. systemd не запускает второй экземпляр того же активного oneshot. Exit=2 остаётся failure для журнала, не маскировать SuccessExitStatus=2 и не включать автоматический Restart для бизнес-ошибок. Persistent может запустить пропущенное задание сразу после enable/boot — включать на основной только при согласованном начале реальной обработки.

Timer каждые 15 минут — по времени сервера; бизнес-даты остаются Asia/Krasnoyarsk. Проверить timedatectl, list-timers, journalctl. Проверять генератор на тестовой БД с защитой проекта. Никакой ручной production генерации ради проверки.

Monitor после адаптации: health, HTTPS доверие/срок >=7 дней, диск/inodes <85%, возраст completed backup <30 часов. Запуск от пользователя с нужными правами чтения backup, без root. Не подключать monitor к backup.lock. Проверить реальный отказ/восстановление на тестовом экземпляре и журнал; внешний uptime и канал уведомлений ещё выбрать. Остановка VPS делает локальный monitor бесполезным.

## Rollback

До установки сохранить текущий релиз, nginx конфиг и приватную копию env. Этот патч не меняет Prisma schema/миграции. При проблеме остановить новые timers, вернуть предыдущие файлы релиза/конфига, nginx -t затем reload, перезапустить PM2 и проверить health. Пользовательские uploads и .env не откатывать из ZIP. Восстановление production БД — отдельная согласованная операция после остановки записей, с оценкой потери новых данных; не часть автоматического rollback. После миграций следующих релизов совместимость старого кода проверять отдельно.

## Справочные первичные источники

- https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- https://www.postgresql.org/docs/18/app-pgdump.html
- https://www.postgresql.org/docs/18/app-pgrestore.html

Этап 7 (финальная приёмка) — после реального restore-test, деплоя и эксплуатационных проверок. Правовые документы и реквизиты из этапа 4 остаются отдельными открытыми вопросами.

### Результат среды подготовки

Node 24.19.0: 81/81 тестов PASS (12 SEO + 65 checkout/trade/delivery/operator/environment + 4 health). Использованы уже доступные зависимости среды (Express 5.3.0), не новая установка npm ci из lockfile. node --check app.js/config/env.js/middleware/health.js/PM2 config — PASS; bash -n обоих shell-скриптов — PASS. PostgreSQL, Nginx и systemd не запускались. Полный app.js с БД, npm audit и точная установка зависимостей из lockfile не проверены. SCSS не менялся, пересборка для этого патча не нужна.

Дополнительно: backup harness с реальными tar/SHA256 и подменёнными pg_dump/pg_restore — PASS: публикация полной пары, контрольные суммы, cleanup при ошибке dump, сохранение предыдущей копии. Это НЕ реальный PostgreSQL backup/restore.
