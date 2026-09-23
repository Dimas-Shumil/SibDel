import {
  createHash,
  randomBytes,
} from "node:crypto";

export function generateOpaqueToken(byteLength = 48) {
  if (!Number.isInteger(byteLength) || byteLength < 32 || byteLength > 128) {
    throw new TypeError("Token byte length must be between 32 and 128.");
  }

  return randomBytes(byteLength).toString("base64url");
}

export function hashOpaqueToken(token) {
  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > 512
  ) {
    throw new TypeError("Invalid opaque token.");
  }

  return createHash("sha256")
    .update(token)
    .digest("hex");
}
