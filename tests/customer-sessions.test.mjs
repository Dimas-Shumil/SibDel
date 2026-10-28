import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { generateOpaqueToken, hashOpaqueToken } from '../utils/tokens.js';

const DAY = 86_400_000;
const config = { sessionTtlMs: 30 * DAY, customerSessionTtlMs: 90 * DAY,
  sessionTouchIntervalMs: 900_000, maxSessionsPerUser: 10 };

async function fixture(role = 'CUSTOMER') {
  let clock = Date.parse('2026-10-28T10:00:00Z');
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const records = [];
  const user = { id: 1, role, isActive: true };
  let beforeUpdate = null;
  const userSession = {
    findUnique: async ({ where }) => {
      const item = records.find((s) => s.tokenHash === where.tokenHash);
      return item ? { ...item, user: { ...user } } : null;
    },
    findMany: async () => [],
    create: async ({ data }) => { records.push({ ...data, id: records.length + 1, createdAt: new Date(clock) }); },
    deleteMany: async ({ where }) => {
      const remove = records.filter((s) => (where.tokenHash ? s.tokenHash === where.tokenHash :
        where.id ? s.id === where.id : s.userId === where.userId)
        && (!where.expiresAt?.lte || s.expiresAt <= where.expiresAt.lte));
      for (const row of remove) records.splice(records.indexOf(row), 1);
      return { count: remove.length };
    },
    updateMany: async ({ where, data }) => {
      if (beforeUpdate) { const callback = beforeUpdate; beforeUpdate = null; await callback(); }
      const row = records.find((s) => s.id === where.id && s.tokenHash === where.tokenHash
        && s.expiresAt > where.expiresAt.gt && +s.lastUsedAt === +where.lastUsedAt
        && user.isActive === where.user.isActive && user.role === where.user.role);
      if (!row) return { count: 0 };
      Object.assign(row, data); return { count: 1 };
    },
  };
  const prisma = { userSession, user: { findUnique: async () => ({ ...user }) } };
  prisma.$transaction = async (fn) => fn(prisma);
  const context = createContext({ Date: ClockDate });
  const dependencies = {
    'argon2': { argon2id: 2 }, '../lib/prisma.js': { prisma },
    '../config/auth.js': { authConfig: config },
    '../utils/tokens.js': { generateOpaqueToken, hashOpaqueToken },
  };
  const module = new SourceTextModule(await readFile(new URL('../services/auth.service.js', import.meta.url), 'utf8'), { context });
  await module.link((name) => {
    assert.ok(dependencies[name], `unexpected dependency ${name}`);
    return new SyntheticModule(Object.keys(dependencies[name]), function () {
      for (const [key, value] of Object.entries(dependencies[name])) this.setExport(key, value);
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, records, user, advance: (ms) => { clock += ms; }, now: () => clock,
    race: (fn) => { beforeUpdate = fn; } };
}

test('customer creation stores a hash, fresh random tokens and a 90-day expiry', async () => {
  const f = await fixture();
  const a = await f.api.createSession({ userId: 1 });
  const b = await f.api.createSession({ userId: 1 });
  assert.notEqual(a.token, b.token);
  assert.equal(+a.expiresAt - f.now(), 90 * DAY);
  assert.equal(f.records[0].tokenHash, hashOpaqueToken(a.token));
  assert.equal(JSON.stringify(f.records).includes(a.token), false);
  f.user.isActive = false;
  await assert.rejects(f.api.createSession({ userId: 1 }), { code: 'UNAUTHORIZED' });
});

test('customer remains signed in after weeks and renewal supports another 90 idle days', async () => {
  const f = await fixture();
  const a = await f.api.createSession({ userId: 1 });
  f.advance(40 * DAY);
  const auth = await f.api.resolveSessionToken(a.token, { audience: 'customer' });
  assert.equal(auth.user.id, 1);
  assert.equal(+auth.session.expiresAt - f.now(), 90 * DAY);
  f.advance(89 * DAY);
  assert.ok(await f.api.resolveSessionToken(a.token));
  f.advance(91 * DAY);
  assert.equal(await f.api.resolveSessionToken(a.token), null);
  assert.equal(f.records.length, 0);
});

test('valid legacy sessions upgrade; expired legacy sessions never revive', async () => {
  const f = await fixture();
  const a = await f.api.createSession({ userId: 1 });
  f.records[0].expiresAt = new Date(f.now() + 2 * DAY);
  const auth = await f.api.resolveSessionToken(a.token);
  assert.equal(+auth.session.expiresAt - f.now(), 90 * DAY);
  f.records[0].expiresAt = new Date(f.now() - 1);
  assert.equal(await f.api.resolveSessionToken(a.token), null);
});

for (const role of ['OWNER', 'STAFF']) test(`${role} uses the existing 30-day fixed policy and cannot authenticate in the public contour`, async () => {
  const f = await fixture(role);
  const a = await f.api.createSession({ userId: 1 });
  assert.equal(+a.expiresAt - f.now(), 30 * DAY);
  assert.equal(await f.api.resolveSessionToken(a.token, { audience: 'customer' }), null);
  f.advance(10 * DAY);
  const auth = await f.api.resolveSessionToken(a.token, { audience: 'admin' });
  assert.equal(+auth.session.expiresAt, +a.expiresAt);
  f.advance(21 * DAY);
  assert.equal(await f.api.resolveSessionToken(a.token, { audience: 'admin' }), null);
});

test('customer token cannot be used in the administrative contour', async () => {
  const f = await fixture();
  const a = await f.api.createSession({ userId: 1 });
  assert.equal(await f.api.resolveSessionToken(a.token, { audience: 'admin' }), null);
});

test('logout and revoke-all are durable; inactive account is rejected', async () => {
  const f = await fixture();
  const a = await f.api.createSession({ userId: 1 });
  await f.api.revokeSessionToken(a.token);
  assert.equal(await f.api.resolveSessionToken(a.token), null);
  const b = await f.api.createSession({ userId: 1 });
  await f.api.revokeAllUserSessions(1);
  assert.equal(await f.api.resolveSessionToken(b.token), null);
  const c = await f.api.createSession({ userId: 1 });
  f.user.isActive = false;
  assert.equal(await f.api.resolveSessionToken(c.token), null);
  f.user.isActive = true;
  assert.equal(await f.api.resolveSessionToken(c.token), null);
});

test('renewal cannot recreate a session deleted by logout/password reset', async () => {
  const f = await fixture();
  const a = await f.api.createSession({ userId: 1 });
  f.advance(DAY);
  f.race(async () => f.api.revokeAllUserSessions(1));
  assert.equal(await f.api.resolveSessionToken(a.token), null);
  assert.equal(f.records.length, 0);
});

test('parallel renewals accept the winning expiry without extending an admin session', async () => {
  const f = await fixture();
  const a = await f.api.createSession({ userId: 1 });
  f.advance(DAY);
  f.race(() => {
    f.records[0].lastUsedAt = new Date(f.now());
    f.records[0].expiresAt = new Date(f.now() + 90 * DAY);
  });
  const auth = await f.api.resolveSessionToken(a.token);
  assert.equal(+auth.session.expiresAt - f.now(), 90 * DAY);
});

test('renewal throttles writes and rejects malformed/unknown tokens', async () => {
  const f = await fixture();
  for (const token of [null, '', 'x'.repeat(257), 'unknown']) assert.equal(await f.api.resolveSessionToken(token), null);
  const a = await f.api.createSession({ userId: 1 });
  const last = +f.records[0].lastUsedAt;
  f.advance(5 * 60_000);
  await f.api.resolveSessionToken(a.token);
  assert.equal(+f.records[0].lastUsedAt, last);
  f.advance(11 * 60_000);
  await f.api.resolveSessionToken(a.token);
  assert.equal(+f.records[0].lastUsedAt, f.now());
});
