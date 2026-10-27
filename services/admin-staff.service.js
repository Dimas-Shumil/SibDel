import { prisma } from "../lib/prisma.js";
import { hashPassword } from "./auth.service.js";

const STAFF_SELECT = Object.freeze({
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

function staffError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

function rethrowUniqueConflict(error) {
  if (error?.code === "P2002") {
    throw staffError("Аккаунт с таким email уже существует.", 409, "EMAIL_TAKEN");
  }
  throw error;
}

async function writeActivity(tx, { actorId, ipAddress, userAgent }, action, employeeId, description) {
  await tx.adminActivity.create({
    data: {
      actorId,
      action,
      entityType: "User",
      entityId: String(employeeId),
      description,
      ipAddress,
      userAgent,
    },
  });
}

// OWNER and CUSTOMER accounts must never be edited through staff-management endpoints.
// The write predicate is checked in the database, not just in the UI.
async function updateExistingStaff(tx, employeeId, data) {
  const result = await tx.user.updateMany({
    where: { id: employeeId, role: "STAFF" },
    data,
  });
  if (result.count !== 1) {
    throw staffError("Сотрудник не найден.", 404, "STAFF_NOT_FOUND");
  }
  return tx.user.findUnique({ where: { id: employeeId }, select: STAFF_SELECT });
}

export async function listAdminStaff({ q = "", status = "all" } = {}) {
  const term = q.trim();
  const where = {
    role: "STAFF",
    ...(status === "active" ? { isActive: true } : {}),
    ...(status === "inactive" ? { isActive: false } : {}),
    ...(term ? {
      OR: [
        { firstName: { contains: term, mode: "insensitive" } },
        { lastName: { contains: term, mode: "insensitive" } },
        { email: { contains: term, mode: "insensitive" } },
      ],
    } : {}),
  };
  const employees = await prisma.user.findMany({
    where, select: STAFF_SELECT, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200,
  });
  const ids = employees.map((item) => item.id);
  if (ids.length === 0) return [];

  const lastLogins = await prisma.adminActivity.groupBy({
    by: ["actorId"],
    where: { actorId: { in: ids }, action: "ADMIN_LOGIN" },
    _max: { createdAt: true },
  });
  const lastLoginById = new Map(lastLogins.map((item) => [item.actorId, item._max.createdAt]));
  return employees.map((employee) => ({
    ...employee, lastLoginAt: lastLoginById.get(employee.id) ?? null,
  }));
}

export async function createAdminStaff(data, context) {
  const passwordHash = await hashPassword(data.password);
  try {
    return await prisma.$transaction(async (tx) => {
      const employee = await tx.user.create({
        data: {
          email: data.email,
          firstName: data.firstName,
          lastName: data.lastName || null,
          passwordHash,
          role: "STAFF",
          isActive: true,
        },
        select: STAFF_SELECT,
      });
      await writeActivity(tx, context, "STAFF_CREATED", employee.id, `Создан сотрудник #${employee.id}`);
      return employee;
    });
  } catch (error) {
    rethrowUniqueConflict(error);
  }
}

export async function editAdminStaff(employeeId, data, context) {
  try {
    return await prisma.$transaction(async (tx) => {
      const employee = await updateExistingStaff(tx, employeeId, {
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.firstName !== undefined ? { firstName: data.firstName } : {}),
        ...(data.lastName !== undefined ? { lastName: data.lastName || null } : {}),
      });
      await writeActivity(tx, context, "STAFF_UPDATED", employee.id, `Изменены данные сотрудника #${employee.id}`);
      return employee;
    });
  } catch (error) {
    rethrowUniqueConflict(error);
  }
}

export async function setAdminStaffActive(employeeId, isActive, context) {
  return prisma.$transaction(async (tx) => {
    const employee = await updateExistingStaff(tx, employeeId, { isActive });
    if (!isActive) {
      // Covers both the storefront and admin session cookies.
      await tx.userSession.deleteMany({ where: { userId: employeeId } });
      await tx.passwordResetToken.deleteMany({ where: { userId: employeeId } });
    }
    await writeActivity(tx, context, isActive ? "STAFF_ENABLED" : "STAFF_DISABLED", employeeId,
      `${isActive ? "Включён" : "Отключён"} доступ сотрудника #${employeeId}`);
    return employee;
  });
}

export async function resetAdminStaffPassword(employeeId, password, context) {
  const passwordHash = await hashPassword(password);
  return prisma.$transaction(async (tx) => {
    await updateExistingStaff(tx, employeeId, { passwordHash });
    await tx.userSession.deleteMany({ where: { userId: employeeId } });
    await tx.passwordResetToken.deleteMany({ where: { userId: employeeId } });
    await writeActivity(tx, context, "STAFF_PASSWORD_RESET", employeeId,
      `Сброшен пароль сотрудника #${employeeId}; все сессии завершены`);
    return { sessionsRevoked: true };
  });
}

export async function listAdminStaffActivity() {
  const activity = await prisma.adminActivity.findMany({
    where: { actor: { role: { in: ["OWNER", "STAFF"] } } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true, action: true, entityType: true, entityId: true,
      description: true, createdAt: true,
      actor: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
    },
  });
  return activity;
}
