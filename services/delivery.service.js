import { prisma } from "../lib/prisma.js";
import { deliveryError, moneyToKopecks, kopecksToRubles, normalizeLocality, priceDeliveryZone } from "./delivery-pricing.js";
export { deliveryError, moneyToKopecks, kopecksToRubles, normalizeLocality, priceDeliveryZone } from "./delivery-pricing.js";


export async function getActiveDeliveryZones(client = prisma) {
  const zones = await client.deliveryZone.findMany({
    where: { isActive: true, locality: { not: null } },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { id: true, name: true, locality: true, description: true, deliveryPrice: true, minOrderAmount: true, freeDeliveryFrom: true },
  });
  return zones.filter((zone) => String(zone.locality || "").trim()).map((zone) => ({
    id: zone.id,
    name: zone.name,
    locality: zone.locality,
    description: zone.description,
    deliveryPrice: kopecksToRubles(moneyToKopecks(zone.deliveryPrice)),
    minOrderAmount: zone.minOrderAmount === null ? null : kopecksToRubles(moneyToKopecks(zone.minOrderAmount)),
    freeDeliveryFrom: zone.freeDeliveryFrom === null ? null : kopecksToRubles(moneyToKopecks(zone.freeDeliveryFrom)),
  }));
}

export async function quoteDelivery({ client = prisma, method, merchandiseTotal, deliveryZoneId = null, pickupPointId = null, address = null, city = null }) {
  if (method === "PICKUP") {
    if (deliveryZoneId !== null) throw deliveryError("Зона не применяется к самовывозу.");
    let point = null;
    if (pickupPointId) {
      point = await client.pickupPoint.findFirst({ where: { id: pickupPointId, isActive: true }, select: { id: true, name: true, address: true } });
      if (!point) throw deliveryError("Точка самовывоза больше недоступна.", 409, "PICKUP_POINT_UNAVAILABLE");
    } else {
      const active = await client.pickupPoint.findFirst({ where: { isActive: true }, select: { id: true } });
      if (active) throw deliveryError("Выберите точку самовывоза.", 400, "PICKUP_POINT_REQUIRED");
    }
    return {
      deliveryPrice: 0,
      deliveryPriceConfirmed: true,
      deliveryZoneId: null,
      pickupPointId: point?.id ?? null,
      deliveryAddressSnapshot: point ? `${point.name}, ${point.address}` : "Точку самовывоза подтвердит менеджер",
      snapshot: { version: 1, method: "PICKUP", pickupPointId: point?.id ?? null, pickupPointName: point?.name ?? null, pickupAddress: point?.address ?? null, tariff: 0, price: 0, currency: "RUB" },
    };
  }
  if (method !== "DELIVERY") throw deliveryError("Некорректный способ получения.");
  if (pickupPointId !== null) throw deliveryError("Точка самовывоза не применяется к курьерской доставке.");
  let zone;
  if (deliveryZoneId) {
    zone = await client.deliveryZone.findFirst({ where: { id: deliveryZoneId, isActive: true } });
  } else if (city) {
    // Subscriptions use the SAVED Address.city, not a zone supplied by the browser.
    zone = await client.deliveryZone.findFirst({ where: { locality: { equals: city.trim(), mode: "insensitive" }, isActive: true } });
  }
  if (!zone) throw deliveryError("Укажите доступный населённый пункт доставки.", 409, "DELIVERY_ZONE_REQUIRED");
  const normalizedZoneLocality = normalizeLocality(zone.locality);
  if (!normalizedZoneLocality) throw deliveryError("Зона доставки ещё не настроена.", 409, "DELIVERY_ZONE_UNAVAILABLE");
  if (city && normalizeLocality(city) !== normalizedZoneLocality) {
    throw deliveryError("Город адреса не соответствует зоне доставки.", 409, "DELIVERY_ZONE_MISMATCH");
  }
  const escapedLocality = normalizedZoneLocality.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const localityPattern = new RegExp(`(^|[^\\p{L}])${escapedLocality}($|[^\\p{L}])`, "u");
  if (address && !localityPattern.test(normalizeLocality(address))) {
    throw deliveryError("Укажите город в адресе доставки в соответствии с выбранной зоной.", 400, "DELIVERY_ADDRESS_CITY_MISMATCH");
  }
  return { ...priceDeliveryZone({ zone, merchandiseTotal }), pickupPointId: null };
}
