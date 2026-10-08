const ADMIN_ORDER_STATUS_LABELS = Object.freeze({
  NEW: "Новый",
  CONFIRMED: "Подтверждён",
  ASSEMBLING: "Собирается",
  READY: "Готов",
  DELIVERING: "Доставляется",
  COMPLETED: "Выполнен",
  CANCELLED: "Отменён",
});

const ADMIN_PAYMENT_STATUS_LABELS = Object.freeze({
  PENDING: "Ожидает оплаты",
  WAITING_FOR_CAPTURE: "Ожидает подтверждения",
  SUCCEEDED: "Оплачен",
  CANCELLED: "Отменён",
  REFUNDED: "Возвращён",
  PARTIALLY_REFUNDED: "Частичный возврат",
  FAILED: "Ошибка оплаты",
});

const ADMIN_DELIVERY_METHOD_LABELS = Object.freeze({
  DELIVERY: "Доставка",
  PICKUP: "Самовывоз",
});

const ADMIN_PAYMENT_METHOD_LABELS = Object.freeze({
  ONLINE: "Онлайн",
  ON_RECEIPT: "При получении",
});

const ADMIN_RESERVATION_STATUS_LABELS = Object.freeze({
  ACTIVE: "Активен",
  RELEASED: "Снят",
  COMMITTED: "Списан",
});

const ADMIN_MOVEMENT_LABELS = Object.freeze({
  RECEIPT: "Поступление",
  RESERVE: "Резерв",
  RELEASE: "Снятие резерва",
  SALE: "Продажа",
  RETURN: "Возврат",
  ADJUSTMENT: "Корректировка",
});

let currentAdminUser = null;
let adminToastTimer = null;
let currentInventoryProductId = null;

async function parseAdminJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function escapeAdminHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatAdminMoney(value, currency = "RUB") {
  const amount = Number(value ?? 0);

  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function formatAdminQuantity(value) {
  if (value === null || value === undefined) return "—";

  const number = Number(value);
  if (!Number.isFinite(number)) return "—";

  return new Intl.NumberFormat("ru-RU", {
    maximumFractionDigits: 3,
  }).format(number);
}

function formatAdminDate(value, withTime = true) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function adminStatusClass(status) {
  return `is-${String(status || "unknown").toLowerCase()}`;
}

function adminStatusMarkup(status) {
  const label = ADMIN_ORDER_STATUS_LABELS[status] || status || "—";
  return `<span class="admin-status ${adminStatusClass(status)}">${escapeAdminHtml(label)}</span>`;
}

function showAdminToast(message, type = "success") {
  const toast = document.querySelector("[data-admin-toast]");
  if (!toast) return;

  if (adminToastTimer) {
    window.clearTimeout(adminToastTimer);
  }

  toast.textContent = message;
  toast.classList.remove("is-error", "is-success");
  toast.classList.add(type === "error" ? "is-error" : "is-success");
  toast.hidden = false;

  requestAnimationFrame(() => toast.classList.add("is-visible"));

  adminToastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
    window.setTimeout(() => {
      toast.hidden = true;
    }, 220);
  }, 3600);
}

async function adminFetch(url, options = {}) {
  const { headers = {}, ...requestOptions } = options;
  const isFormData = typeof FormData !== "undefined" && requestOptions.body instanceof FormData;
  const response = await fetch(url, {
    credentials: "same-origin",
    ...requestOptions,
    headers: {
      Accept: "application/json",
      ...(requestOptions.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
  });

  const payload = await parseAdminJson(response);

  if (response.status === 401) {
    window.location.replace("/admin/login");
    throw new Error("UNAUTHORIZED");
  }

  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.error?.message || "Не удалось выполнить запрос.");
    error.status = response.status;
    error.code = payload?.error?.code;
    error.details = payload?.error?.details;
    throw error;
  }

  return payload;
}

function setAdminLoginStatus(message, type = "") {
  const status = document.querySelector("[data-admin-status]");
  if (!status) return;

  status.textContent = message;
  status.classList.remove("is-error", "is-success");
  if (type) status.classList.add(`is-${type}`);
}

function setAdminLoginLoading(loading) {
  const button = document.querySelector("[data-admin-submit]");
  if (!(button instanceof HTMLButtonElement)) return;
  button.disabled = loading;
  button.classList.toggle("is-loading", loading);
}

async function initAdminLogin() {
  const form = document.querySelector("[data-admin-login-form]");
  if (!(form instanceof HTMLFormElement)) return;

  try {
    const current = await fetch("/api/admin/me", {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });

    if (current.ok) {
      window.location.replace("/admin/");
      return;
    }
  } catch {
    // The form stays available when session probing fails.
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const data = new FormData(form);
    const email = String(data.get("email") || "").trim().toLowerCase();
    const password = String(data.get("password") || "");

    if (!email || !password) {
      setAdminLoginStatus("Введите email и пароль.", "error");
      return;
    }

    setAdminLoginLoading(true);
    setAdminLoginStatus("Проверяем данные...");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, password }),
      });

      const payload = await parseAdminJson(response);

      if (!response.ok || !payload?.ok) {
        setAdminLoginStatus(
          payload?.error?.message || "Не удалось выполнить вход.",
          "error",
        );
        return;
      }

      setAdminLoginStatus("Вход выполнен. Открываем панель...", "success");
      window.setTimeout(() => window.location.replace("/admin/"), 220);
    } catch {
      setAdminLoginStatus("Не удалось связаться с сервером.", "error");
    } finally {
      setAdminLoginLoading(false);
    }
  });
}

function hydrateAdminUser(user) {
  currentAdminUser = user;

  const displayName = [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Сотрудник";

  document.querySelectorAll("[data-admin-user-name]").forEach((element) => {
    element.textContent = displayName;
  });

  document.querySelectorAll("[data-admin-user-email]").forEach((element) => {
    element.textContent = user.email || "Без email";
  });

  document.querySelectorAll("[data-admin-user-role]").forEach((element) => {
    element.textContent = user.role || "";
  });

  if (user.role !== "OWNER") {
    document.querySelectorAll("[data-owner-only]").forEach((element) => element.remove());
  }
}

function activateAdminNavigation() {
  const page = document.body.dataset.adminPage;
  document.querySelector(`[data-admin-nav="${page}"]`)?.classList.add("is-active");
}

async function initAdminShell() {
  const app = document.querySelector("[data-admin-app]");
  if (!app) return false;

  try {
    const payload = await adminFetch("/api/admin/me");
    hydrateAdminUser(payload.user);
    activateAdminNavigation();
  } catch (error) {
    if (error.message !== "UNAUTHORIZED") {
      window.location.replace("/admin/login");
    }
    return false;
  }

  document.querySelectorAll("[data-admin-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await fetch("/api/admin/logout", {
          method: "POST",
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
      } finally {
        window.location.replace("/admin/login");
      }
    });
  });

  return true;
}

function renderDashboardOrders(orders) {
  const body = document.querySelector("[data-dashboard-orders]");
  if (!body) return;

  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="5" class="admin-table__empty">Заказов пока нет.</td></tr>';
    return;
  }

  body.innerHTML = orders
    .map(
      (order) => `
        <tr>
          <td><a class="admin-table__primary" href="/admin/order?order=${encodeURIComponent(order.number)}">${escapeAdminHtml(order.number)}</a><small>${escapeAdminHtml(String(order.itemsCount))} поз.</small></td>
          <td><strong>${escapeAdminHtml(order.customerName)}</strong><small>${escapeAdminHtml(order.customerPhone)}</small></td>
          <td>${adminStatusMarkup(order.status)}</td>
          <td><strong>${escapeAdminHtml(formatAdminMoney(order.total, order.currency))}</strong></td>
          <td>${escapeAdminHtml(formatAdminDate(order.createdAt))}</td>
        </tr>
      `,
    )
    .join("");
}

async function initAdminDashboard() {
  if (document.body.dataset.adminPage !== "dashboard") return;

  try {
    const payload = await adminFetch("/api/admin/dashboard");
    const { metrics, recentOrders } = payload.dashboard;

    document.querySelectorAll("[data-dashboard-metric]").forEach((element) => {
      const key = element.dataset.dashboardMetric;
      let value = metrics[key];

      if (key === "orderValueToday") {
        value = formatAdminMoney(value);
      } else if (key === "reservedUnits") {
        value = formatAdminQuantity(value);
      }

      element.textContent = String(value ?? "—");
    });

    const badge = document.querySelector("[data-admin-new-orders]");
    if (badge && metrics.newOrders > 0) {
      badge.textContent = String(metrics.newOrders);
      badge.hidden = false;
    }

    renderDashboardOrders(recentOrders);
  } catch (error) {
    showAdminToast(error.message, "error");
  }
}

function getOrdersQueryState() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q") || "",
    status: params.get("status") || "",
    page: Math.max(1, Number(params.get("page") || 1) || 1),
  };
}

function syncOrdersForm(state) {
  const form = document.querySelector("[data-orders-filter]");
  if (!(form instanceof HTMLFormElement)) return;

  const q = form.elements.namedItem("q");
  const status = form.elements.namedItem("status");
  if (q instanceof HTMLInputElement) q.value = state.q;
  if (status instanceof HTMLSelectElement) status.value = state.status;
}

function renderOrdersList(orders) {
  const body = document.querySelector("[data-orders-list]");
  if (!body) return;

  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="7" class="admin-table__empty">По выбранным условиям заказов нет.</td></tr>';
    return;
  }

  body.innerHTML = orders
    .map(
      (order) => `
        <tr>
          <td><a class="admin-table__primary" href="/admin/order?order=${encodeURIComponent(order.number)}">${escapeAdminHtml(order.number)}</a><small>${escapeAdminHtml(String(order.itemsCount))} поз.</small></td>
          <td><strong>${escapeAdminHtml(order.customerName)}</strong><small>${escapeAdminHtml(order.customerPhone)}</small></td>
          <td>${escapeAdminHtml(ADMIN_DELIVERY_METHOD_LABELS[order.deliveryMethod] || order.deliveryMethod)}</td>
          <td>${adminStatusMarkup(order.status)}</td>
          <td>${order.activeReservations > 0 ? `<span class="admin-reserve-count">${escapeAdminHtml(String(order.activeReservations))}</span>` : "—"}</td>
          <td><strong>${escapeAdminHtml(formatAdminMoney(order.total, order.currency))}</strong></td>
          <td>${escapeAdminHtml(formatAdminDate(order.createdAt))}</td>
        </tr>
      `,
    )
    .join("");
}

function renderOrdersPagination(pagination, state) {
  const container = document.querySelector("[data-orders-pagination]");
  if (!container) return;

  if (pagination.pages <= 1) {
    container.innerHTML = `<span>${escapeAdminHtml(String(pagination.total))} заказов</span>`;
    return;
  }

  const makeHref = (page) => {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.status) params.set("status", state.status);
    params.set("page", String(page));
    return `/admin/orders?${params.toString()}`;
  };

  container.innerHTML = `
    <span>${escapeAdminHtml(String(pagination.total))} заказов</span>
    <div>
      ${pagination.page > 1 ? `<a class="admin-pagination__button" href="${makeHref(pagination.page - 1)}">Назад</a>` : ""}
      <span class="admin-pagination__current">${pagination.page} / ${pagination.pages}</span>
      ${pagination.page < pagination.pages ? `<a class="admin-pagination__button" href="${makeHref(pagination.page + 1)}">Далее</a>` : ""}
    </div>
  `;
}

async function loadAdminOrders() {
  const state = getOrdersQueryState();
  syncOrdersForm(state);

  const query = new URLSearchParams({ page: String(state.page), limit: "25" });
  if (state.q) query.set("q", state.q);
  if (state.status) query.set("status", state.status);

  const payload = await adminFetch(`/api/admin/orders?${query.toString()}`);
  renderOrdersList(payload.orders.items);
  renderOrdersPagination(payload.orders.pagination, state);
}

async function initAdminOrders() {
  if (document.body.dataset.adminPage !== "orders" || document.body.hasAttribute("data-admin-order-page")) return;

  const form = document.querySelector("[data-orders-filter]");
  const reset = document.querySelector("[data-orders-reset]");

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;

    const data = new FormData(form);
    const params = new URLSearchParams();
    const q = String(data.get("q") || "").trim();
    const status = String(data.get("status") || "");

    if (q) params.set("q", q);
    if (status) params.set("status", status);
    window.location.assign(`/admin/orders${params.size ? `?${params.toString()}` : ""}`);
  });

  reset?.addEventListener("click", () => window.location.assign("/admin/orders"));

  try {
    await loadAdminOrders();
  } catch (error) {
    showAdminToast(error.message, "error");
  }
}

function adminDetailRow(label, value) {
  return `<div><dt>${escapeAdminHtml(label)}</dt><dd>${value || "—"}</dd></div>`;
}

