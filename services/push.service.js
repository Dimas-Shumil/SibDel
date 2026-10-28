import { ECDH } from 'node:crypto';
import { endpointHash, safeEndpoint, safePushUrl, safePushImage, pushError } from '../utils/push-policy.js';
import { runSerializable } from '../utils/transactions.js';

export function createPushService(db, config, consent) {
  const enabled = () => { if (!config.enabled) throw pushError('PUSH_DISABLED', 'PUSH пока не включены владельцем.', 503); };
  const marketingEnabled = () => { enabled(); if (!config.marketingEnabled) throw pushError('PUSH_MARKETING_DISABLED', 'Рекламные отправки выключены. Владелец должен указать рекламораспространителя и включить их отдельно.', 503); };
  const audit = (tx, userId, action, id) => tx.adminActivity.create({ data: {
    actorId: userId, action, entityType: 'PushCampaign', entityId: String(id), description: action,
  } });
  return {
    configuration: () => ({ enabled: config.enabled, marketingEnabled: config.marketingEnabled, publicKey: config.enabled ? config.publicKey : null,
      consentVersion: consent.version, consentText: consent.text }),
    async preferences(userId) {
      const pref = await db.pushPreference.findUnique({ where: { userId } });
      return { orders: pref?.orders ?? true, subscriptions: pref?.subscriptions ?? true, marketing: pref?.marketing === true && pref.marketingVersion === consent.version };
    },
    async setPreferences(userId, data) {
      return db.pushPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data,
        select: { orders: true, subscriptions: true, marketing: true } });
    },
    async consent(userId, sessionId, granted, version) {
      if (granted) marketingEnabled();
      if (granted && version !== consent.version) throw pushError('CONSENT_VERSION', 'Обновите страницу и прочитайте актуальное согласие.');
      return runSerializable(db, async (tx) => {
        const previous = await tx.pushPreference.findUnique({ where: { userId } });
        const changed = (previous?.marketing ?? false) !== granted || (granted && previous?.marketingVersion !== consent.version);
        const pref = await tx.pushPreference.upsert({ where: { userId }, create: { userId, marketing: granted, marketingVersion: granted ? consent.version : null }, update: { marketing: granted, marketingVersion: granted ? consent.version : null } });
        if (changed) await tx.pushConsent.create({ data: { userId, sessionId, granted, version: consent.version, text: consent.text } });
        if (!granted) await tx.pushJob.updateMany({ where: { status: 'PENDING', notification: { userId, category: 'MARKETING' } }, data: { status: 'SKIPPED', errorCode: 'CONSENT_REVOKED', finishedAt: new Date() } });
        return { marketing: pref.marketing };
      });
    },
    async subscribe(userId, sessionId, input) {
      enabled();
      safeEndpoint(input.endpoint);
      if (Buffer.from(input.keys.p256dh, 'base64url').length !== 65 || Buffer.from(input.keys.auth, 'base64url').length !== 16) throw pushError('PUSH_KEYS', 'Некорректные ключи устройства.');
      try { ECDH.convertKey(Buffer.from(input.keys.p256dh, 'base64url'), 'prime256v1'); }
      catch { throw pushError('PUSH_KEYS', 'Некорректный ключ устройства.'); }
      const hash = endpointHash(input.endpoint);
      return runSerializable(db, async (tx) => {
        const session = await tx.userSession.findFirst({ where: { id: sessionId, userId, expiresAt: { gt: new Date() }, user: { isActive: true } } });
        if (!session) throw pushError('UNAUTHORIZED', 'Необходимо войти снова.', 401);
        const existing = await tx.pushDevice.findUnique({ where: { endpointHash: hash } });
        if (existing && existing.userId !== userId) throw pushError('PUSH_BOUND', 'Это устройство подключено к другому аккаунту. Отключите его там или используйте отдельный профиль браузера.', 409);
        const count = await tx.pushDevice.count({ where: { userId, disabledAt: null } });
        if ((!existing || existing.disabledAt) && count >= 10) throw pushError('PUSH_LIMIT', 'Подключено слишком много устройств. Отключите неиспользуемые.', 409);
        const data = { userId, sessionId, disabledAt: null, endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth };
        const record = await tx.pushDevice.upsert({ where: { endpointHash: hash }, create: { ...data, endpointHash: hash }, update: data });
        return { id: record.id };
      });
    },
    async devices(userId, sessionId) {
      const devices = await db.pushDevice.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true, sessionId: true, createdAt: true, disabledAt: true } });
      return devices.map(({ sessionId: deviceSession, ...device }) => ({ ...device, current: deviceSession === sessionId }));
    },
    async unsubscribe(userId, id) {
      await db.pushDevice.deleteMany({ where: { id, userId } });
    },
    async opened(userId, id) {
      const now = new Date();
      await db.customerNotification.updateMany({ where: { id, userId, openedAt: null }, data: { openedAt: now, readAt: now } });
    },
    async campaigns(page = 1) {
      const campaigns = await db.pushCampaign.findMany({ orderBy: { id: 'desc' }, take: 20, skip: (page - 1) * 20 });
      const rows = await Promise.all(campaigns.map(async (campaign) => ({ ...campaign,
        recipients: await db.customerNotification.count({ where: { campaignId: campaign.id } }),
        clicks: await db.customerNotification.count({ where: { campaignId: campaign.id, openedAt: { not: null } } }),
        jobs: await db.pushJob.groupBy({ by: ['status'], where: { notification: { campaignId: campaign.id } }, _count: { _all: true } }),
        errors: await db.pushJob.groupBy({ by: ['errorCode'], where: { notification: { campaignId: campaign.id }, errorCode: { not: null } }, _count: { _all: true } }),
      })));
      return { campaigns: rows, page, totalPages: Math.max(1, Math.ceil(await db.pushCampaign.count() / 20)) };
    },
    async createCampaign(userId, input) {
      const data = { requestKey: input.requestKey, title: input.title, body: input.body,
        url: safePushUrl(input.url), imageUrl: safePushImage(input.imageUrl), audience: input.audience };
      return runSerializable(db, async (tx) => {
        const previous = await tx.pushCampaign.findUnique({ where: { requestKey: input.requestKey } });
        if (previous) {
          if (previous.creatorId !== userId || Object.entries(data).some(([k,v]) => previous[k] !== v)) throw pushError('PUSH_KEY_CONFLICT', 'Ключ черновика уже использован для другой рассылки.', 409);
          return previous;
        }
        const campaign = await tx.pushCampaign.create({ data: { ...data, creatorId: userId } });
        await audit(tx, userId, 'PUSH_CAMPAIGN_CREATED', campaign.id);
        return campaign;
      });
    },
    async schedule(userId, id, at) {
      marketingEnabled();
      const scheduledAt = at ? new Date(at) : new Date();
      if (!Number.isFinite(+scheduledAt) || +scheduledAt < Date.now() - 60_000 || +scheduledAt > Date.now() + 90 * 86400_000) throw pushError('PUSH_SCHEDULE', 'Выберите время в пределах следующих 90 дней.');
      return runSerializable(db, async (tx) => {
        const campaign = await tx.pushCampaign.findUnique({ where: { id } });
        if (!campaign) throw pushError('NOT_FOUND', 'Рассылка не найдена.', 404);
        if (campaign.status === 'SCHEDULED') return campaign; // Idempotent repeated submit.
        if (campaign.status !== 'DRAFT') throw pushError('PUSH_STATE', 'Эту рассылку уже нельзя отправить повторно.', 409);
        const near = await tx.pushCampaign.count({ where: { id: { not: id }, status: { notIn: ['DRAFT','CANCELLED'] }, scheduledAt: { gt: new Date(+scheduledAt - 3600_000), lt: new Date(+scheduledAt + 3600_000) } } });
        if (near) throw pushError('PUSH_FREQUENCY', 'Между рассылками должен быть минимум один час.', 409);
        const updated = await tx.pushCampaign.update({ where: { id }, data: { status: 'SCHEDULED', scheduledAt } });
        await audit(tx, userId, 'PUSH_CAMPAIGN_SCHEDULED', id);
        return updated;
      });
    },
    async cancel(userId, id) {
      return runSerializable(db, async (tx) => {
        const updated = await tx.pushCampaign.updateMany({ where: { id, status: { in: ['DRAFT','SCHEDULED'] } }, data: { status: 'CANCELLED' } });
        if (!updated.count) {
          const old = await tx.pushCampaign.findUnique({ where: { id } });
          if (old?.status === 'CANCELLED') return;
          throw pushError('PUSH_STATE', 'Отменить можно только ещё не запущенную рассылку.', 409);
        }
        await audit(tx, userId, 'PUSH_CAMPAIGN_CANCELLED', id);
      });
    },
    async test(userId, sessionId, input) {
      enabled();
      const device = await db.pushDevice.findFirst({ where: { id: input.deviceId, userId, sessionId, disabledAt: null } });
      if (!device) throw pushError('PUSH_DEVICE', 'Сначала подключите своё устройство в этом окне.', 404);
      return runSerializable(db, async (tx) => {
        const cutoff = new Date(Date.now() - 60_000);
        const previous = await tx.customerNotification.findUnique({ where: { eventKey: `test:${userId}:${input.requestKey}` } });
        if (previous) return { id: previous.id };
        const count = await tx.customerNotification.count({ where: { userId, category: 'TEST', createdAt: { gt: cutoff } } });
        if (count) throw pushError('PUSH_FREQUENCY', 'Тест можно отправлять раз в минуту.', 429);
        const notification = await tx.customerNotification.create({ data: {
          userId, eventKey: `test:${userId}:${input.requestKey}`, category: 'TEST',
          title: input.title, body: input.body, url: safePushUrl(input.url), imageUrl: safePushImage(input.imageUrl), queuedAt: new Date(),
        } });
        await tx.pushJob.create({ data: { notificationId: notification.id, deviceId: device.id } });
        return { id: notification.id };
      });
    },
  };
}
