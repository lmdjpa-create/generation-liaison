const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('administrator creates associated accounts only through the explicit form', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = source.indexOf('    function createEstablishmentAccountForm(item)');
  const end = source.indexOf('    function establishmentTariff(count)', start);
  assert.ok(start >= 0 && end > start);
  function element(tag) {
    return {
      tag, children: [], value: '', checked: false, textContent: '', disabled: false,
      append(...children) { this.children.push(...children); },
      setAttribute() {},
      addEventListener(name, callback) { this[name] = callback; },
      reset() { this.resetCalled = true; }
    };
  }
  const requests = [];
  const context = {
    document: { createElement: element },
    window: { generationLiaisonTranslate: text => text },
    adminRequest: async (...args) => { requests.push(args); return { identifier: 'abc123' }; }
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.create = createEstablishmentAccountForm;`, context);
  const inactive = context.create({ id: 'one', active: false, account_active: true });
  assert.equal(inactive.children[2].children[6].disabled, true);
  const details = context.create({ id: 'one', active: true, account_active: true });
  const form = details.children[2];
  const inputs = form.children.slice(0, 6).map(label => label.children[0]);
  [inputs[0].value, inputs[1].value, inputs[2].value, inputs[3].value, inputs[4].value] =
    ['senior', 'Camille', 'Exemple', '1940-05-01', 'mot-provisoire-123'];
  inputs[5].checked = true;
  await form.submit({ preventDefault() {} });
  assert.equal(requests[0][0], '/api/admin/establishments/one/accounts');
  assert.equal(requests[0][1].body.confirmed, true);
  assert.equal(requests[0][1].body.role, 'senior');
  assert.equal(form.resetCalled, true);
  assert.match(form.children[7].textContent, /abc123/);
  assert.doesNotMatch(form.children[7].textContent, /mot-provisoire/);
  assert.match(source, /id="establishment-invitation-form"/);
  assert.match(source, /href="\/app-mobile\.html#inscription"/);
});

test('the establishment registration link can be copied or selected when clipboard access fails', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = source.indexOf("    const establishmentInvitationLink = document.getElementById('establishment-invitation-link')");
  const end = source.indexOf("    document.getElementById('establishment-invitation-form')", start);
  assert.ok(start >= 0 && end > start);
  let handler;
  let copied;
  let message;
  const link = { focus() { this.focused = true; }, select() { this.selected = true; } };
  const context = {
    URL, window: { location: { origin: 'https://example.test' } },
    document: { getElementById: id => id === 'establishment-invitation-link' ? link : { addEventListener: (_, fn) => { handler = fn; } } },
    navigator: { clipboard: { writeText: async value => { copied = value; } } },
    setStatus: text => { message = text; }
  };
  vm.runInNewContext(source.slice(start, end), context);
  await handler();
  assert.equal(copied, 'https://example.test/app-mobile.html#inscription');
  context.navigator.clipboard = undefined;
  await handler();
  assert.equal(link.selected, true);
  assert.match(message, /copiez le lien sélectionné/);
});

test('the indicative monthly price follows each approved tier', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = source.indexOf('    function establishmentTariff(count)');
  const end = source.indexOf('    async function loadEstablishments()', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.tariff = establishmentTariff;`, context);
  for (const [count, expected] of [
    [null, 'Nombre non renseigné'], [1, '29 € HT / mois'], [10, '29 € HT / mois'],
    [11, '49 € HT / mois'], [25, '49 € HT / mois'], [26, '79 € HT / mois'],
    [50, '79 € HT / mois'], [51, '129 € HT / mois'], [100, '129 € HT / mois'],
    [101, 'Sur devis']
  ]) assert.equal(context.tariff(count), expected);
});