function renderAdminOrder(order) {
  const title = document.querySelector("[data-order-title]");
  const status = document.querySelector("[data-order-status]");
  const created = document.querySelector("[data-order-created]");

  if (title) title.textContent = `Заказ ${order.number}`;
  if (status) {
    status.textContent = ADMIN_ORDER_STATUS_LABELS[order.status] || order.status;
    status.className = `admin-status ${adminStatusClass(order.status)}`;
  }
  if (created) created.textContent = `Создан ${formatAdminDate(order.createdAt)} · обновлён ${formatAdminDate(order.updatedAt)}`;

  const customer = document.querySelector("[data-order-customer]");
  if (customer) {
    customer.innerHTML = [
      adminDetailRow("Имя", `<strong>${escapeAdminHtml(order.customerName)}</strong>`),
      adminDetailRow("Телефон", `<a href="tel:${escapeAdminHtml(order.customerPhone)}">${escapeAdminHtml(order.customerPhone)}</a>`),
      adminDetailRow("Email", order.customerEmail ? `<a href="mailto:${escapeAdminHtml(order.customerEmail)}">${escapeAdminHtml(order.customerEmail)}</a>` : "—"),
      adminDetailRow("Аккаунт", order.user?.id ? `<a class="admin-text-link" href="/admin/customer?id=${encodeURIComponent(order.user.id)}">Открыть клиента #${escapeAdminHtml(String(order.user.id))}</a>` : "Гостевой заказ"),
      adminDetailRow("Получение", escapeAdminHtml(ADMIN_DELIVERY_METHOD_LABELS[order.deliveryMethod] || order.deliveryMethod)),
      adminDetailRow("Дата", escapeAdminHtml(formatAdminDate(order.requestedReceiveDate, false))),
      adminDetailRow("Время", escapeAdminHtml(order.requestedTimeWindow || "—")),
      adminDetailRow("Адрес", escapeAdminHtml(order.deliveryAddressSnapshot || (order.deliveryMethod === "PICKUP" ? "Самовывоз" : "—"))),
      adminDetailRow("Зона / тариф", escapeAdminHtml(order.deliveryTermsSnapshot?.zoneName
        ? `${order.deliveryTermsSnapshot.zoneName} · ${formatAdminMoney(order.deliveryTermsSnapshot.tariff)}${order.deliveryTermsSnapshot.freeDeliveryApplied ? " · бесплатно от порога" : ""}`
        : (order.deliveryTermsSnapshot?.method === "PICKUP" ? "Самовывоз бесплатно" : "Не указан"))),
      adminDetailRow("Комментарий", escapeAdminHtml(order.comment || "—")),
    ].join("");
  }

  const items = document.querySelector("[data-order-items]");
  if (items) {
    items.innerHTML = order.items.length
      ? order.items.map((item) => `
          <tr>
            <td><strong>${escapeAdminHtml(item.productName)}</strong></td>
            <td>${escapeAdminHtml(item.sku)}</td>
            <td>${escapeAdminHtml(formatAdminQuantity(item.quantity))}</td>
            <td>${escapeAdminHtml(formatAdminMoney(item.unitPrice, order.currency))}</td>
            <td>${item.reservation ? `<span class="admin-reservation ${String(item.reservation.status).toLowerCase()}">${escapeAdminHtml(ADMIN_RESERVATION_STATUS_LABELS[item.reservation.status] || item.reservation.status)} · ${escapeAdminHtml(formatAdminQuantity(item.reservation.quantity))}</span>` : "—"}</td>
            <td><strong>${escapeAdminHtml(formatAdminMoney(item.total, order.currency))}</strong></td>
          </tr>
        `).join("")
      : '<tr><td colspan="6" class="admin-table__empty">В заказе нет позиций.</td></tr>';
  }

  const totals = document.querySelector("[data-order-totals]");
  if (totals) {
    totals.innerHTML = [
      adminDetailRow("Товары", escapeAdminHtml(formatAdminMoney(order.subtotal, order.currency))),
      adminDetailRow("Скидка", escapeAdminHtml(formatAdminMoney(order.discountTotal, order.currency))),
      adminDetailRow("Доставка", escapeAdminHtml(formatAdminMoney(order.deliveryPrice, order.currency))),
      adminDetailRow("Способ оплаты", escapeAdminHtml(ADMIN_PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod || "Не указан")),
      adminDetailRow("Статус оплаты", escapeAdminHtml(ADMIN_PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus)),
      `<div class="admin-money-list__total"><dt>Итого</dt><dd>${escapeAdminHtml(formatAdminMoney(order.total, order.currency))}</dd></div>`,
    ].join("");
  }

  const reservations = document.querySelector("[data-order-reservations]");
  if (reservations) {
    reservations.innerHTML = order.inventoryReservations.length
      ? `<div class="admin-reservation-list">${order.inventoryReservations.map((reservation) => `
          <div>
            <span>Товар #${escapeAdminHtml(String(reservation.productId))}</span>
            <strong>${escapeAdminHtml(formatAdminQuantity(reservation.quantity))}</strong>
            <span class="admin-reservation ${String(reservation.status).toLowerCase()}">${escapeAdminHtml(ADMIN_RESERVATION_STATUS_LABELS[reservation.status] || reservation.status)}</span>
          </div>
        `).join("")}</div>`
      : '<p class="admin-muted">Для этого заказа активных или завершённых резервов нет.</p>';
  }

  const select = document.querySelector("[data-order-status-select]");
  const submit = document.querySelector("[data-order-status-submit]");
  const note = document.querySelector("[data-order-status-note]");

  if (select instanceof HTMLSelectElement && submit instanceof HTMLButtonElement) {
    if (!order.allowedStatuses.length) {
      select.innerHTML = `<option value="">Нет доступных переходов</option>`;
      select.disabled = true;
      submit.disabled = true;
      if (note) note.textContent = "Заказ находится в финальном статусе.";
    } else {
      select.innerHTML = order.allowedStatuses
        .map((nextStatus) => `<option value="${escapeAdminHtml(nextStatus)}">${escapeAdminHtml(ADMIN_ORDER_STATUS_LABELS[nextStatus] || nextStatus)}</option>`)
        .join("");
      select.disabled = false;
      submit.disabled = false;
      if (note) note.textContent = "Переходы ограничены серверной схемой статусов.";
    }
  }
}

async function loadAdminOrder(orderKey) {
  const payload = await adminFetch(`/api/admin/orders/${encodeURIComponent(orderKey)}`);
  renderAdminOrder(payload.order);
  return payload.order;
}

async function initAdminOrder() {
  if (!document.body.hasAttribute("data-admin-order-page")) return;

  const orderKey = new URLSearchParams(window.location.search).get("order");
  if (!orderKey) {
    showAdminToast("Не указан номер заказа.", "error");
    return;
  }

  let currentOrder;
  try {
    currentOrder = await loadAdminOrder(orderKey);
  } catch (error) {
    showAdminToast(error.message, "error");
    return;
  }

  const form = document.querySelector("[data-order-status-form]");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;

    const data = new FormData(form);
    const nextStatus = String(data.get("status") || "");
    const reason = String(data.get("reason") || "").trim();

    if (!nextStatus) return;

    if (["COMPLETED", "CANCELLED"].includes(nextStatus)) {
      const label = ADMIN_ORDER_STATUS_LABELS[nextStatus].toLowerCase();
      if (!window.confirm(`Перевести заказ ${currentOrder.number} в статус «${label}»? Складские изменения выполнятся сразу.`)) {
        return;
      }
    }

    const button = document.querySelector("[data-order-status-submit]");
    if (button instanceof HTMLButtonElement) button.disabled = true;

    try {
      const payload = await adminFetch(`/api/admin/orders/${encodeURIComponent(orderKey)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, reason: reason || null }),
      });
      currentOrder = payload.order;
      renderAdminOrder(currentOrder);
      form.reset();
      showAdminToast("Статус заказа обновлён.");
    } catch (error) {
      showAdminToast(error.message, "error");
    } finally {
      if (button instanceof HTMLButtonElement && currentOrder.allowedStatuses.length) button.disabled = false;
    }
  });
}

function inventoryStatus(product) {
  if (!product.tracked) return '<span class="admin-status is-neutral">Без учёта</span>';
  if ((product.availableQuantity ?? 0) <= 0) return '<span class="admin-status is-cancelled">Нет остатка</span>';
  return '<span class="admin-status is-completed">В наличии</span>';
}

function renderInventoryList(products) {
  const body = document.querySelector("[data-inventory-list]");
  if (!body) return;

  if (!products.length) {
    body.innerHTML = '<tr><td colspan="7" class="admin-table__empty">Товары не найдены.</td></tr>';
    return;
  }

  body.innerHTML = products.map((product) => `
    <tr${currentInventoryProductId === product.id ? ' class="is-selected"' : ""}>
      <td><button class="admin-row-button" type="button" data-inventory-product-id="${product.id}"><strong>${escapeAdminHtml(product.name)}</strong><small>${escapeAdminHtml(product.unitLabel || product.unit)}</small></button></td>
      <td>${escapeAdminHtml(product.sku)}</td>
      <td><strong>${escapeAdminHtml(formatAdminQuantity(product.stockQuantity))}</strong></td>
      <td>${escapeAdminHtml(formatAdminQuantity(product.reservedQuantity))}</td>
      <td><strong>${escapeAdminHtml(formatAdminQuantity(product.availableQuantity))}</strong></td>
      <td>${inventoryStatus(product)}</td>
      <td>${escapeAdminHtml(formatAdminDate(product.updatedAt))}</td>
    </tr>
  `).join("");

  body.querySelectorAll("[data-inventory-product-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const productId = Number(button.dataset.inventoryProductId);
      if (Number.isInteger(productId)) void loadInventoryDetail(productId);
    });
  });
}

function renderInventoryMovements(movements) {
  const body = document.querySelector("[data-inventory-movements]");
  if (!body) return;

  if (!movements.length) {
    body.innerHTML = '<tr><td colspan="7" class="admin-table__empty">Движений пока нет.</td></tr>';
    return;
  }

  body.innerHTML = movements.map((movement) => {
    const fact = Number(movement.onHandDelta || 0);
    const reserve = Number(movement.reservedDelta || 0);
    return `
      <tr>
        <td>${escapeAdminHtml(formatAdminDate(movement.createdAt))}</td>
        <td><strong>${escapeAdminHtml(movement.product?.name || `#${movement.productId}`)}</strong><small>${escapeAdminHtml(movement.product?.sku || "")}</small></td>
        <td>${escapeAdminHtml(ADMIN_MOVEMENT_LABELS[movement.type] || movement.type)}</td>
        <td class="${fact > 0 ? "is-positive" : fact < 0 ? "is-negative" : ""}">${fact > 0 ? "+" : ""}${escapeAdminHtml(formatAdminQuantity(fact))}</td>
        <td class="${reserve > 0 ? "is-warning" : reserve < 0 ? "is-positive" : ""}">${reserve > 0 ? "+" : ""}${escapeAdminHtml(formatAdminQuantity(reserve))}</td>
        <td>${escapeAdminHtml(formatAdminQuantity(movement.balanceOnHand))} / ${escapeAdminHtml(formatAdminQuantity(movement.balanceReserved))}</td>
        <td>${escapeAdminHtml(movement.reason || "—")}${movement.order?.number ? `<small>Заказ ${escapeAdminHtml(movement.order.number)}</small>` : ""}</td>
      </tr>
    `;
  }).join("");
}

function renderInventoryDetail(product) {
  currentInventoryProductId = product.id;

  const section = document.querySelector("[data-inventory-detail-section]");
  const title = document.querySelector("[data-inventory-product-name]");
  const balances = document.querySelector("[data-inventory-balances]");
  const reservations = document.querySelector("[data-inventory-reservations]");

  if (section) section.hidden = false;
  if (title) title.textContent = product.name;

  if (balances) {
    balances.innerHTML = `
      <div><span>Фактический</span><strong>${escapeAdminHtml(formatAdminQuantity(product.stockQuantity))}</strong></div>
      <div><span>Резерв</span><strong>${escapeAdminHtml(formatAdminQuantity(product.reservedQuantity))}</strong></div>
      <div><span>Доступно</span><strong>${escapeAdminHtml(formatAdminQuantity(product.availableQuantity))}</strong></div>
      <div><span>SKU</span><strong>${escapeAdminHtml(product.sku)}</strong></div>
    `;
  }

  if (reservations) {
    reservations.innerHTML = product.activeReservations.length
      ? `<h3>Активные резервы</h3>${product.activeReservations.map((reservation) => `
          <div>
            <span>Заказ ${escapeAdminHtml(reservation.order?.number || `#${reservation.orderId}`)}</span>
            <strong>${escapeAdminHtml(formatAdminQuantity(reservation.quantity))}</strong>
            <span>${escapeAdminHtml(formatAdminDate(reservation.createdAt))}</span>
          </div>
        `).join("")}`
      : '<p class="admin-muted">Активных резервов по товару нет.</p>';
  }

  const form = document.querySelector("[data-inventory-action-form]");
  if (form instanceof HTMLFormElement) {
    form.reset();
    const quantityInput = form.elements.namedItem("quantity");
    if (quantityInput instanceof HTMLInputElement && !product.tracked) {
      quantityInput.value = "0";
    }
  }

  document.querySelectorAll("[data-inventory-product-id]").forEach((button) => {
    button.closest("tr")?.classList.toggle("is-selected", Number(button.dataset.inventoryProductId) === product.id);
  });
}

async function loadInventoryList() {
  const form = document.querySelector("[data-inventory-filter]");
  const qField = form instanceof HTMLFormElement ? form.elements.namedItem("q") : null;
  const q = qField instanceof HTMLInputElement ? qField.value.trim() : "";
  const query = new URLSearchParams({ limit: "250" });
  if (q) query.set("q", q);

  const payload = await adminFetch(`/api/admin/inventory?${query.toString()}`);
  renderInventoryList(payload.inventory);
}

async function loadInventoryMovements() {
  const payload = await adminFetch("/api/admin/inventory/movements?limit=100");
  renderInventoryMovements(payload.movements);
}

async function loadInventoryDetail(productId) {
  try {
    const payload = await adminFetch(`/api/admin/inventory/products/${productId}`);
    renderInventoryDetail(payload.inventory);
  } catch (error) {
    showAdminToast(error.message, "error");
  }
}

function updateInventoryActionLabel() {
  const select = document.querySelector("[data-inventory-action]");
  const label = document.querySelector("[data-inventory-quantity-label]");
  if (!(select instanceof HTMLSelectElement) || !label) return;
  label.textContent = select.value === "adjustment" ? "Новый фактический остаток" : "Количество";
}

async function initAdminWarehouse() {
  if (document.body.dataset.adminPage !== "warehouse") return;

  const filter = document.querySelector("[data-inventory-filter]");
  const reset = document.querySelector("[data-inventory-reset]");
  const close = document.querySelector("[data-inventory-close]");
  const action = document.querySelector("[data-inventory-action]");
  const actionForm = document.querySelector("[data-inventory-action-form]");

  filter?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await loadInventoryList();
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  });

  reset?.addEventListener("click", async () => {
    if (filter instanceof HTMLFormElement) filter.reset();
    try {
      await loadInventoryList();
    } catch (error) {
      showAdminToast(error.message, "error");
    }
  });

  close?.addEventListener("click", () => {
    currentInventoryProductId = null;
    const section = document.querySelector("[data-inventory-detail-section]");
    if (section) section.hidden = true;
    document.querySelectorAll("[data-inventory-product-id]").forEach((button) => button.closest("tr")?.classList.remove("is-selected"));
  });

  action?.addEventListener("change", updateInventoryActionLabel);
  updateInventoryActionLabel();

  actionForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(actionForm instanceof HTMLFormElement) || !currentInventoryProductId) {
      showAdminToast("Сначала выберите товар.", "error");
      return;
    }

    const data = new FormData(actionForm);
    const actionName = String(data.get("action") || "receipt");
    const quantity = Number(data.get("quantity"));
    const reason = String(data.get("reason") || "").trim();

    if (!Number.isFinite(quantity) || quantity < 0 || reason.length < 3) {
      showAdminToast("Проверьте количество и основание операции.", "error");
      return;
    }

    if (actionName !== "adjustment" && quantity <= 0) {
      showAdminToast("Количество должно быть больше нуля.", "error");
      return;
    }

    if (actionName === "adjustment" && currentAdminUser?.role !== "OWNER") {
      showAdminToast("Ручная корректировка доступна только OWNER.", "error");
      return;
    }

    const submit = document.querySelector("[data-inventory-submit]");
    if (submit instanceof HTMLButtonElement) submit.disabled = true;

    try {
      const endpoint = actionName === "adjustment"
        ? `/api/admin/inventory/products/${currentInventoryProductId}/stock`
        : `/api/admin/inventory/products/${currentInventoryProductId}/${actionName}`;
      const method = actionName === "adjustment" ? "PATCH" : "POST";
      const body = actionName === "adjustment"
        ? { stockQuantity: quantity, reason }
        : { quantity, reason };

      await adminFetch(endpoint, { method, body: JSON.stringify(body) });
      await Promise.all([
        loadInventoryList(),
        loadInventoryMovements(),
        loadInventoryDetail(currentInventoryProductId),
      ]);
      showAdminToast("Складская операция проведена.");
    } catch (error) {
      showAdminToast(error.message, "error");
    } finally {
      if (submit instanceof HTMLButtonElement) submit.disabled = false;
    }
  });

  try {
    await Promise.all([loadInventoryList(), loadInventoryMovements()]);
  } catch (error) {
    showAdminToast(error.message, "error");
  }
}


