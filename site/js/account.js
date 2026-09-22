const ACCOUNT_NAVIGATION_URL = '/components/account-navigation.html';

const ACCOUNT_ROUTES = {
  '/account': {
    view: 'dashboard',
    title: 'Личный кабинет — Сибирские Деликатесы',
    mobileTitle: 'Главная',
  },
  '/account/orders': {
    view: 'orders',
    title: 'Мои заказы — Сибирские Деликатесы',
    mobileTitle: 'Заказы',
  },
  '/account/order': {
    view: 'order',
    title: 'Заказ — Сибирские Деликатесы',
    mobileTitle: 'Заказ',
  },
  '/account/favorites': {
    view: 'favorites',
    title: 'Избранное — Сибирские Деликатесы',
    mobileTitle: 'Избранное',
  },
  '/account/addresses': {
    view: 'addresses',
    title: 'Адреса доставки — Сибирские Деликатесы',
    mobileTitle: 'Адреса',
  },
  '/account/settings': {
    view: 'settings',
    title: 'Настройки — Сибирские Деликатесы',
    mobileTitle: 'Настройки',
  },
  '/account/subscription': {
    view: 'subscription',
    title: 'Подписка — Сибирские Деликатесы',
    mobileTitle: 'Подписка',
  },
};

const accountStore = {
  user: null,
  orders: [],
  addresses: [],
  subscription: null,
  lastRemovedFavorites: [],
  loaded: {
    orders: false,
    addresses: false,
    subscription: false,
  },
  backendAvailable: {
    orders: false,
    addresses: false,
    subscription: false,
  },
};

function escapeAccountHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function parseAccountJson(response) {
  return response.json().catch(() => null);
}

async function getAccountUser() {
  const response = await fetch('/api/auth/me', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });

  const payload = await parseAccountJson(response);

  if (response.status === 401) {
    window.location.replace('/login.html');
    return null;
  }

  if (!response.ok || !payload?.ok || !payload.user) {
    throw new Error(payload?.error?.message || 'Не удалось загрузить профиль.');
  }

  return payload.user;
}

async function logoutAccount() {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  });

  if (!response.ok) {
    const payload = await parseAccountJson(response);
    throw new Error(payload?.error?.message || 'Не удалось выйти из аккаунта.');
  }

  window.location.replace('/login.html');
}

// Эти источники данных намеренно не вызывают несуществующие API.
// Их сигнатуры готовы для подключения серверных маршрутов кабинета.
async function loadOrders() {
  return { data: [], backendAvailable: false };
}

async function loadAddresses() {
  return { data: [], backendAvailable: false };
}

async function loadSubscription() {
  return { data: null, backendAvailable: false };
}

async function loadAccountNavigation() {
  const mount = document.querySelector('[data-component="account-navigation"]');

  if (!mount) {
    return;
  }

  if (mount.children.length) {
    return;
  }

  const response = await fetch(ACCOUNT_NAVIGATION_URL, {
    method: 'GET',
    headers: { Accept: 'text/html' },
  });

  if (!response.ok) {
    throw new Error('Не удалось загрузить навигацию кабинета.');
  }

  const template = document.createElement('template');
  template.innerHTML = (await response.text()).trim();
  const navigation = template.content.firstElementChild;

  if (!navigation) {
    throw new Error('Компонент навигации кабинета пуст.');
  }

  mount.replaceWith(navigation);
}

function getAccountPage() {
  return document.querySelector('[data-account-page]');
}

function normalizeAccountPath(pathname = window.location.pathname) {
  const clean = String(pathname || '/account').replace(/\/+$/, '') || '/account';

  if (clean === '/account/index.html') {
    return '/account';
  }

  return clean;
}

function getAccountRoute(pathname = window.location.pathname) {
  return ACCOUNT_ROUTES[normalizeAccountPath(pathname)] || null;
}

function getAccountView(type) {
  const view = type || getAccountRoute()?.view || 'dashboard';
  return document.querySelector(`[data-account-view="${view}"]`);
}

function getActiveAccountView() {
  return document.querySelector('[data-account-view].is-active:not([hidden])') ||
    document.querySelector('[data-account-view]:not([hidden])');
}

