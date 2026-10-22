const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { inspectPackage } = require('../src/lib/package-inspector');

function packageText(bytes = Buffer.from('pixel')) {
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  return JSON.stringify({
    type: 'taptop-enhancer-layer-export', version: 2, sourceRevision: 'a'.repeat(64),
    clipboardData: { copiedLayout: { tree: { tags: { root: {}, image: { widgetName: 'image__img', __pendingUpload: { assetKey: `asset/${sha256}` } } } } } },
    syncPackage: {
      schemaVersion: 1, namespace: 'client', componentKey: 'hero', revision: 'b'.repeat(64), classes: [{ stableKey: 'hero/root' }], instances: [{ stableKey: 'hero/instance' }]
    },
    embeddedAssets: [{ stableKey: `asset/${sha256}`, sha256, mimeType: 'image/png', width: 1, height: 1, byteLength: bytes.length, encoding: 'base64', data: bytes.toString('base64') }]
  });
}

test('reports a self-contained valid package', async () => {
  const bytes = Buffer.from('pixel');
  const result = await inspectPackage({ packageText: packageText(bytes) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.summary, { nodes: 2, classes: 1, instances: 1, assets: 1 });
});

test('accepts a self-contained package with a large embedded asset', async () => {
  const result = await inspectPackage({ packageText: packageText(Buffer.alloc(512 * 1024, 7)) });
  assert.equal(result.ok, true, result.errors?.join('\n'));
});

test('reports malformed embedded bytes without asking for an asset folder', async () => {
  const bytes = Buffer.from('pixel');
  const wrapper = JSON.parse(packageText(bytes));
  wrapper.embeddedAssets[0].data = 'not-base64!';
  let result = await inspectPackage({ packageText: JSON.stringify(wrapper) });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Base64/);
  wrapper.embeddedAssets[0].data = bytes.toString('base64');
  wrapper.embeddedAssets[0].byteLength += 1;
  result = await inspectPackage({ packageText: JSON.stringify(wrapper) });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /byteLength/);
});

test('rejects malformed wrappers and unsupported versions', async () => {
  let result = await inspectPackage({ packageText: '{' });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /valid JSON/);
  const wrapper = JSON.parse(packageText()); wrapper.version = 1;
  result = await inspectPackage({ packageText: JSON.stringify(wrapper) });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /separate asset folder/);
});

test('rejects duplicate embedded asset identities before an import can begin', async () => {
  const wrapper = JSON.parse(packageText());
  wrapper.embeddedAssets.push({ ...wrapper.embeddedAssets[0] });
  const result = await inspectPackage({ packageText: JSON.stringify(wrapper) });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /Duplicate embedded asset stableKey/);
});

test('accepts a fixture-backed Embed behavior package and rejects a non-Embed behavior layer', async () => {
  const wrapper = JSON.parse(packageText());
  wrapper.behaviorPackages = [{
    key: 'behavior/faq-accordion', adapter: 'taptop/embed-accordion-v1',
    clipboardData: { tagID: 'embed', copiedLayout: { tree: { root: 'embed', tags: { embed: { id: 'embed', widgetName: 'tt_embed' } } } } }
  }];
  let result = await inspectPackage({ packageText: JSON.stringify(wrapper) });
  assert.equal(result.ok, true, result.errors?.join('\n'));
  wrapper.behaviorPackages[0].clipboardData.copiedLayout.tree.tags.embed.widgetName = 'div';
  result = await inspectPackage({ packageText: JSON.stringify(wrapper) });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /tt_embed/);
});

// Toolkit-built synthetic page using three target-site classes by name.
const externalPackage = () => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/compatibility/managed-external-page.json'), 'utf8'));
async function externalErrors(change) {
  const wrapper = externalPackage();
  change(wrapper);
  const result = await inspectPackage({ packageText: JSON.stringify(wrapper) });
  assert.equal(result.ok, false);
  return result.errors.join('\n');
}

test('accepts a package that lists its external classes', async () => {
  const result = await inspectPackage({ packageText: JSON.stringify(externalPackage()) });
  assert.equal(result.ok, true, result.errors?.join('\n'));
});

