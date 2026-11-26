const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

test('daily recipe follows the senior shopping list', () => {
  assert.match(source, /id="senior-shopping-status"[\s\S]*?<\/details>\s*<\/section>\s*<section class="form-card" id="senior-daily-recipe">/);
});

test('professional workspace explains its areas and assigned tasks in separate tabs', () => {
  const pro = source.slice(source.indexOf('id="screen-pro"'), source.indexOf('id="screen-settings"'));
  assert.match(pro, /<details class="senior-disclosure senior-tab-disclosure" data-close-on-mouse-leave>[\s\S]*?Comprendre les espaces[\s\S]*?proches autorisés[\s\S]*?coordonnées ne leur sont pas transmises/);
  assert.match(pro, /<details class="senior-disclosure senior-tab-disclosure" id="pro-intervention-tasks-details">[\s\S]*?Mes tâches confiées[\s\S]*?ne remplace pas votre accord[\s\S]*?id="pro-intervention-tasks-list"/);
});

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
    document: { getElementById: element, addEventListener(type, handler) { this[type] = handler; } },
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

test('senior speech output is removed while dictation and emergency confirmation remain available', () => {
  assert.doesNotMatch(source, /speechSynthesis\.speak|settings-senior-voice|wellbeing-question-speak/);
  assert.match(source, /id="message-dictation-senior"/);
  assert.match(source, /id="emergency-call-confirm-voice"/);
});

test('message dictation stops when the page becomes hidden', () => {
  const { context } = voiceTestContext();
  let aborted = false;
  context.window.SpeechRecognition = function() {
    this.start = () => {};
    this.abort = () => { aborted = true; };
  };
  context.dicterMessageSenior();
  const start = source.lastIndexOf("    document.addEventListener('visibilitychange', () => {");
  const end = source.indexOf('    });', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end + '    });'.length), context);
  context.document.hidden = true;
  context.document.visibilitychange();
  assert.equal(aborted, true);
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
    window: { generationLiaisonTranslate: text => text },
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
    'message-status-senior': { textContent: '' },
    'message-quick-received': { disabled: false },
    'message-quick-well': { disabled: false }
  };
  let confirmed = false;
  let calls = [];
  let fails = false;
  let simple = false;
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    document: {
      body: { classList: { contains: () => simple } },
      getElementById: id => nodes[id],
      querySelectorAll: () => chosen.filter(item => item.checked),
      querySelector: () => ({ disabled: false })
    },
    window: { confirm: () => confirmed, generationLiaisonTranslate: text => text },
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
  chosen.forEach(item => { item.checked = true; });
  simple = true;
  nodes['message-text-senior'].value = 'Bonjour';
  nodes['message-contact-senior'].value = 'alice';
  await context.envoyerMessage('senior');
  assert.equal(calls[2].url, '/api/messages/alice');
});

test('quick replies send only to the selected contact, keep the draft, and report errors', async () => {
  const nodes = {
    'message-contact-senior': { value: '' },
    'message-text-senior': { value: 'Brouillon' },
    'message-status-senior': { textContent: '' },
    'message-quick-received': { disabled: false },
    'message-quick-well': { disabled: false }
  };
  const submit = { disabled: false };
  const calls = [];
  let resolve;
  let canRefresh = true;
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    window: { generationLiaisonTranslate: text => text },
    document: { getElementById: id => nodes[id], querySelector: () => submit },
    seniorLinksRequest: (url, options) => {
      calls.push({ url, options });
      return new Promise((done, reject) => { resolve = { done, reject }; });
    },
    ouvrirConversation: async () => canRefresh
  };
  vm.runInNewContext(extract('    async function envoyerReponseRapide(', '    async function repondreInvitation('), context);
  await context.envoyerReponseRapide('Bien reçu');
  assert.match(nodes['message-status-senior'].textContent, /Choisissez/);
  nodes['message-contact-senior'].value = 'alice';
  const pending = context.envoyerReponseRapide('Bien reçu');
  assert.equal(nodes['message-status-senior'].textContent, 'Envoi du message…');
  await context.envoyerReponseRapide('Tout va bien');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/messages/alice');
  assert.equal(calls[0].options.body.message, 'Bien reçu');
  assert.equal(submit.disabled, true);
  resolve.done();
  await pending;
  assert.equal(nodes['message-text-senior'].value, 'Brouillon');
  assert.equal(nodes['message-status-senior'].textContent, 'Message envoyé.');
  assert.equal(submit.disabled, false);
  const failed = context.envoyerReponseRapide('Tout va bien');
  resolve.reject(new Error('Accès refusé'));
  await failed;
  assert.equal(nodes['message-status-senior'].textContent, 'Accès refusé');
  assert.equal(submit.disabled, false);
  canRefresh = false;
  const sentWithoutRefresh = context.envoyerReponseRapide('Tout va bien');
  resolve.done();
  await sentWithoutRefresh;
  assert.match(nodes['message-status-senior'].textContent, /Message envoyé.*Impossible de rafraîchir/);
  await context.envoyerReponseRapide('Autre texte');
  assert.equal(calls.length, 3);
  context.window.generationLiaisonTranslate = text => ({
    'Bien reçu': 'Received', 'Message envoyé.': 'Message sent.'
  })[text] || text;
  canRefresh = true;
  const english = context.envoyerReponseRapide('Bien reçu');
  assert.equal(calls[3].options.body.message, 'Received');
  resolve.done();
  await english;
  assert.equal(nodes['message-status-senior'].textContent, 'Message sent.');
});

test('senior conversation loading is cleared safely when a newer request replaces it', async () => {
  const nodes = {
    'message-contact-senior': { value: 'alice' },
    'message-open-senior': { disabled: false },
    'message-loading-senior': { hidden: true }
  };
  const pending = [];
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    document: { getElementById: id => nodes[id] },
    ouvrirConversation: () => new Promise(resolve => pending.push(resolve))
  };
  vm.runInNewContext(extract('    let seniorConversationLoadingRevision = 0;', '    function reinitialiserPhotoMessages()'), context);
  const first = context.ouvrirConversationSenior();
  assert.equal(nodes['message-loading-senior'].hidden, false);
  assert.equal(nodes['message-open-senior'].disabled, true);
  context.reinitialiserChargementConversationSenior();
  nodes['message-contact-senior'].value = 'bob';
  const second = context.ouvrirConversationSenior();
  pending[0](false);
  await first;
  assert.equal(nodes['message-loading-senior'].hidden, false);
  assert.equal(nodes['message-open-senior'].disabled, true);
  pending[1](true);
  assert.equal(await second, true);
  assert.equal(nodes['message-loading-senior'].hidden, true);
  assert.equal(nodes['message-open-senior'].disabled, false);
});

test('senior send reports a successful delivery even if conversation refresh fails', async () => {
  const nodes = {
    'message-contact-senior': { value: 'alice' },
    'message-text-senior': { value: 'Bonjour' },
    'message-status-senior': { textContent: '' },
    'message-quick-received': { disabled: false },
    'message-quick-well': { disabled: false }
  };
  const button = { disabled: false };
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    document: {
      body: { classList: { contains: () => true } },
      getElementById: id => nodes[id],
      querySelector: () => button
    },
    window: { generationLiaisonTranslate: text => text },
    annulerDicteeMessage() {}, annulerPropositionMessage() {},
    seniorLinksRequest: async () => ({}), ouvrirConversation: async () => false
  };
  vm.runInNewContext(extract('    async function envoyerMessage(role)', '    async function repondreInvitation('), context);
  await context.envoyerMessage('senior');
  assert.equal(nodes['message-text-senior'].value, '');
  assert.match(nodes['message-status-senior'].textContent, /Message envoyé.*Impossible de rafraîchir/);
  assert.equal(button.disabled, false);
});

test('removed presentation choice cannot be restored from an old preference', () => {
  assert.doesNotMatch(source, /Présentation douce|settings-presentation|presentation-jardin|generation-liaison-presentation-/);
  assert.match(source, /id="settings-senior-display"/);
});

test('simplified view defaults on per account and preserves explicit choices', () => {
  const classes = new Set(), values = new Map(), selected = [{ checked: true }, { checked: true }];
  const displayElements = { 'senior-large-toggle': { setAttribute() {} }, 'senior-large-status': {} };
  const context = {
    connectedUser: { id: 'alice', role: 'senior' },
    document: {
      body: { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } },
      getElementById: id => displayElements[id],
      querySelectorAll: () => selected
    },
    window: { generationLiaisonTranslate: text => text },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    planifierLectureSenior() {}
  };
  vm.runInNewContext(extract('    function initialiserVueSenior(user)', '    async function setAuthenticatedView(user)'), context);
  context.initialiserVueSenior(context.connectedUser);
  assert.equal(classes.has('senior-simple'), true);
  assert.equal(classes.has('simple-mode'), true);
  assert.ok(selected.every(input => !input.checked));
  context.changerVueSenior(true);
  assert.equal(values.get('generation-liaison-senior-simple-alice'), 'true');
  context.changerTailleSenior();
  assert.equal(classes.has('senior-large'), true);
  assert.equal(values.get('generation-liaison-senior-large-alice'), 'true');
  context.initialiserVueSenior({ id: 'bob', role: 'senior' });
  assert.equal(classes.has('senior-simple'), true);
  assert.equal(classes.has('senior-large'), false);
  context.initialiserVueSenior({ id: 'alice', role: 'aidant' });
  assert.equal(classes.has('senior-simple'), false);
  assert.equal(classes.has('simple-mode'), true);
  context.initialiserVueSenior(context.connectedUser);
  assert.equal(classes.has('senior-large'), true);
  context.changerTailleSenior();
  assert.equal(classes.has('senior-large'), false);
  context.changerVueSenior(false);
  assert.equal(classes.has('senior-simple'), false);
  assert.equal(classes.has('simple-mode'), false);
  assert.equal(values.get('generation-liaison-senior-simple-alice'), 'false');
  context.initialiserVueSenior(context.connectedUser);
  assert.equal(classes.has('senior-simple'), false);
  context.connectedUser = { id: 'helper', role: 'aidant' };
  context.initialiserVueSenior(context.connectedUser);
  assert.equal(classes.has('simple-mode'), true);
  context.changerVueSimplifiee(false);
  assert.equal(classes.has('simple-mode'), false);
  assert.equal(values.get('generation-liaison-simple-helper'), 'false');
  context.initialiserVueSenior({ id: 'other', role: 'pro' });
  assert.equal(classes.has('simple-mode'), true);
  context.initialiserVueSenior(context.connectedUser);
  assert.equal(classes.has('simple-mode'), false);
  context.changerVueSimplifiee(true);
  assert.equal(classes.has('simple-mode'), true);
  for (const role of ['pro', 'establishment', 'staff']) {
    context.connectedUser = { id: role, role };
    context.initialiserVueSenior(context.connectedUser);
    assert.equal(classes.has('simple-mode'), true, `${role} defaults to simplified view`);
    assert.equal(classes.has('senior-simple'), false);
    context.changerVueSimplifiee(false);
    context.initialiserVueSenior(context.connectedUser);
    assert.equal(classes.has('simple-mode'), false, `${role} retains the choice`);
  }
});

