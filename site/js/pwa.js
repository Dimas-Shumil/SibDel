import { mountPwaNavigation } from './pwa-navigation.js';
import { excludedPath } from './pwa-policy.js';
import { mountInstallOffer } from './pwa-install.js';

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPwaNavigation, { once: true });
else mountPwaNavigation();

const excluded = excludedPath(location.pathname);
if (!excluded && window.isSecureContext && 'serviceWorker' in navigator) {
  boot();
}

function boot() {
  mountInstallOffer({
    storagePrefix: 'sibdel:pwa',
    icon: '/pwa/icon-192.png',
    title: 'Сибирские Деликатесы',
    description: 'Каталог и заказы — рядом, на экране телефона.',
  });

  // Let updates wait until all existing tabs/apps close. Never reload a form.
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((registration) => {
      const showUpdate = () => {
        if (!registration.waiting || document.querySelector('[data-pwa-update]')) return;
        const notice = document.createElement('aside');
        notice.className = 'pwa-panel pwa-panel--update';
        notice.dataset.pwaUpdate = '';
        notice.setAttribute('aria-label', 'Обновление приложения');
        notice.innerHTML = `<div class="pwa-panel__content"><strong>Обновление готово</strong>
          <p>Оно включится, когда вы закроете все вкладки сайта и приложение, затем откроете снова.</p></div>
          <button class="pwa-panel__close" type="button" aria-label="Закрыть сообщение об обновлении">×</button>`;
        notice.querySelector('button').addEventListener('click', () => notice.remove());
        document.body.append(notice);
      };
      showUpdate();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
        });
      });
      // Browser also checks on navigation. Avoid periodic background traffic.
      window.addEventListener('pageshow', () => { void registration.update().catch(() => {}); });
    }).catch(() => { /* Store remains usable without SW/private browser storage. */ });
}
