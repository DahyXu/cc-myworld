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

// applyXp：当前等级进度模型（xp ∈ [0, xpToNext(level))）
// 升 1 级：1 级满 25 经验，给 25 → 升到 2 级、余 0
assert.deepStrictEqual(S.applyXp(1, 0, 25), { level: 2, xp: 0, leveled: true });
// 不足升级：给 10 → 仍 1 级、xp=10
assert.deepStrictEqual(S.applyXp(1, 0, 10), { level: 1, xp: 10, leveled: false });
// 携带已有进度：1 级已 20，给 10 → 30≥25 升级、余 5
assert.deepStrictEqual(S.applyXp(1, 20, 10), { level: 2, xp: 5, leveled: true });
// 连升多级：1 级给 25+ floor(25*2^1.5)=25+70=95 恰好升到 3 级余 0
assert.deepStrictEqual(S.applyXp(1, 0, 95), { level: 3, xp: 0, leveled: true });
// 满级吞没：20 级给任意经验 → 仍 20 级、xp 恒 0、不再 leveled
assert.deepStrictEqual(S.applyXp(20, 0, 99999), { level: 20, xp: 0, leveled: false });
// 逼近满级：19 级给巨量 → 封顶 20 级、xp=0
assert.strictEqual(S.applyXp(19, 0, 99999).level, 20);
assert.strictEqual(S.applyXp(19, 0, 99999).xp, 0);

// xpAfterDeath：扣当前等级进度的 10%（向下取整的损失）
assert.strictEqual(S.xpAfterDeath(100), 90, '扣 floor(100*0.1)=10');
assert.strictEqual(S.xpAfterDeath(5), 5, 'floor(5*0.1)=0 不扣');
assert.strictEqual(S.xpAfterDeath(0), 0);
assert.strictEqual(S.xpAfterDeath(19), 18, 'floor(19*0.1)=1');

console.log('test_stats OK');
