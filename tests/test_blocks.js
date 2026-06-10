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
    assert.ok(Number.isInteger(b.tex[k]) && b.tex[k] >= 0 && b.tex[k] < 16, 'tex index in atlas');
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
// 快捷栏顺序
assert.deepStrictEqual(Blocks.HOTBAR, [1,2,3,4,5,6,7,8]);
console.log('test_blocks OK');
