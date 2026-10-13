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
