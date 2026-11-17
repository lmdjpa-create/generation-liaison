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

function voiceTestContext() {
  const elements = {};
  const element = id => elements[id] ||= {
    value: '', textContent: '', hidden: false, disabled: false, maxLength: 2000, style: {},
    handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, focus() {}
  };
  const context = {
    document: { getElementById: element },
    window: { generationLiaisonTranslate: value => value, generationLiaisonLocale: () => 'fr-FR' },
    connectedUser: { id: 'senior', role: 'senior' },
    messageDictation: null, messageRewriteRevision: 0, messageRewriteOriginal: '',
    console, clearTimeout, setTimeout
  };
  element('message-contact-senior').value = 'contact';
  vm.runInNewContext(extract('    function annulerDicteeMessage()', '    function rafraichirConversationVisible()'), context);
  return { context, element };
}

test('message dictation handles unsupported devices, microphone errors and stale results', () => {
  const { context, element } = voiceTestContext();
  context.dicterMessageSenior();
  assert.match(element('message-dictation-status').textContent, /pas disponible/);
  let recognition;
  context.window.SpeechRecognition = function() {
    recognition = this;
    this.start = () => {};
    this.stop = () => {};
    this.abort = () => {};
  };
  context.dicterMessageSenior();
  recognition.onerror({ error: 'not-allowed' });
  recognition.onend();
  assert.match(element('message-dictation-status').textContent, /refusé/);
  element('message-text-senior').value = 'a'.repeat(1999);
  context.dicterMessageSenior();
  recognition.onresult({ resultIndex: 0, results: [[{ transcript: 'bonjour' }]] });
  assert.equal(element('message-text-senior').value.length, 2000);
  assert.match(element('message-dictation-status').textContent, /coupée/);
  context.annulerDicteeMessage();
  element('message-text-senior').value = 'original';
  recognition.onresult({ resultIndex: 0, results: [[{ transcript: 'tardif' }]] });
  assert.equal(element('message-text-senior').value, 'original');
});

test('AI message suggestion requires confirmation and only applies after an explicit choice', async () => {
  const { context, element } = voiceTestContext();
  let calls = 0;
  let resolve;
  context.seniorLinksRequest = async () => {
    calls++;
    return new Promise(done => { resolve = done; });
  };
  context.window.confirm = () => false;
  element('message-text-senior').value = 'Bonjour';
  await context.proposerReformulationMessage();
  assert.equal(calls, 0);
  context.window.confirm = () => true;
  const pending = context.proposerReformulationMessage();
  element('message-text-senior').value = 'Modifié';
  resolve({ suggestion: 'Proposition périmée' });
  await pending;
  assert.equal(element('message-rewrite-result').hidden, true);
  const next = context.proposerReformulationMessage();
  resolve({ suggestion: 'Bonjour, comment allez-vous ?' });
  await next;
  assert.equal(element('message-text-senior').value, 'Modifié');
  assert.equal(element('message-rewrite-result').hidden, false);
  context.configurerDicteeMessagerie();
  element('message-rewrite-apply').handlers.click();
  assert.equal(element('message-text-senior').value, 'Bonjour, comment allez-vous ?');
  assert.equal(element('message-rewrite-result').hidden, true);
});

test('screen reader defaults on, persists settings and reads only visible text', () => {
  const { context, element } = voiceTestContext();
  const values = new Map();
  const voice = { name: 'Claire', lang: 'fr-FR', voiceURI: 'claire' };
  const spoken = [];
  const screen = { id: 'screen-messages', querySelectorAll: () => [root] };
  const root = { tagName: 'DIV', parentElement: null, hidden: false, getAttribute: () => null };
  const visible = { tagName: 'P', parentElement: root, hidden: false, getAttribute: () => null };
  const hidden = { tagName: 'P', parentElement: root, hidden: true, getAttribute: () => null };
  let nodes = [{ nodeValue: 'Bonjour', parentElement: visible }, { nodeValue: 'Secret caché', parentElement: hidden }];
  const timers = [];
  Object.assign(context, {
    seniorVoiceUserId: '', seniorVoiceTimer: null, seniorVoiceLastText: '',
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    NodeFilter: { SHOW_TEXT: 4 },
    Option: function(text, value) { this.text = text; this.value = value; },
    SpeechSynthesisUtterance: function(text) { this.text = text; },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout: () => {}
  });
  const select = element('senior-voice-choice');
  select.replaceChildren = () => {};
  select.add = () => {};
  context.window.SpeechSynthesisUtterance = context.SpeechSynthesisUtterance;
  context.window.speechSynthesis = {
    getVoices: () => [voice], cancel() {}, speak: utterance => spoken.push(utterance), addEventListener() {}
  };
  context.window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  context.document.hidden = false;
  context.document.querySelector = () => screen;
  context.document.createTreeWalker = () => {
    let index = 0;
    return { nextNode: () => nodes[index++] || null };
  };
  context.initialiserLectureSenior();
  assert.equal(element('senior-voice-enabled').checked, true);
  values.set('generation-liaison-voice-senior-voice', 'claire');
  assert.equal(context.texteVisibleLectureSenior(root), 'Bonjour');
  context.texteVisibleLectureSenior = () => 'Bonjour';
  context.planifierLectureSenior();
  timers.pop()();
  assert.equal(spoken[0].text, 'Bonjour');
  assert.equal(spoken[0].voice, voice);
  context.document.hidden = true;
  context.planifierLectureSenior();
  assert.equal(spoken.length, 1);
  values.set('generation-liaison-voice-senior-enabled', 'false');
  context.initialiserLectureSenior();
  assert.equal(element('senior-voice-enabled').checked, false);
});

