const assert = require('node:assert/strict');
const test = require('node:test');

const { rootIdFor, pastedRootId, confirm, projectClasses, findScriptsLayer, appendMarkerFor, ensureScriptsLayer, pasteClipboardAt, observeClasses, applyClassPlans, respelledClassNames } = require('../src/editor/taptop-runtime-adapter.js');

test('uses the editor root as the only automatic paste target', () => {
  assert.equal(rootIdFor({ tree: { root: 'page-root' } }), 'page-root');
  assert.throws(() => rootIdFor({ tree: {} }), /root layer/);
});

test('uses the same full append marker for Root that behavior scripts use for Scripts', () => {
  const root = { id: 'page-root', type: 'root', children: ['existing-content'] };
  assert.deepEqual(appendMarkerFor(root), {
    id: 'page-root', composedId: 'page-root', targetType: 'root', direction: 'top',
    childType: '', rangeLeft: 0, rangeTop: 0, rangeRight: 0, rangeBottom: 0,
    markerPositions: {}, fillType: 'half', afterChild: 'existing-content', deepAfterChild: 'existing-content'
  });
});

test('uses original Taptop identities in a marker and tells the editor to redraw after paste', () => {
  const root = { id: 'composed-root', type: 'root', children: ['composed-child'] };
  const original = { id: 'original-root', type: 'root', children: ['original-child'] };
  const calls = [];
  const editor = {
    layout: { tree: { get(id) { return id === 'original-root' ? original : null; } } },
    events: {
      getOriginalID(id) { return ({ 'composed-root': 'original-root', 'composed-child': 'original-child' })[id] || id; },
      ON_HTML_UPDATE: 'html', ON_CHANGE_TAG_DISPLAY: 'display',
      emit(event) { calls.push(`event:${event}`); }
    },
    layers: { setMap() { calls.push('layers'); } },
    clipboardStore: { updateState() {}, setClipboard() {} },
    clipboard: { pasteFromClipboard(marker) { calls.push(marker); return { id: 'inserted' }; } }
  };
  const priorStorage = globalThis.localStorage;
  globalThis.localStorage = { setItem() {} };
  try {
    assert.equal(pasteClipboardAt(editor, { tagID: 'source-root' }, root), 'inserted');
  } finally {
    globalThis.localStorage = priorStorage;
  }
  assert.deepEqual(calls, [
    { id: 'original-root', composedId: 'original-root', targetType: 'root', direction: 'top', childType: '', rangeLeft: 0, rangeTop: 0, rangeRight: 0, rangeBottom: 0, markerPositions: {}, fillType: 'half', afterChild: 'original-child', deepAfterChild: 'original-child' },
    'layers', 'event:html', 'event:display'
  ]);
});

test('accepts only an explicit root identifier returned by native paste', () => {
  assert.equal(pastedRootId('new-layer'), 'new-layer');
  assert.equal(pastedRootId({ id: 'new-layer' }), 'new-layer');
  assert.equal(pastedRootId({}), null);
  assert.equal(pastedRootId(null), null);
});

test('synchronizes the native clipboard twice and pastes through a complete marker', () => {
  const priorStorage = globalThis.localStorage;
  const order = [];
  globalThis.localStorage = { setItem(key, value) { order.push(`storage:${key}:${JSON.parse(value).tagID}`); } };
  try {
    const editor = {
      clipboardStore: { updateState() { order.push('update'); }, setClipboard(data) { order.push(`store:${data.tagID}`); } },
      clipboard: { pasteFromClipboard(marker, tagID) { order.push({ marker, tagID }); return { id: 'inserted' }; } }
    };
    assert.equal(pasteClipboardAt(editor, { tagID: 'source-root' }, { id: 'page-root', type: 'root', children: ['prior'] }), 'inserted');
    assert.deepEqual(order, [
      'storage:clipboardData:source-root', 'update', 'store:source-root', 'storage:clipboardData:source-root', 'update',
      { marker: { id: 'page-root', composedId: 'page-root', targetType: 'root', direction: 'top', childType: '', rangeLeft: 0, rangeTop: 0, rangeRight: 0, rangeBottom: 0, markerPositions: {}, fillType: 'half', afterChild: 'prior', deepAfterChild: 'prior' }, tagID: 'source-root' }
    ]);
  } finally {
    globalThis.localStorage = priorStorage;
  }
});

test('treats the explicit native paste result as confirmation while the layer cache refreshes', () => {
  assert.equal(confirm('inserted-root'), true);
  assert.equal(confirm(''), false);
  assert.equal(confirm(null), false);
});

