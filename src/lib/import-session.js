(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaptopImportSession = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function (root) {
  function copy(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // `details` carries structured data for the UI (e.g. { missing: [names] }).
  function failed(code, error, retryable = true, details = undefined) {
    const result = {
      status: 'failed',
      phase: 'failed',
      receipt: null,
      error: { code, message: error?.message || String(error), retryable }
    };
    if (details !== undefined) result.error.details = details;
    return result;
  }

  function requireAdapter(adapter) {
    for (const name of ['targetProjectFingerprint', 'prepareAsset', 'uploadAsset', 'insertLayer', 'confirmInserted']) {
      if (typeof adapter?.[name] !== 'function') throw new TypeError(`IMPORT_ADAPTER_MISSING: ${name}`);
    }
  }

  function declaredBehaviorPackages(wrapper) {
    if (wrapper?.behaviorPackages === undefined) return [];
    if (!Array.isArray(wrapper.behaviorPackages)) throw new TypeError('BEHAVIOR_PACKAGES_INVALID');
    return wrapper.behaviorPackages;
  }

  function requireBehaviorAdapter(adapter) {
    for (const name of ['insertBehaviorLayer', 'confirmBehaviorInserted']) {
      if (typeof adapter?.[name] !== 'function') throw new TypeError(`BEHAVIOR_IMPORT_ADAPTER_MISSING: ${name}`);
    }
  }

  function bindUploadedMedia(clipboardData, mediaByKey) {
    const tags = Object.values(clipboardData?.copiedLayout?.tree?.tags || {});
    for (const tag of tags) {
      const stableKey = tag?.__pendingUpload?.assetKey;
      if (!stableKey) continue;
      const media = mediaByKey.get(stableKey);
      if (!media) throw new Error(`UPLOADED_ASSET_MISSING: ${stableKey}`);
      tag.data ||= {};
      tag.data.src = { type: 'IMAGE2', value: media };
      delete tag.__pendingUpload;
    }
  }

  function requireTargetMedia(media) {
    const imageId = media?.image_id;
    if ((typeof imageId !== 'string' && typeof imageId !== 'number') || String(imageId).trim() === '') {
      throw new Error('Taptop did not return a target media identifier');
    }
    return media;
  }

  async function runImportSession({ wrapper, adapter, onProgress = () => {} }) {
    try {
      requireAdapter(adapter);
      const clipboardData = copy(wrapper?.clipboardData);
      const assets = wrapper?.embeddedAssets;
      const behaviorPackages = declaredBehaviorPackages(wrapper);
      if (!clipboardData || !Array.isArray(assets)) throw new TypeError('IMPORT_PACKAGE_INCOMPLETE');
      if (behaviorPackages.length) requireBehaviorAdapter(adapter);
      onProgress({ phase: 'checking' });
      // Target-site classes the layers use by name must exist before the
      // first write. This guards the session's own contract for any caller,
      // whatever it planned before: a malformed declaration, an adapter that
      // cannot check, or a missing class stops the session here.
      const externalClasses = root.TaptopExternalClasses || (typeof require === 'function' ? require('./external-classes.js') : null);
      if (typeof externalClasses?.declaration !== 'function') {
        return failed('SESSION_UNAVAILABLE', new Error('IMPORT_MODULE_MISSING: external-classes'), false);
      }
      const declared = externalClasses.declaration(wrapper);
      if (!declared.valid) {
        return failed('EXTERNAL_CLASSES_INVALID', new Error(`EXTERNAL_CLASSES_INVALID: ${declared.errors.join('; ')}`), false);
      }
      const external = declared.list;
      if (external.length) {
        if (typeof adapter.missingExternalClasses !== 'function') {
          return failed('EXTERNAL_CLASSES_UNVERIFIED', new Error('EXTERNAL_CLASSES_UNVERIFIED: the adapter cannot check site classes'), false);
        }
        let missing;
        try { missing = await adapter.missingExternalClasses(copy(external)); }
        catch (error) { return failed('EXTERNAL_CLASSES_UNVERIFIED', error); }
        if (!Array.isArray(missing)) return failed('EXTERNAL_CLASSES_UNVERIFIED', new Error('EXTERNAL_CLASSES_UNVERIFIED: no answer about site classes'));
        if (missing.length) return failed('EXTERNAL_CLASSES_MISSING', new Error(`EXTERNAL_CLASSES_MISSING: ${missing.join(', ')}`), false, { missing: [...missing] });
      }
      const mediaByKey = new Map();
      for (let index = 0; index < assets.length; index += 1) {
        const asset = assets[index];
        onProgress({ phase: 'preparing', current: index + 1, total: assets.length, stableKey: asset.stableKey });
        let prepared;
        try { prepared = await adapter.prepareAsset(asset); }
        catch (error) { return failed('PREPARE_FAILED', error, false); }
        onProgress({ phase: 'uploading', current: index + 1, total: assets.length, stableKey: asset.stableKey });
        try { mediaByKey.set(asset.stableKey, requireTargetMedia(await adapter.uploadAsset(prepared))); }
        catch (error) { return failed('UPLOAD_FAILED', error); }
      }
      try { bindUploadedMedia(clipboardData, mediaByKey); }
      catch (error) { return failed('BINDING_FAILED', error, false); }
      // Same-source classes are updated in place before the paste, because the
      // native paste keeps any class that already exists in the project.
      if (typeof adapter.syncClasses === 'function') {
        onProgress({ phase: 'syncing-classes' });
        try { await adapter.syncClasses(); }
        catch (error) { return failed('CLASS_SYNC_FAILED', error); }
      }
      onProgress({ phase: 'inserting' });
      let insertion;
      try { insertion = await adapter.insertLayer(clipboardData); }
      catch (error) { return failed('INSERT_FAILED', error); }
      onProgress({ phase: 'confirming' });
      try {
        if (!insertion?.rootTagId || !(await adapter.confirmInserted(insertion.rootTagId))) {
          return failed('CONFIRMATION_FAILED', new Error('Taptop did not confirm the inserted layer'));
        }
      } catch (error) { return failed('CONFIRMATION_FAILED', error); }
      const behaviorBindings = [];
      for (const behavior of behaviorPackages) {
        if (!behavior?.key || !behavior?.adapter || !behavior?.clipboardData) {
          return failed('BEHAVIOR_PACKAGE_INVALID', new Error('Behavior package needs key, adapter and clipboardData'), false);
        }
        onProgress({ phase: 'inserting-behavior', behaviorKey: behavior.key });
        let behaviorInsertion;
        try { behaviorInsertion = await adapter.insertBehaviorLayer(copy(behavior.clipboardData), behavior); }
        catch (error) { return failed('BEHAVIOR_INSERT_FAILED', error); }
        onProgress({ phase: 'confirming-behavior', behaviorKey: behavior.key });
        try {
          if (!behaviorInsertion?.rootTagId || !(await adapter.confirmBehaviorInserted(behaviorInsertion.rootTagId, behavior))) {
            return failed('BEHAVIOR_CONFIRMATION_FAILED', new Error(`Taptop did not confirm behavior ${behavior.key}`));
          }
        } catch (error) { return failed('BEHAVIOR_CONFIRMATION_FAILED', error); }
        behaviorBindings.push({ key: behavior.key, adapter: behavior.adapter, targetTagId: behaviorInsertion.rootTagId });
      }
      const receipt = {
        packageRevision: wrapper.sourceRevision,
        targetProjectFingerprint: await adapter.targetProjectFingerprint(),
        rootTagId: insertion.rootTagId,
        mediaBindings: assets.map(asset => ({ stableKey: asset.stableKey, targetMediaId: String(mediaByKey.get(asset.stableKey).image_id) }))
      };
      if (behaviorBindings.length) receipt.behaviorBindings = behaviorBindings;
      onProgress({ phase: 'complete', receipt });
      return { status: 'complete', phase: 'complete', receipt, error: null };
    } catch (error) {
      return failed('SESSION_UNAVAILABLE', error, false);
    }
  }

  return { bindUploadedMedia, runImportSession };
});
