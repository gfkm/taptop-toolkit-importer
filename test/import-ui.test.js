const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const extension = path.join(__dirname, '..', 'src');
const read = file => fs.readFileSync(path.join(extension, file), 'utf8');
const { getImportView, describeInvalidFile, launcherPlacement } = require('../src/editor/import-ui.js');

const report = {
  ok: true,
  summary: { nodes: 24, classes: 12, instances: 1, assets: 4 },
  classes: { available: true, created: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], updated: [{ name: 'hero', properties: ['padding-top', 'gap'] }], unchanged: ['title'], adopt: [], conflicts: [], copies: [] }
};

test('background owns one idempotent mount and opens the dialog from the toolbar icon', () => {
  const background = read('background.js');
  assert.match(background, /mount-editor-importer/);
  assert.match(background, /editor\/mount-importer\.js/);
  assert.match(background, /taptop\.site/);
  assert.match(background, /action\.onClicked/);
  assert.match(background, /setPopup/);
  assert.doesNotMatch(background, /insertCSS/);
  const mount = read('editor/mount-importer.js');
  assert.match(mount, /TaptopToolkitImporter/);
  assert.match(mount, /data-taptop-toolkit-importer/);
  assert.match(mount, /attachShadow/);
  assert.match(mount, /FontFace/);
});

test('toolbar popup says what Toolkit is and where the import lives', () => {
  const html = read('popup/popup.html');
  assert.match(html, /Импортирует секции, страницы и целые сайты в Taptop из JSON-файла/);
  assert.match(html, /Где найти импорт/);
  assert.doesNotMatch(html, /type="file"/);
  assert.doesNotMatch(html, /Как импортировать|запасной/);
  assert.match(read('popup/popup.css'), /width:\s*400px/);
});

test('first step is a universal drop zone without an import button', () => {
  const view = getImportView({ phase: 'idle' });
  assert.equal(view.screen, 'pick');
  assert.equal(view.title, 'Импорт JSON');
  assert.equal(view.description, 'Секция, страница или целый сайт из Toolkit.');
  assert.equal(view.dropzone.tone, 'default');
  assert.equal(view.dropzone.title, 'Перетащите JSON сюда');
});

test('a wrong file turns the drop zone into a plain-language error', () => {
  const view = getImportView({ phase: 'invalid', fileName: 'photo.png', message: describeInvalidFile('photo.png') });
  assert.equal(view.screen, 'pick');
  assert.equal(view.dropzone.tone, 'invalid');
  assert.equal(view.dropzone.title, 'Файл не подходит');
  assert.equal(view.dropzone.fileName, 'photo.png');
  assert.equal(view.dropzone.reason, 'нужен JSON из Toolkit.');
});

test('package validation errors are translated, never shown in English', () => {
  assert.equal(describeInvalidFile('a.json', 'Unsupported package type'), 'нужен JSON из Toolkit.');
  assert.equal(describeInvalidFile('a.json', 'Package must be valid JSON'), 'файл повреждён или это не JSON.');
  assert.match(describeInvalidFile('a.json', 'This is an earlier package with a separate asset folder. Compile again with Toolkit 0.2.'), /старого формата/);
  assert.match(describeInvalidFile('a.json', 'Embedded asset x: bad'), /повреждён/);
});

