import { pushFetch, preparePush, connectPush, disconnectPush } from './push-client.js';
const root = document.querySelector('[data-push-settings]');
if (root) void boot();
async function boot() {
  const base = '/api/push';
  const status = root.querySelector('[data-push-status]');
  const enable = root.querySelector('[data-push-enable]');
  const list = root.querySelector('[data-push-devices]');
  const marketing = root.querySelector('[data-push-marketing-status]');
  const grant = root.querySelector('[data-push-consent-form]');
  const revoke = root.querySelector('[data-push-revoke]');
  let config, registration;
  const message = (text) => { status.textContent = text; };
  const refresh = async () => {
    const [p, d] = await Promise.all([pushFetch(base, '/preferences'), pushFetch(base, '/devices')]);
    root.querySelector('[name=orders]').checked = p.preferences.orders;
    root.querySelector('[name=subscriptions]').checked = p.preferences.subscriptions;
    marketing.textContent = p.preferences.marketing ? 'Рекламное согласие действует.' : 'Рекламные PUSH отключены.';
    grant.hidden = p.preferences.marketing || !config.marketingEnabled;
    revoke.hidden = !p.preferences.marketing;
    list.replaceChildren();
    for (const device of d.devices) {
      const item = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = `Устройство №${device.id}${device.current ? ' · этот вход' : ''}${device.disabledAt ? ' · недействительно, удалите и подключите снова' : ''}`;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'account-button account-button--soft'; button.textContent = 'Отключить';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try { await disconnectPush(base, device); await refresh(); message('Устройство отключено.'); }
        catch (error) { message(error.message); button.disabled = false; }
      });
      item.append(text, button); list.append(item);
    }
  };
  try {
    config = await pushFetch(base, '/config');
    root.querySelector('[data-push-consent-text]').textContent = config.consentText;
    root.querySelector('[data-push-controls]').hidden = false;
    await refresh();
    if (!config.enabled) message('PUSH пока не включены владельцем. Рекламное согласие можно отозвать здесь.');
    else try { registration = await preparePush(); enable.disabled = false; message('Подключите это устройство, чтобы получать уведомления о заказах.'); }
    catch (error) { message(error.message); }
  } catch (error) { message(error.message); return; }
  enable.addEventListener('click', async () => {
    // Direct user gesture; no permission prompts on page load.
    const permission = Notification.permission === 'granted' ? Promise.resolve('granted') : Notification.requestPermission();
    enable.disabled = true;
    try { await connectPush(base, config, registration, permission); await refresh(); message('Это устройство подключено. Реклама включается отдельным согласием.'); }
    catch (error) { message(error.message); }
    finally { enable.disabled = false; }
  });
  root.querySelector('[data-push-service-form]').addEventListener('submit', async (event) => {
    event.preventDefault();
    try { await pushFetch(base, '/preferences', 'PUT', { orders: root.querySelector('[name=orders]').checked, subscriptions: root.querySelector('[name=subscriptions]').checked }); message('Сервисные категории сохранены.'); }
    catch (error) { message(error.message); }
  });
  grant.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!grant.reportValidity()) return;
    try { await pushFetch(base, '/consent', 'POST', { granted: true, version: config.consentVersion }); grant.reset(); await refresh(); message('Согласие сохранено.'); }
    catch (error) { message(error.message); }
  });
  revoke.addEventListener('click', async () => {
    try { await pushFetch(base, '/consent', 'POST', { granted: false, version: config.consentVersion }); await refresh(); message('Согласие отозвано. Ожидающие рекламные отправки отменены.'); }
    catch (error) { message(error.message); }
  });
}
