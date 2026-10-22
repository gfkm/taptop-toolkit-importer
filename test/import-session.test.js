const assert = require('node:assert/strict');
const test = require('node:test');

const { runImportSession } = require('../src/lib/import-session');

function wrapper() {
  return {
    sourceRevision: 'a'.repeat(64),
    clipboardData: {
      copiedLayout: {
        tree: {
          tags: {
            root: { id: 'root' },
            image: { id: 'image', widgetName: 'image__img', data: {}, __pendingUpload: { assetKey: 'asset/pixel' } }
          }
        }
      }
    },
    embeddedAssets: [{ stableKey: 'asset/pixel', mimeType: 'image/png', data: 'cGl4ZWw=' }]
  };
}

function adapter(overrides = {}) {
  return {
    targetProjectFingerprint: () => 'demo:design:1:version:2',
    prepareAsset: async asset => ({ ...asset, bytes: Buffer.from(asset.data, 'base64') }),
    uploadAsset: async prepared => ({ image_id: 7, src: 'https://cdn.example/pixel.png', filename: 'pixel.png', ext: 'png', stableKey: prepared.stableKey }),
    insertLayer: async clipboardData => {
      assert.equal(clipboardData.copiedLayout.tree.tags.image.data.src.value.image_id, 7);
      assert.equal(clipboardData.copiedLayout.tree.tags.image.__pendingUpload, undefined);
      return { rootTagId: 'inserted-root' };
    },
    confirmInserted: async rootTagId => rootTagId === 'inserted-root',
    ...overrides
  };
}

test('imports every asset before insertion and returns a receipt only after root confirmation', async () => {
  const phases = [];
  const result = await runImportSession({
    wrapper: wrapper(),
    adapter: adapter(),
    onProgress: event => phases.push(event)
  });

  assert.equal(result.status, 'complete');
  assert.deepEqual(result.receipt, {
    packageRevision: 'a'.repeat(64),
    targetProjectFingerprint: 'demo:design:1:version:2',
    rootTagId: 'inserted-root',
    mediaBindings: [{ stableKey: 'asset/pixel', targetMediaId: '7' }]
  });
  assert.deepEqual(phases.map(item => item.phase), ['checking', 'preparing', 'uploading', 'inserting', 'confirming', 'complete']);
});

test('does not insert a partial layer when an upload fails', async () => {
  let inserted = false;
  const result = await runImportSession({
    wrapper: wrapper(),
    adapter: adapter({
      uploadAsset: async () => { throw new Error('network unavailable'); },
      insertLayer: async () => { inserted = true; }
    })
  });

  assert.deepEqual(result, {
    status: 'failed',
    phase: 'failed',
    receipt: null,
    error: { code: 'UPLOAD_FAILED', message: 'network unavailable', retryable: true }
  });
  assert.equal(inserted, false);
});

test('does not create a receipt when Taptop cannot confirm the inserted root', async () => {
  const result = await runImportSession({ wrapper: wrapper(), adapter: adapter({ confirmInserted: async () => false }) });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'CONFIRMATION_FAILED');
  assert.equal(result.receipt, null);
});

