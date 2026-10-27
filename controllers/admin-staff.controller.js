import {
  listAdminStaff,
  createAdminStaff,
  editAdminStaff,
  setAdminStaffActive,
  resetAdminStaffPassword,
  listAdminStaffActivity,
} from "../services/admin-staff.service.js";

function context(req) {
  const agent = req.get("user-agent");
  return {
    actorId: req.adminUser.id,
    ipAddress: typeof req.ip === "string" ? req.ip.slice(0, 64) : null,
    userAgent: typeof agent === "string" ? agent.slice(0, 1000) : null,
  };
}

export async function getAdminStaff(req, res, next) {
  try {
    const employees = await listAdminStaff(req.validated.query);
    return res.status(200).json({ ok: true, employees });
  } catch (error) { return next(error); }
}

export async function getAdminStaffActivity(_req, res, next) {
  try {
    const activity = await listAdminStaffActivity();
    return res.status(200).json({ ok: true, activity });
  } catch (error) { return next(error); }
}

export async function postAdminStaff(req, res, next) {
  try {
    const employee = await createAdminStaff(req.validated.body, context(req));
    return res.status(201).json({ ok: true, employee });
  } catch (error) { return next(error); }
}

export async function patchAdminStaff(req, res, next) {
  try {
    const employee = await editAdminStaff(req.validated.params.employeeId, req.validated.body, context(req));
    return res.status(200).json({ ok: true, employee });
  } catch (error) { return next(error); }
}

export async function patchAdminStaffStatus(req, res, next) {
  try {
    const employee = await setAdminStaffActive(req.validated.params.employeeId,
      req.validated.body.isActive, context(req));
    return res.status(200).json({ ok: true, employee });
  } catch (error) { return next(error); }
}

export async function postAdminStaffPassword(req, res, next) {
  try {
    const result = await resetAdminStaffPassword(req.validated.params.employeeId,
      req.validated.body.password, context(req));
    return res.status(200).json({ ok: true, ...result });
  } catch (error) { return next(error); }
}
