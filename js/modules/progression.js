/*
 * Модуль 4. Кривая прогрессии: настраиваемая формула опыта, таблица уровней, график.
 */
(function () {
  'use strict';
  const { h, clear, fmt, field, numInput, select, download, cssVar } = BPS.ui;
  const F = BPS.formulas;
  const D = BPS.data;
  const store = BPS.store;
  let chart = null;

  const PRESETS = {
    'Плавная (как в стратегиях)': { mode: 'power', base: 100, exponent: 1.3, linear: 20, maxLevel: 30 },
    'Крутая (RPG)': { mode: 'power', base: 80, exponent: 2.2, linear: 0, maxLevel: 50 },
    'Экспонента +15%': { mode: 'exponential', base: 100, growth: 1.15, linear: 0, maxLevel: 30 },
    'Ветеранство отряда (5 уровней)': { mode: 'power', base: 50, exponent: 1.8, linear: 25, maxLevel: 5 }
  };

  function formulaText(p) {
    return p.mode === 'exponential'
      ? 'XP(L) = ' + p.base + ' × ' + p.growth + '^(L − 1) + ' + p.linear + ' × L'
      : 'XP(L) = ' + p.base + ' × L^' + p.exponent + ' + ' + p.linear + ' × L';
  }

  function render(root) {
    let p = Object.assign({}, store.get('progression'));
    const panel = h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', null, 'Кривая прогрессии'),
        h('p', { class: 'muted' }, 'XP(L) - сколько опыта нужно, чтобы перейти с уровня L на L+1. Значения округляются до целого.')));
    root.appendChild(panel);

    const form = h('div', { class: 'inline-form' });
    const formulaBox = h('p', { class: 'mono formula-line' });
    const stats = h('div', { class: 'big-numbers' });
    const canvasWrap = h('div', { class: 'chart-box' }, h('canvas', { id: 'prog-chart', 'aria-label': 'График опыта по уровням', role: 'img' }));
    const tableBox = h('div', { class: 'table-scroll tall' });

    function update(part) {
      p = Object.assign({}, p, part);
      if (p.maxLevel > 200) p.maxLevel = 200;
      if (p.maxLevel < 2) p.maxLevel = 2;
      store.set('progression', p, true);
      draw();
    }

    function buildForm() {
      clear(form);
      form.appendChild(field('Формула', select([['power', 'Степенная'], ['exponential', 'Экспоненциальная']], p.mode, (v) => { update({ mode: v }); buildForm(); })));
      form.appendChild(field('base', numInput(p.base, (v) => update({ base: v }), { min: 0 })));
      if (p.mode === 'exponential') form.appendChild(field('growth', numInput(p.growth, (v) => update({ growth: v }), { min: 1, step: 0.01 }), 'рост за уровень'));
      else form.appendChild(field('exponent', numInput(p.exponent, (v) => update({ exponent: v }), { min: 0, step: 0.1 }), 'крутизна'));
      form.appendChild(field('linear', numInput(p.linear, (v) => update({ linear: v }), { step: 1 }), 'линейная добавка'));
      form.appendChild(field('Макс. уровень', numInput(p.maxLevel, (v) => update({ maxLevel: Math.round(v) }), { min: 2, max: 200, step: 1 })));
      form.appendChild(field('XP в минуту', numInput(p.xpPerMinute, (v) => update({ xpPerMinute: v }), { min: 0 }), 'для оценки времени'));
      form.appendChild(field('Пресет', select([['', '-']].concat(Object.keys(PRESETS).map((k) => [k, k])), '', (v) => {
        if (!v) return; update(PRESETS[v]); buildForm();
      })));
    }

    function draw() {
      formulaBox.textContent = formulaText(p);
      const rows = F.progressionTable(p);
      const last = rows[rows.length - 1];
      clear(stats);
      stats.appendChild(h('div', null, h('span', { class: 'big' }, fmt(rows[0].xp, 0)), h('small', null, 'XP до 2-го уровня')));
      stats.appendChild(h('div', null, h('span', { class: 'big' }, fmt(last.xp, 0)), h('small', null, 'XP последнего шага')));
      stats.appendChild(h('div', null, h('span', { class: 'big' }, fmt(last.total, 0)), h('small', null, 'всего до ' + last.level + '-го')));
      if (last.minutes) stats.appendChild(h('div', null, h('span', { class: 'big' }, fmt(last.minutes / 60, 1)), h('small', null, 'часов игры')));

      clear(tableBox).appendChild(h('table', { class: 'data readonly' },
        h('thead', null, h('tr', null, ['Уровень', 'XP на шаг', 'Всего XP', 'Рост шага, %', 'Время, мин'].map((t) => h('th', null, t)))),
        h('tbody', null, rows.map((r) => h('tr', null,
          h('td', null, r.level), h('td', null, fmt(r.xp, 0)), h('td', null, fmt(r.total, 0)),
          h('td', null, r.growthPct === null ? '-' : fmt(r.growthPct, 1)), h('td', null, r.minutes === null ? '-' : fmt(r.minutes, 1)))))));
      drawChart(rows);
    }

    function drawChart(rows) {
      if (!window.Chart) { clear(canvasWrap).appendChild(h('p', { class: 'muted' }, 'Chart.js не загрузился - график недоступен, таблица ниже.')); return; }
      BPS.ui.chartDefaults();
      const c1 = cssVar('--accent'); const c2 = cssVar('--accent-2');
      const data = {
        labels: rows.map((r) => r.level),
        datasets: [
          { label: 'XP на шаг', data: rows.map((r) => r.xp), borderColor: c1, backgroundColor: c1, yAxisID: 'y', tension: 0.25, pointRadius: 2 },
          { label: 'Всего XP', data: rows.map((r) => r.total), borderColor: c2, backgroundColor: c2, yAxisID: 'y2', tension: 0.25, pointRadius: 0, borderDash: [5, 4] }
        ]
      };
      if (chart) { chart.data = data; chart.update('none'); return; }
      chart = new Chart(canvasWrap.querySelector('canvas'), {
        type: 'line', data,
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom' } },
          scales: {
            x: { title: { display: true, text: 'Уровень' } },
            y: { title: { display: true, text: 'XP на шаг' }, beginAtZero: true },
            y2: { position: 'right', title: { display: true, text: 'Всего XP' }, beginAtZero: true, grid: { drawOnChartArea: false } }
          }
        }
      });
    }

    const exportBtns = h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onclick: () => download('progression.csv', D.toCSV(F.progressionTable(p), ['level', 'xp', 'total', 'growthPct', 'minutes']), 'text/csv') }, 'Экспорт CSV'),
      h('button', { class: 'btn', onclick: () => download('progression.json', JSON.stringify({ params: p, formula: formulaText(p), levels: F.progressionTable(p) }, null, 2), 'application/json') }, 'Экспорт JSON'));

    if (chart) { chart.destroy(); chart = null; }
    buildForm();
    panel.appendChild(form);
    panel.appendChild(h('div', { class: 'card' }, formulaBox, stats, canvasWrap));
    panel.appendChild(h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', null, 'Таблица уровней'), exportBtns), tableBox));
    draw();
  }

  BPS.modules = BPS.modules || {};
  BPS.modules.progression = { title: 'Прогрессия', render, onLeave: () => { if (chart) { chart.destroy(); chart = null; } } };
})();
