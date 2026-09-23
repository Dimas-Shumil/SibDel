import * as argon2 from "argon2";

import { prisma } from "../lib/prisma.js";
import { authConfig } from "../config/auth.js";
import {
  generateOpaqueToken,
  hashOpaqueToken,
} from "../utils/tokens.js";

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
});

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 256;
const DUMMY_PASSWORD = "sibdel-auth-timing-padding-value";
let dummyPasswordHashPromise = null;

const SAFE_USER_SELECT = Object.freeze({
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
});

function isValidPasswordValue(password) {
  return (
    typeof password === "string" &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

function normalizeIpAddress(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 64);
}

function normalizeUserAgent(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 1000);
}

function getDummyPasswordHash() {
  if (!dummyPasswordHashPromise) {
    dummyPasswordHashPromise = argon2.hash(
      DUMMY_PASSWORD,
      ARGON2_OPTIONS,
    );
  }

  return dummyPasswordHashPromise;
}

async function performDummyPasswordVerification(password) {
  try {
    const dummyHash = await getDummyPasswordHash();
    await argon2.verify(dummyHash, password);
  } catch {
    // Timing padding only. Authentication still fails normally.
  }
}

async function upgradePasswordHashIfNeeded({
  userId,
  currentHash,
  password,
}) {
  if (!argon2.needsRehash(currentHash, ARGON2_OPTIONS)) {
    return;
  }

  const upgradedHash = await hashPassword(password);

  await prisma.user.updateMany({
    where: {
      id: userId,
      passwordHash: currentHash,
    },
    data: {
      passwordHash: upgradedHash,
    },
  });
}

