const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

test('tablet prices appear with each choice in registration and settings', () => {
  for (const [value, price] of [
    ['purchase', /299 € TTC/],
    ['purchase_premium', /299 € TTC.*Premium à venir \(tarif à définir\)/],
    ['rental_premium', /25 € HT \/ mois sur 12 mois.*Premium à venir \(tarif à définir\)/]
  ]) {
    const options = [...source.matchAll(new RegExp(`<option value="${value}">([^<]+)</option>`, 'g'))]
      .map(match => match[1]).filter(label => label.includes('Premium') || label.includes('Achat seul'));
    assert.equal(options.length, 2, value);
    for (const option of options) assert.match(option, price);
  }
});

function createRegistration(role = 'aidant') {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, disabled: false, checked: false, files: [],
      textContent: '', validity: { valid: true },
      focus() { focused = id; },
      querySelector() { return { focus() { focused = id; } }; }
    });
    return elements.get(id);
  };
  let focused;
  const fields = {
    'reg-role': role, 'reg-first-name': 'Marie', 'reg-last-name': 'Martin',
    'reg-email': 'marie@example.com', 'reg-password': 'un-code-secret',
    'reg-confirm-password': 'un-code-secret', 'reg-service-radius': '30',
    'reg-tablet-interest': 'none'
  };
  for (const [id, value] of Object.entries(fields)) get(id).value = value;
  get('reg-role').options = [{ text: role }];
  get('reg-role').selectedIndex = 0;
  get('reg-tablet-interest').options = [{ text: 'Choix de tablette' }];
  get('reg-tablet-interest').selectedIndex = 0;
  get('reg-account-city-select').hidden = true;
  let submissions = 0;
  const context = {
    document: { getElementById: get },
    window: { generationLiaisonTranslate: text => text },
    registrationHomeCoordinates: { latitude: 48, longitude: 2 },
    verifierPhotoProfil(file) { if (file.type !== 'image/png') throw new Error('Photo invalide.'); },
    choisirCommune: async () => ({ name: 'Paris' }),
    soumettreInscription: async () => { submissions++; }
  };
  const start = source.indexOf('    let registrationStep = 1;');
  const end = source.indexOf('    function messageErreurPosition(', start);
  const submitStart = source.indexOf('    async function inscrireUtilisateur()');
  const submitEnd = source.indexOf('    async function soumettreInscription()', submitStart);
  assert.ok(start >= 0 && end > start && submitEnd > submitStart);
  vm.runInNewContext(source.slice(start, end) + source.slice(submitStart, submitEnd), context);
  return { context, get, focused: () => focused, submissions: () => submissions };
}

test('a profile must be selected when registration is not opened from a profile link', async () => {
  assert.match(source, /<select id="reg-role">\s*<option value="">Choisissez votre profil<\/option>/);
  const app = createRegistration('');
  await app.context.etapeSuivanteInscription();
  assert.notEqual(app.get('reg-progress').value, 2);
  assert.equal(app.focused(), 'reg-role');
  assert.match(app.get('reg-step-error').textContent, /Choisissez un type de compte/);
  app.get('reg-role').value = 'senior';
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-progress').value, 2);
  assert.match(source, /document\.getElementById\('reg-role'\)\.value = '';/);
});

test('four steps preserve values and files while navigating back and validate confirmation', async () => {
  const app = createRegistration('pro');
  const file = { type: 'application/pdf', size: 10 };
  app.get('reg-account-photo').files = [{ type: 'image/png', size: 10 }];
  app.get('reg-identity-document').files = [file];
  app.get('reg-kbis-document').files = [file];
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-progress').value, 2);
  app.get('reg-confirm-password').value = 'different';
  app.context.actualiserConfirmationInscription();
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-progress').value, 2);
  assert.match(app.get('reg-step-error').textContent, /ne correspondent pas/);
  assert.equal(app.focused(), 'reg-confirm-password');
  app.get('reg-confirm-password').value = 'un-code-secret';
  app.context.actualiserConfirmationInscription();
  assert.match(app.get('reg-password-status').textContent, /correspondent/);
  await app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-progress').value, 4);
  assert.doesNotMatch(app.get('reg-summary').textContent, /un-code-secret/);
  app.context.etapePrecedenteInscription();
  app.context.etapePrecedenteInscription();
  assert.equal(app.get('reg-confirm-password').value, 'un-code-secret');
  assert.equal(app.get('reg-kbis-document').files[0], file);
  assert.equal(app.get('reg-progress').value, 2);
});

