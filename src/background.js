importScripts('lib/editor-host.js');

const DEFAULT_POPUP = 'popup/popup.html';
const EditorHost = globalThis.TaptopEditorHost;

// Taptop's own hosts are granted by the manifest; a project's own domain counts only while the person's grant holds.
async function isTaptopEditorUrl(value) {
  const editor = EditorHost.classifyEditorUrl(value);
  if (!editor) return false;
  if (editor.kind === 'taptop') return true;
  return chrome.permissions.contains({ origins: [EditorHost.originPattern(editor.origin)] });
}

const warn = (what, error) => console.warn(`Taptop Toolkit: ${what}`, error);

// Makes the registered content scripts match the granted project origins: one persistent script per origin,
// none for a revoked one. Serialized, so overlapping grant events cannot register the same id twice. Each origin is
// registered on its own, so one rejected pattern does not block the rest; resolves to { failed: [origin, …] }.
let projectScriptsQueue = Promise.resolve();
function syncProjectEditorScripts() {
  const run = projectScriptsQueue.then(async () => {
    const { origins = [] } = await chrome.permissions.getAll();
    const granted = EditorHost.grantedOrigins(origins);
    const ours = (await chrome.scripting.getRegisteredContentScripts()).map(script => script.id).filter(id => EditorHost.originFromScriptId(id));
    const stale = ours.filter(id => !granted.includes(EditorHost.originFromScriptId(id)));
    if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
    const failed = [];
    for (const origin of granted.filter(item => !ours.includes(EditorHost.contentScriptId(item)))) {
      try {
        await chrome.scripting.registerContentScripts([{
          id: EditorHost.contentScriptId(origin),
          matches: [EditorHost.contentScriptMatch(origin)],
          js: ['editor/auto-mount.js'],
          runAt: 'document_idle',
          persistAcrossSessions: true
        }]);
      } catch (error) {
        failed.push(origin);
        warn(`content script for ${origin} was not registered`, error);
      }
    }
    return { failed };
  });
  projectScriptsQueue = run.catch(() => {});
  return run;
}

async function mountImporter(tabId, url, { open = false } = {}) {
  if (!await isTaptopEditorUrl(url)) throw new Error('Откройте проект в редакторе Taptop.');
  await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['lib/class-sync.js', 'editor/taptop-runtime-adapter.js'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/external-classes.js', 'lib/package-inspector.js', 'lib/import-session.js', 'lib/class-conflicts.js', 'lib/class-sync.js', 'lib/import-planner.js', 'editor/import-ui.js', 'editor/mount-importer.js'] });
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

// Registered scripts persist across browser restarts; re-syncing on start and install also repairs a grant or a
// removal that happened while the worker was not running. Removal in Chrome's own settings arrives as onRemoved.
const resyncProjectEditorScripts = () => syncProjectEditorScripts().catch(error => warn('project domain scripts were not updated', error));
chrome.permissions.onAdded.addListener(async permissions => {
  await resyncProjectEditorScripts();
  // The popup can close while Chrome shows the permission prompt, and then its allow message never arrives:
  // start the importer the usual way (auto-mount asks for the mount) in editor tabs of the new origins already open.
  for (const origin of EditorHost.grantedOrigins(permissions?.origins)) {
    try {
      const tabs = await chrome.tabs.query({ url: EditorHost.contentScriptMatch(origin) });
      for (const tab of tabs) await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['editor/auto-mount.js'] });
    } catch (error) { warn(`open editor tabs of ${origin} were not started`, error); }
  }
});
chrome.permissions.onRemoved.addListener(resyncProjectEditorScripts);
chrome.runtime.onStartup.addListener(resyncProjectEditorScripts);
chrome.runtime.onInstalled.addListener(resyncProjectEditorScripts);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'taptop-toolkit-control' && message.action === 'mount-editor-importer') {
      const tabId = sender.tab?.id || message.tabId;
      if (!tabId) throw new Error('Не удалось определить вкладку редактора.');
      const tab = sender.tab || await chrome.tabs.get(tabId);
      return mountImporter(tabId, tab.url, { open: Boolean(message.open) });
    }
    // allow / forget come from the popup only, which has no sender.tab; a page's content script is refused.
    if (message?.type === 'taptop-toolkit-control' && message.action === 'allow-project-domain') {
      if (sender.tab) throw new Error('Разрешить домен можно только из окна расширения.');
      // Sent after permissions.request: the origin is read from the tab here and the grant re-checked.
      const tab = await chrome.tabs.get(message.tabId);
      const editor = EditorHost.classifyEditorUrl(tab?.url);
      if (editor?.kind !== 'project' || !await isTaptopEditorUrl(tab.url)) throw new Error('Доступ к этому домену не выдан.');
      const { failed } = await syncProjectEditorScripts();
      if (failed.includes(editor.origin)) throw new Error('Не удалось включить расширение на этом домене.');
      return mountImporter(tab.id, tab.url, { open: true });
    }
    if (message?.type === 'taptop-toolkit-control' && message.action === 'forget-project-domain') {
      if (sender.tab) throw new Error('Убрать домен можно только из окна расширения.');
      await syncProjectEditorScripts();
      return undefined;
    }
    if (message?.type !== 'taptop-toolkit-runtime' || !sender.tab?.id || !await isTaptopEditorUrl(sender.tab.url)) return undefined;
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
