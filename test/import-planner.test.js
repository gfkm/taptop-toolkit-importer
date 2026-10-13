const assert = require('node:assert/strict');
const test = require('node:test');

const sync = require('../src/lib/class-sync.js');
const { planImport, pendingPlans } = require('../src/lib/import-planner.js');

const rule = value => ({ name: 'x', value, isCustom: false, serializeValue: value });
const TARGET = 'site-1.taptop.site:design:1:version:2';

// Synthetic package with two classes, `hero` and `card`.
function wrapper(heroPadding = '160px') {
  const classes = { hero: { 'padding-top': heroPadding }, card: { color: '#111111' } };
  return {
    clipboardData: { copiedLayout: {
      mainClassNameCollection: { map: { a: { value: 'hero' }, b: { value: 'card' } } },
      mainSelectorCollection: { map: Object.fromEntries(Object.entries(classes).map(([name, rules]) => [`screen/.${name}`, { selectorText: `.${name}`, rules: Object.fromEntries(Object.entries(rules).map(([prop, value]) => [prop, rule(value)])) }])) },
      tree: { tags: { t1: { name: 'hero' }, t2: { name: 'card' } } }
    } },
    syncPackage: {
      schemaVersion: 1, namespace: 'demo', componentKey: 'demo/page', revision: 'a'.repeat(64),
      instances: [{ stableKey: 'demo/page/instance', rootLogicalNodeKey: 'page' }],
      classes: Object.entries(classes).map(([name, rules]) => ({ stableKey: `demo/page/class/${name}`, name, collection: 'main', ownedRules: { main: { [`screen/.${name}`]: Object.fromEntries(Object.entries(rules).map(([prop, value]) => [prop, rule(value)])) } } }))
    }
  };
}

// Fake project: name -> { id, rules } with runtime-shaped values.
function project(classes) {
  const observe = async packageClasses => Object.fromEntries(packageClasses.map(item => {
    const found = Object.entries(classes).find(([name, value]) => name === item.name || value.id === item.boundId);
    return [item.stableKey, found ? { id: found[1].id, name: found[0], collection: 'main', rules: { main: { [`screen/.${found[0]}`]: found[1].rules } } } : null];
  }));
  const lookup = async query => ({ available: true, existing: (query.names || []).filter(name => classes[name]), selectors: {} });
  return { observe, lookup };
}

test('first import into an empty project creates every class', async () => {
  const result = await planImport({ wrapper: wrapper(), decisions: { adopt: 'copy', conflicts: 'keep' }, targetKey: TARGET, ...project({}) });
  assert.deepEqual(result.classes.created, ['hero', 'card']);
  assert.equal(pendingPlans(result.resolved).length, 2);
});

test('re-import after a receipt updates the changed class in place, no copies', async () => {
  const first = await planImport({ wrapper: wrapper(), decisions: { adopt: 'copy' }, targetKey: TARGET, ...project({}) });
  const receipt = sync.nextReceipt({ preview: first.resolved, packageData: first.wrapper.syncPackage, receipt: first.receipt, applied: [{ stableKey: 'demo/page/class/hero', targetClassId: 'c-hero' }, { stableKey: 'demo/page/class/card', targetClassId: 'c-card' }] });
  const { observe, lookup } = project({ hero: { id: 'c-hero', rules: { 'padding-top': { number: 160, unit: 'px' } } }, card: { id: 'c-card', rules: { color: { value: 'rgb(17, 17, 17)' } } } });
  const second = await planImport({ wrapper: wrapper('120px'), decisions: { adopt: 'copy' }, targetKey: TARGET, receipt, observe, lookup });
  assert.deepEqual(second.classes.updated, [{ name: 'hero', properties: ['padding-top'] }]);
  assert.deepEqual(second.classes.unchanged, ['card']);
  assert.deepEqual(second.classes.copies, []);
  assert.deepEqual(pendingPlans(second.resolved).map(plan => plan.name), ['hero']);
});

test('an identical same-name class is taken over silently', async () => {
  const { observe, lookup } = project({ card: { id: 'c-card', rules: { color: { value: '#111111' } } } });
  const result = await planImport({ wrapper: wrapper(), decisions: null, targetKey: TARGET, observe, lookup });
  assert.deepEqual(result.classes.adopt, []);
  assert.deepEqual(result.classes.unchanged, ['card']);
});

test('a different same-name class is a choice: copy by default, update on request', async () => {
  const projectClasses = { card: { id: 'c-card', rules: { color: { value: '#222222' } } } };
  const review = await planImport({ wrapper: wrapper(), decisions: null, targetKey: TARGET, ...project(projectClasses) });
  assert.deepEqual(review.classes.adopt, ['card']);

  const copy = await planImport({ wrapper: wrapper(), decisions: { adopt: 'copy' }, targetKey: TARGET, ...project(projectClasses) });
  assert.deepEqual(copy.classes.copies, [{ name: 'card', copy: 'card-2' }]);
  assert.deepEqual(copy.classes.created, ['hero']);
  assert.equal(copy.wrapper.clipboardData.copiedLayout.tree.tags.t2.name, 'card-2');

  const update = await planImport({ wrapper: wrapper(), decisions: { adopt: 'update' }, targetKey: TARGET, ...project(projectClasses) });
  assert.deepEqual(update.classes.updated, [{ name: 'card', properties: ['color'] }]);
  assert.equal(update.wrapper.clipboardData.copiedLayout.tree.tags.t2.name, 'card');
});

test('a bound class renamed in Taptop keeps its new name in the pasted block', async () => {
  const first = await planImport({ wrapper: wrapper(), decisions: { adopt: 'copy' }, targetKey: TARGET, ...project({}) });
  const receipt = sync.nextReceipt({ preview: first.resolved, packageData: first.wrapper.syncPackage, receipt: null, applied: [{ stableKey: 'demo/page/class/hero', targetClassId: 'c-hero' }, { stableKey: 'demo/page/class/card', targetClassId: 'c-card' }] });
  const observe = async classes => Object.fromEntries(classes.map(item => [item.stableKey, item.name === 'hero'
    ? { id: 'c-hero', name: 'banner', collection: 'main', rules: { main: { 'screen/.hero': { 'padding-top': { number: 160, unit: 'px' } } } } }
    : { id: 'c-card', name: 'card', collection: 'main', rules: { main: { 'screen/.card': { color: { value: '#111111' } } } } }]));
  const result = await planImport({ wrapper: wrapper(), decisions: { adopt: 'copy' }, targetKey: TARGET, receipt, observe, lookup: async () => ({ available: true, existing: [] }) });
  assert.equal(result.wrapper.clipboardData.copiedLayout.tree.tags.t1.name, 'banner');
});

test('without the runtime class reader the old copy rule still protects the block', async () => {
  const result = await planImport({ wrapper: wrapper(), decisions: { adopt: 'copy' }, targetKey: TARGET, observe: async () => { throw new Error('no runtime'); }, lookup: async () => ({ available: false }) });
  assert.equal(result.preview, null);
  assert.equal(result.classes.available, false);
});
