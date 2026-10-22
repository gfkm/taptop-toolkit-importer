const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const manifestPath = path.join(__dirname, '..', 'src', 'manifest.json');
// The Taptop editor runs on *.taptop.site. A project's own domain is never listed here: the person grants it at
// runtime from the popup (optional_host_permissions) and the background registers the content script for it.
const EDITOR_URLS = ['https://*.taptop.site/-/cms/v1/mosaic/*'];

test('automatically mounts only in the narrow Taptop editor URL', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
  assert.deepEqual(manifest.host_permissions, EDITOR_URLS);
  assert.deepEqual(manifest.content_scripts, [{
    matches: EDITOR_URLS,
    js: ['editor/auto-mount.js'],
    run_at: 'document_idle'
  }]);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  // Nothing beyond Taptop is granted at install; one https origin at a time is requested at the person's click.
  assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
  assert.equal(manifest.background?.service_worker, 'background.js');
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', manifest.background.service_worker)), true);
  assert.equal(fs.existsSync(path.join(__dirname, '../src/editor/auto-mount.js')), true);
});

test('exposes only the font and dialog sheet, on https pages, through the per-session dynamic URL', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  // The matches cannot follow a runtime grant, so they cover every https origin the person may allow.
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ['fonts/InterVariable.woff2', 'editor/import-ui.css'],
    matches: ['https://*/*'],
    use_dynamic_url: true
  }]);
});

test('the manifest names no project domain', () => {
  const manifest = fs.readFileSync(manifestPath, 'utf8');
  const hosts = [...manifest.matchAll(/https:\/\/([^/"]+)\//g)].map(match => match[1]);
  assert.deepEqual([...new Set(hosts)].sort(), ['*', '*.taptop.site']);
});

test('manifest points to real PNG icons at every toolbar size', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const size of [16, 32, 48, 128]) {
    const iconPath = manifest.icons[String(size)];
    assert.equal(manifest.action.default_icon[String(size)], iconPath);
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'src', iconPath));
    assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(bytes.readUInt32BE(16), size);
    assert.equal(bytes.readUInt32BE(20), size);
  }
});

test('routes behavior embeds through the editor bridge', () => {
  const background = fs.readFileSync(path.join(__dirname, '..', 'src', 'background.js'), 'utf8');
  const mount = fs.readFileSync(path.join(__dirname, '../src/editor/mount-importer.js'), 'utf8');

  assert.match(background, /action === 'insert-behavior'/);
  assert.match(background, /adapter\.insertBehavior/);
  assert.match(background, /action === 'confirm-behavior'/);
  assert.match(background, /adapter\.confirm\(/);
  assert.match(mount, /insertBehaviorLayer\(clipboardData\)/);
  assert.match(mount, /requestRuntime\('insert-behavior'/);
  assert.match(mount, /confirmBehaviorInserted\(rootTagId\)/);
  assert.match(mount, /requestRuntime\('confirm-behavior'/);
});
