# Этап 2 — Согласованность торговли

Патч подготовлен по архиву sibDel — копия(20261015-105934).zip с Git HEAD 6997848.
Применять на компьютере отца: C:\Users\ШУМ\WORKS\sibDel.
В архиве только 16 изменённых/новых файлов проекта и эта инструкция.
Миграций, изменений схемы Prisma и зависимостей нет. npm ci не требуется.

## Что исправлено

- Фильтр цены и скидок каталога работает по результату Promotions. Подсчёт и пагинация выполняются после фильтрации.
- Сортировка цены использует конечную цену; сортировка скидки — относительную скидку (oldPrice − price) / oldPrice, затем конечную цену и ID.
- Для запросов с ценовой фильтрацией/сортировкой сначала загружается весь набор кандидатов, подходящий по остальным условиям. Это обеспечивает правильные результаты при пересекающихся акциях. Для обычного каталога и популярных товаров сохранена пагинация в БД. При значительном росте каталога потребуется отдельная оптимизация ценового запроса; текущая реализация не кеширует временные границы акций.
- Главная использует /api/catalog?hit=1&available=1&sort=popular&limit=12. Статические карточки и ссылка на отсутствующий cutlets.webp удалены. Классы карточек и настройки Swiper сохранены.
- Пустая подборка скрывается. При ошибке API выводится сообщение, устаревшие цены не показываются. Названия/атрибуты экранируются, для отсутствующего изображения предусмотрена существующая картинка.
- Корзина, избранное и главная поддерживают загруженные через CMS изображения /uploads/products/.
- Избранное применяет те же Promotions, что каталог, карточка, корзина и Checkout.
- Доступность учитывает минимальное количество покупки; остаток меньше minQuantity считается недоступным. Каталог, карточка и главная используют stockQuantity − reservedQuantity.
- Максимальное количество находится на сетке min + n × step, дробные остатки не обрезаются до целого. Ввод в корзине и карточке сохраняет точность минимального количества. Добавление из избранного использует min.
- Статусы заказов и складские операции повторяют Serializable-транзакцию до 3 попыток только при P2034 или P2010 с SQLSTATE 40001 в meta.code либо meta.driverAdapterError.cause.originalCode (PostgreSQL serialization_failure). Каждая попытка заново читает состояние, все движения и аудит остаются внутри транзакции. Произвольные ошибки, P2002 и ошибки неопределённого результата не повторяются. Это retry одной откатившейся транзакции, а не защита от повторной отправки складского HTTP-запроса пользователем.
- Существующий retry Subscriptions оставлен без изменений. Уведомления и расписание генерации не затронуты.

## Фактически выполнено здесь

Node.js 24.19.0:

- npm run test:trade-unit — 15/15 PASS (после исправления raw SQL retry). Реальные сервисы с подменённым клиентом БД; границы акций, фильтрация/пагинация, цены избранного и корзины, дробные количества, моделирование rollback/retry и повтор статуса, HTML главной.
- tests/checkout-security.test.mjs + tests/test-environment.test.mjs — 23/23 PASS.
- tests/delivery-pricing.test.mjs — 9/9 PASS.
- node --check — все 14 изменённых/новых JS/MJS-файлов PASS.
- git diff --check для изменённых отслеживаемых файлов — PASS.

Полный npm run test:checkout-security попытался запуститься, но checkout-route.test.mjs не смог загрузить express: зависимости проекта здесь не установлены. Остальные 23 теста прошли. Это не считается прохождением полного набора.

PostgreSQL/HTTP smoke, визуальная проверка браузером и актуальный npm audit здесь НЕ выполнялись. PostgreSQL и установленных зависимостей проекта в этом окружении нет. Основная БД не подключалась и не изменялась. Изолированные тесты не читают .env и не подключаются к PostgreSQL.

## 1. До распаковки — Windows CMD

Остановить локальное приложение. В CMD:

```bat
cd /d C:\Users\ШУМ\WORKS\sibDel
git remote -v
git branch --show-current
git log -1 --oneline
git status --short
```

