const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
const start = source.indexOf('    let centresInteret = null;');
const end = source.indexOf('    function afficherAvatarProfil()', start);
assert.ok(start >= 0 && end > start);

function setup() {
  const nodes = new Map();
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      hidden: false, innerHTML: '', textContent: '',
      style: {},
      classList: {
        values: new Set(),
        toggle(name, enabled) { if (enabled) this.values.add(name); else this.values.delete(name); },
        contains(name) { return this.values.has(name); }
      },
      setAttribute(name, value) { this[name] = value; },
      replaceChildren() { this.innerHTML = ''; },
      querySelectorAll() { return []; },
      querySelector(selector) {
        if (selector.startsWith('textarea')) return this.textarea || (this.textarea = { value: '' });
        return this.status || (this.status = { textContent: '' });
      }
    });
    return nodes.get(id);
  }
  const context = {
    document: { getElementById: node },
    window: { generationLiaisonTranslate: value => value },
    connectedUser: { id: 'one', role: 'senior' },
    SERVER_URL: '',
    dateRecetteAffichee: '',
    dateCheckinBienEtre: () => '2026-03-28',
    actualiserRecetteDuJour() {},
    authHeaders: flag => { assert.equal(flag, false); return {}; },
    readResponse: async response => {
      if (!response.ok) throw new Error('Échec');
      return response.data;
    },
    console: { error() {} },
    fetch: async () => ({ ok: true, data: { interests: null, text: '' } })
  };
  vm.runInNewContext(`${source.slice(start, end)}
    globalThis.current = () => centresInteret;
  `, context);
  return { context, node };
}

function form(values, text = '') {
  const button = { disabled: false };
  const status = { textContent: '' };
  return {
    button, status,
    querySelectorAll() { return values.map(value => ({ value })); },
    querySelector(selector) {
      if (selector.startsWith('textarea')) return { value: text };
      return selector.includes('button') ? button : status;
    }
  };
}

test('first answer hides the questionnaire and settings remain available', async () => {
  const { context, node } = setup();
  await context.chargerCentresInteret(context.connectedUser);
  assert.equal(node('interests-onboarding-senior').hidden, false);
  assert.equal(node('settings-interests').hidden, false);
  assert.match(node('interests-onboarding-senior').innerHTML, /Que souhaitez-vous découvrir/);
  context.fetch = async (url, options) => {
    assert.equal(url, '/api/account/daily-interests');
    assert.deepEqual(JSON.parse(options.body), { interests: ['nature', 'musique'], text: '' });
    return { ok: true, data: { interests: ['nature', 'musique'], text: '' } };
  };
  await context.enregistrerCentresInteret(form(['nature', 'musique']));
  assert.equal(node('interests-onboarding-senior').hidden, true);
  assert.match(node('interests-settings-form').innerHTML, /Modifier mes centres/);
  assert.match(node('daily-discoveries-senior').innerHTML, /Photo du jour/);
  assert.match(node('daily-discoveries-senior').innerHTML, /Musique du jour/);
  assert.doesNotMatch(node('daily-discoveries-senior').innerHTML, /autoplay/);
});

test('daily discoveries are grouped with the recipe for both roles', () => {
  for (const [sectionId, role] of [
    ['senior-daily-recipe', 'senior'],
    ['aidant-daily-recipe', 'aidant'],
    ['aidant-daily-recipe-no-senior', 'aidant-no-senior']
  ]) {
    const sectionStart = source.indexOf(`id="${sectionId}"`);
    const sectionEnd = source.indexOf('</details>', sectionStart);
    const section = source.slice(sectionStart, sectionEnd);
    assert.match(section, /Mes découvertes du jour/);
    assert.match(section, /Recette du jour/);
    assert.match(section, new RegExp(`id="daily-discoveries-${role}"`));
  }
});

test('empty answer stays answered, music remains available, and a failed save keeps the form visible', async () => {
  const { context, node } = setup();
  context.fetch = async () => ({ ok: true, data: { interests: [], text: '' } });
  await context.chargerCentresInteret(context.connectedUser);
  assert.equal(node('interests-onboarding-senior').hidden, true);
  assert.equal(node('daily-discoveries-senior').hidden, false);
  assert.match(node('daily-discoveries-senior').innerHTML, /Musique du jour/);
  assert.doesNotMatch(node('daily-discoveries-senior').innerHTML, /autoplay/);
  context.fetch = async () => ({ ok: false });
  const input = form([]);
  await context.enregistrerCentresInteret(input);
  assert.equal(input.button.disabled, false);
  assert.match(input.status.textContent, /Échec/);
});

test('music written as an interest is recognized', async () => {
  const { context, node } = setup();
  context.fetch = async () => ({ ok: true, data: { interests: [], text: 'musique' } });
  await context.chargerCentresInteret(context.connectedUser);
  assert.match(node('daily-discoveries-senior').status.textContent, /musique/i);
});

