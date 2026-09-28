import {
  createCustomerReview,
  deleteCustomerReview,
  getCustomerReviewEligibility,
  updateCustomerReview,
  listPublicReviews,
} from "../services/review.service.js";

export async function getPublicReviews(req, res, next) {
  try {
    const reviews = await listPublicReviews(req.validated.query);
    return res.status(200).json({ ok: true, reviews });
  } catch (error) {
    return next(error);
  }
}

export async function getFeaturedReviews(req, res, next) {
  try {
    const reviews = await listPublicReviews({
      page: 1,
      limit: req.validated.query.limit,
      featuredOnly: true,
    });
    return res.status(200).json({ ok: true, reviews: reviews.items });
  } catch (error) {
    return next(error);
  }
}

export async function getReviewEligibility(req, res, next) {
  try {
    const eligibility = await getCustomerReviewEligibility({
      userId: req.user.id,
      productId: req.validated.query.productId,
    });
    return res.status(200).json({ ok: true, eligibility });
  } catch (error) {
    return next(error);
  }
}

export async function postReview(req, res, next) {
  try {
    const review = await createCustomerReview({
      userId: req.user.id,
      productId: req.validated.body.productId,
      rating: req.validated.body.rating,
      text: req.validated.body.text,
    });
    return res.status(201).json({ ok: true, review });
  } catch (error) {
    return next(error);
  }
}

export async function patchReview(req, res, next) {
  try {
    const review = await updateCustomerReview({
      userId: req.user.id,
      reviewId: req.validated.params.reviewId,
      rating: req.validated.body.rating,
      text: req.validated.body.text,
    });
    return res.status(200).json({ ok: true, review });
  } catch (error) {
    return next(error);
  }
}

export async function deleteReview(req, res, next) {
  try {
    await deleteCustomerReview({
      userId: req.user.id,
      reviewId: req.validated.params.reviewId,
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
}