test('reads only the requested project classes and selector rules', () => {
  const layout = {
    mainClassNameCollection: { map: { c1: { id: 'c1', value: 'card' }, c2: { id: 'c2', value: 'other' } } },
    mainSelectorCollection: { map: {
      'screen/.card': { rules: { padding: { serializeValue: '24px' }, gap: { value: '8px' } } },
      'screen/.other': { rules: { margin: { serializeValue: '0' } } }
    } }
  };
  assert.deepEqual(projectClasses(layout, { names: ['card', 'missing'], selectorKeys: ['screen/.card', 'screen/.missing'] }), {
    available: true,
    existing: ['card'],
    selectors: { 'screen/.card': { padding: '24px', gap: '8px' } }
  });
});

test('reports project classes as unavailable when the editor store has no class collection', () => {
  assert.deepEqual(projectClasses({ tree: {} }, { names: ['card'], selectorKeys: [] }), { available: false });
  assert.deepEqual(projectClasses(null, {}), { available: false });
});

test('finds a named Scripts layer and builds an append marker for it', () => {
  const scripts = { id: 'scripts-id', name: 'Scripts', type: 'div', children: ['first-embed'] };
  const layout = { tree: { root: 'page-root', tags: { 'page-root': { id: 'page-root', children: ['scripts-id'] }, 'scripts-id': scripts } } };
  assert.equal(findScriptsLayer(layout), scripts);
  assert.deepEqual(appendMarkerFor(scripts), {
    id: 'scripts-id', composedId: 'scripts-id', targetType: 'div', direction: 'top',
    childType: '', rangeLeft: 0, rangeTop: 0, rangeRight: 0, rangeBottom: 0,
    markerPositions: {}, fillType: 'half', afterChild: 'first-embed', deepAfterChild: 'first-embed'
  });
});

test('does not treat an arbitrary layer as Scripts', () => {
  const layout = { tree: { root: 'page-root', tags: { 'page-root': { id: 'page-root', name: 'Root' } } } };
  assert.equal(findScriptsLayer(layout), null);
});

test('creates and names a Scripts layer at the start of Root only through the editor layout API', () => {
  const root = { id: 'page-root', children: ['existing-content'] };
  const created = { id: 'scripts-id', children: [], setName(name) { this.name = name; } };
  let options;
  const editor = {
    layout: {
      tree: { root: 'page-root', tags: { 'page-root': root, 'scripts-id': created } },
      add(value) { options = value; return { id: 'scripts-id' }; }
    },
    widgets: { get: key => key === 'div' ? { code: 'div' } : null },
    constants: { gz: { DIV: 'div' } }
  };
  assert.equal(ensureScriptsLayer(editor), created);
  assert.deepEqual(options, { layout: { code: 'div' }, parentId: 'page-root', beforeChildId: 'existing-content' });
  assert.equal(created.name, 'Scripts');
});

function observableTree({ root, composedRoot, tags }) {
  // Mirrors the live editor: composed ids carry a `_0` suffix, tags live in a
  // MobX observable map that is not a plain object, and only `get` is reliable.
  const store = new Map(Object.entries(tags));
  return {
    root, composed: { root: composedRoot, get: id => store.get(id.replace(/_0$/, '')) && { ...store.get(id.replace(/_0$/, '')), id } },
    tags: { enhancer_: {}, data_: store },
    get: id => store.get(id),
    has: id => store.has(id)
  };
}

test('creates Scripts under the original Root id when the editor reports a composed root', () => {
  const created = { id: 'scripts-id', children: [], setName(name) { this.name = name; } };
  const tree = observableTree({ root: 'page-root', composedRoot: 'page-root_0', tags: { 'page-root': { id: 'page-root', type: 'root', children: ['badge'] }, badge: { id: 'badge', type: 'tt_badge' }, 'scripts-id': created } });
  let options;
  const editor = {
    layout: { tree, add(value) { options = value; return { id: 'scripts-id' }; } },
    events: { getOriginalID: id => id.replace(/_0$/, '') },
    widgets: { get: key => key === 'div' ? { code: 'div' } : null },
    constants: { gz: { DIV: 'div' } }
  };
  assert.equal(ensureScriptsLayer(editor), created);
  assert.deepEqual(options, { layout: { code: 'div' }, parentId: 'page-root', beforeChildId: 'badge' });
});

