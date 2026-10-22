const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const src = path.join(__dirname, '..', 'src');
const read = file => fs.readFileSync(path.join(src, file), 'utf8');
const EditorHost = require('../src/lib/editor-host');
// Objects built inside the vm context have that context's prototypes; compare them as plain data.
const plain = value => value === undefined ? value : JSON.parse(JSON.stringify(value));

const ORIGIN = 'https://editor.example.com';
const PATTERN = 'https://editor.example.com/*';
const SCRIPT_ID = 'project-editor:editor.example.com';
const EDITOR_URL = 'https://editor.example.com/-/cms/v1/mosaic/?ver_id=1';

test('the shared rule tells a Taptop editor, a project-domain editor and anything else apart', () => {
  assert.deepEqual(EditorHost.classifyEditorUrl('https://site-1.taptop.site/-/cms/v1/mosaic/?ver_id=1'), { kind: 'taptop', origin: 'https://site-1.taptop.site' });
  assert.deepEqual(EditorHost.classifyEditorUrl(EDITOR_URL), { kind: 'project', origin: ORIGIN });
  for (const url of ['http://editor.example.com/-/cms/v1/mosaic/', 'https://editor.example.com/', 'https://editor.example.com/-/cms/v2/mosaic/',
    'https://editor.example.com:8443/-/cms/v1/mosaic/', 'chrome://extensions/', 'not a url', undefined]) {
    assert.equal(EditorHost.classifyEditorUrl(url), null, String(url));
  }
  assert.equal(EditorHost.originPattern(ORIGIN), PATTERN);
  assert.equal(EditorHost.contentScriptId(ORIGIN), SCRIPT_ID);
  assert.equal(EditorHost.originFromScriptId(SCRIPT_ID), ORIGIN);
  assert.equal(EditorHost.originFromScriptId('someone-else'), null);
  assert.equal(EditorHost.contentScriptMatch(ORIGIN), 'https://editor.example.com/-/cms/v1/mosaic/*');
});

test('a project origin is a DNS name: IP literals, single labels and trailing dots are refused', () => {
  for (const url of ['https://127.0.0.1/-/cms/v1/mosaic/', 'https://0x7f.1/-/cms/v1/mosaic/', 'https://2130706433/-/cms/v1/mosaic/',
    'https://[::1]/-/cms/v1/mosaic/', 'https://localhost/-/cms/v1/mosaic/', 'https://intranet/-/cms/v1/mosaic/',
    'https://example.com./-/cms/v1/mosaic/', 'https://x.taptop.site./-/cms/v1/mosaic/', 'https://-bad.example.com/-/cms/v1/mosaic/',
    'https://a..example.com/-/cms/v1/mosaic/', 'https://example.1x/-/cms/v1/mosaic/']) {
    assert.equal(EditorHost.classifyEditorUrl(url), null, url);
  }
  assert.deepEqual(EditorHost.classifyEditorUrl('https://xn--80ak6aa92e.xn--p1ai/-/cms/v1/mosaic/'), { kind: 'project', origin: 'https://xn--80ak6aa92e.xn--p1ai' });
  assert.deepEqual(EditorHost.grantedOrigins(['https://127.0.0.1/*', 'https://localhost/*', 'https://example.com./*', 'https://x.taptop.site./*']), []);
  assert.equal(EditorHost.originFromScriptId('project-editor:localhost'), null);
  assert.equal(EditorHost.originFromScriptId('project-editor:127.0.0.1'), null);
});

test('only single-host https grants count as allowed project domains', () => {
  const granted = EditorHost.grantedOrigins([
    'https://*.taptop.site/-/cms/v1/mosaic/*', 'https://*.taptop.site/*', 'https://*/*', '<all_urls>', 'http://plain.example.com/*',
    'https://*.example.net/*', 'https://b.example.org/*', PATTERN, PATTERN, 'https://site-1.taptop.site/*'
  ]);
  assert.deepEqual(granted, ['https://b.example.org', ORIGIN]);
});

