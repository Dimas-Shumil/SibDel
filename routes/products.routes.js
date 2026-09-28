import { Router } from "express";
import { z } from "zod";

import { getProduct } from "../controllers/products.controller.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const productParamsSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(191)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Некорректный slug товара."),
  })
  .strict();

router.get(
  "/:slug",
  validate({
    params: productParamsSchema,
  }),
  getProduct,
);

export default router;
