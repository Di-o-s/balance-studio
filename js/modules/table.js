/*
 * Модуль 2. Редактор таблицы. BPS.grid - общий компонент, его же использует вкладка «Лут».
 * Каждое изменение сразу пишется в store, а store сам сохраняет в localStorage.
 */
(function () {
  'use strict';
  const { h, clear, toast } = BPS.ui;
  const D = BPS.data;
  const store = BPS.store;

  function columnsFor(kind, rows) {
    const s = D.SCHEMAS[kind];
    const present = D.collectHeaders(rows);
    const cols = s.required.slice();
    s.optional.forEach((c) => cols.push(c)); // показываем все необязательные, чтобы их можно было заполнить
    present.forEach((c) => { if (cols.indexOf(c) < 0) cols.push(c); }); // пользовательские колонки тоже сохраняем
    return cols;
  }

  // Ошибка конкретной ячейки, null если всё хорошо.
  function cellError(kind, col, value, row, rows) {
    const s = D.SCHEMAS[kind];
    const v = value === undefined || value === null ? '' : String(value).trim();
    if (s.required.indexOf(col) >= 0 && v === '') return 'Обязательное поле';
    if (v === '') return null;
    if (s.numeric.indexOf(col) >= 0) {
      if (!D.isNumber(v)) return 'Нужно число';
      const n = Number(v.replace(',', '.'));
      if (s.nonNegative.indexOf(col) >= 0 && n < 0) return 'Не может быть меньше 0';
      const rg = s.ranges[col];
      if (rg && (n < rg[0] || n > rg[1])) return 'Диапазон ' + rg[0] + '…' + rg[1];
    }
    if (s.enums[col] && s.enums[col].indexOf(v) < 0) return 'Допустимо: ' + s.enums[col].join(', ');
    if (col === s.key && rows.filter((r) => String(r[col]).trim() === v).length > 1) return 'Дубль ID';
    return null;
  }

  function nextId(rows) {
    const nums = rows.map((r) => Number(r.id)).filter(Number.isFinite);
    return nums.length ? Math.max.apply(null, nums) + 1 : 1;
  }

  /*
   * opts: { rowClass(row, i) -> css class, onChange(), compact }
   */
  function renderGrid(container, kind, opts) {
    const o = opts || {};
    let sortCol = null;
    let sortDir = 1;
    let filter = '';
    const wrap = h('div', { class: 'grid-wrap' });
    const toolbar = h('div', { class: 'toolbar' });
    const tableBox = h('div', { class: 'table-scroll' });
    wrap.appendChild(toolbar);
    wrap.appendChild(tableBox);
    container.appendChild(wrap);

    const search = h('input', { type: 'search', placeholder: 'Поиск по таблице…', class: 'search', 'aria-label': 'Поиск' });
    search.addEventListener('input', () => { filter = search.value.toLowerCase(); draw(); });
    toolbar.appendChild(search);
    toolbar.appendChild(h('button', { class: 'btn primary', onclick: addRow, title: 'Alt+N' }, '+ Строка'));
    toolbar.appendChild(h('button', { class: 'btn ghost danger', onclick: clearAll }, 'Очистить'));
    const status = h('span', { class: 'muted save-status' });
    toolbar.appendChild(status);

    function rows() { return store.get(kind); }

    function commit(newRows, redraw) {
      store.set(kind, newRows, true); // silent: не перерисовываем всё приложение на каждый символ
      updateStatus();
      if (o.onChange) o.onChange();
      if (redraw) draw();
    }

    function updateStatus() {
      const n = rows().length;
      const errs = countErrors();
      status.textContent = 'Строк: ' + n + (errs ? ' · ошибок в ячейках: ' + errs : '') + ' · автосохранение включено';
      status.classList.toggle('err-text', errs > 0);
    }

    function countErrors() {
      const rs = rows();
      const cols = columnsFor(kind, rs);
      let c = 0;
      rs.forEach((r) => cols.forEach((col) => { if (cellError(kind, col, r[col], r, rs)) c++; }));
      return c;
    }

    function addRow() {
      const rs = rows().slice();
      const r = { id: nextId(rs) };
      D.SCHEMAS[kind].required.forEach((c) => { if (c !== 'id') r[c] = D.SCHEMAS[kind].numeric.indexOf(c) >= 0 ? 0 : ''; });
      if (kind === 'loot' && rs.length) r.table = rs[rs.length - 1].table;
      rs.push(r);
      commit(rs, true);
      const last = tableBox.querySelector('tbody tr:last-child input');
      if (last) last.focus();
    }

    function clearAll() {
      if (!rows().length) return;
      const backup = rows();
      commit([], true);
      toast('Таблица очищена', 'warn');
      showUndo(backup);
    }

    function showUndo(backup) {
      const btn = h('button', { class: 'btn small', onclick: () => { commit(backup, true); btn.remove(); } }, 'Вернуть');
      toolbar.appendChild(btn);
      setTimeout(() => btn.remove(), 8000);
    }

    function draw() {
      clear(tableBox);
      const rs = rows();
      if (!rs.length) {
        tableBox.appendChild(h('div', { class: 'empty' }, 'Данных пока нет. Загрузите файл на вкладке «Импорт» или добавьте строку.'));
        updateStatus();
        return;
      }
      const cols = columnsFor(kind, rs);
      const s = D.SCHEMAS[kind];
      let view = rs.map((r, i) => ({ r, i }));
      if (filter) view = view.filter((x) => cols.some((c) => String(x.r[c] === undefined ? '' : x.r[c]).toLowerCase().indexOf(filter) >= 0));
      if (sortCol) {
        const num = s.numeric.indexOf(sortCol) >= 0 || sortCol === 'id';
        view.sort((a, b) => {
          const va = a.r[sortCol]; const vb = b.r[sortCol];
          const cmp = num ? (Number(va) || 0) - (Number(vb) || 0) : String(va).localeCompare(String(vb), 'ru');
          return cmp * sortDir;
        });
      }
      const thead = h('thead', null, h('tr', null,
        cols.map((c) => h('th', {
          class: (s.required.indexOf(c) >= 0 ? 'req ' : '') + (sortCol === c ? 'sorted' : ''),
          title: 'Сортировать',
          onclick: () => { if (sortCol === c) sortDir = -sortDir; else { sortCol = c; sortDir = 1; } draw(); }
        }, c, sortCol === c ? (sortDir > 0 ? ' ▲' : ' ▼') : '')),
        h('th', { class: 'actions-col' }, '')));
      const tbody = h('tbody');
      view.forEach(({ r, i }) => {
        const tr = h('tr', { class: o.rowClass ? o.rowClass(r, i) || '' : '', 'data-i': i });
        cols.forEach((c) => {
          const isNum = s.numeric.indexOf(c) >= 0;
          const enumVals = s.enums[c];
          let input;
          if (enumVals) {
            input = h('select', { 'aria-label': c },
              h('option', { value: '' }, '-'),
              enumVals.map((v) => h('option', { value: v, selected: r[c] === v }, v)));
            if (r[c] && enumVals.indexOf(r[c]) < 0) input.appendChild(h('option', { value: r[c], selected: true }, r[c]));
          } else {
            input = h('input', { value: r[c] === undefined ? '' : r[c], 'aria-label': c, class: isNum ? 'num' : '', inputmode: isNum ? 'decimal' : null });
          }
          const td = h('td', null, input);
          const mark = () => {
            const err = cellError(kind, c, rows()[i][c], rows()[i], rows());
            td.classList.toggle('cell-error', !!err);
            td.title = err || '';
          };
          input.addEventListener(enumVals ? 'change' : 'input', () => {
            const rsNow = rows().slice();
            const raw = input.value;
            const val = isNum && D.isNumber(raw) ? Number(raw.replace(',', '.')) : raw;
            rsNow[i] = Object.assign({}, rsNow[i], { [c]: val });
            commit(rsNow, false);
            mark();
            if (c === s.key) draw(); // дубли ID могут появиться/пропасть в других строках
          });
          mark();
          tr.appendChild(td);
        });
        tr.appendChild(h('td', { class: 'actions-col' },
          h('button', { class: 'icon-btn', title: 'Дублировать', 'aria-label': 'Дублировать строку', onclick: () => {
            const rsNow = rows().slice();
            rsNow.splice(i + 1, 0, Object.assign({}, rsNow[i], { id: nextId(rsNow) }));
            commit(rsNow, true);
          } }, '⧉'),
          h('button', { class: 'icon-btn danger', title: 'Удалить', 'aria-label': 'Удалить строку', onclick: () => {
            const rsNow = rows().slice();
            const removed = rsNow.splice(i, 1)[0];
            commit(rsNow, true);
            toast('Строка «' + (removed.name || removed.item || removed.id) + '» удалена', 'warn');
            showUndo(rows().slice(0, i).concat([removed], rows().slice(i)));
          } }, '✕')));
        tbody.appendChild(tr);
      });
      tableBox.appendChild(h('table', { class: 'data' }, thead, tbody));
      updateStatus();
    }

    // Обновить только подсветку строк, не пересоздавая поля ввода (иначе теряется фокус).
    function refreshRowClasses() {
      if (!o.rowClass) return;
      const rs = rows();
      tableBox.querySelectorAll('tbody tr[data-i]').forEach((tr) => {
        const i = Number(tr.getAttribute('data-i'));
        if (rs[i]) tr.className = o.rowClass(rs[i], i) || '';
      });
    }

    draw();
    return { redraw: draw, addRow, refreshRowClasses };
  }

  let gridApi = null;
  function render(root) {
    const panel = h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', null, 'Редактор юнитов'),
        h('p', { class: 'muted' }, 'Клик по заголовку - сортировка. Ячейки с ошибкой подсвечиваются красным, подсказка - при наведении. Обязательные колонки отмечены точкой.')));
    root.appendChild(panel);
    gridApi = renderGrid(panel, 'units');
  }

  BPS.grid = { render: renderGrid, cellError, columnsFor };
  BPS.modules = BPS.modules || {};
  BPS.modules.table = { title: 'Таблица', render, addRow: () => gridApi && gridApi.addRow() };
})();
