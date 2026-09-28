import {
  connectDatabase,
  disconnectDatabase,
  prisma,
} from "../lib/prisma.js";

function number(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

try {
  await connectDatabase();

  const products = await prisma.product.findMany({
    orderBy: { id: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      stockQuantity: true,
      reservedQuantity: true,
      inventoryReservations: {
        where: { status: "ACTIVE" },
        select: { quantity: true },
      },
    },
  });

  const activeOrderItems = await prisma.orderItem.findMany({
    where: {
      order: {
        status: {
          in: ["NEW", "CONFIRMED", "ASSEMBLING", "READY", "DELIVERING"],
        },
      },
      product: {
        stockQuantity: { not: null },
      },
    },
    select: {
      id: true,
      productId: true,
      productName: true,
      order: { select: { number: true } },
      inventoryReservation: {
        select: { id: true, status: true, quantity: true },
      },
    },
  });

  const problems = [];

  for (const product of products) {
    const stock = number(product.stockQuantity);
    const storedReserved = number(product.reservedQuantity) ?? 0;
    const calculatedReserved = product.inventoryReservations.reduce(
      (sum, reservation) => sum + (number(reservation.quantity) ?? 0),
      0,
    );

    if (Math.abs(storedReserved - calculatedReserved) > 0.0005) {
      problems.push(
        `${product.sku}: reservedQuantity=${storedReserved}, active reservations=${calculatedReserved}`,
      );
    }

    if (stock !== null && storedReserved > stock + 0.0005) {
      problems.push(
        `${product.sku}: reservedQuantity=${storedReserved} exceeds stockQuantity=${stock}`,
      );
    }

    if (storedReserved < -0.0005 || (stock !== null && stock < -0.0005)) {
      problems.push(`${product.sku}: negative inventory balance detected`);
    }
  }

  for (const item of activeOrderItems) {
    if (!item.inventoryReservation || item.inventoryReservation.status !== "ACTIVE") {
      problems.push(
        `${item.order.number} / ${item.productName}: active order item has no ACTIVE inventory reservation`,
      );
    }
  }

  if (problems.length > 0) {
    console.error("FAIL: inventory consistency errors found:");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: inventory balances are consistent for ${products.length} products.`);
  }
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
