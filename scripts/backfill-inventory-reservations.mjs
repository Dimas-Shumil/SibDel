import {
  connectDatabase,
  disconnectDatabase,
  prisma,
} from "../lib/prisma.js";
import { reserveInventoryForOrder } from "../services/inventory.service.js";

const ACTIVE_ORDER_STATUSES = [
  "NEW",
  "CONFIRMED",
  "ASSEMBLING",
  "READY",
  "DELIVERING",
];

let failures = 0;

try {
  await connectDatabase();

  const orders = await prisma.order.findMany({
    where: {
      status: { in: ACTIVE_ORDER_STATUSES },
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      number: true,
    },
  });

  for (const order of orders) {
    try {
      await prisma.$transaction(
        async (transaction) => {
          await reserveInventoryForOrder(transaction, order.id);
        },
        { isolationLevel: "Serializable" },
      );
      console.log(`OK: ${order.number}`);
    } catch (error) {
      failures += 1;
      console.error(`FAIL: ${order.number} — ${error.code || "ERROR"}: ${error.message}`);
    }
  }

  if (failures > 0) {
    console.error(`Backfill finished with ${failures} failed order(s).`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: inventory reservations synchronized for ${orders.length} active order(s).`);
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
