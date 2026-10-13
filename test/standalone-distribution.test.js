const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.resolve(__dirname, '..');

test('the importer declares its own version, tests and package command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'));
  assert.equal(pkg.name, 'taptop-toolkit-importer');
  assert.equal(pkg.version, manifest.version);
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.scripts.package, 'node scripts/package-extension.js');
  assert.deepEqual(pkg.dependencies || {}, {});
  assert.ok(fs.existsSync(path.join(root, 'scripts/package-extension.js')));
});

test('runtime files resolve inside importer source without a sibling Toolkit checkout', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/manifest.json'), 'utf8'));
  const files = [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(entry => entry.js), ...manifest.web_accessible_resources.flatMap(entry => entry.resources)];
  for (const file of files) assert.ok(fs.existsSync(path.join(root, 'src', file)), `missing ${file}`);
  assert.equal(fs.existsSync(path.join(root, 'src/test')), false);
});
