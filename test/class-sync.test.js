const assert = require('node:assert/strict');
const test = require('node:test');

const sync = require('../src/lib/class-sync.js');

const rule = value => ({ name: 'x', value, isCustom: false, serializeValue: value });
const packageClass = (name, rules) => ({ stableKey: `site/page/class/${name}`, name, collection: 'main', ownedRules: { main: Object.fromEntries(Object.entries(rules).map(([scope, props]) => [scope, Object.fromEntries(Object.entries(props).map(([prop, value]) => [prop, rule(value)]))])) } });
const syncPackage = classes => ({ schemaVersion: 1, namespace: 'site', componentKey: 'site/page', revision: 'a'.repeat(64), classes, instances: [{ stableKey: 'site/page/instance', rootLogicalNodeKey: 'page' }] });
const path = (scope, prop) => sync.encodeRulePath('main', scope.split('/')[0], scope.slice(scope.indexOf('/') + 1), prop);

test('compares Taptop runtime shapes with package rules as one value', () => {
  assert.equal(sync.comparable({ source: '', isCustom: false, available: true, number: 24, unit: 'px' }), sync.comparable(rule('24px')));
  assert.equal(sync.comparable({ value: 'rgb(10, 10, 10)', isCustom: false }), sync.comparable(rule('#0A0A0A')));
  assert.equal(sync.comparable({ number: 0, unit: 'px' }), sync.comparable(rule('0')));
  assert.equal(sync.comparable({ number: 0, unit: 'auto' }), sync.comparable(rule('auto')));
  assert.equal(sync.comparable({ items: [{ value: 'minmax(0, 1fr)' }, { value: 'minmax(0, 1fr)' }] }), sync.comparable({ ...rule('repeat(2, minmax(0, 1fr))'), items: [{ value: 'minmax(0, 1fr)' }, { value: 'minmax(0, 1fr)' }] }));
  assert.notEqual(sync.comparable(rule('24px')), sync.comparable(rule('25px')));
});

test('a class absent from the project is created; a same-name unbound class needs a decision', () => {
  const pkg = syncPackage([packageClass('faq', { 'screen/.faq': { 'padding-top': '160px' } }), packageClass('card', { 'screen/.card': { color: '#111111' } })]);
  const observed = { 'site/page/class/card': { id: 'class_card', name: 'card', collection: 'main', rules: { main: { 'screen/.card': { color: { value: '#222222' } } } } }, 'site/page/class/faq': null };
  const preview = sync.previewClassSync({ targetKey: 'host:design:1:version:2', packageData: pkg, receipt: null, observed });
  assert.deepEqual(preview.plans.map(plan => plan.classAction.type), ['create', 'adopt-required']);
  assert.deepEqual(sync.summarize(preview).adopt, ['card']);
});

test('re-import with a receipt updates only what the file changed and keeps untouched values', () => {
  const v1 = packageClass('faq', { 'screen/.faq': { 'padding-top': '160px', color: '#0a0a0a' } });
  const binding = { stableKey: v1.stableKey, targetClassId: 'class_faq', name: 'faq', collection: 'main', ownedPaths: [path('screen/.faq', 'color'), path('screen/.faq', 'padding-top')], baseline: { [path('screen/.faq', 'color')]: sync.comparable(rule('#0a0a0a')), [path('screen/.faq', 'padding-top')]: sync.comparable(rule('160px')) } };
  const receipt = { schemaVersion: 1, targetKey: 't:design:1:version:2', namespace: 'site', componentKey: 'site/page', packageRevision: 'b'.repeat(64), classBindings: [binding], instanceBindings: [] };
  const v2 = packageClass('faq', { 'screen/.faq': { 'padding-top': '120px', color: '#0a0a0a' } });
  const observed = { [v1.stableKey]: { id: 'class_faq', name: 'faq', collection: 'main', rules: { main: { 'screen/.faq': { 'padding-top': { number: 160, unit: 'px' }, color: { value: 'rgb(10, 10, 10)' } } } } } };
  const preview = sync.previewClassSync({ targetKey: 't:design:1:version:2', packageData: syncPackage([v2]), receipt, observed });
  assert.equal(preview.blockers.length, 0);
  assert.deepEqual(preview.plans[0].propertyPlan.operations.map(op => [op.type, JSON.parse(op.path)[3], op.value.value]), [['set', 'padding-top', '120px']]);
  assert.deepEqual(sync.summarize(preview).updated, [{ name: 'faq', properties: ['padding-top'] }]);
});

