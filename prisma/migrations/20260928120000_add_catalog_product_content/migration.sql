-- Extend Product with structured public catalog content.
ALTER TABLE "Product"
ADD COLUMN "unitLabel" VARCHAR(100),
ADD COLUMN "highlights" JSONB,
ADD COLUMN "characteristics" JSONB,
ADD COLUMN "nutrition" JSONB,
ADD COLUMN "isNew" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Product_isNew_isActive_idx" ON "Product"("isNew", "isActive");
