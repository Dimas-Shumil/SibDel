function escapeProductHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatProductMoney(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return '0 ₽';
  }

  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(amount)} ₽`;
}

function formatReviewDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function getProductSlugFromPage() {
  const params = new URLSearchParams(window.location.search);
  const page = document.querySelector('[data-product-page]');

  return params.get('slug') || page?.dataset.productSlug || '';
}

async function fetchPublicProduct(slug) {
  const response = await fetch(`/api/products/${encodeURIComponent(slug)}`, {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    const error = new Error(
      payload?.error?.message || 'Не удалось загрузить товар.',
    );
    error.status = response.status;
    throw error;
  }

  return payload.product;
}

function renderProductGallery(product) {
  const gallery = document.querySelector('[data-product-gallery]');
  const thumbs = gallery?.querySelector('.product-gallery__thumbs');
  const mainImage = gallery?.querySelector('[data-gallery-main]');
  const counterTotal = gallery?.querySelector('[data-gallery-total]');

  if (!gallery || !thumbs || !mainImage) {
    return;
  }

  const images = product.images?.length
    ? product.images
    : product.primaryImage
      ? [product.primaryImage]
      : [];

  if (!images.length) {
    return;
  }

  thumbs.innerHTML = images
    .map(
      (image, index) => `
        <button
          class="product-gallery__thumb${index === 0 ? ' product-gallery__thumb--active' : ''}"
          type="button"
          aria-label="Показать фото ${index + 1}"
          aria-pressed="${index === 0 ? 'true' : 'false'}"
          data-gallery-thumb
          data-gallery-src="${escapeProductHtml(image.url)}"
          data-gallery-alt="${escapeProductHtml(image.alt || product.name)}"
        >
          <img
            src="${escapeProductHtml(image.url)}"
            alt=""
            width="1448"
            height="1086"
            loading="${index === 0 ? 'eager' : 'lazy'}"
          />
        </button>
      `,
    )
    .join('');

  mainImage.src = images[0].url;
  mainImage.alt = images[0].alt || product.name;

  if (counterTotal) {
    counterTotal.textContent = String(images.length);
  }
}

function renderProductDescription(product) {
  const description = document.querySelector('[data-product-description]');
  const highlights = document.querySelector('[data-product-highlights]');
  const characteristics = document.querySelector('[data-product-characteristics]');
  const nutrition = document.querySelector('[data-product-nutrition]');

  if (description) {
    const paragraphs = String(product.description || product.shortDescription || '')
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean);

    description.innerHTML = paragraphs.length
      ? paragraphs.map((item) => `<p>${escapeProductHtml(item)}</p>`).join('')
      : '<p>Описание товара уточняется.</p>';
  }

  if (highlights) {
    highlights.innerHTML = Array.isArray(product.highlights) && product.highlights.length
      ? product.highlights
          .map((item) => `<li>${escapeProductHtml(item)}</li>`)
          .join('')
      : '';
    highlights.hidden = !product.highlights?.length;
  }

  if (characteristics) {
    const rows = [
      product.category
        ? {
            name: 'Категория',
            value: product.category.name,
          }
        : null,
      ...(Array.isArray(product.characteristics) ? product.characteristics : []),
    ].filter((item) => item?.name && item?.value);

    characteristics.innerHTML = rows.length
      ? rows
          .map(
            (item) => `
              <div class="product-specs__row">
                <dt>${escapeProductHtml(item.name)}</dt>
                <dd>${escapeProductHtml(item.value)}</dd>
              </div>
            `,
          )
          .join('')
      : '<div class="product-specs__row"><dt>Информация</dt><dd>Уточняется</dd></div>';
  }

  if (nutrition) {
    const items = Array.isArray(product.nutrition) ? product.nutrition : [];

    nutrition.innerHTML = items.length
      ? items
          .filter((item) => item?.label && item?.value)
          .map(
            (item) => `
              <article class="product-nutrition__item">
                <strong>${escapeProductHtml(item.value)}</strong>
                <span>${escapeProductHtml(item.label)}</span>
              </article>
            `,
          )
          .join('')
      : '<p class="product-details__note">Пищевая ценность уточняется.</p>';
  }
}

function renderProductReviews(product) {
  const score = document.querySelector('.product-reviews__score strong');
  const count = document.querySelector('.product-reviews__score small');
  const list = document.querySelector('.product-reviews__list');
  const shortCount = document.querySelector('[data-product-review-count-short]');
  const summaryCount = document.querySelector('[data-product-review-count]');
  const summaryRating = document.querySelector('[data-product-rating]');
  const reviewCount = Number(product.rating?.count || 0);
  const average = product.rating?.average;

  if (score) {
    score.textContent = average ?? '—';
  }

  if (count) {
    count.textContent = reviewCount ? `${reviewCount} отзывов` : 'Нет отзывов';
  }

  if (shortCount) {
    shortCount.textContent = String(reviewCount);
  }

  if (summaryCount) {
    summaryCount.textContent = reviewCount ? `${reviewCount} отзывов` : 'Нет отзывов';
  }

  if (summaryRating) {
    summaryRating.textContent = average ?? '—';
  }

  if (list) {
    const reviews = Array.isArray(product.reviews) ? product.reviews : [];

    list.innerHTML = reviews.length
      ? reviews
          .map(
            (review) => `
              <article class="product-review-card">
                <div class="product-review-card__head">
                  <strong>${escapeProductHtml(review.authorName)}</strong>
                  <span>${escapeProductHtml(formatReviewDate(review.createdAt))}</span>
                </div>
                <span class="product-review-card__stars" aria-label="${Number(review.rating)} из 5">${'★'.repeat(Math.max(0, Math.min(5, Number(review.rating))))}</span>
                <p>${escapeProductHtml(review.text)}</p>
              </article>
            `,
          )
          .join('')
      : '<p class="product-details__note">У этого товара пока нет опубликованных отзывов.</p>';
  }
}

function renderRelatedProducts(products) {
  const container = document.querySelector('[data-related-products]');
  const section = container?.closest('.related-products');

  if (!container) {
    return;
  }

  if (!Array.isArray(products) || products.length === 0) {
    if (section) {
      section.hidden = true;
    }
    return;
  }

  if (section) {
    section.hidden = false;
  }

  container.innerHTML = products
    .map((product) => {
      const image = product.primaryImage?.url || '';
      const badge = product.badge
        ? `<span class="related-product-card__badge related-product-card__badge--${escapeProductHtml(product.badge.type)}">${escapeProductHtml(product.badge.label)}</span>`
        : '';

      return `
        <article class="related-product-card">
          <a class="related-product-card__media" href="/product.html?slug=${encodeURIComponent(product.slug)}">
            <img src="${escapeProductHtml(image)}" alt="${escapeProductHtml(product.primaryImage?.alt || product.name)}" width="1448" height="1086" loading="lazy" />
            ${badge}
          </a>
          <div class="related-product-card__body">
            <a class="related-product-card__title" href="/product.html?slug=${encodeURIComponent(product.slug)}">${escapeProductHtml(product.name)}</a>
            <span class="related-product-card__measure">${escapeProductHtml(product.unitLabel || product.unit || '')}</span>
            <div class="related-product-card__rating"><span aria-hidden="true">★★★★★</span><small>${Number(product.rating?.count || 0)}</small></div>
            <div class="related-product-card__bottom"><strong>${formatProductMoney(product.price)}</strong></div>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderProductError(message) {
  const page = document.querySelector('[data-product-page]');

  if (!page) {
    return;
  }

  page.innerHTML = `
    <section class="product-main">
      <div class="product-main__container">
        <div class="product-details__panel product-details__panel--active">
          <h1 class="product-details__title">Товар не найден</h1>
          <p class="product-details__note">${escapeProductHtml(message)}</p>
          <a href="/catalog.html">Вернуться в каталог</a>
        </div>
      </div>
    </section>
  `;
}

