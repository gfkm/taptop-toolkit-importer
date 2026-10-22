const assert = require('node:assert/strict');
const test = require('node:test');

const { conflictQuery, findConflicts, renameQuery, planRenames, applyClassRenames, stripClassRules } = require('../src/lib/class-conflicts.js');

const rule = value => ({ name: 'x', value, serializeValue: value });
function wrapper() {
  return {
    clipboardData: {
      copiedLayout: {
        tree: { root: 'r', tags: { r: { id: 'r', name: 'faq', classNameIds: ['c1', 'c2'] }, t: { id: 't', name: 'faq-title', classNameIds: ['c0', 'c3'] } } },
        mainClassNameCollection: { map: { c0: { id: 'c0', value: 'div' }, c1: { id: 'c1', value: 'faq' }, c2: { id: 'c2', value: 'is-open' }, c3: { id: 'c3', value: 'faq-title' } }, countMap: { div: 1, faq: 1, 'is-open': 1, 'faq-title': 1 }, head: { id: 'c1', value: 'faq' } },
        designClassNameCollection: { map: {} },
        mainSelectorCollection: { map: {
          'screen/.faq': { media: 'screen', selectorText: '.faq', rules: { 'padding-top': rule('160px') } },
          '(max-width: 767px)/.faq': { media: '(max-width: 767px)', selectorText: '.faq', rules: { 'padding-top': rule('96px') } },
          'screen/.faq-title': { media: 'screen', selectorText: '.faq-title', rules: { color: rule('#0a0a0a') } }
        } },
        cmSelectorCollection: { map: { 'screen/.faq:hover': { media: 'screen', selectorText: '.faq:hover', rules: { color: rule('#0033ff') } } } },
        designSelectorCollection: { map: {} }, animationSelectorCollection: { map: {} }
      }
    },
    behaviorPackages: [{
      key: 'accordion/faq', adapter: 'taptop/embed-accordion-v1',
      clipboardData: { copiedLayout: { tree: { root: 'e', tags: { e: { id: 'e', widgetName: 'tt_embed', embedCode: '<style>.faq .is-open .faq-title { color: red; } .faq-title-x { }</style><script>const config = {"rootSelector":".faq","openClass":"is-open"};</script>' } } } } }
    }]
  };
}

test('asks the editor about every package class except Taptop base classes', () => {
  const query = conflictQuery(wrapper().clipboardData);
  assert.deepEqual(query.names, ['faq', 'is-open', 'faq-title']);
  assert.ok(query.selectorKeys.includes('screen/.faq'));
  assert.ok(query.selectorKeys.includes('(max-width: 767px)/.faq'));
  assert.ok(query.selectorKeys.includes('screen/.is-open'));
});

test('a same-name class with other styles is a conflict; identical or absent ones are not', () => {
  const result = findConflicts(wrapper().clipboardData, {
    available: true,
    existing: ['faq', 'is-open', 'faq-title'],
    selectors: {
      'screen/.faq': { 'max-width': '720px' },
      'screen/.is-open': { display: 'block' },
      'screen/.faq-title': { color: '#0a0a0a' }
    }
  });
  assert.deepEqual(result.conflicts, ['faq', 'is-open']);
  assert.deepEqual(result.reused, ['faq-title']);
  assert.deepEqual(result.added, []);
});

test('nothing is renamed when the project classes are unknown', () => {
  const result = findConflicts(wrapper().clipboardData, { available: false });
  assert.equal(result.available, false);
  assert.deepEqual(result.conflicts, []);
});

test('picks the first free numbered copy name', () => {
  assert.deepEqual(renameQuery(['faq']).names.slice(0, 3), ['faq-2', 'faq-3', 'faq-4']);
  const renames = planRenames(['faq', 'is-open'], { existing: ['faq-2'] }, ['faq', 'is-open', 'faq-title']);
  assert.deepEqual([...renames], [['faq', 'faq-3'], ['is-open', 'is-open-2']]);
});

