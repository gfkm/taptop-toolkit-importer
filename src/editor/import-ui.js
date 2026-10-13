(() => {
  const RUN = new Set(['preparing', 'uploading', 'syncing-classes', 'inserting', 'confirming', 'inserting-behavior', 'confirming-behavior']);
  const AFTER_INSERT = new Set(['inserting', 'confirming', 'inserting-behavior', 'confirming-behavior']);
  const PHASE_TEXT = {
    preparing: 'Загружаем изображения', uploading: 'Загружаем изображения', 'syncing-classes': 'Обновляем классы', inserting: 'Вставляем в Root', confirming: 'Проверяем результат',
    'inserting-behavior': 'Добавляем интерактивность', 'confirming-behavior': 'Проверяем интерактивность'
  };
  const RING = 326.73;
  const ICONS = {
    import: '<path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    'file-up': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/>',
    'file-x': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m14.5 12.5-5 5"/><path d="m9.5 12.5 5 5"/>',
    'file-json': '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/>',
    layers: '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
    braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21"/>',
    alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>'
  };

  function icon(name, className = 'tt-icon') {
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function isOne(n) { return n % 10 === 1 && n % 100 !== 11; }
  function isFew(n) { return n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14); }
  function plural(n, one, few, many) { return `${n} ${isOne(n) ? one : isFew(n) ? few : many}`; }
  function count(value) { return Math.max(0, Math.trunc(Number(value) || 0)); }

  function formatSize(bytes) {
    const size = count(bytes);
    if (size < 1024) return `${size} Б`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} КБ`;
    return `${(size / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
  }

  function describeInvalidFile(fileName, message) {
    if (!/\.json$/i.test(fileName || '')) return 'нужен JSON из Toolkit.';
    if (/valid JSON/i.test(message || '')) return 'файл повреждён или это не JSON.';
    if (/unsupported package type/i.test(message || '')) return 'нужен JSON из Toolkit.';
    if (/earlier package|version/i.test(message || '')) return 'файл старого формата. Экспортируйте его заново.';
    if (/RESERVED_SYNC_CLASS_NAME/i.test(message || '')) return 'в файле есть системный класс. Соберите экспорт заново из актуального UI Kit.';
    return 'файл экспорта повреждён. Экспортируйте его заново.';
  }

  function uncertainView(base) {
    return {
      ...base, screen: 'result', tone: 'warning', closeAllowed: true, retryVisible: false,
      title: 'Проверьте результат',
      lines: ['Taptop не ответил, добавлено ли всё.', 'Загляните в конец Root, прежде чем повторять.'],
      actions: [{ id: 'close', label: 'Понятно', variant: 'primary' }]
    };
  }

  function failureReason(state) {
    const total = count(state.total);
    if (state.errorCode === 'UPLOAD_FAILED' || state.errorCode === 'PREPARE_FAILED') {
      return total ? `Не удалось загрузить изображение ${Math.min(total, count(state.done) + 1)} из ${total}.` : 'Не удалось загрузить изображения.';
    }
    const respelled = /would store class (\S+) as (\S+)/.exec(state.message || '');
    if (respelled) return `Taptop сохранит класс .${respelled[1]} под именем .${respelled[2]}.`;
    if (state.errorCode === 'CLASS_SYNC_FAILED') {
      // "Taptop did not apply class btn: main screen .btn:hover color: …"
      const match = /did not apply class (\S+): \S+ \S+ \S+ ([a-z-]+):/.exec(state.message || '');
      return match ? `Не удалось обновить класс .${match[1]} (${match[2]}).` : 'Не удалось обновить классы.';
    }
    if (state.errorCode === 'EDITOR_UNAVAILABLE') return 'Редактор Taptop не ответил. Обновите страницу.';
    if (state.errorCode === 'BINDING_FAILED' || state.errorCode === 'PACKAGE_INVALID') return 'Файл экспорта повреждён.';
    return 'Что-то пошло не так.';
  }

  function reviewRows(state) {
    const summary = state.report?.summary || {};
    const nodes = count(summary.nodes);
    const assets = count(summary.assets);
    const classes = { created: [], updated: [], unchanged: [], adopt: [], conflicts: [], copies: [], ...(state.report?.classes || { available: false, total: count(summary.classes) }) };
    const total = classes.total ?? classes.created.length + classes.updated.length + classes.unchanged.length + classes.adopt.length + classes.conflicts.length;
    const rows = [{ id: 'layers', label: 'Слои', icon: 'layers', value: `${nodes} ${isOne(nodes) ? 'добавится' : 'добавятся'}`, items: [], note: '' }];
    if (total > 0) {
      const row = { id: 'classes', label: 'Классы', icon: 'braces', value: String(total), items: [], note: '' };
      if (classes.available) {
        // One line, two numbers at most: the full breakdown is in the dropdown.
        const conflict = classes.conflicts.length ? `${classes.conflicts.length} ${isOne(classes.conflicts.length) ? 'изменён' : 'изменены'} вами` : null;
        const parts = [
          classes.created.length ? plural(classes.created.length, 'новый', 'новых', 'новых') : null,
          classes.updated.length ? `${classes.updated.length} ${isOne(classes.updated.length) ? 'обновится' : 'обновятся'}` : null,
          conflict,
          classes.adopt.length ? `${classes.adopt.length} уже есть` : null,
          classes.copies.length ? `${classes.copies.length} копиями` : null
        ].filter(Boolean);
        const shown = parts.slice(0, 2);
        if (conflict && !shown.includes(conflict)) shown[1] = conflict;
        row.value = shown.length ? shown.join(' · ') : `${classes.unchanged.length} без изменений`;
        row.items = [
          ...classes.updated.map(item => ({ name: item.name, status: 'updated', detail: item.properties.join(', ') })),
          ...classes.conflicts.map(item => ({ name: item.name, status: 'conflict', detail: item.properties.join(', ') })),
          ...classes.adopt.map(name => ({ name, status: 'adopt', detail: '' })),
          ...classes.copies.map(item => ({ name: item.name, status: 'copy', detail: item.copy })),
          ...classes.created.map(name => ({ name, status: 'added', detail: '' })),
          ...classes.unchanged.map(name => ({ name, status: 'reused', detail: '' }))
        ];
        const chips = list => list.map(item => typeof item === 'string' ? { name: item, hint: '' } : item);
        row.groups = [
          { id: 'conflicts', label: 'Изменены вами', tone: 'update', note: 'Ваши правки заменятся значениями из файла.', chips: chips(classes.conflicts.map(item => ({ name: item.name, hint: item.properties.join(', ') }))) },
          { id: 'adopt', label: 'Уже есть в проекте', tone: 'update', note: 'Стили из файла заменят текущие.', chips: chips(classes.adopt) },
          { id: 'copies', label: 'Копиями', tone: 'update', note: 'Класс с таким именем есть в проекте, блок получит свою копию.', chips: chips(classes.copies.map(item => ({ name: `${item.name} → ${item.copy}`, hint: '' }))) },
          { id: 'updated', label: classes.updated.length === 1 ? 'Обновится' : 'Обновятся', tone: 'new', chips: chips(classes.updated.map(item => ({ name: item.name, hint: item.properties.join(', ') }))) },
          { id: 'created', label: classes.created.length === 1 ? 'Новый' : 'Новые', tone: 'added', chips: chips(classes.created) },
          // Unchanged classes are only counted: listing them adds noise.
          { id: 'unchanged', label: 'Без изменений', tone: 'reused', chips: [], count: classes.unchanged.length }
        ].map(group => ({ ...group, count: group.count ?? group.chips.length })).filter(group => group.count);
      }
      rows.push(row);
    }
    if (assets > 0) rows.push({ id: 'images', label: 'Изображения', icon: 'image', value: `${assets} ${isOne(assets) ? 'загрузится' : 'загрузятся'}`, items: [], note: '' });
    return rows;
  }

  // This MVP treats the JSON package as the source of truth. Existing
  // same-name classes are updated automatically; copies are not offered.
  function reviewChoices() {
    return [];
  }

  // Places the launcher in viewport coordinates: same size and left edge as the help circle, `gap` px above it.
  function launcherPlacement(helpRect, gap = 16) {
    if (!helpRect || !(helpRect.width > 0) || !(helpRect.height > 0)) return null;
    const size = Math.round(helpRect.width);
    return { size, left: Math.round(helpRect.left), top: Math.round(helpRect.top - gap - size) };
  }

  function getImportView(state = {}) {
    const phase = state.phase || 'idle';
    const base = { phase, closeAllowed: !RUN.has(phase), retryVisible: false };
    if (phase === 'idle' || phase === 'validating' || phase === 'invalid') {
      const dropzone = phase === 'invalid'
        ? { tone: 'invalid', title: 'Файл не подходит', fileName: state.fileName || '', reason: describeInvalidFile(state.fileName, state.message) }
        : phase === 'validating'
          ? { tone: 'busy', title: 'Проверяем файл…', fileName: state.fileName || '' }
          : { tone: 'default', title: 'Перетащите JSON сюда' };
      return { ...base, screen: 'pick', title: 'Импорт JSON', description: 'Секция, страница или целый сайт из Toolkit.', dropzone };
    }
    if (phase === 'ready') {
      return {
        ...base, screen: 'review', title: 'Проверьте перед импортом', description: 'Всё добавится в конец Root.',
        file: { name: state.fileName || '', size: formatSize(state.fileSize) },
        rows: reviewRows(state), choices: reviewChoices(state), importDisabled: !state.backendAvailable
      };
    }
    if (RUN.has(phase)) {
      const total = count(state.total);
      const done = Math.min(total, count(state.done));
      const uploading = phase === 'preparing' || phase === 'uploading';
      const percent = uploading ? (total ? Math.round(done / total * 70) : 0)
        : phase === 'syncing-classes' ? 78 : phase === 'inserting' ? 85 : phase === 'confirming' ? 95 : phase === 'inserting-behavior' ? 97 : 99;
      return { ...base, screen: 'run', phaseText: PHASE_TEXT[phase], count: uploading && total ? `${done} из ${total}` : '', percent, description: 'Не закрывайте вкладку до конца процесса.' };
    }
    if (phase === 'completed') {
      if (!state.receipt?.rootTagId || !Array.isArray(state.receipt.mediaBindings)) return uncertainView(base);
      return {
        ...base, screen: 'result', tone: 'success', title: 'Импорт завершён',
        lines: ['Всё добавлено в конец Root', state.receipt.behaviorBindings?.length ? 'Интерактивность подключена и готова к публикации.' : 'и готово к редактированию.'],
        actions: [{ id: 'again', label: 'Импортировать ещё', variant: 'outline' }, { id: 'close', label: 'Готово', variant: 'primary' }]
      };
    }
    if (phase === 'failed') {
      if (state.errorCode === 'BEHAVIOR_INSERT_FAILED' || state.errorCode === 'BEHAVIOR_CONFIRMATION_FAILED') {
        return {
          ...base, screen: 'result', tone: 'warning', closeAllowed: true, retryVisible: false,
          title: 'Блок добавлен без интерактивности',
          lines: ['Embed не удалось добавить в Scripts.', 'Не импортируйте снова — появится второй блок.'],
          actions: [{ id: 'close', label: 'Понятно', variant: 'primary' }]
        };
      }
      if (state.errorCode === 'CONFIRMATION_FAILED' || state.errorCode === 'INSERT_FAILED' || AFTER_INSERT.has(state.failedPhase)) return uncertainView(base);
      const retryVisible = Boolean(state.retryable);
      return {
        ...base, screen: 'result', tone: 'error', title: 'Импорт не выполнен', retryVisible,
        lines: [failureReason(state), /would store class /.test(state.message || '') ? 'Пересоберите файл новой версией Toolkit. На страницу ничего не добавлено.' : 'На страницу ничего не добавлено.'],
        actions: retryVisible
          ? [{ id: 'replace', label: 'Другой файл', variant: 'outline' }, { id: 'retry', label: 'Повторить', variant: 'primary' }]
          : [{ id: 'replace', label: 'Другой файл', variant: 'primary' }]
      };
    }
    return getImportView({ ...state, phase: 'idle' });
  }

  function emphasize(value) {
    // Each « · » part stays on one line; long summaries wrap between parts.
    return value.split(' · ').map(part => `<span class="tt-part">${esc(part).replace(/\d+( новы[йх])?/g, match => `<strong>${match}</strong>`)}</span>`).join(' · ');
  }

  function header(view) {
    return `<header class="tt-header"><h2 class="tt-title" id="tt-title">${esc(view.title)}</h2><p class="tt-description">${esc(view.description)}</p></header>`;
  }

  function pickTemplate(view) {
    const zone = view.dropzone;
    if (zone.tone === 'invalid') {
      return `${header(view)}<div class="tt-dropzone" data-tone="invalid" role="button" tabindex="0" autofocus aria-label="Выбрать другой файл" aria-describedby="tt-dropzone-error">
        <span class="tt-media">${icon('file-x')}</span>
        <div id="tt-dropzone-error" role="alert"><div class="tt-dropzone-title">${esc(zone.title)}</div><div class="tt-dropzone-text"><strong>${esc(zone.fileName)}</strong> — ${esc(zone.reason)}<br><span class="tt-link">Выберите другой</span> или перетащите сюда</div></div>
      </div>`;
    }
    if (zone.tone === 'busy') {
      return `${header(view)}<div class="tt-dropzone" data-tone="busy" aria-busy="true">
        <span class="tt-media">${icon('loader', 'tt-icon tt-spin')}</span>
        <div><div class="tt-dropzone-title">${esc(zone.title)}</div><div class="tt-dropzone-text">${esc(zone.fileName)}</div></div>
      </div>`;
    }
    return `${header(view)}<div class="tt-dropzone" role="button" tabindex="0" autofocus aria-label="Выбрать JSON">
      <span class="tt-media">${icon('file-up')}</span>
      <div><div class="tt-dropzone-title">${esc(zone.title)}</div><div class="tt-dropzone-text">или <span class="tt-link">выберите файл</span></div></div>
    </div>`;
  }

  // A long group shows its first names; the rest open on demand.
  const CHIP_LIMIT = 8;

  function rowTemplate(row) {
    const head = `${icon(row.icon)}<span class="tt-change-label">${esc(row.label)}</span><span class="tt-change-value">${emphasize(row.value)}</span>`;
    if (!row.groups?.length) return `<div class="tt-change">${head}</div>`;
    const groups = row.groups.map(group => `<div class="tt-class-group" data-tone="${group.tone}">
      <div class="tt-class-head"><span class="tt-dot"></span><span class="tt-class-label">${esc(group.label)}</span><span class="tt-class-count">${group.count}</span></div>
      ${group.note ? `<p class="tt-class-note">${esc(group.note)}</p>` : ''}
      ${group.chips.length ? `<div class="tt-chips"${group.chips.length > CHIP_LIMIT ? ' data-collapsed' : ''}>${group.chips.map(chip => `<code class="tt-chip"${chip.hint ? ` title="${esc(chip.hint)}"` : ''}>${esc(chip.name)}</code>`).join('')}${group.chips.length > CHIP_LIMIT ? `<button class="tt-chip tt-chip-more" type="button" data-action="more">+${group.chips.length - CHIP_LIMIT}</button>` : ''}</div>` : ''}
    </div>`).join('');
    return `<details class="tt-change-group"><summary class="tt-change">${head}${icon('chevron', 'tt-icon tt-chevron')}</summary><div class="tt-class-groups">${groups}</div></details>`;
  }

  function reviewTemplate(view) {
    return `${header(view)}<div class="tt-items">
      <div class="tt-item">
        <span class="tt-media tt-media-sm">${icon('file-json')}</span>
        <div class="tt-item-content"><span class="tt-item-title">${esc(view.file.name)}</span><span class="tt-item-text">${esc(view.file.size)}</span></div>
        <button class="tt-btn tt-btn-ghost tt-btn-sm" type="button" data-action="replace">Заменить</button>
      </div>
      <div class="tt-changes">${view.rows.map(rowTemplate).join('')}</div>
      ${view.choices.map(choice => `<div class="tt-choice">
        <span class="tt-choice-label">${esc(choice.label)}</span>
        <div class="tt-segment" role="radiogroup" aria-label="${esc(choice.label)}">${choice.options.map(option => `<button class="tt-segment-option" type="button" role="radio" aria-checked="${option.value === choice.value}" data-choice="${choice.id}" data-value="${option.value}">${esc(option.label)}</button>`).join('')}</div>
        <span class="tt-choice-hint">${esc(choice.hint)}</span>
      </div>`).join('')}
    </div>
    <footer class="tt-footer" data-layout="split">
      <button class="tt-btn tt-btn-outline" type="button" data-action="cancel">Отмена</button>
      <button class="tt-btn tt-btn-primary" type="button" data-action="import"${view.importDisabled ? ' disabled' : ''}>Импортировать</button>
    </footer>`;
  }

  function runTemplate() {
    return `<div class="tt-center">
      <div class="tt-ring" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-labelledby="tt-title">
        <svg viewBox="0 0 120 120" aria-hidden="true"><circle class="tt-ring-track" cx="60" cy="60" r="52"/><circle class="tt-ring-value" cx="60" cy="60" r="52" stroke-dasharray="${RING}" stroke-dashoffset="${RING}"/></svg>
        <span class="tt-ring-core"><span class="tt-ring-number">0</span><small>%</small></span>
      </div>
      <div><h2 class="tt-title tt-phase" id="tt-title" aria-live="polite"></h2><p class="tt-result-text"></p></div>
    </div>`;
  }

  function resultTemplate(view) {
    const mark = { success: 'check', error: 'circle-x', warning: 'alert' }[view.tone];
    const layout = view.actions.length > 1 ? 'split' : 'center';
    return `<div class="tt-center">
      <span class="tt-result-mark" data-tone="${view.tone}">${icon(mark)}</span>
      <div><h2 class="tt-title tt-result-title" id="tt-title">${esc(view.title)}</h2><p class="tt-result-text">${view.lines.map(esc).join('<br>')}</p></div>
    </div>
    <footer class="tt-footer" data-layout="${layout}">${view.actions.map(action => `<button class="tt-btn tt-btn-${action.variant}" type="button" data-action="${action.id}">${esc(action.label)}</button>`).join('')}</footer>`;
  }

  function createImporterUI({ document: doc = globalThis.document, root, onFileSelected, onImport, onRetry, backendAvailable = false } = {}) {
    if (!doc || !root) throw new TypeError('document and root are required');
    const win = doc.defaultView || globalThis;
    const template = doc.createElement('template');
    template.innerHTML = `
      <button class="tt-launcher" type="button" aria-label="Импорт JSON" aria-haspopup="dialog">${icon('import')}<span class="tt-tooltip" aria-hidden="true">Импорт JSON</span></button>
      <dialog class="tt-dialog" aria-labelledby="tt-title">
        <button class="tt-btn tt-btn-ghost tt-btn-icon tt-close" type="button" aria-label="Закрыть">${icon('x')}</button>
        <div class="tt-body"></div>
        <input class="tt-file-input" type="file" accept="application/json,.json" hidden>
      </dialog>`;
    root.append(template.content);
    const launcher = root.querySelector('.tt-launcher');
    const dialog = root.querySelector('.tt-dialog');
    const body = root.querySelector('.tt-body');
    const closeButton = root.querySelector('.tt-close');
    const fileInput = root.querySelector('.tt-file-input');
    const state = { phase: 'idle', backendAvailable, file: null, fileName: '', fileSize: 0, report: null };
    let renderedScreen = '';
    let renderedKey = '';
    let selection = 0;

    function updateRun(view) {
      const ring = body.querySelector('.tt-ring');
      ring.setAttribute('aria-valuenow', String(view.percent));
      body.querySelector('.tt-ring-value').style.strokeDashoffset = String(RING * (1 - view.percent / 100));
      body.querySelector('.tt-ring-number').textContent = String(view.percent);
      body.querySelector('.tt-result-text').textContent = view.description;
      const title = body.querySelector('.tt-phase');
      let current = title.querySelector('.tt-phase-text:not([data-leaving])');
      if (current?.dataset.phase !== view.phaseText) {
        if (current) {
          const leaving = current;
          leaving.dataset.leaving = '';
          win.setTimeout(() => leaving.remove(), 300);
        }
        current = doc.createElement('span');
        current.className = 'tt-phase-text';
        current.dataset.phase = view.phaseText;
        current.innerHTML = `${esc(view.phaseText)}<span class="tt-phase-count"></span>`;
        title.append(current);
      }
      current.querySelector('.tt-phase-count').textContent = view.count || '';
    }

    function render() {
      const view = getImportView(state);
      dialog.dataset.screen = view.screen;
      closeButton.hidden = !view.closeAllowed;
      if (view.screen === 'run') {
        if (renderedScreen !== 'run') body.innerHTML = `<div class="tt-step">${runTemplate()}</div>`;
        renderedScreen = 'run'; renderedKey = '';
        updateRun(view);
        return;
      }
      const markup = view.screen === 'pick' ? pickTemplate(view) : view.screen === 'review' ? reviewTemplate(view) : resultTemplate(view);
      if (markup === renderedKey) return;
      const changedScreen = renderedScreen !== view.screen || view.screen === 'pick';
      body.innerHTML = `<div class="tt-step"${changedScreen ? '' : ' data-static'}>${markup}</div>`;
      renderedScreen = view.screen; renderedKey = markup;
      if (dialog.open) body.querySelector('[autofocus]')?.focus();
    }

    function setState(next) { Object.assign(state, next); render(); }

    function reset() {
      selection += 1;
      fileInput.value = '';
      setState({ phase: 'idle', file: null, fileName: '', fileSize: 0, report: null, receipt: null, errorCode: null, failedPhase: null, message: '' });
    }

    function show() {
      if (!dialog.open) dialog.showModal();
      body.querySelector('[autofocus]')?.focus();
    }

    function hide() {
      if (!getImportView(state).closeAllowed) return;
      if (dialog.open) dialog.close();
      reset();
    }

    async function selectFile(file) {
      if (!file) return;
      const token = ++selection;
      setState({ phase: 'validating', file, fileName: file.name, fileSize: file.size, report: null, message: '', decisions: {} });
      if (!/\.json$/i.test(file.name)) return setState({ phase: 'invalid', message: describeInvalidFile(file.name) });
      try {
        const report = await onFileSelected(file);
        if (token !== selection) return;
        if (report?.ok) setState({ phase: 'ready', report });
        else setState({ phase: 'invalid', message: describeInvalidFile(file.name, report?.errors?.[0] || report?.message) });
      } catch (error) {
        if (token === selection) setState({ phase: 'invalid', message: describeInvalidFile(file.name, error?.message) });
      }
    }

    function start(handler) {
      if (typeof handler !== 'function' || !state.file) return;
      setState({ phase: 'preparing', done: 0, total: count(state.report?.summary?.assets), errorCode: null, failedPhase: null });
      Promise.resolve().then(() => handler(state.file, controller, { adopt: 'update', conflicts: 'take' })).catch(error => controller.fail(error?.message, error?.code, error?.retryable));
    }

    function pickFile() { fileInput.value = ''; fileInput.click(); }

    launcher.addEventListener('click', show);
    closeButton.addEventListener('click', hide);
    dialog.addEventListener('cancel', event => { event.preventDefault(); hide(); });
    dialog.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); hide(); } });
    dialog.addEventListener('close', () => { if (!getImportView(state).closeAllowed) dialog.showModal(); });
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const inside = event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      if (!inside) hide();
    });
    fileInput.addEventListener('change', () => selectFile(fileInput.files?.[0]));
    body.addEventListener('click', event => {
      if (event.target.closest('.tt-dropzone:not([data-tone="busy"])')) return pickFile();
      const choice = event.target.closest('[data-choice]');
      if (choice) return setState({ decisions: { ...(state.decisions || {}), [choice.dataset.choice]: choice.dataset.value } });
      const more = event.target.closest('[data-action="more"]');
      if (more) { more.parentElement.removeAttribute('data-collapsed'); more.remove(); return; }
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'import') start(onImport);
      else if (action === 'retry') start(onRetry);
      else if (action === 'replace') { if (state.phase !== 'ready') reset(); pickFile(); }
      else if (action === 'again') reset();
      else if (action === 'cancel' || action === 'close') hide();
    });
    body.addEventListener('keydown', event => {
      if ((event.key === 'Enter' || event.key === ' ') && event.target.closest('.tt-dropzone[role="button"]')) { event.preventDefault(); pickFile(); }
    });
    body.addEventListener('dragover', event => {
      const zone = event.target.closest('.tt-dropzone:not([data-tone="busy"])');
      if (!zone) return;
      event.preventDefault();
      zone.dataset.over = '';
    });
    body.addEventListener('dragleave', event => { delete event.target.closest('.tt-dropzone')?.dataset.over; });
    body.addEventListener('drop', event => {
      const zone = event.target.closest('.tt-dropzone:not([data-tone="busy"])');
      if (!zone) return;
      event.preventDefault();
      selectFile(event.dataTransfer?.files?.[0]);
    });

    const controller = {
      show, hide,
      setBackendAvailable(available) { setState({ backendAvailable: Boolean(available) }); },
      setProgress(phase, counts = {}) {
        if (!RUN.has(phase)) throw new TypeError('Unknown import phase');
        setState({ phase, done: counts.done ?? state.done, total: counts.total ?? state.total });
      },
      complete(receipt) {
        const ring = body.querySelector('.tt-ring-value');
        if (ring) {
          ring.style.strokeDashoffset = '0';
          body.querySelector('.tt-ring-number').textContent = '100';
          win.setTimeout(() => setState({ phase: 'completed', receipt }), 450);
        } else setState({ phase: 'completed', receipt });
      },
      fail(message, errorCode, retryable) {
        setState({ phase: 'failed', message, errorCode, retryable, failedPhase: RUN.has(state.phase) ? state.phase : state.failedPhase });
      },
      destroy() { if (dialog.open) dialog.close(); launcher.remove(); dialog.remove(); }
    };
    render();
    return controller;
  }

  const api = { getImportView, describeInvalidFile, launcherPlacement, createImporterUI };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof globalThis !== 'undefined') globalThis.TaptopImporterUI = api;
})();
