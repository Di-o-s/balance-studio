/*
 * Доп. модуль. Визуализатор дерева навыков из JSON: {nodes: [{id, name, cost, requires: [...]}]}.
 * Узлы раскладываются по столбцам в зависимости от глубины (длины самой длинной цепочки требований).
 */
(function () {
  'use strict';
  const { h, clear, toast, readFile, download } = BPS.ui;
  const F = BPS.formulas;
  const store = BPS.store;
  const NS = 'http://www.w3.org/2000/svg';

  function s(tag, attrs, text) {
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
    if (text !== undefined) el.textContent = text;
    return el;
  }

  // Все предки узла (что нужно изучить, чтобы его открыть).
  function ancestors(id, byId, acc) {
    acc = acc || new Set();
    ((byId[id] && byId[id].requires) || []).forEach((r) => { if (byId[r] && !acc.has(r)) { acc.add(r); ancestors(r, byId, acc); } });
    return acc;
  }

  function render(root) {
    const panel = h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', null, 'Дерево навыков'),
        h('p', { class: 'muted' }, 'Клик по узлу - подсветить всё, что нужно для него изучить, и посчитать полную стоимость.')));
    root.appendChild(panel);
    const tree = store.get('tree');
    const info = h('div', { class: 'card tree-info' });
    const svgBox = h('div', { class: 'tree-box' });
    const errBox = h('div');
    const textarea = h('textarea', { class: 'json-edit', spellcheck: 'false', 'aria-label': 'JSON дерева' });
    textarea.value = tree ? JSON.stringify(tree, null, 2) : '';
    const fileIn = h('input', { type: 'file', accept: '.json', class: 'visually-hidden' });
    fileIn.addEventListener('change', async () => {
      if (!fileIn.files[0]) return;
      textarea.value = await readFile(fileIn.files[0]);
      apply();
    });

    function apply() {
      try {
        const obj = JSON.parse(textarea.value);
        if (!obj || !Array.isArray(obj.nodes)) throw new Error('нужен объект с массивом nodes');
        if (obj.nodes.some((n) => !n || n.id === undefined)) throw new Error('у каждого узла должен быть id');
        store.set('tree', obj, true);
        draw(obj);
        toast('Дерево применено', 'ok');
      } catch (e) {
        clear(errBox).appendChild(h('div', { class: 'verdict bad' }, 'Ошибка JSON: ' + e.message));
      }
    }

    function draw(t) {
      clear(svgBox); clear(errBox); clear(info);
      if (!t || !t.nodes || !t.nodes.length) {
        svgBox.appendChild(h('div', { class: 'empty' }, 'Дерево не загружено. Нажмите «Пример» или вставьте JSON.'));
        return;
      }
      const nodes = t.nodes.map((n) => Object.assign({}, n, { id: String(n.id), requires: (n.requires || []).map(String) }));
      const an = F.analyzeTree(nodes);
      if (an.errors.length) errBox.appendChild(h('ul', { class: 'errors' }, an.errors.map((e) => h('li', null, e))));
      const byId = {};
      nodes.forEach((n) => { byId[n.id] = n; });
      const branches = Array.from(new Set(nodes.map((n) => n.branch || '')));
      const cols = {};
      nodes.forEach((n) => { const d = an.depth[n.id] || 0; (cols[d] = cols[d] || []).push(n); });
      Object.values(cols).forEach((c) => c.sort((a, b) => branches.indexOf(a.branch || '') - branches.indexOf(b.branch || '') || String(a.name).localeCompare(String(b.name), 'ru')));
      const W = 190; const H = 64; const GX = 70; const GY = 22;
      const maxRows = Math.max.apply(null, Object.values(cols).map((c) => c.length));
      const ncol = Object.keys(cols).length;
      const width = ncol * W + (ncol - 1) * GX + 40;
      const height = maxRows * H + (maxRows - 1) * GY + 40;
      const pos = {};
      Object.keys(cols).forEach((d) => {
        const c = cols[d];
        const offset = ((maxRows - c.length) * (H + GY)) / 2;
        c.forEach((n, i) => { pos[n.id] = { x: 20 + Number(d) * (W + GX), y: 20 + offset + i * (H + GY) }; });
      });
      const svg = s('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, class: 'tree-svg', role: 'img', 'aria-label': t.title || 'Дерево навыков' });
      const edges = s('g', { class: 'edges' });
      const gNodes = s('g', { class: 'nodes' });
      svg.appendChild(edges); svg.appendChild(gNodes);
      const branchIdx = (n) => branches.indexOf(n.branch || '') % 5;
      nodes.forEach((n) => n.requires.forEach((r) => {
        if (!pos[r]) return;
        const a = pos[r]; const b = pos[n.id];
        const x1 = a.x + W; const y1 = a.y + H / 2; const x2 = b.x; const y2 = b.y + H / 2;
        const mx = (x1 + x2) / 2;
        edges.appendChild(s('path', { d: 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2, 'data-from': r, 'data-to': n.id }));
      }));
      nodes.forEach((n) => {
        const p = pos[n.id];
        const g = s('g', { class: 'node b' + branchIdx(n), transform: 'translate(' + p.x + ',' + p.y + ')', tabindex: 0, 'data-id': n.id });
        g.appendChild(s('rect', { width: W, height: H, rx: 10 }));
        g.appendChild(s('text', { x: 12, y: 24, class: 'n-title' }, String(n.name || n.id).slice(0, 24)));
        g.appendChild(s('text', { x: 12, y: 46, class: 'n-sub' }, (n.branch ? n.branch + ' · ' : '') + 'цена ' + (n.cost === undefined ? '?' : n.cost)));
        const pick = () => select(n.id);
        g.addEventListener('click', pick);
        g.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
        gNodes.appendChild(g);
      });
      svgBox.appendChild(svg);

      function select(id) {
        const need = ancestors(id, byId);
        const all = new Set(need); all.add(id);
        gNodes.querySelectorAll('.node').forEach((g) => {
          const nid = g.getAttribute('data-id');
          g.classList.toggle('active', nid === id);
          g.classList.toggle('path', need.has(nid));
          g.classList.toggle('dim', !all.has(nid));
        });
        edges.querySelectorAll('path').forEach((e) => e.classList.toggle('path', all.has(e.getAttribute('data-from')) && all.has(e.getAttribute('data-to'))));
        const n = byId[id];
        const total = Array.from(all).reduce((sum, k) => sum + (Number(byId[k].cost) || 0), 0);
        clear(info).appendChild(h('div', null,
          h('h3', null, n.name || n.id),
          n.effect ? h('p', null, n.effect) : null,
          h('p', null, 'Требует: ', n.requires.length ? n.requires.map((r) => (byId[r] ? byId[r].name : r)).join(', ') : 'ничего'),
          h('p', null, 'Полный путь: ', h('b', null, all.size + ' узл.'), ', стоимость ', h('b', null, total), ' очков')));
      }
      const totalCost = nodes.reduce((sum, n) => sum + (Number(n.cost) || 0), 0);
      info.appendChild(h('p', { class: 'muted' }, (t.title ? t.title + ': ' : '') + nodes.length + ' узлов, глубина ' + ncol + ', открыть всё стоит ' + totalCost + ' очков.'));
    }

    panel.appendChild(h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onclick: () => { textarea.value = BPS.samples['skilltree_combatmap.json']; apply(); } }, 'Пример'),
      h('button', { class: 'btn', onclick: () => fileIn.click() }, 'Открыть JSON'), fileIn,
      h('button', { class: 'btn', onclick: () => { const t = store.get('tree'); if (t) download('skilltree.json', JSON.stringify(t, null, 2), 'application/json'); } }, 'Экспорт JSON')));
    panel.appendChild(errBox);
    panel.appendChild(h('div', { class: 'card' }, svgBox));
    panel.appendChild(info);
    panel.appendChild(h('details', { class: 'card' }, h('summary', null, 'Редактировать JSON'), textarea,
      h('div', { class: 'row-actions' }, h('button', { class: 'btn primary', onclick: apply }, 'Применить'))));
    draw(tree);
  }

  BPS.modules = BPS.modules || {};
  BPS.modules.tree = { title: 'Навыки', render };
})();