function backgroundHarness({ granted = [], registered = [] } = {}) {
  const listeners = {};
  const on = name => ({ addListener(fn) { listeners[name] = fn; } });
  const state = { granted: new Set(granted), registered: new Map(registered.map(script => [script.id, script])), executed: [], popups: [], calls: [], tabs: [], rejectIds: new Set(), failGetAll: 0 };
  const chrome = {
    runtime: { onMessage: on('message'), onInstalled: on('installed'), onStartup: on('startup') },
    tabs: {
      onUpdated: on('updated'), get: async tabId => ({ id: tabId, url: state.tabUrl }),
      // Chrome matches the url pattern; for the patterns used here a prefix check is the same thing.
      query: async ({ url }) => state.tabs.filter(tab => [].concat(url).some(pattern => tab.url.startsWith(pattern.replace(/\*$/, ''))))
    },
    action: { onClicked: on('clicked'), setPopup: async options => { state.popups.push(options); } },
    permissions: {
      onAdded: on('added'), onRemoved: on('removed'),
      contains: async ({ origins }) => origins.every(pattern => state.granted.has(pattern)),
      getAll: async () => {
        if (state.failGetAll > 0) { state.failGetAll -= 1; throw new Error('getAll failed'); }
        return { permissions: ['activeTab', 'scripting'], origins: ['https://*.taptop.site/-/cms/v1/mosaic/*', ...state.granted] };
      }
    },
    scripting: {
      getRegisteredContentScripts: async filter => [...state.registered.values()].filter(script => !filter?.ids || filter.ids.includes(script.id)),
      registerContentScripts: async scripts => {
        state.calls.push(['register', scripts]);
        for (const script of scripts) {
          if (state.rejectIds.has(script.id)) throw new Error(`Invalid match pattern for '${script.id}'`);
          if (state.registered.has(script.id)) throw new Error(`Duplicate script ID '${script.id}'`);
          state.registered.set(script.id, script);
        }
      },
      unregisterContentScripts: async ({ ids }) => { state.calls.push(['unregister', ids]); for (const id of ids) state.registered.delete(id); },
      executeScript: async options => { state.executed.push(options); return [{ result: 'mounted' }]; }
    }
  };
  const context = vm.createContext({ chrome, URL, console });
  context.importScripts = (...files) => { for (const file of files) vm.runInContext(read(file), context, { filename: file }); };
  vm.runInContext(read('background.js'), context, { filename: 'background.js' });
  const send = (message, sender = {}) => new Promise(resolve => listeners.message(message, sender, response => resolve(plain(response))));
  return { context, listeners, state, send };
}

const projectScript = () => ({ id: SCRIPT_ID, matches: ['https://editor.example.com/-/cms/v1/mosaic/*'], js: ['editor/auto-mount.js'], runAt: 'document_idle', persistAcrossSessions: true });

test('the background accepts *.taptop.site and granted origins only, https and the editor path only', async () => {
  const { context } = backgroundHarness({ granted: [PATTERN] });
  const accepts = url => context.isTaptopEditorUrl(url);
  assert.equal(await accepts('https://site-1.taptop.site/-/cms/v1/mosaic/?ver_id=1'), true);
  assert.equal(await accepts(EDITOR_URL), true);
  assert.equal(await accepts('https://other.example.com/-/cms/v1/mosaic/?ver_id=1'), false);
  assert.equal(await accepts('https://www.editor.example.com/-/cms/v1/mosaic/'), false);
  assert.equal(await accepts('http://editor.example.com/-/cms/v1/mosaic/'), false);
  assert.equal(await accepts('https://editor.example.com/'), false);
  assert.equal(await accepts('https://editor.example.com/blog/-/cms/v1/mosaic/'), false);
});

test('a granted origin gets one persistent content script for the editor path, however often the grant is reported', async () => {
  const { listeners, state } = backgroundHarness();
  state.granted.add(PATTERN);
  await Promise.all([listeners.added({ origins: [PATTERN] }), listeners.added({ origins: [PATTERN] })]);
  await listeners.startup();
  assert.deepEqual(plain([...state.registered.values()]), [projectScript()]);
  assert.equal(state.calls.filter(([kind]) => kind === 'register').length, 1);
});

test('the popup grant registers the domain and mounts the importer on the open tab; an ungranted domain is refused', async () => {
  const { send, state } = backgroundHarness();
  state.tabUrl = EDITOR_URL;
  const refused = await send({ type: 'taptop-toolkit-control', action: 'allow-project-domain', tabId: 7 });
  assert.equal(refused.ok, false);
  assert.equal(state.registered.size, 0);
  assert.equal(state.executed.length, 0);

  state.granted.add(PATTERN);
  const allowed = await send({ type: 'taptop-toolkit-control', action: 'allow-project-domain', tabId: 7 });
  assert.deepEqual(allowed, { ok: true, result: 'mounted' });
  assert.deepEqual(plain([...state.registered.values()]), [projectScript()]);
  assert.ok(state.executed.every(options => options.target.tabId === 7));
  assert.ok(state.executed.length > 0);
});

