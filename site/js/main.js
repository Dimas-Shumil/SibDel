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

document.addEventListener('DOMContentLoaded', async () => {
  await loadLayoutComponents();

  initPromotionsSlider();
  initPopularProductsSlider();
  initReviewsSlider();
});
