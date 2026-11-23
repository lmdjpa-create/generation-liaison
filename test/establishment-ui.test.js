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

test('director overview separates categories and distinguishes accounts from contacts', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const start = source.indexOf('    async function chargerTableauEtablissement()');
  const end = source.indexOf('    async function chargerSoignantsEtablissement()', start);
  assert.ok(start >= 0 && end > start);
  const elements = new Map();
  function element() {
    return { children: [], textContent: '', replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); } };
  }
  const values = {
    '/api/establishment/contacts': { contacts: [{ category: 'intervenant', name: 'Lou', phone: '', email: 'lou@example.test' }] },
    '/api/establishment/residents': { residents: [{ first_name: 'Marie', last_name: 'Exemple' }] },
    '/api/establishment/staff': { staff: [{ first_name: 'Alex', last_name: 'Exemple' }] }
  };
  const context = {
    connectedUser: { id: 'director' }, establishmentOverviewLoadId: 0, SERVER_URL: '',
    authHeaders: () => ({}), fetch: async url => values[url], readResponse: async response => response,
    document: {
      getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
      createElement: element
    }
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.load = chargerTableauEtablissement;`, context);
  await context.load();
  const rows = category => elements.get(`establishment-overview-${category}`).children.map(row => row.children.map(cell => cell.textContent));
  assert.deepEqual(rows('resident'), [['Résident', 'Marie Exemple', 'Compte individuel', '—']]);
  assert.deepEqual(rows('caregiver'), [['Soignant', 'Alex Exemple', 'Compte individuel', '—']]);
  assert.deepEqual(rows('intervenant'), [['Intervenant', 'Lou', 'Coordonnées saisies', 'lou@example.test']]);
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
  const end = source.indexOf("    document.getElementById('account-invitation-form')", start);
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
