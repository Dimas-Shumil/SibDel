-- Checkout/order creation metadata and idempotency.
CREATE TYPE "PaymentMethod" AS ENUM ('ONLINE', 'ON_RECEIPT');

ALTER TABLE "Order"
ADD COLUMN "checkoutKey" VARCHAR(64),
ADD COLUMN "paymentMethod" "PaymentMethod",
ADD COLUMN "requestedReceiveDate" DATE,
ADD COLUMN "requestedTimeWindow" VARCHAR(100),
ADD COLUMN "deliveryPriceConfirmed" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "Order_checkoutKey_key" ON "Order"("checkoutKey");
