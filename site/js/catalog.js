function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatMoney(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return "0 ₽";
  }

  return `${new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 2,
  }).format(amount)} ₽`;
}

function pluralizeProducts(count) {
  const value = Math.abs(Number(count)) % 100;
  const remainder = value % 10;

  if (value > 10 && value < 20) {
    return "товаров";
  }

  if (remainder === 1) {
    return "товар";
  }

  if (remainder >= 2 && remainder <= 4) {
    return "товара";
  }

  return "товаров";
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: "GET",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
    },
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    const error = new Error(
      payload?.error?.message || "Не удалось загрузить данные каталога.",
    );
    error.status = response.status;
    throw error;
  }

  return payload;
}

let catalogCategoriesCache = [];

const CATALOG_CATEGORY_ALIASES = Object.freeze({
  "molochnaya-produktsiya": "molochnye-produkty-i-yaytsa",
  "zamorozhennye-produkty": "zamorozka",
});

function normalizeCatalogCategorySlug(slug) {
  const normalized = String(slug || "").trim();
  return CATALOG_CATEGORY_ALIASES[normalized] || normalized;
}

function syncTopCategoryLinks(categories = catalogCategoriesCache) {
  const categorySlugs = new Set(categories.map((category) => category.slug));
  const selected = normalizeCatalogCategorySlug(
    new URLSearchParams(window.location.search).get("category") || "all",
  );

  document.querySelectorAll("a.catalog-category[href]").forEach((link) => {
    const url = new URL(link.href, window.location.origin);
    const rawSlug = url.searchParams.get("category") || "";
    const slug = normalizeCatalogCategorySlug(rawSlug);
    const supported = slug && categorySlugs.has(slug);

    link.hidden = !supported;
    link.classList.toggle("catalog-category--active", supported && slug === selected);

    if (supported) {
      url.searchParams.set("category", slug);
      link.href = `${url.pathname}?${url.searchParams.toString()}`;
      if (slug === selected) {
        link.setAttribute("aria-current", "true");
      } else {
        link.removeAttribute("aria-current");
      }
    } else {
      link.removeAttribute("aria-current");
    }
  });
}

function closeCatalogFilterDrawer() {
  const filter = document.querySelector("[data-filter]");
  const overlay = document.querySelector(".catalog-filter-overlay");
  const openButton = document.querySelector("[data-filter-open]");

  filter?.classList.remove("is-open");
  overlay?.classList.remove("is-active");
  openButton?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("is-lock");
}

function initCatalogFilterDrawer() {
  const filter = document.querySelector("[data-filter]");
  const overlay = document.querySelector(".catalog-filter-overlay");
  const openButton = document.querySelector("[data-filter-open]");
  const closeButtons = document.querySelectorAll("[data-filter-close]");

  if (!filter || !overlay || !openButton) {
    return;
  }

  const setFilterState = (isOpen) => {
    filter.classList.toggle("is-open", isOpen);
    overlay.classList.toggle("is-active", isOpen);
    openButton.setAttribute("aria-expanded", String(isOpen));
    document.body.classList.toggle("is-lock", isOpen);
  };

  openButton.addEventListener("click", () => setFilterState(true));
  closeButtons.forEach((button) => {
    button.addEventListener("click", () => setFilterState(false));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && filter.classList.contains("is-open")) {
      setFilterState(false);
      openButton.focus();
    }
  });

  const desktopMedia = window.matchMedia("(min-width: 1024px)");
  desktopMedia.addEventListener("change", (event) => {
    if (event.matches) {
      setFilterState(false);
    }
  });
}

function initCatalogPriceRange() {
  const range = document.querySelector("[data-price-range]");
  const output = document.querySelector("[data-price-output]");

  if (!range || !output) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const priceTo = Number(params.get("priceTo"));

  if (Number.isFinite(priceTo) && priceTo >= Number(range.min)) {
    range.value = String(Math.min(priceTo, Number(range.max)));
    output.value = String(priceTo);
  }

  range.addEventListener("input", () => {
    output.value = range.value;
  });

  output.addEventListener("input", () => {
    const value = Number(output.value);
    const min = Number(range.min) || 0;
    const max = Number(range.max) || 5000;
    range.value = String(
      Number.isFinite(value) ? Math.min(Math.max(value, min), max) : max,
    );
  });
}

