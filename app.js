import express from "express";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";

import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

import { securityMiddleware } from "./middleware/security.js";
import { apiRateLimiter } from "./middleware/rate-limit.js";
import { authMiddleware } from "./middleware/auth.js";
import { adminAuth } from "./middleware/admin-auth.js";
import { csrfProtection } from "./middleware/csrf.js";
import authRouter from "./routes/auth.routes.js";
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

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return res.status(200).json({
      ok: true,
      service: "siberian-delicacies",
      database: "ok",
    });
  } catch (error) {
    logger.error(
      {
        err: error,
      },
      "Health check failed",
    );

    return res.status(503).json({
      ok: false,
      service: "siberian-delicacies",
      database: "unavailable",
    });
  }
});

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

app.get("/admin/login", (_req, res) => {
  return res.sendFile(
    path.join(adminPagesPath, "login.html"),
  );
});

app.use(
  "/admin",
  adminAuth,
  express.static(adminPagesPath, {
    dotfiles: "deny",
    extensions: ["html"],
    index: "dashboard.html",
  }),
);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
