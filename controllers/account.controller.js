import {
  authConfig,
  getSessionCookieOptions,
} from "../config/auth.js";
import { createSession } from "../services/auth.service.js";

import {
  changeAccountPassword,
  createAccountAddress,
  deleteAccountAddress,
  getAccountOrder,
  getAccountProfile,
  getAccountSubscription,
  listAccountAddresses,
  listAccountOrders,
  updateAccountAddress,
  updateAccountProfile,
} from "../services/account.service.js";

function createNotFoundError(message, code) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = code;
  error.expose = true;
  return error;
}

export async function getProfile(req, res, next) {
  try {
    const user = await getAccountProfile(req.user.id);

    if (!user) {
      return next(
        createNotFoundError(
          "Аккаунт не найден.",
          "ACCOUNT_NOT_FOUND",
        ),
      );
    }

    return res.status(200).json({
      ok: true,
      user,
    });
  } catch (error) {
    return next(error);
  }
}

export async function updateProfile(req, res, next) {
  try {
    const user = await updateAccountProfile(
      req.user.id,
      req.validated.body,
    );

    return res.status(200).json({
      ok: true,
      user,
    });
  } catch (error) {
    return next(error);
  }
}

export async function changePassword(req, res, next) {
  try {
    const {
      currentPassword,
      newPassword,
    } = req.validated.body;

    await changeAccountPassword({
      userId: req.user.id,
      currentPassword,
      newPassword,
    });

    const session = await createSession({
      userId: req.user.id,
      ipAddress: typeof req.ip === "string" ? req.ip : null,
      userAgent: req.get("user-agent") || null,
    });

    res.cookie(
      authConfig.sessionCookieName,
      session.token,
      getSessionCookieOptions(),
    );

    return res.status(200).json({
      ok: true,
      session: {
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function getAddresses(req, res, next) {
  try {
    const addresses = await listAccountAddresses(req.user.id);

    return res.status(200).json({
      ok: true,
      addresses,
    });
  } catch (error) {
    return next(error);
  }
}

export async function createAddress(req, res, next) {
  try {
    const address = await createAccountAddress(
      req.user.id,
      req.validated.body,
    );

    return res.status(201).json({
      ok: true,
      address,
    });
  } catch (error) {
    return next(error);
  }
}

export async function updateAddress(req, res, next) {
  try {
    const address = await updateAccountAddress(
      req.user.id,
      req.validated.params.addressId,
      req.validated.body,
    );

    return res.status(200).json({
      ok: true,
      address,
    });
  } catch (error) {
    return next(error);
  }
}

export async function deleteAddress(req, res, next) {
  try {
    await deleteAccountAddress(
      req.user.id,
      req.validated.params.addressId,
    );

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    return next(error);
  }
}

export async function getOrders(req, res, next) {
  try {
    const orders = await listAccountOrders(req.user.id);

    return res.status(200).json({
      ok: true,
      orders,
    });
  } catch (error) {
    return next(error);
  }
}

export async function getOrder(req, res, next) {
  try {
    const order = await getAccountOrder(
      req.user.id,
      req.validated.params.orderKey,
    );

    if (!order) {
      return next(
        createNotFoundError(
          "Заказ не найден.",
          "ORDER_NOT_FOUND",
        ),
      );
    }

    return res.status(200).json({
      ok: true,
      order,
    });
  } catch (error) {
    return next(error);
  }
}

export async function getSubscription(req, res, next) {
  try {
    const subscription = await getAccountSubscription(req.user.id);

    return res.status(200).json({
      ok: true,
      subscription,
    });
  } catch (error) {
    return next(error);
  }
}
