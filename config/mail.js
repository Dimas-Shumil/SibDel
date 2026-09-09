import nodemailer from "nodemailer";

import { env } from "./env.js";
import { logger } from "../lib/logger.js";

export const mailTransporter = nodemailer.createTransport({
  pool: true,
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: env.SMTP_SECURE,

  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
  },

  tls: {
    minVersion: "TLSv1.2",
  },

  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,

  maxConnections: 5,
  maxMessages: 100,
});

export async function verifyMailConnection() {
  try {
    await mailTransporter.verify();

    return true;
  } catch (error) {
    logger.error(
      {
        err: error,
        smtpHost: env.SMTP_HOST,
        smtpPort: env.SMTP_PORT,
      },
      "SMTP connection verification failed",
    );

    return false;
  }
}

export function closeMailConnection() {
  mailTransporter.close();
}
