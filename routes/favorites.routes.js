import { Router } from "express";
import { z } from "zod";

import {
  deleteFavorite,
  deleteFavorites,
  putFavorite,
  readFavorites,
} from "../controllers/favorites.controller.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const paramsSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(191)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Некорректный slug товара."),
  })
  .strict();

router.get("/", readFavorites);

router.put(
  "/:slug",
  validate({
    params: paramsSchema,
  }),
  putFavorite,
);

router.delete(
  "/:slug",
  validate({
    params: paramsSchema,
  }),
  deleteFavorite,
);

router.delete("/", deleteFavorites);

export default router;
