import test from "node:test";
import assert from "node:assert/strict";
import { assertTestConfiguration, assertTestEnvironment, testDatabaseFingerprint } from "../utils/test-environment.js";
const env = { NODE_ENV: "test", DATABASE_URL: "postgresql://tester:secret@localhost:5432/sibdel_delivery_test?schema=public", APP_URL: "http://localhost:3002", PORT: 3002 };

test("production and primary database are blocked", () => {
  for (const config of [{ ...env, NODE_ENV: "production" }, { ...env, NODE_ENV: "development" }, { ...env, DATABASE_URL: env.DATABASE_URL.replace("sibdel_delivery_test", "siberian_delicacies") }, { ...env, DATABASE_URL: env.DATABASE_URL.replace("localhost", "db.example.com") }]) assert.throws(() => assertTestConfiguration(config), /SMOKE_SAFETY/);
});
test("HTTP smoke cannot target production port or remote host", () => {
  for (const APP_URL of ["http://localhost:3001", "https://example.com:3002", "http://localhost:3002/path", "http://user:pass@localhost:3002"]) assert.throws(() => assertTestConfiguration({ ...env, APP_URL }, { http: true }), /SMOKE_SAFETY/);
});
test("fingerprint ignores password rotation and normalizes loopback aliases", () => {
  assert.equal(testDatabaseFingerprint(env.DATABASE_URL), testDatabaseFingerprint(env.DATABASE_URL.replace("secret", "changed").replace("localhost", "127.0.0.1")));
});
test("wrong server database prevents any direct database query", async () => {
  await assert.rejects(assertTestEnvironment(env, { $queryRaw() { assert.fail("must not query"); } }, { http: true, request: async () => ({ ok: true, json: async () => ({ ok: true, testEnvironment: { databaseFingerprint: "wrong" } }) }) }), /SMOKE_SAFETY/);
});
test("actual database name is checked before mutations", async () => {
  let disconnected = false;
  await assert.rejects(assertTestEnvironment(env, { $queryRaw: async () => [{ name: "siberian_delicacies" }], $disconnect: async () => { disconnected = true; } }), /SMOKE_SAFETY/);
  assert.equal(disconnected, true);
});
test("matching test server and actual database are accepted", async () => {
  await assertTestEnvironment(env, { $queryRaw: async () => [{ name: "sibdel_delivery_test" }] }, { http: true, request: async () => ({ ok: true, json: async () => ({ ok: true, testEnvironment: { databaseFingerprint: testDatabaseFingerprint(env.DATABASE_URL) } }) }) });
});
