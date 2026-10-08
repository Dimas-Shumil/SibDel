import { prisma } from "../lib/prisma.js";
import { getActiveDeliveryZones, deliveryError, kopecksToRubles, moneyToKopecks, normalizeLocality } from "../services/delivery.service.js";

const num = (value) => value === null || value === undefined ? null : kopecksToRubles(moneyToKopecks(value));
const mapZone = (zone) => ({ ...zone, deliveryPrice: num(zone.deliveryPrice), minOrderAmount: num(zone.minOrderAmount), freeDeliveryFrom: num(zone.freeDeliveryFrom) });
const mapPoint = (point) => ({ ...point, latitude: point.latitude === null ? null : Number(point.latitude), longitude: point.longitude === null ? null : Number(point.longitude) });

async function audit(tx, req, kind, entityId, changes) {
  await tx.adminActivity.create({ data: {
    actorId: req.user?.id ?? null,
    action: `DELIVERY_${kind.toUpperCase()}_UPDATED`,
    entityType: kind,
    entityId: String(entityId),
    description: `Настройки доставки: ${kind} #${entityId}`,
    metadata: changes,
    ipAddress: req.ip?.slice(0, 64) || null,
    userAgent: req.get("user-agent")?.slice(0, 1000) || null,
  } });
}

export async function publicDeliveryZones(_req, res, next) {
  try {
    res.setHeader("Cache-Control", "no-store");
    const [zones, points] = await Promise.all([
      getActiveDeliveryZones(),
      prisma.pickupPoint.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, name: true, address: true, workingHours: true, phone: true } }),
    ]);
    return res.json({ ok: true, zones, pickupPoints: points });
  } catch (error) { return next(error); }
}

export async function adminDeliveryList(_req, res, next) {
  try {
    const [zones, pickupPoints, slots] = await Promise.all([
      prisma.deliveryZone.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
      prisma.pickupPoint.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
      prisma.deliverySlot.findMany({ orderBy: [{ date: "desc" }, { startTime: "asc" }], take: 150 }),
    ]);
    res.setHeader("Cache-Control", "no-store");
    return res.json({ ok: true, zones: zones.map(mapZone), pickupPoints: pickupPoints.map(mapPoint), slots });
  } catch (error) { return next(error); }
}

export async function saveAdminDeliveryZone(req, res, next) {
  try {
    const input = req.validated.body;
    const id = req.validated.params?.id ?? null;
    const zone = await prisma.$transaction(async (tx) => {
      const previous = id ? await tx.deliveryZone.findUnique({ where: { id } }) : null;
      if (id && !previous) throw deliveryError("Зона доставки не найдена.", 404, "DELIVERY_ZONE_NOT_FOUND");
      const merged = { ...previous, ...input };
      if (merged.isActive && !String(merged.locality || "").trim()) {
        throw deliveryError("Для активной зоны необходимо указать населённый пункт.", 400, "LOCALITY_REQUIRED");
      }
      const normalized = normalizeLocality(merged.locality);
      if (normalized) {
        const otherZones = await tx.deliveryZone.findMany({ where: { locality: { not: null }, ...(id ? { id: { not: id } } : {}) }, select: { locality: true } });
        if (otherZones.some((existing) => normalizeLocality(existing.locality) === normalized)) {
          throw deliveryError("Для этого населённого пункта зона уже существует.", 409, "DUPLICATE_DELIVERY_LOCALITY");
        }
      }
      const data = { ...input, ...(Object.hasOwn(input, "locality") ? { locality: input.locality?.trim() || null } : {}) };
      const saved = id ? await tx.deliveryZone.update({ where: { id }, data }) : await tx.deliveryZone.create({ data });
      await audit(tx, req, "ZONE", saved.id, { action: id ? "edit" : "create", ...input });
      return saved;
    });
    return res.status(id ? 200 : 201).json({ ok: true, zone: mapZone(zone) });
  } catch (error) { return next(error); }
}

export async function saveAdminPickupPoint(req, res, next) {
  try {
    const input = req.validated.body;
    const id = req.validated.params?.id ?? null;
    const point = await prisma.$transaction(async (tx) => {
      if (id && !await tx.pickupPoint.findUnique({ where: { id }, select: { id: true } })) throw deliveryError("Пункт выдачи не найден.", 404, "PICKUP_POINT_NOT_FOUND");
      const data = input;
      const saved = id ? await tx.pickupPoint.update({ where: { id }, data }) : await tx.pickupPoint.create({ data });
      await audit(tx, req, "PICKUP_POINT", saved.id, { action: id ? "edit" : "create", ...data });
      return saved;
    });
    return res.status(id ? 200 : 201).json({ ok: true, pickupPoint: mapPoint(point) });
  } catch (error) { return next(error); }
}

export async function saveAdminDeliverySlot(req, res, next) {
  try {
    const input = req.validated.body;
    const id = req.validated.params?.id ?? null;
    const slot = await prisma.$transaction(async (tx) => {
      if (id && !await tx.deliverySlot.findUnique({ where: { id }, select: { id: true } })) throw deliveryError("Временной интервал не найден.", 404, "DELIVERY_SLOT_NOT_FOUND");
      const data = { ...input, ...(input.date ? { date: new Date(`${input.date}T00:00:00.000Z`) } : {}) };
      const old = id ? await tx.deliverySlot.findUnique({ where: { id } }) : null;
      if (old || !id) {
        const start = data.startTime ?? old?.startTime;
        const end = data.endTime ?? old?.endTime;
        if (start >= end) throw deliveryError("Конец интервала должен быть позже начала.", 400, "INVALID_DELIVERY_TIME_WINDOW");
      }
      const saved = id ? await tx.deliverySlot.update({ where: { id }, data }) : await tx.deliverySlot.create({ data });
      await audit(tx, req, "SLOT", saved.id, { action: id ? "edit" : "create", ...input });
      return saved;
    });
    return res.status(id ? 200 : 201).json({ ok: true, slot });
  } catch (error) { return next(error); }
}
