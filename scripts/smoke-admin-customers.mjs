import { randomUUID } from "node:crypto";

import { connectDatabase, disconnectDatabase, prisma } from "../lib/prisma.js";
import {
  addAdminCustomerNote,
  getAdminCustomer,
  listAdminCustomers,
  setAdminCustomerActive,
} from "../services/admin-customer.service.js";

const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
const actor = {
  actorId: null,
  ipAddress: "127.0.0.1",
  userAgent: "admin-customers-smoke",
};

let customerId = null;

async function cleanup() {
  if (!customerId) return;
  await prisma.order.deleteMany({ where: { userId: customerId } });
  await prisma.adminActivity.deleteMany({ where: { entityType: "User", entityId: String(customerId) } });
  await prisma.user.deleteMany({ where: { id: customerId, role: "CUSTOMER" } });
}

try {
  await connectDatabase();

  const customer = await prisma.user.create({
    data: {
      email: `crm-smoke-${suffix}@example.invalid`,
      phone: `+7999${suffix.slice(0, 7)}`,
      passwordHash: "crm-smoke-no-login",
      firstName: "CRM",
      lastName: `Smoke ${suffix}`,
      role: "CUSTOMER",
      isActive: true,
    },
  });
  customerId = customer.id;

  await prisma.userSession.create({
    data: {
      userId: customerId,
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      ipAddress: "127.0.0.1",
      userAgent: "crm-smoke-session",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });

  await prisma.passwordResetToken.create({
    data: {
      userId: customerId,
      tokenHash: randomUUID().replaceAll("-", "").padEnd(64, "1").slice(0, 64),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  await prisma.order.create({
    data: {
      number: `CRM-${suffix}-OK`,
      userId: customerId,
      status: "COMPLETED",
      deliveryStatus: "DELIVERED",
      deliveryMethod: "PICKUP",
      paymentMethod: "ON_RECEIPT",
      customerName: "CRM Smoke",
      customerPhone: customer.phone,
      customerEmail: customer.email,
      subtotal: 1750,
      total: 1750,
      completedAt: new Date(),
    },
  });

  await prisma.order.create({
    data: {
      number: `CRM-${suffix}-CANCEL`,
      userId: customerId,
      status: "CANCELLED",
      deliveryStatus: "CANCELLED",
      deliveryMethod: "PICKUP",
      paymentMethod: "ON_RECEIPT",
      customerName: "CRM Smoke",
      customerPhone: customer.phone,
      customerEmail: customer.email,
      subtotal: 9000,
      total: 9000,
      cancelledAt: new Date(),
    },
  });

  const listed = await listAdminCustomers({ q: suffix, page: 1, limit: 10 });
  const row = listed.items.find((item) => item.id === customerId);
  if (!row || row.ordersCount !== 2 || row.completedOrdersCount !== 1 || Number(row.lifetimeValue) !== 1750) {
    throw new Error("Customer list aggregates are incorrect.");
  }

  await addAdminCustomerNote(customerId, "CRM smoke internal note", actor);

  let detail = await getAdminCustomer(customerId);
  if (!detail || detail.timeline[0]?.action !== "CUSTOMER_NOTE" || Number(detail.metrics.lifetimeValue) !== 1750) {
    throw new Error("Customer detail or CRM note timeline is incorrect.");
  }

  await setAdminCustomerActive(customerId, false, "Smoke deactivation", actor);

  const [sessionsAfterDisable, resetTokensAfterDisable] = await Promise.all([
    prisma.userSession.count({ where: { userId: customerId } }),
    prisma.passwordResetToken.count({ where: { userId: customerId } }),
  ]);
  if (sessionsAfterDisable !== 0 || resetTokensAfterDisable !== 0) {
    throw new Error("Customer deactivation did not revoke sessions/reset tokens.");
  }

  detail = await getAdminCustomer(customerId);
  if (!detail || detail.isActive !== false || !detail.timeline.some((item) => item.action === "CUSTOMER_DEACTIVATED")) {
    throw new Error("Customer deactivation was not persisted/audited.");
  }

  await setAdminCustomerActive(customerId, true, "Smoke reactivation", actor);
  detail = await getAdminCustomer(customerId);
  if (!detail || detail.isActive !== true || !detail.timeline.some((item) => item.action === "CUSTOMER_REACTIVATED")) {
    throw new Error("Customer reactivation was not persisted/audited.");
  }

  console.log(`PASS: customer #${customerId}, LTV, notes, deactivation/session revoke and reactivation work.`);
} catch (error) {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error(`Cleanup warning: ${cleanupError.message}`);
    process.exitCode = 1;
  }

  try {
    await disconnectDatabase();
  } catch {}
}
