import { env } from "./env.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const MINUTE_IN_MS = 60 * 1000;

const sessionTtlMs = env.SESSION_TTL_DAYS * DAY_IN_MS;

const sessionCookieOptions = Object.freeze({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: sessionTtlMs,
  priority: "high",
});

export const authConfig = Object.freeze({
  sessionCookieName: env.SESSION_COOKIE_NAME,
  adminSessionCookieName: `${env.SESSION_COOKIE_NAME}_admin`,
  sessionTtlMs,
  customerSessionTtlMs: env.CUSTOMER_SESSION_TTL_DAYS * DAY_IN_MS,
  sessionTouchIntervalMs: 15 * 60 * 1000,
  maxSessionsPerUser: 10,
  passwordResetTokenTtlMs: 30 * MINUTE_IN_MS,
  passwordResetRequestMinIntervalMs: 60 * 1000,
  maxActivePasswordResetTokens: 1,
});

export function getSessionCookieOptions(expiresAt = null) {
  return {
    ...sessionCookieOptions,
    // Cookie lifetime must never exceed the expiry validated on the server.
    maxAge: expiresAt
      ? Math.max(0, new Date(expiresAt).getTime() - Date.now())
      : authConfig.customerSessionTtlMs,
  };
}

export function getClearSessionCookieOptions() {
  const { maxAge, ...options } = sessionCookieOptions;

  return {
    ...options,
  };
}

export function getAdminSessionCookieOptions() {
  return {
    ...sessionCookieOptions,
  };
}

export function getClearAdminSessionCookieOptions() {
  const { maxAge, ...options } = sessionCookieOptions;

  return {
    ...options,
  };
}