async function hydrateProductPage() {
  const slug = getProductSlugFromPage();

  if (!slug) {
    renderProductError('В ссылке отсутствует идентификатор товара.');
    return false;
  }

  try {
    const product = await fetchPublicProduct(slug);
    const page = document.querySelector('[data-product-page]');

    if (!page) {
      return false;
    }

    page.dataset.productId = String(product.id);
    page.dataset.productSlug = product.slug;

    document.title = product.seo?.title || `${product.name} — Сибирские Деликатесы`;

    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription && (product.seo?.description || product.shortDescription)) {
      metaDescription.setAttribute(
        'content',
        product.seo?.description || product.shortDescription,
      );
    }

    const categoryLink = document.querySelector('[data-product-category-link]');
    if (categoryLink && product.category) {
      categoryLink.textContent = product.category.name;
      categoryLink.href = `/catalog.html?category=${encodeURIComponent(product.category.slug)}`;
    }

    const breadcrumbName = document.querySelector('[data-product-breadcrumb-name]');
    if (breadcrumbName) {
      breadcrumbName.textContent = product.name;
    }

    const name = document.querySelector('[data-product-name]');
    const sku = document.querySelector('[data-product-sku]');
    const shortDescription = document.querySelector('[data-product-short-description]');
    const price = document.querySelector('[data-product-price]');
    const oldPrice = document.querySelector('[data-product-old-price]');
    const discount = document.querySelector('[data-product-discount]');
    const unitLabel = document.querySelector('[data-product-unit-label]');
    const badge = document.querySelector('[data-product-badge]');

    if (name) name.textContent = product.name;
    if (sku) sku.textContent = product.sku;
    if (shortDescription) shortDescription.textContent = product.shortDescription || '';
    if (price) price.textContent = formatProductMoney(product.price);

    if (oldPrice) {
      oldPrice.textContent = product.oldPrice ? formatProductMoney(product.oldPrice) : '';
      oldPrice.hidden = !product.oldPrice;
    }

    const discountPercent =
      product.oldPrice && Number(product.oldPrice) > Number(product.price)
        ? Math.round(
            ((Number(product.oldPrice) - Number(product.price)) /
              Number(product.oldPrice)) *
              100,
          )
        : 0;

    if (discount) {
      discount.textContent = discountPercent ? `-${discountPercent}%` : '';
      discount.hidden = !discountPercent;
    }

    if (unitLabel) {
      unitLabel.textContent = product.unitLabel || product.unit || '';
    }

    if (badge) {
      badge.textContent = product.badge?.label || '';
      badge.hidden = !product.badge;
    }

    const stockRow = document.querySelector('[data-stock-status]');
    const stockLabel = document.querySelector('[data-product-stock-label]');
    const stockNote = document.querySelector('[data-product-stock-note]');
    const stockState = product.stockState || 'available';
    const stockTexts = {
      available: ['В наличии', 'Доступно для заказа'],
      low: [
        'Осталось мало',
        product.stockQuantity ? `Осталось: ${product.stockQuantity}` : 'Количество ограничено',
      ],
      out: ['Нет в наличии', 'Сейчас недоступно для заказа'],
    };

    if (stockRow) {
      stockRow.dataset.stockStatus = stockState === 'out' ? 'unavailable' : stockState;
    }

    if (stockLabel) {
      stockLabel.classList.remove(
        'product-summary__stock--available',
        'product-summary__stock--low',
        'product-summary__stock--unavailable',
      );
      stockLabel.classList.add(
        stockState === 'out'
          ? 'product-summary__stock--unavailable'
          : stockState === 'low'
            ? 'product-summary__stock--low'
            : 'product-summary__stock--available',
      );
      const dot = stockLabel.querySelector('.product-summary__stock-dot');
      stockLabel.replaceChildren();
      if (dot) stockLabel.append(dot);
      stockLabel.append(document.createTextNode(stockTexts[stockState][0]));
    }

    if (stockNote) {
      stockNote.textContent = stockTexts[stockState][1];
    }

    const quantityControl = document.querySelector('[data-quantity-control]');
    const quantityInput = document.querySelector('[data-quantity-input]');
    const min = Number(product.minQuantity) || 1;
    const step = Number(product.step) || 1;
    const stock = Number(product.stockQuantity);
    const max =
      Number.isFinite(stock) && stock > 0
        ? Math.max(min, stock)
        : 99;

    if (quantityControl) {
      quantityControl.dataset.min = String(min);
      quantityControl.dataset.step = String(step);
      quantityControl.dataset.max = String(max);
    }

    if (quantityInput) {
      quantityInput.value = String(min);
      quantityInput.min = String(min);
      quantityInput.step = String(step);
      quantityInput.max = String(max);
    }

    const cartButton = document.querySelector('[data-product-add-to-cart]');
    if (cartButton) {
      cartButton.disabled = !product.isAvailable;
    }

    renderProductGallery(product);
    renderProductDescription(product);
    renderProductReviews(product);
    renderRelatedProducts(product.relatedProducts);

    return true;
  } catch (error) {
    renderProductError(error.message);
    return false;
  }
}