test('renames classes everywhere: collections, selectors, states and embed code', () => {
  const source = wrapper();
  const renamed = applyClassRenames(source, new Map([['faq', 'faq-2'], ['is-open', 'is-open-2']]));
  const layout = renamed.clipboardData.copiedLayout;
  assert.equal(layout.mainClassNameCollection.map.c1.value, 'faq-2');
  assert.equal(layout.mainClassNameCollection.map.c3.value, 'faq-title');
  assert.equal(layout.mainClassNameCollection.head.value, 'faq-2');
  assert.deepEqual(Object.keys(layout.mainClassNameCollection.countMap).sort(), ['div', 'faq-2', 'faq-title', 'is-open-2']);
  assert.deepEqual(Object.keys(layout.mainSelectorCollection.map).sort(), ['(max-width: 767px)/.faq-2', 'screen/.faq-2', 'screen/.faq-title']);
  assert.equal(layout.mainSelectorCollection.map['screen/.faq-2'].selectorText, '.faq-2');
  assert.equal(layout.cmSelectorCollection.map['screen/.faq-2:hover'].selectorText, '.faq-2:hover');
  assert.equal(layout.tree.tags.r.name, 'faq-2');
  const code = renamed.behaviorPackages[0].clipboardData.copiedLayout.tree.tags.e.embedCode;
  assert.equal(code, '<style>.faq-2 .is-open-2 .faq-title { color: red; } .faq-title-x { }</style><script>const config = {"rootSelector":".faq-2","openClass":"is-open-2"};</script>');
  assert.equal(source.clipboardData.copiedLayout.mainClassNameCollection.map.c1.value, 'faq', 'input stays unchanged');
});

// A package that uses a target-site class by name: `site-title` is on a layer
// but carries no rules (Toolkit `externalClasses`, see external-classes.test.js).
function externalWrapper() {
  const source = wrapper();
  const layout = source.clipboardData.copiedLayout;
  layout.mainClassNameCollection.map.c4 = { id: 'c4', value: 'site-title' };
  layout.mainClassNameCollection.countMap['site-title'] = 1;
  layout.tree.tags.t.classNameIds.push('c4');
  return source;
}

test('external classes are left out of the conflict query and the conflicts', () => {
  const source = externalWrapper();
  const external = ['site-title'];
  assert.deepEqual(conflictQuery(source.clipboardData, external).names, ['faq', 'is-open', 'faq-title']);
  const result = findConflicts(source.clipboardData, { available: true, existing: ['site-title'], selectors: { 'screen/.site-title': { color: '#ff0000' } } }, external);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.total, 3);
});

test('a class kept as the existing project class loses only the rules that belong to it alone', () => {
  const source = wrapper();
  source.clipboardData.copiedLayout.mainSelectorCollection.map['screen/.faq .faq-title'] = { media: 'screen', selectorText: '.faq .faq-title', rules: { color: rule('#111111') } };
  source.clipboardData.copiedLayout.animationSelectorCollection.map['screen/.faq'] = { media: 'screen', selectorText: '.faq', rules: { opacity: rule('0') } };
  source.clipboardData.copiedLayout.designSelectorCollection.map['screen/.faq'] = { media: 'screen', selectorText: '.faq', rules: { 'background-image': rule('none') } };
  const stripped = stripClassRules(source, ['faq']);
  const layout = stripped.clipboardData.copiedLayout;
  assert.deepEqual(Object.keys(layout.mainSelectorCollection.map).sort(), ['screen/.faq .faq-title', 'screen/.faq-title']);
  // The project's class wins entirely: its hover (cm), design and animation entries go too.
  for (const key of ['cmSelectorCollection', 'designSelectorCollection', 'animationSelectorCollection']) assert.deepEqual(Object.keys(layout[key].map), [], key);
  assert.equal(layout.mainClassNameCollection.map.c1.value, 'faq', 'the layer keeps the class name');
  assert.ok(source.clipboardData.copiedLayout.mainSelectorCollection.map['screen/.faq'], 'input stays unchanged');
});

test('treats hex and rgb() spellings of the same color as equal', () => {
  const result = findConflicts(wrapper().clipboardData, { available: true, existing: ['faq-title'], selectors: { 'screen/.faq-title': { color: 'rgb(10, 10, 10)' } } });
  assert.deepEqual(result.reused, ['faq-title']);
});
