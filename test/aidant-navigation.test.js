const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

test('caregiver profiles and senior and caregiver notification settings start collapsed', () => {
  for (const [sectionId, detailsId, controls] of [
    ['settings-aidant-links', 'aidant-links-details', ['aidant-senior-select', 'aidant-link-form', 'aidant-link-management']],
    ['notification-settings-senior', 'senior-notification-preferences', ['enable-push-button', 'notification-preferences-form']],
    ['notification-settings-aidant', 'aidant-notification-preferences', ['enable-push-button', 'notification-preferences-form', 'aidant-task-reminders']]
  ]) {
    const start = source.indexOf(`id="${sectionId}"`);
    const section = source.slice(start, source.indexOf('</section>', start));
    const match = section.match(new RegExp(`<details([^>]*)id="${detailsId}"([^>]*)>`));
    assert.ok(match, `${detailsId} exists`);
    assert.doesNotMatch(match[1] + match[2], /\bopen\b/);
    for (const control of controls) assert.ok(section.indexOf(control) > match.index);
  }
  const shortcut = source.match(/onclick="([^"]+)">Gérer mes profils accompagnés<\/button>/);
  assert.ok(shortcut);
  const details = { open: false };
  let screen;
  vm.runInNewContext(shortcut[1], {
    switchScreen: value => { screen = value; },
    document: { getElementById: id => { assert.equal(id, 'aidant-links-details'); return details; } }
  });
  assert.equal(screen, 'settings');
  assert.equal(details.open, true);
});

test('both home pages open their own association settings', () => {
  assert.match(source, /<h2>Bonjour <span id="welcome-aidant-name">!<\/span><\/h2>\s*<\/div>\s*<\/div>\s*<div id="home-informations-aidant">/);
  for (const [sectionId, detailsId] of [['senior-home-links', 'senior-links-details'], ['aidant-home-links', 'aidant-links-details']]) {
    const start = source.indexOf(`id="${sectionId}"`);
    assert.ok(start !== -1);
    const section = source.slice(start, source.indexOf('</section>', start));
    const shortcut = section.match(/onclick="([^"]+)"/);
    assert.ok(shortcut);
    const details = { open: false };
    let screen;
    vm.runInNewContext(shortcut[1], {
      switchScreen: value => { screen = value; },
      document: { getElementById: id => { assert.equal(id, detailsId); return details; } }
    });
    assert.equal(screen, 'settings');
    assert.equal(details.open, true);
    const settings = source.slice(source.indexOf(`id="settings-${sectionId.startsWith('senior') ? 'senior' : 'aidant'}-links"`));
    assert.match(settings.slice(0, settings.indexOf('</section>')), new RegExp(`<details[^>]*id="${detailsId}"`));
  }
});