test('all account types can adjust the simplified display without hiding emergency controls', () => {
  const settings = extract('<div id="screen-settings"', '<div id="screen-agenda"');
  assert.match(settings, /id="settings-senior-display"[\s\S]*Affichage senior[\s\S]*changerVueSenior\(false\)/);
  assert.match(settings, /id="settings-simple-display"[\s\S]*changerVueSimplifiee\(false\)/);
  for (const [start, end] of [['screen-establishment', 'screen-staff'], ['screen-staff', 'screen-aidant']]) {
    const section = extract(`<div id="${start}"`, `<div id="${end}"`);
    assert.match(section, /Réglages d’affichage[\s\S]*changerVueSimplifiee\(false\)/);
  }
  assert.match(source, /body\.simple-mode \.screen-container \{ font-size: 1\.1rem/);
  assert.doesNotMatch(source, /body\.simple-mode[^{]*emergency-call-card[^{]*\{[^}]*display:\s*none/);
});

test('daily journals center their entries and keep concise safety notices', () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const journal = extract(`id="${role}-journal-details"`, '</details>');
    assert.match(journal, new RegExp(`id="${role}-journal-list"`));
    assert.doesNotMatch(journal, /Archive des nouvelles|Le nom de l’auteur|État et étapes de vos visites/);
    assert.match(journal, /ne surveille pas|ne remplace pas un dossier médical/);
  }
  assert.match(source, /:is\(#senior-journal-list, #aidant-journal-list, #pro-journal-list\) \.progress-item\s*\{\s*text-align:\s*center/);
  assert.match(extract('id="senior-journal-details"', '</details>'), /Avant d’imprimer/);
  assert.match(extract('id="aidant-journal-details"', '</details>'), /Avant d’imprimer/);
});

test('journal buttons share centered typography and link to timed help for each role', () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    assert.match(source, new RegExp(`<details class="senior-explanation journal-help" data-help-for="#${role}-journal-details > summary">[\\s\\S]*?<div class="gl-help-bubble">`));
  }
  assert.match(source, /:is\(#senior-journal-details, #aidant-journal-details, #pro-journal-details\) > summary\s*\{[^}]*align-items:\s*center;[^}]*font-size:\s*1\.125rem;/);
  assert.match(source, /\.journal-help\[data-help-enhanced\] > summary \{ display: none; \}/);
  assert.match(source, /@media \(hover: none\) \{\s*\.screen-container:not\(#screen-aidant\) \.journal-help\[data-help-enhanced\] > summary/);
});

test('simplified journal shortcut opens the senior journal without hiding safety follow-up', () => {
  const calls = [];
  const context = {
    connectedUser: { role: 'senior' },
    switchScreen: screen => calls.push(screen),
    ouvrirSectionSenior: (details, target) => calls.push([details, target])
  };
  vm.runInNewContext(extract('    function ouvrirJournalSenior()', '    function switchScreen('), context);
  context.ouvrirJournalSenior();
  assert.deepEqual(calls, ['more', ['senior-journal-details', 'senior-journal-details']]);
  assert.doesNotMatch(source, /body\.senior-simple #wellbeing-checkin-details\s*\{/);
  assert.doesNotMatch(source, /body\.senior-simple #wellbeing-safety-result\s*\{/);
  context.connectedUser.role = 'aidant';
  context.ouvrirJournalSenior();
  assert.equal(calls.length, 2);
});

test('today shortcuts display unread notification counts', () => {
  const badges = {};
  const context = {
    document: { getElementById: id => badges[id] || (badges[id] = {}) },
    window: { generationLiaisonTranslate: text => text }
  };
  vm.runInNewContext(extract('    function actualiserCompteurNotifications(count)', '    function notificationVisible(entry)'), context);
  context.actualiserCompteurNotifications(2);
  assert.equal(badges['home-notification-count-senior'].textContent, '2 non lues');
  assert.equal(badges['home-notification-count-senior'].hidden, false);
  context.actualiserCompteurNotifications(0);
  assert.equal(badges['home-notification-count-senior'].hidden, true);
});

test('sharing settings discard responses for a previous accompanied person', async () => {
  const pending = [];
  const nodes = {
    'aidant-sharing-consents': { children: [], replaceChildren(...items) { this.children = items; }, append(item) { this.children.push(item); } },
    'aidant-note-recipient': { replaceChildren() {}, add() {} }
  };
  const context = {
    connectedUser: { id: 'aidant', role: 'aidant' },
    activeSeniorProfileId: 'first',
    consentLoadId: 0,
    document: { getElementById: id => nodes[id] },
    makeTextElement: (tag, text) => ({ tag, text }),
    Option: function Option(text, value) { this.text = text; this.value = value; },
    planningRequest: () => new Promise(resolve => pending.push(resolve))
  };
  vm.runInNewContext(extract('    async function chargerConsentements(role)', '    function configurerFormulairesInformationsPersonne()'), context);
  const first = context.chargerConsentements('aidant');
  context.activeSeniorProfileId = 'second';
  const second = context.chargerConsentements('aidant');
  pending[1]([]);
  await second;
  pending[0]([{ name: 'Ancien profil', consented: true }]);
  await first;
  assert.equal(nodes['aidant-sharing-consents'].children[0].text, 'Aucune demande de partage en attente.');
});

test('key contacts render safe call links and discard responses from a previous profile', async () => {
  const nodes = {
    'aidant-key-contacts-status': { textContent: '' },
    'aidant-key-contacts-list': {
      children: [], replaceChildren() { this.children = []; },
      append(item) { this.children.push(item); }
    }
  };
  const requests = [];
  const makeNode = tag => ({
    tagName: tag, children: [], textContent: '',
    append(...items) { this.children.push(...items); },
    setAttribute() {}, addEventListener(type, handler) { this[type] = handler; }
  });
  const context = {
    keyContactsLoadId: 0,
    document: { getElementById: id => nodes[id], createElement: makeNode },
    makeTextElement: (tag, text) => ({ tagName: tag, textContent: text }),
    planningRequest: () => new Promise(resolve => requests.push(resolve)),
    window: { confirm: () => true }
  };
  vm.runInNewContext(extract('    async function chargerContactsUtiles(', '    async function chargerTachesPartagees('), context);
  const old = context.chargerContactsUtiles('aidant');
  const current = context.chargerContactsUtiles('aidant');
  requests[1]({ contacts: [{ id: 'one', name: '<img>', description: 'Voisin', phone: '+33123456789' }] });
  await current;
  const row = nodes['aidant-key-contacts-list'].children[0];
  assert.equal(row.children[0].textContent, '<img>');
  assert.equal(row.children[2].href, 'tel:+33123456789');
  requests[0]({ contacts: [{ id: 'old', name: 'Ancien profil', description: 'Voisin', phone: '123' }] });
  await old;
  assert.equal(nodes['aidant-key-contacts-list'].children[0].children[0].textContent, '<img>');
});

test('the optional color game can be played locally without sending data', () => {
  const elements = {
    'color-game-question': { textContent: '' }, 'color-game-status': { textContent: '' }
  };
  const context = {
    document: { getElementById: id => elements[id] },
    window: { generationLiaisonTranslate: text => text },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);
  context.repondreJeuCouleur('Vert');
  assert.match(elements['color-game-status'].textContent, /réessayer/);
  context.repondreJeuCouleur('Rouge');
  assert.match(elements['color-game-status'].textContent, /Bravo/);
  context.nouvelleCouleur();
  assert.match(elements['color-game-question'].textContent, /Bleu/);
  context.Math.random = () => 0.99;
  context.nouvelleCouleur();
  assert.match(elements['color-game-question'].textContent, /Jaune/);
  context.repondreJeuCouleur('Jaune');
  assert.match(elements['color-game-status'].textContent, /Bravo/);
});

test('arithmetic and riddles allow retries and start a different round', () => {
  const elements = {};
  const element = id => elements[id] ||= { textContent: '' };
  const context = {
    document: { getElementById: element },
    window: { generationLiaisonTranslate: text => text },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);

  context.repondreJeuCalcul(0);
  assert.match(element('math-game-status').textContent, /réessayer/);
  context.repondreJeuCalcul(1);
  assert.match(element('math-game-status').textContent, /Bravo/);
  context.nouveauCalcul();
  assert.match(element('math-game-question').textContent, /1 \+ 1/);
  assert.equal(element('math-game-status').textContent, '');
  assert.deepEqual([0, 1, 2].map(i => element(`math-game-choice-${i}`).textContent), [1, 2, 3]);
  context.repondreJeuCalcul(1);
  assert.match(element('math-game-status').textContent, /Bravo/);

  context.repondreDevinette(1);
  assert.match(element('riddle-game-status').textContent, /réessayer/);
  context.repondreDevinette(0);
  assert.match(element('riddle-game-status').textContent, /Bravo/);
  context.nouvelleDevinette();
  assert.match(element('riddle-game-question').textContent, /fruit/);
  assert.equal(element('riddle-game-label-1').textContent, 'La banane');
  assert.equal(element('riddle-game-image-1').src, 'riddle-images/banane.jpg');
  assert.equal(element('riddle-game-label-3').textContent, 'La fraise');
  assert.equal(element('riddle-game-image-3').src, 'riddle-images/fraise.jpg');
  assert.equal(element('riddle-game-status').textContent, '');
  context.repondreDevinette(1);
  assert.match(element('riddle-game-status').textContent, /Bravo/);
  for (let round = 0; round < 5; round++) {
    context.nouvelleDevinette();
    const riddle = vm.runInNewContext('devinettesJeu[devinetteCourante]', context);
    assert.equal(riddle.choix.length, 4);
    riddle.choix.forEach((choice, index) => {
      assert.equal(element(`riddle-game-label-${index}`).textContent, choice.texte);
      assert.equal(element(`riddle-game-image-${index}`).src, `riddle-images/${choice.image}.jpg`);
      assert.ok(fs.existsSync(path.join(__dirname, '..', 'riddle-images', `${choice.image}.jpg`)));
    });
    context.repondreDevinette(riddle.reponse);
    assert.match(element('riddle-game-status').textContent, /Bravo/);
  }
});

test('games have named controls and are available in the senior full view', () => {
  const games = extract('<section class="form-card" id="senior-game-section"', '<section class="form-card" id="senior-album-section"');
  assert.match(games, /Jeux gratuits/);
  assert.match(games, /Petits calculs/);
  assert.match(games, /Devinettes/);
  assert.match(games, /Rien n’est enregistré ni partagé/);
  assert.equal((games.match(/class="game-choice(?: riddle-choice)?"/g) || []).length, 17);
  assert.equal((games.match(/class="game-choice riddle-choice"/g) || []).length, 4);
  const facile = games.slice(games.indexOf('<span>Niveau facile</span>'), games.indexOf('<span>Niveau intermédiaire</span>'));
  const intermediaire = games.slice(games.indexOf('<span>Niveau intermédiaire</span>'), games.indexOf('<span>Niveau avancé</span>'));
  const avance = games.slice(games.indexOf('<span>Niveau avancé</span>'));
  for (const nom of ['Les couleurs', 'Petits calculs', 'Devinettes']) assert.ok(facile.includes(`<summary>${nom}</summary>`));
  for (const nom of ['Morpion', 'Jeu des paires', 'Deviner le nombre', 'Sudoku 6 × 6']) assert.ok(intermediaire.includes(`<summary>${nom}</summary>`));
  for (const nom of ['Sudoku 9 × 9', 'Suites logiques', 'Mots mêlés']) assert.ok(avance.includes(`<summary>${nom}</summary>`));
  assert.ok(!avance.includes('<summary>Sudoku 6 × 6</summary>'));
  for (const classe of ['game-level-easy', 'game-level-medium', 'game-level-hard', 'game-level-letters']) {
    assert.match(games, new RegExp(`class="game-level ${classe}"`));
  }
  assert.match(games, /<span>Jeux de lettres<\/span>/);
  assert.match(games, /<summary>Mots croisés<\/summary>/);
  assert.doesNotMatch(games, /class="game-level-icons"/);
});

test('tic-tac-toe handles moves, wins, a draw and restarting without losing accessible labels', () => {
  const elements = {};
  const element = id => elements[id] ||= {
    textContent: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const context = {
    document: { getElementById: element },
    window: { generationLiaisonTranslate: text => text },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);

  context.nouveauMorpion();
  context.jouerMorpion(4);
  assert.equal(element('morpion-4').textContent, 'X');
  assert.equal(element('morpion-0').textContent, 'O');
  assert.equal(element('morpion-4').attributes['data-symbol'], 'X');
  assert.equal(element('morpion-0').attributes['data-symbol'], 'O');
  assert.match(element('morpion-4').attributes['aria-label'], /Ligne 2, colonne 2 : croix/);
  assert.equal(element('morpion-4').attributes['aria-disabled'], 'true');
  assert.match(element('morpion-status').textContent, /ligne 1, colonne 1/);
  context.jouerMorpion(4);
  assert.equal(element('morpion-1').textContent, '');

  vm.runInNewContext("grilleMorpion = ['X','X','','O','O','','','','']; morpionTermine = false;", context);
  context.jouerMorpion(2);
  assert.match(element('morpion-status').textContent, /vous avez gagné/);
  assert.equal(element('morpion-5').textContent, '');
  context.jouerMorpion(5);
  assert.equal(element('morpion-5').textContent, '');

  vm.runInNewContext("grilleMorpion = ['O','O','','X','','','X','','']; morpionTermine = false;", context);
  context.jouerMorpion(8);
  assert.match(element('morpion-status').textContent, /ordinateur a gagné/);
  assert.equal(element('morpion-2').textContent, 'O');

  vm.runInNewContext("grilleMorpion = ['X','O','X','X','O','O','O','X','']; morpionTermine = false;", context);
  context.jouerMorpion(8);
  assert.match(element('morpion-status').textContent, /Match nul/);
  context.nouveauMorpion();
  assert.equal(element('morpion-8').textContent, '');
  assert.equal(element('morpion-8').attributes['data-symbol'], '');
  assert.equal(element('morpion-8').attributes['aria-disabled'], 'false');
  assert.match(element('morpion-8').attributes['aria-label'], /vide/);
  assert.match(element('morpion-status').textContent, /vous de jouer/);
});

test('matching pairs stay visible until the next choice and restart with four pairs', () => {
  const node = () => ({
    _textContent: '', children: [], attributes: {},
    get textContent() { return this._textContent; },
    set textContent(value) { this._textContent = value; this.children = []; },
    setAttribute(name, value) { this.attributes[name] = value; },
    appendChild(child) { this.children.push(child); }
  });
  const elements = {};
  const element = id => elements[id] ||= node();
  const context = {
    document: { getElementById: element, createElementNS: () => node() },
    window: { generationLiaisonTranslate: text => text },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);
  context.retournerCarte(0);
  context.retournerCarte(1);
  assert.equal(element('memory-0').children[0].children[0].attributes.href, '#memory-image-pomme');
  assert.equal(element('memory-1').children[0].children[0].attributes.href, '#memory-image-chat');
  assert.match(element('memory-0').attributes['aria-label'], /Pomme/);
  assert.match(element('memory-status').textContent, /différentes/);
  context.retournerCarte(2);
  assert.equal(element('memory-0').textContent, '?');
  assert.equal(element('memory-1').textContent, '?');
  assert.equal(element('memory-2').children[0].children[0].attributes.href, '#memory-image-fleur');
  context.retournerCarte(7);
  assert.match(element('memory-status').textContent, /Paire trouvée/);
  assert.match(element('memory-2').attributes['aria-label'], /Fleur, paire trouvée/);
  context.retournerCarte(2);
  context.retournerCarte(0);
  context.retournerCarte(6);
  context.retournerCarte(1);
  context.retournerCarte(4);
  context.retournerCarte(3);
  context.retournerCarte(5);
  assert.match(element('memory-status').textContent, /toutes les paires/);
  context.nouveauJeuPaires();
  assert.equal(element('memory-0').textContent, '?');
  assert.equal(element('memory-0').children.length, 0);
  assert.equal(element('memory-0').attributes['aria-disabled'], 'false');
  const values = Array.from(vm.runInNewContext('cartesPaires', context));
  assert.deepEqual(values.slice().sort(), ['Chat', 'Chat', 'Fleur', 'Fleur', 'Pomme', 'Pomme', 'Soleil', 'Soleil']);
});

test('number guessing gives higher and lower hints, stops after success and restarts', () => {
  const elements = {};
  const element = id => elements[id] ||= {
    textContent: '', attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  const context = {
    document: { getElementById: element },
    window: { generationLiaisonTranslate: text => text },
    Math: { random: () => 0.4, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);
  context.devinerNombre(2);
  assert.match(element('number-game-status').textContent, /plus grand que 2/);
  context.devinerNombre(8);
  assert.match(element('number-game-status').textContent, /plus petit que 8/);
  context.devinerNombre(5);
  assert.match(element('number-game-status').textContent, /Bravo.*5/);
  assert.equal(element('number-1').attributes['aria-disabled'], 'true');
  context.devinerNombre(1);
  assert.match(element('number-game-status').textContent, /Bravo.*5/);
  context.nouveauNombreSecret();
  assert.equal(element('number-1').attributes['aria-disabled'], 'false');
  assert.match(element('number-game-status').textContent, /Choisissez/);
  context.devinerNombre(5);
  assert.match(element('number-game-status').textContent, /Bravo/);
});

test('sudoku generates solvable unique grids, validates entries and starts a fresh game', () => {
  const elements = {};
  const element = id => elements[id] ||= {
    textContent: '', children: [],
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); }
  };
  const context = {
    window: { generationLiaisonTranslate: text => text },
    document: {
      getElementById: element,
      createElement: () => ({ value: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } })
    },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);
  context.nouveauSudoku();
  const cells = element('sudoku-grid').children;
  assert.equal(cells.length, 36);
  assert.ok(cells.filter(cell => !cell.readOnly).length >= 18);
  assert.match(cells[0].attributes['aria-label'], /Ligne 1, colonne 1/);
  const puzzle = cells.map(cell => Number(cell.value));
  assert.equal(context.compterSolutionsSudoku(puzzle.slice()), 1);
  context.verifierSudoku();
  assert.match(element('sudoku-status').textContent, /Complétez/);
  const editable = cells.find(cell => !cell.readOnly);
  editable.value = '7';
  context.verifierSudoku();
  assert.match(element('sudoku-status').textContent, /chiffre de 1 à 6/);

  const solution = puzzle.slice();
  function solve() {
    const index = solution.indexOf(0);
    if (index < 0) return true;
    for (let n = 1; n <= 6; n++) {
      const row = Math.floor(index / 6), col = index % 6;
      const conflict = solution.some((value, i) => value === n &&
        (Math.floor(i / 6) === row || i % 6 === col ||
         (Math.floor(Math.floor(i / 6) / 2) === Math.floor(row / 2) && Math.floor((i % 6) / 3) === Math.floor(col / 3))));
      if (!conflict) {
        solution[index] = n;
        if (solve()) return true;
        solution[index] = 0;
      }
    }
    return false;
  }
  assert.ok(solve());
  cells.forEach((cell, index) => { if (!cell.readOnly) cell.value = String(solution[index]); });
  const editableIndex = cells.indexOf(editable);
  editable.value = String(solution[Math.floor(editableIndex / 6) * 6 + (editableIndex + 1) % 6]);
  context.verifierSudoku();
  assert.match(element('sudoku-status').textContent, /répétition/);
  editable.value = String(solution[editableIndex]);
  context.verifierSudoku();
  assert.match(element('sudoku-status').textContent, /Bravo/);
  context.Math.random = () => 0.9;
  context.nouveauSudoku();
  assert.notDeepEqual(element('sudoku-grid').children.map(cell => Number(cell.value)), puzzle);
  assert.equal(context.compterSolutionsSudoku(element('sudoku-grid').children.map(cell => Number(cell.value))), 1);
  assert.match(element('sudoku-status').textContent, /Complétez/);
});

test('9x9 sudoku provides a unique puzzle, validates entries and keeps both grids independent', () => {
  const elements = {};
  const element = id => elements[id] ||= {
    textContent: '', children: [],
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); }
  };
  const context = {
    window: { generationLiaisonTranslate: text => text },
    document: {
      getElementById: element,
      createElement: () => ({ value: '', attributes: {}, setAttribute(name, value) { this.attributes[name] = value; } })
    },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);
  context.initialiserSudoku();
  const sixCells = element('sudoku-grid').children;
  const sixEditable = sixCells.find(cell => !cell.readOnly);
  sixEditable.value = '4';
  context.initialiserSudoku9();
  const cells = element('sudoku-9-grid').children;
  assert.equal(cells.length, 81);
  assert.equal(cells.filter(cell => cell.readOnly).length, 30);
  assert.match(cells[80].attributes['aria-label'], /Ligne 9, colonne 9/);
  assert.match(cells[2].className, /block-right/);
  assert.match(cells[18].className, /block-bottom/);
  const puzzle = cells.map(cell => Number(cell.value));
  assert.equal(context.compterSolutionsSudoku(puzzle.slice(), 9, 3), 1);
  context.verifierSudoku9();
  assert.match(element('sudoku-9-status').textContent, /1 à 9/);
  const editable = cells.find(cell => !cell.readOnly);
  editable.value = '0';
  context.verifierSudoku9();
  assert.match(element('sudoku-9-status').textContent, /1 à 9/);
  context.initialiserSudoku9();
  assert.equal(editable.value, '0');
  const box = Array(81).fill(0);
  box[10] = 7;
  assert.ok(!Array.from(context.candidatsSudoku(box, 0, 9, 3)).includes(7));

  const solution = puzzle.slice();
  function solve() {
    let best = -1, candidates = null;
    for (let i = 0; i < 81; i++) {
      if (solution[i]) continue;
      const row = Math.floor(i / 9), col = i % 9;
      const choices = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => !solution.some((value, j) =>
        value === n && (Math.floor(j / 9) === row || j % 9 === col ||
          (Math.floor(Math.floor(j / 9) / 3) === Math.floor(row / 3) && Math.floor((j % 9) / 3) === Math.floor(col / 3)))));
      if (!choices.length) return false;
      if (!candidates || choices.length < candidates.length) { best = i; candidates = choices; }
    }
    if (best === -1) return true;
    for (const n of candidates) {
      solution[best] = n;
      if (solve()) return true;
      solution[best] = 0;
    }
    return false;
  }
  assert.ok(solve());
  cells.forEach((cell, index) => { if (!cell.readOnly) cell.value = String(solution[index]); });
  const index = cells.indexOf(editable);
  editable.value = String(solution[Math.floor(index / 9) * 9 + (index + 1) % 9]);
  context.verifierSudoku9();
  assert.match(element('sudoku-9-status').textContent, /répétition/);
  editable.value = String(solution[index]);
  context.verifierSudoku9();
  assert.match(element('sudoku-9-status').textContent, /Bravo/);
  context.Math.random = () => 0.9;
  context.nouveauSudoku9();
  const next = element('sudoku-9-grid').children.map(cell => Number(cell.value));
  assert.notDeepEqual(next, puzzle);
  assert.equal(context.compterSolutionsSudoku(next.slice(), 9, 3), 1);
  assert.equal(sixEditable.value, '4');
  assert.match(element('sudoku-9-status').textContent, /Complétez/);
});

test('logical sequences accept retries, reject invalid answers and generate both kinds of puzzle', () => {
  const elements = {};
  const element = id => elements[id] ||= { value: '', textContent: '' };
  const context = {
    document: { getElementById: element },
    window: { generationLiaisonTranslate: text => text },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);
  context.verifierSuite();
  assert.match(element('sequence-status').textContent, /nombre entier/);
  element('sequence-answer').value = '32';
  context.verifierSuite();
  assert.match(element('sequence-status').textContent, /réessayer/);
  element('sequence-answer').value = '64';
  context.verifierSuite();
  assert.match(element('sequence-status').textContent, /Bravo/);
  context.nouvelleSuite();
  assert.equal(element('sequence-question').textContent, '1, 2, 4, 8, 16, …');
  assert.equal(element('sequence-answer').value, '');
  element('sequence-answer').value = '32';
  context.verifierSuite();
  assert.match(element('sequence-status').textContent, /Bravo/);
  context.Math.random = () => 0.9;
  context.nouvelleSuite();
  assert.equal(element('sequence-question').textContent, '8, 12, 19, 29, 42, …');
  assert.match(element('sequence-hint').textContent, /écart/);
  element('sequence-answer').value = '58';
  context.verifierSuite();
  assert.match(element('sequence-status').textContent, /Bravo/);
});

test('word search finds words in both directions, reports errors and restarts', () => {
  const elements = {};
  const element = id => elements[id] ||= {
    textContent: '', children: [],
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); }
  };
  const context = {
    window: { generationLiaisonTranslate: text => text, generationLiaisonLocale: () => 'fr-FR' },
    document: {
      getElementById: element,
      createElement: tag => ({
        tagName: tag,
        attributes: {}, handlers: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener(name, handler) { this.handlers[name] = handler; }
      })
    },
    Math: { random: () => 0, floor: Math.floor, abs: Math.abs, max: Math.max, sign: Math.sign }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);
  context.initialiserMotsMeles();
  const cells = element('word-grid').children;
  assert.equal(cells.length, 64);
  assert.match(cells[0].attributes['aria-label'], /Ligne 1, colonne 1/);
  cells[0].handlers.click();
  assert.equal(cells[0].attributes['aria-pressed'], 'true');
  cells[10].handlers.click();
  assert.match(element('word-status').textContent, /alignées/);
  const words = Array.from(vm.runInNewContext('themesMotsMeles[themeMotsMeles].mots', context));
  function findWord(word) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const endRow = r + dr * (word.length - 1), endCol = c + dc * (word.length - 1);
        if (endRow < 0 || endRow >= 8 || endCol < 0 || endCol >= 8) continue;
        if ([...word].every((letter, i) => cells[(r + dr * i) * 8 + c + dc * i].textContent === letter)) {
          return [r * 8 + c, endRow * 8 + endCol];
        }
      }
    }
    return null;
  }
  for (const word of words) {
    const positions = findWord(word);
    assert.ok(positions, `${word} must be present in the grid`);
    cells[positions[0]].handlers.click();
    cells[positions[1]].handlers.click();
    const listedWord = element('word-list').children.find(child => child.textContent === word);
    assert.equal(listedWord.tagName, 's');
    assert.ok(element('word-list').children.some(child => child.className === 'word-found-sr' && child.textContent === ' (trouvé)'));
    assert.match(cells[positions[0]].className, /found/);
    if (word === words[0]) {
      cells[positions[0]].handlers.click();
      cells[positions[1]].handlers.click();
      assert.match(element('word-status').textContent, /déjà été trouvé/);
    }
  }
  assert.match(element('word-status').textContent, /tous les mots/);
  context.nouveauxMotsMeles();
  assert.equal(element('word-grid').children.length, 64);
  assert.ok(!element('word-list').children.some(child => child.tagName === 's' || child.className === 'word-found-sr'));
  assert.match(element('word-status').textContent, /première lettre/);
});

