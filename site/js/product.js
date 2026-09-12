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

    if (!item) {
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

document.addEventListener('DOMContentLoaded', () => {
  initProductGallery();
  initProductLightbox();
  initProductFavorites();
  initProductQuantity();
  initProductTabs();
  initProductCartPreview();
});
