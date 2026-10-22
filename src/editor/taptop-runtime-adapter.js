(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaptopRuntimeAdapter = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const CLIPBOARD_STORAGE_KEY = 'clipboardData';

  function objectCandidates(value) {
    const candidates = [];
    const seen = new Set();
    const add = candidate => {
      if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function') || seen.has(candidate)) return;
      seen.add(candidate);
      candidates.push(candidate);
    };
    add(value);
    try { Object.values(value || {}).forEach(add); } catch {}
    return candidates;
  }

  function captureRuntimeRequire(scope = globalThis) {
    const chunks = [scope.rspackChunktaptop_design_editor];
    try {
      for (const [name, value] of Object.entries(scope)) {
        if (/(?:rspack|webpack)Chunk/i.test(name) && value && !chunks.includes(value)) chunks.push(value);
      }
    } catch {}
    for (const chunk of chunks) {
      if (!chunk || typeof chunk.push !== 'function') continue;
      let runtimeRequire = null;
      try {
        chunk.push([[`taptop-toolkit-${Date.now()}-${Math.random().toString(36).slice(2)}`], {}, require => { runtimeRequire = require; }]);
      } catch {}
      if (runtimeRequire) return runtimeRequire;
    }
    return null;
  }

  function findExport(require, moduleIds, predicate) {
    if (typeof require !== 'function') return null;
    for (const id of moduleIds) {
      try {
        for (const candidate of objectCandidates(require(id))) if (predicate(candidate)) return candidate;
      } catch {}
    }
    try {
      for (const cached of Object.values(require.c || {})) {
        for (const candidate of objectCandidates(cached?.exports)) if (predicate(candidate)) return candidate;
      }
    } catch {}
    return null;
  }

  function resolveEditor(scope = globalThis) {
    const require = captureRuntimeRequire(scope);
    let resolved = null;
    try { resolved = scope.__ttEnhancerResolveRuntimeApi?.(require) || null; } catch {}
    const clipboard = resolved?.clipboard || findExport(require, [6269, 13339], value => typeof value?.pasteFromClipboard === 'function');
    const clipboardStore = resolved?.clipboardStore || findExport(require, [34369], value => typeof value?.updateState === 'function');
    const layout = resolved?.layout || findExport(require, [36945], value => value?.tree && typeof value.tree === 'object');
    const widgets = resolved?.widgets || findExport(require, [71842], value => typeof value?.get === 'function');
    const events = resolved?.events || findExport(require, [91893], value => typeof value?.getOriginalID === 'function');
    const layers = resolved?.layers || findExport(require, [39510], value => typeof value?.setMap === 'function');
    let constants = resolved?.constants || null;
    if (!constants) try { constants = require(89224); } catch {}
    let history = resolved?.history || null;
    if (!history) try { history = require(16271)?.A || null; } catch {}
    const missing = [
      !clipboard && 'clipboard',
      !clipboardStore && 'clipboard state',
      !layout && 'layout'
    ].filter(Boolean);
    return { ok: missing.length === 0, missing, clipboard, clipboardStore, layout, widgets, constants, events, layers, history };
  }

  function rootIdFor(layout) {
    const rootId = layout?.tree?.composed?.root || layout?.tree?.root;
    if (typeof rootId !== 'string' || !rootId) throw new Error('Taptop root layer was not found');
    return rootId;
  }

  function pastedRootId(value) {
    if (typeof value === 'string' && value) return value;
    if (typeof value?.id === 'string' && value.id) return value.id;
    return null;
  }

  function objectValues(value) {
    if (!value || typeof value !== 'object') return [];
    if (value instanceof Map) return [...value.values()];
    if (value.tags && typeof value.tags === 'object') return objectValues(value.tags);
    if (value.map && typeof value.map === 'object') return objectValues(value.map);
    return Object.values(value);
  }

  function layerName(tag) {
    for (const key of ['bothName', 'name', 'alias', 'className']) {
      const value = typeof tag?.get === 'function' ? tag.get(key) : tag?.[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  function findScriptsLayer(layout, editor = null) {
    const tree = layout?.tree;
    if (!tree) return null;
    // Scripts is a direct child of Root. The live tag store is a MobX
    // observable map, so look children up through tree.get instead of
    // enumerating the store.
    try {
      const rootId = originalIdFor(editor, rootIdFor(layout));
      const root = typeof tree.get === 'function' ? tree.get(rootId) : null;
      for (const childId of Array.from(root?.children || [])) {
        const child = tree.get(originalIdFor(editor, childId));
        if (layerName(child).toLowerCase() === 'scripts') return child;
      }
    } catch {}
    const candidates = [tree, tree.tags, tree.composed, tree.composed?.tags];
    for (const candidate of candidates) {
      const found = objectValues(candidate).find(tag => layerName(tag).toLowerCase() === 'scripts');
      if (found) return found;
    }
    return null;
  }

  function originalIdFor(editor, id) {
    if (!id) return '';
    try { return editor?.events?.getOriginalID?.(id) || id; } catch { return id; }
  }

  function appendMarkerFor(targetTag, editor = null) {
    if (!targetTag?.id) throw new Error('Taptop Scripts layer has no identifier');
    const children = Array.isArray(targetTag.children) ? targetTag.children : [];
    const afterChild = children[children.length - 1] || '';
    const marker = {
      id: targetTag.id, composedId: targetTag.id, targetType: targetTag.type || targetTag.widgetName || targetTag.tagName || '',
      direction: editor?.constants?.Lh?.TOP || 'top', childType: '', rangeLeft: 0, rangeTop: 0, rangeRight: 0, rangeBottom: 0,
      markerPositions: {}, fillType: 'half'
    };
    if (afterChild) {
      marker.afterChild = afterChild;
      marker.deepAfterChild = originalIdFor(editor, afterChild);
    }
    return marker;
  }

  function tagById(layout, id) {
    const tree = layout?.tree;
    if (!tree || !id) return null;
    for (const collection of [tree, tree.tags, tree.composed, tree.composed?.tags]) {
      try {
        const found = collection?.get?.(id);
        if (found) return found;
      } catch {}
      if (collection?.[id]) return collection[id];
    }
    return null;
  }

  function originalTagFor(editor, tag) {
    const id = typeof tag === 'string' ? tag : tag?.id;
    if (!id) return tag || null;
    const originalId = originalIdFor(editor, id);
    const tree = editor?.layout?.tree;
    try {
      if (tree?.has?.(originalId)) return tree.get(originalId);
      if (tree?.get?.(originalId)) return tree.get(originalId);
    } catch {}
    return tagById(editor?.layout, originalId) || tag || null;
  }

  function emitLayoutChanged(editor) {
    try {
      editor?.layers?.setMap?.();
      editor?.events?.emit?.(editor.events.ON_HTML_UPDATE);
      editor?.events?.emit?.(editor.events.ON_CHANGE_TAG_DISPLAY);
    } catch {}
  }

  function ensureScriptsLayer(editor) {
    const existing = findScriptsLayer(editor?.layout, editor);
    if (existing) return existing;
    // layout.add accepts only original ids; the composed Root id (`…_0`)
    // fails with "Узел должен существовать".
    const root = originalTagFor(editor, { id: rootIdFor(editor?.layout) });
    const divLayout = editor?.widgets?.get?.(editor?.constants?.gz?.DIV || 'div');
    if (!root?.id || !divLayout || typeof editor?.layout?.add !== 'function') {
      throw new Error('Taptop Scripts layer cannot be created by this editor');
    }
    const firstChildId = originalIdFor(editor, Array.from(root.children || [])[0] || '');
    const options = { layout: divLayout, parentId: root.id };
    if (firstChildId) options.beforeChildId = firstChildId;
    const created = tagById(editor.layout, editor.layout.add(options)?.id);
    if (!created) throw new Error('Taptop did not return a Scripts layer');
    try {
      if (typeof created.setName === 'function') created.setName('Scripts');
      else created.name = 'Scripts';
    } catch { throw new Error('Taptop Scripts layer could not be named'); }
    return created;
  }

  function probe() {
    const editor = resolveEditor();
    if (!editor.ok) return { ok: false, message: `Taptop editor API is unavailable: ${editor.missing.join(', ')}` };
    try {
      const rootTagId = rootIdFor(editor.layout);
      const query = new URLSearchParams(globalThis.location?.search || '');
      return {
        ok: true,
        rootTagId,
        fingerprint: [globalThis.location?.origin || '', query.get('design_id') || '', query.get('page_id') || '', query.get('ver_id') || ''].join(':')
      };
    } catch (error) {
      return { ok: false, message: error?.message || String(error) };
    }
  }

  function pasteClipboardAt(editor, clipboardData, targetTag) {
    if (!targetTag?.id) throw new Error('Taptop paste target was not found');
    const clipboardRootId = clipboardData?.tagID || clipboardData?.copiedLayout?.tree?.root;
    if (typeof clipboardRootId !== 'string' || !clipboardRootId) throw new Error('Imported JSON has no root layer');
    const serialized = JSON.stringify(clipboardData);
    globalThis.localStorage.setItem(CLIPBOARD_STORAGE_KEY, serialized);
    editor.clipboardStore.updateState?.();
    editor.clipboardStore.setClipboard?.(clipboardData);
    globalThis.localStorage.setItem(CLIPBOARD_STORAGE_KEY, serialized);
    editor.clipboardStore.updateState?.();
    const originalTarget = originalTagFor(editor, targetTag);
    const pasted = editor.clipboard.pasteFromClipboard(appendMarkerFor(originalTarget, editor), clipboardRootId);
    const insertedRootId = pastedRootId(pasted);
    if (!insertedRootId) throw new Error('Taptop did not return the inserted layer identifier');
    emitLayoutChanged(editor);
    return insertedRootId;
  }

  function insert(clipboardData) {
    const editor = resolveEditor();
    if (!editor.ok) throw new Error(`Taptop editor API is unavailable: ${editor.missing.join(', ')}`);
    const rootTagId = rootIdFor(editor.layout);
    const rootTag = tagById(editor.layout, rootTagId);
    if (!rootTag) throw new Error('Taptop root layer data was not found');
    return { rootTagId: pasteClipboardAt(editor, clipboardData, rootTag) };
  }

  function insertBehavior(clipboardData) {
    const editor = resolveEditor();
    if (!editor.ok) throw new Error(`Taptop editor API is unavailable: ${editor.missing.join(', ')}`);
    return { rootTagId: pasteClipboardAt(editor, clipboardData, ensureScriptsLayer(editor)) };
  }

  function confirm(rootTagId) {
    // pasteFromClipboard returns a root identifier only after Taptop accepts
    // the native insertion. The layout cache updates asynchronously, so using
    // it here creates a false failure after a visibly successful paste.
    return typeof rootTagId === 'string' && rootTagId.length > 0;
  }

  // Editor collections are MobX observable maps: read them through get/values.
  const valuesOf = collection => (typeof collection?.values === 'function' ? [...collection.values()] : Object.values(collection || {}));
  const getFrom = (collection, key) => (typeof collection?.get === 'function' ? collection.get(key) : collection?.[key]);
  function entriesOf(collection) {
    if (typeof collection?.entries === 'function') return [...collection.entries()];
    if (typeof collection?.toJSON === 'function') { const plain = collection.toJSON(); return Array.isArray(plain) ? plain : Object.entries(plain || {}); }
    return Object.entries(collection || {});
  }
  // Native rules store lengths as { number, unit } without a string value.
  function ruleText(rule) {
    if (rule?.serializeValue !== undefined) return String(rule.serializeValue);
    if (rule?.value !== undefined) return String(rule.value);
    if (typeof rule?.number === 'number') return rule.unit === 'auto' ? 'auto' : `${rule.number}${rule.unit || ''}`;
    if (Array.isArray(rule?.items)) return rule.items.map(item => item?.value ?? '').join(' ');
    return '';
  }

  // `external` ([{ name, collection }]) asks which target-site classes exist,
  // each in its own class collection; the answer is `externalPresent`. A
  // collection the editor does not expose makes the whole answer unavailable.
  function projectClasses(layout, { names = [], selectorKeys = [], external } = {}) {
    const classMap = layout?.mainClassNameCollection?.map;
    const selectorMap = layout?.mainSelectorCollection?.map;
    if (!classMap || typeof classMap !== 'object' || !selectorMap || typeof selectorMap !== 'object') return { available: false };
    const namesIn = map => new Set(valuesOf(map).map(item => item?.value).filter(Boolean));
    const present = namesIn(classMap);
    const selectors = {};
    for (const key of selectorKeys) {
      const rules = getFrom(selectorMap, key)?.rules;
      if (!rules || typeof rules !== 'object') continue;
      selectors[key] = Object.fromEntries(entriesOf(rules).map(([property, rule]) => [property, ruleText(rule)]));
    }
    const result = { available: true, existing: names.filter(name => present.has(name)), selectors };
    if (Array.isArray(external)) {
      const byCollection = {};
      // Page-world trust boundary: only the two known collections are ever
      // looked up, and the name is checked before any editor property is read.
      // This mirrors COLLECTIONS in lib/external-classes.js (the package rule),
      // which is not loaded in the page world.
      for (const { collection } of external) {
        if (collection !== 'main' && collection !== 'design') return { available: false };
        const map = layout?.[`${collection}ClassNameCollection`]?.map;
        if (!map || typeof map !== 'object') return { available: false };
        byCollection[collection] ||= namesIn(map);
      }
      result.externalPresent = external.filter(item => byCollection[item.collection].has(item.name)).map(item => item.name);
    }
    return result;
  }

  function classes(query) {
    const editor = resolveEditor();
    if (!editor.layout) return { available: false };
    return projectClasses(editor.layout, query);
  }

  // ---------- class synchronization (ported from taptop-helper import-sync) ----------
  // Needs TaptopClassSync (extension/lib/class-sync.js) injected into this world.
  const plainRule = value => (value && typeof value.serialize === 'function' ? value.serialize() : (value === undefined ? undefined : JSON.parse(JSON.stringify(value))));

  function observeClasses(editor, { classes = [], bindings = [] } = {}) {
    const sync = globalThis.TaptopClassSync;
    const layout = editor?.layout;
    if (!sync || !layout) throw new Error('Class synchronization is unavailable');
    const boundByKey = new Map(bindings.map(binding => [binding.stableKey, binding]));
    const observed = {};
    for (const packageClass of classes) {
      const binding = boundByKey.get(packageClass.stableKey) || null;
      const collection = layout[`${packageClass.collection}ClassNameCollection`];
      const target = binding ? collection?.get?.(binding.targetClassId) : collection?.findByName?.(packageClass.name);
      if (!target) { observed[packageClass.stableKey] = null; continue; }
      const paths = [...new Set([...(binding?.ownedPaths || []), ...Object.keys(sync.flattenRules(packageClass.ownedRules || {}))])].sort();
      const rules = {};
      for (const path of paths) {
        const { channel, media, selectorText, property } = sync.decodeRulePath(path);
        const selector = layout[`${channel}SelectorCollection`]?.findSelector?.(selectorText, media);
        if (!selector || !(typeof selector.hasCSS === 'function' ? selector.hasCSS(property) : selector.getCSS(property) !== undefined)) continue;
        const value = plainRule(selector.getCSS(property));
        if (value === undefined) continue;
        const scope = `${media}/${selectorText}`;
        rules[channel] ||= {};
        rules[channel][scope] ||= {};
        rules[channel][scope][property] = value;
      }
      observed[packageClass.stableKey] = { id: target.id, name: target.value, collection: packageClass.collection, rules };
    }
    return observed;
  }

  // Writes one class's operations. A write that Taptop did not keep fails the
  // class; a value Taptop keeps in its own spelling is returned in `stored`
  // (and listed in `respelled` for diagnostics) instead of failing the import.
  function applyOperations(layout, sync, plan) {
    const stored = {};
    const respelled = [];
    for (const operation of plan.propertyPlan?.operations || []) {
      const { channel, media, selectorText, property } = sync.decodeRulePath(operation.path);
      const collection = layout[`${channel}SelectorCollection`];
      const where = `${channel} ${media} ${selectorText} ${property}`;
      if (operation.type === 'set') {
        const selector = collection?.getSelector?.(media, selectorText);
        if (!selector?.setCSS || !selector?.getCSS) throw new Error(`${where}: selector cannot be written`);
        try { selector.setCSS(property, plainRule(operation.value), operation.value?.isCustom === true); }
        catch (error) { throw new Error(`${where}: ${error?.message || error}`); }
        const kept = typeof selector.hasCSS === 'function' ? selector.hasCSS(property) : selector.getCSS(property) !== undefined;
        if (!kept) throw new Error(`${where}: Taptop did not keep the value`);
        const written = plainRule(selector.getCSS(property));
        // A native numeric control silently stores 0px for a value it cannot hold
        // (fit-content, 100svh …) while echoing the text back.
        if (operation.value?.isCustom !== true && written?.number === 0 && written?.unit === 'px' && sync.comparable({ value: operation.value?.value ?? operation.value?.serializeValue }) !== '0') {
          throw new Error(`${where}: Taptop stored 0px for ${operation.value?.value ?? operation.value?.serializeValue}`);
        }
        const readback = sync.comparable(written);
        stored[operation.path] = readback;
        if (readback !== sync.comparable(operation.value)) respelled.push({ path: where, written: sync.comparable(operation.value), stored: readback });
      } else {
        const selector = collection?.findSelector?.(selectorText, media);
        if (!selector) continue;
        selector.removeCSS(property);
        if (selector.hasCSS(property)) throw new Error(`${where}: Taptop did not remove the value`);
      }
    }
    return { count: (plan.propertyPlan?.operations || []).length, stored, respelled };
  }

  // Taptop reads a trailing -<number> as its duplicate counter and may generate
  // another name for a new class ("col-1" → "col"). generateByName only builds
  // the class object, so this check adds nothing to the project.
  function respelledClassNames(editor, { classes = [] } = {}) {
    const layout = editor?.layout;
    const respelled = [];
    for (const { name, collection = 'main' } of classes) {
      const names = layout?.[`${collection}ClassNameCollection`];
      if (!names?.generateByName || names.findByName?.(name)) continue;
      const stored = names.generateByName(name)?.value;
      if (stored && stored !== name) respelled.push({ name, stored });
    }
    return respelled;
  }

  // Writes the planned class changes before the layers are pasted, so the paste
  // (which keeps existing classes) picks up the updated classes.
  function applyClassPlans(editor, { plans = [] } = {}) {
    const sync = globalThis.TaptopClassSync;
    const layout = editor?.layout;
    if (!sync || !layout) throw new Error('Class synchronization is unavailable');
    const applied = [];
    const failures = [];
    let operations = 0;
    for (const plan of plans) {
      try {
        let targetClassId = plan.classAction.targetClassId;
        if (plan.classAction.type === 'create') {
          const collection = layout[`${plan.collection}ClassNameCollection`];
          const existing = collection?.findByName?.(plan.name);
          if (existing) targetClassId = existing.id;
          else {
            const generated = collection?.generateByName?.(plan.name);
            if (generated?.id && generated.value !== plan.name) throw new Error(`Taptop would store class ${plan.name} as ${generated.value}`);
            if (!generated?.id) throw new Error(`Could not create class ${plan.name}`);
            collection.add(generated);
            targetClassId = generated.id;
          }
        } else if (plan.classAction.type !== 'reuse') throw new Error(`Unresolved class action ${plan.classAction.type}`);
        const { count, stored, respelled } = applyOperations(layout, sync, plan);
        operations += count;
        const result = { stableKey: plan.stableKey, targetClassId, appliedOperations: count, stored };
        if (respelled.length) result.respelled = respelled;
        applied.push(result);
      } catch (error) {
        failures.push({ stableKey: plan.stableKey, name: plan.name, message: error?.message || String(error) });
      }
    }
    if (operations) editor.history?.add?.('taptop-toolkit: sync classes');
    return { applied, failures };
  }

  function installBridge() {
    const stateKey = '__taptopToolkitRuntimeBridge';
    try { root[stateKey]?.destroy?.(); } catch {}

    const respond = (id, ok, result, error = '') => root.postMessage({
      source: 'taptop-toolkit-runtime', type: 'response', id, ok, result, error
    }, '*');
    const receive = event => {
      if (event.source !== root) return;
      const message = event.data;
      if (!message || message.source !== 'taptop-toolkit-editor' || message.type !== 'request') return;
      try {
        let result;
        if (message.action === 'probe') result = probe();
        else if (message.action === 'insert') result = insert(message.payload?.clipboardData);
        else if (message.action === 'confirm') result = confirm(message.payload?.rootTagId);
        else if (message.action === 'insert-behavior') result = insertBehavior(message.payload?.clipboardData);
        else if (message.action === 'confirm-behavior') result = confirm(message.payload?.rootTagId);
        else throw new Error('Unknown editor action');
        respond(message.id, true, result);
      } catch (error) {
        respond(message.id, false, null, error?.message || String(error));
      }
    };
    root.addEventListener('message', receive);
    root[stateKey] = {
      destroy() {
        root.removeEventListener('message', receive);
        if (root[stateKey] === this) delete root[stateKey];
      }
    };
    return true;
  }

  return { captureRuntimeRequire, findExport, resolveEditor, rootIdFor, pastedRootId, findScriptsLayer, originalIdFor, appendMarkerFor, originalTagFor, emitLayoutChanged, ensureScriptsLayer, pasteClipboardAt, probe, insert, insertBehavior, confirm, projectClasses, classes, observeClasses, applyClassPlans, respelledClassNames, installBridge };
});