test('crosswords render intersecting clues, check answers and restart with a different puzzle', () => {
  const createNode = tag => ({
    tagName: tag, value: '', textContent: '', children: [], attributes: {}, handlers: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; }
  });
  const elements = {};
  const element = id => elements[id] ||= createNode('div');
  const context = {
    window: { generationLiaisonTranslate: text => text, generationLiaisonLocale: () => 'fr-FR' },
    document: { getElementById: element, createElement: createNode },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(extract("    let couleurJeu = 'Rouge';", '    function annulerDicteeMessage()'), context);
  context.initialiserMotsCroises();
  const cells = element('crossword-grid').children;
  assert.equal(cells.length, 169);
  assert.match(element('crossword-theme').textContent, /ciel/);
  assert.ok(element('crossword-clues').children.some(node => node.textContent.startsWith('7. Moment')));
  const intersection = cells[3 * 13 + 6].children.find(node => node.tagName === 'input');
  assert.match(intersection.attributes['aria-label'], /Horizontal 6, Vertical 7/);
  assert.equal(cells[3 * 13 + 6].children[0].textContent, '7');
  context.verifierMotsCroises();
  assert.match(element('crossword-status').textContent, /Complétez toutes/);
  const solution = [
    'G..C..COMETE.', 'AURORE...C...', 'L..N.....L...', 'A..SATELLITE.',
    'X..T..Q..P..P', 'I..E..U..S..L', 'E..LUMIERE..A', '...L..N.....N',
    '...ATMOSPHERE', '...T..X.....T', '...I.ZENITH.E', '...O.........',
    '...NEBULEUSE.'
  ].join('');
  const puzzles = vm.runInNewContext('grillesMotsCroises', context);
  const checkCrossings = (puzzle, expected) => {
    const positions = new Map();
    assert.ok(puzzle.mots.length >= 10);
    for (const word of puzzle.mots) {
      for (let i = 0; i < word.mot.length; i++) {
        const row = word.ligne + (word.direction === 'vertical' ? i : 0);
        const column = word.colonne + (word.direction === 'horizontal' ? i : 0);
        assert.ok(row < 13 && column < 13);
        const index = row * 13 + column;
        assert.equal(expected[index], word.mot[i], `${word.mot} at ${row},${column}`);
        positions.set(index, (positions.get(index) || 0) + 1);
      }
    }
    for (const word of puzzle.mots) {
      assert.ok([...word.mot].some((_, i) => {
        const row = word.ligne + (word.direction === 'vertical' ? i : 0);
        const column = word.colonne + (word.direction === 'horizontal' ? i : 0);
        return positions.get(row * 13 + column) > 1;
      }), `${word.mot} should cross another word`);
    }
  };
  checkCrossings(puzzles[0], solution);
  cells.forEach((cell, index) => {
    const input = cell.children.find(node => node.tagName === 'input');
    assert.equal(Boolean(input), solution[index] !== '.');
    if (input) input.value = solution[index];
  });
  const first = cells[0].children.find(node => node.tagName === 'input');
  first.value = 'é';
  first.handlers.input();
  assert.equal(first.value, 'E');
  context.verifierMotsCroises();
  assert.match(element('crossword-status').textContent, /réessayer/);
  first.value = 'G';
  context.initialiserMotsCroises();
  assert.equal(element('crossword-grid').children, cells);
  context.verifierMotsCroises();
  assert.match(element('crossword-status').textContent, /Bravo/);
  context.nouveauxMotsCroises();
  const next = element('crossword-grid').children;
  assert.match(element('crossword-theme').textContent, /patrimoine/);
  assert.ok(next.every(cell => cell.children.filter(node => node.tagName === 'input').every(input => input.value === '')));
  const nextSolution = [
    '..........A..', '....D...H.R..', 'MEMOIRE.E.C..', '....C...R.H.A',
    '....TRADITION', '....I...T.V.T', '.TEMOIGNAGE.I', '....N...G.S.Q',
    'CHRONIQUE...U', '....A.......A', 'PATRIMOINE..I', '....R.......R',
    '...GENEALOGIE'
  ].join('');
  checkCrossings(puzzles[1], nextSolution);
  next.forEach((cell, index) => {
    const input = cell.children.find(node => node.tagName === 'input');
    assert.equal(Boolean(input), nextSolution[index] !== '.');
    if (input) input.value = nextSolution[index];
  });
  context.verifierMotsCroises();
  assert.match(element('crossword-status').textContent, /Bravo/);
});

