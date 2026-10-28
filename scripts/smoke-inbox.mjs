// Fully isolated browser fixture: disposable PostgreSQL WASM, no external services.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { randomBytes, createHash, createECDH } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';
import webpush from 'web-push';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const pg = await PGlite.create();
const socket = new PGLiteSocketServer({ db: pg, port: 0, host: '127.0.0.1' }); await socket.start();
const url = `postgresql://unit@${socket.getServerConn()}/postgres`;
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1 }) });
const keys = webpush.generateVAPIDKeys();
Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: url, APP_URL: 'http://127.0.0.1:3001',
  SESSION_SECRET: 'isolated-unit-test-'.repeat(5), SMTP_HOST: 'unit.invalid', SMTP_USER: 'unit@example.invalid', SMTP_PASS: 'test-only', TO_EMAIL: 'unit@example.invalid',
  PUSH_ENABLED: 'false', PUSH_MARKETING_ENABLED: 'false', PUSH_MARKETING_SENDER: 'Тестовый рекламораспространитель', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:unit@example.invalid' });
let browser, server, appDb, closeMail, testHook;
const screenshots = process.env.PWA_SCREENSHOT_DIR;
if (screenshots) await mkdir(screenshots, { recursive: true });
try {
  for (const name of (await readdir(new URL('../prisma/migrations/', import.meta.url))).filter((n) => /^\d/.test(n)).sort()) await pg.exec(await readFile(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8'));
  const customer = await db.user.create({ data: { role: 'CUSTOMER', email: 'customer@example.invalid', firstName: 'Покупатель', passwordHash: 'test-only' } });
  const owner = await db.user.create({ data: { role: 'OWNER', email: 'owner@example.invalid', firstName: 'Владелец', passwordHash: 'test-only' } });
  const staff = await db.user.create({ data: { role: 'STAFF', email: 'staff@example.invalid', firstName: 'Сотрудник', passwordHash: 'test-only' } });
  const sessionFor = async (user) => {
    const token = randomBytes(48).toString('base64url');
    await db.userSession.create({ data: { userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 86400_000) } }); return token;
  };
  const customerToken = await sessionFor(customer), ownerToken = await sessionFor(owner), staffToken = await sessionFor(staff);
  // Inject this real Prisma client (pool=1) into app modules. PostgreSQL WASM
  // has a single engine connection; production's normal pool is left untouched.
  globalThis.__SIBDEL_PUSH_TEST_DB = db;
  testHook = registerHooks({ load(moduleUrl, context, next) {
    if (moduleUrl.endsWith('/lib/prisma.js')) return { format: 'module', shortCircuit: true,
      source: 'export const prisma = globalThis.__SIBDEL_PUSH_TEST_DB;' };
    return next(moduleUrl, context);
  } });
  let handler;
  server = createServer((request, response) => handler(request, response));
  server.listen(0, '127.0.0.1'); await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.APP_URL = origin;
  process.env.PORT = String(server.address().port);
  const { default: app } = await import('../app.js');
  handler = app;
  ({ prisma: appDb } = await import('../lib/prisma.js'));
  ({ closeMailConnection: closeMail } = await import('../config/mail.js'));
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  const other = await db.user.create({ data: { role: 'CUSTOMER', email: 'other@example.invalid', passwordHash: 'test-only' } });
  const otherToken = await sessionFor(other);
  const category = await db.category.create({ data: { name: 'Пельмени', slug: 'pelmeni' } });
  const product = await db.product.create({ data: { categoryId: category.id, name: 'Пельмени Сибирские', slug: 'pelmeni-sibirskie', sku: 'QA-1', unit: 'PACKAGE', price: 100, stockQuantity: 10 } });
  const order = await db.order.create({ data: { userId: customer.id, number: 'QA-ORDER-1', deliveryMethod: 'PICKUP', customerName: 'Тестовый покупатель', customerPhone: '+79990000000', subtotal: 100, deliveryPrice: 0, total: 100 } });
  const history = [];
  for (let i = 0; i < 23; i++) history.push(await db.customerNotification.create({ data: {
    eventKey: `qa-${i}`, userId: customer.id, category: i % 2 ? 'SUBSCRIPTION' : 'ORDER',
    title: i === 22 ? '<img src=x onerror=alert(1)>' : i % 2 ? 'Изменения подписки' : 'Статус заказа обновлён',
    body: 'Откройте сообщение, чтобы посмотреть актуальные сведения.', url: `/account/order?id=${order.id}`,
  } }));
  const foreign = await db.customerNotification.create({ data: { eventKey: 'qa-other', userId: other.id, category: 'MARKETING', title: 'Чужое сообщение', body: 'PRIVATE', url: '/promotions.html' } });
  const errors = [];
  async function contextFor(role, token, width = 390, standalone = false) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce' });
    await context.addCookies([{ name: role === 'CUSTOMER' ? 'sibdel_session' : 'sibdel_session_admin', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    if (standalone) await context.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    return { context, page };
  }
  const mobile = await contextFor('CUSTOMER', customerToken, 390, true);
  const { page, context } = mobile;
  await page.goto(origin + '/account/notifications');
  await page.locator('[data-inbox-list] li').first().waitFor();
  assert.equal(await page.locator('[data-inbox-list] li').count(), 20);
  assert.equal(await page.locator('[data-inbox-list] img').count(), 0);
  assert.equal(await page.locator('[data-inbox-list] h2').first().textContent(), '<img src=x onerror=alert(1)>');
  assert.equal(await page.locator('[data-notification-count]').textContent(), '24');
  await page.locator('[data-inbox-more]').click();
  await page.waitForFunction(() => document.querySelector('[data-inbox-list]').children.length === 24);
  const firstId = Number(await page.locator('[data-inbox-list] li').first().getAttribute('data-notification-id'));
  await page.locator('[data-inbox-list] li').first().getByRole('button', { name: 'Отметить прочитанным' }).click();
  await page.waitForFunction(() => document.querySelector('[data-notification-count]').textContent === '23');
  assert.ok((await db.customerNotification.findUnique({ where: { id: firstId } })).readAt);
  assert.equal((await db.customerNotification.findUnique({ where: { id: firstId } })).openedAt, null);
  await page.locator('[name=unread]').check();
  await page.locator('[data-inbox-filters]').getByRole('button', { name: 'Показать', exact: true }).click();
  await page.locator('[data-inbox-list] li').first().waitFor();
  assert.equal(await page.locator('.account-inbox__item:not(.account-inbox__item--unread)').count(), 0);
  console.log('PASS actual inbox UI + PostgreSQL: history, unread badge, paging, explicit read, XSS-safe rendering');

  const endpoint = '/api/account/notifications';
  const api = (path, options = {}) => context.request.fetch(origin + endpoint + path, { ...options, headers: { Origin: origin, ...(options.headers || {}) } });
  const response = await api(''); assert.equal(response.headers()['cache-control'], 'no-store');
  for (const query of ['?limit=0', '?limit=51', '?before=-1', '?before=1.5', '?category=TEST', '?userId=99', '?unread=yes']) assert.equal((await api(query)).status(), 400);
  assert.equal((await api(`/${foreign.id}/read`, { method: 'PATCH', data: {} })).status(), 404);
  assert.equal((await api(`/${firstId}/read`, { method: 'PATCH', data: { userId: other.id } })).status(), 400);
  assert.equal((await api('/read-all', { method: 'POST', data: { throughId: 0 } })).status(), 400);
  assert.equal((await api('/read-all', { method: 'POST', headers: { Origin: 'https://other.invalid' }, data: { throughId: firstId } })).status(), 403);
  const second = await contextFor('CUSTOMER', otherToken);
  const ownB = await second.context.request.get(origin + endpoint);
  assert.deepEqual((await ownB.json()).notifications.map((n) => n.id), [foreign.id]);
  assert.equal((await second.context.request.patch(origin + endpoint + `/${firstId}/read`, { headers: { Origin: origin }, data: {} })).status(), 404);
  for (const [role, token] of [['OWNER',ownerToken],['STAFF',staffToken]]) {
    const denied = await contextFor(role, token);
    assert.equal((await denied.context.request.get(origin + endpoint)).status(), 401);
    await denied.context.close();
  }
  const guest = await browser.newContext(); assert.equal((await guest.request.get(origin + endpoint)).status(), 401); await guest.close();
  console.log('PASS actual auth/CSRF/strict validation: foreign customer, guest, OWNER/STAFF cannot access customer history');

  const fresh = await db.customerNotification.create({ data: { eventKey: 'qa-arrived-during-read-all', userId: customer.id, category: 'ORDER', title: 'Новое сообщение', body: 'Пришло после загрузки списка.', url: '/account/orders' } });
  await page.locator('[data-inbox-read-all]').click();
  await page.waitForFunction(() => document.querySelector('[data-inbox-list]').children.length === 1);
  assert.equal(await page.locator('[data-inbox-list] h2').textContent(), 'Новое сообщение');
  assert.equal((await db.customerNotification.findUnique({ where: { id: fresh.id } })).readAt, null);
  assert.equal((await db.customerNotification.findUnique({ where: { id: foreign.id } })).readAt, null);
  if (screenshots) await page.screenshot({ path: `${screenshots}/inbox-pwa-390.png`, fullPage: true });
  await page.locator('[data-inbox-list] a').click();
  await page.waitForURL('**/account/orders');
  assert.ok((await db.customerNotification.findUnique({ where: { id: fresh.id } })).readAt);
  await page.goto(origin + '/account/notifications');
  await page.locator('[data-inbox-filters]').waitFor();
  await page.locator('[name=category]').selectOption('MARKETING');
  await page.locator('[data-inbox-filters]').getByRole('button', { name: 'Показать', exact: true }).click();
  await page.locator('[data-inbox-empty]:visible').waitFor();
  console.log('PASS snapshot mark-all, new arrivals remain unread, click marks read without faking PUSH opens, filter empty state');

  await page.locator('[data-pwa-navigation]:visible').waitFor();
  assert.equal(await page.locator('[data-pwa-section=profile]').getAttribute('aria-current'), 'page');
  await page.locator('[name=category]').focus();
  await page.locator('[data-pwa-navigation]').waitFor({ state: 'hidden' });
  await page.locator('#notifications-title').click();
  await page.locator('[data-pwa-navigation]:visible').waitFor();
  assert.equal((await api('', { method: 'GET' })).status(), 200);
  const cart = await context.request.post(origin + '/api/cart/items', { headers: { Origin: origin }, data: { slug: product.slug, quantity: 2 } });
  assert.equal(cart.status(), 200);
  await page.goto(origin + '/cart.html');
  await page.locator('[data-cart-mobile-bar]:visible').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-pwa-cart-count]')?.textContent === '2');
  const bar = await page.locator('[data-cart-mobile-bar]').boundingBox();
  const nav = await page.locator('[data-pwa-navigation]').boundingBox();
  assert.ok(bar.y + bar.height <= nav.y, 'cart checkout bar must remain above navigation');
  assert.equal(await page.locator('[data-pwa-section=cart]').getAttribute('aria-current'), 'page');
  if (screenshots) await page.screenshot({ path: `${screenshots}/cart-pwa-390.png`, fullPage: true });
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-pwa-cart-count]')?.textContent === '2');
  await page.goto(origin + '/checkout.html');
  assert.equal(await page.locator('[data-pwa-navigation]').count(), 0);
  console.log('PASS installed-only mobile nav, keyboard focus, active links, existing persistent cart/count and checkout bar clearance');

  await page.goto(origin + '/account/notifications');
  await page.locator('[data-inbox-list] li').first().waitFor();
  for (const width of [320, 390, 767, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (width === 1440) {
      assert.equal(await page.locator('[data-pwa-navigation]').isVisible(), false);
      if (screenshots) await page.screenshot({ path: `${screenshots}/inbox-desktop-1440.png`, fullPage: true });
    }
  }
  await second.page.goto(origin + '/account/notifications');
  await second.page.locator('[data-inbox-list] li').first().waitFor();
  assert.equal(await second.page.locator('[data-pwa-navigation]').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/account/settings');
  await page.locator('[data-push-controls]:visible').waitFor();
  await page.locator('[data-push-service-form] [name=orders]').uncheck();
  await page.locator('[data-push-service-form] button').click();
  await page.waitForFunction(() => document.querySelector('[data-push-status]').textContent === 'Сервисные категории сохранены.');
  assert.equal((await db.pushPreference.findUnique({ where: { userId: customer.id } })).orders, false);
  await page.goto(origin + '/account/notifications');
  await page.locator('[data-inbox-list] li').first().waitFor();
  assert.equal(await page.locator('[data-inbox-list] li').count(), 20);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('meta[name=viewport]')].every((m) => m.content.includes('viewport-fit=cover'))), true);
  console.log('PASS responsive 320/390/767/1440, ordinary browser has no duplicate bottom nav, PUSH settings retained without hiding history');
  assert.deepEqual(errors, []);
  await Promise.all([context.close(), second.context.close()]);
  console.log('Inbox browser checks passed: 6 groups. No configured database, SMTP or push provider contacted.');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  closeMail?.(); testHook?.deregister(); delete globalThis.__SIBDEL_PUSH_TEST_DB; await db.$disconnect(); await socket.stop(); await pg.close();
}
