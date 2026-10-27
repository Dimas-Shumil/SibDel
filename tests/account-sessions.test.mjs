import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';

function fixture() {
  const records = [
    { id: 11, userId: 1, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/125.0 Safari/537.36', lastUsedAt: new Date('2026-10-27T11:00:00Z'), createdAt: new Date('2026-10-26T11:00:00Z'), expiresAt: new Date('2099-01-01') },
    { id: 12, userId: 1, userAgent: 'Mozilla/5.0 (iPhone) Version/17.0 Mobile Safari/604.1', lastUsedAt: new Date('2026-10-25T11:00:00Z'), createdAt: new Date('2026-10-25T11:00:00Z'), expiresAt: new Date('2099-01-01') },
    { id: 13, userId: 2, userAgent: 'Other user', lastUsedAt: new Date('2026-10-25T11:00:00Z'), createdAt: new Date('2026-10-25T11:00:00Z'), expiresAt: new Date('2099-01-01') },
    { id: 14, userId: 1, userAgent: 'expired', lastUsedAt: new Date('2026-10-25T11:00:00Z'), createdAt: new Date('2026-10-25T11:00:00Z'), expiresAt: new Date('2020-01-01') },
  ];
  const calls = [];
  const prisma = {
    userSession: {
      findMany: async ({ where }) => records.filter((r) => r.userId === where.userId && r.expiresAt > where.expiresAt.gt),
      deleteMany: async ({ where }) => {
        calls.push(where);
        const deleted = records.filter((r) => r.userId === where.userId && (where.id?.not !== undefined ? r.id !== where.id.not : r.id === where.id));
        for (const item of deleted) records.splice(records.indexOf(item), 1);
        return { count: deleted.length };
      },
    },
  };
  return { records, calls, prisma };
}

async function loadService(prisma) {
  const code = await readFile(new URL('../services/account-session.service.js', import.meta.url), 'utf8');
  const mod = new SourceTextModule(code);
  await mod.link((name) => {
    assert.equal(name, '../lib/prisma.js');
    return new SyntheticModule(['prisma'], function () { this.setExport('prisma', prisma); });
  });
  await mod.evaluate();
  return mod.namespace;
}

test('sessions list excludes other users and expired sessions; current is marked without exposing tokens or UA', async () => {
  const f = fixture();
  const service = await loadService(f.prisma);
  const sessions = await service.listAccountSessions({ userId: 1, currentSessionId: 11 });
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions.map((s) => s.id), [11, 12]);
  assert.deepEqual(sessions.map((s) => s.current), [true, false]);
  assert.equal(sessions[0].device, 'Chrome · Windows');
  assert.equal(sessions[1].device, 'Safari · iPhone');
  assert.equal('userAgent' in sessions[0], false);
  assert.equal('tokenHash' in sessions[0], false);
  assert.equal(service.describeSessionDevice('<script>alert(1)</script>'), 'Браузер · Устройство');
});

test('cannot revoke own current session or another user session', async () => {
  const f = fixture();
  const service = await loadService(f.prisma);
  await assert.rejects(service.revokeAccountSession({ userId: 1, currentSessionId: 11, sessionId: 11 }), { code: 'CURRENT_SESSION', statusCode: 409 });
  assert.equal(f.calls.length, 0);
  await assert.rejects(service.revokeAccountSession({ userId: 1, currentSessionId: 11, sessionId: 13 }), { code: 'SESSION_NOT_FOUND', statusCode: 404 });
  assert.ok(f.records.some((item) => item.id === 13));
  await service.revokeAccountSession({ userId: 1, currentSessionId: 11, sessionId: 12 });
  assert.equal(f.records.some((item) => item.id === 12), false);
  assert.ok(f.records.some((item) => item.id === 11));
});

test('revoke all other sessions keeps current and different users', async () => {
  const f = fixture();
  const service = await loadService(f.prisma);
  assert.equal(await service.revokeOtherAccountSessions({ userId: 1, currentSessionId: 11 }), 2);
  assert.deepEqual(f.records.map((item) => item.id), [11, 13]);
});
