import {
  getAdminOrder,
  listAdminOrders,
  updateOrderStatus,
} from "../services/order.service.js";

export async function readAdminOrders(req, res, next) {
  try {
    const orders = await listAdminOrders(req.validated?.query ?? {});
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, orders });
  } catch (error) {
    return next(error);
  }
}

export async function readAdminOrder(req, res, next) {
  try {
    const order = await getAdminOrder(req.validated.params.orderKey);

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: {
          code: "ORDER_NOT_FOUND",
          message: "Заказ не найден.",
        },
      });
    }

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, order });
  } catch (error) {
    return next(error);
  }
}

export async function patchOrderStatus(req, res, next) {
  try {
    const order = await updateOrderStatus({
      orderKey: req.validated.params.orderKey,
      nextStatus: req.validated.body.status,
      actorId: req.user.id,
      reason: req.validated.body.reason,
    });

    return res.status(200).json({ ok: true, order });
  } catch (error) {
    return next(error);
  }
}
