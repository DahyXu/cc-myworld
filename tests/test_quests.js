// tests/test_quests.js — 任务链、日常生成、奖励、quest_id 编解码
'use strict';
const assert = require('node:assert');
require('../shared/mobs_def.js'); // quests_def 依赖 MobsDef.TYPES 的经验/名称
require('../shared/quests_def.js');
const Q = globalThis.MyWorld.QuestsDef;

// NPC 常量存在
assert.strictEqual(typeof Q.NPC_X, 'number');
assert.strictEqual(typeof Q.NPC_Z, 'number');
assert.strictEqual(Q.NPC_RANGE, 3);

// 固定链 10 环，依次引导四地带
assert.strictEqual(Q.CHAIN.length, 10);
assert.deepStrictEqual(Q.CHAIN[0], { type: 'slime', count: 5 });
assert.deepStrictEqual(Q.CHAIN[9], { type: 'wolf', count: 15 });

// 奖励 = floor(count × 怪基准经验 × 1.5)；史莱姆基准经验 8
assert.strictEqual(Q.questReward('slime', 5), Math.floor(5 * 8 * 1.5)); // 60
assert.strictEqual(Q.questReward('wolf', 15), Math.floor(15 * 40 * 1.5)); // 900

// offer：chainIndex < 10 发链任务；==10 起发日常
const q0 = Q.offer(0, 1);
assert.strictEqual(q0.kind, 'c');
assert.strictEqual(q0.type, 'slime');
assert.strictEqual(q0.count, 5);
assert.strictEqual(q0.id, 'c:slime:5');
assert.strictEqual(q0.reward, 60);
const q9 = Q.offer(9, 12);
assert.strictEqual(q9.type, 'wolf');
assert.strictEqual(q9.count, 15);
const daily = Q.offer(10, 5); // 链已走完，等级 5 → 僵尸地带
assert.strictEqual(daily.kind, 'd');
assert.strictEqual(daily.type, 'zombie');
assert.ok(daily.count >= 8, '日常数量随等级');
assert.ok(daily.id.startsWith('d:'));

// 日常怪种随等级映射地带
assert.strictEqual(Q.offer(10, 1).type, 'slime');
assert.strictEqual(Q.offer(10, 8).type, 'skeleton');
assert.strictEqual(Q.offer(10, 15).type, 'wolf');

// parse：id 往返一致 + 奖励现算
const p = Q.parse('c:slime:5');
assert.deepStrictEqual([p.kind, p.type, p.count, p.reward], ['c', 'slime', 5, 60]);
const pd = Q.parse('d:zombie:13');
assert.deepStrictEqual([pd.kind, pd.type, pd.count], ['d', 'zombie', 13]);
assert.strictEqual(pd.reward, Math.floor(13 * 15 * 1.5)); // 僵尸基准经验 15
assert.strictEqual(Q.parse('garbage'), null, '非法 id 返回 null');
assert.strictEqual(Q.parse('c:slime:0'), null, 'count 必须 >0');

console.log('test_quests OK');
