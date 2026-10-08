import { Router } from "express";
import { z } from "zod";
import { adminDeliveryList, saveAdminDeliveryZone, saveAdminPickupPoint, saveAdminDeliverySlot } from "../controllers/delivery.controller.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { adminMutationRateLimiter } from "../middleware/rate-limit.js";
import { requireRoles } from "../middleware/roles.js";
import { validate } from "../middleware/validate.js";

const router = Router();
const money = z.number().finite().min(0).max(1000000000);
const nullableMoney = money.nullable();
const id = z.object({ id: z.coerce.number().int().positive() }).strict();
const zoneFields = {
  name: z.string().trim().min(2).max(150),
  locality: z.string().trim().min(2).max(120).nullable(),
  description: z.string().trim().max(2000).nullable(),
  deliveryPrice: money,
  minOrderAmount: nullableMoney,
  freeDeliveryFrom: nullableMoney,
  sortOrder: z.number().int().min(0).max(10000),
  isActive: z.boolean(),
};
const pointFields = {
  name: z.string().trim().min(2).max(150),
  address: z.string().trim().min(5).max(300),
  phone: z.string().trim().max(32).nullable(),
  workingHours: z.string().trim().max(500).nullable(),
  sortOrder: z.number().int().min(0).max(10000),
  isActive: z.boolean(),
};
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Некорректная дата.");
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const slotFields = {
  date: dateOnly,
  startTime: time,
  endTime: time,
  capacity: z.number().int().positive().max(100000).nullable(),
  isActive: z.boolean(),
};
function schema(fields, partial = false) {
  const result = z.object(fields);
  return (partial ? result.partial() : result).strict().refine((value) => Object.keys(value).length > 0, "Укажите поля для изменения.");
}
const slotCreate = schema(slotFields).refine((v) => v.startTime < v.endTime, { path: ["endTime"], message: "Конец интервала должен быть позже начала." });
const slotPatch = schema(slotFields, true); // cross-field checked after DB merge in service
router.use(adminAuth);
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.get("/", adminDeliveryList);
router.post("/zones", requireRoles("OWNER"), adminMutationRateLimiter, validate({ body: schema(zoneFields) }), saveAdminDeliveryZone);
router.patch("/zones/:id", requireRoles("OWNER"), adminMutationRateLimiter, validate({ params: id, body: schema(zoneFields, true) }), saveAdminDeliveryZone);
router.post("/pickup-points", requireRoles("OWNER"), adminMutationRateLimiter, validate({ body: schema(pointFields) }), saveAdminPickupPoint);
router.patch("/pickup-points/:id", requireRoles("OWNER"), adminMutationRateLimiter, validate({ params: id, body: schema(pointFields, true) }), saveAdminPickupPoint);
router.post("/slots", requireRoles("OWNER"), adminMutationRateLimiter, validate({ body: slotCreate }), saveAdminDeliverySlot);
router.patch("/slots/:id", requireRoles("OWNER"), adminMutationRateLimiter, validate({ params: id, body: slotPatch }), saveAdminDeliverySlot);
export default router;