function setElementText(selector, value, fallback = '—', root = document) {
  root.querySelectorAll(selector).forEach((element) => {
    element.textContent = value || fallback;
  });
}

function getUserFullName(user) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
}

function getUserInitials(user) {
  const initials = [user?.firstName, user?.lastName]
    .filter(Boolean)
    .map((part) => String(part).trim().charAt(0).toUpperCase())
    .join('');

  if (initials) {
    return initials.slice(0, 2);
  }

  return String(user?.email || 'СД').charAt(0).toUpperCase();
}

function renderAccountUser(user) {
  const fullName = getUserFullName(user) || 'Покупатель';
  const firstName = user?.firstName || fullName.split(' ')[0] || 'покупатель';

  setElementText('[data-account-first-name]', firstName, 'покупатель');
  setElementText('[data-account-full-name]', fullName, 'Покупатель');
  setElementText('[data-account-email]', user?.email, 'Email не указан');
  setElementText('[data-account-phone]', user?.phone, 'Телефон не указан');
  setElementText('[data-account-initials]', getUserInitials(user), 'СД');

  const form = document.querySelector('[data-profile-form]');

  if (form) {
    form.elements.firstName.value = user?.firstName || '';
    form.elements.lastName.value = user?.lastName || '';
    form.elements.email.value = user?.email || '';
    form.elements.phone.value = user?.phone || '';
  }
}


