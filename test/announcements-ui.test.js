const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

function node(tag = 'div') {
  return {
    tag, children: [], style: {}, textContent: '', listeners: {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener(type, handler) { this.listeners[type] = handler; }
  };
}

test('announcements display as text and can be marked read without senior-profile headers', async () => {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  const calls = [];
  const item = { id: 'notice-1', title: '<script>titre</script>', message: '<img src=x>', type: 'establishment_announcement', read: false, createdAt: '2026-01-01' };
  const context = {
    connectedUser: { id: 'resident', role: 'senior' }, announcementLoadId: 0,
    window: { generationLiaisonTranslate: text => text },
    document: { getElementById: get, createElement: node },
    makeTextElement: (tag, text) => Object.assign(node(tag), { textContent: text }),
    formatDateTime: value => value,
    seniorLinksRequest: async (url, options) => {
      calls.push({ url, options });
      if (options) item.read = true;
      return options ? { read: true } : { announcements: [item] };
    }
  };
  const start = source.indexOf('    async function chargerMessagesAdministration()');
  const end = source.indexOf('    async function chargerNotifications()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  await context.chargerMessagesAdministration();
  const card = get('admin-announcements-list').children[0];
  assert.equal(card.children[0].textContent, 'Votre établissement');
  assert.equal(card.children[1].textContent, '<script>titre</script>');
  assert.equal(card.children[2].textContent, '<img src=x>');
  assert.match(get('admin-announcements-summary').textContent, /1 non lu/);
  await card.children[4].listeners.click();
  assert.equal(calls[1].url, '/api/announcements/notice-1');
  assert.equal(calls[1].options.body.read, true);
  assert.doesNotMatch(get('admin-announcements-summary').textContent, /non lu/);
});

test('announcement responses from a previous account are discarded', async () => {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, node());
    return elements.get(id);
  };
  let release;
  const context = {
    connectedUser: { id: 'first', role: 'senior' }, announcementLoadId: 0,
    document: { getElementById: get, createElement: node },
    seniorLinksRequest: () => new Promise(resolve => { release = resolve; })
  };
  const start = source.indexOf('    async function chargerMessagesAdministration()');
  const end = source.indexOf('    async function chargerNotifications()', start);
  vm.runInNewContext(source.slice(start, end), context);
  const loading = context.chargerMessagesAdministration();
  context.connectedUser = { id: 'second', role: 'staff' };
  release({ announcements: [{ title: 'Private' }] });
  await loading;
  assert.equal(get('admin-announcements-list').children.length, 0);
});