const ADMIN_PRODUCT_UNIT_LABELS = Object.freeze({
  PIECE: "шт.",
  KILOGRAM: "кг",
  GRAM: "г",
  LITER: "л",
  MILLILITER: "мл",
  PACKAGE: "упак.",
});

let adminCatalogCategories = [];
let currentAdminProduct = null;
let productSlugTouched = false;
let categorySlugTouched = false;

function slugifyAdmin(value) {
  const translit = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };

  return String(value || "")
    .toLowerCase()
    .split("")
    .map((char) => translit[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 191);
}

async function fetchAdminCatalogCategories() {
  const payload = await adminFetch("/api/admin/catalog/categories?includeInactive=true");
  adminCatalogCategories = Array.isArray(payload.categories) ? payload.categories : [];
  return adminCatalogCategories;
}

function fillAdminCategorySelect(select, { includeAll = false, selected = "" } = {}) {
  if (!(select instanceof HTMLSelectElement)) return;

  const first = includeAll
    ? '<option value="">Все категории</option>'
    : '<option value="">Выберите категорию</option>';

  select.innerHTML = first + adminCatalogCategories
    .map((category) => `<option value="${category.id}"${String(category.id) === String(selected) ? " selected" : ""}>${escapeAdminHtml(category.name)}${category.isActive ? "" : " · скрыта"}</option>`)
    .join("");
}

function productVisibilityMarkup(product) {
  if (!product.isActive) return '<span class="admin-status is-cancelled">Скрыт</span>';
  if (!product.isAvailable) return '<span class="admin-status is-neutral">Недоступен</span>';
  return '<span class="admin-status is-completed">Опубликован</span>';
}

function getProductsQueryState() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q") || "",
    categoryId: params.get("categoryId") || "",
    visibility: params.get("visibility") || "all",
    page: Math.max(1, Number(params.get("page") || 1) || 1),
  };
}

function syncProductsForm(state) {
  const form = document.querySelector("[data-products-filter]");
  if (!(form instanceof HTMLFormElement)) return;
  const q = form.elements.namedItem("q");
  const category = form.elements.namedItem("categoryId");
  const visibility = form.elements.namedItem("visibility");
  if (q instanceof HTMLInputElement) q.value = state.q;
  if (category instanceof HTMLSelectElement) category.value = state.categoryId;
  if (visibility instanceof HTMLSelectElement) visibility.value = state.visibility;
}

function renderAdminProducts(products) {
  const body = document.querySelector("[data-products-list]");
  if (!body) return;

  if (!products.length) {
    body.innerHTML = '<tr><td colspan="8" class="admin-table__empty">По выбранным условиям товаров нет.</td></tr>';
    return;
  }

  body.innerHTML = products.map((product) => {
    const image = product.images?.[0]?.url;
    return `
      <tr>
        <td>
          <a class="admin-product-cell" href="/admin/product-edit?id=${product.id}">
            ${image ? `<img src="${escapeAdminHtml(image)}" alt="" loading="lazy" />` : '<span class="admin-product-cell__placeholder">Фото</span>'}
            <span><strong>${escapeAdminHtml(product.name)}</strong><small>${escapeAdminHtml(product.sku)} · ${escapeAdminHtml(product.slug)}</small></span>
          </a>
        </td>
        <td>${escapeAdminHtml(product.category?.name || "—")}</td>
        <td><strong>${escapeAdminHtml(formatAdminMoney(product.price))}</strong>${product.oldPrice ? `<small>${escapeAdminHtml(formatAdminMoney(product.oldPrice))}</small>` : ""}</td>
        <td>${escapeAdminHtml(formatAdminQuantity(product.stockQuantity))}</td>
        <td>${escapeAdminHtml(formatAdminQuantity(product.reservedQuantity))}</td>
        <td><strong>${escapeAdminHtml(formatAdminQuantity(product.availableQuantity))}</strong></td>
        <td>${productVisibilityMarkup(product)}</td>
        <td>${escapeAdminHtml(formatAdminDate(product.updatedAt))}</td>
      </tr>`;
  }).join("");
}

function renderProductsPagination(pagination, state) {
  const container = document.querySelector("[data-products-pagination]");
  if (!container) return;

  if (pagination.pages <= 1) {
    container.innerHTML = `<span>${escapeAdminHtml(String(pagination.total))} товаров</span>`;
    return;
  }

  const makeHref = (page) => {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.categoryId) params.set("categoryId", state.categoryId);
    if (state.visibility && state.visibility !== "all") params.set("visibility", state.visibility);
    params.set("page", String(page));
    return `/admin/products?${params.toString()}`;
  };

  container.innerHTML = `
    <span>${escapeAdminHtml(String(pagination.total))} товаров</span>
    <div>
      ${pagination.page > 1 ? `<a class="admin-pagination__button" href="${makeHref(pagination.page - 1)}">Назад</a>` : ""}
      <span class="admin-pagination__current">${pagination.page} / ${pagination.pages}</span>
      ${pagination.page < pagination.pages ? `<a class="admin-pagination__button" href="${makeHref(pagination.page + 1)}">Далее</a>` : ""}
    </div>`;
}

async function loadAdminProducts() {
  const state = getProductsQueryState();
  syncProductsForm(state);
  const query = new URLSearchParams({ page: String(state.page), limit: "30", visibility: state.visibility });
  if (state.q) query.set("q", state.q);
  if (state.categoryId) query.set("categoryId", state.categoryId);
  const payload = await adminFetch(`/api/admin/catalog/products?${query.toString()}`);
  renderAdminProducts(payload.products || []);
  renderProductsPagination(payload.pagination, state);
}

async function initAdminProducts() {
  if (document.body.dataset.adminPage !== "products" || document.body.hasAttribute("data-admin-product-editor")) return;

  const form = document.querySelector("[data-products-filter]");
  const reset = document.querySelector("[data-products-reset]");
  try {
    await fetchAdminCatalogCategories();
    fillAdminCategorySelect(document.querySelector("[data-product-category-filter]"), { includeAll: true });
    await loadAdminProducts();
  } catch (error) {
    showAdminToast(error.message, "error");
  }

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    const params = new URLSearchParams();
    const q = String(data.get("q") || "").trim();
    const categoryId = String(data.get("categoryId") || "");
    const visibility = String(data.get("visibility") || "all");
    if (q) params.set("q", q);
    if (categoryId) params.set("categoryId", categoryId);
    if (visibility !== "all") params.set("visibility", visibility);
    window.location.assign(`/admin/products${params.size ? `?${params.toString()}` : ""}`);
  });

  reset?.addEventListener("click", () => window.location.assign("/admin/products"));
}

function setProductField(form, name, value) {
  const field = form.elements.namedItem(name);
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value === null || value === undefined ? "" : String(value);
    }
  }
}

function prettyJson(value) {
  if (!value || (typeof value === "object" && Object.keys(value).length === 0)) return "";
  try { return JSON.stringify(value, null, 2); } catch { return ""; }
}

function renderProductInventory(product) {
  document.querySelector("[data-product-stock]")?.replaceChildren(document.createTextNode(formatAdminQuantity(product?.stockQuantity ?? 0)));
  document.querySelector("[data-product-reserved]")?.replaceChildren(document.createTextNode(formatAdminQuantity(product?.reservedQuantity ?? 0)));
  document.querySelector("[data-product-available]")?.replaceChildren(document.createTextNode(formatAdminQuantity(product?.availableQuantity ?? 0)));
  const input = document.querySelector("[data-product-stock-input]");
  if (input instanceof HTMLInputElement) {
    input.value = String(product?.stockQuantity ?? 0);
    input.disabled = currentAdminUser?.role !== "OWNER";
  }
  const note = document.querySelector("[data-product-stock-note]");
  if (note && currentAdminUser?.role !== "OWNER") {
    note.textContent = "Остаток доступен для просмотра. Ручная корректировка разрешена только OWNER.";
  }
}

function renderProductImages(product) {
  const container = document.querySelector("[data-product-images]");
  const form = document.querySelector("[data-product-images-form]");
  const note = document.querySelector("[data-product-images-note]");
  if (!container) return;

  if (!product?.id) {
    container.innerHTML = "";
    if (form instanceof HTMLFormElement) form.hidden = true;
    if (note) note.hidden = false;
    return;
  }

  if (form instanceof HTMLFormElement) form.hidden = false;
  if (note) note.hidden = true;

  const images = Array.isArray(product.images) ? product.images : [];
  if (!images.length) {
    container.innerHTML = '<p class="admin-muted">Изображений пока нет.</p>';
    return;
  }

  container.innerHTML = images.map((image, index) => `
    <article class="admin-image-card" data-product-image-id="${image.id}">
      <div class="admin-image-card__media"><img src="${escapeAdminHtml(image.url)}" alt="${escapeAdminHtml(image.alt || product.name)}" loading="lazy" />${image.isPrimary ? '<span class="admin-image-card__primary">Главное</span>' : ""}</div>
      <label class="admin-field"><span>Alt</span><input type="text" maxlength="255" value="${escapeAdminHtml(image.alt || "")}" data-image-alt /></label>
      <div class="admin-image-card__actions">
        <button class="admin-icon-button" type="button" data-image-save-alt>Alt</button>
        ${image.isPrimary ? "" : '<button class="admin-icon-button" type="button" data-image-primary>Главное</button>'}
        <button class="admin-icon-button" type="button" data-image-left ${index === 0 ? "disabled" : ""}>Левее</button>
        <button class="admin-icon-button" type="button" data-image-right ${index === images.length - 1 ? "disabled" : ""}>Правее</button>
        <button class="admin-icon-button admin-icon-button--danger" type="button" data-image-delete>Удалить</button>
      </div>
    </article>`).join("");

  container.querySelectorAll("[data-product-image-id]").forEach((card) => {
    const imageId = Number(card.dataset.productImageId);
    card.querySelector("[data-image-save-alt]")?.addEventListener("click", async () => {
      const input = card.querySelector("[data-image-alt]");
      try {
        await adminFetch(`/api/admin/catalog/products/${product.id}/images/${imageId}`, {
          method: "PATCH",
          body: JSON.stringify({ alt: input instanceof HTMLInputElement ? input.value.trim() || null : null }),
        });
        showAdminToast("Alt-текст сохранён.");
      } catch (error) { showAdminToast(error.message, "error"); }
    });

    card.querySelector("[data-image-primary]")?.addEventListener("click", async () => {
      try {
        await adminFetch(`/api/admin/catalog/products/${product.id}/images/${imageId}`, {
          method: "PATCH",
          body: JSON.stringify({ isPrimary: true }),
        });
        await refreshProductMedia(product.id);
        showAdminToast("Главное изображение изменено.");
      } catch (error) { showAdminToast(error.message, "error"); }
    });

    const moveImage = async (direction) => {
      const ids = images.map((item) => item.id);
      const from = ids.indexOf(imageId);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= ids.length) return;
      [ids[from], ids[to]] = [ids[to], ids[from]];
      try {
        await adminFetch(`/api/admin/catalog/products/${product.id}/images/order`, {
          method: "PUT",
          body: JSON.stringify({ imageIds: ids }),
        });
        await refreshProductMedia(product.id);
      } catch (error) { showAdminToast(error.message, "error"); }
    };

    card.querySelector("[data-image-left]")?.addEventListener("click", () => void moveImage(-1));
    card.querySelector("[data-image-right]")?.addEventListener("click", () => void moveImage(1));
    card.querySelector("[data-image-delete]")?.addEventListener("click", async () => {
      if (!window.confirm("Удалить это изображение?")) return;
      try {
        await adminFetch(`/api/admin/catalog/products/${product.id}/images/${imageId}`, { method: "DELETE" });
        await refreshProductMedia(product.id);
        showAdminToast("Изображение удалено.");
      } catch (error) { showAdminToast(error.message, "error"); }
    });
  });
}

