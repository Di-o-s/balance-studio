/*
 * Модуль 5. Проверка лута: сумма шансов по каждой таблице = 100%, подсветка ошибок,
 * нормализация, симуляция бросков и экспорт результата проверки.
 */
(function () {
  'use strict';
  const { h, clear, fmt, toast, download, numInput } = BPS.ui;
  const F = BPS.formulas;
  const D = BPS.data;
  const store = BPS.store;

  const RARITY_RU = { common: 'обычный', uncommon: 'необычный', rare: 'редкий', epic: 'эпический', legendary: 'легендарный' };

  function render(root) {
    const panel = h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', null, 'Проверка лута'),
        h('p', { class: 'muted' }, 'Строки одной таблицы дропа объединяются по колонке table. Сумма шансов каждой таблицы должна быть 100% (допуск ±' + F.LOOT_EPS + ').')));
    root.appendChild(panel);

    const summaryBox = h('div', { class: 'loot-summary' });
    const simBox = h('div', { class: 'card' });
    let lastCheck = F.checkLoot(store.get('loot'));
    const badRows = () => new Set(lastCheck.rowErrors.map((e) => e.index));
    const badTables = () => new Set(lastCheck.tables.filter((t) => !t.ok).map((t) => t.name));

    function recheck() {
      lastCheck = F.checkLoot(store.get('loot'));
      drawSummary();
    }

    function drawSummary() {
      clear(summaryBox);
      const c = lastCheck;
      if (!store.get('loot').length) return;
      summaryBox.appendChild(h('div', { class: 'verdict ' + (c.ok ? 'ok' : 'bad') },
        c.ok ? 'Все таблицы в порядке' : 'Найдены ошибки: таблиц с неверной суммой - ' + c.tables.filter((t) => !t.ok).length + ', строк с ошибками - ' + c.rowErrors.length));
      summaryBox.appendChild(h('div', { class: 'cards-row' }, c.tables.map((t) => {
        const diff = Math.round((t.sum - 100) * 1000) / 1000;
        return h('div', { class: 'card loot-card ' + (t.ok ? 'ok' : 'bad') },
          h('div', { class: 'loot-name' }, t.name),
          h('div', { class: 'loot-sum' }, fmt(t.sum, 3) + '%'),
          h('div', { class: 'muted' }, t.count + ' предм.' + (t.ok ? '' : ' · ' + (diff > 0 ? '+' : '') + fmt(diff, 3) + '%')),
          h('div', { class: 'progress' }, h('span', { style: { width: Math.min(t.sum, 100) + '%' } })),
          t.ok ? null : h('button', { class: 'btn small', onclick: () => {
            store.set('loot', F.normalizeLoot(store.get('loot'), t.name), true);
            toast('Шансы «' + t.name + '» приведены к 100% с сохранением пропорций', 'ok');
            gridApi.redraw(); recheck(); drawSim();
          } }, 'Нормализовать'));
      })));
      if (c.rowErrors.length) {
        const rows = store.get('loot');
        summaryBox.appendChild(h('ul', { class: 'errors' }, c.rowErrors.map((e) =>
          h('li', null, 'Строка id=' + rows[e.index].id + ' («' + (rows[e.index].item || '?') + '»): ' + e.errors.join(', ')))));
      }
    }

    let simTable = null;
    let simN = 10000;
    function drawSim() {
      clear(simBox);
      const rows = store.get('loot');
      const tables = Array.from(new Set(rows.map((r) => String(r.table).trim())));
      if (!tables.length) return;
      if (tables.indexOf(simTable) < 0) simTable = tables[0];
      const sel = BPS.ui.select(tables.map((t) => [t, t]), simTable, (v) => { simTable = v; drawSim(); });
      const nIn = numInput(simN, (v) => { simN = Math.max(1, Math.min(1e6, Math.round(v))); }, { min: 1, step: 1000 });
      const result = h('div');
      const run = () => {
        const items = rows.filter((r) => String(r.table).trim() === simTable);
        const freq = F.simulateLoot(items, simN);
        const sum = items.reduce((s, it) => s + (Number(it.chance) > 0 ? Number(it.chance) : 0), 0);
        clear(result).appendChild(h('div', { class: 'table-scroll' }, h('table', { class: 'mini' },
          h('thead', null, h('tr', null, ['Предмет', 'Редкость', 'Шанс в таблице', 'Реальный шанс*', 'Выпало в симуляции'].map((t) => h('th', null, t)))),
          h('tbody', null, items.map((it, i) => {
            const real = sum > 0 ? (Math.max(0, Number(it.chance) || 0) / sum) * 100 : 0;
            return h('tr', null, h('td', null, it.item), h('td', null, RARITY_RU[it.rarity] || it.rarity || '-'),
              h('td', null, fmt(it.chance, 3) + '%'), h('td', null, fmt(real, 3) + '%'),
              h('td', null, h('span', { class: 'bar-cell' }, h('span', { class: 'bar', style: { width: Math.min(freq[i], 100) + '%' } }), fmt(freq[i], 2) + '%')));
          })))));
        result.appendChild(h('p', { class: 'muted' }, '* Если сумма не 100%, игра обычно делит на сумму (весовой выбор). Колонка показывает, во что на деле превратится шанс.'));
      };
      simBox.appendChild(h('div', { class: 'card-head' }, h('h3', null, 'Симуляция бросков')));
      simBox.appendChild(h('div', { class: 'inline-form' }, BPS.ui.field('Таблица', sel), BPS.ui.field('Бросков', nIn),
        h('button', { class: 'btn primary', onclick: run }, 'Бросить')));
      simBox.appendChild(result);
      run();
    }

    function exportReport(fmtType) {
      const rows = store.get('loot');
      const c = F.checkLoot(rows);
      const errByIdx = {};
      c.rowErrors.forEach((e) => { errByIdx[e.index] = e.errors.join('; '); });
      const tOk = {};
      c.tables.forEach((t) => { tOk[t.name] = t; });
      if (fmtType === 'csv') {
        const out = rows.map((r, i) => Object.assign({}, r, {
          table_sum: tOk[String(r.table).trim()] ? tOk[String(r.table).trim()].sum : '',
          table_ok: tOk[String(r.table).trim()] && tOk[String(r.table).trim()].ok ? 'yes' : 'no',
          row_errors: errByIdx[i] || ''
        }));
        download('loot_check.csv', D.toCSV(out), 'text/csv');
      } else {
        download('loot_check.json', JSON.stringify({ checkedAt: new Date().toISOString(), ok: c.ok, tables: c.tables,
          rowErrors: c.rowErrors.map((e) => ({ id: rows[e.index].id, item: rows[e.index].item, errors: e.errors })), rows }, null, 2), 'application/json');
      }
    }

    const head = panel.querySelector('.panel-head');
    head.appendChild(h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onclick: () => exportReport('csv') }, 'Экспорт проверки CSV'),
      h('button', { class: 'btn', onclick: () => exportReport('json') }, 'Экспорт проверки JSON')));

    panel.appendChild(summaryBox);
    const gridCard = h('div', { class: 'card' }, h('h3', null, 'Таблица дропа'));
    panel.appendChild(gridCard);
    const gridApi = BPS.grid.render(gridCard, 'loot', {
      rowClass: (r, i) => (badRows().has(i) ? 'row-error' : badTables().has(String(r.table).trim()) ? 'row-warn' : ''),
      onChange: () => { recheck(); }
    });
    // Подсветка строк зависит от результата проверки: обновляем классы сразу, симуляцию - с задержкой.
    let t = null;
    gridCard.addEventListener('input', () => { gridApi.refreshRowClasses(); clearTimeout(t); t = setTimeout(drawSim, 700); });
    gridCard.addEventListener('click', (e) => { if (e.target.closest('button')) setTimeout(() => { recheck(); gridApi.redraw(); drawSim(); }, 0); });
    panel.appendChild(simBox);
    drawSummary();
    drawSim();
  }

  BPS.modules = BPS.modules || {};
  BPS.modules.loot = { title: 'Лут', render };
})();
