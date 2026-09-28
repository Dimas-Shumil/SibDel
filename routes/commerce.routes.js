import { Router } from "express";

import { getCommerceState } from "../controllers/commerce.controller.js";

const router = Router();

router.get("/", getCommerceState);

export default router;
