function initCatalogFilterDrawer() {
  const filter = document.querySelector('[data-filter]');
  const overlay = document.querySelector('.catalog-filter-overlay');
  const openButton = document.querySelector('[data-filter-open]');
  const closeButtons = document.querySelectorAll('[data-filter-close]');

  if (!filter || !overlay || !openButton) {
    return;
  }

  const setFilterState = (isOpen) => {
    filter.classList.toggle('is-open', isOpen);
    overlay.classList.toggle('is-active', isOpen);
    openButton.setAttribute('aria-expanded', String(isOpen));
    document.body.classList.toggle('is-lock', isOpen);
  };

  openButton.addEventListener('click', () => {
    setFilterState(true);
  });

  closeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      setFilterState(false);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && filter.classList.contains('is-open')) {
      setFilterState(false);
      openButton.focus();
    }
  });

  const desktopMedia = window.matchMedia('(min-width: 1024px)');

  const handleDesktopChange = (event) => {
    if (event.matches) {
      setFilterState(false);
    }
  };

  desktopMedia.addEventListener('change', handleDesktopChange);
}

function initCatalogCategoryState() {
  const categories = document.querySelectorAll(
    '.catalog-filter__category-input',
  );

  if (!categories.length) {
    return;
  }

  const setActiveCategory = (input) => {
    categories.forEach((categoryInput) => {
      const category = categoryInput.closest('.catalog-filter__category');

      if (!category) {
        return;
      }

      category.classList.toggle(
        'catalog-filter__category--active',
        categoryInput === input,
      );
    });
  };

  const categoryFromUrl = new URLSearchParams(window.location.search).get(
    'category',
  );

  if (categoryFromUrl) {
    const matchingCategory = Array.from(categories).find(
      (input) => input.value === categoryFromUrl,
    );

    if (matchingCategory) {
      matchingCategory.checked = true;
      setActiveCategory(matchingCategory);
    }
  }

  categories.forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        setActiveCategory(input);
      }
    });
  });

  const filterForm = document.querySelector('.catalog-filter__form');

  if (filterForm) {
    filterForm.addEventListener('reset', () => {
      window.requestAnimationFrame(() => {
        const checkedCategory = Array.from(categories).find(
          (input) => input.checked,
        );

        if (checkedCategory) {
          setActiveCategory(checkedCategory);
        }
      });
    });
  }
}

function initCatalogPriceRange() {
  const range = document.querySelector('[data-price-range]');
  const output = document.querySelector('[data-price-output]');

  if (!range || !output) {
    return;
  }

  const clampValue = (value) => {
    const min = Number(range.min) || 0;
    const max = Number(range.max) || 5000;
    const parsedValue = Number(value);

    if (!Number.isFinite(parsedValue)) {
      return max;
    }

    return Math.min(Math.max(parsedValue, min), max);
  };

  range.addEventListener('input', () => {
    output.value = range.value;
  });

  output.addEventListener('input', () => {
    range.value = String(clampValue(output.value));
  });

  const filterForm = document.querySelector('.catalog-filter__form');

  if (filterForm) {
    filterForm.addEventListener('reset', () => {
      window.requestAnimationFrame(() => {
        range.value = range.max;
        output.value = range.max;
      });
    });
  }
}

function initCatalogViewSwitcher() {
  const grid = document.querySelector('[data-product-grid]');
  const buttons = document.querySelectorAll('[data-view]');

  if (!grid || !buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      const isList = view === 'list';

      grid.classList.toggle('catalog-products__grid--list', isList);

      buttons.forEach((viewButton) => {
        const isActive = viewButton === button;

        viewButton.classList.toggle(
          'catalog-products__view-button--active',
          isActive,
        );
        viewButton.setAttribute('aria-pressed', String(isActive));
      });
    });
  });
}

function parseCatalogMoney(value) {
  return (
    Number(
      String(value || '')
        .replace(/\s/g, '')
        .replace(',', '.')
        .replace(/[^0-9.]/g, ''),
    ) || 0
  );
}

