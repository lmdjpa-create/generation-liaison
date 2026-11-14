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

test('a new day re-enables the senior check-in form', () => {
  const elements = {
    'wellbeing-checkin-form': { hidden: true },
    'wellbeing-checkin-submit': { disabled: true },
    'wellbeing-checkin-result': { hidden: false, replaceChildren() {} }
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

test('senior notifications and messages start collapsed immediately after emergency controls', () => {
  const emergency = source.indexOf('<section class="form-card emergency-call-card"');
  const panel = source.indexOf('<section class="form-card" id="notifications-panel-senior"');
  const wellbeing = source.indexOf('<section class="form-card" id="wellbeing-checkin-panel"');
  assert.ok(emergency >= 0 && emergency < panel && panel < wellbeing);
  assert.match(source, /<details class="senior-disclosure" id="notifications-list-senior">/);
  assert.match(source, /<details class="senior-disclosure" id="messages-senior">/);
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
