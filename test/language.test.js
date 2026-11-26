const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'language.js'), 'utf8');

function setup(initialLanguage = 'fr', texts = ['Date de naissance', 'Chargement des messages…']) {
  const listeners = new Map();
  const nodes = texts.map(textContent => ({
    textContent, parentElement: { closest: () => false }
  }));
  const attributes = new Map([['aria-label', 'Adresse e-mail']]);
  const field = {
    hasAttribute: name => attributes.has(name),
    getAttribute: name => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value)
  };
  const makeElement = () => ({
    setAttribute() {}, addEventListener() {}, append() {}
  });
  const window = {
    localStorage: { getItem: () => initialLanguage, setItem() {} },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) || []) callback(event);
    }
  };
  let ready;
  const document = {
    documentElement: {},
    body: { insertBefore() {}, querySelectorAll: () => [field] },
    head: { append() {} },
    createElement: makeElement,
    querySelectorAll: () => [],
    addEventListener(name, callback) { if (name === 'DOMContentLoaded') ready = callback; },
    createTreeWalker() {
      let index = 0;
      return {
        nextNode() { if (index >= nodes.length) return false; this.currentNode = nodes[index++]; return true; }
      };
    }
  };
  vm.runInNewContext(source, {
    window, document, NodeFilter: { SHOW_TEXT: 4 },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    console
  });
  ready();
  return { window, document, nodes, attributes };
}

test('static text and labels translate and return to French', () => {
  const app = setup('en');
  assert.equal(app.nodes[0].textContent, 'Date of birth');
  assert.equal(app.attributes.get('aria-label'), 'Email address');
  app.window.generationLiaisonSetLanguage('fr');
  assert.equal(app.nodes[0].textContent, 'Date de naissance');
  assert.equal(app.attributes.get('aria-label'), 'Adresse e-mail');
  app.window.generationLiaisonSetLanguage('en');
  assert.equal(app.nodes[0].textContent, 'Date of birth');
  assert.equal(app.document.documentElement.lang, 'en');
  assert.equal(app.window.generationLiaisonTranslate('Messages avec mes contacts'), 'Messages with my contacts');
  assert.equal(app.window.generationLiaisonTranslate('Choisir un correspondant'), 'Choose a contact');
  assert.equal(app.window.generationLiaisonTranslate('Choisissez votre mot de passe personnel'), 'Choose your personal password');
  assert.equal(app.window.generationLiaisonTranslate('Pour activer un compte créé par l’administration, j’accepte les'), 'To activate an account created by the administration, I accept the');
  assert.equal(app.window.generationLiaisonTranslate(' et la '), ' and the ');
  assert.equal(app.window.generationLiaisonTranslate('Les conditions et la politique de confidentialité sont actuellement en français.'), 'The terms and privacy policy are currently in French.');
  assert.match(app.window.generationLiaisonTranslate('Le Kbis est un justificatif français. Pour une activité à l’étranger, contactez l’équipe avant l’inscription.'), /contact the team before registering/);
  assert.match(app.window.generationLiaisonTranslate('Dites : « Je confirme l’appel d’urgence ». Aucun composeur ne sera ouvert si la phrase n’est pas reconnue.'), /Say in French/);
  assert.match(app.window.generationLiaisonTranslate('Vous avez indiqué avoir besoin d’aide. En France, choisissez le 112 ou, en cas d’incendie, le 18. Dans un autre pays, contactez les secours locaux. Une seconde confirmation sera demandée avant l’alerte aux aidants et l’ouverture du composeur.'), /In another country, contact local emergency services/);
  assert.equal(app.window.generationLiaisonTranslate('Vos rendez-vous autorisés, heure de Paris'), 'Your authorized appointments, Paris time');
  assert.equal(
    app.window.generationLiaisonTranslate('En France, utilisez ces numéros. Dans un autre pays, contactez les secours locaux.'),
    'Use these numbers in France. In another country, contact local emergency services.'
  );
  assert.match(
    app.window.generationLiaisonTranslate('Pour confirmer par la voix, dites : « Je confirme l’appel d’urgence ». La confirmation vocale dépend du navigateur et peut être traitée par son fournisseur ; Génération Liaison ne conserve pas l’audio. Le bouton de confirmation reste disponible.'),
    /say in French: “Je confirme l’appel d’urgence”/
  );
});

test('account activation identifies the language of its legal documents', () => {
  const resetPage = fs.readFileSync(path.join(__dirname, '..', 'reset-password.html'), 'utf8');
  assert.match(resetPage, /<form id="reset-form"[^>]*>[\s\S]*Les conditions et la politique de confidentialité sont actuellement en français\.[\s\S]*<\/form>/);
});

test('the Android installation guide translates its security warning', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'aide-installation-android.html'), 'utf8');
  assert.match(page, /<script src="\/language\.js"><\/script>/);
  const warning = page.match(/<h2>2\. Vérifier la source<\/h2><p>([^<]+)<\/p>/)[1];
  const app = setup('en', [warning]);
  assert.match(app.nodes[0].textContent, /Do not allow it if you are unsure/);
  app.window.generationLiaisonSetLanguage('fr');
  assert.equal(app.nodes[0].textContent, warning);
});

test('changing language preserves the active color and riddle games', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const start = page.indexOf("    let couleurJeu = 'Rouge';");
  const end = page.indexOf('    function annulerDicteeMessage()', start);
  assert.ok(start >= 0 && end > start);
  const app = setup();
  const elements = {};
  const context = {
    window: app.window,
    document: { getElementById: id => elements[id] ||= {
      textContent: '', attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }
    } },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(page.slice(start, end), context);
  context.nouvelleCouleur();
  context.nouvelleDevinette();
  context.repondreDevinette(0);
  context.devinerNombre(2);
  assert.match(elements['color-game-question'].textContent, /Bleu/);
  assert.equal(elements['riddle-game-label-1'].textContent, 'La banane');
  app.window.generationLiaisonSetLanguage('en');
  context.traduireTextesJeux();
  assert.equal(elements['color-game-question'].textContent, 'Choose the word: Blue');
  assert.equal(elements['riddle-game-label-1'].textContent, 'The banana');
  assert.match(elements['riddle-game-status'].textContent, /try again/);
  assert.equal(elements['number-game-status'].textContent, 'The number is less than 2.');
  context.repondreDevinette(1);
  assert.match(elements['riddle-game-status'].textContent, /Well done/);
  app.window.generationLiaisonSetLanguage('fr');
  context.traduireTextesJeux();
  assert.equal(elements['color-game-question'].textContent, 'Choisissez le mot : Bleu');
  assert.equal(elements['riddle-game-label-1'].textContent, 'La banane');
  assert.match(elements['riddle-game-status'].textContent, /Bravo/);
});

test('changing language keeps board positions and updates accessible game labels', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const start = page.indexOf("    let couleurJeu = 'Rouge';");
  const end = page.indexOf('    function annulerDicteeMessage()', start);
  const app = setup();
  const node = () => ({
    textContent: '', children: [], attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); },
    appendChild(child) { this.children.push(child); }
  });
  const elements = {};
  const context = {
    window: app.window,
    document: {
      getElementById: id => elements[id] ||= node(),
      createElement: node,
      createElementNS: node
    },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(page.slice(start, end), context);
  context.nouveauMorpion();
  context.jouerMorpion(4);
  context.retournerCarte(0);
  context.nouveauSudoku();
  context.nouvelleSuite();
  elements['sequence-answer'].value = '32';
  const cells = elements['sudoku-grid'].children;
  const editable = cells.find(cell => !cell.readOnly);
  editable.value = '3';
  app.window.generationLiaisonSetLanguage('en');
  context.traduireTextesJeux();
  assert.equal(elements['morpion-4'].textContent, 'X');
  assert.equal(elements['morpion-4'].attributes['aria-label'], 'Row 2, column 2: cross');
  assert.equal(elements['memory-0'].attributes['aria-label'], 'Card 1: Apple');
  assert.equal(editable.value, '3');
  assert.match(editable.attributes['aria-label'], /^Row .*to be filled in$/);
  assert.match(elements['sudoku-status'].textContent, /^Fill the white cells/);
  assert.equal(elements['sequence-answer'].value, '32');
  assert.match(elements['sequence-hint'].textContent, /^Hint:/);
});