function hydrateProductForm(product) {
  const form = document.querySelector("[data-product-form]");
  if (!(form instanceof HTMLFormElement)) return;

  const values = {
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    categoryId: product.categoryId,
    shortDescription: product.shortDescription,
    description: product.description,
    price: product.price,
    oldPrice: product.oldPrice,
    unit: product.unit,
    unitLabel: product.unitLabel,
    step: product.step,
    minQuantity: product.minQuantity,
    sortOrder: product.sortOrder,
    isActive: product.isActive,
    isAvailable: product.isAvailable,
    isPopular: product.isPopular,
    isFeatured: product.isFeatured,
    isNew: product.isNew,
    seoTitle: product.seoTitle,
    seoDescription: product.seoDescription,
    highlights: Array.isArray(product.highlights) ? product.highlights.join("\n") : "",
    characteristics: prettyJson(product.characteristics),
    nutrition: prettyJson(product.nutrition),
  };
  Object.entries(values).forEach(([name, value]) => setProductField(form, name, value));
  productSlugTouched = true;

  const title = document.querySelector("[data-product-editor-title]");
  const lead = document.querySelector("[data-product-editor-lead]");
  if (title) title.textContent = product.name;
  if (lead) lead.textContent = `${product.sku} · ${product.category?.name || "Без категории"}`;
  document.title = `${product.name} — Сибирские Деликатесы`;
  renderProductInventory(product);
  renderProductImages(product);
}

async function reloadProductEditor(productId) {
  const payload = await adminFetch(`/api/admin/catalog/products/${productId}`);
  currentAdminProduct = payload.product;
  hydrateProductForm(currentAdminProduct);
  return currentAdminProduct;
}

async function refreshProductMedia(productId) {
  const payload = await adminFetch(`/api/admin/catalog/products/${productId}`);
  currentAdminProduct = payload.product;
  renderProductImages(currentAdminProduct);
  return currentAdminProduct;
}

function parseJsonField(form, name, fallback) {
  const field = form.elements.namedItem(name);
  const raw = field instanceof HTMLTextAreaElement ? field.value.trim() : "";
  if (!raw) return fallback;
  try { return JSON.parse(raw); }
  catch { throw new Error(`Поле «${name === "characteristics" ? "Характеристики" : "Пищевая ценность"}» содержит некорректный JSON.`); }
}

function buildProductPayload(form) {
  const data = new FormData(form);
  const price = Number(data.get("price"));
  const oldPriceRaw = String(data.get("oldPrice") || "").trim();
  const highlights = String(data.get("highlights") || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

  return {
    categoryId: Number(data.get("categoryId")),
    name: String(data.get("name") || "").trim(),
    slug: String(data.get("slug") || "").trim().toLowerCase(),
    sku: String(data.get("sku") || "").trim().toUpperCase(),
    shortDescription: String(data.get("shortDescription") || "").trim() || null,
    description: String(data.get("description") || "").trim() || null,
    unit: String(data.get("unit") || "PIECE"),
    unitLabel: String(data.get("unitLabel") || "").trim() || null,
    highlights,
    characteristics: parseJsonField(form, "characteristics", {}),
    nutrition: parseJsonField(form, "nutrition", {}),
    price,
    oldPrice: oldPriceRaw ? Number(oldPriceRaw) : null,
    step: Number(data.get("step")),
    minQuantity: Number(data.get("minQuantity")),
    isActive: data.get("isActive") === "on",
    isAvailable: data.get("isAvailable") === "on",
    isPopular: data.get("isPopular") === "on",
    isFeatured: data.get("isFeatured") === "on",
    isNew: data.get("isNew") === "on",
    sortOrder: Number(data.get("sortOrder") || 0),
    seoTitle: String(data.get("seoTitle") || "").trim() || null,
    seoDescription: String(data.get("seoDescription") || "").trim() || null,
  };
}

async function initAdminProductEditor() {
  if (!document.body.hasAttribute("data-admin-product-editor")) return;
  const form = document.querySelector("[data-product-form]");
  const imageForm = document.querySelector("[data-product-images-form]");
  if (!(form instanceof HTMLFormElement)) return;

  const productId = Number(new URLSearchParams(window.location.search).get("id"));
  try {
    await fetchAdminCatalogCategories();
    fillAdminCategorySelect(document.querySelector("[data-product-category]"));

    if (Number.isInteger(productId) && productId > 0) {
      await reloadProductEditor(productId);
    } else {
      currentAdminProduct = null;
      renderProductInventory({ stockQuantity: 0, reservedQuantity: 0, availableQuantity: 0 });
      renderProductImages(null);
    }
  } catch (error) {
    showAdminToast(error.message, "error");
  }

  const nameInput = form.elements.namedItem("name");
  const slugInput = form.elements.namedItem("slug");
  if (slugInput instanceof HTMLInputElement) {
    slugInput.addEventListener("input", () => { productSlugTouched = slugInput.value.trim().length > 0; });
  }
  if (nameInput instanceof HTMLInputElement && slugInput instanceof HTMLInputElement) {
    nameInput.addEventListener("input", () => {
      if (!productSlugTouched) slugInput.value = slugifyAdmin(nameInput.value);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const save = document.querySelector("[data-product-save]");
    if (save instanceof HTMLButtonElement) save.disabled = true;

    try {
      const payload = buildProductPayload(form);
      const stockInput = form.elements.namedItem("stockQuantity");
      const requestedStock = stockInput instanceof HTMLInputElement ? Number(stockInput.value) : null;
      const existingStock = Number(currentAdminProduct?.stockQuantity ?? 0);
      const endpoint = currentAdminProduct?.id
        ? `/api/admin/catalog/products/${currentAdminProduct.id}`
        : "/api/admin/catalog/products";
      const method = currentAdminProduct?.id ? "PATCH" : "POST";
      const result = await adminFetch(endpoint, { method, body: JSON.stringify(payload) });
      const saved = result.product;
      let stockError = null;

      if (
        currentAdminUser?.role === "OWNER" &&
        Number.isFinite(requestedStock) &&
        requestedStock >= 0 &&
        Math.abs(requestedStock - existingStock) > 0.0005
      ) {
        try {
          await adminFetch(`/api/admin/inventory/products/${saved.id}/stock`, {
            method: "PATCH",
            body: JSON.stringify({ stockQuantity: requestedStock, reason: "Корректировка остатка из CMS товара" }),
          });
        } catch (error) {
          stockError = error;
        }
      }

      await reloadProductEditor(saved.id);
      window.history.replaceState({}, "", `/admin/product-edit?id=${saved.id}`);
      if (stockError) {
        showAdminToast(`Товар сохранён, но остаток не изменён: ${stockError.message}`, "error");
      } else {
        showAdminToast("Товар сохранён.");
      }
    } catch (error) {
      showAdminToast(error.message, "error");
    } finally {
      if (save instanceof HTMLButtonElement) save.disabled = false;
    }
  });

  imageForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(imageForm instanceof HTMLFormElement) || !currentAdminProduct?.id) return;
    const input = imageForm.querySelector("[data-product-images-input]");
    if (!(input instanceof HTMLInputElement) || !input.files?.length) {
      showAdminToast("Выберите изображения.", "error");
      return;
    }
    const body = new FormData();
    Array.from(input.files).forEach((file) => body.append("images", file));
    const button = imageForm.querySelector("button[type=submit]");
    if (button instanceof HTMLButtonElement) button.disabled = true;
    try {
      await adminFetch(`/api/admin/catalog/products/${currentAdminProduct.id}/images`, { method: "POST", body });
      input.value = "";
      await refreshProductMedia(currentAdminProduct.id);
      showAdminToast("Изображения загружены.");
    } catch (error) {
      showAdminToast(error.message, "error");
    } finally {
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  });
}

function resetCategoryForm() {
  const form = document.querySelector("[data-category-form]");
  if (!(form instanceof HTMLFormElement)) return;
  form.reset();
  setProductField(form, "id", "");
  setProductField(form, "sortOrder", 0);
  const active = form.elements.namedItem("isActive");
  if (active instanceof HTMLInputElement) active.checked = true;
  const title = document.querySelector("[data-category-form-title]");
  if (title) title.textContent = "Новая категория";
  categorySlugTouched = false;
}

function renderAdminCategories(categories) {
  const body = document.querySelector("[data-categories-list]");
  if (!body) return;
  if (!categories.length) {
    body.innerHTML = '<tr><td colspan="5" class="admin-table__empty">Категорий пока нет.</td></tr>';
    return;
  }

  body.innerHTML = categories.map((category) => `
    <tr>
      <td><strong>${escapeAdminHtml(category.name)}</strong><small>${escapeAdminHtml(category.slug)}</small></td>
      <td>${escapeAdminHtml(String(category.productsCount ?? 0))}</td>
      <td>${escapeAdminHtml(String(category.sortOrder ?? 0))}</td>
      <td>${category.isActive ? '<span class="admin-status is-completed">Активна</span>' : '<span class="admin-status is-cancelled">Скрыта</span>'}</td>
      <td><div class="admin-table-actions"><button class="admin-icon-button" type="button" data-category-edit="${category.id}">Изменить</button>${currentAdminUser?.role === "OWNER" ? `<button class="admin-icon-button admin-icon-button--danger" type="button" data-category-delete="${category.id}">${category.productsCount > 0 ? "Деактивировать" : "Удалить"}</button>` : ""}</div></td>
    </tr>`).join("");

  body.querySelectorAll("[data-category-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const category = adminCatalogCategories.find((item) => item.id === Number(button.dataset.categoryEdit));
      const form = document.querySelector("[data-category-form]");
      if (!category || !(form instanceof HTMLFormElement)) return;
      ["id", "name", "slug", "description", "imageUrl", "sortOrder", "isActive", "isFeatured"].forEach((name) => setProductField(form, name, category[name]));
      categorySlugTouched = true;
      const title = document.querySelector("[data-category-form-title]");
      if (title) title.textContent = `Редактирование: ${category.name}`;
      form.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  body.querySelectorAll("[data-category-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const category = adminCatalogCategories.find((item) => item.id === Number(button.dataset.categoryDelete));
      if (!category) return;
      const message = category.productsCount > 0
        ? `В категории «${category.name}» есть товары. Категория будет деактивирована, товары сохранятся. Продолжить?`
        : `Удалить пустую категорию «${category.name}»?`;
      if (!window.confirm(message)) return;
      try {
        const result = await adminFetch(`/api/admin/catalog/categories/${category.id}`, { method: "DELETE" });
        showAdminToast(result.mode === "deleted" ? "Категория удалена." : "Категория деактивирована.");
        await loadAdminCategoriesPage();
        resetCategoryForm();
      } catch (error) { showAdminToast(error.message, "error"); }
    });
  });
}

async function loadAdminCategoriesPage() {
  await fetchAdminCatalogCategories();
  renderAdminCategories(adminCatalogCategories);
}

async function initAdminCategories() {
  if (document.body.dataset.adminPage !== "categories") return;
  const form = document.querySelector("[data-category-form]");
  const reset = document.querySelector("[data-category-reset]");
  if (!(form instanceof HTMLFormElement)) return;

  try { await loadAdminCategoriesPage(); }
  catch (error) { showAdminToast(error.message, "error"); }

  const nameInput = form.elements.namedItem("name");
  const slugInput = form.elements.namedItem("slug");
  if (slugInput instanceof HTMLInputElement) {
    slugInput.addEventListener("input", () => { categorySlugTouched = slugInput.value.trim().length > 0; });
  }
  if (nameInput instanceof HTMLInputElement && slugInput instanceof HTMLInputElement) {
    nameInput.addEventListener("input", () => {
      if (!categorySlugTouched) slugInput.value = slugifyAdmin(nameInput.value);
    });
  }
  reset?.addEventListener("click", resetCategoryForm);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const id = Number(data.get("id"));
    const payload = {
      name: String(data.get("name") || "").trim(),
      slug: String(data.get("slug") || "").trim().toLowerCase(),
      description: String(data.get("description") || "").trim() || null,
      imageUrl: String(data.get("imageUrl") || "").trim() || null,
      isActive: data.get("isActive") === "on",
      sortOrder: Number(data.get("sortOrder") || 0),
      isFeatured: data.get("isFeatured") === "on",
    };
    const save = document.querySelector("[data-category-save]");
    if (save instanceof HTMLButtonElement) save.disabled = true;
    try {
      await adminFetch(Number.isInteger(id) && id > 0 ? `/api/admin/catalog/categories/${id}` : "/api/admin/catalog/categories", {
        method: Number.isInteger(id) && id > 0 ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      showAdminToast(Number.isInteger(id) && id > 0 ? "Категория обновлена." : "Категория создана.");
      resetCategoryForm();
      await loadAdminCategoriesPage();
    } catch (error) {
      showAdminToast(error.message, "error");
    } finally {
      if (save instanceof HTMLButtonElement) save.disabled = false;
    }
  });
}



function customerAccountStatusMarkup(customer) {
  return customer.isActive
    ? '<span class="admin-status is-completed">Активен</span>'
    : '<span class="admin-status is-cancelled">Отключён</span>';
}

function getCustomersQueryState() {
  const params = new URLSearchParams(window.location.search);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const status = ["active", "inactive"].includes(params.get("status")) ? params.get("status") : "all";
  const purchase = ["buyers", "no-orders"].includes(params.get("purchase")) ? params.get("purchase") : "all";
  return {
    q: String(params.get("q") || "").trim(),
    status,
    purchase,
    page,
  };
}

function syncCustomersForm(state) {
  const form = document.querySelector("[data-customers-filter]");
  if (!(form instanceof HTMLFormElement)) return;
  const q = form.elements.namedItem("q");
  const status = form.elements.namedItem("status");
  const purchase = form.elements.namedItem("purchase");
  if (q instanceof HTMLInputElement) q.value = state.q;
  if (status instanceof HTMLSelectElement) status.value = state.status;
  if (purchase instanceof HTMLSelectElement) purchase.value = state.purchase;
}

function renderCustomersMetrics(metrics) {
  document.querySelectorAll("[data-customers-metric]").forEach((element) => {
    const key = element.dataset.customersMetric;
    element.textContent = String(metrics?.[key] ?? "—");
  });
}

