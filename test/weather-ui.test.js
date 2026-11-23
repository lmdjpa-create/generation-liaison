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

test('daily information screens offer weather without hiding the visit or summary', () => {
  const seniorInfo = source.slice(source.indexOf('id="screen-informations-senior"'), source.indexOf('id="screen-informations-aidant"'));
  const aidantInfo = source.slice(source.indexOf('id="screen-informations-aidant"'), source.indexOf('id="screen-informations-pro"'));
  assert.match(seniorInfo, /id="senior-weather-title"/);
  assert.match(seniorInfo, /id="senior-next-visit"/);
  assert.match(aidantInfo, /id="aidant-weather-title"/);
  assert.match(aidantInfo, /id="aidant-daily-summary"/);
  assert.match(source, /id="settings-weather"[\s\S]*id="weather-enabled"[^>]*type="checkbox"[^>]*checked/);
  const warning = 'Les prévisions peuvent être inexactes ou indisponibles. Consultez les alertes officielles pour votre sécurité.';
  const settings = source.slice(source.indexOf('id="settings-weather"'), source.indexOf('id="settings-senior-voice"'));
  assert.equal(settings.split(warning).length - 1, 2);
  assert.ok(!seniorInfo.includes('Réglages de la météo'));
  assert.ok(!aidantInfo.includes('Réglages de la météo'));
});

test('multiple communes require a choice and show seven days', async () => {
  const { context, element, values } = setup();
  context.rechercherCommunes = async () => [commune('1', 'Paris', 48.86), commune('2', 'Parisy', 49)];
  let requests = 0;
  context.fetch = async (url, options) => {
    if (url === '/api/weather/location') return { ok: true, data: { location: JSON.parse(options.body).location } };
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
  await context.confirmerCommuneMeteo('senior');
  assert.match(element('senior-weather-search-status').textContent, /Choisissez/);
  assert.equal(requests, 0);
  element('senior-weather-choice').value = '2';
  await context.confirmerCommuneMeteo('senior');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(element('senior-weather-status').textContent, /Parisy.*16 °C.*dégagé/);
  assert.equal(element('senior-weather-days').children.length, 7);
  assert.equal(element('senior-weather-week').hidden, false);
  assert.equal(context.connectedUser.weatherCommune.name, 'Parisy');
  assert.equal(values.has('generation-liaison-weather-one'), false);
});

test('the account municipality is the default until an override or opt-out is chosen', async () => {
  const { context, element, values } = setup();
  context.connectedUser.accountCommune = { name: 'Lyon', code: '69123', latitude: 45.76, longitude: 4.84 };
  const calls = [];
  context.fetch = async (url, options) => {
    if (url === '/api/weather/location') return { ok: true, data: { location: JSON.parse(options.body).location } };
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
  await context.utiliserCommuneCompteMeteo('senior');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 4);
  assert.match(element('senior-weather-status').textContent, /Lyon/);
});

test('late weather or commune results never appear after account or input changes', async () => {
  const { context, element, values } = setup();
  context.connectedUser.weatherCommuneConfigured = true;
  context.connectedUser.weatherCommune = { name: 'Paris', latitude: 48.86, longitude: 2.35 };
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
  context.connectedUser.weatherCommuneConfigured = true;
  context.connectedUser.weatherCommune = { name: 'Paris', latitude: 48, longitude: 2 };
  const pending = [];
  context.fetch = () => new Promise(resolve => pending.push(resolve));
  const older = context.chargerMeteo('senior');
  context.connectedUser.weatherCommune = { name: 'Lyon', latitude: 45, longitude: 4 };
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
  context.connectedUser.weatherCommuneConfigured = true;
  context.connectedUser.weatherCommune = { name: 'Paris', latitude: 48, longitude: 2 };
  context.fetch = async () => ({ ok: false, error: 'La météo n’est pas encore configurée.' });
  await context.chargerMeteo('senior');
  assert.match(element('senior-weather-status').textContent, /pas encore configurée/);
  context.rechercherCommunes = async () => { throw new Error('Aucune commune trouvée.'); };
  await context.rechercherMeteo('senior');
  assert.match(element('senior-weather-search-status').textContent, /Aucune commune/);
});

test('automatic refresh waits thirty minutes, respects visibility and opt-out, and resumes on return', async () => {
  const { context, element, values } = setup();
  let now = 100000000;
  context.Date = class extends Date { static now() { return now; } };
  context.connectedUser.accountCommune = { name: 'Lyon', latitude: 45.76, longitude: 4.84 };
  let calls = 0;
  context.fetch = async () => { calls++; return { ok: true, data }; };
  await context.chargerMeteo('senior');
  now += 29 * 60 * 1000;
  context.actualiserMeteoSiNecessaire();
  assert.equal(calls, 1);
  now += 60 * 1000;
  context.document.hidden = true;
  context.actualiserMeteoSiNecessaire();
  assert.equal(calls, 1);
  context.document.hidden = false;
  context.actualiserMeteoSiNecessaire();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 2);
  context.reglerMeteo(false);
  now += 31 * 60 * 1000;
  context.actualiserMeteoSiNecessaire();
  assert.equal(calls, 2);
  assert.equal(element('senior-weather-card').hidden, true);
  assert.equal(values.get('generation-liaison-weather-enabled-one'), 'false');
});

