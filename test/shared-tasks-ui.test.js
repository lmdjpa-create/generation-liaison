const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'app-mobile.html'), 'utf8');

test('shared task loads clear old data and ignore responses from an earlier profile', async () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', value: '', open: false, children: [],
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      setAttribute() {}, addEventListener() {}, reset() {}
    });
    return elements.get(id);
  }
  let resolveFirst;
  let calls = 0;
  const context = {
    sharedTasksLoadId: 0, keyContactsLoadId: 0,
    window: { generationLiaisonTranslate: value => value },
    document: { getElementById: element, createElement: () => element(Symbol()) },
    dateCheckinBienEtre: () => '2028-02-28',
    planningRequest: () => {
      calls++;
      if (calls === 1) return new Promise(resolve => { resolveFirst = resolve; });
      if (calls === 2) return Promise.resolve({ tasks: [{ id: 'new', title: 'Nouvelle tâche', completed: false }] });
      return Promise.reject(new Error('Accès retiré'));
    }
  };
  const start = source.indexOf('    function reinitialiserTachesPartagees()');
  const end = source.indexOf('    async function seniorLinksRequest', start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(`${source.slice(start, end)}
    globalThis.resetTasks = reinitialiserTachesPartagees;
    globalThis.loadTasks = chargerTachesPartagees;`, context);
  const first = context.loadTasks('aidant');
  context.resetTasks();
  await context.loadTasks('aidant');
  resolveFirst({ tasks: [{ id: 'old', title: 'Ancien profil', completed: false }] });
  await first;
  assert.equal(element('aidant-tasks-list').children.length, 1);
  assert.equal(element('aidant-tasks-list').children[0].children[0].textContent, 'Nouvelle tâche');
  await context.loadTasks('aidant');
  assert.equal(element('aidant-tasks-list').children.length, 0);
  assert.equal(element('aidant-tasks-status').textContent, 'Accès retiré');
});

test('shared task dates can be displayed, changed and cleared', async () => {
  const elements = new Map();
  function makeElement() {
    return {
      textContent: '', value: '', children: [], events: {},
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      setAttribute() {},
      addEventListener(type, handler) { this.events[type] = handler; }
    };
  }
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const requests = [];
  const context = {
    sharedTasksLoadId: 0,
    window: { generationLiaisonTranslate: value => value, generationLiaisonLocale: () => 'fr-FR' },
    document: { getElementById, createElement: makeElement },
    dateCheckinBienEtre: () => '2028-02-28',
    planningRequest: async (path, options) => {
      requests.push({ path, options });
      return { tasks: [{ id: 'task-id', title: 'Faire les courses', completed: false, dueDate: '2028-02-29' }] };
    }
  };
  const start = source.indexOf('    function reinitialiserTachesPartagees()');
  const end = source.indexOf('    async function seniorLinksRequest', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadTasks = chargerTachesPartagees;`, context);
  await context.loadTasks('senior');
  const row = getElementById('senior-tasks-list').children[0];
  assert.equal(row.children[2].textContent, 'Date prévue : 29/02/2028');
  const details = row.children[5];
  const dateInput = details.children[1].children[0];
  assert.equal(dateInput.value, '2028-02-29');
  dateInput.value = '';
  await details.children[2].events.click();
  assert.equal(requests[1].path, '/api/shared-tasks/task-id');
  assert.equal(requests[1].options.body.dueDate, null);
});

test('task summary and date labels distinguish overdue and today in Paris, excluding completed tasks', async () => {
  const elements = new Map();
  function makeElement() {
    return {
      textContent: '', value: '', children: [],
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      setAttribute() {}, addEventListener() {}
    };
  }
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const tasks = [
    { id: 'old', title: 'Avant', completed: false, dueDate: '2028-02-28' },
    { id: 'today', title: 'Aujourd’hui', completed: false, dueDate: '2028-02-29' },
    { id: 'future', title: 'Après', completed: false, dueDate: '2028-03-01' },
    { id: 'none', title: 'Sans date', completed: false, dueDate: null },
    { id: 'done', title: 'Fait', completed: true, dueDate: '2028-02-28' }
  ];
  const context = {
    sharedTasksLoadId: 0,
    window: { generationLiaisonTranslate: value => value, generationLiaisonLocale: () => 'fr-FR' },
    document: { getElementById, createElement: makeElement },
    dateCheckinBienEtre: () => '2028-02-29',
    planningRequest: async () => ({ tasks })
  };
  const start = source.indexOf('    function reinitialiserTachesPartagees()');
  const end = source.indexOf('    async function seniorLinksRequest', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadTasks = chargerTachesPartagees;`, context);
  await context.loadTasks('aidant');
  assert.equal(getElementById('aidant-tasks-status').textContent, 'À faire : 4 · En retard : 1 · Terminées : 1');
  const rows = getElementById('aidant-tasks-list').children;
  assert.equal(rows[0].children[2].textContent, 'Date prévue : 28/02/2028 — En retard');
  assert.equal(rows[1].children[2].textContent, 'Date prévue : 29/02/2028 — Aujourd’hui');
  assert.equal(rows[2].children[2].textContent, 'Date prévue : 01/03/2028');
  assert.equal(rows[3].children[2].textContent, 'Sans date prévue');
  assert.equal(rows[4].children[2].textContent, 'Date prévue : 28/02/2028');
});

