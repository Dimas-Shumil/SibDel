const ACCOUNT_NAVIGATION_URL = '/components/account-navigation.html';

const accountStore = {
  user: null,
  orders: [],
  addresses: [],
  subscription: null,
  lastRemovedFavorites: [],
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

function setElementText(selector, value, fallback = '—') {
  document.querySelectorAll(selector).forEach((element) => {
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


function initAccountTransitions() {
  const content = document.querySelector('.account-content');

  if (!content) {
    return;
  }

  requestAnimationFrame(() => {
    content.classList.add('is-visible');
  });

  document.querySelectorAll('[data-account-nav]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const href = link.getAttribute('href');

      if (!href || href.startsWith('#') || link.target === '_blank') {
        return;
      }

      if (href === window.location.pathname) {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      content.classList.remove('is-visible');
      content.classList.add('is-leaving');

      window.setTimeout(() => {
        window.location.href = href;
      }, 220);
    });
  });
}



function getAccountContent() {
  return document.querySelector('.account-content');
}

function getAccountRouteType(url) {
  const path = new URL(url, window.location.origin).pathname;

  if (path.endsWith('/orders.html') || path.endsWith('/orders')) return 'orders';
  if (path.endsWith('/favorites.html') || path.endsWith('/favorites')) return 'favorites';
  if (path.endsWith('/addresses.html') || path.endsWith('/addresses')) return 'addresses';
  if (path.endsWith('/settings.html') || path.endsWith('/settings')) return 'settings';
  if (path.endsWith('/subscription.html') || path.endsWith('/subscription')) return 'subscription';
  if (path.endsWith('/order.html') || path.endsWith('/order')) return 'order';

  return 'dashboard';
}

async function loadAccountContent(url, push = true) {
  const content = getAccountContent();

  if (!content) {
    window.location.href = url;
    return;
  }

  const response = await fetch(url, {
    headers: { Accept: 'text/html' },
    credentials: 'same-origin',
  });

  if (!response.ok) {
    window.location.href = url;
    return;
  }

  const html = await response.text();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const nextContent = parsed.querySelector('.account-content');

  if (!nextContent) {
    window.location.href = url;
    return;
  }

  content.classList.add('is-changing');

  window.setTimeout(async () => {
    content.innerHTML = nextContent.innerHTML;
    content.closest('[data-account-page]')?.setAttribute('data-account-page', getAccountRouteType(url));

    if (push) {
      window.history.pushState({ account: true }, '', url);
    }

    initAccountNavigation();
    initAddressModal();
    initSettingsForms();

    await initAccountPageData();

    content.classList.remove('is-changing');
    content.classList.add('is-visible');
  }, 180);
}

function initAccountRouter() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('[data-account-nav]');

    if (!link) return;

    const href = link.getAttribute('href');

    if (!href || href.startsWith('#') || event.ctrlKey || event.metaKey) return;

    event.preventDefault();
    loadAccountContent(href);
  });

  window.addEventListener('popstate', () => {
    loadAccountContent(window.location.pathname, false);
  });
}