test('the senior link prompt reflects active associations and stays current after acceptance', async () => {
  const nodes = new Map();
  const makeNode = () => ({
    children: [], textContent: '', hidden: false,
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) { this[name] = callback; }
  });
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, makeNode());
    return nodes.get(id);
  };
  let result = { links: [], requests: [{ id: 'request', aidant_name: 'Aidant', aidant_email: 'a@example.test' }] };
  const context = {
    connectedUser: { id: 'senior-1', role: 'senior' },
    associationLoadId: 0,
    document: { getElementById: element, createElement: makeNode },
    window: { generationLiaisonTranslate: text => text },
    makeTextElement: (tag, text) => Object.assign(makeNode(), { tag, textContent: text }),
    seniorLinksRequest: async (url, options) => {
      if (options?.body?.decision === 'accept') result = { links: [{ aidant_name: 'Aidant', suspended_at: null }], requests: [] };
      return result;
    },
    showToast() {}
  };
  const start = source.indexOf('    async function chargerGestionAssociations()');
  const end = source.indexOf('    let emergencyNumberSelected', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.load = chargerGestionAssociations;`, context);
  await context.load();
  assert.equal(element('senior-home-links').hidden, false);
  const request = element('senior-link-management').children[0];
  await request.children.find(child => child.textContent === 'Accepter').click();
  assert.equal(element('senior-home-links').hidden, true);
  result = { links: [{ aidant_name: 'Aidant', suspended_at: '2026-01-01' }], requests: [] };
  await context.load();
  assert.equal(element('senior-home-links').hidden, false);
  result = { links: [], requests: [] };
  await context.load();
  assert.equal(element('senior-home-links').hidden, false);
  context.seniorLinksRequest = async () => { throw new Error('Connexion impossible'); };
  await context.load();
  assert.match(element('senior-home-links-status').textContent, /Impossible de vérifier/);
  const pending = [];
  context.seniorLinksRequest = () => new Promise(resolve => pending.push(resolve));
  const previous = context.load();
  context.connectedUser = { id: 'senior-2', role: 'senior' };
  const current = context.load();
  pending[1]({ links: [], requests: [] });
  await current;
  pending[0]({ links: [{ aidant_name: 'Ancien aidant', suspended_at: null }], requests: [] });
  await previous;
  assert.equal(element('senior-home-links').hidden, false);
});

test('inclusive account label preserves the existing senior role', () => {
  const registration = source.slice(source.indexOf('id="register-section"'), source.indexOf('id="legal-guardian-verification-panel"'));
  assert.match(registration, /<option value="senior">🧑 Personne accompagnée<\/option>/);
  assert.match(registration, /Nom de la personne accompagnée \(facultatif\)/);
  assert.match(source, /<summary>Mes profils accompagnés<\/summary>/);
  assert.match(source, /Aucune personne accompagnée associée/);
});

test('daily recipe is available to seniors and caregivers with or without a linked person', () => {
  for (const role of ['senior', 'aidant']) {
    const start = source.indexOf(`id="${role}-daily-recipe"`);
    const end = source.indexOf('</section>', start);
    assert.ok(start >= 0 && end > start);
    const section = source.slice(start, end);
    assert.match(section, /Recette du jour/);
    assert.match(section, /<details(?:\s[^>]*)?>\s*<summary/);
    assert.match(section, new RegExp(`id="${role}-recipe-content"`));
    assert.doesNotMatch(section, /senior-full-only/);
  }
  const noSenior = source.slice(source.indexOf('id="aidant-no-senior-panel"'), source.indexOf('id="aidant-senior-content"'));
  assert.match(noSenior, /id="aidant-no-senior-recipe-content"/);
  assert.doesNotMatch(source, /vide-greniers\.org|Brocantes et vide-greniers/);
});

test('the recipe changes each day and is identical across profiles', () => {
  const nodes = new Map();
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, { textContent: '' });
    return nodes.get(id);
  };
  let date = '2026-03-28';
  const context = { document: { getElementById: element }, dateCheckinBienEtre: () => date, Date, Math };
  const start = source.indexOf("    let dateRecetteAffichee = '';");
  const end = source.indexOf('    function authHeaders(', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.refresh = actualiserRecetteDuJour;`, context);
  const titles = [];
  for (let day = 0; day < 8; day++) {
    context.refresh();
    const title = element('senior-recipe-title').textContent;
    titles.push(title);
    for (const role of ['aidant', 'aidant-no-senior']) {
      assert.equal(element(`${role}-recipe-title`).textContent, title);
      assert.equal(element(`${role}-recipe-content`).textContent, element('senior-recipe-content').textContent);
    }
    assert.match(element('senior-recipe-content').textContent, /Pour 2 personnes/);
    date = new Date(Date.parse(`${date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  assert.equal(new Set(titles.slice(0, 7)).size, 7);
  assert.equal(titles[7], titles[0]);
});

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
    window: { generationLiaisonTranslate: value => value, generationLiaisonLocale: () => 'fr-FR' },
    dateCheckinBienEtre: () => '2028-02-29',
    calendarEventLabel: event => event.title,
    calendarEventDate: value => value.slice(0, 10),
    formatDateTime: value => value,
    progressArray: value => value || [],
    stageLabel: value => value,
    Date,
    planningRequest: url => {
      if (context.activeSeniorProfileId === 'old') return new Promise(resolve => { firstResolvers.push(resolve); });
      if (url.startsWith('/api/planning/calendar')) return Promise.resolve({ events: [
        { status: 'pending', title: 'En attente', scheduledAt: '2028-02-29T14:00:00Z' },
        { status: 'scheduled', title: 'Visite prévue', scheduledAt: '2028-02-29T15:00:00Z' },
        { status: 'scheduled', title: 'Autre rendez-vous', scheduledAt: '2028-02-29T16:00:00Z' },
        { status: 'scheduled', title: 'Dernier rendez-vous', scheduledAt: '2028-02-29T17:00:00Z' }
      ] });
      if (url === '/api/shared-tasks') return Promise.resolve({ tasks: [
        { title: 'Acheter du pain', dueDate: '2028-02-29', completed: false, assigned: false },
        { title: 'Ancienne tâche', dueDate: '2028-02-28', completed: false, assigned: true },
        { title: 'Tâche terminée', dueDate: '2028-02-29', completed: true, assigned: false },
        { title: 'Préparer le repas', dueDate: '2028-03-01', completed: false, assigned: false }
      ] });
      if (url === '/api/messages/unread-count') return Promise.reject(new Error('offline'));
      if (url === '/api/notifications') return Promise.resolve({ unreadCount: 2, notifications: [
        { createdAt: '2028-02-29T10:00:00Z', title: 'Nouvelle alerte', message: 'Détail de l’alerte' },
        { createdAt: '2028-02-28T10:00:00Z', title: 'Autre notification', message: 'Détail précédent' }
      ] });
      if (url === '/api/planning/following') return Promise.resolve({ visits: [
        { scheduledAt: '2028-02-29T10:00:00Z', visitType: 'Visite', progress: [
          { type: 'arrived', createdAt: '2028-02-29T10:01:00Z', note: 'Présent' },
          { type: 'completed', createdAt: '2028-02-29T11:00:00Z' },
          { type: 'old', createdAt: '2028-02-28T11:00:00Z' }
        ] }
      ] });
      if (url.startsWith('/api/planning/services/bookings')) return Promise.resolve({ bookings: [{ status: 'requested', scheduledAt: '2028-02-29T10:00:00Z' }, { status: 'cancelled', scheduledAt: '2028-02-29T11:00:00Z' }] });
      if (url === '/api/logs/all') return Promise.resolve([{ created_at: '2028-02-29T10:00:00Z', content: 'Repas reçu' }]);
      if (url === '/api/wellbeing/shared-check-ins') return Promise.resolve({ checkins: [{ createdAt: '2028-02-29T09:00:00Z' }] });
      throw new Error(`Unexpected request: ${url}`);
    }
  };
  const start = source.indexOf('    function etapesIntervenant(visits)');
  const end = source.indexOf('    function afficherProchainRendezVous()', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadSummary = chargerSyntheseAidant;`, context);
  const first = context.loadSummary();
  context.activeSeniorProfileId = 'new';
  await context.loadSummary();
  assert.equal(getElementById('aidant-summary-visit').textContent, 'Rendez-vous :\nEn attente\nVisite prévue\nAutre rendez-vous\nDernier rendez-vous');
  assert.equal(getElementById('aidant-summary-tasks').textContent, 'Tâches à faire : 2 · Pour aujourd’hui : 1 · Sans volontaire : 2\n• Acheter du pain · Date prévue : 29/02/2028\n• Préparer le repas · Date prévue : 01/03/2028');
  assert.equal(elements.has('aidant-summary-messages'), false);
  assert.equal(elements.has('aidant-summary-notifications'), false);
  assert.equal(getElementById('aidant-summary-following').textContent,
    '2028-02-29T11:00:00Z · Visite — completed\n2028-02-29T10:01:00Z · Visite — arrived : Présent');
  assert.match(getElementById('aidant-summary-services').textContent, /En attente de réponse : 1 · Annulés : 1/);
  assert.ok(!elements.has('aidant-summary-logs'));
  assert.match(getElementById('aidant-summary-checkins').textContent, / : 1$/);
  firstResolvers.forEach(resolve => resolve({}));
  await first;
  assert.match(getElementById('aidant-summary-tasks').textContent, /Acheter du pain/);
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
    formatDateTime: value => value,
    progressArray: value => value || [],
    stageLabel: value => value,
    Date,
    planningRequest: async url => {
      paths.push(url);
      if (url.startsWith('/api/planning/calendar')) return { events: [{ title: 'Rendez-vous prévu', scheduledAt: '2028-02-29T10:00:00Z' }] };
      if (url === '/api/shared-tasks') return { tasks: [{ title: 'Faire les courses', completed: false, dueDate: null }] };
      if (url === '/api/messages/unread-count') return { count: 1 };
      if (url === '/api/notifications') return { unreadCount: 0, notifications: [
        { createdAt: '2028-02-29T10:00:00Z', title: 'Alerte senior', message: 'Information reçue' }
      ] };
      if (url === '/api/planning/following') return { visits: [] };
      if (url.startsWith('/api/planning/services/bookings')) return { bookings: [] };
      if (url === '/api/logs/all') return [];
      throw new Error(`Unexpected request: ${url}`);
    }
  };
  const start = source.indexOf('    function etapesIntervenant(visits)');
  const end = source.indexOf('    function afficherProchainRendezVous()', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadSummary = chargerSyntheseSenior;`, context);
  await context.loadSummary();
  assert.match(elements.get('senior-summary-visit').textContent, /Rendez-vous prévu/);
  assert.equal(elements.get('senior-summary-tasks').textContent, 'Tâches à faire : 1 · Pour aujourd’hui : 0\n• Faire les courses');
  assert.equal(elements.get('senior-today-tasks').textContent, elements.get('senior-summary-tasks').textContent);
  assert.equal(elements.get('senior-summary-messages').textContent, 'Messages non lus : 1');
  assert.equal(elements.get('senior-summary-notifications').textContent, '');
  assert.equal(elements.get('senior-summary-notifications').hidden, true);
  assert.equal(elements.has('senior-summary-notification-details'), false);
  assert.equal(elements.get('senior-summary-following').hidden, true);
  assert.ok(!elements.has('senior-summary-logs'));
  assert.ok(paths.some(path => path === '/api/planning/calendar?start=2028-02-29&end=2028-03-01'));
  assert.ok(!paths.includes('/api/wellbeing/shared-check-ins'));
});

test('senior today summary removes past dates without deleting data and refreshes across Paris midnight', async () => {
  const elements = new Map();
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: false });
    return elements.get(id);
  };
  let today = '2028-02-29';
  let resolveCalendar;
  const paths = [];
  const tasks = [
    { title: 'Hier', completed: false, dueDate: '2028-02-28' },
    { title: 'Aujourd’hui', completed: false, dueDate: '2028-02-29' },
    { title: 'Demain', completed: false, dueDate: '2028-03-01' },
    { title: 'Sans date', completed: false, dueDate: null }
  ];
  const events = [
    { title: 'Hier à Paris', scheduledAt: '2028-02-28T22:30:00Z' },
    { title: 'Aujourd’hui à Paris', scheduledAt: '2028-02-28T23:30:00Z' },
    { title: 'Demain à Paris', scheduledAt: '2028-02-29T23:30:00Z' }
  ];
  const context = {
    connectedUser: { id: 'senior', role: 'senior', seniorId: 'profile' },
    activeSeniorProfileId: '', aidantSummaryLoadId: 0, aidantSummaryContext: '',
    document: { getElementById }, window: { generationLiaisonTranslate: value => value, generationLiaisonLocale: () => 'fr-FR' },
    dateCheckinBienEtre: () => today, calendarEventLabel: event => event.title,
    progressArray: value => value || [], stageLabel: value => value, Date, Intl,
    planningRequest: url => {
      paths.push(url);
      if (url.startsWith('/api/planning/calendar')) {
        if (today === '2028-03-01') return new Promise(resolve => { resolveCalendar = resolve; });
        return Promise.resolve({ events });
      }
      if (url === '/api/shared-tasks') return Promise.resolve({ tasks });
      if (url === '/api/messages/unread-count') return Promise.resolve({ count: 0 });
      if (url === '/api/notifications') return Promise.resolve({ unreadCount: 0 });
      if (url === '/api/planning/following') return Promise.resolve({ visits: [] });
      if (url.startsWith('/api/planning/services/bookings')) {
        return Promise.resolve({ bookings: events.map(event => ({ scheduledAt: event.scheduledAt, status: 'requested' })) });
      }
      throw new Error(`Unexpected request: ${url}`);
    }
  };
  const calendarStart = source.indexOf('    function calendarEventDate(value)');
  const calendarEnd = source.indexOf('    function calendarEventLabel(event)', calendarStart);
  const start = source.indexOf('    function etapesIntervenant(visits)');
  const end = source.indexOf('    function afficherProchainRendezVous()', start);
  vm.runInNewContext(`${source.slice(calendarStart, calendarEnd)}\n${source.slice(start, end)}`, context);
  await context.chargerSyntheseSenior();
  assert.equal(getElementById('senior-summary-visit').textContent, 'Rendez-vous :\nAujourd’hui à Paris');
  assert.equal(getElementById('senior-summary-tasks').textContent, 'Tâches à faire : 3 · Pour aujourd’hui : 1\n• Aujourd’hui · Date prévue : 29/02/2028\n• Demain · Date prévue : 01/03/2028\n• Sans date');
  assert.match(getElementById('senior-summary-services').textContent, /Services du jour : 1/);
  assert.equal(tasks.length, 4);
  today = '2028-03-01';
  const pending = context.chargerSyntheseSenior();
  assert.equal(getElementById('senior-summary-visit').textContent, 'Chargement…');
  today = '2028-03-02';
  resolveCalendar({ events });
  await pending;
  assert.equal(getElementById('senior-summary-visit').textContent, 'Rendez-vous : Aucun aujourd’hui.');
  assert.equal(getElementById('senior-summary-services').textContent, '');
  assert.equal(getElementById('senior-summary-tasks').textContent, 'Tâches à faire : 1 · Pour aujourd’hui : 0\n• Sans date');
  assert.ok(paths.includes('/api/planning/calendar?start=2028-03-02&end=2028-03-03'));
  assert.equal(tasks.length, 4);
  assert.match(source, /screen-senior-pro'\)\.classList\.contains\('active'\)\) \{\s*chargerSyntheseSenior\(\);/);
});

test('senior history shows dated appointments and tasks for the previous 30 Paris days', async () => {
  const children = [];
  const list = {
    textContent: '',
    replaceChildren() { children.length = 0; },
    append(child) { children.push(child); }
  };
  const details = { open: true };
  const paths = [];
  let today = '2028-03-01';
  let release;
  const tasks = [
    { title: 'Limite incluse', dueDate: '2028-01-31', completed: true },
    { title: 'Trop ancienne', dueDate: '2028-01-30', completed: false },
    { title: 'Hier', dueDate: '2028-02-29', completed: false },
    { title: 'Ce jour', dueDate: '2028-03-01', completed: false },
    { title: 'Sans date', dueDate: null, completed: false }
  ];
  const events = [
    { title: 'À la limite', scheduledAt: '2028-01-30T23:30:00Z' },
    { title: 'Trop ancien', scheduledAt: '2028-01-30T22:30:00Z' },
    { title: 'Dernier rendez-vous', scheduledAt: '2028-02-28T23:30:00Z' },
    { title: 'Ce jour', scheduledAt: '2028-02-29T23:30:00Z' }
  ];
  const context = {
    connectedUser: { id: 'senior', role: 'senior', seniorId: 'profile' },
    historyLoadId: 0, historyContext: '',
    document: { getElementById: id => id === 'senior-history-details' ? details : list },
    window: { generationLiaisonTranslate: text => text, generationLiaisonLocale: () => 'fr-FR' },
    dateCheckinBienEtre: () => today, calendarEventLabel: event => event.title,
    makeTextElement: (tag, text) => ({ tag, text }), Date, Intl,
    planningRequest: async path => {
      paths.push(path);
      return path.startsWith('/api/planning/calendar') ? { events } : { tasks };
    }
  };
  const calendarStart = source.indexOf('    function calendarEventDate(value)');
  const calendarEnd = source.indexOf('    function calendarEventLabel(event)', calendarStart);
  const start = source.indexOf('    async function chargerHistoriqueQuotidien(role)');
  const end = source.indexOf('    function afficherProchainRendezVous()', start);
  vm.runInNewContext(`${source.slice(calendarStart, calendarEnd)}\n${source.slice(start, end)}`, context);
  await context.chargerHistoriqueQuotidien('senior');
  assert.ok(paths.includes('/api/planning/calendar?start=2028-01-31&end=2028-03-01'));
  assert.equal(children.length, 4);
  assert.match(children[0].text, /Hier — À faire/);
  assert.match(children[1].text, /Dernier rendez-vous/);
  assert.ok(children.some(child => /Limite incluse — Terminée/.test(child.text)));
  assert.ok(children.some(child => /À la limite/.test(child.text)));
  assert.ok(children.every(child => !/Trop|Ce jour|Sans date/.test(child.text)));
  assert.equal(tasks.length, 5);
  context.planningRequest = path => path.startsWith('/api/planning/calendar')
    ? Promise.reject(new Error('offline')) : Promise.resolve({ tasks: [] });
  await context.chargerHistoriqueQuotidien('senior');
  assert.equal(children[0].text, 'Impossible de charger l’historique des rendez-vous.');
  context.planningRequest = path => path.startsWith('/api/planning/calendar')
    ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ tasks });
  const pending = context.chargerHistoriqueQuotidien('senior');
  details.open = false;
  children.length = 0;
  release({ events });
  await pending;
  assert.equal(children.length, 0);
  details.open = true;
  today = '2028-03-02';
  context.planningRequest = async path => path.startsWith('/api/planning/calendar') ? { events: [] } : { tasks: [] };
  await context.chargerHistoriqueQuotidien('senior');
  assert.match(children[0].text, /Aucun rendez-vous ou tâche datée/);
});

test('caregiver and professional histories use their authorized tasks and discard old profile responses', async () => {
  const children = [];
  const lists = {
    aidant: { replaceChildren() { children.length = 0; }, append(item) { children.push(item); } },
    pro: { replaceChildren() { children.length = 0; }, append(item) { children.push(item); } }
  };
  const details = { open: true };
  const paths = [];
  let release;
  const context = {
    connectedUser: { id: 'user', role: 'aidant' }, activeSeniorProfileId: 'old',
    historyLoadId: 0, historyContext: '',
    document: { getElementById: id => id.endsWith('-details') ? details : lists[id.split('-')[0]] },
    window: { generationLiaisonTranslate: text => text, generationLiaisonLocale: () => 'fr-FR' },
    dateCheckinBienEtre: () => '2028-03-01',
    calendarEventDate: value => value.slice(0, 10), calendarEventLabel: event => event.title,
    makeTextElement: (tag, text) => ({ tag, text }), Date, Intl,
    planningRequest: path => {
      paths.push(path);
      if (path.startsWith('/api/planning/calendar')) return Promise.resolve({ events: [] });
      if (context.activeSeniorProfileId === 'old') return new Promise(resolve => { release = resolve; });
      return Promise.resolve({ tasks: [{ dueDate: '2028-02-29', title: 'Tâche autorisée', seniorName: 'Camille' }] });
    }
  };
  const start = source.indexOf('    async function chargerHistoriqueQuotidien(role)');
  const end = source.indexOf('    function afficherProchainRendezVous()', start);
  vm.runInNewContext(source.slice(start, end), context);
  const pending = context.chargerHistoriqueQuotidien('aidant');
  context.activeSeniorProfileId = 'new';
  await context.chargerHistoriqueQuotidien('aidant');
  assert.match(children[0].text, /Tâche autorisée/);
  release({ tasks: [{ dueDate: '2028-02-29', title: 'Ancien profil' }] });
  await pending;
  assert.doesNotMatch(children[0].text, /Ancien profil/);
  assert.ok(paths.includes('/api/shared-tasks'));
  paths.length = 0;
  context.connectedUser = { id: 'professional', role: 'pro' };
  await context.chargerHistoriqueQuotidien('pro');
  assert.ok(paths.includes('/api/intervention-tasks'));
  assert.ok(!paths.includes('/api/shared-tasks'));
  assert.match(children[0].text, /Tâche autorisée — Camille/);
});

test('professional summary uses only professional-accessible data and shows pending requests', async () => {
  const elements = new Map();
  const paths = [];
  let tasks = [
    { title: 'Passée', seniorName: 'Camille', completed: false, dueDate: '2028-02-28' },
    { title: 'Apporter les courses', seniorName: 'Camille', completed: false, dueDate: '2028-02-29' },
    { title: 'Ranger', seniorName: 'Marie', completed: false, dueDate: null },
    { title: 'Terminée', seniorName: 'Marie', completed: true, dueDate: '2028-02-28' }
  ];
  const context = {
    connectedUser: { id: 'pro', role: 'pro', seniorId: 'profile' },
    activeSeniorProfileId: '', aidantSummaryLoadId: 0, aidantSummaryContext: '',
    document: { getElementById(id) { if (!elements.has(id)) elements.set(id, { textContent: '' }); return elements.get(id); } },
    window: { generationLiaisonTranslate: value => value, generationLiaisonLocale: () => 'fr-FR' },
    dateCheckinBienEtre: () => '2028-02-29',
    calendarEventLabel: event => event.title,
    calendarEventDate: value => value.slice(0, 10),
    formatDateTime: value => value,
    progressArray: value => value || [],
    stageLabel: value => value,
    Date,
    planningRequest: async url => {
      paths.push(url);
      if (url.startsWith('/api/planning/calendar')) return { events: [{ title: 'Visite prévue', scheduledAt: '2028-02-29T10:00:00Z' }] };
      if (url === '/api/messages/unread-count') return { count: 1 };
      if (url === '/api/notifications') return { unreadCount: 1, notifications: [
        { createdAt: '2028-02-29T10:00:00Z', title: 'Invitation', message: 'Une visite est proposée' }
      ] };
      if (url.startsWith('/api/planning/services/bookings')) return { bookings: [] };
      if (url === '/api/directory/bookings') return { bookings: [{ status: 'pending' }, { status: 'confirmed' }] };
      if (url === '/api/intervention-tasks') {
        if (tasks === null) throw new Error('Unavailable');
        return { tasks };
      }
      if (url === '/api/planning/today?date=2028-02-29') return { visits: [{
        recipient: { name: 'Personne suivie' }, visitType: 'Visite',
        scheduledAt: '2028-02-29T09:00:00Z', status: 'scheduled',
        progress: [
          { type: 'arrived', createdAt: '2028-02-29T10:00:00Z', note: 'Ma note' },
          { type: 'completed', createdAt: '2028-02-29T11:00:00Z' },
          { type: 'old', createdAt: '2028-02-28T10:00:00Z' }
        ],
        teamProgress: [{ type: 'started', createdAt: '2028-02-29T10:30:00Z', note: 'Note partagée' }],
        teamVisits: [{ scheduledAt: '2028-02-29T12:00:00Z', status: 'planned', note: 'Autre note' }]
      }] };
      throw new Error(`Unexpected request: ${url}`);
    }
  };
  const start = source.indexOf('    function etapesIntervenant(visits)');
  const end = source.indexOf('    function afficherProchainRendezVous()', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadSummary = chargerSynthesePro;`, context);
  await context.loadSummary();
  assert.match(elements.get('pro-summary-visit').textContent, /Visite prévue/);
  assert.equal(elements.get('pro-summary-demands').textContent, 'Demandes de rendez-vous en attente : 1');
  assert.equal(elements.get('pro-summary-tasks').textContent, 'Tâches à faire : 3 · Pour aujourd’hui : 1 · En retard : 1\n• Passée — Camille · Date prévue : 28/02/2028 (En retard)\n• Apporter les courses — Camille · Date prévue : 29/02/2028\n• Ranger — Marie');
  assert.equal(elements.has('pro-summary-notifications'), false);
  assert.match(elements.get('pro-summary-following').textContent, /Visite 1 · Moi — arrived : Ma note/);
  assert.match(elements.get('pro-summary-following').textContent, /Visite 1 · Moi — completed/);
  assert.match(elements.get('pro-summary-following').textContent, /Visite 1 · Collègue — started : Note partagée/);
  assert.match(elements.get('pro-summary-following').textContent, /Visite 1 · Collègue — visit_planned/);
  assert.match(elements.get('pro-summary-following').textContent, /Visite 1 · Moi — visit_in_progress/);
  assert.doesNotMatch(elements.get('pro-summary-following').textContent, /old|Personne suivie|Autre note/);
  assert.ok(!paths.includes('/api/shared-tasks'));
  assert.ok(!paths.includes('/api/wellbeing/shared-check-ins'));
  assert.ok(!paths.includes('/api/planning/following'));
  tasks = [];
  await context.loadSummary();
  assert.equal(elements.get('pro-summary-tasks').textContent, 'Aucune tâche pour le moment.');
  assert.equal(elements.get('pro-summary-tasks').hidden, false);
  tasks = null;
  await context.loadSummary();
  assert.equal(elements.get('pro-summary-tasks').textContent, 'Impossible de charger les tâches.');
});

