import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { EventEmitter } from 'node:events';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { safeEndpoint } from '../utils/push-policy.js';

test('transport creates encrypted VAPID request with bounded TTL/deadline, no redirects, and no response-body leakage', async () => {
  const vapid = webpush.generateVAPIDKeys(); const key = createECDH('prime256v1'); key.generateKeys();
  const device = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-only', p256dh: key.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
  let status = 201, calls = 0;
  const https = { request: (endpoint, options, response) => {
    calls++; assert.equal(endpoint, device.endpoint); assert.equal(options.method, 'POST');
    assert.equal(options.headers.TTL, 300); assert.ok(options.headers.Authorization);
    const req = new EventEmitter(); req.destroy = () => req.emit('error', Error('private URL'));
    req.end = (bytes) => { assert.ok(Buffer.isBuffer(bytes)); assert.equal(bytes.includes(Buffer.from('private test text')), false); queueMicrotask(() => response({ statusCode: status, resume() {} })); };
    return req;
  } };
  const deps = { 'node:https': { default: https }, 'web-push': { default: webpush }, '../utils/push-policy.js': { safeEndpoint } };
  const mod = new SourceTextModule(await readFile(new URL('../services/push-transport.js', import.meta.url), 'utf8'));
  await mod.link((name) => new SyntheticModule(Object.keys(deps[name]), function () { for (const [key,value] of Object.entries(deps[name])) this.setExport(key,value); })); await mod.evaluate();
  const send = mod.namespace.createPushSender({ subject: 'mailto:unit@example.invalid', publicKey: vapid.publicKey, privateKey: vapid.privateKey });
  const payload = { id: 1, title: 'Тест', body: 'private test text', url: '/', openPath: '/api/push/open' };
  await send(device,payload); assert.equal(calls,1);
  status=410; await assert.rejects(send(device,payload), { statusCode: 410 }); assert.equal(calls,2);
  await assert.rejects(send({...device,endpoint:'https://127.0.0.1/'},payload), /Push request invalid/); assert.equal(calls,2);
});