test('word search keeps its language and progress when the interface language changes', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const start = page.indexOf("    let couleurJeu = 'Rouge';");
  const end = page.indexOf('    function annulerDicteeMessage()', start);
  const app = setup('en');
  const node = () => ({
    textContent: '', children: [], attributes: {}, handlers: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); }
  });
  const elements = {};
  const context = {
    window: app.window,
    document: { getElementById: id => elements[id] ||= node(), createElement: node },
    Math: { random: () => 0, floor: Math.floor, abs: Math.abs, max: Math.max, sign: Math.sign }
  };
  vm.runInNewContext(page.slice(start, end), context);
  context.initialiserMotsMeles();
  const grid = elements['word-grid'].children;
  const words = Array.from(vm.runInNewContext('themesMotsMelesActifs[themeMotsMeles].mots', context));
  assert.ok(words.includes('GARDEN'));
  function findWord(word) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const er = r + dr * (word.length - 1), ec = c + dc * (word.length - 1);
        if (er < 0 || er >= 8 || ec < 0 || ec >= 8) continue;
        if ([...word].every((letter, i) => grid[(r + dr * i) * 8 + c + dc * i].textContent === letter)) {
          return [r * 8 + c, er * 8 + ec];
        }
      }
    }
    return null;
  }
  for (const word of words) assert.ok(findWord(word), `${word} must be in the grid`);
  const [first, last] = findWord('GARDEN');
  context.choisirLettreMot(first);
  context.choisirLettreMot(last);
  app.window.generationLiaisonSetLanguage('fr');
  context.traduireTextesJeux();
  assert.equal(elements['word-grid'].children, grid);
  assert.equal(elements['word-language'].textContent, 'Les mots de cette grille sont en anglais.');
  assert.match(grid[first].className, /found/);
  context.nouveauxMotsMeles();
  assert.equal(elements['word-language'].textContent, 'Les mots de cette grille sont en français.');
  assert.notEqual(elements['word-grid'].children, grid);
});

test('English crosswords have valid crossings and retain answers when the language changes', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const start = page.indexOf("    let couleurJeu = 'Rouge';");
  const end = page.indexOf('    function annulerDicteeMessage()', start);
  const app = setup('en');
  const node = () => ({
    value: '', textContent: '', children: [], attributes: {}, handlers: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, handler) { this.handlers[name] = handler; },
    replaceChildren() { this.children = []; },
    append(child) { this.children.push(child); }
  });
  const elements = {};
  const context = {
    window: app.window,
    document: { getElementById: id => elements[id] ||= node(), createElement: node },
    Math: { random: () => 0, floor: Math.floor }
  };
  vm.runInNewContext(page.slice(start, end), context);
  const puzzles = vm.runInNewContext('grillesMotsCroisesEn', context);
  for (const puzzle of puzzles) {
    const positions = new Map();
    for (const word of puzzle.mots) {
      for (let i = 0; i < word.mot.length; i++) {
        const row = word.ligne + (word.direction === 'vertical' ? i : 0);
        const col = word.colonne + (word.direction === 'horizontal' ? i : 0);
        assert.ok(row >= 0 && row < 13 && col >= 0 && col < 13);
        const key = `${row},${col}`, previous = positions.get(key);
        if (previous) {
          assert.equal(previous.letter, word.mot[i]);
          assert.notEqual(previous.direction, word.direction);
        } else positions.set(key, { letter: word.mot[i], direction: word.direction });
      }
    }
    for (const word of puzzle.mots) {
      assert.ok([...word.mot].some((_, i) => {
        const row = word.ligne + (word.direction === 'vertical' ? i : 0);
        const col = word.colonne + (word.direction === 'horizontal' ? i : 0);
        return puzzle.mots.some(other => other !== word && [...other.mot].some((__, j) =>
          other.ligne + (other.direction === 'vertical' ? j : 0) === row &&
          other.colonne + (other.direction === 'horizontal' ? j : 0) === col));
      }));
    }
    context.nouveauxMotsCroises();
    const entries = vm.runInNewContext('casesMotsCroises', context);
    for (const entry of entries) entry.input.value = entry.lettre;
    context.verifierMotsCroises();
    assert.match(elements['crossword-status'].textContent, /Well done/);
  }
  const grid = elements['crossword-grid'].children;
  app.window.generationLiaisonSetLanguage('fr');
  context.traduireTextesJeux();
  assert.equal(elements['crossword-grid'].children, grid);
  assert.equal(elements['crossword-language'].textContent, 'Les mots de cette grille sont en anglais.');
  context.verifierMotsCroises();
  assert.match(elements['crossword-status'].textContent, /Bravo/);
  context.nouveauxMotsCroises();
  assert.equal(elements['crossword-language'].textContent, 'Les mots de cette grille sont en français.');
});

test('English administration announcements translate controls without changing the message', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = page.indexOf("    document.getElementById('admin-announcement-form').addEventListener");
  const end = page.indexOf('    function showLoginError', start);
  assert.ok(start >= 0 && end > start);
  const app = setup('en');
  const button = { disabled: false };
  const nodes = {
    'admin-announcement-form': { addEventListener(name, callback) { this.submit = callback; } },
    'admin-announcement-audience': { options: [{ text: 'All accounts' }], selectedIndex: 0, value: 'all' },
    'admin-announcement-title': { value: 'Bonjour' },
    'admin-announcement-message': { value: 'Message personnel' },
    'admin-announcement-status': { textContent: '' }
  };
  let request, confirmation;
  const context = {
    window: app.window, document: { getElementById: id => nodes[id] },
    confirm: text => { confirmation = text; return true; },
    adminRequest: async (url, options) => { request = { url, ...options }; return { recipients: 2 }; }
  };
  vm.runInNewContext(page.slice(start, end), context);
  await nodes['admin-announcement-form'].submit({
    preventDefault() {}, currentTarget: { querySelector: () => button }
  });
  assert.equal(confirmation, 'Send this notification to: All accounts?');
  assert.equal(request.body.title, 'Bonjour');
  assert.equal(request.body.message, 'Message personnel');
  assert.equal(nodes['admin-announcement-status'].textContent, 'Notification saved for 2 account(s).');
  assert.equal(button.disabled, false);
});

test('English linked-account form preserves the consent and temporary-password warnings', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const start = page.indexOf('    function createEstablishmentAccountForm(item)');
  const end = page.indexOf('    function establishmentTariff(count)', start);
  assert.ok(start >= 0 && end > start);
  const app = setup('en');
  const node = () => ({
    value: '', checked: false, children: [], handlers: {},
    append(...children) { this.children.push(...children); },
    setAttribute() {},
    addEventListener(name, callback) { this.handlers[name] = callback; },
    reset() {}
  });
  let request;
  const context = {
    window: app.window, document: { createElement: node },
    adminRequest: async (url, options) => { request = { url, ...options }; return { identifier: 'abc123' }; }
  };
  vm.runInNewContext(page.slice(start, end), context);
  const details = context.createEstablishmentAccountForm({ id: 'one', active: true, account_active: true });
  assert.match(details.children[1].textContent, /Anyone who knows that password can activate the account/);
  assert.match(details.children[1].textContent, /separate consent/);
  const form = details.children[2];
  assert.match(form.children[5].textContent, /agreement/);
  assert.equal(form.children[0].children[0].children[1].textContent, 'Care worker');
  const inputs = form.children.slice(0, 6).map(label => label.children[0]);
  [inputs[0].value, inputs[1].value, inputs[2].value, inputs[3].value, inputs[4].value] =
    ['senior', 'Camille', 'Exemple', '1940-05-01', 'mot-provisoire-123'];
  inputs[5].checked = true;
  await form.handlers.submit({ preventDefault() {} });
  assert.equal(request.body.confirmed, true);
  assert.equal(request.body.password, 'mot-provisoire-123');
  assert.match(form.children[7].textContent, /abc123/);
  assert.doesNotMatch(form.children[7].textContent, /mot-provisoire/);
});

test('English facility journal preserves the consent choice and personal messages', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const start = page.indexOf('    async function chargerCarnetEtablissement(role, before');
  const end = page.indexOf("    for (const role of ['staff', 'aidant'])", start);
  assert.ok(start >= 0 && end > start);
  const app = setup('en');
  const node = () => ({
    value: '', textContent: '', children: [], dataset: {}, handlers: {},
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    querySelector() { return null; },
    setAttribute() {},
    addEventListener(name, callback) { this.handlers[name] = callback; }
  });
  const nodes = {};
  const element = id => nodes[id] ||= node();
  let allowed = false, confirmation;
  const context = {
    window: app.window, document: { getElementById: element, createElement: node },
    connectedUser: { id: 'one', role: 'senior' }, activeSeniorProfileId: 'senior', careLoadId: 0,
    SERVER_URL: '', URLSearchParams, Date, authHeaders: () => ({}),
    confirm: text => { confirmation = text; return false; },
    fetch: async url => url === '/api/care/consent'
      ? { establishment: { establishment_name: 'Maison du Parc', consented: allowed } }
      : { entries: [{ kind: 'message', author_name: 'Camille', created_at: '2026-01-01T00:00:00Z', content: 'Bonjour, tout va bien.' }] },
    readResponse: async response => response
  };
  vm.runInNewContext(page.slice(start, end), context);
  await context.chargerCarnetEtablissement('senior');
  assert.equal(element('care-senior-consent').children[0].textContent, 'Maison du Parc : sharing not allowed.');
  assert.equal(element('care-senior-status').textContent, 'The journal is not shared.');
  await element('care-senior-consent').children[1].handlers.click();
  assert.match(confirmation, /private exchanges between family and care staff/);
  allowed = true;
  await context.chargerCarnetEtablissement('senior');
  assert.equal(element('care-senior-consent').children[1].textContent, 'Withdraw this consent');
  assert.match(element('care-senior-entries').children[0].textContent, /Bonjour, tout va bien\.$/);
});

