const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const test = require('node:test');
const { inspectPackage } = require('../src/lib/package-inspector');
const { planImport } = require('../src/lib/import-planner');
const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/compatibility', name), 'utf8'));

test('a compiler-produced image package is accepted with verified bytes', async () => {
  const pkg = fixture('image.json');
  const inspected = await inspectPackage({ packageText: JSON.stringify(pkg) });
  assert.equal(inspected.ok, true, inspected.errors?.join('\n'));
  assert.equal(inspected.summary.assets, 1);
  const changed = structuredClone(pkg);
  changed.embeddedAssets[0].data = Buffer.from('changed').toString('base64');
  assert.equal((await inspectPackage({ packageText: JSON.stringify(changed) })).ok, false);
});

test('compiler-produced page roles remain unchanged after importing its UI kit', async () => {
  const kit = fixture('ui-kit.json');
  const page = fixture('page.json');
  assert.equal((await inspectPackage({ packageText: JSON.stringify(page) })).ok, true);
  const kitByName = new Map(kit.syncPackage.classes.map(item => [item.name, item]));
  const roles = ['type-title', 'btn', 'btn--secondary', 'link'];
  const observe = async incoming => Object.fromEntries(incoming.map(item => {
    const existing = kitByName.get(item.name);
    return [item.stableKey, existing ? { id: `existing-${item.name}`, name: item.name, collection: existing.collection, rules: existing.ownedRules } : null];
  }));
  const lookup = async query => ({ available: true, existing: query.names.filter(name => kitByName.has(name)), selectors: {} });
  const result = await planImport({ wrapper: page, decisions: null, targetKey: 'synthetic-target:design:1:version:2', observe, lookup });
  for (const role of roles) assert.ok(result.classes.unchanged.includes(role), `${role} was not reused`);
});

test('the versioned contract snapshot matches its recorded hash', () => {
  const snapshot = fixture('contract-snapshot.json');
  for (const entry of snapshot.files) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'contracts', entry.path));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
});

test('managed-build packages share project class keys and reuse UI-kit roles unchanged', async () => {
  const kit = fixture('managed-ui-kit.json');
  const page = fixture('managed-page.json');
  for (const pkg of [kit, page]) {
    const inspected = await inspectPackage({ packageText: JSON.stringify(pkg) });
    assert.equal(inspected.ok, true, inspected.errors?.join('\n'));
  }
  assert.equal(page.embeddedAssets.length, 1);
  const kitByName = new Map(kit.syncPackage.classes.map(item => [item.name, item]));
  const roles = ['type-title', 'btn', 'btn--secondary', 'link'];
  for (const role of roles) {
    const pageClass = page.syncPackage.classes.find(item => item.name === role);
    assert.equal(pageClass.stableKey, `${page.syncPackage.namespace}/class/${role}`);
    assert.equal(pageClass.stableKey, kitByName.get(role).stableKey);
  }
  assert.notEqual(page.syncPackage.componentKey, kit.syncPackage.componentKey);
  const observe = async incoming => Object.fromEntries(incoming.map(item => {
    const existing = kitByName.get(item.name);
    return [item.stableKey, existing ? { id: `existing-${item.name}`, name: item.name, collection: existing.collection, rules: existing.ownedRules } : null];
  }));
  const lookup = async query => ({ available: true, existing: query.names.filter(name => kitByName.has(name)), selectors: {} });
  const result = await planImport({ wrapper: page, decisions: null, targetKey: 'synthetic-target:design:1:version:2', observe, lookup });
  for (const role of roles) assert.ok(result.classes.unchanged.includes(role), `${role} was not reused`);
  assert.deepEqual(result.classes.conflicts, []);
  const snapshot = fixture('managed-snapshot.json');
  for (const entry of snapshot.files) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'contracts', entry.path));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
  }
});
