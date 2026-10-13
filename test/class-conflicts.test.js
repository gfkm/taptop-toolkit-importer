const assert = require('node:assert/strict');
const test = require('node:test');

const { conflictQuery, findConflicts, renameQuery, planRenames, applyClassRenames } = require('../src/lib/class-conflicts.js');

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

test('treats hex and rgb() spellings of the same color as equal', () => {
  const result = findConflicts(wrapper().clipboardData, { available: true, existing: ['faq-title'], selectors: { 'screen/.faq-title': { color: 'rgb(10, 10, 10)' } } });
  assert.deepEqual(result.reused, ['faq-title']);
});
