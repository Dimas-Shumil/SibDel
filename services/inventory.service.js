import { prisma } from "../lib/prisma.js";

const EPSILON = 0.0005;

function createInventoryError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;

  if (details !== undefined) {
    error.details = details;
  }

  return error;
}

function decimalToNumber(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = Number(value?.toString?.() ?? value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundQuantity(value) {
  return Number(Number(value).toFixed(3));
}

function getAvailableQuantity(product) {
  const stock = decimalToNumber(product.stockQuantity);

  if (stock === null) {
    return null;
  }

  const reserved = decimalToNumber(product.reservedQuantity) ?? 0;
  return roundQuantity(Math.max(0, stock - reserved));
}

function serializeInventoryProduct(product) {
  const stockQuantity = decimalToNumber(product.stockQuantity);
  const reservedQuantity = decimalToNumber(product.reservedQuantity) ?? 0;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    unit: product.unit,
    unitLabel: product.unitLabel,
    isActive: product.isActive,
    isAvailable: product.isAvailable,
    tracked: stockQuantity !== null,
    stockQuantity,
    reservedQuantity: roundQuantity(reservedQuantity),
    availableQuantity: getAvailableQuantity(product),
    updatedAt: product.updatedAt,
  };
}

function serializeMovement(movement) {
  return {
    id: movement.id,
    productId: movement.productId,
    orderId: movement.orderId,
    orderItemId: movement.orderItemId,
    actorId: movement.actorId,
    type: movement.type,
    onHandDelta: decimalToNumber(movement.onHandDelta) ?? 0,
    reservedDelta: decimalToNumber(movement.reservedDelta) ?? 0,
    balanceOnHand: decimalToNumber(movement.balanceOnHand),
    balanceReserved: decimalToNumber(movement.balanceReserved) ?? 0,
    reason: movement.reason,
    metadata: movement.metadata,
    createdAt: movement.createdAt,
  };
}

async function createMovement(transaction, {
  productId,
  orderId = null,
  orderItemId = null,
  actorId = null,
  type,
  onHandDelta = 0,
  reservedDelta = 0,
  balanceOnHand = null,
  balanceReserved = 0,
  reason = null,
  metadata = null,
}) {
  return transaction.inventoryMovement.create({
    data: {
      productId,
      orderId,
      orderItemId,
      actorId,
      type,
      onHandDelta: roundQuantity(onHandDelta).toFixed(3),
      reservedDelta: roundQuantity(reservedDelta).toFixed(3),
      balanceOnHand:
        balanceOnHand === null ? null : roundQuantity(balanceOnHand).toFixed(3),
      balanceReserved: roundQuantity(balanceReserved).toFixed(3),
      reason,
      ...(metadata === null ? {} : { metadata }),
    },
  });
}

async function getLockedProduct(transaction, productId) {
  const rows = await transaction.$queryRaw`
    SELECT
      "id",
      "name",
      "slug",
      "sku",
      "stockQuantity",
      "reservedQuantity",
      "isActive",
      "isAvailable"
    FROM "Product"
    WHERE "id" = ${productId}
    FOR UPDATE
  `;

  return rows[0] ?? null;
}

async function writeAdminActivity(transaction, {
  actorId,
  action,
  entityType,
  entityId,
  description,
  metadata = null,
}) {
  if (!actorId) {
    return;
  }

  await transaction.adminActivity.create({
    data: {
      actorId,
      action,
      entityType,
      entityId: String(entityId),
      description,
      ...(metadata === null ? {} : { metadata }),
    },
  });
}

/**
 * Reserves stock for every tracked item in an order.
 * Must be called inside the same Serializable transaction that creates the order.
 */
export async function reserveInventoryForOrder(transaction, orderId) {
  const order = await transaction.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      number: true,
      items: {
        orderBy: { id: "asc" },
        select: {
          id: true,
          productId: true,
          productName: true,
          quantity: true,
        },
      },
    },
  });

  if (!order) {
    throw createInventoryError(
      "Заказ не найден для резервирования остатков.",
      404,
      "ORDER_NOT_FOUND",
    );
  }

  for (const item of order.items) {
    if (!item.productId) {
      continue;
    }

    const existingReservation = await transaction.inventoryReservation.findUnique({
      where: { orderItemId: item.id },
      select: { id: true, status: true },
    });

    if (existingReservation) {
      if (existingReservation.status === "ACTIVE") {
        continue;
      }

      throw createInventoryError(
        `Резерв товара «${item.productName}» уже был завершён.`,
        409,
        "INVENTORY_RESERVATION_FINALIZED",
      );
    }

    const quantity = roundQuantity(decimalToNumber(item.quantity) ?? 0);

    if (quantity <= 0) {
      continue;
    }

    const product = await transaction.product.findUnique({
      where: { id: item.productId },
      select: {
        id: true,
        name: true,
        stockQuantity: true,
        reservedQuantity: true,
      },
    });

    if (!product) {
      throw createInventoryError(
        `Товар «${item.productName}» больше не существует.`,
        409,
        "INVENTORY_PRODUCT_NOT_FOUND",
      );
    }

    // NULL stock means the product is not inventory-tracked.
    if (product.stockQuantity === null) {
      continue;
    }

    const updatedRows = await transaction.$queryRaw`
      UPDATE "Product"
      SET
        "reservedQuantity" = "reservedQuantity" + CAST(${quantity} AS DECIMAL(14,3)),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${item.productId}
        AND "stockQuantity" IS NOT NULL
        AND ("stockQuantity" - "reservedQuantity") >= CAST(${quantity} AS DECIMAL(14,3))
      RETURNING "stockQuantity", "reservedQuantity"
    `;

    if (updatedRows.length === 0) {
      const latest = await transaction.product.findUnique({
        where: { id: item.productId },
        select: { stockQuantity: true, reservedQuantity: true },
      });
      const available = latest ? getAvailableQuantity(latest) : 0;

      throw createInventoryError(
        `Недостаточно доступного остатка товара «${item.productName}».`,
        409,
        "INSUFFICIENT_AVAILABLE_STOCK",
        {
          productId: item.productId,
          productName: item.productName,
          requestedQuantity: quantity,
          availableQuantity: available ?? 0,
        },
      );
    }

    const updated = updatedRows[0];
    const balanceOnHand = decimalToNumber(updated.stockQuantity);
    const balanceReserved = decimalToNumber(updated.reservedQuantity) ?? 0;

    await transaction.inventoryReservation.create({
      data: {
        orderId: order.id,
        orderItemId: item.id,
        productId: item.productId,
        quantity: quantity.toFixed(3),
        status: "ACTIVE",
      },
    });

    await createMovement(transaction, {
      productId: item.productId,
      orderId: order.id,
      orderItemId: item.id,
      type: "RESERVE",
      reservedDelta: quantity,
      balanceOnHand,
      balanceReserved,
      reason: `Резерв под заказ ${order.number}`,
    });
  }
}

