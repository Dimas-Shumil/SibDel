import { Router } from "express";
import { z } from "zod";

import {
  changePassword,
  createAddress,
  deleteAddress,
  getAddresses,
  getOrder,
  getOrders,
  getProfile,
  getSubscription,
  updateAddress,
  updateProfile,
} from "../controllers/account.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { normalizeRussianPhone } from "../utils/phone.js";

const router = Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  return next();
});

const nullableString = (maxLength) =>
  z
    .union([
      z.string().trim().max(maxLength),
      z.null(),
    ])
    .transform((value) => {
      if (value === null) {
        return null;
      }

      return value || null;
    });

const requiredPhoneSchema = z
  .string()
  .trim()
  .min(1, "Укажите телефон.")
  .max(32, "Телефон слишком длинный.")
  .transform((value) => normalizeRussianPhone(value))
  .refine(
    (value) => value !== null,
    "Введите корректный номер телефона.",
  );

const nullablePhoneSchema = z
  .union([
    z.literal(""),
    z.null(),
    requiredPhoneSchema,
  ])
  .transform((value) =>
    value === "" ? null : value,
  );

const profileBodySchema = z
  .object({
    firstName: nullableString(100),
    lastName: nullableString(100),
    email: z
      .string()
      .trim()
      .email("Введите корректный email.")
      .max(191, "Email слишком длинный.")
      .transform((value) => value.toLowerCase()),
    phone: nullablePhoneSchema,
  })
  .strict();

const passwordBodySchema = z
  .object({
    currentPassword: z
      .string()
      .min(8, "Текущий пароль должен содержать минимум 8 символов.")
      .max(256, "Пароль слишком длинный."),
    newPassword: z
      .string()
      .min(8, "Новый пароль должен содержать минимум 8 символов.")
      .max(256, "Пароль слишком длинный."),
  })
  .strict();

const addressBodySchema = z
  .object({
    title: nullableString(100),
    recipientName: z.string().trim().min(1, "Укажите получателя.").max(150),
    phone: requiredPhoneSchema,
    city: z.string().trim().min(1, "Укажите город.").max(120),
    street: z.string().trim().min(1, "Укажите улицу.").max(180),
    house: z.string().trim().min(1, "Укажите дом.").max(50),
    apartment: nullableString(50),
    entrance: nullableString(50),
    floor: nullableString(50),
    intercom: nullableString(50).optional().default(null),
    comment: nullableString(500),
    isDefault: z.boolean(),
  })
  .strict();

const addressParamsSchema = z
  .object({
    addressId: z.coerce.number().int().positive(),
  })
  .strict();

const orderParamsSchema = z
  .object({
    orderKey: z.string().trim().min(1).max(50),
  })
  .strict();

router.use(requireAuth);

router.get("/profile", getProfile);
router.patch(
  "/profile",
  validate({ body: profileBodySchema }),
  updateProfile,
);

router.patch(
  "/password",
  sensitiveRateLimiter,
  validate({ body: passwordBodySchema }),
  changePassword,
);

router.get("/addresses", getAddresses);
router.post(
  "/addresses",
  validate({ body: addressBodySchema }),
  createAddress,
);
router.patch(
  "/addresses/:addressId",
  validate({
    params: addressParamsSchema,
    body: addressBodySchema,
  }),
  updateAddress,
);
router.delete(
  "/addresses/:addressId",
  validate({ params: addressParamsSchema }),
  deleteAddress,
);

router.get("/orders", getOrders);
router.get(
  "/orders/:orderKey",
  validate({ params: orderParamsSchema }),
  getOrder,
);

router.get("/subscription", getSubscription);

export default router;
