BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
-- CreateTable
CREATE TABLE "PushPreference" (
    "userId" INTEGER NOT NULL,
    "orders" BOOLEAN NOT NULL DEFAULT true,
    "subscriptions" BOOLEAN NOT NULL DEFAULT true,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "marketingVersion" VARCHAR(50),
    "lastMarketingAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushPreference_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "PushConsent" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "version" VARCHAR(50) NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "endpointHash" VARCHAR(64) NOT NULL,
    "endpoint" VARCHAR(2048) NOT NULL,
    "p256dh" VARCHAR(100) NOT NULL,
    "auth" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushCampaign" (
    "id" SERIAL NOT NULL,
    "requestKey" VARCHAR(64) NOT NULL,
    "creatorId" INTEGER,
    "title" VARCHAR(80) NOT NULL,
    "body" VARCHAR(240) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "imageUrl" VARCHAR(500),
    "audience" VARCHAR(30) NOT NULL DEFAULT 'ALL',
    "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "cursorUserId" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNotification" (
    "id" SERIAL NOT NULL,
    "eventKey" VARCHAR(191) NOT NULL,
    "userId" INTEGER NOT NULL,
    "campaignId" INTEGER,
    "category" VARCHAR(30) NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "body" VARCHAR(240) NOT NULL,
    "url" VARCHAR(500) NOT NULL,
    "imageUrl" VARCHAR(500),
    "queuedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "CustomerNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushJob" (
    "id" SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "deviceId" INTEGER,
    "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "attemptedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "errorCode" VARCHAR(50),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscriptionState" (
    "subscriptionId" INTEGER NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "PushSubscriptionState_pkey" PRIMARY KEY ("subscriptionId")
);

-- CreateIndex
CREATE INDEX "PushConsent_userId_createdAt_idx" ON "PushConsent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_endpointHash_key" ON "PushDevice"("endpointHash");

-- CreateIndex
CREATE INDEX "PushDevice_userId_idx" ON "PushDevice"("userId");

-- CreateIndex
CREATE INDEX "PushDevice_sessionId_idx" ON "PushDevice"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "PushCampaign_requestKey_key" ON "PushCampaign"("requestKey");

-- CreateIndex
CREATE INDEX "PushCampaign_status_scheduledAt_idx" ON "PushCampaign"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerNotification_eventKey_key" ON "CustomerNotification"("eventKey");

-- CreateIndex
CREATE INDEX "CustomerNotification_userId_createdAt_idx" ON "CustomerNotification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerNotification_queuedAt_id_idx" ON "CustomerNotification"("queuedAt", "id");

-- CreateIndex
CREATE INDEX "CustomerNotification_campaignId_idx" ON "CustomerNotification"("campaignId");

-- CreateIndex
CREATE INDEX "PushJob_status_id_idx" ON "PushJob"("status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "PushJob_notificationId_deviceId_key" ON "PushJob"("notificationId", "deviceId");

-- AddForeignKey
ALTER TABLE "PushPreference" ADD CONSTRAINT "PushPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushConsent" ADD CONSTRAINT "PushConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushDevice" ADD CONSTRAINT "PushDevice_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushCampaign" ADD CONSTRAINT "PushCampaign_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "PushCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushJob" ADD CONSTRAINT "PushJob_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "CustomerNotification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushJob" ADD CONSTRAINT "PushJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "PushDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscriptionState" ADD CONSTRAINT "PushSubscriptionState_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "UserSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "PushCampaign" ADD CONSTRAINT "PushCampaign_status_check" CHECK ("status" IN ('DRAFT','SCHEDULED','PROCESSING','QUEUED','COMPLETED','CANCELLED'));
ALTER TABLE "PushCampaign" ADD CONSTRAINT "PushCampaign_audience_check" CHECK ("audience" IN ('ALL','SUBSCRIBERS'));
ALTER TABLE "CustomerNotification" ADD CONSTRAINT "CustomerNotification_category_check" CHECK ("category" IN ('ORDER','SUBSCRIPTION','MARKETING','TEST'));
ALTER TABLE "PushJob" ADD CONSTRAINT "PushJob_status_check" CHECK ("status" IN ('PENDING','SENDING','ACCEPTED','FAILED','UNKNOWN','SKIPPED'));

-- Transactional outbox. No backfill or notification of historic orders.
CREATE FUNCTION sibdel_order_push_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE label text;
BEGIN
  IF NEW."userId" IS NULL OR NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW."userId" AND role='CUSTOMER') THEN RETURN NEW; END IF;
  IF TG_OP='UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  label := CASE NEW.status::text
    WHEN 'NEW' THEN 'Заказ оформлен' WHEN 'CONFIRMED' THEN 'Заказ подтверждён'
    WHEN 'ASSEMBLING' THEN 'Заказ собирается'
    WHEN 'READY' THEN CASE WHEN NEW."deliveryMethod"='PICKUP' THEN 'Заказ готов к самовывозу' ELSE 'Заказ подготовлен' END
    WHEN 'DELIVERING' THEN 'Заказ передан в доставку'
    WHEN 'COMPLETED' THEN 'Заказ завершён' WHEN 'CANCELLED' THEN 'Заказ отменён' ELSE NULL END;
  IF label IS NOT NULL THEN
    INSERT INTO "CustomerNotification" ("eventKey","userId",category,title,body,url)
    VALUES ('order:'||NEW.id||':'||NEW.status::text, NEW."userId", 'ORDER',label,
      'Подробности доступны в личном кабинете.', '/account/order?id='||NEW.id)
    ON CONFLICT ("eventKey") DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sibdel_order_push_insert AFTER INSERT ON "Order" FOR EACH ROW EXECUTE FUNCTION sibdel_order_push_event();
CREATE TRIGGER sibdel_order_push_update AFTER UPDATE OF status ON "Order" FOR EACH ROW EXECUTE FUNCTION sibdel_order_push_event();

CREATE FUNCTION sibdel_subscription_push_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE recipient integer; fingerprint text; revision integer; event_key text;
BEGIN
  IF NEW.action NOT IN ('SUBSCRIPTION_CREATED','SUBSCRIPTION_UPDATED','SUBSCRIPTION_PAUSED','SUBSCRIPTION_RESUMED','SUBSCRIPTION_CANCELLED','SUBSCRIPTION_ORDER_FAILED') THEN RETURN NEW; END IF;
  SELECT "userId" INTO recipient FROM "UserSubscription" WHERE id=NEW."subscriptionId";
  IF recipient IS NOT NULL THEN
    IF NEW.action='SUBSCRIPTION_ORDER_FAILED' THEN
      event_key := 'subscription-failure:'||NEW."subscriptionId"||':'||COALESCE(NEW.metadata->>'scheduledFor', NEW.id::text)||':'||COALESCE(NEW.metadata->>'code','unknown');
    ELSE
      -- Stable state, excluding timestamps/row IDs changed by no-op PATCHes.
      SELECT md5(jsonb_build_object('status',s.status,'interval',s."intervalDays",'next',s."nextDeliveryAt",
        'address',s."addressId",'snapshot',s."addressSnapshot",'paused',s."pausedAt",'cancelled',s."cancelledAt",
        'items',(SELECT jsonb_agg(jsonb_build_object('product',i."productId",'quantity',i.quantity,'price',i."lastUnitPrice") ORDER BY i."productId") FROM "SubscriptionItem" i WHERE i."subscriptionId"=s.id))::text)
      INTO fingerprint FROM "UserSubscription" s WHERE s.id=NEW."subscriptionId";
      INSERT INTO "PushSubscriptionState" ("subscriptionId",fingerprint,revision)
      VALUES (NEW."subscriptionId",fingerprint,1)
      ON CONFLICT ("subscriptionId") DO UPDATE SET fingerprint=EXCLUDED.fingerprint, revision="PushSubscriptionState".revision+1
      WHERE "PushSubscriptionState".fingerprint IS DISTINCT FROM EXCLUDED.fingerprint
      RETURNING "PushSubscriptionState".revision INTO revision;
      IF revision IS NULL THEN RETURN NEW; END IF;
      event_key := 'subscription:'||NEW."subscriptionId"||':'||revision;
    END IF;
    INSERT INTO "CustomerNotification" ("eventKey","userId",category,title,body,url)
    VALUES (event_key, recipient, 'SUBSCRIPTION',
      CASE WHEN NEW.action='SUBSCRIPTION_ORDER_FAILED' THEN 'Подписка требует внимания' ELSE 'Изменения подписки' END,
      'Проверьте актуальные условия в личном кабинете.', '/account/subscription')
    ON CONFLICT ("eventKey") DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sibdel_subscription_push_insert AFTER INSERT ON "SubscriptionEvent" FOR EACH ROW EXECUTE FUNCTION sibdel_subscription_push_event();
COMMIT;
