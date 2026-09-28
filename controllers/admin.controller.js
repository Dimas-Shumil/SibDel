import { prisma } from "../lib/prisma.js";
import {
  authConfig,
  getAdminSessionCookieOptions,
  getClearAdminSessionCookieOptions,
} from "../config/auth.js";
import {
  authenticateUserByEmail,
  createSession,
  revokeSessionToken,
} from "../services/auth.service.js";
import { getAdminDashboard } from "../services/admin.service.js";

const ADMIN_ROLES = new Set(["OWNER", "STAFF"]);

function createAuthError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.expose = true;
  return error;
}

function invalidCredentialsError() {
  return createAuthError(
    "Неверный email или пароль.",
    401,
    "INVALID_CREDENTIALS",
  );
}

function requestIp(req) {
  return typeof req.ip === "string" && req.ip ? req.ip : null;
}

function userAgent(req) {
  const value = req.get("user-agent");
  return typeof value === "string" ? value.slice(0, 1000) : null;
}

async function writeAdminActivity(req, userId, action, description) {
  try {
    await prisma.adminActivity.create({
      data: {
        actorId: userId,
        action,
        entityType: "User",
        entityId: String(userId),
        description,
        ipAddress: requestIp(req),
        userAgent: userAgent(req),
      },
    });
  } catch {
    // Authentication must not fail only because audit persistence is unavailable.
  }
}

export async function adminLogin(req, res, next) {
  try {
    const { email, password } = req.validated.body;
    const user = await authenticateUserByEmail({ email, password });

    if (!user || !ADMIN_ROLES.has(user.role)) {
      return next(invalidCredentialsError());
    }

    const existingToken = req.cookies?.[authConfig.adminSessionCookieName];

    if (existingToken) {
      await revokeSessionToken(existingToken);
    }

    const session = await createSession({
      userId: user.id,
      ipAddress: requestIp(req),
      userAgent: userAgent(req),
    });

    res.cookie(
      authConfig.adminSessionCookieName,
      session.token,
      getAdminSessionCookieOptions(),
    );

    await writeAdminActivity(
      req,
      user.id,
      "ADMIN_LOGIN",
      "Вход в административный контур",
    );

    return res.status(200).json({
      ok: true,
      user,
      session: { expiresAt: session.expiresAt },
    });
  } catch (error) {
    return next(error);
  }
}

export function adminMe(req, res) {
  return res.status(200).json({
    ok: true,
    user: req.user,
  });
}

export async function adminDashboard(req, res, next) {
  try {
    const dashboard = await getAdminDashboard();
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ ok: true, dashboard });
  } catch (error) {
    return next(error);
  }
}

export async function adminLogout(req, res, next) {
  try {
    const token = req.cookies?.[authConfig.adminSessionCookieName];
    const userId = req.user?.id ?? null;

    if (token) {
      await revokeSessionToken(token);
    }

    if (userId) {
      await writeAdminActivity(
        req,
        userId,
        "ADMIN_LOGOUT",
        "Выход из административного контура",
      );
    }

    res.clearCookie(
      authConfig.adminSessionCookieName,
      getClearAdminSessionCookieOptions(),
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    return next(error);
  }
}
