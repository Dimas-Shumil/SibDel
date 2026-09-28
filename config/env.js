import "dotenv/config";
import { z } from "zod";

const booleanFromEnv = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    PORT: z.coerce.number().int().min(1).max(65535).default(3001),

    HOST: z.string().trim().min(1).default("127.0.0.1"),

    DATABASE_URL: z
      .string()
      .trim()
      .min(1, "DATABASE_URL is required")
      .refine(
        (value) =>
          value.startsWith("postgresql://") ||
          value.startsWith("postgres://"),
        "DATABASE_URL must be a PostgreSQL connection string",
      ),

    APP_NAME: z.string().trim().min(1).default("Siberian Delicacies"),

    APP_URL: z
      .string()
      .trim()
      .url("APP_URL must be a valid URL")
      .default("http://localhost:3001"),

    SESSION_COOKIE_NAME: z
      .string()
      .trim()
      .min(1)
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "SESSION_COOKIE_NAME contains invalid characters",
      )
      .default("sibdel_session"),

    SESSION_SECRET: z
      .string()
      .min(64, "SESSION_SECRET must contain at least 64 characters"),

    SESSION_TTL_DAYS: z.coerce
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30),

    TRUST_PROXY: z
      .enum(["0", "1"])
      .default("0")
      .transform((value) => Number(value)),

    UPLOAD_MAX_FILE_SIZE_MB: z.coerce
      .number()
      .positive()
      .max(25)
      .default(8),

    UPLOAD_MAX_FILES: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(10),

    UPLOAD_ALLOWED_MIME_TYPES: z
      .string()
      .default("image/jpeg,image/png,image/webp")
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    SMTP_HOST: z.string().trim().min(1, "SMTP_HOST is required"),

    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),

    SMTP_SECURE: booleanFromEnv.default(true),

    SMTP_USER: z.string().trim().min(1, "SMTP_USER is required"),

    SMTP_PASS: z.string().min(1, "SMTP_PASS is required"),

    TO_EMAIL: z
      .string()
      .trim()
      .email("TO_EMAIL must be a valid email address"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== "production") {
      return;
    }

    let appUrl;

    try {
      appUrl = new URL(env.APP_URL);
    } catch {
      return;
    }

    if (appUrl.protocol !== "https:") {
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "APP_URL must use HTTPS in production",
      });
    }

    if (env.TRUST_PROXY !== 1) {
      ctx.addIssue({
        code: "custom",
        path: ["TRUST_PROXY"],
        message: "TRUST_PROXY must be 1 in production behind Nginx",
      });
    }

    if (
      env.SESSION_SECRET.includes("replace") ||
      env.SESSION_SECRET.includes("change_me")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message: "SESSION_SECRET must not use a placeholder in production",
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const errors = parsedEnv.error.issues
    .map((issue) => {
      const field = issue.path.join(".") || "environment";
      return `${field}: ${issue.message}`;
    })
    .join("\n");

  throw new Error(`Invalid environment configuration:\n${errors}`);
}

export const env = Object.freeze(parsedEnv.data);
