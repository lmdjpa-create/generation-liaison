const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { after, before, test } = require('node:test');
const app = require('../server');
const { createAuthService, hashPassword, verifyPassword } = require('../auth');
const { getServiceDistance } = require('../distance');
const { isAllowedWebPushSubscription } = require('../push-subscriptions');

const projectRoot = path.join(__dirname, '..');
let server;
let baseUrl;
let androidFixture;
let androidPublic;

before(async () => {
  androidFixture = fs.mkdtempSync(path.join(projectRoot, 'node_modules', '.android-test-'));
  for (const entry of [
    'index.html', 'aidant.html', 'pro.html', 'app-mobile.html', 'aide-installation-android.html', 'reset-password.html',
    'admin.html', 'privacy-policy.html', 'cgu.html', 'cgv.html', 'language.js',
    'robots.txt', 'sitemap.xml', 'logo-generation-liaison.jpg', 'push-service-worker.js', 'homepage-images', 'downloads', 'scripts'
  ]) {
    fs.cpSync(path.join(projectRoot, entry), path.join(androidFixture, entry), { recursive: true });
  }
  const androidBuild = spawnSync(process.execPath, [
    path.join(androidFixture, 'scripts', 'build-web.js'), '--android'
  ], {
    cwd: androidFixture,
    env: { ...process.env, CAPACITOR_API_URL: 'https://example.test' },
    encoding: 'utf8'
  });
  if (androidBuild.status !== 0) {
    throw new Error(`Android web build failed: ${androidBuild.stderr || androidBuild.stdout}`);
  }
  androidPublic = path.join(androidFixture, 'android', 'app', 'src', 'main', 'assets', 'public');
  fs.cpSync(path.join(androidFixture, 'dist'), androidPublic, { recursive: true });
  const androidEntry = spawnSync(process.execPath, [
    path.join(androidFixture, 'scripts', 'prepare-android-entry.js')
  ], { cwd: androidFixture, encoding: 'utf8' });
  if (androidEntry.status !== 0) {
    throw new Error(`Android entry preparation failed: ${androidEntry.stderr || androidEntry.stdout}`);
  }

  const build = spawnSync(process.execPath, [
    path.join(projectRoot, 'scripts', 'build-web.js')
  ], {
    cwd: projectRoot,
    encoding: 'utf8'
  });
  if (build.status !== 0) {
    throw new Error(`Web build failed before server tests: ${build.stderr || build.stdout}`);
  }

  server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
  if (androidFixture) fs.rmSync(androidFixture, { recursive: true, force: true });
});

test('reports server status', async () => {
  const response = await fetch(`${baseUrl}/api/status`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'En ligne');
});

test('calendar periods cover complete Monday-to-Sunday weeks and use Paris dates', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  const source = html.slice(html.indexOf('    function dateInputValue(date) {'),
    html.indexOf('    function updatePlanningDateTitle() {'));
  const context = vm.createContext({ Intl, Date });
  vm.runInContext(`let calendarDate; let calendarView;\n${source}`, context);
  const bounds = (date, view) => vm.runInContext(
    `calendarDate = ${JSON.stringify(date)}; calendarView = ${JSON.stringify(view)};
     [dateInputValue(calendarBounds().start), dateInputValue(calendarBounds().end)].join(',')`,
    context
  );
  assert.equal(bounds('2026-03-29', 'month'), '2026-02-23,2026-04-06');
  assert.equal(bounds('2026-08-31', 'month'), '2026-07-27,2026-09-07');
  assert.equal(bounds('2026-12-31', 'week'), '2026-12-28,2027-01-04');
  assert.equal(vm.runInContext("calendarEventDate('2026-03-28T23:30:00Z')", context), '2026-03-29');
});

test('calendar requires authentication', async () => {
  const response = await fetch(`${baseUrl}/api/planning/calendar?start=2026-03-23&end=2026-03-30`);
  assert.equal(response.status, 401);
});

test('serves the application pages and legal documents', async () => {
  for (const page of [
    '/',
    '/index.html',
    '/aidant.html',
    '/pro.html',
    '/app-mobile.html',
    '/aide-installation-android.html',
    '/reset-password.html',
    '/admin',
    '/admin.html',
    '/privacy-policy.html',
    '/cgu.html',
    '/cgv.html'
  ]) {
    const response = await fetch(`${baseUrl}${page}`);
    assert.equal(response.status, 200, `${page} should be served`);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /<!DOCTYPE html>/i);
  }
});