test('automatic senior narration selects only the requested categories on each screen', () => {
  const { context, element } = voiceTestContext();
  const spoken = [];
  const timers = [];
  const screens = {
    'screen-senior': {
      'date-senior': 'Lundi',
      'senior-weather-status': 'Soleil',
      'senior-next-visit-text': 'Visite demain',
      'assistant-messages': 'Conversation privée',
      'wellbeing-checkin-result': 'Bilan'
    },
    'screen-messages': {
      'notifications-senior': 'Notification',
      'message-list-senior': 'Message',
      'message-rewrite-text': 'Brouillon'
    },
    'screen-agenda': { 'calendar-selected-day': 'Rendez-vous', 'personal-event-card': 'Formulaire' },
    'screen-senior-pro': { 'senior-summary-visit': 'Visite', 'senior-summary-tasks': 'Tâches' },
    'screen-contacts': { contacts: 'Contact' }
  };
  let active = 'screen-senior';
  Object.assign(context, {
    seniorVoiceUserId: 'senior', seniorVoiceTimer: null, seniorVoiceLastText: '',
    localStorage: { getItem: () => null },
    SpeechSynthesisUtterance: function(text) { this.text = text; },
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout: () => {}
  });
  context.window.SpeechSynthesisUtterance = context.SpeechSynthesisUtterance;
  context.window.speechSynthesis = {
    getVoices: () => [], cancel() {}, speak: utterance => spoken.push(utterance.text)
  };
  context.document.hidden = false;
  context.document.querySelector = () => ({
    id: active,
    querySelectorAll: selector => selector.split(', ').map(id => screens[active][id.slice(1)])
      .filter(Boolean).map(text => ({ text }))
  });
  context.texteVisibleLectureSenior = root => root.text;
  element('senior-voice-enabled').checked = true;
  for (const id of Object.keys(screens)) {
    active = id;
    context.planifierLectureSenior();
    timers.pop()();
  }
  assert.deepEqual(spoken, [
    'Lundi. Soleil. Visite demain',
    'Notification. Message',
    'Rendez-vous',
    'Visite'
  ]);
});

test('automatic narration skips hidden ancestors and button labels', () => {
  const { context } = voiceTestContext();
  const root = { tagName: 'DIV', hidden: false, parentElement: null, getAttribute: () => null };
  const hiddenParent = { tagName: 'SECTION', hidden: true, parentElement: root, getAttribute: () => null };
  const innerRoot = { tagName: 'DIV', hidden: false, parentElement: hiddenParent, getAttribute: () => null };
  const button = { tagName: 'BUTTON', hidden: false, parentElement: root, getAttribute: () => null };
  const visible = { tagName: 'P', hidden: false, parentElement: root, getAttribute: () => null };
  const nodes = [
    { nodeValue: 'Information', parentElement: visible },
    { nodeValue: 'Bouton', parentElement: button },
    { nodeValue: 'Contenu caché', parentElement: innerRoot }
  ];
  context.NodeFilter = { SHOW_TEXT: 4 };
  context.window.getComputedStyle = () => ({ display: 'block', visibility: 'visible' });
  context.document.createTreeWalker = selectedRoot => {
    let index = 0;
    const selectedNodes = selectedRoot === innerRoot ? [nodes[2]] : nodes;
    return { nextNode: () => selectedNodes[index++] || null };
  };
  assert.equal(context.texteVisibleLectureSenior(root), 'Information');
  assert.equal(context.texteVisibleLectureSenior(innerRoot), '');
});

test('message contacts show availability per contact rather than a premium requirement', async () => {
  const select = {
    value: '', options: [],
    replaceChildren(option) { this.options = [option]; },
    add(option) { this.options.push(option); }
  };
  const status = { textContent: '' };
  const list = { children: [], replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); } };
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    document: {
      getElementById: id => id.startsWith('message-contact-') ? select : id === 'message-multiple-contacts' ? list : status,
      createElement: () => ({ append(...items) { this.children = items; } }),
      createTextNode: text => ({ textContent: text })
    },
    Option: function(text, value) { this.text = text; this.value = value; },
    seniorLinksRequest: async () => ({
      premium: false, contacts: [
        { id: 'aidant', name: 'Aidant', premium: false, canSend: true },
        { id: 'autre', name: 'Autre', premium: true, canSend: false }
      ]
    })
  };
  vm.runInNewContext(
    `${extract('    async function chargerCorrespondants(role)', '    async function ouvrirConversation(')}\n` +
    'globalThis.loadContacts = chargerCorrespondants;', context
  );
  assert.equal(await context.loadContacts('senior'), true);
  assert.equal(select.options[1].text, 'Aidant');
  assert.match(select.options[2].text, /envoi indisponible/);
  assert.equal(list.children[0].children[0].disabled, false);
  assert.equal(list.children[2].children[0].disabled, true);
  assert.equal(status.textContent, '');
});

test('multiple message delivery confirms selected recipients and keeps the draft on failure', async () => {
  const chosen = [
    { value: 'a', checked: true, parentElement: { textContent: 'Alice' } },
    { value: 'b', checked: true, parentElement: { textContent: 'Bruno' } }
  ];
  const nodes = {
    'message-contact-senior': { value: '' },
    'message-text-senior': { value: 'Bonjour' },
    'message-status-senior': { textContent: '' }
  };
  let confirmed = false;
  let calls = [];
  let fails = false;
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    document: {
      getElementById: id => nodes[id],
      querySelectorAll: () => chosen.filter(item => item.checked),
      querySelector: () => ({ disabled: false })
    },
    window: { confirm: () => confirmed },
    annulerDicteeMessage() {}, annulerPropositionMessage() {},
    ouvrirConversation: async () => {},
    seniorLinksRequest: async (url, options) => {
      calls.push({ url, options });
      if (fails) throw new Error('Envoi impossible');
    }
  };
  vm.runInNewContext(extract('    async function envoyerMessage(role)', '    async function repondreInvitation('), context);
  await context.envoyerMessage('senior');
  assert.equal(calls.length, 0);
  confirmed = true;
  fails = true;
  await context.envoyerMessage('senior');
  assert.equal(nodes['message-text-senior'].value, 'Bonjour');
  assert.ok(chosen.every(item => item.checked));
  fails = false;
  await context.envoyerMessage('senior');
  assert.equal(calls[1].url, '/api/messages/multiple');
  assert.deepEqual(Array.from(calls[1].options.body.recipients), ['a', 'b']);
  assert.equal(nodes['message-text-senior'].value, '');
  assert.ok(chosen.every(item => !item.checked));
});

test('the optional color game can be played locally without sending data', () => {
  const elements = {
    'color-game-question': { textContent: '' }, 'color-game-status': { textContent: '' }
  };
  const context = {
    document: { getElementById: id => elements[id] },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);
  context.repondreJeuCouleur('Vert');
  assert.match(elements['color-game-status'].textContent, /réessayer/);
  context.repondreJeuCouleur('Rouge');
  assert.match(elements['color-game-status'].textContent, /Bravo/);
  context.nouvelleCouleur();
  assert.match(elements['color-game-question'].textContent, /Bleu/);
});