function initAccountNavigation() {
  const page = getAccountPage();
  const current = page?.dataset.accountPage === 'order' ? 'orders' : page?.dataset.accountPage;

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
  const list = document.querySelector(recent ? '[data-account-recent-orders]' : '[data-account-orders-list]');
  const empty = document.querySelector(recent ? '[data-account-orders-empty]' : '[data-account-empty]');
  const loading = recent ? null : document.querySelector('[data-account-loading]');
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
  const loading = document.querySelector('[data-account-loading]');
  const detail = document.querySelector('[data-account-order-detail]');
  const empty = document.querySelector('[data-account-empty]');

  if (loading) loading.hidden = true;
  if (!detail || !empty) return;

  if (!order) {
    detail.hidden = true;
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  detail.hidden = false;
  setElementText('[data-order-title]', `Заказ №${order.number || order.id || '—'}`);
  setElementText('[data-order-status]', orderStatusLabels[order.status] || order.status || 'Статус уточняется');
  setElementText('[data-order-total]', formatAccountMoney(order.total));
  setElementText('[data-order-delivery]', order.deliveryMethod === 'PICKUP' ? 'Самовывоз' : 'Доставка');
  setElementText('[data-order-address]', order.deliveryAddressSnapshot, 'Адрес не указан');
  setElementText('[data-order-payment]', order.paymentMethod || order.paymentStatus, 'Способ оплаты не указан');
  setElementText('[data-order-date]', formatAccountDate(order.createdAt));

  const products = document.querySelector('[data-order-products]');
  const items = Array.isArray(order.items) ? order.items : [];
  products.innerHTML = items.map((item) => `<article class="account-order-product"><div><strong>${escapeAccountHtml(item.productName || 'Товар')}</strong><span>${escapeAccountHtml(item.quantity || 0)} × ${formatAccountMoney(item.unitPrice)}</span></div><strong>${formatAccountMoney(item.total)}</strong></article>`).join('');

  const repeat = document.querySelector('[data-repeat-order]');
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
  const grid = document.querySelector('[data-account-favorites-grid]');
  const preview = document.querySelector('[data-account-favorites-preview]');
  const pageEmpty = document.querySelector('[data-account-page="favorites"] [data-account-empty]');
  const dashboardEmpty = document.querySelector('[data-account-favorites-empty]');
  const loading = document.querySelector('[data-account-page="favorites"] [data-account-loading]');
  const clear = document.querySelector('[data-account-favorites-clear]');

  if (loading) loading.hidden = true;
  if (grid) {
    grid.innerHTML = favorites.map((item) => createFavoriteCard(item)).join('');
    grid.hidden = favorites.length === 0;
  }
  if (preview) preview.innerHTML = favorites.slice(0, 3).map((item) => createFavoriteCard(item, true)).join('');
  if (pageEmpty) pageEmpty.hidden = favorites.length > 0;
  if (dashboardEmpty) dashboardEmpty.hidden = favorites.length > 0;
  if (preview) preview.hidden = favorites.length === 0;
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

  setElementText('[data-account-toast-text]', message);
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
  const list = document.querySelector('[data-account-addresses-list]');
  const empty = document.querySelector('[data-account-empty]');
  const loading = document.querySelector('[data-account-loading]');
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
  const card = document.querySelector('[data-account-subscription]');
  const empty = document.querySelector('[data-account-empty]');
  const loading = document.querySelector('[data-account-loading]');
  if (loading) loading.hidden = true;
  if (!card || !empty) return;

  if (!subscription) {
    card.hidden = true;
    empty.hidden = false;
    return;
  }

  card.hidden = false;
  empty.hidden = true;
  setElementText('[data-subscription-name]', subscription.plan?.name || subscription.name, 'Подписка');
  setElementText('[data-subscription-description]', subscription.plan?.description || subscription.description, '');
  setElementText('[data-subscription-status]', subscription.status, '—');
  setElementText('[data-subscription-expires]', formatAccountDate(subscription.expiresAt), '—');
  setElementText('[data-subscription-renew]', subscription.autoRenew ? 'Включено' : 'Выключено', '—');
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

function showPageError(message) {
  const page = getAccountPage();
  const localError = page?.querySelector('[data-account-error]');
  const globalError = page?.querySelector('[data-account-global-error]');
  const target = localError || globalError;
  if (!target) return;

  const loading = page.querySelector('[data-account-loading]');
  if (loading) loading.hidden = true;
  target.hidden = false;
  setElementText('[data-account-global-error-text]', message, 'Попробуйте обновить страницу.');
}

function revealSettings() {
  const loading = document.querySelector('[data-account-loading]');
  const settings = document.querySelector('[data-account-settings]');
  if (loading) loading.hidden = true;
  if (settings) settings.hidden = false;
}

async function initAccountPageData() {
  const type = getAccountPage()?.dataset.accountPage;

  const showUnavailableState = (backendAvailable) => {
    const state = document.querySelector('[data-account-unavailable]');
    if (state) state.hidden = backendAvailable;
  };

  if (type === 'dashboard') {
    const { data } = await loadOrders();
    accountStore.orders = data;
    renderOrders(data, { recent: true });
    renderFavorites();
  }

  if (type === 'orders') {
    const { data, backendAvailable } = await loadOrders();
    accountStore.orders = data;
    renderOrders(data);
    showUnavailableState(backendAvailable);
  }

  if (type === 'order') {
    renderOrder(null);
    showUnavailableState(false);
  }

  if (type === 'favorites') {
    renderFavorites();
    showUnavailableState(false);
  }

  if (type === 'addresses') {
    const { data, backendAvailable } = await loadAddresses();
    accountStore.addresses = data;
    renderAddresses(data);
    showUnavailableState(backendAvailable);
  }

  if (type === 'settings') {
    revealSettings();
  }

  if (type === 'subscription') {
    const { data, backendAvailable } = await loadSubscription();
    accountStore.subscription = data;
    renderSubscription(data);
    showUnavailableState(backendAvailable);
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!getAccountPage()) return;

  try {
    const [user] = await Promise.all([getAccountUser(), loadAccountNavigation()]);
    if (!user) return;

    accountStore.user = user;
    renderAccountUser(user);
    initAccountNavigation();
    initAccountTransitions();
    initAccountDrawer();
    initFavoritesActions();
    initAddressModal();
    initSettingsForms();
    initLogout();
    document.querySelectorAll('[data-account-retry]').forEach((button) => button.addEventListener('click', () => window.location.reload()));
    await initAccountPageData();
  } catch (error) {
    showPageError(error instanceof Error ? error.message : 'Не удалось загрузить кабинет.');
  }
});