test('serves the shared French and English language selector', async () => {
  const response = await fetch(`${baseUrl}/language.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /javascript/);
  const source = fs.readFileSync(path.join(projectRoot, 'language.js'), 'utf8');
  assert.match(source, /generationLiaisonSetLanguage/);
  for (const page of ['index.html', 'aidant.html', 'pro.html', 'app-mobile.html', 'admin.html']) {
    assert.match(fs.readFileSync(path.join(projectRoot, page), 'utf8'), /<script src="\/language\.js"><\/script>/);
  }

  const storedValues = new Map();
  const window = {
    localStorage: {
      getItem: key => storedValues.get(key) || null,
      setItem: (key, value) => storedValues.set(key, value)
    },
    dispatchEvent() {}
  };
  const document = { documentElement: { lang: 'fr' }, addEventListener() {} };
  vm.runInNewContext(source, {
    window,
    document,
    console,
    CustomEvent: class CustomEvent {
      constructor(type, options) {
        this.type = type;
        this.detail = options.detail;
      }
    }
  });

  assert.equal(window.generationLiaisonLocale(), 'fr-FR');
  assert.equal(window.generationLiaisonTranslate('Se connecter'), 'Se connecter');
  window.generationLiaisonSetLanguage('en');
  assert.equal(window.generationLiaisonLocale(), 'en-US');
  assert.equal(window.generationLiaisonTranslate('Se connecter'), 'Sign in');
  assert.equal(
    window.generationLiaisonTranslate('Je suis tuteur légal et souhaite accéder aux profils seniors qui me seront associés par l’administration.'),
    'I am a legal guardian and want access to senior profiles linked to my account by an administrator.'
  );
  assert.equal(window.generationLiaisonTranslate('Choisir un profil senior'), 'Choose a senior profile');
  assert.equal(window.generationLiaisonTranslate('Un nom saisi par un utilisateur'), 'Un nom saisi par un utilisateur');
  assert.equal(document.documentElement.lang, 'en');
  assert.equal(storedValues.get('generation-liaison-language'), 'en');
  window.generationLiaisonSetLanguage('fr');
  assert.equal(window.generationLiaisonTranslate('Se connecter'), 'Se connecter');
});

test('homepage opens the real app and no longer exposes demo data', () => {
  const homepage = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  assert.match(homepage, /href="\/app-mobile\.html"/);
  assert.match(homepage, /window\.location\.replace\('\/app-mobile\.html'\)/);
  assert.doesNotMatch(homepage, /id="dashboard"|generation-liaison-demo|Tension 12\/7|données de démonstration/i);
});

test('privacy notice discloses draft status and pending verification items', () => {
  const policy = fs.readFileSync(path.join(projectRoot, 'privacy-policy.html'), 'utf8')
    .replace(/\s+/g, ' ');
  assert.match(policy, /Version de travail — à compléter avant publication définitive/);
  assert.match(policy, /activation effective en production doit être vérifiée/);
  assert.match(policy, /M\. Pina Pierre, également éditeur, directeur de la publication et vendeur du service/);
  assert.match(policy, /46 rue de l’Église, 32290 Sabazan/);
  assert.match(policy, /forme juridique et les numéros SIREN et SIRET restent à préciser/);
  assert.match(policy, /ne définit pas de durée automatique de suppression pour ce registre/);
  assert.match(policy, /identifiant de session dans le stockage local du navigateur/);
});

test('mobile registration links to the privacy policy', () => {
  const mobileApp = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  assert.match(mobileApp, /href="\/privacy-policy\.html" target="_blank" rel="noopener">Lire la politique de confidentialité/);
});

test('privacy notice describes minimized AI-assisted account-closure review and human decision', () => {
  const policy = fs.readFileSync(path.join(projectRoot, 'privacy-policy.html'), 'utf8')
    .replace(/\s+/g, ' ');
  assert.match(policy, /pré-jugement indicatif/);
  assert.match(policy, /l’administration examine les données réelles et prend seule la décision finale/);
  assert.match(policy, /décomptes de dossiers/);
  assert.match(policy, /Ni le nom, ni l’adresse e-mail, ni les identifiants, ni le contenu des notes/);
  assert.match(policy, /Préparer l’examen administratif des demandes de clôture/);
  assert.match(policy, /<strong>OpenAI :<\/strong>/);
});

test('privacy notice documents wellbeing check-ins, sharing, dictation, and 30-day retention', () => {
  const policy = fs.readFileSync(path.join(projectRoot, 'privacy-policy.html'), 'utf8')
    .replace(/\s+/g, ' ');
  const terms = fs.readFileSync(path.join(projectRoot, 'cgu.html'), 'utf8')
    .replace(/\s+/g, ' ');
  assert.match(policy, /texte de votre réponse est transmis à OpenAI/);
  assert.match(policy, /Seul le texte de votre réponse leur est alors accessible après connexion/);
  assert.match(policy, /notification neutre qui ne contient pas votre réponse/);
  assert.match(policy, /dictée et la confirmation vocale d’urgence peuvent traiter l’audio en dehors de Génération Liaison/);
  assert.match(policy, /check-in, la réponse IA et ses partages expirent 30 jours/);
  assert.match(policy, /double confirmation du senior/);
  assert.match(policy, /ne contacte pas elle-même les secours/);
  assert.match(policy, /indication automatisée signalant éventuellement des propos préoccupants/);
  assert.match(policy, /pendant 60 secondes alors que l’application est ouverte/);
  assert.match(terms, /aucune renonciation générale à tout recours ou à toute poursuite judiciaire/);
  assert.match(terms, /Sans réponse pendant 60 secondes/);
  assert.match(terms, /ne compose pas elle-même le numéro/);
});

test('account closure has a tracked 30-day deadline and data-minimization policy', () => {
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const admin = fs.readFileSync(path.join(projectRoot, 'admin.html'), 'utf8')
    .replace(/\s+/g, ' ');
  const policy = fs.readFileSync(path.join(projectRoot, 'privacy-policy.html'), 'utf8')
    .replace(/\s+/g, ' ');
  const terms = fs.readFileSync(path.join(projectRoot, 'cgu.html'), 'utf8')
    .replace(/\s+/g, ' ');

  assert.match(serverSource, /request\.requested_at \+ INTERVAL '30 days' AS due_at/);
  assert.match(admin, /Traitez chaque demande dans les 30 jours calendaires suivant sa réception/);
  assert.match(admin, /Échéance \(30 jours\)/);
  assert.match(policy, /dans les 30 jours calendaires suivant sa réception/);
  assert.match(terms, /dans les 30 jours calendaires suivant sa réception/);
  assert.match(policy, /les autres données personnelles sont supprimées après examen/);
  assert.match(serverSource, /AND \(\$2 != 'completed' OR ai_reviewed_at IS NOT NULL\)/);
  assert.match(admin, /Avez-vous vérifié le pré-jugement IA et les données réelles/);
});

test('homepage exposes public downloads and legal links without developer tools', async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /href="\/app-generation-liaison\.apk" download/);
  assert.match(html, /class="landing-login" href="\/app-mobile\.html">Ouvrir l’application en ligne/);
  assert.match(html, /href="\/aide-installation-android\.html">Besoin d’aide/);
  assert.doesNotMatch(html, /app-generation-liaison\.aab|Espace administrateur|href="\/admin(?:\.html)?"/);
  assert.match(html, /id="connection-status"[^>]*\shidden(?:\s|>)/);
  assert.match(html, /href="\/cgu\.html#mentions-legales">Mentions légales/);
  assert.match(html, /href="\/cgu\.html">Conditions d’utilisation/);
  assert.match(html, /href="\/cgv\.html">Tarifs et CGV/);
  const terms = await (await fetch(`${baseUrl}/cgu.html`)).text();
  assert.match(terms, /id="mentions-legales"/);
});

test('public pages use the registered generation-liaison.fr domain for e-mail', () => {
  for (const page of ['index.html', 'cgu.html', 'cgv.html', 'aide-installation-android.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(projectRoot, page), 'utf8'), /generationliaison\.fr/, page);
  }
});

test('Android installation guide is served with three steps and security advice', async () => {
  const response = await fetch(`${baseUrl}/aide-installation-android.html`);
  assert.equal(response.status, 200);
  const guide = await response.text();
  assert.equal((guide.match(/<li class="step">/g) || []).length, 3);
  assert.match(guide, /site officiel/);
  assert.match(guide, /désactiver.*autorisation/i);
  assert.match(guide, /ne poursuivez pas/i);
  assert.match(guide, /href="\/app-mobile\.html"/);
  assert.ok(fs.existsSync(path.join(androidPublic, 'aide-installation-android.html')));
});

test('serves the Android APK download', async () => {
  const apkPath = path.join(projectRoot, 'dist', 'app-generation-liaison.apk');
  const response = await fetch(`${baseUrl}/app-generation-liaison.apk`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/vnd\.android\.package-archive/);
  assert.equal((await response.arrayBuffer()).byteLength, fs.statSync(apkPath).size);
});

test('builds and serves the Play Console app bundle', async () => {
  const sourcePath = path.join(projectRoot, 'downloads', 'app-generation-liaison.aab');
  const publicPath = path.join(projectRoot, 'dist', 'app-generation-liaison.aab');
  const response = await fetch(`${baseUrl}/app-generation-liaison.aab`);
  const source = fs.readFileSync(sourcePath);

  assert.equal(response.status, 200);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
  assert.deepEqual(fs.readFileSync(publicPath), source);
});

test('serves browser push assets', async () => {
  for (const asset of ['/push-client.js', '/push-service-worker.js']) {
    const response = await fetch(`${baseUrl}${asset}`);
    assert.equal(response.status, 200, `${asset} should be served`);
    assert.match(response.headers.get('content-type'), /javascript/);
    assert.ok((await response.text()).length > 0);
  }
});

test('declares production environment variables without hardcoding secrets', () => {
  const render = fs.readFileSync(path.join(projectRoot, 'render.yaml'), 'utf8');
  const example = fs.readFileSync(path.join(projectRoot, '.env.example'), 'utf8');
  const secretVariables = [
    'ADMIN_ACCESS_CODE',
    'OPENAI_API_KEY',
    'FIREBASE_SERVICE_ACCOUNT_JSON',
    'WEB_PUSH_PRIVATE_KEY',
    'RESEND_API_KEY',
    'TWILIO_AUTH_TOKEN',
    'GOOGLE_CALENDAR_CLIENT_SECRET',
    'CALENDAR_TOKEN_ENCRYPTION_KEY',
    'DAILY_API_KEY'
  ];
  const configuredVariables = [
    ...secretVariables,
    'ADMIN_EMAILS',
    'PLANNING_COORDINATOR_EMAILS',
    'OPENAI_MODEL',
    'WEB_PUSH_PUBLIC_KEY',
    'WEB_PUSH_SUBJECT',
    'NOTIFICATIONS_FROM_EMAIL',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_FROM_NUMBER',
    'GOOGLE_CALENDAR_CLIENT_ID',
    'GOOGLE_CALENDAR_REDIRECT_URI',
    'DAILY_DOMAIN'
  ];

  for (const key of configuredVariables) {
    assert.match(render, new RegExp(`- key: ${key}\\b`), `${key} should be declared in render.yaml`);
    assert.match(example, new RegExp(`^${key}=`, 'm'), `${key} should be documented in .env.example`);
  }
  for (const key of secretVariables) {
    assert.match(render, new RegExp(`- key: ${key}\\s+sync: false`), `${key} should remain a protected Render setting`);
    assert.match(example, new RegExp(`^${key}=$`, 'm'), `${key} should not contain a secret in .env.example`);
  }
});

test('Play Console release has a new version and builds an app bundle', () => {
  const gradle = fs.readFileSync(path.join(projectRoot, 'android', 'app', 'build.gradle'), 'utf8');
  const releaseScript = fs.readFileSync(path.join(projectRoot, 'scripts', 'build-android-release.js'), 'utf8');
  assert.match(gradle, /versionCode 3/);
  assert.match(gradle, /versionName "1\.1\.1"/);
  assert.match(releaseScript, /'assembleRelease', 'bundleRelease'/);
  assert.match(releaseScript, /app-release\.aab/);
  assert.match(releaseScript, /app-generation-liaison\.aab/);
});

test('rejects Android builds that target a non-HTTPS API', () => {
  const result = spawnSync(process.execPath, [
    path.join(projectRoot, 'scripts', 'build-web.js'),
    '--android'
  ], {
    cwd: projectRoot,
    env: { ...process.env, CAPACITOR_API_URL: 'http://localhost:3000' },
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /CAPACITOR_API_URL must be a valid HTTPS URL/);
});

test('all application page scripts have valid JavaScript syntax', () => {
  const pages = [
    'index.html',
    'aidant.html',
    'pro.html',
    'app-mobile.html',
    'reset-password.html',
    'admin.html',
    path.join('dist', 'app-mobile.html'),
    path.join(androidPublic, 'index.html')
  ];

  for (const page of pages) {
    const source = fs.readFileSync(path.isAbsolute(page) ? page : path.join(projectRoot, page), 'utf8');
    const scripts = [...source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];

    assert.ok(scripts.length > 0, `${page} should contain an application script`);
    for (const [, script] of scripts) {
      new vm.Script(script, { filename: page });
    }
  }
});

test('mobile profile placeholder styles are intact in source and built apps', () => {
  for (const page of [
    'app-mobile.html',
    path.join('dist', 'app-mobile.html'),
    path.join(androidPublic, 'app-mobile.html')
  ]) {
    const source = fs.readFileSync(path.isAbsolute(page) ? page : path.join(projectRoot, page), 'utf8');
    assert.match(source, /\.directory-photo\.placeholder\s*\{\s*display:\s*flex;/, page);
    assert.doesNotMatch(source, /\}\r?3f8;\s*\}\s*\.directory-photo\.placeholder/, page);
  }
});

test('senior home greets the signed-in user and refreshes the date when the app opens', () => {
  const mobileApp = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  assert.match(mobileApp, /Bonjour <span id="welcome-senior-name">Senior<\/span> !/);
  assert.match(mobileApp, /function afficherAccueilSenior\(user\)/);
  assert.match(mobileApp, /const displayName = user\.name \|\| user\.seniorName \|\| 'Senior'/);
  assert.match(mobileApp, /document\.getElementById\('date-senior'\)\.textContent = new Date\(\)\.toLocaleDateString\(window\.generationLiaisonLocale\(\)/);
  assert.match(mobileApp, /afficherAccueilSenior\(user\)/);
});

test('wellbeing check-in is presented to seniors and shared responses are shown to aidants', () => {
  const mobileApp = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');

  assert.match(mobileApp, /Comment allez-vous aujourd’hui \?/);
  assert.match(mobileApp, /wellbeing-dictation-button/);
  assert.match(mobileApp, /wellbeing-share-confirmation/);
  assert.match(mobileApp, /chargerCheckinsPartages\(\)/);
  assert.match(serverSource, /app\.get\('\/api\/wellbeing\/shared-check-ins'/);
  assert.match(serverSource, /aidant\.role = 'aidant'/);
});

test('emergency calls require a second confirmation and provide a phone dialer action', () => {
  const mobileApp = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');

  assert.match(mobileApp, /data-emergency-number="15"/);
  assert.match(mobileApp, /data-emergency-number="112"/);
  assert.match(mobileApp, /Je confirme l’appel d’urgence/);
  assert.match(mobileApp, /href = `tel:\$\{number\}`/);
  assert.match(mobileApp, /safetyCheckStatus === 'awaiting_response'/);
  assert.match(mobileApp, /safetyCheckStatus === 'no_response'/);
  assert.match(mobileApp, /60 \* 1000/);
  assert.match(mobileApp, /Choisir le 18 \(pompiers\)/);
  assert.match(serverSource, /app\.post\('\/api\/emergency-alert'/);
  assert.match(serverSource, /app\.post\('\/api\/wellbeing\/check-in\/:checkinId\/safety-response'/);
  assert.match(serverSource, /app\.post\('\/api\/wellbeing\/check-in\/:checkinId\/emergency-alert'/);
  assert.match(serverSource, /confirmationMethod === 'voice'/);
});

test('builds Android with the configured HTTPS API origin', () => {
  const androidApp = fs.readFileSync(
    path.join(androidPublic, 'index.html'),
    'utf8'
  );
  assert.match(androidApp, /const SERVER_URL = "https:\/\/example\.test";/);
  assert.match(androidApp, /Agenda des services du quotidien/);
});

test('returns the available meals with valid prices', async () => {
  const response = await fetch(`${baseUrl}/api/meals/today`);
  const meals = await response.json();

  assert.equal(response.status, 200);
  assert.equal(meals.length, 3);
  assert.ok(meals.every(meal =>
    typeof meal.title === 'string' &&
    typeof meal.price === 'number' &&
    Array.isArray(meal.tags)
  ));
});

test('requires authentication before accepting a log', async () => {
  const response = await fetch(`${baseUrl}/api/logs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senior_id: 1 })
  });

  assert.equal(response.status, 401);
});