test('senior settings remain accessible from navigation without a dashboard shortcut', () => {
  const dashboard = extract('<div id="main-app-senior"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  assert.doesNotMatch(dashboard, /switchScreen\('settings'\)/);
  assert.match(source, /<button id="nav-settings"[^>]*onclick="switchScreen\('settings'\)"/);
});

test('next appointment displays Paris time, handles empty and failed loads, and ignores stale responses', async () => {
  const text = { textContent: '' };
  let response = { events: [{ title: 'Médecin', scheduledAt: '2026-03-29T08:30:00Z' }] };
  let resolveRequest;
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    nextVisitLoadId: 0, nextVisitEvent: null, nextVisitMessage: '',
    document: { getElementById: () => text },
    window: { generationLiaisonTranslate: value => value, generationLiaisonLocale: () => 'fr-FR' },
    planningRequest: async path => {
      assert.equal(path, '/api/planning/calendar?next=1');
      if (response instanceof Error) throw response;
      if (response === null) return new Promise(resolve => { resolveRequest = resolve; });
      return response;
    },
    console: { error() {} }, Intl, Date
  };
  vm.runInNewContext(
    `${extract('    function afficherProchainRendezVous()', '    function renderCalendar()')}\n` +
    'globalThis.loadNext = chargerProchainRendezVous;', context
  );
  await context.loadNext();
  assert.match(text.textContent, /29 mars 2026/);
  assert.match(text.textContent, /10:30.*Médecin/);
  response = { events: [] };
  await context.loadNext();
  assert.equal(text.textContent, 'Aucun rendez-vous à venir.');
  response = new Error('offline');
  await context.loadNext();
  assert.equal(text.textContent, 'Impossible de charger le prochain rendez-vous.');
  response = null;
  const old = context.loadNext();
  context.connectedUser = null;
  resolveRequest({ events: [{ title: 'Ancien compte', scheduledAt: '2026-03-29T08:30:00Z' }] });
  await old;
  assert.equal(text.textContent, 'Impossible de charger le prochain rendez-vous.');
});

test('companionship and daily services have one control each on the senior home', () => {
  const tiles = extract('<div id="screen-more"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  const dashboard = extract('<div id="main-app-senior"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  assert.doesNotMatch(tiles, /ouvrirSectionSenior/);
  for (const label of ['Un peu de compagnie', 'Services du quotidien']) {
    assert.equal(dashboard.split(label).length - 1, 1, label);
  }
  assert.match(dashboard, /<summary><span class="tile-icon"[^>]*>🤝<\/span>Un peu de compagnie<\/summary>/);
  assert.match(dashboard, /<summary><span class="tile-icon"[^>]*>🏠<\/span>Services du quotidien<\/summary>/);
  assert.match(tiles, /switchScreen\('directory'\)/);
  assert.doesNotMatch(tiles, /Mon agenda/);
  assert.doesNotMatch(dashboard, /Voir l’agenda/);
});

test('senior feature sections keep their content collapsed and can open programmatically', () => {
  for (const [id, content] of [
    ['senior-following-details', 'senior-live-following'],
    ['senior-note-details', 'senior-person-note-form'],
    ['senior-assistant-details', 'assistant-chat-form'],
    ['senior-services-details', 'senior-service-area']
  ]) {
    const start = source.indexOf(`<details class="senior-disclosure" id="${id}">`);
    const end = source.indexOf(`id="${content}"`, start);
    assert.ok(start >= 0 && end > start, `${id} must contain ${content}`);
    assert.match(source.slice(start, end), /<summary><span class="tile-icon"/);
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { open: false, scrollIntoView() { this.scrolled = true; } });
    return elements.get(id);
  };
  const context = { document: { getElementById: element } };
  vm.runInNewContext(
    `${extract('    function ouvrirSectionSenior(detailsId, targetId)', '    function switchScreen(screenName)')}\n` +
    'globalThis.openSection = ouvrirSectionSenior;', context
  );
  assert.match(source, /<summary><span class="tile-icon"[^>]*>💬<\/span>Envoyer à l’équipe<\/summary>/);
  for (const [details, target] of [
    ['senior-services-details', 'senior-service-area'],
    ['senior-assistant-details', 'assistant-chat-panel']
  ]) {
    context.openSection(details, target);
    assert.equal(element(details).open, true);
    assert.equal(element(target).scrolled, true);
  }
});

test('companionship, wellbeing, video call, meal delivery and emergency lead the senior home', () => {
  const dashboard = extract('<div id="main-app-senior"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  const order = ['id="senior-weather-card"', 'id="senior-next-visit"', 'id="senior-assistant-details"',
    'id="wellbeing-checkin-details"', 'onclick="declencherVisio()"', 'Livraison de repas',
    'class="form-card emergency-call-card"', 'id="senior-more-button"'].map(item => dashboard.indexOf(item));
  assert.ok(order.every((position, index) => position >= 0 && (index === 0 || order[index - 1] < position)));
  assert.equal(dashboard.split('id="senior-assistant-details"').length - 1, 1);
  assert.equal(dashboard.split('id="wellbeing-checkin-details"').length - 1, 1);
});

