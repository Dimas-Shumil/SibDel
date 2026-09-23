import { prisma } from "../lib/prisma.js";
import {
  hashPassword,
  verifyPassword,
} from "./auth.service.js";

const SAFE_USER_SELECT = Object.freeze({
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

function createAccountError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

function normalizeNullable(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
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

export async function getAccountProfile(userId) {
  return prisma.user.findFirst({
    where: {
      id: userId,
      isActive: true,
    },
    select: SAFE_USER_SELECT,
  });
}

export async function updateAccountProfile(userId, profile) {
  try {
    return await prisma.user.update({
      where: {
        id: userId,
      },
      data: {
        firstName: normalizeNullable(profile.firstName),
        lastName: normalizeNullable(profile.lastName),
        email: profile.email.trim().toLowerCase(),
        phone: normalizeNullable(profile.phone),
      },
      select: SAFE_USER_SELECT,
    });
  } catch (error) {
    if (error?.code === "P2002") {
      throw createAccountError(
        "Email или телефон уже используется другим аккаунтом.",
        409,
        "PROFILE_CONFLICT",
      );
    }

    throw error;
  }
}

export async function changeAccountPassword({
  userId,
  currentPassword,
  newPassword,
}) {
  const user = await prisma.user.findUnique({
    where: {
      id: userId,
    },
    select: {
      id: true,
      passwordHash: true,
      isActive: true,
    },
  });

  if (!user || !user.isActive) {
    throw createAccountError(
      "Аккаунт недоступен.",
      404,
      "ACCOUNT_NOT_FOUND",
    );
  }

  const passwordValid = await verifyPassword(
    user.passwordHash,
    currentPassword,
  );

  if (!passwordValid) {
    throw createAccountError(
      "Текущий пароль указан неверно.",
      400,
      "INVALID_CURRENT_PASSWORD",
    );
  }

  const samePassword = await verifyPassword(
    user.passwordHash,
    newPassword,
  );

  if (samePassword) {
    throw createAccountError(
      "Новый пароль должен отличаться от текущего.",
      400,
      "PASSWORD_NOT_CHANGED",
    );
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (transaction) => {
    await transaction.user.update({
      where: {
        id: userId,
      },
      data: {
        passwordHash,
      },
    });

    await transaction.userSession.deleteMany({
      where: {
        userId,
      },
    });

    await transaction.passwordResetToken.deleteMany({
      where: {
        userId,
      },
    });
  });
}

export async function listAccountAddresses(userId) {
  return prisma.address.findMany({
    where: {
      userId,
    },
    orderBy: [
      {
        isDefault: "desc",
      },
      {
        updatedAt: "desc",
      },
    ],
  });
}

export async function createAccountAddress(userId, address) {
  return prisma.$transaction(async (transaction) => {
    const addressCount = await transaction.address.count({
      where: {
        userId,
      },
    });

    const isDefault = address.isDefault || addressCount === 0;

    if (isDefault) {
      await transaction.address.updateMany({
        where: {
          userId,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    return transaction.address.create({
      data: {
        userId,
        title: normalizeNullable(address.title),
        recipientName: address.recipientName.trim(),
        phone: address.phone.trim(),
        city: address.city.trim(),
        street: address.street.trim(),
        house: address.house.trim(),
        apartment: normalizeNullable(address.apartment),
        entrance: normalizeNullable(address.entrance),
        floor: normalizeNullable(address.floor),
        intercom: normalizeNullable(address.intercom),
        comment: normalizeNullable(address.comment),
        isDefault,
      },
    });
  });
}

export async function updateAccountAddress(userId, addressId, address) {
  return prisma.$transaction(async (transaction) => {
    const existingAddress = await transaction.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
    });

    if (!existingAddress) {
      throw createAccountError(
        "Адрес не найден.",
        404,
        "ADDRESS_NOT_FOUND",
      );
    }

    let isDefault = address.isDefault;

    if (address.isDefault) {
      await transaction.address.updateMany({
        where: {
          userId,
          id: {
            not: addressId,
          },
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    } else if (existingAddress.isDefault) {
      const replacement = await transaction.address.findFirst({
        where: {
          userId,
          id: {
            not: addressId,
          },
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
        },
      });

      if (replacement) {
        await transaction.address.update({
          where: {
            id: replacement.id,
          },
          data: {
            isDefault: true,
          },
        });
      } else {
        isDefault = true;
      }
    }

    return transaction.address.update({
      where: {
        id: addressId,
      },
      data: {
        title: normalizeNullable(address.title),
        recipientName: address.recipientName.trim(),
        phone: address.phone.trim(),
        city: address.city.trim(),
        street: address.street.trim(),
        house: address.house.trim(),
        apartment: normalizeNullable(address.apartment),
        entrance: normalizeNullable(address.entrance),
        floor: normalizeNullable(address.floor),
        intercom: normalizeNullable(address.intercom),
        comment: normalizeNullable(address.comment),
        isDefault,
      },
    });
  });
}

export async function deleteAccountAddress(userId, addressId) {
  return prisma.$transaction(async (transaction) => {
    const existingAddress = await transaction.address.findFirst({
      where: {
        id: addressId,
        userId,
      },
      select: {
        id: true,
        isDefault: true,
      },
    });

    if (!existingAddress) {
      throw createAccountError(
        "Адрес не найден.",
        404,
        "ADDRESS_NOT_FOUND",
      );
    }

    await transaction.address.delete({
      where: {
        id: addressId,
      },
    });

    if (existingAddress.isDefault) {
      const nextAddress = await transaction.address.findFirst({
        where: {
          userId,
        },
        orderBy: {
          updatedAt: "desc",
        },
        select: {
          id: true,
        },
      });

      if (nextAddress) {
        await transaction.address.update({
          where: {
            id: nextAddress.id,
          },
          data: {
            isDefault: true,
          },
        });
      }
    }
  });
}

export async function listAccountOrders(userId) {
  const orders = await prisma.order.findMany({
    where: {
      userId,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      number: true,
      status: true,
      paymentStatus: true,
      deliveryStatus: true,
      deliveryMethod: true,
      total: true,
      currency: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          items: true,
        },
      },
    },
  });

  return orders.map(({ _count, ...order }) => ({
    ...order,
    itemCount: _count.items,
  }));
}

export async function getAccountOrder(userId, orderKey) {
  return prisma.order.findFirst({
    where: {
      userId,
      OR: createOrderLookup(orderKey),
    },
    select: {
      id: true,
      number: true,
      status: true,
      paymentStatus: true,
      deliveryStatus: true,
      deliveryMethod: true,
      deliveryAddressSnapshot: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      comment: true,
      subtotal: true,
      discountTotal: true,
      deliveryPrice: true,
      total: true,
      currency: true,
      createdAt: true,
      updatedAt: true,
      confirmedAt: true,
      completedAt: true,
      cancelledAt: true,
      pickupPoint: {
        select: {
          id: true,
          name: true,
          address: true,
        },
      },
      items: {
        orderBy: {
          id: "asc",
        },
        select: {
          id: true,
          productId: true,
          productName: true,
          sku: true,
          unit: true,
          quantity: true,
          baseUnitPrice: true,
          unitPrice: true,
          discountTotal: true,
          total: true,
        },
      },
    },
  });
}

export async function getAccountSubscription(userId) {
  return prisma.userSubscription.findFirst({
    where: {
      userId,
      status: {
        in: ["ACTIVE", "PAUSED"],
      },
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      expiresAt: "desc",
    },
    select: {
      id: true,
      status: true,
      startsAt: true,
      expiresAt: true,
      autoRenew: true,
      cancelledAt: true,
      createdAt: true,
      updatedAt: true,
      plan: {
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          price: true,
          durationDays: true,
          discountPercent: true,
        },
      },
    },
  });
}