export async function hashPassword(password) {
  if (!isValidPasswordValue(password)) {
    throw new TypeError(
      `Password length must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }

  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(
  passwordHash,
  password,
) {
  if (
    typeof passwordHash !== "string" ||
    !passwordHash ||
    !isValidPasswordValue(password)
  ) {
    return false;
  }

  try {
    return await argon2.verify(
      passwordHash,
      password,
    );
  } catch {
    return false;
  }
}

export function generateSessionToken() {
  return generateOpaqueToken(48);
}

export function hashSessionToken(token) {
  return hashOpaqueToken(token);
}

export async function authenticateUserByEmail({
  email,
  password,
}) {
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    !isValidPasswordValue(password)
  ) {
    return null;
  }

  const normalizedEmail = email
    .trim()
    .toLowerCase();

  if (!normalizedEmail) {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      ...SAFE_USER_SELECT,
      passwordHash: true,
    },
  });

  if (!user || !user.isActive) {
    await performDummyPasswordVerification(password);
    return null;
  }

  const passwordValid =
    await verifyPassword(
      user.passwordHash,
      password,
    );

  if (!passwordValid) {
    return null;
  }

  await upgradePasswordHashIfNeeded({
    userId: user.id,
    currentHash: user.passwordHash,
    password,
  });

  const {
    passwordHash: _passwordHash,
    ...safeUser
  } = user;

  return safeUser;
}

export async function createCustomerAccount({
  email,
  phone,
  firstName,
  password,
}) {
  const passwordHash = await hashPassword(password);

  return prisma.user.create({
    data: {
      email,
      phone,
      firstName,
      passwordHash,
      role: "CUSTOMER",
      isActive: true,
    },
    select: SAFE_USER_SELECT,
  });
}

export async function createSession({
  userId,
  ipAddress = null,
  userAgent = null,
}) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new TypeError("Valid userId is required.");
  }

  const now = new Date();

  const expiresAt = new Date(
    now.getTime() + authConfig.sessionTtlMs,
  );

  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);

  await prisma.$transaction(async (transaction) => {
    await transaction.userSession.deleteMany({
      where: {
        userId,
        expiresAt: {
          lte: now,
        },
      },
    });

    const sessionsToRemove =
      await transaction.userSession.findMany({
        where: {
          userId,
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: authConfig.maxSessionsPerUser - 1,
        select: {
          id: true,
        },
      });

    if (sessionsToRemove.length > 0) {
      await transaction.userSession.deleteMany({
        where: {
          id: {
            in: sessionsToRemove.map(
              (session) => session.id,
            ),
          },
        },
      });
    }

    await transaction.userSession.create({
      data: {
        userId,
        tokenHash,
        ipAddress:
          normalizeIpAddress(ipAddress),
        userAgent:
          normalizeUserAgent(userAgent),
        expiresAt,
        lastUsedAt: now,
      },
    });
  });

  return {
    token,
    expiresAt,
  };
}

export async function resolveSessionToken(token) {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 256
  ) {
    return null;
  }

  const tokenHash = hashSessionToken(token);

  const session =
    await prisma.userSession.findUnique({
      where: {
        tokenHash,
      },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        expiresAt: true,
        lastUsedAt: true,
        user: {
          select: SAFE_USER_SELECT,
        },
      },
    });

  if (!session) {
    return null;
  }

  const now = new Date();

  if (
    session.expiresAt <= now ||
    !session.user.isActive
  ) {
    await prisma.userSession.deleteMany({
      where: {
        id: session.id,
      },
    });

    return null;
  }

  const touchThreshold = new Date(
    now.getTime() -
      authConfig.sessionTouchIntervalMs,
  );

  if (session.lastUsedAt < touchThreshold) {
    await prisma.userSession.updateMany({
      where: {
        id: session.id,
        lastUsedAt: {
          lt: touchThreshold,
        },
      },
      data: {
        lastUsedAt: now,
      },
    });
  }

  return {
    session: {
      id: session.id,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      lastUsedAt: session.lastUsedAt,
    },
    user: session.user,
  };
}

export async function revokeSessionToken(token) {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 256
  ) {
    return;
  }

  const tokenHash = hashSessionToken(token);

  await prisma.userSession.deleteMany({
    where: {
      tokenHash,
    },
  });
}

export async function revokeAllUserSessions(userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new TypeError("Valid userId is required.");
  }

  await prisma.userSession.deleteMany({
    where: {
      userId,
    },
  });
}

export async function createPasswordResetRequest({
  email,
}) {
  const normalizedEmail = String(email)
    .trim()
    .toLowerCase();

  const user = await prisma.user.findUnique({
    where: {
      email: normalizedEmail,
    },
    select: {
      id: true,
      email: true,
      isActive: true,
    },
  });

  if (!user?.email || !user.isActive) {
    return null;
  }

  const now = new Date();
  const minCreatedAt = new Date(
    now.getTime() -
      authConfig.passwordResetRequestMinIntervalMs,
  );

  const recentRequest =
    await prisma.passwordResetToken.findFirst({
      where: {
        userId: user.id,
        expiresAt: {
          gt: now,
        },
        createdAt: {
          gte: minCreatedAt,
        },
      },
      select: {
        id: true,
      },
    });

  if (recentRequest) {
    return null;
  }

  const token = generateOpaqueToken(48);
  const tokenHash = hashOpaqueToken(token);
  const expiresAt = new Date(
    now.getTime() +
      authConfig.passwordResetTokenTtlMs,
  );

  const created = await prisma.$transaction(async (transaction) => {
    await transaction.passwordResetToken.deleteMany({
      where: {
        expiresAt: {
          lte: now,
        },
      },
    });

    const record =
      await transaction.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash,
          expiresAt,
        },
        select: {
          id: true,
        },
      });

    const excessTokens =
      await transaction.passwordResetToken.findMany({
        where: {
          userId: user.id,
          expiresAt: {
            gt: now,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: authConfig.maxActivePasswordResetTokens,
        select: {
          id: true,
        },
      });

    if (excessTokens.length > 0) {
      await transaction.passwordResetToken.deleteMany({
        where: {
          id: {
            in: excessTokens.map(
              (item) => item.id,
            ),
          },
        },
      });
    }

    return record;
  });

  return {
    id: created.id,
    email: user.email,
    token,
    expiresAt,
  };
}

export async function invalidatePasswordResetRequest(id) {
  if (!Number.isInteger(id) || id <= 0) {
    return;
  }

  await prisma.passwordResetToken.deleteMany({
    where: {
      id,
    },
  });
}

export async function resetPasswordWithToken({
  token,
  newPassword,
}) {
  let tokenHash;

  try {
    tokenHash = hashOpaqueToken(token);
  } catch {
    return {
      ok: false,
      reason: "INVALID_TOKEN",
    };
  }

  const now = new Date();

  const resetRecord =
    await prisma.passwordResetToken.findUnique({
      where: {
        tokenHash,
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        user: {
          select: {
            passwordHash: true,
            isActive: true,
          },
        },
      },
    });

  if (
    !resetRecord ||
    resetRecord.expiresAt <= now ||
    !resetRecord.user.isActive
  ) {
    if (resetRecord?.expiresAt <= now) {
      await prisma.passwordResetToken.deleteMany({
        where: {
          id: resetRecord.id,
        },
      });
    }

    return {
      ok: false,
      reason: "INVALID_TOKEN",
    };
  }

  const samePassword = await verifyPassword(
    resetRecord.user.passwordHash,
    newPassword,
  );

  if (samePassword) {
    return {
      ok: false,
      reason: "PASSWORD_NOT_CHANGED",
    };
  }

  const passwordHash = await hashPassword(newPassword);

  try {
    await prisma.$transaction(async (transaction) => {
      const consumed =
        await transaction.passwordResetToken.deleteMany({
          where: {
            id: resetRecord.id,
            tokenHash,
            expiresAt: {
              gt: now,
            },
          },
        });

      if (consumed.count !== 1) {
        const error = new Error("RESET_TOKEN_ALREADY_CONSUMED");
        error.code = "RESET_TOKEN_ALREADY_CONSUMED";
        throw error;
      }

      const updatedUser = await transaction.user.updateMany({
        where: {
          id: resetRecord.userId,
          isActive: true,
        },
        data: {
          passwordHash,
        },
      });

      if (updatedUser.count !== 1) {
        const error = new Error("RESET_USER_UNAVAILABLE");
        error.code = "RESET_USER_UNAVAILABLE";
        throw error;
      }

      await transaction.userSession.deleteMany({
        where: {
          userId: resetRecord.userId,
        },
      });

      await transaction.passwordResetToken.deleteMany({
        where: {
          userId: resetRecord.userId,
        },
      });
    });
  } catch (error) {
    if (
      error?.code === "RESET_TOKEN_ALREADY_CONSUMED" ||
      error?.code === "RESET_USER_UNAVAILABLE"
    ) {
      return {
        ok: false,
        reason: "INVALID_TOKEN",
      };
    }

    throw error;
  }

  return {
    ok: true,
    userId: resetRecord.userId,
  };
}