function initCatalogViewSwitcher() {
  const grid = document.querySelector("[data-product-grid]");
  const buttons = document.querySelectorAll("[data-view]");

  if (!grid || !buttons.length) {
    return;
  }

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const isList = button.dataset.view === "list";
      grid.classList.toggle("catalog-products__grid--list", isList);

      buttons.forEach((viewButton) => {
        const isActive = viewButton === button;
        viewButton.classList.toggle(
          "catalog-products__view-button--active",
          isActive,
        );
        viewButton.setAttribute("aria-pressed", String(isActive));
      });
    });
  });
}

function parseCatalogMoney(value) {
  return (
    Number(
      String(value || "")
        .replace(/\s/g, "")
        .replace(",", ".")
        .replace(/[^0-9.]/g, ""),
    ) || 0
  );
}

function getCatalogCardCommerceItem(card) {
  const link = card?.querySelector(".catalog-product-card__title");
  const image = card?.querySelector(".catalog-product-card__image");
  const measure = card?.querySelector(".catalog-product-card__measure");
  const price = card?.querySelector(".catalog-product-card__price");
  const oldPrice = card?.querySelector(".catalog-product-card__old-price");
  const rating = card?.querySelector(".catalog-product-card__rating");
  const reviews = card?.querySelector(".catalog-product-card__reviews");
  const badge = card?.querySelector(".catalog-product-card__badge");

  if (!link) {
    return null;
  }

  const slug = card.dataset.productSlug || "";

  return {
    productId: card.dataset.productId || slug,
    slug,
    title: link.textContent.trim(),
    image: image?.getAttribute("src") || "",
    measure: measure?.textContent?.trim() || "",
    badge: badge?.textContent?.trim() || "",
    rating: rating?.getAttribute("aria-label") || "",
    reviewCount: reviews?.textContent?.trim() || "",
    unitPrice: parseCatalogMoney(price?.textContent),
    oldUnitPrice: parseCatalogMoney(oldPrice?.textContent),
    quantity: Number(card.dataset.minQuantity) || 1,
    min: Number(card.dataset.minQuantity) || 1,
    max: Number(card.dataset.maxQuantity) || 99,
    step: Number(card.dataset.step) || 1,
    available: card.dataset.available === "true",
  };
}

function initCatalogProductActions() {
  const grid = document.querySelector("[data-product-grid]");

  if (!grid) {
    return;
  }

  const syncButtons = () => {
    const commerce = window.SibDelCommerce;

    grid.querySelectorAll(".catalog-product-card").forEach((card) => {
      const item = getCatalogCardCommerceItem(card);

      if (!item || !commerce) {
        return;
      }

      const key = item.slug || item.productId;
      const favoriteButton = card.querySelector("[data-favorite]");
      const cartButton = card.querySelector("[data-cart-toggle]");
      const isFavorite = commerce.isFavorite(key);
      const isInCart = commerce.isInCart(key);

      favoriteButton?.classList.toggle("is-active", isFavorite);
      favoriteButton?.setAttribute("aria-pressed", String(isFavorite));
      cartButton?.classList.toggle("is-added", isInCart);
      cartButton?.setAttribute("aria-pressed", String(isInCart));
    });
  };

  grid.addEventListener("click", (event) => {
    const card = event.target.closest(".catalog-product-card");

    if (!card) {
      return;
    }

    const item = getCatalogCardCommerceItem(card);

    if (!item) {
      return;
    }

    const favoriteButton = event.target.closest("[data-favorite]");

    if (favoriteButton) {
      const shouldFavorite = !favoriteButton.classList.contains("is-active");
      favoriteButton.classList.toggle("is-active", shouldFavorite);
      favoriteButton.setAttribute("aria-pressed", String(shouldFavorite));

      document.dispatchEvent(
        new CustomEvent("sibdel:favorite-toggle-request", {
          detail: {
            ...item,
            isFavorite: shouldFavorite,
          },
        }),
      );
      return;
    }

    const cartButton = event.target.closest("[data-cart-toggle]");

    if (cartButton && item.available) {
      document.dispatchEvent(
        new CustomEvent("sibdel:add-to-cart-request", {
          detail: item,
        }),
      );

      cartButton.classList.add("is-added");
      cartButton.setAttribute("aria-pressed", "true");
    }
  });

  document.addEventListener("sibdel:commerce-ui-updated", syncButtons);
  document.addEventListener("sibdel:catalog-rendered", syncButtons);
  syncButtons();
}

