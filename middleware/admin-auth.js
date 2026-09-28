import {
  authConfig,
  getClearAdminSessionCookieOptions,
} from "../config/auth.js";
import { resolveSessionToken } from "../services/auth.service.js";
import { requireRoles } from "./roles.js";

const requireAdminRole = requireRoles("OWNER", "STAFF");

export async function adminSessionContext(req, res, next) {
  // Admin endpoints/pages must never trust the public customer session.
  // Keep both contours completely independent even in the same browser.
  req.auth = null;
  req.user = null;
  req.adminAuth = null;
  req.adminUser = null;

  const token = req.cookies?.[authConfig.adminSessionCookieName];

  if (!token) {
    return next();
  }

  try {
    const auth = await resolveSessionToken(token);

    if (!auth) {
      res.clearCookie(
        authConfig.adminSessionCookieName,
        getClearAdminSessionCookieOptions(),
      );
      return next();
    }

    req.adminAuth = auth;
    req.adminUser = auth.user;

    // Preserve compatibility with existing server-side RBAC/controllers inside
    // /api/admin/*, which intentionally read req.auth / req.user.
    req.auth = auth;
    req.user = auth.user;

    return next();
  } catch (error) {
    return next(error);
  }
}

export const adminAuth = [adminSessionContext, requireAdminRole];
