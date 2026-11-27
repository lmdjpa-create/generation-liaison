const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const mobileSource = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
const privacySource = fs.readFileSync(path.join(__dirname, '..', 'privacy-policy.html'), 'utf8');
const salesTerms = fs.readFileSync(path.join(__dirname, '..', 'cgv.html'), 'utf8');

test('homepage guides each audience and offers optional fictional everyday examples', () => {
  const purpose = 'Génération Liaison aide les personnes accompagnées, leurs proches et les intervenants à partager des nouvelles et organiser le quotidien.';
  assert.ok(source.includes(`<p class="audience-purpose">${purpose}</p>`));
  const nav = source.slice(source.indexOf('<nav class="audience-guide"'), source.indexOf('</nav>', source.indexOf('<nav class="audience-guide"')));
  for (const id of ['espace-senior', 'espace-aidant', 'espace-pro', 'espace-etablissement', 'espace-soignant']) {
    assert.ok(nav.includes(`href="#${id}"`));
    assert.equal((source.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1);
  }
  const start = source.indexOf('<details class="home-examples">');
  assert.ok(start > source.indexOf('</nav>', source.indexOf('<nav class="audience-guide"')));
  const preview = source.slice(start, source.indexOf('</details>', start));
  assert.match(preview, /Ces exemples sont fictifs/);
  assert.match(preview, /autorisations de chacun/);
  for (const text of ['Un message', 'Un rendez-vous', 'Le lien au quotidien']) assert.ok(preview.includes(`<h3>${text}</h3>`));
  assert.match(source, /\.audience-guide-links a \{[\s\S]*?min-height: 56px/);
  assert.match(source, /\.home-example-grid \{[^}]*auto-fit/);
  const window = { localStorage: { getItem: () => 'en' } };
  const document = { documentElement: {}, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'language.js'), 'utf8'), { window, document });
  for (const text of [
    purpose, 'Voir des exemples du quotidien',
    'Ces exemples sont fictifs. Les informations visibles dépendent des autorisations de chacun.',
    'Un message', 'Un rendez-vous',
    'Un proche écrit : « Bonjour, je passerai te voir demain. »',
    'Une visite confirmée apparaît dans l’agenda des personnes autorisées.',
    'Un intervenant partage une nouvelle du quotidien avec les personnes autorisées.'
  ]) assert.notEqual(window.generationLiaisonTranslate(text), text);
});

test('homepage offers every audience a photo, sign-in link and detailed information', () => {
  const header = source.slice(source.indexOf('<header class="audience-header">'), source.indexOf('</header>'));
  assert.match(header, /<img src="\/logo-generation-liaison\.jpg"/);
  assert.match(header, /<span>Génération<br>Liaison<\/span>/);
  const cards = source.slice(source.indexOf('<section class="audience-list"'), source.indexOf('<p class="audience-safety">'));
  const articles = [...cards.matchAll(/<article class="audience-card">([\s\S]*?)<\/article>/g)];
  assert.equal(articles.length, 5);
  const images = articles.map(([, card]) => card.match(/<img src="\/homepage-images\/([^"]+)"/)?.[1]);
  assert.equal(new Set(images).size, 5);
  for (const image of images) assert.ok(image && fs.existsSync(path.join(__dirname, '..', 'homepage-images', image)));
  for (const [index, [title, role]] of [
    ['Senior et personne accompagnée', 'senior'], ['Proches et aidants', 'aidant'],
    ['Professionnels et intervenants', 'pro'], ['Entreprises et résidences', 'establishment'],
    ['Soignants en établissement', 'staff']
  ].entries()) {
    const card = articles[index][1];
    assert.ok(card.includes(`<h2>${title}</h2>`));
    assert.match(card, /<img src="\/homepage-images\/[^"]+"[^>]*alt="[^"]+"/);
    assert.ok(card.includes(`<a class="landing-login" href="/app-mobile.html?profil=${role}">Se connecter</a>`));
    assert.match(card, /<details>\s*<summary>Informations<\/summary>[\s\S]*?<p>/);
  }
  assert.match(source, /\.audience-card:nth-child\(odd\) img \{ order: 2; \}/);
  assert.match(source, /\.audience-card img \{[^}]*width: 100%;[^}]*height: auto;[^}]*aspect-ratio: 4 \/ 3;[^}]*object-fit: cover;/);
  assert.match(source, /@media \(max-width: 700px\) \{\s*\.audience-card \{ grid-template-columns: 1fr; \}/);
  assert.match(source, /\.audience-card img \{ width: min\(100%, 462px\); aspect-ratio: 16 \/ 9; justify-self: center; \}/);
  assert.match(source, /<details class="landing-more">\s*<summary>Toutes les informations sur Génération Liaison<\/summary>/);
});

