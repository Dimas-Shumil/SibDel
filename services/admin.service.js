import { prisma } from "../lib/prisma.js";

function decimalToNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }

  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const BUSINESS_TIME_ZONE = "Asia/Krasnoyarsk";
const BUSINESS_UTC_OFFSET = "+07:00";

function startOfToday() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );

  return new Date(
    `${values.year}-${values.month}-${values.day}T00:00:00${BUSINESS_UTC_OFFSET}`,
  );
}

export async function getAdminDashboard() {
  const today = startOfToday();

  const [
    ordersToday,
    newOrders,
    activeOrders,
    orderValueToday,
    customerCount,
    trackedProducts,
    activeReservations,
    recentOrders,
  ] = await Promise.all([
    prisma.order.count({
      where: { createdAt: { gte: today } },
    }),
    prisma.order.count({
      where: { status: "NEW" },
    }),
    prisma.order.count({
      where: {
        status: {
          in: ["CONFIRMED", "ASSEMBLING", "READY", "DELIVERING"],
        },
      },
    }),
    prisma.order.aggregate({
      where: {
        createdAt: { gte: today },
        status: { not: "CANCELLED" },
      },
      _sum: { total: true },
    }),
    prisma.user.count({
      where: { role: "CUSTOMER", isActive: true },
    }),
    prisma.product.findMany({
      where: { stockQuantity: { not: null } },
      select: {
        stockQuantity: true,
        reservedQuantity: true,
      },
    }),
    prisma.inventoryReservation.count({
      where: { status: "ACTIVE" },
    }),
    prisma.order.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        number: true,
        status: true,
        customerName: true,
        customerPhone: true,
        deliveryMethod: true,
        total: true,
        currency: true,
        createdAt: true,
        _count: { select: { items: true } },
      },
    }),
  ]);

  let outOfStockProducts = 0;
  let reservedUnits = 0;

  for (const product of trackedProducts) {
    const stock = decimalToNumber(product.stockQuantity);
    const reserved = decimalToNumber(product.reservedQuantity);
    reservedUnits += reserved;

    if (stock - reserved <= 0) {
      outOfStockProducts += 1;
    }
  }

  return {
    metrics: {
      ordersToday,
      newOrders,
      activeOrders,
      orderValueToday: decimalToNumber(orderValueToday._sum.total),
      customerCount,
      trackedProducts: trackedProducts.length,
      outOfStockProducts,
      activeReservations,
      reservedUnits: Number(reservedUnits.toFixed(3)),
    },
    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      number: order.number,
      status: order.status,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      deliveryMethod: order.deliveryMethod,
      total: decimalToNumber(order.total),
      currency: order.currency,
      createdAt: order.createdAt,
      itemsCount: order._count.items,
    })),
  };
}
