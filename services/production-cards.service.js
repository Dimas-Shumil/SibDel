import { prisma } from "../lib/prisma.js";
import { z } from "zod";

export const productionPages = Object.freeze({
  "/production.html": "О продукции", "/catalog.html": "Каталог",
  "/about.html": "О компании", "/contacts.html": "Контакты",
  "/how-to-order.html": "Как заказать", "/subscription.html": "Подписка",
  "/promotions.html": "Акции", "/business.html": "Для бизнеса",
});
export const productionImages = Object.freeze([
  ["avtor-k", "Авторские колбасы"], ["kopt-del", "Копчёные деликатесы"],
  ["meat-pol", "Мясные полуфабрикаты"], ["kulinar", "Кулинария и готовые блюда"], ["bakery", "Выпечка"],
].map(([file, name]) => ({ name, url: `/site/images/production/${file}.webp` })));
export const safeProductionImage = (value) => productionImages.some((item) => item.url === value) ||
  /^\/uploads\/production\/[0-9a-f-]{36}\.webp$/.test(value);
export const productionCardSchema = z.object({
  name: z.string().trim().min(2).max(200),
  imageUrl: z.string().max(500).refine(safeProductionImage, "Выберите изображение или загрузите файл."),
  categoryId: z.number().int().positive().nullable(),
  pagePath: z.string().refine((value) => Object.hasOwn(productionPages, value), "Выберите страницу.").nullable(),
  sortOrder: z.number().int().min(-100000).max(100000),
  isActive: z.boolean(),
}).strict().refine((value) => (value.categoryId !== null) !== (value.pagePath !== null), "Выберите категорию либо страницу.");

export function productionHref(card) {
  if (card.categoryId !== null) return card.category?.isActive
    ? `/catalog.html?${new URLSearchParams({ category: card.category.slug })}` : null;
  return Object.hasOwn(productionPages, card.pagePath) ? card.pagePath : null;
}
export async function listProductionCards(publicOnly = false) {
  const cards = await prisma.productionCard.findMany({
    where: publicOnly ? { isActive: true } : {},
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { category: { select: { name: true, slug: true, isActive: true } } },
  });
  return cards.map((card) => ({ ...card, href: productionHref(card) }))
    .filter((card) => !publicOnly || card.href)
    .map((card) => publicOnly ? { id: card.id, name: card.name, imageUrl: card.imageUrl, href: card.href } : card);
}
export async function mutateProductionCard(id, data, actorId) {
  return prisma.$transaction(async (tx) => {
    if (data?.categoryId !== null && data?.categoryId !== undefined) {
      const category = await tx.category.findUnique({ where: { id: data.categoryId } });
      if (!category?.isActive) throw Object.assign(new Error("Выберите активную категорию."), { statusCode: 400, code: "INVALID_CATEGORY", expose: true });
    }
    const card = data === null ? await tx.productionCard.delete({ where: { id } })
      : id ? await tx.productionCard.update({ where: { id }, data }) : await tx.productionCard.create({ data });
    await tx.adminActivity.create({ data: { actorId, action: data === null ? "PRODUCTION_CARD_DELETE" : id ? "PRODUCTION_CARD_UPDATE" : "PRODUCTION_CARD_CREATE", entityType: "ProductionCard", entityId: String(card.id), description: card.name } });
    return card;
  });
}
