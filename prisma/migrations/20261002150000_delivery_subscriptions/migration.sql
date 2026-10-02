-- Convert the legacy plan membership model into a recurring-delivery capable
-- subscription model while retaining SubscriptionPlan compatibility.

CREATE TYPE "SubscriptionDeliveryStatus" AS ENUM ('ORDER_CREATED', 'FAILED');

ALTER TABLE "UserSubscription"
  ALTER COLUMN "planId" DROP NOT NULL,
  ALTER COLUMN "expiresAt" DROP NOT NULL,
  ALTER COLUMN "startsAt" SET DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "addressId" INTEGER,
  ADD COLUMN "addressSnapshot" TEXT,
  ADD COLUMN "intervalDays" INTEGER,
  ADD COLUMN "nextDeliveryAt" DATE,
  ADD COLUMN "pausedAt" TIMESTAMP(3);

ALTER TABLE "UserSubscription" DROP CONSTRAINT IF EXISTS "UserSubscription_planId_fkey";
ALTER TABLE "UserSubscription"
  ADD CONSTRAINT "UserSubscription_planId_fkey"
  FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserSubscription"
  ADD CONSTRAINT "UserSubscription_addressId_fkey"
  FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "UserSubscription_status_expiresAt_idx";

ALTER TABLE "UserSubscription"
  ADD CONSTRAINT "UserSubscription_intervalDays_check"
  CHECK ("intervalDays" IS NULL OR "intervalDays" IN (7, 14, 30));

CREATE TABLE "SubscriptionItem" (
  "id" SERIAL NOT NULL,
  "subscriptionId" INTEGER NOT NULL,
  "productId" INTEGER,
  "productName" VARCHAR(200) NOT NULL,
  "sku" VARCHAR(100) NOT NULL,
  "unit" "ProductUnit" NOT NULL,
  "quantity" DECIMAL(12,3) NOT NULL,
  "lastUnitPrice" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SubscriptionItem_quantity_check" CHECK ("quantity" > 0)
);

CREATE TABLE "SubscriptionEvent" (
  "id" SERIAL NOT NULL,
  "subscriptionId" INTEGER NOT NULL,
  "actorId" INTEGER,
  "action" VARCHAR(100) NOT NULL,
  "source" VARCHAR(32) NOT NULL,
  "description" VARCHAR(1000),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SubscriptionDelivery" (
  "id" SERIAL NOT NULL,
  "subscriptionId" INTEGER NOT NULL,
  "orderId" INTEGER,
  "scheduledFor" DATE NOT NULL,
  "status" "SubscriptionDeliveryStatus" NOT NULL,
  "failureCode" VARCHAR(100),
  "failureMessage" VARCHAR(1000),
  "generatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SubscriptionDelivery_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSubscription_one_live_per_user_key"
  ON "UserSubscription"("userId")
  WHERE "status" IN ('ACTIVE', 'PAUSED') AND "intervalDays" IS NOT NULL;

CREATE INDEX "UserSubscription_status_nextDeliveryAt_idx"
  ON "UserSubscription"("status", "nextDeliveryAt");
CREATE INDEX "UserSubscription_addressId_idx" ON "UserSubscription"("addressId");

CREATE UNIQUE INDEX "SubscriptionItem_subscriptionId_productId_key"
  ON "SubscriptionItem"("subscriptionId", "productId");
CREATE INDEX "SubscriptionItem_productId_idx" ON "SubscriptionItem"("productId");

CREATE INDEX "SubscriptionEvent_subscriptionId_createdAt_idx"
  ON "SubscriptionEvent"("subscriptionId", "createdAt");
CREATE INDEX "SubscriptionEvent_actorId_createdAt_idx"
  ON "SubscriptionEvent"("actorId", "createdAt");
CREATE INDEX "SubscriptionEvent_action_createdAt_idx"
  ON "SubscriptionEvent"("action", "createdAt");

CREATE UNIQUE INDEX "SubscriptionDelivery_orderId_key" ON "SubscriptionDelivery"("orderId");
CREATE UNIQUE INDEX "SubscriptionDelivery_subscriptionId_scheduledFor_key"
  ON "SubscriptionDelivery"("subscriptionId", "scheduledFor");
CREATE INDEX "SubscriptionDelivery_status_scheduledFor_idx"
  ON "SubscriptionDelivery"("status", "scheduledFor");
CREATE INDEX "SubscriptionDelivery_subscriptionId_createdAt_idx"
  ON "SubscriptionDelivery"("subscriptionId", "createdAt");

ALTER TABLE "SubscriptionItem"
  ADD CONSTRAINT "SubscriptionItem_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "UserSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionItem"
  ADD CONSTRAINT "SubscriptionItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubscriptionEvent"
  ADD CONSTRAINT "SubscriptionEvent_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "UserSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionEvent"
  ADD CONSTRAINT "SubscriptionEvent_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SubscriptionDelivery"
  ADD CONSTRAINT "SubscriptionDelivery_subscriptionId_fkey"
  FOREIGN KEY ("subscriptionId") REFERENCES "UserSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SubscriptionDelivery"
  ADD CONSTRAINT "SubscriptionDelivery_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