test('homepage headings and disclosure titles are centered without displacing their controls', () => {
  assert.match(source, /\.landing :is\(h1, h2, h3, h4, h5, h6, summary, \.journal-preview-title\) \{ text-align: center; \}/);
  assert.match(source, /\.info-card summary, \.landing-disclosure > summary \{[\s\S]*?justify-content: center;[\s\S]*?padding-left: 36px;[\s\S]*?padding-right: 36px;/);
  assert.match(source, /\.info-card summary::after, \.landing-disclosure > summary::after \{[\s\S]*?position: absolute;[\s\S]*?right: 12px;/);
});

test('each audience has a linked, accessible presentation with closed explanations', () => {
  const pages = ['senior', 'proches', 'intervenants', 'residences'];
  for (const audience of pages) {
    const file = `presentation-${audience}.html`;
    const page = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.ok(source.includes(`href="/${file}"`), `Missing homepage link for ${audience}`);
    assert.match(page, /<html lang="fr">/);
    assert.match(page, /<h1>/);
    assert.match(page, /href="\/app-mobile\.html#inscription"/);
    assert.match(page, /href="\/presentation\.css"/);
    assert.match(page, /src="\/help-bubbles\.js"/);
    assert.equal((page.match(/<details data-close-on-mouse-leave>/g) || []).length, 3);
    assert.doesNotMatch(page, /<details[^>]*\bopen\b/);
    assert.match(page, /15 ou le 112/);
    for (const other of pages.filter(item => item !== audience)) {
      assert.ok(page.includes(`href="/presentation-${other}.html"`));
    }
  }
  const residence = fs.readFileSync(path.join(__dirname, '..', 'presentation-residences.html'), 'utf8');
  assert.match(residence, /direction ne consulte ni les carnets ni les messages privés/);
  assert.match(residence, /L’application est gratuite\. La partie médicale est payante[\s\S]*Aucun paiement en ligne ni facturation automatique/);
});

test('homepage proposals are individually collapsed and retain their descriptions', () => {
  for (const title of [
    'Pour les personnes accompagnées', 'Pour les proches et aidants', 'Pour les professionnels', 'Pour les entreprises et résidences',
    'Carnet de liaison', 'Rendez-vous et services', 'Notifications et assistance',
    'Garder le lien au quotidien', 'Services à domicile', 'Une question ?'
  ]) {
    const section = source.split('<details class="info-card">')
      .find(part => part.trimStart().startsWith(`<summary>${title}</summary>`));
    assert.ok(section, `Missing collapsed proposal: ${title}`);
    assert.match(section.split('</details>')[0], /<p>/);
  }
});

test('homepage explanations start closed while direct access and emergency information remain visible', () => {
  for (const summary of [
    'À qui s’adresse Génération Liaison ?', 'Voir les aperçus de l’interface senior',
    'Exemple de carnet de liaison', 'Vos échanges restent privés et sécurisés',
    'Entreprises et résidences : un espace pour la direction', 'Informations sur les prestataires',
    'Une application gratuite', 'Comment accéder à l’application ?',
    'Aide et informations légales'
  ]) {
    const escaped = summary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(source, new RegExp(`<details class="landing-disclosure"(?: id="[^"]+")?>\\s*<summary(?: id="[^"]+")?>${escaped}</summary>`));
  }
  assert.match(source, /<\/details>\s*<a class="landing-login" href="\/app-mobile\.html#inscription">/);
  assert.match(source, /<\/details>\s*<p>Bon à savoir :[\s\S]*15 ou le 112/);
  const script = source.slice(source.lastIndexOf('<script>') + '<script>'.length, source.lastIndexOf('</script>'));
  const elements = { 'entreprises-details': { open: false }, 'exemple-carnet-details': { open: false } };
  const context = { document: { getElementById: id => elements[id] } };
  const start = script.indexOf('    function ouvrirRubriqueAccueil(id)');
  const end = script.indexOf('    function redirectLegacyDashboard()', start);
  vm.runInNewContext(`${script.slice(start, end)}\nouvrirRubriqueAccueil('entreprises-details'); ouvrirRubriqueAccueil('exemple-carnet-details');`, context);
  assert.equal(elements['entreprises-details'].open, true);
  assert.equal(elements['exemple-carnet-details'].open, true);
});

test('homepage describes daily tasks and shopping list sharing accurately', () => {
  const block = source.slice(source.indexOf('aria-labelledby="features-title"'), source.indexOf('aria-labelledby="daily-life-title"'));
  assert.match(block, /Les informations du jour[\s\S]*bulles colorées/);
  assert.match(block, /Tâches du quotidien[\s\S]*annuaire partagé[\s\S]*notification dans l’application[\s\S]*ne voit que les tâches qui lui sont confiées/);
  assert.match(block, /Liste de courses[\s\S]*liste de courses privée[\s\S]*copie par message aux personnes choisies[\s\S]*ne se met pas à jour automatiquement/);
});

test('homepage keeps direct application access and the emergency warning visible', () => {
  assert.match(source, /<a class="landing-login" href="\/app-mobile\.html#inscription">Créer un espace gratuitement/);
  assert.match(source, /<\/div>\s*<p class="info-note">Génération Liaison ne remplace ni un professionnel de santé ni un service d’urgence\.[\s\S]*?15 ou le 112\.<\/p>/);
});

test('homepage speaks to families and uses practical family FAQs', () => {
  const intro = source.slice(source.indexOf('<section class="landing-card"'), source.indexOf('id="privacy-title"'));
  assert.match(intro, /Un carnet de liaison pour les proches, les intervenants et les établissements/);
  assert.match(intro, /seniors et toute personne ayant besoin d’accompagnement au quotidien, notamment en situation de handicap/);
  assert.match(source, /choisissez le profil « Personne accompagnée » dans l’application/);
  const features = source.slice(source.indexOf('aria-labelledby="features-title"'), source.indexOf('aria-labelledby="questions-title"'));
  assert.doesNotMatch(features, /Une demande de service doit être acceptée|Les demandes restent soumises|réponses peuvent être inexactes/);
  const faq = source.slice(source.indexOf('aria-labelledby="questions-title"'), source.indexOf('id="connexion"'));
  assert.match(faq, /Mon proche n’est pas à l’aise avec Internet, comment faire/);
  assert.match(faq, /Un proche peut l’aider à créer son compte/);
  assert.match(faq, /Combien de proches peut-on associer à un carnet/);
  assert.match(faq, /la personne accompagnée doit accepter chaque demande/);
  assert.match(faq, /20 correspondants au maximum/);
  assert.match(faq, /Faut-il télécharger une application sur téléphone/);
  assert.match(faq, /Comment sont sélectionnés les prestataires à domicile/);
  assert.match(faq, /attestation d’assurance/);
  assert.doesNotMatch(faq, /réponses de l’assistant|demande de service doit être acceptée/);
});

test('senior AI chat is disabled while contact with the team remains available', () => {
  assert.doesNotMatch(mobileSource, /id="assistant-chat-form"|id="assistant-message"/);
  assert.match(mobileSource, /La conversation avec l’assistant IA est désactivée/);
  assert.match(mobileSource, /id="assistant-handoff-button"/);
  const faq = source.slice(source.indexOf('aria-labelledby="questions-title"'), source.indexOf('id="connexion"'));
  assert.doesNotMatch(faq, /Les réponses de l’assistant/);
});

test('privacy and health data information remains available near the top without unverified guarantees', () => {
  const start = source.indexOf('<section class="landing-info privacy-highlight"');
  const end = source.indexOf('</section>', start);
  assert.ok(start > source.indexOf('id="landing-title"') && start < source.indexOf('id="presentation"'));
  const block = source.slice(start, end);
  assert.match(block, /Vos échanges restent privés et sécurisés/);
  assert.match(block, /La connexion au site est chiffrée et l’accès au carnet est réservé aux personnes autorisées/);
  assert.match(block, /La personne accompagnée accepte les demandes des aidants/);
  assert.match(block, /partage avec les soignants de l’établissement nécessite l’accord du résident ou de son représentant légal vérifié/);
  assert.match(block, /nouvelles du quotidien, pas aux données de santé/);
  assert.match(block, /href="\/privacy-policy\.html"/);
  assert.doesNotMatch(block, /Render|PostgreSQL|HDS|région.*confirmer/);
  assert.match(block, /<details class="landing-disclosure">\s*<summary id="privacy-title">/);
  assert.match(block, /<\/details>\s*<p>Bon à savoir :[\s\S]*15 ou le 112/);
  assert.match(privacySource, /base de données de production sur Supabase/);
  assert.match(privacySource, /conditions de chiffrement de cette base et de ses sauvegardes\s+restent à vérifier/);
  assert.match(privacySource, /Aucune certification HDS n’est revendiquée/);
});

test('homepage metadata and reassurance match the updated presentation', () => {
  assert.match(source, /<title>Génération Liaison : carnet de liaison pour tous<\/title>/);
  assert.match(source, /<meta name="description" content="Un carnet de liaison gratuit pour les seniors et les personnes ayant besoin d'accompagnement/);
  assert.match(source, /<meta property="og:description" content="Un carnet de liaison gratuit pour les seniors et les personnes ayant besoin d'accompagnement/);
  assert.match(source, /Application gratuite · ✓ Aucun suivi statistique dans l’espace connecté · ✓ Accessible sans installation/);
  const header = source.slice(source.indexOf('<header class="audience-header">'), source.indexOf('</header>'));
  assert.match(header, /L’application est gratuite\. La partie médicale est payante/);
  assert.match(header, /Aucun paiement n’est actuellement activé dans l’application/);
  assert.match(source, /Bon à savoir :[\s\S]*?15 ou le 112/);
  assert.match(source, /href="mailto:mail@generation-liaison\.fr"/);
  assert.match(source, /id="analytics-settings">Gestion des cookies/);
});

test('updated homepage copy remains available in English', () => {
  const window = { localStorage: { getItem: () => 'en' } };
  const document = { documentElement: {}, addEventListener() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'language.js'), 'utf8'), { window, document });
  for (const text of [
    'Un carnet de liaison pour les proches, les intervenants et les établissements',
    'Pour les entreprises et résidences',
    'Entreprises et résidences : un espace pour la direction',
    'Lors de l’inscription, choisissez « Entreprise / résidence ».',
    'Que vous soyez senior ou que vous ayez besoin d’accompagnement pour une autre raison, choisissez le profil « Personne accompagnée » dans l’application.',
    '✓ Application gratuite · ✓ Aucun suivi statistique dans l’espace connecté · ✓ Accessible sans installation',
    'Une tablette : achat ou location',
    'Achat envisagé à 299 € TTC, ou location envisagée à 25 € HT par mois sur 12 mois, avec Premium en supplément. Le tarif Premium reste à définir.',
    'L’application est gratuite. La partie médicale est payante ; ses tarifs et modalités restent à préciser. Aucun paiement n’est actuellement activé dans l’application.',
    'Faut-il télécharger une application sur téléphone ?',
    'Comment sont sélectionnés les prestataires à domicile ?',
    'Gestion des cookies'
  ]) {
    assert.notEqual(window.generationLiaisonTranslate(text), text);
  }
});

test('homepage presents the organization workspace and the actual registration and privacy rules', () => {
  const start = source.indexOf('<section class="landing-info" id="entreprises"');
  assert.ok(start > 0);
  const block = source.slice(start, source.indexOf('</section>', start));
  assert.match(source, /href="#entreprises" onclick="ouvrirRubriqueAccueil\('entreprises-details'\)">Découvrir l’espace entreprises et résidences/);
  for (const title of ['Résidents', 'Soignants', 'Intervenants']) assert.match(block, new RegExp(`<h3>${title}</h3>`));
  assert.match(block, /résident ou son représentant légal vérifié choisit le partage/);
  assert.match(block, /direction ne consulte pas les carnets ni les messages privés/);
  assert.match(block, /activé manuellement[\s\S]*options de tablettes sont indicatives[\s\S]*aucun paiement en ligne/);
  assert.match(block, /href="\/app-mobile\.html#inscription">Créer un compte établissement/);
  assert.match(block, /choisissez « Entreprise \/ résidence »/);
  assert.match(mobileSource, /<option value="establishment">🏢 Entreprise \/ résidence<\/option>/);
});

test('the access section has one link to the application', () => {
  const access = source.split('<section class="landing-card" id="connexion"')[1].split('</section>')[0];
  assert.equal((access.match(/href="\/app-mobile\.html"/g) || []).length, 1);
});

test('homepage shows a responsive, readable fictional journal example beside direct application access', () => {
  const preview = source.indexOf('<figure class="landing-preview" id="exemple-carnet">');
  const link = source.indexOf('class="landing-login" href="/app-mobile.html#inscription"');
  assert.ok(link >= 0 && preview > link);
  const example = source.slice(preview, source.indexOf('</figure>', preview));
  assert.match(example, /role="group" aria-label="Exemple fictif de carnet de liaison"/);
  assert.match(example, /Un proche · Aujourd’hui à 9 h 30/);
  assert.match(example, /Un intervenant à domicile · Aujourd’hui à 8 h 15/);
  assert.doesNotMatch(example, /Un soignant/);
  assert.match(source, /\.journal-preview-entry p\s*\{\s*margin: 0;\s*font-size: 1rem;/);
  assert.doesNotMatch(example, /<img/);
  assert.match(source, /<figcaption>Un aperçu du carnet de liaison avec des données fictives\.<\/figcaption>/);
  assert.match(source, /href="#exemple-carnet" onclick="ouvrirRubriqueAccueil\('exemple-carnet-details'\)">Voir un exemple de carnet<\/a>/);
});

test('homepage shows the actual optional senior view and explains its fictional data', () => {
  const image = source.indexOf('src="/homepage-images/apercu-accueil-senior.png"');
  const preview = source.slice(source.lastIndexOf('<figure class="landing-interface-preview">', image), source.indexOf('</figure>', image));
  assert.match(preview, /src="\/homepage-images\/apercu-accueil-senior\.png"/);
  assert.match(preview, /alt="Accueil senior en vue simplifiée/);
  assert.match(preview, /vue simplifiée activée par défaut, avec des données fictives/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'homepage-images', 'apercu-accueil-senior.png')));
});

test('homepage immediately shows real senior controls with pictograms', () => {
  const preview = source.slice(source.indexOf('<figure class="landing-interface-preview">'), source.indexOf('</figure>', source.indexOf('<figure class="landing-interface-preview">')));
  assert.match(preview, /src="\/homepage-images\/apercu-espace-proche\.png"/);
  assert.match(preview, /alt="Espace Proche de l’interface senior/);
  assert.match(preview, /Capture en français/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'homepage-images', 'apercu-espace-proche.png')));
});

test('homepage visibly explains service verification limits without promising insurance checks', () => {
  const start = source.indexOf('<section class="landing-info" aria-labelledby="daily-life-title">');
  const block = source.slice(start, source.indexOf('<div class="info-grid">', start));
  assert.ok(start >= 0);
  assert.match(block, /dépendent des équipes associées et de leur disponibilité/);
  assert.match(block, /l’administration examine la pièce d’identité et le Kbis/);
  assert.match(block, /L’assurance et la qualité des prestations ne sont pas vérifiées/);
});

test('homepage pricing distinguishes the free app, medical section and external services', () => {
  const start = source.indexOf('<section class="landing-info" aria-labelledby="pricing-title">');
  assert.ok(start > 0);
  const pricing = source.slice(start, source.indexOf('</section>', start));
  assert.match(pricing, /L’application est gratuite\. La partie médicale est payante/);
  assert.match(pricing, /tarifs et modalités restent à préciser/);
  assert.match(pricing, /Aucun paiement n’est actuellement activé dans l’application/);
  assert.doesNotMatch(pricing, /disponibilité et des autorisations nécessaires/);
  assert.doesNotMatch(pricing, /nécessitent un accès Premium/);
  assert.match(pricing, /prestations à domicile sont indépendantes.*peuvent être facturées par le prestataire/);
  assert.doesNotMatch(pricing, /phase de lancement/);
  assert.match(pricing, /href="\/cgv\.html"/);
});

test('sales terms and partner settings do not present payments as active', () => {
  assert.match(salesTerms, /Compte famille\/senior<\/td><td>Gratuit/);
  assert.match(salesTerms, /Partie médicale<\/td><td>À préciser/);
  assert.match(salesTerms, /aucun paiement par carte ou PayPal ne sont actuellement activés/);
  assert.doesNotMatch(salesTerms, /1 € HT par prestation réalisée|15 € HT \/ mois/);
  for (const html of [mobileSource, fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8')]) {
    assert.match(html, /paramètres techniques ; aucun paiement n’est activé/);
  }
});

test('tablet purchase and rental are visible without opening further information', () => {
  assert.match(source, /<a class="tablet-highlight" href="#tablettes">Découvrir l’achat ou la location d’une tablette<\/a>/);
  const start = source.indexOf('<section class="landing-info" id="tablettes"');
  const end = source.indexOf('</section>', start);
  assert.ok(start > 0 && end < source.indexOf('<details class="landing-more">'));
  const section = source.slice(start, end);
  assert.match(section, /achat ou location/i);
  assert.match(section, /299 € TTC/);
  assert.match(section, /25 € HT par mois sur 12 mois/);
  assert.match(section, /Premium en supplément/);
  assert.match(section, /sous réserve de devis et de disponibilité/);
  assert.match(section, /Aucun partenaire de location n’est confirmé/);
  assert.match(section, /ne constitue ni une commande ni un paiement/);
  assert.match(section, /href="\/app-mobile\.html#inscription"/);
});

test('homepage preview uses scalable text instead of image-baked captions', () => {
  const preview = source.slice(source.indexOf('<figure class="landing-preview"'), source.indexOf('</figure>', source.indexOf('<figure class="landing-preview"')));
  assert.match(preview, /journal-preview-entry/);
  assert.doesNotMatch(preview, /<img/);
  assert.match(source, /\.journal-preview\s*\{[\s\S]*?width: 100%/);
  assert.match(source, /\.landing-preview\s*\{\s*max-width: 520px/);
});

test('home screen instructions distinguish Android and iPhone and retain the separate Android download', () => {
  const start = source.indexOf('<div class="install-guide"');
  const end = source.indexOf('<a class="landing-download-link"', start);
  assert.ok(start > 0 && end > start);
  const guide = source.slice(start, end);
  assert.match(source.slice(source.indexOf('<section class="landing-card" id="connexion"'), start), /aucune application iOS native n’est proposée/);
  assert.equal((guide.match(/<li>/g) || []).length, 3);
  assert.match(guide, /Sur iPhone : ajouter le site à l’écran d’accueil/);
  assert.match(guide, /iPhone, ouvrez Génération Liaison dans Safari/);
  assert.match(guide, /Touchez le bouton Partager/);
  assert.match(guide, /Sur Android.*trois points/);
  assert.match(guide, /Ajouter à l’écran d’accueil/);
  assert.match(guide, /menus peuvent varier selon la version d’iOS/);
  assert.match(source.slice(end), /href="\/app-generation-liaison\.apk" download/);
});

test('homepage image descriptions are alternative text rather than visible captions', () => {
  for (const [file, description] of [
    ['famille.jpg', 'Une femme sourit en tenant les mains d’une personne âgée, près d’un autre proche.'],
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
