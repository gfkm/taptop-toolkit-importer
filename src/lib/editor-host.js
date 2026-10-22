// The one rule for where the Taptop editor runs. Loaded by the background worker (importScripts) and the popup
// (<script>); tests require it. The manifest's static entries cover *.taptop.site only; a project's own domain is an
// https origin the person granted from the popup.
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TaptopEditorHost = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function() {
  const TAPTOP_SITE = 'taptop.site';
  const EDITOR_PATH = '/-/cms/v1/mosaic/';
  const SCRIPT_ID_PREFIX = 'project-editor:';
  // A DNS name of two or more labels; each label is letters, digits and inner hyphens; the last one starts with a
  // letter, which refuses IPv4 in every notation the URL parser turns into dotted decimal (0x7f.1, 2130706433), and
  // single-label hosts such as localhost. No trailing dot, no IPv6 brackets, no port. IDNs arrive as punycode (xn--…).
  const DNS_HOST = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
  // What originPattern() produces and permissions.request grants: one host, path /*.
  const SINGLE_HOST_PATTERN = /^https:\/\/([^/*:]+)\/\*$/;

  function hostOf(origin) {
    const host = /^https:\/\/([^/:]+)$/.exec(origin || '')?.[1];
    return host && DNS_HOST.test(host) ? host : null;
  }

  function isTaptopSiteHost(hostname) {
    return typeof hostname === 'string' && (hostname === TAPTOP_SITE || hostname.endsWith(`.${TAPTOP_SITE}`));
  }

  // { kind: 'taptop' | 'project', origin } for an https editor URL on the default port, otherwise null.
  // 'project' says only that the URL looks like the editor; whether that origin is allowed is the caller's grant check.
  function classifyEditorUrl(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.protocol !== 'https:' || url.port || url.username || url.password || !url.pathname.startsWith(EDITOR_PATH)) return null;
    if (!hostOf(url.origin)) return null;
    return { kind: isTaptopSiteHost(url.hostname) ? 'taptop' : 'project', origin: url.origin };
  }

  const originPattern = origin => `${origin}/*`;
  const contentScriptMatch = origin => `${origin}${EDITOR_PATH}*`;
  const contentScriptId = origin => `${SCRIPT_ID_PREFIX}${hostOf(origin)}`;

  function originFromScriptId(id) {
    if (typeof id !== 'string' || !id.startsWith(SCRIPT_ID_PREFIX)) return null;
    const origin = `https://${id.slice(SCRIPT_ID_PREFIX.length)}`;
    return hostOf(origin) ? origin : null;
  }

  // Project origins from chrome.permissions.getAll().origins: single-host https grants, Taptop's own hosts excluded.
  function grantedOrigins(patterns) {
    const origins = new Set();
    for (const pattern of patterns || []) {
      const match = SINGLE_HOST_PATTERN.exec(pattern);
      const host = match && hostOf(`https://${match[1]}`);
      if (host && !isTaptopSiteHost(host)) origins.add(`https://${host}`);
    }
    return [...origins].sort();
  }

  return { EDITOR_PATH, isTaptopSiteHost, classifyEditorUrl, originPattern, contentScriptMatch, contentScriptId, originFromScriptId, grantedOrigins };
});
