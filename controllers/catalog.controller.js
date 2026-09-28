import { getPublicCatalog } from "../services/catalog.service.js";

export async function getCatalog(req, res, next) {
  try {
    const catalog = await getPublicCatalog(req.validated.query);

    return res.status(200).json({
      ok: true,
      ...catalog,
    });
  } catch (error) {
    return next(error);
  }
}