test('professional journal shows only the supplied assigned visits and their steps', () => {
  const children = [];
  const container = { replaceChildren() { children.length = 0; }, append(item) { children.push(item); } };
  const context = {
    document: {
      getElementById: () => container,
      createElement: tag => ({ tag, children: [], append(...items) { this.children.push(...items); } })
    },
    progressArray: value => value || [],
    formatDateTime: value => value,
    stageLabel: value => value,
    makeTextElement: (tag, text) => ({ tag, text }),
    Date
  };
  const start = source.indexOf('    function afficherJournalIntervenant(visits)');
  const end = source.indexOf('    async function chargerPlanningPro()', start);
  const helperStart = source.indexOf('    function etapesIntervenant(visits)');
  const helperEnd = source.indexOf('    function chargerSyntheseAidant()', helperStart);
  vm.runInNewContext(`${source.slice(helperStart, helperEnd)}${source.slice(start, end)}\nglobalThis.showJournal = afficherJournalIntervenant;`, context);
  context.showJournal([{ recipient: { name: 'Personne suivie' }, visitType: 'Visite', progress: [
    { type: 'arrived', createdAt: '2028-02-29T10:00:00Z', note: 'Présent' },
    { type: 'completed', createdAt: '2028-02-29T11:00:00Z' }
  ], teamProgress: [{ type: 'started', createdAt: '2028-02-29T10:30:00Z', note: 'Note privée' }] }]);
  assert.equal(children[0].children[2].text, 'Visite 1 · Moi — completed');
  assert.equal(children[1].children[2].text, 'Visite 1 · Collègue — started : Note privée');
  assert.equal(children[2].children[2].text, 'Visite 1 · Moi — arrived : Présent');
  context.showJournal([]);
  assert.equal(children[0].text, 'Aucune étape pour les visites de cette date.');
});

