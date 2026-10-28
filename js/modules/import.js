/*
 * Модуль 1. Импорт CSV/JSON: выбор файла или drag&drop, валидация, отчёт об ошибках.
 */
(function () {
  'use strict';
  const { h, clear, toast, readFile } = BPS.ui;
  const D = BPS.data;
  const store = BPS.store;

  let pending = null; // результат последней проверки файла, ждёт подтверждения

  async function handleFiles(files, target, out) {
    for (const f of Array.from(files)) {
      try {
        const text = await readFile(f);
        analyze(f.name, text, target, out);
      } catch (e) {
        showError(out, f.name, 'Не удалось прочитать файл: ' + e.message);
      }
    }
  }

  function analyze(name, text, target, out) {
    let parsed;
    const isJSON = /\.json$/i.test(name) || /^\s*[\[{]/.test(text);
    try {
      if (isJSON) {
        const obj = JSON.parse(String(text).replace(/^﻿/, ''));
        if (obj && obj.format === 'bps-project') return restoreProject(obj, name);
        if (obj && Array.isArray(obj.nodes)) {
          store.set('tree', obj);
          toast('Дерево навыков «' + name + '» загружено - вкладка «Навыки»', 'ok');
          return;
        }
        parsed = D.parseJSON(text);
      } else parsed = D.parseCSV(text);
    } catch (e) {
      return showError(out, name, (isJSON ? 'Ошибка JSON: ' : 'Ошибка CSV: ') + e.message);
    }
    const kind = target === 'auto' ? parsed.kind || D.detectKind(parsed.headers) : target;
    const res = D.validate(parsed, kind);
    pending = { name, kind, res, headers: parsed.headers };
    renderReport(out);
  }

  function restoreProject(obj, name) {
    ['units', 'loot', 'progression', 'economy', 'tree'].forEach((k) => { if (obj[k] !== undefined) store.set(k, obj[k], true); });
    store.set('units', store.get('units')); // одно событие на всё
    toast('Проект из «' + name + '» восстановлен полностью', 'ok');
  }

  function showError(out, name, msg) {
    pending = null;
    clear(out).appendChild(h('div', { class: 'card error-card' }, h('h3', null, name), h('p', null, msg)));
  }

  function renderReport(out) {
    clear(out);
    const p = pending;
    const r = p.res;
    const total = r.validRows.length + new Set(r.rowErrors.map((e) => e.row)).size;
    const card = h('div', { class: 'card' });
    card.appendChild(h('h3', null, p.name, ' ', h('span', { class: 'tag' }, D.SCHEMAS[p.kind].title)));

    if (r.fileErrors.length) {
      card.classList.add('error-card');
      card.appendChild(h('ul', { class: 'errors' }, r.fileErrors.map((e) => h('li', null, e))));
      card.appendChild(h('p', { class: 'muted' }, 'Обязательные колонки для «' + D.SCHEMAS[p.kind].title + '»: ' + D.SCHEMAS[p.kind].required.join(', ')));
      out.appendChild(card);
      return;
    }

    const bad = total - r.validRows.length;
    card.appendChild(h('p', null,
      'Строк в файле: ', h('b', null, total), ' · корректных: ', h('b', { class: 'ok-text' }, r.validRows.length),
      ' · с ошибками: ', h('b', { class: bad ? 'err-text' : '' }, bad)));

    if (r.rowErrors.length) {
      const list = h('table', { class: 'mini' },
        h('thead', null, h('tr', null, h('th', null, 'Строка'), h('th', null, 'Колонка'), h('th', null, 'Проблема'))),
        h('tbody', null, r.rowErrors.slice(0, 100).map((e) =>
          h('tr', null, h('td', null, e.row), h('td', null, e.column || '-'), h('td', null, e.message)))));
      card.appendChild(h('div', { class: 'scroll-y' }, list));
      if (r.rowErrors.length > 100) card.appendChild(h('p', { class: 'muted' }, '…и ещё ' + (r.rowErrors.length - 100)));
    }

    const current = store.get(p.kind).length;
    const actions = h('div', { class: 'row-actions' });
    if (r.validRows.length) {
      actions.appendChild(h('button', { class: 'btn primary', onclick: () => apply('replace') },
        bad ? 'Заменить, взяв только корректные (' + r.validRows.length + ')' : 'Заменить текущие данные'));
      if (current) actions.appendChild(h('button', { class: 'btn', onclick: () => apply('merge') }, 'Добавить к текущим (' + current + ')'));
    }
    actions.appendChild(h('button', { class: 'btn ghost', onclick: () => { pending = null; clear(out); } }, 'Отмена'));
    card.appendChild(actions);
    out.appendChild(card);
  }

  function apply(mode) {
    const p = pending;
    let rows = p.res.validRows;
    if (mode === 'merge') {
      const existing = store.get(p.kind);
      const ids = new Set(existing.map((r) => String(r.id)));
      const fresh = rows.filter((r) => !ids.has(String(r.id)));
      const skipped = rows.length - fresh.length;
      rows = existing.concat(fresh);
      if (skipped) toast('Пропущено строк с уже существующим ID: ' + skipped, 'warn');
    }
    store.set(p.kind, rows);
    toast('Загружено: ' + rows.length + ' строк в «' + D.SCHEMAS[p.kind].title + '»', 'ok');
    pending = null;
    BPS.app.go(p.kind === 'loot' ? 'loot' : 'table');
  }

  function render(root) {
    const out = h('div', { id: 'import-report' });
    let target = 'auto';
    const input = h('input', { type: 'file', accept: '.csv,.json,.txt', multiple: true, id: 'file-input', class: 'visually-hidden' });
    input.addEventListener('change', () => { handleFiles(input.files, target, out); input.value = ''; });

    const drop = h('div', { class: 'dropzone', tabindex: 0, role: 'button', 'aria-label': 'Выбрать файл' },
      h('div', { class: 'drop-icon', html: '<svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>' }),
      h('p', null, h('b', null, 'Перетащите CSV или JSON сюда'), ' или нажмите, чтобы выбрать'),
      h('p', { class: 'muted' }, 'Разделитель «,» или «;» определяется сам. Кодировка UTF-8.'));
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => handleFiles(e.dataTransfer.files, target, out));

    const targetSel = BPS.ui.select([['auto', 'Определить автоматически'], ['units', 'Юниты'], ['loot', 'Лут']], target, (v) => { target = v; });

    const samples = h('div', { class: 'samples' },
      h('span', { class: 'muted' }, 'Тестовые файлы: '),
      Object.keys(BPS.samples).map((n) => h('button', { class: 'chip', onclick: () => analyze(n, BPS.samples[n], target, out) }, n)));

    const units = store.get('units').length;
    const loot = store.get('loot').length;
    root.appendChild(h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', null, 'Импорт данных'),
        h('p', { class: 'muted' }, 'Сейчас загружено: юнитов - ' + units + ', строк лута - ' + loot)),
      h('div', { class: 'grid-2' },
        h('div', null, drop, input, h('div', { class: 'inline-form' }, BPS.ui.field('Тип данных', targetSel)), samples),
        h('div', { class: 'card help' },
          h('h3', null, 'Формат файлов'),
          h('p', null, h('b', null, 'Юниты: '), h('code', null, 'id, name, hp, attack, defense, cost'),
            ' + необязательные ', h('code', null, 'attack_speed, crit_chance, crit_mult, damage_type, res_melee, res_explosive, res_bullet')),
          h('p', null, h('b', null, 'Лут: '), h('code', null, 'id, table, item, chance'), ' + ', h('code', null, 'rarity'), '. Шанс в процентах.'),
          h('p', null, h('b', null, 'JSON: '), 'массив объектов, объект ', h('code', null, '{"units": [...]}'),
            ', полный проект (экспорт «Весь проект») или дерево навыков ', h('code', null, '{"nodes": [...]}'), '.'),
          h('p', { class: 'muted' }, 'Проверяется: обязательные колонки, числа в числовых полях, диапазоны, дубли ID, лишние ячейки.'))),
      out));
    if (pending) renderReport(out);
  }

  BPS.modules = BPS.modules || {};
  BPS.modules.import = { title: 'Импорт', render, analyze };
})();
