(function(root, factory) {
  const isModule = typeof module === 'object' && module.exports;
  const api = factory(isModule ? require('../lib/editor-host') : root.TaptopEditorHost);
  if (isModule) module.exports = api;
  else api.start(root).catch(error => console.warn('Taptop Toolkit popup', error));
})(globalThis, function(EditorHost) {
  const CONTROL = 'taptop-toolkit-control';

  // Called straight from the click handler: permissions.request needs the user gesture, so nothing is awaited before it.
  // Only the open tab's own origin is ever requested.
  function allowProjectDomain(chrome, tab) {
    const editor = EditorHost.classifyEditorUrl(tab?.url);
    if (editor?.kind !== 'project' || !tab.id) throw new Error('The active tab is not a Taptop editor on a project domain');
    return chrome.permissions.request({ origins: [EditorHost.originPattern(editor.origin)] }).then(async granted => {
      if (!granted) return { granted: false };
      const response = await chrome.runtime.sendMessage({ type: CONTROL, action: 'allow-project-domain', tabId: tab.id });
      return { granted: true, response };
    });
  }

  async function removeProjectDomain(chrome, origin) {
    const removed = await chrome.permissions.remove({ origins: [EditorHost.originPattern(origin)] });
    // permissions.onRemoved re-syncs the scripts as well; the message covers a worker that missed the event.
    await chrome.runtime.sendMessage({ type: CONTROL, action: 'forget-project-domain' });
    return removed;
  }

  async function grantedOrigins(chrome) {
    const { origins = [] } = await chrome.permissions.getAll();
    return EditorHost.grantedOrigins(origins);
  }

  async function renderAllowedDomains(win, chrome) {
    const section = win.document.getElementById('allowed-domains');
    const list = win.document.getElementById('allowed-list');
    const status = win.document.getElementById('allowed-status');
    const origins = await grantedOrigins(chrome);
    list.replaceChildren(...origins.map(origin => {
      const host = new URL(origin).hostname;
      const item = win.document.createElement('li');
      item.className = 'domain-row';
      const name = win.document.createElement('span');
      name.className = 'domain-name';
      name.textContent = host;
      const remove = win.document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-ghost btn-sm';
      remove.textContent = 'Убрать';
      remove.setAttribute('aria-label', `Убрать доступ к ${host}`);
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        status.textContent = '';
        try {
          if (!await removeProjectDomain(chrome, origin)) status.textContent = 'Не удалось убрать доступ. Уберите его в настройках расширения в Chrome.';
        } catch { status.textContent = 'Не удалось убрать доступ. Уберите его в настройках расширения в Chrome.'; }
        await renderAllowedDomains(win, chrome);
      });
      item.append(name, remove);
      return item;
    }));
    section.hidden = origins.length === 0;
    return origins;
  }

  function offerProjectDomain(win, chrome, tab, origin) {
    const section = win.document.getElementById('domain-access');
    const button = win.document.getElementById('allow-domain');
    const status = win.document.getElementById('domain-status');
    win.document.getElementById('domain-name').textContent = new URL(origin).hostname;
    section.hidden = false;
    // Returns the promise only so tests can await the click; the browser ignores it.
    button.addEventListener('click', () => {
      status.textContent = '';
      button.disabled = true;
      let pending;
      try { pending = allowProjectDomain(chrome, tab); } catch (error) { pending = Promise.reject(error); }
      return pending.then(async ({ granted, response }) => {
        if (!granted) {
          status.textContent = 'Доступ не выдан. Без него кнопки импорта на этом домене не будет.';
          return;
        }
        if (response?.ok) return win.close();
        // The status lives inside this section, so the section stays open; pressing the button again retries the mount.
        status.textContent = 'Домен разрешён, но кнопка не появилась. Перезагрузите вкладку редактора.';
      }).catch(() => {
        status.textContent = 'Не удалось выдать доступ. Попробуйте ещё раз.';
      }).finally(async () => {
        button.disabled = false;
        await renderAllowedDomains(win, chrome).catch(() => {});
      });
    });
  }

  // The popup is a fallback: inside the editor the toolbar icon opens the import dialog itself.
  async function start(win) {
    const chrome = win.chrome;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await renderAllowedDomains(win, chrome);
    const editor = EditorHost.classifyEditorUrl(tab?.url);
    if (!tab?.id || !editor) return;
    if (editor.kind === 'project' && !await chrome.permissions.contains({ origins: [EditorHost.originPattern(editor.origin)] })) {
      offerProjectDomain(win, chrome, tab, editor.origin);
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: CONTROL, action: 'mount-editor-importer', tabId: tab.id, open: true });
    if (response?.ok) win.close();
  }

  return { allowProjectDomain, removeProjectDomain, start };
});
