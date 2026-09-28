import {
  createAdminPromotion,
  deleteAdminPromotion,
  getAdminPromotion,
  getAdminPromotionOptions,
  listAdminPromotions,
  updateAdminPromotion,
} from "../services/promotion.service.js";

function notFound() {
  const error = new Error("Акция не найдена.");
  error.statusCode = 404;
  error.code = "PROMOTION_NOT_FOUND";
  error.expose = true;
  return error;
}

export async function getPromotions(req, res, next) {
  try {
    const promotions = await listAdminPromotions(req.validated.query);
    return res.status(200).json({ ok: true, promotions });
  } catch (error) {
    return next(error);
  }
}

export async function getPromotionOptions(_req, res, next) {
  try {
    const options = await getAdminPromotionOptions();
    return res.status(200).json({ ok: true, options });
  } catch (error) {
    return next(error);
  }
}

export async function getPromotion(req, res, next) {
  try {
    const promotion = await getAdminPromotion(req.validated.params.promotionId);
    if (!promotion) return next(notFound());
    return res.status(200).json({ ok: true, promotion });
  } catch (error) {
    return next(error);
  }
}

export async function postPromotion(req, res, next) {
  try {
    const promotion = await createAdminPromotion({ input: req.validated.body, actorId: req.user.id });
    return res.status(201).json({ ok: true, promotion });
  } catch (error) {
    return next(error);
  }
}

export async function patchPromotion(req, res, next) {
  try {
    const promotion = await updateAdminPromotion({
      promotionId: req.validated.params.promotionId,
      input: req.validated.body,
      actorId: req.user.id,
    });
    return res.status(200).json({ ok: true, promotion });
  } catch (error) {
    return next(error);
  }
}

export async function deletePromotion(req, res, next) {
  try {
    await deleteAdminPromotion({ promotionId: req.validated.params.promotionId, actorId: req.user.id });
    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
}