test('finds an existing Scripts layer among Root children in an observable tag store', () => {
  const scripts = { id: 'scripts-id', type: 'div', name: 'Scripts', children: ['embed'] };
  const tree = observableTree({ root: 'page-root', composedRoot: 'page-root_0', tags: { 'page-root': { id: 'page-root', type: 'root', children: ['scripts-id', 'content'] }, content: { id: 'content', name: 'faq' }, 'scripts-id': scripts } });
  const editor = { layout: { tree, add() { throw new Error('must not create a second Scripts layer'); } }, events: { getOriginalID: id => id.replace(/_0$/, '') } };
  assert.equal(findScriptsLayer(editor.layout, editor), scripts);
  assert.equal(ensureScriptsLayer(editor), scripts);
});

test('reads project classes from MobX-style observable collections and number/unit rules', () => {
  const observable = entries => {
    const map = new Map(entries);
    return { get: key => map.get(key), has: key => map.has(key), values: () => map.values(), keys: () => map.keys(), toJSON: () => [...map] };
  };
  const layout = {
    mainClassNameCollection: { map: observable([['c1', { id: 'c1', value: 'faq' }], ['c2', { id: 'c2', value: 'other' }]]) },
    mainSelectorCollection: { map: observable([
      ['screen/.faq', { rules: observable([['max-width', { number: 720, unit: 'px' }], ['background-color', { value: 'rgb(245, 245, 242)' }], ['margin-left', { number: 0, unit: 'auto' }]]) }]
    ]) }
  };
  assert.deepEqual(projectClasses(layout, { names: ['faq', 'missing'], selectorKeys: ['screen/.faq'] }), {
    available: true,
    existing: ['faq'],
    selectors: { 'screen/.faq': { 'max-width': '720px', 'background-color': 'rgb(245, 245, 242)', 'margin-left': 'auto' } }
  });
});

function editorWithClasses() {
  globalThis.TaptopClassSync = require('../src/lib/class-sync.js');
  const classes = new Map([['class_faq', { id: 'class_faq', value: 'faq' }]]);
  const selectors = new Map();
  const history = [];
  const selectorFor = (media, text) => {
    const key = `${media}/${text}`;
    if (!selectors.has(key)) {
      const css = new Map();
      selectors.set(key, {
        css,
        getCSS: prop => css.get(prop),
        setCSS: (prop, value, isCustom) => {
          const text = value.serializeValue ?? value.value;
          const match = /^(-?[\d.]+)(px)$/.exec(text);
          css.set(prop, match ? { number: Number(match[1]), unit: 'px', isCustom } : { value: text, isCustom });
        },
        hasCSS: prop => css.has(prop),
        removeCSS: prop => css.delete(prop)
      });
    }
    return selectors.get(key);
  };
  const collection = {
    getSelector: (media, text) => selectorFor(media, text),
    findSelector: (text, media) => selectors.get(`${media}/${text}`) || null
  };
  selectorFor('screen', '.faq').css.set('padding-top', { number: 160, unit: 'px' });
  const layout = {
    mainClassNameCollection: {
      get: id => classes.get(id),
      findByName: name => [...classes.values()].find(item => item.value === name) || null,
      generateByName: name => ({ id: `class_new_${name}`, value: name }),
      add: item => classes.set(item.id, item)
    },
    mainSelectorCollection: collection, cmSelectorCollection: collection
  };
  return { editor: { layout, history: { add: label => history.push(label) } }, classes, selectors, history };
}

test('observes the current rules of package classes by name or bound id', () => {
  const { editor } = editorWithClasses();
  const packageClass = { stableKey: 's/faq', name: 'faq', collection: 'main', ownedRules: { main: { 'screen/.faq': { 'padding-top': { value: '120px', serializeValue: '120px' } } } } };
  const observed = observeClasses(editor, { classes: [packageClass, { ...packageClass, stableKey: 's/new', name: 'new', ownedRules: {} }], bindings: [] });
  assert.deepEqual(observed['s/faq'], { id: 'class_faq', name: 'faq', collection: 'main', rules: { main: { 'screen/.faq': { 'padding-top': { number: 160, unit: 'px' } } } } });
  assert.equal(observed['s/new'], null);
});

test('applies class plans with setCSS, verifies the readback and records one history step', () => {
  const { editor, classes, selectors, history } = editorWithClasses();
  const path = (prop, text = '.faq') => JSON.stringify(['main', 'screen', text, prop]);
  const result = applyClassPlans(editor, { plans: [
    { stableKey: 's/faq', name: 'faq', collection: 'main', classAction: { type: 'reuse', targetClassId: 'class_faq' }, propertyPlan: { operations: [{ type: 'set', path: path('padding-top'), value: { value: '120px', serializeValue: '120px', isCustom: false } }], conflicts: [] } },
    { stableKey: 's/card', name: 'card', collection: 'main', classAction: { type: 'create', name: 'card', collection: 'main' }, propertyPlan: { operations: [{ type: 'set', path: path('color', '.card'), value: { value: '#111111', serializeValue: '#111111' } }], conflicts: [] } }
  ] });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.applied.map(item => [item.stableKey, item.targetClassId, item.appliedOperations]), [['s/faq', 'class_faq', 1], ['s/card', 'class_new_card', 1]]);
  assert.deepEqual(selectors.get('screen/.faq').css.get('padding-top'), { number: 120, unit: 'px', isCustom: false });
  assert.equal(classes.get('class_new_card').value, 'card');
  assert.equal(history.length, 1);
});

