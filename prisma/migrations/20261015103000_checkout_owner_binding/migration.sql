-- Nullable for historical orders and subscription-generated orders.
-- Historical checkout keys intentionally cannot be replayed without owner binding.
ALTER TABLE "Order" ADD COLUMN "checkoutOwnerHash" VARCHAR(64);