test('task assignment shows who volunteered and offers only allowed actions', async () => {
  const elements = new Map();
  function makeElement() {
    return {
      textContent: '', value: '', children: [], events: {}, hidden: false,
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      setAttribute() {},
      addEventListener(type, handler) { this.events[type] = handler; }
    };
  }
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const requests = [];
  const tasks = [
    { id: 'open', title: 'Courses', completed: false, dueDate: null, assigned: false },
    { id: 'mine', title: 'Repas', completed: false, dueDate: null, assigned: true, assignedToMe: true, assigneeName: 'Camille' },
    { id: 'other', title: 'Appel', completed: false, dueDate: null, assigned: true, assignedToMe: false, assigneeName: 'Marie' },
    { id: 'inactive', title: 'Courrier', completed: false, dueDate: null, assigned: true, assignedToMe: false, assigneeName: null }
  ];
  const context = {
    sharedTasksLoadId: 0,
    window: { generationLiaisonTranslate: value => value, confirm: () => true },
    document: { getElementById, createElement: makeElement },
    dateCheckinBienEtre: () => '2028-02-29',
    planningRequest: async (url, options) => { requests.push({ url, options }); return { tasks }; }
  };
  const start = source.indexOf('    function reinitialiserTachesPartagees()');
  const end = source.indexOf('    async function seniorLinksRequest', start);
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.loadTasks = chargerTachesPartagees;`, context);
  await context.loadTasks('aidant');
  let rows = getElementById('aidant-tasks-list').children;
  assert.equal(rows[0].children[7].textContent, 'Je m’en charge');
  assert.equal(rows[1].children[6].textContent, 'Attribuée à : Camille');
  assert.equal(rows[1].children[7].textContent, 'Je me retire');
  assert.equal(rows[2].children[7].hidden, true);
  assert.equal(rows[3].children[6].textContent, 'Attribuée à : Personne indisponible');
  await rows[0].children[7].events.click();
  assert.equal(requests[1].url, '/api/shared-tasks/open/claim');
  assert.equal(requests[1].options.method, 'POST');
  await context.loadTasks('senior');
  rows = getElementById('senior-tasks-list').children;
  assert.equal(rows[3].children[7].textContent, 'Libérer la tâche');
  await rows[3].children[7].events.click();
  assert.equal(requests.at(-2).url, '/api/shared-tasks/inactive/claim');
  assert.equal(requests.at(-2).options.method, 'DELETE');
});

test('an unassigned task can be attributed only after choosing an associated person', async () => {
  const elements = new Map(), requests = [];
  function makeElement() {
    return {
      textContent: '', value: '', children: [], events: {}, hidden: false, disabled: false, open: false,
      replaceChildren(...children) { this.children = children; },
      append(...children) { this.children.push(...children); },
      setAttribute() {}, addEventListener(type, handler) { this.events[type] = handler; }, reset() {}
    };
  }
  const getElementById = id => {
    if (!elements.has(id)) elements.set(id, makeElement());
    return elements.get(id);
  };
  const context = {
    sharedTasksLoadId: 0,
    window: { generationLiaisonTranslate: value => value },
    document: { getElementById, createElement: makeElement },
    dateCheckinBienEtre: () => '2028-02-29',
    planningRequest: async (url, options) => {
      requests.push({ url, options });
      if (url === '/api/shared-tasks/assignees') return { assignees: [{ id: 'alice', name: 'Alice' }] };
      return { tasks: [{ id: 'task', title: 'Courses', completed: false, assigned: false }] };
    }
  };
  const start = source.indexOf('    function reinitialiserTachesPartagees()');
  const end = source.indexOf('    async function seniorLinksRequest', start);
  vm.runInNewContext(source.slice(start, end), context);
  await context.chargerTachesPartagees('aidant');
  const details = getElementById('aidant-tasks-list').children[0].children[8];
  details.open = true;
  await details.events.toggle();
  const select = details.children[1].children[0], assign = details.children[2];
  assert.equal(select.children[1].textContent, 'Alice');
  await assign.events.click();
  assert.match(details.children[3].textContent, /Choisissez/);
  assert.equal(requests.length, 2);
  select.value = 'alice';
  await assign.events.click();
  assert.equal(requests[2].url, '/api/shared-tasks/task/assign');
  assert.equal(requests[2].options.body.assigneeId, 'alice');
});

test('the date used for task status follows Paris across midnight', () => {
  const start = source.indexOf('    function dateCheckinBienEtre()');
  const end = source.indexOf('    function authHeaders', start);
  assert.ok(start >= 0 && end > start);
  class FixedDate extends Date {
    constructor() { super('2028-02-28T23:30:00Z'); }
  }
  const context = { Date: FixedDate, Intl };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.today = dateCheckinBienEtre();`, context);
  assert.equal(context.today, '2028-02-29');
});

test('both task panels provide a manual refresh button that reloads the right list', () => {
  for (const role of ['senior', 'aidant']) {
    assert.match(source, new RegExp(`<button type="button" id="${role}-tasks-refresh">Actualiser les tâches</button>`));
  }
  const elements = new Map();
  const loaded = [];
  const context = {
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          events: {},
          addEventListener(type, handler) { this.events[type] = handler; }
        });
        return elements.get(id);
      }
    },
    chargerTachesPartagees: role => loaded.push(role)
  };
  const start = source.indexOf('        for (const role of [\'senior\', \'aidant\']) {', source.indexOf('    function configurerFormulairesCoordination()'));
  const end = source.indexOf("        document.getElementById('reg-role')", start);
  assert.ok(start >= 0 && end > start);
  vm.runInNewContext(source.slice(start, end), context);
  elements.get('senior-tasks-refresh').events.click();
  elements.get('aidant-tasks-refresh').events.click();
  assert.deepEqual(loaded, ['senior', 'aidant']);
});