function clampNumber(value, min, max) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return min;
  }

  return Math.min(Math.max(numericValue, min), max);
}

function getStepPrecision(step) {
  const stepString = String(step);
  const dotIndex = stepString.indexOf('.');

  return dotIndex === -1 ? 0 : stepString.length - dotIndex - 1;
}

function initProductGallery() {
  const gallery = document.querySelector('[data-product-gallery]');

  if (!gallery) {
    return;
  }

  const stage = gallery.querySelector('.product-gallery__stage');
  const mainImage = gallery.querySelector('[data-gallery-main]');
  const thumbnails = Array.from(gallery.querySelectorAll('[data-gallery-thumb]'));
  const prevButton = gallery.querySelector('[data-gallery-prev]');
  const nextButton = gallery.querySelector('[data-gallery-next]');
  const currentOutput = gallery.querySelector('[data-gallery-current]');
  const totalOutput = gallery.querySelector('[data-gallery-total]');

  if (!stage || !mainImage || !thumbnails.length) {
    return;
  }

  let activeIndex = Math.max(
    0,
    thumbnails.findIndex((item) =>
      item.classList.contains('product-gallery__thumb--active'),
    ),
  );
  let pointerStart = null;

  mainImage.draggable = false;

  if (totalOutput) {
    totalOutput.textContent = String(thumbnails.length);
  }

  const normalizeIndex = (index) =>
    (index + thumbnails.length) % thumbnails.length;

  const updateUi = (index) => {
    thumbnails.forEach((thumbnail, thumbnailIndex) => {
      const isActive = thumbnailIndex === index;

      thumbnail.classList.toggle('product-gallery__thumb--active', isActive);
      thumbnail.setAttribute('aria-pressed', String(isActive));
    });

    if (currentOutput) {
      currentOutput.textContent = String(index + 1);
    }
  };

  const preloadAdjacent = (index) => {
    [normalizeIndex(index - 1), normalizeIndex(index + 1)].forEach((nextIndex) => {
      const source = thumbnails[nextIndex]?.dataset.gallerySrc;

      if (source) {
        const image = new Image();
        image.src = source;
      }
    });
  };

  const showImage = (requestedIndex) => {
    const index = normalizeIndex(requestedIndex);
    const thumbnail = thumbnails[index];
    const source = thumbnail?.dataset.gallerySrc;
    const alt = thumbnail?.dataset.galleryAlt || '';

    if (!thumbnail || !source) {
      return;
    }

    activeIndex = index;
    updateUi(index);

    if (source === mainImage.getAttribute('src')) {
      preloadAdjacent(index);
      return;
    }

    mainImage.classList.add('is-changing');

    const preloadImage = new Image();
    preloadImage.src = source;

    const applyImage = () => {
      mainImage.src = source;
      mainImage.alt = alt;
      mainImage.classList.remove('is-changing');
      preloadAdjacent(index);
    };

    if (preloadImage.complete) {
      applyImage();
      return;
    }

    preloadImage.addEventListener('load', applyImage, { once: true });
    preloadImage.addEventListener(
      'error',
      () => mainImage.classList.remove('is-changing'),
      { once: true },
    );
  };

  thumbnails.forEach((thumbnail, index) => {
    thumbnail.addEventListener('click', () => showImage(index));
  });

  prevButton?.addEventListener('click', () => showImage(activeIndex - 1));
  nextButton?.addEventListener('click', () => showImage(activeIndex + 1));

  stage.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      showImage(activeIndex - 1);
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      showImage(activeIndex + 1);
    }
  });

  stage.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || event.target.closest('button')) {
      return;
    }

    pointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  });

  stage.addEventListener('pointerup', (event) => {
    if (!pointerStart || pointerStart.id !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - pointerStart.x;
    const deltaY = event.clientY - pointerStart.y;
    pointerStart = null;

    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) {
      return;
    }

    showImage(activeIndex + (deltaX < 0 ? 1 : -1));
  });

  stage.addEventListener('pointercancel', () => {
    pointerStart = null;
  });

  showImage(activeIndex);
}

