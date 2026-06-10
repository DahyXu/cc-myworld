// tests/test_player.js
'use strict';
const assert = require('node:assert');
require('../js/blocks.js');
require('../js/player.js');
const Player = globalThis.MyWorld.Player;

// 模拟世界：y<10 全是石头（地表面在 y=10），x>=5 处有一堵高墙
function flatWorld() {
  return { getBlock: (x, y, z) => (y < 10 ? 3 : 0) };
}
function wallWorld() {
  return { getBlock: (x, y, z) => (y < 10 || (x >= 5 && y < 30) ? 3 : 0) };
}
const IDLE = { forward: false, back: false, left: false, right: false, jump: false };

// 1) 重力下落并停在地面：脚底 y=10
{
  const w = flatWorld();
  const p = Player.create(0.5, 20, 0.5);
  for (let i = 0; i < 200; i++) Player.update(p, w, 1 / 60, IDLE);
  assert.ok(Math.abs(p.y - 10) < 0.01, 'rests on ground, y=' + p.y);
  assert.strictEqual(p.onGround, true);
  assert.strictEqual(p.vy, 0);
}

// 2) 走向墙被挡住：x 不超过 5 - 0.3
{
  const w = wallWorld();
  const p = Player.create(0.5, 10, 0.5);
  p.yaw = -Math.PI / 2; // 面向 +x（yaw=0 面向 -z）
  const input = { ...IDLE, forward: true };
  for (let i = 0; i < 300; i++) Player.update(p, w, 1 / 60, input);
  assert.ok(p.x < 5 - 0.29, 'blocked by wall, x=' + p.x);
  assert.ok(p.x > 4.5, 'but got close to wall, x=' + p.x);
}

// 3) 跳跃：上升超过 1 格再落回
{
  const w = flatWorld();
  const p = Player.create(0.5, 10, 0.5);
  Player.update(p, w, 1 / 60, IDLE); // 先落稳一帧
  let maxY = 10;
  const jumpInput = { ...IDLE, jump: true };
  for (let i = 0; i < 120; i++) {
    Player.update(p, w, 1 / 60, i === 0 ? jumpInput : IDLE);
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(maxY > 11, 'jump height > 1 block, max=' + maxY);
  assert.ok(Math.abs(p.y - 10) < 0.01, 'lands back');
}

// 4) 空中不能二段跳
{
  const w = flatWorld();
  const p = Player.create(0.5, 15, 0.5);
  const jumpInput = { ...IDLE, jump: true };
  Player.update(p, w, 1 / 60, jumpInput); // 空中按跳
  assert.ok(p.vy <= 0, 'no double jump in air');
}

// 5) yaw=0 朝 -z 前进
{
  const w = flatWorld();
  const p = Player.create(0.5, 10, 0.5);
  const input = { ...IDLE, forward: true };
  for (let i = 0; i < 60; i++) Player.update(p, w, 1 / 60, input);
  assert.ok(p.z < 0.5 - 1, 'moves toward -z, z=' + p.z);
  assert.ok(Math.abs(p.x - 0.5) < 0.01, 'x unchanged');
}

// 6) 头顶有方块时跳跃被顶住：天花板在 y=12（脚底最高 12-1.8=10.2）
{
  const w = { getBlock: (x, y, z) => (y < 10 || y === 12 ? 3 : 0) };
  const p = Player.create(0.5, 10, 0.5);
  Player.update(p, w, 1 / 60, IDLE);
  const jumpInput = { ...IDLE, jump: true };
  let maxY = 10;
  for (let i = 0; i < 60; i++) {
    Player.update(p, w, 1 / 60, i === 0 ? jumpInput : IDLE);
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(maxY <= 12 - 1.8 + 0.01, 'ceiling blocks jump, max=' + maxY);
}
console.log('test_player OK');