test('requires authentication before returning a log feed', async () => {
  const response = await fetch(`${baseUrl}/api/logs/all`);
  assert.equal(response.status, 401);
});

test('requires authentication for notification preferences and push registration', async () => {
  const requests = [
    fetch(`${baseUrl}/api/notifications/config`),
    fetch(`${baseUrl}/api/notifications/preferences`),
    fetch(`${baseUrl}/api/notifications/preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailEnabled: true, smsEnabled: false })
    }),
    fetch(`${baseUrl}/api/notifications/push-subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'web', token: '{}' })
    }),
    fetch(`${baseUrl}/api/notifications/push-subscriptions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ platform: 'web', token: '{}' })
    })
  ];

  const responses = await Promise.all(requests);
  assert.ok(responses.every(response => response.status === 401));
});

test('requires authentication for assistant chat and administrator controls', async () => {
  const responses = await Promise.all([
    fetch(`${baseUrl}/api/assistant/conversation`),
    fetch(`${baseUrl}/api/assistant/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour' })
    }),
    fetch(`${baseUrl}/api/assistant/handoff`, { method: 'POST' }),
    fetch(`${baseUrl}/api/admin/assistant/settings`),
    fetch(`${baseUrl}/api/admin/assistant/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false })
    }),
    fetch(`${baseUrl}/api/admin/assistant/handoffs`),
    fetch(`${baseUrl}/api/admin/assistant/handoffs/not-a-uuid/reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour' })
    })
  ]);
  assert.ok(responses.every(response => response.status === 401));
});