export async function releaseInventoryForOrder(transaction, orderId, options = {}) {
  const reservations = await transaction.inventoryReservation.findMany({
    where: {
      orderId,
      status: "ACTIVE",
    },
    orderBy: { id: "asc" },
    include: {
      order: { select: { number: true } },
      orderItem: { select: { productName: true } },
    },
  });

  for (const reservation of reservations) {
    const quantity = roundQuantity(decimalToNumber(reservation.quantity) ?? 0);

    const updatedRows = await transaction.$queryRaw`
      UPDATE "Product"
      SET
        "reservedQuantity" = "reservedQuantity" - CAST(${quantity} AS DECIMAL(14,3)),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${reservation.productId}
        AND "reservedQuantity" >= CAST(${quantity} AS DECIMAL(14,3))
      RETURNING "stockQuantity", "reservedQuantity"
    `;

    if (updatedRows.length === 0) {
      throw createInventoryError(
        `Невозможно снять резерв товара «${reservation.orderItem.productName}»: складской баланс повреждён.`,
        409,
        "INVENTORY_BALANCE_CONFLICT",
      );
    }

    const updated = updatedRows[0];

    await transaction.inventoryReservation.update({
      where: { id: reservation.id },
      data: {
        status: "RELEASED",
        releasedAt: new Date(),
      },
    });

    await createMovement(transaction, {
      productId: reservation.productId,
      orderId,
      orderItemId: reservation.orderItemId,
      actorId: options.actorId ?? null,
      type: "RELEASE",
      reservedDelta: -quantity,
      balanceOnHand: decimalToNumber(updated.stockQuantity),
      balanceReserved: decimalToNumber(updated.reservedQuantity) ?? 0,
      reason:
        options.reason || `Снятие резерва заказа ${reservation.order.number}`,
    });
  }

  return reservations.length;
}