function renderCategoryOptions(categories) {
  const container = document.querySelector(".catalog-filter__categories");

  if (!container) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const selected = normalizeCatalogCategorySlug(params.get("category") || "all");
  const total = categories.reduce(
    (sum, category) => sum + Number(category.productCount || 0),
    0,
  );

  const options = [
    {
      slug: "all",
      name: "Все товары",
      productCount: total,
    },
    ...categories,
  ];

  container.innerHTML = options
    .map((category) => {
      const active = category.slug === selected;

      return `
        <label class="catalog-filter__category${active ? " catalog-filter__category--active" : ""}">
          <input
            class="catalog-filter__category-input"
            type="radio"
            name="category"
            value="${escapeHtml(category.slug)}"
            ${active ? "checked" : ""}
          />
          <span class="catalog-filter__category-label">${escapeHtml(category.name)}</span>
          <span class="catalog-filter__category-count">${Number(category.productCount || 0)}</span>
        </label>
      `;
    })
    .join("");

  container.onchange = (event) => {
    const input = event.target.closest(".catalog-filter__category-input");

    if (!input) {
      return;
    }

    container.querySelectorAll(".catalog-filter__category").forEach((label) => {
      label.classList.toggle(
        "catalog-filter__category--active",
        label.contains(input),
      );
    });
  };
}

function renderCatalogCard(product) {
  const image = product.primaryImage?.url || "/site/images/placeholder.webp";
  const imageAlt = product.primaryImage?.alt || product.name;
  const badge = product.badge
    ? `<span class="catalog-product-card__badge catalog-product-card__badge--${escapeHtml(product.badge.type)}">${escapeHtml(product.badge.label)}</span>`
    : "";
  const oldPrice = product.oldPrice
    ? `<del class="catalog-product-card__old-price">${formatMoney(product.oldPrice)}</del>`
    : "";
  const ratingLabel = product.rating?.count
    ? `Рейтинг ${product.rating.average} из 5, ${product.rating.count} отзывов`
    : "Отзывов пока нет";
  const ratingValue = product.rating?.count
    ? `${escapeHtml(product.rating.average)} · `
    : "";
  const stock = Number(product.stockQuantity);
  const maxQuantity =
    Number.isFinite(stock) && stock > 0
      ? Math.max(Number(product.minQuantity) || 1, Math.floor(stock))
      : 99;

  return `
    <article
      class="catalog-product-card"
      data-product-id="${Number(product.id)}"
      data-product-slug="${escapeHtml(product.slug)}"
      data-min-quantity="${escapeHtml(product.minQuantity || 1)}"
      data-step="${escapeHtml(product.step || 1)}"
      data-max-quantity="${maxQuantity}"
      data-available="${String(Boolean(product.isAvailable))}"
    >
      <div class="catalog-product-card__media">
        <a
          class="catalog-product-card__image-link"
          href="/product.html?slug=${encodeURIComponent(product.slug)}"
          aria-label="${escapeHtml(product.name)}"
        >
          <img
            class="catalog-product-card__image"
            src="${escapeHtml(image)}"
            alt="${escapeHtml(imageAlt)}"
            width="1448"
            height="1086"
            loading="lazy"
            decoding="async"
          />
        </a>
        ${badge}
        <button
          class="catalog-product-card__favorite"
          type="button"
          aria-label="Добавить ${escapeHtml(product.name)} в избранное"
          aria-pressed="false"
          data-favorite
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 20.5 4.7 13.4C1.8 10.5 2 6 5.5 4.6 8 3.6 10.1 5 12 7.1 13.9 5 16 3.6 18.5 4.6 22 6 22.2 10.5 19.3 13.4L12 20.5Z" />
          </svg>
        </button>
      </div>
      <div class="catalog-product-card__body">
        <a class="catalog-product-card__title" href="/product.html?slug=${encodeURIComponent(product.slug)}">
          ${escapeHtml(product.name)}
        </a>
        <span class="catalog-product-card__measure">${escapeHtml(product.unitLabel || product.unit || "")}</span>
        <div class="catalog-product-card__rating" aria-label="${escapeHtml(ratingLabel)}">
          <span class="catalog-product-card__stars" aria-hidden="true">★★★★★</span>
          <span class="catalog-product-card__reviews">${ratingValue}${Number(product.rating?.count || 0)}</span>
        </div>
        <div class="catalog-product-card__bottom">
          <div class="catalog-product-card__prices">
            <strong class="catalog-product-card__price">${formatMoney(product.price)}</strong>
            ${oldPrice}
          </div>
          <button
            class="catalog-product-card__cart"
            type="button"
            aria-label="${product.isAvailable ? "Добавить" : "Товар недоступен:"} ${escapeHtml(product.name)}${product.isAvailable ? " в корзину" : ""}"
            aria-pressed="false"
            data-cart-toggle
            ${product.isAvailable ? "" : "disabled"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 5h2l2 9h9.7l2.1-6H7" />
              <circle cx="10" cy="18" r="1.3" />
              <circle cx="17" cy="18" r="1.3" />
            </svg>
          </button>
        </div>
      </div>
    </article>
  `;
}

