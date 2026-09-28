import { randomUUID } from "node:crypto";

import { connectDatabase, disconnectDatabase, prisma } from "../lib/prisma.js";
import {
  createCustomerReview,
  getCustomerReviewEligibility,
  updateCustomerReview,
  listPublicReviews,
} from "../services/review.service.js";
import {
  listAdminReviews,
  moderateAdminReview,
} from "../services/admin-review.service.js";
import { getReviewStatsMap } from "../services/product.service.js";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
let userId = null;
let categoryId = null;
let productId = null;
let orderId = null;
let reviewId = null;

async function cleanup() {
  if (reviewId) {
    await prisma.review.deleteMany({ where: { id: reviewId } });
    await prisma.adminActivity.deleteMany({ where: { entityType: "Review", entityId: String(reviewId) } });
  }
  if (orderId) await prisma.order.deleteMany({ where: { id: orderId } });
  if (productId) await prisma.product.deleteMany({ where: { id: productId } });
  if (categoryId) await prisma.category.deleteMany({ where: { id: categoryId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId, role: "CUSTOMER" } });
}

try {
  await connectDatabase();

  const user = await prisma.user.create({
    data: {
      email: `review-smoke-${suffix}@example.invalid`,
      phone: `+7998${suffix.slice(0, 7)}`,
      passwordHash: "review-smoke-no-login",
      firstName: "Иван",
      lastName: "Тестов",
      role: "CUSTOMER",
      isActive: true,
    },
  });
  userId = user.id;

  const category = await prisma.category.create({
    data: {
      name: `Reviews Smoke ${suffix}`,
      slug: `reviews-smoke-${suffix}`,
      isActive: true,
      sortOrder: 99999,
    },
  });
  categoryId = category.id;

  const product = await prisma.product.create({
    data: {
      categoryId,
      name: `Review Smoke Product ${suffix}`,
      slug: `review-smoke-product-${suffix}`,
      sku: `REV-SMOKE-${suffix}`.toUpperCase(),
      unit: "PIECE",
      unitLabel: "шт.",
      price: "500.00",
      step: "1.000",
      minQuantity: "1.000",
      stockQuantity: "10.000",
      reservedQuantity: "0.000",
      isActive: true,
      isAvailable: true,
    },
  });
  productId = product.id;

  let blockedWithoutPurchase = false;
  try {
    await createCustomerReview({
      userId,
      productId,
      rating: 5,
      text: "Этот отзыв не должен сохраниться без завершённой покупки.",
    });
  } catch (error) {
    blockedWithoutPurchase = error?.code === "REVIEW_PURCHASE_REQUIRED";
  }
  if (!blockedWithoutPurchase) throw new Error("Review was allowed without a completed purchase.");

  const order = await prisma.order.create({
    data: {
      number: `REVIEW-${suffix}`,
      userId,
      status: "COMPLETED",
      deliveryStatus: "DELIVERED",
      deliveryMethod: "PICKUP",
      paymentMethod: "ON_RECEIPT",
      customerName: "Иван Тестов",
      customerPhone: user.phone,
      customerEmail: user.email,
      subtotal: "500.00",
      total: "500.00",
      completedAt: new Date(),
      items: {
        create: {
          productId,
          productName: product.name,
          sku: product.sku,
          unit: "PIECE",
          quantity: "1.000",
          baseUnitPrice: "500.00",
          unitPrice: "500.00",
          discountTotal: "0.00",
          total: "500.00",
        },
      },
    },
  });
  orderId = order.id;

  const eligibility = await getCustomerReviewEligibility({ userId, productId });
  if (!eligibility.canReview || !eligibility.hasCompletedPurchase || eligibility.review) {
    throw new Error("Eligibility did not recognize the completed purchase.");
  }

  const created = await createCustomerReview({
    userId,
    productId,
    rating: 5,
    text: "Отличный тестовый продукт: вкус, качество и упаковка понравились.",
  });
  reviewId = created.id;

  if (created.status !== "PENDING" || created.authorName !== "Иван Т.") {
    throw new Error("New review status or server-side author name is invalid.");
  }

  const listed = await listAdminReviews({ q: suffix, status: "PENDING", page: 1, limit: 10 });
  if (!listed.items.some((item) => item.id === reviewId)) {
    throw new Error("Pending review is missing from admin moderation list.");
  }

  const approved = await moderateAdminReview({
    reviewId,
    actorId: null,
    input: { status: "APPROVED", isFeatured: true },
  });
  if (approved.status !== "APPROVED" || approved.isFeatured !== true) {
    throw new Error("Admin approval/featured moderation failed.");
  }

  const stats = await getReviewStatsMap([productId]);
  const productRating = stats.get(productId);
  if (!productRating || productRating.count !== 1 || Number(productRating.average) !== 5) {
    throw new Error("Approved review did not affect public product rating.");
  }

  const featuredPublic = await listPublicReviews({ page: 1, limit: 10, featuredOnly: true });
  if (!featuredPublic.items.some((item) => item.id === reviewId)) {
    throw new Error("Approved featured review is missing from public featured feed.");
  }

  const edited = await updateCustomerReview({
    userId,
    reviewId,
    rating: 4,
    text: "Обновил мнение после повторной дегустации: всё ещё очень хороший продукт.",
  });
  if (edited.status !== "PENDING" || edited.isFeatured !== false || edited.rating !== 4) {
    throw new Error("Customer edit did not reset review moderation state.");
  }

  const statsAfterEdit = await getReviewStatsMap([productId]);
  if (statsAfterEdit.has(productId)) {
    throw new Error("Pending edited review still affects public product rating.");
  }
  const publicAfterEdit = await listPublicReviews({ page: 1, limit: 10, featuredOnly: false });
  if (publicAfterEdit.items.some((item) => item.id === reviewId)) {
    throw new Error("Pending edited review is still visible in the public feed.");
  }

  let duplicateBlocked = false;
  try {
    await createCustomerReview({
      userId,
      productId,
      rating: 5,
      text: "Второй отзыв на тот же товар не должен быть разрешён.",
    });
  } catch (error) {
    duplicateBlocked = error?.code === "REVIEW_ALREADY_EXISTS";
  }
  if (!duplicateBlocked) throw new Error("Duplicate customer review was not blocked.");

  await moderateAdminReview({ reviewId, actorId: null, input: { status: "REJECTED" } });
  const final = await prisma.review.findUnique({ where: { id: reviewId } });
  if (!final || final.status !== "REJECTED" || final.isFeatured) {
    throw new Error("Review rejection state is invalid.");
  }

  console.log(`PASS: review #${reviewId}, verified purchase gate, moderation, featured state, rating aggregation and re-moderation after edit work.`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error(`Cleanup warning: ${cleanupError.message}`);
    process.exitCode = 1;
  }
  try {
    await disconnectDatabase();
  } catch {}
}