function initAccountNavigation(currentType = getAccountRoute()?.view || 'dashboard') {
  const current = currentType === 'order' ? 'orders' : currentType;

  document.querySelectorAll('[data-account-nav]').forEach((link) => {
    const active = link.dataset.accountNav === current;
    link.classList.toggle('is-active', active);

    if (active) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
}

function updateAccountChrome(type) {
  const page = getAccountPage();
  const route = Object.values(ACCOUNT_ROUTES).find((item) => item.view === type) || ACCOUNT_ROUTES['/account'];

  if (page) {
    page.dataset.accountPage = type;
  }

  document.title = route.title;
  setElementText('[data-account-mobile-title]', route.mobileTitle, 'Главная');
  initAccountNavigation(type);
}

function setInitialAccountView(type) {
  document.querySelectorAll('[data-account-view]').forEach((view) => {
    const active = view.dataset.accountView === type;
    view.hidden = !active;
    view.classList.toggle('is-active', active);
  });

  updateAccountChrome(type);
}

async function switchAccountView(type) {
  const content = document.querySelector('[data-account-content]');
  const next = getAccountView(type);
  const current = getActiveAccountView();

  if (!content || !next) {
    return;
  }

  if (current === next) {
    updateAccountChrome(type);
    await initAccountPageData(type);
    return;
  }

  content.classList.add('is-switching');

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion) {
    await new Promise((resolve) => window.setTimeout(resolve, 110));
  }

  if (current) {
    current.hidden = true;
    current.classList.remove('is-active');
  }

  next.hidden = false;
  next.classList.add('is-active');
  updateAccountChrome(type);
  await initAccountPageData(type);

  window.requestAnimationFrame(() => {
    content.classList.remove('is-switching');
  });
}

function initAccountRouter() {
  const initialRoute = getAccountRoute() || ACCOUNT_ROUTES['/account'];
  setInitialAccountView(initialRoute.view);

  document.addEventListener('click', (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }

    const link = event.target.closest('a[href]');

    if (!link || link.target === '_blank' || link.hasAttribute('download')) {
      return;
    }

    const url = new URL(link.href, window.location.origin);

    if (url.origin !== window.location.origin) {
      return;
    }

    const route = getAccountRoute(url.pathname);

    if (!route) {
      return;
    }

    event.preventDefault();

    const nextUrl = `${normalizeAccountPath(url.pathname) === '/account' ? '/account/' : normalizeAccountPath(url.pathname)}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextUrl !== currentUrl) {
      window.history.pushState({ accountView: route.view }, '', nextUrl);
    }

    void switchAccountView(route.view);
  });

  window.addEventListener('popstate', () => {
    const route = getAccountRoute();

    if (route) {
      void switchAccountView(route.view);
    }
  });
}

function initAccountDrawer() {
  const page = getAccountPage();
  const sidebar = document.querySelector('[data-account-sidebar]');
  const toggle = document.querySelector('[data-account-menu-toggle]');
  const close = document.querySelector('[data-account-menu-close]');
  const backdrop = document.querySelector('[data-account-menu-backdrop]');

  if (!page || !sidebar || !toggle || !backdrop) {
    return;
  }

  const setOpen = (open) => {
    page.classList.toggle('account-page--menu-open', open);
    document.body.classList.toggle('account-menu-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
    sidebar.setAttribute('aria-hidden', String(!open && window.innerWidth < 1024));
  };

  toggle.addEventListener('click', () => setOpen(!page.classList.contains('account-page--menu-open')));
  close?.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  sidebar.addEventListener('click', (event) => {
    if (event.target.closest('a')) {
      setOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  });

  const desktop = window.matchMedia('(min-width: 1024px)');
  const syncViewport = () => {
    if (desktop.matches) {
      setOpen(false);
      sidebar.removeAttribute('aria-hidden');
    } else {
      sidebar.setAttribute('aria-hidden', 'true');
    }
  };

  desktop.addEventListener?.('change', syncViewport);
  syncViewport();
}

function formatAccountMoney(value) {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value) || 0)} ₽`;
}

function formatAccountDate(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function getWordForm(value, forms) {
  const number = Math.abs(Number(value)) % 100;
  const last = number % 10;

  if (number > 10 && number < 20) return forms[2];
  if (last > 1 && last < 5) return forms[1];
  if (last === 1) return forms[0];
  return forms[2];
}

const orderStatusLabels = {
  NEW: 'Новый',
  CONFIRMED: 'Подтверждён',
  ASSEMBLING: 'Собирается',
  READY: 'Готов',
  DELIVERING: 'Доставляется',
  COMPLETED: 'Получен',
  CANCELLED: 'Отменён',
};

function createOrderCard(order) {
  const itemCount = Array.isArray(order.items) ? order.items.length : Number(order.itemCount) || 0;
  const number = escapeAccountHtml(order.number || order.id || '—');
  const status = escapeAccountHtml(orderStatusLabels[order.status] || order.status || 'Статус уточняется');
  const id = encodeURIComponent(order.id || order.number || '');

  return `<article class="account-order-card">
    <div class="account-order-card__main"><span class="account-order-card__number">Заказ №${number}</span><span class="account-order-card__date">${escapeAccountHtml(formatAccountDate(order.createdAt))}</span></div>
    <span class="account-status account-status--${escapeAccountHtml(String(order.status || '').toLowerCase())}">${status}</span>
    <span class="account-order-card__items">${itemCount} ${getWordForm(itemCount, ['товар', 'товара', 'товаров'])}</span>
    <strong class="account-order-card__total">${formatAccountMoney(order.total)}</strong>
    <a class="account-button account-button--soft" href="/account/order?id=${id}">Посмотреть заказ</a>
  </article>`;
}

function renderOrders(orders, { recent = false } = {}) {
  const root = getAccountView(recent ? 'dashboard' : 'orders');
  if (!root) return;

  const list = root.querySelector(recent ? '[data-account-recent-orders]' : '[data-account-orders-list]');
  const empty = root.querySelector(recent ? '[data-account-orders-empty]' : '[data-account-empty]');
  const loading = recent ? null : root.querySelector('[data-account-loading]');
  const normalized = Array.isArray(orders) ? orders : [];

  if (loading) loading.hidden = true;
  if (!list || !empty) return;

  const visibleOrders = recent ? normalized.slice(0, 3) : normalized;
  list.innerHTML = visibleOrders.map(createOrderCard).join('');
  list.hidden = visibleOrders.length === 0;
  empty.hidden = visibleOrders.length > 0;
  setElementText('[data-account-orders-count]', String(normalized.length), '0');
}

function renderOrder(order) {
  const root = getAccountView('order');
  if (!root) return;

  const loading = root.querySelector('[data-account-loading]');
  const detail = root.querySelector('[data-account-order-detail]');
  const empty = root.querySelector('[data-account-empty]');

  if (loading) loading.hidden = true;
  if (!detail || !empty) return;

  if (!order) {
    detail.hidden = true;
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  detail.hidden = false;
  setElementText('[data-order-title]', `Заказ №${order.number || order.id || '—'}`, 'Заказ', root);
  setElementText('[data-order-status]', orderStatusLabels[order.status] || order.status || 'Статус уточняется', '—', root);
  setElementText('[data-order-total]', formatAccountMoney(order.total), '0 ₽', root);
  setElementText('[data-order-delivery]', order.deliveryMethod === 'PICKUP' ? 'Самовывоз' : 'Доставка', '—', root);
  setElementText('[data-order-address]', order.deliveryAddressSnapshot, 'Адрес не указан', root);
  setElementText('[data-order-payment]', order.paymentMethod || order.paymentStatus, 'Способ оплаты не указан', root);
  setElementText('[data-order-date]', formatAccountDate(order.createdAt), '—', root);

  const products = root.querySelector('[data-order-products]');
  const items = Array.isArray(order.items) ? order.items : [];
  if (products) {
    products.innerHTML = items.map((item) => `<article class="account-order-product"><div><strong>${escapeAccountHtml(item.productName || 'Товар')}</strong><span>${escapeAccountHtml(item.quantity || 0)} × ${formatAccountMoney(item.unitPrice)}</span></div><strong>${formatAccountMoney(item.total)}</strong></article>`).join('');
  }

  const repeat = root.querySelector('[data-repeat-order]');
  if (repeat) repeat.hidden = false;
}

function createFavoriteCard(item, compact = false) {
  const key = escapeAccountHtml(item.key || item.slug || item.productId);
  const slug = encodeURIComponent(item.slug || item.key || item.productId || '');
  const title = escapeAccountHtml(item.title || 'Товар');
  const image = String(item.image || '').trim();
  const unavailable = item.available === false;
  const media = image
    ? `<img src="${escapeAccountHtml(image)}" alt="${title}" loading="lazy" decoding="async" />`
    : `<span class="account-favorite-card__placeholder" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 19 9 13l3 3 3-4 5 7M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" /></svg></span>`;

  return `<article class="account-favorite-card${compact ? ' account-favorite-card--compact' : ''}" data-account-favorite-card data-product-key="${key}">
    <a class="account-favorite-card__media" href="/product.html?slug=${slug}">${media}</a>
    <div class="account-favorite-card__body"><a class="account-favorite-card__title" href="/product.html?slug=${slug}">${title}</a><span class="account-favorite-card__measure">${escapeAccountHtml(item.measure || '')}</span><div class="account-favorite-card__bottom"><strong>${formatAccountMoney(item.unitPrice)}</strong>${compact ? '' : `<button class="account-favorite-card__cart" type="button" data-account-favorite-cart ${unavailable ? 'disabled' : ''} aria-label="Добавить в корзину"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.2 10.2h10.7L20.5 7H6" /><circle cx="9" cy="19" r="1.4" /><circle cx="17" cy="19" r="1.4" /></svg></button>`}</div></div>
    <button class="account-favorite-card__remove" type="button" data-account-favorite-remove aria-label="Убрать из избранного"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 4.7 13.4C1.8 10.5 2 6 5.5 4.6 8 3.6 10.1 5 12 7.1 13.9 5 16 3.6 18.5 4.6 22 6 22.2 10.5 19.3 13.4L12 20.5Z" /></svg></button>
  </article>`;
}

function renderFavorites() {
  const commerce = window.SibDelCommerce;
  if (!commerce) return;

  const favorites = commerce.getFavorites();
  const favoritesRoot = getAccountView('favorites');
  const dashboardRoot = getAccountView('dashboard');
  const grid = favoritesRoot?.querySelector('[data-account-favorites-grid]');
  const preview = dashboardRoot?.querySelector('[data-account-favorites-preview]');
  const pageEmpty = favoritesRoot?.querySelector('[data-account-empty]');
  const dashboardEmpty = dashboardRoot?.querySelector('[data-account-favorites-empty]');
  const loading = favoritesRoot?.querySelector('[data-account-loading]');
  const clear = favoritesRoot?.querySelector('[data-account-favorites-clear]');

  if (loading) loading.hidden = true;
  if (grid) {
    grid.innerHTML = favorites.map((item) => createFavoriteCard(item)).join('');
    grid.hidden = favorites.length === 0;
  }
  if (preview) {
    preview.innerHTML = favorites.slice(0, 3).map((item) => createFavoriteCard(item, true)).join('');
    preview.hidden = favorites.length === 0;
  }
  if (pageEmpty) pageEmpty.hidden = favorites.length > 0;
  if (dashboardEmpty) dashboardEmpty.hidden = favorites.length > 0;
  if (clear) clear.hidden = favorites.length === 0;

  setElementText('[data-account-favorites-count]', String(favorites.length), '0');
  const label = `${favorites.length} ${getWordForm(favorites.length, ['товар', 'товара', 'товаров'])}`;
  setElementText('[data-account-favorites-label]', label, '0 товаров');

  document.querySelectorAll('.account-nav__count[data-account-favorites-count]').forEach((badge) => {
    badge.hidden = favorites.length === 0;
  });
}

function showAccountToast(message, canUndo = false) {
  const toast = document.querySelector('[data-account-toast]');
  if (!toast) return;

  setElementText('[data-account-toast-text]', message, '', toast);
  const undo = toast.querySelector('[data-account-toast-undo]');
  if (undo) undo.hidden = !canUndo;
  toast.hidden = false;
  toast.classList.add('is-visible');
  window.clearTimeout(showAccountToast.timer);
  showAccountToast.timer = window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => { toast.hidden = true; }, 350);
  }, 3600);
}

function initFavoritesActions() {
  document.addEventListener('click', (event) => {
    const card = event.target.closest('[data-account-favorite-card]');
    const commerce = window.SibDelCommerce;
    if (!card || !commerce) return;

    const key = card.dataset.productKey;
    const item = commerce.getFavorites().find((favorite) => favorite.key === key);
    if (!item) return;

    if (event.target.closest('[data-account-favorite-remove]')) {
      accountStore.lastRemovedFavorites = [item];
      commerce.setFavorite(item, false);
      showAccountToast('Товар удалён из избранного', true);
    }

    if (event.target.closest('[data-account-favorite-cart]')) {
      commerce.addToCart(item, item.min || 1);
      showAccountToast('Товар добавлен в корзину');
    }
  });

  document.querySelector('[data-account-favorites-clear]')?.addEventListener('click', () => {
    const commerce = window.SibDelCommerce;
    if (!commerce) return;
    accountStore.lastRemovedFavorites = commerce.getFavorites();
    commerce.clearFavorites();
    showAccountToast('Избранное очищено', accountStore.lastRemovedFavorites.length > 0);
  });

  document.querySelector('[data-account-toast-undo]')?.addEventListener('click', () => {
    const commerce = window.SibDelCommerce;
    if (!commerce || accountStore.lastRemovedFavorites.length === 0) return;
    const current = commerce.getFavorites();
    commerce.replaceFavorites([...current, ...accountStore.lastRemovedFavorites]);
    accountStore.lastRemovedFavorites = [];
    showAccountToast('Товары возвращены');
  });

  document.addEventListener('sibdel:commerce-state-changed', renderFavorites);
}

function createAddressCard(address) {
  const parts = [address.city, address.street, address.house, address.apartment ? `кв. ${address.apartment}` : null].filter(Boolean);
  return `<article class="account-address-card" data-address-id="${escapeAccountHtml(address.id)}"><div class="account-address-card__head"><span class="account-address-card__icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5.2-8 11-8 11S4 15.2 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg></span><div><strong>${escapeAccountHtml(address.title || 'Адрес')}</strong>${address.isDefault ? '<span class="account-address-card__badge">Основной</span>' : ''}</div></div><p>${escapeAccountHtml(parts.join(', '))}</p><span>${escapeAccountHtml(address.recipientName || '')} · ${escapeAccountHtml(address.phone || '')}</span><div class="account-address-card__actions"><button type="button" data-address-edit>Изменить</button><button type="button" data-address-delete>Удалить</button></div></article>`;
}

function renderAddresses(addresses) {
  const root = getAccountView('addresses');
  if (!root) return;

  const list = root.querySelector('[data-account-addresses-list]');
  const empty = root.querySelector('[data-account-empty]');
  const loading = root.querySelector('[data-account-loading]');
  const normalized = Array.isArray(addresses) ? addresses : [];

  if (loading) loading.hidden = true;
  if (!list || !empty) return;
  list.innerHTML = normalized.map(createAddressCard).join('');
  list.hidden = normalized.length === 0;
  empty.hidden = normalized.length > 0;
  setElementText('[data-account-addresses-count]', String(normalized.length), '0');
}

function initAddressModal() {
  const modal = document.querySelector('[data-address-modal]');
  const form = document.querySelector('[data-address-form]');
  if (!modal || !form) return;

  const setOpen = (open) => {
    modal.hidden = !open;
    document.body.classList.toggle('account-modal-open', open);
    if (open) window.requestAnimationFrame(() => form.elements.title?.focus());
  };

  document.querySelectorAll('[data-address-open]').forEach((button) => button.addEventListener('click', () => setOpen(true)));
  document.querySelectorAll('[data-address-close]').forEach((button) => button.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !modal.hidden) setOpen(false); });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = form.querySelector('[data-address-status]');
    if (!form.checkValidity()) {
      form.reportValidity();
      if (status) status.textContent = 'Заполните обязательные поля.';
      return;
    }
    if (status) status.textContent = 'Сохранение адреса станет доступно после подключения backend.';
  });
}

