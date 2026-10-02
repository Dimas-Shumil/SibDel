import { Router } from "express";
import { z } from "zod";

import {
  cancelSubscription,
  generateDue,
  generateSubscription,
  getSubscription,
  getSubscriptions,
  pauseSubscription,
  resumeSubscription,
} from "../controllers/admin-subscriptions.controller.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { adminMutationRateLimiter, sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();
const listQuery = z.object({
  q: z.string().trim().max(120).optional().default(""),
  status: z.enum(["all", "ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"]).optional().default("all"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
}).strict();
const params = z.object({ subscriptionId: z.coerce.number().int().positive() }).strict();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();
const resumeBody = z.object({ nextDeliveryDate: dateOnly }).strict();
const emptyBody = z.object({}).strict();
const generateDueBody = z.object({ limit: z.coerce.number().int().min(1).max(500).optional().default(100) }).strict();

router.use(adminAuth);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); return next(); });
router.get("/", validate({ query: listQuery }), getSubscriptions);
router.get("/:subscriptionId", validate({ params }), getSubscription);
router.post("/:subscriptionId/pause", adminMutationRateLimiter, validate({ params }), pauseSubscription);
router.post("/:subscriptionId/resume", adminMutationRateLimiter, validate({ params, body: resumeBody }), resumeSubscription);
router.post("/:subscriptionId/cancel", sensitiveRateLimiter, requireRoles("OWNER"), validate({ params }), cancelSubscription);
router.post("/:subscriptionId/generate", sensitiveRateLimiter, requireRoles("OWNER"), validate({ params, body: emptyBody }), generateSubscription);
router.post("/actions/generate-due", sensitiveRateLimiter, requireRoles("OWNER"), validate({ body: generateDueBody }), generateDue);

export default router;
