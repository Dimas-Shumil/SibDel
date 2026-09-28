import { Router } from "express";
import { z } from "zod";

import {
  addItem,
  deleteCart,
  deleteItem,
  readCart,
  updateItemQuantity,
} from "../controllers/cart.controller.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(191)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Некорректный slug товара.");

const quantitySchema = z.coerce
  .number()
  .finite()
  .min(0)
  .max(100000);

router.get("/", readCart);

router.post(
  "/items",
  validate({
    body: z
      .object({
        slug: slugSchema,
        quantity: quantitySchema.refine((value) => value > 0, "Количество должно быть больше нуля."),
      })
      .strict(),
  }),
  addItem,
);

router.patch(
  "/items/:slug",
  validate({
    params: z.object({ slug: slugSchema }).strict(),
    body: z.object({ quantity: quantitySchema }).strict(),
  }),
  updateItemQuantity,
);

router.delete(
  "/items/:slug",
  validate({
    params: z.object({ slug: slugSchema }).strict(),
  }),
  deleteItem,
);

router.delete("/", deleteCart);

export default router;
