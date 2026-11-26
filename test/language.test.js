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