function initProductLightbox() {
  const trigger = document.querySelector('[data-gallery-zoom]');
  const mainImage = document.querySelector('[data-gallery-main]');
  const lightbox = document.querySelector('[data-product-lightbox]');

  if (!trigger || !mainImage || !lightbox) {
    return;
  }

  const lightboxImage = lightbox.querySelector('[data-lightbox-image]');
  const closeButtons = lightbox.querySelectorAll('[data-lightbox-close]');
  let previouslyFocusedElement = null;

  const closeLightbox = () => {
    lightbox.hidden = true;
    document.body.classList.remove('is-lock');

    if (previouslyFocusedElement instanceof HTMLElement) {
      previouslyFocusedElement.focus();
    }
  };

  const openLightbox = () => {
    if (lightboxImage) {
      lightboxImage.src = mainImage.currentSrc || mainImage.src;
      lightboxImage.alt = mainImage.alt;
    }

    previouslyFocusedElement = document.activeElement;
    lightbox.hidden = false;
    document.body.classList.add('is-lock');

    const closeButton = lightbox.querySelector('.product-lightbox__close');
    closeButton?.focus();
  };

  trigger.addEventListener('click', openLightbox);

  closeButtons.forEach((button) => {
    button.addEventListener('click', closeLightbox);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !lightbox.hidden) {
      closeLightbox();
    }
  });
}

