import path from 'node:path';

// Keep the root-scoped worker out of static/SEO middleware and HTTP caches.
export function pwaMiddleware(publicPath) {
  const resources = new Map([
    ['/sw.js', ['sw.js', 'application/javascript', 'no-store']],
    ['/manifest.webmanifest', ['manifest.webmanifest', 'application/manifest+json', 'no-cache']],
    ['/offline.html', ['offline.html', 'text/html', 'no-cache']],
  ]);
  return (req, res, next) => {
    if (/^\/(?:api|account|admin)(?:\/|$)/.test(req.path)
      || /^\/(?:cart|checkout|login|register|forgot-password|reset-password)(?:\.html)?\/?$/.test(req.path)) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
    }
    const resource = resources.get(req.path);
    if (!resource || !['GET', 'HEAD'].includes(req.method)) return next();
    res.setHeader('Cache-Control', resource[2]);
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    if (req.path === '/sw.js') res.setHeader('Service-Worker-Allowed', '/');
    res.type(resource[1]);
    return res.sendFile(path.join(publicPath, resource[0]));
  };
}
