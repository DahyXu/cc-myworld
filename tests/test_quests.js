// tests/test_quests.js
'use strict';
const assert = require('node:assert');
require('../shared/mobs_def.js');
require('../shared/quests_def.js');
const Q = globalThis.MyWorld.QuestsDef;

// NPC 常量
assert.strictEqual(typeof Q.NPC_X, 'number');
assert.strictEqual(typeof Q.NPC_Z, 'number');
assert.strictEqual(Q.NPC_RANGE, 3);

// MAIN_QUESTS 长度与结构
assert.strictEqual(Q.MAIN_QUESTS.length, 10);
assert.strictEqual(Q.MAIN_QUESTS[0].kind, 'kill');
assert.strictEqual(Q.MAIN_QUESTS[0].type, 'slime');
assert.strictEqual(Q.MAIN_QUESTS[0].lvReq, 1);
assert.strictEqual(Q.MAIN_QUESTS[9].kind, 'boss');
assert.strictEqual(Q.MAIN_QUESTS[9].type, 'wolf_king');

// mainQuestAt
assert.ok(Q.mainQuestAt(0) !== null);
assert.strictEqual(Q.mainQuestAt(10), null);
assert.strictEqual(Q.mainQuestAt(-1), null);

// offer: 等级达标发主线
const q0 = Q.offer(0, 1);
assert.strictEqual(q0.kind, 'm');
assert.strictEqual(q0.questKind, 'kill');
assert.strictEqual(q0.type, 'slime');
assert.strictEqual(q0.count, 5);
assert.ok(q0.id.startsWith('m:'));

// offer: 等级不足返回 null
const qNull = Q.offer(2, 2); // 主线3要求lv3，lv2不够
assert.strictEqual(qNull, null);

// offer: 等级刚好够
const q3 = Q.offer(2, 3); // 主线3 lv3
assert.ok(q3 !== null);
assert.strictEqual(q3.questKind, 'boss');

// offer: mainIndex>=10 发日常
const daily = Q.offer(10, 5);
assert.strictEqual(daily.kind, 'd');
assert.strictEqual(daily.type, 'zombie');
assert.ok(daily.count >= 8);
assert.ok(daily.id.startsWith('d:'));

// offer: 日常怪种随等级
assert.strictEqual(Q.offer(10, 1).type, 'slime');
assert.strictEqual(Q.offer(10, 8).type, 'skeleton');
assert.strictEqual(Q.offer(10, 15).type, 'wolf');

// parse: 主线 m:slime:5
const pm = Q.parse('m:slime:5');
assert.strictEqual(pm.kind, 'm');
assert.strictEqual(pm.questKind, 'kill');
assert.strictEqual(pm.type, 'slime');
assert.strictEqual(pm.count, 5);
assert.strictEqual(pm.xpReward, 90);

// parse: 主线 collect
const pc = Q.parse('m:slime_gel:5');
assert.strictEqual(pc.questKind, 'collect');

// parse: 主线 boss
const pb = Q.parse('m:slime_king:1');
assert.strictEqual(pb.questKind, 'boss');

// parse: 主线 explore
const pe = Q.parse('m:dist:150');
assert.strictEqual(pe.questKind, 'explore');

// parse: 日常
const pd = Q.parse('d:zombie:13');
assert.strictEqual(pd.kind, 'd');
assert.strictEqual(pd.type, 'zombie');
assert.strictEqual(pd.xpReward, Math.floor(13 * 15 * 1.5));

// parse: 非法
assert.strictEqual(Q.parse('garbage'), null);
assert.strictEqual(Q.parse('c:slime:5'), null); // 旧链任务视为非法
assert.strictEqual(Q.parse('m:slime:0'), null);
assert.strictEqual(Q.parse('m:unknown:5'), null); // 不在MAIN_QUESTS中

console.log('test_quests OK');