test('review shows what will change in the project', () => {
  const view = getImportView({ phase: 'ready', backendAvailable: true, fileName: 'hero.json', fileSize: 49152, report });
  assert.equal(view.screen, 'review');
  assert.equal(view.title, 'Проверьте перед импортом');
  assert.equal(view.description, 'Всё добавится в конец Root.');
  assert.equal(view.file.size, '48 КБ');
  assert.deepEqual(view.rows.map(row => row.id), ['layers', 'classes', 'images']);
  assert.equal(view.rows[0].value, '24 добавятся');
  assert.equal(view.rows[1].value, '9 новых · 1 обновится');
  assert.deepEqual(view.rows[1].groups.map(group => [group.id, group.count]), [['updated', 1], ['created', 9], ['unchanged', 1]]);
  assert.deepEqual(view.rows[1].groups[0].chips[0], { name: 'hero', hint: 'padding-top, gap' });
  assert.deepEqual(view.rows[1].groups[2].chips, [], 'unchanged classes are counted, not listed');
  assert.equal(view.rows[1].items.length, 11);
  assert.deepEqual(view.rows[1].items[0], { name: 'hero', status: 'updated', detail: 'padding-top, gap' });
  assert.deepEqual(view.choices, []);
  assert.equal(view.rows[2].value, '4 загрузятся');
  assert.equal(view.importDisabled, false);
});

test('review degrades to plain counts when project classes are unknown', () => {
  const view = getImportView({ phase: 'ready', backendAvailable: true, report: { ...report, classes: { available: false, total: 12 }, summary: { ...report.summary, assets: 0, nodes: 1 } } });
  assert.deepEqual(view.rows.map(row => row.id), ['layers', 'classes']);
  assert.equal(view.rows[0].value, '1 добавится');
  assert.equal(view.rows[1].value, '12');
  assert.equal(view.rows[1].items.length, 0);
});

test('import cannot start without an editor adapter', () => {
  assert.equal(getImportView({ phase: 'ready', backendAvailable: false, report }).importDisabled, true);
});

test('the ring title is the progress: phase text, image count and real percent', () => {
  const upload = getImportView({ phase: 'uploading', done: 2, total: 4 });
  assert.equal(upload.screen, 'run');
  assert.equal(upload.phaseText, 'Загружаем изображения');
  assert.equal(upload.count, '2 из 4');
  assert.equal(upload.percent, 35);
  assert.equal(upload.description, 'Не закрывайте вкладку до конца процесса.');
  assert.equal(upload.closeAllowed, false);
  assert.deepEqual([getImportView({ phase: 'inserting' }).phaseText, getImportView({ phase: 'inserting' }).percent], ['Вставляем в Root', 85]);
  assert.deepEqual([getImportView({ phase: 'confirming' }).phaseText, getImportView({ phase: 'confirming' }).percent], ['Проверяем результат', 95]);
  assert.deepEqual([getImportView({ phase: 'inserting-behavior' }).phaseText, getImportView({ phase: 'inserting-behavior' }).percent], ['Добавляем интерактивность', 97]);
  assert.deepEqual([getImportView({ phase: 'confirming-behavior' }).phaseText, getImportView({ phase: 'confirming-behavior' }).percent], ['Проверяем интерактивность', 99]);
  assert.equal(getImportView({ phase: 'inserting' }).count, '');
});

test('success needs a confirmed root and media bindings', () => {
  const done = getImportView({ phase: 'completed', receipt: { rootTagId: 'root-1', mediaBindings: [] } });
  assert.equal(done.screen, 'result');
  assert.equal(done.tone, 'success');
  assert.equal(done.title, 'Импорт завершён');
  assert.deepEqual(done.lines, ['Всё добавлено в конец Root', 'и готово к редактированию.']);
  assert.deepEqual(done.actions.map(action => action.id), ['again', 'close']);
  assert.equal(getImportView({ phase: 'completed' }).tone, 'warning');
});

test('success names the imported interaction when a behavior receipt is present', () => {
  const done = getImportView({ phase: 'completed', receipt: {
    rootTagId: 'root-1', mediaBindings: [], behaviorBindings: [{ key: 'faq/toggle', adapter: 'taptop/embed-accordion-v1', targetTagId: 'embed-1' }]
  } });
  assert.deepEqual(done.lines, ['Всё добавлено в конец Root', 'Интерактивность подключена и готова к публикации.']);
});