test('sharing consent management is removed from the senior home but available in settings', () => {
  const dashboard = extract('<div id="main-app-senior"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  const settings = extract('<div id="screen-settings"', '<div id="screen-agenda"');
  assert.doesNotMatch(dashboard, /senior-sharing-consents|senior-consents-details/);
  assert.match(settings, /<details class="senior-tab-disclosure" id="senior-consents-details">[\s\S]*?id="senior-sharing-consents"/);
});

test('senior tabs offer collapsed controls without hiding results or the calendar', () => {
  const agenda = extract('<div id="screen-agenda"', '<div id="screen-directory"');
  const directory = extract('<div id="screen-directory"', '<div id="screen-contacts"');
  const contacts = extract('<div id="screen-contacts"', '<div id="screen-video-call"');
  assert.match(agenda, /<details class="senior-tab-disclosure">[\s\S]*?id="personal-event-form"/);
  assert.match(agenda, /id="calendar-grid"/);
  assert.match(directory, /<details class="senior-tab-disclosure">[\s\S]*?id="directory-search-form"[\s\S]*?<\/details>[\s\S]*?id="directory-results"/);
  assert.match(contacts, /<details class="senior-tab-disclosure">[\s\S]*?id="add-app-contact-form"[\s\S]*?<\/details>[\s\S]*?id="contacts-list"/);
});

test('agenda shows the selected day before collapsed explanations and retains Google controls', () => {
  const agenda = extract('<div id="screen-agenda"', '<div id="screen-directory"');
  assert.match(agenda, /id="calendar-day"[^>]*aria-pressed="true"/);
  assert.ok(agenda.indexOf('id="calendar-selected-day"') < agenda.indexOf('Explications sur l’agenda'));
  assert.ok(agenda.indexOf('id="calendar-selected-day"') < agenda.indexOf('id="calendar-google-settings"'));
  assert.match(agenda, /<details class="senior-disclosure senior-explanation" data-help-for="#calendar-today">\s*<summary>Explications sur l’agenda<\/summary>[\s\S]*?chevauche/);
  assert.match(agenda, /<summary>Explications<\/summary>[\s\S]*?la mise en pause ne supprime pas/i);
  assert.match(agenda, /id="calendar-google-sync-toggle"/);
  assert.match(agenda, /id="calendar-google-requests"/);
});

test('day view displays only the selected day and preserves week and month views', () => {
  const elements = new Map();
  const node = () => ({
    children: [], attrs: {}, hidden: false, classList: { add() {} },
    replaceChildren(...items) { this.children = items; },
    append(...items) { this.children.push(...items); },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener() {}
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  const context = {
    calendarDate: '2026-03-29',
    calendarView: 'day',
    calendarEvents: [
      { kind: 'personal', id: 'personal', title: 'Médecin', scheduledAt: '2026-03-29T08:00:00Z', durationMinutes: 30 },
      { kind: 'directory', title: 'En attente', status: 'pending', scheduledAt: '2026-03-29T10:00:00Z', durationMinutes: 30 },
      { kind: 'visit', title: 'Autre jour', scheduledAt: '2026-03-28T22:30:00Z', durationMinutes: 30 }
    ],
    connectedUser: { role: 'senior' },
    window: { generationLiaisonTranslate: text => text },
    document: { getElementById: element, createElement: node },
    makeTextElement: (tag, text, className) => ({ tag, textContent: text, className }),
    Date, Intl
  };
  vm.runInNewContext(
    `${extract('    function dateInputValue(date)', '    async function chargerPartagesAgenda()')}\n` +
    'globalThis.render = renderCalendar; globalThis.setView = definirVueCalendrier;', context
  );
  context.setView('day');
  context.render();
  assert.equal(element('calendar-scroll').hidden, true);
  assert.equal(element('calendar-week-summary').hidden, true);
  assert.match(element('calendar-title').textContent, /29 mars 2026/);
  const details = element('calendar-selected-day').children;
  assert.equal(details.filter(item => item.tag === 'p').length, 2);
  assert.ok(details.some(item => item.textContent?.includes('Médecin')));
  assert.ok(details.some(item => item.textContent?.includes('en attente')));
  assert.ok(details.some(item => item.textContent === 'Supprimer ce rendez-vous'));
  assert.ok(details.every(item => !item.textContent?.includes('Autre jour')));
  assert.equal(element('calendar-day').attrs['aria-pressed'], 'true');
  context.calendarEvents = [];
  context.render();
  assert.ok(element('calendar-selected-day').children.some(item => item.textContent === 'Aucun rendez-vous pour cette date.'));
  context.setView('week');
  context.render();
  assert.equal(element('calendar-scroll').hidden, false);
  assert.equal(element('calendar-grid').children.length, 14);
  assert.equal(element('calendar-week').attrs['aria-pressed'], 'true');
  assert.equal(element('calendar-week-summary').hidden, false);
  assert.ok(element('calendar-week-summary-content').children.some(item =>
    item.textContent === 'Aucun rendez-vous pour cette semaine.'));
  context.setView('month');
  context.render();
  assert.equal(element('calendar-week-summary').hidden, true);
  assert.equal(element('calendar-month').attrs['aria-pressed'], 'true');
  assert.ok(element('calendar-grid').children.length > 14);
});

test('weekly summary orders authorized events by Paris day and time', () => {
  const elements = new Map();
  const node = () => ({
    children: [], attrs: {}, hidden: false, classList: { add() {} },
    replaceChildren(...items) { this.children = items; },
    append(...items) { this.children.push(...items); },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener() {}
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  const context = {
    calendarDate: '2026-03-29', calendarView: 'week',
    calendarEvents: [
      { kind: 'visit', title: 'Dernier', scheduledAt: '2026-03-29T10:00:00Z', durationMinutes: 30 },
      { kind: 'directory', title: 'À confirmer', status: 'pending', scheduledAt: '2026-03-29T08:00:00Z', durationMinutes: 30 },
      { kind: 'personal', title: 'Minuit', scheduledAt: '2026-03-28T23:30:00Z', durationMinutes: 60 },
      { kind: 'visit', title: 'Hors semaine', scheduledAt: '2026-03-29T22:00:00Z', durationMinutes: 30 }
    ],
    connectedUser: { role: 'senior' },
    window: { generationLiaisonTranslate: text => text },
    document: { getElementById: element, createElement: node },
    makeTextElement: (tag, text, className) => ({ tag, textContent: text, className }),
    Date, Intl
  };
  vm.runInNewContext(
    `${extract('    function dateInputValue(date)', '    async function chargerPartagesAgenda()')}\n` +
    'globalThis.render = renderCalendar;', context
  );
  context.render();
  const children = element('calendar-week-summary-content').children;
  assert.equal(element('calendar-week-summary').hidden, false);
  assert.equal(children.length, 4);
  assert.match(children[0].textContent, /dimanche 29 mars/);
  assert.match(children[1].textContent, /00:30.*Minuit/);
  assert.match(children[2].textContent, /10:00.*À confirmer.*en attente/);
  assert.match(children[3].textContent, /12:00.*Dernier/);
  assert.ok(children.every(item => !item.textContent?.includes('Hors semaine')));
});

test('weekly summary is cleared while the agenda reloads and remains hidden on failure', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, textContent: '', children: ['Ancien rendez-vous'],
      replaceChildren() { this.children = []; }
    });
    return elements.get(id);
  };
  let rejectRequest;
  const context = {
    connectedUser: { id: 'senior' }, calendarDate: '2026-12-31',
    calendarView: 'week', calendarLoadId: 0,
    document: { getElementById: element },
    planningRequest: () => new Promise((resolve, reject) => { rejectRequest = reject; }),
    Date
  };
  vm.runInNewContext(
    `${extract('    function dateInputValue(date)', '    function dateTimeInputValue(date)')}\n` +
    `${extract('    function calendarBounds()', '    function calendarEventDate(value)')}\n` +
    `${extract('    async function chargerCalendrier()', '    async function chargerModificationsGoogle()')}\n` +
    'globalThis.loadCalendar = chargerCalendrier;', context
  );
  const loading = context.loadCalendar();
  assert.equal(element('calendar-week-summary').hidden, true);
  assert.deepEqual(element('calendar-week-summary-content').children, []);
  rejectRequest(new Error('Connexion indisponible'));
  await loading;
  assert.equal(element('calendar-week-summary').hidden, true);
  assert.equal(element('calendar-message').textContent, 'Connexion indisponible');
});

test('calendar arrows move by day, week or month across date boundaries', () => {
  const context = { calendarDate: '2026-12-31', calendarView: 'day', chargerCalendrier() {}, Date };
  vm.runInNewContext(
    `${extract('    function dateInputValue(date)', '    function dateTimeInputValue(date)')}\n` +
    `${extract('    function decalerCalendrier(offset)', '    function updatePlanningDateTitle()')}\n` +
    'globalThis.move = decalerCalendrier;', context
  );
  context.move(1);
  assert.equal(context.calendarDate, '2027-01-01');
  context.calendarView = 'week';
  context.move(-1);
  assert.equal(context.calendarDate, '2026-12-25');
  context.calendarView = 'month';
  context.calendarDate = '2026-01-31';
  context.move(1);
  assert.equal(context.calendarDate, '2026-02-28');
});

test('a new day re-enables the senior check-in form', () => {
  const elements = {
    'wellbeing-checkin-form': { hidden: true },
    'wellbeing-checkin-submit': { disabled: true },
    'wellbeing-checkin-result': { hidden: false, replaceChildren() {} },
    'wellbeing-safety-result': { replaceChildren() {} }
  };
  const context = {
    document: { getElementById: id => elements[id] },
    wellbeingSafetyTimer: null
  };
  vm.runInNewContext(
    `${extract('    function afficherCheckinBienEtre(checkin)', '    function afficherSuiviSecuriteBienEtre')}\n` +
    'globalThis.showCheckin = afficherCheckinBienEtre;', context
  );
  context.showCheckin(null);
  assert.equal(elements['wellbeing-checkin-form'].hidden, false);
  assert.equal(elements['wellbeing-checkin-submit'].disabled, false);
  assert.equal(elements['wellbeing-checkin-result'].hidden, true);
});

test('check-in is collapsed while safety follow-up remains outside the collapsed content', () => {
  const checkin = extract('        <section class="form-card" id="wellbeing-checkin-panel"',
    '        <section class="form-card emergency-call-card"');
  assert.match(checkin, /<details class="senior-disclosure" id="wellbeing-checkin-details">/);
  assert.match(checkin, /<\/details>\s*<div id="wellbeing-safety-result"/);
});

test('safety follow-up is rendered separately from the collapsed check-in', () => {
  const nodes = () => ({ children: [], replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); }, setAttribute() {}, addEventListener() {} });
  const elements = {
    'wellbeing-checkin-form': { hidden: false },
    'wellbeing-checkin-submit': { disabled: false },
    'wellbeing-checkin-result': nodes(),
    'wellbeing-safety-result': nodes()
  };
  const checkin = { safetyConcern: true, safetyCheckStatus: 'awaiting_response', response: 'Bonjour', assistantReply: 'Bonjour' };
  const context = {
    document: { getElementById: id => elements[id], createElement: nodes },
    wellbeingSafetyTimer: null,
    makeTextElement: nodes,
    afficherSuiviSecuriteBienEtre: (container, value) => container.append(value)
  };
  vm.runInNewContext(
    `${extract('    function afficherCheckinBienEtre(checkin)', '    function afficherSuiviSecuriteBienEtre')}\n` +
    'globalThis.showCheckin = afficherCheckinBienEtre;', context
  );
  context.showCheckin(checkin);
  assert.equal(elements['wellbeing-checkin-form'].hidden, true);
  assert.equal(elements['wellbeing-safety-result'].children[0], checkin);
  assert.equal(elements['wellbeing-checkin-result'].children.includes(checkin), false);
  context.showCheckin(null);
  assert.equal(elements['wellbeing-safety-result'].children.length, 0);
});

