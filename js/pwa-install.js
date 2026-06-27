(function () {
  if (sessionStorage.getItem('pwa-dismissed')) return;
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator.standalone === true) return;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  let deferredPrompt = null;

  function createBanner(message, buttonLabel, onInstall) {
    const banner = document.createElement('div');
    banner.id = 'pwa-banner';
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <span class="pwa-banner-icon">📲</span>
        <div class="pwa-banner-text">
          <strong>Instalar EuroPool</strong>
          <span>${message}</span>
        </div>
        ${buttonLabel ? `<button class="pwa-banner-btn" id="pwa-install-btn">${buttonLabel}</button>` : ''}
      </div>
      <button class="pwa-banner-close" id="pwa-dismiss" aria-label="Fechar">✕</button>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-dismiss').addEventListener('click', () => {
      banner.remove();
      sessionStorage.setItem('pwa-dismissed', '1');
    });

    if (buttonLabel) {
      document.getElementById('pwa-install-btn').addEventListener('click', onInstall);
    }

    setTimeout(() => banner.classList.add('pwa-banner-visible'), 100);
  }

  if (isIOS) {
    createBanner('No Safari, toca em ⎙ → "Adicionar ao ecrã inicial"', null, null);
    return;
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    createBanner('Usa como app — abre mais rápido, sem browser.', 'Instalar', async () => {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') {
        document.getElementById('pwa-banner')?.remove();
        sessionStorage.setItem('pwa-dismissed', '1');
      }
    });
  });
})();
