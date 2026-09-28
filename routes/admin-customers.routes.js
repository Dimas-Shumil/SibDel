import { Router } from "express";
import { z } from "zod";

import {
  getCustomer,
  getCustomers,
  patchCustomerStatus,
  postCustomerNote,
} from "../controllers/admin-customers.controller.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { adminMutationRateLimiter, sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const customerParamsSchema = z
  .object({ customerId: z.coerce.number().int().positive() })
  .strict();

const customerListQuerySchema = z
  .object({
    q: z.string().trim().max(120).optional().default(""),
    status: z.enum(["all", "active", "inactive"]).optional().default("all"),
    purchase: z.enum(["all", "buyers", "no-orders"]).optional().default("all"),
    page: z.coerce.number().int().min(1).max(100000).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(30),
  })
  .strict();

const noteBodySchema = z
  .object({ text: z.string().trim().min(1, "Введите текст заметки.").max(1000) })
  .strict();

const statusBodySchema = z
  .object({
    isActive: z.boolean(),
    reason: z.union([z.string().trim().max(500), z.null()]).optional().transform((value) => value || null),
  })
  .strict();

router.use(adminAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  return next();
});

router.get("/", validate({ query: customerListQuerySchema }), getCustomers);
router.get("/:customerId", validate({ params: customerParamsSchema }), getCustomer);
router.post(
  "/:customerId/notes",
  adminMutationRateLimiter,
  validate({ params: customerParamsSchema, body: noteBodySchema }),
  postCustomerNote,
);
router.patch(
  "/:customerId/status",
  sensitiveRateLimiter,
  requireRoles("OWNER"),
  validate({ params: customerParamsSchema, body: statusBodySchema }),
  patchCustomerStatus,
);

export default router;
