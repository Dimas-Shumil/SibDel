// Local fixture only: no PostgreSQL, SMTP, production server or browser account.
import assert from 'node:assert/strict';
import express from 'express';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pwaMiddleware } from '../middleware/pwa.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const app = express();
let testWorkerVersion = null;
app.get('/sw.js', async (_req, res, next) => {
  if (!testWorkerVersion) return next();
  const code = await readFile(`${root}/public/sw.js`, 'utf8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript').send(code.replace("const VERSION = '11a-1'", `const VERSION = '${testWorkerVersion}'`));
});
app.use(pwaMiddleware(`${root}/public`));
app.use('/site', express.static(`${root}/site`));
app.use('/components', express.static(`${root}/components`));
// Keep the production CSP constraints in this isolated fixture.
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; worker-src 'self'; manifest-src 'self'; connect-src 'self'");
  next();
});
app.use('/api', (_req, res) => res.status(503).json({ ok: false }));
app.get(['/account', '/account/orders'], (_req, res) => res.sendFile(`${root}/public/account/index.html`));
app.get('/admin/login', (_req, res) => res.sendFile(`${root}/admin-pages/login.html`));
app.get('/', async (_req, res) => {
  let html = await readFile(`${root}/public/index.html`, 'utf8');
  const header = await readFile(`${root}/components/header.html`, 'utf8');
  html = html.replace('<div data-component="header"></div>', `<div data-component="header">${header}</div>`);
  res.type('html').send(html);
});
app.use(express.static(`${root}/public`));
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const screenshotDir = process.env.PWA_SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
let checks = 0;
const pass = (label) => { checks++; console.log(`PASS ${label}`); };
const android = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/134.0.0.0 Mobile Safari/537.36' };
const emitPrompt = async (page, outcome = 'dismissed') => page.evaluate((choice) => {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  event.prompt = async () => { window.__promptCalls = (window.__promptCalls || 0) + 1; };
  event.userChoice = Promise.resolve({ outcome: choice });
  window.dispatchEvent(event);
}, outcome);
const newPage = async (options = android) => {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.clock.install({ time: new Date('2026-10-28T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-10-28T12:00:01Z'));
  return { context, page };
};
const visit = async (page, pathname = '/') => {
  await page.goto(origin + pathname);
  // Resolves once module execution and worker installation have completed.
  if (!/^\/(admin|checkout)/.test(pathname)) await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
};
try {
  {
    const { context, page } = await newPage();
    await visit(page);
    await emitPrompt(page);
    await page.clock.runFor(9999);
    assert.equal(await page.locator('.pwa-panel--install').count(), 0);
    await page.clock.runFor(1);
    assert.equal(await page.locator('.pwa-panel--install').count(), 1);
    await page.clock.runFor(300);
    assert.ok(await page.locator('.pwa-panel--install').isVisible());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (screenshotDir) await page.screenshot({ animations: 'disabled', path: `${screenshotDir}/android-install.png` });
    await page.getByRole('button', { name: 'Позже', exact: true }).click();
    assert.equal(await page.locator('.pwa-panel--install').count(), 0);
    await visit(page, '/promotions.html');
    await emitPrompt(page);
    await page.clock.runFor(11_000);
    assert.equal(await page.locator('.pwa-panel--install').count(), 0);
    pass('10-second delay; Later persists across internal page navigation; 390px layout');
    // New visit in the same tab after the documented 30-minute idle boundary.
    await page.addInitScript(() => {
      const v = JSON.parse(sessionStorage.getItem('sibdel:pwa:visit'));
      v.lastSeen -= 31 * 60_000;
      sessionStorage.setItem('sibdel:pwa:visit', JSON.stringify(v));
    });
    await visit(page);
    await emitPrompt(page);
    await page.clock.runFor(10_000);
    await page.clock.runFor(300);
    assert.equal(await page.locator('.pwa-panel--install').count(), 1);
    // Native-like pointer sequence, rather than calling the dismiss handler.
    await page.locator('.pwa-panel--install').dispatchEvent('pointerdown', { clientX: 100, clientY: 130, pointerId: 1 });
    await page.locator('.pwa-panel--install').dispatchEvent('pointermove', { clientX: 103, clientY: 65, pointerId: 1 });
    assert.equal(await page.locator('.pwa-panel--install').count(), 0);
    pass('new separate visit shows promotion again; upward swipe dismisses');
    await context.close();
  }
  {
    const { context, page } = await newPage();
    await visit(page);
    await emitPrompt(page, 'accepted');
    await page.clock.runFor(10_300);
    await page.getByRole('button', { name: 'Установить', exact: true }).click();
    assert.equal(await page.evaluate(() => window.__promptCalls), 1);
    await visit(page, '/catalog.html');
    await emitPrompt(page);
    await page.clock.runFor(11_000);
    assert.equal(await page.locator('.pwa-panel--install').count(), 0);
    pass('install calls deferred prompt only on click; accepted install suppresses later banners');
    await context.close();
  }
  {
    const options = { ...android, viewport: { width: 320, height: 720 }, reducedMotion: 'reduce',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' };
    const { context, page } = await newPage(options);
    await visit(page);
    await page.clock.runFor(10_000);
    await page.getByRole('button', { name: 'Установить', exact: true }).click();
    assert.match(await page.locator('.pwa-panel__content p').innerText(), /Поделиться.*На экран Домой/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.locator('.pwa-panel--install').evaluate((el) => getComputedStyle(el).animationName), 'none');
    if (screenshotDir) await page.screenshot({ animations: 'disabled', path: `${screenshotDir}/ios-help-320.png` });
    await page.getByRole('button', { name: 'Закрыть предложение установки' }).click();
    pass('Safari instructions, close control, 320px layout and reduced motion');
    await context.close();
  }
  {
    const { context, page } = await newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
    await visit(page);
    await emitPrompt(page);
    await page.clock.runFor(11_000);
    assert.equal(await page.locator('.pwa-panel--install').count(), 0);
    pass('installed PWA never displays installation banner');
    await context.close();
  }
  {
    for (const pathname of ['/checkout.html', '/admin/login']) {
      const { context, page } = await newPage();
      await visit(page, pathname);
      await emitPrompt(page);
      await page.clock.runFor(11_000);
      assert.equal(await page.locator('.pwa-panel').count(), 0);
      assert.equal(await page.evaluate(() => navigator.serviceWorker.getRegistration().then(Boolean)), false);
      await context.close();
    }
    pass('checkout/admin have no promotion or new worker registration');
  }
  {
    const { context, page } = await newPage();
    await visit(page);
    await page.reload();
    assert.equal(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), true);
    await page.evaluate(async () => {
      await fetch('/api/account/orders');
      await fetch('/api/cart');
    });
    const urls = await page.evaluate(async () => {
      const keys = await caches.keys();
      return (await Promise.all(keys.map(async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname)))).flat();
    });
    assert.ok(urls.includes('/offline.html'));
    assert.equal(urls.some((url) => /^\/(api|account|cart|checkout|catalog|admin)/.test(url)), false);
    await context.setOffline(true);
    await page.goto(origin + '/account/orders');
    assert.equal(await page.getByRole('heading', { name: 'Пока нет подключения' }).count(), 1);
    if (screenshotDir) await page.screenshot({ animations: 'disabled', path: `${screenshotDir}/offline.png` });
    await context.setOffline(false);
    await page.reload();
    assert.equal(await page.getByRole('heading', { name: 'Пока нет подключения' }).count(), 0);
    pass('real SW controls navigation; private API never cached; offline fallback and reconnection work');
    await context.close();
  }
  {
    const { context, page } = await newPage();
    await visit(page);
    await page.reload();
    const checkout = await context.newPage();
    await checkout.goto(origin + '/checkout.html');
    await checkout.evaluate(() => {
      const input = document.createElement('input');
      input.dataset.unsaved = ''; input.value = 'unsaved checkout'; document.body.append(input);
      window.__checkoutMarker = true;
    });
    testWorkerVersion = '11a-test-update';
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration.update();
      if (registration.waiting) return;
      await new Promise((resolve) => {
        const worker = registration.installing;
        if (!worker) throw new Error('No update worker');
        worker.addEventListener('statechange', () => { if (worker.state === 'installed') resolve(); });
      });
    });
    assert.equal(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), true);
    assert.equal(await page.locator('[data-pwa-update]').count(), 1);
    assert.equal(await checkout.locator('[data-unsaved]').inputValue(), 'unsaved checkout');
    assert.equal(await checkout.evaluate(() => window.__checkoutMarker), true);
    if (screenshotDir) await page.screenshot({ animations: 'disabled', path: `${screenshotDir}/update-waiting.png` });
    await page.close();
    assert.equal(await checkout.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), true);
    await checkout.close();
    const fresh = await context.newPage();
    await fresh.goto(origin);
    await fresh.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    assert.equal(await fresh.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting)), false);
    assert.deepEqual(await fresh.evaluate(() => caches.keys()), ['sibdel-pwa-11a-test-update']);
    pass('update waits with unsaved checkout in another tab; activates and cleans old cache after all tabs close');
    await context.close();
  }
  {
    const { context, page } = await newPage({ ...android, isMobile: false, viewport: { width: 1920, height: 1080 } });
    await visit(page);
    await emitPrompt(page);
    await page.clock.runFor(10_300);
    const box = await page.locator('.pwa-panel--install').boundingBox();
    assert.ok(box.width <= 560);
    assert.ok(Math.abs(box.x + box.width / 2 - 960) <= 1);
    await page.locator('[data-pwa-install]').focus();
    assert.equal(await page.locator('[data-pwa-install]').evaluate((el) => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.pwa-panel--install').count(), 0);
    pass('1920px panel stays centered at max width; keyboard focus and Escape work');
    await context.close();
  }
  console.log(`Browser checks passed: ${checks}`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