test('safety actions remain visible outside the closed check-in and retain the response timer', () => {
  const node = () => ({
    children: [], replaceChildren() { this.children = []; },
    append(...items) { this.children.push(...items); },
    setAttribute() {}, addEventListener() {}
  });
  const elements = {
    'wellbeing-checkin-form': { hidden: false },
    'wellbeing-checkin-submit': { disabled: false },
    'wellbeing-checkin-result': node(),
    'wellbeing-safety-result': node()
  };
  let timeout;
  const context = {
    document: { getElementById: id => elements[id], createElement: node },
    window: { setTimeout: (callback, delay) => { timeout = { callback, delay }; return 1; }, clearTimeout() {} },
    wellbeingSafetyTimer: null,
    makeTextElement: (tag, text) => ({ ...node(), textContent: text }),
    enregistrerReponseSecurite: (id, response) => { context.response = { id, response }; }
  };
  vm.runInNewContext(
    `${extract('    function afficherCheckinBienEtre(checkin)', '    async function enregistrerReponseSecurite')}\n` +
    'globalThis.showCheckin = afficherCheckinBienEtre;', context
  );
  const checkin = { id: 'check-1', response: 'Bonjour', assistantReply: 'Bonjour', safetyConcern: true };
  context.showCheckin({ ...checkin, safetyCheckStatus: 'awaiting_response' });
  assert.equal(elements['wellbeing-safety-result'].children[0].children[2].children.length, 2);
  assert.equal(timeout.delay, 60000);
  timeout.callback();
  assert.equal(context.response.id, 'check-1');
  assert.equal(context.response.response, 'no_response');
  context.showCheckin({ ...checkin, safetyCheckStatus: 'needs_help' });
  assert.equal(elements['wellbeing-safety-result'].children[0].children[2].children.length, 2);
  context.showCheckin({ ...checkin, safetyConcern: false });
  assert.equal(elements['wellbeing-safety-result'].children.length, 0);
});

