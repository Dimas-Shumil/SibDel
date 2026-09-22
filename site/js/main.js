async function loadComponent(selector, url) {
  const mount = document.querySelector(selector);

  if (!mount) {
    return;
  }

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/html',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Не удалось загрузить компонент ${url}: HTTP ${response.status}`,
    );
  }

  const markup = await response.text();

  const template = document.createElement('template');

  template.innerHTML = markup.trim();

  const component = template.content.firstElementChild;

  if (!component) {
    throw new Error(`Компонент ${url} не содержит корневой HTML-элемент`);
  }

  mount.replaceWith(component);
}

async function loadLayoutComponents() {
  const results = await Promise.allSettled([
    loadComponent(
      '[data-component="header"]',
      '/components/header.html',
    ),

    loadComponent(
      '[data-component="footer"]',
      '/components/footer.html',
    ),
  ]);

  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.error(result.reason);
    }
  });
}

function initSmartHeader() {
  const header = document.querySelector('.header');

  if (!header) {
    return;
  }

  const topRevealOffset = 24;
  const directionThreshold = 8;

  let lastHandledScrollY = Math.max(window.scrollY, 0);
  let frameRequested = false;

  const showHeader = () => {
    header.classList.remove('header--hidden');
  };

  const updateHeader = () => {
    const currentScrollY = Math.max(window.scrollY, 0);
    const delta = currentScrollY - lastHandledScrollY;

    if (
      currentScrollY <= topRevealOffset ||
      header.classList.contains('header--menu-open')
    ) {
      showHeader();
      lastHandledScrollY = currentScrollY;
      frameRequested = false;
      return;
    }

    if (Math.abs(delta) >= directionThreshold) {
      header.classList.toggle('header--hidden', delta > 0);
      lastHandledScrollY = currentScrollY;
    }

    frameRequested = false;
  };

  window.addEventListener(
    'scroll',
    () => {
      if (frameRequested) {
        return;
      }

      frameRequested = true;
      window.requestAnimationFrame(updateHeader);
    },
    { passive: true },
  );

  header.addEventListener('focusin', showHeader);
}

function initMobileHeader() {
  const header = document.querySelector('.header');
  const toggle = header?.querySelector('[data-header-menu-toggle]');
  const menu = header?.querySelector('[data-header-mobile-menu]');
  const openActions = header?.querySelector('.header__mobile-open-actions');
  const accountLink = header?.querySelector('[data-mobile-account-link]');
  const desktopAccountLink = header?.querySelector('[data-desktop-account-link]');
  const desktopAccountText = header?.querySelector('[data-desktop-account-text]');

  if (!header || !toggle || !menu) {
    return;
  }

  const setMenuState = (isOpen, { restoreFocus = false } = {}) => {
    header.classList.toggle('header--menu-open', isOpen);
    header.classList.remove('header--hidden');

    document.body.classList.toggle('header-menu-open', isOpen);

    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.setAttribute('aria-label', isOpen ? 'Закрыть меню' : 'Открыть меню');

    menu.setAttribute('aria-hidden', String(!isOpen));
    menu.inert = !isOpen;

    if (openActions) {
      openActions.setAttribute('aria-hidden', String(!isOpen));
    }

    if (!isOpen && restoreFocus) {
      toggle.focus();
    }
  };

  const closeMenu = (options) => {
    setMenuState(false, options);
  };

  toggle.addEventListener('click', () => {
    const isOpen = !header.classList.contains('header--menu-open');
    setMenuState(isOpen);
  });

  menu.addEventListener('click', (event) => {
    const link = event.target.closest('a');

    if (link) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Escape' &&
      header.classList.contains('header--menu-open')
    ) {
      closeMenu({ restoreFocus: true });
    }
  });

  const desktopMedia = window.matchMedia('(min-width: 768px)');

  const handleViewportChange = (event) => {
    if (event.matches) {
      closeMenu();
    }
  };

  if (typeof desktopMedia.addEventListener === 'function') {
    desktopMedia.addEventListener('change', handleViewportChange);
  }

  const applyAuthState = (isAuthenticated) => {
    header.classList.toggle('header--authenticated', isAuthenticated);

    if (accountLink) {
      accountLink.href = isAuthenticated ? '/account/' : '/login.html';
      accountLink.textContent = isAuthenticated
        ? 'Личный кабинет'
        : 'Войти в личный кабинет';
    }

    if (desktopAccountLink) {
      desktopAccountLink.href = isAuthenticated ? '/account/' : '/login.html';
      desktopAccountLink.setAttribute(
        'aria-label',
        isAuthenticated ? 'Открыть личный кабинет' : 'Войти в личный кабинет',
      );
    }

    if (desktopAccountText) {
      desktopAccountText.textContent = isAuthenticated ? 'Кабинет' : 'Войти';
    }
  };

  applyAuthState(false);

  fetch('/api/auth/me', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    credentials: 'same-origin',
  })
    .then((response) => {
      if (!response.ok) {
        return null;
      }

      return response.json();
    })
    .then((data) => {
      applyAuthState(Boolean(data?.ok && data?.user));
    })
    .catch(() => {
      applyAuthState(false);
    });
}

