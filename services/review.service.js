import { prisma } from "../lib/prisma.js";

function reviewError(message, statusCode, code, details) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeAuthorName(user) {
  const firstName = String(user?.firstName || "").trim();
  const lastName = String(user?.lastName || "").trim();

  if (firstName && lastName) {
    return `${firstName} ${lastName.slice(0, 1).toUpperCase()}.`;
  }

  if (firstName) return firstName;
  if (lastName) return `${lastName.slice(0, 1).toUpperCase()}.`;
  return "Покупатель";
}

function serializeCustomerReview(review) {
  return {
    id: review.id,
    productId: review.productId,
    authorName: review.authorName,
    rating: review.rating,
    text: review.text,
    status: review.status,
    isFeatured: review.isFeatured,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
}

async function getReviewProduct(client, productId) {
  return client.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      isActive: true,
    },
  });
}

async function findCompletedPurchase(client, userId, productId) {
  return client.orderItem.findFirst({
    where: {
      productId,
      order: {
        userId,
        status: "COMPLETED",
      },
    },
    orderBy: { id: "desc" },
    select: {
      id: true,
      orderId: true,
      order: {
        select: {
          number: true,
          completedAt: true,
        },
      },
    },
  });
}

async function findOwnReview(client, userId, productId) {
  return client.review.findFirst({
    where: { userId, productId },
    orderBy: { id: "asc" },
  });
}

export async function getCustomerReviewEligibility({ userId, productId }) {
  const product = await getReviewProduct(prisma, productId);
  if (!product || !product.isActive) {
    throw reviewError("Товар не найден или недоступен.", 404, "REVIEW_PRODUCT_NOT_FOUND");
  }

  const existing = await findOwnReview(prisma, userId, productId);
  const purchase = await findCompletedPurchase(prisma, userId, productId);

  return {
    product,
    canReview: Boolean(existing || purchase),
    hasCompletedPurchase: Boolean(purchase),
    purchase: purchase
      ? {
          orderId: purchase.orderId,
          orderNumber: purchase.order.number,
          completedAt: purchase.order.completedAt,
        }
      : null,
    review: existing ? serializeCustomerReview(existing) : null,
  };
}

export async function createCustomerReview({ userId, productId, rating, text }) {
  const product = await getReviewProduct(prisma, productId);
  if (!product || !product.isActive) {
    throw reviewError("Товар не найден или недоступен.", 404, "REVIEW_PRODUCT_NOT_FOUND");
  }

  const existing = await findOwnReview(prisma, userId, productId);
  if (existing) {
    throw reviewError("Вы уже оставили отзыв на этот товар.", 409, "REVIEW_ALREADY_EXISTS", {
      reviewId: existing.id,
    });
  }

  const purchase = await findCompletedPurchase(prisma, userId, productId);
  if (!purchase) {
    throw reviewError(
      "Оставить отзыв можно после завершённой покупки этого товара.",
      403,
      "REVIEW_PURCHASE_REQUIRED",
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, firstName: true, lastName: true },
  });

  if (!user) {
    throw reviewError("Пользователь не найден.", 404, "REVIEW_USER_NOT_FOUND");
  }

  try {
    const review = await prisma.review.create({
      data: {
        userId,
        productId,
        authorName: normalizeAuthorName(user),
        rating,
        text,
        status: "PENDING",
        isFeatured: false,
      },
    });

    return serializeCustomerReview(review);
  } catch (error) {
    if (error?.code === "P2002") {
      throw reviewError("Вы уже оставили отзыв на этот товар.", 409, "REVIEW_ALREADY_EXISTS");
    }
    throw error;
  }
}

export async function updateCustomerReview({ userId, reviewId, rating, text }) {
  const existing = await prisma.review.findFirst({
    where: { id: reviewId, userId },
  });

  if (!existing) {
    throw reviewError("Отзыв не найден.", 404, "REVIEW_NOT_FOUND");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true },
  });

  const review = await prisma.review.update({
    where: { id: reviewId },
    data: {
      rating,
      text,
      authorName: normalizeAuthorName(user),
      status: "PENDING",
      isFeatured: false,
    },
  });

  return serializeCustomerReview(review);
}

export async function deleteCustomerReview({ userId, reviewId }) {
  const review = await prisma.review.findFirst({
    where: { id: reviewId, userId },
    select: { id: true },
  });

  if (!review) {
    throw reviewError("Отзыв не найден.", 404, "REVIEW_NOT_FOUND");
  }

  await prisma.review.delete({ where: { id: reviewId } });
  return true;
}

function serializePublicReview(review) {
  return {
    id: review.id,
    authorName: review.authorName,
    rating: review.rating,
    text: review.text,
    isFeatured: review.isFeatured,
    createdAt: review.createdAt,
    product: review.product
      ? {
          id: review.product.id,
          name: review.product.name,
          slug: review.product.slug,
        }
      : null,
  };
}

export async function listPublicReviews({ page = 1, limit = 24, featuredOnly = false } = {}) {
  const where = {
    status: "APPROVED",
    ...(featuredOnly ? { isFeatured: true } : {}),
  };
  const skip = (page - 1) * limit;
  const total = await prisma.review.count({ where });
  const reviews = await prisma.review.findMany({
    where,
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    skip,
    take: limit,
    include: {
      product: {
        select: { id: true, name: true, slug: true },
      },
    },
  });

  return {
    items: reviews.map(serializePublicReview),
    pagination: {
      page,
      limit,
      total,
      pages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}
