// tests/test_interact.js
'use strict';
const assert = require('node:assert');
require('../js/blocks.js');
require('../js/interact.js');
const Raycast = globalThis.MyWorld.Raycast;

// 仅 (0,0,0) 一个实心方块的世界
const one = { getBlock: (x, y, z) => (x === 0 && y === 0 && z === 0 ? 3 : 0) };

// 1) 自上而下命中顶面
{
  const r = Raycast.cast(one, 0.5, 3.5, 0.5, 0, -1, 0, 6);
  assert.strictEqual(r.hit, true);
  assert.deepStrictEqual([r.x, r.y, r.z], [0, 0, 0]);
  assert.deepStrictEqual([r.nx, r.ny, r.nz], [0, 1, 0], 'top face normal');
}
// 2) 自下而上命中底面
{
  const r = Raycast.cast(one, 0.5, -2.5, 0.5, 0, 1, 0, 6);
  assert.strictEqual(r.hit, true);
  assert.deepStrictEqual([r.nx, r.ny, r.nz], [0, -1, 0], 'bottom face normal');
}
// 3) 沿 -x 方向命中东面
{
  const r = Raycast.cast(one, 3.5, 0.5, 0.5, -1, 0, 0, 6);
  assert.strictEqual(r.hit, true);
  assert.deepStrictEqual([r.nx, r.ny, r.nz], [1, 0, 0], 'east face normal');
}
// 4) 超出 maxDist 不命中
{
  const r = Raycast.cast(one, 0.5, 20, 0.5, 0, -1, 0, 6);
  assert.strictEqual(r.hit, false);
}
// 5) 斜向命中（含分量为 0 的安全处理）
{
  const d = Math.hypot(1, -1);
  const r = Raycast.cast(one, -1.5, 2.5, 0.5, 1 / d, -1 / d, 0, 10);
  assert.strictEqual(r.hit, true);
  assert.deepStrictEqual([r.x, r.y, r.z], [0, 0, 0]);
}
// 6) 空世界不命中
{
  const empty = { getBlock: () => 0 };
  const r = Raycast.cast(empty, 0, 0, 0, 0, 0, -1, 6);
  assert.strictEqual(r.hit, false);
}
console.log('test_interact OK');