test('accepts a value Taptop keeps in its own spelling and returns that spelling', () => {
  const { editor, selectors } = editorWithClasses();
  const selector = selectors.get('screen/.faq');
  selector.setCSS = prop => selector.css.set(prop, { items: [{ kind: 'fill', src: 'rgba(0,0,0,0) 0%, rgba(0,0,0,0) 100%' }] });
  const path = JSON.stringify(['main', 'screen', '.faq', 'background-image']);
  const result = applyClassPlans(editor, { plans: [{ stableKey: 's/faq', name: 'faq', collection: 'main', classAction: { type: 'reuse', targetClassId: 'class_faq' }, propertyPlan: { operations: [{ type: 'set', path, value: { value: 'linear-gradient(rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0) 100%)' } }], conflicts: [] } }] });
  assert.deepEqual(result.failures, []);
  assert.equal(result.applied[0].stored[path], 'linear-gradient(rgba(0,0,0,0) 0%, rgba(0,0,0,0) 100%)');
  assert.equal(result.applied[0].respelled.length, 1);
});

test('fails a class whose value Taptop did not keep, naming the property', () => {
  const { editor, selectors } = editorWithClasses();
  selectors.get('screen/.faq').setCSS = () => {};
  const result = applyClassPlans(editor, { plans: [{ stableKey: 's/faq', name: 'faq', collection: 'main', classAction: { type: 'reuse', targetClassId: 'class_faq' }, propertyPlan: { operations: [{ type: 'set', path: JSON.stringify(['main', 'screen', '.faq', 'color']), value: { value: '#111111' } }], conflicts: [] } }] });
  assert.equal(result.failures.length, 1);
  assert.match(result.failures[0].message, /main screen \.faq color: Taptop did not keep the value/);
});

// Taptop reads a trailing -<number> as its duplicate counter (live, 2026-10-12):
// a new "col-1" whose base has no counter is generated as "col".
const counterLike = name => name.replace(/-(0\d*|1)$/, '');

test('reports new class names Taptop would store under another name, without adding them', () => {
  const { editor, classes } = editorWithClasses();
  editor.layout.mainClassNameCollection.generateByName = name => ({ id: `class_new_${name}`, value: counterLike(name) });
  const before = classes.size;
  const result = respelledClassNames(editor, { classes: [{ name: 'col-1', collection: 'main' }, { name: 'faq', collection: 'main' }, { name: 'card-12', collection: 'main' }, { name: 'gap_1', collection: 'main' }] });
  assert.deepEqual(result, [{ name: 'col-1', stored: 'col' }]);
  assert.equal(classes.size, before);
});

test('a class Taptop would create under another name fails with both names', () => {
  const { editor } = editorWithClasses();
  editor.layout.mainClassNameCollection.generateByName = name => ({ id: `class_new_${name}`, value: counterLike(name) });
  const result = applyClassPlans(editor, { plans: [{ stableKey: 's/col', name: 'col-1', collection: 'main', classAction: { type: 'create', name: 'col-1', collection: 'main' }, propertyPlan: { operations: [], conflicts: [] } }] });
  assert.equal(result.failures[0].message, 'Taptop would store class col-1 as col');
});

test('a native write Taptop stores as 0px fails the class instead of passing as applied', () => {
  const { editor, selectors } = editorWithClasses();
  const selector = selectors.get('screen/.faq');
  selector.setCSS = (prop, value) => selector.css.set(prop, { value: value.value, number: 0, unit: 'px', isCustom: false });
  const result = applyClassPlans(editor, { plans: [{ stableKey: 's/faq', name: 'faq', collection: 'main', classAction: { type: 'reuse', targetClassId: 'class_faq' }, propertyPlan: { operations: [{ type: 'set', path: JSON.stringify(['main', 'screen', '.faq', 'width']), value: { value: 'fit-content', isCustom: false } }], conflicts: [] } }] });
  assert.match(result.failures[0].message, /main screen \.faq width: Taptop stored 0px for fit-content/);
});
