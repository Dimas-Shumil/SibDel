import { getPublicProductBySlug } from "../services/product.service.js";

function createProductNotFoundError() {
  const error = new Error("Товар не найден.");
  error.statusCode = 404;
  error.code = "PRODUCT_NOT_FOUND";
  error.expose = true;
  return error;
}

export async function getProduct(req, res, next) {
  try {
    const product = await getPublicProductBySlug(req.validated.params.slug);

    if (!product) {
      return next(createProductNotFoundError());
    }

    return res.status(200).json({
      ok: true,
      product,
    });
  } catch (error) {
    return next(error);
  }
}
