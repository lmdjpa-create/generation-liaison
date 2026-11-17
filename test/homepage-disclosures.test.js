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
  assert.match(source, /<a class="landing-login" href="\/app-mobile\.html#inscription">Créer un espace gratuitement/);
  assert.match(source, /<\/div>\s*<p class="info-note">Génération Liaison ne remplace ni un professionnel de santé ni un service d’urgence\.[\s\S]*?15 ou le 112\.<\/p>/);
});

test('homepage speaks to families and keeps service and assistant caveats in the FAQ', () => {
  const intro = source.slice(source.indexOf('<section class="landing-card"'), source.indexOf('id="privacy-title"'));
  assert.match(intro, /Pour les familles et les aidants.*même à distance/);
  const features = source.slice(source.indexOf('aria-labelledby="features-title"'), source.indexOf('aria-labelledby="questions-title"'));
  assert.doesNotMatch(features, /Une demande de service doit être acceptée|Les demandes restent soumises|réponses peuvent être inexactes/);
  const faq = source.slice(source.indexOf('aria-labelledby="questions-title"'), source.indexOf('id="connexion"'));
  assert.match(faq, /<details class="info-card">[\s\S]*Une demande de service doit être acceptée par le prestataire\./);
  assert.match(faq, /<details class="info-card">[\s\S]*Les réponses de l’assistant peuvent être inexactes ou incomplètes\./);
});

test('privacy and health data information is visible near the top without unverified guarantees', () => {
  const start = source.indexOf('<section class="landing-info privacy-highlight"');
  const end = source.indexOf('</section>', start);
  assert.ok(start > source.indexOf('id="landing-title"') && start < source.indexOf('id="presentation"'));
  const block = source.slice(start, end);
  assert.match(block, /RGPD et données de santé/);
  assert.match(block, /HTTPS pour chiffrer les échanges avec votre navigateur/);
  assert.match(block, /Le senior accepte les demandes des aidants qui peuvent alors consulter son carnet et y ajouter des notes ; un tuteur légal vérifié est associé par l’administration\./);
  assert.match(block, /certification HDS ne sont pas confirmés/);
  assert.match(block, /ne saisissez pas de notes médicales/);
  assert.match(block, /href="\/privacy-policy\.html"/);
  assert.doesNotMatch(block, /<details/);
});

test('the access section has one link to the application', () => {
  const access = source.split('<section class="landing-card" id="connexion"')[1].split('</section>')[0];
  assert.equal((access.match(/href="\/app-mobile\.html"/g) || []).length, 1);
});

test('homepage shows a clearly labelled example beside direct application access', () => {
  const image = source.indexOf('src="/homepage-images/apercu-carnet.png"');
  const link = source.indexOf('class="landing-login" href="/app-mobile.html#inscription"');
  assert.ok(link >= 0 && image > link);
  assert.match(source, /<img[^>]+alt="Aperçu du fil d’actualité[^"]+"/);
  assert.match(source, /<figcaption>Un aperçu du carnet de liaison avec des données fictives\.<\/figcaption>/);
  assert.match(source, /href="#exemple-carnet">Voir un exemple de carnet<\/a>/);
  assert.match(source, /<figure class="landing-preview" id="exemple-carnet">/);
});

test('homepage pricing distinguishes free access, premium restrictions and external services', () => {
  const start = source.indexOf('<section class="landing-info" aria-labelledby="pricing-title">');
  assert.ok(start > 0);
  const pricing = source.slice(start, source.indexOf('</section>', start));
  assert.match(pricing, /aucun paiement ni abonnement payant/);
  assert.match(pricing, /nécessitent un accès Premium/);
  assert.match(pricing, /prestations à domicile.*peuvent être facturées par le prestataire/);
  assert.match(pricing, /tarifs futurs sont à l’étude et ne sont pas appliqués/);
  assert.match(pricing, /href="\/cgv\.html"/);
});

test('homepage preview is immediately discoverable and prioritized for loading', () => {
  const image = source.match(/<img\b[^>]*src="\/homepage-images\/apercu-carnet\.png"[^>]*>/);
  assert.ok(image);
  assert.match(image[0], /\bfetchpriority="high"/);
  assert.doesNotMatch(image[0], /\bloading="lazy"/);
});

test('home screen instructions distinguish Android and iPhone and retain the separate Android download', () => {
  const start = source.indexOf('<div class="install-guide"');
  const end = source.indexOf('<a class="landing-download-link"', start);
  assert.ok(start > 0 && end > start);
  const guide = source.slice(start, end);
  assert.equal((guide.match(/<li>/g) || []).length, 3);
  assert.match(guide, /Android.*trois points/);
  assert.match(guide, /iPhone.*Safari.*Partager/);
  assert.match(guide, /Ajouter à l’écran d’accueil/);
  assert.match(guide, /peuvent varier selon le navigateur/);
  assert.match(source.slice(end), /href="\/app-generation-liaison\.apk" download/);
});

test('homepage image descriptions are alternative text rather than visible captions', () => {
  for (const [file, description] of [
    ['apercu-carnet.png', 'Aperçu du fil d’actualité : deux exemples de messages d’un proche et d’un soignant.'],
    ['soins.jpg', 'Une professionnelle prend la tension d’un senior.'],
    ['coiffure.jpg', 'Une coiffeuse coupe les cheveux d’une personne âgée.']
  ]) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'homepage-images', file)));
    assert.equal(source.split(description).length - 1, 1);
    assert.ok(source.includes(`alt="${description}"`));
  }
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
