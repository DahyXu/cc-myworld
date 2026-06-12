// tests/test_stats.js — 属性成长、伤害公式、经验曲线
'use strict';
const assert = require('node:assert');
require('../shared/stats.js');
const S = globalThis.MyWorld.Stats;

// HP 上限 = 20 + 5×(等级-1)
assert.strictEqual(S.maxHp(1), 20);
assert.strictEqual(S.maxHp(5), 40);
assert.strictEqual(S.maxHp(20), 115);

// 剑伤害 = 3 + 1×(等级-1)
assert.strictEqual(S.swordDamage(1), 3);
assert.strictEqual(S.swordDamage(10), 12);

// 弓伤害 = floor(2 + 0.8×(等级-1))
assert.strictEqual(S.bowDamage(1), 2);
assert.strictEqual(S.bowDamage(2), 2, 'floor(2.8)=2');
assert.strictEqual(S.bowDamage(11), 10);

// 经验曲线：升到下一级需 floor(25×当前等级^1.5)，上限 20 级
assert.strictEqual(S.xpToNext(1), 25);
assert.strictEqual(S.xpToNext(10), 790);
assert.strictEqual(S.xpToNext(20), Infinity, '到顶不再升级');
assert.strictEqual(S.LEVEL_CAP, 20);

console.log('test_stats OK');
