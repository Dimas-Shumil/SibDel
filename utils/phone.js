export function normalizeRussianPhone(value) {
  if (typeof value !== "string") {
    return null;
  }

  let digits = value.replace(/\D/g, "");

  if (digits.length === 10) {
    digits = `7${digits}`;
  } else if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }

  if (!/^7\d{10}$/.test(digits)) {
    return null;
  }

  return `+${digits}`;
}
