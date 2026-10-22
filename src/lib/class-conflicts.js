(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaptopClassConflicts = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  // Taptop keeps an existing project class on paste and ignores the pasted
  // rules for it. A same-name class with different styles would silently
  // restyle the imported block, so it is imported as a numbered copy instead.
  const BASE_CLASSES = new Set(['div', 'text', 'button', 'text-button', 'link-block', 'image', 'image__img', 'toolkit-behavior']);
  const SELECTOR_COLLECTIONS = ['mainSelectorCollection', 'designSelectorCollection', 'cmSelectorCollection', 'animationSelectorCollection'];
  const CLASS_COLLECTIONS = ['mainClassNameCollection', 'designClassNameCollection'];

  const isBase = name => BASE_CLASSES.has(name) || /^embed(__|$)/.test(name);
  const copy = value => JSON.parse(JSON.stringify(value));
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // `exclude` holds the package's external classes: target-site classes that
  // layers use by name. They are never conflicts, copies or sync candidates.
  function packageClassNames(clipboardData, exclude = []) {
    const skip = new Set(exclude);
    const names = Object.values(clipboardData?.copiedLayout?.mainClassNameCollection?.map || {}).map(item => item?.value).filter(Boolean);
    return [...new Set(names)].filter(name => !isBase(name) && !skip.has(name));
  }

  // «Use existing» for a same-name class: the layers keep the name and the
  // paste carries no rule that belongs to that class alone (`.card`,
  // `.card:hover`, `.card` in a media query), in any of the four selector
  // collections (main, design, cm, animation): the project's class wins
  // entirely. Selectors that also involve another class stay.
  const CLASS_TOKEN = /\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g;
  function stripClassRules(wrapper, names) {
    const result = copy(wrapper);
    const kept = new Set(names || []);
    if (!kept.size) return result;
    const layout = result.clipboardData?.copiedLayout || {};
    const ownedByKept = selectorText => {
      const classes = [...String(selectorText || '').matchAll(CLASS_TOKEN)].map(match => match[1]);
      return classes.length > 0 && classes.every(name => kept.has(name));
    };
    for (const key of SELECTOR_COLLECTIONS) {
      const collection = layout[key];
      if (!collection?.map) continue;
      collection.map = Object.fromEntries(Object.entries(collection.map).filter(([, entry]) => !ownedByKept(entry?.selectorText)));
    }
    return result;
  }

  function ownRules(clipboardData, name) {
    const result = {};
    for (const [key, entry] of Object.entries(clipboardData?.copiedLayout?.mainSelectorCollection?.map || {})) {
      if (entry?.selectorText !== `.${name}`) continue;
      result[key] = Object.fromEntries(Object.entries(entry.rules || {}).map(([prop, rule]) => [prop, String(rule?.serializeValue ?? rule?.value ?? '')]));
    }
    return result;
  }

  function conflictQuery(clipboardData, exclude = []) {
    const names = packageClassNames(clipboardData, exclude);
    const selectorKeys = names.flatMap(name => [...new Set([...Object.keys(ownRules(clipboardData, name)), `screen/.${name}`])]);
    return { names, selectorKeys };
  }

  // Taptop may store a hex color back as rgb(); compare both spellings as one.
  const toHex = channels => `#${channels.map(value => Number(value).toString(16).padStart(2, '0')).join('')}`;
  const normalize = value => String(value ?? '').trim().toLowerCase()
    .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*1(?:\.0+)?\s*)?\)/g, (match, r, g, b) => toHex([r, g, b]))
    .replace(/\s+/g, ' ');
  function sameRules(a = {}, b = {}) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) if (normalize(a[key]) !== normalize(b[key])) return false;
    return true;
  }

  function findConflicts(clipboardData, snapshot, exclude = []) {
    const result = { available: Boolean(snapshot?.available), added: [], reused: [], conflicts: [] };
    const names = packageClassNames(clipboardData, exclude);
    if (!result.available) return { ...result, total: names.length };
    const existing = new Set(snapshot.existing || []);
    for (const name of names) {
      if (!existing.has(name)) { result.added.push(name); continue; }
      const ours = ownRules(clipboardData, name);
      const keys = new Set([...Object.keys(ours), `screen/.${name}`]);
      const same = [...keys].every(key => sameRules(ours[key], snapshot.selectors?.[key]));
      (same ? result.reused : result.conflicts).push(name);
    }
    return { ...result, total: names.length };
  }

  function renameQuery(names) {
    return { names: names.flatMap(name => Array.from({ length: 8 }, (_, index) => `${name}-${index + 2}`)), selectorKeys: [] };
  }

  function planRenames(conflicts, snapshot, packageNames = []) {
    const taken = new Set([...(snapshot?.existing || []), ...packageNames]);
    const renames = new Map();
    for (const name of conflicts) {
      let index = 2;
      while (taken.has(`${name}-${index}`)) index += 1;
      const next = `${name}-${index}`;
      taken.add(next);
      renames.set(name, next);
    }
    return renames;
  }

  function applyClassRenames(wrapper, renames) {
    const result = copy(wrapper);
    if (!renames?.size) return result;
    const names = [...renames.keys()].sort((a, b) => b.length - a.length).map(escape);
    const token = new RegExp(`\\.(${names.join('|')})(?![\\w-])`, 'g');
    const replaceTokens = text => String(text).replace(token, (match, name) => `.${renames.get(name)}`);
    const rename = name => renames.get(name) || name;

    const layout = result.clipboardData?.copiedLayout || {};
    for (const key of CLASS_COLLECTIONS) {
      const collection = layout[key];
      if (!collection) continue;
      for (const item of Object.values(collection.map || {})) if (item?.value) item.value = rename(item.value);
      if (collection.head?.value) collection.head.value = rename(collection.head.value);
      if (collection.countMap) collection.countMap = Object.fromEntries(Object.entries(collection.countMap).map(([name, count]) => [rename(name), count]));
    }
    for (const key of SELECTOR_COLLECTIONS) {
      const collection = layout[key];
      if (!collection?.map) continue;
      collection.map = Object.fromEntries(Object.entries(collection.map).map(([selectorKey, entry]) => [
        replaceTokens(selectorKey), { ...entry, selectorText: replaceTokens(entry.selectorText) }
      ]));
    }
    for (const tag of Object.values(layout.tree?.tags || {})) if (tag?.name && renames.has(tag.name)) tag.name = renames.get(tag.name);

    for (const behavior of result.behaviorPackages || []) {
      for (const tag of Object.values(behavior?.clipboardData?.copiedLayout?.tree?.tags || {})) {
        if (typeof tag?.embedCode !== 'string') continue;
        tag.embedCode = replaceTokens(tag.embedCode).replace(/("openClass":")([^"]+)(")/g, (match, start, name, end) => `${start}${rename(name)}${end}`);
      }
    }
    for (const item of result.syncPackage?.classes || []) {
      if (!renames.has(item.name)) continue;
      item.name = renames.get(item.name);
      for (const collection of Object.keys(item.ownedRules || {})) {
        item.ownedRules[collection] = Object.fromEntries(Object.entries(item.ownedRules[collection]).map(([key, rules]) => [replaceTokens(key), rules]));
      }
    }
    return result;
  }

  return { conflictQuery, findConflicts, renameQuery, planRenames, applyClassRenames, packageClassNames, stripClassRules };
});
