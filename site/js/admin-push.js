import { pushFetch, preparePush, connectPush, disconnectPush } from './push-client.js';
const root = document.querySelector('[data-push-admin]');
if (root) void boot();
async function boot() {
  const base = '/api/admin/push';
  const status = root.querySelector('[data-push-status]');
  const enable = root.querySelector('[data-push-enable]');
  const form = root.querySelector('[data-push-campaign-form]');
  const history = root.querySelector('[data-push-history]');
  let config, registration, deviceId, page = 1, totalPages = 1, draftKey = crypto.randomUUID(), testKey = crypto.randomUUID();
  const message = (value) => { status.textContent = value; };
  const api = (path, method, data) => pushFetch(base, path, method, data);
  const content = () => ({ title: form.elements.title.value.trim(), body: form.elements.body.value.trim(),
    url: form.elements.url.value.trim(), imageUrl: form.elements.imageUrl.value.trim() || null });
  const button = (text, action) => {
    const element = document.createElement('button'); element.type = 'button'; element.className = 'admin-button admin-button--secondary'; element.textContent = text;
    element.addEventListener('click', async () => {
      element.disabled = true;
      try { await action(); } catch (error) { message(error.message); }
      finally { element.disabled = false; }
    }); return element;
  };
  async function devices() {
    const data = await api('/devices');
    const list = root.querySelector('[data-push-devices]'); list.replaceChildren(); deviceId = null;
    for (const d of data.devices) {
      if (d.current && !d.disabledAt) deviceId = d.id;
      const item = document.createElement('li'); item.append(`Устройство №${d.id}${d.current ? ' · этот вход' : ''}${d.disabledAt ? ' · недействительно' : ''} `,
        button('Отключить', async () => { await disconnectPush(base, d); await devices(); message('Устройство отключено.'); })); list.append(item);
    }
  }
  async function refresh() {
    const data = await api(`/campaigns?page=${page}`); totalPages = data.totalPages;
    history.replaceChildren();
    const labels = { DRAFT: 'Черновик', SCHEDULED: 'Запланирована', PROCESSING: 'Формируются получатели', QUEUED: 'В очереди', COMPLETED: 'Обработка завершена', CANCELLED: 'Отменена' };
    const jobs = { PENDING: 'Ожидают', SENDING: 'Отправляются', ACCEPTED: 'Принято сервисом', SKIPPED: 'Пропущено', FAILED: 'Ошибка', UNKNOWN: 'Результат неизвестен' };
    for (const campaign of data.campaigns) {
      const item = document.createElement('article'); item.className = 'admin-push__campaign';
      const title = document.createElement('h3'); title.textContent = `№${campaign.id} · ${campaign.title}`;
      const body = document.createElement('p'); body.textContent = campaign.body;
      const state = document.createElement('p'); state.textContent = labels[campaign.status] || campaign.status;
      const detail = document.createElement('p'); detail.textContent = `Получатели: ${campaign.recipients}; клики: ${campaign.clicks}. ` + campaign.jobs.map((j) => `${jobs[j.status] || j.status}: ${j._count._all}`).join('; ');
      const errors = document.createElement('p'); errors.textContent = campaign.errors.map((e) => `${e.errorCode}: ${e._count._all}`).join('; ');
      const link = document.createElement('a'); link.href = campaign.url; link.textContent = campaign.url; link.target = '_blank'; link.rel = 'noopener';
      item.append(title, body, state, detail, errors, link);
      if (campaign.scheduledAt) {
        const time = document.createElement('p'); time.textContent = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Krasnoyarsk' }).format(new Date(campaign.scheduledAt)); item.append(time);
      }
      const actions = document.createElement('div'); actions.className = 'admin-push__actions';
      if (campaign.status === 'DRAFT') {
        actions.append(button('Отправить сейчас', async () => {
          if (!confirm('Запустить рекламную рассылку выбранной группе покупателей с действующим согласием?')) return;
          await api(`/campaigns/${campaign.id}/schedule`, 'POST', {}); await refresh(); message('Рассылка поставлена в очередь серверного обработчика.');
        }));
        const label = document.createElement('label'); label.textContent = 'Время отправки (Красноярск) ';
        const at = document.createElement('input'); at.type = 'datetime-local'; label.append(at); actions.append(label);
        actions.append(button('Запланировать', async () => {
          if (!at.value) throw Error('Выберите дату и время.');
          const date = new Date(`${at.value}:00+07:00`);
          if (!Number.isFinite(+date)) throw Error('Некорректное время.');
          await api(`/campaigns/${campaign.id}/schedule`, 'POST', { at: date.toISOString() }); await refresh(); message('Отправка запланирована.');
        }));
      }
      if (['DRAFT','SCHEDULED'].includes(campaign.status)) actions.append(button('Отменить', async () => { await api(`/campaigns/${campaign.id}/cancel`, 'POST', {}); await refresh(); message('Рассылка отменена.'); }));
      item.append(actions); history.append(item);
    }
    if (!data.campaigns.length) history.textContent = 'Рассылок пока нет.';
    root.querySelector('[data-push-page]').textContent = `${page} / ${totalPages}`;
    root.querySelector('[data-push-prev]').disabled = page <= 1;
    root.querySelector('[data-push-next]').disabled = page >= totalPages;
  }
  try {
    config = await api('/config');
    await Promise.all([devices(), refresh()]);
    if (config.enabled) {
      try { registration = await preparePush(); enable.disabled = false; message('Можно подключить устройство и отправить тест.'); }
      catch (error) { message(error.message); }
    } else message('PUSH выключены. Черновики доступны; отправка требует настройки VAPID и PUSH_ENABLED.');
  } catch (error) { message(error.message); return; }
  enable.addEventListener('click', async () => {
    const permission = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    enable.disabled = true;
    try { await connectPush(base, config, registration, permission); await devices(); message('Устройство подключено.'); }
    catch (error) { message(error.message); }
    finally { enable.disabled = false; }
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const save = form.querySelector('[type=submit]'); save.disabled = true;
    try { await api('/campaigns', 'POST', { ...content(), audience: form.elements.audience.value, requestKey: draftKey }); draftKey = crypto.randomUUID(); await refresh(); message('Черновик сохранён. Проверьте его и выберите отправку.'); }
    catch (error) { message(error.message); }
    finally { save.disabled = false; }
  });
  root.querySelector('[data-push-test]').addEventListener('click', async () => {
    if (!deviceId) { message('Подключите своё устройство в этом окне.'); return; }
    if (!form.reportValidity()) return;
    try { await api('/test', 'POST', { ...content(), deviceId, requestKey: testKey }); testKey = crypto.randomUUID(); message('Тест поставлен в очередь. Дождитесь запуска серверного обработчика.'); }
    catch (error) { message(error.message); }
  });
  root.querySelector('[data-push-refresh]').addEventListener('click', () => { void refresh().catch((error) => message(error.message)); });
  root.querySelector('[data-push-prev]').addEventListener('click', () => { if (page > 1) { page--; void refresh().catch((e) => message(e.message)); } });
  root.querySelector('[data-push-next]').addEventListener('click', () => { if (page < totalPages) { page++; void refresh().catch((e) => message(e.message)); } });
}