Ожидается origin=Dimas-Shumil/SibDel, upstream=PabloAlligator/SibDel, main, 6997848 и пустой status. Если есть новые локальные изменения — сначала сохранить их и сравнить с патчем; не перезаписывать их вслепую.

Распаковать содержимое ZIP непосредственно в корень sibDel с заменой файлов, без дополнительной папки. .env, .env.test, .git, uploads и БД в патче отсутствуют. Не запускать migrate reset, db push или миграции: схема не менялась.

```bat
git diff --check
git diff --stat
npm run test:trade-unit
npm run test:checkout-security
npm run test:delivery-unit
```

## 2. Проверить тестовое подключение и запустить сервер — окно CMD №1

```bat
cd /d C:\Users\ШУМ\WORKS\sibDel
set DOTENV_CONFIG_PATH=.env.test
node --input-type=module -e "import { env } from './config/env.js'; import { prisma } from './lib/prisma.js'; import { assertTestEnvironment } from './utils/test-environment.js'; try { await assertTestEnvironment(env, prisma, { http: false }); console.log('TEST_DB_OK', env.NODE_ENV, env.APP_URL, env.PORT); } finally { await prisma.$disconnect(); }"
npm start
```

Продолжать только при TEST_DB_OK, NODE_ENV=test, APP_URL=http://localhost:3002, PORT=3002 и базе sibdel_delivery_test в .env.test. Guard сравнивает фактический current_database(). Команда не печатает пароль или DATABASE_URL.

## 3. Smoke — окно CMD №2

```bat
cd /d C:\Users\ШУМ\WORKS\sibDel
set DOTENV_CONFIG_PATH=.env.test
npm run test:promotions-smoke
npm run test:checkout-smoke
npm run test:delivery-smoke
npm run test:subscriptions-smoke
npm run test:inventory-smoke
npm run test:admin-catalog-smoke
npm run test:admin-customers-smoke
npm run test:reviews-smoke
```

При ошибке остановиться и сохранить вывод; не считать последующие команды подтверждением проваленного теста. HTTP smoke проверяет порт 3002 и совпадение fingerprint БД сервера и скрипта. Для smoke нужны уже существующие тестовые товары, настроенные доставка и самовывоз, как при предыдущих прогонах.

Расширенный promotions-smoke проверяет каталог/главную через тот же сервис, карточку, избранное, корзину и снимок Checkout, затем недостаточный остаток, неактивные товар/категорию. inventory-smoke добавляет конкурентную отмену одного заказа и поступления в отдельный временный товар. Он проверяет отсутствие двойных движений и очищает временный товар. Эти проверки подготовлены, но здесь НЕ запускались на PostgreSQL.

Предупреждение pg о параллельном client.query не объявлено исправленным; причина по-прежнему требует трассировки.

## 4. Ручная приёмка на http://localhost:3002

- Главная: популярные активные товары, цены и скидки совпадают с каталогом/карточкой. Изображения CMS видны; корзина и избранное работают; Swiper сохраняет перелистывание и адаптивность.
- Товар со снижением цены акцией попадает в диапазон конечной цены. Проверить обе ценовые сортировки, скидки и следующую страницу.
- Проверить дробный товар с min=0.25, step=0.5: добавление, изменение количества, максимальный остаток с резервом; особенно добавление из избранного.
- Отключённые товар/категория не выводятся на главной и в каталоге, ранее добавленные избранные недоступны для покупки.
- Остаток меньше минимального: нельзя добавить на главной, в каталоге, карточке или избранном. Уже открытая страница может устареть; сервер корзины и Checkout остаётся окончательным источником истины.
- У акций начало включительно, окончание исключительно. Для проверки перехода обновить страницу/получить новый ответ API; автоматического обновления уже открытой страницы по таймеру не добавлялось.
- Админка: отмена заказа возвращает резерв один раз; завершение списывает один раз; повтор того же статуса не создаёт нового движения.

## 5. Актуальный audit