test('each profile retains its own required information and commune errors stay on step three', async () => {
  for (const role of ['senior', 'aidant', 'pro', 'establishment']) {
    const app = createRegistration(role);
    if (role === 'pro') {
      app.get('reg-account-photo').files = [{ type: 'image/png' }];
      app.get('reg-identity-document').files = [{ type: 'application/pdf', size: 10 }];
      app.get('reg-kbis-document').files = [{ type: 'application/pdf', size: 10 }];
    }
    await app.context.etapeSuivanteInscription();
    await app.context.etapeSuivanteInscription();
    if (role === 'aidant') {
      app.get('reg-legal-guardian').checked = true;
      await app.context.etapeSuivanteInscription();
      assert.equal(app.get('reg-progress').value, 3);
      app.get('reg-guardian-identity').files = [{ type: 'application/pdf', size: 10 }];
      app.get('reg-guardian-proof').files = [{ type: 'application/pdf', size: 10 }];
    }
    if (role === 'senior') {
      app.context.choisirCommune = async () => { throw new Error('Choisissez une commune.'); };
      await app.context.etapeSuivanteInscription();
      assert.equal(app.get('reg-progress').value, 3);
      assert.match(app.get('reg-step-error').textContent, /commune/);
      app.context.choisirCommune = async () => ({ name: 'Paris' });
    }
    await app.context.etapeSuivanteInscription();
    assert.equal(app.get('reg-progress').value, 4, role);
  }
});

test('multiple account communes explain how to continue without hiding other errors', async () => {
  const app = createRegistration('senior');
  await app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  app.context.choisirCommune = async () => {
    app.get('reg-account-city-select').hidden = false;
    throw new Error('Choisissez une commune dans la liste, puis relancez la recherche.');
  };
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-progress').value, 3);
  assert.equal(app.get('reg-step-error').textContent, 'Choisissez votre commune dans la liste, puis appuyez sur Continuer.');
  assert.equal(app.focused(), 'reg-account-city-select');

  app.context.choisirCommune = async () => { throw new Error('Service indisponible.'); };
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-step-error').textContent, 'Service indisponible.');
  app.context.choisirCommune = async () => ({ name: 'Paris' });
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-progress').value, 4);
});

test('submission cannot bypass confirmation and rechecks changes before sending', async () => {
  const app = createRegistration('establishment');
  await app.context.inscrireUtilisateur();
  assert.equal(app.submissions(), 0);
  await app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  app.get('reg-password').value = 'different-code';
  await app.context.inscrireUtilisateur();
  assert.equal(app.submissions(), 0);
  assert.equal(app.get('reg-progress').value, 2);
  assert.equal(app.focused(), 'reg-confirm-password');
  app.get('reg-confirm-password').value = 'different-code';
  await app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  await app.context.inscrireUtilisateur();
  assert.equal(app.submissions(), 1);
});

test('invalid professional and guardian documents are rejected before submission', async () => {
  for (const role of ['pro', 'aidant']) {
    const app = createRegistration(role);
    if (role === 'pro') app.get('reg-account-photo').files = [{ type: 'image/png' }];
    else app.get('reg-legal-guardian').checked = true;
    await app.context.etapeSuivanteInscription();
    await app.context.etapeSuivanteInscription();
    const ids = role === 'pro' ? ['reg-identity-document', 'reg-kbis-document']
      : ['reg-guardian-identity', 'reg-guardian-proof'];
    app.get(ids[0]).files = [{ type: 'application/pdf', size: 10 }];
    app.get(ids[1]).files = [{ type: 'application/pdf', size: 10 * 1024 * 1024 + 1 }];
    await app.context.etapeSuivanteInscription();
    assert.equal(app.get('reg-progress').value, 3);
    assert.equal(app.focused(), ids[1]);
    assert.equal(app.submissions(), 0);
  }
});

