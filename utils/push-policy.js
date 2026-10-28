import { createHash } from 'node:crypto';
export function pushError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode, expose: true });
}
export const endpointHash = (endpoint) => createHash('sha256').update(endpoint).digest('hex');
export function safeEndpoint(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { throw pushError('PUSH_ENDPOINT', 'Некорректная PUSH-подписка.'); }
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.port
    || !(allowed.includes(u.hostname) || /^[a-z0-9.-]+\.notify\.windows\.com$/.test(u.hostname))) {
    throw pushError('PUSH_ENDPOINT', 'Сервис PUSH не поддерживается.');
  }
  return endpoint;
}
export function safePushUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) throw pushError('PUSH_URL', 'Выберите внутреннюю ссылку магазина.');
  const u = new URL(value, 'https://sib-del.ru');
  const paths = ['/', '/catalog.html', '/promotions.html', '/product.html', '/subscription.html', '/account', '/account/orders', '/account/order', '/account/subscription'];
  if (u.origin !== 'https://sib-del.ru' || !paths.includes(u.pathname) || value.length > 500) throw pushError('PUSH_URL', 'Эта ссылка недоступна для рассылки.');
  // Only query fields needed by the existing storefront; never auth/reset URLs.
  for (const [key, val] of u.searchParams) if (!['slug','category','q','id','page'].includes(key) || val.length > 191) throw pushError('PUSH_URL', 'Некорректные параметры ссылки.');
  const normalized = u.pathname + u.search + u.hash;
  if (normalized.length > 500) throw pushError('PUSH_URL', 'Ссылка слишком длинная.');
  return normalized;
}
export function safePushImage(value) {
  if (!value) return null;
  if (!/^\/(?:uploads\/products|site\/images)\/[a-zA-Z0-9_./-]+\.(?:png|jpg|jpeg|webp)$/.test(value)
    || value.includes('..') || value.length > 500) throw pushError('PUSH_IMAGE', 'Используйте изображение из товаров или изображений сайта.');
  return value;
}
export function deviceEligible(device, notification, now = new Date()) {
  if (!device || device.disabledAt || device.userId !== notification.userId || !device.user?.isActive
    || !device.session || device.session.userId !== device.userId || device.session.expiresAt <= now) return false;
  if (notification.category === 'TEST') return device.user.role === 'OWNER';
  if (device.user.role !== 'CUSTOMER') return false;
  const prefs = device.user.pushPreference;
  if (notification.category === 'MARKETING') return prefs?.marketing === true;
  if (notification.category === 'ORDER') return prefs?.orders !== false;
  if (notification.category === 'SUBSCRIPTION') return prefs?.subscriptions !== false;
  return false;
}
export function classifyPushFailure(error) {
  const status = Number(error?.statusCode);
  if ([404, 410].includes(status)) return { status: 'FAILED', errorCode: 'EXPIRED_DEVICE', remove: true };
  if (status >= 400 && status < 500) return { status: 'FAILED', errorCode: `HTTP_${status}`, remove: false };
  // Timeout/network/server ambiguity must not cause an automatic duplicate send.
  return { status: 'UNKNOWN', errorCode: Number.isFinite(status) && status >= 500 ? 'PUSH_SERVICE_UNKNOWN' : 'NETWORK_UNKNOWN', remove: false };
}