function renderCustomersList(customers) {
  const body = document.querySelector("[data-customers-list]");
  if (!body) return;

  if (!customers.length) {
    body.innerHTML = '<tr><td colspan="8" class="admin-table__empty">По выбранным условиям клиентов нет.</td></tr>';
    return;
  }

  body.innerHTML = customers.map((customer) => `
    <tr>
      <td><a class="admin-table__primary" href="/admin/customer?id=${encodeURIComponent(customer.id)}">${escapeAdminHtml(customer.name)}</a><small>ID ${escapeAdminHtml(String(customer.id))}</small></td>
      <td><strong>${escapeAdminHtml(customer.phone || "—")}</strong><small>${escapeAdminHtml(customer.email || "Без email")}</small></td>
      <td><strong>${escapeAdminHtml(String(customer.ordersCount))}</strong>${customer.activeOrdersCount ? `<small>${escapeAdminHtml(String(customer.activeOrdersCount))} в работе</small>` : ""}</td>
      <td>${escapeAdminHtml(String(customer.completedOrdersCount))}</td>
      <td><strong>${escapeAdminHtml(formatAdminMoney(customer.lifetimeValue))}</strong></td>
      <td>${escapeAdminHtml(formatAdminDate(customer.lastOrderAt))}</td>
      <td>${customerAccountStatusMarkup(customer)}</td>
      <td>${escapeAdminHtml(formatAdminDate(customer.createdAt, false))}</td>
    </tr>`).join("");
}

function renderCustomersPagination(pagination, state) {
  const container = document.querySelector("[data-customers-pagination]");
  if (!container) return;

  if (pagination.pages <= 1) {
    container.innerHTML = `<span>${escapeAdminHtml(String(pagination.total))} клиентов</span>`;
    return;
  }

  const makeHref = (page) => {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.status !== "all") params.set("status", state.status);
    if (state.purchase !== "all") params.set("purchase", state.purchase);
    params.set("page", String(page));
    return `/admin/customers?${params.toString()}`;
  };

  container.innerHTML = `
    <span>${escapeAdminHtml(String(pagination.total))} клиентов</span>
    <div>
      ${pagination.page > 1 ? `<a class="admin-pagination__button" href="${makeHref(pagination.page - 1)}">Назад</a>` : ""}
      <span class="admin-pagination__current">${pagination.page} / ${pagination.pages}</span>
      ${pagination.page < pagination.pages ? `<a class="admin-pagination__button" href="${makeHref(pagination.page + 1)}">Далее</a>` : ""}
    </div>`;
}

async function loadAdminCustomers() {
  const state = getCustomersQueryState();
  syncCustomersForm(state);
  const params = new URLSearchParams({ page: String(state.page), limit: "30", status: state.status, purchase: state.purchase });
  if (state.q) params.set("q", state.q);
  const payload = await adminFetch(`/api/admin/customers?${params.toString()}`);
  const result = payload.customers;
  renderCustomersMetrics(result.metrics);
  renderCustomersList(result.items || []);
  renderCustomersPagination(result.pagination, state);
}

async function initAdminCustomers() {
  if (document.body.dataset.adminPage !== "customers" || document.body.hasAttribute("data-admin-customer-detail")) return;

  try {
    await loadAdminCustomers();
  } catch (error) {
    showAdminToast(error.message, "error");
  }

  const form = document.querySelector("[data-customers-filter]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    const params = new URLSearchParams();
    const q = String(data.get("q") || "").trim();
    const status = String(data.get("status") || "all");
    const purchase = String(data.get("purchase") || "all");
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    if (purchase !== "all") params.set("purchase", purchase);
    window.location.assign(`/admin/customers${params.size ? `?${params.toString()}` : ""}`);
  });

  document.querySelector("[data-customers-reset]")?.addEventListener("click", () => {
    window.location.assign("/admin/customers");
  });
}

function customerActorName(actor) {
  if (!actor) return "Система";
  return [actor.firstName, actor.lastName].filter(Boolean).join(" ") || actor.email || "Сотрудник";
}

function renderCustomerProfile(customer) {
  const title = document.querySelector("[data-customer-title]");
  const subtitle = document.querySelector("[data-customer-subtitle]");
  if (title) title.textContent = customer.name;
  if (subtitle) subtitle.textContent = [customer.phone, customer.email].filter(Boolean).join(" · ") || `Клиент #${customer.id}`;

  document.querySelectorAll("[data-customer-metric]").forEach((element) => {
    const key = element.dataset.customerMetric;
    let value = customer.metrics?.[key];
    if (key === "lifetimeValue") value = formatAdminMoney(value);
    if (key === "lastOrderAt") value = formatAdminDate(value, false);
    element.textContent = String(value ?? "—");
  });

  const status = document.querySelector("[data-customer-status]");
  if (status) status.innerHTML = customerAccountStatusMarkup(customer);

  const profile = document.querySelector("[data-customer-profile]");
  if (profile) {
    profile.innerHTML = `
      <div><dt>ID</dt><dd>${escapeAdminHtml(String(customer.id))}</dd></div>
      <div><dt>Имя</dt><dd>${escapeAdminHtml(customer.name)}</dd></div>
      <div><dt>Телефон</dt><dd>${escapeAdminHtml(customer.phone || "—")}</dd></div>
      <div><dt>Email</dt><dd>${escapeAdminHtml(customer.email || "—")}</dd></div>
      <div><dt>Регистрация</dt><dd>${escapeAdminHtml(formatAdminDate(customer.createdAt))}</dd></div>
      <div><dt>Обновлён</dt><dd>${escapeAdminHtml(formatAdminDate(customer.updatedAt))}</dd></div>
      <div><dt>Завершено</dt><dd>${escapeAdminHtml(String(customer.metrics.completedOrdersCount))}</dd></div>
      <div><dt>Отменено</dt><dd>${escapeAdminHtml(String(customer.metrics.cancelledOrdersCount))}</dd></div>`;
  }

  const security = document.querySelector("[data-customer-security]");
  if (security) {
    security.innerHTML = `
      <div><dt>Статус</dt><dd>${customer.isActive ? "Активен" : "Отключён"}</dd></div>
      <div><dt>Активных сессий</dt><dd>${escapeAdminHtml(String(customer.sessions.activeCount))}</dd></div>
      <div><dt>Последняя активность</dt><dd>${escapeAdminHtml(formatAdminDate(customer.sessions.lastUsedAt))}</dd></div>
      <div><dt>Макс. срок сессии</dt><dd>${escapeAdminHtml(formatAdminDate(customer.sessions.latestExpiryAt))}</dd></div>`;
  }

  const actions = document.querySelector("[data-customer-actions]");
  if (actions) {
    const orderHref = customer.phone ? `/admin/orders?q=${encodeURIComponent(customer.phone)}` : `/admin/orders`;
    actions.innerHTML = `<a class="admin-button admin-button--secondary" href="${orderHref}">Найти заказы</a>`;
    if (currentAdminUser?.role === "OWNER") {
      actions.insertAdjacentHTML("beforeend", `<button class="admin-button ${customer.isActive ? "admin-button--danger" : ""}" type="button" data-customer-toggle-status>${customer.isActive ? "Отключить аккаунт" : "Восстановить аккаунт"}</button>`);
    }
  }
}

function renderCustomerAddresses(customer) {
  const container = document.querySelector("[data-customer-addresses]");
  const count = document.querySelector("[data-customer-address-count]");
  const addresses = Array.isArray(customer.addresses) ? customer.addresses : [];
  if (count) count.textContent = `${addresses.length} адресов`;
  if (!container) return;

  if (!addresses.length) {
    container.innerHTML = '<p class="admin-muted">Клиент ещё не сохранил адреса.</p>';
    return;
  }

  container.innerHTML = addresses.map((address) => {
    const location = [address.city, `${address.street}, ${address.house}`, address.apartment ? `кв. ${address.apartment}` : null].filter(Boolean).join(", ");
    const details = [address.entrance ? `подъезд ${address.entrance}` : null, address.floor ? `этаж ${address.floor}` : null, address.intercom ? `домофон ${address.intercom}` : null].filter(Boolean).join(" · ");
    return `<article class="admin-address-card">
      <div><strong>${escapeAdminHtml(address.title || "Адрес")}</strong>${address.isDefault ? '<span class="admin-address-card__default">По умолчанию</span>' : ""}</div>
      <p>${escapeAdminHtml(location)}</p>
      <small>${escapeAdminHtml(address.recipientName)} · ${escapeAdminHtml(address.phone)}</small>
      ${details ? `<small>${escapeAdminHtml(details)}</small>` : ""}
      ${address.comment ? `<small>${escapeAdminHtml(address.comment)}</small>` : ""}
    </article>`;
  }).join("");
}

function renderCustomerOrders(customer) {
  const body = document.querySelector("[data-customer-orders]");
  if (!body) return;
  const orders = Array.isArray(customer.orders) ? customer.orders : [];
  if (!orders.length) {
    body.innerHTML = '<tr><td colspan="6" class="admin-table__empty">У клиента пока нет связанных заказов.</td></tr>';
    return;
  }

  body.innerHTML = orders.map((order) => `
    <tr>
      <td><a class="admin-table__primary" href="/admin/order?order=${encodeURIComponent(order.number)}">${escapeAdminHtml(order.number)}</a><small>${escapeAdminHtml(String(order.itemsCount))} поз.</small></td>
      <td><strong>${escapeAdminHtml(order.customerName)}</strong><small>${escapeAdminHtml(order.customerPhone)}${order.customerEmail ? ` · ${escapeAdminHtml(order.customerEmail)}` : ""}</small></td>
      <td>${adminStatusMarkup(order.status)}</td>
      <td>${escapeAdminHtml(ADMIN_DELIVERY_METHOD_LABELS[order.deliveryMethod] || order.deliveryMethod || "—")}</td>
      <td><strong>${escapeAdminHtml(formatAdminMoney(order.total, order.currency))}</strong></td>
      <td>${escapeAdminHtml(formatAdminDate(order.createdAt))}</td>
    </tr>`).join("");
}

function renderCustomerTimeline(customer) {
  const container = document.querySelector("[data-customer-timeline]");
  if (!container) return;
  const timeline = Array.isArray(customer.timeline) ? customer.timeline : [];
  if (!timeline.length) {
    container.innerHTML = '<p class="admin-muted">Внутренних событий пока нет.</p>';
    return;
  }

  const labels = {
    CUSTOMER_NOTE: "Заметка",
    CUSTOMER_DEACTIVATED: "Аккаунт отключён",
    CUSTOMER_REACTIVATED: "Аккаунт восстановлен",
  };

  container.innerHTML = timeline.map((item) => {
    const reason = item.metadata?.reason ? `<small>Причина: ${escapeAdminHtml(item.metadata.reason)}</small>` : "";
    return `<article class="admin-timeline__item">
      <div class="admin-timeline__meta"><strong>${escapeAdminHtml(labels[item.action] || item.action)}</strong><span>${escapeAdminHtml(formatAdminDate(item.createdAt))}</span></div>
      <p>${escapeAdminHtml(item.description || "—")}</p>
      ${reason}
      <small>${escapeAdminHtml(customerActorName(item.actor))}</small>
    </article>`;
  }).join("");
}

async function fetchAdminCustomerDetail(customerId) {
  const payload = await adminFetch(`/api/admin/customers/${customerId}`);
  const customer = payload.customer;
  renderCustomerProfile(customer);
  renderCustomerAddresses(customer);
  renderCustomerOrders(customer);
  renderCustomerTimeline(customer);
  return customer;
}

