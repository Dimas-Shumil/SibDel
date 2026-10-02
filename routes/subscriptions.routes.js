import { Router } from "express";
import { z } from "zod";

import {
  cancelSubscription,
  createSubscription,
  getMySubscription,
  getMySubscriptionOptions,
  pauseSubscription,
  resumeSubscription,
  updateSubscription,
} from "../controllers/subscriptions.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Используйте формат даты ГГГГ-ММ-ДД.");
const item = z.object({
  productId: z.coerce.number().int().positive(),
  quantity: z.coerce.number().positive().max(999999),
}).strict();
const createBody = z.object({
  addressId: z.coerce.number().int().positive(),
  intervalDays: z.coerce.number().int().refine((value) => [7, 14, 30].includes(value), "Периодичность должна быть 7, 14 или 30 дней."),
  nextDeliveryDate: dateOnly,
  items: z.array(item).min(1).max(30),
}).strict();
const updateBody = z.object({
  addressId: z.coerce.number().int().positive().optional(),
  intervalDays: z.coerce.number().int().refine((value) => [7, 14, 30].includes(value), "Периодичность должна быть 7, 14 или 30 дней.").optional(),
  nextDeliveryDate: dateOnly.optional(),
  items: z.array(item).min(1).max(30).optional(),
}).strict().refine((value) => Object.keys(value).length > 0, { message: "Передайте хотя бы одно изменение." });
const resumeBody = z.object({ nextDeliveryDate: dateOnly.optional() }).strict();

router.use(requireAuth, requireRoles("CUSTOMER"));
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); return next(); });

router.get("/me", getMySubscription);
router.get("/options", getMySubscriptionOptions);
router.post("/", sensitiveRateLimiter, validate({ body: createBody }), createSubscription);
router.patch("/me", validate({ body: updateBody }), updateSubscription);
router.post("/me/pause", pauseSubscription);
router.post("/me/resume", validate({ body: resumeBody }), resumeSubscription);
router.post("/me/cancel", sensitiveRateLimiter, cancelSubscription);

export default router;
