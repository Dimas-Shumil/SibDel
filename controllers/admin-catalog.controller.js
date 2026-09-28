import {
  createAdminCategory,
  createAdminProduct,
  deleteAdminProductImage,
  deleteOrDeactivateCategory,
  getAdminProduct,
  listAdminCategories,
  listAdminProducts,
  reorderAdminProductImages,
  updateAdminCategory,
  updateAdminProduct,
  updateAdminProductImage,
  uploadAdminProductImages,
} from "../services/admin-catalog.service.js";

function requestContext(req) {
  return {
    actorId: req.user?.id ?? null,
    ipAddress: typeof req.ip === "string" ? req.ip : null,
    userAgent: typeof req.get("user-agent") === "string" ? req.get("user-agent").slice(0, 1000) : null,
  };
}

export async function getProducts(req, res, next) {
  try {
    const result = await listAdminProducts(req.validated?.query ?? {});
    return res.status(200).json({ ok: true, products: result.items, pagination: result.pagination });
  } catch (error) {
    return next(error);
  }
}

export async function getProduct(req, res, next) {
  try {
    const product = await getAdminProduct(req.validated.params.productId);
    if (!product) {
      const error = new Error("Товар не найден.");
      error.statusCode = 404;
      error.code = "PRODUCT_NOT_FOUND";
      error.expose = true;
      return next(error);
    }
    return res.status(200).json({ ok: true, product });
  } catch (error) {
    return next(error);
  }
}

export async function postProduct(req, res, next) {
  try {
    const product = await createAdminProduct(req.validated.body, requestContext(req));
    return res.status(201).json({ ok: true, product });
  } catch (error) {
    return next(error);
  }
}

export async function patchProduct(req, res, next) {
  try {
    const product = await updateAdminProduct(
      req.validated.params.productId,
      req.validated.body,
      requestContext(req),
    );
    return res.status(200).json({ ok: true, product });
  } catch (error) {
    return next(error);
  }
}

export async function getCategories(req, res, next) {
  try {
    const categories = await listAdminCategories(req.validated?.query ?? {});
    return res.status(200).json({ ok: true, categories });
  } catch (error) {
    return next(error);
  }
}

export async function postCategory(req, res, next) {
  try {
    const category = await createAdminCategory(req.validated.body, requestContext(req));
    return res.status(201).json({ ok: true, category });
  } catch (error) {
    return next(error);
  }
}

export async function patchCategory(req, res, next) {
  try {
    const category = await updateAdminCategory(
      req.validated.params.categoryId,
      req.validated.body,
      requestContext(req),
    );
    return res.status(200).json({ ok: true, category });
  } catch (error) {
    return next(error);
  }
}

export async function deleteCategory(req, res, next) {
  try {
    const result = await deleteOrDeactivateCategory(
      req.validated.params.categoryId,
      requestContext(req),
    );
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    return next(error);
  }
}

export async function postProductImages(req, res, next) {
  try {
    const images = await uploadAdminProductImages(
      req.validated.params.productId,
      req.files,
      requestContext(req),
    );
    return res.status(201).json({ ok: true, images });
  } catch (error) {
    return next(error);
  }
}

export async function patchProductImage(req, res, next) {
  try {
    const image = await updateAdminProductImage(
      req.validated.params.productId,
      req.validated.params.imageId,
      req.validated.body,
      requestContext(req),
    );
    return res.status(200).json({ ok: true, image });
  } catch (error) {
    return next(error);
  }
}

export async function putProductImageOrder(req, res, next) {
  try {
    const product = await reorderAdminProductImages(
      req.validated.params.productId,
      req.validated.body.imageIds,
      requestContext(req),
    );
    return res.status(200).json({ ok: true, product });
  } catch (error) {
    return next(error);
  }
}

export async function deleteProductImage(req, res, next) {
  try {
    await deleteAdminProductImage(
      req.validated.params.productId,
      req.validated.params.imageId,
      requestContext(req),
    );
    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
}
