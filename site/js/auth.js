const AUTH_VIEWS = new Set(['login', 'register', 'forgot', 'reset']);
let passwordResetToken = '';

function captureResetTokenFromUrl() {
  const hash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;

  if (!hash) {
    return;
  }

  const token = new URLSearchParams(hash).get('token') || '';

  if (!token) {
    return;
  }

  passwordResetToken = token;

  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(
    { authView: getAuthViewFromUrl() },
    '',
    `${url.pathname}${url.search}`,
  );
}

function getAuthViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const requested = params.get('view');

  return AUTH_VIEWS.has(requested) ? requested : 'login';
}

function getResetTokenFromUrl() {
  return passwordResetToken;
}

function updateAuthUrl(view, { replace = false } = {}) {
  const url = new URL(window.location.href);

  if (view === 'login') {
    url.searchParams.delete('view');
  } else {
    url.searchParams.set('view', view);
  }

  if (view !== 'reset') {
    url.hash = '';
  }

  const method = replace ? 'replaceState' : 'pushState';
  window.history[method]({ authView: view }, '', `${url.pathname}${url.search}${url.hash}`);
}

function clearResetTokenFromUrl() {
  passwordResetToken = '';

  const url = new URL(window.location.href);
  url.hash = '';
  url.searchParams.delete('view');
  window.history.replaceState({ authView: 'login' }, '', `${url.pathname}${url.search}`);
}

function clearFormErrors(form) {
  if (!form) {
    return;
  }

  form.querySelectorAll('.auth-field.is-invalid').forEach((field) => {
    field.classList.remove('is-invalid');
  });

  form.querySelectorAll('[data-field-error]').forEach((error) => {
    error.textContent = '';
  });

  const status = form.querySelector('[data-form-status]');

  if (status) {
    status.textContent = '';
    status.classList.remove('is-error', 'is-success');
  }
}

function setFieldError(form, name, message) {
  const input = form.elements.namedItem(name);
  const error = form.querySelector(`[data-field-error="${name}"]`);

  if (input instanceof HTMLElement) {
    input.closest('.auth-field')?.classList.add('is-invalid');
  }

  if (error) {
    error.textContent = message;
  }
}

function setFormStatus(form, message, type = '') {
  const status = form.querySelector('[data-form-status]');

  if (!status) {
    return;
  }

  status.textContent = message;
  status.classList.remove('is-error', 'is-success');

  if (type) {
    status.classList.add(`is-${type}`);
  }
}

function setFormLoading(form, isLoading) {
  const submit = form.querySelector('[data-auth-submit]');

  if (!(submit instanceof HTMLButtonElement)) {
    return;
  }

  submit.disabled = isLoading;
  submit.classList.toggle('is-loading', isLoading);
  form.setAttribute('aria-busy', String(isLoading));
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function getPhoneDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function validateAuthForm(form) {
  const type = form.dataset.authForm;
  const data = new FormData(form);
  let valid = true;

  clearFormErrors(form);

  const email = String(data.get('email') || '').trim();

  if (['login', 'register', 'forgot'].includes(type)) {
    if (!email) {
      setFieldError(form, 'email', 'Введите email.');
      valid = false;
    } else if (!isValidEmail(email)) {
      setFieldError(form, 'email', 'Введите корректный email.');
      valid = false;
    }
  }

  if (type === 'login') {
    const password = String(data.get('password') || '');

    if (!password) {
      setFieldError(form, 'password', 'Введите пароль.');
      valid = false;
    }
  }

  if (type === 'register') {
    const firstName = String(data.get('firstName') || '').trim();
    const phone = getPhoneDigits(data.get('phone'));
    const password = String(data.get('password') || '');
    const passwordConfirm = String(data.get('passwordConfirm') || '');
    const agreement = data.get('agreement') === 'on';

    if (firstName.length < 2) {
      setFieldError(form, 'firstName', 'Введите имя.');
      valid = false;
    }

    if (phone.length !== 11) {
      setFieldError(form, 'phone', 'Введите полный номер телефона.');
      valid = false;
    }

    if (password.length < 8) {
      setFieldError(form, 'password', 'Пароль должен содержать минимум 8 символов.');
      valid = false;
    }

    if (!passwordConfirm) {
      setFieldError(form, 'passwordConfirm', 'Повторите пароль.');
      valid = false;
    } else if (password !== passwordConfirm) {
      setFieldError(form, 'passwordConfirm', 'Пароли не совпадают.');
      valid = false;
    }

    if (!agreement) {
      setFieldError(form, 'agreement', 'Необходимо согласие на обработку данных.');
      valid = false;
    }
  }

  if (type === 'reset') {
    const password = String(data.get('password') || '');
    const passwordConfirm = String(data.get('passwordConfirm') || '');

    if (password.length < 8) {
      setFieldError(form, 'password', 'Пароль должен содержать минимум 8 символов.');
      valid = false;
    }

    if (!passwordConfirm) {
      setFieldError(form, 'passwordConfirm', 'Повторите пароль.');
      valid = false;
    } else if (password !== passwordConfirm) {
      setFieldError(form, 'passwordConfirm', 'Пароли не совпадают.');
      valid = false;
    }
  }

  return valid;
}

async function parseJsonSafely(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function applyApiValidationErrors(form, payload) {
  const details = payload?.error?.details;

  if (!Array.isArray(details)) {
    return false;
  }

  let applied = false;

  details.forEach((issue) => {
    const path = String(issue?.path || '');
    const fieldName = path.split('.').pop();

    if (!fieldName || !form.elements.namedItem(fieldName)) {
      return;
    }

    setFieldError(
      form,
      fieldName,
      issue?.message || 'Проверьте значение.',
    );
    applied = true;
  });

  return applied;
}

function showApiError(form, response, payload, fallbackMessage) {
  const validationApplied = applyApiValidationErrors(form, payload);

  if (validationApplied) {
    setFormStatus(form, 'Проверьте выделенные поля.', 'error');
    form.querySelector('.auth-field.is-invalid input')?.focus();
    return;
  }

  const message =
    payload?.error?.message ||
    (response.status === 429
      ? 'Слишком много запросов. Попробуйте немного позже.'
      : fallbackMessage);

  setFormStatus(form, message, 'error');
}

async function submitLogin(form) {
  const data = new FormData(form);

  setFormLoading(form, true);
  setFormStatus(form, 'Проверяем данные…');

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: String(data.get('email') || '').trim().toLowerCase(),
        password: String(data.get('password') || ''),
      }),
    });

    const payload = await parseJsonSafely(response);

    if (!response.ok) {
      showApiError(
        form,
        response,
        payload,
        'Не удалось выполнить вход. Попробуйте ещё раз.',
      );
      return false;
    }

    setFormStatus(
      form,
      'Вход выполнен. Открываем личный кабинет…',
      'success',
    );

    window.setTimeout(() => {
      window.location.assign('/account/');
    }, 450);

    return true;
  } catch {
    setFormStatus(
      form,
      'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.',
      'error',
    );
    return false;
  } finally {
    setFormLoading(form, false);
  }
}

