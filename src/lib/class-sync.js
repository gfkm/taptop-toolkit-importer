(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaptopClassSync = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  // Class synchronization on re-import. Ported from taptop-helper
  // features/layers/import-sync (class-sync-planner, merge-planner,
  // class-sync-service, receipt-store; 2026-09-28) and adapted:
  // - values are compared in one normalized form, because Taptop reads rules
  //   back as { number, unit } / rgb() while packages carry strings;
  // - a bound class deleted in Taptop is created again instead of blocking;
  // - property conflicts are resolved by an explicit user choice.
  // Pure logic: runs in the extension world, in MAIN world and in Node tests.
  const CHANNELS = ['main', 'design', 'cm', 'animation'];
  const RECEIPT_PREFIX = 'taptop-toolkit:import-sync:v1';
  const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

  // ---------- rule paths ----------

  function encodeRulePath(channel, media, selectorText, property) {
    if (!CHANNELS.includes(channel)) throw new TypeError(`Invalid selector channel: ${channel}`);
    return JSON.stringify([channel, media, selectorText, property]);
  }

  function decodeRulePath(path) {
    const parts = JSON.parse(path);
    if (!Array.isArray(parts) || parts.length !== 4 || !CHANNELS.includes(parts[0])) throw new TypeError(`Invalid rule path: ${path}`);
    const [channel, media, selectorText, property] = parts;
    return { channel, media, selectorText, property };
  }

  function flattenRules(rules = {}) {
    const flat = {};
    for (const channel of Object.keys(rules).sort()) {
      for (const scope of Object.keys(rules[channel] || {}).sort()) {
        const slash = scope.indexOf('/');
        if (slash <= 0) throw new TypeError(`Invalid rule scope: ${scope}`);
        for (const property of Object.keys(rules[channel][scope] || {}).sort()) {
          flat[encodeRulePath(channel, scope.slice(0, slash), scope.slice(slash + 1), property)] = rules[channel][scope][property];
        }
      }
    }
    return flat;
  }

  // ---------- normalized comparison ----------

  const toHex = channels => `#${channels.map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
  function normalizeText(raw) {
    let text = String(raw).trim().replace(/\s+/g, ' ').toLowerCase();
    text = text.replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*1(?:\.0+)?\s*)?\)/g, (match, r, g, b) => toHex([r, g, b]));
    text = text.replace(/#([0-9a-f])([0-9a-f])([0-9a-f])\b/g, '#$1$1$2$2$3$3');
    if (text === 'unset') return '0';
    const length = /^(-?\d*\.?\d+)[a-z%]*$/.exec(text);
    if (length && Number(length[1]) === 0) return '0';
    return text;
  }

  // One comparable string for a rule in any of Taptop's shapes: value,
  // serializeValue, { number, unit }, grid-track items or a solid fill item.
  function comparable(rule) {
    if (rule === undefined || rule === null) return '';
    if (typeof rule !== 'object') return normalizeText(rule);
    const items = Array.isArray(rule.items) ? rule.items : null;
    let raw;
    if (items && items.length && items.every(item => item && typeof item.value === 'string' && !('kind' in item))) raw = items.map(item => item.value).join(' ');
    else if (rule.value !== undefined) raw = rule.value;
    else if (rule.serializeValue !== undefined) raw = rule.serializeValue;
    else if (typeof rule.number === 'number') raw = rule.unit === 'auto' ? 'auto' : `${rule.number}${rule.unit || ''}`;
    else if (items && items.length === 1 && items[0]?.kind === 'fill') raw = `linear-gradient(${items[0].src})`;
    else return JSON.stringify(rule);
    // A custom rule and a native one with the same text are different values:
    // the native control stores 0px for fit-content (live 2026-10-12), so a
    // file that turns a value custom must be re-applied.
    return rule.isCustom === true ? `${normalizeText(raw)} (custom)` : normalizeText(raw);
  }

  // ---------- planning ----------

  // Three-way merge per rule path. `baseline` is the file value of the last
  // import; `stored` is how Taptop stored it then. Taptop may keep a value in
  // another spelling (gradients, shorthands), so each side is compared with
  // its own baseline and a spelling difference alone is never a change.
  function planPropertyMerge({ baseline = {}, stored = {}, incoming = {}, current = {}, ownedPaths = [] }) {
    const result = { operations: [], preserved: [], conflicts: [] };
    const has = (map, key) => Object.prototype.hasOwnProperty.call(map, key);
    for (const path of [...new Set(ownedPaths)].sort()) {
      const fileBase = has(baseline, path) ? baseline[path] : null;
      const taptopBase = has(stored, path) ? stored[path] : fileBase;
      const n = has(incoming, path) ? comparable(incoming[path]) : null;
      const c = has(current, path) ? comparable(current[path]) : null;
      if (n === c) continue;
      const fileChanged = n !== fileBase;
      const userChanged = c !== taptopBase;
      if (fileChanged && !userChanged) {
        result.operations.push(n !== null ? { type: 'set', path, value: clone(incoming[path]) } : { type: 'remove', path });
      } else if (userChanged && !fileChanged) {
        result.preserved.push({ path });
      } else if (fileChanged && userChanged) {
        result.conflicts.push({ path, incoming: n !== null ? clone(incoming[path]) : null });
      }
    }
    return result;
  }

  function baselineOf(incoming) {
    return Object.fromEntries(Object.entries(incoming).map(([path, rule]) => [path, comparable(rule)]));
  }

  function buildClassSyncPlan({ packageClass, binding = null, currentClass = null }) {
    const incoming = flattenRules(packageClass.ownedRules || {});
    const incomingPaths = Object.keys(incoming).sort();
    const base = { stableKey: packageClass.stableKey, name: packageClass.name, collection: packageClass.collection };
    if (!currentClass) {
      return {
        ...base,
        classAction: { type: 'create', name: packageClass.name, collection: packageClass.collection },
        propertyPlan: planPropertyMerge({ incoming, ownedPaths: incomingPaths }),
        nextBaseline: baselineOf(incoming), ownedPaths: incomingPaths
      };
    }
    if (!binding) {
      return { ...base, classAction: { type: 'adopt-required', targetClassId: currentClass.id, name: currentClass.name }, propertyPlan: null, current: clone(currentClass) };
    }
    const current = flattenRules(currentClass.rules || {});
    return {
      ...base,
      classAction: { type: 'reuse', targetClassId: binding.targetClassId },
      propertyPlan: planPropertyMerge({ baseline: binding.baseline || {}, stored: binding.stored || {}, incoming, current, ownedPaths: [...(binding.ownedPaths || []), ...incomingPaths] }),
      nextBaseline: baselineOf(incoming), ownedPaths: incomingPaths
    };
  }

  function blockersFor(plan) {
    if (plan.classAction.type === 'adopt-required') return [{ stableKey: plan.stableKey, type: 'adopt-required' }];
    return (plan.propertyPlan?.conflicts || []).map(conflict => ({ stableKey: plan.stableKey, type: 'property-conflict', path: conflict.path }));
  }

  function bindingsOf(receipt, identity) {
    if (!receipt) return new Map();
    if (receipt.targetKey !== identity.targetKey || receipt.namespace !== identity.namespace || receipt.componentKey !== identity.componentKey) {
      throw new TypeError('Receipt identity does not match the package target');
    }
    return new Map((receipt.classBindings || []).map(binding => [binding.stableKey, binding]));
  }

  function previewClassSync({ targetKey, packageData, receipt = null, observed = {} }) {
    const identity = { targetKey, namespace: packageData.namespace, componentKey: packageData.componentKey };
    const bindings = bindingsOf(receipt, identity);
    const plans = packageData.classes.map(packageClass => buildClassSyncPlan({
      packageClass,
      binding: bindings.get(packageClass.stableKey) || null,
      currentClass: observed[packageClass.stableKey] || null
    }));
    return { schemaVersion: 1, ...identity, packageRevision: packageData.revision, plans, blockers: plans.flatMap(blockersFor) };
  }

  // The user chose to keep these same-name project classes as they are: the
  // layers use them by name, nothing is written to them and they are not
  // bound to the file, so a later import asks again instead of overwriting.
  function useExisting(preview, stableKeys) {
    const keep = new Set(stableKeys || []);
    const next = clone(preview);
    next.plans = next.plans.map(plan => (plan.classAction.type === 'adopt-required' && keep.has(plan.stableKey)
      ? { stableKey: plan.stableKey, name: plan.name, collection: plan.collection, classAction: { type: 'use-existing', targetClassId: plan.classAction.targetClassId, name: plan.classAction.name }, propertyPlan: null }
      : plan));
    next.blockers = next.plans.flatMap(blockersFor);
    return next;
  }

  const propertyOf = path => decodeRulePath(path).property;
  function summarize(preview) {
    const summary = { created: [], updated: [], unchanged: [], adopt: [], conflicts: [], existing: [] };
    for (const plan of preview.plans) {
      if (plan.classAction.type === 'create') summary.created.push(plan.name);
      else if (plan.classAction.type === 'adopt-required') summary.adopt.push(plan.name);
      else if (plan.classAction.type === 'use-existing') summary.existing.push(plan.name);
      else {
        const properties = [...new Set(plan.propertyPlan.operations.map(operation => propertyOf(operation.path)))];
        const conflicts = [...new Set(plan.propertyPlan.conflicts.map(conflict => propertyOf(conflict.path)))];
        if (conflicts.length) summary.conflicts.push({ name: plan.name, properties: conflicts });
        if (properties.length) summary.updated.push({ name: plan.name, properties });
        else if (!conflicts.length) summary.unchanged.push(plan.name);
      }
    }
    return summary;
  }

  // Applies the user's choice for values edited both in Taptop and in the file.
  function resolvePlans(preview, { conflicts = 'keep' } = {}) {
    const next = clone(preview);
    for (const plan of next.plans) {
      if (!plan.propertyPlan) continue;
      if (conflicts === 'take') {
        for (const conflict of plan.propertyPlan.conflicts) {
          plan.propertyPlan.operations.push(conflict.incoming ? { type: 'set', path: conflict.path, value: conflict.incoming } : { type: 'remove', path: conflict.path });
        }
      }
      plan.propertyPlan.conflicts = [];
    }
    next.blockers = next.plans.flatMap(blockersFor);
    return next;
  }

  // Takes same-name project classes under management: their current values
  // become the baseline, so the next preview overwrites them from the file.
  function adopt({ preview, packageData, receipt = null }) {
    const bindings = new Map((receipt?.classBindings || []).map(binding => [binding.stableKey, clone(binding)]));
    const packageByKey = new Map(packageData.classes.map(item => [item.stableKey, item]));
    for (const plan of preview.plans.filter(item => item.classAction.type === 'adopt-required')) {
      const incoming = flattenRules(packageByKey.get(plan.stableKey).ownedRules || {});
      const current = flattenRules(plan.current?.rules || {});
      const ownedPaths = Object.keys(incoming).sort();
      const baseline = {};
      for (const path of ownedPaths) if (Object.prototype.hasOwnProperty.call(current, path)) baseline[path] = comparable(current[path]);
      bindings.set(plan.stableKey, { stableKey: plan.stableKey, targetClassId: plan.classAction.targetClassId, name: plan.name, collection: plan.collection, ownedPaths, baseline });
    }
    return {
      schemaVersion: 1, targetKey: preview.targetKey, namespace: packageData.namespace, componentKey: packageData.componentKey,
      packageRevision: packageData.revision,
      classBindings: [...bindings.values()].sort((a, b) => a.stableKey.localeCompare(b.stableKey)),
      instanceBindings: clone(receipt?.instanceBindings || [])
    };
  }

  // Receipt after a verified apply: one binding per class with its target id.
  function nextReceipt({ preview, packageData, receipt = null, applied }) {
    const bindings = new Map((receipt?.classBindings || []).map(binding => [binding.stableKey, clone(binding)]));
    const appliedByKey = new Map(applied.map(item => [item.stableKey, item]));
    for (const plan of preview.plans) {
      // A class kept as the project's own is never owned by this file.
      if (plan.classAction.type === 'use-existing') continue;
      const result = appliedByKey.get(plan.stableKey);
      const targetClassId = result?.targetClassId || plan.classAction.targetClassId;
      if (!targetClassId) throw new Error(`No target class for ${plan.stableKey}`);
      // Taptop's spelling of every value: the fresh readback of what was
      // written now, the previous one for paths left as they were.
      const previous = bindings.get(plan.stableKey)?.stored || {};
      const stored = {};
      for (const path of plan.ownedPaths || []) {
        if (result?.stored && Object.prototype.hasOwnProperty.call(result.stored, path)) stored[path] = result.stored[path];
        else if (Object.prototype.hasOwnProperty.call(previous, path)) stored[path] = previous[path];
      }
      const binding = { stableKey: plan.stableKey, targetClassId, name: plan.name, collection: plan.collection, ownedPaths: plan.ownedPaths, baseline: plan.nextBaseline };
      if (Object.keys(stored).length) binding.stored = stored;
      bindings.set(plan.stableKey, binding);
    }
    return {
      schemaVersion: 1, targetKey: preview.targetKey, namespace: packageData.namespace, componentKey: packageData.componentKey,
      packageRevision: packageData.revision,
      classBindings: [...bindings.values()].sort((a, b) => a.stableKey.localeCompare(b.stableKey)),
      instanceBindings: clone(receipt?.instanceBindings || [])
    };
  }

  function bindRoot(receipt, packageData, rootTagId) {
    const stableKey = packageData.instances?.[0]?.stableKey;
    if (!stableKey || !rootTagId) throw new Error('A pasted root and a package instance are required');
    const next = clone(receipt);
    const instances = new Map((next.instanceBindings || []).map(item => [item.stableKey, item]));
    instances.set(stableKey, { stableKey, targetTagId: rootTagId });
    next.instanceBindings = [...instances.values()].sort((a, b) => a.stableKey.localeCompare(b.stableKey));
    return next;
  }

  // ---------- receipts ----------

  function targetKeyFor(location) {
    const params = new URLSearchParams(location.search);
    const designId = params.get('design_id');
    const versionId = params.get('ver_id');
    if (!/^\d+$/.test(designId || '') || !/^\d+$/.test(versionId || '')) return null;
    return `${location.hostname}:design:${designId}:version:${versionId}`;
  }

  function createReceiptStore(storage, prefix = RECEIPT_PREFIX) {
    const keyFor = identity => [prefix, identity.targetKey, identity.namespace, identity.componentKey].map(encodeURIComponent).join(':');
    return {
      loadReceipt(identity) {
        const raw = storage.getItem(keyFor(identity));
        if (raw === null || raw === undefined) return null;
        const receipt = JSON.parse(raw);
        if (receipt?.schemaVersion !== 1 || receipt.targetKey !== identity.targetKey || receipt.namespace !== identity.namespace || receipt.componentKey !== identity.componentKey) return null;
        return receipt;
      },
      saveReceipt(receipt) {
        storage.setItem(keyFor(receipt), JSON.stringify(receipt));
        return clone(receipt);
      }
    };
  }

  return {
    encodeRulePath, decodeRulePath, flattenRules, comparable, planPropertyMerge, buildClassSyncPlan,
    previewClassSync, useExisting, summarize, resolvePlans, adopt, nextReceipt, bindRoot, targetKeyFor, createReceiptStore
  };
});
