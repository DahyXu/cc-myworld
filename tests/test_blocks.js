// tests/test_blocks.js
'use strict';
const assert = require('node:assert');
require('../js/blocks.js');
const Blocks = globalThis.MyWorld.Blocks;

assert.strictEqual(Blocks.AIR, 0);
const ids = [1,2,3,4,5,6,7,8];
for (const id of ids) {
  const b = Blocks.BLOCKS[id];
  assert.ok(b, 'block ' + id + ' missing');
  assert.ok(typeof b.name === 'string' && b.name.length > 0);
  assert.strictEqual(b.solid, true);
  for (const k of ['top','side','bottom']) {
    assert.ok(Number.isInteger(b.tex[k]) && b.tex[k] >= 0 && b.tex[k] < 10, 'tex index in drawn atlas tiles');
  }
}
// 草方块三面贴图不同
const grass = Blocks.BLOCKS[1];
assert.notStrictEqual(grass.tex.top, grass.tex.side);
assert.notStrictEqual(grass.tex.side, grass.tex.bottom);
// isSolid 辅助
assert.strictEqual(Blocks.isSolid(0), false);
assert.strictEqual(Blocks.isSolid(3), true);
assert.strictEqual(Blocks.isSolid(255), false); // 未注册 id 不算实心
// 原木顶面与侧面贴图不同（方向性方块）
const log = Blocks.BLOCKS[4];
assert.notStrictEqual(log.tex.top, log.tex.side);
// 快捷栏顺序，且每个 id 都已注册
assert.deepStrictEqual(Blocks.HOTBAR, [1,2,3,4,5,6,7,8]);
assert.ok(Blocks.HOTBAR.every((id) => id in Blocks.BLOCKS), 'hotbar ids all valid');
// tileUV：u/v 范围与 v 轴翻转
const s = 1 / Blocks.ATLAS_TILES;
let uv = Blocks.tileUV(0); // 第 0 行第 0 列
assert.strictEqual(uv.u0, 0);
assert.strictEqual(uv.u1, s);
assert.strictEqual(uv.v0, 1 - s);
assert.strictEqual(uv.v1, 1);
uv = Blocks.tileUV(5); // 第 1 行第 1 列
assert.ok(Math.abs(uv.u0 - s) < 1e-9 && Math.abs(uv.u1 - 2 * s) < 1e-9, 'tile5 u-range');
assert.ok(Math.abs(uv.v0 - 0.5) < 1e-9 && Math.abs(uv.v1 - 0.75) < 1e-9, 'tile5 v-range (flipped)');
for (let i = 0; i < 10; i++) {
  const t = Blocks.tileUV(i);
  assert.ok(t.u0 < t.u1 && t.v0 < t.v1 && t.u0 >= 0 && t.u1 <= 1 && t.v0 >= 0 && t.v1 <= 1, 'tile ' + i + ' uv in range');
}
console.log('test_blocks OK');