test('removing the permission, here or in Chrome settings, unregisters that domain only', async () => {
  const other = { ...projectScript(), id: 'project-editor:b.example.org', matches: ['https://b.example.org/-/cms/v1/mosaic/*'] };
  const foreign = { id: 'not-ours', matches: ['https://x.example.com/*'], js: ['x.js'] };
  const { listeners, send, state } = backgroundHarness({ granted: ['https://b.example.org/*'], registered: [projectScript(), other, foreign] });
  await listeners.removed({ origins: [PATTERN] });
  assert.deepEqual([...state.registered.keys()], ['project-editor:b.example.org', 'not-ours']);

  state.granted.delete('https://b.example.org/*');
  assert.deepEqual(await send({ type: 'taptop-toolkit-control', action: 'forget-project-domain' }), { ok: true });
  assert.deepEqual([...state.registered.keys()], ['not-ours']);
});

test('the runtime bridge refuses a tab on an origin that is no longer granted', async () => {
  const { send, state } = backgroundHarness();
  const response = await send({ type: 'taptop-toolkit-runtime', action: 'probe' }, { tab: { id: 3, url: EDITOR_URL } });
  assert.deepEqual(response, { ok: true });
  assert.equal(state.executed.length, 0);
});

function popupChrome({ granted = false } = {}) {
  const calls = [];
  const chrome = {
    permissions: {
      request: permissions => { calls.push(['request', permissions]); return Promise.resolve(granted); },
      remove: permissions => { calls.push(['remove', permissions]); return Promise.resolve(true); }
    },
    runtime: { sendMessage: async message => { calls.push(['send', message]); return { ok: true, result: 'mounted' }; } }
  };
  return { chrome, calls };
}

test('«Разрешить на этом домене» requests exactly the tab origin, synchronously in the click', async () => {
  const Popup = require('../src/popup/popup.js');
  const { chrome, calls } = popupChrome({ granted: true });
  const pending = Popup.allowProjectDomain(chrome, { id: 7, url: EDITOR_URL });
  // permissions.request needs the user gesture: it must be called before the handler awaits anything.
  assert.deepEqual(calls[0], ['request', { origins: [PATTERN] }]);
  assert.deepEqual(await pending, { granted: true, response: { ok: true, result: 'mounted' } });
  assert.deepEqual(calls[1], ['send', { type: 'taptop-toolkit-control', action: 'allow-project-domain', tabId: 7 }]);

  const declined = popupChrome({ granted: false });
  assert.deepEqual(await Popup.allowProjectDomain(declined.chrome, { id: 7, url: EDITOR_URL }), { granted: false });
  assert.equal(declined.calls.length, 1);

  assert.throws(() => Popup.allowProjectDomain(chrome, { id: 8, url: 'https://site-1.taptop.site/-/cms/v1/mosaic/' }));
  assert.throws(() => Popup.allowProjectDomain(chrome, { id: 8, url: 'http://editor.example.com/-/cms/v1/mosaic/' }));
});

test('«Убрать» removes that one origin and asks the background to unregister it', async () => {
  const Popup = require('../src/popup/popup.js');
  const { chrome, calls } = popupChrome();
  assert.equal(await Popup.removeProjectDomain(chrome, ORIGIN), true);
  assert.deepEqual(calls, [['remove', { origins: [PATTERN] }], ['send', { type: 'taptop-toolkit-control', action: 'forget-project-domain' }]]);
});

test('the popup loads the shared rule and never copies the editor URL rule', () => {
  const html = read('popup/popup.html');
  assert.match(html, /<script src="\.\.\/lib\/editor-host\.js"><\/script>\s*<script src="popup\.js">/);
  assert.match(html, /Разрешить на этом домене/);
  for (const file of ['popup/popup.js', 'background.js']) {
    assert.doesNotMatch(read(file), /taptop\\?\.site|cms\\?\/v1/, `${file} repeats the editor URL rule`);
  }
  assert.match(read('background.js'), /^importScripts\('lib\/editor-host\.js'\);/m);
});

const FROM_POPUP = {};
const FROM_TAB = { tab: { id: 9, url: EDITOR_URL } };

test('allow and forget are accepted from the popup only; a tab sending them is refused before anything changes', async () => {
  const stale = { ...projectScript(), id: 'project-editor:b.example.org', matches: ['https://b.example.org/-/cms/v1/mosaic/*'] };
  const { send, state } = backgroundHarness({ granted: [PATTERN], registered: [stale] });
  state.tabUrl = EDITOR_URL;
  const allow = await send({ type: 'taptop-toolkit-control', action: 'allow-project-domain', tabId: 7 }, FROM_TAB);
  const forget = await send({ type: 'taptop-toolkit-control', action: 'forget-project-domain' }, FROM_TAB);
  assert.equal(allow.ok, false);
  assert.equal(forget.ok, false);
  assert.deepEqual([...state.registered.keys()], ['project-editor:b.example.org']);
  assert.equal(state.executed.length, 0);
  assert.equal((await send({ type: 'taptop-toolkit-control', action: 'forget-project-domain' }, FROM_POPUP)).ok, true);
});

