import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';

async function load(file, deps) {
  const module = new SourceTextModule(await readFile(new URL(file, import.meta.url), 'utf8'));
  await module.link((name) => {
    assert.ok(deps[name], name);
    return new SyntheticModule(Object.keys(deps[name]), function () {
      for (const [key, value] of Object.entries(deps[name])) this.setExport(key, value);
    });
  });
  await module.evaluate();
  return module.namespace;
}

async function cookieConfig(mode) {
  return load('../config/auth.js', { './env.js': { env: { NODE_ENV: mode,
    SESSION_COOKIE_NAME: 'sibdel_session', SESSION_TTL_DAYS: 30, CUSTOMER_SESSION_TTL_DAYS: 90 } } });
}

test('production customer/admin cookies retain HttpOnly/Secure/SameSite; customer expiry follows DB', async () => {
  const config = await cookieConfig('production');
  const customer = config.getSessionCookieOptions();
  const admin = config.getAdminSessionCookieOptions();
  for (const options of [customer, admin]) {
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, '/');
  }
  assert.equal(customer.maxAge, 90 * 86_400_000);
  assert.equal(admin.maxAge, 30 * 86_400_000);
  const expiry = new Date(Date.now() + 3600_000);
  assert.ok(config.getSessionCookieOptions(expiry).maxAge <= 3600_000);
  assert.equal(config.getSessionCookieOptions(new Date(0)).maxAge, 0);
  assert.equal('maxAge' in config.getClearSessionCookieOptions(), false);
  assert.equal('maxAge' in config.getClearAdminSessionCookieOptions(), false);
  assert.equal((await cookieConfig('development')).getSessionCookieOptions().secure, false);
});

test('public middleware reissues only validated customer cookie and propagates server errors', async () => {
  const config = await cookieConfig('production');
  const expiry = new Date(Date.now() + 90 * 86_400_000);
  let result = { user: { id: 7, role: 'CUSTOMER' }, session: { expiresAt: expiry } };
  let failure;
  const middleware = await load('../middleware/auth.js', {
    '../config/auth.js': config,
    '../services/auth.service.js': { resolveSessionToken: async (token, options) => {
      assert.equal(token, 'opaque-cookie'); assert.equal(options.audience, 'customer');
      if (failure) throw failure;
      return result;
    } },
  });
  const cookies = [], cleared = [], headers = [];
  const res = { cookie: (...args) => cookies.push(args), clearCookie: (...args) => cleared.push(args),
    setHeader: (...args) => headers.push(args) };
  const req = { cookies: { sibdel_session: 'opaque-cookie' } };
  let nextError;
  await middleware.authMiddleware(req, res, (error) => { nextError = error; });
  assert.equal(nextError, undefined);
  assert.equal(req.user.id, 7);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0][1], 'opaque-cookie');
  assert.equal(cookies[0][2].httpOnly, true);
  assert.ok(cookies[0][2].maxAge <= 90 * 86_400_000);
  assert.equal(headers[0][1], 'no-store');
  result = null;
  await middleware.authMiddleware(req, res, () => {});
  assert.equal(req.user, null);
  assert.equal(cleared.length, 1);
  assert.equal(cookies.length, 1);
  failure = Error('DB unavailable');
  await middleware.authMiddleware(req, res, (error) => { nextError = error; });
  assert.equal(nextError, failure);
});

test('admin context resolves only admin cookie and does not refresh its lifetime', async () => {
  const config = await cookieConfig('production');
  const api = await load('../middleware/admin-auth.js', {
    '../config/auth.js': config,
    '../services/auth.service.js': { resolveSessionToken: async (token, options) => {
      assert.equal(token, 'admin-token'); assert.equal(options.audience, 'admin');
      return { user: { id: 1, role: 'OWNER' } };
    } },
    './roles.js': { requireRoles: () => () => {} },
  });
  const req = { cookies: { sibdel_session: 'public-token', sibdel_session_admin: 'admin-token' }, user: { role: 'CUSTOMER' } };
  const res = { cookie: () => { assert.fail('must not refresh admin cookie'); } };
  await api.adminSessionContext(req, res, (error) => { assert.equal(error, undefined); });
  assert.equal(req.user.role, 'OWNER');
});
