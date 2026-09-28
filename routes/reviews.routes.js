import { Router } from "express";
import { z } from "zod";

import {
  deleteReview,
  getReviewEligibility,
  getPublicReviews,
  getFeaturedReviews,
  patchReview,
  postReview,
} from "../controllers/reviews.controller.js";
import { requireRoles } from "../middleware/roles.js";
import { sensitiveRateLimiter } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";

const router = Router();

const publicListQuery = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(50).optional().default(24),
}).strict();
const featuredQuery = z.object({
  limit: z.coerce.number().int().min(1).max(20).optional().default(12),
}).strict();

const reviewShape = {
  rating: z.coerce.number().int().min(1).max(5),
  text: z.string().trim().min(10, "Отзыв должен содержать минимум 10 символов.").max(2000),
};
const eligibilityQuery = z.object({ productId: z.coerce.number().int().positive() }).strict();
const createBody = z.object({ productId: z.coerce.number().int().positive(), ...reviewShape }).strict();
const updateBody = z.object(reviewShape).strict();
const params = z.object({ reviewId: z.coerce.number().int().positive() }).strict();

router.get("/", validate({ query: publicListQuery }), getPublicReviews);
router.get("/featured", validate({ query: featuredQuery }), getFeaturedReviews);

router.use(requireRoles("CUSTOMER"));
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  return next();
});

router.get("/eligibility", validate({ query: eligibilityQuery }), getReviewEligibility);
router.post("/", sensitiveRateLimiter, validate({ body: createBody }), postReview);
router.patch("/:reviewId", sensitiveRateLimiter, validate({ params, body: updateBody }), patchReview);
router.delete("/:reviewId", sensitiveRateLimiter, validate({ params }), deleteReview);

export default router;
