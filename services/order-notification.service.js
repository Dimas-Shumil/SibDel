import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { sendAdminNotification, sendCustomerNotification } from "./notification.service.js";

// Best effort after commit. A failed notification must never turn an accepted
// order into a failed checkout/generation, or enter transaction retry logic.
export async function notifyOrderCreated(orderId) {
  if (env.NODE_ENV === "test") return { skipped: true };
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { items: { orderBy: { id: "asc" } }, subscriptionDelivery: true },
    });
    if (!order) throw new Error("Notification order not found");
    const money = (value) => `${Number(value).toFixed(2)} ${order.currency}`;
    const date = order.requestedReceiveDate?.toISOString().slice(0, 10) || "не указана";
    const text = [
      `Заказ ${order.number} принят. Оператор свяжется с вами для подтверждения.`,
      ...(order.subscriptionDelivery ? [`Подписка #${order.subscriptionDelivery.subscriptionId}`] : []),
      `Получатель: ${order.customerName}`, `Телефон: ${order.customerPhone}`,
      `Получение: ${order.deliveryMethod === "PICKUP" ? "Самовывоз" : "Доставка"}`,
      `Дата: ${date}; время: ${order.requestedTimeWindow || "согласуется"}`,
      `Адрес: ${order.deliveryAddressSnapshot || "согласуется"}`,
      "", ...order.items.map((item) => `${item.productName} (${item.sku}) × ${Number(item.quantity)} — ${money(item.total)}`),
      "", `Товары: ${money(order.subtotal)}`, `Скидка: ${money(order.discountTotal)}`,
      `Доставка: ${money(order.deliveryPrice)}`, `Итого: ${money(order.total)}`,
      `Оплата: ${order.paymentMethod === "ON_RECEIPT" ? "при получении" : order.paymentMethod}`,
      `Комментарий: ${order.comment || "—"}`,
    ].join("\n");
    const base = env.APP_URL.replace(/\/$/, "");
    // Separate destinations: the customer never receives the operator link.
    const tasks = [() => sendAdminNotification({
      subject: `Новый заказ ${order.number}`,
      text: `${text}\n\n${base}/admin/order?order=${encodeURIComponent(order.number)}`,
      replyTo: order.customerEmail || undefined,
    })];
    if (order.customerEmail) tasks.push(() => sendCustomerNotification({
      to: order.customerEmail, subject: `Ваш заказ ${order.number} принят`,
      text: `${text}${order.userId ? `\n\n${base}/account/order?id=${encodeURIComponent(order.number)}` : ""}`,
    }));
    const results = await Promise.allSettled(tasks.map((send) => Promise.resolve().then(send)));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed) logger.error({ orderId, failed }, "Order notification failed; order remains committed");
    return { sent: results.length - failed, failed };
  } catch (error) {
    logger.error({ err: error, orderId }, "Order notification failed; order remains committed");
    return { sent: 0, failed: 1 };
  }
}