test('a new grant also starts the importer in editor tabs of that origin that are already open', async () => {
  const { listeners, state } = backgroundHarness();
  state.tabs = [
    { id: 1, url: EDITOR_URL },
    { id: 2, url: 'https://editor.example.com/blog/' },
    { id: 3, url: 'https://other.example.com/-/cms/v1/mosaic/?ver_id=1' },
    { id: 4, url: 'https://site-1.taptop.site/-/cms/v1/mosaic/?ver_id=1' }
  ];
  state.granted.add(PATTERN);
  await listeners.added({ origins: [PATTERN] });
  assert.deepEqual(plain(state.executed), [{ target: { tabId: 1 }, files: ['editor/auto-mount.js'] }]);
  assert.deepEqual(plain([...state.registered.values()]), [projectScript()]);

  // Start and install re-sync without touching open tabs.
  await listeners.startup();
  assert.equal(state.executed.length, 1);
});

test('one rejected origin does not block the others, and the queue recovers from a failed sync', async () => {
  const { listeners, send, state } = backgroundHarness();
  // b.example.org sorts first, so a single batched call would stop before editor.example.com.
  state.rejectIds.add('project-editor:b.example.org');
  state.granted.add(PATTERN);
  state.granted.add('https://b.example.org/*');
  await listeners.added({ origins: [PATTERN, 'https://b.example.org/*'] });
  assert.deepEqual([...state.registered.keys()], [SCRIPT_ID]);

  state.tabUrl = EDITOR_URL;
  assert.equal((await send({ type: 'taptop-toolkit-control', action: 'allow-project-domain', tabId: 7 })).ok, true);
  state.executed.length = 0;
  state.tabUrl = 'https://b.example.org/-/cms/v1/mosaic/?ver_id=1';
  const refused = await send({ type: 'taptop-toolkit-control', action: 'allow-project-domain', tabId: 8 });
  assert.equal(refused.ok, false);
  assert.equal(state.executed.length, 0);

  state.failGetAll = 1;
  await listeners.startup();
  state.rejectIds.clear();
  await listeners.startup();
  assert.deepEqual([...state.registered.keys()].sort(), ['project-editor:b.example.org', SCRIPT_ID]);
  assert.equal((await send({ type: 'taptop-toolkit-control', action: 'allow-project-domain', tabId: 7 })).ok, true);
});

function fakePopupWindow(chrome) {
  const element = tag => ({
    tag, hidden: false, disabled: false, textContent: '', children: [], attributes: {}, listeners: {},
    replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); },
    setAttribute(name, value) { this.attributes[name] = value; }, addEventListener(type, fn) { this.listeners[type] = fn; }
  });
  const ids = ['allowed-domains', 'allowed-list', 'allowed-status', 'domain-access', 'allow-domain', 'domain-status', 'domain-name'];
  const nodes = Object.fromEntries(ids.map(id => [id, element(id)]));
  nodes['domain-access'].hidden = true;
  nodes['allowed-domains'].hidden = true;
  return { nodes, closed: false, close() { this.closed = true; }, chrome, document: { getElementById: id => nodes[id], createElement: element } };
}

test('when the grant works but the importer does not start, the popup keeps the reason in view', async () => {
  const Popup = require('../src/popup/popup.js');
  const granted = new Set();
  const chrome = {
    tabs: { query: async () => [{ id: 7, url: EDITOR_URL }] },
    permissions: {
      getAll: async () => ({ origins: [...granted] }),
      contains: async ({ origins }) => origins.every(origin => granted.has(origin)),
      request: ({ origins }) => { origins.forEach(origin => granted.add(origin)); return Promise.resolve(true); }
    },
    runtime: { sendMessage: async () => ({ ok: false, error: 'mount failed' }) }
  };
  const win = fakePopupWindow(chrome);
  await Popup.start(win);
  assert.equal(win.nodes['domain-access'].hidden, false);
  await win.nodes['allow-domain'].listeners.click();
  assert.equal(win.closed, false);
  assert.match(win.nodes['domain-status'].textContent, /Перезагрузите вкладку/);
  assert.equal(win.nodes['domain-access'].hidden, false);
  assert.equal(win.nodes['allow-domain'].disabled, false);
  assert.deepEqual(win.nodes['allowed-list'].children.map(item => item.children[0].textContent), ['editor.example.com']);
});