function renderSubscription(subscription) {
  const root = getAccountView('subscription');
  if (!root) return;

  const card = root.querySelector('[data-account-subscription]');
  const empty = root.querySelector('[data-account-empty]');
  const loading = root.querySelector('[data-account-loading]');
  if (loading) loading.hidden = true;
  if (!card || !empty) return;

  if (!subscription) {
    card.hidden = true;
    empty.hidden = false;
    return;
  }

  card.hidden = false;
  empty.hidden = true;
  setElementText('[data-subscription-name]', subscription.plan?.name || subscription.name, 'Подписка', root);
  setElementText('[data-subscription-description]', subscription.plan?.description || subscription.description, '', root);
  setElementText('[data-subscription-status]', subscription.status, '—', root);
  setElementText('[data-subscription-expires]', formatAccountDate(subscription.expiresAt), '—', root);
  setElementText('[data-subscription-renew]', subscription.autoRenew ? 'Включено' : 'Выключено', '—', root);
}

function initSettingsForms() {
  const profileForm = document.querySelector('[data-profile-form]');
  const passwordForm = document.querySelector('[data-password-form]');

  profileForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const status = profileForm.querySelector('[data-profile-status]');
    if (!profileForm.checkValidity()) {
      profileForm.reportValidity();
      return;
    }
    status.textContent = 'Изменение профиля станет доступно после подключения backend.';
  });

  passwordForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(passwordForm);
    const status = passwordForm.querySelector('[data-password-status]');
    const nextPassword = String(data.get('newPassword') || '');
    const confirmation = String(data.get('passwordConfirm') || '');

    if (!passwordForm.checkValidity()) {
      passwordForm.reportValidity();
      return;
    }
    if (nextPassword !== confirmation) {
      status.textContent = 'Новые пароли не совпадают.';
      return;
    }
    status.textContent = 'Смена пароля станет доступна после подключения backend.';
  });
}