function parseProductMoney(value) {
  return (
    Number(
      String(value || '')
        .replace(/\s/g, '')
        .replace(',', '.')
        .replace(/[^0-9.]/g, ''),
    ) || 0
  );
}

function getProductCommerceItem(quantity = 1) {
  const page = document.querySelector('[data-product-page]');
  const quantityControl = document.querySelector('[data-quantity-control]');
  const image = document.querySelector('[data-product-primary-image]');
  const name = document.querySelector('[data-product-name]');
  const measure = document.querySelector('[data-product-unit-label]');
  const price = document.querySelector('[data-product-price]');
  const oldPrice = document.querySelector('[data-product-old-price]');
  const badge = document.querySelector('[data-product-badge]');
  const rating = document.querySelector('[data-product-rating]');
  const reviewCount = document.querySelector('[data-product-review-count-short]');

  if (!page) {
    return null;
  }

  return {
    productId: page.dataset.productId || page.dataset.productSlug || null,
    slug: page.dataset.productSlug || '',
    title: name?.textContent?.trim() || 'Товар',
    image: image?.getAttribute('src') || '',
    measure: measure?.textContent?.trim() || '',
    badge: badge?.textContent?.trim() || '',
    rating: rating?.textContent?.trim() || '',
    reviewCount: reviewCount?.textContent?.trim() || '',
    unitPrice: parseProductMoney(price?.textContent),
    oldUnitPrice: parseProductMoney(oldPrice?.textContent),
    quantity,
    min: Number(quantityControl?.dataset.min) || 1,
    max: Number(quantityControl?.dataset.max) || 99,
    step: Number(quantityControl?.dataset.step) || 1,
    available:
      document.querySelector('[data-stock-status]')?.dataset.stockStatus !==
      'unavailable',
  };
}

function initProductFavorites() {
  const buttons = document.querySelectorAll('[data-product-favorite]');
  const item = getProductCommerceItem();

  if (!buttons.length || !item) {
    return;
  }

  const updateState = (isActive) => {
    buttons.forEach((button) => {
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));

      const label = button.querySelector('[data-favorite-label]');

      if (label) {
        label.textContent = isActive
          ? 'В избранном'
          : 'Добавить в избранное';
      }

      button.setAttribute(
        'aria-label',
        isActive ? 'Убрать товар из избранного' : 'Добавить товар в избранное',
      );
    });
  };

  const syncState = () => {
    const commerce = window.SibDelCommerce;
    const key = item.slug || item.productId;

    if (commerce && key) {
      updateState(commerce.isFavorite(key));
    }
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const isActive = button.getAttribute('aria-pressed') !== 'true';
      updateState(isActive);

      document.dispatchEvent(
        new CustomEvent('sibdel:favorite-toggle-request', {
          detail: {
            ...getProductCommerceItem(),
            isFavorite: isActive,
          },
        }),
      );
    });
  });

  document.addEventListener('sibdel:commerce-ui-updated', syncState);
  syncState();
}

