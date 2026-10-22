const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const externalClasses = require('../src/lib/external-classes.js');
const inspector = require('../src/lib/package-inspector.js');
const session = require('../src/lib/import-session.js');
const conflicts = require('../src/lib/class-conflicts.js');
const classSync = require('../src/lib/class-sync.js');
const planner = require('../src/lib/import-planner.js');
const adapterApi = require('../src/editor/taptop-runtime-adapter.js');
const { getImportView } = require('../src/editor/import-ui.js');

const MOUNT = fs.readFileSync(path.join(__dirname, '../src/editor/mount-importer.js'), 'utf8');
const PACKAGE_TEXT = fs.readFileSync(path.join(__dirname, '../fixtures/compatibility/managed-external-page.json'), 'utf8');
const SITE = ['site-body', 'site-card', 'site-title'];
// Objects made inside the vm realm have their own prototypes; compare plain copies.
const plain = value => JSON.parse(JSON.stringify(value));

// A fake editor project: the class names it has, as the runtime adapter reads them.
function editorLayout(names) {
  return {
    mainClassNameCollection: { map: Object.fromEntries(names.map((name, index) => [`p${index}`, { id: `p${index}`, value: name }])) },
    designClassNameCollection: { map: {} },
    mainSelectorCollection: { map: {} }
  };
}

// Runs the real mount-importer.js against fake chrome, DOM and editor. The
// fake TaptopImporterUI captures the callbacks the mount wires, so the test
// drives inspectFile/importFile exactly as the dialog would.
// `projectNames` is a list, or a function of the 1-based number of the
// external-class lookup (null for lookups without `external`).
// `projectRules` maps a project class name to its rules, as observe-classes reads them.
function mountWithEditor({ projectNames, projectRules = {} }) {
  const calls = [];
  let externalLookups = 0;
  const namesFor = payload => (typeof projectNames === 'function' ? projectNames(payload.external ? ++externalLookups : null) : projectNames);
  const runtime = {
    probe: () => ({ ok: true, rootTagId: 'root', fingerprint: 'synthetic:fingerprint' }),
    classes: payload => adapterApi.projectClasses(editorLayout(namesFor(payload)), payload),
    'observe-classes': payload => Object.fromEntries(payload.classes.map(item => [item.stableKey, projectRules[item.name]
      ? { id: `p-${item.name}`, name: item.name, collection: 'main', rules: { main: { [`screen/.${item.name}`]: projectRules[item.name] } } }
      : null])),
    'check-class-names': () => [],
    'apply-class-plans': payload => ({ applied: payload.plans.map(plan => ({ stableKey: plan.stableKey, targetClassId: `t-${plan.name}`, appliedOperations: 0, stored: {} })), failures: [] }),
    insert: () => ({ rootTagId: 'inserted-root' }),
    confirm: payload => payload.rootTagId === 'inserted-root'
  };
  const storage = new Map();
  const element = () => ({ dataset: {}, style: { setProperty() {}, removeProperty() {} }, addEventListener() {}, append() {}, remove() {}, attachShadow: () => element(), isConnected: true });
  let options = null;
  const context = {
    console: { warn() {}, info() {}, log() {} },
    setInterval: () => 0, clearInterval() {},
    chrome: {
      runtime: {
        lastError: null,
        getURL: file => `chrome-extension://test/${file}`,
        sendMessage(message, respond) {
          calls.push({ action: message.action, payload: plain(message.payload) });
          Promise.resolve().then(() => {
            try { respond({ ok: true, result: plain(runtime[message.action](plain(message.payload))) }); }
            catch (error) { respond({ ok: false, error: error.message }); }
          });
        }
      }
    },
    document: { querySelector: () => null, querySelectorAll: () => [], createElement: element, body: { append() {} } },
    window: {
      location: { hostname: 'site-1.taptop.site', search: '?design_id=1&ver_id=2&access=secret-not-stored', origin: 'https://site-1.taptop.site' },
      localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      addEventListener() {}, removeEventListener() {}
    },
    TaptopExternalClasses: externalClasses, TaptopPackageInspector: inspector, TaptopImportSession: session, TaptopClassConflicts: conflicts, TaptopClassSync: classSync, TaptopImportPlanner: planner,
    TaptopImporterUI: { launcherPlacement: () => null, createImporterUI: given => { options = given; return {}; } }
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(MOUNT, context);
  context.TaptopToolkitImporter.mount();
  assert.ok(options, 'the mount wires the importer UI');
  const controller = { progress: [], completed: null, setProgress(phase) { this.progress.push(phase); }, complete(receipt) { this.completed = receipt; }, fail() {} };
  return {
    options, controller, calls, storage,
    externalLookups: () => externalLookups,
    writes: () => calls.filter(call => ['apply-class-plans', 'insert', 'insert-behavior'].includes(call.action)).map(call => call.action)
  };
}

const file = { name: 'demo.json', size: PACKAGE_TEXT.length, text: async () => PACKAGE_TEXT };
const ADOPT_COPY = { adopt: 'copy', conflicts: 'take' };

test('review refuses a file whose site classes the project lacks, naming them, and reads nothing else', async () => {
  const editor = mountWithEditor({ projectNames: ['site-card'] });
  const report = plain(await editor.options.onFileSelected(file));
  assert.equal(report.ok, false);
  assert.deepEqual(report.errors, ['EXTERNAL_CLASSES_MISSING: site-body, site-title']);
  assert.deepEqual(editor.calls.map(call => call.action), ['classes']);
  assert.deepEqual(report.details, { missing: ['site-body', 'site-title'] });
  assert.deepEqual(editor.calls[0].payload.external.map(item => item.name), SITE);
  // The dialog keeps message and details; the view formats the names from the details.
  const view = getImportView({ phase: 'invalid', fileName: file.name, message: report.errors[0], details: report.details });
  assert.equal(view.dropzone.reason, 'в проекте нет классов сайта: .site-body, .site-title.');
});

test('review lists the site classes when the project has them', async () => {
  const editor = mountWithEditor({ projectNames: SITE });
  const report = plain(await editor.options.onFileSelected(file));
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.classes.external, SITE);
  assert.deepEqual(report.classes.copies, []);
  assert.deepEqual(editor.writes(), []);
});