test('English wellbeing check-in sends the selected language without translating personal text', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const start = page.indexOf("    document.getElementById('wellbeing-checkin-form').addEventListener('submit'");
  const end = page.indexOf('    async function chargerAssistantConversation()', start);
  assert.ok(start >= 0 && end > start);
  const app = setup('en');
  const nodes = {
    'wellbeing-checkin-form': { addEventListener(name, callback) { this.submit = callback; } },
    'wellbeing-checkin-response': { value: 'Texte personnel.' },
    'wellbeing-checkin-submit': { disabled: false },
    'wellbeing-checkin-status': {},
    'wellbeing-share-confirmation': { checked: false }
  };
  let sent;
  const context = {
    window: app.window,
    document: { getElementById: id => nodes[id], querySelectorAll: () => [] },
    connectedUser: { id: 'alice', role: 'senior' },
    wellbeingLoadedDate: 'today', wellbeingLoadId: 1, currentWellbeingCheckin: null,
    humeurBienEtre: 'mal', humeursBienEtre: { mal: { message: 'Je ne me sens pas bien.' } },
    dateCheckinBienEtre: () => 'today',
    planningRequest: async (url, options) => { sent = options.body; return { checkin: {}, sharedWithCount: 0 }; },
    afficherCheckinBienEtre() {}
  };
  vm.runInNewContext(page.slice(start, end), context);
  await nodes['wellbeing-checkin-form'].submit({ preventDefault() {} });
  assert.equal(sent.language, 'en');
  assert.equal(sent.message, 'I do not feel well. Texte personnel.');
  assert.equal(nodes['wellbeing-checkin-status'].textContent, 'Your answer was saved. It was not shared.');
});

test('English wellbeing displays translate labels but preserve saved and shared personal text', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const node = () => ({
    children: [], append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; }
  });
  const elements = {
    'wellbeing-checkin-form': node(), 'wellbeing-checkin-result': node(),
    'wellbeing-safety-result': node(), 'aidant-wellbeing-shared': node()
  };
  let response = { checkins: [] };
  const context = {
    window: app.window, connectedUser: { role: 'aidant' }, wellbeingSafetyTimer: null,
    document: { getElementById: id => elements[id] },
    makeTextElement: (tag, text) => ({ tag, textContent: text, setAttribute() {} }),
    afficherSuiviSecuriteBienEtre() {},
    planningRequest: async () => response
  };
  const showStart = page.indexOf('    function afficherCheckinBienEtre(checkin)');
  const showEnd = page.indexOf('    function afficherSuiviSecuriteBienEtre', showStart);
  const sharedStart = page.indexOf('    async function chargerCheckinsPartages()');
  const sharedEnd = page.indexOf("    document.getElementById('wellbeing-aidant-contacts').addEventListener", sharedStart);
  assert.ok(showStart >= 0 && showEnd > showStart && sharedStart >= 0 && sharedEnd > sharedStart);
  vm.runInNewContext(page.slice(showStart, showEnd) + page.slice(sharedStart, sharedEnd), context);
  context.afficherCheckinBienEtre({ response: 'Votre réponse', assistantReply: 'Votre réponse' });
  const rendered = elements['wellbeing-checkin-result'].children.map(child => child.textContent);
  assert.match(rendered[0], /automatically deleted after 30 days/);
  assert.deepEqual(rendered.slice(1), ['Your answer', 'Votre réponse', 'Your AI assistant’s answer', 'Votre réponse']);
  await context.chargerCheckinsPartages();
  assert.equal(elements['aidant-wellbeing-shared'].children[0].textContent, 'No wellbeing check-ins have been shared with you yet.');
  response = { checkins: [{ seniorName: 'Votre réponse', response: 'Votre réponse', createdAt: '2026-01-01T12:00:00Z' }] };
  context.document.createElement = node;
  await context.chargerCheckinsPartages();
  const shared = elements['aidant-wellbeing-shared'].children[0].children;
  assert.match(shared[0].textContent, /^Votre réponse · /);
  assert.equal(shared[1].textContent, 'Votre réponse');
  context.planningRequest = async () => { throw new Error(); };
  await context.chargerCheckinsPartages();
  assert.equal(elements['aidant-wellbeing-shared'].children[0].textContent, 'Unable to load shared wellbeing check-ins.');
});

test('switching wellbeing language preserves the safety timer, actions and personal text', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup();
  const node = () => ({
    children: [], attributes: {}, textContent: '', listeners: {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, callback) { this.listeners[name] = callback; },
    querySelectorAll() {
      return this.children.flatMap(child => [
        ...(Object.hasOwn(child.attributes || {}, 'data-wellbeing-translation') ? [child] : []),
        ...(child.querySelectorAll ? child.querySelectorAll() : [])
      ]);
    }
  });
  const elements = {
    'wellbeing-checkin-form': node(), 'wellbeing-checkin-result': node(),
    'wellbeing-safety-result': node()
  };
  let timers = 0;
  let cleared = 0;
  app.window.setTimeout = () => { timers++; return timers; };
  app.window.clearTimeout = () => { cleared++; };
  const context = {
    window: app.window, wellbeingSafetyTimer: null,
    document: { getElementById: id => elements[id], createElement: node },
    makeTextElement: (tag, text) => Object.assign(node(), { textContent: text }),
    enregistrerReponseSecurite() {}
  };
  const start = page.indexOf('    function afficherCheckinBienEtre(checkin)');
  const end = page.indexOf('    async function enregistrerReponseSecurite', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  app.window.addEventListener('generationliaisonlanguagechange', context.actualiserLangueBienEtre);
  context.afficherCheckinBienEtre({
    id: 'check-1', response: 'Votre réponse', assistantReply: 'Votre réponse',
    safetyConcern: true, safetyCheckStatus: 'awaiting_response'
  });
  const result = elements['wellbeing-checkin-result'].children;
  const safety = elements['wellbeing-safety-result'].children[0].children;
  const buttons = safety[2].children;
  const click = buttons[0].listeners.click;
  app.window.generationLiaisonSetLanguage('en');
  assert.equal(result[1].textContent, 'Your answer');
  assert.equal(result[2].textContent, 'Votre réponse');
  assert.equal(result[4].textContent, 'Votre réponse');
  assert.equal(buttons[0].textContent, 'Yes, I am safe');
  assert.equal(buttons[0].listeners.click, click);
  assert.equal(timers, 1);
  assert.equal(cleared, 0);
  safety[1].textContent = 'Erreur de connexion';
  app.window.generationLiaisonSetLanguage('fr');
  assert.equal(safety[1].textContent, 'Erreur de connexion');
  assert.equal(buttons[0].textContent, 'Oui, je suis en sécurité');
  assert.equal(timers, 1);
  assert.equal(cleared, 0);
  context.afficherCheckinBienEtre({
    id: 'check-1', response: 'Votre réponse', assistantReply: 'Votre réponse',
    safetyConcern: true, safetyCheckStatus: 'no_response', safetyNotifiedAidants: 2
  });
  app.window.generationLiaisonSetLanguage('en');
  assert.match(elements['wellbeing-safety-result'].children[0].children[1].textContent, /2 caregiver/);
  context.afficherCheckinBienEtre({
    id: 'check-1', response: 'Votre réponse', assistantReply: 'Votre réponse',
    safetyConcern: true, safetyCheckStatus: 'emergency_confirmed', safetyNotifiedAidants: 2
  });
  const confirmed = elements['wellbeing-safety-result'].children[0].children[1];
  assert.match(confirmed.textContent, /selected number.*2 caregiver/);
  app.window.generationLiaisonSetLanguage('fr');
  assert.match(confirmed.textContent, /numéro choisi.*2 aidant/);
});

