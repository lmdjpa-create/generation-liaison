const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

function createView(response) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        style: {},
        value: '',
        textContent: '',
        options: [],
        get selectedOptions() { return this.options.filter(option => option.value === this.value); },
        classList: {
          add: value => classes.add(value),
          remove: value => classes.delete(value),
          contains: value => classes.has(value)
        },
        replaceChildren(...options) { this.options = options; }
      });
    }
    return elements.get(id);
  };
  const calls = [];
  const context = {
    console: { error() {} },
    document: {
      getElementById: element,
      querySelector: element,
      querySelectorAll: () => []
    },
    window: { generationLiaisonTranslate: value => value },
    localStorage: { getItem: () => null, removeItem() {}, setItem() {} },
    fetch: async () => response,
    readResponse: async result => {
      if (result.error) throw new Error(result.error);
      return result;
    },
    Option: function Option(text, value) { this.text = text; this.value = value; },
    clearInterval() {},
    setInterval: () => 1,
    dateInputValue: () => '2026-01-01',
    planningRefreshTimer: null,
    connectedUser: null,
    currentUser: null,
    activeSeniorProfileId: '',
    wellbeingLoadedDate: null,
    SERVER_URL: '',
    authHeaders: () => ({}),
    afficherAccueilSenior() {},
    updatePlanningDateTitle() {},
    ...Object.fromEntries([
      'chargerNotifications', 'chargerPreferencesNotification', 'chargerLogs',
      'chargerCheckinsPartages', 'chargerSuiviPartage', 'chargerConsentements',
      'chargerServicesFamiliaux', 'chargerAnnuaire', 'chargerDirectoryBookings',
      'chargerContacts', 'chargerGestionAssociations', 'chargerDirectoryProfile',
      'chargerPlanningPro', 'chargerPlanningServices', 'chargerLegalGuardianDocuments',
      'chargerProfessionalVerificationDocuments', 'chargerCheckinBienEtre',
      'chargerAssistantConversation'
    ].map(name => [name, () => { calls.push(name); }]))
  };
  const screenStart = source.indexOf('    function switchScreen(screenName)');
  const screenEnd = source.indexOf('    function basculerFormulaire', screenStart);
  const viewStart = source.indexOf('    async function setAuthenticatedView(user)');
  const viewEnd = source.indexOf('    function afficherAccueilSenior(user)', viewStart);
  assert.ok(screenStart >= 0 && screenEnd > screenStart && viewStart >= 0 && viewEnd > viewStart);
  vm.runInNewContext(
    `${source.slice(screenStart, screenEnd)}\n${source.slice(viewStart, viewEnd)}\n` +
      'globalThis.openView = setAuthenticatedView; globalThis.openScreen = switchScreen; globalThis.openAgenda = ouvrirAgenda;',
    context
  );
  return { context, element, calls };
}

test('an aidant without a linked senior can use account navigation without loading senior data', async () => {
  const { context, element, calls } = createView({ seniors: [] });
  await context.openView({ id: 'aidant', role: 'aidant' });
  assert.equal(element('aidant-no-senior-panel').style.display, 'block');
  assert.equal(element('aidant-senior-content').style.display, 'none');
  assert.equal(element('notification-settings-aidant').style.display, 'block');
  assert.equal(calls.includes('chargerLogs'), false);
  context.openScreen('directory');
  context.openScreen('contacts');
  assert.ok(calls.includes('chargerAnnuaire'));
  assert.ok(calls.includes('chargerContacts'));
});

test('a failed senior-profile request is not presented as an empty association list', async () => {
  const { context, element } = createView({ error: 'Network error' });
  await context.openView({ id: 'aidant', role: 'aidant' });
  assert.equal(element('aidant-no-senior-panel').style.display, 'block');
  assert.equal(element('aidant-senior-content').style.display, 'none');
  assert.match(element('aidant-senior-status').textContent, /Impossible de charger/);
});

test('an aidant with a linked senior still opens the selected senior workspace', async () => {
  const { context, element, calls } = createView({ seniors: [{ id: 'senior-1', name: 'Profil lié' }] });
  await context.openView({ id: 'aidant', role: 'aidant', seniorName: 'Ancien profil' });
  assert.equal(element('aidant-no-senior-panel').style.display, 'none');
  assert.equal(element('aidant-senior-content').style.display, 'block');
  assert.equal(element('senior-name-aidant').textContent, 'Profil lié');
  assert.ok(calls.includes('chargerLogs'));
});

test('settings are separate and only the current role’s account panels are shown', async () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const { context, element, calls } = createView({ seniors: [] });
    await context.openView({ id: role, role, verificationStatus: 'approved' });
    assert.equal(element('settings-senior-links').style.display, role === 'senior' ? 'block' : 'none');
    assert.equal(element('settings-aidant-links').style.display, role === 'aidant' ? 'block' : 'none');
    assert.equal(element('settings-pro-area').style.display, role === 'pro' ? 'block' : 'none');
    const priorCalls = calls.length;
    context.openScreen('settings');
    assert.ok(element('screen-settings').classList.contains('active'));
    assert.ok(calls.slice(priorCalls).includes('chargerPreferencesNotification'));
    context.openAgenda();
    assert.ok(element(role === 'pro' ? 'screen-pro' : 'screen-directory').classList.contains('active'));
    assert.ok(element('nav-agenda').classList.contains('active'));
  }
});

test('pending guardian can open settings and return to verification without profile access', async () => {
  const { context, element, calls } = createView({ seniors: [] });
  await context.openView({ id: 'guardian', role: 'aidant', isLegalGuardian: true, guardianVerificationStatus: 'pending' });
  context.openScreen('settings');
  assert.ok(element('screen-settings').classList.contains('active'));
  assert.equal(element('settings-aidant-links').style.display, 'none');
  assert.equal(element('settings-agenda').style.display, 'none');
  context.openAgenda();
  assert.equal(element('nav-agenda').classList.contains('active'), false);
  assert.equal(calls.includes('chargerGestionAssociations'), false);
  context.openScreen('aidant');
  assert.ok(element('screen-senior').classList.contains('active'));
  assert.equal(calls.includes('chargerLogs'), false);
});

test('a pending professional can open settings without accessing the agenda', async () => {
  const { context, element, calls } = createView({ seniors: [] });
  await context.openView({ id: 'pro', role: 'pro', verificationStatus: 'pending' });
  context.openScreen('settings');
  assert.equal(element('settings-pro-area').style.display, 'none');
  assert.equal(element('settings-agenda').style.display, 'none');
  context.openAgenda();
  assert.equal(element('nav-agenda').classList.contains('active'), false);
  assert.equal(calls.includes('chargerPlanningPro'), false);
  context.openScreen('pro');
  assert.ok(element('screen-pro').classList.contains('active'));
});
