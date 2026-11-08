import { mountInstallOffer } from './pwa-install.js';

if (window.isSecureContext && document.querySelector('[data-admin-app]')) {
  mountInstallOffer({
    storagePrefix: 'sibdel:admin-pwa',
    icon: '/pwa/admin-icon-192.png',
    title: 'Админка · Сибирские Деликатесы',
    description: 'Открывайте заказы, склад и каталог с рабочего стола или экрана телефона.',
  });
}
