import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { SourceTextModule, SyntheticModule } from "node:vm";

const OWNER = { actorId: 10, ipAddress: "127.0.0.1", userAgent: "Browser" };

function fixture() {
  const users = [
    { id: 1, email: "staff@example.com", firstName: "Анна", lastName: "А", role: "STAFF", isActive: true },
    { id: 2, email: "owner@example.com", firstName: "Владелец", lastName: null, role: "OWNER", isActive: true },
    { id: 3, email: "customer@example.com", firstName: "Покупатель", lastName: null, role: "CUSTOMER", isActive: true },
  ];
  const sessions = [{ id: 1, userId: 1 }, { id: 2, userId: 2 }];
  const resetTokens = [{ id: 1, userId: 1 }, { id: 2, userId: 2 }];
  const audits = [];
  function selectSafe(user) {
    if (!user) return null;
    const { passwordHash: _secret, ...safe } = user;
    return { ...safe };
  }
  const tx = {
    user: {
      create: async ({ data }) => {
        if (users.some((user) => user.email === data.email)) throw Object.assign(Error("duplicate"), { code: "P2002" });
        const user = { id: users.length + 1, ...data };
        users.push(user);
        return selectSafe(user);
      },
      updateMany: async ({ where, data }) => {
        const user = users.find((item) => item.id === where.id && item.role === where.role);
        if (!user) return { count: 0 };
        if (data.email && users.some((item) => item.email === data.email && item.id !== user.id)) throw Object.assign(Error("duplicate"), { code: "P2002" });
        Object.assign(user, data);
        return { count: 1 };
      },
      findUnique: async ({ where }) => selectSafe(users.find((item) => item.id === where.id)),
    },
    adminActivity: { create: async ({ data }) => { audits.push(data); return data; } },
    userSession: { deleteMany: async ({ where }) => {
      for (const item of [...sessions]) if (item.userId === where.userId) sessions.splice(sessions.indexOf(item), 1);
      return { count: 1 };
    } },
    passwordResetToken: { deleteMany: async ({ where }) => {
      for (const item of [...resetTokens]) if (item.userId === where.userId) resetTokens.splice(resetTokens.indexOf(item), 1);
      return { count: 1 };
    } },
  };
  const prisma = {
    $transaction: async (operation) => operation(tx),
    user: {
      findMany: async ({ where }) => users.filter((item) => item.role === where.role && (where.isActive === undefined || item.isActive === where.isActive)).map(selectSafe),
    },
    adminActivity: {
      groupBy: async () => [{ actorId: 1, _max: { createdAt: new Date("2026-10-27") } }],
      findMany: async () => [],
    },
  };
  return { prisma, users, sessions, resetTokens, audits };
}

async function loadService(f) {
  const code = await readFile(new URL("../services/admin-staff.service.js", import.meta.url), "utf8");
  const mod = new SourceTextModule(code);
  await mod.link((name) => {
    if (name === "../lib/prisma.js") {
      return new SyntheticModule(["prisma"], function () { this.setExport("prisma", f.prisma); });
    }
    assert.equal(name, "./auth.service.js");
    return new SyntheticModule(["hashPassword"], function () {
      this.setExport("hashPassword", async (password) => `hashed:${password}`);
    });
  });
  await mod.evaluate();
  return mod.namespace;
}

test("staff list excludes OWNER/CUSTOMER, secrets and includes last login", async () => {
  const f = fixture();
  const api = await loadService(f);
  const list = await api.listAdminStaff();
  assert.equal(list.length, 1);
  assert.equal(list[0].email, "staff@example.com");
  assert.equal(list[0].lastLoginAt.toISOString(), "2026-10-27T00:00:00.000Z");
  assert.equal("passwordHash" in list[0], false);
});

test("create STAFF only, with password hash and audit; duplicate email never escalates CUSTOMER", async () => {
  const f = fixture();
  const api = await loadService(f);
  const employee = await api.createAdminStaff({ email: "new@example.com", firstName: "Ирина", lastName: "", password: "Test123456!12" }, OWNER);
  assert.equal(employee.role, "STAFF");
  assert.equal("passwordHash" in employee, false);
  assert.equal(f.users.at(-1).passwordHash, "hashed:Test123456!12");
  assert.equal(f.audits.at(-1).action, "STAFF_CREATED");
  assert.equal(JSON.stringify(f.audits).includes("Test123456!12"), false);
  await assert.rejects(api.createAdminStaff({ email: "customer@example.com", firstName: "Ирина", password: "Test123456!12" }, OWNER), { code: "EMAIL_TAKEN", statusCode: 409 });
  assert.equal(f.users[2].role, "CUSTOMER");
});

test("edit, block and reset cannot modify OWNER or CUSTOMER", async () => {
  const f = fixture();
  const api = await loadService(f);
  for (const id of [2, 3, 99]) {
    await assert.rejects(api.editAdminStaff(id, { firstName: "Hijack" }, OWNER), { code: "STAFF_NOT_FOUND", statusCode: 404 });
    await assert.rejects(api.setAdminStaffActive(id, false, OWNER), { code: "STAFF_NOT_FOUND" });
    await assert.rejects(api.resetAdminStaffPassword(id, "Test123456!12", OWNER), { code: "STAFF_NOT_FOUND" });
  }
  assert.equal(f.users[1].firstName, "Владелец");
  assert.equal(f.users[2].isActive, true);
  assert.ok(f.sessions.some((session) => session.userId === 2));
});

test("disable staff revokes only that employee sessions and reset tokens", async () => {
  const f = fixture();
  const api = await loadService(f);
  const employee = await api.setAdminStaffActive(1, false, OWNER);
  assert.equal(employee.isActive, false);
  assert.deepEqual(f.sessions.map((item) => item.userId), [2]);
  assert.deepEqual(f.resetTokens.map((item) => item.userId), [2]);
  assert.equal(f.audits.at(-1).action, "STAFF_DISABLED");
  await api.setAdminStaffActive(1, true, OWNER);
  assert.equal(f.users[0].isActive, true);
  assert.equal(f.audits.at(-1).action, "STAFF_ENABLED");
});

test("password reset revokes sessions and never records or returns a password", async () => {
  const f = fixture();
  const api = await loadService(f);
  const result = await api.resetAdminStaffPassword(1, "Test123456!12", OWNER);
  assert.deepEqual(result, { sessionsRevoked: true });
  assert.equal(f.users[0].passwordHash, "hashed:Test123456!12");
  assert.deepEqual(f.sessions.map((session) => session.userId), [2]);
  assert.equal(f.audits.at(-1).action, "STAFF_PASSWORD_RESET");
  assert.equal(JSON.stringify(f.audits).includes("Test123456!12"), false);
});

test("role middleware blocks STAFF and CUSTOMER from OWNER-only endpoints", async () => {
  const code = await readFile(new URL("../middleware/roles.js", import.meta.url), "utf8");
  const mod = new SourceTextModule(code);
  await mod.link(() => { throw Error("unexpected dependency"); });
  await mod.evaluate();
  const middleware = mod.namespace.requireRoles("OWNER");
  const invoke = (user) => new Promise((resolve) => middleware({ auth: user ? { user } : null }, {}, resolve));
  assert.equal(await invoke({ id: 10, role: "OWNER" }), undefined);
  for (const role of ["STAFF", "CUSTOMER"]) {
    const error = await invoke({ id: 1, role });
    assert.equal(error.code, "FORBIDDEN");
    assert.equal(error.statusCode, 403);
  }
  const anonymous = await invoke(null);
  assert.equal(anonymous.code, "UNAUTHORIZED");
  assert.equal(anonymous.statusCode, 401);
});
