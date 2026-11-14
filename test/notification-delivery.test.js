const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'notification-delivery.js'), 'utf8');

async function deliverSms(enabled) {
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
