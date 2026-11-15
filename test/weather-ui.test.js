const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

function setup() {
  const elements = new Map();
  const values = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: '', textContent: '', hidden: false, open: false, children: [],
      replaceChildren(...children) { this.children = children; this.value = children[0]?.value || ''; },
      append(child) { this.children.push(child); }
    });
    return elements.get(id);
  }
  const context = {
    connectedUser: { id: 'one', role: 'senior' },
    SERVER_URL: '',
    window: { generationLiaisonTranslate: value => value, generationLiaisonLocale: () => 'fr-FR' },
    document: { getElementById: element, createElement: () => ({ textContent: '' }) },
    localStorage: {
      getItem: key => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    },
    Option: function(text, value) { this.text = text; this.value = value; },
    authHeaders: includeSenior => { assert.equal(includeSenior, false); return {}; },
    readResponse: async response => {
      if (!response.ok) throw new Error(response.error);
      return response.data;
    }
  };
  const start = source.indexOf('    let meteoLoadId = 0;');
  const end = source.indexOf('    async function choisirCommune(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  return { context, element, values };
}

const commune = (code, name, latitude) => ({
  code, nom: name, codesPostaux: ['75000'], centre: { coordinates: [2.35, latitude] }
});
const data = {
  temperature: 16, code: 0,
  days: Array.from({ length: 7 }, (_, index) => ({
    date: `2026-03-0${index + 1}`, min: 4, max: 17, code: 3
  }))
};

test('both home pages offer weather before the other dashboard cards', () => {
  const senior = source.indexOf('id="senior-weather-title"');
  const aidant = source.indexOf('id="aidant-weather-title"');
  assert.ok(senior > source.indexOf('id="welcome-senior-name"') && senior < source.indexOf('id="senior-next-visit"'));
  assert.ok(aidant > source.indexOf('id="welcome-aidant-name"') && aidant < source.indexOf('id="aidant-daily-summary"'));
  assert.match(source, /id="settings-weather"[\s\S]*id="weather-enabled"[^>]*type="checkbox"[^>]*checked/);
  const warning = 'Les prévisions peuvent être inexactes ou indisponibles. Consultez les alertes officielles pour votre sécurité.';
  assert.ok(source.slice(senior, source.indexOf('id="senior-next-visit"')).includes(warning));
  assert.ok(source.slice(aidant, source.indexOf('id="aidant-daily-summary"')).includes(warning));
});

test('multiple communes require a choice and show seven days', async () => {
  const { context, element, values } = setup();
  context.rechercherCommunes = async () => [commune('1', 'Paris', 48.86), commune('2', 'Parisy', 49)];
  let requests = 0;
  context.fetch = async (url, options) => {
    requests++;
    assert.equal(url, '/api/weather');
    assert.equal(JSON.parse(options.body).latitude, 49);
    return { ok: true, data };
  };
  await context.chargerMeteo('senior');
  assert.equal(requests, 0);
  element('senior-weather-search').value = 'Paris';
  await context.rechercherMeteo('senior');
  assert.equal(element('senior-weather-choice').hidden, false);
  context.confirmerCommuneMeteo('senior');
  assert.match(element('senior-weather-search-status').textContent, /Choisissez/);
  assert.equal(requests, 0);
  element('senior-weather-choice').value = '2';
  context.confirmerCommuneMeteo('senior');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element('senior-weather-status').textContent, /Parisy.*16 °C.*dégagé/);
  assert.equal(element('senior-weather-days').children.length, 7);
  assert.equal(element('senior-weather-week').hidden, false);
  assert.ok(values.has('generation-liaison-weather-one'));
});