async function submitRegister(form) {
  const data = new FormData(form);

  setFormLoading(form, true);
  setFormStatus(form, 'Создаём защищённый аккаунт…');

  try {
    const response = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        firstName: String(data.get('firstName') || '').trim(),
        phone: String(data.get('phone') || '').trim(),
        email: String(data.get('email') || '').trim().toLowerCase(),
        password: String(data.get('password') || ''),
        passwordConfirm: String(data.get('passwordConfirm') || ''),
        agreement: data.get('agreement') === 'on',
      }),
    });

    const payload = await parseJsonSafely(response);

    if (!response.ok) {
      showApiError(
        form,
        response,
        payload,
        'Не удалось создать аккаунт. Проверьте данные и попробуйте ещё раз.',
      );
      return false;
    }

    setFormStatus(
      form,
      'Аккаунт создан. Открываем личный кабинет…',
      'success',
    );

    window.setTimeout(() => {
      window.location.assign('/account/');
    }, 500);

    return true;
  } catch {
    setFormStatus(
      form,
      'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.',
      'error',
    );
    return false;
  } finally {
    setFormLoading(form, false);
  }
}

async function submitForgotPassword(form) {
  const data = new FormData(form);

  setFormLoading(form, true);
  setFormStatus(form, 'Проверяем запрос…');

  try {
    const response = await fetch('/api/auth/forgot-password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: String(data.get('email') || '').trim().toLowerCase(),
      }),
    });

    const payload = await parseJsonSafely(response);

    if (!response.ok) {
      showApiError(
        form,
        response,
        payload,
        'Не удалось обработать запрос. Попробуйте ещё раз.',
      );
      return false;
    }

    setFormStatus(
      form,
      payload?.message ||
        'Если аккаунт с таким email существует, ссылка для восстановления отправлена на почту.',
      'success',
    );

    return true;
  } catch {
    setFormStatus(
      form,
      'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.',
      'error',
    );
    return false;
  } finally {
    setFormLoading(form, false);
  }
}

async function submitResetPassword(form) {
  const token = getResetTokenFromUrl();

  if (!token) {
    setFormStatus(
      form,
      'Ссылка восстановления недействительна. Запросите новую ссылку.',
      'error',
    );
    return false;
  }

  const data = new FormData(form);

  setFormLoading(form, true);
  setFormStatus(form, 'Сохраняем новый пароль…');

  try {
    const response = await fetch('/api/auth/reset-password', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        password: String(data.get('password') || ''),
        passwordConfirm: String(data.get('passwordConfirm') || ''),
      }),
    });

    const payload = await parseJsonSafely(response);

    if (!response.ok) {
      showApiError(
        form,
        response,
        payload,
        'Не удалось изменить пароль. Запросите новую ссылку и попробуйте снова.',
      );
      return false;
    }

    return true;
  } catch {
    setFormStatus(
      form,
      'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.',
      'error',
    );
    return false;
  } finally {
    setFormLoading(form, false);
  }
}

