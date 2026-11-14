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
    configurerPreferencesNotification() {},
    configurerAnnuaire() {},
    configurerExplicationsSenior() {},
    modifierSynchronisationGoogle() {}
  };
  vm.runInNewContext([
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
