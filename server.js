import http from "node:http";

import app from "./app.js";

import { env } from "./config/env.js";

import {
  verifyMailConnection,
  closeMailConnection,
} from "./config/mail.js";

import {
  connectDatabase,
  disconnectDatabase,
} from "./lib/prisma.js";

import { logger } from "./lib/logger.js";

const server = http.createServer(app);

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;
server.maxRequestsPerSocket = 1_000;

let isShuttingDown = false;

function listen() {
  return new Promise((resolve, reject) => {
    function handleError(error) {
      server.off("listening", handleListening);
      reject(error);
    }

    function handleListening() {
      server.off("error", handleError);
      resolve();
    }

    server.once("error", handleError);
    server.once("listening", handleListening);

    server.listen(
      env.PORT,
      env.HOST,
    );
  });
}

function closeHttpServer() {
  return new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });

    server.closeIdleConnections?.();
  });
}

async function verifySmtpInBackground() {
  try {
    const smtpAvailable =
      await verifyMailConnection();

    if (smtpAvailable) {
      console.log(
        "SMTP готов к отправке писем",
      );

      return;
    }

    logger.warn(
      "SMTP is unavailable. Application will continue without email notifications.",
    );
  } catch (error) {
    logger.warn(
      {
        err: error,
      },
      "SMTP verification failed. Application will continue without email notifications.",
    );
  }
}

async function shutdown(
  reason,
  exitCode = 0,
) {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  logger.info(
    {
      reason,
    },
    "Application shutdown started",
  );

  const forceShutdownTimer = setTimeout(() => {
    logger.fatal(
      {
        reason,
      },
      "Application shutdown timed out",
    );

    server.closeAllConnections?.();

    process.exit(1);
  }, 10_000);

  forceShutdownTimer.unref();

  try {
    await closeHttpServer();

    closeMailConnection();

    await disconnectDatabase();

    clearTimeout(forceShutdownTimer);

    logger.info(
      {
        reason,
      },
      "Application shutdown completed",
    );

    process.exit(exitCode);
  } catch (error) {
    clearTimeout(forceShutdownTimer);

    logger.fatal(
      {
        err: error,
        reason,
      },
      "Application shutdown failed",
    );

    process.exit(1);
  }
}

async function startServer() {
  try {
    await connectDatabase();

    await listen();

    console.log(
      `Сервер запущен: http://localhost:${env.PORT}`,
    );

    void verifySmtpInBackground();
  } catch (error) {
    logger.fatal(
      {
        err: error,
      },
      "Application startup failed",
    );

    await shutdown(
      "STARTUP_ERROR",
      1,
    );
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on(
  "unhandledRejection",
  (reason) => {
    const error =
      reason instanceof Error
        ? reason
        : new Error(String(reason));

    logger.fatal(
      {
        err: error,
      },
      "Unhandled promise rejection",
    );

    void shutdown(
      "UNHANDLED_REJECTION",
      1,
    );
  },
);

process.on(
  "uncaughtException",
  (error) => {
    logger.fatal(
      {
        err: error,
      },
      "Uncaught exception",
    );

    void shutdown(
      "UNCAUGHT_EXCEPTION",
      1,
    );
  },
);

void startServer();