test('invalid email or missing professional photo prevents advancing', async () => {
  const app = createRegistration('pro');
  await app.context.etapeSuivanteInscription();
  app.get('reg-email').validity.valid = false;
  await app.context.etapeSuivanteInscription();
  assert.equal(app.focused(), 'reg-email');
  app.get('reg-email').validity.valid = true;
  await app.context.etapeSuivanteInscription();
  assert.equal(app.focused(), 'reg-account-photo');
  assert.equal(app.get('reg-progress').value, 2);
});

test('the commune lookup cannot be triggered twice while it is pending', async () => {
  const app = createRegistration('senior');
  let resolveLookup;
  let calls = 0;
  app.context.choisirCommune = () => {
    calls++;
    return new Promise(resolve => { resolveLookup = resolve; });
  };
  await app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  const pending = app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  assert.equal(calls, 1);
  assert.equal(app.get('reg-previous').disabled, true);
  assert.equal(app.get('reg-step-status').textContent, 'Recherche de la commune…');
  resolveLookup({ name: 'Paris' });
  await pending;
  assert.equal(app.get('reg-progress').value, 4);
  assert.equal(app.get('reg-previous').disabled, false);
  assert.equal(app.get('reg-step-status').textContent, '');
});

test('retrying a commune search clears the old error and reports a new failure', async () => {
  const app = createRegistration('aidant');
  await app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  app.context.choisirCommune = async () => { throw new Error('Première erreur.'); };
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-step-error').hidden, false);
  let rejectLookup;
  app.context.choisirCommune = () => new Promise((resolve, reject) => { rejectLookup = reject; });
  const pending = app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-step-error').hidden, true);
  assert.equal(app.get('reg-step-status').textContent, 'Recherche de la commune…');
  rejectLookup(new Error('Service indisponible.'));
  await pending;
  assert.equal(app.get('reg-step-status').textContent, '');
  assert.equal(app.get('reg-step-error').textContent, 'Service indisponible.');
  assert.equal(app.get('reg-step-error').hidden, false);
  assert.equal(app.get('reg-next').disabled, false);
});

test('a tablet interest requires a complete address and preserves it when returning', async () => {
  for (const choice of ['purchase', 'purchase_premium', 'rental_premium']) {
    const app = createRegistration('establishment');
    await app.context.etapeSuivanteInscription();
    await app.context.etapeSuivanteInscription();
    app.get('reg-tablet-interest').value = choice;
    await app.context.etapeSuivanteInscription();
    assert.equal(app.get('reg-progress').value, 3);
    assert.equal(app.focused(), 'reg-postal-address');
    app.get('reg-postal-address').value = '10 rue des Lilas';
    await app.context.etapeSuivanteInscription();
    assert.equal(app.focused(), 'reg-postal-code');
    app.get('reg-postal-code').value = '75001';
    app.get('reg-postal-city').value = 'Paris';
    app.get('reg-postal-country').value = 'France';
    await app.context.etapeSuivanteInscription();
    assert.equal(app.get('reg-tablet-interest').value, choice);
    assert.match(app.get('reg-postal-summary').textContent, /75001 Paris/);
    await app.context.inscrireUtilisateur();
    assert.equal(app.submissions(), 1);
  }
});

test('tablet choice and delivery address are requested together before the review', async () => {
  const step3 = source.slice(source.indexOf('id="reg-step-3"'), source.indexOf('id="reg-step-4"'));
  assert.ok(step3.indexOf('id="reg-tablet-interest"') < step3.indexOf('id="reg-postal-address"'));
  const app = createRegistration('establishment');
  app.get('reg-tablet-interest').value = '';
  await app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-progress').value, 3);
  assert.equal(app.focused(), 'reg-tablet-interest');
  app.get('reg-tablet-interest').value = 'none';
  await app.context.etapeSuivanteInscription();
  assert.equal(app.get('reg-progress').value, 4);
  assert.match(app.get('reg-tablet-summary').textContent, /Choix de tablette/);
  app.get('reg-tablet-interest').value = 'purchase';
  await app.context.inscrireUtilisateur();
  assert.equal(app.submissions(), 0);
  assert.equal(app.get('reg-progress').value, 3);
  assert.equal(app.focused(), 'reg-postal-address');
});
