-- Delivery uses the existing DeliveryZone, PickupPoint, DeliverySlot and Order models.
-- Nullable locality supports existing rows; configure it before activating a zone for checkout.
ALTER TABLE "DeliveryZone" ADD COLUMN "locality" VARCHAR(120);
ALTER TABLE "DeliveryZone" ADD COLUMN "freeDeliveryFrom" DECIMAL(12,2);
CREATE UNIQUE INDEX "DeliveryZone_locality_key" ON "DeliveryZone"("locality");
ALTER TABLE "Order" ADD COLUMN "deliveryTermsSnapshot" JSONB;

-- Prevent concurrent OWNER requests from creating case-insensitive duplicate localities.
CREATE UNIQUE INDEX "DeliveryZone_locality_lower_key"
  ON "DeliveryZone" (LOWER(BTRIM("locality")))
  WHERE "locality" IS NOT NULL;
