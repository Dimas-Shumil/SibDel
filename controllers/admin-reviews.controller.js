import {
  deleteAdminReview,
  getAdminReview,
  listAdminReviews,
  moderateAdminReview,
} from "../services/admin-review.service.js";

function notFound() {
  const error = new Error("Отзыв не найден.");
  error.statusCode = 404;
  error.code = "REVIEW_NOT_FOUND";
  error.expose = true;
  return error;
}

export async function getReviews(req, res, next) {
  try {
    const reviews = await listAdminReviews(req.validated.query);
    return res.status(200).json({ ok: true, reviews });
  } catch (error) {
    return next(error);
  }
}

export async function getReview(req, res, next) {
  try {
    const review = await getAdminReview(req.validated.params.reviewId);
    if (!review) return next(notFound());
    return res.status(200).json({ ok: true, review });
  } catch (error) {
    return next(error);
  }
}

export async function patchReview(req, res, next) {
  try {
    const review = await moderateAdminReview({
      reviewId: req.validated.params.reviewId,
      input: req.validated.body,
      actorId: req.user.id,
    });
    return res.status(200).json({ ok: true, review });
  } catch (error) {
    return next(error);
  }
}

export async function deleteReview(req, res, next) {
  try {
    await deleteAdminReview({
      reviewId: req.validated.params.reviewId,
      actorId: req.user.id,
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
}
