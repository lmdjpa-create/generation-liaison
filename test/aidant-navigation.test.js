const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

test('daily caregiver summary shows only current profile data and reports partial failures', async () => {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '' });
    return elements.get(id);
  };
  const firstResolvers = [];
  const context = {
    connectedUser: { id: 'user', role: 'aidant' }, activeSeniorProfileId: 'old', aidantSummaryLoadId: 0, aidantSummaryContext: '',
    document: { getElementById },
    window: { generationLiaisonTranslate: value => value },
    dateCheckinBienEtre: () => '2028-02-29',
    calendarEventLabel: event => event.title,
    calendarEventDate: value => value.slice(0, 10),
    progressArray: value => value || [],
    stageLabel: value => value,
    Date,
    planningRequest: url => {
      if (context.activeSeniorProfileId === 'old') return new Promise(resolve => { firstResolvers.push(resolve); });
      if (url.startsWith('/api/planning/calendar')) return Promise.resolve({ events: [
        { status: 'pending', title: 'En attente', scheduledAt: '2999-03-01T14:00:00Z' },
        { status: 'scheduled', title: 'Visite prévue', scheduledAt: '2999-03-01T15:00:00Z' }
      ] });
      if (url === '/api/shared-tasks') return Promise.resolve({ tasks: [
        { dueDate: '2028-02-29', completed: false, assigned: false },
        { dueDate: '2028-02-28', completed: false, assigned: true },
        { dueDate: '2028-02-29', completed: true, assigned: false },
        { dueDate: '2028-03-01', completed: false, assigned: false }
      ] });
      if (url === '/api/messages/unread-count') return Promise.reject(new Error('offline'));
      if (url === '/api/notifications') return Promise.resolve({ unreadCount: 2 });
      if (url === '/api/planning/following') return Promise.resolve({ visits: [
        { scheduledAt: '2028-02-29T10:00:00Z', visitType: 'Visite', progress: [{ type: 'arrived', createdAt: '2028-02-29T10:01:00Z' }] }
      ] });
      if (url.startsWith('/api/planning/services/bookings')) return Promise.resolve({ bookings: [{ status: 'requested' }, { status: 'cancelled' }] });
      if (url === '/api/logs/all') return Promise.resolve([{ created_at: '2028-02-29T10:00:00Z', content: 'Repas reçu' }]);
      if (url === '/api/wellbeing/shared-check-ins') return Promise.resolve({ checkins: [{ createdAt: '2028-02-29T09:00:00Z' }] });
      throw new Error(`Unexpected request: ${url}`);
    }
  };
  const start = source.indexOf('    function chargerSyntheseAidant()');
  const end = source.indexOf('    function afficherProchainRendezVous()', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadSummary = chargerSyntheseAidant;`, context);
  const first = context.loadSummary();
  context.activeSeniorProfileId = 'new';
  await context.loadSummary();
  assert.equal(getElementById('aidant-summary-visit').textContent, 'Rendez-vous aujourd’hui : 2\nEn attente\nVisite prévue');
  assert.equal(getElementById('aidant-summary-tasks').textContent, 'Tâches à faire : 3 · Pour aujourd’hui ou en retard : 2 · Sans volontaire : 2');
  assert.equal(getElementById('aidant-summary-messages').textContent, 'Impossible de charger les messages.');
  assert.equal(getElementById('aidant-summary-notifications').textContent, 'Notifications non lues parmi les 50 dernières : 2');
  assert.match(getElementById('aidant-summary-following').textContent, /Dernière étape : Visite — arrived/);
  assert.match(getElementById('aidant-summary-services').textContent, /En attente de réponse : 1 · Annulés : 1/);
  assert.ok(!elements.has('aidant-summary-logs'));
  assert.match(getElementById('aidant-summary-checkins').textContent, / : 1$/);
  firstResolvers.forEach(resolve => resolve({}));
  await first;
  assert.equal(getElementById('aidant-summary-tasks').textContent, 'Tâches à faire : 3 · Pour aujourd’hui ou en retard : 2 · Sans volontaire : 2');
});

test('senior summary uses the calendar and accessible updates without requesting shared check-ins', async () => {
  const elements = new Map();
  const paths = [];
  const context = {
    connectedUser: { id: 'senior', role: 'senior', seniorId: 'profile' },
    activeSeniorProfileId: '', aidantSummaryLoadId: 0, aidantSummaryContext: '',
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { textContent: '' }); return elements.get(id); } },
    window: { generationLiaisonTranslate: value => value },
    dateCheckinBienEtre: () => '2028-02-29',
    calendarEventDate: value => value.slice(0, 10),
    calendarEventLabel: event => event.title,
    progressArray: value => value || [],
    stageLabel: value => value,
    Date,
    planningRequest: async url => {
      paths.push(url);
      if (url.startsWith('/api/planning/calendar')) return { events: [{ title: 'Rendez-vous prévu' }] };
      if (url === '/api/shared-tasks') return { tasks: [{ completed: false, dueDate: null }] };
      if (url === '/api/messages/unread-count') return { count: 1 };
      if (url === '/api/notifications') return { unreadCount: 0 };
      if (url === '/api/planning/following') return { visits: [] };
      if (url.startsWith('/api/planning/services/bookings')) return { bookings: [] };
      if (url === '/api/logs/all') return [];
      throw new Error(`Unexpected request: ${url}`);
    }
  };
  const start = source.indexOf('    function chargerSyntheseAidant()');
  const end = source.indexOf('    function afficherProchainRendezVous()', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadSummary = chargerSyntheseSenior;`, context);
  await context.loadSummary();
  assert.match(elements.get('senior-summary-visit').textContent, /Rendez-vous prévu/);
  assert.equal(elements.get('senior-summary-tasks').textContent, 'Tâches à faire : 1 · Pour aujourd’hui ou en retard : 0');
  assert.equal(elements.get('senior-summary-messages').textContent, 'Messages non lus : 1');
  assert.equal(elements.get('senior-summary-notifications').textContent, '');
  assert.equal(elements.get('senior-summary-notifications').hidden, true);
  assert.equal(elements.get('senior-summary-following').hidden, true);
  assert.ok(!elements.has('senior-summary-logs'));
  assert.ok(paths.some(path => path === '/api/planning/calendar?start=2028-02-29&end=2028-03-01'));
  assert.ok(!paths.includes('/api/wellbeing/shared-check-ins'));
});

