(() => {
  function requestRuntime(action, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'taptop-toolkit-runtime', action, payload }, response => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else if (response?.ok) resolve(response.result);
        else reject(new Error(response?.error || 'Taptop editor operation failed'));
      });
    });
  }

  function extensionForMimeType(mimeType) {
    return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' })[mimeType] || 'image';
  }

  async function uploadEmbeddedAsset(asset) {
    if (!asset?.data || !asset?.mimeType || !asset?.sha256) throw new Error('Embedded image is incomplete');
    const binary = atob(asset.data);
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    const query = new URLSearchParams(window.location.search);
    const versionId = query.get('ver_id');
    const access = query.get('access');
    if (!versionId || !access) throw new Error('Taptop editor URL has no version access');
    const form = new FormData();
    form.append('image', new Blob([bytes], { type: asset.mimeType }), `taptop-${asset.sha256.slice(0, 12)}.${extensionForMimeType(asset.mimeType)}`);
    form.append('folder_id', '0');
    const requestId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const endpoint = `${window.location.origin}/-/x-api/v1/protected/?method=mosaic/uploadDesignImage&ver_id=${encodeURIComponent(versionId)}&access=${encodeURIComponent(access)}&request_id=${encodeURIComponent(requestId)}`;
    const response = await fetch(endpoint, { method: 'POST', body: form, credentials: 'include' });
    const raw = await response.text();
    let json = null;
    try { json = JSON.parse(raw); } catch {}
    const result = json?.result || json?.data?.result || json?.data || null;
    if (!response.ok || !result?.id) throw new Error(`Taptop did not confirm image upload (${response.status})`);
    return { filename: result.filename, image_id: Number(result.id), src: result.src, ver_id: Number(versionId), ext: result.ext, image_height: Number(result.height), image_width: Number(result.width), size: Number(result.size) };
  }

  // `details` is structured data for the UI, e.g. { missing: [class names] }.
  function codedError(code, message, retryable, details = undefined) {
    const error = new Error(message);
    error.code = code;
    error.retryable = retryable;
    if (details !== undefined) error.details = details;
    return error;
  }

  function receiptStore() {
    try { return globalThis.TaptopClassSync.createReceiptStore(window.localStorage); }
    catch (error) { console.warn('[Taptop Toolkit] receipts unavailable', error); return null; }
  }

  function syncIdentity(wrapper) {
    const sync = wrapper.syncPackage;
    const targetKey = globalThis.TaptopClassSync.targetKeyFor(window.location);
    return targetKey && sync ? { targetKey, namespace: sync.namespace, componentKey: sync.componentKey } : null;
  }

  // Classes from an earlier import of this file are updated in place; see TaptopImportPlanner.
  async function planClasses(wrapper, decisions) {
    const identity = syncIdentity(wrapper);
    const store = identity ? receiptStore() : null;
    let receipt = null;
    try { receipt = store?.loadReceipt(identity) || null; }
    catch (error) { console.warn('[Taptop Toolkit] receipt unreadable', error); }
    const plan = await globalThis.TaptopImportPlanner.planImport({
      wrapper, decisions, targetKey: identity?.targetKey || null, receipt,
      observe: (classes, bindings) => requestRuntime('observe-classes', { classes, bindings }),
      lookup: query => requestRuntime('classes', query)
    });
    return { ...plan, identity, store };
  }

  // The message is for logs; the UI formats the names from `details`.
  const refusalMessage = refused => `${refused.code}: ${refused.missing.join(', ')}`;
  const refusalDetails = refused => ({ missing: [...refused.missing] });

  // Review: same-name project classes are listed for the user's choice
  // (copy, keep the existing one, update) instead of being decided here.
  async function inspectFile(file) {
    const packageText = await file.text();
    const report = await globalThis.TaptopPackageInspector.inspectPackage({ packageText });
    if (!report.ok) return report;
    const plan = await planClasses(JSON.parse(packageText), null);
    if (plan.refused) return { ...report, ok: false, errors: [refusalMessage(plan.refused)], warnings: [], details: refusalDetails(plan.refused) };
    return { ...report, classes: plan.classes };
  }

  // The write-time re-check of site classes; the import session calls it before any upload.
  // `list` is the session's validated declaration list.
  async function missingExternalClasses(list) {
    const external = globalThis.TaptopExternalClasses;
    const check = external.missing(list, await requestRuntime('classes', external.query(list)));
    if (!check.available) throw new Error('EXTERNAL_CLASSES_UNVERIFIED: Taptop did not report the site classes');
    return check.missing;
  }

  async function importFile(file, controller, decisions = { adopt: 'copy', conflicts: 'take' }) {
    const packageText = await file.text();
    const inspection = await globalThis.TaptopPackageInspector.inspectPackage({ packageText });
    if (!inspection.ok) throw codedError('PACKAGE_INVALID', inspection.errors?.[0] || 'Package validation failed', false);
    let probe;
    try { probe = await requestRuntime('probe'); }
    catch (error) { throw codedError('EDITOR_UNAVAILABLE', error.message, true); }
    if (!probe?.ok) throw codedError('EDITOR_UNAVAILABLE', probe?.message || 'Taptop editor API is unavailable', true);
    const plan = await planClasses(JSON.parse(packageText), decisions);
    if (plan.refused) throw codedError(plan.refused.code, refusalMessage(plan.refused), plan.refused.code === 'EXTERNAL_CLASSES_UNVERIFIED', refusalDetails(plan.refused));
    if (plan.resolved?.blockers?.length) throw codedError('CLASS_SYNC_FAILED', 'Class decisions are incomplete', true);
    const pending = globalThis.TaptopImportPlanner.pendingPlans(plan.resolved);
    // Checked before any image is uploaded: such a class would fail the sync later.
    const created = pending.filter(item => item.classAction.type === 'create').map(item => ({ name: item.name, collection: item.collection }));
    const respelled = created.length ? await requestRuntime('check-class-names', { classes: created }) : [];
    if (respelled.length) {
      console.warn('[Taptop Toolkit] class names Taptop would store differently', JSON.stringify(respelled));
      throw codedError('CLASS_NAME_RESPELLED', `Taptop would store class ${respelled[0].name} as ${respelled[0].stored}`, false);
    }
    let applied = [];
    const adapter = {
      async targetProjectFingerprint() { return (await requestRuntime('probe')).fingerprint; },
      async prepareAsset(asset) { return asset; }, uploadAsset: uploadEmbeddedAsset, missingExternalClasses,
      async insertLayer(clipboardData) { return requestRuntime('insert', { clipboardData }); },
      async confirmInserted(rootTagId) { return requestRuntime('confirm', { rootTagId }); },
      async insertBehaviorLayer(clipboardData) { return requestRuntime('insert-behavior', { clipboardData }); },
      async confirmBehaviorInserted(rootTagId) { return requestRuntime('confirm-behavior', { rootTagId }); }
    };
    // Classes are created and updated before the paste, which then links to them by name.
    if (plan.resolved) {
      adapter.syncClasses = async () => {
        if (!pending.length) return;
        const result = await requestRuntime('apply-class-plans', { plans: pending });
        applied = result.applied || [];
        const respelled = applied.flatMap(item => item.respelled || []);
        if (respelled.length) console.info('[Taptop Toolkit] Taptop stored these values in its own spelling', JSON.stringify(respelled));
        if (result.failures?.length) {
          // Keep a structured, redacted diagnostic in DevTools. The UI stays
          // concise, but this makes a live editor API mismatch reproducible.
          console.warn('[Taptop Toolkit] class sync failures', JSON.stringify(result.failures));
          const first = result.failures[0];
          throw new Error(`Taptop did not apply class ${first.name}: ${first.message}`);
        }
      };
    }
    const result = await globalThis.TaptopImportSession.runImportSession({ wrapper: plan.wrapper, adapter, onProgress(event) {
      if (event.phase === 'preparing' || event.phase === 'uploading') controller.setProgress(event.phase, { done: event.current - 1, total: event.total });
      if (['syncing-classes', 'inserting', 'confirming', 'inserting-behavior', 'confirming-behavior'].includes(event.phase)) controller.setProgress(event.phase);
    } });
    if (plan.resolved && plan.store && (result.status === 'complete' || applied.length)) {
      // Bindings are kept even after a failed paste: the classes now exist in Taptop.
      try {
        const sync = globalThis.TaptopClassSync;
        const appliedKeys = new Set(applied.map(item => item.stableKey));
        const settled = { ...plan.resolved, plans: plan.resolved.plans.filter(item => item.classAction.targetClassId || appliedKeys.has(item.stableKey)) };
        let next = sync.nextReceipt({ preview: settled, packageData: plan.wrapper.syncPackage, receipt: plan.receipt, applied });
        if (result.status === 'complete') next = sync.bindRoot(next, plan.wrapper.syncPackage, result.receipt.rootTagId);
        plan.store.saveReceipt(next);
      } catch (error) { console.warn('[Taptop Toolkit] receipt not saved', error); }
    }
    if (result.status !== 'complete') {
      console.warn('[Taptop Toolkit] import failed', result.error);
      throw codedError(result.error?.code, result.error?.message || 'Import failed', result.error?.retryable, result.error?.details);
    }
    controller.complete(result.receipt);
    return result.receipt;
  }

  function loadFont() {
    if (globalThis.__taptopToolkitFont) return;
    try {
      const face = new FontFace('TT Inter', `url("${chrome.runtime.getURL('fonts/InterVariable.woff2')}") format("woff2")`, { weight: '100 900', style: 'normal', display: 'swap' });
      document.fonts.add(face);
      globalThis.__taptopToolkitFont = face;
      face.load().catch(error => console.warn('[Taptop Toolkit] font failed to load', error));
    } catch (error) { console.warn('[Taptop Toolkit] font unavailable', error); }
  }

  // Taptop's help circle is the reference: same size and left edge, 16px above it.
  // `.tt-help` itself is a 0x0 fixed wrapper, so measure the visible button inside it.
  function helpCircle() {
    return [...document.querySelectorAll('.tt-help button, .tt-help .tt-help__button')]
      .map(element => element.getBoundingClientRect())
      .find(rect => rect.width > 0 && rect.height > 0) || null;
  }

  function alignLauncher(host) {
    const placement = globalThis.TaptopImporterUI.launcherPlacement(helpCircle());
    for (const name of ['size', 'left', 'top']) {
      const property = `--tt-launcher-${name}`;
      if (placement) host.style.setProperty(property, `${placement[name]}px`);
      else host.style.removeProperty(property);
    }
    for (const name of ['right', 'bottom']) {
      if (placement) host.style.setProperty(`--tt-launcher-${name}`, 'auto');
      else host.style.removeProperty(`--tt-launcher-${name}`);
    }
  }

  function keepAligned(host) {
    const update = () => {
      if (!host.isConnected) { clearInterval(timer); window.removeEventListener('resize', update); return; }
      alignLauncher(host);
    };
    const timer = setInterval(update, 1000);
    window.addEventListener('resize', update);
    update();
  }

  function mount() {
    const existing = document.querySelector('[data-taptop-toolkit-importer]');
    if (existing && globalThis.__taptopToolkitImporter) return { mounted: false };
    existing?.remove();
    loadFont();
    const host = document.createElement('taptop-toolkit-importer');
    host.dataset.taptopToolkitImporter = 'true';
    host.style.setProperty('visibility', 'hidden');
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = chrome.runtime.getURL('editor/import-ui.css');
    sheet.addEventListener('load', () => host.style.removeProperty('visibility'), { once: true });
    root.append(sheet);
    document.body.append(host);
    keepAligned(host);
    globalThis.__taptopToolkitImporter = globalThis.TaptopImporterUI.createImporterUI({
      root, backendAvailable: true,
      onFileSelected: inspectFile,
      onImport: importFile, onRetry: importFile
    });
    return { mounted: true };
  }

  function open() {
    mount();
    globalThis.__taptopToolkitImporter?.show();
    return { opened: true };
  }

  globalThis.TaptopToolkitImporter = { mount, open };
})();
