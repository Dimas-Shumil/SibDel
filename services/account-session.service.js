import { prisma } from "../lib/prisma.js";

// User-Agent is untrusted and may be spoofed; only show an approximate, safe label.
export function describeSessionDevice(userAgent) {
  const ua = typeof userAgent === "string" ? userAgent : "";
  const platform = /iPad/i.test(ua) ? "iPad"
    : /iPhone/i.test(ua) ? "iPhone"
    : /Android/i.test(ua) ? "Android"
    : /Windows/i.test(ua) ? "Windows"
    : /Macintosh|Mac OS X/i.test(ua) ? "Mac"
    : /Linux/i.test(ua) ? "Linux" : "Устройство";
  const browser = /Edg\//i.test(ua) ? "Edge"
    : /OPR\/|Opera/i.test(ua) ? "Opera"
    : /Firefox\//i.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari" : "Браузер";
  return `${browser} · ${platform}`;
}

export async function listAccountSessions({ userId, currentSessionId }) {
  const sessions = await prisma.userSession.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: [{ lastUsedAt: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      userAgent: true,
      createdAt: true,
      lastUsedAt: true,
    },
  });

  return sessions.map((session) => ({
    id: session.id,
    device: describeSessionDevice(session.userAgent),
    createdAt: session.createdAt,
    lastUsedAt: session.lastUsedAt,
    current: session.id === currentSessionId,
  }));
}

export async function revokeAccountSession({ userId, currentSessionId, sessionId }) {
  if (sessionId === currentSessionId) {
    const error = new Error("Для выхода на этом устройстве нажмите «Выйти из аккаунта».");
    error.statusCode = 409;
    error.code = "CURRENT_SESSION";
    error.expose = true;
    throw error;
  }

  const result = await prisma.userSession.deleteMany({
    where: { id: sessionId, userId },
  });

  if (result.count === 0) {
    const error = new Error("Устройство не найдено или вход уже завершён.");
    error.statusCode = 404;
    error.code = "SESSION_NOT_FOUND";
    error.expose = true;
    throw error;
  }
}

export async function revokeOtherAccountSessions({ userId, currentSessionId }) {
  const result = await prisma.userSession.deleteMany({
    where: { userId, id: { not: currentSessionId } },
  });
  return result.count;
}
