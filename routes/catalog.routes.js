import { Router } from "express";
import { catalogQuerySchema } from "../utils/catalog-query.js";

import { getCatalog } from "../controllers/catalog.controller.js";
import { validate } from "../middleware/validate.js";

const router = Router();


router.get(
  "/",
  validate({
    query: catalogQuerySchema,
  }),
  getCatalog,
);

export default router;
