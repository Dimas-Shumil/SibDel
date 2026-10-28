export async function pushFetch(base, path, method = 'GET', body) {
  const response = await fetch(base + path, { method, credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw Error(data.error?.message || data.message || 'Не удалось выполнить запрос.');
  return data;
}
export function pushSupportMessage() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  if (ios && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches) return 'На iPhone откройте приложение с экрана Домой. PUSH доступны начиная с iOS 16.4.';
  if (!isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'Этот браузер не поддерживает PUSH. Настройки согласия остаются доступными.';
  if (Notification.permission === 'denied') return 'Уведомления запрещены в настройках браузера. Разрешите их для сайта и откройте эту страницу снова.';
  return '';
}
export async function preparePush() {
  const reason = pushSupportMessage();
  if (reason) throw Error(reason);
  await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
  const registration = await navigator.serviceWorker.ready;
  const channel = new MessageChannel();
  const capable = await new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 1500);
    channel.port1.onmessage = (event) => { clearTimeout(timeout); resolve(event.data?.push === true); };
    registration.active?.postMessage({ type: 'SIBDEL_PUSH_VERSION' }, [channel.port2]);
  });
  channel.port1.close();
  if (!capable) throw Error('Обновление приложения готово. Закройте все вкладки сайта и приложение, затем откройте снова для подключения PUSH.');
  return registration;
}
export async function connectPush(base, config, registration, permission) {
  if (await permission !== 'granted') throw Error('Разрешение не получено. Его можно включить позже.');
  const bytes = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - config.publicKey.length % 4) % 4)), (char) => char.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription()
    || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  return pushFetch(base, '/devices', 'POST', subscription.toJSON());
}
export async function disconnectPush(base, device) {
  // Revoke on server first, even when browser unsubscribe fails/offline state changes.
  await pushFetch(base, `/devices/${device.id}`, 'DELETE');
  if (device.current) {
    const registration = await navigator.serviceWorker?.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }
}
