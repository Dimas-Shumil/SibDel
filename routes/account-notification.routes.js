import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { createAccountNotificationService } from '../services/account-notification.service.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRoles } from '../middleware/roles.js';
import { validate } from '../middleware/validate.js';

export function buildAccountNotificationRouter(service) {
  const router = Router();
  const id = z.coerce.number().int().positive().max(2147483647);
  const wrap = (fn) => async (req, res, next) => {
    try { res.json({ ok: true, ...(await fn(req)) }); }
    catch (error) {
      next(error.expose ? error : Object.assign(Error('Не удалось загрузить уведомления. Попробуйте снова.'), {
        statusCode: 500, code: 'NOTIFICATION_STORAGE', expose: true,
      }));
    }
  };
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  });
  router.use(requireAuth, requireRoles('CUSTOMER'));
  router.get('/', validate({ query: z.object({
    before: id.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    category: z.enum(['ORDER', 'SUBSCRIPTION', 'MARKETING']).optional(),
    unread: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  }).strict() }), wrap((req) => service.list(req.user.id, req.validated.query)));
  router.get('/unread-count', wrap(async (req) => ({ unreadCount: await service.unreadCount(req.user.id) })));
  router.post('/read-all', validate({ body: z.object({ throughId: z.number().int().positive().max(2147483647) }).strict() }),
    wrap(async (req) => ({ changed: await service.markAllRead(req.user.id, req.validated.body.throughId) })));
  router.patch('/:id/read', validate({ params: z.object({ id }).strict(), body: z.object({}).strict() }),
    wrap(async (req) => ({ notification: await service.markRead(req.user.id, req.validated.params.id) })));
  return router;
}

export default buildAccountNotificationRouter(createAccountNotificationService(prisma));