test('an unchanged re-import is a no-op, not a duplicate', () => {
  const v1 = packageClass('faq', { 'screen/.faq': { 'padding-top': '160px' } });
  const receipt = { schemaVersion: 1, targetKey: 't:design:1:version:2', namespace: 'site', componentKey: 'site/page', packageRevision: 'b'.repeat(64), classBindings: [{ stableKey: v1.stableKey, targetClassId: 'class_faq', name: 'faq', collection: 'main', ownedPaths: [path('screen/.faq', 'padding-top')], baseline: { [path('screen/.faq', 'padding-top')]: sync.comparable(rule('160px')) } }], instanceBindings: [] };
  const observed = { [v1.stableKey]: { id: 'class_faq', name: 'faq', collection: 'main', rules: { main: { 'screen/.faq': { 'padding-top': { number: 160, unit: 'px' } } } } } };
  const preview = sync.previewClassSync({ targetKey: 't:design:1:version:2', packageData: syncPackage([v1]), receipt, observed });
  assert.deepEqual(preview.plans[0].propertyPlan.operations, []);
  assert.deepEqual(sync.summarize(preview).unchanged, ['faq']);
});

test('a value edited in Taptop and in the file is a conflict resolved by the user choice', () => {
  const v1 = packageClass('faq', { 'screen/.faq': { 'padding-top': '160px' } });
  const receipt = { schemaVersion: 1, targetKey: 't:design:1:version:2', namespace: 'site', componentKey: 'site/page', packageRevision: 'b'.repeat(64), classBindings: [{ stableKey: v1.stableKey, targetClassId: 'class_faq', name: 'faq', collection: 'main', ownedPaths: [path('screen/.faq', 'padding-top')], baseline: { [path('screen/.faq', 'padding-top')]: sync.comparable(rule('160px')) } }], instanceBindings: [] };
  const observed = { [v1.stableKey]: { id: 'class_faq', name: 'faq', collection: 'main', rules: { main: { 'screen/.faq': { 'padding-top': { number: 200, unit: 'px' } } } } } };
  const v2 = packageClass('faq', { 'screen/.faq': { 'padding-top': '120px' } });
  const preview = sync.previewClassSync({ targetKey: 't:design:1:version:2', packageData: syncPackage([v2]), receipt, observed });
  assert.deepEqual(sync.summarize(preview).conflicts, [{ name: 'faq', properties: ['padding-top'] }]);
  const keep = sync.resolvePlans(preview, { conflicts: 'keep' });
  assert.deepEqual(keep.plans[0].propertyPlan.operations, []);
  const take = sync.resolvePlans(preview, { conflicts: 'take' });
  assert.equal(take.plans[0].propertyPlan.operations[0].value.value, '120px');
  assert.equal(take.blockers.length, 0);
});

test('adopting an existing class overwrites it from the file and binds it for next time', () => {
  const pkg = syncPackage([packageClass('card', { 'screen/.card': { color: '#111111' } })]);
  const observed = { 'site/page/class/card': { id: 'class_card', name: 'card', collection: 'main', rules: { main: { 'screen/.card': { color: { value: '#222222' } } } } } };
  const preview = sync.previewClassSync({ targetKey: 't:design:1:version:2', packageData: pkg, receipt: null, observed });
  const adopted = sync.adopt({ preview, packageData: pkg, receipt: null });
  const next = sync.previewClassSync({ targetKey: 't:design:1:version:2', packageData: pkg, receipt: adopted, observed });
  assert.equal(next.plans[0].classAction.type, 'reuse');
  assert.equal(next.plans[0].propertyPlan.operations[0].value.value, '#111111');
  assert.equal(next.blockers.length, 0);
});

