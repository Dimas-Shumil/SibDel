import { deliveryConfig } from '../config/delivery.js';

export function deliveryError(
  message,
  statusCode = 400,
  code = 'INVALID_DELIVERY',
) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

export function moneyToKopecks(amount) {
  if (amount === null || amount === undefined || amount === '') return null;
  const value = Number(amount?.toString?.() ?? amount);
  if (
    !Number.isFinite(value) ||
    value < 0 ||
    value > deliveryConfig.maxPriceKopecks / 100
  ) {
    throw deliveryError('Некорректная денежная сумма.', 422, 'INVALID_AMOUNT');
  }
  return Math.round(value * 100);
}

export function kopecksToRubles(kopecks) {
  return Number((kopecks / 100).toFixed(2));
}

export function normalizeLocality(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е')
    .replace(/\s+/g, ' ');
}

// Address is a declared customer address, not verified coordinates. Never infer
// a courier tariff from untrusted text or accept a client-specified amount.
export function priceDeliveryZone({ zone, merchandiseTotal }) {
  const payableCents = moneyToKopecks(merchandiseTotal);
  if (payableCents === null)
    throw deliveryError(
      'Не удалось рассчитать корзину.',
      409,
      'CART_AMOUNT_UNAVAILABLE',
    );
  if (!zone?.isActive || !String(zone.locality || '').trim()) {
    throw deliveryError(
      'Доставка в выбранный населённый пункт сейчас недоступна.',
      409,
      'DELIVERY_ZONE_UNAVAILABLE',
    );
  }
  const minimum = moneyToKopecks(zone.minOrderAmount);
  if (minimum !== null && payableCents < minimum) {
    throw deliveryError(
      `Минимальная сумма заказа для «${zone.name}» — ${kopecksToRubles(minimum)} ₽.`,
      409,
      'DELIVERY_MINIMUM_NOT_MET',
    );
  }
  const tariffCents = moneyToKopecks(zone.deliveryPrice);
  const threshold = moneyToKopecks(zone.freeDeliveryFrom);
  const free = threshold !== null && payableCents >= threshold;
  const priceCents = free ? 0 : tariffCents;
  return {
    deliveryPrice: kopecksToRubles(priceCents),
    deliveryPriceConfirmed: true,
    deliveryZoneId: zone.id,
    snapshot: {
      version: 1,
      method: 'DELIVERY',
      zoneId: zone.id,
      zoneName: zone.name,
      locality: zone.locality,
      tariff: kopecksToRubles(tariffCents),
      minimumOrderAmount: minimum === null ? null : kopecksToRubles(minimum),
      freeDeliveryFrom: threshold === null ? null : kopecksToRubles(threshold),
      merchandiseTotal: kopecksToRubles(payableCents),
      discountBasis: 'AFTER_PROMOTIONS',
      freeDeliveryApplied: free,
      price: kopecksToRubles(priceCents),
      currency: deliveryConfig.currency,
    },
  };
}
