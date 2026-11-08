# Этап 3 — Работа оператора

Основа: ZIP от 15.10.2026, контрольная точка 5357fad.
Изменения схемы Prisma, миграции и новые зависимости не нужны.

## Что изменено

- Новый services/order-notification.service.js использует существующий notification.service.js и SMTP-конфигурацию. После успешной транзакции Checkout и нового заказа подписки отправляются независимые письма оператору (TO_EMAIL) и покупателю (customerEmail, если указан). Письма содержат зафиксированный состав, суммы, дату, способ получения, адрес и контакты. Оператор получает ссылку /admin/order?order=..., авторизованный покупатель — /account/order?id=.... Гостю ссылка на кабинет не отправляется. Текстовый формат исключает интерпретацию пользовательских строк как HTML.
- Replay Checkout, включая ветку P2002, и повтор генерации подписки уведомления не запускают. Уведомления выполняются после commit, вне транзакций и retry. Ошибка чтения заказа или SMTP перехватывается: заказ остаётся принятым. Одна неудачная отправка не блокирует вторую.
- При NODE_ENV=test уведомления полностью пропускаются, включая чтение заказа для письма. Unit-тесты используют подменённые зависимости; реальные письма при проверках не отправлялись.
- Генерация подписок использует общий Serializable retry: P2034 либо P2010 с подтверждённым SQLSTATE 40001, до трёх попыток. Уведомление происходит после успешной попытки.
- При инфраструктурной ошибке подписка остаётся due для следующего запуска. Только ожидаемые бизнес-ошибки (expose=true), например недоступный состав, записывают FAILED и переводят следующую дату вперёд по существующему правилу. FAILED-доставка автоматически повторно не создаётся; оператор должен проверить историю подписки и связаться с покупателем. Это существующая политика пропуска проблемного вхождения, а не очередь повторной доставки.
- Пакет продолжает работу после ошибки отдельной подписки; CLI возвращает exit code 2 при наличии ошибок, 1 при общей ошибке, 0 при успехе.
- Карточка заказа показывает последние 100 записей существующего AdminActivity по этому заказу, автора, время и причину. Сохраняются исходные элементы интерфейса, статусы и складской учёт. У заказа из подписки есть ссылка, открывающая существующую панель подписки. Время в админке форматируется в Asia/Krasnoyarsk.
- scripts/smoke-subscriptions.mjs теперь одновременно запускает две генерации одной даты, требует ровно один новый заказ, одну доставку и отсутствие повторного резерва после replay.
- CLI закрывает SMTP-пул перед завершением. Подготовлены шаблоны systemd service/timer для будущего VPS.

## Границы уведомлений

Отправка best effort: без outbox, автоматического повтора и отметки доставки в интерфейсе. Ошибка фиксируется в логах. Падение процесса после commit до отправки может потерять письмо; replay намеренно его не повторяет. Источником новых заказов остаётся список заказов админки. Для гарантированной доставки потребуется отдельная задача с outbox и миграцией — в этот патч не входит.

Отправка ожидается перед ответом Checkout/генерации: недоступный SMTP может увеличить время ответа в пределах существующих SMTP-таймаутов. Уже созданный заказ не откатывается. Если клиент дождался таймаута, повтор с тем же idempotencyKey вернёт существующий заказ.

TO_EMAIL — адрес оператора, APP_URL — фактический адрес платформы, SMTP_USER/SMTP_PASS/SMTP_HOST — текущие настройки. Проверьте их локально, не публикуйте .env. В development письма включены; любые тестовые покупки основной среды могут отправлять реальные письма. Для автоматических проверок используйте только NODE_ENV=test.

## Выполнено в среде подготовки

Node.js 24.19.0. Зависимости установлены из lockfile командой npm ci --ignore-scripts --no-audit --no-fund.

- Checkout security + router + environment: 24/24 PASS.
- Trade consistency: 16/16 PASS.
- Delivery unit: 9/9 PASS.
- Operator workflow: 16/16 PASS (последний прямой запуск node --experimental-vm-modules --test tests/operator-workflow.test.mjs).
- Синтаксис изменённых JS/MJS проверен node --check.
- Содержимое патча сверено со свежим ZIP; секреты, .git, node_modules, generated, БД и uploads исключены.

PostgreSQL в этой среде отсутствует. Smoke, реальная конкуренция PostgreSQL и ручная браузерная приёмка здесь НЕ выполнены. Ранее подтверждённые проверки этапа 2 не считаются проверками нового патча. Предупреждение pg о параллельном client.query и dev-аудит этим патчем не исправлялись.

## Установка на компьютере отца — Windows CMD

Сначала остановите локальный сервер. Выполняйте из проекта:

```bat
cd /d C:\Users\ШУМ\WORKS\sibDel
git remote -v
git branch --show-current
git status --short
```

Ожидается origin=Dimas-Shumil/SibDel, upstream=PabloAlligator/SibDel, main и чистое дерево. При отличиях остановитесь и разберите их; не делайте reset/clean.

```bat
git switch -c fix/operator-workflow
powershell -NoProfile -Command "Expand-Archive -LiteralPath '%USERPROFILE%\Downloads\SibDel-Stage3-Operator-patch.zip' -DestinationPath '.' -Force"
git diff --check
git diff --stat
git status --short
npm run test:checkout-security
npm run test:trade-unit
npm run test:delivery-unit
npm run test:operator-unit
```

