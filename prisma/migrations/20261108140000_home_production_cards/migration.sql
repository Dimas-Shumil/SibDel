CREATE TABLE "ProductionCard" (
 "id" SERIAL PRIMARY KEY,
 "name" VARCHAR(200) NOT NULL,
 "imageUrl" VARCHAR(500) NOT NULL,
 "categoryId" INTEGER,
 "pagePath" VARCHAR(200),
 "sortOrder" INTEGER NOT NULL DEFAULT 0,
 "isActive" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "ProductionCard_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ProductionCard_isActive_sortOrder_idx" ON "ProductionCard"("isActive", "sortOrder");
INSERT INTO "ProductionCard" ("name", "imageUrl", "pagePath", "sortOrder", "updatedAt") VALUES
 ('Авторские колбасы', '/site/images/production/avtor-k.webp', '/production.html', 10, CURRENT_TIMESTAMP),
 ('Копчёные деликатесы', '/site/images/production/kopt-del.webp', '/production.html', 20, CURRENT_TIMESTAMP),
 ('Мясные полуфабрикаты', '/site/images/production/meat-pol.webp', '/production.html', 30, CURRENT_TIMESTAMP),
 ('Кулинария и готовые блюда', '/site/images/production/kulinar.webp', '/production.html', 40, CURRENT_TIMESTAMP),
 ('Выпечка', '/site/images/production/bakery.webp', '/production.html', 50, CURRENT_TIMESTAMP);