test('import refuses before any write when the site classes are missing', async () => {
  const editor = mountWithEditor({ projectNames: [] });
  await assert.rejects(editor.options.onImport(file, editor.controller, ADOPT_COPY), error => {
    assert.equal(error.code, 'EXTERNAL_CLASSES_MISSING');
    assert.equal(error.message, 'EXTERNAL_CLASSES_MISSING: site-body, site-card, site-title');
    assert.deepEqual(plain(error.details), { missing: SITE });
    assert.equal(error.retryable, false);
    return true;
  });
  assert.deepEqual(editor.writes(), []);
  assert.deepEqual(editor.controller.progress, []);
  // The planner refuses first; the session gate is the second line, not the only one.
  assert.deepEqual(editor.calls.map(call => call.action), ['probe', 'classes']);
});

test('the session re-checks the site classes at write time, before syncing or pasting', async () => {
  // Present while the import is planned (first lookup), gone when the session checks again.
  const editor = mountWithEditor({ projectNames: lookup => (lookup === null || lookup === 1 ? SITE : ['site-card']) });
  await assert.rejects(editor.options.onImport(file, editor.controller, ADOPT_COPY), error => {
    assert.equal(error.code, 'EXTERNAL_CLASSES_MISSING');
    assert.equal(error.message, 'EXTERNAL_CLASSES_MISSING: site-body, site-title');
    assert.deepEqual(plain(error.details), { missing: ['site-body', 'site-title'] }, 'the session failure carries the names as data');
    return true;
  });
  assert.equal(editor.externalLookups(), 2, 'the write-time check asked the editor again');
  assert.deepEqual(editor.writes(), []);
});

test('with the site classes present the import pastes the layers with their names and binds only managed classes', async () => {
  const editor = mountWithEditor({ projectNames: SITE });
  await editor.options.onImport(file, editor.controller, ADOPT_COPY);
  assert.equal(editor.controller.completed.rootTagId, 'inserted-root');
  assert.deepEqual(editor.writes(), ['apply-class-plans', 'insert']);
  const applied = editor.calls.find(call => call.action === 'apply-class-plans').payload.plans.map(plan => plan.name);
  assert.deepEqual(applied.filter(name => SITE.includes(name)), []);
  const pasted = editor.calls.find(call => call.action === 'insert').payload.clipboardData.copiedLayout.mainClassNameCollection.map;
  for (const name of SITE) assert.ok(Object.values(pasted).some(item => item.value === name), `${name} lost from the paste`);
  const receipts = [...editor.storage.values()].map(value => JSON.parse(value));
  assert.equal(receipts.length, 1);
  assert.deepEqual(receipts[0].classBindings.map(binding => binding.name).filter(name => SITE.includes(name)), []);
  assert.doesNotMatch(JSON.stringify(receipts), /secret-not-stored/);
});

test('review leaves a same-name project class to the user: listed for the choice, nothing written', async () => {
  // The project has its own `demo-card` with other rules; the file did not create it.
  const editor = mountWithEditor({ projectNames: [...SITE, 'demo-card'], projectRules: { 'demo-card': { color: { value: '#ff0000' } } } });
  const report = plain(await editor.options.onFileSelected(file));
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.classes.adopt, ['demo-card']);
  assert.deepEqual(report.classes.updated, []);
  assert.deepEqual(report.classes.copies, []);
  assert.deepEqual(editor.writes(), []);
  assert.ok(!editor.calls.some(call => call.action === 'apply-class-plans'));
  // The review offers the three choices for it.
  const view = getImportView({ phase: 'ready', backendAvailable: true, fileName: file.name, fileSize: 1, report });
  assert.deepEqual(view.choices.map(choice => choice.id), ['adopt']);
});
