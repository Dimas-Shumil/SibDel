import { Router } from "express";
import { z } from "zod";
import { adminAuth } from "../middleware/admin-auth.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";
import { sensitiveRateLimiter } from "../middleware/rate-limit.js";
import {
  getAdminStaff,
  getAdminStaffActivity,
  postAdminStaff,
  patchAdminStaff,
  patchAdminStaffStatus,
  postAdminStaffPassword,
} from "../controllers/admin-staff.controller.js";

const router = Router();
const email = z.string().trim().email("Введите корректный email.").max(191)
  .transform((value) => value.toLowerCase());
const name = z.string().trim().min(1, "Укажите имя.").max(100);
const surname = z.string().trim().max(100);
// An OWNER provisions employees with strong initial passwords. Never return or log them.
const password = z.string().min(12, "Минимум 12 символов.").max(128)
  .regex(/[a-z]/, "Нужна строчная латинская буква.")
  .regex(/[A-Z]/, "Нужна заглавная латинская буква.")
  .regex(/[0-9]/, "Нужна цифра.")
  .regex(/[^A-Za-z0-9]/, "Нужен специальный символ.");
const params = z.object({ employeeId: z.coerce.number().int().positive() }).strict();
const listQuery = z.object({
  q: z.string().trim().max(120).optional().default(""),
  status: z.enum(["all", "active", "inactive"]).optional().default("all"),
}).strict();
const creation = z.object({ email, firstName: name, lastName: surname.optional().default(""), password }).strict();
const editing = z.object({
  email: email.optional(), firstName: name.optional(), lastName: surname.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "Нет данных для изменения.");
const status = z.object({ isActive: z.boolean() }).strict();
const resetPassword = z.object({ password }).strict();

router.use(adminAuth);
router.use(requireRoles("OWNER"));
router.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  return next();
});
router.get("/", validate({ query: listQuery }), getAdminStaff);
router.get("/activity", getAdminStaffActivity);
router.post("/", sensitiveRateLimiter, validate({ body: creation }), postAdminStaff);
router.patch("/:employeeId", sensitiveRateLimiter, validate({ params, body: editing }), patchAdminStaff);
router.patch("/:employeeId/status", sensitiveRateLimiter, validate({ params, body: status }), patchAdminStaffStatus);
router.post("/:employeeId/password", sensitiveRateLimiter, validate({ params, body: resetPassword }), postAdminStaffPassword);

export default router;