test('caregivers can see discoveries with and without a linked person', async () => {
  const { context, node } = setup();
  context.connectedUser = { id: 'two', role: 'aidant' };
  context.fetch = async () => ({ ok: true, data: { interests: ['animaux'], text: '' } });
  await context.chargerCentresInteret(context.connectedUser);
  for (const role of ['aidant', 'aidant-no-senior']) {
    assert.equal(node(`daily-discoveries-${role}`).hidden, false);
    assert.match(node(`daily-discoveries-${role}`).innerHTML, /Photo du jour/);
  }
});

test('late responses cannot display one account’s choices in another', async () => {
  const { context, node } = setup();
  let resolve;
  context.fetch = () => new Promise(done => { resolve = done; });
  const load = context.chargerCentresInteret(context.connectedUser);
  context.reinitialiserCentresInteret();
  context.connectedUser = { id: 'two', role: 'aidant' };
  resolve({ ok: true, data: { interests: ['nature'], text: '' } });
  await load;
  assert.equal(context.current(), null);
  assert.equal(node('daily-discoveries-senior').hidden, true);
  assert.equal(node('interests-onboarding-senior').hidden, true);
});

test('recipe preferences affect daily choices without changing the default recipe', () => {
  const nodes = new Map();
  const context = {
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { textContent: '' });
      return nodes.get(id);
    } },
    dateCheckinBienEtre: () => '2026-03-28',
    Date, Math
  };
  const recipeStart = source.indexOf("    let dateRecetteAffichee = '';");
  const recipeEnd = source.indexOf('    function authHeaders(', recipeStart);
  vm.runInNewContext(`let centresInteret = null;
    function centresInteretEffectifs() { return centresInteret; }
    ${source.slice(recipeStart, recipeEnd)}
    globalThis.select = values => { centresInteret = values; dateRecetteAffichee = ''; actualiserRecetteDuJour(); };
  `, context);
  context.select(['sucre']);
  const sweet = nodes.get('senior-recipe-title').textContent;
  assert.ok(['Compote pomme-poire', 'Yaourt aux fruits', 'Bananes à la cannelle', 'Pomme au four'].includes(sweet));
  context.select(['sale']);
  const savoury = nodes.get('senior-recipe-title').textContent;
  assert.notEqual(savoury, sweet);
  assert.notEqual(savoury, 'Compote pomme-poire');
  context.select([]);
  assert.ok(nodes.get('senior-recipe-title').textContent);
});

test('written interests select matching photos and flag unsupported topics', async () => {
  const { context, node } = setup();
  context.fetch = async () => ({ ok: true, data: { interests: [], text: 'chat et piano' } });
  await context.chargerCentresInteret(context.connectedUser);
  const discovery = node('daily-discoveries-senior');
  assert.match(discovery.innerHTML, /riddle-images\/chat.jpg/);
  assert.match(node('senior-today-card').style.backgroundImage, /fonds\/chat.jpg/);
  assert.equal(node('senior-today-photo-credit').hidden, false);
  assert.match(discovery.innerHTML, /Musique du jour/);
  assert.match(discovery.status.textContent, /animaux/);
  context.fetch = async () => ({ ok: true, data: { interests: [], text: '<img src=x onerror=alert(1)> danse' } });
  await context.chargerCentresInteret(context.connectedUser);
  assert.doesNotMatch(discovery.innerHTML, /onerror/);
  assert.match(discovery.status.textContent, /ne proposons pas encore/);
  assert.equal(node('senior-today-card').style.backgroundImage, '');
  assert.equal(node('senior-today-photo-credit').hidden, true);
});

test('the daily background follows the photo, resets on logout and allows content to grow', async () => {
  const { context, node } = setup();
  context.fetch = async () => ({ ok: true, data: { interests: ['nature'], text: '' } });
  await context.chargerCentresInteret(context.connectedUser);
  const card = node('senior-today-card');
  assert.equal(card.classList.contains('has-daily-photo'), true);
  assert.match(card.style.backgroundImage, /riddle-images\/fonds\/.+\.jpg/);
  assert.match(card['aria-label'], /Aujourd’hui —/);
  context.reinitialiserCentresInteret();
  assert.equal(card.classList.contains('has-daily-photo'), false);
  assert.equal(card.style.backgroundImage, '');
  assert.equal(node('senior-today-photo-credit').hidden, true);
  assert.match(source, /#senior-today-card\.has-daily-photo\s*\{[^}]*min-height:\s*290px/);
  assert.match(source, /#senior-today-card\.has-daily-photo > \.today-inbox-list\s*\{[^}]*max-height:\s*none/);
});

test('written ingredients select recipes containing the requested ingredient', () => {
  const nodes = new Map();
  const context = {
    document: { getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { textContent: '' });
      return nodes.get(id);
    } },
    dateCheckinBienEtre: () => '2026-03-28',
    Date, Math
  };
  const recipeStart = source.indexOf("    let dateRecetteAffichee = '';");
  const recipeEnd = source.indexOf('    function authHeaders(', recipeStart);
  vm.runInNewContext(`${source.slice(recipeStart, recipeEnd)}\n${source.slice(start, end)}
    centresInteret = []; texteInteret = 'pommes';
    actualiserRecetteDuJour();
  `, context);
  assert.match(nodes.get('senior-recipe-title').textContent.toLowerCase(), /pomme/);
});
