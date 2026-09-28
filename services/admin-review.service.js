import { prisma } from "../lib/prisma.js";

const ADMIN_REVIEW_INCLUDE = Object.freeze({
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
    },
  },
  user: {
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      isActive: true,
    },
  },
});

function reviewError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

function serializeAdminReview(review) {
  return {
    id: review.id,
    authorName: review.authorName,
    rating: review.rating,
    text: review.text,
    status: review.status,
    isFeatured: review.isFeatured,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    product: review.product,
    user: review.user,
  };
}

export async function listAdminReviews({ q = "", status = "all", rating = "all", featured = "all", page = 1, limit = 30 } = {}) {
  const normalizedQuery = String(q || "").trim();
  const and = [];

  if (normalizedQuery) {
    and.push({
      OR: [
        { authorName: { contains: normalizedQuery, mode: "insensitive" } },
        { text: { contains: normalizedQuery, mode: "insensitive" } },
        { product: { is: { name: { contains: normalizedQuery, mode: "insensitive" } } } },
        { product: { is: { sku: { contains: normalizedQuery, mode: "insensitive" } } } },
        { user: { is: { email: { contains: normalizedQuery, mode: "insensitive" } } } },
        { user: { is: { phone: { contains: normalizedQuery, mode: "insensitive" } } } },
      ],
    });
  }

  if (["PENDING", "APPROVED", "REJECTED"].includes(status)) and.push({ status });
  if (rating !== "all") and.push({ rating: Number(rating) });
  if (featured === "yes") and.push({ isFeatured: true });
  if (featured === "no") and.push({ isFeatured: false });

  const where = and.length ? { AND: and } : {};
  const skip = (page - 1) * limit;

  const total = await prisma.review.count({ where });
  const items = await prisma.review.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip,
    take: limit,
    include: ADMIN_REVIEW_INCLUDE,
  });
  const totalCount = await prisma.review.count();
  const pendingCount = await prisma.review.count({ where: { status: "PENDING" } });
  const approvedCount = await prisma.review.count({ where: { status: "APPROVED" } });
  const rejectedCount = await prisma.review.count({ where: { status: "REJECTED" } });
  const featuredCount = await prisma.review.count({ where: { status: "APPROVED", isFeatured: true } });
  const ratingAggregate = await prisma.review.aggregate({
    where: { status: "APPROVED" },
    _avg: { rating: true },
  });

  return {
    items: items.map(serializeAdminReview),
    metrics: {
      total: totalCount,
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
      featured: featuredCount,
      averageRating: ratingAggregate._avg.rating ? Number(ratingAggregate._avg.rating.toFixed(1)) : null,
    },
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getAdminReview(reviewId) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: ADMIN_REVIEW_INCLUDE,
  });
  return review ? serializeAdminReview(review) : null;
}

export async function moderateAdminReview({ reviewId, input, actorId }) {
  const existing = await prisma.review.findUnique({
    where: { id: reviewId },
    include: ADMIN_REVIEW_INCLUDE,
  });

  if (!existing) throw reviewError("Отзыв не найден.", 404, "REVIEW_NOT_FOUND");

  const nextStatus = input.status ?? existing.status;
  const hasFeaturedInput = Object.hasOwn(input, "isFeatured");
  const requestedFeatured = hasFeaturedInput ? input.isFeatured : existing.isFeatured;
  const nextFeatured = nextStatus === "APPROVED" ? requestedFeatured : false;

  if (hasFeaturedInput && input.isFeatured === true && nextStatus !== "APPROVED") {
    throw reviewError("Избранным можно сделать только опубликованный отзыв.", 400, "REVIEW_FEATURE_REQUIRES_APPROVED");
  }

  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.review.update({
      where: { id: reviewId },
      data: {
        ...(Object.hasOwn(input, "status") ? { status: input.status } : {}),
        isFeatured: nextFeatured,
      },
      include: ADMIN_REVIEW_INCLUDE,
    });

    await transaction.adminActivity.create({
      data: {
        actorId,
        action: "REVIEW_MODERATED",
        entityType: "Review",
        entityId: String(reviewId),
        description: `Отзыв #${reviewId}: ${updated.status}${updated.isFeatured ? ", избранный" : ""}`,
        metadata: {
          previousStatus: existing.status,
          status: updated.status,
          previousFeatured: existing.isFeatured,
          isFeatured: updated.isFeatured,
          productId: updated.product?.id ?? null,
          userId: updated.user?.id ?? null,
        },
      },
    });

    return serializeAdminReview(updated);
  });
}

export async function deleteAdminReview({ reviewId, actorId }) {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    include: ADMIN_REVIEW_INCLUDE,
  });

  if (!review) throw reviewError("Отзыв не найден.", 404, "REVIEW_NOT_FOUND");

  await prisma.$transaction(async (transaction) => {
    await transaction.review.delete({ where: { id: reviewId } });
    await transaction.adminActivity.create({
      data: {
        actorId,
        action: "REVIEW_DELETED",
        entityType: "Review",
        entityId: String(reviewId),
        description: `Удалён отзыв #${reviewId} на «${review.product?.name || "удалённый товар"}»`,
        metadata: {
          status: review.status,
          rating: review.rating,
          productId: review.product?.id ?? null,
          userId: review.user?.id ?? null,
        },
      },
    });
  });

  return true;
}
