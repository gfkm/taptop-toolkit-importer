(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaptopEditorContext = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function() {
  function isTaptopHost(hostname) {
    return typeof hostname === 'string' && (hostname === 'taptop.site' || hostname.endsWith('.taptop.site'));
  }

  function classifyEditorContext(context) {
    if (!isTaptopHost(context?.hostname)) {
      return {
        supported: false,
        status: 'wrong-site',
        message: 'Откройте редактор на домене Taptop и повторите проверку.'
      };
    }

    if (!context?.hasEditorShell) {
      return {
        supported: false,
        status: 'not-editor',
        message: 'Это страница Taptop, но редактор на ней не найден.'
      };
    }

    return {
      supported: true,
      status: 'ready-to-probe',
      message: 'Редактор Taptop найден. Импорт пока не включён.'
    };
  }

  return { classifyEditorContext };
});
