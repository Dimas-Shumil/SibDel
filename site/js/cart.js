function clampCommerceNumber(value, min, max) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return min;
  }

  return Math.min(Math.max(numericValue, min), max);
}

function getCommerceStepPrecision(step) {
  const stepString = String(step);
  const dotIndex = stepString.indexOf('.');
  return dotIndex === -1 ? 0 : stepString.length - dotIndex - 1;
}

function normalizeCommerceQuantity(value, item) {
  const min = Number(item.min) || 1;
  const max = Number(item.max) || 999;
  const step = Number(item.step) || 1;
  const precision = getCommerceStepPrecision(step);
  const clamped = clampCommerceNumber(value, min, max);
  const stepsFromMin = Math.round((clamped - min) / step);
  const normalized = min + stepsFromMin * step;

  return Number(clampCommerceNumber(normalized, min, max).toFixed(precision));
}

function formatCommerceMoney(value) {
  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)} ₽`;
}

function formatCommerceQuantity(value) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 3,
  }).format(Number(value) || 0);
}

function formatCommerceCount(value, forms) {
  const number = Number(value) || 0;

  if (!Number.isInteger(number)) {
    return `${formatCommerceQuantity(number)} ${forms[1]}`;
  }

  const absolute = Math.abs(number);
  const mod100 = absolute % 100;
  const mod10 = absolute % 10;
  let form = forms[2];

  if (mod100 < 11 || mod100 > 14) {
    if (mod10 === 1) {
      form = forms[0];
    } else if (mod10 >= 2 && mod10 <= 4) {
      form = forms[1];
    }
  }

  return `${number} ${form}`;
}

function escapeCommerceHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function sanitizeCommerceImage(value) {
  const image = String(value || '').trim();

  if (/^\/site\/images\/[a-zA-Z0-9_./%()\-]+$/.test(image)) {
    return image;
  }

  return '/site/images/kol-taezh.webp';
}

function getCommerceKey(item) {
  return String(item?.slug || item?.productId || item?.key || '').trim();
}

function dispatchCommerceEvent(name, detail = {}) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}

function createCommerceToast(root) {
  const toast = root.querySelector('[data-commerce-toast]');

  if (!toast) {
    return { show() {}, hide() {} };
  }

  const text = toast.querySelector('[data-commerce-toast-text]');
  const undoButton = toast.querySelector('[data-commerce-toast-undo]');
  let timer = null;
  let undoHandler = null;

  const hide = () => {
    window.clearTimeout(timer);
    toast.hidden = true;
    toast.classList.remove('is-visible');

    if (undoButton) {
      undoButton.hidden = true;
      undoButton.onclick = null;
    }

    undoHandler = null;
  };

  const show = (message, options = {}) => {
    window.clearTimeout(timer);

    if (text) {
      text.textContent = message;
    }

    undoHandler = typeof options.onUndo === 'function' ? options.onUndo : null;

    if (undoButton) {
      undoButton.hidden = !undoHandler;
      undoButton.onclick = undoHandler
        ? () => {
            const handler = undoHandler;
            hide();
            handler();
          }
        : null;
    }

    toast.hidden = false;
    window.requestAnimationFrame(() => toast.classList.add('is-visible'));
    timer = window.setTimeout(hide, options.duration ?? 4200);
  };

  return { show, hide };
}

function readCartItemFromElement(element) {
  const input = element.querySelector('[data-cart-quantity-input]');
  const title = element.querySelector('.cart-item__title');
  const image = element.querySelector('.cart-item__image');
  const measure = element.querySelector('.cart-item__measure');
  const badge = element.querySelector('.cart-item__badge');

  return {
    productId: element.dataset.productId || element.dataset.productSlug || null,
    slug: element.dataset.productSlug || '',
    title: title?.textContent?.trim() || 'Товар',
    image: image?.getAttribute('src') || '',
    measure: measure?.textContent?.trim() || '',
    badge: badge?.textContent?.trim() || '',
    available: !element.querySelector('.cart-item__stock--unavailable'),
    unitPrice: Number(element.dataset.unitPrice) || 0,
    oldUnitPrice: Number(element.dataset.oldUnitPrice) || Number(element.dataset.unitPrice) || 0,
    quantity: Number(input?.value) || 1,
    min: Number(element.dataset.min ?? input?.min) || 1,
    max: Number(element.dataset.max ?? input?.max) || 999,
    step: Number(element.dataset.step ?? input?.step) || 1,
  };
}

function createCartItemMarkup(item, isFavorite = false) {
  const key = getCommerceKey(item);
  const slug = encodeURIComponent(String(item.slug || key));
  const title = escapeCommerceHtml(item.title || 'Товар');
  const measure = escapeCommerceHtml(item.measure || '');
  const image = sanitizeCommerceImage(item.image);
  const badge = String(item.badge || '').trim();
  const quantity = normalizeCommerceQuantity(item.quantity, item);
  const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
  const oldUnitPrice = Math.max(unitPrice, Number(item.oldUnitPrice) || unitPrice);
  const badgeMarkup = badge
    ? `<span class="cart-item__badge${badge.includes('%') ? ' cart-item__badge--discount' : ''}">${escapeCommerceHtml(badge)}</span>`
    : '';

  return `
    <article
      class="cart-item"
      data-cart-item
      data-product-id="${escapeCommerceHtml(item.productId || key)}"
      data-product-slug="${escapeCommerceHtml(item.slug || key)}"
      data-unit-price="${unitPrice}"
      data-old-unit-price="${oldUnitPrice}"
      data-min="${Number(item.min) || 1}"
      data-max="${Number(item.max) || 999}"
      data-step="${Number(item.step) || 1}"
    >
      <a class="cart-item__media" href="/product.html?slug=${slug}">
        <img class="cart-item__image" src="${image}" alt="${title}" width="600" height="450" loading="lazy" decoding="async" />
        ${badgeMarkup}
      </a>

      <div class="cart-item__content">
        <div class="cart-item__top">
          <div class="cart-item__name-wrap">
            <a class="cart-item__title" href="/product.html?slug=${slug}">${title}</a>
            <span class="cart-item__measure">${measure}</span>
            <span class="cart-item__stock ${item.available === false ? 'cart-item__stock--unavailable' : 'cart-item__stock--available'}">
              <span aria-hidden="true"></span>${item.available === false ? 'Временно нет' : 'В наличии'}
            </span>
          </div>

          <button class="cart-item__remove" type="button" aria-label="Удалить ${title} из корзины" data-cart-remove>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>

        <div class="cart-item__bottom">
          <div class="cart-quantity" data-cart-quantity>
            <button class="cart-quantity__button" type="button" aria-label="Уменьшить количество" data-cart-minus>−</button>
            <label class="cart-quantity__field">
              <span class="visually-hidden">Количество ${title}</span>
              <input class="cart-quantity__input" type="number" min="${Number(item.min) || 1}" max="${Number(item.max) || 999}" step="${Number(item.step) || 1}" value="${quantity}" inputmode="decimal" data-cart-quantity-input />
            </label>
            <button class="cart-quantity__button" type="button" aria-label="Увеличить количество" data-cart-plus>+</button>
          </div>

          <button
            class="cart-item__favorite${isFavorite ? ' is-active' : ''}"
            type="button"
            aria-pressed="${String(isFavorite)}"
            aria-label="${isFavorite ? `Убрать ${title} из избранного` : `Добавить ${title} в избранное`}"
            data-cart-toggle-favorite
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 4.7 13.4C1.8 10.5 2 6 5.5 4.6 8 3.6 10.1 5 12 7.1 13.9 5 16 3.6 18.5 4.6 22 6 22.2 10.5 19.3 13.4L12 20.5Z" /></svg>
            <span>${isFavorite ? 'В избранном' : 'В избранное'}</span>
          </button>

          <div class="cart-item__prices">
            <del class="cart-item__old-price" data-cart-old-line-price${oldUnitPrice <= unitPrice ? ' hidden' : ''}>${formatCommerceMoney(oldUnitPrice * quantity)}</del>
            <strong class="cart-item__price" data-cart-line-price>${formatCommerceMoney(unitPrice * quantity)}</strong>
          </div>
        </div>
      </div>
    </article>
  `;
}

function readFavoriteItemFromElement(card) {
  const title = card.querySelector('.favorite-card__title');
  const image = card.querySelector('.favorite-card__image');
  const measure = card.querySelector('.favorite-card__measure');
  const badge = card.querySelector('.favorite-card__badge');
  const prices = card.querySelectorAll('.favorite-card__prices strong, .favorite-card__prices del');
  const rating = card.querySelector('.favorite-card__rating span');
  const reviewCount = card.querySelector('.favorite-card__rating small');
  const parsePrice = (value) =>
    Number(String(value || '').replace(/\s/g, '').replace(',', '.').replace(/[^0-9.]/g, '')) || 0;

  return {
    productId: card.dataset.productId || card.dataset.productSlug || null,
    slug: card.dataset.productSlug || '',
    title: title?.textContent?.trim() || 'Товар',
    image: image?.getAttribute('src') || '',
    measure: measure?.textContent?.trim() || '',
    badge: badge?.textContent?.trim() || '',
    available: card.dataset.available !== 'false',
    unitPrice: parsePrice(prices[0]?.textContent),
    oldUnitPrice: parsePrice(prices[1]?.textContent),
    rating: rating?.textContent?.trim() || '',
    reviewCount: reviewCount?.textContent?.trim() || '',
    quantity: 1,
    min: 1,
    max: 99,
    step: 1,
  };
}

function createFavoriteCardMarkup(item) {
  const key = getCommerceKey(item);
  const slug = encodeURIComponent(String(item.slug || key));
  const title = escapeCommerceHtml(item.title || 'Товар');
  const measure = escapeCommerceHtml(item.measure || '');
  const image = sanitizeCommerceImage(item.image);
  const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
  const oldUnitPrice = Math.max(0, Number(item.oldUnitPrice) || 0);
  const badge = String(item.badge || '').trim();
  const badgeModifier = badge.includes('%')
    ? ' favorite-card__badge--discount'
    : /нов/i.test(badge)
      ? ' favorite-card__badge--new'
      : ' favorite-card__badge--hit';
  const badgeMarkup = badge
    ? `<span class="favorite-card__badge${badgeModifier}">${escapeCommerceHtml(badge)}</span>`
    : '';
  const oldPriceMarkup = oldUnitPrice > unitPrice
    ? `<del>${formatCommerceMoney(oldUnitPrice)}</del>`
    : '';
  const available = item.available !== false;

  return `
    <article class="favorite-card" data-favorite-card data-product-id="${escapeCommerceHtml(item.productId || key)}" data-product-slug="${escapeCommerceHtml(item.slug || key)}" data-available="${available}">
      <div class="favorite-card__media">
        <a class="favorite-card__image-link" href="/product.html?slug=${slug}">
          <img class="favorite-card__image" src="${image}" alt="${title}" width="600" height="450" loading="lazy" decoding="async" />
        </a>
        ${badgeMarkup}
        <button class="favorite-card__remove is-active" type="button" aria-label="Убрать ${title} из избранного" data-favorite-remove>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 4.7 13.4C1.8 10.5 2 6 5.5 4.6 8 3.6 10.1 5 12 7.1 13.9 5 16 3.6 18.5 4.6 22 6 22.2 10.5 19.3 13.4L12 20.5Z" /></svg>
        </button>
      </div>
      <div class="favorite-card__body">
        <a class="favorite-card__title" href="/product.html?slug=${slug}">${title}</a>
        <span class="favorite-card__measure">${measure}</span>
        <div class="favorite-card__rating"><span aria-hidden="true">${escapeCommerceHtml(item.rating || '★★★★★')}</span><small>${escapeCommerceHtml(item.reviewCount || '')}</small></div>
        <div class="favorite-card__stock ${available ? 'favorite-card__stock--available' : 'favorite-card__stock--unavailable'}"><span aria-hidden="true"></span>${available ? 'В наличии' : 'Временно нет'}</div>
        <div class="favorite-card__bottom">
          <div class="favorite-card__prices"><strong>${formatCommerceMoney(unitPrice)}</strong>${oldPriceMarkup}</div>
          <button class="favorite-card__cart${available ? '' : ' favorite-card__cart--disabled'}" type="button" ${available ? '' : 'disabled'} aria-label="${available ? `Добавить ${title} в корзину` : `${title} временно недоступен`}" data-favorite-add-cart>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h2l2 9h9.7l2.1-6H7" /><circle cx="10" cy="18" r="1.3" /><circle cx="17" cy="18" r="1.3" /></svg>
          </button>
        </div>
      </div>
    </article>
  `;
}

function initCartPage() {
  const page = document.querySelector('[data-cart-page]');
  const commerce = window.SibDelCommerce;

  if (!page || !commerce) {
    return;
  }

  const toast = createCommerceToast(page);
  const itemsRoot = page.querySelector('[data-cart-items]');
  const cartContent = page.querySelector('[data-cart-content]');
  const cartSummary = page.querySelector('[data-cart-summary]');
  const emptyState = page.querySelector('[data-cart-empty]');
  const clearButton = page.querySelector('[data-cart-clear]');
  const headingCount = page.querySelector('[data-cart-heading-count]');
  const linesCount = page.querySelector('[data-cart-lines-count]');
  const summaryCountLabel = page.querySelector('[data-cart-summary-count-label]');
  const subtotalOutput = page.querySelector('[data-cart-subtotal]');
  const discountOutput = page.querySelector('[data-cart-discount]');
  const totalOutput = page.querySelector('[data-cart-total]');
  const mobileTotalOutput = page.querySelector('[data-cart-mobile-total]');
  const mobileBar = page.querySelector('[data-cart-mobile-bar]');
  const deliveryTitle = page.querySelector('[data-delivery-progress-title]');
  const deliveryBar = page.querySelector('[data-delivery-progress-bar]');
  const freeDeliveryThreshold = Number(page.dataset.freeDeliveryThreshold) || 3000;

  if (!itemsRoot) {
    return;
  }

  if (!commerce.hasCartState()) {
    commerce.replaceCart([]);
  }

  const renderCart = () => {
    const items = commerce.getCart();

    itemsRoot.innerHTML = items
      .map((item) => createCartItemMarkup(item, commerce.isFavorite(getCommerceKey(item))))
      .join('');

    const totals = items.reduce(
      (result, item) => {
        const quantity = normalizeCommerceQuantity(item.quantity, item);
        const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
        const oldUnitPrice = Math.max(unitPrice, Number(item.oldUnitPrice) || unitPrice);

        result.lines += 1;
        result.quantity += quantity;
        result.total += unitPrice * quantity;
        result.oldTotal += oldUnitPrice * quantity;
        return result;
      },
      { lines: 0, quantity: 0, total: 0, oldTotal: 0 },
    );

    const discount = Math.max(0, totals.oldTotal - totals.total);
    const isEmpty = totals.lines === 0;

    if (headingCount) {
      headingCount.textContent = formatCommerceCount(totals.quantity, ['товар', 'товара', 'товаров']);
    }

    if (linesCount) {
      linesCount.textContent = formatCommerceCount(totals.lines, ['позиция', 'позиции', 'позиций']);
    }

    if (summaryCountLabel) {
      summaryCountLabel.textContent = `Товары, ${formatCommerceQuantity(totals.quantity)}`;
    }

    if (subtotalOutput) {
      subtotalOutput.textContent = formatCommerceMoney(totals.oldTotal);
    }

    if (discountOutput) {
      discountOutput.textContent = discount ? `−${formatCommerceMoney(discount)}` : formatCommerceMoney(0);
    }

    if (totalOutput) {
      totalOutput.textContent = formatCommerceMoney(totals.total);
    }

    if (mobileTotalOutput) {
      mobileTotalOutput.textContent = formatCommerceMoney(totals.total);
    }

    if (deliveryTitle && deliveryBar) {
      const remaining = Math.max(0, freeDeliveryThreshold - totals.total);
      const progress = freeDeliveryThreshold
        ? Math.min(100, (totals.total / freeDeliveryThreshold) * 100)
        : 100;

      deliveryBar.style.width = `${progress}%`;
      deliveryTitle.textContent = remaining
        ? `До бесплатной доставки осталось ${formatCommerceMoney(remaining)}`
        : 'Бесплатная доставка уже доступна';
    }

    if (cartContent) cartContent.hidden = isEmpty;
    if (cartSummary) cartSummary.hidden = isEmpty;
    if (emptyState) emptyState.hidden = !isEmpty;
    if (mobileBar) mobileBar.hidden = isEmpty;
  };

  itemsRoot.addEventListener('click', (event) => {
    const itemElement = event.target.closest('[data-cart-item]');

    if (!itemElement) {
      return;
    }

    const key = String(itemElement.dataset.productSlug || itemElement.dataset.productId || '');
    const item = commerce.getCartItem(key);

    if (!item) {
      return;
    }

    if (event.target.closest('[data-cart-minus]')) {
      dispatchCommerceEvent('sibdel:cart-quantity-request', {
        productId: item.productId,
        slug: item.slug,
        quantity: normalizeCommerceQuantity(item.quantity - item.step, item),
      });
      return;
    }

    if (event.target.closest('[data-cart-plus]')) {
      dispatchCommerceEvent('sibdel:cart-quantity-request', {
        productId: item.productId,
        slug: item.slug,
        quantity: normalizeCommerceQuantity(item.quantity + item.step, item),
      });
      return;
    }

    if (event.target.closest('[data-cart-remove]')) {
      dispatchCommerceEvent('sibdel:cart-remove-request', {
        productId: item.productId,
        slug: item.slug,
      });

      toast.show('Товар удалён из корзины', {
        onUndo: () => {
          dispatchCommerceEvent('sibdel:add-to-cart-request', item);
        },
      });
      return;
    }

    if (event.target.closest('[data-cart-toggle-favorite]')) {
      const wasFavorite = commerce.isFavorite(getCommerceKey(item));
      const shouldFavorite = !wasFavorite;

      dispatchCommerceEvent('sibdel:favorite-toggle-request', {
        ...item,
        isFavorite: shouldFavorite,
        feedback: false,
      });

      toast.show(
        shouldFavorite
          ? 'Добавлено в избранное — товар остался в корзине'
          : 'Товар убран из избранного',
        {
          onUndo: () => {
            dispatchCommerceEvent('sibdel:favorite-toggle-request', {
              ...item,
              isFavorite: wasFavorite,
              feedback: false,
            });
          },
        },
      );
    }
  });

  itemsRoot.addEventListener('change', (event) => {
    const input = event.target.closest('[data-cart-quantity-input]');
    const itemElement = event.target.closest('[data-cart-item]');

    if (!input || !itemElement) {
      return;
    }

    const key = String(itemElement.dataset.productSlug || itemElement.dataset.productId || '');
    const item = commerce.getCartItem(key);

    if (!item) {
      return;
    }

    dispatchCommerceEvent('sibdel:cart-quantity-request', {
      productId: item.productId,
      slug: item.slug,
      quantity: normalizeCommerceQuantity(input.value, item),
    });
  });

  clearButton?.addEventListener('click', () => {
    const items = commerce.getCart();

    if (!items.length) {
      return;
    }

    dispatchCommerceEvent('sibdel:cart-clear-request');
    toast.show('Корзина очищена', {
      onUndo: () => items.forEach((item) => dispatchCommerceEvent('sibdel:add-to-cart-request', item)),
    });
  });

  const promoForm = page.querySelector('[data-cart-promo-form]');
  const promoInput = page.querySelector('[data-cart-promo-input]');
  const promoMessage = page.querySelector('[data-cart-promo-message]');

  promoForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const promoCode = promoInput?.value.trim() || '';

    if (!promoCode) {
      promoMessage?.classList.add('is-error');
      if (promoMessage) promoMessage.textContent = 'Введите промокод.';
      promoInput?.focus();
      return;
    }

    promoMessage?.classList.remove('is-error');
    if (promoMessage) {
      promoMessage.textContent = 'Промокод проверим на сервере при расчёте заказа.';
    }
    dispatchCommerceEvent('sibdel:promo-apply-request', { code: promoCode });
  });

  document.addEventListener('sibdel:commerce-ui-updated', renderCart);
  renderCart();
}

function initFavoritesPage() {
  const page = document.querySelector('[data-favorites-page]');
  const commerce = window.SibDelCommerce;

  if (!page || !commerce) {
    return;
  }

  const toast = createCommerceToast(page);
  const grid = page.querySelector('[data-favorites-grid]');
  const toolbar = page.querySelector('[data-favorites-toolbar]');
  const emptyState = page.querySelector('[data-favorites-empty]');
  const headingCount = page.querySelector('[data-favorites-heading-count]');
  const inlineCount = page.querySelector('[data-favorites-count]');
  const clearButton = page.querySelector('[data-favorites-clear]');
  const addAllButton = page.querySelector('[data-favorites-add-all]');

  if (!grid) {
    return;
  }

  if (!commerce.hasFavoritesState()) {
    commerce.replaceFavorites([]);
  }

  const renderFavorites = () => {
    const favorites = commerce.getFavorites();
    const count = favorites.length;
    const label = formatCommerceCount(count, ['товар', 'товара', 'товаров']);

    grid.innerHTML = favorites.map(createFavoriteCardMarkup).join('');
    if (headingCount) headingCount.textContent = label;
    if (inlineCount) inlineCount.textContent = label;
    if (toolbar) toolbar.hidden = count === 0;
    if (emptyState) emptyState.hidden = count !== 0;
  };

  grid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-favorite-card]');

    if (!card) {
      return;
    }

    const key = String(card.dataset.productSlug || card.dataset.productId || '');
    const item = commerce.getFavorites().find((entry) => getCommerceKey(entry) === key);

    if (!item) {
      return;
    }

    if (event.target.closest('[data-favorite-remove]')) {
      dispatchCommerceEvent('sibdel:favorite-toggle-request', {
        ...item,
        isFavorite: false,
        feedback: false,
      });
      toast.show('Товар убран из избранного', {
        onUndo: () =>
          dispatchCommerceEvent('sibdel:favorite-toggle-request', {
            ...item,
            isFavorite: true,
            feedback: false,
          }),
      });
      return;
    }

    const cartButton = event.target.closest('[data-favorite-add-cart]');

    if (cartButton && item.available !== false) {
      dispatchCommerceEvent('sibdel:add-to-cart-request', {
        ...item,
        quantity: 1,
      });
      cartButton.classList.add('is-added');
      window.setTimeout(() => cartButton.classList.remove('is-added'), 1200);
    }
  });

  clearButton?.addEventListener('click', () => {
    const favorites = commerce.getFavorites();

    if (!favorites.length) {
      return;
    }

    dispatchCommerceEvent('sibdel:favorites-clear-request');
    toast.show('Избранное очищено', {
      onUndo: () =>
        favorites.forEach((item) =>
          dispatchCommerceEvent('sibdel:favorite-toggle-request', {
            ...item,
            isFavorite: true,
            feedback: false,
          }),
        ),
    });
  });

  addAllButton?.addEventListener('click', () => {
    const availableItems = commerce
      .getFavorites()
      .filter((item) => item.available !== false);

    if (!availableItems.length) {
      toast.show('Сейчас нет доступных товаров для добавления');
      return;
    }

    availableItems.forEach((item) =>
      dispatchCommerceEvent('sibdel:add-to-cart-request', {
        ...item,
        quantity: 1,
        suppressMiniCart: true,
      }),
    );

    toast.show(
      `${formatCommerceCount(availableItems.length, ['товар', 'товара', 'товаров'])} добавлено в корзину`,
    );
  });

  document.addEventListener('sibdel:commerce-ui-updated', renderFavorites);
  renderFavorites();
}

document.addEventListener('DOMContentLoaded', () => {
  initCartPage();
  initFavoritesPage();
});
