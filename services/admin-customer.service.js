import { prisma } from "../lib/prisma.js";

const ACTIVE_ORDER_STATUSES = ["NEW", "CONFIRMED", "ASSEMBLING", "READY", "DELIVERING"];

function decimalToNumber(value) {
  if (value === null || value === undefined) return 0;
  const number = Number(value?.toString?.() ?? value);
  return Number.isFinite(number) ? number : 0;
}

function createCustomerError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  if (details !== undefined) error.details = details;
  return error;
}

function customerWhere({ q = "", status = "all", purchase = "all" } = {}) {
  const normalizedQuery = String(q || "").trim();

  return {
    role: "CUSTOMER",
    ...(status === "active" ? { isActive: true } : {}),
    ...(status === "inactive" ? { isActive: false } : {}),
    ...(purchase === "buyers" ? { orders: { some: {} } } : {}),
    ...(purchase === "no-orders" ? { orders: { none: {} } } : {}),
    ...(normalizedQuery
      ? {
          OR: [
            { firstName: { contains: normalizedQuery, mode: "insensitive" } },
            { lastName: { contains: normalizedQuery, mode: "insensitive" } },
            { email: { contains: normalizedQuery, mode: "insensitive" } },
            { phone: { contains: normalizedQuery, mode: "insensitive" } },
          ],
        }
      : {}),
  };
}

function customerName(customer) {
  return [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim() || "Без имени";
}

function serializeCustomerSummary(customer, orderStats, completedStats, activeStats) {
  const all = orderStats.get(customer.id);
  const completed = completedStats.get(customer.id);
  const active = activeStats.get(customer.id);

  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    name: customerName(customer),
    email: customer.email,
    phone: customer.phone,
    isActive: customer.isActive,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    addressesCount: customer._count?.addresses ?? 0,
    ordersCount: all?._count?._all ?? 0,
    completedOrdersCount: completed?._count?._all ?? 0,
    activeOrdersCount: active?._count?._all ?? 0,
    lifetimeValue: decimalToNumber(completed?._sum?.total),
    lastOrderAt: all?._max?.createdAt ?? null,
  };
}

function serializeOrder(order) {
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
    total: decimalToNumber(order.total),
    currency: order.currency,
    createdAt: order.createdAt,
    completedAt: order.completedAt,
    cancelledAt: order.cancelledAt,
    itemsCount: order._count?.items ?? 0,
  };
}

function serializeActivity(activity) {
  return {
    id: activity.id,
    action: activity.action,
    description: activity.description,
    metadata: activity.metadata,
    createdAt: activity.createdAt,
    actor: activity.actor
      ? {
          id: activity.actor.id,
          firstName: activity.actor.firstName,
          lastName: activity.actor.lastName,
          email: activity.actor.email,
        }
      : null,
  };
}