test('a failure before insertion says nothing was added and offers a safe retry', () => {
  const view = getImportView({ phase: 'failed', errorCode: 'UPLOAD_FAILED', retryable: true, failedPhase: 'uploading', done: 2, total: 4 });
  assert.equal(view.tone, 'error');
  assert.equal(view.title, 'Импорт не выполнен');
  assert.deepEqual(view.lines, ['Не удалось загрузить изображение 3 из 4.', 'На страницу ничего не добавлено.']);
  assert.deepEqual(view.actions.map(action => action.id), ['replace', 'retry']);
  assert.equal(view.retryVisible, true);
});

test('an unavailable editor is a safe failure with a retry', () => {
  const view = getImportView({ phase: 'failed', errorCode: 'EDITOR_UNAVAILABLE', retryable: true, failedPhase: 'preparing' });
  assert.equal(view.tone, 'error');
  assert.equal(view.lines[0], 'Редактор Taptop не ответил. Обновите страницу.');
  assert.equal(view.retryVisible, true);
});

test('any failure once insertion started never offers retry', () => {
  for (const state of [
    { phase: 'failed', errorCode: 'CONFIRMATION_FAILED', retryable: true, failedPhase: 'confirming' },
    { phase: 'failed', errorCode: 'INSERT_FAILED', retryable: true, failedPhase: 'inserting' },
    { phase: 'failed', errorCode: 'SESSION_UNAVAILABLE', retryable: false, failedPhase: 'confirming' }
  ]) {
    const view = getImportView(state);
    assert.equal(view.tone, 'warning');
    assert.equal(view.title, 'Проверьте результат');
    assert.equal(view.retryVisible, false);
    assert.deepEqual(view.actions, [{ id: 'close', label: 'Понятно', variant: 'primary' }]);
    assert.match(view.lines.join(' '), /конец Root/);
  }
});

test('no visible copy leaks English engine messages', () => {
  const states = [
    { phase: 'invalid', fileName: 'x.json', message: describeInvalidFile('x.json', 'Package sync metadata is incomplete') },
    { phase: 'failed', errorCode: 'UPLOAD_FAILED', message: 'Taptop did not confirm image upload (500)', failedPhase: 'uploading', done: 0, total: 1, retryable: true },
    { phase: 'failed', errorCode: 'PREPARE_FAILED', message: 'Embedded image is incomplete', failedPhase: 'preparing', done: 0, total: 1 },
    { phase: 'failed', errorCode: 'EDITOR_UNAVAILABLE', message: 'Taptop editor API is unavailable: clipboard', failedPhase: 'preparing', retryable: true },
    { phase: 'failed', errorCode: 'CONFIRMATION_FAILED', message: 'Taptop did not confirm the inserted layer', failedPhase: 'confirming' }
  ];
  const allowed = new Set(['Root', 'JSON', 'Toolkit', 'Taptop']);
  for (const state of states) {
    const view = getImportView(state);
    const text = [view.title, view.description, view.dropzone?.title, view.dropzone?.reason, ...(view.lines || [])].filter(Boolean).join(' ');
    const words = text.match(/[A-Za-z]{3,}/g) || [];
    assert.deepEqual(words.filter(word => !allowed.has(word)), [], text);
  }
});

test('dialog is a native modal inside an isolated shadow root without a toast', () => {
  const ui = read('editor/import-ui.js');
  assert.match(ui, /showModal/);
  assert.match(ui, /tt-ring/);
  assert.match(ui, /tt-dropzone/);
  assert.doesNotMatch(ui, /tt-importer-toast/);
});

test('launcher stays fixed above the native help button', () => {
  const css = read('editor/import-ui.css');
  assert.match(css, /\.tt-launcher\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /\.tt-launcher\s*\{[^}]*right:\s*var\(--tt-launcher-right,\s*24px\)/);
  assert.match(css, /\.tt-launcher\s*\{[^}]*bottom:\s*var\(--tt-launcher-bottom,\s*88px\)/);
  assert.match(css, /\.tt-launcher\s*\{[^}]*width:\s*var\(--tt-launcher-size,\s*40px\)/);
  assert.match(css, /\.tt-launcher\s*\{[^}]*left:\s*var\(--tt-launcher-left,\s*auto\)/);
  assert.match(css, /\.tt-launcher\s*\{[^}]*top:\s*var\(--tt-launcher-top,\s*auto\)/);
});

