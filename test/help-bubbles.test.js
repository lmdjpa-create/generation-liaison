const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const script = fs.readFileSync(path.join(__dirname, '..', 'help-bubbles.js'), 'utf8');

function setup({ closedParent = false, homepage = false } = {}) {
  const timers = new Map();
  let nextTimer = 0;
  const makeNode = () => ({
    events: {}, attrs: {}, addEventListener(type, fn) { this.events[type] = fn; },
    getAttribute(name) { return this.attrs[name] || null; },
    setAttribute(name, value) { this.attrs[name] = value; },
    contains(node) { return this === node; },
    getBoundingClientRect() { return { left: 490, top: 400, bottom: 450 }; }
  });
  const button = makeNode();
  const summary = homepage ? button : makeNode();
  const bubble = { style: {}, offsetWidth: 200, offsetHeight: 100 };
  const details = {
    ...makeNode(), open: false, dataset: {},
    parentElement: { closest() { return closedParent ? {} : null; } },
    querySelector(selector) { return selector === 'summary' ? summary : bubble; },
    getAttribute() { return homepage ? null : '#action'; },
    contains(node) { return node === summary || node === bubble; }
  };
  const document = {
    readyState: 'complete', activeElement: null, events: {},
    querySelectorAll(selector) { return selector === '#action' ? [button] : [details]; },
    addEventListener(type, fn) { this.events[type] = fn; }
  };
  const window = { innerWidth: 600, innerHeight: 500, addEventListener() {} };
  vm.runInNewContext(script, {
    document, window, Set,
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  return { button, summary, bubble, details, document, timers };
}

test('a button shows its help after two seconds, closes on leave and never invokes the action', () => {
  const { button, bubble, details, timers } = setup();
  button.events.pointerenter({ pointerType: 'mouse' });
  assert.equal(details.open, false);
  assert.equal(timers.get(1).delay, 2000);
  assert.equal(button.attrs['aria-describedby'], 'gl-help-description-1');
  button.events.pointerleave({ relatedTarget: null });
  assert.equal(timers.size, 0);
  button.events.pointerenter({ pointerType: 'mouse' });
  timers.get(2).callback();
  assert.equal(details.open, true);
  assert.equal(bubble.style.left, '392px');
  assert.equal(bubble.style.top, '300px');
  button.events.pointerleave({ relatedTarget: null });
  assert.equal(details.open, false);
});

test('keyboard focus opens help and Escape dismisses it; touch uses the native help control', () => {
  const { button, summary, details, document, timers } = setup();
  button.events.pointerenter({ pointerType: 'touch' });
  assert.equal(timers.size, 0);
  document.activeElement = button;
  button.events.focus();
  assert.equal(timers.get(1).delay, 2000);
  timers.get(1).callback();
  assert.equal(details.open, true);
  document.events.keydown({ key: 'Escape' });
  assert.equal(details.open, false);
  summary.events.click();
  details.open = true;
  details.events.toggle();
  assert.equal(details.open, true);
  details.events.pointerleave({ relatedTarget: null });
  assert.equal(details.open, true);
});

test('a help bubble stays open while moving into it and cannot open inside a collapsed section', () => {
  const { button, bubble, details, timers } = setup();
  button.events.pointerenter({ pointerType: 'mouse' });
  timers.get(1).callback();
  button.events.pointerleave({ relatedTarget: bubble });
  assert.equal(details.open, true);
  details.events.pointerleave({ relatedTarget: null });
  assert.equal(details.open, false);
  const collapsed = setup({ closedParent: true });
  collapsed.button.events.pointerenter({ pointerType: 'mouse' });
  assert.equal(collapsed.timers.size, 0);
});

test('homepage disclosures use the same timed help and keep their native click behavior', () => {
  const { button, details, timers } = setup({ homepage: true });
  button.events.pointerenter({ pointerType: 'mouse' });
  assert.equal(timers.get(1).delay, 2000);
  timers.get(1).callback();
  assert.equal(details.open, true);
  button.events.click();
  assert.equal(details.open, true);
});
