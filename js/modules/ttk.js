/*
 * Модуль 3. Калькулятор урона и TTK. Показывает расчёт по шагам с подставленными числами,
 * дуэль в обе стороны и матрицу TTK «каждый против каждого».
 */
(function () {
  'use strict';
  const { h, clear, fmt, field, numInput, select, download } = BPS.ui;
  const F = BPS.formulas;
  const store = BPS.store;

  const TYPE_RU = { melee: 'ближний бой', explosive: 'взрывы', bullet: 'пули' };

  function unitsList() {
    return store.get('units').filter((u) => u.id !== '' && u.name !== undefined);
  }

  function byId(id) { return unitsList().find((u) => String(u.id) === String(id)); }

  function breakdown(a, t, mult) {
    const A = F.normalizeUnit(a);
    const T = F.normalizeUnit(t);
    const r = F.ttk(a, t, { multiplier: mult });
    const diff = A.attack - T.defense;
    const minD = A.attack * F.MIN_DAMAGE_SHARE;
    const raw = Math.max(diff, minD);
    const resist = Math.min(T['res_' + A.damage_type], 0.9);
    const lines = [
      ['Атака − защита', fmt(A.attack) + ' − ' + fmt(T.defense) + ' = ' + fmt(diff)],
      ['Минимум (10% атаки)', fmt(A.attack) + ' × 0,1 = ' + fmt(minD) + (diff < minD ? '  ← берём минимум' : '')],
      ['Сопротивление цели', TYPE_RU[A.damage_type] + ': ' + fmt(resist * 100) + '% → × ' + fmt(1 - resist, 3)],
      ['Множитель', '× ' + fmt(mult, 3)],
      ['Урон без крита', fmt(raw) + ' × ' + fmt(1 - resist, 3) + ' × ' + fmt(mult, 3) + ' = ' + fmt(r.base, 3)],
      ['Средний урон с критами', fmt(r.base, 3) + ' × (1 + ' + fmt(A.crit_chance, 3) + ' × (' + fmt(A.crit_mult) + ' − 1)) = ' + fmt(r.expected, 3)],
      ['Ударов до убийства', '⌈' + fmt(T.hp) + ' / ' + fmt(r.expected, 3) + '⌉ = ' + r.hitsExpected],
      ['TTK', r.hitsExpected + ' / ' + fmt(A.attack_speed) + ' уд/с = ' + fmt(r.ttkExpected) + ' с']
    ];
    return { r, lines };
  }

  function resultCard(title, a, t, mult) {
    const { r, lines } = breakdown(a, t, mult);
    return h('div', { class: 'card' },
      h('h3', null, title),
      h('div', { class: 'big-numbers' },
        h('div', null, h('span', { class: 'big' }, fmt(r.ttkExpected)), h('small', null, 'TTK, с (среднее)')),
        h('div', null, h('span', { class: 'big' }, fmt(r.dps)), h('small', null, 'DPS')),
        h('div', null, h('span', { class: 'big' }, r.hitsExpected === Infinity ? '∞' : r.hitsExpected), h('small', null, 'ударов'))),
      h('p', { class: 'muted' }, 'Без критов: ' + fmt(r.ttkNoCrit) + ' с (' + r.hitsNoCrit + ' уд.) · все удары критами: ' + fmt(r.ttkAllCrit) + ' с (' + r.hitsAllCrit + ' уд.)'),
      h('table', { class: 'mini calc' }, h('tbody', null, lines.map((l) => h('tr', null, h('td', null, l[0]), h('td', { class: 'mono' }, l[1]))))));
  }

  function matrix(units, mult) {
    return units.map((a) => units.map((t) => F.ttk(a, t, { multiplier: mult }).ttkExpected));
  }

  function render(root) {
    const units = unitsList();
    const st = store.get('settings');
    const panel = h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', null, 'Калькулятор урона и TTK')));
    root.appendChild(panel);

    if (units.length < 1) {
      panel.appendChild(h('div', { class: 'empty' }, 'Нужен хотя бы один юнит. Загрузите данные на вкладке «Импорт».'));
      return;
    }
    let aId = byId(st.ttkA) ? st.ttkA : units[0].id;
    let bId = byId(st.ttkB) ? st.ttkB : (units[1] || units[0]).id;
    let mult = Number(st.ttkMult) || 1;

    const opts = units.map((u) => [u.id, u.name + ' (#' + u.id + ')']);
    const out = h('div', { class: 'grid-2' });
    const duelBox = h('div');
    const matrixBox = h('div', { class: 'card' });

    const formula = h('div', { class: 'card formula' },
      h('h3', null, 'Формула'),
      h('p', { class: 'mono' }, 'урон = max(атака − защита, 0,1 × атака) × (1 − сопротивление[тип]) × множитель'),
      h('p', { class: 'mono' }, 'средний урон = урон × (1 + шанс_крита × (множитель_крита − 1))'),
      h('p', { class: 'mono' }, 'TTK = ⌈HP цели / средний урон⌉ / скорость атаки'),
      h('p', { class: 'muted' }, 'Почему так: вычитание защиты делает броню понятной (каждая единица защиты снимает единицу урона), ' +
        'а нижняя планка 10% не даёт юниту стать неуязвимым. Сопротивления по типу урона нужны для контрпиков: танк держит пули, ' +
        'но уязвим к взрывам. Первый удар происходит через 1/скорость секунд, поэтому TTK = удары / скорость.'));

    function draw() {
      const a = byId(aId); const b = byId(bId);
      clear(out);
      out.appendChild(resultCard(a.name + ' → ' + b.name, a, b, mult));
      out.appendChild(resultCard(b.name + ' → ' + a.name, b, a, mult));
      const d = F.duel(a, b, { multiplier: mult });
      clear(duelBox).appendChild(h('div', { class: 'verdict ' + (d.winner === 'draw' ? '' : 'ok') },
        d.winner === 'draw' ? 'Ничья: оба убивают друг друга за ' + fmt(d.ab.ttkExpected) + ' с'
          : 'В дуэли 1 на 1 побеждает ' + (d.winner === 'a' ? a.name : b.name) + ': ' +
            fmt(Math.min(d.ab.ttkExpected, d.ba.ttkExpected)) + ' с против ' + fmt(Math.max(d.ab.ttkExpected, d.ba.ttkExpected)) + ' с'));
      drawMatrix();
    }

    function drawMatrix() {
      clear(matrixBox);
      const us = unitsList();
      const m = matrix(us, mult);
      const finite = m.flat().filter(Number.isFinite);
      const max = Math.max.apply(null, finite.concat([1]));
      const min = Math.min.apply(null, finite.concat([0]));
      matrixBox.appendChild(h('div', { class: 'card-head' },
        h('h3', null, 'Матрица TTK, с'),
        h('button', { class: 'btn small', onclick: () => {
          const head = ['атакующий \\ цель'].concat(us.map((u) => u.name));
          const rows = us.map((u, i) => [u.name].concat(m[i].map((v) => (Number.isFinite(v) ? v.toFixed(2) : 'inf'))));
          download('ttk_matrix.csv', [head].concat(rows).map((r) => r.map((c) => (/[,"]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',')).join('\n') + '\n', 'text/csv');
        } }, 'Экспорт CSV')));
      matrixBox.appendChild(h('p', { class: 'muted' }, 'Строка - кто атакует, столбец - по кому. Чем зеленее, тем быстрее убивает. Клик по ячейке - открыть пару сверху.'));
      const table = h('table', { class: 'heat' },
        h('thead', null, h('tr', null, h('th', null, ''), us.map((u) => h('th', { class: 'vert' }, h('span', null, u.name))))),
        h('tbody', null, us.map((a, i) => h('tr', null, h('th', null, a.name), m[i].map((v, j) => {
          const k = Number.isFinite(v) ? (Math.log(v + 1) - Math.log(min + 1)) / (Math.log(max + 1) - Math.log(min + 1) || 1) : 1;
          return h('td', {
            style: { '--k': k.toFixed(3) },
            class: String(a.id) === String(aId) && String(us[j].id) === String(bId) ? 'sel' : '',
            title: a.name + ' → ' + us[j].name + ': ' + fmt(v) + ' с',
            onclick: () => { aId = a.id; bId = us[j].id; store.patch('settings', { ttkA: aId, ttkB: bId }, true); render2(); }
          }, Number.isFinite(v) ? fmt(v, 1) : '∞');
        })))));
      matrixBox.appendChild(h('div', { class: 'table-scroll' }, table));
    }

    const selA = select(opts, aId, (v) => { aId = v; store.patch('settings', { ttkA: v }, true); draw(); });
    const selB = select(opts, bId, (v) => { bId = v; store.patch('settings', { ttkB: v }, true); draw(); });
    const multIn = numInput(mult, (v) => { mult = v; store.patch('settings', { ttkMult: v }, true); draw(); }, { min: 0, step: 0.05 });
    const swap = h('button', { class: 'btn', onclick: () => { const t = aId; aId = bId; bId = t; selA.value = aId; selB.value = bId; draw(); } }, '⇄ Поменять');

    function render2() { selA.value = aId; selB.value = bId; draw(); }

    panel.appendChild(h('div', { class: 'inline-form' },
      field('Атакующий', selA), swap, field('Цель', selB),
      field('Множитель урона', multIn, 'бафф, местность, мораль')));
    panel.appendChild(duelBox);
    panel.appendChild(out);
    panel.appendChild(formula);
    panel.appendChild(matrixBox);
    draw();
  }

  BPS.modules = BPS.modules || {};
  BPS.modules.ttk = { title: 'Урон / TTK', render };
})();
