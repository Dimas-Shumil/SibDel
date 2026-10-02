import { connectDatabase, disconnectDatabase } from "../lib/prisma.js";
import { generateDueSubscriptionOrders } from "../services/subscription.service.js";

const rawLimit = Number(process.argv[2] || 100);
const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;

try {
  await connectDatabase();
  const result = await generateDueSubscriptionOrders({ limit, source: "SYSTEM" });
  console.log(JSON.stringify({ ok: result.failed === 0, ...result }, null, 2));
  if (result.failed > 0) process.exitCode = 2;
} catch (error) {
  console.error(error?.stack || error?.message || error);
  process.exitCode = 1;
} finally {
  try { await disconnectDatabase(); } catch {}
}
