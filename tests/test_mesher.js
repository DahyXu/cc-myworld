// tests/test_mesher.js
'use strict';
const assert = require('node:assert');
require('../js/noise.js');
require('../js/blocks.js');
require('../js/world.js');
require('../js/mesher.js');
const Mesher = globalThis.MyWorld.Mesher;

// 模拟世界：仅 (0,0,0) 一个草方块
function singleBlockWorld() {
  return { getBlock: (x, y, z) => (x === 0 && y === 0 && z === 0 ? 1 : 0) };
}

const g1 = Mesher.buildChunkGeometryData(singleBlockWorld(), 0, 0);
assert.strictEqual(g1.positions.length, 6 * 4 * 3, 'single block 6 faces 24 verts');
assert.strictEqual(g1.indices.length, 6 * 6, '36 indices');
assert.strictEqual(g1.uvs.length, 6 * 4 * 2);
assert.strictEqual(g1.colors.length, 6 * 4 * 3);
assert.strictEqual(g1.normals.length, 6 * 4 * 3);
// 顶点坐标都在 [0,1] 内（方块在原点）
for (const v of g1.positions) assert.ok(v >= 0 && v <= 1);

// 相邻两块共面剔除：两块沿 x 相邻 → 共 10 面
const twoWorld = { getBlock: (x, y, z) => ((y === 0 && z === 0 && (x === 0 || x === 1)) ? 3 : 0) };
const g2 = Mesher.buildChunkGeometryData(twoWorld, 0, 0);
assert.strictEqual(g2.positions.length / 12, 10, 'two adjacent blocks expose 10 faces');

// 顶面无遮挡时颜色应为最亮 1.0；底面最暗 0.5
// 找法线 (0,1,0) 的顶点，其颜色应全为 1.0
let foundTop = false, foundBottom = false;
for (let i = 0; i < g1.normals.length; i += 3) {
  if (g1.normals[i + 1] === 1) { assert.ok(Math.abs(g1.colors[i] - 1.0) < 1e-6, 'top brightness 1.0, got ' + g1.colors[i]); foundTop = true; }
  if (g1.normals[i + 1] === -1) { assert.ok(Math.abs(g1.colors[i] - 0.5) < 1e-6, 'bottom brightness 0.5'); foundBottom = true; }
}
assert.ok(foundTop && foundBottom);

// AO：在 (1,1,0) 放一块，则 (0,0,0) 顶面靠近它的顶点应变暗（< 1.0）
const aoWorld = { getBlock: (x, y, z) => ((x === 0 && y === 0 && z === 0) || (x === 1 && y === 1 && z === 0) ? 3 : 0) };
const g3 = Mesher.buildChunkGeometryData(aoWorld, 0, 0);
let darkened = false;
for (let i = 0; i < g3.normals.length; i += 3) {
  if (g3.normals[i + 1] === 1 && g3.positions[i] === 1) { // 顶面 x=1 侧顶点
    if (g3.colors[i] < 0.99) darkened = true;
  }
}
assert.ok(darkened, 'AO darkens top-face verts near occluder');

// UV：草方块顶面用瓦片 0 → u∈[0,0.25], v∈[0.75,1]
// 通过法线定位顶面 4 个顶点的 uv
const vertsPerFace = 4;
for (let f = 0; f < 6; f++) {
  const ni = f * vertsPerFace * 3;
  if (g1.normals[ni + 1] === 1) {
    for (let v = 0; v < 4; v++) {
      const u = g1.uvs[f * 8 + v * 2], vv = g1.uvs[f * 8 + v * 2 + 1];
      assert.ok(u >= 0 && u <= 0.25 + 1e-9, 'top face u in tile 0');
      assert.ok(vv >= 0.75 - 1e-9 && vv <= 1, 'top face v in tile 0');
    }
  }
}

// 三角形绕向锁定：每个三角形从面外侧看必须逆时针（叉积与法线同向）
{
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const at = (arr, i) => [arr[i * 3], arr[i * 3 + 1], arr[i * 3 + 2]];
  for (let t = 0; t < g1.indices.length; t += 3) {
    const [i0, i1, i2] = [g1.indices[t], g1.indices[t + 1], g1.indices[t + 2]];
    const n = at(g1.normals, i0);
    const c = cross(sub(at(g1.positions, i1), at(g1.positions, i0)), sub(at(g1.positions, i2), at(g1.positions, i0)));
    assert.ok(dot(c, n) > 0, 'triangle ' + t / 3 + ' must wind CCW from outside');
  }
}

// 真实世界冒烟测试：生成一个区块能构出网格且不抛异常
const W = globalThis.MyWorld.World;
const w = W.create(99);
w.ensureChunk(0, 0);
const g4 = Mesher.buildChunkGeometryData(w, 0, 0);
assert.ok(g4.positions.length > 0 && g4.indices.length % 6 === 0);
console.log('test_mesher OK');
