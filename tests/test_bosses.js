// tests/test_bosses.js — Boss定义 + 主线任务集成测试
'use strict';
const assert = require('node:assert');
require('../shared/mobs_def.js');
require('../shared/bosses_def.js');
require('../shared/quests_def.js');
const B = globalThis.MyWorld.BossesDef;
const Q = globalThis.MyWorld.QuestsDef;

// BOSSES 长度与字段
assert.strictEqual(B.BOSSES.length, 4);
const ids = B.BOSSES.map(b => b.id);
assert.deepStrictEqual(ids, ['slime_king', 'zombie_lord', 'skeleton_mage', 'wolf_king']);

// 每个Boss有必要字段
for (const b of B.BOSSES) {
  assert.ok(typeof b.id === 'string');
  assert.ok(typeof b.name === 'string');
  assert.ok(typeof b.type === 'string');
  assert.ok(b.hp > 0);
  assert.ok(b.dmg > 0);
  assert.ok(b.xp > 0);
  assert.ok(b.coins > 0);
  assert.ok(b.loot && b.loot.type === 'weapon');
  assert.strictEqual(b.respawnMs, 15 * 60 * 1000);
  assert.ok(['split', 'aoe', 'summon', 'dash'].includes(b.skill));
}

// bossById
assert.strictEqual(B.bossById('slime_king').name, '史莱姆王');
assert.strictEqual(B.bossById('wolf_king').loot.sub, 'bow');
assert.strictEqual(B.bossById('nonexistent'), null);

// 主线boss任务的type与BOSSES的id一一对应
const bossQuests = Q.MAIN_QUESTS.filter(q => q.kind === 'boss');
for (const bq of bossQuests) {
  assert.ok(B.bossById(bq.type) !== null, `主线boss任务type=${bq.type}在BOSSES中不存在`);
}

// 主线任务覆盖验证
assert.strictEqual(Q.MAIN_QUESTS.filter(q => q.kind === 'kill').length, 3);
assert.strictEqual(Q.MAIN_QUESTS.filter(q => q.kind === 'collect').length, 2);
assert.strictEqual(Q.MAIN_QUESTS.filter(q => q.kind === 'boss').length, 4);
assert.strictEqual(Q.MAIN_QUESTS.filter(q => q.kind === 'explore').length, 1);

// collect任务的材料名与ItemsDef中存在（字符串格式验证）
const collectTypes = Q.MAIN_QUESTS.filter(q => q.kind === 'collect').map(q => q.type);
assert.ok(collectTypes.includes('slime_gel'));
assert.ok(collectTypes.includes('skeleton_bone'));

// 等级递增检验（各主线lvReq不超过该条序号+1）
for (let i = 0; i < Q.MAIN_QUESTS.length; i++) {
  assert.ok(Q.MAIN_QUESTS[i].lvReq <= i + 2, `主线${i}等级要求过高: ${Q.MAIN_QUESTS[i].lvReq}`);
}

console.log('test_bosses OK');
