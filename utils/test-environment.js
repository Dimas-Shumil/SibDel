import { createHash } from "node:crypto";

function databaseIdentity(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    host: ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ? "loopback" : url.hostname,
    port: url.port || "5432",
    database: decodeURIComponent(url.pathname.slice(1)),
    user: decodeURIComponent(url.username),
    schema: url.searchParams.get("schema") || "public",
  };
}

export function testDatabaseFingerprint(databaseUrl) {
  return createHash("sha256").update(JSON.stringify(databaseIdentity(databaseUrl))).digest("hex");
}

export function assertTestConfiguration(env, { http = false } = {}) {
  const database = databaseIdentity(env.DATABASE_URL);
  if (env.NODE_ENV !== "test" || !/^sibdel_[a-z0-9_]*test[a-z0-9_]*$/i.test(database.database) || database.host !== "loopback") {
    throw new Error("SMOKE_SAFETY: required NODE_ENV=test and a local sibdel_*test* database; primary database is forbidden.");
  }
  if (http) {
    const url = new URL(env.APP_URL);
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.port !== "3002" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || Number(env.PORT) !== 3002) {
      throw new Error("SMOKE_SAFETY: HTTP smoke tests require local APP_URL on port 3002 and PORT=3002.");
    }
  }
  return database;
}

export async function assertTestEnvironment(env, prisma, { http = false, request = fetch } = {}) {
  const expected = assertTestConfiguration(env, { http });
  if (http) {
    const response = await request(new URL("/api/health", env.APP_URL), {
      redirect: "error", signal: AbortSignal.timeout(5000),
    });
    const health = await response.json();
    if (!response.ok || health?.ok !== true || health?.testEnvironment?.databaseFingerprint !== testDatabaseFingerprint(env.DATABASE_URL)) {
      throw new Error("SMOKE_SAFETY: server must run in test mode against the same test database.");
    }
  }
  try {
    const rows = await prisma.$queryRaw`SELECT current_database() AS name`;
    if (rows[0]?.name !== expected.database) throw new Error("SMOKE_SAFETY: actual database does not match configured test database.");
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}
