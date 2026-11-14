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

test('message contacts show premium requirements per contact instead of per account', async () => {
  const select = {
    value: '', options: [],
    replaceChildren(option) { this.options = [option]; },
    add(option) { this.options.push(option); }
  };
  const status = { textContent: '' };
  const context = {
    connectedUser: { id: 'senior', role: 'senior' },
    document: { getElementById: id => id.startsWith('message-contact-') ? select : status },
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
  assert.match(select.options[2].text, /premium requis/);
  assert.equal(status.textContent, '');
});

test('senior settings remain accessible from navigation without a dashboard shortcut', () => {
  const dashboard = extract('<div id="main-app-senior"', '<!-- 👨‍👩‍👧 2. INTERFACE AIDANT -->');
  assert.doesNotMatch(dashboard, /switchScreen\('settings'\)/);
  assert.match(source, /<button id="nav-settings"[^>]*onclick="switchScreen\('settings'\)"/);
});

test('companionship and daily services shortcuts are available alongside the directory', () => {
  const tiles = extract('        <div class="action-tiles">', '        <section class="form-card emergency-call-card"');
  assert.match(tiles, /ouvrirSectionSenior\('senior-assistant-details', 'assistant-chat-panel'\)/);
  assert.match(tiles, /ouvrirSectionSenior\('senior-services-details', 'senior-service-area'\)/);
  assert.match(tiles, /switchScreen\('directory'\)/);
  assert.doesNotMatch(tiles, /Mon agenda/);
  assert.match(source, /<button[^>]*onclick="switchScreen\('agenda'\)"[^>]*>Voir l’agenda<\/button>/);
});

test('senior feature tiles keep their content collapsed and shortcuts open their destinations', () => {
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
    assert.ok(source.includes(`ouvrirSectionSenior('${details}', '${target}')`));
    context.openSection(details, target);
    assert.equal(element(details).open, true);
    assert.equal(element(target).scrolled, true);
  }
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
    '        <section class="form-card" style="text-align:left;">');
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

test('senior notifications and messages start collapsed immediately after emergency controls', () => {
  const emergency = source.indexOf('<section class="form-card emergency-call-card"');
  const panel = source.indexOf('<section class="form-card" id="notifications-panel-senior"');
  const wellbeing = source.indexOf('<section class="form-card" id="wellbeing-checkin-panel"');
  assert.ok(emergency >= 0 && emergency < panel && panel < wellbeing);
  assert.match(source, /<details class="senior-disclosure" id="notifications-list-senior">/);
  assert.match(source, /<details class="senior-disclosure" id="messages-senior">/);
});

test('device notifications can be enabled directly in each account settings', () => {
  const section = extract('<section class="form-card" id="notifications-panel-senior"', '<section class="form-card" id="wellbeing-checkin-panel"');
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
  assert.match(emergency, /<details class="senior-disclosure senior-explanation">\s*<summary>Explications sur l’appel<\/summary>/);
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

test('explanations open after two seconds of hover and remain usable without hover', () => {
  const summary = { listeners: {}, addEventListener(type, handler) { this.listeners[type] = handler; } };
  const details = {
    open: false, listeners: {},
    querySelector: () => summary,
    addEventListener(type, handler) { this.listeners[type] = handler; }
  };
  const timers = new Map();
  let nextId = 0;
  const context = {
    document: { querySelectorAll: () => [details] },
    setTimeout: (callback, delay) => { timers.set(++nextId, { callback, delay }); return nextId; },
    clearTimeout: id => timers.delete(id)
  };
  vm.runInNewContext(
    `${extract('    function configurerExplicationsSenior()', '    function ouvrirAgenda()')}\n` +
    'globalThis.configure = configurerExplicationsSenior;', context
  );
  context.configure();
  summary.listeners.pointerenter({ pointerType: 'mouse' });
  assert.equal(details.open, false);
  assert.equal(timers.get(1).delay, 2000);
  summary.listeners.pointerleave();
  assert.equal(timers.size, 0);
  summary.listeners.pointerenter({ pointerType: 'touch' });
  assert.equal(timers.size, 0);
  summary.listeners.pointerenter({ pointerType: 'mouse' });
  timers.get(2).callback();
  assert.equal(details.open, true);
  details.open = false;
  summary.listeners.pointerenter({ pointerType: 'mouse' });
  details.open = true;
  details.listeners.toggle();
  assert.equal(timers.has(3), false);
});

test('the notification navigation opens the senior notification list', () => {
  const panel = { scrollIntoView() { this.scrolled = true; } };
  const list = { open: false };
  const context = {
    connectedUser: { role: 'senior' },
    switchScreen() {},
    document: { getElementById: id => id === 'notifications-list-senior' ? list : panel }
  };
  vm.runInNewContext(
    `${extract('    function ouvrirNotifications()', '    function configurerExplicationsSenior()')}\n` +
    'globalThis.openNotifications = ouvrirNotifications;', context
  );
  context.openNotifications();
  assert.equal(list.open, true);
  assert.equal(panel.scrolled, true);
});

test('opening a senior message notification expands its notification and conversation', async () => {
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
    switchScreen() {},
    seniorLinksRequest: async () => ({
      type: 'private_message', senderUserId: 'contact', entityId: 'message',
      title: 'Message', message: 'Bonjour', createdAt: '2026-01-01'
    }),
    makeTextElement: () => ({}),
    formatDateTime: () => '',
    chargerCorrespondants: async () => true,
    ouvrirConversation: async (role, focus) => { calls.push([role, focus]); return true; },
    showToast: message => { throw new Error(message); }
  };
  vm.runInNewContext(
    extract('        window.handlePendingNotification = async () => {',
      "        window.addEventListener('generation-notification-opened'"), context
  );
  await context.window.handlePendingNotification();
  assert.equal(element('notifications-list-senior').open, true);
  assert.equal(element('messages-senior').open, true);
  assert.equal(element('messages-senior').scrolled, true);
  assert.deepEqual(calls, [['senior', 'message']]);
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
    hasPremiumAccess: () => true,
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
  context.hasPremiumAccess = () => false;
  await context.callContact({ id: 'contact-1', name: 'Contact' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].success, false);
  assert.match(calls[0].message, /premium/);

  calls.length = 0;
  context.hasPremiumAccess = () => true;
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
