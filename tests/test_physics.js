// tests/test_physics.js — 参数化盒子物理：与 test_player 同口径 + 怪物尺寸用例
'use strict';
const assert = require('node:assert');
require('../js/blocks.js');
require('../shared/physics.js');
const P = globalThis.MyWorld.Physics;

// 模拟世界：y<10 全石头；x>=5 一堵墙
const flat = { getBlock: (x, y, z) => (y < 10 ? 3 : 0) };
const wall = { getBlock: (x, y, z) => (y < 10 || (x >= 5 && y < 30) ? 3 : 0) };
// 一格台阶：x>=5 处地面抬高到 y=11
const stepUp = { getBlock: (x, y, z) => (y < 10 || (x >= 5 && y < 11) ? 3 : 0) };

// 1) 重力下落停在地面（玩家尺寸）
{
  const b = P.createBody(0.5, 20, 0.5, 0.3, 1.8);
  for (let i = 0; i < 200; i++) P.step(b, flat, 1 / 60);
  assert.ok(Math.abs(b.y - 10) < 0.01, 'rests on ground, y=' + b.y);
  assert.strictEqual(b.onGround, true);
  assert.strictEqual(b.vy, 0);
}

// 2) 横向撞墙被挡（速度直接给在 body 上）
{
  const b = P.createBody(0.5, 10, 0.5, 0.3, 1.8);
  for (let i = 0; i < 300; i++) { b.vx = 4.5; b.vz = 0; P.step(b, wall, 1 / 60); }
  assert.ok(b.x < 5 - 0.29, 'blocked by wall, x=' + b.x);
  assert.ok(b.x > 4.5, 'got close, x=' + b.x);
}

// 3) 跳跃只在地面生效
{
  const b = P.createBody(0.5, 10, 0.5, 0.3, 1.8);
  P.step(b, flat, 1 / 60);
  assert.strictEqual(P.tryJump(b, 9), true, '地面起跳');
  assert.ok(b.vy > 0);
  assert.strictEqual(P.tryJump(b, 9), false, '空中不可二段跳');
}

// 4) 天花板顶住：y=12 有方块，1.8 高的身体最高到 10.2
{
  const w = { getBlock: (x, y, z) => (y < 10 || y === 12 ? 3 : 0) };
  const b = P.createBody(0.5, 10, 0.5, 0.3, 1.8);
  P.step(b, w, 1 / 60);
  P.tryJump(b, 9);
  let maxY = 10;
  for (let i = 0; i < 60; i++) { P.step(b, w, 1 / 60); maxY = Math.max(maxY, b.y); }
  assert.ok(maxY <= 12 - 1.8 + 0.01, 'ceiling blocks, max=' + maxY);
}

// 5) 尺寸参数化：0.7 高的小怪能钻进 1 格净空（y=11 处有天花板、地面 y=10）
{
  const gap = { getBlock: (x, y, z) => (y < 10 || (x >= 3 && y === 11) ? 3 : 0) };
  const slime = P.createBody(0.5, 10, 0.5, 0.35, 0.7);
  for (let i = 0; i < 300; i++) { slime.vx = 3; slime.vz = 0; P.step(slime, gap, 1 / 60); }
  assert.ok(slime.x > 4, '矮身体钻过 1 格净空, x=' + slime.x);
  const tall = P.createBody(0.5, 10, 0.5, 0.3, 1.8);
  for (let i = 0; i < 300; i++) { tall.vx = 3; tall.vz = 0; P.step(tall, gap, 1 / 60); }
  assert.ok(tall.x < 3, '高身体被 1 格净空挡住, x=' + tall.x);
}

// 6) blockedAhead：面前 1 格台阶可检出，平地与高墙区分
{
  const b = P.createBody(4.5, 10, 0.5, 0.3, 1.8);
  P.step(b, stepUp, 1 / 60);
  assert.strictEqual(P.blockedAhead(b, stepUp, 1, 0), true, '台阶挡路');
  assert.strictEqual(P.blockedAhead(b, flat, 1, 0), false, '平地无阻');
  const w = P.createBody(4.5, 10, 0.5, 0.3, 1.8);
  P.step(w, wall, 1 / 60);
  assert.strictEqual(P.blockedAhead(w, wall, 1, 0), true, '高墙也算挡路（跳不跳得上由物理决定）');
}

// 7) segmentHitsBox：线段与 AABB 相交
{
  const box = { x: 5, y: 10, z: 5, half: 0.5, height: 1 }; // 中心列 (5,5)，脚底 y=10
  assert.ok(P.segmentHitsBox(0, 10.5, 5, 10, 10.5, 5, box), '正穿过');
  assert.ok(!P.segmentHitsBox(0, 10.5, 7, 10, 10.5, 7, box), '旁边掠过');
  assert.ok(!P.segmentHitsBox(0, 12, 5, 10, 12, 5, box), '从头顶掠过');
  assert.ok(P.segmentHitsBox(5, 20, 5, 5, 5, 5, box), '竖直下穿');
  assert.ok(!P.segmentHitsBox(0, 10.5, 5, 4, 10.5, 5, box), '没够到');
}

// 8) 10Hz 服务器 tick 下自动跳上 1 格台阶（消费方回归：半隐式欧拉离散低估顶点，v=10 顶点 1.2 格）
{
  const b = P.createBody(4.0, 10, 0.5, 0.4, 0.9); // 恶狼尺寸
  for (let i = 0; i < 50; i++) {
    b.vx = 4.0; b.vz = 0;
    if (b.onGround && P.blockedAhead(b, stepUp, 1, 0)) P.tryJump(b, 10);
    P.step(b, stepUp, 0.1);
  }
  assert.ok(Math.abs(b.y - 11) < 0.05, '10Hz 下跳上台阶, y=' + b.y);
  assert.ok(b.x > 5, '站上台阶, x=' + b.x);
}

console.log('test_physics OK');
