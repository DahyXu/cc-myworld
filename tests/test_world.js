// tests/test_world.js
'use strict';
const assert = require('node:assert');
require('../js/noise.js');
require('../js/blocks.js');
require('../js/world.js');
const W = globalThis.MyWorld.World;

assert.strictEqual(W.CHUNK_X, 16);
assert.strictEqual(W.CHUNK_Y, 64);
assert.strictEqual(W.CHUNK_Z, 16);

// 同种子确定性
const w1 = W.create(1337), w2 = W.create(1337);
w1.ensureChunk(0, 0); w2.ensureChunk(0, 0);
assert.ok(Buffer.from(w1.getChunk(0,0).data).equals(Buffer.from(w2.getChunk(0,0).data)), 'same seed same chunk');

// 不同种子不同
const w3 = W.create(42);
w3.ensureChunk(0, 0);
assert.ok(!Buffer.from(w1.getChunk(0,0).data).equals(Buffer.from(w3.getChunk(0,0).data)), 'diff seed diff chunk');

// 地表结构：顶面是草(1)或沙(7)，其上是空气，往下泥土/沙，深处石头
for (const [x, z] of [[3,3],[8,12],[15,0],[0,15]]) {
  const h = w1.terrainHeight(x, z);
  assert.ok(h >= 2 && h <= 54, 'height in range: ' + h);
  const top = w1.getBlock(x, h, z);
  assert.ok(top === 1 || top === 7, 'surface grass or sand, got ' + top);
  // 地表正上方要么空气要么树（原木4/树叶6）
  const above = w1.getBlock(x, h + 1, z);
  assert.ok(above === 0 || above === 4 || above === 6, 'above surface: ' + above);
  const mid = w1.getBlock(x, h - 2, z);
  assert.ok(mid === 2 || mid === 7, 'subsurface dirt or sand, got ' + mid);
  assert.strictEqual(w1.getBlock(x, Math.max(0, h - 6), z), 3, 'deep stone');
}

// 未生成区块读到空气；y 越界读到空气
assert.strictEqual(w1.getBlock(500, 30, 500), 0);
assert.strictEqual(w1.getBlock(3, -1, 3), 0);
assert.strictEqual(w1.getBlock(3, 64, 3), 0);

// setBlock / getBlock 往返 + dirty 标记
const w4 = W.create(7);
w4.ensureChunk(0, 0);
w4.getChunk(0, 0).dirty = false;
w4.setBlock(5, 30, 5, 8);
assert.strictEqual(w4.getBlock(5, 30, 5), 8);
assert.strictEqual(w4.getChunk(0, 0).dirty, true);
// 边界放置要把相邻区块也标 dirty（已存在时）
w4.ensureChunk(-1, 0);
w4.getChunk(-1, 0).dirty = false;
w4.getChunk(0, 0).dirty = false;
w4.setBlock(0, 30, 5, 8); // x=0 是区块 (0,0) 的西边界
assert.strictEqual(w4.getChunk(-1, 0).dirty, true, 'neighbor dirty on border edit');

// 生成顺序无关性（pending 机制正确性的核心断言）
const wa = W.create(777), wb = W.create(777);
wa.ensureChunk(0, 0); wa.ensureChunk(1, 0); wa.ensureChunk(0, 1);
wb.ensureChunk(0, 1); wb.ensureChunk(1, 0); wb.ensureChunk(0, 0);
for (const k of ['0,0', '1,0', '0,1']) {
  assert.ok(Buffer.from(wa.chunks.get(k).data).equals(Buffer.from(wb.chunks.get(k).data)), 'order independent: ' + k);
}

// 至少能找到树（多扫几个区块，找原木 id=4）
const wt = W.create(2024);
let foundLog = false;
for (let cx = 0; cx < 4 && !foundLog; cx++) for (let cz = 0; cz < 4 && !foundLog; cz++) {
  wt.ensureChunk(cx, cz);
  const d = wt.getChunk(cx, cz).data;
  for (let i = 0; i < d.length; i++) if (d[i] === 4) { foundLog = true; break; }
}
assert.ok(foundLog, 'trees exist in 4x4 chunks');
console.log('test_world OK');
