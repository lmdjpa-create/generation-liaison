const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
const start = source.indexOf('    function afficherAvatarProfil()');
const end = source.indexOf('    function reinitialiserTachesPartagees()', start);
assert.ok(start >= 0 && end > start);

function createProfile() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', checked: false, hidden: false, textContent: '' });
    return elements.get(id);
  };
  const image = { hidden: true, removeAttribute() { delete this.src; } };
  const fallback = { hidden: false, textContent: '' };
  const revoked = [];
  let resolveFetch;
  const context = {
    document: {
      getElementById: element,
      querySelectorAll: () => [{ querySelector: selector => selector === 'img' ? image : fallback }]
    },
    window: { generationLiaisonTranslate: value => value },
    URL: { createObjectURL: () => 'blob:profile', revokeObjectURL: url => revoked.push(url) },
    SERVER_URL: '',
    authHeaders: () => ({ Authorization: 'Bearer test' }),
    console: { error() {} },
    fetch: () => new Promise(resolve => { resolveFetch = resolve; })
  };
  vm.runInNewContext(`
    let connectedUser = null, accountPhotoObjectUrl = null, accountProfileRevision = 0, accountPhotoLoadId = 0;
    ${source.slice(start, end)}
    globalThis.setUser = user => { connectedUser = user; reinitialiserProfil(); };
    globalThis.load = chargerPhotoProfil;
    globalThis.checkFile = verifierPhotoProfil;
  `, context);
  return { context, element, image, fallback, revoked, resolveFetch: value => resolveFetch(value) };
}

test('profile avatars follow civility, load privately and clear on logout', async () => {
  const app = createProfile();
  app.context.setUser({ role: 'aidant', civility: 'mrs', hasAccountPhoto: true });
  assert.equal(app.fallback.textContent, '👩');
  const loading = app.context.load();
  app.resolveFetch({ ok: true, blob: async () => ({}) });
  assert.equal(await loading, true);
  assert.equal(app.image.src, 'blob:profile');
  assert.equal(app.fallback.hidden, true);
  app.context.setUser(null);
  assert.equal(app.image.hidden, true);
  assert.equal(app.fallback.textContent, '🧑');
  assert.deepEqual(app.revoked, ['blob:profile']);
});

test('late profile downloads cannot replace a different account and invalid files are rejected', async () => {
  const app = createProfile();
  app.context.setUser({ role: 'senior', civility: 'mr', hasAccountPhoto: true });
  const loading = app.context.load();
  app.context.setUser({ role: 'pro', civility: 'mrs', hasAccountPhoto: false });
  app.resolveFetch({ ok: true, blob: async () => ({}) });
  assert.equal(await loading, false);
  assert.equal(app.fallback.textContent, '👩');
  assert.equal(app.image.hidden, true);
  assert.throws(() => app.context.checkFile({ type: 'image/svg+xml', size: 12 }));
  assert.throws(() => app.context.checkFile({ type: 'image/png', size: 2 * 1024 * 1024 + 1 }));
  assert.doesNotThrow(() => app.context.checkFile({ type: 'image/jpeg', size: 1 }));
});

test('settings reflect the saved photo-sharing choice', () => {
  const app = createProfile();
  app.context.setUser({ role: 'aidant', shareAccountPhoto: true });
  assert.equal(app.element('account-photo-sharing').checked, true);
  app.context.setUser({ role: 'aidant', shareAccountPhoto: false });
  assert.equal(app.element('account-photo-sharing').checked, false);
});
