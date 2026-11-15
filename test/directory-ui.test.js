const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

function setup() {
  const elements = new Map();
  function makeElement(tag = 'div') {
    const element = {
      tag, id: '', textContent: '', value: '', children: [], events: {}, className: '',
      classList: { add(name) { element.className += ` ${name}`; } },
      append(...children) { children.forEach(child => { child.parent = this; }); this.children.push(...children); },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      remove() { this.parent.children = this.parent.children.filter(child => child !== this); },
      querySelector(selector) { return this.children.find(child => child.className.split(' ').includes(selector.slice(1))) || null; },
      addEventListener(type, handler) { this.events[type] = handler; }
    };
    return element;
  }
  const results = makeElement();
  elements.set('directory-results', results);
  elements.set('shared-directory-results', makeElement());
  for (const id of ['directory-search-query', 'directory-search-city', 'directory-search-postcode', 'directory-search-radius']) {
    elements.set(id, makeElement());
  }
  elements.get('directory-search-radius').value = '30';
  const document = {
    createElement: makeElement,
    getElementById(id) {
      return elements.get(id) || results.children.find(child => child.id === id);
    }
  };
  const context = {
    document, directoryOffset: 0, directoryLoadId: 0, directorySearchParams: null,
    sharedDirectoryLoadId: 0, directoryLocation: null,
    window: { generationLiaisonTranslate: value => value },
    makeTextElement(tag, text, className = '') {
      const element = makeElement(tag);
      element.textContent = text;
      element.className = className;
      return element;
    },
    creerCarteAnnuaire: professional => {
      const card = makeElement('article');
      card.textContent = professional.name;
      return card;
    },
    showToast() {}
  };
  const start = source.indexOf('    async function chargerAnnuaire(offset = 0');
  const end = source.indexOf('    function creerCarteAnnuaire(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(`${source.slice(start, end)}
    globalThis.search = chargerAnnuaire;
    globalThis.loadShared = chargerAnnuairePartage;
    globalThis.sharedButton = boutonAnnuairePartage;
    globalThis.resetShared = reinitialiserAnnuairePartage;`, context);
  return { context, elements, results };
}

test('search separates unverified results, preserves them across pages, and reports public failure', async () => {
  const { context, elements, results } = setup();
  const calls = [];
  context.planningRequest = async (path, options) => {
    calls.push(options.body);
    if (calls.length === 1) return {
      professionals: [{ name: 'Vérifié' }, { name: 'Extérieur', external: true }],
      publicDirectoryStatus: 'unavailable', localityStatus: 'available', hasMore: true, nextOffset: 1
    };
    return { professionals: [{ name: 'Deuxième' }], hasMore: false, nextOffset: null };
  };
  elements.get('directory-search-query').value = 'ancienne recherche';
  await context.search();
  assert.match(results.children[0].textContent, /indisponible/);
  const verified = results.children[1];
  const others = results.children[2];
  assert.equal(verified.children[0].textContent, 'Professionnels vérifiés');
  assert.equal(verified.children[1].textContent, 'Vérifié');
  assert.match(others.children[1].textContent, /hors du rayon/);
  assert.equal(others.children[2].textContent, 'Extérieur');
  elements.get('directory-search-query').value = 'nouvelle recherche';
  await verified.children[2].events.click();
  assert.equal(calls[1].q, 'ancienne recherche');
  assert.equal(calls[1].offset, 1);
  assert.equal(verified.children[2].textContent, 'Deuxième');
  assert.equal(results.children[2], others);
});

test('pagination errors leave existing results and retry available', async () => {
  const { context, results } = setup();
  let page = 0;
  context.planningRequest = async () => {
    if (page++ === 0) return {
      professionals: [{ name: 'Vérifié' }, { name: 'Extérieur', external: true }],
      publicDirectoryStatus: 'available', hasMore: true, nextOffset: 1
    };
    if (page === 2) throw new Error('Erreur de chargement');
    return { professionals: [{ name: 'Suivant' }], hasMore: false };
  };
  await context.search();
  const verified = results.children[0];
  const others = results.children[1];
  const button = verified.children[2];
  await button.events.click();
  assert.equal(verified.children[1].textContent, 'Vérifié');
  assert.equal(verified.children[3].textContent, 'Erreur de chargement');
  assert.equal(others.children[2].textContent, 'Extérieur');
  await button.events.click();
  assert.equal(verified.children[2].textContent, 'Suivant');
  assert.equal(verified.children.length, 3);
});

test('shared-directory buttons add or remove a verified professional and reload the list', async () => {
  const { context } = setup();
  const requests = [];
  context.planningRequest = async (path, options) => {
    requests.push({ path, method: options?.method });
    return path === '/api/shared-directory' ? { professionals: [] } : {};
  };
  await context.sharedButton('professional-id', false).events.click();
  await context.sharedButton('professional-id', true).events.click();
  assert.deepEqual(requests.map(request => [request.path, request.method]), [
    ['/api/shared-directory/professional-id', 'POST'], ['/api/shared-directory', undefined],
    ['/api/shared-directory/professional-id', 'DELETE'], ['/api/shared-directory', undefined]
  ]);
});

test('stale searches and shared-directory responses cannot replace newer results', async () => {
  const { context, elements, results } = setup();
  let resolveSearch;
  context.planningRequest = () => new Promise(resolve => { resolveSearch = resolve; });
  const oldSearch = context.search();
  context.planningRequest = async () => ({
    professionals: [], localityStatus: 'unavailable', publicDirectoryStatus: 'not_requested', hasMore: false
  });
  await context.search();
  resolveSearch({ professionals: [{ name: 'Ancien résultat' }], hasMore: false });
  await oldSearch;
  assert.match(results.children[0].textContent, /GPS/);
  assert.match(results.children[1].children[1].textContent, /Aucun professionnel vérifié/);
  assert.match(results.children[2].children[2].textContent, /Aucun autre résultat/);

  let resolveShared;
  context.planningRequest = () => new Promise(resolve => { resolveShared = resolve; });
  const oldShared = context.loadShared();
  context.resetShared();
  context.planningRequest = async () => ({ professionals: [{ id: 'new', name: 'Nouveau profil' }] });
  await context.loadShared();
  resolveShared({ professionals: [{ id: 'old', name: 'Ancien profil' }] });
  await oldShared;
  assert.equal(elements.get('shared-directory-results').children[0].textContent, 'Nouveau profil');
});
