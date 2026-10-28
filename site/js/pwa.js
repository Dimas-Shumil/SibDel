import { INSTALL_DELAY_MS, isStandalone, canShowIosHelp, nextVisit,
  excludedPath, installEligible } from './pwa-policy.js';

const excluded = excludedPath(location.pathname);
if (!excluded && window.isSecureContext && 'serviceWorker' in navigator) {
  boot();
}

function boot() {
  const VISIT_KEY = 'sibdel:pwa:visit';
  const INSTALLED_KEY = 'sibdel:pwa:installed';
  const get = (store, key) => { try { return window[store].getItem(key); } catch { return null; } };
  const set = (store, key, value) => { try { window[store].setItem(key, value); } catch { /* private storage */ } };
  let previous;
  try { previous = JSON.parse(get('sessionStorage', VISIT_KEY)); } catch { previous = null; }
  let visit = nextVisit(previous, Date.now());
  let promptEvent = null;
  let panel = null;
  let timer;
  let installed = get('localStorage', INSTALLED_KEY) === 'yes';
  const saveVisit = () => set('sessionStorage', VISIT_KEY, JSON.stringify(visit));
  const standalone = () => isStandalone(window);
  const markInstalled = () => {
    installed = true;
    set('localStorage', INSTALLED_KEY, 'yes');
    dismiss();
  };
  const persistHandled = () => { visit.handled = true; visit.lastSeen = Date.now(); saveVisit(); };
  function dismiss() {
    persistHandled();
    if (panel) { panel.remove(); panel = null; }
  }
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(maybeShow, Math.max(0, INSTALL_DELAY_MS - (Date.now() - visit.startedAt)));
  }
  function maybeShow() {
    if (panel || !installEligible({
      standalone: standalone(), installed, handled: visit.handled,
      elapsed: Date.now() - visit.startedAt,
      supported: Boolean(promptEvent) || canShowIosHelp(navigator),
      visible: document.visibilityState === 'visible', excluded,
    })) return;
    panel = document.createElement('aside');
    panel.className = 'pwa-panel pwa-panel--install';
    panel.setAttribute('aria-label', 'Установка приложения');
    panel.setAttribute('aria-live', 'polite');
    // Static, local markup only. No server/user values enter innerHTML.
    panel.innerHTML = `<img class="pwa-panel__icon" src="/pwa/icon-192.png" width="48" height="48" alt="">
      <div class="pwa-panel__content"><strong>Сибирские Деликатесы</strong>
      <p>Каталог и заказы — рядом, на экране телефона.</p>
      <div class="pwa-panel__actions"><button class="pwa-panel__button" type="button" data-pwa-install>Установить</button>
      <button class="pwa-panel__link" type="button" data-pwa-later>Позже</button></div></div>
      <button class="pwa-panel__close" type="button" aria-label="Закрыть предложение установки" data-pwa-close>×</button>`;
    panel.querySelector('[data-pwa-close]').addEventListener('click', dismiss);
    panel.querySelector('[data-pwa-later]').addEventListener('click', dismiss);
    panel.querySelector('[data-pwa-install]').addEventListener('click', install);
    let start = null;
    panel.addEventListener('pointerdown', (event) => { start = { x: event.clientX, y: event.clientY }; });
    panel.addEventListener('pointermove', (event) => {
      if (start && start.y - event.clientY > 45 && Math.abs(start.x - event.clientX) < 80) dismiss();
    });
    panel.addEventListener('pointerup', (event) => {
      if (start && start.y - event.clientY > 45 && Math.abs(start.x - event.clientX) < 80) dismiss();
      start = null;
    });
    panel.addEventListener('pointercancel', () => { start = null; });
    panel.addEventListener('keydown', (event) => { if (event.key === 'Escape') dismiss(); });
    document.body.append(panel);
    // One automatic promotion per visit, even after an internal navigation.
    persistHandled();
  }
  async function install() {
    if (promptEvent) {
      const event = promptEvent;
      promptEvent = null;
      dismiss();
      try {
        // prompt() is called synchronously inside the click handler.
        await event.prompt();
        const choice = await event.userChoice;
        if (choice.outcome === 'accepted') markInstalled();
      } catch { /* Browser may withdraw installability; a later visit can retry. */ }
    } else if (canShowIosHelp(navigator)) {
      panel.classList.add('pwa-panel--help');
      const content = panel.querySelector('.pwa-panel__content');
      content.querySelector('p').textContent = 'В Safari откройте «Поделиться» (квадрат со стрелкой вверх), выберите «На экран Домой» и нажмите «Добавить». При необходимости прокрутите список действий. После установки может потребоваться войти снова.';
      panel.querySelector('[data-pwa-install]').remove();
      panel.querySelector('[data-pwa-later]').textContent = 'Понятно';
    }
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    promptEvent = event;
    schedule();
  });
  window.addEventListener('appinstalled', markInstalled);
  window.addEventListener('storage', (event) => {
    if (event.key === INSTALLED_KEY && event.newValue === 'yes') { installed = true; dismiss(); }
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', () => {
    if (standalone()) markInstalled();
  });
  const activity = () => {
    if (document.visibilityState !== 'visible') return;
    const oldStart = visit.startedAt;
    visit = nextVisit(visit, Date.now());
    saveVisit();
    if (visit.startedAt !== oldStart || !visit.handled) schedule();
  };
  document.addEventListener('visibilitychange', activity);
  window.addEventListener('pageshow', activity);
  window.addEventListener('pagehide', () => { visit.lastSeen = Date.now(); saveVisit(); });
  setInterval(activity, 60_000);
  saveVisit();
  if (standalone()) markInstalled();
  schedule();

  // Let updates wait until all existing tabs/apps close. Never reload a form.
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((registration) => {
      const showUpdate = () => {
        if (!registration.waiting || document.querySelector('[data-pwa-update]')) return;
        const notice = document.createElement('aside');
        notice.className = 'pwa-panel pwa-panel--update';
        notice.dataset.pwaUpdate = '';
        notice.setAttribute('aria-label', 'Обновление приложения');
        notice.innerHTML = `<div class="pwa-panel__content"><strong>Обновление готово</strong>
          <p>Оно включится, когда вы закроете все вкладки сайта и приложение, затем откроете снова.</p></div>
          <button class="pwa-panel__close" type="button" aria-label="Закрыть сообщение об обновлении">×</button>`;
        notice.querySelector('button').addEventListener('click', () => notice.remove());
        document.body.append(notice);
      };
      showUpdate();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdate();
        });
      });
      // Browser also checks on navigation. Avoid periodic background traffic.
      window.addEventListener('pageshow', () => { void registration.update().catch(() => {}); });
    }).catch(() => { /* Store remains usable without SW/private browser storage. */ });
}
