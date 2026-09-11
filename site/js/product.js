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

  const mainImage = gallery.querySelector('[data-gallery-main]');
  const thumbnails = gallery.querySelectorAll('[data-gallery-thumb]');

  if (!mainImage || !thumbnails.length) {
    return;
  }

  const setActiveImage = (thumbnail) => {
    const source = thumbnail.dataset.gallerySrc;
    const alt = thumbnail.dataset.galleryAlt || '';

    if (!source || source === mainImage.getAttribute('src')) {
      return;
    }

    thumbnails.forEach((item) => {
      const isActive = item === thumbnail;

      item.classList.toggle('product-gallery__thumb--active', isActive);
      item.setAttribute('aria-pressed', String(isActive));
    });

    mainImage.classList.add('is-changing');

    const preloadImage = new Image();
    preloadImage.src = source;

    const applyImage = () => {
      mainImage.src = source;
      mainImage.alt = alt;
      mainImage.classList.remove('is-changing');
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

  thumbnails.forEach((thumbnail) => {
    thumbnail.addEventListener('click', () => setActiveImage(thumbnail));
  });
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

function initProductFavorites() {
  const buttons = document.querySelectorAll('[data-product-favorite]');

  if (!buttons.length) {
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
    });
  };

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const isActive = button.getAttribute('aria-pressed') !== 'true';
      updateState(isActive);

      document.dispatchEvent(
        new CustomEvent('sibdel:favorite-toggle-request', {
          detail: {
            productId:
              document.querySelector('[data-product-page]')?.dataset.productId ||
              null,
            isFavorite: isActive,
          },
        }),
      );
    });
  });
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
  const page = document.querySelector('[data-product-page]');

  if (!button || !input || !page) {
    return;
  }

  const label = button.querySelector('[data-cart-button-label]');
  let resetTimer = null;

  button.addEventListener('click', () => {
    const quantity = Number(input.value);

    document.dispatchEvent(
      new CustomEvent('sibdel:add-to-cart-request', {
        detail: {
          productId: page.dataset.productId || null,
          slug: page.dataset.productSlug || null,
          quantity,
        },
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

function initRelatedProductsSlider() {
  const slider = document.querySelector('[data-related-products]');

  if (!slider || typeof Swiper === 'undefined') {
    return;
  }

  const section = slider.closest('.related-products');
  const prevButton = section?.querySelector('.related-products__button--prev');
  const nextButton = section?.querySelector('.related-products__button--next');

  const swiper = new Swiper(slider, {
    speed: 600,
    slidesPerView: 1,
    spaceBetween: 10,
    centeredSlides: false,
    grabCursor: true,
    watchOverflow: true,
    roundLengths: true,
    resizeObserver: true,
    updateOnWindowResize: true,
    observer: true,
    observeParents: true,
    observeSlideChildren: true,
    navigation:
      prevButton && nextButton
        ? {
            prevEl: prevButton,
            nextEl: nextButton,
          }
        : undefined,
    breakpoints: {
      360: {
        slidesPerView: 2,
        spaceBetween: 8,
      },
      768: {
        slidesPerView: 3,
        spaceBetween: 12,
      },
      1024: {
        slidesPerView: 4,
        spaceBetween: 12,
      },
      1366: {
        slidesPerView: 5,
        spaceBetween: 14,
      },
      1920: {
        slidesPerView: 6,
        spaceBetween: 16,
      },
      2560: {
        slidesPerView: 7,
        spaceBetween: 18,
      },
      3000: {
        slidesPerView: 8,
        spaceBetween: 18,
      },
    },
  });

  // При будущей отрисовке похожих товаров из API/админки Swiper
  // автоматически следит за DOM, а это событие позволяет принудительно
  // пересчитать геометрию после пакетного рендера при необходимости.
  document.addEventListener('sibdel:related-products-updated', () => {
    swiper.update();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initProductGallery();
  initProductLightbox();
  initProductFavorites();
  initProductQuantity();
  initProductTabs();
  initProductCartPreview();
  initRelatedProductsSlider();
});