```bat
npm audit --omit=dev
npm audit
```

Записать фактический результат. Не запускать npm audit fix --force автоматически.

## 6. После успешных проверок — Git

```bat
git remote -v
git branch --show-current
git status --short
git diff --check
git add package.json public/index.html services/catalog.service.js services/commerce.service.js services/favorite.service.js services/inventory.service.js services/order.service.js services/product.service.js site/js/catalog.js site/js/cart.js site/js/main.js site/js/product.js scripts/smoke-promotions.mjs scripts/smoke-inventory.mjs tests/trade-consistency.test.mjs utils/transactions.js STAGE2-VERIFY.md
git diff --cached --check
git diff --cached --stat
git commit -m "fix: align trade pricing availability and transaction retries"
git push origin main
git status --short
```

Отправка только в origin (Dimas-Shumil/SibDel). upstream не изменять. При появлении чужих новых коммитов не выполнять force push; сначала разобраться с расхождением.

## 7. Возврат к основной локальной среде

Остановить тестовый сервер Ctrl+C. В каждом использованном CMD:

```bat
set DOTENV_CONFIG_PATH=
```

Затем npm start запускает основное окружение из .env на 3001. Smoke на нём не запускать.

## Следующий этап

Этап 2 пока ожидает локальные PostgreSQL/HTTP smoke и ручную приёмку. После их успеха и отправки коммита передать результаты и новый hash в чат: тогда подготовить подробный промт «3. Работа оператора» по фактической контрольной точке. Здесь не заявляется, что коммит создан/отправлен или этап окончательно принят.


## Дополнение: исправление конфликта raw SQL

После первого патча локально подтверждены test:trade-unit 13/13,
test:checkout-security 24/24, test:delivery-unit 9/9, а также smoke
Promotions, Checkout, Delivery и Subscriptions. Inventory smoke обнаружил
PostgreSQL SQLSTATE 40001 в $queryRaw. Prisma оборачивает такой конфликт
raw-запроса в P2010; первый вариант helper распознавал только P2034.

Дополнительный SibDel-Stage2-retry-fix.zip применяется поверх первого патча.
Он заменяет utils/transactions.js, tests/trade-consistency.test.mjs и эту инструкцию.
Retry ограничен тремя попытками и распознаёт только P2034 либо P2010 с
точным meta.code="40001". Прочие P2010 не повторяются. Добавлена проверка
лимита попыток и моделирование отката складских операций для обоих видов
конфликта. Изолированные тесты после исправления: 15/15 PASS.
Реальный Inventory smoke после этого исправления здесь не выполнялся.

После замены файлов остановить тестовый сервер Ctrl+C и снова запустить его
в том же CMD с DOTENV_CONFIG_PATH=.env.test. Затем во втором тестовом CMD:

```bat
npm run test:trade-unit
npm run test:inventory-smoke
```

При повторной ошибке остановиться и передать полный вывод. Предупреждение
pg client.query остаётся отдельным неисследованным вопросом.


## Подтверждённая структура ошибки Prisma 7.10

Локальная диагностика показала P2010, где SQLSTATE расположен в
error.meta.driverAdapterError.cause.originalCode = "40001", а cause.kind =
"TransactionWriteConflict". Предыдущая проверка только meta.code его пропускала.

SibDel-Stage2-retry-final.zip заменяет helper, регрессионные тесты и эту инструкцию
поверх уже применённых патчей этапа 2. Временная диагностика из helper удалена.
Теперь распознаётся подтверждённый вложенный originalCode, сохранена совместимость
с meta.code. Один лишь текст сообщения или kind не служит основанием для retry.
В тестах смоделированы откат и единственное итоговое складское движение для
точной структуры Prisma 7.10. Изолированный набор: 15/15 PASS. Реальный smoke
после этого исправления ещё требует локального запуска.

```bat
set DOTENV_CONFIG_PATH=.env.test
set SIBDEL_TRANSACTION_DIAGNOSTICS=
npm run test:trade-unit
npm run test:inventory-smoke
```
