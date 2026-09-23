import { Router } from "express";
import { z } from "zod";

import {
  forgotPassword,
  getCurrentUser,
  login,
  logout,
  register,
  resetPassword,
} from "../controllers/auth.controller.js";
import {
  authRateLimiter,
  passwordResetRateLimiter,
  passwordResetRequestRateLimiter,
  registrationRateLimiter,
} from "../middleware/rate-limit.js";
import {
  requireAuth,
} from "../middleware/auth.js";
import {
  validate,
} from "../middleware/validate.js";
import { normalizeRussianPhone } from "../utils/phone.js";

const router = Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  return next();
});

const emailSchema = z
  .string()
  .trim()
  .email("Введите корректный email.")
  .max(
    191,
    "Email слишком длинный.",
  )
  .transform((value) =>
    value.toLowerCase(),
  );

const passwordSchema = z
  .string()
  .min(
    8,
    "Пароль должен содержать минимум 8 символов.",
  )
  .max(
    256,
    "Пароль слишком длинный.",
  );

const loginBodySchema = z
  .object({
    email: emailSchema,
    password: z
      .string()
      .min(
        1,
        "Введите пароль.",
      )
      .max(
        256,
        "Пароль слишком длинный.",
      ),
  })
  .strict();

const registerBodySchema = z
  .object({
    firstName: z
      .string()
      .trim()
      .min(2, "Введите имя.")
      .max(100, "Имя слишком длинное."),
    phone: z
      .string()
      .trim()
      .min(1, "Введите телефон.")
      .max(32, "Телефон слишком длинный.")
      .transform((value) =>
        normalizeRussianPhone(value),
      )
      .refine(
        (value) => value !== null,
        "Введите корректный номер телефона.",
      ),
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z
      .string()
      .max(
        256,
        "Пароль слишком длинный.",
      ),
    agreement: z
      .boolean()
      .refine(
        (value) => value === true,
        "Необходимо согласие на обработку данных.",
      ),
  })
  .strict()
  .refine(
    (data) =>
      data.password === data.passwordConfirm,
    {
      path: ["passwordConfirm"],
      message: "Пароли не совпадают.",
    },
  );

const forgotPasswordBodySchema = z
  .object({
    email: emailSchema,
  })
  .strict();

const resetPasswordBodySchema = z
  .object({
    token: z
      .string()
      .min(32, "Некорректная ссылка восстановления.")
      .max(512, "Некорректная ссылка восстановления."),
    password: passwordSchema,
    passwordConfirm: z
      .string()
      .max(
        256,
        "Пароль слишком длинный.",
      ),
  })
  .strict()
  .refine(
    (data) =>
      data.password === data.passwordConfirm,
    {
      path: ["passwordConfirm"],
      message: "Пароли не совпадают.",
    },
  );

router.post(
  "/login",
  authRateLimiter,
  validate({
    body: loginBodySchema,
  }),
  login,
);

router.post(
  "/register",
  registrationRateLimiter,
  validate({
    body: registerBodySchema,
  }),
  register,
);

router.post(
  "/forgot-password",
  passwordResetRequestRateLimiter,
  validate({
    body: forgotPasswordBodySchema,
  }),
  forgotPassword,
);

router.post(
  "/reset-password",
  passwordResetRateLimiter,
  validate({
    body: resetPasswordBodySchema,
  }),
  resetPassword,
);

router.get(
  "/me",
  requireAuth,
  getCurrentUser,
);

router.post(
  "/logout",
  logout,
);

export default router;
