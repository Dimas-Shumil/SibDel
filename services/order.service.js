import { prisma } from "../lib/prisma.js";
import {
  commitInventoryForOrder,
  releaseInventoryForOrder,
} from "./inventory.service.js";

const ORDER_STATUS_TRANSITIONS = Object.freeze({
  NEW: new Set(["CONFIRMED", "CANCELLED"]),
  CONFIRMED: new Set(["ASSEMBLING", "CANCELLED"]),
  ASSEMBLING: new Set(["READY", "CANCELLED"]),
  READY: new Set(["DELIVERING", "COMPLETED", "CANCELLED"]),
  DELIVERING: new Set(["COMPLETED"]),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
});

function decimalToNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

function createOrderError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

function createOrderLookup(orderKey) {
  const normalized = String(orderKey || "").trim();
  const numericId = Number(normalized);
  const conditions = [{ number: normalized }];

  if (Number.isInteger(numericId) && numericId > 0) {
    conditions.unshift({ id: numericId });
  }

  return conditions;
}

function mapDeliveryStatus(order, status) {
  switch (status) {
    case "NEW":
      return "PENDING";
    case "CONFIRMED":
      return "CONFIRMED";
    case "ASSEMBLING":
      return "ASSEMBLING";
    case "READY":
      return order.deliveryMethod === "PICKUP" ? "READY_FOR_PICKUP" : "CONFIRMED";
    case "DELIVERING":
      return "OUT_FOR_DELIVERY";
    case "COMPLETED":
      return "DELIVERED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return order.deliveryStatus;
  }
}

function serializeReservation(reservation) {
  return {
    id: reservation.id,
    productId: reservation.productId,
    orderItemId: reservation.orderItemId,
    quantity: decimalToNumber(reservation.quantity) ?? 0,
    status: reservation.status,
    createdAt: reservation.createdAt,
    releasedAt: reservation.releasedAt,
    committedAt: reservation.committedAt,
  };
}

function serializeOrderSummary(order) {
  return {
    id: order.id,
    number: order.number,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryStatus: order.deliveryStatus,
    deliveryMethod: order.deliveryMethod,
    paymentMethod: order.paymentMethod,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    total: decimalToNumber(order.total) ?? 0,
    currency: order.currency,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    itemsCount: order._count?.items ?? 0,
    activeReservations: order.inventoryReservations?.length ?? 0,
  };
}

function serializeOrder(order) {
  return {
    id: order.id,
    number: order.number,
    userId: order.userId,
    status: order.status,
    paymentStatus: order.paymentStatus,
    deliveryStatus: order.deliveryStatus,
    deliveryMethod: order.deliveryMethod,
    paymentMethod: order.paymentMethod,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    customerEmail: order.customerEmail,
    deliveryAddressSnapshot: order.deliveryAddressSnapshot,
    deliveryTermsSnapshot: order.deliveryTermsSnapshot,
    requestedReceiveDate: order.requestedReceiveDate,
    requestedTimeWindow: order.requestedTimeWindow,
    comment: order.comment,
    subtotal: decimalToNumber(order.subtotal) ?? 0,
    discountTotal: decimalToNumber(order.discountTotal) ?? 0,
    deliveryPrice: decimalToNumber(order.deliveryPrice) ?? 0,
    deliveryPriceConfirmed: order.deliveryPriceConfirmed,
    total: decimalToNumber(order.total) ?? 0,
    currency: order.currency,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    confirmedAt: order.confirmedAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    allowedStatuses: [...(ORDER_STATUS_TRANSITIONS[order.status] ?? [])],
    user: order.user ?? null,
    items: order.items?.map((item) => ({
      id: item.id,
      productId: item.productId,
      productName: item.productName,
      sku: item.sku,
      unit: item.unit,
      quantity: decimalToNumber(item.quantity) ?? 0,
      baseUnitPrice: decimalToNumber(item.baseUnitPrice) ?? 0,
      unitPrice: decimalToNumber(item.unitPrice) ?? 0,
      discountTotal: decimalToNumber(item.discountTotal) ?? 0,
      total: decimalToNumber(item.total) ?? 0,
      reservation: item.inventoryReservation
        ? serializeReservation(item.inventoryReservation)
        : null,
    })) ?? [],
    inventoryReservations:
      order.inventoryReservations?.map(serializeReservation) ?? [],
  };
}

