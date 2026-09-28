import { Router } from "express";
import { z } from "zod";

import {
  adminDashboard,
  adminLogin,
  adminLogout,
  adminMe,
} from "../controllers/admin.controller.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { authRateLimiter } from "../middleware/rate-limit.js";
import { validate } from "../middleware/validate.js";

const router = Router();

router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  return next();
});

const loginBodySchema = z
  .object({
    email: z
      .string()
      .trim()
      .email("Введите корректный email.")
      .max(191, "Email слишком длинный.")
      .transform((value) => value.toLowerCase()),
    password: z
      .string()
      .min(1, "Введите пароль.")
      .max(256, "Пароль слишком длинный."),
  })
  .strict();

router.post(
  "/login",
  authRateLimiter,
  validate({ body: loginBodySchema }),
  adminLogin,
);

router.get("/me", adminAuth, adminMe);
router.get("/dashboard", adminAuth, adminDashboard);
router.post("/logout", adminAuth, adminLogout);

export default router;
