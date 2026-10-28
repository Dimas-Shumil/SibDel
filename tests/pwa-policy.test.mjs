import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTALL_DELAY_MS, VISIT_IDLE_MS, nextVisit, installEligible,
  canShowIosHelp, excludedPath, isStandalone } from '../site/js/pwa-policy.js';

test('promotion waits ten seconds, requires support and hides in installed/excluded states', () => {
  const base = { standalone: false, installed: false, handled: false,
    elapsed: INSTALL_DELAY_MS, supported: true, visible: true, excluded: false };
  assert.equal(installEligible({ ...base, elapsed: 9999 }), false);
  assert.equal(installEligible(base), true);
  for (const option of ['standalone', 'installed', 'handled', 'excluded']) assert.equal(installEligible({ ...base, [option]: true }), false);
  for (const option of ['visible', 'supported']) assert.equal(installEligible({ ...base, [option]: false }), false);
});

test('Later, close or swipe persist for internal navigation; a new visit resets the decision', () => {
  const first = nextVisit(null, 100);
  assert.equal(first.handled, false);
  const next = nextVisit({ ...first, handled: true }, 10100);
  assert.equal(next.handled, true);
  assert.equal(next.startedAt, 100);
  assert.equal(nextVisit(next, next.lastSeen + VISIT_IDLE_MS).handled, false);
  assert.equal(nextVisit(null, 90000).handled, false);
  assert.equal(nextVisit({ lastSeen: 20, startedAt: 'bad' }, 40).startedAt, 40);
});

test('Safari iPhone/iPad help excludes embedded and unsupported browser menus', () => {
  const safari = 'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
  assert.equal(canShowIosHelp({ userAgent: safari }), true);
  assert.equal(canShowIosHelp({ userAgent: safari.replace('iPhone', 'Macintosh'), maxTouchPoints: 5 }), true);
  for (const ua of ['Android Chrome/150', 'iPhone AppleWebKit/605.1 Mobile/15', safari + ' CriOS/140', safari + ' FxiOS/130']) assert.equal(canShowIosHelp({ userAgent: ua }), false);
});

test('checkout/admin/auth routes and aliases never show a promotion', () => {
  for (const url of ['/admin', '/admin/login', '/checkout.html', '/checkout', '/login.html', '/reset-password.html']) assert.equal(excludedPath(url), true);
  for (const url of ['/', '/catalog.html', '/account/orders']) assert.equal(excludedPath(url), false);
  assert.equal(isStandalone({ navigator: { standalone: true }, matchMedia: () => ({ matches: false }) }), true);
  assert.equal(isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) }), false);
});