test('a bound class deleted in Taptop is created again', () => {
  const v1 = packageClass('faq', { 'screen/.faq': { 'padding-top': '160px' } });
  const receipt = { schemaVersion: 1, targetKey: 't:design:1:version:2', namespace: 'site', componentKey: 'site/page', packageRevision: 'b'.repeat(64), classBindings: [{ stableKey: v1.stableKey, targetClassId: 'class_gone', name: 'faq', collection: 'main', ownedPaths: [], baseline: {} }], instanceBindings: [] };
  const preview = sync.previewClassSync({ targetKey: 't:design:1:version:2', packageData: syncPackage([v1]), receipt, observed: { [v1.stableKey]: null } });
  assert.equal(preview.plans[0].classAction.type, 'create');
});

test('stores receipts per editor target, namespace and page and binds the pasted root', () => {
  const storage = new Map();
  const store = sync.createReceiptStore({ getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) });
  const receipt = { schemaVersion: 1, targetKey: 't:design:1:version:2', namespace: 'site', componentKey: 'site/page', packageRevision: 'b'.repeat(64), classBindings: [], instanceBindings: [] };
  store.saveReceipt(sync.bindRoot(receipt, syncPackage([]), 'root-1'));
  assert.deepEqual(store.loadReceipt({ targetKey: 't:design:1:version:2', namespace: 'site', componentKey: 'site/page' }).instanceBindings, [{ stableKey: 'site/page/instance', targetTagId: 'root-1' }]);
  assert.equal(sync.targetKeyFor(new URL('https://site-1.taptop.site/-/cms/v1/mosaic/?ver_id=9&design_id=7&access=x')), 'site-1.taptop.site:design:7:version:9');
});

test('a value Taptop stores in its own spelling is not an edit on the next import', () => {
  const gradient = 'linear-gradient(rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0) 100%)';
  const v1 = packageClass('fill', { 'screen/.fill': { 'background-image': gradient } });
  const created = sync.previewClassSync({ targetKey: 't:design:1:version:2', packageData: syncPackage([v1]), receipt: null, observed: { [v1.stableKey]: null } });
  const gradientPath = path('screen/.fill', 'background-image');
  const respelled = 'linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,0) 100%)';
  const receipt = sync.nextReceipt({ preview: created, packageData: syncPackage([v1]), applied: [{ stableKey: v1.stableKey, targetClassId: 'class_fill', stored: { [gradientPath]: respelled } }] });
  assert.equal(receipt.classBindings[0].stored[gradientPath], respelled);
  const observed = { [v1.stableKey]: { id: 'class_fill', name: 'fill', collection: 'main', rules: { main: { 'screen/.fill': { 'background-image': { items: [{ kind: 'fill', src: 'rgba(0,0,0,0) 0%, rgba(0,0,0,0) 100%' }] } } } } } };
  const again = sync.previewClassSync({ targetKey: 't:design:1:version:2', packageData: syncPackage([v1]), receipt, observed });
  assert.deepEqual(sync.summarize(again).unchanged, ['fill']);
  const v2 = packageClass('fill', { 'screen/.fill': { 'background-image': 'linear-gradient(#ffffff 0%, #000000 100%)' } });
  const changed = sync.previewClassSync({ targetKey: 't:design:1:version:2', packageData: syncPackage([v2]), receipt, observed });
  assert.deepEqual(sync.summarize(changed).updated, [{ name: 'fill', properties: ['background-image'] }]);
});

// Live 2026-10-12: the first import wrote width: fit-content natively, Taptop
// stored 0px but the receipt kept "fit-content". The next file sends it as a
// custom rule; the re-import must apply it instead of keeping 0px as a user edit.
test('a value that turns custom in the file is re-applied over what Taptop stored', () => {
  const p = path('screen/.chip', 'width');
  const incoming = { [p]: { name: 'width', value: 'fit-content', isCustom: true, serializeValue: 'fit-content' } };
  const current = { [p]: { source: '', isCustom: false, available: true, number: 0, unit: 'px' } };
  const merge = sync.planPropertyMerge({ baseline: { [p]: 'fit-content' }, stored: { [p]: 'fit-content' }, incoming, current, ownedPaths: [p] });
  assert.equal(merge.preserved.length, 0);
  assert.equal(merge.conflicts.length + merge.operations.length, 1);
  assert.notEqual(sync.comparable(incoming[p]), sync.comparable({ value: 'fit-content', isCustom: false }));
});
