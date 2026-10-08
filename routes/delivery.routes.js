import { Router } from "express";
import { publicDeliveryZones } from "../controllers/delivery.controller.js";
const router = Router();
router.get("/zones", publicDeliveryZones);
export default router;
