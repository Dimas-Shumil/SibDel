import {
  createCheckoutOrder,
  getCheckoutState,
} from "../services/checkout.service.js";
import { resolveCommerceOwner } from "../services/commerce.service.js";

export async function readCheckout(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res);
    const checkout = await getCheckoutState({
      owner,
      userId: req.user?.id ?? null,
      receiveDate: req.validated?.query?.date ?? null,
      receiveMethod: req.validated?.query?.receiveMethod ?? null,
      deliveryZoneId: req.validated?.query?.deliveryZoneId ?? null,
      pickupPointId: req.validated?.query?.pickupPointId ?? null,
    });

    res.setHeader("Cache-Control", "no-store");

    return res.status(200).json({
      ok: true,
      checkout,
    });
  } catch (error) {
    return next(error);
  }
}

export async function createOrder(req, res, next) {
  try {
    const owner = resolveCommerceOwner(req, res);
    const result = await createCheckoutOrder({
      owner,
      userId: req.user?.id ?? null,
      input: req.validated.body,
    });

    res.setHeader("Cache-Control", "no-store");

    return res.status(result.created ? 201 : 200).json({
      ok: true,
      order: result.order,
      idempotentReplay: !result.created,
    });
  } catch (error) {
    return next(error);
  }
}