test('requires authentication for wellbeing check-ins and shared responses', async () => {
  const checkinId = 'c5a5e07d-00e4-4c54-9863-d74a882902f4';
  const responses = await Promise.all([
    fetch(`${baseUrl}/api/emergency-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: '112', confirmed: true, confirmationMethod: 'click' })
    }),
    fetch(`${baseUrl}/api/wellbeing/check-in`),
    fetch(`${baseUrl}/api/wellbeing/check-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Bonjour', recipientUserIds: [] })
    }),
    fetch(`${baseUrl}/api/wellbeing/shared-check-ins`),
    fetch(`${baseUrl}/api/wellbeing/check-in/${checkinId}/safety-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: 'no_response' })
    }),
    fetch(`${baseUrl}/api/wellbeing/check-in/${checkinId}/emergency-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        number: '112',
        confirmed: true,
        confirmationMethod: 'click'
      })
    })
  ]);
  assert.ok(responses.every(response => response.status === 401));
});

test('requires authentication for professional verification and document review', async () => {
  const accountId = 'c5a5e07d-00e4-4c54-9863-d74a882902f4';
  const requests = [
    fetch(`${baseUrl}/api/professional-verification/documents`),
    fetch(`${baseUrl}/api/professional-verification/documents/identity`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/pdf' },
      body: '%PDF-1.7'
    }),
    fetch(`${baseUrl}/api/admin/accounts/${accountId}/verification-documents`),
    fetch(`${baseUrl}/api/admin/accounts/${accountId}/verification-documents/identity`),
    fetch(`${baseUrl}/api/admin/accounts/${accountId}/verification`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verificationStatus: 'approved' })
    })
  ];
  const responses = await Promise.all(requests);
  assert.ok(responses.every(response => response.status === 401));
});

