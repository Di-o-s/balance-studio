// Запуск: node tests/formulas.test.js
// Числа в ожидаемых значениях посчитаны вручную (см. отчёт, раздел "Ручная проверка формул").
const assert = require('assert');
const F = require('../js/formulas.js');
const D = require('../js/data.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, a + ' != ' + b);

console.log('Урон и TTK');
const swordsman = { id: 1, name: 'Мечник', hp: 120, attack: 25, defense: 10, cost: 100 };
const spearman = { id: 2, name: 'Копейщик', hp: 100, attack: 30, defense: 8, cost: 110 };
const knight = { id: 4, name: 'Рыцарь', hp: 180, attack: 20, defense: 20, cost: 200 };
const mage = { id: 5, name: 'Маг', hp: 70, attack: 45, defense: 3, cost: 150 };

test('Мечник -> Копейщик: 25-8=17, 6 ударов, 6 с', () => {
  const r = F.ttk(swordsman, spearman);
  near(r.base, 17); assert.strictEqual(r.hitsNoCrit, 6); near(r.ttkNoCrit, 6);
});
test('Мечник -> Рыцарь: защита съедает урон, но работает минимум (25-20=5 > 2.5)', () => {
  const r = F.ttk(swordsman, knight);
  near(r.base, 5); assert.strictEqual(r.hitsNoCrit, 36);
});
test('Рыцарь -> Рыцарь: 20-20=0, срабатывает минимум 10% = 2, 90 ударов', () => {
  const r = F.ttk(knight, knight);
  near(r.base, 2); assert.strictEqual(r.hitsNoCrit, 90);
});
test('Маг -> Мечник с критами 20% x2: 35 * 1.2 = 42 в среднем, 3 удара', () => {
  const m = Object.assign({}, mage, { crit_chance: 0.2, crit_mult: 2 });
  const r = F.ttk(m, swordsman);
  near(r.base, 35); near(r.expected, 42); assert.strictEqual(r.hitsExpected, 3); assert.strictEqual(r.hitsNoCrit, 4);
  assert.strictEqual(r.hitsAllCrit, 2);
});
test('Сопротивление: пули по танку 70% -> (40-15)*0.3 = 7.5', () => {
  const mg = { hp: 100, attack: 40, defense: 2, damage_type: 'bullet', attack_speed: 2 };
  const tank = { hp: 300, attack: 50, defense: 15, res_bullet: 0.7 };
  const r = F.ttk(mg, tank);
  near(r.base, 7.5); assert.strictEqual(r.hitsNoCrit, 40); near(r.ttkNoCrit, 20);
});
test('Ровно HP/урон без лишнего удара (100 / 20 = 5)', () => {
  const r = F.ttk({ attack: 20 }, { hp: 100, defense: 0 });
  assert.strictEqual(r.hitsNoCrit, 5);
});
test('Отрицательное сопротивление увеличивает урон', () => {
  near(F.hitDamage({ attack: 30, damage_type: 'explosive' }, { defense: 10, res_explosive: -0.5 }), 30);
});

console.log('Прогрессия');
const p = { mode: 'power', base: 100, exponent: 1.5, linear: 0, maxLevel: 5, xpPerMinute: 0 };
test('power: 100*L^1.5 -> 100, 283, 520, 800', () => {
  const t = F.progressionTable(p);
  assert.deepStrictEqual(t.map((r) => r.xp), [100, 283, 520, 800]);
  assert.strictEqual(t[3].total, 1703);
});
test('exponential: 50*1.2^(L-1)+10L -> 60, 80, 102', () => {
  const t = F.progressionTable({ mode: 'exponential', base: 50, growth: 1.2, linear: 10, maxLevel: 4 });
  assert.deepStrictEqual(t.map((r) => r.xp), [60, 80, 102]);
});

console.log('Лут');
test('сумма 100 - ок', () => {
  const r = F.checkLoot([{ table: 'a', item: 'x', chance: 60 }, { table: 'a', item: 'y', chance: 40 }]);
  assert.ok(r.ok);
});
test('сумма 99.5 - ошибка', () => {
  const r = F.checkLoot([{ table: 'a', item: 'x', chance: 59.5 }, { table: 'a', item: 'y', chance: 40 }]);
  assert.ok(!r.ok); near(r.tables[0].sum, 99.5);
});
test('33.33*3 = 99.99 укладывается в допуск 0.01', () => {
  const r = F.checkLoot([1, 2, 3].map((i) => ({ table: 'a', item: 'i' + i, chance: 33.33 })));
  assert.ok(r.tables[0].ok);
});
test('дубль предмета и отрицательный шанс подсвечиваются', () => {
  const r = F.checkLoot([{ table: 'a', item: 'x', chance: 110 }, { table: 'a', item: 'x', chance: -10 }]);
  assert.strictEqual(r.rowErrors.length, 2);
});
test('нормализация 30/30/40 -> не меняется, 1/1/2 -> 25/25/50', () => {
  const rows = [{ table: 't', item: 'a', chance: 1 }, { table: 't', item: 'b', chance: 1 }, { table: 't', item: 'c', chance: 2 }];
  assert.deepStrictEqual(F.normalizeLoot(rows, 't').map((r) => r.chance), [25, 25, 50]);
});
test('Монте-Карло 100k бросков близко к шансам', () => {
  let seed = 42; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const f = F.simulateLoot([{ chance: 70 }, { chance: 25 }, { chance: 5 }], 100000, rnd);
  near(f[0], 70, 1); near(f[1], 25, 1); near(f[2], 5, 0.5);
});

console.log('Аудит, экономика, дерево');
test('аудит: юнит с теми же статами за полцены - доминирующий', () => {
  const base = { hp: 100, attack: 20, defense: 5, cost: 100 };
  const r = F.auditUnits([
    Object.assign({ id: 1, name: 'A' }, base), Object.assign({ id: 2, name: 'B' }, base),
    Object.assign({ id: 3, name: 'C' }, base, { cost: 50 }), Object.assign({ id: 4, name: 'D' }, base, { cost: 300 })
  ]);
  assert.strictEqual(r.find((x) => x.id === 3).verdict, 'dominant');
  assert.strictEqual(r.find((x) => x.id === 4).verdict, 'weak');
  assert.strictEqual(r.find((x) => x.id === 1).verdict, 'ok');
});
test('экономика: +100/шаг, налог 10% от запаса', () => {
  const r = F.simulateEconomy({ start: 1000, steps: 2, items: [
    { kind: 'source', amount: 100, mode: 'flat', growth: 0 },
    { kind: 'sink', amount: 10, mode: 'percent' }] });
  near(r[0].stock, 1000); near(r[1].stock, 1000);
});
test('экономика: сток не уводит запас в минус', () => {
  const r = F.simulateEconomy({ start: 10, steps: 1, items: [{ kind: 'sink', amount: 50, mode: 'flat' }] });
  near(r[0].stock, 0);
});
test('дерево: глубина и поиск цикла', () => {
  const ok = F.analyzeTree([{ id: 'a' }, { id: 'b', requires: ['a'] }, { id: 'c', requires: ['a', 'b'] }]);
  assert.deepStrictEqual(ok.depth, { a: 0, b: 1, c: 2 }); assert.strictEqual(ok.errors.length, 0);
  const bad = F.analyzeTree([{ id: 'a', requires: ['b'] }, { id: 'b', requires: ['a'] }, { id: 'c', requires: ['zzz'] }]);
  assert.ok(bad.errors.some((e) => e.indexOf('цикл') === 0));
  assert.ok(bad.errors.some((e) => e.indexOf('zzz') >= 0));
});

console.log('CSV / JSON');
test('CSV из задания разбирается и проходит валидацию', () => {
  const csv = 'id,name,hp,attack,defense,cost\n1,Мечник,120,25,10,100\n2,Копейщик,100,30,8,110\n';
  const p = D.parseCSV(csv);
  const v = D.validate(p, D.detectKind(p.headers));
  assert.strictEqual(v.kind, 'units'); assert.strictEqual(v.validRows.length, 2); assert.strictEqual(v.validRows[0].hp, 120);
});
test('CSV с ";" и BOM (Excel)', () => {
  const p = D.parseCSV('﻿id;name;hp;attack;defense;cost\r\n1;Танк;300;50;15;400\r\n');
  assert.strictEqual(p.delimiter, ';'); assert.strictEqual(p.rows[0].name, 'Танк');
});
test('кавычки и запятая внутри поля', () => {
  const p = D.parseCSV('id,name\n1,"Пехота, ветераны ""Север"""\n');
  assert.strictEqual(p.rows[0].name, 'Пехота, ветераны "Север"');
});
test('валидация ловит текст вместо числа, дубль ID и нет колонки', () => {
  const p = D.parseCSV('id,name,hp,attack,defense,cost\n1,A,abc,1,1,1\n1,B,10,1,1,1\n');
  const v = D.validate(p, 'units');
  assert.ok(v.rowErrors.some((e) => e.column === 'hp')); assert.ok(v.rowErrors.some((e) => /дубль/.test(e.message)));
  const v2 = D.validate(D.parseCSV('id,name,hp\n1,A,1\n'), 'units');
  assert.ok(v2.fileErrors[0].indexOf('attack') > 0);
});
test('экспорт -> импорт без потерь (CSV и JSON)', () => {
  const rows = [{ id: 1, name: 'Пехота, "ветераны"', hp: 100, attack: 12.5, defense: 4, cost: 60 }];
  const back = D.validate(D.parseCSV(D.toCSV(rows)), 'units').validRows;
  assert.deepStrictEqual(back[0], Object.assign({}, rows[0], { id: '1' }));
  const j = D.parseJSON(JSON.stringify({ units: rows }));
  assert.strictEqual(j.kind, 'units'); assert.strictEqual(D.validate(j, 'units').validRows[0].attack, 12.5);
});
test('битый JSON не роняет разбор, а бросает понятную ошибку', () => {
  assert.throws(() => D.parseJSON('{"a": 1}'), /массив/);
});

console.log('\nПройдено: ' + passed + (process.exitCode ? ' (есть ошибки)' : ', ошибок нет'));
