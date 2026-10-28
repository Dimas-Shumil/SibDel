import helmet from 'helmet';

import { env } from '../config/env.js';

const helmetMiddleware = helmet({
  contentSecurityPolicy: {
    useDefaults: true,

    directives: {
      defaultSrc: ["'self'"],

      baseUri: ["'self'"],

      objectSrc: ["'none'"],

      frameSrc: ["'self'", 'https://yandex.ru'],

      frameAncestors: ["'none'"],

      scriptSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      scriptSrcAttr: ["'none'"],

      styleSrc: ["'self'", "'unsafe-inline'"],

      imgSrc: ["'self'", 'data:', 'blob:'],

      fontSrc: ["'self'", 'data:'],

      connectSrc: ["'self'"],

      formAction: ["'self'"],

      ...(env.NODE_ENV === 'production'
        ? {
            upgradeInsecureRequests: [],
          }
        : {
            upgradeInsecureRequests: null,
          }),
    },
  },

  strictTransportSecurity:
    env.NODE_ENV === 'production'
      ? {
          maxAge: 31_536_000,
          includeSubDomains: true,
          preload: true,
        }
      : false,

  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },

  crossOriginEmbedderPolicy: false,

  crossOriginResourcePolicy: {
    policy: 'same-origin',
  },
});

export function securityMiddleware(req, res, next) {
  helmetMiddleware(req, res, (error) => {
    if (error) {
      return next(error);
    }

    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()',
    );

    return next();
  });
}
