export function createHealthHandler({ probe, isTest = false, fingerprint, timeoutMs = 3000 }) {
  // Share one probe across callers; a stalled DB must not queue a new query per request.
  let pending;
  return async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    let timer;
    try {
      if (!pending) {
        pending = Promise.resolve().then(probe).finally(() => { pending = undefined; });
      }
      await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Health timeout")), timeoutMs);
        }),
      ]);
      return res.status(200).json({
        ok: true, service: "siberian-delicacies", database: "ok",
        ...(isTest ? { testEnvironment: { databaseFingerprint: fingerprint() } } : {}),
      });
    } catch {
      return res.status(503).json({ ok: false, service: "siberian-delicacies", database: "unavailable" });
    } finally { clearTimeout(timer); }
  };
}
