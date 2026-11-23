const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

test('administrator confirms a pending request and refreshes without losing an unfinished note', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = source.indexOf('    async function loadSeniorLinkRequests()');
  const end = source.indexOf('    async function loadSeniorLinkRemovals()', start);
  const emailStart = source.indexOf('    function emailNode(');
  const emailEnd = source.indexOf('    function addContactCell(', emailStart);
  assert.ok(start !== -1 && end > start);
  assert.ok(emailStart !== -1 && emailEnd > emailStart);
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.value = ''; this.checked = false; this.handlers = {}; }
    append(...children) { for (const child of children) { this.children.push(child); if (typeof child === 'object') child.parent = this; } }
    replaceChildren() { this.children = []; }
    remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    contains(target) { return this === target || this.children.some(child => typeof child === 'object' && child.contains(target)); }
    querySelectorAll(selector) {
      return this.children.flatMap(child => typeof child === 'object'
        ? [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)] : []);
    }
    querySelector(selector) {
      return selector === 'input[type="checkbox"]:checked'
        ? this.querySelectorAll('input').find(input => input.type === 'checkbox' && input.checked) : null;
    }
  }
  const container = new Element('div');
  const requests = [{ id: 'request-id', aidant_name: '<test>', aidant_email: 'aidant@example.test',
    senior_name: 'Senior', senior_email: 'senior@example.test' }];
  const calls = [];
  let release;
  const context = {
    document: {
      activeElement: null,
      getElementById: () => container,
      createElement: tag => new Element(tag),
      createTextNode: text => text
    },
    window: { generationLiaisonTranslate: text => text, confirm: () => true },
    adminRequest: async (url, options) => {
      calls.push({ url, options });
      if (options) return {};
      if (release) return new Promise(resolve => { release = () => resolve({ requests }); });
      return { requests };
    },
    loadOverview: async () => {},
    setStatus: () => {},
    encodeURIComponent
  };
  vm.runInNewContext(`${source.slice(emailStart, emailEnd)}\n${source.slice(start, end)}\nthis.load = loadSeniorLinkRequests;`, context);
  await context.load();
  const item = container.children[0];
  assert.match(item.children[0].children[0], /<test>/);
  assert.equal(item.children[0].children[1].href, 'mailto:aidant%40example.test');
  assert.equal(item.children[0].children[3].href, 'mailto:senior%40example.test');
  const form = item.children[1];
  const note = form.querySelectorAll('textarea')[0];
  const checkbox = form.querySelectorAll('input')[0];
  assert.equal(note.required, true);
  assert.equal(checkbox.required, true);
  release = () => {};
  const refreshing = context.load();
  note.value = 'Accord vérifié directement par téléphone.';
  release();
  await refreshing;
  assert.equal(container.children[0], item);
  await context.load();
  assert.equal(calls.length, 2);
  checkbox.checked = true;
  await form.handlers.submit({ preventDefault() {} });
  assert.equal(calls[2].url, '/api/admin/senior-link-requests/request-id/confirm');
  assert.equal(calls[2].options.body.confirmed, true);
  assert.equal(calls[2].options.body.note, note.value);
  assert.equal(container.children.length, 0);
});

test('account access and subscription controls are collapsed without changing their actions', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = source.indexOf('    function renderAccounts(accounts, limits)');
  const end = source.indexOf('    async function ', start);
  assert.ok(start >= 0 && end > start);
  const node = tag => ({
    tag, children: [], style: {}, handlers: {}, open: false, value: '',
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute() {},
    addEventListener(event, callback) { this.handlers[event] = callback; }
  });
  const tbody = node('tbody');
  const limit = node('p');
  const calls = [];
  const context = {
    document: {
      createElement: node,
      getElementById: id => id === 'accounts-body' ? tbody : limit
    },
    window: { generationLiaisonTranslate: text => text, generationLiaisonLocale: () => 'fr-FR' },
    roleLabels: {}, addCell: row => row.append(node('td')),
    emailNode: () => node('a'),
    updateAccount: account => calls.push(['account', account.id]),
    initiateAccountClosure: account => calls.push(['closure', account.id]),
    updatePremium: (account, value) => calls.push(['premium', account.id, value]),
    Date
  };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.render = renderAccounts;`, context);
  const account = { id: 'one', role: 'senior', active: true, premiumActive: false,
    teamCount: 0, createdAt: '2026-01-01' };
  context.render([account], {});
  const action = tbody.children[0].children[7];
  assert.equal(action.children[0].textContent, 'Actif');
  const access = action.children[1];
  const subscription = action.children[3];
  assert.equal(access.open, false);
  assert.equal(access.children[0].textContent, 'Gérer l’accès au compte');
  assert.equal(subscription.open, false);
  assert.equal(subscription.children[0].textContent, 'Gérer l’abonnement');
  access.children[1].handlers.click();
  access.children[2].handlers.click();
  const controls = subscription.children[1].children;
  controls[0].value = 'month';
  controls[1].handlers.click();
  assert.deepEqual(calls, [['account', 'one'], ['closure', 'one'], ['premium', 'one', 'month']]);
  context.render([{ ...account, administrator: true }], {});
  assert.equal(tbody.children[0].children[7].children.some(child =>
    child.tag === 'details' && child.children[0].textContent === 'Gérer l’accès au compte'), false);
});
