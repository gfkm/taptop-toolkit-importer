const DEFAULT_POPUP = 'popup/popup.html';

function isTaptopEditorUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.endsWith('.taptop.site') && url.pathname.startsWith('/-/cms/v1/mosaic/');
  } catch { return false; }
}

async function mountImporter(tabId, url, { open = false } = {}) {
  if (!isTaptopEditorUrl(url)) throw new Error('Откройте проект в редакторе Taptop.');
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['lib/class-sync.js', 'editor/taptop-runtime-adapter.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/package-inspector.js', 'lib/import-session.js', 'lib/class-conflicts.js', 'lib/class-sync.js', 'lib/import-planner.js', 'editor/import-ui.js', 'editor/mount-importer.js'] });
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId }, args: [open],
    func: shouldOpen => shouldOpen ? globalThis.TaptopToolkitImporter.open() : globalThis.TaptopToolkitImporter.mount()
  });
  // In the editor the toolbar icon opens the dialog directly instead of the help popup.
  await chrome.action.setPopup({ tabId, popup: '' });
  return result;
}

chrome.action.onClicked.addListener(tab => {
  if (!tab?.id) return;
  mountImporter(tab.id, tab.url, { open: true }).catch(async () => {
    await chrome.action.setPopup({ tabId: tab.id, popup: DEFAULT_POPUP });
    chrome.action.openPopup?.().catch(() => {});
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') chrome.action.setPopup({ tabId, popup: DEFAULT_POPUP }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'taptop-toolkit-control' && message.action === 'mount-editor-importer') {
      const tabId = sender.tab?.id || message.tabId;
      if (!tabId) throw new Error('Не удалось определить вкладку редактора.');
      const tab = sender.tab || await chrome.tabs.get(tabId);
      return mountImporter(tabId, tab.url, { open: Boolean(message.open) });
    }
    if (message?.type !== 'taptop-toolkit-runtime' || !sender.tab?.id || !isTaptopEditorUrl(sender.tab.url)) return undefined;
    const tabId = sender.tab.id;
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['lib/class-sync.js', 'editor/taptop-runtime-adapter.js'] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: (action, payload) => {
        const adapter = globalThis.TaptopRuntimeAdapter;
        if (!adapter) throw new Error('Taptop runtime adapter was not loaded');
        if (action === 'probe') return adapter.probe();
        if (action === 'classes') return adapter.classes(payload);
        if (action === 'observe-classes') return adapter.observeClasses(adapter.resolveEditor(), payload);
        if (action === 'check-class-names') return adapter.respelledClassNames(adapter.resolveEditor(), payload);
        if (action === 'apply-class-plans') return adapter.applyClassPlans(adapter.resolveEditor(), payload);
        if (action === 'insert') return adapter.insert(payload?.clipboardData);
        if (action === 'confirm') return adapter.confirm(payload?.rootTagId);
        if (action === 'insert-behavior') return adapter.insertBehavior(payload?.clipboardData);
        if (action === 'confirm-behavior') return adapter.confirm(payload?.rootTagId);
        throw new Error('Unknown Taptop runtime action');
      }, args: [message.action, message.payload || {}]
    });
    return result;
  })().then(result => sendResponse({ ok: true, result })).catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
