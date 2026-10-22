const assert = require('node:assert/strict');
const test = require('node:test');

const { createImporterUI } = require('../src/editor/import-ui.js');

// Minimal fake DOM for createImporterUI: markup is kept as the string the
// dialog renders (body.innerHTML), every element is an inert stub, and events
// are fired by hand with a target whose closest() answers the selectors the
// dialog's click handler asks. Enough to drive file → review → import → result.
function stub() {
  const listeners = {};
  const children = new Map();
  const node = {
    dataset: {}, style: {}, hidden: false, value: '', open: false, innerHTML: '', textContent: '', files: null,
    addEventListener(type, handler) { (listeners[type] ||= []).push(handler); },
    fire(type, event = {}) { for (const handler of listeners[type] || []) handler({ preventDefault() {}, target: node, ...event }); },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, stub()); return children.get(selector); },
    append() {}, remove() {}, setAttribute() {}, removeAttribute() {}, focus() {}, click() {},
    showModal() { node.open = true; }, close() { node.open = false; },
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 })
  };
  return node;
}
// A click target that "is inside" the elements named by selector.
const target = matches => ({ closest: selector => matches[selector] || null });
const settle = () => new Promise(resolve => setImmediate(resolve));

function dialog({ onFileSelected, onImport }) {
  const root = stub();
  const doc = { createElement: () => stub(), defaultView: { setTimeout: () => 0 } };
  createImporterUI({ document: doc, root, onFileSelected, onImport, onRetry: onImport, backendAvailable: true });
  const body = root.querySelector('.tt-body');
  const fileInput = root.querySelector('.tt-file-input');
  return {
    markup: () => body.innerHTML,
    async pick(file) { fileInput.files = [file]; fileInput.fire('change'); await settle(); },
    async click(matches) { body.fire('click', { target: target(matches) }); await settle(); }
  };
}

const file = { name: 'page.json', size: 10 };
const adoptReport = { ok: true, summary: { nodes: 1, classes: 2, instances: 1, assets: 0 }, classes: { available: true, total: 2, created: ['a'], updated: [], unchanged: [], adopt: ['card'], conflicts: [], copies: [], external: [] } };

test('a refused file shows the missing site classes from the report details', async () => {
  const ui = dialog({ onFileSelected: async () => ({ ok: false, errors: ['EXTERNAL_CLASSES_MISSING: not-these'], details: { missing: ['site-body', 'site-title'] } }) });
  await ui.pick(file);
  assert.match(ui.markup(), /Файл не подходит/);
  assert.ok(ui.markup().includes('в проекте нет классов сайта: .site-body, .site-title.'), ui.markup());
  assert.doesNotMatch(ui.markup(), /not-these|Ничего не добавлено/);
});

// Regression 2026-10-15: selectFile stored the translated reason, the view
// translated it again and every reason became «повреждён».
test('a refused file reason is translated once', async () => {
  const ui = dialog({ onFileSelected: async () => ({ ok: false, errors: ['Unsupported package type'] }) });
  await ui.pick(file);
  assert.ok(ui.markup().includes('нужен JSON из Toolkit.'), ui.markup());
  assert.doesNotMatch(ui.markup(), /повреждён/);
});

test('the chosen option is what the import runs with, and the options keep their full label on hover', async () => {
  let decisions = null;
  const ui = dialog({ onFileSelected: async () => adoptReport, onImport: async (picked, controller, given) => { decisions = given; } });
  await ui.pick(file);
  assert.match(ui.markup(), /data-stacked/);
  assert.match(ui.markup(), /data-value="existing" title="Существующие">Существующие</);
  await ui.click({ '[data-choice]': { dataset: { choice: 'adopt', value: 'existing' } } });
  assert.ok(ui.markup().includes('aria-checked="true" data-choice="adopt" data-value="existing"'), 'the chosen option is shown as selected');
  assert.ok(ui.markup().includes('Использовать существующие: '), 'its hint is shown');
  await ui.click({ '[data-action]': { dataset: { action: 'import' } } });
  assert.deepEqual(decisions, { adopt: 'existing', conflicts: 'take' });
});

test('without a choice the import runs with copies', async () => {
  let decisions = null;
  const ui = dialog({ onFileSelected: async () => adoptReport, onImport: async (picked, controller, given) => { decisions = given; } });
  await ui.pick(file);
  await ui.click({ '[data-action]': { dataset: { action: 'import' } } });
  assert.deepEqual(decisions, { adopt: 'copy', conflicts: 'take' });
});

test('a failed import names the missing site classes from the error details', async () => {
  const ui = dialog({
    onFileSelected: async () => adoptReport,
    onImport: async () => { const error = new Error('EXTERNAL_CLASSES_MISSING: not-these'); error.code = 'EXTERNAL_CLASSES_MISSING'; error.retryable = false; error.details = { missing: ['site-title'] }; throw error; }
  });
  await ui.pick(file);
  await ui.click({ '[data-action]': { dataset: { action: 'import' } } });
  assert.match(ui.markup(), /Импорт не выполнен/);
  assert.ok(ui.markup().includes('В проекте нет классов сайта: .site-title.<br>На страницу ничего не добавлено.'), ui.markup());
});
