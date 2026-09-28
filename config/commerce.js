import { env } from "./env.js";

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const guestTtlMs = 90 * DAY_IN_MS;

const guestCookieOptions = Object.freeze({
  httpOnly: true,
  secure: env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: guestTtlMs,
  priority: "medium",
});

export const commerceConfig = Object.freeze({
  guestCookieName: "sibdel_commerce",
  guestTtlMs,
});

export function getGuestCommerceCookieOptions() {
  return {
    ...guestCookieOptions,
  };
}

export function getClearGuestCommerceCookieOptions() {
  const { maxAge, ...options } = guestCookieOptions;

  return {
    ...options,
  };
}
