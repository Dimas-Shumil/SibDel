-- One registered customer can keep only one review per product.
-- Review.userId / productId stay nullable to preserve historical reviews when
-- related records are removed, therefore this invariant is a partial index.
CREATE UNIQUE INDEX "Review_registered_user_product_key"
ON "Review"("userId", "productId")
WHERE "userId" IS NOT NULL AND "productId" IS NOT NULL;

-- Keep the database invariant aligned with API validation.
ALTER TABLE "Review"
ADD CONSTRAINT "Review_rating_check"
CHECK ("rating" >= 1 AND "rating" <= 5);
