/*
 * ui.js - мелкие помощники для DOM: создание элементов, уведомления, скачивание файлов.
 */
(function () {
  'use strict';

  // h('div', {class: 'x', onclick: fn}, 'текст', child) - короткая запись для createElement.
  function h(tag, attrs) {
    const el = document.createElement(tag);
    const a = attrs || {};
    Object.keys(a).forEach((k) => {
      const v = a[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        // CSS-переменные (--k) через Object.assign(el.style) молча не ставятся, нужен setProperty.
        Object.keys(v).forEach((p) => { if (p.indexOf('--') === 0) el.style.setProperty(p, v[p]); else el.style[p] = v[p]; });
      }
      else if (k.indexOf('on') === 0 && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    });
    for (let i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach((x) => append(el, x));
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }

  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

  function toast(msg, kind) {
    const box = document.getElementById('toasts');
    const t = h('div', { class: 'toast ' + (kind || '') , role: 'status' }, msg);
    box.appendChild(t);
    setTimeout(() => t.classList.add('hide'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsText(file, 'utf-8');
    });
  }

  function fmt(n, d) {
    if (n === null || n === undefined || Number.isNaN(n)) return '-';
    if (n === Infinity) return '∞';
    const digits = d === undefined ? 2 : d;
    return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  }

  // Поле ввода с подписью для форм настроек.
  function field(label, input, hint) {
    return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('small', null, hint) : null);
  }

  function numInput(value, onInput, attrs) {
    const i = h('input', Object.assign({ type: 'number', value: value, step: 'any' }, attrs || {}));
    i.addEventListener('input', () => { const v = Number(i.value); if (i.value !== '' && Number.isFinite(v)) onInput(v); });
    return i;
  }

  function select(options, value, onChange) {
    const s = h('select', null, options.map((o) => h('option', { value: o[0], selected: String(o[0]) === String(value) }, o[1])));
    s.addEventListener('change', () => onChange(s.value));
    return s;
  }

  // Цвета для графиков берём из CSS-переменных, чтобы они менялись вместе с темой.
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.color = cssVar('--text-2');
    Chart.defaults.borderColor = cssVar('--grid');
    Chart.defaults.font.family = cssVar('--font');
    Chart.defaults.locale = 'ru-RU';
  }

  window.BPS = window.BPS || {};
  window.BPS.ui = { h, clear, toast, download, readFile, fmt, field, numInput, select, cssVar, chartDefaults };
})();
