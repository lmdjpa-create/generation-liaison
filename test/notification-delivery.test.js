const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'notification-delivery.js'), 'utf8');

async function deliverSms(enabled, reminderStillValid = null) {
  const sends = [];
  const updates = [];
  let tick;
  const env = {
    TWILIO_ACCOUNT_SID: 'test', TWILIO_AUTH_TOKEN: 'test', TWILIO_FROM_NUMBER: '+33123456789',
    PUBLIC_APP_URL: 'https://example.test'
  };
  const row = {
    id: 'delivery', notification_id: 'notification-id', user_id: 'user',
    channel: 'sms', attempts: 0, title: 'Nouveau message',
    notification_phone: '+33612345678', sms_notifications_enabled: enabled
  };
  if (reminderStillValid !== null) {
    row.notification_type = 'task_reminder';
    row.entity_id = 'task';
  }
  let claimed = false;
  const pool = {
    async connect() {
      return {
        async query(sql) {
          if (sql.includes('SELECT delivery.id')) {
            if (claimed) return { rows: [] };
            claimed = true;
            return { rows: [row] };
          }
          return { rows: [] };
        },
        release() {}
      };
    },
    async query(sql, params) {
      if (sql.includes('FROM app_shared_tasks task')) {
        return { rows: reminderStillValid ? [{}] : [] };
      }
      updates.push(params);
      return { rows: [] };
    }
  };
  const mocks = {
    'firebase-admin/app': {},
    'firebase-admin/messaging': {},
    'web-push': {},
    twilio: () => ({ messages: { create: async message => sends.push(message) } }),
    resend: {}
  };
  const context = {
    require: name => mocks[name],
    process: { env },
    module: { exports: {} },
    URL,
    console,
    setInterval: callback => { tick = callback; return { unref() {} }; }
  };
  vm.runInNewContext(source, context);
  context.module.exports.startDeliveryWorker(pool);
  await tick();
  return { sends, updates };
}

test('SMS notification uses an authenticated app link without including the message content', async () => {
  const { sends, updates } = await deliverSms(true);
  assert.equal(sends.length, 1);
  assert.match(sends[0].body, /https:\/\/example\.test\/app-mobile\.html\?notification=notification-id/);
  assert.match(sends[0].body, /Connectez-vous/);
  assert.equal(updates[0][1], 'sent');
});

test('SMS is not sent when the recipient has not opted in', async () => {
  const { sends, updates } = await deliverSms(false);
  assert.equal(sends.length, 0);
  assert.equal(updates[0][1], 'skipped');
});

test('queued task reminders are skipped after access or eligibility changes', async () => {
  const { sends, updates } = await deliverSms(true, false);
  assert.equal(sends.length, 0);
  assert.equal(updates[0][1], 'skipped');
});

test('external notifications use fixed text across channels while keeping urgent alerts identifiable', async () => {
  const sent = { native: [], web: [], sms: [], email: [] };
  const mocks = {
    'firebase-admin/app': { applicationDefault: () => ({}), getApps: () => [{}] },
    'firebase-admin/messaging': {
      getMessaging: () => ({
        sendEachForMulticast: async payload => {
          sent.native.push(payload);
          return { responses: [{ success: true }], failureCount: 0 };
        }
      })
    },
    'web-push': {
      setVapidDetails() {},
      sendNotification: async (_, payload) => sent.web.push(JSON.parse(payload))
    },
    twilio: () => ({ messages: { create: async payload => sent.sms.push(payload) } }),
    resend: { Resend: class { constructor() { this.emails = { send: async payload => { sent.email.push(payload); return {}; } }; } } }
  };
  const context = {
    require: name => mocks[name],
    process: { env: {
      TWILIO_ACCOUNT_SID: 'test', TWILIO_AUTH_TOKEN: 'test', TWILIO_FROM_NUMBER: '+33123456789',
      RESEND_API_KEY: 'test', NOTIFICATIONS_FROM_EMAIL: 'notifications@example.test',
      WEB_PUSH_PUBLIC_KEY: 'test', WEB_PUSH_PRIVATE_KEY: 'test', WEB_PUSH_SUBJECT: 'mailto:test@example.test',
      PUBLIC_APP_URL: 'https://example.test'
    } },
    module: { exports: {} }, URL, console
  };
  vm.runInNewContext(`${source}\nglobalThis.testDeliver = deliver;`, context);
  const delivery = {
    title: 'Secret personnel : Alice',
    notification_id: 'notification-id',
    notification_type: 'private_message',
    subscriptions: [
      { platform: 'android', token: 'native-token' },
      { id: 'web-id', platform: 'web', token: JSON.stringify({ endpoint: 'https://example.test' }) }
    ],
    pool: { query: async () => ({ rows: [] }) },
    sms_enabled: true, phone: '+33612345678', email_enabled: true, email: 'user@example.test'
  };
  for (const channel of ['push', 'sms', 'email']) {
    assert.equal(await context.testDeliver({ ...delivery, channel }), true);
  }
  const output = JSON.stringify(sent);
  assert.doesNotMatch(output, /Secret personnel|Alice/);
  assert.match(sent.sms[0].body, /notification=notification-id/);
  assert.match(sent.email[0].text, /notification=notification-id/);
  assert.equal(sent.native[0].data.notificationId, 'notification-id');
  assert.equal(sent.web[0].data.notificationId, 'notification-id');
  assert.equal(sent.native[0].notification.title, 'Génération Liaison');
  assert.equal(sent.web[0].title, 'Génération Liaison');
  await context.testDeliver({ ...delivery, channel: 'push', notification_type: 'emergency_alert' });
  assert.equal(sent.native[1].notification.title, 'Alerte d’urgence');
  assert.equal(sent.web[1].title, 'Alerte d’urgence');
  await context.testDeliver({ ...delivery, channel: 'sms', notification_type: 'wellbeing_safety_check' });
  assert.match(sent.sms[1].body, /^Vérification de sécurité sans réponse/);
});