test('the account municipality is the default until an override or opt-out is chosen', async () => {
  const { context, element, values } = setup();
  context.connectedUser.accountCommune = { name: 'Lyon', code: '69123', latitude: 45.76, longitude: 4.84 };
  const calls = [];
  context.fetch = async (url, options) => {
    calls.push(JSON.parse(options.body));
    return { ok: true, data };
  };
  await context.chargerMeteo('senior');
  assert.match(element('senior-weather-status').textContent, /Lyon/);
  assert.equal(calls[0].latitude, 45.76);
  values.set('generation-liaison-weather-one', JSON.stringify({ name: 'Paris', latitude: 48.86, longitude: 2.35 }));
  await context.chargerMeteo('senior');
  assert.match(element('senior-weather-status').textContent, /Paris/);
  context.reglerMeteo(false);
  await context.chargerMeteo('senior');
  assert.equal(calls.length, 2);
  assert.equal(element('senior-weather-card').hidden, true);
  assert.equal(values.get('generation-liaison-weather-enabled-one'), 'false');
  context.reglerMeteo(true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 3);
  assert.match(element('senior-weather-status').textContent, /Paris/);
  context.utiliserCommuneCompteMeteo('senior');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 4);
  assert.match(element('senior-weather-status').textContent, /Lyon/);
});

test('late weather or commune results never appear after account or input changes', async () => {
  const { context, element, values } = setup();
  values.set('generation-liaison-weather-one', JSON.stringify({ name: 'Paris', latitude: 48.86, longitude: 2.35 }));
  let finishWeather;
  context.fetch = () => new Promise(resolve => { finishWeather = resolve; });
  const pending = context.chargerMeteo('senior');
  context.connectedUser = { id: 'two', role: 'aidant' };
  context.reinitialiserMeteo();
  finishWeather({ ok: true, data });
  await pending;
  assert.match(element('senior-weather-status').textContent, /Choisissez/);
  assert.equal(element('senior-weather-week').hidden, true);
  await context.chargerMeteo('aidant');
  assert.match(element('aidant-weather-status').textContent, /Choisissez/);

  let finishSearch;
  context.rechercherCommunes = () => new Promise(resolve => { finishSearch = resolve; });
  element('aidant-weather-search').value = 'Paris';
  const search = context.rechercherMeteo('aidant');
  element('aidant-weather-search').value = 'Lyon';
  context.annulerRechercheMeteo('aidant');
  finishSearch([commune('1', 'Paris', 48)]);
  await search;
  assert.equal(element('aidant-weather-choice').hidden, true);
  assert.equal(values.has('generation-liaison-weather-two'), false);
});

test('a late forecast cannot overwrite a newly selected municipality', async () => {
  const { context, element, values } = setup();
  values.set('generation-liaison-weather-one', JSON.stringify({ name: 'Paris', latitude: 48, longitude: 2 }));
  const pending = [];
  context.fetch = () => new Promise(resolve => pending.push(resolve));
  const older = context.chargerMeteo('senior');
  values.set('generation-liaison-weather-one', JSON.stringify({ name: 'Lyon', latitude: 45, longitude: 4 }));
  const newer = context.chargerMeteo('senior');
  pending[1]({ ok: true, data });
  await newer;
  pending[0]({ ok: true, data: { ...data, temperature: 2 } });
  await older;
  assert.match(element('senior-weather-status').textContent, /Lyon.*16 °C/);
  assert.doesNotMatch(element('senior-weather-status').textContent, /Paris/);
});

test('disabling weather ignores an in-flight forecast and persists for that account', async () => {
  const { context, element, values } = setup();
  context.connectedUser.accountCommune = { name: 'Lyon', code: '69123', latitude: 45.76, longitude: 4.84 };
  let finish;
  context.fetch = () => new Promise(resolve => { finish = resolve; });
  const pending = context.chargerMeteo('senior');
  context.reglerMeteo(false);
  finish({ ok: true, data });
  await pending;
  assert.equal(element('senior-weather-card').hidden, true);
  assert.equal(element('senior-weather-week').hidden, true);
  assert.equal(values.get('generation-liaison-weather-enabled-one'), 'false');
  await context.chargerMeteo('senior');
  assert.equal(element('weather-enabled').checked, false);
});

test('configuration and commune-search errors are visible', async () => {
  const { context, element, values } = setup();
  values.set('generation-liaison-weather-one', JSON.stringify({ name: 'Paris', latitude: 48, longitude: 2 }));
  context.fetch = async () => ({ ok: false, error: 'La météo n’est pas encore configurée.' });
  await context.chargerMeteo('senior');
  assert.match(element('senior-weather-status').textContent, /pas encore configurée/);
  context.rechercherCommunes = async () => { throw new Error('Aucune commune trouvée.'); };
  await context.rechercherMeteo('senior');
  assert.match(element('senior-weather-search-status').textContent, /Aucune commune/);
});
