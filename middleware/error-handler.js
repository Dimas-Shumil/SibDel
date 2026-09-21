import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

function normalizeError(error) {
  let statusCode =
    Number.isInteger(error?.statusCode)
      ? error.statusCode
      : Number.isInteger(error?.status)
        ? error.status
        : 500;

  let code =
    typeof error?.code === "string"
      ? error.code
      : "INTERNAL_SERVER_ERROR";

  let message =
    typeof error?.message === "string"
      ? error.message
      : "Произошла внутренняя ошибка сервера.";

  let details = error?.details;

  if (error?.type === "entity.parse.failed") {
    statusCode = 400;
    code = "INVALID_JSON";
    message = "Некорректный JSON в теле запроса.";
    details = undefined;
  }

  if (error?.type === "entity.too.large") {
    statusCode = 413;
    code = "PAYLOAD_TOO_LARGE";
    message = "Размер запроса превышает допустимый лимит.";
    details = undefined;
  }

  if (error?.name === "MulterError") {
    code = "UPLOAD_ERROR";
    details = undefined;

    if (error.code === "LIMIT_FILE_SIZE") {
      statusCode = 413;
      message = "Загружаемый файл превышает допустимый размер.";
    } else if (error.code === "LIMIT_FILE_COUNT") {
      statusCode = 400;
      message = "Превышено допустимое количество файлов.";
    } else {
      statusCode = 400;
      message = "Ошибка загрузки файла.";
    }
  }

  if (error?.code === "P2002") {
    statusCode = 409;
    code = "RESOURCE_CONFLICT";
    message = "Запись с такими данными уже существует.";
    details = undefined;
  }

  if (error?.code === "P2003") {
    statusCode = 409;
    code = "RELATION_CONFLICT";
    message = "Операция нарушает связанные данные.";
    details = undefined;
  }

  if (error?.code === "P2025") {
    statusCode = 404;
    code = "RESOURCE_NOT_FOUND";
    message = "Запрашиваемая запись не найдена.";
    details = undefined;
  }

  const expose =
    error?.expose === true ||
    statusCode < 500 ||
    env.NODE_ENV === "development";

  if (!expose) {
    code = "INTERNAL_SERVER_ERROR";
    message = "Произошла внутренняя ошибка сервера.";
    details = undefined;
  }

  return {
    statusCode,
    code,
    message,
    details,
  };
}

export function notFoundHandler(req, _res, next) {
  const error = new Error("Маршрут не найден.");

  error.statusCode = 404;
  error.code = "NOT_FOUND";
  error.expose = true;

  return next(error);
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const normalized = normalizeError(error);

  const context = {
    method: req.method,
    path: req.path,
    statusCode: normalized.statusCode,
    errorCode: normalized.code,
  };

  const isExpectedAnonymousAuthCheck =
    req.method === "GET" &&
    req.path === "/api/auth/me" &&
    normalized.statusCode === 401 &&
    normalized.code === "UNAUTHORIZED";

  const isChromeDevToolsProbe =
    req.method === "GET" &&
    req.path === "/.well-known/appspecific/com.chrome.devtools.json" &&
    normalized.statusCode === 404;

  if (normalized.statusCode >= 500) {
    logger.error(
      {
        ...context,
        err: error,
      },
      "Request failed",
    );
  } else if (!isExpectedAnonymousAuthCheck && !isChromeDevToolsProbe) {
    logger.warn(context, "Request rejected");
  }

  const response = {
    ok: false,

    error: {
      code: normalized.code,
      message: normalized.message,
    },
  };

  if (normalized.details !== undefined) {
    response.error.details = normalized.details;
  }

  return res.status(normalized.statusCode).json(response);
}
