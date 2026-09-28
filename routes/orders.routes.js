import { Router } from "express";
import { z } from "zod";

import {
  patchOrderStatus,
  readAdminOrder,
} from "../controllers/orders.controller.js";
import { sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const orderParamsSchema = z
  .object({
    orderKey: z.string().trim().min(1).max(50),
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

router.use(requireRoles("OWNER", "STAFF"));
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
