import { INSTALL_DELAY_MS, isStandalone, canShowIosHelp, nextVisit, installEligible } from './pwa-policy.js';

export function mountInstallOffer({ storagePrefix, icon, title, description }) {
  const visitKey = `${storagePrefix}:visit`;
  const installedKey = `${storagePrefix}:installed`;
  const get = (store, key) => { try { return window[store].getItem(key); } catch { return null; } };
  const set = (store, key, value) => { try { window[store].setItem(key, value); } catch { /* private storage */ } };
  let previous;
  try { previous = JSON.parse(get('sessionStorage', visitKey)); } catch { previous = null; }
  let visit = nextVisit(previous, Date.now());
  let promptEvent = null;
  let panel = null;
  let timer;
  let installed = get('localStorage', installedKey) === 'yes';
  const saveVisit = () => set('sessionStorage', visitKey, JSON.stringify(visit));
  const standalone = () => isStandalone(window);
  const markInstalled = () => {
    installed = true;
    set('localStorage', installedKey, 'yes');
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
      visible: document.visibilityState === 'visible',
    })) return;
    panel = document.createElement('aside');
    panel.className = 'pwa-panel pwa-panel--install';
    panel.setAttribute('aria-label', 'Установка приложения');
    panel.setAttribute('aria-live', 'polite');
    // Static, local markup only. No server/user values enter innerHTML.
    panel.innerHTML = `<img class="pwa-panel__icon" width="48" height="48" alt="">
      <div class="pwa-panel__content"><strong></strong>
      <p></p>
      <div class="pwa-panel__actions"><button class="pwa-panel__button" type="button" data-pwa-install>Установить</button>
      <button class="pwa-panel__link" type="button" data-pwa-later>Позже</button></div></div>
      <button class="pwa-panel__close" type="button" aria-label="Закрыть предложение установки" data-pwa-close>×</button>`;
    panel.querySelector('img').src = icon;
    panel.querySelector('strong').textContent = title;
    panel.querySelector('p').textContent = description;
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
    } else if (panel && canShowIosHelp(navigator)) {
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
    if (event.key === installedKey && event.newValue === 'yes') { installed = true; dismiss(); }
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
}
