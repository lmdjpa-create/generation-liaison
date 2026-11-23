const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

function extract(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return source.slice(first, last);
}

function createApp(response) {
  const ids = new Set([...source.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
  const elements = new Map();
  const element = id => {
    if (!ids.has(id)) return null;
    if (!elements.has(id)) {
      elements.set(id, {
        style: {}, value: '', textContent: '', listeners: {},
        addEventListener(type, handler) { this.listeners[type] = handler; },
        querySelector() { return { disabled: false }; },
        replaceChildren() {}
      });
    }
    return elements.get(id);
  };
  const storage = new Map([['generation-liaison-mobile-session', 'valid-token']]);
  const calls = [];
  const context = {
    document: { getElementById: element, addEventListener() {} },
    window: { location: { search: '' }, addEventListener() {} },
    navigator: {},
    localStorage: {
      getItem: key => storage.get(key) || null,
      removeItem: key => storage.delete(key)
    },
    console: { error() {} },
    URLSearchParams,
    SERVER_URL: '',
    SESSION_KEY: 'generation-liaison-mobile-session',
    USER_KEY: 'generation-liaison-mobile-user',
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (response instanceof Error) throw response;
      return response;
    },
    setAuthenticatedView: async user => calls.push({ user }),
    showToast: (message, success) => calls.push({ message, success }),
    configurerFormulairesCoordination() {},
    configurerAlbumJournal() {},
    configurerDicteeMessagerie() {},
    configurerLectureSenior() {},
    configurerProfil() {},
    configurerTuilesAidant() {},
    configurerPreferencesNotification() {},
    configurerAnnuaire() {},
    configurerExplicationsSenior() {},
    afficherProchainRendezVous() {},
    surveillerNotificationsVisibles() {},
    modifierSynchronisationGoogle() {}
  };
  vm.runInNewContext([
    extract('    function basculerFormulaire(estInscription)', '    function afficherChampsInscriptionProfessionnel()'),
    extract('    function afficherConnexionInitiale()', '    async function copierLienConnexionEtablissement()'),
    extract('    async function readResponse(response)', '    async function planningRequest'),
    extract('    function configurerFormulairesInformationsPersonne()', '    async function modifierConsentement'),
    extract('    async function initApp()', "    window.addEventListener('DOMContentLoaded', initApp);"),
    'globalThis.start = initApp;'
  ].join('\n'), context);
  return { context, storage, calls, element };
}

test('startup registers existing note forms and restores the authenticated session', async () => {
  const user = { id: 'senior', role: 'senior' };
  const app = createApp({ ok: true, json: async () => ({ user }) });
  await app.context.start();
  assert.equal(typeof app.element('senior-person-note-form').listeners.submit, 'function');
  assert.equal(typeof app.element('aidant-person-note-form').listeners.submit, 'function');
  assert.equal(app.element('pro-person-note-form'), null);
  assert.equal(app.calls[0].url, '/api/auth/me');
  assert.equal(app.calls[0].options.headers.Authorization, 'Bearer valid-token');
  assert.deepEqual(app.calls[1].user, user);
  assert.equal(app.storage.get('generation-liaison-mobile-session'), 'valid-token');
});

test('registration link opens the form only for visitors without a session', async () => {
  const visitor = createApp();
  visitor.storage.delete('generation-liaison-mobile-session');
  visitor.context.window.location.hash = '#inscription';
  await visitor.context.start();
  assert.equal(visitor.element('register-section').style.display, 'block');
  assert.equal(visitor.element('login-section').style.display, 'none');
  assert.equal(visitor.calls.length, 0);

  const expired = createApp({ ok: false, json: async () => ({ error: 'Votre session a expiré. Reconnectez-vous.' }) });
  expired.context.window.location.hash = '#inscription';
  await expired.context.start();
  assert.equal(expired.storage.has('generation-liaison-mobile-session'), false);
  assert.equal(expired.element('register-section').style.display, 'block');

  const user = { id: 'senior', role: 'senior' };
  const connected = createApp({ ok: true, json: async () => ({ user }) });
  connected.context.window.location.hash = '#inscription';
  await connected.context.start();
  assert.deepEqual(connected.calls[1].user, user);
  assert.notEqual(connected.element('register-section').style.display, 'block');

  const unavailable = createApp(new Error('Serveur inaccessible'));
  unavailable.context.window.location.hash = '#inscription';
  await unavailable.context.start();
  assert.equal(unavailable.storage.has('generation-liaison-mobile-session'), true);
  assert.notEqual(unavailable.element('register-section').style.display, 'block');
});

test('startup removes an expired session but retains it on a temporary failure', async () => {
  for (const [response, retained] of [
    [{ ok: false, json: async () => ({ error: 'Votre session a expiré. Reconnectez-vous.' }) }, false],
    [new Error('Serveur inaccessible'), true]
  ]) {
    const app = createApp(response);
    await app.context.start();
    assert.equal(app.storage.has('generation-liaison-mobile-session'), retained);
    assert.equal(app.element('auth-box').style.display, 'block');
    assert.equal(app.element('nav-bar').style.display, 'none');
    assert.equal(app.calls.some(call => call.user), false);
  }
});

test('establishment sign-in link opens only without an active session', async () => {
  const visitor = createApp();
  visitor.storage.delete('generation-liaison-mobile-session');
  visitor.context.window.location.hash = '#connexion-etablissement';
  await visitor.context.start();
  assert.equal(visitor.element('resident-login-section').style.display, 'block');
  assert.equal(visitor.element('login-section').style.display, 'none');

  const connected = createApp({ ok: true, json: async () => ({ user: { id: 'director', role: 'establishment' } }) });
  connected.context.window.location.hash = '#connexion-etablissement';
  await connected.context.start();
  assert.notEqual(connected.element('resident-login-section').style.display, 'block');
  assert.equal(connected.calls[1].user.id, 'director');
});
