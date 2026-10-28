import test from 'node:test';
import assert from 'node:assert/strict';
import { safeEndpoint, safePushUrl, safePushImage, deviceEligible, classifyPushFailure, endpointHash } from '../utils/push-policy.js';

test('push endpoints allow only known HTTPS push services, blocking SSRF, credentials, ports and suffix tricks', () => {
  for (const endpoint of ['https://fcm.googleapis.com/fcm/send/a','https://web.push.apple.com/a','https://updates.push.services.mozilla.com/a','https://wns2-xx.notify.windows.com/a']) assert.equal(safeEndpoint(endpoint), endpoint);
  for (const endpoint of ['http://fcm.googleapis.com/a','https://127.0.0.1/a','https://localhost/a','https://fcm.googleapis.com.evil.example/a','https://evil.example/a','https://x@fcm.googleapis.com/a','https://fcm.googleapis.com:123/a','https://fcm.googleapis.com/a#fragment']) assert.throws(() => safeEndpoint(endpoint), { code: 'PUSH_ENDPOINT' });
  assert.equal(endpointHash('a').length, 64);
});

test('deep links and images reject external/auth/admin/open-redirect/script inputs', () => {
  for (const url of ['/', '/account/order?id=1','/product.html?slug=sausage','/catalog.html?category=fish']) assert.equal(safePushUrl(url), url);
  for (const url of ['//evil.example','https://evil.example','javascript:alert(1)','/admin','/reset-password.html?token=a','/catalog.html?redirect=https://evil.example','/catalog.html\\x','/%2f%2fevil.example']) assert.throws(() => safePushUrl(url), { code: 'PUSH_URL' });
  assert.equal(safePushImage('/uploads/products/a.webp'), '/uploads/products/a.webp');
  assert.equal(safePushImage(null), null);
  for (const image of ['https://evil.example/a.png','/uploads/products/../../a.png','/uploads/products/a.svg','/site/images/x.png?x=1']) assert.throws(() => safePushImage(image), { code: 'PUSH_IMAGE' });
});

test('send eligibility rechecks recipient, session, activity, per-category settings and marketing consent', () => {
  const device = { userId: 1, session: { userId: 1, expiresAt: new Date('2099-01-01') }, user: { isActive: true, role: 'CUSTOMER', pushPreference: { marketing: false, orders: true, subscriptions: false } } };
  const event = { userId: 1, category: 'ORDER' };
  assert.equal(deviceEligible(device,event), true);
  assert.equal(deviceEligible(device,{...event,category:'MARKETING'}), false);
  assert.equal(deviceEligible(device,{...event,category:'SUBSCRIPTION'}), false);
  assert.equal(deviceEligible({...device,disabledAt:new Date()},event), false);
  assert.equal(deviceEligible({...device,session:{...device.session,expiresAt:new Date(0)}},event), false);
  assert.equal(deviceEligible({...device,userId:2},event), false);
  assert.equal(deviceEligible({...device,user:{...device.user,isActive:false}},event), false);
  assert.equal(deviceEligible(null,event), false);
});

test('ambiguous delivery is UNKNOWN and never classified as safely retryable', () => {
  assert.equal(classifyPushFailure({statusCode:410}).remove, true);
  assert.equal(classifyPushFailure({statusCode:429}).status, 'FAILED');
  assert.equal(classifyPushFailure({statusCode:503}).status, 'UNKNOWN');
  assert.equal(classifyPushFailure(Error('private endpoint')).errorCode, 'NETWORK_UNKNOWN');
});
