export const INSTALL_DELAY_MS = 10_000;
export const VISIT_IDLE_MS = 30 * 60_000;

export function isStandalone(win) {
  return Boolean(win.navigator.standalone
    || win.matchMedia('(display-mode: standalone)').matches
    || win.matchMedia('(display-mode: fullscreen)').matches);
}

export function canShowIosHelp(nav) {
  const ua = nav.userAgent || '';
  const ios = /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  // Conservative fallback: embedded browsers and third-party menus differ.
  return ios && /Version\/\d+/.test(ua) && /Safari\//.test(ua)
    && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}

export function nextVisit(previous, now) {
  if (!previous || !Number.isFinite(previous.lastSeen)
    || !Number.isFinite(previous.startedAt) || now < previous.lastSeen
    || now - previous.lastSeen >= VISIT_IDLE_MS) {
    return { startedAt: now, lastSeen: now, handled: false };
  }
  return { ...previous, lastSeen: now };
}

export function excludedPath(pathname) {
  return /^\/(?:admin|checkout|login|register|forgot-password|reset-password)(?:\/|\.html|$)/.test(pathname);
}

export function installEligible({ standalone, installed, handled, elapsed, supported, visible, excluded }) {
  return !standalone && !installed && !handled && elapsed >= INSTALL_DELAY_MS
    && supported && visible && !excluded;
}