test('does not insert a layer when an upload has no target media identifier', async () => {
  let inserted = false;
  const result = await runImportSession({
    wrapper: wrapper(),
    adapter: adapter({
      uploadAsset: async () => ({ src: 'https://cdn.example/pixel.png' }),
      insertLayer: async () => { inserted = true; }
    })
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'UPLOAD_FAILED');
  assert.equal(inserted, false);
});

test('inserts each behavior package only after the Root layer is confirmed', async () => {
  const events = [];
  const packageWithBehavior = wrapper();
  packageWithBehavior.behaviorPackages = [{
    key: 'behavior/faq-accordion',
    adapter: 'taptop/embed-accordion-v1',
    clipboardData: { tagID: 'embed', copiedLayout: { tree: { root: 'embed', tags: { embed: { id: 'embed', widgetName: 'tt_embed' } } } } }
  }];
  const result = await runImportSession({
    wrapper: packageWithBehavior,
    adapter: adapter({
      insertLayer: async () => { events.push('root-insert'); return { rootTagId: 'inserted-root' }; },
      confirmInserted: async () => { events.push('root-confirm'); return true; },
      insertBehaviorLayer: async (clipboardData, behavior) => {
        events.push(`${behavior.key}:${clipboardData.tagID}`);
        return { rootTagId: 'inserted-embed' };
      },
      confirmBehaviorInserted: async (tagId, behavior) => {
        events.push(`${behavior.key}:${tagId}:confirm`);
        return true;
      }
    })
  });

  assert.equal(result.status, 'complete');
  assert.deepEqual(events, [
    'root-insert', 'root-confirm', 'behavior/faq-accordion:embed', 'behavior/faq-accordion:inserted-embed:confirm'
  ]);
  assert.deepEqual(result.receipt.behaviorBindings, [{
    key: 'behavior/faq-accordion', adapter: 'taptop/embed-accordion-v1', targetTagId: 'inserted-embed'
  }]);
});

test('does not create a complete receipt when a behavior layer is unconfirmed', async () => {
  const packageWithBehavior = wrapper();
  packageWithBehavior.behaviorPackages = [{
    key: 'behavior/faq-accordion', adapter: 'taptop/embed-accordion-v1', clipboardData: { tagID: 'embed' }
  }];
  const result = await runImportSession({
    wrapper: packageWithBehavior,
    adapter: adapter({
      insertBehaviorLayer: async () => ({ rootTagId: 'inserted-embed' }),
      confirmBehaviorInserted: async () => false
    })
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'BEHAVIOR_CONFIRMATION_FAILED');
  assert.equal(result.receipt, null);
});

test('syncs classes after uploads and before inserting the layers', async () => {
  const order = [];
  const phases = [];
  const result = await runImportSession({
    wrapper: wrapper(),
    adapter: adapter({
      uploadAsset: async prepared => { order.push('upload'); return { image_id: 7, stableKey: prepared.stableKey }; },
      syncClasses: async () => { order.push('sync'); return { applied: 3 }; },
      insertLayer: async () => { order.push('insert'); return { rootTagId: 'inserted-root' }; }
    }),
    onProgress: event => phases.push(event.phase)
  });
  assert.equal(result.status, 'complete');
  assert.deepEqual(order, ['upload', 'sync', 'insert']);
  assert.deepEqual(phases, ['checking', 'preparing', 'uploading', 'syncing-classes', 'inserting', 'confirming', 'complete']);
});

test('a class sync failure stops before insertion with a retryable error', async () => {
  let inserted = false;
  const result = await runImportSession({
    wrapper: wrapper(),
    adapter: adapter({
      syncClasses: async () => { throw new Error('CSS readback mismatch'); },
      insertLayer: async () => { inserted = true; return { rootTagId: 'x' }; }
    })
  });
  assert.equal(inserted, false);
  assert.equal(result.error.code, 'CLASS_SYNC_FAILED');
  assert.equal(result.error.retryable, true);
});

// Toolkit `externalClasses`: target-site classes that layers use by name.
function externalWrapper() {
  return { ...wrapper(), externalClasses: [{ name: 'site-body', collection: 'main' }, { name: 'site-title', collection: 'main' }] };
}

function recordingAdapter(overrides = {}) {
  const calls = [];
  const record = (name, value) => async (...args) => { calls.push(name); return typeof value === 'function' ? value(...args) : value; };
  const fake = adapter({
    prepareAsset: record('prepare', asset => asset),
    uploadAsset: record('upload', { image_id: 7 }),
    syncClasses: record('sync', { applied: 0 }),
    insertLayer: record('insert', { rootTagId: 'inserted-root' }),
    insertBehaviorLayer: record('insert-behavior', { rootTagId: 'b' }),
    confirmBehaviorInserted: record('confirm-behavior', true),
    ...overrides
  });
  return { fake, calls };
}

test('a missing site class stops the import before any upload, sync or insertion', async () => {
  const { fake, calls } = recordingAdapter({ missingExternalClasses: async list => { assert.deepEqual(list.map(item => item.name), ['site-body', 'site-title']); return ['site-title']; } });
  const result = await runImportSession({ wrapper: externalWrapper(), adapter: fake });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'EXTERNAL_CLASSES_MISSING');
  assert.equal(result.error.message, 'EXTERNAL_CLASSES_MISSING: site-title');
  assert.deepEqual(result.error.details, { missing: ['site-title'] }, 'the names travel as data, not only in the message');
  assert.equal(result.error.retryable, false);
  assert.deepEqual(calls, []);
});

test('site classes that cannot be checked stop the import before any write', async () => {
  for (const missingExternalClasses of [undefined, async () => { throw new Error('editor gone'); }, async () => 'yes']) {
    const { fake, calls } = recordingAdapter({ missingExternalClasses });
    if (!missingExternalClasses) delete fake.missingExternalClasses;
    const result = await runImportSession({ wrapper: externalWrapper(), adapter: fake });
    assert.equal(result.error.code, 'EXTERNAL_CLASSES_UNVERIFIED');
    assert.deepEqual(calls, []);
  }
});

test('a malformed externalClasses declaration is an invalid package, never "no site classes"', async () => {
  for (const externalClasses of [{ name: 'site-title', collection: 'main' }, 'site-title', null, [{ collection: 'main' }], ['site-title'], [{ name: 'site-title', collection: 'cm' }], [{ name: 'site-b', collection: 'main' }, { name: 'site-a', collection: 'main' }]]) {
    const { fake, calls } = recordingAdapter({ missingExternalClasses: async () => [] });
    const result = await runImportSession({ wrapper: { ...wrapper(), externalClasses }, adapter: fake });
    assert.equal(result.status, 'failed', JSON.stringify(externalClasses));
    assert.equal(result.error.code, 'EXTERNAL_CLASSES_INVALID');
    assert.match(result.error.message, /^EXTERNAL_CLASSES_INVALID: externalClasses/);
    assert.equal(result.error.retryable, false);
    assert.deepEqual(calls, []);
  }
});

test('without the external-classes module the session stops before any write, for every package', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  // The session as a browser would load it: no require, no TaptopExternalClasses.
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/lib/import-session.js'), 'utf8'), context);
  for (const pkg of [wrapper(), externalWrapper()]) {
    const { fake, calls } = recordingAdapter({ missingExternalClasses: async () => [] });
    const result = await context.TaptopImportSession.runImportSession({ wrapper: pkg, adapter: fake });
    assert.equal(result.error.code, 'SESSION_UNAVAILABLE');
    assert.equal(result.error.message, 'IMPORT_MODULE_MISSING: external-classes');
    assert.equal(result.error.retryable, false);
    assert.deepEqual(calls, []);
  }
});

test('present site classes let the import run in the usual order', async () => {
  const { fake, calls } = recordingAdapter({ missingExternalClasses: async () => [] });
  const result = await runImportSession({ wrapper: externalWrapper(), adapter: fake });
  assert.equal(result.status, 'complete');
  assert.deepEqual(calls, ['prepare', 'upload', 'sync', 'insert']);
});