test('professional summary uses only professional-accessible data and shows pending requests', async () => {
  const elements = new Map();
  const paths = [];
  const context = {
    connectedUser: { id: 'pro', role: 'pro', seniorId: 'profile' },
    activeSeniorProfileId: '', aidantSummaryLoadId: 0, aidantSummaryContext: '',
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { textContent: '' }); return elements.get(id); } },
    window: { generationLiaisonTranslate: value => value },
    dateCheckinBienEtre: () => '2028-02-29',
    calendarEventLabel: event => event.title,
    Date,
    planningRequest: async url => {
      paths.push(url);
      if (url.startsWith('/api/planning/calendar')) return { events: [{ title: 'Visite prévue' }] };
      if (url === '/api/messages/unread-count') return { count: 1 };
      if (url === '/api/notifications') return { unreadCount: 2 };
      if (url.startsWith('/api/planning/services/bookings')) return { bookings: [] };
      if (url === '/api/directory/bookings') return { bookings: [{ status: 'pending' }, { status: 'confirmed' }] };
      throw new Error(`Unexpected request: ${url}`);
    }
  };
  const start = source.indexOf('    function chargerSyntheseAidant()');
  const end = source.indexOf('    function afficherProchainRendezVous()', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadSummary = chargerSynthesePro;`, context);
  await context.loadSummary();
  assert.match(elements.get('pro-summary-visit').textContent, /Visite prévue/);
  assert.equal(elements.get('pro-summary-demands').textContent, 'Demandes de rendez-vous en attente : 1');
  assert.ok(!paths.includes('/api/shared-tasks'));
  assert.ok(!paths.includes('/api/wellbeing/shared-check-ins'));
});

test('daily journal sorts shared updates and reports unavailable sources', async () => {
  const children = [];
  const container = {
    textContent: '',
    replaceChildren() { children.length = 0; },
    append(item) { children.push(item); }
  };
  const context = {
    connectedUser: { id: 'aidant', role: 'aidant' }, activeSeniorProfileId: 'senior-1', familyJournalRevision: 0,
    document: {
      getElementById: () => container,
      createElement: tag => ({ tag, children: [], append(...items) { this.children.push(...items); } })
    },
    makeTextElement: (tag, text) => ({ tag, text }),
    formatDateTime: value => value,
    dateCheckinBienEtre: () => '2028-01-03',
    calendarEventDate: value => value.slice(0, 10),
    stageLabel: value => value,
    progressArray: value => value,
    planningRequest: async path => path === '/api/logs/all'
      ? [{ created_at: '2028-01-01T10:00:00Z', content: 'Nouvelle familiale' }, { created_at: '2028-01-03T08:00:00Z', content: 'Nouvelle du jour' }]
      : { visits: [{ visitType: 'Visite', progress: [{ type: 'arrived', createdAt: '2028-01-02T10:00:00Z', note: 'Présent' }] }] }
  };
  const start = source.indexOf('    async function chargerJournalQuotidien(role)');
  const end = source.indexOf('    function configurerAlbumJournal()', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadJournal = chargerJournalQuotidien;`, context);
  await context.loadJournal('aidant');
  assert.equal(children[0].children[2].text, 'Visite — arrived : Présent');
  assert.equal(children[1].children[2].text, 'Nouvelle familiale');
  context.planningRequest = async path => {
    if (path === '/api/logs/all') throw new Error('unavailable');
    return { visits: [] };
  };
  await context.loadJournal('aidant');
  assert.equal(children[0].text, 'Impossible de charger les nouvelles.');
  let release;
  context.planningRequest = path => path === '/api/logs/all'
    ? new Promise(resolve => { release = resolve; })
    : Promise.resolve({ visits: [] });
  const pending = context.loadJournal('aidant');
  context.activeSeniorProfileId = 'senior-2';
  container.replaceChildren();
  release([{ created_at: '2028-01-01T10:00:00Z', content: 'Ancien profil' }]);
  await pending;
  assert.equal(children.length, 0);
});