function initLogout() {
  document.querySelectorAll('[data-account-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      button.classList.add('is-loading');
      try {
        await logoutAccount();
      } catch (error) {
        button.disabled = false;
        button.classList.remove('is-loading');
        showPageError(error.message);
      }
    });
  });
}

function showPageError(message, type = getAccountRoute()?.view || 'dashboard') {
  const root = getAccountView(type) || getActiveAccountView();
  if (!root) return;

  const localError = root.querySelector('[data-account-error]');
  const globalError = root.querySelector('[data-account-global-error]');
  const target = localError || globalError;
  if (!target) return;

  const loading = root.querySelector('[data-account-loading]');
  if (loading) loading.hidden = true;
  target.hidden = false;
  setElementText('[data-account-global-error-text]', message, 'Попробуйте обновить страницу.', root);
}

function revealSettings() {
  const root = getAccountView('settings');
  if (!root) return;

  const loading = root.querySelector('[data-account-loading]');
  const settings = root.querySelector('[data-account-settings]');
  if (loading) loading.hidden = true;
  if (settings) settings.hidden = false;
}

function showUnavailableState(type, backendAvailable) {
  const state = getAccountView(type)?.querySelector('[data-account-unavailable]');
  if (state) state.hidden = backendAvailable;
}

async function ensureOrdersLoaded() {
  if (accountStore.loaded.orders) return;

  const { data, backendAvailable } = await loadOrders();
  accountStore.orders = data;
  accountStore.backendAvailable.orders = backendAvailable;
  accountStore.loaded.orders = true;
}

