/*
 * app.js - вкладки, тема, горячие клавиши, общий экспорт.
 */
(function () {
  'use strict';
  const { h, clear, toast, download } = BPS.ui;
  const D = BPS.data;
  const store = BPS.store;

  const TABS = ['import', 'table', 'ttk', 'progression', 'loot', 'audit', 'economy', 'tree', 'assistant'];
  let current = null;

  function go(tab) {
    if (TABS.indexOf(tab) < 0) tab = 'import';
    const prev = BPS.modules[current];
    if (prev && prev.onLeave) prev.onLeave();
    current = tab;
    store.patch('settings', { tab }, true);
    if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
    document.querySelectorAll('.tabs [data-tab]').forEach((b) => {
      const on = b.getAttribute('data-tab') === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const main = clear(document.getElementById('main'));
    try {
      BPS.modules[tab].render(main);
    } catch (e) {
      console.error(e);
      main.appendChild(h('div', { class: 'verdict bad' }, 'Ошибка в модуле: ' + e.message + '. Данные не потеряны - попробуйте другую вкладку или импорт заново.'));
    }
    updateBadges();
  }

  function updateBadges() {
    const set = (tab, n) => {
      const b = document.querySelector('.tabs [data-tab="' + tab + '"] .badge');
      if (b) { b.textContent = n || ''; b.hidden = !n; }
    };
    set('table', store.get('units').length);
    const loot = store.get('loot');
    const bad = loot.length ? BPS.formulas.checkLoot(loot).ok ? 0 : '!' : 0;
    set('loot', bad || loot.length);
    const lb = document.querySelector('.tabs [data-tab="loot"] .badge');
    if (lb) lb.classList.toggle('bad', bad === '!');
  }

  // ---------- Экспорт ----------

  function exportData(what, format) {
    const stamp = new Date().toISOString().slice(0, 10);
    if (what === 'project') {
      const s = Object.assign({ format: 'bps-project', version: 1, exportedAt: new Date().toISOString() }, store.all());
      const copy = JSON.parse(JSON.stringify(s));
      delete copy.settings; // ключ API и настройки интерфейса не выгружаем
      return download('balance_project_' + stamp + '.json', JSON.stringify(copy, null, 2), 'application/json');
    }
    const rows = store.get(what);
    if (!rows.length) return toast('Нечего экспортировать: «' + D.SCHEMAS[what].title + '» пусто', 'warn');
    if (format === 'csv') {
      const cols = BPS.grid.columnsFor(what, rows).filter((c) => rows.some((r) => r[c] !== undefined && r[c] !== ''));
      download(what + '_' + stamp + '.csv', D.toCSV(rows, cols), 'text/csv');
    } else {
      download(what + '_' + stamp + '.json', JSON.stringify({ [what]: rows }, null, 2), 'application/json');
    }
  }

  function buildExportMenu() {
    const menu = document.getElementById('export-menu');
    const items = [
      ['Юниты → CSV', () => exportData('units', 'csv')],
      ['Юниты → JSON', () => exportData('units', 'json')],
      ['Лут → CSV', () => exportData('loot', 'csv')],
      ['Лут → JSON', () => exportData('loot', 'json')],
      ['Весь проект → JSON', () => exportData('project')]
    ];
    items.forEach(([label, fn]) => menu.appendChild(h('button', { role: 'menuitem', onclick: () => { fn(); closeMenu(); } }, label)));
    const btn = document.getElementById('export-btn');
    btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.hidden; menu.hidden = !open; btn.setAttribute('aria-expanded', open); });
    document.addEventListener('click', closeMenu);
    function closeMenu() { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  }

  // ---------- Тема ----------

  function applyTheme(t) {
    const root = document.documentElement;
    if (t === 'auto') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
    const label = { auto: 'Авто', light: 'Светлая', dark: 'Тёмная' }[t];
    document.getElementById('theme-btn').title = 'Тема: ' + label + ' (Alt+T)';
    document.getElementById('theme-btn').setAttribute('aria-label', 'Тема: ' + label);
  }
  function cycleTheme() {
    const order = ['auto', 'dark', 'light'];
    const t = order[(order.indexOf(store.get('settings').theme) + 1) % order.length];
    store.patch('settings', { theme: t }, true);
    applyTheme(t);
    go(current); // перерисовать графики с новыми цветами
    toast('Тема: ' + { auto: 'как в системе', dark: 'тёмная', light: 'светлая' }[t]);
  }

  // ---------- Горячие клавиши ----------

  function hotkeys(e) {
    const typing = /input|textarea|select/i.test(e.target.tagName);
    if (e.altKey && !e.ctrlKey && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); go(TABS[Number(e.code.slice(5)) - 1]); return; }
    if (e.altKey && e.code === 'KeyT') { e.preventDefault(); cycleTheme(); return; }
    if (e.altKey && e.code === 'KeyN' && (current === 'table' || current === 'loot')) {
      e.preventDefault();
      const btn = document.querySelector('#main .toolbar .btn.primary');
      if (btn) btn.click();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') { e.preventDefault(); exportData('project'); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyO') { e.preventDefault(); go('import'); setTimeout(() => { const i = document.getElementById('file-input'); if (i) i.click(); }, 0); return; }
    if (!typing && (e.key === '?' || (e.shiftKey && e.code === 'Slash'))) { e.preventDefault(); toggleHelp(); return; }
    if (e.key === 'Escape') { const d = document.getElementById('help'); if (d.open) d.close(); }
  }

  function toggleHelp() {
    const d = document.getElementById('help');
    if (d.open) d.close(); else d.showModal();
  }

  function init() {
    const tabs = document.querySelector('.tabs');
    TABS.forEach((t, i) => tabs.appendChild(h('button', {
      role: 'tab', 'data-tab': t, title: BPS.modules[t].title + ' (Alt+' + (i + 1) + ')', onclick: () => go(t)
    }, h('span', { class: 'tab-num' }, i + 1), BPS.modules[t].title, h('span', { class: 'badge', hidden: true }))));
    buildExportMenu();
    applyTheme(store.get('settings').theme);
    document.getElementById('theme-btn').addEventListener('click', cycleTheme);
    document.getElementById('help-btn').addEventListener('click', toggleHelp);
    document.getElementById('reset-btn').addEventListener('click', () => {
      if (confirm('Удалить все данные из этого браузера? Перед этим можно сделать экспорт «Весь проект».')) { store.resetAll(); go('import'); toast('Данные очищены', 'warn'); }
    });
    document.addEventListener('keydown', hotkeys);
    window.addEventListener('hashchange', () => go(location.hash.slice(1)));
    const saved = document.getElementById('saved');
    store.on((what, k) => {
      if (what === 'saved') { saved.textContent = 'Сохранено ' + new Date().toLocaleTimeString('ru-RU'); saved.classList.remove('err-text'); updateBadges(); }
      if (what === 'save-failed') { saved.textContent = 'Не удалось сохранить (localStorage недоступен)'; saved.classList.add('err-text'); }
      if (what === 'change') go(current);
    });
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (store.get('settings').theme === 'auto') go(current); });
    }
    // На GitHub Pages ссылка на исходники собирается сама: user.github.io/repo -> github.com/user/repo
    const m = location.hostname.match(/^([\w-]+)\.github\.io$/);
    const link = document.getElementById('repo-link');
    if (m) link.href = 'https://github.com/' + m[1] + '/' + (location.pathname.split('/')[1] || '');
    else link.hidden = true;
    go(location.hash.slice(1) || store.get('settings').tab || 'import');
  }

  BPS.app = { go, exportData };
  document.addEventListener('DOMContentLoaded', init);
})();
