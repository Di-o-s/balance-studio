/*
 * data.js - разбор и сборка CSV/JSON, схемы наборов данных, валидация.
 * Без DOM, поэтому тоже покрыт тестами в Node.
 */
(function (root) {
  'use strict';

  // Схемы наборов данных. required - без этих колонок импорт не пройдёт.
  const SCHEMAS = {
    units: {
      title: 'Юниты',
      key: 'id',
      required: ['id', 'name', 'hp', 'attack', 'defense', 'cost'],
      optional: ['attack_speed', 'crit_chance', 'crit_mult', 'damage_type', 'res_melee', 'res_explosive', 'res_bullet'],
      numeric: ['hp', 'attack', 'defense', 'cost', 'attack_speed', 'crit_chance', 'crit_mult', 'res_melee', 'res_explosive', 'res_bullet'],
      nonNegative: ['hp', 'attack', 'defense', 'cost', 'attack_speed', 'crit_chance'],
      enums: { damage_type: ['melee', 'explosive', 'bullet'] },
      ranges: { crit_chance: [0, 1], crit_mult: [1, 10] }
    },
    loot: {
      title: 'Лут',
      key: 'id',
      required: ['id', 'table', 'item', 'chance'],
      optional: ['rarity'],
      numeric: ['chance'],
      nonNegative: ['chance'],
      enums: {},
      ranges: { chance: [0, 100] }
    }
  };

  // ---------- CSV ----------

  // Разделитель определяем по первой строке: Excel в русской локали сохраняет через ";".
  function detectDelimiter(text) {
    const first = text.split(/\r?\n/)[0] || '';
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQ = false;
    for (const ch of first) {
      if (ch === '"') inQ = !inQ;
      else if (!inQ && ch in counts) counts[ch]++;
    }
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }

  // Парсер CSV по RFC 4180: кавычки, "" внутри кавычек, переносы строк в поле.
  function parseCSV(text, delimiter) {
    text = String(text).replace(/^﻿/, ''); // BOM от Excel
    const d = delimiter || detectDelimiter(text);
    const rows = [];
    let row = [];
    let field = '';
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false;
        } else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === d) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
    if (!nonEmpty.length) return { headers: [], rows: [], delimiter: d };
    const headers = nonEmpty[0].map((h) => h.trim());
    const data = nonEmpty.slice(1).map((r) => {
      const o = {};
      headers.forEach((h, i) => { o[h] = (r[i] === undefined ? '' : r[i]).trim(); });
      o.__extra = r.length > headers.length; // лишние ячейки в строке
      return o;
    });
    return { headers: headers, rows: data, delimiter: d };
  }

  function csvCell(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCSV(rows, headers) {
    const h = headers || collectHeaders(rows);
    return [h.map(csvCell).join(',')]
      .concat(rows.map((r) => h.map((k) => csvCell(r[k])).join(',')))
      .join('\n') + '\n';
  }

  function collectHeaders(rows) {
    const set = [];
    rows.forEach((r) => Object.keys(r).forEach((k) => { if (k.indexOf('__') !== 0 && set.indexOf(k) < 0) set.push(k); }));
    return set;
  }

  // ---------- JSON ----------

  // Принимаем массив объектов или объект вида {units: [...]} / {loot: [...]} / {rows: [...]}.
  function parseJSON(text) {
    const obj = JSON.parse(String(text).replace(/^﻿/, ''));
    let arr = null;
    let kind = null;
    if (Array.isArray(obj)) arr = obj;
    else if (obj && typeof obj === 'object') {
      for (const k of ['units', 'loot', 'rows', 'data', 'items']) {
        if (Array.isArray(obj[k])) { arr = obj[k]; kind = k === 'units' || k === 'loot' ? k : null; break; }
      }
    }
    if (!arr) throw new Error('Ожидался массив объектов или объект с полем units / loot');
    if (arr.some((r) => !r || typeof r !== 'object' || Array.isArray(r))) throw new Error('Каждый элемент массива должен быть объектом');
    // Приводим значения к строкам, чтобы валидация работала одинаково для CSV и JSON.
    const rows = arr.map((r) => {
      const o = {};
      Object.keys(r).forEach((k) => { o[k] = r[k] === null || r[k] === undefined ? '' : String(r[k]); });
      return o;
    });
    return { headers: collectHeaders(rows), rows: rows, kind: kind };
  }

  // ---------- Определение типа и валидация ----------

  function detectKind(headers) {
    const has = (s) => SCHEMAS[s].required.every((c) => headers.indexOf(c) >= 0);
    if (has('units')) return 'units';
    if (has('loot')) return 'loot';
    // Угадываем по количеству совпадений, чтобы показать понятные ошибки.
    const score = (s) => SCHEMAS[s].required.filter((c) => headers.indexOf(c) >= 0).length;
    return score('loot') > score('units') ? 'loot' : 'units';
  }

  function isNumber(s) {
    if (s === '' || s === null || s === undefined) return false;
    return /^-?\d+([.,]\d+)?$/.test(String(s).trim());
  }

  /*
   * Валидация. Возвращает:
   *   fileErrors  - ошибки уровня файла (нет колонок, пустой файл)
   *   rowErrors   - [{row, column, message}] (row - номер строки в файле, с учётом заголовка)
   *   validRows   - строки без ошибок, числа уже приведены к Number
   */
  function validate(parsed, kind) {
    const s = SCHEMAS[kind];
    const fileErrors = [];
    const rowErrors = [];
    const validRows = [];
    if (!parsed.headers.length) fileErrors.push('Файл пустой');
    const missing = s.required.filter((c) => parsed.headers.indexOf(c) < 0);
    if (missing.length) fileErrors.push('Нет обязательных колонок: ' + missing.join(', '));
    if (parsed.rows.length === 0 && !fileErrors.length) fileErrors.push('В файле нет строк с данными');
    const dupH = parsed.headers.filter((h, i) => parsed.headers.indexOf(h) !== i);
    if (dupH.length) fileErrors.push('Повторяются колонки: ' + dupH.join(', '));
    if (fileErrors.length) return { kind, fileErrors, rowErrors, validRows };

    const seen = {};
    parsed.rows.forEach((r, i) => {
      const line = i + 2;
      const errs = [];
      const add = (col, msg) => errs.push({ row: line, column: col, message: msg });
      if (r.__extra) add('', 'в строке больше ячеек, чем колонок в заголовке');
      s.required.forEach((c) => { if (String(r[c] || '').trim() === '') add(c, 'пустое обязательное поле'); });
      s.numeric.forEach((c) => {
        const v = r[c];
        if (v === undefined || v === '') return;
        if (!isNumber(v)) add(c, 'ожидалось число, получено "' + v + '"');
        else {
          const n = Number(String(v).replace(',', '.'));
          if (s.nonNegative.indexOf(c) >= 0 && n < 0) add(c, 'значение не может быть отрицательным');
          const rg = s.ranges[c];
          if (rg && (n < rg[0] || n > rg[1])) add(c, 'значение вне диапазона ' + rg[0] + '…' + rg[1]);
        }
      });
      Object.keys(s.enums).forEach((c) => {
        if (r[c] && s.enums[c].indexOf(r[c]) < 0) add(c, 'допустимо: ' + s.enums[c].join(', '));
      });
      const id = String(r[s.key] || '').trim();
      if (id) {
        if (seen[id]) add(s.key, 'дубль ID (уже был в строке ' + seen[id] + ')');
        else seen[id] = line;
      }
      if (errs.length) rowErrors.push.apply(rowErrors, errs);
      else validRows.push(coerce(r, s));
    });
    return { kind, fileErrors, rowErrors, validRows };
  }

  function coerce(r, s) {
    const o = {};
    Object.keys(r).forEach((k) => {
      if (k.indexOf('__') === 0) return;
      o[k] = s.numeric.indexOf(k) >= 0 && r[k] !== '' ? Number(String(r[k]).replace(',', '.')) : r[k];
    });
    return o;
  }

  const api = { SCHEMAS, detectDelimiter, parseCSV, toCSV, collectHeaders, parseJSON, detectKind, validate, isNumber };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BPS = root.BPS || {};
  root.BPS.data = api;
})(typeof window !== 'undefined' ? window : globalThis);