test('English safety inbox translates the known automatic alert but not personal messages', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const node = () => ({
    children: [], textContent: '',
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener() {}
  });
  const elements = {};
  const element = id => elements[id] ||= node();
  const alert = 'Le senior n’a pas répondu à la question de sécurité après sa vérification de bien-être. Veuillez essayer de le joindre. L’application n’a pas appelé les secours et ne peut pas vérifier son état.';
  const translated = 'The senior did not answer the safety question after their wellbeing check-in. Please try to contact them. The app did not call emergency services and cannot verify their condition.';
  const context = {
    window: app.window, connectedUser: { id: 'alice', role: 'aidant' }, inboxLoadId: 0,
    document: { getElementById: element, createElement: node },
    makeTextElement: (tag, text) => ({ tag, textContent: text }),
    formatDateTime: value => value,
    planningRequest: async path => path.endsWith('safety-alerts')
      ? { messages: [
        { id: 's1', seniorName: 'Votre réponse', body: alert, createdAt: '2026-01-03' },
        { id: 's2', seniorName: 'Marie', body: 'Message automatique non reconnu', createdAt: '2026-01-02' }
      ] }
      : { messages: [{ id: 'private', senderName: 'Alex', body: alert, createdAt: '2026-01-01' }] }
  };
  const start = page.indexOf('    function traduireMessageSecurite(body)');
  const end = page.indexOf('    async function chargerCorrespondants(role)', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  await context.chargerMessagesSecurite();
  const safety = element('safety-messages-aidant').children;
  assert.equal(safety[0].children[0].textContent, 'Automatic message for Votre réponse');
  assert.equal(safety[0].children[1].textContent, translated);
  assert.equal(safety[1].children[1].textContent, 'Message automatique non reconnu');
  await context.chargerBoiteReception('aidant');
  const inbox = element('aidant-today-inbox').children;
  assert.equal(inbox[0].children[1].textContent, translated);
  assert.equal(inbox[2].children[1].textContent, alert);
  const emergency = 'Marie a confirmé une demande d’appel au 112 à 26/11/2026 20:45:00. L’application ne peut pas vérifier que l’appel a été passé ou abouti.';
  assert.equal(context.traduireMessageSecurite(emergency),
    'Marie confirmed a request to call 112 at 26/11/2026 20:45:00 (Paris time). The app cannot verify that the call was placed or connected.');
  const clarified = emergency.replace('20:45:00.', '20:45:00 (heure de Paris).');
  assert.equal(context.traduireMessageSecurite(clarified),
    'Marie confirmed a request to call 112 at 26/11/2026 20:45:00 (Paris time). The app cannot verify that the call was placed or connected.');
  assert.match(context.traduireMessageSecurite(emergency.replace('Marie', '{number}')),
    /^\{number\} confirmed a request to call 112/);
  const unfamiliar = emergency.replace('112', '999');
  assert.equal(context.traduireMessageSecurite(unfamiliar), unfamiliar);
  app.window.generationLiaisonSetLanguage('fr');
  assert.equal(context.traduireMessageSecurite(emergency), clarified);
  assert.equal(context.traduireMessageSecurite(clarified), clarified);
  assert.match(page, /Certains messages automatiques de sécurité sont actuellement en français\./);
});

test('English appointment invitations translate actions and read state without changing their content', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const rect = { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 };
  const node = () => ({
    children: [], textContent: '', isConnected: true, listeners: {},
    classList: { contains: () => true, remove() {} },
    getBoundingClientRect: () => rect,
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener(event, callback) { this.listeners[event] = callback; }
  });
  const elements = {};
  const element = id => elements[id] ||= node();
  let timer;
  const requests = [];
  app.window.innerWidth = 100;
  app.window.innerHeight = 100;
  const context = {
    window: app.window, connectedUser: { id: 'alice', role: 'aidant' },
    notificationLoadId: 0, notificationReadEntries: [],
    document: { hidden: false, getElementById: element, createElement: node, querySelectorAll: () => [] },
    setTimeout: (callback, delay) => { assert.equal(delay, 2000); timer = callback; return 1; },
    clearTimeout() {}, formatDateTime: () => 'date',
    makeTextElement: (tag, text) => Object.assign(node(), { tag, textContent: text }),
    planningRequest: async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/notifications') return {
        unreadCount: 1,
        notifications: [{ id: 'invite', type: 'care_visit_invite', entityStatus: 'pending',
          title: 'Votre réponse', message: 'Votre réponse', read: false, createdAt: '2026-01-01' }]
      };
      return {};
    },
    repondreInvitation() {}, showToast() {}
  };
  const start = page.indexOf('    function actualiserCompteurNotifications(count)');
  const end = page.indexOf('    function traduireMessageSecurite(body)', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  await context.chargerNotifications();
  const card = element('notifications-aidant').children[0];
  assert.equal(card.children[0].textContent, 'Votre réponse');
  assert.equal(card.children[1].textContent, 'Votre réponse');
  assert.equal(card.children[2].children[0].textContent, 'Unread');
  assert.equal(card.children[3].children[0].textContent, 'Accept the appointment');
  assert.equal(card.children[3].children[1].textContent, 'Reject');
  assert.equal(element('home-notification-count-aidant').textContent, '1 unread');
  await timer();
  assert.equal(card.children[2].children[0].textContent, 'Read');
  assert.equal(requests[1].options.method, 'PATCH');
});

test('English announcements translate controls and preserve messages from staff', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const node = () => ({
    children: [], style: {}, textContent: '', listeners: {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener(event, callback) { this.listeners[event] = callback; }
  });
  const elements = {};
  const element = id => elements[id] ||= node();
  const item = { id: 'notice', title: 'Votre réponse', message: 'Votre réponse',
    type: 'establishment_announcement', read: false, createdAt: '2026-01-01' };
  const context = {
    window: app.window, connectedUser: { id: 'resident' }, announcementLoadId: 0,
    document: { getElementById: element, createElement: node },
    makeTextElement: (tag, text) => Object.assign(node(), { tag, textContent: text }),
    formatDateTime: value => value,
    seniorLinksRequest: async (url, options) => {
      if (options) item.read = true;
      return options ? { read: true } : { announcements: [item] };
    }
  };
  const start = page.indexOf('    async function chargerMessagesAdministration()');
  const end = page.indexOf('    async function chargerNotifications()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  await context.chargerMessagesAdministration();
  const card = element('admin-announcements-list').children[0];
  assert.equal(element('admin-announcements-summary').textContent, 'Messages from the team and the facility (1 unread)');
  assert.equal(card.children[0].textContent, 'Your facility');
  assert.equal(card.children[1].textContent, 'Votre réponse');
  assert.equal(card.children[2].textContent, 'Votre réponse');
  assert.match(card.children[3].textContent, /Unread/);
  assert.equal(card.children[4].textContent, 'Mark as read');
  await card.children[4].listeners.click();
  assert.equal(element('admin-announcements-summary').textContent, 'Messages from the team and the facility');
  assert.match(element('admin-announcements-list').children[0].children[3].textContent, /Read/);
});

test('calendar labels show Paris time and translate controls without altering event details', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const context = { window: app.window, Intl, Date };
  const start = page.indexOf('    function calendarEventLabel(event)');
  const end = page.indexOf('    function etapesIntervenant(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  const event = { scheduledAt: '2026-03-29T01:30:00Z', kind: 'visit',
    title: 'Visite', person: 'Votre réponse', status: 'pending', conflict: true };
  assert.equal(context.calendarEventLabel(event), '03:30 · Visit : Visite — Votre réponse (pending) ⚠ overlap');
  app.window.generationLiaisonSetLanguage('fr');
  assert.equal(context.calendarEventLabel(event), '03:30 · Visite : Visite — Votre réponse (en attente) ⚠ chevauchement');
  assert.match(page, /<label for="personal-event-start">Date et heure de Paris<\/label>/);
  const instruction = 'Saisissez l’heure de Paris, même si vous vous trouvez dans un autre fuseau horaire.';
  assert.ok(page.includes(instruction));
  app.window.generationLiaisonSetLanguage('en');
  assert.equal(app.window.generationLiaisonTranslate(instruction), 'Enter the time in Paris, even if you are in a different time zone.');
});

