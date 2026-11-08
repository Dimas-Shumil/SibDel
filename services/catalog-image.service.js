import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import sharp from "sharp";

export function isSafeCatalogImagePath(value) {
  if (value === null || value === undefined || value === "") return true;
  return /^\/(?:site\/(?:images|img)|uploads)\/[\p{L}\p{N}_./-]+\.(?:webp|png|jpe?g)$/iu.test(value)
    && !value.split("/").some((part) => part === "." || part === "..");
}

export async function saveCatalogImage(file, folder) {
  if (!["categories", "production"].includes(folder)) throw new TypeError("Invalid image folder");
  const invalid = () => Object.assign(new Error("Выберите корректное изображение JPG, PNG или WebP до 8 МБ и до 12000 × 12000 пикселей."), { statusCode: 400, code: "INVALID_IMAGE", expose: true });
  if (!file) throw invalid();
  const image = sharp(file.buffer, { failOn: "error", limitInputPixels: 40000000 });
  let meta;
  try { meta = await image.metadata(); } catch { throw invalid(); }
  if (!["jpeg", "png", "webp"].includes(meta.format) || !meta.width || !meta.height || meta.width > 12000 || meta.height > 12000 || (meta.pages || 1) > 1) throw invalid();
  let buffer;
  try { buffer = await image.rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true }).webp({ quality: 88 }).toBuffer(); } catch { throw invalid(); }
  const directory = new URL(`../uploads/${folder}/`, import.meta.url);
  await fs.mkdir(directory, { recursive: true });
  const filename = `${randomUUID()}.webp`;
  await fs.writeFile(new URL(filename, directory), buffer, { flag: "wx" });
  return `/uploads/${folder}/${filename}`;
}
