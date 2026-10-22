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

test('«use existing» keeps the layer on the project class and syncs nothing for it', async () => {
  const projectClasses = { card: { id: 'c-card', rules: { color: { value: '#222222' } } } };
  const result = await planImport({ wrapper: wrapper(), decisions: { adopt: 'existing', conflicts: 'take' }, targetKey: TARGET, ...project(projectClasses) });
  assert.deepEqual(result.classes.existing, ['card']);
  assert.deepEqual(result.classes.adopt, []);
  assert.deepEqual(result.classes.copies, []);
  assert.deepEqual(result.classes.created, ['hero']);
  assert.deepEqual(result.classes.updated, []);
  assert.deepEqual(result.resolved.blockers, []);
  assert.deepEqual(pendingPlans(result.resolved).map(plan => plan.name), ['hero']);
  const layout = result.wrapper.clipboardData.copiedLayout;
  assert.equal(layout.tree.tags.t2.name, 'card');
  assert.equal(layout.mainClassNameCollection.map.b.value, 'card');
  assert.equal(layout.mainSelectorCollection.map['screen/.card'], undefined, 'the pasted block carries no rules for the kept class');
  assert.ok(layout.mainSelectorCollection.map['screen/.hero']);
  // The receipt binds only what this file created; the kept class stays unowned.
  const receipt = sync.nextReceipt({ preview: result.resolved, packageData: result.wrapper.syncPackage, receipt: result.receipt, applied: [{ stableKey: 'demo/page/class/hero', targetClassId: 'c-hero' }] });
  assert.deepEqual(receipt.classBindings.map(binding => binding.stableKey), ['demo/page/class/hero']);
});

// Same package plus `site-title`, a target-site class used by name with no rules.
function externalWrapper() {
  const source = wrapper();
  const layout = source.clipboardData.copiedLayout;
  layout.mainClassNameCollection.map.s = { value: 'site-title' };
  layout.tree.tags.t3 = { name: 'site-title' };
  source.externalClasses = [{ name: 'site-title', collection: 'main' }];
  return source;
}

// Fake project that also answers the external-class query.
function siteProject(classes, siteClasses) {
  const base = project(classes);
  const all = { ...classes, ...siteClasses };
  const lookup = async query => ({
    available: true,
    existing: (query.names || []).filter(name => all[name]),
    selectors: Object.fromEntries((query.names || []).filter(name => all[name]).map(name => [`screen/.${name}`, { color: '#ff0000' }])),
    ...(query.external ? { externalPresent: query.external.filter(item => siteClasses[item.name]).map(item => item.name) } : {})
  });
  return { observe: base.observe, lookup };
}

test('a package whose site classes are all in the project never copies or syncs them', async () => {
  const result = await planImport({ wrapper: externalWrapper(), decisions: { adopt: 'copy', conflicts: 'take' }, targetKey: TARGET, ...siteProject({}, { 'site-title': { id: 'c-site' } }) });
  assert.equal(result.refused, undefined);
  assert.deepEqual(result.classes.external, ['site-title']);
  assert.deepEqual(result.classes.copies, []);
  assert.ok(result.resolved.plans.every(plan => plan.name !== 'site-title'));
  assert.equal(result.wrapper.clipboardData.copiedLayout.tree.tags.t3.name, 'site-title');
  assert.equal(result.wrapper.clipboardData.copiedLayout.mainClassNameCollection.map.s.value, 'site-title');
});

test('a missing site class refuses the plan before anything is planned to change', async () => {
  let observed = false;
  const { lookup } = siteProject({}, {});
  const result = await planImport({ wrapper: externalWrapper(), decisions: { adopt: 'update', conflicts: 'take' }, targetKey: TARGET, lookup, observe: async () => { observed = true; return {}; } });
  assert.deepEqual(result.refused, { code: 'EXTERNAL_CLASSES_MISSING', missing: ['site-title'] });
  assert.equal(result.resolved, null);
  assert.deepEqual(pendingPlans(result.resolved), []);
  assert.equal(observed, false);
});

test('site classes that cannot be checked refuse the plan as unverified', async () => {
  for (const lookup of [async () => { throw new Error('no runtime'); }, async () => ({ available: false }), async () => ({ available: true, existing: [] })]) {
    const result = await planImport({ wrapper: externalWrapper(), decisions: null, targetKey: TARGET, lookup, observe: async () => ({}) });
    assert.deepEqual(result.refused, { code: 'EXTERNAL_CLASSES_UNVERIFIED', missing: ['site-title'] });
  }
});

test('a malformed externalClasses declaration refuses the plan as invalid', async () => {
  // A wrong collection is a malformed file, not an editor that did not answer.
  for (const externalClasses of [{ name: 'site-title', collection: 'main' }, [{ name: 'site-title', collection: 'cm' }]]) {
    let looked = false;
    const result = await planImport({ wrapper: { ...wrapper(), externalClasses }, decisions: { adopt: 'copy' }, targetKey: TARGET, lookup: async () => { looked = true; return { available: true, existing: [] }; }, observe: async () => ({}) });
    assert.deepEqual(result.refused, { code: 'EXTERNAL_CLASSES_INVALID', missing: [] });
    assert.equal(result.resolved, null);
    assert.equal(looked, false);
  }
});

test('without the runtime class reader the old copy rule still protects the block', async () => {
  const result = await planImport({ wrapper: wrapper(), decisions: { adopt: 'copy' }, targetKey: TARGET, observe: async () => { throw new Error('no runtime'); }, lookup: async () => ({ available: false }) });
  assert.equal(result.preview, null);
  assert.equal(result.classes.available, false);
});