test('requires authentication for directory profiles, search, availability, and bookings', async () => {
  const professionalId = 'c5a5e07d-00e4-4c54-9863-d74a882902f4';
  const bookingId = 'd55c1da2-0ae9-438d-a933-9d6c44d7b4b1';
  const responses = await Promise.all([
    fetch(`${baseUrl}/api/directory/profile`),
    fetch(`${baseUrl}/api/directory/profile`, { method: 'PUT' }),
    fetch(`${baseUrl}/api/calendar/google/status`),
    fetch(`${baseUrl}/api/calendar/google/connect`, { method: 'POST' }),
    fetch(`${baseUrl}/api/directory/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: '', limit: 20, offset: 0 })
    }),
    fetch(`${baseUrl}/api/directory/${professionalId}/availability?date=2030-01-01`),
    fetch(`${baseUrl}/api/directory/${professionalId}/bookings`, { method: 'POST' }),
    fetch(`${baseUrl}/api/directory/bookings`),
    fetch(`${baseUrl}/api/directory/bookings/${bookingId}`, { method: 'PATCH' })
  ]);
  assert.ok(responses.every(response => response.status === 401));
});

test('requires authentication for shared planning and live visit updates', async () => {
  const protectedRequests = [
    fetch(`${baseUrl}/api/planning/today`),
    fetch(`${baseUrl}/api/planning/following`),
    fetch(`${baseUrl}/api/notifications`),
    fetch(`${baseUrl}/api/notifications/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: true })
    }),
    fetch(`${baseUrl}/api/planning/visits/not-a-uuid/response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acceptanceStatus: 'accepted' })
    }),
    fetch(`${baseUrl}/api/planning/consents`),
    fetch(`${baseUrl}/api/planning/coordinator`),
    fetch(`${baseUrl}/api/planning/professional-location`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: 48.8566, longitude: 2.3522, serviceRadiusKm: 30 })
    }),
    fetch(`${baseUrl}/api/admin/overview`),
    fetch(`${baseUrl}/api/admin/service-partners/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false })
    }),
    fetch(`${baseUrl}/api/admin/service-bookings/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'cancelled' })
    }),
    fetch(`${baseUrl}/api/admin/accounts/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false })
    }),
    fetch(`${baseUrl}/api/admin/care-visits/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduledAt: new Date(Date.now() + 86400000).toISOString() })
    }),
    fetch(`${baseUrl}/api/admin/care-visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipientId: 'not-a-uuid' })
    }),
    fetch(`${baseUrl}/api/planning/services/catalog`),
    fetch(`${baseUrl}/api/planning/services/bookings`),
    fetch(`${baseUrl}/api/planning/visits/not-a-uuid/notes`),
    fetch(`${baseUrl}/api/planning/services/bookings/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'confirmed' })
    }),
    fetch(`${baseUrl}/api/planning/services/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partnerId: 'not-a-uuid' })
    }),
    fetch(`${baseUrl}/api/planning/services/partners`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceType: 'hairdresser' })
    }),
    fetch(`${baseUrl}/api/planning/visits/not-a-uuid/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: 'arrived', note: 'test' })
    }),
    fetch(`${baseUrl}/api/planning/visits/not-a-uuid/evaluation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating: 'red', comment: 'test' })
    }),
    fetch(`${baseUrl}/api/planning/visits/not-a-uuid/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'doctor_recommendation', sourceName: 'Médecin', content: 'Test' })
    }),
    fetch(`${baseUrl}/api/planning/recipients/not-a-uuid/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'Test' })
    })
  ];
  const responses = await Promise.all(protectedRequests);

  assert.ok(responses.every(response => response.status === 401));
});

