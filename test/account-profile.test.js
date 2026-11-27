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

test('each profile avatar opens the photo chooser in profile settings', () => {
  const avatars = [...source.matchAll(/<button\b[^>]*class="[^"]*\baccount-avatar\b[^"]*"[^>]*>/g)];
  assert.equal(avatars.length, 4);
  for (const [avatar] of avatars) {
    assert.match(avatar, /type="button"/);
    assert.match(avatar, /aria-label="Ajouter ou modifier ma photo de profil"/);
    assert.match(avatar, /onclick="ouvrirPhotoProfil\(\)"/);
  }
  const begin = source.indexOf('    function ouvrirPhotoProfil()');
  const finish = source.indexOf('    function afficherAvatarProfil()', begin);
  assert.ok(begin >= 0 && finish > begin);
  for (const role of ['senior', 'aidant', 'pro']) {
    let active = false;
    let chooser = 0;
    let navigations = 0;
    const details = { open: false, scrollIntoView() {} };
    const context = {
      document: {
        getElementById: id => id === 'screen-settings'
          ? { classList: { contains: () => active } }
          : { click: () => { chooser++; } },
        querySelector: () => details
      },
      switchScreen: screen => { assert.equal(screen, 'settings'); active = true; navigations++; }
    };
    vm.runInNewContext(`let connectedUser = { role: ${JSON.stringify(role)} }; ${source.slice(begin, finish)}; ouvrirPhotoProfil(); ouvrirPhotoProfil();`, context);
    assert.equal(navigations, 1);
    assert.equal(details.open, true);
    assert.equal(chooser, 2);
  }
});

test('profile errors use translated fallbacks without changing server messages', async () => {
  const begin = source.indexOf('    function configurerProfil()');
  const end = source.indexOf('    let tabletSettingsRevision', begin);
  assert.ok(begin >= 0 && end > begin);
  const handlers = {};
  const uploadButton = { disabled: false };
  const elements = {
    'account-profile-status': { textContent: '' },
    'account-profile-form': { addEventListener: (name, fn) => { handlers.profile = fn; } },
    'account-photo-form': { addEventListener: (name, fn) => { handlers.photo = fn; } },
    'account-photo-delete': { disabled: false, addEventListener: (name, fn) => { handlers.delete = fn; } },
    'account-civility': { value: 'unspecified' },
    'account-photo-sharing': { checked: false },
    'account-photo-file': { files: [{ type: 'image/png', size: 1 }] }
  };
  const translations = {
    'Impossible de modifier votre profil.': 'Unable to update your profile.',
    'Impossible d’enregistrer votre photo de profil.': 'Unable to save your profile photo.',
    'Impossible de supprimer votre photo de profil.': 'Unable to delete your profile photo.'
  };
  let error = new Error('');
  const context = {
    document: {
      getElementById: id => elements[id],
      querySelector: () => uploadButton
    },
    window: {
      generationLiaisonTranslate: text => translations[text] || text,
      generationLiaisonTranslateError: (message, fallback) => message || translations[fallback] || fallback
    },
    connectedUser: { role: 'senior' },
    accountProfileRevision: 0,
    planningRequest: async () => { throw error; },
    enregistrerPhotoProfil: async () => { throw error; }
  };
  vm.runInNewContext(`${source.slice(begin, end)}; configurerProfil();`, context);
  await handlers.profile({ preventDefault() {} });
  assert.equal(elements['account-profile-status'].textContent, translations['Impossible de modifier votre profil.']);
  await handlers.photo({ preventDefault() {}, currentTarget: { querySelector: () => uploadButton } });
  assert.equal(elements['account-profile-status'].textContent, translations['Impossible d’enregistrer votre photo de profil.']);
  assert.equal(uploadButton.disabled, false);
  await handlers.delete({ currentTarget: elements['account-photo-delete'] });
  assert.equal(elements['account-profile-status'].textContent, translations['Impossible de supprimer votre photo de profil.']);
  error = new Error('Détail du serveur');
  await handlers.profile({ preventDefault() {} });
  assert.equal(elements['account-profile-status'].textContent, 'Détail du serveur');
});