test('English calendar translates dates, empty states and deletion confirmation', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const node = () => ({
    children: [], attrs: {}, hidden: false, textContent: '', classList: { add() {}, contains() { return true; } }, listeners: {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    setAttribute(name, value) { this.attrs[name] = value; },
    addEventListener(event, callback) { this.listeners[event] = callback; }
  });
  const elements = {};
  const element = id => elements[id] ||= node();
  let confirmation;
  app.window.confirm = text => { confirmation = text; return false; };
  const context = {
    window: app.window, calendarDate: '2026-03-29', calendarView: 'day',
    calendarEvents: [{ id: 'series', kind: 'personal', title: 'Votre réponse',
      scheduledAt: '2026-03-29T01:30:00Z', durationMinutes: 30, recurrence: 'weekly' }],
    connectedUser: { role: 'senior' },
    document: { getElementById: element, createElement: node, querySelectorAll: () => [] },
    makeTextElement: (tag, text, className) => ({ tag, textContent: text, className }),
    planningRequest() { throw new Error('Deletion was not confirmed'); },
    Intl, Date
  };
  const start = page.indexOf('    function dateInputValue(date)');
  const end = page.indexOf('    async function chargerPartagesAgenda(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  context.renderCalendar();
  assert.match(element('calendar-title').textContent, /^Schedule for Sunday, March 29, 2026$/);
  const details = element('calendar-selected-day').children;
  assert.match(details[0].textContent, /03:30.*Votre réponse/);
  assert.equal(details[1].textContent, 'Delete all appointments in this series');
  await details[1].listeners.click();
  assert.equal(confirmation, 'Delete all appointments in this series?');
  context.calendarEvents = [];
  context.calendarView = 'week';
  context.renderCalendar();
  assert.equal(element('calendar-title').textContent, 'Week of March 23, 2026');
  assert.equal(element('calendar-grid').children[0].textContent, 'Mon.');
  assert.equal(element('calendar-grid').children[7].children[0].attrs['aria-label'], 'Monday, March 23, 2026');
  assert.equal(element('calendar-week-summary-content').children[0].textContent, 'No appointments this week.');
  assert.ok(element('calendar-selected-day').children.some(child => child.textContent === 'No appointments on this date.'));
  context.calendarView = 'month';
  context.renderCalendar();
  assert.equal(element('calendar-title').textContent, 'March 2026');
  app.window.generationLiaisonSetLanguage('fr');
  context.actualiserLangueAgenda();
  assert.equal(element('calendar-title').textContent, 'mars 2026');
  element('calendar-message').textContent = 'Chargement…';
  app.window.generationLiaisonSetLanguage('en');
  context.actualiserLangueAgenda();
  assert.equal(element('calendar-title').textContent, 'mars 2026');
});

test('English calendar loading and fallback error do not show stale appointments', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const elements = {};
  const element = id => elements[id] ||= {
    hidden: false, textContent: '', dataset: {}, children: ['previous appointment'],
    classList: { contains: () => true },
    replaceChildren() { this.children = []; }
  };
  let rejectRequest;
  const context = {
    window: app.window, connectedUser: { id: 'senior' }, calendarDate: '2026-03-29',
    calendarView: 'week', calendarLoadId: 0,
    document: {
      getElementById: element,
      querySelectorAll: selector => selector.startsWith('#screen-agenda')
        ? Object.values(elements).filter(item => item.dataset.agendaFormTranslation)
        : []
    },
    renderCalendar() { throw new Error('The calendar must remain empty during loading or on failure'); },
    planningRequest: () => new Promise((resolve, reject) => { rejectRequest = reject; }), Date
  };
  const extract = (start, end) => {
    const from = page.indexOf(start);
    const to = page.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return page.slice(from, to);
  };
  vm.runInNewContext(
    extract('    function dateInputValue(date)', '    function dateTimeInputValue(date)') +
    extract('    function calendarBounds()', '    function calendarEventDate(value)') +
    extract('    function actualiserLangueAgenda()', '    async function chargerPartagesAgenda(') +
    extract('    async function chargerCalendrier()', '    async function chargerModificationsGoogle()'), context
  );
  const loading = context.chargerCalendrier();
  assert.equal(element('calendar-message').textContent, 'Loading the calendar…');
  assert.equal(element('calendar-week-summary').hidden, true);
  assert.deepEqual(element('calendar-week-summary-content').children, []);
  app.window.generationLiaisonSetLanguage('fr');
  context.actualiserLangueAgenda();
  assert.equal(element('calendar-message').textContent, 'Chargement de l’agenda…');
  rejectRequest(new Error());
  await loading;
  assert.equal(element('calendar-message').textContent, 'Impossible de charger l’agenda.');
  app.window.generationLiaisonSetLanguage('en');
  context.actualiserLangueAgenda();
  assert.equal(element('calendar-message').textContent, 'Unable to load the calendar.');
  const secondLoad = context.chargerCalendrier();
  rejectRequest(new Error('Votre réponse'));
  await secondLoad;
  app.window.generationLiaisonSetLanguage('fr');
  context.actualiserLangueAgenda();
  assert.equal(element('calendar-message').textContent, 'Votre réponse');
});

test('Google connection return messages use the selected language and remove the result from the URL', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const start = page.indexOf('        const calendarResult = new URLSearchParams(');
  const end = page.indexOf("        document.getElementById('planning-previous-day')", start);
  assert.ok(start >= 0 && end > start);
  for (const [result, expected, success] of [
    ['connected', 'Google Calendar connected. You can re-enable schedule synchronization in settings if you wish.', true],
    ['denied', 'Google Calendar authorization was denied.', false],
    ['error', 'Google Calendar connection failed.', false]
  ]) {
    let toast, replaced;
    const url = `https://example.test/app-mobile.html?calendar=${result}&other=kept#agenda`;
    app.window.location = { search: `?calendar=${result}&other=kept`, href: url };
    app.window.history = { replaceState: (state, title, path) => { replaced = path; } };
    vm.runInNewContext(page.slice(start, end), {
      window: app.window, URL, URLSearchParams, showToast: (...args) => { toast = args; }
    });
    assert.deepEqual(toast, [expected, success]);
    assert.equal(replaced, '/app-mobile.html?other=kept#agenda');
  }
});

test('calendar sharing translates consent controls without changing names or decisions', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const node = () => ({
    children: [], dataset: {}, hidden: false, textContent: '', listeners: {},
    classList: { contains: () => true },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    querySelectorAll: function () { return this.children.flatMap(child => child.tag === 'button' ? [child] : child.querySelectorAll()); },
    addEventListener(event, callback) { this.listeners[event] = callback; }
  });
  const elements = {};
  const element = id => elements[id] ||= node();
  const partners = [
    { userId: '1', name: 'Accepter', incoming: { id: 'incoming', status: 'pending' }, outgoing: { id: 'outgoing', status: 'pending' } },
    { userId: '2', name: 'Anne', incoming: { id: 'shared', status: 'accepted' }, outgoing: { id: 'other', status: 'accepted' } },
    { userId: '3', name: 'Marie' }
  ];
  const requests = [];
  const context = {
    window: app.window, connectedUser: { id: 'senior' }, calendarDate: null,
    activeSeniorProfileId: '', agendaSharesLoadId: 0, agendaSharesRevision: 0, agendaSharesActionPending: false,
    document: {
      getElementById: element, createElement: tag => Object.assign(node(), { tag }),
      querySelectorAll: selector => selector.startsWith('#agenda-shares')
        ? element('agenda-shares').children.flatMap(row =>
          row.children.filter(child => child.dataset.agendaShareTranslation))
        : []
    },
    makeTextElement: (tag, text) => Object.assign(node(), { tag, textContent: text }),
    definirMessageFormulaireAgenda: (target, text, canTranslate) => {
      target.textContent = canTranslate ? app.window.generationLiaisonTranslate(text) : text;
    },
    planningRequest: async (url, options) => {
      requests.push({ url, options });
      return options ? {} : { partners };
    },
    chargerCalendrier() {}, renderCalendar() { throw new Error('Calendar should not render without a date'); }
  };
  const start = page.indexOf('    function actualiserLangueAgenda()');
  const end = page.indexOf('    async function chargerCalendrier()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  await context.chargerPartagesAgenda();
  const rows = element('agenda-shares').children;
  assert.equal(element('agenda-shares-card').hidden, false);
  assert.deepEqual(rows[0].children.map(child => child.textContent), [
    'Accepter', 'This person has requested access to your calendar.', 'Accept', 'Reject',
    'Request sent, awaiting a response.', 'Cancel my request'
  ]);
  assert.deepEqual(rows[1].children.map(child => child.textContent), [
    'Anne', 'This person can view your calendar.', 'Remove access',
    'Their calendar is displayed in yours.', 'Stop comparing'
  ]);
  assert.equal(rows[2].children[1].textContent, 'Request to compare our calendars');
  app.window.generationLiaisonSetLanguage('fr');
  context.actualiserLangueAgenda();
  assert.equal(rows[0].children[0].textContent, 'Accepter');
  assert.equal(rows[0].children[1].textContent, 'Cette personne demande à voir votre agenda.');
  assert.equal(rows[0].children[2].textContent, 'Accepter');
  app.window.generationLiaisonSetLanguage('en');
  context.actualiserLangueAgenda();
  await rows[0].children[2].listeners.click();
  assert.equal(requests[1].url, '/api/agenda/shares/incoming');
  assert.equal(requests[1].options.body.decision, 'accept');
});

