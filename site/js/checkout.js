function formatCheckoutMoney(value) {
  return `${new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 2,
  }).format(Number(value) || 0)} ₽`;
}

function formatCheckoutQuantity(value) {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: 3,
  }).format(Number(value) || 0);
}

function escapeCheckoutHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function sanitizeCheckoutImage(value) {
  const image = String(value || '').trim();

  if (/^\/site\/images\/[a-zA-Z0-9_./%()\-]+$/.test(image)) {
    return image;
  }

  return '/site/images/kol-taezh.webp';
}

function getCheckoutItemKey(item) {
  return String(item?.slug || item?.productId || item?.key || '').trim();
}

function getCheckoutTotals(items) {
  return items.reduce(
    (totals, item) => {
      const quantity = Math.max(0, Number(item.quantity) || 0);
      const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
      const oldUnitPrice = Math.max(unitPrice, Number(item.oldUnitPrice) || unitPrice);

      totals.lines += 1;
      totals.quantity += quantity;
      totals.total += unitPrice * quantity;
      totals.oldTotal += oldUnitPrice * quantity;

      return totals;
    },
    { lines: 0, quantity: 0, total: 0, oldTotal: 0 },
  );
}

function createCheckoutItemMarkup(item) {
  const key = getCheckoutItemKey(item);
  const slug = encodeURIComponent(String(item.slug || key));
  const title = escapeCheckoutHtml(item.title || 'Товар');
  const image = sanitizeCheckoutImage(item.image);
  const measure = escapeCheckoutHtml(item.measure || '');
  const quantity = Math.max(0, Number(item.quantity) || 0);
  const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
  const oldUnitPrice = Math.max(unitPrice, Number(item.oldUnitPrice) || unitPrice);
  const currentLinePrice = unitPrice * quantity;
  const oldLinePrice = oldUnitPrice * quantity;
  const availability = item.available === false ? 'Временно нет' : '';
  const meta = [
    measure,
    `Количество: ${formatCheckoutQuantity(quantity)}`,
    availability,
  ].filter(Boolean);

  return `
    <article class="checkout-summary-item" data-checkout-item data-product-key="${escapeCheckoutHtml(key)}">
      <a class="checkout-summary-item__media" href="/product.html?slug=${slug}" tabindex="-1" aria-hidden="true">
        <img class="checkout-summary-item__image" src="${image}" alt="" width="140" height="140" loading="lazy" decoding="async" />
      </a>
      <div class="checkout-summary-item__content">
        <a class="checkout-summary-item__title" href="/product.html?slug=${slug}">${title}</a>
        <div class="checkout-summary-item__meta">
          ${meta.map((entry) => `<span>${escapeCheckoutHtml(entry)}</span>`).join('')}
        </div>
      </div>
      <div class="checkout-summary-item__price">
        <strong>${formatCheckoutMoney(currentLinePrice)}</strong>
        ${oldLinePrice > currentLinePrice ? `<del>${formatCheckoutMoney(oldLinePrice)}</del>` : ''}
      </div>
    </article>
  `;
}

function getLocalDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function initCheckoutPage() {
  const page = document.querySelector('[data-checkout-page]');
  const commerce = window.SibDelCommerce;

  if (!page || !commerce) {
    return;
  }

  const form = page.querySelector('[data-checkout-form]');
  const summary = page.querySelector('[data-checkout-summary]');
  const itemsRoot = page.querySelector('[data-checkout-items]');
  const emptyState = page.querySelector('[data-checkout-empty]');
  const mobileBar = page.querySelector('[data-checkout-mobile-bar]');
  const mobileSubmit = page.querySelector('[data-checkout-mobile-submit]');
  const submitButton = page.querySelector('[data-checkout-submit]');
  const submitText = page.querySelector('[data-checkout-submit-text]');
  const loader = page.querySelector('[data-checkout-loader]');
  const summaryCount = page.querySelector('[data-checkout-summary-count]');
  const subtotalOutput = page.querySelector('[data-checkout-subtotal]');
  const discountOutput = page.querySelector('[data-checkout-discount]');
  const totalOutput = page.querySelector('[data-checkout-total]');
  const mobileTotalOutput = page.querySelector('[data-checkout-mobile-total]');
  const formStatus = page.querySelector('[data-checkout-form-status]');
  const deliveryPanel = page.querySelector('[data-checkout-delivery-panel]');
  const pickupPanel = page.querySelector('[data-checkout-pickup-panel]');
  const addressInput = page.querySelector('[data-checkout-field="address"]');
  const dateInput = page.querySelector('[data-checkout-field="receiveDate"]');
  const slotSelect = page.querySelector('[data-checkout-field="receiveSlot"]');
  const slotHint = page.querySelector('[data-checkout-slot-hint]');
  const commentInput = page.querySelector('[data-checkout-comment]');
  const commentCount = page.querySelector('[data-checkout-comment-count]');
  const modal = page.querySelector('[data-checkout-state-modal]');
  let lastFocusedElement = null;
  let submitTimer = null;

  if (!form || !itemsRoot) {
    return;
  }


  const setFormStatus = (message = '', type = 'error') => {
    if (!formStatus) {
      return;
    }

    formStatus.textContent = message;
    formStatus.hidden = !message;
    formStatus.classList.toggle('is-success', type === 'success');
  };

  const clearFieldError = (fieldName) => {
    const input = form.querySelector(`[data-checkout-field="${fieldName}"]`);
    const error = form.querySelector(`[data-checkout-error="${fieldName}"]`);

    input?.classList.remove('is-error');
    input?.removeAttribute('aria-invalid');

    if (error) {
      error.textContent = '';
    }
  };

  const setFieldError = (fieldName, message) => {
    const input = form.querySelector(`[data-checkout-field="${fieldName}"]`);
    const error = form.querySelector(`[data-checkout-error="${fieldName}"]`);

    input?.classList.add('is-error');
    input?.setAttribute('aria-invalid', 'true');

    if (error) {
      error.textContent = message;
    }
  };

  const clearAllErrors = () => {
    form.querySelectorAll('[data-checkout-field]').forEach((field) => {
      field.classList.remove('is-error');
      field.removeAttribute('aria-invalid');
    });

    form.querySelectorAll('[data-checkout-error]').forEach((error) => {
      error.textContent = '';
    });

    setFormStatus('');
  };

  const syncChoiceCards = () => {
    page.querySelectorAll('[data-checkout-choice-card]').forEach((card) => {
      const input = card.querySelector('input[type="radio"]');
      card.classList.toggle('is-selected', Boolean(input?.checked));
    });

    page.querySelectorAll('[data-checkout-payment-card]').forEach((card) => {
      const input = card.querySelector('input[type="radio"]');
      card.classList.toggle('is-selected', Boolean(input?.checked));
    });
  };

  const syncReceiveMethod = () => {
    const receiveMethod = form.elements.receiveMethod?.value || 'delivery';
    const isDelivery = receiveMethod === 'delivery';

    if (deliveryPanel) {
      deliveryPanel.hidden = !isDelivery;
    }

    if (pickupPanel) {
      pickupPanel.hidden = isDelivery;
    }

    if (addressInput) {
      addressInput.required = isDelivery;
      addressInput.disabled = !isDelivery;

      if (!isDelivery) {
        clearFieldError('address');
      }
    }

    if (slotHint) {
      slotHint.textContent = isDelivery
        ? 'Реальные интервалы появятся после подключения правил доставки.'
        : 'Интервалы самовывоза появятся после подключения данных точек выдачи.';
    }

    if (slotSelect) {
      slotSelect.disabled = false;
    }

    syncChoiceCards();
  };

  const renderCheckout = () => {
    const items = commerce.getCart();
    const totals = getCheckoutTotals(items);
    const discount = Math.max(0, totals.oldTotal - totals.total);
    const isEmpty = items.length === 0;

    itemsRoot.innerHTML = items.map(createCheckoutItemMarkup).join('');

    if (summaryCount) {
      summaryCount.textContent = `Товары, ${formatCheckoutQuantity(totals.quantity)}`;
    }

    if (subtotalOutput) {
      subtotalOutput.textContent = formatCheckoutMoney(totals.oldTotal);
    }

    if (discountOutput) {
      discountOutput.textContent = discount ? `−${formatCheckoutMoney(discount)}` : formatCheckoutMoney(0);
    }

    if (totalOutput) {
      totalOutput.textContent = formatCheckoutMoney(totals.total);
    }

    if (mobileTotalOutput) {
      mobileTotalOutput.textContent = formatCheckoutMoney(totals.total);
    }

    form.hidden = isEmpty;

    if (summary) {
      summary.hidden = isEmpty;
    }

    if (emptyState) {
      emptyState.hidden = !isEmpty;
    }

    if (mobileBar) {
      mobileBar.hidden = isEmpty;
    }
  };

  const validateForm = () => {
    clearAllErrors();

    const name = String(form.elements.name?.value || '').trim();
    const phone = String(form.elements.phone?.value || '').trim();
    const email = String(form.elements.email?.value || '').trim();
    const receiveMethod = form.elements.receiveMethod?.value || 'delivery';
    const address = String(form.elements.address?.value || '').trim();
    const receiveDate = String(form.elements.receiveDate?.value || '').trim();
    const agreement = Boolean(form.elements.agreement?.checked);
    const phoneDigits = phone.replace(/\D/g, '');
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const errors = [];

    if (name.length < 2) {
      errors.push(['name', 'Укажите имя, чтобы мы знали, как к вам обращаться.']);
    }

    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      errors.push(['phone', 'Проверьте номер телефона.']);
    }

    if (!emailPattern.test(email)) {
      errors.push(['email', 'Введите корректный email.']);
    }

    if (receiveMethod === 'delivery' && address.length < 5) {
      errors.push(['address', 'Укажите адрес доставки.']);
    }

    if (!receiveDate) {
      errors.push(['receiveDate', 'Выберите дату получения.']);
    } else if (receiveDate < getLocalDateInputValue()) {
      errors.push(['receiveDate', 'Дата получения не может быть в прошлом.']);
    }

    if (!agreement) {
      errors.push(['agreement', 'Подтвердите согласие перед оформлением.']);
    }

    errors.forEach(([field, message]) => setFieldError(field, message));

    const cartItems = commerce.getCart();
    const unavailableItem = cartItems.find((item) => item.available === false);

    if (unavailableItem) {
      setFormStatus(`Товар «${unavailableItem.title || 'из заказа'}» сейчас недоступен. Измените корзину перед оформлением.`);
      return false;
    }

    if (errors.length) {
      setFormStatus('Проверьте выделенные поля — часть данных заполнена не полностью.');
      const firstInvalid = form.querySelector('[aria-invalid="true"]');
      firstInvalid?.focus({ preventScroll: true });
      firstInvalid?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return false;
    }

    return true;
  };

  const setSubmitting = (isSubmitting) => {
    if (submitButton) {
      submitButton.disabled = isSubmitting;
      submitButton.setAttribute('aria-busy', String(isSubmitting));
    }

    if (mobileSubmit) {
      mobileSubmit.disabled = isSubmitting;
      mobileSubmit.setAttribute('aria-busy', String(isSubmitting));
    }

    if (submitText) {
      submitText.textContent = isSubmitting ? 'Проверяем данные' : 'Оформить заказ';
    }

    if (loader) {
      loader.hidden = !isSubmitting;
    }
  };

  const openSuccessModal = () => {
    if (!modal) {
      return;
    }

    lastFocusedElement = document.activeElement;
    modal.hidden = false;
    document.body.classList.add('is-lock');
    modal.querySelector('[data-checkout-modal-close]')?.focus();
  };

  const closeSuccessModal = () => {
    if (!modal) {
      return;
    }

    modal.hidden = true;
    document.body.classList.remove('is-lock');

    if (lastFocusedElement instanceof HTMLElement) {
      lastFocusedElement.focus();
    }
  };

  if (dateInput) {
    dateInput.min = getLocalDateInputValue();
  }

  form.addEventListener('change', (event) => {
    const target = event.target;

    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    if (target.name === 'receiveMethod') {
      syncReceiveMethod();
    }

    if (target.name === 'paymentMethod') {
      syncChoiceCards();
    }

    if (target.dataset.checkoutField) {
      clearFieldError(target.dataset.checkoutField);
      setFormStatus('');
    }
  });

  form.addEventListener('input', (event) => {
    const target = event.target;

    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    if (target.dataset.checkoutField) {
      clearFieldError(target.dataset.checkoutField);
      setFormStatus('');
    }

    if (target === commentInput && commentCount) {
      commentCount.textContent = `${target.value.length} / ${target.maxLength}`;
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    window.clearTimeout(submitTimer);

    if (!commerce.getCart().length) {
      renderCheckout();
      return;
    }

    if (!validateForm()) {
      return;
    }

    setSubmitting(true);
    setFormStatus('Проверяем заполненные данные перед отправкой…', 'success');

    submitTimer = window.setTimeout(() => {
      setSubmitting(false);
      setFormStatus('Данные формы валидны. Реальную отправку заказа подключим вместе с checkout API.', 'success');
      openSuccessModal();
    }, 650);
  });

  mobileSubmit?.addEventListener('click', () => {
    form.requestSubmit();
  });

  const promoForm = page.querySelector('[data-checkout-promo-form]');
  const promoInput = page.querySelector('[data-checkout-promo-input]');
  const promoMessage = page.querySelector('[data-checkout-promo-message]');

  promoForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const promoCode = String(promoInput?.value || '').trim();

    if (!promoCode) {
      promoMessage?.classList.add('is-error');

      if (promoMessage) {
        promoMessage.textContent = 'Введите промокод.';
      }

      promoInput?.focus();
      return;
    }

    promoMessage?.classList.remove('is-error');

    if (promoMessage) {
      promoMessage.textContent = 'Код сохранён для проверки. Скидку применит только сервер после подключения checkout API.';
    }
  });

  promoInput?.addEventListener('input', () => {
    promoMessage?.classList.remove('is-error');

    if (promoMessage) {
      promoMessage.textContent = '';
    }
  });

  modal?.addEventListener('click', (event) => {
    if (event.target.closest('[data-checkout-modal-close]')) {
      closeSuccessModal();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) {
      closeSuccessModal();
    }
  });

  document.addEventListener('sibdel:commerce-ui-updated', renderCheckout);
  document.addEventListener('sibdel:commerce-state-changed', renderCheckout);

  syncReceiveMethod();
  syncChoiceCards();
  renderCheckout();
}

initCheckoutPage();