function initPromotionsSlider() {
  const slider = document.querySelector(
    '.promotions__slider',
  );

  if (!slider || typeof Swiper === 'undefined') {
    return;
  }

  new Swiper(slider, {
    speed: 650,

    slidesPerView: 1.15,
    spaceBetween: 10,

    grabCursor: true,
    watchOverflow: true,

    navigation: {
      prevEl: '.promotions__button--prev',
      nextEl: '.promotions__button--next',
    },

    breakpoints: {
      480: {
        slidesPerView: 1.4,
        spaceBetween: 12,
      },

      640: {
        slidesPerView: 2.1,
        spaceBetween: 12,
      },

      768: {
        slidesPerView: 2.4,
        spaceBetween: 14,
      },

      1024: {
        slidesPerView: 3.2,
        spaceBetween: 14,
      },

      1366: {
        slidesPerView: 4,
        spaceBetween: 14,
      },

      1600: {
        slidesPerView: 4.6,
        spaceBetween: 16,
      },

      2200: {
        slidesPerView: 5.2,
        spaceBetween: 18,
      },

      3000: {
        slidesPerView: 5.6,
        spaceBetween: 20,
      },
    },
  });
}

function initPopularProductsSlider() {
  const slider = document.querySelector(
    '.popular-products__slider',
  );

  if (!slider || typeof Swiper === 'undefined') {
    return;
  }

  new Swiper(slider, {
    speed: 650,

    slidesPerView: 'auto',
    spaceBetween: 12,

    grabCursor: true,
    watchOverflow: true,

    navigation: {
      prevEl: '.popular-products__button--prev',
      nextEl: '.popular-products__button--next',
    },

    breakpoints: {
      768: {
        spaceBetween: 14,
      },

      1366: {
        spaceBetween: 16,
      },

      2200: {
        spaceBetween: 18,
      },

      3000: {
        spaceBetween: 20,
      },
    },
  });
}

function initReviewsSlider() {
  const slider = document.querySelector(
    '.reviews__slider',
  );

  if (!slider || typeof Swiper === 'undefined') {
    return;
  }

  new Swiper(slider, {
    speed: 650,

    slidesPerView: 1.08,
    spaceBetween: 10,

    grabCursor: true,
    watchOverflow: true,

    navigation: {
      prevEl: '.reviews__button--prev',
      nextEl: '.reviews__button--next',
    },

    breakpoints: {
      480: {
        slidesPerView: 1.2,
        spaceBetween: 12,
      },

      640: {
        slidesPerView: 1.5,
        spaceBetween: 12,
      },

      768: {
        slidesPerView: 1.8,
        spaceBetween: 14,
      },

      1024: {
        slidesPerView: 2.2,
        spaceBetween: 14,
      },

      1366: {
        slidesPerView: 3,
        spaceBetween: 16,
      },

      1920: {
        slidesPerView: 3.4,
        spaceBetween: 18,
      },

      2200: {
        slidesPerView: 4,
        spaceBetween: 18,
      },

      3000: {
        slidesPerView: 4.6,
        spaceBetween: 20,
      },
    },
  });
}


const SIBDEL_PREVIEW_CART_KEY = 'sibdelPreviewCartV2';
const SIBDEL_PREVIEW_FAVORITES_KEY = 'sibdelPreviewFavoritesV2';

