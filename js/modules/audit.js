/*
 * Доп. модуль. Аудит баланса: ищем «доминирующих» и «бесполезных» юнитов по силе за единицу цены.
 */
(function () {
  'use strict';
  const { h, clear, fmt, field, numInput, cssVar } = BPS.ui;
  const F = BPS.formulas;
  const store = BPS.store;
  let chart = null;

  const VERDICT = { dominant: ['Доминирует', 'bad'], weak: ['Бесполезен', 'warn'], ok: ['В норме', 'ok'] };

  function render(root) {
    const st = store.get('settings');
    let high = st.auditHigh || 1.3;
    let low = st.auditLow || 0.7;
    const panel = h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', null, 'Аудит баланса'),
        h('p', { class: 'muted' }, 'Сила = √(DPS × EHP): DPS по «среднему» врагу, EHP - сколько урона юнит выдержит от «среднего» атакующего. ' +
          'Ценность = сила / цена. Сравниваем с медианой по всем юнитам.')));
    root.appendChild(panel);
    const units = store.get('units');
    if (units.length < 3) { panel.appendChild(h('div', { class: 'empty' }, 'Для аудита нужно хотя бы 3 юнита.')); return; }

    const box = h('div');
    const chartBox = h('div', { class: 'chart-box' }, h('canvas', { role: 'img', 'aria-label': 'Ценность юнитов относительно медианы' }));

    function draw() {
      const rows = F.auditUnits(units, { high, low }).sort((a, b) => b.ratio - a.ratio);
      clear(box);
      const dom = rows.filter((r) => r.verdict === 'dominant');
      const weak = rows.filter((r) => r.verdict === 'weak');
      box.appendChild(h('div', { class: 'cards-row' },
        h('div', { class: 'card stat bad' }, h('span', { class: 'big' }, dom.length), h('small', null, 'доминирующих'), h('p', null, dom.map((r) => r.name).join(', ') || '-')),
        h('div', { class: 'card stat warn' }, h('span', { class: 'big' }, weak.length), h('small', null, 'бесполезных'), h('p', null, weak.map((r) => r.name).join(', ') || '-'))));
      box.appendChild(h('div', { class: 'table-scroll' }, h('table', { class: 'data readonly' },
        h('thead', null, h('tr', null, ['Юнит', 'DPS', 'EHP', 'Сила', 'Цена', 'Сила / цена', 'к медиане', 'Вердикт'].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map((r) => {
          const u = units.find((x) => String(x.id) === String(r.id));
          const v = VERDICT[r.verdict];
          return h('tr', { class: r.verdict === 'dominant' ? 'row-error' : r.verdict === 'weak' ? 'row-warn' : '' },
            h('td', null, r.name), h('td', null, fmt(r.dps)), h('td', null, fmt(r.ehp, 0)), h('td', null, fmt(r.power, 1)),
            h('td', null, fmt(u.cost, 0)), h('td', null, fmt(r.value, 3)), h('td', null, '× ' + fmt(r.ratio)),
            h('td', null, h('span', { class: 'pill ' + v[1] }, v[0])));
        })))));
      drawChart(rows);
    }

    function drawChart(rows) {
      if (!window.Chart) return;
      BPS.ui.chartDefaults();
      const col = (r) => (r.verdict === 'dominant' ? cssVar('--bad') : r.verdict === 'weak' ? cssVar('--warn') : cssVar('--accent'));
      const data = { labels: rows.map((r) => r.name), datasets: [{ label: 'Ценность к медиане', data: rows.map((r) => r.ratio), backgroundColor: rows.map(col), borderRadius: 4 }] };
      if (chart) chart.destroy();
      chart = new Chart(chartBox.querySelector('canvas'), {
        type: 'bar', data,
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, animation: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => '× ' + c.raw.toFixed(2) + ' к медиане' } } },
          scales: { x: { beginAtZero: true, title: { display: true, text: 'Сила за единицу цены / медиана' } } } }
      });
    }

    panel.appendChild(h('div', { class: 'inline-form' },
      field('Порог «доминирует», ×', numInput(high, (v) => { high = v; store.patch('settings', { auditHigh: v }, true); draw(); }, { step: 0.05, min: 1 })),
      field('Порог «бесполезен», ×', numInput(low, (v) => { low = v; store.patch('settings', { auditLow: v }, true); draw(); }, { step: 0.05, min: 0, max: 1 }))));
    panel.appendChild(box);
    panel.appendChild(h('div', { class: 'card' }, chartBox));
    panel.appendChild(h('p', { class: 'muted' }, 'Эвристика грубая: она не видит дальность, скорость передвижения и роли (например, артиллерия слабая в дуэли, но бьёт из-за линии фронта). ' +
      'Вердикт - повод посмотреть на юнит внимательнее, а не готовое решение.'));
    draw();
  }

  BPS.modules = BPS.modules || {};
  BPS.modules.audit = { title: 'Аудит', render, onLeave: () => { if (chart) { chart.destroy(); chart = null; } } };
})();
