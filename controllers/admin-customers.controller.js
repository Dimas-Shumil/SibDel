import {
  addAdminCustomerNote,
  getAdminCustomer,
  listAdminCustomers,
  setAdminCustomerActive,
} from "../services/admin-customer.service.js";

function requestContext(req) {
  const userAgent = req.get("user-agent");
  return {
    actorId: req.user.id,
    ipAddress: typeof req.ip === "string" && req.ip ? req.ip.slice(0, 64) : null,
    userAgent: typeof userAgent === "string" && userAgent ? userAgent.slice(0, 1000) : null,
  };
}

export async function getCustomers(req, res, next) {
  try {
    const result = await listAdminCustomers(req.validated?.query ?? {});
    return res.status(200).json({ ok: true, customers: result });
  } catch (error) {
    return next(error);
  }
}

export async function getCustomer(req, res, next) {
  try {
    const customer = await getAdminCustomer(req.validated.params.customerId);
    if (!customer) {
      return res.status(404).json({
        ok: false,
        error: { code: "CUSTOMER_NOT_FOUND", message: "Клиент не найден." },
      });
    }

    return res.status(200).json({ ok: true, customer });
  } catch (error) {
    return next(error);
  }
}

export async function postCustomerNote(req, res, next) {
  try {
    const note = await addAdminCustomerNote(
      req.validated.params.customerId,
      req.validated.body.text,
      requestContext(req),
    );
    return res.status(201).json({ ok: true, note });
  } catch (error) {
    return next(error);
  }
}

export async function patchCustomerStatus(req, res, next) {
  try {
    const customer = await setAdminCustomerActive(
      req.validated.params.customerId,
      req.validated.body.isActive,
      req.validated.body.reason,
      requestContext(req),
    );
    return res.status(200).json({ ok: true, customer });
  } catch (error) {
    return next(error);
  }
}
