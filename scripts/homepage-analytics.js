(() => {
  const measurementId = 'G-DNJJZ4FQCQ';
  const storageKey = 'generation-liaison-analytics-consent';
  const sessionKey = 'generation-liaison-mobile-session';
  const choiceLifetime = 180 * 24 * 60 * 60 * 1000;
  const disableKey = `ga-disable-${measurementId}`;
  const panel = document.getElementById('analytics-consent');
  const status = document.getElementById('analytics-status');
  let started = false;

  function showError(previousChoiceCouldRemain) {
    const message = 'Impossible d’enregistrer votre choix sur cet appareil. La mesure est désactivée.';
    const help = 'Effacez les données du site dans votre navigateur pour retirer un accord enregistré précédemment.';
    const translate = window.generationLiaisonTranslate || (value => value);
    status.textContent = translate(message) + (previousChoiceCouldRemain ? ` ${translate(help)}` : '');
    panel.hidden = false;
  }

  function readChoice() {
    try {
      const value = JSON.parse(localStorage.getItem(storageKey));
      if (value && ['accepted', 'rejected'].includes(value.choice) &&
          Number.isFinite(value.time) && value.time <= Date.now() &&
          Date.now() - value.time < choiceLifetime) return value.choice;
    } catch (error) {
      console.warn('Impossible de lire le choix de mesure d’audience.', error);
    }
    return null;
  }

  function clearAnalyticsCookies() {
    const names = ['_ga', `_ga_${measurementId.slice(2)}`];
    const hostname = window.location.hostname;
    const domain = hostname.split('.').slice(-2).join('.');
    for (const name of names) {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
      if (domain.includes('.')) {
        document.cookie = `${name}=; Max-Age=0; Path=/; Domain=${domain}; SameSite=Lax`;
      }
    }
  }

  function startAnalytics() {
    if (started || window.location.hash || window.location.search) return;
    try {
      if (localStorage.getItem(sessionKey)) return;
    } catch (error) {
      console.warn('Impossible de vérifier la session avant la mesure d’audience.', error);
      showError(false);
      return;
    }
    started = true;
    window[disableKey] = false;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('consent', 'default', {
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied'
    });
    window.gtag('js', new Date());
    window.gtag('config', measurementId, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_expires: 390 * 24 * 60 * 60,
      cookie_update: false,
      page_location: `${window.location.origin}/`,
      page_referrer: '',
      page_title: 'Génération Liaison'
    });
    const script = document.createElement('script');
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    script.onerror = () => {
      console.error('Impossible de charger Google Analytics.');
    };
    document.head.appendChild(script);
  }

  function choose(choice) {
    if (choice === 'rejected') {
      window[disableKey] = true;
      clearAnalyticsCookies();
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify({ choice, time: Date.now() }));
    } catch (error) {
      window[disableKey] = true;
      clearAnalyticsCookies();
      console.warn('Impossible d’enregistrer le choix de mesure d’audience.', error);
      let previousChoiceCouldRemain = false;
      try {
        localStorage.removeItem(storageKey);
      } catch (removeError) {
        previousChoiceCouldRemain = true;
        console.warn('Impossible de supprimer le choix précédent.', removeError);
      }
      if (started && !previousChoiceCouldRemain) {
        window.location.reload();
        return;
      }
      showError(previousChoiceCouldRemain);
      return;
    }
    status.textContent = '';
    panel.hidden = true;
    if (choice === 'accepted') startAnalytics();
    else if (started) window.location.reload();
  }

  window[disableKey] = true;
  document.getElementById('analytics-settings').addEventListener('click', () => {
    status.textContent = '';
    panel.hidden = false;
    document.getElementById('analytics-consent-title').focus();
  });
  document.getElementById('analytics-accept').addEventListener('click', () => choose('accepted'));
  document.getElementById('analytics-reject').addEventListener('click', () => choose('rejected'));
  window.addEventListener('storage', event => {
    if (event.key === sessionKey && event.newValue && started) {
      window[disableKey] = true;
      window.location.reload();
      return;
    }
    if ((event.key === storageKey || event.key === null) && readChoice() !== 'accepted') {
      window[disableKey] = true;
      clearAnalyticsCookies();
      if (started) window.location.reload();
    }
  });
  const choice = readChoice();
  if (choice === 'accepted') startAnalytics();
  else {
    clearAnalyticsCookies();
    panel.hidden = choice === 'rejected';
  }
})();
