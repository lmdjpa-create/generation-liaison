const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('homepage proposals are individually collapsed and retain their descriptions', () => {
  for (const title of [
    'Pour les seniors', 'Pour les proches et aidants', 'Pour les professionnels',
    'Carnet de liaison', 'Rendez-vous et services', 'Notifications et assistance',
    'Échanges avec les professionnels', 'Services à domicile', 'Une question ?'
  ]) {
    const section = source.split('<details class="info-card">')
      .find(part => part.trimStart().startsWith(`<summary>${title}</summary>`));
    assert.ok(section, `Missing collapsed proposal: ${title}`);
    assert.match(section.split('</details>')[0], /<p>/);
  }
});

test('homepage keeps direct application access and the emergency warning visible', () => {
  assert.match(source, /<a class="landing-login" href="\/app-mobile\.html">Ouvrir l’application/);
  assert.match(source, /<\/div>\s*<p class="info-note">Génération Liaison ne remplace ni un professionnel de santé ni un service d’urgence\.[\s\S]*?15 ou le 112\.<\/p>/);
});

test('homepage shows a clearly labelled example of the activity log before the application link', () => {
  const image = source.indexOf('src="/homepage-images/apercu-carnet.png"');
  const link = source.indexOf('class="landing-login" href="/app-mobile.html"');
  assert.ok(image >= 0 && image < link);
  assert.match(source, /<img[^>]+alt="Aperçu du fil d’actualité[^"]+"/);
  assert.match(source, /<figcaption>Un aperçu du carnet de liaison avec des données fictives\.<\/figcaption>/);
});

test('opening the app does not wait for a connection check', () => {
  const script = source.slice(source.lastIndexOf('<script>') + '<script>'.length, source.lastIndexOf('</script>'));
  let requests = 0;
  const status = { dataset: {}, textContent: '' };
  const window = {
    location: { hash: '', replace() {} },
    addEventListener() {},
    setTimeout() {},
    setInterval() {}
  };
  vm.runInNewContext(script, {
    window,
    document: { getElementById: () => status },
    navigator: { onLine: true },
    AbortController,
    fetch() { requests++; return new Promise(() => {}); }
  });
  assert.equal(requests, 0);
  assert.doesNotMatch(source, /Vérification de la connexion\.\.\./);
  assert.match(source, /<a class="landing-login" href="\/app-mobile\.html">Ouvrir l’application en ligne/);
});
