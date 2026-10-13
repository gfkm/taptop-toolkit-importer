const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { spawnSync } = require('node:child_process');
const { packageExtension } = require('../scripts/package-extension');

test('the ZIP has manifest.json at its root and only runtime files, without OS metadata', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'importer-zip-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.copyFileSync(path.join(__dirname, '../package.json'), path.join(root, 'package.json'));
  fs.cpSync(path.join(__dirname, '../src'), path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/editor/.DS_Store'), 'finder metadata');
  fs.writeFileSync(path.join(root, 'src/.DS_Store'), 'finder metadata');
  const output = packageExtension({ root });
  const listing = spawnSync('unzip', ['-Z1', output], { encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  const entries = listing.stdout.split('\n').filter(line => line && !line.endsWith('/'));
  assert.ok(entries.includes('manifest.json'));
  assert.deepEqual(entries.filter(entry => /(^|\/)\.DS_Store$|^(test|fixtures|docs|scripts|contracts)\//.test(entry)), []);
  const expected = [];
  const walk = (dir, prefix) => { for (const name of fs.readdirSync(dir)) { const full = path.join(dir, name); if (fs.statSync(full).isDirectory()) walk(full, `${prefix}${name}/`); else if (name !== '.DS_Store') expected.push(`${prefix}${name}`); } };
  walk(path.join(root, 'src'), '');
  assert.deepEqual(entries.sort(), expected.sort());
  assert.throws(() => packageExtension({ root }), /OUTPUT_EXISTS/);
});
