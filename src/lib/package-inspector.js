(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaptopPackageInspector = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  const SHA_256 = /^[a-f0-9]{64}$/;
  const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml']);

  async function sha256(bytes) {
    if (globalThis.crypto?.subtle) {
      const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
    }
    const nodeCrypto = require('node:crypto');
    return nodeCrypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  }

  function error(message) { return { ok: false, errors: [message], warnings: [], summary: { nodes: 0, classes: 0, instances: 0, assets: 0 } }; }

  function base64Bytes(data) {
    if (typeof data !== 'string' || !data || !BASE64.test(data)) throw new Error('Embedded asset data must be canonical Base64');
    if (typeof atob === 'function') {
      const decoded = atob(data);
      const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
      let canonicalBinary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        canonicalBinary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
      }
      if (btoa(canonicalBinary) !== data) throw new Error('Embedded asset data must be canonical Base64');
      return bytes;
    }
    const bytes = Buffer.from(data, 'base64');
    if (bytes.toString('base64') !== data) throw new Error('Embedded asset data must be canonical Base64');
    return bytes;
  }

  async function inspectEmbeddedAsset(item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Embedded asset must be an object');
    const allowed = new Set(['stableKey', 'sha256', 'mimeType', 'width', 'height', 'byteLength', 'encoding', 'data']);
    const unexpected = Object.keys(item).find(key => !allowed.has(key));
    if (unexpected) throw new Error(`Embedded asset has unexpected field ${unexpected}`);
    if (!SHA_256.test(item.sha256 || '')) throw new Error('Embedded asset SHA-256 must be lowercase hex');
    if (item.stableKey !== `asset/${item.sha256}`) throw new Error('Embedded asset stableKey must match SHA-256');
    if (!MIME_TYPES.has(item.mimeType)) throw new Error('Embedded asset mimeType is unsupported');
    if (!Number.isSafeInteger(item.width) || item.width < 1 || !Number.isSafeInteger(item.height) || item.height < 1) throw new Error('Embedded asset dimensions are invalid');
    if (!Number.isSafeInteger(item.byteLength) || item.byteLength < 1) throw new Error('Embedded asset byteLength is invalid');
    if (item.encoding !== 'base64') throw new Error('Embedded asset encoding must be base64');
    const bytes = base64Bytes(item.data);
    if (bytes.byteLength !== item.byteLength) throw new Error('Embedded asset byteLength differs from decoded bytes');
    if (await sha256(bytes) !== item.sha256) throw new Error('Embedded asset SHA-256 differs from decoded bytes');
  }

  function inspectBehaviorPackages(value) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) return ['behaviorPackages must be an array'];
    const errors = [];
    const keys = new Set();
    for (const item of value) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('Behavior package must be an object'); continue; }
      if (typeof item.key !== 'string' || !item.key) errors.push('Behavior package needs a key');
      else if (keys.has(item.key)) errors.push(`Duplicate behavior package key: ${item.key}`);
      else keys.add(item.key);
      if (typeof item.adapter !== 'string' || !item.adapter) errors.push(`Behavior package ${item.key || '?'} needs an adapter`);
      const clipboard = item.clipboardData;
      const rootId = clipboard?.copiedLayout?.tree?.root || clipboard?.tagID;
      const root = clipboard?.copiedLayout?.tree?.tags?.[rootId];
      if (!root || root.widgetName !== 'tt_embed') errors.push(`Behavior package ${item.key || '?'} needs a tt_embed root`);
    }
    return errors;
  }

  async function inspectPackage({ packageText }) {
    let wrapper;
    try { wrapper = JSON.parse(packageText); } catch { return error('Package must be valid JSON'); }
    if (wrapper?.type !== 'taptop-enhancer-layer-export') return error('Unsupported package type');
    if (wrapper.version === 1) return error('This is an earlier package with a separate asset folder. Compile again with Toolkit 0.2.');
    if (wrapper.version !== 2) return error(`Unsupported package version: ${wrapper.version}`);
    if (!SHA_256.test(wrapper.sourceRevision || '')) return error('Package sourceRevision must be SHA-256');
    const sync = wrapper.syncPackage;
    if (!sync || sync.schemaVersion !== 1 || !Array.isArray(sync.classes) || !Array.isArray(sync.instances)) return error('Package sync metadata is incomplete');
    const packageAssets = wrapper.embeddedAssets;
    if (!Array.isArray(packageAssets)) return error('Package embeddedAssets must be an array');
    const errors = [];
    errors.push(...inspectBehaviorPackages(wrapper.behaviorPackages));
    const assetKeys = new Set();
    for (const item of packageAssets) {
      if (assetKeys.has(item?.stableKey)) errors.push(`Duplicate embedded asset stableKey: ${item?.stableKey || '?'}`);
      else assetKeys.add(item?.stableKey);
      try { await inspectEmbeddedAsset(item); }
      catch (assetError) { errors.push(`Embedded asset ${item?.stableKey || '?'}: ${assetError.message}`); }
    }
    const tags = wrapper.clipboardData?.copiedLayout?.tree?.tags || {};
    const assetsByKey = new Set(packageAssets.map(item => item?.stableKey));
    for (const tag of Object.values(tags)) {
      const key = tag?.__pendingUpload?.assetKey;
      if (tag?.widgetName === 'image__img' && (!key || !assetsByKey.has(key))) errors.push(`Image tag ${tag?.id || '?'} needs a known embedded assetKey`);
      if (tag?.__pendingUpload && Object.keys(tag.__pendingUpload).some(name => name !== 'assetKey')) errors.push(`Image tag ${tag?.id || '?'} has unsupported pending upload metadata`);
    }
    return {
      ok: errors.length === 0,
      errors,
      warnings: errors.length ? [] : ['Package is structurally ready for Taptop import.'],
      summary: { nodes: Object.keys(tags).length, classes: sync.classes.length, instances: sync.instances.length, assets: packageAssets.length }
    };
  }

  return { inspectPackage };
});
