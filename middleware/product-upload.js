import path from "node:path";

import multer from "multer";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const ALLOWED_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function createUploadError(message, code = "INVALID_PRODUCT_IMAGE") {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = code;
  error.expose = true;
  return error;
}

export const productImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 10,
    fields: 10,
    parts: 20,
  },
  fileFilter(_req, file, callback) {
    const extension = path.extname(file.originalname || "").toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(extension)) {
      callback(
        createUploadError(
          "Разрешены только изображения JPG, PNG и WebP.",
          "UNSUPPORTED_PRODUCT_IMAGE",
        ),
      );
      return;
    }

    callback(null, true);
  },
});