function buildCatalogApiParams(page = 1) {
  const source = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const allowed = [
    "category",
    "q",
    "priceFrom",
    "priceTo",
    "available",
    "lowStock",
    "outOfStock",
    "discount",
    "new",
    "hit",
    "sort",
  ];

  allowed.forEach((key) => {
    if (!source.has(key)) {
      return;
    }

    const value = key === "category"
      ? normalizeCatalogCategorySlug(source.get(key))
      : source.get(key);

    if (key === "category" && (!value || value === "all")) {
      return;
    }

    params.set(key, value);
  });

  if (
    !source.has("available") &&
    !source.has("lowStock") &&
    !source.has("outOfStock")
  ) {
    params.set("available", "1");
  }

  params.set("page", String(page));
  params.set("limit", "12");

  return params;
}

function syncControlsFromUrl() {
  const params = new URLSearchParams(window.location.search);

  const priceFrom = document.querySelector('input[name="priceFrom"]');
  const priceTo = document.querySelector('input[name="priceTo"]');

  if (priceFrom && params.has("priceFrom")) {
    priceFrom.value = params.get("priceFrom");
  }

  if (priceTo && params.has("priceTo")) {
    priceTo.value = params.get("priceTo");
  }

  ["available", "lowStock", "outOfStock", "discount", "new", "hit"].forEach(
    (name) => {
      const input = document.querySelector(`input[name="${name}"]`);

      if (!input) {
        return;
      }

      if (params.has(name)) {
        input.checked = ["1", "true"].includes(params.get(name));
      } else if (name !== "available") {
        input.checked = false;
      }
    },
  );

  const searchInputs = document.querySelectorAll("#catalog-search, #header-search");
  const query = params.get("q") || "";
  searchInputs.forEach((input) => {
    input.value = query;
  });

  const sort = document.querySelector(".catalog-products__sort-select");
  if (sort) {
    sort.value = params.get("sort") || "popular";
  }

  document.querySelectorAll(".catalog-filter__check-count").forEach((count) => {
    count.textContent = "";
  });
}

function updateCatalogHeading(catalog, categories) {
  const title = document.querySelector(".catalog-products__title");
  const count = document.querySelector(".catalog-products__count");
  const params = new URLSearchParams(window.location.search);
  const categorySlug = normalizeCatalogCategorySlug(params.get("category"));
  const query = params.get("q")?.trim();
  const category = categories.find((item) => item.slug === categorySlug);

  if (title) {
    if (query) {
      title.textContent = `Поиск: «${query}»`;
    } else if (category) {
      title.textContent = category.name;
    } else {
      title.textContent = "Все товары";
    }
  }

  if (count) {
    count.textContent = `${catalog.pagination.total} ${pluralizeProducts(catalog.pagination.total)}`;
  }
}

function renderCatalogError(message) {
  const grid = document.querySelector("[data-product-grid]");
  const showMore = document.querySelector("[data-show-more]");

  if (grid) {
    grid.innerHTML = `<p class="catalog-products__message">${escapeHtml(message)}</p>`;
  }

  if (showMore) {
    showMore.hidden = true;
    showMore.classList.add("is-hidden");
  }
}