async function initAdminCustomerDetail() {
  if (!document.body.hasAttribute("data-admin-customer-detail")) return;
  const id = Number(new URLSearchParams(window.location.search).get("id"));
  if (!Number.isInteger(id) || id <= 0) {
    window.location.replace("/admin/customers");
    return;
  }

  let customer;
  try {
    customer = await fetchAdminCustomerDetail(id);
  } catch (error) {
    showAdminToast(error.message, "error");
    return;
  }

  const noteForm = document.querySelector("[data-customer-note-form]");
  noteForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(noteForm instanceof HTMLFormElement)) return;
    const textarea = noteForm.elements.namedItem("text");
    const text = textarea instanceof HTMLTextAreaElement ? textarea.value.trim() : "";
    if (!text) {
      showAdminToast("Введите текст заметки.", "error");
      return;
    }
    const button = document.querySelector("[data-customer-note-submit]");
    if (button instanceof HTMLButtonElement) button.disabled = true;
    try {
      await adminFetch(`/api/admin/customers/${id}/notes`, { method: "POST", body: JSON.stringify({ text }) });
      if (textarea instanceof HTMLTextAreaElement) textarea.value = "";
      customer = await fetchAdminCustomerDetail(id);
      showAdminToast("Заметка добавлена.");
    } catch (error) {
      showAdminToast(error.message, "error");
    } finally {
      if (button instanceof HTMLButtonElement) button.disabled = false;
    }
  });

  document.querySelector("[data-customer-actions]")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-customer-toggle-status]");
    if (!(button instanceof HTMLButtonElement) || currentAdminUser?.role !== "OWNER") return;

    const nextActive = !customer.isActive;
    const message = nextActive
      ? "Восстановить доступ клиента к аккаунту?"
      : "Отключить аккаунт клиента? Его действующие сессии будут завершены, но заказы останутся без изменений.";
    if (!window.confirm(message)) return;
    const reason = window.prompt("Причина (необязательно):", "");
    if (reason === null) return;

    button.disabled = true;
    try {
      await adminFetch(`/api/admin/customers/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: nextActive, reason: reason.trim() || null }),
      });
      customer = await fetchAdminCustomerDetail(id);
      showAdminToast(nextActive ? "Аккаунт клиента восстановлен." : "Аккаунт клиента отключён.");
    } catch (error) {
      showAdminToast(error.message, "error");
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
}

function promotionRuntimeStatusMarkup(status) {
  const labels = {
    DRAFT: "Черновик",
    ACTIVE: "Активна",
    SCHEDULED: "Запланирована",
    PAUSED: "На паузе",
    EXPIRED: "Завершена",
  };
  const classes = {
    DRAFT: "is-neutral",
    ACTIVE: "is-completed",
    SCHEDULED: "is-confirmed",
    PAUSED: "is-assembling",
    EXPIRED: "is-cancelled",
  };
  return `<span class="admin-status ${classes[status] || "is-neutral"}">${escapeAdminHtml(labels[status] || status || "—")}</span>`;
}

function formatPromotionDiscount(promotion) {
  if (promotion.type === "PERCENT") {
    return `−${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(promotion.discountValue) || 0)}%`;
  }
  return `−${formatAdminMoney(promotion.discountValue)}`;
}

function promotionScopeText(promotion) {
  if (promotion.scope === "GLOBAL") return "Весь каталог";
  const parts = [];
  const products = Array.isArray(promotion.products) ? promotion.products.length : 0;
  const categories = Array.isArray(promotion.categories) ? promotion.categories.length : 0;
  if (categories) parts.push(`${categories} кат.`);
  if (products) parts.push(`${products} тов.`);
  return parts.join(" · ") || "Весь каталог";
}

function getPromotionsQueryState() {
  const params = new URLSearchParams(window.location.search);
  const allowed = new Set(["DRAFT", "ACTIVE", "PAUSED", "EXPIRED"]);
  const status = allowed.has(params.get("status")) ? params.get("status") : "all";
  return {
    q: String(params.get("q") || "").trim(),
    status,
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

function syncPromotionsForm(state) {
  const form = document.querySelector("[data-promotions-filter]");
  if (!(form instanceof HTMLFormElement)) return;
  const q = form.elements.namedItem("q");
  const status = form.elements.namedItem("status");
  if (q instanceof HTMLInputElement) q.value = state.q;
  if (status instanceof HTMLSelectElement) status.value = state.status;
}

function renderPromotionsMetrics(metrics) {
  document.querySelectorAll("[data-promotions-metric]").forEach((element) => {
    element.textContent = String(metrics?.[element.dataset.promotionsMetric] ?? "—");
  });
}

function renderPromotionsList(promotions) {
  const body = document.querySelector("[data-promotions-list]");
  if (!body) return;
  if (!promotions.length) {
    body.innerHTML = '<tr><td colspan="7" class="admin-table__empty">По выбранным условиям акций нет.</td></tr>';
    return;
  }

  body.innerHTML = promotions.map((promotion) => `
    <tr>
      <td><a class="admin-table__primary" href="/admin/promotion-edit?id=${promotion.id}">${escapeAdminHtml(promotion.name)}</a><small>${escapeAdminHtml(promotion.slug)}</small></td>
      <td><strong>${escapeAdminHtml(formatPromotionDiscount(promotion))}</strong><small>${promotion.type === "PERCENT" ? "процент" : "на единицу"}</small></td>
      <td><strong>${escapeAdminHtml(promotionScopeText(promotion))}</strong><small>${promotion.scope === "GLOBAL" ? "без ограничений" : "товары и категории объединяются"}</small></td>
      <td><strong>${escapeAdminHtml(formatAdminDate(promotion.startsAt))}</strong><small>до ${escapeAdminHtml(formatAdminDate(promotion.endsAt))}</small></td>
      <td>${promotionRuntimeStatusMarkup(promotion.runtimeStatus)}</td>
      <td>${promotion.isFeatured ? '<span class="admin-status is-completed">Да</span>' : '<span class="admin-muted">Нет</span>'}</td>
      <td>${escapeAdminHtml(formatAdminDate(promotion.updatedAt))}</td>
    </tr>`).join("");
}

function renderPromotionsPagination(pagination, state) {
  const container = document.querySelector("[data-promotions-pagination]");
  if (!container) return;
  if (pagination.pages <= 1) {
    container.innerHTML = `<span>${escapeAdminHtml(String(pagination.total))} акций</span>`;
    return;
  }
  const makeHref = (page) => {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.status !== "all") params.set("status", state.status);
    params.set("page", String(page));
    return `/admin/promotions?${params.toString()}`;
  };
  container.innerHTML = `
    <span>${escapeAdminHtml(String(pagination.total))} акций</span>
    <div>
      ${pagination.page > 1 ? `<a class="admin-pagination__button" href="${makeHref(pagination.page - 1)}">Назад</a>` : ""}
      <span class="admin-pagination__current">${pagination.page} / ${pagination.pages}</span>
      ${pagination.page < pagination.pages ? `<a class="admin-pagination__button" href="${makeHref(pagination.page + 1)}">Далее</a>` : ""}
    </div>`;
}

async function loadAdminPromotions() {
  const state = getPromotionsQueryState();
  syncPromotionsForm(state);
  const params = new URLSearchParams({ page: String(state.page), limit: "30", status: state.status });
  if (state.q) params.set("q", state.q);
  const payload = await adminFetch(`/api/admin/promotions?${params.toString()}`);
  renderPromotionsMetrics(payload.promotions.metrics);
  renderPromotionsList(payload.promotions.items || []);
  renderPromotionsPagination(payload.promotions.pagination, state);
}

async function initAdminPromotions() {
  if (document.body.dataset.adminPage !== "promotions" || document.body.hasAttribute("data-admin-promotion-editor")) return;
  try {
    await loadAdminPromotions();
  } catch (error) {
    showAdminToast(error.message, "error");
  }

  const form = document.querySelector("[data-promotions-filter]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    const params = new URLSearchParams();
    const q = String(data.get("q") || "").trim();
    const status = String(data.get("status") || "all");
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    window.location.assign(`/admin/promotions${params.size ? `?${params.toString()}` : ""}`);
  });
  document.querySelector("[data-promotions-reset]")?.addEventListener("click", () => window.location.assign("/admin/promotions"));
}

function toLocalDateTimeInput(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function slugifyPromotion(value) {
  const translit = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y",
    к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
    х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  return String(value || "")
    .toLowerCase()
    .split("")
    .map((char) => translit[char] ?? char)
    .join("")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function promotionTargetCount() {
  const products = document.querySelectorAll('[data-promotion-products] input[type="checkbox"]:checked').length;
  const categories = document.querySelectorAll('[data-promotion-categories] input[type="checkbox"]:checked').length;
  const element = document.querySelector("[data-promotion-target-count]");
  if (element) element.textContent = products || categories ? `${categories} категорий · ${products} товаров` : "Глобальная акция";
}

function renderPromotionOptions(options, selected = { productIds: [], categoryIds: [] }) {
  const selectedProducts = new Set((selected.productIds || []).map(Number));
  const selectedCategories = new Set((selected.categoryIds || []).map(Number));
  const categoryContainer = document.querySelector("[data-promotion-categories]");
  const productContainer = document.querySelector("[data-promotion-products]");

  if (categoryContainer) {
    categoryContainer.innerHTML = options.categories?.length
      ? options.categories.map((category) => `<label class="admin-target-option"><input type="checkbox" value="${category.id}" data-promotion-category-target${selectedCategories.has(category.id) ? " checked" : ""} /><span><strong>${escapeAdminHtml(category.name)}</strong><small>${escapeAdminHtml(category.slug)}${category.isActive ? "" : " · скрыта"}</small></span></label>`).join("")
      : '<p class="admin-muted">Категорий нет.</p>';
  }
  if (productContainer) {
    productContainer.innerHTML = options.products?.length
      ? options.products.map((product) => `<label class="admin-target-option" data-promotion-product-option data-search="${escapeAdminHtml(`${product.name} ${product.sku} ${product.slug}`.toLowerCase())}"><input type="checkbox" value="${product.id}" data-promotion-product-target${selectedProducts.has(product.id) ? " checked" : ""} /><span><strong>${escapeAdminHtml(product.name)}</strong><small>${escapeAdminHtml(product.sku)} · ${escapeAdminHtml(product.slug)}${product.isActive ? "" : " · скрыт"}</small></span></label>`).join("")
      : '<p class="admin-muted">Товаров нет.</p>';
  }
  promotionTargetCount();
}

function fillPromotionForm(form, promotion) {
  const set = (name, value) => {
    const field = form.elements.namedItem(name);
    if (field instanceof HTMLInputElement && field.type === "checkbox") field.checked = Boolean(value);
    else if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = value ?? "";
  };
  set("name", promotion.name);
  set("slug", promotion.slug);
  set("description", promotion.description);
  set("type", promotion.type);
  set("discountValue", promotion.discountValue);
  set("startsAt", toLocalDateTimeInput(promotion.startsAt));
  set("endsAt", toLocalDateTimeInput(promotion.endsAt));
  set("status", ["DRAFT", "ACTIVE", "PAUSED"].includes(promotion.status) ? promotion.status : "PAUSED");
  set("isFeatured", promotion.isFeatured);
  const title = document.querySelector("[data-promotion-editor-title]");
  if (title) title.textContent = promotion.name;
  const lead = document.querySelector("[data-promotion-editor-lead]");
  if (lead) lead.textContent = `${promotionScopeText(promotion)} · ${formatPromotionDiscount(promotion)}`;
  const runtime = document.querySelector("[data-promotion-runtime-status]");
  if (runtime) runtime.innerHTML = promotionRuntimeStatusMarkup(promotion.runtimeStatus);
}

function updatePromotionPreview(form) {
  const preview = document.querySelector("[data-promotion-preview]");
  if (!preview) return;
  const type = String(form.elements.namedItem("type")?.value || "PERCENT");
  const value = Number(form.elements.namedItem("discountValue")?.value || 0);
  const example = 1000;
  const result = type === "PERCENT" ? Math.max(0, example * (1 - value / 100)) : Math.max(0, example - value);
  preview.innerHTML = `<span>Пример для цены 1 000 ₽</span><strong>${escapeAdminHtml(formatAdminMoney(result))}</strong><small>${value > 0 ? `скидка ${escapeAdminHtml(type === "PERCENT" ? `${value}%` : formatAdminMoney(value))}` : "укажите размер скидки"}</small>`;
}

function collectPromotionPayload(form) {
  const data = new FormData(form);
  const productIds = [...document.querySelectorAll("[data-promotion-product-target]:checked")].map((input) => Number(input.value)).filter(Number.isInteger);
  const categoryIds = [...document.querySelectorAll("[data-promotion-category-target]:checked")].map((input) => Number(input.value)).filter(Number.isInteger);
  return {
    name: String(data.get("name") || "").trim(),
    slug: String(data.get("slug") || "").trim().toLowerCase(),
    description: String(data.get("description") || "").trim() || null,
    type: String(data.get("type") || "PERCENT"),
    discountValue: Number(data.get("discountValue") || 0),
    startsAt: new Date(String(data.get("startsAt") || "")).toISOString(),
    endsAt: new Date(String(data.get("endsAt") || "")).toISOString(),
    status: String(data.get("status") || "DRAFT"),
    isFeatured: data.get("isFeatured") === "on",
    productIds,
    categoryIds,
  };
}

async function initAdminPromotionEditor() {
  if (!document.body.hasAttribute("data-admin-promotion-editor")) return;
  const form = document.querySelector("[data-promotion-form]");
  if (!(form instanceof HTMLFormElement)) return;

  const params = new URLSearchParams(window.location.search);
  const promotionId = Number(params.get("id"));
  const isEditing = Number.isInteger(promotionId) && promotionId > 0;
  let promotion = null;
  let options;

  try {
    const optionsPayload = await adminFetch("/api/admin/promotions/options");
    options = optionsPayload.options;
    if (isEditing) {
      const payload = await adminFetch(`/api/admin/promotions/${promotionId}`);
      promotion = payload.promotion;
      fillPromotionForm(form, promotion);
      renderPromotionOptions(options, promotion);
    } else {
      const now = new Date();
      const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      form.elements.namedItem("startsAt").value = toLocalDateTimeInput(now);
      form.elements.namedItem("endsAt").value = toLocalDateTimeInput(end);
      renderPromotionOptions(options);
    }
  } catch (error) {
    showAdminToast(error.message, "error");
    return;
  }

  const deleteButton = document.querySelector("[data-promotion-delete]");
  if (deleteButton instanceof HTMLButtonElement && isEditing && currentAdminUser?.role === "OWNER") deleteButton.hidden = false;

  const nameInput = form.elements.namedItem("name");
  const slugInput = form.elements.namedItem("slug");
  nameInput?.addEventListener("input", () => {
    if (!isEditing && slugInput instanceof HTMLInputElement && !slugInput.dataset.touched) slugInput.value = slugifyPromotion(nameInput.value);
  });
  slugInput?.addEventListener("input", () => { if (slugInput instanceof HTMLInputElement) slugInput.dataset.touched = "true"; });

  form.addEventListener("input", () => updatePromotionPreview(form));
  updatePromotionPreview(form);
  document.querySelector("[data-promotion-categories]")?.addEventListener("change", promotionTargetCount);
  document.querySelector("[data-promotion-products]")?.addEventListener("change", promotionTargetCount);
  document.querySelector("[data-promotion-clear-categories]")?.addEventListener("click", () => {
    document.querySelectorAll("[data-promotion-category-target]").forEach((input) => { input.checked = false; });
    promotionTargetCount();
  });
  document.querySelector("[data-promotion-product-search]")?.addEventListener("input", (event) => {
    const query = String(event.target.value || "").trim().toLowerCase();
    document.querySelectorAll("[data-promotion-product-option]").forEach((option) => {
      option.hidden = Boolean(query) && !String(option.dataset.search || "").includes(query);
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    let payload;
    try {
      payload = collectPromotionPayload(form);
    } catch {
      showAdminToast("Проверьте даты начала и окончания.", "error");
      return;
    }
    if (new Date(payload.endsAt) <= new Date(payload.startsAt)) {
      showAdminToast("Дата окончания должна быть позже даты начала.", "error");
      return;
    }
    if (payload.type === "PERCENT" && payload.discountValue > 100) {
      showAdminToast("Процент скидки не может превышать 100%.", "error");
      return;
    }

    const save = document.querySelector("[data-promotion-save]");
    if (save instanceof HTMLButtonElement) save.disabled = true;
    try {
      const response = await adminFetch(isEditing ? `/api/admin/promotions/${promotionId}` : "/api/admin/promotions", {
        method: isEditing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      showAdminToast(isEditing ? "Акция обновлена." : "Акция создана.");
      if (!isEditing) {
        window.location.replace(`/admin/promotion-edit?id=${response.promotion.id}`);
        return;
      }
      promotion = response.promotion;
      fillPromotionForm(form, promotion);
      renderPromotionOptions(options, promotion);
    } catch (error) {
      showAdminToast(error.message, "error");
    } finally {
      if (save instanceof HTMLButtonElement && save.isConnected) save.disabled = false;
    }
  });

  deleteButton?.addEventListener("click", async () => {
    if (!isEditing || currentAdminUser?.role !== "OWNER") return;
    if (!window.confirm("Удалить эту акцию? Исторические цены уже созданных заказов не изменятся.")) return;
    deleteButton.disabled = true;
    try {
      await adminFetch(`/api/admin/promotions/${promotionId}`, { method: "DELETE" });
      window.location.assign("/admin/promotions");
    } catch (error) {
      showAdminToast(error.message, "error");
      deleteButton.disabled = false;
    }
  });
}

const ADMIN_REVIEW_STATUS_LABELS = Object.freeze({
  PENDING: "На модерации",
  APPROVED: "Опубликован",
  REJECTED: "Отклонён",
});

function reviewStatusMarkup(status) {
  const label = ADMIN_REVIEW_STATUS_LABELS[status] || status || "—";
  return `<span class="admin-status is-${String(status || "unknown").toLowerCase()}">${escapeAdminHtml(label)}</span>`;
}

function getReviewsQueryState() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q") || "",
    status: ["PENDING", "APPROVED", "REJECTED"].includes(params.get("status")) ? params.get("status") : "all",
    rating: ["1", "2", "3", "4", "5"].includes(params.get("rating")) ? params.get("rating") : "all",
    featured: ["yes", "no"].includes(params.get("featured")) ? params.get("featured") : "all",
    page: Math.max(1, Number(params.get("page")) || 1),
  };
}

function syncReviewsForm(state) {
  const form = document.querySelector("[data-reviews-filter]");
  if (!(form instanceof HTMLFormElement)) return;
  const q = form.elements.namedItem("q");
  const status = form.elements.namedItem("status");
  const rating = form.elements.namedItem("rating");
  const featured = form.elements.namedItem("featured");
  if (q instanceof HTMLInputElement) q.value = state.q;
  if (status instanceof HTMLSelectElement) status.value = state.status;
  if (rating instanceof HTMLSelectElement) rating.value = state.rating;
  if (featured instanceof HTMLSelectElement) featured.value = state.featured;
}

function renderReviewsMetrics(metrics) {
  document.querySelectorAll("[data-reviews-metric]").forEach((element) => {
    const key = element.dataset.reviewsMetric;
    const value = metrics?.[key];
    element.textContent = value === null || value === undefined ? "—" : String(value);
  });
}

function reviewActionsMarkup(review) {
  const actions = [];
  if (review.status !== "APPROVED") {
    actions.push(`<button class="admin-icon-button" type="button" data-review-action="approve" data-review-id="${review.id}">Одобрить</button>`);
  }
  if (review.status !== "REJECTED") {
    actions.push(`<button class="admin-icon-button" type="button" data-review-action="reject" data-review-id="${review.id}">Отклонить</button>`);
  }
  if (review.status === "APPROVED") {
    actions.push(`<button class="admin-icon-button" type="button" data-review-action="${review.isFeatured ? "unfeature" : "feature"}" data-review-id="${review.id}">${review.isFeatured ? "Снять featured" : "Featured"}</button>`);
  }
  if (currentAdminUser?.role === "OWNER") {
    actions.push(`<button class="admin-icon-button is-danger" type="button" data-review-action="delete" data-review-id="${review.id}">Удалить</button>`);
  }
  return actions.join("");
}

function renderReviewsList(reviews) {
  const body = document.querySelector("[data-reviews-list]");
  if (!body) return;
  if (!reviews.length) {
    body.innerHTML = '<tr><td colspan="7" class="admin-table__empty">По выбранным условиям отзывов нет.</td></tr>';
    return;
  }

  body.innerHTML = reviews.map((review) => {
    const product = review.product;
    const user = review.user;
    const contact = user?.email || user?.phone || "Аккаунт удалён";
    const productCell = product
      ? `<a class="admin-table__primary" href="/admin/product-edit?id=${product.id}">${escapeAdminHtml(product.name)}</a><small>${escapeAdminHtml(product.sku)}</small>`
      : '<span class="admin-muted">Товар удалён</span>';
    return `
      <tr>
        <td><strong>${escapeAdminHtml(review.authorName)}</strong><small>${escapeAdminHtml(contact)}</small></td>
        <td>${productCell}</td>
        <td><span class="admin-review-stars" aria-label="${review.rating} из 5">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span><small>${review.rating}/5</small></td>
        <td><div class="admin-review-text">${escapeAdminHtml(review.text)}</div></td>
        <td>${reviewStatusMarkup(review.status)}${review.isFeatured ? '<span class="admin-review-featured">Featured</span>' : ""}</td>
        <td>${escapeAdminHtml(formatAdminDate(review.createdAt))}<small>обновлён ${escapeAdminHtml(formatAdminDate(review.updatedAt))}</small></td>
        <td><div class="admin-review-actions">${reviewActionsMarkup(review)}</div></td>
      </tr>`;
  }).join("");
}

function renderReviewsPagination(pagination, state) {
  const container = document.querySelector("[data-reviews-pagination]");
  if (!container) return;
  if (pagination.pages <= 1) {
    container.innerHTML = `<span>${escapeAdminHtml(String(pagination.total))} отзывов</span>`;
    return;
  }
  const makeHref = (page) => {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.status !== "all") params.set("status", state.status);
    if (state.rating !== "all") params.set("rating", state.rating);
    if (state.featured !== "all") params.set("featured", state.featured);
    params.set("page", String(page));
    return `/admin/reviews?${params.toString()}`;
  };
  container.innerHTML = `
    <span>${escapeAdminHtml(String(pagination.total))} отзывов</span>
    <div>
      ${pagination.page > 1 ? `<a class="admin-pagination__button" href="${makeHref(pagination.page - 1)}">Назад</a>` : ""}
      <span class="admin-pagination__current">${pagination.page} / ${pagination.pages}</span>
      ${pagination.page < pagination.pages ? `<a class="admin-pagination__button" href="${makeHref(pagination.page + 1)}">Далее</a>` : ""}
    </div>`;
}

async function loadAdminReviews() {
  const state = getReviewsQueryState();
  syncReviewsForm(state);
  const params = new URLSearchParams({
    page: String(state.page),
    limit: "30",
    status: state.status,
    rating: state.rating,
    featured: state.featured,
  });
  if (state.q) params.set("q", state.q);
  const payload = await adminFetch(`/api/admin/reviews?${params.toString()}`);
  renderReviewsMetrics(payload.reviews.metrics);
  renderReviewsList(payload.reviews.items || []);
  renderReviewsPagination(payload.reviews.pagination, state);
}

async function initAdminReviews() {
  if (document.body.dataset.adminPage !== "reviews") return;

  try {
    await loadAdminReviews();
  } catch (error) {
    showAdminToast(error.message, "error");
  }

  const form = document.querySelector("[data-reviews-filter]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    const params = new URLSearchParams();
    const q = String(data.get("q") || "").trim();
    const status = String(data.get("status") || "all");
    const rating = String(data.get("rating") || "all");
    const featured = String(data.get("featured") || "all");
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    if (rating !== "all") params.set("rating", rating);
    if (featured !== "all") params.set("featured", featured);
    window.location.assign(`/admin/reviews${params.size ? `?${params.toString()}` : ""}`);
  });

  document.querySelector("[data-reviews-reset]")?.addEventListener("click", () => window.location.assign("/admin/reviews"));

  document.querySelector("[data-reviews-list]")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-review-action]");
    if (!(button instanceof HTMLButtonElement)) return;
    const reviewId = Number(button.dataset.reviewId);
    const action = button.dataset.reviewAction;
    if (!Number.isInteger(reviewId)) return;

    if (action === "delete") {
      if (currentAdminUser?.role !== "OWNER") return;
      if (!window.confirm("Удалить отзыв без возможности восстановления?")) return;
      button.disabled = true;
      try {
        await adminFetch(`/api/admin/reviews/${reviewId}`, { method: "DELETE" });
        showAdminToast("Отзыв удалён.");
        await loadAdminReviews();
      } catch (error) {
        showAdminToast(error.message, "error");
        button.disabled = false;
      }
      return;
    }

    const payload = action === "approve"
      ? { status: "APPROVED" }
      : action === "reject"
        ? { status: "REJECTED" }
        : action === "feature"
          ? { isFeatured: true }
          : action === "unfeature"
            ? { isFeatured: false }
            : null;
    if (!payload) return;

    button.disabled = true;
    try {
      await adminFetch(`/api/admin/reviews/${reviewId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      showAdminToast("Отзыв обновлён.");
      await loadAdminReviews();
    } catch (error) {
      showAdminToast(error.message, "error");
      button.disabled = false;
    }
  });
}


