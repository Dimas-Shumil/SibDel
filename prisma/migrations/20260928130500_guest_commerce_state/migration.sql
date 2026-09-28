-- One persistent cart per authenticated user. PostgreSQL permits multiple NULLs
-- in a unique index, so guest carts can still be keyed independently by sessionId.
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

-- Guest favorites are intentionally isolated from authenticated favorites.
-- sessionId stores only SHA-256 of the opaque HttpOnly guest token.
CREATE TABLE "GuestFavorite" (
    "id" SERIAL NOT NULL,
    "sessionId" VARCHAR(64) NOT NULL,
    "productId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuestFavorite_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GuestFavorite_sessionId_idx" ON "GuestFavorite"("sessionId");
CREATE INDEX "GuestFavorite_productId_idx" ON "GuestFavorite"("productId");
CREATE UNIQUE INDEX "GuestFavorite_sessionId_productId_key"
    ON "GuestFavorite"("sessionId", "productId");

ALTER TABLE "GuestFavorite"
    ADD CONSTRAINT "GuestFavorite_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