async function ensureAddressesLoaded() {
  if (accountStore.loaded.addresses) return;

  const { data, backendAvailable } = await loadAddresses();
  accountStore.addresses = data;
  accountStore.backendAvailable.addresses = backendAvailable;
  accountStore.loaded.addresses = true;
}

async function ensureSubscriptionLoaded() {
  if (accountStore.loaded.subscription) return;

  const { data, backendAvailable } = await loadSubscription();
  accountStore.subscription = data;
  accountStore.backendAvailable.subscription = backendAvailable;
  accountStore.loaded.subscription = true;
}

async function initAccountPageData(type = getAccountRoute()?.view || 'dashboard') {
  if (type === 'dashboard') {
    await ensureOrdersLoaded();
    renderOrders(accountStore.orders, { recent: true });
    renderFavorites();
    return;
  }

  if (type === 'orders') {
    await ensureOrdersLoaded();
    renderOrders(accountStore.orders);
    showUnavailableState('orders', accountStore.backendAvailable.orders);
    return;
  }

  if (type === 'order') {
    renderOrder(null);
    showUnavailableState('order', false);
    return;
  }

  if (type === 'favorites') {
    renderFavorites();
    showUnavailableState('favorites', false);
    return;
  }

  if (type === 'addresses') {
    await ensureAddressesLoaded();
    renderAddresses(accountStore.addresses);
    showUnavailableState('addresses', accountStore.backendAvailable.addresses);
    return;
  }

  if (type === 'settings') {
    revealSettings();
    return;
  }

  if (type === 'subscription') {
    await ensureSubscriptionLoaded();
    renderSubscription(accountStore.subscription);
    showUnavailableState('subscription', accountStore.backendAvailable.subscription);
  }
}

