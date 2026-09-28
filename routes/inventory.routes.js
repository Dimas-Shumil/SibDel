import { Router } from "express";
import { z } from "zod";

import {
  getInventoryItem,
  getInventoryList,
  getInventoryMovements,
  patchInventoryStock,
  postInventoryReceipt,
  postInventoryReturn,
} from "../controllers/inventory.controller.js";
import { sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const productParamsSchema = z
  .object({
    productId: z.coerce.number().int().positive(),
  })
  .strict();

const listQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional().default(""),
    limit: z.coerce.number().int().min(1).max(250).optional().default(100),
  })
  .strict();

const movementQuerySchema = z
  .object({
    productId: z.coerce.number().int().positive().optional(),
    orderId: z.coerce.number().int().positive().optional(),
    type: z
      .enum(["RECEIPT", "RESERVE", "RELEASE", "SALE", "RETURN", "ADJUSTMENT"])
      .optional(),
    limit: z.coerce.number().int().min(1).max(250).optional().default(100),
  })
  .strict();

const quantityBodySchema = z
  .object({
    quantity: z.coerce.number().positive().max(1000000),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

const adjustmentBodySchema = z
  .object({
    stockQuantity: z.coerce.number().min(0).max(1000000),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();

router.use(adminAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  return next();
});

router.get("/", validate({ query: listQuerySchema }), getInventoryList);
router.get(
  "/movements",
  validate({ query: movementQuerySchema }),
  getInventoryMovements,
);
router.get(
  "/products/:productId",
  validate({ params: productParamsSchema }),
  getInventoryItem,
);
router.post(
  "/products/:productId/receipt",
  sensitiveRateLimiter,
  validate({ params: productParamsSchema, body: quantityBodySchema }),
  postInventoryReceipt,
);
router.post(
  "/products/:productId/return",
  sensitiveRateLimiter,
  validate({ params: productParamsSchema, body: quantityBodySchema }),
  postInventoryReturn,
);
router.patch(
  "/products/:productId/stock",
  requireRoles("OWNER"),
  sensitiveRateLimiter,
  validate({ params: productParamsSchema, body: adjustmentBodySchema }),
  patchInventoryStock,
);

export default router;
