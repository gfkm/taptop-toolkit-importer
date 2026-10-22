const assert = require('node:assert/strict');
const test = require('node:test');

const external = require('../src/lib/external-classes.js');

const LIST = [{ name: 'site-title', collection: 'main' }, { name: 'site-x', collection: 'design' }];

test('a well-formed declaration is valid; an absent one means no site classes', () => {
  assert.deepEqual(external.declaration({ externalClasses: LIST }), { valid: true, list: LIST, errors: [] });
  assert.deepEqual(external.declaration({}), { valid: true, list: [], errors: [] });
  assert.deepEqual(external.declaration({ externalClasses: [] }), { valid: true, list: [], errors: [] });
});

test('any malformed declaration is invalid, never read as "no site classes"', () => {
  const cases = [
    [{ name: 'site-title', collection: 'main' }, /must be an array/],
    ['site-title', /must be an array/],
    [null, /must be an array/],
    [[{ collection: 'main' }], /externalClasses\[0\] must be/],
    [[null], /externalClasses\[0\] must be/],
    [[{ name: 'site-title', collection: 'cm' }], /externalClasses\[0\] must be \{ name: <class name>, collection: "main" \| "design" \}/],
    [[{ name: '.site-title', collection: 'main' }], /externalClasses\[0\] must be/],
    [[{ name: 'site-title', collection: 'main', extra: 1 }], /externalClasses\[0\] must be/],
    [[...LIST].reverse(), /sorted by name without duplicates/],
    [[LIST[0], LIST[0]], /sorted by name without duplicates/]
  ];
  for (const [value, message] of cases) {
    const result = external.declaration({ externalClasses: value });
    assert.equal(result.valid, false, JSON.stringify(value));
    assert.deepEqual(result.list, []);
    assert.match(result.errors.join('\n'), message, JSON.stringify(value));
  }
});

test('asks the editor for every external class with its collection and lists the missing ones', () => {
  assert.deepEqual(external.query(LIST), { names: [], selectorKeys: [], external: LIST });
  assert.deepEqual(external.missing(LIST, { available: true, externalPresent: ['site-title'] }), { available: true, missing: ['site-x'] });
  assert.deepEqual(external.missing(LIST, { available: true, externalPresent: ['site-title', 'site-x'] }), { available: true, missing: [] });
  // An editor that cannot answer, or an adapter without the external reader, fails closed.
  assert.deepEqual(external.missing(LIST, { available: false }), { available: false, missing: ['site-title', 'site-x'] });
  assert.deepEqual(external.missing(LIST, { available: true, existing: [] }), { available: false, missing: ['site-title', 'site-x'] });
  assert.deepEqual(external.missing([], { available: false }), { available: true, missing: [] });
});

// A text check: it catches a copy of the rules that reuses the same field
// access or error strings, not one written differently.
test('no consumer re-implements the externalClasses rules with the same strings', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  for (const file of ['lib/class-conflicts.js', 'lib/package-inspector.js', 'lib/import-planner.js', 'lib/import-session.js', 'editor/mount-importer.js']) {
    assert.doesNotMatch(read(file), /must be sorted by name|collection: "main" \| "design"|\.externalClasses\b/, `${file} re-implements the externalClasses rules`);
  }
  // Loaded before every consumer in the extension world.
  const background = read('background.js');
  const isolated = /files: \[('lib\/package-inspector\.js'[^\]]*|'lib\/external-classes\.js'[^\]]*)\]/.exec(background)?.[1] || '';
  assert.match(isolated, /^'lib\/external-classes\.js'/);
});