test('daily journal sorts shared updates and reports unavailable sources', async () => {
  const children = [];
  const requests = [];
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
    stageLabel: value => value,
    progressArray: value => value,
    planningRequest: async path => {
      requests.push(path);
      return path === '/api/logs/all' ? [
        { created_at: '2028-01-01T10:00:00Z', author_id: 2, content: 'Nouvelle familiale' },
        { created_at: '2028-01-02T09:00:00Z', author_id: 3, content: 'Nouvelle professionnelle' },
        { created_at: '2028-01-03T10:00:00Z', author_id: 2, content: 'Nouvelle du jour' }
      ]
      : { visits: [{ visitType: 'Visite', progress: [
        { type: 'arrived', createdAt: '2028-01-02T10:00:00Z', note: 'Présent', authorRole: 'pro' },
        { type: 'completed', createdAt: '2028-01-02T23:30:00Z', authorRole: 'pro' },
        { type: 'future', createdAt: '2028-01-03T23:30:00Z', authorRole: 'pro' }
      ] }] };
    }
  };
  const helperStart = source.indexOf('    function auteurAvecRole(role, name = \'\')');
  const start = source.indexOf('    async function chargerJournalQuotidien(role)');
  const end = source.indexOf('    function configurerAlbumJournal()', start);
  const dateStart = source.indexOf('    function calendarEventDate(value)');
  const dateEnd = source.indexOf('    function calendarEventLabel(event)', dateStart);
  vm.runInNewContext(`${source.slice(dateStart, dateEnd)}${source.slice(helperStart, start)}${source.slice(start, end)}\nglobalThis.loadJournal = chargerJournalQuotidien;`, context);
  await context.loadJournal('aidant');
  assert.deepEqual(requests, ['/api/logs/all', '/api/planning/following']);
  assert.equal(children[0].children[2].text, '🩺 Soignant · Visite — completed');
  assert.equal(children[1].children[2].text, '🩺 Soignant · Visite — arrived : Présent');
  assert.equal(children[2].children[2].text, '🩺 Soignant · Nouvelle professionnelle');
  assert.equal(children[3].children[2].text, '👨‍👩‍👧‍👦 Famille · Nouvelle familiale');
  assert.equal(children.length, 4);
  context.connectedUser = { id: 'senior', role: 'senior', seniorId: 'senior-1' };
  await context.loadJournal('senior');
  assert.equal(children.length, 3);
  assert.equal(children[0].children[2].text, '🩺 Soignant · Visite — arrived : Présent');
  context.connectedUser = { id: 'aidant', role: 'aidant' };
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

test('caregiver explanations use hover on desktop and a labelled touch control', () => {
  assert.match(source, /#aidant-senior-content \.senior-explanation\[data-help-enhanced\] > summary,\s*#screen-senior-pro \.senior-explanation\[data-help-enhanced\] > summary\s*\{\s*display:\s*none;/);
  assert.match(source, /@media \(hover: none\)\s*\{\s*#aidant-senior-content \.senior-explanation\[data-help-enhanced\] > summary\s*\{[^}]*display:\s*inline-flex;[^}]*font-size:\s*1rem;/);
  assert.doesNotMatch(source, /#aidant-senior-content \.senior-explanation\[data-help-enhanced\] > summary::before/);
  assert.match(source, /\.screen-container:not\(#screen-aidant\) \.journal-help\[data-help-enhanced\] > summary::before/);
});

test('daily journal loads older updates, retries failures and discards a stale page', async () => {
  const children = [];
  const container = {
    replaceChildren() { children.length = 0; },
    append(item) { children.push(item); }
  };
  const page = Array.from({ length: 100 }, (_, index) => ({
    id: 100 - index, created_at: '2020-01-01T10:00:00Z',
    author_id: 2, author_name: 'Camille', content: `Note ${index}`
  }));
  let nextPage = async () => { throw new Error('offline'); };
  const context = {
    connectedUser: { id: 'aidant', role: 'aidant' }, activeSeniorProfileId: 'senior-1', familyJournalRevision: 0,
    document: {
      getElementById: () => container,
      createElement: tag => ({ tag, children: [], append(...items) { this.children.push(...items); } })
    },
    makeTextElement: (tag, text) => ({
      tag, text, addEventListener(event, callback) { this[event] = callback; }
    }),
    formatDateTime: value => value,
    dateCheckinBienEtre: () => '2028-01-03',
    calendarEventDate: value => value.slice(0, 10),
    stageLabel: value => value,
    progressArray: value => value,
    console: { error() {} },
    window: { generationLiaisonTranslate: value => value },
    planningRequest: async path => path === '/api/logs/all' ? page
      : path === '/api/planning/following' ? { visits: [] } : nextPage(path)
  };
  const helperStart = source.indexOf('    function auteurAvecRole(role, name = \'\')');
  const start = source.indexOf('    async function chargerJournalQuotidien(role)');
  const end = source.indexOf('    function configurerAlbumJournal()', start);
  vm.runInNewContext(`${source.slice(helperStart, start)}${source.slice(start, end)}\nglobalThis.loadJournal = chargerJournalQuotidien;`, context);
  await context.loadJournal('aidant');
  assert.equal(children[0].children[2].text, '👨‍👩‍👧‍👦 Famille · Camille · Note 0');
  await children[100].click();
  assert.match(children[100].text, /Impossible de charger/);
  nextPage = async path => {
    assert.equal(path, '/api/logs/all?before=1');
    return [{ id: 0, created_at: '2019-01-01T10:00:00Z', author_id: 2, content: 'Ancienne' }];
  };
  await children[101].click();
  assert.equal(children.length, 101);
  assert.equal(children[100].children[2].text, '👨‍👩‍👧‍👦 Famille · Ancienne');
  await context.loadJournal('aidant');
  let release;
  nextPage = () => new Promise(resolve => { release = resolve; });
  const pending = children[100].click();
  context.activeSeniorProfileId = 'senior-2';
  container.replaceChildren();
  release([{ id: 0, created_at: '2019-01-01T10:00:00Z', content: 'Ancien profil' }]);
  await pending;
  assert.equal(children.length, 0);
});

test('weekly gazette includes only family notes and approved photos from the seven Paris days', async () => {
  const nodes = {};
  function node(tag = 'div') {
    const item = {
      tag, children: [], textContent: '', hidden: false, disabled: false,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      cloneNode() { return this; }
    };
    Object.defineProperty(item, 'firstElementChild', { get() { return this.children[0]; } });
    if (tag === 'img') Object.defineProperty(item, 'src', {
      set(value) { this._src = value; queueMicrotask(() => this.onload()); },
      get() { return this._src; }
    });
    return item;
  }
  const get = id => nodes[id] ||= node();
  const fetched = [], revoked = [];
  let printCalls = 0;
  const classes = new Set();
  const context = {
    connectedUser: { id: 'aidant', role: 'aidant' }, activeSeniorProfileId: 's1',
    weeklyGazetteRevision: 0, weeklyGazetteUrls: [], SERVER_URL: '',
    document: {
      getElementById: get, createElement: node,
      body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } }
    },
    URL: { createObjectURL: () => 'blob:photo', revokeObjectURL: url => revoked.push(url) },
    window: { print: () => { printCalls++; } },
    dateCheckinBienEtre: () => '2028-04-03',
    formatDateTime: value => value,
    auteurAvecRole: role => String(role),
    makeTextElement: (tag, text) => ({ tag, textContent: text }),
    authHeaders: () => ({ Authorization: 'test' }),
    planningRequest: async path => path === '/api/logs/weekly-family'
      ? { start: '2028-03-28', end: '2028-04-03', truncated: false, notes: [
        { created_at: '2028-03-27T22:30:00Z', log_type: 'family_note', content: 'Bonjour', author_id: 2 },
        { created_at: '2028-03-27T21:59:00Z', log_type: 'family_note', content: 'Ancien', author_id: 2 },
        { created_at: '2028-04-03T12:00:00Z', log_type: 'medical_report', content: 'Privé', author_id: 3 },
        { created_at: '2028-04-03T22:01:00Z', log_type: 'family_note', content: 'Futur', author_id: 2 }
      ] } : { photos: [
        { id: 'approved', approved: true, createdAt: '2028-04-03T10:00:00Z', authorName: 'Alice', authorRole: 'aidant' },
        { id: 'pending', approved: false, createdAt: '2028-04-03T10:00:00Z' },
        { id: 'old', approved: true, createdAt: '2028-03-27T10:00:00Z' }
      ] },
    fetch: async (url, options) => {
      fetched.push({ url, options });
      return { ok: true, blob: async () => ({}) };
    },
    queueMicrotask
  };
  const start = source.indexOf('    function reinitialiserGazette()');
  const end = source.indexOf('    function configurerAlbumJournal()', start);
  const dateStart = source.indexOf('    function calendarEventDate(value)');
  const dateEnd = source.indexOf('    function calendarEventLabel(', dateStart);
  vm.runInNewContext(source.slice(dateStart, dateEnd), context);
  vm.runInNewContext(source.slice(start, end), context);
  await context.preparerGazette('aidant');
  const preview = get('aidant-weekly-preview').children[0];
  const text = JSON.stringify(preview);
  assert.match(text, /Bonjour/);
  assert.doesNotMatch(text, /Ancien|Privé|Futur/);
  assert.equal(fetched.length, 1);
  assert.match(fetched[0].url, /approved/);
  assert.equal(fetched[0].options.cache, 'no-store');
  assert.equal(get('aidant-weekly-print').hidden, false);
  context.imprimerGazette('aidant');
  assert.equal(printCalls, 1);
  assert.equal(classes.has('gazette-printing'), true);
  context.reinitialiserGazette();
  assert.deepEqual(revoked, ['blob:photo']);
  assert.equal(get('aidant-weekly-preview').children.length, 0);
  assert.equal(classes.has('gazette-printing'), false);
  context.planningRequest = async path => path === '/api/logs/weekly-family'
    ? { start: '2028-03-28', end: '2028-04-03', truncated: true, notes: [] }
    : { photos: [] };
  await context.preparerGazette('aidant');
  assert.match(JSON.stringify(get('aidant-weekly-preview').children), /gazette peut être incomplète/);
});

test('weekly gazette rejects failed or stale loads without exposing partial data', async () => {
  const elements = {};
  const get = id => elements[id] ||= {
    children: [], textContent: '', hidden: false, disabled: false,
    replaceChildren(...children) { this.children = children; }
  };
  let release;
  const context = {
    connectedUser: { id: 'aidant', role: 'aidant' }, activeSeniorProfileId: 's1',
    weeklyGazetteRevision: 0, weeklyGazetteUrls: [],
    document: { getElementById: get, body: { classList: { remove() {} } } },
    URL: { revokeObjectURL() {} },
    planningRequest: path => path === '/api/logs/weekly-family'
      ? new Promise(resolve => { release = resolve; })
      : Promise.resolve({ photos: [] })
  };
  const start = source.indexOf('    function reinitialiserGazette()');
  const end = source.indexOf('    function configurerAlbumJournal()', start);
  vm.runInNewContext(source.slice(start, end), context);
  const pending = context.preparerGazette('aidant');
  context.activeSeniorProfileId = 's2';
  context.reinitialiserGazette();
  release([{ content: 'Ancien profil' }]);
  await pending;
  assert.equal(get('aidant-weekly-preview').children.length, 0);
  assert.equal(get('aidant-weekly-print').hidden, true);
  context.planningRequest = async () => { throw new Error('Données indisponibles'); };
  await context.preparerGazette('aidant');
  assert.equal(get('aidant-weekly-status').textContent, 'Données indisponibles');
  assert.equal(get('aidant-weekly-print').hidden, true);
  assert.equal(get('aidant-weekly-prepare').disabled, false);
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
  const featureDisclosures = Object.fromEntries(
    ['senior', 'aidant', 'pro', 'more', 'senior-pro', 'settings', 'agenda', 'directory', 'contacts', 'messages']
      .map(screen => [screen, [{ id: `${screen}-feature`, open: false }]])
  );
  const weatherDisclosures = [element('senior-weather-week'), element('aidant-weather-week')];
  const explanation = { open: false };
  const respite = [{ id: 'aidant-respite-details', open: false }];
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
        if (selector === '.screen-container details') return [
          ...tabDisclosures, ...Object.values(featureDisclosures).flat(), ...weatherDisclosures, ...respite, explanation
        ];
        if (selector === '.screen-container') return ['senior', 'aidant', 'pro', 'informations-senior', 'informations-aidant', 'informations-pro', 'settings', 'agenda', 'directory', 'contacts', 'messages'].map(name => element(`screen-${name}`));
        if (selector === '.nav-item') return ['senior', 'aidant', 'pro', 'settings', 'agenda', 'directory', 'contacts', 'notifications', 'logout'].map(name => element(`nav-${name}`));
        if (selector === '#aidant-respite > details:not(.senior-explanation)') return respite;
        const match = selector.match(/^#screen-(.+) details:not\(\.senior-explanation\)$/);
        if (match) return featureDisclosures[match[1]] || [];
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
    announcementRefreshTimer: null,
    announcementLoadId: 0,
    nextVisitLoadId: 0,
    nextVisitEvent: null,
    nextVisitMessage: '',
    connectedUser: null,
    currentUser: null,
    activeSeniorProfileId: '',
    directoryLoadId: 0,
    associationLoadId: 0,
    establishmentOverviewLoadId: 0,
    wellbeingLoadedDate: null,
    wellbeingLoadId: 0,
    currentWellbeingCheckin: null,
    reinitialiserCheckinBienEtre() {},
    SERVER_URL: '',
    authHeaders: () => ({}),
    afficherAccueilSenior() {},
    reinitialiserPhotosContacts() {},
    reinitialiserPhotoMessages() {},
    reinitialiserProfil() {},
    reinitialiserChoixTablette() {},
    chargerPhotoProfil() {},
    updatePlanningDateTitle() {},
    ...Object.fromEntries([
      'chargerNotifications', 'chargerMessagesAdministration', 'chargerPreferencesNotification', 'chargerCorrespondants', 'chargerMessagesSecurite', 'chargerBoiteReception', 'chargerLogs', 'chargerSyntheseAidant', 'chargerSyntheseSenior', 'chargerSynthesePro',
      'demanderNotificationsAutomatiquement',
      'chargerCheckinsPartages', 'chargerSuiviPartage', 'chargerConsentements',
      'chargerServicesFamiliaux', 'chargerAnnuaire', 'chargerDirectoryBookings',
      'chargerContacts', 'chargerGestionAssociations', 'chargerDirectoryProfile',
      'chargerPlanningPro', 'chargerPlanningServices', 'chargerLegalGuardianDocuments',
      'chargerProfessionalVerificationDocuments', 'chargerCheckinBienEtre',
      'chargerAssistantConversation', 'chargerProchainRendezVous', 'afficherProchainRendezVous', 'chargerCalendrier', 'chargerPartagesAgenda', 'chargerModificationsGoogle',
      'chargerParametresGooglePlanning', 'reinitialiserPlanningProfessionnel', 'reinitialiserSuiviPartage', 'reinitialiserCalendrier', 'reinitialiserPartagesAgenda', 'reinitialiserTachesPartagees', 'reinitialiserAnnuairePartage', 'chargerAnnuairePartage', 'chargerContactsUtiles', 'chargerTachesPartagees',
      'reinitialiserAlbumJournal', 'chargerAlbumFamilial', 'chargerJournalQuotidien',
      'reinitialiserMeteo', 'chargerMeteo', 'actualiserRecetteDuJour', 'reinitialiserCentresInteret',
      'chargerCentresInteret', 'afficherDecouvertesDuJour',
      'chargerEtablissement',
      'chargerResidentsSoignant', 'reinitialiserCarnetEtablissement', 'fermerActionsEtablissement', 'reinitialiserChiffresEtablissement',
      'annulerDicteeMessage', 'annulerPropositionMessage', 'reinitialiserChargementConversationSenior', 'reinitialiserFiltresMessages', 'initialiserLectureSenior', 'initialiserVueSenior', 'initialiserPresentation', 'planifierLectureSenior'
    ].map(name => [name, () => { calls.push(name); }])),
    dateCheckinBienEtre: () => '2026-01-01',
    definirVueCalendrier: view => { context.calendarView = view; calls.push('definirVueCalendrier'); },
    calendarView: 'week',
    calendarDate: ''
  };
  const screenStart = source.indexOf('    function switchScreen(');
  const screenEnd = source.indexOf('    function basculerFormulaire', screenStart);
  const viewStart = source.indexOf('    async function setAuthenticatedView(user)');
  const viewEnd = source.indexOf('    function afficherAccueilSenior(user)', viewStart);
  assert.ok(screenStart >= 0 && screenEnd > screenStart && viewStart >= 0 && viewEnd > viewStart);
  vm.runInNewContext(
    `${source.slice(screenStart, screenEnd)}\n${source.slice(viewStart, viewEnd)}\n` +
      'globalThis.openView = setAuthenticatedView; globalThis.openScreen = switchScreen; globalThis.openAgenda = ouvrirAgenda;',
    context
  );
  return { context, element, calls, bodyClasses, tabDisclosures, featureDisclosures, weatherDisclosures, respite, explanation };
}

test('refreshing the same account keeps shared drafts while account changes clear them', async () => {
  const { context, calls } = createView({ seniors: [] });
  await context.openView({ id: 'one', role: 'senior', seniorId: 'profile-one' });
  calls.length = 0;
  await context.openView({ id: 'one', role: 'senior', seniorId: 'profile-one' });
  assert.ok(!calls.includes('reinitialiserSuiviPartage'));
  await context.openView({ id: 'two', role: 'senior', seniorId: 'profile-two' });
  assert.ok(calls.includes('reinitialiserSuiviPartage'));
});

test('establishment accounts open only their dedicated workspace', async () => {
  const { context, element, calls } = createView({ seniors: [] });
  await context.openView({ id: 'director', role: 'establishment' });
  assert.ok(element('screen-establishment').classList.contains('active'));
  assert.equal(element('nav-bar').style.display, 'none');
  assert.ok(calls.includes('chargerEtablissement'));
  assert.ok(calls.includes('initialiserVueSenior'));
  assert.ok(!calls.includes('chargerNotifications'));
});

test('a resident with a temporary password must change it before entering the workspace', async () => {
  const { context, element, calls } = createView({ seniors: [] });
  await context.openView({ id: 'resident', role: 'senior', passwordChangeRequired: true });
  assert.ok(element('screen-resident-password').classList.contains('active'));
  assert.equal(element('nav-bar').style.display, 'none');
  assert.ok(calls.includes('initialiserVueSenior'));
  assert.ok(!calls.includes('chargerNotifications'));
});

test('establishment staff open their restricted workspace', async () => {
  const { context, element, calls } = createView({ seniors: [] });
  await context.openView({ id: 'staff', role: 'staff' });
  assert.ok(element('screen-staff').classList.contains('active'));
  assert.equal(element('nav-bar').style.display, 'none');
  assert.ok(calls.includes('chargerResidentsSoignant'));
  assert.ok(calls.includes('initialiserVueSenior'));
  assert.ok(!calls.includes('chargerNotifications'));
});

test('sections start closed, preserve user choices while navigating and keep settings separate', async () => {
  const { context, tabDisclosures, calls, featureDisclosures, weatherDisclosures, explanation } = createView({ seniors: [] });
  featureDisclosures.senior[0].open = true;
  weatherDisclosures[0].open = true;
  explanation.open = true;
  await context.openView({ id: 'senior', role: 'senior' });
  assert.ok(featureDisclosures.senior.every(details => !details.open));
  assert.ok(weatherDisclosures.every(details => !details.open));
  assert.equal(explanation.open, false);
  assert.ok(tabDisclosures.every(details => !details.open));
  featureDisclosures.senior[0].open = true;
  context.openScreen('agenda');
  assert.ok(featureDisclosures.agenda.every(details => !details.open));
  context.openScreen('senior');
  assert.equal(featureDisclosures.senior[0].open, true);
  calls.length = 0;
  context.openScreen('settings');
  assert.ok(calls.includes('chargerConsentements'));
  await context.openView({ id: 'aidant', role: 'aidant' });
  assert.ok(tabDisclosures.every(details => !details.open));
  assert.equal(featureDisclosures.senior[0].open, false);
});

test('an aidant without a linked senior can use account navigation without loading senior data', async () => {
  const { context, element, calls } = createView({ seniors: [] });
  await context.openView({ id: 'aidant', role: 'aidant' });
  assert.equal(element('aidant-home-links').hidden, false);
  assert.equal(element('aidant-no-senior-panel').style.display, 'block');
  assert.equal(element('aidant-senior-content').style.display, 'none');
  assert.equal(element('notification-settings-aidant').style.display, 'block');
  assert.equal(calls.includes('chargerLogs'), false);
  context.openScreen('directory');
  context.openScreen('contacts');
  assert.ok(calls.includes('chargerAnnuaire'));
  assert.ok(calls.includes('chargerContacts'));
});

test('aidant functions retain their content', () => {
  for (const [id, content] of [
    ['aidant-checkins-details', 'aidant-wellbeing-shared'],
    ['aidant-feed-details', 'logs-list'],
    ['aidant-following-details', 'aidant-live-following'],
    ['aidant-team-message-details', 'aidant-person-note-form'],
    ['aidant-services-details', 'aidant-service-area']
  ]) {
    const section = source.match(new RegExp(`<details class="senior-disclosure" id="${id}">([\\s\\S]*?)</section>`));
    assert.ok(section);
    assert.match(section[1], new RegExp(`id="${content}"`));
  }
});

test('each approved role keeps sections and weather closed until selected', async () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const { context, featureDisclosures, weatherDisclosures, respite } = createView({ seniors: [{ id: 'senior-1', name: 'Profil lié' }] });
    await context.openView({ id: role, role, verificationStatus: 'approved' });
    assert.ok(featureDisclosures[role].every(details => !details.open));
    assert.ok(weatherDisclosures.every(details => !details.open));
    assert.ok(respite.every(details => !details.open));
    for (const screen of ['agenda', 'contacts', 'messages', 'settings', ...(role === 'senior' ? ['more', 'senior-pro', 'directory'] : role === 'aidant' ? ['directory'] : [])]) {
      context.openScreen(screen);
      assert.ok(featureDisclosures[screen].every(details => !details.open));
    }
  }
});

test('returning to an open family section refreshes it without loading closed sections', async () => {
  const { context, element, calls } = createView({ seniors: [{ id: 'senior-1', name: 'Profil lié' }] });
  await context.openView({ id: 'aidant', role: 'aidant' });
  assert.equal(calls.includes('chargerTachesPartagees'), false);
  assert.equal(calls.includes('chargerContactsUtiles'), false);
  assert.equal(calls.includes('chargerAlbumFamilial'), false);
  element('aidant-tasks-details').open = true;
  element('aidant-album-details').open = true;
  calls.length = 0;
  context.openScreen('settings');
  context.openScreen('aidant');
  assert.ok(calls.includes('chargerTachesPartagees'));
  assert.ok(calls.includes('chargerAlbumFamilial'));
  assert.equal(calls.includes('chargerContactsUtiles'), false);
});

test('sharing, senior display and Google synchronization controls are in settings', async () => {
  const settings = source.slice(source.indexOf('<div id="screen-settings"'), source.indexOf('<div id="screen-agenda"'));
  for (const id of ['aidant-consents-details', 'senior-simple-enable', 'senior-simple-disable', 'calendar-google-settings']) {
    assert.match(settings, new RegExp(`id="${id}"`));
  }
  const { context, element, calls } = createView({ seniors: [{ id: 'senior-1', name: 'Profil lié' }] });
  await context.openView({ id: 'aidant', role: 'aidant' });
  context.openScreen('settings');
  assert.equal(element('settings-aidant-consents').hidden, false);
  assert.ok(calls.includes('chargerConsentements'));
  await context.openView({ id: 'pro', role: 'pro', verificationStatus: 'approved' });
  calls.length = 0;
  context.openScreen('settings');
  assert.ok(calls.includes('chargerParametresGooglePlanning'));
  assert.equal(element('settings-aidant-consents').hidden, true);
});

test('key contacts, daily journal and family album stack their icons above the labels', () => {
  for (const [id, label, icon] of [
    ['senior-key-contacts-details', 'Contacts utiles', '🧑‍⚕️'],
    ['aidant-key-contacts-details', 'Contacts utiles', '🧑‍⚕️'],
    ['senior-album-details', 'Album familial', '📷'],
    ['senior-journal-details', 'Journal du quotidien', '📰'],
    ['aidant-album-details', 'Album familial', '📷'],
    ['aidant-journal-details', 'Journal du quotidien', '📰']
  ]) {
    const details = source.indexOf(`id="${id}"`);
    const summaryStart = source.indexOf('<summary>', details);
    const summaryEnd = source.indexOf('</summary>', summaryStart);
    assert.ok(details >= 0 && summaryStart > details && summaryEnd > summaryStart);
    const summary = source.slice(summaryStart, summaryEnd);
    assert.match(summary, new RegExp(`<span class="tile-icon" aria-hidden="true"[^>]*>${icon}</span><span>${label}</span>`));
  }
  assert.match(source, /#aidant-senior-content > \.form-card > \.senior-disclosure:not\(\.senior-explanation\) > summary \{[\s\S]*?flex-direction: column/);
  assert.match(source, /#main-app-senior \.senior-disclosure:not\(\.senior-explanation\) > summary,[\s\S]*?flex-direction: column/);
  assert.match(source, /\.senior-mode \.senior-tab-disclosure > summary \{[\s\S]*?flex-direction: column/);
  assert.match(source, /\.senior-mode #senior-album-details > summary,[\s\S]*?min-height: 132px;[\s\S]*?justify-content: center/);
});

test('aidant shortcuts pair notifications and agenda without duplicate controls', () => {
  const aidant = source.slice(source.indexOf('<div id="screen-aidant"'), source.indexOf('<!-- 🩺 3.'));
  const shortcuts = aidant.match(/<div id="aidant-shortcuts"[\s\S]*?<\/div>/);
  assert.ok(shortcuts);
  assert.match(shortcuts[0], /onclick="ouvrirNotifications\(\)"/);
  assert.match(shortcuts[0], /onclick="ouvrirAgenda\(\)"/);
  assert.equal((aidant.match(/onclick="ouvrirAgenda\(\)"/g) || []).length, 1);
});

test('changing the accompanied person is clearly labelled in settings only', () => {
  const aidant = source.slice(source.indexOf('<div id="screen-aidant"'), source.indexOf('<!-- 🩺 3.'));
  const settings = source.slice(source.indexOf('<div id="screen-settings"'), source.indexOf('<div id="screen-agenda"'));
  assert.doesNotMatch(aidant, /id="aidant-senior-select"/);
  assert.match(settings, /<label for="aidant-senior-select">Changer de personne accompagnée<\/label>\s*<select id="aidant-senior-select"/);
  for (const id of ['agenda-change-senior', 'directory-change-senior']) {
    assert.doesNotMatch(source, new RegExp(`id="${id}"`));
  }
});

test('agenda and directory still show the selected accompanied person', async () => {
  const { context, element } = createView({ seniors: [{ id: 'senior-1', name: 'Jeanne' }] });
  await context.openView({ id: 'aidant', role: 'aidant' });
  for (const screen of ['agenda', 'directory']) {
    context.openScreen(screen);
    assert.equal(element(`${screen}-senior-context`).textContent, 'Personne accompagnée : Jeanne');
    assert.equal(element(`${screen}-senior-context`).hidden, false);
  }
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
  assert.equal(element('aidant-home-links').hidden, true);
  assert.match(element('aidant-senior-status').textContent, /Impossible de charger/);
});

test('an aidant with a linked senior still opens the selected senior workspace', async () => {
  const { context, element, calls } = createView({ seniors: [{ id: 'senior-1', name: 'Profil lié' }] });
  await context.openView({ id: 'aidant', role: 'aidant', seniorName: 'Ancien profil' });
  assert.equal(element('aidant-home-links').hidden, true);
  assert.equal(element('aidant-no-senior-panel').style.display, 'none');
  assert.equal(element('aidant-senior-content').style.display, 'grid');
  assert.equal(element('aidant-daily-summary').hidden, false);
  assert.equal(element('senior-name-aidant').textContent, 'Profil lié');
  assert.ok(calls.includes('chargerLogs'));
});

test('daily information and weather are open at the start of each home', () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const home = source.indexOf(`<div id="screen-${role}"`);
    const info = source.indexOf(`id="home-informations-${role}"`, home);
    const inbox = source.indexOf(`id="${role}-today-inbox"`, info);
    assert.ok(home >= 0 && info > home && inbox > info);
    assert.match(source.slice(info, inbox), /<h2>Mes informations du jour<\/h2>/);
    assert.doesNotMatch(source.slice(info, inbox), /Réglages|Se déconnecter/);
    assert.doesNotMatch(source, new RegExp(`onclick="switchScreen\\('informations-${role}'\\)"`));
    if (role !== 'pro') {
      const weather = source.indexOf(`id="${role}-weather-card"`, info);
      assert.ok(weather > info && weather < inbox);
    }
  }
  const start = source.indexOf('<div id="screen-aidant"');
  const summary = source.indexOf('id="aidant-daily-summary"', start);
  assert.match(source.slice(summary, source.indexOf('>', summary)), /\bhidden\b/);
});

test('legacy daily information links open only the current role home', async () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const { context, element, calls } = createView({ seniors: [{ id: 'senior-1', name: 'Profil lié' }] });
    await context.openView({ id: role, role, verificationStatus: 'approved' });
    calls.length = 0;
    context.openScreen(`informations-${role}`);
    assert.ok(element(`screen-${role}`).classList.contains('active'));
    assert.ok(calls.includes({ senior: 'chargerProchainRendezVous', aidant: 'chargerSyntheseAidant', pro: 'chargerSynthesePro' }[role]));
    context.openScreen(`informations-${role === 'senior' ? 'pro' : 'senior'}`);
    assert.ok(element(`screen-${role}`).classList.contains('active'));
    context.openScreen(role);
    assert.ok(element(`screen-${role}`).classList.contains('active'));
  }
});

test('today shows received messages without a separate unread counter', () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const start = source.indexOf(`<div id="home-informations-${role}"`);
    const end = source.indexOf(role === 'senior' ? '<section class="form-card" id="senior-home-links"' : role === 'aidant'
      ? '<section class="form-card" id="aidant-home-links"' : '<section class="form-card" id="pro-workspace-information"', start);
    assert.ok(start >= 0 && end > start);
    const screen = source.slice(start, end);
    assert.match(screen, new RegExp(`id="${role}-today-inbox"`));
    assert.doesNotMatch(screen, /Messages non lus|id="(?:senior-today|aidant-summary|pro-summary)-messages"/);
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
    assert.ok((home.match(/onclick="ouvrirNotifications\(\)"/g) || []).length >= (role === 'senior' ? 2 : 1));
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
  assert.equal(element('settings-simple-display').style.display, 'block');
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
  assert.equal(element('settings-simple-display').style.display, 'block');
  context.openAgenda();
  assert.equal(element('nav-agenda').classList.contains('active'), false);
  context.openScreen('messages');
  assert.equal(element('screen-messages').classList.contains('active'), false);
  assert.equal(calls.includes('chargerPlanningPro'), false);
  context.openScreen('pro');
  assert.ok(element('screen-pro').classList.contains('active'));
});

test('professional verification panel disappears after approval', async () => {
  const { context, element } = createView({ seniors: [] });
  await context.openView({ id: 'pro', role: 'pro', verificationStatus: 'pending' });
  assert.equal(element('professional-verification-panel').style.display, 'block');
  await context.openView({ id: 'pro', role: 'pro', verificationStatus: 'approved' });
  assert.equal(element('professional-verification-panel').style.display, 'none');
  assert.equal(element('professional-workspace').style.display, 'block');
});
