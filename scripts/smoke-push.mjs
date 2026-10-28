// Fully isolated local fixture: disposable PostgreSQL WASM and synthetic push.
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
  PUSH_ENABLED: 'true', PUSH_MARKETING_ENABLED: 'true', PUSH_MARKETING_SENDER: 'Тестовый рекламораспространитель', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: 'mailto:unit@example.invalid' });
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
  async function contextFor(role, token, width) {
    const context = await browser.newContext({ viewport: { width, height: 950 } });
    await context.addCookies([{ name: role === 'CUSTOMER' ? 'sibdel_session' : 'sibdel_session_admin', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
    const input = { endpoint: `https://fcm.googleapis.com/fcm/send/local-${role}`, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') } };
    await context.addInitScript((subscription) => {
      window.__permissionCalls = 0;
      let simulatedPermission = 'default';
      Object.defineProperty(Notification, 'permission', { get: () => simulatedPermission });
      Notification.requestPermission = () => { window.__permissionCalls++; simulatedPermission = 'granted'; window.__permissionGesture = navigator.userActivation.isActive; return Promise.resolve('granted'); };
      let connected = false;
      Object.defineProperty(ServiceWorkerRegistration.prototype, 'pushManager', { get: () => ({
        getSubscription: async () => connected ? { toJSON: () => subscription, unsubscribe: async () => { connected = false; return true; } } : null,
        subscribe: async () => { connected = true; return { toJSON: () => subscription, unsubscribe: async () => { connected = false; return true; } }; },
      }) });
    }, input);
    const page = await context.newPage(); page.setDefaultTimeout(10000); page.on('pageerror',(e)=>console.log('PAGE ERROR',e.message));
    return { context, page };
  }
  const { context, page } = await contextFor('CUSTOMER', customerToken, 390);
  await page.goto(origin + '/account/settings');
  await page.locator('[data-push-enable]:enabled').waitFor();
  assert.equal(await page.evaluate(() => window.__permissionCalls), 0);
  assert.equal(await page.locator('[data-push-consent-form] input').isChecked(), false);
  // Browser permission is granted by the test harness; no external push service is used.
  await page.locator('[data-push-enable]').click();
  await page.waitForFunction(() => document.querySelector('[data-push-status]').textContent.includes('Это устройство подключено'));
  assert.equal(await page.evaluate(() => window.__permissionCalls), 1);
  assert.equal(await page.evaluate(() => window.__permissionGesture), true);
  assert.equal(await db.pushDevice.count({ where: { userId: customer.id } }), 1);
  await page.locator('[data-push-consent-form] input').check();
  await page.locator('[data-push-consent-form] button').click();
  await page.locator('[data-push-revoke]:visible').waitFor();
  assert.equal((await db.pushPreference.findUnique({ where: { userId: customer.id } })).marketing, true);
  if (screenshots) await page.screenshot({ path: `${screenshots}/push-settings-390.png`, fullPage: true });
  await page.locator('[data-push-revoke]').click();
  await page.locator('[data-push-consent-form]:visible').waitFor();
  assert.equal((await db.pushPreference.findUnique({ where: { userId: customer.id } })).marketing, false);
  console.log('PASS real customer UI + auth + Prisma: no automatic permission request, device binding, explicit consent and revoke');

  await context.grantPermissions(['notifications'], { origin });
  const cdp = await context.newCDPSession(page); let registrationId;
  cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => { registrationId = registrations.find((r) => r.scopeURL === origin + '/' && !r.isDeleted)?.registrationId || registrationId; });
  await cdp.send('ServiceWorker.enable');
  if (!registrationId) await new Promise((resolve) => { const timeout = setTimeout(resolve, 1000); cdp.on('ServiceWorker.workerRegistrationUpdated', () => { clearTimeout(timeout); resolve(); }); });
  assert.ok(registrationId);
  const payload = { id: 99001, title: 'Тест PUSH', body: 'Без личных данных', url: '/account/orders', openPath: '/api/push/open' };
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(payload) });
  await page.waitForFunction(async () => (await (await navigator.serviceWorker.ready).getNotifications({ tag: 'sibdel-99001' })).length === 1);
  // Close the first notification and replay: receipt must prevent redisplay.
  await page.evaluate(async () => { for (const n of await (await navigator.serviceWorker.ready).getNotifications()) n.close(); });
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify(payload) });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications({ tag: 'sibdel-99001' })).length), 0);
  console.log('PASS actual push event, notification display and IndexedDB deduplication after dismissal');

  const own = await contextFor('OWNER', ownerToken, 1366);
  await own.page.goto(origin + '/admin/push');
  await own.page.locator('[data-push-enable]:enabled').waitFor();
  assert.equal(await own.page.evaluate(() => window.__permissionCalls), 0);
  await own.page.locator('[data-push-enable]').click();
  await own.page.waitForFunction(() => document.querySelector('[data-push-status]').textContent === 'Устройство подключено.');
  await own.page.locator('[name=title]').fill('Сезонное предложение');
  await own.page.locator('[name=body]').fill('Посмотрите новые предложения в каталоге.');
  await own.page.locator('[data-push-campaign-form] [type=submit]').click();
  await own.page.locator('[data-push-history] article').waitFor();
  assert.equal(await db.pushCampaign.count(), 1);
  assert.equal((await db.pushCampaign.findFirst()).status, 'DRAFT');
  await own.page.locator('[data-push-test]').click();
  await own.page.waitForFunction(() => document.querySelector('[data-push-status]').textContent.includes('Тест поставлен в очередь'));
  assert.equal(await db.customerNotification.count({ where: { category: 'TEST', userId: owner.id } }), 1);
  if (screenshots) await own.page.screenshot({ path: `${screenshots}/push-admin-1366.png`, fullPage: true });
  await own.page.locator('[data-push-history]').getByRole('button', { name: 'Отменить', exact: true }).click();
  await own.page.waitForFunction(() => document.querySelector('[data-push-history]').textContent.includes('Отменена'));
  await own.page.setViewportSize({ width: 390, height: 950 });
  assert.equal(await own.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  if (screenshots) await own.page.screenshot({ path: `${screenshots}/push-admin-390.png`, fullPage: true });
  console.log('PASS real OWNER UI: enrollment, draft preview, own test queued, cancel, responsive 390/1366px');

  const employee = await contextFor('STAFF', staffToken, 1366);
  for (const route of ['/admin/push', '/admin/push.html', '/admin/%70ush.html', '/admin/PUSH.html']) assert.equal((await employee.page.goto(origin + route)).status(), 403);
  assert.equal((await employee.context.request.get(origin + '/api/admin/push/campaigns')).status(), 403);
  assert.equal((await context.request.get(origin + '/api/admin/push/campaigns')).status(), 401);
  const csrf = await context.request.post(origin + '/api/push/consent', { headers: { Origin: 'https://other.invalid' }, data: { granted: true, version: 'any' } });
  assert.equal(csrf.status(), 403);
  console.log('PASS real cookie/session/RBAC: STAFF page aliases and APIs blocked; customer cannot use OWNER API; CSRF rejected');
  await Promise.all([context.close(), own.context.close(), employee.context.close()]);
  console.log('Browser push checks passed: 4 groups. No real push service or production server contacted.');
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  closeMail?.(); testHook?.deregister(); delete globalThis.__SIBDEL_PUSH_TEST_DB; await db.$disconnect(); await socket.stop(); await pg.close();
}