export async function commitInventoryForOrder(transaction, orderId, options = {}) {
  const reservations = await transaction.inventoryReservation.findMany({
    where: {
      orderId,
      status: "ACTIVE",
    },
    orderBy: { id: "asc" },
    include: {
      order: { select: { number: true } },
      orderItem: { select: { productName: true } },
    },
  });

  for (const reservation of reservations) {
    const quantity = roundQuantity(decimalToNumber(reservation.quantity) ?? 0);

    const updatedRows = await transaction.$queryRaw`
      UPDATE "Product"
      SET
        "stockQuantity" = "stockQuantity" - CAST(${quantity} AS DECIMAL(14,3)),
        "reservedQuantity" = "reservedQuantity" - CAST(${quantity} AS DECIMAL(14,3)),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${reservation.productId}
        AND "stockQuantity" IS NOT NULL
        AND "stockQuantity" >= CAST(${quantity} AS DECIMAL(14,3))
        AND "reservedQuantity" >= CAST(${quantity} AS DECIMAL(14,3))
      RETURNING "stockQuantity", "reservedQuantity"
    `;

    if (updatedRows.length === 0) {
      throw createInventoryError(
        `Невозможно списать товар «${reservation.orderItem.productName}»: складской баланс повреждён.`,
        409,
        "INVENTORY_BALANCE_CONFLICT",
      );
    }

    const updated = updatedRows[0];

    await transaction.inventoryReservation.update({
      where: { id: reservation.id },
      data: {
        status: "COMMITTED",
        committedAt: new Date(),
      },
    });

    await createMovement(transaction, {
      productId: reservation.productId,
      orderId,
      orderItemId: reservation.orderItemId,
      actorId: options.actorId ?? null,
      type: "SALE",
      onHandDelta: -quantity,
      reservedDelta: -quantity,
      balanceOnHand: decimalToNumber(updated.stockQuantity),
      balanceReserved: decimalToNumber(updated.reservedQuantity) ?? 0,
      reason: options.reason || `Списание по заказу ${reservation.order.number}`,
    });
  }

  return reservations.length;
}

export async function listInventoryProducts({ q = "", limit = 100 } = {}) {
  const products = await prisma.product.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { slug: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: [
      { category: { sortOrder: "asc" } },
      { sortOrder: "asc" },
      { id: "asc" },
    ],
    take: limit,
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      unit: true,
      unitLabel: true,
      stockQuantity: true,
      reservedQuantity: true,
      isActive: true,
      isAvailable: true,
      updatedAt: true,
    },
  });

  return products.map(serializeInventoryProduct);
}

export async function getInventoryProduct(productId) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      unit: true,
      unitLabel: true,
      stockQuantity: true,
      reservedQuantity: true,
      isActive: true,
      isAvailable: true,
      updatedAt: true,
      inventoryReservations: {
        where: { status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        take: 100,
        select: {
          id: true,
          orderId: true,
          orderItemId: true,
          quantity: true,
          status: true,
          createdAt: true,
          order: { select: { number: true, status: true } },
        },
      },
      inventoryMovements: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          productId: true,
          orderId: true,
          orderItemId: true,
          actorId: true,
          type: true,
          onHandDelta: true,
          reservedDelta: true,
          balanceOnHand: true,
          balanceReserved: true,
          reason: true,
          metadata: true,
          createdAt: true,
        },
      },
    },
  });

  if (!product) {
    return null;
  }

  return {
    ...serializeInventoryProduct(product),
    activeReservations: product.inventoryReservations.map((reservation) => ({
      ...reservation,
      quantity: decimalToNumber(reservation.quantity) ?? 0,
    })),
    movements: product.inventoryMovements.map(serializeMovement),
  };
}

async function mutateOnHandStock({
  productId,
  actorId,
  quantity,
  reason,
  type,
}) {
  return prisma.$transaction(
    async (transaction) => {
      const product = await getLockedProduct(transaction, productId);

      if (!product) {
        throw createInventoryError("Товар не найден.", 404, "PRODUCT_NOT_FOUND");
      }

      const currentStock = decimalToNumber(product.stockQuantity) ?? 0;
      const currentReserved = decimalToNumber(product.reservedQuantity) ?? 0;
      const nextStock = roundQuantity(currentStock + quantity);

      if (nextStock < -EPSILON) {
        throw createInventoryError(
          "Остаток товара не может быть отрицательным.",
          409,
          "NEGATIVE_STOCK_NOT_ALLOWED",
        );
      }

      if (nextStock + EPSILON < currentReserved) {
        throw createInventoryError(
          "Нельзя уменьшить фактический остаток ниже уже зарезервированного количества.",
          409,
          "STOCK_BELOW_RESERVED",
          {
            reservedQuantity: currentReserved,
            requestedStockQuantity: nextStock,
          },
        );
      }

      const updated = await transaction.product.update({
        where: { id: productId },
        data: { stockQuantity: nextStock.toFixed(3) },
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          unit: true,
          unitLabel: true,
          stockQuantity: true,
          reservedQuantity: true,
          isActive: true,
          isAvailable: true,
          updatedAt: true,
        },
      });

      await createMovement(transaction, {
        productId,
        actorId,
        type,
        onHandDelta: quantity,
        balanceOnHand: nextStock,
        balanceReserved: currentReserved,
        reason,
      });

      await writeAdminActivity(transaction, {
        actorId,
        action: `INVENTORY_${type}`,
        entityType: "Product",
        entityId: productId,
        description: `${reason} (${quantity > 0 ? "+" : ""}${roundQuantity(quantity)})`,
        metadata: {
          beforeStockQuantity: currentStock,
          afterStockQuantity: nextStock,
          reservedQuantity: currentReserved,
        },
      });

      return serializeInventoryProduct(updated);
    },
    { isolationLevel: "Serializable" },
  );
}