function setupCalendarSharing() {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const node = tag => ({
    tag, children: [], dataset: {}, hidden: false, disabled: false, textContent: '', listeners: {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    querySelectorAll() { return this.children.flatMap(child => child.tag === 'button' ? [child] : child.querySelectorAll()); },
    addEventListener(event, callback) { this.listeners[event] = callback; }
  });
  const elements = {};
  const element = id => elements[id] ||= node('div');
  const pending = [];
  let refreshes = 0;
  const context = {
    window: app.window, connectedUser: { id: 'alice' }, activeSeniorProfileId: 'senior-a',
    agendaSharesLoadId: 0, agendaSharesRevision: 0, agendaSharesActionPending: false,
    document: { getElementById: element, createElement: node },
    makeTextElement: (tag, text) => Object.assign(node(tag), { textContent: text }),
    planningRequest: (url, options) => new Promise((resolve, reject) => {
      pending.push({ url, options, resolve, reject });
    }),
    chargerCalendrier: () => { refreshes++; }
  };
  const start = page.indexOf('    function reinitialiserPartagesAgenda()');
  const end = page.indexOf('    async function chargerCalendrier()', start);
  const helperStart = page.indexOf('    function definirMessageFormulaireAgenda(');
  const helperEnd = page.indexOf('    function texteModificationGoogle(', helperStart);
  assert.ok(start >= 0 && end > start && helperStart >= 0 && helperEnd > helperStart);
  vm.runInNewContext(page.slice(helperStart, helperEnd) + page.slice(start, end), context);
  return { context, element, pending, refreshes: () => refreshes };
}

test('calendar sharing ignores out-of-order loads and clears old account and profile data', async () => {
  const { context, element, pending } = setupCalendarSharing();
  const first = context.chargerPartagesAgenda();
  const second = context.chargerPartagesAgenda();
  pending[1].resolve({ partners: [{ userId: '2', name: 'Current' }] });
  await second;
  pending[0].resolve({ partners: [{ userId: '1', name: 'Stale' }] });
  await first;
  assert.equal(element('agenda-shares').children[0].children[0].textContent, 'Current');
  const staleFailure = context.chargerPartagesAgenda();
  const latest = context.chargerPartagesAgenda();
  pending[3].resolve({ partners: [{ userId: '4', name: 'Latest' }] });
  await latest;
  pending[2].reject(new Error('Outdated error'));
  await staleFailure;
  assert.equal(element('agenda-shares').children[0].children[0].textContent, 'Latest');
  const third = context.chargerPartagesAgenda();
  context.reinitialiserPartagesAgenda();
  context.connectedUser = { id: 'alice' };
  context.activeSeniorProfileId = 'senior-b';
  pending[4].resolve({ partners: [{ userId: '3', name: 'Previous profile' }] });
  await third;
  assert.equal(element('agenda-shares-card').hidden, true);
  assert.deepEqual(element('agenda-shares').children, []);
});

test('calendar sharing is cleared on account and accompanied-profile changes', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const login = page.slice(page.indexOf('    async function setAuthenticatedView(user)'), page.indexOf('        connectedUser = user;'));
  const logoutStart = page.indexOf('    async function deconnecterUtilisateur(');
  const logout = page.slice(logoutStart, page.indexOf("        activeSeniorProfileId = '';", logoutStart));
  const profileStart = page.indexOf("        document.getElementById('aidant-senior-select').addEventListener('change'");
  const profile = page.slice(profileStart, page.indexOf("        document.getElementById('aidant-refresh-seniors')", profileStart));
  assert.match(login, /if \(connectedUser\?\.id !== user\.id\) \{\s*reinitialiserPartagesAgenda\(\)/);
  assert.match(logout, /connectedUser = null;\s*reinitialiserPartagesAgenda\(\)/);
  assert.match(profile, /reinitialiserPartagesAgenda\(\)/);
});

test('calendar sharing exposes load and action failures without losing the error during refresh', async () => {
  const { context, element, pending, refreshes } = setupCalendarSharing();
  const loading = context.chargerPartagesAgenda();
  pending[0].reject(new Error());
  await loading;
  assert.equal(element('agenda-shares-card').hidden, false);
  assert.equal(element('agenda-shares').children[0].textContent, 'Unable to load calendar shares.');
  assert.equal(element('agenda-shares').children[1].textContent, 'Try again');
  const retry = element('agenda-shares').children[1].listeners.click();
  pending[1].resolve({ partners: [{ userId: 'other', name: 'Anne',
    incoming: { id: 'request', status: 'pending' } }] });
  await retry;
  const row = element('agenda-shares').children[0];
  const accept = row.children[2];
  const action = accept.listeners.click();
  assert.equal(accept.disabled, true);
  assert.equal(row.children[3].disabled, true);
  await context.chargerPartagesAgenda();
  await row.children[3].listeners.click();
  assert.equal(pending.length, 3);
  pending[2].reject(new Error('Connexion indisponible'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending[3].url, '/api/agenda/shares');
  pending[3].resolve({ partners: [] });
  await action;
  assert.equal(element('agenda-shares-card').hidden, false);
  assert.equal(element('agenda-shares-status').textContent, 'Connexion indisponible');
  assert.equal(refreshes(), 1);
  assert.equal(accept.disabled, false);
});

test('an unfinished sharing action does not refresh or reveal an old account', async () => {
  const { context, element, pending, refreshes } = setupCalendarSharing();
  const load = context.chargerPartagesAgenda();
  pending[0].resolve({ partners: [{ userId: 'other', name: 'Anne',
    incoming: { id: 'request', status: 'pending' } }] });
  await load;
  const action = element('agenda-shares').children[0].children[2].listeners.click();
  context.reinitialiserPartagesAgenda();
  context.connectedUser = { id: 'other-user' };
  pending[1].reject(new Error('Old account error'));
  await action;
  assert.equal(element('agenda-shares-status').textContent, '');
  assert.equal(pending.length, 2);
  assert.equal(refreshes(), 0);
});

test('Google calendar changes translate dates and consent actions without changing errors', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const node = () => ({
    children: [], dataset: {}, hidden: false, textContent: '', listeners: {},
    classList: { contains: () => true },
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener(event, callback) { this.listeners[event] = callback; }
  });
  const elements = {};
  const element = id => elements[id] ||= node();
  const descendants = parent => parent.children.flatMap(child => [child, ...descendants(child)]);
  let resolveRequest;
  const responses = [];
  const context = {
    window: app.window, connectedUser: { id: 'senior', role: 'senior' },
    calendarDate: null, calendarRequestsLoadId: 0, Intl, Date,
    document: {
      getElementById: element, createElement: node,
      createTextNode: text => Object.assign(node(), { textContent: text }),
      querySelectorAll: selector => selector.startsWith('#calendar-google-requests')
        ? descendants(element('calendar-google-requests')).filter(child =>
          selector.includes('data-google-date') ? child.dataset.googleDate : child.dataset.googleTranslation)
        : []
    },
    makeTextElement: (tag, text, className) => Object.assign(node(), { tag, textContent: text, className }),
    planningRequest: () => new Promise(resolve => { resolveRequest = resolve; }),
    repondreModificationGoogle: (...args) => responses.push(args)
  };
  const start = page.indexOf('    function actualiserLangueAgenda()');
  const end = page.indexOf('    async function chargerParametresGooglePlanning()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  const loading = context.chargerModificationsGoogle();
  assert.equal(element('calendar-google-requests').children[0].textContent, 'Loading requests…');
  resolveRequest({ requests: [{
    id: 'request', kind: 'visit', scheduledAt: '2026-03-29T01:30:00Z', error: 'Votre réponse',
    proposal: { action: 'move', start: '2026-03-29T02:30:00Z', duration: 30,
      professionalApproved: true, familyApproved: false }
  }, {
    id: 'cancel', kind: 'service', scheduledAt: '2026-03-29T01:30:00Z',
    proposal: { action: 'cancel', professionalApproved: false, familyApproved: true }
  }, {
    id: 'paused', kind: 'visit', scheduledAt: '2026-03-29T01:30:00Z', paused: true
  }, {
    id: 'restore', kind: 'visit', scheduledAt: '2026-03-29T01:30:00Z', state: 'restore'
  }] });
  await loading;
  const card = element('calendar-google-requests').children[0];
  assert.equal(card.children[0].children[0].textContent, 'Visit');
  assert.match(card.children[0].children[2].textContent, /3:30 AM/);
  assert.equal(card.children[1].textContent, 'Votre réponse');
  assert.equal(card.children[2].children[0].textContent, 'Rescheduling requested:');
  assert.match(card.children[2].children[2].textContent, /4:30 AM/);
  assert.equal(card.children[3].children[2].textContent, 'approved');
  assert.equal(card.children[3].children[6].textContent, 'pending');
  const approve = card.children[4].children[0];
  assert.equal(approve.textContent, 'Approve');
  assert.equal(card.children[4].children[1].textContent, 'Reject');
  const cards = element('calendar-google-requests').children;
  assert.equal(cards[1].children[1].textContent, 'Cancellation requested from Google.');
  assert.equal(cards[1].children[3].children.length, 1);
  assert.equal(cards[2].children[1].textContent, 'Synchronization paused by the professional.');
  assert.equal(cards[3].children[1].textContent, 'Change rejected: restoring the Google event.');
  assert.match(page, /Les horaires sont affichés à l’heure de Paris\./);
  assert.equal(app.window.generationLiaisonTranslate('Les horaires sont affichés à l’heure de Paris.'), 'Times are shown in Paris time.');
  app.window.generationLiaisonSetLanguage('fr');
  context.actualiserLangueAgenda();
  assert.equal(card.children[0].children[0].textContent, 'Visite');
  assert.match(card.children[0].children[2].textContent, /03:30/);
  assert.equal(card.children[1].textContent, 'Votre réponse');
  assert.equal(approve.textContent, 'Valider');
  approve.listeners.click();
  assert.equal(responses[0][0], 'request');
  assert.equal(responses[0][1], 'approve');
  assert.equal(responses[0][2], approve);
});

test('Google change confirmation explains both approvals in English', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  let confirmation;
  app.window.confirm = text => { confirmation = text; return false; };
  const context = { window: app.window };
  const start = page.indexOf('    async function repondreModificationGoogle(');
  const end = page.indexOf('    async function confirmerReconnexionGoogle(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  await context.repondreModificationGoogle('request', 'approve', {});
  assert.equal(confirmation, 'Confirm your approval of this change? The appointment will change only after both parties approve.');
  await context.repondreModificationGoogle('request', 'reject', {});
  assert.equal(confirmation, 'Reject this change and keep the current appointment?');
});

test('Google change loading and fallback errors follow the selected language', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const container = {
    dataset: {}, children: [],
    replaceChildren(...items) { this.children = items; },
    append(...items) { this.children.push(...items); }
  };
  let rejectRequest;
  const context = {
    window: app.window, connectedUser: { id: 'senior' }, calendarRequestsLoadId: 0,
    document: { getElementById: () => container },
    makeTextElement: (tag, text) => ({ dataset: {}, textContent: text }),
    planningRequest: () => new Promise((resolve, reject) => { rejectRequest = reject; })
  };
  const start = page.indexOf('    function formaterDateModificationGoogle(');
  const end = page.indexOf('    async function chargerParametresGooglePlanning()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  const loading = context.chargerModificationsGoogle();
  assert.equal(container.children[0].textContent, 'Loading requests…');
  rejectRequest(new Error());
  await loading;
  assert.equal(container.children[0].textContent, 'Unable to load Google changes.');
  assert.equal(container.children[0].dataset.googleTranslation, 'Impossible de charger les modifications Google.');
});

test('Google synchronization settings translate live without changing server errors or controls', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const elements = {};
  const element = id => elements[id] ||= { dataset: {}, hidden: false, disabled: false, textContent: '' };
  let resolveRequest;
  const context = {
    window: app.window, connectedUser: { id: 'professional', role: 'pro' }, calendarSettingsLoadId: 0,
    document: {
      getElementById: element,
      querySelectorAll: () => Object.values(elements).filter(item => item.dataset.googleSettingsTranslation)
    },
    planningRequest: () => new Promise(resolve => { resolveRequest = resolve; })
  };
  const start = page.indexOf('    function definirTexteReglageGoogle(');
  const end = page.indexOf('    async function modifierSynchronisationGoogle()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  const loading = context.chargerParametresGooglePlanning();
  assert.equal(element('calendar-google-sync-status').textContent, 'Checking synchronization…');
  assert.equal(element('calendar-google-sync-toggle').disabled, true);
  resolveRequest({ connected: true, enabled: true, needsReconnect: false });
  await loading;
  const status = element('calendar-google-sync-status');
  const toggle = element('calendar-google-sync-toggle');
  assert.equal(status.textContent, 'Schedule synchronization is on.');
  assert.equal(toggle.textContent, 'Pause');
  assert.equal(toggle.dataset.enabled, 'true');
  assert.equal(toggle.disabled, false);
  app.window.generationLiaisonSetLanguage('fr');
  context.actualiserLangueReglagesGoogle();
  assert.equal(status.textContent, 'Synchronisation du planning activée.');
  assert.equal(toggle.textContent, 'Mettre en pause');
  assert.equal(toggle.dataset.enabled, 'true');
  app.window.generationLiaisonSetLanguage('en');
  const errorLoad = context.chargerParametresGooglePlanning();
  resolveRequest({ connected: true, enabled: false, needsReconnect: true,
    workerError: 'Synchronisation du planning activée.' });
  await errorLoad;
  assert.equal(status.textContent, 'Synchronisation du planning activée.');
  assert.equal(toggle.disabled, true);
  assert.equal(element('calendar-google-same').hidden, false);
  assert.equal(element('calendar-google-new').hidden, false);
  context.actualiserLangueReglagesGoogle();
  assert.equal(status.textContent, 'Synchronisation du planning activée.');
  const staleLoad = context.chargerParametresGooglePlanning();
  context.connectedUser = { id: 'other', role: 'pro' };
  resolveRequest({ connected: true, enabled: true });
  await staleLoad;
  assert.equal(toggle.disabled, true);
});

test('Google synchronization confirmations explain consequences before changing settings', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const button = { dataset: { enabled: 'false' }, disabled: false };
  const confirmations = [];
  app.window.confirm = text => { confirmations.push(text); return false; };
  const context = {
    window: app.window, document: { getElementById: () => button },
    planningRequest() { throw new Error('Rejected confirmation must not make a request'); }
  };
  const start = page.indexOf('    async function modifierSynchronisationGoogle()');
  const end = page.indexOf('    function decalerCalendrier(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  await context.modifierSynchronisationGoogle();
  assert.match(confirmations[0], /dates and durations.*generic title and no name/);
  button.dataset.enabled = 'true';
  await context.modifierSynchronisationGoogle();
  assert.match(confirmations[1], /already copied will remain in Google/);
  await context.confirmerReconnexionGoogle(button);
  assert.match(confirmations[2], /exactly the same Google account and calendar/);
  await context.changerAgendaGoogle(button);
  assert.match(confirmations[3], /Pending Google requests will be abandoned without changing appointments/);
  assert.equal(button.disabled, false);
});

test('confirmed Google synchronization actions retain their request semantics', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const button = { dataset: { enabled: 'false' }, disabled: false };
  app.window.confirm = () => true;
  const calls = [];
  const messages = [];
  const context = {
    window: app.window, document: { getElementById: () => button },
    planningRequest: async (url, options) => { calls.push({ url, options }); return {}; },
    chargerParametresGooglePlanning: async () => {},
    chargerModificationsGoogle: async () => {},
    showToast: message => messages.push(message)
  };
  const start = page.indexOf('    async function modifierSynchronisationGoogle()');
  const end = page.indexOf('    function decalerCalendrier(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  await context.modifierSynchronisationGoogle();
  assert.equal(calls[0].url, '/api/calendar/planning/status');
  assert.equal(calls[0].options.body.enabled, true);
  assert.equal(messages[0], 'Synchronization enabled.');
  await context.confirmerReconnexionGoogle(button);
  assert.equal(calls[1].url, '/api/calendar/planning/confirm-reconnect');
  assert.equal(calls[1].options.body.sameCalendar, true);
  assert.equal(button.disabled, false);
  await context.changerAgendaGoogle(button);
  assert.equal(calls[2].url, '/api/calendar/planning/change-calendar');
  assert.equal(calls[2].options.body.newCalendar, true);
  assert.equal(button.disabled, false);
});

test('appointment and birthday messages translate without altering entered details or unknown errors', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const elements = {};
  const element = id => elements[id] ||= {
    dataset: {}, value: '', textContent: '', handlers: {},
    classList: { contains: () => true },
    addEventListener(type, handler) { this.handlers[type] = handler; },
    reset() { this.resetCount = (this.resetCount || 0) + 1; }
  };
  element('personal-event-title').value = 'Votre réponse';
  element('personal-event-start').value = '2026-03-29T03:30';
  element('personal-event-duration').value = '30';
  element('personal-event-recurrence').value = 'weekly';
  element('birthday-name').value = 'Votre réponse';
  element('birthday-date').value = '1950-02-28';
  let failure;
  const requests = [];
  let refreshes = 0;
  const context = {
    window: app.window, connectedUser: { id: 'senior' }, calendarDate: null,
    document: {
      getElementById: element,
      querySelectorAll: selector => selector.startsWith('#screen-agenda')
        ? Object.values(elements).filter(item => item.dataset.agendaFormTranslation)
        : []
    },
    planningRequest: async (url, options) => {
      requests.push({ url, options });
      if (failure) throw failure;
    },
    chargerCalendrier: () => { refreshes++; }, renderCalendar() {}
  };
  const extract = (start, end) => {
    const from = page.indexOf(start);
    const to = page.indexOf(end, from);
    assert.ok(from >= 0 && to > from);
    return page.slice(from, to);
  };
  vm.runInNewContext(
    extract('    function actualiserLangueAgenda()', '    async function chargerPartagesAgenda(') +
    extract('    function definirMessageFormulaireAgenda(', '    function texteModificationGoogle(') +
    extract("        document.getElementById('personal-event-form').addEventListener", "        document.getElementById('planning-next-day')"),
    context
  );
  const submit = id => element(id).handlers.submit({ preventDefault() {} });
  await submit('personal-event-form');
  assert.equal(requests[0].url, '/api/agenda/events');
  assert.equal(requests[0].options.body.title, 'Votre réponse');
  assert.equal(requests[0].options.body.start, '2026-03-29T03:30');
  assert.equal(requests[0].options.body.recurrence, 'weekly');
  assert.equal(context.calendarDate, '2026-03-29');
  assert.equal(element('personal-event-message').textContent, 'Appointment added.');
  await submit('birthday-form');
  assert.equal(requests[1].options.body.name, 'Votre réponse');
  assert.equal(requests[1].options.body.birthDate, '1950-02-28');
  assert.match(element('birthday-message').textContent, /if the service is available/);
  assert.equal(element('birthday-form').resetCount, 1);
  assert.equal(refreshes, 2);
  app.window.generationLiaisonSetLanguage('fr');
  context.actualiserLangueAgenda();
  assert.equal(element('personal-event-message').textContent, 'Rendez-vous ajouté.');
  assert.match(element('birthday-message').textContent, /si le service est disponible/);
  app.window.generationLiaisonSetLanguage('en');
  failure = new Error('Choisissez une date de naissance valide, pas dans le futur.');
  await submit('birthday-form');
  assert.equal(element('birthday-message').textContent, 'Choose a valid date of birth that is not in the future.');
  assert.equal(element('birthday-form').resetCount, 1);
  failure = new Error('Votre réponse');
  await submit('birthday-form');
  assert.equal(element('birthday-message').textContent, 'Votre réponse');
  app.window.generationLiaisonSetLanguage('fr');
  context.actualiserLangueAgenda();
  assert.equal(element('birthday-message').textContent, 'Votre réponse');
  assert.equal(refreshes, 2);
});

test('English wellbeing loading and empty caregiver states use the selected language', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const node = () => ({
    children: [], append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; }
  });
  const elements = {
    'wellbeing-checkin-status': {}, 'wellbeing-checkin-retry': { hidden: true },
    'wellbeing-checkin-details': {}, 'wellbeing-checkin-form': {},
    'wellbeing-checkin-result': {}, 'wellbeing-aidant-contacts': node()
  };
  let resolveLoad;
  const context = {
    window: app.window, connectedUser: { id: 'alice', role: 'senior' },
    wellbeingLoadedDate: null, wellbeingLoadId: 0,
    document: { getElementById: id => elements[id], querySelectorAll: () => [] },
    dateCheckinBienEtre: () => 'today', reinitialiserHumeurBienEtre() {},
    afficherCheckinBienEtre() {},
    makeTextElement: (tag, text) => ({ tag, textContent: text }),
    planningRequest: url => url === '/api/wellbeing/check-in'
      ? new Promise(resolve => { resolveLoad = resolve; }) : Promise.resolve({ contacts: [] })
  };
  const start = page.indexOf('    async function chargerCheckinBienEtre()');
  const end = page.indexOf('    async function chargerCheckinsPartages()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  const pending = context.chargerCheckinBienEtre();
  assert.equal(elements['wellbeing-checkin-status'].textContent, 'Loading your wellbeing check-in…');
  resolveLoad({ checkin: null });
  await pending;
  assert.equal(elements['wellbeing-aidant-contacts'].children[0].textContent,
    'No active caregiver contact is registered. You can send your answer without sharing it.');
  context.wellbeingLoadedDate = null;
  context.planningRequest = async () => { throw new Error(); };
  await context.chargerCheckinBienEtre();
  assert.equal(elements['wellbeing-checkin-status'].textContent, 'Unable to load your wellbeing check-in.');
  assert.equal(elements['wellbeing-checkin-retry'].hidden, false);
});

