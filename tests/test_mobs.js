// tests/test_mobs.js — 地带判定、数值缩放、营地确定性散布、AI 状态机
'use strict';
const assert = require('node:assert');
require('../shared/mobs_def.js');
const M = globalThis.MyWorld.MobsDef;

// 地带：d<60 安全区
assert.strictEqual(M.zoneOf(0), null);
assert.strictEqual(M.zoneOf(59.9), null);
assert.strictEqual(M.zoneOf(60).type, 'slime');
assert.strictEqual(M.zoneOf(149).type, 'slime');
assert.strictEqual(M.zoneOf(150).type, 'zombie');
assert.strictEqual(M.zoneOf(300).type, 'skeleton');
assert.strictEqual(M.zoneOf(500).type, 'wolf');
assert.strictEqual(M.zoneOf(99999).type, 'wolf');

// 数值缩放：每比地带基准高 1 级 ×1.1 复利向下取整
const s1 = M.mobStats('slime', 1);
assert.deepStrictEqual([s1.hp, s1.dmg, s1.xp], [12, 1, 8], '基准值');
const s3 = M.mobStats('slime', 3);
assert.strictEqual(s3.hp, Math.floor(12 * 1.1 * 1.1), '高 2 级复利');
const w10 = M.mobStats('wolf', 10);
assert.deepStrictEqual([w10.hp, w10.dmg, w10.xp], [35, 5, 40], 'wolf 基准 10 级');

// 营地散布：确定性 + 约 15% 密度 + 安全区无营地
{
  const a = M.campAt(12345, 10, 10);
  const b = M.campAt(12345, 10, 10);
  assert.deepStrictEqual(a, b, '同种子同区块结果一致');
  const c = M.campAt(54321, 10, 10);
  // 不同种子允许不同（不强断言内容，只要求确定性不抛错）
  assert.ok(c === null || typeof c.x === 'number');
  assert.strictEqual(M.campAt(12345, 0, 0), null, '出生区块在安全区，无营地');
  let n = 0, total = 0;
  for (let cx = 5; cx < 45; cx++) for (let cz = 5; cz < 45; cz++) {
    total++;
    const camp = M.campAt(777, cx, cz);
    if (camp) {
      n++;
      assert.ok(camp.count >= 3 && camp.count <= 5, '3~5 只');
      const zone = M.zoneOf(Math.hypot(camp.x - M.SPAWN_X, camp.z - M.SPAWN_Z));
      assert.ok(zone && zone.type === camp.type, '营地类型与地带一致');
      assert.strictEqual(camp.levels.length, camp.count);
      for (const lv of camp.levels) assert.ok(lv >= zone.lvMin && lv <= zone.lvMax, '等级在地带范围内');
    }
  }
  const ratio = n / total;
  assert.ok(ratio > 0.08 && ratio < 0.25, '密度约 15%，实测 ' + ratio.toFixed(3));
}

// campsNear：扫描方圆 N 区块
{
  const list = M.campsNear(777, 8.5, 8.5, 20);
  assert.ok(Array.isArray(list));
  // 地带按区块中心判定，营地列在块内最多偏移 ~11 格，故下限放宽到 48
  for (const c of list) assert.ok(Math.hypot(c.x - 8.5, c.z - 8.5) >= 48, '都在安全区外（含列偏移余量）');
}

// AI 状态机
const T = M.TYPES;
function mk(state) { return { type: 'zombie', state, aggroPid: null, hp: 25 }; }
// 主动怪：玩家进视野 → chase
{
  const r = M.aiStep(mk('idle'), { nearest: { dist: 8, pid: 1 }, campDist: 2 }, 0);
  assert.strictEqual(r.state, 'chase');
}
// 视野外不追
{
  const r = M.aiStep(mk('idle'), { nearest: { dist: 20, pid: 1 }, campDist: 2 }, 0);
  assert.strictEqual(r.state, 'idle');
}
// 被动怪（史莱姆）：未被打不追
{
  const m = { type: 'slime', state: 'idle', aggroPid: null, hp: 12 };
  const r = M.aiStep(m, { nearest: { dist: 3, pid: 1 }, campDist: 2 }, 0);
  assert.strictEqual(r.state, 'idle');
  m.aggroPid = 1; // 被打过
  const r2 = M.aiStep(m, { nearest: { dist: 3, pid: 1 }, campDist: 2 }, 0);
  assert.strictEqual(r2.state, 'chase');
}
// 追击超 24 格脱战回巢；回巢到家转 idle 并标记治疗
{
  const r = M.aiStep(mk('chase'), { nearest: { dist: 3, pid: 1 }, campDist: 25 }, 0);
  assert.strictEqual(r.state, 'return');
  const r2 = M.aiStep(mk('return'), { nearest: { dist: 3, pid: 1 }, campDist: 1 }, 0);
  assert.strictEqual(r2.state, 'idle');
  assert.strictEqual(r2.healed, true);
  const r3 = M.aiStep(mk('return'), { nearest: null, campDist: 10 }, 0);
  assert.strictEqual(r3.state, 'return', '回巢途中保持回巢');
}
// 近战怪贴身出攻击意图
{
  const r = M.aiStep(mk('chase'), { nearest: { dist: 1.2, pid: 7 }, campDist: 5 }, 0);
  assert.strictEqual(r.state, 'chase');
  assert.strictEqual(r.attackPid, 7);
}
// 骷髅：保持 8~14 格——太近后退、区间内射箭、太远接近
{
  const sk = { type: 'skeleton', state: 'chase', aggroPid: null, hp: 20 };
  const near = M.aiStep(sk, { nearest: { dist: 5, pid: 2 }, campDist: 5 }, 0);
  assert.strictEqual(near.retreat, true, '太近后退');
  const mid = M.aiStep(sk, { nearest: { dist: 10, pid: 2 }, campDist: 5 }, 0);
  assert.strictEqual(mid.shootPid, 2, '区间内射箭');
  assert.ok(!mid.retreat);
  const far = M.aiStep(sk, { nearest: { dist: 15, pid: 2 }, campDist: 5 }, 0);
  assert.ok(!far.shootPid && !far.retreat, '太远只接近');
}
// 追击目标消失（死亡/离线/出兴趣）→ 回巢
{
  const r = M.aiStep(mk('chase'), { nearest: null, campDist: 5 }, 0);
  assert.strictEqual(r.state, 'return');
}

console.log('test_mobs OK');
