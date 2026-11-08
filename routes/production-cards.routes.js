import { Router } from "express";
import { z } from "zod";
import { saveCatalogImage } from "../services/catalog-image.service.js";
import { adminAuth } from "../middleware/admin-auth.js";
import { requireRoles } from "../middleware/roles.js";
import { adminMutationRateLimiter } from "../middleware/rate-limit.js";
import { productImageUpload } from "../middleware/product-upload.js";
import { validate } from "../middleware/validate.js";
import { listProductionCards, mutateProductionCard, productionCardSchema, productionPages, productionImages } from "../services/production-cards.service.js";

export const productionPublicRouter = Router();
export const productionAdminRouter = Router();
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res)).catch(next);
productionPublicRouter.get("/", wrap(async (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, cards: await listProductionCards(true) });
}));
productionAdminRouter.use(adminAuth, (_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
productionAdminRouter.get("/", wrap(async (_req, res) => res.json({ ok: true, cards: await listProductionCards(), pages: productionPages, images: productionImages })));
productionAdminRouter.use(adminMutationRateLimiter);
productionAdminRouter.post("/image", productImageUpload.single("image"), wrap(async (req, res) => {
  res.status(201).json({ ok: true, imageUrl: await saveCatalogImage(req.file, "production") });
}));
const params = z.object({ id: z.coerce.number().int().positive() }).strict();
productionAdminRouter.post("/", validate({ body: productionCardSchema }), wrap(async (req, res) => res.status(201).json({ ok: true, card: await mutateProductionCard(null, req.validated.body, req.user.id) })));
productionAdminRouter.put("/:id", validate({ params, body: productionCardSchema }), wrap(async (req, res) => res.json({ ok: true, card: await mutateProductionCard(req.validated.params.id, req.validated.body, req.user.id) })));
productionAdminRouter.delete("/:id", requireRoles("OWNER"), validate({ params }), wrap(async (req, res) => res.json({ ok: true, card: await mutateProductionCard(req.validated.params.id, null, req.user.id) })));
