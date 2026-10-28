import { pushError, safePushUrl, safePushImage } from '../utils/push-policy.js';

const categories = ['ORDER', 'SUBSCRIPTION', 'MARKETING'];
const visible = (userId) => ({ userId, category: { in: categories } });
const select = {
  id: true, category: true, title: true, body: true, url: true,
  imageUrl: true, createdAt: true, readAt: true,
};

function publicNotification(item) {
  // Protect links even if an older integration has stored unsafe content.
  let url = '/account', imageUrl = null;
  try { url = safePushUrl(item.url); } catch { /* Fall back to the account. */ }
  try { imageUrl = safePushImage(item.imageUrl); } catch { /* Omit unsafe images. */ }
  return { ...item, url, imageUrl };
}

export function createAccountNotificationService(db) {
  return {
    async unreadCount(userId) {
      return db.customerNotification.count({ where: { ...visible(userId), readAt: null } });
    },
    async list(userId, { before, category, unread = false, limit = 20 } = {}) {
      // A single snapshot keeps the badge, list and mark-all boundary consistent.
      return db.$transaction(async (tx) => {
        const where = {
          ...visible(userId),
          ...(before ? { id: { lt: before } } : {}),
          ...(category ? { category } : {}),
          ...(unread ? { readAt: null } : {}),
        };
        const rows = await tx.customerNotification.findMany({ where, select, orderBy: { id: 'desc' }, take: limit + 1 });
        const latest = await tx.customerNotification.findFirst({ where: visible(userId), select: { id: true }, orderBy: { id: 'desc' } });
        const unreadCount = await tx.customerNotification.count({ where: { ...visible(userId), readAt: null } });
        const items = rows.slice(0, limit).map(publicNotification);
        return {
          notifications: items, unreadCount, throughId: latest?.id ?? null,
          nextCursor: rows.length > limit ? items.at(-1).id : null,
        };
      }, { isolationLevel: 'RepeatableRead' });
    },
    async markRead(userId, id) {
      // Both the write and existence check are scoped to this customer.
      await db.customerNotification.updateMany({
        where: { ...visible(userId), id, readAt: null }, data: { readAt: new Date() },
      });
      const item = await db.customerNotification.findFirst({ where: { ...visible(userId), id }, select: { id: true, readAt: true } });
      if (!item) throw pushError('NOTIFICATION_NOT_FOUND', 'Уведомление не найдено.', 404);
      // Reading the inbox is not a measured PUSH click; openedAt is untouched.
      return item;
    },
    async markAllRead(userId, throughId) {
      const result = await db.customerNotification.updateMany({
        where: { ...visible(userId), id: { lte: throughId }, readAt: null }, data: { readAt: new Date() },
      });
      return result.count;
    },
  };
}
