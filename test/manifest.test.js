const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const manifestPath = path.join(__dirname, '..', 'src', 'manifest.json');

test('automatically mounts only in the narrow Taptop editor URL', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, 'popup/popup.html');
  assert.deepEqual(manifest.host_permissions, ['https://*.taptop.site/-/cms/v1/mosaic/*']);
  assert.deepEqual(manifest.content_scripts, [{
    matches: ['https://*.taptop.site/-/cms/v1/mosaic/*'],
    js: ['editor/auto-mount.js'],
    run_at: 'document_idle'
  }]);
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting']);
  assert.equal(manifest.background?.service_worker, 'background.js');
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'src', manifest.background.service_worker)), true);
  assert.equal(fs.existsSync(path.join(__dirname, '../src/editor/auto-mount.js')), true);
});

test('exposes only the font and dialog sheet to Taptop editor pages', () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ['fonts/InterVariable.woff2', 'editor/import-ui.css'],
    matches: ['https://*.taptop.site/*'],
    use_dynamic_url: true
  }]);
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
