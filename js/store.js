/*
 * store.js - состояние приложения и автосохранение в localStorage.
 * Все модули читают и меняют данные только через BPS.store.
 */
(function () {
  'use strict';
  const KEY = 'bps.state.v1';

  const DEFAULTS = {
    units: [],
    loot: [],
    progression: { mode: 'power', base: 100, exponent: 1.6, growth: 1.15, linear: 20, maxLevel: 30, xpPerMinute: 120 },
    economy: {
      start: 1000, steps: 30,
      items: [
        { name: 'Доход городов', kind: 'source', amount: 200, mode: 'flat', growth: 3 },
        { name: 'Награда за бой', kind: 'source', amount: 80, mode: 'flat', growth: 0 },
        { name: 'Найм отрядов', kind: 'sink', amount: 180, mode: 'flat', growth: 2 },
        { name: 'Содержание армии', kind: 'sink', amount: 4, mode: 'percent', growth: 0 }
      ]
    },
    tree: null,
    settings: { theme: 'auto', apiKey: '', ttkA: null, ttkB: null, ttkMult: 1, auditHigh: 1.3, auditLow: 0.7, tab: 'import' }
  };

  const listeners = [];
  let state = load();
  let saveTimer = null;
  let lastSaved = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return clone(DEFAULTS);
      const s = JSON.parse(raw);
      // Подмешиваем дефолты, чтобы старое сохранение не ломало новые поля.
      const merged = Object.assign(clone(DEFAULTS), s);
      merged.settings = Object.assign(clone(DEFAULTS.settings), s.settings || {});
      merged.progression = Object.assign(clone(DEFAULTS.progression), s.progression || {});
      return merged;
    } catch (e) {
      console.warn('Не удалось прочитать сохранение, начинаем с чистого состояния', e);
      return clone(DEFAULTS);
    }
  }

  function saveNow() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      lastSaved = new Date();
      emit('saved');
    } catch (e) {
      console.warn('localStorage недоступен', e);
      emit('save-failed');
    }
  }

  // Сохраняем не на каждое нажатие клавиши, а через 300 мс тишины.
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
  }

  function emit(what, detail) { listeners.forEach((fn) => fn(what, detail)); }

  window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); saveNow(); } });

  window.BPS = window.BPS || {};
  window.BPS.store = {
    get: (k) => state[k],
    set(k, v, silent) { state[k] = v; scheduleSave(); if (!silent) emit('change', k); },
    patch(k, part, silent) { state[k] = Object.assign({}, state[k], part); scheduleSave(); if (!silent) emit('change', k); },
    all: () => state,
    on: (fn) => listeners.push(fn),
    lastSaved: () => lastSaved,
    reset(k) { state[k] = clone(DEFAULTS[k]); saveNow(); emit('change', k); },
    resetAll() { state = clone(DEFAULTS); saveNow(); emit('change', '*'); },
    defaults: () => clone(DEFAULTS)
  };
})();