async function loadCatalogPage(page, { append = false } = {}) {
  const grid = document.querySelector("[data-product-grid]");
  const showMore = document.querySelector("[data-show-more]");

  if (!grid) {
    return null;
  }

  if (showMore) {
    showMore.disabled = true;
  }

  const payload = await fetchJson(`/api/catalog?${buildCatalogApiParams(page)}`);
  const markup = payload.products.map(renderCatalogCard).join("");

  if (append) {
    grid.insertAdjacentHTML("beforeend", markup);
  } else {
    grid.innerHTML = markup || '<p class="catalog-products__message">По выбранным условиям товары не найдены.</p>';
  }

  if (showMore) {
    showMore.hidden = !payload.pagination.hasMore;
    showMore.classList.toggle("is-hidden", !payload.pagination.hasMore);
    showMore.disabled = false;
    showMore.dataset.nextPage = String(payload.pagination.page + 1);
  }

  renderCatalogPagination(payload.pagination);
  document.dispatchEvent(new CustomEvent("sibdel:catalog-rendered"));

  return payload;
}

function getFilterUrl(form) {
  const currentUrl = new URL(window.location.href);
  const currentParams = currentUrl.searchParams;
  const formData = new FormData(form);
  const next = new URLSearchParams();

  const category = String(formData.get("category") || "").trim();
  if (category && category !== "all") {
    next.set("category", category);
  }

  const priceFrom = String(formData.get("priceFrom") || "").trim();
  const priceTo = String(formData.get("priceTo") || "").trim();

  if (priceFrom) {
    next.set("priceFrom", priceFrom);
  }

  if (priceTo) {
    next.set("priceTo", priceTo);
  }

  const availabilityNames = ["available", "lowStock", "outOfStock"];
  let hasAvailability = false;

  availabilityNames.forEach((name) => {
    if (formData.has(name)) {
      next.set(name, "1");
      hasAvailability = true;
    }
  });

  // Keep the catalog usable when a user unchecks every availability state.
  // The storefront default is products that can currently be purchased.
  if (!hasAvailability) {
    next.set("available", "1");
  }

  ["discount", "new", "hit"].forEach((name) => {
    if (formData.has(name)) {
      next.set(name, "1");
    }
  });

  const query = currentParams.get("q")?.trim();
  if (query) {
    next.set("q", query);
  }

  const sort = currentParams.get("sort");
  if (sort && sort !== "popular") {
    next.set("sort", sort);
  }

  currentUrl.search = next.toString();
  return currentUrl;
}

async function applyCatalogUrl(url, { replace = false } = {}) {
  const nextUrl = new URL(url, window.location.origin);
  const rawCategory = nextUrl.searchParams.get("category");
  const normalizedCategory = normalizeCatalogCategorySlug(rawCategory);

  if (rawCategory && normalizedCategory && normalizedCategory !== rawCategory) {
    nextUrl.searchParams.set("category", normalizedCategory);
  }

  if (replace) {
    window.history.replaceState({}, "", nextUrl);
  } else {
    window.history.pushState({}, "", nextUrl);
  }

  syncControlsFromUrl();
  renderCategoryOptions(catalogCategoriesCache);
  syncTopCategoryLinks(catalogCategoriesCache);

  const payload = await loadCatalogPage(1);
  updateCatalogHeading(payload, catalogCategoriesCache);
}