test('the login screen offers a registration button that opens the registration form', () => {
  const login = source.slice(source.indexOf('<form id="login-section"'), source.indexOf('<!-- Bloc Inscription -->'));
  assert.match(login, /<button id="register-open"[^>]*type="button"[^>]*onclick="basculerFormulaire\(true\)"[^>]*>S’inscrire<\/button>/);
  const start = source.indexOf('    function basculerFormulaire(estInscription)');
  const end = source.indexOf('    function afficherChampsInscriptionProfessionnel()', start);
  assert.ok(start >= 0 && end > start);
  const elements = { 'login-section': { style: {} }, 'register-section': { style: {} } };
  const context = { document: { getElementById: id => elements[id] } };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.toggle = basculerFormulaire;`, context);
  context.toggle(true);
  assert.equal(elements['login-section'].style.display, 'none');
  assert.equal(elements['register-section'].style.display, 'block');
  context.toggle(false);
  assert.equal(elements['login-section'].style.display, 'block');
  assert.equal(elements['register-section'].style.display, 'none');
});

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
  const bodyClasses = new Set();
  const tabDisclosures = [{ open: false }, { open: false }];
  const context = {
    console: { error() {} },
    document: {
      body: { classList: {
        toggle(value, enabled) { if (enabled) bodyClasses.add(value); else bodyClasses.delete(value); },
        contains: value => bodyClasses.has(value)
      } },
      getElementById: element,
      querySelector: element,
      querySelectorAll: selector => {
        if (selector === '.senior-tab-disclosure') return tabDisclosures;
        if (selector === '.screen-container') return ['senior', 'aidant', 'pro', 'settings', 'agenda', 'directory', 'contacts', 'messages'].map(name => element(`screen-${name}`));
        if (selector === '.nav-item') return ['senior', 'aidant', 'pro', 'settings', 'agenda', 'directory', 'contacts', 'notifications', 'logout'].map(name => element(`nav-${name}`));
        return [];
      }
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
    nextVisitLoadId: 0,
    nextVisitEvent: null,
    nextVisitMessage: '',
    connectedUser: null,
    currentUser: null,
    activeSeniorProfileId: '',
    directoryLoadId: 0,
    wellbeingLoadedDate: null,
    SERVER_URL: '',
    authHeaders: () => ({}),
    afficherAccueilSenior() {},
    reinitialiserPhotosContacts() {},
    reinitialiserProfil() {},
    chargerPhotoProfil() {},
    updatePlanningDateTitle() {},
    ...Object.fromEntries([
      'chargerNotifications', 'chargerPreferencesNotification', 'chargerCorrespondants', 'chargerLogs', 'chargerSyntheseAidant', 'chargerSyntheseSenior', 'chargerSynthesePro',
      'demanderNotificationsAutomatiquement',
      'chargerCheckinsPartages', 'chargerSuiviPartage', 'chargerConsentements',
      'chargerServicesFamiliaux', 'chargerAnnuaire', 'chargerDirectoryBookings',
      'chargerContacts', 'chargerGestionAssociations', 'chargerDirectoryProfile',
      'chargerPlanningPro', 'chargerPlanningServices', 'chargerLegalGuardianDocuments',
      'chargerProfessionalVerificationDocuments', 'chargerCheckinBienEtre',
      'chargerAssistantConversation', 'chargerProchainRendezVous', 'afficherProchainRendezVous', 'chargerCalendrier', 'chargerPartagesAgenda', 'chargerModificationsGoogle',
      'chargerParametresGooglePlanning', 'reinitialiserTachesPartagees', 'reinitialiserAnnuairePartage', 'chargerAnnuairePartage',
      'reinitialiserAlbumJournal', 'chargerAlbumFamilial', 'chargerJournalQuotidien',
      'reinitialiserMeteo', 'chargerMeteo',
      'annulerDicteeMessage', 'annulerPropositionMessage', 'initialiserLectureSenior', 'planifierLectureSenior'
    ].map(name => [name, () => { calls.push(name); }])),
    dateCheckinBienEtre: () => '2026-01-01',
    definirVueCalendrier: view => { context.calendarView = view; calls.push('definirVueCalendrier'); },
    calendarView: 'week',
    calendarDate: ''
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
  return { context, element, calls, bodyClasses, tabDisclosures };
}

test('shared tabs start collapsed for seniors and stay expanded for other roles', async () => {
  const { context, tabDisclosures, calls } = createView({ seniors: [] });
  await context.openView({ id: 'senior', role: 'senior' });
  assert.ok(tabDisclosures.every(details => !details.open));
  calls.length = 0;
  context.openScreen('settings');
  assert.ok(calls.includes('chargerConsentements'));
  await context.openView({ id: 'aidant', role: 'aidant' });
  assert.ok(tabDisclosures.every(details => details.open));
});

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

test('aidant functions start collapsed without removing their content', () => {
  for (const [id, content] of [
    ['aidant-checkins-details', 'aidant-wellbeing-shared'],
    ['aidant-feed-details', 'logs-list'],
    ['aidant-following-details', 'aidant-live-following'],
    ['aidant-consents-details', 'aidant-sharing-consents'],
    ['aidant-team-message-details', 'aidant-person-note-form'],
    ['aidant-services-details', 'aidant-service-area']
  ]) {
    const section = source.match(new RegExp(`<details class="senior-disclosure" id="${id}">([\\s\\S]*?)</section>`));
    assert.ok(section);
    assert.match(section[1], new RegExp(`id="${content}"`));
  }
});

test('aidant shortcuts pair notifications and agenda without duplicate controls', () => {
  const aidant = source.slice(source.indexOf('<div id="screen-aidant"'), source.indexOf('<!-- 🩺 3.'));
  const shortcuts = aidant.match(/<div id="aidant-shortcuts"[\s\S]*?<\/div>/);
  assert.ok(shortcuts);
  assert.match(shortcuts[0], /onclick="ouvrirNotifications\(\)"/);
  assert.match(shortcuts[0], /onclick="ouvrirAgenda\(\)"/);
  assert.equal((aidant.match(/onclick="ouvrirAgenda\(\)"/g) || []).length, 1);
});

test('senior selection is in settings and remains reachable from agenda and directory', () => {
  const aidant = source.slice(source.indexOf('<div id="screen-aidant"'), source.indexOf('<!-- 🩺 3.'));
  const settings = source.slice(source.indexOf('<div id="screen-settings"'), source.indexOf('<div id="screen-agenda"'));
  assert.doesNotMatch(aidant, /id="aidant-senior-select"/);
  assert.match(settings, /id="aidant-senior-select"/);
  for (const id of ['agenda-change-senior', 'directory-change-senior']) {
    assert.match(source, new RegExp(`id="${id}"[^>]*onclick="ouvrirChoixSenior\\(\\)"`));
  }
  const start = source.indexOf('    function ouvrirChoixSenior()');
  const end = source.indexOf('    function ouvrirAgenda()', start);
  assert.ok(start >= 0 && end > start);
  const calls = [];
  const context = {
    switchScreen: screen => calls.push(screen),
    document: { getElementById: id => ({ focus: () => calls.push(id) }) }
  };
  vm.runInNewContext(`${source.slice(start, end)}\nouvrirChoixSenior();`, context);
  assert.deepEqual(calls, ['settings', 'aidant-senior-select']);
});

test('sign out is in settings rather than the navigation bar', () => {
  const nav = source.slice(source.indexOf('<nav class="nav-bar"'), source.indexOf('</nav>', source.indexOf('<nav class="nav-bar"')));
  const settings = source.slice(source.indexOf('<div id="screen-settings"'), source.indexOf('<div id="screen-agenda"'));
  assert.doesNotMatch(nav, /deconnecterUtilisateur/);
  assert.match(settings, /id="settings-logout"[^>]*onclick="deconnecterUtilisateur\(\)"/);
  assert.match(source, /id="legal-guardian-logout"/);
});

test('aidant sections expand to full-width tiles and collapse again', () => {
  const classes = new Set();
  const details = {
    open: false,
    parentElement: { classList: { toggle(name, enabled) {
      if (enabled) classes.add(name); else classes.delete(name);
    } } },
    addEventListener(name, handler) { this[name] = handler; }
  };
  const start = source.indexOf('    function configurerTuilesAidant()');
  const end = source.indexOf('    async function initApp()', start);
  assert.ok(start >= 0 && end > start);
  const context = { document: { querySelectorAll: () => [details] } };
  vm.runInNewContext(`${source.slice(start, end)}\nconfigurerTuilesAidant();`, context);
  assert.equal(classes.has('aidant-tile-open'), false);
  details.open = true;
  details.toggle();
  assert.equal(classes.has('aidant-tile-open'), true);
  details.open = false;
  details.toggle();
  assert.equal(classes.has('aidant-tile-open'), false);
});

test('a failed senior-profile request is not presented as an empty association list', async () => {
  const { context, element } = createView({ error: 'Network error' });
  await context.openView({ id: 'aidant', role: 'aidant' });
  assert.equal(element('aidant-no-senior-panel').style.display, 'block');
  assert.equal(element('aidant-senior-content').style.display, 'none');
  assert.equal(element('aidant-daily-summary').hidden, true);
  assert.match(element('aidant-senior-status').textContent, /Impossible de charger/);
});

test('an aidant with a linked senior still opens the selected senior workspace', async () => {
  const { context, element, calls } = createView({ seniors: [{ id: 'senior-1', name: 'Profil lié' }] });
  await context.openView({ id: 'aidant', role: 'aidant', seniorName: 'Ancien profil' });
  assert.equal(element('aidant-no-senior-panel').style.display, 'none');
  assert.equal(element('aidant-senior-content').style.display, 'grid');
  assert.equal(element('aidant-daily-summary').hidden, false);
  assert.equal(element('senior-name-aidant').textContent, 'Profil lié');
  assert.ok(calls.includes('chargerLogs'));
});

test('daily summary appears between the followed person and notification shortcuts', () => {
  const start = source.indexOf('<div id="screen-aidant"');
  const summary = source.indexOf('id="aidant-daily-summary"', start);
  assert.ok(source.indexOf('id="senior-name-aidant"', start) < summary);
  assert.ok(summary < source.indexOf('id="aidant-shortcuts"', start));
  assert.match(source.slice(summary, source.indexOf('>', summary)), /\bhidden\b/);
});

test('daily summaries are informational and add no navigation buttons', () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const start = source.indexOf(`id="${role}-daily-summary"`);
    const end = source.indexOf('</section>', start);
    assert.ok(start >= 0 && end > start);
    assert.doesNotMatch(source.slice(start, end), /<button\b|onclick=/);
  }
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
    assert.ok(element('screen-agenda').classList.contains('active'));
    assert.ok(element('nav-agenda').classList.contains('active'));
    assert.equal(context.calendarView, 'day');
    assert.equal(context.calendarDate, '2026-01-01');
  }
});

test('each approved account opens the shared messages page and returns to its own home', async () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const { context, element, calls } = createView({ seniors: [] });
    await context.openView({ id: role, role, verificationStatus: 'approved' });
    const home = source.slice(source.indexOf(`<div id="screen-${role}"`),
      source.indexOf(role === 'senior' ? '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->' : role === 'aidant' ? '<!-- 🩺 3. INTERFACE PROFESSIONNEL -->' : '<div id="screen-messages"'));
    assert.equal((home.match(/onclick="ouvrirNotifications\(\)"/g) || []).length, 1);
    calls.length = 0;
    context.openScreen('messages');
    assert.ok(element('screen-messages').classList.contains('active'));
    assert.ok(element('nav-notifications').classList.contains('active'));
    assert.equal(element(`screen-${role}`).classList.contains('active'), false);
    assert.equal(element(`notifications-panel-${role}`).style.display, 'block');
    assert.ok(calls.includes('chargerCorrespondants'));
    context.openScreen(role);
    assert.ok(element(`screen-${role}`).classList.contains('active'));
    assert.equal(element('screen-messages').classList.contains('active'), false);
  }
});

test('senior button styling applies across tabs and is removed for other roles', async () => {
  const { context, bodyClasses } = createView({ seniors: [] });
  await context.openView({ id: 'senior', role: 'senior' });
  assert.equal(bodyClasses.has('senior-mode'), true);
  context.openAgenda();
  assert.equal(bodyClasses.has('senior-mode'), true);
  await context.openView({ id: 'aidant', role: 'aidant' });
  assert.equal(bodyClasses.has('senior-mode'), false);
  await context.openView({ id: 'pro', role: 'pro', verificationStatus: 'approved' });
  assert.equal(bodyClasses.has('senior-mode'), false);
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
  context.openScreen('messages');
  assert.equal(element('screen-messages').classList.contains('active'), false);
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
  context.openScreen('messages');
  assert.equal(element('screen-messages').classList.contains('active'), false);
  assert.equal(calls.includes('chargerPlanningPro'), false);
  context.openScreen('pro');
  assert.ok(element('screen-pro').classList.contains('active'));
});
