/*
 * Доп. модуль. Симулятор инфляции: источники и стоки ресурса, прогноз запаса на N шагов.
 */
(function () {
  'use strict';
  const { h, clear, fmt, field, numInput, select, download, cssVar } = BPS.ui;
  const F = BPS.formulas;
  const D = BPS.data;
  const store = BPS.store;
  let chart = null;

  function render(root) {
    let cfg = JSON.parse(JSON.stringify(store.get('economy')));
    const panel = h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', null, 'Симулятор инфляции'),
        h('p', { class: 'muted' }, 'Шаг - условная единица времени (минута матча, ход). Источник «за шаг» растёт на заданный % каждый шаг; «% от запаса» - доля текущего запаса (налог, содержание).')));
    root.appendChild(panel);

    const itemsBox = h('div', { class: 'table-scroll' });
    const stats = h('div', { class: 'big-numbers' });
    const chartBox = h('div', { class: 'chart-box' }, h('canvas', { role: 'img', 'aria-label': 'Запас ресурса по шагам' }));

    function save() { store.set('economy', cfg, true); }

    function drawItems() {
      clear(itemsBox).appendChild(h('table', { class: 'data' },
        h('thead', null, h('tr', null, ['Название', 'Тип', 'Значение', 'Режим', 'Рост за шаг, %', ''].map((t) => h('th', null, t)))),
        h('tbody', null, cfg.items.map((it, i) => h('tr', null,
          h('td', null, (() => { const x = h('input', { value: it.name, 'aria-label': 'Название' }); x.addEventListener('input', () => { it.name = x.value; save(); }); return x; })()),
          h('td', null, select([['source', 'Источник'], ['sink', 'Сток']], it.kind, (v) => { it.kind = v; save(); run(); })),
          h('td', null, numInput(it.amount, (v) => { it.amount = v; save(); run(); }, { class: 'num' })),
          h('td', null, select([['flat', 'за шаг'], ['percent', '% от запаса']], it.mode, (v) => { it.mode = v; save(); run(); })),
          h('td', null, numInput(it.growth || 0, (v) => { it.growth = v; save(); run(); }, { class: 'num', disabled: it.mode === 'percent' })),
          h('td', { class: 'actions-col' }, h('button', { class: 'icon-btn danger', 'aria-label': 'Удалить', onclick: () => { cfg.items.splice(i, 1); save(); drawItems(); run(); } }, '✕')))))));
    }

    function run() {
      const res = F.simulateEconomy(cfg);
      const last = res[res.length - 1] || { stock: cfg.start };
      const avgGrowth = res.length ? (Math.pow(last.stock / Math.max(cfg.start, 1e-9), 1 / res.length) - 1) * 100 : 0;
      const zeroStep = res.find((r) => r.stock <= 0);
      const ratio = last.stock / Math.max(cfg.start, 1e-9);
      clear(stats);
      stats.appendChild(h('div', null, h('span', { class: 'big' }, fmt(last.stock, 0)), h('small', null, 'запас на шаге ' + cfg.steps)));
      stats.appendChild(h('div', null, h('span', { class: 'big' }, (avgGrowth > 0 ? '+' : '') + fmt(avgGrowth, 2) + '%'), h('small', null, 'средний рост за шаг')));
      stats.appendChild(h('div', null, h('span', { class: 'big' }, '× ' + fmt(last.stock / Math.max(cfg.start, 1e-9), 2)), h('small', null, 'к стартовому запасу')));
      let verdict;
      if (zeroStep) verdict = h('div', { class: 'verdict bad' }, 'Дефицит: ресурс заканчивается на шаге ' + zeroStep.step + '. Стоков больше, чем источников.');
      // Смотрим на итог за весь период, а не на средний % за шаг: 4% за шаг на 30 шагах - это уже рост в 3 раза.
      else if (ratio > 1.5) verdict = h('div', { class: 'verdict bad' }, 'Инфляция: за ' + cfg.steps + ' шагов запас вырос в ' + fmt(ratio, 2) + ' раза - ресурс обесценится, цены придётся поднимать или добавлять стоки.');
      else if (ratio < 0.67) verdict = h('div', { class: 'verdict warn' }, 'Запас тает (осталось ' + fmt(ratio * 100, 0) + '% от старта) - экономика под давлением.');
      else verdict = h('div', { class: 'verdict ok' }, 'Экономика близка к равновесию.');
      stats.appendChild(verdict);
      drawChart(res);
    }

    function drawChart(res) {
      if (!window.Chart) return;
      BPS.ui.chartDefaults();
      const data = {
        labels: res.map((r) => r.step),
        datasets: [
          { type: 'line', label: 'Запас', data: res.map((r) => r.stock), borderColor: cssVar('--accent'), backgroundColor: cssVar('--accent'), yAxisID: 'y', tension: 0.2, pointRadius: 0 },
          { type: 'bar', label: 'Приход', data: res.map((r) => r.inflow), backgroundColor: cssVar('--ok'), yAxisID: 'y2' },
          { type: 'bar', label: 'Расход', data: res.map((r) => -r.outflow), backgroundColor: cssVar('--bad'), yAxisID: 'y2' }
        ]
      };
      if (chart) { chart.data = data; chart.update('none'); return; }
      chart = new Chart(chartBox.querySelector('canvas'), { data,
        options: { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom' } },
          scales: { x: { title: { display: true, text: 'Шаг' } }, y: { title: { display: true, text: 'Запас' } },
            y2: { position: 'right', title: { display: true, text: 'Поток за шаг' }, grid: { drawOnChartArea: false } } } } });
    }

    if (chart) { chart.destroy(); chart = null; }
    panel.appendChild(h('div', { class: 'inline-form' },
      field('Стартовый запас', numInput(cfg.start, (v) => { cfg.start = v; save(); run(); }, { min: 0 })),
      field('Шагов', numInput(cfg.steps, (v) => { cfg.steps = Math.max(1, Math.min(500, Math.round(v))); save(); run(); }, { min: 1, max: 500, step: 1 })),
      h('button', { class: 'btn', onclick: () => { cfg.items.push({ name: 'Новый поток', kind: 'source', amount: 50, mode: 'flat', growth: 0 }); save(); drawItems(); run(); } }, '+ Поток'),
      h('button', { class: 'btn ghost', onclick: () => { store.reset('economy'); } }, 'Сбросить пример'),
      h('button', { class: 'btn', onclick: () => download('economy_forecast.csv', D.toCSV(F.simulateEconomy(cfg)), 'text/csv') }, 'Экспорт прогноза CSV')));
    panel.appendChild(h('div', { class: 'card' }, h('h3', null, 'Источники и стоки'), itemsBox));
    panel.appendChild(h('div', { class: 'card' }, stats, chartBox));
    drawItems();
    run();
  }

  BPS.modules = BPS.modules || {};
  BPS.modules.economy = { title: 'Экономика', render, onLeave: () => { if (chart) { chart.destroy(); chart = null; } } };
})();
