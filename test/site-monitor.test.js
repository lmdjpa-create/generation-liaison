const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createSiteMonitor, siteArea } = require('../site-monitor');

test('site monitoring keeps only anonymous aggregate counts in a bounded window', () => {
  let time = Date.parse('2026-01-01T10:00:00Z');
  const monitor = createSiteMonitor(() => time);
  monitor.record(200);
  monitor.record(401, siteArea('/api/auth/login'));
  monitor.record(503, siteArea('/api/messages/private-person-id'));
  monitor.record(500, 'private-person-id');
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.windowMinutes, 15);
  assert.equal(snapshot.observedSince, '2026-01-01T10:00:00.000Z');
  assert.equal(snapshot.requests, 4);
  assert.equal(snapshot.clientErrors, 1);
  assert.equal(snapshot.serverErrors, 2);
  assert.deepEqual(snapshot.byArea.connexion, { requests: 1, clientErrors: 1, serverErrors: 0 });
  assert.deepEqual(snapshot.byArea.messagerie, { requests: 1, clientErrors: 0, serverErrors: 1 });
  assert.deepEqual(snapshot.byArea.autres, { requests: 2, clientErrors: 0, serverErrors: 1 });
  assert.doesNotMatch(JSON.stringify(snapshot), /private-person-id|\/api\//);
  time += 15 * 60000;
  assert.equal(monitor.snapshot().requests, 0);
});

test('functional areas use exact fixed route prefixes rather than arbitrary paths', () => {
  assert.equal(siteArea('/api/planning/calendar'), 'agenda');
  assert.equal(siteArea('/api/notifications'), 'notifications');
  assert.equal(siteArea('/api/directory/bookings/identifier'), 'annuaire');
  assert.equal(siteArea('/api/messages-unknown/identifier'), 'autres');
  assert.equal(siteArea('/api/unknown/personal-name'), 'autres');
});

test('administrator display identifies affected areas and clears stale data on failure', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = source.indexOf('    async function loadSiteMonitor()');
  const end = source.indexOf("    document.getElementById('site-monitor-review')", start);
  assert.ok(start >= 0 && end > start);
  const status = { textContent: '' };
  const container = {
    children: [], replaceChildren() { this.children = []; },
    append(element) { this.children.push(element); }
  };
  let fails = false;
  const context = {
    document: {
      getElementById: id => id === 'site-monitor-status' ? status : container,
      createElement: () => ({ textContent: '' })
    },
    adminRequest: async () => {
      if (fails) throw new Error('Indisponible');
      return {
        requests: 4, clientErrors: 1, serverErrors: 1, observedSince: '2026-01-01T10:00:00Z',
        byArea: {
          connexion: { requests: 1, clientErrors: 1, serverErrors: 0 },
          messagerie: { requests: 3, clientErrors: 0, serverErrors: 1 }
        }
      };
    },
    formatDate: () => '10:00'
  };
  vm.runInNewContext(source.slice(start, end), context);
  await context.loadSiteMonitor();
  assert.match(status.textContent, /4 requêtes API/);
  assert.equal(container.children.length, 2);
  assert.match(container.children[1].textContent, /Messagerie et assistant : 1 réponses 5xx/);
  fails = true;
  await context.loadSiteMonitor();
  assert.equal(status.textContent, 'Indisponible');
  assert.equal(container.children.length, 0);
});