function initPhoneMask() {
  document.querySelectorAll('[data-phone-input]').forEach((input) => {
    input.addEventListener('input', () => {
      let digits = input.value.replace(/\D/g, '');

      if (!digits) {
        input.value = '';
        return;
      }

      if (digits[0] === '8') {
        digits = `7${digits.slice(1)}`;
      }

      if (digits[0] !== '7') {
        digits = `7${digits}`;
      }

      digits = digits.slice(0, 11);

      const tail = digits.slice(1);
      let formatted = '+7';

      if (tail.length > 0) {
        formatted += ` (${tail.slice(0, 3)}`;
      }

      if (tail.length >= 3) {
        formatted += ')';
      }

      if (tail.length > 3) {
        formatted += ` ${tail.slice(3, 6)}`;
      }

      if (tail.length > 6) {
        formatted += `-${tail.slice(6, 8)}`;
      }

      if (tail.length > 8) {
        formatted += `-${tail.slice(8, 10)}`;
      }

      input.value = formatted;
    });
  });
}

function initPasswordToggles() {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-password-toggle]');

    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const targetId = button.dataset.passwordTarget;
    const input = targetId ? document.getElementById(targetId) : null;

    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const shouldShow = input.type === 'password';

    input.type = shouldShow ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(shouldShow));
    button.setAttribute('aria-label', shouldShow ? 'Скрыть пароль' : 'Показать пароль');
  });
}

function initAuth() {
  captureResetTokenFromUrl();

  const shell = document.querySelector('[data-auth-shell]');

  if (!shell) {
    return;
  }

  const card = shell.querySelector('[data-auth-card]');

  const renderView = (view, { updateUrl = true, replace = false } = {}) => {
    const nextView = AUTH_VIEWS.has(view) ? view : 'login';

    shell.querySelectorAll('[data-auth-view]').forEach((section) => {
      const isActive = section.dataset.authView === nextView;

      section.hidden = !isActive;
      section.classList.toggle('is-active', isActive);

      if (isActive) {
        section.classList.remove('is-entering');
        window.requestAnimationFrame(() => section.classList.add('is-entering'));
        clearFormErrors(section.querySelector('form'));
      }
    });

    if (card) {
      card.dataset.authActiveView = nextView;
    }

    if (updateUrl) {
      updateAuthUrl(nextView, { replace });
    }

    const activeForm = shell.querySelector(
      `[data-auth-view="${nextView}"] form`,
    );

    if (nextView === 'reset' && activeForm && !getResetTokenFromUrl()) {
      setFormStatus(
        activeForm,
        'Ссылка восстановления недействительна. Запросите новую ссылку.',
        'error',
      );
    }

    const focusTarget = shell.querySelector(
      `[data-auth-view="${nextView}"] input:not([type="checkbox"])`,
    );

    window.setTimeout(() => focusTarget?.focus({ preventScroll: true }), 180);
  };

  shell.addEventListener('click', (event) => {
    const switcher = event.target.closest('[data-auth-switch]');

    if (switcher instanceof HTMLButtonElement) {
      renderView(switcher.dataset.authSwitch);
    }
  });

  shell.querySelectorAll('[data-auth-form]').forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();

      if (!validateAuthForm(form)) {
        form.querySelector('.auth-field.is-invalid input')?.focus();
        return;
      }

      const type = form.dataset.authForm;

      if (type === 'login') {
        await submitLogin(form);
        return;
      }

      if (type === 'register') {
        await submitRegister(form);
        return;
      }

      if (type === 'forgot') {
        await submitForgotPassword(form);
        return;
      }

      if (type === 'reset') {
        const changed = await submitResetPassword(form);

        if (!changed) {
          return;
        }

        clearResetTokenFromUrl();
        renderView('login', { updateUrl: false });

        const loginForm = shell.querySelector('[data-auth-form="login"]');

        if (loginForm) {
          setFormStatus(
            loginForm,
            'Пароль изменён. Войдите с новым паролем.',
            'success',
          );
        }
      }
    });

    form.addEventListener('input', (event) => {
      const input = event.target;

      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      input.closest('.auth-field')?.classList.remove('is-invalid');
      const error = form.querySelector(`[data-field-error="${input.name}"]`);

      if (error) {
        error.textContent = '';
      }
    });

    form.addEventListener('change', (event) => {
      const input = event.target;

      if (!(input instanceof HTMLInputElement) || input.name !== 'agreement') {
        return;
      }

      const error = form.querySelector('[data-field-error="agreement"]');

      if (error) {
        error.textContent = '';
      }
    });
  });

  window.addEventListener('popstate', () => {
    renderView(getAuthViewFromUrl(), { updateUrl: false });
  });

  initPhoneMask();
  initPasswordToggles();
  renderView(getAuthViewFromUrl(), { replace: true });
}

document.addEventListener('DOMContentLoaded', initAuth);