test('English professional registration explains SMS, location and radius errors', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  assert.equal(app.window.generationLiaisonTranslate('Position du domicile enregistrée.'), 'Home location saved.');
  assert.equal(app.window.generationLiaisonTranslate('Position du domicile non enregistrée : relevez-la depuis votre domicile.'),
    'Home location not saved: obtain your location from home.');
  const elements = {};
  const element = id => elements[id] ||= { value: '', files: [], checked: false, focus() { this.focused = true; } };
  element('reg-role').value = 'pro';
  element('reg-tablet-interest').value = 'none';
  element('reg-identity-document').files = [{ type: 'application/pdf', size: 10 }];
  element('reg-kbis-document').files = [{ type: 'application/pdf', size: 10 }];
  element('reg-sms-notifications').checked = true;
  const context = {
    window: app.window, document: { getElementById: element }, registrationHomeCoordinates: null
  };
  const start = page.indexOf('    async function validerEtapeInscription(step)');
  const end = page.indexOf('    function etapePrecedenteInscription()', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  const checkError = async (field, expected) => {
    const error = await context.validerEtapeInscription(3);
    assert.equal(error.field, field);
    context.afficherErreurEtapeInscription(error);
    assert.equal(element('reg-step-error').textContent, expected);
    assert.equal(element(field).focused, true);
  };
  await checkError('reg-notification-phone', 'To receive SMS messages, enter a number in international format, for example +33612345678.');
  element('reg-notification-phone').value = '+33612345678';
  await checkError('reg-home-city', 'Choose a municipality or obtain your GPS location before creating a professional account.');
  context.registrationHomeCoordinates = { latitude: 48, longitude: 2 };
  element('reg-service-radius').value = '501';
  await checkError('reg-service-radius', 'Choose a radius between 1 and 500 km.');
});

