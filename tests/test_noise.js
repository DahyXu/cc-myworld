// tests/test_noise.js
'use strict';
const assert = require('node:assert');
require('../js/noise.js');
const Noise = globalThis.MyWorld.Noise;

// 同种子确定性
const a = Noise.create(12345), b = Noise.create(12345);
for (let i = 0; i < 50; i++) {
  const x = i * 1.37, y = i * 0.71;
  assert.strictEqual(a.perlin2(x, y), b.perlin2(x, y), 'same seed must be deterministic');
}
// 不同种子产生不同序列
const c = Noise.create(99999);
let diff = false;
for (let i = 0; i < 50; i++) if (a.perlin2(i * 1.37, i * 0.71) !== c.perlin2(i * 1.37, i * 0.71)) { diff = true; break; }
assert.ok(diff, 'different seeds must differ');
// 值域大致在 [-1,1]
for (let i = 0; i < 500; i++) {
  const v = a.perlin2(i * 0.913, i * 1.531);
  assert.ok(v >= -1.05 && v <= 1.05, 'perlin2 out of range: ' + v);
}
// 非整点应有非零值（整点恰好为 0 是柏林噪声特性）
assert.notStrictEqual(a.perlin2(0.5, 0.5), 0);
// fbm2 值域与确定性
for (let i = 0; i < 200; i++) {
  const v = a.fbm2(i * 0.37, i * 0.61, 4, 2, 0.5);
  assert.ok(v >= -1.05 && v <= 1.05, 'fbm2 out of range: ' + v);
}
assert.strictEqual(a.fbm2(3.3, 4.4, 4, 2, 0.5), b.fbm2(3.3, 4.4, 4, 2, 0.5));
console.log('test_noise OK');
