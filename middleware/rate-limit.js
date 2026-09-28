import { rateLimit } from "express-rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function createRateLimiter({
  limit,
  identifier,
  message,
  skipSuccessfulRequests = false,
}) {
  return rateLimit({
    windowMs: FIFTEEN_MINUTES,

    limit,

    identifier,

    standardHeaders: "draft-8",

    legacyHeaders: false,

    skipSuccessfulRequests,

    handler(_req, res, _next, options) {
      return res.status(options.statusCode).json({
        ok: false,

        error: {
          code: "RATE_LIMITED",
          message,
        },
      });
    },
  });
}

export const apiRateLimiter = createRateLimiter({
  limit: 300,
  identifier: "api",
  message: "Слишком много запросов. Попробуйте немного позже.",
});

export const authRateLimiter = createRateLimiter({
  limit: 10,
  identifier: "auth",
  message: "Слишком много попыток входа. Попробуйте позже.",
  skipSuccessfulRequests: true,
});

export const sensitiveRateLimiter = createRateLimiter({
  limit: 10,
  identifier: "sensitive",
  message: "Слишком много попыток выполнить защищённую операцию. Попробуйте позже.",
});

export const adminMutationRateLimiter = createRateLimiter({
  limit: 120,
  identifier: "admin-mutation",
  message: "Слишком много изменений за короткое время. Попробуйте немного позже.",
});

export const registrationRateLimiter = createRateLimiter({
  limit: 5,
  identifier: "registration",
  message: "Слишком много попыток регистрации. Попробуйте немного позже.",
});

export const passwordResetRequestRateLimiter = createRateLimiter({
  limit: 5,
  identifier: "password-reset-request",
  message: "Слишком много запросов на восстановление пароля. Попробуйте позже.",
});

export const passwordResetRateLimiter = createRateLimiter({
  limit: 10,
  identifier: "password-reset",
  message: "Слишком много попыток смены пароля. Попробуйте немного позже.",
});

export const checkoutRateLimiter = createRateLimiter({
  limit: 20,
  identifier: "checkout",
  message: "Слишком много попыток оформить заказ. Попробуйте немного позже.",
});