function initCatalogFilterForm() {
  const form = document.querySelector(".catalog-filter__form");

  if (!form) {
    return;
  }

  const available = form.querySelector('input[name="available"]');
  const lowStock = form.querySelector('input[name="lowStock"]');
  const outOfStock = form.querySelector('input[name="outOfStock"]');
  const priceRange = form.querySelector("[data-price-range]");
  const priceInputs = form.querySelectorAll(
    'input[name="priceFrom"], input[name="priceTo"]',
  );

  let priceApplyTimer = null;
  let applySequence = 0;

  const applyFilters = async ({ closeOnMobile = false, replace = false } = {}) => {
    const sequence = ++applySequence;
    const url = getFilterUrl(form);

    try {
      await applyCatalogUrl(url, { replace });

      if (sequence !== applySequence) {
        return;
      }

      if (closeOnMobile && window.matchMedia("(max-width: 1023px)").matches) {
        closeCatalogFilterDrawer();
      }
    } catch (error) {
      if (sequence === applySequence) {
        renderCatalogError(error.message);
      }
    }
  };

  const schedulePriceApply = () => {
    window.clearTimeout(priceApplyTimer);
    priceApplyTimer = window.setTimeout(() => {
      applyFilters({ replace: true });
    }, 350);
  };

  [lowStock, outOfStock].forEach((input) => {
    input?.addEventListener("change", () => {
      if (input.checked && available) {
        available.checked = false;
      }
    });
  });

  available?.addEventListener("change", () => {
    if (!available.checked) {
      return;
    }

    if (lowStock) {
      lowStock.checked = false;
    }

    if (outOfStock) {
      outOfStock.checked = false;
    }
  });

  form.addEventListener("change", (event) => {
    const target = event.target;

    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.matches('input[name="priceFrom"], input[name="priceTo"]')) {
      window.clearTimeout(priceApplyTimer);
      applyFilters({ replace: true });
      return;
    }

    const isCategory = target.matches('input[name="category"]');
    applyFilters({ closeOnMobile: isCategory });
  });

  priceInputs.forEach((input) => {
    input.addEventListener("input", schedulePriceApply);
  });

  priceRange?.addEventListener("input", schedulePriceApply);
  priceRange?.addEventListener("change", () => {
    window.clearTimeout(priceApplyTimer);
    applyFilters({ replace: true });
  });

  // Fallback for pressing Enter inside a price field.
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(priceApplyTimer);
    applyFilters({ replace: true });
  });
}

function initCatalogSearch() {
  const form = document.querySelector(".catalog-products__search");

  if (!form) {
    return;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const query = String(data.get("q") || "").trim();
    const url = new URL(window.location.href);

    if (query) {
      url.searchParams.set("q", query);
    } else {
      url.searchParams.delete("q");
    }

    url.searchParams.delete("page");

    try {
      await applyCatalogUrl(url);
    } catch (error) {
      renderCatalogError(error.message);
    }
  });
}

function buildPaginationItems(currentPage, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = new Set([1, totalPages, currentPage]);

  for (let offset = -1; offset <= 1; offset += 1) {
    const page = currentPage + offset;
    if (page > 1 && page < totalPages) {
      pages.add(page);
    }
  }

  return [...pages].sort((a, b) => a - b);
}

function renderCatalogPagination(pagination) {
  const nav = document.querySelector(".catalog-pagination");

  if (!nav) {
    return;
  }

  const currentPage = Number(pagination.page) || 1;
  const totalPages = Math.max(1, Number(pagination.totalPages) || 1);
  const pages = buildPaginationItems(currentPage, totalPages);
  const parts = [];

  let previousPage = null;
  pages.forEach((page) => {
    if (previousPage !== null && page - previousPage > 1) {
      parts.push('<span class="catalog-pagination__dots" aria-hidden="true">…</span>');
    }

    const url = new URL(window.location.href);
    url.searchParams.set("page", String(page));

    parts.push(`
      <a
        class="catalog-pagination__link${page === currentPage ? " catalog-pagination__link--active" : ""}"
        href="${escapeHtml(`${url.pathname}?${url.searchParams.toString()}`)}"
        data-catalog-page="${page}"
        ${page === currentPage ? 'aria-current="page"' : ""}
      >${page}</a>
    `);

    previousPage = page;
  });

  if (currentPage < totalPages) {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("page", String(currentPage + 1));
    parts.push(`
      <a
        class="catalog-pagination__link catalog-pagination__link--next"
        href="${escapeHtml(`${nextUrl.pathname}?${nextUrl.searchParams.toString()}`)}"
        data-catalog-page="${currentPage + 1}"
        aria-label="Следующая страница"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </a>
    `);
  }

  nav.innerHTML = parts.join("");
  nav.hidden = totalPages <= 1;
}

