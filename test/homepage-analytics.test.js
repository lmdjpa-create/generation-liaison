const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'homepage-analytics.js'), 'utf8');
const key = 'generation-liaison-analytics-consent';

function createPage(initialChoice, options = {}) {
  const saved = new Map(initialChoice ? [[key, initialChoice]] : []);
  if (options.session) saved.set('generation-liaison-mobile-session', 'session');
  const elements = {};
  const handlers = {};
  const scripts = [];
  const cookies = [];
  let reloads = 0;
  for (const id of ['analytics-consent', 'analytics-status', 'analytics-settings', 'analytics-consent-title', 'analytics-accept', 'analytics-reject']) {
    elements[id] = {
      hidden: id === 'analytics-consent',
      textContent: '',
      addEventListener(event, callback) { handlers[`${id}:${event}`] = callback; },
      focus() {}
    };
  }
  const localStorage = {
    getItem: name => saved.get(name) || null,
    setItem(name, value) {
      if (options.storageFailure) throw new Error('Storage unavailable');
      saved.set(name, value);
    },
    removeItem: name => saved.delete(name)
  };
  const document = {
    getElementById: id => elements[id],
    createElement: () => ({}),
    head: { appendChild: script => scripts.push(script) },
    set cookie(value) { cookies.push(value); }
  };
  const window = {
    location: {
      origin: 'https://generation-liaison.fr', hostname: 'generation-liaison.fr',
      hash: options.hash || '', search: options.search || '', reload() { reloads += 1; }
    },
    addEventListener(event, callback) { handlers[`window:${event}`] = callback; }
  };
  vm.runInNewContext(source, { window, document, localStorage, console, Date });
  return { saved, elements, handlers, scripts, cookies, window, reloads: () => reloads };
}

test('homepage does not load Google without consent and remembers refusal', () => {
  const page = createPage();
  assert.equal(page.elements['analytics-consent'].hidden, false);
  assert.equal(page.scripts.length, 0);
  page.handlers['analytics-reject:click']();
  assert.equal(page.scripts.length, 0);
  assert.equal(page.elements['analytics-consent'].hidden, true);
  assert.equal(JSON.parse(page.saved.get(key)).choice, 'rejected');
  const next = createPage(page.saved.get(key));
  assert.equal(next.scripts.length, 0);
  assert.equal(next.elements['analytics-consent'].hidden, true);
  next.handlers['analytics-settings:click']();
  assert.equal(next.elements['analytics-consent'].hidden, false);
});

test('acceptance loads only the homepage measurement with sanitized location and no ad signals', () => {
  const page = createPage();
  page.handlers['analytics-accept:click']();
  assert.equal(page.scripts.length, 1);
  assert.equal(page.scripts[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-DNJJZ4FQCQ');
  assert.equal(page.scripts[0].referrerPolicy, 'no-referrer');
  const config = page.window.dataLayer.find(args => args[0] === 'config')[2];
  assert.equal(config.page_location, 'https://generation-liaison.fr/');
  assert.equal(config.page_referrer, '');
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
  assert.equal(page.elements['analytics-consent'].hidden, true);
  assert.equal(createPage(page.saved.get(key)).scripts.length, 1);
  assert.equal(createPage(page.saved.get(key), { hash: '#dashboard' }).scripts.length, 0);
  assert.equal(createPage(page.saved.get(key), { search: '?email=private' }).scripts.length, 0);
  assert.equal(createPage(page.saved.get(key), { session: true }).scripts.length, 0);
});

test('withdrawal and cross-tab refusal disable measurement and reload after removing cookies', () => {
  const accepted = JSON.stringify({ choice: 'accepted', time: Date.now() });
  const page = createPage(accepted);
  page.handlers['analytics-reject:click']();
  assert.equal(page.window['ga-disable-G-DNJJZ4FQCQ'], true);
  assert.equal(JSON.parse(page.saved.get(key)).choice, 'rejected');
  assert.ok(page.cookies.some(cookie => cookie.startsWith('_ga_DNJJZ4FQCQ=;')));
  assert.equal(page.reloads(), 1);
  const other = createPage(accepted);
  other.saved.set(key, JSON.stringify({ choice: 'rejected', time: Date.now() }));
  other.handlers['window:storage']({ key });
  assert.equal(other.window['ga-disable-G-DNJJZ4FQCQ'], true);
  assert.equal(other.reloads(), 1);
  const login = createPage(accepted);
  login.handlers['window:storage']({ key: 'generation-liaison-mobile-session', newValue: 'session' });
  assert.equal(login.window['ga-disable-G-DNJJZ4FQCQ'], true);
  assert.equal(login.reloads(), 1);
});

test('expired or unsavable consent never loads Google', () => {
  const expired = JSON.stringify({ choice: 'accepted', time: Date.now() - 181 * 24 * 60 * 60 * 1000 });
  assert.equal(createPage(expired).scripts.length, 0);
  const page = createPage(null, { storageFailure: true });
  page.handlers['analytics-accept:click']();
  assert.equal(page.scripts.length, 0);
  assert.equal(page.window['ga-disable-G-DNJJZ4FQCQ'], true);
  assert.match(page.elements['analytics-status'].textContent, /Impossible/);
});

test('only the public homepage includes the analytics code and the choice controls', () => {
  const root = path.join(__dirname, '..');
  const homepage = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(homepage, /<script src="\/homepage-analytics\.js" defer><\/script>/);
  assert.match(homepage, /id="analytics-consent"[^>]*hidden/);
  assert.match(homepage, /id="analytics-accept"/);
  assert.match(homepage, /id="analytics-reject"/);
  assert.match(homepage, /id="analytics-settings"/);
  for (const file of ['app-mobile.html', 'aidant.html', 'pro.html', 'admin.html']) {
    const page = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(page, /homepage-analytics\.js|G-DNJJZ4FQCQ/);
  }
});