test('establishment pricing and subscription use closed controls and preserve their actions', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = source.indexOf('    function establishmentTariff(count)');
  const end = source.indexOf('    async function loadExternalPros()', start);
  assert.ok(start >= 0 && end > start);
  const element = tag => ({
    tag, children: [], open: false, handlers: {}, value: '', disabled: false,
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {},
    addEventListener(name, callback) { this.handlers[name] = callback; }
  });
  const body = element('tbody');
  const calls = [];
  const item = { id: 'one', account_name: 'Résidence', account_active: true,
    name: 'Résidence', user_count: 12, active: false };
  const context = {
    document: { createElement: element, getElementById: () => body },
    addCell: row => row.append(element('td')),
    addContactCell: row => row.append(element('td')),
    createEstablishmentAccountForm: () => element('details'),
    adminRequest: async (url, options) => {
      calls.push({ url, options });
      return options ? {} : { establishments: [item] };
    },
    confirm: () => true,
    setStatus: message => { throw new Error(message); },
    initiateAccountClosure() {}
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.load = loadEstablishments;`, context);
  await context.load();
  const [pricing, subscription] = body.children[0].children.slice(6, 8);
  assert.equal(pricing.children[0].textContent, '49 € HT / mois');
  assert.equal(pricing.children[1].open, false);
  assert.equal(pricing.children[1].children[0].textContent, 'Modifier le nombre de personnes');
  const form = pricing.children[1].children[1];
  form.children[0].value = '20';
  await form.handlers.submit({ preventDefault() {} });
  assert.equal(calls[1].url, '/api/admin/establishments/one/users');
  assert.equal(calls[1].options.body.count, 20);
  assert.equal(subscription.children[0].textContent, 'Inactif');
  assert.equal(subscription.children[1].open, false);
  assert.equal(subscription.children[1].children[0].textContent, 'Gérer l’abonnement');
  await subscription.children[1].children[1].handlers.click();
  assert.equal(calls[3].url, '/api/admin/establishments/one/subscription');
  assert.equal(calls[3].options.body.active, true);
  item.account_active = false;
  await context.load();
  const [inactivePricing, inactiveSubscription] = body.children[0].children.slice(6, 8);
  assert.equal(inactivePricing.children[1].children[1].children[0].disabled, true);
  assert.equal(inactiveSubscription.children[1].children[1].disabled, true);
});

test('director overview separates categories and distinguishes accounts from contacts', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const start = source.indexOf('    function reinitialiserChiffresEtablissement()');
  const end = source.indexOf('    async function chargerSoignantsEtablissement()', start);
  assert.ok(start >= 0 && end > start);
  const elements = new Map();
  function element() {
    return { children: [], textContent: '', replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); } };
  }
  const values = {
    '/api/establishment/contacts': { contacts: [
      { category: 'intervenant', name: 'Lou', phone: '', email: 'lou@example.test' },
      { category: 'resident', name: 'Marie Exemple', phone: '', email: '' }
    ] },
    '/api/establishment/residents': { residents: [{ first_name: 'Marie', last_name: 'Exemple' }] },
    '/api/establishment/staff': { staff: [{ first_name: 'Alex', last_name: 'Exemple' }] }
  };
  const context = {
    connectedUser: { id: 'director' }, establishmentOverviewLoadId: 0, SERVER_URL: '',
    window: { generationLiaisonTranslate: value => value, generationLiaisonTranslateError: (message, fallback) => message || fallback },
    authHeaders: () => ({}), fetch: async url => values[url], readResponse: async response => response,
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element
    }
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.load = chargerTableauEtablissement;`, context);
  await context.load();
  const rows = category => elements.get(`establishment-overview-${category}`).children.map(row => row.children.map(cell => cell.textContent));
  assert.deepEqual(rows('resident'), [
    ['Résident', 'Marie Exemple', 'Compte individuel', '—'],
    ['Résident', 'Marie Exemple', 'Coordonnées saisies', '—']
  ]);
  assert.deepEqual(rows('caregiver'), [['Soignant', 'Alex Exemple', 'Compte individuel', '—']]);
  assert.deepEqual(rows('intervenant'), [['Intervenant', 'Lou', 'Coordonnées saisies', 'lou@example.test']]);
  for (const [id, count] of Object.entries({
    residents: '1', staff: '1', 'resident-contacts': '1', 'caregiver-contacts': '0', 'intervenant-contacts': '1'
  })) assert.equal(elements.get(`establishment-count-${id}`).textContent, count);
  context.fetch = async () => { throw new Error('Données indisponibles'); };
  await context.load();
  assert.equal(elements.get('establishment-count-residents').textContent, '—');
  assert.equal(elements.get('establishment-count-intervenant-contacts').textContent, '—');
  assert.equal(elements.get('establishment-overview-status').textContent, 'Données indisponibles');
});

