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

function createCheckoutItemMarkup(item) {
  const key = getCheckoutItemKey(item);
  const slug = encodeURIComponent(String(item.slug || key));
  const title = escapeCheckoutHtml(item.title || 'Товар');
  const image = sanitizeCheckoutImage(item.image);
  const measure = escapeCheckoutHtml(item.measure || '');
  const quantity = Math.max(0, Number(item.quantity) || 0);
  const unitPrice = Math.max(0, Number(item.unitPrice) || 0);
  const oldUnitPrice = Math.max(unitPrice, Number(item.oldUnitPrice) || unitPrice);
  const currentLinePrice = Number.isFinite(Number(item.total))
    ? Number(item.total)
    : unitPrice * quantity;
  const oldLinePrice = Number.isFinite(Number(item.lineSubtotal))
    ? Number(item.lineSubtotal)
    : oldUnitPrice * quantity;
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

function createCheckoutIdempotencyKey() {
  if (typeof crypto?.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function requestCheckoutApi(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || 'Не удалось оформить заказ.');
    error.status = response.status;
    error.code = payload?.error?.code || 'CHECKOUT_REQUEST_FAILED';
    error.details = payload?.error?.details;
    throw error;
  }

  return payload;
}

function buildAddressValue(address) {
  if (!address) {
    return '';
  }

  const street = [address.street, address.house].filter(Boolean).join(', ');
  return [address.city, street, address.apartment ? `кв. ${address.apartment}` : '']
    .filter(Boolean)
    .join(', ');
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
  const deliveryOutput = page.querySelector('[data-checkout-delivery-cost]');
  const totalOutput = page.querySelector('[data-checkout-total]');
  const mobileTotalOutput = page.querySelector('[data-checkout-mobile-total]');
  const totalNote = page.querySelector('[data-checkout-total-note]');
  const formStatus = page.querySelector('[data-checkout-form-status]');
  const deliveryPanel = page.querySelector('[data-checkout-delivery-panel]');
  const pickupPanel = page.querySelector('[data-checkout-pickup-panel]');
  const pickupHint = page.querySelector('[data-checkout-pickup-hint]');
  const pickupSelect = page.querySelector('[data-checkout-field="pickupPointId"]');
  const addressInput = page.querySelector('[data-checkout-field="address"]');
  const dateInput = page.querySelector('[data-checkout-field="receiveDate"]');
  const slotSelect = page.querySelector('[data-checkout-field="receiveSlot"]');
  const slotHint = page.querySelector('[data-checkout-slot-hint]');
  const commentInput = page.querySelector('[data-checkout-comment]');
  const commentCount = page.querySelector('[data-checkout-comment-count]');
  const promoForm = page.querySelector('[data-checkout-promo-form]');
  const promoInput = page.querySelector('[data-checkout-promo-input]');
  const promoMessage = page.querySelector('[data-checkout-promo-message]');
  const modal = page.querySelector('[data-checkout-state-modal]');
  const successText = page.querySelector('[data-checkout-success-text]');
  const successLink = page.querySelector('[data-checkout-success-link]');
  const pickupRadio = form?.querySelector('input[name="receiveMethod"][value="pickup"]');
  const onlinePayment = form?.querySelector('input[name="paymentMethod"][value="online"]');
  const receiptPayment = form?.querySelector('input[name="paymentMethod"][value="on-receipt"]');

  if (!form || !itemsRoot) {
    return;
  }

  let checkoutState = null;
  let idempotencyKey = createCheckoutIdempotencyKey();
  let userEditedContact = false;
  let userEditedAddress = false;

  const setFormStatus = (message = '', type = 'error') => {
    if (!formStatus) return;
    formStatus.textContent = message;
    formStatus.hidden = !message;
    formStatus.classList.toggle('is-success', type === 'success');
  };

  const clearFieldError = (fieldName) => {
    const input = form.querySelector(`[data-checkout-field="${fieldName}"]`);
    const error = form.querySelector(`[data-checkout-error="${fieldName}"]`);
    input?.classList.remove('is-error');
    input?.removeAttribute('aria-invalid');
    if (error) error.textContent = '';
  };

  const setFieldError = (fieldName, message) => {
    const input = form.querySelector(`[data-checkout-field="${fieldName}"]`);
    const error = form.querySelector(`[data-checkout-error="${fieldName}"]`);
    input?.classList.add('is-error');
    input?.setAttribute('aria-invalid', 'true');
    if (error) error.textContent = message;
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
      card.classList.toggle('is-disabled', Boolean(input?.disabled));
    });
    page.querySelectorAll('[data-checkout-payment-card]').forEach((card) => {
      const input = card.querySelector('input[type="radio"]');
      card.classList.toggle('is-selected', Boolean(input?.checked));
      card.classList.toggle('is-disabled', Boolean(input?.disabled));
    });
  };

  const syncReceiveMethod = () => {
    const receiveMethod = form.elements.receiveMethod?.value || 'delivery';
    const isDelivery = receiveMethod === 'delivery';

    if (deliveryPanel) deliveryPanel.hidden = !isDelivery;
    if (pickupPanel) pickupPanel.hidden = isDelivery;

    if (addressInput) {
      addressInput.required = isDelivery;
      addressInput.disabled = !isDelivery;
      if (!isDelivery) clearFieldError('address');
    }

    if (pickupSelect) {
      const selectionRequired = checkoutState?.capabilities?.pickupPointSelectionRequired === true;
      pickupSelect.required = !isDelivery && selectionRequired;
      pickupSelect.disabled = isDelivery || !selectionRequired;
      if (isDelivery || !selectionRequired) clearFieldError('pickupPointId');
    }

    syncChoiceCards();
  };

  const renderPickupPoints = () => {
    const points = checkoutState?.pickupPoints || [];
    const selectionRequired = points.length > 0;

    if (pickupSelect) {
      pickupSelect.innerHTML = selectionRequired
        ? [
            '<option value="">Выберите точку самовывоза</option>',
            ...points.map((point) => `<option value="${point.id}">${escapeCheckoutHtml(point.name)} — ${escapeCheckoutHtml(point.address)}</option>`),
          ].join('')
        : '<option value="">Точку подтвердим после оформления</option>';
    }

    if (pickupRadio) {
      pickupRadio.disabled = false;
    }

    if (pickupHint) {
      pickupHint.textContent = selectionRequired
        ? 'Выберите удобную точку самовывоза.'
        : 'Самовывоз доступен. Адрес и время выдачи подтвердит менеджер после оформления.';
    }
  };

  const renderSlots = () => {
    const slots = checkoutState?.deliverySlots || [];

    if (!slotSelect) return;

    const previous = slotSelect.value;

    if (slots.length === 0) {
      slotSelect.innerHTML = '<option value="">Время согласуем после оформления</option>';
      slotSelect.value = '';
      slotSelect.disabled = true;

      if (slotHint) {
        slotHint.textContent = 'Когда интервалы будут настроены, здесь появится выбор времени. Пока менеджер согласует его после оформления.';
      }
      return;
    }

    slotSelect.disabled = false;
    slotSelect.innerHTML = [
      '<option value="">Любой доступный интервал</option>',
      ...slots.map((slot) => `<option value="${slot.id}">${escapeCheckoutHtml(`${slot.startTime}–${slot.endTime}`)}</option>`),
    ].join('');

    if ([...slotSelect.options].some((option) => option.value === previous)) {
      slotSelect.value = previous;
    }

    if (slotHint) {
      slotHint.textContent = 'Выберите удобный активный интервал или оставьте любое доступное время.';
    }
  };

  const renderPaymentCapabilities = () => {
    const onlineAvailable = checkoutState?.capabilities?.onlinePayment === true;

    if (onlinePayment) {
      onlinePayment.disabled = !onlineAvailable;
      if (!onlineAvailable && onlinePayment.checked && receiptPayment) {
        receiptPayment.checked = true;
      }
    }

    syncChoiceCards();
  };

  const applyCustomerDefaults = () => {
    const customer = checkoutState?.customer;
    const address = checkoutState?.defaultAddress;

    if (customer && !userEditedContact) {
      if (!form.elements.name.value) form.elements.name.value = customer.name || '';
      if (!form.elements.phone.value) form.elements.phone.value = customer.phone || '';
      if (!form.elements.email.value) form.elements.email.value = customer.email || '';
    }

    if (address && !userEditedAddress && !form.elements.address.value) {
      form.elements.address.value = buildAddressValue(address);
      if (form.elements.entrance && !form.elements.entrance.value) form.elements.entrance.value = address.entrance || '';
      if (form.elements.floor && !form.elements.floor.value) form.elements.floor.value = address.floor || '';
    }
  };

  const renderCheckout = () => {
    const cart = checkoutState?.cart;
    const items = cart?.items || commerce.getCart();
    const serverSummary = cart?.summary;
    const isEmpty = items.length === 0;

    itemsRoot.innerHTML = items.map(createCheckoutItemMarkup).join('');

    const quantity = serverSummary?.quantity ?? items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const subtotal = serverSummary?.subtotal ?? 0;
    const discount = serverSummary?.discount ?? 0;
    const total = serverSummary?.total ?? commerce.getCartTotal();

    if (summaryCount) summaryCount.textContent = `Товары, ${formatCheckoutQuantity(quantity)}`;
    if (subtotalOutput) subtotalOutput.textContent = formatCheckoutMoney(subtotal);
    if (discountOutput) discountOutput.textContent = discount ? `−${formatCheckoutMoney(discount)}` : formatCheckoutMoney(0);
    if (deliveryOutput) {
      deliveryOutput.textContent = serverSummary?.deliveryPriceConfirmed
        ? formatCheckoutMoney(serverSummary.deliveryPrice)
        : 'уточняется';
    }
    if (totalOutput) totalOutput.textContent = formatCheckoutMoney(total);
    if (mobileTotalOutput) mobileTotalOutput.textContent = formatCheckoutMoney(total);
    if (totalNote) {
      totalNote.textContent = serverSummary?.isFinal
        ? 'итоговая сумма подтверждена сервером'
        : 'стоимость доставки ещё не подтверждена';
    }

    form.hidden = isEmpty;
    if (summary) summary.hidden = isEmpty;
    if (emptyState) emptyState.hidden = !isEmpty;
    if (mobileBar) mobileBar.hidden = isEmpty;
  };

  const refreshCheckoutState = async ({ date = dateInput?.value || '', preserveStatus = false } = {}) => {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    const payload = await requestCheckoutApi(`/api/checkout${query}`);
    checkoutState = payload.checkout;
    renderPickupPoints();
    renderSlots();
    renderPaymentCapabilities();
    applyCustomerDefaults();
    syncReceiveMethod();
    renderCheckout();

    if (!preserveStatus && checkoutState?.cart?.issues?.length) {
      setFormStatus('Корзина изменилась. Вернитесь в корзину и проверьте количество товаров.');
    }
  };

  const validateForm = () => {
    clearAllErrors();
    const name = String(form.elements.name?.value || '').trim();
    const phone = String(form.elements.phone?.value || '').trim();
    const email = String(form.elements.email?.value || '').trim();
    const receiveMethod = form.elements.receiveMethod?.value || 'delivery';
    const address = String(form.elements.address?.value || '').trim();
    const pickupPointId = String(form.elements.pickupPointId?.value || '').trim();
    const receiveDate = String(form.elements.receiveDate?.value || '').trim();
    const agreement = Boolean(form.elements.agreement?.checked);
    const phoneDigits = phone.replace(/\D/g, '');
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const errors = [];

    if (name.length < 2) errors.push(['name', 'Укажите имя, чтобы мы знали, как к вам обращаться.']);
    if (phoneDigits.length < 10 || phoneDigits.length > 15) errors.push(['phone', 'Проверьте номер телефона.']);
    if (!emailPattern.test(email)) errors.push(['email', 'Введите корректный email.']);
    if (receiveMethod === 'delivery' && address.length < 5) errors.push(['address', 'Укажите адрес доставки.']);
    if (receiveMethod === 'pickup' && checkoutState?.capabilities?.pickupPointSelectionRequired === true && !pickupPointId) errors.push(['pickupPointId', 'Выберите точку самовывоза.']);
    if (!receiveDate) errors.push(['receiveDate', 'Выберите дату получения.']);
    else if (receiveDate < getLocalDateInputValue()) errors.push(['receiveDate', 'Дата получения не может быть в прошлом.']);
    if (!agreement) errors.push(['agreement', 'Подтвердите согласие перед оформлением.']);

    errors.forEach(([field, message]) => setFieldError(field, message));

    if (checkoutState?.cart?.issues?.length) {
      setFormStatus('Состав корзины изменился. Проверьте товары перед оформлением.');
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
    if (submitText) submitText.textContent = isSubmitting ? 'Создаём заказ' : 'Оформить заказ';
    if (loader) loader.hidden = !isSubmitting;
  };

  const openSuccessModal = (order) => {
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('is-lock');

    if (successText) {
      successText.textContent = `Заказ №${order.number} создан. ${order.deliveryPriceConfirmed ? 'Сумма подтверждена.' : 'Стоимость доставки будет подтверждена отдельно.'}`;
    }

    if (successLink) {
      if (order.canViewInAccount) {
        successLink.href = `/account/order?id=${encodeURIComponent(order.id)}`;
        successLink.textContent = 'Посмотреть заказ';
      } else {
        successLink.href = '/catalog.html';
        successLink.textContent = 'Продолжить покупки';
      }
    }

    successLink?.focus();
  };

  const closeSuccessModal = () => {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('is-lock');
  };

  modal?.querySelectorAll('[data-checkout-modal-close]').forEach((button) => {
    button.addEventListener('click', closeSuccessModal);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && modal && !modal.hidden) {
      closeSuccessModal();
    }
  });

  if (dateInput) dateInput.min = getLocalDateInputValue();

  form.addEventListener('change', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) return;

    if (target.name === 'receiveMethod') syncReceiveMethod();
    if (target.name === 'paymentMethod') syncChoiceCards();
    if (target.name === 'receiveDate') {
      try {
        await refreshCheckoutState({ date: target.value, preserveStatus: true });
      } catch (error) {
        setFormStatus(error.message);
      }
    }
    if (target.dataset.checkoutField) {
      clearFieldError(target.dataset.checkoutField);
      setFormStatus('');
    }
  });

  form.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

    if (['name', 'phone', 'email'].includes(target.name)) userEditedContact = true;
    if (['address', 'entrance', 'floor'].includes(target.name)) userEditedAddress = true;

    if (target.dataset.checkoutField) {
      clearFieldError(target.dataset.checkoutField);
      setFormStatus('');
    }
    if (target === commentInput && commentCount) {
      commentCount.textContent = `${target.value.length} / ${target.maxLength}`;
    }
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!checkoutState?.cart?.items?.length) {
      renderCheckout();
      return;
    }

    if (!validateForm()) return;

    setSubmitting(true);
    setFormStatus('Сервер повторно проверяет цены, скидки, количество и наличие…', 'success');

    try {
      const payload = await requestCheckoutApi('/api/checkout', {
        method: 'POST',
        body: {
          idempotencyKey,
          name: String(form.elements.name.value || '').trim(),
          phone: String(form.elements.phone.value || '').trim(),
          email: String(form.elements.email.value || '').trim(),
          receiveMethod: form.elements.receiveMethod.value,
          address: String(form.elements.address?.value || '').trim(),
          entrance: String(form.elements.entrance?.value || '').trim(),
          floor: String(form.elements.floor?.value || '').trim(),
          receiveDate: form.elements.receiveDate.value,
          receiveSlotId: form.elements.receiveSlot?.value ? Number(form.elements.receiveSlot.value) : null,
          pickupPointId: form.elements.pickupPointId?.value ? Number(form.elements.pickupPointId.value) : null,
          paymentMethod: form.elements.paymentMethod.value,
          comment: String(form.elements.comment?.value || '').trim(),
          agreement: Boolean(form.elements.agreement.checked),
        },
      });

      commerce.replaceCart([]);
      checkoutState = {
        ...(checkoutState || {}),
        cart: {
          items: [],
          issues: [],
          summary: {
            lines: 0,
            quantity: 0,
            subtotal: 0,
            discount: 0,
            merchandiseTotal: 0,
            deliveryPrice: null,
            deliveryPriceConfirmed: false,
            total: 0,
            currency: 'RUB',
            isFinal: false,
          },
        },
      };
      renderCheckout();
      setFormStatus('Заказ успешно создан.', 'success');
      openSuccessModal(payload.order);
      idempotencyKey = createCheckoutIdempotencyKey();
    } catch (error) {
      if (error.code === 'CART_OUTDATED' || error.code === 'CHECKOUT_RETRY_REQUIRED') {
        try {
          await commerce.refresh?.('checkout-reload');
          await refreshCheckoutState({ preserveStatus: true });
        } catch {
          // The original checkout error remains the useful message for the user.
        }
      }
      setFormStatus(error.message || 'Не удалось создать заказ. Попробуйте ещё раз.');
    } finally {
      setSubmitting(false);
    }
  });

  mobileSubmit?.addEventListener('click', () => form.requestSubmit());

  promoForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const promoCode = String(promoInput?.value || '').trim();
    promoMessage?.classList.toggle('is-error', Boolean(promoCode));
    if (promoMessage) {
      promoMessage.textContent = promoCode
        ? 'Промокоды пока не подключены к серверной модели акций и не влияют на сумму заказа.'
        : 'Введите промокод.';
    }
  });

  promoInput?.addEventListener('input', () => {
    promoMessage?.classList.remove('is-error');
    if (promoMessage) promoMessage.textContent = '';
  });

  document.addEventListener('sibdel:commerce-state-changed', () => {
    if (!checkoutState) return;
    void refreshCheckoutState({ preserveStatus: true }).catch(() => {});
  });

  void (async () => {
    try {
      await commerce.ready();
      await refreshCheckoutState();
    } catch (error) {
      setFormStatus(error.message || 'Не удалось загрузить данные оформления заказа.');
      renderCheckout();
    }
  })();
}

initCheckoutPage();