test('birthday form submits the birth date and keeps it when saving fails', async () => {
  let handler;
  let resetCount = 0;
  let refreshCount = 0;
  let fail = false;
  let submitted;
  const nodes = {
    'birthday-form': { addEventListener: (_, fn) => { handler = fn; }, reset: () => { resetCount++; }, querySelector: () => birthdayButton },
    'birthday-name': { value: 'Alice' },
    'birthday-date': { value: '1950-02-28' },
    'birthday-message': { textContent: '' }
  };
  const birthdayButton = { disabled: false };
  const context = {
    calendarRevision: 0,
    document: { getElementById: id => nodes[id] },
    planningRequest: async (url, options) => {
      submitted = { url, options };
      if (fail) throw new Error('Erreur de sauvegarde');
    },
    definirMessageFormulaireAgenda: (element, text) => { element.textContent = text; },
    afficherErreurFormulaireAgenda: (element, error, fallback) => { element.textContent = error.message || fallback; },
    chargerCalendrier: () => { refreshCount++; }
  };
  vm.runInNewContext(extract("        document.getElementById('birthday-form').addEventListener", "        document.getElementById('planning-next-day')"), context);
  await handler({ preventDefault() {} });
  assert.equal(submitted.url, '/api/agenda/birthdays');
  assert.equal(submitted.options.body.name, 'Alice');
  assert.equal(submitted.options.body.birthDate, '1950-02-28');
  assert.equal(resetCount, 1);
  assert.equal(refreshCount, 1);
  fail = true;
  await handler({ preventDefault() {} });
  assert.equal(nodes['birthday-message'].textContent, 'Erreur de sauvegarde');
  assert.equal(resetCount, 1);
});

