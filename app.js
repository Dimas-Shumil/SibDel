import { createHealthHandler } from "./middleware/health.js";
import express from "express";
import { testDatabaseFingerprint } from "./utils/test-environment.js";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

import { pwaMiddleware } from "./middleware/pwa.js";
import { securityMiddleware } from "./middleware/security.js";
import { apiRateLimiter } from "./middleware/rate-limit.js";
import { authMiddleware } from "./middleware/auth.js";
import { adminSessionContext } from "./middleware/admin-auth.js";
import { csrfProtection } from "./middleware/csrf.js";
import { customerPushRouter, adminPushRouter } from "./routes/push.routes.js";
import authRouter from "./routes/auth.routes.js";
import adminRouter from "./routes/admin.routes.js";
import accountRouter from "./routes/account.routes.js";
import catalogRouter from "./routes/catalog.routes.js";
import { parsePublicCatalogQuery } from "./utils/catalog-query.js";
import { seoMiddleware } from "./middleware/seo.js";
import { getPublicProductBySlug } from "./services/product.service.js";
import { getPublicCatalog } from "./services/catalog.service.js";
import categoriesRouter from "./routes/categories.routes.js";
import productsRouter from "./routes/products.routes.js";
import cartRouter from "./routes/cart.routes.js";
import favoritesRouter from "./routes/favorites.routes.js";
import commerceRouter from "./routes/commerce.routes.js";
import checkoutRouter from "./routes/checkout.routes.js";
import inventoryRouter from "./routes/inventory.routes.js";
import adminCatalogRouter from "./routes/admin-catalog.routes.js";
import ordersRouter from "./routes/orders.routes.js";
import adminCustomersRouter from "./routes/admin-customers.routes.js";
import adminStaffRouter from "./routes/admin-staff.routes.js";
import promotionsRouter from "./routes/promotions.routes.js";
import reviewsRouter from "./routes/reviews.routes.js";
import adminReviewsRouter from "./routes/admin-reviews.routes.js";
import subscriptionsRouter from "./routes/subscriptions.routes.js";
import adminSubscriptionsRouter from "./routes/admin-subscriptions.routes.js";
import deliveryRouter from "./routes/delivery.routes.js";
import adminDeliveryRouter from "./routes/admin-delivery.routes.js";
import {
  notFoundHandler,
  errorHandler,
} from "./middleware/error-handler.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const publicPath = path.join(__dirname, "public");
const sitePath = path.join(__dirname, "site");
const componentsPath = path.join(__dirname, "components");
const uploadsPath = path.join(__dirname, "uploads");
const adminPagesPath = path.join(__dirname, "admin-pages");
const accountIndexPath = path.join(publicPath, "account", "index.html");

const app = express();

app.disable("x-powered-by");

app.set(
  "trust proxy",
  env.TRUST_PROXY === 1 ? 1 : false,
);

function isValidRequestId(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._:-]{1,100}$/.test(value)
  );
}

const httpLogger = pinoHttp({
  logger,
  serializers: {
    req(req) { return { id: req.id, method: req.method, url: (req.url || "").split("?")[0] }; },
    res(res) { return { statusCode: res.statusCode }; },
  },

  genReqId(req, res) {
    const incomingRequestId =
      req.headers["x-request-id"];

    const requestId = isValidRequestId(
      incomingRequestId,
    )
      ? incomingRequestId
      : randomUUID();

    res.setHeader("X-Request-Id", requestId);

    return requestId;
  },

  autoLogging: {
    ignore(req) {
      return req.url === "/api/health";
    },
  },
});

app.use(securityMiddleware);
app.use(httpLogger);
app.use(pwaMiddleware(publicPath));

const publicProductWhere = { isActive: true, category: { isActive: true } };
app.use(seoMiddleware({
  publicPath,
  siteUrl: env.SEO_SITE_URL,
  getProduct: getPublicProductBySlug,
  getCatalog: getPublicCatalog,
  parseCatalog: parsePublicCatalogQuery,
  countProducts: () => prisma.product.count({ where: publicProductWhere }),
  listCategories: () => prisma.category.findMany({
    where: { isActive: true, products: { some: { isActive: true } } },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { slug: true, name: true, description: true },
  }),
  getCategory: (slug) => prisma.category.findFirst({
    where: { slug, isActive: true, products: { some: { isActive: true } } },
    select: { slug: true, name: true, description: true },
  }),
  listProducts: (skip,take) => prisma.product.findMany({
    where: publicProductWhere, orderBy: { id: 'asc' }, skip, take, select: { slug: true },
  }),
}));