const ADMIN_SUBSCRIPTION_STATUS_LABELS = Object.freeze({
  ACTIVE: "Активна",
  PAUSED: "На паузе",
  CANCELLED: "Отменена",
  EXPIRED: "Истекла",
});

function subscriptionStatusMarkup(status) {
  return `<span class="admin-status ${adminStatusClass(status)}">${escapeAdminHtml(ADMIN_SUBSCRIPTION_STATUS_LABELS[status] || status || "—")}</span>`;
}

function subscriptionIntervalLabel(days) {
  if (Number(days) === 7) return "Раз в неделю";
  if (Number(days) === 14) return "Раз в 2 недели";
  if (Number(days) === 30) return "Раз в 30 дней";
  return days ? `Раз в ${days} дней` : "—";
}

function getSubscriptionsQueryState() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q") || "",
    status: params.get("status") || "all",
    page: Math.max(1, Number(params.get("page") || 1) || 1),
  };
}

function syncSubscriptionsForm(state) {
  const form = document.querySelector("[data-subscriptions-filter]");
  if (!(form instanceof HTMLFormElement)) return;
  const q = form.elements.namedItem("q");
  const status = form.elements.namedItem("status");
  if (q) q.value = state.q;
  if (status) status.value = state.status;
}

function renderSubscriptionsMetrics(metrics) {
  document.querySelectorAll("[data-subscriptions-metric]").forEach((element) => {
    element.textContent = String(metrics?.[element.dataset.subscriptionsMetric] ?? "—");
  });
}

function renderSubscriptionsList(subscriptions) {
  const body = document.querySelector("[data-subscriptions-list]");
  if (!body) return;
  if (!subscriptions.length) {
    body.innerHTML = '<tr><td colspan="7" class="admin-table__empty">Подписок по этим условиям нет.</td></tr>';
    return;
  }
  body.innerHTML = subscriptions.map((subscription) => {
    const products = (subscription.items || []).slice(0, 3).map((item) => item.productName).join(", ");
    const extra = Math.max(0, (subscription.items || []).length - 3);
    return `<tr>
      <td><strong>${escapeAdminHtml(subscription.customer?.name || "—")}</strong><small>${escapeAdminHtml(subscription.customer?.phone || subscription.customer?.email || "")}</small></td>
      <td><span class="admin-subscription-products">${escapeAdminHtml(products || "Нет товаров")}${extra ? ` +${extra}` : ""}</span><small>${subscription.summary?.unavailableCount ? `Недоступно: ${subscription.summary.unavailableCount}` : `${subscription.items?.length || 0} поз.`}</small></td>
      <td><strong>${escapeAdminHtml(formatAdminMoney(subscription.summary?.total || 0))}</strong><small>доставка отдельно</small></td>
      <td>${escapeAdminHtml(subscriptionIntervalLabel(subscription.intervalDays))}</td>
      <td>${escapeAdminHtml(formatAdminDate(subscription.nextDeliveryAt, false))}</td>
      <td>${subscriptionStatusMarkup(subscription.status)}</td>
      <td><button class="admin-icon-button" type="button" data-subscription-open="${subscription.id}">Открыть</button></td>
    </tr>`;
  }).join("");
}

function renderSubscriptionsPagination(pagination, state) {
  const container = document.querySelector("[data-subscriptions-pagination]");
  if (!container) return;
  const href = (page) => {
    const params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.status !== "all") params.set("status", state.status);
    params.set("page", String(page));
    return `/admin/subscriptions?${params.toString()}`;
  };
  container.innerHTML = `<span>${escapeAdminHtml(String(pagination.total))} подписок</span><div>
    ${pagination.page > 1 ? `<a class="admin-pagination__button" href="${href(pagination.page - 1)}">Назад</a>` : ""}
    <span class="admin-pagination__current">${pagination.page} / ${pagination.pages}</span>
    ${pagination.page < pagination.pages ? `<a class="admin-pagination__button" href="${href(pagination.page + 1)}">Далее</a>` : ""}
  </div>`;
}

async function loadAdminSubscriptions() {
  const state = getSubscriptionsQueryState();
  syncSubscriptionsForm(state);
  const params = new URLSearchParams({ page: String(state.page), limit: "30", status: state.status });
  if (state.q) params.set("q", state.q);
  const payload = await adminFetch(`/api/admin/subscriptions?${params.toString()}`);
  renderSubscriptionsMetrics(payload.subscriptions.metrics);
  renderSubscriptionsList(payload.subscriptions.items || []);
  renderSubscriptionsPagination(payload.subscriptions.pagination, state);
}