test('English professional location messages preserve locations and report errors', async () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup('en');
  const elements = {};
  const element = id => elements[id] ||= {
    value: '', hidden: false, listeners: {},
    addEventListener(name, callback) { this.listeners[name] = callback; }
  };
  const toasts = [];
  const context = {
    window: app.window, document: { getElementById: element },
    registrationHomeCoordinates: null, professionalHomeCoordinates: null,
    connectedUser: { hasHomeLocation: true },
    obtenirPositionActuelle: async () => ({ latitude: 48, longitude: 2, accuracy: 34.6 }),
    choisirCommune: async () => ({ latitude: 48, longitude: 2, name: 'Paris' }),
    showToast: (message, success) => toasts.push({ message, success })
  };
  const positionStart = page.indexOf('    function messagePositionEnregistree(position)');
  const positionEnd = page.indexOf('    async function rechercherCommunes(', positionStart);
  const start = page.indexOf("        document.getElementById('reg-home-location-button').addEventListener");
  const end = page.indexOf("        document.getElementById('professional-location-form').addEventListener", start);
  assert.ok(positionStart >= 0 && positionEnd > positionStart && start >= 0 && end > start);
  vm.runInNewContext(page.slice(positionStart, positionEnd) + page.slice(start, end), context);
  await element('reg-home-location-button').listeners.click();
  assert.equal(element('reg-home-location-status').textContent, 'Location obtained on this device (approximate accuracy: 35 m).');
  assert.equal(context.registrationHomeCoordinates.latitude, 48);
  context.obtenirPositionActuelle = async () => { throw new Error('La localisation GPS n’est pas disponible sur cet appareil.'); };
  await element('reg-home-location-button').listeners.click();
  assert.equal(element('reg-home-location-status').textContent, 'Home location not saved.');
  assert.equal(toasts.at(-1).message, 'GPS location is unavailable on this device.');
  await element('pro-home-location-button').listeners.click();
  assert.equal(element('pro-home-location-status').textContent, 'Your saved location remains unchanged.');
  element('reg-home-city').listeners.input();
  assert.equal(element('reg-home-location-status').textContent, 'Search for and choose a municipality, or use your GPS location.');
  element('reg-city-select').hidden = false;
  await element('reg-city-search').listeners.click();
  assert.equal(element('reg-home-location-status').textContent, 'Approximate centre selected : Paris');
  context.choisirCommune = async () => { throw new Error('Le service de recherche des communes est indisponible.'); };
  await element('reg-city-search').listeners.click();
  assert.equal(element('reg-home-location-status').textContent, 'The municipality search service is unavailable.');
});

test('switching registration language updates the current step without changing the form or focus', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');
  const app = setup();
  const elements = {};
  let focusCount = 0;
  const element = id => elements[id] ||= {
    value: '', hidden: false, textContent: '', files: [],
    querySelector: () => ({ focus() { focusCount++; } })
  };
  element('reg-role').options = [{ text: 'Senior' }];
  element('reg-role').selectedIndex = 0;
  element('reg-tablet-interest').options = [{ text: 'No' }];
  element('reg-tablet-interest').selectedIndex = 0;
  element('reg-first-name').value = 'Marie';
  element('reg-last-name').value = 'Votre réponse';
  element('reg-email').value = 'marie@example.test';
  element('reg-postal-address').value = '10 rue Exemple';
  element('reg-postal-code').value = '75000';
  element('reg-postal-city').value = 'Paris';
  element('reg-postal-country').value = 'France';
  const file = { name: 'document.pdf' };
  element('reg-identity-document').files = [file];
  const context = { window: app.window, document: { getElementById: element } };
  const start = page.indexOf('    let registrationStep = 1;');
  const end = page.indexOf('    function messageErreurPosition(', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(page.slice(start, end), context);
  app.window.addEventListener('generationliaisonlanguagechange', context.actualiserTextesEtapeInscription);
  context.afficherEtapeInscription(4);
  const firstFocusCount = focusCount;
  element('reg-step-error').hidden = false;
  app.window.generationLiaisonSetLanguage('en');
  assert.match(element('reg-step-progress').textContent, /^Step 4 of 4/);
  assert.match(element('reg-summary').textContent, /Marie Votre réponse — marie@example\.test/);
  assert.match(element('reg-postal-summary').textContent, /10 rue Exemple, 75000 Paris, France/);
  assert.equal(element('reg-identity-document').files[0], file);
  assert.equal(element('reg-step-error').hidden, false);
  assert.equal(focusCount, firstFocusCount);
  app.window.generationLiaisonSetLanguage('fr');
  assert.match(element('reg-step-progress').textContent, /^Étape 4 sur 4/);
  assert.match(page, /addEventListener\('generationliaisonlanguagechange', actualiserTextesEtapeInscription\)/);
});

test('switching languages does not replace content or attributes updated by the application', () => {
  const app = setup();
  app.nodes[1].textContent = 'Message envoyé.';
  app.attributes.set('aria-label', 'Destinataire choisi');
  app.window.generationLiaisonSetLanguage('en');
  assert.equal(app.nodes[1].textContent, 'Message envoyé.');
  assert.equal(app.attributes.get('aria-label'), 'Destinataire choisi');
  app.window.generationLiaisonSetLanguage('fr');
  assert.equal(app.nodes[1].textContent, 'Message envoyé.');
  assert.equal(app.attributes.get('aria-label'), 'Destinataire choisi');
});