test('home explanations for director and staff start closed without hiding actions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const director = source.slice(source.indexOf('<div id="screen-establishment"'), source.indexOf('<div id="screen-staff"'));
  const staff = source.slice(source.indexOf('<div id="screen-staff"'), source.indexOf('<div id="screen-aidant"'));
  assert.match(director, /<details class="senior-disclosure" data-close-on-mouse-leave>\s*<summary>Informations sur les tableaux<\/summary>[\s\S]*?<\/details>\s*<div class="form-card"[^>]*><h4>Résidents/);
  assert.match(staff, /<details class="senior-disclosure" data-close-on-mouse-leave>\s*<summary>Informations sur le carnet et les messages<\/summary>[\s\S]*?<\/details>\s*<button type="button" onclick="chargerResidentsSoignant\(\)"/);
  assert.match(staff, /id="care-staff-nonmedical"[^>]*required/);
});

test('only the director workspace offers the shareable sign-in link', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const login = source.slice(source.indexOf('<form id="login-section"'), source.indexOf('<form id="resident-login-section"'));
  const director = source.slice(source.indexOf('<div id="screen-establishment"'), source.indexOf('<div id="screen-staff"'));
  assert.doesNotMatch(login, /resident-login-section|connexion-etablissement/);
  assert.match(director, /data-establishment-panel="establishment-login-panel"/);
  assert.match(director, /id="establishment-login-panel" hidden/);

  const start = source.indexOf('    function afficherConnexionInitiale()');
  const end = source.indexOf('    async function requestSession(', start);
  assert.ok(start >= 0 && end > start);
  const link = { value: '', focus() { this.focused = true; }, select() { this.selected = true; } };
  const status = { textContent: '' };
  const loginSection = { style: {} };
  const residentSection = { style: {} };
  const elements = {
    'establishment-login-link': link, 'establishment-login-link-status': status,
    'login-section': loginSection, 'resident-login-section': residentSection,
    'self-registration-choice': {}, 'staff-login-help': {}
  };
  let copied;
  let registrationOpened = false;
  const context = {
    URL, URLSearchParams, SERVER_URL: 'https://example.test', connectedUser: { role: 'establishment' },
    document: { getElementById: id => elements[id] },
    navigator: { clipboard: { writeText: async value => { copied = value; } } },
    window: { location: { hash: '#connexion-etablissement' }, generationLiaisonTranslate: value => value },
    basculerFormulaire: value => { registrationOpened = value; }
  };
  vm.runInNewContext(source.slice(start, end), context);
  await context.copierLienConnexionEtablissement();
  assert.equal(copied, 'https://example.test/app-mobile.html#connexion-etablissement');
  context.afficherConnexionInitiale();
  assert.equal(loginSection.style.display, 'none');
  assert.equal(residentSection.style.display, 'block');
  context.window.location.hash = '#inscription';
  context.afficherConnexionInitiale();
  assert.equal(registrationOpened, true);
  context.navigator.clipboard = undefined;
  await context.copierLienConnexionEtablissement();
  assert.equal(link.focused, true);
  assert.equal(link.selected, true);
  assert.match(status.textContent, /copiez le lien sélectionné/);
  context.connectedUser = { role: 'staff' };
  copied = undefined;
  context.navigator.clipboard = { writeText: async value => { copied = value; } };
  await context.copierLienConnexionEtablissement();
  assert.equal(copied, undefined);
  assert.match(source, /if \(!token\) \{[\s\S]*?afficherConnexionInitiale\(\);[\s\S]*?return;/);
});