function renderSubscriptionDetail(subscription) {
  const panel = document.querySelector("[data-subscription-detail]");
  const body = document.querySelector("[data-subscription-detail-body]");
  const title = document.querySelector("[data-subscription-detail-title]");
  if (!panel || !body || !subscription) return;
  panel.hidden = false;
  if (title) title.textContent = `Подписка #${subscription.id} · ${subscription.customer?.name || "клиент"}`;

  const itemRows = (subscription.items || []).map((item) => `<tr><td><strong>${escapeAdminHtml(item.productName)}</strong><small>${escapeAdminHtml(item.sku || "")}</small></td><td>${escapeAdminHtml(formatAdminQuantity(item.quantity))}</td><td>${escapeAdminHtml(formatAdminMoney(item.unitPrice))}</td><td>${escapeAdminHtml(formatAdminMoney(item.total))}</td><td>${item.available ? "Доступен" : "Требует замены"}</td></tr>`).join("");
  const deliveryRows = (subscription.deliveries || []).map((delivery) => `<tr><td>${escapeAdminHtml(formatAdminDate(delivery.scheduledFor, false))}</td><td>${escapeAdminHtml(delivery.status)}</td><td>${delivery.order ? `<a class="admin-table__primary" href="/admin/order?order=${encodeURIComponent(delivery.order.number)}">${escapeAdminHtml(delivery.order.number)}</a>` : escapeAdminHtml(delivery.failureMessage || "—")}</td><td>${delivery.order ? escapeAdminHtml(formatAdminMoney(delivery.order.total, delivery.order.currency)) : "—"}</td></tr>`).join("");
  const events = (subscription.events || []).map((event) => `<div class="admin-timeline__item"><div class="admin-timeline__meta"><strong>${escapeAdminHtml(event.action)}</strong><span>${escapeAdminHtml(formatAdminDate(event.createdAt))}</span></div><p>${escapeAdminHtml(event.description || "—")}</p><small>${escapeAdminHtml(event.actor?.name || event.source || "SYSTEM")}</small></div>`).join("");
  const ownerOnly = currentAdminUser?.role === "OWNER";
  const actions = `${subscription.canPause ? `<button class="admin-button admin-button--secondary" data-subscription-admin-action="pause" data-subscription-id="${subscription.id}" type="button">Пауза</button>` : ""}
    ${subscription.canResume ? `<button class="admin-button" data-subscription-admin-action="resume" data-subscription-id="${subscription.id}" type="button">Возобновить</button>` : ""}
    ${ownerOnly && subscription.canCancel ? `<button class="admin-button admin-button--danger" data-subscription-admin-action="cancel" data-subscription-id="${subscription.id}" type="button">Отменить</button>` : ""}
    ${ownerOnly && subscription.isDue ? `<button class="admin-button" data-subscription-admin-action="generate" data-subscription-id="${subscription.id}" type="button">Сформировать наступивший заказ</button>` : ""}`;

  body.innerHTML = `<div class="admin-subscription-detail__summary">
      <div><span>Статус</span><strong>${subscriptionStatusMarkup(subscription.status)}</strong></div>
      <div><span>Периодичность</span><strong>${escapeAdminHtml(subscriptionIntervalLabel(subscription.intervalDays))}</strong></div>
      <div><span>Следующая доставка</span><strong>${escapeAdminHtml(formatAdminDate(subscription.nextDeliveryAt, false))}</strong></div>
      <div><span>Ориентировочно</span><strong>${escapeAdminHtml(formatAdminMoney(subscription.summary?.total || 0))}</strong></div>
    </div>
    <p class="admin-form-note"><strong>Адрес:</strong> ${escapeAdminHtml(subscription.address?.formatted || "Не настроен")}</p>
    <div class="admin-subscription-actions">${actions}</div>
    <h3 class="admin-subscription-section-title">Состав</h3>
    <div class="admin-table-wrap"><table class="admin-table admin-table--subscription-items"><thead><tr><th>Товар</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th>Состояние</th></tr></thead><tbody>${itemRows || '<tr><td colspan="5" class="admin-table__empty">Нет товаров</td></tr>'}</tbody></table></div>
    <h3 class="admin-subscription-section-title">Связанные доставки и заказы</h3>
    <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Дата</th><th>Результат</th><th>Заказ / ошибка</th><th>Сумма</th></tr></thead><tbody>${deliveryRows || '<tr><td colspan="4" class="admin-table__empty">История доставок пуста</td></tr>'}</tbody></table></div>
    <h3 class="admin-subscription-section-title">История изменений</h3><div class="admin-timeline">${events || '<p class="admin-form-note">История пока пуста.</p>'}</div>`;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function openAdminSubscription(subscriptionId) {
  const payload = await adminFetch(`/api/admin/subscriptions/${subscriptionId}`);
  renderSubscriptionDetail(payload.subscription);
}

async function initAdminSubscriptions() {
  if (document.body.dataset.adminPage !== "subscriptions") return;
  const dueButton = document.querySelector("[data-subscriptions-generate-due]");
  if (dueButton && currentAdminUser?.role === "OWNER") dueButton.hidden = false;

  try { await loadAdminSubscriptions(); } catch (error) { showAdminToast(error.message, "error"); }

  const form = document.querySelector("[data-subscriptions-filter]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    const data = new FormData(form);
    const params = new URLSearchParams();
    const q = String(data.get("q") || "").trim();
    const status = String(data.get("status") || "all");
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    window.location.assign(`/admin/subscriptions${params.size ? `?${params.toString()}` : ""}`);
  });
  document.querySelector("[data-subscriptions-reset]")?.addEventListener("click", () => window.location.assign("/admin/subscriptions"));
  document.querySelector("[data-subscription-detail-close]")?.addEventListener("click", () => {
    const panel = document.querySelector("[data-subscription-detail]");
    if (panel) panel.hidden = true;
  });

  document.querySelector("[data-subscriptions-list]")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-subscription-open]");
    if (!button) return;
    try { await openAdminSubscription(Number(button.dataset.subscriptionOpen)); } catch (error) { showAdminToast(error.message, "error"); }
  });

  document.querySelector("[data-subscription-detail-body]")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-subscription-admin-action]");
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    const id = Number(button.dataset.subscriptionId);
    const action = button.dataset.subscriptionAdminAction;
    if (!Number.isInteger(id)) return;
    if (action === "cancel" && !window.confirm("Отменить подписку клиента без возможности возобновления?")) return;
    if (action === "generate" && !window.confirm("Сформировать наступивший плановый заказ? Товары будут зарезервированы на складе.")) return;
    button.disabled = true;
    try {
      if (action === "pause") await adminFetch(`/api/admin/subscriptions/${id}/pause`, { method: "POST" });
      if (action === "resume") await adminFetch(`/api/admin/subscriptions/${id}/resume`, { method: "POST", body: JSON.stringify({}) });
      if (action === "cancel") await adminFetch(`/api/admin/subscriptions/${id}/cancel`, { method: "POST" });
      if (action === "generate") await adminFetch(`/api/admin/subscriptions/${id}/generate`, { method: "POST", body: JSON.stringify({}) });
      showAdminToast(action === "generate" ? "Плановый заказ сформирован." : "Подписка обновлена.");
      await loadAdminSubscriptions();
      await openAdminSubscription(id);
    } catch (error) {
      showAdminToast(error.message, "error");
      button.disabled = false;
    }
  });

  dueButton?.addEventListener("click", async () => {
    if (currentAdminUser?.role !== "OWNER" || dueButton.disabled) return;
    if (!window.confirm("Сформировать все наступившие плановые заказы?")) return;
    dueButton.disabled = true;
    try {
      const payload = await adminFetch("/api/admin/subscriptions/actions/generate-due", { method: "POST", body: JSON.stringify({ limit: 100 }) });
      showAdminToast(`Создано: ${payload.generation.created}, ошибок: ${payload.generation.failed}.`);
      await loadAdminSubscriptions();
    } catch (error) { showAdminToast(error.message, "error"); }
    finally { dueButton.disabled = false; }
  });
}


async function initAdminDelivery() {
  if (document.body.dataset.adminPage !== "delivery") return;
  let deliveryData = null;
  const isOwner = currentAdminUser?.role === "OWNER";
  if (!isOwner) document.querySelectorAll("[data-delivery-editor]").forEach((editor) => { editor.hidden = true; });

  const numberOrNull = (form, name) => {
    const raw = String(form.elements[name]?.value || "").trim();
    return raw === "" ? null : Number(raw);
  };
  const stringOrNull = (form, name) => String(form.elements[name]?.value || "").trim() || null;
  const serialiseForm = (kind, form) => {
    const common = {
      isActive: Boolean(form.elements.isActive.checked),
    };
    if (kind === "zones") return {
      ...common,
      name: String(form.elements.name.value).trim(),
      locality: stringOrNull(form, "locality"),
      description: stringOrNull(form, "description"),
      deliveryPrice: Number(form.elements.deliveryPrice.value),
      minOrderAmount: numberOrNull(form, "minOrderAmount"),
      freeDeliveryFrom: numberOrNull(form, "freeDeliveryFrom"),
      sortOrder: Number(form.elements.sortOrder.value),
    };
    if (kind === "pickup-points") return {
      ...common,
      name: String(form.elements.name.value).trim(),
      address: String(form.elements.address.value).trim(),
      phone: stringOrNull(form, "phone"),
      workingHours: stringOrNull(form, "workingHours"),
      sortOrder: Number(form.elements.sortOrder.value),
    };
    return {
      ...common,
      date: String(form.elements.date.value),
      startTime: String(form.elements.startTime.value),
      endTime: String(form.elements.endTime.value),
      capacity: numberOrNull(form, "capacity"),
    };
  };

  const recordList = (kind) => ({ zones: deliveryData?.zones, "pickup-points": deliveryData?.pickupPoints, slots: deliveryData?.slots })[kind] || [];
  const render = (kind) => {
    const body = document.querySelector(`[data-delivery-list="${kind}"]`);
    if (!body) return;
    const rows = recordList(kind).map((record) => {
      const button = isOwner ? `<button class="admin-button admin-button--secondary" type="button" data-delivery-edit="${kind}" data-id="${record.id}">Изменить</button>` : "";
      const status = record.isActive ? "Активен" : "Выключен";
      if (kind === "zones") return `<tr><td>${escapeAdminHtml(record.name)}</td><td>${escapeAdminHtml(record.locality || "Не настроен")}</td><td>${formatAdminMoney(record.deliveryPrice)}</td><td>${record.minOrderAmount === null ? "Нет" : formatAdminMoney(record.minOrderAmount)}</td><td>${record.freeDeliveryFrom === null ? "Нет" : formatAdminMoney(record.freeDeliveryFrom)}</td><td>${status}</td><td>${button}</td></tr>`;
      if (kind === "pickup-points") return `<tr><td>${escapeAdminHtml(record.name)}</td><td>${escapeAdminHtml(record.address)}</td><td>${escapeAdminHtml(record.workingHours || "—")}</td><td>${status}</td><td>${button}</td></tr>`;
      return `<tr><td>${escapeAdminHtml(String(record.date).slice(0, 10))}</td><td>${escapeAdminHtml(record.startTime)}–${escapeAdminHtml(record.endTime)}</td><td>${record.capacity ?? "Без ограничения"}</td><td>${status}</td><td>${button}</td></tr>`;
    });
    body.innerHTML = rows.join("") || `<tr><td colspan="${kind === "zones" ? 7 : 5}" class="admin-table__empty">Записей пока нет.</td></tr>`;
  };
  const load = async () => {
    deliveryData = await adminFetch("/api/admin/delivery");
    for (const kind of ["zones", "pickup-points", "slots"]) render(kind);
  };
  const reset = (kind) => {
    const form = document.querySelector(`[data-delivery-form="${kind}"]`);
    if (!(form instanceof HTMLFormElement)) return;
    form.reset();
    form.elements.id.value = "";
    if (kind === "slots") form.elements.date.value = new Date().toLocaleDateString("sv-SE");
    const header = document.querySelector(`[data-delivery-title="${kind}"]`);
    if (header) header.textContent = ({ zones: "Добавить зону", "pickup-points": "Добавить пункт", slots: "Добавить интервал" })[kind];
  };
  for (const kind of ["zones", "pickup-points", "slots"]) {
    document.querySelector(`[data-delivery-reset="${kind}"]`)?.addEventListener("click", () => reset(kind));
    document.querySelector(`[data-delivery-list="${kind}"]`)?.addEventListener("click", (event) => {
      const button = event.target.closest(`[data-delivery-edit="${kind}"]`);
      if (!button || !isOwner) return;
      const record = recordList(kind).find((entry) => entry.id === Number(button.dataset.id));
      const form = document.querySelector(`[data-delivery-form="${kind}"]`);
      if (!record || !(form instanceof HTMLFormElement)) return;
      form.elements.id.value = record.id;
      for (const [key, value] of Object.entries(record)) {
        const field = form.elements[key];
        if (!field || key === "id") continue;
        if (field.type === "checkbox") field.checked = Boolean(value);
        else field.value = value === null || value === undefined ? "" : (key === "date" ? String(value).slice(0, 10) : String(value));
      }
      const title = document.querySelector(`[data-delivery-title="${kind}"]`);
      if (title) title.textContent = "Редактирование #" + record.id;
      form.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    const form = document.querySelector(`[data-delivery-form="${kind}"]`);
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!isOwner || !(form instanceof HTMLFormElement) || !form.reportValidity()) return;
      const id = form.elements.id.value;
      const data = serialiseForm(kind, form);
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      try {
        await adminFetch(`/api/admin/delivery/${kind}${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body: JSON.stringify(data) });
        showAdminToast("Настройки доставки сохранены.");
        reset(kind);
        await load();
      } catch (error) { showAdminToast(error.message, "error"); }
      finally { submit.disabled = false; }
    });
  }
  try { await load(); } catch (error) { showAdminToast(error.message, "error"); }
}

async function initAdminApplication() {
  await initAdminLogin();

  if (!document.querySelector("[data-admin-app]")) return;
  const ready = await initAdminShell();
  if (!ready) return;

  await Promise.all([
    initAdminDashboard(),
    initAdminOrders(),
    initAdminOrder(),
    initAdminWarehouse(),
    initAdminProducts(),
    initAdminProductEditor(),
    initAdminCategories(),
    initAdminCustomers(),
    initAdminCustomerDetail(),
    initAdminPromotions(),
    initAdminPromotionEditor(),
    initAdminReviews(),
    initAdminSubscriptions(),
    initAdminDelivery(),
  ]);
}

document.addEventListener("DOMContentLoaded", () => {
  void initAdminApplication();
});
