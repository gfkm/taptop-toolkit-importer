(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaptopImportPlanner = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (root) {
  // Decides what happens to every class of a package before insertion:
  // classes this file created earlier are updated in place (receipt bindings),
  // new ones are created, identical same-name ones are taken over silently,
  // and other same-name project classes are copied or updated by user choice.
  const load = name => root[name] || (typeof require === 'function' ? require(`./${name === 'TaptopClassSync' ? 'class-sync' : 'class-conflicts'}.js`) : null);

  function identicalToFile(plan, packageClass, sync) {
    const incoming = sync.flattenRules(packageClass.ownedRules || {});
    const current = sync.flattenRules(plan.current?.rules || {});
    const paths = Object.keys(incoming);
    return paths.length > 0 && paths.every(path => Object.prototype.hasOwnProperty.call(current, path) && sync.comparable(current[path]) === sync.comparable(incoming[path]));
  }

  async function legacyCopies(wrapper, lookup, skip = new Set()) {
    const conflicts = load('TaptopClassConflicts');
    let snapshot = { available: false };
    try { snapshot = await lookup(conflicts.conflictQuery(wrapper.clipboardData)); }
    catch (error) { snapshot = { available: false }; }
    const found = conflicts.findConflicts(wrapper.clipboardData, snapshot);
    const names = found.conflicts.filter(name => !skip.has(name));
    let renames = new Map();
    if (names.length) {
      let candidates = { existing: [] };
      try { candidates = await lookup(conflicts.renameQuery(names)); } catch {}
      renames = conflicts.planRenames(names, candidates, conflicts.packageClassNames(wrapper.clipboardData));
    }
    return { found, renames };
  }

  const copiesOf = renames => [...renames].map(([name, copy]) => ({ name, copy }));

  // decisions === null previews without applying the adopt choice (review step).
  async function planImport({ wrapper, decisions = null, targetKey = null, receipt = null, observe, lookup }) {
    const sync = load('TaptopClassSync');
    const conflicts = load('TaptopClassConflicts');
    const packageData = wrapper.syncPackage;
    const fallback = async () => {
      const { found, renames } = await legacyCopies(wrapper, lookup);
      return {
        wrapper: conflicts.applyClassRenames(wrapper, renames), preview: null, receipt,
        classes: { available: found.available, total: found.total, created: found.added, updated: [], unchanged: found.reused, adopt: [], conflicts: [], copies: copiesOf(renames) }
      };
    };
    if (!packageData?.classes?.length) return fallback();

    let current = wrapper;
    let observed;
    try { observed = await observe(current.syncPackage.classes, receipt?.classBindings || []); }
    catch (error) { return fallback(); }
    const preview = () => sync.previewClassSync({ targetKey, packageData: current.syncPackage, receipt, observed });
    let plan = preview();
    const byKey = () => new Map(current.syncPackage.classes.map(item => [item.stableKey, item]));

    const identical = plan.plans.filter(item => item.classAction.type === 'adopt-required' && identicalToFile(item, byKey().get(item.stableKey), sync));
    if (identical.length) {
      receipt = sync.adopt({ preview: { ...plan, plans: identical }, packageData: current.syncPackage, receipt });
      plan = preview();
    }

    const copies = new Map();
    const pending = plan.plans.filter(item => item.classAction.type === 'adopt-required');
    if (pending.length && decisions?.adopt === 'update') {
      receipt = sync.adopt({ preview: plan, packageData: current.syncPackage, receipt });
      plan = preview();
    } else if (pending.length && decisions) {
      const names = pending.map(item => item.name);
      let candidates = { existing: [] };
      try { candidates = await lookup(conflicts.renameQuery(names)); } catch {}
      for (const [name, copy] of conflicts.planRenames(names, candidates, conflicts.packageClassNames(current.clipboardData))) copies.set(name, copy);
      current = conflicts.applyClassRenames(current, copies);
      observed = await observe(current.syncPackage.classes, receipt?.classBindings || []);
      plan = preview();
    }

    // A bound class renamed in Taptop keeps its new name: paste links by name.
    const drift = new Map();
    for (const item of plan.plans) {
      const name = observed[item.stableKey]?.name;
      if (item.classAction.type === 'reuse' && name && name !== item.name) drift.set(item.name, name);
    }
    if (drift.size) {
      current = conflicts.applyClassRenames(current, drift);
      plan = preview();
    }

    // Classes outside the sync package keep the paste-safe copy rule.
    const managed = new Set(current.syncPackage.classes.map(item => item.name));
    const extra = await legacyCopies(current, lookup, managed);
    if (extra.renames.size) {
      current = conflicts.applyClassRenames(current, extra.renames);
      for (const [name, copy] of extra.renames) copies.set(name, copy);
    }

    const summary = sync.summarize(plan);
    const copyNames = new Set(copies.values());
    summary.created = summary.created.filter(name => !copyNames.has(name));
    return {
      wrapper: current, preview: plan, receipt,
      resolved: sync.resolvePlans(plan, { conflicts: decisions?.conflicts || 'keep' }),
      classes: { available: true, total: packageData.classes.length, ...summary, copies: copiesOf(copies) }
    };
  }

  // Plans that change Taptop: new classes and classes with property operations.
  function pendingPlans(resolved) {
    return (resolved?.plans || []).filter(plan => plan.classAction.type === 'create' || plan.propertyPlan?.operations?.length);
  }

  return { planImport, pendingPlans };
});