test('one senior shortcut alongside the other tiles opens the separate messages and notifications page', () => {
  const more = source.indexOf('id="screen-more"');
  const shortcut = source.indexOf('onclick="ouvrirNotifications()"');
  const tiles = extract('<div id="screen-more"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  assert.ok(shortcut > more);
  assert.match(tiles, /<button type="button" class="action-tile" onclick="ouvrirNotifications\(\)"/);
  assert.match(tiles, /id="home-notification-count-senior"/);
  const dashboard = extract('<div id="main-app-senior"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  assert.doesNotMatch(dashboard, /id="notifications-senior"|id="message-form-senior"/);
  const page = extract('<div id="screen-messages"', '<div id="screen-settings"');
  assert.match(page, /onclick="switchScreen\(connectedUser\.role\)"/);
  for (const role of ['senior', 'aidant', 'pro']) {
    assert.match(page, new RegExp(`id="notifications-${role}"`));
    assert.match(page, new RegExp(`id="message-form-${role}"`));
  }
});

test('notifications become read only when visible, keep actions, and report failures', async () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const timers = new Map();
    let timerId = 0;
    const requests = [];
    const errors = [];
    const badge = {};
    const rect = { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
    const node = tag => ({
      tag, children: [], listeners: {}, isConnected: true, rect: { ...rect },
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      addEventListener(event, callback) { this.listeners[event] = callback; },
      getBoundingClientRect() { return this.rect; },
      classList: { remove(name) { this.removed = name; } }
    });
    const container = node('div');
    const screen = { active: false, classList: { contains: () => screen.active }, getBoundingClientRect: () => rect };
    const context = {
      connectedUser: { id: 'user', role },
      notificationLoadId: 0, notificationReadEntries: [],
      document: {
        hidden: true,
        getElementById: id => id === 'notification-unread-count' || id.startsWith('home-notification-count-')
          ? badge : id === 'screen-messages' ? screen : container,
        createElement: node,
        querySelectorAll: () => container.children.filter(card => card.className?.includes('unread') && !card.classList.removed)
      },
      window: { innerWidth: 100, innerHeight: 100, handlePendingNotification() { this.opened = true; } },
      setTimeout: (callback, delay) => { assert.equal(delay, 2000); timers.set(++timerId, callback); return timerId; },
      clearTimeout: id => timers.delete(id),
      makeTextElement: (tag, text) => ({ tag, textContent: text }),
      formatDateTime: () => 'date',
      planningRequest: async (url, options) => {
        requests.push({ url, options });
        if (url === '/api/notifications') return {
          unreadCount: 2,
          notifications: [
            { id: 'message', type: 'private_message', senderUserId: 'other', title: 'Message', message: 'Bonjour', read: false },
            { id: 'invite', type: 'care_visit_invite', entityStatus: 'pending', title: 'Invitation', message: 'Rendez-vous', read: false }
          ]
        };
        if (url.endsWith('invite')) throw new Error('Lecture impossible');
      },
      showToast: message => errors.push(message),
      repondreInvitation() {}
    };
    vm.runInNewContext(
      `${extract('    function actualiserCompteurNotifications(count)', '    async function chargerCorrespondants(role)')}\n` +
      'globalThis.load = chargerNotifications; globalThis.check = surveillerNotificationsVisibles;', context
    );
    await context.load();
    assert.equal(badge.textContent, '2 non lues');
    assert.equal(timers.size, 0);
    const [message, invitation] = container.children;
    assert.equal(message.children.filter(child => child.tag === 'button').length, 0);
    assert.equal(invitation.children.find(child => child.className === 'notification-actions').children.length, 2);
    const link = message.children.find(child => child.tag === 'a');
    link.listeners.click({ preventDefault() {} });
    assert.equal(context.window.pendingPushNotificationId, 'message');
    assert.equal(context.window.opened, true);

    invitation.rect = { ...rect, top: 150, bottom: 250 };
    context.document.hidden = false;
    context.check();
    assert.equal(timers.size, 0);
    screen.active = true;
    context.check();
    assert.equal(timers.size, 1);
    const first = [...timers.values()][0];
    timers.clear();
    await first();
    assert.equal(message.children.find(child => child.textContent === 'Lu').textContent, 'Lu');
    assert.equal(badge.textContent, '1 non lue');
    assert.equal(requests.filter(item => item.options?.method === 'PATCH').length, 1);

    invitation.rect = { ...rect };
    context.check();
    const second = [...timers.values()][0];
    timers.clear();
    context.document.hidden = true;
    await second();
    assert.equal(requests.filter(item => item.options?.method === 'PATCH').length, 1);
    context.document.hidden = false;
    context.check();
    await [...timers.values()][0]();
    assert.equal(errors[0], 'Lecture impossible');
    assert.ok(invitation.children.some(child => child.textContent === 'Non lu'));
  }
});

test('read receipts refresh only for the open and visible conversation', () => {
  const calls = [];
  const select = { value: 'contact' };
  const container = {};
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    openMessageConversations: { senior: 'contact' },
    document: { getElementById: id => id === 'message-contact-senior' ? select : container },
    notificationVisible: () => context.visible,
    ouvrirConversation: role => calls.push(role),
    visible: true
  };
  vm.runInNewContext(
    `${extract('    function rafraichirConversationVisible()', '    async function envoyerMessage(role)')}\n` +
    'globalThis.refresh = rafraichirConversationVisible;', context
  );
  context.refresh();
  context.visible = false;
  context.refresh();
  context.visible = true;
  select.value = 'different';
  context.refresh();
  assert.deepEqual(calls, ['senior']);
});

test('opening a conversation marks received messages read and displays the sender receipt after refresh', async () => {
  const container = { children: [], replaceChildren() { this.children = []; }, append(item) { this.children.push(item); } };
  const select = { value: 'contact', selectedOptions: [{ text: 'Contact' }] };
  const status = {};
  const calls = [];
  let senderRead = false;
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    openMessageConversations: {},
    document: {
      getElementById: id => id === 'message-contact-senior' ? select : id === 'message-list-senior' ? container : status,
      createElement: () => ({ children: [], append(item) { this.children.push(item); } })
    },
    makeTextElement: (tag, text) => ({ tag, text }),
    formatDateTime: () => 'date',
    chargerNotifications() {},
    seniorLinksRequest: async (url, options) => {
      calls.push({ url, options });
      if (options) return {};
      return { messages: [
        { id: 'sent', mine: true, body: 'Bonjour', readAt: senderRead ? 'today' : null },
        { id: 'received', mine: false, body: 'Bonjour', readAt: null }
      ] };
    }
  };
  vm.runInNewContext(
    `${extract('    async function ouvrirConversation(role, focusId', '    function rafraichirConversationVisible()')}\n` +
    'globalThis.open = ouvrirConversation;', context
  );
  assert.equal(await context.open('senior'), true);
  assert.match(container.children[0].children[2].text, /Non lu/);
  assert.deepEqual(Array.from(calls[1].options.body.ids), ['received']);
  senderRead = true;
  assert.equal(await context.open('senior'), true);
  assert.match(container.children[0].children[2].text, /· Lu/);
});

