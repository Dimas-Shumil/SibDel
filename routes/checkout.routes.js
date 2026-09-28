import { Router } from "express";
import { z } from "zod";

import {
  createOrder,
  readCheckout,
} from "../controllers/checkout.controller.js";
import { checkoutRateLimiter } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";
import { normalizeRussianPhone } from "../utils/phone.js";

const router = Router();

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Некорректная дата.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime());
  }, "Некорректная дата.");

const phoneSchema = z
  .string()
  .trim()
  .min(1, "Укажите телефон.")
  .max(32)
  .transform((value) => normalizeRussianPhone(value))
  .refine((value) => value !== null, "Введите корректный номер телефона.");

const checkoutBodySchema = z
  .object({
    idempotencyKey: z.string().uuid("Некорректный ключ оформления."),
    name: z.string().trim().min(2, "Укажите имя.").max(150),
    phone: phoneSchema,
    email: z.string().trim().email("Введите корректный email.").max(191).transform((value) => value.toLowerCase()),
    receiveMethod: z.enum(["delivery", "pickup"]),
    address: z.string().trim().max(240).optional().default(""),
    entrance: z.string().trim().max(20).optional().default(""),
    floor: z.string().trim().max(20).optional().default(""),
    receiveDate: dateSchema,
    receiveSlotId: z.coerce.number().int().positive().nullable().optional().default(null),
    pickupPointId: z.coerce.number().int().positive().nullable().optional().default(null),
    paymentMethod: z.enum(["online", "on-receipt"]),
    comment: z.string().trim().max(500).optional().default(""),
    agreement: z.boolean().refine((value) => value === true, "Необходимо подтвердить согласие."),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.receiveMethod === "delivery" && value.address.length < 5) {
      ctx.addIssue({
        code: "custom",
        path: ["address"],
        message: "Укажите адрес доставки.",
      });
    }

    const today = new Date();
    const todayIso = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, "0"),
      String(today.getDate()).padStart(2, "0"),
    ].join("-");

    if (value.receiveDate < todayIso) {
      ctx.addIssue({
        code: "custom",
        path: ["receiveDate"],
        message: "Дата получения не может быть в прошлом.",
      });
    }
  });

router.get(
  "/",
  validate({
    query: z
      .object({
        date: dateSchema.optional(),
      })
      .strict(),
  }),
  readCheckout,
);

router.post(
  "/",
  checkoutRateLimiter,
  validate({ body: checkoutBodySchema }),
  createOrder,
);

export default router;