test('keeps the admin console guarded and free of care-note content', async () => {
  const [page, api] = await Promise.all([
    fetch(`${baseUrl}/admin`),
    fetch(`${baseUrl}/api/admin/overview`)
  ]);
  const html = await page.text();

  assert.equal(page.status, 200);
  assert.match(html, /Espace administrateur/);
  assert.match(html, /Code secret d’administration/);
  assert.match(html, /Créer le rendez-vous/);
  assert.match(html, /Suspendre/);
  assert.match(html, /api\/admin\/overview/);
  assert.doesNotMatch(html, /planning_recipient_notes|doctor_recommendation/);
  assert.equal(api.status, 401);
});

test('separates daily services from care planning', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');

  assert.match(source, /Services du quotidien/);
  assert.match(source, /Agenda des services du quotidien/);
  assert.match(source, /\/api\/planning\/services\/catalog/);
  assert.match(source, /\/api\/planning\/services\/bookings/);
  assert.match(source, /Référencer un partenaire de services/);
  assert.match(source, /billingModel: document\.getElementById\('service-partner-billing'\)/);
  assert.match(source, /Participation après prestation réalisée/);
  assert.match(source, /sans information médicale/);
});

test('captures home positions with consent and shows approximate intervention distances', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const distanceSource = fs.readFileSync(path.join(projectRoot, 'distance.js'), 'utf8');

  assert.match(source, /Rayon d’intervention \(km\)/);
  assert.match(source, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(source, /La personne \(ou son aidant autorisé\) a donné son accord/);
  assert.match(source, /locationConsent: document\.getElementById\('contact-location-consent'\)\.checked/);
  assert.match(source, /À environ \$\{distanceKm\} km de votre point de départ enregistré/);
  assert.match(source, /hors de votre rayon déclaré/);
  assert.match(serverSource, /app\.put\('\/api\/planning\/professional-location'/);
  assert.match(distanceSource, /6371 \* 2 \* Math\.atan2/);
  assert.match(serverSource, /latitude = CASE WHEN \$3 THEN latitude ELSE NULL END/);
});

test('requires acceptance before adding care and service appointments to agendas', () => {
  const appSource = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(projectRoot, 'auth.js'), 'utf8');

  assert.match(appSource, /Notifications et demandes à traiter/);
  assert.match(appSource, /Accepter le rendez-vous/);
  assert.match(appSource, /Refuser/);
  assert.match(appSource, /\/api\/notifications/);
  assert.match(appSource, /\/api\/planning\/visits\/\$\{encodeURIComponent\(notification\.entityId\)\}\/response/);
  assert.match(serverSource, /app\.post\('\/api\/planning\/visits\/:visitId\/response'/);
  assert.match(serverSource, /visit\.acceptance_status = 'accepted'/);
  assert.match(serverSource, /booking\.status != 'requested'/);
  assert.match(serverSource, /'Rendez-vous accepté'/);
  assert.match(authSource, /CREATE TABLE IF NOT EXISTS app_notifications/);
  assert.match(authSource, /acceptance_status IN \('pending', 'accepted', 'declined'\)/);
});

test('allows family evaluation of completed visits and alerts administrators about red ratings', () => {
  const appSource = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  const adminSource = fs.readFileSync(path.join(projectRoot, 'admin.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(projectRoot, 'auth.js'), 'utf8');

  assert.match(appSource, /Satisfaisante/);
  assert.match(appSource, /À améliorer/);
  assert.match(appSource, /Expliquez le problème rencontré/);
  assert.match(appSource, /\/api\/planning\/visits\/\$\{encodeURIComponent\(visit\.id\)\}\/evaluation/);
  assert.match(serverSource, /app\.post\('\/api\/planning\/visits\/:visitId\/evaluation'/);
  assert.match(serverSource, /visit\.status = 'completed'/);
  assert.match(serverSource, /recipient\.senior_id = \$2/);
  assert.match(serverSource, /if \(rating === 'red' && existing\[0\]\?\.rating !== 'red'\)/);
  assert.match(serverSource, /'visit_evaluation_red'/);
  assert.match(serverSource, /redEvaluations:/);
  assert.match(adminSource, /Signalements rouges après intervention/);
  assert.match(authSource, /CREATE TABLE IF NOT EXISTS planning_visit_evaluations/);
  assert.match(authSource, /CHECK \(rating != 'red' OR \(comment IS NOT NULL AND length\(trim\(comment\)\) > 0\)\)/);
});

test('calculates rounded straight-line distance and flags only out-of-radius visits', () => {
  assert.deepEqual(getServiceDistance(0, 0, 0, 0.01, 2), {
    distanceKm: 1,
    outsideServiceRadius: false
  });

  assert.deepEqual(getServiceDistance(0, 0, 0, 1, 100), {
    distanceKm: 111,
    outsideServiceRadius: true
  });
  assert.deepEqual(getServiceDistance(null, 0, 0, 1, 100), {
    distanceKm: null,
    outsideServiceRadius: null
  });
});

test('accepts only valid subscriptions from supported public push services', () => {
  const keys = { p256dh: 'public-key', auth: 'auth-secret' };
  const subscription = endpoint => JSON.stringify({ endpoint, keys });
  assert.equal(isAllowedWebPushSubscription(subscription('https://fcm.googleapis.com/fcm/send/token')), true);
  assert.equal(isAllowedWebPushSubscription(subscription('https://updates.push.services.mozilla.com/wpush/v2/token')), true);
  assert.equal(isAllowedWebPushSubscription(subscription('https://web.push.apple.com/token')), true);
  assert.equal(isAllowedWebPushSubscription(subscription('http://fcm.googleapis.com/token')), false);
  assert.equal(isAllowedWebPushSubscription(subscription('https://fcm.googleapis.com.attacker.example/token')), false);
  assert.equal(isAllowedWebPushSubscription(subscription('https://127.0.0.1/token')), false);
  assert.equal(isAllowedWebPushSubscription(JSON.stringify({ endpoint: 'https://fcm.googleapis.com/' })), false);
});

test('renders live planning controls without demonstration contact data', () => {
  const source = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');

  assert.match(source, /Suivi des interventions/);
  assert.match(source, /Arrivée signalée/);
  assert.match(source, /planningRequest\(`\/api\/planning\/today\?date=/);
  assert.match(source, /planning-previous-day/);
  assert.match(source, /Voir les recommandations et transmissions/);
  assert.match(source, /30 derniers jours/);
  assert.match(source, /importance: document\.getElementById/);
  assert.match(source, /🔵 Information/);
  assert.match(source, /🟠 À suivre/);
  assert.match(source, /🔴 Prioritaire/);
  assert.match(source, /pas une urgence médicale/);
  assert.doesNotMatch(source, /Camille Exemple|Louise Démonstration|Paul Exemple/);
  assert.match(source, /sans donnée médicale/i);
});

test('requires documents and keeps new professionals pending until review', () => {
  const appSource = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const authSource = fs.readFileSync(path.join(projectRoot, 'auth.js'), 'utf8');
  const adminSource = fs.readFileSync(path.join(projectRoot, 'admin.html'), 'utf8');

  assert.match(appSource, /data-document-type="identity"/);
  assert.match(appSource, /data-document-type="kbis"/);
  assert.match(appSource, /10 Mo maximum/);
  assert.match(appSource, /Recevoir les notifications par e-mail/);
  assert.match(appSource, /Recevoir les notifications par SMS/);
  assert.match(serverSource, /app\.patch\('\/api\/admin\/accounts\/:accountId\/verification'/);
  assert.match(serverSource, /La pièce d’identité et le Kbis sont requis/);
  assert.match(serverSource, /matchesDocumentSignature/);
  assert.match(serverSource, /DELETE FROM app_professional_verification_documents WHERE user_id = \$1/);
  assert.match(serverSource, /verification_status = 'approved'/);
  assert.match(authSource, /role === 'pro' \? 'pending' : 'approved'/);
  assert.match(authSource, /CREATE TABLE IF NOT EXISTS app_professional_verification_documents/);
  assert.match(adminSource, /Télécharger/);
  assert.match(adminSource, /Dossier intervenant/);
});

test('requires authentication before creating an urgency video link', async () => {
  const response = await fetch(`${baseUrl}/api/video/urgency`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ senior_id: 1 })
  });
  assert.equal(response.status, 401);
});

test('reports missing authentication database configuration', async () => {
  if (process.env.DATABASE_URL) return;

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'personne@example.com', password: 'motdepasseinvalide' })
  });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /pas configuré/i);
});

test('reports unavailable password recovery and rejects invalid links', async () => {
  if (!process.env.RESEND_API_KEY || !process.env.NOTIFICATIONS_FROM_EMAIL) {
    const request = await fetch(`${baseUrl}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'personne@example.com' })
    });
    assert.equal(request.status, 503);
    assert.match((await request.json()).error, /pas encore configurée/);
  }
  const confirm = await fetch(`${baseUrl}/api/auth/password-reset/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'invalid', password: 'a-valid-password' })
  });
  assert.equal(confirm.status, 400);
});

test('shows terms consent near the start of registration for every role', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'app-mobile.html'), 'utf8');
  const registration = html.slice(html.indexOf('id="register-section"'), html.indexOf('id="legal-guardian-verification-panel"'));
  assert.match(registration, /id="reg-email"[\s\S]*id="reg-terms-accepted"[^>]*type="checkbox"[^>]*required[\s\S]*id="reg-senior-fields"[\s\S]*id="professional-registration-fields"/);
  assert.equal((registration.match(/id="reg-terms-accepted"/g) || []).length, 1);
});

test('requires acceptance of the current terms before account registration', async () => {
  for (const body of [
    {},
    { acceptedTerms: false, acceptedTermsVersion: '2026-11-03' },
    { acceptedTerms: true, acceptedTermsVersion: 'outdated' }
  ]) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /accepter les conditions générales/);
  }
});

test('allows an aidant account to register before any senior has joined', async () => {
  const statements = [];
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes('INSERT INTO app_users')) {
        return {
          rows: [{
            id: params[0],
            senior_id: params[1],
            name: params[2],
            email: params[3],
            role: params[4],
            home_latitude: params[5],
            home_longitude: params[6],
            service_radius_km: params[7],
            verification_status: params[10]
          }]
        };
      }
      return { rows: [] };
    },
    release() {}
  };
  const auth = createAuthService({
    async query() {
      return { rows: [] };
    },
    async connect() {
      return client;
    }
  });

  const result = await auth.register({
    name: 'Camille Aidant',
    email: 'camille@example.com',
    password: 'motdepassevalide',
    role: 'aidant',
    acceptedTerms: true,
    acceptedTermsVersion: '2026-11-03.1'
  });

  assert.equal(result.user.role, 'aidant');
  assert.equal(result.user.seniorName, null);
  assert.deepEqual(
    statements.find(statement => statement.sql.includes('INSERT INTO senior_profiles')).params,
    [result.user.seniorId, 'Camille Aidant']
  );
  assert.ok(statements.some(statement => statement.sql === 'COMMIT'));
});

test('registers legal guardians as pending and limits them to verification until approval', async () => {
  const statements = [];
  const client = {
    async query(sql, params = []) {
      statements.push({ sql, params });
      if (sql.includes('INSERT INTO app_users')) {
        return {
          rows: [{
            id: params[0],
            senior_id: params[1],
            name: params[2],
            email: params[3],
            role: params[4],
            is_legal_guardian: params[14],
            guardian_verification_status: params[14] ? 'pending' : 'not_required'
          }]
        };
      }
      return { rows: [] };
    },
    release() {}
  };
  const auth = createAuthService({
    async query() {
      return { rows: [] };
    },
    async connect() {
      return client;
    }
  });

  const result = await auth.register({
    name: 'Camille Aidant',
    email: 'camille@example.com',
    password: 'motdepassevalide',
    role: 'aidant',
    isLegalGuardian: true,
    acceptedTerms: true,
    acceptedTermsVersion: '2026-11-03.1'
  });

  assert.equal(result.user.isLegalGuardian, true);
  assert.equal(result.user.guardianVerificationStatus, 'pending');
  assert.equal(statements.find(statement => statement.sql.includes('INSERT INTO app_users')).params[14], true);

  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const adminSource = fs.readFileSync(path.join(projectRoot, 'admin.html'), 'utf8');
  assert.match(serverSource, /guardianVerificationStatus !== 'approved' && !canPendingLegalGuardianAccess\(req\)/);
  assert.match(serverSource, /document_type IN \('identity', 'guardianship'\)/);
  assert.match(serverSource, /app\.patch\('\/api\/admin\/accounts\/:accountId\/guardian-verification'/);
  assert.match(serverSource, /DELETE FROM app_legal_guardian_verification_documents WHERE user_id = \$1/);
  assert.match(adminSource, /downloadGuardianDocument/);
  assert.match(adminSource, /linkSenior/);
  assert.match(adminSource, /unlinkSenior/);
});

test('limits shared wellbeing check-ins to the selected senior and verified guardianship links', () => {
  const serverSource = fs.readFileSync(path.join(projectRoot, 'server.js'), 'utf8');
  const policy = fs.readFileSync(path.join(projectRoot, 'privacy-policy.html'), 'utf8')
    .replace(/\s+/g, ' ');

  assert.match(serverSource, /app\.get\('\/api\/wellbeing\/shared-check-ins', requireAuth, requireAidantSeniorContext/);
  assert.match(serverSource, /WHERE owner\.senior_id = \$2/);
  assert.match(serverSource, /guardian\.guardian_verification_status = 'approved'/);
  assert.match(policy, /pièce d’identité et la preuve officielle de tutelle sont requises avant validation/);
  assert.match(policy, /Après validation, les fichiers justificatifs sont supprimés/);
  assert.match(policy, /sans demande de consentement séparée dans l’application/);
});

test('requires authentication to create or process account closure requests', async () => {
  const requests = [
    fetch(`${baseUrl}/api/account/closure-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'valid-password' })
    }),
    fetch(`${baseUrl}/api/admin/account-closure-requests`),
    fetch(`${baseUrl}/api/admin/account-closure-requests/123e4567-e89b-42d3-a456-426614174000/ai-review`, {
      method: 'POST'
    }),
    fetch(`${baseUrl}/api/admin/account-closure-requests/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'completed', resolutionNote: 'Effacement vérifié.' })
    })
  ];
  const responses = await Promise.all(requests);
  assert.ok(responses.every(response => response.status === 401));
});

test('closes an account only after confirming its password and records the erasure request', async () => {
  const credentials = await hashPassword('correct-password-123');
  let active = true;
  const deletedTables = [];
  const pool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({
      query: async (sql, values = []) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
        if (sql.includes('SELECT id, is_active, password_salt, password_hash')) {
          return {
            rows: active
              ? [{
                  id: 'user-id',
                  is_active: active,
                  password_salt: credentials.salt,
                  password_hash: credentials.hash
                }]
              : []
          };
        }
        if (sql.includes('INSERT INTO app_account_closure_requests')) {
          return { rows: [{ id: values[0], requested_at: new Date('2026-11-03T00:00:00Z') }] };
        }
        if (sql.includes('UPDATE app_users')) {
          active = false;
          return { rows: [] };
        }
        if (sql.startsWith('DELETE FROM')) {
          deletedTables.push(sql.match(/DELETE FROM ([a-z_]+)/)[1]);
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      release() {}
    })
  };
  const authService = createAuthService(pool);

  await assert.rejects(
    authService.requestAccountClosure('user-id', 'incorrect-password'),
    error => error.status === 401
  );
  assert.equal(active, true);
  assert.deepEqual(deletedTables, []);

  const result = await authService.requestAccountClosure('user-id', 'correct-password-123');
  assert.equal(active, false);
  assert.ok(result.requestId);
  assert.ok(result.requestedAt);
  assert.deepEqual(deletedTables.sort(), [
    'app_google_calendar_oauth_states',
    'app_push_subscriptions',
    'app_sessions',
    'app_user_contacts'
  ]);
});

test('stores passwords as verifiable salted hashes', async () => {
  const credentials = await hashPassword('un-mot-de-passe-solide');

  assert.notEqual(credentials.hash, 'un-mot-de-passe-solide');
  assert.notEqual(credentials.salt, '');
  assert.equal(await verifyPassword('un-mot-de-passe-solide', credentials.salt, credentials.hash), true);
  assert.equal(await verifyPassword('mauvais-mot-de-passe', credentials.salt, credentials.hash), false);
});