export async function listAdminOrders({
  q = "",
  status,
  page = 1,
  limit = 25,
} = {}) {
  const normalizedQuery = String(q || "").trim();
  const where = {
    ...(status ? { status } : {}),
    ...(normalizedQuery
      ? {
          OR: [
            { number: { contains: normalizedQuery, mode: "insensitive" } },
            { customerName: { contains: normalizedQuery, mode: "insensitive" } },
            { customerPhone: { contains: normalizedQuery, mode: "insensitive" } },
            { customerEmail: { contains: normalizedQuery, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const skip = (page - 1) * limit;

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      select: {
        id: true,
        number: true,
        status: true,
        paymentStatus: true,
        deliveryStatus: true,
        deliveryMethod: true,
        paymentMethod: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        total: true,
        currency: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { items: true } },
        inventoryReservations: {
          where: { status: "ACTIVE" },
          select: { id: true },
        },
      },
    }),
  ]);

  return {
    items: orders.map(serializeOrderSummary),
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getAdminOrder(orderKey) {
  const order = await prisma.order.findFirst({
    where: { OR: createOrderLookup(orderKey) },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
      items: {
        orderBy: { id: "asc" },
        include: {
          inventoryReservation: true,
        },
      },
      inventoryReservations: {
        orderBy: { id: "asc" },
      },
    },
  });

  return order ? serializeOrder(order) : null;
}

export async function updateOrderStatus({ orderKey, nextStatus, actorId, reason = null }) {
  return prisma.$transaction(
    async (transaction) => {
      const order = await transaction.order.findFirst({
        where: { OR: createOrderLookup(orderKey) },
        select: {
          id: true,
          number: true,
          status: true,
          paymentStatus: true,
          deliveryStatus: true,
          deliveryMethod: true,
          paymentMethod: true,
          createdAt: true,
          updatedAt: true,
          confirmedAt: true,
          completedAt: true,
          cancelledAt: true,
        },
      });

      if (!order) {
        throw createOrderError("Заказ не найден.", 404, "ORDER_NOT_FOUND");
      }

      if (order.status === nextStatus) {
        const current = await transaction.order.findUnique({
          where: { id: order.id },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            items: {
              orderBy: { id: "asc" },
              include: { inventoryReservation: true },
            },
            inventoryReservations: { orderBy: { id: "asc" } },
          },
        });
        return serializeOrder(current);
      }

      const allowed = ORDER_STATUS_TRANSITIONS[order.status];

      if (!allowed?.has(nextStatus)) {
        throw createOrderError(
          `Переход заказа из статуса ${order.status} в ${nextStatus} запрещён.`,
          409,
          "INVALID_ORDER_STATUS_TRANSITION",
          {
            currentStatus: order.status,
            requestedStatus: nextStatus,
            allowedStatuses: [...(allowed ?? [])],
          },
        );
      }

      if (nextStatus === "CANCELLED") {
        await releaseInventoryForOrder(transaction, order.id, {
          actorId,
          reason: reason || `Отмена заказа ${order.number}`,
        });
      }

      if (nextStatus === "COMPLETED") {
        await commitInventoryForOrder(transaction, order.id, {
          actorId,
          reason: reason || `Выполнение заказа ${order.number}`,
        });
      }

      const now = new Date();
      await transaction.order.update({
        where: { id: order.id },
        data: {
          status: nextStatus,
          deliveryStatus: mapDeliveryStatus(order, nextStatus),
          ...(nextStatus === "CONFIRMED" && !order.confirmedAt
            ? { confirmedAt: now }
            : {}),
          ...(nextStatus === "COMPLETED" ? { completedAt: now } : {}),
          ...(nextStatus === "CANCELLED" ? { cancelledAt: now } : {}),
        },
      });

      await transaction.adminActivity.create({
        data: {
          actorId,
          action: "ORDER_STATUS_CHANGED",
          entityType: "Order",
          entityId: String(order.id),
          description: `Заказ ${order.number}: ${order.status} → ${nextStatus}`,
          metadata: {
            from: order.status,
            to: nextStatus,
            reason,
          },
        },
      });

      const updated = await transaction.order.findUnique({
        where: { id: order.id },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          items: {
            orderBy: { id: "asc" },
            include: { inventoryReservation: true },
          },
          inventoryReservations: { orderBy: { id: "asc" } },
        },
      });

      return serializeOrder(updated);
    },
    { isolationLevel: "Serializable" },
  );
}
