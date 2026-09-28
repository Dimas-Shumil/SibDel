import { Router } from "express";
import { z } from "zod";

import {
  deleteReview,
  getReview,
  getReviews,
  patchReview,
} from "../controllers/admin-reviews.controller.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { adminMutationRateLimiter, sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const listQuery = z.object({
  q: z.string().trim().max(120).optional().default(""),
  status: z.enum(["all", "PENDING", "APPROVED", "REJECTED"]).optional().default("all"),
  rating: z.enum(["all", "1", "2", "3", "4", "5"]).optional().default("all"),
  featured: z.enum(["all", "yes", "no"]).optional().default("all"),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(30),
}).strict();
const params = z.object({ reviewId: z.coerce.number().int().positive() }).strict();
const patchBody = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  isFeatured: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "Передайте хотя бы одно поле для изменения.",
});

router.use(adminAuth);
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  return next();
});

router.get("/", validate({ query: listQuery }), getReviews);
router.get("/:reviewId", validate({ params }), getReview);
router.patch("/:reviewId", adminMutationRateLimiter, validate({ params, body: patchBody }), patchReview);
router.delete("/:reviewId", sensitiveRateLimiter, requireRoles("OWNER"), validate({ params }), deleteReview);

export default router;