test('a saved account preference overrides and removes an old device choice', async () => {
  const { context, element, values } = setup();
  values.set('generation-liaison-weather-one', JSON.stringify({ name: 'Paris', latitude: 48, longitude: 2 }));
  context.connectedUser.weatherCommuneConfigured = true;
  context.connectedUser.weatherCommune = { name: 'Lyon', latitude: 45, longitude: 4 };
  context.fetch = async (url, options) => {
    assert.equal(url, '/api/weather');
    assert.equal(JSON.parse(options.body).latitude, 45);
    return { ok: true, data };
  };
  await context.chargerMeteo('senior');
  assert.match(element('senior-weather-status').textContent, /Lyon/);
  assert.equal(values.has('generation-liaison-weather-one'), false);
});

test('failed save keeps the previous location and displays an error', async () => {
  const { context, element } = setup();
  context.connectedUser.accountCommune = { name: 'Lyon', latitude: 45, longitude: 4 };
  context.rechercherCommunes = async () => [commune('1', 'Paris', 48)];
  context.fetch = async () => ({ ok: false, error: 'Impossible d’enregistrer la commune météo.' });
  element('senior-weather-search').value = 'Paris';
  await context.rechercherMeteo('senior');
  assert.match(element('senior-weather-search-status').textContent, /Impossible d’enregistrer/);
  assert.equal(context.connectedUser.weatherCommuneConfigured, undefined);
});

test('migration errors are visible and never discard the old choice', async () => {
  const { context, element, values } = setup();
  const key = 'generation-liaison-weather-one';
  values.set(key, JSON.stringify({ name: 'Paris', latitude: 48, longitude: 2 }));
  context.fetch = async () => ({ ok: false, error: 'Votre session a expiré. Reconnectez-vous.' });
  await context.chargerMeteo('senior');
  assert.match(element('senior-weather-status').textContent, /session a expiré/);
  assert.ok(values.has(key));
  assert.equal(context.connectedUser.weatherCommuneConfigured, undefined);
});

test('a late legacy migration cannot replace a newly saved location', async () => {
  const { context, element, values } = setup();
  values.set('generation-liaison-weather-one', JSON.stringify({ name: 'Paris', latitude: 48, longitude: 2 }));
  context.rechercherCommunes = async () => [commune('1', 'Lyon', 45)];
  let finishMigration;
  context.fetch = async (url, options) => {
    if (url === '/api/weather/location') {
      const request = JSON.parse(options.body);
      if (request.migrate) return new Promise(resolve => { finishMigration = resolve; });
      return { ok: true, data: { location: request.location } };
    }
    return { ok: true, data };
  };
  const migration = context.chargerMeteo('senior');
  element('senior-weather-search').value = 'Lyon';
  await context.rechercherMeteo('senior');
  finishMigration({ ok: true, data: { location: { name: 'Paris', latitude: 48, longitude: 2 } } });
  await migration;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.connectedUser.weatherCommune.name, 'Lyon');
  assert.match(element('senior-weather-status').textContent, /Lyon/);
});

test('disabling weather while a location is being saved preserves the opt-out', async () => {
  const { context, element } = setup();
  context.rechercherCommunes = async () => [commune('1', 'Lyon', 45)];
  let finishSave;
  context.fetch = () => new Promise(resolve => { finishSave = resolve; });
  element('senior-weather-search').value = 'Lyon';
  const save = context.rechercherMeteo('senior');
  await new Promise(resolve => setImmediate(resolve));
  context.reglerMeteo(false);
  finishSave({ ok: true, data: { location: { name: 'Lyon', latitude: 45, longitude: 2.35 } } });
  await save;
  assert.equal(context.connectedUser.weatherCommune.name, 'Lyon');
  assert.equal(element('senior-weather-card').hidden, true);
});
