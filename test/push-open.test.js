const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'push-service-worker.js'), 'utf8');

async function click(clients) {
  const listeners = {};
  const calls = [];
  const self = {
    location: { origin: 'https://example.test' },
    clients: {
      matchAll: async () => clients,
      openWindow: async url => calls.push(['open', url])
    },
    addEventListener: (type, handler) => { listeners[type] = handler; }
  };
  vm.runInNewContext(source, { self, URL });
  let work;
  listeners.notificationclick({
    notification: { data: { notificationId: 'message-id' }, close: () => calls.push(['close']) },
    waitUntil: promise => { work = promise; }
  });
  await work;
  return calls;
}

test('a push tap focuses the existing app and forwards the notification identifier', async () => {
  const calls = [];
  const client = {
    url: 'https://example.test/app-mobile.html?calendar=connected',
    postMessage: message => calls.push([message.type, message.notificationId]),
    focus: () => calls.push(['focus'])
  };
  await click([client]);
  assert.deepEqual(calls, [['notification-opened', 'message-id'], ['focus']]);
});

test('a push tap opens the app with its notification identifier when no app is open', async () => {
  assert.deepEqual(await click([]), [
    ['close'],
    ['open', 'https://example.test/app-mobile.html?notification=message-id']
  ]);
});
