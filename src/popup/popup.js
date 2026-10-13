(async () => {
  // The popup is only a fallback: inside the editor the toolbar icon opens the import dialog itself.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https:\/\/[^/]+\.taptop\.site\/-\/cms\/v1\/mosaic\//.test(tab.url || '')) return;
  const response = await chrome.runtime.sendMessage({ type: 'taptop-toolkit-control', action: 'mount-editor-importer', tabId: tab.id, open: true });
  if (response?.ok) window.close();
})();
