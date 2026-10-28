const root = document.querySelector('[data-account-inbox]');
if (root) initInbox();

function initInbox() {
  const status = root.querySelector('[data-inbox-status]');
  const list = root.querySelector('[data-inbox-list]');
  const empty = root.querySelector('[data-inbox-empty]');
  const more = root.querySelector('[data-inbox-more]');
  const all = root.querySelector('[data-inbox-read-all]');
  const form = root.querySelector('[data-inbox-filters]');
  const labels = { ORDER: 'Заказ', SUBSCRIPTION: 'Подписка', MARKETING: 'Предложение' };
  const dates = new Intl.DateTimeFormat('ru', { dateStyle: 'medium', timeStyle: 'short' });
  let ready = false, cursor = null, throughId = null, activeRequest, generation = 0, badgeCheckedAt = 0;
  const inInbox = () => document.querySelector('[data-account-page]')?.dataset.accountPage === 'notifications';
  const message = (text) => { status.textContent = text; };

  async function request(path = '', { method = 'GET', body, signal } = {}) {
    const response = await fetch(`/api/account/notifications${path}`, {
      method, signal: signal || AbortSignal.timeout(15000), cache: 'no-store', credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) { location.replace('/login.html'); throw Error('Войдите в аккаунт снова.'); }
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.ok) throw Error(payload?.error?.message || 'Уведомления недоступны. Проверьте подключение и нажмите «Обновить».');
    return payload;
  }
  function badge(count) {
    document.querySelectorAll('[data-notification-count]').forEach((item) => {
      item.textContent = count > 99 ? '99+' : String(count);
      item.hidden = count === 0;
      item.setAttribute('aria-label', `Непрочитанных уведомлений: ${count}`);
    });
  }
  async function refreshBadge() {
    try { const payload = await request('/unread-count'); badge(payload.unreadCount); badgeCheckedAt = Date.now(); }
    catch { /* The history has its own visible retry/error state. */ }
  }
  function setRead(item, row) {
    row.classList.remove('account-inbox__item--unread');
    row.querySelector('[data-inbox-state]').textContent = 'Прочитано';
    row.querySelector('[data-inbox-read]')?.remove();
    item.readAt = new Date().toISOString();
  }
  function render(item) {
    const row = document.createElement('li');
    row.className = `account-inbox__item${item.readAt ? '' : ' account-inbox__item--unread'}`;
    row.dataset.notificationId = String(item.id);
    const meta = document.createElement('div'); meta.className = 'account-inbox__meta';
    const category = document.createElement('span'); category.textContent = labels[item.category] || 'Уведомление';
    const date = document.createElement('time'); date.dateTime = item.createdAt; date.textContent = dates.format(new Date(item.createdAt));
    const state = document.createElement('span'); state.dataset.inboxState = ''; state.textContent = item.readAt ? 'Прочитано' : 'Новое';
    meta.append(category, date, state);
    const title = document.createElement('h2'); title.className = 'account-inbox__title'; title.textContent = item.title;
    const body = document.createElement('p'); body.textContent = item.body;
    row.append(meta, title, body);
    if (item.imageUrl) {
      const image = document.createElement('img'); image.className = 'account-inbox__image'; image.alt = ''; image.loading = 'lazy'; image.src = item.imageUrl;
      row.append(image);
    }
    const actions = document.createElement('div'); actions.className = 'account-inbox__actions';
    const link = document.createElement('a'); link.className = 'account-text-link'; link.href = item.url; link.textContent = 'Открыть';
    link.setAttribute('aria-label', `Открыть: ${item.title}`);
    link.addEventListener('click', async (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); event.stopPropagation();
      if (!item.readAt) {
        try { await request(`/${item.id}/read`, { method: 'PATCH', body: {} }); }
        catch { /* A read-marker failure must not prevent opening the order. */ }
      }
      location.assign(item.url);
    });
    actions.append(link);
    if (!item.readAt) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'account-button account-button--soft';
      button.dataset.inboxRead = ''; button.textContent = 'Отметить прочитанным';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await request(`/${item.id}/read`, { method: 'PATCH', body: {} });
          setRead(item, row); await refreshBadge();
          if (form.elements.unread.checked) await load(false);
          else message('Отмечено прочитанным.');
        } catch (error) { message(error.message); button.disabled = false; }
      });
      actions.append(button);
    }
    row.append(actions); return row;
  }
  async function load(append) {
    if (!ready || !inInbox()) return;
    activeRequest?.abort();
    const controller = new AbortController();
    activeRequest = controller;
    const current = ++generation;
    const timeout = setTimeout(() => controller.abort(), 15000);
    more.disabled = true; all.disabled = true; root.setAttribute('aria-busy', 'true');
    const query = new URLSearchParams();
    if (append && cursor) query.set('before', cursor);
    if (form.elements.category.value) query.set('category', form.elements.category.value);
    if (form.elements.unread.checked) query.set('unread', 'true');
    if (!append) { list.replaceChildren(); more.hidden = true; empty.hidden = true; }
    message('Загружаем уведомления…');
    try {
      const payload = await request(`?${query}`, { signal: activeRequest.signal });
      if (current !== generation || !inInbox()) return;
      if (!append) throughId = payload.throughId;
      for (const item of payload.notifications) list.append(render(item));
      cursor = payload.nextCursor; more.hidden = !cursor;
      empty.hidden = list.children.length > 0;
      empty.textContent = form.elements.unread.checked || form.elements.category.value
        ? 'По выбранным условиям уведомлений нет.'
        : 'Здесь пока нет уведомлений. Новые сообщения появятся после событий в магазине.';
      badge(payload.unreadCount); badgeCheckedAt = Date.now();
      all.disabled = !throughId || payload.unreadCount === 0;
      message('');
    } catch (error) {
      if (current === generation && inInbox()) message(error.name === 'AbortError' ? 'Не удалось загрузить уведомления. Нажмите «Обновить».' : error.message);
    } finally {
      clearTimeout(timeout);
      if (current === generation) { more.disabled = false; root.removeAttribute('aria-busy'); }
    }
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); void load(false); });
  root.querySelector('[data-inbox-refresh]').addEventListener('click', () => void load(false));
  more.addEventListener('click', () => void load(true));
  all.addEventListener('click', async () => {
    if (!throughId) return;
    all.disabled = true;
    try {
      await request('/read-all', { method: 'POST', body: { throughId } });
      await load(false); message('Уведомления на момент загрузки отмечены прочитанными.');
    } catch (error) { message(error.message); all.disabled = false; }
  });
  document.addEventListener('sibdel:account-ready', () => {
    ready = true;
    if (inInbox()) void load(false); else void refreshBadge();
  });
  document.addEventListener('sibdel:account-view', () => {
    if (inInbox()) void load(false);
    else { ++generation; activeRequest?.abort(); }
  });
  const onReturn = () => {
    if (!ready || document.visibilityState !== 'visible' || Date.now() - badgeCheckedAt < 60000) return;
    if (inInbox()) void load(false); else void refreshBadge();
  };
  document.addEventListener('visibilitychange', onReturn);
  window.addEventListener('pagehide', () => {
    // Do not retain private history in a back/forward-cache snapshot.
    ++generation; activeRequest?.abort(); list.replaceChildren(); badge(0);
    cursor = null; throughId = null; badgeCheckedAt = 0;
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted && ready) {
      if (inInbox()) void load(false); else void refreshBadge();
    } else onReturn();
  });
}
