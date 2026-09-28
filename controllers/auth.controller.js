import {
  authConfig,
  getClearSessionCookieOptions,
  getSessionCookieOptions,
} from "../config/auth.js";
import { logger } from "../lib/logger.js";
import {
  authenticateUserByEmail,
  createCustomerAccount,
  createPasswordResetRequest,
  createSession,
  invalidatePasswordResetRequest,
  resetPasswordWithToken,
  revokeSessionToken,
} from "../services/auth.service.js";
import { sendPasswordResetEmail } from "../services/mail.service.js";
import {
  clearGuestCommerceCookie,
  mergeGuestCommerceIntoUser,
  readGuestCommerceToken,
} from "../services/commerce.service.js";

const MIN_FORGOT_RESPONSE_MS = 250;

async function mergeGuestCommerceAfterAuthentication(req, res, userId) {
  const guestToken = readGuestCommerceToken(req);

  if (!guestToken) {
    return;
  }

  try {
    await mergeGuestCommerceIntoUser({
      token: guestToken,
      userId,
    });
    clearGuestCommerceCookie(res);
  } catch (error) {
    logger.warn(
      {
        err: error,
        userId,
      },
      "Guest commerce state merge after authentication failed",
    );
  }
}

function createAuthError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

function createInvalidCredentialsError() {
  return createAuthError(
    "Неверный email или пароль.",
    401,
    "INVALID_CREDENTIALS",
  );
}

function getRequestIp(req) {
  if (
    typeof req.ip === "string" &&
    req.ip
  ) {
    return req.ip;
  }

  return null;
}

function getUserAgent(req) {
  const userAgent = req.get("user-agent");

  return typeof userAgent === "string"
    ? userAgent
    : null;
}

async function waitForMinimumDuration(startedAt, minimumMs) {
  const elapsed = Date.now() - startedAt;
  const remaining = minimumMs - elapsed;

  if (remaining <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, remaining);
  });
}

function dispatchPasswordResetEmail(resetRequest) {
  if (!resetRequest) {
    return;
  }

  void sendPasswordResetEmail({
    to: resetRequest.email,
    token: resetRequest.token,
  }).catch(async (error) => {
    logger.warn(
      {
        err: error,
        passwordResetRequestId: resetRequest.id,
      },
      "Password reset email delivery failed",
    );

    try {
      await invalidatePasswordResetRequest(
        resetRequest.id,
      );
    } catch (cleanupError) {
      logger.error(
        {
          err: cleanupError,
          passwordResetRequestId: resetRequest.id,
        },
        "Failed to invalidate undelivered password reset token",
      );
    }
  });
}

export async function login(
  req,
  res,
  next,
) {
  try {
    const {
      email,
      password,
    } = req.validated.body;

    const user =
      await authenticateUserByEmail({
        email,
        password,
      });

    if (!user) {
      return next(
        createInvalidCredentialsError(),
      );
    }

    if (user.role !== "CUSTOMER") {
      return next(
        createAuthError(
          "Для служебной учётной записи используйте вход в админ-панель.",
          403,
          "ADMIN_LOGIN_REQUIRED",
        ),
      );
    }

    const existingToken =
      req.cookies?.[
        authConfig.sessionCookieName
      ];

    if (existingToken) {
      await revokeSessionToken(
        existingToken,
      );
    }

    const session =
      await createSession({
        userId: user.id,
        ipAddress: getRequestIp(req),
        userAgent: getUserAgent(req),
      });

    res.cookie(
      authConfig.sessionCookieName,
      session.token,
      getSessionCookieOptions(),
    );

    await mergeGuestCommerceAfterAuthentication(req, res, user.id);

    return res.status(200).json({
      ok: true,
      user,
      session: {
        expiresAt:
          session.expiresAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function register(
  req,
  res,
  next,
) {
  try {
    if (req.user) {
      return next(
        createAuthError(
          "Вы уже вошли в аккаунт.",
          409,
          "ALREADY_AUTHENTICATED",
        ),
      );
    }

    const {
      email,
      phone,
      firstName,
      password,
    } = req.validated.body;

    let user;

    try {
      user = await createCustomerAccount({
        email,
        phone,
        firstName,
        password,
      });
    } catch (error) {
      if (error?.code === "P2002") {
        return next(
          createAuthError(
            "Аккаунт с такими контактными данными уже существует.",
            409,
            "REGISTRATION_CONFLICT",
          ),
        );
      }

      throw error;
    }

    const session = await createSession({
      userId: user.id,
      ipAddress: getRequestIp(req),
      userAgent: getUserAgent(req),
    });

    res.cookie(
      authConfig.sessionCookieName,
      session.token,
      getSessionCookieOptions(),
    );

    await mergeGuestCommerceAfterAuthentication(req, res, user.id);

    return res.status(201).json({
      ok: true,
      user,
      session: {
        expiresAt: session.expiresAt,
      },
    });
  } catch (error) {
    return next(error);
  }
}

export async function forgotPassword(
  req,
  res,
  next,
) {
  const startedAt = Date.now();

  try {
    const resetRequest =
      await createPasswordResetRequest({
        email: req.validated.body.email,
      });

    dispatchPasswordResetEmail(resetRequest);

    await waitForMinimumDuration(
      startedAt,
      MIN_FORGOT_RESPONSE_MS,
    );

    return res.status(200).json({
      ok: true,
      message:
        "Если аккаунт с таким email существует, ссылка для восстановления отправлена на почту.",
    });
  } catch (error) {
    return next(error);
  }
}

export async function resetPassword(
  req,
  res,
  next,
) {
  try {
    const result =
      await resetPasswordWithToken({
        token: req.validated.body.token,
        newPassword:
          req.validated.body.password,
      });

    if (!result.ok) {
      if (result.reason === "PASSWORD_NOT_CHANGED") {
        return next(
          createAuthError(
            "Новый пароль должен отличаться от текущего.",
            400,
            "PASSWORD_NOT_CHANGED",
          ),
        );
      }

      return next(
        createAuthError(
          "Ссылка для восстановления недействительна или срок её действия истёк.",
          400,
          "INVALID_RESET_TOKEN",
        ),
      );
    }

    if (req.user?.id === result.userId) {
      res.clearCookie(
        authConfig.sessionCookieName,
        getClearSessionCookieOptions(),
      );
    }

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    return next(error);
  }
}

export function getCurrentUser(
  req,
  res,
) {
  return res.status(200).json({
    ok: true,
    user: req.user,
  });
}

export async function logout(
  req,
  res,
  next,
) {
  try {
    const token =
      req.cookies?.[
        authConfig.sessionCookieName
      ];

    if (token) {
      await revokeSessionToken(token);
    }

    res.clearCookie(
      authConfig.sessionCookieName,
      getClearSessionCookieOptions(),
    );

    return res.status(200).json({
      ok: true,
    });
  } catch (error) {
    return next(error);
  }
}