test('admin account creation sends no password and reports activation delivery failures', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = source.indexOf("    document.getElementById('admin-create-account-form').addEventListener");
  const end = source.indexOf("    document.getElementById('account-invitation-form').addEventListener", start);
  assert.ok(start >= 0 && end > start);
  const ids = {
    'admin-create-first-name': { value: ' Camille ' }, 'admin-create-last-name': { value: ' Exemple ' },
    'admin-create-email': { value: ' camille@example.test ' }, 'admin-create-role': { value: 'establishment' },
    'admin-create-confirmed': { checked: true }, 'admin-create-account-status': { textContent: '' }
  };
  let handler;
  let delivery = true;
  let sent;
  const button = {};
  const form = { querySelector: () => button, reset() { this.resetCalled = true; } };
  const context = {
    document: { getElementById(id) { return id === 'admin-create-account-form'
      ? { addEventListener: (_, fn) => { handler = fn; } } : ids[id]; } },
    adminRequest: async (url, options) => { sent = { url, body: options.body }; return { activationEmailSent: delivery }; },
    loadOverview: async () => {}
  };
  vm.runInNewContext(source.slice(start, end), context);
  await handler({ preventDefault() {}, currentTarget: form });
  assert.equal(sent.url, '/api/admin/accounts');
  assert.equal(sent.body.email, 'camille@example.test');
  assert.equal(sent.body.role, 'establishment');
  assert.equal(sent.body.confirmed, true);
  assert.equal(Object.hasOwn(sent.body, 'password'), false);
  assert.equal(form.resetCalled, true);
  assert.match(ids['admin-create-account-status'].textContent, /lien d’activation a été envoyé/);
  delivery = false;
  await handler({ preventDefault() {}, currentTarget: form });
  assert.match(ids['admin-create-account-status'].textContent, /Compte créé, mais l’e-mail n’a pas pu être envoyé/);
  assert.equal(button.disabled, false);
});

test('director actions open only the requested panel and can close it', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const start = source.indexOf('    function fermerActionsEtablissement()');
  const end = source.indexOf('    async function chargerTableauEtablissement()', start);
  assert.ok(start >= 0 && end > start);
  const panels = { one: { hidden: true, scrollIntoView() {} }, two: { hidden: true, scrollIntoView() {} } };
  const buttons = Object.keys(panels).map(id => ({
    dataset: { establishmentPanel: id }, expanded: '',
    setAttribute(name, value) { assert.equal(name, 'aria-expanded'); this.expanded = value; }
  }));
  const context = { document: { querySelectorAll: () => buttons, getElementById: id => panels[id] } };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.open = ouvrirActionEtablissement;`, context);
  context.open(buttons[0]);
  assert.equal(panels.one.hidden, false);
  assert.equal(buttons[0].expanded, 'true');
  context.open(buttons[1]);
  assert.equal(panels.one.hidden, true);
  assert.equal(panels.two.hidden, false);
  context.open(buttons[1]);
  assert.equal(panels.two.hidden, true);
  assert.equal(buttons[1].expanded, 'false');
  assert.ok(source.indexOf('data-establishment-panel="establishment-profile-panel"') < source.indexOf('id="establishment-overview-resident"'));
});

test('administrative closure requires a reason and confirmation before requesting it', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = source.indexOf('    async function initiateAccountClosure(');
  const end = source.indexOf("    document.getElementById('admin-create-account-form')", start);
  assert.ok(start >= 0 && end > start);
  const requests = [];
  let confirmed = false;
  const context = {
    prompt: () => 'Motif administratif suffisamment détaillé',
    confirm: () => confirmed,
    adminRequest: async (...args) => { requests.push(args); },
    loadOverview: async () => {},
    setStatus: () => {}
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.close = initiateAccountClosure;`, context);
  const button = { disabled: false };
  await context.close({ id: 'one', name: 'Compte exemple' }, button);
  assert.equal(requests.length, 0);
  confirmed = true;
  await context.close({ id: 'one', name: 'Compte exemple' }, button);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], '/api/admin/accounts/one/closure');
  assert.equal(requests[0][1].body.confirmed, true);
});