function initAccountRetry() {
  document.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-account-retry]');
    if (!button) return;

    const view = button.closest('[data-account-view]')?.dataset.accountView;

    if (!view || view === 'dashboard') {
      window.location.reload();
      return;
    }

    if (view === 'orders') accountStore.loaded.orders = false;
    if (view === 'addresses') accountStore.loaded.addresses = false;
    if (view === 'subscription') accountStore.loaded.subscription = false;

    const error = button.closest('[data-account-error]');
    if (error) error.hidden = true;

    try {
      await initAccountPageData(view);
    } catch (loadError) {
      showPageError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить раздел.', view);
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!getAccountPage()) return;

  const initialRoute = getAccountRoute() || ACCOUNT_ROUTES['/account'];
  setInitialAccountView(initialRoute.view);

  try {
    const [user] = await Promise.all([getAccountUser(), loadAccountNavigation()]);
    if (!user) return;

    accountStore.user = user;
    renderAccountUser(user);
    initAccountRouter();
    initAccountDrawer();
    initFavoritesActions();
    initAddressModal();
    initSettingsForms();
    initLogout();
    initAccountRetry();
    await initAccountPageData(initialRoute.view);
  } catch (error) {
    showPageError(error instanceof Error ? error.message : 'Не удалось загрузить кабинет.', initialRoute.view);
  }
});
