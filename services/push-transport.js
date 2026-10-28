import https from 'node:https';
import webpush from 'web-push';
import { safeEndpoint } from '../utils/push-policy.js';

export function createPushSender(config) {
  return (device, payload) => new Promise((resolve, reject) => {
    let request;
    let deadline;
    const finish = (error) => { clearTimeout(deadline); if (error) reject(error); else resolve(); };
    try {
      safeEndpoint(device.endpoint);
      const details = webpush.generateRequestDetails({ endpoint: device.endpoint,
        keys: { p256dh: device.p256dh, auth: device.auth } }, JSON.stringify(payload), {
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey },
        TTL: payload.openPath === '/api/admin/push/open' ? 60 : 300, urgency: 'normal',
        topic: `sibdel-${payload.id}`,
      });
      request = https.request(details.endpoint, { method: details.method, headers: details.headers }, (response) => {
        response.resume();
        finish(response.statusCode >= 200 && response.statusCode < 300 ? null : Object.assign(Error('Push rejected'), { statusCode: response.statusCode }));
      });
      request.on('error', () => finish(Error('Push transport failure')));
      // Absolute deadline, not only a socket idle timeout. No automatic redirects/retries.
      deadline = setTimeout(() => request.destroy(Error('Push deadline')), 10_000);
      request.end(details.body);
    } catch { finish(Error('Push request invalid')); }
  });
}
