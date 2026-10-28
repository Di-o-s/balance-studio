/*
 * formulas.js - чистые функции расчётов, без работы с DOM.
 * Файл подключается и в браузере (window.BPS.formulas), и в Node (тесты).
 */
(function (root) {
  'use strict';

  // ---------- Урон и TTK ----------

  // Минимальная доля атаки, которая проходит сквозь любую защиту.
  // Без неё юнит с защитой >= атаки становится бессмертным для этого врага.
  const MIN_DAMAGE_SHARE = 0.1;

  const DAMAGE_TYPES = ['melee', 'explosive', 'bullet'];

  function num(v, def) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  // Приводим юнит к полному набору полей, недостающие берём по умолчанию.
  function normalizeUnit(u) {
    return {
      id: u.id,
      name: u.name,
      hp: num(u.hp, 0),
      attack: num(u.attack, 0),
      defense: num(u.defense, 0),
      cost: num(u.cost, 0),
      attack_speed: num(u.attack_speed, 1),      // атак в секунду
      crit_chance: num(u.crit_chance, 0),        // 0..1
      crit_mult: num(u.crit_mult, 1.5),          // множитель крита
      damage_type: DAMAGE_TYPES.includes(u.damage_type) ? u.damage_type : 'melee',
      res_melee: num(u.res_melee, 0),            // сопротивление, доля: 0.3 = -30% урона
      res_explosive: num(u.res_explosive, 0),
      res_bullet: num(u.res_bullet, 0)
    };
  }

  /*
   * Урон одного удара без крита:
   *   raw  = max(attack - defense, attack * MIN_DAMAGE_SHARE)
   *   base = raw * (1 - resist[тип урона атакующего]) * mods.multiplier
   * Сопротивление ограничено сверху 0.9, чтобы урон не уходил в ноль или минус.
   */
  function hitDamage(attacker, target, mods) {
    const a = normalizeUnit(attacker);
    const t = normalizeUnit(target);
    const m = Object.assign({ multiplier: 1 }, mods || {});
    const raw = Math.max(a.attack - t.defense, a.attack * MIN_DAMAGE_SHARE);
    const resist = Math.min(t['res_' + a.damage_type], 0.9);
    return raw * (1 - resist) * m.multiplier;
  }

  // Средний урон удара с учётом критов: base * (1 + p * (k - 1))
  function expectedHit(attacker, target, mods) {
    const a = normalizeUnit(attacker);
    const base = hitDamage(attacker, target, mods);
    const p = Math.min(Math.max(a.crit_chance, 0), 1);
    return base * (1 + p * (a.crit_mult - 1));
  }

  /*
   * TTK (time to kill). Первый удар происходит через 1/attack_speed секунд,
   * поэтому TTK = число_ударов / attack_speed.
   * Возвращаем три варианта: без критов, средний (по ожидаемому урону), все удары критами.
   */
  function ttk(attacker, target, mods) {
    const a = normalizeUnit(attacker);
    const t = normalizeUnit(target);
    const base = hitDamage(attacker, target, mods);
    const avg = expectedHit(attacker, target, mods);
    const crit = base * a.crit_mult;
    const speed = a.attack_speed > 0 ? a.attack_speed : 1;
    const hits = (dmg) => (dmg > 0 ? Math.ceil(t.hp / dmg - 1e-9) : Infinity);
    const res = {
      base: base,
      expected: avg,
      crit: crit,
      dps: avg * speed,
      hitsNoCrit: hits(base),
      hitsExpected: hits(avg),
      hitsAllCrit: hits(crit)
    };
    res.ttkNoCrit = res.hitsNoCrit / speed;
    res.ttkExpected = res.hitsExpected / speed;
    res.ttkAllCrit = res.hitsAllCrit / speed;
    return res;
  }

  // Дуэль: кто быстрее убьёт другого (по среднему TTK).
  function duel(a, b, mods) {
    const ab = ttk(a, b, mods);
    const ba = ttk(b, a, mods);
    let winner = 'draw';
    if (ab.ttkExpected < ba.ttkExpected) winner = 'a';
    else if (ba.ttkExpected < ab.ttkExpected) winner = 'b';
    return { ab: ab, ba: ba, winner: winner };
  }

  // ---------- Прогрессия ----------

  /*
   * Опыт, нужный для перехода с уровня L на L+1:
   *   power:       xp(L) = base * L^exponent + linear * L
   *   exponential: xp(L) = base * growth^(L-1) + linear * L
   * Значения округляем до целого (так их потом и хранит игра).
   */
  function xpForLevel(L, p) {
    let v;
    if (p.mode === 'exponential') v = p.base * Math.pow(p.growth, L - 1) + p.linear * L;
    else v = p.base * Math.pow(L, p.exponent) + p.linear * L;
    return Math.round(v);
  }

  function progressionTable(p) {
    const rows = [];
    let total = 0;
    let prev = null;
    for (let L = 1; L < p.maxLevel; L++) {
      const xp = xpForLevel(L, p);
      total += xp;
      const growthPct = prev ? ((xp - prev) / prev) * 100 : null;
      const minutes = p.xpPerMinute > 0 ? total / p.xpPerMinute : null;
      rows.push({ level: L + 1, xp: xp, total: total, growthPct: growthPct, minutes: minutes });
      prev = xp;
    }
    return rows;
  }

  // ---------- Лут ----------

  const LOOT_EPS = 0.01; // допуск на округление, в процентах

  // Проверка таблиц лута. rows: [{table, item, chance}], chance в процентах.
  function checkLoot(rows) {
    const tables = {};
    const rowErrors = [];
    rows.forEach((r, i) => {
      const t = String(r.table || '').trim() || '(без названия)';
      if (!tables[t]) tables[t] = { name: t, sum: 0, count: 0, items: {} };
      const c = Number(r.chance);
      const errs = [];
      if (r.chance === '' || r.chance === null || r.chance === undefined || !Number.isFinite(c)) errs.push('шанс не число');
      else if (c < 0) errs.push('шанс меньше 0');
      else if (c > 100) errs.push('шанс больше 100');
      const item = String(r.item || '').trim();
      if (!item) errs.push('пустое название предмета');
      else if (tables[t].items[item]) errs.push('предмет повторяется в таблице');
      tables[t].items[item] = true;
      if (Number.isFinite(c)) tables[t].sum += c;
      tables[t].count++;
      if (errs.length) rowErrors.push({ index: i, errors: errs });
    });
    const summary = Object.values(tables).map((t) => {
      const sum = Math.round(t.sum * 1000) / 1000;
      // + 1e-9: иначе 99.99 даёт |sum - 100| = 0.0100000000000051 и не проходит допуск из-за погрешности float
      return { name: t.name, sum: sum, count: t.count, ok: Math.abs(sum - 100) <= LOOT_EPS + 1e-9 };
    });
    return { tables: summary, rowErrors: rowErrors, ok: rowErrors.length === 0 && summary.every((t) => t.ok) };
  }

  // Нормализация шансов одной таблицы к 100% с сохранением пропорций.
  function normalizeLoot(rows, tableName) {
    const inTable = rows.filter((r) => String(r.table).trim() === tableName && Number(r.chance) > 0);
    const sum = inTable.reduce((s, r) => s + Number(r.chance), 0);
    if (sum <= 0) return rows;
    return rows.map((r) => {
      if (String(r.table).trim() !== tableName) return r;
      const c = Number(r.chance);
      return Object.assign({}, r, { chance: c > 0 ? Math.round((c / sum) * 100 * 100) / 100 : 0 });
    });
  }

  // Монте-Карло: N бросков по таблице, возвращает частоты в процентах.
  function simulateLoot(items, n, rnd) {
    rnd = rnd || Math.random;
    const counts = items.map(() => 0);
    const total = items.reduce((s, it) => s + Math.max(0, Number(it.chance) || 0), 0);
    for (let i = 0; i < n; i++) {
      let x = rnd() * total;
      for (let j = 0; j < items.length; j++) {
        x -= Math.max(0, Number(items[j].chance) || 0);
        if (x < 0) { counts[j]++; break; }
      }
    }
    return counts.map((c) => (c / n) * 100);
  }

  // ---------- Аудит баланса ----------

  /*
   * Эффективность юнита за единицу цены.
   * Сила = sqrt(DPS * EHP), где DPS - средний урон в секунду по "эталонной" цели
   * (средние статы всех юнитов), EHP - сколько урона юнит переживёт от эталонного атакующего.
   * Корень берём, чтобы атака и живучесть весили одинаково (как в формуле Ланчестера).
   */
  function auditUnits(units, opts) {
    const o = Object.assign({ high: 1.3, low: 0.7 }, opts || {});
    const list = units.map(normalizeUnit).filter((u) => u.hp > 0);
    if (list.length < 2) return [];
    const avg = (k) => list.reduce((s, u) => s + u[k], 0) / list.length;
    const ref = normalizeUnit({
      hp: avg('hp'), attack: avg('attack'), defense: avg('defense'), attack_speed: avg('attack_speed'),
      crit_chance: avg('crit_chance'), crit_mult: avg('crit_mult'),
      res_melee: avg('res_melee'), res_explosive: avg('res_explosive'), res_bullet: avg('res_bullet')
    });
    const rows = list.map((u) => {
      const dps = expectedHit(u, ref) * u.attack_speed;
      const refHit = expectedHit(ref, u);
      const ehp = refHit > 0 ? u.hp * (ref.attack / refHit) : u.hp;
      const power = Math.sqrt(dps * ehp);
      const value = u.cost > 0 ? power / u.cost : 0;
      return { id: u.id, name: u.name, dps: dps, ehp: ehp, power: power, value: value };
    });
    const sorted = rows.map((r) => r.value).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    rows.forEach((r) => {
      r.ratio = median > 0 ? r.value / median : 0;
      r.verdict = r.ratio >= o.high ? 'dominant' : r.ratio <= o.low ? 'weak' : 'ok';
    });
    return rows;
  }

  // ---------- Экономика / инфляция ----------

  /*
   * Модель на N шагов. Источник/сток:
   *   {name, kind: 'source'|'sink', amount, mode: 'flat'|'percent', growth}
   * flat    - фиксированное количество за шаг, растёт на growth% каждый шаг;
   * percent - доля от текущего запаса (например, налог 5%).
   * Сток не может забрать больше, чем есть.
   */
  function simulateEconomy(cfg) {
    const out = [];
    let stock = Number(cfg.start) || 0;
    const items = (cfg.items || []).map((it) => Object.assign({}, it));
    for (let step = 1; step <= cfg.steps; step++) {
      let inflow = 0;
      let outflow = 0;
      items.forEach((it) => {
        const g = Math.pow(1 + (Number(it.growth) || 0) / 100, step - 1);
        const amount = Number(it.amount) || 0;
        const v = it.mode === 'percent' ? (stock * amount) / 100 : amount * g;
        if (it.kind === 'sink') outflow += v; else inflow += v;
      });
      outflow = Math.min(outflow, stock + inflow);
      const prev = stock;
      stock = stock + inflow - outflow;
      out.push({ step: step, inflow: inflow, outflow: outflow, stock: stock,
        growthPct: prev > 0 ? ((stock - prev) / prev) * 100 : null });
    }
    return out;
  }

  // ---------- Дерево навыков ----------

  // Проверка дерева: несуществующие ссылки, циклы. Возвращает глубину каждого узла.
  function analyzeTree(nodes) {
    const byId = {};
    const errors = [];
    nodes.forEach((n) => {
      if (byId[n.id]) errors.push('дубль id: ' + n.id);
      byId[n.id] = n;
    });
    nodes.forEach((n) => (n.requires || []).forEach((r) => {
      if (!byId[r]) errors.push('узел "' + n.id + '" ссылается на несуществующий "' + r + '"');
    }));
    const depth = {};
    const state = {}; // 1 - в обходе, 2 - готово
    function visit(id, path) {
      if (state[id] === 2) return depth[id];
      if (state[id] === 1) { errors.push('цикл: ' + path.concat(id).join(' → ')); return 0; }
      state[id] = 1;
      const reqs = (byId[id].requires || []).filter((r) => byId[r]);
      let d = 0;
      reqs.forEach((r) => { d = Math.max(d, visit(r, path.concat(id)) + 1); });
      state[id] = 2;
      depth[id] = d;
      return d;
    }
    nodes.forEach((n) => visit(n.id, []));
    return { depth: depth, errors: errors };
  }

  const api = {
    MIN_DAMAGE_SHARE, DAMAGE_TYPES, LOOT_EPS,
    normalizeUnit, hitDamage, expectedHit, ttk, duel,
    xpForLevel, progressionTable,
    checkLoot, normalizeLoot, simulateLoot,
    auditUnits, simulateEconomy, analyzeTree
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.BPS = root.BPS || {};
  root.BPS.formulas = api;
})(typeof window !== 'undefined' ? window : globalThis);
