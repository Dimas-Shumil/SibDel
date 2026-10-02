import {
  cancelCustomerSubscription,
  createCustomerSubscription,
  getCustomerSubscription,
  getSubscriptionOptions,
  pauseCustomerSubscription,
  resumeCustomerSubscription,
  updateCustomerSubscription,
} from "../services/subscription.service.js";

export async function getMySubscription(req, res, next) {
  try {
    const subscription = await getCustomerSubscription(req.user.id);
    return res.status(200).json({ ok: true, subscription });
  } catch (error) { return next(error); }
}

export async function getMySubscriptionOptions(req, res, next) {
  try {
    const options = await getSubscriptionOptions(req.user.id);
    return res.status(200).json({ ok: true, options });
  } catch (error) { return next(error); }
}

export async function createSubscription(req, res, next) {
  try {
    const subscription = await createCustomerSubscription({ userId: req.user.id, input: req.validated.body });
    return res.status(201).json({ ok: true, subscription });
  } catch (error) { return next(error); }
}

export async function updateSubscription(req, res, next) {
  try {
    const subscription = await updateCustomerSubscription({ userId: req.user.id, input: req.validated.body });
    return res.status(200).json({ ok: true, subscription });
  } catch (error) { return next(error); }
}

export async function pauseSubscription(req, res, next) {
  try {
    const subscription = await pauseCustomerSubscription(req.user.id);
    return res.status(200).json({ ok: true, subscription });
  } catch (error) { return next(error); }
}

export async function resumeSubscription(req, res, next) {
  try {
    const subscription = await resumeCustomerSubscription({
      userId: req.user.id,
      nextDeliveryDate: req.validated.body.nextDeliveryDate ?? null,
    });
    return res.status(200).json({ ok: true, subscription });
  } catch (error) { return next(error); }
}

export async function cancelSubscription(req, res, next) {
  try {
    const subscription = await cancelCustomerSubscription(req.user.id);
    return res.status(200).json({ ok: true, subscription });
  } catch (error) { return next(error); }
}
