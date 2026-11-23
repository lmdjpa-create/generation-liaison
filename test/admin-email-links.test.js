const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
const start = source.indexOf('    function addCell(');
const end = source.indexOf('    function renderEmpty(', start);
assert.ok(start !== -1 && end > start);

function makeContext() {
  const document = {
    createElement(tag) {
      return { tag, children: [], append(...nodes) { this.children.push(...nodes); } };
    },
    createTextNode(text) { return { textContent: text }; }
  };
  const context = { document };
  vm.runInNewContext(`${source.slice(start, end)}\nthis.emailNode = emailNode; this.addContactCell = addContactCell;`, context);
  return context;
}

test('email links open the selected recipient without injecting mail headers', () => {
  const { emailNode } = makeContext();
  const link = emailNode('  person+family@example.test  ');
  assert.equal(link.textContent, 'person+family@example.test');
  assert.equal(link.href, 'mailto:person%2Bfamily%40example.test');
  const special = emailNode('person?subject=wrong@example.test');
  assert.equal(special.href, 'mailto:person%3Fsubject%3Dwrong%40example.test');
  assert.equal(emailNode('not-an-email').tag, undefined);
  assert.equal(emailNode('person@example.test\nBcc:other@example.test').tag, undefined);
  assert.equal(emailNode(null).textContent, '—');
  assert.equal(emailNode('\ud800@example.test').tag, undefined);
});

test('contact cells retain their labels and provide clickable secondary addresses', () => {
  const { addContactCell } = makeContext();
  const row = { children: [], append(node) { this.children.push(node); } };
  addContactCell(row, 'Entreprise', 'contact@example.test', 'Compte');
  assert.equal(row.children[0].textContent, 'Entreprise');
  const detail = row.children[0].children[0];
  assert.equal(detail.children[0].textContent, 'Compte');
  assert.equal(detail.children[1].textContent, ' · ');
  assert.equal(detail.children[2].href, 'mailto:contact%40example.test');
  assert.match(source, /emailCell\.append\(emailNode\(account\.email\)\)/);
});
