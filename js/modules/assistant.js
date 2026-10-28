/*
 * Доп. модуль. Ассистент: отправляет в DeepSeek API агрегированную сводку (не сырые таблицы)
 * и показывает текстовое объяснение. Баланс автоматически не меняется.
 */
(function () {
  'use strict';
  const { h, clear, toast } = BPS.ui;
  const F = BPS.formulas;
  const store = BPS.store;
  const ENDPOINT = 'https://api.deepseek.com/chat/completions';

  function r2(n) { return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; }

  // Собираем сводку: только агрегаты и вердикты, без всех строк таблиц.
  function buildSummary() {
    const units = store.get('units');
    const out = { units_count: units.length };
    if (units.length) {
      const stat = (k) => {
        const v = units.map((u) => Number(u[k])).filter(Number.isFinite);
        return { min: Math.min.apply(null, v), max: Math.max.apply(null, v), avg: r2(v.reduce((a, b) => a + b, 0) / v.length) };
      };
      out.unit_stats = { hp: stat('hp'), attack: stat('attack'), defense: stat('defense'), cost: stat('cost') };
      if (units.length >= 3) {
        out.audit = F.auditUnits(units).map((r) => ({ name: r.name, value_to_median: r2(r.ratio), verdict: r.verdict, dps: r2(r.dps), ehp: r2(r.ehp) }));
      }
      const pairs = [];
      units.forEach((a) => units.forEach((b) => { if (a !== b) pairs.push({ a: a.name, b: b.name, ttk: F.ttk(a, b).ttkExpected }); }));
      const fin = pairs.filter((p) => Number.isFinite(p.ttk)).sort((x, y) => x.ttk - y.ttk);
      out.ttk_fastest = fin.slice(0, 5).map((p) => p.a + ' → ' + p.b + ': ' + r2(p.ttk) + ' с');
      out.ttk_slowest = fin.slice(-5).reverse().map((p) => p.a + ' → ' + p.b + ': ' + r2(p.ttk) + ' с');
    }
    const loot = store.get('loot');
    if (loot.length) {
      const c = F.checkLoot(loot);
      out.loot = { tables: c.tables, rows_with_errors: c.rowErrors.length };
    }
    const p = store.get('progression');
    const prog = F.progressionTable(p);
    out.progression = { params: p, first_step_xp: prog[0].xp, last_step_xp: prog[prog.length - 1].xp, total_xp: prog[prog.length - 1].total };
    const eco = F.simulateEconomy(store.get('economy'));
    if (eco.length) out.economy = { start: store.get('economy').start, steps: eco.length, final_stock: r2(eco[eco.length - 1].stock) };
    out.damage_formula = 'max(atk - def, 0.1*atk) * (1 - resist[type]) ; crit: *(1 + p*(k-1)) ; TTK = ceil(hp/dmg)/attack_speed';
    return out;
  }

  function render(root) {
    const st = store.get('settings');
    const panel = h('section', { class: 'panel' },
      h('header', { class: 'panel-head' }, h('h2', null, 'Ассистент по балансу'),
        h('p', { class: 'muted' }, 'Отправляет в DeepSeek сводку ниже и просит объяснить, что не так с балансом. Ответ - только текст, данные в сервисе не меняются.')));
    root.appendChild(panel);

    const keyIn = h('input', { type: 'password', placeholder: 'sk-…', value: st.apiKey || '', autocomplete: 'off', 'aria-label': 'API-ключ DeepSeek' });
    const remember = h('input', { type: 'checkbox', checked: !!st.apiKey });
    const question = h('textarea', { rows: 3, class: 'question' });
    question.value = 'Какие юниты выбиваются из баланса и почему? Предложи 3 конкретные правки статов с объяснением.';
    const payloadPre = h('pre', { class: 'payload' });
    const answer = h('div', { class: 'answer' });
    const sendBtn = h('button', { class: 'btn primary', onclick: send }, 'Спросить ассистента');

    function refreshPayload() { payloadPre.textContent = JSON.stringify(buildSummary(), null, 2); }

    async function send() {
      const key = keyIn.value.trim();
      if (!key) { toast('Введите API-ключ DeepSeek', 'warn'); keyIn.focus(); return; }
      store.patch('settings', { apiKey: remember.checked ? key : '' }, true);
      sendBtn.disabled = true;
      clear(answer).appendChild(h('p', { class: 'muted' }, 'Ждём ответ…'));
      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({
            model: 'deepseek-chat',
            temperature: 0.4,
            messages: [
              { role: 'system', content: 'Ты опытный геймдизайнер, специалист по балансу RTS. Отвечай по-русски, коротко и по делу. Опирайся только на присланные данные, числа приводи из них.' },
              { role: 'user', content: question.value + '\n\nДанные (JSON):\n' + JSON.stringify(buildSummary()) }
            ]
          })
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 300));
        const data = await res.json();
        const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '(пустой ответ)';
        clear(answer);
        text.split(/\n{2,}/).forEach((para) => answer.appendChild(h('p', null, para)));
      } catch (e) {
        clear(answer).appendChild(h('div', { class: 'verdict bad' }, 'Не получилось: ' + e.message +
          '. Проверьте ключ и баланс на счёте DeepSeek; если браузер блокирует запрос (CORS), откройте сервис через https.'));
      } finally {
        sendBtn.disabled = false;
      }
    }

    panel.appendChild(h('div', { class: 'grid-2' },
      h('div', { class: 'card' },
        BPS.ui.field('API-ключ DeepSeek', keyIn, 'ключ уходит только на api.deepseek.com'),
        h('label', { class: 'check' }, remember, ' запомнить ключ в этом браузере (localStorage)'),
        BPS.ui.field('Вопрос', question),
        h('div', { class: 'row-actions' }, sendBtn)),
      h('div', { class: 'card' }, h('h3', null, 'Что будет отправлено'), payloadPre)));
    panel.appendChild(h('div', { class: 'card' }, h('h3', null, 'Ответ'), answer));
    refreshPayload();
  }

  BPS.modules = BPS.modules || {};
  BPS.modules.assistant = { title: 'Ассистент', render, buildSummary };
})();
