import {
  cancelAdminSubscription,
  generateDueSubscriptionOrders,
  generateSubscriptionOrder,
  getAdminSubscription,
  listAdminSubscriptions,
  pauseAdminSubscription,
  resumeAdminSubscription,
} from "../services/subscription.service.js";

function notFound() {
  const error = new Error("Подписка не найдена.");
  error.statusCode = 404;
  error.code = "SUBSCRIPTION_NOT_FOUND";
  error.expose = true;
  return error;
}

export async function getSubscriptions(req, res, next) {
  try { return res.status(200).json({ ok: true, subscriptions: await listAdminSubscriptions(req.validated.query) }); }
  catch (error) { return next(error); }
}
export async function getSubscription(req, res, next) {
  try {
    const subscription = await getAdminSubscription(req.validated.params.subscriptionId);
    if (!subscription) return next(notFound());
    return res.status(200).json({ ok: true, subscription });
  } catch (error) { return next(error); }
}
export async function pauseSubscription(req, res, next) {
  try { return res.status(200).json({ ok: true, subscription: await pauseAdminSubscription({ subscriptionId: req.validated.params.subscriptionId, actorId: req.user.id }) }); }
  catch (error) { return next(error); }
}
export async function resumeSubscription(req, res, next) {
  try { return res.status(200).json({ ok: true, subscription: await resumeAdminSubscription({ subscriptionId: req.validated.params.subscriptionId, actorId: req.user.id, nextDeliveryDate: req.validated.body.nextDeliveryDate ?? null }) }); }
  catch (error) { return next(error); }
}
export async function cancelSubscription(req, res, next) {
  try { return res.status(200).json({ ok: true, subscription: await cancelAdminSubscription({ subscriptionId: req.validated.params.subscriptionId, actorId: req.user.id }) }); }
  catch (error) { return next(error); }
}
export async function generateSubscription(req, res, next) {
  try {
    const result = await generateSubscriptionOrder({ subscriptionId: req.validated.params.subscriptionId, actorId: req.user.id, source: "ADMIN" });
    return res.status(result.created ? 201 : 200).json({ ok: true, ...result });
  } catch (error) { return next(error); }
}
export async function generateDue(req, res, next) {
  try {
    const result = await generateDueSubscriptionOrders({ limit: req.validated.body.limit, actorId: req.user.id, source: "ADMIN" });
    return res.status(200).json({ ok: true, generation: result });
  } catch (error) { return next(error); }
}
