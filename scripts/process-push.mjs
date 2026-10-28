import { prisma } from '../lib/prisma.js';
import { pushConfig } from '../config/push.js';
import { createPushWorker } from '../services/push-worker.service.js';
import { createPushSender } from '../services/push-transport.js';
const limit = Number(process.argv[2] || 100);
try {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw Error('INVALID_LIMIT');
  const counts = await createPushWorker(prisma, createPushSender(pushConfig), pushConfig).run(limit);
  console.log(JSON.stringify({ event: 'push_worker_completed', counts }));
} catch (error) {
  console.error(JSON.stringify({ event: 'push_worker_failed', code: /^[A-Z0-9_]{1,50}$/.test(error.code || '') ? error.code : 'WORKER_FAILED' }));
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