test('launcher copies the help circle size and sits 16px above it in viewport coordinates', () => {
  const help = { left: 1038, top: 770, right: 1078, bottom: 810, width: 40, height: 40 };
  assert.deepEqual(launcherPlacement(help), { size: 40, left: 1038, top: 714 });
  assert.deepEqual(launcherPlacement(help, 20), { size: 40, left: 1038, top: 710 });
});

test('launcher keeps the default place when the help circle is missing or hidden', () => {
  assert.equal(launcherPlacement(null), null);
  assert.equal(launcherPlacement({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }), null);
});

test('mount aligns the launcher to the editor help button', () => {
  const mount = read('editor/mount-importer.js');
  assert.match(mount, /\.tt-help button/);
  assert.match(mount, /launcherPlacement/);
  assert.match(mount, /--tt-launcher-\$\{name\}/);
  assert.match(mount, /'size', 'left', 'top'/);
});

test('sheet follows the Maia anatomy with Toolkit Inter and Taptop blue', () => {
  const css = read('editor/import-ui.css');
  assert.match(css, /--primary:\s*#3290ff/i);
  assert.match(css, /font-family:\s*'TT Inter'/);
  assert.match(css, /--radius-4xl:\s*26px/);
  assert.match(css, /\.tt-dialog\s*\{[^}]*max-width:\s*448px/);
  assert.match(css, /\.tt-btn\s*\{[^}]*height:\s*36px/);
  assert.match(css, /prefers-reduced-motion/);
});

test('raw colors live only in the token block', () => {
  const css = read('editor/import-ui.css');
  const tokens = css.match(/:host\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(tokens.includes('--primary'));
  const outside = css.replace(tokens, '');
  assert.deepEqual(outside.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/gi) || [], []);
});

test('run screen shows the image count in a small pill next to the phase title', () => {
  const css = read('editor/import-ui.css');
  assert.match(css, /\.tt-phase-count\s*\{[^}]*border-radius:\s*var\(--radius-4xl\)/);
  assert.match(css, /\.tt-phase-count\s*\{[^}]*font-size:\s*12px/);
  assert.match(css, /\.tt-phase-count:empty\s*\{[^}]*display:\s*none/);
  assert.match(css, /\.tt-dialog\[data-screen="run"\]\s*\{[^}]*padding:\s*40px 32px 36px/);
  const ui = read('editor/import-ui.js');
  assert.match(ui, /tt-phase-count'\)\.textContent = view\.count \|\| ''/);
});

test('a failed Embed after a confirmed block says the block is in Root and no retry is offered', () => {
  for (const errorCode of ['BEHAVIOR_INSERT_FAILED', 'BEHAVIOR_CONFIRMATION_FAILED']) {
    const view = getImportView({ phase: 'failed', errorCode, retryable: true, failedPhase: 'inserting-behavior', message: 'Узел должен существовать.' });
    assert.equal(view.tone, 'warning');
    assert.equal(view.title, 'Блок добавлен без интерактивности');
    assert.deepEqual(view.lines, ['Embed не удалось добавить в Scripts.', 'Не импортируйте снова — появится второй блок.']);
    assert.equal(view.retryVisible, false);
  }
});



test('same-name project classes are updated automatically without a choice panel', () => {
  const state = { phase: 'ready', backendAvailable: true, report: { ...report, classes: { available: true, created: [], updated: [{ name: 'faq', properties: ['padding-top'] }, { name: 'container', properties: ['gap'] }], unchanged: [], adopt: [], conflicts: [], copies: [] } } };
  const view = getImportView(state);
  assert.equal(view.rows[1].value, '2 обновятся');
  assert.deepEqual(view.choices, []);
});

test('local property changes are also updated automatically without a choice panel', () => {
  const view = getImportView({ phase: 'ready', backendAvailable: true, report: { ...report, classes: { available: true, created: [], updated: [{ name: 'faq', properties: ['padding-top'] }], unchanged: [], adopt: [], conflicts: [], copies: [] } } });
  assert.equal(view.rows[1].value, '1 обновится');
  assert.deepEqual(view.choices, []);
});

test('class sync shows its own run phase and failure', () => {
  const run = getImportView({ phase: 'syncing-classes' });
  assert.equal(run.phaseText, 'Обновляем классы');
  assert.equal(run.closeAllowed, false);
  const failed = getImportView({ phase: 'failed', errorCode: 'CLASS_SYNC_FAILED', retryable: true, failedPhase: 'syncing-classes' });
  assert.equal(failed.tone, 'error');
  assert.equal(failed.lines[0], 'Не удалось обновить классы.');
  assert.equal(failed.retryVisible, true);
});

test('a reserved managed class is explained as a rebuild, not an editor error', () => {
  const view = getImportView({ phase: 'invalid', fileName: 'page.json', message: 'RESERVED_SYNC_CLASS_NAME: .body is reserved' });
  assert.match(view.dropzone.reason, /системный класс/i);
});

test('a class sync failure names the class and property when Taptop reported them', () => {
  const view = getImportView({ phase: 'failed', retryable: true, errorCode: 'CLASS_SYNC_FAILED', message: 'Taptop did not apply class btn: cm screen .btn:hover background-color: Taptop did not keep the value', fileName: 'page.json', report: null });
  assert.equal(view.lines[0], 'Не удалось обновить класс .btn (background-color).');
});

test('the class summary stays on one line and always mentions classes you edited', () => {
  const view = getImportView({ phase: 'ready', backendAvailable: true, fileName: 'p.json', fileSize: 1, report: { ok: true, summary: { nodes: 1, classes: 80, instances: 1, assets: 0 }, classes: { available: true, total: 80, created: Array.from({ length: 12 }, (_, i) => `n${i}`), updated: Array.from({ length: 30 }, (_, i) => ({ name: `u${i}`, properties: ['color'] })), unchanged: Array.from({ length: 36 }, (_, i) => `s${i}`), adopt: [], conflicts: [{ name: 'c1', properties: ['color'] }, { name: 'c2', properties: ['gap'] }], copies: [] } } });
  assert.equal(view.rows[1].value, '12 новых · 2 изменены вами');
  const quiet = getImportView({ phase: 'ready', backendAvailable: true, fileName: 'p.json', fileSize: 1, report: { ok: true, summary: { nodes: 1, classes: 3, instances: 1, assets: 0 }, classes: { available: true, total: 3, created: [], updated: [], unchanged: ['a', 'b', 'c'], adopt: [], conflicts: [], copies: [] } } });
  assert.equal(quiet.rows[1].value, '3 без изменений');
});

test('a class name Taptop would respell is named, with the fix', () => {
  const view = getImportView({ phase: 'failed', errorCode: 'CLASS_NAME_RESPELLED', message: 'Taptop would store class col-1 as col', retryable: false, failedPhase: 'preparing' });
  assert.equal(view.tone, 'error');
  assert.deepEqual(view.lines, ['Taptop сохранит класс .col-1 под именем .col.', 'Пересоберите файл новой версией Toolkit. На страницу ничего не добавлено.']);
  assert.equal(view.retryVisible, false);
  const sync = getImportView({ phase: 'failed', errorCode: 'CLASS_SYNC_FAILED', message: 'Taptop did not apply class col-1: Taptop would store class col-1 as col', retryable: true, failedPhase: 'syncing-classes' });
  assert.equal(sync.lines[0], 'Taptop сохранит класс .col-1 под именем .col.');
});
