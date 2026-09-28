import { Router } from "express";
import { z } from "zod";

import {
  patchOrderStatus,
  readAdminOrder,
  readAdminOrders,
} from "../controllers/orders.controller.js";
import { sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const orderParamsSchema = z
  .object({
    orderKey: z.string().trim().min(1).max(50),
  })
  .strict();

const orderListQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional().default(""),
    status: z
      .enum([
        "NEW",
        "CONFIRMED",
        "ASSEMBLING",
        "READY",
        "DELIVERING",
        "COMPLETED",
        "CANCELLED",
      ])
      .optional(),
    page: z.coerce.number().int().min(1).max(100000).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  })
  .strict();

const statusBodySchema = z
  .object({
    status: z.enum([
      "NEW",
      "CONFIRMED",
      "ASSEMBLING",
      "READY",
      "DELIVERING",
      "COMPLETED",
      "CANCELLED",
    ]),
    reason: z.string().trim().max(500).nullable().optional().default(null),
  })
  .strict();

router.use(adminAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  return next();
});

router.get("/", validate({ query: orderListQuerySchema }), readAdminOrders);
router.get(
  "/:orderKey",
  validate({ params: orderParamsSchema }),
  readAdminOrder,
);
router.patch(
  "/:orderKey/status",
  sensitiveRateLimiter,
  validate({ params: orderParamsSchema, body: statusBodySchema }),
  patchOrderStatus,
);

export default router;