function getCatalogCardCommerceItem(card) {
  const link = card?.querySelector('.catalog-product-card__title');
  const image = card?.querySelector('.catalog-product-card__image');
  const measure = card?.querySelector('.catalog-product-card__measure');
  const price = card?.querySelector('.catalog-product-card__price');
  const oldPrice = card?.querySelector('.catalog-product-card__old-price');
  const rating = card?.querySelector('.catalog-product-card__rating');
  const reviews = card?.querySelector('.catalog-product-card__reviews');
  const badge = card?.querySelector('.catalog-product-card__badge');

  if (!link) {
    return null;
  }

  const url = new URL(link.href, window.location.origin);
  const slug =
    url.searchParams.get('slug') ||
    url.pathname.split('/').filter(Boolean).pop() ||
    link.textContent.trim().toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-');

  return {
    productId: slug,
    slug,
    title: link.textContent.trim(),
    image: image?.getAttribute('src') || '',
    measure: measure?.textContent?.trim() || '',
    badge: badge?.textContent?.trim() || '',
    rating: rating?.getAttribute('aria-label') || '',
    reviewCount: reviews?.textContent?.trim() || '',
    unitPrice: parseCatalogMoney(price?.textContent),
    oldUnitPrice: parseCatalogMoney(oldPrice?.textContent),
    quantity: 1,
    min: 1,
    max: 99,
    step: 1,
    available: true,
  };
}

function initCatalogProductActions() {
  const grid = document.querySelector('[data-product-grid]');

  if (!grid) {
    return;
  }

  const syncButtons = () => {
    const commerce = window.SibDelCommerce;

    grid.querySelectorAll('.catalog-product-card').forEach((card) => {
      const item = getCatalogCardCommerceItem(card);

      if (!item || !commerce) {
        return;
      }

      const key = item.slug || item.productId;
      const favoriteButton = card.querySelector('[data-favorite]');
      const cartButton = card.querySelector('[data-cart-toggle]');
      const isFavorite = commerce.isFavorite(key);
      const isInCart = commerce.isInCart(key);

      favoriteButton?.classList.toggle('is-active', isFavorite);
      favoriteButton?.setAttribute('aria-pressed', String(isFavorite));
      cartButton?.classList.toggle('is-added', isInCart);
      cartButton?.setAttribute('aria-pressed', String(isInCart));
    });
  };

  grid.addEventListener('click', (event) => {
    const card = event.target.closest('.catalog-product-card');

    if (!card) {
      return;
    }

    const item = getCatalogCardCommerceItem(card);

    if (!item) {
      return;
    }

    const favoriteButton = event.target.closest('[data-favorite]');

    if (favoriteButton) {
      const shouldFavorite = !favoriteButton.classList.contains('is-active');

      favoriteButton.classList.toggle('is-active', shouldFavorite);
      favoriteButton.setAttribute('aria-pressed', String(shouldFavorite));

      document.dispatchEvent(
        new CustomEvent('sibdel:favorite-toggle-request', {
          detail: {
            ...item,
            isFavorite: shouldFavorite,
          },
        }),
      );
      return;
    }

    const cartButton = event.target.closest('[data-cart-toggle]');

    if (cartButton) {
      document.dispatchEvent(
        new CustomEvent('sibdel:add-to-cart-request', {
          detail: item,
        }),
      );

      cartButton.classList.add('is-added');
      cartButton.setAttribute('aria-pressed', 'true');
    }
  });

  document.addEventListener('sibdel:commerce-ui-updated', syncButtons);
  syncButtons();
}

function initCatalogShowMore() {
  const button = document.querySelector('[data-show-more]');
  const extraCards = document.querySelectorAll('.catalog-product-card--extra');

  if (!button || !extraCards.length) {
    return;
  }

  button.addEventListener('click', () => {
    extraCards.forEach((card) => {
      card.hidden = false;
    });

    button.classList.add('is-hidden');
    button.setAttribute('aria-hidden', 'true');
    button.tabIndex = -1;
  });
}

function initCatalogSearchState() {
  const query = new URLSearchParams(window.location.search).get('q');

  if (!query) {
    return;
  }

  const searchInputs = document.querySelectorAll(
    '#catalog-search, #header-search',
  );

  searchInputs.forEach((input) => {
    input.value = query;
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initCatalogFilterDrawer();
  initCatalogCategoryState();
  initCatalogPriceRange();
  initCatalogViewSwitcher();
  initCatalogProductActions();
  initCatalogShowMore();
  initCatalogSearchState();
});
