function escapeReviewsHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatReviewsDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function reviewsPageNumber() {
  const page = Number(new URLSearchParams(window.location.search).get('page'));
  return Number.isInteger(page) && page > 0 ? page : 1;
}

function reviewCard(review) {
  const author = String(review.authorName || 'Покупатель');
  const initial = author.trim().charAt(0).toUpperCase() || 'П';
  const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
  const product = review.product?.slug
    ? `<a class="reviews-page__product" href="/product.html?slug=${encodeURIComponent(review.product.slug)}">${escapeReviewsHtml(review.product.name)}</a>`
    : '';
  return `
    <article class="reviews__card reviews-page__card">
      <div class="reviews__card-header">
        <div class="reviews__person">
          <div class="reviews__avatar" aria-hidden="true">${escapeReviewsHtml(initial)}</div>
          <div class="reviews__meta">
            <h2 class="reviews__name">${escapeReviewsHtml(author)}</h2>
            <time class="reviews__date" datetime="${escapeReviewsHtml(String(review.createdAt || ''))}">${escapeReviewsHtml(formatReviewsDate(review.createdAt))}</time>
          </div>
        </div>
        <div class="reviews__rating" aria-label="Оценка ${rating} из 5">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div>
      </div>
      <p class="reviews__text">${escapeReviewsHtml(review.text)}</p>
      ${product}
    </article>`;
}

function renderReviewsPagination(pagination) {
  const container = document.querySelector('[data-public-reviews-pagination]');
  if (!container) return;
  if (!pagination || pagination.pages <= 1) {
    container.innerHTML = '';
    return;
  }
  const links = [];
  if (pagination.page > 1) links.push(`<a href="/reviews.html?page=${pagination.page - 1}">Назад</a>`);
  links.push(`<span>${pagination.page} / ${pagination.pages}</span>`);
  if (pagination.page < pagination.pages) links.push(`<a href="/reviews.html?page=${pagination.page + 1}">Далее</a>`);
  container.innerHTML = links.join('');
}

async function loadPublicReviews() {
  const container = document.querySelector('[data-public-reviews]');
  if (!container) return;
  const page = reviewsPageNumber();
  try {
    const response = await fetch(`/api/reviews?page=${page}&limit=24`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw new Error(payload?.error?.message || 'Не удалось загрузить отзывы.');
    const items = payload.reviews?.items || [];
    container.innerHTML = items.length
      ? items.map(reviewCard).join('')
      : '<p class="reviews-page__empty">Опубликованных отзывов пока нет.</p>';
    renderReviewsPagination(payload.reviews?.pagination);
  } catch (error) {
    container.innerHTML = `<p class="reviews-page__empty">${escapeReviewsHtml(error.message)}</p>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void loadPublicReviews();
});
