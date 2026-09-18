import pino from "pino";

import { env } from "../config/env.js";

const redactPaths = [
  "password",
  "passwordHash",
  "token",
  "tokenHash",
  "sessionToken",
  "sessionSecret",
  "secret",
  "authorization",
  "cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
];

export const logger = pino({
  level: env.LOG_LEVEL,

  base: {
    service: "siberian-delicacies",
    environment: env.NODE_ENV,
  },

  redact: {
    paths: redactPaths,
    censor: "[REDACTED]",
  },

  timestamp: pino.stdTimeFunctions.isoTime,
});

export function logError(error, context = {}) {
  logger.error(
    {
      ...context,
      err: error,
    },
    error?.message || "Unknown error",
  );
}

// SIBDEL_DEV_QUIET_LOGS
if (process.env.NODE_ENV !== 'production') {
  logger.level = 'warn';
}