test('external classes must be a sorted list of { name, collection } without duplicates', async () => {
  assert.match(await externalErrors(w => { w.externalClasses = { name: 'site-card' }; }), /externalClasses must be an array/);
  assert.match(await externalErrors(w => { w.externalClasses[0] = 'site-body'; }), /externalClasses\[0\] must be \{ name: <class name>, collection: "main" \| "design" \}/);
  assert.match(await externalErrors(w => { w.externalClasses[0].collection = 'cm'; }), /externalClasses\[0\] must be/);
  assert.match(await externalErrors(w => { w.externalClasses[0].extra = true; }), /externalClasses\[0\] must be/);
  assert.match(await externalErrors(w => { w.externalClasses[0].name = '.site-body'; }), /externalClasses\[0\] must be/);
  assert.match(await externalErrors(w => { w.externalClasses.reverse(); }), /externalClasses must be sorted by name without duplicates/);
  assert.match(await externalErrors(w => { w.externalClasses.splice(1, 0, { ...w.externalClasses[0] }); }), /sorted by name without duplicates/);
});

test('an external class is one clipboard class with no rules and no sync entry', async () => {
  assert.match(await externalErrors(w => { w.externalClasses.push({ name: 'site-zz', collection: 'main' }); }), /external class main\/site-zz must match exactly one clipboard class, found 0/);
  assert.match(await externalErrors(w => { w.externalClasses[0].collection = 'design'; }), /external class design\/site-body must match exactly one clipboard class, found 0/);
  assert.match(await externalErrors(w => { w.syncPackage.classes.push({ ...w.syncPackage.classes[0], name: 'site-card' }); }), /external class site-card is also a managed class in syncPackage/);
  assert.match(await externalErrors(w => { w.clipboardData.copiedLayout.cmSelectorCollection.map['screen/.site-title:hover'] = { media: 'screen', selectorText: '.demo-card .site-title:hover', rules: {} }; }), /external class site-title has a rule in cmSelectorCollection: \.demo-card \.site-title:hover/);
  // A longer name that only starts with an external one is not a rule for it.
  const wrapper = externalPackage();
  wrapper.clipboardData.copiedLayout.mainSelectorCollection.map['screen/.site-title-x'] = { media: 'screen', selectorText: '.site-title-x', rules: {} };
  assert.equal((await inspectPackage({ packageText: JSON.stringify(wrapper) })).ok, true);
});

test('without the external-classes module the inspector refuses every file with a clear error', async () => {
  const vm = require('node:vm');
  // The inspector as a browser would load it: no require, no TaptopExternalClasses.
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lib/package-inspector.js'), 'utf8'), context);
  for (const text of [JSON.stringify(externalPackage()), packageText()]) {
    const result = await context.TaptopPackageInspector.inspectPackage({ packageText: text });
    assert.equal(result.ok, false);
    assert.equal(result.errors[0], 'IMPORT_MODULE_MISSING: external-classes');
  }
});

test('toolbar popup remains a fallback and never asks for a separate assets folder', () => {
  const popup = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.html'), 'utf8');
  const popupScript = fs.readFileSync(path.join(__dirname, '..', 'src', 'popup', 'popup.js'), 'utf8');
  assert.doesNotMatch(popup, /asset-folder|webkitdirectory/);
  assert.match(popup, /Где найти импорт/);
  assert.match(popupScript, /mount-editor-importer/);
  assert.match(popupScript, /sendMessage/);
});

test('automatic mount uses a single fixed launcher instead of a Layers anchor', () => {
  const mountScript = fs.readFileSync(path.join(__dirname, '..', 'src', 'editor', 'mount-importer.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'editor', 'import-ui.css'), 'utf8');
  assert.match(mountScript, /data-taptop-toolkit-importer/);
  assert.match(mountScript, /mounted: false/);
  assert.match(css, /--tt-launcher-bottom,\s*88px/);
  assert.match(css, /--tt-launcher-right,\s*24px/);
});