function getPreviewStorageValue(key) {
  try {
    const raw = window.localStorage.getItem(key);

    if (raw === null) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function setPreviewStorageValue(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Preview state must never break the storefront if storage is unavailable.
  }
}

function normalizePreviewNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizePreviewItem(item = {}) {
  const slug = String(item.slug || '').trim();
  const productId = String(item.productId || '').trim();
  const key = slug || productId;

  if (!key) {
    return null;
  }

  const min = Math.max(0.001, normalizePreviewNumber(item.min, 1));
  const step = Math.max(0.001, normalizePreviewNumber(item.step, 1));
  const max = Math.max(min, normalizePreviewNumber(item.max, 999));
  const quantity = Math.min(
    max,
    Math.max(min, normalizePreviewNumber(item.quantity, min)),
  );

  return {
    key,
    productId: productId || null,
    slug: slug || key,
    title: String(item.title || 'Товар').trim().slice(0, 180),
    image: String(item.image || '').trim().slice(0, 500),
    measure: String(item.measure || '').trim().slice(0, 80),
    badge: String(item.badge || '').trim().slice(0, 40),
    available: item.available !== false,
    rating: String(item.rating || '').trim().slice(0, 20),
    reviewCount: String(item.reviewCount || '').trim().slice(0, 20),
    unitPrice: Math.max(0, normalizePreviewNumber(item.unitPrice, 0)),
    oldUnitPrice: Math.max(
      0,
      normalizePreviewNumber(item.oldUnitPrice, item.unitPrice || 0),
    ),
    quantity,
    min,
    max,
    step,
  };
}

function createSibDelCommercePreview() {
  let cart = getPreviewStorageValue(SIBDEL_PREVIEW_CART_KEY);
  let favorites = getPreviewStorageValue(SIBDEL_PREVIEW_FAVORITES_KEY);

  const normalizeList = (list, includeQuantity) =>
    (Array.isArray(list) ? list : [])
      .map((item) => normalizePreviewItem(item))
      .filter(Boolean)
      .map((item) => ({
        ...item,
        quantity: includeQuantity ? item.quantity : 1,
      }));

  cart = cart === null ? null : normalizeList(cart, true);
  favorites = favorites === null ? null : normalizeList(favorites, false);

  const emit = (reason, item = null) => {
    document.dispatchEvent(
      new CustomEvent('sibdel:commerce-state-changed', {
        detail: {
          reason,
          item,
          cart: api.getCart(),
          favorites: api.getFavorites(),
        },
      }),
    );
  };

  const persistCart = (reason, item = null) => {
    if (cart === null) {
      cart = [];
    }

    setPreviewStorageValue(SIBDEL_PREVIEW_CART_KEY, cart);
    emit(reason, item);
  };

  const persistFavorites = (reason, item = null) => {
    if (favorites === null) {
      favorites = [];
    }

    setPreviewStorageValue(SIBDEL_PREVIEW_FAVORITES_KEY, favorites);
    emit(reason, item);
  };

  const findCartIndex = (key) =>
    (cart || []).findIndex((item) => item.key === String(key));

  const findFavoriteIndex = (key) =>
    (favorites || []).findIndex((item) => item.key === String(key));

  const api = {
    hasCartState() {
      return cart !== null;
    },

    hasFavoritesState() {
      return favorites !== null;
    },

    seedCart(items) {
      if (cart !== null) {
        return;
      }

      cart = normalizeList(items, true);
      persistCart('cart-seeded');
    },

    seedFavorites(items) {
      if (favorites !== null) {
        return;
      }

      favorites = normalizeList(items, false);
      persistFavorites('favorites-seeded');
    },

    getCart() {
      return (cart || []).map((item) => ({ ...item }));
    },

    getFavorites() {
      return (favorites || []).map((item) => ({ ...item }));
    },

    getCartItem(key) {
      const item = (cart || []).find((entry) => entry.key === String(key));
      return item ? { ...item } : null;
    },

    isInCart(key) {
      return findCartIndex(key) >= 0;
    },

    isFavorite(key) {
      return findFavoriteIndex(key) >= 0;
    },

    addToCart(rawItem, requestedQuantity = 1) {
      const normalized = normalizePreviewItem({
        ...rawItem,
        quantity: requestedQuantity,
      });

      if (!normalized || normalized.available === false) {
        return null;
      }

      if (cart === null) {
        cart = [];
      }

      const index = findCartIndex(normalized.key);

      if (index >= 0) {
        const current = cart[index];
        const nextQuantity = Math.min(
          current.max,
          Math.max(
            current.min,
            normalizePreviewNumber(current.quantity, current.min) +
              normalizePreviewNumber(requestedQuantity, current.step),
          ),
        );

        cart[index] = {
          ...current,
          ...normalized,
          quantity: nextQuantity,
        };
      } else {
        cart.push(normalized);
      }

      const item = cart[findCartIndex(normalized.key)];
      persistCart('cart-added', item);
      return { ...item };
    },

    setCartQuantity(key, quantity) {
      const index = findCartIndex(key);

      if (index < 0) {
        return null;
      }

      const item = cart[index];
      const numericQuantity = normalizePreviewNumber(quantity, item.min);

      if (numericQuantity <= 0) {
        cart.splice(index, 1);
        persistCart('cart-removed', item);
        return null;
      }

      item.quantity = Math.min(item.max, Math.max(item.min, numericQuantity));
      persistCart('cart-quantity', item);
      return { ...item };
    },

    removeFromCart(key) {
      const index = findCartIndex(key);

      if (index < 0) {
        return null;
      }

      const [removed] = cart.splice(index, 1);
      persistCart('cart-removed', removed);
      return { ...removed };
    },

    clearCart() {
      const previous = api.getCart();
      cart = [];
      persistCart('cart-cleared');
      return previous;
    },

    replaceCart(items) {
      cart = normalizeList(items, true);
      persistCart('cart-replaced');
    },

    setFavorite(rawItem, shouldFavorite = true) {
      const normalized = normalizePreviewItem(rawItem);

      if (!normalized) {
        return null;
      }

      if (favorites === null) {
        favorites = [];
      }

      const index = findFavoriteIndex(normalized.key);

      if (shouldFavorite && index < 0) {
        favorites.push({ ...normalized, quantity: 1 });
      } else if (shouldFavorite && index >= 0) {
        favorites[index] = {
          ...favorites[index],
          ...normalized,
          quantity: 1,
        };
      } else if (!shouldFavorite && index >= 0) {
        favorites.splice(index, 1);
      }

      persistFavorites(
        shouldFavorite ? 'favorite-added' : 'favorite-removed',
        normalized,
      );

      return shouldFavorite ? { ...normalized, quantity: 1 } : null;
    },

    clearFavorites() {
      const previous = api.getFavorites();
      favorites = [];
      persistFavorites('favorites-cleared');
      return previous;
    },

    replaceFavorites(items) {
      favorites = normalizeList(items, false);
      persistFavorites('favorites-replaced');
    },

    getCartQuantity() {
      return (cart || []).reduce(
        (sum, item) => sum + Math.max(0, normalizePreviewNumber(item.quantity)),
        0,
      );
    },

    getCartTotal() {
      return (cart || []).reduce(
        (sum, item) =>
          sum +
          Math.max(0, normalizePreviewNumber(item.unitPrice)) *
            Math.max(0, normalizePreviewNumber(item.quantity)),
        0,
      );
    },
  };

  return api;
}

window.SibDelCommerce = createSibDelCommercePreview();

function formatPreviewMoney(value) {
  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)} ₽`;
}

function formatPreviewQuantity(value) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 3,
  }).format(Number(value) || 0);
}

function getPreviewProductKey(item) {
  return String(item?.slug || item?.productId || item?.key || '').trim();
}

function sanitizePreviewImage(value) {
  const image = String(value || '').trim();

  if (/^\/site\/images\/[a-zA-Z0-9_./%()\-]+$/.test(image)) {
    return image;
  }

  return '/site/images/kol-taezh.webp';
}

function updateGlobalHeaderCartCount() {
  const badges = document.querySelectorAll('.header__cart-count');

  if (!badges.length || !window.SibDelCommerce) {
    return;
  }

  const quantity = window.SibDelCommerce.getCartQuantity();
  const rounded = Number(quantity.toFixed(3));
  const label =
    rounded > 0
      ? `В корзине: ${formatPreviewQuantity(rounded)}`
      : 'Корзина пуста';

  badges.forEach((badge) => {
    badge.textContent = formatPreviewQuantity(rounded);
    badge.hidden = rounded <= 0;
    badge.setAttribute('aria-label', label);
  });
}

function updateGlobalHeaderFavoritesCount() {
  const badges = document.querySelectorAll('.header__favorites-count');
  const actions = document.querySelectorAll(
    '.header__action--favorites, .header__mobile-action--favorites',
  );

  if (!window.SibDelCommerce) {
    return;
  }

  const count = window.SibDelCommerce.getFavorites().length;
  const label = count > 0 ? `В избранном: ${count}` : 'Избранное пусто';

  badges.forEach((badge) => {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count <= 0;
    badge.setAttribute('aria-label', label);
  });

  actions.forEach((action) => {
    action.classList.toggle('is-active', count > 0);
  });
}

function updateGlobalCommerceIndicators() {
  updateGlobalHeaderCartCount();
  updateGlobalHeaderFavoritesCount();
}

function ensureCommerceFeedbackStack() {
  let stack = document.querySelector('[data-commerce-feedback-stack]');

  if (stack) {
    return stack;
  }

  stack = document.createElement('div');
  stack.className = 'commerce-feedback-stack';
  stack.dataset.commerceFeedbackStack = '';
  document.body.append(stack);

  return stack;
}

function ensureFavoriteFeedback(stack = ensureCommerceFeedbackStack()) {
  let panel = document.querySelector('[data-favorite-feedback]');

  if (panel) {
    if (panel.parentElement !== stack) {
      stack.append(panel);
    }

    return panel;
  }

  panel = document.createElement('aside');
  panel.className = 'favorite-feedback';
  panel.dataset.favoriteFeedback = '';
  panel.hidden = true;
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.innerHTML = `
    <span class="favorite-feedback__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 20.5 4.7 13.4C1.8 10.5 2 6 5.5 4.6 8 3.6 10.1 5 12 7.1 13.9 5 16 3.6 18.5 4.6 22 6 22.2 10.5 19.3 13.4L12 20.5Z" /></svg>
    </span>
    <div class="favorite-feedback__copy">
      <strong class="favorite-feedback__title" data-favorite-feedback-title>Добавлено в избранное</strong>
      <span class="favorite-feedback__text" data-favorite-feedback-text></span>
    </div>
    <a class="favorite-feedback__link" href="/favorites.html" data-favorite-feedback-link>Избранное</a>
    <button class="favorite-feedback__close" type="button" aria-label="Закрыть уведомление" data-favorite-feedback-close>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  `;

  stack.append(panel);
  return panel;
}

function ensureMiniCartPanel(stack = ensureCommerceFeedbackStack()) {
  let panel = document.querySelector('[data-mini-cart]');

  if (panel) {
    if (panel.parentElement !== stack) {
      stack.append(panel);
    }

    return panel;
  }

  panel = document.createElement('aside');
  panel.className = 'mini-cart';
  panel.dataset.miniCart = '';
  panel.hidden = true;
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', 'Товар добавлен в корзину');
  panel.innerHTML = `
    <div class="mini-cart__product">
      <img class="mini-cart__image" src="/site/images/kol-taezh.webp" alt="" width="96" height="72" data-mini-cart-image />
      <div class="mini-cart__copy">
        <span class="mini-cart__eyebrow">В корзине</span>
        <strong class="mini-cart__title" data-mini-cart-title></strong>
        <span class="mini-cart__measure" data-mini-cart-measure></span>
      </div>
    </div>

    <div class="mini-cart__quantity" aria-label="Количество товара">
      <button class="mini-cart__quantity-button" type="button" aria-label="Уменьшить количество" data-mini-cart-minus>−</button>
      <strong class="mini-cart__quantity-value" data-mini-cart-quantity>1</strong>
      <button class="mini-cart__quantity-button" type="button" aria-label="Увеличить количество" data-mini-cart-plus>+</button>
    </div>

    <div class="mini-cart__price-wrap">
      <strong class="mini-cart__price" data-mini-cart-line-price></strong>
      <span class="mini-cart__summary" data-mini-cart-summary></span>
    </div>

    <a class="mini-cart__link" href="/cart.html">В корзину</a>

    <button class="mini-cart__close" type="button" aria-label="Закрыть" data-mini-cart-close>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
    </button>
  `;

  stack.append(panel);
  return panel;
}

function initGlobalCommercePreview() {
  const commerce = window.SibDelCommerce;

  if (!commerce) {
    return;
  }

  const feedbackStack = ensureCommerceFeedbackStack();
  const miniCart = ensureMiniCartPanel(feedbackStack);
  const miniImage = miniCart.querySelector('[data-mini-cart-image]');
  const miniTitle = miniCart.querySelector('[data-mini-cart-title]');
  const miniMeasure = miniCart.querySelector('[data-mini-cart-measure]');
  const miniQuantity = miniCart.querySelector('[data-mini-cart-quantity]');
  const miniLinePrice = miniCart.querySelector('[data-mini-cart-line-price]');
  const miniSummary = miniCart.querySelector('[data-mini-cart-summary]');
  const miniMinus = miniCart.querySelector('[data-mini-cart-minus]');
  const miniPlus = miniCart.querySelector('[data-mini-cart-plus]');
  const miniClose = miniCart.querySelector('[data-mini-cart-close]');
  const favoriteFeedback = ensureFavoriteFeedback(feedbackStack);
  const favoriteFeedbackTitle = favoriteFeedback.querySelector('[data-favorite-feedback-title]');
  const favoriteFeedbackText = favoriteFeedback.querySelector('[data-favorite-feedback-text]');
  const favoriteFeedbackLink = favoriteFeedback.querySelector('[data-favorite-feedback-link]');
  const favoriteFeedbackClose = favoriteFeedback.querySelector('[data-favorite-feedback-close]');
  let activeKey = null;
  let hideTimer = null;
  let favoriteFeedbackTimer = null;

  const scheduleHide = () => {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      miniCart.classList.remove('is-visible');
      window.setTimeout(() => {
        if (!miniCart.classList.contains('is-visible')) {
          miniCart.hidden = true;
        }
      }, 260);
    }, 6000);
  };

  const renderMiniCart = () => {
    const item = activeKey ? commerce.getCartItem(activeKey) : null;

    if (!item) {
      miniCart.classList.remove('is-visible');
      miniCart.hidden = true;
      activeKey = null;
      return;
    }

    if (miniImage) {
      miniImage.src = sanitizePreviewImage(item.image);
      miniImage.alt = item.title;
    }

    if (miniTitle) {
      miniTitle.textContent = item.title;
    }

    if (miniMeasure) {
      miniMeasure.textContent = item.measure || 'Товар';
    }

    if (miniQuantity) {
      miniQuantity.textContent = formatPreviewQuantity(item.quantity);
    }

    if (miniLinePrice) {
      miniLinePrice.textContent = formatPreviewMoney(item.unitPrice * item.quantity);
    }

    if (miniSummary) {
      const quantity = commerce.getCartQuantity();
      miniSummary.textContent = `${formatPreviewQuantity(quantity)} в корзине · ${formatPreviewMoney(commerce.getCartTotal())}`;
    }

    if (miniMinus) {
      miniMinus.disabled = item.quantity <= item.min;
    }

    if (miniPlus) {
      miniPlus.disabled = item.quantity >= item.max;
    }
  };

  const showMiniCart = (item) => {
    const key = getPreviewProductKey(item);

    if (!key || document.querySelector('[data-cart-page]')) {
      return;
    }

    activeKey = key;
    renderMiniCart();

    // The most recent commerce feedback stays closest to the viewport edge.
    // Any already visible notification naturally moves one row higher.
    feedbackStack.append(miniCart);
    miniCart.hidden = false;

    window.requestAnimationFrame(() => {
      miniCart.classList.add('is-visible');
    });

    scheduleHide();
  };

  const hideFavoriteFeedback = () => {
    window.clearTimeout(favoriteFeedbackTimer);
    favoriteFeedback.classList.remove('is-visible');

    window.setTimeout(() => {
      if (!favoriteFeedback.classList.contains('is-visible')) {
        favoriteFeedback.hidden = true;
      }
    }, 220);
  };

  const showFavoriteFeedback = (item, isFavorite) => {
    const title = String(item?.title || 'Товар').trim();

    window.clearTimeout(favoriteFeedbackTimer);
    favoriteFeedback.classList.toggle('is-removed', !isFavorite);

    if (favoriteFeedbackTitle) {
      favoriteFeedbackTitle.textContent = isFavorite
        ? 'Добавлено в избранное'
        : 'Убрано из избранного';
    }

    if (favoriteFeedbackText) {
      favoriteFeedbackText.textContent = title;
    }

    if (favoriteFeedbackLink) {
      favoriteFeedbackLink.hidden = !isFavorite;
    }

    // Put the newest notification at the bottom of the shared stack.
    // If the mini-cart is already visible, it is pushed one row higher.
    feedbackStack.append(favoriteFeedback);
    favoriteFeedback.hidden = false;
    window.requestAnimationFrame(() => favoriteFeedback.classList.add('is-visible'));
    favoriteFeedbackTimer = window.setTimeout(hideFavoriteFeedback, 3200);
  };

  favoriteFeedbackClose?.addEventListener('click', hideFavoriteFeedback);

  miniCart.addEventListener('pointerenter', () => window.clearTimeout(hideTimer));
  miniCart.addEventListener('pointerleave', scheduleHide);
  miniCart.addEventListener('focusin', () => window.clearTimeout(hideTimer));
  miniCart.addEventListener('focusout', scheduleHide);

  miniMinus?.addEventListener('click', () => {
    const item = activeKey ? commerce.getCartItem(activeKey) : null;

    if (!item) {
      return;
    }

    const nextQuantity = Number((item.quantity - item.step).toFixed(6));

    if (nextQuantity < item.min) {
      return;
    }

    commerce.setCartQuantity(item.key, nextQuantity);
    scheduleHide();
  });

  miniPlus?.addEventListener('click', () => {
    const item = activeKey ? commerce.getCartItem(activeKey) : null;

    if (!item) {
      return;
    }

    commerce.setCartQuantity(
      item.key,
      Number(Math.min(item.max, item.quantity + item.step).toFixed(6)),
    );
    scheduleHide();
  });

  miniClose?.addEventListener('click', () => {
    window.clearTimeout(hideTimer);
    miniCart.classList.remove('is-visible');
    window.setTimeout(() => {
      miniCart.hidden = true;
    }, 240);
  });

  document.addEventListener('sibdel:add-to-cart-request', (event) => {
    const detail = event.detail || {};
    const item = commerce.addToCart(detail, detail.quantity || 1);

    if (item && detail.suppressMiniCart !== true) {
      showMiniCart(item);
    }
  });

  document.addEventListener('sibdel:cart-quantity-request', (event) => {
    const detail = event.detail || {};
    const key = String(detail.slug || detail.productId || '').trim();

    if (key) {
      commerce.setCartQuantity(key, detail.quantity);
    }
  });

  document.addEventListener('sibdel:cart-remove-request', (event) => {
    const detail = event.detail || {};
    const key = String(detail.slug || detail.productId || '').trim();

    if (key) {
      commerce.removeFromCart(key);
    }
  });

  document.addEventListener('sibdel:cart-clear-request', () => {
    commerce.clearCart();
  });

  document.addEventListener('sibdel:favorite-toggle-request', (event) => {
    const detail = event.detail || {};
    const shouldFavorite = detail.isFavorite !== false;

    commerce.setFavorite(detail, shouldFavorite);

    if (detail.feedback !== false) {
      showFavoriteFeedback(detail, shouldFavorite);
    }
  });

  document.addEventListener('sibdel:favorites-clear-request', () => {
    commerce.clearFavorites();
  });

  document.addEventListener('sibdel:commerce-state-changed', (event) => {
    updateGlobalCommerceIndicators();

    if (activeKey) {
      renderMiniCart();
    }

    document.dispatchEvent(
      new CustomEvent('sibdel:commerce-ui-updated', {
        detail: event.detail,
      }),
    );
  });

  window.addEventListener('storage', (event) => {
    if (
      event.key === SIBDEL_PREVIEW_CART_KEY ||
      event.key === SIBDEL_PREVIEW_FAVORITES_KEY
    ) {
      window.location.reload();
    }
  });

  const getPopularCardKey = (card) => {
    const link = card?.querySelector('.popular-products__name');

    if (!link) {
      return '';
    }

    const url = new URL(link.href, window.location.origin);

    return (
      url.searchParams.get('slug') ||
      link.textContent.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-')
    );
  };

  const syncPopularCards = () => {
    document.querySelectorAll('.popular-products__card').forEach((card) => {
      const key = getPopularCardKey(card);

      if (!key) {
        return;
      }

      const link = card.querySelector('.popular-products__name');
      const cartButton = card.querySelector('.popular-products__cart');
      const favoriteButton = card.querySelector('.popular-products__favorite');
      const isInCart = commerce.isInCart(key);
      const isFavorite = commerce.isFavorite(key);

      cartButton?.classList.toggle('is-added', isInCart);
      cartButton?.setAttribute('aria-pressed', String(isInCart));
      if (favoriteButton) {
        favoriteButton.classList.toggle('is-active', isFavorite);
        favoriteButton.setAttribute('aria-pressed', String(isFavorite));
        favoriteButton.textContent = isFavorite ? '♥' : '♡';
        favoriteButton.setAttribute(
          'aria-label',
          `${isFavorite ? 'Убрать' : 'Добавить'} ${link?.textContent?.trim() || 'товар'} ${isFavorite ? 'из' : 'в'} избранное`,
        );
      }
    });
  };

  document.addEventListener('sibdel:commerce-ui-updated', syncPopularCards);

  document.addEventListener('click', (event) => {
    const cartButton = event.target.closest('.popular-products__cart');

    if (cartButton) {
      const card = cartButton.closest('.popular-products__card');

      if (!card) {
        return;
      }

      const link = card.querySelector('.popular-products__name');
      const image = card.querySelector('.popular-products__image');
      const measure = card.querySelector('.popular-products__weight');
      const price = card.querySelector('.popular-products__price-current');
      const oldPrice = card.querySelector('.popular-products__price-old');
      const slug = new URL(link?.href || window.location.href).searchParams.get('slug') ||
        (link?.textContent || '').trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-');

      document.dispatchEvent(
        new CustomEvent('sibdel:add-to-cart-request', {
          detail: {
            productId: slug,
            slug,
            title: link?.textContent?.trim() || 'Товар',
            image: image?.getAttribute('src') || '',
            measure: measure?.textContent?.trim() || '',
            unitPrice: Number((price?.textContent || '').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0,
            oldUnitPrice: Number((oldPrice?.textContent || '').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0,
            quantity: 1,
            min: 1,
            max: 99,
            step: 1,
          },
        }),
      );

      cartButton.classList.add('is-added');
      window.setTimeout(() => cartButton.classList.remove('is-added'), 1200);
    }

    const favoriteButton = event.target.closest('.popular-products__favorite');

    if (favoriteButton) {
      const card = favoriteButton.closest('.popular-products__card');
      const link = card?.querySelector('.popular-products__name');
      const image = card?.querySelector('.popular-products__image');
      const measure = card?.querySelector('.popular-products__weight');
      const price = card?.querySelector('.popular-products__price-current');
      const oldPrice = card?.querySelector('.popular-products__price-old');

      if (!card || !link) {
        return;
      }

      const slug = new URL(link.href, window.location.origin).searchParams.get('slug') ||
        link.textContent.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-');
      const shouldFavorite = !favoriteButton.classList.contains('is-active');

      favoriteButton.classList.toggle('is-active', shouldFavorite);
      favoriteButton.setAttribute('aria-pressed', String(shouldFavorite));
      favoriteButton.textContent = shouldFavorite ? '♥' : '♡';
      favoriteButton.setAttribute(
        'aria-label',
        `${shouldFavorite ? 'Убрать' : 'Добавить'} ${link.textContent.trim()} ${shouldFavorite ? 'из' : 'в'} избранное`,
      );

      document.dispatchEvent(
        new CustomEvent('sibdel:favorite-toggle-request', {
          detail: {
            productId: slug,
            slug,
            title: link.textContent.trim(),
            image: image?.getAttribute('src') || '',
            measure: measure?.textContent?.trim() || '',
            unitPrice: Number((price?.textContent || '').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0,
            oldUnitPrice: Number((oldPrice?.textContent || '').replace(/[^0-9.,]/g, '').replace(',', '.')) || 0,
            available: true,
            isFavorite: shouldFavorite,
          },
        }),
      );
    }
  });

  syncPopularCards();
  updateGlobalCommerceIndicators();
}

document.addEventListener('DOMContentLoaded', async () => {
  initGlobalCommercePreview();

  await loadLayoutComponents();
  initMobileHeader();
  initSmartHeader();
  updateGlobalCommerceIndicators();

  if (document.querySelector('[data-home-page]')) {
    initPromotionsSlider();
    initPopularProductsSlider();
    initReviewsSlider();
  }
});