function initProductQuantity() {
  const control = document.querySelector('[data-quantity-control]');

  if (!control) {
    return;
  }

  const input = control.querySelector('[data-quantity-input]');
  const minusButton = control.querySelector('[data-quantity-minus]');
  const plusButton = control.querySelector('[data-quantity-plus]');

  if (!input || !minusButton || !plusButton) {
    return;
  }

  const min = Number(control.dataset.min ?? input.min) || 1;
  const max = Number(control.dataset.max ?? input.max) || Number.MAX_SAFE_INTEGER;
  const step = Number(control.dataset.step ?? input.step) || 1;
  const precision = getStepPrecision(step);

  const normalizeValue = (value) => {
    const clampedValue = clampNumber(value, min, max);
    const stepsFromMin = Math.round((clampedValue - min) / step);
    const normalizedValue = min + stepsFromMin * step;

    return Number(clampNumber(normalizedValue, min, max).toFixed(precision));
  };

  const updateButtons = () => {
    const currentValue = normalizeValue(input.value);

    input.value = String(currentValue);
    minusButton.disabled = currentValue <= min;
    plusButton.disabled = currentValue >= max;
  };

  minusButton.addEventListener('click', () => {
    input.value = String(normalizeValue(Number(input.value) - step));
    updateButtons();
  });

  plusButton.addEventListener('click', () => {
    input.value = String(normalizeValue(Number(input.value) + step));
    updateButtons();
  });

  input.addEventListener('change', updateButtons);
  input.addEventListener('blur', updateButtons);

  updateButtons();
}

function initProductTabs() {
  const buttons = document.querySelectorAll('[data-product-tab]');
  const panels = document.querySelectorAll('[data-product-panel]');

  if (!buttons.length || !panels.length) {
    return;
  }

  const activateTab = (tabName, shouldFocus = false) => {
    const targetButton = Array.from(buttons).find(
      (button) => button.dataset.productTab === tabName,
    );
    const targetPanel = Array.from(panels).find(
      (panel) => panel.dataset.productPanel === tabName,
    );

    if (!targetButton || !targetPanel) {
      return;
    }

    buttons.forEach((button) => {
      const isActive = button === targetButton;

      button.classList.toggle('product-tabs__button--active', isActive);
      button.setAttribute('aria-selected', String(isActive));
      button.tabIndex = isActive ? 0 : -1;
    });

    panels.forEach((panel) => {
      const isActive = panel === targetPanel;

      panel.classList.toggle('product-details__panel--active', isActive);
      panel.hidden = !isActive;
    });

    if (shouldFocus) {
      targetButton.focus();
    }
  };

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      activateTab(button.dataset.productTab);
    });

    button.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        return;
      }

      event.preventDefault();

      let targetIndex = index;

      if (event.key === 'ArrowLeft') {
        targetIndex = index === 0 ? buttons.length - 1 : index - 1;
      }

      if (event.key === 'ArrowRight') {
        targetIndex = index === buttons.length - 1 ? 0 : index + 1;
      }

      if (event.key === 'Home') {
        targetIndex = 0;
      }

      if (event.key === 'End') {
        targetIndex = buttons.length - 1;
      }

      activateTab(buttons[targetIndex].dataset.productTab, true);
    });
  });

  document.querySelectorAll('a[href="#reviews"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      activateTab('reviews');

      document
        .querySelector('.product-details')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function initProductCartPreview() {
  const button = document.querySelector('[data-product-add-to-cart]');
  const input = document.querySelector('[data-quantity-input]');

  if (!button || !input) {
    return;
  }

  const label = button.querySelector('[data-cart-button-label]');
  let resetTimer = null;

  button.addEventListener('click', () => {
    const quantity = Number(input.value);
    const item = getProductCommerceItem(quantity);

    if (!item || !item.available) {
      return;
    }

    document.dispatchEvent(
      new CustomEvent('sibdel:add-to-cart-request', {
        detail: item,
      }),
    );

    button.classList.add('is-added');

    if (label) {
      label.textContent = 'Добавлено';
    }

    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      button.classList.remove('is-added');

      if (label) {
        label.textContent = 'В корзину';
      }
    }, 1400);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const ready = await hydrateProductPage();

  if (!ready) {
    return;
  }

  initProductGallery();
  initProductLightbox();
  initProductFavorites();
  initProductQuantity();
  initProductTabs();
  initProductCartPreview();
});