test('senior settings remain accessible from navigation and the association shortcut', () => {
  const dashboard = extract('<div id="main-app-senior"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  assert.match(dashboard, /switchScreen\('settings'\); document\.getElementById\('senior-links-details'\)\.open = true/);
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
  for (const label of ['Contacter l’équipe', 'Services du quotidien']) {
    assert.equal(dashboard.split(label).length - 1, 1, label);
  }
  assert.match(dashboard, /<summary><span class="tile-icon"[^>]*>🤝<\/span>Contacter l’équipe<\/summary>/);
  assert.match(dashboard, /<summary><span class="tile-icon"[^>]*>🏠<\/span><span>Services du quotidien<\/span><\/summary>/);
  assert.match(tiles, /switchScreen\('directory'\)/);
  assert.doesNotMatch(tiles, /Mon agenda/);
  assert.doesNotMatch(dashboard, /Voir l’agenda/);
});

test('senior feature sections retain their content and can open programmatically', () => {
  for (const [id, content] of [
    ['senior-following-details', 'senior-live-following'],
    ['senior-note-details', 'senior-person-note-form'],
    ['senior-assistant-details', 'assistant-handoff-button'],
    ['senior-services-details', 'senior-service-area']
  ]) {
    const start = source.search(new RegExp(`<details class="senior-disclosure(?: senior-tab-disclosure)?" id="${id}">`));
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
    `${extract('    function ouvrirSectionSenior(detailsId, targetId)', '    function switchScreen(')}\n` +
    'globalThis.openSection = ouvrirSectionSenior;', context
  );
  assert.match(source, /<summary><span class="tile-icon"[^>]*>💬<\/span><span>Envoyer à l’équipe<\/span><\/summary>/);
  for (const [details, target] of [
    ['senior-services-details', 'senior-service-area'],
    ['senior-assistant-details', 'assistant-chat-panel']
  ]) {
    context.openSection(details, target);
    assert.equal(element(details).open, true);
    assert.equal(element(target).scrolled, true);
  }
});

test('wellbeing, video call, companionship, meal delivery and emergency lead the senior home', () => {
  const dashboard = extract('<div id="main-app-senior"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  const order = ['id="wellbeing-checkin-details"', 'onclick="declencherVisio()"',
    'id="senior-assistant-details"', 'Livraison de repas',
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

test('senior professional sections use consistent closed tabs and retain their controls', () => {
  const professional = extract('<div id="screen-senior-pro"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  assert.doesNotMatch(professional, /<h1>Pro<\/h1>\s*<summary>/);
  for (const [id, control] of [
    ['senior-services-details', 'senior-service-area'],
    ['senior-following-details', 'senior-live-following'],
    ['senior-note-details', 'senior-person-note-form'],
    ['senior-tasks-details', 'senior-tasks-form'],
    ['senior-history-details', 'senior-history-list']
  ]) {
    const start = professional.search(new RegExp(`<details class="[^"]*senior-tab-disclosure[^"]*" id="${id}"`));
    const end = professional.indexOf(`id="${control}"`, start);
    assert.ok(start >= 0 && end > start, `${id} must retain ${control}`);
    assert.match(professional.slice(start, end), /<summary><span class="tile-icon"/);
    assert.doesNotMatch(professional.slice(start, professional.indexOf('>', start)), /\sopen(?:\s|>)/);
  }
  assert.match(professional, /<section class="form-card" id="senior-pro-directory-action">\s*<button[^>]*onclick="switchScreen\('directory'\)"/);
  assert.match(source, /#senior-pro-directory-action > \.action-tile\s*\{[^}]*width:\s*100%;[^}]*padding:\s*14px 18px;/);
  assert.match(professional, /data-help-for="#senior-services-details > summary"/);
  assert.match(professional, /data-help-for="#senior-following-details > summary"/);
  assert.match(source, /#screen-senior-pro \.senior-explanation\[data-help-enhanced\] > summary\s*\{\s*display:\s*none;/);
  assert.match(source, /@media \(hover: none\) \{[\s\S]*?#screen-senior-pro \.senior-explanation\[data-help-enhanced\] > summary::before\s*\{\s*content:\s*'\?';/);
});

test('senior tabs retain controls and results', () => {
  const agenda = extract('<div id="screen-agenda"', '<div id="screen-directory"');
  const directory = extract('<div id="screen-directory"', '<div id="screen-contacts"');
  const contacts = extract('<div id="screen-contacts"', '<div id="screen-video-call"');
  assert.match(agenda, /<details class="senior-tab-disclosure">[\s\S]*?id="personal-event-form"/);
  assert.match(agenda, /id="calendar-grid"/);
  assert.match(directory, /<details class="senior-tab-disclosure">\s*<summary>[\s\S]*?Chercher un professionnel<\/summary>[\s\S]*?id="directory-search-form"[\s\S]*?id="directory-results"[\s\S]*?<\/details>/);
  assert.match(directory, /<details class="senior-tab-disclosure">\s*<summary>[\s\S]*?Annuaire partagé<\/summary>[\s\S]*?id="shared-directory-refresh"[\s\S]*?id="shared-directory-results"[\s\S]*?<\/details>/);
  assert.match(directory, /<details class="senior-tab-disclosure">\s*<summary>[\s\S]*?Mes demandes de rendez-vous<\/summary>[\s\S]*?id="directory-requester-bookings"[\s\S]*?<\/details>/);
  assert.equal((directory.match(/<details class="senior-tab-disclosure">/g) || []).length, 3);
  assert.match(source, /#screen-directory \.senior-tab-disclosure > summary,[\s\S]*?display:\s*flex;/);
  assert.match(contacts, /<details class="senior-tab-disclosure">[\s\S]*?id="add-app-contact-form"[\s\S]*?<\/details>[\s\S]*?<details class="senior-tab-disclosure">[\s\S]*?id="contacts-list"[\s\S]*?<\/details>/);
  assert.match(agenda, /<details class="senior-tab-disclosure" id="agenda-calendar-details">[\s\S]*?id="calendar-selected-day"[\s\S]*?<\/details>/);
  assert.match(agenda, /<details class="senior-tab-disclosure">[\s\S]*?Modifications depuis Google<\/summary>[\s\S]*?id="calendar-google-requests"[\s\S]*?<\/details>/);
  for (const role of ['senior', 'aidant', 'pro']) {
    const today = extract(`<div id="home-informations-${role}"`, role === 'senior' ? '<section class="form-card" id="senior-home-links"' : role === 'aidant' ? '<section class="form-card" id="aidant-home-links"' : '<section class="form-card" id="pro-workspace-information"');
    assert.match(today, new RegExp(`id="notifications-${role}"`));
    assert.match(source, new RegExp(`<details class="senior-tab-disclosure" id="message-details-${role}">[\\s\\S]*?id="message-form-${role}"[\\s\\S]*?<\\/details>`));
  }
});

test('professional sections and settings retain their controls in closed tabs', () => {
  const professional = extract('<div id="screen-pro"', '<div id="screen-messages"');
  const settings = extract('<div id="screen-settings"', '<div id="screen-agenda"');
  for (const [label, control] of [
    ['Demandes reçues', 'directory-professional-bookings'],
    ['Agenda des services du quotidien', 'pro-service-planning'],
    ['Coordination de l’équipe', 'member-form']
  ]) {
    assert.match(professional, new RegExp(`<details class="senior-tab-disclosure">\\s*<summary>[^<]*<span[^>]*>[^<]*<\\/span>${label}<\\/summary>[\\s\\S]*?id="${control}"`));
  }
  for (const [section, label, control] of [
    ['settings-senior-display', 'Affichage senior', 'senior-simple-enable'],
    ['notification-settings-pro', 'Mes préférences de notification', 'notification-preferences-form'],
    ['calendar-google-settings', 'Synchronisation du planning avec Google', 'calendar-google-sync-toggle'],
    ['directory-profile-panel', 'Annuaire national et rendez-vous', 'directory-profile-form'],
    ['professional-location-card', 'Mon point de départ et mon rayon d’intervention', 'professional-location-form']
  ]) {
    const start = settings.indexOf(`id="${section}"`);
    const end = settings.indexOf('</section>', start);
    const card = settings.slice(start, end);
    assert.match(card, new RegExp(`<details class="senior-tab-disclosure">\\s*<summary>[\\s\\S]*?${label}<\\/summary>`));
    assert.ok(card.includes(control));
  }
});

test('agenda shows the selected day and keeps explanations and Google controls available', () => {
  const agenda = extract('<div id="screen-agenda"', '<div id="screen-directory"');
  assert.match(agenda, /id="calendar-day"[^>]*aria-pressed="true"/);
  assert.ok(agenda.indexOf('id="calendar-selected-day"') < agenda.indexOf('Explications sur l’agenda'));
  assert.ok(agenda.indexOf('id="calendar-selected-day"') >= 0);
  const settings = extract('<div id="screen-settings"', '<div id="screen-agenda"');
  assert.match(settings, /id="calendar-google-settings"/);
  assert.doesNotMatch(agenda, /id="calendar-google-settings"/);
  assert.match(agenda, /<details class="senior-disclosure senior-explanation" data-help-for="#calendar-today">\s*<summary>Explications sur l’agenda<\/summary>[\s\S]*?chevauche/);
  assert.match(settings, /<summary>Explications<\/summary>[\s\S]*?la mise en pause ne supprime pas/i);
  assert.match(settings, /id="calendar-google-sync-toggle"/);
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
    window: { generationLiaisonTranslate: text => text, generationLiaisonLocale: () => 'fr-FR' },
    document: { getElementById: element, createElement: node },
    makeTextElement: (tag, text, className) => ({ tag, textContent: text, className }),
    Date, Intl
  };
  vm.runInNewContext(
    `${extract('    function dateInputValue(date)', '    async function chargerPartagesAgenda(')}\n` +
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
    window: { generationLiaisonTranslate: text => text, generationLiaisonLocale: () => 'fr-FR' },
    document: { getElementById: element, createElement: node },
    makeTextElement: (tag, text, className) => ({ tag, textContent: text, className }),
    Date, Intl
  };
  vm.runInNewContext(
    `${extract('    function dateInputValue(date)', '    async function chargerPartagesAgenda(')}\n` +
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
      hidden: false, textContent: '', dataset: {}, children: ['Ancien rendez-vous'],
      replaceChildren() { this.children = []; }
    });
    return elements.get(id);
  };
  let rejectRequest;
  const context = {
    connectedUser: { id: 'senior' }, calendarDate: '2026-12-31',
    calendarView: 'week', calendarLoadId: 0,
    window: { generationLiaisonTranslate: text => text },
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

test('mood choices open the appropriate question without sending or losing text', () => {
  const choices = ['bien', 'moyen', 'mal'].map(value => ({
    dataset: { wellbeingMood: value }, setAttribute(name, value) { this[name] = value; }
  }));
  const elements = {
    'wellbeing-mood-prompt': {},
    'wellbeing-mood-status': {},
    'wellbeing-checkin-response': { value: 'Mon message', required: true },
    'wellbeing-checkin-details': { open: false }
  };
  const context = {
    connectedUser: { id: 'alice', role: 'senior' },
    wellbeingLoadedDate: 'today', currentWellbeingCheckin: null, humeurBienEtre: null,
    dateCheckinBienEtre: () => 'today',
    window: { generationLiaisonTranslate: text => text },
    document: {
      getElementById: id => elements[id],
      querySelectorAll: () => choices
    },
    planningRequest() { throw new Error('A mood choice must not send anything'); }
  };
  vm.runInNewContext(
    `${extract('    const humeursBienEtre = {', '    function afficherCheckinBienEtre(checkin)')}\n` +
    'globalThis.choose = choisirHumeurBienEtre;', context
  );
  for (const [value, expected] of [['bien', /bien/], ['moyen', /préciser/], ['mal', /15 ou le 112/]]) {
    context.choose(value);
    assert.match(elements['wellbeing-mood-prompt'].textContent, expected);
    assert.equal(elements['wellbeing-checkin-response'].value, 'Mon message');
    assert.equal(elements['wellbeing-checkin-response'].required, false);
    assert.equal(elements['wellbeing-checkin-details'].open, true);
    assert.equal(choices.find(choice => choice.dataset.wellbeingMood === value)['aria-pressed'], 'true');
  }
  context.currentWellbeingCheckin = { id: 'already-saved' };
  context.choose('bien');
  assert.match(elements['wellbeing-mood-prompt'].textContent, /15 ou le 112/);
});

test('mood is submitted only on confirmation, with the optional text', async () => {
  let submit;
  const requests = [];
  const elements = {
    'wellbeing-checkin-form': { addEventListener: (name, fn) => { submit = fn; } },
    'wellbeing-checkin-response': { value: 'Je suis fatiguée.' },
    'wellbeing-checkin-submit': { disabled: false },
    'wellbeing-checkin-status': {},
    'wellbeing-share-confirmation': { checked: false }
  };
  const context = {
    document: { getElementById: id => elements[id], querySelectorAll: () => [] },
    connectedUser: { id: 'alice', role: 'senior' },
    wellbeingLoadedDate: 'today', wellbeingLoadId: 1, currentWellbeingCheckin: null,
    humeurBienEtre: 'moyen', humeursBienEtre: { moyen: { message: 'Je me sens moyennement bien.' } },
    dateCheckinBienEtre: () => 'today',
    planningRequest: async (url, options) => {
      requests.push({ url, options });
      return { checkin: { response: options.body.message }, sharedWithCount: 0 };
    },
    afficherCheckinBienEtre: checkin => { context.currentWellbeingCheckin = checkin; },
    window: { generationLiaisonTranslate: text => text, generationLiaisonLocale: () => 'fr-FR' }
  };
  vm.runInNewContext(extract("    document.getElementById('wellbeing-checkin-form').addEventListener('submit'",
    '    async function chargerAssistantConversation()'), context);
  assert.equal(requests.length, 0);
  await submit({ preventDefault() {} });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.body.message, 'Je me sens moyennement bien. Je suis fatiguée.');
  await submit({ preventDefault() {} });
  assert.equal(requests.length, 1);
});

test('check-in loading retries failures and ignores another account’s late response', async () => {
  const choices = [{ disabled: false }, { disabled: false }, { disabled: false }];
  const elements = {
    'wellbeing-checkin-status': {},
    'wellbeing-checkin-retry': { hidden: true },
    'wellbeing-checkin-details': { open: false },
    'wellbeing-checkin-form': { hidden: false },
    'wellbeing-checkin-result': { hidden: false },
    'wellbeing-aidant-contacts': { replaceChildren() {}, append() {} }
  };
  let resolve;
  const context = {
    connectedUser: { id: 'alice', role: 'senior' },
    wellbeingLoadedDate: null, wellbeingLoadId: 0,
    window: { generationLiaisonTranslate: text => text },
    document: { getElementById: id => elements[id], querySelectorAll: () => choices },
    dateCheckinBienEtre: () => 'today',
    reinitialiserHumeurBienEtre: () => choices.forEach(choice => { choice.disabled = true; }),
    afficherCheckinBienEtre: checkin => { context.shown = checkin; },
    planningRequest: async () => { throw new Error('Chargement impossible'); },
    makeTextElement: () => ({})
  };
  vm.runInNewContext(extract('    async function chargerCheckinBienEtre()', '    async function chargerCheckinsPartages()'), context);
  await context.chargerCheckinBienEtre();
  assert.equal(elements['wellbeing-checkin-retry'].hidden, false);
  assert.equal(elements['wellbeing-checkin-details'].open, true);
  assert.ok(choices.every(choice => choice.disabled));
  assert.equal(elements['wellbeing-checkin-result'].hidden, true);
  context.planningRequest = url => url === '/api/wellbeing/check-in'
    ? new Promise(done => { resolve = done; }) : Promise.resolve({ contacts: [] });
  const pending = context.chargerCheckinBienEtre();
  context.connectedUser = { id: 'bob', role: 'senior' };
  resolve({ checkin: { response: 'Privé' } });
  await pending;
  assert.equal(context.shown, undefined);
  assert.equal(context.wellbeingLoadedDate, null);
  context.planningRequest = async url => url === '/api/wellbeing/check-in'
    ? { checkin: null } : { contacts: [] };
  await context.chargerCheckinBienEtre();
  assert.equal(context.wellbeingLoadedDate, 'today');
  assert.equal(context.shown, null);
  assert.ok(choices.every(choice => !choice.disabled));
});

test('check-in is collapsed while safety follow-up remains outside the collapsed content', () => {
  const checkin = extract('        <section class="form-card" id="wellbeing-checkin-panel"',
    '        <section class="form-card emergency-call-card"');
  assert.match(checkin, /<details class="senior-disclosure" id="wellbeing-checkin-details">/);
  assert.match(checkin, /Vérification de bien-être/);
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
    window: { generationLiaisonTranslate: text => text },
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
    window: { setTimeout: (callback, delay) => { timeout = { callback, delay }; return 1; }, clearTimeout() {}, generationLiaisonTranslate: text => text },
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
  assert.match(elements['wellbeing-safety-result'].children[0].children[1].textContent, /En France.*Dans un autre pays, contactez les secours locaux/);
  context.showCheckin({ ...checkin, safetyCheckStatus: 'no_response', safetyNotifiedAidants: 2 });
  assert.match(elements['wellbeing-safety-result'].children[0].children[1].textContent, /2 aidant\(s\).*secours locaux/);
  context.showCheckin({ ...checkin, safetyConcern: false });
  assert.equal(elements['wellbeing-safety-result'].children.length, 0);
});

test('senior shortcuts open the messages page', () => {
  const more = source.indexOf('id="screen-more"');
  const shortcut = source.indexOf('onclick="ouvrirNotifications()"', more);
  const tiles = extract('<div id="screen-more"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  assert.ok(shortcut > more);
  assert.match(tiles, /<button type="button" class="action-tile" onclick="ouvrirNotifications\(\)"/);
  assert.doesNotMatch(source, /id="home-notification-count-senior"/);
  const dashboard = extract('<div id="main-app-senior"', '<div id="screen-more"');
  assert.match(dashboard, /id="notifications-senior"/);
  assert.doesNotMatch(dashboard, /id="message-form-senior"/);
  const page = extract('<div id="screen-messages"', '<div id="screen-settings"');
  assert.match(page, /onclick="switchScreen\(connectedUser\.role\)"/);
  for (const role of ['senior', 'aidant', 'pro']) {
    assert.doesNotMatch(page, new RegExp(`id="notifications-${role}"`));
    assert.match(page, new RegExp(`id="message-form-${role}"`));
  }
});

test('only pending invitations appear in today, retain actions and are read when visible', async () => {
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
          ? badge : id === `screen-${role}` ? screen : container,
        createElement: node,
        querySelectorAll: () => container.children.filter(card => card.className?.includes('unread') && !card.classList.removed)
      },
      window: { innerWidth: 100, innerHeight: 100, generationLiaisonTranslate: text => text, handlePendingNotification() { this.opened = true; } },
      setTimeout: (callback, delay) => { assert.equal(delay, 2000); timers.set(++timerId, callback); return timerId; },
      clearTimeout: id => timers.delete(id),
      makeTextElement: (tag, text) => Object.assign(node(tag), { textContent: text }),
      formatDateTime: () => 'date',
      planningRequest: async (url, options) => {
        requests.push({ url, options });
        if (url === '/api/notifications') return {
          unreadCount: 2,
          notifications: [
            { id: 'message', type: 'private_message', senderUserId: 'other', title: 'Message', message: 'Bonjour', read: false },
            { id: 'first', type: 'service_booking_invite', entityStatus: 'requested', title: 'Demande', message: 'Service', read: false },
            { id: 'old', type: 'care_visit_invite', entityStatus: 'accepted', title: 'Invitation', message: 'Rendez-vous', read: false },
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
    assert.equal(container.children.length, 2);
    const [firstInvitation, invitation] = container.children;
    assert.match(firstInvitation.className, /\bnotification-bubble\b/);
    assert.match(invitation.className, /\bnotification-bubble\b/);
    const firstMetadata = firstInvitation.children.find(child => child.tag === 'small');
    const invitationMetadata = invitation.children.find(child => child.tag === 'small');
    assert.equal(firstMetadata.textContent, 'date · ');
    assert.equal(firstMetadata.children[0].textContent, 'Non lu');
    assert.equal(firstInvitation.children.find(child => child.className === 'notification-actions').children.length, 2);
    assert.equal(invitation.children.find(child => child.className === 'notification-actions').children.length, 2);

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
    assert.equal(firstMetadata.children[0].textContent, 'Lu');
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
    assert.equal(invitationMetadata.children[0].textContent, 'Non lu');
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

test('message direction filter keeps transmissions visible and reports an empty selection', () => {
  const entries = ['sent', 'received'].map(direction => ({
    hidden: false, getAttribute: () => direction
  }));
  const transmission = { hidden: false };
  const container = { querySelectorAll: () => entries };
  const filter = { value: 'sent' };
  const status = {};
  const context = { window: { generationLiaisonTranslate: text => text } };
  vm.runInNewContext(extract('    function appliquerFiltreMessages(', '    function reinitialiserFiltresMessages()'), context);
  context.appliquerFiltreMessages(container, filter, status);
  assert.deepEqual(entries.map(entry => entry.hidden), [false, true]);
  assert.equal(transmission.hidden, false);
  assert.equal(status.hidden, true);
  filter.value = 'received';
  context.appliquerFiltreMessages(container, filter, status);
  assert.deepEqual(entries.map(entry => entry.hidden), [true, false]);
  filter.value = 'all';
  context.appliquerFiltreMessages(container, filter, status);
  assert.deepEqual(entries.map(entry => entry.hidden), [false, false]);
  container.querySelectorAll = () => [entries[0]];
  filter.value = 'received';
  context.appliquerFiltreMessages(container, filter, status);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Aucun message/);
});

test('opening a conversation marks received messages read and displays the sender receipt after refresh', async () => {
  const container = { children: [], replaceChildren() { this.children = []; }, append(item) { this.children.push(item); } };
  const select = { value: 'contact', options: [{ value: '' }, { value: 'contact' }], selectedOptions: [{ text: 'Contact' }] };
  const status = {};
  const filter = { value: 'all' };
  const calls = [];
  let senderRead = false;
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    openMessageConversations: {},
    window: { generationLiaisonTranslate: text => text },
    accountPhotoObjectUrl: null, messagePhotoObjectUrl: null, messagePhotoLoadId: 0,
    SERVER_URL: '', authHeaders: () => ({}), fetch: async () => ({ status: 404 }),
    document: {
      getElementById: id => id === 'message-contact-senior' ? select : id === 'message-list-senior' ? container : id === 'message-filter-senior' ? filter : status,
      createElement: () => ({
        children: [], style: { setProperty() {} }, setAttribute() {},
        append(...items) { this.children.push(...items); }, replaceChildren(...items) { this.children = items; }
      })
    },
    makeTextElement: (tag, text) => ({ tag, text }),
    appliquerFiltreMessages() {},
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
  filter.value = 'sent';
  const before = calls.length;
  assert.equal(await context.open('senior'), true);
  assert.equal(calls.length, before + 1);
  assert.equal(calls.at(-1).options, undefined);
});

test('professional workspace heading and subtitle contrast with the dark header', () => {
  assert.match(source, /#professional-workspace > \.header-mobile > h3,\s*#professional-workspace > \.header-mobile > span\s*\{\s*color:\s*#fff;/);
  assert.match(source, /id="professional-workspace">[\s\S]*?<div class="header-mobile" style="background: #34495e;">/);
});

test('soft button colours are limited to aidant and pro sessions and cleared on logout', () => {
  const login = extract('    async function setAuthenticatedView(user)', '        initialiserVueSenior(user);');
  const logout = extract('    async function deconnecterUtilisateur(', "        activeSeniorProfileId = '';");
  assert.match(login, /classList\.toggle\('soft-workspace', \['aidant', 'pro'\]\.includes\(user\.role\)\)/);
  assert.match(logout, /classList\.remove\('senior-mode', 'senior-simple', 'senior-large', 'soft-workspace', 'simple-mode'\)/);
  assert.match(source, /body\.soft-workspace :is\(\.screen-container, #nav-bar\) button/);
  assert.match(source, /button:is\(\[aria-pressed="true"\], \.selected, \.active\)/);
  assert.match(source, /button:is\(\.decline, \.btn-danger, \[data-close-account\], #settings-logout\)/);
});

test('senior button colours leave emergency and game controls unchanged', () => {
  const seniorStyles = extract('        body.senior-mode :is(.screen-container, #nav-bar) button:not(', '        @media print {');
  assert.match(seniorStyles, /:not\(#senior-game-section button, \.emergency-call-actions button\)/);
  assert.match(seniorStyles, /linear-gradient\(120deg, #dff3e8, #bfe3d2\)/);
  assert.match(seniorStyles, /button:not\([^)]*\):is\(\[aria-pressed="true"\], \.selected, \.active\)/);
});

test('message bubbles use the full conversation width and stay left-aligned', () => {
  const listStyle = extract('        [id^="message-list-"]', '        .message-bubble {');
  const bubbleStyle = extract('        .message-bubble {', '        .message-bubble p');
  const ownStyle = extract('        .message-bubble.mine {', '        input, select, textarea');
  assert.match(listStyle, /align-items:\s*flex-start/);
  assert.match(bubbleStyle, /width:\s*100%/);
  assert.match(bubbleStyle, /box-sizing:\s*border-box/);
  assert.doesNotMatch(ownStyle, /align-self:\s*flex-end/);
});

test('message bubbles distinguish participants and keep contact colours when options are reordered', async () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const container = { children: [], replaceChildren() { this.children = []; }, append(item) { this.children.push(item); } };
    const select = {
      value: 'alice', options: [{ value: '' }, { value: 'alice' }, { value: 'bob' }],
      selectedOptions: [{ text: 'Alice' }]
    };
    const status = {};
    const context = {
      connectedUser: { id: 'user', role },
      openMessageConversations: {},
      window: { generationLiaisonTranslate: text => text },
      accountPhotoObjectUrl: null, messagePhotoObjectUrl: null, messagePhotoLoadId: 0,
      SERVER_URL: '', authHeaders: () => ({}), fetch: async () => ({ status: 404 }),
      document: {
        getElementById: id => id === `message-contact-${role}` ? select : id === `message-list-${role}` ? container : status,
        createElement: () => ({
          children: [], style: { setProperty(name, value) { this[name] = value; } },
          setAttribute() {}, append(...items) { this.children.push(...items); },
          replaceChildren(...items) { this.children = items; }
        })
      },
      makeTextElement: (tag, text) => ({ tag, text }),
      appliquerFiltreMessages() {},
      formatDateTime: () => 'date',
      seniorLinksRequest: async () => ({ messages: [
        { id: 'sent', mine: true, body: 'Bonjour', readAt: 'today' },
        { id: 'received', mine: false, body: 'Bonjour', readAt: 'today' }
      ] })
    };
    vm.runInNewContext(
      `${extract('    async function ouvrirConversation(role, focusId', '    function rafraichirConversationVisible()')}\n` +
      'globalThis.open = ouvrirConversation;', context
    );
    assert.equal(await context.open(role), true);
    assert.equal(container.children[0].className, 'message-bubble mine');
    assert.equal(container.children[1].className, 'message-bubble');
    assert.equal(container.children[0].children[0].children[0].textContent, '🧑');
    assert.equal(container.children[1].children[0].children[0].textContent, '🧑');
    const aliceColour = container.children[1].style['--message-background'];
    assert.match(aliceColour, /^hsl\(/);
    select.options.reverse();
    assert.equal(await context.open(role), true);
    assert.equal(container.children[1].style['--message-background'], aliceColour);
    select.value = 'bob';
    select.selectedOptions = [{ text: 'Bob' }];
    assert.equal(await context.open(role), true);
    assert.notEqual(container.children[1].style['--message-background'], aliceColour);
  }
});

test('message avatars use only available shared contact photos and discard stale loads', async () => {
  const revoked = [];
  let resolvePhoto;
  const avatar = () => ({ children: [], replaceChildren(...items) { this.children = items; } });
  const select = { value: 'alice' };
  const context = {
    connectedUser: { id: 'user', role: 'aidant' },
    messagePhotoLoadId: 0, messagePhotoObjectUrl: null,
    SERVER_URL: '', authHeaders: () => ({ Authorization: 'Bearer test' }),
    document: { createElement: () => ({}) },
    URL: { createObjectURL: () => 'blob:photo', revokeObjectURL: url => revoked.push(url) },
    fetch: async (url, options) => {
      assert.equal(url, '/api/contacts/alice/photo');
      assert.equal(options.cache, 'no-store');
      assert.equal(options.headers.Authorization, 'Bearer test');
      return { status: 200, ok: true, blob: () => new Promise(resolve => { resolvePhoto = resolve; }) };
    },
    console
  };
  vm.runInNewContext(
    `${extract('    function reinitialiserPhotoMessages()', '    let couleurJeu')}\n` +
    'globalThis.loadPhoto = chargerPhotoMessages; globalThis.resetPhoto = reinitialiserPhotoMessages;',
    context
  );
  const first = avatar();
  const pending = context.loadPhoto('alice', 'user', 'aidant', select, [first]);
  await new Promise(setImmediate);
  context.resetPhoto();
  resolvePhoto({});
  await pending;
  assert.equal(first.children.length, 0);

  const second = avatar();
  const loaded = context.loadPhoto('alice', 'user', 'aidant', select, [second]);
  await new Promise(setImmediate);
  resolvePhoto({});
  await loaded;
  assert.equal(second.children[0].src, 'blob:photo');
  assert.equal(second.children[0].alt, '');
  context.resetPhoto();
  assert.deepEqual(revoked, ['blob:photo']);

  context.fetch = async () => ({ status: 404 });
  const unavailable = avatar();
  await context.loadPhoto('alice', 'user', 'aidant', select, [unavailable]);
  assert.equal(unavailable.children.length, 0);
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

test('iOS native push is unavailable without affecting Android or existing removal', async () => {
  const form = { querySelector: () => ({}) };
  const button = {};
  const status = {};
  let platform = 'ios';
  let token = null;
  let permissionRequests = 0;
  const context = {
    connectedUser: { id: 'user-1', role: 'senior' },
    document: { querySelector: selector => {
      if (selector.startsWith('.notification-preferences-form')) return form;
      if (selector.startsWith('.enable-push-button')) return button;
      return status;
    } },
    window: { Capacitor: { getPlatform: () => platform }, requestNativePushPermission: async () => { permissionRequests++; } },
    localStorage: { getItem: key => key === 'push' ? token : null, setItem() {} },
    PUSH_TOKEN_KEY: 'push',
    planningRequest: async url => url.endsWith('/preferences')
      ? { phone: '', emailEnabled: false, smsEnabled: false }
      : { channels: { email: false, sms: false, nativePush: true } },
    console
  };
  vm.runInNewContext(
    `${extract('    async function demanderNotificationsAutomatiquement(user)', '    async function activerNotificationsPush(button)')}\n` +
    'globalThis.loadPreferences = chargerPreferencesNotification; globalThis.requestAutomatically = demanderNotificationsAutomatiquement;', context
  );
  await context.requestAutomatically(context.connectedUser);
  assert.equal(permissionRequests, 0);
  await context.loadPreferences();
  assert.equal(button.disabled, true);
  assert.match(status.textContent, /iPhone ne sont pas encore disponibles/);
  token = 'existing';
  await context.loadPreferences();
  assert.equal(button.disabled, false);
  assert.match(button.textContent, /Désactiver/);
  assert.match(status.textContent, /ne sont pas encore disponibles/);
  token = null;
  platform = 'android';
  await context.loadPreferences();
  assert.equal(button.disabled, false);
  assert.match(status.textContent, /prêtes à être activées/);
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

test('iOS native push registration does not request permission or register a token', async () => {
  const client = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'push-client.js'), 'utf8');
  const start = client.indexOf('window.registerNativePush = async');
  const end = client.indexOf('window.unregisterNativePush = async', start);
  assert.ok(start >= 0 && end > start);
  let requests = 0;
  const context = {
    window: {
      Capacitor: { getPlatform: () => 'ios' },
      requestNativePushPermission: async () => { requests++; return 'granted'; }
    }
  };
  vm.runInNewContext(client.slice(start, end), context);
  await assert.rejects(context.window.registerNativePush('https://example.test', 'session'), /pas encore disponibles/);
  assert.equal(requests, 0);
});

test('removing a legacy iOS push registration leaves activation disabled', async () => {
  const stored = new Map([['push', JSON.stringify({ platform: 'ios', token: 'legacy-token' })]]);
  const status = {};
  const button = { dataset: { role: 'senior' } };
  const calls = [];
  const context = {
    window: {
      Capacitor: { getPlatform: () => 'ios', isNativePlatform: () => true },
      unregisterNativePush: async () => calls.push('unregister')
    },
    document: { querySelector: () => status },
    localStorage: {
      getItem: key => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: key => stored.delete(key)
    },
    PUSH_TOKEN_KEY: 'push',
    planningRequest: async (path, options) => calls.push({ path, method: options.method, body: options.body }),
    chargerPreferencesNotification: async () => {},
    showToast: () => {}
  };
  vm.runInNewContext(
    `${extract('    async function desactiverNotificationsPush(button)', '    function actualiserCompteurNotifications(count)')}\n` +
    'globalThis.disablePush = desactiverNotificationsPush;', context
  );
  await context.disablePush(button);
  assert.equal(calls[0].method, 'DELETE');
  assert.equal(calls[0].body.platform, 'ios');
  assert.equal(calls[1], 'unregister');
  assert.equal(stored.has('push'), false);
  assert.equal(button.disabled, true);
});

test('emergency details are optional while numbers, confirmation and status stay accessible', () => {
  const emergency = extract('<section class="form-card emergency-call-card"', '<section class="form-card" id="notifications-panel-senior"');
  assert.match(emergency, /<details class="senior-disclosure senior-explanation" data-help-for="\[data-emergency-number\]">\s*<summary>Explications sur l’appel<\/summary>/);
  assert.match(emergency, /<\/details>\s*<p class="helper-text">En France, utilisez ces numéros\. Dans un autre pays, contactez les secours locaux\.<\/p>\s*<div class="emergency-call-actions">/);
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
    window: { location: { href: '' }, setTimeout() {}, generationLiaisonTranslate: text => text },
    planningRequest: async (url, options) => {
      requests.push({ url, number: options.body.number, confirmed: options.body.confirmed });
      return { notificationsQueued: 0 };
    }
  };
  vm.runInNewContext(
    extract('    let emergencyNumberSelected = null;', '    function afficherCheckinBienEtre(checkin)'), context
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
  let recognition;
  context.window.generationLiaisonLocale = () => 'en-US';
  context.window.SpeechRecognition = class {
    constructor() { recognition = this; }
    start() {}
  };
  element('emergency-call-confirm-voice').listeners.click({ currentTarget: element('emergency-call-confirm-voice') });
  assert.equal(recognition.lang, 'fr-FR');
  recognition.onresult({ results: [[{ transcript: 'Je confirme l’appel d’urgence' }]] });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(requests[1], { url: '/api/emergency-alert', number: '15', confirmed: false });
  assert.equal(context.window.location.href, 'tel:15');
});

test('professional messages shortcut stays separate from today', () => {
  assert.match(source, /#pro-notifications-tile\s*\{\s*width:\s*100%;\s*\}/);
  assert.match(source, /id="home-informations-pro"/);
  assert.doesNotMatch(source, /id="home-notification-count-pro"/);
});

test('focus indicators cover form fields and controls across account screens', () => {
  assert.match(source, /input:focus, select:focus, textarea:focus\s*\{\s*outline:\s*3px solid #163b72/);
  assert.match(source, /\.screen-container :is\(button, a, summary\):focus-visible\s*\{\s*outline:\s*3px solid #163b72/);
});

test('the notification shortcut opens the separate page', () => {
  const calls = [];
  const context = {
    connectedUser: { role: 'senior' },
    switchScreen: screen => calls.push(screen),
    document: { getElementById: () => ({ open: false }) }
  };
  vm.runInNewContext(
    `${extract('    function ouvrirNotifications(', '    function ouvrirAgenda()')}\n` +
    'globalThis.openNotifications = ouvrirNotifications;', context
  );
  context.openNotifications();
  assert.deepEqual(calls, ['messages']);
});

test('opening an inbox message loads correspondents only once while regular navigation still loads them', async () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const elements = new Map();
    const element = id => {
      if (!elements.has(id)) elements.set(id, {
        value: '', open: false, classList: { add() {} },
        scrollIntoView() {}
      });
      return elements.get(id);
    };
    let contactLoads = 0;
    const context = {
      connectedUser: { id: role, role, verificationStatus: 'approved' },
      document: { getElementById: element, querySelectorAll: () => [] },
      annulerDicteeMessage() {},
      annulerPropositionMessage() {},
      reinitialiserChargementConversationSenior() {},
      chargerNotifications() {},
      chargerMessagesSecurite() {},
      chargerCorrespondants: async () => { contactLoads++; return true; },
      ouvrirConversation: async () => true,
      showToast: message => { throw new Error(message); }
    };
    vm.runInNewContext(
      extract('    function switchScreen(', '    function ouvrirAgenda()') +
      extract('    async function ouvrirMessageDepuisBoite(role, message)', '    async function chargerBoiteReception(role)'),
      context
    );
    context.ouvrirNotifications();
    assert.equal(contactLoads, 1);
    contactLoads = 0;
    await context.ouvrirMessageDepuisBoite(role, { id: 'message', senderUserId: 'contact' });
    assert.equal(contactLoads, 1);
    assert.equal(element(`message-contact-${role}`).value, 'contact');
    assert.equal(element(`message-details-${role}`).open, true);
    if (role === 'aidant') {
      contactLoads = 0;
      await context.ouvrirMessageDepuisBoite(role, { safety: true });
      assert.equal(contactLoads, 1);
      assert.equal(element('safety-messages-details').open, true);
    }
  }
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
    chargerMessagesAdministration: async () => ({ announcements: [] }),
    switchScreen: screen => calls.push([screen]),
    seniorLinksRequest: async () => ({
      type: 'private_message', senderUserId: 'contact', entityId: 'message',
      title: 'Message', message: 'Bonjour', createdAt: '2026-01-01'
    }),
    makeTextElement: () => ({}),
    formatDateTime: () => '',
    annulerDicteeMessage() {},
    annulerPropositionMessage() {},
    reinitialiserChargementConversationSenior() {},
    chargerCorrespondants: async () => true,
    ouvrirConversation: async (role, focus) => { calls.push([role, focus]); return true; },
    showToast: message => { throw new Error(message); }
  };
  vm.runInNewContext(
    extract('        window.handlePendingNotification = async () => {',
      "        window.addEventListener('generation-notification-opened'"), context
  );
  await context.window.handlePendingNotification();
  assert.equal(element('message-details-senior').open, true);
  assert.equal(element('messages-senior').scrolled, true);
  assert.deepEqual(calls, [['messages'], ['senior', 'message']]);
});

test('a notification in a closed tab is not marked visible', () => {
  const rect = { top: 0, bottom: 100, left: 0, right: 100, height: 100, width: 100 };
  const card = { isConnected: true, closest: () => ({}), getBoundingClientRect: () => rect };
  const context = {
    connectedUser: { id: 'user', role: 'aidant' },
    document: { hidden: false, getElementById: () => ({ classList: { contains: () => true }, getBoundingClientRect: () => rect }) },
    window: { innerWidth: 100, innerHeight: 100 }, Math
  };
  vm.runInNewContext(`${extract('    function notificationVisible(entry)', '    function surveillerNotificationsVisibles()')}\nglobalThis.visible = notificationVisible;`, context);
  const entry = { userId: 'user', role: 'aidant', card };
  assert.equal(context.visible(entry), false);
  card.closest = () => null;
  assert.equal(context.visible(entry), true);
});

test('opening a professional notification shows it in today and marks it read', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      open: false, replaceChildren() {}, scrollIntoView() { this.scrolled = true; }
    });
    return elements.get(id);
  };
  const id = '0b4a1f2c-1234-4567-8123-123456789abc';
  const requests = [];
  const context = {
    pendingNotificationId: id,
    connectedUser: { role: 'pro', verificationStatus: 'approved' },
    window: { pendingPushNotificationId: '', location: { href: `https://example.test/?notification=${id}` }, history: { replaceState() {} } },
    document: { getElementById: element, createElement: () => ({ append() {} }) },
    URL, switchScreen() {}, makeTextElement: () => ({}), formatDateTime: () => '',
    chargerMessagesAdministration: async () => ({ announcements: [] }),
    seniorLinksRequest: async (path, options) => {
      requests.push([path, options]);
      return { type: 'other', title: 'Rappel', message: 'Information', createdAt: '2026-01-01' };
    },
    chargerNotifications: async () => {},
    showToast: message => { throw new Error(message); }
  };
  vm.runInNewContext(extract('        window.handlePendingNotification = async () => {',
    "        window.addEventListener('generation-notification-opened'"), context);
  await context.window.handlePendingNotification();
  assert.equal(element('notification-opened-pro').scrolled, true);
  assert.equal(requests[1][1].body.read, true);
});

test('opening a safety message notification goes to the automatic messages inbox', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      open: false, replaceChildren() {}, scrollIntoView() { this.scrolled = true; }
    });
    return elements.get(id);
  };
  const id = '0b4a1f2c-1234-4567-8123-123456789abc';
  const screens = [];
  const context = {
    pendingNotificationId: id,
    connectedUser: { role: 'aidant' },
    window: { pendingPushNotificationId: '', location: { href: `https://example.test/?notification=${id}` }, history: { replaceState() {} } },
    document: { getElementById: element, createElement: () => ({ append() {} }) },
    URL, switchScreen: screen => screens.push(screen), makeTextElement: () => ({}), formatDateTime: () => '',
    chargerMessagesAdministration: async () => ({ announcements: [] }),
    seniorLinksRequest: async () => ({ type: 'wellbeing_safety_check', safetyMessageId: 'message', title: 'Alerte', message: 'Alerte', createdAt: '2026-01-01' }),
    chargerNotifications: async () => {},
    showToast: message => { throw new Error(message); }
  };
  vm.runInNewContext(extract('        window.handlePendingNotification = async () => {',
    "        window.addEventListener('generation-notification-opened'"), context);
  await context.window.handlePendingNotification();
  assert.deepEqual(screens, ['messages']);
  assert.equal(element('safety-messages-details').open, true);
  assert.equal(element('safety-messages-details').scrolled, true);
});

test('opening an announcement notification works in the staff workspace', async () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { open: false, scrollIntoView() { this.scrolled = true; } });
    return elements.get(id);
  };
  const id = '0b4a1f2c-1234-4567-8123-123456789abc';
  const context = {
    pendingNotificationId: id,
    connectedUser: { id: 'staff-1', role: 'staff' },
    window: { pendingPushNotificationId: '', location: { href: `https://example.test/?notification=${id}` }, history: { replaceState() {} } },
    document: { getElementById: element },
    URL,
    chargerMessagesAdministration: async () => ({ announcements: [{ id }] }),
    seniorLinksRequest: async () => { throw new Error('Unexpected unrestricted notification request'); },
    showToast: message => { throw new Error(message); }
  };
  vm.runInNewContext(extract('        window.handlePendingNotification = async () => {',
    "        window.addEventListener('generation-notification-opened'"), context);
  await context.window.handlePendingNotification();
  assert.equal(element('admin-announcements-details').open, true);
  assert.equal(element('admin-announcements').scrolled, true);
});

test('today inbox shows received messages and opens the selected conversation', async () => {
  const elements = new Map();
  const node = () => ({
    children: [], textContent: '', value: '', listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    scrollIntoView() { this.scrolled = true; }
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  const opened = [];
  const context = {
    connectedUser: { id: 'aidant', role: 'aidant' }, inboxLoadId: 0,
    window: { generationLiaisonTranslate: value => value },
    document: { getElementById: element, createElement: node },
    planningRequest: async path => path.endsWith('safety-alerts')
      ? { messages: [{ id: 'safety', seniorName: 'Marie', body: 'Alerte', createdAt: '2026-01-02' }] }
      : { hasMore: true, messages: [
        { id: 'latest', senderUserId: 'contact', senderName: 'Camille', body: 'Le plus récent',
          read: true, readAt: '2026-01-03T13:15:00.000Z', unreadCount: 2, createdAt: '2026-01-03T13:00:00.000Z' },
        { id: 'other', senderUserId: 'other-contact', senderName: 'Alex', body: 'Un autre échange',
          read: false, readAt: null, unreadCount: 1, createdAt: '2025-12-31T10:00:00.000Z' }
      ] },
    makeTextElement: (tag, text) => ({ tag, textContent: text }),
    traduireMessageSecurite: text => text,
    formatDateTime: value => `date:${value}`,
    ouvrirNotifications: () => opened.push('messages'),
    chargerCorrespondants: async () => true,
    ouvrirConversation: async (role, id) => { opened.push([role, id]); return true; },
    showToast: message => { throw new Error(message); }
  };
  vm.runInNewContext(extract('    async function ouvrirMessageDepuisBoite(role, message)', '    async function chargerCorrespondants(role)'), context);
  await context.chargerBoiteReception('aidant');
  const [card, safety, other, limitNotice] = element('aidant-today-inbox').children;
  assert.equal(safety.children[0].textContent, 'Message automatique pour Marie');
  await safety.listeners.click();
  assert.equal(element('safety-messages-details').open, true);
  assert.equal(element('safety-messages-details').scrolled, true);
  opened.length = 0;
  assert.equal(card.children[0].textContent, 'Camille');
  assert.equal(card.children[1].textContent, 'Le plus récent');
  assert.match(card.children[2].textContent, /Ouvert le date:2026-01-03T13:15:00\.000Z/);
  assert.match(card.children[2].textContent, /2 messages non lus dans cette conversation/);
  assert.match(card.className, /unread/);
  assert.equal(other.children[0].textContent, 'Alex');
  assert.match(other.className, /unread/);
  assert.match(limitNotice.textContent, /20 conversations les plus récentes/);
  await card.listeners.click();
  assert.deepEqual(opened, ['messages', ['aidant', 'latest']]);
  const load = context.planningRequest;
  context.planningRequest = path => path.endsWith('safety-alerts')
    ? Promise.reject(new Error('Indisponible')) : load(path);
  await context.chargerBoiteReception('aidant');
  assert.equal(element('aidant-today-inbox').children[0].children[0].textContent, 'Camille');
  assert.equal(element('aidant-today-inbox').children.some(child => /messages automatiques n’ont pas pu/.test(child.textContent)), true);
  const retry = element('aidant-today-inbox').children.at(-1);
  assert.equal(retry.textContent, 'Réessayer');
  let finishSafety;
  let safetyRequests = 0;
  context.planningRequest = path => path.endsWith('safety-alerts')
    ? (safetyRequests++, new Promise(resolve => { finishSafety = resolve; })) : load(path);
  const pending = retry.listeners.click();
  assert.equal(retry.disabled, true);
  assert.equal(retry.textContent, 'Chargement des messages…');
  await retry.listeners.click();
  assert.equal(safetyRequests, 1);
  finishSafety({ messages: [{ id: 'safety', seniorName: 'Marie', body: 'Alerte', createdAt: '2026-01-02' }] });
  await pending;
  assert.equal(element('aidant-today-inbox').children.some(child => /pas pu être chargés/.test(child.textContent)), false);
  assert.equal(element('aidant-today-inbox').children[1].children[0].textContent, 'Message automatique pour Marie');
});

test('today inbox distinguishes failed conversations from automatic messages', async () => {
  const elements = new Map();
  const node = () => ({
    children: [], textContent: '', listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) { this.listeners[name] = callback; }
  });
  const element = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  const context = {
    connectedUser: { id: 'aidant', role: 'aidant' }, inboxLoadId: 0,
    window: { generationLiaisonTranslate: value => value },
    document: { getElementById: element, createElement: node },
    planningRequest: async path => {
      if (path.endsWith('safety-alerts')) return { messages: [] };
      throw new Error('Indisponible');
    },
    makeTextElement: (tag, text) => ({ tag, textContent: text })
  };
  vm.runInNewContext(extract('    async function ouvrirMessageDepuisBoite(role, message)', '    async function chargerCorrespondants(role)'), context);
  await context.chargerBoiteReception('aidant');
  const children = element('aidant-today-inbox').children;
  assert.equal(children[0].textContent, 'Les conversations n’ont pas pu être chargées.');
  assert.equal(children[1].textContent, 'Réessayer');
  assert.equal(children.some(child => /Aucun message/.test(child.textContent)), false);
});

test('English inbox translates interface text without changing message content', async () => {
  const nodes = new Map();
  const node = () => ({
    children: [], textContent: '', listeners: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, callback) { this.listeners[name] = callback; }
  });
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  const labels = { 'Non lu': 'Unread', 'Message automatique pour': 'Automatic message for' };
  const context = {
    connectedUser: { id: 'caregiver', role: 'aidant' }, inboxLoadId: 0,
    window: { generationLiaisonTranslate: value => labels[value] || value },
    document: { getElementById: element, createElement: node },
    planningRequest: async path => path.endsWith('safety-alerts')
      ? { messages: [{ seniorName: 'Marie', body: 'Bonjour', createdAt: '2026-01-02' }] }
      : { messages: [{ senderName: 'Camille', body: 'Bonjour', read: false, unreadCount: 1, createdAt: '2026-01-03' }] },
    makeTextElement: (tag, text) => ({ tag, textContent: text }),
    traduireMessageSecurite: text => text,
    formatDateTime: value => value
  };
  vm.runInNewContext(extract('    async function ouvrirMessageDepuisBoite(role, message)', '    async function chargerCorrespondants(role)'), context);
  await context.chargerBoiteReception('aidant');
  const [conversation, automatic] = element('aidant-today-inbox').children;
  assert.equal(conversation.children[1].textContent, 'Bonjour');
  assert.match(conversation.children[2].textContent, /Unread/);
  assert.equal(automatic.children[0].textContent, 'Automatic message for Marie');
  assert.equal(automatic.children[1].textContent, 'Bonjour');
});

test('SMS-style inbox groups private messages by correspondent for every messaging role', async () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const elements = new Map();
    const node = () => ({
      children: [], textContent: '', value: '', listeners: {},
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = [...children]; },
      addEventListener(name, callback) { this.listeners[name] = callback; }
    });
    const element = id => {
      if (!elements.has(id)) elements.set(id, node());
      return elements.get(id);
    };
    const context = {
      connectedUser: { id: role, role }, inboxLoadId: 0,
      window: { generationLiaisonTranslate: value => value },
      document: { getElementById: element, createElement: node },
      planningRequest: async path => path.endsWith('safety-alerts') ? { messages: [] } : { messages: [
          { id: 'latest', senderUserId: 'contact', senderName: 'Camille', body: 'Réponse récente',
            read: true, readAt: '2026-02-02T12:15:00.000Z', unreadCount: 0, createdAt: '2026-02-02T12:00:00.000Z' }
        ] },
      makeTextElement: (tag, text) => ({ tag, textContent: text }),
      formatDateTime: value => `date:${value}`,
      ouvrirNotifications() {},
      chargerCorrespondants: async () => true,
      ouvrirConversation: async () => true,
      showToast() {}
    };
    vm.runInNewContext(extract('    async function ouvrirMessageDepuisBoite(role, message)', '    async function chargerCorrespondants(role)'), context);
    await context.chargerBoiteReception(role);
    const inbox = element(`${role}-today-inbox`);
    assert.equal(inbox.children.length, 1, `${role} should show one thread per correspondent`);
    assert.equal(inbox.children[0].children[0].textContent, 'Camille');
    assert.equal(inbox.children[0].children[1].textContent, 'Réponse récente');
    assert.match(inbox.children[0].children[2].textContent, /Ouvert le date:2026-02-02T12:15:00\.000Z/);
  }
});

test('messages are inside today without a notifications section for each role', () => {
  for (const role of ['senior', 'aidant', 'pro']) {
    const start = source.indexOf(`<div id="home-informations-${role}"`);
    const end = source.indexOf(role === 'senior' ? '<section class="form-card" id="senior-home-links"' : role === 'aidant'
      ? '<section class="form-card" id="aidant-home-links"' : '<details class="senior-disclosure" data-close-on-mouse-leave>', start);
    const screen = source.slice(start, end);
    const inbox = screen.indexOf(`id="${role}-today-inbox"`);
    const section = screen.lastIndexOf('<section', inbox);
    assert.ok(section >= 0 && inbox > section);
    assert.match(screen.slice(section, inbox), /Aujourd’hui/);
    assert.doesNotMatch(screen, /<h[23]>[^<]*notifications/i);
    if (role === 'aidant') {
      assert.match(screen, /<\/div>\s*<h3>Messages reçus<\/h3>/);
    }
  }
});

test('today messages scroll without an on-screen history', () => {
  assert.match(source, /\.today-inbox-list\s*\{[^}]*max-height:\s*22rem;[^}]*overflow-y:\s*auto;/);
  for (const role of ['senior', 'aidant', 'pro']) {
    const start = source.indexOf(`<div id="home-informations-${role}"`);
    const end = source.indexOf(role === 'senior' ? '<section class="form-card" id="senior-home-links"' : role === 'aidant'
      ? '<section class="form-card" id="aidant-home-links"' : '<details class="senior-disclosure" data-close-on-mouse-leave>', start);
    const screen = source.slice(start, end);
    assert.doesNotMatch(screen, /Historique des 30 derniers jours/);
    assert.match(screen, new RegExp(`id="${role}-today-inbox"[^>]*role="region"[^>]*tabindex="0"`));
  }
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