test('device notifications can be enabled directly in each account settings', () => {
  const section = extract('<section class="form-card" id="notifications-panel-senior"', '<section class="form-card" id="notifications-panel-aidant"');
  assert.doesNotMatch(section, /enable-push-button|ouvrirNotificationsSurAppareil/);
  for (const [role, next] of [['senior', 'aidant'], ['aidant', 'pro'], ['pro', null]]) {
    const start = source.indexOf(`<section class="form-card notification-settings" id="notification-settings-${role}"`);
    const end = next ? source.indexOf(`<section class="form-card notification-settings" id="notification-settings-${next}"`, start) : source.indexOf('<section class="form-card" style="text-align:left;" id="settings-senior-links">', start);
    assert.ok(start >= 0 && end > start);
    const preferences = source.slice(start, end);
    assert.match(preferences, new RegExp(`<button[^>]*class="enable-push-button"[^>]*data-role="${role}"[^>]*disabled[^>]*>Activer les notifications sur cet appareil</button>`));
    assert.match(preferences, /l’application est fermée/);
    assert.match(preferences, /La déconnexion les désactive/);
  }
});

test('notification activation is offered only when the server is configured', async () => {
  const inputs = new Map();
  const form = { querySelector: key => {
    if (!inputs.has(key)) inputs.set(key, {});
    return inputs.get(key);
  } };
  const button = {};
  const pushStatus = {};
  const channelStatus = {};
  let configured = false;
  const context = {
    connectedUser: { role: 'senior' },
    document: { querySelector: selector => {
      if (selector.startsWith('.notification-preferences-form')) return form;
      if (selector.startsWith('.enable-push-button')) return button;
      return selector.endsWith('.push-status') ? pushStatus : channelStatus;
    } },
    window: {},
    localStorage: { getItem: () => null },
    PUSH_TOKEN_KEY: 'push',
    planningRequest: async url => url.endsWith('/preferences')
      ? { phone: '', emailEnabled: false, smsEnabled: false }
      : { channels: { email: false, sms: false, webPush: configured } }
  };
  vm.runInNewContext(
    `${extract('    async function chargerPreferencesNotification()', '    async function activerNotificationsPush(button)')}\n` +
    'globalThis.loadPreferences = chargerPreferencesNotification;', context
  );
  for (const role of ['senior', 'aidant', 'pro']) {
    context.connectedUser.role = role;
    configured = false;
    await context.loadPreferences();
    assert.equal(button.disabled, true);
    assert.match(pushStatus.textContent, /pas encore configuré/);
    configured = true;
    await context.loadPreferences();
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, 'Activer les notifications sur cet appareil');
  }
});

test('notification permission is requested once only when supported and configured', async () => {
  const stored = new Map();
  const status = {};
  const calls = [];
  const notification = { permission: 'default', requestPermission: async () => { calls.push('permission'); return 'granted'; } };
  const context = {
    connectedUser: { id: 'user-1', role: 'senior' },
    navigator: { serviceWorker: {} },
    window: { PushManager: {}, Notification: notification },
    Notification: notification,
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value)
    },
    PUSH_TOKEN_KEY: 'push',
    planningRequest: async () => ({ channels: { webPush: true } }),
    document: { querySelector: () => status },
    showToast: message => calls.push(message),
    console
  };
  vm.runInNewContext(
    `${extract('    async function demanderNotificationsAutomatiquement(user)', '    async function chargerPreferencesNotification()')}\n` +
    'globalThis.requestAutomatically = demanderNotificationsAutomatiquement;', context
  );
  await context.requestAutomatically(context.connectedUser);
  assert.equal(calls.filter(item => item === 'permission').length, 1);
  assert.match(status.textContent, /Activez les notifications dans les réglages/);
  await context.requestAutomatically(context.connectedUser);
  assert.equal(calls.filter(item => item === 'permission').length, 1);
  context.connectedUser = { id: 'user-2', role: 'aidant' };
  stored.set('pushWasDisabled', '1');
  await context.requestAutomatically(context.connectedUser);
  stored.delete('pushWasDisabled');
  notification.permission = 'denied';
  await context.requestAutomatically(context.connectedUser);
  assert.equal(calls.filter(item => item === 'permission').length, 1);
  notification.permission = 'default';
  context.planningRequest = async () => ({ channels: { webPush: false } });
  await context.requestAutomatically(context.connectedUser);
  assert.equal(calls.filter(item => item === 'permission').length, 1);
  assert.equal(stored.has('generation-liaison-push-requested-user-2'), false);
  context.planningRequest = async () => {
    context.connectedUser = null;
    return { channels: { webPush: true } };
  };
  await context.requestAutomatically({ id: 'user-2', role: 'aidant' });
  assert.equal(calls.filter(item => item === 'permission').length, 1);
});

test('automatic native permission requests respect previously refused permissions', async () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'push-client.js'), 'utf8');
  const start = client.indexOf('window.requestNativePushPermission = async');
  const end = client.indexOf('window.registerNativePush = async', start);
  assert.ok(start >= 0 && end > start);
  let state = 'denied';
  let requests = 0;
  const context = {
    window: {},
    PushNotifications: {
      checkPermissions: async () => ({ receive: state }),
      requestPermissions: async () => { requests++; return { receive: 'granted' }; }
    }
  };
  vm.runInNewContext(client.slice(start, end), context);
  assert.equal(await context.window.requestNativePushPermission(true), 'denied');
  assert.equal(requests, 0);
  state = 'prompt-with-rationale';
  assert.equal(await context.window.requestNativePushPermission(true), 'prompt-with-rationale');
  assert.equal(requests, 0);
  state = 'prompt';
  assert.equal(await context.window.requestNativePushPermission(true), 'granted');
  assert.equal(requests, 1);
});

