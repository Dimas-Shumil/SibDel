import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { pushConfig, CONSENT_VERSION, CONSENT_TEXT } from '../config/push.js';
import { createPushService } from '../services/push.service.js';
import { requireAuth } from '../middleware/auth.js';
import { adminAuth } from '../middleware/admin-auth.js';
import { requireRoles } from '../middleware/roles.js';
import { sensitiveRateLimiter } from '../middleware/rate-limit.js';
import { validate } from '../middleware/validate.js';

export function buildPushRouters(service) {
  const customer = Router(), admin = Router();
  const wrap = (fn) => async (req, res, next) => {
    try { res.json({ ok: true, ...(await fn(req)) }); }
    catch (error) {
      // ORM errors can include parameter values; never log push keys/endpoints.
      next(error.expose ? error : Object.assign(Error('PUSH временно недоступны.'), { code: 'PUSH_STORAGE', statusCode: 500, expose: true }));
    }
  };
  const id = z.object({ id: z.coerce.number().int().positive() }).strict();
  const open = z.object({ id: z.number().int().positive() }).strict();
  const key = z.string().uuid();
  const content = { title: z.string().trim().min(1).max(80), body: z.string().trim().min(1).max(240), url: z.string().max(500), imageUrl: z.string().max(500).nullable().optional().default(null) };
  const device = z.object({ endpoint: z.string().max(2048), expirationTime: z.number().nullable().optional(), keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }).strict() }).strict();
  function shared(router) {
    router.get('/config', wrap(() => service.configuration()));
    router.get('/devices', wrap(async (req) => ({ devices: await service.devices(req.user.id, req.auth.session.id) })));
    router.post('/devices', sensitiveRateLimiter, validate({ body: device }), wrap(async (req) => service.subscribe(req.user.id, req.auth.session.id, req.validated.body)));
    router.delete('/devices/:id', sensitiveRateLimiter, validate({ params: id }), wrap(async (req) => { await service.unsubscribe(req.user.id, req.validated.params.id); return {}; }));
    router.post('/open', validate({ body: open }), wrap(async (req) => { await service.opened(req.user.id, req.validated.body.id); return {}; }));
  }
  customer.use(requireAuth, requireRoles('CUSTOMER'));
  admin.use(adminAuth, requireRoles('OWNER'));
  shared(customer); shared(admin);
  customer.get('/preferences', wrap(async (req) => ({ preferences: await service.preferences(req.user.id) })));
  customer.put('/preferences', sensitiveRateLimiter, validate({ body: z.object({ orders: z.boolean(), subscriptions: z.boolean() }).strict() }), wrap(async (req) => ({ preferences: await service.setPreferences(req.user.id, req.validated.body) })));
  customer.post('/consent', sensitiveRateLimiter, validate({ body: z.object({ granted: z.boolean(), version: z.string().max(50) }).strict() }), wrap(async (req) => service.consent(req.user.id, req.auth.session.id, req.validated.body.granted, req.validated.body.version)));
  admin.get('/campaigns', validate({ query: z.object({ page: z.coerce.number().int().positive().max(100000).default(1) }).strict() }), wrap((req) => service.campaigns(req.validated.query.page)));
  admin.post('/campaigns', sensitiveRateLimiter, validate({ body: z.object({ ...content, requestKey: key, audience: z.enum(['ALL','SUBSCRIBERS']) }).strict() }), wrap(async (req) => ({ campaign: await service.createCampaign(req.user.id, req.validated.body) })));
  admin.post('/campaigns/:id/schedule', sensitiveRateLimiter, validate({ params: id, body: z.object({ at: z.string().datetime({ offset: true }).nullable().optional().default(null) }).strict() }), wrap(async (req) => ({ campaign: await service.schedule(req.user.id, req.validated.params.id, req.validated.body.at) })));
  admin.post('/campaigns/:id/cancel', sensitiveRateLimiter, validate({ params: id }), wrap(async (req) => { await service.cancel(req.user.id, req.validated.params.id); return {}; }));
  admin.post('/test', sensitiveRateLimiter, validate({ body: z.object({ ...content, requestKey: key, deviceId: z.number().int().positive() }).strict() }), wrap(async (req) => service.test(req.user.id, req.auth.session.id, req.validated.body)));
  return { customer, admin };
}
const routers = buildPushRouters(createPushService(prisma, pushConfig, { version: CONSENT_VERSION, text: CONSENT_TEXT }));
export const customerPushRouter = routers.customer;
export const adminPushRouter = routers.admin;