Если браузер сохранил ZIP под другим именем или в другой папке, поправьте только путь архива. Распаковка заменяет файлы проекта: используйте именно архив патча. npm install, prisma generate и миграции для этого патча не требуются.

## PostgreSQL / HTTP smoke — выполнить у пользователя

В первом отдельном CMD, из корня проекта:

```bat
set DOTENV_CONFIG_PATH=.env.test
npm start
```

Ожидаются NODE_ENV=test, sibdel_delivery_test, http://localhost:3002. Выбор файла действует только на новый процесс. Если сервер уже запущен на 3001, не используйте его для этих проверок.

Во втором CMD:

```bat
cd /d C:\Users\ШУМ\WORKS\sibDel
set DOTENV_CONFIG_PATH=.env.test
npm run test:subscriptions-smoke
npm run test:checkout-smoke
npm run test:delivery-smoke
npm run test:inventory-smoke
npm run test:promotions-smoke
npm run test:admin-catalog-smoke
npm run test:admin-customers-smoke
npm run test:reviews-smoke
```

Защита smoke проверяет тестовое окружение и фактическую БД до записи; HTTP smoke также проверяет порт/fingerprint. Остановитесь на ошибке и сохраните вывод. Не запускайте subscriptions:generate-due на основной БД как тест: это рабочая команда, создающая реальные заказы и отправляющая письма.

После smoke остановите тестовый сервер и в каждом используемом окне очистите выбор:

```bat
set DOTENV_CONFIG_PATH=
```

Затем npm start вернёт основную среду из .env на 3001. Пустая таблица пользователей тестовой БД не является ошибкой входа; не переносите туда реальные аккаунты для smoke.

## Ручная приёмка — пока не подтверждена

На контролируемых тестовых данных проверить:

1. Обычный заказ: покупатель/состав/суммы/адрес/самовывоз/дата/резерв.
2. Заказ подписки: переход из подписки в заказ и обратно к панели подписки.
3. Смена статуса и причина: запись видна после обновления, финальный статус не предлагает переходов.
4. Узкий экран карточки заказа, история и длинные строки.
5. Уведомления уже проверены подменой, но реальную SMTP-доставку при необходимости проверять только на контролируемые адреса, отдельно от smoke, с проверенными TO_EMAIL/customerEmail. Не использовать адрес реального клиента для такой проверки.

## Git после успешных проверок

```bat
git add admin-pages/order.html package.json scripts/generate-subscription-orders.mjs scripts/smoke-subscriptions.mjs services/checkout.service.js services/order.service.js services/subscription.service.js services/order-notification.service.js site/js/admin.js tests/checkout-security.test.mjs tests/trade-consistency.test.mjs tests/operator-workflow.test.mjs utils/transactions.js deploy/sibdel-subscriptions.service deploy/sibdel-subscriptions.timer STAGE3-VERIFY.md
git diff --cached --check
git diff --cached --stat
git status --short
git commit -m "feat: complete operator order workflow and subscription scheduling"
git switch main
git merge --ff-only fix/operator-workflow
git push origin main
git status
```

Upstream не изменяется. На VPS ничего не выкладывается.

## Будущий VPS — только этап 6

systemd timer работает рядом с приложением PM2, не создаёт отдельный веб-процесс и не зависит от его рестартов. Проверка каждые 15 минут по часам сервера; выбор due-date внутри кода — Asia/Krasnoyarsk. Запуск после пропущенного расписания включён Persistent=true. Один и тот же oneshot service не запускается параллельно самим timer; уникальные ключи и Serializable защищают также от ручного конкурентного запуска.

Перед будущей установкой адаптировать User/Group=sibdel, WorkingDirectory=/var/www/sibdel, DOTENV_CONFIG_PATH и /usr/bin/node к фактическому серверу. Этот пользователь должен читать приложение и .env, иметь доступ к БД; Node должен быть версии 24. Не выполнять шаблон как есть, если пути или пользователь отличаются. NODE_ENV задаётся production; основная .env должна соответствовать production.

Только после отдельного серверного развёртывания и backup:

```sh
sudo install -m 0644 deploy/sibdel-subscriptions.service /etc/systemd/system/sibdel-subscriptions.service
sudo install -m 0644 deploy/sibdel-subscriptions.timer /etc/systemd/system/sibdel-subscriptions.timer
sudo systemctl daemon-reload
sudo systemctl enable --now sibdel-subscriptions.timer
sudo systemctl list-timers sibdel-subscriptions.timer
sudo journalctl -u sibdel-subscriptions.service -n 100 --no-pager
```

Не включать одновременно второй cron/PM2-генератор. Каждый запуск обрабатывает до 100 подписок: при большом backlog нужно оценить лимит и частоту. Таймаут сервиса 15 минут; принудительная остановка может потерять уведомление после commit, но повторный запуск не должен создать второй заказ той же даты. Выход 2 подсвечивает частичные ошибки в systemd; журнал нужно контролировать. Внешнее оповещение о сбое относится к этапу мониторинга.

Расписание подготовлено, но НЕ установлено и НЕ проверено на VPS.
