const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

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