function initCatalogPagination() {
  const nav = document.querySelector(".catalog-pagination");

  if (!nav) {
    return;
  }

  nav.addEventListener("click", async (event) => {
    const link = event.target.closest("[data-catalog-page]");

    if (!link) {
      return;
    }

    event.preventDefault();

    const page = Number(link.dataset.catalogPage);
    if (!Number.isInteger(page) || page < 1) {
      return;
    }

    const url = new URL(window.location.href);
    url.searchParams.set("page", String(page));
    window.history.pushState({}, "", url);

    try {
      const payload = await loadCatalogPage(page);
      updateCatalogHeading(payload, catalogCategoriesCache);
      document.querySelector(".catalog-products")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (error) {
      renderCatalogError(error.message);
    }
  });
}

function initCatalogSort() {
  const select = document.querySelector(".catalog-products__sort-select");

  if (!select) {
    return;
  }

  select.addEventListener("change", async () => {
    const url = new URL(window.location.href);

    if (select.value && select.value !== "popular") {
      url.searchParams.set("sort", select.value);
    } else {
      url.searchParams.delete("sort");
    }

    url.searchParams.delete("page");

    try {
      await applyCatalogUrl(url);
    } catch (error) {
      renderCatalogError(error.message);
    }
  });
}

function initCatalogCategoryLinks() {
  document.addEventListener("click", async (event) => {
    const link = event.target.closest("a.catalog-category[href]");

    if (!link) {
      return;
    }

    const url = new URL(link.href, window.location.origin);

    if (url.origin !== window.location.origin || url.pathname !== "/catalog.html") {
      return;
    }

    const category = normalizeCatalogCategorySlug(url.searchParams.get("category"));
    if (!category || !catalogCategoriesCache.some((item) => item.slug === category)) {
      return;
    }

    event.preventDefault();
    url.searchParams.set("category", category);
    url.searchParams.delete("page");

    try {
      await applyCatalogUrl(url);
      document.querySelector(".catalog-products")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch (error) {
      renderCatalogError(error.message);
    }
  });
}

function initCatalogReset() {
  const form = document.querySelector(".catalog-filter__form");

  if (!form) {
    return;
  }

  form.addEventListener("reset", () => {
    window.setTimeout(async () => {
      const url = new URL("/catalog.html", window.location.origin);

      try {
        await applyCatalogUrl(url);
      } catch (error) {
        renderCatalogError(error.message);
      }
    }, 0);
  });
}

function initCatalogShowMore() {
  const button = document.querySelector("[data-show-more]");

  if (!button) {
    return;
  }

  button.addEventListener("click", async () => {
    const page = Number(button.dataset.nextPage) || 2;

    try {
      await loadCatalogPage(page, {
        append: true,
      });
    } catch (error) {
      button.disabled = false;
    }
  });
}

async function hydrateCatalog() {
  try {
    const categoriesPayload = await fetchJson("/api/categories");
    catalogCategoriesCache = categoriesPayload.categories;

    const url = new URL(window.location.href);
    const rawCategory = url.searchParams.get("category");
    const normalizedCategory = normalizeCatalogCategorySlug(rawCategory);

    if (rawCategory) {
      if (catalogCategoriesCache.some((item) => item.slug === normalizedCategory)) {
        if (normalizedCategory !== rawCategory) {
          url.searchParams.set("category", normalizedCategory);
          window.history.replaceState({}, "", url);
        }
      } else {
        url.searchParams.delete("category");
        window.history.replaceState({}, "", url);
      }
    }

    renderCategoryOptions(catalogCategoriesCache);
    syncTopCategoryLinks(catalogCategoriesCache);
    syncControlsFromUrl();

    const params = new URLSearchParams(window.location.search);
    const requestedPage = Number(params.get("page"));
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const catalogPayload = await loadCatalogPage(page);

    updateCatalogHeading(catalogPayload, catalogCategoriesCache);
  } catch (error) {
    renderCatalogError(error.message);
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initCatalogFilterDrawer();
  syncControlsFromUrl();
  initCatalogPriceRange();
  initCatalogViewSwitcher();
  initCatalogProductActions();
  initCatalogFilterForm();
  initCatalogSearch();
  initCatalogSort();
  initCatalogCategoryLinks();
  initCatalogReset();
  initCatalogPagination();
  initCatalogShowMore();
  await hydrateCatalog();

  window.addEventListener("popstate", async () => {
    syncControlsFromUrl();

    const params = new URLSearchParams(window.location.search);
    const requestedPage = Number(params.get("page"));
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

    try {
      const payload = await loadCatalogPage(page);
      renderCategoryOptions(catalogCategoriesCache);
      syncTopCategoryLinks(catalogCategoriesCache);
      updateCatalogHeading(payload, catalogCategoriesCache);
    } catch (error) {
      renderCatalogError(error.message);
    }
  });
});
