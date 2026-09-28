-- Inventory reservations and stock movement audit trail.
CREATE TYPE "InventoryReservationStatus" AS ENUM ('ACTIVE', 'RELEASED', 'COMMITTED');
CREATE TYPE "InventoryMovementType" AS ENUM ('RECEIPT', 'RESERVE', 'RELEASE', 'SALE', 'RETURN', 'ADJUSTMENT');

ALTER TABLE "Product"
ADD COLUMN "reservedQuantity" DECIMAL(14,3) NOT NULL DEFAULT 0;

ALTER TABLE "Product"
ADD CONSTRAINT "Product_stockQuantity_nonnegative_check"
CHECK ("stockQuantity" IS NULL OR "stockQuantity" >= 0),
ADD CONSTRAINT "Product_reservedQuantity_nonnegative_check"
CHECK ("reservedQuantity" >= 0),
ADD CONSTRAINT "Product_reserved_not_above_stock_check"
CHECK ("stockQuantity" IS NULL OR "reservedQuantity" <= "stockQuantity");

CREATE INDEX "Product_stockQuantity_reservedQuantity_idx"
ON "Product"("stockQuantity", "reservedQuantity");

CREATE TABLE "InventoryReservation" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "orderItemId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "InventoryReservation_quantity_positive_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "InventoryReservation_orderItemId_key" ON "InventoryReservation"("orderItemId");
CREATE INDEX "InventoryReservation_orderId_status_idx" ON "InventoryReservation"("orderId", "status");
CREATE INDEX "InventoryReservation_productId_status_idx" ON "InventoryReservation"("productId", "status");
CREATE INDEX "InventoryReservation_createdAt_idx" ON "InventoryReservation"("createdAt");

CREATE TABLE "InventoryMovement" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "orderItemId" INTEGER,
    "actorId" INTEGER,
    "type" "InventoryMovementType" NOT NULL,
    "onHandDelta" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reservedDelta" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "balanceOnHand" DECIMAL(14,3),
    "balanceReserved" DECIMAL(14,3) NOT NULL,
    "reason" VARCHAR(500),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "InventoryMovement_productId_createdAt_idx" ON "InventoryMovement"("productId", "createdAt");
CREATE INDEX "InventoryMovement_orderId_createdAt_idx" ON "InventoryMovement"("orderId", "createdAt");
CREATE INDEX "InventoryMovement_actorId_createdAt_idx" ON "InventoryMovement"("actorId", "createdAt");
CREATE INDEX "InventoryMovement_type_createdAt_idx" ON "InventoryMovement"("type", "createdAt");

ALTER TABLE "InventoryReservation"
ADD CONSTRAINT "InventoryReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "InventoryReservation_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "InventoryReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement"
ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
ADD CONSTRAINT "InventoryMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "InventoryMovement_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE,
ADD CONSTRAINT "InventoryMovement_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Capture the pre-existing physical balances as the opening inventory ledger.
INSERT INTO "InventoryMovement" (
    "productId",
    "type",
    "onHandDelta",
    "reservedDelta",
    "balanceOnHand",
    "balanceReserved",
    "reason",
    "createdAt"
)
SELECT
    "id",
    'ADJUSTMENT'::"InventoryMovementType",
    "stockQuantity",
    0,
    "stockQuantity",
    0,
    'Начальный остаток при включении складского учёта',
    CURRENT_TIMESTAMP
FROM "Product"
WHERE "stockQuantity" IS NOT NULL;