async function assertCustomer(customerId, client = prisma) {
  const customer = await client.user.findFirst({
    where: { id: customerId, role: "CUSTOMER" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!customer) {
    throw createCustomerError("Клиент не найден.", 404, "CUSTOMER_NOT_FOUND");
  }

  return customer;
}

export async function listAdminCustomers({
  q = "",
  status = "all",
  purchase = "all",
  page = 1,
  limit = 30,
} = {}) {
  const where = customerWhere({ q, status, purchase });
  const skip = (page - 1) * limit;
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [total, customers, totalCustomers, activeCustomers, buyers, newCustomers30d] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: limit,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { addresses: true } },
      },
    }),
    prisma.user.count({ where: { role: "CUSTOMER" } }),
    prisma.user.count({ where: { role: "CUSTOMER", isActive: true } }),
    prisma.user.count({ where: { role: "CUSTOMER", orders: { some: {} } } }),
    prisma.user.count({ where: { role: "CUSTOMER", createdAt: { gte: thirtyDaysAgo } } }),
  ]);

  const ids = customers.map((customer) => customer.id);
  const [allOrderRows, completedRows, activeRows] = ids.length
    ? await Promise.all([
        prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids } },
          _count: { _all: true },
          _max: { createdAt: true },
        }),
        prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, status: "COMPLETED" },
          _count: { _all: true },
          _sum: { total: true },
        }),
        prisma.order.groupBy({
          by: ["userId"],
          where: { userId: { in: ids }, status: { in: ACTIVE_ORDER_STATUSES } },
          _count: { _all: true },
        }),
      ])
    : [[], [], []];

  const indexByUserId = (rows) => new Map(rows.filter((row) => row.userId !== null).map((row) => [row.userId, row]));

  const allMap = indexByUserId(allOrderRows);
  const completedMap = indexByUserId(completedRows);
  const activeMap = indexByUserId(activeRows);

  return {
    items: customers.map((customer) => serializeCustomerSummary(customer, allMap, completedMap, activeMap)),
    metrics: {
      totalCustomers,
      activeCustomers,
      buyers,
      newCustomers30d,
    },
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getAdminCustomer(customerId) {
  const customer = await prisma.user.findFirst({
    where: { id: customerId, role: "CUSTOMER" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
      addresses: {
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          title: true,
          recipientName: true,
          phone: true,
          city: true,
          street: true,
          house: true,
          apartment: true,
          entrance: true,
          floor: true,
          intercom: true,
          comment: true,
          isDefault: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      orders: {
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 50,
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
          completedAt: true,
          cancelledAt: true,
          _count: { select: { items: true } },
        },
      },
    },
  });

  if (!customer) return null;

  const now = new Date();
  const [completed, ordersCount, cancelledOrdersCount, activeOrdersCount, sessionStats, activities] = await Promise.all([
    prisma.order.aggregate({
      where: { userId: customerId, status: "COMPLETED" },
      _count: { _all: true },
      _sum: { total: true },
    }),
    prisma.order.count({ where: { userId: customerId } }),
    prisma.order.count({ where: { userId: customerId, status: "CANCELLED" } }),
    prisma.order.count({ where: { userId: customerId, status: { in: ACTIVE_ORDER_STATUSES } } }),
    prisma.userSession.aggregate({
      where: { userId: customerId, expiresAt: { gt: now } },
      _count: { _all: true },
      _max: { lastUsedAt: true, expiresAt: true },
    }),
    prisma.adminActivity.findMany({
      where: {
        entityType: "User",
        entityId: String(customerId),
        action: { in: ["CUSTOMER_NOTE", "CUSTOMER_DEACTIVATED", "CUSTOMER_REACTIVATED"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        action: true,
        description: true,
        metadata: true,
        createdAt: true,
        actor: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    }),
  ]);

  return {
    id: customer.id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    name: customerName(customer),
    email: customer.email,
    phone: customer.phone,
    isActive: customer.isActive,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
    addresses: customer.addresses,
    orders: customer.orders.map(serializeOrder),
    metrics: {
      ordersCount,
      completedOrdersCount: completed._count?._all ?? 0,
      cancelledOrdersCount,
      activeOrdersCount,
      lifetimeValue: decimalToNumber(completed._sum?.total),
      lastOrderAt: customer.orders[0]?.createdAt ?? null,
    },
    sessions: {
      activeCount: sessionStats._count?._all ?? 0,
      lastUsedAt: sessionStats._max?.lastUsedAt ?? null,
      latestExpiryAt: sessionStats._max?.expiresAt ?? null,
    },
    timeline: activities.map(serializeActivity),
  };
}

export async function addAdminCustomerNote(customerId, text, actor) {
  await assertCustomer(customerId);

  const activity = await prisma.adminActivity.create({
    data: {
      actorId: actor.actorId,
      action: "CUSTOMER_NOTE",
      entityType: "User",
      entityId: String(customerId),
      description: text,
      metadata: { kind: "internal_note" },
      ipAddress: actor.ipAddress,
      userAgent: actor.userAgent,
    },
    select: {
      id: true,
      action: true,
      description: true,
      metadata: true,
      createdAt: true,
      actor: { select: { id: true, firstName: true, lastName: true, email: true } },
    },
  });

  return serializeActivity(activity);
}

export async function setAdminCustomerActive(customerId, isActive, reason, actor) {
  return prisma.$transaction(async (transaction) => {
    const customer = await assertCustomer(customerId, transaction);

    if (customer.isActive === isActive) {
      return customer;
    }

    const updated = await transaction.user.update({
      where: { id: customerId },
      data: { isActive },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!isActive) {
      await transaction.userSession.deleteMany({ where: { userId: customerId } });
      await transaction.passwordResetToken.deleteMany({ where: { userId: customerId } });
    }

    await transaction.adminActivity.create({
      data: {
        actorId: actor.actorId,
        action: isActive ? "CUSTOMER_REACTIVATED" : "CUSTOMER_DEACTIVATED",
        entityType: "User",
        entityId: String(customerId),
        description: isActive ? "Доступ клиента к аккаунту восстановлен." : "Доступ клиента к аккаунту отключён.",
        metadata: {
          from: customer.isActive,
          to: isActive,
          reason: reason || null,
        },
        ipAddress: actor.ipAddress,
        userAgent: actor.userAgent,
      },
    });

    return updated;
  });
}