export async function receiveInventory({ productId, actorId, quantity, reason }) {
  const normalized = roundQuantity(quantity);

  if (normalized <= 0) {
    throw createInventoryError(
      "Количество поступления должно быть больше нуля.",
      400,
      "INVALID_RECEIPT_QUANTITY",
    );
  }

  return mutateOnHandStock({
    productId,
    actorId,
    quantity: normalized,
    reason,
    type: "RECEIPT",
  });
}

export async function returnInventory({ productId, actorId, quantity, reason }) {
  const normalized = roundQuantity(quantity);

  if (normalized <= 0) {
    throw createInventoryError(
      "Количество возврата должно быть больше нуля.",
      400,
      "INVALID_RETURN_QUANTITY",
    );
  }

  return mutateOnHandStock({
    productId,
    actorId,
    quantity: normalized,
    reason,
    type: "RETURN",
  });
}

export async function adjustInventory({ productId, actorId, stockQuantity, reason }) {
  const nextStock = roundQuantity(stockQuantity);

  if (nextStock < 0) {
    throw createInventoryError(
      "Фактический остаток не может быть отрицательным.",
      400,
      "INVALID_STOCK_QUANTITY",
    );
  }

  return prisma.$transaction(
    async (transaction) => {
      const product = await getLockedProduct(transaction, productId);

      if (!product) {
        throw createInventoryError("Товар не найден.", 404, "PRODUCT_NOT_FOUND");
      }

      const currentStock = decimalToNumber(product.stockQuantity) ?? 0;
      const currentReserved = decimalToNumber(product.reservedQuantity) ?? 0;

      if (nextStock + EPSILON < currentReserved) {
        throw createInventoryError(
          "Нельзя установить остаток ниже зарезервированного количества.",
          409,
          "STOCK_BELOW_RESERVED",
          {
            reservedQuantity: currentReserved,
            requestedStockQuantity: nextStock,
          },
        );
      }

      const delta = roundQuantity(nextStock - currentStock);
      const updated = await transaction.product.update({
        where: { id: productId },
        data: { stockQuantity: nextStock.toFixed(3) },
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          unit: true,
          unitLabel: true,
          stockQuantity: true,
          reservedQuantity: true,
          isActive: true,
          isAvailable: true,
          updatedAt: true,
        },
      });

      await createMovement(transaction, {
        productId,
        actorId,
        type: "ADJUSTMENT",
        onHandDelta: delta,
        balanceOnHand: nextStock,
        balanceReserved: currentReserved,
        reason,
      });

      await writeAdminActivity(transaction, {
        actorId,
        action: "INVENTORY_ADJUSTMENT",
        entityType: "Product",
        entityId: productId,
        description: reason,
        metadata: {
          beforeStockQuantity: currentStock,
          afterStockQuantity: nextStock,
          delta,
          reservedQuantity: currentReserved,
        },
      });

      return serializeInventoryProduct(updated);
    },
    { isolationLevel: "Serializable" },
  );
}

export async function listInventoryMovements({ productId, orderId, type, limit = 100 } = {}) {
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      ...(productId ? { productId } : {}),
      ...(orderId ? { orderId } : {}),
      ...(type ? { type } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      productId: true,
      orderId: true,
      orderItemId: true,
      actorId: true,
      type: true,
      onHandDelta: true,
      reservedDelta: true,
      balanceOnHand: true,
      balanceReserved: true,
      reason: true,
      metadata: true,
      createdAt: true,
      product: { select: { name: true, sku: true } },
      order: { select: { number: true } },
      actor: { select: { firstName: true, lastName: true, email: true } },
    },
  });

  return movements.map((movement) => ({
    ...serializeMovement(movement),
    product: movement.product,
    order: movement.order,
    actor: movement.actor,
  }));
}
