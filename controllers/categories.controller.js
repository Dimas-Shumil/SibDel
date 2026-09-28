import { listPublicCategories } from "../services/category.service.js";

export async function getCategories(_req, res, next) {
  try {
    const categories = await listPublicCategories();

    return res.status(200).json({
      ok: true,
      categories,
    });
  } catch (error) {
    return next(error);
  }
}