app.get("/api/health", createHealthHandler({
  probe: () => prisma.$queryRaw`SELECT 1`,
  isTest: env.NODE_ENV === "test",
  fingerprint: () => testDatabaseFingerprint(env.DATABASE_URL),
}));

app.use(
  "/site",
  express.static(sitePath, {
    dotfiles: "deny",
    index: false,
  }),
);

app.use(
  "/components",
  express.static(componentsPath, {
    dotfiles: "deny",
    index: false,
  }),
);

app.use(
  "/uploads",
  express.static(uploadsPath, {
    dotfiles: "deny",
    index: false,
  }),
);

app.get(
  [
    "/account",
    "/account/",
    "/account/orders",
    "/account/order",
    "/account/favorites",
    "/account/addresses",
    "/account/settings",
    "/account/subscription",
  ],
  (_req, res) => {
    return res.sendFile(accountIndexPath);
  },
);

app.use(
  express.static(publicPath, {
    dotfiles: "deny",
    extensions: ["html"],
    index: "index.html",
  }),
);

app.use("/api", apiRateLimiter);

app.use(
  express.json({
    limit: "1mb",
    strict: true,
  }),
);

app.use(
  express.urlencoded({
    extended: false,
    limit: "256kb",
    parameterLimit: 100,
  }),
);

app.use(cookieParser());

app.use(authMiddleware);
app.use(csrfProtection);

app.use(
  "/api/auth",
  authRouter,
);

app.use(
  "/api/account",
  accountRouter,
);

app.use(
  "/api/admin",
  adminRouter,
);

app.use("/api/push", customerPushRouter);
app.use("/api/admin/push", adminPushRouter);
app.use("/api/catalog", catalogRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/products", productsRouter);
app.use("/api/commerce", commerceRouter);
app.use("/api/cart", cartRouter);
app.use("/api/favorites", favoritesRouter);
app.use("/api/checkout", checkoutRouter);
app.use("/api/delivery", deliveryRouter);
app.use("/api/admin/delivery", adminDeliveryRouter);
app.use("/api/admin/inventory", inventoryRouter);
app.use("/api/admin/catalog", adminCatalogRouter);
app.use("/api/admin/orders", ordersRouter);
app.use("/api/admin/customers", adminCustomersRouter);
app.use("/api/admin/employees", adminStaffRouter);
app.use("/api/admin/promotions", promotionsRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/admin/reviews", adminReviewsRouter);
app.use("/api/subscriptions", subscriptionsRouter);
app.use("/api/admin/subscriptions", adminSubscriptionsRouter);

app.get("/admin/login", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");

  return res.sendFile(
    path.join(adminPagesPath, "login.html"),
  );
});

function requireAdminPage(req, res, next) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");

  if (!req.auth?.user) {
    return res.redirect(302, "/admin/login");
  }

  if (!["OWNER", "STAFF"].includes(req.auth.user.role)) {
    return res.status(403).send("Недостаточно прав для доступа к админ-панели.");
  }

  return next();
}

app.use(
  "/admin",
  adminSessionContext,
  requireAdminPage,
  (req, res, next) => {
    // Do not serve the staff-management HTML to STAFF accounts.
    let pagePath;
    try { pagePath = decodeURIComponent(req.path).toLowerCase().replace(/\/+$/, ""); }
    catch { return res.status(400).send("Некорректный адрес."); }
    if (["/employees", "/employees.html", "/push", "/push.html"].includes(pagePath) && req.adminUser?.role !== "OWNER") {
      return res.status(403).send("Недостаточно прав для этого раздела.");
    }
    return next();
  },
  express.static(adminPagesPath, {
    dotfiles: "deny",
    extensions: ["html"],
    index: "dashboard.html",
  }),
);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
