import { excludedPath, isStandalone } from './pwa-policy.js';

export function navigationSection(pathname) {
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/index.html') return 'home';
  if (/^\/(catalog|product)(?:\.html)?$/.test(path)) return 'catalog';
  if (/^\/promotions(?:\.html)?$/.test(path)) return 'promotions';
  if (/^\/cart(?:\.html)?$/.test(path)) return 'cart';
  if (/^\/account(?:\/|$)/.test(path)) return 'profile';
  return null;
}

export function mountPwaNavigation() {
  if (document.querySelector('[data-pwa-navigation]')) return;
  const mobile = window.matchMedia('(max-width: 767px)');
  const display = window.matchMedia('(display-mode: standalone)');
  const full = window.matchMedia('(display-mode: fullscreen)');
  let nav;
  function update() {
    const input = document.activeElement;
    // Native keyboards can resize either the layout or visual viewport.
    // Hide while editing rather than covering fields on either implementation.
    const editing = input?.matches('textarea, select, [contenteditable="true"], input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=color]):not([type=file])');
    const eligible = mobile.matches && isStandalone(window) && !excludedPath(location.pathname);
    if (eligible && !nav) nav = createNavigation();
    const shown = eligible && !editing;
    if (nav) nav.hidden = !shown;
    document.body.classList.toggle('pwa-has-nav', shown);
    if (!nav) return;
    const active = navigationSection(location.pathname);
    for (const link of nav.querySelectorAll('[data-pwa-section]')) {
      if (link.dataset.pwaSection === active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    updateCart();
  }
  function createNavigation() {
    const node = document.createElement('nav');
    node.className = 'pwa-navigation'; node.dataset.pwaNavigation = '';
    node.setAttribute('aria-label', 'Главная навигация приложения');
    const links = [
      ['home', '/', 'Главная', '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>'],
      ['catalog', '/catalog.html', 'Каталог', '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'],
      ['promotions', '/promotions.html', 'Акции', '<path d="m6 18 12-12"/><circle cx="7" cy="7" r="3"/><circle cx="17" cy="17" r="3"/>'],
      ['cart', '/cart.html', 'Корзина', '<path d="M2 3h3l3 12h11l3-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>'],
      ['profile', '/account/', 'Профиль', '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-6 3-9 8-9s8 3 8 9"/>'],
    ];
    for (const [section, href, label, icon] of links) {
      const link = document.createElement('a'); link.className = 'pwa-navigation__link'; link.href = href; link.dataset.pwaSection = section;
      // Only constant, repository-owned SVG markup is used here.
      link.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg><span>${label}</span>`;
      if (section === 'cart') {
        const count = document.createElement('span'); count.className = 'pwa-navigation__count'; count.dataset.pwaCartCount = ''; count.hidden = true;
        link.append(count);
      }
      node.append(link);
    }
    document.body.append(node); return node;
  }
  function updateCart() {
    if (!nav) return;
    const quantity = Number(window.SibDelCommerce?.getCartQuantity() || 0);
    const count = nav.querySelector('[data-pwa-cart-count]');
    count.hidden = !Number.isFinite(quantity) || quantity <= 0;
    count.textContent = quantity > 99 ? '99+' : new Intl.NumberFormat('ru', { maximumFractionDigits: 3 }).format(quantity);
    nav.querySelector('[data-pwa-section=cart]').setAttribute('aria-label', quantity > 0 ? `Корзина: ${count.textContent}` : 'Корзина');
  }
  for (const media of [mobile, display, full]) media.addEventListener('change', update);
  document.addEventListener('focusin', update);
  document.addEventListener('focusout', () => setTimeout(update, 0));
  window.visualViewport?.addEventListener('resize', update);
  window.addEventListener('pageshow', update);
  window.addEventListener('popstate', update);
  document.addEventListener('sibdel:account-view', update);
  document.addEventListener('sibdel:commerce-state-changed', updateCart);
  document.addEventListener('sibdel:commerce-ui-updated', updateCart);
  update();
}
