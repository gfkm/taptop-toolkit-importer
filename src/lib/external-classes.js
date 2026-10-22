(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaptopExternalClasses = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  // The one owner of wrapper.externalClasses (Toolkit fork gfkm/taptop-toolkit, contract
  // snapshot contracts/import-sync/README.md): classes of the target site that
  // layers use by name. The inspector adds the checks against the clipboard
  // and syncPackage; planner, session and editor mount use declaration/missing.
  // Leaf module: depends on nothing, loaded before its consumers.
  const NAME = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
  const COLLECTIONS = ['main', 'design'];

  // The Toolkit preflight's shape rules (system/lib/import-package-preflight.js):
  // { name, collection } items, collection main|design, CSS class names,
  // sorted by name in code-unit order, no duplicates.
  function structuralErrors(list) {
    if (!Array.isArray(list)) return ['externalClasses must be an array'];
    const errors = [];
    list.forEach((item, index) => {
      const keys = item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item).sort().join(',') : '';
      if (keys !== 'collection,name' || typeof item.name !== 'string' || !NAME.test(item.name) || !COLLECTIONS.includes(item.collection)) {
        errors.push(`externalClasses[${index}] must be { name: <class name>, collection: "main" | "design" }`);
      }
    });
    if (errors.length) return errors;
    if (list.some((item, index) => index > 0 && list[index - 1].name >= item.name)) errors.push('externalClasses must be sorted by name without duplicates');
    return errors;
  }

  // Absent means none. Present but malformed is invalid, never "none": a bad
  // field must not switch the existence check off.
  function declaration(wrapper) {
    const value = wrapper?.externalClasses;
    if (value === undefined) return { valid: true, list: [], errors: [] };
    const errors = structuralErrors(value);
    return { valid: errors.length === 0, list: errors.length ? [] : value.map(({ name, collection }) => ({ name, collection })), errors };
  }

  const names = list => list.map(item => item.name);

  // Lookup for the runtime adapter's projectClasses.
  function query(list) {
    return { names: [], selectorKeys: [], external: list.map(({ name, collection }) => ({ name, collection })) };
  }

  // `list` comes from declaration(). Fails closed: an editor that cannot
  // answer, or an answer without `externalPresent`, proves nothing.
  function missing(list, snapshot) {
    if (!list.length) return { available: true, missing: [] };
    if (!snapshot?.available || !Array.isArray(snapshot.externalPresent)) return { available: false, missing: names(list) };
    const present = new Set(snapshot.externalPresent);
    return { available: true, missing: names(list).filter(name => !present.has(name)) };
  }

  return { structuralErrors, declaration, names, query, missing };
});
