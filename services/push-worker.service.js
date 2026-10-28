import { runSerializable } from '../utils/transactions.js';
import { deviceEligible, classifyPushFailure } from '../utils/push-policy.js';

// External I/O is outside database transactions. PENDING -> SENDING is one-way:
// an interrupted/ambiguous send is UNKNOWN, never retried automatically.
export function createPushWorker(db, sender, config) {
  async function expand() {
    return runSerializable(db, async (tx) => {
      const lock = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(1128, 11) AS locked`;
      if (!lock[0]?.locked) return;
      const now = new Date();
      await tx.pushJob.updateMany({ where: { status: 'SENDING', attemptedAt: { lt: new Date(+now - 10 * 60_000) } }, data: { status: 'UNKNOWN', errorCode: 'WORKER_INTERRUPTED', finishedAt: now } });
      const campaign = config.marketingEnabled ? await tx.pushCampaign.findFirst({ where: { OR: [{ status: 'SCHEDULED', scheduledAt: { lte: now } }, { status: 'PROCESSING' }] }, orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }] }) : null;
      if (campaign) {
        await tx.pushCampaign.update({ where: { id: campaign.id }, data: { status: 'PROCESSING' } });
        const users = await tx.user.findMany({ where: { id: { gt: campaign.cursorUserId }, role: 'CUSTOMER', isActive: true, pushPreference: { marketing: true, marketingVersion: config.consentVersion },
          ...(campaign.audience === 'SUBSCRIBERS' ? { subscriptions: { some: { status: 'ACTIVE', intervalDays: { not: null } } } } : {}) }, orderBy: { id: 'asc' }, take: 100, select: { id: true } });
        for (const user of users) {
          const eligible = await tx.pushPreference.updateMany({ where: { userId: user.id, marketing: true, marketingVersion: config.consentVersion, OR: [{ lastMarketingAt: null }, { lastMarketingAt: { lte: new Date(+now - 86400_000) } }] }, data: { lastMarketingAt: now } });
          if (!eligible.count) continue;
          await tx.customerNotification.upsert({ where: { eventKey: `campaign:${campaign.id}:${user.id}` }, update: {}, create: {
            userId: user.id, campaignId: campaign.id, eventKey: `campaign:${campaign.id}:${user.id}`, category: 'MARKETING', title: campaign.title, body: campaign.body, url: campaign.url, imageUrl: campaign.imageUrl,
          } });
        }
        await tx.pushCampaign.update({ where: { id: campaign.id }, data: { cursorUserId: users.at(-1)?.id ?? campaign.cursorUserId, ...(users.length < 100 ? { status: 'QUEUED' } : {}) } });
      }
      const serviceEvents = await tx.customerNotification.findMany({ where: { queuedAt: null, category: { not: 'MARKETING' } }, orderBy: { id: 'asc' }, take: 100 });
      const events = [...serviceEvents, ...(serviceEvents.length < 100 ? await tx.customerNotification.findMany({ where: { queuedAt: null, category: 'MARKETING' }, orderBy: { id: 'asc' }, take: 100 - serviceEvents.length }) : [])];
      for (const event of events) {
        const devices = await tx.pushDevice.findMany({ where: { userId: event.userId, disabledAt: null, session: { expiresAt: { gt: now } } }, select: { id: true } });
        if (devices.length) await tx.pushJob.createMany({ data: devices.map((device) => ({ notificationId: event.id, deviceId: device.id })), skipDuplicates: true });
        await tx.customerNotification.update({ where: { id: event.id }, data: { queuedAt: now } });
      }
      const queued = await tx.pushCampaign.findMany({ where: { status: 'QUEUED' }, select: { id: true }, take: 100 });
      for (const item of queued) {
        const pending = await tx.pushJob.count({ where: { status: { in: ['PENDING','SENDING'] }, notification: { campaignId: item.id } } });
        const unexpanded = await tx.customerNotification.count({ where: { campaignId: item.id, queuedAt: null } });
        if (!pending && !unexpanded) await tx.pushCampaign.update({ where: { id: item.id }, data: { status: 'COMPLETED' } });
      }
    });
  }
  async function sendJob(id) {
    const claimed = await db.pushJob.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'SENDING', attemptedAt: new Date(), attempts: { increment: 1 } } });
    if (!claimed.count) return 'ALREADY_CLAIMED';
    const job = await db.pushJob.findUnique({ where: { id }, include: { notification: true, device: { include: { session: true, user: { include: { pushPreference: true } } } } } });
    if (!job) return 'DEVICE_REMOVED';
    const ageLimit = job.notification.category === 'TEST' ? 5 * 60_000 : 86400_000;
    if (+job.notification.createdAt < Date.now() - ageLimit) {
      await db.pushJob.updateMany({ where: { id, status: 'SENDING' }, data: { status: 'SKIPPED', errorCode: 'STALE_NOTIFICATION', finishedAt: new Date() } });
      return 'SKIPPED';
    }
    if (!deviceEligible(job.device, job.notification)
      || (job.notification.category === 'MARKETING' && (!config.marketingEnabled || job.device.user.pushPreference?.marketingVersion !== config.consentVersion))) {
      await db.pushJob.updateMany({ where: { id, status: 'SENDING' }, data: { status: 'SKIPPED', errorCode: 'NO_PERMISSION', finishedAt: new Date() } });
      return 'SKIPPED';
    }
    // Never put the endpoint, encryption keys, user/order IDs in logs/push text.
    const n = job.notification;
    const payload = { id: n.id, title: n.title, body: n.body, url: n.url, image: n.imageUrl,
      openPath: n.category === 'TEST' ? '/api/admin/push/open' : '/api/push/open' };
    try {
      await sender(job.device, payload);
    } catch (error) {
      const failure = classifyPushFailure(error);
      await db.pushJob.updateMany({ where: { id, status: 'SENDING' }, data: { status: failure.status, errorCode: failure.errorCode, finishedAt: new Date() } });
      // Preserve job statistics; retaining a disabled device tombstone avoids cascade loss.
      if (failure.remove) await db.pushDevice.updateMany({ where: { id: job.device.id }, data: { disabledAt: new Date() } });
      return failure.status;
    }
    // If DB commit fails after acceptance, the job stays SENDING -> UNKNOWN.
    // Do not send again: push-service acknowledgement isn't user delivery.
    await db.pushJob.updateMany({ where: { id, status: 'SENDING' }, data: { status: 'ACCEPTED', finishedAt: new Date() } });
    return 'ACCEPTED';
  }
  return {
    expand, sendJob,
    async run(limit = 100) {
      if (!config.enabled) return { disabled: true };
      await expand();
      const size = Math.min(limit, 200);
      const serviceJobs = await db.pushJob.findMany({ where: { status: 'PENDING', notification: { category: { not: 'MARKETING' } } }, orderBy: { id: 'asc' }, take: size, select: { id: true } });
      const jobs = [...serviceJobs, ...(serviceJobs.length < size ? await db.pushJob.findMany({ where: { status: 'PENDING', notification: { category: 'MARKETING' } }, orderBy: { id: 'asc' }, take: size - serviceJobs.length, select: { id: true } }) : [])];
      const counts = {};
      for (const job of jobs) {
        const result = await sendJob(job.id);
        counts[result] = (counts[result] || 0) + 1;
        // Bound total outbound rate to roughly five per second per worker.
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return counts;
    },
  };
}