test('emergency details are optional while numbers, confirmation and status stay accessible', () => {
  const emergency = extract('<section class="form-card emergency-call-card"', '<section class="form-card" id="notifications-panel-senior"');
  assert.match(emergency, /<details class="senior-disclosure senior-explanation" data-help-for="\[data-emergency-number\]">\s*<summary>Explications sur l’appel<\/summary>/);
  assert.match(emergency, /<button type="button" data-emergency-number="15">/);
  assert.match(emergency, /<button type="button" data-emergency-number="112">/);
  assert.match(emergency, /<\/details>\s*<div class="emergency-call-actions">\s*<button type="button" id="emergency-call-confirm-click">/);
  assert.match(emergency, /<\/div>\s*<p id="emergency-call-status"[^>]*role="status"/);
  assert.match(emergency, /Vous devrez lancer l’appel sur votre téléphone/);
});

test('emergency calls require confirmation and can be confirmed again after a completed attempt', async () => {
  const makeElement = () => ({
    hidden: true, disabled: false, textContent: '', listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; }
  });
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const numbers = ['15', '112'].map(number => ({ ...makeElement(), dataset: { emergencyNumber: number } }));
  const controls = ['emergency-call-confirm-click', 'emergency-call-confirm-voice', 'emergency-call-cancel'].map(element);
  element('emergency-call-confirmation').querySelectorAll = () => controls;
  const requests = [];
  const context = {
    document: {
      getElementById: element,
      querySelectorAll: selector => selector === '[data-emergency-number]' ? numbers : []
    },
    window: { location: { href: '' }, setTimeout() {} },
    planningRequest: async (url, options) => {
      requests.push({ url, number: options.body.number, confirmed: options.body.confirmed });
      return { notificationsQueued: 0 };
    }
  };
  vm.runInNewContext(
    extract('    let emergencyNumberSelected = null;', '    function parlerCheckinBienEtre(texte, status)'), context
  );
  numbers[1].listeners.click();
  assert.equal(element('emergency-call-confirmation').hidden, false);
  assert.equal(requests.length, 0);
  assert.equal(context.window.location.href, '');
  element('emergency-call-confirm-click').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests[0], { url: '/api/emergency-alert', number: '112', confirmed: true });
  assert.equal(context.window.location.href, 'tel:112');
  assert.ok(controls.every(button => !button.disabled));
  numbers[0].listeners.click();
  assert.equal(element('emergency-call-confirmation').hidden, false);
  assert.equal(element('emergency-call-confirm-click').disabled, false);
});

test('the notification shortcut opens the separate page', () => {
  const calls = [];
  const context = {
    connectedUser: { role: 'senior' },
    switchScreen: screen => calls.push(screen)
  };
  vm.runInNewContext(
    `${extract('    function ouvrirNotifications()', '    function ouvrirAgenda()')}\n` +
    'globalThis.openNotifications = ouvrirNotifications;', context
  );
  context.openNotifications();
  assert.deepEqual(calls, ['messages']);
});

test('opening a senior message notification opens the separate page and conversation', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      open: false, value: '', children: [],
      replaceChildren(...children) { this.children = children; },
      scrollIntoView() { this.scrolled = true; },
      append() {}
    });
    return elements.get(id);
  };
  const id = '0b4a1f2c-1234-4567-8123-123456789abc';
  const calls = [];
  const context = {
    pendingNotificationId: id,
    connectedUser: { role: 'senior' },
    window: {
      pendingPushNotificationId: '',
      location: { href: `https://example.test/app-mobile.html?notification=${id}` },
      history: { replaceState() {} }
    },
    document: {
      getElementById: element,
      createElement: () => ({ append() {} })
    },
    URL,
    switchScreen: screen => calls.push([screen]),
    seniorLinksRequest: async () => ({
      type: 'private_message', senderUserId: 'contact', entityId: 'message',
      title: 'Message', message: 'Bonjour', createdAt: '2026-01-01'
    }),
    makeTextElement: () => ({}),
    formatDateTime: () => '',
    annulerDicteeMessage() {},
    annulerPropositionMessage() {},
    chargerCorrespondants: async () => true,
    ouvrirConversation: async (role, focus) => { calls.push([role, focus]); return true; },
    showToast: message => { throw new Error(message); }
  };
  vm.runInNewContext(
    extract('        window.handlePendingNotification = async () => {',
      "        window.addEventListener('generation-notification-opened'"), context
  );
  await context.window.handlePendingNotification();
  assert.equal(element('messages-senior').scrolled, true);
  assert.deepEqual(calls, [['messages'], ['senior', 'message']]);
});

test('contact video calls use the selected contact and report failures without a fake call', async () => {
  assert.match(source, /addEventListener\('click', \(\) => appelerContactEnVisio\(contact\)\)/);
  assert.match(source, /onclick="declencherVisio\(\)"/);
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      classList: { add() {}, remove() {} },
      replaceChildren() {}
    });
    return elements.get(id);
  };
  const calls = [];
  const context = {
    connectedUser: { id: 'senior' },
    videoCallState: { active: false, callFrame: null, localStream: null },
    document: { getElementById: element, querySelectorAll: () => [] },
    window: {},
    console: { warn() {} },
    setVideoCallPlaceholder() {},
    switchScreen: screen => calls.push({ screen }),
    showToast: (message, success) => calls.push({ message, success }),
    planningRequest: async (url, options) => {
      calls.push({ url, contactId: options.body.contactId });
      throw new Error('Contact indisponible');
    }
  };
  vm.runInNewContext(
    `${extract('    function terminerAppelVideo(', "    document.getElementById('toggle-mic-button')")}\n` +
    'globalThis.callContact = appelerContactEnVisio;', context
  );
  await context.callContact({ id: 'contact-1', name: 'Contact' });
  assert.deepEqual(calls[0], { url: '/api/video/token', contactId: 'contact-1' });
  assert.deepEqual(calls[1], { screen: 'contacts' });
  assert.deepEqual(calls[2], { message: 'Contact indisponible', success: false });
  assert.equal(context.videoCallState.active, false);

  calls.length = 0;
  context.planningRequest = async () => ({ roomUrl: 'https://example.test/room', token: 'token' });
  context.window.DailyIframe = {
    createFrame: () => ({
      on() {},
      async join(options) { calls.push({ url: options.url, token: options.token }); }
    })
  };
  await context.callContact({ id: 'contact-1', name: 'Contact' });
  assert.deepEqual(calls[0], { url: 'https://example.test/room', token: 'token' });
  assert.equal(context.videoCallState.active, true);
});
